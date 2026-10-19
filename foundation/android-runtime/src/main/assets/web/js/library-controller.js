let libraryData = null
let activeFolderId = ''
let contextMenuEl = null
let libraryPage = 0
let libraryAppTitle = 'Kalamos'   // captured once at start (App.applyConfig already set the header by then)
let importBtnEl = null   // sideload Import button (AD-7/WP12) — created once, shown conditionally

function ensureClassicLibraryShell() {
  if (window.AppLibrary && typeof window.AppLibrary.render === 'function') return
  const view = document.getElementById('library-view')
  if (!view || document.getElementById('header')) return
  view.innerHTML =
    '<div id="header">' +
      '<button id="btn-folder-back" class="btn" title="Back" style="display:none">&#8249;</button>' +
      '<h1 id="header-title">Kalamos</h1>' +
      '<button id="btn-settings" class="btn" title="Settings">&#9881;</button>' +
    '</div>' +
    (folderBarEnabled() ? '<div id="folder-bar"></div>' : '') +
    '<div id="grid"></div>' +
    '<div id="pagination">' +
      '<span id="page-totals" class="totals"></span>' +
      '<div id="pager-controls" class="pager-controls"></div>' +
    '</div>' +
    '<div id="empty-state" style="display:none">' +
      '<div class="icon">&#128196;</div>' +
      '<div class="text">No notes yet — tap + to create</div>' +
    '</div>'
}

function initLibrary() {
  ensureClassicLibraryShell()
  const settingsBtn = document.getElementById('btn-settings')
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings)
  const backBtn = document.getElementById('btn-folder-back')
  if (backBtn) backBtn.addEventListener('click', libraryNavigateUp)
  const titleEl = document.getElementById('header-title')
  const cfg = window.KalamosConfig || {}
  libraryAppTitle = cfg.libraryTitle || cfg.title || (titleEl && titleEl.textContent) || 'Kalamos'
  if (titleEl) titleEl.textContent = libraryAppTitle
  buildImportButton()
  loadLibrary()
  // Silent background sideload check on every library launch. Fire-and-forget: onBookScanDone
  // (below) only disturbs the grid when it actually finds something to import.
  if (Bridge.scanForNewBooks) Bridge.scanForNewBooks()
}

// ============== SIDELOAD IMPORT (AD-7/WP12) ==============

// A subtle circled glyph next to Settings — hairline `.btn` styling is already circular in the
// header (library.css `#header .btn`), so this just needs the right icon + gating. Shown in a
// "books" context: this app's own default mode (Books), or — defensively, for a mixed-content
// library — any library that already has at least one book card. Never shown in a plain notes
// build with no books at all.
function buildImportButton() {
  const header = document.getElementById('header')
  const settingsBtn = document.getElementById('btn-settings')
  if (!header || !settingsBtn || !Bridge.scanForNewBooks) return
  importBtnEl = document.createElement('button')
  importBtnEl.id = 'btn-import'
  importBtnEl.className = 'btn'
  importBtnEl.title = 'Import books'
  importBtnEl.innerHTML = '&#10515;'   // ⤓ — downwards arrow to bar (import glyph)
  importBtnEl.style.display = 'none'
  importBtnEl.addEventListener('click', function() {
    if (!Bridge.pickBooksToImport || !Bridge.pickBooksToImport()) Bridge.scanForNewBooks()
  })
  header.insertBefore(importBtnEl, settingsBtn)
}

function importButtonVisible() {
  const cfg = window.KalamosConfig || {}
  if (cfg.defaultMode === 'library') return true
  return !!(libraryData && libraryData.notebooks.some(function(n) {
    return !!bookFormat(peekCardMeta(n.notebookId))
  }))
}

// Native callback (WP12): a new import or metadata backfill invalidates the cheap card-meta cache
// and reloads the library. A true zero-result scan remains a silent no-op.
window.onBookScanDone = function(resultJson) {
  let result = null
  try { result = JSON.parse(resultJson) } catch (e) {}
  if (result && (result.imported > 0 || result.updated > 0)) {
    invalidateCardMeta()
    loadLibrary()
  }
}

// ============== SETTINGS / STORAGE ==============

function fmtBytes(b) {
  b = b || 0
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB'
  return b + ' B'
}

let settingsBody = null   // the open Settings panel body, so a folder pick can refresh it

function openSettings() {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modal = document.createElement('div')
  modal.className = 'modal'

  const h3 = document.createElement('h3')
  h3.textContent = 'Storage'
  modal.appendChild(h3)

  const body = document.createElement('div')
  body.className = 'storage-body'
  modal.appendChild(body)
  settingsBody = body

  // --- Reading (global) ---
  const rh = document.createElement('h3')
  rh.textContent = 'Reading'
  rh.style.marginTop = '18px'
  modal.appendChild(rh)
  const rbody = document.createElement('div')
  rbody.className = 'storage-body'
  const row = document.createElement('label')
  row.className = 'reading-toggle'
  const cb = document.createElement('input')
  cb.type = 'checkbox'
  cb.checked = !(localStorage.getItem('kal.reader.showClock') === '0')
  cb.addEventListener('change', function() {
    localStorage.setItem('kal.reader.showClock', cb.checked ? '1' : '0')
    if (window.BookReader && BookReader._clock) BookReader.applyClockSetting()
  })
  const lbl = document.createElement('span')
  lbl.textContent = 'Show clock & page number while reading'
  row.appendChild(cb)
  row.appendChild(lbl)
  rbody.appendChild(row)
  modal.appendChild(rbody)

  const actions = document.createElement('div')
  actions.className = 'modal-actions'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'btn'
  closeBtn.textContent = 'Close'
  closeBtn.addEventListener('click', function() { overlay.remove(); settingsBody = null })
  actions.appendChild(closeBtn)
  modal.appendChild(actions)

  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  renderStorageSettings(body)
}

