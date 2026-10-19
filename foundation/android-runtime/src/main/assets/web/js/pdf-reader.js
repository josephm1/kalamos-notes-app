// PDF reader (AD-2/AD-3/AD-5/AD-9, WP7): shows one rendered page image at a time (no CSS-multicolumn
// reflow — a PDF page is a fixed raster, unlike EPUB's flowable text). Same surface as EpubReader/
// BookReader: open(meta)/close/nextPage/prevPage, plus isPdf(meta) as the App.js routing guard
// (meta.format === 'pdf'). Reuses the generic bk-topbar/bk-title/bk-botbar/bk-botrow/bk-navlbl/
// bk-clock/bk-dogear/bk-contents-btn chrome classes (content.css/reader-panels.css) — this file's own
// css/pdf-reader.css owns only the page image layout + the Navigation/Contrast panel controls.
window.PdfOutlineCache = window.PdfOutlineCache || (function() {
  var data = {}, order = [], pending = {}, seq = 0
  window.onPdfOutline = function(requestId, raw) {
    var p = pending[requestId]; if (!p) return
    delete pending[requestId]
    var arr = []
    try { arr = JSON.parse(raw || '[]') } catch (e) { arr = [] }
    if (!Array.isArray(arr)) arr = []
    data[p.nbId] = arr
    order = order.filter(function(id) { return id !== p.nbId }); order.push(p.nbId)
    while (order.length > 8) delete data[order.shift()]
    p.callbacks.forEach(function(cb) { try { cb(arr) } catch (e) {} })
  }
  function request(nbId, cb) {
    if (Object.prototype.hasOwnProperty.call(data, nbId)) { cb(data[nbId]); return }
    var existing = Object.keys(pending).find(function(k) { return pending[k].nbId === nbId })
    if (existing) { pending[existing].callbacks.push(cb); return }
    var id = 'outline:' + nbId + ':' + (++seq)
    pending[id] = { nbId: nbId, callbacks: [cb] }
    if (Bridge.requestPdfOutline) Bridge.requestPdfOutline(nbId, id)
    else window.onPdfOutline(id, Bridge.pdfOutline(nbId))
  }
  return { request: request, get: function(nbId) { return data[nbId] } }
})()

// A cold PDFBox document/text probe can take seconds. Keep it behind the same native background
// executor as positioned text and coalesce every UI consumer for the current book.
window.PdfTextLayerProbe = window.PdfTextLayerProbe || (function() {
  var pending = {}, byBook = {}, known = {}, seq = 0
  window.onPdfHasTextLayer = function(requestId, hasText) {
    var item = pending[requestId]
    if (!item) return
    delete pending[requestId]; delete byBook[item.nbId]
    known[item.nbId] = !!hasText
    if (item.reader.nbId !== item.nbId) return
    item.reader._hasTextLayer = !!hasText
    item.callbacks.forEach(function(cb) { try { cb(!!hasText) } catch (e) {} })
  }
  function request(reader, callback) {
    if (reader._hasTextLayer !== null) { setTimeout(function() { callback(!!reader._hasTextLayer) }, 0); return }
    if (Object.prototype.hasOwnProperty.call(known, reader.nbId)) {
      reader._hasTextLayer = known[reader.nbId]
      setTimeout(function() { callback(!!reader._hasTextLayer) }, 0); return
    }
    var existing = byBook[reader.nbId]
    if (existing && pending[existing]) { pending[existing].callbacks.push(callback); return }
    var id = 'text-probe:' + reader.nbId + ':' + (++seq)
    pending[id] = { reader: reader, nbId: reader.nbId, callbacks: [callback] }; byBook[reader.nbId] = id
    Bridge.requestPdfHasTextLayer(reader.nbId, id)
  }
  function remember(reader, hasText) { known[reader.nbId] = !!hasText; reader._hasTextLayer = !!hasText }
  return { request: request, remember: remember }
})()

