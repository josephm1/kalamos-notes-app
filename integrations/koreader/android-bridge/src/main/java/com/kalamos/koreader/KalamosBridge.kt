package com.kalamos.koreader

import android.app.Application
import android.os.Bundle
import java.lang.ref.WeakReference
import android.app.Activity
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.Surface
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.kalamos.device.api.ink.StrokeCallback
import com.kalamos.device.api.ink.StrokePoint
import com.kalamos.device.bigme.BigmeInkController
import com.kalamos.device.bigme.BigmePenInput
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** JNI-friendly seam used by the Kalamos KOReader plugin. All UI mutation stays on Android's UI thread. */
object KalamosBridge {

    private var observedApplication: Application? = null
    private var inkHost: WeakReference<Activity>? = null
    @Volatile private var hostForeground = true
    @Volatile private var inkSuspended = false
    @Volatile private var lifecycleGeneration = 0L

    // NativeActivity's Lua event loop can remain alive while another app owns the panel.
    // Observe Android lifecycle directly rather than relying on a delayed Lua suspend event.
    private val lifecycle = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityPaused(activity: Activity) = suspendHost(activity)
        override fun onActivityStopped(activity: Activity) = suspendHost(activity)
        override fun onActivityDestroyed(activity: Activity) {
            suspendHost(activity)
            if (inkHost?.get() === activity) inkHost = null
        }
        override fun onActivityResumed(activity: Activity) {
            if (inkHost?.get() === activity) hostForeground = true
            // No automatic daemon reattach: Lua first saves the queued departing strokes.
        }
        override fun onActivityCreated(activity: Activity, state: Bundle?) {}
        override fun onActivityStarted(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
    }

    private fun observeHost(activity: Activity) {
        if (observedApplication !== activity.application) {
            observedApplication?.unregisterActivityLifecycleCallbacks(lifecycle)
            activity.application.registerActivityLifecycleCallbacks(lifecycle)
            observedApplication = activity.application
        }
        if (inkHost?.get() !== activity) {
            inkHost = WeakReference(activity)
            hostForeground = !activity.isFinishing && !activity.isDestroyed
        }
    }

    private fun suspendHost(activity: Activity) {
        if (inkHost?.get() !== activity) return
        hostForeground = false
        lifecycleGeneration += 1
        startRequests.incrementAndGet()
        if (controller == null && surface == null) return
        inkSuspended = true
        controller?.setEnabled(false)
        // This invalidates async page/chrome captures, cancels eraser clean refreshes, and
        // releases the daemon without a white panel flash. Completed vectors stay queued.
        stopInkOnUiThread()
        Log.i(TAG, "activity background: daemon released; pending strokes retained")
    }

    private val completed = ConcurrentLinkedQueue<JSONObject>()
    private val toolEvents = ConcurrentLinkedQueue<JSONObject>()
    private var controller: BigmeInkController? = null
    private val eraseRefreshHandler = Handler(Looper.getMainLooper())
    private var pendingEraseClean: Runnable? = null
    private var pendingEraseDirty: Rect? = null
    private var surface: SurfaceView? = null
    private var toolbar: InkToolbar? = null
    @Volatile private var currentStyle = InkToolbar.Style()
    private var activeStrokeStyle = currentStyle
    private var selectionAction = "select"
    @Volatile private var selectionBounds: RectF? = null
    private var lassoGesture = "select"
    private var lassoHandle = ""
    private data class LassoHit(val mode: String, val handle: String = "")
    private fun lassoHit(x: Float, y: Float): LassoHit {
        val box = selectionBounds ?: return LassoHit("select")
        val tx = box.right + 27f; val ty = box.top - 27f
        if (kotlin.math.hypot((x - tx).toDouble(), (y - ty).toDouble()) <= 23.0)
            return LassoHit("delete")
        val near = 22f
        if (x < box.left - near || x > box.right + near ||
            y < box.top - near || y > box.bottom + near) return LassoHit("select")
        val horizontal = when {
            kotlin.math.abs(x - box.left) <= near -> "left"
            kotlin.math.abs(x - box.right) <= near -> "right"
            else -> ""
        }
        val vertical = when {
            kotlin.math.abs(y - box.top) <= near -> "top"
            kotlin.math.abs(y - box.bottom) <= near -> "bottom"
            else -> ""
        }
        return if (horizontal.isNotEmpty() || vertical.isNotEmpty())
            LassoHit("resize", "$horizontal,$vertical") else LassoHit("move")
    }
    private var sessionGeneration = 0L
    private val startRequests = AtomicLong()
    private var chromeRequestGeneration = 0L
    private val chromeDamage = ChromeDamage()
    private var surfaceHasReplayPreview = false
    private var chromeBase: Bitmap? = null
    private var pageBase: Bitmap? = null
    private var replayedStrokes: List<InkStroke> = emptyList()
    private var selectedStrokeIndices: Set<Int> = emptySet()
    private var selectionScene: Bitmap? = null
    private var selectionStartX = 0f
    private var selectionStartY = 0f
    private var previousSelectionPreview: Rect? = null
    private var lastSelectionPreviewMs = 0L
    private var nativeEditPending = false
    @Volatile private var androidDisplayMode = false
    @Volatile private var daemonPenDown = false
    @Volatile private var lastDaemonPenSignalMs = Long.MIN_VALUE

    private data class ReplayRequest(
        val activity: Activity,
        val controller: BigmeInkController,
        val surface: SurfaceView,
        val strokes: List<InkStroke>,
        val strokeWidth: Float,
        val color: Int,
        val startedMs: Long,
        val generation: Long,
        val pageTransition: Boolean,
        val selection: RectF?,
        val editRect: Rect?,
    ) {
        val required: Boolean get() = strokes.isNotEmpty() || pageTransition
    }

    private data class InkStroke(
        val points: List<StrokePoint>,
        val width: Float,
        val color: Int,
        val opacity: Float,
        val pen: String,
    )

    /** Startup probe and lifecycle registration for the Lua/JNI application-class-loader seam. */
    @JvmStatic
    fun ping(activity: Activity): String {
        val supported = BigmeInkController.isBigmeDevice()
        if (supported) activity.runOnUiThread { observeHost(activity) }
        return JSONObject()
        .put("ok", true)
        .put("apiVersion", 1)
        .put("inkAvailable", supported)
        .put("activity", activity.javaClass.name)
        .toString()
    }

