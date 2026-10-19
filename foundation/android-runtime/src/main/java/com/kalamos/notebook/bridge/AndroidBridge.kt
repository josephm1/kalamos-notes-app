package com.kalamos.notebook.bridge

import android.content.Intent
import android.graphics.Rect
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import com.kalamos.device.api.DeviceRegistry
import com.kalamos.notebook.bookfmt.CoverManager
import com.kalamos.notebook.bookfmt.EpubManager
import com.kalamos.notebook.bookfmt.PdfRenderService
import com.kalamos.notebook.storage.Notebook
import com.kalamos.notebook.storage.StorageManager
import java.util.concurrent.Executors

class AndroidBridge(
    private val fragment: Fragment,
    val storageManager: StorageManager,
    private val inkManager: InkManager? = null
) {

    @JavascriptInterface fun isInkSessionAttached(): Boolean = inkManager?.isInkSessionAttached() ?: false
    @JavascriptInterface fun isInkTraceEnabled(): Boolean = com.kalamos.device.api.ink.InkDiagnostics.enabled
    @JavascriptInterface fun traceInkEvent(name: String, json: String) { inkManager?.traceEvent(name, json) }
    @JavascriptInterface
    fun traceInkSession(notebookId: String, pageId: String, phase: String) {
        inkManager?.traceSession(notebookId, pageId, phase.take(64))
    }

    private val pdfTextLayoutExecutor = Executors.newSingleThreadExecutor()
    private val pdfMetadataExecutor = Executors.newSingleThreadExecutor()

    companion object {
        /** Shared pool for the batched book-file/asset reads: each file OPEN through the FUSE-backed
         *  /storage path costs ~70ms regardless of size, so a 15-entry batch read serially costs ~1s.
         *  Running the per-file reads in parallel collapses that to roughly the slowest few opens.
         *  Process-wide so delegate swaps don't churn threads. */
        private val batchIoPool = Executors.newFixedThreadPool(6)

        /** Run [work] over [relPathsJson]'s entries in parallel on [batchIoPool], collecting non-null
         *  results into a JSON object keyed by relPath. Order doesn't matter to callers. */
        private fun batchToJson(relPathsJson: String, work: (String) -> Any?): String {
            val out = org.json.JSONObject()
            try {
                val arr = org.json.JSONArray(relPathsJson)
                val tasks = (0 until arr.length()).mapNotNull { i ->
                    arr.optString(i, null)?.let { rel ->
                        java.util.concurrent.Callable { rel to work(rel) }
                    }
                }
                for (f in batchIoPool.invokeAll(tasks)) {
                    val (rel, v) = f.get()
                    if (v != null) out.put(rel, v)
                }
            } catch (e: Exception) { /* return whatever resolved before the failure */ }
            return out.toString()
        }
    }

    @JavascriptInterface
    fun saveLibrary(json: String): String {
        return try {
            val index = com.kalamos.notebook.storage.LibraryIndex.fromJson(org.json.JSONObject(json))
            if (storageManager.saveLibrary(index)) "ok" else "error: save failed"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    /** Full-screen reading: hide (true) / restore (false) the system status + navigation bars. Posted to
     *  the UI thread; the window work lives in MainActivity. Called by the book reader on open/close. */
    @JavascriptInterface
    fun setImmersive(on: Boolean) {
        val act = fragment.activity ?: return
        act.runOnUiThread {
            (act as? com.kalamos.notebook.MainActivity)?.setReaderImmersive(on)
        }
    }

    @JavascriptInterface
    fun loadLibrary(): String {
        return try {
            val index = storageManager.loadLibrary()
            index.toJson().toString()
        } catch (e: Exception) {
            "{}"
        }
    }

    /** Save one page's strokes ([json] = strokes array). Per-page storage: only the edited page is
     *  rewritten, not the whole notebook. */
    @JavascriptInterface
    fun savePage(notebookId: String, pageId: String, json: String): String {
        return try {
            if (storageManager.savePageRaw(notebookId, pageId, json)) "ok" else "error: save failed"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    /** Notebook meta (metadata + page list, no strokes) for lazy open — migrates on demand. */
    @JavascriptInterface
    fun loadMeta(notebookId: String): String {
        return try { storageManager.loadMetaRaw(notebookId) ?: "null" } catch (e: Exception) { "null" }
    }

    /** Meta WITHOUT migrating (library preload of already-migrated notebooks). "null" if not migrated. */
    @JavascriptInterface
    fun peekMeta(notebookId: String): String {
        return try { storageManager.peekMetaRaw(notebookId) ?: "null" } catch (e: Exception) { "null" }
    }

    /** Batch form of [peekMeta] for the visible library page. A JavascriptInterface crossing costs
     *  roughly 60ms on the target WebView even after the underlying file read is cached; rendering
     *  nine cards through nine calls therefore delays first paint by ~0.5s. One call plus the shared
     *  six-thread FUSE pool returns {notebookId: metaObject}. Missing/unreadable metas are omitted. */
    @JavascriptInterface
    fun peekMetas(notebookIdsJson: String): String =
        batchToJson(notebookIdsJson) { notebookId ->
            val raw = storageManager.peekMetaRaw(notebookId) ?: return@batchToJson null
            try { org.json.JSONObject(raw) } catch (e: Exception) { null }
        }

    /** One page's strokes (raw JSON array) for lazy load. */
    @JavascriptInterface
    fun loadPage(notebookId: String, pageId: String): String {
        return try { storageManager.loadPageRaw(notebookId, pageId) ?: "[]" } catch (e: Exception) { "[]" }
    }

    /** Save the notebook meta ([json] = metadata + page list); also vacuums deleted pages' files. */
    @JavascriptInterface
    fun saveMeta(notebookId: String, json: String): String {
        return try {
            if (storageManager.saveMetaRaw(notebookId, json)) "ok" else "error: save failed"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    /** Return the notebook's raw on-disk JSON, unparsed, so V8 in the WebView does the single parse.
     *  Android's org.json was ~3s of parse+reserialize on a cold open for what V8 parses in a few ms;
     *  the native side now just reads the file. */
    @JavascriptInterface
    fun loadNotebookRaw(notebookId: String): String {
        return try {
            val _t0 = android.os.SystemClock.uptimeMillis()  // DIAG to remove
            val raw = storageManager.loadNotebookRaw(notebookId) ?: return "null"
            android.util.Log.i("PERF", "DIAG loadRaw native: read=${android.os.SystemClock.uptimeMillis()-_t0}ms bytes=${raw.length}")  // DIAG to remove
            raw
        } catch (e: Exception) {
            "null"
        }
    }

    @JavascriptInterface
    fun deleteNotebook(notebookId: String): String {
        return try {
            if (storageManager.deleteNotebook(notebookId)) "ok" else "error: delete failed"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    @JavascriptInterface
    fun attachInk(left: Int, top: Int, right: Int, bottom: Int): Boolean {
        return try {
            inkManager?.attach(Rect(left, top, right, bottom))
            true
        } catch (e: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun detachInk() {
        inkManager?.detach()
    }

    /** Sticky-note partial mode: attach the daemon to just the note box (surface px) so only it refreshes. */
    @JavascriptInterface
    fun resumeInkBox(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.resumeInkBox(left, top, right, bottom)
    }

    @JavascriptInterface
    fun attachInkBox(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.attachInkBox(left, top, right, bottom)
    }

    @JavascriptInterface
    fun detachInkBox() {
        inkManager?.detachInkBox()
    }

    /** Full-editor counterpart to detachInkBox: clear persistent panel and
     * daemon pixels before restoring the shared SurfaceView. */
    @JavascriptInterface
    fun detachInkBoxCleared() {
        inkManager?.detachInkBoxCleared()
    }

    /** Transient full-editor handoff to WebView tools; preserves the visible frame. */
    @JavascriptInterface
    fun detachInkBoxForWeb() {
        inkManager?.detachInkBoxForWeb()
    }

    /** Make the interactive WebView authoritative when no daemon surface remains. */
    @JavascriptInterface
    fun showWebWorkspace() {
        inkManager?.showWebWorkspace()
    }

    /**
     * Composition capability consumed by the shared writing feature. Older bridges do not expose
     * this method, and the feature deliberately defaults those builds to the proven Bigme path.
     */
    @JavascriptInterface
    fun supportsPersistentDisplayHandoff(): Boolean {
        return DeviceRegistry.require(fragment.requireContext()).supportsPersistentDisplayHandoff
    }

    @JavascriptInterface
    fun setInkStyle(widthPx: Float, colorHex: String) {
        inkManager?.setStyle(widthPx, colorHex)
    }

    @JavascriptInterface
    fun setInkEnabled(enabled: Boolean) {
        inkManager?.setEnabled(enabled)
    }


    /** Render the whole page on the native ink surface from the JS model (load/undo/erase/etc.).
     *  [json] = array of strokes in surface px: [{"w":widthPx,"p":[[x,y],...]}, ...]. */
    @JavascriptInterface
    fun renderInk(json: String) {
        inkManager?.renderInk(json)
    }

    /** Flush the native stroke batch into the JS model, then fire window.onNativeFlushed() so a
     *  model op (undo/erase/save) runs against current data. */
    @JavascriptInterface
    fun flushInk() {
        inkManager?.flushAndSignal()
    }

    /** Snapshot the top [heightPx] (surface px) of the WebView (the toolbar strip) onto the native
     *  page so the web toolbar is visible. Called by JS after load and after toolbar changes. */
    @JavascriptInterface
    fun snapshotToolbar(heightPx: Int) {
        inkManager?.snapshotToolbar(heightPx)
    }

    /** Re-bake just one toolbar region (surface px) — button cluster / page number — without a
     *  whole-strip re-bake or flash. */
    @JavascriptInterface
    fun snapshotToolbarRegion(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.snapshotToolbarRegion(left, top, right, bottom)
    }

    /** Full-screen refresh of the composited page + both chrome bars. Called once after the open
     *  bake because the per-bar region refreshes don't reliably land on this e-ink panel. */
    @JavascriptInterface
    fun refreshChrome() {
        inkManager?.refreshChrome()
    }

    @JavascriptInterface
    fun clearMenuSnapshot() { inkManager?.clearMenuSnapshot() }

    /** Bake the floating collapsible menu at its bounds (left..bottom). [refresh*] = union of old +
     *  new menu bounds so a collapse clears the area it used to cover. */
    @JavascriptInterface
    fun snapshotMenu(left: Int, top: Int, right: Int, bottom: Int,
                     refreshLeft: Int, refreshTop: Int, refreshRight: Int, refreshBottom: Int) {
        inkManager?.snapshotMenu(left, top, right, bottom, refreshLeft, refreshTop, refreshRight, refreshBottom)
    }

    /** Bake the WebView's interactive-format content layer (region [l,t,r,b] = paper, surface px)
     *  onto the ink surface, under the ink. The pen then writes over the baked article content. */
    @JavascriptInterface
    fun snapshotContent(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.snapshotContent(left, top, right, bottom)
    }

    /** Bake the content region but limit the EPD refresh to rl,rt,rr,rb (sticky-note box) for a partial refresh. */
    @JavascriptInterface
    fun snapshotContentPartial(left: Int, top: Int, right: Int, bottom: Int, rl: Int, rt: Int, rr: Int, rb: Int) {
        inkManager?.snapshotContent(left, top, right, bottom, rl, rt, rr, rb)
    }

    /** Suppress the full-screen wake refresh on the next attach (partial sticky-note open). */
    @JavascriptInterface
    fun skipWakeRefresh() {
        inkManager?.skipNextWake()
    }

    /** Drop any baked content (plain notebook / page with no blocks). */
    @JavascriptInterface
    fun clearContent() {
        inkManager?.clearContent()
    }

    /** A notebook asset (e.g. an image under the notebook's assets/) as a base64 data URL, for the
     *  content layer to display. [relPath] is relative to the notebook dir. "" if missing. */
    @JavascriptInterface
    fun getNotebookAsset(notebookId: String, relPath: String): String {
        return storageManager.getNotebookAssetDataUrl(notebookId, relPath)
    }

    /** Batch form of [getNotebookAsset]: [relPathsJson] is a JSON array of relPaths, the result a
     *  JSON object mapping each relPath to its data URL ("" if missing). One synchronous bridge
     *  round-trip instead of one per image — each JS→native call costs ~tens of ms on the device
     *  WebView, so an image-heavy book section pays seconds through the single-asset path. */
    @JavascriptInterface
    fun getNotebookAssets(notebookId: String, relPathsJson: String): String =
        batchToJson(relPathsJson) { rel -> storageManager.getNotebookAssetDataUrl(notebookId, rel) }

    /** Batch image-dimension probe: [relPathsJson] is a JSON array of asset relPaths; the result
     *  maps each to [w, h] (or skips it when unreadable). Reads ONLY the image headers
     *  (inJustDecodeBounds — no pixel decode), so probing a 60-image section is one cheap
     *  round-trip. The reader reserves each image's exact box from this, then streams pixels
     *  asynchronously via the kalamos.content/nbasset route — fast open AND no layout shift. */
    @JavascriptInterface
    fun getNotebookAssetDims(notebookId: String, relPathsJson: String): String =
        batchToJson(relPathsJson) { rel ->
            val f = storageManager.notebookAssetFile(notebookId, rel) ?: return@batchToJson null
            val opts = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            android.graphics.BitmapFactory.decodeFile(f.absolutePath, opts)
            if (opts.outWidth > 0 && opts.outHeight > 0)
                org.json.JSONArray().put(opts.outWidth).put(opts.outHeight)
            else null
        }

    /** Read a book/sidecar text file (manifest/section/css/json) under the notebook dir. */
    @JavascriptInterface
    fun getBookFile(notebookId: String, relPath: String): String {
        return storageManager.getBookFile(notebookId, relPath) ?: ""
    }

    /** Writing-document files belong to notebook records; books use [getBookFile] separately. */
    @JavascriptInterface
    fun getNotebookFile(notebookId: String, relPath: String): String {
        val content = storageManager.getNotebookFile(notebookId, relPath) ?: ""
        if (com.kalamos.device.api.ink.InkDiagnostics.enabled) {
            try {
                val hash = java.security.MessageDigest.getInstance("SHA-256").digest(content.toByteArray()).joinToString("") { "%02x".format(it) }
                com.kalamos.device.api.ink.InkDiagnostics.event("load.file", mapOf("notebook" to notebookId, "file" to relPath,
                    "bytes" to content.toByteArray().size, "sha256" to hash))
            } catch (error: Exception) { android.util.Log.w("InkTrace", "Load observation failed", error) }
        }
        return content
    }

    /** Batch form of [getBookFile]: [relPathsJson] is a JSON array of relPaths, the result a JSON
     *  object mapping each relPath to its content ("" if missing). Same rationale as
     *  [getNotebookAssets] — the reader's open path reads manifest/toc/css/section/sidecars, and
     *  batching collapses those ~6 bridge round-trips into 1. */
    @JavascriptInterface
    fun getBookFiles(notebookId: String, relPathsJson: String): String =
        batchToJson(relPathsJson) { rel -> storageManager.getBookFile(notebookId, rel) ?: "" }

    /** Read optional sidecars away from the WebView thread. Large annotation catalogs and ink
     * previews must never delay page turns or the Back action. */
    @JavascriptInterface
    fun requestBookFile(notebookId: String, relPath: String, requestId: String) {
        pdfMetadataExecutor.execute {
            val content = try { storageManager.getBookFile(notebookId, relPath) ?: "" } catch (e: Exception) { "" }
            fragment.activity?.runOnUiThread {
                val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
                val rid = org.json.JSONObject.quote(requestId)
                val value = org.json.JSONObject.quote(content)
                wv?.evaluateJavascript("window.onBookFileReady && window.onBookFileReady($rid,$value)", null)
            }
        }
    }

    /** Write a mutable sidecar text file (highlights/notes) under the notebook dir. */
    @JavascriptInterface
    fun saveBookFile(notebookId: String, relPath: String, content: String): String {
        return if (storageManager.saveBookFile(notebookId, relPath, content)) "ok" else "error"
    }

    /**
     * Save a generated raster only into the closed workbook-asset sidecar namespace.
     * Validation includes the data-URL media type, strict Base64, a 10 MB decoded limit, raster
     * magic bytes, the SHA-256 filename, and the destination path; SVG and source-book writes are
     * never accepted through this method.
     */
    @JavascriptInterface
    fun saveBookAssetDataUrl(notebookId: String, relPath: String, dataUrl: String): String {
        if (!com.kalamos.notebook.storage.WorkbookAssetPolicy.isSafeBookId(notebookId)) {
            return "error: invalid book id"
        }
        return when (val result = com.kalamos.notebook.storage.WorkbookAssetPolicy.decode(relPath, dataUrl)) {
            is com.kalamos.notebook.storage.WorkbookAssetPolicy.Result.Rejected ->
                "error: ${result.error}"
            is com.kalamos.notebook.storage.WorkbookAssetPolicy.Result.Approved ->
                if (storageManager.saveBookAssetBytes(
                        notebookId,
                        result.asset.relativePath,
                        result.asset.bytes
                    )) "ok" else "error: save failed"
        }
    }

    @JavascriptInterface
    fun saveNotebookFile(notebookId: String, relPath: String, content: String): String {
        val saved = storageManager.saveNotebookFile(notebookId, relPath, content)
        if (com.kalamos.device.api.ink.InkDiagnostics.enabled) {
          try {
            val started = android.os.SystemClock.elapsedRealtimeNanos()
            fun hash(text: String) = java.security.MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
            val payloadHash = hash(content)
            val readbackHash = storageManager.getNotebookFile(notebookId, relPath)?.let { hash(it) }
            com.kalamos.device.api.ink.InkDiagnostics.event("save.file", mapOf("notebook" to notebookId, "file" to relPath,
                "bytes" to content.toByteArray().size, "sha256" to payloadHash, "saved" to saved,
                "readbackSha256" to readbackHash, "readbackMatches" to (payloadHash == readbackHash),
                "diagnosticReadbackNs" to (android.os.SystemClock.elapsedRealtimeNanos() - started)))
          } catch (error: Exception) { android.util.Log.w("InkTrace", "Save observation failed", error) }
        }
        return if (saved) "ok" else "error"
    }

    // ---- EPUB backend (AD-4/AD-9) --------------------------------------------------------------

    /** Open (or re-open) `notebooks/<id>/book.epub`, parsing + caching `epub-manifest.json` and
     *  the per-chapter text cache on first open. Returns "ok" or "error: <message>". */
    @JavascriptInterface
    fun epubOpen(notebookId: String): String = EpubManager.open(notebookId, storageManager)

    /** Open and, when necessary, build an EPUB cache without blocking the WebView's JavaScript
     * thread. The manifest is returned with the completion callback so opening does not immediately
     * pay for a second synchronous storage bridge call. */
    @JavascriptInterface
    fun requestEpubOpen(notebookId: String, requestId: String) {
        pdfMetadataExecutor.execute {
            val started = android.os.SystemClock.elapsedRealtime()
            val result = EpubManager.open(notebookId, storageManager)
            val manifest = if (result.startsWith("ok")) {
                EpubManager.manifest(notebookId, storageManager)
            } else {
                "null"
            }
            val elapsed = android.os.SystemClock.elapsedRealtime() - started
            android.util.Log.i("AndroidBridge", "DIAG epubOpenAsync id=$notebookId elapsed=${elapsed}ms result=$result")
            fragment.activity?.runOnUiThread {
                val webView = fragment.view?.findViewById<android.webkit.WebView>(
                    com.kalamos.foundation.runtime.R.id.webView
                )
                val rid = org.json.JSONObject.quote(requestId)
                val status = org.json.JSONObject.quote(result)
                val payload = org.json.JSONObject.quote(manifest)
                webView?.evaluateJavascript(
                    "window.onEpubOpenReady && window.onEpubOpenReady($rid,$status,$payload)",
                    null,
                )
            }
        }
    }

    /** The cached `epub-manifest.json` (AD-8 schema), or "null" if not opened/parsed yet. */
    @JavascriptInterface
    fun epubManifest(notebookId: String): String = EpubManager.manifest(notebookId, storageManager)

    /** Raw text of one zip entry (chapter XHTML/CSS); JS sanitizes before use. "" if missing. */
    @JavascriptInterface
    fun epubEntry(notebookId: String, zipPath: String): String =
        EpubManager.entry(notebookId, zipPath, storageManager)

    /** One zip entry (image/font) as a base64 `data:` URL. "" if missing. */
    @JavascriptInterface
    fun epubAssetDataUrl(notebookId: String, zipPath: String): String =
        EpubManager.assetDataUrl(notebookId, zipPath, storageManager)

    /** Close the notebook's open zip session (reader leaving the book). */
    @JavascriptInterface
    fun epubClose(notebookId: String) {
        EpubManager.close(notebookId)
    }

    /** Latest [searchBook] token, so a superseded search (user kept typing) can bail out of its
     *  page-by-page PDF walk early instead of burning pdfbox extraction time on a stale query. */
    @Volatile
    private var searchToken: String = ""

    /** In-book search dispatched on the notebook's `meta.format`: "epub" walks the cached
     *  per-chapter text ([EpubManager.search]); "pdf" walks each page's text via the app-owned
     *  [com.kalamos.notebook.bookfmt.PdfTextService] seam (WP8) — "[]" if unregistered (kalamos-
     *  notes/todo/scribe, or the app just hasn't wired pdfbox). Runs off the UI thread and
     *  delivers results via `window.onSearchResults(token, json, done)` — a single batch, so
     *  `done` is always true. */
    @JavascriptInterface
    fun searchBook(notebookId: String, query: String, token: String) {
        searchToken = token
        Thread {
            val format = try {
                org.json.JSONObject(storageManager.peekMetaRaw(notebookId) ?: "{}").optString("format", "blocks")
            } catch (e: Exception) { "blocks" }
            val resultsJson = when (format) {
                "epub" -> EpubManager.search(notebookId, query, storageManager).toString()
                "pdf" -> searchPdf(notebookId, query, token).toString()
                else -> "[]"
            }
            postSearchResults(token, resultsJson)
        }.start()
    }

    /** PDF branch of [searchBook] (WP8): page count comes from [PdfRenderService.open] (pure
     *  render-side, no pdfbox needed just to know page count), then each page's text is pulled
     *  through [com.kalamos.notebook.bookfmt.BookServices.pdfText] (null -> no results). Case-
     *  insensitive, snippet ±40 chars, capped at [cap] matches — mirrors [EpubManager.search]'s
     *  contract but keyed by `pageIndex` instead of `spineIdx`/`charOffset`. Checks [token] against
     *  the latest [searchToken] each page so a newer search in flight cuts this one short. */
    private fun searchPdf(notebookId: String, query: String, token: String, cap: Int = 200): org.json.JSONArray {
        val results = org.json.JSONArray()
        if (query.isBlank()) return results
        val svc = com.kalamos.notebook.bookfmt.BookServices.pdfText ?: return results
        val pageCount = try {
            org.json.JSONObject(PdfRenderService.open(notebookId, storageManager)).optInt("pages", 0)
        } catch (e: Exception) { 0 }
        if (pageCount <= 0) return results
        val q = query.lowercase()
        for (page in 0 until pageCount) {
            if (token != searchToken) break   // superseded by a newer search call
            if (results.length() >= cap) break
            val text = svc.pageText(notebookId, page) ?: continue
            val lower = text.lowercase()
            var from = 0
            while (results.length() < cap) {
                val pos = lower.indexOf(q, from)
                if (pos < 0) break
                val start = maxOf(0, pos - 40)
                val end = minOf(text.length, pos + q.length + 40)
                results.put(org.json.JSONObject().apply {
                    put("pageIndex", page)
                    put("snippet", text.substring(start, end))
                })
                from = pos + q.length
            }
        }
        return results
    }

    // ---- PDF backend (AD-2/AD-3/AD-9) -----------------------------------------------------------

    /** Open (or re-open) `notebooks/<id>/book.pdf` via [PdfRenderService]. Returns
     *  `'{"pages":N,"pageWidthPt":w,"pageHeightPt":h}'`, or `"error: encrypted"` /
     *  `"error: unreadable"`. */
    @JavascriptInterface
    fun pdfOpen(notebookId: String): String = PdfRenderService.open(notebookId, storageManager)

    /** Close the notebook's open [PdfRenderService] session (reader leaving the book). */
    @JavascriptInterface
    fun pdfClose(notebookId: String) {
        PdfRenderService.close(notebookId)
        com.kalamos.notebook.bookfmt.BookServices.pdfText?.close(notebookId)
    }

    /** Fallback path for WebViews where `shouldInterceptRequest` ([BookContentInterceptor], AD-3's
     *  primary path) misbehaves, and the ONLY path for the browser preview (no WebView at all):
     *  renders page [pageIndex] — a cache hit if the interceptor (or a previous call here) already
     *  warmed `.cache/` for this exact param combo, so it's near-instant — and returns it as a
     *  base64 `data:image/webp` URL. [crop] is `"l,t,r,b"` 0-100 percentages, `""` for the full
     *  page. Returns "" on failure (bad page index, unreadable/encrypted PDF). */
    @JavascriptInterface
    fun pdfPageDataUrl(notebookId: String, pageIndex: Int, w: Int, e: Int, d: Int, crop: String): String {
        val file = PdfRenderService.renderPage(notebookId, pageIndex, w, e, d, crop, storageManager)
            ?: return ""
        return try {
            "data:image/webp;base64," +
                android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP)
        } catch (ex: Exception) {
            ""
        }
    }

    // ---- PDF text backend (AD-2/AD-9, WP8) ------------------------------------------------------
    // pdfbox-android itself never appears in the shared runtime (AD-1) — all four are thin
    // dispatches through com.kalamos.notebook.bookfmt.BookServices.pdfText, the app-owned seam
    // kalamos-books' BooksApp registers PdfBoxTextService into. Null (unregistered service, e.g.
    // kalamos-notes/todo/scribe, or the app hasn't started yet) degrades to the empty/false value
    // noted per method — never a crash.

    /** Outline / bookmarks tree as `[{"label":..,"pageIndex":..,"level":..}, ...]` JSON, via the
     *  app-owned [com.kalamos.notebook.bookfmt.PdfTextService] seam. "[]" if no service is
     *  registered or the PDF has no outline. */
    @JavascriptInterface
    fun pdfOutline(notebookId: String): String =
        com.kalamos.notebook.bookfmt.BookServices.pdfText?.outline(notebookId) ?: "[]"

    /** Prepare the small disk-backed outline sidecar off the WebView thread. The page can paint and
     *  accept turns while PDFBox walks a cold document; later Contents opens are memory/disk reads. */
    @JavascriptInterface
    fun requestPdfOutline(notebookId: String, requestId: String) {
        pdfMetadataExecutor.execute {
            val outline = try {
                com.kalamos.notebook.bookfmt.BookServices.pdfText?.outline(notebookId) ?: "[]"
            } catch (e: Exception) { "[]" }
            fragment.activity?.runOnUiThread {
                val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
                val rid = org.json.JSONObject.quote(requestId)
                val json = org.json.JSONObject.quote(outline)
                wv?.evaluateJavascript("window.onPdfOutline && window.onPdfOutline($rid,$json)", null)
            }
        }
    }

    /** Plain text of one page (0-based), via the same seam. "" if no service is registered or
     *  extraction fails for this page. */
    @JavascriptInterface
    fun pdfPageText(notebookId: String, pageIndex: Int): String =
        com.kalamos.notebook.bookfmt.BookServices.pdfText?.pageText(notebookId, pageIndex) ?: ""

    /** Positioned page text used by the bitmap reader's selectable text layer. */
    @JavascriptInterface
    fun pdfPageTextLayout(notebookId: String, pageIndex: Int): String =
        com.kalamos.notebook.bookfmt.BookServices.pdfText?.pageTextLayout(notebookId, pageIndex) ?: "{}"

    /** Batch page-range text (WP10 article-mode reflow): `["page from text", "page from+1 text", ...]`
     *  JSON array, inclusive of both [from] and [to] (whichever order they're passed in). "[]" if no
     *  service is registered. Missing/failed individual pages come back as "" rather than shrinking
     *  the array, so the caller's index arithmetic against [from] stays simple. */
    @JavascriptInterface
    fun pdfPagesText(notebookId: String, from: Int, to: Int): String {
        val svc = com.kalamos.notebook.bookfmt.BookServices.pdfText ?: return "[]"
        val lo = minOf(from, to)
        val hi = maxOf(from, to)
        val arr = org.json.JSONArray()
        for (i in lo..hi) arr.put(svc.pageText(notebookId, i) ?: "")
        return arr.toString()
    }

    /** Whether the PDF has an extractable text layer (false ⇒ scanned-image only; JS disables
     *  article mode/search/outline with a visible notice). Delegates to the seam's own
     *  [com.kalamos.notebook.bookfmt.PdfTextService.hasTextLayer], which caches its answer per
     *  notebook id itself — false (not a crash) if no service is registered. */
    @JavascriptInterface
    fun pdfHasTextLayer(notebookId: String): Boolean =
        com.kalamos.notebook.bookfmt.BookServices.pdfText?.hasTextLayer(notebookId) ?: false

    /** Probe PDFBox off the WebView thread. A cold large document may take seconds to open, so a
     *  synchronous JavascriptInterface call here would make every reader control unresponsive. */
    @JavascriptInterface
    fun requestPdfHasTextLayer(notebookId: String, requestId: String) {
        pdfTextLayoutExecutor.execute {
            val started = android.os.SystemClock.uptimeMillis()
            val hasText = try {
                com.kalamos.notebook.bookfmt.BookServices.pdfText?.hasTextLayer(notebookId) ?: false
            } catch (e: Exception) { false }
            android.util.Log.i("PERF", "DIAG pdfTextProbe elapsed=${android.os.SystemClock.uptimeMillis() - started}ms hasText=$hasText")
            fragment.activity?.runOnUiThread {
                val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
                val rid = org.json.JSONObject.quote(requestId)
                wv?.evaluateJavascript("window.onPdfHasTextLayer && window.onPdfHasTextLayer($rid,$hasText)", null)
            }
        }
    }

    /** Extract positioned PDF text away from the WebView/page-turn path. Every accepted request is
     *  answered: the web layer coalesces same-page callers and uses its own tokens to ignore stale
     *  UI work, so dropping a native callback here would strand its waiters indefinitely. The web
     *  layer also owns next-page warming, avoiding duplicate PDFBox extraction on this executor. */
    @JavascriptInterface
    fun requestPdfPageTextLayout(notebookId: String, pageIndex: Int, requestId: String) {
        pdfTextLayoutExecutor.execute {
            val started = android.os.SystemClock.uptimeMillis()
            val svc = com.kalamos.notebook.bookfmt.BookServices.pdfText
            val layout = try { svc?.pageTextLayout(notebookId, pageIndex) ?: "{}" } catch (e: Exception) { "{}" }
            android.util.Log.i("PERF", "DIAG pdfTextLayout page=$pageIndex elapsed=${android.os.SystemClock.uptimeMillis() - started}ms bytes=${layout.length}")
            postPdfTextLayout(requestId, layout)
        }
    }

    private fun postPdfTextLayout(requestId: String, layout: String) {
        fragment.activity?.runOnUiThread {
            val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
            val rid = org.json.JSONObject.quote(requestId)
            val json = org.json.JSONObject.quote(layout)
            wv?.evaluateJavascript("window.onPdfTextLayout && window.onPdfTextLayout($rid,$json)", null)
        }
    }

    /** Export a NEW flattened PDF. The immutable source book remains untouched. */
    @JavascriptInterface
    fun exportAnnotatedPdf(notebookId: String) {
        val context = fragment.context ?: return
        fragment.activity?.runOnUiThread {
            Toast.makeText(context, "Preparing annotated PDF…", Toast.LENGTH_SHORT).show()
        }
        Thread {
            val bytes = com.kalamos.notebook.bookfmt.BookServices.pdfText?.exportAnnotatedPdf(notebookId)
            val title = try {
                val raw = storageManager.peekMetaRaw(notebookId) ?: storageManager.loadMetaRaw(notebookId)
                org.json.JSONObject(raw ?: "{}").optString("title", "Annotated book")
            } catch (e: Exception) { "Annotated book" }
            Handler(Looper.getMainLooper()).post {
                if (!fragment.isAdded) return@post
                if (bytes == null) {
                    Toast.makeText(fragment.requireContext(), "Could not prepare annotated PDF", Toast.LENGTH_LONG).show()
                    return@post
                }
                pendingExportBytes = bytes
                val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/pdf"
                    putExtra(Intent.EXTRA_TITLE, "$title - annotated.pdf")
                }
                exportLauncher.launch(intent)
            }
        }.start()
    }

    // ---- Handwriting recognition (shared seam, all apps) -----------------------------------------
    // Hosts may register an optional recognizer. Without one the stable bridge reports unavailable;
    // handwriting remains ink. AI page formatting has its own independent Notes-owned path.

    private val hwr: com.kalamos.notebook.hwr.Recognizer by lazy {
        com.kalamos.notebook.hwr.HwrEngines.create(fragment.requireContext(), ::postHwrEvent)
    }

    /** 'ready' | 'downloading' | 'absent' | 'unavailable' for [lang] — synchronous and fast. */
    @JavascriptInterface
    fun hwrStatus(lang: String): String = try { hwr.statusSync(lang) } catch (e: Exception) { "unavailable" }

    /** Fetch the language pack for [lang]; returns {reqId} JSON, then progress?/done/error events. */
    @JavascriptInterface
    fun hwrDownload(lang: String): String =
        try { hwr.download(lang) } catch (e: Exception) { """{"err":"${e.message}"}""" }

    /** Recognize strokes; [argsJson] = {mode?:text|gesture|shape, lang, strokes:[[[x,y,p],...]], area?, preContext?}.
     *  Returns {reqId} JSON; the result/error arrives as an onHwrEvent. */
    @JavascriptInterface
    fun hwrRecognize(argsJson: String): String = try {
        hwr.recognize(org.json.JSONObject(argsJson))
    } catch (e: Exception) {
        """{"err":"bad-args: ${e.message}"}"""
    }

    private fun postHwrEvent(event: org.json.JSONObject) {
        fragment.activity?.runOnUiThread {
            val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
            wv?.evaluateJavascript(
                "window.onHwrEvent && window.onHwrEvent(${org.json.JSONObject.quote(event.toString())})",
                null
            )
        }
    }

    private fun postSearchResults(token: String, json: String) {
        fragment.activity?.runOnUiThread {
            val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
            wv?.evaluateJavascript(
                "window.onSearchResults && window.onSearchResults(${org.json.JSONObject.quote(token)}, ${org.json.JSONObject.quote(json)}, true)",
                null
            )
        }
    }

    /** Restrict the daemon's writing area: pen above [topPx] (surface px) is ignored. JS owns the
     *  measurement (the toolbar strip), so the website controls the pen-input region. */
    @JavascriptInterface
    fun setWritingTop(topPx: Int) {
        inkManager?.setWritingTop(topPx)
    }

    /** The floating menu's bounds (surface px): pen inside is ignored. Empty rect clears it. */
    @JavascriptInterface
    fun setWritingExclusion(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.setWritingExclusion(left, top, right, bottom)
    }

    /** Confine the daemon pen to a box (surface px) — for sticky-note/sketch drawing. Empty clears. */
    @JavascriptInterface
    fun setWritingBounds(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.setWritingBounds(left, top, right, bottom)
    }

    /** Web layer toggles eraser mode: while active, native discards any daemon stroke (the daemon
     *  sometimes mis-paints a stylus-eraser swipe as a pen stroke). */
    @JavascriptInterface
    fun setErasing(active: Boolean) {
        inkManager?.setErasing(active)
    }

    /** Pen type: "ballpoint" (constant width), "felt" (width by pressure), "selection" (dashed line). */
    @JavascriptInterface
    fun setPenType(type: String) {
        inkManager?.setPenType(type)
    }

    /** Editor animation "band" mode: while [active], stop the panel's periodic full-screen de-ghost
     *  clean so it doesn't compete with the pen's fast refresh (writing stays responsive). Restored
     *  to the default reading/writing policy when inactive. */
    @JavascriptInterface
    fun setAnimationPanel(active: Boolean) {
        inkManager?.setAnimationPanel(active)
    }

    /** Fast interactive panel mode for live WebView panning/retargeting. */
    @JavascriptInterface
    fun setInteractivePanel(active: Boolean) {
        inkManager?.setInteractivePanel(active)
    }

    /** Start sampling + fast-refreshing a WebView region (surface px) — the web layer's animation. */
    @JavascriptInterface
    fun startWebAnim(left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.startWebAnim(left, top, right, bottom)
    }

    @JavascriptInterface
    fun stopWebAnim() {
        inkManager?.stopWebAnim()
    }

    /** Capture the current page off the native ink surface and save it as the notebook's thumbnail
     *  (the web canvas is stale — writing only goes to the surface). */
    @JavascriptInterface
    fun captureThumbnail(notebookId: String) {
        inkManager?.saveThumbnail(notebookId, storageManager)
    }

    /** Standard/WebView thumbnail path. Bigme keeps [captureThumbnail]'s native page capture. */
    @JavascriptInterface
    fun captureWebThumbnail(notebookId: String, left: Int, top: Int, right: Int, bottom: Int) {
        inkManager?.saveWebThumbnail(notebookId, left, top, right, bottom, storageManager)
    }

    /**
     * Persist a small PNG rendered directly from an authoritative writing page model.
     *
     * The JavaScript side owns this path for model-rendered previews, independent of the live
     * display provider. Decoding and atomically replacing one 320×426 PNG is intentionally synchronous:
     * when this returns, the library cannot race and cache the previous blank thumbnail. Native
     * ink ownership, capture and presentation are not touched by this storage operation.
     */
    @JavascriptInterface
    fun saveThumbnailDataUrl(notebookId: String, dataUrl: String): String {
        return try {
            val marker = "data:image/png;base64,"
            if (!dataUrl.startsWith(marker)) return "error: invalid thumbnail"
            val bytes = android.util.Base64.decode(
                dataUrl.substring(marker.length),
                android.util.Base64.DEFAULT
            )
            if (bytes.isEmpty() || bytes.size > 2_000_000) return "error: invalid thumbnail size"
            if (storageManager.saveThumbnailBytes(notebookId, bytes)) "ok" else "error: save failed"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    @JavascriptInterface
    fun getThumbnailDataUrl(notebookId: String): String {
        return storageManager.getThumbnailDataUrl(notebookId)
    }

    // ---- Cover pipeline (AD-6/WP2) ---------------------------------------------------------------

    /** Backfill covers for [idsJson] (a `["id1","id2",...]` JSON array — the library's cover-less
     *  visible cards) off the UI thread: [CoverManager.ensure] per id (fast no-op if that id
     *  already has a thumbnail), firing `window.onCoverReady(id)` for each one that newly gets a
     *  thumbnail so the grid can refresh just that card in place. Fire-and-forget, like
     *  [searchBook] — the caller doesn't block on a return value. */
    @JavascriptInterface
    fun ensureCovers(idsJson: String) {
        val ids = try {
            val arr = org.json.JSONArray(idsJson)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) {
            emptyList()
        }
        if (ids.isEmpty()) return
        Thread {
            for (id in ids) {
                try {
                    if (CoverManager.ensure(id, storageManager)) postCoverReady(id)
                } catch (e: Exception) { /* skip this id, keep going */ }
            }
        }.start()
    }

    private fun postCoverReady(notebookId: String) {
        fragment.activity?.runOnUiThread {
            val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
            wv?.evaluateJavascript(
                "window.onCoverReady && window.onCoverReady(${org.json.JSONObject.quote(notebookId)})",
                null
            )
        }
    }

    // ---- Sideload import (AD-7/WP12) ---------------------------------------------------------------

    /** Scan the Books import folders for `.epub`/`.pdf` drop-ins
     *  ([com.kalamos.notebook.bookfmt.BookScanner]), off the UI thread. Fires
     *  `window.onBookScanDone('{"imported":n,"skipped":n,"failed":n,"updated":n}')` when done; the
     *  updated count includes embedded/manifest backfills and accepted online gap-fills. */
    @JavascriptInterface
    fun scanForNewBooks() {
        Thread {
            val resultJson = try {
                com.kalamos.notebook.bookfmt.BookScanner.scan(storageManager, fragment.context)
            } catch (e: Exception) {
                "{\"imported\":0,\"skipped\":0,\"failed\":0,\"updated\":0}"
            }
            val imported = try { org.json.JSONObject(resultJson).optInt("imported", 0) } catch (e: Exception) { 0 }
            if (imported > 0) {
                fragment.activity?.runOnUiThread {
                    Toast.makeText(fragment.requireContext(), "Imported $imported book(s)", Toast.LENGTH_SHORT).show()
                }
            }
            postBookScanDone(resultJson)
        }.start()
    }

    /**
     * Open Android's system document picker so Books can import one or more EPUB/PDF files from
     * Downloads, Documents, removable storage or any installed document provider. The selected
     * content is copied through an app-cache batch and then moved into Kalamos' canonical Books
     * storage by [com.kalamos.notebook.bookfmt.BookScanner].
     */
    @JavascriptInterface
    fun pickBooksToImport() {
        fragment.activity?.runOnUiThread {
            try {
                bookPickerLauncher.launch(
                    arrayOf(
                        "application/epub+zip",
                        "application/epub",
                        "application/x-epub+zip",
                        "application/pdf",
                        "application/octet-stream"
                    )
                )
            } catch (_: Exception) {
                val result = org.json.JSONObject()
                    .put("imported", 0)
                    .put("skipped", 0)
                    .put("failed", 1)
                    .put("updated", 0)
                    .put("pickerError", true)
                postBookImportToast(result)
                postBookScanDone(result.toString())
            }
        }
    }

    private val bookPickerLauncher = fragment.registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isEmpty()) {
            postBookScanDone(
                org.json.JSONObject()
                    .put("imported", 0)
                    .put("skipped", 0)
                    .put("failed", 0)
                    .put("updated", 0)
                    .put("cancelled", true)
                    .toString()
            )
            return@registerForActivityResult
        }
        val appContext = fragment.context?.applicationContext
            ?: return@registerForActivityResult
        Thread {
            val batchDir = java.io.File(
                appContext.cacheDir,
                "book-import-${java.util.UUID.randomUUID()}"
            )
            var unsupported = 0
            var copyFailed = 0
            val staged = ArrayList<java.io.File>()
            try {
                batchDir.mkdirs()
                for (uri in uris) {
                    val sourceName = selectedBookName(appContext, uri)
                    val extension = selectedBookExtension(appContext, sourceName, uri)
                    if (extension == null) {
                        unsupported++
                        continue
                    }
                    val baseName = sourceName
                        ?.substringBeforeLast('.', sourceName)
                        ?.let(::safeBookFilename)
                        ?.takeIf { it.isNotBlank() }
                        ?: "book"
                    val destination = uniqueStagingFile(batchDir, "$baseName.$extension")
                    try {
                        val input = appContext.contentResolver.openInputStream(uri)
                            ?: throw java.io.IOException("Could not open selected book")
                        input.use { source ->
                            destination.outputStream().buffered().use { target ->
                                source.copyTo(target)
                            }
                        }
                        staged.add(destination)
                    } catch (_: Exception) {
                        destination.delete()
                        copyFailed++
                    }
                }

                val result = if (staged.isEmpty()) {
                    org.json.JSONObject()
                        .put("imported", 0)
                        .put("skipped", 0)
                        .put("failed", 0)
                        .put("updated", 0)
                } else {
                    org.json.JSONObject(
                        com.kalamos.notebook.bookfmt.BookScanner
                            .importSelectedFiles(storageManager, staged)
                    )
                }
                result.put("selected", uris.size)
                result.put("unsupported", unsupported)
                result.put("copyFailed", copyFailed)
                if (copyFailed > 0) {
                    result.put("failed", result.optInt("failed", 0) + copyFailed)
                }
                postBookImportToast(result)
                postBookScanDone(result.toString())
            } catch (_: Exception) {
                val result = org.json.JSONObject()
                    .put("imported", 0)
                    .put("skipped", 0)
                    .put("failed", uris.size)
                    .put("updated", 0)
                    .put("selected", uris.size)
                postBookImportToast(result)
                postBookScanDone(result.toString())
            } finally {
                batchDir.deleteRecursively()
            }
        }.start()
    }

    private fun selectedBookName(
        context: android.content.Context,
        uri: android.net.Uri
    ): String? {
        return try {
            context.contentResolver
                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun selectedBookExtension(
        context: android.content.Context,
        name: String?,
        uri: android.net.Uri
    ): String? {
        val filenameExtension = name?.substringAfterLast('.', "")
            ?.lowercase(java.util.Locale.US)
        if (filenameExtension == "epub" || filenameExtension == "pdf") return filenameExtension
        return when (context.contentResolver.getType(uri)?.lowercase(java.util.Locale.US)) {
            "application/epub+zip", "application/epub", "application/x-epub+zip" -> "epub"
            "application/pdf" -> "pdf"
            else -> null
        }
    }

    private fun safeBookFilename(value: String): String =
        value.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_")
            .trim()
            .take(180)

    private fun uniqueStagingFile(directory: java.io.File, filename: String): java.io.File {
        val direct = java.io.File(directory, filename)
        if (!direct.exists()) return direct
        val extension = filename.substringAfterLast('.', "")
        val stem = filename.substringBeforeLast('.', filename)
        var suffix = 2
        while (true) {
            val candidate = java.io.File(directory, "$stem-$suffix.$extension")
            if (!candidate.exists()) return candidate
            suffix++
        }
    }

    private fun postBookImportToast(result: org.json.JSONObject) {
        val imported = result.optInt("imported", 0)
        val skipped = result.optInt("skipped", 0)
        val unsupported = result.optInt("unsupported", 0)
        val failed = result.optInt("failed", 0)
        val message = when {
            imported > 0 && skipped == 0 && unsupported == 0 && failed == 0 ->
                "Imported $imported book${if (imported == 1) "" else "s"}"
            imported > 0 ->
                "Imported $imported; ${skipped + unsupported + failed} not added"
            skipped > 0 && unsupported == 0 && failed == 0 ->
                "Already in your library"
            unsupported > 0 && failed == 0 ->
                "Choose EPUB or PDF books"
            else -> "Could not import the selected books"
        }
        fragment.activity?.runOnUiThread {
            fragment.context?.let {
                Toast.makeText(it, message, Toast.LENGTH_LONG).show()
            }
        }
    }

    /** Manual Books metadata lookup. [query] may be an ISBN or exact title; results are returned
     * asynchronously so catalogue I/O never blocks the WebView thread. */
    @JavascriptInterface
    fun searchOnlineBookMetadata(notebookId: String, query: String, token: String) {
        pdfMetadataExecutor.execute {
            val service = com.kalamos.notebook.bookfmt.BookServices.onlineMetadata
            val result = if (service == null || query.isBlank()) {
                com.kalamos.notebook.bookfmt.OnlineBookMetadataResult(
                    com.kalamos.notebook.bookfmt.OnlineLookupStatus.UNAVAILABLE,
                    "online catalogue"
                )
            } else {
                try {
                    service.lookup(
                        com.kalamos.notebook.bookfmt.BookMetadataQuery(
                            title = query.trim(),
                            authors = emptyList(),
                            identifiers = listOf(query.trim()),
                            interactive = true
                        )
                    )
                } catch (_: Exception) {
                    com.kalamos.notebook.bookfmt.OnlineBookMetadataResult(
                        com.kalamos.notebook.bookfmt.OnlineLookupStatus.UNAVAILABLE,
                        "online catalogue"
                    )
                }
            }
            val json = org.json.JSONObject().apply {
                put("notebookId", notebookId)
                put("provider", result.provider)
                put("status", when (result.status) {
                    com.kalamos.notebook.bookfmt.OnlineLookupStatus.FOUND -> "found"
                    com.kalamos.notebook.bookfmt.OnlineLookupStatus.NOT_FOUND -> "not-found"
                    com.kalamos.notebook.bookfmt.OnlineLookupStatus.UNAVAILABLE -> "unavailable"
                })
                result.metadata?.let { put("metadata", it.toJson()) }
                result.recordId?.let { put("recordId", it) }
            }.toString()
            fragment.activity?.runOnUiThread {
                val wv = fragment.view?.findViewById<android.webkit.WebView>(
                    com.kalamos.foundation.runtime.R.id.webView
                )
                wv?.evaluateJavascript(
                    "window.onOnlineBookMetadataResult && " +
                        "window.onOnlineBookMetadataResult(" +
                        "${org.json.JSONObject.quote(token)}," +
                        "${org.json.JSONObject.quote(json)})",
                    null
                )
            }
        }
    }

    private fun postBookScanDone(resultJson: String) {
        fragment.activity?.runOnUiThread {
            val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
            wv?.evaluateJavascript(
                "window.onBookScanDone && window.onBookScanDone(${org.json.JSONObject.quote(resultJson)})",
                null
            )
        }
    }

    /** SPA routing (the web layer owns navigation now): switch the single WebView to editor mode
     *  (show the ink surface, transparent WebView). */
    @JavascriptInterface
    fun enterEditor() {
        inkManager?.enterEditor()
    }

    /** Reveal the editor once the daemon has attached and GU16'd: make WebView transparent.
     *  Called from JS (onInkSdkReady) so the transition happens only after the ink surface is clean. */
    @JavascriptInterface
    fun showEditor() {
        inkManager?.showEditor()
    }

    /** SPA routing: switch to library mode (hide the ink surface, opaque WebView). */
    @JavascriptInterface
    fun enterLibrary() {
        inkManager?.enterLibrary()
    }

    /** Back pressed while on the library — quit to the home screen. */
    @JavascriptInterface
    fun exitApp() {
        fragment.requireActivity().runOnUiThread {
            fragment.requireActivity().moveTaskToBack(true)
        }
    }

    @JavascriptInterface
    fun showToast(message: String) {
        Toast.makeText(fragment.requireContext(), message, Toast.LENGTH_SHORT).show()
    }

    /** Lock the screen orientation while in the app, or restore auto-rotate. A selected vendor
     *  provider may also require system auto-rotate control; Standard Android does not. */
    @JavascriptInterface
    fun setRotationLocked(locked: Boolean) {
        val ctx = fragment.requireContext()
        ctx.getSharedPreferences("kalamos_prefs", android.content.Context.MODE_PRIVATE)
            .edit().putBoolean("rotation_locked", locked).apply()
        fragment.requireActivity().runOnUiThread {
            fragment.requireActivity().requestedOrientation =
                if (locked) android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        if (!DeviceRegistry.require(ctx).requiresSystemRotationControl) return
        if (android.provider.Settings.System.canWrite(ctx)) {
            try {
                android.provider.Settings.System.putInt(ctx.contentResolver,
                    android.provider.Settings.System.ACCELEROMETER_ROTATION, if (locked) 0 else 1)
                if (locked) android.provider.Settings.System.putInt(ctx.contentResolver,
                    android.provider.Settings.System.USER_ROTATION, android.view.Surface.ROTATION_0)
            } catch (e: Exception) { /* ignore */ }
        } else if (locked) {
            // First time: send the user to grant "Modify system settings", then they toggle again.
            try {
                val i = Intent(android.provider.Settings.ACTION_MANAGE_WRITE_SETTINGS,
                    android.net.Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(i)
                Toast.makeText(ctx, "Allow ‘Modify system settings’, then tap the rotation toggle again",
                    Toast.LENGTH_LONG).show()
            } catch (e: Exception) { /* ignore */ }
        }
    }

    @JavascriptInterface
    fun isRotationLocked(): Boolean =
        fragment.requireContext().getSharedPreferences("kalamos_prefs", android.content.Context.MODE_PRIVATE)
            .getBoolean("rotation_locked", true)   // default: locked (no accelerometer) — the user's preference

    @JavascriptInterface
    fun setAutosaveStatus(status: String) {
        // UI indicator in toolbar is handled via web layer; could pipe to native status bar
    }

    @JavascriptInterface
    fun exportNotebook(notebookId: String) {
        val notebook = storageManager.loadNotebook(notebookId) ?: return
        val json = notebook.toJson().toString(2)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "${notebook.title}.json")
        }
        pendingExportBytes = json.toByteArray()
        exportLauncher.launch(intent)
    }

    /** Export app-generated text through Android's ordinary document picker. */
    @JavascriptInterface
    fun exportTextDocument(name: String, content: String) {
        fragment.requireActivity().runOnUiThread {
            pendingExportBytes = content.toByteArray(Charsets.UTF_8)
            exportLauncher.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "text/markdown"
                putExtra(Intent.EXTRA_TITLE, name)
            })
        }
    }

    @JavascriptInterface
    fun importTextDocument() {
        fragment.requireActivity().runOnUiThread {
            textImportLauncher.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/markdown", "text/plain", "text/x-markdown", "application/octet-stream"))
            })
        }
    }

    /** Separate, script-free print WebView; never alter the live writing surface. */
    @JavascriptInterface
    fun exportDocumentPdf(title: String, html: String) {
        fragment.requireActivity().runOnUiThread {
            val context = fragment.requireContext()
            val printView = android.webkit.WebView(context)
            printView.settings.javaScriptEnabled = false
            printView.webViewClient = object : android.webkit.WebViewClient() {
                override fun onPageFinished(view: android.webkit.WebView, url: String) {
                    view.webViewClient = android.webkit.WebViewClient()
                    val adapter = view.createPrintDocumentAdapter(title)
                    val retainedAdapter = object : android.print.PrintDocumentAdapter() {
                        override fun onStart() = adapter.onStart()
                        override fun onLayout(oldAttributes: android.print.PrintAttributes?, newAttributes: android.print.PrintAttributes?, signal: android.os.CancellationSignal?, callback: LayoutResultCallback?, extras: android.os.Bundle?) = adapter.onLayout(oldAttributes, newAttributes, signal, callback, extras)
                        override fun onWrite(pages: Array<out android.print.PageRange>?, destination: android.os.ParcelFileDescriptor?, signal: android.os.CancellationSignal?, callback: WriteResultCallback?) = adapter.onWrite(pages, destination, signal, callback)
                        override fun onFinish() { adapter.onFinish(); printView.destroy() }
                    }
                    val manager = context.getSystemService(android.content.Context.PRINT_SERVICE) as android.print.PrintManager
                    manager.print(title, retainedAdapter, android.print.PrintAttributes.Builder().build())
                }
            }
            printView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
        }
    }

    private val textImportLauncher = fragment.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == ComponentActivity.RESULT_OK) result.data?.data?.let { uri ->
            try {
                val resolver = fragment.requireContext().contentResolver
                var name = "Imported note.md"
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) name = cursor.getString(0) ?: name
                }
                val text = resolver.openInputStream(uri)?.use { input ->
                    // Bound accidental selection of large non-text files.
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        require(output.size() + count <= 10 * 1024 * 1024) { "Markdown file is too large" }
                        output.write(buffer, 0, count)
                    }
                    val bytes = output.toByteArray()
                    require(bytes.size <= 10 * 1024 * 1024) { "Markdown file is too large" }
                    bytes.toString(Charsets.UTF_8)
                } ?: return@let
                val payload = org.json.JSONObject().put("name", name).put("text", text).toString()
                fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)?.evaluateJavascript("window.onMarkdownImported && window.onMarkdownImported($payload)", null)
            } catch (e: Exception) { Toast.makeText(fragment.requireContext(), e.message ?: "Import failed", Toast.LENGTH_LONG).show() }
        }
    }

    @JavascriptInterface
    fun getAppDataDir(): String {
        return storageManager.getAppDataDir()
    }

    /** Current storage location + the available targets (internal + any SD card), with free space,
     *  for the Settings panel. JSON. */
    @JavascriptInterface
    fun getStorageInfo(): String {
        return try {
            val ctx = fragment.requireContext()
            val internal = ctx.filesDir
            val current = storageManager.currentRootPath()
            val locations = org.json.JSONArray()
            val fixedBooksRoot = ctx.packageName == "com.kalamos.books"
            if (!fixedBooksRoot) {
                locations.put(org.json.JSONObject().apply {
                    put("label", "Internal storage")
                    put("path", internal.absolutePath)
                    put("free", internal.freeSpace)
                    put("needsPermission", false)
                    put("current", current == internal.absolutePath)
                })
            }
            // Shared "internal storage" Kalamos folder — visible to file managers / a desktop
            // importer and persistent across reinstalls. Needs all-files access (java.io.File on a
            // non-private path). This is the recommended home for side-loaded books.
            val publicRoot = if (fixedBooksRoot)
                com.kalamos.notebook.storage.StorageConfig.publicAppRoot(ctx)
            else com.kalamos.notebook.storage.StorageConfig.PUBLIC_ROOT
            locations.put(org.json.JSONObject().apply {
                put("label", if (fixedBooksRoot) "Shared storage (Kalamos/books)" else "Shared storage (Kalamos)")
                put("path", publicRoot.absolutePath)
                put("free", android.os.Environment.getExternalStorageDirectory().freeSpace)
                put("needsPermission", true)
                put("current", current == publicRoot.absolutePath)
            })
            if (!fixedBooksRoot) com.kalamos.notebook.storage.StorageConfig.externalVolumeRoots(ctx).forEach { vol ->
                if (!vol.absolutePath.startsWith("/storage/emulated")) {
                    val target = java.io.File(vol, "Kalamos")
                    locations.put(org.json.JSONObject().apply {
                        put("label", "SD card")
                        put("path", target.absolutePath)
                        put("free", vol.freeSpace)
                        put("needsPermission", true)
                        put("current", current == target.absolutePath)
                    })
                }
            }
            org.json.JSONObject().apply {
                put("currentPath", current)
                put("dataSize", storageManager.dataSizeBytes())
                put("hasAllFilesAccess", com.kalamos.notebook.storage.StorageConfig.hasAllFilesAccess())
                put("fixedStorage", fixedBooksRoot)
                put("locations", locations)
            }.toString()
        } catch (e: Exception) {
            "{\"locations\":[]}"
        }
    }

    /** Migrate the notebooks to [targetPath] and make it the active root. Returns "ok",
     *  "need_permission" (caller should call requestAllFilesAccess then retry), or "error: …".
     *  The old data is left in place (not deleted) as a safety net. */
    @JavascriptInterface
    fun setStorageLocation(targetPath: String): String {
        return try {
            val ctx = fragment.requireContext()
            if (ctx.packageName == "com.kalamos.books") {
                val canonical = com.kalamos.notebook.storage.StorageConfig.publicAppRoot(ctx).absolutePath
                return if (targetPath == canonical) "ok" else "error: Books always uses $canonical"
            }
            val target = java.io.File(targetPath)
            val isInternal = targetPath == ctx.filesDir.absolutePath
            if (!isInternal && !com.kalamos.notebook.storage.StorageConfig.hasAllFilesAccess()) {
                return "need_permission"
            }
            if (!storageManager.migrateTo(target)) return "error: migration failed"
            com.kalamos.notebook.storage.StorageConfig.setRoot(ctx, if (isInternal) null else targetPath)
            "ok"
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    /** Launch the system folder picker (SAF). On pick, we resolve the tree URI to a real filesystem
     *  path and migrate there (keeping fast java.io.File access), then call
     *  window.onStorageFolderPicked(status, path). */
    @JavascriptInterface
    fun pickStorageFolder() {
        fragment.requireActivity().runOnUiThread {
            try {
                folderPickerLauncher.launch(null)
            } catch (e: Exception) {
                notifyStorageJs("error", "")
            }
        }
    }

    /** Resolve a SAF tree URI (externalstorage provider) to a filesystem path. Handles the primary
     *  shared volume ("primary:Sub") and removable volumes ("XXXX-XXXX:Sub"). Returns null for
     *  non-filesystem providers (cloud), which we can't use with direct file access. */
    private fun resolveTreeUriToPath(uri: android.net.Uri): String? {
        return try {
            val docId = android.provider.DocumentsContract.getTreeDocumentId(uri)
            val parts = docId.split(":", limit = 2)
            val volId = parts[0]
            val sub = if (parts.size > 1) parts[1] else ""
            val base = if (volId.equals("primary", ignoreCase = true))
                android.os.Environment.getExternalStorageDirectory().absolutePath
            else "/storage/$volId"
            if (sub.isEmpty()) base else "$base/$sub"
        } catch (e: Exception) {
            null
        }
    }

    private fun notifyStorageJs(status: String, path: String) {
        fragment.requireActivity().runOnUiThread {
            val wv = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
            wv?.evaluateJavascript(
                "window.onStorageFolderPicked && window.onStorageFolderPicked('$status', ${org.json.JSONObject.quote(path)})",
                null
            )
        }
    }

    private val folderPickerLauncher = fragment.registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: android.net.Uri? ->
        if (uri == null) { notifyStorageJs("cancelled", ""); return@registerForActivityResult }
        val path = resolveTreeUriToPath(uri)
        if (path == null) { notifyStorageJs("unresolved", ""); return@registerForActivityResult }
        if (!com.kalamos.notebook.storage.StorageConfig.hasAllFilesAccess()) {
            notifyStorageJs("need_permission", path); return@registerForActivityResult
        }
        // Migrate off the main thread (could be large), then switch the active root + notify JS.
        Thread {
            val ok = storageManager.migrateTo(java.io.File(path))
            if (ok) com.kalamos.notebook.storage.StorageConfig.setRoot(fragment.requireContext(), path)
            notifyStorageJs(if (ok) "ok" else "error", path)
        }.start()
    }

    /** Open the system screen to grant "All files access" (needed for non-private folders like the
     *  SD card). */
    @JavascriptInterface
    fun requestAllFilesAccess() {
        if (com.kalamos.notebook.storage.StorageConfig.hasAllFilesAccess()) return
        try {
            val intent = Intent(
                android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                android.net.Uri.parse("package:" + fragment.requireContext().packageName)
            )
            fragment.startActivity(intent)
        } catch (e: Exception) {
            try {
                fragment.startActivity(Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            } catch (e2: Exception) { /* ignore */ }
        }
    }

    private var pendingExportBytes: ByteArray? = null

    private val exportLauncher = fragment.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == ComponentActivity.RESULT_OK) {
            result.data?.data?.let { uri ->
                try {
                    fragment.requireContext().contentResolver.openOutputStream(uri)?.use { out ->
                        out.write(pendingExportBytes ?: return@use)
                    }
                    fragment.requireActivity().runOnUiThread {
                        fragment.requireActivity().supportFragmentManager.executePendingTransactions()
                        val webView = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
                        webView?.evaluateJavascript("window.onExportComplete(true)", null)
                    }
                } catch (e: Exception) {
                    fragment.requireActivity().runOnUiThread {
                        val webView = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
                        webView?.evaluateJavascript("window.onExportComplete(false)", null)
                    }
                }
            }
        } else {
            fragment.requireActivity().runOnUiThread {
                val webView = fragment.view?.findViewById<android.webkit.WebView>(com.kalamos.foundation.runtime.R.id.webView)
                webView?.evaluateJavascript("window.onExportComplete(false)", null)
            }
        }
        pendingExportBytes = null
    }
}
