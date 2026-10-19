import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const root = new URL('../../../',import.meta.url)
const storage = readFileSync(new URL('foundation/android-runtime/src/main/assets/web/js/storage-web.js',root),'utf8')
const library = readFileSync(new URL('foundation/android-runtime/src/main/assets/web/js/library-controller.js',root),'utf8')
function harness(ok=true) {
  const events=[]
  const context=vm.createContext({window:{onNotebookSaved:(...args)=>events.push(['meta',...args]),onThumbnailReady:id=>events.push(['ready',id])},
    Bridge:{saveMeta:()=>ok?'ok':'error',savePage:()=>ok?'ok':'error',saveThumbnailDataUrl:()=>{events.push(['write']);return ok?'ok':'error'},getThumbnailDataUrl:()=> 'old-preview'},
    console:{info:()=>{}},setTimeout,clearTimeout,nowISO:()=> '2026-10-04T12:00:00Z'})
  vm.runInContext(storage+'\nthis.storage=Storage;',context)
  return {context,events,store:context.storage}
}
test('completed thumbnail replacement invalidates old cache and signals shelf only after save',()=>{
  const {store,events,context}=harness()
  assert.equal(store.getThumbnailUrl('qa'),'old-preview')
  context.Bridge.getThumbnailDataUrl=()=> 'new-preview'
  assert.equal(store.saveRenderedThumbnail('qa','data:image/png;base64,test'),true)
  assert.deepEqual(events,[['write'],['ready','qa']])
  assert.equal(store.getThumbnailUrl('qa'),'new-preview')
})
test('successful full and dirty metadata saves publish recency; failures do not',()=>{
  for(const method of ['saveNotebook','saveNotebookDirty']) {
    const {store,events}=harness()
    assert.equal(store[method]({notebookId:'qa',pages:[]}),true)
    assert.deepEqual(events,[['meta','qa','2026-10-04T12:00:00Z']])
    const failed=harness(false)
    assert.equal(failed.store[method]({notebookId:'qa',pages:[]}),false)
    assert.deepEqual(failed.events,[])
  }
})
test('shelf mirrors saved recency and invalidates only the changed card metadata',()=>{
  const start=library.indexOf('window.onNotebookSaved =')
  const end=library.indexOf('window.onThumbnailReady =',start)
  const events=[]
  const context=vm.createContext({window:{},libraryData:{notebooks:[{notebookId:'qa',updatedAt:'old'},{notebookId:'other',updatedAt:'unchanged'}]},
    invalidateCardMeta:id=>events.push(id),Storage:{saveLibrary:()=>events.push('saved-index')}})
  vm.runInContext(library.slice(start,end),context)
  context.window.onNotebookSaved('qa','new')
  assert.equal(context.libraryData.notebooks[0].updatedAt,'new')
  assert.equal(context.libraryData.notebooks[1].updatedAt,'unchanged')
  assert.deepEqual(events,['qa','saved-index'])
})
