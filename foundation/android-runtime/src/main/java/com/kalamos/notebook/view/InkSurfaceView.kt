package com.kalamos.notebook.view

import com.kalamos.device.api.ink.InkDiagnostics
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.util.AttributeSet
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.kalamos.device.api.ink.InkController
import com.kalamos.device.api.ink.InkDefaults
import com.kalamos.device.api.ink.StrokeCallback

/** One stroke to render (surface px). [pressures] non-null = FELT pen (per-point variable width via
 *  InkDefaults.pressureToWidth); null = constant-width ballpoint at [width]. [colorInt] = ink color.
 *  [dashed] = the "selection" pen (dashed line). */
class StrokeRender(val points: List<PointF>, val width: Float, val pressures: FloatArray?, val colorInt: Int, val dashed: Boolean)

/**
 * Single opaque ink surface, ported from inkit. The Bigme daemon draws the live in-progress
 * stroke onto this view's HANDWRITTEN overlay (low latency); finished strokes are baked into a
 * page bitmap that we present via lockCanvas on the SAME surface, then re-prime the daemon buffer
 * to match via syncOverlay(force=false) (no extra EPD refresh).
 *
 * One HWC layer is the whole point: when the lockCanvas commit and the daemon overlay were on two
 * separate surfaces they fought for the e-ink panel, causing per-stroke catch-up lag. On one
 * surface there's no fight, so we can commit every stroke immediately (no debounce).
 *
 * Opaque (white page) — it covers the WebView, which is kept only for the toolbar + vector model.
 */
class InkSurfaceView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : SurfaceView(context, attrs, defStyleAttr), SurfaceHolder.Callback {

    private fun trace(name: String, fields: Map<String, Any?> = emptyMap()) {
        if (InkDiagnostics.enabled) InkDiagnostics.event(name, fields + mapOf("view" to System.identityHashCode(this),
            "surfaceReady" to surfaceReady, "attached" to attached, "bitmap" to pageBitmap?.let { System.identityHashCode(it) }))
    }
    private var inkController: InkController? = null
    private var pendingCallback: StrokeCallback? = null
    private var pendingRect: Rect? = null
    private var pendingOnReady: ((Boolean) -> Unit)? = null
    private var writingTopPx = 0
    private val exclRect = Rect()   // floating-menu pen-exclusion bounds, re-applied across attaches
    private val boundsRect = Rect() // writing bounds: pen outside is ignored (sketch box). Empty = none.
    private var eraserMode = false
    private var surfaceReady = false
    @Volatile private var attached = false

    private var pageBitmap: Bitmap? = null
    private var pageCanvas: Canvas? = null
    // Full-screen wake refresh happens only on the first present of a session (cold-open fix); later
    // renders refresh just the paper, so the toolbar never flashes on page-change / button taps.
    private var hasPresentedOnce = false
    // Skip the full-screen wake refresh on the NEXT attach (sticky-note open → partial refresh only).
    private var skipNextWake = false
    private var webResume = false
    private var primeResumeBuffer = false
    // Snapshots of the web chrome, composited onto the page so the UI remains visible while the
    // opaque ink surface is the sole rendered layer. They are deliberately independent: Notes uses
    // a full-width top toolbar AND a left tool rail; the classic editor uses only [menuBitmap].
    private var toolbarBitmap: Bitmap? = null
    private var menuBitmap: Bitmap? = null
    private var menuLeft = 0
    private var menuTop = 0
    // Interactive-format content (article text/images/MCQ/etc.) baked onto the page UNDER the ink,
    // at the paper origin (rBounds). The daemon pen writes over it. Null for plain notebooks.
    private var contentBitmap: Bitmap? = null
    private var pendingEraseClean: Rect? = null
    // Deferred stroke-painting pass for heavy pages (shell shows first, strokes fill in next frame).
    // The strokes currently shown (surface px). renderPage resets it; drawStroke appends. A stroke
    // with pressures != null is a FELT stroke (per-point variable width); null = constant-width ballpoint.
    private val displayedStrokes = ArrayList<StrokeRender>()
    private var pressureMode = false   // felt pen active (re-applied to the controller on each attach)
    private var dashMode = false       // selection pen active (dashed) — re-applied on each attach
    // The web bridge commonly sets style before attachInkBox's main-thread
    // post creates the hardware controller. Retain and reapply it on attach so
    // the live daemon never depends on that scheduling race.
    private var strokeWidthPx = 3f
    private var strokeColorInt = Color.parseColor("#111111")
    private val dashEffect = android.graphics.DashPathEffect(InkDefaults.dashIntervals(), 0f)
    // Last template render params, so eraseAt can repaint the shell + remaining strokes natively.
    private var rTemplate = "blank"
    private var rSpacing = 0f
    private var rMargin = 0f
    private var rDpr = 1f
    private val rBounds = Rect()
    private val paint = Paint().apply {
        isAntiAlias = true
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = Color.parseColor("#111111")
        strokeWidth = 3f
    }
    private val path = Path()

