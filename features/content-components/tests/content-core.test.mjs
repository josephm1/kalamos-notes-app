import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const Core = require('../android/src/main/assets/web/js/content-components/content-core.js')
const Renderer = require('../android/src/main/assets/web/js/content-components/content-renderer.js')
const WorkbookContracts = require('../../../foundation/android-runtime/src/main/assets/web/js/books-ai/workbook-contracts.js')

function base(kind, extra = {}) {
  return { schema: Core.schemas.definition, kind, version: 1, id: `fixture-${kind}`, prompt: `Complete the ${kind} activity.`, ...extra }
}

test('catalogue publishes 36 versioned schemas without implementation code', () => {
  assert.equal(Core.catalogue.length, 36)
  assert.equal(new Set(Core.catalogue.map(row => row.kind)).size, 36)
  for (const manifest of Core.listTemplateManifests({ app: 'learn' }, { pen: true })) {
    const schema = Core.getTemplateSchema(manifest.kind)
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.equal(schema.properties.kind.const, manifest.kind)
    assert.equal(schema.unevaluatedProperties, false)
    assert.equal(JSON.stringify(manifest).includes('function'), false)
  }
})

test('visual reconstruction needs an actual image and concrete drawing requirements', () => {
  const asset = { schema: Core.schemas.asset, id: 'asset-relay', kind: 'svg', mime: 'image/svg+xml', sha256: 'e'.repeat(64) }
  const definition = base('visual-reconstruction', { asset, requirements: ['Connect the two open terminals.'], rubric: 'The line joins both open terminals.' })
  assert.equal(Core.validateDefinition(definition).asset.id, asset.id)
  assert.throws(() => Core.validateDefinition({ ...definition, asset: undefined }), /asset must be an object/)
  assert.throws(() => Core.validateDefinition({ ...definition, requirements: [] }), /requirements has invalid length/)
  assert.throws(() => Core.validateDefinition({ ...definition, rubric: '' }), /rubric must be bounded text/)
})

test('every proven Books v1 activity has a shared schema without importing Books policy', () => {
  const shared = new Set(Core.catalogue.map(row => row.kind))
  assert.equal(WorkbookContracts._kinds.length, 20)
  assert.deepEqual(WorkbookContracts._kinds.filter(kind => !shared.has(kind)), [])
  assert.equal(Core.listTemplateManifests({ app: 'books' }).some(row => row.kind === 'turn-based-grid'), false)
})

test('closed choice contract validates and scores locally', () => {
  const definition = Core.validateDefinition(base('single-choice', {
    options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }], answer: 'b', explanation: 'Beta follows.', maxScore: 2
  }))
  let attempt = Core.createAttempt(definition)
  attempt = Core.reduceAttempt(attempt, { type: 'select', id: 'b' })
  assert.deepEqual(Core.scoreAttempt(definition, attempt), { kind: 'deterministic', score: 2, maxScore: 2, correct: true, requiresAiReview: false })
  assert.throws(() => Core.validateDefinition({ ...definition, script: 'alert(1)' }), /unsupported field/)
})

test('evidence board exposes source claims and scores links without a pen review', () => {
  const definition = Core.validateDefinition(base('evidence-board', {
    evidence: [{ id: 'diary', label: 'A dated diary' }, { id: 'story', label: 'A later narrative' }],
    claims: [{ id: 'date', label: 'Fixes the date' }, { id: 'reception', label: 'Shows later reception' }],
    links: [{ evidence: 'diary', claim: 'date' }, { evidence: 'story', claim: 'reception' }],
    rubric: 'Match each document to what it can establish.', maxScore: 10
  }))
  let attempt = Core.createAttempt(definition)
  attempt = Core.reduceAttempt(attempt, { type: 'pairs', pairs: [{ left: 'diary', right: 'date' }] })
  assert.deepEqual(Core.scoreAttempt(definition, attempt), { kind: 'deterministic', score: 5, maxScore: 10, correct: false, requiresAiReview: false })
  attempt = Core.reduceAttempt(attempt, { type: 'pairs', pairs: [{ left: 'diary', right: 'date' }, { left: 'story', right: 'reception' }] })
  assert.equal(Core.scoreAttempt(definition, attempt).correct, true)
  assert.throws(() => Core.validateDefinition({ ...definition, links: [{ evidence: 'diary', claim: 'missing' }] }), /unknown evidence item or claim/)
  assert.match(fs.readFileSync(path.join(root, 'features/content-components/android/src/main/assets/web/js/content-components/content-renderer.js'), 'utf8'), /data-kc-evidence/)
})

