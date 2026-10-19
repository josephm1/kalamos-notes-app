import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const overlay=readFileSync(new URL('../app/src/main/assets/web/js/app-overlay.js',import.meta.url),'utf8')
const importHandler=overlay.slice(overlay.indexOf('  window.onMarkdownImported ='),overlay.indexOf('  let receivingMarkdown='))
const receiver=overlay.slice(overlay.indexOf('  let receivingMarkdown='),overlay.indexOf('  const appHooks ='))
test('shared Markdown waits for current notebook save before using the ordinary import path',async()=>{
 const events=[],window={}
 runInNewContext(importHandler,{window,planningEditor:()=>({async createMarkdownSheets(text){events.push(['parse',text]);return [{source:'\u200b',sidecar:{textBoxes:[{text:'Draft'}]}}]},isOpen:()=>true,async closeAndWait(save){events.push(['close',save])}}),createPlanningNotebook(name,content){events.push(['create',name,content]);return 'imported'},toast(){throw Error('unexpected error')}})
 assert.equal(await window.onMarkdownImported({name:'Draft.md',text:'# Draft\n\n- [x] Keep',notebookId:'shared-uuid'}),'imported')
 assert.equal(events[0][0],'parse');assert.equal(events[1][0],'close');assert.equal(events[2][1],'Draft');assert.equal(events[2][2].source,'\u200b');assert.equal(events[2][2].sheets[0].sidecar.textBoxes[0].text,'Draft');assert.equal(events[2][2].notebookId,'shared-uuid')
})
test('incoming request is consumed only after import succeeds; failures remain retryable',async()=>{
 for(const result of [undefined,'imported']){
 const calls=[];const incoming={requestId:'request',notebookId:'shared-request',text:'# Draft'}
 const receive=runInNewContext(receiver+';markdownImportReady=true;receiveSharedMarkdown',{AB:{call(method){calls.push(method);return method.endsWith('pending')?incoming:{}}},window:{async onMarkdownImported(){return result}},libraryData:{notebooks:[]},Storage:{saveLibrary(){return true},loadMeta(){return null}},Bridge:{},toast(){},planningEditor:()=>({})})
 await receive();assert.deepEqual(calls,result?['notes.import.pending','notes.import.ack']:['notes.import.pending'])
 }
})
test('a redelivered request reopens its saved notebook without overwriting edits or creating another',async()=>{
 const events=[]
 const receive=runInNewContext(receiver+';markdownImportReady=true;receiveSharedMarkdown',{AB:{call(method){events.push(method);return method.endsWith('pending')?{requestId:'r',notebookId:'shared-r'}:{}}},window:{onMarkdownImported(){throw Error('must not duplicate')}},libraryData:{notebooks:[{notebookId:'shared-r'}]},Storage:{saveLibrary(){return true},loadMeta(){return {notebookId:'shared-r'}}},Bridge:{getNotebookFile(){return '# Edited'}},toast(){throw Error('unexpected')},planningEditor:()=>({isOpen:()=>true,async closeAndWait(){events.push('save')},openWorkspaceNotebook(id){events.push(id)}})})
 await receive();assert.deepEqual(events,['notes.import.pending','save','shared-r','notes.import.ack'])
})