const PdfReader = {
  nbId: null, title: '', info: null, pageIndex: 0, pages: 1,
  vs: null,          // persisted view-state: {crop:{l,t,r,b}, columns, direction, comic, embolden, dark, articleMode}
  _prefetched: null,
  _prefetchImgs: null,
  _pageLoadToken: 0,
  _pageLoading: false,
  _queuedPageIndex: null,
  _pageReadyWaiters: null,

  // ---- WP10 article mode state ----
  articleMode: false,      // runtime flag (only true when vs.articleMode AND a text layer is present)
  _hasTextLayer: null,     // cached Bridge.pdfHasTextLayer probe — one call per open()
  _artWinSize: 10,         // source pages fetched per Bridge.pdfPagesText window
  _artLo: -1, _artHi: -1,  // inclusive range of source pages currently appended to the article flow
  _artPage: 0, _artPages: 1, _artGeomV: null, _artPrefetching: false,
  _artHl: null, _artSel: null, _artPop: null,

  isPdf(meta) { return !!(meta && meta.format === 'pdf') },

  // Device (real WebView, loaded from file:///android_asset/...) vs the browser preview (loaded from
  // http://localhost:.../app — preview/server.py's do_GET). Picks the page-image URL strategy (AD-3):
  // the device uses BookContentInterceptor's virtual host; the preview has no such interceptor, so it
  // falls back to the GET /pdfpage/<id>/<n>.png route (server.py, mirrors the same path shape).
  isDevice() { try { return location.protocol === 'file:' } catch (e) { return false } },

  open(meta) {
    this.nbId = meta.notebookId
    this.title = meta.title || 'PDF'
    let info = null
    try { info = JSON.parse(Bridge.pdfOpen(this.nbId)) } catch (e) { info = null }
    if (!info || !info.pages) { Bridge.showToast('Could not open book'); return }
    this.info = info
    this.pages = Math.max(1, info.pages | 0)
    this.pageIndex = 0
    this._prefetched = {}
    this._prefetchImgs = {}
    this._pageLoadToken = 0
    this._pageLoading = false
    this._queuedPageIndex = null
    this._pageReadyWaiters = []
    this._loadView()
    this.articleMode = false
    this._hasTextLayer = null
    this._artLo = -1; this._artHi = -1; this._artPage = 0; this._artPages = 1; this._artPrefetching = false
    this._outline = PdfOutlineCache.get(this.nbId) || null
    this._outlineWaiters = []
    this._bxTocModel = null; this._bxTocCollapsed = {}; this._bxAnnotationsCache = null
    const pos = meta.position
    if (pos && typeof pos.pageIndex === 'number' && pos.pageIndex >= 0 && pos.pageIndex < this.pages) {
      this.pageIndex = pos.pageIndex
    }
    if (typeof ReaderFormat !== 'undefined') ReaderFormat.load(this.nbId)   // WP9/WP10: merged format settings
    this._initBookmarks()
    if (window.NativePages) NativePages.init(this, 'pdf', pos && pos.nativePageId)
    document.getElementById('library-view').style.display = 'none'
    document.getElementById('editor-view').style.display = 'none'
    this.buildChrome()
    this.view().style.display = 'flex'
    Bridge.enterLibrary()   // hide the ink surface — the WebView is the live reading layer
    Bridge.setImmersive(true)   // hide the Android status + navigation bars for a full-screen page
    App.current = 'pdf'
    App.activeReader = this
    // Always commit the ordinary PDF first. Cold PDFBox text detection is asynchronous so neither a
    // remembered Reflow nor Textbook preference can hold the reader UI hostage during startup.
    const resumeArticle = !!this.vs.articleMode
    const resumeTextbook = !!this.vs.textbookMode
    if (resumeArticle) this.vs.articleMode = false
    if (resumeTextbook) this.vs.textbookMode = false
    this.loadPage()
    if (resumeArticle) {
      this.afterPageReady(this.pageIndex, function() {
        requestAnimationFrame(function() { PdfTextLayerProbe.request(PdfReader, function(hasText) {
          if (hasText) PdfReader.setArticleMode(true)
        }) })
      })
    } else if (resumeTextbook && window.BooxNav && BooxNav.resumeTextbook) {
      this.afterPageReady(this.pageIndex, function() {
        requestAnimationFrame(function() { setTimeout(function() {
          console.log('DIAG textbookResume baseReady page=' + PdfReader.pageIndex)
          BooxNav.resumeTextbook(PdfReader)
        }, 0) })
      })
    }
    this._primeOutline()
    const self = this
    this._clockTimer = setInterval(function() { self.updateClock() }, 30000)
  },

  view() {
    let v = document.getElementById('pdf-view')
    if (!v) { v = el('div', null); v.id = 'pdf-view'; document.body.appendChild(v) }
    return v
  },

  close() {
    clearTimeout(this._saveTimer); this._savePositionNow()
    if (window.NativePages) NativePages.close(this)
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null }
    this._prefetched = {}
    this._prefetchImgs = {}
    this._pageLoadToken++
    this._pageLoading = false
    this._queuedPageIndex = null
    this._pageReadyWaiters = []
    Bridge.pdfClose(this.nbId)
    Bridge.setImmersive(false)   // restore the system bars outside the reader
    this.view().style.display = 'none'
    document.getElementById('library-view').style.display = 'flex'
    App.current = 'library'
    if (typeof invalidateCardMeta === 'function') invalidateCardMeta(this.nbId)   // only this book's progress changed
    if (typeof renderLibrary === 'function') renderLibrary()
  },

  // ---- chrome (built once per open — a page turn only swaps the <img>(s) + labels via loadPage) ----
  buildChrome() {
    const self = this
    const v = this.view(); v.innerHTML = ''

    const content = el('div', 'pf-content'); content.id = 'pf-content'
    const imgwrap = el('div', 'pf-imgwrap')
    content.appendChild(imgwrap)
    // WP10 article mode: a sibling CSS-multicolumn text flow (same structural pattern as
    // EpubReader's ep-content/ep-pagebox/ep-flow, reusing reader-paginate.js's shared geometry).
    // Hidden by default; _applyModeVisibility() toggles this vs. imgwrap.
    const artBox = el('div', 'pf-art-content'); artBox.id = 'pf-art-content'
    const artPagebox = el('div', 'pf-art-pagebox')
    const artFlow = el('div', 'pf-art-flow')
    const artHlLayer = el('div', 'pf-art-hl')
    const artSelLayer = el('div', 'pf-art-sel')
    artPagebox.appendChild(artFlow)
    artPagebox.appendChild(artHlLayer)
    artPagebox.appendChild(artSelLayer)
    artBox.appendChild(artPagebox)
    artBox.style.display = 'none'
    content.appendChild(artBox)
    v.appendChild(content)
    this._content = content; this._imgwrap = imgwrap
    this._artBox = artBox; this._artPagebox = artPagebox; this._artFlow = artFlow
    this._artHlLayer = artHlLayer; this._artSelLayer = artSelLayer
    this._artWireSelection(artFlow)

    // floating top bar (revealed by a tap in the top zone): back + title
    const top = el('div', 'bk-topbar'); this._topbar = top
    const back = el('button', 'rd-btn', '← Library'); back.addEventListener('click', function() { self.close() })
    top.appendChild(back)
    top.appendChild(el('div', 'bk-title', this.title))
    const srchBtn = el('button', 'rd-btn bk-fbtn', '🔍'); srchBtn.addEventListener('click', function() { self.hideBars(); self.openPanels('search') })
    top.appendChild(srchBtn)
    v.appendChild(top)

    // floating bottom bar: page N/M + draggable progress slider, then Contents/Navigation/Contrast
    const bot = el('div', 'bk-botbar'); this._botbar = bot
    const row = el('div', 'bk-botrow')
    this._navlbl = el('div', 'bk-navlbl', '')
    const slider = document.createElement('input')
    slider.type = 'range'; slider.className = 'pf-slider'
    slider.min = '0'; slider.max = String(Math.max(0, this.pages - 1)); slider.step = '1'
    slider.value = String(this.pageIndex)
    // live label while dragging; the actual page jump only happens on release (e-ink: no redraw storm)
    slider.addEventListener('input', function() {
      self._navlbl.textContent = (parseInt(slider.value, 10) + 1) + ' / ' + self.pages
    })
    slider.addEventListener('change', function() { self.gotoPage(parseInt(slider.value, 10)) })
    this._slider = slider
    row.appendChild(this._navlbl); row.appendChild(slider)
    bot.appendChild(row)
    const btnRow = el('div', 'bk-botbtns pf-botbtns')
    const contentsBtn = el('button', 'rd-btn bk-contents-btn', '☰ Contents')
    contentsBtn.addEventListener('click', function() { self.hideBars(); self.openPanels('toc') })
    const navBtn = el('button', 'rd-btn bk-contents-btn', '⛶ Navigation')
    navBtn.addEventListener('click', function() { self.hideBars(); self.openPanels('nav') })
    const contrastBtn = el('button', 'rd-btn bk-contents-btn', '◐ Contrast')
    contrastBtn.addEventListener('click', function() { self.hideBars(); self.openPanels('contrast') })
    btnRow.appendChild(contentsBtn); btnRow.appendChild(navBtn); btnRow.appendChild(contrastBtn)
    bot.appendChild(btnRow)
    v.appendChild(bot)

    this._clock = el('div', 'bk-clock'); v.appendChild(this._clock)
    this.applyClockSetting()

    // top-right dog-ear: visible only while the current page is bookmarked
    this._dogear = el('div', 'bk-dogear'); v.appendChild(this._dogear)

    this.wireTapZones(content)
    // Boox UI: swap the classic bars for the Boox chrome (engine containers untouched).
    if (window.Boox && Boox.active('reader')) BooxChrome.install(this, 'pdf')
  },

  // ---- page rendering (AD-3): single fixed raster image per page, no reflow. columns=2 shows a
  // side-by-side spread (half-width each); the last odd page of an odd-paged book falls back to a
  // single full-width image rather than pairing with nothing. ----
  loadPage() {
    this.pageIndex = Math.max(0, Math.min(this.pages - 1, this.pageIndex))
    const wrap = this._imgwrap; if (!wrap) return
    if (this._pageLoading) {
      this._queuedPageIndex = this.pageIndex
      if (this._slider) this._slider.value = String(this.pageIndex)
      this._updateNav()
      this.updateClock()
      this.updateBookmarkGlyph()
      this.savePosition()
      return
    }
    this._pageLoading = true
    this._queuedPageIndex = null
    const token = ++this._pageLoadToken
    const renderIndex = this.pageIndex
    const cols = this.vs.columns
    const imgs = []
    if (cols === 2 && renderIndex + 1 < this.pages) {
      const a = renderIndex, b = renderIndex + 1
      const order = this.isReversed() ? [b, a] : [a, b]
      imgs.push(this._makeImg(order[0], 2))
      imgs.push(this._makeImg(order[1], 2))
    } else {
      imgs.push(this._makeImg(renderIndex, 1))
    }
    // Keep the old page visible while the requested page renders. XReader-style readers feel fast
    // largely because they never flash an empty canvas between pages; cached/prefetched images swap
    // immediately, while a cold render completes off-DOM and then replaces the old page atomically.
    this._swapWhenReady(imgs, token, renderIndex)
    if (this._slider) this._slider.value = String(this.pageIndex)
    this._updateNav()
    this.updateClock()
    this.updateBookmarkGlyph()
    this.prefetchNeighbors()
    this.savePosition()
  },

  afterPageReady(pageIndex, callback) {
    const page = Math.max(0, Math.min(this.pages - 1, pageIndex | 0))
    const visible = !this._pageLoading && this.pageIndex === page && this._imgwrap &&
      this._imgwrap.children.length && Array.prototype.every.call(this._imgwrap.children, function(img) {
        return img.complete && img.naturalWidth > 0
      })
    if (visible) { setTimeout(callback, 0); return }
    this._pageReadyWaiters = this._pageReadyWaiters || []
    this._pageReadyWaiters.push({ page: page, callback: callback })
  },

  _notifyPageReady(pageIndex) {
    const waiters = this._pageReadyWaiters || [], keep = []
    waiters.forEach(function(waiter) {
      if (waiter.page === pageIndex) setTimeout(waiter.callback, 0)
      else keep.push(waiter)
    })
    this._pageReadyWaiters = keep
  },

  _makeImg(idx, cols) {
    const self = this
    const img = el('img', 'pf-img ' + (cols === 2 ? 'pf-img-half' : 'pf-img-full'))
    let triedFallback = false
    img.draggable = false
    img.alt = 'Page ' + (idx + 1)
    img.style.filter = this._imageFilter()
    const w = this._targetWidthPx(cols)
    // fallback to the base64 bridge method (AD-3 risk 2 — interceptor quirks / preview 404s shouldn't
    // ever hit here since /pdfpage always serves the fixture, but stay defensive on-device too)
    img.addEventListener('error', function() {
      if (!triedFallback) {
        triedFallback = true
        const durl = Bridge.pdfPageDataUrl(self.nbId, idx, w, self.vs.embolden, self.vs.dark, self._cropStr())
        if (durl) { img.src = durl; return }
      }
      img.dispatchEvent(new CustomEvent('kalamosloadend', { detail: { ok: false } }))
    })
    img.src = this.pageUrl(idx, w)
    return img
  },

  _swapWhenReady(imgs, token, renderIndex) {
    const self = this, wrap = this._imgwrap
    if (!wrap || !imgs.length) return
    let left = imgs.length
    let failed = false
    function ready(ok) {
      if (!ok) failed = true
      left--
      if (left || token !== self._pageLoadToken || !self._imgwrap) return
      self._pageLoading = false
      if (self._queuedPageIndex != null && self._queuedPageIndex !== renderIndex) {
        self.pageIndex = self._queuedPageIndex
        self._queuedPageIndex = null
        self.loadPage()
        return
      }
      self._queuedPageIndex = null
      self._imgwrap.classList.remove('pf-loading')
      // Preserve a successfully rendered old page on a terminal load failure instead of flashing
      // a broken-image glyph. The page can still be retried through Refresh.
      if (failed && self._imgwrap.children.length) {
        Bridge.showToast('Page render failed — tap Refresh to retry')
        return
      }
      self._imgwrap.replaceChildren.apply(self._imgwrap, imgs)
      self._notifyPageReady(renderIndex)
      if (window.BooxPdfAnnots) BooxPdfAnnots.redraw(self)
      if (window.NativePages) NativePages.restore(self, 'pdf')
    }
    imgs.forEach(function(img) {
      let settled = false
      function finish(ok) { if (settled) return; settled = true; ready(ok) }
      img.addEventListener('load', function() { finish(true) }, { once: true })
      img.addEventListener('kalamosloadend', function(e) { finish(!!(e.detail && e.detail.ok)) }, { once: true })
      if (img.complete && img.naturalWidth > 0) finish(true)
    })
    if (!wrap.children.length) {
      // First page has nothing useful to preserve, so attach it immediately while it decodes.
      wrap.replaceChildren.apply(wrap, imgs)
    } else {
      wrap.classList.add('pf-loading')
    }
  },

  _targetWidthPx(cols) {
    const cw = (this._content && this._content.clientWidth) || window.innerWidth || 674
    const cssW = cw / (cols || 1)
    const dpr = window.devicePixelRatio || 1
    return Math.max(200, Math.min(2048, Math.round(cssW * dpr)))
  },

  _cropStr() { const c = this.vs.crop; return [c.l, c.t, c.r, c.b].join(',') },

  pageUrl(idx, w) {
    const qs = 'w=' + Math.round(w) + '&e=' + this.vs.embolden + '&d=' + this.vs.dark + '&crop=' + this._cropStr()
    if (this.isDevice()) return 'https://kalamos.content/pdf/' + this.nbId + '/' + idx + '.png?' + qs
    return '/pdfpage/' + this.nbId + '/' + idx + '.png?' + qs
  },

  // ---- ±1-page prefetch only (memory cap — Risk 1): warms the browser/WebView HTTP cache via a
  // detached Image(), never attached to the DOM. Reset whenever crop/columns/contrast change (the URL
  // changes, so old prefetch keys are stale). ----
  prefetchNeighbors() {
    // Textbook mode has a different crop on every logical view. BooxNav warms the next page's
    // region map instead; using the current crop for neighbouring pages would waste raster work.
    if (this.vs.textbookMode) return
    const self = this
    const step = this.vs.columns === 2 ? 2 : 1
    // Prioritise the next turn, then one page further ahead, then the previous page. Keep strong
    // references until each request finishes so WebView cannot discard a detached prefetch early.
    const want = [this.pageIndex + step, this.pageIndex + 2 * step, this.pageIndex - step]
    want.forEach(function(i) {
      if (i < 0 || i >= self.pages || self._prefetched[i]) return
      self._prefetched[i] = true
      const im = new Image()
      self._prefetchImgs[i] = im
      function done() { delete self._prefetchImgs[i] }
      im.addEventListener('load', done, { once: true })
      im.addEventListener('error', done, { once: true })
      im.src = self.pageUrl(i, self._targetWidthPx(self.vs.columns))
    })
  },

  _updateNav() {
    if (this._navlbl) this._navlbl.textContent = (this.pageIndex + 1) + ' / ' + this.pages
  },

  nextPage() {
    this._artStudyMark = null
    if (window.BooxPageInk && BooxPageInk.modeOn(this)) return
    const self = this
    if (window.NativePages) return NativePages.next(this, 'pdf', function() { self._nextSourcePage() })
    this._nextSourcePage()
  },
  _nextSourcePage() {
    if (this.articleMode) { this._artNextPage(); return }
    const step = this.vs.columns === 2 ? 2 : 1
    if (this.pageIndex >= this.pages - 1) return
    this.pageIndex = Math.min(this.pages - 1, this.pageIndex + step)
    this.loadPage()
  },
  prevPage() {
    this._artStudyMark = null
    if (window.BooxPageInk && BooxPageInk.modeOn(this)) return
    const self = this
    if (window.NativePages) return NativePages.prev(this, 'pdf', function() { return self._prevSourcePage() })
    this._prevSourcePage()
  },
  _prevSourcePage() {
    if (this.articleMode) { this._artPrevPage(); return }
    const step = this.vs.columns === 2 ? 2 : 1
    if (this.pageIndex <= 0) return
    this.pageIndex = Math.max(0, this.pageIndex - step)
    this.loadPage()
  },
  // idx is always a SOURCE page index (the slider/TOC/bookmarks all address the book this way,
  // article mode included — see _artGotoSourcePage).
  gotoPage(idx) {
    if (this.articleMode) { this._artGotoSourcePage(idx); return }
    this.pageIndex = Math.max(0, Math.min(this.pages - 1, idx | 0))
    this.loadPage()
  },

  // RTL direction OR comic mode both mean "reading advances right-to-left" — either flips the tap
  // zones (and which physical side a 2-up spread's earlier page sits on).
  isReversed() { return this.vs.direction === 'rtl' || !!this.vs.comic },

  // ---- tap-zone navigation (mirrors EpubReader.wireTapZones) ----
  wireTapZones(content) {
    const self = this
    let downX = 0, downY = 0, downT = null, downTarget = null, moved = false
    const SKIP = 'button, a, input, .bx-pdf-ann, .bx-pdf-tools'
    const diag = function(reason, e, data) {
      if (window.ReaderTapDiag) window.ReaderTapDiag.log('pdf', reason, e, data)
    }
    content.addEventListener('pointerdown', function(e) {
      downX = e.clientX; downY = e.clientY; downT = e.timeStamp; downTarget = e.target; moved = false
      diag('down', e)
    }, true)
    content.addEventListener('pointermove', function(e) {
      if (downT == null) return
      const dx = Math.abs(e.clientX - downX), dy = Math.abs(e.clientY - downY)
      if (!moved && (dx > 8 || dy > 8)) { moved = true; diag('move', e, { dx: dx, dy: dy }) }
    }, true)
    content.addEventListener('pointerup', function(e) {
      if (downT == null) { diag('orphan-up', e); return }
      const dt = e.timeStamp - downT
      const dx = Math.abs(e.clientX - downX), dy = Math.abs(e.clientY - downY)
      downT = null
      if (window.BooxPageInk && BooxPageInk.modeOn(self)) { diag('ink-mode', e, { dt: dt, dx: dx, dy: dy }); return }
      if (moved) { diag('moved', e, { dt: dt, dx: dx, dy: dy }); return }
      if (dt > 400) { diag('long', e, { dt: dt, dx: dx, dy: dy }); return }
      if (downTarget && downTarget.closest && downTarget.closest(SKIP)) { diag('skip-target', e, { dt: dt }); return }
      const r = content.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      // top-right ~64px square = bookmark toggle (checked before the top-band bar-toggle)
      if (x > r.width - 64 && y < 64) { diag('bookmark', e, { dt: dt, zone: 'top-right' }); self.toggleBookmarkTap(); return }
      if (self.barsOpen()) { diag('bars-close', e, { dt: dt }); self.hideBars(); return }
      if (y < r.height * 0.14) { diag('top-bar', e, { dt: dt, zone: 'top' }); self.toggleBar('top') }
      else if (y > r.height * 0.86) { diag('bottom-bar', e, { dt: dt, zone: 'bottom' }); self.toggleBar('bottom') }
      else if (x < r.width * 0.33) {
        diag(self.isReversed() ? 'next' : 'prev', e, { dt: dt, zone: 'left' })
        self.isReversed() ? self.nextPage() : self.prevPage()
      } else if (x > r.width * 0.67) {
        diag(self.isReversed() ? 'prev' : 'next', e, { dt: dt, zone: 'right' })
        self.isReversed() ? self.prevPage() : self.nextPage()
      } else diag('center', e, { dt: dt, zone: 'center' })
    })
    content.addEventListener('pointercancel', function(e) {
      if (downT != null) diag('cancel', e, { dt: e.timeStamp - downT })
      downT = null
    }, true)
  },
  barsOpen() {
    if (window.Boox && Boox.active('reader')) return BooxChrome.barsOpen(this)
    return !!((this._topbar && this._topbar.classList.contains('show')) ||
              (this._botbar && this._botbar.classList.contains('show')))
  },
  hideBars() {
    if (window.Boox && Boox.active('reader')) return BooxChrome.hideBars(this)
    if (this._topbar) this._topbar.classList.remove('show')
    if (this._botbar) this._botbar.classList.remove('show')
  },
  toggleBar(which) {
    if (window.Boox && Boox.active('reader')) return BooxChrome.toggleBar(this, which)
    const bar = which === 'top' ? this._topbar : this._botbar
    const other = which === 'top' ? this._botbar : this._topbar
    if (other) other.classList.remove('show')
    if (bar) bar.classList.toggle('show')
  },

  // ---- ReaderPanels integration: toc / bookmarks / nav (crop+columns+direction+comic) / contrast
  // (embolden+dark enhance) — see reader-panels.js. ----
  openPanels(activeTab) {
    if (window.Boox && Boox.active('reader')) return BooxPanels.open(this, activeTab)
    if (typeof ReaderPanels === 'undefined') return
    const self = this
    const tabs = [
      { id: 'toc', label: 'TOC', build: function(body) { self.buildTocPanel(body) } },
      { id: 'quizzes', label: 'Workbooks', build: function(body) { NativePages.buildQuizPanel(self, body) } },
      { id: 'bookmarks', label: 'Bookmarks', build: function(body) { self.buildBookmarksPanel(body) } },
      { id: 'search', label: 'Search', build: function(body) { self.buildSearchPanel(body) } },
      { id: 'nav', label: 'Navigation', build: function(body) { self.buildNavPanel(body) } },
      { id: 'contrast', label: 'Contrast', build: function(body) { self.buildContrastPanel(body) } }
    ]
    // WP10: the Format tab (fonts/spacing — reader-format.js) only makes sense once the page body
    // is reflowable text; bitmap mode keeps the pre-WP10 tab set unchanged.
    if (this.articleMode) {
      tabs.push({ id: 'format', label: 'Format', build: function(body) { self.buildFormatPanel(body) } })
    }
    ReaderPanels.open({ active: activeTab || 'toc', tabs: tabs })
  },

  // Table-of-contents tab: Bridge.pdfOutline (WP8/pdfbox-backed on-device, fixture-backed in preview)
  // returns [{label, pageIndex, level}]; an empty/unavailable outline (scanned PDF, no pdfbox) shows a
  // plain "No contents" notice rather than a fake per-page list.
  buildTocPanel(body) {
    const self = this
    body.innerHTML = ''
    const outline = this._outline
    if (!outline) {
      body.appendChild(el('div', 'rp-empty', 'Loading contents…'))
      this._outlineWaiters.push(function() { if (document.contains(body)) self.buildTocPanel(body) })
      this._primeOutline()
      return
    }
    if (!outline.length) { body.appendChild(el('div', 'rp-empty', 'No contents')); return }
    BooxToc.render(this, body, outline,
      function(entry) { return Math.max(1, (entry.level || 0) + 1) },
      function(entry, i) { return 'pdf:' + i + ':' + (entry.label || '') },
      function(entry) {
      const lvl = Math.max(1, (entry.level || 0) + 1)
      const cur = entry.pageIndex === self.pageIndex
      const row = el('button', 'rp-row rp-toc-l' + lvl + (cur ? ' sel' : ''))
      row.style.setProperty('--toc-indent', Math.min(72, (lvl - 1) * 18) + 'px')
      row.appendChild(el('span', 'rp-row-label', entry.label || ('Page ' + ((entry.pageIndex || 0) + 1))))
      row.appendChild(el('span', 'rp-row-page', 'p.' + ((entry.pageIndex || 0) + 1)))
      ReaderBookLink.wire(row, function() { ReaderPanels.close(); self.gotoPage(entry.pageIndex || 0) })
      return row
    })
  },

  _primeOutline() {
    const self = this
    if (this._outline) return
    const requestNb = this.nbId
    PdfOutlineCache.request(requestNb, function(outline) {
      if (self.nbId !== requestNb) return
      self._outline = outline
      self._bxTocModel = null
      const waiters = self._outlineWaiters || []
      self._outlineWaiters = []
      waiters.forEach(function(cb) { cb() })
    })
  },

  // Bookmarks tab (identical shape to EpubReader.buildBookmarksPanel / BookReader's).
  buildBookmarksPanel(body) {
    const self = this
    const list = (typeof Bookmarks !== 'undefined') ? Bookmarks.list() : []
    ReaderPanels.paginateList(body, list, function(bm) {
      const row = el('div', 'rp-row rp-bm-row')
      const info = el('div', 'rp-bm-info')
      info.appendChild(el('div', 'rp-row-label', bm.label || 'Bookmark'))
      info.appendChild(el('div', 'rp-row-date', new Date(bm.createdAt || Date.now()).toLocaleDateString()))
      info.addEventListener('click', function() { ReaderPanels.close(); Bookmarks.goto(bm.id) })
      row.appendChild(info)
      const del = el('button', 'rp-bm-del', '🗑')
      del.addEventListener('click', function(e) {
        e.stopPropagation()
        Bookmarks.remove(bm.id)
        self.updateBookmarkGlyph()
        ReaderPanels.refresh()
      })
      row.appendChild(del)
      return row
    }, 6)
  },

  // ---- WP11 in-book search: AD-9 bridge backend (Bridge.searchBook → window.onSearchResults, the
  // ONE global dispatcher in reader-search.js). No text-range marking on a rendered bitmap page —
  // gotoMatch just lands on the page (bitmap mode) or the source-page marker (article mode). A
  // device-side highlight over the raster (e.g. drawing a box from pdfbox's word rects) is a
  // possible later enhancement; out of scope here. ----
  buildSearchPanel(body) {
    if (typeof ReaderSearch === 'undefined') return
    ReaderSearch.buildTab(body, this.buildSearchAdapter())
  },
  buildSearchAdapter() {
    const self = this
    return {
      search(query, token, onBatch) {
        let acc = []
        ReaderSearch.register(token, function(json, done) {
          let batch = []
          try { batch = JSON.parse(json) || [] } catch (e) { batch = [] }
          acc = acc.concat(batch)
          const mapped = acc.map(function(m) {
            return { pageIndex: m.pageIndex, snippet: m.snippet, ref: 'Page ' + (((m.pageIndex || 0)) + 1) }
          })
          onBatch(mapped, done)
        })
        Bridge.searchBook(self.nbId, query, token)
      },
      gotoMatch(match) {
        if (!match) return
        if (self.articleMode) self._artGotoSourcePage(match.pageIndex || 0)
        else self.gotoPage(match.pageIndex || 0)
      }
    }
  },

  // PDF citations always resolve to an exact source page. In selectable Article mode the complete
  // cited page-text segment also receives a temporary locator outline; bitmap mode truthfully
  // navigates to the page without pretending that text geometry is available.
  gotoStudyEvidence(target, done) {
    if (!target || target.kind !== 'pdf') { if (done) done(false); return }
    const pageIndex = Math.max(0, Math.min(this.pages - 1, target.pageIndex | 0))
    if (this.articleMode) {
      this._artStudyMark = { pageIndex: pageIndex }
      this._artGotoSourcePage(pageIndex)
      this._artApplyHighlights()
    } else {
      this._artStudyMark = null
      this.gotoPage(pageIndex)
    }
    if (done) done(true)
  },

  // Navigation tab: crop margin steppers (±1%), columns (1|2), direction (LTR|RTL), comic mode.
  // Every control re-renders the current page immediately (crop/columns change the request; direction/
  // comic only change tap-zone + spread order, but a reload keeps behaviour uniform and simple).
  buildNavPanel(body) {
    const self = this
    body.innerHTML = ''
    const wrap = el('div', 'pf-panel')

    // WP10/AD-2: Article mode toggle. Unknown text availability stays actionable; setArticleMode
    // resolves it asynchronously rather than freezing this panel on a cold PDFBox document. E-ink forbids dimmed
    // (<100% opacity) controls, so the disabled state is conveyed with a struck-through label plus a
    // plain hint row, not a faded toggle.
    wrap.appendChild(el('div', 'pf-section-label', 'Article mode'))
    const hasText = this._hasTextLayer !== false
    const amRow = el('div', 'rf-row')
    const amLabel = el('div', 'rf-row-label')
    if (hasText) {
      amLabel.textContent = 'Article mode'
    } else {
      amLabel.appendChild(el('s', null, 'Article mode'))
    }
    amRow.appendChild(amLabel)
    const amBtn = el('button', 'rf-toggle' + (this.articleMode ? ' on' : ''),
      hasText ? (this.articleMode ? 'On' : 'Off') : '—')
    if (!hasText) amBtn.disabled = true
    amBtn.addEventListener('click', function() {
      if (!hasText) return
      self.setArticleMode(!self.articleMode)
      self.openPanels('nav')   // rebuild the tab strip too — Format only appears once article mode is on
    })
    amRow.appendChild(amBtn)
    wrap.appendChild(amRow)
    if (!hasText) wrap.appendChild(el('div', 'pf-note', 'No text layer in this PDF'))

    wrap.appendChild(el('div', 'pf-section-label', 'Crop margin (%)'))
    const sideNames = { l: 'Left', t: 'Top', r: 'Right', b: 'Bottom' }
    ;['l', 't', 'r', 'b'].forEach(function(side) {
      wrap.appendChild(self._stepperRow(sideNames[side], self.vs.crop[side], 0, 40, 1, function(v) {
        self.vs.crop[side] = v; self._onViewChanged()
      }))
    })
    wrap.appendChild(el('div', 'pf-section-label', 'Columns'))
    wrap.appendChild(self._segRow([{ id: 1, label: '1' }, { id: 2, label: '2' }], this.vs.columns, function(v) {
      self.vs.columns = v; self._onViewChanged()
    }))
    wrap.appendChild(el('div', 'pf-section-label', 'Direction'))
    wrap.appendChild(self._segRow([{ id: 'ltr', label: 'LTR' }, { id: 'rtl', label: 'RTL' }], this.vs.direction, function(v) {
      self.vs.direction = v; self._onViewChanged()
    }))
    wrap.appendChild(el('div', 'pf-section-label', 'Comic mode'))
    wrap.appendChild(self._segRow([{ id: 0, label: 'Off' }, { id: 1, label: 'On' }], this.vs.comic ? 1 : 0, function(v) {
      self.vs.comic = !!v; self._onViewChanged()
    }))
    body.appendChild(wrap)
  },

  // Contrast tab: embolden + dark-enhance (0-100, ±10 steps) → the /pdf/<id>/<n>.png?e=&d= URL params
  // (BookContentInterceptor's native ColorMatrix, WP6). The preview's flat GET /pdfpage/ fixture route
  // ignores those params (no real PdfRenderService to re-render with) — state still persists and the
  // URL still carries them, but the pixels don't change in the browser preview, hence the note row.
  buildContrastPanel(body) {
    const self = this
    body.innerHTML = ''
    const wrap = el('div', 'pf-panel')
    wrap.appendChild(el('div', 'pf-section-label', 'Contrast'))
    wrap.appendChild(self._stepperRow('𝐀  Embolden', this.vs.embolden, 0, 100, 10, function(v) {
      self.vs.embolden = v; self._onViewChanged()
    }))
    wrap.appendChild(self._stepperRow('◭  Sharpen image', this.vs.sharpen, 0, 100, 10, function(v) {
      self.vs.sharpen = v; self._onFilterChanged()
    }))
    wrap.appendChild(self._stepperRow('≋  Watermark bleach', this.vs.bleach, 0, 100, 10, function(v) {
      self.vs.bleach = v; self._onFilterChanged()
    }))
    wrap.appendChild(self._stepperRow('◐  Dark enhancement', this.vs.dark, 0, 100, 10, function(v) {
      self.vs.dark = v; self._onViewChanged()
    }))
    const smooth = el('div', 'pf-row')
    smooth.appendChild(el('span', 'pf-row-label', '◌  Image smoothing'))
    const smoothBtn = el('button', 'rf-toggle' + (this.vs.smoothing ? ' on' : ''), this.vs.smoothing ? 'On' : 'Off')
    smoothBtn.addEventListener('click', function() { self.vs.smoothing = !self.vs.smoothing; self._onFilterChanged(); ReaderPanels.refresh() })
    smooth.appendChild(smoothBtn); wrap.appendChild(smooth)
    if (!this.isDevice()) {
      wrap.appendChild(el('div', 'pf-note',
        'Sharpening, bleaching and smoothing preview here; embolden and dark enhancement render on-device.'))
    }
    body.appendChild(wrap)
  },

  _imageFilter() {
    const f = []
    if (this.vs.sharpen) f.push('contrast(' + (1 + this.vs.sharpen / 250).toFixed(2) + ')')
    if (this.vs.bleach) f.push('brightness(' + (1 + this.vs.bleach / 350).toFixed(2) + ')')
    if (this.vs.smoothing) f.push('blur(.35px)')
    return f.length ? f.join(' ') : 'none'
  },
  _onFilterChanged() {
    this._saveView()
    const filter = this._imageFilter()
    if (this._imgwrap) Array.prototype.forEach.call(this._imgwrap.querySelectorAll('.pf-img'), function(img) { img.style.filter = filter })
  },

  // A stepper row: label + [−] value [+], min/max/step-clamped. onChange(v) fires on every tap.
  _stepperRow(label, value, min, max, step, onChange) {
    const row = el('div', 'pf-row')
    row.appendChild(el('span', 'pf-row-label', label))
    const ctl = el('div', 'pf-stepper')
    const dec = el('button', 'pf-stepper-btn', '−')
    const val = el('span', 'pf-stepper-val', String(value))
    const inc = el('button', 'pf-stepper-btn', '+')
    let v = value
    function set(nv) {
      v = Math.max(min, Math.min(max, nv))
      val.textContent = String(v)
      onChange(v)
    }
    dec.addEventListener('click', function() { set(v - step) })
    inc.addEventListener('click', function() { set(v + step) })
    ctl.appendChild(dec); ctl.appendChild(val); ctl.appendChild(inc)
    row.appendChild(ctl)
    return row
  },

  // A segmented control row: one option selected at a time (no gray fill — selected = solid black).
  _segRow(options, activeId, onChange) {
    const row = el('div', 'pf-row pf-segrow')
    const seg = el('div', 'pf-seg')
    options.forEach(function(opt) {
      const b = el('button', 'pf-seg-btn' + (opt.id === activeId ? ' sel' : ''), opt.label)
      b.addEventListener('click', function() {
        Array.prototype.forEach.call(seg.children, function(c) { c.classList.remove('sel') })
        b.classList.add('sel')
        onChange(opt.id)
      })
      seg.appendChild(b)
    })
    row.appendChild(seg)
    return row
  },

  _onViewChanged() {
    this._saveView()
    this._prefetched = {}   // the page URL just changed (crop/columns/embolden/dark) — old warm keys are stale
    this._prefetchImgs = {}
    if (this._pageLoading) {
      this._pageLoadToken++
      this._pageLoading = false
      this._queuedPageIndex = null
    }
    this.loadPage()
  },

  // Format tab (WP10/WP9, js/reader-format.js) — only reachable in article mode (openPanels only
  // pushes this tab then). epub:false hides the publisher-CSS toggle (meaningless for a PDF).
  buildFormatPanel(body) {
    const self = this
    if (typeof ReaderFormat === 'undefined') return
    ReaderFormat.buildPanel(body, { epub: false, onChange: function(fmt) { self.onFormatChange(fmt) } })
  },
  // re-apply CSS vars + font scale, re-layout the column geometry, then land back on the same source
  // page marker so a font-size bump (etc.) never loses the reader's place (mirrors EpubReader's
  // onFormatChange/_gotoCharOffset anchor-safe pattern, just anchored to a page marker instead of a
  // character offset).
  onFormatChange(fmt) {
    if (!this.articleMode) return
    this._artHidePopup()
    const cur = this.pageIndex
    this._artApplyFormat()
    // Unlike EpubReader's chapters (which contain <img>s that can shift layout asynchronously as they
    // load), the article flow is plain text already fully in the DOM — clientHeight/columnWidth are
    // accurate the instant the CSS vars are applied, so this can run synchronously (no rAF needed;
    // relying on rAF here was found to be unreliable in a headless/no-repaint context).
    this._artLayout()
    this._artShowSourcePage(cur)
    this._artApplyHighlights()
    this._artSyncChrome()
  },

  // ==================================================================================================
  // ---- WP10 Article mode: reflows Bridge.pdfPagesText into the same ReaderPaginate multicolumn
  // geometry EpubReader uses. Text is fetched in windows of _artWinSize source pages (this._artLo/
  // this._artHi track the inclusive range currently appended to the flow); the next window is warmed
  // once the reader is ~80% through the currently loaded pages. Each source page's text becomes its
  // own `.pf-art-page[data-page=N]` wrapper so the CURRENT source page can always be recovered by
  // asking which marker sits under the content box's top-left corner (_artCurrentSourcePage) — this
  // is what keeps this.pageIndex (the bookmark/slider/N-of-M source of truth in BOTH modes) accurate
  // as the reader pages through reflowed text. ----
  // ==================================================================================================

  probeTextLayer() {
    // Compatibility accessor for consumers that need a known answer. It intentionally never crosses
    // JavascriptInterface: cold PDFBox work belongs to probeTextLayerAsync()'s native executor.
    return this._hasTextLayer === true
  },

  probeTextLayerAsync(callback) {
    PdfTextLayerProbe.request(this, callback)
  },

  _applyModeVisibility() {
    if (!this._imgwrap || !this._artBox) return
    this._imgwrap.style.display = this.articleMode ? 'none' : 'flex'
    this._artBox.style.display = this.articleMode ? 'flex' : 'none'
    if (!this.articleMode) {
      this._artHidePopup()
      if (this._artHlLayer) this._artHlLayer.innerHTML = ''
    }
  },

  // toggled from the Navigation panel's Article-mode row.
  setArticleMode(on) {
    on = !!on
    if (on === this.articleMode) return
    if (on && this._hasTextLayer === null) {
      const self = this
      Bridge.showToast('Checking PDF text…')
      this.probeTextLayerAsync(function(hasText) {
        if (hasText) self.setArticleMode(true)
        else Bridge.showToast('No text layer in this PDF')
      })
      return
    }
    if (on && !this._hasTextLayer) return
    if (on) {
      this.vs.textbookMode = false
      this.articleMode = true
      this.vs.articleMode = true
      this._saveView()
      this._applyModeVisibility()
      this._artEnter(this.pageIndex)
    } else {
      // AD-2/WP10 point 3: land the bitmap view on the source page the current text marker came from.
      const src = this._artFlow ? this._artCurrentSourcePage() : this.pageIndex
      this.articleMode = false
      this.vs.articleMode = false
      this._saveView()
      this._applyModeVisibility()
      this.pageIndex = src
      this.loadPage()
    }
  },

  // (re)build the flow starting at source page [startPage]: clears any previously loaded window,
  // fetches _artWinSize pages via one Bridge.pdfPagesText call, lays out the columns, then lands on
  // startPage's marker.
  _artEnter(startPage) {
    startPage = Math.max(0, Math.min(this.pages - 1, startPage | 0))
    if (!this._artFlow) return
    this._artHidePopup()
    this._artFlow.innerHTML = ''
    this._artLo = startPage
    this._artHi = Math.min(this.pages - 1, startPage + this._artWinSize - 1)
    this._artAppendPages(this._artLo, this._artHi)
    this._artApplyFormat()
    // synchronous — see onFormatChange's note: no images to wait on, so no rAF needed (and relying on
    // one was found to be unreliable in a headless/no-repaint context).
    this._artLayout()
    this._artShowSourcePage(startPage)
    this._artApplyHighlights()
    this._artSyncChrome()
  },

  // fetch+append source pages [lo,hi] (inclusive) to the END of the flow.
  _artAppendPages(lo, hi) {
    if (!this._artFlow || lo > hi) return
    let arr = []
    try { arr = JSON.parse(Bridge.pdfPagesText(this.nbId, lo, hi) || '[]') } catch (e) { arr = [] }
    for (let i = lo; i <= hi; i++) {
      this._artFlow.appendChild(pfBuildArticlePage(i, arr[i - lo] || ''))
    }
  },

  // fetch+prepend source pages [lo,hi] (inclusive) to the START of the flow (paging backward past
  // the start of the currently loaded window).
  _artPrependPages(lo, hi) {
    if (!this._artFlow || lo > hi) return
    let arr = []
    try { arr = JSON.parse(Bridge.pdfPagesText(this.nbId, lo, hi) || '[]') } catch (e) { arr = [] }
    const frag = document.createDocumentFragment()
    for (let i = lo; i <= hi; i++) {
      frag.appendChild(pfBuildArticlePage(i, arr[i - lo] || ''))
    }
    this._artFlow.insertBefore(frag, this._artFlow.firstChild)
  },

  // re-measure column geometry (reader-paginate.js) after content is added/format changes.
  _artLayout() {
    if (!this._artBox || !this._artFlow) return
    const L = ReaderPaginate.layout(this._artBox, this._artFlow, this._artPagebox, '--pf-art-colh')
    this._artGeomV = L.geom
    this._artPages = Math.max(1, Math.ceil(L.ncols / (L.geom.cols || 1)))
    if (this._artPage >= this._artPages) this._artPage = this._artPages - 1
    if (this._artPage < 0) this._artPage = 0
  },

  // find the `[data-page=N]` marker for source page [pageIdx], falling back to the nearest EARLIER
  // marker actually present (pageIdx itself may have carried no extractable text).
  _artFindMarker(pageIdx) {
    if (!this._artFlow) return null
    let node = null
    try { node = this._artFlow.querySelector('[data-page="' + pageIdx + '"]') } catch (e) { node = null }
    if (node) return node
    const all = this._artFlow.querySelectorAll('[data-page]')
    let best = null, bestPage = -1
    for (let i = 0; i < all.length; i++) {
      const p = parseInt(all[i].getAttribute('data-page'), 10)
      if (p <= pageIdx && p > bestPage) { bestPage = p; best = all[i] }
    }
    return best
  },

  // translate the flow so [pageIdx]'s marker is showing, using the SAME "measure the marker's
  // rect against the flow's own rect" trick EpubReader._gotoCharOffset uses for a character range —
  // the delta between a descendant's rect and the flow's own rect is invariant to the flow's current
  // translateX, so this works regardless of which column-page is currently displayed.
  _artShowSourcePage(pageIdx) {
    const marker = this._artFindMarker(pageIdx)
    if (!marker || !this._artGeomV) return false
    const g = this._artGeomV
    const x = marker.getBoundingClientRect().left - this._artFlow.getBoundingClientRect().left
    const col = Math.max(0, Math.round(x / g.colStride))
    this._artPage = Math.max(0, Math.min(this._artPages - 1, Math.floor(col / g.cols)))
    ReaderPaginate.showPage(this._artFlow, this._artPage, g)
    return true
  },

  // ---- PDF selectable-text highlights -----------------------------------------------------------
  // PDF bitmap pages still are not highlighted by dragging rectangles. This path is intentionally
  // limited to article mode, where the PDF already has selectable/extracted text; each highlight is
  // stored by source PDF page plus offsets inside that page's text DOM.
  _artHlPath(pageIdx) { return 'sidecar/pdf-text-highlights/' + pageIdx + '.json' },
  _artHlIndexPath() { return 'sidecar/pdf-text-highlights/_pages.json' },
  _artReadJson(path, dflt) {
    try {
      const v = JSON.parse(Bridge.getBookFile(this.nbId, path) || 'null')
      return v == null ? dflt : v
    } catch (e) { return dflt }
  },
  _artWriteJson(path, v) {
    try { Bridge.saveBookFile(this.nbId, path, JSON.stringify(v)) } catch (e) {}
  },
  _artLoadHl(pageIdx) {
    if (!this._artHl) this._artHl = {}
    if (this._artHl[pageIdx]) return this._artHl[pageIdx]
    const arr = this._artReadJson(this._artHlPath(pageIdx), [])
    this._artHl[pageIdx] = Array.isArray(arr) ? arr : []
    return this._artHl[pageIdx]
  },
  _artSaveHl(pageIdx) {
    const arr = this._artLoadHl(pageIdx)
    this._artWriteJson(this._artHlPath(pageIdx), arr)
    let pages = this._artReadJson(this._artHlIndexPath(), [])
    if (!Array.isArray(pages)) pages = []
    const pos = pages.indexOf(pageIdx)
    if (arr.length && pos === -1) pages.push(pageIdx)
    if (!arr.length && pos !== -1) pages.splice(pos, 1)
    pages.sort(function(a, b) { return a - b })
    this._artWriteJson(this._artHlIndexPath(), pages)
  },
  _artVisiblePages() {
    if (!this._artFlow) return []
    return Array.prototype.slice.call(this._artFlow.querySelectorAll('.pf-art-page[data-page]'))
  },
  _artPageNodeForRange(range) {
    if (!range || !this._artFlow) return null
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentNode
    const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentNode
    const startPage = startEl && startEl.closest ? startEl.closest('.pf-art-page[data-page]') : null
    const endPage = endEl && endEl.closest ? endEl.closest('.pf-art-page[data-page]') : null
    return startPage && startPage === endPage ? startPage : null
  },
  _artLocate(range) {
    const pageNode = this._artPageNodeForRange(range)
    if (!pageNode) return null
    const a = offsetWithin(pageNode, range.startContainer, range.startOffset)
    const b = pageNode.contains(range.endContainer) ? offsetWithin(pageNode, range.endContainer, range.endOffset) : pageNode.textContent.length
    const pageIdx = parseInt(pageNode.getAttribute('data-page'), 10)
    if (isNaN(pageIdx)) return null
    return { pageIndex: pageIdx, start: Math.min(a, b), end: Math.max(a, b) }
  },
  _artRangeForHighlight(h) {
    if (!h || !this._artFlow) return null
    let pageNode = null
    try { pageNode = this._artFlow.querySelector('.pf-art-page[data-page="' + h.pageIndex + '"]') } catch (e) { pageNode = null }
    if (!pageNode) return null
    return rangeForOffsets(pageNode, h.start, h.end)
  },
  _artApplyHighlights() {
    if (!this._artHlLayer || !this._artFlow || !this.articleMode) return
    this._artHlLayer.innerHTML = ''
    const self = this
    this._artVisiblePages().forEach(function(pageNode) {
      const pageIdx = parseInt(pageNode.getAttribute('data-page'), 10)
      if (isNaN(pageIdx)) return
      self._artLoadHl(pageIdx).forEach(function(h) {
        const range = self._artRangeForHighlight(h)
        if (range) drawRangeInto(self._artHlLayer, range, 'rd-hl')
      })
    })
    if (this._artStudyMark) {
      const pageNode = this._artFindMarker(this._artStudyMark.pageIndex)
      if (pageNode) {
        const range = rangeForOffsets(pageNode, 0, Math.max(1, (pageNode.textContent || '').length))
        if (range) drawRangeInto(this._artHlLayer, range, 'rd-search-hit')
      }
    }
  },
  _artClearSelOverlay() { if (this._artSelLayer) this._artSelLayer.innerHTML = '' },
  _artWireSelection(flow) {
    const self = this
    let startCaret = null, moved = false, sx = 0, sy = 0, lp = null
    const upd = function(x, y) {
      const end = caretRange(x, y)
      if (!startCaret || !end) return
      const r = snapRangeToWords(orderedRange(startCaret, end) || collapsedRange(startCaret))
      if (r && self._artPageNodeForRange(r)) {
        self._artSel = r
        self._artClearSelOverlay()
        drawRangeInto(self._artSelLayer, r, 'rd-sel')
      }
    }
    flow.addEventListener('pointerdown', function(e) {
      if (!self.articleMode || !isHighlightPointer(e)) return
      if (!e.target || !e.target.closest || !e.target.closest('.pf-art-page[data-page]')) return
      self._artHidePopup()
      self._artClearSelOverlay()
      startCaret = caretRange(e.clientX, e.clientY)
      moved = false; sx = e.clientX; sy = e.clientY; self._artSel = null
      upd(e.clientX, e.clientY); clearTimeout(lp)
      lp = setTimeout(function() {
        const hit = self._artHitHighlight(sx, sy)
        if (hit) { startCaret = null; self._artClearSelOverlay(); self._artShowHlMenu(hit, sx, sy) }
      }, 500)
      e.preventDefault()
    })
    flow.addEventListener('pointermove', function(e) {
      if (!startCaret) return
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) { moved = true; clearTimeout(lp) }
      upd(e.clientX, e.clientY)
      e.preventDefault()
    })
    const fin = function() {
      clearTimeout(lp)
      if (!startCaret) return
      startCaret = null
      if (moved && self._artSel && self._artSel.toString().trim()) self._artShowPopup(self._artSel)
      else self._artClearSelOverlay()
    }
    flow.addEventListener('pointerup', fin)
    flow.addEventListener('pointercancel', fin)
    flow.addEventListener('pointerleave', fin)
  },
  _artHitHighlight(x, y) {
    if (!this.articleMode) return null
    const r = caretRange(x, y); if (!r) return null
    const pageNode = this._artPageNodeForRange(r); if (!pageNode) return null
    const pageIdx = parseInt(pageNode.getAttribute('data-page'), 10)
    if (isNaN(pageIdx)) return null
    const off = offsetWithin(pageNode, r.startContainer, r.startOffset)
    const arr = this._artLoadHl(pageIdx)
    for (let i = 0; i < arr.length; i++) if (off >= arr[i].start && off <= arr[i].end) return { pageIndex: pageIdx, index: i }
    return null
  },
  _artShowPopup(range) {
    this._artHidePopup(false)
    const self = this
    const loc = this._artLocate(range)
    if (!loc || loc.end <= loc.start) {
      this._artClearSelOverlay()
      Bridge.showToast('Select text on one PDF page')
      return
    }
    const pop = el('div', 'rd-pop')
    const ref = pageRefFromSelection(range.toString(), this.pages)
    if (ref) {
      const go = el('button', 'rd-pop-btn', '↪ p.' + ref.page)
      ReaderBookLink.wire(go, function() {
        self._artHidePopup()
        self.gotoPage(ref.page - 1)
      })
      pop.appendChild(go)
    }
    const hi = el('button', 'rd-pop-btn', '✎ Highlight')
    hi.addEventListener('click', function() { self._artAddHighlight(loc) })
    const cx = el('button', 'rd-pop-btn', '✕')
    cx.addEventListener('click', function() { self._artHidePopup() })
    pop.appendChild(hi); pop.appendChild(cx); this.view().appendChild(pop)
    this._artPlacePopup(pop, range)
  },
  _artShowHlMenu(hit, x, y) {
    this._artHidePopup()
    const self = this
    const pop = el('div', 'rd-pop')
    const del = el('button', 'rd-pop-btn', '🗑 Delete')
    del.addEventListener('click', function() {
      const arr = self._artLoadHl(hit.pageIndex)
      arr.splice(hit.index, 1)
      self._artSaveHl(hit.pageIndex)
      self._artHidePopup()
      self._artApplyHighlights()
    })
    const cx = el('button', 'rd-pop-btn', '✕')
    cx.addEventListener('click', function() { self._artHidePopup() })
    pop.appendChild(del); pop.appendChild(cx); this.view().appendChild(pop)
    pop.style.top = Math.max(8, y - 52) + 'px'
    pop.style.left = Math.min(Math.max(8, x - 40), window.innerWidth - 220) + 'px'
    this._artPop = pop
  },
  _artPlacePopup(pop, range) {
    let bb = null
    try { bb = range.getBoundingClientRect() } catch (e) {}
    const top = bb ? Math.max(8, bb.top - 52) : 60
    const left = bb ? Math.min(Math.max(8, bb.left), window.innerWidth - 220) : 40
    pop.style.top = top + 'px'
    pop.style.left = left + 'px'
    this._artPop = pop
  },
  _artHidePopup(clearSelection) {
    if (this._artPop) { this._artPop.remove(); this._artPop = null }
    if (clearSelection !== false) this._artClearSelOverlay()
  },
  _artAddHighlight(loc) {
    const arr = this._artLoadHl(loc.pageIndex)
    for (let i = 0; i < arr.length; i++) {
      if (loc.start < arr[i].end && arr[i].start < loc.end) {
        this._artHidePopup()
        Bridge.showToast('Already highlighted')
        return
      }
    }
    arr.push({ pageIndex: loc.pageIndex, start: loc.start, end: loc.end, color: 'yellow', createdAt: new Date().toISOString() })
    this._artSaveHl(loc.pageIndex)
    this._artHidePopup()
    this._artApplyHighlights()
    Bridge.showToast('Highlighted')
  },
  gatherTextHighlights() {
    const out = []
    let pages = this._artReadJson(this._artHlIndexPath(), [])
    if (!Array.isArray(pages)) pages = []
    const self = this
    pages.forEach(function(p) {
      self._artLoadHl(p).forEach(function(h) { out.push({ page: p, start: h.start, end: h.end, text: true }) })
    })
    return out
  },

  // the inverse: which source page is showing right now? Probes a small grid of points near the
  // content box's top-left for the marker under them (mirrors EpubReader._topCharOffset's
  // caretRangeFromPoint anchor technique, but since markers are real elements, elementFromPoint +
  // closest() is all that's needed here). A single fixed probe point isn't reliable — it can land in
  // the container's own CSS padding, a paragraph's text-indent whitespace, or an inter-column gap,
  // all of which report a hit OUTSIDE the flow — so this tries several offsets before giving up.
  _artCurrentSourcePage() {
    if (!this._artFlow || !this._artBox || !document.elementFromPoint) return this.pageIndex
    const cr = this._artBox.getBoundingClientRect()
    const cs = getComputedStyle(this._artBox)
    const padL = parseFloat(cs.paddingLeft) || 0, padT = parseFloat(cs.paddingTop) || 0
    const colW = (this._artGeomV && this._artGeomV.colW) || 200
    const xs = [padL + 8, padL + Math.min(60, colW / 2), padL + Math.max(8, colW - 20)]
    const ys = [padT + 8, padT + 32, padT + 64]
    for (let yi = 0; yi < ys.length; yi++) {
      for (let xi = 0; xi < xs.length; xi++) {
        const hit = document.elementFromPoint(cr.left + xs[xi], cr.top + ys[yi])
        if (!hit || !this._artFlow.contains(hit)) continue
        const marker = hit.closest ? hit.closest('[data-page]') : null
        if (!marker) continue
        const p = parseInt(marker.getAttribute('data-page'), 10)
        if (!isNaN(p)) return p
      }
    }
    return this.pageIndex
  },

  // sync the chrome (nav label/slider/clock/dog-ear/persisted position) from the article flow's
  // CURRENT marker, then warm the next window if we're getting close to the end of this one.
  _artSyncChrome() {
    this.pageIndex = this._artCurrentSourcePage()
    if (this._slider) this._slider.value = String(this.pageIndex)
    this._updateNav()
    this.updateClock()
    this.updateBookmarkGlyph()
    this.savePosition()
    this._artMaybePrefetchNext()
  },

  // prefetch the NEXT window once the reader is ~80% through the pages currently loaded (avoids a
  // layout hitch exactly at the boundary page-turn); guarded so it only ever fires once per window.
  _artMaybePrefetchNext() {
    if (this._artPrefetching) return
    if (this._artHi >= this.pages - 1) return
    if (this._artPages <= 0 || (this._artPage + 1) / this._artPages < 0.8) return
    this._artPrefetching = true
    const self = this
    setTimeout(function() {
      const lo2 = self._artHi + 1
      const hi2 = Math.min(self.pages - 1, lo2 + self._artWinSize - 1)
      self._artAppendPages(lo2, hi2)
      self._artHi = hi2
      self._artLayout()
      self._artApplyHighlights()
      self._artPrefetching = false
    }, 30)
  },

  _artNextPage() {
    if (this._artPage < this._artPages - 1) {
      this._artPage++
    } else if (this._artHi < this.pages - 1) {
      const lo2 = this._artHi + 1
      const hi2 = Math.min(this.pages - 1, lo2 + this._artWinSize - 1)
      this._artAppendPages(lo2, hi2)
      this._artHi = hi2
      this._artLayout()
      if (this._artPage < this._artPages - 1) this._artPage++
    } else {
      return   // already at the end of the book's extracted text
    }
    ReaderPaginate.showPage(this._artFlow, this._artPage, this._artGeomV)
    this._artApplyHighlights()
    this._artSyncChrome()
  },
  _artPrevPage() {
    if (this._artPage > 0) {
      this._artPage--
    } else if (this._artLo > 0) {
      const targetPage = this._artLo   // land back roughly where the reader was
      const newLo = Math.max(0, this._artLo - this._artWinSize)
      this._artPrependPages(newLo, this._artLo - 1)
      this._artLo = newLo
      this._artLayout()
      this._artShowSourcePage(targetPage)
      this._artApplyHighlights()
      this._artSyncChrome()
      return
    } else {
      return   // already at the very start of the book
    }
    ReaderPaginate.showPage(this._artFlow, this._artPage, this._artGeomV)
    this._artApplyHighlights()
    this._artSyncChrome()
  },
  // jump to the source page [idx] regardless of mode's current window; used by the slider, TOC and
  // bookmark jumps. Falls back to a fresh window starting at idx when idx isn't currently loaded.
  _artGotoSourcePage(idx) {
    idx = Math.max(0, Math.min(this.pages - 1, idx | 0))
    if (idx < this._artLo || idx > this._artHi) { this._artEnter(idx); return }
    this._artLayout()
    this._artShowSourcePage(idx)
    this._artApplyHighlights()
    this._artSyncChrome()
  },

  // apply ReaderFormat (WP9) to the article flow root: CSS custom properties (fonts/spacing/margins/
  // embolden) + the font-scale mechanism (a JS-computed pixel size, same as EpubReader.applyFontScale
  // — the --rf-font-scale var isn't consumed by CSS directly, mirroring epub-reader.css exactly).
  _artApplyFormat() {
    if (typeof ReaderFormat === 'undefined' || !this._artBox) return
    ReaderFormat.applyCssVars(this._artBox, ReaderFormat.get())
    this._artApplyFontScale()
  },
  _artApplyFontScale() {
    if (!this._artFlow) return
    this._artFlow.style.fontSize = ''
    const s = (typeof ReaderFormat !== 'undefined') ? ReaderFormat.get().fontScale : 1
    if (s && s !== 1) {
      const base = parseFloat(getComputedStyle(this._artFlow).fontSize) || 19
      this._artFlow.style.fontSize = (Math.round(base * s * 10) / 10) + 'px'
    }
  },

  // ---- Bookmarks adapter (AD-8 loc shape for PDF: {type:'pdf', pageIndex}) ----
  _initBookmarks() {
    if (typeof Bookmarks === 'undefined') return
    const self = this
    Bookmarks.init(this.nbId, {
      currentLoc: function() { return self.currentLoc() },
      describeLoc: function(loc) { return self.describeLoc(loc) },
      gotoLoc: function(loc) { self.gotoBookmarkLoc(loc) },
      locEquals: function(a, b) { return !!a && !!b && a.type === b.type && a.pageIndex === b.pageIndex }
    })
  },
  currentLoc() { return { type: 'pdf', pageIndex: this.pageIndex } },
  describeLoc(loc) { return 'Page ' + (((loc && loc.pageIndex) || 0) + 1) },
  gotoBookmarkLoc(loc) { if (!loc || loc.type !== 'pdf') return; this.gotoPage(loc.pageIndex || 0) },
  toggleBookmarkTap() {
    if (typeof Bookmarks === 'undefined') return
    const nowOn = Bookmarks.toggleAtCurrent()
    this.updateBookmarkGlyph()
    Bridge.showToast(nowOn ? 'Bookmark added' : 'Bookmark removed')
  },
  updateBookmarkGlyph() {
    if (!this._dogear) return
    const on = (typeof Bookmarks !== 'undefined') && Bookmarks.isCurrentBookmarked()
    this._dogear.style.display = on ? 'block' : 'none'
  },

  // ---- bottom-left clock + page readout (stands in for the hidden system status bar) ----
  applyClockSetting() {
    const on = !(typeof localStorage !== 'undefined' && localStorage.getItem('kal.reader.showClock') === '0')
    if (this._clock) this._clock.classList.toggle('hidden', !on)
    this.updateClock()
  },
  updateClock() {
    if (!this._clock) return
    const d = new Date(), hh = d.getHours(), mm = d.getMinutes()
    const t = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
    this._clock.textContent = t + '  ·  ' + (this.pageIndex + 1) + '/' + this.pages
  },

  // ---- view-state persistence (AD-8): sidecar/pdf-view.json, same getBookFile/saveBookFile pattern
  // as Bookmarks. ----
  _loadView() {
    let raw = null
    try { raw = JSON.parse(Bridge.getBookFile(this.nbId, 'sidecar/pdf-view.json')) } catch (e) { raw = null }
    raw = raw || {}
    const c = raw.crop || {}
    this.vs = {
      crop: {
        l: pfClampInt(c.l, 0, 40, 0), t: pfClampInt(c.t, 0, 40, 0),
        r: pfClampInt(c.r, 0, 40, 0), b: pfClampInt(c.b, 0, 40, 0)
      },
      columns: raw.columns === 2 ? 2 : 1,
      direction: raw.direction === 'rtl' ? 'rtl' : 'ltr',
      comic: !!raw.comic,
      embolden: pfClampInt(raw.embolden, 0, 100, 0),
      dark: pfClampInt(raw.dark, 0, 100, 0),
      sharpen: pfClampInt(raw.sharpen, 0, 100, 0),
      bleach: pfClampInt(raw.bleach, 0, 100, 0),
      smoothing: !!raw.smoothing,
      articleMode: !!raw.articleMode,   // WP10: honored on open() only if a text layer is present
      textbookMode: !!raw.textbookMode
    }
  },
  _saveView() {
    Bridge.saveBookFile(this.nbId, 'sidecar/pdf-view.json', JSON.stringify({
      version: 1, crop: this.vs.crop, columns: this.vs.columns, direction: this.vs.direction,
      comic: this.vs.comic, embolden: this.vs.embolden, dark: this.vs.dark,
      sharpen: this.vs.sharpen, bleach: this.vs.bleach, smoothing: this.vs.smoothing,
      articleMode: this.vs.articleMode, textbookMode: this.vs.textbookMode
    }))
  },

  // ---- position save / resume (AD-8): meta.position + readingProgress + lastReadAt, debounced on
  // page turn, flushed immediately on close. ----
  savePosition() {
    const self = this
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(function() { self._savePositionNow() }, 400)
  },
  _savePositionNow() {
    if (!this.info) return
    try {
      const raw = Bridge.getBookFile(this.nbId, 'meta.json')
      const m = JSON.parse(raw) || {}
      m.position = { pageIndex: this.pageIndex }
      if (window.NativePages && NativePages.activeId(this)) m.position.nativePageId = NativePages.activeId(this)
      m.readingProgress = this.pages > 1 ? Math.max(0, Math.min(1, this.pageIndex / (this.pages - 1))) : 0
      m.lastReadAt = new Date().toISOString()
      Bridge.saveBookFile(this.nbId, 'meta.json', JSON.stringify(m))
    } catch (e) {}
  }
}

