package com.kalamos.foundation.documents

import android.os.Environment
import org.json.JSONObject
import java.io.File

/**
 * Shared AI-provider contract for the Kalamos ecosystem.
 *
 * Agent is the sole writer. Other apps and KOReader only read this file, so changing provider,
 * model, endpoint, or credential once changes the whole ecosystem. The personal-device contract
 * deliberately stores the credential in shared storage so the non-Android KOReader runtime can
 * consume it too.
 */
object KalamosAiConfig {
    const val SHARED_DIRECTORY = "Kalamos/AI"
    const val FILE_NAME = "providers.json"
    const val SECRET_REF = "kalamos_ai_active"
    const val IMAGE_SECRET_REF = "kalamos_ai_image"
    const val IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b"
    const val SCHEMA = "kalamos.ai-providers/v1"

    data class Provider(
        val id: String,
        val label: String,
        val baseUrl: String,
        val model: String,
        val apiKey: String,
        val authHeader: String,
        val authScheme: String,
        val extraHeaders: JSONObject,
    ) {
        val chatUrl: String get() = baseUrl.trimEnd('/') + "/chat/completions"
    }

    private val presets = linkedMapOf(
        "zai" to arrayOf("Z.AI", "https://api.z.ai/api/paas/v4", "glm-5.3-flash", "authorization", "Bearer"),
        "openrouter" to arrayOf("OpenRouter", "https://openrouter.ai/api/v1", "", "authorization", "Bearer"),
        "openai" to arrayOf("OpenAI", "https://api.openai.com/v1", "", "authorization", "Bearer"),
        // Anthropic's OpenAI-compatible endpoint lets every Kalamos client retain one envelope.
        "anthropic" to arrayOf("Claude (Anthropic)", "https://api.anthropic.com/v1", "", "x-api-key", ""),
        "deepseek" to arrayOf("DeepSeek", "https://api.deepseek.com", "deepseek-chat", "authorization", "Bearer"),
    )

    fun file(): File = File(Environment.getExternalStorageDirectory(), "$SHARED_DIRECTORY/$FILE_NAME")

    fun ensureDefault(zaiApiKey: String = ""): JSONObject {
        val current = readOrNull()
        if (current != null) {
            if (zaiApiKey.isNotBlank() && provider(current, "zai")?.apiKey.isNullOrBlank()) {
                val zai = current.getJSONObject("providers").getJSONObject("zai")
                zai.put("apiKey", zaiApiKey.trim())
                write(current)
            }
            return current
        }
        val providers = JSONObject()
        presets.forEach { (id, values) ->
            providers.put(id, JSONObject()
                .put("label", values[0]).put("baseUrl", values[1]).put("model", values[2])
                .put("apiKey", if (id == "zai") zaiApiKey.trim() else "")
                .put("authHeader", values[3]).put("authScheme", values[4])
                .put("extraHeaders", if (id == "anthropic") JSONObject().put("anthropic-version", "2023-06-01") else JSONObject()))
        }
        return JSONObject().put("schema", SCHEMA).put("revision", 1)
            .put("activeProvider", "zai").put("providers", providers).also(::write)
    }

    fun readOrNull(): JSONObject? = try {
        val target = file()
        if (!target.isFile || target.length() !in 2..MAX_BYTES) null
        else JSONObject(target.readText()).takeIf { it.optString("schema") == SCHEMA }
    } catch (_: Exception) { null }

    fun active(): Provider? {
        val config = readOrNull() ?: return null
        return provider(config, config.optString("activeProvider", "zai"))
    }

    fun publicStatus(): JSONObject {
        val config = readOrNull() ?: return JSONObject().put("configured", false).put("schema", SCHEMA)
        val id = config.optString("activeProvider", "zai")
        val active = provider(config, id)
        val available = JSONObject()
        presets.keys.forEach { providerId ->
            val item = provider(config, providerId)
            available.put(providerId, JSONObject().put("label", item?.label ?: providerId)
                .put("configured", !item?.apiKey.isNullOrBlank()).put("model", item?.model.orEmpty()))
        }
        return JSONObject().put("schema", SCHEMA).put("configured", active != null && active.apiKey.isNotBlank())
            .put("activeProvider", id).put("label", active?.label.orEmpty())
            .put("baseUrl", active?.baseUrl.orEmpty()).put("chatUrl", active?.chatUrl.orEmpty())
            .put("model", active?.model.orEmpty()).put("authHeader", active?.authHeader.orEmpty())
            .put("authScheme", active?.authScheme.orEmpty()).put("extraHeaders", active?.extraHeaders ?: JSONObject())
            .put("providers", available).put("revision", config.optInt("revision", 1))
            .put("imageGeneration", JSONObject().put("provider", "openrouter")
                .put("model", config.optJSONObject("imageGeneration")?.optString("model")?.ifBlank { IMAGE_MODEL } ?: IMAGE_MODEL)
                .put("configured", imageKey(config).isNotBlank()))
    }