test('evidence board schema agrees with runtime on a single claim and preserves choice minimums', () => {
  const schema = Core.getTemplateSchema('evidence-board')
  const definition = Core.validateDefinition(base('evidence-board', {
    evidence: [{ id: 'record', label: 'The recorded measurement' }],
    claims: [{ id: 'value', label: 'The recorded value' }],
    links: [{ evidence: 'record', claim: 'value' }], rubric: 'Link direct support.'
  }))
  assert.equal(schema.properties.claims.minItems, 1)
  assert.equal(schema.properties.evidence.minItems, 1)
  assert.equal(schema.properties.claims.maxItems, 20)
  assert.equal(schema.properties.evidence.maxItems, 40)
  const attempt = Core.reduceAttempt(Core.createAttempt(definition), { type: 'pairs', pairs: [{ left: 'record', right: 'value' }] })
  assert.equal(Core.scoreAttempt(definition, attempt).correct, true)
  assert.throws(() => Core.validateDefinition({ ...definition, claims: [] }), /invalid length/)
  assert.equal(Core.getTemplateSchema('single-choice').properties.options.minItems, 2)
})

test('constraint grids reject invalid solutions and conflicting givens', () => {
  const definition = base('constraint-grid', { size: 3, solution: [[1, 2, 3], [2, 3, 1], [3, 1, 2]], givens: [{ x: 0, y: 0, value: 1 }, { x: 1, y: 0, value: 2 }, { x: 2, y: 0, value: 3 }, { x: 0, y: 1, value: 2 }], constraints: [] })
  assert.equal(Core.validateDefinition(definition).size, 3)
  assert.throws(() => Core.validateDefinition({ ...definition, solution: [[1, 1, 3], [2, 3, 1], [3, 1, 2]] }), /permutation/)
  assert.throws(() => Core.validateDefinition({ ...definition, givens: [{ x: 0, y: 0, value: 2 }] }), /conflicts/)
})

test('ink coordinates are normalized, vectors survive undo and touch is a renderer concern', () => {
  let ink = Core.createInk('asset-1')
  ink = Core.inkAction(ink, { type: 'stroke', id: 'stroke-1', tool: 'pen', width: 2, color: '#111111', points: [{ x: .1, y: .2, pressure: .4, tiltX: 2, tiltY: -2, time: 1 }] })
  assert.equal(Core.validateInk(ink).strokes.length, 1)
  ink = Core.inkAction(ink, { type: 'undo' })
  assert.equal(ink.strokes.length, 0)
  ink = Core.inkAction(ink, { type: 'redo' })
  assert.equal(ink.strokes[0].points[0].x, .1)
  ink = Core.inkAction(ink, { type: 'erase', radius: .05, points: [{ x: .1, y: .2, pressure: .5, tiltX: 0, tiltY: 0, time: 2 }] })
  assert.equal(ink.strokes.length, 0)
  assert.throws(() => Core.inkAction(ink, { type: 'stroke', tool: 'pen', width: 2, color: '#111', points: [{ x: 2, y: 0 }] }), /allowed range/)
})

