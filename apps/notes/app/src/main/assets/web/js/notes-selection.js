// Notes-owned library selection; no shared library router or ink implementation is forked.
(function () {
  'use strict'
  // The picker supplies its own actions; card state and action strip remain the Notes UI.
  function reflectCard(card, active, checked) {
    card.classList.toggle('notes-selected', checked)
    if (active) { card.setAttribute('aria-selected', String(checked)); card.setAttribute('role', 'option'); card.setAttribute('tabindex', '0') }
    else { card.removeAttribute('aria-selected'); card.removeAttribute('role'); card.removeAttribute('tabindex') }
    var tick = card.querySelector('.notes-selection-tick')
    if (active && !tick) { tick = document.createElement('span'); tick.className = 'notes-selection-tick'; card.appendChild(tick) }
    if (tick) { if (active) tick.textContent = checked ? '✓' : ''; else tick.remove() }
  }
  function selectionBar(entries, onAction) {
    var bar = document.createElement('section'); bar.className = 'notes-selection-bar'; bar.setAttribute('aria-label', 'Selected notes and folders')
    var status = document.createElement('strong'); status.setAttribute('role', 'status'); bar.appendChild(status)
    var tools = document.createElement('div'); tools.className = 'notes-selection-tools'; tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', 'Selection actions')
    entries.forEach(function (entry) {
      var button = document.createElement('button'); button.type = 'button'; button.dataset.selection = entry[0]
      button.title = entry[1]; button.setAttribute('aria-label', entry[1])
      button.innerHTML = window.KalamosToolbarIcons.svg(entry[2]) + '<span>' + entry[1] + '</span>'
      tools.appendChild(button)
    })
    bar.appendChild(tools)
    bar.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-selection]')
      if (button && !button.disabled) onAction(button.dataset.selection)
    })
    return bar
  }
  var selection = window.NotesSelection.create(reflect), selected = selection.keys, picker = null, observer, longTimer, suppressUntil = 0, suppressedKey = null
  function key(target) { return window.NotesSelection.key(target) }
  function target(card) {
    if (!libraryData) return null
    return card.dataset.notebookId ? libraryData.notebooks.find(function (n) { return n.notebookId === card.dataset.notebookId }) : libraryData.folders.find(function (f) { return f.folderId === card.dataset.dropFolderId })
  }
  function reflect() {
    document.querySelectorAll('#grid .note-card,#grid .book-card,#grid .folder-card').forEach(function (card) {
      var item = target(card); if (!item || (picker && !item.notebookId)) return
      reflectCard(card, selection.active, selected.has(key(item)))
    })
    var bar = document.getElementById('notes-selection-bar')
    if (!selection.active) { if (bar) bar.remove(); document.body.classList.remove('notes-selecting'); return }
    document.body.classList.add('notes-selecting')
    if (!bar) {
      bar = selectionBar(picker ? [['all','Select all','selectAll'],['none','Clear','select'],['done','Done','check'],['attach','Attach','ai']] : [['all', 'Select all', 'selectAll'], ['none', 'Clear', 'select'], ['move', 'Move', 'move'], ['delete', 'Delete', 'delete'], ['done', 'Done', 'check']], act)
      bar.id = 'notes-selection-bar'
      // Keep selection chrome in the shelf's flex layout. A fixed bottom bar obscures the
      // navigator and makes subsequent screens unreachable while selection.active across pages.
      var view = document.getElementById('library-view')
      view.insertBefore(bar, document.getElementById('notes-library-footer'))

    }
    bar.querySelector('strong').textContent = selected.size + ' selected'
    var attach = bar.querySelector('[data-selection=attach]')
    if (attach) { attach.disabled = !selected.size; attach.querySelector('span').textContent = 'Attach ' + selected.size }
    bar.querySelectorAll('[data-selection="move"],[data-selection="delete"]').forEach(function (button) { button.disabled = !selected.size })
  }
  function start(item) { if (!picker || (picker.attach && item.notebookId)) selection.start(key(item)) }
  function toggle(item) { if (!picker || item.notebookId) selection.toggle(key(item)) }
  function done() { selection.done() }
  function apply(next, deleting) {
    try {
      // Reuse Notes storage; folders' remaining contents are reparented, never recursively deleted.
      next.notebooks.forEach(function (info) {
        var old = libraryData.notebooks.find(function (n) { return n.notebookId === info.notebookId })
        if (old && old.folderId !== info.folderId) {
          var notebook = Storage.loadNotebook(info.notebookId)
          if (notebook) { notebook.folderId = info.folderId; if (Storage.saveNotebook(notebook) === false) throw new Error('Could not move ' + info.title) }
        }
      })
      if (Storage.saveLibrary(next) === false) throw new Error('Could not save library changes')
      var failedDeletes = []
      if (deleting) libraryData.notebooks.filter(function (n) { return !next.notebooks.some(function (x) { return x.notebookId === n.notebookId }) }).forEach(function (n) {
        if (Storage.deleteNotebook(n.notebookId) === false) { next.notebooks.push(n); failedDeletes.push(n.title) }
      })
      if (failedDeletes.length) Storage.saveLibrary(next)
      libraryData = next
      if (activeFolderId && !next.folders.some(function (f) { return f.folderId === activeFolderId })) activeFolderId = ''
      done(); renderLibrary()
      if (failedDeletes.length) Bridge.showToast('Some notes could not be deleted and remain in the library')
    } catch (error) { Bridge.showToast(error.message) }
  }
  function move() {
    var box = document.createElement('section'); box.className = 'notes-move-sheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Move selected items')
    var heading = document.createElement('h2'); heading.textContent = 'Move ' + selected.size + ' selected'; box.appendChild(heading)
    var choices = [{ folderId: '', name: 'Top level' }].concat(libraryData.folders)
    choices.forEach(function (folder) {
      var next; try { next = window.NotesSelection.move(libraryData, Array.from(selected), folder.folderId) } catch (_) { return }
      var button = document.createElement('button'); button.textContent = folder.folderId ? folderDisplayPath(folder) : folder.name
      button.onclick = function () { box.remove(); apply(next, false) }; box.appendChild(button)
    })
    var cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = function () { box.remove() }; box.appendChild(cancel)
    box.onkeydown = function (event) { if (event.key === 'Escape') { box.remove(); event.preventDefault() } }
    document.body.appendChild(box); cancel.focus()
  }
  function act(action) {
    if (action === 'all') { computeLibraryCells().cells.forEach(function (cell) { if (!picker || cell.data.notebookId) selected.add(key(cell.data)) }); reflect() }
    else if (action === 'none') { selected.clear(); reflect() }
    else if (action === 'done') done()
    else if (action === 'attach' && picker) picker.attach(Array.from(selected).map(function(id){return id.slice(5)}))
    else if (action === 'move' && !picker) move()
    else if (action === 'delete' && !picker) {
      var keys = Array.from(selected), count = selected.size
      showConfirm('Delete ' + count + ' selected items?', 'Selected notes will be permanently deleted. Contents of selected folders will move to their nearest remaining parent.', function () { apply(window.NotesSelection.remove(libraryData, keys), true) })
    }
  }
  var previousContextMenu = window.AppLibrary.onContextMenu
  window.AppLibrary.onContextMenu = function(item, x, y) {
    if (picker && picker.attach && item.notebookId) {
      // Android can cancel the pointer before delivering its native long-press event.
      // Select here, and ignore only the held card's compatibility click on release.
      suppressUntil = performance.now() + 800
      suppressedKey = key(item)
      start(item)
      return true
    }
    return previousContextMenu ? previousContextMenu(item, x, y) : false
  }
  var actions = window.AppLibrary.contextActions
  window.AppLibrary.contextActions = function (item) {
    var rows = !picker && actions ? actions(item) : []
    if (picker && (!picker.attach || !item.notebookId)) return rows
    if (!item.notebookId && !item.folderId) return rows
    rows.unshift({ label: selected.has(key(item)) ? 'Deselect' : 'Select', run: function () { if (selection.active) toggle(item); else start(item) } })
    return rows
  }
  // Capture taps before the shared shelf routes them into notebooks/folders.
  document.addEventListener('click', function (event) {
    var card = event.target.closest && event.target.closest('#library-view .note-card,#library-view .book-card,#library-view .folder-card')
    if (!card || (picker && !card.dataset.notebookId)) return
    var item = target(card)
    var suppressed = performance.now() < suppressUntil && (!suppressedKey || item && key(item) === suppressedKey)
    if (suppressed || selection.active) {
      event.preventDefault(); event.stopImmediatePropagation()
      if (selection.active && !suppressed && item) toggle(item)
    }
  }, true)
  document.addEventListener('pointerdown', function (event) {
    var card = event.target.closest && event.target.closest('#library-view .note-card,#library-view .book-card,#library-view .folder-card')
    if (!card || event.button > 0 || (picker && !card.dataset.notebookId)) return
    if (selection.active) { event.stopImmediatePropagation(); return }
    if (card.dataset.notebookId && window.AppLibrary.folderDragEnabled) return
    var item = target(card), x = event.clientX, y = event.clientY
    clearTimeout(longTimer)
    longTimer = setTimeout(function () { if (item) { suppressUntil = performance.now() + 800; suppressedKey=key(item);showContextMenu(x, y, item) } }, 650)
  }, true)
  ;['pointerup','pointercancel','pointermove'].forEach(function (name) { document.addEventListener(name, function () { clearTimeout(longTimer) }, true) })
  document.addEventListener('keydown', function (event) {
    if (!selection.active) return
    if (event.key === 'Escape') { done(); event.preventDefault() }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { act('all'); event.preventDefault() }
    else if (event.key === ' ' || event.key === 'Enter') {
      var card = event.target.closest && event.target.closest('#library-view .note-card,#library-view .book-card,#library-view .folder-card')
      if (card) { var item = target(card); if (item) toggle(item); event.preventDefault() }
    }
  })
  var hooks = window.KalamosAppHooks, ready = hooks.onLibraryReady
  hooks.onLibraryReady = function () { if (ready) ready(); var grid = document.getElementById('grid'); if (grid && !observer) { observer = new MutationObserver(reflect); observer.observe(grid, { childList: true }); } }
  window.KalamosNotesSelection = { start: start, done: done,
    configurePicker:function(options){done();picker=options},
    isActive:function(){return selection.active}
  }
})()