function renderStorageSettings(body) {
  body.innerHTML = ''
  let info
  try { info = JSON.parse(Bridge.getStorageInfo()) } catch (e) { info = {} }

  const usage = document.createElement('div')
  usage.className = 'storage-usage'
  usage.textContent = 'Your notes use ' + fmtBytes(info.dataSize)
  body.appendChild(usage)

  const curLbl = document.createElement('div')
  curLbl.className = 'storage-current-label'
  curLbl.textContent = 'Current location'
  body.appendChild(curLbl)
  const curPath = document.createElement('div')
  curPath.className = 'storage-current-path'
  curPath.textContent = info.currentPath || ''
  body.appendChild(curPath)

  // Books has one stable device-visible root because Learn and Play consume that exact catalogue.
  if (!info.fixedStorage) {
    const chooseBtn = document.createElement('button')
    chooseBtn.className = 'btn storage-action'
    chooseBtn.textContent = 'Choose folder…'
    chooseBtn.addEventListener('click', function() {
      if (!info.hasAllFilesAccess) {
        showConfirm('Permission needed',
          'Choosing a folder (e.g. on the SD card) needs "All files access". Grant it in settings, then come back and choose again.',
          function() { Bridge.requestAllFilesAccess() })
        return
      }
      Bridge.pickStorageFolder()
    })
    body.appendChild(chooseBtn)
  }

  // Reset to internal storage (only shown when not already internal).
  const internal = (info.locations || []).find(function(l) { return l.label === 'Internal storage' })
  if (internal && !internal.current) {
    const resetBtn = document.createElement('button')
    resetBtn.className = 'btn storage-action'
    resetBtn.textContent = 'Use internal storage'
    resetBtn.addEventListener('click', function() {
      body.innerHTML = '<div class="storage-usage">Moving notes… please wait.</div>'
      setTimeout(function() {
        const res = Bridge.setStorageLocation(internal.path)
        Bridge.showToast(res === 'ok' ? 'Notes moved to internal storage' : 'Move failed (' + res + ')')
        if (res === 'ok') loadLibrary()
        renderStorageSettings(body)
      }, 60)
    })
    body.appendChild(resetBtn)
  }

  // Screen rotation (auto-rotate / accelerometer) toggle.
  const rotLabel = document.createElement('div')
  rotLabel.className = 'storage-current-label'
  rotLabel.textContent = 'Screen rotation'
  body.appendChild(rotLabel)
  const rotBtn = document.createElement('button')
  rotBtn.className = 'btn storage-action'
  const setRotLabel = function() {
    rotBtn.textContent = Bridge.isRotationLocked() ? 'Auto-rotate: OFF (tap to enable)' : 'Auto-rotate: ON (tap to lock)'
  }
  setRotLabel()
  rotBtn.addEventListener('click', function() {
    Bridge.setRotationLocked(!Bridge.isRotationLocked())
    setRotLabel()
  })
  body.appendChild(rotBtn)
}

// Called from native after the system folder picker returns + migration completes.
window.onStorageFolderPicked = function(status, path) {
  if (status === 'ok') {
    loadLibrary()
    if (settingsBody) renderStorageSettings(settingsBody)
    Bridge.showToast('Notes moved to ' + (path || 'new folder'))
  } else if (status === 'need_permission') {
    Bridge.requestAllFilesAccess()
    Bridge.showToast('Grant "All files access", then choose again')
  } else if (status === 'cancelled') {
    // user backed out — do nothing
  } else {
    Bridge.showToast('Could not use that folder (' + status + ')')
  }
}

function loadLibrary() {
  libraryData = Storage.loadLibrary()
  if (!libraryData.folders) libraryData.folders = []
  if (nestedFoldersEnabled()) normalizeFolderHierarchy()
  renderLibrary()
}

function saveLibrary() {
  if (nestedFoldersEnabled()) libraryData.version = Math.max(Number(libraryData.version) || 1, 2)
  invalidateCardMeta()   // library mutated (rename/move/delete/import) — drop cached card metas
  Storage.saveLibrary(libraryData)
}

function nestedFoldersEnabled() {
  return !!(window.KalamosConfig && window.KalamosConfig.nestedFolders)
}

// Some app shelves expose creation in their chrome instead of spending permanent content
// cells on them. Keep the shared default unchanged; Notes opts in explicitly through app config.
function creationCardsInGrid() {
  return !window.AppLibrary?.readOnly && !(window.KalamosConfig && window.KalamosConfig.libraryCreationInChrome)
}

function folderBarEnabled() {
  return !(window.KalamosConfig && window.KalamosConfig.libraryFolderBar === false)
}

function findFolder(folderId) {
  if (!folderId || !libraryData || !libraryData.folders) return null
  return libraryData.folders.find(function(folder) { return folder.folderId === folderId }) || null
}

// Header and Android Back share the same hierarchy step. Return false only at the root,
// allowing the app router to exit there. Custom app-owned shelves retain their own routing.
function libraryNavigateUp() {
  if (window.AppLibrary && typeof window.AppLibrary.render === 'function') return false
  if (!activeFolderId) return false
  const folder = findFolder(activeFolderId)
  activeFolderId = nestedFoldersEnabled() && folder ? folderParentId(folder) : ''
  libraryPage = 0
  renderLibrary()
  return true
}

function folderParentId(folder) {
  return folder && folder.parentFolderId ? folder.parentFolderId : ''
}

// Version-one libraries did not store a parent. Treat those folders as roots, repair dangling
// note/folder references, and break malformed cycles so every navigation path always reaches home.
function normalizeFolderHierarchy() {
  const known = {}
  libraryData.folders.forEach(function(folder) {
    if (folder && folder.folderId) known[folder.folderId] = folder
  })
  libraryData.folders.forEach(function(folder) {
    const parentId = folderParentId(folder)
    folder.parentFolderId = parentId && parentId !== folder.folderId && known[parentId] ? parentId : ''
  })
  libraryData.folders.forEach(function(folder) {
    const seen = {}
    let current = folder
    while (current && current.parentFolderId) {
      if (seen[current.folderId]) {
        folder.parentFolderId = ''
        break
      }
      seen[current.folderId] = true
      current = known[current.parentFolderId]
    }
  })
  libraryData.notebooks.forEach(function(notebook) {
    if (notebook.folderId && !known[notebook.folderId]) notebook.folderId = ''
  })
}

function childFolders(parentFolderId) {
  const parentId = parentFolderId || ''
  return libraryData.folders.filter(function(folder) {
    return folderParentId(folder) === parentId
  })
}

function folderPath(folder) {
  const path = []
  const seen = {}
  let current = folder
  while (current && !seen[current.folderId]) {
    path.unshift(current)
    seen[current.folderId] = true
    current = findFolder(folderParentId(current))
  }
  return path
}

function folderDisplayPath(folder) {
  return folderPath(folder).map(function(item) { return item.name }).join(' / ')
}

function descendantFolderIds(folderId) {
  const ids = []
  const pending = [folderId]
  while (pending.length) {
    const parentId = pending.shift()
    childFolders(parentId).forEach(function(folder) {
      if (ids.indexOf(folder.folderId) === -1) {
        ids.push(folder.folderId)
        pending.push(folder.folderId)
      }
    })
  }
  return ids
}

function renderLibrary() {
  if (window.AppLibrary && window.AppLibrary.render) return window.AppLibrary.render()
  renderHeader()
  renderFolderBar()
  renderGrid()
  renderEmptyState()
  if (window.AppLibrary?.onLibraryRendered) window.AppLibrary.onLibraryRendered()
}

