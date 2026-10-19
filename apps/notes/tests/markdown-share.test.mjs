import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const source=readFileSync(new URL('../app/src/main/assets/web/js/app-overlay.js',import.meta.url),'utf8')
const handler=source.slice(source.indexOf('  async function shareNotebookMarkdown('),source.indexOf('  const previousContextActions',source.indexOf('  async function shareNotebookMarkdown(')))
test('Share Markdown uses current notebook text with no rendering or embedded appendix',async()=>{
 const calls=[],errors=[];const markdown='# Edited heading\n\n- [x] Current task'
 const context={window:{KalamosNotesMigration:{ensure(id){calls.push(['ensure',id])}}},planningEditor:()=>({async getNotebookMarkdown(id){calls.push(['read',id]);return markdown}}),AB:{call(method,args){calls.push([method,args]);return {}}},toast:message=>errors.push(message)}
 const run=runInNewContext(handler+';shareNotebookMarkdown',context)
 await run({notebookId:'29',title:'Notebook 29'})
 assert.equal(errors.length,0)
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['ensure','29'],['read','29'],['notes.share.markdown',{title:'Notebook 29',text:markdown}]])
 assert.match(source,/label:'Share Markdown'/);assert.doesNotMatch(source,/label:'Export Markdown'/)
})
test('empty text and native errors are reported without a second export path',async()=>{
 for(const text of [' ','# Notes']){
 const calls=[],errors=[]
 const run=runInNewContext(handler+';shareNotebookMarkdown',{window:{KalamosNotesMigration:{ensure(){}}},planningEditor:()=>({async getNotebookMarkdown(){return text}}),AB:{call(){calls.push(1);return {err:'Share unavailable'}}},toast:message=>errors.push(message)})
 await run({notebookId:'29'})
 assert.equal(calls.length,text.trim()?1:0);assert.equal(errors.length,1)
 assert.match(errors[0],text.trim()?/Share unavailable/:/no Markdown text/)
 }
})
