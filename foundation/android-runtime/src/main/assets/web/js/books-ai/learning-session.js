// Source-grounded adaptive learning sessions for Kalamos Books.
//
// A session is a small, closed graph of pedagogical moves over trusted book evidence. The model or
// BookConverter may author the graph, but this runtime validates it, owns traversal and persistence,
// and never lets authored data select code, files, HTML, or arbitrary navigation targets.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.LearningSessions = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var STORE = 'sidecar/learning-sessions.json'
  var MOVE_KINDS = ['probe-choice', 'plan', 'teach', 'pen-explain', 'finish']
  var PHASES = ['probe', 'plan', 'teach', 'check', 'finish']
  var NODE_KINDS = [
    'fact', 'definition', 'concept', 'distinction', 'mechanism', 'process', 'chronology', 'event',
    'causal-model', 'spatial-relationship', 'region', 'procedure', 'decision-rule', 'case', 'example',
    'interpretation', 'argument', 'visual-structure', 'source-evidence'
  ]
  var EPISTEMIC = ['established', 'source-asserted', 'interpretive', 'contested', 'uncertain']
  var POLICIES = ['general', 'quantitative', 'historical', 'geographic', 'clinical', 'scientific',
    'interpretive', 'procedural']

  function bookBridge() {
    if (root.Bridge) return root.Bridge
    if (typeof Bridge !== 'undefined') return Bridge
    fail('Book storage is unavailable')
  }

  function fail(message) { throw new Error(message) }
  function object(value, at) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at + ' must be an object')
    return value
  }
  function exact(value, keys, at) {
    object(value, at)
    Object.keys(value).forEach(function(key) {
      if (keys.indexOf(key) < 0) fail(at + ' contains unsupported field "' + key + '"')
    })
  }
  function text(value, at, max, optional) {
    if (optional && (value === undefined || value === null || value === '')) return ''
    if (typeof value !== 'string' || !value.trim()) fail(at + ' must be non-empty text')
    value = value.trim()
    if (value.length > max) fail(at + ' is too long')
    if (/<\/?[a-z][^>]*>|(?:javascript|data|file|https?):\s*(?:\/\/|[^\s]*)|\bon[a-z]+\s*=/i.test(value))
      fail(at + ' contains unsafe content')
    return value
  }
  function id(value, at) {
    value = text(value, at, 120)
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) fail(at + ' must be a stable identifier')
    return value
  }
  function rows(value, at, min, max) {
    if (!Array.isArray(value) || value.length < min || value.length > max)
      fail(at + ' must contain ' + min + ' to ' + max + ' items')
    return value
  }
  function oneOf(value, allowed, at) {
    if (allowed.indexOf(value) < 0) fail(at + ' is unsupported')
    return value
  }
  function uniqueIds(value, at, known, min) {
    var seen = {}
    return rows(value, at, min || 0, 24).map(function(item, index) {
      var valueId = id(item, at + ' ' + (index + 1))
      if (seen[valueId]) fail(at + ' contains duplicate "' + valueId + '"')
      if (known && !known[valueId]) fail(at + ' cites unknown id "' + valueId + '"')
      seen[valueId] = true
      return valueId
    })
  }

  function nonNegative(value, at, optional) {
    if (optional && value === undefined) return undefined
    if (!Number.isInteger(value) || value < 0) fail(at + ' must be a non-negative integer')
    return value
  }

  function evidenceTarget(value, at) {
    var target = object(value, at)
    exact(target, ['kind', 'sectionId', 'blockId', 'segmentIndex', 'pageIndex', 'spineIdx', 'start', 'end'], at)
    var kind = oneOf(target.kind, ['book', 'pdf', 'epub'], at + ' kind')
    var out = { kind: kind }
    if (kind === 'book') {
      out.sectionId = id(target.sectionId, at + ' sectionId')
      if (target.blockId !== undefined) out.blockId = id(target.blockId, at + ' blockId')
      if (target.segmentIndex !== undefined) out.segmentIndex = nonNegative(target.segmentIndex, at + ' segmentIndex')
    } else if (kind === 'pdf') {
      out.pageIndex = nonNegative(target.pageIndex, at + ' pageIndex')
      if (target.start !== undefined) out.start = nonNegative(target.start, at + ' start')
      if (target.end !== undefined) out.end = nonNegative(target.end, at + ' end')
    } else {
      out.spineIdx = nonNegative(target.spineIdx, at + ' spineIdx')
      if (target.segmentIndex !== undefined) out.segmentIndex = nonNegative(target.segmentIndex, at + ' segmentIndex')
      if (target.start !== undefined) out.start = nonNegative(target.start, at + ' start')
      if (target.end !== undefined) out.end = nonNegative(target.end, at + ' end')
    }
    return out
  }

  function validateSession(input) {
    exact(input, ['schemaVersion', 'id', 'title', 'domainPolicy', 'source', 'evidence', 'concepts',
      'startMoveId', 'moves'], 'Learning session')
    if (input.schemaVersion !== 1) fail('Learning session uses an unsupported schema version')
    var evidenceById = {}
    var evidence = rows(input.evidence, 'Evidence', 1, 64).map(function(row, index) {
      var at = 'Evidence ' + (index + 1)
      exact(row, ['id', 'label', 'target'], at)
      var evidenceId = id(row.id, at + ' id')
      if (evidenceById[evidenceId]) fail(at + ' id is duplicated')
      var target = evidenceTarget(row.target, at + ' target')
      evidenceById[evidenceId] = true
      return { id: evidenceId, label: text(row.label, at + ' label', 240), target: target }
    })
    var conceptById = {}
    var concepts = rows(input.concepts, 'Concepts', 1, 40).map(function(row, index) {
      var at = 'Concept ' + (index + 1)
      exact(row, ['id', 'label', 'kind', 'epistemicStatus', 'prerequisiteIds', 'evidenceRefs'], at)
      var conceptId = id(row.id, at + ' id')
      if (conceptById[conceptId]) fail(at + ' id is duplicated')
      conceptById[conceptId] = true
      return { id: conceptId, label: text(row.label, at + ' label', 180),
        kind: oneOf(row.kind, NODE_KINDS, at + ' kind'),
        epistemicStatus: oneOf(row.epistemicStatus, EPISTEMIC, at + ' epistemicStatus'),
        prerequisiteIds: rows(row.prerequisiteIds || [], at + ' prerequisiteIds', 0, 12).map(function(value) { return id(value, at + ' prerequisite') }),
        evidenceRefs: uniqueIds(row.evidenceRefs, at + ' evidenceRefs', evidenceById, 1) }
    })
    concepts.forEach(function(concept) {
      concept.prerequisiteIds.forEach(function(ref) {
        if (!conceptById[ref]) fail('Concept "' + concept.id + '" cites unknown prerequisite "' + ref + '"')
        if (ref === concept.id) fail('Concept cannot require itself')
      })
    })
    var moveById = {}
    var moves = rows(input.moves, 'Moves', 2, 40).map(function(row, index) {
      var at = 'Move ' + (index + 1)
      exact(row, ['id', 'kind', 'phase', 'conceptId', 'title', 'prompt', 'content', 'choices',
        'correctIndex', 'explanation', 'rubric', 'evidenceRefs', 'next'], at)
      var moveId = id(row.id, at + ' id')
      if (moveById[moveId]) fail(at + ' id is duplicated')
      if (!conceptById[row.conceptId]) fail(at + ' cites unknown concept')
      var kind = oneOf(row.kind, MOVE_KINDS, at + ' kind')
      var move = { id: moveId, kind: kind, phase: oneOf(row.phase, PHASES, at + ' phase'),
        conceptId: row.conceptId, title: text(row.title, at + ' title', 160),
        prompt: text(row.prompt, at + ' prompt', 1600, true),
        content: text(row.content, at + ' content', 3000, true),
        explanation: text(row.explanation, at + ' explanation', 2000, true),
        rubric: text(row.rubric, at + ' rubric', 2000, true),
        evidenceRefs: uniqueIds(row.evidenceRefs, at + ' evidenceRefs', evidenceById, 1),
        next: object(row.next || {}, at + ' next') }
      exact(move.next, ['correct', 'incorrect', 'dontKnow', 'continue', 'understood', 'review'], at + ' next')
      Object.keys(move.next).forEach(function(key) { move.next[key] = id(move.next[key], at + ' next ' + key) })
      if (kind === 'probe-choice') {
        move.choices = rows(row.choices, at + ' choices', 2, 6).map(function(value, choiceIndex) {
          return text(value, at + ' choice ' + (choiceIndex + 1), 360)
        })
        if (!Number.isInteger(row.correctIndex) || row.correctIndex < 0 || row.correctIndex >= move.choices.length)
          fail(at + ' correctIndex is invalid')
        move.correctIndex = row.correctIndex
        if (!move.next.correct || !move.next.incorrect) fail(at + ' requires correct and incorrect branches')
      }
      if (kind === 'teach' && !move.content) fail(at + ' requires content')
      if (kind === 'pen-explain' && !move.rubric) fail(at + ' requires a source-backed rubric')
      moveById[moveId] = move
      return move
    })
    moves.forEach(function(move) {
      Object.keys(move.next).forEach(function(key) {
        if (!moveById[move.next[key]]) fail('Move "' + move.id + '" routes to unknown move "' + move.next[key] + '"')
      })
    })
    var startMoveId = id(input.startMoveId, 'startMoveId')
    if (!moveById[startMoveId]) fail('startMoveId is unknown')
    exact(input.source, ['kind', 'sectionId'], 'Session source')
    var source = { kind: oneOf(input.source.kind, ['book'], 'Session source kind'),
      sectionId: id(input.source.sectionId, 'Session source sectionId') }
    return { schemaVersion: 1, id: id(input.id, 'Session id'), title: text(input.title, 'Session title', 180),
      domainPolicy: oneOf(input.domainPolicy, POLICIES, 'domainPolicy'),
      source: source, evidence: evidence, concepts: concepts,
      startMoveId: startMoveId, moves: moves }
  }

  function loadCatalogue(reader) {
    try {
      var raw = JSON.parse(bookBridge().getBookFile(reader.nbId, STORE) || 'null')
      if (!raw || raw.version !== 1 || !Array.isArray(raw.sessions)) return []
      return raw.sessions.map(validateSession)
    } catch (error) {
      if (root.console && root.console.warn) root.console.warn('learning sessions', error)
      return []
    }
  }

  function sectionId(reader) {
    return String(reader && reader.sectionId ? reader.sectionId() : '')
  }

  function current(reader) {
    var here = sectionId(reader)
    var sessions = loadCatalogue(reader)
    return sessions.find(function(session) {
      return session.source && session.source.kind === 'book' && String(session.source.sectionId) === here
    }) || sessions[0] || null
  }

  function attemptPath(session) { return 'sidecar/learning-sessions/' + session.id + '/attempt.json' }
  function blank(session) {
    return { version: 1, sessionId: session.id, currentMoveId: session.startMoveId, startedAt: new Date().toISOString(),
      completedAt: null, history: [], concepts: {}, reviewQueue: [] }
  }
  function loadAttempt(reader, session) {
    try {
      var state = JSON.parse(bookBridge().getBookFile(reader.nbId, attemptPath(session)) || 'null')
      if (state && state.version === 1 && state.sessionId === session.id && Array.isArray(state.history) && state.concepts)
        return state
    } catch (error) {}
    return blank(session)
  }
  function saveAttempt(reader, session, state) {
    bookBridge().saveBookFile(reader.nbId, attemptPath(session), JSON.stringify(state))
  }
  function record(state, move, outcome, response) {
    state.history.push({ moveId: move.id, conceptId: move.conceptId, phase: move.phase, outcome: outcome,
      response: response || null, at: new Date().toISOString() })
    var concept = state.concepts[move.conceptId] || { independentCorrect: 0, incorrect: 0, dontKnow: 0,
      reviewed: 0, penEvidence: 0, status: 'unprobed' }
    if (outcome === 'correct') concept.independentCorrect++
    if (outcome === 'incorrect') concept.incorrect++
    if (outcome === 'dontKnow') concept.dontKnow++
    if (outcome === 'understood' || outcome === 'review') concept.penEvidence++
    if (outcome === 'review') concept.reviewed++
    concept.status = concept.incorrect || concept.dontKnow || concept.reviewed ? 'developing' :
      (concept.independentCorrect && concept.penEvidence ? 'secure' : 'emerging')
    state.concepts[move.conceptId] = concept
  }
  function schedule(state, conceptId, outcome) {
    var days = outcome === 'understood' ? 7 : 1
    var due = new Date(Date.now() + days * 86400000).toISOString()
    state.reviewQueue = state.reviewQueue.filter(function(row) { return row.conceptId !== conceptId })
    state.reviewQueue.push({ conceptId: conceptId, dueAt: due, reason: outcome === 'understood' ? 'transfer-check' : 'needs-review' })
  }

  function nextMove(session, moveId, outcome) {
    var move = session.moves.find(function(row) { return row.id === moveId })
    if (!move) fail('Current move is unknown')
    var route = outcome
    if (outcome === 'dontKnow' && !move.next.dontKnow) route = 'incorrect'
    if (!move.next[route]) fail('Move "' + move.id + '" has no "' + outcome + '" route')
    return move.next[route]
  }

  // Pure transition helper used by deterministic tests and future tutor providers. The provider
  // proposes a validated graph; it never owns navigation or learner-state mutation.
  function transition(session, priorState, moveId, outcome, response) {
    session = validateSession(session)
    var state = JSON.parse(JSON.stringify(priorState || blank(session)))
    var move = session.moves.find(function(row) { return row.id === moveId })
    if (!move) fail('Current move is unknown')
    record(state, move, outcome, response)
    if (move.kind === 'pen-explain' && (outcome === 'understood' || outcome === 'review'))
      schedule(state, move.conceptId, outcome)
    state.currentMoveId = nextMove(session, move.id, outcome)
    return state
  }

  function el(tag, cls, value) {
    var node = root.document.createElement(tag)
    if (cls) node.className = cls
    if (value != null) node.textContent = value
    return node
  }

  function open(reader, suppliedSession) {
    var session = suppliedSession ? validateSession(suppliedSession) : current(reader)
    if (!session) {
      if (root.BooxUI) root.BooxUI.toast('No guided session is available for this book yet')
      return false
    }
    var state = loadAttempt(reader, session)
    if (!session.moves.some(function(move) { return move.id === state.currentMoveId })) state = blank(session)
    var sheet = root.BooxUI.sheet({ title: session.title })
    sheet.root.classList.add('ls-sheet', 'rai-no-scroll')
    var host = el('div', 'ls-session')
    sheet.body.appendChild(host)
    var moveById = {}; session.moves.forEach(function(move) { moveById[move.id] = move })
    var evidenceById = {}; session.evidence.forEach(function(row) { evidenceById[row.id] = row })
    var conceptById = {}; session.concepts.forEach(function(row) { conceptById[row.id] = row })

    function go(moveId) {
      state.currentMoveId = moveId
      saveAttempt(reader, session, state)
      render()
    }
    function sourceLinks(move) {
      var wrap = el('div', 'ls-sources')
      move.evidenceRefs.forEach(function(ref) {
        var evidence = evidenceById[ref]
        var button = el('button', 'rai-secondary ls-source', 'Open source · ' + evidence.label)
        button.type = 'button'
        button.addEventListener('click', function() {
          root.BooxUI.closeSheet()
          if (reader.gotoStudyEvidence) reader.gotoStudyEvidence(evidence.target, function() {
            if (root.BooxUI) root.BooxUI.toast('Source opened · reopen Learn to continue')
          })
        })
        wrap.appendChild(button)
      })
      return wrap
    }
    function nextButton(label, moveId) {
      var button = el('button', 'rai-primary', label); button.type = 'button'
      button.addEventListener('click', function() { go(moveId) })
      return button
    }
    function render() {
      host.innerHTML = ''
      var move = moveById[state.currentMoveId]
      var concept = conceptById[move.conceptId]
      var head = el('header', 'ls-head')
      head.appendChild(el('span', 'rai-kicker', move.phase.toUpperCase() + ' · ' + session.domainPolicy.toUpperCase()))
      var moveCount = state.history.length + 1
      head.appendChild(el('span', 'ls-progress', moveCount + (moveCount === 1 ? ' move' : ' moves')))
      host.appendChild(head)
      host.appendChild(el('h2', 'ls-title', move.title))
      host.appendChild(el('p', 'ls-concept', concept.label + ' · ' + concept.kind.replace(/-/g, ' ') +
        ' · ' + concept.epistemicStatus.replace(/-/g, ' ')))
      if (move.prompt) host.appendChild(el('p', 'ls-prompt', move.prompt))

      if (move.kind === 'probe-choice') {
        var selected = null, answered = false
        var choices = el('div', 'ls-choices')
        var feedback = el('div', 'wb-feedback')
        move.choices.forEach(function(choice, index) {
          var button = el('button', 'rai-choice', choice); button.type = 'button'
          button.addEventListener('click', function() {
            selected = index
            Array.prototype.forEach.call(choices.children, function(row, at) { row.classList.toggle('selected', at === index) })
          })
          choices.appendChild(button)
        })
        var dontKnow = el('button', 'rai-secondary', 'I don’t know'); dontKnow.type = 'button'
        var check = el('button', 'rai-primary', 'Check and adapt'); check.type = 'button'
        function finishProbe(outcome) {
          if (answered) return
          answered = true
          record(state, move, outcome, outcome === 'dontKnow' ? { dontKnow: true } : { selectedIndex: selected })
          saveAttempt(reader, session, state)
          feedback.textContent = (outcome === 'correct' ? 'Correct. ' : outcome === 'dontKnow' ? 'That is useful evidence. ' : 'Not quite. ') + move.explanation
          feedback.classList.add('show')
          choices.querySelectorAll('button').forEach(function(button) { button.disabled = true })
          dontKnow.disabled = true; check.remove()
          var route = nextMove(session, move.id, outcome)
          actions.appendChild(nextButton('See my learning route', route))
        }
        check.addEventListener('click', function() {
          if (selected === null) { if (root.BooxUI) root.BooxUI.toast('Choose an answer or “I don’t know”'); return }
          finishProbe(selected === move.correctIndex ? 'correct' : 'incorrect')
        })
        dontKnow.addEventListener('click', function() { finishProbe('dontKnow') })
        host.appendChild(choices)
        var actions = el('div', 'wb-actions'); actions.appendChild(dontKnow); actions.appendChild(check); host.appendChild(actions)
        host.appendChild(feedback)
      } else if (move.kind === 'plan' || move.kind === 'teach') {
        host.appendChild(el('div', move.kind === 'plan' ? 'ls-plan' : 'ls-teaching', move.content))
        host.appendChild(nextButton(move.kind === 'plan' ? 'Start this route' : 'Check understanding', move.next.continue))
      } else if (move.kind === 'pen-explain') {
        var response = { note: '', strokes: [] }, drawing = null
        var canvas = root.document.createElement('canvas'); canvas.className = 'ls-canvas'
        canvas.width = 800; canvas.height = 280; canvas.setAttribute('aria-label', 'Pen explanation area')
        canvas.style.touchAction = 'none'
        var ctx = canvas.getContext && canvas.getContext('2d'), activePointer = null, presenter = null
        var ink = root.navigator && root.navigator.ink
        if (ink && typeof ink.requestPresenter === 'function') {
          ink.requestPresenter({ presentationArea: canvas }).then(function(value) {
            presenter = value
            console.info('DIAG [books-ink] learning delegated presenter ready')
          }, function(error) {
            console.info('DIAG [books-ink] learning delegated presenter unavailable: ' + String(error))
          })
        }
        function configureInk() {
          if (!ctx) return
          ctx.strokeStyle = '#222'; ctx.fillStyle = '#222'; ctx.lineWidth = 3
          ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        }
        function dot(point) {
          if (!ctx) return
          configureInk(); ctx.beginPath(); ctx.arc(point[0] * canvas.width, point[1] * canvas.height, 1.5, 0, Math.PI * 2); ctx.fill()
        }
        function segment(from, to) {
          if (!ctx) return
          configureInk(); ctx.beginPath(); ctx.moveTo(from[0] * canvas.width, from[1] * canvas.height)
          ctx.lineTo(to[0] * canvas.width, to[1] * canvas.height); ctx.stroke()
        }
        function repaint() {
          if (!ctx) return
          ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
          configureInk()
          response.strokes.forEach(function(stroke) {
            if (!stroke.length) return
            if (stroke.length === 1) { dot(stroke[0]); return }
            ctx.beginPath(); ctx.moveTo(stroke[0][0] * canvas.width, stroke[0][1] * canvas.height)
            stroke.slice(1).forEach(function(point) { ctx.lineTo(point[0] * canvas.width, point[1] * canvas.height) }); ctx.stroke()
          })
        }
        function point(event) { var rect = canvas.getBoundingClientRect(); return [
          (event.clientX - rect.left) / Math.max(1, rect.width), (event.clientY - rect.top) / Math.max(1, rect.height)] }
        canvas.addEventListener('pointerdown', function(event) {
          if (event.pointerType === 'touch') return
          drawing = [point(event)]; response.strokes.push(drawing); activePointer = event.pointerId
          if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId)
          dot(drawing[0])
          if (presenter) {
            var rect = canvas.getBoundingClientRect()
            presenter.updateInkTrailStartPoint(event, {
              color: '#222', diameter: Math.max(1, 3 * rect.width / Math.max(1, canvas.width))
            })
          }
          event.preventDefault()
        })
        canvas.addEventListener('pointermove', function(event) {
          if (!drawing || event.pointerId !== activePointer) return
          var samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
          if (!samples || !samples.length) samples = [event]
          samples.forEach(function(sample) {
            var next = point(sample), previousPoint = drawing[drawing.length - 1]
            if (Math.abs(next[0] - previousPoint[0]) + Math.abs(next[1] - previousPoint[1]) < 0.0005) return
            segment(previousPoint, next); drawing.push(next)
          })
          if (presenter) {
            var rect = canvas.getBoundingClientRect()
            presenter.updateInkTrailStartPoint(event, {
              color: '#222', diameter: Math.max(1, 3 * rect.width / Math.max(1, canvas.width))
            })
          }
          event.preventDefault()
        })
        function endDrawing(event) {
          if (event && activePointer !== null && event.pointerId !== activePointer) return
          drawing = null; activePointer = null
        }
        canvas.addEventListener('pointerup', endDrawing)
        canvas.addEventListener('pointercancel', endDrawing)
        repaint(); host.appendChild(canvas)
        var note = root.document.createElement('textarea'); note.className = 'ls-note'; note.rows = 2
        note.placeholder = 'Optional confirmed transcript or typed explanation'
        note.addEventListener('input', function() { response.note = note.value })
        host.appendChild(note)
        var clear = el('button', 'rai-secondary', 'Clear ink'); clear.type = 'button'
        clear.addEventListener('click', function() { response.strokes = []; repaint() })
        var compare = el('button', 'rai-primary', 'Compare with source rubric'); compare.type = 'button'
        var rubric = el('div', 'ls-rubric'); rubric.hidden = true
        rubric.appendChild(el('strong', null, 'Source-backed criteria'))
        rubric.appendChild(el('p', null, move.rubric))
        var assess = el('div', 'wb-actions'); assess.hidden = true
        var understood = el('button', 'rai-primary', 'I can explain this'); understood.type = 'button'
        var review = el('button', 'rai-secondary', 'Needs review'); review.type = 'button'
        function finishPen(outcome) {
          record(state, move, outcome, response); schedule(state, move.conceptId, outcome)
          saveAttempt(reader, session, state); go(move.next[outcome])
        }
        understood.addEventListener('click', function() { finishPen('understood') })
        review.addEventListener('click', function() { finishPen('review') })
        compare.addEventListener('click', function() {
          if (!response.strokes.length && !response.note.trim()) {
            if (root.BooxUI) root.BooxUI.toast('Write or type an explanation before revealing the rubric')
            return
          }
          rubric.hidden = false; assess.hidden = false; compare.disabled = true
        })
        var penActions = el('div', 'wb-actions'); penActions.appendChild(clear); penActions.appendChild(compare)
        assess.appendChild(review); assess.appendChild(understood)
        host.appendChild(penActions); host.appendChild(rubric); host.appendChild(assess)
      } else if (move.kind === 'finish') {
        state.completedAt = state.completedAt || new Date().toISOString(); saveAttempt(reader, session, state)
        host.appendChild(el('div', 'ls-finish', move.content))
        var list = el('div', 'ls-mastery')
        session.concepts.forEach(function(item) {
          var status = state.concepts[item.id] && state.concepts[item.id].status || 'not sampled'
          list.appendChild(el('div', 'ls-mastery-row', item.label + ' · ' + status))
        })
        host.appendChild(list)
        var due = state.reviewQueue.slice().sort(function(a, b) { return a.dueAt.localeCompare(b.dueAt) })[0]
        if (due) host.appendChild(el('p', 'ls-review-due', 'Next independent review · ' + new Date(due.dueAt).toLocaleDateString()))
        var restart = el('button', 'rai-secondary', 'Restart diagnostic'); restart.type = 'button'
        restart.addEventListener('click', function() { state = blank(session); saveAttempt(reader, session, state); render() })
        host.appendChild(restart)
      }
      host.appendChild(sourceLinks(move))
    }
    render()
    return true
  }

  function enabled() {
    return !!(root.KalamosConfig && root.KalamosConfig.booksAi && root.KalamosConfig.booksAi.learningSessions)
  }

  return { enabled: enabled, open: open, current: current, validateSession: validateSession,
    nodeKinds: NODE_KINDS.slice(), domainPolicies: POLICIES.slice(), moveKinds: MOVE_KINDS.slice(),
    transition: transition, nextMove: nextMove, _blank: blank, _record: record, _schedule: schedule }
})
