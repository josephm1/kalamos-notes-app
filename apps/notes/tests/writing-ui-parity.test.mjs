import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import {createRequire} from 'node:module'
const {JSDOM}=createRequire(new URL('../../../features/writing/workspace/package.json',import.meta.url))('jsdom')
const repo = new URL('../../../', import.meta.url)
const read = path => readFileSync(new URL(path, repo), 'utf8')
test('Notes uses the feature-owned writing presentation after base styles', () => {
  const loader = read('apps/notes/app/src/main/assets/web/js/app-overlay.js')
  assert.ok(loader.indexOf('css/notes-writing-ui.css') > loader.indexOf('css/write-workspace.css'))
  assert.doesNotMatch(read('apps/notes/app/src/main/assets/web/css/app-overlay.css'), /#kalamos-write-workspace-root/)
  const css = read('features/writing/workspace/src/kalamos/notes-writing-ui.css')
  assert.match(css, /\.toolbar-collapsed/)
  assert.match(css, /\.toolbar-all-tools/)
  assert.match(css, /\.rw-tool-menu/)
  assert.match(css, /\.pen-settings-brushes/)
  assert.match(read('features/writing/workspace/scripts/build-android.sh'), /install -m 0644 src\/kalamos\/notes-writing-ui\.css/)
})

test('shared monochrome glyphs render actual SVG in Notes', () => {
  const window = {}
  runInNewContext(read('foundation/android-runtime/src/main/assets/web/js/toolbar-icons.js'), {window})
  for (const name of ['pen','eraser','undo','redo','text','prev','next','grid','keyboard','handle']) {
    assert.match(window.KalamosToolbarIcons.svg(name), /<svg.*<(?:path|rect)/)
    assert.doesNotMatch(window.KalamosToolbarIcons.svg(name), /undefined/)
  }
  const shell = read('foundation/android-runtime/src/main/assets/web/app.html')
  assert.ok(shell.indexOf('js/toolbar-icons.js') < shell.indexOf('js/app-overlay.js'))
  assert.doesNotMatch(read('apps/notes/app/src/main/assets/web/js/app-overlay.js'), /js\/toolbar-icons\.js/)
})

test('compact toolbar exposes Add page and horizontal spacing without exposing expanded tools',()=>{
  const actions=['write','erase','select','pointer','page-add','page--1','page-1','pages']
  const rail=['undo','redo','spacing','document-action','document-action-1','magnify','insert-text']
  const buttons=items=>items.map(action=>`<button data-action="${action}" class="${rail.includes(action)?'toolbar-more':''}"></button>`).join('')
  const dom=new JSDOM(`<style>${read('features/writing/workspace/src/vanilla/eink.css')}\n${read('features/writing/workspace/src/kalamos/notes-writing-ui.css')}</style><div id="kalamos-write-workspace-root"><div class="tool-pill"><div class="toolbar-core">${buttons(actions)}</div><div class="toolbar-more-rail">${buttons(rail)}</div></div></div>`)
  try {
    for(const action of ['write','erase','select','pointer','page-add','undo','spacing','document-action'])assert.notEqual(dom.window.getComputedStyle(dom.window.document.querySelector(`[data-action="${action}"]`)).display,'none',action)
    for(const action of ['page--1','page-1','pages','redo','document-action-1','magnify','insert-text'])assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(`[data-action="${action}"]`)).display,'none',action)
  } finally {dom.window.close()}
})

test('a positioned collapsed tab has a complete outline and rounded corners on both sides',()=>{
  const dom=new JSDOM(`<style>${read('features/writing/workspace/src/kalamos/notes-writing-ui.css')}</style><div id="kalamos-write-workspace-root"><div class="tool-pill toolbar-collapsed toolbar-positioned"></div></div>`)
  try {
    const style=dom.window.getComputedStyle(dom.window.document.querySelector('.tool-pill'))
    assert.equal(style.borderLeftWidth,'1px');assert.equal(style.borderLeftStyle,'solid')
    assert.equal(style.borderRightWidth,'1px');assert.equal(style.borderRadius,'8px')
  }finally{dom.window.close()}
})
