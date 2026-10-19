// Boox UI — PDF page handwriting notes. PDF text highlights are handled by PdfReader's selectable
// article-mode text layer, not by drawing rectangles over the rendered bitmap. Existing legacy
// rectangle highlights are still displayed/deletable here, but no new raster highlights are created.
// Sticky notes are POINTS, stored per page index in page-percent coordinates (0–100 of the full page).
// Because they're page-relative, they map correctly through the current crop / contrast / zoom.
//
// BooxInk is a shared daemon ink box (the note surface) usable by any reader — PDF has no ink box of
// its own. Pen strokes are device-only (the daemon is a no-op in the browser preview), but the note
// model, box UI, markers and persistence work everywhere.

window.BooxInkCompact = function(strokes) {
  return (strokes || []).slice(0, 24).map(function(st) {
    if (!st || st.length <= 48) return st || []
    var out = [], step = Math.ceil(st.length / 48)
    for (var i = 0; i < st.length; i += step) out.push(st[i])
    if (out[out.length - 1] !== st[st.length - 1]) out.push(st[st.length - 1])
    return out
  })
}
window.BooxInkCatalogCompact = function(strokes) {
  return (strokes || []).slice(0, 8).map(function(st) {
    if (!st || st.length <= 16) return st || []
    var out = [], step = Math.ceil(st.length / 16)
    for (var i = 0; i < st.length; i += step) out.push(st[i])
    return out
  })
}
window.BooxInkPreviewPath = function(path) { return String(path || '').replace(/\.json$/, '.preview.json') }
window.BooxBookFileAsync = (function() {
  var seq = 0, pending = {}
  window.onBookFileReady = function(id, value) {
    var cb = pending[id]; if (!cb) return
    delete pending[id]; cb(value || '')
  }
  function read(nbId, path, cb) {
    var id = 'bf:' + (++seq) + ':' + Date.now().toString(36)
    pending[id] = cb
    if (Bridge.requestBookFile) Bridge.requestBookFile(nbId, path, id)
    else setTimeout(function() {
      var raw = ''; try { raw = Bridge.getBookFile(nbId, path) || '' } catch (e) {}
      window.onBookFileReady(id, raw)
    }, 0)
  }
  return { read: read }
})()
window.BooxHandCatalog = (function() {
  var PATH = 'sidecar/handwriting/catalog-v1.json', cache = {}, loading = {}
  function blank() { return { version: 1, complete: false, entries: [] } }
  function parse(raw) {
    var data = null
    try { data = JSON.parse(raw || 'null') } catch (e) {}
    return data && Array.isArray(data.entries) ? data : blank()
  }
  function load(reader) {
    var id = reader.nbId
    if (cache[id]) return cache[id]
    return null
  }
  function prime(reader, cb) {
    var id = reader.nbId
    if (cache[id]) { if (cb) cb(cache[id]); return }
    if (cb) (loading[id] || (loading[id] = [])).push(cb)
    if (loading[id] && loading[id]._started) return
    if (!loading[id]) loading[id] = []
    loading[id]._started = true
    BooxBookFileAsync.read(id, PATH, function(raw) {
      cache[id] = parse(raw)
      var cbs = loading[id] || []; delete loading[id]
      cbs.forEach(function(fn) { try { fn(cache[id]) } catch (e) {} })
    })
  }
  function save(reader, data) {
    cache[reader.nbId] = data
    try { Bridge.saveBookFile(reader.nbId, PATH, JSON.stringify(data)) } catch (e) {}
  }
  function upsert(reader, entry) {
    if (!entry || !entry.id) return
    function put(data) {
      data = data || blank()
      var at = data.entries.findIndex(function(e) { return e.id === entry.id })
      if (at === -1) data.entries.push(entry); else data.entries[at] = entry
      save(reader, data)
    }
    var data = load(reader); if (data) put(data); else prime(reader, put)
  }
  function mergeAndComplete(reader, entries) {
    var data = load(reader) || blank()
    ;(entries || []).forEach(function(entry) {
      if (!entry || !entry.id) return
      var at = data.entries.findIndex(function(e) { return e.id === entry.id })
      if (at === -1) data.entries.push(entry); else data.entries[at] = entry
    })
    data.complete = true; save(reader, data); return data
  }
  return { load: load, prime: prime, upsert: upsert, mergeAndComplete: mergeAndComplete }
})()

// ---- shared ink box (daemon) --------------------------------------------------------------------
window.BooxInk = (function() {
  var el = BooxUI.el
  var A = null   // active box: { reader, file, anchor, strokes, wrap, box, full, onClose }
  var pending = null

  function open(reader, file, anchor, onClose) {
    if (A) {
      pending = [reader, file, anchor, onClose]
      close()
      return
    }
    pending = null
    A = { reader: reader, file: file, anchor: anchor || null, strokes: [], full: false, onClose: onClose || null }
    var wrap = el('div', 'rd-note-wrap'), card = el('div', 'rd-note-card'), box = el('div', 'rd-note-box'); card.appendChild(box)
    var ctl = el('div', 'rd-note-ctl'), done = el('button', 'rd-btn', '✓ Done'), full = el('button', 'rd-btn', '⛶ Full page')
    ctl.appendChild(done); ctl.appendChild(full); card.appendChild(ctl); wrap.appendChild(card); reader.view().appendChild(wrap)
    A.wrap = wrap; A.box = box
    done.addEventListener('click', close)
    full.addEventListener('click', function() {
      A.full = !A.full; card.classList.toggle('full', A.full); full.textContent = A.full ? '⊟ Window' : '⛶ Full page'
      BooxInk._reattaching = true; Bridge.detachInkBox()
    })
    var opening = A
    BooxBookFileAsync.read(reader.nbId, file, function(raw) {
      if (A !== opening || !A.wrap) return
      try { var j = JSON.parse(raw || '{}'); if (Array.isArray(j.strokes)) A.strokes = j.strokes } catch (e) {}
      requestAnimationFrame(attach)
    })
  }
  function attach() {
    if (!A || !A.box) return
    var r = A.box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, pad = 3
    var L = Math.round((r.left + pad) * dpr), T = Math.round((r.top + pad) * dpr), R = Math.round((r.right - pad) * dpr), B = Math.round((r.bottom - pad) * dpr)
    window._noteSketch = { w: R - L, h: B - T }; window._inkHandler = BooxInk
    // onInkControllerReady immediately renders the authoritative note, so an attach-time blank
    // wake would only produce a redundant first GU16 over this same bounded surface.
    if (Bridge.skipWakeRefresh) Bridge.skipWakeRefresh()
    Bridge.attachInkBox(L, T, R, B); Bridge.setInkStyle(3 * dpr, '#000000')
  }
  function save() { if (A) try {
    Bridge.saveBookFile(A.reader.nbId, A.file, JSON.stringify({ anchor: A.anchor, strokes: A.strokes }))
    Bridge.saveBookFile(A.reader.nbId, BooxInkPreviewPath(A.file), JSON.stringify({ strokes: BooxInkCompact(A.strokes) }))
    BooxHandCatalog.upsert(A.reader, { id: A.file, file: A.file, kind: 'sticky', format: A.reader._bxKind,
      loc: A.anchor || {}, quote: (A.anchor && A.anchor.quote) || '', strokes: BooxInkCatalogCompact(A.strokes) })
  } catch (e) {} }
  function close() {
    if (!A && !document.querySelector('.rd-note-wrap')) return
    if (A && A.wrap) { A.wrap.remove(); A.wrap = null }
    if (A && !A.closing) {
      A.closing = true
      Bridge.detachInkBox()   // flush → onNoteFlushed → finalizeNote (saves + clears A)
    }
  }

  return {
    _reattaching: false,
    open: open, close: close,
    isOpen: function() { return !!(A && A.wrap) },
    attachNoteBox: attach,
    onNoteStrokes: function(strokes) {
      if (!A || !window._noteSketch) return
      var w = window._noteSketch.w || 1, h = window._noteSketch.h || 1
      for (var s = 0; s < strokes.length; s++) { var pts = strokes[s]; if (!pts || !pts.length) continue; var arr = []; for (var i = 0; i < pts.length; i++) arr.push([pts[i][0] / w, pts[i][1] / h]); A.strokes.push(arr) }
      save()
    },
    renderNoteStrokes: function() {
      var ns = window._noteSketch; if (!ns || !A) return
      var dpr = window.devicePixelRatio || 1
      // The following content snapshot owns the one authoritative presentation. Retain strokes in
      // native state now, but do not issue an intermediate full-area GU16 without page content.
      var out = { t: 'blank', sp: 0, mg: 0, dpr: dpr, b: [0, 0, ns.w, ns.h], s: [], defer: 1 }
      A.strokes.forEach(function(st) { if (!st || !st.length) return; var p = []; for (var i = 0; i < st.length; i++) p.push([Math.round(st[i][0] * ns.w), Math.round(st[i][1] * ns.h)]); out.s.push({ w: 3 * dpr, c: '#000000', p: p }) })
      Bridge.renderInk(JSON.stringify(out))
    },
    finalizeNote: function() {
      save(); var cb = A && A.onClose; A = null; window._noteSketch = null; window._inkHandler = null
      if (cb) try { cb() } catch (e) {}
      if (pending) {
        var next = pending; pending = null
        requestAnimationFrame(function() { open(next[0], next[1], next[2], next[3]) })
      }
    }
  }
})()