test('AI review remains provisional and keeps an auditable acceptance or override', () => {
  const definition = Core.validateDefinition(base('handwritten-response', { sampleAnswer: 'A mechanism.', rubric: 'Names the mechanism.', maxScore: 4 }))
  let attempt = Core.createAttempt(definition)
  const review = { schema: Core.schemas.review, status: 'provisional', definitionId: definition.id, inputHash: 'a'.repeat(64), model: 'vision-model', promptVersion: 'v1', score: 3, maxScore: 4, confidence: .7, matchedRubricIds: [], missedClaims: [], incorrectClaims: [], feedback: 'Good mechanism; add the final consequence.', suggestedAnnotations: [], warnings: [], at: new Date().toISOString() }
  attempt = Core.reduceAttempt(attempt, { type: 'ai-review', review })
  assert.equal(attempt.status, 'reviewed')
  attempt = Core.reduceAttempt(attempt, { type: 'override-review', score: 4, reason: 'The consequence is present in the diagram.' })
  assert.equal(attempt.status, 'accepted')
  assert.equal(attempt.reviewHistory.at(-1).status, 'overridden')
})

test('scenario v2 rejects unreachable nodes and applies closed effects', () => {
  const scenario = { schema: Core.schemas.scenario, id: 'small-case', title: 'Small case', start: 'begin', variables: { clues: 0 }, inventory: [], nodes: [
    { id: 'begin', title: 'Begin', transitions: [{ id: 'inspect', label: 'Inspect', to: 'finish', effects: [{ op: 'increment', key: 'clues', value: 1 }, { op: 'add-item', item: 'note' }] }] },
    { id: 'finish', title: 'Finish', ending: true, outcome: 'Complete', transitions: [] }
  ], assets: [] }
  const valid = Core.validateScenario(scenario)
  let session = Core.startScenario(valid)
  session = Core.advanceScenario(valid, session, 'inspect', { score: 2, correct: true })
  assert.equal(session.variables.clues, 1)
  assert.deepEqual(session.inventory, ['note'])
  assert.equal(session.complete, true)
  assert.throws(() => Core.validateScenario({ ...scenario, nodes: scenario.nodes.concat({ id: 'lost', ending: true, transitions: [] }) }), /unreachable/)
})

test('scenario assets are content-addressed and cannot be silently replaced inside a node', () => {
  const asset = { schema: Core.schemas.asset, id: 'asset-example', kind: 'raster', mime: 'image/png', sha256: 'a'.repeat(64), origin: 'upload', alt: 'An ECG trace' }
  const scenario = { schema: Core.schemas.scenario, id: 'asset-route', title: 'Asset route', start: 'a', assets: [asset], nodes: [
    { id: 'a', interaction: { schema: Core.schemas.definition, kind: 'mark-and-describe', version: 1, id: 'mark', prompt: 'Mark the finding', asset: { ...asset }, targets: [], rubric: 'Locate and describe the visible feature.' }, transitions: [{ id: 'finish', to: 'b', effects: [] }] },
    { id: 'b', ending: true, transitions: [] }
  ] }
  assert.equal(Core.validateScenario(scenario).assets[0].id, asset.id)
  const changed = structuredClone(scenario)
  changed.nodes[0].interaction.asset.sha256 = 'b'.repeat(64)
  assert.throws(() => Core.validateScenario(changed), /changes the content/)
})

