package com.kalamos.device.bigme

import org.junit.Assert.*
import org.junit.Test
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [], manifest = Config.NONE)
class BigmeInkExperimentTest {
    class Client {
        val settings = mutableListOf<Pair<String, Boolean>>()
        fun setPredictEnabled(enabled: Boolean) { settings.add("prediction" to enabled) }
        fun setBlendEnabled(enabled: Boolean) { settings.add("blending" to enabled) }
    }

    @Test fun predictionTrialChangesOnlyTheRequestedClient() {
        val owner = Client()
        val other = Client()
        BigmeInkExperiment.applyClientPolicy(owner, false, true)
        assertEquals(listOf("prediction" to false, "blending" to true), owner.settings)
        assertTrue(other.settings.isEmpty())
    }

    @Test fun blendingTrialLeavesPredictionEnabled() {
        val owner = Client()
        BigmeInkExperiment.applyClientPolicy(owner, true, false)
        assertEquals(listOf("prediction" to true, "blending" to false), owner.settings)
    }

    @Test(expected = NoSuchMethodException::class) fun missingFirmwareControlFailsTheTrial() {
        BigmeInkExperiment.applyClientPolicy(Any(), false, false)
    }

    class MarkerClient(val image: Bitmap) {
        var refreshed: Rect? = null
        var mode = 0
        fun getCanvas() = Canvas(image)
        fun inValidate(region: Rect, waveform: Int) { refreshed = Rect(region); mode = waveform }
    }

    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    fun markerPreservesUnfinishedInkOutsideItsReservedStrip() {
        val mapped = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
        val source = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
        val client = MarkerClient(mapped)
        val strip = Rect(0, 0, 100, 20)
        BigmeInkExperiment.presentClientMarker(client, source, strip)
        assertEquals(Color.WHITE, mapped.getPixel(50, 10))
        assertEquals(Color.BLACK, mapped.getPixel(50, 50))
        assertEquals(strip, client.refreshed)
        assertEquals(BigmeInkController.MODE_HANDWRITE, client.mode)
    }
}
