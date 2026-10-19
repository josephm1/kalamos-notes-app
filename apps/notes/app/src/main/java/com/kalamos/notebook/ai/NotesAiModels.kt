package com.kalamos.notebook.ai

import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Read-only provider catalogue. No settings writes, model generation or document access. */
class NotesAiModels(private val settings: NotesAiSettings, private val emit: (JSONObject) -> Unit) {
    private val released = AtomicBoolean(false)
    private var active: Call? = null
    @Synchronized fun load(input: JSONObject): String {
        check(!released.get()) { "AI settings were closed" }
        val request = request(settings.modelProvider(input))
        val id = UUID.randomUUID().toString()
        active?.cancel()
        val call = client.newCall(request); active = call
        fun result(type: String, key: String, value: Any) {
            if (!released.get()) emit(JSONObject().put("id", id).put("type", type).put(key, value))
            synchronized(this) { if (active === call) active = null }
        }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, error: IOException) {
                result("error", "message", if (call.isCanceled()) "Model refresh cancelled" else "Could not load models. Check your connection, base URL and API key, or enter a model ID manually.")
            }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        result("error", "message", "Model list returned HTTP ${it.code}. Check the base URL and key, or enter a model ID manually.")
                        return
                    }
                    try {
                        val input = requireNotNull(it.body).byteStream()
                        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                        while (true) { val n = input.read(buffer); if (n < 0) break; require(output.size() + n <= 8_000_000); output.write(buffer, 0, n) }
                        result("result", "value", parse(output.toString("UTF-8")))
                    } catch (_: Exception) {
                        result("error", "message", "This provider did not return a supported model list. Enter a model ID manually.")
                    }
                }
            }
        })
        return JSONObject().put("reqId", id).toString()
    }
    @Synchronized fun release() { released.set(true); active?.cancel(); active = null }
    companion object {
        private val client = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
        internal fun request(provider: NotesAiSettings.Provider): Request = Request.Builder()
            .url(provider.baseUrl.trimEnd('/') + "/models").header("Authorization", "Bearer ${provider.key}")
            .header("Accept", "application/json").get().build()
        internal fun parse(body: String): JSONObject {
            val response = JSONObject(body)
            val rows = response.getJSONArray("data")
            require(rows.length() <= 10000)
            val models = linkedMapOf<String, JSONObject>()
            for (i in 0 until rows.length()) {
                val raw = rows.optJSONObject(i) ?: continue
                val id = (raw.opt("id") as? String)?.trim() ?: continue
                if (id.isBlank() || id.length > 200 || id.any { it.isISOControl() }) continue
                val architecture = raw.optJSONObject("architecture")
                val outputs = architecture?.optJSONArray("output_modalities")
                if (outputs != null && outputs.length() > 0 && (0 until outputs.length()).none { outputs.optString(it) == "text" }) continue
                val name = (raw.opt("name") as? String)?.trim()?.take(120)?.takeIf { it.isNotBlank() && it.none(Char::isISOControl) } ?: id
                val model = JSONObject().put("id", id).put("name", name)
                val inputs = architecture?.optJSONArray("input_modalities") ?: raw.optJSONArray("input_modalities")
                if (inputs != null && inputs.length() > 0) model.put("vision", (0 until inputs.length()).any { inputs.optString(it) == "image" })
                models.putIfAbsent(id, model)
            }
            val items = JSONArray(); var bytes = 0; var truncated = response.optBoolean("has_more")
            for (model in models.toSortedMap().values) {
                val size = model.toString().toByteArray().size
                if (items.length() >= 2000 || bytes + size > 180000) { truncated = true; break }
                items.put(model); bytes += size
            }
            require(items.length() > 0) { "No usable models were returned" }
            return JSONObject().put("models", items).put("truncated", truncated)
        }
    }
}
