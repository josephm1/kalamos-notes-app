package com.kalamos.foundation.documents

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class KalamosPlannerExchangeTest {
    @Test fun acceptsVersionedTaskAndLink() {
        val task = JSONObject()
            .put("id", "task-123")
            .put("title", "Visit Glendalough")
            .put("kind", "task")
            .put("status", "open")
            .put("priority", "high")
            .put("date", "2026-09-13")
            .put("link", JSONObject().put("app", "explore").put("target", "Glendalough"))
        val state = JSONObject().put("schema", KalamosPlannerExchange.SCHEMA)
            .put("revision", 1).put("items", JSONArray().put(task))
        assertEquals("Visit Glendalough", KalamosPlannerExchange.validateState(state.toString())
            .getJSONArray("items").getJSONObject(0).getString("title"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsTraversalIds() {
        KalamosPlannerExchange.validateItem(JSONObject().put("id", "../tasks")
            .put("title", "Unsafe").put("kind", "task"), requireId = true)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsImpossibleDates() {
        KalamosPlannerExchange.validateItem(JSONObject().put("title", "Impossible")
            .put("kind", "task").put("date", "2026-02-31"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnknownLinkApps() {
        KalamosPlannerExchange.validateItem(JSONObject().put("title", "Unsafe link")
            .put("kind", "task").put("link", JSONObject().put("app", "browser").put("target", "https://example.com")))
    }
}
