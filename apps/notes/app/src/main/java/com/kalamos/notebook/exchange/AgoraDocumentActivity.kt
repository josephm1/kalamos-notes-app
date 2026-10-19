package com.kalamos.notebook.exchange

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.activity.OnBackPressedCallback
import android.widget.LinearLayout
import android.widget.Button
import android.widget.TextView
import android.webkit.WebView
import com.kalamos.notebook.AppFragment
import com.kalamos.foundation.runtime.R as RuntimeR
import androidx.core.content.FileProvider
import com.kalamos.foundation.documents.NotesDocumentBundle as DocumentBundle
import com.kalamos.notebook.MainActivity
import com.kalamos.notebook.storage.StorageManager
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/** The same real editor and ink lifecycle as Notes, with an activity-result document boundary. */
class AgoraDocumentActivity : MainActivity() {
    @Volatile var pending = JSONObject().put("loading",true)
        private set
    @Volatile private var diagnostic = JSONObject()
    fun diagnosticReport():JSONObject = JSONObject(diagnostic.toString())
    fun diagnosticHistory():org.json.JSONArray = org.json.JSONArray(
        java.io.File(filesDir,"agora-document-diagnostics").listFiles()
            ?.filter { it.extension=="json" && it.length()<=220_000 }
            ?.sortedByDescending { it.lastModified() }?.take(12)
            ?.mapNotNull { runCatching { JSONObject(it.readText()) }.getOrNull() } ?: emptyList<JSONObject>()
    )
    fun processingDiagnostic(stage:String,message:String?) {
        require(stage in setOf("checkpoint","inspect","materialize","commit","completed","error"))
        recordDiagnostic(stage,message=message)
    }
    private fun recordDiagnostic(stage:String, payload:JSONObject?=null, message:String?=null) {
        val next=JSONObject(diagnostic.toString()).put("stage",stage).put("requestId",requestId)
        payload?.let{next.put("incomingProposal",it)}
        message?.let{next.put("error",it.take(1000))}
        diagnostic=next
        android.util.Log.i("NotesExchange", "incoming stage=$stage bytes="+next.optInt("receivedBytes"))
        // Task-scoped private payload only: no API headers, keys or unrelated conversations.
        try {
            val dir=java.io.File(filesDir,"agora-document-diagnostics").apply{mkdirs()}
            val file=android.util.AtomicFile(java.io.File(dir,"$requestId.json"));val out=file.startWrite()
            try{out.write(next.toString().toByteArray());file.finishWrite(out)}catch(e:Exception){file.failWrite(out)}
            dir.listFiles()?.sortedByDescending{it.lastModified()}?.drop(12)?.forEach{it.delete()}
        } catch(_:Exception) { }
    }
    private var requestId=""
    private var recovered=false
    private lateinit var attachButton: Button
    override fun onResume() { super.onResume(); current = java.lang.ref.WeakReference(this) }
    override fun onDestroy() { if (current.get() === this) current.clear(); super.onDestroy() }
    override fun createAppFragment() = AppFragment.newInstance(isolatedWebView = true)

