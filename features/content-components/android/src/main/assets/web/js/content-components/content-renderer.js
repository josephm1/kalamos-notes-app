(function (root, factory) {
  var api = factory(root, root.KalamosContent)
  if (typeof module === 'object' && module.exports) module.exports = api
  root.KalamosContentRenderer = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, Core) {
  'use strict'

  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function button(label, action, value, active) { return '<button type="button" class="kc-button' + (active ? ' is-active' : '') + '" data-kc-action="' + action + '" data-kc-value="' + escapeHtml(value == null ? '' : value) + '"' + (action === 'select' || action === 'toggle' ? ' aria-pressed="' + !!active + '"' : '') + '>' + escapeHtml(label) + '</button>' }
  function options(definition, attempt, multi) {
    var selected = attempt.response.selected || (multi ? [] : '')
    var rows = definition.options || (definition.kind === 'true-false-cant-tell' ? [{ id: 'true', label: 'True' }, { id: 'false', label: 'False' }, { id: 'cant-tell', label: "Can't tell" }] : [])
    return '<div class="kc-options">' + rows.map(function (row) { var active = multi ? selected.indexOf(row.id) >= 0 : selected === row.id; var action = multi ? 'toggle' : 'select'; if (!row.passages) return button(row.label, action, row.id, active); return '<fieldset class="kc-passage-option"><legend>' + button(row.label, action, row.id, active) + '</legend>' + row.passages.map(function (passage) { return '<blockquote>' + escapeHtml(passage) + '</blockquote>' }).join('') + '</fieldset>' }).join('') + '</div>'
  }
  function textInput(definition, attempt) {
    var handwriting = definition.kind === 'handwritten-response'
    return '<label class="kc-field"><span>' + (handwriting ? 'Typed alternative' : 'Your answer') + '</span><textarea data-kc-input="text" rows="4">' + escapeHtml(attempt.response.text || '') + '</textarea></label>' + (handwriting ? penHtml(definition) : '')
  }
  function initialOrder(definition) {
    var ids = (definition.items || []).map(function (row) { return row.id }), seed = 2166136261, text = String(definition.id || '')
    for (var k = 0; k < text.length; k++) seed = Math.imul(seed ^ text.charCodeAt(k), 16777619)
    for (var i = ids.length - 1; i > 0; i--) { seed = Math.imul(seed ^ i, 16777619); var j = (seed >>> 0) % (i + 1), swap = ids[i]; ids[i] = ids[j]; ids[j] = swap }
    if (ids.length > 1 && (definition.answer || []).every(function (id, index) { return ids[index] === id })) ids.push(ids.shift())
    return ids
  }
  function orderHtml(definition, attempt) {
    var ids = attempt.response.order && attempt.response.order.length ? attempt.response.order : initialOrder(definition)
    var byId = {}; (definition.items || []).forEach(function (row) { byId[row.id] = row })
    return '<ol class="kc-order">' + ids.map(function (id, i) { return '<li><span>' + escapeHtml((byId[id] || {}).label || id) + '</span><span>' + button('↑', 'order-up', i, false) + button('↓', 'order-down', i, false) + '</span></li>' }).join('') + '</ol>'
  }
  function gridHtml(definition, attempt) {
    var solution = definition.solution || definition.cells || [], size = definition.size || solution.length || 5, cells = attempt.response.cells || []
    var out = '<div class="kc-grid" style="--kc-grid:' + size + '">'
    for (var y = 0; y < size; y += 1) for (var x = 0; x < size; x += 1) {
      var given = (definition.givens || []).find(function (g) { return g.x === x && g.y === y }), value = given ? given.value : ((cells[y] || [])[x] || '')
      out += '<input inputmode="numeric" aria-label="Row ' + (y + 1) + ', column ' + (x + 1) + '" data-kc-cell="' + x + ',' + y + '" value="' + escapeHtml(value) + '"' + (given ? ' readonly' : '') + '>'
    }
    return out + '</div>'
  }
  function turnGridHtml(definition, attempt) {
    var grid = definition.grid || [], positions = attempt.response.cells || {}, actors = definition.actors || []
    return '<div class="kc-turn-grid" style="--kc-grid:' + Math.max(1, (grid[0] || []).length) + '">' + grid.map(function (row, y) { return row.map(function (cell, x) { var actor = actors.find(function (item) { var pos = positions[item.id] || item; return Number(pos.x) === x && Number(pos.y) === y }); return '<span class="' + (cell === '#' ? 'is-wall' : '') + '">' + escapeHtml(actor ? actor.label || actor.id : cell === '#' ? '■' : '') + '</span>' }).join('') }).join('') + '</div><div class="kc-directions">' + button('↑', 'move-actor', '0,-1', false) + button('←', 'move-actor', '-1,0', false) + button('→', 'move-actor', '1,0', false) + button('↓', 'move-actor', '0,1', false) + '</div>'
  }
  function penHtml(definition, overlayAsset) {
    var tools = definition.tools || ['pen', 'felt', 'circle', 'rectangle', 'triangle', 'arrow', 'eraser']
    return '<div class="kc-pen" data-kc-pen><div class="kc-pen-tools" role="toolbar" aria-label="Drawing tools">' + tools.map(function (tool) { return button(tool, 'tool', tool, tool === 'pen') }).join('') + button('Undo', 'ink-undo', '', false) + button('Redo', 'ink-redo', '', false) + button('Clear', 'ink-clear', '', false) + '</div><div class="kc-canvas-wrap' + (overlayAsset && definition.asset ? ' has-asset' : '') + '">' + (overlayAsset ? assetHtml(definition) : '') + '<canvas class="kc-canvas" aria-label="Pen response area"></canvas></div></div>'
  }
  function sceneHtml(definition) {
    var scene = definition.scene || {}, objects = scene.objects || []
    return '<svg class="kc-scene" role="img" viewBox="0 0 ' + Number(scene.width || 100) + ' ' + Number(scene.height || 100) + '">' + objects.map(function (o) {
      var common = ' data-object="' + escapeHtml(o.id) + '" opacity="' + (o.opacity == null ? 1 : Number(o.opacity)) + '"'
      if (o.type === 'circle') return '<circle' + common + ' cx="' + Number(o.x || 0) + '" cy="' + Number(o.y || 0) + '" r="' + Number(o.radius || 5) + '"/>'
      if (o.type === 'ellipse') return '<ellipse' + common + ' cx="' + Number(o.x || 0) + '" cy="' + Number(o.y || 0) + '" rx="' + Number(o.rx || 5) + '" ry="' + Number(o.ry || 3) + '"/>'
      if (o.type === 'line' || o.type === 'arrow') return '<line' + common + ' x1="' + Number(o.x1 || 0) + '" y1="' + Number(o.y1 || 0) + '" x2="' + Number(o.x2 || 0) + '" y2="' + Number(o.y2 || 0) + '"/>'
      if (o.type === 'label') return '<text' + common + ' x="' + Number(o.x || 0) + '" y="' + Number(o.y || 0) + '">' + escapeHtml(o.text || '') + '</text>'
      return '<rect' + common + ' x="' + Number(o.x || 0) + '" y="' + Number(o.y || 0) + '" width="' + Number(o.width || 10) + '" height="' + Number(o.height || 10) + '"/>'
    }).join('') + '</svg><div class="kc-scene-controls">' + button('Previous state', 'scene-prev', '', false) + button('Next state', 'scene-next', '', false) + '</div>'
  }
  function diagramLabelsHtml(definition, attempt) {
    var mapping = attempt.response.mapping || {}
    return '<div class="kc-mapping">' + (definition.targets || []).map(function (target) { return '<label>' + escapeHtml(target.label || target.id) + '<select data-kc-map="' + escapeHtml(target.id) + '"><option value="">Choose…</option>' + (definition.labels || []).map(function (label) { return '<option value="' + escapeHtml(label.id) + '"' + (mapping[target.id] === label.id ? ' selected' : '') + '>' + escapeHtml(label.label) + '</option>' }).join('') + '</select></label>' }).join('') + '</div>'
  }
  function evidenceBoardHtml(definition, attempt) {
    var linked = attempt.response.pairs || []
    return '<div class="kc-evidence-board">' + (definition.evidence || []).map(function (evidence) {
      return '<fieldset class="kc-evidence-card"><legend>' + escapeHtml(evidence.label) + '</legend>' + (definition.claims || []).map(function (claim) {
        var checked = linked.some(function (pair) { return pair.left === evidence.id && pair.right === claim.id })
        return '<label><input type="checkbox" data-kc-evidence="' + escapeHtml(evidence.id) + '" data-kc-claim="' + escapeHtml(claim.id) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHtml(claim.label) + '</span></label>'
      }).join('') + '</fieldset>'
    }).join('') + '</div>'
  }
  function body(definition, attempt) {
    var kind = definition.kind
    if (kind === 'single-choice' || kind === 'true-false-cant-tell') return options(definition, attempt, false)
    if (kind === 'multi-select') return options(definition, attempt, true)
    if (['short-answer', 'handwritten-response', 'cipher-code'].indexOf(kind) >= 0) return textInput(definition, attempt)
    if (kind === 'numeric-answer') return '<label class="kc-field"><span>Answer</span><input data-kc-input="number" inputmode="decimal" value="' + escapeHtml(attempt.response.number == null ? '' : attempt.response.number) + '"></label>'
    if (kind === 'estimate-slider') return '<label class="kc-field"><span>Estimate: <output data-kc-output>' + escapeHtml(attempt.response.number == null ? definition.min : attempt.response.number) + '</output> ' + escapeHtml(definition.unit || '') + '</span><input data-kc-input="range" type="range" min="' + Number(definition.min) + '" max="' + Number(definition.max) + '" step="' + Number(definition.step || 1) + '" value="' + Number(attempt.response.number == null ? definition.min : attempt.response.number) + '"></label>'
    if (['ordering', 'timeline', 'image-sequencing'].indexOf(kind) >= 0) return orderHtml(definition, attempt)
    if (kind === 'evidence-board') return evidenceBoardHtml(definition, attempt)
    if (kind === 'reveal-card') return '<article class="kc-reveal"><strong>' + escapeHtml(definition.front || definition.prompt) + '</strong><div data-kc-reveal hidden>' + escapeHtml(definition.back || '') + '</div>' + button('Reveal', 'reveal', '', false) + '</article>'
    if (['constraint-grid', 'crossword', 'nonogram'].indexOf(kind) >= 0) return gridHtml(definition, attempt)
    if (kind === 'turn-based-grid') return turnGridHtml(definition, attempt)
    if (kind === 'interactive-scene') return sceneHtml(definition)
    if (['hotspot', 'multi-hotspot', 'graph-plotting', 'geometry-construction', 'trace-path', 'sketch-annotate', 'visual-reconstruction', 'mark-and-describe', 'diagram-labelling'].indexOf(kind) >= 0) {
      var requirements = kind === 'visual-reconstruction' ? '<ul class="kc-requirements">' + (definition.requirements || []).map(function (item) { return '<li>' + escapeHtml(item) + '</li>' }).join('') + '</ul>' : ''
      return requirements + penHtml(definition, true) + (kind === 'mark-and-describe' ? textInput({ kind: 'short-answer' }, attempt) : kind === 'diagram-labelling' ? diagramLabelsHtml(definition, attempt) : '')
    }
    if (kind === 'progressive-case') {
      if (attempt.response.complete) return '<article class="kc-case"><strong>Case complete</strong><p>' + escapeHtml((definition.stages || []).length + ' stages recorded. Check the feedback below.') + '</p></article>'
      var stage = (definition.stages || [])[attempt.response.stage || 0] || {}, last = attempt.response.lastStageResult
      return (last ? '<p class="kc-case-feedback">Previous response: ' + escapeHtml(last.correct == null ? 'recorded for review' : last.correct ? 'correct' : 'not correct') + '.</p>' : '') + '<article class="kc-case"><p>' + escapeHtml(stage.body || '') + '</p><strong>' + escapeHtml(stage.prompt || '') + '</strong></article>' + options({ options: stage.options || [] }, attempt, false) + (!stage.options || !stage.options.length ? textInput({ kind: 'short-answer' }, attempt) : '')
    }
    if (kind === 'memory-pairs') return '<div class="kc-options">' + (definition.cards || []).map(function (card) { var matched = (attempt.response.pairs || []).some(function (pair) { return pair.left === card.id || pair.right === card.id }); return button(matched ? card.label : '?', 'memory', card.id, matched) }).join('') + '</div>'
    if (kind === 'word-search') return '<div class="kc-word-search"><div class="kc-letter-grid" style="--kc-grid:' + Number(definition.size || 1) + '">' + (definition.cells || []).flat().map(function (letter) { return '<span>' + escapeHtml(letter) + '</span>' }).join('') + '</div><div class="kc-options">' + (definition.words || []).map(function (word) { return button(word, 'toggle', word, (attempt.response.selected || []).indexOf(word) >= 0) }).join('') + '</div></div>'
    if (kind === 'resource-allocation') return '<div class="kc-mapping">' + (definition.choices || []).map(function (choice) { return '<label>' + escapeHtml(choice.label) + '<input type="number" min="0" data-kc-allocation="' + escapeHtml(choice.id) + '" value="' + escapeHtml((attempt.response.mapping || {})[choice.id] || 0) + '"></label>' }).join('') + '</div>'
    if (kind === 'logic-grid') return '<label class="kc-field"><span>Solution mapping (JSON)</span><textarea data-kc-input="text" rows="6">' + escapeHtml(attempt.response.text || '') + '</textarea></label>'
    if (kind === 'categorisation') return '<div class="kc-mapping">' + (definition.items || []).map(function (item) { return '<label>' + escapeHtml(item.label) + '<select data-kc-map="' + escapeHtml(item.id) + '"><option value="">Choose…</option>' + (definition.categories || []).map(function (cat) { return '<option value="' + escapeHtml(cat.id) + '"' + ((attempt.response.mapping || {})[item.id] === cat.id ? ' selected' : '') + '>' + escapeHtml(cat.label) + '</option>' }).join('') + '</select></label>' }).join('') + '</div>'
    if (kind === 'matching-pairs') return '<div class="kc-mapping">' + (definition.left || []).map(function (item) { var current = (attempt.response.pairs || []).find(function (pair) { return pair.left === item.id }); return '<label>' + escapeHtml(item.label) + '<select data-kc-pair="' + escapeHtml(item.id) + '"><option value="">Choose…</option>' + (definition.right || []).map(function (right) { return '<option value="' + escapeHtml(right.id) + '"' + (current && current.right === right.id ? ' selected' : '') + '>' + escapeHtml(right.label) + '</option>' }).join('') + '</select></label>' }).join('') + '</div>'
    if (kind === 'cloze' || kind === 'table-completion') return textInput(definition, attempt)
    return '<div class="kc-generic">' + options({ options: definition.choices || definition.items || [] }, attempt, true) + '</div>'
  }
  function assetHtml(definition) { var asset = definition.asset; return asset ? '<div class="kc-asset" data-kc-asset="' + escapeHtml(asset.id) + '" role="img" aria-label="' + escapeHtml(asset.alt || 'Activity image') + '"></div>' : '' }
  function regionAt(definition, point) {
    if (!point) return ''
    function polygonContains(points) { var inside = false; for (var i = 0, j = points.length - 1; i < points.length; j = i++) { var a = points[i], b = points[j]; if (((a.y > point.y) !== (b.y > point.y)) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside } return inside }
    var matches = (definition.regions || []).filter(function (region) {
      if (region.points && region.points.length >= 3) return polygonContains(region.points)
      var x = Number(region.x || 0), y = Number(region.y || 0), width = Number(region.width || .06), height = Number(region.height || .06)
      if (region.shape === 'circle') { var rx = Math.max(width / 2, .015), ry = Math.max(height / 2, .015); return Math.pow((point.x - (x + width / 2)) / rx, 2) + Math.pow((point.y - (y + height / 2)) / ry, 2) <= 1 }
      if (region.shape === 'point') return Math.hypot(point.x - x, point.y - y) <= Math.max(width, height, .04)
      return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height
    })
    return matches.length ? matches[0].id : ''
  }
  function assetPoint(canvas, point) {
    var image = canvas && canvas._kcBackgroundImage; if (!image || !image.naturalWidth || !image.naturalHeight) return point
    var width = canvas.clientWidth, height = canvas.clientHeight, scale = Math.min(width / image.naturalWidth, height / image.naturalHeight), drawnWidth = image.naturalWidth * scale, drawnHeight = image.naturalHeight * scale, left = (width - drawnWidth) / 2, top = (height - drawnHeight) / 2, px = point.x * width, py = point.y * height
    if (px < left || px > left + drawnWidth || py < top || py > top + drawnHeight) return null
    return { x: (px - left) / drawnWidth, y: (py - top) / drawnHeight }
  }
  function canvasPoint(canvas, point) {
    var image = canvas && canvas._kcBackgroundImage; if (!image || !image.naturalWidth || !image.naturalHeight) return point
    var width = canvas.clientWidth, height = canvas.clientHeight, scale = Math.min(width / image.naturalWidth, height / image.naturalHeight), drawnWidth = image.naturalWidth * scale, drawnHeight = image.naturalHeight * scale
    return { x: ((width - drawnWidth) / 2 + point.x * drawnWidth) / width, y: ((height - drawnHeight) / 2 + point.y * drawnHeight) / height }
  }

  function nativeInkBounds(rect, dpr, viewportWidth, viewportHeight) {
    var ratio = Number(dpr) || 1, screenW = Math.max(1, Math.round(Number(viewportWidth) * ratio)), screenH = Math.max(1, Math.round(Number(viewportHeight) * ratio))
    return {
      l: Math.max(0, Math.min(screenW, Math.floor(Number(rect.left || 0) * ratio))),
      t: Math.max(0, Math.min(screenH, Math.floor(Number(rect.top || 0) * ratio))),
      r: Math.max(0, Math.min(screenW, Math.ceil(Number(rect.right || 0) * ratio))),
      b: Math.max(0, Math.min(screenH, Math.ceil(Number(rect.bottom || 0) * ratio)))
    }
  }

  function nativeStrokePoints(row, width, height) {
    return (row || []).slice(0, 10000).map(function (point, index) {
      return {
        x: Math.max(0, Math.min(1, Number(point[0]) / Math.max(1, width))),
        y: Math.max(0, Math.min(1, Number(point[1]) / Math.max(1, height))),
        pressure: Math.max(0, Math.min(1, Number(point[2]) || .5)),
        tiltX: 0, tiltY: 0, time: Date.now() + index
      }
    })
  }

  function nativeBridge() {
    // bridge.js publishes this explicit seam because its top-level `const Bridge` is not a window
    // property. Keep the lexical fallback for older shells and the preview/test root fallback.
    try { if (root.KalamosBridge) return root.KalamosBridge } catch (_) {}
    try { if (typeof Bridge !== 'undefined') return Bridge } catch (_) {}
    try { return root.Bridge || null } catch (_) { return null }
  }
  function graphPoint(point) {
    var left = .1, right = .94, top = .07, bottom = .9
    if (!point || point.x < left || point.x > right || point.y < top || point.y > bottom) return null
    return { x: (point.x - left) / (right - left), y: (bottom - point.y) / (bottom - top) }
  }

  function mount(container, definition, initialAttempt, optionsArg) {
    if (!Core) throw new Error('KalamosContent is required')
    if (root._kalamosContentPenOwner && root._kalamosContentPenOwner.destroy) root._kalamosContentPenOwner.destroy()
    var options = optionsArg || {}, clean = Core.validateDefinition(definition), attempt = initialAttempt ? Core.clone(initialAttempt) : Core.createAttempt(clean), ink = attempt.strokes || Core.createInk(clean.asset ? clean.asset.id : null), drawing = null, tool = 'pen', sceneIndex = 0, memoryPick = null, nativePen = null
    function emit(action, updateView) { attempt = Core.reduceAttempt(attempt, action); if (updateView) updateView(); if (options.onChange) options.onChange(Core.clone(attempt), action) }
    function draw() {
      if (nativePen) { nativePen.destroy(); nativePen = null }
      var guidance = clean.kind === 'evidence-board' ? 'Select each claim supported by the evidence. An item may support more than one claim.' : ['ordering', 'timeline', 'image-sequencing'].indexOf(clean.kind) >= 0 ? 'Use the up and down buttons to put the items in order.' : clean.instructions
      container.innerHTML = '<section class="kc-component" data-kind="' + escapeHtml(clean.kind) + '"><header><span class="kc-family">' + escapeHtml((Core.catalogue.find(function (m) { return m.kind === clean.kind }) || {}).family || 'Interaction') + '</span>' + (clean.title ? '<h3>' + escapeHtml(clean.title) + '</h3>' : '') + '<p>' + escapeHtml(clean.prompt) + '</p>' + (guidance ? '<small>' + escapeHtml(guidance) + '</small>' : '') + '</header><div class="kc-body">' + body(clean, attempt) + '</div><footer><output class="kc-result" aria-live="polite"></output>' + (options.showCheck === false ? '' : button('Check', 'check', '', false)) + '</footer></section>'
      bind(); setupAssets(); setupPen(); applyScene()
      if (options.onRender) options.onRender(container)
    }
    function bind() {
      container.querySelectorAll('[data-kc-action]').forEach(function (el) { el.onclick = function () { act(el.dataset.kcAction, el.dataset.kcValue) } })
      container.querySelectorAll('[data-kc-input]').forEach(function (el) { el.oninput = function () { var kind = el.dataset.kcInput, action = kind === 'number' || kind === 'range' ? { type: 'number', value: el.value } : { type: 'text', text: el.value }; emit(action); var out = container.querySelector('[data-kc-output]'); if (out) out.textContent = el.value } })
      container.querySelectorAll('[data-kc-cell]').forEach(function (el) { el.onchange = function () { var xy = el.dataset.kcCell.split(',').map(Number), cells = Core.clone(attempt.response.cells || []), size = clean.size || (clean.solution || []).length; while (cells.length < size) cells.push(Array(size).fill('')); cells[xy[1]][xy[0]] = /^\d+$/.test(el.value) ? Number(el.value) : el.value; emit({ type: 'cells', cells: cells }) } })
      container.querySelectorAll('[data-kc-map]').forEach(function (el) { el.onchange = function () { var map = Core.clone(attempt.response.mapping || {}); map[el.dataset.kcMap] = el.value; emit({ type: 'mapping', mapping: map }) } })
      container.querySelectorAll('[data-kc-allocation]').forEach(function (el) { el.onchange = function () { var map = Core.clone(attempt.response.mapping || {}); map[el.dataset.kcAllocation] = Number(el.value) || 0; emit({ type: 'mapping', mapping: map }) } })
      container.querySelectorAll('[data-kc-pair]').forEach(function (el) { el.onchange = function () { var rows = (attempt.response.pairs || []).filter(function (p) { return p.left !== el.dataset.kcPair }); if (el.value) rows.push({ left: el.dataset.kcPair, right: el.value }); emit({ type: 'pairs', pairs: rows }) } })
      container.querySelectorAll('[data-kc-evidence]').forEach(function (el) { el.onchange = function () { var left = el.dataset.kcEvidence, right = el.dataset.kcClaim, rows = (attempt.response.pairs || []).filter(function (pair) { return pair.left !== left || pair.right !== right }); if (el.checked) rows.push({ left: left, right: right }); emit({ type: 'pairs', pairs: rows }) } })
    }
    function syncSelection() {
      // Selection changes only button state in the current choice bodies. Match by value rather
      // than the clicked element: hosts may split passage options into repeated paginated legends.
      container.querySelectorAll('[data-kc-action="select"], [data-kc-action="toggle"]').forEach(function (el) {
        var selected = attempt.response.selected, active = el.dataset.kcAction === 'toggle' ? Array.isArray(selected) && selected.indexOf(el.dataset.kcValue) >= 0 : selected === el.dataset.kcValue
        el.classList.toggle('is-active', active)
        el.setAttribute('aria-pressed', String(active))
      })
    }
    function act(action, value) {
      if (action === 'select' || action === 'toggle') { emit({ type: action, id: value }, syncSelection) }
      else if (action === 'memory') { if (!memoryPick) memoryPick = value; else if (memoryPick !== value) { var pairs = (attempt.response.pairs || []).concat([{ left: memoryPick, right: value }]); memoryPick = null; emit({ type: 'pairs', pairs: pairs }); draw() } }
      else if (action === 'order-up' || action === 'order-down') { var rows = attempt.response.order && attempt.response.order.length ? attempt.response.order.slice() : initialOrder(clean), from = Number(value), to = action === 'order-up' ? from - 1 : from + 1; if (to >= 0 && to < rows.length) { var swap = rows[from]; rows[from] = rows[to]; rows[to] = swap; emit({ type: 'order', ids: rows }); draw() } }
      else if (action === 'tool') { tool = value; container.querySelectorAll('[data-kc-action="tool"]').forEach(function (el) { el.classList.toggle('is-active', el.dataset.kcValue === tool) }); if (nativePen) nativePen.setTool(tool) }
      else if (action === 'ink-undo' || action === 'ink-redo' || action === 'ink-clear') {
        var changeInk = function () { ink = Core.inkAction(ink, { type: action.replace('ink-', '') }); emit({ type: 'ink', ink: ink }); syncHotspotPoints(); renderInk(); if (nativePen) nativePen.redraw() }
        if (nativePen) nativePen.before(changeInk); else changeInk()
      }
      else if (action === 'reveal') { var reveal = container.querySelector('[data-kc-reveal]'); reveal.hidden = !reveal.hidden }
      else if (action === 'scene-prev') { sceneIndex = Math.max(0, sceneIndex - 1); applyScene() }
      else if (action === 'scene-next') { sceneIndex = Math.min((clean.steps || []).length, sceneIndex + 1); applyScene() }
      else if (action === 'move-actor') { moveActor(value); draw() }
      else if (action === 'check') { if (nativePen) nativePen.before(function () { syncHotspotPoints(); check() }); else { syncHotspotPoints(); check() } }
    }
    function moveActor(value) {
      var delta = value.split(',').map(Number), actor = (clean.actors || []).find(function (item) { return item.controllable !== false }); if (!actor) return
      var positions = Core.clone(attempt.response.cells || {}), current = positions[actor.id] || { x: actor.x, y: actor.y }, x = current.x + delta[0], y = current.y + delta[1], grid = clean.grid || []
      if (y < 0 || y >= grid.length || x < 0 || x >= (grid[y] || []).length || grid[y][x] === '#') return
      var turns = Number(positions._turns || 0); if (turns >= clean.turnLimit) return
      positions[actor.id] = { x: x, y: y }; positions._turns = turns + 1; emit({ type: 'cells', cells: positions })
    }
    function syncHotspotPoints() {
      if (clean.kind !== 'hotspot' && clean.kind !== 'multi-hotspot' && clean.kind !== 'graph-plotting' && clean.kind !== 'trace-path') return
      var canvas = container.querySelector('.kc-canvas'), points = []
      if (clean.kind === 'trace-path') {
        ;(ink.strokes || []).forEach(function (stroke) { if (stroke.color === '#ffffff') return; (stroke.points || []).forEach(function (source) { var point = assetPoint(canvas, source); if (point) points.push({ x: point.x, y: point.y, regionId: '' }) }) })
        if (points.length > 500) { var stride = Math.ceil(points.length / 500); points = points.filter(function (_point, index) { return index % stride === 0 || index === points.length - 1 }) }
        emit({ type: 'points', points: points }); return
      }
      ;(ink.strokes || []).forEach(function (stroke) { if (stroke.color === '#ffffff' || !stroke.points.length) return; var source = stroke.points[stroke.points.length - 1], point = clean.kind === 'graph-plotting' ? graphPoint(source) : assetPoint(canvas, source); if (point) points.push({ x: point.x, y: point.y, regionId: clean.kind === 'graph-plotting' ? '' : regionAt(clean, point) }) })
      ;(ink.shapes || []).forEach(function (shape) { var point = shape.shape === 'arrow' && shape.points ? shape.points[shape.points.length - 1] : { x: Number(shape.x || 0) + Number(shape.width || 0) / 2, y: Number(shape.y || 0) + Number(shape.height || 0) / 2 }, translated = clean.kind === 'graph-plotting' ? graphPoint(point) : assetPoint(canvas, point); if (translated) points.push({ x: translated.x, y: translated.y, regionId: clean.kind === 'graph-plotting' ? '' : regionAt(clean, translated) }) })
      emit({ type: 'points', points: points.slice(-100) })
    }
    function check() {
      if (clean.kind === 'progressive-case' && !attempt.response.complete) { advanceProgressiveCase(); return }
      reportScore()
    }
    function advanceProgressiveCase() {
      var index = Number(attempt.response.stage || 0), stages = clean.stages || [], stage = stages[index] || {}, selected = attempt.response.selected || '', text = attempt.response.text || '', out = container.querySelector('.kc-result')
      if ((stage.options || []).length && !selected) { out.textContent = 'Choose a response first'; return }
      if (!(stage.options || []).length && !String(text).trim()) { out.textContent = 'Add a response first'; return }
      var correct = stage.answer ? selected === stage.answer : null, complete = index >= stages.length - 1
      emit({ type: 'progress-stage', stage: index, selected: selected, text: text, correct: correct, nextStage: complete ? index : index + 1, complete: complete })
      draw()
      if (complete) reportScore()
    }
    function reportScore() {
      var scored = Core.scoreAttempt(clean, attempt), out = container.querySelector('.kc-result')
      if (clean.kind === 'visual-reconstruction' && !(ink.strokes || []).length) { out.textContent = 'Draw on the picture with your pen before checking it.'; return }
      if (clean.kind === 'visual-reconstruction' && clean.asset && !container.querySelector('.kc-canvas')._kcBackgroundImage) { out.textContent = 'Picture still loading. Check again in a moment.'; return }
      attempt.deterministicScore = scored.score
      if (!scored.requiresAiReview) {
        var detail = clean.feedback && (scored.correct ? clean.feedback.correct : clean.feedback.incorrect)
        if (!detail && !clean.explanation && !clean.rubric && ['ordering', 'timeline', 'image-sequencing'].indexOf(clean.kind) >= 0) {
          var itemById = {}; (clean.items || []).forEach(function (item) { itemById[item.id] = item.label })
          detail = 'Source order: ' + (clean.answer || []).map(function (id) { return itemById[id] || id }).join(' → ') + '.'
        }
        scored.feedback = String(detail || clean.explanation || clean.rubric || '').trim().slice(0, 2000)
        out.textContent = (scored.correct ? 'Correct' : ('Score: ' + scored.score + ' / ' + scored.maxScore)) + (scored.feedback ? ' — ' + scored.feedback : '')
        if (options.onCheck) options.onCheck(Core.clone(attempt), scored)
      }
      else if (options.onReview) {
        if ((attempt.reviewHistory || []).filter(function (row) { return row.status === 'provisional' }).length >= 2) { out.textContent = 'Two review passes have already been used'; return }
        out.textContent = 'Preparing provisional review…'
        Promise.resolve(options.onReview({ definition: clean, attempt: Core.clone(attempt), originalRaster: rasterizeBase(), raster: rasterize() })).then(function (review) {
          if (!review) { out.textContent = 'Review unavailable'; return }
          emit({ type: 'ai-review', review: review }); out.textContent = 'Provisional: ' + review.score + ' / ' + review.maxScore + ' — ' + review.feedback; reviewControls(out, review)
        }).catch(function (error) { out.textContent = 'Review unavailable: ' + error.message })
      }
      else { out.textContent = 'Saved for formative review'; if (options.onCheck) options.onCheck(Core.clone(attempt), scored) }
    }
    function reviewControls(out, review) {
      var controls = document.createElement('span'); controls.className = 'kc-review-controls'
      controls.innerHTML = button('Accept', 'accept-ai', '', false) + ((attempt.reviewHistory || []).length < 2 ? button('Second pass', 'second-ai', '', false) : '') + button('Override', 'override-ai', '', false)
      out.parentElement.insertBefore(controls, out.nextSibling)
      controls.querySelector('[data-kc-action="accept-ai"]').onclick = function () { emit({ type: 'accept-review' }); controls.remove(); if (options.onCheck) options.onCheck(Core.clone(attempt), { kind: 'ai', score: review.score, maxScore: review.maxScore, correct: null, feedback: review.feedback, provisional: false }) }
      var second = controls.querySelector('[data-kc-action="second-ai"]'); if (second) second.onclick = function () { controls.remove(); check() }
      controls.querySelector('[data-kc-action="override-ai"]').onclick = function () { var value = root.prompt ? root.prompt('Override score (0–' + review.maxScore + ')', review.score) : null; if (value == null) return; var score = Number(value); if (!isFinite(score) || score < 0 || score > review.maxScore) return; emit({ type: 'override-review', score: score, reason: 'Learner override after inspecting provisional feedback' }); controls.remove(); if (options.onCheck) options.onCheck(Core.clone(attempt), { kind: 'ai', score: score, maxScore: review.maxScore, correct: null, provisional: false }) }
    }
    function setupAssets() {
      var el = container.querySelector('[data-kc-asset]'), canvas = container.querySelector('.kc-canvas'); if (!el || !options.resolveAsset) return
      var url = options.resolveAsset(clean.asset); if (!url) return
      el.style.backgroundImage = 'url("' + String(url).replace(/["\\]/g, '') + '")'
      if (canvas && (/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/i.test(String(url)) || /^blob:/i.test(String(url)) || /^https:\/\/kalamos\.content\/nbasset\//i.test(String(url)))) { var image = new root.Image(); image.onload = function () { canvas._kcBackgroundImage = image; syncHotspotPoints(); renderInk() }; image.src = url }
    }
    function setupPen() {
      var canvas = container.querySelector('.kc-canvas'); if (!canvas) return
      var wrap = canvas.parentElement, ratio = root.devicePixelRatio || 1, rect = wrap.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width || 600)), height = Math.max(1, Math.round(rect.height || 360)); canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; canvas.getContext('2d').scale(ratio, ratio)
      function point(e) { var box = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)), pressure: e.pressure || 0.5, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0, time: Math.round(e.timeStamp || Date.now()) } }
      if (options.readOnly) { renderInk(); return }
      canvas.onpointerdown = function (e) { if (e.pointerType === 'touch') return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = { start: point(e), points: [point(e)] } }
      canvas.onpointermove = function (e) { if (!drawing || !canvas.hasPointerCapture(e.pointerId)) return; e.preventDefault(); var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; events.forEach(function (event) { drawing.points.push(point(event)) }); renderInk(drawing) }
      canvas.onpointerup = function (e) { if (!drawing) return; e.preventDefault(); var end = point(e); drawing.points.push(end); if (tool === 'eraser') ink = Core.inkAction(ink, { type: 'erase', points: drawing.points, radius: .035 }); else if (['circle', 'rectangle', 'triangle', 'arrow'].indexOf(tool) >= 0) { var x = Math.min(drawing.start.x, end.x), y = Math.min(drawing.start.y, end.y), width = Math.abs(end.x - drawing.start.x), height = Math.abs(end.y - drawing.start.y); ink = Core.inkAction(ink, { type: 'shape', shape: { id: 'shape-' + Date.now(), label: tool, shape: tool, x: x, y: y, width: width, height: height, points: tool === 'triangle' ? [{ x: x + width / 2, y: y }, { x: x, y: y + height }, { x: x + width, y: y + height }] : tool === 'arrow' ? [drawing.start, end] : undefined } }) } else ink = Core.inkAction(ink, { type: 'stroke', tool: tool === 'felt' ? 'felt' : 'pen', width: tool === 'felt' ? 4 : 2, color: '#111111', points: drawing.points }); drawing = null; emit({ type: 'ink', ink: ink }); syncHotspotPoints(); renderInk() }
      canvas.onpointercancel = function () { drawing = null; renderInk() }; renderInk()
      nativePen = createNativePen(canvas, width, height)
    }
    function renderInk(active) {
      var canvas = container.querySelector('.kc-canvas'); if (!canvas) return; var ctx = canvas.getContext('2d'), w = canvas.clientWidth, h = canvas.clientHeight; ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      renderGuide(ctx, canvas, w, h)
      ;(ink.strokes || []).concat(active && tool !== 'eraser' ? [{ color: '#111111', width: tool === 'felt' ? 4 : 2, points: active.points }] : []).forEach(function (stroke) { if (!stroke.points.length) return; ctx.beginPath(); stroke.points.forEach(function (p, i) { if (i) ctx.lineTo(p.x * w, p.y * h); else ctx.moveTo(p.x * w, p.y * h) }); ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.globalCompositeOperation = stroke.color === '#ffffff' ? 'destination-out' : 'source-over'; ctx.stroke() }); ctx.globalCompositeOperation = 'source-over'
      ;(ink.shapes || []).forEach(function (shape) { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); if (shape.shape === 'circle') ctx.ellipse((shape.x + shape.width / 2) * w, (shape.y + shape.height / 2) * h, shape.width * w / 2, shape.height * h / 2, 0, 0, Math.PI * 2); else if (shape.shape === 'triangle') { shape.points.forEach(function (p, i) { if (i) ctx.lineTo(p.x * w, p.y * h); else ctx.moveTo(p.x * w, p.y * h) }); ctx.closePath() } else if (shape.shape === 'arrow') { var a = shape.points[0], b = shape.points[1], angle = Math.atan2((b.y - a.y) * h, (b.x - a.x) * w); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.lineTo(b.x * w - 12 * Math.cos(angle - .5), b.y * h - 12 * Math.sin(angle - .5)); ctx.moveTo(b.x * w, b.y * h); ctx.lineTo(b.x * w - 12 * Math.cos(angle + .5), b.y * h - 12 * Math.sin(angle + .5)) } else ctx.rect(shape.x * w, shape.y * h, shape.width * w, shape.height * h); ctx.stroke() })
    }
    function renderGuide(ctx, canvas, w, h) {
      if (clean.kind === 'trace-path' && (clean.path || []).length > 1) {
        ctx.save(); ctx.beginPath(); (clean.path || []).forEach(function (source, index) { var point = canvasPoint(canvas, source); if (index) ctx.lineTo(point.x * w, point.y * h); else ctx.moveTo(point.x * w, point.y * h) }); ctx.strokeStyle = '#777777'; ctx.lineWidth = 3; ctx.setLineDash([7, 7]); ctx.stroke(); ctx.restore()
      }
      if (clean.kind === 'graph-plotting') {
        var axes = clean.axes || {}, left = .1 * w, right = .94 * w, top = .07 * h, bottom = .9 * h
        ctx.save(); ctx.strokeStyle = '#bbbbbb'; ctx.lineWidth = 1
        if (axes.grid !== false) for (var step = 1; step < 10; step += 1) { var gx = left + (right - left) * step / 10, gy = top + (bottom - top) * step / 10; ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, bottom); ctx.moveTo(left, gy); ctx.lineTo(right, gy); ctx.stroke() }
        ctx.strokeStyle = '#111111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke(); ctx.fillStyle = '#111111'; ctx.font = '12px sans-serif'
        if (axes.xLabel) ctx.fillText(String(axes.xLabel), Math.max(left, right - ctx.measureText(String(axes.xLabel)).width), Math.min(h - 3, bottom + 22))
        if (axes.yLabel) { ctx.save(); ctx.translate(Math.max(12, left - 24), top); ctx.rotate(-Math.PI / 2); ctx.fillText(String(axes.yLabel), 0, 0); ctx.restore() }
        if (axes.xMin != null) ctx.fillText(String(axes.xMin), left, Math.min(h - 3, bottom + 15)); if (axes.xMax != null) ctx.fillText(String(axes.xMax), right - ctx.measureText(String(axes.xMax)).width, Math.min(h - 3, bottom + 15))
        if (axes.yMin != null) ctx.fillText(String(axes.yMin), Math.max(1, left - ctx.measureText(String(axes.yMin)).width - 4), bottom); if (axes.yMax != null) ctx.fillText(String(axes.yMax), Math.max(1, left - ctx.measureText(String(axes.yMax)).width - 4), top + 10)
        ctx.restore()
      }
    }
    function reviewRaster(includeInk) {
      var canvas = container.querySelector('.kc-canvas'); if (!canvas) return ''
      if (includeInk) renderInk()
      var image = canvas._kcBackgroundImage
      if (clean.asset && !image) return ''
      var composite = document.createElement('canvas'); composite.width = canvas.width; composite.height = canvas.height; var ctx = composite.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, composite.width, composite.height)
      if (image) { var scale = Math.min(composite.width / image.naturalWidth, composite.height / image.naturalHeight), width = image.naturalWidth * scale, height = image.naturalHeight * scale; ctx.drawImage(image, (composite.width - width) / 2, (composite.height - height) / 2, width, height) }
      if (includeInk) ctx.drawImage(canvas, 0, 0)
      return composite.toDataURL('image/png')
    }
    function rasterize() { return reviewRaster(true) }
    function rasterizeBase() { return reviewRaster(false) }
    function createNativePen(canvas, width, height) {
      var bridge = nativeBridge(), available = false
      try { available = !!(bridge && bridge.attachInkBox && bridge.flushInk && bridge.supportsPersistentDisplayHandoff && bridge.supportsPersistentDisplayHandoff()) } catch (_) {}
      if (!available) return null
      var dpr = root.devicePixelRatio || 1, bounds = nativeInkBounds(canvas.getBoundingClientRect(), dpr, root.innerWidth, root.innerHeight), attached = false, pending = [], flushing = false, destroying = false, attachTimer, revealTimer, attachAttempts = 0, nativeTool = tool
      function setNativeOwnership(active) {
        var wrap = canvas.parentElement
        if (wrap) wrap.classList.toggle('kc-native-ink-active', !!active)
      }
      var handler = {
        onNoteStrokes: function (rows) {
          ;(rows || []).forEach(function (row) {
            if (!row || !row.length) return
            var points = nativeStrokePoints(row, bounds.r - bounds.l, bounds.b - bounds.t)
            ink = nativeTool === 'eraser' ? Core.inkAction(ink, { type: 'erase', points: points, radius: .035 }) : Core.inkAction(ink, { type: 'stroke', tool: nativeTool === 'felt' ? 'felt' : 'pen', width: nativeTool === 'felt' ? 4 : 2, color: '#111111', points: points })
          })
          // The daemon already owns the visible pixels. Updating the hidden DOM canvas here can
          // overlap the next pen-down and add compositor latency on e-ink; repaint only at a
          // deliberate tool handoff or model operation.
          emit({ type: 'ink', ink: ink }); syncHotspotPoints()
        },
        renderNoteStrokes: function () {
          // Notes' proven ownership handoff: populate the native page, hide the duplicate web ink
          // canvas, then reveal the SurfaceView only after controller-ready. Completed vectors still
          // flow into the web model through onNoteStrokes; the WebView never paints the live stroke.
          redraw()
          if ((clean.asset || clean.kind === 'graph-plotting' || clean.kind === 'trace-path') && bridge.snapshotContent) {
            bridge.snapshotContent(bounds.l, bounds.t, bounds.r, bounds.b)
          }
          setNativeOwnership(true)
          root.clearTimeout(revealTimer)
          revealTimer = root.setTimeout(function () {
            if (attached && !destroying && bridge.showEditor) bridge.showEditor()
          }, 140)
        },
        onNativeFlushed: function () {
          flushing = false
          var callbacks = pending.splice(0); callbacks.forEach(function (callback) { callback() })
          if (attached && !destroying && !flushing) try { bridge.setInkEnabled(true) } catch (_) {}
        }
      }
      function attach() {
        if (destroying) return
        if (root._inkHandler && root._inkHandler !== handler) {
          // A previous component may still be committing its final daemon batch. Wait for its
          // flush/detach instead of stealing the one global native ink handler.
          if (attachAttempts++ < 15) attachTimer = root.setTimeout(attach, 80)
          return
        }
        try {
          bounds = nativeInkBounds(canvas.getBoundingClientRect(), dpr, root.innerWidth, root.innerHeight)
          if (bounds.r <= bounds.l || bounds.b <= bounds.t) return
          root._noteSketch = { w: bounds.r - bounds.l, h: bounds.b - bounds.t }; root._inkHandler = handler
          // Keep this identical to the proven KOReader-style sticky-note lifecycle: suppress the
          // redundant wake, attach the already-bounded SurfaceView, then set style. The box itself
          // is the input boundary, so extra writing bounds, panel-mode changes, snapshots, or an
          // early enable race only add work without improving isolation.
          if (bridge.setInteractivePanel) bridge.setInteractivePanel(false)
          bridge.setInkEnabled(true)
          bridge.skipWakeRefresh(); bridge.attachInkBox(bounds.l, bounds.t, bounds.r, bounds.b)
          applyNativeTool(); attached = true
        } catch (_) { attached = false }
      }
      function applyNativeTool() {
        if (bridge.setErasing) bridge.setErasing(nativeTool === 'eraser')
        if (bridge.setPenType) bridge.setPenType(nativeTool === 'felt' ? 'felt' : 'ballpoint')
        bridge.setInkStyle(Math.max(2, Math.round((nativeTool === 'felt' ? 4 : 2) * dpr)), '#111111')
      }
      function detach(forWeb) {
        root.clearTimeout(attachTimer); root.clearTimeout(revealTimer); setNativeOwnership(false)
        if (forWeb) renderInk()
        if (attached) try { bridge.setInkEnabled(false); bridge.setWritingBounds(0, 0, 0, 0); if (forWeb && bridge.detachInkBoxForWeb) bridge.detachInkBoxForWeb(); else if (bridge.detachInkBoxCleared) bridge.detachInkBoxCleared(); else bridge.detachInkBox() } catch (_) {}
        attached = false; if (root._inkHandler === handler) root._inkHandler = null; root._noteSketch = null
        try { if (bridge.setInteractivePanel) bridge.setInteractivePanel(!!forWeb); if (forWeb && bridge.showWebWorkspace) bridge.showWebWorkspace() } catch (_) {}
      }
      function redraw() {
        if (!attached) return
        var payload = { t: 'blank', sp: 0, mg: 0, dpr: dpr, b: [0, 0, bounds.r - bounds.l, bounds.b - bounds.t], s: (ink.strokes || []).map(function (stroke) { return { w: Math.max(2, Math.round(stroke.width * dpr)), c: stroke.color, p: stroke.points.map(function (p) { return [Math.round(p.x * (bounds.r - bounds.l)), Math.round(p.y * (bounds.b - bounds.t))] }) } }) }
        try { bridge.renderInk(JSON.stringify(payload)) } catch (_) {}
      }
      attachTimer = root.setTimeout(attach, 220)
      return { before: function (callback) {
          if (!attached) { callback(); return }
          pending.push(callback); if (flushing) return
          flushing = true
          try { bridge.setInkEnabled(false); bridge.flushInk() } catch (_) { flushing = false; var callbacks = pending.splice(0); callbacks.forEach(function (next) { next() }) }
        }, redraw: redraw,
        setTool: function (nextTool) {
          if (['circle', 'rectangle', 'triangle', 'arrow'].indexOf(nextTool) >= 0) {
            this.before(function () { nativeTool = nextTool; detach(true) }); return
          }
          if (!attached) { nativeTool = nextTool; try { if (bridge.setInteractivePanel) bridge.setInteractivePanel(false) } catch (_) {}; attachTimer = root.setTimeout(attach, 80); return }
          this.before(function () { nativeTool = nextTool; try { applyNativeTool() } catch (_) {} })
        },
        destroy: function () { if (destroying) return; destroying = true; this.before(function () { detach(false) }) } }
    }
    function applyScene() { var svg = container.querySelector('.kc-scene'); if (!svg) return; svg.querySelectorAll('[data-object]').forEach(function (el) { el.removeAttribute('transform'); el.style.display = '' }); (clean.steps || []).slice(0, sceneIndex).forEach(function (step) { (step.commands || []).forEach(function (command) { var el = svg.querySelector('[data-object="' + command.target + '"]'); if (!el) return; if (command.action === 'hide') el.style.display = 'none'; if (command.action === 'show') el.style.display = ''; if (command.action === 'opacity') el.setAttribute('opacity', command.value); if (command.action === 'move') el.setAttribute('transform', 'translate(' + Number(command.x || 0) + ' ' + Number(command.y || 0) + ')') }) }) }
    draw()
    var controller = { getAttempt: function () { return Core.clone(attempt) }, syncSelection: syncSelection, rasterize: rasterize, rasterizeBase: rasterizeBase,
      before: function (callback) { if (nativePen) nativePen.before(callback); else callback() },
      destroy: function () { if (nativePen) nativePen.destroy(); nativePen = null; container.innerHTML = ''; if (root._kalamosContentPenOwner === controller) root._kalamosContentPenOwner = null } }
    root._kalamosContentPenOwner = controller
    return controller
  }

  return { mount: mount, escapeHtml: escapeHtml, graphPoint: graphPoint, nativeInkBounds: nativeInkBounds, nativeStrokePoints: nativeStrokePoints }
})
