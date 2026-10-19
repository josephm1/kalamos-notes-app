// Neutral monochrome toolbar and library glyphs shared by Notes and Agent.
(function (root) {
  'use strict'
  const icons = {
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.5 10.5l7-4M8.5 13.5l7 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    star: '<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    grid: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    settings: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="8"/>',
    cloud: '<path d="M6 18h12a4 4 0 0 0 .5-8 6.5 6.5 0 0 0-12.2-1.7A5 5 0 0 0 6 18z"/>',
    newNote: '<path d="M5 3h10l4 4v14H5zM15 3v5h4"/><path d="M8 3v18M11 14h5M13.5 11.5v5"/>',
    newFolder: '<path d="M3 8V5h6l2 3h10v12H3zM3 8h8"/><path d="M10 14h7M13.5 10.5v7"/>',
    template: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M9 4v16"/>',
    layers: '<path d="M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"/>',
    canvas: '<rect x="4" y="4" width="16" height="16"/><path d="M4 4l16 16M20 4L4 20"/>',
    shape: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="4"/>',
    lasso: '<path d="M5 11c0-5 5-7 9-5s7 7 3 10c-2 2-6 1-6 4 0 1 1 2 2 1"/>',
    fill: '<path d="M6 14l7-8 6 6-7 7H6z"/><path d="M17 18c0-2 2-4 2-4s2 2 2 4a2 2 0 0 1-4 0z"/>',
    gesture: '<path d="M9 13V7a2 2 0 1 1 4 0v4-2a2 2 0 1 1 4 0v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-4-2l-3-4a2 2 0 0 1 3-2z"/>',
    sync: '<path d="M19 8a8 8 0 0 0-13-2L4 8M5 16a8 8 0 0 0 13 2l2-2"/><path d="M4 4v4h4M20 20v-4h-4"/>',
    text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
    insert: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1"/><path d="M5 18l5-5 3 3 2-2 4 4"/>',
    ai: '<rect x="4" y="6" width="16" height="13" rx="3"/><path d="M9 2v4M15 2v4M8 12h.1M16 12h.1M9 16h6"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    marker: '<path d="M5 18l3 1 10-10-3-3L5 16z"/><path d="M4 21h7"/>',
    pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
    select: '<rect x="5" y="5" width="14" height="14" rx="1" stroke-dasharray="3 3"/>',
    selectAll: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 12l3 3 5-6"/>',
    move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    eraser: '<path d="M5 15l7-9 7 6-6 7H8z"/><path d="M11 19h9"/>',
    undo: '<path d="M9 8H4v-5"/><path d="M4 8c3-4 9-5 13-1s3 10-1 13"/>',
    redo: '<path d="M15 8h5v-5"/><path d="M20 8c-3-4-9-5-13-1s-3 10 1 13"/>',
    first: '<path d="M19 4L7 12l12 8M13 4L1 12l12 8"/>',
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    last: '<path d="M5 4l12 8-12 8M11 4l12 8-12 8"/>',
    spaceHorizontal: '<path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/>',
    spaceVertical: '<path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3"/>',
    delete: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7"/>',
    collapse: '<path d="M4 12h6M7 9l3 3-3 3M20 12h-6M17 9l-3 3 3 3"/>',
    magnify: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7v7M7 10.5h7"/>',
    keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h.1M6 14h1M10 14h1M14 14h4"/>',
    handle: '<path d="M9 5v14M15 5v14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l4 4L19 6"/>'
  }

  function svg(name) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>'
  }

  root.KalamosToolbarIcons = Object.freeze({ svg: svg })
})(window)
