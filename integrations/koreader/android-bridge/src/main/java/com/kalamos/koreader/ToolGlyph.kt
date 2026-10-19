package com.kalamos.koreader

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/** Resolution-independent toolbar artwork; no font glyphs or platform button chrome. */
internal class ToolGlyph(context: Context, private val glyph: String,
    private val active: Boolean = false, private val swatch: Int? = null,
    private val weight: Float = 2f, private val label: String? = null) : View(context) {
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val c = canvas
        c.drawColor(if (active && swatch == null) Color.BLACK else Color.WHITE)
        val size = kotlin.math.min(width, height).toFloat()
        val save = c.save()
        c.translate((width - size) / 2f, (height - size) / 2f)
        c.scale(size / 36f, size / 36f)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (active && swatch == null) Color.WHITE else Color.BLACK
            strokeWidth = 1.5f; style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
        }
        fun line(vararg xy: Float) {
            val path = Path(); path.moveTo(xy[0], xy[1])
            for (i in 2 until xy.size step 2) path.lineTo(xy[i], xy[i + 1])
            c.drawPath(path, p)
        }
        val caption = label ?: if (glyph == "canvas") "Canvas" else if (glyph == "sticky") "Note" else null
        val art = c.save()
        if (caption != null) { c.translate(5f, 0f); c.scale(.72f, .72f) }
        when {
            swatch != null -> {
                p.style = Paint.Style.FILL; p.color = swatch; c.drawCircle(18f, 18f, 7f, p)
                p.style = Paint.Style.STROKE; p.color = Color.BLACK; p.strokeWidth = .65f
                c.drawCircle(18f, 18f, 7f, p)
                if (active) { p.strokeWidth = 1.2f; c.drawCircle(18f, 18f, 10f, p) }
            }
            glyph == "width" -> {
                p.strokeWidth = weight
                val path = Path().apply { moveTo(8f, 23f); cubicTo(25f, 4f, 8f, 29f, 27f, 12f) }
                c.drawPath(path, p)
            }
            glyph == "exit" -> {
                line(17f,8f,8f,8f,8f,28f,17f,28f)
                line(15f,18f,29f,18f); line(24f,13f,29f,18f,24f,23f)
            }
            glyph == "collapse" -> { c.drawCircle(18f, 18f, 14f, p); line(11f,21f,18f,14f,25f,21f) }
            glyph == "pen" || glyph == "brush" || glyph == "ballpoint" -> {
                line(10f,26f,12f,18f,23f,7f,29f,13f,18f,24f,10f,26f)
                line(12f,18f,18f,24f); line(21f,9f,27f,15f)
                if (glyph == "brush") line(10f,26f,7f,29f,15f,27f)
            }
            glyph == "highlighter" -> {
                line(11f,20f,20f,8f,29f,15f,20f,27f,11f,20f)
                line(12f,21f,10f,27f,16f,28f,19f,26f); line(17f,12f,26f,19f)
            }
            glyph == "eraser" || glyph == "pixel-eraser" -> {
                line(8f,22f,20f,9f,29f,17f,19f,28f,14f,28f,8f,22f)
                line(13f,16f,23f,24f); line(19f,28f,29f,28f)
                if (glyph == "pixel-eraser") {
                    c.drawRect(7f,27f,9f,29f,p); c.drawRect(10f,30f,12f,32f,p)
                }
            }
            glyph == "lasso" -> {
                p.pathEffect = DashPathEffect(floatArrayOf(2.5f, 2.5f), 0f)
                c.drawOval(7f, 9f, 28f, 26f, p); p.pathEffect = null
                line(23f,24f,25f,29f,28f,30f)
            }
            glyph == "sticky" -> {
                line(9f,8f,27f,8f,27f,21f,20f,28f,9f,28f,9f,8f)
                line(20f,28f,20f,21f,27f,21f)
            }
            glyph == "canvas" -> {
                line(8f,8f,28f,8f); line(8f,28f,28f,28f)
                c.drawRect(8f, 13f, 28f, 23f, p)
                line(15f,18f,21f,18f); line(18f,15f,18f,21f)
            }
            glyph == "page" -> {
                c.drawRect(9f, 7f, 27f, 29f, p)
                line(13f,12f,23f,12f); line(13f,16f,21f,16f)
                line(13f,24f,17f,20f,20f,23f,24f,19f)
            }
            glyph == "undo" || glyph == "redo" -> {
                if (glyph == "redo") { c.translate(36f,0f); c.scale(-1f,1f) }
                line(14f,9f,8f,15f,15f,15f)
                val path = Path().apply { moveTo(9f,15f); cubicTo(32f,8f,31f,30f,14f,28f) }
                c.drawPath(path,p)
            }
            glyph == "check" -> line(9f,18f,15f,24f,27f,11f)
            glyph == "close" -> { line(11f,11f,25f,25f); line(25f,11f,11f,25f) }
            else -> {
                p.style = Paint.Style.FILL
                for (y in listOf(10f,18f,26f)) c.drawCircle(18f,y,1.4f,p)
            }
        }
        c.restoreToCount(art)
        if (caption != null) {
            p.pathEffect = null; p.style = Paint.Style.FILL; p.textSize = 7.5f
            p.textAlign = Paint.Align.CENTER
            c.drawText(caption, 18f, 33f, p)
        }
        c.restoreToCount(save)
    }
}
