// The notebook meta written to meta.json: all metadata + the page list (pageId + template), but NO
// strokes (those live in per-page files). Strips transient flags like page._dirty.
function buildMeta(nb) {
  const meta = {
    notebookId: nb.notebookId,
    title: nb.title,
    folderId: nb.folderId || '',
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    defaultTemplate: nb.defaultTemplate,
    pages: nb.pages.map(function(p) {
      // Interactive-format content rides in the (small) meta so it loads with the notebook; only
      // included when the page actually has blocks (plain pages stay byte-for-byte unchanged).
      const pm = { pageId: p.pageId, template: p.template }
      if (Array.isArray(p.blocks) && p.blocks.length) pm.blocks = p.blocks
      // Converted-handwriting text items ({x,y,size,text}) also ride in the meta — small, and
      // they must be present before the (lazy) strokes so the content bake shows them on open.
      if (Array.isArray(p.texts) && p.texts.length) pm.texts = p.texts
      return pm
    })
  }
  // Optional app-owned document discriminator (Scribe documents, Notes planning documents).
  // Preserve it generically so a normal metadata save cannot silently turn a niche document back
  // into a plain handwriting notebook.
  if (nb.kind) meta.kind = nb.kind
  return meta
}

// Parse a meta JSON string into a LAZY notebook: pages carry pageId + template but strokes=null
// (loaded on demand). Returns null if the meta is malformed.
function metaToNotebook(raw) {
  try {
    const m = JSON.parse(raw)
    if (m && m.notebookId && Array.isArray(m.pages)) {
      m.pages = m.pages.map(function(p) {
        return { pageId: p.pageId, template: p.template, strokes: null,
                 blocks: Array.isArray(p.blocks) ? p.blocks : null,
                 texts: Array.isArray(p.texts) ? p.texts : null }
      })
      return m
    }
  } catch (e) {}
  return null
}

// Library preload cache: notebookId → raw meta JSON string for the currently-visible notebooks.
const _metaCache = {}
const _thumbCache = {}
const _thumbnailCaptureWaiters = {}

function waitForThumbnailCapture(notebookId, onCaptured) {
  if (typeof onCaptured !== 'function') return
  const previous = _thumbnailCaptureWaiters[notebookId]
  if (previous) previous()
  let settled = false
  const finish = function() {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (_thumbnailCaptureWaiters[notebookId] === finish) {
      delete _thumbnailCaptureWaiters[notebookId]
    }
    onCaptured()
  }
  // Failure recovery only. Native normally releases ownership as soon as it has copied an
  // immutable bitmap, before compression and atomic disk replacement happen in the background.
  const timer = setTimeout(finish, 5000)
  _thumbnailCaptureWaiters[notebookId] = finish
}

// Native fires this after it has copied the final page into an immutable thumbnail bitmap, before
// background PNG encoding. Editor owners can now detach without clearing the state still needed by
// capture. The timeout installed below preserves navigation if an older bridge or a capture failure
// never reports completion.
window.onThumbnailCaptured = function(notebookId) {
  const finish = _thumbnailCaptureWaiters[notebookId]
  if (finish) finish()
}

