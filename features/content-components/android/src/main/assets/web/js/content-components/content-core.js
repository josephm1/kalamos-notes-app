(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.KalamosContent = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  var DEFINITION_SCHEMA = 'kalamos.interaction-definition/v1'
  var RESPONSE_SCHEMA = 'kalamos.interaction-response/v1'
  var SCENARIO_SCHEMA = 'kalamos.scenario/v2'
  var INK_SCHEMA = 'kalamos.pen-strokes/v1'
  var ASSET_SCHEMA = 'kalamos.asset-ref/v1'
  var REVIEW_SCHEMA = 'kalamos.ai-review/v1'

  var CATALOGUE = [
    ['single-choice', 'Recall and assessment', ['choice'], 'deterministic', ['learn', 'play', 'books']],
    ['multi-select', 'Recall and assessment', ['choice'], 'deterministic', ['learn', 'play', 'books']],
    ['true-false-cant-tell', 'Recall and assessment', ['choice'], 'deterministic', ['learn', 'play', 'books']],
    ['cloze', 'Recall and assessment', ['text'], 'deterministic', ['learn', 'play', 'books']],
    ['short-answer', 'Recall and assessment', ['text'], 'formative', ['learn', 'play', 'books']],
    ['numeric-answer', 'Recall and assessment', ['text'], 'deterministic', ['learn', 'play', 'books']],
    ['estimate-slider', 'Recall and assessment', ['touch', 'keyboard'], 'deterministic', ['learn', 'play', 'books']],
    ['reveal-card', 'Recall and assessment', ['choice'], 'self-check', ['learn', 'play', 'books']],
    ['ordering', 'Structure and classification', ['choice', 'drag'], 'deterministic', ['learn', 'play', 'books']],
    ['timeline', 'Structure and classification', ['choice', 'drag'], 'deterministic', ['learn', 'play', 'books']],
    ['matching-pairs', 'Structure and classification', ['choice'], 'deterministic', ['learn', 'play', 'books']],
    ['categorisation', 'Structure and classification', ['choice', 'drag'], 'deterministic', ['learn', 'play', 'books']],
    ['table-completion', 'Structure and classification', ['text', 'pen'], 'hybrid', ['learn', 'play', 'books']],
    ['image-sequencing', 'Structure and classification', ['choice', 'drag'], 'deterministic', ['learn', 'play', 'books']],
    ['hotspot', 'Visual and spatial', ['point', 'pen'], 'deterministic', ['learn', 'play', 'books']],
    ['multi-hotspot', 'Visual and spatial', ['point', 'pen'], 'deterministic', ['learn', 'play', 'books']],
    ['diagram-labelling', 'Visual and spatial', ['text', 'choice', 'pen'], 'deterministic', ['learn', 'play', 'books']],
    ['graph-plotting', 'Visual and spatial', ['point', 'pen'], 'deterministic', ['learn', 'play', 'books']],
    ['geometry-construction', 'Visual and spatial', ['pen'], 'hybrid', ['learn', 'play']],
    ['trace-path', 'Visual and spatial', ['pen'], 'deterministic', ['learn', 'play']],
    ['sketch-annotate', 'Visual and spatial', ['pen'], 'formative', ['learn', 'play', 'books']],
    ['visual-reconstruction', 'Visual and spatial', ['pen'], 'formative', ['play']],
    ['mark-and-describe', 'Visual and spatial', ['pen', 'text'], 'hybrid', ['learn', 'play', 'books']],
    ['handwritten-response', 'Pen and expression', ['pen', 'text'], 'formative', ['learn', 'play', 'books']],
    ['logic-grid', 'Games and puzzles', ['choice'], 'deterministic', ['learn', 'play', 'books']],
    ['constraint-grid', 'Games and puzzles', ['text', 'choice'], 'deterministic', ['learn', 'play']],
    ['cipher-code', 'Games and puzzles', ['text'], 'deterministic', ['learn', 'play', 'books']],
    ['crossword', 'Games and puzzles', ['text', 'pen'], 'deterministic', ['learn', 'play']],
    ['word-search', 'Games and puzzles', ['point', 'pen'], 'deterministic', ['learn', 'play']],
    ['memory-pairs', 'Games and puzzles', ['choice'], 'deterministic', ['learn', 'play']],
    ['nonogram', 'Games and puzzles', ['choice'], 'deterministic', ['learn', 'play']],
    ['evidence-board', 'Games and puzzles', ['choice', 'pen'], 'hybrid', ['learn', 'play']],
    ['resource-allocation', 'Games and puzzles', ['choice'], 'deterministic', ['learn', 'play']],
    ['turn-based-grid', 'Games and puzzles', ['choice', 'keyboard'], 'deterministic', ['learn', 'play']],
    ['interactive-scene', 'Scenarios', ['choice', 'point', 'pen'], 'hybrid', ['learn', 'play', 'books']],
    ['progressive-case', 'Scenarios', ['choice', 'text', 'pen'], 'hybrid', ['learn', 'play', 'books']]
  ].map(function (row) {
    return Object.freeze({ kind: row[0], version: 1, title: title(row[0]), family: row[1], inputs: row[2], scoring: row[3], apps: row[4], schemaId: 'https://kalamos.local/schemas/interactions/' + row[0] + '/v1' })
  })

  var BY_KIND = Object.create(null)
  CATALOGUE.forEach(function (row) { BY_KIND[row.kind] = row })

  var FIELDS = {
    'single-choice': ['options', 'answer', 'explanation'], 'multi-select': ['options', 'answers', 'explanation'],
    'true-false-cant-tell': ['answer', 'explanation'], cloze: ['segments', 'answers', 'caseSensitive', 'explanation'],
    'short-answer': ['sampleAnswer', 'rubric'], 'handwritten-response': ['sampleAnswer', 'rubric', 'lines'],
    'numeric-answer': ['answer', 'tolerance', 'unit', 'explanation'], 'estimate-slider': ['min', 'max', 'step', 'answer', 'tolerance', 'unit'],
    'reveal-card': ['front', 'back'], ordering: ['items', 'answer'], timeline: ['items', 'answer'],
    'matching-pairs': ['left', 'right', 'pairs'], categorisation: ['items', 'categories', 'answer'],
    'table-completion': ['columns', 'rows', 'answers', 'rubric'], 'image-sequencing': ['items', 'answer'],
    hotspot: ['asset', 'regions', 'answer'], 'multi-hotspot': ['asset', 'regions', 'answers'],
    'diagram-labelling': ['asset', 'labels', 'targets', 'answer'], 'graph-plotting': ['axes', 'answer', 'tolerance'],
    'geometry-construction': ['asset', 'requirements', 'rubric'], 'trace-path': ['asset', 'path', 'tolerance'],
    'sketch-annotate': ['asset', 'rubric', 'tools'], 'visual-reconstruction': ['asset', 'requirements', 'rubric'], 'mark-and-describe': ['asset', 'targets', 'rubric', 'tools'],
    'logic-grid': ['dimensions', 'clues', 'solution'], 'constraint-grid': ['size', 'givens', 'solution', 'constraints'],
    'cipher-code': ['ciphertext', 'answer', 'hints'], crossword: ['size', 'cells', 'clues', 'solution'],
    'word-search': ['size', 'cells', 'words'], 'memory-pairs': ['cards', 'pairs'], nonogram: ['rows', 'columns', 'solution'],
    'evidence-board': ['evidence', 'claims', 'links', 'rubric'], 'resource-allocation': ['resources', 'choices', 'constraints', 'answer'],
    'turn-based-grid': ['grid', 'actors', 'goals', 'rules', 'turnLimit'], 'interactive-scene': ['scene', 'steps', 'answer', 'rubric'],
    'progressive-case': ['stages', 'rubric']
  }
  var COMMON_FIELDS = ['schema', 'kind', 'version', 'id', 'title', 'prompt', 'instructions', 'maxScore', 'feedback', 'assets', 'tags', 'metadata']

  function title(value) { return value.split('-').map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1) }).join(' ') }
  function fail(message) { throw new Error(message) }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)) }
  function object(value, at) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at + ' must be an object'); return value }
  function array(value, at, min, max) { if (!Array.isArray(value) || value.length < (min || 0) || value.length > (max == null ? 200 : max)) fail(at + ' has invalid length'); return value }
  function string(value, at, max, allowEmpty) {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > (max || 2000)) fail(at + ' must be bounded text')
    if (/<\s*(?:script|iframe|object|embed|style|link|foreignObject)\b|(?:javascript|data|file):/i.test(value)) fail(at + ' contains executable or external content')
    return value.trim()
  }
  function identifier(value, at) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value)) fail(at + ' must be a safe identifier'); return value }
  function number(value, at, min, max) { if (typeof value !== 'number' || !isFinite(value) || value < min || value > max) fail(at + ' is outside its allowed range'); return value }
  function exact(value, allowed, at) { object(value, at); Object.keys(value).forEach(function (key) { if (allowed.indexOf(key) < 0) fail(at + ' has unsupported field "' + key + '"') }) }
  function uniqueIds(rows, at) {
    var seen = Object.create(null)
    rows.forEach(function (row, i) { object(row, at + '[' + i + ']'); var clean = identifier(row.id, at + '[' + i + '].id'); if (seen[clean]) fail(at + ' contains duplicate id ' + clean); seen[clean] = true })
    return seen
  }
  function normalized(value, at) { return number(value, at, 0, 1) }

  function listTemplateManifests(context, capabilities) {
    context = context || {}; capabilities = capabilities || {}
    return CATALOGUE.filter(function (row) {
      if (context.app && row.apps.indexOf(context.app) < 0) return false
      if (capabilities.pen === false && row.inputs.indexOf('pen') >= 0 && row.inputs.length === 1) return false
      return true
    }).map(clone)
  }

  function schemaFor(kind) {
    var manifest = BY_KIND[kind]
    if (!manifest) fail('Unknown interaction kind ' + kind)
    var properties = {
      schema: { const: DEFINITION_SCHEMA }, kind: { const: kind }, version: { const: 1 }, id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$' },
      title: { type: 'string', maxLength: 160 }, prompt: { type: 'string', minLength: 1, maxLength: 2000 }, instructions: { type: 'string', maxLength: 1200 },
      maxScore: { type: 'number', minimum: 0, maximum: 1000 }, feedback: { type: 'object' }, assets: { type: 'array', maxItems: 24 }, tags: { type: 'array', maxItems: 20 }, metadata: { type: 'object' }
    }
    var specific = fieldSchemas(kind); Object.keys(specific.properties).forEach(function (field) { properties[field] = specific.properties[field] })
    return { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: manifest.schemaId, title: manifest.title, description: specific.description,
      type: 'object', required: ['schema', 'kind', 'version', 'id', 'prompt'].concat(specific.required), properties: properties, unevaluatedProperties: false }
  }

  function fieldSchemas(kind) {
    var idSchema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$' }
    var option = { type: 'object', required: ['id', 'label'], properties: { id: idSchema, label: { type: 'string', maxLength: 400 }, value: {}, assetId: idSchema }, additionalProperties: false }
    var options = { type: 'array', minItems: 2, maxItems: 24, items: option }
    var passageOptions = JSON.parse(JSON.stringify(options))
    passageOptions.items.properties.passages = { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 16000 } }
    var ids = { type: 'array', minItems: 1, maxItems: 40, uniqueItems: true, items: idSchema }
    var point = { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } }, additionalProperties: false }
    var region = { type: 'object', required: ['id', 'label', 'shape'], properties: { id: idSchema, label: { type: 'string', maxLength: 200 }, shape: { enum: ['point', 'circle', 'rectangle', 'triangle', 'polygon', 'arrow'] }, x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 }, width: { type: 'number', minimum: 0, maximum: 1 }, height: { type: 'number', minimum: 0, maximum: 1 }, points: { type: 'array', minItems: 2, maxItems: 100, items: point }, frame: { type: 'integer', minimum: 0 }, time: { type: 'number', minimum: 0 } }, additionalProperties: false }
    var asset = { type: 'object', required: ['schema', 'id', 'kind', 'mime', 'sha256'], properties: { schema: { const: ASSET_SCHEMA }, id: idSchema, kind: { enum: ['raster', 'svg', 'text', 'table', 'waveform', 'medical-image'] }, mime: { enum: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'text/plain', 'text/markdown', 'text/csv', 'application/json'] }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, frames: { type: 'integer', minimum: 1 }, sampleRate: { type: 'number', exclusiveMinimum: 0 }, origin: { type: 'string', maxLength: 500 }, attribution: { type: 'string', maxLength: 500 }, alt: { type: 'string', maxLength: 500 } }, additionalProperties: false }
    var text = { type: 'string', maxLength: 4000 }, numberSchema = { type: 'number' }, props = {}, required = [], description = 'A closed, locally validated ' + kind + ' interaction.'
    function use(fields) { fields.forEach(function (field) { required.push(field) }) }
    if (kind === 'single-choice') { props = { options: passageOptions, answer: idSchema, explanation: text }; use(['options', 'answer']) }
    else if (kind === 'multi-select') { props = { options: passageOptions, answers: ids, explanation: text }; use(['options', 'answers']) }
    else if (kind === 'true-false-cant-tell') { props = { answer: { enum: ['true', 'false', 'cant-tell'] }, explanation: text }; use(['answer']) }
    else if (kind === 'cloze') { props = { segments: { type: 'array', items: text }, answers: { type: 'array', items: text }, caseSensitive: { type: 'boolean' }, explanation: text }; use(['segments', 'answers']) }
    else if (kind === 'short-answer' || kind === 'handwritten-response') { props = { sampleAnswer: text, rubric: text, lines: { type: 'integer', minimum: 1, maximum: 30 } }; use(['rubric']) }
    else if (kind === 'numeric-answer') { props = { answer: numberSchema, tolerance: { type: 'number', minimum: 0 }, unit: text, explanation: text }; use(['answer']) }
    else if (kind === 'estimate-slider') { props = { min: numberSchema, max: numberSchema, step: { type: 'number', exclusiveMinimum: 0 }, answer: numberSchema, tolerance: { type: 'number', minimum: 0 }, unit: text }; use(['min', 'max', 'answer']) }
    else if (kind === 'reveal-card') { props = { front: text, back: text }; use(['front', 'back']) }
    else if (['ordering', 'timeline', 'image-sequencing'].indexOf(kind) >= 0) { props = { items: options, answer: ids }; use(['items', 'answer']) }
    else if (kind === 'matching-pairs') { props = { left: options, right: options, pairs: { type: 'array', items: { type: 'object', required: ['left', 'right'], properties: { left: idSchema, right: idSchema }, additionalProperties: false } } }; use(['left', 'right', 'pairs']) }
    else if (kind === 'categorisation') { props = { items: options, categories: options, answer: { type: 'object', additionalProperties: idSchema } }; use(['items', 'categories', 'answer']) }
    else if (kind === 'table-completion') { props = { columns: { type: 'array', items: text }, rows: { type: 'array', items: { type: 'array', items: text } }, answers: { type: 'object' }, rubric: text }; use(['columns', 'rows', 'answers']) }
    else if (kind === 'hotspot' || kind === 'multi-hotspot') { props = { asset: asset, regions: { type: 'array', minItems: 1, maxItems: 40, items: region } }; props[kind === 'hotspot' ? 'answer' : 'answers'] = kind === 'hotspot' ? idSchema : ids; use(['asset', 'regions', kind === 'hotspot' ? 'answer' : 'answers']) }
    else if (kind === 'diagram-labelling') { props = { asset: asset, labels: options, targets: { type: 'array', items: region }, answer: { type: 'object', additionalProperties: idSchema } }; use(['asset', 'labels', 'targets', 'answer']) }
    else if (kind === 'graph-plotting') { props = { axes: { type: 'object', properties: { xLabel: text, yLabel: text, xMin: numberSchema, xMax: numberSchema, yMin: numberSchema, yMax: numberSchema, grid: { type: 'boolean' } }, additionalProperties: false }, answer: { type: 'array', items: point }, tolerance: { type: 'number', minimum: 0, maximum: 1 } }; use(['axes', 'answer']) }
    else if (kind === 'geometry-construction') { props = { asset: asset, requirements: { type: 'array', items: text }, rubric: text }; use(['requirements', 'rubric']) }
    else if (kind === 'trace-path') { props = { asset: asset, path: { type: 'array', minItems: 2, items: point }, tolerance: { type: 'number', minimum: 0, maximum: 1 } }; use(['path', 'tolerance']) }
    else if (kind === 'sketch-annotate') { props = { asset: asset, rubric: text, tools: { type: 'array', items: { enum: ['pen', 'circle', 'rectangle', 'triangle', 'arrow', 'eraser'] } } }; use(['rubric']) }
    else if (kind === 'visual-reconstruction') { props = { asset: asset, requirements: { type: 'array', minItems: 1, maxItems: 12, items: text }, rubric: text }; use(['asset', 'requirements', 'rubric']) }
    else if (kind === 'mark-and-describe') { props = { asset: asset, targets: { type: 'array', items: region }, rubric: text, tools: { type: 'array', items: { enum: ['pen', 'circle', 'rectangle', 'triangle', 'arrow', 'eraser'] } } }; use(['asset', 'targets', 'rubric']) }
    else if (kind === 'logic-grid') { props = { dimensions: { type: 'array', minItems: 2, items: options }, clues: { type: 'array', minItems: 1, items: text }, solution: { type: 'object' } }; use(['dimensions', 'clues', 'solution']) }
    else if (kind === 'constraint-grid') { props = { size: { type: 'integer', minimum: 2, maximum: 9 }, givens: { type: 'array', items: { type: 'object', required: ['x', 'y', 'value'], properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, value: { type: 'integer', minimum: 1 } }, additionalProperties: false } }, solution: { type: 'array', items: { type: 'array', items: { type: 'integer' } } }, constraints: { type: 'array', items: { type: 'object' } } }; use(['size', 'givens', 'solution', 'constraints']) }
    else if (kind === 'cipher-code') { props = { ciphertext: text, answer: text, hints: { type: 'array', items: text } }; use(['ciphertext', 'answer']) }
    else if (kind === 'crossword') { props = { size: { type: 'integer', minimum: 2, maximum: 30 }, cells: { type: 'array' }, clues: { type: 'array', items: { type: 'object' } }, solution: { type: 'array' } }; use(['size', 'cells', 'clues', 'solution']) }
    else if (kind === 'word-search') { props = { size: { type: 'integer', minimum: 2, maximum: 30 }, cells: { type: 'array' }, words: { type: 'array', items: text } }; use(['size', 'cells', 'words']) }
    else if (kind === 'memory-pairs') { props = { cards: options, pairs: { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2, items: idSchema } } }; use(['cards', 'pairs']) }
    else if (kind === 'nonogram') { props = { rows: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 1 } } }, columns: { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 1 } } }, solution: { type: 'array', items: { type: 'array', items: { enum: [0, 1] } } } }; use(['rows', 'columns', 'solution']) }
    else if (kind === 'evidence-board') { props = { evidence: Object.assign({}, options, { minItems: 1, maxItems: 40 }), claims: Object.assign({}, options, { minItems: 1, maxItems: 20 }), links: { type: 'array', items: { type: 'object', required: ['evidence', 'claim'], properties: { evidence: idSchema, claim: idSchema }, additionalProperties: false } }, rubric: text }; use(['evidence', 'claims', 'links', 'rubric']) }
    else if (kind === 'resource-allocation') { props = { resources: { type: 'array', items: { type: 'object' } }, choices: options, constraints: { type: 'array', items: { type: 'object' } }, answer: { type: 'object' } }; use(['resources', 'choices', 'constraints', 'answer']) }
    else if (kind === 'turn-based-grid') { props = { grid: { type: 'array', items: { type: 'array' } }, actors: { type: 'array', items: { type: 'object' } }, goals: { type: 'array', items: { type: 'object' } }, rules: { type: 'array', items: { type: 'object' } }, turnLimit: { type: 'integer', minimum: 1, maximum: 500 } }; use(['grid', 'actors', 'goals', 'rules', 'turnLimit']) }
    else if (kind === 'interactive-scene') { props = { scene: { type: 'object', required: ['width', 'height', 'objects'], properties: { width: { type: 'number', minimum: 1, maximum: 4096 }, height: { type: 'number', minimum: 1, maximum: 4096 }, backgroundAssetId: idSchema, objects: { type: 'array', maxItems: 64, items: { type: 'object' } } }, additionalProperties: false }, steps: { type: 'array', maxItems: 30, items: { type: 'object' } }, answer: {}, rubric: text }; use(['scene', 'steps']) }
    else if (kind === 'progressive-case') { props = { stages: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', required: ['id', 'prompt'], properties: { id: idSchema, title: text, body: text, prompt: text, options: options, answer: idSchema, rubric: text }, additionalProperties: false } }, rubric: text }; use(['stages']) }
    return { properties: props, required: required, description: description }
  }

  function optionRows(value, at, min, max, allowPassages) {
    var rows = array(value, at, min, max); var ids = uniqueIds(rows, at)
    rows.forEach(function (row, i) { exact(row, ['id', 'label', 'value', 'assetId'].concat(allowPassages ? ['passages'] : []), at + '[' + i + ']'); string(row.label, at + '[' + i + '].label', 400); if (row.passages != null) array(row.passages, at + '[' + i + '].passages', 1, 16).forEach(function (passage, j) { if (typeof passage !== 'string' || !passage.trim() || passage.length > 16000) fail(at + '[' + i + '].passages[' + j + '] must be bounded text') }) })
    return ids
  }
  function validateAssetRef(value, at) {
    at = at || 'Asset'; exact(value, ['schema', 'id', 'kind', 'mime', 'sha256', 'width', 'height', 'frames', 'sampleRate', 'origin', 'attribution', 'alt'], at)
    if (value.schema !== ASSET_SCHEMA) fail(at + '.schema is unsupported')
    identifier(value.id, at + '.id')
    if (['raster', 'svg', 'text', 'table', 'waveform', 'medical-image'].indexOf(value.kind) < 0) fail(at + '.kind is unsupported')
    if (!/^(?:image\/(?:png|jpeg|webp|svg\+xml)|text\/(?:plain|markdown|csv)|application\/json)$/.test(value.mime || '')) fail(at + '.mime is unsupported')
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail(at + '.sha256 is invalid')
    if (value.width != null) number(value.width, at + '.width', 1, 20000)
    if (value.height != null) number(value.height, at + '.height', 1, 20000)
    if (value.frames != null) number(value.frames, at + '.frames', 1, 10000)
    if (value.sampleRate != null) number(value.sampleRate, at + '.sampleRate', 0.001, 1000000)
    if (value.origin != null) string(value.origin, at + '.origin', 500, true)
    if (value.attribution != null) string(value.attribution, at + '.attribution', 500, true)
    if (value.alt != null) string(value.alt, at + '.alt', 500, true)
    return clone(value)
  }
  function validateRegion(row, at) {
    exact(row, ['id', 'label', 'shape', 'x', 'y', 'width', 'height', 'points', 'frame', 'time'], at); identifier(row.id, at + '.id'); string(row.label || row.id, at + '.label', 200)
    if (['point', 'circle', 'rectangle', 'triangle', 'polygon', 'arrow'].indexOf(row.shape || 'rectangle') < 0) fail(at + '.shape is unsupported')
    if (row.x != null) normalized(row.x, at + '.x'); if (row.y != null) normalized(row.y, at + '.y')
    if (row.width != null) number(row.width, at + '.width', 0, 1); if (row.height != null) number(row.height, at + '.height', 0, 1)
    if (row.points != null) array(row.points, at + '.points', 2, 100).forEach(function (point, i) { normalized(point.x, at + '.points[' + i + '].x'); normalized(point.y, at + '.points[' + i + '].y') })
  }

  function validateDefinition(raw) {
    object(raw, 'Interaction')
    if (raw.schema !== DEFINITION_SCHEMA) fail('Interaction.schema is unsupported')
    if (!BY_KIND[raw.kind]) fail('Interaction.kind is unsupported')
    if (raw.version !== 1) fail('Interaction.version is unsupported')
    exact(raw, COMMON_FIELDS.concat(FIELDS[raw.kind] || []), 'Interaction')
    identifier(raw.id, 'Interaction.id'); string(raw.prompt, 'Interaction.prompt', 2000)
    if (raw.title != null) string(raw.title, 'Interaction.title', 160, true)
    if (raw.instructions != null) string(raw.instructions, 'Interaction.instructions', 1200, true)
    if (raw.maxScore != null) number(raw.maxScore, 'Interaction.maxScore', 0, 1000)
    if (raw.assets != null) array(raw.assets, 'Interaction.assets', 0, 24).forEach(function (asset, i) { validateAssetRef(asset, 'Interaction.assets[' + i + ']') })
    var known, answer
    if (['single-choice', 'multi-select'].indexOf(raw.kind) >= 0) {
      known = optionRows(raw.options, 'Interaction.options', 2, 12, true)
      answer = raw.kind === 'single-choice' ? [identifier(raw.answer, 'Interaction.answer')] : array(raw.answers, 'Interaction.answers', 1, raw.options.length).map(function (id, i) { return identifier(id, 'Interaction.answers[' + i + ']') })
      answer.forEach(function (id) { if (!known[id]) fail('Interaction answer references an unknown option') })
    } else if (raw.kind === 'true-false-cant-tell') {
      if (['true', 'false', 'cant-tell'].indexOf(raw.answer) < 0) fail('Interaction.answer is invalid')
    } else if (['ordering', 'timeline', 'image-sequencing'].indexOf(raw.kind) >= 0) {
      known = optionRows(raw.items, 'Interaction.items', 2, 24); answer = array(raw.answer, 'Interaction.answer', raw.items.length, raw.items.length)
      if (new Set(answer).size !== raw.items.length || answer.some(function (id) { return !known[id] })) fail('Interaction.answer must be a permutation of item ids')
    } else if (raw.kind === 'matching-pairs') {
      var left = optionRows(raw.left, 'Interaction.left', 2, 20), right = optionRows(raw.right, 'Interaction.right', 2, 20)
      array(raw.pairs, 'Interaction.pairs', raw.left.length, raw.left.length).forEach(function (pair, i) {
        exact(pair, ['left', 'right'], 'Interaction.pairs[' + i + ']'); if (!left[pair.left] || !right[pair.right]) fail('Interaction.pairs references an unknown item')
      })
    } else if (raw.kind === 'categorisation') {
      known = optionRows(raw.items, 'Interaction.items', 2, 40); var categories = optionRows(raw.categories, 'Interaction.categories', 2, 12)
      object(raw.answer, 'Interaction.answer'); Object.keys(raw.answer).forEach(function (item) { if (!known[item] || !categories[raw.answer[item]]) fail('Interaction.answer references an unknown item or category') })
    } else if (raw.kind === 'evidence-board') {
      var evidenceIds = optionRows(raw.evidence, 'Interaction.evidence', 1, 40), claimIds = optionRows(raw.claims, 'Interaction.claims', 1, 20), linkIds = new Set()
      array(raw.links, 'Interaction.links', 1, 100).forEach(function (link, i) {
        exact(link, ['evidence', 'claim'], 'Interaction.links[' + i + ']')
        if (!evidenceIds[link.evidence] || !claimIds[link.claim]) fail('Interaction.links references an unknown evidence item or claim')
        var key = link.evidence + '\u0000' + link.claim
        if (linkIds.has(key)) fail('Interaction.links contains a duplicate pair')
        linkIds.add(key)
      })
    } else if (raw.kind === 'diagram-labelling') {
      var labels = optionRows(raw.labels, 'Interaction.labels', 2, 40), targets = Object.create(null)
      array(raw.targets, 'Interaction.targets', 1, 40).forEach(function (target, i) { validateRegion(target, 'Interaction.targets[' + i + ']'); if (targets[target.id]) fail('Interaction.targets contains duplicate ids'); targets[target.id] = true })
      object(raw.answer, 'Interaction.answer'); var targetIds = Object.keys(targets), answerIds = Object.keys(raw.answer)
      if (answerIds.length !== targetIds.length || answerIds.some(function (targetId) { return !targets[targetId] || !labels[identifier(raw.answer[targetId], 'Interaction.answer.' + targetId)] })) fail('Interaction.answer must map every target to a known label')
    } else if (['hotspot', 'multi-hotspot'].indexOf(raw.kind) >= 0) {
      known = Object.create(null); array(raw.regions, 'Interaction.regions', 1, 40).forEach(function (region, i) { validateRegion(region, 'Interaction.regions[' + i + ']'); if (known[region.id]) fail('Interaction.regions contains duplicate ids'); known[region.id] = true })
      answer = raw.kind === 'hotspot' ? [raw.answer] : raw.answers; array(answer, 'Interaction.answers', 1, raw.regions.length).forEach(function (id) { if (!known[id]) fail('Interaction answer references an unknown region') })
    } else if (raw.kind === 'numeric-answer') {
      number(raw.answer, 'Interaction.answer', -1e12, 1e12); number(raw.tolerance == null ? 0 : raw.tolerance, 'Interaction.tolerance', 0, 1e9)
    } else if (raw.kind === 'estimate-slider') {
      number(raw.min, 'Interaction.min', -1e12, 1e12); number(raw.max, 'Interaction.max', raw.min, 1e12); number(raw.answer, 'Interaction.answer', raw.min, raw.max)
    } else if (raw.kind === 'graph-plotting') {
      object(raw.axes, 'Interaction.axes'); exact(raw.axes, ['xLabel', 'yLabel', 'xMin', 'xMax', 'yMin', 'yMax', 'grid'], 'Interaction.axes')
      if (raw.axes.xLabel != null) string(raw.axes.xLabel, 'Interaction.axes.xLabel', 120, true); if (raw.axes.yLabel != null) string(raw.axes.yLabel, 'Interaction.axes.yLabel', 120, true)
      ;['xMin', 'xMax', 'yMin', 'yMax'].forEach(function (field) { if (raw.axes[field] != null) number(raw.axes[field], 'Interaction.axes.' + field, -1e12, 1e12) })
      if (raw.axes.xMin != null && raw.axes.xMax != null && raw.axes.xMax <= raw.axes.xMin) fail('Interaction.axes.xMax must be greater than xMin')
      if (raw.axes.yMin != null && raw.axes.yMax != null && raw.axes.yMax <= raw.axes.yMin) fail('Interaction.axes.yMax must be greater than yMin')
      if (raw.axes.grid != null && typeof raw.axes.grid !== 'boolean') fail('Interaction.axes.grid must be boolean')
      array(raw.answer, 'Interaction.answer', 1, 100).forEach(function (point, i) { validateSimplePoint(point, 'Interaction.answer[' + i + ']') }); number(raw.tolerance == null ? .04 : raw.tolerance, 'Interaction.tolerance', 0, 1)
    } else if (raw.kind === 'trace-path') {
      array(raw.path, 'Interaction.path', 2, 500).forEach(function (point, i) { validateSimplePoint(point, 'Interaction.path[' + i + ']') }); number(raw.tolerance, 'Interaction.tolerance', 0, 1)
    } else if (raw.kind === 'visual-reconstruction') {
      validateAssetRef(raw.asset, 'Interaction.asset')
      if (raw.asset.kind !== 'svg' && raw.asset.kind !== 'raster') fail('Interaction.asset must be a visual image')
      array(raw.requirements, 'Interaction.requirements', 1, 12).forEach(function (item, i) { string(item, 'Interaction.requirements[' + i + ']', 300) })
      string(raw.rubric, 'Interaction.rubric', 4000)
    } else if (raw.kind === 'constraint-grid') validateConstraintGrid(raw)
    else if (raw.kind === 'nonogram') validateBinaryGrid(raw.solution, raw.rows.length, raw.columns.length, 'Interaction.solution')
    else if (raw.kind === 'interactive-scene') validateScene(raw.scene, raw.steps || [])
    else if (raw.kind === 'progressive-case') array(raw.stages, 'Interaction.stages', 1, 20).forEach(function (stage, i) {
      var at = 'Interaction.stages[' + i + ']'; exact(stage, ['id', 'title', 'body', 'prompt', 'options', 'answer', 'rubric'], at); identifier(stage.id, at + '.id'); string(stage.prompt, at + '.prompt', 1000)
      if (stage.options != null) { var stageOptions = optionRows(stage.options, at + '.options', 2, 12); if (stage.answer != null && !stageOptions[identifier(stage.answer, at + '.answer')]) fail(at + '.answer references an unknown option') }
      else if (stage.answer != null) fail(at + '.answer requires options')
      if (stage.rubric != null) string(stage.rubric, at + '.rubric', 4000)
    })
    if (raw.asset) validateAssetRef(raw.asset, 'Interaction.asset')
    return deepFreeze(clone(raw))
  }
  function validateSimplePoint(point, at) { exact(point, ['x', 'y'], at); normalized(point.x, at + '.x'); normalized(point.y, at + '.y') }

  function validateBinaryGrid(grid, rows, columns, at) {
    array(grid, at, rows, rows).forEach(function (row, y) { array(row, at + '[' + y + ']', columns, columns).forEach(function (cell) { if (cell !== 0 && cell !== 1) fail(at + ' must contain only zero and one') }) })
  }
  function validateConstraintGrid(raw) {
    if (!Number.isInteger(raw.size) || raw.size < 2 || raw.size > 9) fail('Interaction.size is invalid')
    array(raw.solution, 'Interaction.solution', raw.size, raw.size).forEach(function (row, y) {
      array(row, 'Interaction.solution[' + y + ']', raw.size, raw.size)
      var values = new Set(row); if (values.size !== raw.size || row.some(function (v) { return !Number.isInteger(v) || v < 1 || v > raw.size })) fail('Each solution row must be a permutation')
    })
    for (var x = 0; x < raw.size; x += 1) { var column = new Set(); for (var y = 0; y < raw.size; y += 1) column.add(raw.solution[y][x]); if (column.size !== raw.size) fail('Each solution column must be a permutation') }
    var puzzle = Array.from({ length: raw.size }, function () { return Array(raw.size).fill(0) })
    array(raw.givens || [], 'Interaction.givens', 0, raw.size * raw.size).forEach(function (given, i) {
      exact(given, ['x', 'y', 'value'], 'Interaction.givens[' + i + ']'); if (!Number.isInteger(given.x) || !Number.isInteger(given.y) || given.x < 0 || given.y < 0 || given.x >= raw.size || given.y >= raw.size || raw.solution[given.y][given.x] !== given.value) fail('Interaction.givens conflicts with solution')
      if (puzzle[given.y][given.x]) fail('Interaction.givens contains duplicate coordinates'); puzzle[given.y][given.x] = given.value
    })
    if (countLatinSolutions(puzzle, raw.size, 2) !== 1) fail('Interaction constraint grid must have exactly one solution')
  }
  function countLatinSolutions(grid, size, limit) {
    var found = 0
    function visit(index) {
      if (found >= limit) return
      if (index === size * size) { found += 1; return }
      var y = Math.floor(index / size), x = index % size
      if (grid[y][x]) { visit(index + 1); return }
      for (var value = 1; value <= size; value += 1) {
        var used = false
        for (var i = 0; i < size; i += 1) if (grid[y][i] === value || grid[i][x] === value) { used = true; break }
        if (!used) { grid[y][x] = value; visit(index + 1); grid[y][x] = 0 }
      }
    }
    visit(0); return found
  }
  function validateScene(scene, steps) {
    object(scene, 'Interaction.scene'); exact(scene, ['width', 'height', 'objects', 'backgroundAssetId'], 'Interaction.scene')
    number(scene.width, 'Interaction.scene.width', 1, 4096); number(scene.height, 'Interaction.scene.height', 1, 4096)
    var ids = uniqueIds(array(scene.objects, 'Interaction.scene.objects', 0, 64), 'Interaction.scene.objects')
    scene.objects.forEach(function (item, i) { if (['rect', 'circle', 'ellipse', 'line', 'arrow', 'label', 'figure', 'point', 'polyline', 'polygon', 'tile-grid'].indexOf(item.type) < 0) fail('Interaction.scene.objects[' + i + '].type is unsupported') })
    array(steps, 'Interaction.steps', 0, 30).forEach(function (step, i) {
      object(step, 'Interaction.steps[' + i + ']'); number(step.durationMs == null ? 0 : step.durationMs, 'Interaction.steps[' + i + '].durationMs', 0, 8000)
      array(step.commands || [], 'Interaction.steps[' + i + '].commands', 0, 64).forEach(function (command) {
        if (!ids[command.target] || ['show', 'hide', 'move', 'rotate', 'scale', 'opacity', 'emphasize', 'set-state'].indexOf(command.action) < 0) fail('Scene command is invalid')
      })
    })
  }
  function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.keys(value).forEach(function (key) { deepFreeze(value[key]) }) } return value }

  function createAttempt(definition) {
    var clean = validateDefinition(definition)
    return { schema: RESPONSE_SCHEMA, definitionId: clean.id, kind: clean.kind, version: 1, status: 'open', response: {}, strokes: null, deterministicScore: null, aiReview: null, reviewHistory: [], actions: [], updatedAt: new Date().toISOString() }
  }
  function reduceAttempt(attempt, action) {
    object(attempt, 'Attempt'); object(action, 'Action'); var next = clone(attempt)
    if (attempt.schema !== RESPONSE_SCHEMA || attempt.status === 'accepted') fail('Attempt cannot be changed')
    if (action.type === 'select') next.response.selected = action.id
    else if (action.type === 'toggle') { var selected = next.response.selected || []; next.response.selected = selected.indexOf(action.id) < 0 ? selected.concat(action.id) : selected.filter(function (id) { return id !== action.id }) }
    else if (action.type === 'text') next.response.text = string(String(action.text || ''), 'Action.text', 12000, true)
    else if (action.type === 'number') next.response.number = number(Number(action.value), 'Action.value', -1e12, 1e12)
    else if (action.type === 'order') next.response.order = array(action.ids, 'Action.ids', 1, 100).map(function (id) { return identifier(id, 'Action.id') })
    else if (action.type === 'point') next.response.points = (next.response.points || []).concat([{ x: normalized(action.x, 'Action.x'), y: normalized(action.y, 'Action.y'), regionId: action.regionId || '' }]).slice(-100)
    else if (action.type === 'points') next.response.points = array(action.points || [], 'Action.points', 0, 1000).map(function (point, i) { return { x: normalized(point.x, 'Action.points[' + i + '].x'), y: normalized(point.y, 'Action.points[' + i + '].y'), regionId: point.regionId ? identifier(point.regionId, 'Action.points[' + i + '].regionId') : '' } })
    else if (action.type === 'cells') next.response.cells = clone(action.cells)
    else if (action.type === 'pairs') next.response.pairs = clone(action.pairs)
    else if (action.type === 'mapping') next.response.mapping = clone(action.mapping)
    else if (action.type === 'progress-stage') {
      if (!Number.isInteger(action.stage) || !Number.isInteger(action.nextStage) || action.stage < 0 || action.nextStage < action.stage) fail('Progress stage is invalid')
      next.response.stageAnswers = next.response.stageAnswers || {}; next.response.stageAnswers[String(action.stage)] = { selected: String(action.selected || ''), text: String(action.text || ''), correct: action.correct == null ? null : !!action.correct }
      next.response.lastStageResult = { stage: action.stage, correct: action.correct == null ? null : !!action.correct }; next.response.stage = action.nextStage; next.response.complete = !!action.complete; next.response.selected = ''; next.response.text = ''
    }
    else if (action.type === 'ink') next.strokes = validateInk(action.ink)
    else if (action.type === 'ai-review') { next.aiReview = validateAiReview(action.review); next.reviewHistory.push(next.aiReview); next.status = 'reviewed' }
    else if (action.type === 'accept-review') { if (!next.aiReview) fail('There is no AI review to accept'); next.status = 'accepted' }
    else if (action.type === 'override-review') { if (!next.aiReview) fail('There is no AI review to override'); next.reviewHistory.push({ schema: REVIEW_SCHEMA, status: 'overridden', score: number(action.score, 'Action.score', 0, next.aiReview.maxScore), reason: string(action.reason || 'Learner override', 'Action.reason', 500), at: new Date().toISOString() }); next.status = 'accepted' }
    else fail('Action.type is unsupported')
    next.actions.push({ type: action.type, at: new Date().toISOString() }); next.updatedAt = new Date().toISOString(); return next
  }

  function scoreAttempt(definition, attempt) {
    var d = validateDefinition(definition), r = attempt.response || {}, max = d.maxScore == null ? 1 : d.maxScore, correct = false, partial = 0
    if (d.kind === 'single-choice' || d.kind === 'true-false-cant-tell') correct = r.selected === d.answer
    else if (d.kind === 'multi-select') correct = sameSet(r.selected || [], d.answers)
    else if (['ordering', 'timeline', 'image-sequencing'].indexOf(d.kind) >= 0) correct = sameArray(r.order || [], d.answer)
    else if (d.kind === 'numeric-answer' || d.kind === 'estimate-slider') correct = Math.abs(Number(r.number) - d.answer) <= (d.tolerance || 0)
    else if (d.kind === 'hotspot') correct = !!(r.points || []).some(function (point) { return point.regionId === d.answer })
    else if (d.kind === 'multi-hotspot') { var hits = (r.points || []).map(function (p) { return p.regionId }).filter(Boolean); correct = sameSet(hits, d.answers); partial = d.answers.length ? intersection(hits, d.answers) / d.answers.length : 0 }
    else if (d.kind === 'graph-plotting') {
      var responsePointCount = (r.points || []).length, plotted = (r.points || []).slice(), tolerance = d.tolerance == null ? .04 : d.tolerance, matched = 0
      ;(d.answer || []).forEach(function (expected) { var index = plotted.findIndex(function (point) { return Math.hypot(point.x - expected.x, point.y - expected.y) <= tolerance }); if (index >= 0) { matched += 1; plotted.splice(index, 1) } })
      partial = d.answer.length ? matched / Math.max(d.answer.length, responsePointCount) : 0; correct = matched === d.answer.length && plotted.length === 0
    }
    else if (d.kind === 'trace-path') {
      var drawn = Object.prototype.hasOwnProperty.call(r, 'points') ? (r.points || []) : ((attempt.strokes || {}).strokes || []).filter(function (stroke) { return stroke.color !== '#ffffff' }).flatMap(function (stroke) { return stroke.points || [] }), path = d.path || [], traceTolerance = d.tolerance == null ? .04 : d.tolerance
      function segmentDistance(point, a, b) { var dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0; return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) }
      function pathDistance(point, rows) { var best = Infinity; for (var i = 1; i < rows.length; i += 1) best = Math.min(best, segmentDistance(point, rows[i - 1], rows[i])); return best }
      var closeness = drawn.length ? drawn.filter(function (point) { return pathDistance(point, path) <= traceTolerance }).length / drawn.length : 0, coverage = path.length && drawn.length ? path.filter(function (point) { return drawn.some(function (sample) { return Math.hypot(point.x - sample.x, point.y - sample.y) <= traceTolerance * 1.5 }) }).length / path.length : 0
      partial = (closeness + coverage) / 2; correct = closeness >= .8 && coverage >= .8
    }
    else if (d.kind === 'matching-pairs' || d.kind === 'memory-pairs') correct = samePairs(r.pairs || [], (d.pairs || []).map(function (p) { return Array.isArray(p) ? { left: p[0], right: p[1] } : p }))
    else if (d.kind === 'evidence-board') {
      var expectedLinks = d.links.map(function (link) { return link.evidence + '\u0000' + link.claim }), actualLinks = (r.pairs || []).map(function (pair) { return pair.left + '\u0000' + pair.right }), expectedSet = new Set(expectedLinks), actualSet = new Set(actualLinks)
      var matchedLinks = Array.from(actualSet).filter(function (key) { return expectedSet.has(key) }).length
      partial = matchedLinks / Math.max(expectedSet.size, actualSet.size, 1)
      correct = expectedSet.size === actualSet.size && matchedLinks === expectedSet.size
    }
    else if (d.kind === 'categorisation' || d.kind === 'diagram-labelling' || d.kind === 'logic-grid' || d.kind === 'resource-allocation') correct = sameObject(r.mapping || parseObject(r.text), d.answer || d.solution)
    else if (['constraint-grid', 'crossword', 'nonogram'].indexOf(d.kind) >= 0) correct = JSON.stringify(r.cells || []) === JSON.stringify(d.solution)
    else if (d.kind === 'cipher-code') correct = normalizeAnswer(r.text) === normalizeAnswer(d.answer)
    else if (d.kind === 'word-search') correct = sameSet(r.selected || [], d.words)
    else if (d.kind === 'turn-based-grid') correct = (d.goals || []).every(function (goal) { var position = (r.cells || {})[goal.actorId]; return position && position.x === goal.x && position.y === goal.y })
    else if (d.kind === 'progressive-case') {
      var stages = d.stages || [], closedStages = stages.filter(function (stage) { return stage.answer != null }), stageAnswers = r.stageAnswers || {}
      if (closedStages.length !== stages.length) return { kind: 'formative', score: null, maxScore: max, correct: null, requiresAiReview: true }
      partial = closedStages.length ? closedStages.filter(function (_stage, index) { return stageAnswers[String(index)] && stageAnswers[String(index)].correct === true }).length / closedStages.length : 0; correct = !!r.complete && partial === 1
    }
    else if (d.kind === 'cloze') { var values = r.values || String(r.text || '').split('|'); partial = d.answers.length ? d.answers.filter(function (answer, i) { return normalizeAnswer(values[i]) === normalizeAnswer(answer) }).length / d.answers.length : 0; correct = partial === 1 }
    else return { kind: 'formative', score: null, maxScore: max, correct: null, requiresAiReview: true }
    return { kind: 'deterministic', score: correct ? max : Math.round(max * partial * 100) / 100, maxScore: max, correct: correct, requiresAiReview: false }
  }
  function sameArray(a, b) { return a.length === b.length && a.every(function (value, i) { return value === b[i] }) }
  function sameSet(a, b) { return new Set(a).size === new Set(b).size && a.every(function (value) { return b.indexOf(value) >= 0 }) }
  function intersection(a, b) { return Array.from(new Set(a)).filter(function (value) { return b.indexOf(value) >= 0 }).length }
  function sameObject(a, b) { var keys = Object.keys(b); return keys.length === Object.keys(a).length && keys.every(function (key) { return a[key] === b[key] }) }
  function samePairs(a, b) { function key(p) { return Array.isArray(p) ? p[0] + ':' + p[1] : p.left + ':' + p.right } return sameSet(a.map(key), b.map(key)) }
  function normalizeAnswer(value) { return String(value == null ? '' : value).trim().toLocaleLowerCase().replace(/\s+/g, ' ') }
  function parseObject(value) { try { var parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch (_) { return {} } }

  function createInk(background) { return { schema: INK_SCHEMA, version: 1, background: background || null, strokes: [], shapes: [], undone: [], updatedAt: new Date().toISOString() } }
  function validatePoint(point, at) {
    exact(point, ['x', 'y', 'pressure', 'tiltX', 'tiltY', 'time'], at); normalized(point.x, at + '.x'); normalized(point.y, at + '.y')
    if (point.pressure != null) normalized(point.pressure, at + '.pressure'); if (point.tiltX != null) number(point.tiltX, at + '.tiltX', -90, 90); if (point.tiltY != null) number(point.tiltY, at + '.tiltY', -90, 90)
  }
  function validateInk(raw) {
    exact(raw, ['schema', 'version', 'background', 'strokes', 'shapes', 'undone', 'updatedAt'], 'Ink'); if (raw.schema !== INK_SCHEMA || raw.version !== 1) fail('Ink schema is unsupported')
    array(raw.strokes, 'Ink.strokes', 0, 1000).forEach(function (stroke, i) { exact(stroke, ['id', 'tool', 'color', 'width', 'points'], 'Ink.strokes[' + i + ']'); identifier(stroke.id, 'Ink stroke id'); if (['pen', 'felt', 'highlighter'].indexOf(stroke.tool) < 0) fail('Ink tool is unsupported'); number(stroke.width, 'Ink stroke width', 0.1, 40); array(stroke.points, 'Ink stroke points', 1, 10000).forEach(function (point, p) { validatePoint(point, 'Ink point ' + p) }) })
    array(raw.shapes, 'Ink.shapes', 0, 500).forEach(function (shape, i) { validateRegion(shape, 'Ink.shapes[' + i + ']') })
    return clone(raw)
  }
  function inkAction(ink, action) {
    var next = clone(ink || createInk()); object(action, 'Ink action'); next.undone = next.undone || []
    if (action.type === 'stroke') {
      var stroke = { id: action.id || randomId('stroke'), tool: action.tool || 'pen', color: action.color || '#111111', width: action.width || 2, points: clone(action.points || []) }
      var candidate = clone(next); candidate.strokes.push(stroke); validateInk(candidate); next = candidate; next.undone = []
    } else if (action.type === 'shape') { var shape = clone(action.shape); if (!shape.id) shape.id = randomId('shape'); validateRegion(shape, 'Ink shape'); next.shapes.push(shape); next.undone = [] }
    else if (action.type === 'erase') {
      var eraserPoints = array(action.points, 'Ink erase points', 1, 10000); eraserPoints.forEach(function (point, i) { validatePoint(point, 'Ink erase point ' + i) }); var radius = action.radius == null ? .035 : number(action.radius, 'Ink erase radius', .001, .25)
      function near(point) { return eraserPoints.some(function (eraser) { return Math.hypot(point.x - eraser.x, point.y - eraser.y) <= radius }) }
      function shapeHit(shape) { if (shape.points && shape.points.some(near)) return true; var left = shape.x || 0, top = shape.y || 0, right = left + (shape.width || 0), bottom = top + (shape.height || 0); return eraserPoints.some(function (point) { return point.x >= left - radius && point.x <= right + radius && point.y >= top - radius && point.y <= bottom + radius }) }
      next.strokes = next.strokes.filter(function (stroke) { return !stroke.points.some(near) }); next.shapes = next.shapes.filter(function (shape) { return !shapeHit(shape) }); next.undone = []
    }
    else if (action.type === 'undo') { var item = next.shapes.length ? { type: 'shape', value: next.shapes.pop() } : next.strokes.length ? { type: 'stroke', value: next.strokes.pop() } : null; if (item) next.undone.push(item) }
    else if (action.type === 'redo') { var restored = next.undone.pop(); if (restored) next[restored.type === 'shape' ? 'shapes' : 'strokes'].push(restored.value) }
    else if (action.type === 'clear') { next.strokes = []; next.shapes = []; next.undone = [] }
    else fail('Ink action is unsupported')
    next.updatedAt = new Date().toISOString(); return next
  }
  function randomId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) }

  function validateAiReview(raw) {
    exact(raw, ['schema', 'status', 'definitionId', 'inputHash', 'model', 'promptVersion', 'score', 'maxScore', 'confidence', 'matchedRubricIds', 'missedClaims', 'incorrectClaims', 'feedback', 'suggestedAnnotations', 'warnings', 'at'], 'AI review')
    if (raw.schema !== REVIEW_SCHEMA || raw.status !== 'provisional') fail('AI review must be provisional')
    identifier(raw.definitionId, 'AI review.definitionId'); if (!/^[a-f0-9]{64}$/.test(raw.inputHash || '')) fail('AI review.inputHash is invalid')
    string(raw.model, 'AI review.model', 120); string(raw.promptVersion, 'AI review.promptVersion', 80); number(raw.maxScore, 'AI review.maxScore', 0, 1000); number(raw.score, 'AI review.score', 0, raw.maxScore); number(raw.confidence, 'AI review.confidence', 0, 1); string(raw.feedback, 'AI review.feedback', 4000)
    array(raw.suggestedAnnotations || [], 'AI review.suggestedAnnotations', 0, 40).forEach(function (region, i) { validateRegion(region, 'AI review.suggestedAnnotations[' + i + ']') })
    return clone(raw)
  }

  function validateScenario(raw) {
    exact(raw, ['schema', 'id', 'title', 'subtitle', 'start', 'variables', 'inventory', 'nodes', 'assets', 'metadata'], 'Scenario')
    if (raw.schema !== SCENARIO_SCHEMA) fail('Scenario.schema is unsupported'); identifier(raw.id, 'Scenario.id'); string(raw.title, 'Scenario.title', 160)
    var scenarioAssets = array(raw.assets || [], 'Scenario.assets', 0, 64), knownAssets = Object.create(null)
    scenarioAssets.forEach(function (asset, i) { var cleanAsset = validateAssetRef(asset, 'Scenario.assets[' + i + ']'); if (knownAssets[cleanAsset.id]) fail('Scenario.assets contains duplicate id ' + cleanAsset.id); knownAssets[cleanAsset.id] = cleanAsset })
    var nodes = array(raw.nodes, 'Scenario.nodes', 2, 120), known = uniqueIds(nodes, 'Scenario.nodes'), start = identifier(raw.start, 'Scenario.start'); if (!known[start]) fail('Scenario.start is missing')
    var byId = Object.create(null)
    nodes.forEach(function (node, i) {
      var at = 'Scenario.nodes[' + i + ']'; exact(node, ['id', 'title', 'readerTitle', 'body', 'readerPreface', 'interaction', 'transitions', 'ending', 'outcome', 'scene', 'sourceRefs', 'illustrationId'], at); if (node.title != null) string(node.title, at + '.title', 160, true); if (node.readerTitle != null) string(node.readerTitle, at + '.readerTitle', 160, true); if (node.body != null) string(node.body, at + '.body', 4000, true); if (node.readerPreface != null) string(node.readerPreface, at + '.readerPreface', 500, true)
      if (node.illustrationId != null) {
        identifier(node.illustrationId, at + '.illustrationId')
        if (!knownAssets[node.illustrationId] || !/^image\//.test(knownAssets[node.illustrationId].mime)) fail(at + '.illustrationId is not an accepted image')
      }
      if (node.sourceRefs != null) {
        var refs = array(node.sourceRefs, at + '.sourceRefs', 1, 12)
        refs.forEach(function (ref, index) { if (typeof ref !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(ref)) fail(at + '.sourceRefs[' + index + '] is invalid') })
        if (new Set(refs).size !== refs.length) fail(at + '.sourceRefs contains duplicates')
      }
      if (node.interaction) validateScenarioDefinition(node.interaction, at + '.interaction', knownAssets); if (node.scene) validateScenarioDefinition(node.scene, at + '.scene', knownAssets)
      array(node.transitions || [], at + '.transitions', 0, 20).forEach(function (transition, t) { validateTransition(transition, at + '.transitions[' + t + ']', known) })
      if (!node.ending && !(node.transitions || []).length) fail(at + ' is a dead end'); byId[node.id] = clone(node)
    })
    var reachable = Object.create(null), queue = [start]
    while (queue.length) { var current = queue.shift(); if (reachable[current]) continue; reachable[current] = true; (byId[current].transitions || []).forEach(function (edge) { queue.push(edge.to) }) }
    if (!Object.keys(byId).some(function (id) { return reachable[id] && byId[id].ending })) fail('Scenario has no reachable ending')
    var unreachable = Object.keys(byId).filter(function (id) { return !reachable[id] }); if (unreachable.length) fail('Scenario has unreachable nodes: ' + unreachable.join(', '))
    return deepFreeze({ schema: SCENARIO_SCHEMA, id: raw.id, title: raw.title, subtitle: raw.subtitle || '', start: start, variables: clone(raw.variables || {}), inventory: clone(raw.inventory || []), nodes: byId, assets: clone(scenarioAssets), metadata: clone(raw.metadata || {}) })
  }
  function validateScenarioDefinition(raw, at, knownAssets) {
    var clean = validateDefinition(raw), refs = (clean.assets || []).concat(clean.asset ? [clean.asset] : [])
    refs.forEach(function (asset) {
      if (!knownAssets[asset.id]) fail(at + ' references an asset missing from Scenario.assets: ' + asset.id)
      if (knownAssets[asset.id].sha256 !== asset.sha256) fail(at + ' changes the content of Scenario asset ' + asset.id)
    })
    if (clean.scene && clean.scene.backgroundAssetId && !knownAssets[clean.scene.backgroundAssetId] && !refs.some(function (asset) { return asset.id === clean.scene.backgroundAssetId })) fail(at + '.scene.backgroundAssetId is missing')
    return clean
  }
  function validateTransition(edge, at, known) {
    exact(edge, ['id', 'label', 'to', 'when', 'effects'], at); identifier(edge.id, at + '.id'); if (!known[edge.to]) fail(at + '.to is missing'); if (edge.label != null) string(edge.label, at + '.label', 240, true)
    if (edge.when) validatePredicate(edge.when, at + '.when', 0); array(edge.effects || [], at + '.effects', 0, 20).forEach(function (effect, i) { validateEffect(effect, at + '.effects[' + i + ']') })
  }
  function validatePredicate(rule, at, depth) {
    if (depth > 4) fail(at + ' is nested too deeply'); object(rule, at)
    if (['eq', 'neq', 'gte', 'lte', 'contains', 'all', 'any', 'not', 'score-gte', 'correct', 'has-flag', 'lacks-flag'].indexOf(rule.op) < 0) fail(at + '.op is unsupported')
    if (rule.op === 'all' || rule.op === 'any') array(rule.rules, at + '.rules', 1, 8).forEach(function (child, i) { validatePredicate(child, at + '.rules[' + i + ']', depth + 1) })
    else if (rule.op === 'not') validatePredicate(rule.rule, at + '.rule', depth + 1)
    else if (rule.key != null) identifier(rule.key, at + '.key')
  }
  function validateEffect(effect, at) { object(effect, at); if (['set', 'increment', 'decrement', 'add-flag', 'remove-flag', 'add-item', 'remove-item'].indexOf(effect.op) < 0) fail(at + '.op is unsupported'); identifier(effect.key || effect.item, at + '.target') }
  function startScenario(scenario) { var s = scenario.nodes ? scenario : validateScenario(scenario); return { schema: 'kalamos.scenario-session/v2', scenarioId: s.id, current: s.start, variables: clone(s.variables), inventory: clone(s.inventory), flags: [], score: 0, history: [], responses: {}, visited: [s.start], complete: !!s.nodes[s.start].ending } }
  function scenarioTransitions(scenario, session, result) { var node = scenario.nodes[session.current]; return (node.transitions || []).filter(function (edge) { return !edge.when || evaluate(edge.when, session, result || {}) }) }
  function advanceScenario(scenario, session, transitionId, result) {
    var choices = scenarioTransitions(scenario, session, result), edge = choices.find(function (row) { return row.id === transitionId }); if (!edge) fail('Transition is not available')
    var next = clone(session), checkpoint = clone(session); checkpoint.history = []; next.history.push(checkpoint); next.responses[session.current] = clone(result || {}); if (result && typeof result.score === 'number') next.score += result.score
    ;(edge.effects || []).forEach(function (effect) { applyEffect(next, effect) }); next.current = edge.to; next.visited.push(edge.to); next.complete = !!scenario.nodes[edge.to].ending; return next
  }
  function backScenario(session) { if (!session.history || !session.history.length) return session; var next = clone(session), previous = next.history.pop(), earlier = next.history; previous.history = earlier; return previous }
  function evaluate(rule, session, result) {
    if (rule.op === 'all') return rule.rules.every(function (r) { return evaluate(r, session, result) }); if (rule.op === 'any') return rule.rules.some(function (r) { return evaluate(r, session, result) }); if (rule.op === 'not') return !evaluate(rule.rule, session, result)
    if (rule.op === 'score-gte') return Number(result.score || 0) >= Number(rule.value || 0); if (rule.op === 'correct') return result.correct === rule.value
    if (rule.op === 'has-flag') return session.flags.indexOf(rule.value) >= 0; if (rule.op === 'lacks-flag') return session.flags.indexOf(rule.value) < 0
    var value = (session.variables || {})[rule.key]; if (rule.op === 'eq') return value === rule.value; if (rule.op === 'neq') return value !== rule.value; if (rule.op === 'gte') return value >= rule.value; if (rule.op === 'lte') return value <= rule.value; if (rule.op === 'contains') return Array.isArray(value) && value.indexOf(rule.value) >= 0; return false
  }
  function applyEffect(session, effect) { if (effect.op === 'set') session.variables[effect.key] = clone(effect.value); else if (effect.op === 'increment') session.variables[effect.key] = Number(session.variables[effect.key] || 0) + Number(effect.value || 1); else if (effect.op === 'decrement') session.variables[effect.key] = Number(session.variables[effect.key] || 0) - Number(effect.value || 1); else { var field = /flag/.test(effect.op) ? 'flags' : 'inventory', value = effect.key || effect.item; if (/^add/.test(effect.op) && session[field].indexOf(value) < 0) session[field].push(value); if (/^remove/.test(effect.op)) session[field] = session[field].filter(function (row) { return row !== value }) } }

  function sanitizeSvg(source) {
    source = String(source || ''); if (source.length > 1000000 || !/^\s*<svg\b/i.test(source)) fail('SVG is invalid')
    if (/<\s*(?:script|foreignObject|iframe|object|embed|audio|video|style|link|animate|set)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|data:|file:|javascript:)|url\s*\(/i.test(source)) fail('SVG contains active or external content')
    return source
  }
  function legacyQuizToDefinition(quiz) {
    if (!quiz) return null
    if (quiz.mode === 'choice') return validateDefinition({ schema: DEFINITION_SCHEMA, kind: 'single-choice', version: 1, id: quiz.id || randomId('interaction'), prompt: quiz.prompt, options: (quiz.options || []).map(function (row) { return { id: row.id, label: row.text } }), answer: quiz.answer, explanation: quiz.explanation || '', maxScore: 1 })
    return validateDefinition({ schema: DEFINITION_SCHEMA, kind: 'short-answer', version: 1, id: quiz.id || randomId('interaction'), prompt: quiz.prompt, sampleAnswer: quiz.answer || '', rubric: quiz.explanation || '', maxScore: 1 })
  }

  return {
    schemas: { definition: DEFINITION_SCHEMA, response: RESPONSE_SCHEMA, scenario: SCENARIO_SCHEMA, ink: INK_SCHEMA, asset: ASSET_SCHEMA, review: REVIEW_SCHEMA },
    catalogue: CATALOGUE.slice(), listTemplateManifests: listTemplateManifests, getTemplateSchema: schemaFor,
    validateDefinition: validateDefinition, validateAssetRef: validateAssetRef, sanitizeSvg: sanitizeSvg,
    createAttempt: createAttempt, reduceAttempt: reduceAttempt, scoreAttempt: scoreAttempt,
    createInk: createInk, validateInk: validateInk, inkAction: inkAction, validateAiReview: validateAiReview,
    validateScenario: validateScenario, startScenario: startScenario, scenarioTransitions: scenarioTransitions, advanceScenario: advanceScenario, backScenario: backScenario,
    legacyQuizToDefinition: legacyQuizToDefinition, clone: clone
  }
})
