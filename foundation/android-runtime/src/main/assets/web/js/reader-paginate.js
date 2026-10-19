// ReaderPaginate — shared CSS-multicolumn pagination geometry (AD-5). Mechanical extraction from
// BookReader's _pageGeom/paginate/bookPages (book-reader.js) so book-reader.js and epub-reader.js
// don't duplicate the column math (or drift out of sync). A "flow" is the reflowable content element,
// laid out into 1 or 2 CSS columns inside a "content" clipping box; a page turn translateX's the flow
// by one column-stride (or one whole two-column "spread" on wide viewports). Callers own their own DOM
// structure/CSS classes — this module only computes/applies the shared geometry.
const ReaderPaginate = {
  // Horizontal padding (left+right) of [contentEl] — the flow's usable width excludes it.
  contentPadX(contentEl) {
    if (!contentEl) return 0
    const cs = getComputedStyle(contentEl)
    return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  },

  // Column geometry for [flowEl] inside [contentEl]. Wide viewports (>=800 CSS px content width) get a
  // TWO-COLUMN SPREAD (like an open book); narrower viewports get a single column capped at 700px (a
  // mid-size window gets a readable centred page instead of 100-char lines). Column pitch is kept
  // INTEGER (fractional widths drift a sub-pixel per page in translateX and eventually clip/bleed).
  pageGeom(contentEl, flowEl) {
    const gap = 40
    const w = Math.floor((contentEl ? contentEl.clientWidth : flowEl.clientWidth) - this.contentPadX(contentEl))
    const cols = w >= 800 ? 2 : 1
    const colW = cols === 1 ? Math.min(w, 700) : Math.floor((w - gap) / cols)
    return { gap, cols, colW, colStride: colW + gap, pageStride: cols * (colW + gap) }
  },

  // Measures [contentEl]'s content-box height, sizes [flowEl] to it (height + optional [colhVar] custom
  // property, e.g. '--bk-colh', so CSS can clamp figures to one column), and pins [flowEl] (+ optional
  // [pageboxEl], the visible clipping "page") to the exact page/spread width so the browser's used column
  // width is exactly geom.colW (no drift at any page index). Returns { h, geom, pageW, ncols } — [ncols]
  // is the RAW column count; callers derive their own page count via Math.ceil(ncols / geom.cols).
  layout(contentEl, flowEl, pageboxEl, colhVar) {
    const cs = getComputedStyle(contentEl)
    const h = contentEl.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0)
    flowEl.style.height = h + 'px'
    if (colhVar) flowEl.style.setProperty(colhVar, h + 'px')
    const g = this.pageGeom(contentEl, flowEl)
    if (g.colW < 2) return { h, geom: g, pageW: 0, ncols: 0 }
    const pageW = g.cols * g.colW + (g.cols - 1) * g.gap
    if (pageboxEl) { pageboxEl.style.width = pageW + 'px'; pageboxEl.style.height = h + 'px' }
    flowEl.style.width = pageW + 'px'
    flowEl.style.columnWidth = g.colW + 'px'
    flowEl.style.columnGap = g.gap + 'px'
    const ncols = Math.max(1, Math.round((flowEl.scrollWidth + g.gap) / g.colStride))
    return { h, geom: g, pageW, ncols }
  },

  // Translate [flowEl] to show 0-based [page] under [geom] (from pageGeom/layout).
  showPage(flowEl, page, geom) {
    flowEl.style.transform = 'translateX(' + (-page * geom.pageStride) + 'px)'
  },

  // ---- whole-book page estimate from per-chapter/section `chars` weights ----
  // Only the CURRENTLY rendered chapter/section's page count can ever be measured (the rest are lazily
  // rendered), so the true book-wide page number can't be read off the DOM. Each spine entry carries a
  // layout weight (`chars`); calibrating chars-per-rendered-page from every entry measured so far — at
  // this viewport + font size — extrapolates the rest. The total starts as a good estimate and hardens
  // into the exact count as more of the book is visited. [spine] is an array of {chars}; [measured] maps
  // a caller-chosen key (via [keyOf(i)], e.g. sectionId or the spine index itself) to its measured page
  // count; [curIdx]/[curPageInChapter] locate the reading position for the "N / total" readout.
  bookPages(spine, measured, keyOf, curIdx, curPageInChapter) {
    if (!spine || !spine.length || spine[0].chars == null) return null
    let mc = 0, mp = 0
    for (let i = 0; i < spine.length; i++) {
      const p = measured[keyOf(i)]
      if (p) { mc += spine[i].chars || 0; mp += p }
    }
    if (!mp) return null
    const d = Math.max(1, mc / mp)   // chars per rendered page
    let cur = curPageInChapter + 1, total = 0
    for (let i = 0; i < spine.length; i++) {
      const p = measured[keyOf(i)] || Math.max(1, Math.round((spine[i].chars || 0) / d))
      total += p
      if (i < curIdx) cur += p
    }
    return { cur, total }
  }
}

window.ReaderPaginate = ReaderPaginate
