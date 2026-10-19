// Boox UI — reader chrome shell. Replaces the classic bk-topbar/bk-botbar/bk-clock/bk-dogear
// bars of all three readers (pdf/epub/book) with a Boox-style toolbar + bottom nav + status
// strip + bookmark ribbon. Pure VIEW layer: the readers keep driving their engine (pagination,
// bitmap pipeline, bookmarks, position) unchanged; this file only rebuilds the chrome and mirrors
// the reader's own state into it.
//
// The readers call into here through the delegation seams added in WP0:
//   BooxChrome.install(reader, kind)   at the end of chrome build (pdf: buildChrome; epub:
//                                      renderChapter; book: renderSection)
//   BooxChrome.barsOpen/hideBars/toggleBar(reader[, which])   from the readers' tap zones
// Activation flips on only once boox-panels.js sets Boox.takeover.reader (both modules healthy).
window.BooxChrome = (function() {

  var el = BooxUI.el

  // Bottom-nav layout per format. Each entry: [iconKey, label, action].
  //   action: {panel:'toc'|...} opens a panel, {soon:true} shows a coming-soon toast.
  //   'format' on pdf is appended only in article mode (see bottomNav()).
  function bottomNav(reader) {
    var kind = reader._bxKind
    if (kind === 'pdf') {
      var nav = [
        ['contents', 'Contents', { panel: 'toc' }],
        ['progress', 'Progress', { progress: true }],
        ['nav', 'Navigation', { panel: 'nav' }],
        ['contrast', 'Contrast', { panel: 'contrast' }]
      ]
      if (reader.articleMode) nav.push(['format', 'Format', { panel: 'format' }])
      nav.push(['split', 'Split View', { soon: true }])
      return nav
    }
    // epub + book (reflowable): Format is the typography reflow panel; no Navigation/Contrast.
    return [
      ['contents', 'Contents', { panel: 'toc' }],
      ['progress', 'Progress', { progress: true }],
      ['format', 'Format', { panel: 'format' }],
      ['split', 'Split View', { soon: true }]
    ]
  }

  function titleOf(reader) {
    var m = reader.manifest
    return (m && m.title) || (reader.meta && reader.meta.title) || 'Book'
  }

  // Right-of-page indicator + centre chapter label, sourced from the reader's own fields
  // (bookPages() is the shared whole-book estimate used by the classic bar too).
  function pageInfo(reader) {
    var kind = reader._bxKind, page = '', chap = ''
    if (window.NativePages && NativePages.active(reader)) {
      var entry = NativePages.activeEntry && NativePages.activeEntry(reader)
      if (entry && entry.groupKind === 'study-workbook') {
        return {
          page: 'Workbook ' + ((entry.groupIndex || 0) + 1) + '/' + (entry.groupLength || 1),
          chap: (entry.source && entry.source.label) || 'Study workbook'
        }
      }
      if (entry && entry.groupKind === 'ai-quiz') {
        return {
          page: 'AI Quiz ' + ((entry.groupIndex || 0) + 1) + '/' + (entry.groupLength || 1),
          chap: (entry.source && entry.source.label) || 'Generated quiz'
        }
      }
      return { page: 'Inserted page', chap: 'Kalamos native page' }
    }
    if (kind === 'pdf') {
      page = (reader.pageIndex + 1) + '/' + reader.pages
      if (window.BooxNav && BooxNav.status) page += BooxNav.status(reader)   // ' · cell n/N' when column-split on
    } else {
      var bp = (typeof reader.bookPages === 'function') ? reader.bookPages() : null
      page = bp
        ? (bp.cur + '/' + (bp.exact === false ? '~' : '') + bp.total)
        : ((reader.page + 1) + '/' + reader.pages)
      var spineLen = (reader.manifest && reader.manifest.spine && reader.manifest.spine.length) || 0
      if (spineLen) {
        var idx = (kind === 'book') ? reader.sec : reader.spineIdx
        if (kind === 'book' && typeof reader.sectionStatusLabel === 'function') {
          chap = reader.sectionStatusLabel(reader.sectionId())
        }
        if (!chap) chap = (kind === 'book' ? 'Section ' : 'Chapter ') + (idx + 1) + ' / ' + spineLen
      }
    }
    return { page: page, chap: chap }
  }

  function clockText() {
    var d = new Date(), hh = d.getHours(), mm = d.getMinutes()
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
  }
  function clockOn() {
    return !(typeof localStorage !== 'undefined' && localStorage.getItem('kal.reader.showClock') === '0')
  }
  function bookmarked() {
    return (typeof Bookmarks !== 'undefined') && Bookmarks.isCurrentBookmarked()
  }

  // ---- top toolbar ----
  function buildTop(reader) {
    var top = el('div', 'bx-r-top')

    // single-doc tab strip (multi-doc = coming soon)
    var tabs = el('div', 'bx-r-tabs')
    var tab = el('div', 'bx-r-tab bx-on')
    tab.appendChild(el('span', 'bx-r-tabtitle', titleOf(reader)))
    var x = el('button', 'bx-r-tabx'); x.type = 'button'; x.innerHTML = BooxUI.icons.close
    x.addEventListener('click', function() { reader.close() })
    tab.appendChild(x)
    tabs.appendChild(tab)
    top.appendChild(tabs)

    var bar = el('div', 'bx-r-toolbar')
    bar.appendChild(BooxUI.iconBtn('back', 'Back', { onClick: function() { reader.close() } }))
    bar.appendChild(el('div', 'bx-r-spacer'))

    bar.appendChild(BooxUI.iconBtn('sync', 'Sync', { soon: true }))
    if (reader._bxKind === 'pdf') bar.appendChild(BooxUI.iconBtn('ocr', 'OCR', { soon: true }))
    // PDF Notes keeps the compact sticky-note box. EPUB/book sticky notes remain attached to the
    // normal text-selection popup. Pen drawing is an independent daemon-backed mode for all formats.
    if (reader._bxKind === 'pdf' && window.BooxPdfAnnots) {
      var notesBtn = BooxUI.iconBtn('notes', 'Notes', {
        on: BooxPdfAnnots.modeOn(reader), onClick: function() { BooxPdfAnnots.toggle(reader) }
      }); notesBtn.dataset.annotTool = 'note'; bar.appendChild(notesBtn)
    } else {
      bar.appendChild(BooxUI.iconBtn('notes', 'Notes', { onClick: function() {
        BooxUI.toast('Select text, then choose Sticky note')
      } }))
    }
    if (window.BooxPageInk) {
      var pageBtn = BooxUI.iconBtn('onpage', 'Pen drawing', {
        on: BooxPageInk.modeOn(reader), onClick: function() { BooxPageInk.toggle(reader) }
      }); pageBtn.dataset.annotTool = 'page'; bar.appendChild(pageBtn)
    }
    if (window.LearningSessions && LearningSessions.enabled && LearningSessions.enabled()) {
      bar.appendChild(BooxUI.iconBtn('ai', 'Learn this section', {
        onClick: function() { LearningSessions.open(reader) }
      }))
    } else if (window.BooksAI && BooksAI.enabled && BooksAI.enabled()) {
      bar.appendChild(BooxUI.iconBtn('ai', 'Create workbook', {
        onClick: function() { BooksAI.open(reader) }
      }))
    } else {
      bar.appendChild(BooxUI.iconBtn('ai', 'Create workbook', { soon: true }))
    }
    bar.appendChild(BooxUI.iconBtn('search', 'Search', { onClick: function() { openPanelsSafe(reader, 'search') } }))
    var more = BooxUI.iconBtn('more', 'More', {})
    more.addEventListener('click', function() { openMore(reader, more) })
    bar.appendChild(more)

    top.appendChild(bar)
    return top
  }

  function openMore(reader, anchor) {
    var items = [
      { label: 'Refresh', onClick: function() { rerenderPage(reader) } },
      { label: 'Settings', soon: true },
      { label: 'Dict', soon: true },
      { label: 'Detect Data', soon: true },
      { label: 'Import old data', soon: true }
    ]
    if (window.BooksAI && BooksAI.enabled && BooksAI.enabled()) items.unshift({
      label: 'Create workbook', onClick: function() { BooksAI.open(reader) }
    })
    if (reader._bxKind === 'pdf') items.splice(4, 0, {
      label: 'Export annotated PDF', onClick: function() { Bridge.exportAnnotatedPdf(reader.nbId) }
    })
    BooxUI.popover(anchor, items)
  }

  function rerenderPage(reader) {
    if (reader._bxKind === 'pdf') { if (reader.loadPage) reader.loadPage() }
    else if (reader.paginate) reader.paginate()
  }

  // ---- bottom nav ----
  function buildBottom(reader) {
    var bot = el('div', 'bx-r-bottom')
    bottomNav(reader).forEach(function(item) {
      var act = item[2]
      var opts = { title: item[1] }
      if (act.soon) opts.soon = true
      else if (act.progress) opts.onClick = function() { hideBars(reader); if (window.BooxProgress) BooxProgress.open(reader) }
      else opts.onClick = function() { openPanelsSafe(reader, act.panel) }
      bot.appendChild(BooxUI.iconBtn(item[0], item[1], opts))
    })
    return bot
  }

  // ---- always-on status strip (replaces bk-clock) + bookmark ribbon ----
  function buildStatus(reader) {
    var s = el('div', 'bx-r-status')
    s._clock = el('span', 'bx-r-clock')
    s._chap = el('span', 'bx-r-chap')
    s._page = el('span', 'bx-r-page')
    s.appendChild(s._clock); s.appendChild(s._chap); s.appendChild(s._page)
    return s
  }
  function buildRibbon() {
    var r = el('div', 'bx-ribbon')
    r.innerHTML = BooxUI.icons.ribbon
    return r
  }

  function openPanelsSafe(reader, tab) {
    hideBars(reader)
    if (reader.openPanels) reader.openPanels(tab)
  }

  // ---- public: install / refresh ----
  function install(reader, kind) {
    reader._bxKind = kind
    document.body.classList.add('boox')
    var v = reader.view()

    // Rebuild chrome (epub/book wipe the view each render, so these are gone; pdf builds once).
    var top = buildTop(reader)
    var bottom = buildBottom(reader)
    var status = buildStatus(reader)
    var ribbon = buildRibbon()
    v.appendChild(top); v.appendChild(bottom); v.appendChild(status); v.appendChild(ribbon)
    reader._bx = { top: top, bottom: bottom, status: status, ribbon: ribbon }
    if (kind === 'pdf' && window.BooxPdfAnnots) BooxPdfAnnots.install(reader)   // highlights + sticky notes

    // Wrap engine hooks once per reader object so chrome stays in sync with page turns / clock
    // ticks / bookmark changes. The wraps persist across re-renders; install() just refreshes _bx.
    if (!reader._bxWrapped) {
      reader._bxWrapped = true
      wrapAfter(reader, kind === 'pdf' ? 'loadPage' : 'paginate', function() { refresh(reader) })
      wrapAfter(reader, 'updateClock', function() { refresh(reader) })
      wrapAfter(reader, 'updateBookmarkGlyph', function() { refresh(reader) })
      wrapBefore(reader, 'close', function() { return BooxUI.dismissOverlay() })  // back dismisses a panel first
    }
    refresh(reader)
  }

  // Run fn() after the reader's own method (keeping its return value).
  function wrapAfter(reader, name, fn) {
    var orig = reader[name]
    if (typeof orig !== 'function') return
    reader[name] = function() {
      var r = orig.apply(this, arguments)
      try { fn() } catch (e) {}
      return r
    }
  }
  // If fn() returns truthy, swallow the original call (used to intercept close for back-dismiss).
  function wrapBefore(reader, name, fn) {
    var orig = reader[name]
    if (typeof orig !== 'function') return
    reader[name] = function() {
      try { if (fn()) return } catch (e) {}
      return orig.apply(this, arguments)
    }
  }

  function refresh(reader) {
    var bx = reader._bx
    if (!bx || !bx.status) return
    var info = pageInfo(reader)
    bx.status._clock.textContent = clockText()
    bx.status._clock.style.visibility = clockOn() ? 'visible' : 'hidden'
    bx.status._chap.textContent = info.chap
    bx.status._page.textContent = info.page
    bx.ribbon.style.display = bookmarked() ? 'block' : 'none'
    // EPUB pagination is synchronous, so refresh is the settled-page hook. PDF swaps its image
    // asynchronously and calls redraw only after the new bitmap is actually in the DOM.
    if (window.BooxPageInk &&
        (reader._bxKind === 'epub' || reader._bxKind === 'book' ||
         (window.NativePages && NativePages.active(reader)))) {
      BooxPageInk.redraw(reader); BooxPageInk.sync(reader)
    }
    if (bx.top) {
      Array.prototype.forEach.call(bx.top.querySelectorAll('[data-annot-tool]'), function(b) {
        var on = b.dataset.annotTool === 'page'
          ? (window.BooxPageInk && BooxPageInk.modeOn(reader))
          : (window.BooxPdfAnnots && BooxPdfAnnots.modeOn(reader))
        b.classList.toggle('bx-on', !!on)
      })
    }

    // The pdf Format button only exists in article mode — rebuild the bottom nav if that changed.
    var want = bottomNav(reader).length
    if (bx.bottom.childElementCount !== want) {
      var fresh = buildBottom(reader)
      fresh.className = bx.bottom.className   // keep .show state
      bx.bottom.parentNode.replaceChild(fresh, bx.bottom)
      bx.bottom = fresh
    }
  }

  // ---- public: bar visibility (called by the readers' tap zones) ----
  function barsOpen(reader) {
    var bx = reader._bx
    return !!(bx && ((bx.top && bx.top.classList.contains('show')) ||
                     (bx.bottom && bx.bottom.classList.contains('show'))))
  }
  function hideBars(reader) {
    var bx = reader._bx; if (!bx) return
    if (bx.top) { bx.top.classList.remove('show', 'arming'); clearTimeout(bx.top._armTimer) }
    if (bx.bottom) { bx.bottom.classList.remove('show', 'arming'); clearTimeout(bx.bottom._armTimer) }
  }
  function toggleBar(reader, which) {
    if (Date.now() - (window._readerOverlayClosedAt || 0) < 350) return
    if ((typeof ReaderPanels !== 'undefined' && ReaderPanels.isOpen && ReaderPanels.isOpen()) ||
        (window.BooxDrawer && BooxDrawer.isOpen && BooxDrawer.isOpen()) ||
        (BooxUI.sheetOpen && BooxUI.sheetOpen())) return
    var bx = reader._bx; if (!bx) return
    var open = barsOpen(reader)
    if (open) { hideBars(reader); return }
    ;[bx.top, bx.bottom].forEach(function(bar) {
      if (!bar) return
      bar.classList.add('show', 'arming')
      clearTimeout(bar._armTimer)
      // Long enough to outlive the synthetic click produced by the revealing tap, but short enough
      // that a deliberate second tap feels immediate on the e-reader.
      bar._armTimer = setTimeout(function() { bar.classList.remove('arming') }, 36)
    })
  }

  return {
    install: install, refresh: refresh,
    barsOpen: barsOpen, hideBars: hideBars, toggleBar: toggleBar
  }
})()
