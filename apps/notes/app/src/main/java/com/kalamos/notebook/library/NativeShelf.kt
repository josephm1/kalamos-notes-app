package com.kalamos.notebook.library

import android.content.Context
import android.graphics.*
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.view.*
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import com.kalamos.notebook.storage.StorageManager
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt
import kotlin.math.hypot

/** Notes shelf presentation, with no document writes or ink ownership. All coordinates are
 * supplied by the existing shelf layout in CSS pixels; Android clamps them to its actual host.
 * Decode complete visible-page previews on one worker, then publish one Android view tree.
 * There is no base64 thumbnail transfer, WebView image decoding, or second library database.
 */
internal class NativeShelf(private val webView: WebView,
                           private val worker: ExecutorService = Executors.newSingleThreadExecutor()) {
    private val main = Handler(Looper.getMainLooper())
    private val released = AtomicBoolean(false)
    private val storage = StorageManager(webView.context.applicationContext)
    private var pending: Future<*>? = null
    private var generation = 0
    private var overlay: FrameLayout? = null
    private data class DragSource(val revision: Int, val index: Int)

    fun present(model: JSONObject) {
        require(model.getJSONArray("cards").length() <= 16)
        require(model.getDouble("viewport").isFinite() && model.getDouble("viewport") > 0)
        main.post {
            if (released.get()) return@post
            val token = ++generation
            pending?.cancel(true)
            // Keep the complete old frame until the new page is ready. Revision-fenced
            // callbacks reject its stale hit targets while decoding finishes.
            val scale = webView.width / model.getDouble("viewport").toFloat()
            if (scale <= 0) return@post
            val target = (model.getDouble("cardWidth") * scale).roundToInt().coerceIn(1, 2048)
            pending = worker.submit {
                try {
                    val images = HashMap<String, Bitmap?>()
                    fun load(id: String) {
                        if (id.isEmpty() || images.containsKey(id) || Thread.currentThread().isInterrupted) return
                        images[id] = loadThumbnail(id, target)
                    }
                    val cards = model.getJSONArray("cards")
                    for (i in 0 until cards.length()) {
                        if (Thread.currentThread().isInterrupted) return@submit
                        val card = cards.getJSONObject(i)
                        load(card.optString("thumbnail"))
                        val slots = card.optJSONArray("slots")
                        if (slots != null) for (j in 0 until minOf(4, slots.length())) {
                            load(slots.getJSONObject(j).optString("thumbnail"))
                        }
                    }
                    main.post {
                        if (!released.get() && token == generation) {
                            try { display(model, images, scale) }
                            catch (error: Exception) {
                                android.util.Log.w("NativeShelf", "Native shelf layout failed; restoring web shelf", error)
                                fallback()
                            }
                        }
                    }
                } catch (error: Exception) {
                    android.util.Log.w("NativeShelf", "Native shelf preview failed; restoring web shelf", error)
                    main.post { if (!released.get() && token == generation) fallback() }
                }
            }
        }
    }

    fun hide() {
        main.post {
            generation++; pending?.cancel(true)
            overlay?.visibility = View.GONE
            overlay?.removeAllViews()
        }
    }

    fun release() {
        released.set(true)
        worker.shutdownNow()
        main.post {
            generation++
            overlay?.let { (it.parent as? ViewGroup)?.removeView(it) }
            overlay = null
        }
    }

    private fun fallback() {
        overlay?.visibility = View.GONE
        webView.evaluateJavascript("window.KalamosNotesNativeShelf?.fallback()", null)
    }

    private fun loadThumbnail(id: String, target: Int): Bitmap? {
        // The bridge supplies identities, never arbitrary file paths.
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,160}"))) return null
        val path = storage.getThumbnailPath(id)
        if (path.isEmpty()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > target * 2 || bounds.outHeight / sample > target * 4) sample *= 2
        return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun display(model: JSONObject, images: Map<String, Bitmap?>, scale: Float) {
        val parent = webView.parent as? FrameLayout ?: return fallback()
        val layer = overlay ?: FrameLayout(webView.context).also {
            it.setBackgroundColor(Color.WHITE)
            it.clipChildren = true
            overlay = it
            parent.addView(it)
        }
        fun px(name: String) = (model.getDouble(name) * scale).roundToInt()
        val left = px("x").coerceIn(0, webView.width)
        val top = px("y").coerceIn(0, webView.height)
        val width = px("width").coerceIn(0, webView.width - left)
        val height = px("height").coerceIn(0, webView.height - top)
        if (width == 0 || height == 0) return fallback()
        layer.layoutParams = FrameLayout.LayoutParams(width, height).apply {
            leftMargin = webView.left + left; topMargin = webView.top + top
        }
        layer.removeAllViews()
        val scroll = ScrollView(webView.context).apply { isFillViewport = true }
        val content = FrameLayout(webView.context)
        scroll.addView(content, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        layer.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val cards = model.getJSONArray("cards")
        val revision = model.getInt("revision")
        val cardWidth = px("cardWidth").coerceAtLeast(1)
        val coverHeight = (cardWidth * 131f / 86).roundToInt()
        val parentDrop = TextView(webView.context).apply {
            text = "Move to parent folder"
            gravity = Gravity.CENTER
            setTextColor(Color.BLACK); setBackgroundColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, 16 * scale)
            visibility = View.GONE
        }
        layer.addView(parentDrop, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (48 * scale).roundToInt()))
        fun dropListener(destination: Int?) = View.OnDragListener { view, event ->
            val source = event.localState as? DragSource
            if (source == null || source.revision != revision) false else when (event.action) {
                DragEvent.ACTION_DRAG_STARTED -> true
                DragEvent.ACTION_DRAG_ENTERED -> { view.alpha = .6f; true }
                DragEvent.ACTION_DRAG_EXITED, DragEvent.ACTION_DRAG_ENDED -> { view.alpha = 1f; true }
                DragEvent.ACTION_DROP -> {
                    view.alpha = 1f
                    action(revision, source.index, if (destination == null) "moveParent" else "move", destination = destination)
                    true
                }
                else -> true
            }
        }
        parentDrop.setOnDragListener(dropListener(null))
        layer.setOnDragListener { _, event ->
            if (event.localState !is DragSource) false else {
                if (event.action == DragEvent.ACTION_DRAG_STARTED && model.optBoolean("canMoveUp")) parentDrop.visibility = View.VISIBLE
                if (event.action == DragEvent.ACTION_DRAG_ENDED) parentDrop.visibility = View.GONE
                true
            }
        }
        for (i in 0 until cards.length()) {
            val data = cards.getJSONObject(i)
            val card = LinearLayout(webView.context).apply {
                orientation = LinearLayout.VERTICAL
                isFocusable = true
                accessibilityDelegate = object : View.AccessibilityDelegate() {
                    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfo) {
                        super.onInitializeAccessibilityNodeInfo(host, info)
                        info.className = "android.widget.Button"
                    }
                }
                contentDescription = data.getString("title") + if (data.optBoolean("folder")) ", folder" else ", notebook"
                setOnClickListener { action(revision, i, "open") }
                setOnLongClickListener {
                    action(revision, i, "context", data.getDouble("x") + model.getDouble("x"),
                        data.getDouble("y") + model.getDouble("y"))
                    true
                }
            }
            if (data.optBoolean("folder")) card.setOnDragListener(dropListener(i))
            else {
                var downX = 0f; var downY = 0f; var dragging = false
                card.setOnTouchListener { view, event ->
                    when (event.actionMasked) {
                        MotionEvent.ACTION_DOWN -> {
                            downX = event.x; downY = event.y; dragging = false
                            view.parent.requestDisallowInterceptTouchEvent(true)
                        }
                        MotionEvent.ACTION_MOVE -> if (!dragging && hypot(event.x - downX, event.y - downY) > 10 * scale) {
                            view.cancelLongPress()
                            dragging = view.startDragAndDrop(null, View.DragShadowBuilder(view), DragSource(revision, i), 0)
                        }
                    }
                    dragging
                }
            }
            val folder = data.optBoolean("folder")
            val cardCoverHeight = coverHeight + if (folder) (10 * scale).roundToInt() else 0
            card.addView(Cover(webView.context, data, images, scale), LinearLayout.LayoutParams(cardWidth, cardCoverHeight))
            fun caption(text: String, size: Float, bold: Boolean) {
                card.addView(TextView(webView.context).apply {
                    this.text = text
                    setTextColor(Color.BLACK)
                    setTextSize(TypedValue.COMPLEX_UNIT_PX, size * scale)
                    gravity = Gravity.CENTER
                    maxLines = 1; ellipsize = TextUtils.TruncateAt.END
                    includeFontPadding = false
                    if (bold) typeface = Typeface.create("sans-serif", Typeface.BOLD)
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                }, LinearLayout.LayoutParams(cardWidth, (size * (if (bold) 1.3f else 1.2f) * scale).roundToInt()).apply {
                    topMargin = ((if (bold) if (folder) 8 else 6 else 4) * scale).roundToInt()
                })
            }
            caption(data.getString("title"), if (model.getInt("columns") == 4) 11f else if (model.getDouble("viewport") <= 560) 13f else 15f, true)
            if (!data.optBoolean("folder")) caption(data.optString("subtitle"), 11f, false)
            content.addView(card, FrameLayout.LayoutParams(cardWidth, cardCoverHeight + px("caption")).apply {
                leftMargin = (data.getDouble("x") * scale).roundToInt()
                topMargin = (data.getDouble("y") * scale).roundToInt()
            })
        }
        layer.visibility = View.VISIBLE
    }

    private fun action(revision: Int, index: Int, kind: String, x: Double = 0.0, y: Double = 0.0, destination: Int? = null) {
        val event = JSONObject().put("revision", revision).put("index", index).put("kind", kind).put("x", x).put("y", y)
        if (destination != null) event.put("destination", destination)
        webView.evaluateJavascript("window.KalamosNotesNativeShelf?.action($event)", null)
    }

    /** Shelf previews only. Never used as a writing renderer or saved notebook thumbnail. */
    private class Cover(context: Context, private val data: JSONObject,
                        private val images: Map<String, Bitmap?>, private val scale: Float) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val inset = scale
            val rect = RectF(inset, inset, width - inset, height - inset)
            val folder = data.optBoolean("folder")
            if (folder) rect.top += 10 * scale
            paint.color = Color.WHITE; paint.style = Paint.Style.FILL
            canvas.drawRoundRect(rect, 7 * scale, 7 * scale, paint)
            val bitmap = images[data.optString("thumbnail")]
            if (folder) {
                val slots = data.optJSONArray("slots")
                if (slots == null || slots.length() == 0) {
                    val size = rect.width() * .44f
                    canvas.save()
                    canvas.translate(rect.centerX() - size / 2, rect.centerY() - size / 2)
                    canvas.scale(size / 24, size / 24)
                    paint.color = Color.BLACK; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.4f
                    val glyph = Path().apply {
                        moveTo(3f, 7f); lineTo(9f, 7f); lineTo(11f, 9f); lineTo(21f, 9f)
                        lineTo(21f, 18f); quadTo(21f, 20f, 19f, 20f); lineTo(5f, 20f)
                        quadTo(3f, 20f, 3f, 18f); close()
                    }
                    canvas.drawPath(glyph, paint)
                    canvas.restore()
                } else for (i in 0 until minOf(4, slots.length())) {
                    val gap = 7 * scale
                    val slotWidth = (rect.width() - gap * 3) / 2
                    val slotHeight = (rect.height() - gap * 3) / 2
                    val x = rect.left + gap + (i % 2) * (slotWidth + gap)
                    val y = rect.top + gap + (i / 2) * (slotHeight + gap)
                    val slot = RectF(x, y, x + slotWidth, y + slotHeight)
                    val entry = slots.getJSONObject(i)
                    val image = images[entry.optString("thumbnail")]
                    if (image != null) image(canvas, image, slot)
                    else if (!entry.optBoolean("folder")) empty(canvas, slot)
                    outline(canvas, slot, entry.optBoolean("folder"))
                }
                paint.style = Paint.Style.FILL; paint.color = Color.WHITE
                val tabWidth = 33 * scale; val tabHeight = 23 * scale
                canvas.drawRect(rect.left, rect.bottom - tabHeight, rect.left + tabWidth, rect.bottom, paint)
                paint.color = Color.BLACK; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.5f * scale
                val countBorder = Path().apply {
                    moveTo(rect.left, rect.bottom - tabHeight)
                    lineTo(rect.left + tabWidth - 10 * scale, rect.bottom - tabHeight)
                    quadTo(rect.left + tabWidth, rect.bottom - tabHeight, rect.left + tabWidth, rect.bottom - tabHeight + 10 * scale)
                    lineTo(rect.left + tabWidth, rect.bottom)
                }
                canvas.drawPath(countBorder, paint)
                paint.style = Paint.Style.FILL; paint.textSize = 13 * scale; paint.textAlign = Paint.Align.CENTER
                paint.typeface = Typeface.DEFAULT_BOLD
                canvas.drawText(data.optInt("count").toString(), rect.left + tabWidth / 2, rect.bottom - 6 * scale, paint)
                paint.typeface = Typeface.DEFAULT
            } else if (bitmap != null) image(canvas, bitmap, rect)
            else empty(canvas, rect)
            outline(canvas, rect, folder)
        }

        private fun image(canvas: Canvas, bitmap: Bitmap, rect: RectF) {
            val ratio = minOf(rect.width() / bitmap.width, rect.height() / bitmap.height)
            val w = bitmap.width * ratio; val h = bitmap.height * ratio
            paint.style = Paint.Style.FILL
            // Match the web shelf's grayscale/contrast treatment without altering stored previews.
            val contrast = 1.35f
            val shift = 128 * (1 - contrast)
            paint.colorFilter = ColorMatrixColorFilter(ColorMatrix(floatArrayOf(
                .213f * contrast, .715f * contrast, .072f * contrast, 0f, shift,
                .213f * contrast, .715f * contrast, .072f * contrast, 0f, shift,
                .213f * contrast, .715f * contrast, .072f * contrast, 0f, shift,
                0f, 0f, 0f, 1f, 0f)))
            canvas.drawBitmap(bitmap, null, RectF(rect.centerX() - w / 2, rect.centerY() - h / 2,
                rect.centerX() + w / 2, rect.centerY() + h / 2), paint)
            paint.colorFilter = null
        }

        private fun empty(canvas: Canvas, rect: RectF) {
            paint.color = Color.BLACK; paint.strokeWidth = scale; paint.style = Paint.Style.STROKE
            var y = rect.top + 19 * scale
            while (y < rect.bottom) { canvas.drawLine(rect.left, y, rect.right, y, paint); y += 19 * scale }
            paint.textSize = 10 * scale; paint.textAlign = Paint.Align.CENTER
            val text = "Empty note"
            val labelY = rect.top + rect.height() * .75f
            val label = RectF(rect.centerX() - paint.measureText(text) / 2 - 7 * scale,
                labelY - 10 * scale, rect.centerX() + paint.measureText(text) / 2 + 7 * scale, labelY + 10 * scale)
            paint.style = Paint.Style.FILL; paint.color = Color.WHITE; canvas.drawRect(label, paint)
            paint.color = Color.BLACK; paint.style = Paint.Style.STROKE; canvas.drawRect(label, paint)
            paint.style = Paint.Style.FILL; canvas.drawText(text, label.centerX(), label.centerY() + 3 * scale, paint)
        }

        private fun outline(canvas: Canvas, rect: RectF, folder: Boolean) {
            paint.color = Color.BLACK; paint.style = Paint.Style.STROKE; paint.strokeWidth = 1.5f * scale
            if (folder) {
                val radius = minOf(7 * scale, rect.width() / 8, rect.height() / 8)
                val tabTop = maxOf(scale, rect.top - 10 * scale)
                val tabRight = rect.left + rect.width() * .43f
                val path = Path().apply {
                    moveTo(rect.left, rect.bottom - radius); lineTo(rect.left, tabTop + radius)
                    quadTo(rect.left, tabTop, rect.left + radius, tabTop)
                    lineTo(tabRight - radius, tabTop); quadTo(tabRight, tabTop, tabRight, tabTop + radius)
                    lineTo(tabRight, rect.top); lineTo(rect.right - radius, rect.top)
                    quadTo(rect.right, rect.top, rect.right, rect.top + radius)
                    lineTo(rect.right, rect.bottom - radius); quadTo(rect.right, rect.bottom, rect.right - radius, rect.bottom)
                    lineTo(rect.left + radius, rect.bottom); quadTo(rect.left, rect.bottom, rect.left, rect.bottom - radius)
                    close()
                }
                canvas.drawPath(path, paint)
            } else canvas.drawRoundRect(rect, 7 * scale, 7 * scale, paint)
        }
    }
}
