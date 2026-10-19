// Optional, explicitly invoked figure analysis. Image bytes go only to OpenRouter; the returned
// bounded description may be passed to the text generator as ordinary untrusted source metadata.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.OpenRouterVisionProvider = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
  var IMAGE_ENDPOINT = 'https://openrouter.ai/api/v1/images'
  var KEY_REF = 'books_ai_key_openrouter'
  var STORE = 'kal.books.ai.vision.model.v1'
  var MODELS = [
    { id: 'google/gemma-3-12b-it', label: 'Gemma 3 12B · economical' },
    { id: 'openrouter/free', label: 'Free router · variable availability' },
    { id: 'qwen/qwen3.5-35b-a3b', label: 'Qwen 3.5 35B · higher quality' }
  ]

  function bridge() {
    if (!root.AB || typeof root.AB.call !== 'function') throw new Error('The native AI bridge is unavailable')
    return root.AB
  }
  function model() {
    var value = ''
    try { value = root.localStorage.getItem(STORE) || '' } catch (e) {}
    return MODELS.some(function(row) { return row.id === value }) ? value : MODELS[0].id
  }
  function setModel(value) {
    if (!MODELS.some(function(row) { return row.id === value })) throw new Error('Unsupported vision model')
    root.localStorage.setItem(STORE, value); return value
  }
  function hasKey() { try { return !!bridge().call('secret.has', { key: KEY_REF }).has } catch (e) { return false } }
  function setKey(value) {
    value = String(value || '').trim(); if (!value) throw new Error('Paste an OpenRouter API key')
    var out = bridge().call('secret.set', { key: KEY_REF, value: value })
    if (out.err) throw new Error('The OpenRouter key could not be saved')
    return true
  }
  function clearKey() { return bridge().call('secret.clear', { key: KEY_REF }) }
  function cleanText(value, max) {
    value = String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
    if (value.length > max) value = value.slice(0, max)
    return value.replace(/<[^>]*>|(?:javascript|data|file|https?):\s*(?:\/\/|[^\s]*)/gi, '')
  }
  function validate(raw, figureId) {
    var value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vision response is not an object')
    Object.keys(value).forEach(function(key) {
      if (['summary', 'visibleText', 'diagramType', 'regions', 'warnings'].indexOf(key) < 0)
        throw new Error('Vision response contains an unsupported field')
    })
    var regions = Array.isArray(value.regions) ? value.regions.slice(0, 24).map(function(row) {
      if (!row || typeof row !== 'object') return null
      var x = Number(row.x), y = Number(row.y), width = Number(row.width), height = Number(row.height)
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null
      return { label: cleanText(row.label, 120), x: x, y: y, width: width, height: height }
    }).filter(Boolean) : []
    return {
      figureId: figureId,
      summary: cleanText(value.summary, 1600), visibleText: cleanText(value.visibleText, 2400),
      diagramType: cleanText(value.diagramType, 120), regions: regions,
      warnings: (Array.isArray(value.warnings) ? value.warnings : []).slice(0, 8).map(function(row) { return cleanText(row, 240) }).filter(Boolean)
    }
  }
  function requestBody(dataUrl, figureId) {
    if (typeof dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(dataUrl) || dataUrl.length > 12000000)
      throw new Error('Choose a PNG, JPEG, or WebP figure smaller than 9 MB')
    return {
      model: model(), temperature: 0, max_tokens: 1800, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Analyze one study-book figure. Return JSON only with summary, visibleText, diagramType, regions, warnings. Regions use normalized x, y, width, height. Do not answer study questions, diagnose patients, return code, markup, links, or file paths.' },
        { role: 'user', content: [
          { type: 'text', text: 'Describe figure ' + figureId + ' faithfully for a source-grounded workbook. Transcribe only clearly visible text and flag uncertainty.' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ] }
      ]
    }
  }
  function analyze(dataUrl, figureId, signal) {
    return new Promise(function(resolve, reject) {
      var ab, body
      try { ab = bridge(); body = requestBody(dataUrl, figureId) } catch (e) { reject(e); return }
      if (!hasKey()) { reject(new Error('Add the OpenRouter vision key in AI settings')); return }
      var start = ab.call('http.request', { url: ENDPOINT, method: 'POST', headers: {
        'content-type': 'application/json', 'authorization': 'Bearer {{secret:' + KEY_REF + '}}',
        'http-referer': 'https://kalamos.local', 'x-title': 'Kalamos Books'
      }, body: JSON.stringify(body) })
      if (start.err || !start.reqId) { reject(new Error('Could not start the OpenRouter vision request')); return }
      var done = false
      var off = ab.on(start.reqId, function(event) {
        if (done) return
        if (event.type === 'response') {
          done = true; off()
          if (Number(event.status) < 200 || Number(event.status) >= 300) { reject(new Error('OpenRouter vision request failed')); return }
          try {
            var envelope = JSON.parse(event.body || '{}'); var content = envelope.choices && envelope.choices[0] && envelope.choices[0].message && envelope.choices[0].message.content
            resolve({ analysis: validate(content, figureId), model: envelope.model || model(), usage: envelope.usage || null })
          } catch (e) { reject(new Error('OpenRouter returned an invalid vision description')) }
        } else if (event.type === 'error') { done = true; off(); reject(new Error(event.message || 'OpenRouter vision request failed')) }
      })
      if (signal) signal.addEventListener('abort', function() {
        if (done) return; done = true; off(); ab.call('http.cancel', { reqId: start.reqId }); reject(new Error('Vision analysis cancelled'))
      }, { once: true })
    })
  }
  function generateAsset(prompt, options, signal) {
    options = options || {}
    prompt = cleanText(prompt, 1800)
    if (!prompt) return Promise.reject(new Error('Describe the illustration to generate'))
    return new Promise(function(resolve, reject) {
      var ab
      try { ab = bridge() } catch (e) { reject(e); return }
      if (!hasKey()) { reject(new Error('Add the OpenRouter key in AI settings')); return }
      var body = {
        model: 'recraft/recraft-v4',
        prompt: prompt + ' Original educational illustration, mature academic tone, high-contrast black labels and outlines, restrained colour palette, readable in grayscale and on e-ink. Do not include logos or copyrighted characters.',
        n: 1, resolution: '1K', aspect_ratio: ['1:1', '4:3', '3:4', '16:9'].indexOf(options.aspectRatio) >= 0 ? options.aspectRatio : '4:3',
        output_format: 'png', background: 'opaque'
      }
      var start = ab.call('http.request', { url: IMAGE_ENDPOINT, method: 'POST', headers: {
        'content-type': 'application/json', 'authorization': 'Bearer {{secret:' + KEY_REF + '}}',
        'http-referer': 'https://kalamos.local', 'x-title': 'Kalamos Books'
      }, body: JSON.stringify(body) })
      if (start.err || !start.reqId) { reject(new Error('Could not start image generation')); return }
      var done = false
      var off = ab.on(start.reqId, function(event) {
        if (done) return
        if (event.type === 'response') {
          done = true; off()
          if (Number(event.status) < 200 || Number(event.status) >= 300) { reject(new Error('OpenRouter image generation failed')); return }
          try {
            var envelope = JSON.parse(event.body || '{}'); var image = envelope.data && envelope.data[0]
            var b64 = image && image.b64_json
            if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 100 || b64.length > 14000000)
              throw new Error('invalid image')
            resolve({ dataUrl: 'data:image/png;base64,' + b64, mediaType: 'image/png', model: body.model,
              usage: envelope.usage || null, generated: true, sourceEvidence: false })
          } catch (e) { reject(new Error('OpenRouter returned an invalid generated image')) }
        } else if (event.type === 'error') { done = true; off(); reject(new Error(event.message || 'OpenRouter image generation failed')) }
      })
      if (signal) signal.addEventListener('abort', function() {
        if (done) return; done = true; off(); ab.call('http.cancel', { reqId: start.reqId }); reject(new Error('Image generation cancelled'))
      }, { once: true })
    })
  }
  return { endpoint: ENDPOINT, imageEndpoint: IMAGE_ENDPOINT, keyRef: KEY_REF, models: function() { return MODELS.map(function(row) { return Object.assign({}, row) }) }, model: model, setModel: setModel, hasKey: hasKey, setKey: setKey, clearKey: clearKey, analyze: analyze, generateAsset: generateAsset, validate: validate, _requestBody: requestBody }
})
