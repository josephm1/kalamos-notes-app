// Notes-owned provider setup. Native storage keeps keys out of status responses and documents.
(function () {
  'use strict'
  let closeCurrent = null, opening = false
  async function openSettings() {
    if (opening || document.getElementById('notes-ai-settings')) return
    opening = true
    const editor = window.KalamosWriteWorkspace
    try { if (editor?.isOpen()) await editor.setDocumentDialog(true) }
    catch (error) { opening = false; Bridge.showToast(error.message || 'Could not open AI settings'); return }
    const overlay = document.createElement('div')
    overlay.id = 'notes-ai-settings'; overlay.className = 'notes-agora-overlay'
    const form = document.createElement('form'); form.className = 'notes-agora-panel notes-ai-settings-panel'
    form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true'); form.setAttribute('aria-label', 'AI settings')
    const title = document.createElement('h2'); title.textContent = 'AI settings'; form.append(title)
    const explanation = document.createElement('p')
    explanation.textContent = 'Format with AI sends this page to your chosen provider. Choose a model that accepts images.'
    form.append(explanation)
    const fields = {}
    function field(name, label, type) {
      const wrapper = document.createElement('label'); wrapper.textContent = label
      const input = document.createElement('input'); input.name = name; input.type = type || 'text'
      input.autocomplete = 'off'; input.autocapitalize = 'none'; input.spellcheck = false; wrapper.append(input); form.append(wrapper); fields[name] = input
      return input
    }
    field('baseUrl', 'API base URL (OpenAI-compatible)', 'url').required = true
    field('apiKey', 'API key', 'password')
    const modelLabel = document.createElement('label'); modelLabel.textContent = 'Model'
    const row = document.createElement('div'); row.className = 'notes-ai-model-row'
    const choice = document.createElement('select'); choice.name = 'modelChoice'; choice.setAttribute('aria-label', 'Model'); choice.required = true
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Load models'
    row.append(choice, refresh); modelLabel.append(row); form.append(modelLabel)
    field('model', 'Model ID')
    const thinkingLabel = document.createElement('label'); thinkingLabel.textContent = 'Thinking level'
    const thinking = document.createElement('select'); thinking.name = 'thinking'; thinking.setAttribute('aria-label', 'Thinking level')
    for (const [value, label] of [['none','Off'],['low','Low'],['high','High'],['max','Maximum'],['default','Provider default']]) {
      const item = document.createElement('option'); item.value = value; item.textContent = label; thinking.append(item)
    }
    thinkingLabel.append(thinking); form.append(thinkingLabel)
    const thinkingHelp = document.createElement('p'); thinkingHelp.textContent = 'Off or Low is recommended for transcription. Available levels depend on the provider and model.'; form.append(thinkingHelp)
    const manualLabel = fields.model.parentElement
    let catalogueVersion = 0, pending = null, models = []
    function option(label, value, id) {
      const item = document.createElement('option'); item.textContent = label; item.value = value
      if (id !== undefined) item.dataset.modelId = id
      choice.append(item); return item
    }
    function populate(selected, loaded) {
      choice.replaceChildren()
      option(loaded ? 'Choose a model' : 'Load models or enter an ID', '')
      const ids = new Set(models.map(model => model.id))
      if (selected && !ids.has(selected)) option(selected + ' (current)', 'id:' + selected, selected)
      for (const model of models) {
        const label = model.name === model.id ? model.id : model.name + ' · ' + model.id
        option((model.vision === true ? 'Images · ' : '') + label, 'id:' + model.id, model.id)
      }
      option('Enter model ID manually', 'manual')
      choice.value = selected ? 'id:' + selected : loaded ? '' : 'manual'
      syncModel()
    }
    function syncModel() {
      const manual = choice.value === 'manual'
      manualLabel.hidden = !manual; manualLabel.style.display = manual ? '' : 'none'; fields.model.required = manual
      if (!manual) fields.model.value = choice.selectedOptions[0]?.dataset.modelId || ''
    }
    choice.onchange = () => { syncModel(); if (choice.value === 'manual') fields.model.focus() }
    function stopWaiting() { if (pending) { pending(); pending = null } }
    function invalidate(clearModel) {
      catalogueVersion++; stopWaiting(); models = []; refresh.disabled = false; refresh.textContent = 'Load models'
      if (clearModel) fields.model.value = ''
      populate(fields.model.value, false); status.textContent = ''
    }
    fields.baseUrl.addEventListener('input', () => invalidate(true))
    fields.apiKey.addEventListener('input', () => invalidate(false))
    function nativeModels() {
      const result = AB.call('notes.ai.models', {baseUrl:fields.baseUrl.value, apiKey:fields.apiKey.value})
      if (result.err) return Promise.reject(new Error(result.err))
      if (!result.reqId) return Promise.resolve(result)
      return new Promise((resolve, reject) => {
        let finished = false
        const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); AB.off(result.reqId); pending = null; error ? reject(new Error(error)) : resolve(value) }
        const timer = setTimeout(() => finish('Model list timed out. Try again or enter a model ID manually.'), 40000)
        pending = () => finish('Model refresh cancelled')
        AB.on(result.reqId, event => {
          if (event.type === 'error') finish(event.message || 'Could not load models')
          else if (event.type === 'result') finish(null, event.value)
        })
      })
    }
    async function loadModels() {
      const version = ++catalogueVersion; stopWaiting(); refresh.disabled = true; refresh.textContent = 'Loading…'; status.textContent = 'Loading models…'
      try {
        const result = await nativeModels()
        if (version !== catalogueVersion || !overlay.isConnected) return
        models = Array.isArray(result.models) ? result.models : []
        if (!models.length) throw new Error('No models returned. Enter a model ID manually.')
        populate(fields.model.value, true)
        status.textContent = models.length + ' models loaded.' + (result.truncated ? ' Some models were omitted; you can enter an ID manually.' : '')
        refresh.textContent = 'Refresh models'
      } catch (error) {
        if (version !== catalogueVersion || !overlay.isConnected) return
        status.textContent = error.message || 'Could not load models. Enter a model ID manually.'
        refresh.textContent = 'Load models'
      } finally { if (version === catalogueVersion && overlay.isConnected) refresh.disabled = false }
    }
    refresh.onclick = () => void loadModels()
    const status = document.createElement('p'); status.setAttribute('role', 'status'); form.append(status)
    const actions = document.createElement('footer'); actions.className = 'notes-agora-actions'
    const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = 'Remove key'
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save'; save.className = 'notes-agora-primary'
    actions.append(clear, close, save); form.append(actions); overlay.append(form)
    const previous = document.activeElement
    function finish() {
      catalogueVersion++; stopWaiting(); closeCurrent = null; fields.apiKey.value = ''; overlay.remove()
      if (editor?.isOpen()) void editor.setDocumentDialog(false)
      if (previous?.isConnected) previous.focus()
    }
    closeCurrent = finish
    close.onclick = finish
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); finish() }
      if (event.key === 'Tab') {
        const items = [...form.querySelectorAll('input,button,select')].filter(item => !item.disabled && !item.closest('[hidden]')), at = items.indexOf(document.activeElement)
        if (event.shiftKey && at <= 0) { event.preventDefault(); items.at(-1).focus() }
        else if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); items[0].focus() }
      }
    })
    function persist(clearKey) {
      const result = AB.call('notes.ai.configure', {baseUrl:fields.baseUrl.value, model:fields.model.value, thinking:thinking.value, apiKey:clearKey?'':fields.apiKey.value, clearKey})
      fields.apiKey.value = ''
      if (result.err) { status.textContent = result.err; return }
      if (clearKey) { invalidate(false); status.textContent = 'API key removed.'; fields.apiKey.placeholder = 'Enter API key'; fields.apiKey.required = true }
      else finish()
    }
    form.onsubmit = event => { event.preventDefault(); persist(false) }
    clear.onclick = () => persist(true)
    const config = AB.call('notes.ai.settings', {})
    fields.baseUrl.value = config.baseUrl || 'https://openrouter.ai/api/v1'
    fields.model.value = config.model || ''
    thinking.value = config.thinking || 'none'
    fields.apiKey.required = !config.hasKey
    fields.apiKey.placeholder = config.hasKey ? 'Saved — leave blank to keep it' : 'Enter API key'
    if (config.err) status.textContent = config.err
    populate(fields.model.value, false)
    document.body.append(overlay); opening = false
    if (config.hasKey) void loadModels()
    else fields.baseUrl.focus()
  }
  window.KalamosNotesAI = {openSettings,closeSettings(){if(!closeCurrent)return false;closeCurrent();return true}}
})()
