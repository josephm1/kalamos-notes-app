import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'

const notesRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = join(notesRoot, 'app/src/main/assets/web')
const overlay = readFileSync(join(webRoot, 'js/app-overlay.js'), 'utf8')
const css = readFileSync(join(webRoot, 'css/app-overlay.css'), 'utf8') + readFileSync(join(notesRoot, '../../features/writing/workspace/src/kalamos/notes-writing-ui.css'), 'utf8')
const config = readFileSync(join(webRoot, 'js/app-config.js'), 'utf8')
const runtimeRoot = join(notesRoot, '../../foundation/android-runtime/src/main/assets/web/js')
const libraryController = readFileSync(join(runtimeRoot, 'library-controller.js'), 'utf8')
const appController = readFileSync(join(runtimeRoot, 'app.js'), 'utf8')

test('shared shelf creates only the folder controls enabled by its host', () => {
  const source = ['folderBarEnabled', 'ensureClassicLibraryShell'].map(name => {
    const fn = libraryController.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'))
    assert.ok(fn)
    return fn[0]
  }).join('\n')
  for (const enabled of [false, true]) {
    const view = { innerHTML: '' }
    const sandbox = {
      window: { KalamosConfig: { libraryFolderBar: enabled } },
      document: { getElementById: id => id === 'library-view' ? view : null }
    }
    vm.runInNewContext(source + '\nensureClassicLibraryShell()', sandbox)
    assert.equal(view.innerHTML.includes('id="folder-bar"'), enabled)
    assert.ok(view.innerHTML.includes('id="grid"'))
    assert.ok(view.innerHTML.includes('id="header"'))
  }
})

test('parser loads shared icons before Notes registers its shelf hooks', () => {
  const shell = readFileSync(join(runtimeRoot, '../app.html'), 'utf8')
  const scripts = [...shell.matchAll(/<script src="([^"]+)"/g)].map(match => match[1])
  const writes = []
  const sandbox = {
    window: {},
    document: { write: html => writes.push(html), addEventListener() {} }
  }
  vm.createContext(sandbox)
  // document.write queues dependencies until the running overlay returns. Do not eagerly
  // execute them here: doing so would conceal the real WebView startup ordering regression.
  for (const script of scripts) {
    if (script === 'js/toolbar-icons.js') {
      vm.runInContext(readFileSync(join(runtimeRoot, 'toolbar-icons.js'), 'utf8'), sandbox)
    }
    if (script === 'js/app-overlay.js') {
      vm.runInContext(overlay, sandbox)
      break
    }
  }
  assert.equal(typeof sandbox.window.KalamosAppHooks.onLibraryReady, 'function')
  assert.equal(typeof sandbox.window.AppMode.openNotebook, 'function')
  assert.match(sandbox.window.KalamosToolbarIcons.svg('newNote'), /<svg/)
  assert.equal(writes.some(html => html.includes('toolbar-icons.js')), false)
})

