// Single-page router. Library and editor are two views inside ONE WebView; switching just toggles
// which is visible (no page reload, no WebView swap, no fragment teardown). The editor view sits
// over a native base-layer ink surface (the visible writing layer); the library view is a plain
// opaque WebView. Bridge.enterEditor/enterLibrary tell native which mode to present.
const App = {
  current: null,        // 'library' | 'editor' | 'book' | 'epub' | ...
  editorInited: false,  // initEditor() measures layout, so run it lazily on first editor show
  // The book/epub reader currently open (BookReader or EpubReader) — set by whichever one .open()s, so
  // onAndroidBack/onPageKey can delegate to it without hardcoding a branch per reader type (AD-5).
  activeReader: null,

  start() {
    this.applyConfig()                                  // per-app branding (title/header) from app-config.js
    initLibrary()                                       // render the grid from the index
    // App chrome can only mount after initLibrary has created the neutral library shell. Loading an
    // app overlay earlier and asking it to probe for #header made startup order decide which UI the
    // user saw: a missed probe silently left the legacy neutral chrome in place. Give app overlays
    // one explicit, deterministic ownership boundary instead.
    const hooks = window.KalamosAppHooks
    if (hooks && typeof hooks.onLibraryReady === 'function') hooks.onLibraryReady()
    document.getElementById('editor-view').style.display = 'none'
    document.getElementById('library-view').style.display = 'flex'
    this.current = 'library'
    Bridge.enterLibrary()                               // native: hide ink surface, opaque WebView
    // Apps can land on a non-library surface (e.g. the to-do calendar) via app-config.js.
    // Inert in book/notes builds, which ship no Calendar module.
    const cfg = window.KalamosConfig || {}
    if (cfg.defaultMode === 'calendar' && window.Calendar) this.openCalendar()
    if (cfg.defaultMode === 'app' && window.AppMode) this.openAppMode()
    // Host requests are admitted only after startup publishes its final route/presentation.
    if (hooks && typeof hooks.onAppReady === 'function') hooks.onAppReady()
  },

  // Apply per-app branding from window.KalamosConfig (set by the app's web-app/js/app-config.js).
  // Everything is optional; a plain notes build that ships no config keeps the defaults.
  applyConfig() {
    const cfg = window.KalamosConfig || {}
    if (cfg.title) {
      document.title = cfg.title
      const h = document.querySelector('#header h1')
      if (h) h.textContent = cfg.title
    }
  },

  // The to-do calendar surface (provided by the todo app's Calendar module). Guarded so it is a
  // no-op in apps that don't ship one.
  openCalendar() {
    if (!window.Calendar) return
    if (window.stopAnim) window.stopAnim()
    document.getElementById('editor-view').style.display = 'none'
    document.getElementById('library-view').style.display = 'none'
    Bridge.enterLibrary()                               // hide the ink surface; calendar is opaque web UI
    this.current = 'calendar'
    Calendar.open()
  },

  // A generic app-owned full-screen surface (window.AppMode from app-overlay.js), like the
  // calendar but app-defined. Guarded so it is a no-op in apps that don't ship one.
  openAppMode() {
    if (!window.AppMode) return
    if (window.stopAnim) window.stopAnim()
    document.getElementById('editor-view').style.display = 'none'
    document.getElementById('library-view').style.display = 'none'
    Bridge.enterLibrary()                               // hide the ink surface; opaque web UI
    this.current = 'app'
    AppMode.open()
  },

  showEditor(notebookId) {
    if (typeof recordNotebookOpened === 'function') recordNotebookOpened(notebookId)
    // Format-routed readers (AD-5): meta.format 'epub'/'pdf' → EpubReader/PdfReader; interactive-book
    // notebooks (meta has bookRef) → BookReader; anything else falls through to the interactive/plain
    // editor below.
    let bm = null
    try { bm = JSON.parse(Bridge.loadMeta(notebookId)) } catch (e) {}
    // The library route is authoritative for storage identity. Imported and sideloaded package
    // metadata may omit notebookId (or carry a portable package bookId that differs from the
    // destination record id); readers must always resolve files through the selected record.
    if (bm) bm.notebookId = notebookId
    if (bm && window.EpubReader && EpubReader.isEpub(bm)) { EpubReader.open(bm); return }
    if (bm && window.PdfReader && PdfReader.isPdf(bm)) { PdfReader.open(bm); return }
    if (window.BookReader && BookReader.isBook(bm)) { BookReader.open(bm); return }
    // Interactive-format notebooks (pages carry blocks) open in interactive reading mode, not the
    // ink editor. Detect via the (preloaded) meta without disturbing the plain-notebook path.
    if (window.Reader) {
      const meta = Storage.takeCachedMeta(notebookId) || Storage.loadMeta(notebookId)
      if (Reader.isInteractive(meta)) { Reader.open(meta); return }
    }
    // Hosts may replace the plain notebook editor without changing reader/sketch routes.
    // Returning true also handles a rejected conversion: never open a second ink owner behind it.
    if (window.AppMode && typeof AppMode.openNotebook === 'function' && AppMode.openNotebook(notebookId)) return
    document.getElementById('library-view').style.display = 'none'
    document.getElementById('editor-view').style.display = 'flex'
    this.current = 'editor'
    // Ordinary Android uses the editor exactly like a website: keep the WebView opaque and leave
    // the native surface hidden. Bigme alone enters its device-specific ink surface.
    if (typeof needsStandardEditorHandoff === 'function' && needsStandardEditorHandoff()) {
      Bridge.enterLibrary()
    } else {
      Bridge.enterEditor()
    }
    if (!this.editorInited) { initEditor(); this.editorInited = true }
    loadNotebookById(notebookId)                        // load + render + attach ink
  },

  // Open a clean, focused daemon-ink sketch on an interactive notebook page — NO old editor chrome
  // (the floating menu is hidden). The pen is confined to the drawing box. [opts.modal] = a centred
  // Post-it box (for a sticky note) vs the page's inline box (the lungs). Back returns to the reader.
  openSketch(notebookId, pageIndex, opts) {
    opts = opts || {}
    this._sketchReturn = { nbId: notebookId, page: pageIndex }
    window._sketchActive = true
    window._sketchModal = !!opts.modal
    window._sketchNote = opts.note || null    // {bi,hi} → daemon strokes go to that note's buffer
    window._sketchFull = false
    window._openAtPage = pageIndex
    window._needFullToolbar = false              // sketch mode bakes no toolbar/menu
    document.getElementById('reader-view').style.display = 'none'
    document.getElementById('library-view').style.display = 'none'
    const ev = document.getElementById('editor-view')
    ev.style.display = 'flex'
    ev.classList.add('sketch')                   // CSS hides the floating menu in this mode
    this.current = 'editor'
    if (typeof needsStandardEditorHandoff === 'function' && needsStandardEditorHandoff()) {
      Bridge.enterLibrary()
    } else {
      Bridge.enterEditor()
    }
    if (opts.note) Bridge.skipWakeRefresh()   // sticky-note open → no full-screen wake; partial refresh
    if (!this.editorInited) { initEditor(); this.editorInited = true }
    loadNotebookById(notebookId)
  },

  _endSketch() {
    window._sketchActive = false; window._sketchModal = false; window._sketchFull = false
    window._sketchNote = null; window._sketchNoteStrokes = null
    const ev = document.getElementById('editor-view'); if (ev) ev.classList.remove('sketch')
    Bridge.setWritingBounds(0, 0, 0, 0)
    Bridge.setWritingExclusion(0, 0, 0, 0)   // drop the shrink-button exclusion
  },

  showLibrary() {
    const finishLibraryTransition = () => {
      Bridge.enterLibrary()                               // native: hide ink surface, opaque WebView
      document.getElementById('editor-view').style.display = 'none'
      // A sketch session returns to the interactive reader (not the library), at the same page.
      if (this._sketchReturn) {
        const ret = this._sketchReturn; this._sketchReturn = null
        this._endSketch()
        const meta = Storage.loadMeta(ret.nbId)
        if (meta) {
          Reader.open(meta); Reader.page = ret.page
          Reader._suppressAutoSketch = true   // just came back from the sketch — don't re-enter it
          Reader.render(); return
        }
      }
      renderLibrary()                                     // refresh list (titles/updatedAt may have changed)
      document.getElementById('library-view').style.display = 'flex'
      this.current = 'library'
    }
    // Only the legacy page editor owns detachInk(). App-owned surfaces (including the canonical
    // Planning workspace) detach their box through their own lifecycle hook before returning here.
    // Calling both teardown paths recycled the same native surface while Bigme was still blending
    // its last frame, producing a crash and making otherwise live strokes appear to vanish.
    if (this.current === 'editor') {
      if (this._editorExitPending) return
      this._editorExitPending = true
      // Stop animation WITHOUT its return-to-editor re-attach (we're detaching now).
      if (window.stopAnim) { window._animLeaving = true; window.stopAnim(); window._animLeaving = false }
      // Flush → save → authoritative model render → thumbnail copy → detach. Keeping the editor
      // visible for this short ordered handoff prevents the library from caching a blank preview.
      detachInk(() => {
        this._editorExitPending = false
        finishLibraryTransition()
      })
      return
    }
    finishLibraryTransition()
  },

  // Android hardware/gesture back, routed from native.
  onAndroidBack() {
    if (this.current === 'book') {
      if (window.BookReader && BookReader._inkWrap) { BookReader.closeInkBox(); return }   // close an open note first
      BookReader.close()
    } else if (this.current === 'epub' || this.current === 'pdf') {
      if (this.activeReader && this.activeReader.close) this.activeReader.close()
    } else if (this.current === 'reader') {
      if (window.Reader && Reader._noteWrap) { Reader.closeNote(); return }   // close an open note first
      if (window.Reader && Reader._draw) { Reader.closeDrawing(); return }    // …or an open drawing box
      Reader.close()
    } else if (this.current === 'calendar') {
      // Calendar may consume back itself (e.g. close an open day panel); else leave the app.
      if (window.Calendar && Calendar.onBack && Calendar.onBack()) return
      Bridge.exitApp()
    } else if (this.current === 'app') {
      // AppMode may consume back itself (sub-view → home); else leave the app.
      if (window.AppMode && AppMode.onBack && AppMode.onBack()) return
      Bridge.exitApp()
    } else if (this.current === 'editor') this.showLibrary()
    else if (this.current === 'library' && typeof libraryNavigateUp === 'function' && libraryNavigateUp()) return
    else Bridge.exitApp()
  },

  // Hardware page-turn buttons (dir = 'up' | 'down'), routed from native.
  onPageKey(dir) {
    if (this.current === 'book') { if (dir === 'down') BookReader.nextPage(); else BookReader.prevPage() }
    else if (this.current === 'epub' || this.current === 'pdf') { if (this.activeReader) { if (dir === 'down') this.activeReader.nextPage(); else this.activeReader.prevPage() } }
    else if (this.current === 'reader') { if (dir === 'down') Reader.next(); else Reader.prev() }
    else if (this.current === 'calendar') { if (window.Calendar && Calendar.onPageKey) Calendar.onPageKey(dir) }
    else if (this.current === 'app') { if (window.AppMode && AppMode.onPageKey) AppMode.onPageKey(dir) }
    else if (this.current === 'editor') { if (typeof editorPageTurn === 'function') editorPageTurn(dir) }
    else { if (typeof libraryPageTurn === 'function') libraryPageTurn(dir) }
  },

  // App backgrounded/foregrounded — only the editor needs to save + detach / re-attach the daemon.
  onPauseApp() {
    if (this.current === 'editor') {
      if (window.stopAnim) { window._animLeaving = true; window.stopAnim(); window._animLeaving = false }
      // detachInk owns the ordered native flush, final model save, thumbnail checkpoint, and detach.
      // Saving first can persist a model that does not yet contain the user's last daemon batch.
      detachInk()
    }
    if (this.current === 'app' && window.AppMode && AppMode.onPauseApp) AppMode.onPauseApp()
  },
  onResumeApp() {
    // Another activity can update the library while this WebView is paused (for example Agent's
    // NoteImportActivity). The in-memory index is not authoritative across that boundary: keeping
    // it would hide the new record and a later rename/move could overwrite library.json without it.
    // loadLibrary also renders, so refresh from disk before accepting any further library action.
    if (this.current === 'library' && typeof loadLibrary === 'function') loadLibrary()
    if (this.current === 'editor') attachInkWhenReady()
    if (this.current === 'app' && window.AppMode && AppMode.onResumeApp) AppMode.onResumeApp()
    const hooks = window.KalamosAppHooks
    if (hooks && typeof hooks.onAppResume === 'function') hooks.onAppResume()
  }
}

window.App = App
document.addEventListener('DOMContentLoaded', function() { App.start() })