test('source-led scenes keep bounded section IDs and accepted illustrations through validation', () => {
  const image = { schema: Core.schemas.asset, id: 'asset-manuscript', kind: 'raster', mime: 'image/jpeg', sha256: 'e'.repeat(64), origin: 'book:sample:plate-1', alt: 'A manuscript plate' }
  const story = { schema: Core.schemas.scenario, id: 'book-journey', title: 'A book journey', start: 'chapter', assets: [image], nodes: [
    { id: 'chapter', title: 'The turning point', sourceRefs: ['section-1', 'section-2'], illustrationId: image.id, transitions: [{ id: 'next', label: 'Continue', to: 'ending', effects: [] }] },
    { id: 'ending', title: 'End', ending: true, transitions: [] }
  ] }
  const valid = Core.validateScenario(story)
  assert.deepEqual(valid.nodes.chapter.sourceRefs, ['section-1', 'section-2'])
  assert.equal(valid.nodes.chapter.illustrationId, image.id)
  assert.throws(() => Core.validateScenario({ ...story, nodes: [{ ...story.nodes[0], sourceRefs: ['../source.json'] }, story.nodes[1]] }), /sourceRefs/)
  assert.throws(() => Core.validateScenario({ ...story, nodes: [{ ...story.nodes[0], illustrationId: 'asset-missing' }, story.nodes[1]] }), /accepted image/)
})

test('progressive cases record each committed stage and score the complete sequence', () => {
  const definition = Core.validateDefinition(base('progressive-case', { stages: [
    { id: 'first', prompt: 'First decision?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], answer: 'a' },
    { id: 'second', prompt: 'Second decision?', options: [{ id: 'c', label: 'C' }, { id: 'd', label: 'D' }], answer: 'd' }
  ], rubric: 'Commit before each reveal.', maxScore: 4 }))
  let attempt = Core.createAttempt(definition)
  attempt = Core.reduceAttempt(attempt, { type: 'select', id: 'a' })
  attempt = Core.reduceAttempt(attempt, { type: 'progress-stage', stage: 0, selected: 'a', text: '', correct: true, nextStage: 1, complete: false })
  assert.equal(attempt.response.stage, 1)
  assert.equal(attempt.response.selected, '')
  attempt = Core.reduceAttempt(attempt, { type: 'select', id: 'd' })
  attempt = Core.reduceAttempt(attempt, { type: 'progress-stage', stage: 1, selected: 'd', text: '', correct: true, nextStage: 1, complete: true })
  assert.deepEqual(Core.scoreAttempt(definition, attempt), { kind: 'deterministic', score: 4, maxScore: 4, correct: true, requiresAiReview: false })
  assert.throws(() => Core.validateDefinition(base('progressive-case', { stages: [{ id: 'bad', prompt: 'Bad answer', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], answer: 'missing' }], rubric: 'Review.' })), /unknown option/)
})

test('spatial responses replace stale hotspot hits and score graph and trace paths locally', () => {
  const hotspot = Core.validateDefinition(base('hotspot', { asset: { schema: Core.schemas.asset, id: 'asset-hotspot', kind: 'raster', mime: 'image/png', sha256: 'c'.repeat(64) }, regions: [{ id: 'finding', label: 'Finding', shape: 'rectangle', x: .2, y: .2, width: .2, height: .2 }], answer: 'finding' }))
  let attempt = Core.createAttempt(hotspot)
  attempt = Core.reduceAttempt(attempt, { type: 'points', points: [{ x: .3, y: .3, regionId: 'finding' }] })
  assert.equal(Core.scoreAttempt(hotspot, attempt).correct, true)
  attempt = Core.reduceAttempt(attempt, { type: 'points', points: [] })
  assert.equal(Core.scoreAttempt(hotspot, attempt).correct, false)

  const graph = Core.validateDefinition(base('graph-plotting', { axes: {}, answer: [{ x: .25, y: .5 }, { x: .75, y: .5 }], tolerance: .03 }))
  let graphAttempt = Core.createAttempt(graph)
  graphAttempt = Core.reduceAttempt(graphAttempt, { type: 'points', points: [{ x: .24, y: .5 }, { x: .76, y: .5 }] })
  assert.equal(Core.scoreAttempt(graph, graphAttempt).correct, true)
  graphAttempt = Core.reduceAttempt(graphAttempt, { type: 'points', points: [{ x: .24, y: .5 }, { x: .76, y: .5 }, { x: .1, y: .9 }] })
  assert.deepEqual(Core.scoreAttempt(graph, graphAttempt), { kind: 'deterministic', score: .67, maxScore: 1, correct: false, requiresAiReview: false })

  const trace = Core.validateDefinition(base('trace-path', { path: [{ x: .1, y: .1 }, { x: .5, y: .5 }, { x: .9, y: .9 }], tolerance: .08 }))
  let traceAttempt = Core.createAttempt(trace)
  let traceInk = Core.createInk()
  traceInk = Core.inkAction(traceInk, { type: 'stroke', tool: 'pen', width: 2, color: '#111111', points: [{ x: .1, y: .1 }, { x: .5, y: .5 }, { x: .9, y: .9 }] })
  traceAttempt = Core.reduceAttempt(traceAttempt, { type: 'ink', ink: traceInk })
  assert.equal(Core.scoreAttempt(trace, traceAttempt).correct, true)
  traceAttempt = Core.reduceAttempt(traceAttempt, { type: 'points', points: [{ x: .1, y: .1 }, { x: .5, y: .5 }, { x: .9, y: .9 }] })
  assert.equal(Core.scoreAttempt(trace, traceAttempt).correct, true)
  const exactTrace = Core.validateDefinition(base('trace-path', { path: [{ x: .1, y: .1 }, { x: .9, y: .9 }], tolerance: 0 }))
  let exactAttempt = Core.createAttempt(exactTrace)
  exactAttempt = Core.reduceAttempt(exactAttempt, { type: 'points', points: [{ x: .101, y: .1 }, { x: .901, y: .9 }] })
  assert.equal(Core.scoreAttempt(exactTrace, exactAttempt).score, 0)
})

