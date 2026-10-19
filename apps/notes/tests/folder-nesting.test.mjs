import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const notesRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeJs = join(notesRoot, '../../foundation/android-runtime/src/main/assets/web/js')
const models = readFileSync(join(runtimeJs, 'models.js'), 'utf8')
const libraryController = readFileSync(join(runtimeJs, 'library-controller.js'), 'utf8')
const config = readFileSync(join(notesRoot, 'app/src/main/assets/web/js/app-config.js'), 'utf8')
const css = readFileSync(join(notesRoot, 'app/src/main/assets/web/css/app-overlay.css'), 'utf8')

function hierarchyContext() {
  const context = vm.createContext({
    console,
    Math,
    Date,
    JSON,
    setTimeout: function() {},
    clearTimeout: function() {}
  })
  context.window = context
  context.window.KalamosConfig = { nestedFolders: true }
  vm.runInContext(models + '\n' + libraryController, context)
  return context
}

test('Android Back climbs each folder and exits only from the root', () => {
  const context = hierarchyContext()
  context.document = {addEventListener(){}}
  let exits=0, renders=0
  context.Bridge={exitApp(){exits++}}
  vm.runInContext(readFileSync(join(runtimeJs,'app.js'),'utf8'),context)
  vm.runInContext("libraryData={folders:[{folderId:'parent',parentFolderId:''},{folderId:'child',parentFolderId:'parent'}],notebooks:[]}; activeFolderId='child'; libraryPage=3",context)
  context.renderLibrary=()=>renders++
  context.App.current='library'
  context.App.onAndroidBack()
  assert.equal(vm.runInContext('activeFolderId',context),'parent')
  assert.equal(vm.runInContext('libraryPage',context),0)
  assert.equal(exits,0)
  context.App.onAndroidBack()
  assert.equal(vm.runInContext('activeFolderId',context),'')
  assert.equal(exits,0)
  context.App.onAndroidBack()
  assert.equal(exits,1)
  assert.equal(renders,2)
})

test('Notes keeps nested folders while moving creation into its bottom menu', () => {
  assert.match(config, /nestedFolders:\s*true/)
  assert.match(config, /libraryCreationInChrome:\s*true/)
  assert.match(config, /libraryFolderBar:\s*false/)
  assert.match(libraryController, /function creationCardsInGrid\(\)/)
  assert.match(libraryController, /if \(!folderBarEnabled\(\)\) return/)
  assert.match(libraryController, /buildNewFolderCard\(\)/)
  assert.match(libraryController, /heading\.textContent = 'New folder'/)
  assert.match(libraryController, /createFolder\(name, parentFolderId\)/)
  assert.match(css, /\.notes-footer-create/)
  const overlayJs = readFileSync(join(notesRoot, 'app/src/main/assets/web/js/app-overlay.js'), 'utf8')
  assert.doesNotMatch(overlayJs, /legacyFolderBar/)
  assert.doesNotMatch(
    overlayJs,
    /classList\.toggle\('notes-folder-open'\)/
  )
})

test('new folders retain their parent folder id', () => {
  const context = hierarchyContext()
  const folder = vm.runInContext("createFolder('Child', 'parent-id')", context)
  assert.equal(folder.name, 'Child')
  assert.equal(folder.parentFolderId, 'parent-id')
})

test('each library level contains only its direct folders and notes', () => {
  const context = hierarchyContext()
  const result = vm.runInContext(`
    libraryData = {
      version: 1,
      folders: [
        { folderId: 'work', name: 'Work', createdAt: '2026-01-01' },
        { folderId: 'project', name: 'Project', parentFolderId: 'work', createdAt: '2026-01-02' }
      ],
      notebooks: [
        { notebookId: 'inbox', title: 'Inbox', folderId: '', updatedAt: '2026-01-03' },
        { notebookId: 'brief', title: 'Brief', folderId: 'work', updatedAt: '2026-01-04' },
        { notebookId: 'plan', title: 'Plan', folderId: 'project', updatedAt: '2026-01-05' }
      ]
    };
    normalizeFolderHierarchy();
    activeFolderId = '';
    const root = computeLibraryCells();
    activeFolderId = 'work';
    const work = computeLibraryCells();
    ({
      rootFolders: root.folders.map(f => f.folderId),
      rootNotes: root.notebooks.map(n => n.notebookId),
      workFolders: work.folders.map(f => f.folderId),
      workNotes: work.notebooks.map(n => n.notebookId),
      path: folderDisplayPath(findFolder('project'))
    })
  `, context)

  assert.deepEqual(Array.from(result.rootFolders), ['work'])
  assert.deepEqual(Array.from(result.rootNotes), ['inbox'])
  assert.deepEqual(Array.from(result.workFolders), ['project'])
  assert.deepEqual(Array.from(result.workNotes), ['brief'])
  assert.equal(result.path, 'Work / Project')
})

test('old flat folders migrate to the root and invalid references are repaired', () => {
  const context = hierarchyContext()
  const result = vm.runInContext(`
    libraryData = {
      version: 1,
      folders: [
        { folderId: 'legacy', name: 'Legacy' },
        { folderId: 'orphan', name: 'Orphan', parentFolderId: 'missing' },
        { folderId: 'self', name: 'Self', parentFolderId: 'self' }
      ],
      notebooks: [{ notebookId: 'lost-note', title: 'Lost', folderId: 'missing' }]
    };
    normalizeFolderHierarchy();
    ({
      parents: libraryData.folders.map(f => f.parentFolderId),
      noteFolder: libraryData.notebooks[0].folderId
    })
  `, context)

  assert.deepEqual(Array.from(result.parents), ['', '', ''])
  assert.equal(result.noteFolder, '')
})

test('folder moves cannot target the folder itself or one of its descendants', () => {
  assert.match(libraryController, /const blocked = \[folder\.folderId\]\.concat\(descendantFolderIds\(folder\.folderId\)\)/)
  assert.match(libraryController, /if \(parentFolderId && blocked\.indexOf\(parentFolderId\) !== -1\) return/)
})

test('creation passes name and paper to the editor before its first autosave', () => {
  const context = hierarchyContext()
  context.Storage = { saveLibrary() {}, saveNotebook(nb) { context.savedNotebook = nb } }
  context.Bridge = { saveLibrary() { return 'ok' } }
  context.App = { showEditor(id) {
    assert.equal(context.savedNotebook.notebookId, id)
    assert.equal(context.savedNotebook.title, 'Cornell notebook')
    assert.equal(context.savedNotebook.pages[0].template.type, 'cornell')
  } }
  vm.runInContext("libraryData = {folders:[],notebooks:[]}; activeFolderId = ''; createNewNotebook('Cornell notebook', {type:'cornell', spacing:44, margin:72})", context)
})
