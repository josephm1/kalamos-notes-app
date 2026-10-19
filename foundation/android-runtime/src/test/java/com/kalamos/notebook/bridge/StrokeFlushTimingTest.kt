package com.kalamos.notebook.bridge

import org.junit.Assert.assertEquals
import org.junit.Test

class StrokeFlushTimingTest {
    @Test fun selectionTapAndLassoDoNotWaitForWritingIdle() {
        for (count in listOf(1, 3, 100)) {
            assertEquals(60L, strokeFlushDelayMs(count, { it.toFloat() }, { 0f }, selection = true))
        }
    }
    private fun delay(points: List<Pair<Float, Float>>) =
        strokeFlushDelayMs(points.size, { points[it].first }, { points[it].second })

    @Test fun shortScrubArrivesBeforeNormalIdle() {
        assertEquals(60L, delay(listOf(20f to 30f, 180f to 34f, 20f to 38f, 180f to 42f)))
        assertEquals(60L, delay(listOf(30f to 20f, 34f to 180f, 38f to 20f, 42f to 180f)))
    }
    @Test fun ordinaryWritingKeepsAcceptedBatchTiming() {
        assertEquals(900L, delay((0..20).map { (20f + it * 10) to (30f + (it % 2) * 40) }))
        assertEquals(900L, delay(listOf(20f to 30f, 180f to 34f, 20f to 38f)))
        assertEquals(900L, delay((0..100).map { (30f + it % 2) to (40f + it * .01f) }))
    }
}
