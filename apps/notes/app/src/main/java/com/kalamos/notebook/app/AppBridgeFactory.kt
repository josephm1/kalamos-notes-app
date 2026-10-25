package com.kalamos.notebook.app

import android.webkit.WebView
import androidx.fragment.app.Fragment
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import com.kalamos.notebook.storage.StorageConfig

object AppBridgeFactory {
    @JvmStatic fun create(fragment: Fragment, webView: WebView):
        com.kalamos.notebook.bridge.AppBridgeDelegate {
        // Notes owns long-press gestures; Android's WebView selection action mode must not
        // select notebook titles or appear when a pen rests on the writing surface.
        suppressNotesWebViewLongPress(webView)
        return NotesBridge(fragment, webView)
    }
}

internal fun suppressNotesWebViewLongPress(webView: WebView) {
    webView.setOnLongClickListener { true }
}

private class NotesBridge(private val fragment: Fragment, webView: WebView) :
    LocalAppBridge(fragment.requireContext().applicationContext, webView) {
    private val agora = com.kalamos.notebook.exchange.AgoraBridge(fragment, ::emit)
    private val models = com.kalamos.notebook.ai.NotesAiModels(com.kalamos.notebook.ai.NotesAiSettings(context), ::emit)
    private val attachments=com.kalamos.notebook.attachments.NotesAttachments(fragment, ::emit)
    private val sharing=com.kalamos.notebook.sharing.NotesImageShare(context)
    override fun onRelease() { attachments.release();sharing.release();models.release(); agora.release() }
    override fun other(method: String, args: JSONObject): String? = when (method) {
        "notes.import.pending" -> com.kalamos.notebook.sharing.MarkdownImport.pending(context,fragment.requireActivity().intent).toString()
        "notes.import.ack" -> {
            com.kalamos.notebook.sharing.MarkdownImport.acknowledge(context,fragment.requireActivity().intent,args.getString("requestId"));"{}"
        }
        "notes.share.markdown" -> {
            val intent=com.kalamos.notebook.sharing.NotesMarkdownShare.intent(args.optString("title","Notebook"),args.getString("text"))
            val activity=requireNotNull(fragment.activity){"Notes was closed"}
            activity.runOnUiThread{activity.startActivity(intent)}
            "{}"
        }
        "notes.share.begin" -> sharing.begin(args.getString("title"),args.getInt("count")).toString()
        "notes.share.add" -> sharing.add(args.getString("token"),args.getInt("index"),args.getString("image")).toString()
        "notes.share.cancel" -> {sharing.cancel(args.getString("token"));"{}"}
        "notes.share.open" -> {
            val intent=sharing.intent(args.getString("token"))
            val activity=requireNotNull(fragment.activity){"Notes was closed"}
            activity.runOnUiThread{activity.startActivity(intent)}
            "{}"
        }
        "notes.ai.models" -> models.load(args)
        "notes.ai.chatgpt" -> {
            val activity=fragment.requireActivity()
            activity.runOnUiThread { activity.startActivity(android.content.Intent(activity,com.kalamos.notebook.auth.ChatGptActivity::class.java)) }
            "{}"
        }
        "notes.ai.billing" -> {
            com.kalamos.notebook.auth.ChatGptPlan.initialize(fragment.requireContext())
            com.kalamos.notebook.auth.ChatGptPlan.setEnabled(args.optBoolean("plan"))
            com.kalamos.notebook.ai.NotesAiSettings(fragment.requireContext()).status().toString()
        }
        "notes.ai.settings" -> com.kalamos.notebook.ai.NotesAiSettings(fragment.requireContext()).status().toString()
        "notes.ai.configure" -> com.kalamos.notebook.ai.NotesAiSettings(fragment.requireContext()).save(args).toString()
        "notes.templates.list" -> {
            // Notes-owned, public, data-only starters. Keep flat/capped reads off the ink path.
            val directory = File(StorageConfig.PUBLIC_ROOT, "notes/templates/custom")
            directory.mkdirs()
            val entries=JSONArray()
            directory.listFiles()?.filter { it.isFile && it.extension.equals("json", true) &&
                it.name.matches(Regex("[\\w .-]+\\.json", RegexOption.IGNORE_CASE)) &&
                it.canonicalFile.parentFile == directory.canonicalFile && it.length() <= 1024*1024 }
                ?.sortedBy { it.name }?.take(64)?.forEach { file ->
                    runCatching { entries.put(JSONObject().put("filename",file.name)
                        .put("template",JSONObject(file.readText()))) }
                }
            JSONObject().put("templates",entries).put("path",directory.absolutePath).toString()
        }
        else -> attachments.call(method, args) ?: agora.call(method, args)
    }
}