function pfClampInt(v, min, max, dflt) {
  v = parseInt(v, 10)
  if (isNaN(v)) return dflt
  return Math.max(min, Math.min(max, v))
}

// ---- WP10 article-mode text reflow: raw extracted-page-text → paragraph/heading DOM ----
// (uses the global `el()` helper from content-blocks.js — el() sets textContent, never innerHTML,
// so no HTML escaping step is needed: extracted text can never be interpreted as markup.)

// Split a page's raw text into blocks on blank lines (2+ newlines).
function pfSplitBlocks(text) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(function(b) { return b.trim() }).filter(Boolean)
}

// A block is a heading candidate when it's a SINGLE short line that doesn't end in sentence
// punctuation (covers both short numbered/all-caps headings and this fixture's "Chapter N: Title"
// lines — a superset of "all-caps/numbered", chosen because real extracted PDF headings are rarely
// literally all-caps).
function pfIsHeading(block) {
  if (block.indexOf('\n') !== -1) return false
  const s = block.trim()
  if (!s || s.length > 70) return false
  return !/[.!?]$/.test(s)
}

// Inside a (non-heading) block, rejoin hard-wrapped lines: when a line doesn't end with sentence
// punctuation and the NEXT line starts lowercase, it's a wrap artifact — join with a space. Anything
// else starts a new paragraph within the same block (rare, but keeps stanza-like breaks intact).
function pfJoinHardWraps(block) {
  const lines = block.split('\n').map(function(l) { return l.trim() }).filter(function(l) { return l.length })
  if (!lines.length) return []
  const paras = [lines[0]]
  for (let i = 1; i < lines.length; i++) {
    const prev = paras[paras.length - 1]
    const prevEndsSentence = /[.!?:;"'’”)]$/.test(prev)
    const nextStartsLower = /^[a-z]/.test(lines[i])
    if (!prevEndsSentence && nextStartsLower) paras[paras.length - 1] = prev + ' ' + lines[i]
    else paras.push(lines[i])
  }
  return paras
}

// Build one source page's `.pf-art-page[data-page=N]` wrapper (heading <h3> / paragraph <p> children).
function pfBuildArticlePage(pageIdx, text) {
  const wrap = el('div', 'pf-art-page')
  wrap.setAttribute('data-page', String(pageIdx))
  const blocks = pfSplitBlocks(text)
  if (!blocks.length) {
    wrap.appendChild(el('p', 'pf-art-p pf-art-empty', '(no extracted text on this page)'))
  }
  blocks.forEach(function(block) {
    if (pfIsHeading(block)) {
      wrap.appendChild(el('h3', 'pf-art-h', block))
    } else {
      pfJoinHardWraps(block).forEach(function(para) {
        wrap.appendChild(el('p', 'pf-art-p', para))
      })
    }
  })
  return wrap
}

window.PdfReader = PdfReader
