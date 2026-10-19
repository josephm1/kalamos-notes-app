// Gateway adapter — talks to the kalamos-gateway desktop server over WebSocket. The gateway
// wraps CLI agent harnesses (Claude Code, Codex, OpenCode, …) and relays the SAME normalized
// AiEvent protocol, so this adapter is a thin socket shim. See kalamos-gateway/PROTOCOL.md.
(function () {
  let sock = null            // {sockId, ready, harnesses[]}
  let pending = {}           // reqId -> onEvent
  let seq = 0

  function ensureSocket(cfg, onReady, onFail) {
    if (sock && sock.ready) return onReady()
    const r = AB.call('ws.open', { url: cfg.url })
    if (r.err || !r.sockId) return onFail(r.err || 'ws unavailable')
    sock = { sockId: r.sockId, ready: false, harnesses: [] }
    AB.on(r.sockId, (ev) => {
      if (ev.type === 'open') {
        AB.call('ws.send', { sockId: sock.sockId, data: JSON.stringify({ type: 'hello', v: 1, token: '{{secret:' + (cfg.tokenRef || 'gw_token') + '}}' }) })
      } else if (ev.type === 'message') {
        let msg = null
        try { msg = JSON.parse(ev.data) } catch (e) { return }
        if (msg.type === 'ready') { sock.ready = true; sock.harnesses = msg.harnesses || []; onReady() }
        else if (msg.type === 'event' && pending[msg.reqId]) {
          pending[msg.reqId](msg.event)
          if (msg.event.type === 'done' || msg.event.type === 'error') delete pending[msg.reqId]
        }
      } else if (ev.type === 'closed' || ev.type === 'error') {
        for (const id in pending) pending[id]({ type: 'error', code: 'gw-closed', message: 'gateway disconnected', retryable: true })
        pending = {}; sock = null
        if (ev.type === 'error') onFail(ev.message || 'gateway error')
      }
    })
  }

  AiBus.register({
    kind: 'gateway',

    send(cfg, req) {
      const reqId = 'gw' + (++seq)
      pending[reqId] = req.onEvent
      ensureSocket(cfg,
        () => {
          AB.call('ws.send', {
            sockId: sock.sockId,
            data: JSON.stringify({
              type: 'send', reqId: reqId, harness: cfg.harness || 'claude-code',
              request: { system: req.system, messages: req.messages, model: req.model, maxTokens: req.maxTokens }
            })
          })
        },
        (err) => {
          if (pending[reqId]) {
            pending[reqId]({ type: 'error', code: 'gw-connect', message: 'Cannot reach desktop gateway: ' + err, retryable: true })
            delete pending[reqId]
          }
        })
      return reqId
    },

    cancel(reqId) {
      if (sock && sock.ready) AB.call('ws.send', { sockId: sock.sockId, data: JSON.stringify({ type: 'cancel', reqId: reqId }) })
      delete pending[reqId]
    }
  })
})();
