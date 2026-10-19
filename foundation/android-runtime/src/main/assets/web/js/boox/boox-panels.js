// Boox UI — reader panels host. The readers' openPanels(tab) delegates here (WP0 seam). Each bottom-
// nav button opens a FOCUSED panel (matching the Boox/NeoReader layout, not one giant tab strip):
//   'toc'      → Contents drawer: TOC / Quizzes / Bookmarks / Annotations / Handwriting
//   'search'   → Search
//   'nav'      → Navigation (crop / columns / direction / comic / article + column split)  [pdf]
//   'contrast' → Contrast   [pdf]
//   'format'   → Format (Fonts / Spacing)
// Panels are hosted in the shared ReaderPanels bottom sheet (css/boox-reader.css restyles it to the
// Boox look). Hosting there is deliberate: the readers' builders call ReaderPanels.close() internally
// (e.g. a TOC row tap), so any other host would leave the sheet stuck open. Annotations / Handwriting
// / the column-split Navigation are Boox-layer builders (the readers have no such tab).

// Flat EPUB/PDF/book TOCs carry a level column. This host turns that into persistent collapsible
// groups without changing the readers' format-specific jump actions.
window.BooxToc = (function() {
  function pageSize(body) {
    if (!(body.closest && body.closest('.bx-drawer'))) return 6
    // Reserve the pager's full 64 px line plus its gap, then size against the drawer row's 58 px
    // maximum. The former fixed 15-row page let the last chapter render beneath the pager on the
    // BigMe portrait viewport.
    var height = Number(body.clientHeight) || 0
    if (!height) return 13
    return Math.max(6, Math.min(15, Math.floor((height - 70) / 58)))
  }

  function render(reader, body, items, levelOf, keyOf, renderRow) {
    if (!reader._bxTocCollapsed) reader._bxTocCollapsed = {}
    var collapsed = reader._bxTocCollapsed
    var model = reader._bxTocModel
    if (!model || model.items !== items) {
      var rows = items.map(function(item, i) {
        var level = Math.max(1, +levelOf(item) || 1)
        var key = String(keyOf(item, i))
        var next = items[i + 1]
        var hasChildren = !!next && Math.max(1, +levelOf(next) || 1) > level
        if (hasChildren && !Object.prototype.hasOwnProperty.call(collapsed, key)) collapsed[key] = true
        return { item: item, sourceIndex: i, level: level, key: key, hasChildren: hasChildren }
      })
      model = reader._bxTocModel = { items: items, rows: rows, visible: null }
    }

    function visibleRows() {
      if (model.visible) return model.visible
      var visible = [], hiddenBelow = null
      model.rows.forEach(function(v) {
        if (hiddenBelow != null && v.level > hiddenBelow) return
        if (hiddenBelow != null && v.level <= hiddenBelow) hiddenBelow = null
        visible.push(v)
        if (collapsed[v.key]) hiddenBelow = v.level
      })
      model.visible = visible
      return visible
    }
    function build(anchorKey) {
      var visible = visibleRows()
      var controller = ReaderPanels.paginateList(body, visible, function(v) {
        var row = renderRow(v.item, v.sourceIndex)
        if (!row) return row
        if (window.ReaderContextActions && typeof window.ReaderContextActions.attachToc === 'function') {
          window.ReaderContextActions.attachToc(reader, row, v.item)
        }
        var toggle = document.createElement('span')
        toggle.className = v.hasChildren ? 'rp-toc-toggle' : 'rp-toc-toggle spacer'
        toggle.textContent = v.hasChildren ? (collapsed[v.key] ? '▸' : '▾') : ''
        if (v.hasChildren) toggle.addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation(); collapsed[v.key] = !collapsed[v.key]
          model.visible = null; build(v.key)
        })
        row.insertBefore(toggle, row.firstChild)
        return row
      }, pageSize(body))
      if (anchorKey != null) {
        var at = visible.findIndex(function(v) { return v.key === anchorKey })
        if (at >= 0) controller.goto(Math.floor(at / pageSize(body)))
      }
    }
    build()
  }

  return { render: render, pageSize: pageSize }
})()

window.BooxPanels = (function() {

  function tocRef(reader) { return { id: 'toc', label: 'TOC', build: function(b) { reader.buildTocPanel(b) } } }
  function bmRef(reader) { return { id: 'bookmarks', label: 'Bookmarks', build: function(b) { reader.buildBookmarksPanel(b) } } }
  function quizzesRef(reader) {
    return { id: 'quizzes', label: 'Workbooks', build: function(b) {
      if (window.NativePages) NativePages.buildQuizPanel(reader, b)
    } }
  }
  function imagesRef(reader) {
    return { id: 'images', label: 'Pictures', build: function(b) {
      if (reader.buildImagesPanel) reader.buildImagesPanel(b)
    } }
  }

  // The Contents drawer. Reflowable EPUB and Kalamos books add a Pictures browser; PDFs retain
  // their existing four tabs because page images are already the document itself.
  function openContents(reader, active) {
    var host = (window.BooxDrawer && BooxDrawer.open) ? BooxDrawer : ReaderPanels
    var tabs = [tocRef(reader), quizzesRef(reader), bmRef(reader)]
    if (reader._bxKind === 'book' || reader._bxKind === 'epub') tabs.push(imagesRef(reader))
    tabs.push(
      { id: 'annot', label: 'Annotations', build: function(b) { BooxAnnotations.buildAnnotations(reader, b) } },
      { id: 'hand', label: 'Handwriting', build: function(b) { BooxAnnotations.buildHandwriting(reader, b) } }
    )
    host.open({
      active: active || 'toc',
      tabs: tabs
    })
  }

  // A single-purpose panel (Search / Navigation / Contrast / Format) — one tab, Boox-styled sheet.
  function openFocused(reader, id, label, build) {
    ReaderPanels.open({ active: id, className: 'rp-focused rp-' + id + '-sheet',
      icon: (BooxUI.icons && BooxUI.icons[id]) || '',
      tabs: [{ id: id, label: label, build: build }] })
  }

  function open(reader, tab) {
    if (typeof ReaderPanels === 'undefined') return
    if (tab === 'search') return openFocused(reader, 'search', 'Search', function(b) { reader.buildSearchPanel(b) })
    if (tab === 'contrast') return openFocused(reader, 'contrast', 'Contrast', function(b) { reader.buildContrastPanel(b) })
    if (tab === 'format') {
      // Capture before the panel covers any of the page. BookReader reuses this stable source-text
      // anchor for every control tap in the same session, so repeated changes cannot drift away.
      reader._bxFormatAnchor = reader._topCharOffset ? reader._topCharOffset() : null
      return openFocused(reader, 'format', 'Format', function(b) { reader.buildFormatPanel(b) })
    }
    if (tab === 'nav') {
      reader._bxNavDraft = null
      return openFocused(reader, 'nav', 'Navigation', function(b) { BooxNav.build(reader, b) })
    }
    if (tab === 'bookmarks') return openContents(reader, 'bookmarks')
    if (tab === 'quizzes') return openContents(reader, 'quizzes')
    if (tab === 'images') return openContents(reader, 'images')
    return openContents(reader, 'toc')   // 'toc' / default = Contents drawer
  }

  return { open: open, openContents: openContents }
})()

