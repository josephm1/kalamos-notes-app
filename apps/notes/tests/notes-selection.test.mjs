import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const { JSDOM } = createRequire(new URL('../../../features/writing/workspace/package.json', import.meta.url))('jsdom')
const Model = createRequire(import.meta.url)('../app/src/main/assets/web/js/notes-selection-model.js')
function library() { return { folders: [{ folderId: 'a', parentFolderId: '' }, { folderId: 'b', parentFolderId: 'a' }, { folderId: 'c', parentFolderId: 'b' }, { folderId: 'other', parentFolderId: '' }], notebooks: [{ notebookId: 'one', folderId: 'b' }, { notebookId: 'two', folderId: 'a' }, { notebookId: 'keep', folderId: 'c' }] } }

test('folder slots show missing-thumbnail notebooks and update without a standalone card', () => {
 const dom = new JSDOM('<div id="grid"></div>', { runScripts:'outside-only' })
 try {
  const w=dom.window
  const source=readFileSync(new URL('../../../foundation/android-runtime/src/main/assets/web/js/library-controller.js',import.meta.url),'utf8')
  let url=''
  w.Storage={getThumbnailUrl:()=>url,invalidateThumbnail(){}}
  w.peekCardMeta=()=>({kind:'planning'})
  w.libraryData={notebooks:[{notebookId:'one',folderId:'todo'}],folders:[]}
  w.descendantFolderIds=()=>[]; w.childFolders=()=>[]
  w.visibleThumbs={}; w.visibleFolderThumbs={}
  for(const name of ['renderNoteThumb','refreshFolderThumbs','buildFolderCard']) {
   w.eval(source.match(new RegExp('function '+name+'\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))[0])
  }
  w.eval(source.match(/window\.onThumbnailReady = function\(notebookId\) \{[\s\S]*?\n\}/)[0])
  const card=w.buildFolderCard({folderId:'todo',name:'To Do'})
  assert.equal(card.querySelectorAll('.folder-note-preview .empty-icon.note-template-ruled').length,1)
  assert.equal(card.querySelectorAll('.cell').length,4)
  url='data:image/png;base64,preview'
  w.onThumbnailReady('one')
  assert.equal(card.querySelector('.folder-note-preview img').src,url)
  assert.equal(card.querySelector('.folder-note-preview .empty-icon'),null)
 } finally { dom.window.close() }
})

test('selection strip stays above the navigator and icon taps work across shelf screens', () => {
 const dom = new JSDOM('<div id="library-view"><div id="grid"><div class="note-card" data-notebook-id="one"></div></div><footer id="notes-library-footer"><div id="pager-controls"></div></footer></div>', { runScripts:'outside-only' })
 try {
  const w = dom.window, d = w.document
  w.NotesSelection = Model; w.AppLibrary = {}; w.KalamosAppHooks = {}
  w.libraryData = {notebooks:[{notebookId:'one'}, {notebookId:'two'}], folders:[]}
  w.libraryPage = 0
  w.computeLibraryCells = () => ({cells:w.libraryData.notebooks.map(data => ({data}))})
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
  w.eval(read('../../../foundation/android-runtime/src/main/assets/web/js/toolbar-icons.js'))
  w.eval(read('../app/src/main/assets/web/js/notes-selection.js'))
  const controller = read('../../../foundation/android-runtime/src/main/assets/web/js/library-controller.js')
  w.eval(controller.match(/function renderPagination\([^)]*\) \{[\s\S]*?\n\}/)[0])
  w.renderGrid = () => w.renderPagination(3,0,2)
  w.renderGrid()
  w.KalamosNotesSelection.start(w.libraryData.notebooks[0])
  const bar = d.getElementById('notes-selection-bar'), footer = d.getElementById('notes-library-footer')
  assert.equal(bar.parentElement, footer.parentElement)
  assert.equal(bar.nextElementSibling, footer)
  assert.equal(bar.querySelectorAll('button svg').length, 5)
  bar.querySelector('[data-selection=all] svg path').dispatchEvent(new w.MouseEvent('click',{bubbles:true}))
  assert.equal(bar.querySelector('strong').textContent, '2 selected')
  d.querySelectorAll('.page-btn')[1].click()
  assert.equal(w.libraryPage,1)
  assert.equal(bar.querySelector('strong').textContent, '2 selected')
  d.querySelectorAll('.page-btn')[1].click()
  assert.equal(w.libraryPage,2)
  assert.equal(d.querySelector('.page-label').textContent,'3 / 3')
  bar.querySelector('[data-selection=done] svg path').dispatchEvent(new w.MouseEvent('click',{bubbles:true}))
  assert.equal(d.getElementById('notes-selection-bar'),null)
 } finally { dom.window.close() }
})
test('batch move affects selected objects without changing the original library', () => {
 const original = library(), before = JSON.stringify(original)
 const moved = Model.move(original, ['note:one','note:two','folder:b'], 'other')
 assert.equal(moved.notebooks[0].folderId, 'other'); assert.equal(moved.notebooks[1].folderId, 'other')
 assert.equal(moved.notebooks[2].folderId, 'c'); assert.equal(moved.folders[1].parentFolderId, 'other')
 assert.equal(JSON.stringify(original), before)
})
test('folder move rejects self, descendants and nonexistent destinations', () => {
 for (const destination of ['a','b','c','missing']) assert.throws(() => Model.move(library(), ['folder:a'], destination))
 assert.equal(Model.move(library(), ['folder:b'], '').folders[1].parentFolderId, '')
})
test('batch deletion preserves unselected contents and reparents through deleted ancestors', () => {
 const result = Model.remove(library(), ['folder:a','folder:b','note:two'])
 assert.deepEqual(result.notebooks.map(n => n.notebookId), ['one','keep'])
 assert.equal(result.notebooks[0].folderId, '')
 assert.equal(result.notebooks[1].folderId, 'c')
 assert.equal(result.folders.find(f => f.folderId === 'c').parentFolderId, '')
})

test('selection initializes in parser order without waiting for shared library functions',()=>{
 const dom=new JSDOM('<div id="library-view"><div id="grid"><div class="note-card" data-notebook-id="one"></div></div><footer id="notes-library-footer"></footer></div>',{runScripts:'outside-only'})
 try{
  const w=dom.window;w.NotesSelection=Model;w.AppLibrary={};w.KalamosAppHooks={};w.libraryData={notebooks:[{notebookId:'one'}],folders:[]}
  const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
  w.eval(read('../../../foundation/android-runtime/src/main/assets/web/js/toolbar-icons.js'))
  // Match app.html/document.write order: selection overlay parses before library-controller.
  w.eval(read('../app/src/main/assets/web/js/notes-selection.js'))
  assert.equal(typeof w.createShelfSelection,'undefined')
  assert.equal(typeof w.KalamosNotesSelection.start,'function')
  w.AppLibrary.contextActions(w.libraryData.notebooks[0]).find(action=>action.label==='Select').run()
  assert.equal(w.document.querySelector('#notes-selection-bar strong').textContent,'1 selected')
  assert.equal(w.document.querySelector('.notes-selection-tick').textContent,'✓')
 }finally{dom.window.close()}
})