    init {
        // Base-layer surface (NOT ZOrderOnTop). On e-ink a z-ordered overlay surface gets a slow,
        // flashing refresh mode; the base surface gets the fast one — matching inkit. The WebView
        // above it is made transparent (page area) so this surface shows through.
        holder.setFormat(PixelFormat.OPAQUE)
        holder.addCallback(this)
    }

    fun attach(callback: StrokeCallback, rect: Rect, controller: InkController, onReady: (Boolean) -> Unit) {
        if (attached) detach()
        /*
         * A thumbnail/exit flush deliberately calls Bridge.setInkEnabled(false) before it snapshots
         * the authoritative model. InkSurfaceView.setEnabled forwards that state to both the
         * controller and Android View. The controller created below starts enabled, but Android
         * retains the disabled View flag across GONE/VISIBLE and surface recreation; consequently
         * the second notebook could report "InkController ready: true" while View dispatch rejected
         * every stylus event.
         *
         * A new attach is the ownership boundary for a new editor session, so restore the View
         * before installing either device controller. This is shared Standard/Bigme lifecycle
         * hygiene—not a refresh-policy branch—and does not present or clear any panel pixels.
         */
        super.setEnabled(true)
        inkController = controller
        pendingCallback = callback
        pendingRect = rect
        pendingOnReady = onReady
        if (surfaceReady && width > 0 && height > 0) {
            val success = doAttach()
            onReady(success)
            pendingOnReady = null
        }
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        trace("surface.created", mapOf("width" to width, "height" to height))
        surfaceReady = true
        ensureBitmap()
        commitPage()
        if (inkController != null && pendingCallback != null) {
            val success = doAttach()
            pendingOnReady?.invoke(success)
            pendingOnReady = null
        }
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, w: Int, h: Int) {
        ensureBitmap()
        commitPage()
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        trace("surface.destroyed")
        surfaceReady = false
        inkController?.detach()
        attached = false
        hasPresentedOnce = false   // a fresh open should full-refresh again (incl. the toolbar)
    }

    private fun doAttach(): Boolean {
        val controller = inkController ?: return false
        val callback = pendingCallback ?: return false
        val limit = pendingRect ?: Rect(0, 0, width, height)
        val success = controller.attach(this, limit, callback)
        attached = success
        if (success) {
            controller.setStrokeStyle(strokeWidthPx, strokeColorInt)
            controller.setWritingTop(writingTopPx)   // re-apply across (re)attaches
            controller.setWritingExclusion(exclRect.left, exclRect.top, exclRect.right, exclRect.bottom)
            controller.setWritingBounds(boundsRect.left, boundsRect.top, boundsRect.right, boundsRect.bottom)
            controller.setEraserMode(eraserMode)
            controller.setPressureMode(pressureMode)
            controller.setDashMode(dashMode)
            // Full-screen GU16 wake refresh ONLY on the first present of a session (cold open /
            // surface recreate) — that's the blank-until-touch fix, and it's the one time the whole
            // panel (incl. the toolbar snapshot) should refresh. On a re-attach (page change) the
            // page render refreshes just the paper, so a full refresh here would flash the toolbar.
            if (!hasPresentedOnce) {
                // A sticky-note open suppresses the full-screen wake so only the note box refreshes
                // (the rest of the panel keeps showing the reader). Otherwise the normal cold-open wake.
                if (!skipNextWake && !webResume) pageBitmap?.let { controller.syncOverlay(it, null, true) }
                hasPresentedOnce = true
            }
            primeResumeBuffer = webResume
            webResume = false
            skipNextWake = false
        }
        return success
    }