test('resuming the library reloads external note imports from storage', () => {
  assert.match(
    appController,
    /onResumeApp\(\)\s*\{[\s\S]*if \(this\.current === 'library' && typeof loadLibrary === 'function'\) loadLibrary\(\)/
  )
  assert.match(appController, /loadLibrary also renders, so refresh from disk/)
})

test('Notes footer matches the Books navigation composition', () => {
  for (const label of [
    'Library menu',
    'First page',
    'Previous page',
    'Next page',
    'Last page',
    'Library settings'
  ]) {
    assert.match(overlay, new RegExp("'" + label + "'"))
  }
  assert.match(overlay, /'Page ' \+ current \+ ' of ' \+ total/)
  assert.match(css, /grid-template-columns:58px minmax\(0,1fr\) 104px/)
  assert.match(css, /grid-template-columns:80px 80px 144px 80px 80px/)
  assert.match(css, /height:64px/)
  assert.match(overlay, /sharedRenderPagination\(totalPages, folderCount, fileCount\)\s+syncFooter\(\)/)
})

test('library heading stays compact and separate from the footer', () => {
  assert.match(css, /#library-view #header\{[\s\S]*flex:0 0 44px/)
  assert.match(css, /#library-view #header\{[\s\S]*border:0/)
  assert.match(css, /:is\(#notes-library-footer,\.notes-library-footer\)\{/)
  assert.match(overlay, /document\.getElementById\('library-view'\)\.appendChild\(footer\)/)
})

test('note shelf uses legible complete previews without decorative stars', () => {
  assert.doesNotMatch(overlay, /title = 'Favourites'/)
  assert.doesNotMatch(css, /content:'☆'/)
  assert.doesNotMatch(css, /\.note-card \.thumb:after/)
  assert.doesNotMatch(css, /box-shadow:inset 8px/)
  assert.match(css, /\.note-card \.thumb\{[^}]*aspect-ratio:86\/131/)
  assert.match(css, /\.note-card \.thumb img\{object-fit:contain;padding:0;filter:grayscale\(1\) contrast\(1\.35\)\}/)
  assert.match(css, /content:'Empty note'/)
  assert.match(css, /grid-template-columns:repeat\(var\(--notes-columns\),minmax\(0,var\(--notes-card-max\)\)\)/)
  assert.match(css, /\.empty-icon\.note-template-ruled/)
  assert.match(css, /\.folder-card>\.cover:before\{[^}]*border-bottom:0[^}]*border-radius:7px 7px 0 0/)
  assert.match(css, /\.folder-card \.cover\.folder-cover-slots\{gap:6px;padding:7px\}/)
  assert.match(css, /\.folder-cover-slots>\.cell\{[^}]*border:0[^}]*background:transparent/)
  assert.match(css, /\.folder-cover-slots>\.cell>img\{[^}]*border:1\.5px solid #000[^}]*border-radius:5px/)
  assert.match(libraryController, /if \(slotEntries\.length\) \{[\s\S]*for \(let i = 0; i < 4; i\+\+\)/)
  assert.match(libraryController, /const directNotes = libraryData\.notebooks\.filter/)
  assert.match(libraryController, /entry\.kind === 'folder'/)
  assert.match(libraryController, /miniFolder\.className = 'nested-folder-preview'/)
  assert.doesNotMatch(libraryController, /const nestedIds = \[entry\.data\.folderId\]/)
  assert.doesNotMatch(libraryController, /nestedUrl/)
  assert.match(css, /\.nested-folder-preview\{position:absolute;inset:10px 4px 4px;width:auto;height:auto/)
  assert.match(css, /\.nested-folder-preview:before\{[^}]*border-bottom:0/)
})

test('Notes offers persistent 2 by 2, 3 by 3, and 4 by 4 shelf densities', () => {
  assert.match(overlay, /function supportedDensities\(\).*\[2, 3\].*\[2, 3, 4\]/)
  assert.match(overlay, /kalamos\.notes\.libraryDensity/)
  assert.match(overlay, /function notesShelfLayout\(/)
  assert.match(overlay, /setLibraryPageSize\(layout\.pageSize\)/)
  assert.match(overlay, /legend\.textContent = 'Notebooks per screen'/)
  assert.match(css, /#grid\[data-notes-density="2"\]/)
  assert.match(css, /#grid\[data-notes-density="4"\]/)
  assert.match(css, /\.notes-library-settings-panel label\{/)
  assert.doesNotMatch(overlay, /notes-density-menu|notes-layout-btn/)
  assert.match(libraryController, /function libraryItemsPerPage\(\)/)
  assert.match(libraryController, /function setLibraryPageSize\(size\)/)
  assert.doesNotMatch(libraryController, /const PER_PAGE/)
})

test('shelf previews fill available space while keeping complete, legible rows', () => {
  const helper = overlay.match(/function notesShelfLayout\([^)]*\) \{[\s\S]*?\n    \}/)
  assert.ok(helper)
  const sandbox = {}
  vm.createContext(sandbox)
  vm.runInContext(helper[0], sandbox, { filename: 'notes-shelf-layout.js' })

  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.notesShelfLayout(532, 640, 3, 10, 14, 28, 16))),
    { columns: 3, rows: 2, pageSize: 6, cardWidth: 161 }
  )
  assert.equal(sandbox.notesShelfLayout(900, 1200, 3, 18, 14, 48, 16).pageSize, 9)
  assert.ok(sandbox.notesShelfLayout(900, 1200, 3, 18, 14, 48, 16).cardWidth > 220)
  assert.equal(sandbox.notesShelfLayout(572, 1000, 3, 20, 26, 48, 36).pageSize, 6)
  const selecting = sandbox.notesShelfLayout(532, 500, 3, 10, 14, 28, 16)
  assert.equal(selecting.pageSize, 6)
  assert.ok(selecting.cardWidth >= 110 && selecting.cardWidth < 150)
  assert.match(css, /grid-template-rows:repeat\(var\(--notes-rows\),max-content\)/)
  assert.match(css, /@media\(max-width:680px\)[\s\S]*?grid-template-columns:48px minmax\(0,1fr\) 88px/)
})

test('separate Note and Folder actions live in the footer with black-white creation states', () => {
  assert.match(config, /libraryCreationInChrome:\s*true/)
  assert.match(overlay, /'notes-new-note-btn', 'New note', 'newNote', openCreateDialog/)
  assert.match(overlay, /'notes-new-folder-btn', 'New folder', 'newFolder'/)
  assert.doesNotMatch(overlay, /notes-new-menu|Create new/)
  assert.doesNotMatch(overlay, /notes-head-tools|createTools/)
  assert.match(overlay, /'New folder'[\s\S]*createNewFolder/)
  assert.match(css, /\.notes-create-overlay\{[^}]*background:transparent/)
  assert.match(css, /\.notes-create-actions button\{[^}]*background:#fff[^}]*color:#000/)
  assert.match(css, /\.notes-create-actions \.create\{background:#000;color:#fff/)
  assert.doesNotMatch(overlay,/data-mode="handwriting"/)
  assert.match(overlay,/notes-template-picker/)

})

test('Notes shelf order and displayed time both follow last opened time', () => {
  assert.match(config, /libraryOrder:\s*"lastOpened"/)
  assert.match(libraryController, /function libraryCardTimestamp\(info\)/)
  assert.match(libraryController, /info\.lastOpenedAt \|\| info\.updatedAt \|\| info\.createdAt/)
  assert.match(libraryController, /\.sort\(function\(a, b\) \{[\s\S]*libraryCardTimestamp\(b\)[\s\S]*libraryCardTimestamp\(a\)/)
  assert.match(libraryController, /meta\.textContent = timeAgo\(libraryCardTimestamp\(info\)\)/)
  assert.match(appController, /recordNotebookOpened\(notebookId\)/)
  assert.match(overlay, /recordNotebookOpened\(nb\.notebookId\)/)
})

test('Planning toolbar is captured as an opaque white control surface', () => {
  assert.match(css, /#kalamos-write-workspace-root \.tool-pill \{[\s\S]*background: #fff;[\s\S]*opacity: 1;[\s\S]*isolation: isolate;/)
  assert.match(css, /\.tool-pill:not\(\.toolbar-all-tools\) > \.toolbar-core,[\s\S]*background: #fff;[\s\S]*opacity: 1;/)
})
