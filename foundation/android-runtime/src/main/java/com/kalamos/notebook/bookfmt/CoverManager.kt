package com.kalamos.notebook.bookfmt

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import com.kalamos.notebook.storage.StorageManager
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Cover pipeline (AD-6/WP2): backfills `thumbnails/<id>.png` for book notebooks so the existing
 * library-card thumbnail path ([StorageManager.getThumbnailDataUrl]) "just works" for EPUB/PDF/
 * blocks books exactly like it already does for hand-written notebooks (ink `captureThumbnail`).
 *
 * [ensure] is idempotent and safe to call from any (background) thread repeatedly — e.g. once per
 * grid render via the `ensureCovers` bridge method — because a cheap file-exists check makes every
 * call after the first a no-op. Source priority (checked in order, first hit wins):
 *  1. `meta.coverPath` — an explicit cover file under the notebook dir, any format.
 *  2. Blocks books (`meta.format == "blocks"`/`"blocks-v1"`, or no `format` but a `bookRef`):
 *     `manifest.json`'s `cover` field -> `assets/page-001.webp` -> the first `type:"image"` block
 *     found in the first 1-2 spine sections' JSON (block `src` is relative to `assets/`).
 *  3. EPUB (`meta.format == "epub"`): [EpubManager.extractCover] (OPF-declared cover image).
 *  4. PDF (`meta.format == "pdf"`): [PdfRenderService.renderCover] (page 0, no crop/contrast).
 * The chosen bitmap is fit (never cropped) into a ~360x480 portrait canvas on a white background,
 * with its original color preserved for color e-ink panels, PNG-encoded, and written via
 * [StorageManager.saveThumbnailBytes].
 */
object CoverManager {

    private const val TARGET_W = 360
    private const val TARGET_H = 480
    private const val COLOR_MARKER = ".cache/cover-color-v1"

