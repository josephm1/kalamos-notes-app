// Native presentation only: the canonical shelf still owns ordering, mutations and routing.
// No document contents, pen events or credentials cross this channel.
(function () {
  'use strict'
  let supported = false, active = false, revision = 0, visible = [], frame = 0
  let lastPayload = '', observing = false

  function eligible() {
    const grid = document.getElementById('grid')
    const library = document.getElementById('library-view')
    return supported && grid && library && library.getBoundingClientRect().height > 0 &&
      !window.KalamosWriteWorkspace?.isOpen() && !window.AppLibrary.readOnly &&
      !window.KalamosNotesSelection?.isActive() &&
      !document.querySelector('.modal-overlay,.context-menu,.notes-shelf-menu,.notes-move-sheet,[role="dialog"],.notes-shelf-picker-bar') &&
      !grid.classList.contains('notes-list')
  }

  function hide() {
    if (!active) return
    active = false; lastPayload = ''; revision++
    AB.call('notes.shelf.hide', {})
  }

  function card(cell) {
    const item = cell.data
    if (cell.kind === 'notebook') return {
      id: item.notebookId, title: item.title, subtitle: timeAgo(libraryCardTimestamp(item)),
      thumbnail: item.notebookId
    }
    const notes = libraryData.notebooks.filter(n => (n.folderId || '') === item.folderId)
    const folders = childFolders(item.folderId)
    return {
      id: item.folderId, folder: true, title: item.name, count: notes.length + folders.length,
      slots: notes.slice(0, 4).map(n => ({ thumbnail: n.notebookId }))
        .concat(folders.map(() => ({ folder: true }))).slice(0, 4)
    }
  }

  function publish() {
    if (!active) return
    const grid = document.getElementById('grid'), rect = grid.getBoundingClientRect()
    const style = getComputedStyle(grid)
    const px = name => parseFloat(style.getPropertyValue(name)) || 0
    const columns = Math.max(1, Math.min(4, Number(grid.dataset.notesDensity) || 3))
    const columnGap = px('column-gap'), left = px('padding-left'), right = px('padding-right')
    const available = rect.width - left - right - columnGap * (columns - 1)
    const width = Math.min(available / columns, px('--notes-card-max') || 150)
    if (width <= 0 || rect.height <= 0) { hide(); return }
    const around = Math.max(0, available - width * columns) / columns
    const caption = columns === 4 ? 32 : 40
    const model = {
      viewport: window.innerWidth, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      cardWidth: width, caption, columns,
      canMoveUp: !!activeFolderId,
      cards: visible.map((cell, index) => Object.assign(card(cell), {
        x: left + around / 2 + (index % columns) * (width + around + columnGap),
        y: px('padding-top') + Math.floor(index / columns) * (width * 131 / 86 + caption + px('row-gap'))
      }))
    }
    const key = JSON.stringify(model)
    if (key === lastPayload) return
    lastPayload = key
    model.revision = ++revision
    const result = AB.call('notes.shelf.present', model)
    if (result.err) { supported = false; hide(); renderGrid() }
  }

  function sync() {
    frame = 0
    const next = !!eligible()
    if (next !== active) {
      if (!next) hide()
      renderGrid()
    } else if (active) publish()
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync)
  }

  window.KalamosNotesNativeShelf = {
    fallback: function () { supported = false; hide(); renderGrid() },
    // A stale Android view cannot open a different notebook after a page/folder change.
    action: function (event) {
      if (!active || !eligible() || event.revision !== revision) return
      const cell = visible[event.index]
      if (!cell) return
      if (event.kind === 'open') {
        hide()
        if (cell.kind === 'folder') {
          activeFolderId = cell.data.folderId; libraryPage = 0; renderLibrary()
        } else App.showEditor(cell.data.notebookId)
        schedule() // An open failure must restore the shelf.
      } else if (event.kind === 'context') {
        hide(); renderGrid()
        showContextMenu(event.x, event.y, cell.data)
      } else if (event.kind === 'move' && cell.kind === 'notebook') {
        const destination = visible[event.destination]
        if (destination?.kind === 'folder') moveNote(cell.data, destination.data.folderId)
      } else if (event.kind === 'moveParent' && cell.kind === 'notebook' && activeFolderId) {
        moveNote(cell.data, folderParentId(findFolder(activeFolderId)))
      }
    }
  }

  const hooks = window.KalamosAppHooks, ready = hooks.onLibraryReady
  function renderNativeGrid(cells) {
    // Non-note content keeps its established book-cover presentation.
    if (!eligible() || !cells.length || cells.some(c => c.kind === 'notebook' && bookFormat(peekCardMeta(c.data.notebookId)))) {
      hide(); return false
    }
    // Invalidate old Android hit targets immediately, before the next animation-frame publish.
    revision++
    visible = cells; active = true; lastPayload = ''; schedule()
    return true
  }
  // Install before initLibrary's first render; otherwise launch would still serialize every
  // visible preview through base64 once before replacing it with the native shelf.
  supported = AB.call('notes.shelf.capabilities', {}).enabled === true
  if (supported) window.AppLibrary.renderNativeGrid = renderNativeGrid
  hooks.onLibraryReady = function () {
    if (ready) ready()
    supported = AB.call('notes.shelf.capabilities', {}).enabled === true
    const grid = document.getElementById('grid'), library = document.getElementById('library-view')
    if (!supported || observing || !grid || !library) return
    observing = true
    window.AppLibrary.renderNativeGrid = renderNativeGrid
    // Observe shelf geometry and top-level overlays only. Never observe the writing DOM:
    // pen movement/model reconciliation must not schedule shelf work.
    const observer = new MutationObserver(schedule)
    observer.observe(grid, { attributes: true, attributeFilter: ['style', 'class', 'data-notes-density'] })
    observer.observe(library, { attributes: true, attributeFilter: ['style', 'class'], childList: true })
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] })
    new ResizeObserver(schedule).observe(grid)
    window.addEventListener('resize', schedule)
    for (const name of ['onThumbnailReady', 'onCoverReady']) {
      const previous = window[name]
      window[name] = function (id) {
        if (previous) previous(id)
        if (active) { lastPayload = ''; schedule() }
      }
    }
    renderGrid()
  }
})()
