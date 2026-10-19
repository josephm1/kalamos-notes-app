package com.kalamos.notebook.app

import android.content.Context
import android.webkit.WebView
import com.kalamos.notebook.app.net.HttpStreamer
import com.kalamos.notebook.app.net.WsClient
import com.kalamos.foundation.documents.KalamosAiConfig
import org.json.JSONObject

/** Shared AI/network services for hosts that need them, layered on the local HWR bridge. */
open class CoreAppBridge(context: Context, webView: WebView) : LocalAppBridge(context, webView) {
    protected val secrets = Secrets(context)
    protected val http = HttpStreamer(secrets, ::emit)
    protected val ws = WsClient(secrets, ::emit)

    override fun call(method: String, argsJson: String): String {
        val args = try { JSONObject(argsJson) } catch (e: Exception) { JSONObject() }
        return try {
            when (method) {
                "secret.set" -> { secrets.set(args.getString("key"), args.getString("value")); OK }
                "secret.has" -> JSONObject().put("has", secrets.has(args.getString("key"))).toString()
                "secret.clear" -> { secrets.clear(args.getString("key")); OK }

                "ai.config.get" -> KalamosAiConfig.publicStatus().toString()

                "http.request" -> http.request(args)
                "http.stream" -> http.stream(args)
                "http.cancel" -> http.cancel(args.optString("reqId"))

                "ws.open" -> ws.open(args)
                "ws.send" -> ws.send(args)
                "ws.close" -> ws.close(args.optString("sockId"))

                else -> super.call(method, argsJson)
            }
        } catch (e: Exception) {
            JSONObject().put("err", e.message ?: e.javaClass.simpleName).toString()
        }
    }

    override fun onRelease() {
        http.cancelAll()
        ws.closeAll()
    }

    companion object { const val OK = """{"ok":true}""" }
}

/**
 * Default factory, used by AppFragment when the app ships no AppBridgeFactory of its own.
 * (A separate class name avoids an FQCN collision with app-owned delegates that
 * DO provide one.)
 */
object CoreAppBridgeFactory {
    @JvmStatic
    fun create(fragment: androidx.fragment.app.Fragment, webView: WebView): com.kalamos.notebook.bridge.AppBridgeDelegate =
        CoreAppBridge(fragment.requireContext().applicationContext, webView)
}
