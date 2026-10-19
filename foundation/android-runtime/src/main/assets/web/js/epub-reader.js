// EPUB reader (AD-4/AD-5): reflows a sanitized chapter (spine item) of an EPUB into the same
// CSS-multicolumn pagination flow as BookReader (shared geometry lives in reader-paginate.js), with
// publisher CSS OFF by default (own base stylesheet — css/epub-reader.css) since arbitrary EPUB CSS vs
// multicolumn pagination doesn't mix (AD-4, Risk 3). Same surface as BookReader: open/close/nextPage/
// prevPage, plus isEpub(meta) as the App.js routing guard (meta.format === 'epub').
window.EpubManifestCache = window.EpubManifestCache || (function() {
  var data = {}, order = []
  return {
    get: function(id) { return data[id] },
    put: function(id, manifest) {
      data[id] = manifest; order = order.filter(function(x) { return x !== id }); order.push(id)
      while (order.length > 8) delete data[order.shift()]
    }
  }
})()

window.EpubOpenRequests = window.EpubOpenRequests || (function() {
  var seq = 0, pending = {}
  window.onEpubOpenReady = function(requestId, result, manifest) {
    var callback = pending[requestId]
    if (!callback) return
    delete pending[requestId]
    callback(result, manifest)
  }
  return {
    open: function(notebookId, callback) {
      var requestId = 'epub-open:' + (++seq) + ':' + Date.now().toString(36)
      pending[requestId] = callback
      Bridge.requestEpubOpen(notebookId, requestId)
      return requestId
    },
    cancel: function(requestId) { delete pending[requestId] }
  }
})()

// Exact reflow page maps are expensive because every spine document must be laid out at the current
// viewport and typography. Persist a bounded cache so reopening the app can use a settled count
// immediately. The cache key includes the book content and every setting that changes pagination.
// Bump the storage-key version whenever the pagination algorithm/base CSS changes incompatibly.
window.EpubPageCountCache = window.EpubPageCountCache || (function() {
  var STORAGE_KEY = 'kal.epub.page-count-cache.v1'
  var MAX_ENTRIES = 32
  var data = {}, order = [], loaded = false
  function contentKey(manifest) {
    var spine = (manifest && manifest.spine) || []
    var hash = 2166136261
    for (var i = 0; i < spine.length; i++) {
      var item = spine[i] || {}
      var value = String(item.href || '') + '\n' + String(item.chars == null ? '' : item.chars) + '\n'
      for (var j = 0; j < value.length; j++) {
        hash ^= value.charCodeAt(j)
        hash = Math.imul(hash, 16777619)
      }
    }
    return spine.length + ':' + (hash >>> 0).toString(16)
  }
  function cacheKey(id, layoutKey, manifest) {
    return String(id) + '\n' + contentKey(manifest) + '\n' + String(layoutKey)
  }
  function validPages(pages) {
    return Array.isArray(pages) && pages.length > 0 && pages.every(function(page) {
      return Number.isInteger(page) && page > 0
    })
  }
  function load() {
    if (loaded) return
    loaded = true
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      if (!Array.isArray(saved)) return
      saved.forEach(function(entry) {
        if (!entry || typeof entry.key !== 'string' || !validPages(entry.pages)) return
        data[entry.key] = entry.pages.slice()
        order.push(entry.key)
      })
      while (order.length > MAX_ENTRIES) delete data[order.shift()]
    } catch (e) {}
  }
  function save() {
    try {
      var saved = order.map(function(key) { return { key: key, pages: data[key] } })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    } catch (e) {}
  }
  return {
    get: function(id, layoutKey, manifest) {
      load()
      var key = cacheKey(id, layoutKey, manifest)
      var pages = data[key]
      if (!pages) return null
      order = order.filter(function(x) { return x !== key }); order.push(key)
      return pages.slice()
    },
    put: function(id, layoutKey, manifest, pages) {
      if (!validPages(pages)) return
      load()
      var key = cacheKey(id, layoutKey, manifest)
      data[key] = pages.slice()
      order = order.filter(function(x) { return x !== key }); order.push(key)
      while (order.length > MAX_ENTRIES) delete data[order.shift()]
      save()
    }
  }
})()