test('graph canvas coordinates map to the visible bottom-left plot origin', () => {
  assert.deepEqual(Renderer.graphPoint({ x: .1, y: .9 }), { x: 0, y: 0 })
  const topRight = Renderer.graphPoint({ x: .94, y: .07 })
  assert.ok(Math.abs(topRight.x - 1) < 1e-12)
  assert.ok(Math.abs(topRight.y - 1) < 1e-12)
  assert.equal(Renderer.graphPoint({ x: .05, y: .5 }), null)
})

test('diagram labels close every target and answer against known labels', () => {
  const asset = { schema: Core.schemas.asset, id: 'asset-diagram', kind: 'svg', mime: 'image/svg+xml', sha256: 'd'.repeat(64) }
  const valid = base('diagram-labelling', { asset, labels: [{ id: 'atria', label: 'Atria' }, { id: 'ventricle', label: 'Ventricle' }], targets: [{ id: 'upper', label: 'Upper chamber', shape: 'point', x: .5, y: .2 }], answer: { upper: 'atria' } })
  assert.equal(Core.validateDefinition(valid).answer.upper, 'atria')
  assert.throws(() => Core.validateDefinition({ ...valid, labels: 'not-an-array' }), /invalid length/)
  assert.throws(() => Core.validateDefinition({ ...valid, answer: { missing: 'nowhere' } }), /map every target/)
})