// ---------------------------------------------------------------------------
// Progress panel (WP4). A bespoke Boox bottom sheet (not a ReaderPanels tab): a
// whole-book slider, prev/next chapter, and a quick-action row (auto page-turn +
// position undo/redo live; TTS/Preview/Blank Page = coming soon). Reuses each
// reader's own navigation (pdf gotoPage; epub spineIdx+renderChapter; book
// sec+renderSection), so position/persistence stay engine-owned.
// ---------------------------------------------------------------------------
window.BooxProgress = (function() {

  var el = BooxUI.el
  var autoTimer = null
  var hist = { reader: null, stack: [], at: -1 }   // in-session position history (per open reader)

  // Per-format progress model: slider domain + how to jump + labels + chapter list.
  function model(reader) {
    var kind = reader._bxKind
    if (kind === 'pdf') {
      var outline = pdfOutline(reader)
      return {
        value: reader.pageIndex, max: Math.max(0, reader.pages - 1),
        goto: function(v) { reader.gotoPage(v | 0) },
        pos: function() { return reader.pageIndex },
        label: function(v) { return (v + 1) + ' / ' + reader.pages },
        chapterStarts: outline.map(function(e) { return e.pageIndex || 0 })
      }
    }
    var spine = (reader.manifest && reader.manifest.spine) || []
    var idxOf = function() { return kind === 'book' ? reader.sec : reader.spineIdx }
    return {
      value: idxOf(), max: Math.max(0, spine.length - 1),
      goto: function(v) { gotoChapter(reader, kind, v | 0) },
      pos: idxOf,
      label: function(v) {
        var t = (spine[v] && (spine[v].title || spine[v].label)) || ('Chapter ' + (v + 1))
        return t + '  ·  ' + (v + 1) + ' / ' + spine.length
      },
      chapterStarts: spine.map(function(_, i) { return i })
    }
  }

  function pdfOutline(reader) {
    try {
      var raw = (typeof Bridge !== 'undefined' && Bridge.pdfOutline) ? Bridge.pdfOutline(reader.nbId) : '[]'
      var arr = JSON.parse(raw || '[]')
      return Array.isArray(arr) ? arr : []
    } catch (e) { return [] }
  }

  function gotoChapter(reader, kind, si) {
    var spine = (reader.manifest && reader.manifest.spine) || []
    if (si < 0 || si >= spine.length) return
    if (kind === 'book') { reader.sec = si; reader.page = 0; reader.renderSection() }
    else { reader.spineIdx = si; reader.page = 0; reader.renderChapter() }
  }

  // prev/next chapter: nearest chapter-start strictly before / after the current slider value.
  function stepChapter(reader, m, dir) {
    var cur = m.pos(), starts = m.chapterStarts, target = null
    if (dir < 0) {
      for (var i = starts.length - 1; i >= 0; i--) { if (starts[i] < cur) { target = starts[i]; break } }
    } else {
      for (var j = 0; j < starts.length; j++) { if (starts[j] > cur) { target = starts[j]; break } }
    }
    if (target != null) { pushHist(reader, target); m.goto(target) }
  }

  function pushHist(reader, v) {
    if (hist.reader !== reader) { hist = { reader: reader, stack: [], at: -1 } }
    // record where we ARE before the jump, so undo returns here
    var here = model(reader).pos()
    hist.stack = hist.stack.slice(0, hist.at + 1)
    hist.stack.push(here); hist.at = hist.stack.length - 1
  }

  function open(reader) {
    var m = model(reader)
    var sheet = BooxUI.sheet({ title: titleOf(reader) })
    var body = sheet.body

    var srow = el('div', 'bx-prog-row')
    var prev = el('button', 'bx-prog-ch', '|◁'); prev.type = 'button'
    var next = el('button', 'bx-prog-ch', '▷|'); next.type = 'button'
    var slider = document.createElement('input')
    slider.type = 'range'; slider.className = 'bx-prog-slider'
    slider.min = '0'; slider.max = String(m.max); slider.value = String(m.value)
    var num = el('span', 'bx-prog-num', m.label(m.value))
    srow.appendChild(prev); srow.appendChild(slider); srow.appendChild(next); srow.appendChild(num)
    body.appendChild(srow)

    slider.addEventListener('input', function() { num.textContent = m.label(parseInt(slider.value, 10)) })
    slider.addEventListener('change', function() {
      var v = parseInt(slider.value, 10); pushHist(reader, v); m.goto(v)
    })
    prev.addEventListener('click', function() { stepChapter(reader, m, -1); refresh() })
    next.addEventListener('click', function() { stepChapter(reader, m, 1); refresh() })

    var qrow = el('div', 'bx-prog-quick')
    qrow.appendChild(qbtn('undo', 'Undo', function() { undo(reader); refresh() }))
    qrow.appendChild(qbtn('progress', 'TTS', null, true))
    qrow.appendChild(qbtn('nav', autoTimer ? 'Stop Auto' : 'Auto Turn', function() { toggleAuto(reader); refresh() }))
    qrow.appendChild(qbtn('contents', 'Preview', reader._bxKind === 'pdf' ? function() { openPreview(reader) } : null,
      reader._bxKind !== 'pdf'))
    qrow.appendChild(qbtn(
      'format',
      'Insert Page',
      (reader._bxKind === 'pdf' || reader._bxKind === 'epub') && window.NativePages
        ? function() { NativePages.insertAfterCurrent(reader) }
        : null,
      reader._bxKind !== 'pdf' && reader._bxKind !== 'epub'
    ))
    qrow.appendChild(qbtn('back', 'Redo', function() { redo(reader); refresh() }))
    body.appendChild(qrow)

    function refresh() {
      var mm = model(reader)
      slider.max = String(mm.max); slider.value = String(mm.pos())
      num.textContent = mm.label(mm.pos())
    }
  }

  function qbtn(icon, label, onClick, soon) {
    return BooxUI.iconBtn(icon, label, soon ? { soon: true } : { onClick: onClick || function() {} })
  }

  function toggleAuto(reader) {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; BooxUI.toast('Auto page-turn off'); return }
    autoTimer = setInterval(function() { if (reader.nextPage) reader.nextPage() }, 8000)
    BooxUI.toast('Auto page-turn on (8s)')
  }

  function undo(reader) {
    if (hist.reader !== reader || hist.at < 0) return
    var v = hist.stack[hist.at]; hist.at--
    model(reader).goto(v)
  }
  function redo(reader) {
    if (hist.reader !== reader || hist.at + 1 >= hist.stack.length) return
    hist.at++; model(reader).goto(hist.stack[hist.at])
  }

  function openPreview(reader) {
    if (window.BooxPreview && BooxPreview.open) { BooxUI.closeSheet(); BooxPreview.open(reader) }
    else BooxUI.comingSoon()
  }

  function titleOf(reader) {
    return (reader.manifest && reader.manifest.title) || (reader.meta && reader.meta.title) || 'Progress'
  }

  return { open: open }
})()

