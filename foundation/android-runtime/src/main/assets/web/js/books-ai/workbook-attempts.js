// Versioned mutable state for study-workbook groups.
//
// Immutable activity data stays in sidecar/pages.json. This module is the only workbook layer that
// reads or writes sidecar/interactions/<groupId>/attempt.json, via NativePages' neutral storage API.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.WorkbookAttempts = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  function now() { return new Date().toISOString() }

  function blank(mode) {
    return {
      version: 2,
      mode: mode === 'exam' ? 'exam' : 'practice',
      startedAt: null,
      accumulatedMs: 0,
      completedAt: null,
      activities: {}
    }
  }

  function clean(value, mode) {
    if (!value || value.version !== 2 || !value.activities || typeof value.activities !== 'object')
      return blank(mode)
    return {
      version: 2,
      mode: value.mode === 'exam' ? 'exam' : 'practice',
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
      accumulatedMs: Math.max(0, Number(value.accumulatedMs) || 0),
      completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
      activities: value.activities
    }
  }

  function storage() {
    if (!root.NativePages || typeof root.NativePages.loadAttempt !== 'function' ||
        typeof root.NativePages.saveAttempt !== 'function')
      throw new Error('Workbook attempt storage is unavailable')
    return root.NativePages
  }

  function load(reader, groupId, mode) {
    return clean(storage().loadAttempt(reader, groupId), mode)
  }

  function save(reader, groupId, state) {
    state = clean(state)
    storage().saveAttempt(reader, groupId, state)
    return state
  }

  function start(reader, groupId, mode) {
    var state = load(reader, groupId, mode)
    if (!state.startedAt) state.startedAt = now()
    state.mode = mode === 'exam' ? 'exam' : state.mode
    return save(reader, groupId, state)
  }

  function update(reader, groupId, activityId, patch, mode) {
    if (!activityId) throw new Error('Activity id is required')
    var state = load(reader, groupId, mode)
    if (!state.startedAt) state.startedAt = now()
    var prior = state.activities[activityId] || {
      status: 'open', response: null, checks: 0, hintsUsed: 0, score: null
    }
    var next = {
      status: patch && patch.status != null ? patch.status : prior.status,
      response: patch && Object.prototype.hasOwnProperty.call(patch, 'response') ? patch.response : prior.response,
      checks: Math.max(0, Number(patch && patch.checks != null ? patch.checks : prior.checks) || 0),
      hintsUsed: Math.max(0, Number(patch && patch.hintsUsed != null ? patch.hintsUsed : prior.hintsUsed) || 0),
      score: patch && Object.prototype.hasOwnProperty.call(patch, 'score') ? patch.score : prior.score,
      revealed: !!(patch && patch.revealed != null ? patch.revealed : prior.revealed),
      updatedAt: now()
    }
    state.activities[activityId] = next
    if (patch && patch.completedAt) state.completedAt = patch.completedAt
    return save(reader, groupId, state)
  }

  function complete(reader, groupId, mode) {
    var state = load(reader, groupId, mode)
    if (!state.startedAt) state.startedAt = now()
    state.accumulatedMs = elapsedMs(state)
    state.completedAt = now()
    return save(reader, groupId, state)
  }

  function reset(reader, groupId, mode) {
    var state = blank(mode)
    storage().saveAttempt(reader, groupId, state)
    return state
  }

  function summary(state, activityIds) {
    state = clean(state)
    activityIds = Array.isArray(activityIds) ? activityIds : []
    var rows = activityIds.map(function(id) { return state.activities[id] || null })
    var checked = rows.filter(function(row) {
      return row && (row.status === 'correct' || row.status === 'incorrect' || row.status === 'reviewed')
    }).length
    var correct = rows.filter(function(row) { return row && row.status === 'correct' }).length
    var reviewed = rows.filter(function(row) { return row && row.status === 'reviewed' }).length
    var hints = rows.reduce(function(total, row) { return total + (row ? row.hintsUsed || 0 : 0) }, 0)
    var seal = checked < activityIds.length ? null : (hints === 0 ? 'gold' : (hints === 1 ? 'silver' : 'bronze'))
    return {
      total: activityIds.length,
      checked: checked,
      correct: correct,
      reviewed: reviewed,
      unanswered: Math.max(0, activityIds.length - checked),
      hintsUsed: hints,
      seal: seal
    }
  }

  function elapsedMs(state, at) {
    state = clean(state)
    var elapsed = state.accumulatedMs || 0
    if (!state.startedAt || state.completedAt) return elapsed
    var startMs = Date.parse(state.startedAt)
    var endMs = at == null ? Date.now() : Number(at)
    return Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(elapsed, endMs - startMs)
      : elapsed
  }

  return {
    blank: blank,
    clean: clean,
    load: load,
    save: save,
    start: start,
    update: update,
    complete: complete,
    reset: reset,
    summary: summary,
    elapsedMs: elapsedMs
  }
})
