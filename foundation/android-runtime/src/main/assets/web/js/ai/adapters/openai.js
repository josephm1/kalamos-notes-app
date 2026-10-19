// OpenAI-compatible adapter — /chat/completions with stream:true. Covers OpenAI itself and
// any compatible local server (llama.cpp --api, ollama, LM Studio…). keyRef null/absent →
// no Authorization header (typical for LAN servers).
(function () {
  function lineFeed(onData) {
    // SSE "data: {...}" lines; tolerant of chunk splits.
    let buf = ''
    return function (chunk) {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { onData(null); continue }
        try { onData(JSON.parse(data)) } catch (e) {}
      }
    }
  }

  AiBus.register({
    kind: 'openai',

    listModels(cfg) {
      return new Promise((resolve) => {
        const headers = {}
        if (cfg.keyRef) headers['Authorization'] = 'Bearer {{secret:' + cfg.keyRef + '}}'
        const r = AB.call('http.request', { url: cfg.baseUrl.replace(/\/$/, '') + '/models', method: 'GET', headers: headers })
        if (!r.reqId) return resolve([])
        AB.on(r.reqId, (ev) => {
          if (ev.type === 'response') {
            try { resolve((JSON.parse(ev.body).data || []).map(m => ({ id: m.id, label: m.id }))) }
            catch (e) { resolve([]) }
          } else if (ev.type === 'error') resolve([])
        })
      })
    },

    send(cfg, req) {
      const messages = []
      if (req.system) messages.push({ role: 'system', content: req.system })
      for (const m of (req.messages || [])) {
        const parts = (m.content || [])
        const hasImage = parts.some(c => c.type === 'image')
        if (hasImage) {
          messages.push({
            role: m.role,
            content: parts.map(c => c.type === 'image'
              ? { type: 'image_url', image_url: { url: c.dataUrl } }
              : { type: 'text', text: c.text || '' })
          })
        } else {
          messages.push({ role: m.role, content: parts.map(c => c.text || '').join('\n') })
        }
      }
      const headers = { 'content-type': 'application/json' }
      if (cfg.keyRef) headers['Authorization'] = 'Bearer {{secret:' + cfg.keyRef + '}}'
      const r = AB.call('http.stream', {
        url: cfg.baseUrl.replace(/\/$/, '') + '/chat/completions',
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ model: req.model || cfg.model || '', max_tokens: req.maxTokens, stream: true, messages: messages })
      })
      if (r.err || !r.reqId) {
        req.onEvent({ type: 'error', code: r.err ? 'bridge' : 'no-req', message: r.err || 'request failed', retryable: false })
        return null
      }
      const reqId = r.reqId
      let started = false
      let httpStatus = 0
      let errBody = ''
      const feed = lineFeed((obj) => {
        if (!obj) return
        if (!started) { started = true; req.onEvent({ type: 'start', provider: 'openai', model: obj.model || req.model || '' }) }
        const ch = obj.choices && obj.choices[0]
        if (ch && ch.delta && ch.delta.content) req.onEvent({ type: 'text', delta: ch.delta.content })
        if (obj.usage) req.onEvent({ type: 'usage', inputTokens: obj.usage.prompt_tokens || 0, outputTokens: obj.usage.completion_tokens || 0 })
      })
      AB.on(reqId, (ev) => {
        if (ev.type === 'open') httpStatus = ev.status || 0
        else if (ev.type === 'chunk') {
          if (httpStatus >= 400) { errBody += ev.data; return }
          feed(ev.data || '')
        } else if (ev.type === 'end') {
          if (httpStatus >= 400) {
            let msg = 'HTTP ' + httpStatus
            try { msg = JSON.parse(errBody).error.message || msg } catch (e) {}
            req.onEvent({ type: 'error', code: 'http-' + httpStatus, message: msg, retryable: httpStatus === 429 || httpStatus >= 500 })
          } else req.onEvent({ type: 'done', stopReason: ev.cancelled ? 'cancelled' : 'end_turn' })
        } else if (ev.type === 'error') {
          req.onEvent({ type: 'error', code: ev.code || 'net', message: ev.message || 'network error', retryable: true })
        }
      })
      return reqId
    },

    cancel(reqId) { AB.call('http.cancel', { reqId: reqId }) }
  })
})();
