package com.kalamos.device.api.ink

import android.graphics.Bitmap
import android.graphics.Rect
import android.view.SurfaceView

/**
 * Abstracts live pen capture and presentation. Standard Android uses public MotionEvents and
 * SurfaceView composition; vendor implementations may paint through a hardware ink overlay.
 * Hosts keep document/session ownership while the selected provider owns input/display mechanics.
 *
 * Implementations:
 * Device modules implement this contract. The shared runtime owns document/session semantics; a
 * device implementation owns only live input and display mechanics.
 */
interface InkController {

    /** True iff the overlay is attached and currently painting pen strokes.
     *  When true, the host View must NOT draw the in-progress stroke itself —
     *  the overlay owns that pixel budget. */
    val isActive: Boolean

    /** True iff the overlay swallows MotionEvents and delivers strokes via
     *  [StrokeCallback] instead. Onyx's TouchHelper does this; Bigme's xrz
     *  pipeline does not — on Bigme the daemon rasterises at the framebuffer
     *  while MotionEvents still flow through `View.onTouchEvent`. */
    val consumesMotionEvents: Boolean

    /** True iff the overlay owns the host SurfaceView's surface while
     *  active — i.e. the host MUST NOT call `holder.lockCanvas()` /
     *  `unlockCanvasAndPost()` while writing.
     *
     *  Onyx's `TouchHelper` runs raw drawing directly on the SurfaceView,
     *  so any host-side `lockCanvas` blocks forever waiting for a lock
     *  TouchHelper never releases — wedging not just the host's draw thread
     *  but also SurfaceFlinger and the main thread (timers stop ticking,
     *  the activity becomes unresponsive).
     *
     *  Bigme's daemon paints into a separate ION buffer that floats above
     *  SurfaceFlinger — the host's surface and the daemon's overlay are
     *  independent compositors, so host commits coexist fine. Default false. */
    val ownsSurface: Boolean get() = false

    /** Attach the overlay to [view] with [limit] as the visible/allowed
     *  drawing rect (in view-local pixels). Returns true iff the overlay is
     *  now active. On false, the caller should use its MotionEvent fallback. */
    fun attach(view: SurfaceView, limit: Rect, callback: StrokeCallback): Boolean

    /** Pen stroke style — safe to call before or after [attach]. */
    fun setStrokeStyle(widthPx: Float, color: Int)

    /** Ignore pen events with view-local y above this (the host's toolbar strip). 0 = no
     *  constraint. Safe to call before or after [attach]; default no-op for implementations
     *  that don't support input clipping. */
    fun setWritingTop(topPx: Int) {}

    /** The floating menu's bounds (view px): pen inside is ignored (not a drawing area). Empty
     *  (right<=left) clears it. Generalizes setWritingTop for a menu that isn't a top strip. */
    fun setWritingExclusion(left: Int, top: Int, right: Int, bottom: Int) {}

    /** Writing bounds (view px): when set (right>left), the pen is ignored OUTSIDE this rect — confines
     *  drawing to a bounded sketch/sticky-note box. Empty (right<=left) clears it. Default no-op. */
    fun setWritingBounds(left: Int, top: Int, right: Int, bottom: Int) {}

    /** Eraser mode: while active, paint NO ink for any tool (the host's web layer erases instead).
     *  Safe to call before or after [attach]; default no-op. */
    fun setEraserMode(active: Boolean) {}

    /** Felt-pen mode: vary live stroke width by pen pressure (vs constant-width ballpoint). Safe to
     *  call before or after [attach]; default no-op (constant width). */
    fun setPressureMode(active: Boolean) {}

    /** "Selection" pen: paint the live stroke as a dashed line (vs a continuous one). Safe to call
     *  before or after [attach]; default no-op (continuous). */
    fun setDashMode(active: Boolean) {}

    /** Pause/resume delivery without detaching. Use before surface-repaint
     *  operations (finger scroll, full redraws, screen-mode refreshes). */
    fun setEnabled(enabled: Boolean)

    /**
     * Catch the EPD up to the host's [bitmap] over [region] (or the whole
     * view if region is null). Host calls this at mutation sites — scroll,
     * scratch-out, snap replacement, document load.
     *
     * [force] distinguishes two refresh cadences:
     *  - `false` (default) — "keep the overlay's shadow buffer in sync; the
     *    host's own SurfaceView commit will drive the EPD refresh."
     *    Appropriate for scroll: the SurfaceFlinger compose recomposites all
     *    layers, naturally reflecting the new bitmap.
     *  - `true` — "the host's SurfaceView commit alone won't make this
     *    visible; force a refresh." Appropriate for delete/snap where the
     *    overlay still shows pre-mutation ink on top of the freshly-composed
     *    SurfaceView and the host-side compose doesn't cycle the EPD.
     *
     * IMPORTANT: [bitmap] must already reflect the post-mutation state.
     * Force a synchronous rebuild before calling — syncing from an
     * un-rebuilt bitmap produces stale EPD content.
     */
    fun syncOverlay(bitmap: Bitmap, region: Rect? = null, force: Boolean = false) = Unit

