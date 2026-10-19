// Kalamos native pages spliced into immutable PDF/EPUB reading sequences.
//
// The source book is never rewritten. Insertions live in sidecar/pages.json and are anchored to a
// stable source location. Their `page` payload is the same JSON block shape used by Kalamos
// notebooks, so it can contain text, images/assets, MCQs, drawing prompts, hotspots, etc. A separate
// ink.json per insertion holds full-page handwriting.
window.NativePages = (function() {
  var STORE = 'sidecar/pages.json'

  function init(reader, kind, resumeId) {
    var raw = null
    try { raw = JSON.parse(Bridge.getBookFile(reader.nbId, STORE) || 'null') } catch (e) {}
    var pages = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.pages) ? raw.pages : [])
    reader._kp = { kind: kind, pages: pages, active: null, node: null, resumeId: resumeId || null }
  }

  function save(reader) {
    if (!reader._kp) return
    Bridge.saveBookFile(reader.nbId, STORE, JSON.stringify({ version: 1, pages: reader._kp.pages }))
  }

  function currentAnchor(reader, kind) {
    if (kind === 'pdf') return { kind: 'pdf', pageIndex: reader.pageIndex | 0 }
    if (kind === 'book') return {
      kind: 'book', sectionId: reader.sectionId ? reader.sectionId() : String(reader.sec || 0),
      charOffset: (reader._topCharOffset && reader._topCharOffset()) || 0
    }
    return { kind: 'epub', spineIdx: reader.spineIdx | 0, charOffset: (reader._topCharOffset && reader._topCharOffset()) || 0 }
  }

  function anchorMatches(reader, entry, kind) {
    var a = entry && entry.after
    if (!a || a.kind !== kind) return false
    if (kind === 'pdf') return a.pageIndex === (reader.pageIndex | 0)
    if (kind === 'book') {
      var sid = reader.sectionId ? reader.sectionId() : String(reader.sec || 0)
      if (a.sectionId !== sid) return false
      if (a.boundary === 'section-end') return (reader.page | 0) >= Math.max(0, (reader.pages | 0) - 1)
      return a.charOffset === ((reader._topCharOffset && reader._topCharOffset()) || 0)
    }
    if (a.spineIdx !== (reader.spineIdx | 0)) return false
    if (a.boundary === 'section-end') return (reader.page | 0) >= Math.max(0, (reader.pages | 0) - 1)
    if (reader._nativePageBounds) {
      var b = reader._nativePageBounds()
      return a.charOffset >= b.start && a.charOffset < b.end
    }
    return a.charOffset === ((reader._topCharOffset && reader._topCharOffset()) || 0)
  }

  function afterCurrent(reader, kind) {
    if (!reader._kp) init(reader, kind)
    return reader._kp.pages.filter(function(p) { return anchorMatches(reader, p, kind) })
  }
  function sameAnchorPages(reader, entry) {
    var key = JSON.stringify(entry && entry.after || null)
    return reader._kp.pages.filter(function(p) {
      if (JSON.stringify(p.after || null) !== key) return false
      return entry && entry.groupId ? p.groupId === entry.groupId : !p.groupId
    })
  }
  function allAnchorPages(reader, entry) {
    var key = JSON.stringify(entry && entry.after || null)
    return reader._kp.pages.filter(function(p) {
      return JSON.stringify(p.after || null) === key
    })
  }

  function insertAfterCurrent(reader) {
    var kind = reader._bxKind
    if (kind !== 'pdf' && kind !== 'epub') return
    if (kind === 'pdf' && reader.vs && reader.vs.split && reader.vs.split.on) {
      BooxUI.toast('Turn off column split before inserting a page')
      return
    }
    if (!reader._kp) init(reader, kind)
    var id = 'kp-' + Date.now().toString(36)
    var entry = {
      id: id,
      after: currentAnchor(reader, kind),
      createdAt: new Date().toISOString(),
      title: 'Inserted page',
      page: { pageId: id, template: 'blank', blocks: [] }
    }
    var same = afterCurrent(reader, kind)
    var insertAt = reader._kp.pages.length
    if (same.length) {
      var last = same[same.length - 1]
      var at = reader._kp.pages.indexOf(last)
      if (at !== -1) insertAt = at + 1
    }
    reader._kp.pages.splice(insertAt, 0, entry)
    save(reader)
    BooxUI.closeSheet()
    show(reader, entry)
    BooxUI.toast('Kalamos page inserted')
  }

  // Atomically splice a complete generated interaction into the reading sequence. The compiler
  // supplies immutable page payloads; this persistence layer supplies only ordering/group metadata.
  function parkAtAnchor(reader, anchor, done) {
    done = typeof done === 'function' ? done : function() {}
    if (!reader || !anchor) { done(); return }
    if (anchor.kind === 'pdf') {
      if ((reader.pageIndex | 0) !== (anchor.pageIndex | 0)) {
        if (reader.gotoPage) reader.gotoPage(anchor.pageIndex | 0)
        else {
          reader.pageIndex = anchor.pageIndex | 0
          if (reader.loadPage) reader.loadPage()
        }
      }
      done()
      return
    }
    if (anchor.kind === 'epub') {
      var spineIdx = anchor.spineIdx | 0
      if (spineIdx !== (reader.spineIdx | 0) && reader.manifest &&
          spineIdx >= 0 && spineIdx < reader.manifest.spine.length) {
        reader._kpAfterAnchorNavigation = done
        reader.spineIdx = spineIdx
        reader.page = 0
        if (reader.renderChapter) reader.renderChapter()
        return
      }
      reader.page = Math.max(0, (reader.pages | 0) - 1)
      if (reader.paginate) reader.paginate()
      done()
      return
    }
    if (anchor.kind === 'book') {
      var spine = (reader.manifest && reader.manifest.spine) || []
      var sectionIndex = spine.findIndex(function(row) {
        return String(row.sectionId || row.id) === String(anchor.sectionId)
      })
      if (sectionIndex >= 0 && sectionIndex !== (reader.sec | 0)) {
        reader._kpAfterAnchorNavigation = done
        reader.sec = sectionIndex
        reader.page = 0
        if (reader.renderSection) reader.renderSection()
        return
      }
      reader.page = Math.max(0, (reader.pages | 0) - 1)
      if (reader.paginate) reader.paginate()
      done()
    }
  }

  function afterAnchorNavigation(reader) {
    if (!reader || typeof reader._kpAfterAnchorNavigation !== 'function') return false
    var done = reader._kpAfterAnchorNavigation
    reader._kpAfterAnchorNavigation = null
    reader.page = Math.max(0, (reader.pages | 0) - 1)
    if (reader.paginate) reader.paginate()
    done()
    return true
  }

  function insertGroup(reader, group) {
    if (!reader || !group || !group.after || !Array.isArray(group.pages) || !group.pages.length)
      throw new Error('Invalid native-page group')
    var kind = group.after.kind
    if (kind !== 'pdf' && kind !== 'epub' && kind !== 'book') throw new Error('Unsupported native-page anchor')
    if (!reader._kp) init(reader, kind)
    var entries = group.pages.map(function(p, i) {
      return {
        id: p.id,
        groupId: group.id,
        groupKind: group.kind || 'interaction',
        groupIndex: i,
        groupLength: group.pages.length,
        after: group.after,
        createdAt: group.createdAt || new Date().toISOString(),
        title: p.title || group.title || 'Inserted page',
        template: group.template || null,
        templateVersions: group.templateVersions || null,
        source: group.source || null,
        provider: group.provider || null,
        activityCount: group.activityCount || null,
        mode: group.mode || null,
        resultsPolicy: group.resultsPolicy || null,
        capabilities: group.capabilities || null,
        page: p.page || { pageId: p.id, template: 'blank', blocks: [] }
      }
    })
    var key = JSON.stringify(group.after)
    var insertAt = reader._kp.pages.length
    for (var i = reader._kp.pages.length - 1; i >= 0; i--) {
      if (JSON.stringify(reader._kp.pages[i].after || null) === key) { insertAt = i + 1; break }
    }
    Array.prototype.splice.apply(reader._kp.pages, [insertAt, 0].concat(entries))
    save(reader) // one sidecar write: no partial quiz can become visible
    // The source reader remains parked at the group's insertion anchor while its pages are traversed.
    // This makes leaving the group advance to the source content after that anchor, including when a
    // PDF range ends later than the page on which Smart Scribe was opened.
    if (window.BooxUI) BooxUI.closeSheet()
    parkAtAnchor(reader, group.after, function() {
      show(reader, entries[0])
      if (window.BooxUI) BooxUI.toast(group.kind === 'study-workbook' ? 'Workbook inserted' : 'Quiz inserted')
    })
  }

  function show(reader, entry) {
    if (reader._kp && reader._kp.nativeInk) {
      closeNativeInk(reader, function() { show(reader, entry) })
      return
    }
    hide(reader)
    if (!reader._kp) return
    clearSourceReturn(reader)
    reader._kp.active = entry
    var root = el('section', 'kp-native-page')
    root.dataset.pageId = entry.id
    var head = el('div', 'kp-native-head')
    head.appendChild(el('span', 'kp-native-kind', 'KALAMOS PAGE'))
    head.appendChild(el('span', 'kp-native-title', entry.title || 'Inserted page'))
    var del = el('button', 'kp-native-btn', 'Delete')
    del.addEventListener('click', function() { remove(reader, entry) })
    head.appendChild(del)
    root.appendChild(head)
    var paper = el('div', 'kp-native-paper')
    var ink = el('div', 'kp-native-ink')
    var content = el('div', 'kp-native-content')
    paper.appendChild(content); paper.appendChild(ink); root.appendChild(paper)
    reader.view().appendChild(root)
    reader._kp.node = root
    reader._kp.inkBox = ink
    wireTapZones(reader, root)
    var page = entry.page || { blocks: [] }
    var interactive = !!(window.InteractionPageRenderer &&
      InteractionPageRenderer.render(content, entry, reader))
    if (!interactive) ContentBlocks.render(content, page, reader.nbId)
    content.classList.toggle('has-content', !!(page.blocks && page.blocks.length))
    if (interactive) {
      root.classList.add('kp-interactive-page')
      // Interactive workbook pages own their in-page navigation and deletion/results actions. The
      // generic inserted-page banner wastes a full line of e-ink space and visually separates the
      // activity from the page, so it is intentionally absent for every interaction renderer.
      head.remove()
      content.classList.add('has-content', 'rai-page')
      if (Bridge.setInteractivePanel) Bridge.setInteractivePanel(true)
    } else {
      requestAnimationFrame(function() { requestAnimationFrame(function() { attachNativeInk(reader, entry) }) })
    }
    if (window.BooxChrome) BooxChrome.refresh(reader)
    if (reader.savePosition) reader.savePosition()
  }

  function clearSourceReturn(reader) {
    if (!reader || !reader._kp) return
    if (reader._kp.sourceReturnNode) reader._kp.sourceReturnNode.remove()
    reader._kp.sourceReturnNode = null
    reader._kp.sourceReturnEntry = null
  }

  function mountSourceReturn(reader, entry) {
    if (!reader || !reader._kp || !entry) return
    if (reader._kp.sourceReturnNode) reader._kp.sourceReturnNode.remove()
    var button = el('button', 'kp-source-return', '← Back to quiz')
    button.type = 'button'
    button.addEventListener('click', function(e) {
      e.preventDefault()
      e.stopPropagation()
      if (!reader._kp) return
      reader._kp.sourceReturnNode = null
      button.remove()
      parkAtAnchor(reader, entry.after, function() { show(reader, entry) })
    })
    reader.view().appendChild(button)
    reader._kp.sourceReturnNode = button
    reader._kp.sourceReturnEntry = entry
    if (window.BooxChrome) BooxChrome.refresh(reader)
  }

  function evidenceTarget(entry, evidence) {
    if (evidence && evidence.target && typeof evidence.target === 'object')
      return evidence.target
    var id = String(evidence && evidence.id || '')
    var pdf = /^pdf-page-(\d+)$/.exec(id)
    if (pdf) return { kind: 'pdf', pageIndex: Math.max(0, parseInt(pdf[1], 10) - 1) }
    var epub = /^epub-(\d+)-(\d+)$/.exec(id)
    if (epub) return {
      kind: 'epub',
      spineIdx: parseInt(epub[1], 10),
      segmentIndex: Math.max(0, parseInt(epub[2], 10) - 1)
    }
    if (entry && entry.after && entry.after.kind === 'book') {
      var prefix = 'book-' + String(entry.after.sectionId) + '-'
      if (id.indexOf(prefix) === 0) return {
        kind: 'book',
        sectionId: String(entry.after.sectionId),
        blockId: id.slice(prefix.length)
      }
    }
    return entry && entry.after ? entry.after : null
  }

  function openEvidence(reader, entry, evidence) {
    if (!reader || !entry || !reader._kp) return
    var target = evidenceTarget(entry, evidence)
    if (!target) {
      if (window.BooxUI) BooxUI.toast('This source location is unavailable')
      return
    }
    hide(reader)
    var finished = false
    function landed() {
      if (finished || !reader._kp) return
      finished = true
      mountSourceReturn(reader, entry)
      if (window.BooxUI) BooxUI.toast('Source opened')
    }
    if (typeof reader.gotoStudyEvidence === 'function') {
      reader.gotoStudyEvidence(target, landed)
      return
    }
    if (target.kind === 'pdf' && reader.gotoPage) reader.gotoPage(target.pageIndex | 0)
    else if (target.kind === 'epub' && reader.gotoBookmarkLoc)
      reader.gotoBookmarkLoc({ type: 'epub', spineIdx: target.spineIdx | 0, charOffset: target.start | 0 })
    else if (target.kind === 'book' && reader.jumpTo)
      reader.jumpTo(target.sectionId, target.blockId || null)
    landed()
  }

  function hide(reader) {
    if (!reader._kp) return
    if (reader._kp.nativeInk) {
      closeNativeInk(reader, function() { hide(reader) })
      return
    }
    if (reader._kp.node) reader._kp.node.remove()
    reader._kp.node = null
    reader._kp.inkBox = null
    reader._kp.active = null
    if (Bridge.setInteractivePanel) Bridge.setInteractivePanel(false)
    if (window.BooxChrome) BooxChrome.refresh(reader)
  }

  function inkPath(entry) { return 'sidecar/native-pages/' + entry.id + '/ink.json' }
  function loadInk(reader, entry) {
    try {
      var j = JSON.parse(Bridge.getBookFile(reader.nbId, inkPath(entry)) || '{}')
      if (Array.isArray(j.strokes)) return j.strokes
    } catch (e) {}
    return []
  }
  function saveInk(reader, entry, strokes) {
    try {
      Bridge.saveBookFile(reader.nbId, inkPath(entry), JSON.stringify({
        anchor: { nativePageId: entry.id, after: entry.after },
        strokes: strokes || []
      }))
    } catch (e) {}
  }
  function attachNativeInk(reader, entry) {
    if (!reader._kp || reader._kp.active !== entry || !reader._kp.inkBox) return
    var box = reader._kp.inkBox
    var r = box.getBoundingClientRect()
    if (r.width < 20 || r.height < 20) return
    var dpr = window.devicePixelRatio || 1
    var pad = 2
    var L = Math.round((r.left + pad) * dpr)
    var T = Math.round((r.top + pad) * dpr)
    var R = Math.round((r.right - pad) * dpr)
    var B = Math.round((r.bottom - pad) * dpr)
    var ink = {
      reader: reader,
      entry: entry,
      strokes: loadInk(reader, entry),
      attachNoteBox: function() { attachNativeInk(reader, entry) },
      onNoteStrokes: function(strokes) {
        var ns = window._noteSketch; if (!ns) return
        var w = ns.w || 1, h = ns.h || 1
        for (var s = 0; s < strokes.length; s++) {
          var pts = strokes[s]; if (!pts || !pts.length) continue
          var arr = []
          for (var i = 0; i < pts.length; i++) arr.push([pts[i][0] / w, pts[i][1] / h])
          ink.strokes.push(arr)
        }
        saveInk(reader, entry, ink.strokes)
      },
      renderNoteStrokes: function() {
        var ns = window._noteSketch; if (!ns) return
        var out = { t: 'ruled', sp: Math.round(38 * dpr), mg: Math.round(48 * dpr), dpr: dpr, b: [0, 0, ns.w, ns.h], s: [] }
        ink.strokes.forEach(function(st) {
          if (!st || !st.length) return
          var p = []
          for (var i = 0; i < st.length; i++) p.push([Math.round(st[i][0] * ns.w), Math.round(st[i][1] * ns.h)])
          out.s.push({ w: 3 * dpr, c: '#000000', p: p })
        })
        Bridge.renderInk(JSON.stringify(out))
      },
      finalizeNote: function() {
        saveInk(reader, entry, ink.strokes)
        var after = ink.afterClose
        if (reader._kp && reader._kp.nativeInk === ink) reader._kp.nativeInk = null
        window._noteSketch = null
        window._inkHandler = null
        if (after) requestAnimationFrame(after)
      }
    }
    reader._kp.nativeInk = ink
    window._noteSketch = { w: R - L, h: B - T }
    window._inkHandler = ink
    if (Bridge.skipWakeRefresh) Bridge.skipWakeRefresh()
    Bridge.attachInkBox(L, T, R, B)
    Bridge.setInkStyle(3 * dpr, '#000000')
  }
  function closeNativeInk(reader, after) {
    if (!reader._kp || !reader._kp.nativeInk) return
    reader._kp.nativeInk.afterClose = after || null
    Bridge.detachInkBox()
  }

  function wireTapZones(reader, root) {
    var sx = 0, sy = 0, moved = false, target = null
    root.addEventListener('pointerdown', function(e) {
      if (e.pointerType === 'pen') { target = null; return }
      sx = e.clientX; sy = e.clientY; moved = false; target = e.target
    }, true)
    root.addEventListener('pointermove', function(e) {
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) moved = true
    }, true)
    root.addEventListener('pointerup', function(e) {
      if (e.pointerType === 'pen') return
      if (moved || (target && target.closest && target.closest(
        'button,a,input,select,textarea,canvas,.rd-hotspots,.rd-pintail,.cb-draw-box,.rai-interaction,.wb-interaction,.wb-ink-region'
      ))) return
      var r = root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
      if (y < r.height * .14 && reader.toggleBar) reader.toggleBar('top')
      else if (y > r.height * .86 && reader.toggleBar) reader.toggleBar('bottom')
      else if (x < r.width * .33 && reader.prevPage) reader.prevPage()
      else if (x > r.width * .67 && reader.nextPage) reader.nextPage()
    }, true)
  }

  function remove(reader, entry) {
    if (!reader._kp) return
    if (entry.groupId) { deleteGroup(reader, entry.groupId); return }
    var at = reader._kp.pages.indexOf(entry)
    if (at !== -1) reader._kp.pages.splice(at, 1)
    save(reader)
    hide(reader)
    if (window.BooxChrome) BooxChrome.refresh(reader)
    BooxUI.toast('Inserted page deleted')
  }

  function deleteGroup(reader, groupId) {
    if (!reader || !reader._kp || !groupId) return
    var before = reader._kp.pages.length
    reader._kp.pages = reader._kp.pages.filter(function(p) { return p.groupId !== groupId })
    if (reader._kp.pages.length === before) return
    save(reader)
    try { Bridge.saveBookFile(reader.nbId, attemptPath(groupId), '') } catch (e) {}
    hide(reader)
    if (reader.savePosition) reader.savePosition()
    if (window.BooxChrome) BooxChrome.refresh(reader)
    if (window.BooxUI) BooxUI.toast('Workbook deleted')
  }

  function attemptPath(groupId) { return 'sidecar/interactions/' + groupId + '/attempt.json' }
  function loadAttempt(reader, groupId) {
    try {
      var value = JSON.parse(Bridge.getBookFile(reader.nbId, attemptPath(groupId)) || 'null')
      return value && typeof value === 'object' ? value : { version: 1, answers: {} }
    } catch (e) { return { version: 1, answers: {} } }
  }
  function saveAttempt(reader, groupId, value) {
    try { Bridge.saveBookFile(reader.nbId, attemptPath(groupId), JSON.stringify(value || { version: 1, answers: {} })) } catch (e) {}
  }
  function resetAttempt(reader, groupId, version) {
    saveAttempt(reader, groupId, Number(version) === 2
      ? { version: 2, mode: 'practice', activities: {}, accumulatedMs: 0 }
      : { version: 1, answers: {} })
  }
  function showGroupFirst(reader, groupId) {
    if (!reader || !reader._kp) return
    var first = reader._kp.pages.find(function(p) { return p.groupId === groupId && p.groupIndex === 0 })
    if (first) show(reader, first)
  }

  function buildQuizPanel(reader, body) {
    if (!reader || !body) return
    if (!reader._kp) init(reader, reader._bxKind)
    var groups = reader._kp.pages.filter(function(entry) {
      return (entry.groupKind === 'ai-quiz' || entry.groupKind === 'study-workbook') &&
        (entry.groupIndex | 0) === 0
    })
    if (window.ReaderPanels && ReaderPanels.paginateList) {
      ReaderPanels.paginateList(body, groups, function(entry) {
        var row = el('button', 'rp-row kp-quiz-row')
        row.type = 'button'
        var copy = el('span', 'kp-quiz-row-copy')
        copy.appendChild(el('span', 'rp-row-label', entry.title ||
          (entry.groupKind === 'study-workbook' ? 'Study workbook' : 'AI quiz')))
        copy.appendChild(el('span', 'kp-quiz-row-source',
          (entry.source && entry.source.label) || 'Generated from this book'))
        row.appendChild(copy)
        var count = entry.activityCount || Math.max(1, (entry.groupLength | 0) - 1)
        row.appendChild(el('span', 'kp-quiz-row-count',
          count + (entry.groupKind === 'study-workbook' ? ' activities' : ' questions')))
        row.addEventListener('click', function() {
          if (window.ReaderPanels) ReaderPanels.close()
          show(reader, entry)
        })
        return row
      }, body.closest && body.closest('.bx-drawer') ? 10 : 6)
      return
    }
    body.textContent = groups.length ? '' : 'No workbooks yet'
  }

  function listGroups(reader) {
    if (!reader) return []
    if (!reader._kp) init(reader, reader._bxKind)
    return reader._kp.pages.filter(function(entry) {
      return (entry.groupKind === 'ai-quiz' || entry.groupKind === 'study-workbook') &&
        (entry.groupIndex | 0) === 0
    })
  }
  function showActive(reader) {
    if (reader && reader._kp && reader._kp.active) show(reader, reader._kp.active)
  }
  function activeEntry(reader) { return active(reader) ? reader._kp.active : null }

  // `advance` moves the immutable source reader forward one page. While a native page is visible,
  // the source reader deliberately stays parked on its anchor page.
  function next(reader, kind, advance) {
    if (!reader._kp) init(reader, kind)
    if (reader._kp.active) {
      // Traverse the complete insertion sequence at this anchor, not just the active group.
      // Several independently compiled activities may legitimately follow one semantic unit.
      // Advancing after the first group used to jump straight to the next source section and
      // silently strand every later group until the reader travelled backwards.
      // Use the active entry's immutable anchor rather than the mutable source-reader position.
      // A PDF image load or EPUB/book reflow may settle underneath the native page during a rapid
      // turn sequence; consulting that moving position could otherwise drop the remaining workbook.
      var anchored = allAnchorPages(reader, reader._kp.active)
      var i = anchored.indexOf(reader._kp.active)
      if (i !== -1 && i + 1 < anchored.length) show(reader, anchored[i + 1])
      else {
        var entry = reader._kp.active
        hide(reader)
        parkAtAnchor(reader, entry.after, advance)
      }
      return true
    }
    var pages = afterCurrent(reader, kind)
    if (pages.length) show(reader, pages[0])
    else advance()
    return true
  }

  // `retreat` moves the immutable source reader back one page. If that source page has insertions,
  // the last insertion is what the user encounters first when travelling backward.
  function prev(reader, kind, retreat) {
    if (!reader._kp) init(reader, kind)
    if (reader._kp.active) {
      var anchored = allAnchorPages(reader, reader._kp.active)
      var i = anchored.indexOf(reader._kp.active)
      if (i > 0) show(reader, anchored[i - 1])
      else hide(reader)
      return true
    }
    var asyncMove = retreat()
    if (asyncMove) {
      reader._kpPendingBackward = true
      // EPUB/book section changes rebuild their source DOM synchronously, then settle pagination
      // asynchronously.  At section-end the new section id plus the temporary large page index are
      // already sufficient to resolve a boundary-anchored insertion. Mount it in this same input
      // turn so the browser never paints the source page first. Non-boundary anchors retain the
      // settled-layout retry because their character position may not be known yet.
      afterRetreat(reader, kind, true)
      return true
    }
    afterRetreat(reader, kind)
    return true
  }

  function afterRetreat(reader, kind, keepPendingIfUnmatched) {
    var pages = afterCurrent(reader, kind)
    if (pages.length) {
      reader._kpPendingBackward = false
      show(reader, pages[pages.length - 1])
      return true
    }
    if (!keepPendingIfUnmatched) reader._kpPendingBackward = false
    return false
  }

  function active(reader) { return !!(reader && reader._kp && reader._kp.active) }
  function activeId(reader) { return active(reader) ? reader._kp.active.id : null }
  function restore(reader, kind) {
    if (!reader || !reader._kp || !reader._kp.resumeId || reader._kp.active) return false
    var id = reader._kp.resumeId
    var entry = reader._kp.pages.find(function(p) { return p.id === id })
    if (!entry || !anchorMatches(reader, entry, kind)) return false
    reader._kp.resumeId = null
    show(reader, entry)
    return true
  }
  function close(reader) {
    if (window.BooxInk && BooxInk.isOpen && BooxInk.isOpen()) BooxInk.close()
    clearSourceReturn(reader)
    hide(reader)
    if (reader) reader._kp = null
  }

  return {
    init: init, insertAfterCurrent: insertAfterCurrent,
    insertGroup: insertGroup, deleteGroup: deleteGroup,
    next: next, prev: prev, afterRetreat: afterRetreat, active: active, activeId: activeId,
    activeEntry: activeEntry, showActive: showActive,
    showGroupFirst: showGroupFirst,
    buildQuizPanel: buildQuizPanel,
    listGroups: listGroups,
    openEvidence: openEvidence, afterAnchorNavigation: afterAnchorNavigation,
    loadAttempt: loadAttempt, saveAttempt: saveAttempt, resetAttempt: resetAttempt,
    restore: restore, close: close
  }
})()
