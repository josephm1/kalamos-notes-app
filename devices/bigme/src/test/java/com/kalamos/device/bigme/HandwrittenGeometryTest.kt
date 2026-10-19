package com.kalamos.device.bigme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HandwrittenGeometryTest {
    @Test
    fun `only a complete logical or rotated canvas can become ready`() {
        assertTrue(usableHandwrittenCanvas(1072, 1448, 1072, 1448))
        assertTrue(usableHandwrittenCanvas(1448, 1072, 1072, 1448))
        assertFalse(usableHandwrittenCanvas(0, 0, 1072, 1448))
        assertFalse(usableHandwrittenCanvas(536, 1448, 1072, 1448))
        assertFalse(usableHandwrittenCanvas(1448, 536, 1072, 1448))
    }
    @Test
    fun `rotation is refreshed before layout builds the canvas matrix`() {
        val calls = mutableListOf<String>()

        val ready = refreshHandwrittenGeometry(
            updateRotation = { calls += "rotation" },
            updateLayout = { calls += "layout"; true },
        )

        assertTrue(ready)
        assertEquals(listOf("rotation", "layout"), calls)
    }

    @Test
    fun `a rejected physical layout prevents daemon presentation`() {
        assertFalse(refreshHandwrittenGeometry(updateRotation = {}, updateLayout = { false }))
    }
}
