import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const {JSDOM}=createRequire(new URL('../../../features/writing/workspace/package.json',import.meta.url))('jsdom')
const source=readFileSync(new URL('../app/src/main/assets/web/js/agora-documents.js',import.meta.url),'utf8')
const settle=()=>new Promise(resolve=>setTimeout(resolve,20))
function harness({returned=false,stale=false,transcription=false,nativeMode=false}={}){
 const dom=new JSDOM('<body><div id="library-view"><div id="header"><button id="btn-folder-back"></button><h1 id="header-title"></h1></div><div id="grid"></div><div id="empty-state"></div><footer id="notes-library-footer"><button class="notes-menu-btn"></button><div class="notes-footer-pager"><div id="pagination"><span id="page-totals" class="totals"></span><div id="pager-controls" class="pager-controls"></div></div></div><div class="notes-footer-create"></div></footer></div></body>',{url:nativeMode?'file:///android_asset/web/app.html':'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,calls=[],dialogs=[]
 const proposal={operation:transcription?'replace_ink':'organize',schema:'kalamos.notes-proposal/v1',proposalId:'proposal',documentId:'doc',baseRevisionId:'base',title:'Tasks',blocks:[{id:'task',type:'task',text:'Milk',checked:false,...(transcription?{sourceInkRegionIds:['region-1']}:{})}]}
 const pending=returned?{requestId:'request',notebookId:'note',proposal}:{}
 const doc={inkRegions:[{id:'region-1',pageId:'first',runId:'run-1',strokeIds:['stroke-1'],bounds:{x:24,y:44,width:60,height:30}}],documentId:'doc',revisionId:stale?'newer':'base',title:'Tasks',pages:[{id:'first',source:'',sidecar:{}}],blocks:[{id:'task',type:'task',text:'Old milk',checked:false}]}
 let seq=0
 w.AB={handlers:{},call(method,args){calls.push({method,args});if(method.endsWith('pending'))return pending;if(method.endsWith('prepare')&&stale)return{err:'The note changed while Agora was processing it'};const reqId='r'+(++seq);setTimeout(()=>this.handlers[reqId]?.({type:'result',value:method.endsWith('inspect')||method.endsWith('revisionSnapshot')||method.endsWith('prepare')?doc:method.endsWith('export')&&args.prepareOnly?{token:'prepared'}:{notebookId:'note'}}),0);return{reqId}},on(id,fn){this.handlers[id]=fn},off(id){delete this.handlers[id]}}
 w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{}
 w.Image=class{set src(value){queueMicrotask(()=>this.onload())}}
 w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,cHJldmlldw=='
 w.Bridge={showToast(){},getNotebookFile(){return '{"active":0,"pages":[{"id":"first"}]}'}}
 w.AppLibrary={};w.KalamosAppHooks={onLibraryReady(){}};w.AppMode={onResumeApp(){},openNotebook(){return true}}
 w.App={showLibrary(){},showEditor(){}};w.libraryData={notebooks:[{notebookId:'note',title:'Tasks'}],folders:[]}
 w.KalamosNotesMigration={ensure(){}}
 w.KalamosWriteWorkspace={async exportSavedDocumentPage(){return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 480"></svg>'},async exportDocumentPage(){return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 480"></svg>'},isOpen(){return false},async checkpointWorkspace(){},async setDocumentDialog(active){dialogs.push(active)},close(){},async closeAndWait(){},async commitNotebookRevision(id,commit){return await commit()},async materializeNotebookSemantic(id,blocks){return[{source:'',sidecar:{textBoxes:blocks}}]}}
 const shelf=readFileSync(new URL('../../../foundation/android-runtime/src/main/assets/web/js/library-controller.js',import.meta.url),'utf8')
 w.renderNoteThumb=(element,id)=>{element.dataset.previewId=id};w.timeAgo=()=> 'Recently';w.libraryCardTimestamp=()=>'';w.libraryItemsPerPage=()=>9
 for(const name of ['nestedFoldersEnabled','folderParentId','childFolders','findFolder','descendantFolderIds','folderPath','folderDisplayPath','computeLibraryCells','buildFolderCard','renderPagination','creationCardsInGrid','renderHeader','renderGrid','renderLibrary','renderEmptyState','libraryNavigateUp','buildNotebookCard','showContextMenu','removeContextMenu']) {
  w.eval(shelf.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))[0])
 }
 w.activeFolderId='';w.libraryPage=0;w.libraryAppTitle='All my notebooks';w.importBtnEl=null;w.visibleFolderThumbs={};w.visibleThumbs={};w.contextMenuEl=null
 w.KalamosConfig={nestedFolders:true,libraryCreationInChrome:true};w.AppLibrary.folderDragEnabled=true
 w.primeCardMetaCache=()=>{};w.peekCardMeta=()=>null;w.bookFormat=()=>null;w.renderFolderBar=()=>{};w.importButtonVisible=()=>false;w.Storage={preloadMeta(){}}
 w.Element.prototype.setPointerCapture=()=>{}
 w.eval(shelf.slice(shelf.indexOf('let shelfSuppressClickUntil'),shelf.indexOf('function buildNoteCard(')) + '\n' + ['showContextMenu','removeContextMenu'].map(name => shelf.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))[0]).join('\n'))
 w.eval(shelf.slice(shelf.indexOf('function buildNoteCard('),shelf.indexOf('// Bigme-style book card')))
 const selectionUI=readFileSync(new URL('../app/src/main/assets/web/js/notes-selection.js',import.meta.url),'utf8')
 w.eval(readFileSync(new URL('../../../foundation/android-runtime/src/main/assets/web/js/toolbar-icons.js',import.meta.url),'utf8'))
 w.eval(readFileSync(new URL('../app/src/main/assets/web/js/notes-selection-model.js',import.meta.url),'utf8'))
 w.eval(selectionUI)
 const overlay=readFileSync(new URL('../app/src/main/assets/web/js/app-overlay.js',import.meta.url),'utf8')
 const fn=(name,spaces)=>overlay.match(new RegExp(' '.repeat(spaces)+'function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n'+' '.repeat(spaces)+'\\}'))[0]
 w.eval('const svg=KalamosToolbarIcons.svg;'+['footerButton','shelfPager','syncPagination'].map(name=>fn(name,4)).join('\n')+['enterShelfPicker','searchBar','openSearch'].map(name=>fn(name,2)).join('\n')+';window.KalamosNotesShelfUI={enterPicker:enterShelfPicker,footerButton};')
 const navigation=w.shelfPager(w.document.querySelector('#pagination'),()=>{w.libraryPage=0;w.renderGrid()},()=>{w.libraryPage=Math.ceil(w.computeLibraryCells().cells.length/w.libraryItemsPerPage())-1;w.renderGrid()})
 w.document.querySelector('.notes-footer-pager').replaceWith(navigation.pager)
 w.fixtureShelfNavigation=navigation
 w.eval('const sharedRenderPagination=renderPagination;function syncFooter(){window.fixtureShelfNavigation.sync()};'+overlay.match(/window\.renderPagination = function \([^)]*\) \{[\s\S]*?\n          \}/)[0])
 w.document.querySelector('#btn-folder-back').addEventListener('click',w.libraryNavigateUp)
 w.KalamosAppHooks.onLibraryReady()
 w.eval(source.replace('window.KalamosNotesAgora=','window.fixturePrepareImages=prepareImages;window.KalamosNotesAgora='));return{dom,w,calls,dialogs}
}
test('AI result applies automatically as editable blocks without review and releases old model before commit',async()=>{
 const h=harness({returned:true});try{
  const order=[]
  h.w.KalamosWriteWorkspace.materializeNotebookSemantic=async(id,blocks,title,page)=>{order.push('layout');assert.equal(id,'note');assert.equal(blocks[0].type,'task');return [{source:'',sidecar:{textBoxes:blocks}}]}
  h.w.KalamosWriteWorkspace.closeAndWait=async()=>{order.push('closed')}
  const call=h.w.AB.call.bind(h.w.AB);h.w.AB.call=(method,args)=>{if(method==='notes.agora.apply')order.push('commit');return call(method,args)}
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  assert.deepEqual(order,['layout','closed','commit'])
  const applied=h.calls.find(c=>c.method==='notes.agora.apply');assert.equal(applied.args.proposal.blocks[0].text,'Milk');assert.equal(applied.args.proposal.blocks[0].checked,false)
  assert.equal(h.w.document.querySelector('#notes-agora-sheet'),null)
  h.w.KalamosAppHooks.onAppReady();await settle();assert.equal(h.calls.filter(c=>c.method==='notes.agora.apply').length,1)
 }finally{h.dom.window.close()}
})
test('stale result leaves the current note editable without any review dialog or copy action',async()=>{
 const h=harness({returned:true,stale:true});try{
  let opened=0;const messages=[];h.w.App.showEditor=()=>{opened++};h.w.Bridge.showToast=text=>messages.push(text)
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  assert.equal(h.w.document.querySelector('#notes-agora-sheet'),null)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'||c.method==='notes.agora.copy'),false)
  assert.ok(messages.some(m=>m.includes('note changed')));assert.equal(opened,2)
  assert.equal(h.calls.filter(c=>c.method==='notes.agora.busy').at(-1).args.busy,false)
 }finally{h.dom.window.close()}
})

