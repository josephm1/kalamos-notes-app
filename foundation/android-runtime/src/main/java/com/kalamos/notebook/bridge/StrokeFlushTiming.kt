package com.kalamos.notebook.bridge

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max

/** Scheduling hint only, never an erase decision. Keep ordinary pen batches idle so JS work
 * cannot compete with the next letter. A retracing stroke gets to the existing web detector
 * sooner: the 900ms normal idle previously dominated scribble-to-erase response time.
 * Primitive accessors avoid copying the native point buffer or allocating per-point objects. */
internal fun strokeFlushDelayMs(count: Int, x: (Int) -> Float, y: (Int) -> Float, selection: Boolean = false): Long {
    // Selection is a completed command, including a tiny tap. Wait one short idle window
    // for native pen-up delivery; the existing pen-down cancellation still owns the next stroke.
    if (selection) return 60L
    if (count < 4) return 900L
    var left = x(0); var right = left; var top = y(0); var bottom = top
    var length = 0f
    for (i in 1 until count) {
        left = minOf(left, x(i)); right = maxOf(right, x(i))
        top = minOf(top, y(i)); bottom = maxOf(bottom, y(i))
        length += hypot(x(i) - x(i - 1), y(i) - y(i - 1))
    }
    val width = right - left; val height = bottom - top
    val extent = hypot(width, height)
    if (extent < 24f || length < extent * 2.1f) return 900L
    // Use the longer spatial axis, so forward m/w handwriting does not become a fast batch
    // merely because its vertical strokes reverse. Jitter below the deadband is ignored.
    val axis = if (width >= height) x else y
    val deadband = max(6f, max(width, height) * .06f)
    var extreme = axis(0); var direction = 0; var reversals = 0
    for (i in 1 until count) {
        val delta = axis(i) - extreme
        if (direction == 0) {
            if (abs(delta) > deadband) { direction = if (delta > 0) 1 else -1; extreme = axis(i) }
        } else if (delta * direction >= 0) extreme = axis(i)
        else if (abs(delta) > deadband) {
            reversals++; direction = -direction; extreme = axis(i)
        }
    }
    // Wait one short idle window instead of flushing in the pen callback. Another pen-down
    // still cancels this job. Word grouping/contact checks and deletion stay in JS at pen-up.
    return if (reversals >= 2) 60L else 900L
}
