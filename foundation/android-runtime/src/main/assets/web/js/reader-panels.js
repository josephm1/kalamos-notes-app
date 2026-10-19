// ReaderPanels — shared bottom-sheet framework for in-reader panels (TOC, Bookmarks, Search, …).
// One panel is on screen at a time; tabs live in a row along the sheet's bottom edge (mirrors the
// Bigme-style slide-up panel: hierarchical rows, a bottom tab strip, "< n/m >" pagers). Pure B/W,
// hairline separators, NO animation (the sheet is added/removed from the DOM — no transition), and
// NO scrollbars: a body with more rows than fit paginates via ReaderPanels.paginateList instead.
// Temporary, reason-coded reader gesture diagnostics. WebViewCache forwards only console messages
// beginning with DIAG to logcat. This deliberately accepts fixed gesture metadata only: never DOM
// text, URLs, book identifiers, credentials, or arbitrary error strings.
window.ReaderTapDiag = {
  log: function(kind, reason, event, data) {
    if (typeof console === 'undefined' || typeof console.log !== 'function') return
    data = data || {}
    function token(value) { return String(value == null ? '-' : value).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 32) }
    function number(value) { value = Number(value); return Number.isFinite(value) ? Math.round(value) : -1 }
    var parts = [
      'DIAG readerTap',
      'kind=' + token(kind),
      'reason=' + token(reason),
      'pt=' + token(event && event.pointerType),
      'pid=' + number(event && event.pointerId),
      'dt=' + number(data.dt),
      'dx=' + number(data.dx),
      'dy=' + number(data.dy),
      'zone=' + token(data.zone),
      'prevented=' + (event && event.defaultPrevented ? '1' : '0')
    ]
    console.log(parts.join(' '))
  }
}

