// Format-neutral study-source collection. Every adapter returns the same bounded packet and a
// stable insertion anchor; AI/provider code never reaches into a reader implementation directly.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.ReaderStudySource = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var MAX_CHARS = 120000
  var DEFAULT_PROVIDER_CHARS = 48000
  var MAX_PDF_PAGES = 50

  function compact(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function bridgeApi() {
    if (root && root.Bridge) return root.Bridge
    try {
      if (typeof Bridge !== 'undefined') return Bridge
    } catch (e) {}
    throw new Error('The book source bridge is unavailable')
  }

  function plain(value) {
    value = String(value == null ? '' : value)
    if (root.document) {
      var d = root.document.createElement('div')
      d.innerHTML = value
      value = d.textContent || ''
    } else value = value.replace(/<[^>]*>/g, ' ')
    return compact(value.replace(/[*_`#{}[\]]/g, ' '))
  }

  function hash(text) {
    var h = 2166136261
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8)
  }

  function numberOrNull(value) {
    var n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  function boundedText(value, max) {
    return compact(value).slice(0, max || 500)
  }

  function safeToken(value) {
    value = String(value == null ? '' : value).trim()
    return /^[A-Za-z0-9._-]{1,160}$/.test(value) ? value : ''
  }

  // Classification is intentionally conservative. It is a routing hint for review/generation,
  // never permission to skip review or evidence validation. Heading-specific signals outweigh
  // words that happen to occur in ordinary prose.
  function classifyUnit(label, text, traits) {
    traits = traits || {}
    var heading = compact(label).toLowerCase()
    var body = compact(text).toLowerCase().slice(0, 24000)
    var sample = (heading + '\n' + body)
    var scores = {}
    function add(kind, points) { scores[kind] = (scores[kind] || 0) + points }
    function headingIs(re, kind, points) { if (re.test(heading)) add(kind, points) }
    function bodyHas(re, kind, points) { if (re.test(body)) add(kind, points) }

    headingIs(/^(title|copyright|contents|table of contents|preface|foreword|acknowledg(e)?ments?|about (the )?(author|book)|introduction to this edition)\b/, 'front-matter', 9)
    bodyHas(/\b(all rights reserved|isbn|published by|copyright ©|table of contents)\b/, 'front-matter', 4)
    headingIs(/^(index|references|bibliography|glossary|further reading|notes)\b/, 'index-reference', 10)
    bodyHas(/\b(index|references)\b.{0,80}\b(page|pp\.)\s*\d+/i, 'index-reference', 3)
    headingIs(/^(answers?|solutions?|answer key|explanations?)\b/, 'answer-solution', 11)
    bodyHas(/\b(correct answer|the answer is|solution[:.]|answer[:.]\s*[a-e1-9])\b/, 'answer-solution', 4)

    headingIs(/\b(case|case history|clinical scenario|patient)\b/, 'clinical-case', 5)
    var clinicalTerms = ['history', 'examination', 'investigation', 'diagnosis', 'management']
    clinicalTerms.forEach(function(term) {
      if (new RegExp('\\b' + term + 's?\\b').test(sample)) add('clinical-case', 1.5)
    })
    bodyHas(/\b(a|an|the)\s+\d{1,3}[- ]year[- ]old\b/, 'clinical-case', 4)

    headingIs(/\b(reading passage|passage|data set|question set|verbal reasoning)\b/, 'passage-question-set', 5)
    bodyHas(/\baccording to (the|this) passage\b|\btrue,? false,? (or )?can'?t tell\b/, 'passage-question-set', 5)
    if ((body.match(/\?/g) || []).length >= 3) add('passage-question-set', 2)

    headingIs(/\b(exercises?|practice questions?|problems?|review questions?|quiz|test yourself)\b/, 'exercise', 7)
    bodyHas(/\bchoose (the|all)|select (the|all)|calculate|show your work|questions?\s+\d+\b/, 'exercise', 3)

    headingIs(/\b(cipher|cryptogram|code breaker|decode|encoding)\b/, 'cipher-logic', 8)
    bodyHas(/\b(caesar|substitution cipher|decode|encoded message|symbol mapping|logic grid)\b/, 'cipher-logic', 6)
    headingIs(/\b(puzzles?|riddles?|mysteries|lateral thinking|brain teasers?|clues?)\b/, 'puzzle-riddle', 7)
    bodyHas(/\b(riddle|mystery|lateral thinking|what am i|clue)\b/, 'puzzle-riddle', 4)

    headingIs(/\b(graph|chart|plot|coordinate|axes?)\b/, 'graph', 6)
    bodyHas(/\b(x[- ]axis|y[- ]axis|bar chart|line graph|scatter plot|plot the|gradient of the graph)\b/, 'graph', 5)
    headingIs(/\b(table|data|results)\b/, 'table-data', 4)
    bodyHas(/\b(the following table|data in the table|tabulated|row|column)\b/, 'table-data', 3)
    if (traits.tableCount > 0) add('table-data', 5 + Math.min(2, traits.tableCount - 1))
    headingIs(/\b(figure|diagram|illustration|plate|anatomy)\b/, 'figure-dependent', 4)
    bodyHas(/\b(see|shown in|refer to)\s+(figure|fig\.|diagram|image|plate)\b|\blabel the diagram\b/, 'figure-dependent', 4)
    if (traits.figureCount > 0) add('figure-dependent', 4 + Math.min(2, traits.figureCount - 1))

    var bestKind = 'general-prose'
    var bestScore = 0
    Object.keys(scores).forEach(function(kind) {
      if (scores[kind] > bestScore) { bestKind = kind; bestScore = scores[kind] }
    })
    // A single weak word is not enough to route content away from general prose.
    if (bestScore < 4) return { kind: 'general-prose', confidence: 0.55 }
    return { kind: bestKind, confidence: Math.min(0.98, Number((0.58 + bestScore * 0.035).toFixed(2))) }
  }

  function defaultQuality(format, extras) {
    extras = extras || {}
    return {
      extractionMethod: extras.extractionMethod || (format === 'pdf' ? 'pdf-text-layer' : (format === 'epub' ? 'epub-dom' : 'structured-blocks')),
      ocrConfidence: extras.ocrConfidence == null ? null : Math.max(0, Math.min(1, Number(extras.ocrConfidence) || 0)),
      warnings: Array.isArray(extras.warnings) ? extras.warnings.map(function(x) { return boundedText(x, 240) }).filter(Boolean) : [],
      visualReviewRequired: !!extras.visualReviewRequired
    }
  }

  function unitRecord(id, label, segments, figures, tables, extra) {
    extra = extra || {}
    var text = segments.map(function(s) { return s.text }).join('\n')
    var classification = classifyUnit(label, text, {
      figureCount: figures.length,
      tableCount: tables.length
    })
    var out = {
      id: String(id),
      label: label,
      classification: classification,
      segmentRefs: segments.map(function(s) { return s.id }),
      figureRefs: figures.map(function(f) { return f.id }),
      tableRefs: tables.map(function(t) { return t.id })
    }
    if (Number.isInteger(extra.pageIndex) && extra.pageIndex >= 0) out.pageIndex = extra.pageIndex
    return out
  }

  function finish(format, scope, label, anchor, segments, extras) {
    extras = extras || {}
    segments = segments.map(function(s, i) {
      var out = {
        id: s.id || ('segment-' + (i + 1)),
        label: s.label || label,
        text: compact(s.text)
      }
      if (extras.schemaVersion === 3) {
        out.packetGroupId = safeToken(s.packetGroupId)
        out.required = s.required !== false
        out.relationshipKinds = Array.isArray(s.relationshipKinds)
          ? s.relationshipKinds.map(function(kind) { return safeToken(kind) }).filter(Boolean).slice(0, 12) : []
      }
      // Navigation data is assigned locally by the source adapter and is never sent to the model
      // (see deepseek-provider.sourcePayload). It lets a validated evidence ID resolve back to the
      // exact source passage without trusting model-supplied offsets or renderer instructions.
      if (s.target && typeof s.target === 'object') out.target = s.target
      return out
    }).filter(function(s) { return s.text.length >= 2 })
    if (!segments.length) throw new Error('No readable text was found in this selection')
    if (extras.schemaVersion === 3 && segments.reduce(function(n, s) { return n + s.text.length }, 0) > DEFAULT_PROVIDER_CHARS) {
      var required = segments.filter(function(segment) { return segment.required !== false })
      var requiredChars = required.reduce(function(n, segment) { return n + segment.text.length }, 0)
      if (requiredChars > DEFAULT_PROVIDER_CHARS)
        throw new Error('This semantic unit and its linked answer/context evidence exceed the safe model input ceiling. It was not truncated.')
      var bounded = required.slice(), used = requiredChars
      segments.filter(function(segment) { return segment.required === false }).some(function(segment) {
        if (used + segment.text.length > DEFAULT_PROVIDER_CHARS) return false
        bounded.push(segment); used += segment.text.length
        return false
      })
      segments = bounded
      extras.quality = Object.assign({}, extras.quality || {}, {
        warnings: (extras.quality && extras.quality.warnings || []).concat(['Provider packet was bounded at a semantic segment boundary.'])
      })
    }
    var chars = segments.reduce(function(n, s) { return n + s.text.length }, 0)
    if (chars > MAX_CHARS)
      throw new Error('This selection contains ' + chars.toLocaleString() + ' characters; the limit is ' + MAX_CHARS.toLocaleString())
    var fingerprint = hash(segments.map(function(s) { return s.id + '\n' + s.text }).join('\n'))
    var figures = Array.isArray(extras.figures) ? extras.figures : []
    var tables = Array.isArray(extras.tables) ? extras.tables : []
    var units = Array.isArray(extras.units) && extras.units.length
      ? extras.units
      : [unitRecord(format + '-' + scope, label, segments, figures, tables)]
    return {
      schemaVersion: extras.schemaVersion === 3 ? 3 : 2,
      format: format,
      scope: scope,
      label: label,
      anchor: anchor,
      fingerprint: fingerprint,
      characterCount: chars,
      units: units,
      segments: segments,
      figures: figures,
      tables: tables,
      quality: defaultQuality(format, extras.quality),
      structure: extras.structure || null
    }
  }

  function dimensionsFrom(node) {
    if (!node) return null
    var width = numberOrNull(node.naturalWidth || node.width || (node.getAttribute && node.getAttribute('width')))
    var height = numberOrNull(node.naturalHeight || node.height || (node.getAttribute && node.getAttribute('height')))
    return width > 0 && height > 0 ? { width: width, height: height } : null
  }

  function domMedia(rootNode, prefix, targetBase) {
    var figures = []
    var tables = []
    var figureNodes = rootNode.querySelectorAll('figure,img')
    Array.prototype.forEach.call(figureNodes, function(node, i) {
      var tag = String(node.tagName || '').toLowerCase()
      if ((tag !== 'figure' && tag !== 'img') || figures.length >= 200) return
      if (tag === 'img' && node.closest && node.closest('figure')) return
      var image = tag === 'figure' && node.querySelector ? node.querySelector('img') : node
      var captionNode = tag === 'figure' && node.querySelector ? node.querySelector('figcaption') : null
      var caption = boundedText(captionNode && captionNode.textContent, 500)
      var alt = boundedText(image && image.getAttribute && image.getAttribute('alt'), 300)
      var label = caption || alt || ('Figure ' + (figures.length + 1))
      var id = prefix + '-figure-' + (figures.length + 1)
      var figure = {
        id: id,
        label: label,
        caption: caption,
        altText: alt,
        contentHash: hash([label, caption, alt].join('\n')),
        target: Object.assign({}, targetBase || {}, { figureIndex: figures.length })
      }
      var dims = dimensionsFrom(image)
      if (dims) figure.dimensions = dims
      figures.push(figure)
    })

    var tableNodes = rootNode.querySelectorAll('table')
    Array.prototype.forEach.call(tableNodes, function(table, i) {
      var tag = String(table.tagName || '').toLowerCase()
      if (tag !== 'table' || tables.length >= 100) return
      var captionNode = table.querySelector && table.querySelector('caption')
      var rows = []
      var rowNodes = table.querySelectorAll ? table.querySelectorAll('tr') : []
      Array.prototype.forEach.call(rowNodes, function(row) {
        var cells = row.querySelectorAll ? row.querySelectorAll('th,td') : []
        var values = Array.prototype.map.call(cells, function(cell) { return boundedText(cell.textContent, 1000) }).slice(0, 32)
        if (values.some(Boolean)) rows.push(values)
      })
      var caption = boundedText(captionNode && captionNode.textContent, 500)
      var id = prefix + '-table-' + (i + 1)
      tables.push({
        id: id,
        label: caption || ('Table ' + (i + 1)),
        headers: rows.length ? rows[0] : [],
        rows: rows.length > 1 ? rows.slice(1, 101) : [],
        contentHash: hash(JSON.stringify(rows)),
        target: Object.assign({}, targetBase || {}, { tableIndex: i })
      })
    })
    return { figures: figures, tables: tables }
  }

  function domSegments(rootNode, prefix, label, targetBase) {
    var selectors = 'h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,td,th'
    var nodes = rootNode.querySelectorAll(selectors)
    var out = []
    var fullText = String(rootNode.textContent || '')
    var cursor = 0
    Array.prototype.forEach.call(nodes, function(node, i) {
      var raw = String(node.textContent || '')
      var t = compact(raw)
      if (!t) return
      var start = fullText.indexOf(raw, cursor)
      if (start < 0) start = fullText.indexOf(raw)
      if (start < 0) start = 0
      cursor = start + raw.length
      var target = Object.assign({}, targetBase || {}, {
        segmentIndex: i,
        start: start,
        end: Math.max(start + 1, start + raw.length)
      })
      out.push({ id: prefix + '-' + (i + 1), label: label, text: t, target: target })
    })
    if (!out.length && compact(rootNode.textContent)) {
      out.push({
        id: prefix + '-1',
        label: label,
        text: compact(rootNode.textContent),
        target: Object.assign({}, targetBase || {}, {
          segmentIndex: 0, start: 0, end: Math.max(1, fullText.length)
        })
      })
    }
    return out
  }

  function epubUnits(reader) {
    var spine = (reader.manifest && reader.manifest.spine) || []
    var toc = (reader.manifest && reader.manifest.toc) || []
    return spine.map(function(item, idx) {
      var tocRow = toc.find(function(t) { return t.spineIdx === idx })
      return {
        id: String(idx),
        label: (tocRow && tocRow.label) || item.title || ('Chapter ' + (idx + 1)),
        detail: 'Chapter ' + (idx + 1),
        scope: { mode: 'chapter', spineIdx: idx }
      }
    })
  }

  function collectEpub(reader, scope) {
    var requested = scope && scope.mode === 'chapter' ? parseInt(scope.spineIdx, 10) : reader.spineIdx
    var idx = Number.isInteger(requested) ? requested : (reader.spineIdx | 0)
    var spine = (reader.manifest && reader.manifest.spine) || []
    var item = spine[idx]
    if (!item) throw new Error('The selected EPUB chapter is unavailable')
    var toc = (reader.manifest && reader.manifest.toc) || []
    var tocRow = toc.find(function(t) { return t.spineIdx === idx })
    var label = (tocRow && tocRow.label) || item.title || ('Chapter ' + (idx + 1))
    var raw = reader._chCache && reader._chCache[idx]
    if (raw == null) raw = bridgeApi().epubEntry(reader.nbId, item.href) || ''
    var holder = root.document.createElement('div')
    var sanitized = typeof root.epSanitize === 'function' ? root.epSanitize(raw, { keepStyle: false }) : { html: raw }
    holder.innerHTML = sanitized.html || ''
    var media = domMedia(holder, 'epub-' + idx, { kind: 'epub', spineIdx: idx })
    var segments = domSegments(holder, 'epub-' + idx, label, { kind: 'epub', spineIdx: idx })
    return finish('epub', 'chapter', label,
      { kind: 'epub', spineIdx: idx, boundary: 'section-end' },
      segments, {
        figures: media.figures,
        tables: media.tables,
        units: [unitRecord('epub-' + idx, label, segments, media.figures, media.tables)],
        quality: {
          extractionMethod: 'epub-dom',
          visualReviewRequired: media.figures.length > 0
        }
      })
  }

  function blockText(block) {
    if (!block || typeof block !== 'object') return ''
    switch (block.type) {
      case 'text': return plain(block.md)
      case 'image': return plain([block.alt, block.caption].filter(Boolean).join('. '))
      case 'table': return plain(block.content)
      case 'callout': return plain([block.title, block.term, block.def, block.md].filter(Boolean).join('. '))
      case 'columns': return plain(block.md)
      case 'grid': return plain([block.title].concat((block.items || []).map(function(x) { return x.t || x.md })).join('. '))
      case 'timeline': return plain((block.items || []).map(function(x) { return [x.date, x.md].filter(Boolean).join(': ') }).join('. '))
      case 'flashcard': return plain([block.front, block.back].join('. '))
      case 'cloze': return plain(block.md)
      case 'panel': return plain([block.title].concat((block.blocks || []).map(blockText)).join('. '))
      case 'mcq': return plain(block.prompt)
      default: return ''
    }
  }

  function blocksToSegments(blocks, sid, label) {
    return (Array.isArray(blocks) ? blocks : []).map(function(block, i) {
      return {
        id: 'book-' + sid + '-' + String(block && block.id || (i + 1)),
        label: label,
        text: blockText(block),
        target: {
          kind: 'book',
          sectionId: String(sid),
          blockId: String(block && block.id || (i + 1))
        }
      }
    }).filter(function(s) { return s.text })
  }

  function markdownTableRows(content) {
    if (Array.isArray(content)) return content.map(function(row) {
      return (Array.isArray(row) ? row : [row]).map(function(cell) { return boundedText(cell, 1000) }).slice(0, 32)
    }).filter(function(row) { return row.some(Boolean) }).slice(0, 101)
    var lines = String(content == null ? '' : content).split(/\r?\n/).map(function(line) {
      return line.replace(/^\s*\||\|\s*$/g, '').split('|').map(function(cell) { return boundedText(cell, 1000) }).slice(0, 32)
    }).filter(function(row) {
      return row.length > 1 && !row.every(function(cell) { return /^:?-{3,}:?$/.test(cell) })
    })
    return lines.slice(0, 101)
  }

  function blockMedia(blocks, sid) {
    var figures = []
    var tables = []
    function visit(list) {
      ;(Array.isArray(list) ? list : []).forEach(function(block, i) {
        if (!block || typeof block !== 'object') return
        var blockId = String(block.id || (i + 1))
        if (block.type === 'image' && figures.length < 200) {
          var label = boundedText(block.caption || block.alt, 500) || ('Figure ' + (figures.length + 1))
          var figure = {
            id: 'book-' + sid + '-figure-' + (figures.length + 1),
            label: label,
            caption: boundedText(block.caption, 500),
            altText: boundedText(block.alt, 300),
            contentHash: hash([label, block.alt || '', block.caption || ''].join('\n')),
            target: { kind: 'book', sectionId: String(sid), blockId: blockId }
          }
          var width = numberOrNull(block.width != null ? block.width : block.w)
          var height = numberOrNull(block.height != null ? block.height : block.h)
          if (width > 0 && height > 0) figure.dimensions = { width: width, height: height }
          figures.push(figure)
        } else if (block.type === 'table' && tables.length < 100) {
          var rows = markdownTableRows(block.content || block.rows || block.data)
          tables.push({
            id: 'book-' + sid + '-table-' + (tables.length + 1),
            label: boundedText(block.title || block.caption, 500) || ('Table ' + (tables.length + 1)),
            headers: rows.length ? rows[0] : [],
            rows: rows.length > 1 ? rows.slice(1) : [],
            contentHash: hash(JSON.stringify(rows)),
            target: { kind: 'book', sectionId: String(sid), blockId: blockId }
          })
        }
        if (block.type === 'panel' && Array.isArray(block.blocks)) visit(block.blocks)
      })
    }
    visit(blocks)
    return { figures: figures, tables: tables }
  }

  function bookUnits(reader) {
    var spine = (reader.manifest && reader.manifest.spine) || []
    var toc = (reader.toc && (reader.toc.items || reader.toc)) || (reader.manifest && reader.manifest.toc) || []
    var catalogue = structuredSourceCatalogue(reader)
    if (catalogue && Array.isArray(catalogue.units)) return catalogue.units.map(function(unit, idx) {
      var sectionId = unit.sectionId || (unit.sectionIds && unit.sectionIds[0])
      var sectionIndex = spine.findIndex(function(row) { return String(row.sectionId || row.id) === String(sectionId) })
      return {
        id: String(unit.id), label: unit.label || ('Unit ' + (idx + 1)),
        detail: String(unit.role || 'unit').replace(/-/g, ' '), role: unit.role,
        hierarchyPath: unit.hierarchyPath || [], augmentation: unit.augmentation || null,
        scope: { mode: 'semantic-unit', unitId: String(unit.id), sectionId: sectionId,
          sectionIndex: sectionIndex >= 0 ? sectionIndex : idx }
      }
    })
    return spine.map(function(row, idx) {
      var sid = row.sectionId || row.id || String(idx)
      var tocRow = Array.isArray(toc) && toc.find(function(t) {
        return t.sectionId === sid || String(t.href || '').split('#', 1)[0] === String(sid) || t.spineIdx === idx
      })
      return {
        id: String(sid),
        label: (tocRow && (tocRow.label || tocRow.title)) || row.title || ('Section ' + (idx + 1)),
        detail: 'Section ' + (idx + 1),
        scope: { mode: 'section', sectionId: sid, sectionIndex: idx }
      }
    })
  }

  function structuredSourceCatalogue(reader) {
    if (reader._studySourceCatalogue !== undefined) return reader._studySourceCatalogue
    var raw = ''
    try { raw = bridgeApi().getBookFile(reader.nbId, 'sidecar/source-units.json') || '' } catch (e) {}
    var parsed = null
    try { parsed = JSON.parse(raw) } catch (e) {}
    reader._studySourceCatalogue = parsed && parsed.schema === 'kalamos.source-units/v2' ? parsed : null
    return reader._studySourceCatalogue
  }

  function collectBook(reader, scope) {
    var spine = (reader.manifest && reader.manifest.spine) || []
    var catalogue = structuredSourceCatalogue(reader)
    var structuredUnit = catalogue && scope && scope.mode === 'semantic-unit'
      ? catalogue.units.find(function(unit) { return String(unit.id) === String(scope.unitId) }) : null
    var requested = scope && (scope.mode === 'section' || scope.mode === 'semantic-unit') ? parseInt(scope.sectionIndex, 10) : reader.sec
    var idx = Number.isInteger(requested) && requested >= 0 && requested < spine.length ? requested : reader.sec
    var row = spine[idx] || {}
    var sid = scope && (scope.mode === 'section' || scope.mode === 'semantic-unit') && scope.sectionId != null
      ? String(scope.sectionId)
      : (row.sectionId || row.id || (idx === reader.sec ? reader.sectionId() : ''))
    if (!sid) throw new Error('The selected book section is unavailable')
    var toc = (reader.toc && (reader.toc.items || reader.toc)) || (reader.manifest && reader.manifest.toc) || []
    var tocRow = Array.isArray(toc) && toc.find(function(t) {
      return t.sectionId === sid || String(t.href || '').split('#', 1)[0] === String(sid) || t.spineIdx === idx
    })
    var label = (structuredUnit && structuredUnit.label) || (tocRow && (tocRow.label || tocRow.title)) || row.title || ('Section ' + (idx + 1))
    var sectionIds = structuredUnit && Array.isArray(structuredUnit.sectionIds) && structuredUnit.sectionIds.length
      ? structuredUnit.sectionIds.map(String) : [String(sid)]
    var segments = []
    var media = { figures: [], tables: [] }
    var method = 'book-html'
    sectionIds.forEach(function(sectionId) {
      var sourceGroup = structuredUnit && Array.isArray(structuredUnit.sourceGroups)
        ? structuredUnit.sourceGroups.find(function(group) { return (group.sectionIds || []).map(String).indexOf(String(sectionId)) >= 0 })
        : null
      var segmentStart = segments.length, figureStart = media.figures.length, tableStart = media.tables.length
      var raw = reader._secCache && reader._secCache[sectionId]
      if (raw == null) raw = bridgeApi().getBookFile(reader.nbId, 'sections/' + sectionId + '.json') || ''
      var parsed = null
      try { parsed = JSON.parse(raw) } catch (e) {}
      if (parsed && Array.isArray(parsed.blocks)) {
        segments = segments.concat(blocksToSegments(parsed.blocks, sectionId, parsed.title || label))
        var found = blockMedia(parsed.blocks, sectionId)
        media.figures = media.figures.concat(found.figures); media.tables = media.tables.concat(found.tables)
        method = 'structured-blocks'
      } else {
        var html = bridgeApi().getBookFile(reader.nbId, 'sections/' + sectionId + '.html') || ''
        var holder = root.document.createElement('div'); holder.innerHTML = html
        segments = segments.concat(domSegments(holder, 'book-' + sectionId, label, {
          kind: 'book', sectionId: String(sectionId)
        }))
        var domFound = domMedia(holder, 'book-' + sectionId, { kind: 'book', sectionId: String(sectionId) })
        media.figures = media.figures.concat(domFound.figures); media.tables = media.tables.concat(domFound.tables)
      }
      segments.slice(segmentStart).forEach(function(segment) {
        segment.packetGroupId = sourceGroup ? sourceGroup.id : 'section-' + sectionId
        segment.required = !sourceGroup || sourceGroup.required !== false
        segment.relationshipKinds = sourceGroup && sourceGroup.relationshipKinds || []
      })
      media.figures.slice(figureStart).forEach(function(figure) {
        figure.packetGroupId = sourceGroup ? sourceGroup.id : 'section-' + sectionId
        figure.required = !sourceGroup || sourceGroup.required !== false
      })
      media.tables.slice(tableStart).forEach(function(table) {
        table.packetGroupId = sourceGroup ? sourceGroup.id : 'section-' + sectionId
        table.required = !sourceGroup || sourceGroup.required !== false
      })
    })
    var packetUnit = unitRecord('book-' + (structuredUnit ? structuredUnit.id : sid), label, segments, media.figures, media.tables)
    if (structuredUnit) {
      packetUnit.role = structuredUnit.role; packetUnit.hierarchyPath = structuredUnit.hierarchyPath || []
      packetUnit.relationshipRefs = structuredUnit.relationshipRefs || []
      packetUnit.augmentation = structuredUnit.augmentation || null
    }
    return finish('book', structuredUnit ? 'semantic-unit' : 'section', label,
      { kind: 'book', sectionId: sectionIds[sectionIds.length - 1], boundary: 'section-end' }, segments, {
        figures: media.figures,
        tables: media.tables,
        units: [packetUnit],
        schemaVersion: structuredUnit ? 3 : 2,
        structure: structuredUnit ? {
          schema: catalogue.schema, bookMapSchema: catalogue.bookMapSchema,
          unitId: structuredUnit.id, role: structuredUnit.role,
          hierarchyPath: structuredUnit.hierarchyPath || [], nodeRefs: structuredUnit.nodeRefs || [],
          relationshipRefs: structuredUnit.relationshipRefs || [], answerRefs: structuredUnit.answerRefs || [],
          contextRefs: structuredUnit.contextRefs || [], estimatedTokens: structuredUnit.estimatedTokens,
          sourceGroups: structuredUnit.sourceGroups || [], packetPolicy: structuredUnit.packetPolicy || {},
          archetype: catalogue.archetype || null, augmentation: structuredUnit.augmentation || null
        } : null,
        quality: {
          extractionMethod: method,
          warnings: structuredUnit && structuredUnit.quality ? structuredUnit.quality.warnings : [],
          visualReviewRequired: media.figures.length > 0 || !!(structuredUnit && structuredUnit.quality && structuredUnit.quality.warnings.length)
        }
      })
  }

  function normalPdfRange(reader, scope) {
    var current = (reader.pageIndex | 0) + 1
    var explicit = scope && (scope.mode === 'range' || scope.mode === 'pdf-chapter')
    var from = explicit ? parseInt(scope.from, 10) : current
    var to = explicit ? parseInt(scope.to, 10) : current
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error('Enter a valid PDF page range')
    var lo = Math.min(from, to), hi = Math.max(from, to)
    if (lo < 1 || hi > reader.pages) throw new Error('PDF pages must be between 1 and ' + reader.pages)
    if (hi - lo + 1 > MAX_PDF_PAGES) throw new Error('A PDF quiz can use at most ' + MAX_PDF_PAGES + ' pages')
    return { from: lo, to: hi }
  }

  function collectPdf(reader, scope) {
    var api = bridgeApi()
    if (!api.pdfHasTextLayer(reader.nbId))
      throw new Error('This PDF has no readable text layer. OCR support is planned for a later version.')
    var range = normalPdfRange(reader, scope)
    var raw = api.pdfPagesText(reader.nbId, range.from - 1, range.to - 1)
    var pages = []
    try { pages = JSON.parse(raw || '[]') } catch (e) {}
    var segments = []
    for (var i = 0; i <= range.to - range.from; i++) {
      var page = range.from + i
      var value = compact(pages[i] || '')
      if (value) segments.push({
        id: 'pdf-page-' + page,
        label: 'Page ' + page,
        text: value,
        target: { kind: 'pdf', pageIndex: page - 1, start: 0, end: value.length }
      })
    }
    var isChapter = scope && scope.mode === 'pdf-chapter'
    var label = isChapter && compact(scope.label)
      ? compact(scope.label)
      : (range.from === range.to ? ('Page ' + range.from) : ('Pages ' + range.from + '–' + range.to))
    var figures = pdfFigureRefs(api, reader, range)
    var emptyPages = []
    var units = []
    for (var p = range.from; p <= range.to; p++) {
      var pageSegments = segments.filter(function(s) { return s.id === 'pdf-page-' + p })
      var pageFigures = figures.filter(function(f) { return f.target && f.target.pageIndex === p - 1 })
      if (!pageSegments.length) emptyPages.push(p)
      units.push(unitRecord('pdf-page-' + p, 'Page ' + p, pageSegments, pageFigures, [], { pageIndex: p - 1 }))
    }
    return finish('pdf', isChapter ? 'chapter' : (range.from === range.to ? 'page' : 'page-range'), label,
      { kind: 'pdf', pageIndex: range.to - 1 }, segments, {
        figures: figures,
        tables: [],
        units: units,
        quality: {
          extractionMethod: 'pdf-text-layer',
          warnings: emptyPages.length ? ['No readable text was extracted from page' + (emptyPages.length > 1 ? 's ' : ' ') + emptyPages.join(', ') + '.'] : [],
          visualReviewRequired: figures.length > 0 || emptyPages.length > 0
        }
      })
  }

  function pdfFigureRefs(api, reader, range) {
    if (!api || typeof api.pdfPageFigureRefs !== 'function') return []
    var raw
    try { raw = api.pdfPageFigureRefs(reader.nbId, range.from - 1, range.to - 1) } catch (e) { return [] }
    var rows
    try { rows = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw } catch (e) { rows = [] }
    if (!Array.isArray(rows)) return []
    var seen = {}
    return rows.map(function(row, i) {
      if (!row || typeof row !== 'object') return null
      var pageIndex = parseInt(row.pageIndex, 10)
      if (!Number.isInteger(pageIndex) || pageIndex < range.from - 1 || pageIndex > range.to - 1) return null
      var suppliedRef = safeToken(row.ref || row.id || row.placeholderRef)
      if (!suppliedRef || seen[suppliedRef]) return null
      seen[suppliedRef] = true
      var figure = {
        id: 'pdf-' + suppliedRef,
        label: boundedText(row.label || row.caption, 500) || ('Figure on page ' + (pageIndex + 1)),
        caption: boundedText(row.caption, 500),
        altText: boundedText(row.altText || row.alt, 300),
        contentHash: safeToken(row.contentHash) || hash([suppliedRef, pageIndex, row.caption || ''].join('\n')),
        placeholderRef: suppliedRef,
        target: { kind: 'pdf', pageIndex: pageIndex }
      }
      var width = numberOrNull(row.width)
      var height = numberOrNull(row.height)
      if (width != null && height != null) figure.dimensions = { width: width, height: height }
      if (row.bounds && typeof row.bounds === 'object') {
        var x = Number(row.bounds.x), y = Number(row.bounds.y), w = Number(row.bounds.width), h = Number(row.bounds.height)
        if ([x, y, w, h].every(Number.isFinite) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1)
          figure.target.bounds = { x: x, y: y, width: w, height: h }
      }
      return figure
    }).filter(Boolean).slice(0, 200)
  }

  function parsePdfOutline(reader) {
    var value = reader._outline
    if (!Array.isArray(value)) {
      try { value = JSON.parse(bridgeApi().pdfOutline(reader.nbId) || '[]') } catch (e) { value = [] }
    }
    return Array.isArray(value) ? value : []
  }

  function pdfUnits(reader) {
    var rows = parsePdfOutline(reader).map(function(row, originalIndex) {
      return {
        label: compact(row && row.label) || ('Page ' + (((row && row.pageIndex) || 0) + 1)),
        pageIndex: parseInt(row && row.pageIndex, 10),
        level: Math.max(0, parseInt(row && row.level, 10) || 0),
        originalIndex: originalIndex
      }
    }).filter(function(row) {
      return Number.isInteger(row.pageIndex) && row.pageIndex >= 0 && row.pageIndex < reader.pages
    })
    return rows.map(function(row, idx) {
      var end = reader.pages - 1
      for (var j = idx + 1; j < rows.length; j++) {
        if (rows[j].pageIndex > row.pageIndex && rows[j].level <= row.level) {
          end = rows[j].pageIndex - 1
          break
        }
      }
      end = Math.max(row.pageIndex, end)
      return {
        id: String(row.originalIndex),
        label: row.label,
        detail: row.pageIndex === end
          ? ('Page ' + (row.pageIndex + 1))
          : ('Pages ' + (row.pageIndex + 1) + '–' + (end + 1)),
        level: row.level,
        scope: {
          mode: 'pdf-chapter',
          from: row.pageIndex + 1,
          to: end + 1,
          label: row.label
        }
      }
    })
  }

  function describeScopes(reader) {
    return Promise.resolve().then(function() {
      if (!reader || !reader._bxKind) throw new Error('No active book reader')
      if (reader._bxKind === 'epub') {
        return {
          format: 'epub',
          currentMode: 'chapter',
          currentUnitId: String(reader.spineIdx | 0),
          chapterLabel: 'Chapter',
          units: epubUnits(reader),
          pageRange: null
        }
      }
      if (reader._bxKind === 'book') {
        var units = bookUnits(reader)
        return {
          format: 'book',
          currentMode: 'chapter',
          currentUnitId: units[reader.sec] ? units[reader.sec].id : '',
          chapterLabel: 'Section',
          units: units,
          pageRange: null
        }
      }
      if (reader._bxKind === 'pdf') {
        var pdfChapters = pdfUnits(reader)
        var currentPage = (reader.pageIndex | 0) + 1
        var currentChapter = pdfChapters.filter(function(unit) {
          return currentPage >= unit.scope.from && currentPage <= unit.scope.to
        }).sort(function(a, b) {
          return b.level - a.level || b.scope.from - a.scope.from
        })[0]
        return {
          format: 'pdf',
          currentMode: pdfChapters.length ? 'chapter' : 'pages',
          currentUnitId: currentChapter ? currentChapter.id : (pdfChapters[0] && pdfChapters[0].id),
          chapterLabel: 'Chapter',
          units: pdfChapters,
          pageRange: { min: 1, max: reader.pages, current: currentPage, maxSpan: MAX_PDF_PAGES }
        }
      }
      throw new Error('This book format does not support AI quizzes')
    })
  }

  function collect(reader, scope) {
    return Promise.resolve().then(function() {
      if (!reader || !reader._bxKind) throw new Error('No active book reader')
      if (reader._bxKind === 'epub') return collectEpub(reader, scope)
      if (reader._bxKind === 'book') return collectBook(reader, scope)
      if (reader._bxKind === 'pdf') return collectPdf(reader, scope || { mode: 'current' })
      throw new Error('This book format does not support AI quizzes')
    })
  }

  return {
    collect: collect,
    describeScopes: describeScopes,
    normalPdfRange: normalPdfRange,
    blocksToSegments: blocksToSegments,
    classifyUnit: classifyUnit,
    _pdfUnits: pdfUnits,
    _blockMedia: blockMedia,
    _domMedia: domMedia,
    _pdfFigureRefs: pdfFigureRefs,
    constants: { maxCharacters: MAX_CHARS, maxPdfPages: MAX_PDF_PAGES },
    _finish: finish
  }
})
