(function (root) {
  'use strict'
  var SECRET = 'kalamos_ai_active'
  function bridge() { if (!root.AB || !root.AB.call) throw new Error('Native AI bridge unavailable'); return root.AB }
  function config() {
    var value = bridge().call('ai.config.get', {}) || {}
    value.label = value.label || value.activeProvider || 'AI provider'
    value.model = value.model || ''
    return value
  }
  function hasKey() { try { return !!config().configured } catch (_) { return false } }
  function headers(value) {
    value = value || config()
    var output = { 'content-type': 'application/json', 'accept-language': 'en-US,en' }
    Object.keys(value.extraHeaders || {}).forEach(function (key) { output[key] = String(value.extraHeaders[key]) })
    var credential = '{{secret:' + SECRET + '}}', scheme = String(value.authScheme || '')
    output[String(value.authHeader || 'authorization')] = scheme ? scheme + ' ' + credential : credential
    return output
  }
  function chat(body) {
    var value = config(), request = Object.assign({}, body || {}, { model: value.model || (body && body.model) })
    if (!value.configured) throw new Error('Configure an AI provider in Kalamos Agent')
    if (!request.model) throw new Error('Choose a model in Kalamos Agent')
    return { config: value, url: value.chatUrl, headers: headers(value), body: request }
  }
  root.KalamosAI = Object.freeze({ config: config, hasKey: hasKey, headers: headers, chat: chat, secretRef: SECRET })
})(window)