// Home = plain title + settings + the folder-pill row. Inside a folder = a breadcrumb whose
// segments follow the stored hierarchy. Folder cards and New Folder remain in the content grid.
function renderHeader() {
  const titleEl = document.getElementById('header-title')
  const backBtn = document.getElementById('btn-folder-back')
  const bar = document.getElementById('folder-bar')
  if (!titleEl) return
  const folder = findFolder(activeFolderId)
  if (folder) {
    titleEl.className = 'crumb'
    titleEl.textContent = ''
    const app = document.createElement('span')
    app.textContent = libraryAppTitle
    app.dataset.dropFolderId = ''
    if (nestedFoldersEnabled()) {
      app.className = 'crumb-link'
      app.addEventListener('click', function(event) {
        event.stopPropagation()
        activeFolderId = ''
        libraryPage = 0
        renderLibrary()
      })
    }
    titleEl.appendChild(app)
    const path = nestedFoldersEnabled() ? folderPath(folder) : [folder]
    path.forEach(function(item, index) {
      const sep = document.createElement('span')
      sep.className = 'crumb-sep'
      sep.textContent = '/'
      titleEl.appendChild(sep)
      const name = document.createElement('span')
      name.textContent = item.name
      name.dataset.dropFolderId = item.folderId
      if (index < path.length - 1) {
        name.className = 'crumb-link'
        name.addEventListener('click', function(event) {
          event.stopPropagation()
          activeFolderId = item.folderId
          libraryPage = 0
          renderLibrary()
        })
      }
      titleEl.appendChild(name)
    })
    if (backBtn) backBtn.style.display = ''
    if (bar) bar.style.display = 'none'
  } else {
    titleEl.className = ''
    titleEl.textContent = libraryAppTitle
    if (backBtn) backBtn.style.display = 'none'
    if (bar) bar.style.display = ''
  }
  if (importBtnEl) importBtnEl.style.display = importButtonVisible() ? '' : 'none'
}

function renderFolderBar() {
  if (!folderBarEnabled()) return
  const bar = document.getElementById('folder-bar')
  bar.innerHTML = ''
  if (activeFolderId) return   // breadcrumb mode (renderHeader) replaces the pill row while inside a folder

  const allBtn = document.createElement('button')
  allBtn.className = 'folder-btn' + (activeFolderId === '' ? ' active' : '')
  allBtn.textContent = 'All'
  allBtn.addEventListener('click', function() { activeFolderId = ''; libraryPage = 0; renderLibrary() })
  bar.appendChild(allBtn)

  const visibleFolders = nestedFoldersEnabled() ? childFolders('') : libraryData.folders
  for (const f of visibleFolders) {
    const btn = document.createElement('button')
    btn.className = 'folder-btn' + (f.folderId === activeFolderId ? ' active' : '')
    btn.textContent = f.name

    const del = document.createElement('span')
    del.className = 'delete-fold'
    del.textContent = '×'
    del.addEventListener('click', function(e) {
      e.stopPropagation()
      showDeleteFolderConfirm(f)
    })
    btn.appendChild(del)

    btn.addEventListener('click', function() { activeFolderId = f.folderId; libraryPage = 0; renderLibrary() })
    btn.addEventListener('contextmenu', function(e) {
      e.preventDefault()
      showContextMenu(e.clientX, e.clientY, f)
    })
    bar.appendChild(btn)
  }

  const input = document.createElement('input')
  input.id = 'folder-input'
  input.type = 'text'
  input.placeholder = '+ folder'
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && this.value.trim()) {
      libraryData.folders.push(createFolder(this.value.trim(), ''))
      saveLibrary()
      this.value = ''
      renderLibrary()
    }
  })
  bar.appendChild(input)
}

// Paginating means only the visible page's thumbnails ever load, which keeps the grid light with
// many items AND keeps each render a single synchronous pass (streaming across frames breaks the
// e-ink refresh). Apps may configure the capacity; the neutral default remains the original 3x3.
function libraryItemsPerPage() {
  const configured = Number((window.KalamosConfig || {}).libraryPageSize)
  if (Number.isFinite(configured) && configured >= 1 && configured <= 100) {
    return Math.floor(configured)
  }
  return creationCardsInGrid() ? (nestedFoldersEnabled() ? 7 : 8) : 9
}

// Apps with a density control can change the shelf capacity without owning a second paginator.
// Reset to the first page because the old page number may not exist at the new capacity.
function setLibraryPageSize(size) {
  const parsed = Math.floor(Number(size))
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) return false
  window.KalamosConfig = window.KalamosConfig || {}
  window.KalamosConfig.libraryPageSize = parsed
  libraryPage = 0
  renderGrid()
  return true
}

// Bridge.peekMeta is the same cheap, non-migrating, synchronous read used for the library preload
// cache — but read straight from the raw JSON (not via Storage.metaToNotebook, which requires a
// `pages` array and would reject book metas that have none). Cheap enough to call per visible cell.
// Per-session cache of the cheap card meta (format / bookRef / readingProgress). peekMeta is a
// synchronous JS-bridge file read (~58ms each) and the grid re-reads every visible card on every
// render — 525ms for 9 cards — even when returning from a reader where only ONE book's progress
// changed. Cache it and invalidate just the affected id (see invalidateCardMeta), so re-renders
// (back to library, folder switch, list/grid toggle) don't pay the whole read again.
const _cardMetaCache = {}
function invalidateCardMeta(notebookId) {
  if (notebookId) delete _cardMetaCache[notebookId]
  else for (const k in _cardMetaCache) delete _cardMetaCache[k]
}
// Prime every visible card through ONE native call before constructing DOM. Do not batch the whole
// library: large libraries can contain hundreds of books, while only 8–9 cards are painted. Folder
// members are included because the Boox folder collage asks for up to four formats while rendering.
function primeCardMetaCache(cells) {
  const ids = []
  ;(cells || []).forEach(function(cell) {
    if (cell.kind === 'notebook') ids.push(cell.data.notebookId)
    else if (cell.kind === 'folder' && libraryData) {
      const folderIds = nestedFoldersEnabled()
        ? [cell.data.folderId].concat(descendantFolderIds(cell.data.folderId))
        : [cell.data.folderId]
      libraryData.notebooks.filter(function(n) { return folderIds.indexOf(n.folderId) !== -1 }).slice(0, 4)
        .forEach(function(n) { ids.push(n.notebookId) })
    }
  })
  const missing = ids.filter(function(id, i) {
    return ids.indexOf(id) === i && !Object.prototype.hasOwnProperty.call(_cardMetaCache, id)
  })
  if (!missing.length) return
  const batch = Bridge.peekMetas ? Bridge.peekMetas(missing) : null
  if (batch) {
    missing.forEach(function(id) {
      _cardMetaCache[id] = (batch[id] && typeof batch[id] === 'object') ? batch[id] : null
    })
    return
  }
  // Old native/preview builds retain correctness, only without the launch-speed win.
  missing.forEach(function(id) { peekCardMeta(id) })
}
function peekCardMeta(notebookId) {
  if (Object.prototype.hasOwnProperty.call(_cardMetaCache, notebookId)) return _cardMetaCache[notebookId]
  let m = null
  try {
    const raw = Bridge.peekMeta(notebookId)
    if (raw && raw !== 'null') m = JSON.parse(raw)
  } catch (e) { m = null }
  _cardMetaCache[notebookId] = m
  return m
}

