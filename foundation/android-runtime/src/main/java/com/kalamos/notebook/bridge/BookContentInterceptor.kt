package com.kalamos.notebook.bridge

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.kalamos.notebook.bookfmt.EpubManager
import com.kalamos.notebook.bookfmt.PdfRenderService
import com.kalamos.notebook.storage.StorageManager
import java.io.ByteArrayInputStream
import java.io.FileInputStream

/**
 * `shouldInterceptRequest` backend for the `https://kalamos.content/` virtual host (AD-3):
 * streams rendered PDF page bitmaps and EPUB zip entries straight into `<img>`/`<link>` tags in the
 * reader DOM, instead of round-tripping a base64 `data:` URL through the JS bridge for every asset.
 * This is the PRIMARY path per AD-3; the `pdfPageDataUrl` / `epubAssetDataUrl` bridge methods remain
 * wired as a fallback for WebView builds where `shouldInterceptRequest` misbehaves (device-side
 * behavior is UNVERIFIED — no device was attached for WP6's planned interception spike, see WP13)
 * and as the only path available to the plain browser preview (`server.py`, no WebView at all).
 *
 * URL shapes (host must be exactly `kalamos.content`):
 * - `/pdf/<nbId>/<pageIndex>.png?w=<px>&e=<0-100>&d=<0-100>&crop=<l,t,r,b pct>` — `w`/`e`/`d`/`crop`
 *   are all optional; see [PdfRenderService.renderPage] for defaults.
 * - `/epub/<nbId>/<zip-relative-path>` — streams one EPUB zip entry (image/font/css/xhtml) as-is.
 *
 * Anything else (wrong host, too few path segments, unknown first segment) returns null so the
 * caller falls back to the WebView's default request handling.
 */
object BookContentInterceptor {

    private const val HOST = "kalamos.content"

    fun intercept(request: WebResourceRequest, storage: StorageManager?): WebResourceResponse? {
        if (storage == null) return null
        val url = request.url ?: return null
        if (!url.host.equals(HOST, ignoreCase = true)) return null
        val segments = url.pathSegments ?: return null
        if (segments.size < 3) return null

        return try {
            when (segments[0]) {
                "pdf" -> interceptPdf(segments, url, storage)
                "epub" -> interceptEpub(segments, storage)
                "nbasset" -> interceptNotebookAsset(segments, storage)
                else -> null
            }
        } catch (e: Exception) {
            null
        }
    }

    /** `/pdf/<nbId>/<pageIndex>.png?w=&e=&d=&crop=` -> the cached WEBP render, streamed from disk.
     *  Content-Type is `image/webp` regardless of the `.png` URL suffix (kept `.png` only so plain
     *  `<img>` tags / dumb caches treat it as an image without sniffing). */
    private fun interceptPdf(
        segments: List<String>,
        url: android.net.Uri,
        storage: StorageManager
    ): WebResourceResponse? {
        val nbId = segments[1]
        val pageIndex = segments[2].substringBefore('.').toIntOrNull() ?: return null
        val w = url.getQueryParameter("w")?.toIntOrNull() ?: 1264
        val e = url.getQueryParameter("e")?.toIntOrNull() ?: 0
        val d = url.getQueryParameter("d")?.toIntOrNull() ?: 0
        val crop = url.getQueryParameter("crop") ?: ""
        val cacheFile = PdfRenderService.renderPage(nbId, pageIndex, w, e, d, crop, storage) ?: return null
        return WebResourceResponse(
            "image/webp",
            null,
            200,
            "OK",
            mapOf(
                "Cache-Control" to "private, max-age=31536000, immutable",
                "Content-Length" to cacheFile.length().toString()
            ),
            FileInputStream(cacheFile)
        )
    }

    /** `/epub/<nbId>/<zipPath>` (zipPath may itself contain `/`) -> the raw zip entry bytes, mime
     *  guessed from its extension. */
    private fun interceptEpub(segments: List<String>, storage: StorageManager): WebResourceResponse? {
        val nbId = segments[1]
        val zipPath = segments.drop(2).joinToString("/")
        val bytes = EpubManager.entryBytes(nbId, zipPath, storage) ?: return null
        return WebResourceResponse(EpubManager.mimeForPath(zipPath), null, ByteArrayInputStream(bytes))
    }

    /** `/nbasset/<nbId>/<relPath>` (relPath may contain `/`, e.g. `assets/fig12.webp`) -> the book
     *  folder's asset file, streamed straight from disk. The interactive-book reader reserves each
     *  image's exact box up front (AndroidBridge.getNotebookAssetDims) and then loads pixels through
     *  this route asynchronously — so images cost ~nothing on the synchronous open path AND cannot
     *  shift the layout when they arrive. */
    private fun interceptNotebookAsset(segments: List<String>, storage: StorageManager): WebResourceResponse? {
        val nbId = segments[1]
        val relPath = segments.drop(2).joinToString("/")
        val f = storage.notebookAssetFile(nbId, relPath) ?: return null
        return WebResourceResponse(
            mimeForAsset(relPath),
            null,
            200,
            "OK",
            mapOf(
                "Cache-Control" to "private, max-age=31536000, immutable",
                "Content-Length" to f.length().toString()
            ),
            FileInputStream(f)
        )
    }

    private fun mimeForAsset(path: String): String =
        when (path.substringAfterLast('.').lowercase()) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "svg" -> "image/svg+xml"
            else -> "application/octet-stream"
        }
}