const EpubReader = {
  nbId: null, manifest: null, spineIdx: 0, page: 0, pages: 1,

  isEpub(meta) { return !!(meta && meta.format === 'epub') },

  open(meta) {
    this.nbId = meta.notebookId
    if (this._openRequestId) EpubOpenRequests.cancel(this._openRequestId)
    const self = this
    this._openRequestId = EpubOpenRequests.open(this.nbId, function(result, manifestRaw) {
      self._openRequestId = null
      if (result.indexOf('ok') !== 0) {
        Bridge.showToast('Could not open book')
        return
      }
      let manifest = EpubManifestCache.get(self.nbId) || null
      if (!manifest) {
        try { manifest = JSON.parse(manifestRaw) } catch (e) { manifest = null }
        if (manifest) EpubManifestCache.put(self.nbId, manifest)
      }
      self._finishOpen(meta, manifest)
    })
  },

  _finishOpen(meta, manifest) {
    if (!manifest || !Array.isArray(manifest.spine) || !manifest.spine.length) {
      Bridge.showToast('Could not open book'); return
    }
    this.manifest = manifest
    this._bxTocItems = null; this._bxTocModel = null; this._bxTocCollapsed = {}; this._bxAnnotationsCache = null
    this.spineIdx = 0; this.page = 0
    this._chPages = {}; this._pkey = null
    this._pagePlan = null                    // one stable provisional map, then one exact background map
    this._provisionalSettledKey = null
    this._pageCountJobKey = null
    this._pageCountSeq = (this._pageCountSeq || 0) + 1
    this._renderSeq = 0                      // invalidates old image/font callbacks after rapid turns
    this._settledRenderSeq = 0
    this._pendingImageItem = null
    this._chCache = {}                       // prefetched neighbor chapters (raw XHTML strings)
    this._hl = {}                            // AD-10: highlights per spine item (lazy-loaded from sidecar)
    this._noteIdx = {}                       // AD-10: sticky-note index per spine item
    this._pendingAnchor = null; this._pendingCharOffset = null
    this._pendingFormatAnchor = null; this._reflowAnchor = null
    this._searchMark = null   // WP11: transient search-jump locator ({spineIdx, start, end})
    const pos = meta.position
    if (pos && typeof pos.spineIdx === 'number' && pos.spineIdx >= 0 && pos.spineIdx < manifest.spine.length) {
      this.spineIdx = pos.spineIdx
      this._pendingCharOffset = pos.charOffset || 0
    }
    if (typeof ReaderFormat !== 'undefined') ReaderFormat.load(this.nbId)   // WP9: merged format settings for this book
    this._initBookmarks()
    if (window.NativePages) NativePages.init(this, 'epub', pos && pos.nativePageId)
    document.getElementById('library-view').style.display = 'none'
    document.getElementById('editor-view').style.display = 'none'
    this.view().style.display = 'flex'
    Bridge.enterLibrary()   // hide the ink surface — the WebView is the live reading layer
    Bridge.setImmersive(true)   // hide the Android status + navigation bars for a full-screen page
    App.current = 'epub'
    App.activeReader = this
    const self = this
    if (this._viewportHandler) window.removeEventListener('resize', this._viewportHandler)
    this._viewportHandler = function() { self._scheduleViewportPagination() }
    window.addEventListener('resize', this._viewportHandler)
    this.renderChapter()
    this._clockTimer = setInterval(function() { self.updateClock() }, 30000)
  },

  view() {
    let v = document.getElementById('epub-view')
    if (!v) { v = el('div', null); v.id = 'epub-view'; document.body.appendChild(v) }
    return v
  },

  close() {
    if (this._inkWrap) this.closeInkBox()   // detach the daemon box before leaving the reader
    this.hidePopup()
    this._clearReflowAnchor()
    clearTimeout(this._saveTimer); this._savePositionNow()
    if (window.NativePages) NativePages.close(this)
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null }
    clearTimeout(this._viewportTimer)
    clearTimeout(this._pageDecorationTimer)
    if (this._viewportHandler) window.removeEventListener('resize', this._viewportHandler)
    this._viewportHandler = null
    this._cancelAccuratePageCount()
    this._renderSeq = (this._renderSeq || 0) + 1
    this._chCache = {}; this._chPages = {}; this._pkey = null; this._pagePlan = null
    Bridge.epubClose(this.nbId)
    Bridge.setImmersive(false)   // restore the system bars outside the reader
    this.view().style.display = 'none'
    document.getElementById('library-view').style.display = 'flex'
    App.current = 'library'
    if (typeof invalidateCardMeta === 'function') invalidateCardMeta(this.nbId)   // only this book's progress changed
    if (typeof renderLibrary === 'function') renderLibrary()
  },

  renderChapter() {
    this.hidePopup()
    const self = this
    const renderSeq = (this._renderSeq || 0) + 1
    this._renderSeq = renderSeq
    const idx = this.spineIdx
    const sp = this.manifest.spine[idx]
    const v = this.view(); v.innerHTML = ''

    const content = el('div', 'ep-content'); content.id = 'ep-content'
    const flow = el('div', 'ep-flow'); flow.id = 'ep-flow'
    let raw = this._chCache[idx]
    if (raw == null) raw = Bridge.epubEntry(this.nbId, sp.href) || ''
    this._chCache[idx] = raw
    // WP9 publisherCss toggle: when on, keep <style>/<link rel=stylesheet> (scoped + injected below)
    // instead of stripping them (AD-4 default). float/position/overflow are still stripped either way
    // (they fight the multicolumn pagination regardless of the toggle).
    const fmt = (typeof ReaderFormat !== 'undefined') ? ReaderFormat.get() : { publisherCss: false }
    this._pubCssApplied = !!fmt.publisherCss
    const linkHrefs = fmt.publisherCss ? [] : null
    const sanitized = epSanitize(raw, { keepStyle: fmt.publisherCss, linkHrefs: linkHrefs })
    epMountSanitizedBody(flow, sanitized, fmt.publisherCss)
    const pagebox = el('div', 'ep-pagebox')
    pagebox.appendChild(flow)
    content.appendChild(pagebox)
    v.appendChild(content)
    this._content = content; this._flow = flow; this._pagebox = pagebox
    // WP11: transient search-jump locator overlay (reuses reader-controller.js's drawRangeInto/
    // rangeForOffsets — the same range-drawing machinery BookReader's real highlights use, just
    // without a persistent highlight model behind it). Redrawn every paginate() call below, so it
    // vanishes the moment the reader turns the page or the chapter re-renders.
    this._searchLayer = el('div', 'rd-overlay'); v.appendChild(this._searchLayer)
    // AD-10: persistent highlights (sidecar/highlights/<spineIdx>.json — the SAME store layout as
    // the typed-block reader, just keyed by spine index) + a live selection overlay. Reuses the
    // shared range machinery (rangeForOffsets / drawRangeInto / caretRange / snapRangeToWords).
    this._hlLayer = el('div', 'rd-overlay'); v.appendChild(this._hlLayer)
    this._selLayer = el('div', 'rd-overlay'); v.appendChild(this._selLayer)
    this._loadHl(this.spineIdx)
    this._loadNotes(this.spineIdx)
    // publisher stylesheet (inline <style> + any <link rel=stylesheet> resolved from the zip), scoped to
    // #ep-flow so it can never leak into app chrome — reuses scopeBookCss (book-reader.js, AD-5 sharing).
    if (fmt.publisherCss) {
      let css = sanitized.css || ''
      const dir = epDirOf(sp.href)
      ;(linkHrefs || []).forEach(function(href) {
        const zp = epResolvePath(dir, href)
        const text = Bridge.epubEntry(self.nbId, zp)
        if (text) css += '\n' + text
      })
      if (css.trim()) {
        const styleEl = document.createElement('style')
        styleEl.textContent = scopeBookCss(css, '#ep-flow')
        v.appendChild(styleEl)
      }
    }
    this.applyFormat()

    // floating top bar (revealed by a tap in the top zone): back + title + chapter indicator + font ctl
    // (reuses BookReader's bk-topbar/bk-title/... CSS — generic reader chrome, not blocks-specific)
    const top = el('div', 'bk-topbar'); this._topbar = top
    const back = el('button', 'rd-btn', '← Library'); back.addEventListener('click', function() { self.close() })
    top.appendChild(back)
    top.appendChild(el('div', 'bk-title', this.manifest.title || 'Book'))
    this._ind = el('div', 'bk-ind', ''); top.appendChild(this._ind)
    const fc = el('div', 'bk-fontctl')
    const dec = el('button', 'rd-btn bk-fbtn', 'A−'); dec.addEventListener('click', function() { self.bumpFont(-1) })
    const inc = el('button', 'rd-btn bk-fbtn', 'A+'); inc.addEventListener('click', function() { self.bumpFont(1) })
    fc.appendChild(dec); fc.appendChild(inc); top.appendChild(fc)
    const srchBtn = el('button', 'rd-btn bk-fbtn', '🔍'); srchBtn.addEventListener('click', function() { self.openPanels('search') })
    top.appendChild(srchBtn)
    v.appendChild(top)

    // floating bottom bar: whole-book progress readout + Contents (TOC/bookmarks panel)
    const bot = el('div', 'bk-botbar'); this._botbar = bot
    const row = el('div', 'bk-botrow')
    this._navlbl = el('div', 'bk-navlbl', '')
    const prog = el('div', 'bk-progress'); this._progbar = el('i', null); prog.appendChild(this._progbar)
    row.appendChild(this._navlbl); row.appendChild(prog)
    bot.appendChild(row)
    const btnRow = el('div', 'bk-botbtns')
    const contentsBtn = el('button', 'rd-btn bk-contents-btn', '☰ Contents')
    contentsBtn.addEventListener('click', function() { self.hideBars(); self.openPanels('toc') })
    btnRow.appendChild(contentsBtn)
    bot.appendChild(btnRow)
    v.appendChild(bot)

    this._clock = el('div', 'bk-clock'); v.appendChild(this._clock)
    this.applyClockSetting()

    // top-right dog-ear: visible only while the current page is bookmarked
    this._dogear = el('div', 'bk-dogear'); v.appendChild(this._dogear)

    this.wireTapZones(content)
    this.wireSelection(flow)
    this.wireLinks(flow, sp.href)
    const imagesReady = this.resolveImages(flow, epDirOf(sp.href))

    // Show text on the first frame. A single settled pass follows after this chapter's local images
    // and fonts are ready. Both callbacks are tied to this render, so a fast chapter turn cannot let
    // an old chapter re-paginate the new one.
    requestAnimationFrame(function() {
      if (self._renderSeq === renderSeq && self._flow === flow) self.paginate()
    })
    const fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function() {})
      : Promise.resolve()
    Promise.all([imagesReady, fontsReady]).then(function(ready) {
      self._afterChapterLayoutSettles(renderSeq, flow, ready[0] !== false)
    })
    // Broken image decoders must not prevent navigation restoration forever. Image loading has its
    // own timeout, but this is a final defensive fallback for unusual WebViews.
    setTimeout(function() { self._afterChapterLayoutSettles(renderSeq, flow, false) }, 2200)
    this.savePosition()
    // Boox UI: swap the classic bars for the Boox chrome (engine containers untouched).
    if (window.Boox && Boox.active('reader')) BooxChrome.install(this, 'epub')
  },

  _afterChapterLayoutSettles(renderSeq, flow, assetsReady) {
    if (this._settledRenderSeq === renderSeq) return
    if (this._renderSeq !== renderSeq || this._flow !== flow) return
    this._settledRenderSeq = renderSeq
    const self = this
    let lastWidth = -1, stableFrames = 0, frames = 0
    function settle() {
      if (self._renderSeq !== renderSeq || self._flow !== flow) return
      const width = flow.scrollWidth || 0
      stableFrames = Math.abs(width - lastWidth) < 1 ? stableFrames + 1 : 0
      lastWidth = width; frames++
      if (stableFrames < 2 && frames < 8) { requestAnimationFrame(settle); return }
      self.paginate()
      if (self._pendingStudyEvidence) {
        self._landStudyEvidence()
      } else if (self._pendingImageItem) {
        const image = self._pendingImageItem; self._pendingImageItem = null
        if (!self._gotoImageItem(image)) { self.page = 0; self.paginate() }
      } else if (self._pendingAnchor) {
        const anchor = self._pendingAnchor; self._pendingAnchor = null
        if (!self._gotoAnchor(anchor)) { self.page = 0; self.paginate() }
      } else if (self._pendingCharOffset != null) {
        const off = self._pendingCharOffset
        const keepAnchor = self._pendingFormatAnchor === off
        self._pendingCharOffset = null
        if (keepAnchor) self._pendingFormatAnchor = null
        self._gotoCharOffset(off)
        self._applySearchMark()   // WP11: re-draw the transient mark now the page has actually moved
        if (keepAnchor) self._reflowAnchor = null
      }
      self.prefetchNeighbors()   // warm the adjacent chapters once this one has settled
      if (self._kpPendingBackward && window.NativePages) NativePages.afterRetreat(self, 'epub')
      if (window.NativePages) NativePages.restore(self, 'epub')
      if (window.NativePages) NativePages.afterAnchorNavigation(self)
      self._freezeProvisionalPagePlan(true)
      self._startAccuratePageCount(assetsReady)
    }
    requestAnimationFrame(settle)
  },

  // ---- pagination (shared geometry — reader-paginate.js) ----
  _pageGeom() { return ReaderPaginate.pageGeom(this._content, this._flow) },
  _scheduleViewportPagination() {
    const self = this
    clearTimeout(this._viewportTimer)
    this._viewportTimer = setTimeout(function() {
      if (App.current !== 'epub' || !self._flow) return
      // Preserve the word at the top of the page while the responsive CSS changes the available
      // width/height. paginate() creates a new layout key, so stale exact counts are discarded.
      self._anchorAfterFormatChange(self._topCharOffset())
    }, 120)
  },
  paginate() {
    const c = this._content, f = this._flow; if (!c || !f) return
    const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    const L = ReaderPaginate.layout(c, f, this._pagebox, '--ep-colh')
    if (L.geom.colW < 2) return
    const g = L.geom
    this.pages = Math.max(1, Math.ceil(L.ncols / g.cols))
    if (this.page >= this.pages) this.page = this.pages - 1
    if (this.page < 0) this.page = 0
    ReaderPaginate.showPage(f, this.page, g)
    this._lastPgFlow = f; this._lastPgGeom = g
    this._afterPaginate(g)
    if (window.ReaderTapDiag) {
      const ended = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
      window.ReaderTapDiag.log('epub', 'layout', null, { dt: ended - started })
    }
  },
  _showSettledPage() {
    if (!this._flow || this._lastPgFlow !== this._flow || !this._lastPgGeom) return false
    ReaderPaginate.showPage(this._flow, this.page, this._lastPgGeom)
    this._updatePageUi()
    this._schedulePageDecorations()
    return true
  },
  _afterPaginate(g) {
    clearTimeout(this._pageDecorationTimer)
    this._recordChPages(g)
    this._updatePageUi()
    this._updatePageDecorations()
  },
  _updatePageUi() {
    this._ind.textContent = 'Chapter ' + (this.spineIdx + 1) + ' / ' + this.manifest.spine.length
    const bp = this.bookPages()
    this._updateNav()
    if (this._progbar) {
      const spineLen = this.manifest.spine.length || 1
      const frac = bp ? bp.cur / bp.total
                      : (this.spineIdx + (this.pages ? (this.page + 1) / this.pages : 0)) / spineLen
      this._progbar.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'
    }
    this.updateClock()
  },
  _updatePageDecorations() {
    this.updateBookmarkGlyph()
    this.applyHl()
    this._applySearchMark()
  },
  // Page transforms and counters stay synchronous. Range/caret work is coalesced until a rapid
  // traversal burst settles, so several quick taps do not redraw every highlight intermediate page.
  _schedulePageDecorations() {
    const self = this, flow = this._flow, spineIdx = this.spineIdx, page = this.page
    clearTimeout(this._pageDecorationTimer)
    this._pageDecorationTimer = setTimeout(function() {
      if (self._flow !== flow || self.spineIdx !== spineIdx || self.page !== page) return
      self._updatePageDecorations()
    }, 220)
  },

  // WP11: draw (or clear) the transient search-jump mark for the CURRENT chapter/page. nextPage/
  // prevPage null out this._searchMark before calling paginate(), so this simply redraws nothing —
  // the mark only ever shows right after a search-result tap, until the next page turn.
  _applySearchMark() {
    if (!this._searchLayer) return
    this._searchLayer.innerHTML = ''
    if (!this._searchMark || this._searchMark.spineIdx !== this.spineIdx || !this._flow) return
    const sm = this._searchMark
    if (sm.term) {
      // One-time relocation from backend (collapsed-whitespace) coords to DOM textContent coords:
      // pick the occurrence of the term nearest the reported offset.
      const hay = (this._flow.textContent || '').toLowerCase()
      const needle = String(sm.term).toLowerCase()
      let best = -1, bestDist = Infinity, i = hay.indexOf(needle)
      while (i !== -1) {
        const d = Math.abs(i - sm.start)
        if (d < bestDist) { bestDist = d; best = i }
        if (i > sm.start + 2000) break   // occurrences only drift further from here
        i = hay.indexOf(needle, i + 1)
      }
      if (best >= 0) { sm.start = best; sm.end = best + needle.length }
      sm.term = null                     // relocate once; a re-goto below re-enters this fn cleanly
      if (best >= 0) this._gotoCharOffset(sm.start)   // corrected offset may sit on the next page
    }
    const range = rangeForOffsets(this._flow, sm.start, sm.end)
    if (range) drawRangeInto(this._searchLayer, range, 'rd-search-hit')
  },

  // ---- neighbor-chapter prefetch (mirrors BookReader.prefetchNeighbors) ----
  prefetchNeighbors() {
    const self = this, spine = (this.manifest && this.manifest.spine) || []
    if (!this._chCache) this._chCache = {}
    const want = {}
    ;[this.spineIdx - 1, this.spineIdx, this.spineIdx + 1].forEach(function(i) {
      if (i >= 0 && i < spine.length) want[i] = true
    })
    Object.keys(this._chCache).forEach(function(k) { if (!want[k]) delete self._chCache[k] })
    Object.keys(want).forEach(function(k) {
      const i = parseInt(k, 10)
      if (self._chCache[i] != null) return
      setTimeout(function() {
        if (self._chCache && self._chCache[i] == null && self.manifest)
          self._chCache[i] = Bridge.epubEntry(self.nbId, spine[i].href) || ''
      }, 250)
    })
  },

  // ---- whole-book reflow page count (shared algorithm — reader-paginate.js) ----
  _paginationKey(g) {
    const fmt = (typeof ReaderFormat !== 'undefined') ? ReaderFormat.get() : {}
    const layoutFormat = {
      fontScale: this.fontScale(),
      fontFamily: fmt.fontFamily,
      embolden: fmt.embolden,
      lineSpacing: fmt.lineSpacing,
      paraSpacing: fmt.paraSpacing,
      marginPct: fmt.marginPct,
      marginVPct: fmt.marginVPct,
      publisherCss: !!fmt.publisherCss,
      wordSpacing: fmt.wordSpacing,
      fontEnhance: fmt.fontEnhance,
      indentMode: fmt.indentMode,
      textAlign: fmt.textAlign,
      hyphen: fmt.hyphen
    }
    return [
      g.cols, g.colW,
      this._content ? this._content.clientWidth : 0,
      this._content ? this._content.clientHeight : 0,
      JSON.stringify(layoutFormat)
    ].join(':')
  },
  _recordChPages(g) {
    const key = this._paginationKey(g)
    if (key !== this._pkey) {
      this._cancelAccuratePageCount()
      this._pkey = key
      this._chPages = {}
      this._pagePlan = null
      this._provisionalSettledKey = null
      const cached = EpubPageCountCache.get(this.nbId, key, this.manifest)
      if (cached) this._pagePlan = { key: key, pages: cached.slice(), exact: true }
    }
    this._chPages[this.spineIdx] = this.pages
    this._freezeProvisionalPagePlan(false)
  },
  bookPages() {
    const spine = (this.manifest && this.manifest.spine) || []
    const plan = this._pagePlan
    if (plan && plan.key === this._pkey && plan.pages && plan.pages.length === spine.length) {
      let cur = this.page + 1, total = 0
      for (let i = 0; i < plan.pages.length; i++) {
        const count = Math.max(1, parseInt(plan.pages[i], 10) || 1)
        total += count
        if (i < this.spineIdx) cur += count
      }
      return { cur: Math.min(total, cur), total: total, exact: !!plan.exact }
    }
    return ReaderPaginate.bookPages(spine, this._chPages || {}, function(i) { return i }, this.spineIdx, this.page)
  },
  _freezeProvisionalPagePlan(replace) {
    if (!this._pkey || (this._pagePlan && this._pagePlan.exact)) return
    if (replace && this._provisionalSettledKey === this._pkey) return
    if (this._pagePlan && !replace) return
    const spine = (this.manifest && this.manifest.spine) || []
    if (!spine.length || spine[0].chars == null) return
    let measuredChars = 0, measuredPages = 0
    for (let i = 0; i < spine.length; i++) {
      const count = this._chPages[i]
      if (count) { measuredChars += spine[i].chars || 0; measuredPages += count }
    }
    if (!measuredPages) return
    const charsPerPage = Math.max(1, measuredChars / measuredPages)
    const pages = spine.map(function(item, i) {
      return Math.max(1, Math.round((item.chars || 0) / charsPerPage))
    })
    // A settled visible chapter is an exact measurement and is safe to use in the frozen map.
    const measured = this._chPages
    Object.keys(measured).forEach(function(i) { pages[i] = Math.max(1, measured[i]) })
    this._pagePlan = { key: this._pkey, pages: pages, exact: false }
    if (replace) this._provisionalSettledKey = this._pkey
  },
  _cancelAccuratePageCount() {
    this._pageCountSeq = (this._pageCountSeq || 0) + 1
    this._pageCountJobKey = null
    if (this._pageMeasureNode && this._pageMeasureNode.parentNode)
      this._pageMeasureNode.parentNode.removeChild(this._pageMeasureNode)
    this._pageMeasureNode = null
  },
  _startAccuratePageCount(reuseCurrent) {
    const spine = (this.manifest && this.manifest.spine) || []
    const key = this._pkey
    if (!key || !spine.length || (this._pagePlan && this._pagePlan.exact)) return
    if (this._pageCountJobKey === key) return

    const cached = EpubPageCountCache.get(this.nbId, key, this.manifest)
    if (cached && cached.length === spine.length) {
      this._pagePlan = { key: key, pages: cached.slice(), exact: true }
      this._refreshPageReadout()
      return
    }

    this._pageCountJobKey = key
    const token = (this._pageCountSeq || 0) + 1
    this._pageCountSeq = token
    const exact = new Array(spine.length)
    // The active chapter has just completed the same image/font settling path used by the
    // background measurer, so reuse it and keep the first visible page fast.
    if (reuseCurrent !== false) exact[this.spineIdx] = this.pages
    const self = this
    let index = 0

    function scheduleNext() {
      if (self._pageCountSeq !== token || self._pkey !== key) return
      while (index < spine.length && exact[index]) index++
      if (index >= spine.length) {
        self._pageCountJobKey = null
        self._pagePlan = { key: key, pages: exact.slice(), exact: true }
        EpubPageCountCache.put(self.nbId, key, self.manifest, exact)
        self._refreshPageReadout()
        return
      }
      const nextIndex = index++
      const run = function() {
        if (self._pageCountSeq !== token || self._pkey !== key) return
        self._measureChapterPages(nextIndex, key).then(function(count) {
          if (self._pageCountSeq !== token || self._pkey !== key) return
          if (!count) { self._pageCountJobKey = null; return }
          exact[nextIndex] = count
          scheduleNext()
        })
      }
      if (typeof requestIdleCallback === 'function')
        requestIdleCallback(run, { timeout: 1200 })
      else setTimeout(run, 24)
    }
    scheduleNext()
  },
  _refreshPageReadout() {
    this._updateNav()
    const bp = this.bookPages()
    if (this._progbar && bp)
      this._progbar.style.width = Math.max(0, Math.min(100, bp.cur / bp.total * 100)) + '%'
    this.updateClock() // BooxChrome wraps this and refreshes the bottom-right status as well.
  },
  _measureChapterPages(index, key) {
    const self = this
    const spine = (this.manifest && this.manifest.spine) || []
    const item = spine[index]
    if (!item || !this._content || typeof document === 'undefined') return Promise.resolve(null)

    const raw = (this._chCache && this._chCache[index] != null)
      ? this._chCache[index]
      : (Bridge.epubEntry(this.nbId, item.href) || '')
    const fmt = (typeof ReaderFormat !== 'undefined') ? ReaderFormat.get() : { publisherCss: false }
    const linkHrefs = fmt.publisherCss ? [] : null
    const sanitized = epSanitize(raw, { keepStyle: fmt.publisherCss, linkHrefs: linkHrefs })
    const content = el('div', this._content.className || 'ep-content')
    const pagebox = el('div', 'ep-pagebox')
    const flow = el('div', 'ep-flow')
    flow.id = 'ep-flow-measure'
    epMountSanitizedBody(flow, sanitized, fmt.publisherCss)
    pagebox.appendChild(flow); content.appendChild(pagebox)

    // Match the live content box exactly, but keep it outside the viewport and interaction tree.
    content.style.cssText += ';position:fixed;left:-100000px;top:0;visibility:hidden;' +
      'pointer-events:none;z-index:-1;box-sizing:border-box;width:' + this._content.clientWidth +
      'px;height:' + this._content.clientHeight + 'px;display:block'
    if (typeof ReaderFormat !== 'undefined') ReaderFormat.applyCssVars(content, fmt)
    document.body.appendChild(content)
    this._pageMeasureNode = content

    const scale = this.fontScale()
    if (scale !== 1) {
      const base = parseFloat(getComputedStyle(flow).fontSize) || 19
      flow.style.fontSize = (Math.round(base * scale * 10) / 10) + 'px'
    }

    let styleEl = null
    if (fmt.publisherCss) {
      let css = sanitized.css || ''
      const dir = epDirOf(item.href)
      ;(linkHrefs || []).forEach(function(href) {
        const text = Bridge.epubEntry(self.nbId, epResolvePath(dir, href))
        if (text) css += '\n' + text
      })
      if (css.trim()) {
        styleEl = document.createElement('style')
        styleEl.textContent = scopeBookCss(css, '#ep-flow-measure')
        document.body.appendChild(styleEl)
      }
    }

    function cleanup() {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
      if (content.parentNode) content.parentNode.removeChild(content)
      if (self._pageMeasureNode === content) self._pageMeasureNode = null
    }
    const fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function() {})
      : Promise.resolve()
    return Promise.all([this._loadEpubImages(flow, epDirOf(item.href)), fontsReady])
      .then(function(ready) {
        if (!ready[0]) return null
        return new Promise(function(resolve) {
          let lastWidth = -1, stableFrames = 0, frames = 0
          function settle() {
            if (self._pkey !== key) { resolve(null); return }
            const width = flow.scrollWidth || 0
            stableFrames = Math.abs(width - lastWidth) < 1 ? stableFrames + 1 : 0
            lastWidth = width; frames++
            if (stableFrames < 2 && frames < 8) { requestAnimationFrame(settle); return }
            const layout = ReaderPaginate.layout(content, flow, pagebox, '--ep-colh')
            resolve(layout.geom.colW < 2 ? null : Math.max(1, Math.ceil(layout.ncols / layout.geom.cols)))
          }
          requestAnimationFrame(settle)
        })
      })
      .then(function(count) { cleanup(); return count }, function() { cleanup(); return null })
  },
  _updateNav() {
    if (!this._navlbl) return
    const bp = this.bookPages()
    this._navlbl.textContent = bp
      ? (bp.cur + ' / ' + (bp.exact === false ? '~' : '') + bp.total)
      : ((this.page + 1) + ' / ' + this.pages)
  },

  nextPage() {
    if (window.BooxPageInk && BooxPageInk.modeOn(this)) return
    const self = this
    if (window.NativePages) return NativePages.next(this, 'epub', function() { self._nextSourcePage() })
    this._nextSourcePage()
  },
  _nextSourcePage() {
    this._pendingAnchor = null; this._pendingCharOffset = null
    this._pendingImageItem = null
    this._clearReflowAnchor()
    this._searchMark = null   // WP11: a manual turn clears the transient search-jump mark
    const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    if (this.page < this.pages - 1) {
      this.page++
      if (!this._showSettledPage()) this.paginate()
      this.savePosition()
      if (window.ReaderTapDiag) {
        const ended = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
        window.ReaderTapDiag.log('epub', 'turn-fast', null, { dt: ended - started })
      }
    } else if (this.spineIdx < this.manifest.spine.length - 1) {
      if (window.ReaderTapDiag) window.ReaderTapDiag.log('epub', 'turn-boundary', null)
      this.spineIdx++; this.page = 0; this.renderChapter()
    }
  },
  prevPage() {
    if (window.BooxPageInk && BooxPageInk.modeOn(this)) return
    const self = this
    if (window.NativePages) return NativePages.prev(this, 'epub', function() { return self._prevSourcePage() })
    this._prevSourcePage()
  },
  _prevSourcePage() {
    this._pendingAnchor = null; this._pendingCharOffset = null
    this._pendingImageItem = null
    this._clearReflowAnchor()
    this._searchMark = null
    const started = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    if (this.page > 0) {
      this.page--
      if (!this._showSettledPage()) this.paginate()
      this.savePosition()
      if (window.ReaderTapDiag) {
        const ended = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
        window.ReaderTapDiag.log('epub', 'turn-fast', null, { dt: ended - started })
      }
      return false
    } else if (this.spineIdx > 0) {
      if (window.ReaderTapDiag) window.ReaderTapDiag.log('epub', 'turn-boundary', null)
      this.spineIdx--; this.page = 1e9; this.renderChapter(); return true
    }
    return false
  },

  // ---- tap-zone navigation (mirrors BookReader.wireTapZones, minus the highlight/ink-specific skips) ----
  wireTapZones(content) {
    const self = this
    let downX = 0, downY = 0, downT = null, downTarget = null, moved = false
    // EPUB images deliberately remain page-turn targets on a short tap. Their independent 500 ms
    // hold recognizer opens the same viewer as the blocks reader without putting img in this skip
    // list. Links and actual controls keep ownership of their short taps.
    const CONTROL_SKIP = 'button, input'
    const LINK_SKIP = 'a'
    let suppressedClick = null
    const diag = function(reason, e, data) {
      if (window.ReaderTapDiag) window.ReaderTapDiag.log('epub', reason, e, data)
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
      if (self._inkWrap || self._pop) { diag('modal', e, { dt: dt }); return }
      if (moved) { diag('moved', e, { dt: dt, dx: dx, dy: dy }); return }
      const r = content.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      const inTurnBand = y >= r.height * 0.14 && y <= r.height * 0.86 &&
        (x < r.width * 0.33 || x > r.width * 0.67)
      const link = downTarget && downTarget.closest ? downTarget.closest(LINK_SKIP) : null
      const suppressOriginatingLinkClick = function() {
        if (!link) return
        const token = {}
        suppressedClick = { anchor: link, token: token }
        // A synthetic click belonging to this pointer sequence follows pointerup in the same task.
        // Clear on the next task so a later, unrelated click can never be consumed.
        setTimeout(function() {
          if (suppressedClick && suppressedClick.token === token) suppressedClick = null
        }, 0)
        e.preventDefault()
      }
      // A footnote hold is still a request to read the note. This check must precede the general
      // 400 ms long-press rejection or WebView owns the gesture and shows its native link preview.
      if (link && link.hasAttribute('data-epub-note-ref')) {
        suppressOriginatingLinkClick()
        diag(dt > 400 ? 'open-note-hold' : 'open-note-link', e, { dt: dt })
        self.openFootnote(link.getAttribute('href') || '', link.getAttribute('data-epub-chapter-href') || '', link)
        return
      }
      if (dt > 400) { diag('long', e, { dt: dt, dx: dx, dy: dy }); return }
      if (downTarget && downTarget.closest && downTarget.closest(CONTROL_SKIP)) {
        diag('skip-target', e, { dt: dt }); return
      }
      // App-owned bookmark/chrome zones always win, including when a publisher wraps the whole page
      // in a link. Suppress only the click generated by this exact anchor pointer sequence.
      if (x > r.width - 64 && y < 64) {
        suppressOriginatingLinkClick()
        diag('bookmark', e, { dt: dt, zone: 'top-right' }); self.toggleBookmarkTap(); return
      }
      if (self.barsOpen()) {
        suppressOriginatingLinkClick()
        diag('bars-close', e, { dt: dt }); self.hideBars(); return
      }
      if (y < r.height * 0.14) {
        suppressOriginatingLinkClick()
        diag('top-bar', e, { dt: dt, zone: 'top' }); self.toggleBar('top'); return
      }
      if (y > r.height * 0.86) {
        suppressOriginatingLinkClick()
        diag('bottom-bar', e, { dt: dt, zone: 'bottom' }); self.toggleBar('bottom'); return
      }
      // Publisher links keep normal ownership in the centre. In the explicit left/right turn band,
      // page traversal wins so a full-page or wrapping <a> cannot make that edge intermittently inert.
      if (link) {
        if (!inTurnBand) { diag('skip-link', e, { dt: dt }); return }
        suppressOriginatingLinkClick()
      }
      if (x < r.width * 0.33) { diag('prev', e, { dt: dt, zone: 'left' }); self.prevPage() }
      else if (x > r.width * 0.67) { diag('next', e, { dt: dt, zone: 'right' }); self.nextPage() }
      else diag('center', e, { dt: dt, zone: 'center' })
    })
    content.addEventListener('pointercancel', function(e) {
      if (downT != null) diag('cancel', e, { dt: e.timeStamp - downT })
      downT = null
    }, true)
    content.addEventListener('click', function(e) {
      if (!suppressedClick) return
      const clickLink = e.target && e.target.closest ? e.target.closest(LINK_SKIP) : null
      if (clickLink !== suppressedClick.anchor) return
      suppressedClick = null
      e.preventDefault(); e.stopPropagation()
      diag('link-click-suppressed', e)
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

  // ---- ReaderPanels integration: bottom-sheet with 'toc' + 'bookmarks' tabs (see reader-panels.js) ----
  openPanels(activeTab) {
    if (window.Boox && Boox.active('reader')) return BooxPanels.open(this, activeTab)
    if (typeof ReaderPanels === 'undefined') return
    const self = this
    ReaderPanels.open({
      active: activeTab || 'toc',
      tabs: [
        { id: 'toc', label: 'TOC', build: function(body) { self.buildTocPanel(body) } },
        { id: 'quizzes', label: 'Workbooks', build: function(body) { NativePages.buildQuizPanel(self, body) } },
        { id: 'bookmarks', label: 'Bookmarks', build: function(body) { self.buildBookmarksPanel(body) } },
        { id: 'images', label: 'Pictures', build: function(body) { self.buildImagesPanel(body) } },
        { id: 'search', label: 'Search', build: function(body) { self.buildSearchPanel(body) } },
        { id: 'format', label: 'Format', build: function(body) { self.buildFormatPanel(body) } }
      ]
    })
  },

  // ---- WP11 in-book search: AD-9 bridge backend (Bridge.searchBook → window.onSearchResults, both
  // routed through the ONE global dispatcher in reader-search.js). The preview stub / native bridge
  // both deliver a single done=true batch (see AndroidBridge.searchBook's kdoc), but this treats it
  // generically (accumulates across calls) in case that ever changes. ----
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
          const spine = (self.manifest && self.manifest.spine) || []
          const toc = (self.manifest && self.manifest.toc) || []
          const mapped = acc.map(function(m) {
            const t = toc.find(function(e) { return e.spineIdx === m.spineIdx })
            const label = (t && t.label) || (spine[m.spineIdx] && spine[m.spineIdx].title) ||
                          ('Chapter ' + ((m.spineIdx || 0) + 1))
            return { spineIdx: m.spineIdx, charOffset: m.charOffset, len: query.length, snippet: m.snippet, ref: label }
          })
          onBatch(mapped, done)
        })
        Bridge.searchBook(self.nbId, query, token)
      },
      gotoMatch(match) { self.gotoSearchMatch(match) }
    }
  },
  // land on the chapter+page holding [match], then draw a transient locator mark (_applySearchMark,
  // called from paginate() below — mirrors BookReader.gotoSearchMatch's cross-chapter handling via
  // the existing _pendingCharOffset anchor-restore path renderChapter() already has).
  gotoSearchMatch(match) {
    if (!match) return
    this._pendingAnchor = null
    const start = match.charOffset || 0, end = start + Math.max(1, match.len || 1)
    // The backend counts chars in EpubManager's tag-stripped, whitespace-COLLAPSED text, but
    // rangeForOffsets counts the live DOM textContent (raw source whitespace) — the two schemes
    // drift a few chars per chapter. Carry the matched term (bolded in the snippet) so
    // _applySearchMark can relocate to the nearest real occurrence once the flow exists.
    const bold = /<b>(.*?)<\/b>/i.exec(match.snippet || '')
    const term = match.term || (bold && bold[1]) || null
    this._searchMark = { spineIdx: match.spineIdx, start: start, end: end, term: term }
    if (match.spineIdx !== this.spineIdx && match.spineIdx >= 0 && match.spineIdx < this.manifest.spine.length) {
      this._pendingCharOffset = start
      this.spineIdx = match.spineIdx; this.page = 0; this.renderChapter()
    } else {
      this._gotoCharOffset(start)
      this._applySearchMark()
    }
  },

  // AI evidence targets are assigned by the local EPUB source adapter, never by the model. Reuse
  // the transient search locator so tapping a citation opens the exact reflow page without adding a
  // permanent annotation to the book.
  gotoStudyEvidence(target, done) {
    if (!target || target.kind !== 'epub') { if (done) done(false); return }
    const si = target.spineIdx | 0
    if (si < 0 || !this.manifest || si >= this.manifest.spine.length) {
      if (done) done(false)
      return
    }
    this._pendingAnchor = null
    this._pendingCharOffset = null
    this._pendingStudyEvidence = { target: target, done: done }
    if (si !== this.spineIdx) {
      this.spineIdx = si
      this.page = 0
      this.renderChapter()
    } else {
      const self = this
      requestAnimationFrame(function() { self._landStudyEvidence() })
    }
  },
  _landStudyEvidence() {
    const pending = this._pendingStudyEvidence
    if (!pending || !this._flow) return false
    this._pendingStudyEvidence = null
    const target = pending.target || {}
    let start = Number.isInteger(target.start) ? target.start : null
    let end = Number.isInteger(target.end) ? target.end : null
    if (Number.isInteger(target.segmentIndex)) {
      const nodes = this._flow.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,td,th')
      const segment = nodes[target.segmentIndex]
      if (segment) {
        start = offsetWithin(this._flow, segment, 0)
        end = start + Math.max(1, (segment.textContent || '').length)
      }
    }
    const len = (this._flow.textContent || '').length
    start = Math.max(0, Math.min(len, start == null ? 0 : start))
    end = Math.max(start + 1, Math.min(len, end == null ? start + 1 : end))
    this._searchMark = { spineIdx: this.spineIdx, start: start, end: end }
    this._gotoCharOffset(start)
    this._applySearchMark()
    if (pending.done) pending.done(true)
    return true
  },

  // Format tab (WP9, js/reader-format.js): Fonts/Spacing stepper rows + the Publisher-styles toggle
  // (epub only). Every change persists (per-book sidecar + new globals) and re-applies here.
  buildFormatPanel(body) {
    const self = this
    if (typeof ReaderFormat === 'undefined') return
    ReaderFormat.buildPanel(body, { epub: true, onChange: function(fmt) { self.onFormatChange(fmt) } })
  },
  onFormatChange(fmt) {
    // publisherCss changed the SANITIZE path (which nodes even exist), not just layout vars — needs a
    // full chapter re-render. Reuses the existing _pendingCharOffset anchor-restore renderChapter()
    // already does on open()/jumpToToc() (see _pendingCharOffset handling in renderChapter above).
    if (!!fmt.publisherCss !== !!this._pubCssApplied) {
      const off = this._topCharOffset()
      this._pendingAnchor = null
      this._pendingCharOffset = off
      this._pendingFormatAnchor = off
      this.renderChapter()
      return
    }
    const off = this._topCharOffset()      // first visible word on this page before reflow
    this.applyFormat()
    this._anchorAfterFormatChange(off)
  },
  // apply the merged ReaderFormat settings to this chapter's content root: CSS vars (font family/
  // line/paragraph spacing/margins/embolden) + the existing font-scale mechanism (fontScale() below
  // now reads through ReaderFormat instead of its own localStorage key).
  applyFormat() {
    if (typeof ReaderFormat === 'undefined' || !this._content) return
    ReaderFormat.applyCssVars(this._content, ReaderFormat.get())
    this.applyFontScale()
  },

  // Table-of-contents tab: manifest.toc entries {label, href, spineIdx, level}; falls back to a plain
  // per-chapter list if the book carries no nav/NCX-derived TOC. Paginated (no scrollbar).
  buildTocPanel(body) {
    const self = this
    let items = this._bxTocItems
    if (!items) {
      const toc = (this.manifest && this.manifest.toc) || []
      items = toc.length ? toc : (this.manifest.spine || []).map(function(s, i) {
        return { label: s.title || ('Chapter ' + (i + 1)), spineIdx: i }
      })
      this._bxTocItems = items
    }
    BooxToc.render(this, body, items,
      function(e) { return Math.max(1, e.level || 1) },
      function(e, i) { return 'epub:' + i + ':' + (e.href || e.label || '') },
      function(e) {
      const lvl = Math.max(1, e.level || 1)
      const row = el('button', 'rp-row rp-toc-l' + lvl + (e.spineIdx === self.spineIdx ? ' sel' : ''))
      row.style.setProperty('--toc-indent', Math.min(72, (lvl - 1) * 18) + 'px')
      row.appendChild(el('span', 'rp-row-label', e.label || ('Chapter ' + ((e.spineIdx || 0) + 1))))
      ReaderBookLink.wire(row, function() { ReaderPanels.close(); self.jumpToToc(e) })
      return row
    })
  },

  // Pictures tab: EpubManager records local <img> references while building the cached
  // manifest, so opening this gallery never scans every chapter through the JavaScript bridge.
  // Only the visible thumbnail page is streamed from the EPUB zip.
  buildImagesPanel(body) {
    const self = this
    const items = (this.manifest && this.manifest.images) || []
    const toc = (this.manifest && this.manifest.toc) || []
    ReaderPanels.imageGallery(body, items, {
      src: function(item) { return self._epubImageStreamUrl(item.zipPath) },
      fallback: function(item) { return Bridge.epubAssetDataUrl(self.nbId, item.zipPath) || '' },
      label: function(item, i) { return item.label || ('Picture ' + (i + 1)) },
      ref: function(item) {
        const entry = toc.find(function(e) { return e.spineIdx === item.spineIdx })
        return (entry && entry.label) || ('Chapter ' + ((item.spineIdx || 0) + 1))
      },
      select: function(item) { ReaderPanels.close(); self.gotoImageItem(item) }
    })
  },
  _epubImageStreamUrl(zipPath) {
    const path = String(zipPath || '').split('/').map(encodeURIComponent).join('/')
    return 'https://kalamos.content/epub/' + encodeURIComponent(this.nbId) + '/' + path
  },
  gotoImageItem(item) {
    if (!item) return
    this._searchMark = null; this._pendingAnchor = null; this._pendingCharOffset = null
    const si = parseInt(item.spineIdx, 10)
    if (isNaN(si) || si < 0 || si >= this.manifest.spine.length) return
    this._pendingImageItem = item
    const self = this
    if (si !== this.spineIdx) { this.spineIdx = si; this.page = 0; this.renderChapter() }
    else requestAnimationFrame(function() {
      const image = self._pendingImageItem; self._pendingImageItem = null
      if (!self._gotoImageItem(image)) { self.page = 0; self.paginate() }
    })
  },
  _gotoImageItem(item) {
    if (!item || !this._flow || !this._pagebox) return false
    const images = this._flow.querySelectorAll('img[data-epub-path]')
    let target = images[parseInt(item.ordinal, 10) || 0] || null
    if (target && target.getAttribute('data-epub-path') !== String(item.zipPath)) target = null
    for (let i = 0; !target && i < images.length; i++) {
      if (images[i].getAttribute('data-epub-path') === String(item.zipPath)) {
        target = images[i]; break
      }
    }
    if (!target) return false
    const rects = target.getClientRects()
    if (!rects.length) return false
    const g = this._pageGeom()
    const box = this._pagebox.getBoundingClientRect()
    const rawLeft = rects[0].left - box.left + this.page * g.pageStride
    const col = Math.max(0, Math.round(rawLeft / g.colStride))
    this.page = Math.max(0, Math.min(this.pages - 1, Math.floor(col / g.cols)))
    this.paginate(); this.savePosition()
    return true
  },

  // Bookmarks tab (identical shape to BookReader.buildBookmarksPanel).
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

  // jump to a TOC target: switch chapter (if needed) then land on the fragment's anchor (or the top)
  jumpToToc(entry) {
    this._searchMark = null
    const si = entry.spineIdx
    const frag = (entry.href && entry.href.indexOf('#') !== -1) ? entry.href.split('#')[1] : null
    this._pendingAnchor = frag || null
    this._pendingCharOffset = null
    if (si !== this.spineIdx && si >= 0 && si < this.manifest.spine.length) {
      this.spineIdx = si; this.page = 0; this.renderChapter()
    } else if (frag) {
      const self = this
      requestAnimationFrame(function() { if (!self._gotoAnchor(frag)) { self.page = 0; self.paginate() } })
    } else { this.page = 0; this.paginate(); this.savePosition() }
  },
  // land on the page holding the element with id=[anchorId] (an EPUB nav/NCX fragment target)
  _gotoAnchor(anchorId) {
    if (!anchorId || !this._flow) return false
    const target = epFindById(this._flow, anchorId)
    if (!target) return false
    const off = offsetWithin(this._flow, target, 0)
    this._gotoCharOffset(off)
    return true
  },

  // Keep publisher chapter/footnote links inside the EPUB reader. Without this interception a
  // relative href is resolved against app.html's file:///android_asset/web/ base and replaces the
  // whole Kalamos UI with Chromium's ERR_FILE_NOT_FOUND page.
  wireLinks(flow, chapterHref) {
    const self = this
    Array.prototype.forEach.call(flow.querySelectorAll('a[href]'), function(link) {
      const href = link.getAttribute('href') || ''
      if (!href) return
      if (self._isFootnoteReference(link, href)) {
        const publisherLabel = String(link.textContent || '').trim()
        const compactLabel = publisherLabel.replace(/^fn\s*/i, '').trim()
        if (compactLabel && compactLabel !== publisherLabel) link.textContent = compactLabel
        link.setAttribute('data-epub-note-ref', 'true')
        link.setAttribute('data-epub-chapter-href', chapterHref)
        link.setAttribute('data-epub-note-label', compactLabel || publisherLabel)
        link.setAttribute('aria-haspopup', 'dialog')
        link.setAttribute('draggable', 'false')
        if (!link.getAttribute('aria-label') && (compactLabel || publisherLabel)) {
          link.setAttribute('aria-label', 'Footnote ' + (compactLabel || publisherLabel))
        }
        // Android WebView otherwise treats a held footnote marker as an ordinary hyperlink and
        // displays its native file:// link preview. Keep the gesture owned by the reader.
        link.addEventListener('pointerdown', function(event) { event.preventDefault() })
        link.addEventListener('contextmenu', function(event) {
          event.preventDefault(); event.stopPropagation()
        })
        link.addEventListener('click', function(event) {
          event.preventDefault(); event.stopPropagation()
          self.openFootnote(href, chapterHref, link)
        })
        return
      }
      ReaderBookLink.wire(link, function() { self.followEpubLink(href, chapterHref) })
    })
  },

  _isFootnoteReference(link, href) {
    const semantics = [link.getAttribute('epub:type'), link.getAttribute('role'), link.className,
      link.id].join(' ').toLowerCase()
    if (/\b(?:noteref|doc-noteref)\b/.test(semantics)) return true
    const fragment = String(href || '').split('#')[1] || ''
    return /^(?:footnote|note|fn)[-_:.]?\d+/i.test(fragment)
  },

  openFootnote(href, chapterHref, sourceLink) {
    href = String(href || '').trim()
    const hashAt = href.indexOf('#')
    if (hashAt < 0) return this.followEpubLink(href, chapterHref)
    const rawPath = href.slice(0, hashAt).split('?')[0]
    let fragment = href.slice(hashAt + 1)
    try { fragment = decodeURIComponent(fragment) } catch (e) {}
    const targetPath = rawPath ? epResolvePath(epDirOf(chapterHref), rawPath) : epPathKey(chapterHref)
    const raw = Bridge.epubEntry(this.nbId, targetPath) || ''
    const sanitized = epSanitize(raw)
    const holder = document.createElement('div')
    holder.innerHTML = sanitized.html || ''
    const target = epFindById(holder, fragment)
    if (!target) {
      if (typeof Bridge !== 'undefined' && Bridge.showToast) Bridge.showToast('Could not open this footnote')
      return false
    }

    // EPUBs disagree about where the fragment id lives. It may identify the semantic footnote
    // container, a paragraph/list item, or only the tiny backlink marker inside that block. Clone
    // the smallest complete note container so the marker never replaces the actual note text.
    const noteRoot = epFootnoteRoot(target, holder)
    const note = document.createElement('div')
    note.appendChild(noteRoot.cloneNode(true))
    Array.prototype.forEach.call(note.querySelectorAll('a'), function(anchor) {
      if (/backlink|doc-backlink/i.test([anchor.className, anchor.getAttribute('role')].join(' '))) {
        anchor.remove(); return
      }
      const span = document.createElement('span')
      while (anchor.firstChild) span.appendChild(anchor.firstChild)
      anchor.replaceWith(span)
    })
    epTrimFootnoteLead(note)
    this.hidePopup()
    const self = this
    const overlay = el('div', 'ep-footnote-overlay')
    const card = el('section', 'ep-footnote-card')
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-labelledby', 'ep-footnote-title')
    const head = el('header', 'ep-footnote-head')
    const ref = String(sourceLink && (sourceLink.getAttribute('data-epub-note-label') || sourceLink.textContent) || '')
      .trim().replace(/^fn\s*/i, '')
    const title = el('h2', 'ep-footnote-title', 'Footnote' + (ref ? ' ' + ref : ''))
    title.id = 'ep-footnote-title'
    const close = el('button', 'ep-footnote-close', 'Close')
    close.type = 'button'; close.addEventListener('click', function() { self.hidePopup() })
    head.appendChild(title); head.appendChild(close)
    const body = el('div', 'ep-footnote-body')
    while (note.firstChild) body.appendChild(note.firstChild)
    const open = el('button', 'ep-footnote-open', 'Open notes page')
    open.type = 'button'; open.addEventListener('click', function() {
      self.hidePopup(); self.followEpubLink(href, chapterHref)
    })
    card.appendChild(head); card.appendChild(body); card.appendChild(open); overlay.appendChild(card)
    overlay.addEventListener('click', function(event) { if (event.target === overlay) self.hidePopup() })
    this.view().appendChild(overlay); this._pop = overlay
    requestAnimationFrame(function() { close.focus() })
    return true
  },

  followEpubLink(href, chapterHref) {
    href = String(href || '').trim()
    if (!href || /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(href)) return false

    const hashAt = href.indexOf('#')
    const rawPath = hashAt === -1 ? href : href.slice(0, hashAt)
    let fragment = hashAt === -1 ? '' : href.slice(hashAt + 1)
    try { fragment = decodeURIComponent(fragment) } catch (e) {}
    const pathOnly = rawPath.split('?')[0]
    const targetPath = pathOnly
      ? epResolvePath(epDirOf(chapterHref), pathOnly)
      : epPathKey(chapterHref)
    const key = epPathKey(targetPath)
    const spine = (this.manifest && this.manifest.spine) || []
    const targetIdx = spine.findIndex(function(item) {
      return epPathKey(item && item.href) === key
    })
    if (targetIdx < 0) {
      if (typeof Bridge !== 'undefined' && Bridge.showToast) Bridge.showToast('Could not open this book link')
      return false
    }
    this.jumpToToc({
      spineIdx: targetIdx,
      href: key + (fragment ? '#' + fragment : '')
    })
    return true
  },

  // ---- Bookmarks adapter (AD-8 loc shape for EPUB: {type:'epub', spineIdx, charOffset}) ----
  _initBookmarks() {
    if (typeof Bookmarks === 'undefined') return
    const self = this
    Bookmarks.init(this.nbId, {
      currentLoc: function() { return self.currentLoc() },
      describeLoc: function(loc) { return self.describeLoc(loc) },
      gotoLoc: function(loc) { self.gotoBookmarkLoc(loc) },
      locEquals: function(a, b) {
        return !!a && !!b && a.type === b.type && a.spineIdx === b.spineIdx && a.charOffset === b.charOffset
      }
    })
  },
  currentLoc() { return { type: 'epub', spineIdx: this.spineIdx, charOffset: this._topCharOffset() || 0 } },
  describeLoc(loc) {
    const spine = (this.manifest && this.manifest.spine) || []
    const toc = (this.manifest && this.manifest.toc) || []
    const t = toc.find(function(e) { return e.spineIdx === loc.spineIdx })
    const label = (t && t.label) || ('Chapter ' + ((loc.spineIdx || 0) + 1))
    const chars = (spine[loc.spineIdx] && spine[loc.spineIdx].chars) || 0
    const pct = chars ? Math.min(99, Math.round(100 * (loc.charOffset || 0) / chars)) : 0
    return label + '  ·  ' + pct + '%'
  },
  gotoBookmarkLoc(loc) {
    if (!loc || loc.type !== 'epub') return
    this._pendingAnchor = null
    this._searchMark = null
    if (loc.spineIdx !== this.spineIdx) {
      this._pendingCharOffset = loc.charOffset || 0
      this.spineIdx = loc.spineIdx; this.page = 0; this.renderChapter()
    } else {
      this._gotoCharOffset(loc.charOffset || 0)
    }
  },
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

  // ---- AD-10 highlights (per-spine-item, sidecar/highlights/<spineIdx>.json) --------------------
  // Mirrors the typed-block reader's model + selection flow (shared range helpers in
  // reader-controller.js), so both formats write the same sidecar/highlights store. Sticky-note ink
  // (the daemon box) is a follow-up; the persistent highlight + its overlay are here now.
  _hlPath(idx) { return 'sidecar/highlights/' + idx + '.json' },
  _loadHl(idx) {
    if (!this._hl) this._hl = {}
    if (this._hl[idx]) return this._hl[idx]
    try { this._hl[idx] = JSON.parse(Bridge.getBookFile(this.nbId, this._hlPath(idx)) || '[]') } catch (e) { this._hl[idx] = [] }
    if (!Array.isArray(this._hl[idx])) this._hl[idx] = []
    return this._hl[idx]
  },
  _saveHl(idx) {
    if (window.BooxAnnotations && BooxAnnotations.invalidate) BooxAnnotations.invalidate(this)
    else this._bxAnnotationsCache = null
    try {
      const arr = this._hl[idx] || []
      Bridge.saveBookFile(this.nbId, this._hlPath(idx), JSON.stringify(arr))
      this._saveSidecarSpineIndex('highlights', idx, !!arr.length)
    } catch (e) {}
  },
  hlList(idx) { return (this._hl && this._hl[idx]) || [] },

  applyHl() {
    if (!this._hlLayer || !this._flow) return
    this._hlLayer.innerHTML = ''
    const self = this, notes = this.noteList(this.spineIdx)
    this.hlList(this.spineIdx).forEach(function(h) {
      const range = rangeForOffsets(self._flow, h.start, h.end); if (!range) return
      const bb = drawRangeInto(self._hlLayer, range, 'rd-hl')
      // a ✎ marker sits at any highlight that carries a sticky note; tapping it re-opens the note
      const note = notes.find(function(n) { return n.anchor && n.anchor.start === h.start && n.anchor.end === h.end })
      if (note && bb) {
        const icon = el('span', 'rd-note-icon')
        icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="#000"/></svg>'
        icon.style.left = (bb.r - 10) + 'px'; icon.style.top = (bb.b - 10) + 'px'
        icon.addEventListener('click', function() { self.openNote(note) })
        self._hlLayer.appendChild(icon)
      }
    })
  },

  locate(range) {
    const a = offsetWithin(this._flow, range.startContainer, range.startOffset)
    const b = this._flow.contains(range.endContainer) ? offsetWithin(this._flow, range.endContainer, range.endOffset) : this._flow.textContent.length
    return { start: Math.min(a, b), end: Math.max(a, b) }
  },

  clearSelOverlay() { if (this._selLayer) this._selLayer.innerHTML = '' },

  // Pen drag highlights immediately. Finger highlighting requires a 400 ms hold, so the ordinary
  // quick taps used for page turns never flash a transient word selection.
  wireSelection(flow) {
    const self = this
    let startCaret = null, moved = false, sx = 0, sy = 0, activation = null, down = false
    const highlightHold = ReaderHighlightLongPress(function(x, y) {
      const i = self.hitHl(x, y)
      if (i == null) return
      startCaret = null
      self.clearSelOverlay()
      self.openHighlightNoteOrMenu(i, x, y)
    })
    const upd = function(x, y) {
      const end = caretRange(x, y); if (!startCaret || !end) return
      const r = snapRangeToWords(orderedRange(startCaret, end) || collapsedRange(startCaret))
      if (r) { self._sel = r; self.clearSelOverlay(); drawRangeInto(self._selLayer, r, 'rd-sel') }
    }
    const activate = function(x, y) {
      if (!down) return
      startCaret = caretRange(x, y)
      self._sel = null
      upd(x, y)
    }
    flow.addEventListener('pointerdown', function(e) {
      if (!isHighlightPointer(e)) return
      if (self._inkWrap) return                                     // a sticky-note box owns the surface
      if (e.target && e.target.closest && e.target.closest('a[data-epub-note-ref]')) return
      if (e.target && e.target.tagName === 'IMG') return
      self.hidePopup(); self.clearSelOverlay(); startCaret = null; moved = false; down = true
      sx = e.clientX; sy = e.clientY; self._sel = null
      clearTimeout(activation); highlightHold.start(e)
      if (e.pointerType === 'touch') activation = setTimeout(function() { activate(sx, sy) }, 400)
      else activate(sx, sy)
      e.preventDefault()
    })
    flow.addEventListener('pointermove', function(e) {
      if (!down) return
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) {
        moved = true
        if (!startCaret) clearTimeout(activation)
      }
      highlightHold.move(e)
      if (startCaret) upd(e.clientX, e.clientY)
      e.preventDefault()
    })
    const fin = function(e) {
      down = false; clearTimeout(activation); highlightHold.end(e)
      if (!startCaret) { self.clearSelOverlay(); return }
      startCaret = null
      if (moved && self._sel && self._sel.toString().trim()) self.showPopup(self._sel)
      else self.clearSelOverlay()
    }
    flow.addEventListener('pointerup', fin); flow.addEventListener('pointercancel', fin); flow.addEventListener('pointerleave', fin)
  },

  hitHl(x, y) {
    const r = caretRange(x, y); if (!r) return null
    const off = offsetWithin(this._flow, r.startContainer, r.startOffset)
    const arr = this.hlList(this.spineIdx)
    for (let i = 0; i < arr.length; i++) if (off >= arr[i].start && off <= arr[i].end) return i
    return null
  },

  showPopup(range) {
    this.hidePopup(); const self = this; const loc = this.locate(range)
    const pop = el('div', 'rd-pop')
    const hi = el('button', 'rd-pop-btn', '✎ Highlight'); hi.addEventListener('click', function() { self.addHl(loc) })
    const st = el('button', 'rd-pop-btn', '🗒 Sticky note'); st.addEventListener('click', function() { self.addHl(loc, true) })
    const cx = el('button', 'rd-pop-btn', '✕'); cx.addEventListener('click', function() { self.hidePopup() })
    pop.appendChild(hi); pop.appendChild(st); pop.appendChild(cx); this.view().appendChild(pop)
    this._placePopup(pop, range)
  },
  // Holding a highlight reopens its sticky note without requiring the tiny note marker. A plain
  // highlight still opens its edit menu, where a note can be attached.
  openHighlightNoteOrMenu(idx, x, y) {
    const h = this.hlList(this.spineIdx)[idx]
    if (!h) return
    const note = this.noteList(this.spineIdx).find(function(n) {
      return n.anchor && n.anchor.start === h.start && n.anchor.end === h.end
    })
    if (note) { this.hidePopup(); this.openNote(note); return }
    this.showHlMenu(idx, x, y)
  },
  showHlMenu(idx, x, y) {
    this.hidePopup(); const self = this; const h = this.hlList(this.spineIdx)[idx]
    const pop = el('div', 'rd-pop')
    const note = this.noteList(this.spineIdx).find(function(n) { return n.anchor && n.anchor.start === h.start && n.anchor.end === h.end })
    if (note) { const ed = el('button', 'rd-pop-btn', '✎ Edit note'); ed.addEventListener('click', function() { self.hidePopup(); self.openNote(note) }); pop.appendChild(ed) }
    else { const ad = el('button', 'rd-pop-btn', '🗒 Add note'); ad.addEventListener('click', function() { self.hidePopup(); self.addNote({ start: h.start, end: h.end }) }); pop.appendChild(ad) }
    const del = el('button', 'rd-pop-btn', '🗑 Delete')
    del.addEventListener('click', function() {
      const arr = self.hlList(self.spineIdx); arr.splice(idx, 1); self._saveHl(self.spineIdx); self.hidePopup(); self.applyHl()
    })
    const cx = el('button', 'rd-pop-btn', '✕'); cx.addEventListener('click', function() { self.hidePopup() })
    pop.appendChild(del); pop.appendChild(cx); this.view().appendChild(pop)
    pop.style.top = Math.max(8, y - 52) + 'px'
    pop.style.left = Math.min(Math.max(8, x - 40), window.innerWidth - 240) + 'px'
    this._pop = pop
  },
  _placePopup(pop, range) {
    let bb = null; try { bb = range.getBoundingClientRect() } catch (e) {}
    const top = bb ? Math.max(8, bb.top - 52) : 60
    const left = bb ? Math.min(Math.max(8, bb.left), window.innerWidth - 240) : 40
    pop.style.top = top + 'px'; pop.style.left = left + 'px'; this._pop = pop
  },
  hidePopup() { if (this._pop) { this._pop.remove(); this._pop = null } this.clearSelOverlay() },

  addHl(loc, withNote) {
    const idx = this.spineIdx; const arr = this._loadHl(idx)
    for (let i = 0; i < arr.length; i++) if (loc.start < arr[i].end && arr[i].start < loc.end) {
      this.hidePopup()
      if (withNote) { this.addNote({ start: arr[i].start, end: arr[i].end }); return }
      Bridge.showToast('Already highlighted'); return
    }
    arr.push({ spineIdx: idx, start: loc.start, end: loc.end, color: 'yellow' })
    this._saveHl(idx); this.hidePopup(); this.applyHl()
    if (withNote) this.addNote(loc); else Bridge.showToast('Highlighted')
  },

  // ---- AD-10 sticky notes (daemon ink boxes anchored to a highlighted range) ------------------
  // Same store + flow as the typed-block reader (sidecar/notes/<spineIdx>/index.json + per-note
  // stroke files). The ink box uses the shared daemon (attach/detach/render); it is a no-op in the
  // browser preview, so notes are drawable on-device only, but the note model + markers work anywhere.
  _noteIdxPath(idx) { return 'sidecar/notes/' + idx + '/index.json' },
  _noteFilePath(idx, noteId) { return 'sidecar/notes/' + idx + '/' + noteId + '.json' },
  _loadNotes(idx) {
    if (!this._noteIdx) this._noteIdx = {}
    if (this._noteIdx[idx]) return this._noteIdx[idx]
    try { this._noteIdx[idx] = JSON.parse(Bridge.getBookFile(this.nbId, this._noteIdxPath(idx)) || '[]') } catch (e) { this._noteIdx[idx] = [] }
    if (!Array.isArray(this._noteIdx[idx])) this._noteIdx[idx] = []
    return this._noteIdx[idx]
  },
  noteList(idx) { return (this._noteIdx && this._noteIdx[idx]) || [] },
  _saveSidecarSpineIndex(kind, idx, hasItems) {
    const path = 'sidecar/' + kind + '/_spines.json'; let arr = []
    try { arr = JSON.parse(Bridge.getBookFile(this.nbId, path) || '[]') } catch (e) { arr = [] }
    if (!Array.isArray(arr)) arr = []
    const at = arr.indexOf(idx)
    if (hasItems && at === -1) arr.push(idx)
    else if (!hasItems && at !== -1) arr.splice(at, 1)
    arr.sort(function(a, b) { return a - b })
    Bridge.saveBookFile(this.nbId, path, JSON.stringify(arr))
  },
  _saveNoteIndex(idx) {
    try {
      const arr = this._noteIdx[idx] || []
      Bridge.saveBookFile(this.nbId, this._noteIdxPath(idx), JSON.stringify(arr))
      this._saveSidecarSpineIndex('notes', idx, !!arr.length)
    } catch (e) {}
  },

  addNote(loc) {
    const idx = this.spineIdx; const arr = this._loadNotes(idx)
    // reuse an existing note on the same range, else create one
    let note = arr.find(function(n) { return n.anchor && n.anchor.start === loc.start && n.anchor.end === loc.end })
    if (!note) {
      const noteId = 'n' + Date.now().toString(36)
      const anchor = { spineIdx: idx, start: loc.start, end: loc.end }
      const quote = ((this._flow && this._flow.textContent) || '').slice(loc.start, loc.end).trim()
      note = { noteId: noteId, anchor: anchor, quote: quote, hasPreview: false }
      arr.push(note); this._saveNoteIndex(idx)
      Bridge.saveBookFile(this.nbId, this._noteFilePath(idx, noteId), JSON.stringify({ anchor: anchor, quote: quote, strokes: [] }))
      this.applyHl()
    }
    this.openNote(note)
  },
  openNote(note) {
    this.openInkBox({ file: this._noteFilePath(this.spineIdx, note.noteId), anchor: note.anchor, quote: note.quote || '' })
  },

  // daemon ink box (mirrors BookReader.openInkBox — shared rd-note-* box classes + daemon hooks).
  openInkBox(target) {
    if (this._ink || this._inkWrap || this._inkClosing) {
      this._pendingInkTarget = target
      this.closeInkBox()
      return
    }
    this._pendingInkTarget = null
    const self = this
    let strokes = []
    try { const j = JSON.parse(Bridge.getBookFile(this.nbId, target.file) || '{}'); if (Array.isArray(j.strokes)) strokes = j.strokes } catch (e) {}
    this._ink = { file: target.file, anchor: target.anchor || null, quote: target.quote || '', strokes: strokes, full: false }
    const wrap = el('div', 'rd-note-wrap'); const card = el('div', 'rd-note-card'); const box = el('div', 'rd-note-box'); card.appendChild(box)
    const ctl = el('div', 'rd-note-ctl'); const done = el('button', 'rd-btn', '✓ Done'); const full = el('button', 'rd-btn', '⛶ Full page')
    ctl.appendChild(done); ctl.appendChild(full); card.appendChild(ctl); wrap.appendChild(card); this.view().appendChild(wrap)
    this._inkWrap = wrap; this._inkBox = box
    done.addEventListener('click', function() { self.closeInkBox() })
    full.addEventListener('click', function() { self._ink.full = !self._ink.full; card.classList.toggle('full', self._ink.full); full.textContent = self._ink.full ? '⊟ Window' : '⛶ Full page'; self._reattaching = true; Bridge.detachInkBox() })
    requestAnimationFrame(function() { self.attachNoteBox() })
  },
  attachNoteBox() {
    const box = this._inkBox; if (!box) return
    const r = box.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; const pad = 3
    const L = Math.round((r.left + pad) * dpr), T = Math.round((r.top + pad) * dpr), R = Math.round((r.right - pad) * dpr), B = Math.round((r.bottom - pad) * dpr)
    window._noteSketch = { w: R - L, h: B - T }; window._inkHandler = this
    if (Bridge.skipWakeRefresh) Bridge.skipWakeRefresh()
    Bridge.attachInkBox(L, T, R, B); Bridge.setInkStyle(3 * dpr, '#000000')
  },
  onNoteStrokes(strokes) {
    if (!this._ink || !window._noteSketch) return
    const w = window._noteSketch.w || 1, h = window._noteSketch.h || 1
    for (let s = 0; s < strokes.length; s++) { const pts = strokes[s]; if (!pts || !pts.length) continue; const arr = []; for (let i = 0; i < pts.length; i++) arr.push([pts[i][0] / w, pts[i][1] / h]); this._ink.strokes.push(arr) }
    this.saveInk()
  },
  renderNoteStrokes() {
    const ns = window._noteSketch; if (!ns || !this._ink) return
    const dpr = window.devicePixelRatio || 1
    const out = { t: 'blank', sp: 0, mg: 0, dpr: dpr, b: [0, 0, ns.w, ns.h], s: [] }
    this._ink.strokes.forEach(function(st) { if (!st || !st.length) return; const p = []; for (let i = 0; i < st.length; i++) p.push([Math.round(st[i][0] * ns.w), Math.round(st[i][1] * ns.h)]); out.s.push({ w: 3 * dpr, c: '#000000', p: p }) })
    Bridge.renderInk(JSON.stringify(out))
  },
  saveInk() { if (this._ink) {
    Bridge.saveBookFile(this.nbId, this._ink.file, JSON.stringify({ anchor: this._ink.anchor, strokes: this._ink.strokes }))
    if (window.BooxInkCompact) Bridge.saveBookFile(this.nbId, BooxInkPreviewPath(this._ink.file),
      JSON.stringify({ strokes: BooxInkCompact(this._ink.strokes) }))
    if (window.BooxHandCatalog) BooxHandCatalog.upsert(this, { id: this._ink.file, file: this._ink.file,
      kind: 'sticky', format: 'epub', loc: this._ink.anchor || {}, quote: this._ink.quote || '',
      strokes: BooxInkCompact(this._ink.strokes) })
  } },
  closeInkBox() {
    const had = !!this._ink || !!this._inkWrap
    if (this._inkWrap) { this._inkWrap.remove(); this._inkWrap = null }
    this._inkBox = null
    if (had && !this._inkClosing) {
      this._inkClosing = true
      Bridge.detachInkBox()   // flush → onNoteFlushed → finalizeNote
    }
  },
  finalizeNote() {
    this.saveInk(); this._ink = null; this._inkClosing = false; window._noteSketch = null; window._inkHandler = null
    this.applyHl()   // a note may have just gained its first strokes → refresh markers
    if (this._pendingInkTarget) {
      const next = this._pendingInkTarget; this._pendingInkTarget = null
      const self = this; requestAnimationFrame(function() { self.openInkBox(next) })
    }
  },

  // ---- reading font size (A− / A+) ----
  // WP9: the single source of truth is now ReaderFormat (merged globals ← per-book sidecar/format.json,
  // shared field with BookReader), anchor-safe: keeps the same top-of-page character visible across
  // the repagination. The Format panel's "Font size" stepper drives this exact same setting.
  fontScale() {
    if (typeof ReaderFormat !== 'undefined') return ReaderFormat.get().fontScale
    const v = parseFloat(typeof localStorage !== 'undefined' ? localStorage.getItem('kal.reader.fontScale') : '')
    return (v && v >= 0.7 && v <= 2.2) ? v : 1.0
  },
  applyFontScale() {
    if (!this._flow) return
    this._flow.style.fontSize = ''
    const s = this.fontScale()
    if (s !== 1) {
      const base = parseFloat(getComputedStyle(this._flow).fontSize) || 19
      this._flow.style.fontSize = (Math.round(base * s * 10) / 10) + 'px'
    }
  },
  bumpFont(dir) {
    let s = Math.round((this.fontScale() + dir * 0.1) * 10) / 10
    s = Math.max(0.7, Math.min(2.2, s))
    const off = this._topCharOffset()      // first visible word on this page before reflow
    if (typeof ReaderFormat !== 'undefined') ReaderFormat.set({ fontScale: s })
    else try { localStorage.setItem('kal.reader.fontScale', String(s)) } catch (e) {}
    this.applyFormat()
    this._anchorAfterFormatChange(off)
  },
  // character offset (within #ep-flow) of the first visible word on the current page.
  _topCharOffset() {
    if (!this._flow || !document.caretRangeFromPoint) return null
    const cr = (this._pagebox || this._content).getBoundingClientRect()
    const xs = [8, 32, Math.min(80, Math.max(8, cr.width / 3))]
    const ys = [8, 28, 56, Math.min(96, Math.max(8, cr.height / 5))]
    for (let yi = 0; yi < ys.length; yi++) {
      for (let xi = 0; xi < xs.length; xi++) {
        let r = null
        try { r = document.caretRangeFromPoint(cr.left + xs[xi], cr.top + ys[yi]) } catch (e) { r = null }
        if (!r || !this._flow.contains(r.startContainer)) continue
        return this._wordStartOffset(offsetWithin(this._flow, r.startContainer, r.startOffset))
      }
    }
    return null
  },
  _wordStartOffset(off) {
    if (off == null || !this._flow) return off
    const text = this._flow.textContent || ''
    const len = text.length
    let i = Math.max(0, Math.min(len, off))
    while (i < len && /\s/.test(text.charAt(i))) i++
    while (i > 0 && /\S/.test(text.charAt(i - 1))) i--
    return i
  },
  _anchorAfterFormatChange(off) {
    const self = this
    this._reflowAnchor = off
    const fallbackPage = this.page
    clearTimeout(this._reflowAnchorTimer)
    // Let the new font metrics commit before resolving the saved text range. One relocation owns
    // the transform; retry loops caused visible sideways jumps on Android WebView/e-ink.
    requestAnimationFrame(function() { requestAnimationFrame(function() {
      self.paginate()
      if (off != null) self._gotoCharOffset(off)
      else { self.page = Math.max(0, Math.min(self.pages - 1, fallbackPage)); self.paginate() }
      self._freezeProvisionalPagePlan(true)
      self._startAccuratePageCount()
      self._reflowAnchor = null; self._reflowAnchorTimer = null
    })
    })
  },
  _scheduleReflowAnchor(off) {
    this._anchorAfterFormatChange(off)
  },
  _clearReflowAnchor() {
    this._reflowAnchor = null
    this._pendingFormatAnchor = null
    clearTimeout(this._reflowAnchorTimer)
    this._reflowAnchorTimer = null
  },
  // Stable range of source-text offsets covered by the current reflow page. Native insertions are
  // anchored by character offset, so they remain between the same content even after font reflow.
  _nativePageBounds() {
    // The first visible caret can land a few characters into a heading; offset zero still belongs
    // to page zero and must match an insertion anchored at the chapter start.
    const start = this.page === 0 ? 0 : (this._topCharOffset() || 0)
    if (this.page >= this.pages - 1) return { start: start, end: Number.MAX_SAFE_INTEGER }
    const cur = this.page
    const g = this._pageGeom()
    ReaderPaginate.showPage(this._flow, cur + 1, g)
    const end = this._topCharOffset()
    ReaderPaginate.showPage(this._flow, cur, g)
    return { start: start, end: end == null || end <= start ? Number.MAX_SAFE_INTEGER : end }
  },
  // jump to the page that holds [off] so that character is at the top-left again
  _gotoCharOffset(off) {
    if (off == null || !this._flow) return
    const len = this._flow.textContent.length
    const rg = rangeForOffsets(this._flow, Math.min(off, len), Math.min(off + 1, len))
    if (!rg) return
    const g = this._pageGeom()
    const x = rg.getBoundingClientRect().left - this._flow.getBoundingClientRect().left
    const col = Math.round(x / g.colStride)
    const estimated = Math.max(0, Math.min(this.pages - 1, Math.floor(col / g.cols)))
    this.page = this._nearestPageStart(off, estimated, g)
    ReaderPaginate.showPage(this._flow, this.page, g)
    this._updateNav()
    this.applyHl()
    this._applySearchMark()
    this.updateClock(); this.savePosition()
  },
  _nearestPageStart(off, estimated, g) {
    if (!this._flow || !this.pages || off == null) return estimated
    const cur = this.page
    let bestPage = estimated, bestDist = Infinity
    const lo = Math.max(0, estimated - 1)
    const hi = Math.min(this.pages - 1, estimated + 1)
    for (let p = lo; p <= hi; p++) {
      ReaderPaginate.showPage(this._flow, p, g)
      const top = this._topCharOffset()
      if (top == null) continue
      const d = Math.abs(top - off)
      if (d < bestDist) { bestDist = d; bestPage = p }
    }
    ReaderPaginate.showPage(this._flow, cur, g)
    return bestPage
  },
  _alignOffsetToTop(off, g) {
    // ReaderPaginate.showPage is the sole owner of the flow transform. Adding a transient X/Y
    // correction here made later pagination compose against a non-canonical transform, which could
    // shift a page sideways or entirely outside the viewport. Landing on the page containing the
    // saved word is stable and keeps it visible without a second transform.
    if (this._flow) ReaderPaginate.showPage(this._flow, this.page, g)
  },

  // ---- bottom-left clock + whole-book page (stands in for the hidden system status bar) ----
  applyClockSetting() {
    const on = !(typeof localStorage !== 'undefined' && localStorage.getItem('kal.reader.showClock') === '0')
    if (this._clock) this._clock.classList.toggle('hidden', !on)
    this.updateClock()
  },
  updateClock() {
    if (!this._clock) return
    const d = new Date(), hh = d.getHours(), mm = d.getMinutes()
    const t = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
    const bp = this.bookPages()
    const pos = bp
      ? (bp.cur + '/' + (bp.exact === false ? '~' : '') + bp.total)
      : ((this.page + 1) + '/' + this.pages)
    this._clock.textContent = t + '  ·  ' + pos
  },

  // ---- asset resolution (AD-4 point 2): rewrite <img src> relative to the CHAPTER's directory within
  // the zip and fetch it as a data URL. Only the chapter actually being rendered is resolved (prefetched
  // neighbor chapters stay as raw cached text until they're rendered) — i.e. "lazily, visible soon". ----
  resolveImages(root, chapterDir) {
    return this._loadEpubImages(root, chapterDir)
  },
  _loadEpubImages(root, chapterDir) {
    const self = this
    const imgs = root.querySelectorAll('img[src]')
    const pending = []
    Array.prototype.forEach.call(imgs, function(img) {
      let viewerOpened = false
      const imageHold = ReaderImageLongPress(function(src) {
        viewerOpened = true
        if (window.ReaderTapDiag) window.ReaderTapDiag.log('epub', 'image-viewer-open', null)
        self.openImageViewer(src)
      })
      img.style.cursor = 'pointer'
      // Chromium's native image drag/selection recognizer reaches its own threshold at about the
      // same time as the viewer hold and cancels the pointer. Keep ownership in the reader while
      // still allowing the event to bubble to the ordinary short-tap page zones.
      img.draggable = false
      img.setAttribute('draggable', 'false')
      img.style.webkitUserDrag = 'none'
      img.style.userSelect = 'none'
      img.style.webkitUserSelect = 'none'
      img.addEventListener('pointerdown', function(e) {
        viewerOpened = false
        e.preventDefault()
        imageHold.start(e, img.src)
      })
      img.addEventListener('pointermove', function(e) { imageHold.move(e) })
      img.addEventListener('pointerup', function(e) { imageHold.end(e) })
      img.addEventListener('pointercancel', function() { imageHold.cancel() })
      img.addEventListener('pointerleave', function(e) { imageHold.end(e) })
      img.addEventListener('click', function(e) {
        // Preserve publisher links and unlinked short taps. Only the click synthesized for the
        // completed viewer hold is consumed so it cannot immediately follow a wrapping link.
        if (!viewerOpened) return
        viewerOpened = false
        e.preventDefault(); e.stopPropagation()
      })
      img.addEventListener('contextmenu', function(e) { e.preventDefault() })
      const src = img.getAttribute('src')
      if (!src || /^(data:|https?:)/i.test(src)) return   // already a data URL, or an external ref (sanitized away already carries no http src, but be defensive)
      const zipPath = epResolvePath(chapterDir, src)
      img.setAttribute('data-epub-path', zipPath)
      const url = Bridge.epubAssetDataUrl(self.nbId, zipPath)
      if (!url) { img.alt = img.alt || '(image)'; return }
      pending.push(new Promise(function(resolve) {
        let done = false
        const timeout = setTimeout(function() { finish(false) }, 1800)
        function finish(ready) {
          if (done) return
          done = true
          clearTimeout(timeout)
          img.removeEventListener('load', loaded)
          img.removeEventListener('error', failed)
          resolve(ready)
        }
        function loaded() { finish(true) }
        // A decoded failure is still a settled, truthful layout (alt text); only a timeout is
        // unsuitable for an "exact" cached count.
        function failed() { finish(true) }
        // Register before assigning the data URL: a cached local asset may complete synchronously.
        img.addEventListener('load', loaded)
        img.addEventListener('error', failed)
        img.src = url
        if (img.complete) requestAnimationFrame(loaded)
      }))
    })
    return pending.length
      ? Promise.all(pending).then(function(results) {
          return results.every(function(ready) { return ready })
        })
      : Promise.resolve(true)
  },

  // EPUB and blocks books intentionally use one media viewer implementation so zoom, pan, rotate,
  // close behavior and e-ink-friendly non-scrolling composition cannot drift between formats.
  openImageViewer(src) {
    const img = document.createElement('img'); img.className = 'iv-img'; img.src = src
    BookReader._openMediaViewer.call(this, img, { rotate: true })
  },

  // ---- position save / resume (AD-8): meta.position + readingProgress + lastReadAt, debounced on
  // page turn, flushed immediately on close. ----
  savePosition() {
    const self = this
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(function() { self._savePositionNow() }, 400)
  },
  _savePositionNow() {
    if (!this.manifest) return
    try {
      const raw = Bridge.getBookFile(this.nbId, 'meta.json')
      const m = JSON.parse(raw) || {}
      const off = this._topCharOffset() || 0
      m.position = { spineIdx: this.spineIdx, charOffset: off }
      if (window.NativePages && NativePages.activeId(this)) m.position.nativePageId = NativePages.activeId(this)
      const spine = this.manifest.spine || []
      let total = 0, consumed = 0
      for (let i = 0; i < spine.length; i++) {
        const c = spine[i].chars || 0
        total += c
        if (i < this.spineIdx) consumed += c
      }
      consumed += off
      m.readingProgress = total ? Math.max(0, Math.min(1, consumed / total)) : 0
      m.lastReadAt = new Date().toISOString()
      Bridge.saveBookFile(this.nbId, 'meta.json', JSON.stringify(m))
    } catch (e) {}
  }
}