test('renderer keeps annotations over assets and supports choice selection, felt and hotspot hit-testing paths', () => {
  const renderer = fs.readFileSync(path.join(root, 'features/content-components/android/src/main/assets/web/js/content-components/content-renderer.js'), 'utf8')
  const css = fs.readFileSync(path.join(root, 'features/content-components/android/src/main/assets/web/css/content-components.css'), 'utf8')
  assert.match(renderer, /var api = factory\(root, root\.KalamosContent\)/)
  assert.match(renderer, /function \(root, Core\)/)
  assert.match(renderer, /penHtml\(definition, true\)/)
  assert.match(renderer, /syncHotspotPoints\(\)/)
  assert.match(renderer, /assetPoint\(canvas, point\)/)
  assert.match(renderer, /canvasPoint\(canvas, source\)/)
  assert.match(renderer, /clean\.kind === 'trace-path'/)
  assert.match(renderer, /renderGuide\(ctx, canvas, w, h\)/)
  assert.match(renderer, /type: 'erase'/)
  assert.match(renderer, /setErasing\(nativeTool === 'eraser'\)/)
  assert.match(renderer, /svg\\\+xml/)
  assert.match(renderer, /ctx\.drawImage\(canvas, 0, 0\)/)
  assert.match(renderer, /tool === 'felt' \? 'felt' : 'pen'/)
  assert.match(renderer, /root\.KalamosBridge/)
  assert.match(renderer, /bridge\.skipWakeRefresh\(\); bridge\.attachInkBox/)
  assert.match(renderer, /bridge\.setInkEnabled\(true\)/)
  assert.match(renderer, /bridge\.showEditor\(\)/)
  assert.match(renderer, /setNativeOwnership\(true\)/)
  assert.match(renderer, /WebView never paints the live stroke/)
  assert.doesNotMatch(renderer, /bridge\.snapshotContent\(bounds\.l, bounds\.t, bounds\.r, bounds\.b\); bridge\.skipWakeRefresh/)
  assert.match(renderer, /The daemon already owns the visible pixels/)
  assert.match(renderer, /x \+ width \/ 2/)
  assert.match(css, /\.kc-asset \{ position:absolute/)
  assert.match(css, /\.kc-canvas[^\n]+touch-action:pan-x pan-y/)
  assert.match(css, /\.kc-canvas-wrap\.kc-native-ink-active > \.kc-canvas \{ visibility:hidden; \}/)
})

test('native bounded ink geometry clamps to the physical viewport and normalizes daemon points', () => {
  const bounds = Renderer.nativeInkBounds({ left: -1, top: 10.2, right: 573, bottom: 900 }, 1.875, 572, 772)
  assert.deepEqual(bounds, { l: 0, t: 19, r: 1073, b: 1448 })
  const points = Renderer.nativeStrokePoints([[-5, 20, .3], [540, 250, .8], [1200, 900, 2]], 1080, 800)
  assert.deepEqual(points.map(point => [point.x, point.y, point.pressure]), [[0, .025, .3], [.5, .3125, .8], [1, 1, 1]])
})

test('static SVG sanitizer rejects active and remote content', () => {
  assert.match(Core.sanitizeSvg('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'), /circle/)
  assert.throws(() => Core.sanitizeSvg('<svg><script>alert(1)</script></svg>'), /active/)
  assert.throws(() => Core.sanitizeSvg('<svg><image href="https://example.org/a.png"/></svg>'), /external/)
})

test('legacy Learn quizzes adapt to shared definitions', () => {
  const definition = Core.legacyQuizToDefinition({ id: 'q1', mode: 'choice', prompt: 'Pick one', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answer: 'a', explanation: 'A.' })
  assert.equal(definition.kind, 'single-choice')
  assert.equal(definition.options[0].label, 'A')
})


test('passage choices keep long inert text separate from bounded labels and actual renderer selection',()=>{
 const quote='Original <script>alert(1)</script> & evidence: '+('long qualified observation '.repeat(30))
 const definition=Core.validateDefinition(base('single-choice',{options:[{id:'a',label:'Passage set 1',passages:[quote]},{id:'b',label:'Passage set 2',passages:['Other observation.']}],answer:'a'}))
 assert.equal(Core.getTemplateSchema('single-choice').properties.options.items.properties.passages.items.maxLength,16000)
 assert.equal(Core.getTemplateSchema('ordering').properties.items.items.properties.passages,undefined)
 assert.throws(()=>Core.validateDefinition(base('ordering',{items:definition.options,answer:['a','b']})),/unsupported field/)
 assert.throws(()=>Core.validateDefinition({...definition,options:[{...definition.options[0],passages:[]},definition.options[1]]}),/invalid length/)
 assert.throws(()=>Core.validateDefinition({...definition,options:[{...definition.options[0],passages:['x'.repeat(16001)]},definition.options[1]]}),/bounded text/)
 const sandbox={KalamosContent:Core};vm.runInNewContext(fs.readFileSync(path.join(root,'features/content-components/android/src/main/assets/web/js/content-components/content-renderer.js'),'utf8'),sandbox)
 const container=choiceContainer()
 const controller=sandbox.KalamosContentRenderer.mount(container,definition)
 assert.ok(container.innerHTML.includes(sandbox.KalamosContentRenderer.escapeHtml(quote)))
 assert.ok(!container.innerHTML.includes('<script>'))
 container.controls.find(el=>el.dataset.kcValue==='a').onclick()
 assert.equal(controller.getAttempt().response.selected,'a')
 assert.equal(Core.scoreAttempt(definition,controller.getAttempt()).correct,true)
 assert.ok(container.controls.find(el=>el.dataset.kcValue==='a').classList.contains('is-active'))
 controller.destroy()
})


// Minimal DOM surface used by the choice renderer. Preserve element identities and copied handlers
// so a full redraw or a closure that updates only its original button is observable in these tests.
function choiceContainer() {
  function control(attributes) {
    const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean))
    return {
      dataset: { kcAction: attributes['data-kc-action'], kcValue: attributes['data-kc-value'] },
      attributes: { ...attributes },
      classList: {
        contains: name => classes.has(name),
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name) }
      },
      setAttribute(name, value) { this.attributes[name] = value },
      clone() {
        const copy = control({ ...this.attributes, class: [...classes].join(' ') })
        copy.onclick = this.onclick
        return copy
      }
    }
  }
  return {
    controls: [], writes: 0, html: '', result: { textContent: '' },
    set innerHTML(html) {
      this.writes++; this.html = html
      this.controls = [...html.matchAll(/<button\b([^>]*)>/g)].map(match => {
        const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(row => [row[1], row[2]]))
        return control(attributes)
      })
    },
    get innerHTML() { return this.html },
    querySelectorAll(selector) {
      if (selector === '[data-kc-action]') return this.controls
      if (selector === '[data-kc-action="select"], [data-kc-action="toggle"]') return this.controls.filter(el => ['select', 'toggle'].includes(el.dataset.kcAction))
      return []
    },
    querySelector(selector) { return selector === '.kc-result' ? this.result : null }
  }
}

