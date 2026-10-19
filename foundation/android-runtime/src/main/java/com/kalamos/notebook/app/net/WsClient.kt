package com.kalamos.notebook.app.net

import com.kalamos.notebook.app.Secrets
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * WebSocket manager for the desktop-gateway adapter. Events:
 *   {id: sockId, kind:'ws', type:'open'|'message'|'closed'|'error', ...}
 * Outgoing send() payloads may carry {{secret:NAME}} placeholders (e.g. the pairing token
 * inside the hello message) — substituted here so tokens never live in JS.
 */
class WsClient(
    private val secrets: Secrets,
    private val emit: (JSONObject) -> Unit
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val seq = AtomicLong(1)
    private val sockets = ConcurrentHashMap<String, WebSocket>()

    private fun ev(id: String, type: String) =
        JSONObject().put("id", id).put("kind", "ws").put("type", type)

    fun open(args: JSONObject): String {
        // UrlPolicy (AFK-S2): same destination rules as HTTP — wss anywhere, cleartext ws only
        // to private hosts, no credentials-in-URL. OkHttp takes ws URLs via the http scheme.
        val raw = args.optString("url")
        val verdict = UrlPolicy.checkWs(raw)
        if (!verdict.ok) {
            return JSONObject().put("err", "policy: " + (verdict.reason ?: "invalid")).toString()
        }
        val sockId = "w" + seq.getAndIncrement()
        val request = Request.Builder().url(args.getString("url")).build()
        val socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                emit(ev(sockId, "open"))
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                emit(ev(sockId, "message").put("data", text))
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                sockets.remove(sockId)
                emit(ev(sockId, "closed").put("code", code))
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                sockets.remove(sockId)
                emit(ev(sockId, "error").put("message", UrlPolicy.redact(t.message ?: "socket error")))
                emit(ev(sockId, "closed").put("code", -1))
            }
        })
        sockets[sockId] = socket
        return JSONObject().put("sockId", sockId).toString()
    }

    fun send(args: JSONObject): String {
        val socket = sockets[args.optString("sockId")]
            ?: return """{"err":"no-such-socket"}"""
        val data = secrets.substitute(args.getString("data"))
            ?: return """{"err":"no-key"}"""
        socket.send(data)
        return """{"ok":true}"""
    }

    fun close(sockId: String): String {
        sockets.remove(sockId)?.close(1000, "bye")
        return """{"ok":true}"""
    }

    fun closeAll() {
        for ((_, s) in sockets) s.close(1001, "release")
        sockets.clear()
    }
}
