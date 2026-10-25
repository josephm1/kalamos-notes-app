package com.kalamos.notebook.ai

import android.content.Context
import com.kalamos.notebook.auth.ChatGptPlan
import com.kalamos.notebook.auth.OpenAiHttp
import com.kalamos.notebook.app.Secrets
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject

/** Notes-owned configuration. Credential values never return to JavaScript or enter jobs/bundles. */
class NotesAiSettings(context: Context, private val secretFactory: () -> Secrets = { Secrets(context) }) {
    init { ChatGptPlan.initialize(context) }
    private val prefs = context.getSharedPreferences("notes-ai", Context.MODE_PRIVATE)
    private val secrets by lazy(secretFactory)
    data class Provider(val baseUrl: String, val model: String, val key: String, val thinking: String = DEFAULT_THINKING, val chatGptAccountId: String? = null) {
        init { require(thinking in THINKING_LEVELS) { "Invalid thinking level" } }
        val chatUrl get() = baseUrl.trimEnd('/') + "/chat/completions"
    }
    fun status(): JSONObject = JSONObject().put("baseUrl", prefs.getString("baseUrl", DEFAULT_URL))
        .put("model", prefs.getString("model", "")).put("thinking", prefs.getString("thinking", DEFAULT_THINKING)).put("hasKey", secrets.has(KEY))
        .put("configured", if(ChatGptPlan.enabled()) ChatGptPlan.configured() && !ChatGptPlan.accounts().active()?.optString("model").isNullOrBlank() else secrets.has(KEY) && !prefs.getString("model", "").isNullOrBlank())
        .put("billing",if(ChatGptPlan.enabled()) "chatgpt" else "api")
        .put("chatGptConnected",ChatGptPlan.configured())
        .put("chatGptModel",runCatching { ChatGptPlan.accounts().active()?.optString("model").orEmpty() }.getOrDefault(""))
    fun save(input: JSONObject): JSONObject {
        val url = baseUrl(input.getString("baseUrl"))
        val model = input.getString("model").trim()
        require(model.length in 1..200 && model.none { it.isISOControl() }) { "Enter a valid model ID" }
        val thinking = input.optString("thinking", prefs.getString("thinking", DEFAULT_THINKING))
        require(thinking in THINKING_LEVELS) { "Choose a valid thinking level" }
        val key = apiKey(input.optString("apiKey"))
        require(url == prefs.getString("baseUrl", DEFAULT_URL) || key.isNotBlank() ||
            input.optBoolean("clearKey") || !secrets.has(KEY)) {
            "Enter an API key for the changed provider, or clear the saved key"
        }
        if (input.optBoolean("clearKey")) secrets.clear(KEY)
        else if (key.isNotBlank()) secrets.set(KEY, key)
        check(prefs.edit().putString("baseUrl", url).putString("model", model).putString("thinking", thinking).commit()) { "Could not save AI settings" }
        return status()
    }
    /** Discover models before choosing/saving one. Never send a saved key to an edited endpoint. */
    fun modelProvider(input: JSONObject): Provider {
        val url = baseUrl(input.getString("baseUrl"))
        val entered = apiKey(input.optString("apiKey"))
        val key = if (entered.isNotBlank()) entered else {
            require(url == prefs.getString("baseUrl", DEFAULT_URL)) { "Enter an API key for the changed provider before loading models" }
            secrets.substitute("{{secret:$KEY}}")
        }
        require(!key.isNullOrBlank()) { "Enter an API key to load models" }
        return Provider(url, "", key)
    }
    private fun baseUrl(value: String): String {
        val url = value.trim().trimEnd('/').toHttpUrl()
        require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "Use an HTTPS API base URL without credentials or query parameters" }
        require(!url.encodedPath.endsWith("/chat/completions") && !url.encodedPath.endsWith("/models")) { "Enter the API base URL, without /chat/completions or /models" }
        return url.toString().trimEnd('/')
    }
    private fun apiKey(value: String): String = value.trim().also { key ->
        require(key.length <= 4096 && key.all { it.code in 33..126 }) { "Invalid API key" }
    }
    fun provider(): Provider {
        if(ChatGptPlan.enabled()) {
            check(ChatGptPlan.configured()) { "Reconnect ChatGPT and grant plan permission in Notes AI settings. No API-key fallback was used." }
            val account=checkNotNull(ChatGptPlan.accounts().active());val id=account.getString("client_id");val model=account.optString("model")
            check(model.isNotBlank()) { "Choose a ChatGPT model in Notes AI settings" }
            return Provider(OpenAiHttp.API,model,ChatGptPlan.token(id),prefs.getString("thinking",DEFAULT_THINKING) ?: DEFAULT_THINKING,id)
        }
        val status = status()
        check(status.getBoolean("configured")) { "Configure Format with AI in Notes → Library menu → AI settings" }
        val key = secrets.substitute("{{secret:$KEY}}")
        check(!key.isNullOrBlank()) { "Save your AI API key again in Notes" }
        return Provider(status.getString("baseUrl"), status.getString("model"), key, status.getString("thinking"))
    }
    companion object {
        const val DEFAULT_THINKING = "none"
        val THINKING_LEVELS = setOf("default", "none", "low", "high", "max")
        const val DEFAULT_URL = "https://openrouter.ai/api/v1"
        private const val KEY = "notes_formatter"
    }
}
