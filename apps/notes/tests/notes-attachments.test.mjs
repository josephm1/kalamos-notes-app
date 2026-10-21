import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const {JSDOM}=createRequire(new URL('../../../features/writing/workspace/package.json',import.meta.url))('jsdom')
const source=readFileSync(new URL('../app/src/main/assets/web/js/notes-attachments.js',import.meta.url),'utf8')
const asset={id:'a'.repeat(64),name:'Photo.png',mime:'image/png',width:400,height:200}
const settle=()=>new Promise(resolve=>setTimeout(resolve,5))
function setup(picked={kind:'image',attachment:asset}) {
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window,calls=[],inserted=[],dialogs=[],messages=[]
 const context={notebookId:'one',pageId:'page',owner:1}
 w.Bridge={showToast:message=>messages.push(message)}
 w.AB={call:(method,args)=>{calls.push({method,args});return method.endsWith('.pick')?picked:{playing:true}},on(){},off(){}}
 w.KalamosWriteWorkspace={attachmentContext:()=>context,setDocumentDialog:async active=>dialogs.push(active),
  addAttachment:async(c,value)=>{assert.equal(c.owner,context.owner);inserted.push(value)},arrangeAttachments:()=>calls.push({method:'arrange'}),updateAttachmentAudio:status=>calls.push({method:'audio-status',status})}
 w.KalamosWritingHost={documentActions:[{label:'Format with AI'},{label:'Share'}]}
 w.eval(source)
 const button=label=>[...w.document.querySelectorAll('button')].find(button=>button.textContent===label)
 return {dom,w,calls,inserted,dialogs,messages,context,button}
}
test('Attach is one extra action and opens a consistent modal without an AI request',async()=>{
 const t=setup();try{
  assert.deepEqual(t.w.KalamosWritingHost.documentActions.map(a=>a.label),['Format with AI','Share','Attach'])
  await t.w.KalamosNotesAttachments.open('one')
  const panel=t.w.document.querySelector('[role=dialog]');assert.equal(panel.getAttribute('aria-modal'),'true')
  assert.deepEqual([...panel.querySelectorAll('.notes-attachment-options button')].map(b=>b.textContent),['Image','Audio','File','Link','Arrange attachments'])
  assert.deepEqual(t.calls,[]);assert.deepEqual(t.dialogs,[true]);t.button('Cancel').click();await settle();assert.deepEqual(t.dialogs,[true,false])
 }finally{t.dom.window.close()}
})
test('image import retains the captured page owner and releases the dialog after save',async()=>{
 const t=setup();try{
  await t.w.KalamosNotesAttachments.open('one');t.button('Image').click();await settle()
  assert.equal(t.inserted.length,1);assert.equal(t.inserted[0].attachment.id,asset.id)
  assert.equal(t.calls[0].method,'notes.attachments.pick');assert.equal(t.calls[0].args.kind,'image')
  assert.equal(t.w.document.querySelector('[role=dialog]'),null);assert.deepEqual(t.dialogs,[true,false])
 }finally{t.dom.window.close()}
})
test('file-picker cancellation leaves the note untouched and the Attach menu usable',async()=>{
 const t=setup({cancelled:true});try{
  await t.w.KalamosNotesAttachments.open('one');t.button('File').click();await settle()
  assert.equal(t.inserted.length,0);assert.ok(t.w.document.querySelector('[role=dialog]'));assert.equal(t.button('File').disabled,false)
  assert.equal(t.w.KalamosNotesAttachments.close(),true);await settle();assert.equal(t.w.KalamosNotesAttachments.close(),false)
 }finally{t.dom.window.close()}
})
test('links validate the URL locally and add the labelled reference without picking a file',async()=>{
 const t=setup();try{
  await t.w.KalamosNotesAttachments.open('one');t.button('Link').click();await settle()
  const input=t.w.document.querySelector('[aria-label="Link URL"]');input.value='javascript:alert(1)';t.button('Add link').click();await settle()
  assert.equal(t.inserted.length,0);assert.match(t.w.document.querySelector('[role=status]').textContent,/http or https/)
  input.value='https://example.org/guide';t.w.document.querySelector('[aria-label="Link title"]').value='Guide'
  t.button('Add link').click();await settle();assert.equal(t.inserted[0].kind,'link');assert.equal(t.inserted[0].link.title,'Guide');assert.equal(t.calls.length,0)
 }finally{t.dom.window.close()}
})
test('failed insertion shows its error and preserves the dialog for retry',async()=>{
 const t=setup();try{
  t.w.KalamosWriteWorkspace.addAttachment=async()=>{throw Error('The page changed. Open Attach again.')}
  await t.w.KalamosNotesAttachments.open('one');t.button('Image').click();await settle()
  assert.match(t.w.document.querySelector('[role=status]').textContent,/page changed/);assert.equal(t.button('Image').disabled,false);assert.equal(t.inserted.length,0)
 }finally{t.dom.window.close()}
})
test('audio never starts on import or render and closing the note stops playback',async()=>{
 const t=setup();try{
  assert.equal(t.calls.length,0);t.w.KalamosWritingHost.activateAttachment({kind:'audio',attachment:{...asset,mime:'audio/mpeg'}});await settle()
  assert.equal(t.calls[0].method,'notes.attachments.audio');assert.equal(t.calls[1].method,'audio-status');assert.deepEqual(t.messages,[])
  t.w.KalamosWritingHost.onDocumentClosed('one');assert.equal(t.calls.at(-1).method,'notes.attachments.stop')
 }finally{t.dom.window.close()}
})
test('repeated taps during checkpoint open only one modal',async()=>{
 const t=setup();try{
  let done;t.w.KalamosWriteWorkspace.setDocumentDialog=()=>new Promise(resolve=>{done=resolve})
  const first=t.w.KalamosNotesAttachments.open('one');await t.w.KalamosNotesAttachments.open('one');done();await first
  assert.equal(t.w.document.querySelectorAll('[role=dialog]').length,1)
 }finally{t.dom.window.close()}
})

test('closing or replacing the page during checkpoint cannot open a stale menu',async()=>{
 const t=setup();try{
  let done;t.w.KalamosWriteWorkspace.setDocumentDialog=active=>active?new Promise(resolve=>{done=resolve}):Promise.resolve()
  const pending=t.w.KalamosNotesAttachments.open('one');t.context.owner++;done();await pending
  assert.equal(t.w.document.querySelector('[role=dialog]'),null);assert.equal(t.inserted.length,0)
 }finally{t.dom.window.close()}
})
