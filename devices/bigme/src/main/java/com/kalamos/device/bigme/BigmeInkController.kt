package com.kalamos.device.bigme

import com.kalamos.device.api.ink.InkDiagnostics
import android.graphics.Rect
import android.os.Build
import android.util.Log
import android.view.SurfaceView
import com.kalamos.device.api.ink.InkController
import com.kalamos.device.api.ink.InkDefaults
import com.kalamos.device.api.ink.PerfCounters
import com.kalamos.device.api.ink.PerfMetric
import com.kalamos.device.api.ink.StrokeCallback
import com.kalamos.device.api.ink.StrokePoint
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy

/**
 * Low-latency ink for Bigme e-ink devices via the undocumented `com.xrz.HandwrittenClient`
 * API (in `framework.jar`'s classes5.dex; BOOTCLASSPATH-reachable). The client
 * connects to the native `/system/bin/handwrittenservice` daemon over binder,
 * binds a host view, and exposes an ION-backed Canvas the app draws to — the
 * daemon then refreshes the EPD for each `inValidate()` region.
 *
 * Verified on Bigme HiBreak Plus (Android 14, daemon v1.4.0).
 *
 * ## API surface (all reflective; classes exist only on xrz firmware)
 * ```
 * HandwrittenClient(Context)
 *   int bindView(View)
 *   boolean connect(int width, int height)
 *   void registerInputListener(InputListener)
 *   void setInputEnabled(boolean)
 *   void setOverlayEnabled(boolean)
 *   void setBlendEnabled(boolean)
 *   void setUseRawInputEvent(boolean)
 *   void inValidate(Rect, int mode)
 *   Canvas getCanvas()
 *   Bitmap getContent()
 *   Rect getViewLayout() / getPhyViewLayout()
 *   int getPhyRotation() / getCurViewRotation()
 *   boolean updateLayout()
 *   boolean updateRotation()
 *   void unBindView()
 *   void disconnect()
 *
 * HandwrittenClient.InputListener
 *   int onInputTouch(action, x, y, pressure, tool)
 *   int onInputTouch(action, x, y, pressure, tool, time)
 *
 * Constants: ACTION_NEAR=0 DOWN=1 MOVE=2 UP=3 LEAVE=4
 *            TOOL_PEN=0 RUBBER=1 FINGER=2
 *            FORMAT_GRAY8=0 RGBA8888=1
 *            MODE_HANDWRITE=1029 MODE_RUBBER=1030 MODE_GU16=132 MODE_GC16=4
 * ```
 */
class BigmeInkController : InkController {

    override var isActive: Boolean = false
        private set

    /** Daemon consumes input events once connected (similar to Onyx TouchHelper). */
    override val consumesMotionEvents: Boolean get() = isActive

    private var client: Any? = null
    private var clientClass: Class<*>? = null
    private var attachedView: SurfaceView? = null
    // Re-entrance guard — bindView() synchronously fires surfaceCreated, which
    // can re-enter attach(). Without this guard we'd build a second client.
    private var attaching: Boolean = false
    private var diagnosticPresentations = 0
    private var diagnosticActiveBlits = 0
    private var diagnosticStrokes = 0
    private val diagnosticPenActive = java.util.concurrent.atomic.AtomicBoolean(false)
    private fun traceFields() = mapOf("controller" to System.identityHashCode(this),
        "view" to attachedView?.let { System.identityHashCode(it) }, "penActive" to diagnosticPenActive.get())
    private fun tracePixels(name: String, canvas: android.graphics.Canvas) {
        if (!InkDiagnostics.enabled) return
        val values = FloatArray(9)
        val matrix = android.graphics.Matrix()
        canvas.getMatrix(matrix); matrix.getValues(values)
        val pixels = diagnosticPixels
        if (pixels == null) { InkDiagnostics.event("buffer.unavailable", traceFields() + mapOf("capture" to name)); return }
        InkDiagnostics.buffer(name, pixels, canvas.width, canvas.height, traceFields() + mapOf("matrix" to values.toList(),
            "clip" to canvas.clipBounds.toShortString(), "rotation" to runCatching { clientClass?.getMethod("getPhyRotation")?.invoke(client) }.getOrNull()))
    }
    private var presentationDiagnostics = 0
    private var diagnosticPixels: java.nio.ByteBuffer? = null
    private var diagnosticPixelWidth = 0

    private var pendingWidth: Float = InkDefaults.DEFAULT_STROKE_WIDTH_PX
    private var pendingColor: Int = InkDefaults.DEFAULT_STROKE_COLOR
    // Pen events with view-local y < this are ignored (the toolbar strip isn't a drawing area).
    // 0 = no constraint. Set by the host from a JS-provided, post-layout measurement.
    @Volatile private var writingTopPx: Int = 0
    // The floating menu's bounds (view px); pen inside is ignored. Empty (r<=l) = no exclusion.
    @Volatile private var exclL: Int = 0
    @Volatile private var exclT: Int = 0
    @Volatile private var exclR: Int = 0
    @Volatile private var exclB: Int = 0
    // Writing bounds (view px): when set (r>l && b>t) the pen is ignored OUTSIDE this rect — used to
    // confine drawing to a bounded sketch/sticky-note box. Empty = no bound (write anywhere).
    @Volatile private var boundL: Int = 0
    @Volatile private var boundT: Int = 0
    @Volatile private var boundR: Int = 0
    @Volatile private var boundB: Int = 0
    // Web button-driven eraser mode: while true the daemon paints no ink for ANY tool (so the pen
    // tip erases via the web layer instead of writing). The reliable eraser path on this device.
    @Volatile private var webEraserMode: Boolean = false
    // KOReader tools need the daemon's accurate pen coordinates without leaving live pixels.
    // This is separate from the web eraser mode, which deliberately drops callbacks.
    @Volatile private var captureOnlyMode: Boolean = false
    @Volatile private var captureOnlyAt: ((Float, Float) -> Boolean)? = null
    @Volatile private var overlayVisible: Boolean = true
    @Volatile private var excludedPenTouch: ((Int, Float, Float) -> Unit)? = null
    // Felt-pen mode: vary live stroke width by pen pressure (vs constant-width ballpoint).
    @Volatile private var pressureMode: Boolean = false
    // "Selection" pen: paint the live stroke as a dashed line instead of a continuous one.
    @Volatile private var dashMode: Boolean = false

    // Per-session diagnostic counter — kept here (not on InputProxy) so the
    // host can reset it on demand (e.g. Clear button) without detaching.
    private val strokeIndex = java.util.concurrent.atomic.AtomicInteger(0)

    override fun resetDiagnostics() {
        strokeIndex.set(0)
    }

