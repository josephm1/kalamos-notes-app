// Interactive renderer for validated native-page payloads. It owns quiz attempt UX only; the
// template compiler owns the immutable question data and NativePages owns persistence/navigation.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.InteractionPageRenderer = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  function node(tag, cls, text) {
    var n = root.document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function attempt(reader, groupId) {
    return root.NativePages.loadAttempt(reader, groupId) || { version: 1, answers: {} }
  }

  function save(reader, groupId, value) {
    root.NativePages.saveAttempt(reader, groupId, value)
  }

  function renderQuestion(container, entry, reader, spec) {
    var groupId = spec.groupId
    var q = spec.question
    var state = attempt(reader, groupId)
    if (!state.answers) state.answers = {}
    var answer = state.answers[q.id] || { selected: null, checked: false, correct: false }

    var wrap = node('section', 'rai-interaction rai-mcq')
    wrap.appendChild(node('div', 'rai-kicker', 'AI QUIZ · QUESTION ' + (spec.questionIndex + 1) + ' OF ' + spec.questionCount))
    wrap.appendChild(node('h2', 'rai-question', q.prompt))
    var choices = node('div', 'rai-choices')
    var buttons = []
    q.choices.forEach(function(choice, i) {
      var b = node('button', 'rai-choice')
      b.type = 'button'
      b.appendChild(node('span', 'rai-letter', 'ABCD'[i]))
      b.appendChild(node('span', 'rai-choice-text', choice.text))
      b.addEventListener('click', function(e) {
        e.stopPropagation()
        if (answer.checked) return
        answer.selected = choice.id
        sync()
        state.answers[q.id] = answer
        save(reader, groupId, state)
      })
      choices.appendChild(b); buttons.push({ button: b, choice: choice })
    })
    wrap.appendChild(choices)
    var foot = node('div', 'rai-actions')
    var check = node('button', 'rai-primary', 'Check answer'); check.type = 'button'
    var feedback = node('div', 'rai-feedback')
    var source = node('div', 'rai-source')
    function renderSources() {
      source.innerHTML = ''
      source.appendChild(node('div', 'rai-source-label', 'Sources'))
      var links = node('div', 'rai-source-links')
      q.evidence.forEach(function(evidence) {
        var link = node('button', 'rai-source-link')
        link.type = 'button'
        link.appendChild(node('span', null, evidence.label))
        link.appendChild(node('span', 'rai-source-open', 'Open passage →'))
        root.ReaderBookLink.wire(link, function() {
          root.NativePages.openEvidence(reader, entry, evidence)
        })
        links.appendChild(link)
      })
      source.appendChild(links)
    }
    function sync() {
      buttons.forEach(function(row) {
        var selected = answer.selected === row.choice.id
        row.button.classList.toggle('selected', selected)
        row.button.classList.toggle('correct', !!answer.checked && row.choice.id === q.answerId)
        row.button.classList.toggle('wrong', !!answer.checked && selected && row.choice.id !== q.answerId)
        row.button.disabled = !!answer.checked
      })
      check.disabled = !!answer.checked
      if (answer.checked) {
        feedback.innerHTML = ''
        feedback.appendChild(node('strong', null, answer.correct ? '✓ Correct. ' : '✗ Not quite. '))
        feedback.appendChild(root.document.createTextNode(q.explanation))
        renderSources()
        feedback.classList.add('show'); source.classList.add('show')
      }
    }
    check.addEventListener('click', function(e) {
      e.stopPropagation()
      if (!answer.selected) {
        if (root.BooxUI) root.BooxUI.toast('Pick an answer first')
        return
      }
      answer.checked = true
      answer.correct = answer.selected === q.answerId
      answer.checkedAt = new Date().toISOString()
      state.answers[q.id] = answer
      var checked = Object.keys(state.answers).filter(function(id) { return state.answers[id].checked }).length
      if (checked >= spec.questionCount) state.completedAt = new Date().toISOString()
      save(reader, groupId, state)
      sync()
    })
    foot.appendChild(check); wrap.appendChild(foot)
    wrap.appendChild(feedback); wrap.appendChild(source)
    container.appendChild(wrap)
    sync()
  }

  function renderResults(container, entry, reader, spec) {
    var state = attempt(reader, spec.groupId)
    var answers = state.answers || {}
    var ids = (spec.questions || []).map(function(q) { return q.id })
    var checked = ids.filter(function(id) { return answers[id] && answers[id].checked }).length
    var score = ids.filter(function(id) { return answers[id] && answers[id].correct }).length
    var wrap = node('section', 'rai-interaction rai-results')
    wrap.appendChild(node('div', 'rai-kicker', 'AI QUIZ · RESULTS'))
    wrap.appendChild(node('h2', 'rai-result-score', score + ' / ' + ids.length))
    wrap.appendChild(node('p', 'rai-result-copy',
      checked === ids.length
        ? ('Completed' + (state.completedAt ? ' · ' + new Date(state.completedAt).toLocaleString() : ''))
        : (checked + ' of ' + ids.length + ' questions checked. You can turn back to finish the quiz.')))
    var actions = node('div', 'rai-result-actions')
    var retake = node('button', 'rai-primary', 'Retake quiz'); retake.type = 'button'
    retake.addEventListener('click', function(e) {
      e.stopPropagation()
      root.NativePages.resetAttempt(reader, spec.groupId)
      root.NativePages.showGroupFirst(reader, spec.groupId)
    })
    var del = node('button', 'rai-secondary', 'Delete quiz'); del.type = 'button'
    del.addEventListener('click', function(e) {
      e.stopPropagation()
      root.NativePages.deleteGroup(reader, spec.groupId)
    })
    actions.appendChild(retake); actions.appendChild(del); wrap.appendChild(actions)
    container.appendChild(wrap)
  }

  function render(container, entry, reader) {
    var spec = entry && entry.page && entry.page.interaction
    if (!spec) return false
    // V2 activity families are dispatched through their data-only registry. Keeping this single
    // delegation point lets legacy mcq-basic/v1 pages retain their byte-for-byte renderer and
    // attempt shape while new workbook pages share one strict rendering boundary.
    if (root.WorkbookRenderer && typeof root.WorkbookRenderer.render === 'function' &&
        root.WorkbookRenderer.render(container, entry, reader)) return true
    container.innerHTML = ''
    container.classList.add('has-content', 'rai-page')
    if (spec.type === 'mcq-basic') renderQuestion(container, entry, reader, spec)
    else if (spec.type === 'mcq-results') renderResults(container, entry, reader, spec)
    else return false
    return true
  }

  return { render: render }
})
