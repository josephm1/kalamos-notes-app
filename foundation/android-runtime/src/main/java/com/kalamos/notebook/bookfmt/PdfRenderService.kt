package com.kalamos.notebook.bookfmt

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.ParcelFileDescriptor
import com.kalamos.notebook.storage.StorageManager
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

/**
 * PDF rendering backend (AD-2/AD-3/AD-9): renders `books/<id>/book.pdf` pages with
 * [android.graphics.pdf.PdfRenderer]. PdfRenderer (and its Page/session state) is **not
 * thread-safe**, so every open/render/close for every notebook is funnelled through one dedicated
 * single-thread [executor] — callers never need their own locking, they just get blocked (briefly)
 * until their turn on that thread.
 *
 * Output is always a white-filled `RGB_565` bitmap (width capped at [MAX_WIDTH_PX]), a Matrix
 * scale+translate implementing the crop-then-fit AD-3 contract, a native e-ink `embolden`/
 * `darkEnhance` [ColorMatrix] pass, then a WEBP encode into `books/<id>/.cache/` keyed by
 * page index + a hash of the render params — so re-opening the same page/crop/contrast combo is a
 * cache hit (an immediate file read, no PdfRenderer round-trip). The cache directory is LRU-evicted
 * (oldest `lastModified` first) to stay under [CACHE_BUDGET_BYTES].
 *
 * Two callers reach this: [com.kalamos.notebook.bridge.BookContentInterceptor] (the primary path —
 * a `shouldInterceptRequest` virtual host streams the cache file straight into an `<img>`) and the
 * `pdfPageDataUrl` bridge method (a base64 `data:` URL fallback for WebView builds where the
 * interceptor misbehaves, and the only path available to the plain browser preview). Both end up
 * reading/writing the exact same `.cache/` file, so whichever path warms the cache first makes the
 * other instant too.
 *
 * Text (outline/page text/search/article-mode) is a separate, app-owned seam — see
 * [PdfTextService] — PdfRenderer itself only knows how to rasterize pages.
 */
object PdfRenderService {

    private const val MAX_WIDTH_PX = 2048
    private const val MAX_HEIGHT_PX = 4096
    private const val MIN_WIDTH_PX = 64
    private const val CACHE_BUDGET_BYTES = 60L * 1024 * 1024

    /** All PdfRenderer access happens here, and only here (AD-2/AD-3: PdfRenderer isn't
     *  thread-safe). Daemon so it never blocks process exit. */
    private val executor: ExecutorService =
        Executors.newSingleThreadExecutor { r -> Thread(r, "PdfRenderService").apply { isDaemon = true } }

    private class Session(val pfd: ParcelFileDescriptor, val renderer: PdfRenderer)

    /** Open PdfRenderer sessions, keyed by notebook id. Touched only from [executor]'s thread. */
    private val sessions = HashMap<String, Session>()

    private fun <T> onRenderThread(block: () -> T): T = executor.submit<T> { block() }.get()

    // ---- paths -------------------------------------------------------------------------------

    private fun bookFile(storage: StorageManager, nbId: String): File =
        File(storage.getBookPath(nbId), "book.pdf")

    private fun cacheDir(storage: StorageManager, nbId: String): File =
        File(storage.getBookPath(nbId), ".cache").also { it.mkdirs() }

    // ---- session lifecycle (render thread only) -----------------------------------------------

