// Books workbook orchestration. Source adapters read, DeepSeek returns data, the closed registry
// validates/compiles, and NativePages writes only user-approved groups.
window.BooksAI = (function() {
  'use strict'

  var activeAbort = null

  function enabled() {
    return !!(window.KalamosConfig && KalamosConfig.booksAi && KalamosConfig.booksAi.enabled)
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function parseDraft(raw) {
    try { return JSON.parse(raw) } catch (e) { throw new Error('DeepSeek did not return valid JSON') }
  }

  function open(reader) {
    if (!enabled() || !reader || !ReaderStudySource || !WorkbookContracts || !DeepSeekQuizProvider) {
      BooxUI.toast('Workbook creation is unavailable')
      return
    }
    BooxChrome.hideBars(reader)
    var sh = BooxUI.sheet({
      title: 'Create workbook',
      onClose: function() {
        if (activeAbort) activeAbort.abort()
        activeAbort = null
      }
    })
    sh.root.classList.add('rai-sheet', 'rai-no-scroll')
    var form = el('div', 'rai-form rai-wizard')
    sh.body.appendChild(form)

    var stepHeader = el('header', 'rai-step-header')
    var stepCount = el('span', 'rai-step-count')
    var stepHeading = el('strong', 'rai-step-title'); stepHeading.id = 'rai-step-title'
    stepHeader.appendChild(stepCount); stepHeader.appendChild(stepHeading); form.appendChild(stepHeader)
    var stepStage = el('div', 'rai-step-stage'); form.appendChild(stepStage)
    var steps = []
    ;[
      ['Set up', 'Choose the session and amount of work.'],
      ['AI service', 'Check the provider before selecting source material.'],
      ['Formats', 'Choose the interaction formats.'],
      ['Source', 'Choose the exact part of the book.'],
      ['Review and generate', 'Confirm what will be sent.']
    ].forEach(function(copy, index) {
      var panel = el('section', 'rai-step')
      panel.dataset.step = String(index)
      panel.setAttribute('aria-labelledby', 'rai-step-title')
      panel.appendChild(el('p', 'rai-step-intro', copy[1]))
      steps.push(panel); stepStage.appendChild(panel)
    })

    var providerProfile = DeepSeekQuizProvider.profile ? DeepSeekQuizProvider.profile() :
      { label: 'DeepSeek V4 Flash' }
    var providerReady = DeepSeekQuizProvider.hasKey()
    var providerRow = el('div', 'rai-provider')
    var providerCopy = el('div', 'rai-provider-copy')
    providerCopy.appendChild(el('strong', null, providerProfile.label))
    providerCopy.appendChild(el('span', providerReady ? 'ready' : 'needs-key',
      providerReady ? 'API key ready' : 'API key needed'))
    var providerSettings = el('button', 'rai-provider-settings', 'AI settings')
    providerSettings.type = 'button'; providerSettings.id = 'rai-ai-settings'
    var queueButton = el('button', 'rai-provider-settings', 'Conversion queue')
    queueButton.type = 'button'; queueButton.id = 'rai-conversion-queue'
    providerRow.appendChild(providerCopy); providerRow.appendChild(queueButton)
    providerRow.appendChild(providerSettings); steps[1].appendChild(providerRow)
    steps[1].appendChild(el('p', 'rai-privacy', providerReady
      ? 'The configured provider is ready. No book content is sent until the final Generate action.'
      : 'Add an API key in AI settings before generating. Queue creation and local extraction do not require a provider request.'))

    var countRow = el('div', 'rai-field rai-inline')
    var countLabel = el('label', null, 'Activities')
    var count = document.createElement('input')
    count.type = 'number'; count.id = 'rai-activity-count'; count.min = '1'; count.max = '20'; count.step = '1'; count.value = '6'; count.inputMode = 'numeric'
    countRow.appendChild(countLabel); countRow.appendChild(count); steps[0].appendChild(countRow)

    var config = el('section', 'rai-workbook-config')
    var modeField = el('label', 'rai-chapter-field'); modeField.appendChild(el('span', null, 'Source use'))
    var workbookMode = document.createElement('select')
    workbookMode.id = 'rai-workbook-mode'
    ;[['adapted', 'Adapt existing material first'], ['mixed', 'Adapt and generate'], ['generated', 'Generate new activities']].forEach(function(row) {
      var option = document.createElement('option'); option.value = row[0]; option.textContent = row[1]; workbookMode.appendChild(option)
    })
    modeField.appendChild(workbookMode); config.appendChild(modeField)
    var difficultyField = el('label', 'rai-chapter-field'); difficultyField.appendChild(el('span', null, 'Difficulty'))
    var difficulty = document.createElement('select')
    difficulty.id = 'rai-difficulty'
    ;['introductory', 'standard', 'advanced'].forEach(function(value) {
      var option = document.createElement('option'); option.value = value; option.textContent = value.charAt(0).toUpperCase() + value.slice(1); difficulty.appendChild(option)
    })
    difficulty.value = 'advanced'; difficultyField.appendChild(difficulty); config.appendChild(difficultyField)
    var sessionField = el('label', 'rai-chapter-field'); sessionField.appendChild(el('span', null, 'Session'))
    var sessionMode = document.createElement('select')
    sessionMode.id = 'rai-session-mode'
    ;[['practice', 'Practice with hints'], ['exam', 'Exam — timer continues in background']].forEach(function(row) {
      var option = document.createElement('option'); option.value = row[0]; option.textContent = row[1]; sessionMode.appendChild(option)
    })
    sessionField.appendChild(sessionMode); config.appendChild(sessionField)
    var figureField = el('label', 'rai-figure-optin')
    var includeFigures = document.createElement('input'); includeFigures.type = 'checkbox'
    includeFigures.id = 'rai-include-figures'; includeFigures.checked = true
    figureField.appendChild(includeFigures); figureField.appendChild(el('span', null,
      'Include relevant figure metadata when available (recommended)'))
    config.appendChild(figureField); steps[0].appendChild(config)

    var family = document.createElement('select'); family.multiple = true
    family.className = 'rai-family-model'; family.setAttribute('aria-hidden', 'true'); family.tabIndex = -1
    WorkbookContracts.listTemplates().forEach(function(template) {
      var option = document.createElement('option'); option.value = template.id
      option.textContent = template.id.replace(/-/g, ' '); option.selected = true; family.appendChild(option)
    })
    steps[2].appendChild(family)
    var familySummary = el('p', 'rai-family-summary')
    var familyGrid = el('div', 'rai-family-grid')
    var familyPager = el('div', 'rai-family-pager')
    var familyPrevious = el('button', 'rai-secondary', 'Previous five'); familyPrevious.type = 'button'
    var familyPageReadout = el('strong', 'rai-family-page')
    var familyNext = el('button', 'rai-secondary', 'Next five'); familyNext.type = 'button'
    familyPager.appendChild(familyPrevious); familyPager.appendChild(familyPageReadout); familyPager.appendChild(familyNext)
    var familyPresets = el('div', 'rai-family-presets')
    var familyAll = el('button', 'rai-secondary', 'Select all'); familyAll.type = 'button'
    var familyClear = el('button', 'rai-secondary', 'Clear all'); familyClear.type = 'button'
    familyPresets.appendChild(familyAll); familyPresets.appendChild(familyClear)
    steps[2].appendChild(familySummary); steps[2].appendChild(familyGrid)
    steps[2].appendChild(familyPager); steps[2].appendChild(familyPresets)

    var familyPage = 0
    var familyPageSize = 5
    function renderFamilyPage() {
      var options = Array.prototype.slice.call(family.options)
      var pageCount = Math.max(1, Math.ceil(options.length / familyPageSize))
      familyPage = Math.max(0, Math.min(pageCount - 1, familyPage))
      familyGrid.innerHTML = ''
      options.slice(familyPage * familyPageSize, (familyPage + 1) * familyPageSize).forEach(function(option) {
        var choice = el('button', 'rai-family-choice' + (option.selected ? ' selected' : ''))
        choice.type = 'button'; choice.setAttribute('aria-pressed', option.selected ? 'true' : 'false')
        choice.appendChild(el('span', 'rai-family-mark', option.selected ? '✓' : ''))
        choice.appendChild(el('span', null, option.textContent))
        choice.addEventListener('click', function() {
          option.selected = !option.selected
          renderFamilyPage()
        })
        familyGrid.appendChild(choice)
      })
      var selectedCount = options.filter(function(option) { return option.selected }).length
      familySummary.textContent = selectedCount + ' of ' + options.length +
        ' formats selected. The source still determines which selected formats are appropriate.'
      familyPageReadout.textContent = (familyPage + 1) + ' / ' + pageCount
      familyPrevious.disabled = familyPage === 0
      familyNext.disabled = familyPage >= pageCount - 1
    }
    familyPrevious.addEventListener('click', function() { familyPage -= 1; renderFamilyPage() })
    familyNext.addEventListener('click', function() { familyPage += 1; renderFamilyPage() })
    familyAll.addEventListener('click', function() {
      Array.prototype.forEach.call(family.options, function(option) { option.selected = true })
      renderFamilyPage()
    })
    familyClear.addEventListener('click', function() {
      Array.prototype.forEach.call(family.options, function(option) { option.selected = false })
      renderFamilyPage()
    })
    renderFamilyPage()

    var sourcePicker = el('section', 'rai-source-picker')
    var sourceHead = el('div', 'rai-source-head')
    sourceHead.appendChild(el('h3', null, 'Choose what to study'))
    sourceHead.appendChild(el('p', null, 'Start from your current location or choose another part of the book.'))
    sourcePicker.appendChild(sourceHead)
    var modeButtons = el('div', 'rai-scope-modes'); modeButtons.setAttribute('role', 'tablist')
    var scopeControls = el('div', 'rai-scope-controls')
    sourcePicker.appendChild(modeButtons); sourcePicker.appendChild(scopeControls); steps[3].appendChild(sourcePicker)

    var summary = el('div', 'rai-summary', 'Reading the selected source…'); steps[4].appendChild(summary)
    var privacy = el('div', 'rai-privacy',
      'Only this selection is sent to ' + providerProfile.label +
      ' when you tap Generate. Local paths and navigation targets are removed. No image pixels are sent.')
    steps[4].appendChild(privacy)
    var status = el('div', 'rai-status'); status.setAttribute('role', 'status'); steps[4].appendChild(status)
    var actions = el('div', 'rai-form-actions rai-wizard-actions')
    var cancel = el('button', 'rai-secondary', 'Cancel'); cancel.type = 'button'; cancel.id = 'rai-cancel'
    var back = el('button', 'rai-secondary', 'Back'); back.type = 'button'; back.id = 'rai-back'
    var next = el('button', 'rai-primary', 'Next'); next.type = 'button'; next.id = 'rai-next'
    var generate = el('button', 'rai-primary', 'Generate draft'); generate.type = 'button'; generate.id = 'rai-generate'; generate.disabled = true
    actions.appendChild(cancel); actions.appendChild(back); actions.appendChild(next); actions.appendChild(generate); form.appendChild(actions)

    var currentStep = 0
    function showStep(index) {
      currentStep = Math.max(0, Math.min(steps.length - 1, index))
      steps.forEach(function(step, stepIndex) { step.hidden = stepIndex !== currentStep })
      stepCount.textContent = 'STEP ' + (currentStep + 1) + ' OF ' + steps.length
      stepHeading.textContent = ['Set up', 'AI service', 'Choose formats', 'Choose source', 'Review and generate'][currentStep]
      back.hidden = currentStep === 0
      next.hidden = currentStep === steps.length - 1
      generate.hidden = currentStep !== steps.length - 1
      if (currentStep === 2) renderFamilyPage()
    }
    back.addEventListener('click', function() { showStep(currentStep - 1) })
    next.addEventListener('click', function() {
      if (currentStep === 2 && !selectedKinds().length) {
        familySummary.textContent = 'Choose at least one format before continuing.'
        return
      }
      showStep(currentStep + 1)
    })
    showStep(0)

    var packet = null
    var scopeInfo = null
    var selectedMode = ''
    var chapterSelect = null
    var from = null
    var to = null
    var meterFill = null
    var rangeReadout = null
    var refreshTimer = null
    var sourceSeq = 0

    function selectedKinds() {
      return Array.prototype.filter.call(family.options, function(option) { return option.selected })
        .map(function(option) { return option.value })
    }

    function selectedUnit() {
      if (!scopeInfo || !chapterSelect) return null
      return scopeInfo.units.find(function(unit) { return unit.id === chapterSelect.value }) || null
    }

    function scope() {
      if (selectedMode === 'chapter') {
        var unit = selectedUnit()
        return unit ? unit.scope : { mode: 'current' }
      }
      if (!from || !to) return { mode: 'current' }
      return { mode: 'range', from: from.value, to: to.value }
    }

    function queueSpec() {
      return {
        title: ((reader && (reader.title || reader.bookTitle)) || 'Book') + ' workbook',
        scopeInfo: scopeInfo,
        mode: workbookMode.value,
        options: {
          difficulty: difficulty.value,
          sessionMode: sessionMode.value,
          kinds: selectedKinds(),
          questionCount: Math.max(1, Math.min(20, parseInt(count.value, 10) || 6)),
          includeFigures: includeFigures.checked
        }
      }
    }

    function updateMeter() {
      if (!scopeInfo || !scopeInfo.pageRange || !from || !to) return
      var max = scopeInfo.pageRange.max
      var a = Math.max(1, Math.min(max, parseInt(from.value, 10) || 1))
      var b = Math.max(1, Math.min(max, parseInt(to.value, 10) || 1))
      var lo = Math.min(a, b), hi = Math.max(a, b)
      meterFill.style.left = (((lo - 1) / max) * 100) + '%'
      meterFill.style.width = (Math.max(1, hi - lo + 1) / max * 100) + '%'
      rangeReadout.textContent = 'Pages ' + lo + '–' + hi + ' of ' + max +
        ' · ' + (hi - lo + 1) + ((hi - lo + 1) === 1 ? ' page' : ' pages')
    }

    function scheduleRefresh() {
      updateMeter()
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refreshSource, 220)
    }

    function buildModeButton(mode, title, detail) {
      var btn = el('button', 'rai-scope-mode' + (selectedMode === mode ? ' selected' : ''))
      btn.type = 'button'; btn.setAttribute('role', 'tab')
      btn.setAttribute('aria-selected', selectedMode === mode ? 'true' : 'false')
      btn.appendChild(el('strong', null, title))
      btn.appendChild(el('span', null, detail))
      btn.addEventListener('click', function() {
        if (selectedMode === mode) return
        selectedMode = mode
        renderScopeControls()
      })
      return btn
    }

    function renderScopeControls() {
      modeButtons.innerHTML = ''; scopeControls.innerHTML = ''
      chapterSelect = null; from = null; to = null; meterFill = null; rangeReadout = null
      if (scopeInfo.units.length) {
        modeButtons.appendChild(buildModeButton('chapter', 'By ' + scopeInfo.chapterLabel.toLowerCase(),
          'Choose from the book contents'))
      }
      if (scopeInfo.pageRange) {
        modeButtons.appendChild(buildModeButton('pages', 'By page range',
          'Enter the first and last page'))
      }
      if (scopeInfo.units.length > 1 || (scopeInfo.pageRange && scopeInfo.pageRange.max > 1)) {
        modeButtons.appendChild(buildModeButton('whole-book', 'Whole book',
          'Create a resumable unit-by-unit queue'))
      }
      modeButtons.classList.toggle('single', modeButtons.children.length === 1)

      if (selectedMode === 'chapter' && scopeInfo.units.length) {
        var field = el('label', 'rai-chapter-field')
        field.appendChild(el('span', null, scopeInfo.chapterLabel))
        chapterSelect = document.createElement('select')
        scopeInfo.units.forEach(function(unit) {
          var option = document.createElement('option')
          option.value = unit.id
          option.textContent = (unit.level ? new Array(unit.level + 1).join('— ') : '') +
            unit.label + (unit.detail ? ' · ' + unit.detail : '') +
            (unit.id === scopeInfo.currentUnitId ? ' · Current' : '')
          chapterSelect.appendChild(option)
        })
        chapterSelect.value = scopeInfo.currentUnitId || scopeInfo.units[0].id
        field.appendChild(chapterSelect); scopeControls.appendChild(field)
        var unit = selectedUnit()
        scopeControls.appendChild(el('p', 'rai-scope-hint',
          unit && unit.detail ? 'The quiz will be inserted after ' + unit.detail.toLowerCase() + '.' :
            'The quiz will be inserted after this part of the book.'))
        chapterSelect.addEventListener('change', function() {
          var chosen = selectedUnit()
          var hint = scopeControls.querySelector('.rai-scope-hint')
          if (hint) hint.textContent = chosen && chosen.detail
            ? 'The quiz will be inserted after ' + chosen.detail.toLowerCase() + '.'
            : 'The quiz will be inserted after this part of the book.'
          refreshSource()
        })
      } else if (selectedMode === 'whole-book') {
        var unitCount = scopeInfo.units.length
        if (!unitCount && scopeInfo.pageRange) {
          var span = Math.max(1, Math.min(25, scopeInfo.pageRange.maxSpan || 25))
          unitCount = Math.ceil(scopeInfo.pageRange.max / span)
        }
        scopeControls.appendChild(el('p', 'rai-scope-hint',
          unitCount + (unitCount === 1 ? ' unit' : ' units') +
          ' will be added to a persistent queue. Extraction and AI generation begin only when you request them for a unit.'))
      } else if (scopeInfo.pageRange) {
        var quick = el('div', 'rai-page-quick')
        var current = el('button', 'rai-current-page',
          'Use current page ' + scopeInfo.pageRange.current)
        current.type = 'button'
        current.addEventListener('click', function() {
          from.value = to.value = String(scopeInfo.pageRange.current)
          scheduleRefresh()
        })
        quick.appendChild(current); scopeControls.appendChild(quick)
        var range = el('div', 'rai-range')
        var fromField = el('label')
        fromField.appendChild(el('span', null, 'From'))
        from = document.createElement('input')
        from.type = 'number'; from.inputMode = 'numeric'
        from.min = String(scopeInfo.pageRange.min); from.max = String(scopeInfo.pageRange.max)
        from.value = String(scopeInfo.pageRange.current)
        fromField.appendChild(from)
        var toField = el('label')
        toField.appendChild(el('span', null, 'To'))
        to = document.createElement('input')
        to.type = 'number'; to.inputMode = 'numeric'
        to.min = String(scopeInfo.pageRange.min); to.max = String(scopeInfo.pageRange.max)
        to.value = String(scopeInfo.pageRange.current)
        toField.appendChild(to)
        range.appendChild(fromField); range.appendChild(el('span', 'rai-range-arrow', '→')); range.appendChild(toField)
        scopeControls.appendChild(range)
        var meter = el('div', 'rai-range-meter'); meter.setAttribute('aria-hidden', 'true')
        meterFill = el('i'); meter.appendChild(meterFill); scopeControls.appendChild(meter)
        rangeReadout = el('p', 'rai-range-readout'); scopeControls.appendChild(rangeReadout)
        scopeControls.appendChild(el('p', 'rai-scope-hint',
          'Up to ' + scopeInfo.pageRange.maxSpan + ' consecutive pages. Reversed ranges are corrected automatically.'))
        from.addEventListener('input', scheduleRefresh); to.addEventListener('input', scheduleRefresh)
        updateMeter()
      }
      refreshSource()
    }

    function refreshSource() {
      if (!scopeInfo) return
      var seq = ++sourceSeq
      generate.disabled = true; packet = null
      summary.textContent = 'Reading the selected source…'; status.textContent = ''
      generate.textContent = 'Generate draft'
      if (selectedMode === 'whole-book') {
        var wholeUnits = scopeInfo.units.length
        if (!wholeUnits && scopeInfo.pageRange) {
          var chunk = Math.max(1, Math.min(25, scopeInfo.pageRange.maxSpan || 25))
          wholeUnits = Math.ceil(scopeInfo.pageRange.max / chunk)
        }
        summary.textContent = 'Whole-book conversion · ' + wholeUnits +
          (wholeUnits === 1 ? ' resumable unit' : ' resumable units')
        privacy.textContent = 'Creating the queue sends nothing to the provider. Each unit is extracted and generated only after an explicit action in the queue.'
        generate.textContent = 'Create conversion queue'
        generate.disabled = !wholeUnits
        return
      }
      privacy.textContent = 'Only this selection is sent to ' + providerProfile.label +
        ' when you tap Generate. Local paths and navigation targets are removed. No image pixels are sent.'
      ReaderStudySource.collect(reader, scope()).then(function(value) {
        if (seq !== sourceSeq || !document.contains(form)) return
        packet = value
        var figures = (value.figures || []).length
        var tables = (value.tables || []).length
        summary.textContent = value.label + ' · ' + value.characterCount.toLocaleString() + ' characters · ' +
          figures + (figures === 1 ? ' figure' : ' figures') + ' · ' + tables + (tables === 1 ? ' table' : ' tables')
        if (value.quality && value.quality.visualReviewRequired)
          summary.textContent += ' · Visual review required'
        generate.disabled = !providerReady
      }).catch(function(err) {
        if (seq !== sourceSeq || !document.contains(form)) return
        summary.textContent = err.message || String(err)
      })
    }

    ReaderStudySource.describeScopes(reader).then(function(info) {
      if (!document.contains(form)) return
      scopeInfo = info
      selectedMode = info.currentMode
      renderScopeControls()
    }).catch(function(err) {
      summary.textContent = err.message || String(err)
    })

    cancel.addEventListener('click', function() {
      if (activeAbort) activeAbort.abort()
      activeAbort = null
      sh.close()
    })
    providerSettings.addEventListener('click', function() {
      sh.close()
      if (reader && typeof reader.close === 'function') reader.close()
      setTimeout(function() {
        if (window.AppLibrary && AppLibrary.openAiSettings) AppLibrary.openAiSettings()
        else BooxUI.toast('Open AI settings from the Books library menu')
      }, 80)
    })
    queueButton.addEventListener('click', function() {
      if (window.BooksWorkbookQueueUI) BooksWorkbookQueueUI.open(reader)
      else status.textContent = 'The conversion queue is still loading. Try again in a moment.'
    })

    function showReview(draft, providerMeta) {
      var valid = WorkbookContracts.validateDraft(draft, packet)
      var editorialIssues = WorkbookContracts.auditDraftQuality ? WorkbookContracts.auditDraftQuality(valid, packet) : []
      form.innerHTML = ''
      form.className = 'rai-form rai-review-wizard'
      var reviewHead = el('header', 'rai-step-header')
      var reviewPage = el('span', 'rai-step-count')
      reviewHead.appendChild(reviewPage); reviewHead.appendChild(el('strong', 'rai-step-title', valid.title))
      form.appendChild(reviewHead)
      var reviewIntro = el('p', 'rai-review-intro',
        'Review each activity before insertion. The source book stays unchanged and approved work remains available offline.')
      form.appendChild(reviewIntro)
      if (packet.quality && (packet.quality.warnings || []).length) {
        var warning = el('div', 'rai-status')
        warning.textContent = 'Extraction warning: ' + packet.quality.warnings.join(' · ')
        form.appendChild(warning)
      }
      if (editorialIssues.length) {
        var editorialWarning = el('div', 'rai-status rai-editorial-review')
        editorialWarning.textContent = 'Editorial review: ' + editorialIssues.map(function(issue) {
          return (Number.isInteger(issue.activityIndex) ? 'Activity ' + (issue.activityIndex + 1) + ': ' : '') + issue.message
        }).join(' · ')
        form.appendChild(editorialWarning)
      }
      var editable = JSON.parse(JSON.stringify(draft))
      var reviewStage = el('div', 'rai-review-stage'); form.appendChild(reviewStage)
      var reviewIndex = 0
      var previousActivity = el('button', 'rai-secondary', 'Previous'); previousActivity.type = 'button'
      var nextActivity = el('button', 'rai-secondary', 'Next activity'); nextActivity.type = 'button'
      function renderReviewActivity() {
        reviewStage.innerHTML = ''
        var activity = editable.activities[reviewIndex]
        var card = el('article', 'rai-review-card')
        card.appendChild(el('div', 'rai-kicker', activity.kind.replace(/-/g, ' ') + ' · ' + activity.difficulty))
        var promptField = el('label', 'rai-chapter-field'); promptField.appendChild(el('span', null, 'Prompt'))
        var promptInput = document.createElement('textarea'); promptInput.value = activity.prompt; promptInput.rows = 2
        promptInput.addEventListener('input', function() { editable.activities[reviewIndex].prompt = promptInput.value })
        promptField.appendChild(promptInput); card.appendChild(promptField)
        var guidance = activity.explanation || activity.rubric || ''
        var guideField = el('label', 'rai-chapter-field'); guideField.appendChild(el('span', null, activity.explanation ? 'Explanation' : 'Rubric'))
        var guideInput = document.createElement('textarea'); guideInput.value = guidance; guideInput.rows = 2
        guideInput.addEventListener('input', function() {
          if (activity.explanation) editable.activities[reviewIndex].explanation = guideInput.value
          else editable.activities[reviewIndex].rubric = guideInput.value
        })
        guideField.appendChild(guideInput); card.appendChild(guideField)
        card.appendChild(el('p', 'rai-scope-hint', 'Evidence: ' + activity.evidenceRefs.join(', ') +
          (activity.figureRefs.length ? ' · Figures: ' + activity.figureRefs.join(', ') : ' · No image transmitted')))
        reviewStage.appendChild(card)
        reviewPage.textContent = 'ACTIVITY ' + (reviewIndex + 1) + ' OF ' + editable.activities.length
        previousActivity.hidden = reviewIndex === 0
        nextActivity.hidden = reviewIndex >= editable.activities.length - 1
      }
      var reviewStatus = el('div', 'rai-status'); reviewStatus.setAttribute('role', 'status'); form.appendChild(reviewStatus)
      var reviewActions = el('div', 'rai-form-actions rai-wizard-actions')
      var discard = el('button', 'rai-secondary', 'Discard draft'); discard.type = 'button'; discard.addEventListener('click', function() { sh.close() })
      var approve = el('button', 'rai-primary', 'Approve and insert'); approve.type = 'button'
      previousActivity.addEventListener('click', function() { reviewIndex -= 1; renderReviewActivity() })
      nextActivity.addEventListener('click', function() { reviewIndex += 1; renderReviewActivity() })
      approve.addEventListener('click', function() {
        try {
          var group = WorkbookContracts.validateAndCompile(editable, packet, providerMeta, { sessionMode: sessionMode.value })
          NativePages.insertGroup(reader, group); sh.close()
        } catch (err) { reviewStatus.textContent = err.message || String(err) }
      })
      reviewActions.appendChild(discard); reviewActions.appendChild(previousActivity)
      reviewActions.appendChild(nextActivity); reviewActions.appendChild(approve); form.appendChild(reviewActions)
      renderReviewActivity()
    }

    generate.addEventListener('click', function() {
      if (selectedMode === 'whole-book') {
        if (!window.BooksWorkbookQueueUI) {
          status.textContent = 'The conversion queue is still loading. Try again in a moment.'
          return
        }
        var queueKinds = selectedKinds()
        if (!queueKinds.length) { status.textContent = 'Choose at least one activity family'; return }
        try {
          var job = BooksWorkbookQueueUI.createJob(reader, queueSpec())
          sh.close()
          BooksWorkbookQueueUI.open(reader, job.id)
        } catch (error) { status.textContent = error.message || String(error) }
        return
      }
      if (!packet) return
      var n = Math.max(1, Math.min(20, parseInt(count.value, 10) || 5))
      count.value = String(n)
      if (!DeepSeekQuizProvider.hasKey()) {
        status.textContent = 'Add the API key in Books AI quiz settings first'
        return
      }
      generate.disabled = true; cancel.textContent = 'Cancel request'
      var kinds = selectedKinds()
      if (!kinds.length) { status.textContent = 'Choose at least one activity family'; generate.disabled = false; return }
      status.textContent = 'Generating ' + n + ' grounded activities…'
      activeAbort = new AbortController()
      var options = { questionCount: n, includeFigures: includeFigures.checked }
      var template = WorkbookContracts.providerTemplate({ kinds: kinds, difficulty: difficulty.value, mode: workbookMode.value, questionCount: n, source: packet })
      DeepSeekQuizProvider.generate(packet, options, template, activeAbort.signal, null)
          .then(function(first) {
            return Promise.resolve().then(function() {
              var draft = parseDraft(first.raw)
              var valid = WorkbookContracts.validateDraft(draft, packet)
              WorkbookContracts.validateGenerationPolicy(valid, template)
              if (WorkbookContracts.validateEditorialQuality) WorkbookContracts.validateEditorialQuality(valid, packet)
              return { draft: draft, provider: first }
            }).catch(function(err) {
              return DeepSeekQuizProvider.generate(packet, options, template, activeAbort.signal,
                { error: err.message, previous: first.raw }).then(function(second) {
                  var draft = parseDraft(second.raw)
                  var valid = WorkbookContracts.validateDraft(draft, packet)
                  WorkbookContracts.validateGenerationPolicy(valid, template)
                  if (WorkbookContracts.validateEditorialQuality) WorkbookContracts.validateEditorialQuality(valid, packet)
                  return { draft: draft, provider: second }
                })
            })
          })
      .then(function(result) {
        activeAbort = null
        showReview(result.draft, result.provider)
      }).catch(function(err) {
        activeAbort = null
        if (!document.contains(form)) return
        status.textContent = err.message || String(err)
        generate.disabled = false; cancel.textContent = 'Cancel'
      })
    })
  }

  return { enabled: enabled, open: open, _parseDraft: parseDraft }
})()
