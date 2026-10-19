// AiBus — the provider-agnostic seam. Owns provider config (providers.json under _scribe),
// routes send/cancel to the active adapter by kind, and persists threads.
//
// Normalized AiEvent vocabulary every adapter emits (v1):
//   {type:'start', provider, model}
//   {type:'text', delta} | {type:'thinking', delta}
//   {type:'tool_use', toolId, name, phase:'start'|'delta'|'end', inputJson?}
//   {type:'tool_result', toolId, content, isError?}
//   {type:'file', path, mime, content?} | {type:'diff', path?, unified}
//   {type:'edits', ops:[...]}
//   {type:'usage', inputTokens, outputTokens}
//   {type:'session', responseId}   — server-side conversation marker (hermes)
//   {type:'done', stopReason} | {type:'error', code, message, retryable}
//
// Adapter interface (registered in AiBus.adapters by kind):
//   { kind, send(providerCfg, request) -> reqId, cancel(reqId), listModels?(cfg) }
//   request = { system, messages, model, maxTokens, session?, onEvent(ev) }
//   session = { conversation?, previousResponseId? } — for adapters whose backend keeps
//   conversation state server-side; stateless adapters ignore it.
const AiBus = {
  adapters: {},          // kind -> adapter
  _cfg: null,
  _live: {},             // reqId -> adapter (for cancel)

  register(adapter) { this.adapters[adapter.kind] = adapter },

  // ---- persistence seam ----
  // Default: localStorage (works in every app + preview). An app can install a richer
  // backing store BEFORE first use via window.AiBusStore = {loadGlobal, saveGlobal}
  // (Scribe points this at DocModel so its existing providers.json/threads carry over).
  _store() {
    if (window.AiBusStore) return window.AiBusStore
    return {
      loadGlobal(rel, fallback) {
        try {
          const v = localStorage.getItem('kalamos_ai_' + rel)
          return v ? JSON.parse(v) : fallback
        } catch (e) { return fallback }
      },
      saveGlobal(rel, obj) {
        try { localStorage.setItem('kalamos_ai_' + rel, JSON.stringify(obj)) } catch (e) {}
      }
    }
  },
  _uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  },

  // ---- provider config ----
  config() {
    if (!this._cfg) {
      this._cfg = this._store().loadGlobal('providers.json', null) || {
        v: 1, activeId: 'echo',
        providers: [{ id: 'echo', kind: 'echo', label: 'Offline demo' }],
        recognition: { lang: 'en-US', enabled: true }
      }
    }
    return this._cfg
  },
  saveConfig() { if (this._cfg) this._store().saveGlobal('providers.json', this._cfg) },
  provider(id) { return this.config().providers.find(p => p.id === id) || null },
  active() {
    const cfg = this.config()
    return this.provider(cfg.activeId) || cfg.providers[0] || null
  },
  setActive(id) { this.config().activeId = id; this.saveConfig() },

  // ---- send/cancel ----
  // Returns reqId or null. opts: {providerId?, system, messages, maxTokens, session?, onEvent}
  send(opts) {
    const prov = opts.providerId ? this.provider(opts.providerId) : this.active()
    const adapter = prov && this.adapters[prov.kind]
    if (!adapter) {
      opts.onEvent && opts.onEvent({ type: 'error', code: 'no-provider', message: 'No AI provider configured', retryable: false })
      return null
    }
    const req = {
      system: opts.system || '',
      messages: opts.messages || [],
      model: opts.model || prov.model,
      maxTokens: opts.maxTokens || prov.maxTokens || 4096,
      session: opts.session || null,
      onEvent: (ev) => {
        if (ev.type === 'done' || ev.type === 'error') delete this._live[reqId]
        opts.onEvent && opts.onEvent(ev)
      }
    }
    const reqId = adapter.send(prov, req)
    if (reqId) this._live[reqId] = adapter
    return reqId
  },

  cancel(reqId) {
    const a = this._live[reqId]
    if (a) { a.cancel(reqId); delete this._live[reqId] }
  },

  // ---- threads ----
  threadIndex() {
    return AiBus._store().loadGlobal('threads/index.json', { v: 1, threads: [] })
  },
  loadThread(id) {
    return AiBus._store().loadGlobal('threads/' + id + '.json', null)
  },
  saveThread(thread) {
    thread.updatedAt = Date.now()
    AiBus._store().saveGlobal('threads/' + thread.id + '.json', thread)
    const idx = this.threadIndex()
    const row = idx.threads.find(t => t.id === thread.id)
    const summary = {
      id: thread.id, title: thread.title || 'Untitled thread', docId: thread.docId || null,
      providerId: thread.providerId, model: thread.model || null,
      updatedAt: thread.updatedAt, msgCount: (thread.messages || []).length
    }
    if (row) Object.assign(row, summary)
    else idx.threads.unshift(summary)
    idx.threads.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    AiBus._store().saveGlobal('threads/index.json', idx)
  },
  newThread(docId) {
    const prov = this.active()
    return {
      v: 1, id: AiBus._uid('t'), docId: docId || null,
      providerId: prov ? prov.id : null, model: prov ? prov.model : null,
      createdAt: Date.now(), updatedAt: Date.now(), title: '', messages: []
    }
  },
  deleteThread(id) {
    const idx = this.threadIndex()
    idx.threads = idx.threads.filter(t => t.id !== id)
    AiBus._store().saveGlobal('threads/index.json', idx)
  }
}

window.AiBus = AiBus