function mountChoices(definition, initialAttempt, options = {}) {
  const sandbox = { KalamosContent: Core }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'features/content-components/android/src/main/assets/web/js/content-components/content-renderer.js'), 'utf8'), sandbox)
  const container = choiceContainer()
  const controller = sandbox.KalamosContentRenderer.mount(container, definition, initialAttempt, options)
  return { container, controller }
}

for (const kind of ['single-choice', 'multi-select', 'true-false-cant-tell']) {
  test(`${kind} updates button state before change notification without rebuilding or rerendering`, () => {
    const definition = base(kind, kind === 'true-false-cant-tell' ? { answer: 'true' } : {
      options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
      ...(kind === 'multi-select' ? { answers: ['b'] } : { answer: 'b' })
    })
    const initial = Core.reduceAttempt(Core.createAttempt(definition), { type: kind === 'multi-select' ? 'toggle' : 'select', id: kind === 'true-false-cant-tell' ? 'false' : 'a' })
    let renders = 0, changes = 0
    const { container, controller } = mountChoices(definition, initial, {
      onRender() { renders++ },
      onChange(attempt, action) {
        changes++
        for (const button of container.controls.filter(el => ['select', 'toggle'].includes(el.dataset.kcAction))) {
          const active = kind === 'multi-select' ? attempt.response.selected.includes(button.dataset.kcValue) : attempt.response.selected === button.dataset.kcValue
          assert.equal(button.classList.contains('is-active'), active)
          assert.equal(button.attributes['aria-pressed'], String(active))
        }
        assert.equal(action.type, kind === 'multi-select' ? 'toggle' : 'select')
      }
    })
    const originalButtons = container.controls.slice()
    const first = originalButtons.find(el => el.dataset.kcValue === (kind === 'true-false-cant-tell' ? 'false' : 'a'))
    const target = originalButtons.find(el => el.dataset.kcValue === (kind === 'true-false-cant-tell' ? 'true' : 'b'))
    assert.equal(first.attributes['aria-pressed'], 'true')
    target.onclick()
    if (kind === 'multi-select') {
      assert.deepEqual(controller.getAttempt().response.selected, ['a', 'b'])
      first.onclick()
    }
    assert.equal(Core.scoreAttempt(definition, controller.getAttempt()).correct, true)
    assert.equal(container.writes, 1)
    assert.equal(renders, 1)
    assert.equal(changes, kind === 'multi-select' ? 2 : 1)
    assert.deepEqual(container.controls, originalButtons)
    container.controls.find(el => el.dataset.kcAction === 'check').onclick()
    assert.match(container.result.textContent, /^Correct/)
    controller.destroy()
  })
}

