package com.kalamos.koreader

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.PopupWindow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import org.robolectric.Shadows
import org.robolectric.RuntimeEnvironment
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class InkToolbarTest {
    private fun find(view: View, description: String): View? {
        if (view.contentDescription?.toString() == description) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i), description)?.let { return it }
        return null
    }
    private fun tap(description: String) {
        ShadowSystemClock.advanceBy(Duration.ofMillis(300))
        val popup = Shadows.shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow
        val view = find(popup.contentView, description)
        assertNotNull("Missing control: $description", view)
        view!!.performClick()
    }
    private fun render(toolbar: InkToolbar, name: String) {
        val output = File(System.getProperty("user.dir"), "build/ui-review").apply { mkdirs() }
        val bitmap = Bitmap.createBitmap(600, 800, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); canvas.drawColor(Color.WHITE)
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 17f; typeface = android.graphics.Typeface.SERIF }
        val lines = listOf("Writing has a place in the human hierarchy", "somewhere above gardening, but below building.",
            "A good book gives you room to think. Keep", "your ideas close to the words that inspired them.",
            "Choose Canvas, then tap a paragraph to make", "space below it. The page moves around your note.")
        for (i in 0..23) canvas.drawText(lines[i % lines.size], 70f, 36f + i * 29f, text)
        if (name.startsWith("sticky-")) {
            val paper = Paint().apply { color = Color.WHITE }
            canvas.drawRect(30f, 308f, 570f, 742f, paper)
            paper.color = Color.BLACK; paper.style = Paint.Style.STROKE; paper.strokeWidth = 1f
            canvas.drawRect(30f, 308f, 570f, 742f, paper)
            canvas.drawLine(30f, 349f, 570f, 349f, paper)
        }
        toolbar.drawChrome(canvas)
        if (name == "rail") {
            val b = toolbar.chromeBounds()
            for (y in b.top + 8 until b.bottom - 8 step 13) {
                assertTrue("left border survives child painting", Color.red(bitmap.getPixel(b.left, y)) < 180)
                assertTrue("right border survives child painting", Color.red(bitmap.getPixel(b.right - 1, y)) < 180)
            }
        }
        File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun stickyToolsStayInsidePaperAndHeaderReceivesPen() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val actions = mutableListOf<String>(); var excluded = Rect()
        val paper = Rect(32, 350, 568, 740); val header = Rect(30, 310, 570, 348)
        val toolbar = InkToolbar(activity, changed = {}, action = { actions.add(it) },
            exclusion = { excluded = Rect(it) }, chromeChanged = {}, context = "sticky",
            writingBounds = paper, stickyHeader = header)
        toolbar.show()
        assertTrue(paper.contains(excluded)); assertTrue(toolbar.chromeBounds().contains(header))
        assertFalse(excluded.contains(header.centerX(), header.centerY()))
        val popup = Shadows.shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow
        assertNull(find(popup.contentView, "Sticky note — tap text to place"))
        assertFalse(popup.isOutsideTouchable) // Header must not dismiss settings when a finger taps them.
        toolbar.onPenTouch(1, 555f, 329f); toolbar.onPenTouch(3, 555f, 329f)
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(listOf("finish"), actions)
        render(toolbar, "sticky-tools")
        val penX = excluded.centerX().toFloat()
        val penY = excluded.top + 1f + 2.5f * (excluded.width() - 2)
        toolbar.onPenTouch(1, penX, penY); toolbar.onPenTouch(3, penX, penY)
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        val settings = Shadows.shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow
        assertNotNull(find(settings.contentView, "Heavy"))
        assertTrue(toolbar.chromeBounds().bottom <= paper.bottom)
        render(toolbar, "sticky-settings")
        toolbar.close()
    }
    @Test fun exitQueuesSaveWithoutChangingTheActiveTool() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val actions = mutableListOf<String>()
        val toolbar = InkToolbar(activity, changed = {}, action = { actions.add(it) },
            exclusion = {}, chromeChanged = {})
        toolbar.show()
        tap("Exit Kalamos mode — save and hide tools")
        assertEquals(listOf("exit-kalamos"), actions)
        assertEquals("pen", toolbar.style.tool)
        toolbar.close()
    }
    @Test fun closingCancelsAQueuedWritingRequest() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val worker = Thread { KalamosBridge.startInk(activity,
            """{"initialTool":"pen","toolBar":true}""") }
        worker.start(); worker.join()
        KalamosBridge.stopInk(activity)
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        val field = KalamosBridge::class.java.getDeclaredField("toolbar").apply { isAccessible = true }
        assertNull("A queued old writing request must not resurrect chrome after close", field.get(KalamosBridge))
    }
    @Test fun notesEraserModesDiameterAndPersistence() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val toolbar = InkToolbar(activity, changed = {}, action = {}, exclusion = {}, chromeChanged = {})
        toolbar.show(); tap("Eraser")
        render(toolbar, "notes-eraser")
        assertEquals(10f, toolbar.style.width)
        tap("Pixel eraser"); assertEquals("track", toolbar.style.eraser)
        tap("Increase eraser diameter"); assertEquals(11f, toolbar.style.width)
        tap("Decrease eraser diameter"); assertEquals(10f, toolbar.style.width)
        tap("Erasing lasso"); assertEquals("range", toolbar.style.eraser)
        tap("Close tool settings")
        fun railTap(label: String) {
            ShadowSystemClock.advanceBy(Duration.ofMillis(300))
            val field = InkToolbar::class.java.getDeclaredField("rail").apply { isAccessible = true }
            find((field.get(toolbar) as PopupWindow).contentView, label)!!.performClick()
        }
        railTap("Pen"); railTap("Eraser")
        assertEquals("range", toolbar.style.eraser); assertEquals(10f, toolbar.style.width)
        tap("Stroke eraser"); render(toolbar, "notes-eraser-stroke")
        toolbar.close()
    }
    @Test fun originalHandwritingViewIsAvailableWithoutBlockingCanvas() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val actions = mutableListOf<String>()
        val toolbar = InkToolbar(activity, changed = {}, action = { actions.add(it) }, exclusion = {},
            chromeChanged = {}, originalInkAvailable = true)
        toolbar.show(); tap("Writing options"); tap("Original page handwriting")
        assertEquals(listOf("original-ink"), actions)
        toolbar.close()
    }
    @Test fun supersededChromeRefreshKeepsRemovedPanelAndGuideDamage() {
        val damage = ChromeDamage()
        val panel = damage.add(1, Rect(40, 40, 260, 220))
        val guide = damage.add(1, Rect(50, 400, 580, 424))
        assertEquals(Rect(40, 40, 580, 424), guide.bounds)
        damage.presented(panel) // Old asynchronous completion cannot acknowledge new damage.
        val moved = damage.add(1, Rect(50, 500, 580, 524))
        assertEquals(Rect(40, 40, 580, 524), moved.bounds)
        damage.presented(moved)
        assertEquals(Rect(10, 10, 30, 30), damage.add(1, Rect(10, 10, 30, 30)).bounds)
        assertEquals(Rect(5, 5, 10, 10), damage.add(2, Rect(5, 5, 10, 10)).bounds)
    }
    @Test fun directPlacementAndCompactSettings() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val actions = mutableListOf<String>(); val placed = mutableListOf<String>()
        val toolbar = InkToolbar(activity, changed = {}, action = { actions.add(it) },
            exclusion = {}, chromeChanged = {}, place = { tool, _, _, _ -> placed.add(tool) })
        toolbar.show(); render(toolbar, "rail")
        assertFalse(Shadows.shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow.isOutsideTouchable)
        tap("Pen"); render(toolbar, "pen-settings")
        assertTrue(Shadows.shadowOf(RuntimeEnvironment.getApplication()).latestPopupWindow.isOutsideTouchable)
        tap("Heavy"); assertEquals(12f, toolbar.style.width)
        tap("Blue"); assertEquals(Color.BLUE, toolbar.style.color)
        tap("Close tool settings")
        val bounds = toolbar.chromeBounds()
        val x = bounds.centerX().toFloat(); val y = bounds.top + 8.5f * (bounds.width() - 2) + 3f
        toolbar.onPenTouch(1, x, y); toolbar.onPenTouch(3, x, y)
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals("canvas", toolbar.style.tool); assertEquals("canvas-mode", actions.last())
        render(toolbar, "canvas-placement")
        assertEquals(bounds.width(), toolbar.chromeBounds().width()) // Selecting Canvas opens no instruction dialog.
        tap("Pen"); assertEquals("pen", toolbar.style.tool)
        assertEquals("placement-cancel", actions.last())
        ShadowSystemClock.advanceBy(Duration.ofMillis(300))
        toolbar.onPenTouch(1, x, y); toolbar.onPenTouch(3, x, y)
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        // Blank space inside the union exclusion still places rather than swallowing the pen.
        toolbar.onPenTouch(1, 70f, 400f); toolbar.onPenTouch(3, 70f, 500f)
        assertEquals(listOf("canvas"), placed)
        toolbar.close()
    }
    @Test fun collapseIsSeparateFromFinishAndExclusionsFollowDockAndRotation() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val actions = mutableListOf<String>()
        var exclusion = Rect()
        val toolbar = InkToolbar(activity, changed = {}, action = { actions.add(it) },
            exclusion = { exclusion = Rect(it) }, chromeChanged = {})
        toolbar.show()
        val expanded = toolbar.chromeBounds()
        assertTrue(expanded.height() <= 800 && expanded.right <= 600)
        tap("Collapse writing toolbar")
        assertTrue(toolbar.chromeBounds().height() < expanded.height())
        assertTrue(actions.isEmpty())
        assertEquals(toolbar.chromeBounds(), exclusion)
        tap("Expand writing toolbar")
        tap("Writing options")
        tap("Move toolbar right")
        assertEquals(600 - expanded.left, toolbar.chromeBounds().right)
        activity.window.decorView.layout(0, 0, 800, 600)
        assertEquals(800 - expanded.left, toolbar.chromeBounds().right)
        assertTrue(toolbar.chromeBounds().bottom <= 600)
        assertEquals(toolbar.chromeBounds(), exclusion)
        toolbar.close(); assertTrue(exclusion.isEmpty)
    }
    @Test fun quickColorAndStickyContextUseSameNativeToolbar() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        activity.window.decorView.layout(0, 0, 600, 800)
        val actions = mutableListOf<String>()
        val toolbar = InkToolbar(activity, changed = {}, action = { actions.add(it) },
            exclusion = {}, chromeChanged = {}, context = "sticky")
        toolbar.show()
        val initial = toolbar.style.color
        tap("Switch to Blue")
        assertNotEquals(initial, toolbar.style.color)
        tap("Writing options")
        tap("Write on page")
        assertEquals(listOf("page"), actions)
        toolbar.close()
    }
}