    private fun installSessionHeader() {
        val content = findViewById<android.widget.FrameLayout>(android.R.id.content)
        val editor = content.getChildAt(0)
        content.removeView(editor)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(android.graphics.Color.WHITE) }
        val header = layoutInflater.inflate(com.kalamos.notebook.R.layout.agora_session_header, layout, false)
        layout.addView(header)
        layout.addView(editor, LinearLayout.LayoutParams(-1, 0, 1f))
        content.addView(layout)
        attachButton = header.findViewById(com.kalamos.notebook.R.id.agoraAttach)
        attachButton.isEnabled = false
        attachButton.visibility = android.view.View.GONE
        header.findViewById<Button>(com.kalamos.notebook.R.id.agoraOptions).apply { isEnabled = false; visibility = android.view.View.GONE }
        setSessionBusy(false)
        attachButton.setOnClickListener { dispatchSessionAction("attachToChat") }
        header.findViewById<Button>(com.kalamos.notebook.R.id.agoraOptions).setOnClickListener { dispatchSessionAction("options") }
        header.findViewById<Button>(com.kalamos.notebook.R.id.agoraBack).setOnClickListener { dispatchSessionAction("back") }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { dispatchSessionAction("back") }
        })
    }
    private fun dispatchSessionAction(action: String) {
        if (pending.optBoolean("loading")) {
            if (action == "back") cancelSession()
            return
        }
        findViewById<WebView>(RuntimeR.id.webView)?.evaluateJavascript(
            "window.KalamosNotesAgora && window.KalamosNotesAgora.$action()", null)
    }
    fun setSessionBusy(busy: Boolean) {
        val selected = pending.has("notebookId")
        attachButton.visibility = if (selected) android.view.View.VISIBLE else android.view.View.GONE
        findViewById<Button>(com.kalamos.notebook.R.id.agoraOptions).visibility = attachButton.visibility
        attachButton.isEnabled = !busy && selected
        findViewById<Button>(com.kalamos.notebook.R.id.agoraOptions).isEnabled = !busy && pending.has("notebookId")
        findViewById<TextView>(com.kalamos.notebook.R.id.agoraSessionSubtitle).visibility =
            if (selected) android.view.View.VISIBLE else android.view.View.GONE
        val header = attachButton.parent as android.view.View
        header.visibility = if (selected) android.view.View.VISIBLE else android.view.View.GONE
        header.layoutParams = header.layoutParams.apply {
            height = ((if (selected) 60 else 48) * resources.displayMetrics.density).toInt()
        }
        attachButton.text = if (busy) "Preparing…" else "Attach to chat"
    }
    fun cancelSession() { setResult(RESULT_CANCELED); finish() }
    fun selectNotebook(notebookId: String) { ready(notebookId) }
    fun showPicker() {
        require(intent.getStringExtra("operation") == "pick")
        pending.remove("notebookId"); pending.remove("proposal")
        requestFile().delete() // Request navigation only; the saved notebook remains untouched.
        setSessionBusy(false)
    }

    private fun requestFile()=java.io.File(java.io.File(filesDir,"agora-document-requests").apply{mkdirs()},"$requestId.json")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installSessionHeader()
        requestId=intent.getStringExtra("requestId").orEmpty()
        try { UUID.fromString(requestId) } catch (_:Exception) { fail("Invalid document request");return }
        if(requestFile().isFile){try{val restored=JSONObject(requestFile().readText());recovered=restored.optBoolean("recovered");ready(restored.getString("notebookId"),restored.optJSONObject("proposal"));return}catch(_:Exception){fail("Saved document request is unavailable");return}}
        val operation=intent.getStringExtra("operation") ?: "pick"
        if(operation !in setOf("new","pick","edit","apply")) { fail("Unsupported Notes operation");return }
        if(operation=="pick") {
            pending = JSONObject().put("requestId", requestId).put("operation", "pick")
                .put("includeImages", intent.getBooleanExtra("includeImages", true))
            return
        }
        executor.execute {
            try {
                val repo=AgoraDocuments(this)
                var proposal:JSONObject?=null
                if(operation=="apply") {
                    val uri=requireNotNull(intent.data);require(uri.scheme=="content")
                    val bytes=contentResolver.openInputStream(uri)!!.use{it.readBytesBounded(80000)}
                    diagnostic=JSONObject().put("receivedBytes",bytes.size).put("operation",operation)
                    intent.getStringExtra("notesResultTraceUri")?.let { raw ->
                        // Optional diagnostic evidence cannot change or block document processing.
                        runCatching {
                            val traceUri=Uri.parse(raw);require(traceUri.scheme=="content")
                            val trace=contentResolver.openInputStream(traceUri)!!.use { it.readBytesBounded(128_000) }
                            diagnostic.put("assistantOutput",JSONObject(String(trace,Charsets.UTF_8)))
                        }
                    }
                    val incoming=JSONObject(String(bytes,Charsets.UTF_8))
                    recordDiagnostic("received",incoming)
                    proposal=DocumentBundle.proposalEnvelope(incoming)
                    recordDiagnostic("validated")
                }
                val documentId=proposal?.optString("documentId")?.takeIf{it.isNotBlank()} ?: intent.getStringExtra("documentId")?.takeIf{it.isNotBlank()}
                val notebook=if(documentId!=null) {
                    try { val existing=repo.notebook(documentId);repo.inspect(existing);existing }
                    catch(missing:Exception){
                        if(operation!="edit"||intent.data==null)throw missing
                        val uri=intent.data!!;require(uri.scheme=="content")
                        val bundle=contentResolver.openInputStream(uri)!!.use{DocumentBundle.read(it)}
                        require(bundle.first.getString("documentId")==documentId)
                        runOnUiThread{AlertDialog.Builder(this).setTitle("Recover saved Notes revision?").setMessage("The linked note is unavailable. Restore this saved attachment as a separate editable note. The original link will not be overwritten.")
                            .setNegativeButton("Cancel"){_,_->finish()}.setPositiveButton("Recover"){_,_->executor.execute{try{val restored=repo.restoreBundle(bundle.first,bundle.second);runOnUiThread{recovered=true;ready(restored)}}catch(e:Exception){runOnUiThread{fail(e.message?:"Recovery failed")}}}}.show()}
                        return@execute
                    }
                } else repo.newNotebook(proposal?.getString("title") ?: "Agora note")
                runOnUiThread { if(!isFinishing)ready(notebook,proposal) }
            } catch(e:Exception) { runOnUiThread { fail(e.message?:"Cannot open document") } }
        }
    }
    private fun java.io.InputStream.readBytesBounded(limit:Int):ByteArray {
        val out=java.io.ByteArrayOutputStream();val b=ByteArray(8192)
        while(true){val n=read(b);if(n<0)break;require(out.size()+n<=limit){"Proposal too large"};out.write(b,0,n)}
        return out.toByteArray()
    }
    private fun ready(notebookId:String,proposal:JSONObject?=null) {
        pending=JSONObject().put("requestId",requestId).put("operation",intent.getStringExtra("operation")).put("notebookId",notebookId).put("includeImages",intent.getBooleanExtra("includeImages",true)).put("recovered",recovered)
        proposal?.let{pending.put("proposal",it)}
        val file=requestFile();val part=java.io.File(file.parentFile,file.name+".part");part.outputStream().use{it.write(pending.toString().toByteArray());it.fd.sync()};require(part.renameTo(file))
        setSessionBusy(false)
        findViewById<TextView>(com.kalamos.notebook.R.id.agoraSessionTitle).text = StorageManager(this).loadLibrary().notebooks.firstOrNull { it.notebookId == notebookId }?.title ?: "Note"
        val caller=callingPackage
        AgoraDocuments(this).origin(notebookId,caller,intent.getStringExtra("ownerId"))
    }
    fun accepted(notebookId:String) { pending.put("notebookId",notebookId);pending.remove("proposal");val file=requestFile();val part=java.io.File(file.parentFile,file.name+".part");part.writeText(pending.toString());require(part.renameTo(file)) }
    fun returnDocument(file:java.io.File, manifest:JSONObject) {
        val uri=FileProvider.getUriForFile(this,"$packageName.agora-documents",file)
        setResult(RESULT_OK,Intent().setDataAndType(uri,DocumentBundle.MIME).apply {
            clipData=ClipData.newRawUri("Notes document",uri);addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra("requestId",requestId);putExtra("recovered",recovered);putExtra("documentId",manifest.getString("documentId"));putExtra("revisionId",manifest.getString("revisionId"))
        });finish()
    }
    fun returnDocuments(documents:List<Pair<java.io.File,JSONObject>>) {
        require(documents.size in 1..32)
        val uris=documents.map { FileProvider.getUriForFile(this,"$packageName.agora-documents",it.first) }
        val clip=ClipData.newRawUri("Selected Notes documents",uris.first())
        uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
        setResult(RESULT_OK,Intent().setDataAndType(uris.first(),DocumentBundle.MIME).apply {
            clipData=clip;addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra("requestId",requestId);putExtra("documentCount",documents.size)
        })
        finish()
    }
    private fun fail(message:String){recordDiagnostic("failed",message=message);AlertDialog.Builder(this).setTitle("Notes document unavailable").setMessage(message).setPositiveButton("Close"){_,_->finish()}.setOnCancelListener{finish()}.show()}
    companion object {
        var current = java.lang.ref.WeakReference<AgoraDocumentActivity>(null)
            private set
        private val executor=Executors.newSingleThreadExecutor()
    }
}