// Apps can opt into a "recently opened" shelf without changing the persistence semantics of
// updatedAt (which remains the last content modification time). Existing library entries predate
// lastOpenedAt, so their modified/created time is the stable migration fallback until first open.
function libraryCardTimestamp(info) {
  const cfg = window.KalamosConfig || {}
  if (cfg.libraryOrder === 'lastOpened') {
    return info.lastOpenedAt || info.updatedAt || info.createdAt
  }
  return info.updatedAt || info.createdAt
}

function recordNotebookOpened(notebookId) {
  const cfg = window.KalamosConfig || {}
  if (cfg.libraryOrder !== 'lastOpened' || !libraryData) return
  const info = libraryData.notebooks.find(function(n) { return n.notebookId === notebookId })
  if (!info) return
  info.lastOpenedAt = nowISO()
  libraryPage = 0
  saveLibrary()
}

// A card is a "book" card (cover-grid style) the moment it has a format or a bookRef — this is
// additive to the plain notebook-card path, so ink notebooks (no format/bookRef) are unaffected.
function bookFormat(meta) {
  if (!meta) return null
  return meta.format || (meta.bookRef ? 'book' : null)
}

function bookProgress(meta) {
  const p = meta && meta.readingProgress
  return (typeof p === 'number' && p > 0) ? p : 0
}

// Visible-card cover registry (notebookId → {el, kind}), rebuilt every render. Lets
// window.onCoverReady (native cover backfill, WP2) refresh just one card's image in place
// without a full re-render, when that id happens to be on the current page.
let visibleThumbs = {}
// A folder can show notebooks that have no standalone card on this shelf page. Track their
// miniature slots separately so asynchronous thumbnail completion reaches every visible preview.
let visibleFolderThumbs = {}

function refreshFolderThumbs(notebookId) {
  const slots = visibleFolderThumbs[notebookId] || []
  slots.forEach(function(slot) { renderNoteThumb(slot, notebookId) })
}

function renderNoteThumb(thumb, notebookId) {
  thumb.innerHTML = ''
  const thumbUrl = Storage.getThumbnailUrl(notebookId)
  if (thumbUrl) {
    const img = document.createElement('img')
    img.src = thumbUrl
    img.alt = ''
    img.addEventListener('error', function() { this.style.display = 'none' })
    thumb.appendChild(img)
  } else {
    const icon = document.createElement('span')
    const meta = peekCardMeta(notebookId)
    const template = meta && meta.kind === 'planning'
      ? 'ruled'
      : ((meta && meta.defaultTemplate && meta.defaultTemplate.type) || 'blank')
    icon.className = 'empty-icon note-template-' + template
    icon.setAttribute('aria-label', 'Empty note')
    icon.textContent = '📄'
    thumb.appendChild(icon)
  }
}

// Book cover media: a real thumbnail when CoverManager (WP2) has produced one, else a plain
// hairline placeholder with a book glyph — mirrors the reference screenshots' blank html/cbz cards.
function renderCoverMedia(wrap, notebookId) {
  wrap.innerHTML = ''
  const url = Storage.getThumbnailUrl(notebookId)
  if (url) {
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.addEventListener('error', function() { renderCoverPlaceholder(wrap); requestCover(notebookId) })
    wrap.appendChild(img)
  } else {
    renderCoverPlaceholder(wrap)
    requestCover(notebookId)
  }
}

// Batch cover-less book ids and ask the native CoverManager once per grid render; each finished
// cover comes back via window.onCoverReady(id). One request per id per session — if generation
// fails there's nothing better to show than the placeholder anyway.
const coverRequested = {}
let coverBatch = []
let coverFlushTimer = null
function requestCover(notebookId) {
  if (coverRequested[notebookId] || !Bridge.ensureCovers) return
  coverRequested[notebookId] = true
  coverBatch.push(notebookId)
  if (coverFlushTimer) clearTimeout(coverFlushTimer)
  coverFlushTimer = setTimeout(function() {
    const ids = coverBatch; coverBatch = []; coverFlushTimer = null
    if (ids.length) Bridge.ensureCovers(JSON.stringify(ids))
  }, 50)
}

function renderCoverPlaceholder(wrap) {
  wrap.innerHTML = ''
  const ph = document.createElement('div')
  ph.className = 'placeholder'
  ph.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-3-6 3z"/><path d="M9 8h6M9 12h6"/></svg>'
  wrap.appendChild(ph)
}

// Native cover backfill callback (WP2 wires ensureCovers/onCoverReady; harmless no-op until then).
window.onCoverReady = function(notebookId) {
  if (Storage.invalidateThumbnail) Storage.invalidateThumbnail(notebookId)
  refreshFolderThumbs(notebookId)
  const entry = visibleThumbs[notebookId]
  if (!entry) return   // not on the current page — nothing to refresh
  if (entry.kind === 'book') renderCoverMedia(entry.el, notebookId)
  else renderNoteThumb(entry.el, notebookId)
}

// Ink thumbnails are written off the UI thread. Refresh only the matching visible card when the
// PNG lands so returning from an editor never leaves a session-cached placeholder in the grid.
// Document owners save metadata through Storage; mirror the completed write into the shelf
// index before return so timestamp sorting cannot keep using the entry from before editing.
window.onNotebookSaved = function(notebookId, updatedAt) {
  const info = libraryData.notebooks.find(function(n) { return n.notebookId === notebookId })
  if (!info) return
  info.updatedAt = updatedAt
  invalidateCardMeta(notebookId)
  Storage.saveLibrary(libraryData)
}

window.onThumbnailReady = function(notebookId) {
  if (Storage.invalidateThumbnail) Storage.invalidateThumbnail(notebookId)
  refreshFolderThumbs(notebookId)
  const entry = visibleThumbs[notebookId]
  if (!entry) return
  if (entry.kind === 'book') renderCoverMedia(entry.el, notebookId)
  else renderNoteThumb(entry.el, notebookId)
}

// Folders + notebooks (filtered by the active folder), in the order the grid renders them:
// folder cards first, then book/note cards. Shared by renderGrid and the hardware page-turn.
function computeLibraryCells(folderId = activeFolderId) {
  const query = (window.AppLibrary?.searchQuery || '').toLocaleLowerCase()
  const notebooks = libraryData.notebooks
    .filter(function(n) {
      if (query) return n.title.toLocaleLowerCase().includes(query)
      return nestedFoldersEnabled()
        ? (n.folderId || '') === folderId
        : (!folderId || n.folderId === folderId)
    })
    .sort(function(a, b) {
      return new Date(libraryCardTimestamp(b)).getTime() -
        new Date(libraryCardTimestamp(a)).getTime()
    })
  const folders = query ? [] : nestedFoldersEnabled()
    ? childFolders(folderId)
    : (folderId ? [] : libraryData.folders.slice())
  const cells = folders.map(function(f) { return { kind: 'folder', data: f } })
    .concat(notebooks.map(function(n) { return { kind: 'notebook', data: n } }))
  return { cells: cells, folders: folders, notebooks: notebooks }
}

