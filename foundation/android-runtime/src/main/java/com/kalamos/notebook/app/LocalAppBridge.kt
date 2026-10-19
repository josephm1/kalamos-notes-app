package com.kalamos.notebook.app

import android.content.Context
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import com.kalamos.notebook.hwr.HwrEngines
import com.kalamos.notebook.hwr.Recognizer
import org.json.JSONArray
import org.json.JSONObject

/** Local device status, handwriting recognition and the batched native event channel. */
open class LocalAppBridge(
    protected val context: Context,
    private val webView: WebView
) : com.kalamos.notebook.bridge.AppBridgeDelegate {
    private val main = Handler(Looper.getMainLooper())
    protected open val recognizer: Recognizer = HwrEngines.create(context, ::emit)

    // ---- event channel: native → JS, batched per main-loop turn, ~256KB cap per call ----
    private val queue = ArrayList<JSONObject>()
    private var flushPosted = false

    fun emit(event: JSONObject) {
        synchronized(queue) {
            queue.add(event)
            if (!flushPosted) {
                flushPosted = true
                main.post { flush() }
            }
        }
    }

    private fun flush() {
        val batch: List<JSONObject>
        synchronized(queue) {
            batch = ArrayList(queue)
            queue.clear()
            flushPosted = false
        }
        if (batch.isEmpty()) return
        var arr = JSONArray()
        var size = 0
        fun send() {
            if (arr.length() == 0) return
            val payload = JSONObject.quote(arr.toString())
            webView.evaluateJavascript("window.onAppEvent && window.onAppEvent($payload)", null)
            arr = JSONArray(); size = 0
        }
        for (ev in batch) {
            val s = ev.toString()
            if (size + s.length > 256_000 && arr.length() > 0) send()
            arr.put(ev); size += s.length
        }
        send()
    }

    // ---- dispatch ----
    override fun call(method: String, argsJson: String): String {
        val args = try { JSONObject(argsJson) } catch (e: Exception) { JSONObject() }
        return try {
            when (method) {
                "sys.info" -> JSONObject()
                    .put("online", isOnline())
                    .put("version", 1)
                    .put("hwr", recognizer.statusSync(args.optString("lang", "en-US")))
                    .toString()

                "hwr.status" -> JSONObject().put("state", recognizer.statusSync(args.optString("lang", "en-US"))).toString()
                "hwr.download" -> recognizer.download(args.optString("lang", "en-US"))
                "hwr.recognize" -> recognizer.recognize(args)

                else -> other(method, args) ?: JSONObject().put("err", "unknown-method:$method").toString()
            }
        } catch (e: Exception) {
            JSONObject().put("err", e.message ?: e.javaClass.simpleName).toString()
        }
    }

    /** Subclass hook for app-specific methods; return null when unhandled. */
    protected open fun other(method: String, args: JSONObject): String? = null

    private fun isOnline(): Boolean = try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.activeNetwork != null
    } catch (e: Exception) { false }

}
