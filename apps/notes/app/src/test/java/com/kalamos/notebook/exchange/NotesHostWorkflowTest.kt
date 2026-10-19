package com.kalamos.notebook.exchange
import android.app.Application
import android.content.ContextWrapper
import com.kalamos.notebook.storage.StorageConfig
import com.kalamos.notebook.storage.StorageManager
import java.io.File
import java.util.UUID
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** An explicitly requested host fixture run; source/contract/native transaction code is production. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class NotesHostWorkflowTest {
 @Test fun exportOrApplyPublicWireFixtureWithProductionRepository(){
  val directory=System.getProperty("notes.host.directory")
  assumeTrue("Only run when a host smoke directory is explicitly supplied",directory!=null)
  val root=File(directory!!).apply{mkdirs()}
  val context=object:ContextWrapper(RuntimeEnvironment.getApplication()){
   override fun getFilesDir()=File(root,"native-private").apply{mkdirs()}
  }
  StorageConfig.setRoot(context,File(root,"native-notebooks").apply{mkdirs()}.absolutePath)
  val repo=AgoraDocuments(context);val storage=StorageManager(context)
  if(System.getProperty("notes.host.stage","export")=="export"){
   val input=JSONObject(File(requireNotNull(System.getProperty("notes.host.input"))).readText())
   val id=repo.newNotebook(input.optString("title","Host note"))
   assertTrue(storage.saveNotebookFile(id,"planning.write2.md",input.getString("source")))
   assertTrue(storage.saveNotebookFile(id,"planning.write2.json",input.getJSONObject("sidecar").toString()))
   val image=File(requireNotNull(System.getProperty("notes.host.image"))).readBytes()
   val encoded="data:image/jpeg;base64,"+android.util.Base64.encodeToString(image,android.util.Base64.NO_WRAP)
   val frame=System.getProperty("notes.host.frame")?.let{JSONObject(File(it).readText())} ?: JSONObject("""{"x":0,"y":0,"width":500,"height":623,"pixelWidth":1000,"pixelHeight":1246}""")
   val exported=repo.export(id,setOf("first"),JSONObject().put("first",encoded),previewFrames=JSONObject().put("first",frame))
   exported.first.copyTo(File(root,"notes-document.zip"),overwrite=true)
   File(root,"native-snapshot.json").writeText(repo.inspect(id).put("notebookId",id).put("geometry",frame).toString())
  }else if(System.getProperty("notes.host.stage")=="edit"){
   val snapshot=JSONObject(File(root,"native-snapshot.json").readText());val id=snapshot.getString("notebookId")
   val oldRevision=repo.revision(id);val edited=JSONObject(File(requireNotNull(System.getProperty("notes.host.editedSheet"))).readText())
   val entry=repo.index(id).getJSONArray("pages").getJSONObject(0)
   assertTrue(storage.saveNotebookFile(id,entry.getString("sourceFile"),edited.getString("source")))
   assertTrue(storage.saveNotebookFile(id,entry.getString("sidecarFile"),edited.getJSONObject("sidecar").toString()))
   val current=AgoraDocuments(context).inspect(id)
   assertNotEquals(oldRevision,current.getString("revisionId"))
   assertEquals(snapshot.getString("documentId"),current.getString("documentId"))
   val blocks=current.getJSONArray("blocks")
   assertTrue((0 until blocks.length()).any{blocks.getJSONObject(it).optBoolean("checked")})
   val before=repo.pages(id).toString()
   repo.apply(id,JSONObject(File(root,"proposal.json").readText()),JSONArray())
   assertEquals(before,repo.pages(id).toString())
   val exported=repo.export(id,setOf("first"));assertTrue(exported.first.name.endsWith(".notes.zip"))
   exported.first.copyTo(File(root,"edited-notes-document.zip"),overwrite=true)
   File(root,"edited-native-snapshot.json").writeText(current.put("notebookId",id).toString())
   File(root,"editing-native-verification.json").writeText(JSONObject().put("reopened",true).put("tickPreserved",true).put("revisionChanged",true).put("duplicateDidNotOverwriteEdits",true).put("exported",true).toString())
  }else{
   val snapshot=JSONObject(File(root,"native-snapshot.json").readText());val id=snapshot.getString("notebookId")
   val proposal=JSONObject(File(root,"proposal.json").readText())
   val sheets=JSONArray(File(root,"materialized-pages.json").readText())
   System.getProperty("notes.host.templateIndex")?.let { path ->
    assertTrue(storage.saveNotebookFile(id,"planning.pages.json",File(path).readText()))
    assertEquals(snapshot.getString("revisionId"),repo.revision(id))
   }
   // Simulate a user tick after the real exported revision, without changing its
   // text/geometry. Commit must merge it into the returned real-model result.
   val tickElement=System.getProperty("notes.host.tickElement")
   if(tickElement!=null){
    var found=0
    val entries=repo.index(id).getJSONArray("pages")
    for(i in 0 until entries.length()){
     val entry=entries.getJSONObject(i);val file=entry.getString("sidecarFile")
     val sidecar=JSONObject(storage.getNotebookFile(id,file));val boxes=sidecar.getJSONArray("textBoxes")
     for(n in 0 until boxes.length()){
      val box=boxes.getJSONObject(n)
      if(box.optBoolean("checkbox")&&box.optJSONObject("semantic")?.optString("id")==tickElement){
       assertEquals("☐",box.getString("text"));box.put("text","☑");found++
       box.optJSONArray("words")?.let{words->for(w in 0 until words.length())words.getJSONObject(w).put("text","☑")}
      }
     }
     assertTrue(storage.saveNotebookFile(id,file,sidecar.toString()))
    }
    assertEquals(1,found)
   }
   val beforePages=repo.pages(id).toString()
   val effective=repo.prepare(id,proposal).getJSONObject("effectiveProposal")
   val originalIndex=repo.index(id)
   val saved=repo.apply(id,proposal,sheets)
   val afterIndex=repo.index(id)
   for(key in listOf("template","sheetHeight","version","active"))if(originalIndex.has(key))assertEquals(originalIndex.get(key),afterIndex.get(key))
   assertEquals(snapshot.getString("documentId"),saved.getString("documentId"))
   assertTrue(saved.getBoolean("undoAvailable"))
   assertTrue(repo.pages(id).getJSONObject(0).getJSONObject("sidecar").getJSONArray("textBoxes").length()>0)
   val samePage=proposal.optString("operation")=="replace_ink"
   if(samePage)assertEquals(snapshot.getJSONArray("pages").getJSONObject(0).getString("id"),repo.pages(id).getJSONObject(0).getString("id"))
   // Reopen through a new repository instance: element type, text, identity and task
   // state must survive persistence, rather than merely displaying the right glyph.
   val reopened=AgoraDocuments(context).inspect(id).getJSONArray("blocks")
   val byId=(0 until reopened.length()).associate { reopened.getJSONObject(it).getString("id") to reopened.getJSONObject(it) }
   val expected=effective.getJSONArray("blocks")
   for(n in 0 until expected.length()) {
    val block=expected.getJSONObject(n);val actual=requireNotNull(byId[block.getString("id")])
    assertEquals(block.getString("type"),actual.getString("type"))
    assertEquals(block.getString("text"),actual.getString("text"))
    assertEquals(block.optString("parentId"),actual.optString("parentId"))
    if(block.getString("type")=="task")assertEquals(block.getBoolean("checked"),actual.getBoolean("checked"))
   }
   val before=repo.pages(id).toString()
   repo.apply(id,proposal,JSONArray())
   assertEquals(before,repo.pages(id).toString())
   assertTrue(repo.inspect(id,proposal.getString("proposalId")).getBoolean("proposalApplied"))
   val keep=System.getProperty("notes.host.keepApplied")=="true"
   if(!keep){repo.undo(id,repo.revision(id));assertEquals(beforePages,repo.pages(id).toString())}
   File(root,"native-verification.json").writeText(JSONObject().put("applied",true).put("samePage",samePage).put("reopenedElementsMatch",true).put("templateMetadataPreserved",true).put("duplicateDidNotMutate",true).put("undoRestoredOriginal",!keep).put("newerTickMerged",tickElement!=null).put("appliedRevision",saved.getString("revisionId")).toString())
  }
 }
}
