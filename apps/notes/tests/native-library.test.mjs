import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../app/src/main/assets/web/js/notes-native-library.js', import.meta.url), 'utf8')

function setup(enabled = true) {
  const calls = [], frames = [], events = [], observers = []
  const state = { dialog: false, editor: false, selection: false, web: 0 }
  const grid = { dataset: { notesDensity: '3' }, classList: { contains: () => false },
    getBoundingClientRect: () => ({ x: 0, y: 48, width: 600, height: 640 }) }
  const style = { 'column-gap': '12', 'row-gap': '18', 'padding-left': '16',
    'padding-right': '16', 'padding-top': '16', '--notes-card-max': '150' }
  const cells = [{ kind: 'notebook', data: { notebookId: 'a', title: 'A' } },
    { kind: 'folder', data: { folderId: 'f', name: 'Folder' } }]
  const sandbox = {
    window: { innerWidth: 600, AppLibrary: {}, KalamosAppHooks: { onLibraryReady() {} },
      KalamosWriteWorkspace: { isOpen: () => state.editor },
      KalamosNotesSelection: { isActive: () => state.selection }, addEventListener() {} },
    document: { getElementById: id => id === 'grid' ? grid : { getBoundingClientRect: () => ({ height: 800 }) },
      querySelector: () => state.dialog ? {} : null, body: {} },
    getComputedStyle: () => ({ getPropertyValue: name => style[name] || '0' }),
    requestAnimationFrame: fn => { frames.push(fn); return frames.length },
    MutationObserver: class { constructor(fn) { observers.push(fn) } observe() {} },
    ResizeObserver: class { observe() {} },
    AB: { call(method, args) { calls.push({ method, args }); return method.endsWith('capabilities') ? { enabled } : {} } },
    libraryData: { notebooks: [{ notebookId: 'child', folderId: 'f' }] }, activeFolderId: '', libraryPage: 0,
    timeAgo: () => 'Just now', libraryCardTimestamp: () => '', childFolders: () => [],
    bookFormat: () => null, peekCardMeta: () => ({}),
    App: { showEditor: id => { events.push(['open', id]); state.editor = true } },
    showContextMenu: (...args) => { events.push(['context', ...args]); state.dialog = true },
    moveNote: (...args) => events.push(['move', ...args]),
    findFolder: () => ({ parentFolderId: 'parent' }), folderParentId: f => f.parentFolderId,
    renderLibrary: () => sandbox.renderGrid(),
    renderGrid: () => { if (!sandbox.window.AppLibrary.renderNativeGrid?.(cells)) state.web++ }
  }
  vm.runInNewContext(source, sandbox)
  if (enabled) sandbox.renderGrid() // Exercise the pre-onLibraryReady cold-launch path too.
  sandbox.window.KalamosAppHooks.onLibraryReady()
  const flush = () => { let n = 0; while (frames.length) { assert.ok(n++ < 10, 'no RAF loop'); frames.shift()() } }
  flush()
  return { sandbox, state, calls, events, cells, flush,
    notify: () => { observers.forEach(fn => fn()); flush() },
    action: event => sandbox.window.KalamosNotesNativeShelf.action(event),
    latest: () => calls.filter(c => c.method.endsWith('present')).at(-1)?.args }
}

test('native shelf sends only the visible card identities and CSS geometry, with direct folder members', () => {
  const h = setup()
  assert.equal(h.state.web, 0)
  const page = h.latest()
  assert.equal(page.cards.length, 2)
  assert.equal(page.cards[0].thumbnail, 'a')
  assert.equal(page.cards[1].slots[0].thumbnail, 'child')
  assert.equal(page.cardWidth, 150)
  assert.equal(page.y, 48)
  assert.ok(page.cards[0].x >= 16)
  assert.equal(h.calls.some(c => /thumbnail|ink|snapshot/i.test(c.method)), false)
})

test('old view callbacks are rejected after pagination and only the current identity opens', () => {
  const h = setup(), old = h.latest().revision
  h.cells[0] = { kind: 'notebook', data: { notebookId: 'b', title: 'B' } }
  h.sandbox.renderGrid()
  h.action({ revision: old, index: 0, kind: 'open' })
  assert.equal(h.events.length, 0, 'old card cannot open the new identity before the next paint')
  h.flush()
  h.action({ revision: old, index: 0, kind: 'open' })
  assert.equal(h.events.length, 0)
  h.action({ revision: h.latest().revision, index: 0, kind: 'open' }); h.flush()
  assert.deepEqual(h.events, [['open', 'b']])
  assert.equal(h.calls.at(-1).method, 'notes.shelf.hide')
})

test('dialogs, selection and editor entry retire native hit targets and restore the web shelf', () => {
  for (const mode of ['dialog', 'selection', 'editor']) {
    const h = setup(), revision = h.latest().revision
    h.state[mode] = true; h.notify()
    assert.equal(h.calls.at(-1).method, 'notes.shelf.hide')
    assert.ok(h.state.web > 0)
    h.action({ revision, index: 0, kind: 'open' })
    assert.equal(h.events.length, 0)
    h.state[mode] = false; h.notify()
    assert.ok(h.latest().revision > revision)
  }
})

test('long press delegates existing context actions and selection, without opening a notebook', () => {
  const h = setup()
  h.action({ revision: h.latest().revision, index: 0, kind: 'context', x: 40, y: 90 }); h.flush()
  assert.equal(h.events[0][0], 'context')
  assert.equal(h.events[0][3].notebookId, 'a')
  assert.equal(h.calls.at(-1).method, 'notes.shelf.hide')
})

test('thumbnail completion republishes even when card identities and layout are unchanged', () => {
  const h = setup(), revision = h.latest().revision
  h.sandbox.window.onThumbnailReady('a'); h.flush()
  assert.ok(h.latest().revision > revision)
})

test('native failure restores ordinary web rendering and unsupported builds install no observers', () => {
  const h = setup()
  h.sandbox.window.KalamosNotesNativeShelf.fallback(); h.flush()
  assert.ok(h.state.web > 0)
  assert.equal(h.calls.at(-1).method, 'notes.shelf.hide')
  const unsupported = setup(false)
  assert.equal(unsupported.sandbox.window.AppLibrary.renderNativeGrid, undefined)
  assert.equal(unsupported.latest(), undefined)
})

test('folder drag delegates the canonical move transaction, including moving to the parent', () => {
  const h = setup()
  h.action({ revision: h.latest().revision, index: 0, destination: 1, kind: 'move' })
  assert.equal(h.events[0][2], 'f')
  h.sandbox.activeFolderId = 'f'
  h.action({ revision: h.latest().revision, index: 0, kind: 'moveParent' })
  assert.equal(h.events[1][2], 'parent')
})
