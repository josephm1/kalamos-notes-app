let notebook = null
let currentPageIndex = 0
let activeTool = 'pen'
let activePenType = 'ballpoint'   // 'ballpoint' (constant width) | 'felt' (pressure-varied width)
let activeColor = '#000000'       // current ink colour (vivid palette tuned for the Kaleido 3 panel)
let strokeWidth = 1               // smallest selectable width; live and committed paths share it
let activeStroke = null
let isDrawing = false
let autosaveTimer = null
let autosavePending = false
let inkSdkActive = false      // true once BigmeInkController confirms attach
let daemonErrorTimer = null   // deferred "pen engine unavailable" toast (cancelled on a quick retry)
let flipEraserActive = false  // true when eraser mode was auto-triggered by USI stylus flip
let contentActive = false     // true while an interactive-format content layer is baked on the surface
let eraseBox = null           // accumulates the bbox (model px) of strokes erased since the last refresh
let lastErasePoint = null     // previous eraser sample, so a swipe erases along the path (not just at samples)
let eraseRefreshTimer = null  // throttle timer for the live erase refresh during a swipe
const ERASE_REFRESH_MS = 90   // min gap between live erase refreshes (keeps e-ink GU16 from piling up)
const PREFETCH_IDLE_MS = 600      // idle after a page settles before warming neighbouring pages
const PREFETCH_AHEAD = 4          // pages to prefetch ahead of the current page (forward flips dominate)
const PREFETCH_BEHIND = 2         // pages to prefetch behind; both only run while the main thread is idle
const EVICT_IDLE_MS = 3000        // settle time before eviction is even considered — far lazier than prefetch
const RESIDENT_AHEAD = PREFETCH_AHEAD + 2    // keep a buffer beyond the prefetch span so eviction never
const RESIDENT_BEHIND = PREFETCH_BEHIND + 2  // drops a page prefetch just loaded (avoids load/evict thrash)
const EVICT_MIN_IDLE_MS = 8       // only evict inside a real idle slice with at least this much time left

// CSS-pixel paper bounds cached when ink is attached (set by attachInk).
// Used by stroke callbacks to convert daemon physical-pixel coords → canvas coords.
let inkCssBounds = { left: 0, top: 0 }

// CSS-px screen offset of the daemon surface's (0,0). Normally 0 (full-screen surface). In animation
// "band" mode the writing surface is resized to BELOW the top animation band, so its origin is shifted
// down by the band height; daemon coords are surface-local, so we add this to map them back to screen,
// and subtract it when rendering page strokes/bounds INTO the (offset) surface. Pointer/eraser coords
// are screen-based (clientX/Y) and stay paper-relative via inkCssBounds — they need no surface offset.
let inkSurfaceOriginX = 0
let inkSurfaceOriginY = 0

const paper = document.getElementById('paper')
const eraserCursor = document.getElementById('eraser-cursor')
const pageNumEl = document.getElementById('page-num')
const widthSlider = document.getElementById('width-slider')
const widthValue = document.getElementById('width-value')
const templateSelect = document.getElementById('template-select')
const autosaveStatus = document.getElementById('autosave-status')

function currentPage() { return notebook ? notebook.pages[currentPageIndex] : null }
function totalPages() { return notebook ? notebook.pages.length : 0 }

// ============== INIT ==============

function initEditor() {
  sizePaper()
  initToolbar()

  // On #paper (visible, receives stylus pointer events through the surface). Writing is owned by
  // the daemon; these handlers only act on the stylus/button ERASER.
  paper.addEventListener('pointerdown', onPointerDown)
  paper.addEventListener('pointermove', onPointerMove)
  paper.addEventListener('pointerup', onPointerUp)
  paper.addEventListener('pointerleave', onPointerLeave)
  paper.addEventListener('pointercancel', function(e) {
    if (finishStandardWebStroke(e)) return
    // Pen pointercancel fires spuriously while the daemon owns input — do NOT abort an in-progress
    // eraser swipe here (it finalizes its refresh on pointerup/leave). Just hide the cursor.
    hideEraserCursor()
  })

  const ro = new ResizeObserver(function() {
    const prevW = paper.style.width
    const prevH = paper.style.height
    sizePaper()
    if (paper.style.width !== prevW || paper.style.height !== prevH) {
      // The reused WebView pre-warms offscreen (size 0) and gets its real size when shown, so the
      // paper rect can settle after the first render. The SurfaceView itself remains full-screen,
      // so do NOT detach/re-attach the daemon here: that clears cached chrome, interrupts strokes,
      // and pays the expensive Bigme bind again. Just update the coordinate origin and page state.
      if (inkSdkActive) {
        const rect = paper.getBoundingClientRect()
        inkCssBounds = { left: rect.left, top: rect.top }
        renderPageContent()
        syncNativePage()
      }
    }
  })
  ro.observe(document.getElementById('canvas-area'))

  const dialogRoot = document.getElementById('editor-view')
  const observeDialogs = function() {
    const active = Array.from(dialogRoot.querySelectorAll(
      '[role="dialog"]:not(.notes-popover), .magnify-settings, #color-popup, .rw-text-editor'
    )).some(function(el) {
      return el.getClientRects().length && getComputedStyle(el).display !== 'none'
    })
    if (active) beginEditorWebInput('other-dialog')
    else endEditorWebInput('other-dialog')
  }
  new MutationObserver(observeDialogs).observe(dialogRoot, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class']
  })
  History.updateButtons()
  updateUI()
}

// Called from native after webView.loadUrl completes. Lazy open: use the library-preloaded meta if
// present, else load it now (migrates a legacy notebook on demand). Only the CURRENT page's strokes
// are read here; other pages stream in when navigated to.
window.loadNotebookById = function(notebookId) {
  window._needFullToolbar = true   // open → bake the whole toolbar once (onInkControllerReady)
  const nb = Storage.takeCachedMeta(notebookId) || Storage.loadMeta(notebookId)
  if (nb) {
    notebook = nb
    // Normally open at page 0; a sketch session (App.openSketch) opens directly at its page.
    currentPageIndex = (window._openAtPage != null) ? Math.min(window._openAtPage, nb.pages.length - 1) : 0
    window._openAtPage = null
    // Sticky-note sketch: point the daemon at this note's own strokes (in block.hl[hi].note.strokes).
    window._sketchNoteStrokes = null
    if (window._sketchNote) {
      const p = notebook.pages[currentPageIndex]
      const blk = p && p.blocks && p.blocks[window._sketchNote.bi]
      const hl = blk && Array.isArray(blk.hl) && blk.hl[window._sketchNote.hi]
      if (hl) {
        if (!hl.note) hl.note = {}
        // Reset if missing OR in the old web-canvas format (point arrays without a .points field).
        if (!Array.isArray(hl.note.strokes) || (hl.note.strokes.length && !hl.note.strokes[0].points)) {
          hl.note.strokes = []
        }
        window._sketchNoteStrokes = hl.note.strokes
      }
    }
    History.clear()
    activeStroke = null
    isDrawing = false
    updateUI()
    updateAutosaveStatus('idle')
    attachInkAfterChrome()         // finish any app chrome capture before the daemon starts
    return
  }
  // Fallback: create new notebook
  notebook = createNotebook('Notebook', '')
  notebook.notebookId = notebookId
  Storage.saveNotebook(notebook)
  History.clear()
  updateUI()
  attachInkAfterChrome()
}

// Read a page's strokes from disk the first time it's shown (lazy load). Pages start strokes=null.
function ensurePageLoaded(index) {
  const p = notebook && notebook.pages[index]
  if (p && p.strokes === null) {
    p.strokes = Storage.loadPageStrokes(notebook.notebookId, p.pageId)
  }
}

// ============== PAPER SIZING ==============

function sizePaper() {
  // Full-screen paper (minus a small margin); the floating menu sits on top of it.
  const area = document.getElementById('canvas-area')
  paper.style.width = (area.clientWidth - 12) + 'px'
  paper.style.height = (area.clientHeight - 12) + 'px'
}

// ============== INK INTEGRATION ==============

// Attach the daemon only once #paper has a real, laid-out size. The reused WebView pre-warms
// OFFSCREEN (size 0) and re-lays-out to full-screen when shown; attaching before that settles
// captured a stale paper rect → wrong inkCssBounds → blank/offset page and mislocated strokes.
function attachInkWhenReady(attempts) {
  if (editorWebInputActive) return
  attempts = attempts || 0
  const r = paper.getBoundingClientRect()
  if ((r.width < 50 || r.height < 50) && attempts < 40) {
    requestAnimationFrame(function() { attachInkWhenReady(attempts + 1) })
    return
  }
  if (needsStandardEditorHandoff()) {
    // Standard Android is an ordinary WebView application. Keep its native SurfaceView hidden and
    // render both pen strokes and the toolbar in this one DOM/canvas composition. This deliberately
    // avoids every attach/detach, alpha, snapshot, and display-policy operation during interaction.
    inkSdkActive = false
    inkCssBounds = { left: r.left, top: r.top }
    Bridge.enterLibrary()
    showStandardEditorHandoff()
    renderPageContent()
    return
  }
  console.log('DIAG attachReady attempts=' + attempts + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height))
  attachInk()
}

// Bake the toolbar ONLY after the daemon attaches (onInkControllerReady, via _needFullToolbar).
// The removed pre-attach bake captured before layout-readiness and could permanently bake a blank
// strip/rail. The post-attach path sees settled layout and is the canonical chrome snapshot path.
function attachInkAfterChrome() {
  attachInkWhenReady()
}

function attachInk() {
  const rect = paper.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  inkCssBounds = { left: rect.left, top: rect.top }
  console.log('[Ink] attachInk dpr=' + dpr +
    ' cssBounds=(' + rect.left + ',' + rect.top + ',' + rect.right + ',' + rect.bottom + ')' +
    ' physBounds=(' + Math.round(rect.left * dpr) + ',' + Math.round(rect.top * dpr) +
    ',' + Math.round(rect.right * dpr) + ',' + Math.round(rect.bottom * dpr) + ')')
  // Pass physical-pixel bounds to native so clearRegion math stays consistent
  Bridge.attachInk(
    Math.round(rect.left * dpr),
    Math.round(rect.top * dpr),
    Math.round(rect.right * dpr),
    Math.round(rect.bottom * dpr)
  )
  Bridge.setInkStyle(strokeWidth * dpr, activeColor)
}

let thumbnailDetachPending = false

function captureStandardWebThumbnail(notebookId, done) {
  if (!needsStandardEditorHandoff() ||
      typeof Storage.saveRenderedThumbnail !== 'function') return false
  const page = currentPage()
  if (!page || !Array.isArray(page.strokes)) return false

  /*
   * Standard Handwriting thumbnail contract:
   * render exactly the paper template + committed stroke/text model into one fixed small canvas.
   * Android WebView.draw() is not used because it can omit hardware-backed <canvas> pixels and
   * produced valid but completely white PNGs while the page JSON still contained every stroke.
   *
   * This code deliberately has no toolbar hiding, animation-frame wait, native surface, or device
   * branch. Bigme remains on InkSurfaceView.captureThumbnail(), whose retained daemon page is its
   * authoritative model. Keeping the two ownership paths explicit makes regressions easy to trace.
   */
  try {
    const targetWidth = 320
    // Reuse the Books shelf's established 86:131 cover/page ratio so Notes and Books occupy the
    // library consistently. The previous 4:3 canvas was wider and produced white side strips.
    const targetHeight = Math.round(targetWidth * 131 / 86)
    const pageRect = paper.getBoundingClientRect()
    const pageWidth = Math.max(1, pageRect.width)
    const pageHeight = Math.max(1, pageRect.height)
    // Map the complete saved page directly to the complete thumbnail. Page coordinates can vary
    // slightly with the toolbar layout that was active while writing; using both axes preserves
    // every edge and avoids adding a second, empty "page" around the real page.
    const scaleX = targetWidth / pageWidth
    const scaleY = targetHeight / pageHeight
    const minScale = Math.min(scaleX, scaleY)
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, targetWidth, targetHeight)
    ctx.save()
    ctx.scale(scaleX, scaleY)

    const template = page.template || { type: 'blank', spacing: 32, margin: 72 }
    const spacing = template.spacing || 32
    const margin = Math.min(template.margin || 72, pageWidth * 0.15)
    const hairline = 1 / minScale
    ctx.lineWidth = hairline
    ctx.strokeStyle = '#000'
    ctx.fillStyle = '#000'
    if (template.type === 'weekly' || template.type === 'cornell') {
      drawStructuredPaper(ctx, template.type, pageWidth, pageHeight)
    } else if (template.type === 'ruled') {
      for (let y = spacing; y < pageHeight; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pageWidth, y); ctx.stroke()
      }
      ctx.strokeStyle = '#000'
      ctx.beginPath(); ctx.moveTo(margin, 0); ctx.lineTo(margin, pageHeight); ctx.stroke()
    } else if (template.type === 'grid') {
      for (let x = margin; x < pageWidth; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, pageHeight); ctx.stroke()
      }
      for (let y = spacing; y < pageHeight; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pageWidth, y); ctx.stroke()
      }
    } else if (template.type === 'dotted') {
      const radius = Math.max(1.5, hairline)
      for (let x = margin; x < pageWidth; x += spacing) {
        for (let y = spacing; y < pageHeight; y += spacing) {
          ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
        }
      }
    }

    // Guarantee at least one target pixel for the thinnest pen. The thumbnail is a condensed
    // preview, so preserving the complete stroke is more important than sub-pixel width fidelity.
    for (const stroke of page.strokes) {
      drawStandardHandoffStroke(ctx, {
        tool: stroke.tool,
        color: stroke.color,
        width: Math.max(stroke.width || 1, 1 / minScale),
        points: stroke.points
      }, 1)
    }
    const texts = Array.isArray(page.texts) ? page.texts : []
    ctx.fillStyle = '#111'
    for (const text of texts) {
      ctx.font = (text.size || 18) + 'px sans-serif'
      ctx.textBaseline = 'top'
      ctx.fillText(text.text || '', text.x || 0, text.y || 0)
    }
    ctx.restore()

    if (!Storage.saveRenderedThumbnail(notebookId, canvas.toDataURL('image/png'))) return false
    done()
    return true
  } catch (e) {
    console.warn('Standard model thumbnail failed:', e)
    return false
  }
}