    fun imageKey(): String = readOrNull()?.let(::imageKey).orEmpty()

    private fun imageKey(config: JSONObject): String =
        config.optJSONObject("imageGeneration")?.optString("apiKey").orEmpty()

    /** Play owns image settings; chat providers and the active chat model remain untouched. */
    fun updateImageFromPlay(provider: String, model: String, apiKey: String?): JSONObject {
        require(provider == "openrouter") { "Only OpenRouter image generation is supported" }
        require(Regex("^[a-z0-9._-]+/[a-z0-9._-]+$").matches(model)) { "Invalid OpenRouter image model" }
        val config = ensureDefault()
        val saved = imageKey(config)
        config.put("imageGeneration", JSONObject().put("provider", provider)
            .put("model", model).put("apiKey", apiKey?.trim()?.ifBlank { saved } ?: saved))
        config.put("revision", config.optInt("revision", 1) + 1).put("updatedAt", System.currentTimeMillis())
        write(config)
        return publicStatus()
    }

    fun clearImageKeyFromPlay(): JSONObject {
        val config = ensureDefault()
        config.put("imageGeneration", JSONObject().put("provider", "openrouter")
            .put("model", config.optJSONObject("imageGeneration")?.optString("model")?.ifBlank { IMAGE_MODEL } ?: IMAGE_MODEL)
            .put("apiKey", ""))
        config.put("revision", config.optInt("revision", 1) + 1).put("updatedAt", System.currentTimeMillis())
        write(config)
        return publicStatus()
    }

    /** Agent-only writer entry point. Empty key preserves the existing key for that provider. */
    fun updateFromAgent(id: String, model: String, baseUrl: String, apiKey: String?): JSONObject {
        require(id in presets) { "Unsupported AI provider" }
        val config = ensureDefault()
        val item = config.getJSONObject("providers").getJSONObject(id)
        val preset = presets.getValue(id)
        item.put("model", model.trim().ifBlank { preset[2] })
        item.put("baseUrl", normalizeBaseUrl(baseUrl.ifBlank { preset[1] }))
        if (apiKey != null && apiKey.isNotBlank()) item.put("apiKey", apiKey.trim())
        config.put("activeProvider", id).put("revision", config.optInt("revision", 1) + 1)
            .put("updatedAt", System.currentTimeMillis())
        write(config)
        return publicStatus()
    }

    fun clearActiveKey(): JSONObject {
        val config = ensureDefault()
        val id = config.optString("activeProvider", "zai")
        config.getJSONObject("providers").getJSONObject(id).put("apiKey", "")
        config.put("revision", config.optInt("revision", 1) + 1).put("updatedAt", System.currentTimeMillis())
        write(config)
        return publicStatus()
    }

    private fun provider(config: JSONObject, id: String): Provider? {
        if (id !in presets) return null
        val preset = presets.getValue(id)
        val item = config.optJSONObject("providers")?.optJSONObject(id) ?: return null
        return Provider(id, item.optString("label", preset[0]), normalizeBaseUrl(item.optString("baseUrl", preset[1])),
            item.optString("model", preset[2]), item.optString("apiKey"), item.optString("authHeader", preset[3]),
            item.optString("authScheme", preset[4]), item.optJSONObject("extraHeaders") ?: JSONObject())
    }

    private fun normalizeBaseUrl(value: String): String {
        val url = value.trim().trimEnd('/')
        require(url.startsWith("https://")) { "AI provider URL must use HTTPS" }
        return url
    }

    private fun write(value: JSONObject) {
        val target = file()
        require(target.parentFile?.mkdirs() == true || target.parentFile?.isDirectory == true) { "Cannot create Kalamos AI directory" }
        val temp = File(target.parentFile, "${target.name}.tmp")
        temp.writeText(value.toString(2))
        require(temp.renameTo(target)) { "Cannot publish Kalamos AI configuration" }
    }

    private const val MAX_BYTES = 128L * 1024
}