    override fun attach(view: SurfaceView, limit: Rect, callback: StrokeCallback): Boolean {
        if (isActive) return true
        if (attaching) return false
        if (!isBigmeDevice()) return false
        if (!BigmeHiddenApiAccess.ensureEnabled()) {
            Log.w(TAG, "attach rejected: Bigme framework reflection is unavailable")
            return false
        }
        attaching = true
        var preparingClass: Class<*>? = null
        var preparingClient: Any? = null
        return try {
            val cls = Class.forName(HANDWRITTEN_CLIENT)
            preparingClass = cls
            // Resolve hot-path methods once so the binder-thread input handler
            // doesn't pay for a Class.getMethod() lookup on the first stroke
            // (subsequent calls hit ART's reflection cache, but the first does
            // a name+signature scan that's perceptible at the head of a tap).
            val getCanvasMethod = cls.getMethod("getCanvas")
            val inValidateMethod = cls.getMethod(
                "inValidate", Rect::class.java, Int::class.javaPrimitiveType
            )
            val c = cls.getConstructor(android.content.Context::class.java).newInstance(view.context)
            preparingClient = c

            cls.getMethod("bindView", android.view.View::class.java).invoke(c, view)

            val listenerCls = Class.forName(INPUT_LISTENER)
            val listener = Proxy.newProxyInstance(
                cls.classLoader,
                arrayOf(listenerCls),
                InputProxy(
                    callback,
                    view,
                    getClient = { client },
                    tracePenDown = {
                        if (InkDiagnostics.enabled) {
                            diagnosticPenActive.set(true)
                            InkDiagnostics.event("daemon.penDown", traceFields())
                        }
                    },
                    traceStroke = { points ->
                        diagnosticPenActive.set(false)
                        if (InkDiagnostics.enabled && diagnosticStrokes++ < 2) {
                            InkDiagnostics.event("daemon.stroke", traceFields() + mapOf("samples" to points.map { listOf(it.x, it.y, it.pressure, it.timestampMs) }))
                            diagnosticPixels?.let { InkDiagnostics.buffer("daemon.penUp", it, diagnosticPixelWidth,
                                it.limit() / (diagnosticPixelWidth * 4), traceFields()) }
                        }
                    },
                    getCanvasMethod = getCanvasMethod,
                    inValidateMethod = inValidateMethod,
                    getStrokeWidth = { pendingWidth },
                    getStrokeColor = { pendingColor },
                    inspectPixel = { canvas, x, y, color, width -> inspectPenPixel(canvas, x, y, color, width) },
                    strokeIndex = strokeIndex,
                    getWritingTop = { writingTopPx },
                    isExcluded = { x, y ->
                        // ignored if inside the menu exclusion rect, OR outside the writing bounds (if set)
                        (exclR > exclL && exclB > exclT && x >= exclL && x < exclR && y >= exclT && y < exclB) ||
                        (boundR > boundL && boundB > boundT && (x < boundL || x >= boundR || y < boundT || y >= boundB))
                    },
                    onExcludedPenTouch = { action, x, y -> excludedPenTouch?.invoke(action, x, y) },
                    getEraserMode = { webEraserMode },
                    getCaptureOnly = { captureOnlyMode },
                    captureOnlyAt = { x, y -> captureOnlyAt?.invoke(x, y) == true },
                    getPressureMode = { pressureMode },
                    getDashMode = { dashMode },
                ),
            )
            cls.getMethod("registerInputListener", listenerCls).invoke(c, listener)

            // connect(width, height): daemon's two ints are buffer dims, not
            // FORMAT_*/MODE_* despite the constant naming.
            val w = if (view.width > 0) view.width else limit.width()
            val h = if (view.height > 0) view.height else limit.height()
            val connected = cls.getMethod(
                "connect", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType
            ).invoke(c, w, h) as Boolean
            if (!connected) {
                Log.w(TAG, "HandwrittenClient.connect returned false")
                cleanupClient(cls, c)
                return false
            }

            cls.getMethod("setInputEnabled", Boolean::class.javaPrimitiveType).invoke(c, false)
            cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, false)
            cls.getMethod("setBlendEnabled", Boolean::class.javaPrimitiveType).invoke(c, false)

            /*
             * Do not reorder these calls. On 90/270-degree panels connect() swaps the requested
             * width/height for the physical ION allocation. HandwrittenClient.getCanvas() later
             * installs a Matrix produced by updateLayout(), and that method reads the rotation
             * established by updateRotation(). Layout-first can therefore cache an identity/stale
             * matrix: the SurfaceView page remains portrait, while pen invalidations reveal a
             * landscape daemon buffer with horizontal rules appearing vertical.
             */
            val geometryReady = runCatching {
                refreshHandwrittenGeometry(
                    updateRotation = {
                        cls.getMethod("updateRotation").invoke(c)
                    },
                    updateLayout = {
                        cls.getMethod("updateLayout").invoke(c) as Boolean
                    },
                )
            }.getOrElse {
                Log.w(TAG, "HandwrittenClient geometry sync failed: ${it.message}", it)
                false
            }
            if (!geometryReady) {
                Log.w(TAG, "HandwrittenClient rejected the post-connect physical layout")
                cleanupClient(cls, c)
                return false
            }

            val phyRot = runCatching { cls.getMethod("getPhyRotation").invoke(c) }.getOrNull()
            val viewLayout = runCatching { cls.getMethod("getViewLayout").invoke(c) }.getOrNull()
            val phyView = runCatching { cls.getMethod("getPhyViewLayout").invoke(c) }.getOrNull()
            Log.i(TAG, "post-connect: phyRot=$phyRot viewLayout=$viewLayout phyViewLayout=$phyView")

            // Self-check: the getMethod() lookups above only prove the daemon API still EXISTS — they
            // don't catch a firmware change where getCanvas() exists but no longer returns a usable
            // Canvas. getCanvas() is the single surface everything paints into (every stroke + every
            // syncOverlay page render), so if it's null/wrong-type the overlay would look attached
            // while silently dropping all ink. Verify it once here (cheap — one cached-method call,
            // off the write path) and fail cleanly so the host falls back (isActive stays false → the
            // web layer's "pen engine unavailable" path) instead of presenting a dead writing surface.
            val checkCanvas = runCatching { getCanvasMethod.invoke(c) }.getOrNull()
            if (checkCanvas !is android.graphics.Canvas) {
                Log.w(TAG, "self-check FAILED: getCanvas() returned ${checkCanvas?.javaClass?.name ?: "null"}, " +
                    "expected android.graphics.Canvas — daemon unusable on this firmware; not engaging")
                cleanupClient(cls, c)
                return false
            }
            if (!usableHandwrittenCanvas(checkCanvas.width, checkCanvas.height, w, h)) {
                Log.w(TAG, "self-check FAILED: canvas=${checkCanvas.width}x${checkCanvas.height} view=${w}x${h}; refusing incomplete daemon buffer")
                cleanupClient(cls, c)
                return false
            }
            Log.i(TAG, "self-check OK: getCanvas() → ${checkCanvas.width}x${checkCanvas.height}")
            presentationDiagnostics = 0
            logPresentationGeometry(checkCanvas, null, null, false)
            inspectMappedBuffer(cls, c, checkCanvas.width)
            if (InkDiagnostics.enabled) {
                diagnosticPresentations = 0; diagnosticActiveBlits = 0; diagnosticStrokes = 0
                diagnosticPixels?.let { InkDiagnostics.buffer("daemon.connectedBeforeClear", it, checkCanvas.width, checkCanvas.height,
                    mapOf("controller" to System.identityHashCode(this), "view" to System.identityHashCode(view))) }
            }
            // connect() can map a reused ION allocation. Reset it while input and overlay are
            // still disabled; showing it first can briefly publish the previous editor's pixels.
            clearHandwrittenAllocation(checkCanvas)
            logAllocationReset("cold attach before input/overlay")
            val resetId = clearHandwrittenOverlay(cls, c, Class.forName("com.xrz.IHandwrittenService"))
            Log.i(TAG, "service overlay reset before activation: client=$resetId")
            diagnosticPixels?.let { if (InkDiagnostics.enabled) InkDiagnostics.buffer("daemon.afterReset", it, checkCanvas.width,
                checkCanvas.height, mapOf("controller" to System.identityHashCode(this), "view" to System.identityHashCode(view), "client" to resetId)) }

            // Active writing still needs vendor blending: restored vectors and live ink use
            // both SurfaceView commits and the daemon buffer. An opaque host bitmap does not
            // make that composition pathway redundant. Disable blending only during teardown,
            // before disconnect releases the mapped native Canvas.
            cls.getMethod("setBlendEnabled", Boolean::class.javaPrimitiveType).invoke(c, true)
            cls.getMethod("setInputEnabled", Boolean::class.javaPrimitiveType).invoke(c, true)
            cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, true)
            overlayVisible = true
            Log.i(TAG, "presentation: active framebuffer blending enabled")

