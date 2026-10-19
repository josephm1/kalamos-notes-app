// App-owned handoff and automatic revision application. Saved content stays in the canonical writing feature.
(function () {
  'use strict'
  let session = null, pendingRequest = '', busy = false, activeSheet = null, pendingTimer = null, parkedNotebook = null, blockedNotebook = null, shelfPicker = null, showShelf = null
  let backgroundNotebook = null, backgroundTimer = null, backgroundPreparing = false, backgroundQueued = false, backgroundWorkingNotebook = null, backgroundStatusTimer = null
  const backgroundReplays = new Map()
  const editor = () => window.KalamosWriteWorkspace
  const notify = text => Bridge.showToast(text)
  function call(method, args) {
    const result = AB.call(method, args)
    if (result.err) return Promise.reject(new Error(result.err))
    if (!result.reqId) return Promise.resolve(result)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { AB.off(result.reqId); reject(new Error('Document operation did not finish. Your note remains saved.')) }, 120000)
      AB.on(result.reqId, event => {
        if (event.type !== 'result' && event.type !== 'error') return
        clearTimeout(timer); AB.off(result.reqId)
        if (event.type === 'error') reject(new Error(event.message)); else resolve(event.value)
      })
    })
  }
  async function sheet(title) {
    if(document.getElementById('notes-agora-sheet'))return null
    await editor().setDocumentDialog(true)
    const existing = document.getElementById('notes-agora-sheet'); if (existing) existing.remove()
    const overlay = document.createElement('div'); overlay.id = 'notes-agora-sheet'; overlay.className = 'notes-agora-overlay'
    const panel = document.createElement('section'); panel.className = 'notes-agora-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title)
    const header = document.createElement('header'); header.className = 'notes-agora-heading'
    const heading = document.createElement('h2'); heading.textContent = title
    header.append(heading)
    const body = document.createElement('div'); body.className = 'notes-agora-body'
    const footer = document.createElement('footer'); footer.className = 'notes-agora-actions'
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.className = 'notes-agora-status'
    panel.append(header, status, body, footer); overlay.append(panel); document.body.append(overlay)
    const removed = new MutationObserver(() => { if(!overlay.isConnected){removed.disconnect();if(activeSheet?.overlay===overlay)activeSheet=null;void editor().setDocumentDialog(false)} });removed.observe(document.body,{childList:true})
    const previousFocus = document.activeElement
    const close = () => { if (!busy) { overlay.remove(); if(previousFocus?.isConnected)previousFocus.focus(); queueMicrotask(()=>{void resumeParkedNote()}) } }
    activeSheet = { overlay, close }
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') { const items = [...panel.querySelectorAll('button:not(:disabled),input,textarea')]; if (!items.length) return; const at = items.indexOf(document.activeElement); if(event.shiftKey&&at<=0){event.preventDefault();items[items.length-1].focus()}else if(!event.shiftKey&&at===items.length-1){event.preventDefault();items[0].focus()} }
    })
    function action(label, run, primary = false) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; if(primary)button.className='notes-agora-primary'; button.onclick = run; footer.append(button); return button }
    action('Cancel', close)
    setTimeout(() => (footer.querySelector('.notes-agora-primary') || footer.querySelector('button'))?.focus(), 0)
    return { overlay, body, action, status }
  }
  function paragraph(parent, text) { const p = document.createElement('p'); p.textContent = text; parent.append(p); return p }
  async function processRevision(id, proposal, requestId) {
    if (busy) return
    busy = true
    AB.call('notes.agora.busy', {busy:true})
    let updateInPlace=false
    const stage = value => AB.call('notes.agora.processingDiagnostic',{notebookId:id,requestId,stage:value})
    try {
      stage('checkpoint')
      await editor().checkpointWorkspace()
      stage('inspect')
      const markdownResult = typeof proposal.markdown === 'string'
      let sourceLines = markdownResult
      let imageSheets = null
      if (markdownResult) {
        // Models supply Markdown only. Validate the captured revision before
        // placing it with trusted local page geometry.
        const inspected = await call('notes.agora.inspect', {notebookId:id,proposalId:proposal.proposalId})
        if (inspected.proposalApplied) {
          if(session)delete session.proposal
          stage('completed')
          return true
        }
        if(proposal.operation==='replace_page') {
          if(inspected.revisionId!==proposal.baseRevisionId)throw new Error('The page changed while AI was processing it. Your current note is retained.')
          const pageId=proposal.targetPageIds?.[0]
          const formatted=await editor().materializeNotebookImage(id,pageId,proposal.markdown,(inspected.inkRegions||[]).filter(region=>region.pageId===pageId),proposal.proposalId)
          imageSheets=formatted.sheets
          proposal={...proposal,blocks:formatted.blocks}
        } else {
          const trusted = new Map((inspected.inkRegions || []).map(region => [region.id, region]))
          const regions = (proposal.sourceInkRegions || []).map(region => {
            const current = trusted.get(region.id)
            if (!current || current.pageId !== region.pageId || current.runId !== region.runId ||
                JSON.stringify(current.strokeIds) !== JSON.stringify(region.strokeIds) ||
                ['x','y','width','height'].some(key => current.bounds[key] !== region.bounds[key]))
              throw new Error('Handwriting changed while AI was processing it. Your current note is retained.')
            return current
          })
          const bound = await editor().bindNotebookMarkdown(id, proposal.markdown, regions, proposal.proposalId)
          sourceLines = bound.sourceLines
          proposal = {...proposal, blocks:bound.blocks}
        }
      }
      const current = await call('notes.agora.prepare', {notebookId:id,proposal})
      if(current.proposalApplied) {
        await call('notes.agora.apply',{notebookId:id,proposal,sheets:[]})
        if(session)delete session.proposal
        stage('completed')
        return true
      }
      proposal = current.effectiveProposal || proposal
      stage('materialize')
      const sheets = imageSheets || (proposal.operation === 'replace_ink'
        ? await editor().materializeNotebookTranscription(id, proposal.blocks, current.inkRegions || [], sourceLines)
        : await editor().materializeNotebookSemantic(id, proposal.blocks, proposal.title, proposal.targetPageIds?.[0]))
      updateInPlace=!!requestId && proposal.operation==='replace_page'
      let saved
      if(updateInPlace) {
        saved=await editor().commitNotebookRevision(id,async()=>{
          stage('commit')
          return await call('notes.agora.apply',{notebookId:id,proposal,sheets})
        })
      } else {
        await editor().closeAndWait(true)
        stage('commit')
        saved=await call('notes.agora.apply',{notebookId:id,proposal,sheets})
        App.showEditor(saved.notebookId || id)
      }
      if(session){session.notebookId=saved.notebookId||id;delete session.proposal}
      stage('completed')
      if(requestId)backgroundStatus('AI formatting complete. Note saved.', 'success')
      else notify('Processed note saved. Continue writing or editing.')
      return true
    } catch (error) {
      AB.call('notes.agora.processingDiagnostic',{notebookId:id,requestId,stage:'error',message:error.message||'Unknown processing error'})
      if(!editor().isOpen() && !updateInPlace)App.showEditor(id)
      if(requestId)backgroundStatus(error.message || 'Processing failed. Your saved note is retained.', 'error')
      else notify(error.message || 'Processing failed. Your saved note is retained.')
      return false
    } finally {
      busy = false
      AB.call('notes.agora.busy', {busy:false})
    }
  }
  async function undoRevision(id, revisionId) {
    if (busy) return
    busy = true
    try {
      await editor().checkpointWorkspace()
      await editor().closeAndWait(true)
      const saved=await call('notes.agora.undo',{notebookId:id,expectedRevisionId:revisionId})
      activeSheet?.overlay.remove()
      App.showEditor(saved.notebookId || id)
      notify('Previous note restored.')
    } catch(error) { App.showEditor(id); notify(error.message) }
    finally { busy=false }
  }
  async function workWithAgora(target) {
    if (busy) return
    const id = target.notebookId
    try {
      await editor().checkpointWorkspace()
      window.KalamosNotesMigration.ensure(id)
      const doc = await call('notes.agora.inspect', { notebookId: id })
      const ui = await sheet(session ? 'Return to Agora' : 'Work with Agora'); if(!ui)return
      paragraph(ui.body, doc.title + ' · Choose the pages to attach. Nothing is sent until you press Send in Agora.')
      const choices = new Set()
      let active = 0
      try { active = JSON.parse(Bridge.getNotebookFile(id, 'planning.pages.json') || '{}').active || 0 } catch (_) {}
      doc.pages.forEach((page,i) => {
        const label = document.createElement('label'); label.className = 'notes-agora-page'
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = i === active; if (input.checked) choices.add(page.id)
        input.onchange = () => { if(input.checked)choices.add(page.id);else choices.delete(page.id) }
        label.append(input, document.createTextNode('Page ' + (i + 1))); ui.body.append(label)
      })
      const images = document.createElement('input'); images.type = 'checkbox'; images.checked = session ? session.includeImages !== false : localStorage.getItem('notes.agora.images') !== 'false'
      const imageLabel = document.createElement('label'); imageLabel.className='notes-agora-page';imageLabel.append(images,document.createTextNode('Include page images'));ui.body.append(imageLabel)
      const transcripts = new Map(); const transcriptionArea = document.createElement('div'); ui.body.append(transcriptionArea)
      const recognize = document.createElement('button'); recognize.textContent = 'Recognize handwriting'; recognize.className = 'notes-agora-recognize'; ui.body.append(recognize)
      recognize.onclick = async () => {
        if (busy) return; busy = true; ui.status.textContent = 'Recognizing selected pages…'
        try {
          if (!choices.size || choices.size > 32) throw new Error('Choose between 1 and 32 pages')
          transcriptionArea.replaceChildren()
          for (const pageId of choices) {
            const result = await editor().transcribeDocumentPage(id, pageId)
            const input = document.createElement('textarea'); input.setAttribute('aria-label','Review transcription for '+pageId); input.value=result.text
            paragraph(transcriptionArea, result.error || 'Review the reading. The original pen strokes remain editable.')
            transcriptionArea.append(input); transcripts.set(pageId,{input,inkIds:result.inkIds})
          }
          ui.status.textContent='Review transcription before attaching. Unread ink remains available in page images.'
        } catch(error) { ui.status.textContent=error.message } finally { busy=false }
      }
      ui.action(session ? 'Attach to chat' : 'Continue in Agora', async () => {
        if(busy)return;busy=true;ui.status.textContent='Preparing selected pages…'
        try {
          if(!choices.size||choices.size>32)throw new Error('Choose between 1 and 32 pages')
          await editor().checkpointWorkspace()
          const text=[]
          const {previews,displayPreview,previewFrames}=await prepareImages(id,doc,[...choices],images.checked)
          localStorage.setItem('notes.agora.images',String(images.checked))
          for(const pageId of choices) {
            const transcript=transcripts.get(pageId)
            if(transcript&&transcript.input.value.trim())text.push({id:'transcript-'+pageId,type:'paragraph',text:transcript.input.value,sourceRefs:transcript.inkIds,transcription:true})
          }
          const prepared = await call('notes.agora.export',{notebookId:id,pageIds:[...choices],previews,displayPreview,previewFrames,expectedRevisionId:doc.revisionId,transcripts:text,instruction:'',prepareOnly:!session})
          if (!session) {
            // Release the mutable editor before Agora can open a proposal for this same document.
            // Return reopens saved state, never an old in-memory model that could overwrite AI edits.
            parkedNotebook = editor().isOpen() ? id : null
            await editor().closeAndWait(false)
            await call('notes.agora.openPrepared', {token:prepared.token,resumeNotebook:parkedNotebook!==null})
          }
          ui.overlay.remove()
        } catch(error){ui.status.textContent=error.message}finally{busy=false}
      }, true)
      if(doc.undoAvailable)ui.action('Undo AI processing',()=>void undoRevision(id,doc.revisionId))
      if(doc.origin?.originalRevision){const original=document.createElement('button');original.textContent='Open original copy';original.className='notes-agora-original';ui.body.append(original);original.onclick=async()=>{if(busy)return;busy=true;try{const copy=await call('notes.agora.original',{notebookId:id});ui.overlay.remove();await editor().closeAndWait(true);App.showEditor(copy.notebookId)}catch(error){ui.status.textContent=error.message}finally{busy=false}}}
    } catch(error) { notify(error.message) }
  }
  let sharingNote=false
  async function shareNote(id) {
    if(sharingNote||busy)return
    sharingNote=true;let token=null
    try {
      notify('Preparing note images…')
      if(editor().isOpen())await editor().checkpointWorkspace()
      window.KalamosNotesMigration.ensure(id)
      const index=JSON.parse(Bridge.getNotebookFile(id,'planning.pages.json'))
      if(!index.pages?.length || index.pages.length>32)throw Error('Share supports up to 32 pages per notebook.')
      const signature=()=>JSON.stringify([JSON.parse(Bridge.getNotebookFile(id,'planning.pages.json')),...index.pages.flatMap(page=>[Bridge.getNotebookFile(id,page.sourceFile),JSON.parse(Bridge.getNotebookFile(id,page.sidecarFile)||'{}')])],(key,value)=>key==='updatedAt'||key==='createdAt'?undefined:value)
      const captured=signature()
      const title=libraryData.notebooks.find(note=>note.notebookId===id)?.title || 'Notebook'
      token=(await call('notes.share.begin',{title,count:index.pages.length})).token
      for(const [position,page] of index.pages.entries()) {
        const {image}=await raster(await editor().exportSavedDocumentPage(id,page.id))
        await call('notes.share.add',{token,index:position,image})
      }
      if(signature()!==captured)throw Error('The notebook changed while preparing images. Please share again.')
      await call('notes.share.open',{token});token=null
    } catch(error){notify(error.message || 'Could not share note images. Your note is saved.')}
    finally{if(token)await call('notes.share.cancel',{token}).catch(()=>{});sharingNote=false}
  }
  const previousContextActions=window.AppLibrary?.contextActions
  window.AppLibrary=window.AppLibrary||{}
  window.AppLibrary.contextActions=function(target){
    const rows=previousContextActions?previousContextActions(target):[]
    if(target.notebookId && !window.AppLibrary.readOnly)rows.push({label:'Share',run:()=>void shareNote(target.notebookId)})
    return rows
  }
  async function prepareImages(id, doc, pageIds, includeImages) {
    const started=performance.now(), signature=window.innerWidth+'x'+window.innerHeight+'x'+(window.devicePixelRatio||1)
    const renderIds=includeImages?pageIds:[pageIds[0]]
    const cached=await call('notes.agora.previewCache',{notebookId:id,revisionId:doc.revisionId,signature,pageIds:renderIds})
    const images=cached.previews||{},frames=cached.frames||{},fresh={},freshFrames={}
    let rendered=0
    for(const pageId of renderIds)if(!images[pageId]||!frames[pageId]){
      const renderedPage=await raster(await editor().exportDocumentPage(id,pageId));
      fresh[pageId]=images[pageId]=renderedPage.image;freshFrames[pageId]=frames[pageId]=renderedPage.frame;rendered++
    }
    if(rendered)await call('notes.agora.previewCache',{notebookId:id,revisionId:doc.revisionId,signature,pageIds:renderIds,previews:fresh,frames:freshFrames})
    console.info('[notes-prepare] images pages='+renderIds.length+' rendered='+rendered+' cached='+(renderIds.length-rendered)+' ms='+Math.round(performance.now()-started))
    return {previews:includeImages?images:{},displayPreview:images[renderIds[0]],previewFrames:includeImages?frames:{}}
  }
  async function raster(svg) {
    const node=new DOMParser().parseFromString(svg,'image/svg+xml').documentElement
    const view=(node.getAttribute('viewBox')||'0 0 572 772').split(/[ ,]+/).map(Number)
    const scale=Math.min(2,1200/view[2],2000/view[3]);if(!(scale>0))throw new Error('Invalid page geometry')
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(view[2]*scale);canvas.height=Math.ceil(view[3]*scale)
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}))
    try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url});const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return {image:canvas.toDataURL('image/jpeg',.9),frame:{x:view[0],y:view[1],width:view[2],height:view[3],pixelWidth:canvas.width,pixelHeight:canvas.height}}}finally{URL.revokeObjectURL(url)}
  }
  function check() {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
    const pending = AB.call('notes.agora.pending', {})
    if (pending.loading) { pendingTimer = setTimeout(check, 250); return }
    if (!pending.requestId) { session = null; pendingRequest = ''; if(pending.returnNotebook)parkedNotebook=pending.returnNotebook; return }
    if (pending.requestId === pendingRequest) return
    session = pending; pendingRequest = pending.requestId
    if (!pending.notebookId) { void choose().catch(error => notify(error.message)); return }
    App.showEditor(pending.notebookId)
    if (blockedNotebook === pending.notebookId) { AB.call('notes.agora.busy', {busy:true}); void showBlockedNote(pending.notebookId); return }
    if (pending.proposal) void processRevision(pending.notebookId, pending.proposal)
  }
  // The chrome-ready hook runs inside App.start BEFORE its final route publication. Opening a
  // document there is overwritten by library startup. Use the completed shell boundary instead.
  const hooks = window.KalamosAppHooks, ready = hooks.onAppReady
  hooks.onAppReady = function () { if (ready) ready(); installNavigation(); check(); void resumeParkedNote() }
  const appResume = hooks.onAppResume
  hooks.onAppResume = function () { if(appResume)appResume(); check(); void resumeParkedNote() }
  async function resumeParkedNote() {
    if (session || busy || !parkedNotebook) return
    const id = parkedNotebook; parkedNotebook = null
    AB.call('notes.agora.consumeReturn', {notebookId:id})
    if (!AB.call('notes.agora.resumeEditor', {notebookId:id}).resumed) App.showEditor(id)
  }
  const resume = window.AppMode.onResumeApp
  window.AppMode.onResumeApp = function () { if (resume) resume(); check() }
  const previousNewIntent=window.AppMode.onNewIntent
  window.AppMode.onNewIntent = function(){if(previousNewIntent)previousNewIntent();check()}
  const ordinaryOpen = window.AppMode.openNotebook
  window.AppMode.openNotebook = function(id) {
    const claim = location.protocol === 'file:' ? AB.call('notes.agora.acquireEditor', {notebookId:id}) : {acquired:true}
    if (claim.err || claim.acquired === false) {
      blockedNotebook = id
      notify('This note is already open in another Notes window. Finish that session before opening it here.')
      return true
    }
    blockedNotebook = null
    return ordinaryOpen(id)
  }
  const ordinaryBack = window.AppMode.onBack
  window.AppMode.onBack = function () { if (session) { void back(); return true } return ordinaryBack ? ordinaryBack() : false }
  let navigationInstalled = false
  function installNavigation() {
    if (navigationInstalled) return
    navigationInstalled = true
    const showLibrary = App.showLibrary
    showShelf = () => showLibrary.call(App)
    App.showLibrary = function () {
    // The canonical Done button has already saved and closed its surface. External navigation
    // returns to the caller instead of exposing the unrelated Notes shelf.
    if (session) { void cancelSession(); return }
    return showLibrary.apply(this, arguments)
  }
  }
  async function cancelSession() {
    if (!session || busy) return
    busy = true
    try { await editor().closeAndWait(true); AB.call('notes.agora.cancel', {}) }
    catch (error) { notify(error.message) }
    finally { busy = false }
  }
  async function back() {
    if (busy) { notify('Please wait while your note is saved.'); return }
    if (shelfPicker) { shelfPicker.back(); return }
    if (activeSheet?.overlay.isConnected) {
      activeSheet.close()
      return
    }
    if (session?.operation === 'pick') {
      busy = true
      try { await editor().closeAndWait(true); delete session.notebookId }
      catch (error) { notify(error.message); return }
      finally { busy = false }
      await choose(); return
    }
    await cancelSession()
  }
  async function attachToChat() {
    if (!session?.notebookId || busy) return
    if (blockedNotebook === session.notebookId) { notify('Finish the other Notes window before attaching this note.'); return }
    if (activeSheet?.overlay.isConnected) { notify('Close this screen before attaching.'); return }
    busy = true; AB.call('notes.agora.busy', { busy: true })
    try {
      await editor().setDocumentDialog(true)
      await editor().checkpointWorkspace()
      const doc = await call('notes.agora.inspect', { notebookId: session.notebookId })
      if (!doc.pages.length || doc.pages.length > 32) throw new Error('This note has more than 32 pages. Use page selection to attach part of it.')
      const {previews,displayPreview,previewFrames}=await prepareImages(session.notebookId,doc,doc.pages.map(p=>p.id),session.includeImages!==false)
      await call('notes.agora.export', { notebookId: session.notebookId, pageIds: doc.pages.map(page => page.id), previews, displayPreview,previewFrames, expectedRevisionId:doc.revisionId, transcripts: [], instruction: '' })
    } catch (error) { notify('Could not attach: ' + error.message) }
    finally { busy = false; AB.call('notes.agora.busy', { busy: false }); await editor().setDocumentDialog(false) }
  }
  async function showBlockedNote(id) {
    const ui = await sheet('Note already open'); if (!ui) return
    paragraph(ui.body, 'This note is open in another Notes window. Open that window to view it, or close the note there before attaching it here.')
    ui.action('Open existing Notes window', () => {
      const result = AB.call('notes.agora.focusEditor', {notebookId:id})
      if (!result.focused) ui.status.textContent = 'That window has closed. Return to the picker and try again.'
    }, true)
    ui.action('Choose another note', async () => { ui.overlay.remove(); await choose() })
  }
  async function attachSelectedNotes(ids, ui) {
    if(busy || !session || session.operation!=='pick')return
    if(!ids.length || ids.length>32){ui.status.textContent='Choose between 1 and 32 notes.';return}
    busy=true; const claimed=[]
    try {
      await editor().checkpointWorkspace()
      const tokens=[]
      for(const id of ids){
        const claim=AB.call('notes.agora.acquireEditor',{notebookId:id})
        if(claim.err || claim.acquired===false)throw new Error('A selected note is open in another Notes window. Close it there before attaching the group.')
        claimed.push(id)
        const doc=await call('notes.agora.inspect',{notebookId:id})
        if(!doc.pages.length || doc.pages.length>32)throw new Error('A selected note has more than 32 pages. Attach it separately using page selection.')
        ui.status.textContent='Preparing '+(tokens.length+1)+' of '+ids.length+' notes…'
        const {previews,displayPreview,previewFrames}=await prepareImages(id,doc,doc.pages.map(p=>p.id),session.includeImages!==false)
        const result=await call('notes.agora.export',{notebookId:id,pageIds:doc.pages.map(p=>p.id),previews,displayPreview,previewFrames,expectedRevisionId:doc.revisionId,transcripts:[],instruction:'',prepareOnly:true})
        tokens.push(result.token)
      }
      await call('notes.agora.returnPreparedMany',{tokens})
    }catch(error){ui.status.textContent=error.message}
    finally {claimed.forEach(id=>AB.call('notes.agora.releaseEditor',{notebookId:id}));busy=false}
  }
  async function choose() {
    if(shelfPicker)return
    showShelf?.()
    const ui=window.KalamosNotesShelfUI.enterPicker({
      exitLabel:session?'Back to Agora':'Back to Notes',
      open:async function(noteId){
        if(busy)return
        if(!session){finishPicker();await workWithAgora({notebookId:noteId});return}
        busy=true
        try {
          const claim=location.protocol==='file:'?AB.call('notes.agora.acquireEditor',{notebookId:noteId}):{acquired:true}
          if(claim.err || claim.acquired===false){
            ui.status.textContent='This note is already open in another Notes window. Close it there or choose another note.'
            let existing=ui.body.querySelector('[data-existing-note]')
            if(!existing){existing=document.createElement('button');existing.dataset.existingNote='true';existing.textContent='Open existing Notes window';ui.status.after(existing)}
            existing.onclick=()=>AB.call('notes.agora.focusEditor',{notebookId:noteId});return
          }
          await editor().closeAndWait(true)
          const selected=AB.call('notes.agora.select',{notebookId:noteId})
          if(selected.err)throw new Error(selected.err)
          session.notebookId=noteId;finishPicker();App.showEditor(noteId)
        }catch(error){ui.status.textContent=error.message}
        finally{busy=false}
      },
      attach:session?.operation==='pick'?ids=>void attachSelectedNotes(ids,ui):null,
      cancel:async function(){if(busy)return;finishPicker();if(session)await cancelSession()}
    })
    shelfPicker=ui
    if(session)AB.call('notes.agora.picker',{})
  }
  function finishPicker(){const ui=shelfPicker;shelfPicker=null;ui?.body.querySelector('[data-existing-note]')?.remove();ui?.finish()}

  // Android's toast window stays above the native ink surface. Keep a durable
  // summary in the existing paper gutter; only that small strip is captured.
  // Browser previews use a larger WebView toast, where there is no native surface.
  function backgroundStatus(text, kind = 'progress') {
    let status=document.getElementById('notes-ai-progress')
    if(text && status?.dataset.message===text && status.dataset.kind===kind)return
    if(backgroundStatusTimer){clearTimeout(backgroundStatusTimer);backgroundStatusTimer=null}
    const nativeToast=location.protocol==='file:'
    const refreshGutter=()=>{
      if(!nativeToast || typeof Bridge.snapshotToolbarRegion!=='function')return
      requestAnimationFrameSafe(()=>{
        const dpr=window.devicePixelRatio||1
        Bridge.snapshotToolbarRegion(0,Math.floor((window.innerHeight-20)*dpr),Math.ceil(window.innerWidth*dpr),Math.ceil(window.innerHeight*dpr))
      })
    }
    if(!text){status?.remove();refreshGutter();return}
    if(!status){status=document.createElement('div');status.id='notes-ai-progress';document.body.append(status)}
    status.dataset.message=text;status.dataset.kind=kind
    status.classList.toggle('notes-ai-native-summary',nativeToast)
    status.setAttribute('role',kind==='error'?'alert':'status')
    status.setAttribute('aria-live',kind==='error'?'assertive':'polite')
    const label=document.createElement('span');label.textContent=(kind==='error'?'AI formatting failed: ':'')+text
    status.replaceChildren(label)
    if(kind!=='progress' && !nativeToast){
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Dismiss'
      dismiss.onclick=()=>backgroundStatus(null);status.append(dismiss)
    }
    if(nativeToast)notify(label.textContent)
    refreshGutter()
    if(kind==='success')backgroundStatusTimer=setTimeout(()=>backgroundStatus(null),8000)
  }

  const requestAnimationFrameSafe=callback=>window.requestAnimationFrame?window.requestAnimationFrame(()=>setTimeout(callback,0)):setTimeout(callback,0)
  function beginBackgroundPreparation(id) {
    if(AB.call('notes.ai.settings',{}).configured===false){void window.KalamosNotesAI.openSettings();return false}
    if(busy || backgroundPreparing || backgroundQueued || backgroundWorkingNotebook===id)return false
    backgroundQueued=true
    backgroundStatus('Preparing page for AI…')
    return true
  }
  async function formatWithAI(id) {
    if(busy || backgroundPreparing)return
    if(!backgroundQueued && !beginBackgroundPreparation(id))return
    backgroundQueued=false
    backgroundPreparing=true
    try {
      // Give the immediate status a paint before checkpointing/rendering the image.
      await new Promise(resolve=>requestAnimationFrameSafe(resolve))
      await editor().checkpointWorkspace()
      const doc=await call('notes.agora.revisionSnapshot',{notebookId:id})
      const index=JSON.parse(Bridge.getNotebookFile(id,'planning.pages.json'))
      const pageId=index.pages[index.active].id
      const {image}=await raster(await editor().exportSavedDocumentPage(id,pageId))
      const queued=await call('notes.ai.processImage',{notebookId:id,pageId,image,expectedRevisionId:doc.revisionId})
      if(queued.error){
        if(queued.requestId)await call('notes.ai.backgroundConsumed',{requestId:queued.requestId})
        throw new Error(queued.error)
      }
      backgroundWorkingNotebook=id
      if(backgroundNotebook===id){backgroundStatus('Formatting with AI…');void checkBackgroundResult(id)}
    } catch(error) { backgroundWorkingNotebook=null;backgroundStatus(error.message || 'Could not start AI formatting. Your note is saved.', 'error') }
    finally {backgroundPreparing=false}
  }
  async function checkBackgroundResult(id) {
    if(backgroundTimer){clearTimeout(backgroundTimer);backgroundTimer=null}
    if(backgroundNotebook!==id||!editor().isOpen())return
    // Page management owns the manifest while its dialog is open. Keep a completed
    // AI result pending until it closes instead of replacing files under selection.
    const deferForDialog=()=>{if(!editor().hasOpenDialog?.())return false;backgroundTimer=setTimeout(()=>void checkBackgroundResult(id),1500);return true}
    if(deferForDialog())return
    try {
      const result=await call('notes.ai.backgroundResult',{notebookId:id})
      if(backgroundNotebook!==id||!editor().isOpen())return
      if(deferForDialog())return
      if(result.proposal && !busy){
        backgroundStatus('Saving formatted note…')
        await processRevision(id,result.proposal,result.requestId)
        await call('notes.ai.backgroundConsumed',{requestId:result.requestId})
        backgroundWorkingNotebook=null
      } else if(result.error){
        backgroundWorkingNotebook=null
        backgroundStatus(result.error, 'error')
        await call('notes.ai.backgroundConsumed',{requestId:result.requestId})
      } else if(result.pending || result.proposal){
        backgroundWorkingNotebook=id
        if(!busy)backgroundStatus('Formatting with AI…')
        // Reattach durable queued work; this never creates a second model request.
        const now=Date.now(),last=backgroundReplays.get(result.requestId)
        if(result.pending&&result.requestId&&(last===undefined||now-last>=10000)){
          backgroundReplays.set(result.requestId,now)
          await call('notes.ai.backgroundReplay',{notebookId:id})
        }
        if(backgroundNotebook!==id||!editor().isOpen())return
        backgroundTimer=setTimeout(()=>void checkBackgroundResult(id),1500)
      } else if(!backgroundPreparing && !backgroundQueued){backgroundWorkingNotebook=null;if(document.getElementById('notes-ai-progress')?.dataset.kind==='progress')backgroundStatus(null)}
    } catch(error) {backgroundWorkingNotebook=null;backgroundStatus(error.message || 'Could not read the AI result.', 'error')}
  }
  window.KalamosNotesAgora={shareNote,workWithAgora,attachToChat,back,options:function(){if(session?.notebookId)void workWithAgora({notebookId:session.notebookId})},choose:function(){void choose().catch(error=>notify(error.message))}}
  window.KalamosWritingHost={notebookToolbar:true,onDocumentOpened:function(id){backgroundNotebook=id;backgroundReplays.clear();void checkBackgroundResult(id)},onDocumentClosed:function(id){if(backgroundNotebook===id){backgroundNotebook=null;if(!busy)backgroundStatus(null);if(backgroundTimer)clearTimeout(backgroundTimer);backgroundTimer=null}AB.call('notes.agora.releaseEditor',{notebookId:id})},documentActions:[{shortLabel:'Format with AI',label:'Format with AI',onPress:beginBackgroundPreparation,run:id=>void formatWithAI(id)},{shortLabel:'Share',label:'Share',icon:'share',run:id=>void shareNote(id)}]}

})()