    /** Bounds are in the activity content view's physical pixels. */
    @JvmStatic
    fun startInk(activity: Activity, boundsJson: String): String = runCatching {
        val requestStartedMs = SystemClock.elapsedRealtime()
        val requestId = startRequests.incrementAndGet()
        val requestLifecycleGeneration = lifecycleGeneration
        val requestForeground = hostForeground
        val request = JSONObject(boundsJson)
        val width = activity.window.decorView.width.coerceAtLeast(1)
        val height = activity.window.decorView.height.coerceAtLeast(1)
        val left = request.optInt("left", 0).coerceIn(0, width - 1)
        val top = request.optInt("top", 0).coerceIn(0, height - 1)
        val right = request.optInt("right", width).coerceIn(left + 1, width)
        val bottom = request.optInt("bottom", height).coerceIn(top + 1, height)
        val initialTool = request.optString("initialTool", "").takeIf {
            it in setOf("canvas", "sticky", "pen", "highlighter", "eraser", "lasso")
        }
        val requestedStyle = initialTool?.let { currentStyle.copy(tool = it) } ?: currentStyle
        val strokeWidth = requestedStyle.width
        val color = requestedStyle.color
        val liveColor = if (requestedStyle.tool == "highlighter")
            (color and 0x00ffffff) or (96 shl 24) else color
        val pageTransition = request.optBoolean("pageTransition", false)
        val selection = request.optJSONObject("selection")?.let {
            RectF(it.optDouble("left").toFloat(), it.optDouble("top").toFloat(),
                it.optDouble("right").toFloat(), it.optDouble("bottom").toFloat())
        }
        val editRect = request.optJSONObject("editRect")?.let {
            Rect(it.optInt("left"), it.optInt("top"), it.optInt("right"), it.optInt("bottom"))
        }
        val replayStrokes = decodeStrokes(request.optJSONArray("strokes"))
        val selectedArray = request.optJSONArray("selectedIndices")
        val selected = buildSet {
            if (selectedArray != null) for (index in 0 until selectedArray.length())
                add(selectedArray.optInt(index))
        }
        Log.i(TAG, "startInk queued replay=${replayStrokes.size} pageTransition=$pageTransition " +
            "decodeMs=${SystemClock.elapsedRealtime() - requestStartedMs}")
        activity.runOnUiThread {
            observeHost(activity)
            if (requestId != startRequests.get()) return@runOnUiThread
            if (!requestForeground || !hostForeground || requestLifecycleGeneration != lifecycleGeneration || activity.isFinishing || activity.isDestroyed) {
                Log.i(TAG, "startInk ignored: host is backgrounded")
                return@runOnUiThread
            }
            inkSuspended = false
            currentStyle = requestedStyle
            val uiStartedMs = SystemClock.elapsedRealtime()
            val existingController = controller
            val existingSurface = surface
            if (existingController?.isActive == true && existingSurface != null) {
                sessionGeneration += 1
                val generation = sessionGeneration
                completed.clear()
                existingController.setEnabled(false)
                existingController.setStrokeStyle(strokeWidth, liveColor)
                existingController.setCaptureOnly(captureOnly())
                existingController.setDashMode(currentStyle.tool == "lasso" || currentStyle.tool == "eraser" && currentStyle.eraser == "range")
                selectionBounds = selection
                val sameSelection = selectedStrokeIndices == selected &&
                    ((selectionBounds == null && selection == null) ||
                        (selectionBounds != null && selection != null &&
                            kotlin.math.abs(selectionBounds!!.left - selection.left) < 1f &&
                            kotlin.math.abs(selectionBounds!!.top - selection.top) < 1f &&
                            kotlin.math.abs(selectionBounds!!.right - selection.right) < 1f &&
                            kotlin.math.abs(selectionBounds!!.bottom - selection.bottom) < 1f))
                val alreadyDisplayed = nativeEditPending && sameSelection &&
                    sameInk(replayedStrokes, replayStrokes)
                if (selection != null || selectedStrokeIndices.isNotEmpty() || selected.isNotEmpty())
                    Log.i(TAG, "selection reconcile native=${selectedStrokeIndices.size} " +
                        "saved=${selected.size} same=$sameSelection skip=$alreadyDisplayed")
                nativeEditPending = false
                replayedStrokes = replayStrokes
                selectedStrokeIndices = selected
                selectionScene?.recycle(); selectionScene = null
                existingController.setWritingBounds(left, top, right, bottom)
                if (alreadyDisplayed && !pageTransition) {
                    existingController.setEnabled(true)
                    Log.i(TAG, "Retained native edit; skipped duplicate page capture/replay")
                    return@runOnUiThread
                }
                val replay = ReplayRequest(activity, existingController, existingSurface,
                    replayStrokes, strokeWidth, color, requestStartedMs, generation, pageTransition, selection, editRect)
                if (replay.required || toolbar != null) replayInk(replay)
                else existingController.setEnabled(true)
                Log.i(TAG, "startInk reused surface replay=${replayStrokes.size} " +
                    "totalMs=${SystemClock.elapsedRealtime() - requestStartedMs}")
                return@runOnUiThread
            }
            stopInkOnUiThread()
            currentStyle = requestedStyle
            val generation = sessionGeneration
            completed.clear()
            val host = activity.window.decorView.findViewById<ViewGroup>(android.R.id.content)
            val inkSurface = SurfaceView(activity).apply {
                // Notes uses one opaque HWC page/ink layer. A translucent KOReader overlay left
                // Android and daemon composition competing during erase and selection edits.
                holder.setFormat(PixelFormat.OPAQUE)
                setZOrderOnTop(true)
                setBackgroundColor(Color.WHITE)
            }
            host.addView(inkSurface, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.TOP or Gravity.START
            ))
            surface = inkSurface
            inkSurface.post {
                if (requestId != startRequests.get() || !hostForeground || sessionGeneration != generation || surface !== inkSurface) return@post
                val attachStartedMs = SystemClock.elapsedRealtime()
                val inkController = BigmeInkController().also { controller = it }
                inkController.setStrokeStyle(strokeWidth, liveColor)
                inkController.setCaptureOnly(captureOnly())
                inkController.setDashMode(currentStyle.tool == "lasso" || currentStyle.tool == "eraser" && currentStyle.eraser == "range")
                inkController.setCaptureOnlyAt { x, y ->
                    if (currentStyle.tool != "lasso") false else {
                        val capture = lassoHit(x, y).mode != "select"
                        // This executes before the daemon paints its first point.
                        inkController.setOverlayVisible(!capture)
                        androidDisplayMode = capture
                        capture
                    }
                }
                selectionBounds = selection
                replayedStrokes = replayStrokes
                selectedStrokeIndices = selected
                selectionScene?.recycle(); selectionScene = null
                inkController.setWritingBounds(left, top, right, bottom)
                inkController.setExcludedPenTouch { action, x, y ->
                    activity.runOnUiThread { toolbar?.onPenTouch(action, x, y) }
                }
                val attached = inkController.attach(inkSurface, Rect(left, top, right, bottom), CALLBACK)
                val attachFinishedMs = SystemClock.elapsedRealtime()
                Log.i(TAG, "startInk attach=$attached uiQueueMs=${uiStartedMs - requestStartedMs} " +
                    "surfaceWaitMs=${attachStartedMs - uiStartedMs} attachMs=${attachFinishedMs - attachStartedMs}")
                if (!attached) {
                    controller = null
                    inkSurface.visibility = View.GONE
                } else {
                    // Capture/replay is asynchronous. Admitting pen samples before its final
                    // presentation lets that older bitmap erase new live strokes.
                    inkController.setEnabled(false)
                    // A fresh Bigme client may inherit pixels retained by the previous session.
                    // Clear them before PixelCopy establishes the chrome-free page frame.
                    val blank = Bitmap.createBitmap(inkSurface.width.coerceAtLeast(1),
                        inkSurface.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                    blank.eraseColor(Color.TRANSPARENT)
                    inkController.syncOverlay(blank, null, force = false)
                    blank.recycle()
                    if (request.optBoolean("toolBar", false)) showToolbar(activity, request.optString("context", "full-page"), request.optBoolean("canvasAvailable", false), request.optBoolean("originalInkAvailable", false), request.optBoolean("originalInkView", false), Rect(left, top, right, bottom), request.optJSONObject("stickyHeader")?.let {
                        Rect(it.getInt("left"), it.getInt("top"), it.getInt("right"), it.getInt("bottom"))
                    })
                    val replay = ReplayRequest(activity, inkController, inkSurface, replayStrokes,
                        strokeWidth, color, requestStartedMs, generation, pageTransition, selection, editRect)
                    if (replay.required || toolbar != null) replayInk(replay) else {
                        inkController.setEnabled(true)
                        toolbar?.let { refreshChrome(activity, it.chromeBounds()) }
                        Log.i(TAG, "startInk ready without replay totalMs=${attachFinishedMs - requestStartedMs}")
                    }
                }
            }
        }
        JSONObject().put("ok", true).put("scheduled", true).toString()
    }.getOrElse { JSONObject().put("err", it.message ?: "ink-start-failed").toString() }

