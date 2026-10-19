package com.kalamos.device.api.ink

import android.graphics.Color

/** Defaults used by ink controllers when the host has not called
 *  [InkController.setStrokeStyle]. Sized for ~2.6dp at density 2 (≈5px) to
 *  match the Mokke production stroke width. Hosts that care should call
 *  setStrokeStyle with a density-scaled value. */
object InkDefaults {
    const val DEFAULT_STROKE_WIDTH_PX: Float = 5f
    const val DEFAULT_STROKE_COLOR: Int = Color.BLACK

    /** Felt-pen width from pen pressure (0..1): light touch = thin, hard press = thick. Shared by the
     *  daemon's live paint and the host's re-render so the live stroke and the reloaded stroke match.
     *  Range ~0.3x..2.0x of the base width. */
    fun pressureToWidth(baseWidthPx: Float, pressure: Float): Float {
        val p = pressure.coerceIn(0f, 1f)
        return baseWidthPx * (0.3f + 1.7f * p)
    }

    /** Dash pattern (surface px) for the "selection" pen — [on, off]. Shared by daemon live paint
     *  (with a running phase so segments join into one continuous dash) and the host re-render. */
    fun dashIntervals(): FloatArray = floatArrayOf(16f, 24f)
}
