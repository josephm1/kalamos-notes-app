import ts from 'typescript'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true }
const reached = new Set()
function visit(file) {
  file = resolve(file)
  if (reached.has(file) || !existsSync(file)) return
  reached.add(file)
  for (const entry of ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles) {
    if (!entry.fileName.startsWith('.')) continue
    const dependency = ts.resolveModuleName(entry.fileName, file, options, ts.sys).resolvedModule
    if (dependency) visit(dependency.resolvedFileName)
  }
}

// Both Android providers use the same entry. Browser QA must exercise that same editor.
visit(join(root, 'src/kalamos/entry.ts'))
visit(join(root, 'src/vanilla/browser-entry.ts'))
for (const file of readdirSync(join(root, 'tools'))) {
  if (file.endsWith('.ts')) visit(join(root, 'tools', file))
}
const unused = []
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) inspect(file)
    else if (/\.tsx?$/.test(file) && !/\.(test|d)\.tsx?$/.test(file) && !reached.has(file)) {
      unused.push(relative(root, file))
    }
  }
}
inspect(join(root, 'src'))
if (unused.length) {
  throw new Error(`Source has no current Android, browser or QA-tool consumer:\n${unused.join('\n')}`)
}
console.log('Writing source graph: every production module has a current consumer.')
