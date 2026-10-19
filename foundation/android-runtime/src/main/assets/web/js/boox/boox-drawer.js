// Boox UI — side Contents drawer. The reference reader keeps the live page visible at the right
// while TOC / bookmarks / annotations / handwriting occupy a paginated left pane. Builders are the
// same ones used by ReaderPanels; only the host changes.
window.BooxDrawer = (function() {
  var root = null, body = null, tabs = null, active = null

  function open(opts) {
    close()
    opts = opts || {}
    tabs = opts.tabs || []
    if (!tabs.length) return
    active = opts.active || tabs[0].id

    root = document.createElement('div')
    root.className = 'bx-drawer-overlay'
    var panel = document.createElement('section')
    panel.className = 'bx-drawer'
    panel.setAttribute('aria-label', 'Book contents')
    var dismiss = document.createElement('div')
    dismiss.className = 'bx-drawer-dismiss'
    dismiss.addEventListener('click', close)

    body = document.createElement('div')
    body.className = 'bx-drawer-body'
    var tabrow = document.createElement('div')
    tabrow.className = 'bx-drawer-tabs'
    tabs.forEach(function(t) {
      var b = document.createElement('button')
      b.type = 'button'; b.className = 'bx-drawer-tab'; b.dataset.id = t.id
      b.innerHTML = '<span>' + iconFor(t.id) + '</span><small>' + t.label + '</small>'
      b.addEventListener('click', function() { select(t.id) })
      tabrow.appendChild(b)
    })
    panel.appendChild(body); panel.appendChild(tabrow)
    root.appendChild(panel); root.appendChild(dismiss)
    document.body.appendChild(root)
    root._tabrow = tabrow
    select(active)
  }

  function select(id) {
    if (!root) return
    active = id
    Array.prototype.forEach.call(root._tabrow.children, function(b) {
      b.classList.toggle('sel', b.dataset.id === id)
    })
    var tab = tabs.find(function(t) { return t.id === id })
    body.innerHTML = ''
    if (tab && typeof tab.build === 'function') {
      tab.build(body)
    }
  }

  function close() {
    if (root) { root.remove(); window._readerOverlayClosedAt = Date.now() }
    root = null; body = null; tabs = null; active = null
  }

  function iconFor(id) {
    if (id === 'toc') return BooxUI.icons.contents
    if (id === 'quizzes') return '<b aria-hidden="true">?</b>'
    if (id === 'bookmarks') return BooxUI.icons.bookmarks
    if (id === 'images') return BooxUI.icons.images
    if (id === 'annot') return BooxUI.icons.annot
    if (id === 'hand') return BooxUI.icons.hand
    return '•'
  }

  return { open: open, select: select, close: close, isOpen: function() { return !!root } }
})()