test('ordinary note action defaults to its current page and cancellation never exports',async()=>{
 const h=harness();try{await h.w.KalamosNotesAgora.workWithAgora({notebookId:'note'});assert.equal(h.w.document.querySelector('.notes-agora-page input').checked,true);[...h.w.document.querySelectorAll('button')].find(b=>b.textContent==='Cancel').click();await settle();assert.equal(h.calls.some(c=>c.method==='notes.agora.export'),false)}finally{h.dom.window.close()}
})

test('actual shell finishes startup before routing an external document through its real editor API',async()=>{
 const h=harness({returned:true});try{
  h.w.document.body.insertAdjacentHTML('beforeend','<div id="editor-view"></div>')
  h.w.initLibrary=()=>{};h.w.Bridge.enterLibrary=()=>{};h.w.Bridge.loadMeta=()=>'{"notebookId":"note"}'
  let opened=0
  h.w.AppMode.openNotebook=id=>{assert.equal(id,'note');opened++;h.w.App.current='app';return true}
  const router=readFileSync(new URL('../../../foundation/android-runtime/src/main/assets/web/js/app.js',import.meta.url),'utf8')
  await settle() // Let JSDOM finish its initial DOM event before explicitly starting the shell.
  h.w.eval(router)
  h.w.App.start();await settle();await settle()
  assert.equal(h.w.App.current,'app')
  assert.equal(opened,2)
  assert.equal(typeof h.w.App.openNotebook,'undefined')
  // A repeated lifecycle hook cannot process the same request again.
  h.w.KalamosAppHooks.onAppReady();await settle();assert.equal(opened,2)
 }finally{h.dom.window.close()}
})
test('external Back after a rejected result saves and returns directly without attaching',async()=>{
 const h=harness({returned:true,stale:true});try{
  let closed=0;h.w.KalamosWriteWorkspace.closeAndWait=async()=>{closed++}
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  await h.w.KalamosNotesAgora.back();assert.equal(closed,1)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.cancel'),true)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.export'),false)
 }finally{h.dom.window.close()}
})

