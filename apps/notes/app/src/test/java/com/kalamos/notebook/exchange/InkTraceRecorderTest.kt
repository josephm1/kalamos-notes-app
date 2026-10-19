package com.kalamos.notebook.exchange

import android.graphics.Bitmap
import android.graphics.Color
import com.kalamos.notebook.diagnostics.InkTraceRecorder
import java.nio.ByteBuffer
import java.nio.file.Files
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class InkTraceRecorderTest {
    @Test fun rawCapturePreservesTheVendorBuffersPositionAndBytes() {
        val root = Files.createTempDirectory("ink-trace-test").toFile()
        val trace = InkTraceRecorder(root)
        val pixels = ByteBuffer.wrap(ByteArray(16) { it.toByte() }).apply { position(7) }
        trace.buffer("daemon.beforeClear", pixels.asReadOnlyBuffer(), 2, 2, mapOf("view" to 1))
        trace.finish()
        assertEquals(7, pixels.position())
        assertArrayEquals(ByteArray(16) { it.toByte() }, root.listFiles()!!.single { it.extension == "rgba" }.readBytes())
        assertTrue(root.resolve("events.jsonl").readText().contains("capture.complete"))
    }
    @Test fun capturingNeverMutatesOrRecyclesTheSubmittedBitmap() {
        val root = Files.createTempDirectory("ink-trace-test").toFile()
        val trace = InkTraceRecorder(root)
        val submitted = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
        trace.bitmap("host.submit", submitted, mapOf("view" to 2))
        submitted.eraseColor(Color.WHITE)
        trace.finish()
        assertFalse(submitted.isRecycled)
        assertEquals(Color.WHITE, submitted.getPixel(0, 0))
        val captured = android.graphics.BitmapFactory.decodeFile(root.listFiles()!!.single { it.extension == "png" }.absolutePath)
        assertEquals(Color.BLACK, captured.getPixel(0, 0))
    }
    @Test fun captureBudgetIsExplicitAndEventsRetainIndependentOwners() {
        val root = Files.createTempDirectory("ink-trace-test").toFile()
        val trace = InkTraceRecorder(root, imageLimit = 0)
        trace.event("owner.opening", mapOf("view" to 1, "notebook" to "A"))
        trace.event("owner.opening", mapOf("view" to 2, "notebook" to "B"))
        trace.bitmap("host.submit", Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888), mapOf("view" to 1))
        trace.finish()
        val events = root.resolve("events.jsonl").readLines().map { JSONObject(it) }
        assertEquals("A", events[0].getString("notebook")); assertEquals("B", events[1].getString("notebook"))
        assertEquals("capture.skipped", events[2].getString("event"))
        assertTrue(root.listFiles()!!.none { it.extension == "png" })
    }
    @Test fun eventBurstDoesNotConsumeTheImageQueueBudget() {
        val root = Files.createTempDirectory("ink-trace-test").toFile()
        val trace = InkTraceRecorder(root)
        repeat(200) { trace.event("model.render", mapOf("generation" to it)) }
        trace.buffer("daemon.connectedBeforeClear", ByteBuffer.wrap(ByteArray(16)), 2, 2, emptyMap())
        trace.finish()
        val events = root.resolve("events.jsonl").readLines().map { JSONObject(it) }
        assertEquals(200, events.count { it.optString("event") == "model.render" })
        assertTrue(events.any { it.optString("event") == "capture.complete" })
        assertFalse(events.any { it.optString("event") == "capture.skipped" })
    }

}
