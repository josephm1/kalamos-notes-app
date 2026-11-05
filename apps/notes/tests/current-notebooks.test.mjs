import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const root = new URL('../', import.meta.url)
const overlay = readFileSync(new URL('app/src/main/assets/web/js/app-overlay.js', root), 'utf8')
const handler = overlay.slice(overlay.indexOf('    openNotebook: function (id) {'), overlay.indexOf('    onNewIntent:'))

test('only current notebooks reach the canonical editor; unsupported records are never rewritten', () => {
  for (const meta of [null, { kind: 'handwriting' }, {}, { kind: 'planning' }]) {
    const opened = [], errors = []
    const mode = runInNewContext('({' + handler + '})', {
      Storage: { loadMeta: () => meta },
      planningEditor: () => ({ openWorkspaceNotebook: id => opened.push(id) }),
      toast: error => errors.push(error),
    })
    assert.equal(mode.openNotebook('note'), true)
    assert.deepEqual(opened, meta?.kind === 'planning' ? ['note'] : [])
    assert.equal(errors.length, meta?.kind === 'planning' ? 0 : 1)
  }
})

test('Notes ships no retired handwriting upgrade or embedded restoration path', () => {
  assert.equal(existsSync(new URL('app/src/main/assets/web/js/notebook-migration.js', root)), false)
  assert.doesNotMatch(overlay, /KalamosNotesMigration|convertLegacyPage|kalamos-planning:start/)
  assert.doesNotMatch(readFileSync(new URL('app/src/main/assets/web/js/agora-documents.js', root), 'utf8'), /KalamosNotesMigration/)
})
