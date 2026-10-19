const Bridge = {
  isInkSessionAttached() {
    try { return AndroidBridge.isInkSessionAttached() === true } catch (_) { return true }
  },
  isInkTraceEnabled() {
    try { return AndroidBridge.isInkTraceEnabled() === true } catch (_) { return false }
  },
  traceInkSession(notebook, page, phase) {
    try { AndroidBridge.traceInkSession(notebook, page, phase) } catch (_) { }
  },
  traceInkEvent(name, json) {
    try { AndroidBridge.traceInkEvent(name, json) } catch (_) { }
  },

  saveLibrary(json) {
    try {
      return AndroidBridge.saveLibrary(json)
    } catch (e) {
      console.warn('Bridge.saveLibrary error:', e)
      return 'error: ' + e.message
    }
  },

  // Full-screen reading: hide (true) / restore (false) the Android status + navigation bars. No-op in the
  // browser preview (no AndroidBridge) — there the status bar is browser chrome anyway.
  setImmersive(on) {
    try { AndroidBridge.setImmersive(!!on) } catch (e) { /* preview: no native bridge */ }
  },

  // ---- Handwriting recognition (shared seam; MyScript iink with per-app fallback) ----
  // Async results arrive via window.onHwrEvent(jsonString):
  //   {id, kind:'hwr', type:'result', mode:'text', candidates:[{text}], words:[...]}
  //   {id, kind:'hwr', type:'result', mode:'gesture'|'shape', candidates:[{label}]}
  //   | {type:'done'} | {type:'error', message}

  /** 'ready' | 'downloading' | 'absent' | 'unavailable' for a BCP-47 lang like 'en-US'. */
  hwrStatus(lang) {
    try { return AndroidBridge.hwrStatus(lang || 'en-US') } catch (e) { return 'unavailable' }
  },

  /** Start a language-pack download; returns {reqId} or {err}. Progress/done/error → onHwrEvent. */
  hwrDownload(lang) {
    try { return JSON.parse(AndroidBridge.hwrDownload(lang || 'en-US')) } catch (e) { return { err: 'unavailable' } }
  },

  /** Recognize strokes ({mode?:'text'|'gesture'|'shape', lang, strokes:[[[x,y,p],...]], area?, preContext?}); returns {reqId} or
   *  {err}. The result arrives as an onHwrEvent with the same reqId. */
  hwrRecognize(args) {
    try { return JSON.parse(AndroidBridge.hwrRecognize(JSON.stringify(args || {}))) } catch (e) { return { err: 'unavailable' } }
  },

  loadLibrary() {
    try {
      return AndroidBridge.loadLibrary()
    } catch (e) {
      console.warn('Bridge.loadLibrary error:', e)
      return '{}'
    }
  },

  savePage(notebookId, pageId, json) {
    try {
      return AndroidBridge.savePage(notebookId, pageId, json)
    } catch (e) {
      console.warn('Bridge.savePage error:', e)
      return 'error: ' + e.message
    }
  },

  saveMeta(notebookId, json) {
    try {
      return AndroidBridge.saveMeta(notebookId, json)
    } catch (e) {
      console.warn('Bridge.saveMeta error:', e)
      return 'error: ' + e.message
    }
  },

  loadNotebookRaw(notebookId) {
    try {
      return AndroidBridge.loadNotebookRaw(notebookId)
    } catch (e) {
      console.warn('Bridge.loadNotebookRaw error:', e)
      return 'null'
    }
  },

  loadMeta(notebookId) {
    try { return AndroidBridge.loadMeta(notebookId) } catch (e) { console.warn('Bridge.loadMeta error:', e); return 'null' }
  },

  peekMeta(notebookId) {
    try { return AndroidBridge.peekMeta(notebookId) } catch (e) { console.warn('Bridge.peekMeta error:', e); return 'null' }
  },

  // Visible-library-page batch: {notebookId: parsedMeta}. Keep peekMeta as the compatibility
  // fallback; this method exists to collapse ~9 costly JS/native crossings into one.
  peekMetas(notebookIds) {
    try { return JSON.parse(AndroidBridge.peekMetas(JSON.stringify(notebookIds || []))) }
    catch (e) { console.warn('Bridge.peekMetas error:', e); return null }
  },

  loadPage(notebookId, pageId) {
    try { return AndroidBridge.loadPage(notebookId, pageId) } catch (e) { console.warn('Bridge.loadPage error:', e); return '[]' }
  },

  deleteNotebook(notebookId) {
    try {
      return AndroidBridge.deleteNotebook(notebookId)
    } catch (e) {
      console.warn('Bridge.deleteNotebook error:', e)
      return 'error: ' + e.message
    }
  },

  attachInk(left, top, right, bottom) {
    try {
      return AndroidBridge.attachInk(left, top, right, bottom)
    } catch (e) {
      console.warn('Bridge.attachInk error:', e)
      return false
    }
  },

  detachInk() {
    try {
      AndroidBridge.detachInk()
    } catch (e) {
      console.warn('Bridge.detachInk error:', e)
    }
  },

  resumeInkBox(left, top, right, bottom) {
    try { AndroidBridge.resumeInkBox(left, top, right, bottom) } catch (e) { this.attachInkBox(left, top, right, bottom) }
  },
  attachInkBox(left, top, right, bottom) {
    try { AndroidBridge.attachInkBox(left, top, right, bottom) } catch (e) { console.warn('Bridge.attachInkBox error:', e) }
  },

  detachInkBox() {
    try { AndroidBridge.detachInkBox() } catch (e) { console.warn('Bridge.detachInkBox error:', e) }
  },

  detachInkBoxCleared() {
    try { AndroidBridge.detachInkBoxCleared() } catch (e) { console.warn('Bridge.detachInkBoxCleared error:', e) }
  },

  // Full-editor tool handoff: unlike reader detach (which fires reader callbacks) and hard detach
  // (which paints white), this exposes the already-rendered WebView without a blank transition.
  detachInkBoxForWeb() {
    try { AndroidBridge.detachInkBoxForWeb() } catch (e) { console.warn('Bridge.detachInkBoxForWeb error:', e) }
  },

  showWebWorkspace() {
    try { AndroidBridge.showWebWorkspace() } catch (e) { console.warn('Bridge.showWebWorkspace error:', e) }
  },

  // Capability, not manufacturer detection. Default true is intentionally Bigme-safe for an older
  // native shell: only a current Standard provider returns false and activates the HTML-canvas page.
  supportsPersistentDisplayHandoff() {
    try { return !!AndroidBridge.supportsPersistentDisplayHandoff() } catch (e) { return true }
  },

  setInkStyle(widthPx, colorHex) {
    try {
      AndroidBridge.setInkStyle(widthPx, colorHex)
    } catch (e) {
      console.warn('Bridge.setInkStyle error:', e)
    }
  },

  setInkEnabled(enabled) {
    try {
      AndroidBridge.setInkEnabled(enabled)
    } catch (e) {
      console.warn('Bridge.setInkEnabled error:', e)
    }
  },


  renderInk(json) {
    try {
      AndroidBridge.renderInk(json)
    } catch (e) {
      console.warn('Bridge.renderInk error:', e)
    }
  },

  flushInk() {
    try {
      AndroidBridge.flushInk()
    } catch (e) {
      console.warn('Bridge.flushInk error:', e)
    }
  },

  snapshotToolbar(heightPx) {
    try {
      AndroidBridge.snapshotToolbar(heightPx)
    } catch (e) {
      console.warn('Bridge.snapshotToolbar error:', e)
    }
  },

  snapshotToolbarRegion(left, top, right, bottom) {
    try {
      AndroidBridge.snapshotToolbarRegion(left, top, right, bottom)
    } catch (e) {
      console.warn('Bridge.snapshotToolbarRegion error:', e)
    }
  },

  // Full-screen refresh of the composited page + chrome bars. Called once after the open bake
  // because per-bar region refreshes don't reliably land on the e-ink panel.
  refreshChrome() {
    try {
      AndroidBridge.refreshChrome()
    } catch (e) {
      console.warn('Bridge.refreshChrome error:', e)
    }
  },

  snapshotMenu(left, top, right, bottom, rl, rt, rr, rb) {
    try {
      AndroidBridge.snapshotMenu(left, top, right, bottom, rl, rt, rr, rb)
    } catch (e) {
      console.warn('Bridge.snapshotMenu error:', e)
    }
  },

  snapshotContent(left, top, right, bottom) {
    try { AndroidBridge.snapshotContent(left, top, right, bottom) } catch (e) { console.warn('Bridge.snapshotContent error:', e) }
  },

  snapshotContentPartial(left, top, right, bottom, rl, rt, rr, rb) {
    try { AndroidBridge.snapshotContentPartial(left, top, right, bottom, rl, rt, rr, rb) } catch (e) { console.warn('Bridge.snapshotContentPartial error:', e) }
  },

  skipWakeRefresh() {
    try { AndroidBridge.skipWakeRefresh() } catch (e) { console.warn('Bridge.skipWakeRefresh error:', e) }
  },

  clearContent() {
    try { AndroidBridge.clearContent() } catch (e) { console.warn('Bridge.clearContent error:', e) }
  },

  getNotebookAsset(notebookId, relPath) {
    try { return AndroidBridge.getNotebookAsset(notebookId, relPath) } catch (e) { console.warn('Bridge.getNotebookAsset error:', e); return '' }
  },

  // Batch form of getNotebookAsset: ONE bridge round-trip for many images. Each sync JS→native call
  // costs ~tens of ms on-device, so N images through the single-asset path cost seconds. Returns a
  // {relPath: dataUrl} object, or null when the native method is unavailable (older native build /
  // browser preview fake bridge) so callers can fall back to per-asset reads.
  getNotebookAssets(notebookId, relPaths) {
    try { return JSON.parse(AndroidBridge.getNotebookAssets(notebookId, JSON.stringify(relPaths))) } catch (e) { return null }
  },

  getBookFile(notebookId, relPath) {
    try { return AndroidBridge.getBookFile(notebookId, relPath) } catch (e) { console.warn('Bridge.getBookFile error:', e); return '' }
  },

  // Writing source/sidecar files live beside notebook metadata. Keeping this separate from
  // getBookFile prevents a Planning save from creating a same-id books/ record that can hide the
  // notebook's `kind: planning` metadata.
  getNotebookFile(notebookId, relPath) {
    try { return AndroidBridge.getNotebookFile(notebookId, relPath) } catch (e) { console.warn('Bridge.getNotebookFile error:', e); return '' }
  },

  // Batch form of getBookFile (same rationale/contract as getNotebookAssets): {relPath: content}
  // object, or null when unavailable so callers fall back to per-file reads.
  getBookFiles(notebookId, relPaths) {
    try { return JSON.parse(AndroidBridge.getBookFiles(notebookId, JSON.stringify(relPaths))) } catch (e) { return null }
  },

  // Batch image-dimension probe (headers only, no pixel decode): {relPath: [w, h]} for each readable
  // image, or null when unavailable. Lets the reader reserve exact image boxes and stream the pixels
  // asynchronously via kalamos.content/nbasset — fast open with zero layout shift.
  getNotebookAssetDims(notebookId, relPaths) {
    try { return JSON.parse(AndroidBridge.getNotebookAssetDims(notebookId, JSON.stringify(relPaths))) } catch (e) { return null }
  },

  saveBookFile(notebookId, relPath, content) {
    try { return AndroidBridge.saveBookFile(notebookId, relPath, content) } catch (e) { console.warn('Bridge.saveBookFile error:', e); return 'error' }
  },

  // Closed binary write surface for approved generated workbook rasters. Native code accepts only
  // content-addressed PNG/JPEG/WebP data URLs under the interaction group's assets sidecar.
  saveBookAssetDataUrl(notebookId, relPath, dataUrl) {
    try { return AndroidBridge.saveBookAssetDataUrl(notebookId, relPath, dataUrl) } catch (e) { console.warn('Bridge.saveBookAssetDataUrl error:', e); return 'error: unavailable' }
  },

  saveNotebookFile(notebookId, relPath, content) {
    try { return AndroidBridge.saveNotebookFile(notebookId, relPath, content) } catch (e) { console.warn('Bridge.saveNotebookFile error:', e); return 'error' }
  },

  epubOpen(notebookId) {
    try { return AndroidBridge.epubOpen(notebookId) } catch (e) { console.warn('Bridge.epubOpen error:', e); return 'error: ' + e.message }
  },

  requestEpubOpen(notebookId, requestId) {
    try {
      if (typeof AndroidBridge.requestEpubOpen === 'function') {
        AndroidBridge.requestEpubOpen(notebookId, requestId)
        return
      }
    } catch (e) { console.warn('Bridge.requestEpubOpen error:', e) }
    // Browser/older-host compatibility only. Android builds expose the worker-backed method above.
    setTimeout(() => {
      const result = this.epubOpen(notebookId)
      const manifest = result.indexOf('ok') === 0 ? this.epubManifest(notebookId) : 'null'
      if (typeof window.onEpubOpenReady === 'function') {
        window.onEpubOpenReady(requestId, result, manifest)
      }
    }, 0)
  },

  epubManifest(notebookId) {
    try { return AndroidBridge.epubManifest(notebookId) } catch (e) { console.warn('Bridge.epubManifest error:', e); return 'null' }
  },

  epubEntry(notebookId, zipPath) {
    try { return AndroidBridge.epubEntry(notebookId, zipPath) } catch (e) { console.warn('Bridge.epubEntry error:', e); return '' }
  },

  epubAssetDataUrl(notebookId, zipPath) {
    try { return AndroidBridge.epubAssetDataUrl(notebookId, zipPath) } catch (e) { console.warn('Bridge.epubAssetDataUrl error:', e); return '' }
  },

  epubClose(notebookId) {
    try { AndroidBridge.epubClose(notebookId) } catch (e) { console.warn('Bridge.epubClose error:', e) }
  },

  searchBook(notebookId, query, token) {
    try { AndroidBridge.searchBook(notebookId, query, token) } catch (e) { console.warn('Bridge.searchBook error:', e) }
  },

  // ── PDF backend (AD-2/AD-3/AD-9). Rendered pages normally arrive via an <img> pointed at the
  // `https://kalamos.content/pdf/<id>/<page>.png?w=&e=&d=&crop=` virtual host (BookContentInterceptor,
  // the primary path) — pdfPageDataUrl below is only the base64 fallback + preview path. ──
  pdfOpen(notebookId) {
    try { return AndroidBridge.pdfOpen(notebookId) } catch (e) { console.warn('Bridge.pdfOpen error:', e); return 'error: ' + e.message }
  },

  pdfClose(notebookId) {
    try { AndroidBridge.pdfClose(notebookId) } catch (e) { console.warn('Bridge.pdfClose error:', e) }
  },

  pdfPageDataUrl(notebookId, pageIndex, w, e, d, crop) {
    try { return AndroidBridge.pdfPageDataUrl(notebookId, pageIndex, w, e, d, crop) } catch (err) { console.warn('Bridge.pdfPageDataUrl error:', err); return '' }
  },

  // ── PDF text backend (AD-2/AD-9, WP8) — app-owned pdfbox seam via BookServices.pdfText. ──
  pdfOutline(notebookId) {
    try { return AndroidBridge.pdfOutline(notebookId) } catch (e) { console.warn('Bridge.pdfOutline error:', e); return '[]' }
  },

  requestBookFile(notebookId, relPath, requestId) {
    try { AndroidBridge.requestBookFile(notebookId, relPath, requestId) }
    catch (e) { if (window.onBookFileReady) window.onBookFileReady(requestId, '') }
  },

  requestPdfOutline(notebookId, requestId) {
    try { AndroidBridge.requestPdfOutline(notebookId, requestId) }
    catch (e) { if (window.onPdfOutline) window.onPdfOutline(requestId, '[]') }
  },

  pdfPageText(notebookId, pageIndex) {
    try { return AndroidBridge.pdfPageText(notebookId, pageIndex) } catch (e) { console.warn('Bridge.pdfPageText error:', e); return '' }
  },

  pdfPageTextLayout(notebookId, pageIndex) {
    try { return AndroidBridge.pdfPageTextLayout(notebookId, pageIndex) } catch (e) { console.warn('Bridge.pdfPageTextLayout error:', e); return '{}' }
  },

  requestPdfPageTextLayout(notebookId, pageIndex, requestId) {
    try { AndroidBridge.requestPdfPageTextLayout(notebookId, pageIndex, requestId) }
    catch (e) { if (window.onPdfTextLayout) window.onPdfTextLayout(requestId, '{}') }
  },

  pdfPagesText(notebookId, from, to) {
    try { return AndroidBridge.pdfPagesText(notebookId, from, to) } catch (e) { console.warn('Bridge.pdfPagesText error:', e); return '[]' }
  },

  pdfHasTextLayer(notebookId) {
    try { return !!AndroidBridge.pdfHasTextLayer(notebookId) } catch (e) { console.warn('Bridge.pdfHasTextLayer error:', e); return false }
  },

  requestPdfHasTextLayer(notebookId, requestId) {
    try { AndroidBridge.requestPdfHasTextLayer(notebookId, requestId) }
    catch (e) { if (window.onPdfHasTextLayer) window.onPdfHasTextLayer(requestId, false) }
  },

  exportAnnotatedPdf(notebookId) {
    try { AndroidBridge.exportAnnotatedPdf(notebookId) } catch (e) { console.warn('Bridge.exportAnnotatedPdf error:', e) }
  },

  setWritingTop(topPx) {
    try {
      AndroidBridge.setWritingTop(topPx)
    } catch (e) {
      console.warn('Bridge.setWritingTop error:', e)
    }
  },

  setWritingExclusion(left, top, right, bottom) {
    try {
      AndroidBridge.setWritingExclusion(left, top, right, bottom)
    } catch (e) {
      console.warn('Bridge.setWritingExclusion error:', e)
    }
  },

  setWritingBounds(left, top, right, bottom) {
    try { AndroidBridge.setWritingBounds(left, top, right, bottom) } catch (e) { console.warn('Bridge.setWritingBounds error:', e) }
  },

  setErasing(active) {
    try {
      AndroidBridge.setErasing(active)
    } catch (e) {
      console.warn('Bridge.setErasing error:', e)
    }
  },

  setPenType(type) {
    try {
      AndroidBridge.setPenType(type)
    } catch (e) {
      console.warn('Bridge.setPenType error:', e)
    }
  },

  setAnimationPanel(active) {
    try { AndroidBridge.setAnimationPanel(active) } catch (e) { console.warn('Bridge.setAnimationPanel error:', e) }
  },

  setInteractivePanel(active) {
    try { AndroidBridge.setInteractivePanel(active) } catch (e) { console.warn('Bridge.setInteractivePanel error:', e) }
  },

  startWebAnim(left, top, right, bottom) {
    try { AndroidBridge.startWebAnim(left, top, right, bottom) } catch (e) { console.warn('Bridge.startWebAnim error:', e) }
  },

  stopWebAnim() {
    try { AndroidBridge.stopWebAnim() } catch (e) { console.warn('Bridge.stopWebAnim error:', e) }
  },


  captureThumbnail(notebookId) {
    try {
      AndroidBridge.captureThumbnail(notebookId)
    } catch (e) {
      console.warn('Bridge.captureThumbnail error:', e)
    }
  },

  captureWebThumbnail(notebookId, left, top, right, bottom) {
    try {
      AndroidBridge.captureWebThumbnail(notebookId, left, top, right, bottom)
    } catch (e) {
      console.warn('Bridge.captureWebThumbnail error:', e)
    }
  },

  saveThumbnailDataUrl(notebookId, dataUrl) {
    try {
      return AndroidBridge.saveThumbnailDataUrl(notebookId, dataUrl)
    } catch (e) {
      console.warn('Bridge.saveThumbnailDataUrl error:', e)
      return 'error'
    }
  },

  getThumbnailDataUrl(notebookId) {
    try {
      return AndroidBridge.getThumbnailDataUrl(notebookId)
    } catch (e) {
      console.warn('Bridge.getThumbnailDataUrl error:', e)
      return ''
    }
  },

  // Cover pipeline (AD-6/WP2): fire-and-forget backfill for cover-less library cards. Results
  // arrive asynchronously via window.onCoverReady(id) (native evaluateJavascript callback), one
  // call per id that got a fresh thumbnail.
  ensureCovers(idsJson) {
    try { AndroidBridge.ensureCovers(idsJson) } catch (e) { console.warn('Bridge.ensureCovers error:', e) }
  },

  // Sideload import (AD-7/WP12): fire-and-forget, like ensureCovers/searchBook. The result
  // ('{"imported":n,"skipped":n,"failed":n}') arrives asynchronously via window.onBookScanDone.
  scanForNewBooks() {
    try { AndroidBridge.scanForNewBooks() } catch (e) { console.warn('Bridge.scanForNewBooks error:', e) }
  },

  // User-driven import: opens Android's multi-select document picker. Selected EPUB/PDF content is
  // copied into the app's canonical Books storage before the normal scanner builds metadata/covers.
  pickBooksToImport() {
    try {
      AndroidBridge.pickBooksToImport()
      return true
    } catch (e) {
      console.warn('Bridge.pickBooksToImport error:', e)
      return false
    }
  },

  searchOnlineBookMetadata(notebookId, query, token) {
    try {
      AndroidBridge.searchOnlineBookMetadata(notebookId, query, token)
      return true
    } catch (e) {
      console.warn('Bridge.searchOnlineBookMetadata error:', e)
      return false
    }
  },

  enterEditor() {
    try {
      AndroidBridge.enterEditor()
    } catch (e) {
      console.warn('Bridge.enterEditor error:', e)
    }
  },

  showEditor() {
    try {
      AndroidBridge.showEditor()
    } catch (e) {
      console.warn('Bridge.showEditor error:', e)
    }
  },

  enterLibrary() {
    try {
      AndroidBridge.enterLibrary()
    } catch (e) {
      console.warn('Bridge.enterLibrary error:', e)
    }
  },

  exitApp() {
    try {
      AndroidBridge.exitApp()
    } catch (e) {
      console.warn('Bridge.exitApp error:', e)
    }
  },

  showToast(message) {
    try {
      AndroidBridge.showToast(message)
    } catch (e) {
      console.warn('Bridge.showToast error:', e)
    }
  },

  setRotationLocked(locked) {
    try { AndroidBridge.setRotationLocked(locked) } catch (e) { console.warn('Bridge.setRotationLocked error:', e) }
  },

  isRotationLocked() {
    try { return AndroidBridge.isRotationLocked() } catch (e) { console.warn('Bridge.isRotationLocked error:', e); return true }
  },

  setAutosaveStatus(status) {
    try {
      AndroidBridge.setAutosaveStatus(status)
    } catch (e) {
      // silently ignore — non-critical
    }
  },

  exportTextDocument(name, content) {
    if (typeof AndroidBridge !== 'undefined' && typeof AndroidBridge.exportTextDocument === 'function') return AndroidBridge.exportTextDocument(name, content)
    const url = URL.createObjectURL(new Blob([content], {type:'text/markdown;charset=utf-8'}))
    const panel = document.createElement('div'); panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','Markdown export')
    panel.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;z-index:10000;border:2px solid black;background:white;padding:16px;display:flex;gap:16px;align-items:center'
    const a = document.createElement('a'); a.href = url; a.download = name; a.textContent='Save Markdown'
    const close = document.createElement('button'); close.textContent='Done'; close.onclick=function(){panel.remove();URL.revokeObjectURL(url)}
    const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='View Markdown';details.append(summary)
    const source=document.createElement('textarea');source.readOnly=true;source.setAttribute('aria-label','Exported Markdown');source.value=content;source.style.cssText='width:100%;height:160px;background:white;color:black;border:1px solid black';details.append(source)
    panel.style.flexWrap='wrap';details.style.width='100%';panel.append(a,close,details); document.body.append(panel)
  },
  importTextDocument() {
    if (typeof AndroidBridge !== 'undefined' && typeof AndroidBridge.importTextDocument === 'function') { AndroidBridge.importTextDocument(); return }
    const input = document.createElement('input'); input.type='file'; input.accept='.md,.markdown,text/plain,text/markdown'
    input.addEventListener('change', async function(){ if(input.files[0]) window.onMarkdownImported({name:input.files[0].name,text:await input.files[0].text()}) }); input.click()
  },
  exportDocumentPdf(title, html) {
    if (typeof AndroidBridge !== 'undefined' && typeof AndroidBridge.exportDocumentPdf === 'function') return AndroidBridge.exportDocumentPdf(title,html)
    const frame = document.createElement('iframe'); frame.setAttribute('title','PDF export'); frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:10000;background:white;border:0'
    frame.srcdoc=html; frame.style.height='calc(100% - 60px)'
    const controls=document.createElement('div'); controls.style.cssText='position:fixed;bottom:0;left:0;right:0;height:60px;background:white;border-top:2px solid black;z-index:10001;display:flex;gap:16px;align-items:center;justify-content:center'
    const print=document.createElement('button'); print.textContent='Save as PDF'; print.onclick=function(){frame.contentWindow.focus();frame.contentWindow.print()}
    const close=document.createElement('button');close.textContent='Close PDF preview';close.onclick=function(){frame.remove();controls.remove()}
    controls.append(print,close);document.body.append(frame,controls)
  },

  exportNotebook(notebookId) {
    try {
      AndroidBridge.exportNotebook(notebookId)
    } catch (e) {
      console.warn('Bridge.exportNotebook error:', e)
    }
  },

  getAppDataDir() {
    try {
      return AndroidBridge.getAppDataDir()
    } catch (e) {
      console.warn('Bridge.getAppDataDir error:', e)
      return ''
    }
  },

  getStorageInfo() {
    try {
      return AndroidBridge.getStorageInfo()
    } catch (e) {
      console.warn('Bridge.getStorageInfo error:', e)
      return '{"locations":[]}'
    }
  },

  setStorageLocation(targetPath) {
    try {
      return AndroidBridge.setStorageLocation(targetPath)
    } catch (e) {
      console.warn('Bridge.setStorageLocation error:', e)
      return 'error: ' + e.message
    }
  },

  requestAllFilesAccess() {
    try {
      AndroidBridge.requestAllFilesAccess()
    } catch (e) {
      console.warn('Bridge.requestAllFilesAccess error:', e)
    }
  },

  pickStorageFolder() {
    try {
      AndroidBridge.pickStorageFolder()
    } catch (e) {
      console.warn('Bridge.pickStorageFolder error:', e)
    }
  }
}

// `const Bridge` is a global lexical binding rather than a `window` property. Feature modules
// loaded as UMD bundles cannot reliably discover that binding through their injected `root`
// object, which previously made bounded Play ink surfaces silently fall back to Pointer Events on
// Bigme. Export one explicit, read-only-by-convention capability seam for those modules; existing
// first-party scripts continue to use the lexical `Bridge` binding directly.
window.KalamosBridge = Bridge
