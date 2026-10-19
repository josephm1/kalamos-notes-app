// AB — thin JSON wrapper over the native AppBridge (shared AppBridgeRouter, delegate
// ScribeBridge in this app's Kotlin). In the browser preview the stub answers
// {"err":"no-app-bridge"} and callers fall back (echo adapter, no HWR).
//
// Contract: AB.call(method, args) → parsed result object (always an object; {err} on failure).
// Async work identifies itself by a returned id (reqId/sockId); events arrive batched via
// window.onAppEvent as [{id, kind, type, ...}, ...] and are fanned out to AB.handlers[id].
const AB = {
  handlers: {},          // id -> fn(event)

  call(method, args) {
    try {
      const res = window.AppBridge.call(method, JSON.stringify(args || {}))
      return JSON.parse(res)
    } catch (e) {
      return { err: String(e) }
    }
  },

  native() {
    const r = this.call('sys.info', {})
    return !r.err
  },

  // Register a handler for one async operation; returns an unsubscribe fn.
  on(id, fn) {
    this.handlers[id] = fn
    return () => { delete this.handlers[id] }
  },

  off(id) { delete this.handlers[id] }
};

// ---- browser-preview fake ------------------------------------------------------------
// In the preview there is no native ScribeBridge; the core stub answers "no-app-bridge".
// Replace it with a functional fake so live AI demos work in the browser: secrets in
// localStorage, HTTP streamed through the preview server's /aiproxy (same-origin —
// the page itself can't reach AI APIs cross-origin). ws/hwr stay unavailable.
(function () {
  const isPreview = location.protocol.startsWith('http')
  let nativeOk = false
  try { nativeOk = !JSON.parse(window.AppBridge.call('sys.info', '{}')).err } catch (e) {}
  if (nativeOk || !isPreview) return

  let seq = 0
  const aborts = {}   // reqId -> AbortController
  const S = (k) => 'scribe_secret_' + k
  const emit = (ev) => setTimeout(() => window.onAppEvent(JSON.stringify([ev])), 0)

  // Seed secrets the preview server was launched with (SCRIBE_SECRET_* env → /devsecrets)
  // so live AI demos work without pasting keys into the browser.
  fetch('/devsecrets').then(r => r.ok ? r.json() : {}).then(sec => {
    Object.entries(sec || {}).forEach(([k, v]) => { if (v) localStorage.setItem(S(k), v) })
  }).catch(() => {})

  function substitute(v) {
    let missing = false
    const out = String(v).replace(/\{\{secret:([\w.-]+)}}/g, (_, name) => {
      const s = localStorage.getItem(S(name))
      if (!s) missing = true
      return s || ''
    })
    return missing ? null : out
  }

  function proxied(args, reqId, streaming) {
    const headers = {}
    let bad = false
    Object.entries(args.headers || {}).forEach(([k, v]) => {
      const s = substitute(v)
      if (s === null) bad = true
      headers[k] = s || ''
    })
    if (bad) {
      emit({ id: reqId, kind: 'http', type: 'error', code: 'no-key',
             message: 'A required API key is not set — add it in Settings' })
      return
    }
    const ctrl = new AbortController()
    aborts[reqId] = ctrl
    fetch('/aiproxy', {
      method: 'POST', signal: ctrl.signal,
      body: JSON.stringify({ url: args.url, method: args.method || 'GET', headers: headers, body: args.body })
    }).then(async (resp) => {
      if (!streaming) {
        const body = await resp.text()
        emit({ id: reqId, kind: 'http', type: 'response', status: resp.status, body: body })
        emit({ id: reqId, kind: 'http', type: 'end' })
        return
      }
      emit({ id: reqId, kind: 'http', type: 'open', status: resp.status })
      const reader = resp.body.getReader()
      const dec = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        emit({ id: reqId, kind: 'http', type: 'chunk', data: dec.decode(value, { stream: true }) })
      }
      emit({ id: reqId, kind: 'http', type: 'end' })
    }).catch((e) => {
      if (e.name === 'AbortError') emit({ id: reqId, kind: 'http', type: 'end', cancelled: true })
      else emit({ id: reqId, kind: 'http', type: 'error', code: 'net', message: String(e.message || e) })
    }).finally(() => { delete aborts[reqId] })
  }

  window.AppBridge = {
    call: function (method, argsJson) {
      const args = JSON.parse(argsJson || '{}')
      switch (method) {
        case 'sys.info': return JSON.stringify({ online: navigator.onLine, version: 0, hwr: 'unavailable', preview: true })
        case 'secret.set': localStorage.setItem(S(args.key), args.value); return '{"ok":true}'
        case 'secret.has': return JSON.stringify({ has: !!localStorage.getItem(S(args.key)) })
        case 'secret.clear': localStorage.removeItem(S(args.key)); return '{"ok":true}'
        case 'ai.config.get': return JSON.stringify({ activeProvider: 'zai', label: 'Z.AI', configured: !!localStorage.getItem(S('kalamos_ai_active')),
          baseUrl: 'https://api.z.ai/api/paas/v4', chatUrl: 'https://api.z.ai/api/paas/v4/chat/completions', model: 'glm-5.3-flash', authHeader: 'authorization', authScheme: 'Bearer',
          imageGeneration: { provider: 'openrouter', model: 'black-forest-labs/flux.2-klein-4b', configured: !!localStorage.getItem(S('kalamos_ai_image')) } })
        case 'http.request': { const id = 'ph' + (++seq); proxied(args, id, false); return JSON.stringify({ reqId: id }) }
        case 'http.stream': { const id = 'ps' + (++seq); proxied(args, id, true); return JSON.stringify({ reqId: id }) }
        case 'http.cancel': { const c = aborts[args.reqId]; if (c) c.abort(); return '{"ok":true}' }
        case 'hwr.status': return '{"state":"unavailable"}'
        default: return '{"err":"not-available-in-preview"}'
      }
    }
  }
})();

window.onAppEvent = function (payloadJson) {
  let events = []
  try { events = JSON.parse(payloadJson) } catch (e) { return }
  for (const ev of events) {
    const h = AB.handlers[ev.id]
    if (h) {
      try { h(ev) } catch (e) { console.error('onAppEvent handler', e) }
    }
    // terminal events release the handler
    if (ev.type === 'end' || ev.type === 'done' || ev.type === 'error' || ev.type === 'closed') {
      if (ev.type === 'error' && ev.kind === 'ws') continue   // ws error precedes closed
      delete AB.handlers[ev.id]
    }
  }
}

window.AB = AB