function detachInk(done) {
  resetEditorWebInput()
  if (thumbnailDetachPending) return
  thumbnailDetachPending = true
  const finishDetach = function() {
    inkSdkActive = false
    hideStandardEditorHandoff()
    Bridge.detachInk()
    thumbnailDetachPending = false
    if (done) done()
  }
  const captureAuthoritativePage = function() {
    if (!notebook) {
      finishDetach()
      return
    }
    /*
     * A heavy page can still have `strokes === null` while the native surface shows either its
     * template-only shell or a newer daemon batch. Force-load the saved vectors after the ordered
     * flush, checkpoint that final model, then submit it to InkSurfaceView before requesting the
     * thumbnail. This removes the race that produced a perfectly ruled PNG with zero handwriting.
     *
     * Storage waits for native onThumbnailCaptured before finishDetach clears the surface. Bigme
     * and Standard share this data ordering; neither device's display policy is changed.
     */
    ensurePageLoaded(currentPageIndex)
    window.saveNotebook()
    syncNativePage()
    // Standard's complete page exists in the WebView canvases. Capturing the hidden SurfaceView
    // here returned stale/partial vectors; Bigme remains on the native capture below.
    if (captureStandardWebThumbnail(notebook.notebookId, finishDetach)) return
    Storage.saveThumbnail(notebook.notebookId, finishDetach)
  }
  if (inkSdkActive) {
    try {
      Bridge.setInkEnabled(false)
      flushNativeThen(captureAuthoritativePage)
    } catch (e) {
      captureAuthoritativePage()
    }
  } else {
    captureAuthoritativePage()
  }
}

// ============== STANDARD DISPLAY WEB EDITOR ==============

// Standard Android renders the editor as one ordinary website: retained pen vectors and the moving
// toolbar are both WebView content. Bigme keeps its established SurfaceView/daemon implementation.
// The capability name is retained for bridge compatibility; false means "use the web editor".
function needsStandardEditorHandoff() {
  try {
    return typeof Bridge.supportsPersistentDisplayHandoff === 'function' &&
      Bridge.supportsPersistentDisplayHandoff() === false
  } catch (e) {
    return false
  }
}

let standardHandoffTemplateCanvas = null
let standardHandoffInkCanvas = null

function ensureStandardHandoffCanvases() {
  if (standardHandoffTemplateCanvas && standardHandoffInkCanvas) {
    return { template: standardHandoffTemplateCanvas, ink: standardHandoffInkCanvas }
  }

  const template = document.createElement('canvas')
  template.id = 'standard-web-handoff-template'
  template.className = 'standard-web-handoff-canvas'
  template.setAttribute('aria-hidden', 'true')

  const ink = document.createElement('canvas')
  ink.id = 'standard-web-handoff-ink'
  ink.className = 'standard-web-handoff-canvas'
  ink.setAttribute('aria-hidden', 'true')

  // Match InkSurfaceView's draw order without flattening interactive-format HTML into one bitmap:
  // ruling below #content-layer, committed pen vectors above it.
  paper.insertBefore(template, paper.firstChild)
  paper.insertBefore(ink, eraserCursor)
  standardHandoffTemplateCanvas = template
  standardHandoffInkCanvas = ink
  return { template: template, ink: ink }
}

function prepareStandardHandoffCanvas(canvas, cssWidth, cssHeight, dpr) {
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr))
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight
  canvas.style.width = cssWidth + 'px'
  canvas.style.height = cssHeight + 'px'
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return ctx
}

// Normalized paper geometry is also implemented by InkSurfaceView.drawTemplate.
function drawStructuredPaper(ctx, type, width, height) {
  ctx.save(); ctx.scale(width / 572, height / 772)
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 2
  ctx.font = '16px sans-serif'; ctx.textBaseline = 'alphabetic'
  function line(x, y, xx, yy) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(xx, yy); ctx.stroke() }
  if (type === 'weekly') {
    for (let i = 0; i <= 7; i++) line(24, 36 + i * 100, 548, 36 + i * 100)
    ;['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(function (day, i) { ctx.fillText(day, 24, 60 + i * 100) })
  } else {
    line(143, 32, 143, 636); line(24, 636, 548, 636)
    for (let i = 0; i < 13; i++) line(143, 64 + i * 44, 548, 64 + i * 44)
    ctx.fillText('Cues', 24, 24); ctx.fillText('Notes', 155, 24); ctx.fillText('Summary', 24, 660)
  }
  ctx.restore()
}

function drawStandardHandoffTemplate(ctx, template, width, height) {
  const type = template.type || 'blank'
  const spacing = template.spacing || 32
  if (spacing <= 0) return
  const margin = Math.min(template.margin || 72, width * 0.15)

  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = '#000'
  ctx.fillStyle = '#000'
  if (type === 'weekly' || type === 'cornell') {
    drawStructuredPaper(ctx, type, width, height)
  } else if (type === 'ruled') {
    for (let y = spacing; y < height; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
    }
    ctx.strokeStyle = '#000'
    ctx.beginPath(); ctx.moveTo(margin, 0); ctx.lineTo(margin, height); ctx.stroke()
  } else if (type === 'grid') {
    for (let x = margin; x < width; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke()
    }
    for (let y = spacing; y < height; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
    }
  } else if (type === 'dotted') {
    for (let x = margin; x < width; x += spacing) {
      for (let y = spacing; y < height; y += spacing) {
        ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill()
      }
    }
  }
  ctx.restore()
}

function drawStandardHandoffStroke(ctx, stroke, dpr) {
  const points = stroke && stroke.points
  if (!points || points.length === 0) return
  const baseWidth = stroke.width || 3
  const felt = stroke.tool === 'felt'

  ctx.save()
  ctx.strokeStyle = stroke.color || '#111111'
  ctx.fillStyle = stroke.color || '#111111'
  ctx.setLineDash(stroke.tool === 'selection' ? [16 / dpr, 24 / dpr] : [])

  if (points.length === 1) {
    const pressure = points[0].p !== undefined ? points[0].p : 0.5
    const width = felt ? baseWidth * (0.3 + 1.7 * Math.max(0, Math.min(1, pressure))) : baseWidth
    ctx.beginPath(); ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2); ctx.fill()
  } else if (felt) {
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1]
      const p1 = points[i]
      const pressure = ((p0.p !== undefined ? p0.p : 0.5) +
        (p1.p !== undefined ? p1.p : 0.5)) / 2
      ctx.lineWidth = baseWidth * (0.3 + 1.7 * Math.max(0, Math.min(1, pressure)))
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke()
    }
  } else {
    ctx.lineWidth = baseWidth
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
  }
  ctx.restore()
}

function showStandardEditorHandoff(forcePreview) {
  if ((!forcePreview && !needsStandardEditorHandoff()) || !notebook || window._noteSketch) return false
  ensurePageLoaded(currentPageIndex)
  const page = currentPage()
  if (!page) return false

  const rect = paper.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  const dpr = window.devicePixelRatio || 1
  const canvases = ensureStandardHandoffCanvases()
  const templateCtx = prepareStandardHandoffCanvas(canvases.template, rect.width, rect.height, dpr)
  const inkCtx = prepareStandardHandoffCanvas(canvases.ink, rect.width, rect.height, dpr)
  drawStandardHandoffTemplate(
    templateCtx,
    page.template || { type: 'blank', spacing: 32, margin: 72 },
    rect.width,
    rect.height
  )
  const strokes = Array.isArray(page.strokes) ? page.strokes : []
  for (let i = 0; i < strokes.length; i++) drawStandardHandoffStroke(inkCtx, strokes[i], dpr)
  paper.classList.add('web-paper-mirror')
  canvases.template.style.display = 'block'
  canvases.ink.style.display = 'block'
  console.log('DIAG standardEditorHandoff show template=' +
    ((page.template && page.template.type) || 'blank') + ' strokes=' + strokes.length +
    ' canvas=' + Math.round(rect.width) + 'x' + Math.round(rect.height))
  return true
}

function hideStandardEditorHandoff() {
  paper.classList.remove('web-paper-mirror')
  if (standardHandoffTemplateCanvas) standardHandoffTemplateCanvas.style.display = 'none'
  if (standardHandoffInkCanvas) standardHandoffInkCanvas.style.display = 'none'
}

// ============== INK CALLBACKS (called from native) ==============

// Strokes are rendered natively on the ink surface during writing; native batches the vector
// data and calls this ONCE after the pen pauses (no JS runs mid-writing). [strokes] is an array
// of point-arrays in surface (physical) px: [[{x,y},...], ...]. We convert to page/CSS coords,
// append to the notebook model, and save.
window.onStrokesBatch = function(strokes) {
  if (!strokes || strokes.length === 0) return
  // Daemon ink box (sticky note / kal-ink) attached to just a box → strokes go to its handler.
  if (window._noteSketch && window._inkHandler) { window._inkHandler.onNoteStrokes(strokes); return }
  if (!notebook) return
  const dpr = window.devicePixelRatio || 1
  // Writing pad open → the batch was written INSIDE the pad box; hand it to the pad (pad-local
  // CSS px), which scales it onto the target rule line and calls back through EditorTools.
  if (EditorTools.padRoute(strokes, dpr)) return
  const noteBuf = window._sketchNoteStrokes   // (legacy editor note path; unused by the box approach)
  if (!noteBuf) ensurePageLoaded(currentPageIndex)   // lazy: the page being written to needs its array
  const page = currentPage()
  const target = noteBuf || (page && page.strokes)
  if (!target) return
  const felt = activePenType === 'felt'
  const tool = felt ? 'felt' : (activePenType === 'selection' ? 'selection' : 'pen')
  const added = []
  for (let s = 0; s < strokes.length; s++) {
    const pts = strokes[s]   // each point is [surfaceX, surfaceY, pressure]
    if (!pts || pts.length === 0) continue
    const stroke = {
      id: 's-' + uid(),
      tool: tool,
      color: activeColor,
      width: strokeWidth,
      points: pts.map(function(p) {
        // daemon px → screen (+ surface origin) → paper-relative CSS (− paper bounds)
        const pt = { x: p[0] / dpr + inkSurfaceOriginX - inkCssBounds.left, y: p[1] / dpr + inkSurfaceOriginY - inkCssBounds.top }
        if (felt) pt.p = p[2]   // keep per-point pressure ONLY for felt strokes (ballpoint = constant)
        return pt
      })
    }
    if (!noteBuf && EditorTools.modes.eraseLasso && tool === 'selection') { EditorTools.eraseLasso(page, stroke.points); continue }
    if (!noteBuf && tool !== 'selection' && EditorTools.eraseScribble(page, stroke.points)) continue
    const idx = target.length
    target.push(stroke)
    if (noteBuf) { triggerAutosave(); continue }   // note strokes persist in meta (block.hl.note)
    added.push(stroke)
    page._dirty = true
    ;(function(st, i) {
      History.push(
        function() { page.strokes.splice(i, 1); page._dirty = true; triggerAutosave(); History.updateButtons() },
        function() { page.strokes.splice(i, 0, deepClone(st)); page._dirty = true; triggerAutosave(); History.updateButtons() }
      )
    })(stroke, idx)
  }
  // Post-write assists (auto shape / handwriting help / realtime to-text / auto-newline).
  // Runs on the pen-pause batch, never mid-stroke; re-renders only when something moved.
  if (added.length && !noteBuf && EditorTools.hasPostWriteMode()) EditorTools.afterBatch(page, added)
  // No save here — native schedules window.saveNotebook() only after a long true-idle so the
  // heavy JSON.stringify + disk write never competes with active writing.
}

