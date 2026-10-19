package com.kalamos.foundation.documents

import org.json.JSONArray
import org.json.JSONObject

/** Versioned IPC contract for the user-owned planner shared by Todo and explicitly allowed apps. */
object KalamosPlannerExchange {
    const val SCHEMA = "kalamos.planner/v1"
    const val AUTHORITY = "com.kalamos.todo.planner"
    const val PERMISSION = "com.kalamos.permission.PLANNER"
    const val METHOD_LIST = "list"
    const val METHOD_UPSERT = "upsert"
    const val METHOD_STATUS = "status"
    const val METHOD_ARCHIVE = "archive"
    const val RESULT_JSON = "json"
    const val EXTRA_LINK_APP = "com.kalamos.extra.PLANNER_LINK_APP"
    const val EXTRA_LINK_TARGET = "com.kalamos.extra.PLANNER_LINK_TARGET"
    const val EXTRA_LINK_LABEL = "com.kalamos.extra.PLANNER_LINK_LABEL"

    val methods = setOf(METHOD_LIST, METHOD_UPSERT, METHOD_STATUS, METHOD_ARCHIVE)

    fun emptyState(): JSONObject = JSONObject()
        .put("schema", SCHEMA)
        .put("revision", 0)
        .put("items", JSONArray())

    fun validateState(raw: String): JSONObject {
        require(raw.length <= 4_000_000) { "Planner state is too large" }
        val state = JSONObject(raw)
        require(state.optString("schema") == SCHEMA) { "Unsupported planner state" }
        val items = state.optJSONArray("items") ?: JSONArray()
        require(items.length() <= 10_000) { "Planner has too many items" }
        for (index in 0 until items.length()) validateItem(items.getJSONObject(index), requireId = true)
        return state
    }

    fun validateItem(item: JSONObject, requireId: Boolean = false): JSONObject {
        val id = item.optString("id")
        if (requireId || id.isNotBlank()) require(SAFE_ID.matches(id)) { "Invalid planner item id" }
        require(item.optString("title").trim().length in 1..500) { "Planner item title is required" }
        require(item.optString("kind", "task") in KINDS) { "Invalid planner item kind" }
        require(item.optString("status", "open") in STATUSES) { "Invalid planner item status" }
        require(item.optString("priority", "normal") in PRIORITIES) { "Invalid planner priority" }
        validateDate(item.optString("date"))
        validateDate(item.optString("dueDate"))
        item.optString("goalId").takeIf(String::isNotBlank)?.let {
            require(SAFE_ID.matches(it)) { "Invalid goal id" }
        }
        require(item.optString("notes").length <= 20_000) { "Planner notes are too large" }
        item.optJSONObject("source")?.let(::validateSource)
        item.optJSONObject("link")?.let(::validateLink)
        return item
    }

    fun validateFilter(filter: JSONObject): JSONObject {
        validateDate(filter.optString("date"))
        filter.optString("kind").takeIf(String::isNotBlank)?.let {
            require(it in KINDS) { "Invalid planner item kind" }
        }
        filter.optString("status").takeIf(String::isNotBlank)?.let {
            require(it in STATUSES || it == "active") { "Invalid planner item status" }
        }
        return filter
    }

    private fun validateSource(source: JSONObject) {
        require(source.optString("app") in APPS) { "Invalid planner source app" }
        source.optString("id").takeIf(String::isNotBlank)?.let {
            require(SAFE_ID.matches(it)) { "Invalid planner source id" }
        }
        require(source.optString("label").length <= 200) { "Planner source label is too large" }
    }

    private fun validateLink(link: JSONObject) {
        require(link.optString("app") in APPS) { "Invalid planner link app" }
        require(link.optString("target").length <= 500) { "Planner link target is too large" }
        require(link.optString("label").length <= 200) { "Planner link label is too large" }
    }

    private fun validateDate(value: String) {
        if (value.isBlank()) return
        require(DATE.matches(value)) { "Dates must use YYYY-MM-DD" }
        runCatching { java.time.LocalDate.parse(value) }
            .getOrElse { throw IllegalArgumentException("Invalid calendar date") }
    }

    private val SAFE_ID = Regex("^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
    private val DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    private val KINDS = setOf("task", "goal")
    private val STATUSES = setOf("open", "done", "archived")
    private val PRIORITIES = setOf("low", "normal", "high")
    private val APPS = setOf("todo", "notes", "books", "explore")
}
