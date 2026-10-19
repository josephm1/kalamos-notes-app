(function (root) {
  'use strict'
  var IMAGE_ENDPOINT = 'https://openrouter.ai/api/v1/images', KEY_REF = 'kalamos_ai_image'
  function bridge() { if (!root.AB || !root.AB.call) throw new Error('The native AI bridge is unavailable'); return root.AB }
  function settings() { var ai = bridge().call('ai.config.get', {}); return ai && ai.imageGeneration || { provider: 'openrouter', model: 'black-forest-labs/flux.2-klein-4b', configured: false } }
  function hasKey() { try { return !!settings().configured } catch (_) { return false } }
  function clean(value, max) { return String(value || '').replace(/<[^>]*>|(?:javascript|data|file|https?):\s*(?:\/\/|[^\s]*)/gi, '').replace(/\s+/g, ' ').trim().slice(0, max) }
  function start(url, body, signal) {
    return new Promise(function (resolve, reject) {
      var ab
      try { ab = bridge() } catch (error) { reject(error); return }
      if (!hasKey()) { reject(new Error('Add the OpenRouter image key in Play image settings')); return }
      var request = ab.call('http.request', { url: url, method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer {{secret:' + KEY_REF + '}}', 'http-referer': 'https://kalamos.local', 'x-title': 'Kalamos Play' }, body: JSON.stringify(body) })
      if (!request || request.err || !request.reqId) { reject(new Error('Could not start the asset request')); return }
      var done = false, off = ab.on(request.reqId, function (event) { if (done) return; if (event.type === 'response') { done = true; off(); if (Number(event.status) < 200 || Number(event.status) >= 300) { reject(new Error('Asset provider request failed')); return } try { resolve(JSON.parse(event.body || '{}')) } catch (_) { reject(new Error('Asset provider returned invalid JSON')) } } else if (event.type === 'error') { done = true; off(); reject(new Error(event.message || 'Asset provider request failed')) } })
      if (signal) signal.addEventListener('abort', function () { if (done) return; done = true; off(); ab.call('http.cancel', { reqId: request.reqId }); reject(new Error('Asset request cancelled')) }, { once: true })
    })
  }
  async function generate(prompt, options, signal) {
    options = options || {}; prompt = clean(prompt, 1800); if (!prompt) throw new Error('Describe the illustration')
    var puzzle = options.mode === 'puzzle', settingsValue = settings(), body = { model: settingsValue.model || 'black-forest-labs/flux.2-klein-4b', prompt: [
      'Create an original educational ' + (puzzle ? 'puzzle diagram' : 'editorial illustration') + ' for a monochrome e-ink tablet. Scene and task: ' + prompt + '.',
      'Precise editorial pen-and-ink line drawing on pure white paper. Strong black contours, a few large recognizable objects, generous blank white space for pen marks, clear spatial relationships and readable composition at tablet size.',
      puzzle ? 'Show the actual starting scene. Leave the learner-required mark, connection, route, or missing region visibly unfinished; do not draw the answer.' : 'Show a complete, historically cautious scene. Avoid invented labels, specific likeness claims, and visual details that imply unsupported facts.',
      'Black ink only: no color, grey shading, halftone, gradients, texture, tiny details, logos, typography, letters, numbers or captions. Exact instructions will appear outside the picture.'
    ].join(' '), n: 1, aspect_ratio: ['1:1', '4:3', '3:4', '3:2', '2:3'].indexOf(options.aspectRatio) >= 0 ? options.aspectRatio : '4:3', output_format: 'png' }
    if (options.reference && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(options.reference) && options.reference.length < 10000000) body.input_references = [{ type: 'image_url', image_url: { url: options.reference } }]
    var envelope = await start(IMAGE_ENDPOINT, body, signal), image = envelope.data && envelope.data[0], b64 = image && image.b64_json
    if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 100 || b64.length > 14000000) throw new Error('The provider returned an invalid image')
    if (image.media_type && image.media_type !== 'image/png') throw new Error('The provider did not return a PNG')
    return { dataUrl: 'data:image/png;base64,' + b64, mime: 'image/png', model: body.model, generated: true, sourceEvidence: false, costUsd: Number(envelope.usage && envelope.usage.cost) || null }
  }
  root.KalamosContentAssets = { imageEndpoint: IMAGE_ENDPOINT, keyRef: KEY_REF, settings: settings, hasKey: hasKey, generate: generate }
})(typeof window !== 'undefined' ? window : globalThis)