test('apply waits for completed editor cleanup before opening the new document',async()=>{
 const h=harness({returned:true});try{
  let release,opened=0
  h.w.KalamosWriteWorkspace.closeAndWait=()=>new Promise(resolve=>{release=resolve})
  h.w.App.showEditor=()=>{opened++}
  h.w.KalamosAppHooks.onAppReady();await settle();assert.equal(opened,1)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'),false)
  release();await settle();assert.equal(opened,2)
 }finally{h.dom.window.close()}
})
test('searchable chooser shows an empty result and cancellation does not mutate documents',async()=>{
 const h=harness();try{
  h.w.KalamosNotesAgora.choose();await settle()
  h.w.document.querySelector('.notes-search-btn').click();const search=h.w.document.querySelector('input[type=search]');search.value='missing';search.dispatchEvent(new h.w.Event('input'))
  assert.equal(h.w.document.querySelectorAll('#grid .note-card').length,0)
  h.w.document.querySelector('.notes-picker-back').click();await settle()
  assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'||c.method==='notes.agora.export'),false)
 }finally{h.dom.window.close()}
})
test('toolbar handoff prepares bytes, releases the mutable editor, then launches Agora and reopens saved state on return',async()=>{
 const h=harness();try{
  const order=[];let opened=0
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.KalamosWriteWorkspace.closeAndWait=async()=>{order.push('closed')}
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>{if(method.endsWith('export'))order.push('prepared');if(method.endsWith('openPrepared'))order.push('launched');return original(method,args)}
  h.w.App.showEditor=id=>{assert.equal(id,'note');opened++}
  h.w.KalamosAppHooks.onAppReady()
  h.w.KalamosNotesAgora.workWithAgora({notebookId:'note'});await settle()
  const images=[...h.w.document.querySelectorAll('.notes-agora-page')].find(row=>row.textContent.includes('Include page images')).querySelector('input');images.checked=false
  ;[...h.w.document.querySelectorAll('button')].find(b=>b.textContent==='Continue in Agora').click();await settle()
  assert.deepEqual(order,['prepared','closed','launched'])
  assert.equal(h.calls.find(c=>c.method==='notes.agora.export').args.prepareOnly,true)
  h.w.KalamosAppHooks.onAppResume();await settle();assert.equal(opened,1)
  h.w.KalamosAppHooks.onAppResume();await settle();assert.equal(opened,1)
 }finally{h.dom.window.close()}
})

test('locked picker selection retains the chooser and leaves native selection unchanged',async()=>{
 const h=harness();try{
  h.dom.reconfigure({url:'file:///android_asset/web/app.html'})
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>method==='notes.agora.pending'?{requestId:'pick',operation:'pick'}:method==='notes.agora.acquireEditor'?{acquired:false}:original(method,args)
  let opened=0;h.w.App.showEditor=()=>{opened++}
  h.w.KalamosAppHooks.onAppReady();await settle()
  h.w.document.querySelector('#grid .note-card').click();await settle()
  assert.ok(h.w.document.querySelector('#library-view.notes-picker-mode'))
  assert.match(h.w.document.querySelector('[role=status]').textContent,/already open/)
  assert.equal(opened,0)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.select'),false)
  assert.ok(h.w.document.querySelector('[data-existing-note]'))
 }finally{h.dom.window.close()}
})

test('picker awaits the old editor cleanup before opening the selected note',async()=>{
 const h=harness();try{
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>method==='notes.agora.pending'?{requestId:'pick',operation:'pick'}:original(method,args)
  let release,opened=0
  h.w.KalamosWriteWorkspace.closeAndWait=()=>new Promise(resolve=>{release=resolve})
  h.w.App.showEditor=()=>{opened++}
  h.w.KalamosAppHooks.onAppReady();await settle()
  h.w.document.querySelector('#grid .note-card').click();await settle()
  assert.equal(opened,0);assert.ok(h.w.document.querySelector('#library-view.notes-picker-mode'))
  release();await settle();assert.equal(opened,1)
 }finally{h.dom.window.close()}
})

test('picker uses the real shelf grid, folder navigation, pager and original selection controller',async()=>{
 const h=harness();try{
  h.w.libraryData={folders:[{folderId:'f',name:'Projects'}],notebooks:[{notebookId:'a',title:'First'},{notebookId:'b',title:'Second'},{notebookId:'inside',title:'In folder',folderId:'f'}]}
  h.w.libraryItemsPerPage=()=>2
  const grid=h.w.document.getElementById('grid'),pager=h.w.document.getElementById('pagination')
  let group,opened=0
  const ui=h.w.KalamosNotesShelfUI.enterPicker({open:()=>{opened++},attach:ids=>{group=ids},cancel(){}})
  assert.equal(h.w.document.querySelector('.library-selection-shelf'),null)
  assert.equal(h.w.document.querySelector('.notes-footer-create'),null)
  assert.equal(h.w.document.getElementById('grid'),grid);assert.equal(h.w.document.getElementById('pagination'),pager)
  grid.querySelector('.folder-card').click();assert.equal(h.w.activeFolderId,'f')
  assert.equal(grid.querySelector('.note-card').dataset.notebookId,'inside')
  h.w.document.getElementById('btn-folder-back').click();assert.equal(h.w.activeFolderId,'')
  const first=grid.querySelector('.note-card')
  first.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:1,clientY:1}))
  await new Promise(resolve=>setTimeout(resolve,120))
  first.dispatchEvent(new h.w.MouseEvent('pointercancel',{bubbles:true}));first.dispatchEvent(new h.w.MouseEvent('contextmenu',{bubbles:true,clientX:1,clientY:1}))
  assert.equal(h.w.document.querySelector('.context-menu'),null)
  first.click() // compatibility release click must retain the held note
  assert.equal(opened,0);assert.equal(h.w.document.querySelector('#notes-selection-bar strong').textContent,'1 selected')
  grid.querySelector('.folder-card').click();grid.querySelector('.note-card').click()
  h.w.document.getElementById('btn-folder-back').click()
  pager.querySelector('[aria-label="Next page"]').click();grid.querySelector('.note-card').click()
  h.w.document.querySelector('[data-selection=attach]').click();assert.deepEqual([...group],['a','inside','b'])
  ui.finish();assert.ok(h.w.document.querySelector('.notes-footer-create'));assert.equal(h.w.AppLibrary.readOnly,undefined)
 }finally{h.dom.window.close()}
})