    /** Blit ONLY [region] of [bitmap] onto the overlay and refresh just that region with the FAST
     *  (low-latency, ink-biased) waveform — for animation, where speed beats grey fidelity. Pair with
     *  an occasional syncOverlay(force=true) to clear accumulated ghosting. Default no-op. */
    fun refreshRegionFast(bitmap: Bitmap, region: Rect) = Unit

    /** Copy the controller's current overlay contents into [target] so the
     *  host can retain ink across surface refreshes (e.g. system-driven UI
     *  composes that re-blit a stale SurfaceView buffer over the EPD region).
     *
     *  Pixel-perfect: there is no coordinate translation, so this is immune
     *  to view-local vs window-local frame-of-reference mismatches.
     *
     *  Returns true if pixels were copied. Default is false — implementations
     *  that don't expose their overlay buffer (Noop, Onyx, and Bigme on
     *  firmware that returns null from `getContent()` and a hardware-backed
     *  Canvas with no readable bitmap) leave this as a no-op and the host
     *  should fall back to its own bitmap-mirroring path. */
    fun mirrorOverlay(target: android.graphics.Bitmap): Boolean = false

    /** Present authoritative pixels with a ghost-clearing update restricted to [region].
     * Ordinary screens can use their normal forced presentation; e-ink providers choose
     * the stronger regional waveform. Never use this on the live pen path. */
    fun syncOverlayClean(bitmap: android.graphics.Bitmap, region: android.graphics.Rect) {
        syncOverlay(bitmap, region, true)
    }

    /** Wipe the controller's overlay buffer over [region], **without**
     *  triggering an EPD refresh.
     *
     *  Use case: the host has already painted the canonical post-stroke ink
     *  into its own SurfaceView bitmap, so it doesn't need the controller's
     *  transient overlay to keep showing the same stroke. Clearing the
     *  controller buffer prevents two issues:
     *
     *  1. **Position shift between host and controller-rendered ink.** The
     *     controller's overlay and the SurfaceView are composed through
     *     different pipelines on Bigme (direct EPD vs SurfaceFlinger). With
     *     both showing the same stroke they can land on slightly different
     *     panel pixels — the host's "after-refresh shift" symptom. Wiping
     *     the controller buffer leaves the SurfaceView as the sole source.
     *
     *  2. **Ghost accumulation.** The Bigme daemon's ION buffer never auto-
     *     clears; old strokes pile up forever, and post-erase reuses of the
     *     region show ghost trails of removed ink under fresh strokes.
     *
     *  This call must NOT call `inValidate` — the EPD's currently-displayed
     *  pixels (drawn from this same buffer earlier) remain on screen via
     *  the controller's prior commit. Default: no-op. */
    fun clearRegion(region: android.graphics.Rect) = Unit

    /** Reset any per-session diagnostic counters (stroke index, etc.) so
     *  first-N-of-session logging fires again without needing to detach
     *  and re-attach the controller. Default: no-op. */
    fun resetDiagnostics() = Unit

    /** Detach — release the raw-drawing session. After this, [isActive] is
     *  false. [attach] must be called again to resume low-latency ink. */
    fun detach()
}

/** One captured pen sample in view-local coordinates. */
data class StrokePoint(val x: Float, val y: Float, val pressure: Float, val timestampMs: Long)

/** Pen-event sink, delivered in view-local coordinates. The host View owns
 *  scroll-offset translation to document space. */
interface StrokeCallback {
    fun onStrokeBegin(x: Float, y: Float, pressure: Float, timestampMs: Long)
    fun onStrokeMove(x: Float, y: Float, pressure: Float, timestampMs: Long)
    fun onStrokeEnd(x: Float, y: Float, pressure: Float, timestampMs: Long)

    /**
     * Whole-stroke delivery: all points from down→up in a single main-thread hop. A
     * controller that accumulates points on its own (binder) thread calls this once on
     * pen-up instead of posting per-move, so writing mode stays free of 60–120 main-thread
     * messages/sec. Default no-op so existing sinks that only use the incremental callbacks
     * keep working. [onStrokeBegin] is still delivered at pen-down for "drawing started".
     */
    fun onStrokeComplete(points: List<StrokePoint>) {}
}
