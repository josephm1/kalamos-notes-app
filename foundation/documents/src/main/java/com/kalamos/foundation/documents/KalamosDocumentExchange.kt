package com.kalamos.foundation.documents

import org.json.JSONArray
import org.json.JSONObject

/** Neutral, versioned contract used for explicit user-directed exchange between Kalamos apps. */
object KalamosDocumentExchange {
    const val SCHEMA = "kalamos.note-package/v1"
    const val MIME = "application/vnd.kalamos.note-package+json"
    const val ACTION_PICK_NOTE = "com.kalamos.action.PICK_NOTE"
    const val ACTION_IMPORT_NOTE = "com.kalamos.action.IMPORT_NOTE"
    const val EXTRA_PACKAGE_JSON = "com.kalamos.extra.NOTE_PACKAGE_JSON"

    fun validate(raw: String): JSONObject {
        require(raw.length <= 8_000_000) { "Note package is too large" }
        val value = JSONObject(raw)
        require(value.optString("schema") == SCHEMA) { "Unsupported note package" }
        require(ID.matches(value.getString("packageId"))) { "Invalid package id" }
        require(value.getString("title").isNotBlank()) { "A title is required" }
        val source = value.optJSONObject("source") ?: JSONObject()
        source.optString("notebookId").takeIf(String::isNotBlank)?.let {
            require(SAFE_ID.matches(it)) { "Invalid source notebook id" }
        }
        val parts = value.optJSONArray("parts") ?: JSONArray()
        require(parts.length() in 1..64) { "A note package needs 1-64 parts" }
        for (index in 0 until parts.length()) {
            val part = parts.getJSONObject(index)
            require(part.optString("kind") in PART_KINDS) { "Unsupported note part" }
            require(part.optString("content").length <= 1_000_000) { "Note part is too large" }
        }
        return value
    }

    private val ID = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$")
    private val SAFE_ID = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
    private val PART_KINDS = setOf("markdown", "planning-sidecar", "text", "image-ref")
}