    fun detach(clearDisplay: Boolean = true) {
        trace("surface.detach", mapOf("clearDisplay" to clearDisplay, "retainedStrokes" to displayedStrokes.size))
        pendingEraseClean = null
        // Push white to the daemon canvas + GU16 BEFORE disconnecting so the physical e-ink panel
        // is blank immediately on notebook exit. Without this the panel retains the last ink frames
        // until the next notebook's doAttach() GU16 (hundreds of ms later), briefly flashing through.
        // Skipped for box-mode detaches (sticky notes) — the reader behind the box must stay visible.
        if (clearDisplay && surfaceReady && inkController != null) {
            pageBitmap?.let { previous ->
                // The compositor/daemon can still hold the submitted page. Publish a separate
                // white frame; never mutate that allocation and then reuse it for another note.
                val clear = Bitmap.createBitmap(previous.width, previous.height, Bitmap.Config.ARGB_8888)
                clear.density = previous.density
                clear.eraseColor(Color.WHITE)
                inkController?.syncOverlay(clear, null, true)
            }
        }
        inkController?.detach()
        inkController = null
        pendingCallback = null
        pendingRect = null
        pendingOnReady = null
        attached = false
        pageBitmap = null
        pageCanvas = null
        // A detach is a hard ownership boundary. Retaining this model caused
        // clearContent() or a later surface lifecycle callback to recompose the
        // previous notebook's strokes into a newly-created Planning note.
        displayedStrokes.clear()
        rTemplate = "blank"
        rSpacing = 0f
        rMargin = 0f
        rDpr = 1f
        rBounds.setEmpty()
        // Do not call Bitmap.recycle() on images that have recently been submitted to either the
        // SurfaceView compositor or Bigme's handwritten daemon. Both consumers are asynchronous on
        // this firmware: detach can run on the WebView JavaBridge thread while HWUI is still reading
        // one of these bitmaps. Explicit recycling caused a native Bitmap_recycle SIGSEGV when
        // leaving Planning. Dropping our references lets Android reclaim them only when no renderer
        // or daemon reference remains.
        toolbarBitmap = null
        menuBitmap = null
        contentBitmap = null
        hasPresentedOnce = false
        webResume = false
        primeResumeBuffer = false
    }

    private fun ensureBitmap() {
        val w = width
        val h = height
        if (w <= 0 || h <= 0) return
        val b = pageBitmap
        if (b == null || b.width != w || b.height != h) {
            val fresh = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            pageCanvas = Canvas(fresh)
            pageCanvas?.drawColor(Color.WHITE)
            if (b != null) pageCanvas?.drawBitmap(b, 0f, 0f, null)
            pageBitmap = fresh
            // The old bitmap may still be queued in SurfaceFlinger/Bigme. Let GC retire it safely.
        }
    }

    fun setStrokeStyle(widthPx: Float, colorInt: Int) {
        strokeWidthPx = widthPx
        strokeColorInt = colorInt
        paint.strokeWidth = widthPx
        paint.color = colorInt
        inkController?.setStrokeStyle(widthPx, colorInt)
    }

    /** Surface-px y below which writing is allowed; pen above it (the toolbar) is ignored. */
    fun setWritingTop(topPx: Int) {
        writingTopPx = topPx
        inkController?.setWritingTop(topPx)
    }

    fun setWritingExclusion(left: Int, top: Int, right: Int, bottom: Int) {
        exclRect.set(left, top, right, bottom)
        inkController?.setWritingExclusion(left, top, right, bottom)
    }

    /** Confine the daemon pen to [left,top,right,bottom] (surface px); outside is ignored. Empty clears. */
    fun setWritingBounds(left: Int, top: Int, right: Int, bottom: Int) {
        boundsRect.set(left, top, right, bottom)
        inkController?.setWritingBounds(left, top, right, bottom)
    }

    /** Eraser mode: while active the daemon paints no ink (the pen tip erases via the web layer). */
    fun setEraserMode(active: Boolean) {
        eraserMode = active
        inkController?.setEraserMode(active)
    }

    /** Felt pen: vary live stroke width by pen pressure. Stored so it survives re-attach. */
    fun setPressureMode(active: Boolean) {
        pressureMode = active
        inkController?.setPressureMode(active)
    }

