// Anthropic adapter — Claude via the Messages API (SSE streaming) through the native
// http.stream bridge. The key never enters JS: headers carry a {{secret:...}} placeholder
// that ScribeBridge substitutes natively.
(function () {
  function sseFeed(onEvent) {
    // Reassembles SSE from arbitrary chunk boundaries; calls onEvent(eventName, dataObj).
    let buf = ''
    return function (chunk) {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2)
        let name = 'message', data = ''
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) name = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        if (!data) continue
        let obj = null
        try { obj = JSON.parse(data) } catch (e) { continue }
        onEvent(name, obj)
      }
    }
  }

  AiBus.register({
    kind: 'anthropic',

    listModels(cfg) {
      return new Promise((resolve) => {
        const r = AB.call('http.request', {
          url: (cfg.baseUrl || 'https://api.anthropic.com') + '/v1/models',
          method: 'GET',
          headers: {
            'x-api-key': '{{secret:' + (cfg.keyRef || 'anthropic_key') + '}}',
            'anthropic-version': '2023-06-01'
          }
        })
        if (!r.reqId) return resolve([])
        AB.on(r.reqId, (ev) => {
          if (ev.type === 'response') {
            try {
              const body = JSON.parse(ev.body)
              resolve((body.data || []).map(m => ({ id: m.id, label: m.display_name || m.id })))
            } catch (e) { resolve([]) }
          } else if (ev.type === 'error') resolve([])
        })
      })
    },

    send(cfg, req) {
      const body = {
        model: req.model || cfg.model || 'claude-opus-4-8',
        max_tokens: req.maxTokens || 4096,
        stream: true,
        system: req.system || undefined,
        messages: (req.messages || []).map(m => ({
          role: m.role,
          content: (m.content || []).map(c => {
            if (c.type === 'text') return { type: 'text', text: c.text }
            if (c.type === 'image') {
              const b64 = (c.dataUrl || '').replace(/^data:image\/\w+;base64,/, '')
              return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } }
            }
            return { type: 'text', text: '' }
          })
        }))
      }
      const r = AB.call('http.stream', {
        url: (cfg.baseUrl || 'https://api.anthropic.com') + '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': '{{secret:' + (cfg.keyRef || 'anthropic_key') + '}}',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (r.err || !r.reqId) {
        req.onEvent({ type: 'error', code: r.err ? 'bridge' : 'no-req', message: r.err || 'request failed', retryable: false })
        return null
      }
      const reqId = r.reqId
      let stopReason = 'end_turn'
      let httpStatus = 0
      let errBody = ''
      const feed = sseFeed((name, obj) => {
        const t = obj.type || name
        if (t === 'message_start') {
          req.onEvent({ type: 'start', provider: 'anthropic', model: (obj.message && obj.message.model) || body.model })
        } else if (t === 'content_block_delta') {
          const d = obj.delta || {}
          if (d.type === 'text_delta') req.onEvent({ type: 'text', delta: d.text || '' })
          else if (d.type === 'thinking_delta') req.onEvent({ type: 'thinking', delta: d.thinking || '' })
        } else if (t === 'message_delta') {
          if (obj.delta && obj.delta.stop_reason) stopReason = obj.delta.stop_reason
          if (obj.usage) req.onEvent({ type: 'usage', inputTokens: obj.usage.input_tokens || 0, outputTokens: obj.usage.output_tokens || 0 })
        } else if (t === 'error') {
          const e = obj.error || {}
          req.onEvent({ type: 'error', code: e.type || 'api', message: e.message || 'API error', retryable: e.type === 'overloaded_error' })
        }
      })
      AB.on(reqId, (ev) => {
        if (ev.type === 'open') { httpStatus = ev.status || 0 }
        else if (ev.type === 'chunk') {
          if (httpStatus >= 400) { errBody += ev.data; return }
          feed(ev.data || '')
        } else if (ev.type === 'end') {
          if (httpStatus >= 400) {
            let msg = 'HTTP ' + httpStatus
            try { msg = JSON.parse(errBody).error.message || msg } catch (e) {}
            req.onEvent({ type: 'error', code: 'http-' + httpStatus, message: msg, retryable: httpStatus === 429 || httpStatus >= 500 })
          } else {
            req.onEvent({ type: 'done', stopReason: ev.cancelled ? 'cancelled' : stopReason })
          }
        } else if (ev.type === 'error') {
          req.onEvent({ type: 'error', code: ev.code || 'net', message: ev.message || 'network error', retryable: true })
        }
      })
      return reqId
    },

    cancel(reqId) { AB.call('http.cancel', { reqId: reqId }) }
  })
})();
