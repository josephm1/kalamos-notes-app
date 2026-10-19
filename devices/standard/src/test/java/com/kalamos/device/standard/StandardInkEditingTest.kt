package com.kalamos.device.standard

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.view.InputDevice
import android.view.MotionEvent
import android.view.SurfaceView
import com.kalamos.device.api.ink.StrokeCallback
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class StandardInkEditingTest {
    private class Sink : StrokeCallback {
        val samples = mutableListOf<String>()
        override fun onStrokeBegin(x: Float, y: Float, pressure: Float, timestampMs: Long) { samples.add("down") }
        override fun onStrokeMove(x: Float, y: Float, pressure: Float, timestampMs: Long) { samples.add("move") }
        override fun onStrokeEnd(x: Float, y: Float, pressure: Float, timestampMs: Long) { samples.add("up") }
    }
    private fun ready(): Triple<StandardInkController, SurfaceView, Sink> {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val surface = SurfaceView(activity)
        activity.setContentView(surface)
        surface.layout(0, 0, 200, 300)
        val controller = StandardInkController()
        val sink = Sink()
        // Robolectric does not create a display Surface. Bind the same model/input owners while
        // keeping presentation inert; graphics assertions inspect the retained backing pixels.
        for ((name,value) in listOf("view" to surface,"callback" to sink,"isActive" to true)) {
            controller.javaClass.getDeclaredField(name).apply { isAccessible=true }.set(controller,value)
        }
        val limit=controller.javaClass.getDeclaredField("attachLimit").apply { isAccessible=true }.get(controller) as Rect
        limit.set(20,40,200,300)
        surface.setOnTouchListener { _,event -> controller.onMotionEvent(event) }
        controller.syncOverlay(Bitmap.createBitmap(200,300,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) })
        return Triple(controller, surface, sink)
    }
    private fun send(surface: SurfaceView, action: Int, x: Float, y: Float, tool: Int = MotionEvent.TOOL_TYPE_STYLUS): Boolean {
        val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = tool }
        val coords = MotionEvent.PointerCoords().apply { this.x=x; this.y=y; pressure=.6f }
        val event = MotionEvent.obtain(1, 10, action, 1, arrayOf(properties), arrayOf(coords), 0,0,1f,1f,0,0,
            if (tool == MotionEvent.TOOL_TYPE_FINGER) InputDevice.SOURCE_TOUCHSCREEN else InputDevice.SOURCE_STYLUS,0)
        return try { surface.dispatchTouchEvent(event) } finally { event.recycle() }
    }
    private fun pixels(controller: StandardInkController) = Bitmap.createBitmap(200,300,Bitmap.Config.ARGB_8888).also { assertTrue(controller.mirrorOverlay(it)) }

    @Test fun captureOnlyDeliversPenWithoutPaintingAndNextWritingGesturePaints() {
        val (controller,surface,sink)=ready()
        controller.setCaptureOnly(true)
        send(surface,MotionEvent.ACTION_DOWN,50f,60f)
        send(surface,MotionEvent.ACTION_MOVE,70f,80f)
        send(surface,MotionEvent.ACTION_UP,80f,90f)
        assertEquals(listOf("down","move","up"),sink.samples)
        assertEquals(Color.WHITE,pixels(controller).getPixel(50,60))
        controller.setCaptureOnly(false)
        send(surface,MotionEvent.ACTION_DOWN,50f,60f)
        send(surface,MotionEvent.ACTION_UP,70f,80f)
        assertNotEquals(Color.WHITE,pixels(controller).getPixel(50,60))
    }
    @Test fun excludedToolbarContactIsRoutedOnceAndFingerIsNotInk() {
        val (controller,surface,sink)=ready()
        val actions=mutableListOf<Int>()
        controller.setExcludedPenTouch { action,_,_ -> actions.add(action) }
        send(surface,MotionEvent.ACTION_DOWN,5f,10f)
        send(surface,MotionEvent.ACTION_UP,5f,10f)
        assertEquals(listOf(MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP),actions)
        assertTrue(sink.samples.isEmpty())
        send(surface,MotionEvent.ACTION_DOWN,50f,60f,MotionEvent.TOOL_TYPE_FINGER)
        send(surface,MotionEvent.ACTION_UP,50f,60f,MotionEvent.TOOL_TYPE_FINGER)
        assertTrue(sink.samples.isEmpty())
    }
    @Test fun croppedChromePreservesRetainedPageInk() {
        val (controller,surface,_)=ready()
        send(surface,MotionEvent.ACTION_DOWN,50f,60f)
        send(surface,MotionEvent.ACTION_UP,50f,60f)
        val before=pixels(controller).getPixel(50,60)
        val chrome=Bitmap.createBitmap(10,10,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
        controller.syncChrome(chrome,Rect(100,100,110,110))
        val after=pixels(controller)
        assertEquals(before,after.getPixel(50,60))
        assertEquals(Color.BLACK,after.getPixel(105,105))
        assertEquals(Color.WHITE,after.getPixel(120,120))
    }
    @Test fun transparentAuthoritativeFrameClearsOldLivePixels() {
        val (controller,surface,_)=ready()
        send(surface,MotionEvent.ACTION_DOWN,50f,60f)
        send(surface,MotionEvent.ACTION_UP,50f,60f)
        val blank=Bitmap.createBitmap(200,300,Bitmap.Config.ARGB_8888)
        controller.syncOverlay(blank)
        assertEquals(Color.TRANSPARENT,pixels(controller).getPixel(50,60))
    }
    @Test fun perGestureCaptureDecisionAndDisableCompleteTheActiveStrokeOnce() {
        val (controller,surface,sink)=ready()
        controller.setCaptureOnlyAt { x,_ -> x<100 }
        send(surface,MotionEvent.ACTION_DOWN,50f,60f)
        controller.setEnabled(false)
        send(surface,MotionEvent.ACTION_UP,70f,80f)
        assertEquals(listOf("down","up"),sink.samples)
        assertEquals(Color.WHITE,pixels(controller).getPixel(50,60))
        controller.setEnabled(true)
        send(surface,MotionEvent.ACTION_DOWN,150f,160f)
        send(surface,MotionEvent.ACTION_UP,155f,165f)
        assertNotEquals(Color.WHITE,pixels(controller).getPixel(150,160))
    }
}
