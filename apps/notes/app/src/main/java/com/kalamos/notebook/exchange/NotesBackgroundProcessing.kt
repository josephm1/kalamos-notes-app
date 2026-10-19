package com.kalamos.notebook.exchange

import android.content.Context
import android.util.AtomicFile
import com.kalamos.foundation.documents.NotesDocumentBundle as Bundle
import com.kalamos.notebook.ai.NotesAiFormatter
import com.kalamos.notebook.ai.NotesAiSettings
import com.kalamos.notebook.ai.NotesFormattingWorker
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Notes owns the job and receipt; only the editor may validate/materialize and commit a result. */
class NotesBackgroundProcessing(private val context: Context,
    private val enqueue: (String) -> Unit = { NotesFormattingWorker.enqueue(context, it) },
    private val provider: () -> NotesAiSettings.Provider = { NotesAiSettings(context).provider() }) {
    private val root = File(context.filesDir, "notes-background").apply { mkdirs() }
    private fun file(id: String) = File(root, "${UUID.fromString(id)}.json")
    private fun read(id: String) = AtomicFile(file(id)).openRead().bufferedReader().use { JSONObject(it.readText()) }
    private fun records() = root.listFiles()?.filter { it.name.endsWith(".json") || it.name.endsWith(".json.bak") }
        ?.map { it.name.removeSuffix(".bak").removeSuffix(".json") }?.distinct()
        ?.mapNotNull { runCatching { read(it) }.getOrNull() } ?: emptyList()
    private fun write(value: JSONObject) {
        val atomic = AtomicFile(file(value.getString("requestId")))
        val stream = atomic.startWrite()
        try { stream.write(value.toString().toByteArray()); atomic.finishWrite(stream) }
        catch (error: Exception) { atomic.failWrite(stream); throw error }
    }
    private fun latest(notebookId: String, unconsumed: Boolean = true) = records().filter {
        it.optString("notebookId") == notebookId && (!unconsumed || !it.optBoolean("consumed"))
    }.maxByOrNull { it.optLong("createdAt") }
    private fun publicResult(record: JSONObject) = JSONObject().apply {
        for (key in listOf("requestId", "createdAt", "proposal", "error", "pending")) if (record.has(key)) put(key, record.get(key))
    }
    /** Retire old pending external handoffs; ready results remain available for normal validation. */
    private fun localRecord(record: JSONObject): JSONObject {
        if ((record.has("agoraPackage") || !record.has("imageContext")) && record.optBoolean("pending")) {
            record.put("pending", false).put("state", "error").put("error", "The previous formatting request needs to be prepared again. Start Format with AI in Notes.")
            record.remove("agoraPackage"); write(record)
        }
        return record
    }
    fun processImage(notebookId: String, pageId:String, image:ByteArray, expectedRevision:String): JSONObject = synchronized(lock) {
        require(image.size in 1..1_500_000) { "Page image is unavailable or too large" }
        val manifest=AgoraDocuments(context).prepareImage(notebookId,pageId,expectedRevision)
        latest(notebookId)?.let {
            val existing = localRecord(it)
            require(existing.getString("baseRevisionId") == manifest.getString("revisionId")) { "A previous formatting result is still pending for this note" }
            return@synchronized publicResult(existing)
        }
        val config = provider()
        val requestId = UUID.randomUUID().toString()
        val retained = AtomicFile(File(root, "$requestId.jpg"))
        val imageStream=retained.startWrite()
        try { imageStream.write(image);retained.finishWrite(imageStream) } catch(error:Exception){retained.failWrite(imageStream);throw error}
        val record = JSONObject().put("requestId", requestId).put("notebookId", notebookId)
            .put("documentId", manifest.getString("documentId")).put("baseRevisionId", manifest.getString("revisionId"))
            .put("createdAt", System.currentTimeMillis()).put("pending", true).put("state", "queued")
            .put("imageContext",manifest).put("providerUrl", config.baseUrl).put("model", config.model).put("thinking", config.thinking)
        write(record)
        try { enqueue(requestId) } catch (_: Exception) {
            record.put("pending", false).put("state", "error").put("error", "Could not start AI formatting. Try again."); write(record)
        }
        publicResult(record)
    }
    /** WorkManager may redeliver a killed worker. Never repeat a possibly charged model request. */
    fun execute(requestId: String, format: ((File) -> JSONObject)? = null): Boolean {
        val record = synchronized(lock) {
            val saved = file(requestId)
            if (!saved.exists() && !File(saved.path + ".bak").exists()) return false
            val value = localRecord(read(requestId))
            if (!value.optBoolean("pending") || value.optBoolean("consumed")) return true
            if (value.optString("state") != "queued") {
                value.put("pending", false).put("state", "error").put("error", "AI formatting was interrupted. Start again to make a new request."); write(value)
                return false
            }
            value.put("state", "running"); write(value); value
        }
        try {
            val formatter = format ?: run {
                val config = provider()
                check(config.baseUrl == record.getString("providerUrl") && config.model == record.getString("model") && config.thinking == record.optString("thinking", "default")) { "AI settings changed. Start formatting again." }
                val engine = NotesAiFormatter(config)
                val invoke: (File) -> JSONObject = { source -> engine.format(source,record.getJSONObject("imageContext")) }
                invoke
            }
            val proposal = Bundle.proposalEnvelope(formatter(File(root, "$requestId.jpg")).put("backgroundRequestId", requestId))
            require(proposal.getString("documentId") == record.getString("documentId") && proposal.getString("baseRevisionId") == record.getString("baseRevisionId")) { "AI result belongs to another note revision" }
            return synchronized(lock) {
                val current = read(requestId)
                if (!current.optBoolean("pending") || current.optBoolean("consumed") || current.optString("state") != "running") false
                else { current.put("proposal", proposal).put("state", "done").put("pending", false); write(current); true }
            }
        } catch (error: Exception) {
            synchronized(lock) {
                val current = read(requestId)
                if (!current.optBoolean("pending") || current.optBoolean("consumed")) return false
                current.put("state", "error").put("pending", false).put("error", when(error) {
                    is java.io.IOException -> "Could not reach the AI provider. Check your connection and Notes AI settings."
                    else -> error.message?.take(1000) ?: "AI formatting failed. Your saved note is unchanged."
                }); write(current)
            }
            return false
        }
    }
    fun result(notebookId: String): JSONObject = synchronized(lock) {
        latest(notebookId)?.let { publicResult(localRecord(it)) } ?: JSONObject().put("pending", false)
    }
    /** Reattach queued local work; a running/done request never starts a second provider call. */
    fun replay(notebookId: String): JSONObject = synchronized(lock) {
        val record = latest(notebookId)?.let(::localRecord) ?: return@synchronized JSONObject().put("pending", false)
        if (record.optString("state") == "queued" && record.optBoolean("pending")) enqueue(record.getString("requestId"))
        publicResult(record)
    }
    fun consumed(requestId: String): JSONObject = synchronized(lock) {
        require(file(requestId).isFile || File(file(requestId).path + ".bak").isFile) { "Formatting request is unavailable" }
        val record = read(requestId)
        require(!record.optBoolean("pending")) { "Formatting is still running" }
        record.put("consumed", true); record.remove("proposal"); write(record)
        File(root, "$requestId.jpg").delete()
        File(root, "$requestId.zip").delete()
        JSONObject().put("consumed", true)
    }
    fun processingDiagnostic(notebookId: String, requestId: String?, stage: String, message: String?): JSONObject = synchronized(lock) {
        require(Regex("[a-zA-Z0-9_-]{1,60}").matches(stage))
        val record = latest(notebookId, false)?.takeIf { requestId.isNullOrBlank() || it.optString("requestId") == requestId } ?: return@synchronized JSONObject()
        val diagnostic = JSONObject().put("stage", stage).put("updatedAt", System.currentTimeMillis())
        message?.takeIf { it.isNotBlank() }?.let { diagnostic.put("message", it.take(1000)) }
        // Keep the failed result available to an explicit diagnostic read after consumption.
        // It is never replayed, added to prompts, or exposed in ordinary job status.
        if(stage=="error")record.optJSONObject("proposal")?.optString("markdown")?.takeIf{it.isNotBlank()&&it.length<=70000}?.let{record.put("failedMarkdown",it)}
        val history = record.optJSONArray("processingHistory") ?: JSONArray()
        history.put(diagnostic); while (history.length() > 12) history.remove(0)
        record.put("processingDiagnostic", diagnostic).put("processingHistory", history); write(record); diagnostic
    }
    fun diagnostics(notebookId: String, requestId: String? = null, history: Boolean = false, includeResult: Boolean = false): Any = synchronized(lock) {
        val record = latest(notebookId, false)?.takeIf { requestId.isNullOrBlank() || it.optString("requestId") == requestId }
        if (history) return@synchronized record?.optJSONArray("processingHistory") ?: JSONArray()
        JSONObject().apply { if (record != null) {
            for (key in listOf("requestId", "notebookId", "documentId", "baseRevisionId", "createdAt", "pending", "consumed", "state", "error", "processingDiagnostic")) if (record.has(key)) put(key, record.get(key))
            if (includeResult && record.has("proposal")) put("proposal", record.get("proposal"))
            if (includeResult && record.has("failedMarkdown")) put("failedMarkdown", record.get("failedMarkdown"))
        } }
    }
    companion object { private val lock = Any() }
}