window.onInkControllerReady = function(available) {
  if (editorWebInputActive && !window._noteSketch) {
    if (available) Bridge.setInkEnabled(false)
    return
  }
  inkSdkActive = available
  if (available && isDrawing && activeStroke) {
    // Daemon came online mid-pointer-stroke — discard the mixed stroke
    activeStroke = null
    isDrawing = false
  }
  if (!available) {
    // The first attach on open frequently reports false transiently before a retry succeeds, so
    // DON'T toast immediately — schedule it and cancel below if the daemon comes up shortly after.
    // Only a genuine, persistent failure reaches the user.
    console.warn('Ink SDK not available (attach returned false)')
    if (daemonErrorTimer) clearTimeout(daemonErrorTimer)
    daemonErrorTimer = setTimeout(function() {
      if (!inkSdkActive) Bridge.showToast('Pen engine unavailable — writing is disabled')
    }, 2500)
  } else {
    if (daemonErrorTimer) { clearTimeout(daemonErrorTimer); daemonErrorTimer = null }
    // Daemon ink box: the surface is just the box — render its strokes into it, nothing else.
    if (window._noteSketch && window._inkHandler) { window._inkHandler.renderNoteStrokes(); return }
    // Surface is ready — paint the current page's existing strokes onto the native surface.
    syncNativePage()
    renderPageContent()   // bake any interactive-format content under the ink
    // Bake the FULL toolbar only on open (set by loadNotebookById); page-change re-attach handles
    // its own targeted page-number update, so it doesn't re-bake the whole strip.
    if (window._needFullToolbar) {
      window._needFullToolbar = false
      snapshotToolbar()
    }
    // Ink surface is GU16-ready — now reveal it by making the WebView transparent.
    // enterEditor() deliberately kept the WebView opaque so it covered the blank/loading ink
    // surface while we loaded and ran the first GU16; this uncovers it only now that it's clean.
    // (Sticky-note box attaches return early above and never reach here — they keep the reader.)
    // Animation band mode also wants the WebView transparent: the daemon writing surface is the region
    // ABOVE the bottom band (page shows + writing is daemon-fast), and the band is live WebView the
    // system refreshes. So always reveal.
    // Standard toolbar movement keeps the transient canvases until this exact ready point, avoiding
    // a white gap while the replacement native page attaches. Bigme never created these canvases.
    hideStandardEditorHandoff()
    Bridge.showEditor()
  }
}

// Re-render the current page (template + strokes) onto the native ink surface from the model.
// Call after model changes (load / undo / redo / erase / page / template change). All coords in
// SURFACE px. MUST NOT run mid-writing (the model lags the native batch by the idle flush).
// [refreshRect] (optional) = {x,y,w,h} in MODEL/CSS px to refresh ONLY that region on e-ink
// (used by the eraser so it's a partial refresh, not full-screen). Omit for a full refresh.
function syncNativePage(refreshRect) {
  if (editorWebInputActive) { showStandardEditorHandoff(true); return }
  const page = currentPage()
  if (!page) return
  if (needsStandardEditorHandoff()) {
    // Despite the historical function name, Standard Android has no native page to synchronize.
    // Repaint the retained WebView canvases from the vector model; toolbar movement never calls this.
    showStandardEditorHandoff()
    schedulePrefetch()
    scheduleEvict()
    return
  }
  const dpr = window.devicePixelRatio || 1
  const tmpl = page.template || { type: 'blank', spacing: 32, margin: 72 }
  const rect = paper.getBoundingClientRect()
  const out = {
    t: tmpl.type || 'blank',
    sp: (tmpl.spacing || 32) * dpr,
    mg: (tmpl.margin || 72) * dpr,
    dpr: dpr,
    b: [Math.round((rect.left - inkSurfaceOriginX) * dpr), Math.round((rect.top - inkSurfaceOriginY) * dpr),
        Math.round((rect.right - inkSurfaceOriginX) * dpr), Math.round((rect.bottom - inkSurfaceOriginY) * dpr)],
    s: []
  }
  if (refreshRect) {
    const pad = 6
    out.rr = [
      Math.round((refreshRect.x + inkCssBounds.left - inkSurfaceOriginX) * dpr) - pad,
      Math.round((refreshRect.y + inkCssBounds.top - inkSurfaceOriginY) * dpr) - pad,
      Math.round((refreshRect.x + refreshRect.w + inkCssBounds.left - inkSurfaceOriginX) * dpr) + pad,
      Math.round((refreshRect.y + refreshRect.h + inkCssBounds.top - inkSurfaceOriginY) * dpr) + pad
    ]
  }
  // Prepare the complete page before its first presentation. Neighbour prefetch
  // normally makes this a cache hit; a cold heavy page must not deliberately
  // publish empty paper and then erase it again when its strokes arrive.
  let strokesSrc = window._sketchNoteStrokes
  if (!strokesSrc && window._sketchNote) strokesSrc = []
  if (!strokesSrc) {
    if (page.strokes === null) {
      page.strokes = Storage.parseStrokes(Storage.loadPageRaw(notebook.notebookId, page.pageId))
    }
    strokesSrc = page.strokes
  }
  for (let s = 0; s < strokesSrc.length; s++) {
    const st = strokesSrc[s]
    if (!st || !st.points) continue   // skip malformed / legacy-format strokes
    const felt = st.tool === 'felt'
    const dashed = st.tool === 'selection'
    const pts = []
    for (let i = 0; i < st.points.length; i++) {
      const p = st.points[i]
      const arr = [Math.round((p.x + inkCssBounds.left - inkSurfaceOriginX) * dpr), Math.round((p.y + inkCssBounds.top - inkSurfaceOriginY) * dpr)]
      if (felt) arr.push(p.p !== undefined ? p.p : 0.5)   // per-point pressure for variable width
      pts.push(arr)
    }
    const so = { w: (st.width || 3) * dpr, c: st.color || '#111111', p: pts }
    if (felt) so.vw = 1   // tell native to render variable width from the per-point pressure
    if (dashed) so.d = 1  // tell native to render this stroke as a dashed line (selection pen)
    out.s.push(so)
  }
  Bridge.renderInk(JSON.stringify(out))
  schedulePrefetch()   // page is up — warm the neighbouring pages once we settle (instant flips)
  scheduleEvict()      // …and, much more lazily, drop pages that have fallen outside the window
}

// Interactive-format pages: render this page's content blocks into #content-layer, then bake them
// onto the ink surface (under the ink) so the daemon pen writes over the article. Called on page
// change only — the baked bitmap persists across stroke/erase/undo re-renders (drawn natively each
// time), so syncNativePage never re-bakes. Plain pages clear any prior content. No scrolling: the
// content layer is clipped to the page; the page-turn buttons move between pages.
function renderPageContent() {
  if (!notebook) return
  const page = currentPage()
  const layer = document.getElementById('content-layer')
  const sketch = !!window._sketchActive
  const webOnly = needsStandardEditorHandoff() || editorWebInputActive
  layer.classList.toggle('sketch-full', sketch && !!window._sketchFull)
  layer.classList.toggle('sketch-modal', sketch && !!window._sketchModal)

  if (page && Array.isArray(page.blocks) && page.blocks.length) {
    ContentBlocks.render(layer, page, notebook.notebookId, function() {
      if (sketch && window._sketchModal) layer.appendChild(buildSketchBox())  // Post-it OVER the content
      if (sketch) addSketchControls(layer)
      if (!webOnly) bakeContentAndBound(layer)
    })
    contentActive = true
  } else if (sketch && window._sketchModal) {
    layer.classList.add('has-content'); layer.innerHTML = ''   // sticky note on a content-less page
    layer.appendChild(buildSketchBox()); addSketchControls(layer)
    if (!webOnly) bakeContentAndBound(layer)
    contentActive = true
  } else if (page && Array.isArray(page.texts) && page.texts.length) {
    // Converted-handwriting text: absolutely positioned spans baked UNDER the ink (the same
    // content pipeline the interactive pages use) so typed words sit on the page like ink does.
    layer.classList.add('has-content')
    layer.innerHTML = ''
    for (const t of page.texts) {
      const span = document.createElement('span')
      span.className = 'ink-text'
      if (t.boxId) span.dataset.textBoxId = t.boxId
      span.textContent = t.text
      span.style.cssText = 'position:absolute;white-space:pre;color:#000;' +
        'left:' + t.x + 'px;top:' + t.y + 'px;font-size:' + t.size + 'px;line-height:1.2'
      layer.appendChild(span)
    }
    if (!webOnly) bakeContentAndBound(layer)
    contentActive = true
  } else {
    layer.classList.remove('has-content')
    layer.innerHTML = ''
    if (!webOnly) {
      setPaperWritingBounds()               // native page → protect all chrome outside the paper
      if (contentActive) Bridge.clearContent()
    }
    contentActive = false
  }
}

// The native SurfaceView is full-screen and opaque even when the paper is inset by an app-specific
// toolbar/rail. Always bound pen input to the actual paper rectangle so chrome remains a protected
// tap area and strokes cannot start underneath it.
function setPaperWritingBounds() {
  const dpr = window.devicePixelRatio || 1
  const r = paper.getBoundingClientRect()
  Bridge.setWritingBounds(Math.round(r.left * dpr), Math.round(r.top * dpr),
                          Math.round(r.right * dpr), Math.round(r.bottom * dpr))
}

// Bake #content-layer onto the ink surface; confine the daemon pen to the sketch box; and (in full
// screen) exclude the shrink button that sits inside the box so the pen doesn't draw on it.
function bakeContentAndBound(layer) {
  const dpr = window.devicePixelRatio || 1
  const rect = paper.getBoundingClientRect()
  const SL = Math.round(rect.left * dpr), ST = Math.round(rect.top * dpr)
  const SR = Math.round(rect.right * dpr), SB = Math.round(rect.bottom * dpr)
  // Confine the daemon pen to the inner draw box.
  const box = layer.querySelector('.sk-box, .cb-draw-box')
  if (box && window._sketchActive) {
    const r = box.getBoundingClientRect()
    Bridge.setWritingBounds(Math.round(r.left * dpr), Math.round(r.top * dpr),
                            Math.round(r.right * dpr), Math.round(r.bottom * dpr))
  } else {
    setPaperWritingBounds()
  }
  // Sticky note → bake but refresh ONLY the Post-it card (partial); everything else → full refresh.
  const card = (window._sketchModal && window._sketchNote) ? layer.querySelector('.sk-note') : null
  if (card) {
    const c = card.getBoundingClientRect()
    Bridge.snapshotContentPartial(SL, ST, SR, SB,
      Math.round(c.left * dpr) - 8, Math.round(c.top * dpr) - 8,
      Math.round(c.right * dpr) + 8, Math.round(c.bottom * dpr) + 8)
  } else {
    Bridge.snapshotContent(SL, ST, SR, SB)
  }
  // Full-screen shrink button sits inside the box → exclude it so the pen doesn't draw on it.
  const sh = layer.querySelector('.sk-shrink')
  if (sh) {
    const r = sh.getBoundingClientRect()
    Bridge.setWritingExclusion(Math.round(r.left * dpr), Math.round(r.top * dpr),
                               Math.round(r.right * dpr), Math.round(r.bottom * dpr))
  } else {
    Bridge.setWritingExclusion(0, 0, 0, 0)
  }
}

// A centred, header-less, high-contrast Post-it box for a sticky-note sketch (overlays the page).
function buildSketchBox() {
  const wrap = document.createElement('div'); wrap.className = 'sk-wrap'
  const note = document.createElement('div'); note.className = 'sk-note'
  note.appendChild(Object.assign(document.createElement('div'), { className: 'sk-box' }))
  wrap.appendChild(note)
  return wrap
}

// Sketch controls. Small: Done + Full-page OUTSIDE the box (tappable, outside the pen bounds). Full
// screen: a single shrink-to-window button INSIDE the box's bottom-right (excluded from the pen).
function addSketchControls(layer) {
  if (window._sketchFull) {
    const sh = document.createElement('button'); sh.className = 'sk-shrink'; sh.textContent = '⊟'
    sh.title = 'Window'
    sh.addEventListener('click', function() { window._sketchFull = false; renderPageContent() })
    layer.appendChild(sh)
    return
  }
  const bar = document.createElement('div'); bar.className = 'sk-controls'
  const done = document.createElement('button'); done.className = 'sk-ctl'; done.textContent = '✓ Done'
  done.addEventListener('click', function() { App.showLibrary() })
  const full = document.createElement('button'); full.className = 'sk-ctl'; full.textContent = '⛶ Full page'
  full.addEventListener('click', function() { window._sketchFull = true; renderPageContent() })
  bar.appendChild(done); bar.appendChild(full)
  layer.appendChild(bar)
}

// Deferred-stroke timer for the adaptive template-first path (heavy pages only).

// Predictive prefetch (McMaster-Carr's hover-prefetch idea): once you settle on a page and aren't
// navigating, quietly parse the PREFETCH_AHEAD pages ahead + PREFETCH_BEHIND behind into memory so
// a sequential flip is INSTANT (already parsed, no template-first defer). Forward-weighted because
// you almost always flip forward. Each page is parsed only while the main thread is IDLE
// (requestIdleCallback) and prefetch yields entirely whenever the app is doing real work — writing,
// animating, saving, or a pending heavy-page load — so it never competes with foreground jobs.
let _prefetchTimer = null
function schedulePrefetch() {
  if (_prefetchTimer) clearTimeout(_prefetchTimer)
  _prefetchTimer = setTimeout(prefetchNeighbours, PREFETCH_IDLE_MS)
}

