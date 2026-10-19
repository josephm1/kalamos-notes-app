package com.kalamos.device.bigme

import android.app.Application
import android.graphics.*
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class HandwrittenPageBufferTest {
    @Test fun completePageReplacesRetiredPixelsOnRotatedAllocationWithDifferentDensity() {
        val allocation = Bitmap.createBitmap(90, 60, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK); density = 0 }
        val canvas = Canvas(allocation)
        canvas.setMatrix(Matrix().apply { setValues(floatArrayOf(0f, 1f, 0f, -1f, 0f, 60f, 0f, 0f, 1f)) })
        val page = Bitmap.createBitmap(60, 90, Bitmap.Config.ARGB_8888).apply { density = 300; eraseColor(Color.WHITE) }
        Canvas(page).drawRect(0f, 30f, 60f, 32f, Paint().apply { color = Color.BLACK })
        replaceHandwrittenPage(canvas, page, Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC) })
        // An intentional full-page reconciliation replaces all retired pixels.
        assertEquals(Color.WHITE, allocation.getPixel(80, 50))
        assertEquals(Color.WHITE, allocation.getPixel(5, 5))
        for (y in 0 until 60) assertEquals(Color.BLACK, allocation.getPixel(30, y))
    }
    @Test fun retiringAllocationRemovesEveryOldPixelWithoutChangingRotation() {
        val allocation = Bitmap.createBitmap(90, 60, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
        val canvas = Canvas(allocation)
        val rotation = Matrix().apply { setValues(floatArrayOf(0f, 1f, 0f, -1f, 0f, 60f, 0f, 0f, 1f)) }
        canvas.setMatrix(rotation)
        clearHandwrittenAllocation(canvas)
        for (y in 0 until allocation.height) for (x in 0 until allocation.width) {
            assertEquals(Color.WHITE, allocation.getPixel(x, y))
        }
        assertEquals(rotation, canvas.matrix)
    }
    @Test fun regionalChromeUpdatePreservesUncommittedPenPixelsOutsideItsRotatedRegion() {
        val allocation = Bitmap.createBitmap(90, 60, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK); density = 0 }
        val canvas = Canvas(allocation)
        val rotation = Matrix().apply { setValues(floatArrayOf(0f, 1f, 0f, -1f, 0f, 60f, 0f, 0f, 1f)) }
        canvas.setMatrix(rotation)
        val oldClip = Rect(canvas.clipBounds)
        val oldSaveCount = canvas.saveCount
        val page = Bitmap.createBitmap(60, 90, Bitmap.Config.ARGB_8888).apply { density = 300; eraseColor(Color.WHITE) }
        val paint = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC) }
        replaceHandwrittenPage(canvas, page, paint, Rect(0, 0, 60, 12))
        assertEquals(Color.WHITE, allocation.getPixel(5, 5))
        assertEquals("Uncommitted pen pixels outside toolbar must survive", Color.BLACK, allocation.getPixel(80, 40))
        assertEquals(oldClip, canvas.clipBounds)
        assertEquals(oldSaveCount, canvas.saveCount)
        assertEquals(rotation, canvas.matrix)
        replaceHandwrittenPage(canvas, page, paint)
        assertEquals(Color.WHITE, allocation.getPixel(80, 40))
    }
}
