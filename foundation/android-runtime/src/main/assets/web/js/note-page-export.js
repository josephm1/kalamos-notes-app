// Bounded local attachment export from the canonical writing workspace. No ink or snapshot ownership.
(function (root) {
  'use strict'
  async function raster(svg) {
    var parsed = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
    var view = (parsed.getAttribute('viewBox') || '0 0 572 772').split(/[ ,]+/).map(Number)
    var width = view[2], height = view[3]
    if (!(width > 0 && height > 0)) throw new Error('Invalid exported page size')
    var scale = Math.min(2, 1200 / width, 2000 / height)
    var canvas = document.createElement('canvas'); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale)
    var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
      var image = new Image()
      await new Promise(function (resolve, reject) { image.onload = resolve; image.onerror = function () { reject(new Error('Could not render notebook page')) }; image.src = url })
      var ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      var result = canvas.toDataURL('image/jpeg', .9)
      if (result.length > 1000000) throw new Error('A notebook page is too large to attach')
      return result
    } finally { URL.revokeObjectURL(url) }
  }
  async function parts(editor, id) {
    var pages = await editor.exportNotebookPages(id)
    if (pages.length > 32) throw new Error('Attach a notebook with at most 32 pages')
    var sheets = await editor.getNotebookSheets(id)
    var text = sheets.map(function (s) { return s.source.replace(/\u200b/g, '').trim() }).filter(Boolean).join('\n\n')
    if (text.length > 1000000) throw new Error('The notebook text is too large to attach')
    var parts = []
    if (text) parts.push({ kind: 'markdown', content: text })
    for (var i = 0; i < pages.length; i++) parts.push({ kind: 'image-ref', content: await raster(pages[i]), page: i + 1 })
    if (!parts.length) parts.push({ kind: 'text', content: 'Empty Notes notebook' })
    return parts
  }
  root.KalamosNoteExport = Object.freeze({ parts: parts })
})(window)