// True while the app is doing foreground work that prefetch must yield to (so a background parse
// never steals cycles from the pen, an animation, or a save).
function appBusy() {
  return isDrawing || animOn || autosavePending
}

// Run fn when the main thread is idle; fall back to a short timer where requestIdleCallback is absent.
function whenIdle(fn) {
  if (window.requestIdleCallback) { window.requestIdleCallback(fn, { timeout: 2000 }); return }
  setTimeout(fn, 16)
}

function prefetchNeighbours() {
  if (!notebook) return
  // Forward-weighted, nearest-first: all the AHEAD pages (most likely next), then the BEHIND ones.
  const targets = []
  for (let d = 1; d <= PREFETCH_AHEAD; d++) targets.push(currentPageIndex + d)
  for (let d = 1; d <= PREFETCH_BEHIND; d++) targets.push(currentPageIndex - d)
  const base = currentPageIndex
  let i = 0
  ;(function step() {
    if (!notebook || currentPageIndex !== base) return   // navigated away → the new page schedules its own
    if (i >= targets.length) return
    // Only touch the disk/parser when the processor is free; if a job is running, wait and retry
    // WITHOUT consuming a target.
    if (appBusy()) { _prefetchTimer = setTimeout(step, PREFETCH_IDLE_MS); return }
    const idx = targets[i++]
    if (idx >= 0 && idx < notebook.pages.length && notebook.pages[idx].strokes === null) {
      ensurePageLoaded(idx)   // read + parse → ready in memory for an instant flip
    }
    whenIdle(step)            // next page only once the main thread is idle again
  })()
}

// Memory eviction: a page's strokes stay resident once parsed, so flipping through a long notebook
// (and, later, a converted book of hundreds of pages) grows memory until the OS kills the app. Drop
// the strokes of pages OUTSIDE a resident window around the current page back to null — they reload
// instantly via the lazy path (ensurePageLoaded). This is gated EVEN HARDER than prefetch: it waits a
// long settle (EVICT_IDLE_MS), then runs only inside a TRUE idle slice (requestIdleCallback with NO
// timeout, so it's never forced) that actually has time left, and yields whenever the app is busy. It
// NEVER evicts a dirty page — autosave clears _dirty first, then a later pass drops it — so eviction
// can't lose unsaved ink and never has to perform a save itself.
let _evictTimer = null
function scheduleEvict() {
  if (_evictTimer) clearTimeout(_evictTimer)
  _evictTimer = setTimeout(function() {
    if (window.requestIdleCallback) window.requestIdleCallback(evictDistantPages)   // no timeout: pure idle only
    else evictDistantPages(null)
  }, EVICT_IDLE_MS)
}

function evictDistantPages(deadline) {
  if (!notebook) return
  // Defer if the app is working, or the idle slice is too short to be safe — retry later, never force it.
  if (appBusy() || (deadline && deadline.timeRemaining() < EVICT_MIN_IDLE_MS)) { scheduleEvict(); return }
  const lo = currentPageIndex - RESIDENT_BEHIND
  const hi = currentPageIndex + RESIDENT_AHEAD
  const pages = notebook.pages
  for (let idx = 0; idx < pages.length; idx++) {
    if (idx >= lo && idx <= hi) continue            // inside the resident window → keep
    const p = pages[idx]
    if (p && p.strokes !== null && !p._dirty) {
      p.strokes = null                              // drop parsed strokes; reload is the lazy path
      // (When block/image content lands: also null p.blocks and release its cached bitmaps here.)
    }
  }
}

// The floating menu's bounds at its last snapshot (surface px), so a collapse/expand can refresh
// the union of old + new bounds (clearing the footprint the menu used to cover).
let lastMenuBounds = null

// Re-snapshot the floating menu onto the surface (so it's visible) and tell the daemon to ignore
// pen inside it. [prevBounds] (optional) = the menu's previous footprint, for the clear-on-collapse
// refresh. Called whenever the menu opens/closes or its contents change (tool, page number, …).
function updateMenu(prevBounds) {
  const menu = document.getElementById('menu')
  if (!menu) return
  const dpr = window.devicePixelRatio || 1
  requestAnimationFrame(function() {
    if (editorWebInputActive) return
    const r = menu.getBoundingClientRect()
    const cl = Math.floor(r.left * dpr), ct = Math.floor(r.top * dpr)
    const cr = Math.ceil(r.right * dpr), cb = Math.ceil(r.bottom * dpr)
    if (cr <= cl || cb <= ct) return
    if (needsStandardEditorHandoff()) {
      lastMenuBounds = { l: cl, t: ct, r: cr, b: cb }
      return
    }
    Bridge.setWritingTop(0)                       // no top strip any more
    // Exclude only the menu's own footprint from writing — pen-down on the (small) handle opens it
    // rather than writing under it; everything NOT covered by the menu stays writable.
    Bridge.setWritingExclusion(cl, ct, cr, cb)
    const p = prevBounds || { l: cl, t: ct, r: cr, b: cb }
    Bridge.snapshotMenu(cl, ct, cr, cb,
      Math.min(cl, p.l), Math.min(ct, p.t), Math.max(cr, p.r), Math.max(cb, p.b))
    lastMenuBounds = { l: cl, t: ct, r: cr, b: cb }
  })
}

// Open/close the menu. Capture the footprint BEFORE toggling so we can clear it on collapse.
function toggleMenu() {
  const menu = document.getElementById('menu')
  const prev = lastMenuBounds
  menu.classList.toggle('collapsed')
  updateMenu(prev)
}

// Full menu re-bake (used on open). App overlays may provide their own chrome layout while keeping
// the same real controls and native snapshot contract (Notes has a top strip plus a side rail).
function snapshotToolbar() {
  if (window.KalamosEditorChrome && typeof window.KalamosEditorChrome.snapshotAll === 'function' &&
      window.KalamosEditorChrome.snapshotAll()) return
  updateMenu(lastMenuBounds)
}

// Re-bake ONLY the region covering the given element ids (e.g. the two tool buttons, or the page
// number) and refresh just that rect — so a button tap doesn't re-bake/flash the whole menu. When
// the menu is collapsed the buttons are hidden (no layout box) so this safely no-ops.
function snapshotToolbarEls(ids) {
  if (window.KalamosEditorChrome && typeof window.KalamosEditorChrome.snapshotElements === 'function' &&
      window.KalamosEditorChrome.snapshotElements(ids)) return
  const dpr = window.devicePixelRatio || 1
  requestAnimationFrame(function() {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i])
      if (!el || el.offsetParent === null) continue   // hidden (menu collapsed) → skip
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.left < l) l = rect.left
      if (rect.top < t) t = rect.top
      if (rect.right > r) r = rect.right
      if (rect.bottom > b) b = rect.bottom
    }
    if (r <= l || b <= t) return
    Bridge.snapshotToolbarRegion(
      Math.floor(l * dpr), Math.floor(t * dpr), Math.ceil(r * dpr), Math.ceil(b * dpr))
  })
}

// Flush the native stroke batch into the model, then run [fn] against the up-to-date model.
// Used before model ops (undo/redo/erase) so strokes written but not yet flushed aren't lost.
let pendingAfterFlush = null
function flushNativeThen(fn) {
  if (needsStandardEditorHandoff()) {
    fn()
    return
  }
  pendingAfterFlush = fn
  Bridge.flushInk()   // native flushes the batch (window.onStrokesBatch) then fires onNativeFlushed
}
window.onNativeFlushed = function() {
  const h = window._inkHandler
  if (h && typeof h.onNativeFlushed === 'function') { h.onNativeFlushed(); return }
  const cb = pendingAfterFlush
  pendingAfterFlush = null
  if (cb) cb()
}

// A native keyboard needs a live WebView input. Capture committed vectors through the existing
// temporary canvas handoff after flush; restore native ownership only at its existing ready callback.
let editorWebInputActive = false
const editorWebInputOwners = new Set()
let editorWebInputGeneration = 0
let editorWebInputReady = false
let editorWebInputCallbacks = []

// Text input and editor dialogs share one transient ownership boundary. Separate owners allow
// a text prompt to open from a settings sheet without prematurely restoring the daemon.
function beginEditorWebInput(owner, ready) {
  if (editorWebInputOwners.has(owner)) {
    if (ready && editorWebInputReady) ready(currentPage())
    else if (ready) editorWebInputCallbacks.push({ owner: owner, ready: ready })
    return
  }
  editorWebInputOwners.add(owner)
  if (ready) editorWebInputCallbacks.push({ owner: owner, ready: ready })
  if (editorWebInputActive) {
    if (editorWebInputReady && ready) { editorWebInputCallbacks.pop(); ready(currentPage()) }
    return
  }
  editorWebInputActive = true
  const generation = ++editorWebInputGeneration
  Bridge.setInkEnabled(false)
  flushNativeThen(function() {
    if (!editorWebInputActive || generation !== editorWebInputGeneration) return
    renderPageContent(true)
    showStandardEditorHandoff(true)
    requestAnimationFrame(function() {
      if (!editorWebInputActive || generation !== editorWebInputGeneration) return
      if (!needsStandardEditorHandoff()) {
        inkSdkActive = false
        Bridge.setInteractivePanel(true)
        Bridge.detachInkBoxForWeb()
      }
      console.log("DIAG editorWebDialog ready owners=" + editorWebInputOwners.size)
      editorWebInputReady = true
      const callbacks = editorWebInputCallbacks
      editorWebInputCallbacks = []
      callbacks.forEach(function(item) {
        if (editorWebInputOwners.has(item.owner)) item.ready(currentPage())
      })
    })
  })
}

function endEditorWebInput(owner) {
  if (!editorWebInputOwners.delete(owner) || editorWebInputOwners.size) return
  editorWebInputActive = false
  editorWebInputReady = false
  editorWebInputGeneration++
  editorWebInputCallbacks = []
  if (needsStandardEditorHandoff()) {
    hideStandardEditorHandoff(); renderPageContent(true); showStandardEditorHandoff()
    return
  }
  if (inkSdkActive) {
    // Closed before the ordered flush completed: keep the already attached surface.
    Bridge.setInkEnabled(true)
    return
  }
  Bridge.setInteractivePanel(false)
  window._needFullToolbar = true
  attachInkWhenReady()
}

function resetEditorWebInput() {
  editorWebInputOwners.clear()
  editorWebInputActive = false
  editorWebInputReady = false
  editorWebInputGeneration++
  editorWebInputCallbacks = []
}

window.KalamosEditorTextInput = {
  begin: function(ready) { beginEditorWebInput('text', ready) },
  end: function() { endEditorWebInput('text') }
}
window.KalamosEditorWebDialog = {
  isActive: function() { return editorWebInputActive },
  begin: function(ready) { beginEditorWebInput('dialog', ready) },
  end: function() { endEditorWebInput('dialog') }
}

// Floating drawing chrome is ordinary DOM on Standard Android. Bigme alone needs its established
// retained-panel handoff because its daemon owns the visible writing frame.
let editorChromeMoveActive = false

window.KalamosEditorLiveChrome = {
  beginMove: function() {
    if (editorChromeMoveActive) return true
    editorChromeMoveActive = true
    if (needsStandardEditorHandoff()) {
      // No bridge call, snapshot, native flush, or surface transition: pointermove below changes
      // only the menu element's CSS position, exactly as it would in a standalone website.
      return true
    }
    if (!inkSdkActive) {
      showStandardEditorHandoff()
      Bridge.setInteractivePanel(true)
      if (Bridge.showWebWorkspace) Bridge.showWebWorkspace()
      return true
    }
    Bridge.setInkEnabled(false)
    flushNativeThen(function() {
      // A tap can finish before Android returns the ordered flush. In that
      // case the daemon never needs to be detached.
      if (!editorChromeMoveActive) {
        Bridge.setInkEnabled(true)
        return
      }
      const webPreviewReady = showStandardEditorHandoff()
      const handOff = function() {
        // The drag may end during the requestAnimationFrame used to commit the Standard canvas.
        if (!editorChromeMoveActive) {
          hideStandardEditorHandoff()
          Bridge.setInkEnabled(true)
          return
        }
        inkSdkActive = false
        Bridge.setInteractivePanel(true)
        Bridge.detachInkBoxForWeb()
      }
      // Give an ordinary Android WebView one frame to commit its page before the SurfaceView is
      // hidden. Bigme never renders a preview, so it executes its established sequence immediately.
      if (webPreviewReady) requestAnimationFrame(handOff)
      else handOff()
    })
    return true
  },
  endMove: function() {
    if (!editorChromeMoveActive) return
    editorChromeMoveActive = false
    if (needsStandardEditorHandoff()) {
      // The released DOM position is already the visible position.
      return
    }
    if (inkSdkActive) {
      hideStandardEditorHandoff()
      Bridge.setInteractivePanel(false)
      Bridge.setInkEnabled(true)
      return
    }
    Bridge.setInteractivePanel(false)
    window._needFullToolbar = true
    attachInkWhenReady()
  },
  requiresReleaseSnapshot: function() {
    return false
  }
}

// ============== ERASER ==============

function distToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) * (px - ax) + (py - ay) * (py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = ax + t * dx
  const projY = ay + t * dy
  return (px - projX) * (px - projX) + (py - projY) * (py - projY)
}

