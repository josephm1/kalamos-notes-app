import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source=readFileSync(new URL('../app/src/main/assets/web/js/notes-names.js',import.meta.url),'utf8')
const shelf=readFileSync(new URL('../../../foundation/android-runtime/src/main/assets/web/js/library-controller.js',import.meta.url),'utf8')
function setup(){
 const calls=[];const notes=[{notebookId:'one',title:'To do'},{notebookId:'two',title:'Shopping'}]
 const context={window:{libraryData:{notebooks:notes}},Bridge:{showToast:text=>calls.push(['toast',text])},Storage:{loadNotebook:id=>({notebookId:id,title:notes.find(n=>n.notebookId===id).title}),saveNotebook:nb=>calls.push(['save',nb])},saveLibrary:()=>calls.push(['library']),renderLibrary:()=>calls.push(['render'])}
 context.window.AppLibrary={};context.AppLibrary=context.window.AppLibrary
 vm.createContext(context);vm.runInContext(source,context)
 vm.runInContext(shelf.match(/function renameNote\(info\) \{[\s\S]*?\n\}/)[0],context)
 return {context,calls,notes,names:context.window.KalamosNotesNames}
}
test('readable portable names and collision suffixes include Unicode and long names',()=>{
 const {names}=setup()
 assert.equal(names.stem('To do'),'To do')
 assert.equal(names.stem('../outside'),'..-outside')
 assert.equal(names.unique('TO DO',['To do','TO DO (2)']),'TO DO (3)')
 assert.equal(names.unique('Cafe\u0301',['Café']),'Café (2)')
 const long='a'.repeat(120);assert.ok(names.unique(long,[long]).length<=120)
})
test('actual shelf rename rejects duplicate filenames before any saved mutation',()=>{
 const h=setup();h.context.prompt=()=> 'SHOPPING'
 h.context.renameNote(h.notes[0])
 assert.equal(h.notes[0].title,'To do')
 assert.equal(h.calls.some(c=>c[0]==='save'||c[0]==='library'),false)
 assert.ok(h.calls.some(c=>c[0]==='toast'))
})
test('actual shelf rename updates notebook title and library together and allows its own name',()=>{
 const h=setup();h.context.prompt=()=> 'Weekend list'
 h.context.renameNote(h.notes[0]);assert.equal(h.notes[0].title,'Weekend list')
 assert.equal(h.calls.find(c=>c[0]==='save')[1].title,'Weekend list')
 assert.ok(h.calls.some(c=>c[0]==='library'))
 assert.equal(h.context.AppLibrary.validateNotebookTitle('Weekend list','one'),true)
 assert.equal(h.context.AppLibrary.validateNotebookTitle('a/b','one'),false)
})
