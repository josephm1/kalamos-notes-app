package com.kalamos.notebook.exchange

import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.fragment.app.Fragment
import com.kalamos.foundation.documents.NotesDocumentBundle
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Async bridge work is bounded to this view owner; native documents never enter an AI prompt. */
class AgoraBridge(private val fragment:Fragment,private val emit:(JSONObject)->Unit) {
    private val released=AtomicBoolean(false)
    private val prepared = java.util.concurrent.ConcurrentHashMap<String, Pair<java.io.File, JSONObject>>()
    private val repo=AgoraDocuments(fragment.requireContext().applicationContext)
    private val navigation = fragment.requireContext().getSharedPreferences("notes-agora-navigation", android.content.Context.MODE_PRIVATE)
    fun call(method:String,args:JSONObject):String? {
        if(method=="notes.agora.processingDiagnostic") {
            val host=fragment.activity as? AgoraDocumentActivity
            host?.processingDiagnostic(args.getString("stage"),args.optString("message").takeIf{it.isNotBlank()})
            if(args.optString("notebookId").isNotBlank())runCatching{NotesBackgroundProcessing(fragment.requireContext().applicationContext).processingDiagnostic(args.getString("notebookId"),args.optString("requestId").takeIf{it.isNotBlank()},args.getString("stage"),args.optString("message").takeIf{it.isNotBlank()})}
            return "{}"
        }
        if(method=="notes.agora.diagnostics") {
            val host=fragment.activity as? AgoraDocumentActivity
            if(host==null && args.optString("notebookId").isNotBlank())return NotesBackgroundProcessing(fragment.requireContext().applicationContext).diagnostics(args.getString("notebookId"),args.optString("requestId").takeIf{it.isNotBlank()},args.optBoolean("history"),args.optBoolean("includeResult")).toString()
            return if(args.optBoolean("history")) (host?.diagnosticHistory()?:JSONArray()).toString()
                else (host?.diagnosticReport()?:JSONObject()).toString()
        }
        if(method=="notes.agora.pending")return ((fragment.activity as? AgoraDocumentActivity)?.pending ?: JSONObject().put("returnNotebook",navigation.getString("returnNotebook",null))).toString()
        if(!method.startsWith("notes.agora.") && !method.startsWith("notes.ai."))return null
        if (method == "notes.agora.picker") {
            val host = requireNotNull(fragment.activity as? AgoraDocumentActivity)
            host.runOnUiThread { host.showPicker() }
            return "{}"
        }
        if (method == "notes.agora.acquireEditor") {
            val acquired = NotesEditorOwners.acquire(args.getString("notebookId"), requireNotNull(fragment.activity))
            return JSONObject().put("acquired", acquired).toString()
        }
        if (method == "notes.agora.focusEditor") {
            val owner = NotesEditorOwners.owner(args.getString("notebookId"))
            owner?.runOnUiThread {
                if (!owner.isFinishing && !owner.isDestroyed) owner.startActivity(Intent(owner.intent).apply {
                    flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                })
            }
            return JSONObject().put("focused", owner != null).toString()
        }
        if (method == "notes.agora.releaseEditor") {
            NotesEditorOwners.release(args.getString("notebookId"), fragment.activity)
            return "{}"
        }
        if (method == "notes.agora.consumeReturn") {
            if (navigation.getString("returnNotebook",null) == args.optString("notebookId"))
                navigation.edit().remove("returnNotebook").commit()
            return "{}"
        }
        if (method == "notes.agora.resumeEditor") {
            val active = AgoraDocumentActivity.current.get()
            val id = args.getString("notebookId")
            if (active != null && !active.isFinishing && active.pending.optString("notebookId") == id) {
                active.runOnUiThread {
                    active.startActivity(Intent(active.intent).apply {
                        flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    })
                }
                return JSONObject().put("resumed", true).toString()
            }
            return JSONObject().put("resumed", false).toString()
        }
        if(method=="notes.ai.backgroundReplay")return NotesBackgroundProcessing(fragment.requireContext().applicationContext).replay(args.getString("notebookId")).toString()
        if(method=="notes.ai.backgroundResult")return NotesBackgroundProcessing(fragment.requireContext().applicationContext).result(args.getString("notebookId")).toString()
        if(method=="notes.ai.backgroundConsumed")return NotesBackgroundProcessing(fragment.requireContext().applicationContext).consumed(args.getString("requestId")).toString()
        if (method == "notes.agora.returnPreparedMany") {
            val tokens = args.getJSONArray("tokens")
            require(tokens.length() in 1..32)
            val values = (0 until tokens.length()).map { requireNotNull(prepared[tokens.getString(it)]) { "A prepared note is unavailable. Please try again." } }
            require(values.map { it.second.getString("documentId") }.distinct().size == values.size)
            require(values.sumOf { it.first.length() } <= 100L * 1024 * 1024) { "Selected notes exceed 100 MiB. Attach a smaller group." }
            val host = requireNotNull(fragment.activity as? AgoraDocumentActivity)
            require(host.pending.optString("operation") == "pick")
            host.runOnUiThread { if (!released.get()) host.returnDocuments(values) }
            return "{}"
        }
        if (method == "notes.agora.openPrepared") {
            val request = UUID.randomUUID().toString()
            val token = args.getString("token")
            val (file, manifest) = requireNotNull(prepared[token]) { "Prepared note is unavailable; try attaching again" }
            requireNotNull(fragment.activity).runOnUiThread {
                if (!released.get()) try {
                    if (args.optBoolean("resumeNotebook")) {
                        val id = repo.notebook(manifest.getString("documentId"))
                        check(navigation.edit().putString("returnNotebook",id).commit()) { "Could not save the editor return route" }
                    }
                    launchAgora(file, manifest)
                    prepared.remove(token)
                    emit(JSONObject().put("id",request).put("type","result").put("value",manifest))
                } catch (error: Exception) {
                    emit(JSONObject().put("id",request).put("type","error").put("message","Agora could not be opened. Your note is saved; try again."))
                }
            }
            return JSONObject().put("reqId", request).toString()
        }
        if (method == "notes.agora.cancel" || method == "notes.agora.busy") {
            fragment.activity?.runOnUiThread {
                val host = fragment.activity as? AgoraDocumentActivity
                if (method == "notes.agora.cancel") host?.cancelSession()
                else host?.setSessionBusy(args.optBoolean("busy"))
            }
            return "{}"
        }

        if (method == "notes.agora.select") {
            val id = args.getString("notebookId")
            repo.inspect(id) // Validate the selected local note, never trust an arbitrary path.
            val host = requireNotNull(fragment.activity as? AgoraDocumentActivity)
            host.runOnUiThread { host.selectNotebook(id) }
            return "{}"
        }
        require(method in setOf("notes.agora.previewCache","notes.agora.prepare","notes.agora.inspect","notes.agora.revisionSnapshot","notes.ai.processImage","notes.agora.export","notes.agora.apply","notes.agora.undo","notes.agora.original"))
        val request=UUID.randomUUID().toString()
        executor.execute {
            val operationStarted=android.os.SystemClock.elapsedRealtime()
            try {
                if(released.get())return@execute
                val id=args.getString("notebookId")
                val result=when(method){
                    "notes.ai.processImage"->{
                        val encoded=args.getString("image")
                        require(encoded.startsWith("data:image/jpeg;base64,") && encoded.length<=2_000_024) { "Invalid page JPEG" }
                        val image=android.util.Base64.decode(encoded.substringAfter(','),android.util.Base64.DEFAULT)
                        NotesBackgroundProcessing(fragment.requireContext().applicationContext).processImage(id,args.getString("pageId"),image,args.getString("expectedRevisionId"))
                    }
                    "notes.agora.previewCache"->{val ids=args.getJSONArray("pageIds");repo.previewCache(id,args.getString("revisionId"),args.getString("signature"),(0 until ids.length()).map{ids.getString(it)}.toSet(),args.optJSONObject("previews")?:JSONObject(),args.optJSONObject("frames")?:JSONObject())}
                    "notes.agora.prepare"->repo.prepare(id,args.getJSONObject("proposal"))
                    "notes.agora.inspect"->repo.inspect(id,args.optString("proposalId").takeIf{it.isNotBlank()})
                    "notes.agora.revisionSnapshot"->repo.revisionSnapshot(id)
                    "notes.agora.original"->repo.original(id).second
                    "notes.agora.undo"->repo.undo(id,args.getString("expectedRevisionId"))
                    "notes.agora.apply"->repo.apply(id,args.getJSONObject("proposal"),args.getJSONArray("sheets"))
                    else->{
                        val host = fragment.activity as? AgoraDocumentActivity
                        if (host != null && args.optBoolean("prepareOnly")) {
                            repo.origin(id, host.callingPackage, host.intent.getStringExtra("ownerId"))
                        }
                        val selected=args.getJSONArray("pageIds");val ids=(0 until selected.length()).map{selected.getString(it)}.toSet()
                        val (file,manifest)=repo.export(id,ids,args.optJSONObject("previews")?:JSONObject(),args.optJSONArray("transcripts")?:JSONArray(),args.optString("instruction","Organize"),args.optString("displayPreview").takeIf{it.isNotBlank()},args.optString("expectedRevisionId").takeIf{it.isNotBlank()},args.optJSONObject("previewFrames")?:JSONObject())
                        requireNotNull(fragment.activity){"Editor was closed"}.runOnUiThread {
                            if(!released.get()){
                                val activity=fragment.activity
                                if(activity is AgoraDocumentActivity && !args.optBoolean("prepareOnly")){activity.returnDocument(file,manifest);emit(JSONObject().put("id",request).put("type","result").put("value",manifest))}
                                else if(activity!=null){
                                    if (args.optBoolean("prepareOnly")) {
                                        prepared[request] = file to manifest
                                        emit(JSONObject().put("id", request).put("type", "result")
                                            .put("value", JSONObject().put("token", request)))
                                    } else {
                                        try { launchAgora(file, manifest); emit(JSONObject().put("id",request).put("type","result").put("value",manifest)) }
                                        catch(e:Exception) { emit(JSONObject().put("id",request).put("type","error").put("message",e.message?:"Agora is unavailable")) }
                                    }
                                }
                            }
                        }
                        JSONObject().put("documentId",manifest.getString("documentId")).put("revisionId",manifest.getString("revisionId"))
                    }
                }
                if(!released.get()&&method!="notes.agora.export"){if(method=="notes.agora.apply")fragment.activity?.runOnUiThread{(fragment.activity as? AgoraDocumentActivity)?.accepted(result.optString("notebookId",id))};emit(JSONObject().put("id",request).put("type","result").put("value",result))}
            }catch(e:Exception){if(!released.get())emit(JSONObject().put("id",request).put("type","error").put("message",e.message?:"Document operation failed"))}
            finally { android.util.Log.i("NotesPrepare",method+" ms="+(android.os.SystemClock.elapsedRealtime()-operationStarted)) }
        }
        return JSONObject().put("reqId",request).toString()
    }
    private fun launchAgora(file: java.io.File, manifest: JSONObject) {
        val activity = requireNotNull(fragment.activity)
        val origin = manifest.optJSONObject("origin")
        val pkg = origin?.optString("originPackage")?.takeIf { it in setOf("com.newoether.agora", "com.newoether.agora.einkpreview") } ?: "com.newoether.agora.einkpreview"
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.agora-documents", file)
        activity.startActivity(Intent("com.kalamos.notes.action.ATTACH_DOCUMENT").setPackage(pkg).setDataAndType(uri, NotesDocumentBundle.MIME).apply {
            clipData = ClipData.newRawUri("Notes document", uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra("ownerId", origin?.optString("ownerId"))
        })
    }
    fun release(){released.set(true);prepared.clear();NotesEditorOwners.release(fragment.activity)}
    companion object{private val executor=Executors.newSingleThreadExecutor()}
}
