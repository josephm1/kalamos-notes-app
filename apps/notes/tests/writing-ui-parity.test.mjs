import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
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