// ---- full-page handwriting ---------------------------------------------------------------------
// Normal reading keeps ink in a sidecar and paints an SVG preview over the source page. Selecting
// Notes swaps that preview for a daemon-backed surface exactly the size of the visible PDF/EPUB
// paper. The source file is intentionally untouched; export is the place where sidecar ink is
// flattened into a PDF.
window.BooxPageInk = (function() {
  var A = null

  function readJson(reader, path, dflt) {
    var indexed = /(?:index|_pages|_entries)\.json$/.test(path)
    var preview = /\.preview\.json$/.test(path)
    if (preview) {
      if (!reader._bxInkPreviewCache) reader._bxInkPreviewCache = {}
      if (Object.prototype.hasOwnProperty.call(reader._bxInkPreviewCache, path)) return reader._bxInkPreviewCache[path]
    }
    if (indexed) {
      if (!reader._bxPageInkIndexes) reader._bxPageInkIndexes = {}
      if (Object.prototype.hasOwnProperty.call(reader._bxPageInkIndexes, path)) return reader._bxPageInkIndexes[path]
    }
    try {
      var v = JSON.parse(Bridge.getBookFile(reader.nbId, path) || 'null'); v = v == null ? dflt : v
      if (indexed) reader._bxPageInkIndexes[path] = v
      if (preview) reader._bxInkPreviewCache[path] = v
      return v
    } catch (e) { return dflt }
  }
  function writeJson(reader, path, value) {
    try {
      Bridge.saveBookFile(reader.nbId, path, JSON.stringify(value))
      if (/\.preview\.json$/.test(path)) {
        if (!reader._bxInkPreviewCache) reader._bxInkPreviewCache = {}
        reader._bxInkPreviewCache[path] = value
      }
      if (/(?:index|_pages|_entries)\.json$/.test(path)) {
        if (!reader._bxPageInkIndexes) reader._bxPageInkIndexes = {}
        reader._bxPageInkIndexes[path] = value
      }
    } catch (e) {}
  }
  function pdfCrop(reader) {
    var c = reader._cropStr().split(',').map(Number)
    return { x0: (c[0] || 0) / 100, y0: (c[1] || 0) / 100,
      x1: (100 - (c[2] || 0)) / 100, y1: (100 - (c[3] || 0)) / 100 }
  }
  function epubDescriptor(reader, create) {
    if (!reader._pagebox || !document.contains(reader._pagebox)) return null
    var b = reader._nativePageBounds ? reader._nativePageBounds() : { start: (reader._topCharOffset && reader._topCharOffset()) || 0, end: Number.MAX_SAFE_INTEGER }
    var idxPath = 'sidecar/handwriting/epub/' + reader.spineIdx + '/index.json'
    var idx = readJson(reader, idxPath, []); if (!Array.isArray(idx)) idx = []
    var ent = null
    for (var i = 0; i < idx.length; i++) {
      var a = +idx[i].charOffset || 0
      if (a >= b.start && a < b.end) { ent = idx[i]; break }
    }
    if (!ent && create) {
      ent = { id: 'hw-' + Date.now().toString(36), spineIdx: reader.spineIdx, charOffset: b.start }
      idx.push(ent); idx.sort(function(x, y) { return (+x.charOffset || 0) - (+y.charOffset || 0) })
      writeJson(reader, idxPath, idx)
    }
    if (!ent) return null
    return { key: 'epub:' + reader.spineIdx + ':' + ent.id, target: reader._pagebox,
      file: 'sidecar/handwriting/epub/' + reader.spineIdx + '/' + ent.id + '.json', identity: true }
  }
  function descriptor(reader, create) {
    if (!reader) return null
    var nativeEntry = window.NativePages && NativePages.activeEntry && NativePages.activeEntry(reader)
    if (nativeEntry && reader._kp && reader._kp.node) {
      var paper = reader._kp.node.querySelector('.kp-native-paper')
      if (!paper || !document.contains(paper)) return null
      return {
        key: 'native:' + nativeEntry.id,
        target: paper,
        file: 'sidecar/native-pages/' + nativeEntry.id + '/ink.json',
        identity: true,
        nativePageId: nativeEntry.id
      }
    }
    if (reader._bxKind === 'epub') return epubDescriptor(reader, create)
    if (reader._bxKind === 'book') {
      if (!reader._pagebox || !document.contains(reader._pagebox)) return null
      var sid = reader.sectionId ? reader.sectionId() : String(reader.sec || 0)
      return { key: 'book:' + sid + ':' + reader.page, target: reader._pagebox,
        file: 'sidecar/handwriting/book/' + sid + '/' + reader.page + '.json', identity: true,
        sectionId: sid, page: reader.page }
    }
    if (reader._bxKind !== 'pdf' || reader.articleMode || !reader._imgwrap) return null
    var img = reader._imgwrap.querySelector('img.pf-img-full')
    if (!img || !document.contains(img)) return null
    var crop = pdfCrop(reader)
    return { key: 'pdf:' + reader.pageIndex, target: img,
      file: 'sidecar/handwriting/pdf/' + reader.pageIndex + '.json', crop: crop }
  }
  function load(reader, d) {
    var j = readJson(reader, d.file, {})
    return Array.isArray(j.strokes) ? j.strokes : []
  }
  function loadPreview(reader, d) {
    var j = readJson(reader, BooxInkPreviewPath(d.file), null)
    if (!j || !Array.isArray(j.strokes)) j = readJson(reader, d.file, {})
    return Array.isArray(j.strokes) ? j.strokes : []
  }
  function save() {
    if (!A) return
    writeJson(A.reader, A.d.file, { version: 1, anchor: A.anchor, strokes: A.strokes })
    writeJson(A.reader, BooxInkPreviewPath(A.d.file), { strokes: BooxInkCompact(A.strokes) })
    BooxHandCatalog.upsert(A.reader, { id: A.d.file, file: A.d.file, kind: 'page', format: A.reader._bxKind,
      loc: A.anchor || {}, quote: 'On-page handwriting', strokes: BooxInkCatalogCompact(A.strokes) })
    if (A.reader._bxKind === 'pdf' && A.strokes.length) {
      var p = A.reader.pageIndex, path = 'sidecar/handwriting/pdf/_pages.json'
      var pages = readJson(A.reader, path, []); if (!Array.isArray(pages)) pages = []
      if (pages.indexOf(p) === -1) { pages.push(p); pages.sort(function(a, b) { return a - b }); writeJson(A.reader, path, pages) }
    } else if (A.reader._bxKind === 'book' && A.strokes.length) {
      var bpath = 'sidecar/handwriting/book/_entries.json'
      var entries = readJson(A.reader, bpath, []); if (!Array.isArray(entries)) entries = []
      if (!entries.some(function(e) { return e.file === A.d.file })) {
        entries.push({ sectionId: A.d.sectionId, page: A.d.page, file: A.d.file }); writeJson(A.reader, bpath, entries)
      }
    }
  }
  function toStored(d, x, y) {
    if (d.identity) return [x, y]
    return [d.crop.x0 + x * (d.crop.x1 - d.crop.x0), d.crop.y0 + y * (d.crop.y1 - d.crop.y0)]
  }
  function toDisplay(d, p) {
    if (d.identity) return p
    return [(p[0] - d.crop.x0) / (d.crop.x1 - d.crop.x0), (p[1] - d.crop.y0) / (d.crop.y1 - d.crop.y0)]
  }
  function open(reader) {
    var d = descriptor(reader, true); if (!d) return false
    if (A && A.reader === reader && A.d.key === d.key) return true
    if (A) { close(); return false }
    var r = d.target.getBoundingClientRect()
    if (r.width < 20 || r.height < 20) return false
    var previews = reader.view().querySelectorAll('.bx-page-ink-preview')
    Array.prototype.forEach.call(previews, function(n) { n.remove() })
    var dpr = window.devicePixelRatio || 1, pad = 1
    var L = Math.round((r.left + pad) * dpr), T = Math.round((r.top + pad) * dpr)
    var R = Math.round((r.right - pad) * dpr), B = Math.round((r.bottom - pad) * dpr)
    var anchor = d.nativePageId ? { type: 'native', nativePageId: d.nativePageId } :
      reader._bxKind === 'pdf' ? { type: 'pdf', pageIndex: reader.pageIndex } :
      reader._bxKind === 'book' ? { type: 'book', sectionId: d.sectionId, page: d.page } :
        { type: 'epub', spineIdx: reader.spineIdx, charOffset: (reader._nativePageBounds && reader._nativePageBounds().start) || 0 }
    A = { reader: reader, d: d, strokes: load(reader, d), bounds: [L, T, R, B], anchor: anchor }
    window._noteSketch = { w: R - L, h: B - T }
    window._inkHandler = api
    if (Bridge.skipWakeRefresh) Bridge.skipWakeRefresh()
    Bridge.attachInkBox(L, T, R, B)
    Bridge.setInkStyle(3 * dpr, '#000000')
    return true
  }
  function close() {
    if (!A) return
    Bridge.detachInkBox()
  }
  function previewKey(reader) {
    if (!reader) return ''
    var nativeEntry = window.NativePages && NativePages.activeEntry && NativePages.activeEntry(reader)
    if (nativeEntry) return 'native:' + nativeEntry.id
    if (reader._bxKind === 'pdf') return 'pdf:' + reader.pageIndex + ':' + (reader._cropStr ? reader._cropStr() : '')
    if (reader._bxKind === 'book') return 'book:' + (reader.sectionId ? reader.sectionId() : reader.sec) + ':' + reader.page
    return 'epub:' + reader.spineIdx + ':' + reader.page + ':' + ((reader._topCharOffset && reader._topCharOffset()) || 0)
  }
  function redraw(reader, delay) {
    if (!reader || (A && A.reader === reader)) return
    var old = reader.view && reader.view().querySelectorAll('.bx-page-ink-preview')
    var key = previewKey(reader)
    if (old && old.length === 1 && old[0].dataset.previewKey === key) return
    if (old) Array.prototype.forEach.call(old, function(n) { n.remove() })
    clearTimeout(reader._bxPageInkPreviewTimer)
    var seq = (reader._bxPageInkPreviewSeq || 0) + 1; reader._bxPageInkPreviewSeq = seq
    reader._bxPageInkPreviewTimer = setTimeout(function() {
      if (reader._bxPageInkPreviewSeq !== seq || previewKey(reader) !== key || (A && A.reader === reader)) return
      renderPreview(reader, key)
    }, delay == null ? 320 : delay)
  }
  function renderPreview(reader, key) {
    var d = descriptor(reader, false); if (!d) return
    var strokes = loadPreview(reader, d); if (!strokes.length) return
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'bx-page-ink-preview'); svg.setAttribute('viewBox', '0 0 1000 1000')
    svg.dataset.previewKey = key
    strokes.forEach(function(st) {
      if (!st || !st.length) return
      var pts = []
      st.forEach(function(p) { var q = toDisplay(d, p); pts.push((q[0] * 1000) + ',' + (q[1] * 1000)) })
      var pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
      pl.setAttribute('points', pts.join(' ')); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', '#000')
      pl.setAttribute('stroke-width', '3'); pl.setAttribute('stroke-linecap', 'round'); pl.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(pl)
    })
    if (reader._bxKind === 'pdf') {
      var iw = reader._imgwrap.getBoundingClientRect(), ir = d.target.getBoundingClientRect()
      svg.style.left = (ir.left - iw.left) + 'px'; svg.style.top = (ir.top - iw.top) + 'px'
      svg.style.width = ir.width + 'px'; svg.style.height = ir.height + 'px'; reader._imgwrap.appendChild(svg)
    } else d.target.appendChild(svg)
  }
  function sync(reader) {
    if (!reader || !reader._bxPageInkMode) return
    var d = descriptor(reader, true)
    ensureGuard(reader, true)
    if (A && (!d || A.reader !== reader || A.d.key !== d.key)) { close(); return }
    if (!A) requestAnimationFrame(function() { if (!A) open(reader) })
  }

  function ensureDone(reader) {
    var old = reader.view().querySelector('.bx-page-ink-done')
    if (old) old.remove()
    if (!reader._bxPageInkMode) return
    var done = BooxUI.el('button', 'bx-page-ink-done', '✓ Done')
    done.type = 'button'; done.addEventListener('click', function(e) { e.stopPropagation(); setMode(reader, false) })
    reader.view().appendChild(done)
  }
  function ensureGuard(reader, on) {
    var old = reader.view().querySelector('.bx-page-ink-guard')
    if (!on) { if (old) old.remove(); return }
    if (old) return
    var guard = BooxUI.el('div', 'bx-page-ink-guard')
    function block(e) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation() }
    ;['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'wheel', 'contextmenu']
      .forEach(function(type) { guard.addEventListener(type, block, { passive: false }) })
    reader.view().appendChild(guard)
  }
  function canUse(reader) {
    return !window.BooxPdfAnnots || !BooxPdfAnnots.canAnnotate || BooxPdfAnnots.canAnnotate(reader)
  }
  function setMode(reader, on) {
    if (on && !canUse(reader)) { BooxUI.toast('Turn off spread / column split first'); return }
    if (on && window.BooxPdfAnnots && BooxPdfAnnots.modeOn(reader)) BooxPdfAnnots.setMode(reader, false)
    reader._bxPageInkMode = !!on
    if (on) ensureGuard(reader, true)
    ensureDone(reader)
    if (on) {
      if (window.BooxChrome) BooxChrome.hideBars(reader)
      sync(reader); BooxUI.toast('Write directly on the page')
    } else {
      if (A && A.reader === reader) { A.removeGuardAfter = true; close() }
      else ensureGuard(reader, false)
      redraw(reader, 100); BooxUI.toast('Page handwriting closed')
    }
    if (window.BooxChrome) BooxChrome.refresh(reader)
  }
  function toggle(reader) { setMode(reader, !reader._bxPageInkMode) }

  var api = {
    open: open, close: close, sync: sync, redraw: redraw, setMode: setMode, toggle: toggle,
    modeOn: function(reader) { return !!(reader && reader._bxPageInkMode) },
    isOpen: function(reader) { return !!A && (!reader || A.reader === reader) },
    attachNoteBox: function() { if (!A) return; var old = A; A = null; open(old.reader) },
    onNoteStrokes: function(strokes) {
      if (!A || !window._noteSketch) return
      var w = window._noteSketch.w || 1, h = window._noteSketch.h || 1
      for (var s = 0; s < strokes.length; s++) {
        var pts = strokes[s]; if (!pts || !pts.length) continue
        var arr = []
        for (var i = 0; i < pts.length; i++) arr.push(toStored(A.d, pts[i][0] / w, pts[i][1] / h))
        A.strokes.push(arr)
      }
      save()
    },
    renderNoteStrokes: function() {
      if (!A || !window._noteSketch) return
      var ns = window._noteSketch, dpr = window.devicePixelRatio || 1
      var out = { t: 'blank', sp: 0, mg: 0, dpr: dpr, b: [0, 0, ns.w, ns.h], s: [] }
      A.strokes.forEach(function(st) {
        if (!st || !st.length) return
        var p = []
        st.forEach(function(pt) { var q = toDisplay(A.d, pt); p.push([Math.round(q[0] * ns.w), Math.round(q[1] * ns.h)]) })
        out.s.push({ w: 3 * dpr, c: '#000000', p: p })
      })
      Bridge.renderInk(JSON.stringify(out))
      var b = A.bounds; if (Bridge.snapshotContent) Bridge.snapshotContent(b[0], b[1], b[2], b[3])
    },
    finalizeNote: function() {
      if (!A) return
      var reader = A.reader, removeGuard = A.removeGuardAfter; save(); A = null; window._noteSketch = null; window._inkHandler = null
      if (removeGuard) ensureGuard(reader, false)
      redraw(reader, 100)
      requestAnimationFrame(function() { sync(reader) })
    }
  }
  return api
})()

