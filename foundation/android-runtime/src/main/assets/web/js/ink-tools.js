// InkTools — shared handwriting utilities (the Samsung Notes feature set, e-ink friendly):
//
//   cleanup        "Clean Up Handwriting"  — straighten, align and size words onto the rule lines
//   perfectShape   "Easy Shape Correction" — replace a sketched line/circle/rect/polygon with a
//                                            mathematically clean one
//   recognize      "Handwriting-to-Text"   — HWR via the core Bridge.hwr* seam (optional host provider),
//                                            usable one-shot or as a realtime convert loop
//   bindToLine     "Handwriting Help"      — snap the word just written to the reference line and
//                                            size established by the first word on that line
//   WritingPad     "Easy Writing Pad"      — magnified writing block docked at the bottom; either
//                                            scales writing onto a rule line or shows a true
//                                            magnified page viewport and maps ink directly back
//   LaserPointer   "Laser Pointer"         — hover trail that fades and never marks the page
//
// Pure geometry + DOM components only; the pen pipeline stays with the caller. Strokes are the
// notebook model shape ({points:[{x,y,p?}],…}) unless a function documents otherwise. All chrome
// drawn here follows the e-ink rules: black outlines on white, no gray fills, no scrollbars.
(function () {
  'use strict'

  const PTS = s => s.points || s   // accept a model stroke or a bare point array

  function bbox(strokes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const s of strokes) for (const p of PTS(s)) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
  }

  function onSegment(p, a, b) {
  const cross = (p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
  return Math.abs(cross) < 1e-7 && p.x >= Math.min(a.x,b.x)-1e-7 && p.x <= Math.max(a.x,b.x)+1e-7 && p.y >= Math.min(a.y,b.y)-1e-7 && p.y <= Math.max(a.y,b.y)+1e-7;
}
function intersects(a, b, c, d) {
  const side = (p, q, r) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return onSegment(a,c,d) || onSegment(b,c,d) || onSegment(c,a,b) || onSegment(d,a,b) || (side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0);
}
function validLasso(polygon) {
  return polygon.length >= 3 && Math.max(...polygon.map(p=>p.x))-Math.min(...polygon.map(p=>p.x)) >= 4 && Math.max(...polygon.map(p=>p.y))-Math.min(...polygon.map(p=>p.y)) >= 4;
}
function pointInLasso(p, polygon) {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j], b=polygon[i];
    if (onSegment(p,a,b)) return true;
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
function strokeHitsLasso(points, polygon) {
  if (!validLasso(polygon)) return false;
  if (points.some(p=>pointInLasso(p,polygon))) return true;
  for (let k=1;k<points.length;k++) for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) if(intersects(points[k-1],points[k],polygon[j],polygon[i])) return true;
  return false;
}

  const InkTools = {
    strokeHitsLasso, validLasso, pointInLasso,
    bbox,

    // ---- word/line grouping ----------------------------------------------------------------
    // Group strokes into lines (by centre lane) then words (gap ≥ minWordSep·lane). Returns
    // [{line, strokes, bb}] in reading order. Tall strokes (> 1.6·lane) are left out — they are
    // drawings, not words — and reported under .drawings.
    groupWords(strokes, geo) {
      const lane = geo.lane, top = geo.top || 0
      const byLine = new Map()
      const drawings = []
      for (const s of strokes) {
        const bb = bbox([s])
        if (bb.h > lane * 1.6) { drawings.push(s); continue }
        const line = Math.floor((bb.cy - top) / lane)
        if (!byLine.has(line)) byLine.set(line, [])
        byLine.get(line).push({ s, bb })
      }
      const words = []
      const minGap = (geo.minWordSep || 0.3) * lane
      for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
        const entries = byLine.get(line).sort((a, b) => a.bb.x0 - b.bb.x0)
        let curr = null
        for (const e of entries) {
          if (curr && e.bb.x0 - curr.right > minGap) curr = null
          if (!curr) { curr = { line, strokes: [], right: -Infinity }; words.push(curr) }
          curr.strokes.push(e.s)
          curr.right = Math.max(curr.right, e.bb.x1)
        }
      }
      for (const w of words) { w.bb = bbox(w.strokes); delete w.right }
      return { words, drawings }
    },

    // ---- Clean Up Handwriting ----------------------------------------------------------------
    // Straighten (deskew), normalise size, and seat every word on its rule line. Mutates stroke
    // points in place and returns an undo function that restores the original points.
    cleanup(strokes, geo) {
      const lane = geo.lane, top = geo.top || 0
      const { words } = this.groupWords(strokes, geo)
      if (!words.length) return null
      const saved = new Map()
      for (const w of words) for (const s of w.strokes) saved.set(s, PTS(s).map(p => ({ ...p })))

      for (const w of words) {
        // deskew: the word's drift = regression slope over all points, capped at ±12°
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
        for (const s of w.strokes) for (const p of PTS(s)) { n++; sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y }
        const denom = n * sxx - sx * sx
        let angle = denom > 1e-6 ? Math.atan((n * sxy - sx * sy) / denom) : 0
        angle = Math.max(-0.21, Math.min(0.21, angle))
        const cos = Math.cos(-angle), sin = Math.sin(-angle)
        const cx = w.bb.cx, cy = w.bb.cy
        for (const s of w.strokes) for (const p of PTS(s)) {
          const dx = p.x - cx, dy = p.y - cy
          p.x = cx + dx * cos - dy * sin
          p.y = cy + dx * sin + dy * cos
        }
        // size: bring clearly over/undersized words toward a 0.62·lane body height
        const bb1 = bbox(w.strokes)
        const target = lane * 0.62
        let scale = 1
        if (bb1.h > lane * 0.95) scale = Math.max(0.55, target / bb1.h)
        else if (bb1.h < lane * 0.28) scale = Math.min(1.7, target / bb1.h)
        if (scale !== 1) for (const s of w.strokes) for (const p of PTS(s)) {
          p.x = bb1.x0 + (p.x - bb1.x0) * scale
          p.y = bb1.cy + (p.y - bb1.cy) * scale
        }
        // seat on the rule line: word bottom (minus a small descender allowance) → baseline
        const bb2 = bbox(w.strokes)
        const baseline = top + (w.line + 1) * lane - lane * 0.12
        const dy = baseline - (bb2.y1 - bb2.h * 0.12)
        if (dy) for (const s of w.strokes) for (const p of PTS(s)) p.y += dy
      }
      return function undo() {
        for (const [s, pts] of saved) {
          const dst = PTS(s)
          for (let i = 0; i < dst.length; i++) { dst[i].x = pts[i].x; dst[i].y = pts[i].y }
        }
      }
    },

    // ---- Handwriting Help (reference-line binding) --------------------------------------------
    // Bind freshly written strokes to the line/size the earlier words on their lane established.
    // Cheap incremental cleanup — call with just the new batch after each pen pause.
    bindToLine(newStrokes, allStrokes, geo) {
      if (!newStrokes.length) return
      const lane = geo.lane, top = geo.top || 0
      const nb = bbox(newStrokes)
      if (nb.h > lane * 1.6) return                       // drawing — leave it
      const line = Math.floor((nb.cy - top) / lane)
      // reference height = median height of existing words on this line (if any)
      const prior = allStrokes.filter(s => !newStrokes.includes(s))
      const { words } = this.groupWords(prior, geo)
      const heights = words.filter(w => w.line === line).map(w => w.bb.h).sort((a, b) => a - b)
      const refH = heights.length ? heights[Math.floor(heights.length / 2)] : null
      let scale = 1
      if (refH && nb.h > 4) scale = Math.max(0.6, Math.min(1.6, refH / nb.h))
      if (Math.abs(scale - 1) < 0.12) scale = 1
      if (scale !== 1) for (const s of newStrokes) for (const p of PTS(s)) {
        p.x = nb.x0 + (p.x - nb.x0) * scale
        p.y = nb.cy + (p.y - nb.cy) * scale
      }
      const bb = bbox(newStrokes)
      const baseline = top + (line + 1) * lane - lane * 0.12
      const dy = baseline - (bb.y1 - bb.h * 0.12)
      if (dy) for (const s of newStrokes) for (const p of PTS(s)) p.y += dy
    },

    // ---- Easy Shape Correction -----------------------------------------------------------------
    // Recognise a sketched stroke and return clean replacement points, or null to keep it.
    perfectShape(stroke, lane) {
      const pts = PTS(stroke).map(p => [p.x, p.y])
      if (pts.length < 6) return null
      const bb = bbox([stroke])
      if (Math.max(bb.w, bb.h) < lane * 0.6) return null   // too small to be a deliberate shape

      let perim = 0
      for (let i = 1; i < pts.length; i++) perim += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      const endGap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1])
      const closed = endGap < Math.max(perim * 0.15, lane * 0.5)

      // straight line: low deviation from the chord, no backtracking
      if (!closed) {
        const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
        const len = Math.hypot(bx - ax, by - ay)
        if (len > lane * 0.5 && perim < len * 1.12) {
          let maxDev = 0
          for (const [x, y] of pts) {
            const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)))
            maxDev = Math.max(maxDev, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))))
          }
          if (maxDev < Math.max(5, len * 0.06)) {
            // snap near-horizontal / near-vertical
            let x2 = bx, y2 = by
            const ang = Math.atan2(by - ay, bx - ax)
            const snap = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2)
            if (Math.abs(ang - snap) < 0.13) { x2 = ax + len * Math.cos(snap); y2 = ay + len * Math.sin(snap) }
            return [{ x: ax, y: ay }, { x: Math.round(x2), y: Math.round(y2) }]
          }
        }
        return null
      }

      // circle / ellipse: radial distance from the centroid is steady
      let cx = 0, cy = 0
      for (const [x, y] of pts) { cx += x; cy += y }
      cx /= pts.length; cy /= pts.length
      let mean = 0
      const radii = pts.map(([x, y]) => Math.hypot(x - cx, y - cy))
      for (const r of radii) mean += r
      mean /= radii.length
      let variance = 0
      for (const r of radii) variance += (r - mean) * (r - mean)
      const rsd = Math.sqrt(variance / radii.length) / mean
      if (rsd < 0.16) {
        const rx = bb.w / 2, ry = bb.h / 2
        const out = []
        const steps = Math.max(24, Math.round(perim / 6))
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2
          out.push({ x: bb.cx + rx * Math.cos(a), y: bb.cy + ry * Math.sin(a) })
        }
        return out
      }

      // polygon: RDP-reduce to corners; 3..8 corners → snapped polygon (rects get axis-snapped)
      const corners = rdp(pts, Math.max(6, perim * 0.02))
      if (corners.length >= 4 && corners.length <= 9) {
        const poly = corners.slice(0, -1)              // drop duplicate closing point
        if (poly.length >= 3 && poly.length <= 8) {
          if (poly.length === 4 && isAxisRect(poly)) {
            return [
              { x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y0 },
              { x: bb.x1, y: bb.y1 }, { x: bb.x0, y: bb.y1 }, { x: bb.x0, y: bb.y0 }
            ]
          }
          const out = poly.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }))
          out.push({ ...out[0] })
          return out
        }
      }
      return null
    },

    // ---- Handwriting-to-Text --------------------------------------------------------------------
    // One word/line group → recognized text via the core HWR seam. cb({text, candidates} | {error}).
    // Routes hwr events by request id so concurrent recognitions don't cross.
    recognize(strokes, geo, cb) {
      // bridge.js declares a top-level lexical `const Bridge`; it intentionally does not create
      // window.Bridge. Guard the lexical binding itself or every recognition request is silently
      // rejected even when the certificate, SDK and language assets are all present.
      if (typeof Bridge === 'undefined' || !Bridge.hwrRecognize) { cb({ error: 'recognizer unavailable' }); return }
      installHwrRouter()
      const bb = bbox(strokes)
      const arr = strokes.map(s => PTS(s).map(p => [p.x, p.y, p.p !== undefined ? p.p : 0.5]))
      const r = Bridge.hwrRecognize({
        lang: (geo && geo.lang) || 'en-US',
        strokes: arr,
        area: { w: Math.ceil(bb.x1 + 20), h: Math.ceil(bb.y1 + 20) },
        preContext: (geo && geo.preContext) || ''
      })
      if (!r || r.err || !r.reqId) { cb({ error: (r && r.err) || 'recognizer unavailable' }); return }
      hwrCallbacks[r.reqId] = cb
    },

    hwrReady(lang) {
      try { return typeof Bridge !== 'undefined' && Bridge.hwrStatus && Bridge.hwrStatus(lang || 'en-US') === 'ready' }
      catch (e) { return false }
    },

    // ---- Laser Pointer -----------------------------------------------------------------------
    LaserPointer: {
      _cv: null, _pts: null, _raf: 0, _handlers: null,
      active() { return !!this._cv },
      toggle(host) { this._cv ? this.disable() : this.enable(host) },
      enable(host) {
        if (this._cv) return
        const cv = document.createElement('canvas')
        cv.className = 'ink-laser-canvas'
        cv.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none'
        ;(host || document.body).appendChild(cv)
        cv.width = window.innerWidth; cv.height = window.innerHeight
        this._cv = cv
        this._pts = []
        const add = (e) => { this._pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }) }
        this._handlers = add
        window.addEventListener('pointermove', add, true)
        const draw = () => {
          if (!this._cv) return
          const ctx = this._cv.getContext('2d')
          ctx.clearRect(0, 0, this._cv.width, this._cv.height)
          const now = performance.now()
          this._pts = this._pts.filter(p => now - p.t < 650)
          ctx.lineCap = 'round'; ctx.lineJoin = 'round'
          for (let i = 1; i < this._pts.length; i++) {
            const a = this._pts[i - 1], b = this._pts[i]
            const age = (now - b.t) / 650
            ctx.strokeStyle = '#000'
            ctx.lineWidth = 7 * (1 - age) + 1
            ctx.globalAlpha = 1 - age
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          }
          ctx.globalAlpha = 1
          const last = this._pts[this._pts.length - 1]
          if (last && now - last.t < 650) {
            ctx.beginPath(); ctx.arc(last.x, last.y, 6, 0, Math.PI * 2)
            ctx.fillStyle = '#000'; ctx.fill()
          }
          this._raf = requestAnimationFrame(draw)
        }
        this._raf = requestAnimationFrame(draw)
      },
      disable() {
        if (!this._cv) return
        cancelAnimationFrame(this._raf)
        window.removeEventListener('pointermove', this._handlers, true)
        this._cv.remove()
        this._cv = null; this._pts = null; this._handlers = null
      }
    },

    // ---- Easy Writing Pad ----------------------------------------------------------------------
    // A magnified writing block docked at the bottom. You write large; each pen pause (or ✓)
    // commits the pad ink scaled down onto the target rule line, advancing a cursor that wraps
    // via InkFlow geometry. The host supplies the pen input: browser preview writes with pointer
    // events on the pad canvas; on-device hosts attach the ink daemon to pad.rect() and feed
    // batches to pad.addNativeStrokes(). Commits call back with model strokes in page coords.
    WritingPad: {
      _el: null, _cv: null, _strokes: null, _live: null, _cursor: null, _opts: null, _idleTimer: null,
      _targetEl: null, _settingsEl: null, _surfaceHandlers: null, _placedCount: 0, _eraseMode: false,

      isOpen() { return !!this._el },

      // opts: { lane, geo:{lane,top,left,right}, anchor:{line,x}, onCommit(strokes, cursor),
      //         onText(text, cursor)?, onClose()?, hwr:bool, host?:Element,
      //         actions?:[{label, onTap}], variant?:'place'|'zoom',
      //         focus?:{x,y}, bounds?:{width,height}, drawContext(ctx, view)?,
      //         onLiveSegment(stroke)?, onLivePreviewReset(strokes)?
      //         — extra header buttons remain host-specific (e.g. New line). Zoom is neutral:
      //         it uses the same component and persistent magnification as Planning. }
      open(opts) {
        if (this._el) this.close()
        this._opts = opts
        this._variant = opts.variant === 'zoom' ? 'zoom' : 'place'
        this._cursor = { line: opts.anchor.line, x: opts.anchor.x }
        this._focus = opts.focus ? { x: opts.focus.x, y: opts.focus.y } : null
        this._settings = this._variant === 'zoom' ? this._loadSettings() : null
        this._magnification = this._settings ? this._settings.magnification : 1
        this._placedCount = 0
        this._eraseMode = false
        const el = document.createElement('div')
        if (this._variant === 'zoom') {
          // Keep classic free-page Handwriting on the neutral WritingPad model, but expose the
          // same visual language and command order as Planning's MagnifyPad. This is intentionally
          // ordinary WebView DOM. Bigme still uses its existing full-screen daemon and only changes
          // the writable bounds to this lower canvas; no detach, SurfaceView swap or panel mode is
          // introduced by the shared UI.
          el.className = 'ink-pad ink-pad-zoom magnify-pad hand-' + this._settings.handedness
          el.innerHTML =
            '<div class="ink-pad-box magnify-viewport ink-mode">' +
              '<canvas class="magnify-canvas"></canvas>' +
              '<div class="ink-pad-context magnify-context" aria-hidden="true">' +
                '<span class="magnify-context-badge">INK MODE · MAGNIFIED PAGE</span>' +
                '<span class="magnify-context-hint"><i class="ink-pad-style-swatch"></i><b class="ink-pad-zoom-label"></b></span>' +
              '</div>' +
            '</div>' +
            '<div class="ink-pad-head magnify-controls" role="toolbar" aria-label="Magnified writing controls">' +
              '<button data-command="previous" title="Previous target">◀</button>' +
              '<button data-command="next" title="Next target">▶</button>' +
              '<button data-command="newline" title="New line">⏎</button>' +
              '<button data-command="undo" title="Undo last placement">↺</button>' +
              '<button class="magnify-eraser" data-command="erase" title="Erase old or new ink in the magnified page" aria-pressed="false">⌫</button>' +
              '<button data-command="settings" title="Magnify settings">⚙</button>' +
              '<button class="ink-pad-close magnify-close" title="Close magnified writing">Close</button>' +
            '</div>'
        } else {
          el.className = 'ink-pad'
          el.innerHTML =
            '<div class="ink-pad-head">' +
              '<strong>Writing pad</strong>' +
              '<span class="ink-pad-mode"><button data-m="ink" class="on">Ink</button><button data-m="text">Text</button></span>' +
              '<span class="ink-pad-actions"></span>' +
              '<span class="ink-pad-btns">' +
                '<button class="ink-pad-clear">Clear</button>' +
                '<button class="ink-pad-place">Place ✓</button>' +
                '<button class="ink-pad-close">✕</button>' +
              '</span>' +
            '</div>' +
            '<div class="ink-pad-box"><canvas></canvas></div>'
        }
        ;(opts.host || document.body).appendChild(el)
        this._el = el
        // host-supplied extra buttons (additive; free-note callers pass none)
        if (opts.actions && opts.actions.length) {
          const host = el.querySelector('.ink-pad-actions')
          opts.actions.forEach(a => {
            const b = document.createElement('button')
            b.textContent = a.label
            b.onclick = () => { if (a.onTap) a.onTap(this) }
            host.appendChild(b)
          })
        }
        const cv = el.querySelector('canvas')
        const box = el.querySelector('.ink-pad-box')
        cv.width = box.clientWidth * (window.devicePixelRatio || 1)
        cv.height = box.clientHeight * (window.devicePixelRatio || 1)
        cv.style.width = box.clientWidth + 'px'
        cv.style.height = box.clientHeight + 'px'
        this._cv = cv
        this._strokes = []
        this._mode = 'ink'
        this.drawGuides()

        el.querySelector('.ink-pad-close').onclick = () => this.close()
        if (this._variant === 'zoom') {
          el.querySelector('[data-command="previous"]').onclick = () => this._nudgeZoom(-1)
          el.querySelector('[data-command="next"]').onclick = () => this._nudgeZoom(1)
          el.querySelector('[data-command="newline"]').onclick = () => this._newZoomLine()
          el.querySelector('[data-command="undo"]').onclick = () => this._undoZoomPlacement()
          el.querySelector('[data-command="erase"]').onclick = e => {
            this._eraseMode = !this._eraseMode
            e.currentTarget.classList.toggle('active', this._eraseMode)
            e.currentTarget.setAttribute('aria-pressed', String(this._eraseMode))
            const badge = el.querySelector('.magnify-context-badge')
            if (badge) badge.textContent = this._eraseMode
              ? 'ERASE MODE · OLD AND NEW INK'
              : 'INK MODE · MAGNIFIED PAGE'
            if (opts.onEraseModeChange) opts.onEraseModeChange(this._eraseMode)
            if (opts.onVisualChange) opts.onVisualChange()
          }
          el.querySelector('[data-command="settings"]').onclick = () => this._toggleZoomSettings()
          this._installZoomTarget()
          this._updateZoomChrome()
        } else {
          el.querySelector('.ink-pad-clear').onclick = () => { this._strokes = []; this.drawGuides() }
          el.querySelector('.ink-pad-place').onclick = () => this.commit()
          el.querySelectorAll('.ink-pad-mode button').forEach(b => {
            b.onclick = () => {
              if (b.dataset.m === 'text' && !InkTools.hwrReady()) { b.blur(); return }
              this._mode = b.dataset.m
              el.querySelectorAll('.ink-pad-mode button').forEach(x => x.classList.toggle('on', x === b))
            }
          })
        }

        // pointer input (preview / stylus-through-webview); device hosts use addNativeStrokes
        let live = null
        const dpr = window.devicePixelRatio || 1
        const xy = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left), y: (e.clientY - r.top) } }
        cv.style.touchAction = 'none'
        cv.addEventListener('pointerdown', e => {
          // The device writing lane is pen-only. Do not capture or cancel a finger gesture, so a
          // touch can never become staged Zoom ink. Mouse stays usable in the desktop Web preview.
          if (e.pointerType === 'touch') return
          e.preventDefault()
          cv.setPointerCapture(e.pointerId)
          if (this._variant === 'zoom' && this._eraseMode) {
            live = { erase: true, points: [xy(e)] }
            this._eraseAtPadPoint(live.points[0], true)
          } else {
            live = [xy(e)]
            this._bumpIdle()
          }
        })
        cv.addEventListener('pointermove', e => {
          if (!live) return
          const samples = typeof e.getCoalescedEvents === 'function'
            ? e.getCoalescedEvents()
            : [e]
          for (const sample of samples.length ? samples : [e]) {
            const point = xy(sample)
            if (live.erase) {
              live.points.push(point)
              this._eraseAtPadPoint(point, false)
            } else {
              const previous = live[live.length - 1]
              if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.2) continue
              live.push(point)
              this.drawLive(live)
              this._bumpIdle()
            }
          }
        })
        const up = e => {
          if (!live) return
          if (live.erase) {
            this._eraseAtPadPoint(xy(e), false)
            if (this._opts.onEraseEnd) this._opts.onEraseEnd()
          } else {
            const point = xy(e)
            const previous = live[live.length - 1]
            if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.2) {
              live.push(point)
              this.drawLive(live)
            }
          }
          if (!live.erase && live.length > 1 && !this._tryScribble(live)) {
            const style = this._opts.inkStyle ? this._opts.inkStyle() : null
            this._strokes.push({
              points: live,
              color: (style && style.color) || '#000',
              width: (style && style.width) || 2.5
            })
          }
          live = null
          this.drawGuides()
          if (this._eraseMode) {
            if (this._opts.onVisualChange) this._opts.onVisualChange()
          } else {
            this._bumpIdle()
          }
        }
        cv.addEventListener('pointerup', up)
        cv.addEventListener('pointercancel', up)
        return this
      },

      rect() { return this._cv ? this._cv.getBoundingClientRect() : null },

      // Device hosts: daemon batch ([[x,y,p],…] in pad-canvas px) after a pen pause.
      addNativeStrokes(batch) {
        const style = this._opts.inkStyle ? this._opts.inkStyle() : null
        for (const pts of batch) {
          if (this._tryScribble(pts.map(p => ({x:p[0],y:p[1]})))) continue
          this._strokes.push({
            points: pts.map(p => ({ x: p[0], y: p[1], p: p[2] })),
            color: (style && style.color) || '#000',
            width: (style && style.width) || 2.5
          })
        }
        this.drawGuides()
        this._bumpIdle()
      },

      _tryScribble(points) {
        if (this._variant !== 'zoom' || !this._focus || !this._opts.onScribble) return false
        const before = this._strokes.slice()
        const mapped = before.map(s => this._mapZoomStroke(s))
        const gesture = this._mapZoomStroke({points,width:2}).points
        const erased = this._opts.onScribble(gesture, mapped, remaining => {
          if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null }
          this._strokes = before.filter((s,i) => remaining.includes(mapped[i]))
          this.drawGuides(); this._resetZoomLivePreview()
          if (this._opts.onVisualChange) this._opts.onVisualChange()
        })
        if (erased) { this._placedCount++; this._updateZoomChrome() }
        return erased
      },

      _bumpIdle() {
        if (this._idleTimer) clearTimeout(this._idleTimer)
        // Auto-place after a real pause so you can keep writing fluidly. In zoom mode the focus
        // advances after each batch, matching Planning's write-large/continue-right behavior and
        // its 400 ms pause. The ordinary Easy Writing Pad retains its more forgiving 1.8 s pause.
        const delay = this._variant === 'zoom' ? 400 : 1800
        this._idleTimer = setTimeout(() => { if (this._strokes && this._strokes.length) this.commit() }, delay)
      },

      drawGuides() {
        const cv = this._cv; if (!cv) return
        const ctx = cv.getContext('2d')
        const dpr = window.devicePixelRatio || 1
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, cv.width, cv.height)
        const h = cv.height / dpr, w = cv.width / dpr
        if (this._variant === 'zoom' && this._opts.drawContext && this._focus) {
          const anchorX = w * 0.21
          const baselineY = h * 0.54
          this._opts.drawContext(ctx, {
            focus: { x: this._focus.x, y: this._focus.y },
            magnification: this._magnification,
            width: w,
            height: h,
            anchorX: anchorX,
            baselineY: baselineY
          })
          // The upper HERE rectangle is the sole target indicator. A second vertical caret in this
          // viewport looked like accidental ink and made the live/committed thickness comparison
          // harder, so the magnified page itself stays clean.
        } else {
        // one large writing lane: baseline + faint x-height guide (hairlines, no fills)
          ctx.strokeStyle = '#000'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(8, h * 0.78); ctx.lineTo(w - 8, h * 0.78); ctx.stroke()
          ctx.setLineDash([2, 6])
          ctx.beginPath(); ctx.moveTo(8, h * 0.34); ctx.lineTo(w - 8, h * 0.34); ctx.stroke()
          ctx.setLineDash([])
        }
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        for (const s of this._strokes) {
          ctx.strokeStyle = s.color || '#000'
          ctx.lineWidth = s.width || 2.5
          ctx.beginPath()
          s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
          ctx.stroke()
        }
        if (this._variant === 'zoom') this._updateZoomChrome()
      },

      drawLive(pts) {
        if (!pts || pts.length < 2) return
        const ctx = this._cv.getContext('2d')
        const inkStyle = this._opts.inkStyle ? this._opts.inkStyle() : null
        ctx.strokeStyle = (inkStyle && inkStyle.color) || '#000'
        ctx.lineWidth = (inkStyle && inkStyle.width) || 2.5
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y)
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
        ctx.stroke()
        // Standard Android's Handwriting editor is an ordinary WebView. Mirror only the newest
        // transformed segment into the upper page canvas so both zoom levels follow the pen in
        // real time; never request a bridge snapshot or rebuild the full page mid-stroke. Bigme
        // continues to receive completed daemon batches and therefore never enters this callback.
        if (this._variant === 'zoom' && this._opts.onLiveSegment) {
          this._opts.onLiveSegment(this._mapZoomStroke({
            color: (inkStyle && inkStyle.color) || '#000',
            width: (inkStyle && inkStyle.width) || 2.5,
            points: [pts[pts.length - 2], pts[pts.length - 1]]
          }))
        }
      },

      _mapZoomStroke(stroke) {
        if (!this._cv || !this._focus) return stroke
        const dpr = window.devicePixelRatio || 1
        const m = this._magnification
        const anchorX = (this._cv.width / dpr) * 0.21
        const baselineY = (this._cv.height / dpr) * 0.54
        return {
          color: stroke.color,
          width: stroke.width,
          points: stroke.points.map(p => ({
            x: this._focus.x + (p.x - anchorX) / m,
            y: this._focus.y + (p.y - baselineY) / m,
            p: p.p
          }))
        }
      },

      _resetZoomLivePreview() {
        if (this._variant !== 'zoom' || !this._opts.onLivePreviewReset) return
        this._opts.onLivePreviewReset(this._strokes.map(stroke => this._mapZoomStroke(stroke)))
      },

      // Scale the pad ink onto the target rule line at the cursor; wrap via geo when it
      // wouldn't fit; hand the placed strokes (page coords) to the host.
      commit() {
        if (!this._strokes || !this._strokes.length) return
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null }
        const o = this._opts, geo = o.geo
        const strokes = this._strokes
        this._strokes = []
        // Zoom replaces the staged pad ink with the same page ink in one synchronous redraw below.
        // Clearing the canvas first produced a blank/thick flash during that handoff. The ordinary
        // Easy Writing Pad still clears immediately because it has no magnified page behind it.
        if (this._variant !== 'zoom') this.drawGuides()

        if (this._variant === 'zoom' && this._focus) {
          const cvW = this._cv.width / (window.devicePixelRatio || 1)
          const cvH = this._cv.height / (window.devicePixelRatio || 1)
          const m = this._magnification
          const anchorX = cvW * 0.21
          const baselineY = cvH * 0.54
          if (this._settings && this._settings.placement === 'text' && o.onText) {
            const cursor = {
              line: Math.max(0, Math.round((this._focus.y - (o.geo.top || 0)) / o.geo.lane - 0.88)),
              x: this._focus.x
            }
            InkTools.recognize(strokes, o.geo, res => {
              if (res.text) {
                o.onText(res.text, cursor)
                this._focus.x = cursor.x
                this._focus.y = (o.geo.top || 0) + (cursor.line + 1) * o.geo.lane - o.geo.lane * 0.12
                this._placedCount++
                this._boundFocus()
                this._renderZoomTarget()
                this.drawGuides()
                this._updateZoomChrome()
                if (o.onVisualChange) o.onVisualChange()
              }
            })
            return
          }
          // Shrink the writing coordinates while retaining the selected pen thickness on the page.
          // The shared mapper also keeps the real-time upper preview at that same page width.
          const placed = strokes.map(s => this._mapZoomStroke(s))
          const placedBox = bbox(placed)
          if (!this._settings || this._settings.advance !== 'manual') {
            this._focus.x = placedBox.x1 + this._opts.geo.lane * 0.35
          }
          this._placedCount++
          this._boundFocus()
          o.onCommit(placed, this._focus)
          this._renderZoomTarget()
          this.drawGuides()
          this._updateZoomChrome()
          if (o.onVisualChange) o.onVisualChange()
          return
        }

        if (this._mode === 'text' && o.onText) {
          InkTools.recognize(strokes, geo, res => {
            if (res.text) o.onText(res.text, this._cursor)
          })
          return
        }

        const bb = bbox(strokes)
        const cvH = this._cv.height / (window.devicePixelRatio || 1)
        const bodyH = cvH * 0.44                      // x-height guide → baseline span in the pad
        const scale = (geo.lane * 0.62) / bodyH
        const leftOf = typeof geo.left === 'function' ? geo.left : () => geo.left
        const rightOf = typeof geo.right === 'function' ? geo.right : () => geo.right
        const wordW = bb.w * scale
        if (this._cursor.x + wordW > rightOf(this._cursor.line) - 4) {
          this._cursor.line++
          this._cursor.x = leftOf(this._cursor.line) + geo.lane * 0.3
        }
        const baseline = (geo.top || 0) + (this._cursor.line + 1) * geo.lane - geo.lane * 0.12
        const padBase = cvH * 0.78
        const placed = strokes.map(s => ({
          color: s.color,
          width: s.width,
          points: s.points.map(p => ({
            x: this._cursor.x + (p.x - bb.x0) * scale,
            y: baseline + (p.y - padBase) * scale
          }))
        }))
        this._cursor.x += wordW + geo.lane * 0.35
        o.onCommit(placed, this._cursor)
      },

      _loadSettings() {
        const defaults = {
          magnification: 2.5,
          advance: 'word',
          handedness: 'right',
          placement: 'ink'
        }
        try {
          const saved = JSON.parse(localStorage.getItem('write2.magnify.settings') || '{}')
          return {
            magnification: [2, 2.5, 3].includes(Number(saved.magnification))
              ? Number(saved.magnification)
              : defaults.magnification,
            advance: saved.advance === 'manual' ? 'manual' : 'word',
            handedness: saved.handedness === 'left' ? 'left' : 'right',
            placement: saved.placement === 'text' ? 'text' : 'ink'
          }
        } catch (e) {
          return defaults
        }
      },

      _saveSettings() {
        if (!this._settings) return
        try {
          const saved = JSON.parse(localStorage.getItem('write2.magnify.settings') || '{}')
          saved.magnification = this._settings.magnification
          saved.advance = this._settings.advance
          saved.handedness = this._settings.handedness
          saved.placement = this._settings.placement
          localStorage.setItem('write2.magnify.settings', JSON.stringify(saved))
        } catch (e) {}
      },

      _boundFocus() {
        if (!this._focus) return
        const bounds = this._opts.bounds || {}
        const lane = this._opts.geo.lane
        if (this._variant !== 'zoom' || !this._cv) {
          this._focus.x = Math.max(0, Math.min(Number(bounds.width) || Infinity, this._focus.x))
          this._focus.y = Math.max(lane, Math.min(Number(bounds.height) || Infinity, this._focus.y))
          return
        }
        const dpr = window.devicePixelRatio || 1
        const w = this._cv.width / dpr
        const h = this._cv.height / dpr
        const m = this._magnification
        const focusOffsetX = w * 0.21 / m
        const belowFocus = h * 0.46 / m
        const rightOfFocus = w * 0.79 / m
        const surface = this._opts.surface
        const surfaceRect = surface ? surface.getBoundingClientRect() : null
        const padRect = this._el ? this._el.getBoundingClientRect() : null
        const visibleHeight = surfaceRect && padRect
          ? Math.max(lane, Math.min(Number(bounds.height) || Infinity, padRect.top - surfaceRect.top))
          : (Number(bounds.height) || Infinity)
        this._focus.x = Math.max(focusOffsetX, Math.min((Number(bounds.width) || Infinity) - rightOfFocus, this._focus.x))
        this._focus.y = Math.max(h * 0.54 / m, Math.min(visibleHeight - belowFocus, this._focus.y))
      },

      _nudgeZoom(direction) {
        if (this._strokes && this._strokes.length) this.commit()
        if (!this._focus) return
        this._focus.x += direction * this._opts.geo.lane * 2
        this._boundFocus()
        this._renderZoomTarget()
        this.drawGuides()
        if (this._opts.onVisualChange) this._opts.onVisualChange()
      },

      _newZoomLine() {
        if (this._strokes && this._strokes.length) this.commit()
        if (!this._focus) return
        this._focus.x = this._opts.geo.left + this._opts.geo.lane * 0.3
        this._focus.y += this._opts.geo.lane
        this._boundFocus()
        this._renderZoomTarget()
        this.drawGuides()
        if (this._opts.onVisualChange) this._opts.onVisualChange()
      },

      _undoZoomPlacement() {
        if (this._placedCount <= 0 || !this._opts.onUndo) return
        this._opts.onUndo()
        this._placedCount--
        this._updateZoomChrome()
        this.drawGuides()
        if (this._opts.onVisualChange) this._opts.onVisualChange()
      },

      _installZoomTarget() {
        const surface = this._opts.surface
        if (!surface || !this._focus) return
        const target = document.createElement('div')
        target.className = 'ink-pad-target magnify-target'
        target.innerHTML = '<span>HERE</span>'
        surface.appendChild(target)
        this._targetEl = target

        let gesture = null
        const point = e => {
          const r = surface.getBoundingClientRect()
          return { x: e.clientX - r.left, y: e.clientY - r.top }
        }
        const retarget = e => {
          const p = point(e)
          this._focus.x = p.x
          this._focus.y = p.y
          this._boundFocus()
          this._renderZoomTarget()
          this.drawGuides()
        }
        const down = e => {
          // Every pointer type may position the Zoom target. In particular, a finger must be able
          // to drag the upper HERE box even though touch is rejected by the lower writing canvas.
          // Claim this gesture before the paper's pen/eraser handler can interpret it as page ink.
          e.preventDefault()
          e.stopImmediatePropagation()
          gesture = e.pointerId
          try { surface.setPointerCapture(e.pointerId) } catch (_) {}
          if (this._strokes && this._strokes.length) this.commit()
          retarget(e)
        }
        const move = e => {
          if (gesture !== e.pointerId) return
          e.preventDefault()
          e.stopImmediatePropagation()
          retarget(e)
        }
        const up = e => {
          if (gesture !== e.pointerId) return
          e.preventDefault()
          e.stopImmediatePropagation()
          retarget(e)
          gesture = null
          if (this._opts.onVisualChange) this._opts.onVisualChange()
        }
        surface.addEventListener('pointerdown', down, true)
        surface.addEventListener('pointermove', move, true)
        surface.addEventListener('pointerup', up, true)
        surface.addEventListener('pointercancel', up, true)
        this._surfaceHandlers = { surface: surface, down: down, move: move, up: up }
        this._boundFocus()
        this._renderZoomTarget()
      },

      _renderZoomTarget() {
        if (!this._targetEl || !this._cv || !this._focus) return
        const dpr = window.devicePixelRatio || 1
        const w = this._cv.width / dpr
        const h = this._cv.height / dpr
        const m = this._magnification
        const focusX = w * 0.21
        const baselineY = h * 0.54
        this._targetEl.style.left = (this._focus.x - focusX / m) + 'px'
        this._targetEl.style.top = (this._focus.y - baselineY / m) + 'px'
        this._targetEl.style.width = (w / m) + 'px'
        this._targetEl.style.height = (h / m) + 'px'
        const label = this._targetEl.querySelector('span')
        if (label) label.style.left = (focusX / m + 4) + 'px'
      },

      _updateZoomChrome() {
        if (!this._el || this._variant !== 'zoom') return
        const style = this._opts.inkStyle ? this._opts.inkStyle() : { color: '#000', width: 2.5 }
        const label = this._el.querySelector('.ink-pad-zoom-label')
        if (label) label.textContent = this._magnification.toFixed(1) + '× · ' +
          ((style.width || 2.5).toFixed(1).replace(/\.0$/, '')) + ' px'
        const swatch = this._el.querySelector('.ink-pad-style-swatch')
        if (swatch) {
          swatch.style.background = style.color || '#000'
          swatch.style.height = Math.max(3, Math.min(12, style.width || 2.5)) + 'px'
        }
        const undo = this._el.querySelector('[data-command="undo"]')
        if (undo) undo.disabled = this._placedCount <= 0
      },

      _toggleZoomSettings() {
        if (!this._el || !this._settings) return
        if (this._settingsEl) {
          this._settingsEl.remove()
          this._settingsEl = null
          if (this._opts.onVisualChange) this._opts.onVisualChange()
          return
        }
        const panel = document.createElement('div')
        panel.className = 'ink-pad-settings magnify-settings'
        const addSelect = (name, values, current, onChange) => {
          const label = document.createElement('label')
          label.appendChild(document.createTextNode(name))
          const select = document.createElement('select')
          values.forEach(pair => {
            const option = document.createElement('option')
            option.value = pair[0]
            option.textContent = pair[1]
            option.selected = pair[0] === current
            select.appendChild(option)
          })
          select.onchange = () => {
            onChange(select.value)
            this._saveSettings()
            this._magnification = this._settings.magnification
            this._el.className = 'ink-pad ink-pad-zoom magnify-pad hand-' + this._settings.handedness
            this._boundFocus()
            this._renderZoomTarget()
            this._updateZoomChrome()
            this.drawGuides()
            this._resetZoomLivePreview()
            if (this._opts.onVisualChange) this._opts.onVisualChange()
          }
          label.appendChild(select)
          panel.appendChild(label)
        }
        addSelect('Magnify', [['2', '2×'], ['2.5', '2.5×'], ['3', '3×']],
          String(this._settings.magnification), value => { this._settings.magnification = Number(value) })
        addSelect('Advance', [['word', 'After each word'], ['manual', 'Manual only']],
          this._settings.advance, value => { this._settings.advance = value })
        addSelect('Hand', [['right', 'Right'], ['left', 'Left']],
          this._settings.handedness, value => { this._settings.handedness = value })
        addSelect('Placement', [['ink', 'Ink'], ['text', 'Convert to text']],
          this._settings.placement, value => { this._settings.placement = value })
        this._el.appendChild(panel)
        this._settingsEl = panel
        if (this._opts.onVisualChange) this._opts.onVisualChange()
      },

      _eraseAtPadPoint(point, begin) {
        if (!this._cv || !this._focus) return
        const threshold = 14
        const dist = (p, a, b) => {
          const dx = b.x - a.x, dy = b.y - a.y
          const len = dx * dx + dy * dy
          const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
          return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
        }
        this._strokes = this._strokes.filter(stroke => {
          for (let i = 1; i < stroke.points.length; i++) {
            if (dist(point, stroke.points[i - 1], stroke.points[i]) <= threshold) return false
          }
          return true
        })
        if (this._opts.onEraseAt) {
          const dpr = window.devicePixelRatio || 1
          const w = this._cv.width / dpr
          const h = this._cv.height / dpr
          this._opts.onEraseAt({
            x: this._focus.x + (point.x - w * 0.21) / this._magnification,
            y: this._focus.y + (point.y - h * 0.54) / this._magnification
          }, begin)
        }
        this.drawGuides()
        this._resetZoomLivePreview()
      },

      close() {
        if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null }
        if (this._strokes && this._strokes.length) this.commit()
        if (this._eraseMode && this._opts && this._opts.onEraseModeChange) {
          this._opts.onEraseModeChange(false)
        }
        if (this._surfaceHandlers) {
          const h = this._surfaceHandlers
          h.surface.removeEventListener('pointerdown', h.down, true)
          h.surface.removeEventListener('pointermove', h.move, true)
          h.surface.removeEventListener('pointerup', h.up, true)
          h.surface.removeEventListener('pointercancel', h.up, true)
          this._surfaceHandlers = null
        }
        if (this._targetEl) this._targetEl.remove()
        if (this._settingsEl) this._settingsEl.remove()
        if (this._el) this._el.remove()
        const o = this._opts
        this._el = null; this._cv = null; this._strokes = null; this._opts = null
        this._focus = null; this._variant = null; this._targetEl = null; this._settingsEl = null
        this._settings = null; this._placedCount = 0; this._eraseMode = false
        if (o && o.onClose) o.onClose()
      }
    }
  }

  // ---- helpers ----------------------------------------------------------------------------

  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice()
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
    let maxD = 0, idx = 0
    const len = Math.hypot(bx - ax, by - ay) || 1e-6
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD <= eps) return [pts[0], pts[pts.length - 1]]
    const a = rdp(pts.slice(0, idx + 1), eps)
    const b = rdp(pts.slice(idx), eps)
    return a.slice(0, -1).concat(b)
  }

  function isAxisRect(poly) {
    // a 4-corner shape whose sides are all near-horizontal or near-vertical
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4]
      const ang = Math.abs(Math.atan2(y2 - y1, x2 - x1)) % (Math.PI / 2)
      if (Math.min(ang, Math.PI / 2 - ang) > 0.3) return false
    }
    return true
  }

  const hwrCallbacks = {}
  let hwrRouterInstalled = false
  function installHwrRouter() {
    if (hwrRouterInstalled) return
    hwrRouterInstalled = true
    const prev = window.onHwrEvent
    window.onHwrEvent = function (json) {
      let ev = json
      try { if (typeof json === 'string') ev = JSON.parse(json) } catch (e) { ev = null }
      if (ev && ev.id && hwrCallbacks[ev.id]) {
        const cb = hwrCallbacks[ev.id]
        if (ev.type === 'result') {
          delete hwrCallbacks[ev.id]
          const cands = ev.candidates || []
          cb({ text: cands.length ? cands[0].text : '', candidates: cands })
        } else if (ev.type === 'error') {
          delete hwrCallbacks[ev.id]
          cb({ error: ev.message || 'recognition failed' })
        }
        return
      }
      if (prev) prev(json)
    }
  }

  // component styles (e-ink: black hairlines, white fills only)
  const style = document.createElement('style')
  style.textContent =
    '.ink-pad{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:2px solid #000;z-index:900;height:38%;display:flex;flex-direction:column}' +
    '.ink-pad-head{display:flex;align-items:center;gap:12px;padding:6px 12px;border-bottom:1px solid #000}' +
    '.ink-pad-head strong{font-size:15px}' +
    '.ink-pad-head button{background:#fff;border:1px solid #000;border-radius:6px;padding:4px 12px;font-size:14px}' +
    '.ink-pad-mode{display:inline-flex;gap:0}' +
    '.ink-pad-mode button{border-radius:0}' +
    '.ink-pad-mode button:first-child{border-radius:6px 0 0 6px}' +
    '.ink-pad-mode button:last-child{border-radius:0 6px 6px 0;border-left:none}' +
    '.ink-pad-mode button.on{background:#000;color:#fff}' +
    '.ink-pad-actions{display:inline-flex;gap:8px}' +
    '.ink-pad-btns{margin-left:auto;display:inline-flex;gap:8px}' +
    '.ink-pad-box{flex:1;position:relative}' +
    '.ink-pad-box canvas{position:absolute;inset:0}' +
    /* Classic Handwriting Zoom mirrors Planning's 34% magnified-page layout and controls. These
     * rules live with the neutral WritingPad so Write/Scribe/Notes all receive the same UI. */
    '.ink-pad-zoom{height:34vh;border-top:2px solid #000;z-index:900}' +
    '.ink-pad-zoom .ink-pad-box{order:1;min-height:150px;overflow:hidden;border:2px solid #000;background:#fff;box-sizing:border-box}' +
    '.ink-pad-zoom .ink-pad-box canvas{width:100%;height:100%;z-index:1;background:transparent}' +
    '.ink-pad-zoom .ink-pad-head{order:2;display:flex;gap:8px;align-items:center;min-height:62px;padding:6px 10px max(6px,env(safe-area-inset-bottom));border-top:2px solid #000;border-bottom:0;background:#fff}' +
    '.ink-pad-zoom .ink-pad-head button{min-width:48px;min-height:48px;padding:4px 10px;font-size:18px;background:#fff;color:#000;border:2px solid #000;border-radius:10px}' +
    '.ink-pad-zoom .ink-pad-head button:active,.ink-pad-zoom .ink-pad-head button.active{background:#000;color:#fff}' +
    '.ink-pad-zoom .ink-pad-head button:disabled{opacity:.28}' +
    '.ink-pad-zoom .magnify-eraser{margin-left:auto}' +
    '.ink-pad-zoom.hand-left .ink-pad-head{flex-direction:row-reverse}' +
    '.ink-pad-zoom.hand-left .magnify-eraser{margin-left:0;margin-right:auto}' +
    '.ink-pad-zoom .magnify-close{border-style:dashed}' +
    '.ink-pad-context{position:absolute;inset:0;z-index:2;pointer-events:none}' +
    '.ink-pad-context .magnify-context-badge,.ink-pad-context .magnify-context-hint{position:absolute;top:8px;padding:3px 7px;background:#fff;border:1px solid #000;font-size:11px;font-weight:800;line-height:14px}' +
    '.ink-pad-context .magnify-context-badge{left:8px}' +
    '.ink-pad-context .magnify-context-hint{right:8px;display:flex;align-items:center;gap:6px}' +
    '.ink-pad-style-swatch{display:inline-block;width:28px;min-height:3px;border:1px solid #000}' +
    '.ink-pad-target{position:absolute;border:2px solid #000;pointer-events:none;z-index:18;background:transparent;box-sizing:border-box}' +
    '.ink-pad-target>span{position:absolute;top:2px;left:4px;padding:1px 3px;background:#000;color:#fff;font-size:9px;font-weight:800;line-height:12px;letter-spacing:.04em}' +
    '.ink-pad-settings{position:absolute;right:10px;bottom:66px;background:#fff;border:2px solid #000;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;z-index:902}' +
    '.ink-pad-zoom.hand-left .ink-pad-settings{right:auto;left:10px}' +
    '.ink-pad-settings label{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;font-weight:700}' +
    '.ink-pad-settings select{min-height:44px;border:2px solid #000;background:#fff;color:#000;font-size:15px}' +
    '@media(max-width:700px){.ink-pad-zoom .ink-pad-head{gap:5px;padding-inline:6px}.ink-pad-zoom .ink-pad-head button{min-width:44px;padding-inline:6px}.ink-pad-context .magnify-context-badge,.ink-pad-context .magnify-context-hint{font-size:9px}}'
  document.head.appendChild(style)

  window.InkTools = InkTools
})()
