package com.kalamos.notebook.library

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NativeShelfTest {
    private class Host {
        val context = RuntimeEnvironment.getApplication()
        val parent = FrameLayout(context)
        val web = WebView(context)
        val worker = Executors.newSingleThreadExecutor()
        val shelf = NativeShelf(web, worker)
        val root = File(context.filesDir, "shelf-test-${java.util.UUID.randomUUID()}")
        init {
            root.mkdirs()
            com.kalamos.notebook.storage.StorageConfig.setRoot(context, root.absolutePath)
            parent.addView(web, FrameLayout.LayoutParams(600, 800))
            layout()
        }
        fun layout() {
            parent.measure(View.MeasureSpec.makeMeasureSpec(600, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY))
            parent.layout(0, 0, 600, 800)
            // ShadowWebView stubs layout; supply its bounds without invoking that stub.
            web.left = 0; web.top = 0; web.right = 600; web.bottom = 800
        }
        fun settle() {
            assertEquals("Measured WebView", 600, web.width)
            shadowOf(Looper.getMainLooper()).idle()
            worker.submit {}.get(5, TimeUnit.SECONDS)
            shadowOf(Looper.getMainLooper()).idle()
            layout()
            val logs = org.robolectric.shadows.ShadowLog.getLogsForTag("NativeShelf")
            if (logs.isNotEmpty()) throw AssertionError("Native rendering failed", logs.last().throwable)
        }
        fun close() { shelf.release(); shadowOf(Looper.getMainLooper()).idle(); web.destroy(); root.deleteRecursively() }
        val layer get() = parent.getChildAt(1) as FrameLayout
    }

    private fun model(revision: Int = 1) = JSONObject("""{
        "viewport":600,"x":0,"y":48,"width":600,"height":640,
        "cardWidth":150,"caption":40,"columns":3,"revision":$revision,
        "cards":[
          {"id":"one","title":"Notebook 1","subtitle":"Just now","thumbnail":"one","x":16,"y":16},
          {"id":"folder","title":"Projects","folder":true,"count":2,"x":216,"y":16,
           "slots":[{"thumbnail":"one"},{"folder":true}]}
        ]} """)

    private fun descendants(group: ViewGroup): List<View> = (0 until group.childCount).flatMap { i ->
        val child = group.getChildAt(i)
        listOf(child) + if (child is ViewGroup) descendants(child) else emptyList()
    }

    @Test fun nativeCardsHaveAccessibleNamesAndDelegateIdentityWithRevision() {
        val h = Host()
        try {
            h.shelf.present(model(7)); h.settle()
            assertEquals(View.VISIBLE, h.layer.visibility)
            assertEquals(48, (h.layer.layoutParams as FrameLayout.LayoutParams).topMargin)
            val card = descendants(h.layer).first { it.contentDescription == "Notebook 1, notebook" }
            assertTrue(card.isFocusable)
            card.performClick()
            assertTrue(shadowOf(h.web).lastEvaluatedJavascript.contains("\"revision\":7"))
            assertTrue(shadowOf(h.web).lastEvaluatedJavascript.contains("\"index\":0"))
            card.performLongClick()
            assertTrue(shadowOf(h.web).lastEvaluatedJavascript.contains("\"kind\":\"context\""))
        } finally { h.close() }
    }

    @Test fun nativeGeometryIsClampedToActualHostDespiteOversizedCssViewport() {
        val h = Host()
        try {
            h.shelf.present(model().put("viewport", 300).put("x", 250).put("y", 350)
                .put("width", 100).put("height", 150))
            h.settle()
            val params = h.layer.layoutParams as FrameLayout.LayoutParams
            assertEquals(500, params.leftMargin)
            assertEquals(700, params.topMargin)
            assertEquals(100, params.width)
            assertEquals(100, params.height)
        } finally { h.close() }
    }

    @Test fun hideInvalidatesAnInflightDecodeAndReleaseRemovesViews() {
        val h = Host()
        val gate = CountDownLatch(1)
        try {
            h.worker.submit { gate.await(5, TimeUnit.SECONDS) }
            h.shelf.present(model())
            shadowOf(Looper.getMainLooper()).idle()
            h.shelf.hide()
            shadowOf(Looper.getMainLooper()).idle()
            gate.countDown(); h.settle()
            assertEquals(1, h.parent.childCount)
            h.shelf.present(model(2)); h.settle()
            assertEquals(2, h.parent.childCount)
            h.shelf.release(); shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1, h.parent.childCount)
            h.shelf.present(model(3)); shadowOf(Looper.getMainLooper()).idle()
            assertEquals(1, h.parent.childCount)
        } finally { gate.countDown(); h.close() }
    }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun rendersFolderCollageAndEmptyNotebookWithoutReadingArbitraryThumbnailPaths() {
        val h = Host()
        try {
            val model = model()
            model.getJSONArray("cards").getJSONObject(0).put("thumbnail", "../../private")
            h.shelf.present(model); h.settle()
            val image = Bitmap.createBitmap(600, 800, Bitmap.Config.ARGB_8888)
            h.parent.draw(Canvas(image))
            val output = File("build/reports/native-library-preview.png")
            output.parentFile?.mkdirs()
            output.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
            assertEquals(android.graphics.Color.WHITE, image.getPixel(590, 100))
            var black = 0
            for (x in 16 until 166) for (y in 64 until 293) {
                if (android.graphics.Color.red(image.getPixel(x, y)) < 200) black++
            }
            assertTrue("Rules and outline render", black > 500)
        } finally { h.close() }
    }

    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun loadsSavedPreviewDirectlyAndDisplaysItInGrayscale() {
        val h = Host()
        try {
            val preview = Bitmap.createBitmap(800, 1200, Bitmap.Config.ARGB_8888)
            preview.eraseColor(android.graphics.Color.RED)
            val file = File(h.root, "thumbnails/one.png")
            file.parentFile?.mkdirs()
            file.outputStream().use { preview.compress(Bitmap.CompressFormat.PNG, 100, it) }
            h.shelf.present(model()); h.settle()
            val output = Bitmap.createBitmap(600, 800, Bitmap.Config.ARGB_8888)
            h.parent.draw(Canvas(output))
            val pixel = output.getPixel(90, 150)
            val value = android.graphics.Color.red(pixel)
            assertEquals(value, android.graphics.Color.green(pixel))
            assertEquals(value, android.graphics.Color.blue(pixel))
            assertTrue("Saved preview is painted rather than the white placeholder", value < 200)
            assertEquals("Stored preview retains its original colour", android.graphics.Color.RED,
                android.graphics.BitmapFactory.decodeFile(file.absolutePath).getPixel(0, 0))
        } finally { h.close() }
    }
}
