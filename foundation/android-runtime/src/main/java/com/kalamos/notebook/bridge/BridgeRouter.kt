package com.kalamos.notebook.bridge

import android.webkit.JavascriptInterface

/**
 * Stable @JavascriptInterface bound ONCE to the reused editor WebView. Changes to
 * addJavascriptInterface only take effect on a page (re)load, so a reused WebView would keep its
 * first session's bridge. Instead we bind this router permanently and swap [delegate] per editor
 * session — the JS always calls the same object, which forwards to the live AndroidBridge.
 */
class BridgeRouter {

    @Volatile
    var delegate: AndroidBridge? = null

    @JavascriptInterface fun saveLibrary(json: String): String = delegate?.saveLibrary(json) ?: "error: no delegate"
    @JavascriptInterface fun loadLibrary(): String = delegate?.loadLibrary() ?: "{}"
    @JavascriptInterface fun savePage(notebookId: String, pageId: String, json: String): String = delegate?.savePage(notebookId, pageId, json) ?: "error: no delegate"
    @JavascriptInterface fun saveMeta(notebookId: String, json: String): String = delegate?.saveMeta(notebookId, json) ?: "error: no delegate"
    @JavascriptInterface fun loadMeta(notebookId: String): String = delegate?.loadMeta(notebookId) ?: "null"
    @JavascriptInterface fun peekMeta(notebookId: String): String = delegate?.peekMeta(notebookId) ?: "null"
    @JavascriptInterface fun peekMetas(notebookIdsJson: String): String = delegate?.peekMetas(notebookIdsJson) ?: "{}"
    @JavascriptInterface fun loadPage(notebookId: String, pageId: String): String = delegate?.loadPage(notebookId, pageId) ?: "[]"
    @JavascriptInterface fun loadNotebookRaw(notebookId: String): String = delegate?.loadNotebookRaw(notebookId) ?: "null"
    @JavascriptInterface fun deleteNotebook(notebookId: String): String = delegate?.deleteNotebook(notebookId) ?: "error: no delegate"
    @JavascriptInterface fun attachInk(left: Int, top: Int, right: Int, bottom: Int): Boolean = delegate?.attachInk(left, top, right, bottom) ?: false
    @JavascriptInterface fun detachInk() { delegate?.detachInk() }
    @JavascriptInterface fun resumeInkBox(left: Int, top: Int, right: Int, bottom: Int) { delegate?.resumeInkBox(left, top, right, bottom) }
    @JavascriptInterface fun attachInkBox(left: Int, top: Int, right: Int, bottom: Int) { delegate?.attachInkBox(left, top, right, bottom) }
    @JavascriptInterface fun detachInkBox() { delegate?.detachInkBox() }
    @JavascriptInterface fun detachInkBoxCleared() { delegate?.detachInkBoxCleared() }
    @JavascriptInterface fun detachInkBoxForWeb() { delegate?.detachInkBoxForWeb() }
    @JavascriptInterface fun showWebWorkspace() { delegate?.showWebWorkspace() }
    @JavascriptInterface fun supportsPersistentDisplayHandoff(): Boolean =
        delegate?.supportsPersistentDisplayHandoff() ?: true
    @JavascriptInterface fun setInkStyle(widthPx: Float, colorHex: String) { delegate?.setInkStyle(widthPx, colorHex) }
    @JavascriptInterface fun setInkEnabled(enabled: Boolean) { delegate?.setInkEnabled(enabled) }
    @JavascriptInterface fun isInkSessionAttached(): Boolean = delegate?.isInkSessionAttached() ?: false
    @JavascriptInterface fun isInkTraceEnabled(): Boolean = delegate?.isInkTraceEnabled() ?: false
    @JavascriptInterface fun traceInkEvent(name: String, json: String) { delegate?.traceInkEvent(name, json) }
    @JavascriptInterface fun traceInkSession(notebook: String, page: String, phase: String) { delegate?.traceInkSession(notebook, page, phase) }
    @JavascriptInterface fun renderInk(json: String) { delegate?.renderInk(json) }
    @JavascriptInterface fun flushInk() { delegate?.flushInk() }
    @JavascriptInterface fun snapshotToolbar(heightPx: Int) { delegate?.snapshotToolbar(heightPx) }
    @JavascriptInterface fun snapshotToolbarRegion(left: Int, top: Int, right: Int, bottom: Int) { delegate?.snapshotToolbarRegion(left, top, right, bottom) }
    @JavascriptInterface fun refreshChrome() { delegate?.refreshChrome() }
    @JavascriptInterface fun clearMenuSnapshot() { delegate?.clearMenuSnapshot() }
    @JavascriptInterface fun snapshotMenu(left: Int, top: Int, right: Int, bottom: Int, refreshLeft: Int, refreshTop: Int, refreshRight: Int, refreshBottom: Int) { delegate?.snapshotMenu(left, top, right, bottom, refreshLeft, refreshTop, refreshRight, refreshBottom) }
    @JavascriptInterface fun snapshotContent(left: Int, top: Int, right: Int, bottom: Int) { delegate?.snapshotContent(left, top, right, bottom) }
    @JavascriptInterface fun snapshotContentPartial(left: Int, top: Int, right: Int, bottom: Int, rl: Int, rt: Int, rr: Int, rb: Int) { delegate?.snapshotContentPartial(left, top, right, bottom, rl, rt, rr, rb) }
    @JavascriptInterface fun skipWakeRefresh() { delegate?.skipWakeRefresh() }
    @JavascriptInterface fun clearContent() { delegate?.clearContent() }
    @JavascriptInterface fun getNotebookAsset(notebookId: String, relPath: String): String = delegate?.getNotebookAsset(notebookId, relPath) ?: ""
    @JavascriptInterface fun getNotebookAssets(notebookId: String, relPathsJson: String): String = delegate?.getNotebookAssets(notebookId, relPathsJson) ?: "{}"
    @JavascriptInterface fun getNotebookAssetDims(notebookId: String, relPathsJson: String): String = delegate?.getNotebookAssetDims(notebookId, relPathsJson) ?: "{}"
    @JavascriptInterface fun getBookFile(notebookId: String, relPath: String): String = delegate?.getBookFile(notebookId, relPath) ?: ""
    @JavascriptInterface fun getNotebookFile(notebookId: String, relPath: String): String = delegate?.getNotebookFile(notebookId, relPath) ?: ""
    @JavascriptInterface fun getBookFiles(notebookId: String, relPathsJson: String): String = delegate?.getBookFiles(notebookId, relPathsJson) ?: "{}"
    @JavascriptInterface fun requestBookFile(notebookId: String, relPath: String, requestId: String) { delegate?.requestBookFile(notebookId, relPath, requestId) }
    @JavascriptInterface fun saveBookFile(notebookId: String, relPath: String, content: String): String = delegate?.saveBookFile(notebookId, relPath, content) ?: "error"
    @JavascriptInterface fun saveBookAssetDataUrl(notebookId: String, relPath: String, dataUrl: String): String = delegate?.saveBookAssetDataUrl(notebookId, relPath, dataUrl) ?: "error: no delegate"
    @JavascriptInterface fun saveNotebookFile(notebookId: String, relPath: String, content: String): String = delegate?.saveNotebookFile(notebookId, relPath, content) ?: "error"
    @JavascriptInterface fun epubOpen(notebookId: String): String = delegate?.epubOpen(notebookId) ?: "error: no delegate"
    @JavascriptInterface fun requestEpubOpen(notebookId: String, requestId: String) { delegate?.requestEpubOpen(notebookId, requestId) }
    @JavascriptInterface fun epubManifest(notebookId: String): String = delegate?.epubManifest(notebookId) ?: "null"
    @JavascriptInterface fun epubEntry(notebookId: String, zipPath: String): String = delegate?.epubEntry(notebookId, zipPath) ?: ""
    @JavascriptInterface fun epubAssetDataUrl(notebookId: String, zipPath: String): String = delegate?.epubAssetDataUrl(notebookId, zipPath) ?: ""
    @JavascriptInterface fun epubClose(notebookId: String) { delegate?.epubClose(notebookId) }
    @JavascriptInterface fun searchBook(notebookId: String, query: String, token: String) { delegate?.searchBook(notebookId, query, token) }
    @JavascriptInterface fun pdfOpen(notebookId: String): String = delegate?.pdfOpen(notebookId) ?: "error: no delegate"
    @JavascriptInterface fun pdfClose(notebookId: String) { delegate?.pdfClose(notebookId) }
    @JavascriptInterface fun pdfPageDataUrl(notebookId: String, pageIndex: Int, w: Int, e: Int, d: Int, crop: String): String = delegate?.pdfPageDataUrl(notebookId, pageIndex, w, e, d, crop) ?: ""
    @JavascriptInterface fun pdfOutline(notebookId: String): String = delegate?.pdfOutline(notebookId) ?: "[]"
    @JavascriptInterface fun requestPdfOutline(notebookId: String, requestId: String) { delegate?.requestPdfOutline(notebookId, requestId) }
    @JavascriptInterface fun pdfPageText(notebookId: String, pageIndex: Int): String = delegate?.pdfPageText(notebookId, pageIndex) ?: ""
    @JavascriptInterface fun pdfPageTextLayout(notebookId: String, pageIndex: Int): String = delegate?.pdfPageTextLayout(notebookId, pageIndex) ?: "{}"
    @JavascriptInterface fun requestPdfPageTextLayout(notebookId: String, pageIndex: Int, requestId: String) { delegate?.requestPdfPageTextLayout(notebookId, pageIndex, requestId) }
    @JavascriptInterface fun pdfPagesText(notebookId: String, from: Int, to: Int): String = delegate?.pdfPagesText(notebookId, from, to) ?: "[]"
    @JavascriptInterface fun pdfHasTextLayer(notebookId: String): Boolean = delegate?.pdfHasTextLayer(notebookId) ?: false
    @JavascriptInterface fun requestPdfHasTextLayer(notebookId: String, requestId: String) { delegate?.requestPdfHasTextLayer(notebookId, requestId) }
    @JavascriptInterface fun exportAnnotatedPdf(notebookId: String) { delegate?.exportAnnotatedPdf(notebookId) }
    @JavascriptInterface fun hwrStatus(lang: String): String = delegate?.hwrStatus(lang) ?: "unavailable"
    @JavascriptInterface fun hwrDownload(lang: String): String = delegate?.hwrDownload(lang) ?: "{\"err\":\"no delegate\"}"
    @JavascriptInterface fun hwrRecognize(argsJson: String): String = delegate?.hwrRecognize(argsJson) ?: "{\"err\":\"no delegate\"}"
    @JavascriptInterface fun setWritingTop(topPx: Int) { delegate?.setWritingTop(topPx) }
    @JavascriptInterface fun setWritingExclusion(left: Int, top: Int, right: Int, bottom: Int) { delegate?.setWritingExclusion(left, top, right, bottom) }
    @JavascriptInterface fun setWritingBounds(left: Int, top: Int, right: Int, bottom: Int) { delegate?.setWritingBounds(left, top, right, bottom) }
    @JavascriptInterface fun setErasing(active: Boolean) { delegate?.setErasing(active) }
    @JavascriptInterface fun setPenType(type: String) { delegate?.setPenType(type) }
    @JavascriptInterface fun startWebAnim(left: Int, top: Int, right: Int, bottom: Int) { delegate?.startWebAnim(left, top, right, bottom) }
    @JavascriptInterface fun setInteractivePanel(active: Boolean) { delegate?.setInteractivePanel(active) }
    @JavascriptInterface fun stopWebAnim() { delegate?.stopWebAnim() }
    @JavascriptInterface fun captureThumbnail(notebookId: String) { delegate?.captureThumbnail(notebookId) }
    @JavascriptInterface fun captureWebThumbnail(notebookId: String, left: Int, top: Int, right: Int, bottom: Int) { delegate?.captureWebThumbnail(notebookId, left, top, right, bottom) }
    @JavascriptInterface fun saveThumbnailDataUrl(notebookId: String, dataUrl: String): String = delegate?.saveThumbnailDataUrl(notebookId, dataUrl) ?: "error: no delegate"
    @JavascriptInterface fun getThumbnailDataUrl(notebookId: String): String = delegate?.getThumbnailDataUrl(notebookId) ?: ""
    @JavascriptInterface fun ensureCovers(idsJson: String) { delegate?.ensureCovers(idsJson) }
    @JavascriptInterface fun scanForNewBooks() { delegate?.scanForNewBooks() }
    @JavascriptInterface fun pickBooksToImport() { delegate?.pickBooksToImport() }
    @JavascriptInterface fun searchOnlineBookMetadata(notebookId: String, query: String, token: String) {
        delegate?.searchOnlineBookMetadata(notebookId, query, token)
    }
    @JavascriptInterface fun enterEditor() { delegate?.enterEditor() }
    @JavascriptInterface fun showEditor() { delegate?.showEditor() }
    @JavascriptInterface fun enterLibrary() { delegate?.enterLibrary() }
    @JavascriptInterface fun setImmersive(on: Boolean) { delegate?.setImmersive(on) }
    @JavascriptInterface fun exitApp() { delegate?.exitApp() }
    @JavascriptInterface fun showToast(message: String) { delegate?.showToast(message) }
    @JavascriptInterface fun setRotationLocked(locked: Boolean) { delegate?.setRotationLocked(locked) }
    @JavascriptInterface fun isRotationLocked(): Boolean = delegate?.isRotationLocked() ?: true
    @JavascriptInterface fun setAutosaveStatus(status: String) { delegate?.setAutosaveStatus(status) }
    @JavascriptInterface fun exportTextDocument(name: String, content: String) { delegate?.exportTextDocument(name, content) }
    @JavascriptInterface fun importTextDocument() { delegate?.importTextDocument() }
    @JavascriptInterface fun exportDocumentPdf(title: String, html: String) { delegate?.exportDocumentPdf(title, html) }
    @JavascriptInterface fun exportNotebook(notebookId: String) { delegate?.exportNotebook(notebookId) }
    @JavascriptInterface fun getAppDataDir(): String = delegate?.getAppDataDir() ?: ""
    @JavascriptInterface fun getStorageInfo(): String = delegate?.getStorageInfo() ?: "{\"locations\":[]}"
    @JavascriptInterface fun setStorageLocation(targetPath: String): String = delegate?.setStorageLocation(targetPath) ?: "error: no delegate"
    @JavascriptInterface fun requestAllFilesAccess() { delegate?.requestAllFilesAccess() }
    @JavascriptInterface fun pickStorageFolder() { delegate?.pickStorageFolder() }
}