function renderGrid() {
  const grid = document.getElementById('grid')
  grid.innerHTML = ''
  visibleThumbs = {}
  visibleFolderThumbs = {}

  const computed = computeLibraryCells()
  const cells = computed.cells

  const pageSize = libraryItemsPerPage()
  const totalPages = Math.max(1, Math.ceil(cells.length / pageSize))
  if (libraryPage >= totalPages) libraryPage = totalPages - 1
  if (libraryPage < 0) libraryPage = 0

  // The shared shelf keeps its original creation cards unless an app owns equivalent persistent
  // header actions. Notes uses that opt-in so all nine cells in its 3x3 shelf can show content.
  if (creationCardsInGrid()) {
    grid.appendChild(buildNewNoteCard())
    if (nestedFoldersEnabled()) grid.appendChild(buildNewFolderCard())
  }

  const start = libraryPage * pageSize
  const visible = cells.slice(start, start + pageSize)
  primeCardMetaCache(visible)
  visible.forEach(function(cell) {
    grid.appendChild(cell.kind === 'folder' ? buildFolderCard(cell.data) : buildNotebookCard(cell.data))
  })

  renderPagination(totalPages, computed.folders.length, computed.notebooks.length)

  // Preload ONLY the visible notebooks' metas (structure, no strokes), off the render path, so a tap
  // opens from cache and lazy-loads just the current page. Re-runs each render (and on pagination) so
  // it always tracks the current page's selection — never the whole library.
  const visibleNotebookInfos = visible.filter(function(c) { return c.kind === 'notebook' }).map(function(c) { return c.data })
  setTimeout(function() {
    visibleNotebookInfos.forEach(function(info) { Storage.preloadMeta(info.notebookId) })
  }, 50)
}

// A book/note grid cell: dispatches on the notebook's meta (peeked synchronously — cheap, no
// migration, matches the existing preload cost) to the additive book-card path, or falls back to
// the original plain notebook-card path unchanged.
function buildNotebookCard(info) {
  const meta = peekCardMeta(info.notebookId)
  const format = bookFormat(meta)
  return format ? buildBookCard(info, meta, format) : buildNoteCard(info)
}

// Pointer drag is opt-in per app. A stationary hold opens actions; movement picks up the card.
let shelfSuppressClickUntil = 0
let shelfDrag = null
let shelfSuppressedNotebookId = null
function installNotebookShelfDrag(card, info) {
  if (!window.AppLibrary || !window.AppLibrary.folderDragEnabled) return
  const readOnly = !!window.AppLibrary.readOnly
  card.style.touchAction = 'none'
  card.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return
    const r = card.getBoundingClientRect()
    const gesture = {id:e.pointerId, x:e.clientX, y:e.clientY, moved:false, ghost:null, target:null, hold:null}
    shelfDrag = gesture
    gesture.hold = setTimeout(function() {
      if (shelfDrag !== gesture || gesture.moved) return
      gesture.held = true
      shelfSuppressClickUntil = performance.now() + 900
      shelfSuppressedNotebookId = info.notebookId
      showContextMenu(e.clientX, e.clientY, info)
    }, 550)
    card.setPointerCapture(e.pointerId)
    gesture.rect = r
  })
  card.addEventListener('pointermove', function(e) {
    const g = shelfDrag
    if (!g || g.id !== e.pointerId) return
    if (!g.moved && Math.hypot(e.clientX-g.x, e.clientY-g.y) < 10) return
    if (readOnly) { g.moved = true; clearTimeout(g.hold); return }
    if (!g.moved) {
      shelfSuppressedNotebookId = null
      g.moved = true; clearTimeout(g.hold); removeContextMenu()
      g.ghost = card.cloneNode(true); g.ghost.classList.add('shelf-drag-preview')
      g.ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;width:' + g.rect.width + 'px;height:' + g.rect.height + 'px;background:#fff;border:2px solid #000;box-sizing:border-box'
      document.body.append(g.ghost); card.classList.add('shelf-drag-source')
    }
    g.ghost.style.left = (g.rect.left + e.clientX-g.x) + 'px'; g.ghost.style.top = (g.rect.top + e.clientY-g.y) + 'px'
    const hit = document.elementFromPoint(e.clientX,e.clientY)
    const target = hit && hit.closest('[data-drop-folder-id]')
    if (g.target && g.target !== target) g.target.classList.remove('shelf-drop-target')
    g.target = target
    if (target && target.dataset.dropFolderId !== (info.folderId || '')) target.classList.add('shelf-drop-target')
  })
  function finish(e) {
    const g = shelfDrag
    if (!g || g.id !== e.pointerId) return
    shelfDrag = null; clearTimeout(g.hold)
    if (g.held) shelfSuppressClickUntil = performance.now() + 900
    if (readOnly) return
    if (g.moved) {
      shelfSuppressedNotebookId = null
      shelfSuppressClickUntil = performance.now() + 900
      g.ghost.remove(); card.classList.remove('shelf-drag-source')
      if (g.target) {
        g.target.classList.remove('shelf-drop-target')
        const id = g.target.dataset.dropFolderId
        if (e.type !== 'pointercancel' && id !== (info.folderId || '') && (!id || findFolder(id))) moveNote(info,id)
      }
    }
  }
  card.addEventListener('pointerup',finish); card.addEventListener('pointercancel',finish)
}
if (typeof document !== 'undefined') document.addEventListener('click', function(e) {
  if (performance.now() < shelfSuppressClickUntil && e.target.closest('.note-card,.context-menu')) {
    if (e.target.closest('.context-menu')) return
    if (shelfSuppressedNotebookId && e.target.closest('.note-card')?.dataset.notebookId !== shelfSuppressedNotebookId) return
    e.preventDefault(); e.stopImmediatePropagation()
  }
}, true)

function buildNoteCard(info, selection) {
  const card = document.createElement(selection ? 'button' : 'div')
  if (selection) { card.type = 'button'; card.setAttribute('aria-label', 'Preview ' + info.title) }
  card.className = 'note-card'
  // Stable app-overlay routing hook (e.g. Notes planning documents). Do not make overlays recover
  // identity from display titles: titles are neither unique nor immutable.
  card.dataset.notebookId = info.notebookId

  const thumb = document.createElement('div')
  thumb.className = 'thumb'
  renderNoteThumb(thumb, info.notebookId)
  if (!selection) visibleThumbs[info.notebookId] = { el: thumb, kind: 'note' }
  card.appendChild(thumb)

  const infoDiv = document.createElement('div')
  infoDiv.className = 'info'

  const title = document.createElement('div')
  title.className = 'title'
  title.textContent = info.title
  infoDiv.appendChild(title)

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = timeAgo(libraryCardTimestamp(info))
  infoDiv.appendChild(meta)

  if (info.folderId) {
    const folder = libraryData.folders.find(function(f) { return f.folderId === info.folderId })
    if (folder) {
      const badge = document.createElement('span')
      badge.className = 'folder-badge'
      badge.textContent = folder.name
      infoDiv.appendChild(badge)
    }
  }

  card.appendChild(infoDiv)
  if (selection) {
    card.addEventListener('click', function() { selection(info) })
  } else {
    installNotebookShelfDrag(card, info)
    card.addEventListener('click', function() { App.showEditor(info.notebookId) })
    card.addEventListener('contextmenu', function(e) {
      e.preventDefault()
      showContextMenu(e.clientX, e.clientY, info)
    })
  }
  return card
}