// ---------------------------------------------------------------------------
// Annotations + Handwriting tabs of the Contents drawer. Live for the typed-block
// "book" format (highlights in sidecar/highlights/<sid>.json, notes in
// sidecar/notes/<sid>/index.json — see book-reader.js); EPUB/PDF have no persistent
// annotation model yet, so they show an empty state.
// ---------------------------------------------------------------------------
window.BooxAnnotations = (function() {

  var el = BooxUI.el
  var CATALOG = 'sidecar/annotations/catalog-v1.json', catalogs = {}, loading = {}

  function loadCatalog(reader, cb) {
    if (catalogs[reader.nbId]) { cb(catalogs[reader.nbId]); return }
    if ((loading[reader.nbId] || (loading[reader.nbId] = [])).push(cb) > 1) return
    BooxBookFileAsync.read(reader.nbId, CATALOG, function(raw) {
      var data = null
      try { data = JSON.parse(raw || 'null') } catch (e) {}
      if (!data || !Array.isArray(data.items)) data = { version: 1, complete: false, items: [] }
      catalogs[reader.nbId] = data
      var cbs = loading[reader.nbId] || []; delete loading[reader.nbId]
      cbs.forEach(function(fn) { fn(data) })
    })
  }
  function saveCatalog(reader, items) {
    var data = { version: 1, complete: true, format: reader._bxKind, items: items }
    catalogs[reader.nbId] = data
    try { Bridge.saveBookFile(reader.nbId, CATALOG, JSON.stringify(data)) } catch (e) {}
  }
  function invalidate(reader) {
    if (!reader) return
    reader._bxAnnotationVersion = (reader._bxAnnotationVersion || 0) + 1
    reader._bxAnnotationsCache = null
    catalogs[reader.nbId] = { version: 1, complete: false, items: [] }
    try { Bridge.saveBookFile(reader.nbId, CATALOG, JSON.stringify(catalogs[reader.nbId])) } catch (e) {}
  }
  function readAsyncJson(reader, path, dflt) {
    return new Promise(function(resolve) {
      BooxBookFileAsync.read(reader.nbId, path, function(raw) {
        var value = dflt
        try { var parsed = JSON.parse(raw || 'null'); if (parsed != null) value = parsed } catch (e) {}
        resolve(value)
      })
    })
  }
  function eachAsync(values, visit) {
    return (values || []).reduce(function(p, value) { return p.then(function() { return visit(value) }) }, Promise.resolve())
  }

  function empty(body, msg) {
    body.innerHTML = ''
    body.appendChild(el('div', 'bx-empty-panel', msg))
  }

  function sectionTitle(reader, sid) {
    var spine = (reader.manifest && reader.manifest.spine) || []
    for (var i = 0; i < spine.length; i++) {
      if ((spine[i].sectionId || spine[i].id) === sid) return spine[i].title || ('Section ' + (i + 1))
    }
    return sid
  }

  // Load one section's highlights + notes from its sidecar (cheap JSON files).
  function sidecarOf(reader, sid) {
    var hl = [], notes = []
    try { hl = JSON.parse(Bridge.getBookFile(reader.nbId, 'sidecar/highlights/' + sid + '.json') || '[]') } catch (e) {}
    try { notes = JSON.parse(Bridge.getBookFile(reader.nbId, 'sidecar/notes/' + sid + '/index.json') || '[]') } catch (e) {}
    return { hl: Array.isArray(hl) ? hl : [], notes: Array.isArray(notes) ? notes : [] }
  }

  function spineSids(reader) {
    return ((reader.manifest && reader.manifest.spine) || []).map(function(s) { return s.sectionId || s.id }).filter(Boolean)
  }

  function indexedValues(reader, kind, file, fallback) {
    var raw = null
    try { raw = Bridge.getBookFile(reader.nbId, 'sidecar/' + kind + '/' + file) } catch (e) {}
    if (raw != null && raw !== '') {
      try { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr } catch (e) {}
    }
    return fallback
  }

  function gatherNotes(reader) {
    var out = []
    indexedValues(reader, 'notes', '_sections.json', spineSids(reader)).forEach(function(sid) {
      sidecarOf(reader, sid).notes.forEach(function(n) {
        var path = 'sidecar/notes/' + sid + '/' + n.noteId + '.json', file = {}
        if (!n.quote) try { file = JSON.parse(Bridge.getBookFile(reader.nbId, path) || '{}') } catch (e) {}
        out.push({ sid: sid, noteId: n.noteId, file: path, anchor: n.anchor, quote: n.quote || file.quote || '',
          strokes: readInk(reader, path), title: sectionTitle(reader, sid) })
      })
    })
    return out
  }

  function jumpToSection(reader, sid) {
    ReaderPanels.close()
    if (reader.jumpTo) reader.jumpTo(sid, null)
  }



  function buildAnnotations(reader, body) {
    if (Array.isArray(reader._bxAnnotationsCache)) { renderAnnotationItems(reader, body, reader._bxAnnotationsCache); return }
    empty(body, 'Loading annotations in the background…')
    loadCatalog(reader, function(catalog) {
      if (!document.contains(body)) return
      if (catalog.complete && catalog.format === reader._bxKind) {
        reader._bxAnnotationsCache = catalog.items
        renderAnnotationItems(reader, body, catalog.items)
        return
      }
      migrateAnnotations(reader, body)
    })
  }

  function migrateAnnotations(reader, body) {
    if (reader._bxAnnotationMigration) return
    var items = [], job, version = reader._bxAnnotationVersion || 0
    if (reader._bxKind === 'book') {
      job = Promise.all([
        readAsyncJson(reader, 'sidecar/highlights/_sections.json', []),
        readAsyncJson(reader, 'sidecar/notes/_sections.json', [])
      ]).then(function(indexes) {
        var all = indexes[0].concat(indexes[1]).filter(function(v, i, a) { return a.indexOf(v) === i })
        return eachAsync(all, function(sid) {
          return Promise.all([
            readAsyncJson(reader, 'sidecar/highlights/' + sid + '.json', []),
            readAsyncJson(reader, 'sidecar/notes/' + sid + '/index.json', [])
          ]).then(function(v) {
            var notes = Array.isArray(v[1]) ? v[1] : []
            ;(Array.isArray(v[0]) ? v[0] : []).forEach(function(h) {
              items.push({ sid: sid, start: h.start, end: h.end,
                hasNote: notes.some(function(n) { var a = n.anchor; return a && a.start === h.start && a.end === h.end }),
                quote: h.quote || null, title: sectionTitle(reader, sid) })
            })
          })
        })
      })
    } else if (reader._bxKind === 'epub') {
      job = readAsyncJson(reader, 'sidecar/highlights/_spines.json', []).then(function(spines) {
        return eachAsync(spines, function(i) {
          return readAsyncJson(reader, 'sidecar/highlights/' + i + '.json', []).then(function(arr) {
            var s = reader.manifest && reader.manifest.spine && reader.manifest.spine[i]
            ;(Array.isArray(arr) ? arr : []).forEach(function(h) {
              items.push({ epubSpine: +i, start: h.start, end: h.end, quote: h.quote || null,
                title: (s && s.title) || ('Chapter ' + (+i + 1)) })
            })
          })
        })
      })
    } else if (reader._bxKind === 'pdf') {
      job = Promise.all([
        readAsyncJson(reader, 'sidecar/pdf-text-highlights/_pages.json', []),
        readAsyncJson(reader, 'sidecar/highlights/_pages.json', [])
      ]).then(function(indexes) {
        return eachAsync(indexes[0], function(p) {
          return readAsyncJson(reader, 'sidecar/pdf-text-highlights/' + p + '.json', []).then(function(arr) {
            ;(Array.isArray(arr) ? arr : []).forEach(function(h) {
              items.push({ pdfPage: +p, pdfText: true, quote: h.quote || 'Text highlight', title: 'Page ' + (+p + 1) })
            })
          })
        }).then(function() {
          return eachAsync(indexes[1], function(p) {
            return Promise.all([
              readAsyncJson(reader, 'sidecar/highlights/' + p + '.json', []),
              readAsyncJson(reader, 'sidecar/notes/' + p + '/index.json', [])
            ]).then(function(v) {
              var notes = Array.isArray(v[1]) ? v[1] : []
              ;(Array.isArray(v[0]) ? v[0] : []).forEach(function(h) {
                items.push({ pdfPage: +p, quote: h.quote || 'Area highlight',
                  hasNote: !!notes.find(function(n) { return h.id && n.highlightId === h.id }), title: 'Page ' + (+p + 1) })
              })
            })
          })
        })
      })
    } else job = Promise.resolve()
    reader._bxAnnotationMigration = job.then(function() {
      if ((reader._bxAnnotationVersion || 0) !== version) { reader._bxAnnotationMigration = null; return }
      reader._bxAnnotationsCache = items; saveCatalog(reader, items); reader._bxAnnotationMigration = null
      if (document.contains(body)) renderAnnotationItems(reader, body, items)
    }).catch(function() { reader._bxAnnotationMigration = null })
  }


  function renderAnnotationItems(reader, body, items) {
    if (!items.length) { empty(body, 'No annotations yet.\n' + (reader._bxKind === 'pdf'
      ? 'Drag over PDF text to highlight it.' : 'Select text while reading to highlight it.')); return }
    body.innerHTML = ''
    ReaderPanels.paginateList(body, items, function(a) {
      var row = el('div', 'bx-annot-row')
      var q = el('div', 'bx-annot-quote', a.quote || (a.hasNote ? 'Note' : 'Highlight'))
      var meta = el('div', 'bx-annot-meta', a.title + (a.hasNote ? '  ·  ✎ note' : ''))
      row.appendChild(q); row.appendChild(meta)
      row.addEventListener('click', function() {
        ReaderPanels.close()
        if (a.pdfPage != null) {
          if (a.pdfText && !reader.articleMode && reader.setArticleMode) reader.setArticleMode(true)
          if (reader.gotoPage) reader.gotoPage(a.pdfPage)
        }
        else if (a.epubSpine != null) { if (reader.jumpToToc) reader.jumpToToc({ spineIdx: a.epubSpine }) }
        else jumpToSection(reader, a.sid)
      })
      return row
    }, (body.closest && body.closest('.bx-drawer')) ? 10 : 6)
  }

  // EPUB notes: same sidecar/notes/<spineIdx>/index.json layout, keyed by spine index.
  function gatherEpubNotes(reader) {
    var out = []
    var spine = (reader.manifest && reader.manifest.spine) || []
    var indexes = indexedValues(reader, 'notes', '_spines.json', spine.map(function(_, i) { return i }))
    for (var ii = 0; ii < indexes.length; ii++) {
      var i = indexes[ii]
      var arr = []
      try { arr = JSON.parse(Bridge.getBookFile(reader.nbId, 'sidecar/notes/' + i + '/index.json') || '[]') } catch (e) {}
      var title = (spine[i] && spine[i].title) || ('Chapter ' + (i + 1))
      arr.forEach(function(n) {
        var path = 'sidecar/notes/' + i + '/' + n.noteId + '.json', file = {}
        if (!n.quote) try { file = JSON.parse(Bridge.getBookFile(reader.nbId, path) || '{}') } catch (e) {}
        out.push({ epubSpine: i, noteId: n.noteId, file: path, anchor: n.anchor, quote: n.quote || file.quote || '',
          strokes: readInk(reader, path), title: title })
      })
    }
    return out
  }

  function gatherPdfNotes(reader) {
    if (!window.BooxPdfAnnots) return []
    return BooxPdfAnnots.gatherNotes(reader).map(function(n) {
      return { pdfPage: n.page, noteId: n.noteId, file: 'sidecar/notes/' + n.page + '/' + n.noteId + '.json',
        quote: n.quote || '', strokes: n.strokes || [], title: 'Page ' + (n.page + 1) }
    })
  }

  function readInk(reader, path) {
    try {
      var preview = window.BooxInkPreviewPath ? BooxInkPreviewPath(path) : path
      var raw = Bridge.getBookFile(reader.nbId, preview) || Bridge.getBookFile(reader.nbId, path) || '{}'
      var j = JSON.parse(raw); return Array.isArray(j.strokes) ? j.strokes : []
    }
    catch (e) { return [] }
  }

  function gatherPageInk(reader) {
    var out = []
    if (reader._bxKind === 'pdf') {
      var pages = []
      try { pages = JSON.parse(Bridge.getBookFile(reader.nbId, 'sidecar/handwriting/pdf/_pages.json') || '[]') } catch (e) {}
      pages.forEach(function(p) { var file = 'sidecar/handwriting/pdf/' + p + '.json'; out.push({ pdfPage: p, file: file,
        pageInk: true, quote: 'On-page handwriting', strokes: readInk(reader, file), title: 'Page ' + (p + 1) }) })
    } else if (reader._bxKind === 'epub') {
      var spine = (reader.manifest && reader.manifest.spine) || []
      spine.forEach(function(s, i) {
        var idx = []
        try { idx = JSON.parse(Bridge.getBookFile(reader.nbId, 'sidecar/handwriting/epub/' + i + '/index.json') || '[]') } catch (e) {}
        idx.forEach(function(ent) { var file = 'sidecar/handwriting/epub/' + i + '/' + ent.id + '.json'; out.push({
          epubSpine: i, epubOffset: ent.charOffset || 0, file: file, pageInk: true,
          quote: 'On-page handwriting', strokes: readInk(reader, file),
          title: (s && s.title) || ('Chapter ' + (i + 1)) }) })
      })
    } else if (reader._bxKind === 'book') {
      var entries = []
      try { entries = JSON.parse(Bridge.getBookFile(reader.nbId, 'sidecar/handwriting/book/_entries.json') || '[]') } catch (e) {}
      entries.forEach(function(ent) { out.push({ sid: ent.sectionId, bookPage: ent.page || 0, file: ent.file, pageInk: true,
        quote: 'On-page handwriting', strokes: readInk(reader, ent.file), title: sectionTitle(reader, ent.sectionId) }) })
    }
    return out.filter(function(n) { return n.strokes && n.strokes.length })
  }

  function inkPreview(strokes) {
    var box = el('div', 'bx-hand-preview')
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    ;(strokes || []).slice(0, 24).forEach(function(st) {
      if (!st || !st.length) return
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
      line.setAttribute('points', st.map(function(p) { return (p[0] * 100) + ',' + (p[1] * 100) }).join(' '))
      line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#000'); line.setAttribute('stroke-width', '2')
      line.setAttribute('stroke-linecap', 'round'); line.setAttribute('stroke-linejoin', 'round'); svg.appendChild(line)
    })
    box.appendChild(svg); return box
  }

  function legacyCatalogEntry(reader, n) {
    var loc = n.anchor || {}
    if (n.pdfPage != null) loc = { type: 'pdf', pageIndex: n.pdfPage }
    else if (n.epubSpine != null && n.pageInk) loc = { type: 'epub', spineIdx: n.epubSpine, charOffset: n.epubOffset || 0 }
    else if (n.sid && n.pageInk) loc = { type: 'book', sectionId: n.sid, page: n.bookPage || 0 }
    return { id: n.file, file: n.file, kind: n.pageInk ? 'page' : 'sticky', format: reader._bxKind,
      loc: loc, quote: n.quote || '', strokes: window.BooxInkCatalogCompact ? BooxInkCatalogCompact(n.strokes) : (n.strokes || []) }
  }

  function catalogItems(reader, entries) {
    return (entries || []).filter(function(e) { return e && e.format === reader._bxKind }).map(function(e) {
      var loc = e.loc || {}, n = { file: e.file, pageInk: e.kind === 'page', quote: e.quote || '', strokes: e.strokes || [] }
      if (reader._bxKind === 'pdf') {
        n.pdfPage = loc.pageIndex || 0; n.title = 'Page ' + (n.pdfPage + 1)
      } else if (reader._bxKind === 'epub') {
        n.epubSpine = loc.spineIdx || 0; n.epubOffset = loc.charOffset
        var s = reader.manifest && reader.manifest.spine && reader.manifest.spine[n.epubSpine]
        n.title = (s && s.title) || ('Chapter ' + (n.epubSpine + 1))
      } else {
        n.sid = loc.sectionId; n.bookPage = loc.page || 0; n.title = sectionTitle(reader, n.sid)
      }
      return n
    })
  }

  function buildHandwriting(reader, body) {
    var catalog = window.BooxHandCatalog && BooxHandCatalog.load(reader)
    if (catalog && catalog.complete) { buildHandwritingNow(reader, body, catalog); return }
    empty(body, 'Loading handwriting in the background…')
    if (window.BooxHandCatalog) BooxHandCatalog.prime(reader, function(ready) {
      if (!document.contains(body)) return
      if (ready && ready.complete) buildHandwritingNow(reader, body, ready)
      else migrateHandwriting(reader, body)
    })
  }

  function migrateHandwriting(reader, body) {
    if (reader._bxHandMigration) return
    var notes = [], spine = (reader.manifest && reader.manifest.spine) || []
    function preview(file) {
      return readAsyncJson(reader, BooxInkPreviewPath(file), null).then(function(v) {
        if (v && Array.isArray(v.strokes)) return v.strokes
        return readAsyncJson(reader, file, {}).then(function(full) { return Array.isArray(full.strokes) ? full.strokes : [] })
      })
    }
    function sticky(formatKey, locKey, idx, title) {
      return readAsyncJson(reader, 'sidecar/notes/' + formatKey + '/index.json', []).then(function(arr) {
        return eachAsync(Array.isArray(arr) ? arr : [], function(n) {
          var file = 'sidecar/notes/' + formatKey + '/' + n.noteId + '.json'
          return Promise.all([preview(file), n.quote ? Promise.resolve({}) : readAsyncJson(reader, file, {})]).then(function(v) {
            var item = { noteId: n.noteId, file: file, anchor: n.anchor, quote: n.quote || v[1].quote || '', strokes: v[0], title: title }
            item[locKey] = idx; notes.push(item)
          })
        })
      })
    }
    var job
    if (reader._bxKind === 'book') {
      job = Promise.all([
        readAsyncJson(reader, 'sidecar/notes/_sections.json', []),
        readAsyncJson(reader, 'sidecar/handwriting/book/_entries.json', [])
      ]).then(function(v) {
        return eachAsync(v[0], function(sid) { return sticky(sid, 'sid', sid, sectionTitle(reader, sid)) })
          .then(function() { return eachAsync(v[1], function(ent) {
            return preview(ent.file).then(function(strokes) { if (strokes.length) notes.push({ sid: ent.sectionId,
              bookPage: ent.page || 0, file: ent.file, pageInk: true, quote: 'On-page handwriting',
              strokes: strokes, title: sectionTitle(reader, ent.sectionId) }) })
          }) })
      })
    } else if (reader._bxKind === 'epub') {
      job = readAsyncJson(reader, 'sidecar/notes/_spines.json', []).then(function(indexes) {
        return eachAsync(indexes, function(i) {
          var s = spine[i], title = (s && s.title) || ('Chapter ' + (+i + 1))
          return sticky(i, 'epubSpine', +i, title)
        }).then(function() { return eachAsync(spine.map(function(_, i) { return i }), function(i) {
          return readAsyncJson(reader, 'sidecar/handwriting/epub/' + i + '/index.json', []).then(function(entries) {
            return eachAsync(entries, function(ent) {
              var file = 'sidecar/handwriting/epub/' + i + '/' + ent.id + '.json'
              return preview(file).then(function(strokes) { if (strokes.length) notes.push({ epubSpine: i,
                epubOffset: ent.charOffset || 0, file: file, pageInk: true, quote: 'On-page handwriting',
                strokes: strokes, title: (spine[i] && spine[i].title) || ('Chapter ' + (i + 1)) }) })
            })
          })
        }) })
      })
    } else if (reader._bxKind === 'pdf') {
      job = Promise.all([
        readAsyncJson(reader, 'sidecar/notes/_pages.json', []),
        readAsyncJson(reader, 'sidecar/handwriting/pdf/_pages.json', [])
      ]).then(function(v) {
        return eachAsync(v[0], function(p) { return sticky(p, 'pdfPage', +p, 'Page ' + (+p + 1)) })
          .then(function() { return eachAsync(v[1], function(p) {
            var file = 'sidecar/handwriting/pdf/' + p + '.json'
            return preview(file).then(function(strokes) { if (strokes.length) notes.push({ pdfPage: +p, file: file,
              pageInk: true, quote: 'On-page handwriting', strokes: strokes, title: 'Page ' + (+p + 1) }) })
          }) })
      })
    } else job = Promise.resolve()
    reader._bxHandMigration = job.then(function() {
      var catalog = BooxHandCatalog.mergeAndComplete(reader, notes.map(function(n) { return legacyCatalogEntry(reader, n) }))
      reader._bxHandMigration = null
      if (document.contains(body)) buildHandwritingNow(reader, body, catalog)
    }).catch(function() { reader._bxHandMigration = null })
  }

  function buildHandwritingNow(reader, body, preparedCatalog) {
    var notes = null, catalog = preparedCatalog || (window.BooxHandCatalog && BooxHandCatalog.load(reader))
    if (catalog && catalog.complete) notes = catalogItems(reader, catalog.entries)
    else {
      notes = reader._bxKind === 'book' ? gatherNotes(reader)
        : reader._bxKind === 'epub' ? gatherEpubNotes(reader)
        : reader._bxKind === 'pdf' ? gatherPdfNotes(reader) : null
      if (!notes) { empty(body, 'Handwriting isn’t available for this format yet.'); return }
      notes = (notes || []).concat(gatherPageInk(reader))
      if (catalog) {
        catalog = BooxHandCatalog.mergeAndComplete(reader, notes.map(function(n) { return legacyCatalogEntry(reader, n) }))
        notes = catalogItems(reader, catalog.entries)
      }
    }
    if (!notes.length) { empty(body, 'No handwritten notes yet.\n' + (reader._bxKind === 'pdf'
      ? 'Tap Notes in the toolbar, then tap the page to drop a note.' : 'Select text and tap “Sticky note” to write one.')); return }
    body.innerHTML = ''
    ReaderPanels.paginateList(body, notes, function(n) {
      var row = el('div', 'bx-hand-row')
      row.appendChild(inkPreview(n.strokes))
      var copy = el('div', 'bx-hand-copy')
      copy.appendChild(el('div', 'bx-hand-label', n.quote || (n.pageInk ? 'On-page handwriting' : 'Sticky note')))
      copy.appendChild(el('div', 'bx-hand-meta', n.title))
      row.appendChild(copy)
      row.addEventListener('click', function() {
        ReaderPanels.close()
        if (n.pdfPage != null) { if (reader.gotoPage) reader.gotoPage(n.pdfPage) }
        else if (n.epubSpine != null) {
          if (n.epubOffset != null && n.epubSpine === reader.spineIdx && reader._gotoCharOffset) reader._gotoCharOffset(n.epubOffset)
          else if (reader.jumpToToc) reader.jumpToToc({ spineIdx: n.epubSpine })
        }
        else jumpToSection(reader, n.sid)
      })
      return row
    }, (body.closest && body.closest('.bx-drawer')) ? 8 : 6)
  }

  return { buildAnnotations: buildAnnotations, buildHandwriting: buildHandwriting, invalidate: invalidate }
})()

