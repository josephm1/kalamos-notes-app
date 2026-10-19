package com.kalamos.koreader

import android.app.Activity
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.PopupWindow
import android.widget.TextView
import com.kalamos.device.api.DeviceRegistry
import kotlin.math.max
import kotlin.math.min

/** Native chrome remains above the retained ink surface. Opening tools never resizes the book. */
internal class InkToolbar(
    private val activity: Activity,
    private val changed: (Style) -> Unit,
    private val action: (String) -> Unit,
    private val exclusion: (Rect) -> Unit,
    private val chromeChanged: (Rect) -> Unit,
    private val context: String = "full-page",
    initialStyle: Style = Style(),
    private val canvasAvailable: Boolean = true,
    private val originalInkAvailable: Boolean = false,
    private val originalInkView: Boolean = false,
    private val writingBounds: Rect? = null,
    private val stickyHeader: Rect? = null,
    private val place: (String, Float, Float, Float) -> Unit = { _, _, _, _ -> },
) {
    data class Style(
        val tool: String = "pen", val pen: String = "Pen", val width: Float = 5f,
        val color: Int = Color.BLACK, val eraser: String = "stroke", val trail: Boolean = true,
        val straight: Boolean = true, val lineSelection: Boolean = false,
        val circleSelection: Boolean = false,
    )
    var style = initialStyle
        private set
    private val preferences = activity.getSharedPreferences("kalamos_writing_toolbar", 0)
    private val screenWidth get() = activity.window.decorView.width.coerceAtLeast(1)
    private val screenHeight get() = activity.window.decorView.height.coerceAtLeast(1)
    private val density = activity.resources.displayMetrics.density
    private fun dp(value: Int) = (value * density + .5f).toInt()
    // Fit the whole rail on short displays without allocating a second scroll/input owner.
    private val sticky get() = context == "sticky" && writingBounds != null
    private val host get() = if (sticky) Rect(writingBounds!!) else Rect(0, 0, screenWidth, screenHeight)
    private val row get() = min(dp(36), (host.height() - dp(24)) / 12).coerceAtLeast(1)
    private val railWidth get() = row + dp(2)
    private val top get() = if (sticky) host.top + dp(6) else dp(48).coerceAtMost(screenHeight / 10)
    private var right = if (context == "sticky") true else preferences.getBoolean("right", false)
    private var expanded = true
    private var ready = false
    private var viewportWidth = 0
    private var viewportHeight = 0
    private val layoutListener = View.OnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
        if (ready && (right - left != viewportWidth || bottom - top != viewportHeight)) {
            viewportWidth = right - left; viewportHeight = bottom - top
            showRail()
        }
    }
    private var panel: PopupWindow? = null
    private var rail: PopupWindow? = null
    private var noteHeader: PopupWindow? = null
    private var trail: PopupWindow? = null
    private var guide: PopupWindow? = null
    private var guideRect = Rect()
    private var railRect = Rect()
    private var panelRect = Rect()
    private var penTarget: Pair<View, Rect>? = null
    private var placementStart: Pair<Float, Float>? = null
    private var lastTapMs = 0L
    private var lastTapX = Float.NaN
    private var lastTapY = Float.NaN
    private var eraserRadius = preferences.getFloat("eraser_radius", 10f).coerceIn(3f, 40f)
    private var eraserMode = preferences.getString("eraser_mode", "stroke") ?: "stroke"
    private var penWidth = preferences.getFloat("pen_width", 5f)
    private var penColor = preferences.getInt("pen_color", Color.BLACK)
    private var highlightWidth = preferences.getFloat("highlight_width", 14f)
    private var highlightColor = preferences.getInt("highlight_color", Color.YELLOW)
    private var penSecondary = preferences.getInt("pen_secondary", Color.BLUE)
    private var highlightSecondary = preferences.getInt("highlight_secondary", Color.GREEN)
    private val colors = listOf("Black" to Color.BLACK, "Grey" to Color.GRAY,
        "Red" to Color.RED, "Orange" to 0xffffaa00.toInt(), "Yellow" to Color.YELLOW,
        "Green" to 0xff4ca65a.toInt(), "Aqua" to Color.CYAN, "Blue" to Color.BLUE,
        "Purple" to 0xff8d43a9.toInt(), "Pink" to 0xffe91e63.toInt())

    private fun acceptTap(x: Float, y: Float): Boolean {
        val now = SystemClock.uptimeMillis()
        if (now - lastTapMs < 220 && kotlin.math.abs(x - lastTapX) < dp(16) &&
            kotlin.math.abs(y - lastTapY) < dp(16)) return false
        lastTapMs = now; lastTapX = x; lastTapY = y
        return true
    }
    private fun column() = object : LinearLayout(activity) {
        override fun dispatchDraw(canvas: Canvas) {
            super.dispatchDraw(canvas)
            if (tag == "outlined") {
                val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.BLACK; style = android.graphics.Paint.Style.STROKE; strokeWidth = dp(1).toFloat()
                }
                val inset = p.strokeWidth / 2f
                canvas.drawRoundRect(inset, inset, width - inset, height - inset, dp(5).toFloat(), dp(5).toFloat(), p)
            }
        }
    }.apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE) }
    private fun background(selected: Boolean = false, border: Boolean = false) = GradientDrawable().apply {
        setColor(if (selected) Color.BLACK else Color.WHITE)
        if (border) { setStroke(dp(1), Color.BLACK); cornerRadius = dp(6).toFloat() }
    }
    private fun clickable(view: View, description: String, click: () -> Unit): View = view.apply {
        contentDescription = description; isClickable = true; isFocusable = true
        tooltipText = description
        setOnClickListener {
            val location = IntArray(2); getLocationOnScreen(location)
            if (acceptTap(location[0].toFloat(), location[1].toFloat())) click()
        }
    }
    private fun button(label: String, description: String = label, selected: Boolean = false,
        click: () -> Unit): View = clickable(TextView(activity).apply {
        text = label; textSize = 14f; gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(12), 0, dp(8), 0)
        setTextColor(if (selected) Color.WHITE else Color.BLACK)
        background = background(selected); isSelected = selected
    }, description, click)
    private fun icon(glyph: String, description: String, selected: Boolean = false,
        color: Int? = null, weight: Float = 2f, label: String? = null, click: () -> Unit): View =
        clickable(ToolGlyph(activity, glyph, selected, color, weight, label).apply { isSelected = selected }, description, click)
    private fun divider(view: LinearLayout) {
        view.addView(View(activity).apply { setBackgroundColor(Color.BLACK) },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)))
    }
    private fun popup(view: View, bounds: Rect, watchOutside: Boolean = false): PopupWindow {
        view.measure(View.MeasureSpec.makeMeasureSpec(bounds.width(), View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(bounds.height(), View.MeasureSpec.EXACTLY))
        view.layout(0, 0, bounds.width(), bounds.height())
        return PopupWindow(view, bounds.width(), bounds.height(), false).apply {
            isTouchable = true; isOutsideTouchable = watchOutside; isClippingEnabled = true
            setBackgroundDrawable(ColorDrawable(Color.WHITE))
            setTouchInterceptor { _, event ->
                if (event.actionMasked == MotionEvent.ACTION_OUTSIDE) {
                    if (event.getToolType(0) == MotionEvent.TOOL_TYPE_FINGER &&
                        !DeviceRegistry.require(activity).isPenInputDevice(event.deviceId)) closeSettings()
                    true
                } else false
            }
            showAtLocation(activity.window.decorView, Gravity.TOP or Gravity.LEFT, bounds.left, bounds.top)
        }
    }
    fun show() {
        // Keep independent tool styles through page turns and through sticky/editor handoffs.
        if (style.tool == "pen") style = style.copy(width = penWidth, color = penColor)
        if (style.tool == "highlighter") style = style.copy(width = highlightWidth, color = highlightColor)
        changed(style)
        expanded = !preferences.getBoolean("collapsed", false)
        showRail(); showNoteHeader(); ready = true
        viewportWidth = screenWidth; viewportHeight = screenHeight
        activity.window.decorView.addOnLayoutChangeListener(layoutListener)
        if (style.tool == "canvas" || style.tool == "sticky") placement(style.tool)
    }
    private fun captureBounds(): Rect = Rect(railRect).apply {
        if (panel?.isShowing == true) union(panelRect)
    }
    fun chromeBounds(): Rect = captureBounds().apply {
        if (noteHeader?.isShowing == true && stickyHeader != null) union(stickyHeader)
    }
    private fun showNoteHeader() {
        val bounds = stickyHeader ?: return
        noteHeader?.dismiss()
        val strip = LinearLayout(activity).apply { setBackgroundColor(Color.WHITE) }
        val iconWidth = min(dp(32), bounds.width() / 6)
        fun tab(text: String, selected: Boolean, click: () -> Unit) {
            val view = object : TextView(activity) {
                override fun onDraw(canvas: Canvas) {
                    super.onDraw(canvas)
                    if (selected) {
                        val p = android.graphics.Paint().apply { color = Color.BLACK; strokeWidth = dp(2).toFloat() }
                        canvas.drawLine(dp(8).toFloat(), height - dp(2).toFloat(), width - dp(8).toFloat(), height - dp(2).toFloat(), p)
                    }
                }
            }.apply { this.text = text; textSize = 13f; gravity = Gravity.CENTER; setTextColor(Color.BLACK) }
            strip.addView(clickable(view, text, click), LinearLayout.LayoutParams(0, bounds.height(), 1f))
        }
        tab("Handwritten note", true) {}
        tab("Text note", false) { action("sticky-text") }
        strip.addView(icon("options", "Note options") { options() }, LinearLayout.LayoutParams(iconWidth, bounds.height()))
        strip.addView(icon("close", "Save and close note") { action("finish") }, LinearLayout.LayoutParams(iconWidth, bounds.height()))
        noteHeader = popup(strip, bounds)
    }
    fun drawChrome(canvas: Canvas) {
        for ((window, bounds) in listOf(rail to railRect, panel to panelRect, guide to guideRect, noteHeader to (stickyHeader ?: Rect()))) {
            val view = window?.contentView ?: continue
            val saved = canvas.save(); canvas.translate(bounds.left.toFloat(), bounds.top.toFloat())
            view.draw(canvas); canvas.restoreToCount(saved)
        }
    }
    private fun notifyChrome(old: Rect) {
        exclusion(captureBounds())
        if (ready) chromeChanged(Rect(old).apply { union(chromeBounds()) })
    }
    private fun showRail() {
        val old = chromeBounds()
        panel?.dismiss(); panel = null; panelRect.setEmpty(); rail?.dismiss()
        val view = column().apply { background = background(border = true); tag = "outlined"; clipToOutline = true; setPadding(dp(1), dp(1), dp(1), dp(1)) }
        fun add(glyph: String, name: String, selected: Boolean = false, color: Int? = null, click: () -> Unit) {
            val label = if (!expanded) "Tools" else when (glyph) {
                "collapse" -> "Collapse"
                "exit" -> "Exit"
                "pen" -> "Pen"
                "highlighter" -> "Highlight"
                "color" -> colorName(color ?: style.color)
                "eraser" -> "Erase"
                "lasso" -> "Select"
                "canvas" -> "Canvas"
                "undo" -> "Undo"
                "redo" -> "Redo"
                else -> "More"
            }
            view.addView(icon(glyph, name, selected, color, label = label, click = click), LinearLayout.LayoutParams(-1, row))
        }
        if (!expanded) {
            add(if (style.tool == "highlighter") "highlighter" else "pen", "Expand writing toolbar") {
                expanded = true; persist(); showRail()
            }
        } else {
            add("collapse", "Collapse writing toolbar") { expanded = false; persist(); showRail() }
            divider(view)
            add("exit", "Exit Kalamos mode — save and hide tools") {
                hidePlacementGuide(); action("exit-kalamos")
            }
            add("pen", "Pen", style.tool == "pen") { select("pen") }
            add("highlighter", "Highlighter", style.tool == "highlighter") { select("highlighter") }
            val inkTool = style.tool == "pen" || style.tool == "highlighter"
            add("color", "Active colour: ${colorName(style.color)}. Choose colour", inkTool, style.color) { palette() }
            val secondary = if (style.tool == "highlighter") highlightSecondary else penSecondary
            add("color", "Switch to ${colorName(secondary)}", color = secondary) { swapColor() }
            add("eraser", "Eraser", style.tool == "eraser") { select("eraser") }
            add("lasso", "Lasso", style.tool == "lasso") { select("lasso") }
            divider(view)
            if (context != "sticky") {
                add("canvas", "Canvas — add writing space", style.tool == "canvas") { placement("canvas") }
                divider(view)
            }
            add("undo", "Undo") { action("undo") }
            add("redo", "Redo") { action("redo") }
            add("options", "Writing options") { options() }
        }
        val x = if (right) host.right - railWidth - dp(6) else host.left + dp(6)
        val dividers = if (!expanded) 0 else if (context == "sticky") 2 else 3
        val height = row * (view.childCount - dividers) + dividers * dp(1) + dp(2)
        railRect = Rect(x, top, x + railWidth, top + height)
        rail = popup(view, railRect); notifyChrome(old)
    }
    private fun closeSettings() {
        val old = chromeBounds(); panel?.dismiss(); panel = null; panelRect.setEmpty(); notifyChrome(old)
    }
    private fun showPanel(content: LinearLayout, height: Int) {
        val old = chromeBounds(); panel?.dismiss()
        val width = min(dp(220), host.width() - railWidth - dp(18)).coerceAtLeast(1)
        val h = min(height + dp(4), host.bottom - top - dp(6)).coerceAtLeast(1)
        content.background = background(border = true); content.tag = "outlined"; content.clipToOutline = true
        content.setPadding(dp(1), dp(1), dp(1), dp(1))
        val x = if (right) railRect.left - width - dp(2) else railRect.right + dp(2)
        panelRect = Rect(x, top, x + width, top + h)
        val windowContent: View = if (height + dp(4) > h) {
            // A sticky sheet can be shorter than Pen settings. Keep every option
            // reachable without allowing children to paint outside the border.
            column().apply {
                background = background(border = true); tag = "outlined"
                setPadding(dp(1), dp(1), dp(1), dp(1))
                content.tag = null; content.background = ColorDrawable(Color.WHITE)
                addView(ScrollView(activity).apply { isFillViewport = false; addView(content) },
                    LinearLayout.LayoutParams(-1, -1))
            }
        } else content
        panel = popup(windowContent, panelRect, watchOutside = true); notifyChrome(old)
    }
    private fun panel(title: String, rows: List<Pair<String, () -> Unit>>) {
        val content = column()
        header(content, title)
        for ((label, callback) in rows) content.addView(button(label, click = callback),
            LinearLayout.LayoutParams(-1, dp(40)))
        showPanel(content, dp(40) * (rows.size + 1))
    }
    private fun header(content: LinearLayout, title: String) {
        val heading = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        heading.addView(TextView(activity).apply {
            text = title; textSize = 14f; gravity = Gravity.CENTER_VERTICAL; setTextColor(Color.BLACK); setPadding(dp(12), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, dp(40), 1f))
        heading.addView(icon("close", "Close tool settings") {
            if (style.tool == "canvas" || style.tool == "sticky") select("pen") else closeSettings()
        }, LinearLayout.LayoutParams(dp(36), dp(36)))
        content.addView(heading); divider(content)
    }
    private fun placement(tool: String) {
        if (tool == "canvas" && !canvasAvailable) {
            panel("Canvas", listOf("Requires single-page EPUB" to { closeSettings() }))
            return
        }
        if (context != "full-page") {
            style = style.copy(tool = tool); changed(style)
            action(if (tool == "canvas") "space" else "sticky"); return
        }
        style = style.copy(tool = tool); changed(style); action("$tool-mode"); showRail()
        // Canvas is an on-page tool. Its selected rail state and contact guide
        // explain placement without opening an instruction panel over the book.
    }
    private fun select(tool: String) {
        hidePlacementGuide()
        val already = style.tool == tool
        style = when (tool) {
            "pen" -> style.copy(tool = tool, width = penWidth, color = penColor)
            "highlighter" -> style.copy(tool = tool, width = highlightWidth, color = highlightColor)
            "eraser" -> style.copy(tool = tool, width = eraserRadius, eraser = eraserMode)
            else -> style.copy(tool = tool)
        }
        changed(style)
        action("placement-cancel")
        persist(); showRail()
        if (already || tool == "eraser" || tool == "lasso") settings()
    }
    private fun edit(next: Style) {
        if (next.color != style.color) {
            if (next.tool == "pen" && next.color == penSecondary) penSecondary = style.color
            if (next.tool == "highlighter" && next.color == highlightSecondary) highlightSecondary = style.color
        }
        style = next
        if (style.tool == "pen") { penWidth = style.width; penColor = style.color }
        if (style.tool == "highlighter") { highlightWidth = style.width; highlightColor = style.color }
        if (style.tool == "eraser") { eraserRadius = style.width; eraserMode = style.eraser }
        changed(style); persist(); showRail()
    }
    private fun colorName(color: Int) = colors.firstOrNull { it.second == color }?.first ?: "Custom"
    private fun colorGrid(content: LinearLayout) {
        for (group in colors.chunked(5)) {
            val strip = LinearLayout(activity)
            for ((name, color) in group) strip.addView(icon("color", name, style.color == color, color) {
                edit(style.copy(color = color)); palette()
            }, LinearLayout.LayoutParams(0, dp(38), 1f))
            content.addView(strip)
        }
        divider(content)
        content.addView(button(colorName(style.color)) { closeSettings() }, LinearLayout.LayoutParams(-1, dp(36)))
    }
    private fun palette() {
        if (style.tool != "pen" && style.tool != "highlighter") select("pen")
        val content = column(); header(content, "Ink colour")
        colorGrid(content); showPanel(content, dp(155))
    }
    private fun swapColor() {
        if (style.tool != "pen" && style.tool != "highlighter") select("pen")
        val next = if (style.tool == "highlighter") highlightSecondary else penSecondary
        if (style.tool == "highlighter") highlightSecondary = style.color else penSecondary = style.color
        edit(style.copy(color = next))
    }
    private fun settings() {
        when (style.tool) {
            "pen", "highlighter" -> {
                val content = column(); val pen = style.tool == "pen"
                header(content, if (pen) "Pen" else "Highlighter")
                if (pen) for ((label, value) in listOf("Pen" to "Pen", "Ballpoint" to "BallPen", "Brush" to "Brush")) {
                    val strip = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL; background = background(style.pen == value) }
                    strip.addView(icon(if (value == "Brush") "brush" else "pen", label, style.pen == value) {
                        edit(style.copy(pen = value)); settings()
                    }, LinearLayout.LayoutParams(dp(36), dp(38)))
                    strip.addView(button(label, selected = style.pen == value) { edit(style.copy(pen = value)); settings() },
                        LinearLayout.LayoutParams(0, dp(38), 1f))
                    content.addView(strip)
                }
                divider(content)
                val widths = if (pen) listOf(1f, 3f, 5f, 8f, 12f) else listOf(6f, 10f, 14f, 20f, 30f)
                val strip = LinearLayout(activity)
                for ((i, width) in widths.withIndex()) strip.addView(icon("width",
                    listOf("Fine", "Thin", "Medium", "Thick", "Heavy")[i], style.width == width,
                    weight = if (pen) (i + 1) * .8f else (i + 2) * 1.6f) {
                    edit(style.copy(width = width)); settings()
                }, LinearLayout.LayoutParams(0, dp(40), 1f))
                content.addView(strip); divider(content); colorGrid(content)
                if (!pen) content.addView(button(if (style.straight) "✓ Straight highlighter" else "Straight highlighter") {
                    edit(style.copy(straight = !style.straight)); settings()
                }, LinearLayout.LayoutParams(-1, dp(40)))
                showPanel(content, dp(if (pen) 312 else 238))
            }
            "eraser" -> eraserSettings()
            "lasso" -> panel("Selected handwriting", listOf(
                "Move" to { action("move-mode"); closeSettings() },
                "Resize" to { action("resize-mode"); closeSettings() },
                "Delete" to { action("delete-selection"); closeSettings() }))
        }
    }
    private fun eraserSettings() {
        val content = column(); header(content, "Eraser")
        for ((mode, label) in listOf("stroke" to "Stroke eraser", "range" to "Erasing lasso", "track" to "Pixel eraser")) {
            val selected = style.eraser == mode
            val strip = LinearLayout(activity).apply {
                gravity = Gravity.CENTER_VERTICAL; background = background(selected)
            }
            val glyph = if (mode == "range") "lasso" else if (mode == "track") "pixel-eraser" else "eraser"
            strip.addView(icon(glyph, label, selected) {
                edit(style.copy(eraser = mode)); eraserSettings()
            }, LinearLayout.LayoutParams(dp(36), dp(44)))
            strip.addView(button(label, selected = selected) {
                edit(style.copy(eraser = mode)); eraserSettings()
            }, LinearLayout.LayoutParams(0, dp(44), 1f))
            content.addView(strip)
        }
        divider(content)
        val diameter = (style.width * 2).toInt()
        content.addView(object : View(activity) {
            init { contentDescription = "Eraser diameter: $diameter pixels" }
            override fun onDraw(canvas: Canvas) {
                val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.BLACK; style = android.graphics.Paint.Style.STROKE; strokeWidth = dp(1).toFloat()
                }
                // Same diameter contract as Notes; display actual physical pen footprint.
                canvas.drawCircle(width / 2f, height / 2f, style.width, paint)
            }
        }, LinearLayout.LayoutParams(-1, dp(84)))
        val size = LinearLayout(activity)
        fun change(delta: Float) { edit(style.copy(width = (style.width + delta).coerceIn(3f, 40f))); eraserSettings() }
        size.addView(button("−", "Decrease eraser diameter") { change(-1f) }, LinearLayout.LayoutParams(0, dp(42), 1f))
        size.addView(TextView(activity).apply {
            text = "$diameter px"; textSize = 16f; gravity = Gravity.CENTER; setTextColor(Color.BLACK)
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        size.addView(button("+", "Increase eraser diameter") { change(1f) }, LinearLayout.LayoutParams(0, dp(42), 1f))
        content.addView(size)
        showPanel(content, dp(302))
    }
    private fun options() = panel("Writing options", (if (context == "space") listOf(
        "Make canvas taller" to { action("space-larger") },
        "Make canvas smaller" to { action("space-smaller") },
        "Collapse canvas" to { action("space-collapse") },
        "Remove canvas…" to { panel("Remove canvas and handwriting?", listOf(
            "Keep canvas" to { closeSettings() }, "Remove" to { action("space-delete") })) }
    ) else if (context == "sticky") listOf("Discard note changes" to { action("cancel-sticky") }) else emptyList()) +
        (if (originalInkAvailable) listOf(
            (if (originalInkView) "Return to canvas layout" else "Original page handwriting") to { action("original-ink") }
        ) else emptyList()) + listOf(
        "Write on page" to { action("page") },
        "Move toolbar ${if (right) "left" else "right"}" to { right = !right; persist(); showRail() },
        "Close" to { closeSettings() }))
    private fun persist() {
        preferences.edit().putBoolean("right", if (sticky) preferences.getBoolean("right", false) else right).putBoolean("collapsed", !expanded)
            .putFloat("eraser_radius", eraserRadius).putString("eraser_mode", eraserMode)
            .putFloat("pen_width", penWidth).putInt("pen_color", penColor)
            .putFloat("highlight_width", highlightWidth).putInt("highlight_color", highlightColor)
            .putInt("pen_secondary", penSecondary).putInt("highlight_secondary", highlightSecondary).apply()
    }
    /** Native stylus packets over chrome must never fall through to document ink/navigation. */
    fun onPenTouch(action: Int, x: Float, y: Float) {
        if (action == 1) {
            val target = when {
                noteHeader?.isShowing == true && stickyHeader?.contains(x.toInt(), y.toInt()) == true -> noteHeader?.contentView to stickyHeader!!
                panel?.isShowing == true && panelRect.contains(x.toInt(), y.toInt()) -> panel?.contentView to panelRect
                railRect.contains(x.toInt(), y.toInt()) -> rail?.contentView to railRect
                else -> null
            }
            penTarget = target?.first?.let { it to Rect(target.second) }
            placementStart = if (penTarget == null && (style.tool == "canvas" || style.tool == "sticky")) x to y else null
        }
        placementStart?.let { start ->
            if (action == 1 || action == 2) showPlacementGuide(y)
            if (action == 3 || action == 4) {
                placementStart = null; hidePlacementGuide()
                place(style.tool, start.first, start.second, y)
            }
            return
        }
        val target = penTarget ?: return
        val eventAction = when (action) { 1 -> MotionEvent.ACTION_DOWN; 2 -> MotionEvent.ACTION_MOVE
            3, 4 -> MotionEvent.ACTION_UP; else -> MotionEvent.ACTION_CANCEL }
        val now = SystemClock.uptimeMillis()
        val event = MotionEvent.obtain(now, now, eventAction, x - target.second.left, y - target.second.top, 0)
        try { target.first.dispatchTouchEvent(event) } finally {
            event.recycle()
            if (eventAction == MotionEvent.ACTION_UP || eventAction == MotionEvent.ACTION_CANCEL) penTarget = null
        }
    }
    fun showPlacementGuide(y: Float) {
        if (style.tool != "canvas" && style.tool != "sticky") return
        val yTop = y.toInt().coerceIn(0, (screenHeight - dp(24)).coerceAtLeast(0))
        if (guide != null && kotlin.math.abs(yTop - guideRect.top) < dp(18)) return
        val dirty = Rect(guideRect)
        closeSettings()
        guide?.dismiss()
        guideRect = Rect(dp(50), yTop, screenWidth - dp(12), yTop + dp(24))
        val marker = object : View(activity) {
            override fun onDraw(canvas: Canvas) {
                val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; strokeWidth = dp(1).toFloat() }
                canvas.drawLine(0f, height / 2f, width.toFloat(), height / 2f, p)
                p.color = Color.WHITE
                canvas.drawRect(0f, 0f, dp(110).toFloat(), height.toFloat(), p)
                p.color = Color.BLACK; p.textSize = dp(13).toFloat()
                canvas.drawText(if (style.tool == "canvas") "Writing space" else "Sticky note", dp(4).toFloat(), height * .7f, p)
            }
        }
        marker.measure(View.MeasureSpec.makeMeasureSpec(guideRect.width(), View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(guideRect.height(), View.MeasureSpec.EXACTLY))
        marker.layout(0, 0, guideRect.width(), guideRect.height())
        guide = PopupWindow(marker, guideRect.width(), guideRect.height(), false).apply {
            isTouchable = false
            showAtLocation(activity.window.decorView, Gravity.LEFT or Gravity.TOP, guideRect.left, guideRect.top)
        }
        dirty.union(guideRect); chromeChanged(dirty)
    }
    fun hidePlacementGuide() {
        if (guide == null) return
        val dirty = Rect(guideRect); guide?.dismiss(); guide = null; guideRect.setEmpty()
        if (ready) chromeChanged(dirty)
    }
    fun showTrail(x: Float, y: Float) {
        if (style.tool != "eraser" || style.eraser == "range" || !style.trail) return
        val diameter = (2f * max(3f, style.width)).toInt().coerceAtLeast(1)
        val left = x.toInt() - diameter / 2; val yTop = y.toInt() - diameter / 2
        if (trail?.isShowing == true) { trail?.update(left, yTop, diameter, diameter); return }
        val marker = View(activity).apply { background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL; setColor(Color.TRANSPARENT); setStroke(dp(1), Color.DKGRAY)
        } }
        trail = PopupWindow(marker, diameter, diameter, false).apply {
            isTouchable = false; showAtLocation(activity.window.decorView, Gravity.LEFT or Gravity.TOP, left, yTop)
        }
    }
    fun hideTrail() { trail?.dismiss(); trail = null }
    fun close() {
        activity.window.decorView.removeOnLayoutChangeListener(layoutListener)
        ready = false; penTarget = null; hidePlacementGuide(); hideTrail(); noteHeader?.dismiss(); noteHeader = null; panel?.dismiss(); panel = null; rail?.dismiss(); rail = null
        railRect.setEmpty(); panelRect.setEmpty(); exclusion(Rect())
    }
}