test('split paginated passage buttons use current attempt by value, including copied closures', () => {
  const definition = base('single-choice', { options: [{ id: 'a', label: 'A', passages: ['A long passage.'] }, { id: 'b', label: 'B', passages: ['Another passage.'] }], answer: 'b' })
  let renders = 0
  const { container, controller } = mountChoices(definition, null, { onRender() { renders++ } })
  const originals = container.controls.filter(el => el.dataset.kcAction === 'select')
  // Host pagination removes originals and repeats the copied legend across separate pages.
  const clones = originals.flatMap(el => [el.clone(), el.clone()])
  clones[0].hidden = true
  container.controls = clones
  clones[3].onclick()
  assert.equal(controller.getAttempt().response.selected, 'b')
  for (const el of clones) assert.equal(el.attributes['aria-pressed'], String(el.dataset.kcValue === 'b'))
  clones[1].onclick()
  for (const el of clones) assert.equal(el.classList.contains('is-active'), el.dataset.kcValue === 'a')
  // A host may reconstruct the next page from its saved pre-selection copy.
  container.controls = originals.map(el => el.clone())
  controller.syncSelection()
  for (const el of container.controls) assert.equal(el.attributes['aria-pressed'], String(el.dataset.kcValue === 'a'))
  assert.equal(container.writes, 1)
  assert.equal(renders, 1)
  controller.destroy()
})

test('progressive choice selection stays local while committing a stage rebuilds its body', () => {
  const definition = base('progressive-case', { stages: [
    { id: 'first', prompt: 'First decision?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], answer: 'a' },
    { id: 'second', prompt: 'Second decision?', options: [{ id: 'c', label: 'C' }, { id: 'd', label: 'D' }], answer: 'd' }
  ], rubric: 'Commit before each reveal.' })
  let renders = 0
  const { container, controller } = mountChoices(definition, null, { onRender() { renders++ } })
  container.controls.find(el => el.dataset.kcValue === 'a').onclick()
  assert.equal(renders, 1)
  assert.equal(container.writes, 1)
  container.controls.find(el => el.dataset.kcAction === 'check').onclick()
  assert.equal(renders, 2)
  assert.equal(container.writes, 2)
  assert.equal(controller.getAttempt().response.stage, 1)
  assert.ok(container.innerHTML.includes('Second decision?'))
  assert.equal(container.controls.some(el => el.classList.contains('is-active')), false)
  container.controls.find(el => el.dataset.kcValue === 'd').onclick()
  assert.equal(renders, 2)
  container.controls.find(el => el.dataset.kcAction === 'check').onclick()
  assert.equal(renders, 3)
  assert.equal(controller.getAttempt().response.complete, true)
  assert.equal(Core.scoreAttempt(definition, controller.getAttempt()).correct, true)
  controller.destroy()
})