const Storage = {

  saveLibrary(libraryIndex) {
    const json = JSON.stringify(libraryIndex)
    return Bridge.saveLibrary(json) === 'ok'
  },

  loadLibrary() {
    const raw = Bridge.loadLibrary()
    try {
      const data = JSON.parse(raw)
      if (data && data.version && Array.isArray(data.notebooks)) {
        return data
      }
    } catch (e) {}
    return { version: 1, notebooks: [], folders: [] }
  },

  // Per-page storage: meta.json (metadata + page list) + pages/<pageId>.json (one page's strokes).
  // A save rewrites only the changed page(s) + the tiny meta, never the whole notebook.

  // Full save — writes every LOADED page + meta. For create/duplicate where the model is fresh.
  // Unloaded (lazy, strokes===null) pages are skipped so their on-disk files are never clobbered.
  saveNotebook(notebook) {
    notebook.updatedAt = nowISO()
    for (const page of notebook.pages) {
      if (page.strokes === null) continue
      if (Bridge.savePage(notebook.notebookId, page.pageId, JSON.stringify(page.strokes)) !== 'ok') return false
      page._dirty = false
    }
    delete _metaCache[notebook.notebookId]   // the library preload cache is now stale — force a fresh read
    const saved = Bridge.saveMeta(notebook.notebookId, JSON.stringify(buildMeta(notebook))) === 'ok'
    if (saved && typeof window.onNotebookSaved === 'function') window.onNotebookSaved(notebook.notebookId, notebook.updatedAt)
    return saved
  },

  // Incremental save — writes only pages flagged page._dirty + the (tiny) meta. The hot autosave path.
  saveNotebookDirty(notebook) {
    notebook.updatedAt = nowISO()
    for (const page of notebook.pages) {
      if (page._dirty && page.strokes !== null) {
        if (Bridge.savePage(notebook.notebookId, page.pageId, JSON.stringify(page.strokes)) !== 'ok') return false
        page._dirty = false
      }
    }
    delete _metaCache[notebook.notebookId]   // invalidate the stale library preload cache after a save
    // meta always written (covers updatedAt, page add/delete/reorder, template, title) — it's tiny
    const saved = Bridge.saveMeta(notebook.notebookId, JSON.stringify(buildMeta(notebook))) === 'ok'
    if (saved && typeof window.onNotebookSaved === 'function') window.onNotebookSaved(notebook.notebookId, notebook.updatedAt)
    return saved
  },

  // Lazy open: load the meta (migrates a legacy notebook on demand) → notebook with strokes=null pages.
  loadMeta(notebookId) {
    const raw = Bridge.loadMeta(notebookId)
    return raw === 'null' ? null : metaToNotebook(raw)
  },

  // Read ONE page's raw JSON (no parse) — cheap; used to size-check a page before deciding whether to
  // render its strokes immediately or defer (template-first) for a heavy page.
  loadPageRaw(notebookId, pageId) {
    const raw = Bridge.loadPage(notebookId, pageId)
    return (raw === null || raw === undefined) ? '[]' : raw
  },

  // Parse a raw strokes JSON string into an array.
  parseStrokes(raw) {
    try { const s = JSON.parse(raw); if (Array.isArray(s)) return s } catch (e) {}
    return []
  },

  // Load ONE page's strokes (read + parse).
  loadPageStrokes(notebookId, pageId) {
    return this.parseStrokes(this.loadPageRaw(notebookId, pageId))
  },

  // Library preload: cache an already-migrated notebook's tiny meta (no migration → cheap; a legacy
  // notebook returns null and just migrates later on its first real open).
  preloadMeta(notebookId) {
    const raw = Bridge.peekMeta(notebookId)
    if (raw !== 'null') _metaCache[notebookId] = raw; else delete _metaCache[notebookId]
  },

  // Take the preloaded meta as a fresh lazy notebook (parsed each call so the cache isn't mutated).
  takeCachedMeta(notebookId) {
    const raw = _metaCache[notebookId]
    return raw ? metaToNotebook(raw) : null
  },

  // Native ships the raw on-disk JSON; V8 here does the single parse (org.json on the native side
  // was the cold-open bottleneck).
  loadNotebook(notebookId) {
    const raw = Bridge.loadNotebookRaw(notebookId)
    if (raw === 'null') return null
    try {
      const data = JSON.parse(raw)
      if (validateNotebook(data)) return data
    } catch (e) {}
    return null
  },

  deleteNotebook(notebookId) {
    return Bridge.deleteNotebook(notebookId) === 'ok'
  },

  // Capture the thumbnail from the NATIVE ink surface (the true display); the web canvas is stale
  // because writing goes only to the surface. Native crops the paper region + scales + saves.
  saveThumbnail(notebookId, onCaptured) {
    delete _thumbCache[notebookId]
    waitForThumbnailCapture(notebookId, onCaptured)
    Bridge.captureThumbnail(notebookId)
  },

  // Standard Android's page is authoritative in the WebView, so capture that exact paper region
  // instead of consulting the deliberately hidden native SurfaceView.
  saveWebThumbnail(notebookId, left, top, right, bottom, onCaptured) {
    delete _thumbCache[notebookId]
    waitForThumbnailCapture(notebookId, onCaptured)
    Bridge.captureWebThumbnail(notebookId, left, top, right, bottom)
  },

  // Save a small, already-rendered PNG. Classic Standard Handwriting uses this deterministic
  // model renderer because Android WebView.draw() can omit hardware-backed canvas pixels.
  saveRenderedThumbnail(notebookId, dataUrl) {
    delete _thumbCache[notebookId]
    const saved = Bridge.saveThumbnailDataUrl(notebookId, dataUrl) === 'ok'
    if (saved && typeof window.onThumbnailReady === 'function') window.onThumbnailReady(notebookId)
    console.info('[notes-thumbnail] model write ' + (saved ? 'ready' : 'failed'))
    return saved
  },

  getThumbnailUrl(notebookId) {
    if (Object.prototype.hasOwnProperty.call(_thumbCache, notebookId)) return _thumbCache[notebookId]
    const url = Bridge.getThumbnailDataUrl(notebookId)
    _thumbCache[notebookId] = url || ''
    return _thumbCache[notebookId]
  },

  invalidateThumbnail(notebookId) {
    delete _thumbCache[notebookId]
  }
}
