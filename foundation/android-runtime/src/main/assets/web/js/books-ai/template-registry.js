// Immutable interaction-template registry and compiler.
//
// Models return data only. This module is the sole authority that turns validated data into
// persistent native-page entries; provider and reader code never choose a renderer or layout.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.InteractionTemplates = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var BASE = 'interaction-templates/'
  var loaded = null
  var UNSAFE = /<[^>]*>|(?:javascript|data|https?):\s*\/\//i

  function json(path) {
    return fetch(BASE + path).then(function(r) {
      if (!r.ok) throw new Error('Template asset missing: ' + path)
      return r.json()
    })
  }

  function text(path) {
    return fetch(BASE + path).then(function(r) {
      if (!r.ok) throw new Error('Template asset missing: ' + path)
      return r.text()
    })
  }

  function ensureLoaded() {
    if (loaded) return loaded
    var bundled = root && root.InteractionTemplateBundles &&
      root.InteractionTemplateBundles['mcq-basic/v1']
    if (bundled) {
      loaded = Promise.resolve(bundled).then(function(bundle) {
        assertBundle(bundle)
        return bundle
      })
      return loaded
    }
    loaded = json('catalog.json').then(function(catalog) {
      if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.templates))
        throw new Error('Invalid interaction-template catalogue')
      var row = catalog.templates.find(function(t) {
        return t.id === 'mcq-basic' && t.version === 1 && t.status === 'active'
      })
      if (!row || !/^[a-z0-9-]+\/v[0-9]+$/.test(row.path || ''))
        throw new Error('mcq-basic v1 is not registered')
      var dir = row.path + '/'
      return Promise.all([
        json(dir + 'manifest.json'),
        json(dir + 'schema.json'),
        json(dir + 'example.json'),
        text(dir + 'prompt.txt')
      ]).then(function(parts) {
        var bundle = { catalog: catalog, manifest: parts[0], schema: parts[1], example: parts[2], prompt: parts[3] }
        assertBundle(bundle)
        return bundle
      })
    }).catch(function(err) {
      loaded = null
      throw err
    })
    return loaded
  }

  function assertBundle(bundle) {
    var m = bundle.manifest || {}
    if (m.id !== 'mcq-basic' || m.version !== 1 || m.renderer !== 'mcq-basic')
      throw new Error('Unsupported template manifest')
    if (!m.limits || m.limits.minQuestions !== 1 || m.limits.maxQuestions !== 20 ||
        m.limits.choicesPerQuestion !== 4)
      throw new Error('Template limits do not match the runtime contract')
    if (!bundle.schema || bundle.schema.additionalProperties !== false)
      throw new Error('Template schema must reject extra top-level properties')
  }

  function exactKeys(obj, allowed, at) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(at + ' must be an object')
    Object.keys(obj).forEach(function(key) {
      if (allowed.indexOf(key) === -1) throw new Error(at + ' contains unsupported field "' + key + '"')
    })
  }

  function safeString(value, name, max) {
    if (typeof value !== 'string') throw new Error(name + ' must be text')
    var out = value.replace(/\s+/g, ' ').trim()
    if (!out) throw new Error(name + ' cannot be empty')
    if (out.length > max) throw new Error(name + ' is too long')
    if (UNSAFE.test(out)) throw new Error(name + ' contains markup, code, or a URL')
    return out
  }

  function validateDraft(draft, source, options, manifest) {
    manifest = manifest || {
      limits: { minQuestions: 1, maxQuestions: 20, choicesPerQuestion: 4,
        promptChars: 600, choiceChars: 240, explanationChars: 1200, titleChars: 120 }
    }
    options = options || {}
    var limits = manifest.limits
    exactKeys(draft, ['schemaVersion', 'templateId', 'templateVersion', 'title', 'questions'], 'Quiz')
    if (draft.schemaVersion !== 1 || draft.templateId !== 'mcq-basic' || draft.templateVersion !== 1)
      throw new Error('Quiz uses an unsupported schema or template version')
    var title = safeString(draft.title, 'Quiz title', limits.titleChars)
    if (!Array.isArray(draft.questions)) throw new Error('Quiz questions must be an array')
    var wanted = Math.max(limits.minQuestions, Math.min(limits.maxQuestions, parseInt(options.questionCount, 10) || 5))
    if (draft.questions.length !== wanted)
      throw new Error('Expected exactly ' + wanted + ' questions, received ' + draft.questions.length)
    var refs = {}
    ;((source && source.segments) || []).forEach(function(s) { refs[s.id] = s })
    var questions = draft.questions.map(function(q, qi) {
      var at = 'Question ' + (qi + 1)
      exactKeys(q, ['prompt', 'choices', 'correctIndex', 'explanation', 'evidenceRefs'], at)
      if (!Array.isArray(q.choices) || q.choices.length !== limits.choicesPerQuestion)
        throw new Error(at + ' must have exactly four choices')
      var choices = q.choices.map(function(c, ci) {
        return safeString(c, at + ' choice ' + (ci + 1), limits.choiceChars)
      })
      var unique = {}
      choices.forEach(function(c) {
        var key = c.toLocaleLowerCase()
        if (unique[key]) throw new Error(at + ' contains duplicate choices')
        unique[key] = true
      })
      if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= choices.length)
        throw new Error(at + ' has an invalid correctIndex')
      if (!Array.isArray(q.evidenceRefs) || !q.evidenceRefs.length || q.evidenceRefs.length > 6)
        throw new Error(at + ' must cite one to six source segments')
      var evidence = []
      q.evidenceRefs.forEach(function(ref) {
        if (typeof ref !== 'string' || !refs[ref]) throw new Error(at + ' cites an unknown source segment')
        if (!evidence.some(function(e) { return e.id === ref })) {
          var segment = refs[ref]
          evidence.push({
            id: ref,
            label: segment.label || ref,
            // This target came from ReaderStudySource, not the model. It is safe to persist with
            // the immutable quiz and remains usable even if the source reader later reflows.
            target: segment.target || null
          })
        }
      })
      return {
        prompt: safeString(q.prompt, at + ' prompt', limits.promptChars),
        choices: choices,
        correctIndex: q.correctIndex,
        explanation: safeString(q.explanation, at + ' explanation', limits.explanationChars),
        evidence: evidence
      }
    })
    return { schemaVersion: 1, templateId: 'mcq-basic', templateVersion: 1, title: title, questions: questions }
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }

  function shuffledQuestion(q, qid) {
    var rows = q.choices.map(function(text, i) { return { text: text, correct: i === q.correctIndex } })
    for (var i = rows.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp
    }
    var choices = rows.map(function(row, i) {
      return { id: qid + '-c' + (i + 1), text: row.text }
    })
    var correct = rows.findIndex(function(row) { return row.correct })
    return {
      id: qid,
      prompt: q.prompt,
      choices: choices,
      answerId: choices[correct].id,
      explanation: q.explanation,
      evidence: q.evidence
    }
  }

  function compile(valid, source, providerMeta) {
    var groupId = uid('aiq')
    var questions = valid.questions.map(function(q, i) {
      return shuffledQuestion(q, groupId + '-q' + (i + 1))
    })
    var pages = questions.map(function(q, i) {
      var id = groupId + '-p' + (i + 1)
      return {
        id: id,
        title: valid.title,
        page: {
          pageId: id,
          template: 'ai-quiz',
          blocks: [],
          interaction: {
            type: 'mcq-basic',
            groupId: groupId,
            questionIndex: i,
            questionCount: questions.length,
            question: q
          }
        }
      }
    })
    var resultId = groupId + '-results'
    pages.push({
      id: resultId,
      title: valid.title,
      page: {
        pageId: resultId,
        template: 'ai-quiz',
        blocks: [],
        interaction: {
          type: 'mcq-results',
          groupId: groupId,
          questionCount: questions.length,
          questions: questions.map(function(q) { return { id: q.id } })
        }
      }
    })
    return {
      id: groupId,
      kind: 'ai-quiz',
      title: valid.title,
      after: source.anchor,
      createdAt: new Date().toISOString(),
      template: { id: valid.templateId, version: valid.templateVersion },
      source: {
        format: source.format,
        scope: source.scope,
        label: source.label,
        fingerprint: source.fingerprint
      },
      provider: {
        id: (providerMeta && providerMeta.providerId) || 'deepseek',
        model: (providerMeta && providerMeta.model) || 'deepseek-v4-flash',
        usage: (providerMeta && providerMeta.usage) || null
      },
      pages: pages
    }
  }

  function validateAndCompile(draft, source, options, providerMeta) {
    return ensureLoaded().then(function(bundle) {
      return compile(validateDraft(draft, source, options, bundle.manifest), source, providerMeta)
    })
  }

  return {
    ensureLoaded: ensureLoaded,
    validateDraft: validateDraft,
    validateAndCompile: validateAndCompile,
    _compile: compile,
    _unsafePattern: UNSAFE
  }
})