    /** Ensure `thumbnails/<nbId>.png` exists, generating it from the best available source if not.
     *  Returns true if a thumbnail exists afterwards (already there, or freshly generated), false
     *  if there's no eligible cover source (e.g. a plain ink notebook) or generation failed. */
    fun ensure(nbId: String, storage: StorageManager): Boolean {
        if (storage.getThumbnailPath(nbId).isNotEmpty() && storage.getBookFile(nbId, COLOR_MARKER) == "1") return true
        return try {
            val metaRaw = storage.peekMetaRaw(nbId) ?: storage.loadMetaRaw(nbId) ?: return false
            val meta = JSONObject(metaRaw)
            val dir = File(storage.getBookPath(nbId))

            val bitmap = coverFromMetaPath(dir, meta) ?: coverForFormat(nbId, meta, dir, storage) ?: return false
            val framed = frameColor(bitmap)
            val bytes = ByteArrayOutputStream().also { framed.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            framed.recycle()
            val saved = storage.saveThumbnailBytes(nbId, bytes)
            if (saved) storage.saveBookFile(nbId, COLOR_MARKER, "1")
            saved
        } catch (e: Exception) {
            false
        }
    }

    private fun coverForFormat(nbId: String, meta: JSONObject, dir: File, storage: StorageManager): Bitmap? {
        val format = meta.optString("format", "")
        val hasBookRef = meta.optString("bookRef", "").isNotBlank()
        return when {
            format == "epub" -> EpubManager.extractCover(nbId, storage)
            format == "pdf" -> PdfRenderService.renderCover(nbId, storage)
            format == "blocks" || format.startsWith("blocks-") ||
                (format.isBlank() && hasBookRef) -> coverFromBlocks(nbId, meta, dir, storage)
            else -> null   // plain ink notebook (or an unrecognized format) — nothing to generate
        }
    }

    // ---- blocks books ---------------------------------------------------------------------------

    private fun coverFromBlocks(nbId: String, meta: JSONObject, dir: File, storage: StorageManager): Bitmap? {
        val manifestRaw = storage.getBookFile(nbId, "manifest.json")
        if (manifestRaw != null) {
            try {
                val cover = JSONObject(manifestRaw).optString("cover", "")
                if (cover.isNotBlank()) {
                    decodeNotebookAsset(dir, cover)?.let { return it }
                }
            } catch (e: Exception) { /* malformed manifest — fall through to the next source */ }
        }
        decodeNotebookAsset(dir, "assets/page-001.webp")?.let { return it }
        val blockAsset = findFirstImageBlockAsset(nbId, storage, manifestRaw)
        if (blockAsset != null) decodeNotebookAsset(dir, blockAsset)?.let { return it }
        return textCoverFromBlocks(nbId, storage, manifestRaw, meta.optString("title", ""))
    }

    /** Scan the first 1-2 spine sections' block JSON for the first `type:"image"` block, returning
     *  its asset path relative to the notebook dir. Both contract forms are supported: current
     *  packages store `src:"assets/name.webp"`, while older packages stored `src:"name.webp"`.
     *  null if there's no manifest/spine, no readable section, or no image block. */
    private fun findFirstImageBlockAsset(nbId: String, storage: StorageManager, manifestRaw: String?): String? {
        if (manifestRaw == null) return null
        val spine = try { JSONObject(manifestRaw).optJSONArray("spine") } catch (e: Exception) { null } ?: return null
        val limit = minOf(2, spine.length())
        for (i in 0 until limit) {
            val sid = spine.optJSONObject(i)?.optString("sectionId", "") ?: ""
            if (sid.isBlank()) continue
            val sectionRaw = storage.getBookFile(nbId, "sections/$sid.json") ?: continue
            try {
                val blocks = JSONObject(sectionRaw).optJSONArray("blocks") ?: continue
                for (j in 0 until blocks.length()) {
                    val b = blocks.optJSONObject(j) ?: continue
                    if (b.optString("type") == "image") {
                        val src = b.optString("src", "")
                        blocksAssetPath(src)?.let { return it }
                    }
                }
            } catch (e: Exception) { /* try the next section */ }
        }
        return null
    }

    /** Normalize the two supported blocks image-path forms without rewriting either package.
     *  Decoding still applies the canonical-path containment check below. */
    internal fun blocksAssetPath(src: String): String? {
        val clean = src.trim().removePrefix("./")
        if (clean.isBlank()) return null
        return if (clean.startsWith("assets/")) clean else "assets/$clean"
    }

    /** Use the authored opening text as a truthful fallback when a reflow package has no cover
     *  image. This is deliberately limited to the first spine section rather than arbitrary body
     *  prose, and leaves EPUB/PDF handling unchanged. */
    private fun textCoverFromBlocks(
        nbId: String,
        storage: StorageManager,
        manifestRaw: String?,
        fallbackTitle: String
    ): Bitmap? {
        val manifest = try { manifestRaw?.let(::JSONObject) } catch (_: Exception) { null }
        val firstSectionId = manifest?.optJSONArray("spine")?.optJSONObject(0)
            ?.optString("sectionId", "").orEmpty()
        val sectionRaw = firstSectionId.takeIf { it.isNotBlank() }
            ?.let { storage.getBookFile(nbId, "sections/$it.json") }
        val authored = openingTextFromSection(sectionRaw)
        val groups = if (authored.isNotEmpty()) authored else listOfNotNull(
            fallbackTitle.trim().takeIf { it.isNotEmpty() }
        )
        if (groups.isEmpty()) return null
        return renderTextCover(groups)
    }

    internal fun openingTextFromSection(sectionRaw: String?): List<String> {
        if (sectionRaw.isNullOrBlank()) return emptyList()
        return try {
            val blocks = JSONObject(sectionRaw).optJSONArray("blocks") ?: return emptyList()
            val result = mutableListOf<String>()
            var characters = 0
            for (i in 0 until blocks.length()) {
                val block = blocks.optJSONObject(i) ?: continue
                if (block.optString("type") != "text") continue
                val raw = block.optString("md", block.optString("content", block.optString("text", "")))
                val clean = raw
                    .replace(Regex("(?m)^\\s*#{1,6}\\s*"), "")
                    .replace(Regex("<[^>]+>"), " ")
                    .replace(Regex("[ \\t]+"), " ")
                    .replace(Regex("\\n{3,}"), "\n\n")
                    .trim()
                if (clean.isEmpty()) continue
                val remaining = 420 - characters
                if (remaining <= 0) break
                val clipped = if (clean.length > remaining) clean.take(maxOf(1, remaining - 1)).trimEnd() + "…" else clean
                result += clipped
                characters += clipped.length
                if (result.size == 4) break
            }
            result
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun renderTextCover(groups: List<String>): Bitmap {
        val out = Bitmap.createBitmap(TARGET_W, TARGET_H, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.WHITE)
        val border = Paint(Paint.ANTI_ALIAS_FLAG).also {
            it.color = Color.BLACK
            it.style = Paint.Style.STROKE
            it.strokeWidth = 2f
        }
        canvas.drawRect(13f, 13f, TARGET_W - 13f, TARGET_H - 13f, border)

        val paints = groups.mapIndexed { index, _ ->
            Paint(Paint.ANTI_ALIAS_FLAG).also {
                it.color = Color.BLACK
                it.textAlign = Paint.Align.CENTER
                it.typeface = if (index == 0) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                it.textSize = if (index == 0) 27f else if (index == groups.lastIndex) 15f else 17f
            }
        }
        val rawLayout = groups.mapIndexed { index, group ->
            val paint = paints[index]
            group.lines().flatMap { wrapCoverLine(it, paint, TARGET_W - 64f) }
        }
        var remainingLines = 14
        val laidOut = rawLayout.map { lines ->
            if (remainingLines <= 0) return@map emptyList()
            val visible = lines.take(remainingLines).toMutableList()
            remainingLines -= visible.size
            if (visible.size < lines.size && visible.isNotEmpty()) {
                visible[visible.lastIndex] = visible.last().trimEnd('…') + "…"
            }
            visible
        }
        val heights = laidOut.mapIndexed { index, lines -> lines.size * (paints[index].textSize * 1.25f) }
        val gaps = maxOf(0, laidOut.size - 1) * 17f
        val totalHeight = heights.sum() + gaps
        var y = maxOf(42f, (TARGET_H - totalHeight) / 2f)
        laidOut.forEachIndexed { index, lines ->
            val paint = paints[index]
            val step = paint.textSize * 1.25f
            lines.forEach { line ->
                y += step
                canvas.drawText(line, TARGET_W / 2f, y, paint)
            }
            y += 17f
        }
        return out
    }

    private fun wrapCoverLine(raw: String, paint: Paint, width: Float): List<String> {
        val words = raw.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return listOf("")
        val lines = mutableListOf<String>()
        var current = ""
        for (word in words) {
            val candidate = if (current.isEmpty()) word else "$current $word"
            if (current.isNotEmpty() && paint.measureText(candidate) > width) {
                lines += current
                current = word
            } else {
                current = candidate
            }
        }
        if (current.isNotEmpty()) lines += current
        return lines
    }

    // ---- shared helpers ---------------------------------------------------------------------------

    private fun coverFromMetaPath(dir: File, meta: JSONObject): Bitmap? {
        val coverPath = meta.optString("coverPath", "")
        if (coverPath.isBlank() || coverPath == "null") return null   // JSON null -> optString("null")
        return decodeNotebookAsset(dir, coverPath)
    }

    /** Decode an image file at [relPath] under the notebook [dir], refusing to resolve outside it
     *  (mirrors [StorageManager.getBookFile]'s `..`-traversal guard). null if missing/undecodable. */
    private fun decodeNotebookAsset(dir: File, relPath: String): Bitmap? {
        return try {
            val root = dir.canonicalFile
            val f = File(root, relPath).canonicalFile
            if (!f.path.startsWith(root.path) || !f.isFile) return null
            val bounds = BitmapFactory.Options().also { it.inJustDecodeBounds = true }
            BitmapFactory.decodeFile(f.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val options = BitmapFactory.Options().also {
                it.inSampleSize = coverSampleSize(bounds.outWidth, bounds.outHeight)
            }
            BitmapFactory.decodeFile(f.absolutePath, options)
        } catch (e: Exception) { null }
    }

    /** Decode close to the final cover size instead of materializing the source at full resolution.
     *  Some converted PDFs retain a truthful full-page raster (for example 20,000 x 30,000 px),
     *  which would otherwise require gigabytes of heap before [frameColor] can scale it down. */
    internal fun coverSampleSize(width: Int, height: Int): Int {
        if (width <= 0 || height <= 0) return 1
        var sample = 1
        while (sample <= Int.MAX_VALUE / 2) {
            val next = sample * 2
            if (width / next < TARGET_W && height / next < TARGET_H) break
            sample = next
        }
        return sample
    }

    /** Fit [src] (never cropped) into a ~360x480 portrait canvas while preserving its source color.
     *  Recycles [src]. */
    private fun frameColor(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(TARGET_W, TARGET_H, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.WHITE)
        val scale = minOf(TARGET_W.toFloat() / src.width, TARGET_H.toFloat() / src.height)
        val w = src.width * scale
        val h = src.height * scale
        val left = (TARGET_W - w) / 2f
        val top = (TARGET_H - h) / 2f
        val dst = RectF(left, top, left + w, top + h)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(src, null, dst, paint)
        src.recycle()
        return out
    }
}
