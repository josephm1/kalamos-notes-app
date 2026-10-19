package com.kalamos.koreader

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Looper
import android.view.MotionEvent
import android.view.SurfaceView
import com.kalamos.device.api.ink.InkEditingController
import com.kalamos.device.api.ink.StrokeCallback
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[29], manifest=Config.NONE)
class GenericPenTransportTest {
    private class Ink : InkEditingController {
        val events=mutableListOf<MotionEvent>()
        override val requiresMotionForwarding=true
        override val isActive=true
        override val consumesMotionEvents=true
        override fun onMotionEvent(event: MotionEvent): Boolean { events.add(MotionEvent.obtain(event));return true }
        override fun attach(view: SurfaceView,limit:Rect,callback:StrokeCallback)=true
        override fun setStrokeStyle(widthPx:Float,color:Int) {}
        override fun setEnabled(enabled:Boolean) {}
        override fun detach() {}
        override fun setCaptureOnly(active:Boolean) {}
        override fun setCaptureOnlyAt(decision:((Float,Float)->Boolean)?) {}
        override fun setExcludedPenTouch(listener:((Int,Float,Float)->Unit)?) {}
        override fun syncChrome(bitmap:Bitmap,region:Rect) {}
    }
    private fun field(name:String,value:Any?)=KalamosBridge.javaClass.getDeclaredField(name).apply {isAccessible=true}.set(KalamosBridge,value)
    private val payload="""{"action":2,"downTime":5,"samples":[[50,60,0.3,10],[70,80,0.7,20]]}"""
    @Test fun rawNativeEventPreservesHistoryPressureAndIgnoresRetiredSession() {
        val activity=Robolectric.buildActivity(Activity::class.java).setup().get()
        val surface=SurfaceView(activity);activity.setContentView(surface);surface.layout(0,0,200,300)
        val ink=Ink()
        field("controller",ink);field("surface",surface);field("hostForeground",true);field("sessionGeneration",200L)
        try {
            assertTrue(JSONObject(KalamosBridge.penMotion(activity,payload)).getBoolean("ok"))
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            val event=ink.events.single()
            assertEquals(1,event.historySize)
            assertEquals(10L,event.getHistoricalEventTime(0));assertEquals(20L,event.eventTime)
            assertEquals(.3f,event.getHistoricalPressure(0),.001f);assertEquals(.7f,event.pressure,.001f)
            assertEquals(MotionEvent.TOOL_TYPE_STYLUS,event.getToolType(0))
            val worker=Thread { KalamosBridge.penMotion(activity,payload) };worker.start();worker.join()
            field("sessionGeneration",201L)
            Shadows.shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1,ink.events.size)
        } finally { field("controller",null);field("surface",null);ink.events.forEach {it.recycle()} }
    }
    @Test fun incrementalProviderDeliversOneCompleteSavedStroke() {
        val ink=Ink();field("controller",ink)
        KalamosBridge.drainInk()
        val callback=KalamosBridge.javaClass.getDeclaredField("CALLBACK").apply {isAccessible=true}.get(KalamosBridge) as StrokeCallback
        try {
            callback.onStrokeBegin(10f,20f,.3f,1)
            callback.onStrokeMove(20f,25f,.6f,2)
            callback.onStrokeEnd(30f,30f,.7f,3)
            val batch=JSONObject(KalamosBridge.drainInk()).getJSONArray("strokes")
            assertEquals(1,batch.length())
            assertEquals(3,batch.getJSONObject(0).getJSONArray("points").length())
            assertEquals(0,JSONObject(KalamosBridge.drainInk()).getJSONArray("strokes").length())
        } finally {field("controller",null)}
    }
}