    @JvmStatic
    fun stopInk(activity: Activity): String {
        startRequests.incrementAndGet()
        val requestedMs = SystemClock.elapsedRealtime()
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            stopInkOnUiThread()
            Log.i(TAG, "stopInk completed on UI thread in ${SystemClock.elapsedRealtime() - requestedMs}ms")
        } else {
            val stopped = CountDownLatch(1)
            activity.runOnUiThread { try { stopInkOnUiThread() } finally { stopped.countDown() } }
            val completedInTime = stopped.await(2, TimeUnit.SECONDS)
            Log.i(TAG, "stopInk UI handoff completed=$completedInTime waitMs=${SystemClock.elapsedRealtime() - requestedMs}")
        }
        return drainInk()
    }

    /** Clear the old page's transient ink without destroying the bound surface or daemon session. */
    @JvmStatic
    fun pauseInk(activity: Activity): String {
        startRequests.incrementAndGet()
        val requestedMs = SystemClock.elapsedRealtime()
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            pauseInkOnUiThread()
        } else {
            val paused = CountDownLatch(1)
            activity.runOnUiThread { try { pauseInkOnUiThread() } finally { paused.countDown() } }
            val completedInTime = paused.await(2, TimeUnit.SECONDS)
            Log.i(TAG, "pauseInk UI handoff completed=$completedInTime " +
                "waitMs=${SystemClock.elapsedRealtime() - requestedMs}")
        }
        return drainInk()
    }

    @JvmStatic
    fun drainInk(): String {
        val strokes = JSONArray()
        while (true) strokes.put(completed.poll() ?: break)
        val events = JSONArray()
        while (true) events.put(toolEvents.poll() ?: break)
        return JSONObject().put("schema", "kalamos.ink-batch/v1")
            .put("strokes", strokes).put("events", events).put("suspended", inkSuspended).toString()
    }

    /**
     * NativeActivity motion events bypass Activity.dispatchTouchEvent(). KOReader's native input
     * queue calls this while handwriting is active to identify firmware events mirrored as finger
     * touches. The short release grace keeps the matching UP out of KOReader's gesture detector.
     */
    @JvmStatic
    fun isPenInputActive(): Boolean {
        if (controller?.isActive != true) return false
        val lastSignalMs = lastDaemonPenSignalMs
        return daemonPenDown || lastSignalMs != NO_PEN_SIGNAL &&
            SystemClock.elapsedRealtime() - lastSignalMs <= PEN_RELEASE_GRACE_MS
    }

    /** Used once per Android input device by KOReader's raw motion filter. */
    @JvmStatic
    fun isPenInputDevice(deviceId: Int): Boolean = BigmePenInput.isPenDevice(deviceId)

    private fun recordDaemonPenSignal(down: Boolean) {
        daemonPenDown = down
        lastDaemonPenSignalMs = SystemClock.elapsedRealtime()
    }

    private fun clearDaemonPenSignal() {
        daemonPenDown = false
        lastDaemonPenSignalMs = NO_PEN_SIGNAL
    }

    private fun stopInkOnUiThread() {
        pendingEraseClean?.let(eraseRefreshHandler::removeCallbacks)
        pendingEraseClean = null
        pendingEraseDirty = null
        val startedMs = SystemClock.elapsedRealtime()
        val hadController = controller != null
        sessionGeneration += 1
        clearDaemonPenSignal()
        controller?.setExcludedPenTouch(null)
        controller?.detach()
        controller = null
        toolbar?.close(); toolbar = null
        chromeBase?.recycle()
        chromeBase = null
        pageBase?.recycle()
        pageBase = null
        selectionScene?.recycle()
        selectionScene = null
        replayedStrokes = emptyList()
        selectedStrokeIndices = emptySet()
        selectionBounds = null
        androidDisplayMode = false
        nativeEditPending = false
        currentStyle = InkToolbar.Style()
        surface?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        surface = null
        surfaceHasReplayPreview = false
        Log.i(TAG, "stopInkOnUiThread controller=$hadController detachMs=${SystemClock.elapsedRealtime() - startedMs}")
    }

    private fun pauseInkOnUiThread() {
        val startedMs = SystemClock.elapsedRealtime()
        sessionGeneration += 1
        val inkController = controller
        val inkSurface = surface
        if (inkController?.isActive == true && inkSurface != null) {
            inkController.setEnabled(false)
            val width = inkSurface.width.coerceAtLeast(1)
            val height = inkSurface.height.coerceAtLeast(1)
            val transparent = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply {
                eraseColor(Color.TRANSPARENT)
            }
            val fullSurface = Rect(0, 0, width, height)
            inkController.syncOverlay(transparent, fullSurface, force = false)
            val hadReplayPreview = surfaceHasReplayPreview
            val cleared = if (hadReplayPreview) {
                presentReplayPreview(inkSurface, transparent, fullSurface).also {
                    if (it) surfaceHasReplayPreview = false
                }
            } else {
                true
            }
            Log.i(TAG, "pauseInk retained surface cleared=$cleared " +
                "hadPreview=$hadReplayPreview " +
                "totalMs=${SystemClock.elapsedRealtime() - startedMs}")
        }
    }

    /** Rebuilds a fresh daemon buffer from only the strokes belonging to the visible KOReader page. */
    private fun replayInk(request: ReplayRequest) {
        val width = request.surface.width.coerceAtLeast(1)
        val height = request.surface.height.coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)

        if (!request.pageTransition && request.editRect != null && pageBase != null) {
            // Editing the same paper needs no PixelCopy or book repaint. Reuse its clean
            // background; compose saved survivors and changed tools in the dirty region.
            Canvas(bitmap).drawBitmap(pageBase!!, 0f, 0f, null)
            composeAndPresentReplay(request, bitmap, fullFrame = false)
            return
        }
        if (request.pageTransition || toolbar != null) {
            // A full daemon invalidation must contain KOReader's current page, not the daemon's
            // retained previous page. PixelCopy reads the same logical frame as an Android screenshot.
            val captureStartedMs = SystemClock.elapsedRealtime()
            request.surface.postOnAnimation {
                if (!isCurrentSession(request)) return@postOnAnimation
                try {
                    val pageSurface = findPageSurface(request.activity.window.decorView, request.surface)
                        ?: runCatching {
                            val field = request.activity.javaClass.getDeclaredField("view")
                            field.isAccessible = true
                            (field.get(request.activity) as? SurfaceView)?.takeIf {
                                it !== request.surface && it.holder.surface.isValid
                            }
                        }.getOrNull()
                    val nativeSurface = if (pageSurface == null) nativeWindowSurface(request.activity) else null
                    Log.i(TAG, "Page capture source=${if (pageSurface != null) "page-view" else if (nativeSurface != null) "native-window" else "composited-window"}")
                    val callback = PixelCopy.OnPixelCopyFinishedListener callback@{ result ->
                        if (!isCurrentSession(request)) return@callback
                        val captureFinishedMs = SystemClock.elapsedRealtime()
                        if (result == PixelCopy.SUCCESS) {
                            Log.i(TAG, "Captured KOReader destination frame ${width}x$height " +
                                "captureMs=${captureFinishedMs - captureStartedMs}")
                            composeAndPresentReplay(request, bitmap, fullFrame = true)
                        } else {
                            Log.w(TAG, "Destination frame capture failed result=$result; " +
                                "refusing stale full-page daemon refresh")
                            bitmap.eraseColor(Color.TRANSPARENT)
                            composeAndPresentReplay(request, bitmap, fullFrame = false)
                        }
                    }
                    if (pageSurface != null) PixelCopy.request(pageSurface, bitmap, callback,
                        Handler(Looper.getMainLooper()))
                    else if (nativeSurface != null) PixelCopy.request(nativeSurface, bitmap, callback,
                        Handler(Looper.getMainLooper()))
                    else PixelCopy.request(request.activity.window, bitmap, callback,
                        Handler(Looper.getMainLooper()))
                } catch (t: Throwable) {
                    Log.w(TAG, "Destination frame capture failed; refusing stale full-page daemon refresh", t)
                    bitmap.eraseColor(Color.TRANSPARENT)
                    composeAndPresentReplay(request, bitmap, fullFrame = false)
                }
            }
            return
        }

        bitmap.eraseColor(Color.TRANSPARENT)
        composeAndPresentReplay(request, bitmap, fullFrame = false)
    }

    private fun composeAndPresentReplay(
        request: ReplayRequest,
        bitmap: Bitmap,
        fullFrame: Boolean,
    ) {
        val drawStartedMs = SystemClock.elapsedRealtime()
        val width = bitmap.width
        val height = bitmap.height
        val canvas = Canvas(bitmap)
        if (fullFrame) {
            pageBase?.recycle()
            pageBase = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        }
        val paint = Paint().apply {
            isAntiAlias = false
            color = request.color
            strokeWidth = request.strokeWidth
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val dirty = Rect(width, height, 0, 0)
        request.strokes.forEach { styled ->
            val stroke = styled.points
            if (stroke.isEmpty()) return@forEach
            paint.strokeWidth = styled.width
            paint.color = (styled.color and 0x00ffffff) or
                ((styled.opacity.coerceIn(0f, 1f) * 255).toInt() shl 24)
            val path = Path().apply { moveTo(stroke.first().x, stroke.first().y) }
            stroke.drop(1).forEach { point -> path.lineTo(point.x, point.y) }
            if (stroke.size == 1) {
                if (styled.pen == "Brush") paint.strokeWidth = styled.width *
                    (0.3f + 1.7f * stroke.first().pressure.coerceIn(0f, 1f))
                canvas.drawPoint(stroke.first().x, stroke.first().y, paint)
            } else if (styled.pen == "Brush") {
                for (index in 1 until stroke.size) {
                    val from = stroke[index - 1]
                    val to = stroke[index]
                    val pressure = ((from.pressure + to.pressure) / 2f).coerceIn(0f, 1f)
                    paint.strokeWidth = styled.width * (0.3f + 1.7f * pressure)
                    canvas.drawLine(from.x, from.y, to.x, to.y, paint)
                }
            } else {
                canvas.drawPath(path, paint)
            }
            stroke.forEach { point ->
                val x = point.x.toInt().coerceIn(0, width)
                val y = point.y.toInt().coerceIn(0, height)
                if (x < dirty.left) dirty.left = x
                if (y < dirty.top) dirty.top = y
                if (x > dirty.right) dirty.right = x
                if (y > dirty.bottom) dirty.bottom = y
            }
        }
        request.selection?.let { bounds ->
            paint.color = Color.DKGRAY
            paint.strokeWidth = 2f
            paint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(8f, 6f), 0f)
            canvas.drawRect(bounds, paint)
            paint.pathEffect = null
            val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
            for (x in listOf(bounds.left, bounds.right)) for (y in listOf(bounds.top, bounds.bottom)) {
                canvas.drawCircle(x, y, 9f, handlePaint)
                handlePaint.color = Color.DKGRAY
                handlePaint.style = Paint.Style.STROKE
                handlePaint.strokeWidth = 2f
                canvas.drawCircle(x, y, 9f, handlePaint)
                handlePaint.color = Color.WHITE
                handlePaint.style = Paint.Style.FILL
            }
            val tx = bounds.right + 27f
            val ty = bounds.top - 27f
            canvas.drawCircle(tx, ty, 20f, handlePaint)
            paint.pathEffect = null
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2.5f
            paint.color = Color.BLACK
            canvas.drawCircle(tx, ty, 20f, paint)
            canvas.drawRect(tx - 8f, ty - 5f, tx + 8f, ty + 9f, paint)
            canvas.drawLine(tx - 11f, ty - 9f, tx + 11f, ty - 9f, paint)
            canvas.drawLine(tx - 3f, ty - 13f, tx + 3f, ty - 13f, paint)
            dirty.union(bounds.left.toInt(), bounds.top.toInt(), bounds.right.toInt(), bounds.bottom.toInt())
            dirty.union((tx - 21f).toInt(), (ty - 21f).toInt(), (tx + 21f).toInt(), (ty + 21f).toInt())
        }
        if (fullFrame) {
            chromeBase?.recycle()
            chromeBase = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        }
        toolbar?.let { chrome ->
            chrome.drawChrome(canvas)
            if (!fullFrame) dirty.union(chrome.chromeBounds())
        }
        if (dirty.isEmpty && !fullFrame) {
            request.controller.setEnabled(true)
            return
        }
        if (!dirty.isEmpty) {
            val padding = (request.strokes.maxOfOrNull { it.width } ?: request.strokeWidth).toInt() + 4
            dirty.set(
                (dirty.left - padding).coerceAtLeast(0),
                (dirty.top - padding).coerceAtLeast(0),
                (dirty.right + padding).coerceAtMost(width),
                (dirty.bottom + padding).coerceAtMost(height),
            )
        }
        val refreshRect = request.editRect?.takeIf { fullFrame && !request.pageTransition }?.let {
            Rect(it).apply {
                inset(-40, -40)
                intersect(0, 0, width, height)
            }
        } ?: if (fullFrame) Rect(0, 0, width, height) else dirty

        val androidEdit = currentStyle.tool == "eraser" ||
            (currentStyle.tool == "lasso" && request.selection != null)
        // Keep the daemon buffer current for the next pen/lasso stroke, but let Android present
        // eraser and selection edits without a daemon GU16 update covering the SurfaceView.
        request.controller.syncOverlay(bitmap, refreshRect, force = false)
        val previewStartedMs = SystemClock.elapsedRealtime()
        val previewPresented = presentReplayPreview(request.surface, bitmap,
            if (fullFrame) refreshRect else dirty).also {
            if (it) surfaceHasReplayPreview = true
        }
        val previewFinishedMs = SystemClock.elapsedRealtime()
        if (androidEdit && previewPresented) {
            request.controller.setOverlayVisible(false)
            androidDisplayMode = true
        }
        Log.i(TAG, "Replay preview presented=$previewPresented fullFrame=$fullFrame " +
            "rect=$refreshRect " +
            "drawMs=${previewStartedMs - drawStartedMs} previewMs=${previewFinishedMs - previewStartedMs} " +
            "totalMs=${previewFinishedMs - request.startedMs}")

        request.surface.postOnAnimation {
            if (!isCurrentSession(request)) return@postOnAnimation
            val refreshStartedMs = SystemClock.elapsedRealtime()
            if (!androidEdit || !previewPresented) {
                request.controller.setOverlayVisible(true)
                androidDisplayMode = false
                request.controller.syncOverlay(bitmap, refreshRect, force = true)
            }
            request.controller.setEnabled(true)
            val refreshFinishedMs = SystemClock.elapsedRealtime()
            Log.i(TAG, "Replayed ${request.strokes.size} page-scoped strokes in $refreshRect with GU16 " +
                "fullFrame=$fullFrame " +
                "frameWaitMs=${refreshStartedMs - previewFinishedMs} " +
                "submitMs=${refreshFinishedMs - refreshStartedMs} " +
                "totalMs=${refreshFinishedMs - request.startedMs}")
            // Do not recycle: SurfaceFlinger may still be consuming the preview buffer. Dropping
            // the closure reference lets Android reclaim it after both consumers are finished.
        }
    }

    private fun isCurrentSession(request: ReplayRequest): Boolean =
        hostForeground && sessionGeneration == request.generation && surface === request.surface && controller === request.controller

    private fun findPageSurface(view: View, inkSurface: SurfaceView): SurfaceView? {
        if (view is SurfaceView && view !== inkSurface && view.width > 0 && view.height > 0)
            return view
        if (view is ViewGroup) for (index in 0 until view.childCount) {
            findPageSurface(view.getChildAt(index), inkSurface)?.let { return it }
        }
        return null
    }

    private fun nativeWindowSurface(activity: Activity): Surface? = runCatching {
        val decor = activity.window.decorView
        val rootMethod = View::class.java.getDeclaredMethod("getViewRootImpl")
        rootMethod.isAccessible = true
        val viewRoot = rootMethod.invoke(decor) ?: return@runCatching null
        val surfaceField = viewRoot.javaClass.getDeclaredField("mSurface")
        surfaceField.isAccessible = true
        (surfaceField.get(viewRoot) as? Surface)?.takeIf { it.isValid }
    }.getOrNull()

    private fun presentReplayPreview(inkSurface: SurfaceView, bitmap: Bitmap, dirty: Rect): Boolean {
        var surfaceCanvas: Canvas? = null
        return try {
            // lockCanvas treats this as an in/out damage rect and may expand it to the whole
            // surface. Never let that mutation widen the later authoritative GU16 refresh.
            val surfaceDirty = Rect(dirty)
            surfaceCanvas = inkSurface.holder.lockCanvas(surfaceDirty) ?: return false
            val checkpoint = surfaceCanvas.save()
            surfaceCanvas.clipRect(dirty)
            surfaceCanvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            val copyPaint = Paint().apply {
                xfermode = android.graphics.PorterDuffXfermode(PorterDuff.Mode.SRC)
            }
            surfaceCanvas.drawBitmap(bitmap, 0f, 0f, copyPaint)
            surfaceCanvas.restoreToCount(checkpoint)
            true
        } catch (t: Throwable) {
            Log.w(TAG, "Replay preview failed: ${t.message}", t)
            false
        } finally {
            surfaceCanvas?.let { runCatching { inkSurface.holder.unlockCanvasAndPost(it) } }
        }
    }

    private fun drawPreviewStroke(canvas: Canvas, stroke: InkStroke, transform: (Float, Float) -> Pair<Float, Float>) {
        if (stroke.points.isEmpty()) return
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = (stroke.color and 0x00ffffff) or
                ((stroke.opacity.coerceIn(0f, 1f) * 255).toInt() shl 24)
            strokeWidth = stroke.width
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val first = transform(stroke.points.first().x, stroke.points.first().y)
        if (stroke.points.size == 1) {
            canvas.drawPoint(first.first, first.second, paint)
            return
        }
        val path = Path().apply { moveTo(first.first, first.second) }
        stroke.points.drop(1).forEach { point ->
            val mapped = transform(point.x, point.y)
            path.lineTo(mapped.first, mapped.second)
        }
        canvas.drawPath(path, paint)
    }

    private fun sameInk(left: List<InkStroke>, right: List<InkStroke>): Boolean {
        if (left.size != right.size) return false
        return left.indices.all { index ->
            val a = left[index]; val b = right[index]
            a.points.size == b.points.size && a.width == b.width && a.color == b.color &&
                a.pen == b.pen && kotlin.math.abs(a.opacity - b.opacity) < 0.01f &&
                a.points.indices.all { point ->
                    kotlin.math.abs(a.points[point].x - b.points[point].x) < 0.6f &&
                    kotlin.math.abs(a.points[point].y - b.points[point].y) < 0.6f
                }
        }
    }

    private fun sampledInk(points: List<StrokePoint>, spacing: Float): List<StrokePoint> {
        if (points.size < 2) return points
        val result = ArrayList<StrokePoint>()
        result.add(points.first())
        for (index in 1 until points.size) {
            val from = points[index - 1]; val to = points[index]
            val length = kotlin.math.hypot((to.x - from.x).toDouble(), (to.y - from.y).toDouble())
            val steps = kotlin.math.ceil(length / spacing.coerceAtLeast(1f)).toInt().coerceIn(1, 256)
            for (step in 1..steps) {
                val t = step.toFloat() / steps
                result.add(StrokePoint(from.x + (to.x - from.x) * t,
                    from.y + (to.y - from.y) * t,
                    from.pressure + (to.pressure - from.pressure) * t,
                    (from.timestampMs + (to.timestampMs - from.timestampMs) * t).toLong()))
            }
        }
        return result
    }

    private fun nearInk(point: StrokePoint, gesture: List<StrokePoint>, radius: Float): Boolean {
        if (gesture.isEmpty()) return false
        val radius2 = radius * radius
        for (index in gesture.indices) {
            val from = gesture[if (index == 0) 0 else index - 1]
            val to = gesture[index]
            val vx = to.x - from.x; val vy = to.y - from.y
            val length2 = vx * vx + vy * vy
            val t = if (length2 > 0f)
                (((point.x - from.x) * vx + (point.y - from.y) * vy) / length2).coerceIn(0f, 1f)
                else 0f
            val dx = point.x - (from.x + vx * t)
            val dy = point.y - (from.y + vy * t)
            if (dx * dx + dy * dy <= radius2) return true
        }
        return false
    }

    private fun insideInkPolygon(point: StrokePoint, polygon: List<StrokePoint>): Boolean {
        if (polygon.size < 3) return false
        var inside = false
        var previous = polygon.last()
        for (current in polygon) {
            if ((current.y > point.y) != (previous.y > point.y) &&
                point.x < (previous.x - current.x) * (point.y - current.y) /
                    (previous.y - current.y) + current.x) inside = !inside
            previous = current
        }
        return inside
    }

    private fun nativeErase(strokes: List<InkStroke>, gesture: List<StrokePoint>, style: InkToolbar.Style): List<InkStroke> {
        val radius = maxOf(3f, style.width)
        val result = ArrayList<InkStroke>()
        when (style.eraser) {
            "stroke" -> strokes.forEach { stroke ->
                if (sampledInk(stroke.points, radius / 2f).none { nearInk(it, gesture, radius) })
                    result.add(stroke)
            }
            "range" -> strokes.forEach { stroke ->
                if (sampledInk(stroke.points, 3f).none { insideInkPolygon(it, gesture) }) result.add(stroke)
            }
            else -> strokes.forEach { stroke ->
                var section = ArrayList<StrokePoint>()
                for (point in sampledInk(stroke.points, radius / 2f)) {
                    if (nearInk(point, gesture, radius)) {
                        if (section.isNotEmpty()) {
                            result.add(stroke.copy(points = section))
                            section = ArrayList()
                        }
                    } else section.add(point)
                }
                if (section.isNotEmpty()) result.add(stroke.copy(points = section))
            }
        }
        return result
    }

    private fun includeStroke(rect: Rect, stroke: InkStroke) {
        stroke.points.forEach { rect.union(it.x.toInt(), it.y.toInt()) }
    }

    private fun presentNativeEdit(next: List<InkStroke>, dirty: Rect, selected: RectF? = selectionBounds,
                                  erasing: Boolean = false) {
        val page = pageBase ?: return
        val inkSurface = surface ?: return
        val inkController = controller ?: return
        if (dirty.isEmpty) return
        pendingEraseClean?.let(eraseRefreshHandler::removeCallbacks)
        pendingEraseClean = null
        pendingEraseDirty?.let(dirty::union)
        pendingEraseDirty = null
        val bitmap = page.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(bitmap)
        next.forEach { drawPreviewStroke(canvas, it) { x, y -> x to y } }
        chromeBase?.recycle()
        chromeBase = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        selected?.let { box ->
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.DKGRAY; style = Paint.Style.STROKE; strokeWidth = 2f
                pathEffect = android.graphics.DashPathEffect(floatArrayOf(8f, 6f), 0f)
            }
            canvas.drawRect(box, paint)
            paint.pathEffect = null
            paint.color = Color.WHITE
            paint.style = Paint.Style.FILL
            for (cx in listOf(box.left, box.right)) for (cy in listOf(box.top, box.bottom)) {
                canvas.drawCircle(cx, cy, 9f, paint)
                paint.color = Color.DKGRAY; paint.style = Paint.Style.STROKE
                canvas.drawCircle(cx, cy, 9f, paint)
                paint.color = Color.WHITE; paint.style = Paint.Style.FILL
            }
            val tx = box.right + 27f; val ty = box.top - 27f
            canvas.drawCircle(tx, ty, 20f, paint)
            paint.color = Color.BLACK; paint.style = Paint.Style.STROKE
            canvas.drawCircle(tx, ty, 20f, paint)
            canvas.drawRect(tx - 8f, ty - 5f, tx + 8f, ty + 9f, paint)
            canvas.drawLine(tx - 11f, ty - 9f, tx + 11f, ty - 9f, paint)
            canvas.drawLine(tx - 3f, ty - 13f, tx + 3f, ty - 13f, paint)
            dirty.union((tx - 21f).toInt(), (ty - 21f).toInt(),
                (tx + 21f).toInt(), (ty + 21f).toInt())
        }
        toolbar?.drawChrome(canvas)
        dirty.inset(-40, -40)
        dirty.intersect(0, 0, bitmap.width, bitmap.height)
        if (dirty.isEmpty) return
        if (!presentReplayPreview(inkSurface, bitmap, dirty)) return
        // Notes commits the retained bitmap and then force-refreshes only the changed paper.
        inkController.setOverlayVisible(true)
        androidDisplayMode = false
        if (erasing) {
            val cleanRegion = Rect(dirty)
            inkController.syncOverlayRubber(bitmap, cleanRegion)
            pendingEraseDirty = cleanRegion
            val generation = sessionGeneration
            val clean = Runnable {
                pendingEraseClean = null
                pendingEraseDirty = null
                if (sessionGeneration == generation && controller === inkController && surface === inkSurface)
                    inkController.syncOverlay(bitmap, cleanRegion, force = true)
            }
            pendingEraseClean = clean
            eraseRefreshHandler.postDelayed(clean, 450L)
        } else inkController.syncOverlay(bitmap, dirty, force = true)
        replayedStrokes = next
        nativeEditPending = true
    }

    private fun prepareSelectionScene(x: Float, y: Float) {
        selectionScene?.recycle(); selectionScene = null
        val base = pageBase ?: return
        if (selectedStrokeIndices.isEmpty()) return
        selectionStartX = x; selectionStartY = y
        val scene = base.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(scene)
        replayedStrokes.forEachIndexed { index, stroke ->
            if (index !in selectedStrokeIndices)
                drawPreviewStroke(canvas, stroke) { px, py -> px to py }
        }
        selectionScene = scene
        previousSelectionPreview = null
        lastSelectionPreviewMs = 0L
    }

    private fun previewSelection(x: Float, y: Float, force: Boolean = false) {
        val scene = selectionScene ?: return
        val box = selectionBounds ?: return
        val inkSurface = surface ?: return
        val now = SystemClock.uptimeMillis()
        if (!force && now - lastSelectionPreviewMs < 32L) return
        lastSelectionPreviewMs = now
        val dx = x - selectionStartX; val dy = y - selectionStartY
        val handles = lassoHandle.split(',')
        val horizontal = handles.getOrNull(0) ?: ""
        val vertical = handles.getOrNull(1) ?: ""
        val anchorX = if (horizontal == "left") box.right else box.left
        val anchorY = if (vertical == "top") box.bottom else box.top
        val sx = if (lassoGesture != "resize") 1f else when (horizontal) {
            "left" -> 1f - dx / (box.width().coerceAtLeast(20f))
            "right" -> 1f + dx / (box.width().coerceAtLeast(20f))
            else -> 1f
        }.coerceIn(0.1f, 8f)
        val sy = if (lassoGesture != "resize") 1f else when (vertical) {
            "top" -> 1f - dy / (box.height().coerceAtLeast(20f))
            "bottom" -> 1f + dy / (box.height().coerceAtLeast(20f))
            else -> 1f
        }.coerceIn(0.1f, 8f)
        val map: (Float, Float) -> Pair<Float, Float> = { px, py ->
            if (lassoGesture == "move") (px + dx) to (py + dy)
            else (anchorX + (px - anchorX) * sx) to (anchorY + (py - anchorY) * sy)
        }
        val bitmap = scene.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(bitmap)
        replayedStrokes.forEachIndexed { index, stroke ->
            if (index in selectedStrokeIndices) drawPreviewStroke(canvas, stroke, map)
        }
        val p1 = map(box.left, box.top); val p2 = map(box.right, box.bottom)
        val transformed = RectF(minOf(p1.first, p2.first), minOf(p1.second, p2.second),
            maxOf(p1.first, p2.first), maxOf(p1.second, p2.second))
        val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.DKGRAY; style = Paint.Style.STROKE; strokeWidth = 2f
            pathEffect = android.graphics.DashPathEffect(floatArrayOf(8f, 6f), 0f)
        }
        canvas.drawRect(transformed, outline)
        toolbar?.drawChrome(canvas)
        val dirty = Rect(box.left.toInt() - 50, box.top.toInt() - 70,
            box.right.toInt() + 70, box.bottom.toInt() + 50)
        dirty.union(transformed.left.toInt() - 50, transformed.top.toInt() - 70,
            transformed.right.toInt() + 70, transformed.bottom.toInt() + 50)
        previousSelectionPreview?.let { dirty.union(it) }
        dirty.intersect(0, 0, bitmap.width, bitmap.height)
        if (!dirty.isEmpty) presentReplayPreview(inkSurface, bitmap, dirty)
        previousSelectionPreview = Rect(dirty)
    }

    private fun presentChromePreview(inkSurface: SurfaceView, bitmap: Bitmap, region: Rect) {
        var surfaceCanvas: Canvas? = null
        try {
            surfaceCanvas = inkSurface.holder.lockCanvas(Rect(region)) ?: return
            val checkpoint = surfaceCanvas.save()
            surfaceCanvas.clipRect(region)
            surfaceCanvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            val paint = Paint().apply {
                xfermode = android.graphics.PorterDuffXfermode(PorterDuff.Mode.SRC)
            }
            surfaceCanvas.drawBitmap(bitmap, region.left.toFloat(), region.top.toFloat(), paint)
            surfaceCanvas.restoreToCount(checkpoint)
        } catch (t: Throwable) {
            Log.w(TAG, "Toolbar preview refresh failed", t)
        } finally {
            surfaceCanvas?.let { runCatching { inkSurface.holder.unlockCanvasAndPost(it) } }
        }
    }

    private fun decodeStrokes(value: JSONArray?): List<InkStroke> {
        if (value == null) return emptyList()
        val strokes = ArrayList<InkStroke>(value.length().coerceAtMost(MAX_STROKES))
        var totalPoints = 0
        for (strokeIndex in 0 until value.length().coerceAtMost(MAX_STROKES)) {
            val item = value.optJSONObject(strokeIndex)
            val encodedStroke = item?.optJSONArray("points") ?: value.optJSONArray(strokeIndex) ?: continue
            val stroke = ArrayList<StrokePoint>(encodedStroke.length().coerceAtMost(MAX_POINTS_PER_STROKE))
            for (pointIndex in 0 until encodedStroke.length().coerceAtMost(MAX_POINTS_PER_STROKE)) {
                if (totalPoints >= MAX_REPLAY_POINTS) break
                val point = encodedStroke.optJSONArray(pointIndex) ?: continue
                if (point.length() < 2) continue
                stroke.add(StrokePoint(
                    point.optDouble(0).toFloat(),
                    point.optDouble(1).toFloat(),
                    point.optDouble(2, 1.0).toFloat(),
                    point.optLong(3, 0L),
                ))
                totalPoints += 1
            }
            if (stroke.isNotEmpty()) strokes.add(InkStroke(stroke,
                item?.optDouble("width", 5.0)?.toFloat()?.coerceIn(1f, 40f) ?: 5f,
                item?.optInt("color", Color.BLACK) ?: Color.BLACK,
                item?.optDouble("opacity", 1.0)?.toFloat()?.coerceIn(0f, 1f) ?: 1f,
                item?.optString("pen", "Pen") ?: "Pen"))
            if (totalPoints >= MAX_REPLAY_POINTS) break
        }
        return strokes
    }

    private val CALLBACK = object : StrokeCallback {
        override fun onStrokeBegin(x: Float, y: Float, pressure: Float, timestampMs: Long) {
            // An old eraser frame must never replace pixels from a newer live stroke.
            pendingEraseClean?.let(eraseRefreshHandler::removeCallbacks)
            pendingEraseClean = null
            pendingEraseDirty = null
            activeStrokeStyle = currentStyle
            if (currentStyle.tool == "eraser") {
                // Capture-only erasing adds no live pixels. Keep the existing daemon
                // ink visible until completion presents canonical survivors; Android's
                // last Surface frame does not yet include recent live pen strokes.
                controller?.setOverlayVisible(true)
                androidDisplayMode = false
            }
            if (currentStyle.tool == "lasso") lassoHit(x, y).also {
                lassoGesture = it.mode
                lassoHandle = it.handle
            }
            if (lassoGesture == "move" || lassoGesture == "resize") prepareSelectionScene(x, y)
            recordDaemonPenSignal(true)
            toolbar?.showPlacementGuide(y)
            toolbar?.showTrail(x, y)
        }

        override fun onStrokeMove(x: Float, y: Float, pressure: Float, timestampMs: Long) {
            recordDaemonPenSignal(true)
            if (activeStrokeStyle.tool == "lasso" && (lassoGesture == "move" || lassoGesture == "resize"))
                previewSelection(x, y)
            toolbar?.showPlacementGuide(y)
            toolbar?.showTrail(x, y)
        }

        override fun onStrokeEnd(x: Float, y: Float, pressure: Float, timestampMs: Long) {
            recordDaemonPenSignal(false)
            if (activeStrokeStyle.tool == "lasso" && (lassoGesture == "move" || lassoGesture == "resize"))
                previewSelection(x, y, force = true)
            toolbar?.hidePlacementGuide()
            toolbar?.hideTrail()
        }

        override fun onStrokeComplete(points: List<StrokePoint>) {
            recordDaemonPenSignal(false)
            val style = activeStrokeStyle
            if (style.tool == "canvas" || style.tool == "sticky") {
                points.firstOrNull()?.let { first ->
                    enqueueEvent(JSONObject().put("kind", "action").put("name", "place-${style.tool}")
                        .put("x", first.x).put("y", first.y).put("endY", points.last().y))
                }
                return
            }
            val stroke = JSONArray()
            val rendered = if (style.tool == "highlighter" && style.straight && points.size > 1) {
                val y = points.map { it.y }.average().toFloat()
                listOf(points.first().copy(y = y), points.last().copy(y = y))
            } else points
            rendered.take(MAX_POINTS_PER_STROKE).forEach { point ->
                stroke.put(JSONArray().put(point.x).put(point.y).put(point.pressure).put(point.timestampMs))
            }
            if (stroke.length() > 0) {
                if (style.tool == "eraser" || style.tool == "lasso") {
                    val mode = if (style.tool == "eraser") style.eraser else lassoGesture
                    if (style.tool == "lasso" && mode == "delete")
                        enqueueEvent(JSONObject().put("kind", "action").put("name", "delete-selection"))
                    else enqueueEvent(JSONObject().put("kind", style.tool).put("mode", mode)
                        .put("handle", lassoHandle).put("points", stroke).put("width", style.width))
                    if (style.tool == "eraser") {
                        val old = replayedStrokes
                        val next = nativeErase(old, points, style)
                        val radius = maxOf(3f, style.width).toInt() + 4
                        val rect = Rect(points.minOf { it.x }.toInt() - radius,
                            points.minOf { it.y }.toInt() - radius,
                            points.maxOf { it.x }.toInt() + radius + 1,
                            points.maxOf { it.y }.toInt() + radius + 1)
                        if (style.eraser != "track") old.forEach { original ->
                            if (original !in next) includeStroke(rect, original)
                        }
                        // A lasso paints transient dashed ink even on a miss. Always retire
                        // that trail from the canonical page rather than recapturing it later.
                        if (style.eraser == "range" || !sameInk(old, next))
                            presentNativeEdit(next, rect, selected = null, erasing = true)
                    } else if (mode == "select") {
                        val selected = replayedStrokes.indices.filter { index ->
                            replayedStrokes[index].points.any { insideInkPolygon(it, points) }
                        }.toSet()
                        selectedStrokeIndices = selected
                        Log.i(TAG, "lasso native selection=${selected.size} gesturePoints=${points.size}")
                        val box = Rect()
                        var found = false
                        replayedStrokes.forEachIndexed { index, item ->
                            if (index in selected) for (point in item.points) {
                                if (!found) {
                                    box.set(point.x.toInt(), point.y.toInt(), point.x.toInt() + 1, point.y.toInt() + 1)
                                    found = true
                                } else box.union(point.x.toInt(), point.y.toInt())
                            }
                        }
                        selectionBounds = if (found) RectF(box) else null
                        val dirty = Rect(points.minOf { it.x }.toInt(), points.minOf { it.y }.toInt(),
                            points.maxOf { it.x }.toInt() + 1, points.maxOf { it.y }.toInt() + 1)
                        if (found) dirty.union(box)
                        presentNativeEdit(replayedStrokes, dirty, selectionBounds)
                    } else if (mode == "move" || mode == "resize") {
                        val box = selectionBounds
                        if (box != null && selectedStrokeIndices.isNotEmpty() && points.size >= 2) {
                            val dx = points.last().x - points.first().x
                            val dy = points.last().y - points.first().y
                            val handles = lassoHandle.split(',')
                            val horizontal = handles.getOrNull(0) ?: ""
                            val vertical = handles.getOrNull(1) ?: ""
                            val anchorX = if (horizontal == "left") box.right else box.left
                            val anchorY = if (vertical == "top") box.bottom else box.top
                            val sx = if (mode != "resize") 1f else when (horizontal) {
                                "left" -> 1f - dx / box.width().coerceAtLeast(20f)
                                "right" -> 1f + dx / box.width().coerceAtLeast(20f)
                                else -> 1f
                            }.coerceIn(0.1f, 8f)
                            val sy = if (mode != "resize") 1f else when (vertical) {
                                "top" -> 1f - dy / box.height().coerceAtLeast(20f)
                                "bottom" -> 1f + dy / box.height().coerceAtLeast(20f)
                                else -> 1f
                            }.coerceIn(0.1f, 8f)
                            val map: (StrokePoint) -> StrokePoint = { point ->
                                if (mode == "move") point.copy(x = point.x + dx, y = point.y + dy)
                                else point.copy(x = anchorX + (point.x - anchorX) * sx,
                                    y = anchorY + (point.y - anchorY) * sy)
                            }
                            val next = replayedStrokes.mapIndexed { index, item ->
                                if (index !in selectedStrokeIndices) item else item.copy(
                                    points = item.points.map(map),
                                    width = if (mode == "resize")
                                        (item.width * (sx + sy) / 2f).coerceIn(1f, 40f) else item.width)
                            }
                            val oldRect = Rect(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt())
                            val first = map(StrokePoint(box.left, box.top, 1f, 0L))
                            val last = map(StrokePoint(box.right, box.bottom, 1f, 0L))
                            val moved = RectF(minOf(first.x, last.x), minOf(first.y, last.y),
                                maxOf(first.x, last.x), maxOf(first.y, last.y))
                            val dirty = Rect(oldRect).apply {
                                union(moved.left.toInt(), moved.top.toInt(), moved.right.toInt(), moved.bottom.toInt())
                            }
                            selectionBounds = moved
                            presentNativeEdit(next, dirty, moved)
                        }
                    } else if (mode == "delete" && selectedStrokeIndices.isNotEmpty()) {
                        val box = selectionBounds
                        val next = replayedStrokes.filterIndexed { index, _ -> index !in selectedStrokeIndices }
                        selectedStrokeIndices = emptySet()
                        selectionBounds = null
                        if (box != null) presentNativeEdit(next,
                            Rect(box.left.toInt(), box.top.toInt(), box.right.toInt(), box.bottom.toInt()), null)
                    }
                    if (style.tool == "lasso" && selectionAction != "select") selectionAction = "select"
                } else {
                    val selection = selectionGesture(points, style)
                    if (selection != null) {
                        enqueueEvent(JSONObject().put("kind", "lasso").put("mode", selection)
                            .put("points", stroke))
                        return
                    }
                    val item = JSONObject().put("points", stroke).put("tool", style.tool)
                        .put("pen", style.pen).put("width", style.width)
                        .put("color", style.color).put("opacity", if (style.tool == "highlighter") 0.38 else 1.0)
                    while (completed.size >= MAX_STROKES) completed.poll()
                    completed.add(item)
                    replayedStrokes = replayedStrokes + InkStroke(rendered, style.width, style.color,
                        if (style.tool == "highlighter") 0.38f else 1f, style.pen)
                    chromeBase?.let { base ->
                        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                            color = (style.color and 0x00ffffff) or
                                ((if (style.tool == "highlighter") 0.38f else 1f) * 255).toInt().shl(24)
                            strokeWidth = style.width
                            this.style = Paint.Style.STROKE
                            strokeCap = Paint.Cap.ROUND
                            strokeJoin = Paint.Join.ROUND
                        }
                        val path = Path().apply {
                            moveTo(rendered.first().x, rendered.first().y)
                            rendered.drop(1).forEach { lineTo(it.x, it.y) }
                        }
                        if (rendered.size == 1) Canvas(base).drawPoint(rendered.first().x,
                            rendered.first().y, paint) else Canvas(base).drawPath(path, paint)
                    }
                }
            }
        }
    }

    private fun selectionGesture(points: List<StrokePoint>, style: InkToolbar.Style): String? {
        if (style.tool != "pen" || points.size < 3) return null
        val first = points.first()
        val last = points.last()
        val direct = kotlin.math.hypot((last.x - first.x).toDouble(),
            (last.y - first.y).toDouble())
        var travel = 0.0
        for (index in 1 until points.size) {
            travel += kotlin.math.hypot((points[index].x - points[index - 1].x).toDouble(),
                (points[index].y - points[index - 1].y).toDouble())
        }
        val width = points.maxOf { it.x } - points.minOf { it.x }
        val height = points.maxOf { it.y } - points.minOf { it.y }
        if (style.circleSelection && direct < travel * 0.2 && width > 24 && height > 24)
            return "circle"
        if (style.lineSelection && travel > 60 && direct > travel * 0.9) return "line"
        return null
    }

    private fun captureOnly(): Boolean = currentStyle.tool == "canvas" || currentStyle.tool == "sticky" || (currentStyle.tool == "eraser" && currentStyle.eraser != "range") ||
        (currentStyle.tool == "highlighter" && currentStyle.straight)

    private fun enqueueEvent(event: JSONObject) {
        while (toolEvents.size >= MAX_STROKES) toolEvents.poll()
        toolEvents.add(event)
    }

    private fun showToolbar(activity: Activity, context: String, canvasAvailable: Boolean, originalInkAvailable: Boolean, originalInkView: Boolean, writingBounds: Rect, stickyHeader: Rect?) {
        toolbar?.close()
        // Placement ends at the new scoped writing surface, before any ink is admitted.
        if (context != "full-page" && (currentStyle.tool == "canvas" || currentStyle.tool == "sticky"))
            currentStyle = currentStyle.copy(tool = "pen")
        toolbar = InkToolbar(activity, context = context, initialStyle = currentStyle, canvasAvailable = canvasAvailable, originalInkAvailable = originalInkAvailable, originalInkView = originalInkView, writingBounds = writingBounds, stickyHeader = stickyHeader,
            place = { tool, x, y, endY -> enqueueEvent(JSONObject().put("kind", "action")
                .put("name", "place-$tool").put("x", x).put("y", y).put("endY", endY)) },
            changed = { style ->
                currentStyle = style
                val liveColor = if (style.tool == "highlighter")
                    (style.color and 0x00ffffff) or (96 shl 24) else style.color
                controller?.setStrokeStyle(style.width, liveColor)
                controller?.setPressureMode(style.tool == "pen" && style.pen == "Brush")
                controller?.setCaptureOnly(captureOnly())
                controller?.setDashMode(style.tool == "lasso" || style.tool == "eraser" && style.eraser == "range")
                val regular = style.tool == "lasso" && selectionBounds != null
                if (regular != androidDisplayMode) {
                    controller?.setOverlayVisible(!regular)
                    androidDisplayMode = regular
                    if (!regular) chromeBase?.let { base ->
                        controller?.syncOverlay(base, Rect(0, 0, base.width, base.height), force = true)
                    }
                }
            },
            action = { name ->
                when (name) {
                    "move-mode" -> selectionAction = "move"
                    "resize-mode" -> selectionAction = "resize"
                    else -> enqueueEvent(JSONObject().put("kind", "action").put("name", name))
                }
            },
            exclusion = { rect -> controller?.setWritingExclusion(rect.left, rect.top, rect.right, rect.bottom) },
            chromeChanged = { rect -> refreshChrome(activity, rect) },
        ).also { it.show() }
    }

    private fun refreshChrome(activity: Activity, requested: Rect) {
        val inkSurface = surface ?: return
        val inkController = controller ?: return
        val generation = sessionGeneration
        chromeRequestGeneration += 1
        val chromeGeneration = chromeRequestGeneration
        val clipped = Rect(requested)
        if (!clipped.intersect(0, 0, inkSurface.width, inkSurface.height)) return
        // A later guide/panel update cancels this callback, but must still erase its
        // old pixels. Keep damage until the current replacement was actually drawn.
        val damage = chromeDamage.add(generation, clipped)
        val region = damage.bounds
        inkSurface.postOnAnimation {
            if (!hostForeground || sessionGeneration != generation || chromeRequestGeneration != chromeGeneration ||
                surface !== inkSurface || controller !== inkController)
                return@postOnAnimation
            val bitmap = Bitmap.createBitmap(region.width(), region.height(), Bitmap.Config.ARGB_8888)
            try {
                chromeBase?.takeIf { it.width >= region.right && it.height >= region.bottom }?.let { base ->
                    val canvas = Canvas(bitmap)
                    canvas.drawBitmap(base, Rect(region), Rect(0, 0, region.width(), region.height()), null)
                    canvas.translate(-region.left.toFloat(), -region.top.toFloat())
                    toolbar?.drawChrome(canvas)
                    presentChromePreview(inkSurface, bitmap, region)
                    inkController.syncChrome(bitmap, region)
                    chromeDamage.presented(damage)
                    return@postOnAnimation
                }
                PixelCopy.request(activity.window, region, bitmap, { result ->
                    if (!hostForeground || sessionGeneration != generation || chromeRequestGeneration != chromeGeneration ||
                        surface !== inkSurface || controller !== inkController)
                        return@request
                    if (result != PixelCopy.SUCCESS) {
                        Log.w(TAG, "Toolbar background capture failed result=$result")
                        return@request
                    }
                    val canvas = Canvas(bitmap)
                    canvas.translate(-region.left.toFloat(), -region.top.toFloat())
                    toolbar?.drawChrome(canvas)
                    presentChromePreview(inkSurface, bitmap, region)
                    inkController.syncChrome(bitmap, region)
                    chromeDamage.presented(damage)
                }, Handler(Looper.getMainLooper()))
            } catch (t: Throwable) {
                Log.w(TAG, "Toolbar background capture failed", t)
            }
        }
    }

    private const val MAX_STROKES = 2_000
    private const val MAX_POINTS_PER_STROKE = 8_000
    private const val MAX_REPLAY_POINTS = 250_000
    private const val PEN_RELEASE_GRACE_MS = 350L
    private const val NO_PEN_SIGNAL = Long.MIN_VALUE
    private const val TAG = "KalamosBridge"
}