// ---- EPUB helpers: zip-relative path resolution + XHTML sanitization (AD-4) ----

// The directory portion of a spine href ("epub/chapter1.xhtml" → "epub/"), used to resolve any
// chapter-relative reference (images, in theory publisher CSS url()s once WP9 turns that on).
function epDirOf(href) {
  const i = String(href || '').lastIndexOf('/')
  return i === -1 ? '' : href.slice(0, i + 1)
}

// Resolve [rel] (a reference found inside the chapter at [dir]) to a zip-absolute path, collapsing
// './' and '../' segments. Absolute/external/data references pass through untouched.
function epResolvePath(dir, rel) {
  rel = String(rel || '')
  if (/^(https?:|data:|\/\/)/i.test(rel)) return rel
  const base = rel.charAt(0) === '/' ? '' : dir
  const parts = (base + rel).split('/')
  const stack = []
  parts.forEach(function(seg) {
    if (seg === '' || seg === '.') return
    if (seg === '..') stack.pop(); else stack.push(seg)
  })
  return stack.join('/')
}

// Comparable, fragment-free EPUB zip path. Percent-encoding varies between OPF manifests and XHTML
// hrefs in real books, so compare decoded paths when possible.
function epPathKey(href) {
  let path = String(href || '').split('#')[0].split('?')[0]
  try { path = decodeURIComponent(path) } catch (e) {}
  return epResolvePath('', path)
}