            client = c
            clientClass = cls
            attachedView = view
            isActive = true
            if (InkDiagnostics.enabled) InkDiagnostics.event("daemon.connected", traceFields() + mapOf("client" to resetId,
                "effectiveMode" to EinkCenter.getRefreshMode(), "canvasWidth" to checkCanvas.width, "canvasHeight" to checkCanvas.height))
            Log.i(TAG, "BigmeInkController attached — daemon engaged on $view (limit=$limit)")
            true
        } catch (t: Throwable) {
            val cause = (t as? java.lang.reflect.InvocationTargetException)?.cause ?: t
            Log.w(TAG, "attach failed: ${cause.javaClass.simpleName}: ${cause.message}", cause)
            preparingClass?.let { cls -> preparingClient?.let { cleanupClient(cls, it) } }
            reset()
            false
        } finally {
            attaching = false
        }
    }

    private fun cleanupClient(cls: Class<*>, c: Any) {
        runCatching { cls.getMethod("setInputEnabled", Boolean::class.javaPrimitiveType).invoke(c, false) }
        runCatching { cls.getMethod("setBlendEnabled", Boolean::class.javaPrimitiveType).invoke(c, false) }
        runCatching { cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, false) }
        runCatching { cls.getMethod("disconnect").invoke(c) }
        runCatching { cls.getMethod("unBindView").invoke(c) }
    }

    /** Read only; never change the vendor FD offset or write to its allocation. */
    private fun inspectMappedBuffer(cls: Class<*>, c: Any, pixelWidth: Int) {
        diagnosticPixels = null
        try {
            val info = cls.getDeclaredField("mBufferInfo").apply { isAccessible = true }.get(c)
            val size = info.javaClass.getMethod("getSize").invoke(info) as Int
            val fd = cls.getDeclaredField("mFd").apply { isAccessible = true }.get(c) as java.io.FileDescriptor
            Log.i(TAG, "vendor input allocation: bytes=$size packedWidth=$pixelWidth")
            if (size <= 0 || size > 16 * 1024 * 1024) return
            java.io.FileInputStream(android.system.Os.dup(fd)).use { stream ->
                diagnosticPixels = stream.channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, 0, size.toLong())
            }
            diagnosticPixelWidth = pixelWidth
        } catch (t: Throwable) {
            Log.i(TAG, "vendor read-only buffer inspection unavailable: ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    /** Inspect the read-only mapping at ownership boundaries, never on the live pen path. */
    private fun logAllocationReset(boundary: String) {
        val pixels = diagnosticPixels
        if (pixels == null) {
            Log.i(TAG, "allocation reset: $boundary; pixel verification unavailable")
            return
        }
        var nonWhite = 0
        for (offset in 0 until pixels.limit() - 3 step 4) {
            if (pixels.getInt(offset) != -1) nonWhite++
        }
        Log.i(TAG, "allocation reset: $boundary; nonWhitePixels=$nonWhite totalPixels=${pixels.limit() / 4}")
    }

    @Suppress("DEPRECATION")
    private fun inspectPenPixel(canvas: android.graphics.Canvas, x: Float, y: Float, color: Int, width: Float) {
        if (strokeIndex.get() > 6) return
        val matrix = android.graphics.Matrix()
        canvas.getMatrix(matrix)
        val point = floatArrayOf(x, y)
        matrix.mapPoints(point)
        val px = point[0].toInt(); val py = point[1].toInt()
        val offset = (py.toLong() * diagnosticPixelWidth + px) * 4
        val bytes = diagnosticPixels?.let { pixels ->
            if (px < 0 || py < 0 || offset < 0 || offset + 4 > pixels.limit()) "outside allocation"
            else (0..3).joinToString(",") { (pixels.get(offset.toInt() + it).toInt() and 255).toString() }
        } ?: "unavailable"
        Log.i(TAG, "pen pixels: logical=$x,$y physical=$px,$py color=${Integer.toHexString(color)} width=$width rgba=$bytes")
    }

    override fun setStrokeStyle(widthPx: Float, color: Int) {
        if (InkDiagnostics.enabled) InkDiagnostics.event("daemon.style", traceFields() + mapOf("width" to widthPx, "color" to color))
        pendingWidth = widthPx
        pendingColor = color
    }

    override fun setWritingTop(topPx: Int) {
        writingTopPx = topPx
    }

    override fun setWritingExclusion(left: Int, top: Int, right: Int, bottom: Int) {
        exclL = left; exclT = top; exclR = right; exclB = bottom
    }

    fun setExcludedPenTouch(listener: ((Int, Float, Float) -> Unit)?) {
        excludedPenTouch = listener
    }

    override fun setWritingBounds(left: Int, top: Int, right: Int, bottom: Int) {
        boundL = left; boundT = top; boundR = right; boundB = bottom
    }

    override fun setEraserMode(active: Boolean) {
        webEraserMode = active
    }

    fun setCaptureOnly(active: Boolean) {
        captureOnlyMode = active
    }

    fun setCaptureOnlyAt(decision: ((Float, Float) -> Boolean)?) {
        captureOnlyAt = decision
    }

    /** Keep daemon pen input attached while Android owns the visible edit preview. */
    fun setOverlayVisible(visible: Boolean) {
        if (overlayVisible == visible) return
        val c = client ?: return
        val cls = clientClass ?: return
        try {
            cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, visible)
            overlayVisible = visible
        } catch (t: Throwable) {
            Log.w(TAG, "setOverlayVisible($visible) failed: ${t.message}", t)
        }
    }

    override fun setPressureMode(active: Boolean) {
        pressureMode = active
    }


    override fun setDashMode(active: Boolean) {
        dashMode = active
    }

    override fun setEnabled(enabled: Boolean) {
        if (InkDiagnostics.enabled) InkDiagnostics.event("daemon.inputEnabled", traceFields() + mapOf("enabled" to enabled))
        val c = client ?: return
        val cls = clientClass ?: return
        try {
            cls.getMethod("setInputEnabled", Boolean::class.javaPrimitiveType).invoke(c, enabled)
        } catch (t: Throwable) {
            Log.w(TAG, "setEnabled($enabled) failed: ${t.message}")
        }
    }

    override fun mirrorOverlay(target: android.graphics.Bitmap): Boolean {
        val c = client ?: return false
        val cls = clientClass ?: return false
        val view = attachedView ?: return false
        return try {
            // Preferred: HandwrittenClient.getContent() returns the ION-
            // backed bitmap. On some xrz firmwares this stays null even
            // after first commit — fall back to reflecting the Canvas's
            // hidden mBitmap field, which holds the same underlying buffer.
            // Requires HiddenApiBypass.addHiddenApiExemptions("L") at host
            // Application.onCreate() on Android 14+.
            var src = cls.getMethod("getContent").invoke(c) as? android.graphics.Bitmap
            if (src == null) {
                val daemonCanvas = cls.getMethod("getCanvas").invoke(c)
                    as? android.graphics.Canvas
                if (daemonCanvas != null) {
                    src = canvasBitmapField()?.get(daemonCanvas) as? android.graphics.Bitmap
                }
            }
            if (src == null) {
                Log.w(TAG, "mirrorOverlay: no source bitmap (getContent and Canvas.mBitmap both unavailable)")
                return false
            }
            // The daemon's content buffer can be either view-sized or panel-
            // sized depending on firmware. If it matches our target, blit
            // straight; otherwise treat src as panel-coords and crop the
            // view-region out using the view's screen position.
            val canvas = android.graphics.Canvas(target)
            if (src.width == target.width && src.height == target.height) {
                canvas.drawBitmap(src, 0f, 0f, null)
                Log.i(TAG, "mirrorOverlay: 1:1 copy ${src.width}x${src.height}")
            } else {
                val loc = IntArray(2)
                view.getLocationOnScreen(loc)
                val sx = loc[0].coerceIn(0, maxOf(0, src.width - target.width))
                val sy = loc[1].coerceIn(0, maxOf(0, src.height - target.height))
                val srcRect = android.graphics.Rect(
                    sx, sy,
                    (sx + target.width).coerceAtMost(src.width),
                    (sy + target.height).coerceAtMost(src.height),
                )
                val dstRect = android.graphics.Rect(0, 0, srcRect.width(), srcRect.height())
                canvas.drawBitmap(src, srcRect, dstRect, null)
                Log.i(TAG, "mirrorOverlay: panel-crop src=${src.width}x${src.height} " +
                    "target=${target.width}x${target.height} viewLoc=(${loc[0]},${loc[1]}) srcRect=$srcRect")
            }
            true
        } catch (t: Throwable) {
            Log.w(TAG, "mirrorOverlay failed: ${t.message}", t)
            false
        }
    }

    override fun refreshRegionFast(bitmap: android.graphics.Bitmap, region: Rect) {
        val c = client ?: return
        val cls = clientClass ?: return
        try {
            val canvas = cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas ?: return
            val paint = android.graphics.Paint().apply {
                xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC)
            }
            canvas.drawBitmap(bitmap, region, region, paint)   // blit only the changed region
            // Waveform is live-tunable for the animation experiment: `setprop debug.kalamos.anim_mode N`
            // (e.g. 179 video, 16 A2, 2 DU). Default = MODE_DU (HANDWRITE is a pen waveform, wrong for fills).
            cls.getMethod("inValidate", Rect::class.java, Int::class.javaPrimitiveType)
                .invoke(c, region, animRefreshMode())
        } catch (t: Throwable) {
            Log.w(TAG, "refreshRegionFast failed: ${t.message}")
        }
    }

    // Cached SystemProperties.get so the per-frame waveform lookup is cheap.
    private val spGet: java.lang.reflect.Method? = try {
        Class.forName("android.os.SystemProperties").getMethod("get", String::class.java, String::class.java)
    } catch (e: Throwable) { null }

    /** Animation refresh waveform, overridable live with `setprop debug.kalamos.anim_mode N` so we can
     *  hunt for the smooth mode without rebuilding. Defaults to MODE_A2 — the purpose-built fast 1-bit
     *  animation waveform (least flash); try MODE_DU (2) or MODE_FAST (179) via the sysprop. */
    private fun animRefreshMode(): Int = try {
        (spGet?.invoke(null, "debug.kalamos.anim_mode", "") as? String)?.trim()?.toIntOrNull() ?: MODE_A2
    } catch (e: Throwable) { MODE_A2 }

    override fun syncOverlay(bitmap: android.graphics.Bitmap, region: Rect?, force: Boolean) {
        syncOverlayWithMode(bitmap, region, force, MODE_GU16)
    }

    /** Bigme's dedicated erase waveform gives a quick regional removal. Callers must follow it
     * with a settled GU16 refresh because the fast waveform can leave residual ink. */
    fun syncOverlayRubber(bitmap: android.graphics.Bitmap, region: Rect) {
        syncOverlayWithMode(bitmap, region, true, MODE_RUBBER)
    }

    /** GU16 can leave dense scribble residue on this panel (photo vs screenshot, 2026-10-04).
     * GC16 cleans both pixel transitions; keep its flash local to the erased word/trail.
     * Clamp to the attached surface: a malformed region must never become a full-screen clean. */
    override fun syncOverlayClean(bitmap: android.graphics.Bitmap, region: Rect) {
        val view = attachedView ?: return
        val clipped = Rect(region)
        if (!clipped.intersect(0, 0, view.width, view.height) || clipped.isEmpty) return
        syncOverlayWithMode(bitmap, clipped, true, MODE_GC16)
    }

    private fun syncOverlayWithMode(bitmap: android.graphics.Bitmap, region: Rect?, force: Boolean, mode: Int) {
        val c = client ?: return
        val cls = clientClass ?: return
        val view = attachedView ?: return
        try {
            // Blit the host bitmap onto the daemon's ION canvas. The buffer
            // is sized to (view.width, view.height) at connect time. SRC mode
            // resets every pixel in one pass so the daemon's accumulated
            // stroke ink is replaced by the host's canonical state.
            val canvas = cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas ?: return
            logPresentationGeometry(canvas, bitmap, region, force)
            val capture = InkDiagnostics.enabled && (diagnosticPresentations++ < 3 ||
                (diagnosticPenActive.get() && diagnosticActiveBlits++ < 3))
            if (capture) {
                InkDiagnostics.bitmap("daemon.source", bitmap, traceFields() + mapOf("region" to region?.toShortString(), "force" to force, "mode" to mode))
                tracePixels("daemon.beforeBlit", canvas)
            }
            val paint = android.graphics.Paint().apply {
                xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC)
            }
            // Preserve live, uncommitted native ink outside a regional update. Full page
            // reconciliations pass null; partial chrome/erase updates retain their region.
            replaceHandwrittenPage(canvas, bitmap, paint, region)
            if (capture) tracePixels("daemon.afterBlit", canvas)
            if (InkDiagnostics.enabled) InkDiagnostics.event("daemon.sync", traceFields() + mapOf("region" to region?.toShortString(),
                "force" to force, "mode" to mode, "overlayVisible" to overlayVisible, "fullBufferReplacement" to (region == null)))
            if (!force || !overlayVisible) return
            // Force-refresh: GU16 is a 16-level grey-update waveform — no
            // flash (unlike GC16), transitions both directions cleanly
            // (unlike MODE_HANDWRITE). Limit to [region] when provided.
            cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, true)
            val rect = region ?: Rect(0, 0, view.width, view.height)
            cls.getMethod("inValidate", Rect::class.java, Int::class.javaPrimitiveType)
                .invoke(c, rect, mode)
            if (InkDiagnostics.enabled) InkDiagnostics.event("daemon.invalidate", traceFields() + mapOf("region" to rect.toShortString(), "mode" to mode))
            Log.i(TAG, "syncOverlay: mode=$mode refresh $rect")
        } catch (t: Throwable) {
            Log.w(TAG, "syncOverlay failed: ${t.message}")
        }
    }

    /** Bounded, read-only diagnostics: a full Android screenshot cannot reveal a clipped daemon
     * canvas. Record the actual local clip/matrix alongside the submitted pixel buffer on attach
     * and the first presentations, without repainting or changing the panel waveform. */
    @Suppress("DEPRECATION")
    private fun logPresentationGeometry(
        canvas: android.graphics.Canvas, bitmap: android.graphics.Bitmap?, region: Rect?, force: Boolean
    ) {
        if (presentationDiagnostics >= 8) return
        presentationDiagnostics++
        val matrix = android.graphics.Matrix()
        canvas.getMatrix(matrix)
        val values = FloatArray(9)
        matrix.getValues(values)
        Log.i(TAG,
            "presentation geometry: canvas=${canvas.width}x${canvas.height} density=${canvas.density} " +
                "clip=${canvas.clipBounds} saves=${canvas.saveCount} matrix=${values.contentToString()} " +
                "bitmap=${bitmap?.width}x${bitmap?.height} density=${bitmap?.density} " +
                "rowBytes=${bitmap?.rowBytes} region=$region force=$force " +
                "view=${attachedView?.width}x${attachedView?.height}")
    }

    /** Reconcile floating chrome over the currently retained page without replacing its ink.
     * [bitmap] contains only [region], captured from the host window and composited with chrome. */
    fun syncChrome(bitmap: android.graphics.Bitmap, region: Rect) {
        if (region.isEmpty) return
        if (!overlayVisible) return
        val c = client ?: return
        val cls = clientClass ?: return
        try {
            val canvas = cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas ?: return
            val paint = android.graphics.Paint().apply {
                xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.SRC)
            }
            canvas.save()
            canvas.clipRect(region)
            canvas.drawBitmap(bitmap, region.left.toFloat(), region.top.toFloat(), paint)
            canvas.restore()
            cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, true)
            cls.getMethod("inValidate", Rect::class.java, Int::class.javaPrimitiveType)
                .invoke(c, region, MODE_GU16)
            Log.i(TAG, "syncChrome: GU16 refresh $region")
        } catch (t: Throwable) {
            Log.w(TAG, "syncChrome failed: ${t.message}", t)
        }
    }

    override fun clearRegion(region: android.graphics.Rect) {
        if (region.isEmpty) return
        val c = client ?: return
        val cls = clientClass ?: return
        try {
            val canvas = cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas ?: return
            canvas.save()
            canvas.clipRect(region)
            canvas.drawColor(android.graphics.Color.WHITE)
            canvas.restore()
            // Intentionally NO inValidate — leaves the daemon's already-
            // displayed EPD pixels alone (the host's SurfaceView compose has
            // them under the canonical bitmap by now). Wiping only the ION
            // buffer prevents ghost-accumulation and the position-shift
            // symptom where two pipelines composit the same ink at slightly
            // different panel pixels.
        } catch (t: Throwable) {
            Log.w(TAG, "clearRegion failed: ${t.message}")
        }
    }

    /** Diagnostic: passive inspection of the daemon's Canvas/content buffer
     *  and view layouts. Does NOT call any drawing or invalidation — just
     *  reflectively inspects properties so it cannot upset the daemon
     *  state. Returns a multi-line string for on-screen display AND mirrors
     *  to logcat. */
    fun diagnostics(): String {
        val c = client ?: return "not attached"
        val cls = clientClass ?: return "no clientClass"
        val view = attachedView ?: return "no attachedView"
        val sb = StringBuilder()
        try {
            val canvas = runCatching { cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas }.getOrNull()
            sb.appendLine("=== Daemon Canvas ===")
            sb.appendLine("instance: $canvas")
            if (canvas != null) {
                sb.appendLine("class:    ${canvas.javaClass.name}")
                sb.appendLine("dims:     ${canvas.width} x ${canvas.height}")
                // Probe only the well-known field name; don't iterate all
                // declared fields (some are native pointers and touching
                // them aggressively appears to upset the daemon).
                val mBitmap = runCatching {
                    android.graphics.Canvas::class.java.getDeclaredField("mBitmap")
                        .apply { isAccessible = true }
                        .get(canvas)
                }.getOrNull()
                sb.appendLine("Canvas.mBitmap: ${shortValue(mBitmap)}")
            }
            sb.appendLine()
            sb.appendLine("=== getContent() ===")
            val content = runCatching { cls.getMethod("getContent").invoke(c) }.getOrNull()
            sb.appendLine(if (content == null) "null" else "${content::class.java.name}: ${shortValue(content)}")
            sb.appendLine()
            sb.appendLine("=== Daemon view layouts ===")
            sb.appendLine("getViewLayout():     ${runCatching { cls.getMethod("getViewLayout").invoke(c) }.getOrNull()}")
            sb.appendLine("getPhyViewLayout():  ${runCatching { cls.getMethod("getPhyViewLayout").invoke(c) }.getOrNull()}")
            sb.appendLine("getPhyRotation():    ${runCatching { cls.getMethod("getPhyRotation").invoke(c) }.getOrNull()}")
            sb.appendLine("getCurViewRotation():${runCatching { cls.getMethod("getCurViewRotation").invoke(c) }.getOrNull()}")
            sb.appendLine()
            sb.appendLine("=== Attached View ===")
            val loc = IntArray(2)
            view.getLocationOnScreen(loc)
            sb.appendLine("class:            ${view.javaClass.name}")
            sb.appendLine("locationOnScreen: (${loc[0]}, ${loc[1]})")
            sb.appendLine("size:             ${view.width} x ${view.height}")
            sb.appendLine("Build:            ${android.os.Build.MANUFACTURER}/${android.os.Build.BRAND}/${android.os.Build.MODEL}/SDK${android.os.Build.VERSION.SDK_INT}")
        } catch (t: Throwable) {
            sb.appendLine("diagnostics threw: ${t.javaClass.simpleName}: ${t.message}")
        }
        Log.i(TAG, "diagnostics:\n$sb")
        return sb.toString()
    }

    private fun shortValue(v: Any?): String {
        if (v == null) return "null"
        if (v is android.graphics.Bitmap) return "Bitmap(${v.width}x${v.height}, ${v.config})"
        val s = v.toString()
        return if (s.length > 80) s.take(77) + "..." else s
    }

    /** Diagnostic: paint a single 30x30 filled rect at daemon-canvas coord
     *  ([x], [y]) and request a HANDWRITE-mode refresh on a tight rect.
     *  Single-shot only — earlier multi-fixture batches with GU16 caused a
     *  hard reboot on the HiBreak Plus, so this is intentionally minimal. */
    fun paintFixture(x: Int, y: Int) {
        val c = client ?: return
        val cls = clientClass ?: return
        try {
            val canvas = cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas ?: return
            val paint = android.graphics.Paint().apply {
                color = android.graphics.Color.BLACK
                style = android.graphics.Paint.Style.FILL
                isAntiAlias = false
            }
            val r = android.graphics.Rect(x - 15, y - 15, x + 15, y + 15)
            canvas.drawRect(r, paint)
            val refresh = android.graphics.Rect(r.left - 2, r.top - 2, r.right + 2, r.bottom + 2)
            cls.getMethod("inValidate", android.graphics.Rect::class.java, Int::class.javaPrimitiveType)
                .invoke(c, refresh, MODE_HANDWRITE)
            Log.i(TAG, "paintFixture: canvas($x, $y) → rect=$r refreshed=$refresh mode=HANDWRITE")
        } catch (t: Throwable) {
            Log.w(TAG, "paintFixture failed: ${t.message}", t)
        }
    }

    override fun detach() {
        if (!isActive) return
        val c = client
        val cls = clientClass
        if (c != null && cls != null) {
            runCatching { cls.getMethod("setInputEnabled", Boolean::class.javaPrimitiveType).invoke(c, false) }
            // Stop both consumers before clearing and releasing the mapped native Canvas.
            // The host owns any visible hard-close white frame. Clearing the allocation here has
            // no invalidation: transient tool handoffs must preserve the physical panel frame.
            runCatching { cls.getMethod("setBlendEnabled", Boolean::class.javaPrimitiveType).invoke(c, false) }
            runCatching { cls.getMethod("setOverlayEnabled", Boolean::class.javaPrimitiveType).invoke(c, false) }
            client = null // retire input callbacks before the allocation is cleared
            runCatching {
                val canvas = cls.getMethod("getCanvas").invoke(c) as? android.graphics.Canvas
                canvas?.let { clearHandwrittenAllocation(it) }
                logAllocationReset("detach")
                val resetId = clearHandwrittenOverlay(cls, c, Class.forName("com.xrz.IHandwrittenService"))
                Log.i(TAG, "service overlay reset before disconnect: client=$resetId")
            }.onFailure { Log.w(TAG, "retired allocation clear failed: ${it.message}") }
            runCatching { cls.getMethod("disconnect").invoke(c) }
            runCatching { cls.getMethod("unBindView").invoke(c) }
        }
        reset()
        Log.i(TAG, "BigmeInkController detached")
    }

    private fun reset() {
        diagnosticPixels = null
        client = null
        clientClass = null
        attachedView = null
        isActive = false
    }

    /**
     * Dynamic-proxy handler for HandwrittenClient.InputListener.
     *
     * The daemon fires callbacks on a binder thread with raw input. We do two
     * things per event:
     *  1. Draw every stroke segment to the daemon's ION-backed Canvas and present it with
     *     `inValidate(rect, MODE_HANDWRITE)` at the established handwriting cadence.
     *  2. Hand the completed stroke to [StrokeCallback] once at pen-up so native presentation is
     *     never coupled to WebView or Android main-thread throughput.
     */
    private class InputProxy(
        private val sink: StrokeCallback,
        view: SurfaceView,
        private val getClient: () -> Any?,
        private val traceStroke: (List<StrokePoint>) -> Unit,
        private val tracePenDown: () -> Unit,
        private val getCanvasMethod: Method,
        private val inValidateMethod: Method,
        private val getStrokeWidth: () -> Float,
        private val getStrokeColor: () -> Int,
        private val inspectPixel: (android.graphics.Canvas, Float, Float, Int, Float) -> Unit,
        private val strokeIndex: java.util.concurrent.atomic.AtomicInteger,
        // View-local y above which pen events are ignored (the toolbar strip). 0 = no constraint.
        private val getWritingTop: () -> Int,
        // The floating menu's bounds (view px): pen inside is ignored (not a drawing area).
        private val isExcluded: (Float, Float) -> Boolean,
        private val onExcludedPenTouch: (Int, Float, Float) -> Unit,
        // True while the web layer's eraser button is active — paint no ink for any tool.
        private val getEraserMode: () -> Boolean,
        private val getCaptureOnly: () -> Boolean,
        private val captureOnlyAt: (Float, Float) -> Boolean,
        // True for the felt pen — vary stroke width by pen pressure (vs constant-width ballpoint).
        private val getPressureMode: () -> Boolean,
        // True for the "selection" pen — paint a dashed line instead of a continuous one.
        private val getDashMode: () -> Boolean,
    ) : InvocationHandler {
        private val mainHandler = android.os.Handler(view.context.mainLooper)
        private val paint = android.graphics.Paint().apply {
            // EPD uses discrete greyscale levels; AA edges end up dithered
            // differently per inValidate, producing "train track" ghosts.
            isAntiAlias = false
            color = getStrokeColor()
            strokeWidth = getStrokeWidth()
            style = android.graphics.Paint.Style.STROKE
            strokeCap = android.graphics.Paint.Cap.ROUND
            strokeJoin = android.graphics.Paint.Join.ROUND
        }
        private var lastX = 0f
        private var lastY = 0f
        // "Selection" pen dash: running length along the stroke so each segment's DashPathEffect phase
        // continues where the last left off → one continuous dash instead of per-segment restarts.
        private var dashPhase = 0f
        private val dashIntervals = InkDefaults.dashIntervals()
        // Eraser gesture is latched at pen-DOWN: the daemon tags the rubber's DOWN/MOVE as tool=1
        // but its UP comes back as tool=0, so we must hold the mode for the whole gesture.
        private var erasing = false
        private var captureThisStroke = false
        private var strokeActive = false
        private var excludedContactActive = false
        // Accumulate dirty rect across MOVEs so EPD commits batch up. One-rect-
        // per-MOVE produced "train track" refresh artifacts on long strokes.
        private val accumDirty = android.graphics.Rect(Int.MAX_VALUE, Int.MAX_VALUE, Int.MIN_VALUE, Int.MIN_VALUE)
        private var lastPresentationMs = 0L
        private val COMMIT_INTERVAL_MS = 16L
        // Force-present the first MOVE of each stroke so the user sees ink immediately rather than
        // waiting for the ordinary panel pacing gate.
        private var firstMoveOfStroke = false
        private var downStartNs = 0L          // System.nanoTime() at JVM-DOWN entry
        private var firstMoveArrivalNs = 0L   // System.nanoTime() at first MOVE
        private var lastStrokeEndUptimeMs = 0L
        private var currentIdleMs = -1L
        // Daemon CLOCK_REALTIME at the kernel pen-down read. Captured at
        // ACTION_DOWN, consumed by the first inValidate to compute the
        // wall-clock pen.kernel_to_paint headline metric.
        private var downKernelWallNs = 0L
        // Model samples stay on the daemon callback thread while native ink keeps painting live.
        // Deliver the immutable completed stroke at pen-up instead of posting every MOVE to the
        // Android main queue (60–120 messages/sec during ordinary handwriting).
        private val capturedStroke = ArrayList<StrokePoint>(256)
        // strokeIndex / nearEventCount are now shared with the parent
        // BigmeInkController so resetDiagnostics() can clear them on demand.

        override fun invoke(proxy: Any?, method: Method, args: Array<out Any?>?): Any? {
            if (method.name == "onInputTouch" && args != null && args.size >= 5) {
                val invokeStart = System.nanoTime()
                // Daemon dispatch latency: args[5] is CLOCK_REALTIME nanos
                // (wall-clock since Unix epoch) set by the daemon when it
                // reads the /dev/input event. Subtract from wall-now to get
                // the kernel → daemon → binder → JVM dispatch delay.
                var daemonNs = 0L
                if (args.size >= 6) {
                    val tsArg = args[5]
                    daemonNs = when (tsArg) {
                        is Long -> tsArg
                        is Int -> tsArg.toLong()
                        else -> 0L
                    }
                    if (daemonNs != 0L) {
                        val nowWallNs = System.currentTimeMillis() * 1_000_000L
                        PerfCounters.recordDirect(
                            PerfMetric.EVENT_KERNEL_TO_JVM,
                            nowWallNs - daemonNs,
                        )
                    }
                }
                val action = args[0] as Int
                var x = (args[1] as Int).toFloat()
                var y = (args[2] as Int).toFloat()
                val pressure = (args[3] as Int).toFloat() / 4096f
                val tool = (args.getOrNull(4) as? Int) ?: TOOL_PEN
                // The daemon's 6-arg onInputTouch passes a raw input-event
                // timestamp NOT in uptimeMillis epoch. Use our own.
                val ts = android.os.SystemClock.uptimeMillis()

                // Finger touches: the daemon dispatches them through the same
                // InputListener as pen, but the host does its own finger
                // handling at View.onTouchEvent (swipe nav, scroll). Skip
                // daemon-side painting AND callback dispatch so finger
                // gestures don't leave ink and don't drive StrokeCallback.
                if (tool == TOOL_FINGER) {
                    PerfCounters.recordDirect(
                        PerfMetric.EVENT_HANDLER,
                        System.nanoTime() - invokeStart,
                    )
                    return 0
                }

                // Reject new contacts outside paper, but always finish an accepted stroke.
                // A pen-up/leave can report a coordinate above the writing top or inside chrome;
                // filtering it first loses the entire completed lasso. Reuse the last accepted
                // sample rather than drawing a closing segment through excluded UI. Duplicate
                // terminal packets see an empty buffer and cannot deliver the stroke twice.
                if (action == ACTION_DOWN) { capturedStroke.clear(); strokeActive = false; excludedContactActive = false }
                val writingTop = getWritingTop()
                val terminalOutside = (action == ACTION_UP || action == ACTION_LEAVE) &&
                    capturedStroke.isNotEmpty() && ((writingTop > 0 && y < writingTop) || isExcluded(x, y))
                if (terminalOutside) {
                    android.util.Log.i(TAG, "STROKE_END_OUTSIDE samples=${capturedStroke.size} action=$action")
                    val lastAccepted = capturedStroke.last()
                    x = lastAccepted.x
                    y = lastAccepted.y
                }

                // Pen inside the floating menu's bounds (the collapsible toolbar) — not a drawing
                // area. A rect, so the menu can live anywhere (e.g. docked to the left edge).
                if (!terminalOutside && (excludedContactActive || isExcluded(x, y))) {
                    if (action == ACTION_DOWN) excludedContactActive = true
                    if (excludedContactActive) onExcludedPenTouch(action, x, y)
                    if (action == ACTION_UP || action == ACTION_LEAVE) excludedContactActive = false
                    PerfCounters.recordDirect(
                        PerfMetric.EVENT_HANDLER,
                        System.nanoTime() - invokeStart,
                    )
                    return 0
                }

                // Pen on the toolbar strip (above the JS-provided writing top) — not a drawing area.
                if (!terminalOutside && writingTop > 0 && y < writingTop) {
                    PerfCounters.recordDirect(
                        PerfMetric.EVENT_HANDLER,
                        System.nanoTime() - invokeStart,
                    )
                    return 0
                }



                // A rejected DOWN cannot seed a stroke by moving/releasing inside paper later.
                // Likewise a duplicate UP/LEAVE must not manufacture a one-point dot.
                if (action == ACTION_DOWN) strokeActive = true
                else if ((action == ACTION_MOVE || action == ACTION_UP || action == ACTION_LEAVE) && !strokeActive) return 0

                // Back-of-stylus eraser (RUBBER): latch the mode at DOWN and hold it for the whole
                // gesture, because the daemon mis-reports the eraser's UP as tool=0. Paint NO ink.
                if (action == ACTION_DOWN) {
                    erasing = tool == TOOL_RUBBER
                    captureThisStroke = getCaptureOnly() || captureOnlyAt(x, y)
                }
                // isEraser: rubber tool (back-of-pen bonus) OR the web's button-driven eraser mode
                // (the reliable path — pen tip erases). Either way the daemon paints no ink and the
                // MotionEvent flows to the WebView, which does the erasing.
                val isEraser = erasing || getEraserMode()

                if (!isEraser && captureThisStroke) {
                    when (action) {
                        ACTION_DOWN -> {
                            capturedStroke.clear()
                            capturedStroke.add(StrokePoint(x, y, pressure, ts))
                            mainHandler.post { sink.onStrokeBegin(x, y, pressure, ts) }
                        }
                        ACTION_MOVE -> {
                            capturedStroke.add(StrokePoint(x, y, pressure, ts))
                            mainHandler.post { sink.onStrokeMove(x, y, pressure, ts) }
                        }
                        ACTION_UP, ACTION_LEAVE -> {
                            capturedStroke.add(StrokePoint(x, y, pressure, ts))
                            val gesture = capturedStroke.toList()
                            capturedStroke.clear()
                            mainHandler.post {
                                sink.onStrokeEnd(x, y, pressure, ts)
                                sink.onStrokeComplete(gesture)
                            }
                        }
                    }
                    if (action == ACTION_UP || action == ACTION_LEAVE) { erasing = false; strokeActive = false }
                    PerfCounters.recordDirect(PerfMetric.EVENT_HANDLER, System.nanoTime() - invokeStart)
                    return 0
                }

                // Coords arriving here are ALREADY view-local: the daemon's
                // dispatcher calls HandwrittenClient.convertXY internally
                // before invoking the InputListener (unless mUseRawInputEvent
                // is true, which we never set). Double-conversion was the bug.
                val client = getClient()
                if (!isEraser && client != null) {
                    try {
                        val canvas = getCanvasMethod.invoke(client) as? android.graphics.Canvas
                        if (action == ACTION_DOWN) {
                            android.util.Log.i(TAG, "DOWN: canvas=$canvas view=($x,$y)")
                        }
                        if (canvas != null) {
                            when (action) {
                                // ACTION_NEAR is intentionally not handled. On
                                // Bigme HiBreak Plus the xrz daemon never
                                // dispatches NEAR events to the InputListener
                                // under cooked or raw input, so the historical
                                // pre-warm heuristic (small inValidate) was dead
                                // code. The first-stroke "wake" cost (~100 ms)
                                // lives in the touch IC sleep state and only
                                // physical capacitive proximity wakes it. See
                                // docs/metrics.md → "Touch IC wake".
                                ACTION_DOWN -> {
                                    tracePenDown()
                                    capturedStroke.clear()
                                    capturedStroke.add(StrokePoint(x, y, pressure, ts))
                                    lastX = x; lastY = y
                                    accumDirty.set(Int.MAX_VALUE, Int.MAX_VALUE, Int.MIN_VALUE, Int.MIN_VALUE)
                                    lastPresentationMs = ts
                                    firstMoveOfStroke = true
                                    downStartNs = System.nanoTime()
                                    downKernelWallNs = daemonNs
                                    currentIdleMs = if (lastStrokeEndUptimeMs > 0L) {
                                        (ts - lastStrokeEndUptimeMs).coerceAtLeast(0L)
                                    } else -1L
                                    val sIdx = strokeIndex.incrementAndGet()
                                    var kernelToJvmMs = -1L
                                    if (daemonNs != 0L) {
                                        // pen.kernel_to_jvm: wall delta from daemon's
                                        // kernel-read ts to this DOWN landing here.
                                        val nowWallNs = System.currentTimeMillis() * 1_000_000L
                                        val deltaNs = nowWallNs - daemonNs
                                        kernelToJvmMs = deltaNs / 1_000_000L
                                        PerfCounters.recordDirect(
                                            PerfMetric.PEN_KERNEL_TO_JVM,
                                            deltaNs,
                                        )
                                    }
                                    paint.strokeWidth = if (getPressureMode())
                                        InkDefaults.pressureToWidth(getStrokeWidth(), pressure) else getStrokeWidth()
                                    paint.color = getStrokeColor()
                                    paint.pathEffect = if (getDashMode())
                                        android.graphics.DashPathEffect(dashIntervals, 0f) else null
                                    dashPhase = 0f
                                    // Paint a dot at the down point and refresh
                                    // immediately. Without this, the daemon paints
                                    // nothing until the first ACTION_MOVE — taps and
                                    // short bullet-point flicks leave no mark, and
                                    // the start of every stroke is invisible until a
                                    // MOVE event arrives ~8–16 ms later.
                                    val drawStart = System.nanoTime()
                                    canvas.drawPoint(x, y, paint)
                                    // Diagnostics must never interrupt stroke paint/presentation.
                                    runCatching { inspectPixel(canvas, x, y, paint.color, paint.strokeWidth) }
                                    val drawEnd = System.nanoTime()
                                    PerfCounters.recordDirect(
                                        PerfMetric.PAINT_DRAW_SEGMENT,
                                        drawEnd - drawStart,
                                    )
                                    val dotPad = paint.strokeWidth.toInt() + 2
                                    val dotRect = Rect(
                                        x.toInt() - dotPad, y.toInt() - dotPad,
                                        x.toInt() + dotPad, y.toInt() + dotPad,
                                    )
                                    val invStart = System.nanoTime()
                                    inValidateMethod.invoke(client, dotRect, MODE_HANDWRITE)
                                    val invEnd = System.nanoTime()
                                    PerfCounters.recordDirect(
                                        PerfMetric.PAINT_INVALIDATE_CALL,
                                        invEnd - invStart,
                                    )

                                    // The DOWN dot above is the first presentation request of the
                                    // stroke, so measure it here rather than attributing first paint
                                    // to a later MOVE. In particular, this preserves the distinction
                                    // between an idle pen digitizer/input wake (kernel_to_jvm), a slow
                                    // daemon refresh call (invalidate), and panel latency after the
                                    // call returns (which needs the user's visual observation).
                                    val jvmToPaintNs = invEnd - downStartNs
                                    val kernelToPaintMs = if (downKernelWallNs != 0L) {
                                        val nowWallNs = System.currentTimeMillis() * 1_000_000L
                                        val deltaNs = nowWallNs - downKernelWallNs
                                        PerfCounters.recordDirect(
                                            PerfMetric.PEN_KERNEL_TO_PAINT,
                                            deltaNs,
                                        )
                                        deltaNs / 1_000_000L
                                    } else -1L
                                    PerfCounters.recordDirect(
                                        PerfMetric.PEN_JVM_TO_PAINT,
                                        jvmToPaintNs,
                                    )
                                    val jvmToPaintMs = jvmToPaintNs / 1_000_000L
                                    val invalidateMs = (invEnd - invStart) / 1_000_000L
                                    if (sIdx <= 10 || currentIdleMs >= DIAGNOSTIC_IDLE_MS ||
                                        kernelToPaintMs >= SLOW_STROKE_MS ||
                                        jvmToPaintMs >= SLOW_STROKE_MS) {
                                        android.util.Log.i(
                                            TAG,
                                            "PEN_DOWN #$sIdx @${wallClockHms()}: " +
                                                "idle=${currentIdleMs}ms " +
                                                "kernel_to_paint=${kernelToPaintMs}ms " +
                                                "kernel_to_jvm=${kernelToJvmMs}ms " +
                                                "jvm_to_paint=${jvmToPaintMs}ms " +
                                                "invalidate=${invalidateMs}ms rect=$dotRect",
                                        )
                                    }
                                }
                                ACTION_MOVE -> {
                                    capturedStroke.add(StrokePoint(x, y, pressure, ts))
                                    if (firstMoveOfStroke) firstMoveArrivalNs = System.nanoTime()
                                    if (getPressureMode())   // felt: width tracks pressure per segment
                                        paint.strokeWidth = InkDefaults.pressureToWidth(getStrokeWidth(), pressure)
                                    if (getDashMode()) {     // selection: continue the dash across segments
                                        paint.pathEffect = android.graphics.DashPathEffect(dashIntervals, dashPhase)
                                        dashPhase += Math.hypot((x - lastX).toDouble(), (y - lastY).toDouble()).toFloat()
                                    }
                                    val drawStart = System.nanoTime()
                                    canvas.drawLine(lastX, lastY, x, y, paint)
                                    PerfCounters.recordDirect(
                                        PerfMetric.PAINT_DRAW_SEGMENT,
                                        System.nanoTime() - drawStart,
                                    )
                                    val pad = paint.strokeWidth.toInt() + 2
                                    val segL = minOf(lastX, x).toInt() - pad
                                    val segT = minOf(lastY, y).toInt() - pad
                                    val segR = maxOf(lastX, x).toInt() + pad
                                    val segB = maxOf(lastY, y).toInt() + pad
                                    accumDirty.union(segL, segT, segR, segB)
                                    if (firstMoveOfStroke || ts - lastPresentationMs >= COMMIT_INTERVAL_MS) {
                                        val wasFirst = firstMoveOfStroke
                                        firstMoveOfStroke = false
                                        val invStart = System.nanoTime()
                                        inValidateMethod.invoke(client, accumDirty, MODE_HANDWRITE)
                                        val invEnd = System.nanoTime()
                                        PerfCounters.recordDirect(
                                            PerfMetric.PAINT_INVALIDATE_CALL,
                                            invEnd - invStart,
                                        )
                                        if (wasFirst) {
                                            PerfCounters.recordDirect(
                                                PerfMetric.PEN_JVM_TO_FIRST_MOVE,
                                                firstMoveArrivalNs - downStartNs,
                                            )
                                            PerfCounters.recordDirect(
                                                PerfMetric.PEN_MOVE_TO_PAINT,
                                                invEnd - firstMoveArrivalNs,
                                            )
                                        }
                                        accumDirty.set(Int.MAX_VALUE, Int.MAX_VALUE, Int.MIN_VALUE, Int.MIN_VALUE)
                                        lastPresentationMs = ts
                                    }
                                    lastX = x; lastY = y
                                }
                                ACTION_UP, ACTION_LEAVE -> {
                                    capturedStroke.add(StrokePoint(x, y, pressure, ts))
                                    // Flush pending partial-refresh segment.
                                    if (accumDirty.left != Int.MAX_VALUE) {
                                        val invStart = System.nanoTime()
                                        inValidateMethod.invoke(client, accumDirty, MODE_HANDWRITE)
                                        PerfCounters.recordDirect(
                                            PerfMetric.PAINT_INVALIDATE_CALL,
                                            System.nanoTime() - invStart,
                                        )
                                        accumDirty.set(Int.MAX_VALUE, Int.MAX_VALUE, Int.MIN_VALUE, Int.MIN_VALUE)
                                    }
                                    lastX = x; lastY = y
                                    lastStrokeEndUptimeMs = ts
                                    downKernelWallNs = 0L
                                }
                            }
                        }
                    } catch (t: Throwable) {
                        android.util.Log.w(TAG, "paint threw: ${t.message}", t)
                    }
                }

                // Rubber/eraser: paint nothing and dispatch nothing — return 0 lets the MotionEvent
                // flow to the WebView, where the web layer detects the stylus eraser (reliable
                // pointer events) and erases. Only pen strokes drive the daemon's StrokeCallback.
                if (!isEraser) {
                    when (action) {
                        ACTION_DOWN -> mainHandler.post {
                            sink.onStrokeBegin(x, y, pressure, ts)
                        }
                        ACTION_UP, ACTION_LEAVE -> {
                            val completed = capturedStroke.toList()
                            traceStroke(completed)
                            capturedStroke.clear()
                            mainHandler.post { sink.onStrokeComplete(completed) }
                            if (strokeIndex.get() <= 10) {
                                android.util.Log.i(
                                    TAG,
                                    "STROKE_BATCH samples=${completed.size} main_posts=2",
                                )
                            }
                        }
                    }
                } else if (action == ACTION_DOWN || action == ACTION_UP || action == ACTION_LEAVE) {
                    capturedStroke.clear()
                }
                if (action == ACTION_UP || action == ACTION_LEAVE) { erasing = false; strokeActive = false }
                PerfCounters.recordDirect(
                    PerfMetric.EVENT_HANDLER,
                    System.nanoTime() - invokeStart,
                )
                return 0
            }
            return when (method.name) {
                "toString" -> "BigmeInkController.InputProxy"
                "hashCode" -> System.identityHashCode(this)
                "equals" -> args?.getOrNull(0) === proxy
                else -> null
            }
        }
    }

    companion object {
        private const val TAG = "BigmeInkController"
        private const val HANDWRITTEN_CLIENT = "com.xrz.HandwrittenClient"
        private const val INPUT_LISTENER = "com.xrz.HandwrittenClient\$InputListener"

        // Lazily-resolved Canvas.mBitmap accessor. Hidden API on AOSP, but
        // marked @UnsupportedAppUsage so it remains reachable when the host
        // calls HiddenApiBypass.addHiddenApiExemptions("L") on Android 14+.
        @Volatile private var canvasBitmapFieldCached: java.lang.reflect.Field? = null
        @Volatile private var canvasBitmapFieldChecked = false
        private fun canvasBitmapField(): java.lang.reflect.Field? {
            if (canvasBitmapFieldChecked) return canvasBitmapFieldCached
            synchronized(this) {
                if (!canvasBitmapFieldChecked) {
                    canvasBitmapFieldCached = try {
                        android.graphics.Canvas::class.java.getDeclaredField("mBitmap")
                            .apply { isAccessible = true }
                    } catch (t: Throwable) {
                        Log.w(TAG, "Canvas.mBitmap reflection unavailable: ${t.message}")
                        null
                    }
                    canvasBitmapFieldChecked = true
                }
            }
            return canvasBitmapFieldCached
        }

        // Latency threshold (ms) above which a stroke is logged as a
        // SLOW_STROKE. Tuned to ~10× the warm p95 — anything past this is
        // worth correlating against external events.
        private const val SLOW_STROKE_MS = 30L
        private const val DIAGNOSTIC_IDLE_MS = 1_000L

        private val wallClockFormatter = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US)
        private fun wallClockHms(): String = wallClockFormatter.format(System.currentTimeMillis())

        const val ACTION_NEAR = 0
        const val ACTION_DOWN = 1
        const val ACTION_MOVE = 2
        const val ACTION_UP = 3
        const val ACTION_LEAVE = 4
        const val TOOL_PEN = 0
        const val TOOL_RUBBER = 1
        const val TOOL_FINGER = 2
        const val MODE_DU = 2
        const val MODE_A2 = 16
        const val MODE_HANDWRITE = 1029
        const val MODE_RUBBER = 1030
        const val MODE_GC16 = 4
        const val MODE_GU16 = 132

        fun isBigmeDevice(): Boolean =
            Build.MANUFACTURER.equals("Bigme", ignoreCase = true) ||
                Build.BRAND.equals("Bigme", ignoreCase = true)

    }
}
