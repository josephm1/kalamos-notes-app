// InkFlow — ruled handwriting reflow, ported from Write by Stylus Labs
// (github.com/styluslabs/Write, syncscribble/selection.cpp Selection::reflowStrokes).
//
// The model: a ruled surface is a stack of lanes (rule lines) of height [lane]. Every flow
// item (a pen stroke, or any box the caller adapts — a typed word span works the same way)
// lives on the lane its vertical centre falls in. Items on a lane read left→right; a
// horizontal gap ≥ minWordSep·lane between neighbours is a word break. When a lane's content
// crosses its right edge, the trailing word moves down to the head of the next lane, the next
// lane's existing content shifts right to make room, and the overflow cascades lane by lane
// until a lane absorbs it — inserting a fresh blank lane at the end if the last one was full.
//
// Nothing here touches the DOM or the bridge. Callers adapt their stroke/text model into flow
// items, run a pass, then apply the returned translations to their own model:
//
//   const items = strokes.map(s => InkFlow.item(bbox(s), s))
//   const res = InkFlow.reflow(items, { lane, left, right, minWordSep })
//   if (res.changed) for (const it of items) if (it.dx || it.dy) translate(it.ref, it.dx, it.dy)
//
// Coordinates are caller-space; the geometry object localises the ruling:
//   lane        rule-line spacing (px)
//   top         y of the FIRST lane's top edge (px) — lane k spans [top + k·lane, top + (k+1)·lane)
//   left        x of the writable left edge (margin line), or a function(lineIndex) → x
//   right       x of the writable right edge, or a function(lineIndex) → x
//   minWordSep  word-break gap as a fraction of [lane] (default 0.3 — Write's minWordSep)
//   maxLine     optional hard lane cap; the cascade stops (returns overset:true) past it
(function () {
  'use strict'

  function fnOf(v) { return typeof v === 'function' ? v : function () { return v } }

  const InkFlow = {
    // Wrap a caller box into a flow item. [ref] is opaque (the caller's stroke/word object);
    // after reflow, [dx]/[dy] hold the translation the caller must apply to ref.
    item(bb, ref) {
      return { x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1, ref: ref, dx: 0, dy: 0 }
    },

    bbox(pts) {   // pts: [[x,y,...],...] or [{x,y},...]
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const p of pts) {
        const x = p.x !== undefined ? p.x : p[0], y = p.y !== undefined ? p.y : p[1]
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
      return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
    },

    lineOf(y, geo) { return Math.floor((y - (geo.top || 0)) / geo.lane) },

    // Current lane of an item, tracking its pending translation (Write's workingLine).
    itemLine(it, geo) { return this.lineOf((it.y0 + it.y1) / 2 + it.dy, geo) },

    // Write's cmpRuled: reading order = (lane, then left edge).
    sortRuled(items, geo) {
      const self = this
      items.sort(function (a, b) {
        const la = self.itemLine(a, geo), lb = self.itemLine(b, geo)
        return la === lb ? (a.x0 + a.dx) - (b.x0 + b.dx) : la - lb
      })
      return items
    },

    // The cascade (Write's Selection::reflowStrokes, dx/dline entry translation omitted —
    // callers pre-position items and just need overflow resolved). Mutates items' dx/dy.
    // Returns { changed, maxLine, overset } — maxLine = last lane holding content afterwards,
    // overset = true when geo.maxLine stopped the cascade (caller should grow and re-run).
    reflow(items, geo) {
      const lane = geo.lane
      if (!lane || lane <= 0 || !items.length) return { changed: false, maxLine: -1, overset: false }
      const leftOf = fnOf(geo.left), rightOf = fnOf(geo.right)
      const minGap = (geo.minWordSep || 0.3) * lane
      let changed = false, overset = false
      let guard = items.length * 8 + 64   // cascade is linear in practice; belt-and-braces

      this.sortRuled(items, geo)
      let i = 0
      while (i < items.length && guard-- > 0) {
        const currline = this.itemLine(items[i], geo)
        if (geo.maxLine !== undefined && currline > geo.maxLine) { overset = true; break }
        const left = leftOf(currline)
        const right = rightOf(currline) - 0.5 * minGap

        // Step 1: walk the lane; remember the last word break before the overflow point.
        let currRight = -Infinity
        let wordbreak = -1
        let j = i
        let overflow = false
        for (; j < items.length && this.itemLine(items[j], geo) === currline; j++) {
          const it = items[j]
          if (currRight > -Infinity && (it.x0 + it.dx) - currRight >= minGap) wordbreak = j
          currRight = Math.max(currRight, it.x1 + it.dx)
          if (currRight >= right) { overflow = true; j++; break }
        }
        // walk to the end of the lane regardless (j = first item past the lane)
        while (j < items.length && this.itemLine(items[j], geo) === currline) j++

        if (!overflow || wordbreak <= i - 1 || wordbreak === -1) { i = j; continue }
        // Never move a whole lane: the break must leave something behind (Write's 15% rule
        // is implicit here — wordbreak > i guarantees at least one leading word stays).

        // Step 1.5: where the moved word lands — align with the next lane's first item, or
        // start a fresh lane at left + minGap.
        const nextline = currline + 1
        if (geo.maxLine !== undefined && nextline > geo.maxLine) { overset = true; break }
        let landing = leftOf(nextline) + minGap
        let firstNext = -1
        for (let k = j; k < items.length; k++) {
          const ln = this.itemLine(items[k], geo)
          if (ln === nextline) { firstNext = k; landing = items[k].x0 + items[k].dx; break }
          if (ln > nextline) break
        }

        // Step 2: move wordbreak..end-of-lane down one lane, flush to the landing point.
        const dxDown = landing - (items[wordbreak].x0 + items[wordbreak].dx)
        let movedRight = -Infinity
        for (let k = wordbreak; k < j; k++) {
          items[k].dx += dxDown
          items[k].dy += lane
          movedRight = Math.max(movedRight, items[k].x1 + items[k].dx)
          changed = true
        }

        if (firstNext !== -1) {
          // Step 3: shift the next lane's existing content right to sit after the moved words.
          const shift = (movedRight + 1.25 * minGap) - (items[firstNext].x0 + items[firstNext].dx)
          if (shift > 0) {
            for (let k = firstNext; k < items.length && this.itemLine(items[k], geo) === nextline; k++) {
              // moved items also sit on nextline now but appear before firstNext in index order
              if (k >= wordbreak && k < j) continue
              items[k].dx += shift
              changed = true
            }
          }
        } else {
          // Moved onto a blank lane → push everything below down one lane (insert blank line).
          for (let k = j; k < items.length; k++) {
            if (this.itemLine(items[k], geo) > currline) { items[k].dy += lane; changed = true }
          }
        }

        // Re-enter from the (re-sorted) start of the next lane — moved words may overflow it.
        this.sortRuled(items, geo)
        i = 0
        while (i < items.length && this.itemLine(items[i], geo) <= currline) i++
      }

      let maxLine = -1
      for (const it of items) maxLine = Math.max(maxLine, this.itemLine(it, geo))
      return { changed, maxLine, overset }
    },

    // Write's insertSpace: shift everything on [line] at/after [x] right by [dx] (no wrap),
    // or with wrap when run through reflow afterwards. Convenience for gesture handlers.
    insertSpace(items, geo, line, x, dx) {
      let changed = false
      for (const it of items) {
        if (this.itemLine(it, geo) === line && (it.x0 + it.dx) >= x) { it.dx += dx; changed = true }
      }
      return changed
    },

    // ---- auto-newline ------------------------------------------------------------------
    // Guarded entry for implicit wrapping while the user writes (vs Write's explicit insert-
    // space tool): fires only when [trigger] (the just-written stroke's bbox) is handwriting-
    // sized and actually crosses the right edge, and only reflows lanes from the trigger's
    // lane down. Tall items (sketches, diagrams) opt the lane out entirely.
    shouldAutowrap(triggerBB, geo) {
      const rightOf = fnOf(geo.right)
      const line = this.lineOf((triggerBB.y0 + triggerBB.y1) / 2, geo)
      if (triggerBB.y1 - triggerBB.y0 > geo.lane * 1.6) return false     // not handwriting
      return triggerBB.x1 > rightOf(line) - (geo.wrapMargin !== undefined ? geo.wrapMargin : 0.02 * (rightOf(line) - fnOf(geo.left)(line)))
    },

    // Reflow the PARAGRAPH the trigger sits in: the contiguous run of handwriting lanes from
    // the trigger's lane downward. A blank lane ends the paragraph (the cascade may still move
    // a word onto it); a lane holding tall ink (a sketch/diagram) hard-stops it — implicit
    // wrapping never rearranges a drawing. If the cascade can't resolve inside that budget,
    // nothing moves at all (overset).
    autowrap(allItems, geo, triggerBB) {
      const none = { changed: false, maxLine: -1, overset: false }
      const startLine = this.lineOf((triggerBB.y0 + triggerBB.y1) / 2, geo)
      const byLine = new Map()
      for (const it of allItems) {
        const ln = this.itemLine(it, geo)
        if (ln < startLine) continue
        if (!byLine.has(ln)) byLine.set(ln, [])
        byLine.get(ln).push(it)
      }
      const scope = []
      let limit = startLine
      for (let ln = startLine; ; ln++) {
        const arr = byLine.get(ln)
        if (!arr || !arr.length) { limit = ln; break }          // blank lane — usable by the cascade
        if (arr.some(it => it.y1 - it.y0 > geo.lane * 1.6)) { limit = ln - 1; break }  // sketch — stay above it
        scope.push.apply(scope, arr)
        limit = ln + 1
      }
      if (!scope.length || limit < startLine) return none
      const capped = Object.assign({}, geo, {
        maxLine: geo.maxLine !== undefined ? Math.min(geo.maxLine, limit) : limit
      })
      const res = this.reflow(scope, capped)
      if (res.overset) {
        for (const it of scope) { it.dx = 0; it.dy = 0 }        // all-or-nothing: leave the page as written
        return { changed: false, maxLine: res.maxLine, overset: true }
      }
      return res
    }
  }

  window.InkFlow = InkFlow
})()