function hitTestStroke(ex, ey, stroke) {
  const pts = stroke.points
  if (pts.length === 0) return false
  const eraserRadius = 8    // model/CSS px — narrow for precision (swipe-path sampling keeps it reliable)
  const hitThreshold = eraserRadius + stroke.width / 2
  const hitThresholdSq = hitThreshold * hitThreshold

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (ex < minX - hitThreshold || ex > maxX + hitThreshold ||
      ey < minY - hitThreshold || ey > maxY + hitThreshold) {
    return false
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const dSq = distToSegmentSq(ex, ey, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)
    if (dSq < hitThresholdSq) return true
  }
  if (pts.length === 1) {
    const dSq = (ex - pts[0].x) * (ex - pts[0].x) + (ey - pts[0].y) * (ey - pts[0].y)
    if (dSq < hitThresholdSq) return true
  }
  return false
}

function hitTestAll(ex, ey) {
  const page = currentPage()
  if (!page) return null
  for (let i = page.strokes.length - 1; i >= 0; i--) {
    if (hitTestStroke(ex, ey, page.strokes[i])) {
      return page.strokes[i]
    }
  }
  return null
}


function hideEraserCursor() {
  eraserCursor.style.display = 'none'
}

// ============== POINTER EVENTS (eraser and fallback pen) ==============

function getCanvasCoords(e) {
  // Use the SAME offset the model uses (inkCssBounds), NOT the live paper rect. The two can diverge
  // (reused WebView / offscreen-layout race leaves inkCssBounds stale), and then the eraser would
  // hit-test in a different space than the strokes and miss everything. surface_x/dpr == clientX
  // (full-screen surface), so model coord = clientX - inkCssBounds.left.
  return { x: e.clientX - inkCssBounds.left, y: e.clientY - inkCssBounds.top }
}

function isStylusEraser(e) {
  // W3C Pointer Events: the stylus eraser reports pointerType 'pen' with buttons bit 32 / button 5.
  return e.pointerType === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5)
}

function onPointerDown(e) {
  // Handwriting is stylus-owned on the device. Let touch continue through the WebView for normal
  // finger interaction instead of turning a palm/finger drag into pen or eraser vectors. Mouse is
  // intentionally retained for desktop browser previews, where no physical stylus may be present.
  if (e.pointerType === 'touch') return
  const eraserEnd = isStylusEraser(e)
  // Pen TIP while the daemon is active: the daemon owns writing — do nothing here (keep the write
  // path free of web work). Only the stylus eraser is handled in the web layer.
  if (!eraserEnd && inkSdkActive && activeTool !== 'eraser') return

  e.preventDefault()
  PenPriority.enterCapture()

  if (e.pointerType === 'pen') {
    if (eraserEnd && activeTool !== 'eraser') {
      activeTool = 'eraser'
      flipEraserActive = true
      activeStroke = null
      isDrawing = false
      if (!needsStandardEditorHandoff()) {
        Bridge.setErasing(true) // Bigme discards any daemon stroke (mis-detected eraser-as-pen)
      }
      updateUI()
    } else if (!eraserEnd && flipEraserActive && activeTool === 'eraser') {
      activeTool = 'pen'
      flipEraserActive = false
      if (!needsStandardEditorHandoff()) Bridge.setErasing(false)
      updateUI()
    }
  }

  const coords = getCanvasCoords(e)

  if (activeTool === 'eraser') {
    paper.setPointerCapture(e.pointerId)
    isDrawing = true
    eraseBox = null            // start a fresh erased-region accumulation for this swipe
    eraseAt(coords.x, coords.y)
    lastErasePoint = coords
  } else if (needsStandardEditorHandoff()) {
    // Standard Android is deliberately the normal website path. Keep the complete gesture inside
    // WebView and append it to the same vector model used by Bigme's batched daemon callbacks.
    ensurePageLoaded(currentPageIndex)
    const felt = activePenType === 'felt'
    activeStroke = {
      id: 's-' + uid(),
      tool: felt ? 'felt' : (activePenType === 'selection' ? 'selection' : 'pen'),
      color: activeColor,
      width: strokeWidth,
      points: [{
        x: coords.x,
        y: coords.y,
        p: felt && typeof e.pressure === 'number' ? e.pressure : undefined
      }]
    }
    isDrawing = true
    paper.setPointerCapture(e.pointerId)
  }
}

function appendStandardWebPointer(e) {
  if (!needsStandardEditorHandoff() || !isDrawing || !activeStroke || activeTool === 'eraser') {
    return false
  }
  const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
  const dpr = window.devicePixelRatio || 1
  const canvas = standardHandoffInkCanvas
  const ctx = canvas && canvas.getContext('2d')
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const coords = getCanvasCoords(sample)
    const previous = activeStroke.points[activeStroke.points.length - 1]
    if (previous && Math.hypot(coords.x - previous.x, coords.y - previous.y) < 0.35) continue
    const point = { x: coords.x, y: coords.y }
    if (activeStroke.tool === 'felt') point.p =
      typeof sample.pressure === 'number' ? sample.pressure : 0.5
    activeStroke.points.push(point)
    if (ctx && previous) {
      drawStandardHandoffStroke(ctx, {
        tool: activeStroke.tool,
        color: activeStroke.color,
        width: activeStroke.width,
        points: [previous, point]
      }, dpr)
    }
  }
  return true
}

function finishStandardWebStroke(e) {
  if (!needsStandardEditorHandoff() || !isDrawing || !activeStroke || activeTool === 'eraser') {
    return false
  }
  appendStandardWebPointer(e)
  const stroke = activeStroke
  activeStroke = null
  isDrawing = false
  try { paper.releasePointerCapture(e.pointerId) } catch (_) {}

  const page = currentPage()
  if (!page || !Array.isArray(page.strokes) || stroke.points.length === 0) return true
  if (stroke.points.length === 1 && standardHandoffInkCanvas) {
    drawStandardHandoffStroke(
      standardHandoffInkCanvas.getContext('2d'),
      stroke,
      window.devicePixelRatio || 1
    )
  }
  if (EditorTools.modes.eraseLasso && stroke.tool === 'selection') { EditorTools.eraseLasso(page, stroke.points); return true }
  if (e.type !== 'pointercancel' && stroke.tool !== 'selection' && EditorTools.eraseScribble(page, stroke.points)) return true
  const index = page.strokes.length
  page.strokes.push(stroke)
  page._dirty = true
  History.push(
    function() {
      page.strokes.splice(index, 1)
      page._dirty = true
      syncNativePage()
      triggerAutosave()
      History.updateButtons()
    },
    function() {
      page.strokes.splice(index, 0, deepClone(stroke))
      page._dirty = true
      syncNativePage()
      triggerAutosave()
      History.updateButtons()
    }
  )
  if (EditorTools.hasPostWriteMode()) EditorTools.afterBatch(page, [stroke])
  triggerAutosave()
  PenPriority.scheduleSync()
  return true
}

// Erase EVERY stroke within the eraser radius of (x,y) — handles densely stacked strokes too.
function eraseAt(x, y) {
  let hit = hitTestAll(x, y)
  while (hit) { eraseStroke(hit); hit = hitTestAll(x, y) }
  eraseTextAt(x, y)
}

// Erase a converted-handwriting text item under the eraser (baked content — needs a re-bake).
let _textMeasureCtx = null
function measureTextItem(t) {
  if (!_textMeasureCtx) _textMeasureCtx = document.createElement('canvas').getContext('2d')
  _textMeasureCtx.font = t.size + 'px sans-serif'
  return _textMeasureCtx.measureText(t.text).width
}

function eraseTextAt(x, y) {
  const page = currentPage()
  if (!page || !Array.isArray(page.texts) || !page.texts.length) return
  for (let i = page.texts.length - 1; i >= 0; i--) {
    const t = page.texts[i]
    const w = measureTextItem(t), h = t.size * 1.25
    if (x < t.x - 4 || x > t.x + w + 4 || y < t.y - 4 || y > t.y + h + 4) continue
    const copy = deepClone(t)
    page.texts.splice(i, 1)
    page._dirty = true
    ;(function(item, idx) {
      History.push(
        function() { page.texts.splice(idx, 0, deepClone(item)); page._dirty = true; renderPageContent(); triggerAutosave(); History.updateButtons() },
        function() { page.texts.splice(idx, 1); page._dirty = true; renderPageContent(); triggerAutosave(); History.updateButtons() }
      )
    })(copy, i)
    renderPageContent()   // re-bake the content layer without the erased text
    triggerAutosave()
  }
}

// Erase along the segment from→to, sampling intermediate points so a fast swipe (sparse pointermove
// events) doesn't skip over strokes between samples.
function eraseAlong(from, to) {
  if (!from) { eraseAt(to.x, to.y); return }
  const dx = to.x - from.x, dy = to.y - from.y
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 6))
  for (let i = 1; i <= steps; i++) eraseAt(from.x + dx * i / steps, from.y + dy * i / steps)
}

// Live erase feedback: re-render + partial-refresh the just-erased region, throttled so the e-ink
// GU16 refreshes don't pile up. Strokes vanish as the swipe crosses them instead of all at pen-up.
function scheduleEraseRefresh() {
  if (eraseRefreshTimer) return        // already one pending — throttle
  eraseRefreshTimer = setTimeout(flushEraseRefresh, ERASE_REFRESH_MS)
}

function flushEraseRefresh() {
  eraseRefreshTimer = null
  if (!eraseBox) return
  const rr = { x: eraseBox.minX, y: eraseBox.minY, w: eraseBox.maxX - eraseBox.minX, h: eraseBox.maxY - eraseBox.minY }
  eraseBox = null                      // reset so the next interval refreshes only the newly-erased area
  syncNativePage(rr)
}

function onPointerMove(e) {
  if (appendStandardWebPointer(e)) {
    e.preventDefault()
    return
  }
  if (activeTool !== 'eraser' || !isDrawing) return
  e.preventDefault()
  const coords = getCanvasCoords(e)
  eraseAlong(lastErasePoint, coords)   // erases the model + schedules a live refresh per stroke
  lastErasePoint = coords
}

function eraserFinalize() {
  isDrawing = false
  lastErasePoint = null
  hideEraserCursor()
  if (eraseRefreshTimer) { clearTimeout(eraseRefreshTimer); eraseRefreshTimer = null }
  if (eraseBox) {                      // flush any region erased since the last live refresh
    const rr = { x: eraseBox.minX, y: eraseBox.minY, w: eraseBox.maxX - eraseBox.minX, h: eraseBox.maxY - eraseBox.minY }
    syncNativePage(rr)
    eraseBox = null
  }
  triggerAutosave()
}

function onPointerUp(e) {
  if (finishStandardWebStroke(e)) {
    e.preventDefault()
    return
  }
  if (activeTool !== 'eraser' || !isDrawing) return
  e.preventDefault()
  eraserFinalize()
}

function onPointerLeave(e) {
  // Pointer capture keeps a Standard WebView pen gesture alive outside #paper until pointerup.
  if (needsStandardEditorHandoff() && activeStroke) return
  if (activeTool !== 'eraser' || !isDrawing) return
  eraserFinalize()
  try { paper.releasePointerCapture(e.pointerId) } catch(_) {}
}

// ============== ERASE STROKE ==============

// Remove a stroke from the model + push undo, and schedule a throttled live refresh so it visibly
// disappears mid-swipe (not all at once on pen-up).
function eraseStroke(stroke) {
  const page = currentPage()
  if (!page) return
  const idx = page.strokes.indexOf(stroke)
  if (idx === -1) return
  const copy = deepClone(stroke)
  page.strokes.splice(idx, 1)
  page._dirty = true
  for (let i = 0; i < stroke.points.length; i++) {
    const p = stroke.points[i]
    if (!eraseBox) eraseBox = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
    else {
      if (p.x < eraseBox.minX) eraseBox.minX = p.x
      if (p.y < eraseBox.minY) eraseBox.minY = p.y
      if (p.x > eraseBox.maxX) eraseBox.maxX = p.x
      if (p.y > eraseBox.maxY) eraseBox.maxY = p.y
    }
  }
  History.push(
    function() { page.strokes.splice(idx, 0, deepClone(copy)); page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons() },
    function() { page.strokes.splice(idx, 1); page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons() }
  )
  scheduleEraseRefresh()   // live feedback (throttled); finalize handles the remainder on pen-up
}

// ============== PAGE MANAGEMENT ==============

function goToPage(index) {
  if (index < 0 || index >= totalPages()) return
  stopAnim()                // animations are per-page — leaving this page stops it
  currentPageIndex = index  // syncNativePage presents this page with its complete strokes
  activeStroke = null
  isDrawing = false
  hideEraserCursor()
  updateUI()
  // The daemon stays attached across page changes (same full-screen surface) — re-attaching it was
  // ~160ms of reflection + re-bind per turn. Just re-render the new page onto the surface.
  syncNativePage()
  renderPageContent()   // re-bake the new page's interactive content (or clear it on a plain page)
  snapshotToolbarEls(['btn-prev', 'page-num', 'btn-next', 'btn-add', 'btn-delete'])
}

