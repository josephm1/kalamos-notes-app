package com.kalamos.notebook.exchange

import android.app.Activity
import android.app.Application
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PointF
import android.graphics.Rect
import android.os.Looper
import android.webkit.WebView
import com.kalamos.notebook.bridge.InkManager
import com.kalamos.notebook.view.InkSurfaceView
import java.time.Duration
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class InkSessionIsolationTest {
    private fun surface() = InkSurfaceView(RuntimeEnvironment.getApplication()).apply { layout(0,0,64,64) }
    private fun bitmap(view: InkSurfaceView): Bitmap = InkSurfaceView::class.java.getDeclaredField("pageBitmap")
        .apply { isAccessible = true }.get(view) as Bitmap
    private fun webView(): WebView {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        return WebView(activity).also { activity.setContentView(it); it.layout(0, 0, 64, 64) }
    }
    private fun blank(view: InkSurfaceView) = view.renderPage("blank",0f,0f,1f,Rect(0,0,64,64),emptyList())

    @Test fun androidStopRetiresNativeStateWithoutWaitingForJavascriptCheckpoint() {
        val view = surface()
        blank(view)
        val web = webView()
        val manager = InkManager(view, web)
        val callback = InkManager::class.java.getDeclaredMethod("strokeCallbackFor", Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(manager, 0) as com.kalamos.device.api.ink.StrokeCallback
        manager.onHostStopped()
        assertNull(InkSurfaceView::class.java.getDeclaredField("pageBitmap").apply { isAccessible = true }.get(view))
        assertFalse(manager.isInkSessionAttached())
        callback.onStrokeComplete(listOf(com.kalamos.device.api.ink.StrokePoint(4f,4f,0.5f,1)))
        assertEquals(0, InkManager::class.java.getDeclaredField("batchCount").apply { isAccessible = true }.getInt(manager))
        manager.onHostResumed()
        assertFalse("Resume must reconcile through controller readiness", manager.isInkSessionAttached())
        shadowOf(Looper.getMainLooper()).idle()
        web.destroy()
    }

    @Test fun retiredPageBufferCannotContaminateTheNextPageAfterItsFirstStroke() {
        val view = surface()
        blank(view)
        val retired = bitmap(view)
        retired.eraseColor(Color.BLACK)
        view.detach(false)
        // A native/compositor consumer may still hold and finish touching the retired allocation.
        // The new editor must never inherit it, even when both notes have identical dimensions.
        retired.eraseColor(Color.BLACK)
        view.drawStroke(listOf(PointF(4f,4f),PointF(8f,8f)),null)
        assertNotSame(retired,bitmap(view))
        assertEquals(Color.WHITE,bitmap(view).getPixel(40,40))
        assertFalse(retired.isRecycled)
    }
    @Test fun captureQueuedByAnOldSessionCannotInstallContentAfterDetach() {
        val view = surface()
        blank(view)
        val web = webView()
        val manager = InkManager(view,web)
        var ran = false
        val enqueue = InkManager::class.java.declaredMethods.single { it.name == "enqueueCapture" }
        enqueue.isAccessible = true
        val capture = { ran = true; view.setContentSnapshot(Bitmap.createBitmap(64,64,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }); Unit }
        if (enqueue.parameterCount == 2) enqueue.invoke(manager,100L,capture)
        else enqueue.invoke(manager,100L,{},capture)
        manager.detach(false)
        blank(view)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))
        assertFalse("Retired capture ran in the next editor",ran)
        assertEquals(Color.WHITE,bitmap(view).getPixel(40,40))
        web.destroy()
    }
    @Test fun staleControllerPenUpCannotWriteIntoTheNextEditorsBatch() {
        val view = surface(); blank(view)
        val web = webView()
        val manager = InkManager(view,web)
        val callback = InkManager::class.java.getDeclaredMethod("strokeCallbackFor",Int::class.javaPrimitiveType).apply { isAccessible = true }
        val old = callback.invoke(manager,0) as com.kalamos.device.api.ink.StrokeCallback
        manager.detach(false)
        InkManager::class.java.getDeclaredField("attached").apply { isAccessible = true }.setBoolean(manager,true)
        val points = listOf(com.kalamos.device.api.ink.StrokePoint(4f,4f,0.5f,1),com.kalamos.device.api.ink.StrokePoint(8f,8f,0.5f,2))
        val count = InkManager::class.java.getDeclaredField("batchCount").apply { isAccessible = true }
        old.onStrokeComplete(points)
        assertEquals(0,count.getInt(manager))
        (callback.invoke(manager,1) as com.kalamos.device.api.ink.StrokeCallback).onStrokeComplete(points)
        assertEquals(1,count.getInt(manager))
        manager.detach(false); shadowOf(Looper.getMainLooper()).idle(); web.destroy()
    }
    @Test fun discardedCaptureCompletesItsCancellationAndNewCapturesStillRun() {
        val view=surface(); blank(view)
        val web=webView()
        val manager=InkManager(view,web)
        val enqueue=InkManager::class.java.declaredMethods.single { it.name=="enqueueCapture" }.apply { isAccessible=true }
        var discarded=0;var oldRuns=0;var newRuns=0
        enqueue.invoke(manager,100L,{discarded++;Unit},{oldRuns++;Unit})
        manager.detach(false)
        enqueue.invoke(manager,0L,{}, {newRuns++;Unit})
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))
        assertEquals("Cancellation completion",1,discarded)
        assertEquals("Retired capture execution",0,oldRuns)
        assertEquals("Current capture execution",1,newRuns)
        assertEquals(android.view.View.LAYER_TYPE_HARDWARE,web.layerType)
        web.destroy()
    }
    @Test fun hardClosePublishesWhiteWithoutMutatingTheRetiredPageAllocation() {
        val view=surface();blank(view)
        val old=bitmap(view);old.eraseColor(Color.BLACK)
        var published:Bitmap?=null
        val controller=object:com.kalamos.device.api.ink.InkController {
            override val isActive=true
            override val consumesMotionEvents=false
            override fun attach(view:android.view.SurfaceView,limit:Rect,callback:com.kalamos.device.api.ink.StrokeCallback)=true
            override fun setStrokeStyle(widthPx:Float,color:Int) {}
            override fun setEnabled(enabled:Boolean) {}
            override fun syncOverlay(bitmap:Bitmap,region:Rect?,force:Boolean){published=bitmap}
            override fun detach() {}
        }
        InkSurfaceView::class.java.getDeclaredField("inkController").apply{isAccessible=true}.set(view,controller)
        InkSurfaceView::class.java.getDeclaredField("surfaceReady").apply{isAccessible=true}.setBoolean(view,true)
        view.detach(true)
        assertNotSame(old,published)
        assertEquals(Color.WHITE,published!!.getPixel(40,40))
        assertEquals(Color.BLACK,old.getPixel(40,40))
        assertFalse(old.isRecycled)
    }

}
