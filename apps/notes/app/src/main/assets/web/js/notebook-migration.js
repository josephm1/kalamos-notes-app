// Notes-only upgrade seam. Original metadata and page vectors remain recoverable;
// conversion never recognises handwriting, changes coordinates, or clears native ink.
(function () {
  'use strict'
  window.KalamosNotesMigration = {
    ensure: function (id) {
      const nb = Storage.loadMeta(id)
      if (!nb) throw new Error('Notebook metadata is unavailable')
      if (nb.kind === 'planning') return nb
      const editor = window.KalamosWriteWorkspace
      if (!editor || !editor.convertLegacyPage) throw new Error('Writing converter is unavailable')
      if (!Array.isArray(nb.pages) || !nb.pages.length) throw new Error('Notebook has no pages')
      const originals = nb.pages.map(function (page) {
        // Strict parsing is intentional: a corrupt page must not become an empty successful upgrade.
        const strokes = page.strokes === null ? JSON.parse(Storage.loadPageRaw(id, page.pageId)) : page.strokes
        return Object.assign({}, page, {strokes: strokes})
      })
      const converted = originals.map(function (page) { return editor.convertLegacyPage(page, nb.title) })
      function save(file, value) {
        if (Bridge.saveNotebookFile(id, file, typeof value === 'string' ? value : JSON.stringify(value)) !== 'ok')
          throw new Error('Cannot save ' + file + '; original notebook has been retained')
      }
      // Commit order is part of the data-loss contract. Backup first, all sheets next,
      // index next, discriminator last. A failed save keeps the legacy route eligible
      // for a retry; the original page files are never overwritten by this conversion.
      if (!Bridge.getNotebookFile(id, 'handwriting.backup.json'))
        save('handwriting.backup.json', {version:1, meta:JSON.parse(Bridge.loadMeta(id)), pages:originals})
      const index = {version:1,active:0,pages:[]}
      converted.forEach(function (sheet, i) {
        const page = i === 0 ? {id:'first',sourceFile:'planning.write2.md',sidecarFile:'planning.write2.json'}
          : {id:'legacy'+i,sourceFile:'planning.page-legacy'+i+'.md',sidecarFile:'planning.page-legacy'+i+'.json'}
        save(page.sourceFile, sheet.source)
        save(page.sidecarFile, sheet.sidecar)
        index.pages.push(page)
      })
      save('planning.pages.json', index)
      nb.kind = 'planning'
      nb.defaultTemplate = {type:'blank',spacing:0,margin:0}
      nb.pages = nb.pages.map(function (p) { return {pageId:p.pageId,template:nb.defaultTemplate,strokes:null} })
      if (!Storage.saveNotebook(nb)) throw new Error('Notebook upgrade could not be committed; original pages retained')
      console.info('[notes-upgrade] unified notebook', id, 'pages', index.pages.length,
        'strokes', originals.reduce(function (n,p) { return n+p.strokes.length },0))
      return nb
    }
  }
})()
