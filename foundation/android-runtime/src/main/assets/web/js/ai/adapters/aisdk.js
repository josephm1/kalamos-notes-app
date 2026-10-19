// aisdk adapter — routes AiBus chat through the bundled Vercel AI SDK harness
// (ai/ai-kit.js → window.AiKit). Providers of kind 'aisdk' carry:
//   { backend:'openai'|'deepseek', baseUrl?, keyRef?, model }
// ChatGPT and DeepSeek presets use this kind; the plain 'openai' kind stays
// for LAN llama.cpp/ollama servers. Agent runs (tools) don't go through
// AiBus.send — surfaces call AiKit.run directly with their tool registry.
(function () {
  AiBus.register({
    kind: 'aisdk',

    send(cfg, req) {
      if (!window.AiKit) {
        req.onEvent({ type: 'error', code: 'no-aikit', message: 'ai-kit.js not loaded', retryable: false })
        return null
      }
      return window.AiKit.chat({
        cfg: {
          backend: cfg.backend || 'openai',
          baseUrl: cfg.baseUrl || undefined,
          keyRef: cfg.keyRef || undefined,
          model: req.model || cfg.model || ''
        },
        system: req.system || '',
        messages: req.messages || [],
        maxTokens: req.maxTokens,
        onEvent: req.onEvent
      })
    },

    cancel(reqId) { if (window.AiKit) window.AiKit.cancel(reqId) }
  })
})();
