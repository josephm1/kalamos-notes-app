package com.kalamos.koreader

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.Looper
import android.view.SurfaceView
import com.kalamos.device.bigme.BigmeInkController
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class InkReplayReadinessTest {
    class Client {
        val calls = mutableListOf<String>()
        private val bitmap = Bitmap.createBitmap(200, 300, Bitmap.Config.ARGB_8888)
        fun getCanvas() = Canvas(bitmap)
        fun setInputEnabled(enabled: Boolean) { calls.add("input:$enabled") }
        fun setOverlayEnabled(enabled: Boolean) { calls.add("overlay:$enabled") }
        fun inValidate(rect: Rect, mode: Int) { calls.add("present") }
    }
    private fun field(owner: Any, name: String, value: Any?) {
        owner.javaClass.getDeclaredField(name).apply { isAccessible = true }.set(owner, value)
    }
    @Test fun erasingLassoMissStillReconcilesItsTransientTrail() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val surface = SurfaceView(activity);activity.setContentView(surface);surface.layout(0,0,200,300)
        val controller=BigmeInkController();val client=Client()
        field(controller,"client",client);field(controller,"clientClass",Client::class.java)
        field(controller,"attachedView",surface)
        field(KalamosBridge,"hostForeground",true);field(KalamosBridge,"controller",controller)
        field(KalamosBridge,"surface",surface)
        field(KalamosBridge,"pageBase",Bitmap.createBitmap(200,300,Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) })
        field(KalamosBridge,"replayedStrokes",emptyList<Any>())
        field(KalamosBridge,"activeStrokeStyle",InkToolbar.Style(tool="eraser",eraser="range",width=10f))
        field(KalamosBridge,"currentStyle",InkToolbar.Style(tool="eraser",eraser="range",width=10f))
        field(KalamosBridge,"nativeEditPending",false)
        field(KalamosBridge,"chromeBase",null)
        val callbackField=KalamosBridge::class.java.getDeclaredField("CALLBACK").apply { isAccessible=true }
        val callback=callbackField.get(KalamosBridge) as com.kalamos.device.api.ink.StrokeCallback
        val points=listOf(20f to 20f,80f to 20f,80f to 80f,20f to 80f,20f to 20f).mapIndexed { i,p ->
            com.kalamos.device.api.ink.StrokePoint(p.first,p.second,1f,i.toLong())
        }
        try {
            callback.onStrokeComplete(points)
            // Robolectric has no real Surface producer: verify the clean canonical frame
            // is nevertheless composed even when no saved stroke was hit.
            val frame=KalamosBridge::class.java.getDeclaredField("chromeBase").apply { isAccessible=true }
            val clean=frame.get(KalamosBridge) as? Bitmap
            assertNotNull(clean);assertEquals(Color.WHITE,clean!!.getPixel(50,50))
            val batch=KalamosBridge.drainInk()
            assertTrue(batch.contains("range"));assertTrue(batch.contains("eraser"))
            assertFalse(batch.contains("\"tool\":\"eraser\"")) // Gesture is a command, never stored ink.
        } finally { KalamosBridge.stopInk(activity) }
    }
    @Test fun newPenContactCancelsDelayedOlderEraseFrame() {
        var staleFrameRan=false
        val handlerField=KalamosBridge::class.java.getDeclaredField("eraseRefreshHandler").apply { isAccessible=true }
        val handler=handlerField.get(KalamosBridge) as android.os.Handler
        val old=Runnable { staleFrameRan=true }
        field(KalamosBridge,"pendingEraseClean",old);field(KalamosBridge,"pendingEraseDirty",Rect(0,0,100,100))
        handler.postDelayed(old,450L)
        field(KalamosBridge,"currentStyle",InkToolbar.Style())
        val callbackField=KalamosBridge::class.java.getDeclaredField("CALLBACK").apply { isAccessible=true }
        val callback=callbackField.get(KalamosBridge) as com.kalamos.device.api.ink.StrokeCallback
        callback.onStrokeBegin(20f,20f,1f,0L)
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(500))
        assertFalse("Old bitmap must not overwrite the next live pen stroke",staleFrameRan)
        callback.onStrokeEnd(20f,20f,1f,10L)
    }
    @Test fun eraserContactKeepsLiveInkVisibleUntilDeletionIsPresented() {
        val controller=BigmeInkController();val client=Client()
        field(controller,"client",client);field(controller,"clientClass",Client::class.java)
        field(KalamosBridge,"controller",controller)
        field(KalamosBridge,"androidDisplayMode",false)
        val callbackField=KalamosBridge::class.java.getDeclaredField("CALLBACK").apply { isAccessible=true }
        val callback=callbackField.get(KalamosBridge) as com.kalamos.device.api.ink.StrokeCallback
        val activity=Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0,0,600,800)
        field(KalamosBridge,"currentStyle",InkToolbar.Style())
        val show=KalamosBridge::class.java.getDeclaredMethod("showToolbar",Activity::class.java,
            String::class.java,Boolean::class.javaPrimitiveType,Boolean::class.javaPrimitiveType,
            Boolean::class.javaPrimitiveType,Rect::class.java,Rect::class.java).apply { isAccessible=true }
        try {
            show.invoke(KalamosBridge,activity,"full-page",true,false,false,Rect(0,0,600,800),null)
            val popup=Shadows.shadowOf(org.robolectric.RuntimeEnvironment.getApplication()).latestPopupWindow
            fun find(view: android.view.View): android.view.View? {
                if(view.contentDescription=="Eraser")return view
                if(view is android.view.ViewGroup)for(i in 0 until view.childCount)find(view.getChildAt(i))?.let {return it}
                return null
            }
            find(popup.contentView)!!.performClick()
            assertFalse("Selecting Eraser must not expose stale Android ink",client.calls.contains("overlay:false"))
            for (mode in listOf("stroke","track","range")) {
                field(KalamosBridge,"currentStyle",InkToolbar.Style(tool="eraser",eraser=mode))
                callback.onStrokeBegin(20f,20f,1f,0L)
                assertFalse(client.calls.contains("overlay:false"))
                val display=KalamosBridge::class.java.getDeclaredField("androidDisplayMode").apply { isAccessible=true }
                assertEquals(false,display.get(KalamosBridge))
                callback.onStrokeEnd(20f,20f,1f,10L)
            }
        } finally {field(KalamosBridge,"controller",null);KalamosBridge.stopInk(activity)}
    }
    @Test fun coldReplayEnablesInputOnlyAfterPresentationAndRetiredReplayCannotEnableIt() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val surface = SurfaceView(activity)
        activity.setContentView(surface); surface.layout(0, 0, 200, 300)
        val controller = BigmeInkController(); val client = Client()
        field(controller, "client", client); field(controller, "clientClass", Client::class.java)
        field(controller, "attachedView", surface)
        field(KalamosBridge, "hostForeground", true)
        field(KalamosBridge, "controller", controller); field(KalamosBridge, "surface", surface)
        field(KalamosBridge, "currentStyle", InkToolbar.Style())
        field(KalamosBridge, "sessionGeneration", 100L)
        val requestClass = Class.forName("com.kalamos.koreader.KalamosBridge\$ReplayRequest")
        val constructor = requestClass.declaredConstructors.single { it.parameterCount == 11 }.apply { isAccessible = true }
        val compose = KalamosBridge::class.java.getDeclaredMethod("composeAndPresentReplay",
            requestClass, Bitmap::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        fun replay(generation: Long) {
            // pageTransition=false: a freshly attached canvas needs the same readiness barrier.
            val request = constructor.newInstance(activity, controller, surface, emptyList<Any>(),
                5f, Color.BLACK, 0L, generation, false, null, null)
            compose.invoke(KalamosBridge, request,
                Bitmap.createBitmap(200, 300, Bitmap.Config.ARGB_8888), true)
        }
        try {
            replay(100L)
            assertFalse(client.calls.contains("input:true"))
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            assertTrue(client.calls.contains("input:true"))
            assertTrue(client.calls.indexOf("present") < client.calls.indexOf("input:true"))
            client.calls.clear()
            replay(100L)
            field(KalamosBridge, "sessionGeneration", 101L) // Read/close retires the queued frame.
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
            assertFalse(client.calls.contains("input:true"))
        } finally {
            field(KalamosBridge, "controller", null); field(KalamosBridge, "surface", null)
            KalamosBridge.stopInk(activity)
        }
    }
}
