// Closed, device-neutral contracts for locally compiled study workbooks.
//
// Providers may supply only the data accepted here. Trusted navigation targets, renderer names,
// persistence IDs and source assets are resolved locally during validation/compilation.
(function(root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.WorkbookContracts = api
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict'

  var UNSAFE = /<\/?[a-z][^>]*>|<\s*\/?\s*(?:script|svg|img|iframe|object|style|link|meta)\b|(?:^|[^a-z0-9_])(?:javascript|data|file|https?):\s*(?:\/\/|[^\s]*)|\bon[a-z]+\s*=|&(?:#(?:x[0-9a-f]+|\d+)|colon|lt|gt);/i
  var VALIDATED = new WeakSet()
  var KINDS = [
    'single-choice', 'multi-select', 'true-false-cant-tell', 'cloze', 'short-answer',
    'reveal-card', 'numeric-answer', 'estimate-slider', 'ordering', 'timeline',
    'matching-pairs', 'categorisation', 'graph-plotting', 'hotspot', 'diagram-labelling',
    'sketch-annotate', 'interactive-scene', 'logic-grid', 'cipher-code', 'progressive-case'
  ]
  var SHARED_SET_KINDS = [
    'single-choice', 'multi-select', 'true-false-cant-tell', 'numeric-answer', 'short-answer',
    'ordering', 'categorisation'
  ]
  var CAPABILITIES = {
    'single-choice': ['touch', 'exam'],
    'multi-select': ['touch', 'exam'],
    'true-false-cant-tell': ['touch', 'exam'],
    cloze: ['touch', 'exam'],
    'short-answer': ['touch', 'exam'],
    'reveal-card': ['touch'],
    'numeric-answer': ['touch', 'exam'],
    'estimate-slider': ['touch', 'exam'],
    ordering: ['touch', 'exam'],
    timeline: ['touch', 'exam'],
    'matching-pairs': ['touch', 'exam'],
    categorisation: ['touch', 'exam'],
    'graph-plotting': ['touch', 'pen', 'hybrid', 'exam'],
    hotspot: ['touch', 'image', 'exam'],
    'diagram-labelling': ['touch', 'image', 'exam'],
    'sketch-annotate': ['pen', 'hybrid', 'image'],
    'interactive-scene': ['touch', 'image'],
    'logic-grid': ['touch', 'exam'],
    'cipher-code': ['touch', 'exam'],
    'progressive-case': ['touch', 'image', 'timed', 'exam']
  }
  var RESPONSE_SHAPES = {
    'single-choice': '{selectedIndex:number}',
    'multi-select': '{selectedIndices:number[]}',
    'true-false-cant-tell': '{answer:"true"|"false"|"cant-tell"}',
    cloze: '{answers:{[blankId]:string}}',
    'short-answer': '{answer:string}',
    'reveal-card': '{mastered?:boolean}',
    'numeric-answer': '{value:number}',
    'estimate-slider': '{value:number}',
    ordering: '{order:number[]}',
    timeline: '{order:number[]}',
    'matching-pairs': '{matches:number[]}',
    categorisation: '{assignments:number[]}',
    'graph-plotting': '{points:{x:number,y:number}[]}',
    hotspot: '{point:{x:number,y:number}}',
    'diagram-labelling': '{placements:{x:number,y:number}[]}',
    'sketch-annotate': '{strokes:object[]}',
    'interactive-scene': '{step:number}',
    'logic-grid': '{grid:("yes"|"no")[][]}',
    'cipher-code': '{answer:string}',
    'progressive-case': '{answers:{[stageIndex]:string}} for staged cases OR {answers:{[questionId]:<the child interaction response>},contextExpanded?:boolean} for shared passage/data sets'
  }
  // Provider-facing payload grammar. This is intentionally separate from RESPONSE_SHAPES:
  // payloads define immutable activities, while response shapes describe mutable learner state.
  var PAYLOAD_SHAPES = {
    'single-choice': '{choices:string[2..6],correctIndex:integer}',
    'multi-select': '{choices:string[3..8],correctIndices:unique integer[]}',
    'true-false-cant-tell': '{answer:"true"|"false"|"cant-tell"}',
    cloze: '{blanks:[{id:string,acceptedAnswers:unique string[1..12],revealOnly:boolean}]}',
    'short-answer': '{acceptedAnswers:unique string[0..12],caseSensitive:boolean}',
    'reveal-card': '{back:string}',
    'numeric-answer': '{answer:number,tolerance:number>=0,unit:string,precision?:integer 0..8} OR {min:number,max:number,unit:string,precision?:integer 0..8}; omit precision when unspecified; never combine answer with min/max',
    'estimate-slider': '{min:number,max:number,step:number>0,acceptedMin:number,acceptedMax:number,unit:string}',
    ordering: '{items:string[3..8],correctOrder:integer[] permutation of item indices}',
    timeline: '{events:[{label:string,date:string}],correctOrder:integer[] permutation of event indices}',
    'matching-pairs': '{pairs:[{left:string,right:string}]}',
    categorisation: '{categories:string[2..5],items:[{text:string,categoryIndex:integer}]}',
    'graph-plotting': '{mode:"points"|"polyline"|"freehand",xAxis:{label:string,min:number,max:number,step?:number},yAxis:{label:string,min:number,max:number,step?:number},expectedPoints:[{x:number,y:number}],tolerance:number>=0}',
    hotspot: '{acceptedRegions:[{shape:"rect",x:0..1,y:0..1,width:0..1,height:0..1}|{shape:"circle",x:0..1,y:0..1,radius:0..0.5}]}',
    'diagram-labelling': '{labels:[{text:string,region:<hotspot region>}]}',
    'sketch-annotate': '{backgroundFigureRef:string,rubricPoints:string[1..10]}',
    'interactive-scene': '{canvas:{width:integer,height:integer,theme:"monochrome"|"colour-enhanced"},backgroundFigureRef:string,layers:<bounded declarative layers>,steps:<finite declarative steps>,controls:("next"|"previous"|"play"|"reset")[],fallbackStep:integer}',
    'logic-grid': '{rows:string[2..6],columns:string[2..6],clues:string[1..20],solution:("yes"|"no")[][] with exactly one yes per row and column}',
    'cipher-code': '{cipherType:"caesar"|"substitution"|"symbol"|"sequencing",encoded:string,decodedAnswer:string,shift?:integer,mapping?:[{from:string,to:string}]}',
    'progressive-case': 'Either a staged case: {presentation:"passage"|"data-set"|"clinical-case",stages:[{title:string,content:string,figureRef?:trusted figure ID,clues?:string[],prompt:string,acceptedAnswers:string[],rubric:string}],timedSeconds?:integer}; OR a locally scored shared set: {presentation:"passage"|"data-set"|"clinical-case",context:{title?:string,content?:string,table?:<table>,figureRef?:trusted figure ID,stages?:[{id:string,title:string,content?:string,table?:<table>,figureRef?:trusted figure ID}]},questions:[{id:string,kind:<supported child kind>,afterStage?:trusted stage ID,figureRef?:trusted figure ID,prompt:string,payload:<that kind payload>,explanation?:string}],timedSeconds?:integer}. Staged context reveals clinical information in order; do not repeat context inside child prompts.'
  }

  function fail(message) { throw new Error(message) }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  function own(value, key) {
    return isObject(value) && Object.prototype.hasOwnProperty.call(value, key)
  }

  function cloneData(value) {
    if (value === undefined || value === null) return null
    return JSON.parse(JSON.stringify(value))
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
    Object.freeze(value)
    Object.keys(value).forEach(function(key) { deepFreeze(value[key]) })
    return value
  }

  function exactKeys(value, allowed, at) {
    if (!isObject(value)) fail(at + ' must be an object')
    Object.keys(value).forEach(function(key) {
      if (allowed.indexOf(key) === -1) fail(at + ' contains unsupported field "' + key + '"')
    })
  }

  function text(value, at, max, optional) {
    if (optional && (value === undefined || value === null || value === '')) return null
    if (typeof value !== 'string') fail(at + ' must be text')
    var out = value.replace(/\s+/g, ' ').trim()
    if (!out) fail(at + ' cannot be empty')
    if (out.length > max) fail(at + ' is too long')
    if (UNSAFE.test(out)) fail(at + ' contains markup, executable content, or a URL')
    return out
  }

  function codeText(value, at, optional) {
    if (optional && (value === undefined || value === null || value === '')) return null
    if (typeof value !== 'string') fail(at + ' must be text')
    var out = value.replace(/\r\n?/g, '\n').trim()
    if (!out) fail(at + ' cannot be empty')
    if (out.length > 4000) fail(at + ' is too long')
    if (UNSAFE.test(out)) fail(at + ' contains markup, executable content, or a URL')
    return out
  }

  function proseText(value, at, max) {
    if (typeof value !== 'string') fail(at + ' must be text')
    var out = value.replace(/\r\n?/g, '\n').split('\n').map(function(line) {
      return line.replace(/[\t ]+/g, ' ').trim()
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!out) fail(at + ' cannot be empty')
    if (out.length > max) fail(at + ' is too long')
    if (UNSAFE.test(out)) fail(at + ' contains markup, executable content, or a URL')
    return out
  }

  function number(value, at, min, max, integer, optional) {
    if (optional && value === undefined) return null
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(at + ' must be a finite number')
    if (integer && !Number.isInteger(value)) fail(at + ' must be an integer')
    if (value < min || value > max) fail(at + ' is outside the allowed range')
    return value
  }

  function boolean(value, at, optional, fallback) {
    if (optional && value === undefined) return fallback
    if (typeof value !== 'boolean') fail(at + ' must be true or false')
    return value
  }

  function array(value, at, min, max) {
    if (!Array.isArray(value)) fail(at + ' must be an array')
    if (value.length < min || value.length > max) fail(at + ' must contain ' + min + ' to ' + max + ' items')
    return value
  }

  function enumValue(value, allowed, at) {
    if (allowed.indexOf(value) === -1) fail(at + ' must be one of: ' + allowed.join(', '))
    return value
  }

  function uniqueStrings(values, at, min, max, itemMax) {
    var seen = Object.create(null)
    return array(values, at, min, max).map(function(value, index) {
      var out = text(value, at + ' item ' + (index + 1), itemMax)
      var key = out.toLocaleLowerCase()
      if (seen[key]) fail(at + ' contains duplicate items')
      seen[key] = true
      return out
    })
  }

  function indices(values, at, min, max, upper) {
    var seen = Object.create(null)
    return array(values, at, min, max).map(function(value, index) {
      var out = number(value, at + ' item ' + (index + 1), 0, upper - 1, true)
      if (seen[out]) fail(at + ' contains duplicate indices')
      seen[out] = true
      return out
    })
  }

  function recordMap(rows, field) {
    var map = Object.create(null)
    ;(rows || []).forEach(function(row) {
      if (row && typeof row.id === 'string' && !map[row.id]) map[row.id] = row
    })
    return map
  }

  function safeTarget(row) {
    return row && row.target !== undefined ? cloneData(row.target) : null
  }

  function resolveReferences(activity, source, at) {
    var segmentMap = recordMap(source && source.segments)
    var figureMap = recordMap(source && source.figures)
    var evidenceRefs = uniqueStrings(activity.evidenceRefs, at + ' evidenceRefs', 1, 64, 120)
    var figureRefs = activity.figureRefs === undefined
      ? [] : uniqueStrings(activity.figureRefs, at + ' figureRefs', 0, 64, 120)
    var evidence = evidenceRefs.map(function(id) {
      var row = segmentMap[id]
      if (!row) fail(at + ' cites unknown evidence "' + id + '"')
      return { id: id, label: text(row.label || id, at + ' evidence label', 240), target: safeTarget(row) }
    })
    var figures = figureRefs.map(function(id) {
      var row = figureMap[id]
      if (!row) fail(at + ' cites unknown figure "' + id + '"')
      return {
        id: id,
        caption: row.caption ? text(row.caption, at + ' figure caption', 600) : null,
        altText: row.altText ? text(row.altText, at + ' figure alt text', 600) : null,
        target: safeTarget(row),
        crop: cloneData(row.crop),
        contentHash: typeof row.contentHash === 'string' ? row.contentHash : null,
        previewHandle: typeof row.previewHandle === 'string' ? row.previewHandle : null
      }
    })
    return { evidenceRefs: evidenceRefs, figureRefs: figureRefs, evidence: evidence, figures: figures }
  }

  function region(value, at) {
    exactKeys(value, ['shape', 'x', 'y', 'width', 'height', 'radius'], at)
    var shape = enumValue(value.shape, ['rect', 'circle'], at + ' shape')
    var out = {
      shape: shape,
      x: number(value.x, at + ' x', 0, 1),
      y: number(value.y, at + ' y', 0, 1)
    }
    if (shape === 'rect') {
      out.width = number(value.width, at + ' width', 0.001, 1)
      out.height = number(value.height, at + ' height', 0.001, 1)
      if (out.x + out.width > 1.000001 || out.y + out.height > 1.000001) fail(at + ' rectangle leaves the normalized canvas')
      if (value.radius !== undefined) fail(at + ' circle radius is not valid for a rectangle')
    } else {
      out.radius = number(value.radius, at + ' radius', 0.001, 0.5)
      if (out.x - out.radius < 0 || out.y - out.radius < 0 || out.x + out.radius > 1 || out.y + out.radius > 1)
        fail(at + ' circle leaves the normalized canvas')
      if (value.width !== undefined || value.height !== undefined) fail(at + ' rectangle dimensions are not valid for a circle')
    }
    return out
  }

  function axis(value, at) {
    exactKeys(value, ['label', 'min', 'max', 'step'], at)
    var min = number(value.min, at + ' min', -1000000, 1000000)
    var max = number(value.max, at + ' max', -1000000, 1000000)
    if (max <= min) fail(at + ' max must be greater than min')
    var out = { label: text(value.label, at + ' label', 80, true), min: min, max: max }
    if (value.step !== undefined) out.step = number(value.step, at + ' step', 0.000001, max - min)
    return out
  }

  function visualPoint(value, at, xAxis, yAxis) {
    exactKeys(value, ['x', 'y', 'label'], at)
    return {
      x: number(value.x, at + ' x', xAxis ? xAxis.min : 0, xAxis ? xAxis.max : 1),
      y: number(value.y, at + ' y', yAxis ? yAxis.min : 0, yAxis ? yAxis.max : 1),
      label: text(value.label, at + ' label', 80, true)
    }
  }

  function stringAnswers(value, at, min) {
    return uniqueStrings(value, at, min, 12, 240)
  }

  function validatePayload(kind, value, refs, at) {
    var i
    if (kind === 'single-choice') {
      exactKeys(value, ['choices', 'correctIndex'], at)
      var choices = uniqueStrings(value.choices, at + ' choices', 2, 6, 300)
      return { choices: choices, correctIndex: number(value.correctIndex, at + ' correctIndex', 0, choices.length - 1, true) }
    }
    if (kind === 'multi-select') {
      exactKeys(value, ['choices', 'correctIndices'], at)
      var multiChoices = uniqueStrings(value.choices, at + ' choices', 3, 8, 300)
      return { choices: multiChoices, correctIndices: indices(value.correctIndices, at + ' correctIndices', 1, multiChoices.length, multiChoices.length) }
    }
    if (kind === 'true-false-cant-tell') {
      exactKeys(value, ['answer'], at)
      return { answer: enumValue(value.answer, ['true', 'false', 'cant-tell'], at + ' answer') }
    }
    if (kind === 'cloze') {
      exactKeys(value, ['blanks'], at)
      var blankIds = Object.create(null)
      return { blanks: array(value.blanks, at + ' blanks', 1, 10).map(function(blank, index) {
        var bat = at + ' blank ' + (index + 1)
        exactKeys(blank, ['id', 'acceptedAnswers', 'revealOnly'], bat)
        var id = text(blank.id, bat + ' id', 40)
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || blankIds[id]) fail(bat + ' id must be unique and identifier-safe')
        blankIds[id] = true
        return { id: id, acceptedAnswers: stringAnswers(blank.acceptedAnswers, bat + ' acceptedAnswers', 1), revealOnly: boolean(blank.revealOnly, bat + ' revealOnly', true, false) }
      }) }
    }
    if (kind === 'short-answer') {
      exactKeys(value, ['acceptedAnswers', 'caseSensitive'], at)
      return { acceptedAnswers: stringAnswers(value.acceptedAnswers, at + ' acceptedAnswers', 0), caseSensitive: boolean(value.caseSensitive, at + ' caseSensitive', true, false) }
    }
    if (kind === 'reveal-card') {
      exactKeys(value, ['back', 'answerFlow'], at)
      var reveal = { back: text(value.back, at + ' back', 2400) }
      if (value.answerFlow !== undefined) reveal.answerFlow = array(value.answerFlow, at + ' answerFlow', 1, 128)
        .map(function(item, index) {
          var iat = at + ' answerFlow item ' + (index + 1)
          if (!item || typeof item !== 'object' || Array.isArray(item)) fail(iat + ' must be an object')
          if (item.kind === 'text') {
            exactKeys(item, ['kind', 'text'], iat)
            return { kind: 'text', text: text(item.text, iat + ' text', 2400) }
          }
          if (item.kind === 'figure') {
            exactKeys(item, ['kind', 'figureRef'], iat)
            var figureRef = text(item.figureRef, iat + ' figureRef', 120)
            if (refs.figureRefs.indexOf(figureRef) < 0) fail(iat + ' figureRef must be one of figureRefs')
            return { kind: 'figure', figureRef: figureRef }
          }
          fail(iat + ' kind must be text or figure')
        })
      return reveal
    }
    if (kind === 'numeric-answer') {
      exactKeys(value, ['answer', 'tolerance', 'min', 'max', 'unit', 'precision'], at)
      var hasAnswer = value.answer !== undefined
      var hasRange = value.min !== undefined || value.max !== undefined
      if (hasAnswer === hasRange) fail(at + ' must define either answer or min/max')
      var numeric = { unit: text(value.unit, at + ' unit', 30, true), precision: value.precision === undefined ? null : number(value.precision, at + ' precision', 0, 8, true) }
      if (hasAnswer) {
        numeric.answer = number(value.answer, at + ' answer', -1e12, 1e12)
        numeric.tolerance = value.tolerance === undefined ? 0 : number(value.tolerance, at + ' tolerance', 0, 1e12)
      } else {
        numeric.min = number(value.min, at + ' min', -1e12, 1e12)
        numeric.max = number(value.max, at + ' max', -1e12, 1e12)
        if (numeric.max < numeric.min) fail(at + ' max must be at least min')
        if (value.tolerance !== undefined) fail(at + ' tolerance is valid only with answer')
      }
      return numeric
    }
    if (kind === 'estimate-slider') {
      exactKeys(value, ['min', 'max', 'step', 'acceptedMin', 'acceptedMax', 'unit'], at)
      var slider = {
        min: number(value.min, at + ' min', -1e12, 1e12),
        max: number(value.max, at + ' max', -1e12, 1e12),
        step: number(value.step, at + ' step', 0.000001, 1e12),
        acceptedMin: number(value.acceptedMin, at + ' acceptedMin', -1e12, 1e12),
        acceptedMax: number(value.acceptedMax, at + ' acceptedMax', -1e12, 1e12),
        unit: text(value.unit, at + ' unit', 30, true)
      }
      if (slider.max <= slider.min || slider.acceptedMin < slider.min || slider.acceptedMax > slider.max || slider.acceptedMax < slider.acceptedMin)
        fail(at + ' contains inconsistent slider bounds')
      return slider
    }
    if (kind === 'ordering') {
      exactKeys(value, ['items', 'correctOrder'], at)
      var orderItems = uniqueStrings(value.items, at + ' items', 3, 8, 300)
      var correctOrder = indices(value.correctOrder, at + ' correctOrder', orderItems.length, orderItems.length, orderItems.length)
      return { items: orderItems, correctOrder: correctOrder }
    }
    if (kind === 'timeline') {
      exactKeys(value, ['events', 'correctOrder'], at)
      var events = array(value.events, at + ' events', 3, 10).map(function(event, index) {
        var eat = at + ' event ' + (index + 1)
        exactKeys(event, ['label', 'date'], eat)
        return { label: text(event.label, eat + ' label', 300), date: text(event.date, eat + ' date', 80, true) }
      })
      return { events: events, correctOrder: indices(value.correctOrder, at + ' correctOrder', events.length, events.length, events.length) }
    }
    if (kind === 'matching-pairs') {
      exactKeys(value, ['pairs'], at)
      var leftSeen = Object.create(null); var rightSeen = Object.create(null)
      return { pairs: array(value.pairs, at + ' pairs', 2, 8).map(function(pair, index) {
        var pat = at + ' pair ' + (index + 1)
        exactKeys(pair, ['left', 'right'], pat)
        var left = text(pair.left, pat + ' left', 240); var right = text(pair.right, pat + ' right', 240)
        if (leftSeen[left.toLocaleLowerCase()] || rightSeen[right.toLocaleLowerCase()]) fail(at + ' pairs must be unique on each side')
        leftSeen[left.toLocaleLowerCase()] = true; rightSeen[right.toLocaleLowerCase()] = true
        return { left: left, right: right }
      }) }
    }
    if (kind === 'categorisation') {
      exactKeys(value, ['categories', 'items'], at)
      var categories = uniqueStrings(value.categories, at + ' categories', 2, 5, 120)
      var categoryItems = array(value.items, at + ' items', 2, 20).map(function(item, index) {
        var iat = at + ' item ' + (index + 1)
        exactKeys(item, ['text', 'categoryIndex'], iat)
        return { text: text(item.text, iat + ' text', 240), categoryIndex: number(item.categoryIndex, iat + ' categoryIndex', 0, categories.length - 1, true) }
      })
      return { categories: categories, items: categoryItems }
    }
    if (kind === 'graph-plotting') {
      exactKeys(value, ['mode', 'xAxis', 'yAxis', 'expectedPoints', 'tolerance'], at)
      var xAxis = axis(value.xAxis, at + ' xAxis'); var yAxis = axis(value.yAxis, at + ' yAxis')
      var expectedPoints = array(value.expectedPoints, at + ' expectedPoints', 1, 50).map(function(point, index) {
        var pointAt = at + ' point ' + (index + 1)
        exactKeys(point, ['x', 'y'], pointAt)
        return { x: number(point.x, pointAt + ' x', xAxis.min, xAxis.max), y: number(point.y, pointAt + ' y', yAxis.min, yAxis.max) }
      })
      return { mode: enumValue(value.mode, ['points', 'polyline', 'freehand'], at + ' mode'), xAxis: xAxis, yAxis: yAxis, expectedPoints: expectedPoints, tolerance: number(value.tolerance, at + ' tolerance', 0, Math.max(xAxis.max - xAxis.min, yAxis.max - yAxis.min)) }
    }
    if (kind === 'hotspot') {
      exactKeys(value, ['acceptedRegions'], at)
      if (!refs.figureRefs.length) fail(at + ' requires a trusted figure reference')
      return { acceptedRegions: array(value.acceptedRegions, at + ' acceptedRegions', 1, 8).map(function(row, index) { return region(row, at + ' region ' + (index + 1)) }) }
    }
    if (kind === 'diagram-labelling') {
      exactKeys(value, ['labels'], at)
      if (!refs.figureRefs.length) fail(at + ' requires a trusted figure reference')
      var labelSeen = Object.create(null)
      return { labels: array(value.labels, at + ' labels', 1, 12).map(function(row, index) {
        var lat = at + ' label ' + (index + 1)
        exactKeys(row, ['text', 'region'], lat)
        var label = text(row.text, lat + ' text', 120); var key = label.toLocaleLowerCase()
        if (labelSeen[key]) fail(at + ' contains duplicate labels')
        labelSeen[key] = true
        return { text: label, region: region(row.region, lat + ' region') }
      }) }
    }
    if (kind === 'sketch-annotate') {
      exactKeys(value, ['backgroundFigureRef', 'rubricPoints'], at)
      var background = text(value.backgroundFigureRef, at + ' backgroundFigureRef', 120, true)
      if (background && refs.figureRefs.indexOf(background) === -1) fail(at + ' backgroundFigureRef must be one of figureRefs')
      return { backgroundFigureRef: background, rubricPoints: uniqueStrings(value.rubricPoints, at + ' rubricPoints', 1, 10, 400) }
    }
    if (kind === 'interactive-scene') return validateScene(value, refs, at)
    if (kind === 'logic-grid') return validateLogicGrid(value, at)
    if (kind === 'cipher-code') return validateCipher(value, at)
    if (kind === 'progressive-case') return validateCase(value, refs, at)
    fail('Unsupported interaction kind "' + kind + '"')
  }

  function validateScene(value, refs, at) {
    exactKeys(value, ['canvas', 'backgroundFigureRef', 'layers', 'steps', 'controls', 'fallbackStep'], at)
    exactKeys(value.canvas, ['width', 'height', 'theme'], at + ' canvas')
    var background = text(value.backgroundFigureRef, at + ' backgroundFigureRef', 120, true)
    if (background && refs.figureRefs.indexOf(background) === -1) fail(at + ' backgroundFigureRef must be one of figureRefs')
    var layerIds = Object.create(null)
    var layers = array(value.layers, at + ' layers', 1, 40).map(function(layer, index) {
      var lat = at + ' layer ' + (index + 1)
      exactKeys(layer, [
        'id', 'type', 'x', 'y', 'width', 'height', 'text', 'figureRef', 'points',
        'xAxis', 'yAxis', 'plotMode', 'language', 'accent', 'pattern', 'marker', 'strokeWidth'
      ], lat)
      var id = text(layer.id, lat + ' id', 40)
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || layerIds[id]) fail(lat + ' id must be unique and identifier-safe')
      layerIds[id] = true
      var type = enumValue(layer.type, [
        'rect', 'circle', 'ellipse', 'line', 'arrow', 'label', 'figure',
        'point', 'polyline', 'polygon', 'plot', 'code'
      ], lat + ' type')
      var out = {
        id: id,
        type: type,
        x: number(layer.x, lat + ' x', 0, 1),
        y: number(layer.y, lat + ' y', 0, 1),
        width: number(layer.width, lat + ' width', 0, 1),
        height: number(layer.height, lat + ' height', 0, 1),
        text: type === 'code' ? codeText(layer.text, lat + ' text') : text(layer.text, lat + ' text', 240, true),
        figureRef: text(layer.figureRef, lat + ' figureRef', 120, true),
        points: [],
        xAxis: null,
        yAxis: null,
        plotMode: null,
        language: text(layer.language, lat + ' language', 30, true),
        accent: layer.accent === undefined ? 'none' : enumValue(layer.accent, ['none', 'blue', 'red', 'green', 'amber', 'violet'], lat + ' accent'),
        pattern: layer.pattern === undefined ? 'solid' : enumValue(layer.pattern, ['solid', 'dashed', 'dotted', 'hatched', 'crosshatched'], lat + ' pattern'),
        marker: layer.marker === undefined ? 'circle' : enumValue(layer.marker, ['circle', 'square', 'diamond', 'cross'], lat + ' marker'),
        strokeWidth: layer.strokeWidth === undefined ? 2 : number(layer.strokeWidth, lat + ' strokeWidth', 1, 12)
      }
      if (out.x + out.width > 1.000001 || out.y + out.height > 1.000001) fail(lat + ' leaves the normalized canvas')
      if (out.figureRef && refs.figureRefs.indexOf(out.figureRef) === -1) fail(lat + ' figureRef must be one of figureRefs')
      if (type === 'figure' && !out.figureRef) fail(lat + ' figure layers require figureRef')
      if (type === 'label' && !out.text) fail(lat + ' label layers require text')
      if (type === 'code' && !out.language) out.language = 'text'
      if (type !== 'code' && out.language) fail(lat + ' language is valid only for code layers')
      if (['rect', 'circle', 'ellipse', 'label', 'figure', 'plot', 'code'].indexOf(type) >= 0 && (!out.width || !out.height))
        fail(lat + ' requires positive width and height')
      if (type === 'polyline' || type === 'polygon') {
        var pointMinimum = type === 'polygon' ? 3 : 2
        out.points = array(layer.points, lat + ' points', pointMinimum, 100).map(function(point, pointIndex) {
          return visualPoint(point, lat + ' point ' + (pointIndex + 1))
        })
      } else if (type === 'plot') {
        out.xAxis = axis(layer.xAxis, lat + ' xAxis')
        out.yAxis = axis(layer.yAxis, lat + ' yAxis')
        out.plotMode = enumValue(layer.plotMode, ['line', 'scatter', 'bar'], lat + ' plotMode')
        out.points = array(layer.points, lat + ' points', 1, 100).map(function(point, pointIndex) {
          return visualPoint(point, lat + ' point ' + (pointIndex + 1), out.xAxis, out.yAxis)
        })
      } else if (layer.points !== undefined || layer.xAxis !== undefined || layer.yAxis !== undefined || layer.plotMode !== undefined) {
        fail(lat + ' graph fields are valid only for polyline, polygon, or plot layers')
      }
      // Colour is always supplementary: a non-monochrome accent must also carry a line/fill
      // pattern that remains distinct on grayscale and e-ink displays.
      if (out.accent !== 'none' && out.pattern === 'solid') fail(lat + ' coloured accents require a non-colour pattern distinction')
      return out
    })
    var steps = array(value.steps, at + ' steps', 1, 30).map(function(step, index) {
      var sat = at + ' step ' + (index + 1)
      exactKeys(step, ['visibleLayerIds', 'transforms', 'commands', 'title', 'description'], sat)
      var visible = uniqueStrings(step.visibleLayerIds, sat + ' visibleLayerIds', 0, layers.length, 40)
      visible.forEach(function(id) { if (!layerIds[id]) fail(sat + ' references unknown layer "' + id + '"') })
      var transforms = step.transforms === undefined ? [] : array(step.transforms, sat + ' transforms', 0, layers.length).map(function(transform, ti) {
        var tat = sat + ' transform ' + (ti + 1)
        exactKeys(transform, ['layerId', 'x', 'y', 'scale', 'rotation'], tat)
        var layerId = text(transform.layerId, tat + ' layerId', 40)
        if (!layerIds[layerId]) fail(tat + ' references an unknown layer')
        return { layerId: layerId, x: number(transform.x, tat + ' x', 0, 1, false, true), y: number(transform.y, tat + ' y', 0, 1, false, true), scale: number(transform.scale, tat + ' scale', 0.1, 5, false, true), rotation: number(transform.rotation, tat + ' rotation', -360, 360, false, true) }
      })
      var commands = step.commands === undefined ? [] : array(step.commands, sat + ' commands', 0, 80).map(function(command, ci) {
        var cat = sat + ' command ' + (ci + 1)
        exactKeys(command, ['op', 'layerId', 'x', 'y', 'value'], cat)
        var op = enumValue(command.op, ['show', 'hide', 'move', 'scale', 'rotate', 'opacity', 'emphasize'], cat + ' op')
        var target = text(command.layerId, cat + ' layerId', 40)
        if (!layerIds[target]) fail(cat + ' references an unknown layer')
        var commandOut = { op: op, layerId: target, x: null, y: null, value: null }
        if (op === 'move') {
          commandOut.x = number(command.x, cat + ' x', 0, 1, false, true)
          commandOut.y = number(command.y, cat + ' y', 0, 1, false, true)
          if (commandOut.x === null && commandOut.y === null) fail(cat + ' move requires x or y')
          if (command.value !== undefined) fail(cat + ' move does not accept value')
        } else if (op === 'show' || op === 'hide') {
          if (command.x !== undefined || command.y !== undefined || command.value !== undefined) fail(cat + ' ' + op + ' does not accept coordinates or value')
        } else {
          if (command.x !== undefined || command.y !== undefined) fail(cat + ' ' + op + ' does not accept coordinates')
          var bounds = op === 'scale' ? [0.1, 5] : (op === 'rotate' ? [-360, 360] : [0, 1])
          commandOut.value = number(command.value, cat + ' value', bounds[0], bounds[1])
        }
        return commandOut
      })
      return {
        visibleLayerIds: visible,
        transforms: transforms,
        commands: commands,
        title: text(step.title, sat + ' title', 120, true),
        description: text(step.description, sat + ' description', 500, true)
      }
    })
    return {
      canvas: {
        width: number(value.canvas.width, at + ' canvas width', 1, 2000, true),
        height: number(value.canvas.height, at + ' canvas height', 1, 2000, true),
        theme: value.canvas.theme === undefined ? 'monochrome' : enumValue(value.canvas.theme, ['monochrome', 'colour-enhanced'], at + ' canvas theme')
      },
      backgroundFigureRef: background,
      layers: layers,
      steps: steps,
      controls: uniqueStrings(value.controls, at + ' controls', 1, 4, 20).map(function(control) { return enumValue(control, ['next', 'previous', 'play', 'reset'], at + ' control') }),
      fallbackStep: number(value.fallbackStep, at + ' fallbackStep', 0, steps.length - 1, true)
    }
  }

  function validateLogicGrid(value, at) {
    exactKeys(value, ['rows', 'columns', 'clues', 'solution'], at)
    var rows = uniqueStrings(value.rows, at + ' rows', 2, 6, 120)
    var columns = uniqueStrings(value.columns, at + ' columns', 2, 6, 120)
    if (rows.length !== columns.length) fail(at + ' must be a square one-to-one grid')
    var solution = array(value.solution, at + ' solution', rows.length, rows.length).map(function(line, ri) {
      if (!Array.isArray(line) || line.length !== columns.length) fail(at + ' solution row ' + (ri + 1) + ' has the wrong size')
      var yes = 0
      var out = line.map(function(cell, ci) {
        if (cell !== 'yes' && cell !== 'no') fail(at + ' solution cell ' + (ri + 1) + ',' + (ci + 1) + ' must be yes or no')
        if (cell === 'yes') yes++
        return cell
      })
      if (yes !== 1) fail(at + ' solution must contain exactly one yes per row')
      return out
    })
    for (var ci = 0; ci < columns.length; ci++) {
      var columnYes = 0
      for (var ri = 0; ri < rows.length; ri++) if (solution[ri][ci] === 'yes') columnYes++
      if (columnYes !== 1) fail(at + ' solution must contain exactly one yes per column')
    }
    return { rows: rows, columns: columns, clues: uniqueStrings(value.clues, at + ' clues', 1, 20, 500), solution: solution }
  }

  function validateCipher(value, at) {
    exactKeys(value, ['cipherType', 'encoded', 'decodedAnswer', 'shift', 'mapping'], at)
    var type = enumValue(value.cipherType, ['caesar', 'substitution', 'symbol', 'sequencing'], at + ' cipherType')
    var out = { cipherType: type, encoded: text(value.encoded, at + ' encoded', 2000), decodedAnswer: text(value.decodedAnswer, at + ' decodedAnswer', 1000), shift: null, mapping: [] }
    if (value.shift !== undefined) out.shift = number(value.shift, at + ' shift', -25, 25, true)
    if (type === 'caesar' && out.shift === null) fail(at + ' Caesar cipher requires shift')
    if (type !== 'caesar' && value.shift !== undefined) fail(at + ' shift is valid only for Caesar ciphers')
    if (value.mapping !== undefined) {
      var fromSeen = Object.create(null); var toSeen = Object.create(null)
      out.mapping = array(value.mapping, at + ' mapping', 1, 40).map(function(row, index) {
        var mat = at + ' mapping ' + (index + 1)
        exactKeys(row, ['from', 'to'], mat)
        var from = text(row.from, mat + ' from', 20); var to = text(row.to, mat + ' to', 20)
        if (fromSeen[from] || toSeen[to]) fail(at + ' mapping must be one-to-one')
        fromSeen[from] = true; toSeen[to] = true
        return { from: from, to: to }
      })
    }
    if ((type === 'substitution' || type === 'symbol') && !out.mapping.length) fail(at + ' cipher type requires mapping')
    return out
  }

  function tableCell(value, at) {
    if (typeof value !== 'string') fail(at + ' must be text')
    var out = value.replace(/\s+/g, ' ').trim()
    if (out.length > 500) fail(at + ' is too long')
    if (UNSAFE.test(out)) fail(at + ' contains markup, executable content, or a URL')
    return out
  }

  function validateSharedTable(value, at) {
    exactKeys(value, ['caption', 'headers', 'rows'], at)
    var headers = array(value.headers, at + ' headers', 0, 10).map(function(value, index) {
      var out = tableCell(value, at + ' headers item ' + (index + 1))
      // Repeated authored labels are valid in grouped/spanning tables. Column position and the
      // preserved group-heading body row distinguish them without rewriting source text.
      return out
    })
    var rows = array(value.rows, at + ' rows', 1, 50)
    var width = headers.length || (Array.isArray(rows[0]) ? rows[0].length : 0)
    if (!width || width > 10) fail(at + ' rows must contain between 1 and 10 cells')
    rows = rows.map(function(row, ri) {
      if (!Array.isArray(row) || row.length !== width)
        fail(at + ' row ' + (ri + 1) + ' must contain ' + width + ' cells')
      return row.map(function(cell, ci) { return tableCell(cell, at + ' row ' + (ri + 1) + ' cell ' + (ci + 1)) })
    })
    return {
      caption: text(value.caption, at + ' caption', 240, true),
      headers: headers,
      rows: rows
    }
  }

  function trustedFigureRef(value, refs, at) {
    var figureRef = text(value, at, 120, true)
    if (figureRef && refs.figureRefs.indexOf(figureRef) === -1)
      fail(at + ' must be one of figureRefs')
    return figureRef
  }

  function validateSharedContext(value, refs, at) {
    exactKeys(value, ['title', 'content', 'table', 'figureRef', 'stages'], at)
    var content = value.content === undefined ? null : proseText(value.content, at + ' content', 20000)
    var figureRef = trustedFigureRef(value.figureRef, refs, at + ' figureRef')
    var context = {
      title: text(value.title, at + ' title', 160, true),
      content: content,
      // Presentation is a local readability decision, not a model-controlled hint. Long passages
      // remain present and start expanded, but the reader may collapse them while answering.
      display: content && content.length > 1200 ? 'collapsible' : 'pinned',
      table: null,
      figureRef: figureRef,
      stages: []
    }
    if (value.table !== undefined) context.table = validateSharedTable(value.table, at + ' table')
    if (value.stages !== undefined) {
      var stageIds = Object.create(null)
      // One authored disclosure after a passage/table is still a valid ordered context.
      context.stages = array(value.stages, at + ' stages', 1, 64).map(function(stage, index) {
        var sat = at + ' stage ' + (index + 1)
        exactKeys(stage, ['id', 'title', 'content', 'table', 'figureRef'], sat)
        var id = text(stage.id, sat + ' id', 40)
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || stageIds[id]) fail(sat + ' id must be unique and identifier-safe')
        stageIds[id] = true
        var stageContent = stage.content === undefined ? null : proseText(stage.content, sat + ' content', 8000)
        var stageTable = stage.table === undefined ? null : validateSharedTable(stage.table, sat + ' table')
        var stageFigure = trustedFigureRef(stage.figureRef, refs, sat + ' figureRef')
        if (!stageContent && !stageTable && !stageFigure) fail(sat + ' requires content, table, or figureRef')
        return { id: id, title: text(stage.title, sat + ' title', 160), content: stageContent, table: stageTable, figureRef: stageFigure }
      })
    }
    if (!context.content && !context.table && !context.figureRef && !context.stages.length)
      fail(at + ' requires content, table, figureRef, or stages')
    return context
  }

  function validateSharedQuestions(value, refs, stageIds, at) {
    var seen = Object.create(null)
    return array(value, at, 1, 20).map(function(question, index) {
      var qat = at + ' item ' + (index + 1)
      exactKeys(question, ['id', 'kind', 'afterStage', 'figureRef', 'prompt', 'payload', 'explanation'], qat)
      var id = text(question.id, qat + ' id', 40)
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || seen[id]) fail(qat + ' id must be unique and identifier-safe')
      seen[id] = true
      var kind = enumValue(question.kind, SHARED_SET_KINDS, qat + ' kind')
      var childPayload = validatePayload(kind, question.payload, refs, qat + ' payload')
      if (kind === 'short-answer' && !childPayload.acceptedAnswers.length)
        fail(qat + ' short-answer requires acceptedAnswers for local scoring')
      var afterStage = text(question.afterStage, qat + ' afterStage', 40, true)
      if (afterStage && stageIds.indexOf(afterStage) === -1) fail(qat + ' afterStage must be one of context stages')
      return {
        id: id,
        kind: kind,
        afterStage: afterStage,
        figureRef: trustedFigureRef(question.figureRef, refs, qat + ' figureRef'),
        prompt: text(question.prompt, qat + ' prompt', 2400),
        payload: childPayload,
        // Source-authored worked rationales may span several dynamically composed reveal pages.
        // Use the same non-truncating safety ceiling as staged rubrics; the renderer paginates it.
        explanation: text(question.explanation, qat + ' explanation', 24000, true)
      }
    })
  }

  function validateCase(value, refs, at) {
    exactKeys(value, ['presentation', 'stages', 'context', 'questions', 'timedSeconds'], at)
    var presentation = enumValue(value.presentation, ['passage', 'data-set', 'clinical-case'], at + ' presentation')
    var hasStages = value.stages !== undefined
    var hasSharedSet = value.context !== undefined || value.questions !== undefined
    if (hasStages === hasSharedSet) fail(at + ' must define either stages or context/questions')
    var timedSeconds = value.timedSeconds === undefined ? null : number(value.timedSeconds, at + ' timedSeconds', 30, 14400, true)
    if (hasSharedSet) {
      if (value.context === undefined || value.questions === undefined)
        fail(at + ' shared question set requires both context and questions')
      var context = validateSharedContext(value.context, refs, at + ' context')
      return {
        presentation: presentation,
        context: context,
        questions: validateSharedQuestions(value.questions, refs, context.stages.map(function(stage) { return stage.id }), at + ' questions'),
        timedSeconds: timedSeconds
      }
    }
    var stages = array(value.stages, at + ' stages', 2, 64).map(function(stage, index) {
      var sat = at + ' stage ' + (index + 1)
      exactKeys(stage, ['title', 'content', 'figureRef', 'clues', 'prompt', 'acceptedAnswers', 'rubric', 'rubricParagraphs'], sat)
      var prompt = text(stage.prompt, sat + ' prompt', 2400, true)
      var accepted = stage.acceptedAnswers === undefined ? [] : stringAnswers(stage.acceptedAnswers, sat + ' acceptedAnswers', 0)
      // Authored answers are renderer-paginated at runtime. Keep a bounded safety ceiling, but do
      // not force the converter to truncate or abandon a legitimate multi-page source response.
      var rubric = text(stage.rubric, sat + ' rubric', 24000, true)
      var rubricParagraphs = stage.rubricParagraphs === undefined ? [] :
        array(stage.rubricParagraphs, sat + ' rubricParagraphs', 0, 256).map(function(paragraph, paragraphIndex) {
          return text(paragraph, sat + ' rubricParagraphs ' + (paragraphIndex + 1), 12000)
        })
      if (rubricParagraphs.join('\n').length > 24000) fail(sat + ' rubricParagraphs exceed 24000 characters')
      if (prompt && !accepted.length && !rubric) fail(sat + ' question requires acceptedAnswers or rubric')
      if (!prompt && (accepted.length || rubric)) fail(sat + ' answer guidance requires a prompt')
      return { title: text(stage.title, sat + ' title', 160), content: text(stage.content, sat + ' content', 2400),
        figureRef: trustedFigureRef(stage.figureRef, refs, sat + ' figureRef'),
        clues: stage.clues === undefined ? [] : uniqueStrings(stage.clues, sat + ' clues', 0, 12, 1200),
        prompt: prompt, acceptedAnswers: accepted, rubric: rubric, rubricParagraphs: rubricParagraphs }
    })
    return { presentation: presentation, stages: stages, timedSeconds: timedSeconds }
  }

  function validateDraft(draft, source) {
    exactKeys(draft, ['schemaVersion', 'title', 'mode', 'activities'], 'Workbook')
    if (draft.schemaVersion !== 1) fail('Workbook uses an unsupported schema version')
    var activities = array(draft.activities, 'Workbook activities', 1, 100).map(function(activity, index) {
      var at = 'Activity ' + (index + 1)
      exactKeys(activity, ['kind', 'prompt', 'difficulty', 'evidenceRefs', 'figureRefs', 'hints', 'explanation', 'rubric', 'payload'], at)
      var kind = enumValue(activity.kind, KINDS, at + ' kind')
      var refs = resolveReferences(activity, source, at)
      var explanation = text(activity.explanation, at + ' explanation', 2400, true)
      var rubric = text(activity.rubric, at + ' rubric', 1600, true)
      if (!explanation && !rubric && kind !== 'reveal-card') fail(at + ' requires an explanation or rubric')
      return {
        kind: kind,
        prompt: text(activity.prompt, at + ' prompt', 3600),
        difficulty: enumValue(activity.difficulty, ['introductory', 'standard', 'advanced'], at + ' difficulty'),
        evidenceRefs: refs.evidenceRefs,
        figureRefs: refs.figureRefs,
        evidence: refs.evidence,
        figures: refs.figures,
        hints: activity.hints === undefined ? [] : uniqueStrings(activity.hints, at + ' hints', 0, 3, 500),
        explanation: explanation,
        rubric: rubric,
        payload: validatePayload(kind, activity.payload, refs, at + ' payload')
      }
    })
    var valid = {
      schemaVersion: 1,
      title: text(draft.title, 'Workbook title', 120),
      mode: enumValue(draft.mode, ['adapted', 'generated', 'mixed'], 'Workbook mode'),
      activities: activities
    }
    VALIDATED.add(valid)
    return deepFreeze(valid)
  }

  function templates() {
    return KINDS.map(function(kind) {
      return {
        id: kind,
        version: 1,
        status: 'active',
        renderer: 'workbook-activity',
        capabilities: CAPABILITIES[kind].slice(),
        sourceRequirements: (kind === 'hotspot' || kind === 'diagram-labelling') ? ['evidence', 'figure'] : ['evidence'],
        scoringPolicy: ['reveal-card', 'sketch-annotate', 'interactive-scene'].indexOf(kind) >= 0 ? 'self-check' : 'deterministic',
        resultsPolicy: 'workbook-v2',
        responseShape: RESPONSE_SHAPES[kind]
      }
    })
  }

  function listTemplates() { return templates() }

  function loadTemplate(id, version) {
    version = version === undefined ? 1 : version
    var found = templates().find(function(row) { return row.id === id && row.version === version })
    if (!found) fail('Unknown workbook template "' + id + '/v' + version + '"')
    return found
  }

  function uid(prefix, options) {
    if (options && typeof options.idFactory === 'function') return options.idFactory(prefix)
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }

  function compileDraft(valid, source, providerMeta, options) {
    // Keep the public compiler safe even when a caller skips the explicit validation step.
    if (!valid || !VALIDATED.has(valid)) valid = validateDraft(valid, source)
    options = options || {}
    var groupId = uid('wb', options)
    var activities = valid.activities.map(function(activity, index) {
      var copy = JSON.parse(JSON.stringify(activity))
      copy.id = groupId + '-a' + (index + 1)
      copy.template = { id: activity.kind, version: 1 }
      return copy
    })
    var pages = activities.map(function(activity, index) {
      var pageId = groupId + '-p' + (index + 1)
      return {
        id: pageId,
        title: valid.title,
        page: {
          pageId: pageId,
          template: 'study-workbook',
          blocks: [],
          interaction: {
            type: 'workbook-activity',
            groupId: groupId,
            activityIndex: index,
            activityCount: activities.length,
            mode: options.sessionMode === 'exam' ? 'exam' : 'practice',
            activity: activity
          }
        }
      }
    })
    // A single source-answer reveal is already reviewed, persisted and fully usable on its
    // activity sheet. Following it with a separate 0/1 results sheet adds no information and can
    // leave most of an e-ink screen empty. Scored, multi-activity and exam workbooks retain their
    // local results page.
    var compactSingleReview = activities.length === 1 && activities[0].kind === 'reveal-card' &&
      options.sessionMode !== 'exam'
    if (!compactSingleReview) {
      var resultId = groupId + '-results'
      pages.push({
        id: resultId,
        title: valid.title,
        page: {
          pageId: resultId,
          template: 'study-workbook',
          blocks: [],
          interaction: {
            type: 'workbook-results',
            groupId: groupId,
            activityCount: activities.length,
            mode: options.sessionMode === 'exam' ? 'exam' : 'practice',
            // Results retain the immutable validated activities so exam-mode scoring and review are
            // entirely local. No provider call or mutable attempt data is needed to reconstruct keys.
            activities: activities.map(function(activity) {
              var copy = JSON.parse(JSON.stringify(activity))
              copy.scoringPolicy = loadTemplate(activity.kind, 1).scoringPolicy
              return copy
            })
          }
        }
      })
    }
    var versions = []
    activities.forEach(function(activity) {
      if (!versions.some(function(row) { return row.id === activity.kind })) versions.push({ id: activity.kind, version: 1 })
    })
    return {
      id: groupId,
      kind: 'study-workbook',
      schemaVersion: 2,
      title: valid.title,
      mode: valid.mode,
      activityCount: activities.length,
      resultsPolicy: compactSingleReview ? 'inline-single-review-v1' : 'workbook-v2',
      templateVersions: versions,
      capabilities: Array.from(new Set([].concat.apply([], activities.map(function(activity) { return CAPABILITIES[activity.kind] })))).sort(),
      after: source && source.anchor ? source.anchor : null,
      createdAt: options.now || new Date().toISOString(),
      source: {
        format: source && source.format || null,
        scope: source && source.scope || null,
        label: source && source.label || null,
        fingerprint: source && source.fingerprint || null
      },
      provider: {
        id: providerMeta && providerMeta.providerId || 'local',
        model: providerMeta && providerMeta.model || null,
        usage: providerMeta && providerMeta.usage || null
      },
      pages: pages
    }
  }

  function validateAndCompile(draft, source, providerMeta, options) {
    return compileDraft(validateDraft(draft, source), source, providerMeta, options)
  }

  function normalizeAnswer(value, caseSensitive) {
    var out = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim()
    return caseSensitive ? out : out.toLocaleLowerCase()
  }

  function responseValue(response, key) {
    return own(response, key) ? response[key] : response
  }

  function rounded(value, precision) {
    if (precision === null || precision === undefined) return value
    var scale = Math.pow(10, precision)
    return Math.round((value + Number.EPSILON) * scale) / scale
  }

  function result(correct, score, maxScore) {
    return { scorable: true, correct: !!correct, score: score, maxScore: maxScore }
  }

  function selfCheck() { return { scorable: false, correct: null, score: null, maxScore: null } }

  function sameArray(actual, expected) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every(function(value, index) { return actual[index] === value })
  }

  function scoreResponse(kind, payload, response) {
    if (kind === 'single-choice') return result(responseValue(response, 'selectedIndex') === payload.correctIndex, responseValue(response, 'selectedIndex') === payload.correctIndex ? 1 : 0, 1)
    if (kind === 'multi-select') {
      var selected = responseValue(response, 'selectedIndices')
      var correct = Array.isArray(selected) && sameArray(selected.slice().sort(function(a, b) { return a - b }), payload.correctIndices.slice().sort(function(a, b) { return a - b }))
      return result(correct, correct ? 1 : 0, 1)
    }
    if (kind === 'true-false-cant-tell') {
      var tf = responseValue(response, 'answer') === payload.answer
      return result(tf, tf ? 1 : 0, 1)
    }
    if (kind === 'cloze') {
      var blankResponses = responseValue(response, 'answers')
      if (!isObject(blankResponses)) return result(false, 0, payload.blanks.length)
      var blankScore = payload.blanks.reduce(function(total, blank) {
        var actual = normalizeAnswer(own(blankResponses, blank.id) ? blankResponses[blank.id] : '', false)
        return total + (blank.acceptedAnswers.some(function(answer) { return normalizeAnswer(answer, false) === actual }) ? 1 : 0)
      }, 0)
      return result(blankScore === payload.blanks.length, blankScore, payload.blanks.length)
    }
    if (kind === 'short-answer') {
      if (!payload.acceptedAnswers.length) return selfCheck()
      var short = normalizeAnswer(responseValue(response, 'answer'), payload.caseSensitive)
      var shortCorrect = payload.acceptedAnswers.some(function(answer) { return normalizeAnswer(answer, payload.caseSensitive) === short })
      return result(shortCorrect, shortCorrect ? 1 : 0, 1)
    }
    if (kind === 'reveal-card' || kind === 'sketch-annotate' || kind === 'interactive-scene') return selfCheck()
    if (kind === 'numeric-answer') {
      var numeric = Number(responseValue(response, 'value')); var numericCorrect = false
      if (Number.isFinite(numeric)) {
        numeric = rounded(numeric, payload.precision)
        numericCorrect = payload.answer !== undefined
          ? Math.abs(numeric - rounded(payload.answer, payload.precision)) <= payload.tolerance
          : numeric >= rounded(payload.min, payload.precision) && numeric <= rounded(payload.max, payload.precision)
      }
      return result(numericCorrect, numericCorrect ? 1 : 0, 1)
    }
    if (kind === 'estimate-slider') {
      var estimate = Number(responseValue(response, 'value'))
      var stepPosition = (estimate - payload.min) / payload.step
      var onStep = Number.isFinite(stepPosition) && Math.abs(stepPosition - Math.round(stepPosition)) <= 1e-8
      var estimateCorrect = Number.isFinite(estimate) && onStep && estimate >= payload.acceptedMin && estimate <= payload.acceptedMax
      return result(estimateCorrect, estimateCorrect ? 1 : 0, 1)
    }
    if (kind === 'ordering' || kind === 'timeline') {
      var order = responseValue(response, 'order'); var orderCorrect = sameArray(order, payload.correctOrder)
      return result(orderCorrect, orderCorrect ? 1 : 0, 1)
    }
    if (kind === 'matching-pairs') {
      var matches = responseValue(response, 'matches'); var expectedMatches = payload.pairs.map(function(_, index) { return index })
      var matchCorrect = sameArray(matches, expectedMatches)
      return result(matchCorrect, matchCorrect ? 1 : 0, 1)
    }
    if (kind === 'categorisation') {
      var assignments = responseValue(response, 'assignments'); var expectedAssignments = payload.items.map(function(item) { return item.categoryIndex })
      var categoryCorrect = sameArray(assignments, expectedAssignments)
      return result(categoryCorrect, categoryCorrect ? 1 : 0, 1)
    }
    if (kind === 'graph-plotting') {
      var points = responseValue(response, 'points'); var pointScore = 0
      if (Array.isArray(points) && points.length === payload.expectedPoints.length) {
        payload.expectedPoints.forEach(function(expected, index) {
          var point = points[index]
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.hypot(point.x - expected.x, point.y - expected.y) <= payload.tolerance) pointScore++
        })
      }
      return result(pointScore === payload.expectedPoints.length, pointScore, payload.expectedPoints.length)
    }
    if (kind === 'hotspot') {
      var point = responseValue(response, 'point') || {}; var hit = payload.acceptedRegions.some(function(row) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
        return row.shape === 'rect'
          ? point.x >= row.x && point.x <= row.x + row.width && point.y >= row.y && point.y <= row.y + row.height
          : Math.hypot(point.x - row.x, point.y - row.y) <= row.radius
      })
      return result(hit, hit ? 1 : 0, 1)
    }
    if (kind === 'diagram-labelling') {
      var placements = responseValue(response, 'placements'); var placementScore = 0
      if (Array.isArray(placements) && placements.length === payload.labels.length) {
        payload.labels.forEach(function(label, index) {
          var point = placements[index]; var row = label.region
          if (point && (row.shape === 'rect'
            ? point.x >= row.x && point.x <= row.x + row.width && point.y >= row.y && point.y <= row.y + row.height
            : Math.hypot(point.x - row.x, point.y - row.y) <= row.radius)) placementScore++
        })
      }
      return result(placementScore === payload.labels.length, placementScore, payload.labels.length)
    }
    if (kind === 'logic-grid') {
      var grid = responseValue(response, 'grid'); var gridCorrect = Array.isArray(grid) && grid.length === payload.solution.length && payload.solution.every(function(row, index) { return sameArray(grid[index], row) })
      return result(gridCorrect, gridCorrect ? 1 : 0, 1)
    }
    if (kind === 'cipher-code') {
      var decoded = normalizeAnswer(responseValue(response, 'answer'), false); var decodedCorrect = decoded === normalizeAnswer(payload.decodedAnswer, false)
      return result(decodedCorrect, decodedCorrect ? 1 : 0, 1)
    }
    if (kind === 'progressive-case') {
      var answers = responseValue(response, 'answers')
      if (Array.isArray(payload.questions)) {
        if (!isObject(answers)) answers = {}
        var questionScore = 0; var questionMax = 0
        payload.questions.forEach(function(question) {
          var child = scoreResponse(question.kind, question.payload, own(answers, question.id) ? answers[question.id] : {})
          if (!child.scorable) return
          questionScore += child.score
          questionMax += child.maxScore
        })
        if (!questionMax) return selfCheck()
        return result(questionScore === questionMax, questionScore, questionMax)
      }
      if (!isObject(answers)) return selfCheck()
      var caseScore = 0; var caseMax = 0
      payload.stages.forEach(function(stage, index) {
        if (!stage.acceptedAnswers.length) return
        caseMax++
        var answer = normalizeAnswer(answers[index], false)
        if (stage.acceptedAnswers.some(function(expected) { return normalizeAnswer(expected, false) === answer })) caseScore++
      })
      if (!caseMax) return selfCheck()
      return result(caseScore === caseMax, caseScore, caseMax)
    }
    fail('Unsupported interaction kind "' + kind + '"')
  }

  function score(activity, response) {
    if (!activity || KINDS.indexOf(activity.kind) === -1 || !isObject(activity.payload))
      fail('A validated workbook activity is required for scoring')
    return scoreResponse(activity.kind, activity.payload, response)
  }

  function providerTemplate(options) {
    options = options || {}
    var requested = Array.isArray(options.kinds) && options.kinds.length
      ? options.kinds.filter(function(kind) { return KINDS.indexOf(kind) >= 0 }) : KINDS.slice()
    var preference = {
      'clinical-case': ['progressive-case', 'short-answer', 'diagram-labelling', 'hotspot', 'multi-select'],
      'passage-question-set': ['progressive-case', 'true-false-cant-tell', 'multi-select', 'single-choice'],
      exercise: ['numeric-answer', 'graph-plotting', 'ordering', 'multi-select', 'single-choice'],
      'answer-solution': ['short-answer', 'numeric-answer', 'reveal-card'],
      'table-data': ['progressive-case', 'numeric-answer', 'graph-plotting', 'categorisation', 'matching-pairs'],
      graph: ['graph-plotting', 'numeric-answer', 'estimate-slider'],
      'figure-dependent': ['hotspot', 'diagram-labelling', 'sketch-annotate', 'interactive-scene'],
      'puzzle-riddle': ['short-answer', 'progressive-case', 'logic-grid', 'ordering', 'cipher-code'],
      'cipher-logic': ['cipher-code', 'logic-grid', 'matching-pairs', 'ordering'],
      'general-prose': ['cloze', 'short-answer', 'reveal-card', 'ordering', 'timeline', 'categorisation', 'single-choice']
    }
    var classifications = options.source && Array.isArray(options.source.units)
      ? options.source.units.map(function(unit) { return unit && unit.classification && unit.classification.kind }).filter(Boolean) : []
    // A unit can be an exercise *and* depend on a table or figure. The conservative source
    // classifier deliberately chooses one primary label, but generation must not discard those
    // orthogonal visual signals. Add them as secondary ranking signals from trusted packet data.
    if (options.source && Array.isArray(options.source.tables) && options.source.tables.length)
      classifications.unshift('table-data')
    if (options.source && Array.isArray(options.source.figures) && options.source.figures.length)
      classifications.unshift('figure-dependent')
    var ranked = []
    classifications.forEach(function(classification) {
      ;(preference[classification] || []).forEach(function(kind) {
        if (requested.indexOf(kind) >= 0 && ranked.indexOf(kind) < 0) ranked.push(kind)
      })
    })
    requested.forEach(function(kind) { if (ranked.indexOf(kind) < 0) ranked.push(kind) })
    requested = ranked
    var targetCount = Math.max(1, Math.min(20, Number(options.questionCount) || 5))
    // Faithful adaptation preserves the source's activity type even when every authored item is an
    // MCQ. Variety is a generation quality rule, not permission to rewrite an existing exercise.
    var minDistinct = options.mode === 'adapted' ? 1 :
      (requested.length >= 2 && targetCount >= 3 ? 2 : 1)
    return {
      id: 'study-workbook', version: 1,
      prompt: [
        'Return one JSON object only. Create an adult, source-grounded study workbook; never return executable application code, markup, links, file paths, renderer names, or invented source IDs.',
        'Prefer adapting source-authored questions, cases, clues, tables and answers. Generate new material only when adaptation is unavailable or mode is generated or mixed.',
        'Every activity must cite provided segment IDs in evidenceRefs. Use figureRefs only from provided figure IDs.',
        'Use only these interaction kinds, listed in source-preference order: ' + requested.join(', ') + '.',
        'Choose formats that fit the source rather than converting everything to a quiz. For this batch use at least ' + minDistinct + ' distinct interaction kinds. Avoid choice formats when a quantitative, staged, visual, arrangement, cipher, or free-response format expresses the source better. Do not use choice formats for more than half of a mixed batch unless the source itself is a choice-based exam.',
        'Digitise the learning task, not merely the surrounding prose. Preserve source-authored calculations, ordering, diagram work, table interpretation, graph construction, case reasoning and multi-part exercises as actions the learner performs. Do not replace them with shallow recall questions.',
        'Treat the batch as a professionally edited workbook sequence: orient the learner, practise the source method, apply it, then consolidate or reflect where the supplied material supports those stages. Avoid a random bag of disconnected questions.',
        'When trusted figures are supplied and relevant, use them directly in hotspot, diagram-labelling, sketch-annotate, interactive-scene, or progressive-case work. Do not ask a text-only question about visual relationships that the learner should inspect on the figure. When trusted tables are supplied, preserve their exact values and headings in a data-set context or use them for a genuinely quantitative activity.',
        'Every prompt must be specific enough to stand on its cited evidence. Every explanation must state the reasoning, calculation, distinction, sequence, or source fact that resolves the task; never write generic filler such as "the source says so" or "the result follows from the cited source".',
        'Choice distractors must be plausible source-relevant misconceptions, mutually distinct, and unambiguously wrong. Never use placeholders such as Option A, Alpha, all of the above, none of the above, or restatements that differ only cosmetically.',
        'Do not test page furniture, captions as trivia, publisher wording, or facts outside the supplied evidence. Do not expose an answer from a worked solution in the prompt or hint. If the source is insufficient or ambiguous, omit the activity rather than inventing precision.',
        'Difficulty is ' + (options.difficulty || 'standard') + '. Workbook mode is ' + (options.mode || 'adapted') + '.',
        'For clinical material, keep answers and explanations tied to cited evidence. Use source-backed rubrics for sketches or open reasoning.',
        'When several source-authored questions share a passage, scenario, table, chart, figure, or other source context, create one progressive-case activity with one context object and multiple questions. Store the context once; do not repeat or paraphrase it into every child prompt. Use the source question type when it is one of the supported child kinds. For clinical cases whose history, examination, investigations, or deterioration are disclosed sequentially, put those disclosures in ordered context.stages and attach each question with afterStage so future findings do not leak early. Context is paged and remains part of the task, not a hint.',
        'Interactive scenes may include inert code examples and bounded plot data only through the validated code and plot layer primitives. They must never contain scripts, event handlers, expressions, network access, generated markup, or arbitrary styling.',
        'Scene visuals default to monochrome. If colour-enhanced is requested, colour must be supplementary and every accented layer must also use a dashed, dotted, hatched, or crosshatched pattern.',
        'Activity payloads must follow payloadShapes exactly. responseShapes describe learner answers only and must never appear as activity fields.'
      ].join(' '),
      schema: {
        type: 'object', additionalProperties: false,
        required: ['schemaVersion', 'title', 'mode', 'activities', 'qualityReview'],
        properties: {
          schemaVersion: { type: 'integer', enum: [1] }, title: { type: 'string' },
          mode: { enum: ['adapted', 'generated', 'mixed'] },
          qualityReview: {
            type: 'object', additionalProperties: false,
            required: ['status', 'issues', 'suggestedAction'],
            properties: {
              status: { enum: ['pass', 'suspect', 'abstain'] },
              issues: { type: 'array', items: {
                type: 'object', additionalProperties: false,
                required: ['code', 'severity', 'description'],
                properties: {
                  code: { type: 'string' }, severity: { enum: ['low', 'medium', 'high', 'error'] },
                  description: { type: 'string' }
                }
              } },
              suggestedAction: { type: 'string' }
            }
          },
          activities: { type: 'array', minItems: targetCount, maxItems: targetCount, items: {
            type: 'object', additionalProperties: false,
            required: ['kind', 'prompt', 'difficulty', 'evidenceRefs', 'figureRefs', 'hints', 'payload'],
            properties: {
              kind: { enum: requested }, prompt: { type: 'string' },
              difficulty: { enum: ['introductory', 'standard', 'advanced'] },
              evidenceRefs: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
              figureRefs: { type: 'array', maxItems: 64, items: { type: 'string' } },
              hints: { type: 'array', maxItems: 3, items: { type: 'string' } },
              explanation: { type: 'string' }, rubric: { type: 'string' },
              // Interaction payloads are subsequently checked by the complete local closed
              // catalogue. The provider schema constrains the envelope without erasing the
              // kind-specific fields needed by twenty different payload contracts.
              payload: { type: 'object', additionalProperties: true }
            }
          } }
        }
      },
      payloadShapes: requested.reduce(function(out, kind) { out[kind] = PAYLOAD_SHAPES[kind]; return out }, {}),
      responseShapes: requested.reduce(function(out, kind) { out[kind] = RESPONSE_SHAPES[kind]; return out }, {}),
      generationPolicy: { minDistinctKinds: minDistinct, requestedKinds: requested.slice() },
      // A single-choice example is useful only when that kind is actually permitted by the
      // generated schema. Omitting it for visual, numeric, or other focused batches prevents the
      // provider prompt from demonstrating JSON that its own requested-kind enum rejects.
      example: requested.indexOf('single-choice') >= 0 ? {
        schemaVersion: 1, title: 'Source review', mode: options.mode || 'adapted',
        activities: [{ kind: 'single-choice', prompt: 'Which statement is supported by the source?', difficulty: options.difficulty || 'standard', evidenceRefs: ['segment-1'], figureRefs: [], hints: [], explanation: 'The cited passage states this directly.', payload: { choices: ['Supported statement', 'Distractor one'], correctIndex: 0 } }]
      } : null
    }
  }

  function validateGenerationPolicy(valid, template) {
    var policy = template && template.generationPolicy
    if (!policy || !Array.isArray(valid && valid.activities)) return valid
    var distinct = []
    valid.activities.forEach(function(activity) {
      if (distinct.indexOf(activity.kind) < 0) distinct.push(activity.kind)
    })
    if (distinct.length < policy.minDistinctKinds)
      fail('Generated batch needs at least ' + policy.minDistinctKinds + ' distinct interaction kinds; received ' + distinct.length)
    return valid
  }

  function auditDraftQuality(valid, source) {
    var issues = []
    var activities = Array.isArray(valid && valid.activities) ? valid.activities : []
    var figures = Array.isArray(source && source.figures) ? source.figures : []
    var tables = Array.isArray(source && source.tables) ? source.tables : []
    var usedFigures = {}
    var usedEvidence = {}
    var tableKinds = {
      'progressive-case': true, 'numeric-answer': true, 'graph-plotting': true,
      categorisation: true, 'matching-pairs': true, 'estimate-slider': true
    }
    function add(severity, code, message, index) {
      var issue = { severity: severity, code: code, message: message }
      if (Number.isInteger(index)) issue.activityIndex = index
      issues.push(issue)
    }
    function rows(value) { return Array.isArray(value) ? value : [] }
    function editorialText(value) {
      return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    }
    activities.forEach(function(activity, index) {
      rows(activity.figureRefs).forEach(function(id) { usedFigures[String(id)] = true })
      rows(activity.evidenceRefs).forEach(function(id) { usedEvidence[String(id)] = (usedEvidence[String(id)] || 0) + 1 })
      var prompt = editorialText(activity.prompt)
      var guidance = editorialText(activity.explanation || activity.rubric)
      if (/^(complete|answer|do) (this|the) .{0,30}(activity|question|task)\.?$/.test(prompt) ||
          /^which statement is supported by (the|this) source\??$/.test(prompt))
        add('error', 'placeholder-prompt', 'Replace the generic prompt with a source-specific learning task.', index)
      if (/^(the )?(result|answer) (follows|comes) from (the )?(cited )?(source|evidence)/.test(guidance) ||
          /^(review|check) the (source|evidence)/.test(guidance))
        add('error', 'generic-guidance', 'Explain the actual reasoning or source distinction instead of referring vaguely to the evidence.', index)
      if (guidance && guidance.length < 28)
        add('warning', 'thin-guidance', 'The explanation or rubric is too brief for a professionally edited activity.', index)
      if (activity.kind === 'single-choice' || activity.kind === 'multi-select') {
        var choices = rows(activity.payload && activity.payload.choices).map(editorialText)
        if (choices.some(function(choice) {
          return /^(option|choice) [a-h0-9]$/.test(choice) || /^(alpha|beta|gamma|delta)$/.test(choice) ||
            /^(all|none) of the above$/.test(choice)
        })) add('error', 'placeholder-distractor', 'Replace placeholder or test-wise distractors with plausible source-relevant misconceptions.', index)
      }
    })
    if (figures.length && !Object.keys(usedFigures).length)
      add('warning', 'unused-figures', 'This selection contains trusted figures, but the draft does not use any of them.')
    if (tables.length && !activities.some(function(activity) { return !!tableKinds[activity.kind] }))
      add('warning', 'unused-tables', 'This selection contains structured table data, but the draft contains no table-appropriate activity.')
    var repeatedEvidence = Object.keys(usedEvidence).find(function(id) {
      return activities.length >= 4 && usedEvidence[id] === activities.length
    })
    if (repeatedEvidence)
      add('warning', 'single-evidence-pattern', 'Every activity cites the same evidence segment; review whether the workbook actually covers the selected material.')
    return issues
  }

  function validateEditorialQuality(valid, source) {
    var issues = auditDraftQuality(valid, source)
    var blocking = issues.filter(function(issue) { return issue.severity === 'error' })
    if (blocking.length) fail('Editorial quality review failed: ' + blocking.map(function(issue) {
      return 'activity ' + ((issue.activityIndex || 0) + 1) + ' ' + issue.message
    }).join(' '))
    return valid
  }

  return {
    listTemplates: listTemplates,
    loadTemplate: loadTemplate,
    validateDraft: validateDraft,
    compileDraft: compileDraft,
    validateAndCompile: validateAndCompile,
    score: score,
    scoreResponse: scoreResponse,
    responseShapes: Object.assign({}, RESPONSE_SHAPES),
    payloadShapes: Object.assign({}, PAYLOAD_SHAPES),
    providerTemplate: providerTemplate,
    validateGenerationPolicy: validateGenerationPolicy,
    auditDraftQuality: auditDraftQuality,
    validateEditorialQuality: validateEditorialQuality,
    _unsafePattern: UNSAFE,
    _kinds: KINDS.slice()
  }
})
