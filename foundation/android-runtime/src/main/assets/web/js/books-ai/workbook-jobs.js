// Persistent, provider-neutral queue state for resumable workbook conversion.
//
// This module deliberately performs no extraction and no network/provider work. Callers advance
// jobs and units only after the corresponding operation has completed. Source packets survive
// failures and cancellation so an expensive local extraction never needs to be repeated.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.WorkbookJobs = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var INDEX_PATH = 'sidecar/workbook-jobs/index.json'
  var JOB_PREFIX = 'sidecar/workbook-jobs/'
  var STATES = [
    'unscanned', 'extracting', 'ready', 'needs-review', 'generating',
    'draft-ready', 'approved', 'skipped', 'failed'
  ]
  var STATE_SET = Object.create(null)
  STATES.forEach(function(state) { STATE_SET[state] = true })

  var TRANSITIONS = {
    'unscanned': ['extracting', 'skipped'],
    'extracting': ['ready', 'needs-review', 'failed', 'unscanned', 'skipped'],
    'ready': ['extracting', 'needs-review', 'generating', 'skipped'],
    'needs-review': ['ready', 'generating', 'skipped'],
    'generating': ['ready', 'needs-review', 'draft-ready', 'failed'],
    'draft-ready': ['needs-review', 'generating', 'approved', 'skipped'],
    'approved': [],
    'skipped': ['unscanned', 'extracting', 'ready', 'needs-review'],
    'failed': ['unscanned', 'extracting', 'ready', 'needs-review', 'generating', 'skipped']
  }

  var MAX_JOB_BYTES = 4 * 1024 * 1024
  var MAX_PACKET_BYTES = 2 * 1024 * 1024
  var MAX_UNITS = 2000

  function now() { return new Date().toISOString() }

  function bridgeApi() {
    if (root && root.Bridge) return root.Bridge
    try {
      if (typeof Bridge !== 'undefined') return Bridge
    } catch (e) {}
    throw new Error('Workbook job storage is unavailable')
  }

  function notebookId(reader) {
    var id = reader && reader.nbId
    if (typeof id !== 'string' || !id.trim()) throw new Error('A book reader is required')
    return id
  }

  function text(value, max) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, max)
  }

  function safeId(value) {
    value = String(value == null ? '' : value).trim()
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value) ? value : ''
  }

  function generatedId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  }

  function state(value, fallback) {
    return STATE_SET[value] ? value : fallback
  }

  function safeJson(value, byteLimit, label) {
    if (value == null) return null
    var raw
    try { raw = JSON.stringify(value) } catch (e) { throw new Error((label || 'Value') + ' must be JSON data') }
    if (typeof raw !== 'string' || raw.length > byteLimit)
      throw new Error((label || 'Value') + ' is too large')
    var parsed = JSON.parse(raw)
    assertSafeTree(parsed, 0)
    return parsed
  }

  function assertSafeTree(value, depth) {
    if (depth > 18) throw new Error('Stored data is nested too deeply')
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return
    if (typeof value === 'string') {
      if (value.length > 240000) throw new Error('Stored text is too large')
      return
    }
    if (Array.isArray(value)) {
      if (value.length > 4000) throw new Error('Stored list is too large')
      value.forEach(function(item) { assertSafeTree(item, depth + 1) })
      return
    }
    if (typeof value !== 'object') throw new Error('Stored data contains an unsupported value')
    var keys = Object.keys(value)
    if (keys.length > 1000) throw new Error('Stored object has too many fields')
    keys.forEach(function(key) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor')
        throw new Error('Stored data contains an unsafe field')
      if (key.length > 160) throw new Error('Stored field name is too long')
      assertSafeTree(value[key], depth + 1)
    })
  }

  function read(reader, path, fallback) {
    var raw = bridgeApi().getBookFile(notebookId(reader), path) || ''
    if (!raw) return fallback
    try { return JSON.parse(raw) } catch (e) { return fallback }
  }

  function write(reader, path, value) {
    var raw = JSON.stringify(value)
    if (raw.length > MAX_JOB_BYTES) throw new Error('Workbook job is too large')
    var result = bridgeApi().saveBookFile(notebookId(reader), path, raw)
    if (result === 'error' || result === false) throw new Error('Workbook job could not be saved')
  }

  function jobPath(id) { return JOB_PREFIX + id + '.json' }

  function cleanWarnings(value) {
    return Array.isArray(value) ? value.slice(0, 30).map(function(item) {
      return text(item, 500)
    }).filter(Boolean) : []
  }

  function cleanRefs(value) {
    return Array.isArray(value) ? value.slice(0, 400).map(function(item) {
      return text(item, 180)
    }).filter(Boolean) : []
  }

  function cleanUnit(value, index) {
    value = value && typeof value === 'object' ? value : {}
    var id = safeId(value.id) || ('unit-' + (index + 1))
    var unitState = state(value.state, 'unscanned')
    var out = {
      id: id,
      label: text(value.label || ('Unit ' + (index + 1)), 240),
      state: unitState,
      classification: text(value.classification, 80),
      reviewRequired: !!value.reviewRequired,
      generationRequested: unitState === 'generating' && value.generationRequested === true,
      warnings: cleanWarnings(value.warnings),
      sourceRefs: cleanRefs(value.sourceRefs),
      extractedPacket: safeJson(value.extractedPacket, MAX_PACKET_BYTES, 'Extracted packet'),
      draft: safeJson(value.draft, MAX_PACKET_BYTES, 'Workbook draft'),
      providerMeta: safeJson(value.providerMeta, 200000, 'Provider metadata'),
      error: text(value.error, 1000),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now()
    }
    if (value.resumeState === 'ready' || value.resumeState === 'needs-review')
      out.resumeState = value.resumeState
    return out
  }

  function cleanJob(value) {
    if (!value || value.version !== 1 || !safeId(value.id)) return null
    var units = Array.isArray(value.units) ? value.units.slice(0, MAX_UNITS).map(cleanUnit) : []
    var jobState = state(value.state, 'unscanned')
    return {
      version: 1,
      id: value.id,
      title: text(value.title || 'Workbook conversion', 240),
      state: jobState,
      paused: value.paused === true,
      mode: value.mode === 'generated' || value.mode === 'mixed' ? value.mode : 'adapted',
      source: safeJson(value.source, MAX_PACKET_BYTES, 'Source description'),
      options: safeJson(value.options, 200000, 'Workbook options'),
      generationRequested: jobState === 'generating' && value.generationRequested === true,
      units: units,
      error: text(value.error, 1000),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now(),
      resumeState: value.resumeState === 'ready' || value.resumeState === 'needs-review'
        ? value.resumeState : null
    }
  }

  function cleanIndex(value) {
    var rows = value && value.version === 1 && Array.isArray(value.jobs) ? value.jobs : []
    return {
      version: 1,
      jobs: rows.slice(0, 500).map(function(row) {
        if (!row || !safeId(row.id)) return null
        return {
          id: row.id,
          title: text(row.title || 'Workbook conversion', 240),
          state: state(row.state, 'unscanned'),
          paused: row.paused === true,
          unitCount: Math.max(0, Math.min(MAX_UNITS, Math.floor(Number(row.unitCount) || 0))),
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : ''
        }
      }).filter(Boolean)
    }
  }

  function indexFor(reader) { return cleanIndex(read(reader, INDEX_PATH, null)) }

  function indexRow(job) {
    return {
      id: job.id,
      title: job.title,
      state: job.state,
      paused: job.paused === true,
      unitCount: job.units.length,
      updatedAt: job.updatedAt
    }
  }

  function saveJob(reader, job) {
    job = cleanJob(job)
    if (!job) throw new Error('Workbook job is invalid')
    write(reader, jobPath(job.id), job)
    var index = indexFor(reader)
    var found = false
    index.jobs = index.jobs.map(function(row) {
      if (row.id !== job.id) return row
      found = true
      return indexRow(job)
    })
    if (!found) index.jobs.push(indexRow(job))
    write(reader, INDEX_PATH, index)
    return job
  }

  function create(reader, spec) {
    spec = spec && typeof spec === 'object' ? spec : {}
    var id = safeId(spec.id) || generatedId('workbook')
    if (load(reader, id)) throw new Error('A workbook job with this id already exists')
    var stamp = now()
    var units = Array.isArray(spec.units) ? spec.units : []
    if (units.length > MAX_UNITS) throw new Error('A workbook job cannot contain more than ' + MAX_UNITS + ' units')
    units = units.map(function(unit, index) {
      unit = Object.assign({}, unit, {
        state: 'unscanned', generationRequested: false, createdAt: stamp, updatedAt: stamp
      })
      return cleanUnit(unit, index)
    })
    var ids = Object.create(null)
    units.forEach(function(unit) {
      if (ids[unit.id]) throw new Error('Workbook unit ids must be unique')
      ids[unit.id] = true
    })
    return saveJob(reader, {
      version: 1,
      id: id,
      title: text(spec.title || 'Workbook conversion', 240),
      state: 'unscanned',
      paused: false,
      mode: spec.mode,
      source: safeJson(spec.source, MAX_PACKET_BYTES, 'Source description'),
      options: safeJson(spec.options, 200000, 'Workbook options'),
      generationRequested: false,
      units: units,
      error: '',
      createdAt: stamp,
      updatedAt: stamp
    })
  }

  function list(reader) {
    return indexFor(reader).jobs.slice().sort(function(a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt))
    })
  }

  function load(reader, id) {
    id = safeId(id)
    if (!id) return null
    return cleanJob(read(reader, jobPath(id), null))
  }

  function assertTransition(from, to, options) {
    if (!STATE_SET[to]) throw new Error('Unknown workbook job state: ' + to)
    if ((TRANSITIONS[from] || []).indexOf(to) < 0)
      throw new Error('Workbook job cannot move from ' + from + ' to ' + to)
    if (to === 'generating' && (!options || options.generationRequested !== true))
      throw new Error('Generation must be requested explicitly')
    if (from === 'generating' && options && options.cancel === true &&
        to !== 'ready' && to !== 'needs-review')
      throw new Error('Cancellation must return work to ready or needs-review')
  }

  function applyTransition(target, to, options) {
    options = options || {}
    if (target.state === 'generating' && options.cancel === true) {
      var returnState = target.resumeState === 'needs-review' || target.reviewRequired
        ? 'needs-review' : 'ready'
      if (to !== returnState)
        throw new Error('Cancellation must return work to ' + returnState)
    }
    assertTransition(target.state, to, options)
    if (to === 'generating') {
      target.resumeState = target.state === 'needs-review' ? 'needs-review' : 'ready'
      target.generationRequested = true
    } else {
      target.generationRequested = false
      target.resumeState = null
    }
    target.state = to
    target.error = to === 'failed' ? text(options.error, 1000) : ''
    target.updatedAt = now()
    return target
  }

  function transition(reader, id, to, options) {
    var job = load(reader, id)
    if (!job) throw new Error('Workbook job was not found')
    applyTransition(job, to, options)
    return saveJob(reader, job)
  }

  // Pausing is deliberately orthogonal to the unit state machine. It prevents the product
  // controller from starting another operation while preserving the exact resumable state of
  // every unit. An already-running provider request is cancelled by the controller before it
  // marks the job paused.
  function setPaused(reader, id, paused) {
    var job = load(reader, id)
    if (!job) throw new Error('Workbook job was not found')
    job.paused = paused === true
    job.updatedAt = now()
    return saveJob(reader, job)
  }

  function updateUnit(reader, jobId, unitId, patch) {
    var job = load(reader, jobId)
    if (!job) throw new Error('Workbook job was not found')
    unitId = safeId(unitId)
    var unit = job.units.find(function(row) { return row.id === unitId })
    if (!unit) throw new Error('Workbook unit was not found')
    if (unit.state === 'approved') throw new Error('Approved workbook units are immutable')
    patch = patch && typeof patch === 'object' ? patch : {}

    if (Object.prototype.hasOwnProperty.call(patch, 'label')) unit.label = text(patch.label, 240)
    if (Object.prototype.hasOwnProperty.call(patch, 'classification'))
      unit.classification = text(patch.classification, 80)
    if (Object.prototype.hasOwnProperty.call(patch, 'reviewRequired')) unit.reviewRequired = !!patch.reviewRequired
    if (Object.prototype.hasOwnProperty.call(patch, 'warnings')) unit.warnings = cleanWarnings(patch.warnings)
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceRefs')) unit.sourceRefs = cleanRefs(patch.sourceRefs)
    if (Object.prototype.hasOwnProperty.call(patch, 'extractedPacket'))
      unit.extractedPacket = safeJson(patch.extractedPacket, MAX_PACKET_BYTES, 'Extracted packet')
    if (Object.prototype.hasOwnProperty.call(patch, 'draft'))
      unit.draft = safeJson(patch.draft, MAX_PACKET_BYTES, 'Workbook draft')
    if (Object.prototype.hasOwnProperty.call(patch, 'providerMeta'))
      unit.providerMeta = safeJson(patch.providerMeta, 200000, 'Provider metadata')

    if (patch.cancel === true) {
      if (unit.state !== 'generating') throw new Error('Only generating work can be cancelled')
      var returnState = unit.resumeState === 'needs-review' || unit.reviewRequired
        ? 'needs-review' : 'ready'
      applyTransition(unit, returnState, { cancel: true })
    } else if (patch.state != null) {
      applyTransition(unit, patch.state, {
        generationRequested: patch.generationRequested === true,
        error: patch.error
      })
    } else {
      unit.updatedAt = now()
    }

    job.updatedAt = now()
    return saveJob(reader, job)
  }

  return {
    STATES: STATES.slice(),
    create: create,
    list: list,
    load: load,
    transition: transition,
    setPaused: setPaused,
    updateUnit: updateUnit
  }
})
