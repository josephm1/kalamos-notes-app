import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const repo = new URL('../../../', import.meta.url)
const read = path => readFileSync(new URL(path, repo), 'utf8')

test('Notes exposes its launcher, generic Markdown share target and document boundary without retired Agent endpoints', () => {
  const manifest = read('apps/notes/app/src/main/AndroidManifest.xml')
  assert.match(manifest, /android:name="\.KalamosApp"/)
  assert.equal([...manifest.matchAll(/<activity\s/g)].length, 3)
  assert.match(manifest, /android:name="\.sharing.MarkdownImportActivity"/)
  for(const mime of ['text/plain','text/markdown','text/x-markdown'])assert.ok(manifest.includes(mime))
  assert.doesNotMatch(manifest, /com\.kalamos\.agent|PICK_NOTE|IMPORT_NOTE|NotePickerActivity|NoteImportActivity/)
  for (const file of ['NotePickerActivity.kt', 'NoteImportActivity.kt', 'AgentWriting.kt']) {
    assert.equal(existsSync(new URL(`apps/notes/app/src/main/java/com/kalamos/notebook/exchange/${file}`, repo)), false)
  }
})

test('Notes startup and shelf contain no Agent routes or placeholder sync promises', () => {
  for (const file of ['app-overlay.js', 'notes-selection.js']) {
    assert.doesNotMatch(read(`apps/notes/app/src/main/assets/web/js/${file}`),
      /notes\.agent\.|KalamosNotesAgent|agent-writing|Send (?:a note )?to Agent|Sync status/)
  }
  assert.equal(existsSync(new URL('apps/notes/app/src/main/assets/web/js/agent-writing.js', repo)), false)
})

test('Notes keeps formatter configuration app-owned and exposes no general network/secret bridge', () => {
  const bridge = read('apps/notes/app/src/main/java/com/kalamos/notebook/app/AppBridgeFactory.kt')
  assert.match(bridge, /LocalAppBridge\(/)
  assert.doesNotMatch(bridge, /CoreAppBridge|notes\.agent\.|Intent\.parseUri|args\.getString\("(?:package|component|action)"\)/)
  const local = read('foundation/android-runtime/src/main/java/com/kalamos/notebook/app/LocalAppBridge.kt')
  assert.match(local, /"hwr.recognize"/)
  assert.doesNotMatch(local, /KalamosAiConfig|Secrets|HttpStreamer|WsClient|"ai\.config|"secret\.|"http\.|"ws\./)
  const build = read('apps/notes/app/build.gradle.kts')
  assert.doesNotMatch(build, /ZAI_API_KEY|BookConverter\/\.env/)
})


test('Format with AI owns its worker and has no external broadcast result dependency',()=>{
 const processing=read('apps/notes/app/src/main/java/com/kalamos/notebook/exchange/NotesBackgroundProcessing.kt')
 assert.doesNotMatch(processing,/sendBroadcast|grantUriPermission|processingPackage|NotesProcessReceiver|FileProvider/)
 const manifest=read('apps/notes/app/src/main/AndroidManifest.xml')
 assert.doesNotMatch(manifest,/NotesProcessResultReceiver|PROCESS_RESULT/)
 const worker=read('apps/notes/app/src/main/java/com/kalamos/notebook/ai/NotesFormattingWorker.kt')
 assert.match(worker,/enqueueUniqueWork/);assert.match(worker,/ExistingWorkPolicy.KEEP/)
 const formatter=read('apps/notes/app/src/main/java/com/kalamos/notebook/ai/NotesAiFormatter.kt')
 assert.match(formatter,/NotesAiSettings.Provider/);assert.doesNotMatch(formatter,/com\.newoether|KalamosAiConfig|startActivity|sendBroadcast/)
})