test('selected notes prepare separately and return together; failed preparation returns no partial group',async()=>{
 for(const fail of [false,true]){
  const h=harness();try{
   h.w.libraryData.notebooks=[{notebookId:'one',title:'One'},{notebookId:'two',title:'Two'}]
   const original=h.w.AB.call.bind(h.w.AB)
   h.w.AB.call=(method,args)=>{
    if(method==='notes.agora.pending')return{requestId:'pick',operation:'pick',includeImages:false}
    if(method==='notes.agora.export'){
     h.calls.push({method,args});const reqId='prepared-'+args.notebookId
     setTimeout(()=>h.w.AB.handlers[reqId]?.(fail&&args.notebookId==='two'?{type:'error',message:'Cannot read selected note'}:{type:'result',value:{token:reqId}}),0)
     return{reqId}
    }
    return original(method,args)
   }
   h.w.KalamosAppHooks.onAppReady();await settle()
   const first=h.w.document.querySelector('.note-card')
   first.dispatchEvent(new h.w.MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10}))
   await new Promise(resolve=>setTimeout(resolve,680))
   first.dispatchEvent(new h.w.MouseEvent('pointerup',{bubbles:true}));first.click()
   h.w.document.querySelectorAll('.note-card')[1].click()
   ;[...h.w.document.querySelectorAll('button')].find(b=>b.textContent==='Attach 2').click()
   await new Promise(resolve=>setTimeout(resolve,100))
   assert.equal(h.calls.filter(c=>c.method==='notes.agora.export').length,2)
   const returned=h.calls.find(c=>c.method==='notes.agora.returnPreparedMany')
   if(fail){assert.equal(returned,undefined);assert.match(h.w.document.querySelector('[role=status]').textContent,/Cannot read/)}
   else assert.deepEqual(Array.from(returned.args.tokens),['prepared-one','prepared-two'])
   assert.equal(h.calls.filter(c=>c.method==='notes.agora.releaseEditor').length,2)
  }finally{h.dom.window.close()}
 }
})


test('unchanged rendered pages are reused and display cover does not enable AI page images',async()=>{
 const h=harness();try{
  const cache={},frameCache={},rendered=[];const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>{
   if(method==='notes.agora.previewCache'){
    const key=args.revisionId+':'+args.signature
    cache[key]??={};frameCache[key]??={};Object.assign(cache[key],args.previews||{});Object.assign(frameCache[key],args.frames||{})
    return {previews:Object.fromEntries(args.pageIds.filter(id=>cache[key][id]).map(id=>[id,cache[key][id]])),frames:frameCache[key]}
   }
   return original(method,args)
  }
  h.w.KalamosWriteWorkspace.exportDocumentPage=async(id,page)=>{rendered.push(page);return '<svg viewBox="0 0 320 480"></svg>'}
  const doc={revisionId:'base'}
  const first=await h.w.fixturePrepareImages('note',doc,['first','second'],true)
  assert.equal(Object.keys(first.previews).length,2);assert.equal(rendered.length,2);assert.deepEqual(JSON.parse(JSON.stringify(first.previewFrames.first)),{x:0,y:0,width:320,height:480,pixelWidth:640,pixelHeight:960})
  await h.w.fixturePrepareImages('note',doc,['first','second'],true);assert.equal(rendered.length,2)
  const cover=await h.w.fixturePrepareImages('note',doc,['first','second'],false)
  assert.equal(Object.keys(cover.previewFrames).length,0);assert.equal(Object.keys(cover.previews).length,0);assert.ok(cover.displayPreview);assert.equal(rendered.length,2)
  await h.w.fixturePrepareImages('note',{revisionId:'new'},['first'],false);assert.equal(rendered.length,3)
 }finally{h.dom.window.close()}
})

test('replace ink materializes from trusted regions instead of creating a fresh semantic document',async()=>{
 const h=harness({returned:true,transcription:true});try{
  let materialized=false
  h.w.KalamosWriteWorkspace.materializeNotebookSemantic=()=>{throw new Error('wrong document operation')}
  h.w.KalamosWriteWorkspace.materializeNotebookTranscription=async(id,blocks,regions)=>{
   assert.equal(id,'note');assert.equal(blocks[0].sourceInkRegionIds[0],'region-1');assert.equal(regions[0].runId,'run-1')
   materialized=true;return [{pageId:'first',source:'Original source',sidecar:{inkRuns:[],textBoxes:blocks}}]
  }
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  assert.equal(materialized,true);const applied=h.calls.find(c=>c.method==='notes.agora.apply')
  assert.equal(applied.args.proposal.operation,'replace_ink');assert.equal(applied.args.sheets[0].pageId,'first')
  assert.equal(h.w.document.querySelector('#notes-agora-sheet'),null)
 }finally{h.dom.window.close()}
})

