// Echo adapter — offline/demo/preview provider. Streams a canned but context-aware reply on
// a timer so the entire chat pipeline (streaming render, fence parsing, edits review) works
// with no network, no keys, and no native code. Also the fallback when nothing is configured.
(function () {
  let seq = 0
  const live = {}   // reqId -> interval

  function replyFor(req) {
    const last = [...(req.messages || [])].reverse().find(m => m.role === 'user')
    const text = last ? (last.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ') : ''
    const asksEdit = /\b(tighten|rewrite|fix|edit|improve|shorten|change)\b/i.test(text)
    const ctx = (req.system || '').match(/\[\[(b_[a-z0-9]+)\]\](?: \(SELECTED\))?/g)
    const firstId = ctx && ctx.length > 1 ? ctx[1].replace(/[[\]]|\s.*/g, '') : null

    let out = 'This is the **offline demo provider** — no network or key needed. ' +
      'You said: “' + (text || 'nothing yet') + '”.\n\n' +
      'Connect a real provider in Settings (Claude, an OpenAI-compatible server such as ' +
      'llama.cpp, or a desktop agent) and this same conversation UI streams live responses.\n\n' +
      'A code fence renders like this:\n\n```js\nconst tokens = stream(prompt)\nfor await (const t of tokens) draw(t)\n```\n'
    if (asksEdit && firstId) {
      out += '\nHere is a demo edit proposal:\n\n```edits\n' +
        '[{"op":"replace","blockId":"' + firstId + '","md":"(Demo) This paragraph was rewritten by the offline echo provider to show the review-and-apply flow."}]\n' +
        '```\nTap it to review and apply.'
    }
    return out
  }

  AiBus.register({
    kind: 'echo',
    listModels() { return Promise.resolve([{ id: 'echo-1', label: 'Echo (offline)' }]) },

    send(cfg, req) {
      const reqId = 'echo' + (++seq)
      const words = replyFor(req).split(/(?<=\s)/)
      let i = 0
      req.onEvent({ type: 'start', provider: 'echo', model: 'echo-1' })
      live[reqId] = setInterval(() => {
        if (i >= words.length) {
          clearInterval(live[reqId]); delete live[reqId]
          req.onEvent({ type: 'usage', inputTokens: 42, outputTokens: words.length })
          req.onEvent({ type: 'done', stopReason: 'end_turn' })
          return
        }
        // a few words per tick ≈ token batches
        req.onEvent({ type: 'text', delta: words.slice(i, i + 3).join('') })
        i += 3
      }, 90)
      return reqId
    },

    cancel(reqId) {
      if (live[reqId]) { clearInterval(live[reqId]); delete live[reqId] }
    }
  })
})();