    /** Open (or re-open) `books/<id>/book.pdf`. Returns
     *  `'{"pages":N,"pageWidthPt":w,"pageHeightPt":h}'` (dimensions from page 0, in PDF points) or
     *  `"error: encrypted"` (password-protected -> [SecurityException]) / `"error: unreadable"`
     *  (missing file, zero pages, or any other parse failure). Safe to call repeatedly — always
     *  closes and re-opens fresh, so a stale/broken session never lingers. */
    fun open(nbId: String, storage: StorageManager): String = onRenderThread {
        closeLocked(nbId)
        var pfd: ParcelFileDescriptor? = null
        try {
            val file = bookFile(storage, nbId)
            if (!file.isFile) return@onRenderThread "error: unreadable"
            pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            val renderer = PdfRenderer(pfd)
            if (renderer.pageCount <= 0) {
                renderer.close(); pfd.close()
                return@onRenderThread "error: unreadable"
            }
            sessions[nbId] = Session(pfd, renderer)
            val page = renderer.openPage(0)
            val w = page.width
            val h = page.height
            page.close()
            "{\"pages\":${renderer.pageCount},\"pageWidthPt\":$w,\"pageHeightPt\":$h}"
        } catch (e: SecurityException) {
            try { pfd?.close() } catch (ignored: Exception) {}
            "error: encrypted"
        } catch (e: Exception) {
            try { pfd?.close() } catch (ignored: Exception) {}
            "error: unreadable"
        }
    }

    /** Close the notebook's open PdfRenderer session (reader leaving the book). A no-op if it
     *  wasn't open. */
    fun close(nbId: String) {
        onRenderThread { closeLocked(nbId) }
    }

    private fun closeLocked(nbId: String) {
        sessions.remove(nbId)?.let {
            try { it.renderer.close() } catch (ignored: Exception) {}
            try { it.pfd.close() } catch (ignored: Exception) {}
        }
    }

    // ---- page rendering ------------------------------------------------------------------------

    /** Render page [pageIndex] (0-based) at width [wPx] px (capped to [MIN_WIDTH_PX]..[MAX_WIDTH_PX]),
     *  applying [cropLTRBpctCsv] (four comma-separated 0-100 margin percentages "l,t,r,b";
     *  blank/malformed -> zero margins/full page) and the [embolden]/[darkEnhance] (each 0-100) native
     *  contrast passes (AD-3). Returns the cached WEBP [File] (rendering + encoding only happens
     *  once per distinct param combo; repeat calls are a cache-hit file lookup) or null if the PDF
     *  can't be opened / the page index is out of range / encoding fails. */
    fun renderPage(
        nbId: String,
        pageIndex: Int,
        wPx: Int,
        embolden: Int,
        darkEnhance: Int,
        cropLTRBpctCsv: String,
        storage: StorageManager
    ): File? = onRenderThread {
        try {
            val cappedW = wPx.coerceIn(MIN_WIDTH_PX, MAX_WIDTH_PX)
            val boundedEmbolden = embolden.coerceIn(0, 100)
            val boundedDark = darkEnhance.coerceIn(0, 100)
            val crop = normalizeCropMargins(cropLTRBpctCsv)

            val dir = cacheDir(storage, nbId)
            val hash = paramHash(cappedW, boundedEmbolden, boundedDark, crop)
            val cacheFile = File(dir, "p$pageIndex-$hash.webp")
            if (cacheFile.isFile && cacheFile.length() > 0L) {
                cacheFile.setLastModified(System.currentTimeMillis())  // LRU: mark as recently used
                return@onRenderThread cacheFile
            }

            val session = ensureOpenLockedInline(nbId, storage) ?: return@onRenderThread null
            if (pageIndex < 0 || pageIndex >= session.renderer.pageCount) return@onRenderThread null

            val page = session.renderer.openPage(pageIndex)
            val rendered = try {
                renderPageBitmap(page, cappedW, crop)
            } finally {
                page.close()
            }
            val processedArgb = applyContrast(rendered, boundedEmbolden, boundedDark)
            val processed = toEink565(processedArgb)

            val tmp = File(dir, cacheFile.name + ".tmp")
            FileOutputStream(tmp).use { out ->
                val fmt = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY
                          else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
                processed.compress(fmt, 80, out)
            }
            processed.recycle()
            if (!tmp.renameTo(cacheFile)) {
                tmp.delete()
                return@onRenderThread null
            }
            evictCache(dir)
            cacheFile
        } catch (e: Exception) {
            null
        }
    }