test('already applied result opens current note without materialization or replacing subsequent edits',async()=>{
 const h=harness({returned:true,stale:true,transcription:true});try{
  let layouts=0,closes=0
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.KalamosWriteWorkspace.materializeNotebookTranscription=async()=>{layouts++;throw Error('must not run')}
  h.w.KalamosWriteWorkspace.closeAndWait=async()=>{closes++}
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>{if(method==='notes.agora.prepare'){h.calls.push({method,args});return {proposalApplied:true,revisionId:'newer'}}return original(method,args)}
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  assert.equal(layouts,0);assert.equal(closes,0)
  assert.equal(h.calls.filter(c=>c.method==='notes.agora.apply').length,1)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c.method==='notes.agora.apply').args.sheets)),[])
 }finally{h.dom.window.close()}
})
test('processing error retains the already open editor instead of opening it twice and closing the external session',async()=>{
 const h=harness({returned:true,stale:true});try{
  let opened=0,closed=0
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.App.showEditor=()=>{opened++};h.w.KalamosWriteWorkspace.closeAndWait=async()=>{closed++}
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  assert.equal(opened,1);assert.equal(closed,0);assert.equal(h.calls.some(c=>c.method==='notes.agora.cancel'),false)
 }finally{h.dom.window.close()}
})

test('native merged interactive state reaches materialization and commit without a dialog',async()=>{
 const h=harness({returned:true});try{
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>method==='notes.agora.prepare'?{effectiveProposal:{...args.proposal,blocks:args.proposal.blocks.map(b=>({...b,checked:true}))}}:original(method,args)
  let checked=false
  h.w.KalamosWriteWorkspace.materializeNotebookSemantic=async(id,blocks)=>{checked=blocks[0].checked;return[{source:'',sidecar:{}}]}
  h.w.KalamosAppHooks.onAppReady();await settle();await settle()
  assert.equal(checked,true)
  assert.equal(h.calls.find(c=>c.method==='notes.agora.apply').args.proposal.blocks[0].checked,true)
  assert.equal(h.w.document.querySelector('#notes-agora-sheet'),null)
 }finally{h.dom.window.close()}
})

test('AI action queues only the current page JPEG without export, cache, cover or dialog work',async()=>{
 const h=harness();try{
  h.w.Bridge.getNotebookFile=()=>JSON.stringify({active:0,pages:[{id:'first'}]})
  let closed=0;h.w.KalamosWriteWorkspace.closeAndWait=async()=>{closed++}
  const menu=h.w.KalamosWritingHost.documentActions.find(action=>action.label==='Format with AI')
  assert.equal(menu.shortLabel,'Format with AI')
  const ai=menu.options[0];assert.equal(ai.label,'Format this page')
  assert.equal(h.w.KalamosWritingHost.notebookToolbar,true);assert.equal(h.w.KalamosWritingHost.documentAction,undefined)
  ai.run('note');await settle();await settle()
  assert.equal(closed,0);assert.equal(h.w.document.querySelector('[role="dialog"]'),null)
  const queued=h.calls.find(c=>c.method==='notes.ai.processImage')
  assert.equal(queued.args.pageId,'first');assert.match(queued.args.image,/^data:image\/jpeg;base64,/);assert.equal(queued.args.expectedRevisionId,'base')
  assert.equal(h.calls.some(c=>c.method==='notes.agora.export'||c.method==='notes.agora.previewCache'),false)
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.processImage').length,1)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.openPrepared'),false)
 }finally{h.dom.window.close()}
})
test('background result uses the existing validated save path and acknowledges only after application',async()=>{
 const h=harness();try{
  const result={requestId:'background-request',proposal:{operation:'organize',proposalId:'bg',title:'Tasks',blocks:[{id:'one',type:'task',text:'Milk',checked:false}]}}
  const original=h.w.AB.call.bind(h.w.AB);let ready=true
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult'){h.calls.push({method,args});return ready?result:{}}
   if(method==='notes.ai.backgroundConsumed'){h.calls.push({method,args});ready=false;return{}}
   return original(method,args)
  }
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle();await settle()
  const apply=h.calls.findIndex(c=>c.method==='notes.agora.apply'),ack=h.calls.findIndex(c=>c.method==='notes.ai.backgroundConsumed')
  assert.ok(apply>=0);assert.ok(ack>apply);assert.equal(h.calls[ack].args.requestId,'background-request')
  assert.equal(h.w.document.querySelector('[role="dialog"]'),null)
 }finally{h.dom.window.close()}
})

test('pending background formatting remains visible, retrieves completed results without another job, and stops on close',async()=>{
 const h=harness();try{
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult'){h.calls.push({method,args});return{requestId:'saved-request',pending:true}}
   if(method==='notes.ai.backgroundReplay'){h.calls.push({method,args});return{pending:true}}
   return original(method,args)
  }
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle()
  const status=h.w.document.querySelector('#notes-ai-progress')
  assert.equal(status.getAttribute('role'),'status');assert.match(status.textContent,/Formatting with AI/)
  await new Promise(resolve=>setTimeout(resolve,1600))
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.backgroundReplay').length,1)
  await new Promise(resolve=>setTimeout(resolve,550))
  assert.equal(status.querySelector('.notes-ai-dots'),null) // No animated repaint on e-ink.
  assert.match(status.textContent,/Formatting with AI/)
  assert.equal(h.calls.some(c=>c.method==='notes.ai.processImage'),false)
  h.w.KalamosWritingHost.onDocumentClosed('note')
  assert.equal(h.w.document.querySelector('#notes-ai-progress'),null)
 }finally{h.dom.window.close()}
})

