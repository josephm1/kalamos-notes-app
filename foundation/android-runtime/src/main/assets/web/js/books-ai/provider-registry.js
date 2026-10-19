// Books AI provider profiles. Non-secret preferences may live in localStorage; every credential is
// referenced by a native protected-secret name and never returned to JavaScript after it is saved.
(function(root, factory) {
  var api = factory(root)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.QuizProviderSettings = api
})(typeof window !== 'undefined' ? window : globalThis, function(root) {
  'use strict'

  var STORE = 'kal.books.ai.provider.v1'
  var DEEPSEEK = {
    id: 'deepseek',
    label: 'DeepSeek V4 Flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-v4-flash',
    keyRef: 'books_ai_key_deepseek',
    configurable: false,
    disablesThinking: true
  }
  var COMPATIBLE = {
    id: 'openai-compatible',
    label: 'OpenAI-compatible service',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: '',
    keyRef: 'books_ai_key_openai_compatible',
    configurable: true,
    disablesThinking: false
  }
  var ZAI = {
    id: 'zai-glm',
    label: 'Z.AI · GLM-5.3-Flash',
    endpoint: 'https://api.z.ai/api/paas/v4/chat/completions',
    model: 'glm-5.3-flash',
    keyRef: 'books_ai_key_zai',
    configurable: false,
    disablesThinking: false,
    supportsWebSearch: true
  }

  function catalogue() {
    return [Object.assign({}, DEEPSEEK), Object.assign({}, ZAI), Object.assign({}, COMPATIBLE)]
  }

  function saved() {
    try {
      var value = JSON.parse(root.localStorage.getItem(STORE) || 'null')
      return value && typeof value === 'object' ? value : {}
    } catch (e) { return {} }
  }

  function cleanEndpoint(value) {
    value = String(value || '').trim()
    var parsed
    try { parsed = new URL(value) } catch (e) { throw new Error('Enter a valid HTTPS chat-completions endpoint') }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash)
      throw new Error('The provider endpoint must be a plain HTTPS URL')
    return parsed.toString()
  }

  function cleanModel(value) {
    value = String(value || '').trim()
    if (!value || value.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(value))
      throw new Error('Enter a valid provider model name')
    return value
  }

  function current() {
    var value = saved()
    if (value.providerId === COMPATIBLE.id) {
      var out = Object.assign({}, COMPATIBLE)
      try { out.endpoint = cleanEndpoint(value.endpoint) } catch (e) {}
      try { out.model = cleanModel(value.model) } catch (e) {}
      return out
    }
    if (value.providerId === ZAI.id) return Object.assign({}, ZAI)
    if (value.providerId === DEEPSEEK.id) return Object.assign({}, DEEPSEEK)
    // Personal-device builds bundle GLM into the native protected-secret store. Use it for a new
    // Books install while preserving any provider the user explicitly saved.
    return Object.assign({}, ZAI)
  }

  function save(value) {
    value = value || {}
    var providerId = value.providerId === COMPATIBLE.id ? COMPATIBLE.id :
      (value.providerId === ZAI.id ? ZAI.id : DEEPSEEK.id)
    var next = { version: 1, providerId: providerId }
    if (providerId === COMPATIBLE.id) {
      next.endpoint = cleanEndpoint(value.endpoint)
      next.model = cleanModel(value.model)
    }
    root.localStorage.setItem(STORE, JSON.stringify(next))
    return current()
  }

  function bridge() {
    if (!root.AB || typeof root.AB.call !== 'function') throw new Error('The native secret store is unavailable')
    return root.AB
  }

  function profile(providerId) {
    return catalogue().find(function(p) { return p.id === providerId }) || current()
  }

  function hasKey(providerId) {
    try { return !!bridge().call('secret.has', { key: profile(providerId).keyRef }).has } catch (e) { return false }
  }

  function setKey(providerId, value) {
    value = String(value || '').trim()
    if (!value) throw new Error('Paste an API key')
    var out = bridge().call('secret.set', { key: profile(providerId).keyRef, value: value })
    if (out.err) throw new Error('The API key could not be saved')
    return true
  }

  function clearKey(providerId) {
    return bridge().call('secret.clear', { key: profile(providerId).keyRef })
  }

  return {
    catalogue: catalogue,
    current: current,
    save: save,
    hasKey: hasKey,
    setKey: setKey,
    clearKey: clearKey,
    constants: { store: STORE, deepseek: DEEPSEEK, zai: ZAI, compatible: COMPATIBLE },
    _cleanEndpoint: cleanEndpoint,
    _cleanModel: cleanModel
  }
})
