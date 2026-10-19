package com.kalamos.notebook.app.net

import com.kalamos.notebook.app.Secrets
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * One-shot and streaming HTTP for the AI adapters. Streaming reads the body on OkHttp's
 * background thread and emits text chunks batched every ~350ms (e-ink friendly), as:
 *   {id, kind:'http', type:'open'|'chunk'|'end'|'error', ...}
 * Header values may carry {{secret:NAME}} placeholders — substituted here, never in JS.
 */
class HttpStreamer(
    private val secrets: Secrets,
    private val emit: (JSONObject) -> Unit
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)   // model streams can idle between tokens
        // UrlPolicy (AFK-S2): no redirect following — a cross-host redirect or an HTTPS→HTTP
        // downgrade must surface as a visible 3xx failure, never be silently chased.
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    private val seq = AtomicLong(1)
    private val live = ConcurrentHashMap<String, Call>()

    companion object {
        // Bound on a one-shot response body (error bodies included) — a misbehaving or
        // malicious endpoint can't balloon the WebView bridge with an unbounded string.
        private const val MAX_ONESHOT_BODY = 2L * 1024 * 1024
        private const val MAX_IMAGE_BODY = 14L * 1024 * 1024
    }

    private fun ev(id: String, type: String) =
        JSONObject().put("id", id).put("kind", "http").put("type", type)

    private fun build(args: JSONObject, reqId: String): Request? {
        val verdict = UrlPolicy.checkHttp(args.optString("url"))
        if (!verdict.ok) {
            emit(ev(reqId, "error").put("code", "policy")
                .put("message", "Destination not allowed (" + (verdict.reason ?: "invalid") + ")"))
            return null
        }
        val builder = Request.Builder().url(args.getString("url"))
        val headers = args.optJSONObject("headers") ?: JSONObject()
        for (key in headers.keys()) {
            if (key.lowercase() in UrlPolicy.forbiddenHeaders) continue   // native owns these
            val sub = secrets.substitute(headers.getString(key))
            if (sub == null) {
                emit(ev(reqId, "error").put("code", "no-key")
                    .put("message", "A required API key is not set — add it in Settings"))
                return null
            }
            builder.header(key, sub)
        }
        val method = args.optString("method", "GET").uppercase()
        val body = if (args.has("body"))
            args.getString("body").toRequestBody(
                (headers.optString("content-type").ifEmpty { "application/json" }).toMediaType())
        else null
        builder.method(method, if (method == "GET" || method == "HEAD") null else body)
        return builder.build()
    }

    /** One-shot request → single 'response' event then 'end'. Returns {reqId}. */
    fun request(args: JSONObject): String {
        val reqId = "h" + seq.getAndIncrement()
        val req = build(args, reqId) ?: return JSONObject().put("reqId", reqId).toString()
        // A caller with a job deadline may allow a long one-shot model response.
        // Keep this neutral transport bounded; streaming retains its idle policy.
        val requestClient = if (args.has("timeoutMs")) {
            val timeoutMs = args.optLong("timeoutMs", 180_000L).coerceIn(1_000L, 720_000L)
            client.newBuilder()
                .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build()
        } else client
        val call = requestClient.newCall(req)
        live[reqId] = call
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                live.remove(reqId)
                emit(ev(reqId, "error").put("code", "net")
                    .put("message", UrlPolicy.redact(e.message ?: "network error")))
            }
            override fun onResponse(call: Call, response: Response) {
                live.remove(reqId)
                response.use {
                    val limit = if (req.url.host == "openrouter.ai" && req.url.encodedPath == "/api/v1/images") MAX_IMAGE_BODY else MAX_ONESHOT_BODY
                    val bytes = it.peekBody(limit + 1).bytes()
                    if (bytes.size > limit) emit(ev(reqId, "error").put("code", "too-large").put("message", "Provider response is too large"))
                    else emit(ev(reqId, "response").put("status", it.code).put("body", String(bytes, Charsets.UTF_8)))
                    emit(ev(reqId, "end"))
                }
            }
        })
        return JSONObject().put("reqId", reqId).toString()
    }

    /** Streaming request → open / chunk (batched ~350ms) / end | error. Returns {reqId}. */
    fun stream(args: JSONObject): String {
        val reqId = "s" + seq.getAndIncrement()
        val req = build(args, reqId) ?: return JSONObject().put("reqId", reqId).toString()
        val call = client.newCall(req)
        live[reqId] = call
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                live.remove(reqId)
                if (call.isCanceled()) emit(ev(reqId, "end").put("cancelled", true))
                else emit(ev(reqId, "error").put("code", "net")
                    .put("message", UrlPolicy.redact(e.message ?: "network error")))
            }
            override fun onResponse(call: Call, response: Response) {
                emit(ev(reqId, "open").put("status", response.code))
                val buf = StringBuilder()
                var lastFlush = System.currentTimeMillis()
                fun flushChunk(force: Boolean) {
                    val now = System.currentTimeMillis()
                    if (buf.isEmpty()) return
                    if (!force && now - lastFlush < 350) return
                    emit(ev(reqId, "chunk").put("data", buf.toString()))
                    buf.setLength(0); lastFlush = now
                }
                try {
                    response.use { resp ->
                        val source = resp.body?.source() ?: throw IOException("empty body")
                        val carry = okio.Buffer()
                        while (true) {
                            val n = source.read(carry, 8 * 1024)
                            if (n < 0) break
                            buf.append(readCompleteUtf8(carry))
                            flushChunk(false)
                        }
                        buf.append(carry.readUtf8())   // EOF: drain whatever remains
                        flushChunk(true)
                        emit(ev(reqId, "end"))
                    }
                } catch (e: IOException) {
                    flushChunk(true)
                    if (call.isCanceled()) emit(ev(reqId, "end").put("cancelled", true))
                    else emit(ev(reqId, "error").put("code", "net")
                        .put("message", UrlPolicy.redact(e.message ?: "stream error")))
                } finally {
                    live.remove(reqId)
                }
            }
        })
        return JSONObject().put("reqId", reqId).toString()
    }

    /** Read all complete UTF-8 from [buffer], leaving a trailing partial character for the
     *  next network read (streamed token text is multi-byte-safe across chunk boundaries). */
    private fun readCompleteUtf8(buffer: okio.Buffer): String {
        val size = buffer.size
        if (size == 0L) return ""
        var cut = size
        var back = 0L
        while (back < 4 && back < size) {
            val b = buffer[size - 1 - back].toInt() and 0xFF
            if (b < 0x80) break                       // ASCII tail — everything complete
            if (b >= 0xC0) {                          // start of a multi-byte char
                val need = if (b >= 0xF0) 4 else if (b >= 0xE0) 3 else 2
                if (back + 1 < need) cut = size - 1 - back
                break
            }
            back++                                    // continuation byte — keep scanning
        }
        return buffer.readUtf8(cut)
    }

    fun cancel(reqId: String): String {
        live.remove(reqId)?.cancel()
        return """{"ok":true}"""
    }

    fun cancelAll() {
        for ((_, call) in live) call.cancel()
        live.clear()
    }
}