    /** [renderPage] calls this from inside its own render-thread block — must NOT resubmit to
     *  [executor] (that would deadlock: the single worker thread would be waiting on itself). */
    private fun ensureOpenLockedInline(nbId: String, storage: StorageManager): Session? {
        sessions[nbId]?.let { return it }
        return try {
            closeLocked(nbId)
            val file = bookFile(storage, nbId)
            if (!file.isFile) return null
            val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            val renderer = try { PdfRenderer(pfd) } catch (e: Exception) { pfd.close(); return null }
            if (renderer.pageCount <= 0) { renderer.close(); pfd.close(); return null }
            val session = Session(pfd, renderer)
            sessions[nbId] = session
            session
        } catch (e: Exception) {
            null
        }
    }

    /** Cover hook for [CoverManager]'s "pdf" branch: renders page 0 at a small portrait width
     *  (~360px, natural page aspect — usually close to 360x480 for a typical book-trim PDF), full
     *  page (no crop), no contrast processing (covers stay true bitmap tone). Returns a fresh,
     *  un-cached [Bitmap] — the caller owns it ([CoverManager] fits/desaturates it, encodes to
     *  `thumbnails/<id>.png` via `StorageManager.saveThumbnailBytes`, then recycles it) — or null
     *  if the PDF can't be opened. */
    fun renderCover(nbId: String, storage: StorageManager): Bitmap? = onRenderThread {
        try {
            val session = ensureOpenLockedInline(nbId, storage) ?: return@onRenderThread null
            if (session.renderer.pageCount <= 0) return@onRenderThread null
            val page = session.renderer.openPage(0)
            try {
                renderPageBitmap(page, 360, "0,0,0,0")
            } finally {
                page.close()
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Core crop-then-fit rasterization shared by [renderPage] and [renderCover]: parses
     *  [cropLTRBpctCsv] as margins from each page edge, converts them to a page-space rect, sizes
     *  the output bitmap to [outWidthPx] wide at the crop's aspect ratio, and builds the
     *  translate+scale [Matrix] PdfRenderer needs to map that crop region onto the full output
     *  bitmap. White-filled ARGB_8888 — [PdfRenderer.Page.render] only accepts ARGB_8888 /
     *  RGBA_F16, so the e-ink RGB_565 form is produced later (just before WEBP encode) by
     *  [toEink565]; a Matrix rounding sliver at the edge still reads as page-white, not black.
     *  Must run on [executor]'s thread (called only from within an already-dispatched block). */
    private fun renderPageBitmap(page: PdfRenderer.Page, outWidthPx: Int, cropLTRBpctCsv: String): Bitmap {
        val parts = cropLTRBpctCsv.split(",").map { it.trim().toFloatOrNull() ?: 0f }
        val lp = parts.getOrElse(0) { 0f }.coerceIn(0f, 100f)
        val tp = parts.getOrElse(1) { 0f }.coerceIn(0f, 100f)
        val rp = parts.getOrElse(2) { 0f }.coerceIn(0f, 100f)
        val bp = parts.getOrElse(3) { 0f }.coerceIn(0f, 100f)

        val pageW = page.width.toFloat()
        val pageH = page.height.toFloat()
        val cropLeft = (lp / 100f) * pageW
        val cropTop = (tp / 100f) * pageH
        val cropRight = ((100f - rp) / 100f) * pageW
        val cropBottom = ((100f - bp) / 100f) * pageH
        val cropW = (cropRight - cropLeft).coerceAtLeast(1f)
        val cropH = (cropBottom - cropTop).coerceAtLeast(1f)

        val outW = outWidthPx.coerceAtLeast(1)
        val outH = (outW * (cropH / cropW)).toInt().coerceIn(1, MAX_HEIGHT_PX)
        val sx = outW / cropW
        val sy = outH / cropH

        val bitmap = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)
        val matrix = Matrix()
        matrix.postTranslate(-cropLeft, -cropTop)
        matrix.postScale(sx, sy)
        page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        return bitmap
    }

    /** Canonicalize edge margins and guarantee at least 5% of the page remains visible on each
     *  axis. The UI only offers 0..40 per edge, while column-split mode legitimately produces
     *  larger single-edge margins, so the pairwise visible-area guard is the important invariant. */
    private fun normalizeCropMargins(csv: String): String {
        val p = csv.split(",")
        fun marginAt(index: Int): Float {
            val value = p.getOrNull(index)?.trim()?.toFloatOrNull() ?: 0f
            return if (value.isFinite()) value.coerceIn(0f, 95f) else 0f
        }
        var l = marginAt(0)
        var t = marginAt(1)
        var r = marginAt(2)
        var b = marginAt(3)
        if (l + r > 95f) r = 95f - l
        if (t + b > 95f) b = 95f - t
        return "$l,$t,$r,$b"
    }

    /** Convert to RGB_565 (e-ink: 16-bit, no dithering artifact from a 32-bit cache) right before
     *  WEBP encode. [PdfRenderer] can't write 565 directly, so we render in 8888 and downsample here;
     *  on API < 30 we still encode WEBP (deprecated constant, lossy) from the 565 buffer. */
    private fun toEink565(src: Bitmap): Bitmap {
        if (src.config == Bitmap.Config.RGB_565) return src
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.RGB_565)
        val canvas = Canvas(out)
        canvas.drawBitmap(src, 0f, 0f, Paint(Paint.ANTI_ALIAS_FLAG))
        if (src != out) src.recycle()
        return out
    }

    /** Native e-ink contrast processing (AD-3). [embolden] (0-100) is a gamma-down/threshold pass
     *  toward black: rising contrast + a darkening bias so thin PDF glyph strokes (which anti-alias
     *  to light gray at small sizes) read heavier on the e-ink panel. [darkEnhance] (0-100) is a
     *  second, stronger contrast stretch aimed at dark grays specifically (scanned-page shadows/
     *  background tint) crushing them toward black while leaving paper-white alone. Both 0 -> [src]
     *  is returned unchanged (no extra allocation/copy). Otherwise a new bitmap is returned and
     *  [src] is recycled. */
    private fun applyContrast(src: Bitmap, embolden: Int, darkEnhance: Int): Bitmap {
        if (embolden <= 0 && darkEnhance <= 0) return src
        val cm = ColorMatrix()
        if (embolden > 0) {
            val f = embolden / 100f
            val contrast = 1f + f * 3f   // up to ~4x contrast
            val bias = -f * 50f          // shift midtones toward black
            cm.postConcat(ColorMatrix(floatArrayOf(
                contrast, 0f, 0f, 0f, bias,
                0f, contrast, 0f, 0f, bias,
                0f, 0f, contrast, 0f, bias,
                0f, 0f, 0f, 1f, 0f
            )))
        }
        if (darkEnhance > 0) {
            val f = darkEnhance / 100f
            val contrast = 1f + f * 2f   // extra stretch focused on dark grays
            val bias = -f * 70f
            cm.postConcat(ColorMatrix(floatArrayOf(
                contrast, 0f, 0f, 0f, bias,
                0f, contrast, 0f, 0f, bias,
                0f, 0f, contrast, 0f, bias,
                0f, 0f, 0f, 1f, 0f
            )))
        }
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { colorFilter = ColorMatrixColorFilter(cm) }
        canvas.drawBitmap(src, 0f, 0f, paint)
        src.recycle()
        return out
    }

    // ---- cache ---------------------------------------------------------------------------------

    private fun paramHash(wPx: Int, embolden: Int, darkEnhance: Int, crop: String): String {
        // v2 changed crop values from absolute right/bottom coordinates to edge margins.
        val key = "v2|$wPx|$embolden|$darkEnhance|$crop"
        return Integer.toHexString(key.hashCode())
    }

    /** Delete oldest-`lastModified`-first cache files until [dir]'s total size is back under
     *  [CACHE_BUDGET_BYTES]. Called after every fresh render, so the cache never grows unbounded
     *  across a long reading session or many different crop/contrast combos. */
    private fun evictCache(dir: File) {
        val files = dir.listFiles { f -> f.isFile } ?: return
        var total = files.sumOf { it.length() }
        if (total <= CACHE_BUDGET_BYTES) return
        for (f in files.sortedBy { it.lastModified() }) {
            if (total <= CACHE_BUDGET_BYTES) break
            total -= f.length()
            f.delete()
        }
    }
}
