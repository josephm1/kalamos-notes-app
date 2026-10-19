// Notes library chrome follows the supplied reference. All notebooks use the canonical
// ruled workspace; there is no separate app-owned handwriting editor.
// Planning uses the shared writing feature's focused ruled-line workspace. The bundle exposes a direct notebook
// mode: Notes gets writing, spacing, blank-line, caret/select, erase, magnify, undo, and recognition
// tools without Write's Markdown reader, file UI, or AI panel. The root build packages the feature
// library directly, so Notes never reaches into another app or checkout.
document.write('<link rel="stylesheet" href="css/write-workspace.css">');
document.write('<link rel="stylesheet" href="css/notes-writing-ui.css">');
document.write('<script src="js/write-workspace.js"><\/script>');
document.write('<script src="js/notebook-migration.js"><\/script>');
(function () {
  'use strict'

  // Custom Notes gestures own long press; suppress the browser's selection/context menu.
  document.addEventListener('contextmenu', function (event) { event.preventDefault() }, true)

  // IMPORTANT: bridge.js declares `const Bridge = {...}` at script scope. That makes Bridge directly
  // accessible to later classic scripts such as this one, but it does NOT create `window.Bridge`.
  // Never guard these calls with `window.Bridge`: that check is always false and silently disables
  // the initial toolbar/rail bake. The resulting device symptom is especially misleading—the bars
  // open blank, while controls appear individually after a tap because the targeted snapshot path
  // calls Bridge directly. This exact regression caused the July 2026 blank-on-open investigation.
  // Use `typeof Bridge !== 'undefined'` so the same overlay also remains safe in non-native previews.

  window.AppLibrary = window.AppLibrary || {}
  window.AppLibrary.folderDragEnabled = true
  function planningEditor() {
    return typeof window.KalamosWriteWorkspace !== 'undefined' ? window.KalamosWriteWorkspace : null
  }

  // The shared shell delegates hardware Back, page keys, and lifecycle changes to AppMode. Planning
  // commits through the workspace's real Done path on Back so spacing transforms and native strokes
  // are finalized before the surface closes.
  window.AppMode = {
    openNotebook: function (id) {
      try {
        window.KalamosNotesMigration.ensure(id)
        const editor = planningEditor()
        if (!editor) throw new Error('Writing editor is unavailable')
        editor.openWorkspaceNotebook(id)
      } catch (error) { toast('Notebook could not be opened: ' + error.message) }
      // A failed migration must stay on the shelf, never fall through to a blank legacy editor.
      return true
    },
    onNewIntent: function () { void receiveSharedMarkdown() },
    onBack: function () {
      if (window.KalamosNotesAI?.closeSettings()) return true
      const editor = planningEditor()
      if (!editor || !editor.isOpen()) return false
      if (!editor.finishWorkspace()) editor.close(true)
      return true
    },
    onPageKey: function (dir) { const editor = planningEditor(); if (editor && editor.isOpen()) editor.onPageKey(dir) },
    onPauseApp: function () {
      const editor = planningEditor()
      if (editor && editor.isOpen()) editor.onPause()
    },
    onResumeApp: function () {
      void receiveSharedMarkdown()
      const editor = planningEditor()
      if (editor && editor.isOpen()) editor.onResume()
    }
  }

  const svg = window.KalamosToolbarIcons.svg

  function toast(message) {
    if (typeof Bridge !== 'undefined' && Bridge.showToast) Bridge.showToast(message)
  }

  function buildLibraryChrome() {
    const header = document.getElementById('header')
    const title = document.getElementById('header-title')
    const settings = document.getElementById('btn-settings')
    if (!header || !title || !settings) return
    // App.start owns this call after the neutral shell exists. Keep it idempotent so a cached
    // WebView cannot duplicate controls if startup is requested again after a fragment reattach.
    if (header.dataset.notesChromeMounted === 'true') return
    header.dataset.notesChromeMounted = 'true'
    const folderBack = document.getElementById('btn-folder-back')
    if (folderBack) {
      folderBack.innerHTML = svg('prev')
      folderBack.title = 'Parent folder'
      folderBack.setAttribute('aria-label', 'Parent folder')
    }

    title.textContent = 'All my notebooks'
    title.dataset.homeTitle = 'All my notebooks'
    title.classList.add('notes-library-title')

    // Shelf actions share one anchored menu. Close on outside pointer input or Escape;
    // remove listeners with the menu so reopening never accumulates handlers.
    function openShelfMenu(id, label, entries, anchor) {
      const existing = document.getElementById(id)
      if (existing) { existing.dispatchEvent(new Event('notes-menu-close')); return }
      document.querySelectorAll('.notes-shelf-menu').forEach(function (menu) { menu.dispatchEvent(new Event('notes-menu-close')) })
      const menu = document.createElement('div')
      menu.id = id
      menu.className = 'notes-shelf-menu'
      menu.setAttribute('role', 'dialog')
      menu.setAttribute('aria-label', label)
      function close() {
        menu.remove(); anchor.setAttribute('aria-expanded', 'false')
        document.removeEventListener('pointerdown', outside, true)
        document.removeEventListener('keydown', escape)
      }
      function outside(event) { if (!menu.contains(event.target) && !anchor.contains(event.target)) close() }
      function escape(event) { if (event.key === 'Escape') { close(); anchor.focus(); event.preventDefault() } }
      menu.addEventListener('notes-menu-close', close)
      entries.forEach(function (entry) {
        const button = document.createElement('button')
        button.type = 'button'
        button.innerHTML = svg(entry[1]) + '<span>' + entry[0] + '</span>'
        button.addEventListener('click', function () { close(); entry[2]() })
        menu.appendChild(button)
      })
      document.body.appendChild(menu)
      anchor.setAttribute('aria-expanded', 'true')
      document.addEventListener('pointerdown', outside, true)
      document.addEventListener('keydown', escape)
    }

    function footerButton(className, label, iconName, action) {
      const control = document.createElement('button')
      control.type = 'button'
      control.className = 'notes-footer-btn ' + className
      control.title = label
      control.setAttribute('aria-label', label)
      control.innerHTML = svg(iconName)
      control.addEventListener('click', action)
      return control
    }

    function shelfPager(pagination, onFirst, onLast) {
      pagination.classList.add('notes-dock-pagination')
      const pager = document.createElement('div'); pager.className = 'notes-footer-pager'
      const first = footerButton('notes-first-btn', 'First page', 'first', onFirst)
      const last = footerButton('notes-last-btn', 'Last page', 'last', onLast)
      pager.append(first, pagination, last)
      return {pager: pager, sync: function () { syncPagination(pagination, first, last) }}
    }

    function syncPagination(pagination, first, last) {
      const label = pagination.querySelector('.page-label')
      let current = 1
      let total = 1
      if (label) {
        const match = label.textContent.match(/(?:Page\s+)?(\d+)\s*(?:\/|of)\s*(\d+)/i)
        if (match) {
          current = Number(match[1])
          total = Number(match[2])
          const wanted = 'Page ' + current + ' of ' + total
          label.setAttribute('aria-label', wanted)
          label.textContent = current + ' / ' + total
        }
      }
      const sharedButtons = pagination.querySelectorAll('.page-btn')
      if (sharedButtons[0] && !sharedButtons[0].dataset.notesIcon) {
        sharedButtons[0].dataset.notesIcon = 'previous'
        sharedButtons[0].title = 'Previous page'
        sharedButtons[0].setAttribute('aria-label', 'Previous page')
        sharedButtons[0].innerHTML = svg('prev')
      }
      if (sharedButtons[1] && !sharedButtons[1].dataset.notesIcon) {
        sharedButtons[1].dataset.notesIcon = 'next'
        sharedButtons[1].title = 'Next page'
        sharedButtons[1].setAttribute('aria-label', 'Next page')
        sharedButtons[1].innerHTML = svg('next')
      }
      first.disabled = current <= 1
      last.disabled = current >= total
    }


    const densityStorageKey = 'kalamos.notes.libraryDensity'
    function supportedDensities() { return window.innerWidth <= 680 ? [2, 3] : [2, 3, 4] }
    let libraryDensity = 3
    try {
      const savedDensity = Number(window.localStorage.getItem(densityStorageKey))
      if (supportedDensities().indexOf(savedDensity) !== -1) libraryDensity = savedDensity
    } catch (e) {}

    // Fill the available shelf with complete portrait cards. Width and height both constrain
    // previews; fixed width caps leave wasted space after chrome is reduced or on larger screens.
    // Retain a legibility floor on genuinely short windows and paginate fewer rows there.
    function notesShelfLayout(gridWidth, gridHeight, density, columnGap, rowGap, paddingX, paddingY) {
      const usableWidth = Math.max(1, gridWidth - paddingX - columnGap * (density - 1))
      let cardWidth = usableWidth / density
      const captionHeight = density === 4 ? 32 : 40
      const usableHeight = Math.max(1, gridHeight - paddingY)
      const rowLimit = gridWidth <= 680 ? Math.min(2, Math.floor(6 / density)) : density
      // Reserve a few pixels for folder tabs and DOM rounding, then fit the preferred rows.
      // Selection/search strips reduce previews rather than doubling the usual page count.
      const fitWidth = ((usableHeight - 8 - rowGap * (rowLimit - 1)) / rowLimit - captionHeight) * 86 / 131
      cardWidth = Math.min(cardWidth, Math.max(Math.min(cardWidth, 110), fitWidth))
      cardWidth = Math.floor(cardWidth * 2) / 2
      const cardHeight = cardWidth * 131 / 86 + captionHeight
      const rows = Math.max(1, Math.min(rowLimit,
        Math.floor((usableHeight + rowGap) / (cardHeight + rowGap))))
      return { columns: density, rows: rows, pageSize: density * rows, cardWidth: cardWidth }
    }

    // Both the library and integration picker consume these canonical shelf primitives.
    window.KalamosNotesShelfUI = { enterPicker:enterShelfPicker, footerButton:footerButton }
    let shelfLayoutFrame = 0
    function scheduleShelfLayout() {
      cancelAnimationFrame(shelfLayoutFrame)
      shelfLayoutFrame = requestAnimationFrame(function () {
        const grid = document.getElementById('grid')
        if (!grid || !grid.clientWidth || !grid.clientHeight) return
        if (window.innerWidth <= 680 && libraryDensity > 3) {
          libraryDensity = 3
          grid.dataset.notesDensity = '3'
        }
        const style = getComputedStyle(grid)
        const px = function (name) { return parseFloat(style.getPropertyValue(name)) || 0 }
        const layout = notesShelfLayout(
          grid.clientWidth, grid.clientHeight, libraryDensity,
          px('column-gap'), px('row-gap'),
          px('padding-left') + px('padding-right'),
          px('padding-top') + px('padding-bottom')
        )
        grid.style.setProperty('--notes-rows', String(layout.rows))
        grid.style.setProperty('--notes-card-max', layout.cardWidth + 'px')
        if (typeof libraryItemsPerPage === 'function' &&
            typeof setLibraryPageSize === 'function' &&
            libraryItemsPerPage() !== layout.pageSize) {
          setLibraryPageSize(layout.pageSize)
        }
      })
    }

    function applyLibraryDensity(density, persist) {
      if (supportedDensities().indexOf(density) === -1) return
      libraryDensity = density
      const grid = document.getElementById('grid')
      if (grid) grid.dataset.notesDensity = String(density)
      if (persist) {
        try { window.localStorage.setItem(densityStorageKey, String(density)) } catch (e) {}
      }
      scheduleShelfLayout()
    }

    // Match the Books footer exactly while keeping the shared Notes pagination controls canonical.
    // #pager-controls is rendered by library-controller.js; display:contents places its generated
    // previous/label/next controls between Notes-owned first and last buttons.
    const pagination = document.getElementById('pagination')
    if (pagination) {
      pagination.classList.add('notes-dock-pagination')
      const footer = document.createElement('footer')
      footer.id = 'notes-library-footer'
      footer.setAttribute('aria-label', 'Notebook navigation')

      const menuButton = footerButton('notes-menu-btn', 'Library menu', 'menu', function () {
        openShelfMenu('notes-library-menu', 'Library menu', [
          ['Search notebooks', 'search', openSearch],
          ['Library settings', 'settings', openLibrarySettings],
          ['AI settings', 'ai', function () { window.KalamosNotesAI.openSettings() }],
          ['Import Markdown', 'text', function () { Bridge.importTextDocument() }]
        ], menuButton)
      })
      menuButton.setAttribute('aria-haspopup', 'dialog')
      menuButton.setAttribute('aria-expanded', 'false')
      footer.appendChild(menuButton)

      const navigation = shelfPager(pagination, function () {
        if (libraryPage > 0) { libraryPage = 0; renderGrid() }
      }, function () {
        const total = Math.max(1, Math.ceil(computeLibraryCells().cells.length / libraryItemsPerPage()))
        if (libraryPage < total - 1) { libraryPage = total - 1; renderGrid() }
      })
      footer.appendChild(navigation.pager)

      const create = document.createElement('div')
      create.className = 'notes-footer-create'
      create.setAttribute('role', 'group')
      create.setAttribute('aria-label', 'Create')
      const note = footerButton('notes-new-note-btn', 'New note', 'newNote', openCreateDialog)
      const folder = footerButton('notes-new-folder-btn', 'New folder', 'newFolder', function () {
        if (typeof createNewFolder === 'function') createNewFolder()
      })
      ;[[note, 'Note'], [folder, 'Folder']].forEach(function (entry) {
        const caption = document.createElement('span')
        caption.textContent = entry[1]
        entry[0].appendChild(caption)
        create.appendChild(entry[0])
      })
      footer.appendChild(create)

      function openLibrarySettings() {
        if (document.getElementById('notes-library-settings')) return
        const overlay = document.createElement('div')
        overlay.className = 'modal-overlay'
        overlay.id = 'notes-library-settings'
        const panel = document.createElement('section')
        panel.className = 'modal notes-library-settings-panel'
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-modal', 'true')
        panel.setAttribute('aria-label', 'Library settings')
        const heading = document.createElement('h2')
        heading.textContent = 'Library settings'
        panel.appendChild(heading)
        const choices = document.createElement('fieldset')
        const legend = document.createElement('legend')
        legend.textContent = 'Notebooks per screen'
        choices.appendChild(legend)
        const grid = document.getElementById('grid')
        const style = getComputedStyle(grid)
        const px = function (name) { return parseFloat(style.getPropertyValue(name)) || 0 }
        supportedDensities().forEach(function (density) {
          const layout = notesShelfLayout(grid.clientWidth, grid.clientHeight, density,
            px('column-gap'), px('row-gap'), px('padding-left') + px('padding-right'),
            px('padding-top') + px('padding-bottom'))
          const label = document.createElement('label')
          const radio = document.createElement('input')
          radio.type = 'radio'
          radio.name = 'notes-library-density'
          radio.value = String(density)
          radio.checked = density === libraryDensity
          const text = document.createElement('span')
          text.textContent = layout.pageSize + ' notes (' + layout.columns + ' × ' + layout.rows + ')'
          label.append(radio, text)
          radio.addEventListener('change', function () {
            if (radio.checked) applyLibraryDensity(density, true)
          })
          choices.appendChild(label)
        })
        panel.appendChild(choices)
        const actions = document.createElement('div')
        actions.className = 'notes-settings-actions'
        const storage = document.createElement('button')
        storage.textContent = 'Storage settings'
        storage.onclick = function () { close(); settings.click() }
        const done = document.createElement('button')
        done.textContent = 'Close'
        done.onclick = close
        actions.append(storage, done)
        panel.appendChild(actions)
        overlay.appendChild(panel)
        function close() { overlay.remove(); document.removeEventListener('keydown', onKey); menuButton.focus() }
        function onKey(event) { if (event.key === 'Escape') { event.preventDefault(); close() } }
        overlay.addEventListener('click', function (event) { if (event.target === overlay) close() })
        document.addEventListener('keydown', onKey)
        document.body.appendChild(overlay)
        done.focus()
      }

      function syncFooter() { navigation.sync() }

      document.getElementById('library-view').appendChild(footer)
      applyLibraryDensity(libraryDensity, false)
      window.addEventListener('resize', scheduleShelfLayout)
      // Selection/search chrome changes available height without resizing the window.
      // Observe the actual content area so only complete rows are paginated in every state.
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(scheduleShelfLayout).observe(document.getElementById('grid'))
      }
      // App.start mounts this chrome after DOMContentLoaded has fired. Register immediately.
      {
        const sharedRenderPagination = window.renderPagination
        if (typeof sharedRenderPagination === 'function') {
          window.renderPagination = function (totalPages, folderCount, fileCount) {
            sharedRenderPagination(totalPages, folderCount, fileCount)
            syncFooter()
          }
        }
        syncFooter()
        scheduleShelfLayout()
      }
    }
    settings.classList.add('notes-original-settings')
  }

  // Selection is a mode of the real shelf. Keep its DOM, renderer, paging, density and
  // selection controller; only replace unavailable creation/menu actions and the open route.
  function enterShelfPicker(options) {
    const view = document.getElementById('library-view')
    const footer = document.getElementById('notes-library-footer')
    const menu = footer.querySelector('.notes-menu-btn')
    const create = footer.querySelector('.notes-footer-create')
    const open = App.showEditor
    const previousRendered = window.AppLibrary.onLibraryRendered
    const previousReadOnly = window.AppLibrary.readOnly
    const status = document.createElement('p'); status.className='notes-picker-status'; status.setAttribute('role','status')
    const search = window.KalamosNotesShelfUI.footerButton('notes-search-btn','Search notebooks','search',openSearch)
    function goBack(){
      if(contextMenuEl){removeContextMenu();return}
      if(window.KalamosNotesSelection.isActive()){window.KalamosNotesSelection.done();return}
      if(!libraryNavigateUp())options.cancel()
    }
    const pickerBack=window.KalamosNotesShelfUI.footerButton('notes-picker-back',options.exitLabel || 'Back','close',goBack)
    menu.replaceWith(pickerBack,search); create.remove(); view.classList.add('notes-picker-mode')
    view.insertBefore(status,document.getElementById('grid'))
    window.AppLibrary.readOnly=true
    window.KalamosNotesSelection.configurePicker(options)
    App.showEditor=options.open
    function reflectNavigation(){
      if(previousRendered)previousRendered()
      pickerBack.title=activeFolderId?'Parent folder':options.exitLabel || 'Back'
      pickerBack.setAttribute('aria-label',pickerBack.title)
      pickerBack.innerHTML=svg(activeFolderId?'prev':'close')
    }
    window.AppLibrary.onLibraryRendered=reflectNavigation
    let finished=false
    function finish(){
      if(finished)return;finished=true
      removeContextMenu()
      window.KalamosNotesSelection.configurePicker(null)
      App.showEditor=open;window.AppLibrary.readOnly=previousReadOnly
      window.AppLibrary.onLibraryRendered=previousRendered
      pickerBack.replaceWith(menu);search.remove();footer.appendChild(create);status.remove()
      document.getElementById('notes-search-bar')?.remove();window.AppLibrary.searchQuery=''
      view.classList.remove('notes-picker-mode');renderLibrary()
    }
    renderLibrary()
    return {body:view,status:status,finish:finish,back:goBack}
  }

  function searchBar(onQuery, onClose) {
    const bar = document.createElement('div'); bar.className = 'notes-search-bar'
    bar.innerHTML = svg('search') + '<input type="search" placeholder="Search notebooks" aria-label="Search notebooks"><button aria-label="Close">×</button>'
    bar.querySelector('input').addEventListener('input', onQuery)
    bar.querySelector('button').addEventListener('click', onClose)
    return bar
  }

  function openSearch() {
    let bar = document.getElementById('notes-search-bar')
    function close() { bar.remove(); window.AppLibrary.searchQuery='';libraryPage=0;renderLibrary() }
    if (bar) { close(); return }
    bar = searchBar(function () {
      window.AppLibrary.searchQuery=bar.querySelector('input').value.trim()
      libraryPage=0;renderLibrary()
    }, close)
    bar.id = 'notes-search-bar'
    const view = document.getElementById('library-view')
    view.insertBefore(bar, document.getElementById('grid'))
    bar.querySelector('input').focus()
  }

  let releasedPenTap = null
  document.addEventListener('click', function (e) {
    const tap = releasedPenTap
    if (!e.isTrusted || !tap || performance.now() - tap.time > 500) return
    if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) return
    // Keep the guard after a Done/action removes its sheet: Android can deliver the
    // compatibility click to the control now exposed underneath that same point.
    e.preventDefault(); e.stopImmediatePropagation(); releasedPenTap = null
  }, true)

  function protectPanelInput(p) {
    let down = null
    p.addEventListener('pointerdown', function (e) {
      e.stopPropagation()
      const b = e.target.closest('button')
      down = e.pointerType === 'pen' && b ? { id: e.pointerId, x: e.clientX, y: e.clientY, b: b } : null
    })
    p.addEventListener('pointercancel', function () { down = null })
    p.addEventListener('pointerup', function (e) {
      if (!down || down.id !== e.pointerId) return
      const tap = down; down = null
      if (e.target.closest('button') !== tap.b || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) return
      e.preventDefault(); e.stopPropagation()
      releasedPenTap = { time: performance.now(), x: e.clientX, y: e.clientY }; tap.b.click()
    })

  }

  // The high-water counter survives renames and deletions; existing names also
  // protect imported libraries from collisions. Opening/cancelling consumes no number.
  function nextNotebookNumber() {
    let number = Number(localStorage.getItem('notes.notebookCounter')) || 0
    if (!Number.isSafeInteger(number) || number < 0) number = 0
    ;(libraryData.notebooks || []).forEach(function (nb) {
      const match = /^Notebook (\d+)$/.exec(nb.title || '')
      if (match && Number.isSafeInteger(Number(match[1]))) number = Math.max(number, Number(match[1]))
    })
    return Math.floor(Math.max(0, number)) + 1
  }

  function openCreateDialog() {
    const number = nextNotebookNumber()
    const defaultTitle = 'Notebook ' + number
    const editor = window.KalamosWriteWorkspace
    let custom = []
    try {
      const response = window.AB && window.AB.call('notes.templates.list', {})
      const data = typeof response === 'string' ? JSON.parse(response) : response
      custom = editor.registerCustomTemplates(data?.templates || [])
    } catch (error) { console.warn('[notes-custom-templates]',error) }
    const templates = editor.templates.concat(custom)
    let selected = 'ruled'
    // Counts change only after successful creation; browsing/cancelling never counts as reuse.
    let usage = {}
    try { usage = JSON.parse(localStorage.getItem('notes.templateUsage') || '{}') || {} } catch (_) {}
    let category = Object.keys(usage).length ? 'Recent' : 'Personal'
    let page = 0
    const overlay = document.createElement('div')
    overlay.className = 'notes-create-overlay'
    overlay.innerHTML = '<div class="notes-create-dialog" role="dialog" aria-modal="true" aria-label="Create notebook"><h2 class="notes-create-heading">' + svg('newNote') + 'New notebook</h2><label>Notebook name<input type="text" maxlength="120" autocomplete="off"></label><fieldset class="notes-template-picker"><legend>Template</legend><div class="notes-template-categories" role="tablist" aria-label="Template categories"></div><div class="notes-template-content"><div class="notes-template-grid"></div><div class="notes-template-pagination"></div></div></fieldset><div class="notes-create-actions"><button class="cancel">Cancel</button><button class="create">Create</button></div></div>'
    overlay.style.setProperty('--notes-preview-ratio', window.innerWidth + ' / ' + window.innerHeight)
    overlay.style.setProperty('--notes-preview-aspect', String(window.innerWidth/window.innerHeight))
    const nameInput = overlay.querySelector('input'); nameInput.value = defaultTitle
    const cards = new Map()
    const categoryButtons = new Map()
    ;['Recent','Work','Study','Personal','Custom'].forEach(function (name) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name
      button.setAttribute('role','tab')
      button.id='notes-template-tab-'+name.toLowerCase()
      button.setAttribute('aria-controls','notes-template-panel')
      button.addEventListener('keydown', function(event) {
        const tabs=Array.from(categoryButtons.values()), index=tabs.indexOf(button)
        const next=event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowLeft' ? (index+tabs.length-1)%tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : -1
        if (next>=0) { event.preventDefault(); tabs[next].click(); tabs[next].focus() }
      })
      button.addEventListener('click', function () { category = name; page = 0; renderCatalogue() })
      categoryButtons.set(name,button); overlay.querySelector('.notes-template-categories').appendChild(button)
    })
    templates.forEach(function (template) {
      const button = document.createElement('button'); button.type = 'button'
      button.className = 'notes-template-card'; button.dataset.template = template.id
      button.setAttribute('aria-label', template.name + ' template')
      button.innerHTML = '<span class="notes-template-sheet" aria-hidden="true"></span><span class="notes-template-caption"><span class="notes-template-check" aria-hidden="true">✓</span>' + '</span>'
      button.querySelector('.notes-template-caption').appendChild(document.createTextNode(template.name))
      button.addEventListener('click', function () { selected = template.id; reflectTemplate() })
      cards.set(template.id,button)
    })
    function renderCatalogue() {
      let visible = templates.filter(function (t) {
        if (category === 'Recent') return usage[t.id] && usage[t.id].count > 0
        return t.category === category
      })
      if (category === 'Recent') visible = visible.slice().sort(function (a,b) {
        return usage[b.id].lastUsed - usage[a.id].lastUsed
      })
      const total = Math.max(1,Math.ceil(visible.length/3)); page = Math.min(page,total-1)
      const currentPage = visible.slice(page*3,page*3+3)
      if (currentPage.length && !currentPage.some(function(t){return t.id === selected})) selected=currentPage[0].id
      overlay.querySelector('.create').disabled = !currentPage.length
      categoryButtons.forEach(function (button,name) { button.setAttribute('aria-selected',String(category === name)); button.tabIndex=category === name ? 0 : -1 })
      const grid = overlay.querySelector('.notes-template-grid'); grid.id='notes-template-panel'; grid.setAttribute('role','tabpanel'); grid.setAttribute('aria-labelledby',categoryButtons.get(category).id); grid.replaceChildren()
      visible.slice(page*3,page*3+3).forEach(function (template) {
        const button = cards.get(template.id); grid.appendChild(button)
        if (!button.dataset.previewLoaded) {
          button.dataset.previewLoaded = 'true'
          // Same model and vector renderer as the notebook, never symbolic thumbnails.
          editor.previewTemplate(template.id).then(function (preview) {
            if (overlay.isConnected) button.querySelector('.notes-template-sheet').innerHTML = preview
          }).catch(function (error) { delete button.dataset.previewLoaded; console.warn('[notes-template-preview]',error) })
        }
      })
      // Reserve all three slots even on the last/empty page: chooser geometry stays stable.
      for (let slot=currentPage.length;slot<3;slot++) {
        const placeholder=document.createElement('span'); placeholder.className='notes-template-card notes-template-placeholder'
        placeholder.setAttribute('aria-hidden','true'); placeholder.innerHTML='<span class="notes-template-sheet"></span><span class="notes-template-caption">&nbsp;</span>'; grid.appendChild(placeholder)
      }
      if (!visible.length) { const empty=document.createElement('p'); empty.className='notes-template-empty'; empty.textContent=category === 'Custom' ? 'No custom templates yet.' : 'Your recently used templates appear here.'; grid.appendChild(empty) }
      const pager = overlay.querySelector('.notes-template-pagination'); pager.replaceChildren()
      { // Navigation remains visible on 1 / 1 pages, in the same position.
        ;[-1,1].forEach(function (direction) {
          const button=document.createElement('button'); button.type='button'; button.innerHTML=svg(direction<0?'prev':'next'); button.setAttribute('aria-label',direction<0?'Previous template page':'Next template page')
          button.disabled=direction<0?page===0:page===total-1
          button.addEventListener('click',function(){page+=direction;renderCatalogue()}); pager.appendChild(button)
        })
        const label=document.createElement('span'); label.textContent=(page+1)+' / '+total; pager.insertBefore(label,pager.lastChild)
      }
      reflectTemplate()
    }
    function reflectTemplate() {
      overlay.querySelectorAll('.notes-template-card').forEach(function (button) {
        button.setAttribute('aria-pressed', String(button.dataset.template === selected))
      })
    }
    renderCatalogue()
    overlay.querySelector('.cancel').addEventListener('click', function () { overlay.remove() })
    overlay.querySelector('.create').addEventListener('click', async function () {
      const createButton = overlay.querySelector('.create')
      if (createButton.disabled) return
      const desiredTitle = nameInput.value.trim() || defaultTitle
      createButton.disabled = true
      try {
        const starter = await editor.createTemplate(selected, desiredTitle)
        createPlanningNotebook(desiredTitle, starter)
        localStorage.setItem('notes.notebookCounter', String(number))
        usage[selected] = {count: (Number(usage[selected]?.count) || 0)+1, lastUsed: Date.now()}
        localStorage.setItem('notes.templateUsage',JSON.stringify(usage))
        overlay.remove()
      } catch (error) { console.warn('[notes-create]', error); toast('Notebook could not be created'); createButton.disabled = false }
    })
    protectPanelInput(overlay)
    document.body.appendChild(overlay)
    // Numbered names usually need no typing. Avoid opening the Android keyboard and squeezing
    // the template chooser before the user has chosen to edit the name.
    ;(overlay.querySelector('.notes-template-card[aria-pressed="true"]') || categoryButtons.get(category)).focus()
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') overlay.querySelector('.cancel').click()
      if (event.key === 'Enter' && event.target === nameInput) overlay.querySelector('.create').click()
      if (event.key === 'Tab') {
        const controls = Array.from(overlay.querySelectorAll('button:not(:disabled),input')).filter(function (el) { return el.getClientRects().length })
        if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus() }
        else if (!event.shiftKey && event.target === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus() }
      }
    })
  }

  function createPlanningNotebook(title, imported) {
    title = window.KalamosNotesNames.unique(title, libraryData.notebooks.map(function (note) { return note.title }))
    // The shared library schema still requires one page record, but Planning
    // never opens the legacy page/template editor. Make that compatibility
    // record explicitly blank; the ruled lines and all ink now belong only to
    // KalamosWriteWorkspace, preventing two template renderers from sharing a
    // notebook or native buffer.
    const blankCompatibilityTemplate = { type: 'blank', spacing: 0, margin: 0 }
    const nb = createNotebook(
      title,
      typeof activeFolderId !== 'undefined' && activeFolderId !== '' ? activeFolderId : '',
      blankCompatibilityTemplate
    )
    if(imported?.notebookId){nb.notebookId=imported.notebookId;libraryData.notebooks=libraryData.notebooks.filter(note=>note.notebookId!==nb.notebookId)}
    nb.kind = 'planning'
    libraryData.notebooks.push({
      notebookId: nb.notebookId, title: nb.title, folderId: nb.folderId,
      createdAt: nb.createdAt, updatedAt: nb.updatedAt, defaultTemplate: nb.defaultTemplate
    })
    Storage.saveNotebook(nb)
    if (imported) {
      const result = Bridge.saveNotebookFile(nb.notebookId, 'planning.write2.md', imported.source)
      if (String(result).startsWith('error')) { toast('Markdown could not be saved'); return }
      if (imported.sidecar) Bridge.saveNotebookFile(nb.notebookId, 'planning.write2.json', JSON.stringify(imported.sidecar))
      if (imported.template) Bridge.saveNotebookFile(nb.notebookId, 'planning.pages.json', JSON.stringify({version:1,active:0,template:imported.template,pages:[{id:'first',sourceFile:'planning.write2.md',sidecarFile:'planning.write2.json'}]}))
      if (Array.isArray(imported.sheets) && imported.sheets.length) {
        const index = {version:1,active:0,pages:[]}
        imported.sheets.forEach(function(sheet,i) {
          if (!sheet || typeof sheet.source !== 'string') throw new Error('Invalid imported sheet')
          const page = i === 0 ? {id:'first',sourceFile:'planning.write2.md',sidecarFile:'planning.write2.json'}
            : {id:'import'+i,sourceFile:'planning.page-import'+i+'.md',sidecarFile:'planning.page-import'+i+'.json'}
          if (Bridge.saveNotebookFile(nb.notebookId,page.sourceFile,sheet.source) !== 'ok') throw new Error('Sheet could not be saved')
          if (sheet.sidecar && Bridge.saveNotebookFile(nb.notebookId,page.sidecarFile,JSON.stringify(sheet.sidecar)) !== 'ok') throw new Error('Sheet ink could not be saved')
          index.pages.push(page)
          if(i) nb.pages.push({pageId:page.id,template:blankCompatibilityTemplate,strokes:[]})
        })
        if (Bridge.saveNotebookFile(nb.notebookId,'planning.pages.json',JSON.stringify(index)) !== 'ok') throw new Error('Page index could not be saved')
        Storage.saveNotebook(nb)
      }
    }
    saveLibrary()
    renderLibrary()
    if (typeof recordNotebookOpened === 'function') recordNotebookOpened(nb.notebookId)
    const editor = planningEditor()
    if (editor) editor.openWorkspaceNotebook(nb.notebookId)
    else toast('Planning editor is unavailable')
    return nb.notebookId
  }

  const escapeDocumentText = function (text) { return String(text).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c] }) }
  async function exportNotePdf(target) {
    try {
      const nb = Storage.loadMeta(target.notebookId)
      if(!nb) return
      window.KalamosNotesMigration.ensure(target.notebookId)
      const pages = await planningEditor().exportNotebookPages(target.notebookId)
      const html = '<!doctype html><html><head><meta charset="utf-8"><title>'+escapeDocumentText(nb.title)+'</title><style>@page{size:A4;margin:0}body{margin:0;background:white}section{page-break-after:always;width:210mm;height:297mm;display:flex;align-items:flex-start;justify-content:center}section:last-child{page-break-after:auto}svg{width:100%;height:100%;object-fit:contain}@media screen{section{width:100%;height:auto;aspect-ratio:210/297}svg{width:100%;height:auto;aspect-ratio:210/297}}</style></head><body>'+pages.map(function(svg){return '<section>'+svg+'</section>'}).join('')+'</body></html>'
      Bridge.exportDocumentPdf(nb.title,html)
    } catch(e) { toast('PDF export failed: '+e.message) }
  }
  async function shareNotebookMarkdown(target) {
    try {
      window.KalamosNotesMigration.ensure(target.notebookId)
      const text = await planningEditor().getNotebookMarkdown(target.notebookId)
      if(!text.trim())throw new Error('This note has no Markdown text. Use Share to send its pages as images.')
      const result = AB.call('notes.share.markdown', {title:target.title||'Notebook',text:text})
      if(result.err)throw new Error(result.err)
    } catch(e) { toast('Markdown share failed: '+e.message) }
  }
  const previousContextActions = window.AppLibrary.contextActions
  window.AppLibrary.contextActions = function(target) {
    const actions = previousContextActions ? previousContextActions(target) : []
    if(!target.notebookId) return actions
    actions.push({label:'Export PDF',run:function(){void exportNotePdf(target)}})
    const nb=Storage.loadMeta(target.notebookId)
    if(nb) actions.push({label:'Share Markdown',run:function(){void shareNotebookMarkdown(target)}})
    return actions
  }
  window.onMarkdownImported = async function(imported) {
    try {
      if(typeof imported === 'string') imported=JSON.parse(imported)
      let source=imported.text, sidecar, sheets
      if(typeof source !== 'string' || source.includes('\u0000')) throw new Error('Choose a Markdown text file')
      const match=source.match(/\n\n<!-- kalamos-planning:start -->\n<!-- kalamos-planning:([^\n]+) -->/)
      if(match) {
        const record=JSON.parse(decodeURIComponent(match[1]))
        // Keep edits made in another Markdown editor; only restore embedded placement when
        // the readable source still matches the original export.
        source=source.slice(0,match.index)
        if(source === record.source) { sidecar=record.sidecar; sheets=record.sheets }
      }
      if(!sheets && !sidecar) {
        sheets=await planningEditor().createMarkdownSheets(source,(imported.name||'Imported note').replace(/\.(md|markdown)$/i,''))
        if(!sheets.length)throw Error('No editable Markdown content')
        source=sheets[0].source;sidecar=sheets[0].sidecar
      }
      if(planningEditor()?.isOpen())await planningEditor().closeAndWait(true)
      return createPlanningNotebook((imported.name||'Imported note').replace(/\.(md|markdown)$/i,''),{source:source,sidecar:sidecar,sheets:sheets,notebookId:imported.notebookId})
    } catch(e) { toast('Markdown import failed: '+e.message) }
  }

  let receivingMarkdown=false,markdownImportReady=false,markdownImportQueued=false
  async function receiveSharedMarkdown() {
    if(!markdownImportReady)return
    if(receivingMarkdown){markdownImportQueued=true;return}
    receivingMarkdown=true
    try {
      const incoming=AB.call('notes.import.pending',{})
      if(incoming.err||!incoming.requestId)return
      const existing=Storage.loadMeta(incoming.notebookId)
      if(existing && Bridge.getNotebookFile(incoming.notebookId,'planning.write2.md')) {
        if(!libraryData.notebooks.some(note=>note.notebookId===existing.notebookId)) {
          libraryData.notebooks.push({notebookId:existing.notebookId,title:existing.title,folderId:existing.folderId,createdAt:existing.createdAt,updatedAt:existing.updatedAt,defaultTemplate:existing.defaultTemplate})
        }
        if(planningEditor()?.isOpen())await planningEditor().closeAndWait(true)
        planningEditor().openWorkspaceNotebook(incoming.notebookId)
      } else {
        if(!await window.onMarkdownImported(incoming))return
      }
      if(!Storage.saveLibrary(libraryData))throw Error('Notebook library could not be saved. Please try again.')
      const result=AB.call('notes.import.ack',{requestId:incoming.requestId})
      if(result.err)throw Error(result.err)
    } catch(e){toast('Markdown import failed: '+e.message)}
    finally{receivingMarkdown=false;if(markdownImportQueued){markdownImportQueued=false;void receiveSharedMarkdown()}}
  }
  const appHooks = window.KalamosAppHooks || (window.KalamosAppHooks = {})
  appHooks.onLibraryReady = buildLibraryChrome
  const priorAppReady=appHooks.onAppReady
  appHooks.onAppReady=function(){if(priorAppReady)priorAppReady();markdownImportReady=true;void receiveSharedMarkdown()}
  document.addEventListener('click', function (event) {
    const create = event.target.closest && event.target.closest('.new-note-card')
    if (create) {
      event.preventDefault(); event.stopImmediatePropagation(); openCreateDialog()
    }
  }, true)
})()

document.write('<script src="js/notes-names.js"><\/script>');
document.write('<script src="js/notes-selection-model.js"><\/script>');
document.write('<script src="js/notes-selection.js"><\/script>');
document.write('<script src="js/agora-documents.js"><\/script>');

document.write('<script src="js/notes-ai-settings.js"><\/script>');