test('saving status lasts through commit and leaves a dismissible success after acknowledgment',async()=>{
 const h=harness();try{
  const original=h.w.AB.call.bind(h.w.AB);let committed=false,finishCommit
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult')return committed?{}:{requestId:'saved-request',proposal:{operation:'organize',proposalId:'bg',blocks:[{id:'one',type:'task',text:'Milk'}]}}
   if(method==='notes.agora.apply'){
    const reqId='commit';finishCommit=()=>{committed=true;h.w.AB.handlers[reqId]({type:'result',value:{notebookId:'note'}})};return{reqId}
   }
   if(method==='notes.ai.backgroundConsumed'){h.calls.push({method,args});return{}}
   return original(method,args)
  }
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle()
  assert.match(h.w.document.querySelector('#notes-ai-progress').textContent,/Saving formatted note/)
  assert.equal(h.calls.some(c=>c.method==='notes.ai.backgroundConsumed'),false)
  finishCommit();await settle()
  const success=h.w.document.querySelector('#notes-ai-progress');assert.equal(success.dataset.kind,'success');assert.match(success.textContent,/Note saved/)
  success.querySelector('button').click();assert.equal(h.w.document.querySelector('#notes-ai-progress'),null)
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.backgroundConsumed').length,1)
 }finally{h.dom.window.close()}
})

test('AI press immediately shows preparing before native flush and rejects a second press',async()=>{
 const h=harness();try{
  const ai=h.w.KalamosWritingHost.documentActions[0].options[0]
  assert.equal(ai.onPress('note'),true)
  assert.match(h.w.document.querySelector('#notes-ai-progress').textContent,/Preparing page for AI/)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.export'),false)
  assert.equal(ai.onPress('note'),false)
  h.w.Bridge.getNotebookFile=()=>JSON.stringify({active:0,pages:[{id:'first'}]})
  ai.run('note');await settle();await settle()
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.processImage').length,1)
  assert.equal(h.calls.filter(c=>c.method==='notes.agora.revisionSnapshot').length,1)
  assert.equal(ai.onPress('note'),false) // Preparation finished, but the AI job still owns this request.
 }finally{h.dom.window.close()}
})


test('an unconfigured local formatter opens Notes AI settings without preparing or queueing a job',()=>{
 const h=harness();try{
  let settings=0;h.w.KalamosNotesAI={openSettings(){settings++}}
  const call=h.w.AB.call.bind(h.w.AB);h.w.AB.call=(method,args)=>method==='notes.ai.settings'?{configured:false}:call(method,args)
  assert.equal(h.w.KalamosWritingHost.documentActions[0].options[0].onPress('note'),false)
  assert.equal(settings,1);assert.equal(h.calls.some(c=>c.method==='notes.ai.processImage'),false)
 }finally{h.dom.window.close()}
})

test('image-only whole-page Markdown is materialized locally before native prepare/apply',async()=>{
 const h=harness();try{
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  const order=[];const proposal={schema:'kalamos.notes-proposal/v1',proposalId:'image-result',documentId:'doc',baseRevisionId:'base',operation:'replace_page',title:'Tasks',targetPageIds:['first'],markdown:'# To buy\n- [x] Milk',blocks:[]}
  h.w.KalamosWriteWorkspace.materializeNotebookImage=async(id,pageId,markdown,regions,namespace)=>{
   order.push('local-grid');assert.equal(id,'note');assert.equal(pageId,'first');assert.equal(markdown,proposal.markdown);assert.equal(namespace,'image-result')
   return{blocks:[{id:'heading',type:'heading',text:'To buy'},{id:'milk',type:'task',text:'Milk',checked:true}],sheets:[{source:'\u200b',sidecar:{textBoxes:[]}}]}
  }
  h.w.KalamosWriteWorkspace.closeAndWait=async()=>order.push('close')
  h.w.KalamosWriteWorkspace.commitNotebookRevision=async(id,commit)=>{order.push('in-place');assert.equal(id,'note');return await commit()}
  const original=h.w.AB.call.bind(h.w.AB);let ready=true
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult')return ready?{requestId:'req',proposal}:{}
   if(method==='notes.ai.backgroundConsumed'){ready=false;order.push('ack');return{}}
   if(method==='notes.agora.prepare')order.push('prepare')
   if(method==='notes.agora.apply'){order.push('apply');assert.equal(args.proposal.operation,'replace_page');assert.equal(args.proposal.blocks.length,2);assert.equal(args.sheets.length,1)}
   return original(method,args)
  }
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle();await settle();await settle();await settle()
  assert.deepEqual(order,['local-grid','prepare','in-place','apply','ack'])
 }finally{h.dom.window.close()}
})
test('a whole-page Markdown row mismatch leaves the editor open and never prepares or applies',async()=>{
 const h=harness();try{
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  let attempted=false
  h.w.KalamosWriteWorkspace.materializeNotebookImage=async()=>{attempted=true;throw new Error('Markdown does not match the occupied ruled rows')}
  let closed=false;h.w.KalamosWriteWorkspace.closeAndWait=async()=>{closed=true}
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>method==='notes.ai.backgroundResult'?{requestId:'req',proposal:{proposalId:'image',documentId:'doc',baseRevisionId:'base',operation:'replace_page',targetPageIds:['first'],markdown:'Joined line',blocks:[]}}:original(method,args)
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle();await settle()
  assert.equal(attempted,true);assert.equal(closed,false);assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'||c.method==='notes.agora.prepare'),false)
 }finally{h.dom.window.close()}
})