// Find an EPUB fragment without relying on CSS.escape(). Some vendor WebViews omit that API even
// though they otherwise support the reader, which previously made a valid footnote tap fail inside
// the guarded querySelector call. Exact id comparison also handles punctuation safely.
function epFindById(root, fragment) {
  if (!root || fragment == null) return null
  const wanted = String(fragment)
  if (String(root.id || '') === wanted) return root
  if (typeof root.querySelectorAll !== 'function') return null
  const nodes = root.querySelectorAll('[id]')
  for (let i = 0; i < nodes.length; i++) {
    const id = nodes[i].getAttribute ? nodes[i].getAttribute('id') : nodes[i].id
    if (String(id || '') === wanted) return nodes[i]
  }
  return null
}

// Return the smallest block that represents a complete footnote. This deliberately uses EPUB
// semantics and ordinary document structure rather than publisher/title-specific selectors.
// A common shape is <p><a id="fn1" role="doc-backlink">1</a>. Full note text…</p>; other books put
// the id directly on an aside/li/div carrying footnote or endnote semantics.
function epFootnoteRoot(target, holder) {
  if (!target) return target
  function tag(node) { return String(node && node.tagName || '').toUpperCase() }
  function isSemanticNote(node) {
    if (!node || !node.getAttribute) return false
    const semantics = [node.getAttribute('role'), node.getAttribute('epub:type'),
      node.getAttribute('type'), node.className].join(' ').toLowerCase()
    return /(?:^|[\s_-])(?:doc-)?(?:footnote|endnote|rearnote|pgnote)(?:$|[\s_-])/.test(semantics)
  }
  let node = target
  while (node && node !== holder) {
    if (isSemanticNote(node)) return node
    node = node.parentElement
  }
  if (/^(?:P|LI|DD|ASIDE|BLOCKQUOTE)$/.test(tag(target))) return target
  node = target.parentElement
  while (node && node !== holder) {
    if (/^(?:P|LI|DD|ASIDE|BLOCKQUOTE)$/.test(tag(node))) return node
    node = node.parentElement
  }
  return target
}

