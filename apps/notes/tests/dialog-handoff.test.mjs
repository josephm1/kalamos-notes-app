import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../../foundation/android-runtime/src/main/assets/web/js/editor-controller.js', import.meta.url), 'utf8')
function session() {
  const calls = [], flushes = [], frames = []
  const context = {
    window: {}, inkSdkActive: true, console: { log() {} },
    Bridge: {
      setInkEnabled: value => calls.push(['input', value]),
      setInteractivePanel: value => calls.push(['web', value]),
      detachInkBoxForWeb: () => calls.push(['detach']),
    },
    flushNativeThen: cb => flushes.push(cb),
    renderPageContent: () => calls.push(['content']),
    showStandardEditorHandoff: () => calls.push(['preview']),
    hideStandardEditorHandoff: () => calls.push(['hide']),
    needsStandardEditorHandoff: () => false,
    currentPage: () => ({ strokes: ['saved final stroke'] }),
    requestAnimationFrame: cb => frames.push(cb),
    attachInkWhenReady: () => calls.push(['attach']),
  }
  vm.createContext(context)
  vm.runInContext(source.slice(source.indexOf('let editorWebInputActive = false'), source.indexOf('// Floating drawing chrome')), context)
  return { ...context, calls, flushes, frames }
}
test('classic dialogs flush and preserve ink before the WebView takes ownership', () => {
  const s = session(); let page
  s.window.KalamosEditorWebDialog.begin(p => { page = p })
  assert.equal(s.calls.some(c => c[0] === 'detach'), false)
  s.flushes.shift()(); s.frames.shift()()
  assert.equal(page.strokes[0], 'saved final stroke')
  assert.deepEqual(s.calls.map(c => c[0]), ['input', 'content', 'preview', 'web', 'detach'])
  s.window.KalamosEditorWebDialog.end()
  assert.deepEqual(s.calls.at(-1), ['attach'])
})
test('text and dialogs retain WebView ownership until both are closed', () => {
  const s = session()
  s.window.KalamosEditorWebDialog.begin()
  s.flushes.shift()(); s.frames.shift()()
  s.window.KalamosEditorTextInput.begin(() => {})
  s.window.KalamosEditorWebDialog.end()
  assert.equal(s.calls.some(c => c[0] === 'attach'), false)
  s.window.KalamosEditorTextInput.end()
  assert.equal(s.calls.filter(c => c[0] === 'detach').length, 1)
  assert.equal(s.calls.filter(c => c[0] === 'attach').length, 1)
})
test('a dismissed dialog cannot detach from a delayed flush or frame', () => {
  for (const afterFlush of [false, true]) {
    const s = session()
    s.window.KalamosEditorWebDialog.begin()
    if (afterFlush) s.flushes.shift()()
    s.window.KalamosEditorWebDialog.end()
    s.flushes.forEach(cb => cb()); s.frames.forEach(cb => cb())
    assert.equal(s.calls.some(c => ['attach', 'detach'].includes(c[0])), false)
    assert.deepEqual(s.calls.at(-1), ['input', true])
  }
})
