package com.kalamos.notebook.bridge

import com.kalamos.device.api.ink.InkDiagnostics
import com.kalamos.notebook.diagnostics.InkTraceRecorder
import android.graphics.PointF
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import com.kalamos.device.api.DeviceRegistry
import com.kalamos.device.api.ink.InkController
import com.kalamos.device.api.ink.StrokeCallback
import com.kalamos.notebook.view.InkSurfaceView

class InkManager(
    private val inkSurfaceView: InkSurfaceView,
    private val webView: WebView
) {

    init {
        try { InkTraceRecorder.startIfEnabled(webView.context) }
        catch (error: Exception) { Log.w("InkTrace", "Diagnostic startup failed", error) }
    }
    private var diagnosticNotebook = ""
    private var diagnosticPage = ""
    private fun trace(name: String, fields: Map<String, Any?> = emptyMap()) {
        if (InkDiagnostics.enabled) InkDiagnostics.event(name, fields + mapOf("view" to System.identityHashCode(inkSurfaceView),
            "manager" to System.identityHashCode(this), "generation" to attachGeneration,
            "notebook" to diagnosticNotebook, "page" to diagnosticPage))
    }
    /** Android stop is the last synchronous ownership boundary; a paused WebView may never
     * finish its checkpoint. Flush the current owner, then retire without painting over the next app. */
    fun onHostStopped() {
        hostLifecycle.stop()
        detach(clearDisplay = false)
    }
    fun onHostResumed() { hostLifecycle.resume() }
    fun isInkSessionAttached(): Boolean = attached && inkSurfaceView.isAttached()

    fun traceHostLifecycle(phase: String, host: String?) {
        trace("host.$phase", mapOf("activity" to host))
    }
    fun traceEvent(name: String, json: String) {
        if (!InkDiagnostics.enabled) return
        mainHandler.post {
            try {
                val data = org.json.JSONObject(json)
                trace(name.take(64), data.keys().asSequence().associateWith { data.get(it) })
            } catch (_: Exception) { trace("js.traceMalformed") }
        }
    }
    fun traceSession(notebook: String, page: String, phase: String) {
        if (!InkDiagnostics.enabled) return
        mainHandler.post { diagnosticNotebook = notebook; diagnosticPage = page; trace("owner.$phase") }
    }
    @Volatile private var attached = false
    private val hostLifecycle = InkHostLifecycle()
    private var attachGeneration = 0
    private var captureEpoch = 0
    private var currentBounds = Rect()
    private var lastBox: Rect? = null
    private var webResumeBox: Rect? = null
    private var strokeWidthPx = 3f
    private val mainHandler = Handler(Looper.getMainLooper())
    init { trace("manager.created", mapOf("context" to inkSurfaceView.context.javaClass.name)) }

    // Points of the in-progress stroke (surface px). Reused each stroke.
    private val pointBuffer = ArrayList<PointF>()
    // Per-point pen pressure (0..1), parallel to pointBuffer — used by the felt pen for width.
    private val pressureBuffer = ArrayList<Float>()
    // Felt pen active (vary width by pressure) vs ballpoint (constant width).
    @Volatile private var feltMode = false
    // Selection pen active (dashed line).
    @Volatile private var dashMode = false


    // Finished strokes accumulated NATIVELY as JSON, flushed to the JS model in ONE
    // evaluateJavascript only after the pen pauses. So the writing burst runs zero JS / no
    // WebView round-trips — only the native page render (drawStroke) happens per stroke.
    private val batchBuffer = StringBuilder()
    private var batchCount = 0
    private val flushRunnable = Runnable { flushToJs() }
    // The heavy disk save (JSON.stringify whole notebook + write) is separate from the cheap model
    // update, and only fires after a LONG true-idle window — both cancelled on pen-down — so a save
    // can never run while the user is still writing (that was the residual mid-page hiccup).
    private val saveRunnable = Runnable { requestSaveInJs() }

    // True while the web layer is erasing (stylus eraser detected). The daemon's tool detection is
    // unreliable and can mis-paint an eraser swipe as a pen stroke, so we discard any daemon stroke
    // while erasing — the web layer's eraser detection is the authority.
    @Volatile private var erasing = false

    /** SPA routing: show the editor. Makes the ink surface visible but keeps the WebView opaque so it
     *  covers the still-blank/loading ink surface while the notebook loads and the daemon attaches.
     *  Call showEditor() (from JS via onInkControllerReady) to reveal the surface once it has done its
     *  first GU16 — that way the WebView never goes transparent over a blank or stale ink surface. */
    fun enterEditor() {
        mainHandler.post {
            inkSurfaceView.alpha = 1f
            inkSurfaceView.visibility = android.view.View.VISIBLE
            // WebView stays opaque until showEditor() is called.
        }
    }

    /** Reveal the editor: make WebView transparent so the ink surface shows through. Called from JS
     *  (window.onInkSdkReady) once the daemon has attached and done its first GU16, ensuring the
     *  e-ink panel is clean before the reader/library content is uncovered. */
    fun showEditor() {
        mainHandler.post {
            webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        }
    }

    /** SPA routing: show the library. Hide the ink surface and make the WebView opaque so the
     *  library view is the sole visible layer. (detach() is called separately by the web layer.) */
    fun enterLibrary() {
        mainHandler.post {
            inkSurfaceView.alpha = 1f
            inkSurfaceView.visibility = android.view.View.GONE
            webView.setBackgroundColor(android.graphics.Color.WHITE)
        }
    }

    /** Sticky-note PARTIAL mode: resize the ink surface to just the note box [l,t,r,b] (surface px)
     *  and attach the daemon there. Only that small region is a surface, so only it refreshes — the
     *  WebView reader shows through everywhere else (no full-screen flash). The box surface's origin is
     *  (0,0) = the box top-left, so strokes come back in box-local coords. */
    fun resumeInkBox(l: Int, t: Int, r: Int, b: Int) = attachInkBox(l, t, r, b, true)

    fun attachInkBox(l: Int, t: Int, r: Int, b: Int, resume: Boolean = false) {
        val hostTicket = hostLifecycle.hostTicket()
        mainHandler.post {
            if (!hostLifecycle.acceptsHost(hostTicket)) return@post
            val ticket = hostLifecycle.request()
            /*
             * Do not trust the WebView's device-pixel viewport as the final panel size. On Bigme,
             * window.innerWidth * devicePixelRatio has repeatedly rounded to 1073x1449 while this
             * measured Android host is 1072x1448. HandwrittenClient.updateLayout() rejects that
             * one-pixel overflow BEFORE rebuilding its canvas Matrix; ignoring the false result
             * either disables the pen engine or exposes the rotated ION layer when writing.
             *
             * Clamp here, at the WebView/native boundary, so all callers and device backends share
             * one authoritative rule. Keep the JavaScript clamp as an early guard, not authority.
             */
            val host = inkSurfaceView.parent as? android.view.View
            val hostWidth = host?.width?.takeIf { it > 0 }
                ?: webView.width.takeIf { it > 0 }
            val hostHeight = host?.height?.takeIf { it > 0 }
                ?: webView.height.takeIf { it > 0 }
            val requested = InkBoxBounds(l, t, r, b)
            val box = clampInkBoxToHost(requested, hostWidth ?: 0, hostHeight ?: 0)
            if (box == null) {
                Log.w(TAG, "attachInkBox deferred: native host has no measured size; requested=$requested")
                return@post
            }
            if (box != requested) {
                Log.w(
                    TAG,
                    "attachInkBox clamped requested=$requested host=${hostWidth}x$hostHeight to=$box",
                )
            }
            val nextBox = Rect(box.left, box.top, box.right, box.bottom)
            val resumeFrame = resume && webResumeBox == nextBox
            webResumeBox = null
            lastBox = nextBox
            if (resumeFrame) {
                Log.i(TAG, "resumeInkBox: same-frame partial presentation box=$nextBox")
                inkSurfaceView.prepareWebResume()
            } else if (resume) {
                // A pause or host resize may invalidate the retained frame after JS requests it.
                // Tell the handler before readiness so its replay also takes the cold-open path.
                postToWeb("window._inkHandler?.onNativeResumeRejected?.()")
            }
            val w = box.right - box.left
            val h = box.bottom - box.top
            val persistentDisplay =
                DeviceRegistry.require(webView.context).supportsPersistentDisplayHandoff
            if (!persistentDisplay) {
                /*
                 * Standard Android drops a hidden SurfaceView's pixels, so toolbar/tool handoff
                 * temporarily makes WebView authoritative. Keep that already-painted DOM opaque
                 * while the replacement surface is created and attached; showEditor() removes this
                 * cover only after JS receives controller-ready and renders the authoritative page.
                 *
                 * Do not apply this background transition to Bigme. Its accepted sequence relies
                 * on retained physical panel pixels, and forcing a whole-WebView background change
                 * there can turn a bounded handoff into a visible full-panel refresh.
                 */
                webView.setBackgroundColor(android.graphics.Color.WHITE)
            }
            val lp = (inkSurfaceView.layoutParams as? android.widget.FrameLayout.LayoutParams)
                ?: android.widget.FrameLayout.LayoutParams(w, h)
            lp.width = w
            lp.height = h
            lp.leftMargin = box.left
            lp.topMargin = box.top
            lp.gravity = android.view.Gravity.TOP or android.view.Gravity.START

            // This base-layer SurfaceView punches a transparent hole in the window over its WHOLE rect.
            // If its surface were ever created while still sized full-screen (its size left over from the
            // last full editor attach), the hole would cover the ENTIRE reader for a frame — and a
            // persistent e-ink panel LATCHES that full-screen white, hiding all the page content until a
            // tap forces a refresh. So we must NEVER create the surface at the wrong size: the view stays
            // INVISIBLE (laid out, but no surface/hole) until a layout pass CONFIRMS the box dimensions,
            // and only then flips to VISIBLE — so the surface's first and only appearance is the box.
            var shown = false
            val showAndAttach = Runnable {
                if (shown || !hostLifecycle.accepts(ticket)) return@Runnable
                shown = true
                inkSurfaceView.alpha = 1f
                inkSurfaceView.visibility = android.view.View.VISIBLE
                Log.i(
                    TAG,
                    "attachInkBox show box=${w}x$h surf=${inkSurfaceView.width}x${inkSurfaceView.height} " +
                        "@(${box.left},${box.top}) host=${hostWidth}x$hostHeight",
                )
                attach(Rect(0, 0, w, h))   // limit = the whole box; origin (0,0) = box top-left
            }

            // Already laid out at the box size (e.g. a same-size reattach) → safe to show immediately.
            if (inkSurfaceView.visibility != android.view.View.GONE &&
                inkSurfaceView.width == w && inkSurfaceView.height == h) {
                inkSurfaceView.layoutParams = lp
                showAndAttach.run()
                return@post
            }
            inkSurfaceView.visibility = android.view.View.INVISIBLE
            inkSurfaceView.addOnLayoutChangeListener(object : android.view.View.OnLayoutChangeListener {
                override fun onLayoutChange(v: android.view.View, left: Int, top: Int, right: Int, bottom: Int,
                                            ol: Int, ot: Int, oright: Int, ob: Int) {
                    if (!hostLifecycle.accepts(ticket)) {
                        v.removeOnLayoutChangeListener(this)
                        return
                    }
                    if (v.width == w && v.height == h) {   // box-sized layout has landed
                        v.removeOnLayoutChangeListener(this)
                        showAndAttach.run()
                    }
                }
            })
            inkSurfaceView.layoutParams = lp   // triggers the layout pass the listener waits for
        }
    }

    /** Leave sticky-note partial mode: detach, hide the surface, restore it to full screen. */
    fun detachInkBox() {
        mainHandler.post {
            // clearDisplay=false: the reader behind the note box must stay visible — don't GU16 white.
            detach(clearDisplay = false)   // flushes pending strokes → onStrokesBatch → Reader.onNoteStrokes
            postToWeb("window.onNoteFlushed && window.onNoteFlushed()")   // then the reader finalizes/saves
            inkSurfaceView.visibility = android.view.View.GONE
            val lp = (inkSurfaceView.layoutParams as? android.widget.FrameLayout.LayoutParams) ?: return@post
            lp.width = android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            lp.height = android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            lp.leftMargin = 0; lp.topMargin = 0
            inkSurfaceView.layoutParams = lp
        }
    }

    /** Leave a full editor that happens to use box geometry. Unlike a reader
     * sticky note, its old pixels must be cleared before disconnecting or the
     * persistent e-ink panel and next daemon session can expose the previous
     * notebook's strokes. */
    fun detachInkBoxCleared() {
        mainHandler.post {
            Log.i(TAG, "detachInkBoxCleared: flush and clear full-editor buffer")
            detach(clearDisplay = true)
            inkSurfaceView.visibility = android.view.View.GONE
            val lp = (inkSurfaceView.layoutParams as? android.widget.FrameLayout.LayoutParams) ?: return@post
            lp.width = android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            lp.height = android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            lp.leftMargin = 0
            lp.topMargin = 0
            inkSurfaceView.layoutParams = lp
        }
    }

    /**
     * Temporarily hand a full ruled editor from native pen input to WebView-driven tools.
     *
     * The two branches below are intentionally device capabilities, not manufacturer checks:
     *
     * - Bigme keeps its established behavior. Its physical panel retains the submitted frame after
     *   the SurfaceView is detached and hidden.
     * - A normal Android display loses hidden surface pixels immediately. Its WebView prepares a
     *   DOM page/ink preview before this call, so the surface can be hidden without blanking.
     *
     * Do not merge these paths without physical testing on both display types. Sending an extra
     * frame or leaving the surface visible changes Bigme refresh/composition behavior.
     */
    fun detachInkBoxForWeb() {
        mainHandler.post {
            val persistentDisplay =
                DeviceRegistry.require(webView.context).supportsPersistentDisplayHandoff
            if (persistentDisplay) {
                // Device-verified Bigme sequence: preserve the panel frame, discard native retained
                // state, then reveal the already-painted WebView. Keep this branch behavior stable.
                Log.i(TAG, "detachInkBoxForWeb: persistent display handoff")
                detach(clearDisplay = false)
                inkSurfaceView.visibility = android.view.View.GONE
            } else {
                // Standard Android SurfaceView pixels neither persist when hidden nor reliably sit
                // beneath interactive WebView chrome. The workspace has already enabled its DOM
                // ink preview, so use the ordinary ownership boundary and reveal that composition.
                Log.i(TAG, "detachInkBoxForWeb: WebView composition for standard display")
                detach(clearDisplay = false)
                inkSurfaceView.visibility = android.view.View.GONE
            }
            webResumeBox = lastBox?.let { Rect(it) }
            restoreFullScreenLayout()
        }
    }

    /** Keep Web mode visible across repeated layout callbacks after native ownership is released. */
    fun showWebWorkspace() {
        mainHandler.post {
            inkSurfaceView.visibility = android.view.View.GONE
            restoreFullScreenLayout()
        }
    }

    /** Return the shared SurfaceView to its neutral layout after any box-mode owner disconnects. */
    private fun restoreFullScreenLayout() {
        val lp = (inkSurfaceView.layoutParams as? android.widget.FrameLayout.LayoutParams) ?: return
        lp.width = android.widget.FrameLayout.LayoutParams.MATCH_PARENT
        lp.height = android.widget.FrameLayout.LayoutParams.MATCH_PARENT
        lp.leftMargin = 0
        lp.topMargin = 0
        inkSurfaceView.layoutParams = lp
    }

    /** Web layer tells us it's erasing (button mode or stylus eraser). The daemon paints no ink so
     *  the pen tip erases via the web layer; we also drop any daemon stroke as a backstop. */
    fun setErasing(active: Boolean) {
        erasing = active
        inkSurfaceView.setEraserMode(active)
    }

    // ---- Generic web-region animation ----
    // The animation is defined entirely in the WEB layer (SVG/CSS/canvas/JS). This whole loop ONLY
    // runs while an animation is active (animRunning) — it's started by the web layer (startWebAnim)
    // and stopped on toggle-off / page-change / leaving the editor. Plain pages/notebooks pay nothing.
    // Each frame native drives the web clock (window.__animTick) so the animation keeps advancing even
    // though a software-layered/occluded WebView throttles its own requestAnimationFrame.
    @Volatile private var animRunning = false
    private val animRect = Rect()
    private var animFrameIdx = 0
    private var animClockMs = 0L     // the web animation clock (real-time, advanced by the frame interval)

    // Cached SystemProperties.get so the per-frame interval lookup is cheap (tunable without a rebuild).
    private val spGet: java.lang.reflect.Method? = try {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java, String::class.java)
    } catch (e: Throwable) { null }

    /** Animation frame interval (ms), live-tunable: `setprop debug.kalamos.anim_frame_ms N`. Both the
     *  sample cadence AND the web-clock advance use this, so the bike plays in real time at 1000/N fps.
     *  Raise it (slower fps) if the panel can't refresh the region cleanly at the current rate. */
    private fun animFrameMs(): Long = try {
        (spGet?.invoke(null, "debug.kalamos.anim_frame_ms", "") as? String)?.trim()?.toLongOrNull()?.coerceIn(33L, 1000L) ?: ANIM_FRAME_MS
    } catch (e: Throwable) { ANIM_FRAME_MS }

    /** Editor animation "band" mode panel policy: while active, stop the periodic full-screen clean
     *  (and anti-flicker) so the continuous animation + the pen's fast refresh don't get interrupted by
     *  a whole-panel de-ghost (which made writing feel slow). Restored to the default on exit. */
    fun setAnimationPanel(active: Boolean) {
        mainHandler.post {
            DeviceRegistry.require(webView.context).setAnimationDisplay(webView.context, active)
        }
    }

    /** Temporary whole-app fast waveform while the user pans/retargets the live WebView. The ink
     * surface is detached during this mode, so MODE_FAST can prioritize responsive document motion;
     * returning to Ink mode restores the everyday COMIC policy before the daemon is reattached. */
    fun setInteractivePanel(active: Boolean) {
        mainHandler.post {
            DeviceRegistry.require(webView.context).setInteractiveDisplay(webView.context, active)
        }
    }

    /** Start sampling + fast-refreshing the WebView region [l,t,r,b] (surface px). */
    fun startWebAnim(l: Int, t: Int, r: Int, b: Int) {
        mainHandler.post {
            animRect.set(l, t, r, b)
            animFrameIdx = 0
            animClockMs = 0L
            animRunning = true
            // Do NOT change the global refresh MODE (that flashed the whole screen). Just stop the
            // system's periodic full-screen de-ghost CLEAN while animating — that recurring clean is
            // the flash layered over our region refresh — and let the panel refresh aggressively. Only
            // the animation box is refreshed per frame (regional inValidate in refreshRegionFast); the
            // rest of the panel keeps its normal mode. Restored by setDefaultMode() on stop.
            DeviceRegistry.require(webView.context).setAnimationDisplay(webView.context, true)
            // Software layer so webView.draw() captures live content (the HW draw() is blank). Held
            // for the whole animation (no per-frame flip); writing is daemon-owned and unaffected.
            webView.setLayerType(android.view.View.LAYER_TYPE_SOFTWARE, null)
            webView.postDelayed({ if (animRunning) scheduleAnimFrame() }, 60)
        }
    }

    /** One animation step: drive the web clock, THEN sample the region once the DOM has advanced.
     *  The occluded/software-layered WebView freezes its own CSS/rAF timers, so motion only advances
     *  because native ticks window.__animTick here; evaluateJavascript's callback runs after the JS
     *  executed, and captureAnimFrame's webView.draw() forces the layout/paint for the new frame.
     *  The interval is sysprop-tunable so we can match the animation rate to what the panel sustains. */
    private fun scheduleAnimFrame() {
        if (!animRunning) return
        webView.evaluateJavascript("window.__animTick && window.__animTick($animClockMs)") {
            if (!animRunning) return@evaluateJavascript
            captureAnimFrame()
            val fm = animFrameMs()
            animClockMs += fm
            animFrameIdx++
            mainHandler.postDelayed({ scheduleAnimFrame() }, fm)
        }
    }

    fun stopWebAnim() {
        mainHandler.post {
            if (!animRunning) return@post
            animRunning = false   // pending scheduleAnimFrame ticks bail on this flag
            webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
            DeviceRegistry.require(webView.context).setAnimationDisplay(webView.context, false)
            inkSurfaceView.animClear(Rect(animRect))
        }
    }

    private fun captureAnimFrame() {
        val w = animRect.width(); val h = animRect.height()
        if (w <= 0 || h <= 0) return
        try {
            val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
            val canvas = android.graphics.Canvas(bmp)
            canvas.translate(-animRect.left.toFloat(), -animRect.top.toFloat())
            webView.draw(canvas)                 // sample the animation region from the web layer
            val t0 = System.nanoTime()
            // Every frame uses the (tunable) fast waveform — no periodic GU16 de-ghost during the
            // waveform experiment, so the chosen mode is what we actually see.
            // DIAG: cheap sparse-grid hash of the CAPTURED bitmap — if it's constant frame-to-frame the
            // WebView raster is frozen (occluded software-layer cache), not an EPD/daemon problem.
            var hash = 0L
            run { var sy = 0; while (sy < bmp.height) { var sx = 0; while (sx < bmp.width) { hash = hash * 31 + bmp.getPixel(sx, sy); sx += 37 }; sy += 37 } }
            inkSurfaceView.animFrame(bmp, animRect.left, animRect.top, false)
            bmp.recycle()
            if (animFrameIdx % 20 == 0)
                Log.i(TAG, "webAnim frame=$animFrameIdx refresh=${(System.nanoTime() - t0) / 1_000_000}ms region=${w}x$h hash=$hash")
        } catch (e: Exception) {
            Log.w(TAG, "captureAnimFrame failed: ${e.message}")
        }
    }

    /** Pen type: "ballpoint" = constant width; "felt" = width by pressure; "selection" = dashed line. */
    fun setPenType(type: String) {
        feltMode = type == "felt"
        dashMode = type == "selection"
        inkSurfaceView.setPressureMode(feltMode)
        inkSurfaceView.setDashMode(dashMode)
    }

    private val strokeCallback = object : StrokeCallback {
        override fun onStrokeBegin(x: Float, y: Float, pressure: Float, timestampMs: Long) {
            if (erasing) return                          // web layer owns this gesture as an eraser
            mainHandler.removeCallbacks(flushRunnable)   // still writing — hold the JS flush + save
            mainHandler.removeCallbacks(saveRunnable)
            pointBuffer.clear()
            pressureBuffer.clear()
            pointBuffer.add(PointF(x, y)); pressureBuffer.add(pressure)
        }

        override fun onStrokeMove(x: Float, y: Float, pressure: Float, timestampMs: Long) {
            if (erasing) return
            pointBuffer.add(PointF(x, y)); pressureBuffer.add(pressure)
        }

        override fun onStrokeEnd(x: Float, y: Float, pressure: Float, timestampMs: Long) {
            if (erasing) return                          // discard daemon-mis-detected eraser stroke
            pointBuffer.add(PointF(x, y)); pressureBuffer.add(pressure)
            // The ONLY per-stroke work during writing: bake into the native page surface.
            inkSurfaceView.drawStroke(pointBuffer, if (feltMode) pressureBuffer else null, dashMode)
            // Stash the vector data natively; model update + save deferred to idle.
            appendStrokeToBatch(pointBuffer, pressureBuffer)
            mainHandler.removeCallbacks(flushRunnable)
            mainHandler.removeCallbacks(saveRunnable)
            scheduleStrokeFlush()
            mainHandler.postDelayed(saveRunnable, SAVE_IDLE_MS)
        }

        override fun onStrokeComplete(points: List<com.kalamos.device.api.ink.StrokePoint>) {
            if (erasing || points.isEmpty()) return
            // BigMe has already painted these samples live on its daemon thread. Replace the DOWN
            // placeholder and commit the model stroke in this single UI-thread callback; controllers
            // that deliver incremental callbacks continue to use onStrokeMove/onStrokeEnd above.
            pointBuffer.clear()
            pressureBuffer.clear()
            points.forEach { point ->
                pointBuffer.add(PointF(point.x, point.y))
                pressureBuffer.add(point.pressure)
            }
            inkSurfaceView.drawStroke(pointBuffer, if (feltMode) pressureBuffer else null, dashMode)
            appendStrokeToBatch(pointBuffer, pressureBuffer)
            mainHandler.removeCallbacks(flushRunnable)
            mainHandler.removeCallbacks(saveRunnable)
            scheduleStrokeFlush()
            mainHandler.postDelayed(saveRunnable, SAVE_IDLE_MS)
        }
    }

    /** A detached controller may already have posted its pen-up to the main queue. Its saved
     * callback must never draw or accumulate that stroke under a newly attached editor. */
    private fun strokeCallbackFor(generation: Int) = object : StrokeCallback {
        private fun current() = generation == attachGeneration && attached
        override fun onStrokeBegin(x: Float,y: Float,pressure: Float,timestampMs: Long) {
            if (current()) strokeCallback.onStrokeBegin(x,y,pressure,timestampMs)
        }
        override fun onStrokeMove(x: Float,y: Float,pressure: Float,timestampMs: Long) {
            if (current()) strokeCallback.onStrokeMove(x,y,pressure,timestampMs)
        }
        override fun onStrokeEnd(x: Float,y: Float,pressure: Float,timestampMs: Long) {
            if (current()) strokeCallback.onStrokeEnd(x,y,pressure,timestampMs)
        }
        override fun onStrokeComplete(points: List<com.kalamos.device.api.ink.StrokePoint>) {
            trace("callback.complete", mapOf("callbackGeneration" to generation, "accepted" to current(), "points" to points.size))
            if (current()) strokeCallback.onStrokeComplete(points)
        }
    }

    // One stroke as JSON: [[x,y,pressure],...]. The web layer keeps the pressure only for felt strokes.
    private fun scheduleStrokeFlush() {
        val delay = strokeFlushDelayMs(pointBuffer.size, { pointBuffer[it].x }, { pointBuffer[it].y }, selection = dashMode)
        if (delay == 60L) Log.i("PERF", "DIAG inkGestureFastFlush delay=$delay samples=${pointBuffer.size}")
        mainHandler.postDelayed(flushRunnable, delay)
    }

    private fun appendStrokeToBatch(points: List<PointF>, pressures: List<Float>) {
        if (batchCount > 0) batchBuffer.append(',')
        batchBuffer.append('[')
        for (i in points.indices) {
            if (i > 0) batchBuffer.append(',')
            batchBuffer.append('[').append(points[i].x.toInt()).append(',').append(points[i].y.toInt())
            batchBuffer.append(',').append(String.format(java.util.Locale.US, "%.3f", pressures.getOrElse(i) { 0.5f })).append(']')
        }
        batchBuffer.append(']')
        batchCount++
    }

    /** Hand all strokes written since the last flush to the active JS ink owner in one call (off
     *  the write hot path). The ruled workspace owns `_inkHandler`; older editors keep the global
     *  callback fallback. Routing directly prevents an app's legacy editor globals from swallowing
     *  a batch that belongs to the core-managed workspace. */
    private fun flushToJs() {
        if (batchCount == 0) return
        val strokesJson = "[$batchBuffer]"
        trace("batch.toJs", mapOf("strokes" to batchCount, "json" to strokesJson))
        postToWeb("""
            (function(strokes) {
              var handler = window._inkHandler;
              if (handler && typeof handler.onNoteStrokes === 'function') {
                handler.onNoteStrokes(strokes);
                console.log('DIAG ruledInkBatch strokes=' + strokes.length);
                return;
              }
              if (typeof window.onStrokesBatch === 'function') window.onStrokesBatch(strokes);
            })($strokesJson)
        """.trimIndent())
        batchBuffer.setLength(0)
        batchCount = 0
    }

    fun attach(rect: Rect) {
        if (!hostLifecycle.isVisible()) return
        trace("manager.attachRequest", mapOf("bounds" to rect.toShortString(), "attached" to attached))
        currentBounds = rect
        val generation = ++attachGeneration
        // Must run on main thread — BigmeInkController.attach() calls bindView()
        // which requires a view with a valid window token on the UI thread.
        mainHandler.post {
            if (generation != attachGeneration || !hostLifecycle.isVisible()) return@post
            val controller = createInkController()
            if (controller != null) {
                fun connect(attempt: Int) {
                    inkSurfaceView.attach(strokeCallbackFor(generation), rect, controller) ready@{ success ->
                        if (generation != attachGeneration) return@ready
                        attached = success
                        Log.i(TAG, "InkController ready: $success (${controller.javaClass.simpleName})")
                        // This callback can run inside SurfaceView's create/layout dispatch. Calling
                        // evaluateJavascript re-entrantly from there can stall the UI thread after the
                        // Bigme daemon has attached but before JS receives "ready", leaving the
                        // transparent editor window showing the launcher underneath. Complete the
                        // surface callback first and deliver readiness on the next UI-loop turn.
                        webView.post {
                            if (generation == attachGeneration)
                                webView.evaluateJavascript("window.onInkControllerReady($success)", null)
                        }
                        // A mapped Canvas can transiently be empty on this firmware.
                        // Never call it ready; retry briefly, but never after ownership changes.
                        if (!success && attempt < 2) mainHandler.postDelayed({
                            if (generation == attachGeneration && !attached) connect(attempt + 1)
                        }, 80L)
                    }
                }
                connect(0)
            } else {
                webView.post {
                    if (generation == attachGeneration)
                        webView.evaluateJavascript("window.onInkControllerReady(false)", null)
                }
            }
        }
    }

    fun detach(clearDisplay: Boolean = true) {
        hostLifecycle.retire()
        trace("manager.detach", mapOf("clearDisplay" to clearDisplay, "attached" to attached, "batchCount" to batchCount))
        attachGeneration++
        captureEpoch++
        webResumeBox = null
        mainHandler.removeCallbacks(flushRunnable)
        mainHandler.removeCallbacks(saveRunnable)
        // Only flush + save on the FIRST detach (back press triggers onPause + onDestroyView, each
        // calling detach) so we don't fire the save 2-3x.
        if (attached) {
            flushToJs()                         // push recent strokes to their active model first
            requestSaveInJs()                   // then let that owner checkpoint if it supports it
        }
        pointBuffer.clear()
        pressureBuffer.clear()
        batchBuffer.setLength(0)
        batchCount = 0
        inkSurfaceView.detach(clearDisplay)
        attached = false
    }

    fun setStyle(widthPx: Float, colorHex: String) {
        strokeWidthPx = widthPx
        val colorInt = try {
            android.graphics.Color.parseColor(colorHex)
        } catch (e: Exception) {
            0xFF111111.toInt()
        }
        inkSurfaceView.setStrokeStyle(widthPx, colorInt)
    }

    fun setEnabled(enabled: Boolean) {
        inkSurfaceView.setEnabled(enabled)
    }

    /** Constrain the daemon's writing area: pen above [topPx] (surface px) — the toolbar strip —
     *  is ignored. The value is JS-provided (the website owns the writing region). */
    fun setWritingTop(topPx: Int) {
        inkSurfaceView.setWritingTop(topPx)
    }

    fun setWritingExclusion(left: Int, top: Int, right: Int, bottom: Int) {
        inkSurfaceView.setWritingExclusion(left, top, right, bottom)
    }

    fun setWritingBounds(left: Int, top: Int, right: Int, bottom: Int) {
        inkSurfaceView.setWritingBounds(left, top, right, bottom)
    }

    /** Re-render the whole page on the native surface from the JS model. [json] = page object in
     *  SURFACE px: {"t":templateType,"sp":spacing,"mg":margin,"dpr":dpr,"b":[l,t,r,b],
     *  "s":[{"w":widthPx,"p":[[x,y],...]}, ...]}. Called on load/undo/erase/page/template change —
     *  never during active writing. */
    fun renderInk(json: String) {
        mainHandler.post {
            try {
                val o = org.json.JSONObject(json)
                val type = o.optString("t", "blank")
                val sp = o.optDouble("sp", 0.0).toFloat()
                val mg = o.optDouble("mg", 0.0).toFloat()
                val dpr = o.optDouble("dpr", 1.0).toFloat()
                val bA = o.getJSONArray("b")
                val bounds = Rect(bA.getInt(0), bA.getInt(1), bA.getInt(2), bA.getInt(3))
                val sArr = o.getJSONArray("s")
                val strokes = ArrayList<com.kalamos.notebook.view.StrokeRender>(sArr.length())
                for (i in 0 until sArr.length()) {
                    val so = sArr.getJSONObject(i)
                    val w = so.getDouble("w").toFloat()
                    val felt = so.optInt("vw", 0) == 1   // variable-width (felt) stroke → per-point pressure
                    val dashed = so.optInt("d", 0) == 1  // selection stroke → dashed line
                    val colorInt = try { android.graphics.Color.parseColor(so.optString("c", "#111111")) }
                        catch (e: Exception) { 0xFF111111.toInt() }
                    val pArr = so.getJSONArray("p")
                    val pts = ArrayList<PointF>(pArr.length())
                    val pressures = if (felt) FloatArray(pArr.length()) else null
                    for (j in 0 until pArr.length()) {
                        val pt = pArr.getJSONArray(j)
                        pts.add(PointF(pt.getDouble(0).toFloat(), pt.getDouble(1).toFloat()))
                        if (pressures != null) pressures[j] = if (pt.length() > 2) pt.getDouble(2).toFloat() else 0.5f
                    }
                    strokes.add(com.kalamos.notebook.view.StrokeRender(pts, w, pressures, colorInt, dashed))
                }
                Log.i("PERF", "DIAG renderInk t=${android.os.SystemClock.uptimeMillis()} strokes=${strokes.size}")
                val refreshRect = if (o.has("rr")) {
                    val rr = o.getJSONArray("rr")
                    Rect(rr.getInt(0), rr.getInt(1), rr.getInt(2), rr.getInt(3))
                } else null
                val defer = o.optInt("defer", 0) == 1
                val eraseRect = o.optJSONArray("eraseRect")?.let { er ->
                    Rect(er.getInt(0), er.getInt(1), er.getInt(2), er.getInt(3))
                }
                trace("model.render", mapOf("strokes" to strokes.size, "defer" to defer, "bounds" to bounds.toShortString(), "refresh" to refreshRect?.toShortString()))
                inkSurfaceView.renderPage(type, sp, mg, dpr, bounds, strokes, refreshRect, defer, eraseRect)
            } catch (e: Exception) {
                Log.w(TAG, "renderInk parse failed: ${e.message}")
            }
        }
    }

    // ---- Serialized WebView snapshot queue ------------------------------------------------------
    // WebView draw() is blank on its hardware layer, so snapshots temporarily use SOFTWARE and wait
    // for DOM paint. Two concurrent captures used to race over that single layer flag: one restored
    // HARDWARE during the other's settle window, producing the intermittent blank toolbar/rail. Keep
    // the entire capture run software-layered and restore hardware only after the queue drains.
    private class CaptureJob(val epoch: Int, val delayMs: Long, val discard: () -> Unit, val grab: () -> Unit)
    private val captureQueue = ArrayDeque<CaptureJob>()
    private var captureRunning = false

    private fun enqueueCapture(delayMs: Long, discard: () -> Unit = {}, grab: () -> Unit) {
        captureQueue.addLast(CaptureJob(captureEpoch, delayMs, discard, grab))
        if (!captureRunning) pumpCaptures()
    }

    private fun discardCapture(job: CaptureJob) {
        trace("capture.discard", mapOf("jobEpoch" to job.epoch, "captureEpoch" to captureEpoch))
        Log.i(TAG, "capture discarded: retired session ${job.epoch}, current $captureEpoch")
        try { job.discard() } catch (error: Exception) { Log.w(TAG, "capture cancellation failed: ${error.message}") }
    }

    private fun pumpCaptures() {
        // Keep one software-layer capture queue, but never install an old owner's content/chrome
        // after detach. Skip queued stale jobs immediately so they cannot delay the new editor.
        while (captureQueue.isNotEmpty() && captureQueue.first().epoch != captureEpoch)
            discardCapture(captureQueue.removeFirst())
        if (captureQueue.isEmpty()) {
            captureRunning = false
            if (!animRunning) webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
            return
        }
        captureRunning = true
        val job = captureQueue.removeFirst()
        webView.setLayerType(android.view.View.LAYER_TYPE_SOFTWARE, null)
        webView.invalidate()
        webView.postInvalidateOnAnimation()
        webView.postDelayed({
            try {
                if (job.epoch == captureEpoch) job.grab() else discardCapture(job)
            } catch (error: Exception) { Log.w(TAG, "capture failed: ${error.message}") }
            pumpCaptures()
        }, job.delayMs)
    }

    /** Queue the final full composited refresh after pending toolbar/rail grabs have populated their
     *  bitmaps. This ordering is part of the blank-toolbar fix; do not refresh outside the queue. */
    fun refreshChrome() {
        mainHandler.post { enqueueCapture(0L) { inkSurfaceView.refreshChrome() } }
    }

    /** Capture the top [heightPx] (surface px) of the WebView — the toolbar strip — into a bitmap
     *  and bake it onto the native page so the web toolbar is visible while the ink surface stays
     *  the sole full-screen layer. Requires the WebView to be software-layered (HW draw() is blank). */
    fun snapshotToolbar(heightPx: Int) {
        mainHandler.post {
            val w = webView.width
            val h = heightPx.coerceAtMost(webView.height)
            if (w <= 0 || h <= 0) return@post
            enqueueCapture(80L) {
                val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bmp)
                canvas.drawColor(android.graphics.Color.WHITE)
                webView.draw(canvas)
                inkSurfaceView.setToolbarSnapshot(bmp)
            }
        }
    }

    /** Re-capture just a sub-region of the web toolbar (button cluster / page number) and bake it
     *  over that part of the surface — no whole-strip re-bake or refresh, so a toolbar change is fast
     *  and doesn't flash. left/top/right/bottom are surface px (the element's bounds). */
    fun snapshotToolbarRegion(left: Int, top: Int, right: Int, bottom: Int) {
        mainHandler.post {
            val l = left.coerceAtLeast(0)
            val t = top.coerceAtLeast(0)
            val w = (right - l).coerceAtMost(webView.width - l)
            val h = (bottom - t).coerceAtMost(webView.height - t)
            if (w <= 0 || h <= 0) return@post
            enqueueCapture(TOOLBAR_REGION_DELAY_MS) {
                val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bmp)
                canvas.drawColor(android.graphics.Color.WHITE)
                canvas.translate(-l.toFloat(), -t.toFloat())
                webView.draw(canvas)
                inkSurfaceView.setToolbarSnapshotRegion(bmp, l, t)
            }
        }
    }

    /** Capture the floating menu (bounds left..bottom, surface px) and bake it onto the surface as
     *  the persistent overlay. [refresh*] = the union of the menu's old + new bounds, re-rendered +
     *  refreshed so a collapse clears the area the menu used to cover. */
    fun snapshotMenu(left: Int, top: Int, right: Int, bottom: Int,
                     refreshLeft: Int, refreshTop: Int, refreshRight: Int, refreshBottom: Int) {
        mainHandler.post {
            val l = left.coerceAtLeast(0)
            val t = top.coerceAtLeast(0)
            val w = (right - l).coerceAtMost(webView.width - l)
            val h = (bottom - t).coerceAtMost(webView.height - t)
            if (w <= 0 || h <= 0) return@post
            enqueueCapture(TOOLBAR_REGION_DELAY_MS) {
                val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bmp)
                // Floating controls must mask the underlying ink even when the WebView capture
                // contains transparent pixels (the daemon does not share CSS compositing).
                canvas.drawColor(android.graphics.Color.WHITE)
                canvas.translate(-l.toFloat(), -t.toFloat())
                webView.draw(canvas)
                val layout = inkSurfaceView.layoutParams as? android.widget.FrameLayout.LayoutParams
                val origin = Rect(layout?.leftMargin ?: 0, layout?.topMargin ?: 0, 0, 0)
                inkSurfaceView.setMenuSnapshot(bmp, l - origin.left, t - origin.top,
                    refreshLeft, refreshTop, refreshRight, refreshBottom)
            }
        }
    }

    /** Bake the WebView's #content-layer (the interactive-format article content) for region
     *  [l,t,r,b] (surface px = the paper rect) onto the ink surface, UNDER the ink. Same software-layer
     *  capture as the toolbar/menu snapshots. The user then writes over the baked content with the pen. */
    fun snapshotContent(l: Int, t: Int, r: Int, b: Int) = snapshotContent(l, t, r, b, 0, 0, 0, 0)

    /** Bake the content region [l,t,r,b]; if [rr]>[rl] limit the EPD refresh to [rl,rt,rr,rb] (the
     *  sticky-note box → partial refresh), else a full refresh. */
    fun snapshotContent(l: Int, t: Int, r: Int, b: Int, rl: Int, rt: Int, rr: Int, rb: Int) {
        mainHandler.post {
            val left = l.coerceAtLeast(0)
            val top = t.coerceAtLeast(0)
            val w = (r - left).coerceAtMost(webView.width - left)
            val h = (b - top).coerceAtMost(webView.height - top)
            if (w <= 0 || h <= 0) return@post
            val refresh = if (rr > rl && rb > rt) Rect(rl, rt, rr, rb) else null
            enqueueCapture(if (refresh != null) TOOLBAR_REGION_DELAY_MS else CONTENT_SNAPSHOT_DELAY_MS) {
                val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bmp)
                // Native ink is an opaque paper surface. Starting the WebView capture transparent
                // lets the Bigme overlay blend ruled pixels through floating white controls even
                // when CSS reports an opaque background. Flatten onto paper white first.
                canvas.drawColor(android.graphics.Color.WHITE)
                canvas.translate(-left.toFloat(), -top.toFloat())
                webView.draw(canvas)
                InkDiagnostics.bitmap("web.content", bmp, mapOf("view" to System.identityHashCode(inkSurfaceView), "notebook" to diagnosticNotebook,
                    "page" to diagnosticPage, "captureEpoch" to captureEpoch, "refresh" to refresh?.toShortString()))
                inkSurfaceView.setContentSnapshot(bmp, refresh)
            }
        }
    }

    /** Suppress the full-screen wake refresh on the next daemon attach (partial sticky-note open). */
    fun skipNextWake() {
        mainHandler.post { inkSurfaceView.setSkipNextWake() }
    }

    /** Drop any baked content (plain notebook / a page with no blocks). */
    fun clearContent() {
        mainHandler.post { inkSurfaceView.setContentSnapshot(null) }
    }

    /** Capture the current page off the native ink surface into a scaled PNG and save it.
     *
     * The copy is serialized behind every queued WebView/content capture. Planning first queues its
     * clean content snapshot, while classic Handwriting first submits an authoritative model render;
     * taking the thumbnail directly from this method's main-thread post used to race both operations
     * and save an empty template or a partial stroke list. JS receives onThumbnailCaptured as soon as
     * the immutable bitmap exists and may then detach the SurfaceView safely. PNG compression and disk
     * I/O remain off the UI thread. This ordering is device-neutral; no Bigme display policy changes.
     */
    fun saveThumbnail(notebookId: String, storage: com.kalamos.notebook.storage.StorageManager) {
        mainHandler.post {
            val quotedId = org.json.JSONObject.quote(notebookId)
            enqueueCapture(0L, discard = {
                postToWeb("window.onThumbnailCaptured && window.onThumbnailCaptured($quotedId)")
            }) {
                val thumb = inkSurfaceView.captureThumbnail(THUMB_WIDTH)
                // Release the editor only after the native page state has been copied. Notify on
                // failure too so a damaged/empty surface cannot trap navigation indefinitely.
                postToWeb(
                    "window.onThumbnailCaptured && window.onThumbnailCaptured($quotedId)"
                )
                if (thumb == null) return@enqueueCapture
                Thread {
                    try {
                        val baos = java.io.ByteArrayOutputStream()
                        thumb.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, baos)
                        if (storage.saveThumbnailBytes(notebookId, baos.toByteArray())) {
                            // Library rendering can run before the background PNG write completes and
                            // cache the former "missing" result. Notify it as soon as the file exists.
                            postToWeb(
                                "window.onThumbnailReady && window.onThumbnailReady($quotedId)"
                            )
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "saveThumbnail failed: ${e.message}")
                    } finally {
                        thumb.recycle()
                    }
                }.start()
            }
        }
    }

    /**
     * Capture an ordinary WebView editor directly into a library thumbnail.
     *
     * Standard Android deliberately keeps its writing canvas in the WebView for the complete
     * editor session. Asking the hidden native surface for that page can therefore return an old
     * template or an incomplete stroke model. Bigme does not use this method: its daemon surface
     * remains authoritative and continues through [saveThumbnail].
     */
    fun saveWebThumbnail(
        notebookId: String,
        leftPx: Int,
        topPx: Int,
        rightPx: Int,
        bottomPx: Int,
        storage: com.kalamos.notebook.storage.StorageManager
    ) {
        mainHandler.post {
            val left = leftPx.coerceIn(0, webView.width)
            val top = topPx.coerceIn(0, webView.height)
            val right = rightPx.coerceIn(left, webView.width)
            val bottom = bottomPx.coerceIn(top, webView.height)
            val quotedId = org.json.JSONObject.quote(notebookId)
            if (right <= left || bottom <= top) {
                postToWeb("window.onThumbnailCaptured && window.onThumbnailCaptured($quotedId)")
                return@post
            }
            enqueueCapture(CONTENT_SNAPSHOT_DELAY_MS, discard = {
                postToWeb("window.onThumbnailCaptured && window.onThumbnailCaptured($quotedId)")
            }) {
                var source: android.graphics.Bitmap? = null
                var thumb: android.graphics.Bitmap? = null
                try {
                    source = android.graphics.Bitmap.createBitmap(
                        right - left,
                        bottom - top,
                        android.graphics.Bitmap.Config.ARGB_8888
                    )
                    val canvas = android.graphics.Canvas(source)
                    canvas.drawColor(android.graphics.Color.WHITE)
                    canvas.translate(-left.toFloat(), -top.toFloat())
                    webView.draw(canvas)
                    thumb = scaleWebThumbnail(source, THUMB_WIDTH)
                } catch (e: Exception) {
                    Log.w(TAG, "saveWebThumbnail capture failed: ${e.message}")
                } finally {
                    source?.recycle()
                    // The editor can be destroyed only after all WebView pixels have been copied.
                    postToWeb("window.onThumbnailCaptured && window.onThumbnailCaptured($quotedId)")
                }
                val immutableThumb = thumb ?: return@enqueueCapture
                Thread {
                    try {
                        val baos = java.io.ByteArrayOutputStream()
                        immutableThumb.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, baos)
                        if (storage.saveThumbnailBytes(notebookId, baos.toByteArray())) {
                            postToWeb("window.onThumbnailReady && window.onThumbnailReady($quotedId)")
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "saveWebThumbnail write failed: ${e.message}")
                    } finally {
                        immutableThumb.recycle()
                    }
                }.start()
            }
        }
    }

    /** Fit the complete WebView paper inside the Notes/Books shelf's canonical 86:131 frame. */
    private fun scaleWebThumbnail(source: android.graphics.Bitmap, targetWidth: Int): android.graphics.Bitmap {
        val targetHeight = Math.round(targetWidth * 131f / 86f)
        val thumb = android.graphics.Bitmap.createBitmap(
            targetWidth,
            targetHeight,
            android.graphics.Bitmap.Config.ARGB_8888
        )
        val scale = minOf(
            targetWidth.toFloat() / source.width,
            targetHeight.toFloat() / source.height
        )
        val drawWidth = source.width * scale
        val drawHeight = source.height * scale
        val left = (targetWidth - drawWidth) / 2f
        val top = (targetHeight - drawHeight) / 2f
        val canvas = android.graphics.Canvas(thumb)
        canvas.drawColor(android.graphics.Color.WHITE)
        val paint = android.graphics.Paint(
            android.graphics.Paint.ANTI_ALIAS_FLAG or
                android.graphics.Paint.FILTER_BITMAP_FLAG or
                android.graphics.Paint.DITHER_FLAG
        )
        canvas.drawBitmap(
            source,
            null,
            android.graphics.RectF(left, top, left + drawWidth, top + drawHeight),
            paint
        )
        return thumb
    }

    /** Flush the native stroke batch into the JS model, then signal JS so a model op (undo/erase)
     *  can run against an up-to-date model. */
    fun flushAndSignal() {
        mainHandler.removeCallbacks(flushRunnable)
        flushToJs()
        postToWeb("""
            (function() {
              var handler = window._inkHandler;
              if (handler && typeof handler.onNativeFlushed === 'function') {
                handler.onNativeFlushed();
                console.log('DIAG ruledInkFlush complete');
                return;
              }
              if (typeof window.onNativeFlushed === 'function') window.onNativeFlushed();
            })()
        """.trimIndent())
    }

    fun isAttached(): Boolean = attached

    fun getCurrentBounds(): Rect = currentBounds

    /** Request an idle checkpoint from the active ink owner. A present handler owns the batch and
     *  must never fall through to another editor's global save function. The ruled workspace persists
     *  the delivered model without another flush/presentation; legacy editors use `saveNotebook`. */
    private fun requestSaveInJs() {
        postToWeb("""
            (function() {
              var handler = window._inkHandler;
              if (handler) {
                if (typeof handler.onNativeSaveRequested === 'function') {
                  handler.onNativeSaveRequested();
                }
                return;
              }
              if (typeof window.saveNotebook === 'function') window.saveNotebook();
            })()
        """.trimIndent())
    }

    private fun postToWeb(script: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            webView.evaluateJavascript(script, null)
        } else {
            webView.post { webView.evaluateJavascript(script, null) }
        }
    }

    private fun createInkController(): InkController? {
        return try {
            DeviceRegistry.require(webView.context).createInkController()
        } catch (e: Exception) {
            Log.w(TAG, "Ink SDK not available: ${e.message}")
            null
        }
    }

    companion object {
        private const val TAG = "InkManager"

        // Library thumbnail width in px (height follows the page aspect).
        private const val THUMB_WIDTH = 320

        // Settle delay before capturing a targeted toolbar region (a CSS class toggle paints fast;
        // shorter than the 80ms full-strip snapshot so button feedback is snappy).
        private const val TOOLBAR_REGION_DELAY_MS = 48L

        // Longer settle for content: the content layer can include images that must paint before capture.
        private const val CONTENT_SNAPSHOT_DELAY_MS = 120L

        // Pen-up delivery timing lives in StrokeFlushTiming: ordinary writing retains 900ms idle;
        // likely retracing gestures reach the shared scribble detector after 60ms.
        // Longer true-idle before the heavy disk save runs, so it never competes with writing.
        private const val SAVE_IDLE_MS = 2500L

        private const val JSON_X = """{"x":"""
        private const val JSON_Y = ""","y":"""

        // Default web-animation frame interval (≈10 fps) — calm baseline for e-ink; live-tunable via
        // `setprop debug.kalamos.anim_frame_ms N` (lower = faster). Both the sample cadence and the web
        // clock use it, so the animation plays in real time at the chosen rate.
        private const val ANIM_FRAME_MS = 100L
    }
}
