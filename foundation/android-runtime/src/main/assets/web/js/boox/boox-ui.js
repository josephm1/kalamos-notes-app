// Boox-style reader UI — activation flag + shared UI kit.
//
// The Boox UI is alternative chrome for the three readers, styled after a Boox/Bigme e-reader.
// It rides on top of the existing controllers via small delegation branches; every engine path
// (pagination, EPUB/PDF pipelines, persistence) is untouched.
//
// Activation (checked via Boox.active('reader')):
//   1. localStorage 'kal.boox.force' = 'on' | 'off'   — dev/QA override, wins over config.
//   2. window.KalamosConfig.boox.reader — per-app opt-in (Books sets true).
//   3. The module must have registered itself in Boox.takeover — so a half-loaded or
//      not-yet-implemented module safely falls through to the classic UI.
window.Boox = {
  takeover: {},   // boox-panels.js sets .reader once the reader chrome stack is healthy

  flags: function() {
    var forced = null
    try { forced = localStorage.getItem('kal.boox.force') } catch (e) {}
    if (forced === 'on') return { reader: true }
    if (forced === 'off') return { reader: false }
    var cfg = (window.KalamosConfig && window.KalamosConfig.boox) || {}
    return { reader: !!cfg.reader }
  },

  active: function(part) {
    return !!(this.flags()[part] && this.takeover[part])
  },
}

