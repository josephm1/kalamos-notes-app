import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
const {JSDOM}=createRequire(new URL('../../../features/writing/workspace/package.json',import.meta.url))('jsdom')
const source=readFileSync(new URL('../app/src/main/assets/web/js/notes-ai-settings.js',import.meta.url),'utf8')
function fixture({saved=true,delayed=false,plan=false}={}){
 const dom=new JSDOM('<body><button id="origin">AI settings</button></body>',{url:'https://fixture.invalid',runScripts:'outside-only'}),w=dom.window,calls=[],dialogs=[]
 w.KalamosWriteWorkspace={isOpen:()=>true,async setDocumentDialog(active){dialogs.push(active)}}
 const handlers={}
 w.AB={on(id,fn){handlers[id]=fn},off(id){delete handlers[id]},call(method,args){calls.push({method,args});if(method==='notes.ai.settings')return{baseUrl:'https://example.invalid/v1',model:saved?'vision-model':'',hasKey:saved,billing:plan?'chatgpt':'api',chatGptConnected:plan,chatGptModel:plan?'plan-model':''};if(method==='notes.ai.billing'){plan=args.plan;return{configured:true}};if(method==='notes.ai.models')return delayed?{reqId:'models-'+calls.length}:{models:[{id:'vision-model',name:'Vision',vision:true},{id:'other',name:'Other'}]};return{configured:true}}}

 w.eval(source);return{dom,w,calls,dialogs,handlers}
}
test('Notes AI settings show native status without retrieving a key, save explicitly, and release editor dialog',async()=>{
 const h=fixture();try{
  h.w.document.querySelector('#origin').focus();await h.w.KalamosNotesAI.openSettings()
  const form=h.w.document.querySelector('form');assert.equal(form.getAttribute('aria-label'),'AI settings')
  const key=form.querySelector('[name=apiKey]');assert.equal(key.type,'password');assert.equal(key.value,'');assert.match(key.placeholder,/Saved/)
  assert.equal(form.querySelector('[name=model]').value,'vision-model');assert.deepEqual(h.dialogs,[true])
  key.value='fixture-new-key';form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}))
  assert.equal(h.calls.at(-1).method,'notes.ai.configure');assert.equal(h.calls.at(-1).args.apiKey,'fixture-new-key')
  assert.equal(key.value,'');assert.equal(h.w.document.querySelector('#notes-ai-settings'),null);assert.deepEqual(h.dialogs,[true,false])
 }finally{h.dom.window.close()}
})
test('closing never saves and removing a key uses an explicit native action',async()=>{
 const h=fixture();try{
  await h.w.KalamosNotesAI.openSettings()
  const buttons=()=>[...h.w.document.querySelectorAll('button')]
  buttons().find(b=>b.textContent==='Remove key').click()
  assert.equal(h.calls.at(-1).args.clearKey,true);assert.equal(h.calls.at(-1).args.apiKey,'')
  buttons().find(b=>b.textContent==='Close').click();assert.equal(h.calls.filter(c=>c.method==='notes.ai.configure').length,1)
  assert.equal(h.w.document.querySelector('#notes-ai-settings'),null)
 }finally{h.dom.window.close()}
})
test('configuration errors remain visible and never retain a typed key in the field',async()=>{
 const h=fixture();try{
  await h.w.KalamosNotesAI.openSettings();h.w.AB.call=()=>({err:'Use an HTTPS API base URL'})
  const form=h.w.document.querySelector('form');form.querySelector('[name=apiKey]').value='fixture-key'
  form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}))
  assert.match(form.querySelector('[role=status]').textContent,/HTTPS/);assert.equal(form.querySelector('[name=apiKey]').value,'')
 }finally{h.dom.window.close()}
})


