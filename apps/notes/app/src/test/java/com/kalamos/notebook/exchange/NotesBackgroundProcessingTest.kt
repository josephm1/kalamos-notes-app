package com.kalamos.notebook.exchange

import android.app.Application
import com.kalamos.notebook.ai.NotesAiSettings
import com.kalamos.notebook.storage.StorageConfig
import com.kalamos.notebook.storage.StorageManager
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class NotesBackgroundProcessingTest {
    private val context get()=RuntimeEnvironment.getApplication()
    private val root get()=File(context.filesDir,"notes-background")
    private val queued=mutableListOf<String>()
    private fun processor()=NotesBackgroundProcessing(context,{queued.add(it)},{NotesAiSettings.Provider("https://example.invalid/v1","vision-model","fixture-secret")})
    @Before fun clean(){root.deleteRecursively();queued.clear();StorageConfig.setRoot(context,File(context.filesDir,"local-ai-${UUID.randomUUID()}").apply{mkdirs()}.absolutePath)}
    private fun notebook():Pair<String,Pair<ByteArray,JSONObject>> {val repo=AgoraDocuments(context);val id=repo.newNotebook("Local formatting");return id to (byteArrayOf(1,2,3) to repo.revisionSnapshot(id))}
    private fun proposal(manifest:JSONObject)=JSONObject().put("schema","kalamos.notes-proposal/v1").put("proposalId",UUID.randomUUID().toString())
        .put("documentId",manifest.getString("documentId")).put("baseRevisionId",manifest.getString("revisionId")).put("title","Local formatting")
        .put("targetPageIds",JSONArray().put("first")).put("operation","organize")
        .put("blocks",JSONArray().put(JSONObject().put("id","task").put("type","task").put("text","Milk").put("checked",false)))
    @Test fun localJobIsDurableDeduplicatedAndNeverStoresCredentials(){
        val(id,bundle)=notebook();val p=processor();val job=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId"))
        val request=job.getString("requestId");assertEquals(listOf(request),queued)
        assertEquals(request,processor().processImage(id,"first",bundle.first,bundle.second.getString("revisionId")).getString("requestId"));assertEquals(1,queued.size)
        assertTrue(File(root,"$request.jpg").isFile);assertFalse(File(root,"$request.zip").exists());assertEquals(setOf("$request.jpg","$request.json"),root.listFiles()!!.map{it.name}.toSet());assertFalse(File(root,"$request.json").readText().contains("fixture-secret"))
        assertFalse(File(root,"$request.json").readText().contains("agoraPackage"))
        var calls=0
        assertTrue(p.execute(request){calls++;proposal(bundle.second)})
        val result=processor().result(id);assertFalse(result.getBoolean("pending"));assertEquals(request,result.getJSONObject("proposal").getString("backgroundRequestId"))
        assertTrue(p.execute(request){calls++;error("Must not run twice")});assertEquals(1,calls)
        p.consumed(request);assertFalse(File(root,"$request.jpg").exists());assertFalse(p.result(id).has("requestId"))
    }
    @Test fun failedMarkdownSurvivesConsumptionOnlyInExplicitDiagnostics(){
        val(id,bundle)=notebook();val p=processor();val request=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId")).getString("requestId")
        val markdown="- Milk <input type=\"checkbox\">"
        assertTrue(p.execute(request){proposal(bundle.second).put("operation","replace_page").put("blocks",JSONArray()).put("markdown",markdown)})
        p.processingDiagnostic(id,request,"error","Unsupported list content: html")
        assertFalse(p.result(id).has("failedMarkdown"));p.consumed(request)
        assertFalse((p.diagnostics(id,request) as JSONObject).has("failedMarkdown"))
        assertEquals(markdown,(p.diagnostics(id,request,includeResult=true) as JSONObject).getString("failedMarkdown"))
        assertFalse(p.result(id).has("requestId"));assertTrue(queued.size==1)
    }
    @Test fun changedRevisionCannotQueueOrReplacePendingJob(){
        val(id,bundle)=notebook();val p=processor();val job=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId"))
        StorageManager(context).saveNotebookFile(id,"planning.write2.md","New handwriting context")
        val changed=byteArrayOf(1,2,3) to AgoraDocuments(context).revisionSnapshot(id)
        assertThrows(IllegalArgumentException::class.java){p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId"))}
        assertThrows(IllegalArgumentException::class.java){p.processImage(id,"first",changed.first,changed.second.getString("revisionId"))}
        assertEquals(job.getString("requestId"),p.result(id).getString("requestId"));assertEquals(1,queued.size)
    }
    @Test fun killedRunningRequestIsNotChargedAgain(){
        val(id,bundle)=notebook();val p=processor();val job=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId"));val request=job.getString("requestId")
        val saved=File(root,"$request.json");saved.writeText(JSONObject(saved.readText()).put("state","running").toString())
        assertFalse(p.execute(request){error("A running request must not make another call")})
        assertFalse(p.result(id).getBoolean("pending"));assertTrue(p.result(id).getString("error").contains("interrupted"))
        p.replay(id);assertEquals(1,queued.size)
    }
    @Test fun modelFailureAndWrongRevisionStayDurableWithoutApplying(){
        val(id,bundle)=notebook();val p=processor();val request=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId")).getString("requestId")
        assertFalse(p.execute(request){proposal(bundle.second).put("baseRevisionId","b".repeat(64))})
        val result=processor().result(id);assertFalse(result.has("proposal"));assertFalse(result.getBoolean("pending"))
        assertEquals(bundle.second.getString("revisionId"),AgoraDocuments(context).revisionSnapshot(id).getString("revisionId"))
        assertThrows(IllegalArgumentException::class.java){p.consumed(UUID.randomUUID().toString())}
    }
    @Test fun receiptCannotBeAcknowledgedWhileRunningAndDiagnosticsRetainLocalStages(){
        val(id,bundle)=notebook();val p=processor();val request=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId")).getString("requestId")
        assertThrows(IllegalArgumentException::class.java){p.consumed(request)}
        p.processingDiagnostic(id,request,"checkpoint",null)
        p.execute(request){throw java.io.IOException("fixture connection failed")}
        assertTrue(p.result(id).getString("error").contains("connection"))
        p.consumed(request)
        assertEquals("checkpoint",(p.diagnostics(id,request,history=true) as JSONArray).getJSONObject(0).getString("stage"))
        assertFalse((p.diagnostics("other",request) as JSONObject).has("requestId"))
    }
    @Test fun oldExternalPendingReceiptBecomesActionableErrorWithoutBroadcasts(){
        val request=UUID.randomUUID().toString();root.mkdirs()
        File(root,"$request.json").writeText(JSONObject().put("requestId",request).put("notebookId","old").put("agoraPackage","com.newoether.agora").put("pending",true).toString())
        val result=processor().result("old");assertFalse(result.getBoolean("pending"));assertTrue(result.has("error"))
        assertTrue(queued.isEmpty());processor().consumed(request)
    }
    @Test fun lateCompletionCannotResurrectAnAcknowledgedInterruptedRequest(){
        val(id,bundle)=notebook();val p=processor();val request=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId")).getString("requestId")
        assertFalse(p.execute(request){
            assertFalse(p.execute(request){error("Redelivered running work must not call a model")})
            p.consumed(request)
            proposal(bundle.second)
        })
        assertFalse(p.result(id).has("requestId"))
        assertTrue(JSONObject(File(root,"$request.json").readText()).getBoolean("consumed"))
    }

    @Test fun queuedJobRejectsChangedThinkingBeforeMakingProviderRequest(){
        val(id,bundle)=notebook();var level="none"
        val p=NotesBackgroundProcessing(context,{queued.add(it)},{NotesAiSettings.Provider("https://example.invalid/v1","vision-model","fixture-secret",level)})
        val request=p.processImage(id,"first",bundle.first,bundle.second.getString("revisionId")).getString("requestId")
        assertEquals("none",JSONObject(File(root,"$request.json").readText()).getString("thinking"))
        level="low";assertFalse(p.execute(request))
        assertTrue(p.result(id).getString("error").contains("AI settings changed"));assertFalse(p.result(id).has("proposal"))
    }

}
