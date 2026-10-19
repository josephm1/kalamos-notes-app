package com.kalamos.device.api.ink

import android.graphics.Bitmap
import android.graphics.Rect

/** Optional native editing capabilities shared by reader hosts; no document or vendor policy. */
interface InkEditingController : InkController {
    val isAvailable: Boolean get() = true
    /** NativeActivity hosts must forward their raw input queue; normal View hosts do not. */
    val requiresMotionForwarding: Boolean get() = false
    fun onMotionEvent(event: android.view.MotionEvent): Boolean = false
    /** Deliver gestures without drawing their temporary trail (eraser/selection manipulation). */
    fun setCaptureOnly(active: Boolean)
    /** Decide capture-only ownership at DOWN, before painting the first sample. */
    fun setCaptureOnlyAt(decision: ((Float, Float) -> Boolean)?)
    /** Optional daemon visibility; ordinary Android already uses the host's surface. */
    fun setOverlayVisible(visible: Boolean) {}
    /** Excluded control contacts must not become saved strokes. Action uses MotionEvent constants. */
    fun setExcludedPenTouch(listener: ((Int, Float, Float) -> Unit)?)
    /** A cropped chrome bitmap at region's surface-local origin; preserve all other pixels. */
    fun syncChrome(bitmap: Bitmap, region: Rect)
    fun syncOverlayRubber(bitmap: Bitmap, region: Rect) = syncOverlay(bitmap, region, true)
}
