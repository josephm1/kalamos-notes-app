// Mature, data-only study-workbook renderer. The model never chooses HTML or a renderer: compiled
// interaction data reaches this module only after WorkbookContracts has validated trusted refs.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.WorkbookRenderer = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var KIND_ALIASES = {
    'single-choice': 'single-choice', 'mcq': 'single-choice',
    'multi-select': 'multi-select', 'tri-state': 'tri-state',
    'true-false-cant-tell': 'tri-state',
    'cloze': 'cloze', 'short-answer': 'short-answer', 'reveal-card': 'reveal-card',
    'numeric': 'numeric', 'numeric-answer': 'numeric', 'estimate-slider': 'estimate-slider',
    'ordering': 'ordering', 'sequence': 'ordering', 'timeline': 'timeline',
    'matching': 'matching', 'matching-pairs': 'matching', 'categorisation': 'categorisation', 'categorization': 'categorisation',
    'graph-plot': 'graph-plot', 'graph-plotting': 'graph-plot', 'hotspot': 'hotspot', 'diagram-labelling': 'diagram-labelling',
    'diagram-labeling': 'diagram-labelling', 'sketch': 'sketch', 'sketch-annotate': 'sketch',
    'interactive-scene': 'interactive-scene', 'logic-grid': 'logic-grid',
    'cipher': 'cipher', 'cipher-code': 'cipher', 'passage-set': 'passage-set', 'progressive-case': 'progressive-case'
  }

  function el(tag, cls, text) {
    var node = root.document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = String(text).replace(/\\+([£€$])/g, '$1')
    return node
  }

  function payload(activity) { return activity && activity.payload && typeof activity.payload === 'object' ? activity.payload : activity || {} }
  function kind(activity) { return KIND_ALIASES[String(activity && activity.kind || '')] || String(activity && activity.kind || '') }
  function arr(value) { return Array.isArray(value) ? value : [] }
  function norm(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toLocaleLowerCase() }
  function requestInkPresenter(canvas, label, ready) {
    var ink = root.navigator && root.navigator.ink
    if (!ink || typeof ink.requestPresenter !== 'function') return
    ink.requestPresenter({ presentationArea: canvas }).then(function(presenter) {
      ready(presenter)
      console.info('DIAG [books-ink] ' + label + ' delegated presenter ready')
    }, function(error) {
      console.info('DIAG [books-ink] ' + label + ' delegated presenter unavailable: ' + String(error))
    })
  }
  function coalescedPointerEvents(event) {
    if (!event || typeof event.getCoalescedEvents !== 'function') return [event]
    var samples = event.getCoalescedEvents()
    return samples && samples.length ? samples : [event]
  }
  function updateInkTrail(presenter, event, canvas, color, backingWidth) {
    if (!presenter || !event) return
    var rect = canvas.getBoundingClientRect()
    presenter.updateInkTrailStartPoint(event, {
      color: color,
      diameter: Math.max(1, 4 * rect.width / Math.max(1, backingWidth))
    })
  }
  function traceInkContact(label, event, started) {
    var age = started - event.timeStamp
    root.requestAnimationFrame(function(frameTime) {
      var frame = Math.max(0, frameTime - started)
      if ((age >= 20 && age < 60000) || frame >= 30) {
        console.info('DIAG [books-ink] ' + label + ' PEN_DOWN dispatch=' +
          (age >= 0 && age < 60000 ? age.toFixed(1) : 'unknown') + 'ms frame=' + frame.toFixed(1) + 'ms')
      }
    })
  }
  function learnerText(value) {
    // Evidence ids are machine provenance, not learner copy. Keep them in the activity/evidence
    // contract for audit and source navigation, but never leak them into authored feedback.
    return String(value == null ? '' : value)
      .replace(/\s*\((?:\s*(?:seg-)?p\d{3,5}-[a-z0-9-]+\s*,?)+\s*\)/gi, '')
      .replace(/\b(?:seg-)?p\d{3,5}-[a-z0-9-]+\b/gi, '')
      .replace(/\\+([£€$])/g, '$1')
      .replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  }
  function equalSet(a, b) {
    a = arr(a).map(String).sort(); b = arr(b).map(String).sort()
    return a.length === b.length && a.every(function(v, i) { return v === b[i] })
  }
  function ids(rows) { return arr(rows).map(function(row, i) { return String(row && row.id != null ? row.id : i) }) }
  function correctIds(data) {
    if (Array.isArray(data.answerIds)) return data.answerIds.map(String)
    if (Array.isArray(data.answers)) return data.answers.map(String)
    if (data.answerId != null) return [String(data.answerId)]
    if (Number.isInteger(data.correctIndex)) return [String(data.correctIndex)]
    return []
  }
  function choiceId(choice, index) { return String(choice && choice.id != null ? choice.id : index) }
  function choiceText(choice) {
    if (typeof choice === 'string' || typeof choice === 'number') return learnerText(choice)
    return learnerText(choice && (choice.text != null ? choice.text : choice.md) || '')
  }
  function displayChoiceText(choice, index) {
    var source = choiceText(choice)
    var key = 'ABCDEFGH'[index] || String(index + 1)
    // The control already supplies an accessible key badge. Many printed books retain that same
    // key in the authored option text ("a. ..."); hide only a matching leading control marker so
    // the payload/evidence remains verbatim without rendering "A  a." to the learner.
    var withoutDuplicateKey = source.replace(
      new RegExp('^\\s*' + key + '\\s*(?:[.)\\]:–—-])\\s*', 'i'), '')
    return withoutDuplicateKey || source
  }
  function answerSummary(activity) {
    var data = payload(activity), k = kind(activity)
    if (k === 'single-choice' || k === 'multi-select') {
      var expected = correctIds(data)
      if (Number.isInteger(data.correctIndex)) expected = [choiceId(arr(data.choices)[data.correctIndex], data.correctIndex)]
      var labels = arr(data.choices).filter(function(choice, index) {
        return expected.indexOf(choiceId(choice, index)) !== -1
      }).map(choiceText)
      return labels.length ? 'Source answer: ' + labels.join('; ') + '.' : ''
    }
    if (k === 'tri-state') return data.answer ? 'Source answer: ' + String(data.answer).replace(/-/g, ' ') + '.' : ''
    if (k === 'cloze') {
      var blanks = arr(data.blanks).map(function(blank) {
        var accepted = arr(blank.acceptedAnswers || blank.answers)
        return accepted.length ? String(blank.id || 'blank') + ': ' + accepted[0] : ''
      }).filter(Boolean)
      return blanks.length ? 'Source answer: ' + blanks.join('; ') + '.' : ''
    }
    if (k === 'matching') {
      var pairs = arr(data.pairs).map(function(pair) { return choiceText(pair.left) + ' → ' + choiceText(pair.right) })
      return pairs.length ? 'Source answer: ' + pairs.join('; ') + '.' : ''
    }
    if (k === 'ordering' || k === 'timeline') {
      var items = arr(data.items || data.events), byId = {}
      items.forEach(function(item, index) { byId[choiceId(item, index)] = choiceText(item) })
      var order = arr(data.correctOrder).map(String); if (!order.length) order = ids(items)
      var steps = order.map(function(id) { return byId[id] || '' }).filter(Boolean)
      return steps.length ? 'Source answer: ' + steps.join(' → ') + '.' : ''
    }
    if (k === 'short-answer' || k === 'cipher') {
      var accepted = arr(data.acceptedAnswers || data.answers || (data.answer != null ? [data.answer] : []))
      return accepted.length ? 'Source answer: ' + String(accepted[0]) + '.' : ''
    }
    return ''
  }
  function feedbackText(activity) {
    var explanation = learnerText(activity && activity.explanation)
    if (explanation) return explanation
    var exactAnswer = answerSummary(activity)
    var rubric = learnerText((activity && activity.rubric) || payload(activity).rubric)
    // A generic citation instruction may accompany a closed, fully validated answer payload. Show
    // the exact answer first; the evidence button still provides provenance and deeper review.
    if (exactAnswer) return exactAnswer + (rubric && !/^use (?:the )?(?:linked|cited) source evidence\.?$/i.test(rubric)
      ? ' ' + rubric : '')
    return rubric
  }
  function toast(message) { if (root.BooxUI && root.BooxUI.toast) root.BooxUI.toast(message) }

  function localScore(activity, response) {
    if (root.WorkbookContracts && typeof root.WorkbookContracts.score === 'function') {
      try {
        var scored = root.WorkbookContracts.score(activity, response)
        return {
          graded: !!scored.scorable,
          correct: scored.scorable ? !!scored.correct : null,
          score: scored.scorable ? scored.score : null,
          maxScore: scored.maxScore
        }
      } catch (e) {}
    }
    var data = payload(activity), k = kind(activity)
    if (k === 'single-choice' || k === 'multi-select') {
      var got = response && (response.selectedIds || (response.selectedId != null ? [response.selectedId] : []))
      var expected = correctIds(data)
      if (Number.isInteger(data.correctIndex)) expected = [choiceId(arr(data.choices)[data.correctIndex], data.correctIndex)]
      return { graded: true, correct: equalSet(got, expected), score: equalSet(got, expected) ? 1 : 0 }
    }
    if (k === 'tri-state') {
      var tri = String(data.answer || data.correct || '').replace('_', '-').toLocaleLowerCase()
      var triGot = String(response && response.value || '').replace('_', '-').toLocaleLowerCase()
      return { graded: true, correct: tri === triGot, score: tri === triGot ? 1 : 0 }
    }
    if (k === 'numeric' || k === 'estimate-slider') {
      var number = Number(response && response.value)
      var min = data.acceptedMin != null ? Number(data.acceptedMin) :
        (data.minAnswer != null ? Number(data.minAnswer) : (data.min != null && data.answer == null ? Number(data.min) : Number(data.answer) - Math.abs(Number(data.tolerance) || 0)))
      var max = data.acceptedMax != null ? Number(data.acceptedMax) :
        (data.maxAnswer != null ? Number(data.maxAnswer) : (data.max != null && data.answer == null ? Number(data.max) : Number(data.answer) + Math.abs(Number(data.tolerance) || 0)))
      var numberOk = Number.isFinite(number) && Number.isFinite(min) && Number.isFinite(max) && number >= min && number <= max
      return { graded: true, correct: numberOk, score: numberOk ? 1 : 0 }
    }
    if (k === 'ordering' || k === 'timeline') {
      var orderExpected = arr(data.correctOrder).map(String)
      if (!orderExpected.length) orderExpected = ids(data.items)
      var orderOk = equalSet(response && response.order, orderExpected) &&
        arr(response && response.order).every(function(value, index) { return String(value) === orderExpected[index] })
      return { graded: true, correct: orderOk, score: orderOk ? 1 : 0 }
    }
    if (k === 'matching' || k === 'categorisation' || k === 'diagram-labelling') {
      var expectedMap = data.answer || data.matches || data.assignments || {}
      var gotMap = response && response.assignments || {}
      var keys = Object.keys(expectedMap)
      var mapOk = keys.length > 0 && keys.every(function(key) { return String(gotMap[key]) === String(expectedMap[key]) })
      return { graded: true, correct: mapOk, score: mapOk ? 1 : 0 }
    }
    if (k === 'cloze' || k === 'short-answer' || k === 'cipher') {
      var accepted = arr(data.acceptedAnswers || data.answers || (data.answer != null ? [data.answer] : []))
      var textOk = accepted.some(function(value) { return norm(value) === norm(response && response.text) })
      return { graded: accepted.length > 0, correct: textOk, score: textOk ? 1 : 0 }
    }
    if (k === 'hotspot') {
      var point = response && response.point
      var regions = arr(data.regions || data.acceptedRegions || (data.target ? [data.target] : []))
      var pointOk = !!point && regions.some(function(region) {
        var r = Array.isArray(region) ? region : [region.x1, region.y1, region.x2, region.y2]
        return r.length === 4 && point.x >= r[0] && point.x <= r[2] && point.y >= r[1] && point.y <= r[3]
      })
      return { graded: true, correct: pointOk, score: pointOk ? 1 : 0 }
    }
    if (k === 'logic-grid') {
      var solution = data.solution || {}
      var grid = response && response.grid || {}
      var gridKeys = Object.keys(solution)
      var gridOk = gridKeys.length > 0 && gridKeys.every(function(key) { return String(grid[key]) === String(solution[key]) })
      return { graded: true, correct: gridOk, score: gridOk ? 1 : 0 }
    }
    return { graded: false, correct: null, score: null }
  }

  function attempt(reader, spec) {
    return root.WorkbookAttempts.load(reader, spec.groupId, spec.mode)
  }
  function activityState(reader, spec, activity) {
    var state = attempt(reader, spec)
    return state.activities[activity.id] || {
      status: 'open', response: null, checks: 0, hintsUsed: 0, score: null, revealed: false
    }
  }
  function persist(reader, spec, activity, patch) {
    return root.WorkbookAttempts.update(reader, spec.groupId, activity.id, patch, spec.mode)
  }

  function installPageComposer(wrap, items, reader, options) {
    options = options || {}
    var deck = el('div', 'wb-page-deck')
    var navigation = el('nav', 'wb-page-navigation')
    navigation.setAttribute('aria-label', 'Activity pages')
    var previous = el('button', 'wb-page-turn wb-page-previous', '‹ Prev'); previous.type = 'button'
    var readout = el('strong', 'wb-page-readout')
    var next = el('button', 'wb-page-turn wb-page-next', 'Next ›'); next.type = 'button'
    var contextButton = el('button', 'wb-context-jump', 'Context'); contextButton.type = 'button'; contextButton.hidden = true
    navigation.appendChild(readout); navigation.appendChild(contextButton)
    wrap.innerHTML = ''
    // Keep the edge controls outside the pointer-transparent navigation overlay. Some WebViews
    // and browser automation stacks do not retarget pointer events to descendants of a
    // pointer-events:none parent even when the child opts back in.
    wrap.appendChild(deck); wrap.appendChild(navigation); wrap.appendChild(previous); wrap.appendChild(next)

    var units = []
    items.forEach(function(item) {
      if (item && item.classList && item.classList.contains('wb-paged-control')) {
        Array.prototype.slice.call(item.children).forEach(function(child) { units.push(child) })
      } else if (item) units.push(item)
    })
    units.forEach(function(unit, unitIndex) {
      unit.classList.add('wb-composer-unit')
      if (unit.classList.contains('wb-activity-heading')) unit.dataset.keepWithNext = 'true'
      if (unit.classList.contains('wb-child-question') || unit.classList.contains('wb-context-table-wrap') ||
          unit.classList.contains('wb-figure-page') || unit.querySelector('canvas,.wb-choices,.wb-order-list,.wb-match-grid')) {
        unit.dataset.keepTogether = 'true'
      }
      if (unit.classList.contains('wb-actions')) unit.dataset.keepWithPrevious = 'true'
      // Units are detached while the composer is assembled. Typeset them now, before the first
      // measurement pass, so page breaks use the final glyph geometry rather than raw TeX width.
      renderAuthoredMath(unit)
    })
    var pages = [], index = 0, lastQuestionPage = 0, contextPage = -1
    function splitLongContextTables(capacity) {
      var expanded = []
      units.forEach(function(unit) {
        var table = unit.classList.contains('wb-context-page') && unit.querySelector(':scope .wb-context-table')
        var body = table && table.tBodies && table.tBodies[0]
        var rows = body ? Array.prototype.slice.call(body.rows) : []
        if (!table || rows.length < 2) { expanded.push(unit); return }

        // Determine row grouping from the actual client geometry. Source extraction deliberately
        // supplies semantic rows, not device-sized sheets; the reader repeats headers and chooses
        // safe breaks for its current font scale, width and available height.
        var probe = unit.cloneNode(true)
        probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; probe.style.pointerEvents = 'none'
        probe.style.width = Math.max(240, deck.clientWidth || 0) + 'px'
        probe.style.height = 'auto'; probe.style.maxHeight = 'none'
        var probeBody = probe.querySelector(':scope .wb-context-table tbody')
        if (!probeBody) { expanded.push(unit); return }
        probeBody.innerHTML = ''
        deck.appendChild(probe)
        var groups = [], group = []
        rows.forEach(function(row) {
          var candidate = row.cloneNode(true)
          probeBody.appendChild(candidate)
          var height = probe.getBoundingClientRect ? probe.getBoundingClientRect().height || 0 : 0
          if (height > capacity - 8 && group.length) {
            candidate.remove(); groups.push(group); group = [row]
            probeBody.innerHTML = ''; probeBody.appendChild(row.cloneNode(true))
          } else group.push(row)
        })
        if (group.length) groups.push(group)
        probe.remove()
        if (groups.length <= 1) { expanded.push(unit); return }
        var originalTitle = unit.querySelector(':scope > .wb-shared-context-title')
        groups.forEach(function(rowGroup, groupIndex) {
          var part = unit.cloneNode(true)
          var partBody = part.querySelector(':scope .wb-context-table tbody')
          partBody.innerHTML = ''
          rowGroup.forEach(function(row) { partBody.appendChild(row) })
          var title = part.querySelector(':scope > .wb-shared-context-title')
          if (title) title.textContent = String(originalTitle && originalTitle.textContent || title.textContent || '') +
            ' · page ' + (groupIndex + 1) + '/' + groups.length
          part.dataset.keepTogether = 'true'; expanded.push(part)
        })
      })
      units = expanded
    }
    function splitLongChoiceQuestions(capacity) {
      // A narrow reader can still report roughly 700px of deck height. Five answer rows plus
      // a realistic question stem do not fit in that space, so use conservative two-option
      // continuations below the tablet-sized deck threshold. Moving the original buttons keeps
      // their listeners and answer state intact; cloning is limited to the read-only stem.
      var expanded = []
      function choicesThatFit(unit, buttons, omitRepeatedPrompt) {
        // Measure the actual client layout at its current width. Device classes and authored text
        // lengths vary too much for a fixed "two/three choices per sheet" rule.
        var probe = unit.cloneNode(true)
        probe.style.position = 'absolute'; probe.style.visibility = 'hidden'
        probe.style.pointerEvents = 'none'; probe.style.width = Math.max(240, deck.clientWidth || 0) + 'px'
        probe.style.height = 'auto'; probe.style.maxHeight = 'none'
        deck.appendChild(probe)
        if (omitRepeatedPrompt) {
          var repeatedPrompt = probe.querySelector('.wb-child-prompt')
          if (repeatedPrompt) repeatedPrompt.remove()
        }
        // Revealed feedback is always composed on its own answer page, so it must not reduce the
        // measured choice capacity and force otherwise fitting options onto sparse sheets.
        var repeatedFeedback = probe.querySelector('.wb-child-feedback')
        if (repeatedFeedback) repeatedFeedback.remove()
        var list = probe.querySelector('.wb-choices')
        var available = Math.max(180, capacity - 12)
        var fit = 0
        if (list) {
          var probeButtons = Array.prototype.slice.call(list.children)
          for (var count = probeButtons.length; count >= 1; count -= 1) {
            probeButtons.forEach(function(button, index) { button.hidden = index >= count })
            var extent = Math.max(probe.scrollHeight || 0,
              probe.getBoundingClientRect ? probe.getBoundingClientRect().height || 0 : 0)
            if (extent > 0 && extent <= available) { fit = count; break }
          }
        }
        probe.remove()
        // Headless/early-layout engines can transiently return zero. Preserve a safe bounded
        // fallback only for that measurement failure; normal clients remain fully dynamic.
        return fit || (capacity > 800 ? buttons.length : 2)
      }
      function appendQuestionFeedbackPages(unit, feedback) {
        var text = feedback && feedback.classList.contains('show')
          ? String(feedback.textContent || '').trim() : ''
        if (!text) return false
        feedback.remove()
        // Explanations are subsequently measured by the sheet composer. Use most of a sheet's
        // realistic reading capacity here; the old one-third budget produced four sparse screens
        // for ordinary paragraphs even though two readable screens fit comfortably.
        var chunkLimit = Math.max(480, Math.floor(capacity * .76))
        // Display math is an authored atom. Splitting on ordinary whitespace used to cut a
        // `$$...$$` expression between answer sheets, leaving literal TeX on tablet layouts
        // even when the same explanation happened to fit on a narrow layout. Tokenise complete
        // display expressions first so pagination may move one, but can never bisect one.
        var words = text.match(/\$\$[\s\S]*?\$\$|\S+/g) || []
        var chunks = [], chunk = ''
        words.forEach(function(word) {
          if (chunk && chunk.length + word.length + 1 > chunkLimit) {
            chunks.push(chunk); chunk = word
          } else chunk += (chunk ? ' ' : '') + word
        })
        if (chunk) chunks.push(chunk)
        chunks.forEach(function(part, index) {
          var page = el('section', 'wb-child-question wb-pagination-unit wb-answer-explanation')
          page.dataset.questionNumber = unit.dataset.questionNumber || ''
          page.appendChild(el('h3', null, 'Question ' + (unit.dataset.questionNumber || '') +
            ' · answer' + (chunks.length > 1 ? ' ' + (index + 1) + '/' + chunks.length : '')))
          var panel = index === 0 ? feedback : el('div', 'wb-feedback wb-child-feedback show')
          if (index === 0) panel.innerHTML = ''
          appendReadableText(panel, part)
          page.appendChild(panel); renderAuthoredMath(page)
          page.dataset.keepTogether = 'true'; expanded.push(page)
        })
        return true
      }
      units.forEach(function(unit) {
        if (unit.classList.contains('wb-answer-explanation')) { expanded.push(unit); return }
        var choices = unit.classList.contains('wb-child-question') && unit.querySelector('.wb-choices')
        var buttons = choices ? Array.prototype.slice.call(choices.children) : []
        var sourcePrompt = unit.querySelector('.wb-child-prompt')
        var choicesPerPart = choicesThatFit(unit, buttons, false)
        var feedback = unit.querySelector('.wb-child-feedback')
        if (buttons.length <= choicesPerPart) {
          var hasSeparateFeedback = feedback && feedback.classList.contains('show')
          if (hasSeparateFeedback) feedback.remove()
          expanded.push(unit)
          if (hasSeparateFeedback) appendQuestionFeedbackPages(unit, feedback)
          return
        }
        var prompt = sourcePrompt
        var heading = unit.querySelector('h3')
        var continuationChoices = Math.max(choicesPerPart, choicesThatFit(unit, buttons, true))
        var chunks = [], at = 0
        while (at < buttons.length) {
          var take = at === 0 ? choicesPerPart : continuationChoices
          chunks.push(buttons.slice(at, at + take)); at += take
        }
        at = 0
        chunks.forEach(function(chunk, chunkIndex) {
          var part = el('section', 'wb-child-question wb-pagination-unit wb-choice-continuation')
          part.dataset.questionNumber = unit.dataset.questionNumber || ''
          var pageNumber = chunkIndex + 1
          var pageTotal = chunks.length
          part.appendChild(el('h3', null, (heading ? heading.textContent : 'Question') +
            (pageTotal > 1 ? ' · choices ' + pageNumber + '/' + pageTotal : '')))
          // Keep the full authored stem on the first option sheet. Continuations retain the
          // question number and option progress but do not waste most of a small screen repeating
          // a long stem; this lets the client pack the remaining authored options dynamically.
          if (prompt && chunkIndex === 0) part.appendChild(prompt.cloneNode(true))
          var control = el('div', 'wb-child-control'), list = el('div', 'wb-choices')
          chunk.forEach(function(button) { list.appendChild(button) })
          control.appendChild(list); part.appendChild(control)
          at += chunk.length
          if (at >= buttons.length && feedback && !feedback.classList.contains('show')) part.appendChild(feedback)
          part.dataset.keepTogether = 'true'
          expanded.push(part)
        })
        if (feedback && feedback.classList.contains('show')) appendQuestionFeedbackPages(unit, feedback)
      })
      units = expanded
    }
    function splitRevealedStages(capacity) {
      var isNarrow = Number(root.innerWidth || 0) <= 430
      // Use the available sheet more fully. These are conservative character budgets rather
      // than page heights; the composer remains the final geometry authority. Sentence and list
      // boundaries below are more important than filling every last line.
      var expanded = [], chunkLimit = isNarrow ? 340 : 720
      var hardLimit = isNarrow ? 460 : 950
      // Recomposition starts from the live activity plus any previously generated continuation
      // units. Drop the latter and regenerate them from the current clue state; otherwise a clue
      // continuation can recursively become another numbered clue card.
      units = units.filter(function(unit) {
        return !unit.classList.contains('wb-clue-continuation') &&
          !unit.classList.contains('wb-context-continuation')
      })
      function naturalChunks(value, measuredLimit) {
        var effectiveLimit = measuredLimit || chunkLimit
        var effectiveHardLimit = measuredLimit ? Math.max(measuredLimit, Math.floor(measuredLimit * 1.35)) : hardLimit
        var decimalMarker = '\uE000'
        var blocks = String(value || '').replace(/(\d)\.(?=\d)/g, '$1' + decimalMarker)
          .replace(/\be\.g\./gi, function(value) { return value.replace(/\./g, decimalMarker) })
          .replace(/\bi\.e\./gi, function(value) { return value.replace(/\./g, decimalMarker) })
          .replace(/\s*([•▶■])\s*/g, '\n$1 ').split(/\n+/)
          .map(function(block) { return block.trim() }).filter(Boolean)
        var parts = []
        blocks.forEach(function(block) {
          var sentences = block.match(/[^.!?;]+(?:[.!?;]+|$)/g) || [block]
          sentences.forEach(function(sentence) {
            sentence = sentence.trim().replace(new RegExp(decimalMarker, 'g'), '.'); if (!sentence) return
            // A modestly long intact sentence reads better than two artificially balanced sheets.
            if (sentence.length <= effectiveHardLimit) { parts.push(sentence); return }
            // Extremely long OCR sentences still need a bounded fallback. Prefer clause/list
            // punctuation; split on words only when the source supplies no usable boundary.
            var clauses = sentence.indexOf('\u2022') >= 0
              ? sentence.split(/(?=\u2022)/)
              : (sentence.match(/[^,:]+(?:[,:]+|$)/g) || [sentence])
            var piece = ''
            clauses.forEach(function(clause) {
              clause = clause.trim(); if (!clause) return
              if (piece && piece.length + clause.length + 1 > effectiveHardLimit) { parts.push(piece); piece = clause }
              else piece += (piece ? ' ' : '') + clause
            })
            if (piece) parts.push(piece)
          })
        })
        // Preserve source block/list boundaries. A short category label may be semantically
        // meaningful (mnemonics, nested criteria, answer headings), so it must not be merged
        // into the next authored atom merely to fill the current sheet.
        var chunks = [], current = ''
        parts.forEach(function(part) {
          if (current && current.length + part.length + 1 > effectiveLimit) { chunks.push(current); current = part }
          else current += (current ? '\n' : '') + part
        })
        if (current) chunks.push(current)
        return chunks
      }
      units.forEach(function(unit) {
        var contextContinuations = []
        var contextCopy = unit.classList.contains('wb-stage') && !unit.dataset.contextSplit &&
          !unit.querySelector('input,textarea,select') ? unit.querySelector(':scope > .wb-context-copy') : null
        var contextText = contextCopy ? String(contextCopy.textContent || '').trim() : ''
        var measuredLimit = 0
        if (contextCopy && contextText) {
          var contextProbe = unit.cloneNode(true)
          contextProbe.style.position = 'absolute'; contextProbe.style.visibility = 'hidden'
          contextProbe.style.pointerEvents = 'none'; contextProbe.style.width = Math.max(240, deck.clientWidth || 0) + 'px'
          contextProbe.style.height = 'auto'; contextProbe.style.maxHeight = 'none'
          deck.appendChild(contextProbe)
          var probeHeight = contextProbe.getBoundingClientRect ? contextProbe.getBoundingClientRect().height || 0 : 0
          contextProbe.remove()
          // Leave headroom for asynchronous font/math layout and user font scaling. A context
          // card that already consumes most of the sheet is safer and more readable as two
          // natural-boundary cards even when the first synchronous probe is a few pixels short.
          if (probeHeight > capacity * .82) measuredLimit = Math.max(180,
            Math.floor(contextText.length * (capacity - 32) / probeHeight * .88))
        }
        var contextChunks = contextCopy ? naturalChunks(contextText, measuredLimit) : []
        if (contextChunks.length > 1) {
          contextCopy.textContent = contextChunks[0]
          unit.dataset.contextSplit = 'true'
          var contextNext = unit.querySelector(':scope > .wb-stage-next')
          if (contextNext) contextNext.remove()
          contextChunks.slice(1).forEach(function(chunk, chunkIndex) {
            var continuation = el('article',
              'wb-stage wb-stage-continuation wb-context-continuation wb-pagination-unit')
            continuation.dataset.stageSplit = 'true'
            continuation.appendChild(el('span', 'wb-stage-kicker', 'Source context'))
            continuation.appendChild(el('h3', null, 'Case context · ' + (chunkIndex + 2) +
              ' of ' + contextChunks.length))
            continuation.appendChild(el('p', 'wb-continuation-cue', 'Continued from the previous page'))
            var copy = el('p', 'wb-context-copy')
            appendReadableText(copy, chunk)
            continuation.appendChild(copy)
            if (contextNext && chunkIndex === contextChunks.length - 2) continuation.appendChild(contextNext)
            contextContinuations.push(continuation)
          })
        }
        var clueCopies = unit.classList.contains('wb-stage') && !unit.dataset.stageSplit
          ? Array.prototype.slice.call(unit.querySelectorAll('.wb-clue-copy')) : []
        // Keep the canonical clue nodes in the live stage for future recomposition, but hide them
        // from the compact question card. Continuation cards receive visible clones.
        clueCopies.forEach(function(clue) { clue.hidden = true })
        var feedback = unit.classList.contains('wb-stage') && !unit.dataset.stageSplit
          ? unit.querySelector('.wb-stage-feedback.show') : null
        var text = feedback ? String(feedback.textContent || '').trim() : ''
        expanded.push(unit)
        contextContinuations.forEach(function(continuation) { expanded.push(continuation) })
        clueCopies.forEach(function(clue, clueIndex) {
          var cluePage = el('article', 'wb-stage wb-stage-continuation wb-clue-continuation wb-pagination-unit')
          cluePage.dataset.stageSplit = 'true'
          cluePage.appendChild(el('span', 'wb-stage-kicker', 'Optional clue'))
          cluePage.appendChild(el('h3', null, 'Clue ' + (clueIndex + 1) + ' of ' + clueCopies.length))
          var visibleClue = clue.cloneNode(true); visibleClue.hidden = false
          cluePage.appendChild(visibleClue); expanded.push(cluePage)
        })
        if (!text) return
        var chunks = naturalChunks(text)
        var nextStage = unit.querySelector('.wb-stage-next')
        feedback.remove(); if (nextStage) nextStage.remove()
        unit.dataset.stageSplit = 'true'
        chunks.forEach(function(chunk, chunkIndex) {
          var continuation = el('article', 'wb-stage wb-stage-continuation wb-pagination-unit')
          continuation.dataset.stageSplit = 'true'
          continuation.appendChild(el('span', 'wb-stage-kicker', 'Authored response'))
          continuation.appendChild(el('h3', null, 'Source answer' +
            (chunks.length > 1 ? ' · ' + (chunkIndex + 1) + ' of ' + chunks.length : '')))
          var continuationFeedback = el('div', 'wb-feedback wb-stage-feedback show')
          appendReadableText(continuationFeedback, chunk.replace(/\s*([▶■])\s*/g, '\n$1 '))
          continuation.appendChild(continuationFeedback)
          if (nextStage && chunkIndex === chunks.length - 1) continuation.appendChild(nextStage)
          expanded.push(continuation)
        })
      })
      units = expanded
    }
    function splitRevealedAnswers(capacity) {
      units = units.filter(function(unit) { return !unit.classList.contains('wb-reveal-continuation') })
      var expanded = [], limit = Number(root.innerWidth || 0) <= 430 ? 430 : 900
      units.forEach(function(unit) {
        var answer = unit.matches && unit.matches('.wb-reveal-answer:not([hidden])')
          ? unit : (unit.querySelector && unit.querySelector('.wb-reveal-answer:not([hidden])'))
        var paragraphs = answer ? Array.prototype.slice.call(answer.querySelectorAll('.wb-reveal-answer-paragraph')) : []
        var full = answer ? String(answer.dataset.fullText || (paragraphs.length
          ? paragraphs.map(function(row) { return row.textContent || '' }).join('\n\n')
          : answer.textContent) || '').trim() : ''
        if (!answer || full.length <= limit) { expanded.push(unit); return }
        var words = full.split(/\s+/), chunks = [], chunk = ''
        words.forEach(function(word) {
          if (chunk && chunk.length + word.length + 1 > limit) { chunks.push(chunk); chunk = word }
          else chunk += (chunk ? ' ' : '') + word
        })
        if (chunk) chunks.push(chunk)
        answer.textContent = chunks[0]
        expanded.push(unit)
        chunks.slice(1).forEach(function(text, index) {
          var continuation = el('div', 'wb-pagination-unit wb-reveal-answer wb-reveal-continuation')
          continuation.appendChild(el('p', 'wb-reveal-answer-paragraph', text))
          continuation.dataset.keepTogether = 'true'; expanded.push(continuation)
        })
      })
      units = expanded
    }
    function pageIsQuestion(page) { return !!(page && page.querySelector('.wb-child-question')) }
    function updateContextButton() {
      contextPage = pages.findIndex(function(page) { return page.querySelector('.wb-context-page') })
      var hasQuestions = pages.some(pageIsQuestion)
      // Context is already visible on context sheets. The shortcut is useful only while answering.
      contextButton.hidden = contextPage < 0 || !hasQuestions || !pageIsQuestion(pages[index])
      if (!contextButton.hidden) contextButton.textContent = 'Context'
    }
    function show(requested) {
      index = Math.max(0, Math.min(pages.length - 1, requested))
      wrap.dataset.pageIndex = String(index)
      pages.forEach(function(page, pageIndex) {
        page.hidden = pageIndex !== index
        page.classList.toggle('current', pageIndex === index)
      })
      previous.disabled = index === 0 && !(reader && typeof reader.prevPage === 'function')
      next.disabled = index >= pages.length - 1 && !(reader && typeof reader.nextPage === 'function')
      next.textContent = index >= pages.length - 1 ? 'Continue ›' : 'Next ›'
      previous.setAttribute('aria-label', index === 0 ? 'Return to the book' : 'Previous activity page')
      next.setAttribute('aria-label', index >= pages.length - 1 ? 'Continue in the book' : 'Next activity page')
      var visibleQuestions = Array.prototype.slice.call(pages[index].querySelectorAll('.wb-child-question'))
        .map(function(question) { return Number(question.dataset.questionNumber || 0) }).filter(Boolean)
      var allQuestionNumbers = units.filter(function(unit) { return unit.classList.contains('wb-child-question') })
        .map(function(question) { return Number(question.dataset.questionNumber || 0) }).filter(Boolean)
      var totalQuestions = Math.max.apply(Math, [0].concat(allQuestionNumbers))
      if (visibleQuestions.length) {
        var firstQuestion = Math.min.apply(Math, visibleQuestions), lastQuestion = Math.max.apply(Math, visibleQuestions)
        readout.textContent = 'Question' + (firstQuestion === lastQuestion ? ' ' + firstQuestion : 's ' + firstQuestion + '–' + lastQuestion) +
          (totalQuestions ? ' of ' + totalQuestions : '') + ' · Screen ' + (index + 1) + ' of ' + Math.max(1, pages.length)
      } else readout.textContent = 'Activity sheet ' + (index + 1) + ' of ' + Math.max(1, pages.length)
      var navigationHidden = !!options.hideNavigation || pages.length < 2
      navigation.hidden = navigationHidden
      previous.hidden = navigationHidden
      next.hidden = navigationHidden
      if (pageIsQuestion(pages[index])) lastQuestionPage = index
      updateContextButton()
      // Replacing one absolute sheet with another can make browser scroll anchoring preserve the
      // old focused control's offset, shifting the new sheet above the physical viewport. Workbook
      // activities are explicitly no-scroll, so reset only scrollable ancestors of this activity.
      function resetInteractionScrollOrigin() {
        var node = pages[index]
        while (node && node !== root.document.body) {
          if (node.scrollTop) node.scrollTop = 0
          node = node.parentElement
        }
        if (root.scrollY && typeof root.scrollTo === 'function') root.scrollTo(root.scrollX || 0, 0)
      }
      resetInteractionScrollOrigin()
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(resetInteractionScrollOrigin)
      Array.prototype.slice.call(pages[index].querySelectorAll('img')).forEach(function(image) {
        if (!image.complete) image.addEventListener('load', resetInteractionScrollOrigin, { once: true })
      })
      if (typeof root.setTimeout === 'function') root.setTimeout(resetInteractionScrollOrigin, 0)
    }
    function goPrevious() {
      if (index > 0) show(index - 1)
      else if (reader && typeof reader.prevPage === 'function') reader.prevPage()
    }
    function goNext() {
      if (index + 1 < pages.length) show(index + 1)
      else if (reader && typeof reader.nextPage === 'function') reader.nextPage()
    }
    function layout() {
      var activeUnit = pages[index] && pages[index].firstElementChild
      deck.innerHTML = ''; pages = []
      var deckTop = deck.getBoundingClientRect ? deck.getBoundingClientRect().top : 0
      var viewportHeight = Number(root.innerHeight || 0)
      // The composer can be nested below the workbook masthead. clientHeight then describes the
      // unbounded inner box rather than the portion actually visible to the learner. Bound it by
      // the viewport and reserve the bottom readout so content never sits behind navigation.
      // The navigation layer fills the reader so its own box is not a useful measurement. Measure
      // the actual bottom controls after CSS/font scaling. Context starts hidden; reveal it only
      // invisibly for this geometry pass, then restore its semantic state.
      function bottomControlFootprint(control) {
        var hidden = !!control.hidden
        var priorVisibility = control.style.visibility
        if (hidden) { control.style.visibility = 'hidden'; control.hidden = false }
        var style = root.getComputedStyle ? root.getComputedStyle(control) : null
        var height = control.getBoundingClientRect ? control.getBoundingClientRect().height || 0 : 0
        var bottom = style ? parseFloat(style.bottom || 0) || 0 : 0
        if (hidden) { control.hidden = true; control.style.visibility = priorVisibility }
        return height + bottom
      }
      var navigationReserve = options.hideNavigation ? 0 : Math.max(bottomControlFootprint(readout),
        bottomControlFootprint(contextButton)) + 12
      var visibleHeight = viewportHeight && deckTop >= 0
        ? viewportHeight - deckTop - navigationReserve : 0
      var capacity = Math.max(220, Math.min(deck.clientHeight || visibleHeight || 0,
        visibleHeight || deck.clientHeight || 0))
      wrap.removeAttribute('data-page-composer-error')
      units.forEach(function(unit) {
        var fitted = []
        if (unit.dataset && unit.dataset.wbComposerFit === 'true') fitted.push(unit)
        Array.prototype.push.apply(fitted, unit.querySelectorAll ? unit.querySelectorAll('[data-wb-composer-fit="true"]') : [])
        fitted.forEach(function(node) {
          node.style.fontSize = node.dataset.wbComposerPriorFontSize || ''
          delete node.dataset.wbComposerPriorFontSize
          delete node.dataset.wbComposerFit
        })
      })
      splitLongContextTables(capacity)
      splitLongChoiceQuestions(capacity)
      splitRevealedStages(capacity)
      splitRevealedAnswers(capacity)
      var page = null
      function newPage() {
        page = el('section', 'wb-sheet-page')
        page.setAttribute('aria-label', 'Activity page ' + (pages.length + 1))
        page.style.height = capacity + 'px'
        page.style.bottom = 'auto'
        deck.appendChild(page); pages.push(page)
      }
      function tryOnePixelFit(unit, targetPage) {
        var overflow = targetPage.scrollHeight - capacity
        var style = root.getComputedStyle ? root.getComputedStyle(unit) : null
        var lineHeight = style ? parseFloat(style.lineHeight || 0) || 20 : 20
        // A one-pixel type reduction is allowed only for a genuinely tiny spill (at most three
        // lines). Larger content keeps its normal reading size and moves to the next sheet.
        if (overflow <= 0 || overflow > lineHeight * 3) return false
        var candidates = [unit]
        Array.prototype.push.apply(candidates, unit.querySelectorAll
          ? unit.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,button,.wb-reveal-answer') : [])
        var changed = []
        candidates.forEach(function(node) {
          var computed = root.getComputedStyle ? root.getComputedStyle(node) : null
          var size = computed ? parseFloat(computed.fontSize || 0) : 0
          if (!size || size <= 12) return
          node.dataset.wbComposerPriorFontSize = node.style.fontSize || ''
          node.dataset.wbComposerFit = 'true'
          node.style.fontSize = Math.max(12, size - 1) + 'px'
          changed.push(node)
        })
        if (changed.length && targetPage.scrollHeight <= capacity + 2) return true
        changed.forEach(function(node) {
          node.style.fontSize = node.dataset.wbComposerPriorFontSize || ''
          delete node.dataset.wbComposerPriorFontSize
          delete node.dataset.wbComposerFit
        })
        return false
      }
      newPage()
      units.forEach(function(unit) {
        if (unit.hidden) return
        if (unit.classList.contains('wb-answer-explanation') && page.children.length) newPage()
        var incomingTableSequence = unit.dataset && unit.dataset.tableContextSequence
        var existingTable = incomingTableSequence && page.querySelector('[data-table-context-sequence]')
        if (existingTable && existingTable.dataset.tableContextSequence !== incomingTableSequence) newPage()
        if (unit.classList.contains('wb-figure-page')) {
          // Independent figure atoms must not silently overlap. A following figure gets a fresh
          // sheet; ordinary questions may still use genuinely free space after a single figure.
          if (page.querySelector('.wb-figure-page')) newPage()
          // A sheet has a full-height minimum, so its scrollHeight reports the whole
          // capacity even when it contains only a short heading. Measure the semantic
          // objects already placed on the sheet instead of the sheet box itself.
          var usedHeight = Array.prototype.reduce.call(page.children, function(total, child) {
            return total + Math.max(child.scrollHeight || 0, child.getBoundingClientRect().height || 0) + 12
          }, 0)
          // Reserve a small composition gutter for collapsed heading/figure margins
          // that are not reflected consistently in child box measurements.
          var remaining = capacity - usedHeight - 24
          // Keep a figure with the activity heading when there is enough useful image area.
          // Only dedicate a sheet when the remaining space would make the source illegible.
          if (page.children.length && remaining < 260) { newPage(); remaining = capacity }
          var figureImage = unit.querySelector(':scope > img')
          var figureWidth = Math.max(240, unit.clientWidth || page.clientWidth || deck.clientWidth || 0)
          var intrinsicHeight = figureImage && figureImage.naturalWidth > 0
            ? figureWidth * figureImage.naturalHeight / figureImage.naturalWidth + 72 : capacity * .62
          // A figure is a keep-together semantic atom, not an instruction to reserve an otherwise
          // empty sheet. Give it enough readable area, then let the ordinary composer place the
          // next question beneath it whenever the measured space permits.
          var usefulHeight = Math.max(260, Math.min(capacity * .72, intrinsicHeight))
          unit.style.height = Math.max(220, Math.min(remaining, usefulHeight)) + 'px'
        }
        page.appendChild(unit)
        if (page.scrollHeight > capacity + 2 && page.children.length > 1 &&
            !tryOnePixelFit(unit, page)) {
          var previousUnit = unit.previousElementSibling
          var keepPair = previousUnit && previousUnit.dataset.keepWithNext === 'true'
          var keepPrevious = unit.dataset.keepWithPrevious === 'true' && previousUnit
          page.removeChild(unit)
          if (keepPair || keepPrevious) page.removeChild(previousUnit)
          newPage()
          if (keepPair || keepPrevious) page.appendChild(previousUnit)
          page.appendChild(unit)
          // Keeping related units together is a preference, not permission to clip them. If the
          // pair cannot fit on an otherwise empty sheet, retain the first unit and continue the
          // second on a fresh sheet.
          if (page.scrollHeight > capacity + 2 && (keepPair || keepPrevious)) {
            page.removeChild(unit)
            newPage()
            page.appendChild(unit)
          }
        }
        // On a one-unit sheet the sheet's own full-height CSS can report a few extra pixels even
        // when the semantic unit fits exactly (especially full-height figure stages). Diagnose the
        // indivisible unit itself; multi-unit overflow has already been split above.
        var unitStyle = root.getComputedStyle ? root.getComputedStyle(unit) : null
        // scrollHeight can inherit an inflated layout extent from a prior composition pass even
        // when the unit's rendered border box and every descendant fit on the new sheet. Treat the
        // current rendered box as authoritative; capture QA separately checks clipped descendants,
        // sheet overflow and controls, so this does not conceal a genuinely truncated activity.
        var renderedUnitHeight = unit.getBoundingClientRect
          ? unit.getBoundingClientRect().height || 0 : 0
        var unitExtent = (renderedUnitHeight || unit.scrollHeight || 0) +
          (unitStyle ? (parseFloat(unitStyle.marginTop || 0) || 0) +
            (parseFloat(unitStyle.marginBottom || 0) || 0) : 0)
        if (unitExtent > capacity + 2) {
          unit.classList.add('wb-page-oversize')
          page.classList.add('wb-page-layout-error')
          var unitLabel = (unit.className || unit.tagName || 'unknown').toString().replace(/\s+/g, ' ').trim()
          wrap.dataset.pageComposerError = 'An indivisible activity element exceeds the available page: ' + unitLabel
          wrap.dataset.pageComposerUnitHeight = String(Math.ceil(renderedUnitHeight || unit.scrollHeight || 0))
          wrap.dataset.pageComposerCapacity = String(Math.ceil(capacity))
          if (root.console && typeof root.console.error === 'function')
            root.console.error('Workbook page composer overflow', unit.className, unit.scrollHeight, capacity)
        } else unit.classList.remove('wb-page-oversize')
      })
      pages = pages.filter(function(candidate) {
        if (candidate.children.length) return true
        candidate.remove(); return false
      })
      pages.forEach(function(candidate) {
        candidate.classList.toggle('wb-figure-only-sheet', candidate.children.length === 1 &&
          candidate.firstElementChild.classList.contains('wb-figure-page'))
        var previousContext = false
        Array.prototype.slice.call(candidate.children).forEach(function(unit) {
          var currentContext = unit.classList.contains('wb-context-page')
          unit.classList.toggle('wb-context-seamless-continuation', currentContext && previousContext)
          var continuedHeading = currentContext && previousContext
            ? unit.querySelector('.wb-shared-context-title') : null
          if (continuedHeading && /continued/i.test(continuedHeading.textContent || '')) continuedHeading.hidden = true
          previousContext = currentContext
        })
      })
      var remembered = pages.findIndex(function(candidate) { return activeUnit && candidate.contains(activeUnit) })
      show(remembered >= 0 ? remembered : index)
    }
    previous.onclick = function(event) { event.preventDefault(); event.stopPropagation(); goPrevious() }
    next.onclick = function(event) { event.preventDefault(); event.stopPropagation(); goNext() }
    function openContext() {
      var existing = wrap.querySelector('.wb-context-overlay')
      if (existing) { existing.remove(); return }
      var contextUnits = units.filter(function(unit) { return unit.classList.contains('wb-context-page') })
      if (!contextUnits.length) return
      var overlay = el('section', 'iv-overlay wb-context-overlay')
      overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true')
      overlay.setAttribute('aria-label', 'Source context')
      overlay.style.overflow = 'auto'; overlay.style.padding = '24px'
      var close = el('button', 'wb-context-close', 'Back to question'); close.type = 'button'
      close.style.position = 'sticky'; close.style.top = '0'; close.style.zIndex = '2'
      close.addEventListener('click', function(event) { event.stopPropagation(); overlay.remove() })
      overlay.appendChild(close)
      var copies = contextUnits.map(function(unit) {
        var copy = unit.cloneNode(true); copy.hidden = false
        copy.classList.remove('wb-composer-unit'); copy.style.height = 'auto'
        return copy
      })
      // Composer sheets split long tables into bounded row groups for small screens. The modal is
      // scrollable, so reunite those groups into the authored table for fast comparison at a glance.
      var tableCopies = copies.filter(function(copy) { return !!copy.querySelector('.wb-context-table') })
      var tableSlices = Object.create(null)
      tableCopies.forEach(function(copy) {
        var key = String(copy.dataset.tableColumnGroup || '0')
        if (!tableSlices[key]) tableSlices[key] = []
        tableSlices[key].push(copy)
      })
      Object.keys(tableSlices).forEach(function(key) {
        var slice = tableSlices[key]
        if (slice.length < 2) return
        var primaryTable = slice[0].querySelector('.wb-context-table')
        var primaryBody = primaryTable && primaryTable.querySelector('tbody')
        slice.slice(1).forEach(function(copy) {
          var body = copy.querySelector('.wb-context-table tbody')
          if (primaryBody && body) Array.prototype.slice.call(body.children).forEach(function(row) {
            primaryBody.appendChild(row.cloneNode(true))
          })
        })
        var tableHeading = slice[0].querySelector('.wb-shared-context-title')
        if (tableHeading) tableHeading.textContent = tableHeading.textContent.replace(/\s*·\s*rows\s+\d+\/\d+\s*$/, '')
        copies = copies.filter(function(copy) { return slice.slice(1).indexOf(copy) < 0 })
      })
      // The paged composer needs diagnostic headings to distinguish split context units. In the
      // scrollable reading view those labels are visual noise, not source content. Remove only
      // renderer-generated headings; captions and every authored paragraph/table/figure remain.
      copies.forEach(function(copy, copyIndex) {
        var heading = copy.querySelector('.wb-shared-context-title')
        if (heading) heading.remove()
        Array.prototype.slice.call(copy.querySelectorAll('.wb-stage-kicker')).forEach(function(kicker) {
          kicker.remove()
        })
        var sourceCopy = copy.querySelector('.wb-context-copy')
        var sourceText = sourceCopy && String(sourceCopy.textContent || '').trim()
        if (copyIndex === 0 && sourceCopy && sourceText && sourceText.length <= 100 &&
            !/[.!?]$/.test(sourceText) && sourceText.split(/\s+/).length <= 12) {
          var sourceHeading = el('h2', 'wb-context-source-heading', sourceText)
          sourceCopy.parentNode.replaceChild(sourceHeading, sourceCopy)
        }
      })
      copies.forEach(function(copy) { overlay.appendChild(copy) })
      wrap.appendChild(overlay); close.focus()
    }
    contextButton.addEventListener('click', function(event) {
      event.preventDefault(); event.stopPropagation(); openContext()
    })
    wrap.addEventListener('wb:repaginate', function() { root.requestAnimationFrame(layout) })
    var startX = 0, startY = 0, startTarget = null, moved = false
    deck.addEventListener('pointerdown', function(event) {
      if (event.pointerType === 'pen') return
      startX = event.clientX; startY = event.clientY; startTarget = event.target; moved = false
    }, true)
    deck.addEventListener('pointermove', function(event) {
      if (Math.abs(event.clientX - startX) > 8 || Math.abs(event.clientY - startY) > 8) moved = true
    }, true)
    deck.addEventListener('pointerup', function(event) {
      if (event.pointerType === 'pen' || moved || !startTarget) return
      if (startTarget.closest && startTarget.closest('button,a,input,select,textarea,canvas,.wb-zoomable-figure,.wb-ink-region')) return
      var bounds = deck.getBoundingClientRect()
      var x = event.clientX - bounds.left
      var y = event.clientY - bounds.top
      if (y < bounds.height * .12 && reader && typeof reader.toggleBar === 'function') reader.toggleBar('top')
      else if (y > bounds.height * .88 && reader && typeof reader.toggleBar === 'function') reader.toggleBar('bottom')
      else if (x < bounds.width * .33) goPrevious()
      else if (x > bounds.width * .67) goNext()
    }, true)
    root.requestAnimationFrame(function() { root.requestAnimationFrame(layout) })
    return { refresh: function() { root.requestAnimationFrame(layout) }, show: show,
      pageCount: function() { return pages.length }, hasError: function() { return !!wrap.dataset.pageComposerError } }
  }

  function optionsOf(data) { return arr(data.choices || data.options || data.items) }

  function selectedPositions(data, selected) {
    var optionIds = optionsOf(data).map(function(choice, index) { return choiceId(choice, index) })
    return arr(selected).map(function(id) { return optionIds.indexOf(String(id)) })
      .filter(function(index) { return index >= 0 })
  }

  function renderChoice(host, data, previous, multi) {
    var selected = arr(previous && previous.selectedIds).map(String)
    if (!multi && previous && previous.selectedId != null) selected = [String(previous.selectedId)]
    if (multi && previous && Array.isArray(previous.selectedIndices)) selected = previous.selectedIndices.map(String)
    if (!multi && previous && previous.selectedIndex != null) selected = [String(previous.selectedIndex)]
    var buttons = [], readinessListener = null
    var choices = el('div', 'wb-choices')
    optionsOf(data).forEach(function(choice, index) {
      var id = choiceId(choice, index)
      var button = el('button', 'wb-choice')
      button.type = 'button'
      button.setAttribute('aria-pressed', selected.indexOf(id) !== -1 ? 'true' : 'false')
      button.appendChild(el('span', 'wb-choice-key', 'ABCDEFGH'[index] || String(index + 1)))
      button.appendChild(el('span', 'wb-choice-text', displayChoiceText(choice, index)))
      button.addEventListener('click', function() {
        var at = selected.indexOf(id)
        if (multi) {
          if (at === -1) selected.push(id); else selected.splice(at, 1)
        } else selected = [id]
        buttons.forEach(function(row) {
          var on = selected.indexOf(row.id) !== -1
          row.button.classList.toggle('selected', on)
          row.button.setAttribute('aria-pressed', on ? 'true' : 'false')
        })
        if (readinessListener) readinessListener()
      })
      choices.appendChild(button); buttons.push({ id: id, button: button })
    })
    host.appendChild(choices)
    return { response: function() {
      var positions = selectedPositions(data, selected)
      return multi
        ? { selectedIndices: positions.sort(function(a, b) { return a - b }) }
        : { selectedIndex: positions.length ? positions[0] : null }
    }, readyToCheck: function() { return selected.length > 0 },
      onReadinessChange: function(listener) { readinessListener = listener } }
  }

  function renderText(host, data, previous, numeric) {
    var input = root.document.createElement('input')
    input.className = 'wb-input'; input.type = numeric ? 'number' : 'text'
    input.inputMode = numeric ? 'decimal' : 'text'
    input.autocomplete = 'off'
    input.value = previous && (previous.value != null ? previous.value : previous.text) || ''
    input.placeholder = numeric ? 'Enter a value' : 'Enter your answer'
    input.setAttribute('aria-label', numeric ? 'Numeric answer' : 'Written answer')
    host.appendChild(input)
    if (data.unit) host.appendChild(el('div', 'wb-unit', data.unit))
    return { response: function() { return numeric ? { value: Number(input.value) } : { text: input.value } } }
  }

  function renderAnswer(host, data, previous) {
    var textControl = renderText(host, data, previous && previous.answer != null ? { text: previous.answer } : previous, false)
    return { response: function() { return { answer: textControl.response().text } } }
  }

  function renderCloze(host, data, previous) {
    var answers = Object.assign({}, previous && previous.answers || {})
    var wrap = el('div', 'wb-cloze')
    arr(data.blanks).forEach(function(blank, index) {
      var label = el('label', 'wb-cloze-field')
      label.appendChild(el('span', null, 'Blank ' + (index + 1)))
      var input = root.document.createElement('input')
      input.className = 'wb-input'; input.type = 'text'; input.autocomplete = 'off'
      input.value = answers[blank.id] || ''
      input.setAttribute('aria-label', 'Answer for blank ' + (index + 1))
      input.addEventListener('input', function() { answers[blank.id] = input.value })
      label.appendChild(input); wrap.appendChild(label)
    })
    host.appendChild(wrap)
    return { response: function() { return { answers: Object.assign({}, answers) } } }
  }

  function renderSlider(host, data, previous) {
    var row = el('div', 'wb-slider')
    var input = document.createElement('input'); input.type = 'range'
    input.min = String(data.min); input.max = String(data.max); input.step = String(data.step || 1)
    input.value = String(previous && previous.value != null ? previous.value : data.initial != null ? data.initial : data.min)
    input.setAttribute('aria-label', 'Estimated value')
    var value = el('output', 'wb-slider-value')
    function sync() { value.textContent = input.value + (data.unit ? ' ' + data.unit : '') }
    input.addEventListener('input', sync); sync()
    row.appendChild(input); row.appendChild(value); host.appendChild(row)
    return { response: function() { return { value: Number(input.value) } } }
  }

  function renderOrder(host, data, previous) {
    var source = arr(data.items || data.events)
    var byId = {}; source.forEach(function(item, index) { byId[choiceId(item, index)] = item })
    var order = arr(previous && previous.order).map(String).filter(function(id) { return byId[id] })
    ids(source).forEach(function(id) { if (order.indexOf(id) === -1) order.push(id) })
    var list = el('div', 'wb-order')
    function draw() {
      list.innerHTML = ''
      order.forEach(function(id, index) {
        var item = byId[id]
        var row = el('div', 'wb-order-row')
        row.appendChild(el('span', 'wb-order-position', String(index + 1)))
        row.appendChild(el('span', 'wb-order-text', choiceText(item)))
        var controls = el('span', 'wb-order-controls')
        // Arrow glyphs keep each reorder row to one responsive touch-target line. The accessible
        // name remains explicit; repeating two long text buttons per item made otherwise ordinary
        // 7–10 item authored sequences indivisible on phone-sized readers.
        var up = el('button', null, '↑'); up.type = 'button'; up.disabled = index === 0
        up.setAttribute('aria-label', 'Move up'); up.title = 'Move up'
        var down = el('button', null, '↓'); down.type = 'button'; down.disabled = index === order.length - 1
        down.setAttribute('aria-label', 'Move down'); down.title = 'Move down'
        up.addEventListener('click', function() { var t = order[index - 1]; order[index - 1] = id; order[index] = t; draw() })
        down.addEventListener('click', function() { var t = order[index + 1]; order[index + 1] = id; order[index] = t; draw() })
        controls.appendChild(up); controls.appendChild(down); row.appendChild(controls); list.appendChild(row)
      })
    }
    draw(); host.appendChild(list)
    return { response: function() { return { order: order.slice() } } }
  }

  function renderAssignments(host, data, previous, matching) {
    var left = matching ? arr(data.pairs).map(function(pair) { return pair.left }) : arr(data.items)
    var right = matching ? arr(data.pairs).map(function(pair) { return pair.right }) : arr(data.categories)
    var stored = matching ? arr(previous && previous.matches) : arr(previous && previous.assignments)
    var assignments = left.map(function(_, index) { return Number.isInteger(stored[index]) ? stored[index] : null })
    var wrap = el('div', 'wb-assignments')
    left.forEach(function(item, index) {
      var field = el('label', 'wb-assignment')
      field.appendChild(el('span', null, choiceText(item)))
      var select = root.document.createElement('select')
      select.setAttribute('aria-label', 'Match ' + choiceText(item))
      var empty = root.document.createElement('option'); empty.value = ''; empty.textContent = 'Choose'; select.appendChild(empty)
      right.forEach(function(target, targetIndex) {
        var option = root.document.createElement('option')
        option.value = String(targetIndex); option.textContent = choiceText(target); select.appendChild(option)
      })
      select.value = assignments[index] == null ? '' : String(assignments[index])
      select.addEventListener('change', function() { assignments[index] = select.value === '' ? null : Number(select.value) })
      field.appendChild(select); wrap.appendChild(field)
    })
    host.appendChild(wrap)
    return { response: function() { return matching ? { matches: assignments.slice() } : { assignments: assignments.slice() } } }
  }

  function figureUrl(reader, activity, data) {
    var figure = activity.figure || arr(activity.figures)[0] || data.figure || null
    var src = figure && (figure.assetRef || figure.previewHandle || figure.src || figure.path)
    if (!src) return ''
    if (root.AndroidBridge && reader && typeof reader._bookImageStreamUrl === 'function') return reader._bookImageStreamUrl(src)
    try { return root.Bridge.getNotebookAsset(reader.nbId, src) || '' } catch (e) { return '' }
  }

  function figureUrlForRef(reader, activity, figureRef) {
    var figure = arr(activity && activity.figures).find(function(row) { return row && row.id === figureRef })
    var src = figure && (figure.assetRef || figure.previewHandle || figure.src || figure.path)
    if (!src) return ''
    if (root.AndroidBridge && reader && typeof reader._bookImageStreamUrl === 'function') return reader._bookImageStreamUrl(src)
    try { return root.Bridge.getNotebookAsset(reader.nbId, src) || '' } catch (e) { return '' }
  }

  function enableFigureViewer(image, reader) {
    if (!image || !reader || typeof reader.openImageViewer !== 'function') return
    image.classList.add('wb-zoomable-figure')
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', (image.alt || 'Source figure') + ' · open zoom and pan')
    image.addEventListener('click', function(event) {
      event.stopPropagation()
      if (image.src) reader.openImageViewer(image.src)
    })
    image.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault(); event.stopPropagation()
      if (image.src) reader.openImageViewer(image.src)
    })
  }

  function renderHotspot(host, activity, data, previous, reader) {
    var wrap = el('div', 'wb-visual-target')
    var image = root.document.createElement('img'); image.alt = data.alt || 'Source figure'
    var url = figureUrl(reader, activity, data); if (url) image.src = url
    var marker = el('span', 'wb-target-marker')
    var point = previous && previous.point || null
    function sync() {
      marker.classList.toggle('show', !!point)
      if (point) { marker.style.left = point.x * 100 + '%'; marker.style.top = point.y * 100 + '%' }
    }
    wrap.appendChild(image); wrap.appendChild(marker)
    wrap.addEventListener('click', function(e) {
      var r = wrap.getBoundingClientRect()
      point = { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }
      sync()
    })
    sync(); host.appendChild(wrap)
    return { response: function() { return { point: point } } }
  }

  function renderDiagram(host, activity, data, previous, reader) {
    var placements = arr(previous && previous.placements).map(function(point) {
      return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null
    })
    while (placements.length < arr(data.labels).length) placements.push(null)
    var active = 0
    var labels = el('div', 'wb-diagram-labels')
    var buttons = []
    arr(data.labels).forEach(function(label, index) {
      var button = el('button', 'wb-secondary', label.text); button.type = 'button'
      button.setAttribute('aria-pressed', index === active ? 'true' : 'false')
      button.addEventListener('click', function() {
        active = index
        buttons.forEach(function(row, i) { row.setAttribute('aria-pressed', i === active ? 'true' : 'false') })
      })
      labels.appendChild(button); buttons.push(button)
    })
    host.appendChild(labels)
    var wrap = el('div', 'wb-visual-target wb-diagram-target')
    var image = root.document.createElement('img'); image.alt = 'Diagram to label'
    var url = figureUrl(reader, activity, data); if (url) image.src = url
    var markers = el('div', 'wb-diagram-markers')
    function redraw() {
      markers.innerHTML = ''
      placements.forEach(function(point, index) {
        if (!point) return
        var marker = el('span', 'wb-label-marker', String(index + 1))
        marker.style.left = point.x * 100 + '%'; marker.style.top = point.y * 100 + '%'
        markers.appendChild(marker)
      })
    }
    wrap.addEventListener('click', function(e) {
      var r = wrap.getBoundingClientRect()
      placements[active] = {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
      }
      redraw()
    })
    wrap.appendChild(image); wrap.appendChild(markers); host.appendChild(wrap); redraw()
    return { response: function() { return { placements: placements.slice() } } }
  }

  function renderGraph(host, data, previous) {
    var wrap = el('div', 'wb-ink-region wb-graph-region')
    var canvas = root.document.createElement('canvas'); canvas.width = 800; canvas.height = 520
    canvas.style.touchAction = 'none'
    canvas.setAttribute('aria-label', 'Graph plotting area')
    var points = arr(previous && previous.points).map(function(point) { return { x: Number(point.x), y: Number(point.y) } })
      .filter(function(point) { return Number.isFinite(point.x) && Number.isFinite(point.y) })
    var xAxis = data.xAxis, yAxis = data.yAxis, ctx = canvas.getContext && canvas.getContext('2d')
    var presenter = null, activePointer = null
    if (data.mode === 'freehand') requestInkPresenter(canvas, 'graph', function(value) { presenter = value })
    function px(point) {
      return [54 + (point.x - xAxis.min) / (xAxis.max - xAxis.min) * (canvas.width - 80),
        22 + (yAxis.max - point.y) / (yAxis.max - yAxis.min) * (canvas.height - 72)]
    }
    function graphPoint(e) {
      var r = canvas.getBoundingClientRect()
      var scaleX = canvas.width / Math.max(1, r.width), scaleY = canvas.height / Math.max(1, r.height)
      var localX = (e.clientX - r.left) * scaleX, localY = (e.clientY - r.top) * scaleY
      var plotWidth = canvas.width - 80, plotHeight = canvas.height - 72
      if (localX < 54 || localX > 54 + plotWidth || localY < 22 || localY > 22 + plotHeight) return null
      return {
        x: xAxis.min + ((localX - 54) / plotWidth) * (xAxis.max - xAxis.min),
        y: yAxis.max - ((localY - 22) / plotHeight) * (yAxis.max - yAxis.min)
      }
    }
    function repaint() {
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = '#171717'; ctx.lineWidth = 2; ctx.strokeRect(54, 22, canvas.width - 80, canvas.height - 72)
      ctx.fillStyle = '#173f5f'; ctx.strokeStyle = '#173f5f'; ctx.lineWidth = 4
      if (data.mode === 'polyline' && points.length > 1) {
        ctx.beginPath(); var first = px(points[0]); ctx.moveTo(first[0], first[1])
        points.slice(1).forEach(function(point) { var p = px(point); ctx.lineTo(p[0], p[1]) }); ctx.stroke()
      }
      points.forEach(function(point) { var p = px(point); ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill() })
    }
    function drawGraphSegment(from, to) {
      if (!ctx) return
      var a = px(from), b = px(to)
      ctx.strokeStyle = '#173f5f'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
    }
    var drawing = false
    canvas.addEventListener('pointerdown', function(e) {
      if (e.pointerType === 'touch' && data.mode === 'freehand') return
      var started = root.performance && root.performance.now ? root.performance.now() : Date.now()
      var point = graphPoint(e); if (!point) return
      e.stopPropagation(); e.preventDefault()
      if (data.mode === 'freehand') {
        drawing = true; activePointer = e.pointerId; points = [point]
        if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId)
      } else {
        points.push(point)
        var expectedCount = Math.max(1, arr(data.expectedPoints).length)
        if (points.length > expectedCount) points.shift()
      }
      repaint()
      if (data.mode === 'freehand') {
        updateInkTrail(presenter, e, canvas, '#173f5f', canvas.width)
        traceInkContact('graph', e, started)
      }
    })
    canvas.addEventListener('pointermove', function(e) {
      if (!drawing || e.pointerId !== activePointer) return
      coalescedPointerEvents(e).forEach(function(sample) {
        var point = graphPoint(sample); if (!point) return
        var previousPoint = points[points.length - 1]
        points.push(point)
        if (points.length > 250) { points.shift(); repaint() }
        else if (previousPoint) drawGraphSegment(previousPoint, point)
      })
      updateInkTrail(presenter, e, canvas, '#173f5f', canvas.width)
      e.preventDefault()
    })
    function endGraphStroke(e) {
      if (e && activePointer !== null && e.pointerId !== activePointer) return
      drawing = false; activePointer = null
    }
    canvas.addEventListener('pointerup', endGraphStroke)
    canvas.addEventListener('pointercancel', endGraphStroke)
    var clear = el('button', 'wb-secondary', 'Clear graph'); clear.type = 'button'; clear.addEventListener('click', function() { points = []; repaint() })
    wrap.appendChild(canvas); wrap.appendChild(clear); host.appendChild(wrap); repaint()
    return { response: function() { return { points: points.slice() } } }
  }

  function pointerCanvas(host, previous, mode) {
    var wrap = el('div', 'wb-ink-region')
    var canvas = root.document.createElement('canvas'); canvas.width = 800; canvas.height = mode === 'graph' ? 520 : 440
    canvas.style.touchAction = 'none'
    canvas.setAttribute('aria-label', mode === 'graph' ? 'Graph plotting area' : 'Sketch area')
    var strokes = arr(previous && previous.strokes).map(function(stroke) { return arr(stroke).map(function(p) { return [Number(p[0]), Number(p[1])] }) })
    var active = null, activePointer = null, presenter = null
    var ctx = canvas.getContext && canvas.getContext('2d')
    requestInkPresenter(canvas, 'sketch', function(value) { presenter = value })
    function configureInk() {
      if (!ctx) return
      ctx.strokeStyle = '#171717'; ctx.fillStyle = '#171717'
      ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    }
    function drawInkDot(point) {
      if (!ctx) return
      configureInk(); ctx.beginPath(); ctx.arc(point[0] * canvas.width, point[1] * canvas.height, 2, 0, Math.PI * 2); ctx.fill()
    }
    function drawInkSegment(from, to) {
      if (!ctx) return
      configureInk(); ctx.beginPath(); ctx.moveTo(from[0] * canvas.width, from[1] * canvas.height)
      ctx.lineTo(to[0] * canvas.width, to[1] * canvas.height); ctx.stroke()
    }
    function repaint() {
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      configureInk()
      if (mode === 'graph') {
        ctx.lineWidth = 2; ctx.strokeRect(54, 22, canvas.width - 80, canvas.height - 72)
        ctx.beginPath(); ctx.moveTo(54, canvas.height - 50); ctx.lineTo(canvas.width - 26, canvas.height - 50)
        ctx.moveTo(54, 22); ctx.lineTo(54, canvas.height - 50); ctx.stroke()
        ctx.lineWidth = 4
      }
      strokes.forEach(function(stroke) {
        if (!stroke.length) return
        if (stroke.length === 1) { drawInkDot(stroke[0]); return }
        ctx.beginPath(); ctx.moveTo(stroke[0][0] * canvas.width, stroke[0][1] * canvas.height)
        stroke.slice(1).forEach(function(p) { ctx.lineTo(p[0] * canvas.width, p[1] * canvas.height) }); ctx.stroke()
      })
    }
    function point(e) {
      var r = canvas.getBoundingClientRect()
      return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]
    }
    canvas.addEventListener('pointerdown', function(e) {
      if (e.pointerType === 'touch') return
      var started = root.performance && root.performance.now ? root.performance.now() : Date.now()
      e.stopPropagation(); e.preventDefault(); activePointer = e.pointerId; active = [point(e)]; strokes.push(active)
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId)
      drawInkDot(active[0])
      updateInkTrail(presenter, e, canvas, '#171717', canvas.width)
      traceInkContact('sketch', e, started)
    })
    canvas.addEventListener('pointermove', function(e) {
      if (!active || e.pointerId !== activePointer) return
      coalescedPointerEvents(e).forEach(function(sample) {
        var next = point(sample), previousPoint = active[active.length - 1]
        if (Math.abs(next[0] - previousPoint[0]) + Math.abs(next[1] - previousPoint[1]) < 0.0005) return
        drawInkSegment(previousPoint, next); active.push(next)
      })
      updateInkTrail(presenter, e, canvas, '#171717', canvas.width)
      e.preventDefault()
    })
    function end(e) {
      if (e && activePointer !== null && e.pointerId !== activePointer) return
      active = null; activePointer = null
    }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end)
    var clear = el('button', 'wb-secondary', 'Clear drawing'); clear.type = 'button'
    clear.addEventListener('click', function() { strokes = []; repaint() })
    wrap.appendChild(canvas); wrap.appendChild(clear); host.appendChild(wrap); repaint()
    return { response: function() { return { strokes: strokes } } }
  }

  function renderLogicGrid(host, data, previous) {
    var rows = arr(data.rows), columns = arr(data.columns)
    var prior = arr(previous && previous.grid)
    var grid = rows.map(function(_, ri) {
      return columns.map(function(_, ci) { return prior[ri] && prior[ri][ci] === 'yes' ? 'yes' : 'no' })
    })
    var table = el('table', 'wb-logic-grid'), head = el('tr')
    head.appendChild(el('th', null, ''))
    columns.forEach(function(column) { head.appendChild(el('th', null, choiceText(column))) }); table.appendChild(head)
    rows.forEach(function(row, ri) {
      var tr = el('tr'); tr.appendChild(el('th', null, choiceText(row)))
      columns.forEach(function(column, ci) {
        var td = el('td'), button = el('button', 'wb-grid-cell', grid[ri][ci] === 'yes' ? '✓' : '×'); button.type = 'button'
        button.setAttribute('aria-label', choiceText(row) + ' and ' + choiceText(column))
        button.dataset.value = grid[ri][ci]
        button.addEventListener('click', function() {
          grid[ri][ci] = grid[ri][ci] === 'yes' ? 'no' : 'yes'
          button.textContent = grid[ri][ci] === 'yes' ? '✓' : '×'
          button.dataset.value = grid[ri][ci]
        })
        td.appendChild(button); tr.appendChild(td)
      }); table.appendChild(tr)
    })
    host.appendChild(table)
    return { response: function() { return { grid: grid.map(function(row) { return row.slice() }) } } }
  }

  function sceneFrame(data, requestedIndex) {
    var steps = arr(data && data.steps)
    var index = Math.max(0, Math.min(steps.length - 1, Number(requestedIndex) || 0))
    var step = steps[index] || {}
    var visible = Object.create(null)
    arr(step.visibleLayerIds).forEach(function(id) { visible[id] = true })
    var byId = Object.create(null)
    var layers = arr(data && data.layers).map(function(source) {
      var layer = Object.assign({}, source, {
        visible: !!visible[source.id], scale: 1, rotation: 0, opacity: 1, emphasized: false
      })
      byId[layer.id] = layer
      return layer
    })
    arr(step.transforms).forEach(function(transform) {
      var layer = byId[transform.layerId]
      if (!layer) return
      if (Number.isFinite(transform.x)) layer.x = transform.x
      if (Number.isFinite(transform.y)) layer.y = transform.y
      if (Number.isFinite(transform.scale)) layer.scale = transform.scale
      if (Number.isFinite(transform.rotation)) layer.rotation = transform.rotation
    })
    arr(step.commands).forEach(function(command) {
      var layer = byId[command.layerId]
      if (!layer) return
      if (command.op === 'show') layer.visible = true
      else if (command.op === 'hide') layer.visible = false
      else if (command.op === 'move') {
        if (Number.isFinite(command.x)) layer.x = command.x
        if (Number.isFinite(command.y)) layer.y = command.y
      } else if (command.op === 'scale') layer.scale = command.value
      else if (command.op === 'rotate') layer.rotation = command.value
      else if (command.op === 'opacity') layer.opacity = command.value
      else if (command.op === 'emphasize') layer.emphasized = command.value >= 0.5
    })
    return { index: index, step: step, layers: layers }
  }

  function svgNode(name, attrs) {
    var node = root.document.createElementNS('http://www.w3.org/2000/svg', name)
    Object.keys(attrs || {}).forEach(function(key) { node.setAttribute(key, String(attrs[key])) })
    return node
  }

  function sceneStrokeDash(pattern) {
    if (pattern === 'dashed' || pattern === 'hatched') return '10 7'
    if (pattern === 'dotted' || pattern === 'crosshatched') return '2 6'
    return ''
  }

  function sceneMarker(svg, x, y, marker, size) {
    var shape
    if (marker === 'square') shape = svgNode('rect', { x: x - size, y: y - size, width: size * 2, height: size * 2 })
    else if (marker === 'diamond') shape = svgNode('polygon', { points: [x, y - size, x + size, y, x, y + size, x - size, y].join(' ') })
    else if (marker === 'cross') {
      shape = svgNode('path', { d: 'M ' + (x - size) + ' ' + (y - size) + ' L ' + (x + size) + ' ' + (y + size) + ' M ' + (x + size) + ' ' + (y - size) + ' L ' + (x - size) + ' ' + (y + size), fill: 'none' })
    } else shape = svgNode('circle', { cx: x, cy: y, r: size })
    shape.setAttribute('stroke', '#111')
    shape.setAttribute('stroke-width', '2')
    shape.setAttribute('fill', marker === 'cross' ? 'none' : '#fff')
    svg.appendChild(shape)
  }

  function renderPlotLayer(layer) {
    var svg = svgNode('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': layer.text || 'Data plot' })
    svg.style.width = '100%'; svg.style.height = '100%'; svg.style.background = '#fff'
    svg.appendChild(svgNode('rect', { x: 12, y: 6, width: 84, height: 82, fill: '#fff', stroke: '#111', 'stroke-width': 1.4 }))
    var xAxis = layer.xAxis, yAxis = layer.yAxis
    function px(point) {
      return [12 + (point.x - xAxis.min) / (xAxis.max - xAxis.min) * 84,
        88 - (point.y - yAxis.min) / (yAxis.max - yAxis.min) * 82]
    }
    var points = arr(layer.points), dash = sceneStrokeDash(layer.pattern)
    if (layer.plotMode === 'line' && points.length) {
      var line = svgNode('polyline', {
        points: points.map(function(point) { return px(point).join(',') }).join(' '),
        fill: 'none', stroke: '#111', 'stroke-width': layer.strokeWidth || 2,
        'stroke-dasharray': dash
      })
      svg.appendChild(line)
    }
    points.forEach(function(point) {
      var p = px(point)
      if (layer.plotMode === 'bar') {
        var baseline = px({ x: point.x, y: Math.max(yAxis.min, Math.min(yAxis.max, 0)) })[1]
        var width = Math.max(2.5, 62 / Math.max(1, points.length))
        svg.appendChild(svgNode('rect', {
          x: p[0] - width / 2, y: Math.min(p[1], baseline), width: width,
          height: Math.max(1, Math.abs(baseline - p[1])), fill: '#ddd', stroke: '#111', 'stroke-width': 1.4
        }))
      } else sceneMarker(svg, p[0], p[1], layer.marker, 2.2)
    })
    var xLabel = svgNode('text', { x: 54, y: 98, 'text-anchor': 'middle', fill: '#111', 'font-size': 6, 'font-weight': 700 })
    xLabel.textContent = xAxis.label || ''
    var yLabel = svgNode('text', { x: 4, y: 48, 'text-anchor': 'middle', fill: '#111', 'font-size': 6, 'font-weight': 700, transform: 'rotate(-90 4 48)' })
    yLabel.textContent = yAxis.label || ''
    svg.appendChild(xLabel); svg.appendChild(yLabel)
    return svg
  }

  function renderShapeLayer(layer, colourEnabled) {
    var svg = svgNode('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': layer.text || layer.type })
    svg.style.width = '100%'; svg.style.height = '100%'; svg.style.overflow = 'visible'
    var accents = { blue: '#b9d8ec', red: '#ecc5bf', green: '#c7dfc7', amber: '#ead9a8', violet: '#d8c9e8' }
    var fill = colourEnabled && accents[layer.accent] ? accents[layer.accent] : '#fff'
    if ((layer.pattern === 'hatched' || layer.pattern === 'crosshatched') && layer.type !== 'line' && layer.type !== 'arrow') {
      var patternId = 'wb-scene-pattern-' + String(layer.id).replace(/[^a-z0-9_-]/gi, '')
      var defs = svgNode('defs'), pattern = svgNode('pattern', { id: patternId, width: 12, height: 12, patternUnits: 'userSpaceOnUse' })
      pattern.appendChild(svgNode('rect', { width: 12, height: 12, fill: fill }))
      pattern.appendChild(svgNode('path', { d: 'M -3 3 L 3 -3 M 0 12 L 12 0 M 9 15 L 15 9', stroke: '#111', 'stroke-width': 1.4 }))
      if (layer.pattern === 'crosshatched') pattern.appendChild(svgNode('path', { d: 'M -3 9 L 3 15 M 0 0 L 12 12 M 9 -3 L 15 3', stroke: '#111', 'stroke-width': 1.4 }))
      defs.appendChild(pattern); svg.appendChild(defs); fill = 'url(#' + patternId + ')'
    }
    var attrs = { fill: fill, stroke: '#111', 'stroke-width': layer.strokeWidth || 2, 'stroke-dasharray': sceneStrokeDash(layer.pattern) }
    var shape
    if (layer.type === 'rect') shape = svgNode('rect', Object.assign({ x: 2, y: 2, width: 96, height: 96 }, attrs))
    else if (layer.type === 'circle') shape = svgNode('circle', Object.assign({ cx: 50, cy: 50, r: 47 }, attrs))
    else if (layer.type === 'ellipse') shape = svgNode('ellipse', Object.assign({ cx: 50, cy: 50, rx: 47, ry: 42 }, attrs))
    else if (layer.type === 'line' || layer.type === 'arrow') {
      shape = svgNode('line', Object.assign({ x1: 2, y1: 50, x2: layer.type === 'arrow' ? 82 : 98, y2: 50, fill: 'none' }, attrs))
      if (layer.type === 'arrow') svg.appendChild(svgNode('polyline', Object.assign({ points: '70,35 86,50 70,65', fill: 'none' }, attrs)))
    } else if (layer.type === 'polyline' || layer.type === 'polygon') {
      shape = svgNode(layer.type, Object.assign({
        points: arr(layer.points).map(function(point) { return (point.x * 100) + ',' + (point.y * 100) }).join(' '),
        fill: layer.type === 'polygon' ? fill : 'none'
      }, attrs))
    }
    if (shape) svg.appendChild(shape)
    if (layer.type === 'point') sceneMarker(svg, 50, 50, layer.marker, 18)
    return svg
  }

  function renderScene(host, activity, data, previous, reader) {
    var steps = arr(data.steps)
    var index = Math.max(0, Math.min(steps.length - 1, Number(previous && previous.step) || 0))
    var stage = el('div', 'wb-scene')
    var reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)
    var timer = null, previousButton = null, nextButton = null, playButton = null
    function stopPlay() {
      if (timer !== null) root.clearTimeout(timer)
      timer = null
      if (playButton) playButton.textContent = 'Play steps'
    }
    function draw() {
      stage.innerHTML = ''
      var frame = sceneFrame(data, index), step = frame.step
      stage.appendChild(el('strong', 'wb-scene-title', step.title || ('Step ' + (index + 1) + ' of ' + steps.length)))
      if (step.description) stage.appendChild(el('p', null, step.description))
      var plane = el('div', 'wb-scene-canvas')
      plane.style.position = 'relative'; plane.style.width = '100%'; plane.style.aspectRatio = String(data.canvas.width) + ' / ' + String(data.canvas.height)
      plane.style.maxHeight = '52vh'; plane.style.overflow = 'hidden'; plane.style.background = '#fff'; plane.style.border = '2px solid #111'
      if (data.backgroundFigureRef) {
        var background = root.document.createElement('img')
        background.alt = ''; background.setAttribute('aria-hidden', 'true')
        var backgroundUrl = figureUrlForRef(reader, activity, data.backgroundFigureRef)
        if (backgroundUrl) background.src = backgroundUrl
        background.style.position = 'absolute'; background.style.inset = '0'; background.style.width = '100%'; background.style.height = '100%'; background.style.objectFit = 'contain'
        plane.appendChild(background)
      }
      var colourEnabled = data.canvas.theme === 'colour-enhanced'
      frame.layers.filter(function(layer) { return layer.visible }).forEach(function(layer) {
        var item = el('div', 'wb-scene-primitive')
        item.dataset.primitive = layer.type; item.dataset.pattern = layer.pattern || 'solid'
        item.style.position = 'absolute'; item.style.left = layer.x * 100 + '%'; item.style.top = layer.y * 100 + '%'
        item.style.width = Math.max(0.01, layer.width) * 100 + '%'; item.style.height = Math.max(0.01, layer.height) * 100 + '%'
        item.style.transformOrigin = 'center'; item.style.transform = 'scale(' + layer.scale + ') rotate(' + layer.rotation + 'deg)'
        item.style.opacity = String(layer.opacity); item.style.boxSizing = 'border-box'
        if (layer.emphasized) item.style.outline = '5px double #111'
        if (layer.type === 'label') {
          item.textContent = layer.text || ''; item.style.padding = '5px'; item.style.color = '#111'; item.style.background = '#fff'; item.style.border = '2px solid #111'; item.style.fontWeight = '700'
        } else if (layer.type === 'code') {
          var code = root.document.createElement('code'); code.textContent = layer.text || ''
          var pre = root.document.createElement('pre'); pre.setAttribute('aria-label', (layer.language || 'text') + ' code example')
          pre.style.margin = '0'; pre.style.width = '100%'; pre.style.height = '100%'; pre.style.overflow = 'auto'; pre.style.boxSizing = 'border-box'
          pre.style.padding = '8px'; pre.style.whiteSpace = 'pre-wrap'; pre.style.color = '#111'; pre.style.background = '#fff'; pre.style.border = '2px solid #111'
          pre.appendChild(code); item.appendChild(pre)
        } else if (layer.type === 'figure') {
          var image = root.document.createElement('img'); image.alt = layer.text || 'Trusted source figure'
          var source = figureUrlForRef(reader, activity, layer.figureRef); if (source) image.src = source
          image.style.width = '100%'; image.style.height = '100%'; image.style.objectFit = 'contain'; image.style.border = '2px solid #111'; image.style.boxSizing = 'border-box'
          item.appendChild(image)
        } else if (layer.type === 'plot') item.appendChild(renderPlotLayer(layer))
        else item.appendChild(renderShapeLayer(layer, colourEnabled))
        plane.appendChild(item)
      })
      stage.appendChild(plane)
      if (previousButton) previousButton.disabled = index === 0
      if (nextButton) nextButton.disabled = index >= steps.length - 1
    }
    draw(); host.appendChild(stage)
    var requestedControls = arr(data.controls), controls = el('div', 'wb-inline-actions')
    if (requestedControls.indexOf('previous') >= 0) {
      previousButton = el('button', 'wb-secondary', 'Previous step'); previousButton.type = 'button'
      previousButton.addEventListener('click', function() { stopPlay(); if (index > 0) index--; draw() })
      controls.appendChild(previousButton)
    }
    if (requestedControls.indexOf('next') >= 0) {
      nextButton = el('button', 'wb-secondary', 'Next step'); nextButton.type = 'button'
      nextButton.addEventListener('click', function() { stopPlay(); if (index < steps.length - 1) index++; draw() })
      controls.appendChild(nextButton)
    }
    if (requestedControls.indexOf('play') >= 0) {
      playButton = el('button', 'wb-secondary', reducedMotion ? 'Show final still' : 'Play steps'); playButton.type = 'button'
      playButton.addEventListener('click', function() {
        if (reducedMotion) { index = Math.max(0, Math.min(steps.length - 1, Number(data.fallbackStep) || 0)); draw(); return }
        if (timer !== null) { stopPlay(); return }
        index = 0; playButton.textContent = 'Stop'
        function advance() {
          draw()
          if (index >= steps.length - 1) { stopPlay(); return }
          index++; timer = root.setTimeout(advance, 700)
        }
        advance()
      })
      controls.appendChild(playButton)
    }
    if (requestedControls.indexOf('reset') >= 0) {
      var reset = el('button', 'wb-secondary', 'Reset scene'); reset.type = 'button'
      reset.addEventListener('click', function() { stopPlay(); index = 0; draw() }); controls.appendChild(reset)
    }
    host.appendChild(controls); draw()
    return { response: function() { return { step: index } }, reviewOnly: true }
  }

  function renderPassageOrCase(host, activity, data, previous, reader, caseMode) {
    var stages = arr(data.stages)
    if (!stages.length && data.passage) stages = [{ title: data.title || 'Passage', text: data.passage }]
    var revealed = Math.max(0, Math.min(stages.length - 1, Number(previous && previous.revealedStage) || 0))
    var answers = Object.assign({}, previous && previous.answers || {})
    var revealedClues = Object.assign({}, previous && previous.revealedClues || {})
    var stageViews = [], readinessListener = null
    host.classList.add('wb-paged-control', caseMode ? 'wb-case' : 'wb-passage')
    stages.forEach(function(stage, index) {
      var article = el('article', 'wb-stage wb-pagination-unit')
      article.hidden = index > revealed
      article.appendChild(el('span', 'wb-stage-kicker', (caseMode ? 'Case stage ' : 'Question ') +
        (index + 1) + ' of ' + stages.length))
      article.appendChild(el('h3', null, stage.title || ('Stage ' + (index + 1))))
      if (stage.figureRef) {
        var stageFigure = arr(activity && activity.figures).find(function(row) { return row && row.id === stage.figureRef })
        var stageImage = root.document.createElement('img')
        stageImage.className = 'wb-child-figure'
        stageImage.alt = stageFigure && (stageFigure.altText || stageFigure.caption) || 'Source figure'
        var stageSrc = figureUrlForRef(reader, activity, stage.figureRef)
        if (stageSrc) stageImage.src = stageSrc
        enableFigureViewer(stageImage, reader)
        article.appendChild(stageImage)
      }
      article.appendChild(el('p', 'wb-context-copy', stage.text || stage.content || ''))
      var clues = arr(stage.clues), clueList = null, clueButton = null
      if (clues.length) {
        clueList = el('div', 'wb-stage-clues')
        function drawClues() {
          clueList.innerHTML = ''
          var count = Math.max(0, Math.min(clues.length, Number(revealedClues[index]) || 0))
          clues.slice(0, count).forEach(function(clue, clueIndex) {
            clueList.appendChild(el('p', 'wb-context-copy wb-clue-copy', 'Clue ' + (clueIndex + 1) + ': ' + clue))
          })
          if (clueButton) {
            clueButton.textContent = count < clues.length
              ? 'Reveal clue ' + (count + 1) + ' of ' + clues.length : 'All clues revealed'
            clueButton.disabled = count >= clues.length
          }
        }
        clueButton = el('button', 'wb-secondary wb-clue-reveal')
        clueButton.type = 'button'
        clueButton.addEventListener('click', function() {
          revealedClues[index] = Math.min(clues.length, (Number(revealedClues[index]) || 0) + 1)
          drawClues()
          host.dispatchEvent(new root.CustomEvent('wb:repaginate', { bubbles: true }))
        })
        drawClues()
      }
      var input = null
      if (stage.prompt) {
        var field = el('label', 'wb-cloze-field')
        field.appendChild(el('span', null, stage.prompt))
        input = root.document.createElement('input'); input.className = 'wb-input'; input.type = 'text'
        input.value = answers[index] || ''; input.setAttribute('aria-label', stage.prompt)
        input.addEventListener('input', function() { answers[index] = input.value })
        field.appendChild(input); article.appendChild(field)
      }
      if (clueButton) {
        article.appendChild(clueButton)
        article.appendChild(clueList)
      }
      var review = el('div', 'wb-feedback wb-stage-feedback')
      var sourceParagraphs = arr(stage.rubricParagraphs).map(readableAuthoredPrompt).filter(Boolean)
      review.textContent = sourceParagraphs.length ? sourceParagraphs.join('\n') :
        readableAuthoredPrompt(stage.rubric || (arr(stage.acceptedAnswers)[0] || ''))
      article.appendChild(review)
      if (index < stages.length - 1) {
        var next = el('button', 'wb-secondary wb-stage-next', caseMode ? 'Reveal next stage' : 'Continue passage')
        next.type = 'button'; next.addEventListener('click', function() {
          // The control promises a reveal: show the authored response for the stage just answered
          // before disclosing the next question. Final checking still reveals the last stage.
          if (review.textContent) review.classList.add('show')
          revealed = Math.max(revealed, index + 1)
          stageViews[index + 1].article.hidden = false
          // Once used, this control has no remaining action. Removing it from the review flow
          // keeps the complete case readable without a trail of inert progression buttons.
          next.hidden = true
          if (readinessListener) readinessListener()
          host.dispatchEvent(new root.CustomEvent('wb:repaginate', { bubbles: true }))
        })
        if (index < revealed) next.hidden = true
        article.appendChild(next)
      }
      stageViews.push({ article: article, input: input, review: review })
      host.appendChild(article)
    })
    var selfCheckOnly = !stages.some(function(stage) { return arr(stage.acceptedAnswers).length })
    return {
      response: function() { return { answers: Object.assign({}, answers), revealedStage: revealed,
        revealedClues: Object.assign({}, revealedClues) } },
      rubric: selfCheckOnly,
      readyToCheck: function() { return revealed >= stages.length - 1 },
      onReadinessChange: function(listener) { readinessListener = listener },
      showReview: function() {
        stageViews.forEach(function(view, index) {
          if (index <= revealed && view.review.textContent) view.review.classList.add('show')
        })
      }
    }
  }

  function isSharedQuestionSet(data) {
    return !!(data && data.context && Array.isArray(data.questions))
  }

  function presentationPrompt(activity) {
    var data = payload(activity), prompt = String(activity && activity.prompt || '').trim()
    if (Array.isArray(data.stages) && data.stages.length &&
        prompt === String(data.stages[0].prompt || '').trim())
      return data.presentation === 'clinical-case' ? 'Clinical case questions' : 'Source questions'
    if (!isSharedQuestionSet(data) || !data.questions.length ||
        prompt !== String(data.questions[0].prompt || '').trim()) return prompt || 'Study activity'
    var context = data.context || {}
    if (String(context.title || '').trim()) return String(context.title).trim()
    var firstLine = String(context.content || '').split(/\n+/).map(function(value) {
      return value.trim()
    }).filter(Boolean)[0] || ''
    if (firstLine && firstLine.length <= 120 && firstLine.split(/\s+/).length <= 16) return firstLine
    return 'Source-based questions'
  }

  function readableAuthoredPrompt(value) {
    // OCR often preserves source bullet markers inline. Keep the authored glyph and wording, but
    // restore the line boundary so a list does not read as debris attached to the prior sentence.
    return wrapLongDisplayMath(String(value || '')).replace(/\s*([•▶■])\s*/g, '\n$1 ')
      // PDF/Markdown extraction commonly escapes currency sigils to protect them from TeX.
      // In learner-facing plain text the backslash is implementation debris, not authored copy.
      .replace(/\\+([£€$])/g, '$1')
      .replace(/([A-Za-z])_\{([0-9]+)\}/g, function(_match, letter, digits) {
        var subscripts = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'}
        return letter + digits.split('').map(function(digit) { return subscripts[digit] }).join('')
      })
      .replace(/([A-Za-z]{3,})-\s+([a-z]{2,})/g, '$1$2')
      .replace(/\be\.\s*g\./gi, 'e.g.')
      .replace(/\bi\.\s*e\./gi, 'i.e.')
  }

  function wrapLongDisplayMath(value) {
    return String(value || '').replace(/\$\$([\s\S]*?)\$\$/g, function(full, expression) {
      if (expression.length < 95 || !/\\begin\{(?:array|aligned)\}/.test(expression)) return full
      var pieces = expression.split(/(\s+\+\s+)/), lineLength = 0
      var wrapped = pieces.map(function(piece) {
        if (!/^\s+\+\s+$/.test(piece)) { lineLength += piece.length; return piece }
        if (lineLength < 52) { lineLength += piece.length; return piece }
        lineLength = 2
        return ' \\\\ + '
      }).join('')
      return '$$' + wrapped + '$$'
    })
  }

  function appendReadableText(node, value) {
    var text = readableAuthoredPrompt(value), at = 0
    text.replace(/\b(?:e\.g\.|i\.e\.)/gi, function(match, offset) {
      if (offset > at) node.appendChild(root.document.createTextNode(text.slice(at, offset)))
      var abbreviation = el('span', 'wb-nowrap', match)
      node.appendChild(abbreviation); at = offset + match.length
      return match
    })
    if (at < text.length) node.appendChild(root.document.createTextNode(text.slice(at)))
  }

  function appendSharedContextContent(host, context, activity, reader, label, stageIndex, stageCount) {
    var activityTitle = presentationPrompt(activity)
    var title = label || context.title || (activityTitle !== 'Source-based questions'
      ? 'Scenario details' : 'Source material')
    var chunkLimit = Number(root.innerWidth || 0) <= 430 ? 420 : 760
    var clinical = payload(activity).presentation === 'clinical-case'
    var stagePrefix = Number.isInteger(stageIndex)
      ? (clinical ? 'Case stage ' : 'Reference ') + (stageIndex + 1) + ' of ' + stageCount + ' · ' : ''
    function sentenceChunks(value) {
      var decimalMarker = '\uE000'
      var protectedValue = String(value || '').replace(/(\d)\.(?=\d)/g, '$1' + decimalMarker)
      var sentences = protectedValue.match(/[^.!?]+(?:[.!?]+[\]\)'\"]*|$)/g) || [protectedValue]
      var chunks = [], current = ''
      sentences.forEach(function(sentence) {
        sentence = sentence.trim().replace(new RegExp(decimalMarker, 'g'), '.')
        if (!sentence) return
        var pieces = []
        if (sentence.length > chunkLimit) {
          var words = sentence.split(/\s+/), piece = ''
          words.forEach(function(word) {
            if (piece && piece.length + word.length + 1 > chunkLimit) { pieces.push(piece); piece = '' }
            piece += (piece ? ' ' : '') + word
          })
          if (piece) pieces.push(piece)
        } else pieces = [sentence]
        pieces.forEach(function(part) {
          if (current && current.length + part.length + 1 > chunkLimit) { chunks.push(current); current = '' }
          current += (current ? ' ' : '') + part
        })
      })
      if (current) chunks.push(current)
      return chunks.length ? chunks : [String(value || '')]
    }
    var paragraphs = String(context.content || '').split(/\n\s*\n/).map(function(value) { return value.trim() }).filter(Boolean)
    if (!paragraphs.length && context.content) paragraphs = [String(context.content)]
    // When the first source paragraph is promoted verbatim to the activity heading, represent it
    // there exactly once rather than immediately duplicating it as body copy.
    if (paragraphs.length && paragraphs[0] === activityTitle) paragraphs.shift()
    if (context.figureRef && activity && String(activity.prompt || '').trim() === String(context.content || '').trim()) {
      paragraphs = []
    }
    var semanticParts = paragraphs.reduce(function(all, value) {
      return all.concat(sentenceChunks(value))
    }, [])
    // OCR blocks and authored paragraphs are evidence boundaries, not page-layout instructions.
    // Pack adjacent material while retaining paragraph breaks so short headings/codes do not each
    // become a sparse learner page.
    paragraphs = []
    var packed = ''
    semanticParts.forEach(function(value) {
      if (packed && packed.length + value.length + 2 > chunkLimit) {
        paragraphs.push(packed); packed = ''
      }
      packed += (packed ? '\n\n' : '') + value
    })
    if (packed) paragraphs.push(packed)
    paragraphs.forEach(function(value, index) {
      var page = el('section', 'wb-stage wb-context-page wb-pagination-unit' + (stagePrefix ? ' wb-clinical-stage' : ''))
      if (stagePrefix) page.appendChild(el('span', 'wb-stage-kicker', stagePrefix.replace(/\s*·\s*$/, '')))
      page.appendChild(el('h3', 'wb-shared-context-title', title +
        (paragraphs.length > 1 && index > 0 ? ' · continued ' + (index + 1) + ' of ' + paragraphs.length : '')))
      var copy = el('p', 'wb-context-copy', value)
      copy.style.whiteSpace = 'pre-line'; page.appendChild(copy); host.appendChild(page)
    })
    if (context.table) {
      var rows = arr(context.table.rows), headers = arr(context.table.headers), rowGroups = []
      var tableSequence = Number(host._wbContextTableSequence || 0) + 1
      host._wbContextTableSequence = tableSequence
      for (var rowIndex = 0; rowIndex < rows.length; rowIndex += 5) rowGroups.push(rows.slice(rowIndex, rowIndex + 5))
      if (!rowGroups.length) rowGroups.push([])
      var tableWidth = headers.length || (rows[0] ? arr(rows[0]).length : 0)
      var columnGroups = [Array.from({ length: tableWidth }, function(_, index) { return index })]
      // Wide matrices that merely squeeze into a phone viewport are not readable: words collapse
      // into vertical letter stacks. Split columns semantically and repeat the authored row-label
      // column, while retaining every cell and its original order.
      if (Number(root.innerWidth || 0) <= 430 && tableWidth > 4) {
        var hasRowHeader = tableWidth > 1
        var dataStart = hasRowHeader ? 1 : 0
        columnGroups = []
        for (var columnIndex = dataStart; columnIndex < tableWidth; columnIndex += 2) {
          var group = []
          if (hasRowHeader) group.push(0)
          for (var offset = columnIndex; offset < Math.min(tableWidth, columnIndex + 2); offset++) group.push(offset)
          columnGroups.push(group)
        }
      }
      columnGroups.forEach(function(columnGroup, columnGroupIndex) {
      rowGroups.forEach(function(rowGroup, groupIndex) {
      var tablePage = el('section', 'wb-stage wb-context-page wb-pagination-unit' + (stagePrefix ? ' wb-clinical-stage' : ''))
      tablePage.dataset.tableColumnGroup = String(columnGroupIndex)
      tablePage.dataset.tableContextSequence = String(tableSequence)
      if (stagePrefix) tablePage.appendChild(el('span', 'wb-stage-kicker', stagePrefix.replace(/\s*·\s*$/, '')))
      var tableTitle = context.table.caption || title + ' · data'
      if (columnGroups.length > 1) tableTitle += ' · columns ' + (columnGroupIndex + 1) + '/' + columnGroups.length
      if (rowGroups.length > 1) tableTitle += ' · rows ' + (groupIndex + 1) + '/' + rowGroups.length
      tablePage.appendChild(el('h3', 'wb-shared-context-title', tableTitle))
      var scroll = el('div', 'wb-context-table-wrap')
      var table = el('table', 'wb-context-table')
      table.style.width = '100%'; table.style.borderCollapse = 'collapse'; table.style.background = '#fff'; table.style.color = '#000'
      if (context.table.caption) table.appendChild(el('caption', null, context.table.caption))
      if (headers.length) {
        var head = root.document.createElement('thead'), headRow = root.document.createElement('tr')
        columnGroup.forEach(function(column) {
          var value = headers[column]
          var cell = el('th', null, value); cell.scope = 'col'; cell.style.border = '2px solid #000'; cell.style.padding = '8px'; cell.style.textAlign = 'left'
          headRow.appendChild(cell)
        })
        head.appendChild(headRow); table.appendChild(head)
      }
      var body = root.document.createElement('tbody')
      rowGroup.forEach(function(row) {
        var tr = root.document.createElement('tr')
        columnGroup.forEach(function(column) {
          var value = arr(row)[column]
          var cell = el('td', null, value); cell.style.border = '1px solid #000'; cell.style.padding = '8px'
          tr.appendChild(cell)
        })
        body.appendChild(tr)
      })
      table.appendChild(body); scroll.appendChild(table); tablePage.appendChild(scroll); host.appendChild(tablePage)
      })
      })
    }
    if (context.figureRef) {
      var figurePage = el('section', 'wb-stage wb-context-page wb-figure-page wb-pagination-unit' + (stagePrefix ? ' wb-clinical-stage' : ''))
      if (stagePrefix) figurePage.appendChild(el('span', 'wb-stage-kicker', stagePrefix.replace(/\s*·\s*$/, '')))
      figurePage.appendChild(el('h3', 'wb-shared-context-title', title))
      var image = root.document.createElement('img')
      var figure = arr(activity && activity.figures).find(function(row) { return row && row.id === context.figureRef })
      image.alt = figure && (figure.altText || figure.caption) || 'Source figure'
      var src = figureUrlForRef(reader, activity, context.figureRef)
      if (src) image.src = src
      image.style.display = 'block'; image.style.maxWidth = '100%'; image.style.maxHeight = 'calc(100% - 60px)'; image.style.margin = '12px auto'; image.style.objectFit = 'contain'
      var preferredWidth = Number(figure && figure.presentation && figure.presentation.maxDisplayCssPx)
      if (Number.isFinite(preferredWidth) && preferredWidth > 0) {
        image.style.width = 'min(100%, ' + Math.round(preferredWidth) + 'px)'
        image.dataset.pixelPolicy = String(figure.presentation.pixelPolicy || '')
      }
      enableFigureViewer(image, reader)
      figurePage.appendChild(image); host.appendChild(figurePage)
    }
  }

  function renderSharedQuestionSet(host, activity, data, previous, reader) {
    var context = data.context || {}
    host.classList.add('wb-paged-control')
    var controls = [], answerState = Object.assign({}, previous && previous.answers || {})
    var readinessListener = null
    function visualOption(stage) {
      var match = String(stage && stage.title || '').match(/^Question\s+(.+?)\s*·\s*Option\s+([A-Z])$/i)
      return match && stage.figureRef ? { question: match[1], label: match[2].toUpperCase(), stage: stage } : null
    }
    function visualOptionsForQuestion(question) {
      var questionKey = String(question.id || '').replace(/-/g, '.').replace(/^q/i, '')
      return arr(context.stages).map(visualOption).filter(function(option) {
        return option && option.question.replace(/-/g, '.').replace(/^q/i, '') === questionKey
      })
    }
    function renderVisualChoiceControl(target, question, options, saved) {
      var selected = Number(saved && saved.selectedIndex)
      if (!Number.isInteger(selected)) selected = -1
      var change = null, grid = el('div', 'wb-selectable-visual-grid')
      function sync() {
        Array.prototype.slice.call(grid.children).forEach(function(card, index) {
          card.classList.toggle('selected', index === selected)
          var choose = card.querySelector('.wb-visual-choose')
          if (choose) choose.setAttribute('aria-pressed', index === selected ? 'true' : 'false')
        })
      }
      options.forEach(function(option, index) {
        var card = el('div', 'wb-visual-option-card wb-selectable-visual-card')
        card.appendChild(el('strong', 'wb-visual-option-label', option.label))
        var figure = arr(activity && activity.figures).find(function(row) {
          return row && row.id === option.stage.figureRef
        })
        var image = root.document.createElement('img')
        image.alt = 'Option ' + option.label + (figure && figure.altText ? ' · ' + figure.altText : '')
        var src = figureUrlForRef(reader, activity, option.stage.figureRef)
        if (src) image.src = src
        enableFigureViewer(image, reader)
        card.appendChild(image)
        var zoomHint = el('span', 'wb-visual-zoom-hint', 'Tap image to zoom')
        card.appendChild(zoomHint)
        var choose = el('button', 'wb-visual-choose', 'Choose ' + option.label); choose.type = 'button'
        choose.addEventListener('click', function() { selected = index; sync(); if (change) change() })
        card.appendChild(choose); grid.appendChild(card)
      })
      target.appendChild(grid); sync()
      return {
        response: function() { return { selectedIndex: selected } },
        readyToCheck: function() { return selected >= 0 },
        onReadinessChange: function(callback) { change = callback },
      }
    }
    function appendQuestion(question, index) {
      var section = el('section', 'wb-child-question wb-pagination-unit')
      section.dataset.questionNumber = String(index + 1)
      section.appendChild(el('h3', null, 'Question ' + (index + 1)))
      if (question.figureRef) {
        var questionFigure = arr(activity && activity.figures).find(function(row) { return row && row.id === question.figureRef })
        var questionImage = root.document.createElement('img')
        questionImage.className = 'wb-child-figure'
        questionImage.alt = questionFigure && (questionFigure.altText || questionFigure.caption) || 'Question figure'
        var questionSrc = figureUrlForRef(reader, activity, question.figureRef)
        if (questionSrc) questionImage.src = questionSrc
        enableFigureViewer(questionImage, reader)
        section.appendChild(questionImage)
      }
      section.appendChild(el('p', 'wb-child-prompt', readableAuthoredPrompt(question.prompt)))
      var childHost = el('div', 'wb-child-control')
      var childActivity = { kind: question.kind, payload: question.payload }
      var visualOptions = visualOptionsForQuestion(question)
      var expectedChoices = arr(question.payload && question.payload.choices).length
      var childControl = visualOptions.length > 1 && visualOptions.length === expectedChoices
        ? renderVisualChoiceControl(childHost, question, visualOptions, answerState[question.id])
        : renderActivityControl(childHost, childActivity, answerState[question.id], reader)
      var childFeedback = el('div', 'wb-feedback wb-child-feedback')
      section.appendChild(childHost); section.appendChild(childFeedback); host.appendChild(section)
      controls.push({ question: question, activity: childActivity, control: childControl, feedback: childFeedback })
      if (typeof childControl.onReadinessChange === 'function') {
        childControl.onReadinessChange(function() { if (readinessListener) readinessListener() })
      }
    }

    // Source material remains part of the question in practice and exam modes. Clinical stages
    // are interleaved with their questions so future examination or investigation findings never
    // disclose the answer before the learner has committed to the earlier decision.
    appendSharedContextContent(host, {
      title: context.title,
      content: context.content,
      table: context.table,
      figureRef: context.figureRef
    }, activity, reader)
    var questions = arr(data.questions)
    var stages = arr(context.stages)
    if (stages.length) {
      function appendVisualOptionGallery(options) {
        var galleryPage = el('section', 'wb-stage wb-context-page wb-figure-page wb-visual-option-gallery wb-pagination-unit')
        galleryPage.appendChild(el('span', 'wb-stage-kicker', 'Visual choices'))
        galleryPage.appendChild(el('h3', 'wb-shared-context-title', 'Question ' + options[0].question + ' · compare all options'))
        var grid = el('div', 'wb-visual-option-grid')
        options.forEach(function(option) {
          var card = el('figure', 'wb-visual-option-card')
          card.appendChild(el('figcaption', 'wb-visual-option-label', option.label))
          var figure = arr(activity && activity.figures).find(function(row) {
            return row && row.id === option.stage.figureRef
          })
          var image = root.document.createElement('img')
          image.alt = 'Option ' + option.label + (figure && figure.altText ? ' · ' + figure.altText : '')
          var src = figureUrlForRef(reader, activity, option.stage.figureRef)
          if (src) image.src = src
          enableFigureViewer(image, reader)
          card.appendChild(image); grid.appendChild(card)
        })
        galleryPage.appendChild(grid); host.appendChild(galleryPage)
      }
      for (var stageIndex = 0; stageIndex < stages.length;) {
        var option = visualOption(stages[stageIndex])
        if (option) {
          var optionFamily = [option], nextIndex = stageIndex + 1
          while (nextIndex < stages.length) {
            var nextOption = visualOption(stages[nextIndex])
            if (!nextOption || nextOption.question !== option.question) break
            optionFamily.push(nextOption); nextIndex++
          }
          // Comparison is the semantic task: authored alternatives belonging to one question must
          // remain simultaneously visible. A single option is left on the ordinary figure path.
          if (optionFamily.length > 1) {
            var matchingQuestion = questions.find(function(question) {
              return visualOptionsForQuestion(question).length === optionFamily.length &&
                visualOptionsForQuestion(question)[0].question === optionFamily[0].question
            })
            // Selectable visual controls carry this complete comparison set on the actual question
            // sheet. Retain a read-only gallery only when no exact source-cardinality match exists.
            if (!matchingQuestion) appendVisualOptionGallery(optionFamily)
            stageIndex = nextIndex
            continue
          }
        }
        var stage = stages[stageIndex]
        var sourceContinuation = /^source-continuation-/.test(String(stage.id || ''))
        appendSharedContextContent(host, stage, activity, reader, sourceContinuation ? null : stage.title,
          sourceContinuation ? null : stageIndex, sourceContinuation ? null : stages.length)
        questions.forEach(function(question, questionIndex) {
          if (question.afterStage === stage.id) appendQuestion(question, questionIndex)
        })
        stageIndex++
      }
      questions.forEach(function(question, questionIndex) {
        if (!question.afterStage) appendQuestion(question, questionIndex)
      })
    } else questions.forEach(appendQuestion)
    return {
      response: function() {
        var answers = {}
        controls.forEach(function(row) { answers[row.question.id] = row.control.response() })
        return {
          answers: answers,
          contextExpanded: true
        }
      },
      readyToCheck: function() {
        return controls.every(function(row) {
          return typeof row.control.readyToCheck !== 'function' || row.control.readyToCheck()
        })
      },
      onReadinessChange: function(listener) { readinessListener = listener },
      showReview: function() {
        controls.forEach(function(row) {
          var result = localScore(row.activity, row.control.response())
          row.feedback.innerHTML = ''
          row.feedback.classList.toggle('is-correct', !!result.graded && !!result.correct)
          row.feedback.classList.toggle('is-incorrect', !!result.graded && !result.correct)
          row.feedback.classList.toggle('is-reviewed', !result.graded)
          row.feedback.appendChild(el('strong', null, result.graded
            ? (result.correct ? 'Correct. ' : 'Not correct yet. ') : 'Review. '))
          appendReadableText(row.feedback, feedbackText(Object.assign({}, row.activity, {
            explanation: row.question.explanation
          })) || 'Compare this response with the activity explanation and cited source.')
          row.feedback.classList.add('show')
        })
      }
    }
  }

  function renderActivityControl(host, activity, previous, reader) {
    var data = payload(activity), k = kind(activity)
    if (k === 'single-choice') return renderChoice(host, data, previous, false)
    if (k === 'multi-select') return renderChoice(host, data, previous, true)
    if (k === 'tri-state') {
      var tri = renderChoice(host, { choices: [
      { id: 'true', text: 'True' }, { id: 'false', text: 'False' }, { id: 'cant-tell', text: "Can't tell" }
      ], answerId: data.answer }, previous && previous.answer != null ? { selectedId: previous.answer } : previous, false)
      return { response: function() { var value = tri.response(); return { answer: ['true', 'false', 'cant-tell'][value.selectedIndex] } } }
    }
    if (k === 'cloze') return renderCloze(host, data, previous)
    if (k === 'short-answer' || k === 'cipher') return renderAnswer(host, data, previous)
    if (k === 'numeric') return renderText(host, data, previous, true)
    if (k === 'estimate-slider') return renderSlider(host, data, previous)
    if (k === 'ordering' || k === 'timeline') return renderOrder(host, data, previous)
    if (k === 'matching') return renderAssignments(host, data, previous, true)
    if (k === 'categorisation') return renderAssignments(host, data, previous, false)
    if (k === 'diagram-labelling') return renderDiagram(host, activity, data, previous, reader)
    if (k === 'hotspot') return renderHotspot(host, activity, data, previous, reader)
    if (k === 'graph-plot') return renderGraph(host, data, previous)
    if (k === 'sketch') { var sketch = pointerCanvas(host, previous, 'sketch'); sketch.rubric = true; return sketch }
    if (k === 'logic-grid') return renderLogicGrid(host, data, previous)
    if (k === 'interactive-scene') return renderScene(host, activity, data, previous, reader)
    if (k === 'passage-set') return isSharedQuestionSet(data)
      ? renderSharedQuestionSet(host, activity, data, previous, reader)
      : renderPassageOrCase(host, activity, data, previous, reader, false)
    if (k === 'progressive-case') return isSharedQuestionSet(data)
      ? renderSharedQuestionSet(host, activity, data, previous, reader)
      : renderPassageOrCase(host, activity, data, previous, reader, data.presentation === 'clinical-case')
    if (k === 'reveal-card') {
      // The activity heading already presents the learner prompt. Repeating the full question
      // inside the control wastes an entire sheet on smaller screens and makes the card look like
      // static text rather than an action.
      var card = el('button', 'wb-reveal-card', 'Reveal source answer'); card.type = 'button'
      var answer = el('div', 'wb-reveal-answer')
      var revealed = !!(previous && previous.revealed)
      var readinessChange = null
      function syncCard() {
        var text = learnerText(data.back || activity.explanation) || 'Reviewed'
        card.textContent = revealed ? 'Hide source answer' : 'Reveal source answer'
        answer.dataset.fullText = text; answer.textContent = text; answer.hidden = !revealed
      }
      card.addEventListener('click', function() {
        revealed = !revealed; syncCard(); if (readinessChange) readinessChange()
      })
      syncCard(); host.appendChild(card); host.appendChild(answer)
      return { response: function() { return { revealed: revealed } }, reviewOnly: true,
        onReadinessChange: function(callback) { readinessChange = callback } }
    }
    return renderText(host, data, previous, false)
  }

  function sources(host, activity, entry, reader, compact) {
    var evidence = arr(activity.evidence)
    if (!evidence.length) return
    var section = el('section', 'wb-sources' + (compact ? ' wb-sources-compact' : ''))
    if (!compact) {
      section.appendChild(el('h3', null, 'Source locations'))
      section.appendChild(el('p', null, 'View the cited locations in the book.'))
    }
    var seen = Object.create(null)
    var links = []
    evidence.forEach(function(item) {
      var target = item.target || {}
      var key = String(target.sectionId || '') || String(item.id || '')
      if (seen[key]) return
      seen[key] = true
      var authoredLabel = String(item.label || '').trim()
      var genericLabel = !authoredLabel || /^(?:questions?|answers?|source evidence)$/i.test(authoredLabel)
      var pageMatch = String(target.blockId || '').match(/^p0*(\d+)/i)
      var location = pageMatch ? ' · page ' + Number(pageMatch[1]) :
        (target.sectionId ? ' · section ' + target.sectionId : '')
      var button = el('button', 'wb-source-link',
        (compact ? 'Open source answer' : (genericLabel ? 'View cited source' : 'View ' + authoredLabel)) + location)
      button.type = 'button'
      root.ReaderBookLink.wire(button, function() { root.NativePages.openEvidence(reader, entry, item) })
      links.push(button)
    })
    // A reveal card is already the bridge between a puzzle and its authored answer. Its final
    // evidence section is therefore the useful return target; reproducing every prompt/answer
    // citation made a tiny activity consume a third, mostly empty sheet.
    if (compact && links.length) links = [links[links.length - 1]]
    links.forEach(function(button) { section.appendChild(button) })
    host.appendChild(section)
  }

  function wireRevealPageTurns(node, reader) {
    var startX = 0, startY = 0, moved = false, target = null
    node.addEventListener('pointerdown', function(event) {
      if (event.pointerType === 'pen') { target = null; return }
      startX = event.clientX; startY = event.clientY; moved = false; target = event.target
    })
    node.addEventListener('pointermove', function(event) {
      if (Math.abs(event.clientX - startX) > 8 || Math.abs(event.clientY - startY) > 8) moved = true
    })
    node.addEventListener('pointerup', function(event) {
      if (event.pointerType === 'pen' || moved || !target) return
      if (target.closest && target.closest('button,a,input,select,textarea,canvas,.wb-ink-region')) return
      var bounds = node.getBoundingClientRect(), x = event.clientX - bounds.left
      if (x < bounds.width * .33 && reader && typeof reader.prevPage === 'function') reader.prevPage()
      else if (x > bounds.width * .67 && reader && typeof reader.nextPage === 'function') reader.nextPage()
    })
  }

  function renderRevealActivity(container, entry, reader, spec, activity, state) {
    var promptText = presentationPrompt(activity)
    var answerText = learnerText(payload(activity).back || activity.explanation) || 'Reviewed'
    var wrap = el('section', 'wb-interaction wb-reveal-interaction wb-reveal-single')
    if (promptText.length > 220) wrap.classList.add('wb-reveal-long-prompt')
    if (answerText.length > 900) wrap.classList.add('wb-reveal-dense-answer')
    var kicker = el('div', 'wb-kicker', 'THINK IT THROUGH')
    var heading = el('section', 'wb-activity-heading')
    heading.appendChild(kicker); wrap.appendChild(heading)

    var questionView = el('section', 'wb-reveal-view wb-reveal-question-view')
    questionView.appendChild(el('h2', 'wb-question wb-reveal-question', promptText))
    var reveal = el('button', 'wb-reveal-card', 'Reveal answer'); reveal.type = 'button'
    questionView.appendChild(reveal)

    var answerUnits = []
    var revealFigures = arr(activity.figureRefs).map(function(figureRef) {
      return arr(activity.figures).find(function(figure) { return figure && figure.id === figureRef })
    }).filter(Boolean)
    function appendFigureGroup(figures) {
      if (!figures.length) return
      var figureGroup = el('section', 'wb-reveal-figures')
      figureGroup.setAttribute('aria-label', 'Source diagrams')
      figures.forEach(function(figure) {
        var frame = el('figure', 'wb-reveal-figure')
        var image = root.document.createElement('img')
        image.alt = figure.altText || figure.caption || 'Source diagram'
        var url = figureUrlForRef(reader, activity, figure.id)
        if (url) image.src = url
        enableFigureViewer(image, reader)
        frame.appendChild(image); figureGroup.appendChild(frame)
      })
      answerUnits.push(figureGroup)
    }
    function appendAnswerText(text) {
      if (!text) return
      // Keep authored paragraphs as separate measured units so page composition can use the
      // available space. CSS joins adjacent units into one continuous answer treatment.
      var panel = el('div', 'wb-reveal-answer')
      answerUnits.push(panel)
      panel.appendChild(el('p', 'wb-reveal-answer-paragraph', text))
    }
    var answerFlow = arr(payload(activity).answerFlow)
    if (answerFlow.length) {
      var pendingFigures = []
      answerFlow.forEach(function(item) {
        if (item.kind === 'figure') {
          var figure = revealFigures.find(function(candidate) { return candidate.id === item.figureRef })
          if (figure) pendingFigures.push(figure)
          return
        }
        appendFigureGroup(pendingFigures); pendingFigures = []
        if (item.kind === 'text') appendAnswerText(item.text)
      })
      appendFigureGroup(pendingFigures)
    } else {
      appendAnswerText(answerText)
      appendFigureGroup(revealFigures)
    }
    var answerActions = el('div', 'wb-reveal-answer-actions')
    answerActions.dataset.keepWithPrevious = 'true'
    var sourceSlot = el('div', 'wb-source-slot')
    sources(sourceSlot, activity, entry, reader, true)
    answerActions.appendChild(sourceSlot); answerUnits.push(answerActions)
    if (answerUnits.length) answerUnits[0].classList.add('wb-reveal-answer-start')
    wrap.appendChild(questionView)
    answerUnits.forEach(function(unit) {
      unit.classList.add('wb-reveal-answer-unit')
      wrap.appendChild(unit)
    })
    container.appendChild(wrap)
    var revealed = !!(state && state.response && state.response.revealed)
    var pager = null
    function showAnswer(show) {
      revealed = !!show
      answerUnits.forEach(function(unit) { unit.hidden = !revealed })
      reveal.textContent = revealed ? 'Hide answer' : 'Reveal answer'
      reveal.setAttribute('aria-expanded', revealed ? 'true' : 'false')
      if (pager) pager.refresh()
    }
    reveal.addEventListener('click', function() {
      var current = activityState(reader, spec, activity)
      var nextRevealed = !revealed
      persist(reader, spec, activity, {
        status: 'reviewed', response: { revealed: nextRevealed },
        checks: current.status === 'reviewed' ? (current.checks || 1) : (current.checks || 0) + 1,
        score: null, revealed: nextRevealed
      })
      showAnswer(nextRevealed)
    })
    showAnswer(revealed)
    pager = installPageComposer(wrap, Array.prototype.slice.call(wrap.children), reader,
      { hideNavigation: true })
    return true
  }

  function renderActivity(container, entry, reader, spec) {
    if (!root.WorkbookAttempts) return false
    var activity = spec.activity || {}, state = activityState(reader, spec, activity)
    var revealCard = kind(activity) === 'reveal-card'
    // Reveal cards are a two-state reading surface, not a multi-step worksheet. Replacing the
    // question with its source answer keeps the interaction on one physical page and avoids the
    // generic composer creating a new sheet and moving the learner when the button is pressed.
    if (revealCard) return renderRevealActivity(container, entry, reader, spec, activity, state)
    var wrap = el('section', 'wb-interaction' + (revealCard ? ' wb-reveal-interaction' : ''))
    var heading = el('section', 'wb-activity-heading')
    heading.appendChild(el('div', 'wb-kicker', revealCard ? 'THINK IT THROUGH' :
      'STUDY WORKBOOK · ACTIVITY ' + ((spec.activityIndex || 0) + 1) + ' OF ' + (spec.activityCount || 1)))
    var meta = el('div', 'wb-meta')
    if (!revealCard) meta.appendChild(el('span', null, String(kind(activity) || 'activity').replace(/-/g, ' ')))
    if (!revealCard) meta.appendChild(el('span', null, activity.difficulty || 'standard'))
    if (spec.mode === 'exam') meta.appendChild(el('span', null, 'exam mode'))
    var targetSeconds = Number(payload(activity).timedSeconds || 0)
    if (targetSeconds > 0) {
      var minutes = Math.floor(targetSeconds / 60), seconds = targetSeconds % 60
      meta.appendChild(el('span', null, 'target ' + (minutes ? minutes + 'm ' : '') + (seconds ? seconds + 's' : '')))
    }
    if (!revealCard || meta.children.length) heading.appendChild(meta)
    wrap.appendChild(heading)
    // Prompts are semantic source content, not fixed-size sheet headings. Split only at authored
    // block/newline or completed-sentence boundaries, then let the composer pack the resulting
    // measured units for the current viewport. This preserves exact text while preventing a long
    // multi-part question from becoming one indivisible, overflowing page unit.
    var promptText = presentationPrompt(activity)
    var promptFragments = String(promptText || '').split(/\n+|(?<=[.!?])\s+(?=[A-Z(])/u).filter(Boolean)
    if (!promptFragments.length) promptFragments = [String(promptText || '')]
    promptFragments.forEach(function(fragment, fragmentIndex) {
      var promptNode = el(fragmentIndex ? 'div' : 'h2',
        'wb-question' + (revealCard ? ' wb-reveal-question' : '') +
        (fragmentIndex ? ' wb-question-continuation' : ''), fragment)
      wrap.appendChild(promptNode)
    })
    var controlHost = el('div', 'wb-control')
    var control = renderActivityControl(controlHost, activity, state.response, reader)
    wrap.appendChild(controlHost)

    // Draft responses are sidecar state too: leaving or reloading must not discard work. Events
    // bubble after each widget has updated its local value, so one renderer-level choke point covers
    // buttons, fields, selectors and pointer canvases without coupling the widgets to storage.
    var draftTimer = null
    function storeDraft() {
      clearTimeout(draftTimer)
      draftTimer = setTimeout(function() {
        var current = activityState(reader, spec, activity)
        if (current.status === 'correct' || current.status === 'incorrect' || current.status === 'reviewed') return
        persist(reader, spec, activity, { status: 'open', response: control.response() })
      }, 0)
    }
    wrap.addEventListener('click', storeDraft)
    wrap.addEventListener('input', storeDraft)
    wrap.addEventListener('change', storeDraft)

    var hints = arr(activity.hints), hintBox = el('div', 'wb-hint-box')
    var feedback = el('div', 'wb-feedback')
    var actions = el('div', 'wb-actions')
    var sourceSlot = el('div', 'wb-source-slot')
    var pager = null
    if (spec.mode !== 'exam' && hints.length) {
      var hint = el('button', 'wb-secondary', 'Show hint'); hint.type = 'button'
      hint.addEventListener('click', function() {
        var current = activityState(reader, spec, activity)
        var used = Math.min(hints.length, (current.hintsUsed || 0) + 1)
        persist(reader, spec, activity, { hintsUsed: used })
        hintBox.textContent = hints.slice(0, used).join(' · ')
        hintBox.classList.add('show')
        hint.disabled = used >= hints.length
        if (pager) pager.refresh()
      })
      actions.appendChild(hint)
    }
    var check = el('button', 'wb-primary', control.reviewOnly ? 'Mark reviewed' : (spec.mode === 'exam' ? 'Save answer' : 'Check answer'))
    check.type = 'button'
    function syncCheckReadiness() {
      check.hidden = revealCard || (typeof control.readyToCheck === 'function' && !control.readyToCheck())
      if (revealCard) {
        var response = control.response()
        if (response.revealed) {
          var current = activityState(reader, spec, activity)
          if (current.status !== 'reviewed') persist(reader, spec, activity, {
            status: 'reviewed', response: response, checks: (current.checks || 0) + 1,
            score: null, revealed: true
          })
          sourceSlot.innerHTML = ''
          sources(sourceSlot, activity, entry, reader, true)
          wrap.classList.add('is-reviewed')
        } else sourceSlot.innerHTML = ''
      }
      if (pager) pager.refresh()
    }
    syncCheckReadiness()
    if (typeof control.onReadinessChange === 'function') control.onReadinessChange(syncCheckReadiness)
    check.addEventListener('click', function() {
      var response = control.response()
      var current = activityState(reader, spec, activity)
      if (spec.mode === 'exam') {
        persist(reader, spec, activity, { status: 'answered', response: response, checks: current.checks || 0 })
        feedback.textContent = 'Answer saved. Results and explanations are shown after submission.'
        feedback.classList.add('show'); return
      }
      var result = control.reviewOnly || control.rubric ? { graded: false } : localScore(activity, response)
      var status = result.graded ? (result.correct ? 'correct' : 'incorrect') : 'reviewed'
      persist(reader, spec, activity, {
        status: status, response: response, checks: (current.checks || 0) + 1,
        score: result.graded ? result.score : null, revealed: !result.graded
      })
      feedback.innerHTML = ''
      feedback.appendChild(el('strong', null, result.graded ? (result.correct ? 'Correct. ' : 'Not correct yet. ') : 'Review against the criteria. '))
      feedback.appendChild(root.document.createTextNode(feedbackText(activity) ||
        'Use the linked source evidence to review your response.'))
      feedback.classList.add('show')
      if (typeof control.showReview === 'function') control.showReview()
      if (isSharedQuestionSet(payload(activity))) {
        // Each child already carries its exact local score and authored explanation. A second
        // activity-level verdict is redundant and can overfill the final sheet on small screens.
        feedback.classList.remove('show'); check.hidden = true
      }
      if (!result.graded) { check.textContent = 'Answer revealed'; check.disabled = true }
      wrap.classList.toggle('is-correct', !!result.graded && !!result.correct)
      wrap.classList.toggle('is-incorrect', !!result.graded && !result.correct)
      wrap.classList.toggle('is-reviewed', !result.graded)
      sources(sourceSlot, activity, entry, reader)
      if (pager) pager.refresh()
    })
    if (!revealCard) actions.appendChild(check)
    if (!revealCard) wrap.appendChild(actions)
    wrap.appendChild(hintBox); wrap.appendChild(feedback)
    if (state.status === 'correct' || state.status === 'incorrect' || state.status === 'reviewed') {
      wrap.classList.add(state.status === 'correct' ? 'is-correct' : (state.status === 'incorrect' ? 'is-incorrect' : 'is-reviewed'))
      if (!revealCard) {
        feedback.appendChild(el('strong', null, state.status === 'correct' ? 'Correct. ' : (state.status === 'incorrect' ? 'Not correct yet. ' : 'Reviewed. ')))
        feedback.appendChild(root.document.createTextNode(feedbackText(activity) ||
          'Use the linked source evidence to review your response.'))
        feedback.classList.add('show')
      }
      if (typeof control.showReview === 'function') control.showReview()
      if (isSharedQuestionSet(payload(activity))) { feedback.classList.remove('show'); check.hidden = true }
      if (state.status === 'reviewed') { check.textContent = 'Answer revealed'; check.disabled = true }
      if (!revealCard || !sourceSlot.children.length)
        sources(sourceSlot, activity, entry, reader, revealCard)
    }
    var pageItems = Array.prototype.slice.call(wrap.children)
    pageItems.push(sourceSlot)
    container.appendChild(wrap)
    pager = installPageComposer(wrap, pageItems, reader)
    return true
  }

  function renderResults(container, entry, reader, spec) {
    var activities = arr(spec.activities), ids = activities.map(function(a) { return String(a.id) })
    var state = root.WorkbookAttempts.load(reader, spec.groupId, spec.mode)
    if (spec.mode === 'exam' && !state.completedAt) {
      activities.forEach(function(activity) {
        var row = state.activities[activity.id]
        if (!row || row.status !== 'answered') return
        var result = localScore(activity, row.response)
        row.status = result.graded ? (result.correct ? 'correct' : 'incorrect') : 'reviewed'
        row.score = result.score
      })
      state.accumulatedMs = root.WorkbookAttempts.elapsedMs(state)
      state.completedAt = new Date().toISOString()
      root.WorkbookAttempts.save(reader, spec.groupId, state)
    }
    var resultSummary = root.WorkbookAttempts.summary(state, ids)
    var wrap = el('section', 'wb-interaction wb-results')
    wrap.appendChild(el('div', 'wb-kicker', 'STUDY WORKBOOK · RESULTS'))
    wrap.appendChild(el('h2', 'wb-result-score', resultSummary.correct + ' / ' + resultSummary.total))
    var description = resultSummary.unanswered
      ? resultSummary.unanswered + ' activities remain unanswered.'
      : (resultSummary.hintsUsed === 0 ? 'Completed without hints.' : 'Completed with ' + resultSummary.hintsUsed + ' hint' + (resultSummary.hintsUsed === 1 ? '.' : 's.'))
    wrap.appendChild(el('p', 'wb-result-copy', description))
    if (spec.mode === 'exam') {
      var seconds = Math.round(root.WorkbookAttempts.elapsedMs(state) / 1000)
      wrap.appendChild(el('p', 'wb-result-time', 'Recorded time: ' + Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's'))
    }
    var actions = el('div', 'wb-actions wb-result-actions')
    var retake = el('button', 'wb-primary', 'Start again'); retake.type = 'button'
    retake.addEventListener('click', function() { root.WorkbookAttempts.reset(reader, spec.groupId, spec.mode); root.NativePages.showGroupFirst(reader, spec.groupId) })
    var remove = el('button', 'wb-secondary', 'Delete workbook'); remove.type = 'button'
    remove.addEventListener('click', function() { root.NativePages.deleteGroup(reader, spec.groupId) })
    actions.appendChild(retake); actions.appendChild(remove); wrap.appendChild(actions)
    var pageItems = Array.prototype.slice.call(wrap.children)
    container.appendChild(wrap)
    installPageComposer(wrap, pageItems, reader)
    return true
  }

  function renderAuthoredMath(container) {
    // Keep workbook text insertion source-safe (textContent) and typeset only after the complete
    // DOM exists. The normal reader owns malformed-math degradation; the standalone QA fixture
    // uses the same bundled auto-renderer directly.
    // A currency dollar is source text, not an inline-TeX delimiter. Protect each symbol without
    // disabling genuine formulae elsewhere in the same prompt; otherwise two prices can pair up
    // and make all intervening prose an accidental math expression.
    var walker = root.document.createTreeWalker(container, 4)
    var currencyNodes = [], current
    while ((current = walker.nextNode())) {
      if (/\$(?=\s*\d)(?![^$]*\\(?:,|circ|mathrm)[^$]*\$)/.test(current.nodeValue || '') &&
          !(current.parentElement && current.parentElement.closest('.nomath'))) currencyNodes.push(current)
    }
    currencyNodes.forEach(function(node) {
      var parts = String(node.nodeValue || '').split(/(\$(?=\s*\d))/)
      if (parts.length < 2 || !node.parentNode) return
      var fragment = root.document.createDocumentFragment()
      parts.forEach(function(part) {
        if (!part) return
        if (part === '$') fragment.appendChild(el('span', 'nomath', part))
        else fragment.appendChild(root.document.createTextNode(part))
      })
      node.parentNode.replaceChild(fragment, node)
    })
    function fitDisplayMath() {
      Array.prototype.slice.call(container.querySelectorAll('.katex-display')).forEach(function(display) {
        var math = display.querySelector(':scope > .katex') || display.querySelector('.katex')
        var available = Math.max(1, display.clientWidth || (display.parentElement && display.parentElement.clientWidth) || 0)
        var required = math ? Math.max(math.scrollWidth || 0,
          math.getBoundingClientRect ? math.getBoundingClientRect().width || 0 : 0) : 0
        if (!math || !required || required <= available + 1) return
        // KaTeX display rows are deliberately non-wrapping. Scale only an over-wide expression,
        // preserving every authored term on no-scroll reader pages. Extremely dense equations
        // remain machine-detectable instead of being hidden behind horizontal overflow.
        var scale = Math.min(1, available / required)
        math.style.fontSize = Math.max(.62, scale * .96) + 'em'
        display.dataset.mathFitted = 'true'
        if (required * Math.max(.62, scale * .96) > available + 2)
          display.dataset.mathStillOverflowing = 'true'
      })
    }
    if (root.BookReader && typeof root.BookReader.renderMath === 'function') {
      root.BookReader.renderMath(container)
      fitDisplayMath()
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(fitDisplayMath)
      return
    }
    if (typeof root.renderMathInElement !== 'function') return
    try {
      root.renderMathInElement(container, {
        delimiters: [
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'kal-ink', 'kal-mcq'],
        ignoredClasses: ['nomath']
      })
      fitDisplayMath()
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(fitDisplayMath)
    } catch (error) {
      if (root.console && root.console.warn) root.console.warn('workbook katex auto-render', error)
    }
  }

  function render(container, entry, reader) {
    var spec = entry && entry.page && entry.page.interaction
    if (!spec || (spec.type !== 'workbook-activity' && spec.type !== 'workbook-results')) return false
    container.innerHTML = ''
    container.classList.add('has-content', 'rai-page', 'wb-page')
    var rendered = spec.type === 'workbook-results'
      ? renderResults(container, entry, reader, spec)
      : renderActivity(container, entry, reader, spec)
    if (rendered && root.ReaderDelayedInteraction) root.ReaderDelayedInteraction.wire(container)
    return rendered
  }

  return {
    render: render,
    score: localScore,
    kinds: Object.keys(KIND_ALIASES),
    _sceneFrame: sceneFrame,
    _isSharedQuestionSet: isSharedQuestionSet,
    _presentationPrompt: presentationPrompt,
    _selectedPositions: selectedPositions,
    _displayChoiceText: displayChoiceText,
    _renderAuthoredMath: renderAuthoredMath,
    _installPageComposer: installPageComposer
  }
})