// ---- PDF coordinate highlights + notes ----------------------------------------------------------
window.BooxPdfAnnots = (function() {
  var el = BooxUI.el
  function round(n) { return Math.round(n * 100) / 100 }
  var layoutSeq = 0, layoutCallbacks = {}

  window.onPdfTextLayout = function(requestId, json) {
    var cb = layoutCallbacks[requestId]
    if (!cb) return
    delete layoutCallbacks[requestId]
    cb(json)
  }

  function state(reader) {
    if (!reader._bxAnn || reader._bxAnnBook !== reader.nbId) {
      reader._bxAnn = { mode: false, overlay: null, tools: null, textLayer: null, textSel: null,
        highlightLayer: null, textReady: false, textTimer: null, textPendingKey: null,
        textCache: {}, textCacheOrder: [], sidecarCache: {} }
      reader._bxAnnBook = reader.nbId
    }
    return reader._bxAnn
  }

  function rememberTextLayout(st, key, data) {
    st.textCache[key] = data || {}
    st.textCacheOrder = st.textCacheOrder.filter(function(k) { return k !== key })
    st.textCacheOrder.push(key)
    while (st.textCacheOrder.length > 4) delete st.textCache[st.textCacheOrder.shift()]
  }

  // Shared asynchronous positioned-text request for the selectable overlay and Textbook view.
  // PDFBox stays on AndroidBridge's dedicated executor; callers on the WebView thread only parse
  // the returned JSON. Coalescing by page also prevents the native newest-request-wins queue from
  // making the two PDF features cancel one another.
  function requestTextLayout(reader, page, callback) {
    var st = state(reader), key = reader.nbId + ':' + page
    if (Object.prototype.hasOwnProperty.call(st.textCache, key)) { callback(st.textCache[key]); return }
    st.layoutWaiters = st.layoutWaiters || {}
    if (st.layoutWaiters[key]) { st.layoutWaiters[key].push(callback); return }
    st.layoutWaiters[key] = [callback]
    var requestId = key + ':shared:' + (++layoutSeq)
    layoutCallbacks[requestId] = function(raw) {
      var data = null
      try { data = JSON.parse(raw || '{}') } catch (e) { data = {} }
      rememberTextLayout(st, key, data)
      var waiters = st.layoutWaiters[key] || []
      delete st.layoutWaiters[key]
      waiters.forEach(function(cb) { try { cb(data) } catch (e) {} })
    }
    if (Bridge.requestPdfPageTextLayout) Bridge.requestPdfPageTextLayout(reader.nbId, page, requestId)
    else {
      var raw = '{}'
      try { raw = Bridge.pdfPageTextLayout(reader.nbId, page) || '{}' } catch (e) {}
      window.onPdfTextLayout(requestId, raw)
    }
  }
  function canAnnotate(reader) {
    if (reader._bxKind !== 'pdf') return true
    return reader.vs && reader.vs.columns !== 2 && !(reader.vs.split && reader.vs.split.on)
  }

  // PdfReader calls redraw after its off-DOM image swap completes. Keeping install idempotent makes
  // the annotation module safe when Boox chrome is rebuilt without wrapping the page engine.
  function install(reader) {
    if (reader._bxAnnWrapped) return
    reader._bxAnnWrapped = true
    state(reader)
    if (reader._bxKind === 'pdf' && reader._content) {
      wireDefaultHighlight(reader, reader._content)
      wireHighlightHold(reader, reader._content)
    }
  }

  function setMode(reader, on) {
    if (on && !canAnnotate(reader)) { BooxUI.toast('Turn off spread / column split first'); return }
    if (on && window.BooxPageInk && BooxPageInk.modeOn(reader)) BooxPageInk.setMode(reader, false)
    state(reader).mode = on
    if (!on) {
      closePop()
      var oldTools = state(reader).tools
      if (oldTools) { oldTools.remove(); state(reader).tools = null }
    }
    redraw(reader)
    if (on && window.BooxChrome) BooxChrome.hideBars(reader)
    BooxUI.toast(on ? 'Tap the PDF page for a sticky note' : 'Sticky-note mode closed')
    if (window.BooxChrome) BooxChrome.refresh(reader)
  }
  function toggle(reader) { setMode(reader, !state(reader).mode) }
  function modeOn(reader) { return !!state(reader).mode }

  // ---- coordinate mapping through the current crop ----
  function crop(reader) { var c = reader._cropStr().split(',').map(Number); return { x0: c[0], y0: c[1], x1: 100 - c[2], y1: 100 - c[3] } }
  function pageToDisp(reader, px, py) { var k = crop(reader); return { fx: (px - k.x0) / (k.x1 - k.x0), fy: (py - k.y0) / (k.y1 - k.y0) } }
  function dispToPage(reader, fx, fy) { var k = crop(reader); return { px: k.x0 + fx * (k.x1 - k.x0), py: k.y0 + fy * (k.y1 - k.y0) } }

  // ---- sidecar (unified store, keyed by page index, with a _pages.json index) ----
  function hlPath(p) { return 'sidecar/highlights/' + p + '.json' }
  function noteIdxPath(p) { return 'sidecar/notes/' + p + '/index.json' }
  function noteFilePath(p, id) { return 'sidecar/notes/' + p + '/' + id + '.json' }
  function readJson(reader, path, dflt) {
    var c = state(reader).sidecarCache
    if (Object.prototype.hasOwnProperty.call(c, path)) return c[path]
    try { var v = JSON.parse(Bridge.getBookFile(reader.nbId, path) || 'null'); v = v == null ? dflt : v; c[path] = v; return v } catch (e) { return dflt }
  }
  function writeJson(reader, path, v) {
    state(reader).sidecarCache[path] = v
    try { Bridge.saveBookFile(reader.nbId, path, JSON.stringify(v)) } catch (e) {}
  }

  function loadHl(reader, p) { var a = readJson(reader, hlPath(p == null ? reader.pageIndex : p), []); return Array.isArray(a) ? a : [] }
  function loadNotes(reader, p) { var a = readJson(reader, noteIdxPath(p == null ? reader.pageIndex : p), []); return Array.isArray(a) ? a : [] }

  // page-index files so the tabs list annotations without scanning every page.
  function indexAdd(reader, which, p) {
    var path = 'sidecar/' + which + '/_pages.json'; var arr = readJson(reader, path, [])
    if (!Array.isArray(arr)) arr = []
    if (arr.indexOf(p) === -1) { arr.push(p); arr.sort(function(a, b) { return a - b }); writeJson(reader, path, arr) }
  }
  function indexRemove(reader, which, p) {
    var path = 'sidecar/' + which + '/_pages.json'; var arr = readJson(reader, path, [])
    if (!Array.isArray(arr)) return
    var i = arr.indexOf(p); if (i !== -1) { arr.splice(i, 1); writeJson(reader, path, arr) }
  }
  function pagesWith(reader, which) { var a = readJson(reader, 'sidecar/' + which + '/_pages.json', []); return Array.isArray(a) ? a : [] }

  function saveHl(reader, arr) {
    if (window.BooxAnnotations && BooxAnnotations.invalidate) BooxAnnotations.invalidate(reader)
    else reader._bxAnnotationsCache = null
    var p = reader.pageIndex; writeJson(reader, hlPath(p), arr)
    if (arr.length) indexAdd(reader, 'highlights', p); else indexRemove(reader, 'highlights', p)
  }
  function saveNotes(reader, arr) {
    if (window.BooxAnnotations && BooxAnnotations.invalidate) BooxAnnotations.invalidate(reader)
    else reader._bxAnnotationsCache = null
    var p = reader.pageIndex; writeJson(reader, noteIdxPath(p), arr)
    if (arr.length) indexAdd(reader, 'notes', p); else indexRemove(reader, 'notes', p)
  }

  // ---- overlay ----
  function pageImg(reader) { return reader._imgwrap && reader._imgwrap.querySelector('img.pf-img-full') }

  function ensureOverlay(reader) {
    var st = state(reader), im = pageImg(reader); if (!im) return null
    if (!st.overlay || !st.overlay.parentNode || st.overlay.parentNode !== reader._imgwrap || !document.contains(st.overlay)) {
      st.overlay = el('div', 'bx-pdf-ann'); reader._imgwrap.appendChild(st.overlay); wireInput(reader, st.overlay)
    }
    var iw = reader._imgwrap.getBoundingClientRect(), ir = im.getBoundingClientRect()
    st.overlay.style.left = (ir.left - iw.left) + 'px'; st.overlay.style.top = (ir.top - iw.top) + 'px'
    st.overlay.style.width = ir.width + 'px'; st.overlay.style.height = ir.height + 'px'
    st.overlay.style.pointerEvents = st.mode ? 'auto' : 'none'
    st.overlay.classList.toggle('on', st.mode)
    if (!im.complete || !ir.width) im.addEventListener('load', function() { redraw(reader) }, { once: true })
    return st.overlay
  }

  function ensureHighlightLayer(reader) {
    var st = state(reader), im = pageImg(reader); if (!im) return null
    if (!st.highlightLayer || st.highlightLayer.parentNode !== reader._imgwrap || !document.contains(st.highlightLayer)) {
      st.highlightLayer = el('div', 'bx-pdf-highlight-layer')
      reader._imgwrap.appendChild(st.highlightLayer)
    }
    var iw = reader._imgwrap.getBoundingClientRect(), ir = im.getBoundingClientRect()
    st.highlightLayer.style.left = (ir.left - iw.left) + 'px'; st.highlightLayer.style.top = (ir.top - iw.top) + 'px'
    st.highlightLayer.style.width = ir.width + 'px'; st.highlightLayer.style.height = ir.height + 'px'
    return st.highlightLayer
  }

  function ensureTextLayer(reader) {
    var st = state(reader), im = pageImg(reader)
    if (!im || reader.articleMode) { st.textReady = false; return null }
    if (st.textLayer && st.textLayer.parentNode === reader._imgwrap && document.contains(st.textLayer) &&
        st.textLayer.dataset.page === String(reader.pageIndex) && st.textLayer.dataset.crop === reader._cropStr()) return st.textLayer
    if (st.textLayer) st.textLayer.remove()
    if (st.textSel) st.textSel.remove()
    st.textLayer = null; st.textSel = null; st.textReady = false
    var page = reader.pageIndex, key = reader.nbId + ':' + page
    if (Object.prototype.hasOwnProperty.call(st.textCache, key)) return buildTextLayer(reader, st.textCache[key])

    // The bitmap is already visible before this starts. A short idle window collapses rapid page
    // turns into one request; native PDFBox work happens on a single background executor.
    if (st.textPendingKey !== key) {
      clearTimeout(st.textTimer)
      st.textPendingKey = key
      st.textTimer = setTimeout(function() {
        requestTextLayout(reader, page, function() {
          if (st.textPendingKey === key) st.textPendingKey = null
          if (reader.pageIndex === page && reader.nbId + ':' + reader.pageIndex === key) redraw(reader)
        })
      }, 420)
    }
    return null
  }

  function buildTextLayer(reader, data) {
    var st = state(reader), im = pageImg(reader)
    if (!im) return null
    if (!data || !data.w || !data.h || !Array.isArray(data.runs) || !data.runs.length) return null
    var layer = el('div', 'bx-pdf-text')
    layer.dataset.page = String(reader.pageIndex); layer.dataset.crop = reader._cropStr()
    var iw = reader._imgwrap.getBoundingClientRect(), ir = im.getBoundingClientRect()
    layer.style.left = (ir.left - iw.left) + 'px'; layer.style.top = (ir.top - iw.top) + 'px'
    layer.style.width = ir.width + 'px'; layer.style.height = ir.height + 'px'
    var c = crop(reader), x0 = data.w * c.x0 / 100, y0 = data.h * c.y0 / 100
    var x1 = data.w * c.x1 / 100, y1 = data.h * c.y1 / 100
    var vw = Math.max(1, x1 - x0), vh = Math.max(1, y1 - y0)
    data.runs.forEach(function(run) {
      if (!run || !run.t) return
      var rx = +run.x || 0, ry = +run.y || 0, rw = +run.w || 0, rh = +run.h || 0
      if (rx + rw < x0 || rx > x1 || ry + rh < y0 || ry > y1) return
      // Absolute word boxes do not contribute CSS whitespace between siblings. Keep one literal
      // trailing space in the selectable DOM so copied quotes read like normal sentences.
      var span = el('span', 'bx-pdf-text-run', String(run.t).replace(/\s+$/, '') + ' ')
      span.style.left = ((rx - x0) / vw * 100) + '%'; span.style.top = ((ry - y0) / vh * 100) + '%'
      span.style.height = (rh / vh * 100) + '%'; span.dataset.targetW = String(rw / vw * ir.width)
      span.style.fontSize = Math.max(4, rh / vh * ir.height) + 'px'
      layer.appendChild(span)
    })
    var sel = el('div', 'rd-overlay bx-pdf-text-sel')
    reader.view().appendChild(sel); reader._imgwrap.appendChild(layer)
    Array.prototype.forEach.call(layer.querySelectorAll('.bx-pdf-text-run'), function(span) {
      var natural = span.getBoundingClientRect().width, target = parseFloat(span.dataset.targetW) || natural
      if (natural > 0 && target > 0) span.style.transform = 'scaleX(' + (target / natural) + ')'
    })
    st.textLayer = layer; st.textSel = sel; st.textReady = true
    wireTextSelection(reader, layer, sel)
    return layer
  }

  function wireTextSelection(reader, layer, selLayer) {
    var startCaret = null, selection = null, sx = 0, sy = 0, moved = false
    function clear() { selLayer.innerHTML = ''; selection = null }
    function update(x, y) {
      var end = caretRange(x, y)
      if (!startCaret || !end || !layer.contains(end.startContainer)) return
      var r = snapRangeToWords(orderedRange(startCaret, end) || collapsedRange(startCaret))
      if (!r || !layer.contains(r.startContainer) || !layer.contains(r.endContainer)) return
      selection = r; selLayer.innerHTML = ''; drawRangeInto(selLayer, r, 'rd-sel')
    }
    layer.addEventListener('pointerdown', function(e) {
      if (e.pointerType !== 'pen' || modeOn(reader) || (window.BooxPageInk && BooxPageInk.modeOn(reader))) return
      startCaret = caretRange(e.clientX, e.clientY); sx = e.clientX; sy = e.clientY; moved = false; clear()
      update(e.clientX, e.clientY)
      e.preventDefault(); e.stopPropagation()
      if (layer.setPointerCapture) try { layer.setPointerCapture(e.pointerId) } catch (err) {}
    })
    layer.addEventListener('pointermove', function(e) {
      if (!startCaret) return
      if (Math.abs(e.clientX - sx) > 6 || Math.abs(e.clientY - sy) > 6) moved = true
      update(e.clientX, e.clientY); e.preventDefault(); e.stopPropagation()
    })
    function finish(e) {
      if (!startCaret) return
      startCaret = null; e.preventDefault(); e.stopPropagation()
      if (!moved || !selection || !selection.toString().trim()) { clear(); return }
      var lr = layer.getBoundingClientRect(), rects = [], c = crop(reader)
      var cw = c.x1 - c.x0, ch = c.y1 - c.y0
      Array.prototype.forEach.call(selection.getClientRects(), function(rc) {
        if (rc.width < 1 || rc.height < 1) return
        rects.push([
          round(c.x0 + (rc.left - lr.left) / lr.width * cw),
          round(c.y0 + (rc.top - lr.top) / lr.height * ch),
          round(rc.width / lr.width * cw), round(rc.height / lr.height * ch)
        ])
      })
      rects = mergeLineRects(rects)
      if (rects.length) {
        showSelectionPopup(reader, {
          pageIndex: reader.pageIndex, rects: rects,
          quote: selection.toString().replace(/\s+/g, ' ').trim()
        }, e.clientX, e.clientY)
      }
      clear()
    }
    layer.addEventListener('pointerup', finish)
    layer.addEventListener('pointercancel', function() { startCaret = null; clear() })
  }

  function mergeLineRects(rects) {
    var lines = []
    ;(rects || []).slice().sort(function(a, b) { return a[1] - b[1] || a[0] - b[0] }).forEach(function(r) {
      var cy = r[1] + r[3] / 2
      var line = lines.find(function(x) {
        var xy = x[1] + x[3] / 2
        return Math.abs(cy - xy) <= Math.max(x[3], r[3]) * .55
      })
      if (!line) { lines.push(r.slice()); return }
      var x0 = Math.min(line[0], r[0]), y0 = Math.min(line[1], r[1])
      var x1 = Math.max(line[0] + line[2], r[0] + r[2]), y1 = Math.max(line[1] + line[3], r[1] + r[3])
      line[0] = round(x0); line[1] = round(y0); line[2] = round(x1 - x0); line[3] = round(y1 - y0)
    })
    return lines
  }
  function blockForRects(rects) {
    if (!rects || !rects.length) return null
    var l = 100, t = 100, r = 0, b = 0
    rects.forEach(function(x) { l = Math.min(l, x[0]); t = Math.min(t, x[1]); r = Math.max(r, x[0] + x[2]); b = Math.max(b, x[1] + x[3]) })
    var px = .55, py = .38
    l = Math.max(0, l - px); t = Math.max(0, t - py); r = Math.min(100, r + px); b = Math.min(100, b + py)
    return [round(l), round(t), round(r - l), round(b - t)]
  }

  function showSelectionPopup(reader, data, x, y) {
    closePop()
    var pop = el('div', 'rd-pop'); pop.id = 'bx-pdf-pop'
    var hi = el('button', 'rd-pop-btn', '✎ Highlight')
    var note = el('button', 'rd-pop-btn', '🗒 Sticky note')
    var cancel = el('button', 'rd-pop-btn', '✕')
    hi.addEventListener('click', function() { commitSelection(reader, data, false) })
    note.addEventListener('click', function() { commitSelection(reader, data, true) })
    cancel.addEventListener('click', closePop)
    pop.appendChild(hi); pop.appendChild(note); pop.appendChild(cancel); reader.view().appendChild(pop)
    pop.style.top = Math.max(8, y - 52) + 'px'
    pop.style.left = Math.min(Math.max(8, x - 80), window.innerWidth - 300) + 'px'
  }

  function commitSelection(reader, data, withNote) {
    if (!data || data.pageIndex !== reader.pageIndex) { closePop(); return }
    var h = {
      id: 'h' + Date.now().toString(36), pageIndex: reader.pageIndex,
      createdAt: new Date().toISOString(), quote: data.quote || ''
    }
    if (data.rects) h.rects = data.rects
    else h.rect = data.rect
    var arr = loadHl(reader); arr.push(h); saveHl(reader, arr); closePop(); redraw(reader)
    if (withNote) {
      var r = h.rect || (h.rects && h.rects[h.rects.length - 1])
      if (r) addNote(reader, r[0] + r[2] / 2, r[1] + r[3] / 2, { highlightId: h.id, quote: h.quote })
    } else BooxUI.toast('Highlighted')
  }

  function ensureTools(reader) {
    var st = state(reader)
    if (!st.mode) return
    if (!st.tools || !st.tools.parentNode || !document.contains(st.tools)) {
      var tools = el('div', 'bx-pdf-tools')
      tools.setAttribute('role', 'toolbar')
      tools.setAttribute('aria-label', 'PDF sticky notes')
      var active = el('div', 'bx-pdf-tool on')
      active.innerHTML = '<span>▣</span><small>Sticky note</small>'
      tools.appendChild(active)
      var done = el('button', 'bx-pdf-tool bx-pdf-tool-done')
      done.type = 'button'; done.innerHTML = '<span>✓</span><small>Done</small>'
      done.addEventListener('click', function(e) { e.stopPropagation(); setMode(reader, false) })
      tools.appendChild(done)
      reader.view().appendChild(tools)
      st.tools = tools
    }
  }

  function rectContains(r, x, y) {
    return !!r && x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]
  }
  function safeNotePosition(reader, note, highlights, used) {
    var h = note.highlightId && highlights.find(function(x) { return x.id === note.highlightId })
    var block = h && (h.block || blockForRects(h.rects || (h.rect ? [h.rect] : [])))
    var baseY = block ? block[1] + block[3] / 2 : ((note.at && note.at[1]) || 50)
    var x
    if (block) {
      var nearRight = block[0] + block[2] + 2.8, nearLeft = block[0] - 2.8
      x = nearRight <= 97 ? nearRight : (nearLeft >= 3 ? nearLeft : Math.max(3, Math.min(97, block[0] + block[2] / 2)))
    } else x = Math.max(3, Math.min(97, (note.at && note.at[0]) || 50))
    var offsets = [0, -4, 4, -8, 8, -12, 12, -16, 16]
    var y = Math.max(2, Math.min(98, baseY))
    for (var i = 0; i < offsets.length; i++) {
      var candidate = Math.max(2, Math.min(98, baseY + offsets[i]))
      var collision = used.some(function(p) { return Math.abs(p[0] - x) < 4 && Math.abs(p[1] - candidate) < 4 })
      if (!collision) { y = candidate; break }
    }
    used.push([x, y])
    return [x, y]
  }
  function hitHighlight(reader, px, py, highlights) {
    for (var i = highlights.length - 1; i >= 0; i--) {
      var b = highlights[i].block || blockForRects(highlights[i].rects || (highlights[i].rect ? [highlights[i].rect] : []))
      if (rectContains(b, px, py)) return i
    }
    return null
  }

  function redraw(reader) {
    if (reader._bxKind !== 'pdf') return
    var ov = ensureOverlay(reader); if (!ov) return
    var hlLayer = ensureHighlightLayer(reader); if (!hlLayer) return
    ensureTextLayer(reader)
    ensureTools(reader)
    if (window.BooxPageInk) { BooxPageInk.redraw(reader); BooxPageInk.sync(reader) }
    ov.innerHTML = ''; hlLayer.innerHTML = ''
    var highlights = loadHl(reader)
    highlights.forEach(function(h, idx) {
      var rects = Array.isArray(h.rects) ? h.rects : (h.rect ? [h.rect] : (h.block ? [h.block] : []))
      var r = blockForRects(rects)
      if (!r) return
      var a = pageToDisp(reader, r[0], r[1]), b = pageToDisp(reader, r[0] + r[2], r[1] + r[3])
      if (b.fx < 0 || a.fx > 1 || b.fy < 0 || a.fy > 1) return
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'bx-pdf-hl-shape' + (state(reader).textReady ? '' : ' no-text'))
      svg.setAttribute('viewBox', '0 0 100 100'); svg.dataset.i = idx
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', lineHighlightPath(reader, rects)); svg.appendChild(path); hlLayer.appendChild(svg)
    })
    var usedNotePositions = []
    loadNotes(reader).forEach(function(n) {
      var p = safeNotePosition(reader, n, highlights, usedNotePositions)
      var d = pageToDisp(reader, p[0], p[1]); if (d.fx < 0 || d.fx > 1 || d.fy < 0 || d.fy > 1) return
      var m = el('div', 'bx-pdf-note')
      m.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z" fill="#000"/></svg>'
      m.style.left = (d.fx * 100) + '%'; m.style.top = (d.fy * 100) + '%'
      m.addEventListener('click', function(e) { e.stopPropagation(); openNote(reader, n) })
      ov.appendChild(m)
    })
  }

  function lineHighlightPath(reader, rects) {
    var lines = rects.map(function(r) {
      var a = pageToDisp(reader, r[0] - .45, r[1] - .2)
      var b = pageToDisp(reader, r[0] + r[2] + .45, r[1] + r[3] + .2)
      return { l: Math.max(0, a.fx * 100), t: Math.max(0, a.fy * 100),
        r: Math.min(100, b.fx * 100), b: Math.min(100, b.fy * 100) }
    }).sort(function(a, b) { return a.t - b.t || a.l - b.l })
    return lines.map(function(line) {
      return 'M ' + line.l + ' ' + line.t + ' H ' + line.r +
        ' V ' + line.b + ' H ' + line.l + ' V ' + line.t + ' Z'
    }).join(' ')
  }

  function wireInput(reader, ov) {
    var start = null, moved = false
    ov.addEventListener('pointerdown', function(e) {
      if (!modeOn(reader)) return
      if (e.target && e.target.closest && e.target.closest('.bx-pdf-note')) { start = null; return }
      start = { x: e.clientX, y: e.clientY }; moved = false; e.preventDefault(); e.stopPropagation()
      if (ov.setPointerCapture) try { ov.setPointerCapture(e.pointerId) } catch (err) {}
    })
    ov.addEventListener('pointermove', function(e) {
      if (!start) return
      if (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8) moved = true
    })
    ov.addEventListener('pointerup', function(e) {
      if (!start) return; var s = start; start = null; var r = ov.getBoundingClientRect()
      if (!moved) {
        var p = dispToPage(reader, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
        var hi = hitHighlight(reader, p.px, p.py, loadHl(reader))
        if (hi != null) hlMenu(reader, hi, e.clientX, e.clientY)
        else addNote(reader, p.px, p.py)
      }
    })
    ov.addEventListener('pointercancel', function() { start = null })
  }

  // PDF highlighting is a default reading gesture, like EPUB/book selection: a pen drag creates an
  // area highlight without entering Notes. Finger taps continue through the reader's normal zones.
  function wireDefaultHighlight(reader, content) {
    var start = null, draft = null, pointerId = null
    content.addEventListener('pointerdown', function(e) {
      if (e.pointerType !== 'pen' || modeOn(reader) || (window.BooxPageInk && BooxPageInk.modeOn(reader)) || reader.articleMode) return
      if (state(reader).textReady) return
      var ov = ensureOverlay(reader); if (!ov) return
      var r = ov.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
      start = { x: e.clientX, y: e.clientY }; draft = null; pointerId = e.pointerId
    }, true)
    content.addEventListener('pointermove', function(e) {
      if (!start || e.pointerId !== pointerId) return
      if (!draft && (Math.abs(e.clientX - start.x) > 8 || Math.abs(e.clientY - start.y) > 8)) {
        var ov = ensureOverlay(reader); if (!ov) return
        draft = el('div', 'bx-pdf-hl draft'); ov.appendChild(draft)
        if (content.setPointerCapture) try { content.setPointerCapture(pointerId) } catch (err) {}
      }
      if (!draft) return
      e.preventDefault(); e.stopPropagation()
      var r = ensureOverlay(reader).getBoundingClientRect()
      var x1 = Math.min(start.x, e.clientX) - r.left, y1 = Math.min(start.y, e.clientY) - r.top
      var x2 = Math.max(start.x, e.clientX) - r.left, y2 = Math.max(start.y, e.clientY) - r.top
      draft.style.left = x1 + 'px'; draft.style.top = y1 + 'px'; draft.style.width = (x2 - x1) + 'px'; draft.style.height = (y2 - y1) + 'px'
    }, true)
    function finish(e) {
      if (!start || e.pointerId !== pointerId) return
      var s = start; start = null; pointerId = null
      if (!draft) return
      e.preventDefault(); e.stopPropagation()
      var ov = ensureOverlay(reader), r = ov.getBoundingClientRect()
      var x1 = Math.max(0, Math.min(s.x, e.clientX) - r.left), y1 = Math.max(0, Math.min(s.y, e.clientY) - r.top)
      var x2 = Math.min(r.width, Math.max(s.x, e.clientX) - r.left), y2 = Math.min(r.height, Math.max(s.y, e.clientY) - r.top)
      draft.remove(); draft = null
      if (x2 - x1 < 8 || y2 - y1 < 4) return
      var pa = dispToPage(reader, x1 / r.width, y1 / r.height), pb = dispToPage(reader, x2 / r.width, y2 / r.height)
      showSelectionPopup(reader, { pageIndex: reader.pageIndex,
        rect: [round(pa.px), round(pa.py), round(pb.px - pa.px), round(pb.py - pa.py)] }, e.clientX, e.clientY)
    }
    content.addEventListener('pointerup', finish, true)
    content.addEventListener('pointercancel', function(e) { if (draft) draft.remove(); draft = null; start = null; pointerId = null }, true)
  }

  // A stationary hold works in ordinary PDF reading mode; it does not require sticky-note mode.
  // Movement cancels before the 800 ms threshold so page gestures and pen-drag highlighting keep
  // their existing ownership. The reader's tap-zone handler already ignores releases over 400 ms.
  function wireHighlightHold(reader, content) {
    var heldPage = -1
    var hold = ReaderHighlightLongPress(function(x, y) {
      if (reader.pageIndex !== heldPage || reader.articleMode) return
      var ov = ensureOverlay(reader); if (!ov) return
      var box = ov.getBoundingClientRect()
      var p = dispToPage(reader, (x - box.left) / box.width, (y - box.top) / box.height)
      var i = hitHighlight(reader, p.px, p.py, loadHl(reader))
      if (i != null) openHighlightNoteOrMenu(reader, i, x, y)
    })
    content.addEventListener('pointerdown', function(e) {
      hold.cancel()
      if (reader.articleMode || modeOn(reader) || (window.BooxPageInk && BooxPageInk.modeOn(reader))) return
      if (window.BooxInk && BooxInk.isOpen && BooxInk.isOpen()) return
      var ov = ensureOverlay(reader); if (!ov) return
      var r = ov.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return
      heldPage = reader.pageIndex
      hold.start(e)
    }, true)
    content.addEventListener('pointermove', function(e) { hold.move(e) }, true)
    content.addEventListener('pointerup', function(e) { hold.end(e) }, true)
    content.addEventListener('pointercancel', function(e) { hold.end(e) }, true)
    content.addEventListener('pointerleave', function(e) { hold.end(e) }, true)
  }

  function openHighlightNoteOrMenu(reader, i, x, y) {
    var h = loadHl(reader)[i]
    if (!h) return
    var note = loadNotes(reader).find(function(n) { return h.id && n.highlightId === h.id })
    if (note) { closePop(); openNote(reader, note); return }
    hlMenu(reader, i, x, y)
  }

  function hlMenu(reader, i, x, y) {
    closePop()
    var pop = el('div', 'rd-pop'); pop.id = 'bx-pdf-pop'
    var addN = el('button', 'rd-pop-btn', '🗒 Add note')
    addN.addEventListener('click', function() {
      closePop(); var h = loadHl(reader)[i], r = h && (h.rect || (h.rects && h.rects[0]))
      var c = r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null
      if (c) addNote(reader, c[0], c[1], { highlightId: h.id, quote: h.quote || '' })
    })
    var del = el('button', 'rd-pop-btn', '🗑 Delete')
    del.addEventListener('click', function() { var arr = loadHl(reader); arr.splice(i, 1); saveHl(reader, arr); closePop(); redraw(reader) })
    var cx = el('button', 'rd-pop-btn', '✕'); cx.addEventListener('click', closePop)
    pop.appendChild(addN); pop.appendChild(del); pop.appendChild(cx); reader.view().appendChild(pop)
    pop.style.top = Math.max(8, y - 52) + 'px'; pop.style.left = Math.min(Math.max(8, x - 40), window.innerWidth - 260) + 'px'
  }
  function closePop() { var p = document.getElementById('bx-pdf-pop'); if (p) p.remove() }

  function addNote(reader, px, py, meta) {
    var arr = loadNotes(reader)
    var id = 'n' + Date.now().toString(36)
    var note = { noteId: id, at: [round(px), round(py)], hasPreview: false, createdAt: new Date().toISOString() }
    if (meta && meta.highlightId) note.highlightId = meta.highlightId
    if (meta && meta.quote) note.quote = meta.quote
    arr.push(note)
    saveNotes(reader, arr)
    writeJson(reader, noteFilePath(reader.pageIndex, id), { at: [round(px), round(py)], quote: note.quote || '', strokes: [] })
    redraw(reader)
    openNote(reader, note)
  }
  function openNote(reader, n) {
    BooxInk.open(reader, noteFilePath(reader.pageIndex, n.noteId),
      { pageIndex: reader.pageIndex, at: n.at, quote: n.quote || '' }, function() { redraw(reader) })
  }

  // ---- gathering for the Contents Annotations / Handwriting tabs ----
  function gatherHighlights(reader) {
    var out = []
    pagesWith(reader, 'highlights').forEach(function(p) {
      var notes = loadNotes(reader, p)
      loadHl(reader, p).forEach(function(h) {
        out.push({ page: p, quote: h.quote || '', hasNote: !!notes.find(function(n) { return h.id && n.highlightId === h.id }) })
      })
    })
    return out
  }
  function gatherNotes(reader) {
    var out = []
    pagesWith(reader, 'notes').forEach(function(p) {
      loadNotes(reader, p).forEach(function(n) {
        var path = noteFilePath(p, n.noteId)
        var file = n.quote ? {} : readJson(reader, path, {})
        var preview = readJson(reader, BooxInkPreviewPath(path), {})
        if (!Array.isArray(preview.strokes)) preview = readJson(reader, path, {})
        out.push({ page: p, noteId: n.noteId, quote: n.quote || file.quote || '', strokes: preview.strokes || [] })
      })
    })
    return out
  }

  return {
    install: install, setMode: setMode, toggle: toggle, modeOn: modeOn, redraw: redraw,
    gatherHighlights: gatherHighlights, gatherNotes: gatherNotes, canAnnotate: canAnnotate,
    requestTextLayout: requestTextLayout
  }
})()