// Hardware page-turn buttons in a notebook: down = next page (creates one if on the last page),
// up = previous page. Flush pending strokes first so the current page's writing is saved.
function editorPageTurn(dir) {
  if (!notebook) return
  if (dir === 'down') {
    if (currentPageIndex < totalPages() - 1) flushNativeThen(goToNextPage)
    else flushNativeThen(addPage)
  } else if (dir === 'up') {
    if (currentPageIndex > 0) flushNativeThen(goToPrevPage)
  }
}

function goToPrevPage() {
  if (currentPageIndex > 0) goToPage(currentPageIndex - 1)
}

function goToNextPage() {
  if (currentPageIndex < totalPages() - 1) goToPage(currentPageIndex + 1)
}

function addPage() {
  stopAnim()
  const page = currentPage()
  const tmpl = page ? page.template : notebook.defaultTemplate
  const newPage = createPage(tmpl)
  const newIndex = currentPageIndex + 1
  notebook.pages.splice(newIndex, 0, newPage)
  const prevIndex = currentPageIndex
  currentPageIndex = newIndex
  History.push(
    function() {
      notebook.pages.splice(newIndex, 1)
      currentPageIndex = prevIndex < notebook.pages.length ? prevIndex : notebook.pages.length - 1
      updateUI(); triggerAutosave(); History.updateButtons()
    },
    function() {
      notebook.pages.splice(newIndex, 0, newPage)
      currentPageIndex = newIndex
      updateUI(); triggerAutosave(); History.updateButtons()
    }
  )
  activeStroke = null
  isDrawing = false
  updateUI()
  syncNativePage()   // daemon stays attached; just re-render the new page
  renderPageContent()   // new page has no blocks → clears any baked content
  snapshotToolbarEls(['btn-prev', 'page-num', 'btn-next', 'btn-add', 'btn-delete'])
  triggerAutosave()
}

function deletePage() {
  if (totalPages() <= 1) return
  stopAnim()
  const pageToDelete = notebook.pages[currentPageIndex]
  const deleteIndex = currentPageIndex
  const wasLastPage = currentPageIndex === totalPages() - 1
  notebook.pages.splice(currentPageIndex, 1)
  if (wasLastPage) currentPageIndex = Math.max(0, totalPages() - 1)
  History.push(
    function() {
      const restored = deepClone(pageToDelete)
      restored._dirty = true   // its page file was vacuumed on the delete's save — re-write its strokes
      notebook.pages.splice(deleteIndex, 0, restored)
      currentPageIndex = deleteIndex
      updateUI(); triggerAutosave(); History.updateButtons()
    },
    function() {
      notebook.pages.splice(deleteIndex, 1)
      if (currentPageIndex >= notebook.pages.length) currentPageIndex = notebook.pages.length - 1
      updateUI(); triggerAutosave(); History.updateButtons()
    }
  )
  activeStroke = null
  isDrawing = false
  updateUI()
  syncNativePage()   // daemon stays attached; just re-render the new page
  renderPageContent()   // re-bake the now-current page's content (or clear it)
  snapshotToolbarEls(['btn-prev', 'page-num', 'btn-next', 'btn-add', 'btn-delete'])
  triggerAutosave()
}

// ============== TEMPLATE ==============

function setTemplate(type) {
  const page = currentPage()
  if (!page) return
  const oldTmpl = deepClone(page.template)
  const newTmpl = deepClone(page.template)
  newTmpl.type = type
  page.template = newTmpl
  // Also update notebook default template
  notebook.defaultTemplate = deepClone(newTmpl)
  History.push(
    function() { page.template = deepClone(oldTmpl); triggerAutosave(); History.updateButtons(); updateUI() },
    function() { page.template = deepClone(newTmpl); triggerAutosave(); History.updateButtons(); updateUI() }
  )
  updateUI()
  triggerAutosave()
  syncNativePage()   // re-render the native page with the new template
}

// ============== AUTOSAVE ==============

function triggerAutosave() {
  if (!notebook) return
  updateAutosaveStatus('saving')
  autosavePending = true
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(function() {
    if (!Storage.saveNotebookDirty(notebook)) {
      // Don't pretend it saved — a silent failure on a removed/full SD card would lose work.
      autosavePending = false
      updateAutosaveStatus('error')
      Bridge.showToast('Save failed — check storage')
      return
    }
    // Also update library index
    const lib = Storage.loadLibrary()
    const info = lib.notebooks.find(function(n) { return n.notebookId === notebook.notebookId })
    if (info) {
      info.title = notebook.title
      info.updatedAt = notebook.updatedAt
      info.folderId = notebook.folderId || ''
      info.defaultTemplate = notebook.defaultTemplate
      Storage.saveLibrary(lib)
    }
    autosavePending = false
    updateAutosaveStatus('saved')
    setTimeout(function() { if (!autosavePending) updateAutosaveStatus('idle') }, 2000)
  }, 300)
}

function updateAutosaveStatus(state) {
  if (!autosaveStatus) return
  if (state === 'saving') {
    autosaveStatus.textContent = 'Saving...'
  } else if (state === 'saved') {
    autosaveStatus.textContent = 'Saved'
  } else if (state === 'error') {
    autosaveStatus.textContent = '⚠ Save failed'
  } else {
    autosaveStatus.textContent = ''
  }
}

// ============== SAVE on navigation ==============

window.saveNotebook = function() {
  if (notebook && !Storage.saveNotebookDirty(notebook)) {
    updateAutosaveStatus('error')
    Bridge.showToast('Save failed — check storage')
  }
}

window.onExportComplete = function(success) {
  Bridge.showToast(success ? 'Exported successfully' : 'Export cancelled')
}

// ============== UI ==============

function updateUI() {
  const page = currentPage()
  const total = totalPages()
  pageNumEl.textContent = (currentPageIndex + 1) + '/' + total
  document.getElementById('btn-prev').disabled = currentPageIndex <= 0
  document.getElementById('btn-next').disabled = currentPageIndex >= total - 1
  document.getElementById('btn-delete').disabled = total <= 1
  if (page) {
    templateSelect.value = page.template.type
    paper.dataset.template = page.template.type
    ;['blank', 'ruled', 'grid', 'dotted', 'weekly', 'cornell'].forEach(function (type) { paper.classList.toggle(type, type === page.template.type) })
  }
  document.getElementById('btn-pen').classList.toggle('active', activeTool === 'pen' && activePenType === 'ballpoint')
  document.getElementById('btn-felt').classList.toggle('active', activeTool === 'pen' && activePenType === 'felt')
  document.getElementById('btn-selection').classList.toggle('active', activeTool === 'pen' && activePenType === 'selection')
  document.getElementById('btn-eraser').classList.toggle('active', activeTool === 'eraser')
}

// ============== TOOLBAR EVENTS ==============

// Switch to a writing pen. type = 'ballpoint' (constant width) | 'felt' (width follows pen pressure).
function selectPen(type) {
  EditorTools.modes.eraseLasso = false
  activeTool = 'pen'
  activePenType = type
  flipEraserActive = false
  activeStroke = null
  isDrawing = false
  hideEraserCursor()
  if (!needsStandardEditorHandoff()) {
    Bridge.setErasing(false)             // Bigme daemon resumes inking; pen tip writes
    Bridge.setPenType(type)              // ballpoint | felt | selection
  }
  updateUI()
  snapshotToolbarEls(['btn-pen', 'btn-felt', 'btn-selection', 'btn-eraser'])
}

// Expanding colour palette inside the menu (the menu grows; updateMenu re-snapshots + refreshes,
// exactly like a menu expand/collapse — so it reuses the proven menu-snapshot path).
function toggleColorPopup() {
  const grid = document.getElementById('color-grid')
  grid.style.display = (grid.style.display === 'none' || !grid.style.display) ? 'grid' : 'none'
  if (window.KalamosEditorChrome && typeof window.KalamosEditorChrome.layoutChanged === 'function' &&
      window.KalamosEditorChrome.layoutChanged()) return
  updateMenu(lastMenuBounds)
}

function closeColorPopup() {
  const grid = document.getElementById('color-grid')
  if (grid.style.display === 'none') return
  grid.style.display = 'none'
  if (window.KalamosEditorChrome && typeof window.KalamosEditorChrome.layoutChanged === 'function' &&
      window.KalamosEditorChrome.layoutChanged()) return
  updateMenu(lastMenuBounds)   // refresh union clears the palette's footprint as the menu shrinks
}

// Pick an ink colour. Applies to the daemon (live) + new strokes; each stroke stores its own colour.
function selectColor(hex) {
  activeColor = hex
  if (!needsStandardEditorHandoff()) {
    Bridge.setInkStyle(strokeWidth * (window.devicePixelRatio || 1), activeColor)
  }
  updateColorUI()
  closeColorPopup()
}

function updateColorUI() {
  const dot = document.getElementById('color-dot')
  if (dot) dot.style.background = activeColor
  const sws = document.querySelectorAll('#color-grid .pop-swatch')
  for (let i = 0; i < sws.length; i++) {
    sws[i].classList.toggle('active', sws[i].getAttribute('data-color').toLowerCase() === activeColor.toLowerCase())
  }
}

// Bird-on-a-bike animation, driven entirely in the web layer (rAF). Wheels + crank rotate by time;
// the legs are solved with 2-bone IK so the feet ride the pedals. Native is unaware of any of this —
// it just samples the #anim-layer region — so this is fully generic (swap Bike + the SVG for anything).
const Bike = {
  active: false, built: false,
  _wheel(id, cx, cy, r) {
    const g = document.getElementById(id), NS = 'http://www.w3.org/2000/svg'
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3, dx = r * Math.cos(a), dy = r * Math.sin(a)
      const ln = document.createElementNS(NS, 'line')
      ln.setAttribute('x1', (cx - dx).toFixed(1)); ln.setAttribute('y1', (cy - dy).toFixed(1))
      ln.setAttribute('x2', (cx + dx).toFixed(1)); ln.setAttribute('y2', (cy + dy).toFixed(1))
      ln.setAttribute('stroke', '#141414'); ln.setAttribute('stroke-width', '2')
      g.insertBefore(ln, g.firstChild)
    }
  },
  _rot(id, deg, cx, cy) {
    document.getElementById(id).setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' ' + cx + ' ' + cy + ')')
  },
  _leg(id, hip, foot, L1, L2) {
    const dx = foot.x - hip.x, dy = foot.y - hip.y
    let d = Math.hypot(dx, dy); d = Math.min(d, L1 + L2 - 0.5)
    const base = Math.atan2(dy, dx)
    let c = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d); c = Math.max(-1, Math.min(1, c))
    const ka = base - Math.acos(c)   // knee bends toward the front
    const kx = hip.x + L1 * Math.cos(ka), ky = hip.y + L1 * Math.sin(ka)
    document.getElementById(id).setAttribute('d', 'M' + hip.x + ' ' + hip.y + ' L' + kx.toFixed(1) + ' ' + ky.toFixed(1) + ' L' + foot.x.toFixed(1) + ' ' + foot.y.toFixed(1))
  },
  frame(ms) {
    const wheelDeg = (ms * 0.5) % 360
    this._rot('wheel-back', wheelDeg, 62, 148)
    this._rot('wheel-front', wheelDeg, 184, 148)
    const crankDeg = (ms * 0.27) % 360
    this._rot('crank', crankDeg, 123, 150)
    const a = crankDeg * Math.PI / 180, kc = { x: 123, y: 150 }, pr = 15, hip = { x: 116, y: 100 }
    this._leg('leg-near', hip, { x: kc.x + pr * Math.cos(a), y: kc.y + pr * Math.sin(a) }, 32, 34)
    this._leg('leg-far', hip, { x: kc.x - pr * Math.cos(a), y: kc.y - pr * Math.sin(a) }, 32, 34)
    document.getElementById('bird').setAttribute('transform', 'translate(0 ' + (Math.sin(a * 2) * 1.2).toFixed(2) + ')')
  },
  start() {
    // Build the wheel spokes once, then CSS drives all motion (compositor-based — keeps advancing
    // when occluded, unlike rAF which throttles). No JS animation loop needed.
    if (!this.built) { this._wheel('wheel-back', 62, 148, 34); this._wheel('wheel-front', 184, 148, 34); this.built = true }
    this.active = true
  },
  stop() { this.active = false }
}

// Toggle a web-defined CSS animation as a TOP BAND. Inverse of the sketch box: the band is a WebView
// region the e-ink system auto-refreshes smoothly (exactly like the reader's lungs), while the daemon
// ink surface is resized to the area BELOW the band so you can still write there. No frame sampling.
let animOn = false
// Height (CSS px) of the bottom animation band. Full width (a rectangular writing surface can only be
// split into rectangles — a live animation can't be a small floating box like the BAKED toolbar can).
// The band sits at the BOTTOM because the toolbar is top-left and the daemon writing surface must keep
// the top so the toolbar still bakes there.
const ANIM_BAND_H = 180