// Removing an inline backlink often leaves publisher punctuation such as ". Note text" at the
// start. Trim only that marker punctuation while retaining every authored descendant and style.
function epTrimFootnoteLead(root) {
  function firstText(node) {
    if (!node) return null
    if (node.nodeType === 3 && /\S/.test(node.nodeValue || '')) return node
    const children = node.childNodes || []
    for (let i = 0; i < children.length; i++) {
      const found = firstText(children[i])
      if (found) return found
    }
    return null
  }
  const text = firstText(root)
  if (text) text.nodeValue = String(text.nodeValue || '').replace(/^\s*[.):\]]\s*/, '')
}

// Sanitize a raw EPUB chapter document. Always strips <script>/<meta>/<title>/<base>, on* handler
// attributes, http(s) href/src (external refs — data/relative refs are resolved separately by
// resolveImages), and float/position/overflow inline styles (which would fight the multicolumn
// pagination) regardless of the publisherCss toggle. <style>/<link rel=stylesheet> handling depends
// on opts.keepStyle (WP9): default (false, AD-4 risk 3) strips them entirely; true collects inline
// <style> text into the returned css string and pushes each <link rel=stylesheet href> onto
// opts.linkHrefs (mutated in place — the caller resolves those zip-relative paths and fetches their
// text, see renderChapter). Returns { html, css } (a plain 'text/html' parse tolerates XHTML's
// self-closing void elements fine for the well-formed chapters this deals with).
function epSanitize(rawHtml, opts) {
  opts = opts || {}
  let doc
  try { doc = new DOMParser().parseFromString(String(rawHtml || ''), 'text/html') } catch (e) { return { html: '', css: '', bodyClass: '' } }
  const body = doc && doc.body
  if (!body) return { html: '', css: '', bodyClass: '' }
  const bodyClass = body.getAttribute('class') || ''
  Array.prototype.forEach.call(body.querySelectorAll('script, meta, title, base'), function(n) { n.remove() })
  // <style>/<link rel=stylesheet> normally live in <head> (not body) for a well-formed XHTML chapter,
  // so these are searched over the WHOLE parsed document, not just body — otherwise publisherCss would
  // silently find nothing to keep.
  let css = ''
  Array.prototype.forEach.call(doc.querySelectorAll('style'), function(n) {
    if (opts.keepStyle) css += '\n' + (n.textContent || '')
    n.remove()
  })
  Array.prototype.forEach.call(doc.querySelectorAll('link'), function(n) {
    const rel = (n.getAttribute('rel') || '').toLowerCase()
    const href = n.getAttribute('href')
    if (opts.keepStyle && rel === 'stylesheet' && href && Array.isArray(opts.linkHrefs)) opts.linkHrefs.push(href)
    n.remove()
  })
  Array.prototype.forEach.call(body.querySelectorAll('*'), function(node) {
    Array.prototype.slice.call(node.attributes).forEach(function(attr) {
      const name = attr.name.toLowerCase()
      if (name.indexOf('on') === 0) { node.removeAttribute(attr.name); return }
      if ((name === 'href' || name === 'src') && /^https?:/i.test(attr.value)) node.removeAttribute(attr.name)
    })
    const style = node.getAttribute('style')
    if (style) {
      const cleaned = style.replace(/(?:^|;)\s*(float|position|overflow[a-z-]*)\s*:[^;]*/gi, '')
      if (cleaned.trim()) node.setAttribute('style', cleaned); else node.removeAttribute('style')
    }
  })
  return { html: body.innerHTML, css: css, bodyClass: bodyClass }
}

// Publisher CSS frequently sets a compensating base scale on body (Calibre-generated EPUBs are a
// common example) and smaller relative sizes on paragraphs. Moving only body.innerHTML into the
// reader loses that scale and makes every paragraph too small. A fragmentable block wrapper retains
// the authored body class while keeping the chapter safely inside the paginated flow.
function epMountSanitizedBody(flow, sanitized, keepPublisherBody) {
  if (!flow) return
  const html = sanitized && sanitized.html
  if (!keepPublisherBody || !(sanitized && sanitized.bodyClass)) {
    flow.innerHTML = html || '<p>(missing chapter)</p>'
    return
  }
  const body = document.createElement('div')
  body.className = 'ep-publisher-body ' + sanitized.bodyClass
  body.innerHTML = html || '<p>(missing chapter)</p>'
  flow.replaceChildren(body)
}

window.EpubReader = EpubReader
