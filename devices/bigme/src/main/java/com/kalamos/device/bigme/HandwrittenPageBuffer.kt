package com.kalamos.device.bigme

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.Paint
import android.graphics.Rect

/** Reconcile only the requested logical region using the firmware rotation matrix. A partial
 * chrome update must preserve unfinished native pen ink elsewhere. Explicit bitmap rectangles
 * avoid density scaling; a null region remains an intentional full-page reconciliation. */
internal fun replaceHandwrittenPage(canvas: Canvas, bitmap: Bitmap, paint: Paint, region: Rect? = null) {
    val saved = canvas.save()
    try {
        if (region != null) canvas.clipRect(region)
        val page = Rect(0, 0, bitmap.width, bitmap.height)
        canvas.drawBitmap(bitmap, page, page, paint)
    } finally {
        canvas.restoreToCount(saved)
    }
}

/** Clear a retired/new mapped allocation without requesting a panel refresh. */
internal fun clearHandwrittenAllocation(canvas: Canvas) {
    canvas.drawColor(Color.WHITE, PorterDuff.Mode.SRC)
}