// Stop the animation + return to the full-screen editor. While playing, the daemon surface covered only
// the area ABOVE the band; here we restore the full-screen writing surface. Cheap no-op when nothing is
// running. [_animLeaving] is set by callers tearing the editor down (exit/pause) so we skip the restore.
function stopAnim() {
  if (!animOn) return
  animOn = false
  Bike.stop()
  const layer = document.getElementById('anim-layer')
  layer.style.display = 'none'
  layer.classList.remove('playing')
  layer.style.width = ''; layer.style.height = ''   // back to the default box geometry for next time
  document.getElementById('btn-anim').classList.remove('active')
  inkSurfaceOriginX = 0; inkSurfaceOriginY = 0
  Bridge.setAnimationPanel(false)                    // restore the default panel policy (auto-clean on)
  Bridge.detachInkBox()                              // restore the ink surface to full-screen (MATCH_PARENT)
  if (window._animLeaving) return                    // caller will detach/leave — don't re-attach
  Bridge.enterEditor()
  window._needFullToolbar = true
  attachInkWhenReady()                               // full-screen re-attach → onInkControllerReady re-renders + showEditor
}
window.stopAnim = stopAnim

function toggleAnim() {
  const layer = document.getElementById('anim-layer')
  const btn = document.getElementById('btn-anim')
  if (animOn) { stopAnim(); return }
  // Full-width band pinned to the BOTTOM. The animation is a WebView region the e-ink system refreshes
  // smoothly (like the lungs); the daemon writing surface is the area ABOVE it. The WebView stays
  // TRANSPARENT, so the page shows + writing is daemon-fast everywhere above the band, and only the band
  // is covered (not the whole page). The toolbar (top-left) bakes onto the top daemon surface as usual.
  layer.style.display = 'flex'
  layer.style.left = '0'; layer.style.width = '100%'
  layer.style.height = ANIM_BAND_H + 'px'
  layer.style.top = Math.max(0, window.innerHeight - ANIM_BAND_H) + 'px'
  layer.classList.add('playing')   // run the CSS @keyframes (same mechanism as the reader's lungs)
  animOn = true
  btn.classList.add('active')
  Bike.start()                     // build the wheel spokes; CSS drives the motion
  detachInk()
  const dpr = window.devicePixelRatio || 1
  const rect = paper.getBoundingClientRect()
  inkCssBounds = { left: rect.left, top: rect.top }
  inkSurfaceOriginX = 0; inkSurfaceOriginY = 0   // surface stays at the top-left; only its HEIGHT shrinks
  window._noteSketch = null         // editor stroke pipeline (NOT the note/box pipeline)
  window._inkHandler = null
  window._needFullToolbar = true    // bake the menu onto the top daemon surface (WebView is transparent)
  Bridge.enterEditor()
  Bridge.setAnimationPanel(true)    // stop the periodic full-screen clean so writing stays responsive
  // Daemon writing surface = the region ABOVE the band (surface px). onInkControllerReady (editor path,
  // _noteSketch null) renders the page into it, bakes the toolbar, and showEditor() makes the WebView
  // transparent — so the page shows through above and the bottom band animates as live WebView.
  Bridge.attachInkBox(0, 0, Math.round(window.innerWidth * dpr), Math.round((window.innerHeight - ANIM_BAND_H) * dpr))
  Bridge.setInkStyle(strokeWidth * dpr, activeColor)
}

function initToolbar() {
  document.getElementById('btn-menu').addEventListener('click', toggleMenu)

  document.getElementById('btn-library').addEventListener('click', function() {
    // App.showLibrary owns the ordered flush/thumbnail/detach. Starting it twice
    // leaves the second call without its completion callback.
    saveNotebook()
    App.showLibrary()
  })

  document.getElementById('btn-pen').addEventListener('click', function() {
    selectPen('ballpoint')
  })

  document.getElementById('btn-felt').addEventListener('click', function() {
    selectPen('felt')
  })

  document.getElementById('btn-selection').addEventListener('click', function() {
    selectPen('selection')
  })

  document.getElementById('btn-eraser').addEventListener('click', function() {
    EditorTools.modes.eraseLasso = false
    activeTool = 'eraser'
    flipEraserActive = false
    activeStroke = null
    isDrawing = false
    // Standard erases directly in its WebView vector model. Bigme asks its daemon not to paint the
    // eraser gesture while the web hit-testing path removes matching vectors.
    if (!needsStandardEditorHandoff()) Bridge.setErasing(true)
    updateUI()
    snapshotToolbarEls(['btn-pen', 'btn-felt', 'btn-eraser'])   // only the tool buttons changed
  })

  document.getElementById('btn-anim').addEventListener('click', toggleAnim)
  document.getElementById('btn-color').addEventListener('click', toggleColorPopup)
  const popSwatches = document.querySelectorAll('#color-grid .pop-swatch')
  for (let i = 0; i < popSwatches.length; i++) {
    popSwatches[i].addEventListener('click', function() { selectColor(this.getAttribute('data-color')) })
  }
  updateColorUI()   // sync the Color cell's swatch + active highlight to the default colour

  widthSlider.addEventListener('input', function() {
    strokeWidth = parseInt(this.value, 10)
    widthValue.textContent = strokeWidth
    if (!needsStandardEditorHandoff()) {
      Bridge.setInkStyle(strokeWidth * (window.devicePixelRatio || 1), activeColor)
    }
  })
  // The toolbar is a baked snapshot, so the live slider/value moving isn't visible until we
  // re-snapshot. Do it when the slider is released ('change'), not on every 'input' tick.
  widthSlider.addEventListener('change', function() {
    snapshotToolbarEls(['width-slider', 'width-value'])
  })

  templateSelect.addEventListener('change', function() {
    const v = this.value
    flushNativeThen(function() { setTemplate(v); snapshotToolbarEls(['template-select']) })
  })

  document.getElementById('btn-undo').addEventListener('click', function() {
    flushNativeThen(function() { History.undo(); syncNativePage(); snapshotToolbarEls(['btn-undo', 'btn-redo']) })
  })
  document.getElementById('btn-redo').addEventListener('click', function() {
    flushNativeThen(function() { History.redo(); syncNativePage(); snapshotToolbarEls(['btn-undo', 'btn-redo']) })
  })
  // Page ops flush the native batch first so the strokes written on the current page land in
  // its model before we switch away.
  document.getElementById('btn-prev').addEventListener('click', function() { flushNativeThen(goToPrevPage) })
  document.getElementById('btn-next').addEventListener('click', function() { flushNativeThen(goToNextPage) })
  document.getElementById('btn-add').addEventListener('click', function() { flushNativeThen(addPage) })
  document.getElementById('btn-delete').addEventListener('click', function() { flushNativeThen(deletePage) })
  document.getElementById('btn-export').addEventListener('click', function() {
    if (notebook) Bridge.exportNotebook(notebook.notebookId)
  })

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      if (e.shiftKey) flushNativeThen(function() { History.redo(); syncNativePage() })
      else flushNativeThen(function() { History.undo(); syncNativePage() })
    }
  })
}

// ============== HANDWRITING TOOLS (InkFlow + InkTools over the page model) ==============
// The shared assist layer every app's editor chrome talks to (the Notes rail, the classic menu,
// …). Pure model ops: mutate page.strokes / page.texts, push History, re-render natively.
// Assist modes are session-only and opt-in so normal handwriting never starts background transforms.

