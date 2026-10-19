package com.kalamos.device.bigme

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Looper
import android.view.SurfaceView
import com.kalamos.device.api.ink.StrokeCallback
import com.kalamos.device.api.ink.StrokePoint
import java.lang.reflect.InvocationHandler
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class BigmeStrokeCompletionTest {
    class Client {
        private val canvas = Canvas(Bitmap.createBitmap(320, 400, Bitmap.Config.ARGB_8888))
        fun getCanvas(): Canvas = canvas
        fun invalidate(rect: Rect, mode: Int) {}
    }
    interface Listener { fun onInputTouch(action: Int, x: Int, y: Int, pressure: Int, tool: Int): Int }
    private class Harness(captureOnly: Boolean) {
        val completed = mutableListOf<List<StrokePoint>>()
        val excluded = mutableListOf<Int>()
        private val client = Client()
        private val sink = object : StrokeCallback {
            override fun onStrokeBegin(x: Float, y: Float, pressure: Float, timestampMs: Long) {}
            override fun onStrokeMove(x: Float, y: Float, pressure: Float, timestampMs: Long) {}
            override fun onStrokeEnd(x: Float, y: Float, pressure: Float, timestampMs: Long) {}
            override fun onStrokeComplete(points: List<StrokePoint>) { completed.add(points) }
        }
        private val proxy = Class.forName("com.kalamos.device.bigme.BigmeInkController\$InputProxy")
            .declaredConstructors.single().apply { isAccessible = true }.newInstance(
                sink, SurfaceView(RuntimeEnvironment.getApplication()), { client },
                { _: List<StrokePoint> -> }, {}, Client::class.java.getMethod("getCanvas"),
                Client::class.java.getMethod("invalidate", Rect::class.java, Int::class.javaPrimitiveType),
                { 3f }, { android.graphics.Color.BLACK }, { _: Canvas, _: Float, _: Float, _: Int, _: Float -> },
                AtomicInteger(), { 100 }, { x: Float, y: Float -> x < 50 || x >= 250 || y >= 300 },
                { action: Int, _: Float, _: Float -> excluded.add(action); Unit },
                { false }, { captureOnly }, { _: Float, _: Float -> false }, { false }, { true }
            ) as InvocationHandler
        fun event(action: Int, x: Int, y: Int, tool: Int = 0) {
            proxy.invoke(null, Listener::class.java.methods.single(), arrayOf(action, x, y, 2048, tool))
            shadowOf(Looper.getMainLooper()).idle()
        }
        fun loop() {
            event(1, 100, 120); event(2, 120, 120); event(2, 120, 140); event(2, 100, 140)
        }
    }
    @Test fun `loop ending above paper is delivered once using valid samples in both capture paths`() {
        for (capture in listOf(false, true)) {
            val h = Harness(capture); h.loop(); h.event(3, 100, 90); h.event(4, 0, 0)
            assertEquals("capture=$capture", 1, h.completed.size)
            assertTrue(h.completed.single().all { it.y >= 100 })
            assertTrue(h.excluded.isEmpty())
        }
    }
    @Test fun `loop leaving through excluded side is not lost or treated as a toolbar release`() {
        val h = Harness(false); h.loop(); h.event(4, 20, 140)
        assertEquals(1, h.completed.size)
        assertTrue(h.completed.single().all { it.x >= 50 })
        assertTrue(h.excluded.isEmpty())
    }
    @Test fun `excluded starts and finger gestures do not become ink`() {
        val h = Harness(false)
        h.event(1, 10, 120); h.event(2, 100, 130); h.event(3, 100, 140)
        h.event(1, 100, 120, 2); h.event(2, 120, 120, 2); h.event(3, 120, 140, 2)
        assertTrue(h.completed.isEmpty())
    }
    @Test fun `floating controls above paper receive their whole pen gesture without ink`() {
        val h = Harness(false)
        h.event(1, 20, 50); h.event(2, 20, 55); h.event(3, 20, 55)
        assertEquals(listOf(1, 2, 3), h.excluded)
        assertTrue(h.completed.isEmpty())
    }
    @Test fun `floating control owns release outside exclusion without seeding paper ink`() {
        val h = Harness(false)
        h.event(1, 20, 50); h.event(2, 100, 120); h.event(3, 100, 120)
        assertEquals(listOf(1, 2, 3), h.excluded)
        assertTrue(h.completed.isEmpty())
        h.loop(); h.event(3, 100, 140)
        assertEquals(1, h.completed.size)
    }
    @Test fun `ordinary ink completes once and duplicate in-bounds release cannot create a dot`() {
        val h = Harness(false); h.loop(); h.event(3, 100, 120); h.event(3, 100, 120)
        assertEquals(1, h.completed.size)
        assertEquals(100f, h.completed.single().last().x)
        assertEquals(120f, h.completed.single().last().y)
    }

}