test('worker errors remain visible with their reason after receipt acknowledgment until dismissed',async()=>{
 const h=harness();try{
  const original=h.w.AB.call.bind(h.w.AB);let ready=true
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult')return ready?{requestId:'failed',error:'AI provider returned HTTP 401. Check your API key.'}:{}
   if(method==='notes.ai.backgroundConsumed'){ready=false;return{}}
   return original(method,args)
  }
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle()
  const status=h.w.document.querySelector('#notes-ai-progress');assert.equal(status.getAttribute('role'),'alert');assert.equal(status.dataset.kind,'error');assert.match(status.textContent,/HTTP 401/)
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle();assert.equal(status.isConnected,true)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'),false)
  status.querySelector('button').click();assert.equal(status.isConnected,false)
 }finally{h.dom.window.close()}
})
test('preparation failures produce a persistent error and retry replaces it immediately',async()=>{
 const h=harness();try{
  h.w.KalamosWriteWorkspace.checkpointWorkspace=async()=>{throw new Error('Page could not be saved')}
  const action=h.w.KalamosWritingHost.documentActions[0].options[0];action.run('note');await settle();await settle()
  const status=h.w.document.querySelector('#notes-ai-progress');assert.equal(status.dataset.kind,'error');assert.match(status.textContent,/Page could not be saved/)
  assert.equal(h.calls.some(c=>c.method==='notes.ai.processImage'),false)
  assert.equal(action.onPress('note'),true);assert.equal(status.dataset.kind,'progress');assert.match(status.textContent,/Preparing page/)
 }finally{h.dom.window.close()}
})
test('failed local placement remains an error rather than reporting successful saving',async()=>{
 const h=harness();try{
  h.w.KalamosWriteWorkspace.isOpen=()=>true;h.w.KalamosWriteWorkspace.materializeNotebookImage=async()=>{throw new Error('Markdown does not match occupied rows')}
  const original=h.w.AB.call.bind(h.w.AB);let ready=true
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult')return ready?{requestId:'bad-grid',proposal:{proposalId:'bad',operation:'replace_page',baseRevisionId:'base',targetPageIds:['first'],markdown:'Wrong'}}:{}
   if(method==='notes.ai.backgroundConsumed'){ready=false;return{}}
   return original(method,args)
  }
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle();await settle()
  const status=h.w.document.querySelector('#notes-ai-progress');assert.equal(status.dataset.kind,'error');assert.match(status.textContent,/occupied rows/);assert.doesNotMatch(status.textContent,/complete|Note saved/)
  assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'),false)
 }finally{h.dom.window.close()}
})

test('native AI press shows a real toast immediately and only refreshes the existing gutter once per state',async()=>{
 const h=harness({nativeMode:true});try{
  const toasts=[],regions=[];h.w.Bridge.showToast=text=>toasts.push(text);h.w.Bridge.snapshotToolbarRegion=(...bounds)=>regions.push(bounds)
  const action=h.w.KalamosWritingHost.documentActions[0].options[0];assert.equal(action.onPress('note'),true)
  assert.deepEqual(toasts,['Preparing page for AI…']);await settle()
  const status=h.w.document.querySelector('#notes-ai-progress');assert.equal(status.classList.contains('notes-ai-native-summary'),true)
  assert.equal(regions.length,1);assert.equal(regions[0][1],h.w.innerHeight-20)
  assert.equal(action.onPress('note'),false);await settle();assert.equal(toasts.length,1);assert.equal(regions.length,1)
  h.w.KalamosWritingHost.onDocumentClosed('note')
 }finally{h.dom.window.close()}
})

test('completed AI formatting waits for the page dialog to close without applying or consuming it',async()=>{
 const h=harness();try{
  let dialog=true;h.w.KalamosWriteWorkspace.isOpen=()=>true;h.w.KalamosWriteWorkspace.hasOpenDialog=()=>dialog;
  const original=h.w.AB.call.bind(h.w.AB);let consumed=false;
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.backgroundResult')return consumed?{}:{requestId:'waiting',proposal:{operation:'organize',proposalId:'waiting',blocks:[{id:'one',type:'paragraph',text:'Safe result'}]}};
   if(method==='notes.ai.backgroundConsumed'){consumed=true;return{}}
   return original(method,args)
  };
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle();assert.equal(consumed,false);assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'),false);
  dialog=false;h.w.KalamosWritingHost.onDocumentOpened('note');await settle();await settle();assert.equal(consumed,true);assert.equal(h.calls.some(c=>c.method==='notes.agora.apply'),true);
 }finally{h.dom.window.close()}
})