// ---------------------------------------------------------------------------
// Navigation panel + NeoReader-style column split (WP6). The base controls (crop
// margins / spread columns / direction / comic / text-reflow article mode) reuse
// the reader's own buildNavPanel; on top we add "column split", which divides the
// rendered page into a cols×rows grid and pages through each cell — zoomed to fill
// the screen — in a chosen reading order. This is the multi-column PDF feature Boox
// calls Article Mode: it works on ANY PDF (scanned included) because it drives the
// native crop-zoom (reader._cropStr) rather than needing an extracted text layer.
// ---------------------------------------------------------------------------
window.BooxNav = (function() {

  var el = BooxUI.el

  // Column-split presets, in the order the icons appear (matches the Boox Navigation "Columns" row):
  // each is a cols×rows grid; '1x1' = whole page (off).
  var PRESETS = [
    { id: '1x1', c: 1, r: 1 }, { id: '2x1', c: 2, r: 1 }, { id: '3x1', c: 3, r: 1 },
    { id: '2x2', c: 2, r: 2 }, { id: '3x2', c: 3, r: 2 }, { id: '2x3', c: 2, r: 3 },
    { id: '3x3', c: 3, r: 3 }
  ]
  function preset(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return PRESETS[0] }
  // Reading orders (Boox "Direction"): Z = row-major L→R, S = row-major R→L, N = column-major from
  // left, И = column-major from right. Each maps a linear cell index to (col,row) in cellRC().
  var ORDERS = [
    { id: 'z', name: 'Z' }, { id: 'zr', name: 'S' }, { id: 'n', name: 'N' }, { id: 'nr', name: 'И' }
  ]

  function split(reader) {
    if (!reader.vs.split) reader.vs.split = { on: false, preset: '1x1', order: 'z' }
    return reader.vs.split
  }
  function textbookOn(reader) { return !!(reader.vs && reader.vs.textbookMode) }
  function textbookRuntime(reader) {
    if (!reader._bxTextbook || reader._bxTextbookBook !== reader.nbId) {
      reader._bxTextbook = { regions: {}, index: 0, requestToken: 0, moving: false, loading: false }
      reader._bxTextbookBook = reader.nbId
    }
    return reader._bxTextbook
  }
  function textbookRegions(reader, page) { return textbookRuntime(reader).regions[page == null ? reader.pageIndex : page] || [] }
  function textbookCrop(reader) {
    var rt = textbookRuntime(reader), regions = textbookRegions(reader)
    var region = regions[Math.max(0, Math.min(regions.length - 1, rt.index))]
    return region && window.PdfTextbookLayout ? PdfTextbookLayout.cropString(region) : null
  }

  function requestTextbookRegions(reader, page, callback) {
    var rt = textbookRuntime(reader)
    if (Object.prototype.hasOwnProperty.call(rt.regions, page)) { callback(rt.regions[page]); return }
    if (!window.BooxPdfAnnots || !BooxPdfAnnots.requestTextLayout || !window.PdfTextbookLayout) {
      callback([]); return
    }
    var started = Date.now()
    BooxPdfAnnots.requestTextLayout(reader, page, function(layout) {
      var result = PdfTextbookLayout.analyze(layout || {}, {
        viewportAspect: Math.max(0.7, Math.min(2.2,
          ((reader._content && reader._content.clientHeight) || window.innerHeight || 840) /
          Math.max(1, (reader._content && reader._content.clientWidth) || window.innerWidth || 674))),
        rtl: !!(reader.isReversed && reader.isReversed()), overlap: 0.20
      })
      rt.regions[page] = result.regions || []
      console.log('DIAG textbookLayout page=' + page + ' elapsed=' + (Date.now() - started) +
        'ms runs=' + ((layout && layout.runs && layout.runs.length) || 0) +
        ' regions=' + rt.regions[page].length)
      callback(rt.regions[page], result)
    })
  }

  function warmTextbookNext(reader) {
    if (!textbookOn(reader)) return
    var next = reader.pageIndex + 1
    if (next >= reader.pages || Object.prototype.hasOwnProperty.call(textbookRuntime(reader).regions, next)) return
    setTimeout(function() {
      if (textbookOn(reader) && reader.pageIndex < next) requestTextbookRegions(reader, next, function() {})
    }, 180)
  }
  function dims(reader) { var p = preset(split(reader).preset); return [p.c, p.r] }
  function cellCount(reader) { var d = dims(reader); return d[0] * d[1] }

  function cellRC(reader, i) {
    var d = dims(reader), C = d[0], R = d[1], order = split(reader).order
    var c, r
    if (order === 'n' || order === 'nr') { c = Math.floor(i / R); r = i % R; if (order === 'nr') c = C - 1 - c }
    else { r = Math.floor(i / C); c = i % C; if (order === 'zr') c = C - 1 - c }
    return { c: c, r: r, C: C, R: R }
  }

  // Effective crop string ("l,t,r,b" %) for the current cell, layered on the user's manual crop.
  function cellCrop(reader) {
    var uc = reader.vs.crop || { l: 0, t: 0, r: 0, b: 0 }
    var x0 = uc.l, x1 = 100 - uc.r, y0 = uc.t, y1 = 100 - uc.b
    var W = x1 - x0, H = y1 - y0
    var rc = cellRC(reader, reader._bxCell || 0)
    var cx0 = x0 + (rc.c / rc.C) * W, cx1 = x0 + ((rc.c + 1) / rc.C) * W
    var cy0 = y0 + (rc.r / rc.R) * H, cy1 = y0 + ((rc.r + 1) / rc.R) * H
    return [round(cx0), round(cy0), round(100 - cx1), round(100 - cy1)].join(',')
  }
  function round(n) { return Math.round(n * 100) / 100 }

  // Wrap the PDF reader's crop + paging so a page turn steps through cells, then pages. Idempotent.
  function ensureWrapped(reader) {
    if (reader._bxSplitWrapped) return
    reader._bxSplitWrapped = true
    reader._bxCell = 0
    var origCrop = reader._cropStr
    reader._cropStr = function() {
      var tc = textbookOn(reader) && textbookCrop(reader)
      return tc || ((split(reader).on) ? cellCrop(reader) : origCrop.apply(this, arguments))
    }
    var origNext = reader.nextPage, origPrev = reader.prevPage, origGoto = reader.gotoPage
    reader.nextPage = function() {
      if (textbookOn(reader)) {
        var rt = textbookRuntime(reader), regions = textbookRegions(reader)
        if (rt.moving) return
        if (rt.index < regions.length - 1) { rt.index++; reader.loadPage(); return }
        if (reader.pageIndex >= reader.pages - 1) return
        rt.moving = true
        requestTextbookRegions(reader, reader.pageIndex + 1, function() {
          rt.index = 0; rt.moving = false; origNext.apply(reader, arguments); warmTextbookNext(reader)
        })
        return
      }
      if (split(reader).on) {
        if ((reader._bxCell || 0) < cellCount(reader) - 1) { reader._bxCell = (reader._bxCell || 0) + 1; reader.loadPage(); return }
        reader._bxCell = 0
      }
      return origNext.apply(this, arguments)
    }
    reader.prevPage = function() {
      if (textbookOn(reader)) {
        var rt = textbookRuntime(reader), regions = textbookRegions(reader)
        if (rt.moving) return
        if (rt.index > 0) { rt.index--; reader.loadPage(); return }
        if (reader.pageIndex <= 0) return
        rt.moving = true
        requestTextbookRegions(reader, reader.pageIndex - 1, function(previous) {
          rt.index = Math.max(0, previous.length - 1); rt.moving = false; origPrev.apply(reader, arguments)
        })
        return
      }
      if (split(reader).on) {
        if ((reader._bxCell || 0) > 0) { reader._bxCell = reader._bxCell - 1; reader.loadPage(); return }
        if (reader.pageIndex > 0) { reader._bxCell = cellCount(reader) - 1; return origPrev.apply(this, arguments) }
        return
      }
      return origPrev.apply(this, arguments)
    }
    reader.gotoPage = function(idx) {
      reader._bxCell = 0
      if (textbookOn(reader)) {
        var rt = textbookRuntime(reader), target = Math.max(0, Math.min(reader.pages - 1, idx | 0))
        if (rt.moving) return
        rt.moving = true
        requestTextbookRegions(reader, target, function() {
          rt.index = 0; rt.moving = false; origGoto.call(reader, target); warmTextbookNext(reader)
        })
        return
      }
      return origGoto.apply(this, arguments)
    }
  }

  function setTextbookMode(reader, on, quiet) {
    on = !!on
    var rt = textbookRuntime(reader), token = ++rt.requestToken
    if (!on) {
      reader.vs.textbookMode = false; rt.index = 0; rt.moving = false; rt.loading = false
      if (reader._saveView) reader._saveView()
      if (reader._onViewChanged) reader._onViewChanged(); else reader.loadPage()
      if (!quiet) BooxUI.toast('Showing the original PDF page')
      if (window.BooxChrome) BooxChrome.refresh(reader)
      return
    }
    if (reader.articleMode && reader.setArticleMode) reader.setArticleMode(false)
    split(reader).on = false; split(reader).preset = '1x1'
    reader.vs.columns = 1
    reader.vs.crop = { l: 0, t: 0, r: 0, b: 0 }
    ensureWrapped(reader)
    // Acknowledge the first tap immediately. Until the off-thread positioned-text result arrives,
    // _cropStr safely falls back to the already-visible full page and the status says “finding view”.
    rt.index = 0; rt.moving = false; rt.loading = true
    reader.vs.textbookMode = true; reader.vs.articleMode = false
    if (window.BooxChrome) BooxChrome.refresh(reader)
    if (!quiet) BooxUI.toast('Finding readable regions…')
    requestTextbookRegions(reader, reader.pageIndex, function(regions, result) {
      if (token !== rt.requestToken) return
      rt.loading = false
      if (!regions.length) {
        reader.vs.textbookMode = false
        if (!quiet) BooxUI.toast('No readable regions found on this page')
        if (window.BooxChrome) BooxChrome.refresh(reader)
        return
      }
      if (window.PdfTextLayerProbe) PdfTextLayerProbe.remember(reader, true)
      else reader._hasTextLayer = true
      rt.index = 0; rt.moving = false
      if (reader._saveView) reader._saveView()
      reader._prefetched = {}; reader._prefetchImgs = {}
      if (reader._onViewChanged) reader._onViewChanged(); else reader.loadPage()
      if (!quiet) BooxUI.toast((result && result.columns === 2 ? 'Main reading lane' : 'Page width') +
        ' · ' + regions.length + ' overlapping views')
      warmTextbookNext(reader)
      if (window.BooxChrome) BooxChrome.refresh(reader)
    })
  }

  function resumeTextbook(reader) {
    setTextbookMode(reader, true, true)
  }


  // ---- visual Navigation crop editor -------------------------------------------------------------
  // All changes stay in a draft until Apply. The page miniature shows the retained crop and the
  // numbered column traversal together, matching the supplied XReader reference.
  function build(reader, body) {
    body.innerHTML = ''
    var sheet = body.closest && body.closest('.rp-sheet')
    if (sheet) sheet.classList.add('bx-nav-sheet')
    var draft = navDraft(reader)
    var p = preset(draft.preset), C = p.c, R = p.r
    var model = { vs: { split: { on: draft.preset !== '1x1', preset: draft.preset, order: draft.order } } }
    var cropBox = null, cropRow = null, columnsRow = null, directionRow = null

    var editor = el('div', 'bx-nav-editor')
    editor.appendChild(readingMode(reader))
    var stage = el('div', 'bx-nav-stage')
    var frame = el('div', 'bx-nav-frame')
    var img = el('img', 'bx-nav-img')
    img.draggable = false
    img.src = previewSrc(reader)
    img.addEventListener('error', function() { img.style.display = 'none'; frame.classList.add('bx-nav-noimg') })
    frame.appendChild(img)
    cropBox = cropOverlay(reader, body, draft, model, C, R)
    frame.appendChild(cropBox)
    stage.appendChild(frame)
    editor.appendChild(stage)

    var actions = el('div', 'bx-nav-actions')
    actions.appendChild(actionBtn('Cancel', false, function() {
      reader._bxNavDraft = null; ReaderPanels.close()
    }))
    actions.appendChild(actionBtn('Reset', false, function() {
      reader._bxNavDraft = freshDraft()
      draft = reader._bxNavDraft
      setCropBox(cropBox, draft.crop)
      refreshDraftUi()
    }))
    actions.appendChild(actionBtn('Apply', true, function() {
      reader._bxNavDraft = null
      ReaderPanels.close()
      setTimeout(function() { applyDraft(reader, draft) }, 0)
    }))
    editor.appendChild(actions)

    // Crop: single | double (page spread) — double shows two source pages side by side.
    cropRow = ctrlRow('Crop', [
      iconChoice(cropIcon(false), draft.columns !== 2),
      iconChoice(cropIcon(true), draft.columns === 2)
    ], function(i) {
      draft.columns = i === 1 ? 2 : 1
      if (draft.columns === 2) draft.preset = '1x1'
      refreshDraftUi()
    })
    editor.appendChild(cropRow)

    // Columns: the split grid presets (1x1 … 3x3) as grid icons.
    columnsRow = ctrlRow('Columns', PRESETS.map(function(presetItem) {
      return iconChoice(gridIcon(presetItem.c, presetItem.r), draft.preset === presetItem.id)
    }), function(i) {
      draft.preset = PRESETS[i].id
      if (draft.preset !== '1x1') draft.columns = 1
      refreshDraftUi()
    })
    editor.appendChild(columnsRow)

    // Direction: Z / S / N / И reading-order patterns (only meaningful once split is on).
    directionRow = ctrlRow('Direction', ORDERS.map(function(o) {
      return iconChoice(dirIcon(o.id), draft.order === o.id)
    }), function(i) {
      draft.order = ORDERS[i].id
      refreshDraftUi()
    })
    editor.appendChild(directionRow)
    body.appendChild(editor)

    function refreshDraftUi() {
      p = preset(draft.preset); C = p.c; R = p.r
      model.vs.split.on = draft.preset !== '1x1'
      model.vs.split.preset = draft.preset
      model.vs.split.order = draft.order
      var oldGrid = cropBox && cropBox.querySelector('.bx-nav-grid')
      if (oldGrid) oldGrid.replaceWith(gridOverlay(model, C, R))
      markChoice(cropRow, draft.columns === 2 ? 1 : 0)
      markChoice(columnsRow, PRESETS.findIndex(function(item) { return item.id === draft.preset }))
      markChoice(directionRow, ORDERS.findIndex(function(item) { return item.id === draft.order }))
    }
  }

  // Three honest choices: the exact page, structure-preserving raster regions, or plain extracted
  // text. Textbook view is the default recommendation for technical PDFs because no equation,
  // diagram, colour or publisher styling is reconstructed.
  function readingMode(reader) {
    // Unknown is intentionally enabled: Textbook can prove availability from its asynchronous page
    // layout, while Reflow performs the document-wide PDFBox probe off the UI thread on demand.
    var hasText = reader._hasTextLayer !== false
    var textbook = textbookOn(reader)
    var row = el('div', 'bx-nav-reading')
    var copy = el('div', 'bx-nav-reading-copy')
    copy.appendChild(el('div', 'bx-nav-reading-title', 'PDF reading mode'))
    copy.appendChild(el('div', 'bx-nav-reading-note', hasText
      ? (reader.articleMode ? 'Extracted text reflows; complex layout may be lost.' : (textbook
        ? 'Follows the main reading lane with repeated context; side notes remain in Page view.'
        : 'Choose exact page, layout-preserving regions, or extracted text.'))
      : 'This page has no selectable text. Use Crop and Columns below to enlarge it.'))
    row.appendChild(copy)
    var actions = el('div', 'bx-nav-reading-actions')
    var page = el('button', 'bx-nav-reading-btn' + (!reader.articleMode && !textbook ? ' on' : ''), 'Page')
    var tb = el('button', 'bx-nav-reading-btn' + (textbook ? ' on' : ''), 'Textbook')
    var reflow = el('button', 'bx-nav-reading-btn' + (reader.articleMode ? ' on' : ''), 'Reflow')
    ;[page, tb, reflow].forEach(function(button) { button.type = 'button'; actions.appendChild(button) })
    tb.disabled = reflow.disabled = !hasText
    page.addEventListener('click', function() {
      ReaderPanels.close(); setTimeout(function() {
        if (reader.articleMode) reader.setArticleMode(false)
        else if (textbookOn(reader)) setTextbookMode(reader, false)
      }, 0)
    })
    if (hasText) {
      tb.addEventListener('click', function() {
        ReaderPanels.close(); setTimeout(function() { setTextbookMode(reader, true) }, 0)
      })
      reflow.addEventListener('click', function() {
        ReaderPanels.close(); setTimeout(function() {
          if (textbookOn(reader)) { reader.vs.textbookMode = false; textbookRuntime(reader).index = 0 }
          reader.setArticleMode(true)
        }, 0)
      })
    }
    row.appendChild(actions)
    return row
  }

  function freshDraft() {
    return { crop: { l: 0, t: 0, r: 0, b: 0 }, columns: 1, preset: '1x1', order: 'z' }
  }
  function navDraft(reader) {
    if (!reader._bxNavDraft) {
      var c = reader.vs.crop || {}
      var sp = split(reader)
      reader._bxNavDraft = {
        crop: { l: +c.l || 0, t: +c.t || 0, r: +c.r || 0, b: +c.b || 0 },
        columns: reader.vs.columns === 2 ? 2 : 1,
        preset: sp.preset || '1x1',
        order: sp.order || 'z'
      }
    }
    return reader._bxNavDraft
  }
  function applyDraft(reader, draft) {
    reader.vs.crop = { l: round(draft.crop.l), t: round(draft.crop.t), r: round(draft.crop.r), b: round(draft.crop.b) }
    reader.vs.columns = draft.columns
    var sp = split(reader)
    sp.preset = draft.preset; sp.order = draft.order; sp.on = draft.preset !== '1x1'
    reader.vs.textbookMode = false
    reader._bxCell = 0
    if (sp.on) { reader.vs.columns = 1; ensureWrapped(reader) }
    reader._onViewChanged()
    if (window.BooxChrome) BooxChrome.refresh(reader)
  }
  function actionBtn(label, primary, fn) {
    var b = el('button', 'bx-nav-action' + (primary ? ' primary' : ''), label)
    b.type = 'button'; b.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); fn() })
    return b
  }

  // Always show the full source page: the crop rectangle itself visualises what will be retained.
  function previewSrc(reader) {
    var qs = 'w=520&e=' + reader.vs.embolden + '&d=' + reader.vs.dark + '&crop=0,0,0,0'
    return reader.isDevice() ? ('https://kalamos.content/pdf/' + reader.nbId + '/' + reader.pageIndex + '.png?' + qs)
                             : ('/pdfpage/' + reader.nbId + '/' + reader.pageIndex + '.png?' + qs)
  }

  function cropOverlay(reader, body, draft, model, C, R) {
    var crop = el('div', 'bx-nav-cropbox')
    setCropBox(crop, draft.crop)
    crop.appendChild(gridOverlay(model, C, R))
    ;['l', 'r', 't', 'b', 'lt', 'rt', 'lb', 'rb'].forEach(function(edge) {
      var h = el('div', 'bx-nav-handle bx-nav-h-' + edge); h.dataset.edge = edge
      h.addEventListener('pointerdown', function(e) {
        e.preventDefault(); e.stopPropagation()
        var frame = crop.parentNode, rect = frame.getBoundingClientRect()
        var pointerId = e.pointerId
        var raf = 0, lastX = e.clientX, lastY = e.clientY
        crop.classList.add('dragging')
        if (h.setPointerCapture) try { h.setPointerCapture(pointerId) } catch (err) {}
        function move(ev) {
          lastX = ev.clientX; lastY = ev.clientY
          if (raf) return
          raf = requestAnimationFrame(applyMove)
          ev.preventDefault(); ev.stopPropagation()
        }
        function applyMove() {
          raf = 0
          var x = Math.max(0, Math.min(100, (lastX - rect.left) / rect.width * 100))
          var y = Math.max(0, Math.min(100, (lastY - rect.top) / rect.height * 100))
          var oldL = draft.crop.l, oldR = draft.crop.r, oldT = draft.crop.t, oldB = draft.crop.b
          if (edge.indexOf('l') !== -1) draft.crop.l = Math.min(x, 95 - draft.crop.r)
          if (edge.indexOf('r') !== -1) draft.crop.r = Math.min(100 - x, 95 - draft.crop.l)
          if (edge.indexOf('t') !== -1) draft.crop.t = Math.min(y, 95 - draft.crop.b)
          if (edge.indexOf('b') !== -1) draft.crop.b = Math.min(100 - y, 95 - draft.crop.t)
          if (Math.abs(oldL - draft.crop.l) >= 0.15 || Math.abs(oldR - draft.crop.r) >= 0.15 ||
              Math.abs(oldT - draft.crop.t) >= 0.15 || Math.abs(oldB - draft.crop.b) >= 0.15) {
            setCropBox(crop, draft.crop)
          }
        }
        function up(ev) {
          if (raf) { cancelAnimationFrame(raf); raf = 0; applyMove() }
          crop.classList.remove('dragging')
          if (h.releasePointerCapture) try { h.releasePointerCapture(pointerId) } catch (err) {}
          h.removeEventListener('pointermove', move)
          h.removeEventListener('pointerup', up)
          h.removeEventListener('pointercancel', up)
          if (ev) { ev.preventDefault(); ev.stopPropagation() }
        }
        h.addEventListener('pointermove', move)
        h.addEventListener('pointerup', up)
        h.addEventListener('pointercancel', up)
        move(e)
      })
      crop.appendChild(h)
    })
    return crop
  }
  function setCropBox(node, c) {
    var parent = node.parentNode
    var wPct = Math.max(1, 100 - c.l - c.r), hPct = Math.max(1, 100 - c.t - c.b)
    if (!parent) {
      node.style.left = c.l + '%'; node.style.top = c.t + '%'
      node.style.right = c.r + '%'; node.style.bottom = c.b + '%'
      return
    }
    var rect = parent.getBoundingClientRect()
    node.style.left = '0px'; node.style.top = '0px'; node.style.right = 'auto'; node.style.bottom = 'auto'
    node.style.width = (rect.width * wPct / 100) + 'px'
    node.style.height = (rect.height * hPct / 100) + 'px'
    node.style.transform = 'translate3d(' + (rect.width * c.l / 100) + 'px,' + (rect.height * c.t / 100) + 'px,0)'
  }

  // dashed grid + numbered circles positioned at each cell centre in reading order.
  function gridOverlay(reader, C, R) {
    var ov = el('div', 'bx-nav-grid')
    var i, pos
    for (i = 1; i < C; i++) { var vl = el('div', 'bx-nav-vline'); vl.style.left = (i / C * 100) + '%'; ov.appendChild(vl) }
    for (i = 1; i < R; i++) { var hl = el('div', 'bx-nav-hline'); hl.style.top = (i / R * 100) + '%'; ov.appendChild(hl) }
    if (split(reader).on) {
      var n = C * R
      for (i = 0; i < n; i++) {
        var rc = cellRC(reader, i)
        var num = el('div', 'bx-nav-num', String(i + 1))
        num.style.left = ((rc.c + 0.5) / C * 100) + '%'
        num.style.top = ((rc.r + 0.5) / R * 100) + '%'
        ov.appendChild(num)
      }
    }
    return ov
  }

  // a labelled row of icon choices (Crop / Columns / Direction). choices = [svgString...].
  function ctrlRow(label, choices, onPick) {
    var row = el('div', 'bx-nav-row')
    row.appendChild(el('div', 'bx-nav-rlabel', label))
    var opts = el('div', 'bx-nav-opts')
    choices.forEach(function(c, i) {
      var b = el('button', 'bx-nav-opt' + (c.on ? ' on' : ''))
      b.type = 'button'; b.innerHTML = c.svg
      b.addEventListener('click', function() { onPick(i) })
      opts.appendChild(b)
    })
    row.appendChild(opts)
    return row
  }
  function markChoice(row, idx) {
    if (!row) return
    var opts = row.querySelectorAll('.bx-nav-opt')
    for (var i = 0; i < opts.length; i++) opts[i].classList.toggle('on', i === idx)
  }
  function iconChoice(svg, on) { return { svg: svg, on: on } }

  // --- inline SVG icons (stroke via CSS currentColor) ---
  function gridIcon(C, R) {
    var s = '<svg viewBox="0 0 28 28"><rect x="3" y="3" width="22" height="22" rx="3"/>'
    var i
    for (i = 1; i < C; i++) s += '<line x1="' + (3 + i * 22 / C) + '" y1="3" x2="' + (3 + i * 22 / C) + '" y2="25" stroke-dasharray="2 2"/>'
    for (i = 1; i < R; i++) s += '<line x1="3" y1="' + (3 + i * 22 / R) + '" x2="25" y2="' + (3 + i * 22 / R) + '" stroke-dasharray="2 2"/>'
    return s + '</svg>'
  }
  function cropIcon(dbl) {
    if (dbl) return '<svg viewBox="0 0 28 28"><rect x="3" y="4" width="22" height="20" rx="2"/><line x1="14" y1="4" x2="14" y2="24"/></svg>'
    return '<svg viewBox="0 0 28 28"><rect x="7" y="4" width="14" height="20" rx="2"/></svg>'
  }
  function dirIcon(id) {
    // small arrow-pattern glyphs; ① marks the start corner.
    if (id === 'z') return '<svg viewBox="0 0 28 28"><path d="M6 8h16M6 20h16M22 8L6 20"/><circle cx="6" cy="8" r="2.4" fill="currentColor"/></svg>'
    if (id === 'zr') return '<svg viewBox="0 0 28 28"><path d="M6 8h16M6 20h16M6 8l16 12"/><circle cx="22" cy="8" r="2.4" fill="currentColor"/></svg>'
    if (id === 'n') return '<svg viewBox="0 0 28 28"><path d="M8 6v16M20 6v16M8 22L20 6"/><circle cx="8" cy="6" r="2.4" fill="currentColor"/></svg>'
    return '<svg viewBox="0 0 28 28"><path d="M8 6v16M20 6v16M20 6L8 22"/><circle cx="20" cy="6" r="2.4" fill="currentColor"/></svg>'
  }

  // Exposed so BooxChrome.pageInfo can annotate the status strip with the cell position.
  function status(reader) {
    if (textbookOn(reader)) {
      var regions = textbookRegions(reader), rt = textbookRuntime(reader)
      return regions.length ? (' · view ' + (rt.index + 1) + '/' + regions.length) : ' · finding view'
    }
    var sp = reader.vs && reader.vs.split
    if (!sp || !sp.on) return ''
    return ' · cell ' + ((reader._bxCell || 0) + 1) + '/' + cellCount(reader)
  }

  return { build: build, status: status, setTextbookMode: setTextbookMode, resumeTextbook: resumeTextbook }
})()

// Flip the reader takeover on only when BOTH the chrome and this panel host are present and
// healthy — a half-loaded module then safely falls through to the classic reader UI.
if (window.BooxChrome && window.BooxPanels) Boox.takeover.reader = true
