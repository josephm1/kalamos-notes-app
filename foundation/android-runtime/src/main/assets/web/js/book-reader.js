// Book reader for the interactive book-folder format (docs/research/book-to-interactive-format.md):
// an immutable book (manifest.json + sections/<sid>.html + styles/ + assets/) under the notebook dir,
// plus a mutable sidecar/ subfolder (highlights/, notes/). Sections are reflowable HTML, paginated at
// runtime with CSS multicolumn; <kal-mcq>/<kal-ink>/<kal-anim> upgrade to widgets; highlights + notes
// anchor to character ranges and live in the sidecar. Reuses the global helpers + daemon ink box from
// reader-controller.js. Prototype.
window.BookTocCache = window.BookTocCache || (function() {
  var data = {}, order = []
  return {
    get: function(id) { return data[id] },
    put: function(id, toc) {
      data[id] = toc; order = order.filter(function(x) { return x !== id }); order.push(id)
      while (order.length > 8) delete data[order.shift()]
    }
  }
})()

const BookReader = {
  nbId: null, manifest: null, sec: 0, page: 0, pages: 1,
  hl: {},        // sectionId → [{start,end,color}]
  noteIdx: {},   // sectionId → [{noteId,anchor,hasPreview}]

  isBook(meta) { return !!(meta && meta.bookRef) },

  open(meta) {
    this.nbId = meta.notebookId
    this._css = null   // per-book stylesheet — never reuse the previous book's scoped css
    // Packages can be refreshed in place over ADB or by the converter. Always include toc.json in
    // the same batched open read so a prior in-memory TOC cannot hide a newly mapped hierarchy.
    // The cache remains a fallback for a transient read failure and still retains rendered rows
    // during this reader session.
    const cachedToc = BookTocCache.get(this.nbId) || null
    this.toc = null
    const wantFiles = ['manifest.json', 'toc.json', 'sidecar/source-replacements-v1.json',
      'sidecar/inline-checkpoints-v1.json']
    const files = Bridge.getBookFiles ? Bridge.getBookFiles(this.nbId, wantFiles) : null
    const raw = (files && files['manifest.json']) || Bridge.getBookFile(this.nbId, 'manifest.json')
    try { this.manifest = JSON.parse(raw) } catch (e) { this.manifest = null }
    if (!this.manifest) {
      console.error('BookReader manifest unavailable', this.nbId, raw ? 'invalid-json' : 'missing')
      Bridge.showToast('Could not open book'); return
    }
    const tocRaw = (files && files['toc.json']) || Bridge.getBookFile(this.nbId, 'toc.json')
    try { this.toc = JSON.parse(tocRaw) } catch (e) { this.toc = cachedToc }
    BookTocCache.put(this.nbId, this.toc)
    try {
      const replacementRaw = (files && files['sidecar/source-replacements-v1.json']) ||
        Bridge.getBookFile(this.nbId, 'sidecar/source-replacements-v1.json') || ''
      const replacementDoc = JSON.parse(replacementRaw)
      this._sourceReplacements = replacementDoc && replacementDoc.schema === 'kalamos.source-replacements/v1'
        ? replacementDoc.sections || {} : {}
    } catch (e) { this._sourceReplacements = {} }
    try {
      const checkpointRaw = (files && files['sidecar/inline-checkpoints-v1.json']) ||
        Bridge.getBookFile(this.nbId, 'sidecar/inline-checkpoints-v1.json') || ''
      const checkpointDoc = JSON.parse(checkpointRaw)
      this._inlineCheckpoints = checkpointDoc && checkpointDoc.schema === 'kalamos.inline-checkpoints/v1' &&
        Array.isArray(checkpointDoc.entries) ? checkpointDoc.entries : []
    } catch (e) { this._inlineCheckpoints = [] }
    this._bxTocItems = (this.toc && this.toc._kalItems) || null
    this._bxTocModel = null; this._bxTocCollapsed = {}; this._bxAnnotationsCache = null
    this._imageItems = null; this._imageIndexJob = null
    this.sec = 0; this.page = 0
    this._secPages = {}; this._pkey = null   // measured pages per section (whole-book page estimate)
    this._secCache = {}                      // prefetched neighbor sections (raw JSON strings)
    this._searchMark = null; this._pendingSearchOffset = null   // WP11: transient search-jump locator
    const pos = meta.position
    if (pos && pos.sectionId) {
      const i = this.manifest.spine.findIndex(function(s) { return s.sectionId === pos.sectionId })
      if (i >= 0) { this.sec = i; this.page = pos.page || 0 }
    }
    if (typeof ReaderFormat !== 'undefined') ReaderFormat.load(this.nbId)   // WP9: merged format settings for this book
    this._initBookmarks()
    if (window.NativePages) NativePages.init(this, 'book', pos && pos.nativePageId)
    document.getElementById('library-view').style.display = 'none'
    document.getElementById('editor-view').style.display = 'none'
    this.view().style.display = 'flex'
    Bridge.enterLibrary()   // hide the ink surface — the WebView is the live reading layer
    Bridge.setImmersive(true)   // hide the Android status + navigation bars for a full-screen page
    App.current = 'book'
    App.activeReader = this
    this.renderSection()
    const self = this
    this._clockTimer = setInterval(function() { self.updateClock() }, 30000)   // keep the bottom-left clock fresh
  },

  view() {
    let v = document.getElementById('book-view')
    if (!v) { v = el('div', null); v.id = 'book-view'; document.body.appendChild(v) }
    return v
  },

  close() {
    if (this._ink) this.closeInkBox()
    if (window.NativePages) NativePages.close(this)
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null }
    this._secCache = {}; this._secPages = {}; this._pkey = null
    Bridge.setImmersive(false)   // restore the system bars outside the reader
    this.view().style.display = 'none'
    document.getElementById('library-view').style.display = 'flex'
    App.current = 'library'
    // Only this book's meta changed (reading progress) — drop just its cached card meta so the grid
    // re-render reuses the other cards' cached metas instead of re-reading every one via peekMeta.
    if (typeof invalidateCardMeta === 'function') invalidateCardMeta(this.nbId)
    if (typeof renderLibrary === 'function') renderLibrary()
  },

  sectionId() { return this.manifest.spine[this.sec].sectionId },

  usesRichMarkdown() {
    const manifest = this.manifest || {}
    // contentDialect is authoritative for new packages. The author fallback upgrades Agent books
    // created by builds that predate that manifest field, so their Markdown does not remain trapped
    // in the old headings/bold/lists-only renderer forever.
    return manifest.contentDialect === 'gfm' || manifest.markdown === 'gfm' ||
      String(manifest.author || '').trim().toLowerCase() === 'kalamos agent'
  },

  sectionDisplayTitle(sectionId) {
    const sid = String(sectionId || '')
    const extracted = this.toc && Array.isArray(this.toc.entries) ? this.toc.entries : []
    const manifestToc = this.manifest && Array.isArray(this.manifest.toc) ? this.manifest.toc : []
    const entries = extracted.length ? extracted : manifestToc
    const entry = entries.find(function(row) {
      if (!row) return false
      const rowSid = row.sectionId || String(row.href || '').split('#', 1)[0]
      return String(rowSid || '') === sid
    })
    const tocTitle = entry && (entry.title || entry.label)
    if (tocTitle) return String(tocTitle).trim()
    const spine = (this.manifest && this.manifest.spine) || []
    const section = spine.find(function(row) {
      return String(row && (row.sectionId || row.id) || '') === sid
    })
    return section && String(section.title || section.label || '').trim() || ''
  },

  sectionStatusLabel(sectionId) {
    const spine = (this.manifest && this.manifest.spine) || []
    const title = this.sectionDisplayTitle(sectionId)
    const position = (this.sec + 1) + '/' + spine.length
    return title ? (title + ' · ' + position) : ('Section ' + position)
  },

  visibleBlocks(sectionId, blocks) {
    if (!Array.isArray(blocks)) return blocks
    const section = this._sourceReplacements && this._sourceReplacements[sectionId]
    const replacementRows = (section && section.blocks) || []
    const hidden = new Set(replacementRows.map(function(row) { return String(row.blockId || '') }))
    const replacementById = {}
    replacementRows.forEach(function(row) { replacementById[String(row.blockId || '')] = row })
    const checkpoints = (this._inlineCheckpoints || []).filter(function(entry) {
      const placement = entry && entry.placement || {}
      return placement.kind === 'book' && String(placement.sectionId || '') === String(sectionId || '') &&
        placement.beforeBlockId && entry.id && Array.isArray(entry.hiddenBlockIds) &&
        Array.isArray(entry.responseBlocks) && typeof entry.prompt === 'string' &&
        entry.hiddenBlockIds.length > 0 && entry.hiddenBlockIds.every(function(id) {
          const proof = replacementById[String(id || '')]
          return proof && proof.reason === 'exact-source-span-presented-by-inline-checkpoint' &&
            Array.isArray(proof.groupIds) && proof.groupIds.indexOf(String(entry.id)) !== -1
        })
    })
    const before = {}
    checkpoints.forEach(function(entry) {
      entry.hiddenBlockIds.forEach(function(id) { hidden.add(String(id || '')) })
      const id = String(entry.placement.beforeBlockId)
      if (!before[id]) before[id] = []
      before[id].push(entry)
    })
    if (!hidden.size && !checkpoints.length) return blocks
    const visible = []
    blocks.forEach(function(block) {
      const id = String(block && block.id || '')
      ;(before[id] || []).forEach(function(entry) {
        visible.push({
          // Retain the original prompt block ID so TOC/search/evidence jumps still land here.
          id: id, type: 'inline-checkpoint', checkpoint: entry,
          page: block && block.page,
        })
      })
      if (!hidden.has(id)) visible.push(block)
    })
    return visible
  },

  renderSection() {
    const self = this
    const sid = this.sectionId()
    const v = this.view(); v.innerHTML = ''

    // renderSection replaces the flow/pagebox DOM nodes. Geometry cached for the previous nodes is
    // only valid for cheap page turns on those exact nodes; reusing it here skips layout() entirely,
    // leaving the new flow without its width/height/columns and translating blank content off-screen.
    this._lastPgSig = null
    this._lastPgGeom = null
    this._tblFitKey = null

    // Everything this section needs from disk in ONE batched bridge read (css once per book +
    // section JSON when not prefetched + the two sidecars loadSidecar wants) — bridge round-trips
    // dominate the open path on-device; see resolveImages.
    const secPath = 'sections/' + sid + '.json'
    const hlPath = 'sidecar/highlights/' + sid + '.json'
    const notesPath = 'sidecar/notes/' + sid + '/index.json'
    let files = null
    if (Bridge.getBookFiles) {
      const want = [hlPath, notesPath]
      if (this._css == null) want.push('styles/book.css')
      if (!(this._secCache && this._secCache[sid] != null)) want.push(secPath)
      files = Bridge.getBookFiles(this.nbId, want)
    }
    // inject the book's stylesheet, scoped to the section flow so it can't leak into the app
    if (this._css == null) this._css = scopeBookCss(((files && files['styles/book.css']) || Bridge.getBookFile(this.nbId, 'styles/book.css')) || '', '#bk-flow')
    const style = document.createElement('style'); style.textContent = this._css; v.appendChild(style)

    // content (reflowed into columns) — fills the WHOLE screen; no bars steal vertical space
    const content = el('div', 'bk-content'); content.id = 'bk-content'
    const flow = el('div', 'bk-flow'); flow.id = 'bk-flow'
    // Books are typed-block JSON (the device is the renderer). Prefer sections/<sid>.json; fall back to the
    // legacy reflowable-HTML section so older authored books (e.g. book-demo) keep working.
    let blocks = null
    const rawJson = (this._secCache && this._secCache[sid]) ||
                    (files && files[secPath]) || Bridge.getBookFile(this.nbId, secPath)
    if (rawJson) { try { blocks = this.visibleBlocks(sid, JSON.parse(rawJson).blocks) } catch (e) { blocks = null } }
    if (blocks) {
      const richMarkdown = this.usesRichMarkdown()
      flow.innerHTML = blocksToHtml(blocks,
        semanticFreshPageIds(this.toc, this.manifest, sid, blocks), richMarkdown)
      if (!window.KalamosRichContent && window.BooksRichContentReady &&
          (richMarkdown || blocks.some(function(block) { return block && block.format === 'rich-markdown' }))) {
        window.BooksRichContentReady.then(function() {
          if (App.activeReader === self && self.sectionId() === sid) self.renderSection()
        }).catch(function(error) { console.warn('rich markdown unavailable', error) })
      }
    }
    else flow.innerHTML = Bridge.getBookFile(this.nbId, 'sections/' + sid + '.html') || '<p>(missing section)</p>'
    // the page box clips the flow at the PAGE edge (not the padded content edge) so the next
    // column can never peek in at the side — essential once pages are centred / shown as a spread
    const pagebox = el('div', 'bk-pagebox')
    pagebox.appendChild(flow)
    content.appendChild(pagebox)
    this._pagebox = pagebox
    v.appendChild(content)
    this._content = content; this._flow = flow
    this.applyFormat()

    // overlays for highlights / selection
    this.hlLayer = el('div', 'rd-overlay'); v.appendChild(this.hlLayer)
    this.selLayer = el('div', 'rd-overlay'); v.appendChild(this.selLayer)

    // floating top bar (revealed by a tap in the top zone): back + title + section indicator
    const top = el('div', 'bk-topbar'); this._topbar = top
    const back = el('button', 'rd-btn', '← Library'); back.addEventListener('click', function() { self.close() })
    top.appendChild(back)
    top.appendChild(el('div', 'bk-title', this.manifest.title || 'Book'))
    this._ind = el('div', 'bk-ind', ''); top.appendChild(this._ind)
    // font-size controls (A− / A+): per-reader text scaling, persisted; re-paginates on change
    const fc = el('div', 'bk-fontctl')
    const dec = el('button', 'rd-btn bk-fbtn', 'A−'); dec.addEventListener('click', function() { self.bumpFont(-1) })
    const inc = el('button', 'rd-btn bk-fbtn', 'A+'); inc.addEventListener('click', function() { self.bumpFont(1) })
    fc.appendChild(dec); fc.appendChild(inc); top.appendChild(fc)
    const srchBtn = el('button', 'rd-btn bk-fbtn', '🔍'); srchBtn.addEventListener('click', function() { self.openPanels('search') })
    top.appendChild(srchBtn)
    v.appendChild(top)

    // floating bottom bar (revealed by a tap in the bottom zone): progress readout + table-of-contents jump
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

    // bottom-left clock + page (stands in for the hidden system status bar); ticks each minute
    this._clock = el('div', 'bk-clock'); v.appendChild(this._clock)
    this.applyClockSetting()

    // top-right dog-ear: visible only while the current page is bookmarked (updateBookmarkGlyph
    // toggles display:block/none — no transition, per the e-ink no-animation rule)
    this._dogear = el('div', 'bk-dogear'); v.appendChild(this._dogear)

    // tap zones drive everything (no buttons): L/R thirds = page turn, top/bottom bands = bars, centre = dismiss
    this.wireTapZones(content)
    // Boox UI: swap the classic bars for the Boox chrome (engine containers untouched).
    if (window.Boox && Boox.active('reader')) BooxChrome.install(this, 'book')

    this.resolveImages(flow)
    this.upgradeRichMarkdown(flow)
    this.upgrade(flow)
    this.wireContents(flow)
    this.renderMath(flow)
    this.loadSidecar(sid, files)

    // paginate after layout (images may shift it; re-measure once they load)
    requestAnimationFrame(function() {
      self.paginate(); self.applyHighlights()
    })
    setTimeout(function() {
      self.paginate(); self.applyHighlights()
      // land on the jump target — and KEEP it pending a while longer: images still loading re-paginate
      // the flow and would drift the landing page, so each image-load re-anchors (resolveImages) until
      // the target expires or the reader turns a page themselves.
      if (self._pendingStudyEvidence) {
        self._landStudyEvidence()
      } else if (self._pendingBid) {
        self._gotoBlockId(self._pendingBid)
        setTimeout(function() { self._pendingBid = null }, 2200)
      } else if (self._pendingImageItem) {
        self._gotoImageItem(self._pendingImageItem)
        setTimeout(function() { self._pendingImageItem = null }, 2200)
      } else if (self._pendingSearchOffset != null) {   // WP11: cross-section search jump landing
        self._gotoCharOffset(self._pendingSearchOffset)
        self._pendingSearchOffset = null
        self.applyHighlights()   // re-draw the transient mark now the page has actually moved
      }
      if (self._kpPendingBackward && window.NativePages) NativePages.afterRetreat(self, 'book')
      else if (window.NativePages) NativePages.restore(self, 'book')
      if (window.NativePages) NativePages.afterAnchorNavigation(self)
      self.prefetchNeighbors()   // warm the adjacent sections once this one has settled
    }, 350)
    this.wireSelection(flow)
    this.savePosition()
  },

  // Render LaTeX offline with KaTeX (bundled in vendor/katex). OCR'd math arrives as \(inline\) and
  // \[display\] (and <p class="math">). auto-render scans the delimiters; a fallback renders any bare
  // math block (no delimiters) as display. Runs before paginate() so column sizing sees final layout.
  renderMath(root) {
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(root, {
          delimiters: [
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$$', right: '$$', display: true },
            { left: '$',  right: '$',  display: false }
          ],
          throwOnError: false,
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'kal-ink', 'kal-mcq'],
          ignoredClasses: ['nomath']   // literal $ (currency) emitted by miniMarkdown's \$ escape
        })
      } catch (e) { console.warn('katex auto-render', e) }
    }
    if (typeof katex === 'undefined') return
    // fallback: a math block the delimiters didn't catch (bare LaTeX) → render whole text as display
    const blocks = root.querySelectorAll('.math')
    Array.prototype.forEach.call(blocks, function(elm) {
      if (elm.querySelector('.katex')) return
      const tex = (elm.textContent || '').trim()
      if (!tex) return
      try { katex.render(tex, elm, { displayMode: true, throwOnError: false }) } catch (e) {}
    })
    // A formula KaTeX couldn't parse (rare: the OCR emitted malformed LaTeX — drifted braces on a long
    // prose-in-math formula) renders its raw source. Replace that source with a readable plain-text
    // reduction ('rate of O2 consumption / arterial O2 content') so the reader sees legible math, not
    // \frac{{...}} code. Only touches the failed spans; well-formed math is already typeset.
    const errs = root.querySelectorAll('.katex-error')
    Array.prototype.forEach.call(errs, function(el) {
      const readable = mathFallbackText(el.textContent || '')
      if (readable) { el.textContent = readable; el.classList.add('bk-math-degraded'); el.removeAttribute('title') }
    })
  },

  upgradeRichMarkdown(root) {
    const self = this
    Array.prototype.forEach.call(root.querySelectorAll('code.language-svg'), function(code) {
      if (!window.KalamosRichContent) return
      const pre = code.parentNode
      const box = el('div', 'kalamos-diagram')
      try {
        box.innerHTML = KalamosRichContent.sanitizeSvg(code.textContent)
        pre.replaceWith(box)
      } catch (e) { /* keep the fenced source visible when it is not a safe, complete SVG */ }
    })
    Array.prototype.forEach.call(root.querySelectorAll('code.language-mermaid'), function(code, index) {
      if (!window.KalamosRichContent) return
      const pre = code.parentNode
      const box = el('div', 'kalamos-diagram')
      pre.replaceWith(box)
      KalamosRichContent.renderMermaid(box, code.textContent,
        'book-diagram-' + Date.now() + '-' + index).then(function() {
          self.paginate()
        }).catch(function() {
          box.textContent = code.textContent
          self.paginate()
        })
    })
    Array.prototype.forEach.call(root.querySelectorAll('.bk-md-footnote-ref'), function(button) {
      button.addEventListener('click', function(event) {
        event.preventDefault(); event.stopPropagation()
        const id = button.getAttribute('data-footnote') || ''
        const templates = root.querySelectorAll('template.bk-md-footnote')
        let template = null
        Array.prototype.some.call(templates, function(row) {
          if (row.getAttribute('data-footnote') === id) { template = row; return true }
          return false
        })
        if (template) self.openMarkdownFootnote(button.textContent, template.innerHTML)
      })
    })
  },

  openMarkdownFootnote(label, html) {
    this.hidePopup()
    const self = this
    const overlay = el('div', 'ep-footnote-overlay')
    const card = el('section', 'ep-footnote-card')
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-labelledby', 'bk-md-footnote-title')
    const head = el('header', 'ep-footnote-head')
    const title = el('h2', 'ep-footnote-title', 'Footnote' + (label ? ' ' + label : ''))
    title.id = 'bk-md-footnote-title'
    const close = el('button', 'ep-footnote-close', 'Close')
    close.type = 'button'; close.addEventListener('click', function() { self.hidePopup() })
    const body = el('div', 'ep-footnote-body kalamos-markdown')
    body.innerHTML = html
    head.appendChild(title); head.appendChild(close); card.appendChild(head); card.appendChild(body)
    overlay.appendChild(card)
    overlay.addEventListener('click', function(event) { if (event.target === overlay) self.hidePopup() })
    this.view().appendChild(overlay); this._pop = overlay
    requestAnimationFrame(function() { close.focus() })
  },

  // --- pagination via CSS multicolumn: each column = one text page; page = translateX by page*stride.
  // On WIDE viewports (tablet landscape / desktop ≥ 820 CSS px) the reader shows a TWO-PAGE SPREAD —
  // two columns side by side like an open book — instead of one enormous unreadable line measure.
  // A page-turn then advances one whole spread. The e-ink device (674 CSS px) keeps a single page.
  // The flow's column height is published as --bk-colh so figures/images can be capped to fit a
  // column (else a tall image spills down the page instead of paginating). ---
  // Column geometry/layout is shared with epub-reader.js — see reader-paginate.js (AD-5 extraction).
  _pageGeom() { return ReaderPaginate.pageGeom(this._content, this._flow) },
  _contentPadX() { return ReaderPaginate.contentPadX(this._content) },
  // Coalesce a burst of re-paginate requests (e.g. many images settling as they stream in) into a
  // single measure on the next frame, instead of one full layout per image.
  _schedulePaginate() {
    if (this._pgRaf) return
    const self = this
    this._pgRaf = requestAnimationFrame(function() { self._pgRaf = 0; self.paginate() })
  },
  paginate() {
    const c = this._content, f = this._flow; if (!c || !f) return
    // Cheap geometry first (clientWidth/Height — no reflow). The expensive step below is layout()'s
    // scrollWidth read, which forces a full column re-measure. Skip it when nothing that changes the
    // column COUNT has changed since the last measure — a plain page turn only needs a translateX, so
    // it reuses the cached geometry/page-count instead of re-measuring the whole flow every turn.
    const gCheap = ReaderPaginate.pageGeom(c, f)
    const sig = this.fontScale() + 'x' + gCheap.colW + 'x' + c.clientHeight + 'x' + this.sectionId() +
                'x' + (this._imgToken || 0)
    if (sig === this._lastPgSig && this._lastPgGeom && gCheap.colW >= 2) {
      if (this.page >= this.pages) this.page = this.pages - 1
      if (this.page < 0) this.page = 0
      ReaderPaginate.showPage(f, this.page, this._lastPgGeom)
      this._afterPaginate()
      return
    }
    const L = ReaderPaginate.layout(c, f, this._pagebox, '--bk-colh')
    if (L.geom.colW < 2) return
    const h = L.h, g = L.geom
    // Shrink oversized tables before FINALIZING the column count (their scaled footprint then paginates
    // like any atomic block). Keyed on geometry+font so it only re-measures on a real reflow.
    const fitKey = g.colW + 'x' + h + 'x' + this.fontScale()
    if (fitKey !== this._tblFitKey) {
      this._tblFitKey = fitKey
      // fitTables can turn a very tall table into a much shorter atomic block. The first layout above
      // establishes the column geometry it needs, but its ncols was measured BEFORE that shrink. Keep
      // the post-fit scrollWidth as the authoritative count or the removed table height survives as
      // empty trailing pages (seven phantom pages in First Aid s015). Missing converter images are
      // deliberately unrelated: they stay missing and keep reporting their original errors.
      if (this.fitTables(g.colW, Math.max(80, h - 44))) {
        L.ncols = Math.max(1, Math.round((f.scrollWidth + g.gap) / g.colStride))
      }
    }
    this.pages = Math.max(1, Math.ceil(L.ncols / g.cols))
    if (this.page >= this.pages) this.page = this.pages - 1
    if (this.page < 0) this.page = 0
    ReaderPaginate.showPage(f, this.page, g)
    this._recordSecPages(g)
    this._lastPgSig = sig; this._lastPgGeom = g   // cache: a page turn at this geometry skips re-measure
    this._afterPaginate()
  },
  // Per-page chrome (section indicator, nav readout, progress bar, clock, highlights, inline ink,
  // bookmark glyph). Runs on both the full-measure and the cached fast path.
  _afterPaginate() {
    this._ind.textContent = this.sectionStatusLabel(this.sectionId())
    const bp = this.bookPages()
    this._updateNav()
    if (this._progbar) {
      const spineLen = this.manifest.spine.length || 1
      const frac = bp ? bp.cur / bp.total
                      : (this.sec + (this.pages ? (this.page + 1) / this.pages : 0)) / spineLen
      this._progbar.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'
    }
    this.updateClock()
    this.applyHighlights()
    this.updateInlineInk()   // attach/detach the daemon to an inline <kal-ink> on this page
    this.updateBookmarkGlyph()
  },

  // ---- neighbor-section prefetch ----
  // The 64KB sections keep memory low on the e-ink device, but a boundary page-turn then pays a
  // JS-bridge fetch on top of the re-render. There is no content overlap between sections (never
  // was — overlap would duplicate text and break the char-offset highlight anchors); instead the
  // NEXT/PREV sections' raw JSON is warmed here, off the critical path, after the current section
  // settles. Cache is bounded to the current section's neighbors (≤3 × 64KB strings).
  prefetchNeighbors() {
    const self = this, spine = (this.manifest && this.manifest.spine) || []
    if (!this._secCache) this._secCache = {}
    const want = {}
    ;[this.sec - 1, this.sec, this.sec + 1].forEach(function(i) {
      if (i >= 0 && i < spine.length) want[spine[i].sectionId] = true
    })
    Object.keys(this._secCache).forEach(function(sid) { if (!want[sid]) delete self._secCache[sid] })
    Object.keys(want).forEach(function(sid) {
      if (self._secCache[sid] != null) return
      setTimeout(function() {
        if (self._secCache && self._secCache[sid] == null && self.manifest)
          self._secCache[sid] = Bridge.getBookFile(self.nbId, 'sections/' + sid + '.json') || ''
      }, 250)
    })
  },

  // ---- whole-book reflow page count ----
  // Only the CURRENT section's page count is ever measured (sections are lazily rendered 64KB
  // chunks), so the true book-wide page number can't be read off the DOM. The manifest carries each
  // section's layout weight (spine[i].chars); calibrating chars-per-rendered-page from every section
  // measured so far — at this viewport + font size — extrapolates the rest. The total starts as a
  // good estimate and hardens into the exact count as more sections are visited.
  _recordSecPages(g) {
    const key = this.fontScale() + ':' + g.colW + 'x' + (this._flow ? this._flow.style.height : '')
    if (key !== this._pkey) { this._pkey = key; this._secPages = {} }   // reflowed → old measurements stale
    this._secPages[this.sectionId()] = this.pages
  },
  bookPages() {
    const spine = (this.manifest && this.manifest.spine) || []
    return ReaderPaginate.bookPages(spine, this._secPages || {},
      function(i) { return spine[i] && spine[i].sectionId }, this.sec, this.page)
  },
  _updateNav() {
    if (!this._navlbl) return
    const bp = this.bookPages()
    this._navlbl.textContent = bp ? (bp.cur + ' / ' + bp.total) : ((this.page + 1) + ' / ' + this.pages)
  },

  nextPage() {
    if (window.BooxPageInk && BooxPageInk.modeOn(this)) return
    const self = this
    if (window.NativePages) return NativePages.next(this, 'book', function() { self._nextSourcePage() })
    this._nextSourcePage()
  },
  _nextSourcePage() {
    this._clearReflowAnchor()
    this._pendingBid = null   // a manual turn cancels any still-anchoring jump target
    this._pendingImageItem = null
    this._searchMark = null   // WP11: a manual turn clears the transient search-jump mark
    if (this.page < this.pages - 1) { this.page++; this.paginate(); this.savePosition() }
    else if (this.sec < this.manifest.spine.length - 1) { this.sec++; this.page = 0; this.renderSection() }
  },
  prevPage() {
    if (window.BooxPageInk && BooxPageInk.modeOn(this)) return
    const self = this
    if (window.NativePages) return NativePages.prev(this, 'book', function() { return self._prevSourcePage() })
    this._prevSourcePage()
  },
  _prevSourcePage() {
    this._clearReflowAnchor()
    this._pendingBid = null
    this._pendingImageItem = null
    this._searchMark = null
    if (this.page > 0) { this.page--; this.paginate(); this.savePosition(); return false }
    else if (this.sec > 0) { this.sec--; this.page = 1e9; this.renderSection(); return true }
    return false
  },

  // ---- tap-zone navigation (KOReader-style; no buttons) ----
  // A stationary finger/pen tap on the content drives everything by WHERE it lands: the left/right thirds
  // turn the page, the top/bottom bands reveal the floating bars, the centre dismisses them. A *drag* is
  // left to wireSelection (highlighting) and a hold-over-highlight to its menu — so this is purely
  // additive: a stationary tap never created a highlight before. Controls and links keep their own
  // behaviour. Images remain page-turn targets on a short tap and open their viewer only after a
  // stationary 500 ms hold. If a bar is open any ordinary tap simply closes it.
  wireTapZones(content) {
    const self = this
    let downX = 0, downY = 0, downT = null, downTarget = null, moved = false
    const SKIP = '.rd-mcq, .bk-ink, .rd-anim, .rd-draw, button, a, input, .rd-pop, .bk-tbl-zoom'
    const diag = function(reason, e, data) {
      if (window.ReaderTapDiag) window.ReaderTapDiag.log('blocks', reason, e, data)
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
      if (dt >= 500) { diag('long', e, { dt: dt, dx: dx, dy: dy }); return }
      if (self._inkWrap || self._pop) { diag('modal', e, { dt: dt }); return }
      if (self.view().querySelector('.iv-overlay')) { diag('image-viewer', e, { dt: dt }); return }
      if (downTarget && downTarget.closest && downTarget.closest(SKIP)) { diag('skip-target', e, { dt: dt }); return }
      const r = content.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      // top-right ~64px square = bookmark toggle (checked before the top-band bar-toggle so a corner
      // tap never also reveals the top bar); works even while a bar is open.
      if (x > r.width - 64 && y < 64) { diag('bookmark', e, { dt: dt, zone: 'top-right' }); self.toggleBookmarkTap(); return }
      if (self.barsOpen()) { diag('bars-close', e, { dt: dt }); self.hideBars(); return }
      if (y < r.height * 0.14) { diag('top-bar', e, { dt: dt, zone: 'top' }); self.toggleBar('top') }
      else if (y > r.height * 0.86) { diag('bottom-bar', e, { dt: dt, zone: 'bottom' }); self.toggleBar('bottom') }
      else if (x < r.width * 0.33) { diag('prev', e, { dt: dt, zone: 'left' }); self.prevPage() }
      else if (x > r.width * 0.67) { diag('next', e, { dt: dt, zone: 'right' }); self.nextPage() }
      else diag('center', e, { dt: dt, zone: 'center' })
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

  // ---- WP11 in-book search: pure-JS backend (AD-9 blocks branch — searchBook only covers epub/pdf).
  // Walks every spine section's own file (JSON blocks, falling back to legacy reflowable HTML — same
  // read-order renderSection() itself uses, so char offsets line up with what applyHighlights() draws
  // later), building the exact HTML the renderer would show so match char offsets match this._flow's
  // eventual textContent 1:1. ----
  buildSearchPanel(body) {
    if (typeof ReaderSearch === 'undefined') return
    ReaderSearch.buildTab(body, this.buildSearchAdapter())
  },
  buildSearchAdapter() {
    const self = this
    return {
      search(query, token, onBatch) {
        const q = (query || '').toLowerCase()
        const spine = (self.manifest && self.manifest.spine) || []
        const results = []
        for (let i = 0; i < spine.length && results.length < 200; i++) {
          const s = spine[i], sid = s.sectionId
          // mirrors renderSection's own section-file read order (json blocks, else legacy html)
          const rawJson = (self._secCache && self._secCache[sid]) || Bridge.getBookFile(self.nbId, 'sections/' + sid + '.json')
          let blocks = null
          if (rawJson) { try { blocks = self.visibleBlocks(sid, JSON.parse(rawJson).blocks) } catch (e) { blocks = null } }
          const html = blocks ? blocksToHtml(blocks) : (Bridge.getBookFile(self.nbId, 'sections/' + sid + '.html') || '')
          if (!html) continue
          const tmp = document.createElement('div'); tmp.innerHTML = html
          // KaTeX (renderMath) and the kal-* widget upgrades (upgrade) both rewrite text nodes —
          // this._flow's EVENTUAL textContent (what applyHighlights()/rangeForOffsets anchor against)
          // reflects those rewrites, not the raw section source. Run the same two passes here (both
          // tolerate a detached, unattached div) so a match's char offset lines up with the live flow
          // instead of drifting after the first math block or widget.
          self.renderMath(tmp)
          self.upgrade(tmp)
          const text = tmp.textContent || ''
          const lower = text.toLowerCase()
          const title = s.title || s.label || ('Section ' + (i + 1))
          let from = 0
          while (results.length < 200) {
            const pos = lower.indexOf(q, from)
            if (pos < 0) break
            const start = Math.max(0, pos - 40), end = Math.min(text.length, pos + q.length + 40)
            results.push({
              sectionId: sid, blockId: bkFindBidAtOffset(tmp, pos),
              start: pos, end: pos + query.length,
              snippet: text.substring(start, end), ref: title
            })
            from = pos + q.length
          }
        }
        onBatch(results, true)   // synchronous scan — one, final batch
      },
      gotoMatch(match) { self.gotoSearchMatch(match) }
    }
  },
  // land on the section+page holding [match], then draw a transient locator mark (reuses the
  // highlights overlay machinery — applyHighlights() below draws it alongside real highlights,
  // so it disappears the moment the reader turns the page, same as any other reflow of this._flow).
  gotoSearchMatch(match) {
    if (!match) return
    this._pendingBid = null
    this._searchMark = { sectionId: match.sectionId, start: match.start, end: match.end }
    const spine = (this.manifest && this.manifest.spine) || []
    const si = spine.findIndex(function(s) { return s.sectionId === match.sectionId })
    if (si === -1) return
    if (si !== this.sec) {
      this._pendingSearchOffset = match.start
      this.sec = si; this.page = 0; this.renderSection()
    } else {
      this._gotoCharOffset(match.start)
      this.applyHighlights()
    }
  },

  // Open a locally assigned AI evidence target and draw it with the same one-shot locator used by
  // in-book search. The cited block ID survives pagination/font changes and never becomes a
  // permanent annotation.
  gotoStudyEvidence(target, done) {
    if (!target || target.kind !== 'book') { if (done) done(false); return }
    const spine = (this.manifest && this.manifest.spine) || []
    const si = spine.findIndex(function(s) {
      return String(s.sectionId || s.id) === String(target.sectionId)
    })
    if (si < 0) { if (done) done(false); return }
    this._pendingBid = null
    this._pendingSearchOffset = null
    this._pendingStudyEvidence = { target: target, done: done }
    if (si !== this.sec) {
      this.sec = si
      this.page = 0
      this.renderSection()
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
    let segment = null
    if (target.blockId != null) {
      try {
        segment = this._flow.querySelector('.bk-blk[data-bid="' +
          CSS.escape(String(target.blockId)) + '"]')
      } catch (e) { segment = null }
    }
    if (!segment && Number.isInteger(target.segmentIndex)) {
      const nodes = this._flow.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,td,th')
      segment = nodes[target.segmentIndex] || null
    }
    let start = Number.isInteger(target.start) ? target.start : 0
    let end = Number.isInteger(target.end) ? target.end : start + 1
    if (segment) {
      start = offsetWithin(this._flow, segment, 0)
      end = start + Math.max(1, (segment.textContent || '').length)
    }
    const len = (this._flow.textContent || '').length
    start = Math.max(0, Math.min(len, start))
    end = Math.max(start + 1, Math.min(len, end))
    this._searchMark = { sectionId: this.sectionId(), start: start, end: end }
    this._gotoCharOffset(start)
    this.applyHighlights()
    if (pending.done) pending.done(true)
    return true
  },

  // Format tab (WP9, js/reader-format.js): Fonts/Spacing stepper rows. Every change persists (per-book
  // sidecar + new globals) and re-applies here, anchor-safe (same technique as bumpFont below).
  buildFormatPanel(body) {
    const self = this
    if (typeof ReaderFormat === 'undefined') return
    ReaderFormat.buildPanel(body, { epub: false, onChange: function() { self.onFormatChange() } })
  },
  onFormatChange() {
    const off = this._bxFormatAnchor != null ? this._bxFormatAnchor : this._topCharOffset()
    this.applyFormat()
    this._anchorAfterFormatChange(off)
  },
  // apply the merged ReaderFormat settings to this section's content root: CSS vars (font family/
  // line/paragraph spacing/margins/embolden) + the existing font-scale mechanism (fontScale() below
  // now reads through ReaderFormat instead of its own localStorage key).
  applyFormat() {
    if (typeof ReaderFormat === 'undefined' || !this._content) return
    ReaderFormat.applyCssVars(this._content, ReaderFormat.get())
    this.applyFontScale()
  },

  // Table-of-contents tab: prefers the extracted TOC sidecar (chapter entries -> jump to a specific
  // block); else lists spine sections. Paginated (no scrollbar) via ReaderPanels.paginateList.
  buildTocPanel(body) {
    const self = this
    let items = this._bxTocItems
    if (!items) {
      const extracted = (this.toc && this.toc.entries) || null
      const manifestToc = (this.manifest && this.manifest.toc) || null
      const entries = extracted && extracted.length ? extracted : (manifestToc && manifestToc.length
        ? manifestToc.map(function(row) {
          return { id: row.entryId, title: row.label || row.title, level: row.depth || 1,
            role: row.role, sectionId: row.sectionId || String(row.href || '').split('#', 1)[0],
            targetBlockId: row.targetBlockId || String(row.href || '').split('#', 2)[1] || null,
            parentId: row.parentId || null }
        }) : null)
      if (entries && entries.length) items = entries.map(function(e) { return { kind: 'entry', e: e } })
      else {
        const spine = (this.manifest && this.manifest.spine) || []
        items = spine.map(function(s, i) { return { kind: 'spine', s: s, i: i } })
      }
      this._bxTocItems = items
      if (this.toc) try { Object.defineProperty(this.toc, '_kalItems', { value: items, configurable: true }) } catch (e) {}
    }
    BooxToc.render(this, body, items,
      function(item) { return item.kind === 'entry' ? Math.max(1, item.e.level || 1) : 1 },
      function(item, i) { return item.kind === 'entry' ? 'book:' + i + ':' + (item.e.title || '') : 'book-spine:' + i },
      function(item) {
      if (item.kind === 'entry') {
        const e = item.e
        const lvl = Math.max(1, e.level || 1)
        const row = el('button', 'rp-row rp-toc-l' + lvl)
        row.style.setProperty('--toc-indent', Math.min(72, (lvl - 1) * 18) + 'px')
        row.appendChild(el('span', 'rp-row-label', e.title || 'Section'))
        if (e.page) row.appendChild(el('span', 'rp-row-page', String(e.page)))
        ReaderBookLink.wire(row, function() { ReaderPanels.close(); self.jumpTo(e.sectionId, e.targetBlockId) })
        return row
      }
      const s = item.s, i = item.i
      const label = s.title || s.label || ('Section ' + (i + 1))
      const row = el('button', 'rp-row' + (i === self.sec ? ' sel' : ''))
      row.appendChild(el('span', 'rp-row-label', label))
      ReaderBookLink.wire(row, function() {
        ReaderPanels.close()
        if (i !== self.sec) { self.sec = i; self.page = 0; self.renderSection() }
      })
      return row
    })
  },

  // Pictures tab: build a compact image-block index lazily, persist it beside the immutable book,
  // and render only the visible six thumbnails. Tapping a picture follows the same block jump used
  // by the TOC, so it lands on the picture's actual reflowed page.
  buildImagesPanel(body) {
    const self = this
    function render(items) {
      if (!body.isConnected) return
      ReaderPanels.imageGallery(body, items, {
        src: function(item) {
          if (/^(data:|https?:)/i.test(item.src || '')) return item.src
          return self._bookImageStreamUrl(item.src)
        },
        fallback: function(item) {
          return Bridge.getNotebookAsset(self.nbId, item.src) || ''
        },
        label: function(item, i) { return item.label || ('Picture ' + (i + 1)) },
        ref: function(item) { return item.ref || '' },
        select: function(item) { ReaderPanels.close(); self.gotoImageItem(item) }
      })
    }
    if (this._imageItems) { render(this._imageItems); return }
    const stored = this._loadStoredImageIndex()
    if (stored) { this._imageItems = stored; render(stored); return }

    body.innerHTML = ''
    const loading = el('div', 'rp-loading', 'Finding pictures…')
    body.appendChild(loading)
    this._scanBookImages(function(items) { render(items) })
  },
  _imageIndexSignature() {
    const spine = (this.manifest && this.manifest.spine) || []
    return spine.map(function(s) {
      return [s.sectionId || '', s.chars == null ? '' : s.chars, s.title || s.label || ''].join(':')
    }).join('|')
  },
  _loadStoredImageIndex() {
    try {
      const raw = Bridge.getBookFile(this.nbId, 'sidecar/image-index-v1.json')
      const saved = raw ? JSON.parse(raw) : null
      if (saved && saved.version === 1 && saved.signature === this._imageIndexSignature() &&
          Array.isArray(saved.items)) return saved.items
    } catch (e) {}
    return null
  },
  _scanBookImages(done) {
    if (this._imageIndexJob) { this._imageIndexJob.waiters.push(done); return }
    const self = this
    const spine = (this.manifest && this.manifest.spine) || []
    const job = { nbId: this.nbId, items: [], waiters: [done], index: 0 }
    this._imageIndexJob = job

    function addBlocks(section, blocks) {
      let ordinal = 0
      ;(blocks || []).forEach(function(block) {
        if (!block || block.type !== 'image' || !block.src) return
        let src = String(block.src)
        if (!/^(assets\/|data:|https?:)/i.test(src)) src = 'assets/' + src
        const sectionTitle = section.title || section.label || ('Section ' + (job.index + 1))
        const page = block.page != null ? 'p. ' + block.page : ''
        job.items.push({
          sectionId: section.sectionId,
          blockId: block.id || null,
          ordinal: ordinal++,
          src: src,
          label: block.caption || block.alt || '',
          ref: sectionTitle + (page ? ' · ' + page : '')
        })
      })
    }
    function addLegacy(section, html) {
      const root = document.createElement('div'); root.innerHTML = html
      Array.prototype.forEach.call(root.querySelectorAll('img[src]'), function(img, ordinal) {
        let src = img.getAttribute('src') || ''
        if (!src) return
        if (!/^(assets\/|data:|https?:)/i.test(src)) src = 'assets/' + src
        job.items.push({
          sectionId: section.sectionId, blockId: null, ordinal: ordinal, legacy: true, src: src,
          label: img.getAttribute('alt') || img.getAttribute('title') || '',
          ref: section.title || section.label || ('Section ' + (job.index + 1))
        })
      })
    }
    function finish() {
      if (self._imageIndexJob !== job) return
      self._imageIndexJob = null
      self._imageItems = job.items
      try {
        Bridge.saveBookFile(self.nbId, 'sidecar/image-index-v1.json', JSON.stringify({
          version: 1, signature: self._imageIndexSignature(), items: job.items
        }))
      } catch (e) {}
      job.waiters.forEach(function(waiter) { waiter(job.items) })
    }
    function step() {
      if (self._imageIndexJob !== job || self.nbId !== job.nbId) return
      if (job.index >= spine.length) { finish(); return }
      const section = spine[job.index++]
      const sid = section.sectionId
      const rawJson = (self._secCache && self._secCache[sid]) ||
        Bridge.getBookFile(self.nbId, 'sections/' + sid + '.json')
      let blocks = null
      if (rawJson) {
        try { blocks = (JSON.parse(rawJson) || {}).blocks } catch (e) { blocks = null }
      }
      if (Array.isArray(blocks)) addBlocks(section, blocks)
      else {
        const html = Bridge.getBookFile(self.nbId, 'sections/' + sid + '.html') || ''
        if (html) addLegacy(section, html)
      }
      setTimeout(step, 0)
    }
    setTimeout(step, 0)
  },
  _bookImageStreamUrl(src) {
    const path = String(src || '').split('/').map(encodeURIComponent).join('/')
    return 'https://kalamos.content/nbasset/' + encodeURIComponent(this.nbId) + '/' + path
  },
  gotoImageItem(item) {
    if (!item) return
    this._searchMark = null; this._pendingBid = null
    const spine = (this.manifest && this.manifest.spine) || []
    const si = spine.findIndex(function(s) { return s.sectionId === item.sectionId })
    if (si < 0) return
    this._pendingImageItem = item
    const self = this
    if (si !== this.sec) { this.sec = si; this.page = 0; this.renderSection() }
    else requestAnimationFrame(function() { self._gotoImageItem(item) })
  },
  _gotoImageItem(item) {
    if (!item || !this._flow) return false
    let target = null
    if (item.blockId) {
      const blocks = this._flow.querySelectorAll('.bk-blk[data-bid]')
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].getAttribute('data-bid') === String(item.blockId)) { target = blocks[i]; break }
      }
    }
    if (!target) {
      const images = this._flow.querySelectorAll(item.legacy ? 'img' : '.bk-fig img')
      target = images[item.ordinal || 0] || null
      if (target && target.closest) target = target.closest('.bk-blk') || target
    }
    if (!target) return false
    const g = this._pageGeom()
    const col = Math.round(target.offsetLeft / g.colStride)
    this.page = Math.max(0, Math.min(this.pages - 1, Math.floor(col / g.cols)))
    ReaderPaginate.showPage(this._flow, this.page, g)
    this._updateNav(); this.updateClock(); this.savePosition()
    return true
  },

  // Bookmarks tab: label + date, tap = jump there, trash glyph = delete (re-renders the same page,
  // no scrollbar -- deleting the last row on a page falls back to 'Nothing here yet').
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

  // ---- Bookmarks adapter (AD-8 loc shape for blocks books: {type:'blocks', sectionId, page}) ----
  _initBookmarks() {
    if (typeof Bookmarks === 'undefined') return
    const self = this
    Bookmarks.init(this.nbId, {
      currentLoc: function() { return self.currentLoc() },
      describeLoc: function(loc) { return self.describeLoc(loc) },
      gotoLoc: function(loc) { self.gotoBookmarkLoc(loc) },
      locEquals: function(a, b) {
        return !!a && !!b && a.type === b.type && a.sectionId === b.sectionId && a.page === b.page
      }
    })
  },
  currentLoc() { return { type: 'blocks', sectionId: this.sectionId(), page: this.page } },
  // cheap label: section title/label + printed-flow page number (both already on hand -- no re-scan)
  describeLoc(loc) {
    const spine = (this.manifest && this.manifest.spine) || []
    const s = spine.find(function(x) { return x.sectionId === loc.sectionId })
    const title = (s && (s.title || s.label)) || 'Section'
    return title + '  · p.' + ((loc.page || 0) + 1)
  },
  gotoBookmarkLoc(loc) {
    if (!loc || loc.type !== 'blocks') return
    this._searchMark = null
    const spine = (this.manifest && this.manifest.spine) || []
    const si = spine.findIndex(function(s) { return s.sectionId === loc.sectionId })
    if (si === -1) return
    this._pendingBid = null
    if (si !== this.sec) { this.sec = si; this.page = loc.page || 0; this.renderSection() }
    else { this.page = loc.page || 0; this.paginate(); this.savePosition() }
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

  // tappable printed-contents rows (blocksToHtml 'contents') → the same jump path as the TOC bar.
  // The tap-zone handler already ignores taps on <a>, so a row tap never also turns the page.
  wireContents(root) {
    const self = this
    Array.prototype.forEach.call(root.querySelectorAll('.bk-contents a[data-sec]'), function(a) {
      ReaderBookLink.wire(a, function() {
        self.jumpTo(a.getAttribute('data-sec'), a.getAttribute('data-bid') || null)
      })
    })
  },

  // jump to a TOC target: switch to its section (if needed) then land on the page holding [blockId]
  jumpTo(sectionId, blockId) {
    this._searchMark = null
    const spine = (this.manifest && this.manifest.spine) || []
    const si = spine.findIndex(function(s) { return s.sectionId === sectionId })
    const self = this
    if (si >= 0 && si !== this.sec) {
      this._pendingBid = blockId; this.sec = si; this.page = 0; this.renderSection()
    } else {
      requestAnimationFrame(function() { if (!self._gotoBlockId(blockId)) { self.page = 0; self.paginate() } })
    }
  },
  _gotoBlockId(bid) {
    if (!bid || !this._flow) return false
    const elx = this._flow.querySelector('.bk-blk[data-bid="' + bid + '"]')
    if (!elx) return false
    const checkpoint = elx.closest && elx.closest('kal-inline-checkpoint')
    const hiddenAnswer = checkpoint && checkpoint.querySelector('.bk-checkpoint-answer[hidden]')
    if (hiddenAnswer) {
      checkpoint.dispatchEvent(new CustomEvent('kalamos-reveal-source'))
      this._lastPgSig = null
      this.paginate()
    }
    const g = this._pageGeom()
    const col = Math.round(elx.offsetLeft / g.colStride)
    this.page = Math.max(0, Math.min(this.pages - 1, Math.floor(col / g.cols)))
    this._flow.style.transform = 'translateX(' + (-this.page * g.pageStride) + 'px)'
    this._updateNav()
    this.updateClock(); this.savePosition()
    return true
  },

  // ---- reading font size (A− / A+ in the top bar) ----
  // WP9: the single source of truth is now ReaderFormat (merged globals ← per-book sidecar/format.json);
  // this reads/writes through it instead of its own localStorage key, so the Format panel's "Font size"
  // stepper and these A−/A+ buttons drive the exact same setting.
  fontScale() {
    if (typeof ReaderFormat !== 'undefined') return ReaderFormat.get().fontScale
    const v = parseFloat(typeof localStorage !== 'undefined' ? localStorage.getItem('kal.reader.fontScale') : '')
    return (v && v >= 0.7 && v <= 2.2) ? v : 1.0
  },
  applyFontScale() {
    if (!this._flow) return
    // Scale the stylesheet's OWN design size (19px Georgia). NB an inline percentage resolves
    // against the PARENT (16px body), which silently shrank every book to 16px even at scale 1.0.
    this._flow.style.fontSize = ''                    // reveal the stylesheet size
    const s = this.fontScale()
    if (s !== 1) {
      const base = parseFloat(getComputedStyle(this._flow).fontSize) || 19
      this._flow.style.fontSize = (Math.round(base * s * 10) / 10) + 'px'
    }
  },
  bumpFont(dir) {
    let s = Math.round((this.fontScale() + dir * 0.1) * 10) / 10
    s = Math.max(0.7, Math.min(2.2, s))
    const off = this._topCharOffset()
    if (typeof ReaderFormat !== 'undefined') ReaderFormat.set({ fontScale: s })
    else try { localStorage.setItem('kal.reader.fontScale', String(s)) } catch (e) {}
    this.applyFormat()
    this._anchorAfterFormatChange(off)
  },
  // character offset (within #bk-flow) of the text at the top-left corner of the current page. Uses
  // caretRangeFromPoint (O(1)) — far cheaper than scanning every block, and pins the actual top line.
  _topCharOffset() {
    if (!this._flow || !document.caretRangeFromPoint) return null
    const cr = (this._pagebox || this._content).getBoundingClientRect()
    const xs = [8, 32, Math.min(80, Math.max(8, cr.width / 3))]
    const ys = [8, 28, 56, Math.min(96, Math.max(8, cr.height / 5))]
    for (let yi = 0; yi < ys.length; yi++) for (let xi = 0; xi < xs.length; xi++) {
      let r = null
      try { r = document.caretRangeFromPoint(cr.left + xs[xi], cr.top + ys[yi]) } catch (e) { r = null }
      if (!r || !this._flow.contains(r.startContainer)) continue
      return this._wordStartOffset(offsetWithin(this._flow, r.startContainer, r.startOffset))
    }
    return null
  },
  _wordStartOffset(off) {
    if (off == null || !this._flow) return off
    const text = this._flow.textContent || '', len = text.length
    let i = Math.max(0, Math.min(len, off))
    while (i < len && /\s/.test(text.charAt(i))) i++
    while (i > 0 && /\S/.test(text.charAt(i - 1))) i--
    return i
  },
  _anchorAfterFormatChange(off) {
    const self = this, fallbackPage = this.page
    this._reflowAnchor = off
    clearTimeout(this._reflowAnchorTimer)
    const token = (this._reflowAnchorSeq || 0) + 1
    this._reflowAnchorSeq = token
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready.catch(function() {}) : Promise.resolve()
    fontsReady.then(function() {
      let last = -1, stable = 0, frames = 0
      function settle() {
        if (self._reflowAnchorSeq !== token) return
        const width = self._flow ? self._flow.scrollWidth : 0
        stable = Math.abs(width - last) < 1 ? stable + 1 : 0
        last = width; frames++
        if (stable < 2 && frames < 8) { requestAnimationFrame(settle); return }
      self.paginate()
      if (off != null) self._gotoCharOffset(off)
      else { self.page = Math.max(0, Math.min(self.pages - 1, fallbackPage)); self.paginate() }
      self.applyHighlights()
      self._reflowAnchor = null; self._reflowAnchorTimer = null
      }
      requestAnimationFrame(settle)
    })
  },
  _clearReflowAnchor() {
    this._reflowAnchor = null
    clearTimeout(this._reflowAnchorTimer)
    this._reflowAnchorTimer = null
  },
  // jump to the page that holds [off] so that character is at the top-left again (used after a reflow)
  _gotoCharOffset(off) {
    if (off == null || !this._flow) return
    const len = this._flow.textContent.length
    const rg = rangeForOffsets(this._flow, Math.min(off, len), Math.min(off + 1, len))
    if (!rg) return
    const g = this._pageGeom()
    const x = rg.getBoundingClientRect().left - this._flow.getBoundingClientRect().left
    const col = Math.round(x / g.colStride)
    const estimated = Math.max(0, Math.min(this.pages - 1, Math.floor(col / g.cols)))
    // Match the EPUB reader's stable reflow path: the geometric estimate can land one page late
    // when the saved word is near a column edge, so inspect the adjacent page starts and choose the
    // closest source-text anchor before applying the one canonical page transform.
    this.page = this._nearestPageStart(off, estimated, g)
    ReaderPaginate.showPage(this._flow, this.page, g)
    this._updateNav()
    this.updateClock(); this.savePosition()
  },
  _nearestPageStart(off, estimated, g) {
    if (!this._flow || !this.pages || off == null) return estimated
    const cur = this.page
    let bestPage = estimated, bestDist = Infinity
    const lo = Math.max(0, estimated - 2)
    const hi = Math.min(this.pages - 1, estimated + 2)
    const rg = rangeForOffsets(this._flow, Math.min(off, this._flow.textContent.length),
      Math.min(off + 1, this._flow.textContent.length))
    const viewport = (this._pagebox || this._content).getBoundingClientRect()
    for (let p = lo; p <= hi; p++) {
      ReaderPaginate.showPage(this._flow, p, g)
      if (rg) {
        const rr = rg.getBoundingClientRect()
        if (rr.right > viewport.left && rr.left < viewport.right &&
            rr.bottom > viewport.top && rr.top < viewport.bottom) {
          ReaderPaginate.showPage(this._flow, cur, g)
          return p
        }
      }
      const top = this._topCharOffset()
      if (top == null) continue
      const d = Math.abs(top - off)
      if (d < bestDist) { bestDist = d; bestPage = p }
    }
    ReaderPaginate.showPage(this._flow, cur, g)
    return bestPage
  },

  // ---- bottom-left clock + page (stands in for the hidden system status bar) ----
  applyClockSetting() {
    const on = !(typeof localStorage !== 'undefined' && localStorage.getItem('kal.reader.showClock') === '0')
    if (this._clock) this._clock.classList.toggle('hidden', !on)
    this.updateClock()
  },
  // The PRINTED book page of the current column (not the scan/PDF index). Reads the data-page (scan page)
  // of the first block visible in the column and maps it through manifest.pageMap (with pageOffset as a
  // fallback for unlabeled pages). Returns null if the book carries no page map.
  currentPrintedPage() {
    if (!this._flow || !this.manifest || !this.manifest.pageMap) return null
    const g = this._pageGeom()
    // the visible region spans the whole spread; the first visible block gives the left page's number
    const colLeft = this.page * g.pageStride, colRight = colLeft + g.pageStride - g.gap + 8
    const blks = this._flow.querySelectorAll('.bk-blk[data-page]')
    let scan = null
    for (let i = 0; i < blks.length; i++) {
      const ol = blks[i].offsetLeft
      if (ol >= colLeft - 8 && ol < colRight) { scan = blks[i].getAttribute('data-page'); break }
    }
    if (scan == null) return null
    if (this.manifest.pageMap[scan] != null) return this.manifest.pageMap[scan]
    const off = this.manifest.pageOffset || 0, n = parseInt(scan, 10)
    return isNaN(n) ? null : String(Math.max(1, n - off))
  },

  updateClock() {
    if (!this._clock) return
    const d = new Date(), hh = d.getHours(), mm = d.getMinutes()
    const t = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
    // whole-book reflow position first ('134/512'), the PRINTED source page in brackets ('(p 97)')
    // so a printed cross-reference ("see page 97") stays resolvable. Older books without spine
    // weights fall back to printed page alone, then to the section-local count.
    const pp = this.currentPrintedPage()
    const bp = this.bookPages()
    const pos = bp ? (bp.cur + '/' + bp.total) : null
    this._clock.textContent = t + '  ·  ' +
      (pos ? pos + (pp != null ? ' (p ' + pp + ')' : '')
           : 'p ' + (pp != null ? pp : (this.page + 1) + '/' + this.pages))
  },

  // Resolve book images WITHOUT paying for their pixels on the synchronous open path, and WITHOUT
  // letting them shift the layout as they arrive:
  //  1. ONE batched header-only probe (getNotebookAssetDims) returns every image's intrinsic size;
  //     setting width/height attributes reserves each image's exact box (the browser derives the
  //     aspect ratio from the attributes even when CSS overrides the width), so pagination is final
  //     before any pixel loads.
  //  2. Pixels then stream in asynchronously through the kalamos.content/nbasset interceptor route.
  // Sections whose dims can't be probed (older native, browser preview) fall back to the batched —
  // then per-asset — synchronous base64 path, which keeps layout stable at the cost of open time.
  resolveImages(root) {
    const self = this
    const imgs = root.querySelectorAll('img[src^="assets/"]')
    if (!imgs.length) return
    const imageHold = ReaderImageLongPress(function(src) { self.openImageViewer(src) })
    const rels = []
    Array.prototype.forEach.call(imgs, function(img) { rels.push(img.getAttribute('src')) })
    const dims = Bridge.getNotebookAssetDims ? Bridge.getNotebookAssetDims(this.nbId, rels) : null
    // base64 batch only for the fallback path (dims missing / probe unavailable)
    let batch = null
    if (!dims && Bridge.getNotebookAssets) batch = Bridge.getNotebookAssets(this.nbId, rels)
    Array.prototype.forEach.call(imgs, function(img) {
      const rel = img.getAttribute('src')
      img.style.cursor = 'pointer'
      // Chromium otherwise starts Android's native image drag at roughly the same 500 ms boundary
      // as our viewer hold. That emits pointercancel (and asks the missing DropDataProvider for
      // drag data), which makes image opening intermittent on the device.
      img.draggable = false
      img.setAttribute('draggable', 'false')
      img.style.webkitUserDrag = 'none'
      img.style.userSelect = 'none'
      img.style.webkitUserSelect = 'none'
      img.addEventListener('pointerdown', function(e) {
        // Prevent WebView's native image/text long-press recognizer from cancelling this pointer at
        // Android's own ~500 ms threshold. This does not stop propagation, so the content tap-zone
        // handler still receives down/up and a short image tap can turn the page.
        e.preventDefault()
        imageHold.start(e, img.src)
      })
      img.addEventListener('pointermove', function(e) { imageHold.move(e) })
      img.addEventListener('pointerup', function(e) { imageHold.end(e) })
      img.addEventListener('pointercancel', function() { imageHold.cancel() })
      img.addEventListener('pointerleave', function(e) { imageHold.end(e) })
      // A click is synthesized after pointerup. Page turning has already been handled by the
      // content pointer sequence, so consume the click without treating it as media activation.
      img.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation() })
      img.addEventListener('contextmenu', function(e) { e.preventDefault() })
      const d = dims && dims[rel]
      if (d && d[0] > 0 && d[1] > 0) {
        // reserved-box path: exact size known → async pixels can't move anything
        img.width = d[0]; img.height = d[1]
        img.decoding = 'async'
        img.src = 'https://kalamos.content/nbasset/' + self.nbId + '/' + rel
        img.addEventListener('error', function() {
          const url = Bridge.getNotebookAsset(self.nbId, rel)   // interceptor miss → base64 fallback
          if (url) img.src = url; else img.alt = '(image)'
        }, { once: true })
        return
      }
      // fallback path: sync base64 (size unknown until decode → re-paginate once it loads)
      img.addEventListener('load', function() {
        self._imgToken = (self._imgToken || 0) + 1   // image sized → invalidate the layout cache
        self._schedulePaginate()                     // coalesced re-measure (one per frame, not per image)
        if (self._pendingBid) self._gotoBlockId(self._pendingBid)   // re-anchor a fresh jump target
        else if (self._pendingImageItem) self._gotoImageItem(self._pendingImageItem)
      })
      const url = batch ? (batch[rel] || '') : Bridge.getNotebookAsset(self.nbId, rel)
      if (url) img.src = url; else img.alt = '(image)'
    })
  },

  // Hold an image for 500 ms → full-screen viewer: as large as fits, with zoom (+ pan when zoomed)
  // and rotate (e.g. view a landscape image rotated to fill the portrait screen).
  openImageViewer(src) {
    const img = document.createElement('img'); img.className = 'iv-img'; img.src = src
    this._openMediaViewer(img, { rotate: true })
  },

  // Tap an oversized table → the SAME full-screen viewer as images: the table is shrunk to fit the page
  // in the flow (never split across pages, never a scrollbar), and tapping opens it at readable size with
  // zoom + pan. Clones the table (unscaled, natural layout) into the viewer.
  openTableViewer(tableEl) {
    const holder = el('div', 'iv-node')
    const clone = tableEl.cloneNode(true)
    clone.style.transform = ''; clone.classList.add('bk-tbl-natural')
    holder.appendChild(clone)
    this._openMediaViewer(holder, { fit: true })
  },

  // Shared media viewer (image or table). Pan is a CSS translate and zoom a CSS scale — NO scrollable
  // container, so the slow e-ink panel never has to paint a scrollbar. Two pointers pinch around their
  // midpoint; one pointer pans while zoomed. [opts.rotate] adds a rotate control (images); [opts.fit]
  // scales a large node down so the whole thing is visible on open (tables).
  _openMediaViewer(node, opts) {
    opts = opts || {}
    const ov = el('div', 'iv-overlay'); const pan = el('div', 'iv-pan')
    pan.appendChild(node); ov.appendChild(pan)
    let rot = 0, z = 1, tx = 0, ty = 0, minZ = 1
    const apply = function() {
      if (opts.rotate) node.classList.toggle('rot', rot === 90 || rot === 270)
      node.style.transformOrigin = 'center'
      node.style.transform = 'rotate(' + rot + 'deg) scale(' + z + ')'
      pan.style.transform = 'translate(' + tx + 'px,' + ty + 'px)'
    }
    const bar = el('div', 'iv-bar')
    const mk = function(label, fn) { const b = el('button', 'rd-btn iv-btn', label); b.addEventListener('click', function(e) { e.stopPropagation(); fn() }); return b }
    bar.appendChild(mk('－', function() { z = Math.max(minZ, z / 1.4); if (z === minZ) { tx = 0; ty = 0 } apply() }))
    bar.appendChild(mk('＋', function() { z = Math.min(minZ * 8, z * 1.4); apply() }))
    if (opts.rotate) bar.appendChild(mk('⟳', function() { rot = (rot + 90) % 360; apply() }))
    bar.appendChild(mk('✕', function() { ov.remove() }))
    ov.appendChild(bar)
    // Pointer Events give Android WebView one path for both finger gestures and mouse/pen preview.
    // Keep every active pointer so a second finger can turn an in-progress pan into a pinch cleanly.
    const points = {}; let dragging = false, lx = 0, ly = 0, pinch = null
    const ids = function() { return Object.keys(points) }
    const beginPinch = function() {
      const active = ids(); if (active.length < 2) { pinch = null; return }
      const a = points[active[0]], b = points[active[1]], r = ov.getBoundingClientRect()
      pinch = {
        ids: [active[0], active[1]], z: z, tx: tx, ty: ty,
        dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2
      }
      dragging = false
    }
    node.addEventListener('pointerdown', function(e) {
      points[e.pointerId] = { x: e.clientX, y: e.clientY }
      try { node.setPointerCapture(e.pointerId) } catch (x) {}
      if (ids().length >= 2) beginPinch()
      else if (z > minZ) { dragging = true; lx = e.clientX; ly = e.clientY }
      e.preventDefault(); e.stopPropagation()
    })
    node.addEventListener('pointermove', function(e) {
      if (!points[e.pointerId]) return
      points[e.pointerId] = { x: e.clientX, y: e.clientY }
      const active = ids()
      if (active.length >= 2) {
        if (!pinch || !points[pinch.ids[0]] || !points[pinch.ids[1]]) beginPinch()
        const a = points[pinch.ids[0]], b = points[pinch.ids[1]]
        const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const nextZ = Math.max(minZ, Math.min(minZ * 8, pinch.z * dist / pinch.dist))
        if (nextZ <= minZ) { z = minZ; tx = 0; ty = 0 }
        else {
          // Preserve the point originally beneath the pinch midpoint while the midpoint itself moves.
          const ratio = nextZ / pinch.z
          tx = mx - pinch.cx - ratio * (pinch.mx - pinch.cx - pinch.tx)
          ty = my - pinch.cy - ratio * (pinch.my - pinch.cy - pinch.ty)
          z = nextZ
        }
        apply(); e.preventDefault(); e.stopPropagation(); return
      }
      if (dragging && z > minZ) {
        tx += e.clientX - lx; ty += e.clientY - ly; lx = e.clientX; ly = e.clientY
        apply(); e.preventDefault(); e.stopPropagation()
      }
    })
    const end = function(e) {
      delete points[e.pointerId]; pinch = null
      const active = ids()
      if (active.length >= 2) beginPinch()
      else if (active.length === 1 && z > minZ) {
        const p = points[active[0]]; dragging = true; lx = p.x; ly = p.y
      } else dragging = false
      e.stopPropagation()
    }
    node.addEventListener('pointerup', end); node.addEventListener('pointercancel', end)
    node.addEventListener('click', function(e) { e.stopPropagation() })
    ov.addEventListener('click', function() { ov.remove() })   // tap the backdrop to close
    this.view().appendChild(ov)
    if (opts.fit) {
      requestAnimationFrame(function() {
        const r = node.getBoundingClientRect()
        const fit = Math.min(1, (window.innerWidth * 0.96) / (r.width || 1), (window.innerHeight * 0.86) / (r.height || 1))
        if (fit < 1) { minZ = fit; z = fit }
        apply()
      })
    } else apply()
  },

  // Shrink any table that would overflow its page column so the WHOLE table fits (no split, no scroll),
  // and mark it tap-to-zoom. Runs when the column geometry or font changes (keyed), not every page turn.
  fitTables(availW, availH) {
    if (!this._flow) return false
    const self = this
    let changed = false
    const boxes = this._flow.querySelectorAll('.bk-tblbox')
    Array.prototype.forEach.call(boxes, function(box) {
      const t = box.querySelector('table'); if (!t) return
      const wasZoom = box.classList.contains('bk-tbl-zoom')
      // First try the normal WRAPPED layout (fixed columns, word-break) and measure its height. Most
      // tables wrap to fit the column — those stay as ordinary tables (no shrink, no zoom). Only a table
      // still too TALL when wrapped (too many rows, or so many columns that wrapping overflows) is
      // switched to its natural proportions and scaled down to fit, becoming tap-to-zoom.
      t.style.transform = ''; box.style.width = ''; box.style.height = ''
      t.classList.remove('bk-tbl-natural'); box.classList.remove('bk-tbl-zoom')
      if (t.offsetHeight <= availH) {
        if (wasZoom) changed = true                      // a format/geometry change removed an old scale
        return                                           // wraps to fit → leave as a normal table
      }
      t.classList.add('bk-tbl-natural')                  // render at source proportions, then scale it
      const tw = t.offsetWidth, th = t.offsetHeight
      const s = Math.max(0.05, Math.min(availW * 0.98 / tw, availH * 0.98 / th))
      t.style.transformOrigin = 'top left'
      t.style.transform = 'scale(' + s + ')'
      box.style.width = Math.ceil(tw * s) + 'px'
      box.style.height = Math.ceil(th * s) + 'px'
      box.classList.add('bk-tbl-zoom')
      changed = true
      if (!box._zoomWired) {
        box._zoomWired = true
        box.addEventListener('click', function(e) { e.stopPropagation(); self.openTableViewer(box.querySelector('table')) })
      }
    })
    return changed
  },

  // upgrade <kal-mcq>/<kal-anim>/<kal-ink>/<kal-hotspots>/<kal-pintail>/<kal-callout>/<kal-flashcard>
  // custom tags to widgets
  upgrade(root) {
    const self = this
    Array.prototype.forEach.call(root.querySelectorAll('kal-mcq'), function(elm) { self.upgradeMcq(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-anim'), function(elm) { self.upgradeAnim(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-ink'), function(elm) { self.upgradeInk(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-hotspots'), function(elm) { self.upgradeHotspots(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-pintail'), function(elm) { self.upgradePintail(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-callout'), function(elm) { self.upgradeCallout(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-flashcard'), function(elm) { self.upgradeFlashcard(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-checklist'), function(elm) { self.upgradeChecklist(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-cloze'), function(elm) { self.upgradeCloze(elm) })
    Array.prototype.forEach.call(root.querySelectorAll('kal-inline-checkpoint'), function(elm) {
      self.upgradeInlineCheckpoint(elm)
    })
  },

  // Source-authored commit-then-reveal checkpoint. The immutable prompt and discussion are emitted
  // by the package compiler; only the learner's note and reveal state live in mutable sidecar data.
  upgradeInlineCheckpoint(elm) {
    const self = this
    const checkpointId = elm.getAttribute('data-id') || ''
    if (!checkpointId) return
    const file = 'sidecar/inline-checkpoints/' + checkpointId + '.json'
    let state = {}
    try { state = JSON.parse(Bridge.getBookFile(this.nbId, file) || '{}') || {} } catch (e) { state = {} }
    const note = elm.querySelector('.bk-checkpoint-note')
    const answer = elm.querySelector('.bk-checkpoint-answer')
    const button = elm.querySelector('.bk-checkpoint-reveal')
    if (!note || !answer || !button) return
    note.value = typeof state.note === 'string' ? state.note : ''
    let revealed = state.revealed === true
    const save = function() {
      Bridge.saveBookFile(self.nbId, file, JSON.stringify({ version: 1, note: note.value,
        revealed: revealed }))
    }
    const sync = function(repaginate) {
      answer.hidden = !revealed
      button.textContent = revealed ? 'Hide source discussion' : 'Reveal source discussion'
      button.setAttribute('aria-expanded', revealed ? 'true' : 'false')
      elm.classList.toggle('is-revealed', revealed)
      if (repaginate) {
        self._lastPgSig = null
        self.paginate()
      }
    }
    note.addEventListener('input', save)
    ;[note, button].forEach(function(control) {
      control.addEventListener('pointerdown', function(event) { event.stopPropagation() })
      control.addEventListener('pointerup', function(event) { event.stopPropagation() })
    })
    button.addEventListener('click', function(event) {
      event.preventDefault(); event.stopPropagation()
      revealed = !revealed; save(); sync(true)
    })
    elm.addEventListener('kalamos-reveal-source', function() {
      if (revealed) return
      revealed = true; save(); sync(false)
    })
    sync(false)
  },

  // <kal-checklist id title?><kal-item id>md</kal-item>…</kal-checklist> — checked state persists in
  // sidecar/checklist/<sectionId>-<listId>.json (same mutable-sidecar path as highlights/notes).
  upgradeChecklist(elm) {
    const self = this
    const listId = elm.getAttribute('id') || 'cl'
    const file = 'sidecar/checklist/' + this.sectionId() + '-' + listId + '.json'
    let state = {}
    try { state = JSON.parse(Bridge.getBookFile(this.nbId, file) || '{}') || {} } catch (e) { state = {} }
    const items = Array.prototype.map.call(elm.querySelectorAll('kal-item'), function(it, i) {
      const id = it.getAttribute('id') || String(i + 1)
      return { id: id, md: it.textContent || '', done: !!state[id] }
    })
    elm.replaceWith(buildChecklist({ title: elm.getAttribute('title') || '', items: items },
      function(item, done) {
        if (done) state[item.id] = true; else delete state[item.id]
        Bridge.saveBookFile(self.nbId, file, JSON.stringify(state))
      }))
  },

  // <kal-cloze>text with {{hidden}} blanks</kal-cloze> — ephemeral tap-to-reveal.
  upgradeCloze(elm) {
    elm.replaceWith(buildCloze({ md: elm.textContent || '' }))
  },

  // <kal-callout variant="note|tip|warning|quote" title?>markdown text</kal-callout>
  upgradeCallout(elm) {
    elm.replaceWith(buildCallout({
      variant: elm.getAttribute('variant') || 'note',
      title: elm.getAttribute('title') || '',
      md: elm.textContent || ''
    }))
  },

  // <kal-flashcard><kal-front>md</kal-front><kal-back>md</kal-back></kal-flashcard>
  upgradeFlashcard(elm) {
    const self = this
    elm.replaceWith(buildFlashcard({
      front: (elm.querySelector('kal-front') || {}).textContent || '',
      back: (elm.querySelector('kal-back') || {}).textContent || ''
    }, false, function() { self.paginate() }))
  },

  // <kal-pintail src prompt target="x1 y1 x2 y2" caption> — tap-to-place pin checked against the region.
  upgradePintail(elm) {
    const self = this
    const t = (elm.getAttribute('target') || '').split(/\s+/).map(parseFloat)
    const spec = {
      src: elm.getAttribute('src'),
      prompt: elm.getAttribute('prompt') || '',
      caption: elm.getAttribute('caption') || '',
      alt: elm.getAttribute('alt') || '',
      target: (t.length === 4 && t.every(function(n) { return !isNaN(n) })) ? t : [0, 0, 1, 1]
    }
    elm.replaceWith(buildPintail(spec,
      function(src) { return Bridge.getNotebookAsset(self.nbId, src) },
      function() { self.paginate() }))
  },

  // <kal-hotspots src="assets/x.png" alt caption> with <kal-spot x y label>text</kal-spot> children.
  upgradeHotspots(elm) {
    const self = this
    const spec = {
      src: elm.getAttribute('src'),
      alt: elm.getAttribute('alt') || '',
      caption: elm.getAttribute('caption') || '',
      spots: Array.prototype.map.call(elm.querySelectorAll('kal-spot'), function(s) {
        return {
          x: parseFloat(s.getAttribute('x')) || 0,
          y: parseFloat(s.getAttribute('y')) || 0,
          label: s.getAttribute('label'),
          md: s.textContent || ''
        }
      })
    }
    elm.replaceWith(buildHotspots(spec, function(src) { return Bridge.getNotebookAsset(self.nbId, src) }))
  },

  upgradeMcq(elm) {
    const prompt = (elm.querySelector('kal-prompt') || {}).textContent || ''
    const multi = elm.getAttribute('multi') === 'true'
    const answer = (elm.getAttribute('answer') || '').split(/\s+/).filter(Boolean)
    const explain = (elm.querySelector('kal-explain') || {}).textContent || ''
    const choices = Array.prototype.map.call(elm.querySelectorAll('kal-choice'), function(c) {
      return { id: c.getAttribute('id'), text: c.textContent }
    })
    const box = el('div', 'rd-mcq')
    box.appendChild(el('div', 'rd-mcq-q', prompt))
    const list = el('div', 'rd-choices')
    const sel = []
    const sync = function() {
      Array.prototype.forEach.call(list.children, function(ch) { ch._sync && ch._sync() })
    }
    let revealed = false
    choices.forEach(function(c, i) {
      const b = el('button', 'rd-choice', 'ABCDEFGH'[i] + '. ' + c.text)
      b._sync = function() {
        b.classList.toggle('sel', sel.indexOf(c.id) !== -1)
        if (revealed) { const ok = answer.indexOf(c.id) !== -1; b.classList.toggle('correct', ok); b.classList.toggle('wrong', !ok && sel.indexOf(c.id) !== -1) }
      }
      b.addEventListener('click', function() {
        if (revealed) return
        if (multi) { const k = sel.indexOf(c.id); if (k === -1) sel.push(c.id); else sel.splice(k, 1) }
        else { sel.length = 0; sel.push(c.id) }
        sync()
      })
      b._sync(); list.appendChild(b)
    })
    box.appendChild(list)
    const check = el('button', 'rd-btn rd-check', 'Check')
    const exp = el('div', 'rd-explain')
    check.addEventListener('click', function() {
      if (!sel.length) { Bridge.showToast('Pick an answer'); return }
      revealed = true; sync()
      const ok = answer.length === sel.length && answer.every(function(a) { return sel.indexOf(a) !== -1 })
      exp.innerHTML = '<b>' + (ok ? '✓ Correct.' : '✗ Not quite.') + '</b> ' + explain
      exp.classList.add('show'); check.disabled = true
    })
    const foot = el('div', 'rd-mcq-foot'); foot.appendChild(check); box.appendChild(foot); box.appendChild(exp)
    elm.replaceWith(box)
  },

  upgradeAnim(elm) {
    const wrap = el('div', 'rd-anim')
    const stage = el('div', 'rd-anim-stage'); stage.innerHTML = (elm.getAttribute('kind') === 'breath') ? LUNGS_SVG : ''
    wrap.appendChild(stage)
    const cap = elm.getAttribute('caption'); if (cap) wrap.appendChild(el('div', 'rd-caption', cap))
    const play = el('button', 'rd-btn', '▶ Play'); let on = false
    play.addEventListener('click', function() { on = !on; stage.classList.toggle('playing', on); play.textContent = on ? '❚❚ Pause' : '▶ Play' })
    const ctrl = el('div', 'rd-anim-ctrl'); ctrl.appendChild(play); wrap.appendChild(ctrl)
    elm.replaceWith(wrap)
  },

  // inline pen-input box: an in-flow outlined area. When the reader reaches the column it's on, the
  // daemon attaches to it (draw directly in the outline); pen-away detaches. Strokes → a sidecar file.
  upgradeInk(elm) {
    const id = elm.getAttribute('id'); const h = parseInt(elm.getAttribute('height') || '300', 10)
    const wrap = el('div', 'rd-draw')
    if (elm.getAttribute('label')) wrap.appendChild(el('div', 'rd-draw-label', elm.getAttribute('label')))
    const box = el('div', 'bk-ink'); box.style.height = h + 'px'
    box.dataset.file = 'sidecar/ink/' + this.sectionId() + '-' + id + '.json'
    box.appendChild(el('span', 'bk-ink-hint', '✎ draw here'))
    wrap.appendChild(box)
    elm.replaceWith(wrap)
  },

  // Attach/detach the daemon to an inline <kal-ink> box as it scrolls into / out of the current page.
  updateInlineInk() {
    if (!this._flow || this._inkWrap) return   // (a sticky-note modal owns the surface — skip)
    const cr = this._content.getBoundingClientRect()
    let visible = null
    Array.prototype.forEach.call(this._flow.querySelectorAll('.bk-ink'), function(b) {
      const r = b.getBoundingClientRect()
      if (r.width > 10 && r.left < cr.right - 30 && r.right > cr.left + 30) visible = b
    })
    if (visible) { if (!this._ink || this._ink.el !== visible) this.openInlineInk(visible) }
    else if (this._ink && this._ink.inline) this.closeInkBox()
  },

  openInlineInk(box) {
    const self = this
    let strokes = []
    try { const j = JSON.parse(Bridge.getBookFile(this.nbId, box.dataset.file) || '{}'); if (Array.isArray(j.strokes) && (!j.strokes.length || Array.isArray(j.strokes[0]))) strokes = j.strokes } catch (e) {}
    this._ink = { el: box, file: box.dataset.file, anchor: null, strokes: strokes, inline: true, full: false }
    this._inkBox = box; this._inkWrap = null
    requestAnimationFrame(function() { self.attachNoteBox() })
  },

  savePosition() {
    try {
      const raw = Bridge.getBookFile(this.nbId, 'meta.json'); const m = JSON.parse(raw)
      m.position = { sectionId: this.sectionId(), page: this.page }
      if (window.NativePages && NativePages.activeId(this)) m.position.nativePageId = NativePages.activeId(this)
      Bridge.saveBookFile(this.nbId, 'meta.json', JSON.stringify(m))
    } catch (e) {}
  },

  // ---- sidecar highlights + note markers (anchored to section char ranges) ----
  // [files] is renderSection's batched read (may hold this section's sidecars); falls back to
  // per-file bridge reads when absent.
  loadSidecar(sid, files) {
    const hlPath = 'sidecar/highlights/' + sid + '.json'
    const notesPath = 'sidecar/notes/' + sid + '/index.json'
    const hlRaw = (files && files[hlPath]) || Bridge.getBookFile(this.nbId, hlPath)
    const nRaw = (files && files[notesPath]) || Bridge.getBookFile(this.nbId, notesPath)
    try { this.hl[sid] = JSON.parse(hlRaw || '[]') } catch (e) { this.hl[sid] = [] }
    try { this.noteIdx[sid] = JSON.parse(nRaw || '[]') } catch (e) { this.noteIdx[sid] = [] }
  },
  _saveSidecarSectionIndex(kind, sid, hasItems) {
    const path = 'sidecar/' + kind + '/_sections.json'; let arr = []
    try { arr = JSON.parse(Bridge.getBookFile(this.nbId, path) || '[]') } catch (e) { arr = [] }
    if (!Array.isArray(arr)) arr = []
    const at = arr.indexOf(sid)
    if (hasItems && at === -1) arr.push(sid)
    else if (!hasItems && at !== -1) arr.splice(at, 1)
    Bridge.saveBookFile(this.nbId, path, JSON.stringify(arr))
  },
  saveHighlights(sid) {
    if (window.BooxAnnotations && BooxAnnotations.invalidate) BooxAnnotations.invalidate(this)
    else this._bxAnnotationsCache = null
    const arr = this.hl[sid] || []
    Bridge.saveBookFile(this.nbId, 'sidecar/highlights/' + sid + '.json', JSON.stringify(arr))
    this._saveSidecarSectionIndex('highlights', sid, !!arr.length)
  },
  saveNoteIndex(sid) {
    const arr = this.noteIdx[sid] || []
    Bridge.saveBookFile(this.nbId, 'sidecar/notes/' + sid + '/index.json', JSON.stringify(arr))
    this._saveSidecarSectionIndex('notes', sid, !!arr.length)
  },

  applyHighlights() {
    if (!this.hlLayer || !this._flow) return
    this.hlLayer.innerHTML = ''
    const self = this, sid = this.sectionId()
    ;(this.hl[sid] || []).forEach(function(h) {
      const range = rangeForOffsets(self._flow, h.start, h.end); if (!range) return
      const bb = drawRangeInto(self.hlLayer, range, 'rd-hl')
      const note = (self.noteIdx[sid] || []).find(function(n) { return n.anchor.start === h.start && n.anchor.end === h.end })
      if (note && bb) {
        const icon = el('span', 'rd-note-icon')
        icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="#000"/></svg>'
        icon.style.left = (bb.r - 10) + 'px'; icon.style.top = (bb.b - 10) + 'px'
        icon.addEventListener('click', function() { self.openNote(note) })
        self.hlLayer.appendChild(icon)
      }
    })
    // WP11: transient search-jump locator (cleared by nextPage/prevPage below) — drawn last so it
    // never hides behind a real highlight's box outline.
    if (this._searchMark && this._searchMark.sectionId === sid) {
      const range = rangeForOffsets(this._flow, this._searchMark.start, this._searchMark.end)
      if (range) drawRangeInto(this.hlLayer, range, 'rd-search-hit')
    }
  },

  locate(range) {
    const a = offsetWithin(this._flow, range.startContainer, range.startOffset)
    const b = this._flow.contains(range.endContainer) ? offsetWithin(this._flow, range.endContainer, range.endOffset) : this._flow.textContent.length
    return { start: Math.min(a, b), end: Math.max(a, b) }
  },

  // Pen drag highlights immediately. Finger highlighting requires a 400 ms hold, so the ordinary
  // quick taps used for page turns never flash a transient word selection.
  wireSelection(flow) {
    const self = this
    let startCaret = null, moved = false, sx = 0, sy = 0, activation = null, down = false
    const highlightHold = ReaderHighlightLongPress(function(x, y) {
      const h = self.hitHighlight(x, y)
      if (h == null) return
      startCaret = null
      self.clearSelOverlay()
      self.openHighlightNoteOrMenu(h, x, y)
    })
    const upd = function(x, y) { const end = caretRange(x, y); if (!startCaret || !end) return; const r = snapRangeToWords(orderedRange(startCaret, end) || collapsedRange(startCaret)); if (r) { self._sel = r; self.clearSelOverlay(); drawRangeInto(self.selLayer, r, 'rd-sel') } }
    const activate = function(x, y) {
      if (!down) return
      startCaret = caretRange(x, y)
      self._sel = null
      upd(x, y)
    }
    flow.addEventListener('pointerdown', function(e) {
      if (!isHighlightPointer(e)) return
      if (e.target && e.target.tagName === 'IMG') return   // image taps open the viewer, not a selection
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
  clearSelOverlay() { if (this.selLayer) this.selLayer.innerHTML = '' },

  hitHighlight(x, y) {
    const r = caretRange(x, y); if (!r) return null
    const off = offsetWithin(this._flow, r.startContainer, r.startOffset); const sid = this.sectionId()
    const arr = this.hl[sid] || []
    for (let i = 0; i < arr.length; i++) if (off >= arr[i].start && off <= arr[i].end) return i
    return null
  },

  showPopup(range) {
    this.hidePopup(); const self = this; const loc = this.locate(range)
    const rects = range.getClientRects(); const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect()
    const pop = el('div', 'rd-pop')
    const ref = pageRefFromSelection(range.toString())
    const target = ref ? this.resolvePrintedPage(ref.page) : null
    if (target) {
      const go = el('button', 'rd-pop-btn', '↪ p.' + ref.page)
      ReaderBookLink.wire(go, function() {
        self.hidePopup()
        self.jumpTo(target.sectionId, target.blockId || null)
      })
      pop.appendChild(go)
    }
    const hi = el('button', 'rd-pop-btn', '✎ Highlight'); hi.addEventListener('click', function() { self.addHighlight(loc, false) })
    const st = el('button', 'rd-pop-btn', '🗒 Sticky note'); st.addEventListener('click', function() { self.addHighlight(loc, true) })
    const cx = el('button', 'rd-pop-btn', '✕'); cx.addEventListener('click', function() { self.hidePopup() })
    pop.appendChild(hi); pop.appendChild(st); pop.appendChild(cx); this.view().appendChild(pop)
    pop.style.top = Math.max(8, rect.top - 50) + 'px'; pop.style.left = Math.min(Math.max(8, rect.left), window.innerWidth - 300) + 'px'; this._pop = pop
  },
  hidePopup() { if (this._pop) { this._pop.remove(); this._pop = null } this.clearSelOverlay() },

  resolvePrintedPage(pageNo) {
    const spine = (this.manifest && this.manifest.spine) || []
    const pageMap = (this.manifest && this.manifest.pageMap) || null
    const wanted = String(pageNo)
    for (let i = 0; i < spine.length; i++) {
      const sid = spine[i].sectionId
      const rawJson = (this._secCache && this._secCache[sid]) || Bridge.getBookFile(this.nbId, 'sections/' + sid + '.json')
      let blocks = null
      if (rawJson) { try { blocks = JSON.parse(rawJson).blocks } catch (e) { blocks = null } }
      if (Array.isArray(blocks)) {
        for (let j = 0; j < blocks.length; j++) {
          const scan = blocks[j].page
          if (scan == null) continue
          const printed = pageMap && pageMap[scan] != null ? pageMap[scan] : scan
          if (String(printed) === wanted) return { sectionId: sid, blockId: blocks[j].id || null }
        }
        continue
      }
      const html = Bridge.getBookFile(this.nbId, 'sections/' + sid + '.html') || ''
      if (!html) continue
      const tmp = document.createElement('div'); tmp.innerHTML = html
      const nodes = tmp.querySelectorAll('[data-page]')
      for (let k = 0; k < nodes.length; k++) {
        const scan = nodes[k].getAttribute('data-page')
        const printed = pageMap && pageMap[scan] != null ? pageMap[scan] : scan
        if (String(printed) === wanted) return { sectionId: sid, blockId: nodes[k].getAttribute('data-bid') || null }
      }
    }
    return null
  },

  addHighlight(loc, withNote) {
    const sid = this.sectionId(); if (!this.hl[sid]) this.hl[sid] = []
    for (let i = 0; i < this.hl[sid].length; i++) if (loc.start < this.hl[sid][i].end && this.hl[sid][i].start < loc.end) { this.hidePopup(); Bridge.showToast('Already highlighted'); return }
    this.hl[sid].push({ sectionId: sid, start: loc.start, end: loc.end, color: 'yellow' })
    this.saveHighlights(sid); this.hidePopup(); this.applyHighlights()
    if (withNote) this.addNote(loc)
  },

  // A deliberate 800 ms hold is the direct route back into an existing sticky note. Highlights
  // without a note retain the edit menu so the same gesture can add one or delete the highlight.
  openHighlightNoteOrMenu(idx, x, y) {
    const sid = this.sectionId(), h = (this.hl[sid] || [])[idx]
    if (!h) return
    const note = (this.noteIdx[sid] || []).find(function(n) {
      return n.anchor && n.anchor.start === h.start && n.anchor.end === h.end
    })
    if (note) { this.hidePopup(); this.openNote(note); return }
    this.showHlMenu(idx, x, y)
  },

  showHlMenu(idx, x, y) {
    this.hidePopup(); const self = this; const sid = this.sectionId(); const h = this.hl[sid][idx]
    const note = (this.noteIdx[sid] || []).find(function(n) { return n.anchor.start === h.start && n.anchor.end === h.end })
    const pop = el('div', 'rd-pop')
    if (note) { const ed = el('button', 'rd-pop-btn', '✎ Edit note'); ed.addEventListener('click', function() { self.hidePopup(); self.openNote(note) }); pop.appendChild(ed) }
    else { const ad = el('button', 'rd-pop-btn', '🗒 Add sticky note'); ad.addEventListener('click', function() { self.hidePopup(); self.addNote({ start: h.start, end: h.end }) }); pop.appendChild(ad) }
    const del = el('button', 'rd-pop-btn', '🗑 Delete'); del.addEventListener('click', function() { self.hl[sid].splice(idx, 1); self.saveHighlights(sid); self.hidePopup(); self.applyHighlights() })
    const cx = el('button', 'rd-pop-btn', '✕'); cx.addEventListener('click', function() { self.hidePopup() })
    pop.appendChild(del); pop.appendChild(cx); this.view().appendChild(pop)
    pop.style.top = Math.max(8, y - 52) + 'px'; pop.style.left = Math.min(Math.max(8, x - 40), window.innerWidth - 320) + 'px'; this._pop = pop
  },

  addNote(loc) {
    const sid = this.sectionId(); if (!this.noteIdx[sid]) this.noteIdx[sid] = []
    const noteId = 'n' + Date.now().toString(36)
    const anchor = { sectionId: sid, start: loc.start, end: loc.end }
    const quote = ((this._flow && this._flow.textContent) || '').slice(loc.start, loc.end).trim()
    this.noteIdx[sid].push({ noteId: noteId, anchor: anchor, quote: quote, hasPreview: false }); this.saveNoteIndex(sid)
    Bridge.saveBookFile(this.nbId, 'sidecar/notes/' + sid + '/' + noteId + '.json', JSON.stringify({ anchor: anchor, quote: quote, strokes: [] }))
    this.applyHighlights()
    this.openInkBox({ file: 'sidecar/notes/' + sid + '/' + noteId + '.json', anchor: anchor, quote: quote })
  },
  openNote(note) {
    this.openInkBox({ file: 'sidecar/notes/' + this.sectionId() + '/' + note.noteId + '.json', anchor: note.anchor, quote: note.quote || '' })
  },

  // ---- daemon ink box (sticky note / kal-ink), reusing the shared box machinery ----
  openInkBox(target) {
    if (this._ink || this._inkWrap || this._inkClosing) {
      this._pendingInkTarget = target
      this.closeInkBox()
      return
    }
    this._pendingInkTarget = null
    const self = this
    let strokes = []
    try { const j = JSON.parse(Bridge.getBookFile(this.nbId, target.file) || '{}'); if (Array.isArray(j.strokes) && (!j.strokes.length || Array.isArray(j.strokes[0]))) strokes = j.strokes } catch (e) {}
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
    if (!this._ink.inline && window.BooxHandCatalog) BooxHandCatalog.upsert(this, { id: this._ink.file,
      file: this._ink.file, kind: 'sticky', format: 'book', loc: this._ink.anchor || {},
      quote: this._ink.quote || '', strokes: BooxInkCompact(this._ink.strokes) })
  } },
  closeInkBox() {
    const had = !!this._ink || !!this._inkWrap
    if (this._inkWrap) { this._inkWrap.remove(); this._inkWrap = null }
    this._inkBox = null
    if (had && !this._inkClosing) {
      this._inkClosing = true
      Bridge.detachInkBox()   // flush → onNoteFlushed → finalizeNote (saves + clears _ink)
    }
  },
  finalizeNote() {
    this.saveInk(); this._ink = null; this._inkClosing = false; window._noteSketch = null; window._inkHandler = null
    // a note may have just gained its first strokes → refresh markers
    this.applyHighlights()
    if (this._pendingInkTarget) {
      const next = this._pendingInkTarget; this._pendingInkTarget = null
      const self = this; requestAnimationFrame(function() { self.openInkBox(next) })
    }
  }
}

// WP11: which block (data-bid) a character offset within a (possibly detached) rendered section
// root falls inside — reuses the generic rangeForOffsets utility (reader-controller.js), which works
// on any node tree regardless of whether it's attached to the visible document.
function bkFindBidAtOffset(root, pos) {
  const r = rangeForOffsets(root, pos, pos + 1)
  if (!r) return null
  let node = r.startContainer
  if (node.nodeType !== 1) node = node.parentElement
  const blk = node && node.closest ? node.closest('.bk-blk[data-bid]') : null
  return blk ? blk.getAttribute('data-bid') : null
}

// Prefix every rule selector with [scope] (mapping bare `body` → the scope) so the book's stylesheet
// applies only inside the section flow, never to the surrounding app chrome.
function scopeBookCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return css.replace(/([^{}]+)\{/g, function(m, sel) {
    return sel.split(',').map(function(s) {
      s = s.trim(); if (!s) return s
      return s === 'body' ? scope : scope + ' ' + s
    }).join(',') + '{'
  })
}

// ---- typed-block JSON → HTML (the device IS the renderer; book files carry only ordered content) ----
// Reuses the book reader's existing image/widget/math upgrades (resolveImages, upgrade*, renderMath run
// after this). Each block is wrapped with its stable id (data-bid) so a later AI-enrichment pass + audit
// can anchor edits to exact positions. Mirrors BookConverter/webview/app.js block handling.
function semanticFreshPageIds(toc, manifest, sectionId, blocks) {
  const extracted = toc && Array.isArray(toc.entries) ? toc.entries : []
  const fallback = manifest && Array.isArray(manifest.toc) ? manifest.toc : []
  const entries = extracted.length ? extracted : fallback
  const requested = new Set(entries.filter(function(row) {
    return row && row.startOnFreshPage === true && String(row.sectionId || '') === String(sectionId || '')
  }).map(function(row) { return String(row.targetBlockId || '') }).filter(Boolean))
  const result = new Set()
  ;(blocks || []).forEach(function(block, index) {
    if (!block || !requested.has(String(block.id || ''))) return
    const previous = index > 0 ? blocks[index - 1] : null
    const evidence = block.structureEvidence || {}
    const previousEvidence = previous && previous.structureEvidence || {}
    // A source crop explicitly associated with this block belongs to the same semantic opening.
    // Put the fresh-page break on the crop so pagination cannot strand it immediately before target.
    if (previous && previous.type === 'image' &&
        previousEvidence.imageAssociationTargetId === evidence.nodeId) {
      result.add(String(previous.id || ''))
    // A standalone printed chapter number belongs with the following semantic title. Break before
    // the number so both open on the new page, while the TOC still targets the meaningful title.
    } else if (previous && previous.type === 'text' && /^#{1,6}\s+\d+\s*$/.test(String(previous.md || '').trim())) {
      result.add(String(previous.id || ''))
    } else result.add(String(block.id || ''))
  })
  return result
}

function bookTextMarkdown(block) {
  const raw = String(block && block.md || '')
  if (!/^#{1,6}\s+/.test(raw) || raw.length > 240 || /\n\s*\n/.test(raw)) return raw
  const lines = raw.split('\n')
  if (lines.length < 2 || lines.slice(1).some(function(line) {
    return !line.trim() || /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(line)
  })) return raw
  // PDF title extractors commonly preserve visual line wrapping inside one heading block. Markdown
  // otherwise demotes every continuation line to body text. Joining with spaces preserves every
  // source word while rendering the complete extracted block at its intended heading level.
  return lines.map(function(line) { return line.trim() }).join(' ')
}

function markdownFootnotes(source, supplied) {
  const lines = String(source || '').split('\n')
  const body = [], notes = Object.assign({}, supplied || {})
  for (let index = 0; index < lines.length;) {
    const match = lines[index].match(/^\[\^([A-Za-z0-9_.:-]{1,80})\]:\s*(.*)$/)
    if (!match) { body.push(lines[index++]); continue }
    const content = [match[2]]
    index++
    while (index < lines.length) {
      if (/^(?: {4}|\t)/.test(lines[index])) {
        content.push(lines[index].replace(/^(?: {4}|\t)/, '')); index++
      } else if (!lines[index].trim() && index + 1 < lines.length && /^(?: {4}|\t)/.test(lines[index + 1])) {
        content.push(''); index++
      } else break
    }
    if (!Object.prototype.hasOwnProperty.call(notes, match[1])) notes[match[1]] = content.join('\n').trim()
  }
  return { source: body.join('\n'), notes: notes }
}

function richMarkdownBlock(block) {
  if (!window.KalamosRichContent) return miniMarkdown(bookTextMarkdown(block))
  const extracted = markdownFootnotes(String(block && block.md || ''),
    block && block.footnotes && typeof block.footnotes === 'object' ? block.footnotes : {})
  let source = extracted.source
  const notes = extracted.notes
  const ids = []
  source = source.replace(/\[\^([A-Za-z0-9_.:-]{1,80})\]/g, function(match, id) {
    if (!Object.prototype.hasOwnProperty.call(notes, id)) return match
    if (ids.indexOf(id) < 0) ids.push(id)
    return 'KALAMOSFOOTNOTEREF' + ids.indexOf(id) + 'TOKEN'
  })
  let html = KalamosRichContent.markdown(source)
  ids.forEach(function(id, index) {
    const label = String(index + 1)
    const marker = '<sup class="bk-md-footnote-mark"><button type="button" class="bk-md-footnote-ref"' +
      ' data-footnote="' + escapeHtml(id) + '" aria-label="Footnote ' + label + '">' + label + '</button></sup>'
    html = html.split('KALAMOSFOOTNOTEREF' + index + 'TOKEN').join(marker)
  })
  const templates = ids.map(function(id) {
    return '<template class="bk-md-footnote" data-footnote="' + escapeHtml(id) + '">' +
      KalamosRichContent.markdown(String(notes[id] || '')) + '</template>'
  }).join('')
  return '<div class="kalamos-markdown bk-rich-markdown">' + html + templates + '</div>'
}

function blocksToHtml(blocks, freshPageIds, richMarkdownDefault) {
  if (!Array.isArray(blocks)) return ''
  freshPageIds = freshPageIds instanceof Set ? freshPageIds : new Set()
  let prevPage = null
  return blocks.map(function(b, bIdx) {
    const bid = b.id ? ' data-bid="' + escapeHtml(String(b.id)) + '"' : ''
    if (b.visualSuppressedBy) {
      return '<span class="bk-source-anchor" aria-hidden="true"' + bid + '></span>'
    }
    // breathing room at a source-page boundary: the original book was typeset/laid out by a human, so we
    // borrow its page cadence — a little space + a faint rule cues the reader they've turned a page.
    const newPage = (b.page != null && prevPage != null && b.page !== prevPage) ? ' bk-newpage' : ''
    if (b.page != null) prevPage = b.page
    let inner = '', atomic = false
    switch (b.type) {
      case 'text':
        if (b.sourceLayoutImage) {
          atomic = true
          inner = '<figure class="bk-fig bk-source-layout"><img src="' +
            escapeHtml(String(b.sourceLayoutImage)) + '" alt="' +
            escapeHtml(String(b.sourceLayoutAlt || 'Source layout')) + '"></figure>'
          break
        }
        if (b.format === 'rich-markdown' || (richMarkdownDefault && b.format !== 'plain' && !b.variant)) {
          inner = richMarkdownBlock(b)
        } else if (b.variant === 'pull') {
          // pull-quote: strip the wrapping <p> so it sits inside a centred .bk-pull block
          var pq = miniMarkdown(b.md || '').replace(/^<p>|<\/p>\s*$/g, '')
          inner = '<div class="bk-pull">' + pq +
                  (b.cite ? '<span class="bk-pull-cite">' + escapeHtml(b.cite) + '</span>' : '') + '</div>'
        } else if (b.variant === 'credit') {
          // source/credit line (e.g. "Source: IGM…") — quiet, small, its own block (never trapped as an
          // image caption). Strips the <p> so .bk-credit controls the measure.
          inner = '<div class="bk-credit">' + miniMarkdown(b.md || '').replace(/^<p>|<\/p>\s*$/g, '') + '</div>'
        } else {
          inner = miniMarkdown(b.format === 'plain' ? escapeHtml(b.md) : bookTextMarkdown(b))
          // chapter opener → drop-cap + small-caps first line (converter sets open:true on the first body
          // paragraph after a chapter title). Only tag the leading <p>.
          if (b.open) inner = inner.replace(/^<p>/, '<p class="bk-open">')
        }
        break
      case 'image':
        atomic = !b.side   // side figures float (non-atomic) so the next block's text wraps beside them
        // Honour the figure's width on the SOURCE page (converter sets relw = box/page fraction), with an
        // absolute-size threshold: a decorative mark that filled 7% of the printed page renders at ~7% of
        // the text column, but anything that claimed a substantial share of the source page (≥30%) is real
        // content — the device is physically smaller than the book, so 0.30..0.98 remaps to 60..100% to
        // stay generously readable while preserving the size hierarchy. Floor 12%; tap-to-zoom covers detail.
        var relw = null
        if (!b.side && typeof b.relw === 'number' && b.relw > 0 && b.relw < 0.98) {
          var pct = b.relw < 0.30 ? Math.max(12, Math.round(b.relw * 100))
                                  : Math.min(100, Math.round(60 + (b.relw - 0.30) / 0.68 * 40))
          if (pct < 98) relw = pct
        }
        // Large captioned figure → on wide viewports the caption sits BESIDE the image (media left,
        // caption right) instead of stacking under it, using the margin space a big screen leaves free.
        // Pure CSS (media query + --figw), so resizing re-lays it out without a re-render. Only for the
        // moderate class (rendered ≤70%): wider figures would squeeze the caption into a sliver.
        var figRow = !!(relw && relw >= 60 && relw <= 70 && b.caption && !b.side &&
                        String(b.caption).length >= 30)
        // NB the width goes on the IMAGE (via --figw), never the whole <figure>: a small figure's
        // caption must set at the column measure, not collapse to the image's width (a 12%-wide mark
        // with a long caption otherwise reads one word per line). The figure stays a full-width centred
        // block; CSS sizes the <img> to --figw and centres it, the caption flows beneath at full measure.
        inner = '<figure class="bk-fig ' + (b.side ? 'bk-fig-side ' : '') + (figRow ? 'bk-fig-row ' : '') +
                'cb-fit-' + (b.fit || 'contain') +
                '"' + (relw ? ' style="--figw:' + relw + '%"' : '') +
                '><img src="' + bkAssetSrc(b.src) + '" alt="' + escapeHtml(b.alt || '') + '">' +
                (b.caption ? '<figcaption class="bk-cap">' + escapeHtml(b.caption) + '</figcaption>' : '') + '</figure>'
        break
      case 'math':
        // One element holding the whole LaTeX (delimiters added here) so renderMath/KaTeX renders it as a
        // unit — NEVER through miniMarkdown, which would split a multi-line formula into separate <p>.
        if (b.display) { atomic = true; inner = '<div class="bk-math">\\[' + escapeHtml(b.tex || '') + '\\]</div>' }
        else { inner = '<span class="bk-imath">\\(' + escapeHtml(b.tex || '') + '\\)</span>' }
        break
      case 'table':
        // wrapped in a sizing box so an oversized table can be scaled to fit the page (fitTables) and
        // become tap-to-zoom, instead of overflowing/clipping or needing a scrollbar.
        atomic = true; inner = '<div class="bk-tblbox">' + bkTableToHtml(b.content || '') + '</div>'; break
      case 'contents':
        // printed table of contents → tappable rows (the converter resolved each entry's printed page
        // number to a sectionId + target block; BookReader.wireContents attaches the jumps). NOT
        // atomic: a long contents page must flow across columns like any other text.
        inner = '<div class="bk-contents">' + (b.items || []).map(function(it) {
          const linked = it.sectionId
            ? ' data-sec="' + escapeHtml(it.sectionId) + '"' +
              (it.targetBlockId ? ' data-bid="' + escapeHtml(String(it.targetBlockId)) + '"' : '')
            : ''
          return '<a class="bk-toc-row' + (it.h ? ' bk-toc-h' : '') + '"' + linked + '>' +
                 '<span class="bk-toc-t">' + escapeHtml(it.md || '') + '</span>' +
                 (it.page ? '<i class="bk-toc-dots"></i><span class="bk-toc-pg">' +
                            escapeHtml(String(it.page)) + '</span>' : '') + '</a>'
        }).join('') + '</div>'
        break
      case 'callout':
        atomic = true
        if (b.kind === 'definition') {
          inner = '<div class="bk-def"><span class="bk-def-term">' + escapeHtml(b.term || '') + '</span>' +
                  '<span class="bk-def-body">' + escapeHtml(b['def'] || '') + '</span></div>'
        } else if (b.md) {
          // Authored note/tip/warning/quote box (Tier 1 component) → the shared widget via its
          // <kal-callout> tag (upgrade() builds it, same path as mcq/hotspots).
          inner = '<kal-callout variant="' + escapeHtml(b.variant || 'note') + '"' +
                  (b.title ? ' title="' + escapeHtml(b.title) + '"' : '') + '>' +
                  escapeHtml(b.md) + '</kal-callout>'
        }
        break
      case 'flashcard':
        atomic = true
        inner = '<kal-flashcard><kal-front>' + escapeHtml(b.front || '') + '</kal-front>' +
                '<kal-back>' + escapeHtml(b.back || '') + '</kal-back></kal-flashcard>'
        break
      case 'checklist':
        atomic = true
        inner = '<kal-checklist id="' + escapeHtml(String(b.id || ('cl' + bIdx))) + '"' +
                (b.title ? ' title="' + escapeHtml(b.title) + '"' : '') + '>' +
                (b.items || []).map(function(it, k) {
                  return '<kal-item id="' + escapeHtml(String(it.id || (k + 1))) + '">' +
                         escapeHtml(it.md || '') + '</kal-item>'
                }).join('') + '</kal-checklist>'
        break
      case 'cloze':
        inner = '<kal-cloze>' + escapeHtml(b.md || '') + '</kal-cloze>'
        break
      case 'inline-checkpoint':
        var checkpoint = b.checkpoint || {}
        inner = '<kal-inline-checkpoint class="bk-checkpoint" data-id="' +
          escapeHtml(String(checkpoint.id || '')) + '">' +
          '<div class="bk-checkpoint-kicker">PAUSE AND DECIDE</div>' +
          '<div class="bk-checkpoint-prompt">' + miniMarkdown(checkpoint.prompt || '') + '</div>' +
          '<label class="bk-checkpoint-note-label">Your notes</label>' +
          '<textarea class="bk-checkpoint-note" rows="3" placeholder="Think through your answer before revealing the book’s discussion."></textarea>' +
          '<button type="button" class="bk-checkpoint-reveal" aria-expanded="false">Reveal source discussion</button>' +
          '<div class="bk-checkpoint-answer" hidden>' +
            '<div class="bk-checkpoint-answer-label">' +
              escapeHtml(String(checkpoint.responseLabel || 'Source discussion')) + '</div>' +
            blocksToHtml(checkpoint.responseBlocks || []) +
          '</div></kal-inline-checkpoint>'
        break
      case 'columns':
        atomic = true
        inner = '<div class="bk-cols">' + (b.md || '').split('\n').filter(function(l) { return l.trim() })
          .map(function(l) { return '<div class="bk-cols-item">' + miniMarkdown(l).replace(/^<p>|<\/p>\s*$/g, '') + '</div>' })
          .join('') + '</div>'
        break
      case 'grid':
        atomic = true
        if (b.kind === 'concepts') {
          const cards = (b.items || []).map(function(it) {
            return '<div class="bk-gcard"><span class="bk-gterm">' + escapeHtml(it.t || '') + '</span>' +
                   (it.p ? '<span class="bk-gpage">p ' + escapeHtml(String(it.p)) + '</span>' : '') + '</div>'
          }).join('')
          inner = (b.title ? '<div class="bk-gtitle">' + escapeHtml(b.title) + '</div>' : '') +
                  '<div class="bk-grid bk-grid-concepts">' + cards + '</div>'
        }
        break
      case 'panel':
        // Sidebar panel recovered from the source page's box geometry ("Ask the Experts", DK "IN
        // CONTEXT"). NOT atomic — a tall sidebar splits across columns gracefully (the hairline frame
        // continues). The preserved source geometry (bbox → data-col + --panel-w) lets CSS restore the
        // sidebar as a real margin float on a WIDE screen and stack it on a NARROW device — same content,
        // laid out for the panel it's on. See bkColOf.
        var pcol = bkColOf(b.bbox)
        var pw = (b.bbox && b.bbox.length === 4) ? Math.round((b.bbox[2] - b.bbox[0]) * 100) : 0
        inner = '<div class="bk-panel"' + (pcol ? ' data-col="' + pcol + '"' : '') +
                (pw ? ' style="--panel-w:' + pw + '%"' : '') + '>' +
                (b.title ? '<div class="bk-panel-title">' + escapeHtml(b.title) + '</div>' : '') +
                blocksToHtml(b.blocks || []) + '</div>'
        break
      case 'timeline':
        // Chronology strip recovered from box geometry: date-anchored entries laid out as a row.
        atomic = true
        inner = '<div class="bk-timeline">' + (b.items || []).map(function(it) {
          return '<div class="bk-tl-item">' +
            (it.src ? '<img class="bk-tl-img" src="' + bkAssetSrc(it.src) + '" alt="">' : '') +
            (it.date ? '<div class="bk-tl-date">' + escapeHtml(it.date) + '</div>' : '') +
            (it.md ? '<div class="bk-tl-text">' + miniMarkdown(it.md).replace(/^<p>|<\/p>\s*$/g, '') + '</div>' : '') +
            '</div>'
        }).join('') + '</div>'
        break
      case 'mcq':
        atomic = true; inner = bkMcqToHtml(b); break
      case 'drawing':
        atomic = true
        inner = '<kal-ink id="' + escapeHtml(String(b.id || ('d' + Math.random().toString(36).slice(2)))) +
                '" height="' + (parseInt(b.height, 10) || 300) + '"' +
                (b.label ? ' label="' + escapeHtml(b.label) + '"' : '') + '></kal-ink>'
        break
      case 'animation':
        atomic = true
        inner = '<kal-anim kind="' + escapeHtml(b.kind || 'breath') + '"' +
                (b.caption ? ' caption="' + escapeHtml(b.caption) + '"' : '') + '></kal-anim>'
        break
      case 'hotspots':
        atomic = true; inner = bkHotspotsToHtml(b); break
      case 'pintail':
        atomic = true; inner = bkPintailToHtml(b); break
      default:
        inner = ''
    }
    if (!inner) return ''
    // AI-enriched blocks (apply_enrichment.py adds gen:"ai") carry a ⚑ marker so nothing AI-made is
    // indistinguishable from the source text.
    const gen = b.gen === 'ai' ? ' bk-gen' : ''
    const semanticStart = freshPageIds.has(String(b.id || '')) ? ' bk-semantic-start' : ''
    const mark = b.gen === 'ai' ? '<span class="bk-gen-flag" title="AI-generated">⚑</span>' : ''
    const dpg = b.page != null ? ' data-page="' + escapeHtml(String(b.page)) + '"' : ''
    const side = (b.type === 'image' && b.side) ? ' bk-blk-side' : ''
    // a side-float also honours the figure's width on the SOURCE page when that is narrower than
    // the default 42% float (a 27%-of-page quote mark floats at 27%, not 42%)
    const sideW = (side && typeof b.relw === 'number' && b.relw > 0 && b.relw < 0.42)
      ? ' style="width:' + Math.max(12, Math.round(b.relw * 100)) + '%"' : ''
    // Preserved OCR signals surface as data-attributes so pure CSS can adapt across screen/font sizes:
    // data-role lets a data `chart` keep a legible floor on a 6" panel while a decorative mark stays
    // small; data-col records the source column for responsive figure/aside placement.
    const drole = b.role ? ' data-role="' + escapeHtml(String(b.role)) + '"' : ''
    const dcol = bkColOf(b.bbox) ? ' data-col="' + bkColOf(b.bbox) + '"' : ''
    const next = blocks[bIdx + 1]
    const association = (b.structureEvidence || {}).imageAssociationTargetId
    const nextNodeId = next && (next.structureEvidence || {}).nodeId
    const associatedNext = b.type === 'image' && association != null && association === nextNodeId
      ? ' bk-associated-next' : ''
    const joinsPrev = b.type === 'text' && (b.joinPrevious === 'space' || b.joinPrevious === 'dehyphenate')
    const joinsNext = next && next.type === 'text' &&
      (next.joinPrevious === 'space' || next.joinPrevious === 'dehyphenate')
    if (joinsPrev || joinsNext) {
      let segment = inner.replace(/^<p(?:\s+class="[^"]*")?>/, '').replace(/<\/p>\s*$/, '')
      if (joinsNext && next.joinPrevious === 'dehyphenate') segment = segment.replace(/-\s*$/, '')
      const open = joinsPrev ? '' : '<p class="bk-reconstructed-paragraph">'
      const close = joinsNext ? '' : '</p>'
      const joiner = joinsPrev && b.joinPrevious === 'space' ? ' ' : ''
      return open + '<span class="bk-blk bk-flow-segment' + gen + '"' + bid + dpg + '>' +
        mark + joiner + segment + '</span>' + close
    }
    return '<div class="bk-blk' + (atomic ? ' bk-atomic' : '') + side + gen + newPage + semanticStart + associatedNext + '"' +
           sideW + drole + dcol + bid + dpg + '>' + mark + inner + '</div>'
  }).join('')
}

// Which source column a block sat in, from its preserved normalised bbox: 'l'/'r' when it hugged a
// margin (left/right third), else null (full-measure / main column). Drives responsive aside placement.
function bkColOf(bbox) {
  if (!bbox || bbox.length !== 4) return null
  const x0 = bbox[0], x1 = bbox[2]
  if (x1 <= 0.52 && x0 < 0.30) return 'l'
  if (x0 >= 0.48 && x1 > 0.70) return 'r'
  return null
}

// A block image src is a bare asset name → 'assets/<name>' (resolveImages resolves assets/ via the bridge).
// Pass through absolute/asset-prefixed/data URLs untouched.
function bkAssetSrc(src) {
  src = String(src || '')
  if (/^(assets\/|https?:|data:)/.test(src)) return escapeHtml(src)
  return 'assets/' + escapeHtml(src)
}

function bkMcqToHtml(b) {
  const choices = (b.choices || []).map(function(c) {
    return '<kal-choice id="' + escapeHtml(c.id || '') + '">' + escapeHtml(c.md || c.text || '') + '</kal-choice>'
  }).join('')
  return '<kal-mcq' + (b.multi ? ' multi="true"' : '') + ' answer="' + escapeHtml((b.answer || []).join(' ')) + '">' +
    '<kal-prompt>' + escapeHtml(b.prompt || '') + '</kal-prompt>' + choices +
    (b.explain ? '<kal-explain>' + escapeHtml(b.explain) + '</kal-explain>' : '') + '</kal-mcq>'
}

function bkPintailToHtml(b) {
  const t = (Array.isArray(b.target) && b.target.length === 4) ? b.target.join(' ') : ''
  return '<kal-pintail src="' + bkAssetSrc(b.src) + '"' +
    (b.prompt ? ' prompt="' + escapeHtml(b.prompt) + '"' : '') +
    (t ? ' target="' + escapeHtml(t) + '"' : '') +
    (b.caption ? ' caption="' + escapeHtml(b.caption) + '"' : '') +
    (b.alt ? ' alt="' + escapeHtml(b.alt) + '"' : '') + '></kal-pintail>'
}

function bkHotspotsToHtml(b) {
  const spots = (b.spots || []).map(function(s) {
    return '<kal-spot x="' + (s.x || 0) + '" y="' + (s.y || 0) + '"' +
      (s.label != null ? ' label="' + escapeHtml(String(s.label)) + '"' : '') + '>' + escapeHtml(s.md || '') + '</kal-spot>'
  }).join('')
  return '<kal-hotspots src="' + bkAssetSrc(b.src) + '"' +
    (b.alt ? ' alt="' + escapeHtml(b.alt) + '"' : '') +
    (b.caption ? ' caption="' + escapeHtml(b.caption) + '"' : '') + '>' + spots + '</kal-hotspots>'
}

// Render a table block: pass through if already HTML, else parse a GFM pipe table. A raw OCR
// <table> arrives with no class, so it renders at table-layout:auto and a many-column table
// expands past the column width and gets clipped by .bk-pagebox (columns lost off the right edge).
// Give every passthrough table our .bk-tbl class (fixed layout + word-wrap + font-shrink keep it
// inside the column) and drop inline border/width/style that fight that, so nothing is clipped.
function bkTableToHtml(src) {
  src = String(src || '').trim()
  if (/^<table/i.test(src)) {
    return src.replace(/^<table\b[^>]*>/i, '<table class="bk-tbl">')
      // strip per-cell inline styles/attrs that force auto layout, but keep colspan/rowspan (structural)
      .replace(/<(td|th)\b([^>]*)>/gi, function(_, tag, attrs) {
        const span = (attrs.match(/\b(?:col|row)span\s*=\s*("[^"]*"|'[^']*'|\d+)/gi) || []).join(' ')
        return '<' + tag + (span ? ' ' + span : '') + '>'
      })
  }
  if (/^<(div|p|figure)/i.test(src)) return src
  const rows = src.split('\n').filter(function(l) { return l.indexOf('|') !== -1 })
  if (!rows.length) return '<pre class="bk-pre">' + escapeHtml(src) + '</pre>'
  const cells = function(line) { return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function(c) { return c.trim() }) }
  let out = '<table class="bk-tbl">', headerDone = false
  rows.forEach(function(line) {
    if (/^[\s|:\-]+$/.test(line)) { headerDone = true; return }   // separator row
    const tag = headerDone ? 'td' : 'th'
    out += '<tr>' + cells(line).map(function(c) {
      return '<' + tag + '>' + miniMarkdown(c).replace(/^<p>|<\/p>$/g, '') + '</' + tag + '>'
    }).join('') + '</tr>'
  })
  return out + '</table>'
}

// LaTeX → readable plain text, used ONLY as the fallback when KaTeX fails to parse a malformed OCR
// formula (see renderMath). General and content-agnostic: reduces \frac/\sqrt/\text/scripts/symbols
// to legible math-ish text so a broken formula reads as words instead of raw LaTeX source.
var _MATH_SYM = { '\\times':'×','\\cdot':'·','\\div':'÷','\\pm':'±','\\mp':'∓','\\Delta':'Δ','\\delta':'δ',
  '\\pi':'π','\\theta':'θ','\\mu':'µ','\\eta':'η','\\alpha':'α','\\beta':'β','\\gamma':'γ','\\lambda':'λ',
  '\\rho':'ρ','\\sigma':'σ','\\omega':'ω','\\leq':'≤','\\geq':'≥','\\le':'≤','\\ge':'≥','\\neq':'≠',
  '\\approx':'≈','\\rightarrow':'→','\\to':'→','\\Rightarrow':'⇒','\\infty':'∞','\\sum':'Σ','\\int':'∫','\\sqrt':'√' }
function mathFallbackText(tex) {
  var s = String(tex || '').trim()
  if (!s) return ''
  for (var k in _MATH_SYM) if (k !== '\\sqrt') s = s.split(k).join(_MATH_SYM[k])
  // collapse text wrappers + scripts first so \frac groups become brace-free and matchable
  for (var i = 0; i < 4; i++) { var n = s.replace(/\\(?:text|mathrm|operatorname|mathbf|mathit|mathsf)\s*\{([^{}]*)\}/g, '$1'); if (n === s) break; s = n }
  s = s.replace(/\^\{([^{}]*)\}/g, '^$1').replace(/_\{([^{}]*)\}/g, '$1')
  s = s.replace(/\^([A-Za-z0-9])/g, '^$1').replace(/_([A-Za-z0-9])/g, '$1')
  for (var j = 0; j < 6; j++) { var m = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)'); if (m === s) break; s = m }
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
  s = s.replace(/\\[a-zA-Z]+/g, ' ')                       // drop any remaining commands
  s = s.replace(/\}\s*\{/g, ' ').replace(/[{}]/g, ' ')     // stray group boundaries → space
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(').trim()
  return s
}

window.BookReader = BookReader