test('Share appears in note long-press menu and exports ordered JPEGs through the Android chooser',async()=>{
 const h=harness();try{
  h.w.Bridge.getNotebookFile=()=>JSON.stringify({active:0,pages:[{id:'first'},{id:'second'}]})
  h.w.KalamosWriteWorkspace.isOpen=()=>true;let checkpoints=0;h.w.KalamosWriteWorkspace.checkpointWorkspace=async()=>{checkpoints++}
  const rendered=[];h.w.KalamosWriteWorkspace.exportSavedDocumentPage=async(id,page)=>{rendered.push(page);return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 480"></svg>'}
  const original=h.w.AB.call.bind(h.w.AB);h.w.AB.call=(method,args)=>{if(method.startsWith('notes.share.')){h.calls.push({method,args});return method==='notes.share.begin'?{token:'share-session'}:{}}return original(method,args)}
  const action=h.w.AppLibrary.contextActions({notebookId:'note'}).find(a=>a.label==='Share');assert.ok(action);action.run();await settle();await settle()
  assert.equal(checkpoints,1);assert.deepEqual(rendered,['first','second']);assert.deepEqual(h.calls.filter(c=>c.method.startsWith('notes.share.')).map(c=>c.method),['notes.share.begin','notes.share.add','notes.share.add','notes.share.open'])
  const pages=h.calls.filter(c=>c.method==='notes.share.add');assert.deepEqual(pages.map(c=>c.args.index),[0,1]);assert.ok(pages.every(c=>c.args.image.startsWith('data:image/jpeg;base64,')))
  assert.equal(h.calls.some(c=>c.method==='notes.agora.export'||c.method==='notes.agora.openPrepared'||c.method==='notes.ai.processImage'),false)
  assert.ok(h.w.KalamosWritingHost.documentActions.some(a=>a.label==='Share'&&a.icon==='share'))
 }finally{h.dom.window.close()}
})
test('failed page sharing cancels staged files and never opens a partial share',async()=>{
 const h=harness();try{
  h.w.Bridge.getNotebookFile=()=>JSON.stringify({active:0,pages:[{id:'first'}]})
  h.w.KalamosWriteWorkspace.exportSavedDocumentPage=async()=>{throw Error('Cannot render page')}
  const original=h.w.AB.call.bind(h.w.AB);h.w.AB.call=(method,args)=>{if(method.startsWith('notes.share.')){h.calls.push({method,args});return method==='notes.share.begin'?{token:'cancel-me'}:{}}return original(method,args)}
  await h.w.KalamosNotesAgora.shareNote('note')
  assert.equal(h.calls.some(c=>c.method==='notes.share.open'),false);assert.equal(h.calls.find(c=>c.method==='notes.share.cancel').args.token,'cancel-me')
  h.w.AppLibrary.readOnly=true;assert.equal(h.w.AppLibrary.contextActions({notebookId:'note'}).some(a=>a.label==='Share'),false)
 }finally{h.dom.window.close()}
})

test('AI tap pins the page open at press even if navigation changes during the flush',async()=>{
 const h=harness();try{
  let active=0
  h.w.Bridge.getNotebookFile=()=>JSON.stringify({active,pages:[{id:'first'},{id:'second'}]})
  const ai=h.w.KalamosWritingHost.documentActions[0].options[0]
  assert.equal(ai.onPress('note'),true)
  active=1;ai.run('note');await settle();await settle()
  assert.equal(h.calls.find(c=>c.method==='notes.ai.processImage').args.pageId,'first')
 }finally{h.dom.window.close()}
})

test('notebook menu option processes original pages sequentially with fresh revisions',async()=>{
 const h=harness();try{
  h.w.KalamosWriteWorkspace.isOpen=()=>true
  h.w.Bridge.getNotebookFile=()=>JSON.stringify({active:1,pages:[{id:'first'},{id:'second'},{id:'third'}]})
  h.w.KalamosWriteWorkspace.materializeNotebookImage=async()=>({blocks:[],sheets:[{source:'',sidecar:{}}]})
  let current={},revision=0
  const original=h.w.AB.call.bind(h.w.AB)
  h.w.AB.call=(method,args)=>{
   if(method==='notes.ai.processImage'){h.calls.push({method,args});current={requestId:'request-'+args.pageId,pending:true};return current}
   if(method==='notes.ai.backgroundResult')return current
   if(method==='notes.ai.backgroundConsumed'){h.calls.push({method,args});current={};return{}}
   if(method==='notes.agora.inspect'||method==='notes.agora.revisionSnapshot')return{revisionId:'rev-'+revision,inkRegions:[]}
   if(method==='notes.agora.apply')revision++
   return original(method,args)
  }
  h.w.KalamosWritingHost.onDocumentOpened('note');await settle()
  const menu=h.w.KalamosWritingHost.documentActions[0]
  assert.deepEqual(Array.from(menu.options,option=>option.label),['Format this page','Format this whole notebook'])
  assert.equal(menu.run,undefined);assert.equal(menu.onLongPress,undefined)
  const convert=menu.options[1];assert.equal(convert.onPress('note'),true);convert.run('note')
  await settle();await settle();await settle()
  assert.deepEqual(h.calls.filter(c=>c.method==='notes.ai.processImage').map(c=>c.args.pageId),['first'])
  for(const pageId of ['first','second','third']) {
   current={requestId:'request-'+pageId,proposal:{operation:'replace_page',proposalId:'result-'+pageId,baseRevisionId:'rev-'+revision,targetPageIds:[pageId],markdown:'Formatted'}}
   h.w.KalamosWritingHost.onDocumentOpened('note')
   await settle();await settle();await settle();await settle()
  }
  const requests=h.calls.filter(c=>c.method==='notes.ai.processImage')
  assert.deepEqual(requests.map(c=>c.args.pageId),['first','second','third'])
  assert.deepEqual(requests.map(c=>c.args.expectedRevisionId),['rev-0','rev-1','rev-2'])
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.backgroundConsumed').length,3)
  assert.equal(h.w.localStorage.getItem('notes.ai.notebookPages.note'),null)
 }finally{h.dom.window.close()}
})

test('selected Markdown uses the Android text share route without image export or AI',async()=>{
 const h=harness();try{
  h.w.KalamosWritingHost.shareSelection('note','**Selected** text\n\n- one');await settle();
  const request=h.calls.find(c=>c.method==='notes.share.markdown');assert.ok(request);
  assert.equal(request.args.text,'**Selected** text\n\n- one');
  assert.equal(h.calls.some(c=>c.method==='notes.ai.processImage'||c.method==='notes.agora.export'),false);
 }finally{h.dom.window.close()}
})