// Bigme-style book card: big cover, format badge notched bottom-right, progress % tab notched
// into the top (only when there's real progress), title BELOW the cover in bold 2-line text.
function buildBookCard(info, meta, format) {
  const card = document.createElement('div')
  card.className = 'book-card'

  const cover = document.createElement('div')
  cover.className = 'cover'

  const media = document.createElement('div')
  media.className = 'cover-media'
  renderCoverMedia(media, info.notebookId)
  visibleThumbs[info.notebookId] = { el: media, kind: 'book' }
  cover.appendChild(media)

  const progress = bookProgress(meta)
  if (progress > 0) {
    const tab = document.createElement('span')
    tab.className = 'progress-tab'
    tab.textContent = Math.round(progress * 100) + '%'
    cover.appendChild(tab)
  }

  const fmt = document.createElement('span')
  fmt.className = 'fmt-tab'
  fmt.textContent = format
  cover.appendChild(fmt)

  card.appendChild(cover)

  const titleBlock = document.createElement('div')
  titleBlock.className = 'title-block'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = info.title
  titleBlock.appendChild(name)
  card.appendChild(titleBlock)

  if(window.AppLibrary?.readOnly)installNotebookShelfDrag(card,info)
  card.addEventListener('click', function() { App.showEditor(info.notebookId) })
  card.addEventListener('contextmenu', function(e) {
    e.preventDefault()
    showContextMenu(e.clientX, e.clientY, info)
  })
  return card
}

// Folder card: up to 4 mini covers as a 2x2 collage (or a folder glyph when none are cheaply
// available), an item-count tab notched bottom-left (read/total isn't cheap to derive without
// loading every member's meta, so this shows the plain item count), name below.
function buildFolderCard(folder, selection) {
  const card = document.createElement('div')
  card.className = 'folder-card'
  card.dataset.dropFolderId = folder.folderId

  const cover = document.createElement('div')
  cover.className = 'cover'

  const containedFolderIds = [folder.folderId].concat(descendantFolderIds(folder.folderId))
  const members = libraryData.notebooks.filter(function(n) {
    return containedFolderIds.indexOf(n.folderId) !== -1
  })
  const directFolders = childFolders(folder.folderId)
  const directNotes = libraryData.notebooks.filter(function(n) {
    return (n.folderId || '') === folder.folderId
  })
  // The four cover slots describe this folder's immediate contents. Flattening descendant notes
  // here makes a child folder indistinguishable from a loose note and misrepresents the hierarchy.
  const slotEntries = directFolders.map(function(child) {
    return { kind: 'folder', data: child }
  }).concat(directNotes.map(function(note) {
    return { kind: 'notebook', data: note }
  })).slice(0, 4)
  if (slotEntries.length) {
    cover.classList.add('folder-cover-slots')
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement('div')
      cell.className = 'cell'
      const entry = slotEntries[i]
      if (entry && entry.kind === 'notebook') {
        cell.classList.add('folder-note-preview')
        const id = entry.data.notebookId
        renderNoteThumb(cell, id)
        if (!selection) {
          if (!visibleFolderThumbs[id]) visibleFolderThumbs[id] = []
          visibleFolderThumbs[id].push(cell)
        }
      } else if (entry && entry.kind === 'folder') {
        cell.classList.add('nested-folder-cell')
        const miniFolder = document.createElement('div')
        miniFolder.className = 'nested-folder-preview'
        cell.appendChild(miniFolder)
      }
      cover.appendChild(cell)
    }
  } else {
    const glyph = document.createElement('div')
    glyph.className = 'glyph'
    glyph.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
    cover.appendChild(glyph)
  }

  const tab = document.createElement('span')
  tab.className = 'count-tab'
  tab.textContent = String(members.length + directFolders.length)
  cover.appendChild(tab)

  card.appendChild(cover)

  const titleBlock = document.createElement('div')
  titleBlock.className = 'title-block'
  const name = document.createElement('div')
  name.className = 'name'
  name.textContent = folder.name
  titleBlock.appendChild(name)
  card.appendChild(titleBlock)

  if (selection) {
    card.setAttribute('role','button'); card.tabIndex=0
    card.addEventListener('click',function(){selection(folder)})
    card.addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();selection(folder)}})
  } else {
    card.addEventListener('click', function() { activeFolderId = folder.folderId; libraryPage = 0; renderLibrary() })
    card.addEventListener('contextmenu', function(e) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, folder) })
  }
  return card
}

function buildNewNoteCard() {
  const newCard = document.createElement('div')
  newCard.className = 'new-note-card'
  newCard.innerHTML = '<div><div class="plus">+</div><div class="label">New Note</div></div>'
  newCard.addEventListener('click', createNewNotebook)
  return newCard
}

function buildNewFolderCard() {
  const newCard = document.createElement('div')
  newCard.className = 'new-folder-card'
  newCard.innerHTML =
    '<div><div class="new-folder-glyph" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
    '<path d="M12 11v6M9 14h6"/></svg></div><div class="label">New Folder</div></div>'
  newCard.addEventListener('click', createNewFolder)
  return newCard
}

function createNewFolder() {
  const parentFolderId = activeFolderId
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const modal = document.createElement('div')
  modal.className = 'modal folder-name-modal'

  const heading = document.createElement('h3')
  heading.textContent = 'New folder'
  modal.appendChild(heading)

  const label = document.createElement('label')
  label.className = 'folder-name-label'
  label.textContent = 'Folder name'
  const input = document.createElement('input')
  input.type = 'text'
  input.maxLength = 120
  input.autocomplete = 'off'
  label.appendChild(input)
  modal.appendChild(label)

  const actions = document.createElement('div')
  actions.className = 'modal-actions'
  const cancel = document.createElement('button')
  cancel.className = 'btn'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', function() { overlay.remove() })
  actions.appendChild(cancel)

  const create = document.createElement('button')
  create.className = 'btn active'
  create.textContent = 'Create folder'
  const submit = function() {
    const name = input.value.trim()
    if (!name) {
      input.focus()
      return
    }
    libraryData.folders.push(createFolder(name, parentFolderId))
    saveLibrary()
    libraryPage = 0
    overlay.remove()
    renderLibrary()
  }
  create.addEventListener('click', submit)
  input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') submit()
  })
  actions.appendChild(create)
  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  input.focus()
}

// Hardware page-turn buttons in the library = pagination prev/next.
function libraryPageTurn(dir) {
  if (window.AppLibrary && window.AppLibrary.pageTurn) return window.AppLibrary.pageTurn(dir)
  if (!libraryData) return
  const totalPages = Math.max(1, Math.ceil(computeLibraryCells().cells.length / libraryItemsPerPage()))
  if (dir === 'down' && libraryPage < totalPages - 1) { libraryPage++; renderLibrary() }
  else if (dir === 'up' && libraryPage > 0) { libraryPage--; renderLibrary() }
}