// ---------------------------------------------------------------------------
// Shared Boox UI kit (icons, toast, popover, overlay dismissal). Used by the
// reader chrome (boox-chrome.js) and panels (boox-panels.js). Pure B/W, no
// animation — everything is appended to / removed from the DOM directly.
// ---------------------------------------------------------------------------
window.BooxUI = {

  el: function(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  },

  // Line-icon set (stroke:currentColor, stroke-width 2, fill none — set by CSS).
  icons: {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M5 9a7 7 0 0112-3M19 15a7 7 0 01-12 3"/><path d="M5 5v4h4M19 19v-4h-4"/></svg>',
    ocr: '<svg viewBox="0 0 24 24"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/><path d="M8 12h8"/></svg>',
    gesture: '<svg viewBox="0 0 24 24"><path d="M9 11V6a2 2 0 014 0v5M13 8a2 2 0 014 0v6a5 5 0 01-5 5H10l-4-4"/></svg>',
    notes: '<svg viewBox="0 0 24 24"><path d="M5 4h14v13H9l-4 3z"/><path d="M8 8h8M8 12h6"/></svg>',
    onpage: '<svg viewBox="0 0 24 24"><path d="M4 3h13l3 3v15H4zM16 3v4h4"/><path d="M7 17l2.5-.6 7-7-2-2-7 7z"/></svg>',
    ai: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M2 9v6M22 9v6M9 2h6M9 22h6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    more: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    ribbon: '<svg viewBox="0 0 34 44"><path d="M6 2h22v40l-11-9-11 9z"/></svg>',
    contents: '<svg viewBox="0 0 24 24"><path d="M4 6h4v4H4zM4 14h4v4H4zM10 7h10M10 15h10"/></svg>',
    progress: '<svg viewBox="0 0 24 24"><path d="M5 7l6 5-6 5M13 7l6 5-6 5"/></svg>',
    format: '<svg viewBox="0 0 24 24"><path d="M6 20l6-14 6 14M8 15h8"/></svg>',
    contrast: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 010 18z" fill="currentColor"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z"/><circle cx="12" cy="13" r="3"/><path d="M12 4v3"/></svg>',
    split: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M14 6l-4 12"/></svg>',
    bookmarks: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-5-6 5z"/></svg>',
    images: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="9" cy="9" r="2"/><path d="M4 18l5-5 3 3 3-4 5 6"/></svg>',
    annot: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/><circle cx="12" cy="12" r="9"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M4 19l3-1L18 7l-2-2L5 16z"/><path d="M4 21h16"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  },

  // Labeled icon button (icon over a small label), as in the prototype toolbars/nav.
  iconBtn: function(iconKey, label, opts) {
    opts = opts || {}
    var btn = this.el('button', 'bx-ic-btn' + (opts.on ? ' bx-on' : '') + (opts.soon ? ' bx-soon' : ''))
    btn.type = 'button'
    var ic = this.el('span', 'bx-ic')
    ic.innerHTML = this.icons[iconKey] || ''
    btn.appendChild(ic)
    if (label) btn.appendChild(this.el('span', 'bx-ic-lb', label))
    if (opts.title) btn.title = opts.title
    if (opts.soon) btn.addEventListener('click', BooxUI.comingSoon)
    else if (opts.on || opts.onClick) btn.addEventListener('click', opts.onClick || function() {})
    return btn
  },

  toast: function(msg) {
    var t = this.el('div', 'bx-toast', msg)
    document.body.appendChild(t)
    setTimeout(function() { t.remove() }, 1200)
  },

  comingSoon: function() { BooxUI.toast('Coming soon') },

  // Outlined menu anchored to a button; a white click-catcher scrim behind it swallows the
  // dismissing tap so it never falls through to the page. items = [{label, on, soon, onClick}].
  popover: function(anchor, items) {
    this.closePopover()
    var scrim = this.el('div', 'bx-scrim')
    scrim.id = 'bx-ui-pop-scrim'
    scrim.addEventListener('click', function(e) { e.stopPropagation(); BooxUI.closePopover() })
    document.body.appendChild(scrim)
    var pop = this.el('div', 'bx-pop')
    pop.id = 'bx-ui-pop'
    items.forEach(function(it) {
      var row = BooxUI.el('div', 'bx-pop-item' + (it.on ? ' bx-on' : ''), it.label)
      row.addEventListener('click', function() {
        BooxUI.closePopover()
        if (it.soon) BooxUI.comingSoon()
        else if (it.onClick) it.onClick()
      })
      pop.appendChild(row)
    })
    var r = anchor.getBoundingClientRect()
    pop.style.top = (r.bottom + 4) + 'px'
    pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px'
    document.body.appendChild(pop)
  },

  closePopover: function() {
    var p = document.getElementById('bx-ui-pop'); if (p) p.remove()
    var s = document.getElementById('bx-ui-pop-scrim'); if (s) s.remove()
  },

  // A Boox bottom sheet (for bespoke panels like Progress that aren't ReaderPanels tabs). Returns
  // { root, body, close }. A white click-catcher scrim behind it closes on tap. Only one Boox
  // sheet is open at a time (closes any prior). opts = { title }.
  _sheet: null,
  sheet: function(opts) {
    this.closeSheet()
    opts = opts || {}
    var scrim = this.el('div', 'bx-scrim'); scrim.id = 'bx-sheet-scrim'
    var root = this.el('div', 'bx-sheet'); root.id = 'bx-sheet'
    var head = this.el('div', 'bx-sheet-head')
    head.appendChild(this.el('div', 'bx-sheet-title', opts.title || ''))
    var body = this.el('div', 'bx-sheet-body')
    root.appendChild(head); root.appendChild(body)
    document.body.appendChild(scrim); document.body.appendChild(root)
    var handle = { root: root, body: body, onClose: typeof opts.onClose === 'function' ? opts.onClose : null,
      close: function() { BooxUI.closeSheet() } }
    scrim.addEventListener('click', function(e) { e.stopPropagation(); BooxUI.closeSheet() })
    this._sheet = handle
    return handle
  },
  closeSheet: function() {
    var onClose = this._sheet && this._sheet.onClose
    var s = document.getElementById('bx-sheet'); if (s) { s.remove(); window._readerOverlayClosedAt = Date.now() }
    var sc = document.getElementById('bx-sheet-scrim'); if (sc) sc.remove()
    this._sheet = null
    if (onClose) onClose()
  },
  sheetOpen: function() { return !!document.getElementById('bx-sheet') },

  // Close the topmost transient Boox overlay (popover, then a hosted ReaderPanels sheet, then a
  // Boox drawer added in WP3). Returns true if something was closed — used so Android back
  // dismisses an open panel before it closes the reader (mirrors the classic modal-panel UX).
  dismissOverlay: function() {
    if (document.getElementById('bx-ui-pop')) { this.closePopover(); return true }
    // an open sticky-note ink box closes first (mirrors the classic back UX). PDF uses the shared
    // BooxInk box; blocks/EPUB use the reader's own.
    if (window.BooxInk && BooxInk.isOpen && BooxInk.isOpen()) { BooxInk.close(); return true }
    var r = window.App && App.activeReader
    if (r && r._inkWrap && r.closeInkBox) { r.closeInkBox(); return true }
    if (r && window.BooxPageInk && BooxPageInk.modeOn && BooxPageInk.modeOn(r)) {
      BooxPageInk.setMode(r, false); return true
    }
    if (r && window.BooxPdfAnnots && BooxPdfAnnots.modeOn && BooxPdfAnnots.modeOn(r)) {
      BooxPdfAnnots.setMode(r, false); return true
    }
    if (this.sheetOpen()) { this.closeSheet(); return true }
    if (window.BooxDrawer && BooxDrawer.isOpen && BooxDrawer.isOpen()) { BooxDrawer.close(); return true }
    if (typeof ReaderPanels !== 'undefined' && ReaderPanels.isOpen && ReaderPanels.isOpen()) {
      ReaderPanels.close(); return true
    }
    return false
  }
}
