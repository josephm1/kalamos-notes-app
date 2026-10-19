package com.kalamos.notebook.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InkBoxGeometryTest {
    @Test
    fun `web viewport overshoot is clamped to measured host`() {
        assertEquals(
            InkBoxBounds(0, 0, 1072, 1448),
            clampInkBoxToHost(InkBoxBounds(0, 0, 1073, 1449), 1072, 1448),
        )
    }

    @Test
    fun `negative origin and excessive far edges are both clamped`() {
        assertEquals(
            InkBoxBounds(0, 0, 1072, 1448),
            clampInkBoxToHost(InkBoxBounds(-1, -2, 2000, 2000), 1072, 1448),
        )
    }

    @Test
    fun `fully outside request remains a nonempty edge box`() {
        assertEquals(
            InkBoxBounds(1071, 1447, 1072, 1448),
            clampInkBoxToHost(InkBoxBounds(2000, 2000, 2100, 2100), 1072, 1448),
        )
    }

    @Test
    fun `unmeasured host is not guessed`() {
        assertNull(clampInkBoxToHost(InkBoxBounds(0, 0, 10, 10), 0, 1448))
    }
}
