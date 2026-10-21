// Notes owns picker/dialog/activation; the shared workspace owns page objects and placement.
(function () {
  'use strict'
  const editor = () => window.KalamosWriteWorkspace
  const notify = message => Bridge.showToast(message)
  function call(method, args) {
    const result = AB.call(method, args)
    if (result.err) return Promise.reject(new Error(result.err))
    if (!result.reqId) return Promise.resolve(result)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { AB.off(result.reqId); reject(new Error('Attachment operation timed out. Your note is unchanged.')) }, 300000)
      AB.on(result.reqId, event => {
        if (!['result', 'error'].includes(event.type)) return
        clearTimeout(timer); AB.off(result.reqId)
        if (event.type === 'error') reject(new Error(event.message)); else resolve(event.value)
      })
    })
  }
  let opening = false, activeClose = null
  async function open(notebookId) {
    if (opening || document.getElementById('notes-attachments-dialog')) return
    const selected = editor().attachmentContext()
    if (!selected || selected.notebookId !== notebookId) throw new Error('Open a note before attaching content.')
    const context = {...selected}
    opening = true
    try { await editor().setDocumentDialog(true) } finally { opening = false }
    const current=editor().attachmentContext()
    if(!current || current.owner!==context.owner || current.notebookId!==context.notebookId || current.pageId!==context.pageId){await editor().setDocumentDialog(false);return}
    if (document.getElementById('notes-attachments-dialog')) return
    const overlay = document.createElement('div')
    overlay.dataset.writingDocumentDialog = 'true'
    overlay.id = 'notes-attachments-dialog'; overlay.className = 'notes-attachment-backdrop'
    const panel = document.createElement('section')
    panel.className = 'pen-settings-panel notes-attachment-menu'; panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Attach')
    const heading = document.createElement('h2'); heading.textContent = 'Attach'
    const header = document.createElement('header'); header.className = 'notes-attachment-heading'; header.append(heading)
    const body = document.createElement('div'); body.className = 'notes-attachment-options'
    const status = document.createElement('p'); status.className = 'notes-attachment-status'; status.setAttribute('role', 'status')
    const footer = document.createElement('footer'); footer.className = 'notes-attachment-footer'
    let waiting = false
    const previousFocus = document.activeElement
    function position() {
      const anchor=document.querySelector('.tool-pill [data-icon="attach"]')?.getBoundingClientRect()
      const bounds=panel.getBoundingClientRect()
      panel.style.left=Math.max(8,Math.min(anchor ? anchor.right+2 : 60,window.innerWidth-bounds.width-8))+'px'
      panel.style.top=Math.max(8,Math.min(anchor ? anchor.top : 80,window.innerHeight-bounds.height-8))+'px'
    }
    const changed=new MutationObserver(position)
    async function close(force=false) {
      if (waiting && !force) return
      changed.disconnect();window.removeEventListener('resize',position)
      activeClose = null; overlay.remove(); if(!force)await editor().setDocumentDialog(false)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
    function button(label, run, parent = body) {
      const item = document.createElement('button'); item.type = 'button'; item.textContent = label
      let pen = null, penActivated = false
      const activate = () => { if (!waiting) void Promise.resolve().then(run).catch(error => { status.textContent = error.message }) }
      item.addEventListener('pointerdown', event => {
        event.stopPropagation(); penActivated = false
        pen = event.pointerType === 'pen' && !item.disabled ? event.pointerId : null
      })
      item.addEventListener('pointercancel', () => { pen = null })
      item.addEventListener('pointerleave', () => { pen = null })
      item.addEventListener('pointerup', event => {
        if (pen !== event.pointerId || event.pointerType !== 'pen') return
        pen = null; penActivated = true; event.preventDefault(); event.stopPropagation(); activate()
      })
      item.addEventListener('keydown', () => { penActivated = false })
      item.addEventListener('click', () => { if (!penActivated) activate() })
      parent.append(item); return item
    }
    button('Cancel', () => close(), footer)
    function busy(active) {
      waiting = active
      panel.querySelectorAll('button,input').forEach(item => { item.disabled = active })
    }
    for (const [kind, label] of [['image', 'Image'], ['audio', 'Audio'], ['file', 'File']]) {
      button(label, async () => {
        busy(true); status.textContent = ''; panel.hidden = true
        try {
          const value = await call('notes.attachments.pick', {kind})
          if (!overlay.isConnected) return
          if (value.cancelled) { status.textContent = ''; return }
          status.textContent = 'Adding attachment…'
          await editor().addAttachment(context, value)
          busy(false); await close()
        } finally { panel.hidden = false; busy(false) }
      })
    }
    button('Link', () => {
      status.textContent = ''; heading.textContent = 'Add link'; panel.classList.add('link-editor'); panel.setAttribute('aria-label','Add link'); body.replaceChildren()
      const name = document.createElement('input'); name.type = 'text'; name.maxLength = 240; name.placeholder = 'Title (optional)'
      name.setAttribute('aria-label', 'Link title')
      const url = document.createElement('input'); url.type = 'url'; url.maxLength = 4096; url.placeholder = 'https://…'
      url.setAttribute('aria-label', 'Link URL')
      body.append(name, url)
      button('Add link', async () => {
        let parsed
        try { parsed = new URL(url.value.trim()) } catch { throw new Error('Enter an http or https link.') }
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Enter an http or https link.')
        busy(true)
        try {
          await editor().addAttachment(context, {kind:'link', link:{url:parsed.href, title:name.value.trim() || parsed.hostname}})
          busy(false); await close()
        } finally { busy(false) }
      }, footer)
      url.focus()
    })
    button('Arrange attachments', async () => { editor().arrangeAttachments(); await close() }).classList.add('attachment-arrange')
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); void close() }
      if (event.key === 'Tab') {
        const items = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
        if (!items.length) { event.preventDefault(); return }
        const index = items.indexOf(document.activeElement)
        if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus() }
        else if (!event.shiftKey && index === items.length-1) { event.preventDefault(); items[0].focus() }
      }
    })
    activeClose = close
    panel.append(header, status, body, footer); overlay.append(panel); document.body.append(overlay)
    position();changed.observe(panel,{childList:true,subtree:true});window.addEventListener('resize',position)
    body.querySelector('button')?.focus()
    overlay.addEventListener('pointerup',event=>{if(event.target===overlay){event.preventDefault();event.stopPropagation();void close()}})
  }
  AB.on('notes.attachments.audioStatus', event => {
    if (event.type === 'status') editor()?.updateAttachmentAudio?.(event.value)
    else if(event.type==='error')notify(event.message)
  })
  const host = window.KalamosWritingHost
  host.documentActions.push({label:'Attach', shortLabel:'Attach', icon:'attach', run:id => void open(id).catch(error => notify(error.message))})
  host.loadAttachmentImage = attachment => call('notes.attachments.image', {id:attachment.id}).then(value => value.source)
  host.attachmentError = notify
  host.activateAttachment = object => {
    const method = object.kind === 'link' ? 'link' : object.kind === 'audio' ? 'audio' : 'open'
    const args = object.kind === 'link' ? {url:object.link.url} : {id:object.attachment.id}
    void call('notes.attachments.' + method, args).then(value => {
      if (object.kind === 'audio') editor()?.updateAttachmentAudio?.(value)
    }).catch(error => notify(error.message))
  }
  const previousClose = host.onDocumentClosed
  host.onDocumentClosed = id => { if(activeClose)void activeClose(true); AB.call('notes.attachments.stop', {}); previousClose?.(id) }
  window.KalamosNotesAttachments = {open, close:() => { if (!activeClose) return false; void activeClose(); return true }}
})()