const ReaderPanels = {
  _tabs: null, _active: null, _root: null, _sheet: null, _bodyEl: null, _tabrow: null, _titleEl: null, _icon: '',

  isOpen() { return !!this._root },

  // opts: { tabs: [{id, label, build(bodyEl)}], active }
  open(opts) {
    this.close()
    opts = opts || {}
    this._tabs = opts.tabs || []
    if (!this._tabs.length) return
    this._active = opts.active || this._tabs[0].id
    this._icon = opts.icon || ''

    const self = this
    const root = document.createElement('div'); root.className = 'rp-overlay'

    const sheet = document.createElement('div'); sheet.className = 'rp-sheet'
    if (opts.className) String(opts.className).split(/\s+/).filter(Boolean).forEach(function(c) { sheet.classList.add(c) })
    sheet.addEventListener('click', function(e) { e.stopPropagation() })
    root.addEventListener('click', function(e) { if (!sheet.contains(e.target)) self.close() })

    const head = document.createElement('div'); head.className = 'rp-head'
    const title = document.createElement('div'); title.className = 'rp-title'
    head.appendChild(title)

    const body = document.createElement('div'); body.className = 'rp-body'

    const tabrow = document.createElement('div'); tabrow.className = 'rp-tabrow'
    this._tabs.forEach(function(t) {
      const b = document.createElement('button')
      b.type = 'button'; b.className = 'rp-tab'; b.dataset.id = t.id; b.textContent = t.label
      b.addEventListener('click', function() { self.select(t.id) })
      tabrow.appendChild(b)
    })

    sheet.appendChild(head); sheet.appendChild(body); sheet.appendChild(tabrow)
    root.appendChild(sheet)
    document.body.appendChild(root)

    this._root = root; this._sheet = sheet; this._bodyEl = body; this._tabrow = tabrow; this._titleEl = title
    this.select(this._active)
  },

  // re-render the current tab's body (e.g. after data changes elsewhere) without touching the sheet.
  refresh() { if (this._active) this.select(this._active) },

  select(id) {
    if (!this._root || !this._tabs) return
    this._active = id
    Array.prototype.forEach.call(this._tabrow.children, function(ch) {
      ch.classList.toggle('sel', ch.dataset.id === id)
    })
    const tab = this._tabs.find(function(t) { return t.id === id })
    this._titleEl.innerHTML = this._icon ? ('<span class="rp-title-icon">' + this._icon + '</span><span>' + ((tab && tab.label) || '') + '</span>') : ''
    if (!this._icon) this._titleEl.textContent = (tab && tab.label) || ''
    this._bodyEl.innerHTML = ''
    if (tab && typeof tab.build === 'function') {
      // Most panels render only the visible page of rows. Build those immediately so a tap never
      // pays an artificial Loading… frame; genuinely expensive panels schedule their own work.
      tab.build(this._bodyEl)
    }
  },

  close() {
    // Contents uses the Boox side drawer. Reader builders historically call ReaderPanels.close()
    // after a row jump, so forward that close when this bottom-sheet host is not the one on screen.
    if (!this._root && window.BooxDrawer && BooxDrawer.isOpen && BooxDrawer.isOpen()) {
      BooxDrawer.close()
      return
    }
    if (this._root) {
      this._root.remove()
      window._readerOverlayClosedAt = Date.now()
    }
    this._root = null; this._sheet = null; this._bodyEl = null; this._tabrow = null; this._titleEl = null
    this._tabs = null; this._active = null
    this._icon = ''
  },

  // A no-scroll, fixed-height list: renders [perPage] rows at a time with < / > controls (and a
  // "n / m" readout) pinned below the rows. renderRow(item, absoluteIndex) returns a DOM node (or
  // falsy to skip). Returns a small controller ({ rerender, goto(page) }) so a caller can force a
  // re-render (e.g. after deleting a row) without rebuilding the whole panel.
  paginateList(bodyEl, items, renderRow, perPage) {
    items = items || []
    perPage = perPage > 0 ? perPage : 6
    let page = 0
    const total = Math.max(1, Math.ceil(items.length / perPage))

    const wrap = document.createElement('div'); wrap.className = 'rp-list'
    const rows = document.createElement('div'); rows.className = 'rp-rows'
    wrap.appendChild(rows)

    let pager = null, prevBtn = null, nextBtn = null, info = null
    if (total > 1) {
      pager = document.createElement('div'); pager.className = 'rp-pager'
      prevBtn = document.createElement('button'); prevBtn.type = 'button'; prevBtn.className = 'rp-pg-btn'; prevBtn.textContent = '‹'
      info = document.createElement('span'); info.className = 'rp-pg-info'
      nextBtn = document.createElement('button'); nextBtn.type = 'button'; nextBtn.className = 'rp-pg-btn'; nextBtn.textContent = '›'
      prevBtn.addEventListener('click', function() { if (page > 0) { page--; render() } })
      nextBtn.addEventListener('click', function() { if (page < total - 1) { page++; render() } })
      pager.appendChild(prevBtn); pager.appendChild(info); pager.appendChild(nextBtn)
      wrap.appendChild(pager)
    }

    function render() {
      rows.innerHTML = ''
      const start = page * perPage
      const slice = items.slice(start, start + perPage)
      if (!slice.length) {
        const empty = document.createElement('div'); empty.className = 'rp-empty'
        empty.textContent = 'Nothing here yet'
        rows.appendChild(empty)
      } else {
        slice.forEach(function(item, i) {
          const node = renderRow(item, start + i)
          if (node) rows.appendChild(node)
        })
      }
      if (pager) {
        info.textContent = (page + 1) + ' / ' + total
        prevBtn.disabled = page <= 0
        nextBtn.disabled = page >= total - 1
      }
    }

    bodyEl.innerHTML = ''
    bodyEl.appendChild(wrap)
    render()
    return {
      rerender: render,
      goto(p) { page = Math.max(0, Math.min(total - 1, p)); render() }
    }
  },

  // Paged picture browser shared by EPUB and Kalamos-format books. Only the visible six thumbnails
  // receive a src, keeping large illustrated books cheap to browse and avoiding a scrollbar on
  // e-ink. opts = { src(item), fallback(item), select(item), label(item), ref(item) }.
  imageGallery(bodyEl, items, opts) {
    items = items || []
    opts = opts || {}
    let page = 0
    const perPage = 6
    const total = Math.max(1, Math.ceil(items.length / perPage))
    const wrap = document.createElement('div'); wrap.className = 'rp-image-browser'
    const grid = document.createElement('div'); grid.className = 'rp-image-grid'
    wrap.appendChild(grid)

    let pager = null, prevBtn = null, nextBtn = null, info = null
    if (total > 1) {
      pager = document.createElement('div'); pager.className = 'rp-pager'
      prevBtn = document.createElement('button'); prevBtn.type = 'button'; prevBtn.className = 'rp-pg-btn'; prevBtn.textContent = '‹'
      info = document.createElement('span'); info.className = 'rp-pg-info'
      nextBtn = document.createElement('button'); nextBtn.type = 'button'; nextBtn.className = 'rp-pg-btn'; nextBtn.textContent = '›'
      prevBtn.addEventListener('click', function() { if (page > 0) { page--; render() } })
      nextBtn.addEventListener('click', function() { if (page < total - 1) { page++; render() } })
      pager.appendChild(prevBtn); pager.appendChild(info); pager.appendChild(nextBtn)
      wrap.appendChild(pager)
    }

    function render() {
      grid.innerHTML = ''
      const visible = items.slice(page * perPage, page * perPage + perPage)
      if (!visible.length) {
        const empty = document.createElement('div'); empty.className = 'rp-empty rp-image-empty'
        empty.textContent = 'No pictures found'
        grid.appendChild(empty)
      } else {
        visible.forEach(function(item, offset) {
          const absoluteIndex = page * perPage + offset
          const button = document.createElement('button')
          button.type = 'button'; button.className = 'rp-image-card'
          const frame = document.createElement('span'); frame.className = 'rp-image-frame'
          const img = document.createElement('img')
          img.alt = (opts.label && opts.label(item, absoluteIndex)) || ('Picture ' + (absoluteIndex + 1))
          img.loading = 'lazy'; img.decoding = 'async'
          const source = opts.src && opts.src(item)
          if (source) img.src = source
          if (opts.fallback) img.addEventListener('error', function fallback() {
            img.removeEventListener('error', fallback)
            const replacement = opts.fallback(item)
            if (replacement) img.src = replacement
          })
          frame.appendChild(img); button.appendChild(frame)
          const label = document.createElement('span'); label.className = 'rp-image-label'
          label.textContent = img.alt
          button.appendChild(label)
          const refText = opts.ref && opts.ref(item)
          if (refText) {
            const ref = document.createElement('span'); ref.className = 'rp-image-ref'
            ref.textContent = refText; button.appendChild(ref)
          }
          button.setAttribute('aria-label', 'Go to ' + img.alt + (refText ? ', ' + refText : ''))
          button.addEventListener('click', function() { if (opts.select) opts.select(item) })
          grid.appendChild(button)
        })
      }
      if (pager) {
        info.textContent = (page + 1) + ' / ' + total
        prevBtn.disabled = page <= 0
        nextBtn.disabled = page >= total - 1
      }
    }

    bodyEl.innerHTML = ''
    bodyEl.appendChild(wrap)
    render()
  }
}

window.ReaderPanels = ReaderPanels