test('new provider lists models before saving, keeps the entered key, and saves a dropdown choice',async()=>{
 const h=fixture({saved:false});try{
  await h.w.KalamosNotesAI.openSettings();const form=h.w.document.querySelector('form')
  const field=name=>form.querySelector('[name='+name+']')
  field('apiKey').value='fixture-key';field('apiKey').dispatchEvent(new h.w.Event('input'))
  ;[...form.querySelectorAll('button')].find(b=>b.textContent==='Load models').click();await new Promise(r=>setTimeout(r,0))
  const list=field('modelChoice');assert.match(list.textContent,/Images/);assert.equal(list.value,'')
  list.value='id:other';list.dispatchEvent(new h.w.Event('change'));assert.equal(field('model').value,'other');assert.equal(field('model').parentElement.hidden,true)
  assert.equal(field('apiKey').value,'fixture-key')
  form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}))
  assert.equal(h.calls.at(-1).method,'notes.ai.configure');assert.equal(h.calls.at(-1).args.model,'other')
 }finally{h.dom.window.close()}
})
test('refresh preserves a saved model missing from the catalogue and manual entry remains available',async()=>{
 const h=fixture();try{
  await h.w.KalamosNotesAI.openSettings();const form=h.w.document.querySelector('form')
  h.w.AB.call=(method,args)=>method==='notes.ai.models'?{models:[{id:'new-model',name:'New'}]}:{configured:true}
  ;[...form.querySelectorAll('button')].find(b=>b.textContent==='Refresh models').click();await new Promise(r=>setTimeout(r,0))
  const list=form.querySelector('select');assert.equal(list.value,'id:vision-model');assert.match(list.textContent,/vision-model \(current\)/)
  list.value='manual';list.dispatchEvent(new h.w.Event('change'))
  const field=form.querySelector('[name=model]');assert.equal(field.parentElement.hidden,false);field.value='private-model'
  form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(h.w.document.querySelector('#notes-ai-settings'),null)
 }finally{h.dom.window.close()}
})
test('a failed model endpoint retains manual setup and does not save configuration',async()=>{
 const h=fixture({saved:false});try{
  await h.w.KalamosNotesAI.openSettings();h.w.AB.call=()=>({err:'Model list returned HTTP 404. Enter a model ID manually.'})
  ;[...h.w.document.querySelectorAll('button')].find(b=>b.textContent==='Load models').click();await new Promise(r=>setTimeout(r,0))
  assert.match(h.w.document.querySelector('[role=status]').textContent,/404/)
  assert.equal(h.w.document.querySelector('[name=model]').parentElement.hidden,false)
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.configure').length,0)
 }finally{h.dom.window.close()}
})
test('endpoint changes and closure discard pending responses and listeners',async()=>{
 const h=fixture({delayed:true});try{
  await h.w.KalamosNotesAI.openSettings()
  const id=Object.keys(h.handlers)[0],reply=h.handlers[id]
  const url=h.w.document.querySelector('[name=baseUrl]');url.value='https://second.invalid/v1';url.dispatchEvent(new h.w.Event('input'))
  assert.equal(Object.keys(h.handlers).length,0)
  reply({type:'result',value:{models:[{id:'stale-model',name:'Stale'}]}});await new Promise(r=>setTimeout(r,0))
  assert.doesNotMatch(h.w.document.querySelector('select').textContent,/stale-model/)
  assert.equal(h.w.document.querySelector('[name=model]').value,'')
  ;[...h.w.document.querySelectorAll('button')].find(b=>b.textContent==='Load models').click()
  assert.equal(Object.keys(h.handlers).length,1);h.w.KalamosNotesAI.closeSettings();await new Promise(r=>setTimeout(r,0))
  assert.equal(Object.keys(h.handlers).length,0);assert.equal(h.w.document.querySelector('#notes-ai-settings'),null)
 }finally{h.dom.window.close()}
})

test('thinking defaults off and an explicit low choice is saved with the provider',async()=>{
 const h=fixture();try{
  await h.w.KalamosNotesAI.openSettings();const form=h.w.document.querySelector('form'),thinking=form.querySelector('[name=thinking]')
  assert.equal(thinking.value,'none');assert.deepEqual([...thinking.options].map(o=>o.value),['none','low','high','max','default'])
  thinking.value='low';form.dispatchEvent(new h.w.Event('submit',{bubbles:true,cancelable:true}))
  assert.equal(h.calls.at(-1).args.thinking,'low')
 }finally{h.dom.window.close()}
})
test('thinking restores the saved value and closing does not change it',async()=>{
 const h=fixture();try{
  const call=h.w.AB.call.bind(h.w.AB);h.w.AB.call=(method,args)=>{const result=call(method,args);return method==='notes.ai.settings'?{...result,thinking:'low'}:result}
  await h.w.KalamosNotesAI.openSettings();const select=h.w.document.querySelector('[name=thinking]');assert.equal(select.value,'low')
  select.value='none';h.w.KalamosNotesAI.closeSettings();assert.equal(h.calls.some(c=>c.method==='notes.ai.configure'),false)
 }finally{h.dom.window.close()}
})


test('ChatGPT connection opens native account controls without submitting an API key',async()=>{
 const h=fixture();try {
  await h.w.KalamosNotesAI.openSettings()
  ;[...h.w.document.querySelectorAll('button')].find(b=>b.textContent==='Continue with ChatGPT').click()
  assert.equal(h.calls.at(-1).method,'notes.ai.chatgpt');assert.equal(Object.keys(h.calls.at(-1).args).length,0)
  assert.equal(h.calls.filter(c=>c.method==='notes.ai.configure').length,0)
  assert.equal(h.w.document.querySelector('#notes-ai-settings'),null)
 }finally{h.dom.window.close()}
})
test('plan billing shows its model and requires an explicit switch to API billing',async()=>{
 const h=fixture({plan:true});try {
  await h.w.KalamosNotesAI.openSettings()
  const form=h.w.document.querySelector('form')
  assert.match(form.textContent,/ChatGPT plan selected.*plan-model/)
  assert.equal(form.querySelector('[name=apiKey]').parentElement.hidden,true)
  assert.equal(form.querySelector('[name=apiKey]').required,false)
  assert.equal(h.calls.some(c=>c.method==='notes.ai.models'),false)
  ;[...form.querySelectorAll('button')].find(b=>b.textContent==='Use API provider').click()
  const call=h.calls.find(c=>c.method==='notes.ai.billing');assert.equal(call.args.plan,false)
  await new Promise(r=>setTimeout(r,0));assert.equal(h.w.document.querySelector('[name=apiKey]').parentElement.hidden,false)
 }finally{h.dom.window.close()}
})