// Footer: "Total: Folders X / Files Y" (left) + page N/M with turn arrows (right) — always
// visible (not just once paginated), per the reference screenshots' footer bar.
function renderPagination(totalPages, folderCount, fileCount) {
  const totalsEl = document.getElementById('page-totals')
  if (totalsEl) totalsEl.textContent = 'Total: Folders ' + folderCount + ' / Files ' + fileCount

  const controls = document.getElementById('pager-controls')
  if (!controls) return
  controls.innerHTML = ''

  const prev = document.createElement('button')
  prev.className = 'page-btn'
  prev.innerHTML = '&#9664;'
  prev.setAttribute('aria-label', 'Previous page')
  prev.disabled = libraryPage <= 0
  prev.addEventListener('click', function() { if (libraryPage > 0) { libraryPage--; renderGrid() } })
  controls.appendChild(prev)

  const label = document.createElement('span')
  label.className = 'page-label'
  label.textContent = (libraryPage + 1) + ' / ' + totalPages
  controls.appendChild(label)

  const next = document.createElement('button')
  next.className = 'page-btn'
  next.innerHTML = '&#9654;'
  next.setAttribute('aria-label', 'Next page')
  next.disabled = libraryPage >= totalPages - 1
  next.addEventListener('click', function() { if (libraryPage < totalPages - 1) { libraryPage++; renderGrid() } })
  controls.appendChild(next)
}

function renderEmptyState() {
  const empty = document.getElementById('empty-state')
  if (libraryData.notebooks.length === 0) {
    empty.style.display = 'flex'
  } else {
    empty.style.display = 'none'
  }
}

function createNewNotebook(title, template) {
  const nb = createNotebook(typeof title === 'string' && title.trim() ? title.trim() : 'Notebook', activeFolderId !== '' ? activeFolderId : '', template)
  libraryData.notebooks.push({
    notebookId: nb.notebookId,
    title: nb.title,
    folderId: nb.folderId,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    defaultTemplate: nb.defaultTemplate
  })
  saveLibrary()
  Storage.saveNotebook(nb)
  // Thumbnail is captured from the native surface when leaving the editor (no page rendered yet).
  App.showEditor(nb.notebookId)
}

function showContextMenu(x, y, target) {
  if (window.AppLibrary?.onContextMenu?.(target, x, y) === true) {
    removeContextMenu()
    shelfSuppressedNotebookId = target.notebookId || null
    shelfSuppressClickUntil = performance.now() + 900
    return
  }
  if (window.AppLibrary?.readOnly && !target.notebookId) return
  removeContextMenu()
  const appActions = window.AppLibrary && typeof window.AppLibrary.contextActions === 'function'
    ? window.AppLibrary.contextActions(target) : []
  if (window.AppLibrary?.readOnly && (!Array.isArray(appActions) || !appActions.length)) return
  contextMenuEl = document.createElement('div')
  contextMenuEl.className = 'context-menu'
  contextMenuEl.style.left = x + 'px'
  contextMenuEl.style.top = y + 'px'

  function appendAppActions() {
    ;(Array.isArray(appActions) ? appActions : []).forEach(function(action) {
      if (!action || !action.label || typeof action.run !== 'function') return
      const item = document.createElement('div')
      item.className = 'item' + (action.danger ? ' danger' : '')
      item.textContent = action.label
      item.addEventListener('click', function() {
        removeContextMenu()
        action.run()
      })
      contextMenuEl.appendChild(item)
    })
  }

  if (window.AppLibrary?.readOnly) {
    appendAppActions()
  } else if (target.pasteTarget === true) {
    appendAppActions()
  } else if (target.folderId !== undefined && target.notebookId === undefined) {
    // Folder context
    appendAppActions()
    const rename = document.createElement('div')
    rename.className = 'item'
    rename.textContent = 'Rename folder'
    rename.addEventListener('click', function() { renameFolder(target); removeContextMenu() })
    contextMenuEl.appendChild(rename)

    if (nestedFoldersEnabled()) {
      const moveLabel = document.createElement('div')
      moveLabel.className = 'item context-heading'
      moveLabel.textContent = 'Move folder to'
      contextMenuEl.appendChild(moveLabel)

      const blocked = [target.folderId].concat(descendantFolderIds(target.folderId))
      if (folderParentId(target)) {
        const root = document.createElement('div')
        root.className = 'item context-option'
        root.textContent = 'Top level'
        root.addEventListener('click', function() { moveFolder(target, ''); removeContextMenu() })
        contextMenuEl.appendChild(root)
      }
      libraryData.folders.forEach(function(folder) {
        if (blocked.indexOf(folder.folderId) !== -1 ||
            folder.folderId === folderParentId(target)) return
        const option = document.createElement('div')
        option.className = 'item context-option'
        option.textContent = folderDisplayPath(folder)
        option.addEventListener('click', function() {
          moveFolder(target, folder.folderId)
          removeContextMenu()
        })
        contextMenuEl.appendChild(option)
      })
    }

    const del = document.createElement('div')
    del.className = 'item danger'
    del.textContent = 'Delete folder'
    del.addEventListener('click', function() { removeContextMenu(); showDeleteFolderConfirm(target) })
    contextMenuEl.appendChild(del)
  } else if (target.notebookId) {
    // Notebook context
    appendAppActions()

    const rename = document.createElement('div')
    rename.className = 'item'
    rename.textContent = 'Rename'
    rename.addEventListener('click', function() { renameNote(target); removeContextMenu() })
    contextMenuEl.appendChild(rename)

    const del = document.createElement('div')
    del.className = 'item danger'
    del.textContent = 'Delete'
    del.addEventListener('click', function() { removeContextMenu(); showDeleteNoteConfirm(target) })
    contextMenuEl.appendChild(del)

    if (!(window.AppLibrary && window.AppLibrary.folderDragEnabled)) {
    const moveLabel = document.createElement('div')
    moveLabel.className = 'item'
    moveLabel.textContent = 'Move to folder'
    contextMenuEl.appendChild(moveLabel)

    for (const f of libraryData.folders) {
      if (f.folderId === target.folderId) continue
      const opt = document.createElement('div')
      opt.className = 'item context-option'
      opt.textContent = nestedFoldersEnabled() ? folderDisplayPath(f) : '  ' + f.name
      opt.addEventListener('click', function() { moveNote(target, f.folderId); removeContextMenu() })
      contextMenuEl.appendChild(opt)
    }

    if (target.folderId) {
      const opt = document.createElement('div')
      opt.className = 'item'
      opt.textContent = '  (No folder)'
      opt.addEventListener('click', function() { moveNote(target, ''); removeContextMenu() })
      contextMenuEl.appendChild(opt)
    }
  }

    }
  document.body.appendChild(contextMenuEl)
  installContextMenuPagination(x, y)
  document.addEventListener('click', removeContextMenu, { once: true })
}