    /** Selection pen: dashed live stroke. Stored so it survives re-attach. */
    fun setDashMode(active: Boolean) {
        dashMode = active
        inkController?.setDashMode(active)
    }

    /** Bake one captured animation frame ([bmp], the web region's pixels) onto the surface at
     *  [left],[top] and refresh just that region — FAST (HANDWRITE) for speed, or a clean GU16 every
     *  so often to clear the ghosting the fast mode accumulates. Generic: [bmp] is whatever the web
     *  layer rendered (SVG/CSS/canvas), so any animation works. */
    fun animFrame(bmp: Bitmap, left: Int, top: Int, clean: Boolean) {
        val c = pageCanvas ?: return
        c.drawBitmap(bmp, left.toFloat(), top.toFloat(), null)
        val r = Rect(left, top, left + bmp.width, top + bmp.height)
        if (clean) pageBitmap?.let { inkController?.syncOverlay(it, r, true) }
        else pageBitmap?.let { inkController?.refreshRegionFast(it, r) }
    }

    /** Stop an animation: re-render the page over [region] (clearing the last animation frame). */
    fun animClear(region: Rect) {
        renderFromState(refreshRect = region)
    }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)
        inkController?.setEnabled(enabled)
    }

    /** A finished stroke (surface px): bake into the page, then present + re-prime the daemon
     *  buffer for ONLY the stroke's bounding box, so the EPD partial-refresh is small. */
    fun drawStroke(points: List<PointF>, pressures: List<Float>? = null, dashed: Boolean = false) {
        ensureBitmap()
        val c = pageCanvas ?: return
        paint.pathEffect = if (dashed) dashEffect else null   // selection pen: dashed; restored to null otherwise
        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE
        var maxX = -Float.MAX_VALUE; var maxY = -Float.MAX_VALUE
        for (p in points) {
            if (p.x < minX) minX = p.x
            if (p.y < minY) minY = p.y
            if (p.x > maxX) maxX = p.x
            if (p.y > maxY) maxY = p.y
        }
        var maxW = paint.strokeWidth
        if (pressures != null) {
            val p = Paint(paint)
            maxW = drawStrokeVariable(c, points, paint.strokeWidth, pressures.toFloatArray(), p)
        } else {
            drawStrokeInto(c, points, paint)
        }
        // Keep the retained clean-page model current as live daemon strokes arrive. Library
        // thumbnails deliberately recompose from this list (without toolbar/menu bitmaps); if it
        // only changed on a later full render, closing immediately after writing produced a stale
        // preview even though the visible page bitmap contained the new stroke.
        displayedStrokes.add(
            StrokeRender(
                points.map { PointF(it.x, it.y) },
                paint.strokeWidth,
                pressures?.toFloatArray(),
                paint.color,
                dashed
            )
        )
        val pad = (maxW + 4f).toInt()
        val dirty = Rect(
            (minX.toInt() - pad).coerceAtLeast(0),
            (minY.toInt() - pad).coerceAtLeast(0),
            (maxX.toInt() + pad).coerceAtMost(width),
            (maxY.toInt() + pad).coerceAtMost(height)
        )
        commitPage(dirty)
        // Full daemon-buffer reset to the clean page (inkit's way) so A2 ghosting can't build up.
        // force=false → no extra EPD refresh, just a buffer blit; the visible refresh is the small
        // partial commitPage above.
        pageBitmap?.let { inkController?.syncOverlay(it, null, false) }
    }

    /** Re-render the whole page from the model (load / undo / erase / template / page change):
     *  white + template + all strokes. All coords in surface px. */
    fun renderPage(
        templateType: String, spacing: Float, margin: Float, dpr: Float, bounds: Rect,
        strokes: List<StrokeRender>, refreshRect: Rect? = null, defer: Boolean = false, eraseRect: Rect? = null
    ) {
        rTemplate = templateType; rSpacing = spacing; rMargin = margin; rDpr = dpr; rBounds.set(bounds)
        displayedStrokes.clear()
        displayedStrokes.addAll(strokes)
        // Carry the erase region through the deferred DOM snapshot. Clean only AFTER
        // composing authoritative content/vectors; cleaning the old bitmap resurrects ink.
        if (eraseRect != null && !eraseRect.isEmpty) {
            val pending = pendingEraseClean
            if (pending == null) pendingEraseClean = Rect(eraseRect) else pending.union(eraseRect)
        }
        // Model-only update: snapshotContent immediately follows and performs
        // the one canonical render + EPD presentation. Rendering here as well
        // creates a redundant SurfaceFlinger compose/refresh that can collide
        // with the next Bigme pen-down.
        if (defer) return
        // A refresh rect (erase) → immediate, partial GU16 refresh of just that region (no shell-first).
        renderFromState(refreshRect)
    }

    /** Repaint the page from the retained state. [refreshRect] (surface px) limits the e-ink
     *  force-refresh to that region (erase); null = full-screen refresh. */
    private fun renderFromState(refreshRect: Rect? = null) {
        ensureBitmap()
        val c = pageCanvas ?: return
        c.drawColor(Color.WHITE)
        drawContent(c)
        drawTemplate(c, rTemplate, rSpacing, rMargin, rDpr, rBounds)
        // Compose paper, typed content, vectors and foreground controls before
        // presenting. Shell-first made larger pages visibly load in two stages.
        drawDisplayedStrokes(c)
        drawChrome(c)
        commitPage(refreshRect)
        primeResumedPage()
        // A removed word needs clean GU16, but only over its dirty region.
        pageBitmap?.let { inkController?.syncOverlay(it, refreshRect ?: paperRegion(), true) }
        val eraseClean = pendingEraseClean
        pendingEraseClean = null
        if (eraseClean != null) pageBitmap?.let { inkController?.syncOverlayClean(it, eraseClean) }
    }

    private fun drawDisplayedStrokes(c: Canvas) {
        val p = Paint(paint)
        for (s in displayedStrokes) {
            p.color = s.colorInt                                  // per-stroke ink color (the palette)
            p.pathEffect = if (s.dashed) dashEffect else null     // selection pen → dashed
            if (s.pressures != null) {
                drawStrokeVariable(c, s.points, s.width, s.pressures, p)   // felt: variable width
            } else {
                p.strokeWidth = s.width
                drawStrokeInto(c, s.points, p)
            }
        }
    }

    private fun drawChrome(c: Canvas) {
        toolbarBitmap?.let { c.drawBitmap(it, 0f, 0f, null) }
        menuBitmap?.let { c.drawBitmap(it, menuLeft.toFloat(), menuTop.toFloat(), null) }
    }

    /** Re-composite the whole page and repaint both chrome bars. This e-ink panel may silently drop
     *  one full-width or full-height invalidation even though small button-sized refreshes work, so
     *  the open-time refresh is deliberately split into reliable tiles. */
    fun refreshChrome() {
        ensureBitmap()
        val c = pageCanvas ?: return
        c.drawColor(Color.WHITE)
        drawContent(c)
        drawTemplate(c, rTemplate, rSpacing, rMargin, rDpr, rBounds)
        drawDisplayedStrokes(c)
        drawChrome(c)
        commitPage()
        val bmp = pageBitmap ?: return
        val ctrl = inkController ?: return
        toolbarBitmap?.let { tileRefresh(ctrl, bmp, 0, 0, minOf(it.width, width), minOf(it.height, height)) }
        menuBitmap?.let {
            tileRefresh(ctrl, bmp, menuLeft, menuTop,
                minOf(menuLeft + it.width, width), minOf(menuTop + it.height, height))
        }
    }

    /** GU16-refresh [left, top, right, bottom] as modest tiles. Keep these below the largest rects
     *  observed to land reliably on the Bigme panel (unlike a 1264px strip or 1290px rail). */
    private fun tileRefresh(ctrl: InkController, bmp: Bitmap, left: Int, top: Int, right: Int, bottom: Int) {
        val tileW = 440
        val tileH = 440
        var y = top
        while (y < bottom) {
            val b = minOf(y + tileH, bottom)
            var x = left
            while (x < right) {
                val r = minOf(x + tileW, right)
                ctrl.syncOverlay(bmp, Rect(x, y, r, b), true)
                x += tileW
            }
            y += tileH
        }
    }

    /** Draw a felt stroke as per-segment lines whose width tracks pen pressure (round caps/joins blend
     *  the segments). Returns the max width used (for the dirty-rect pad). */
    private fun drawStrokeVariable(c: Canvas, points: List<PointF>, base: Float, pressures: FloatArray, p: Paint): Float {
        if (points.isEmpty()) return base
        var maxW = 0f
        if (points.size == 1) {
            val w = InkDefaults.pressureToWidth(base, pressures.getOrElse(0) { 0.5f })
            val dot = Paint(p).apply { style = Paint.Style.FILL }
            c.drawCircle(points[0].x, points[0].y, w / 2f, dot)
            return w
        }
        for (i in 1 until points.size) {
            // average the endpoints' pressure for the segment
            val pr = (pressures.getOrElse(i) { 0.5f } + pressures.getOrElse(i - 1) { 0.5f }) / 2f
            val w = InkDefaults.pressureToWidth(base, pr)
            if (w > maxW) maxW = w
            p.strokeWidth = w
            c.drawLine(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, p)
        }
        return maxW
    }

    private fun paperRegion(): Rect? =
        if (rBounds.width() > 0 && rBounds.height() > 0) Rect(rBounds) else null

    /** Bake the FULL web toolbar strip onto the top of the page + GU16-refresh that strip. Called
     *  once per open (the toolbar is otherwise static; targeted region updates handle changes). */
    fun setToolbarSnapshot(bmp: Bitmap) {
        ensureBitmap()
        toolbarBitmap = bmp
        val c = pageCanvas
        if (c == null) return
        c.drawBitmap(bmp, 0f, 0f, null)
        val dirty = Rect(0, 0, minOf(bmp.width, width), minOf(bmp.height, height))
        commitPage(dirty)
        pageBitmap?.let { inkController?.syncOverlay(it, dirty, true) }
    }

    /** Update just a sub-region of the baked toolbar (a button cluster / the page number) and
     *  EPD-refresh ONLY that rect — no whole-strip re-bake, no flash. Keeps the cached toolbarBitmap
     *  in step so a later full page render doesn't revert the change. */
    fun setToolbarSnapshotRegion(bmp: Bitmap, x: Int, y: Int) {
        ensureBitmap()
        val c = pageCanvas ?: return
        // Keep whichever persistent chrome bitmap overlaps this region in sync. Notes updates
        // selected pen/page controls in the top strip; the classic UI updates its floating menu.
        toolbarBitmap?.let { tb ->
            if (x < tb.width && y < tb.height && x + bmp.width > 0 && y + bmp.height > 0) {
                try { Canvas(tb).drawBitmap(bmp, x.toFloat(), y.toFloat(), null) } catch (_: Exception) {}
            }
        }
        menuBitmap?.let { mb ->
            if (x < menuLeft + mb.width && y < menuTop + mb.height && x + bmp.width > menuLeft && y + bmp.height > menuTop) {
                try { Canvas(mb).drawBitmap(bmp, (x - menuLeft).toFloat(), (y - menuTop).toFloat(), null) } catch (_: Exception) {}
            }
        }
        c.drawBitmap(bmp, x.toFloat(), y.toFloat(), null)
        val rect = Rect(x, y, x + bmp.width, y + bmp.height)
        commitPage(rect)
        pageBitmap?.let { inkController?.syncOverlay(it, rect, true) }
        // HWUI may consume this snapshot after drawBitmap returns; automatic reclamation is safe.
    }

    /** The floating collapsible menu: [bmp] is its current snapshot, drawn at ([left],[top]); it
     *  becomes the persistent overlay (redrawn over the page on every render). [refreshRect] (surface
     *  px) is the area to re-render + EPD-refresh — the UNION of the menu's old and new bounds so that
     *  collapsing a wide/tall menu clears the area it used to cover back to the page. */
    fun setMenuSnapshot(bmp: Bitmap, left: Int, top: Int, refreshLeft: Int, refreshTop: Int, refreshRight: Int, refreshBottom: Int) {
        ensureBitmap()
        menuBitmap = bmp
        menuLeft = left
        menuTop = top
        val c = pageCanvas
        if (c == null) return
        // Re-render the page (clears the old menu footprint to paper) then draw the new menu on top.
        c.drawColor(Color.WHITE)
        drawContent(c)
        drawTemplate(c, rTemplate, rSpacing, rMargin, rDpr, rBounds)
        drawDisplayedStrokes(c)
        drawChrome(c)
        val refresh = Rect(refreshLeft, refreshTop, refreshRight, refreshBottom)
        commitPage(refresh)
        primeResumedPage()
        pageBitmap?.let { inkController?.syncOverlay(it, refresh, true) }
    }

    /** Draw the baked interactive-format content at the paper origin (under template + strokes). */
    private fun drawContent(c: Canvas) {
        val b = contentBitmap ?: return
        c.drawBitmap(b, rBounds.left.toFloat(), rBounds.top.toFloat(), null)
    }

    /** Skip the full-screen wake refresh on the next attach (for a partial sticky-note open). */
    fun setSkipNextWake() { skipNextWake = true }

    /** Same editor/geometry returning from a transient WebView dialog. The panel already shows
     * the page. Prime the entire new daemon buffer without invalidating it, then reconcile only
     * the supplied dirty controls. Cold opens, geometry changes and hard exits never use this. */
    fun prepareWebResume() { webResume = true }

    private fun primeResumedPage() {
        if (!primeResumeBuffer || inkController == null) return
        pageBitmap?.let { inkController?.syncOverlay(it, null, false) }
        primeResumeBuffer = false
    }

    /** Set (or clear, with null) the baked content layer + re-render the page so it appears under the
     *  ink. [bmp] is the paper-region snapshot from the WebView content layer (paper-px size).
     *  [refreshRect] (surface px) limits the EPD refresh to that region — a sticky-note open passes the
     *  note box so only it refreshes; null = full refresh. */
    fun setContentSnapshot(bmp: Bitmap?, refreshRect: Rect? = null) {
        contentBitmap = bmp
        renderFromState(refreshRect = refreshRect)
    }

    private fun drawTemplate(c: Canvas, type: String, spacing: Float, margin: Float, dpr: Float, bounds: Rect) {
        if (spacing <= 0f) return
        val w = bounds.width().toFloat()
        val h = bounds.height().toFloat()
        val left = bounds.left.toFloat()
        val top = bounds.top.toFloat()
        val marginX = minOf(margin, w * 0.15f)
        // Solid monochrome paper; keep CSS, thumbnail and native geometry aligned.
        val line = Paint().apply {
            color = Color.BLACK; style = Paint.Style.STROKE; strokeWidth = 1.0f * dpr; isAntiAlias = true
        }
        val dot = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL; isAntiAlias = true }
        when (type) {
            "weekly", "cornell" -> {
                c.save()
                c.translate(left, top)
                c.scale(w / 572f, h / 772f)
                val rules = Paint(line).apply { strokeWidth = 2f }
                val labels = Paint(dot).apply { textSize = 16f; typeface = android.graphics.Typeface.DEFAULT }
                if (type == "weekly") {
                    for (i in 0..7) c.drawLine(24f, 36f + i * 100f, 548f, 36f + i * 100f, rules)
                    listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday").forEachIndexed { i, day ->
                        c.drawText(day, 24f, 60f + i * 100f, labels)
                    }
                } else {
                    c.drawLine(143f, 32f, 143f, 636f, rules)
                    c.drawLine(24f, 636f, 548f, 636f, rules)
                    for (i in 0..12) c.drawLine(143f, 64f + i * 44f, 548f, 64f + i * 44f, rules)
                    c.drawText("Cues", 24f, 24f, labels)
                    c.drawText("Notes", 155f, 24f, labels)
                    c.drawText("Summary", 24f, 660f, labels)
                }
                c.restore()
            }
            "ruled" -> {
                var y = spacing; while (y < h) { c.drawLine(left, top + y, left + w, top + y, line); y += spacing }
                val mp = Paint(line).apply { color = Color.BLACK }
                c.drawLine(left + marginX, top, left + marginX, top + h, mp)
            }
            "grid" -> {
                var x = marginX; while (x < w) { c.drawLine(left + x, top, left + x, top + h, line); x += spacing }
                var y = spacing; while (y < h) { c.drawLine(left, top + y, left + w, top + y, line); y += spacing }
            }
            "dotted" -> {
                var x = marginX
                while (x < w) {
                    var y = spacing
                    while (y < h) { c.drawCircle(left + x, top + y, 1.5f * dpr, dot); y += spacing }
                    x += spacing
                }
            }
        }
    }

    fun clearPage() {
        pageBitmap?.eraseColor(Color.WHITE)
        commitPage()
        pageBitmap?.let { inkController?.syncOverlay(it, null, false) }
    }

    private fun drawStrokeInto(c: Canvas, points: List<PointF>, p: Paint) {
        if (points.isEmpty()) return
        if (points.size == 1) {
            val pt = points[0]
            val dot = Paint(p).apply { style = Paint.Style.FILL }
            c.drawCircle(pt.x, pt.y, p.strokeWidth / 2f, dot)
            return
        }
        path.reset()
        path.moveTo(points[0].x, points[0].y)
        for (i in 1 until points.size) path.lineTo(points[i].x, points[i].y)
        c.drawPath(path, p)
    }

    private fun commitPage(dirty: Rect? = null) {
        if (!surfaceReady) return
        val bmp = pageBitmap ?: return
        val controller = inkController
        if (InkDiagnostics.enabled) InkDiagnostics.bitmap("host.submit", bmp, mapOf("view" to System.identityHashCode(this),
            "bitmap" to System.identityHashCode(bmp), "controller" to controller?.let { System.identityHashCode(it) },
            "dirty" to dirty?.toShortString(), "surfaceReady" to surfaceReady, "strokes" to displayedStrokes.size))
        val needSuspend = controller != null && controller.ownsSurface && controller.isActive
        if (needSuspend) controller?.setEnabled(false)
        try {
            val canvas = (if (dirty != null) holder.lockCanvas(dirty) else holder.lockCanvas()) ?: return
            try {
                canvas.drawBitmap(bmp, 0f, 0f, null)
            } finally {
                holder.unlockCanvasAndPost(canvas)
                trace("host.posted", mapOf("dirty" to dirty?.toShortString()))
            }
        } catch (t: Throwable) {
            // surface being torn down — ignore
        } finally {
            if (needSuspend) controller?.setEnabled(true)
        }
    }

    /** A library thumbnail of the current page: re-render the retained paper/content/ink state
     *  without [toolbarBitmap] or [menuBitmap], then fit the whole page inside a fixed 3:4 frame.
     *  Copying pixels directly from [pageBitmap] used to bake floating editor controls into note
     *  previews; centre-cropping also discarded the page edges. */
    fun captureThumbnail(targetWidth: Int): Bitmap? {
        val src = pageBitmap ?: return null
        val pw = rBounds.width()
        val ph = rBounds.height()
        if (pw <= 0 || ph <= 0) return null
        val tw = targetWidth
        val th = targetWidth * 4 / 3
        val thumb = Bitmap.createBitmap(tw, th, Bitmap.Config.ARGB_8888)
        // Recompose a clean source without drawChrome(). This also removes a toolbar snapshot that
        // overlaps the paper bounds, rather than relying on geometry to happen to crop it away.
        val paperOnly = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val paperCanvas = Canvas(paperOnly)
        paperCanvas.drawColor(Color.WHITE)
        drawContent(paperCanvas)
        drawTemplate(paperCanvas, rTemplate, rSpacing, rMargin, rDpr, rBounds)
        drawDisplayedStrokes(paperCanvas)
        val scale = minOf(tw.toFloat() / pw, th.toFloat() / ph)
        val dw = pw * scale
        val dh = ph * scale
        val dx = (tw - dw) / 2f
        val dy = (th - dh) / 2f
        val thumbCanvas = Canvas(thumb)
        thumbCanvas.drawColor(Color.WHITE)
        /*
         * Thumbnail scaling is a real reduction (typically about 1200 px → 320 px). Android's
         * default bitmap paint uses nearest-neighbour sampling, which can skip an entire one-pixel
         * rule or alternate pieces of a thin curved stroke. That produced the broken rules and
         * incomplete handwriting visible in the Notes shelf even though the source page was intact.
         *
         * Filter and dither the clean paper bitmap into a floating-point destination. This is the
         * native-authoritative path used by Bigme. Standard applies the same sampling flags in
         * InkManager.scaleWebThumbnail() to its authoritative WebView capture. Neither path changes
         * live ink or panel refresh policy.
         */
        val thumbnailPaint = Paint(
            Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG
        )
        thumbCanvas.drawBitmap(
            paperOnly,
            rBounds,
            RectF(dx, dy, dx + dw, dy + dh),
            thumbnailPaint
        )
        paperOnly.recycle()
        return thumb
    }

    fun isAttached(): Boolean = attached

}
