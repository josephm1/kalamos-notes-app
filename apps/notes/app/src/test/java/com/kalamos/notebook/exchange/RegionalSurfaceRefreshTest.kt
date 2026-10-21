package com.kalamos.notebook.exchange

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.kalamos.device.api.ink.InkController
import com.kalamos.device.api.ink.StrokeCallback
import com.kalamos.notebook.view.InkSurfaceView
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowSurfaceView

/** Android's buffer acquisition may expand its in/out dirty rect to the whole buffer. */
@Implements(SurfaceView::class)
class ExpandingSurfaceShadow : ShadowSurfaceView() {
    private val expandingHolder = Proxy.newProxyInstance(SurfaceHolder::class.java.classLoader,
        arrayOf(SurfaceHolder::class.java)) { _, method, args ->
        when (method.name) {
            "lockCanvas" -> {
                (args?.firstOrNull() as? Rect)?.set(0, 0, 64, 64)
                Canvas(Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888))
            }
            "getSurfaceFrame" -> Rect(0, 0, 64, 64)
            "isCreating" -> false
            else -> null
        }
    } as SurfaceHolder
    @Implementation public override fun getHolder(): SurfaceHolder = expandingHolder
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, shadows = [ExpandingSurfaceShadow::class])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RegionalSurfaceRefreshTest {
    @Test fun expandedAndroidBufferDamageCannotExpandAnImagePageEraseRefresh() {
        val view = InkSurfaceView(RuntimeEnvironment.getApplication()).apply { layout(0, 0, 64, 64) }
        val refreshes = mutableListOf<Rect?>()
        val cleanups = mutableListOf<Rect>()
        val controller = object : InkController {
            override val isActive = false
            override val consumesMotionEvents = false
            override fun attach(view: SurfaceView, limit: Rect, callback: StrokeCallback) = true
            override fun setStrokeStyle(widthPx: Float, color: Int) {}
            override fun setEnabled(enabled: Boolean) {}
            override fun detach() {}
            override fun syncOverlay(bitmap: Bitmap, region: Rect?, force: Boolean) { refreshes.add(region?.let { Rect(it) }) }
            override fun syncOverlayClean(bitmap: Bitmap, region: Rect) { cleanups.add(Rect(region)) }
        }
        InkSurfaceView::class.java.getDeclaredField("inkController").apply { isAccessible = true }.set(view, controller)
        InkSurfaceView::class.java.getDeclaredField("surfaceReady").apply { isAccessible = true }.setBoolean(view, true)
        val expected = Rect(4, 6, 20, 22)
        view.renderPage("blank", 0f, 0f, 1f, Rect(0, 0, 64, 64), emptyList(), defer = true, eraseRect = Rect(expected))
        val photo = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLUE) }
        val requested = Rect(expected)
        view.setContentSnapshot(photo, requested)
        assertEquals("Caller-owned erase region", expected, requested)
        assertEquals(listOf(expected), refreshes)
        assertEquals(listOf(expected), cleanups)
        val page = InkSurfaceView::class.java.getDeclaredField("pageBitmap").apply { isAccessible = true }.get(view) as Bitmap
        assertEquals("Unchanged image still retained outside erase", Color.BLUE, page.getPixel(50, 50))
    }
}
