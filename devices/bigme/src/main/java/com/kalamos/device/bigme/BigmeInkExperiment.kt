package com.kalamos.device.bigme

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect

/**
 * Opt-in laboratory controls, never invoked by a product provider. Every call targets the
 * already registered controller's exact client; no service-global or package settings change.
 * Reflection into the controller is deliberately isolated here so its production lifecycle and
 * established rendering policy remain unchanged. A missing field/API fails the lab trial.
 */
object BigmeInkExperiment {
    private fun client(controller: BigmeInkController): Any {
        val field = BigmeInkController::class.java.getDeclaredField("client")
        field.isAccessible = true
        return checkNotNull(field.get(controller)) { "No registered experiment client" }
    }

    fun configure(controller: BigmeInkController, prediction: Boolean, blending: Boolean) {
        applyClientPolicy(client(controller), prediction, blending)
    }

    internal fun applyClientPolicy(client: Any, prediction: Boolean, blending: Boolean) {
        client.javaClass.getMethod("setPredictEnabled", Boolean::class.javaPrimitiveType).invoke(client, prediction)
        client.javaClass.getMethod("setBlendEnabled", Boolean::class.javaPrimitiveType).invoke(client, blending)
    }

    /**
     * Diagnostic only: black/white marker fills may ghost under the pen waveform. Using the same
     * mode avoids the framework's different-mode wait branch while testing simultaneous updates.
     * Touch only the reserved marker strip, preserving uncompleted live ink everywhere else.
     */
    fun presentMarker(controller: BigmeInkController, bitmap: Bitmap, region: Rect) {
        presentClientMarker(client(controller), bitmap, region)
    }

    internal fun presentClientMarker(owner: Any, bitmap: Bitmap, region: Rect) {
        val canvas = owner.javaClass.getMethod("getCanvas").invoke(owner) as Canvas
        val paint = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC) }
        canvas.save()
        try { canvas.clipRect(region); canvas.drawBitmap(bitmap, region, region, paint) }
        finally { canvas.restore() }
        owner.javaClass.getMethod("inValidate", Rect::class.java, Int::class.javaPrimitiveType)
            .invoke(owner, region, BigmeInkController.MODE_HANDWRITE)
    }
}