function clampContextMenuPosition(x, y, menuWidth, menuHeight, viewportWidth, viewportHeight) {
  const margin = 8
  const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin)
  const maxTop = Math.max(margin, viewportHeight - menuHeight - margin)
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop)
  }
}

function paginateContextMenuItems(items, availableHeight) {
  const pages = []
  let page = []
  let usedHeight = 0
  items.forEach(function(item) {
    if (page.length && usedHeight + item.height > availableHeight) {
      pages.push(page)
      page = []
      usedHeight = 0
    }
    page.push(item)
    usedHeight += item.height
  })
  if (page.length) pages.push(page)
  return pages
}

function installContextMenuPagination(x, y) {
  if (!contextMenuEl) return
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight
  const entries = Array.from(contextMenuEl.children).map(function(node) {
    return { node: node, height: Math.ceil(node.getBoundingClientRect().height) }
  })
  const itemHeight = entries.reduce(function(total, item) { return total + item.height }, 0)
  const menuHeight = contextMenuEl.getBoundingClientRect().height
  const menuChromeHeight = Math.max(0, menuHeight - itemHeight)
  if (menuHeight <= viewportHeight - 16) {
    positionContextMenu(x, y)
    return
  }

  const pager = document.createElement('div')
  pager.className = 'context-menu-pagination'
  const previous = document.createElement('button')
  previous.type = 'button'
  previous.textContent = '\u2039'
  previous.setAttribute('aria-label', 'Previous menu page')
  const label = document.createElement('span')
  const next = document.createElement('button')
  next.type = 'button'
  next.textContent = '\u203a'
  next.setAttribute('aria-label', 'Next menu page')
  pager.appendChild(previous)
  pager.appendChild(label)
  pager.appendChild(next)

  contextMenuEl.replaceChildren(pager)
  const availableHeight = Math.max(
    1,
    viewportHeight - 16 - menuChromeHeight - Math.ceil(pager.getBoundingClientRect().height)
  )
  const pages = paginateContextMenuItems(entries, availableHeight)
  let pageIndex = 0

  function renderPage() {
    const nodes = pages[pageIndex].map(function(item) { return item.node })
    contextMenuEl.replaceChildren.apply(contextMenuEl, nodes.concat(pager))
    previous.disabled = pageIndex === 0
    next.disabled = pageIndex === pages.length - 1
    label.textContent = 'Page ' + (pageIndex + 1) + ' of ' + pages.length
    positionContextMenu(x, y)
  }

  previous.addEventListener('click', function(event) {
    event.stopPropagation()
    if (pageIndex > 0) {
      pageIndex--
      renderPage()
    }
  })
  next.addEventListener('click', function(event) {
    event.stopPropagation()
    if (pageIndex < pages.length - 1) {
      pageIndex++
      renderPage()
    }
  })
  renderPage()
}

function positionContextMenu(x, y) {
  if (!contextMenuEl) return
  const rect = contextMenuEl.getBoundingClientRect()
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight
  const position = clampContextMenuPosition(
    x, y, rect.width, rect.height, viewportWidth, viewportHeight
  )
  contextMenuEl.style.left = position.left + 'px'
  contextMenuEl.style.top = position.top + 'px'
}

function removeContextMenu() {
  if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null }
}

function renameNote(info) {
  const newTitle = prompt('Rename note:', info.title)
  if (newTitle && newTitle.trim()) {
    if (window.AppLibrary?.validateNotebookTitle?.(newTitle.trim(), info.notebookId) === false) return
    info.title = newTitle.trim()
    // Also update the notebook file's title
    const nb = Storage.loadNotebook(info.notebookId)
    if (nb) {
      nb.title = newTitle.trim()
      Storage.saveNotebook(nb)
    }
    saveLibrary()
    renderLibrary()
  }
}

function showDeleteNoteConfirm(info) {
  showConfirm('Delete "' + info.title + '"?', 'This cannot be undone.', function() {
    Storage.deleteNotebook(info.notebookId)
    const idx = libraryData.notebooks.indexOf(info)
    if (idx !== -1) libraryData.notebooks.splice(idx, 1)
    saveLibrary()
    renderLibrary()
  })
}

function renameFolder(folder) {
  const newName = prompt('Rename folder:', folder.name)
  if (newName && newName.trim()) {
    folder.name = newName.trim()
    saveLibrary()
    renderLibrary()
  }
}

function showDeleteFolderConfirm(folder) {
  const parentId = nestedFoldersEnabled() ? folderParentId(folder) : ''
  const destination = parentId ? folderDisplayPath(findFolder(parentId)) : 'the top level'
  const message = nestedFoldersEnabled()
    ? 'Its notes and subfolders will be moved to ' + destination + '.'
    : 'Notes will be moved to "No folder".'
  showConfirm('Delete "' + folder.name + '"?', message, function() {
    for (const n of libraryData.notebooks) {
      if (n.folderId === folder.folderId) {
        n.folderId = parentId
        // Update notebook file
        const nb = Storage.loadNotebook(n.notebookId)
        if (nb) { nb.folderId = parentId; Storage.saveNotebook(nb) }
      }
    }
    if (nestedFoldersEnabled()) {
      childFolders(folder.folderId).forEach(function(child) {
        child.parentFolderId = parentId
      })
    }
    const idx = libraryData.folders.indexOf(folder)
    if (idx !== -1) libraryData.folders.splice(idx, 1)
    if (activeFolderId === folder.folderId) activeFolderId = parentId
    saveLibrary()
    renderLibrary()
  })
}

function moveFolder(folder, parentFolderId) {
  const blocked = [folder.folderId].concat(descendantFolderIds(folder.folderId))
  if (parentFolderId && blocked.indexOf(parentFolderId) !== -1) return
  folder.parentFolderId = parentFolderId || ''
  saveLibrary()
  renderLibrary()
}

function moveNote(info, folderId) {
  info.folderId = folderId
  const nb = Storage.loadNotebook(info.notebookId)
  if (nb) { nb.folderId = folderId; Storage.saveNotebook(nb) }
  saveLibrary()
  renderLibrary()
}

function showConfirm(title, message, onConfirm) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const modal = document.createElement('div')
  modal.className = 'modal'

  const h3 = document.createElement('h3')
  h3.textContent = title
  modal.appendChild(h3)

  const p = document.createElement('p')
  p.textContent = message
  modal.appendChild(p)

  const actions = document.createElement('div')
  actions.className = 'modal-actions'

  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'btn'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.addEventListener('click', function() { overlay.remove() })
  actions.appendChild(cancelBtn)

  const confirmBtn = document.createElement('button')
  confirmBtn.className = 'btn active'
  confirmBtn.textContent = 'Delete'
  confirmBtn.addEventListener('click', function() {
    overlay.remove()
    if (onConfirm) onConfirm()
  })
  actions.appendChild(confirmBtn)

  modal.appendChild(actions)
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
}

function timeAgo(isoString) {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diff = now - then
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return minutes + 'm ago'
  if (hours < 24) return hours + 'h ago'
  if (days < 7) return days + 'd ago'
  const d = new Date(then)
  return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]
}