const EditorTools = {
  modes: { autowrap: false, autoShape: false, help: false, liveText: false, eraseLasso: false },

  eraseScribble(page, points, staged) {
    if (!page || !window.KalamosScribbleErase) return false
    const saved = page.strokes.slice()
    const pending = staged ? staged.strokes : []
    const result = KalamosScribbleErase.detect(points, saved.concat(pending), (page.template || {}).spacing || 44)
    if (!result) return false
    // Settle Zoom's pending vectors into the same snapshot. Undo restores ink on the
    // page, so it remains available after the lower pad has closed or moved target.
    const before = saved.concat(pending.map(stroke => ({ ...stroke, id: 's-' + uid(), tool: 'pen' })))
    const indices = new Set(result.indices)
    const after = before.filter((stroke, i) => !indices.has(i))
    if (staged) staged.restore([])
    const apply = function(strokes) {
      page.strokes = strokes.slice(); page._dirty = true
      syncNativePage(result.rect); triggerAutosave(); History.updateButtons()
    }
    History.push(function() { apply(before) }, function() { apply(after) })
    apply(after)
    return true
  },

  eraseLasso(page, polygon) {
    if (!page || !InkTools.validLasso(polygon)) { syncNativePage(); return }
    const before = page.strokes.slice()
    const after = before.filter(stroke => !InkTools.strokeHitsLasso(stroke.points || [], polygon))
    // The lasso is a command, never a saved stroke. Re-bake once at pen-up, even for a miss,
    // to clear its native preview while preserving the existing refresh/attach policy.
    if (before.length !== after.length) {
      const apply = function(strokes) { page.strokes = strokes.slice(); page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons() }
      page.strokes = after
      page._dirty = true
      History.push(function() { apply(before) }, function() { apply(after) })
      triggerAutosave()
      History.updateButtons()
    }
    syncNativePage()
  },

  setMode(name, on) {
    this.modes[name] = !!on
  },

  hasPostWriteMode() {
    return !!(this.modes.autowrap || this.modes.autoShape || this.modes.help || this.modes.liveText)
  },

  // Ruling geometry of the current page in paper-relative CSS px (the stroke model space).
  geo(page) {
    const tmpl = (page && page.template) || {}
    const r = paper.getBoundingClientRect()
    const lane = tmpl.spacing || 32
    const marginX = Math.min(tmpl.margin || 72, r.width * 0.15)
    const ruled = tmpl.type === 'ruled'
    return {
      lane: lane, top: 0,
      left: ruled ? marginX + 6 : 10,
      right: r.width - 10,
      minWordSep: 0.3,
      ruled: ruled || tmpl.type === 'grid'
    }
  },

  // ---- post-batch pipeline (pen-pause assists) ----
  afterBatch(page, added) {
    if (!window.InkTools || !window.InkFlow) return
    const geo = this.geo(page)
    let moved = false

    // Easy Shape Correction — replace each sketched line/circle/rect/polygon with a clean one
    if (this.modes.autoShape) {
      for (const s of added) {
        const shape = InkTools.perfectShape(s, geo.lane)
        if (shape) {
          const before = s.points
          s.points = shape
          moved = true
          ;(function(st, prev, next) {
            History.push(
              function() { st.points = prev; page._dirty = true; syncNativePage(); triggerAutosave() },
              function() { st.points = next; page._dirty = true; syncNativePage(); triggerAutosave() }
            )
          })(s, before, shape)
        }
      }
    }

    // Handwriting Help — bind the new word to the line/size its lane established
    if (this.modes.help && geo.ruled && !moved) {
      const before = added.map(s => s.points.map(p => ({ ...p })))
      InkTools.bindToLine(added, page.strokes, geo)
      const after = added.map(s => s.points.map(p => ({ ...p })))
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        moved = true
        History.push(
          function() { added.forEach((s, i) => { s.points = before[i] }); page._dirty = true; syncNativePage(); triggerAutosave() },
          function() { added.forEach((s, i) => { s.points = after[i] }); page._dirty = true; syncNativePage(); triggerAutosave() }
        )
      }
    }

    // Auto-newline — the Write-style wrap: the trailing half-written word moves down a lane
    // when the pen crosses the right edge (ruled/grid pages only; drawings opt their lane out)
    if (this.modes.autowrap && geo.ruled) {
      const trigger = InkFlow.bbox(added[added.length - 1].points)
      if (InkFlow.shouldAutowrap(trigger, geo)) {
        const items = page.strokes.map(s => InkFlow.item(InkFlow.bbox(s.points), s))
        const res = InkFlow.autowrap(items, geo, trigger)
        if (res.changed) {
          const deltas = items.filter(it => it.dx || it.dy).map(it => ({ s: it.ref, dx: it.dx, dy: it.dy }))
          for (const d of deltas) for (const p of d.s.points) { p.x += d.dx; p.y += d.dy }
          moved = true
          History.push(
            function() { for (const d of deltas) for (const p of d.s.points) { p.x -= d.dx; p.y -= d.dy }; page._dirty = true; syncNativePage(); triggerAutosave() },
            function() { for (const d of deltas) for (const p of d.s.points) { p.x += d.dx; p.y += d.dy }; page._dirty = true; syncNativePage(); triggerAutosave() }
          )
        }
      }
    }

    // Realtime Handwriting-to-Text — recognize the batch and swap ink for typed text
    if (this.modes.liveText && !moved) {
      this.convertStrokes(page, added)
      return   // convertStrokes re-renders when the recognizer answers
    }

    if (moved) {
      page._dirty = true
      syncNativePage()
      triggerAutosave()
      History.updateButtons()
    }
  },

  // ---- Clean Up Handwriting (whole page) ----
  cleanup() {
    const page = currentPage()
    if (!page || !page.strokes || !page.strokes.length || !window.InkTools) return false
    const geo = this.geo(page)
    if (!geo.ruled) { Bridge.showToast('Clean up needs a ruled or grid page'); return false }
    const undo = InkTools.cleanup(page.strokes, geo)
    if (!undo) return false
    const redoSnapshot = page.strokes.map(s => s.points.map(p => ({ ...p })))
    page._dirty = true
    History.push(
      function() { undo(); page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons() },
      function() {
        page.strokes.forEach((s, i) => { s.points.forEach((p, j) => { p.x = redoSnapshot[i][j].x; p.y = redoSnapshot[i][j].y }) })
        page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons()
      }
    )
    syncNativePage()
    triggerAutosave()
    History.updateButtons()
    return true
  },

  // ---- Handwriting-to-Text (manual: whole page) ----
  convertPage() {
    const page = currentPage()
    if (!page || !page.strokes || !page.strokes.length) return
    if (!InkTools.hwrReady()) { Bridge.showToast('Handwriting recognition isn\'t ready on this device'); return }
    this.convertStrokes(page, page.strokes.slice())
  },

  // Convert [strokes] (word-grouped) into page.texts items, dropping the ink. Async per word;
  // each answer splices the model and re-renders once at the end of the flight.
  convertStrokes(page, strokes) {
    const geo = this.geo(page)
    const { words } = InkTools.groupWords(strokes, geo)
    if (!words.length) return
    let inFlight = words.length
    const conversions = []
    for (const w of words) {
      InkTools.recognize(w.strokes, geo, (res) => {
        inFlight--
        if (res.text) conversions.push({ word: w, text: res.text })
        if (inFlight === 0 && conversions.length) this._applyConversions(page, geo, conversions)
      })
    }
  },

  _applyConversions(page, geo, conversions) {
    if (!Array.isArray(page.texts)) page.texts = []
    const addedTexts = [], removedStrokes = []
    for (const c of conversions) {
      const t = {
        x: Math.round(c.word.bb.x0),
        y: Math.round(geo.top + c.word.line * geo.lane + geo.lane * 0.22),
        size: Math.round(geo.lane * 0.62),
        text: c.text
      }
      page.texts.push(t)
      addedTexts.push(t)
      for (const s of c.word.strokes) {
        const i = page.strokes.indexOf(s)
        if (i !== -1) { removedStrokes.push({ s: page.strokes[i], i }) ; page.strokes.splice(i, 1) }
      }
    }
    removedStrokes.sort((a, b) => a.i - b.i)
    page._dirty = true
    History.push(
      function() {
        for (const t of addedTexts) { const i = page.texts.indexOf(t); if (i !== -1) page.texts.splice(i, 1) }
        for (const r of removedStrokes) page.strokes.splice(Math.min(r.i, page.strokes.length), 0, r.s)
        page._dirty = true; syncNativePage(); renderPageContent(); triggerAutosave(); History.updateButtons()
      },
      function() {
        for (const r of removedStrokes.slice().reverse()) { const i = page.strokes.indexOf(r.s); if (i !== -1) page.strokes.splice(i, 1) }
        for (const t of addedTexts) page.texts.push(t)
        page._dirty = true; syncNativePage(); renderPageContent(); triggerAutosave(); History.updateButtons()
      }
    )
    syncNativePage()        // ink removed
    renderPageContent()     // text baked (under any future ink)
    triggerAutosave()
    History.updateButtons()
  },

  // ---- Easy Writing Pad ----
  _padOpen: false,
  padActive() { return this._padOpen && InkTools.WritingPad.isOpen() },

  openZoom() { this.openPad('zoom') },

  openPad(variant) {
    const page = currentPage()
    if (!page || this._padOpen) return
    ensurePageLoaded(currentPageIndex)
    const geo = this.geo(page)
    const self = this
    const zoomMode = variant === 'zoom'
    const paperRect = paper.getBoundingClientRect()
    // anchor after the last written word, or the first lane
    let anchor = { line: 0, x: geo.left + geo.lane * 0.3 }
    if (page.strokes && page.strokes.length) {
      const { words } = InkTools.groupWords(page.strokes, geo)
      if (words.length) {
        const last = words[words.length - 1]
        anchor = { line: last.line, x: last.bb.x1 + geo.lane * 0.35 }
      }
    }
    // The classic editor is a free page rather than Planning's reflow model, so its zoom target is
    // a paper coordinate instead of an after-word slot. It still shares the same magnification
    // preference and write-large/direct-map behavior. This deliberately stays in the neutral
    // runtime: Notes only routes its Zoom button here and no app or device owns a second engine.
    const focus = {
      x: anchor.x,
      y: geo.top + (anchor.line + 1) * geo.lane - geo.lane * 0.12
    }
    this._padOpen = true
    const pad = InkTools.WritingPad.open({
      lane: geo.lane, geo: geo, anchor: anchor,
      variant: zoomMode ? 'zoom' : 'place',
      focus: focus,
      bounds: { width: paperRect.width, height: paperRect.height },
      surface: paper,
      inkStyle() { return { color: activeColor, width: strokeWidth } },
      drawContext: zoomMode ? function(ctx, view) {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, view.width, view.height)
        ctx.save()
        ctx.translate(view.anchorX, view.baselineY)
        ctx.scale(view.magnification, view.magnification)
        ctx.translate(-view.focus.x, -view.focus.y)

        // Draw the same page model that the daemon owns, magnified under the writable canvas.
        // No SurfaceView detach or display-specific refresh is introduced here. Bigme keeps its
        // accepted retained full-screen surface; setWritingBounds below merely confines new ink
        // to the lower viewport, and snapshotToolbarRegion refreshes that bounded strip.
        drawStandardHandoffTemplate(
          ctx,
          page.template || { type: 'blank', spacing: 32, margin: 72 },
          paperRect.width,
          paperRect.height
        )
        const strokes = Array.isArray(page.strokes) ? page.strokes : []
        for (const stroke of strokes) drawStandardHandoffStroke(ctx, stroke, 1)
        const texts = Array.isArray(page.texts) ? page.texts : []
        ctx.fillStyle = '#000'
        for (const text of texts) {
          ctx.font = (text.size || 18) + 'px sans-serif'
          ctx.textBaseline = 'top'
          ctx.fillText(text.text || '', text.x || 0, text.y || 0)
        }
        ctx.strokeStyle = '#000'
        ctx.lineWidth = 1 / view.magnification
        ctx.strokeRect(0, 0, paperRect.width, paperRect.height)
        ctx.restore()
      } : null,
      onLiveSegment(stroke) {
        if (!zoomMode || !needsStandardEditorHandoff() || !stroke) return
        // Standard is a normal WebView: draw the already-transformed segment directly into the
        // retained upper page canvas. This is deliberately not syncNativePage() or a bridge
        // snapshot—either would repaint far more than the two new points and make pen following
        // visibly slower. Commit later redraws these same vectors at the same width.
        if (!standardHandoffInkCanvas) showStandardEditorHandoff()
        if (!standardHandoffInkCanvas) return
        drawStandardHandoffStroke(
          standardHandoffInkCanvas.getContext('2d'),
          { tool: 'pen', color: stroke.color, width: stroke.width, points: stroke.points },
          window.devicePixelRatio || 1
        )
      },
      onLivePreviewReset(strokes) {
        if (!zoomMode || !needsStandardEditorHandoff()) return
        // Erasing or changing magnification invalidates the incremental mirror. Rebuild the upper
        // WebView canvas from committed vectors, then overlay only the remaining staged strokes.
        // This path is command/erase driven; ordinary pointer movement stays segment-only above.
        showStandardEditorHandoff()
        if (!standardHandoffInkCanvas) return
        const ctx = standardHandoffInkCanvas.getContext('2d')
        const dpr = window.devicePixelRatio || 1
        for (const stroke of strokes || []) {
          drawStandardHandoffStroke(
            ctx,
            { tool: 'pen', color: stroke.color, width: stroke.width, points: stroke.points },
            dpr
          )
        }
      },
      onVisualChange() { self._rebakePad() },
      onUndo() {
        History.undo()
        syncNativePage()
        triggerAutosave()
        History.updateButtons()
        // Zoom redraws the lower canvas after this model commit and then requests one visual bake.
        // Baking here as well captured the pre-commit pad and caused a second, heavier-looking
        // presentation on Bigme. The ordinary non-Zoom pad retains its existing immediate bake.
        if (!zoomMode) self._rebakePad()
      },
      onEraseModeChange(active) {
        // Standard Handwriting is already WebView-only. Bigme keeps its established full-screen
        // controller attached during classic Zoom, so this only tells that existing controller not
        // to paint an eraser gesture as ink; it does not detach, reattach or change panel policy.
        if (!needsStandardEditorHandoff()) Bridge.setErasing(active)
      },
      onScribble(points, pending, restore) {
        return self.eraseScribble(page, points, { strokes: pending, restore })
      },
      onEraseAt(point) {
        eraseAt(point.x, point.y)
      },
      onEraseEnd() {
        if (eraseRefreshTimer) { clearTimeout(eraseRefreshTimer); eraseRefreshTimer = null }
        if (eraseBox) {
          const rr = {
            x: eraseBox.minX,
            y: eraseBox.minY,
            w: eraseBox.maxX - eraseBox.minX,
            h: eraseBox.maxY - eraseBox.minY
          }
          eraseBox = null
          syncNativePage(rr)
        }
        triggerAutosave()
        if (!zoomMode) self._rebakePad()
      },
      onCommit(placed, cursor) {
        const added = []
        for (const ps of placed) {
          const stroke = {
            id: 's-' + uid(),
            tool: 'pen',
            color: ps.color || activeColor,
            width: ps.width || strokeWidth,
            points: ps.points
          }
          page.strokes.push(stroke)
          added.push(stroke)
        }
        page._dirty = true
        History.push(
          function() { for (const s of added) { const i = page.strokes.indexOf(s); if (i !== -1) page.strokes.splice(i, 1) } page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons() },
          function() { for (const s of added) page.strokes.push(s); page._dirty = true; syncNativePage(); triggerAutosave(); History.updateButtons() }
        )
        syncNativePage()
        triggerAutosave()
        History.updateButtons()
        // WritingPad replaces staged Zoom ink with the committed page and then requests one bake.
        // Avoid capturing the stale live pad here first; that was the heavier intermediate flash.
        if (!zoomMode) self._rebakePad()
      },
      onText(text, cursor) {
        if (!Array.isArray(page.texts)) page.texts = []
        const t = { x: Math.round(cursor.x), y: Math.round(geo.top + cursor.line * geo.lane + geo.lane * 0.22), size: Math.round(geo.lane * 0.62), text: text }
        page.texts.push(t)
        cursor.x += measureTextItem(t) + geo.lane * 0.35
        page._dirty = true
        History.push(
          function() { const i = page.texts.indexOf(t); if (i !== -1) page.texts.splice(i, 1); page._dirty = true; renderPageContent(); triggerAutosave(); History.updateButtons() },
          function() { page.texts.push(t); page._dirty = true; renderPageContent(); triggerAutosave(); History.updateButtons() }
        )
        renderPageContent()
        triggerAutosave()
        History.updateButtons()
        if (!zoomMode) self._rebakePad()
      },
      onClose() {
        self._padOpen = false
        setPaperWritingBounds()
        syncNativePage()   // clear the pad's raw daemon ink + its baked chrome off the surface
      }
    })
    // Device: keep the full-screen daemon but confine writing to the pad box, and bake the pad UI
    // onto the surface (the WebView is occluded there). This is intentionally the same capability-
    // neutral sequence for Standard and Bigme: neither path detaches just to enter Zoom.
    // onStrokesBatch routes via padRoute.
    if (inkSdkActive) requestAnimationFrame(function() { self._rebakePad(true) })
  },

  closePad() { if (this._padOpen) InkTools.WritingPad.close() },

  _rebakePad(setBounds) {
    if (!this.padActive()) return
    const el = document.querySelector('.ink-pad')
    const cv = InkTools.WritingPad.rect()
    if (!el || !cv) return
    const dpr = window.devicePixelRatio || 1
    if (setBounds && inkSdkActive) {
      Bridge.setWritingBounds(Math.round(cv.left * dpr), Math.round(cv.top * dpr),
                              Math.round(cv.right * dpr), Math.round(cv.bottom * dpr))
      // Reassert the selected editor style when the lower native lane becomes writable. Some
      // controllers retain it across bounds changes, but Zoom must not depend on that detail.
      Bridge.setInkStyle(strokeWidth * dpr, activeColor)
    }
    if (inkSdkActive) {
      const r = el.getBoundingClientRect()
      Bridge.snapshotToolbarRegion(Math.floor(r.left * dpr), Math.floor(r.top * dpr),
                                   Math.ceil(r.right * dpr), Math.ceil(r.bottom * dpr))
    }
  },

  // Route a daemon batch to the open pad (surface px → pad-local CSS px). True = handled.
  padRoute(strokes, dpr) {
    if (!this.padActive()) return false
    const cv = InkTools.WritingPad.rect()
    if (!cv) return false
    const batch = []
    for (const pts of strokes) {
      if (!pts || !pts.length) continue
      batch.push(pts.map(p => [p[0] / dpr + inkSurfaceOriginX - cv.left, p[1] / dpr + inkSurfaceOriginY - cv.top, p[2]]))
    }
    if (batch.length) InkTools.WritingPad.addNativeStrokes(batch)
    return true
  },

  // ---- Laser Pointer ----
  toggleLaser() {
    InkTools.LaserPointer.toggle(document.body)
    return InkTools.LaserPointer.active()
  }
}
window.EditorTools = EditorTools
