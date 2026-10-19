// Structure-preserving PDF reading regions.
//
// This is a clean-room web implementation of the useful reading behaviour found in readers such
// as KOReader/k2pdfopt: trim unused margins, find a sustained vertical gutter, zoom one content
// lane at a time, and retain a small overlap between consecutive views. It deliberately returns
// source-page crop rectangles rather than reconstructed text, so equations, figures, typography,
// colour and annotations continue to use Kalamos's existing PDF raster pipeline.
(function(root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PdfTextbookLayout = api
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict'

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
  function round(n) { return Math.round(n * 100) / 100 }
  function quantile(values, q) {
    if (!values.length) return 0
    var a = values.slice().sort(function(x, y) { return x - y })
    var p = clamp(q, 0, 1) * (a.length - 1)
    var i = Math.floor(p), f = p - i
    return a[i] + (a[Math.min(a.length - 1, i + 1)] - a[i]) * f
  }
  function median(values) { return quantile(values, 0.5) }

  function cleanRuns(layout) {
    var W = +layout.w || 0, H = +layout.h || 0
    if (!(W > 0 && H > 0) || !Array.isArray(layout.runs)) return []
    return layout.runs.map(function(r) {
      var x = +r.x, y = +r.y, w = +r.w, h = +r.h
      return { t: String(r.t || ''), x: x, y: y, w: w, h: h,
        x1: x + w, y1: y + h, cx: x + w / 2, cy: y + h / 2 }
    }).filter(function(r) {
      return r.t.trim() && isFinite(r.x) && isFinite(r.y) && isFinite(r.w) && isFinite(r.h) &&
        r.w > 0 && r.h > 0 && r.x1 >= 0 && r.y1 >= 0 && r.x <= W && r.y <= H
    })
  }

  // Ignore a handful of isolated page numbers/crop-mark artefacts, but preserve real sidebars.
  function contentBounds(runs, W, H) {
    var x0s = runs.map(function(r) { return r.x })
    var x1s = runs.map(function(r) { return r.x1 })
    var y0s = runs.map(function(r) { return r.y })
    var y1s = runs.map(function(r) { return r.y1 })
    var padX = W * 0.012, padY = H * 0.008
    return {
      x0: clamp(quantile(x0s, 0.006) - padX, 0, W),
      x1: clamp(quantile(x1s, 0.994) + padX, 0, W),
      y0: clamp(quantile(y0s, 0.004) - padY, 0, H),
      y1: clamp(quantile(y1s, 0.996) + padY, 0, H)
    }
  }

  // Find a low-ink vertical band that persists through the page. Word spaces form narrow valleys;
  // a real inter-column gutter is wider and has low occupancy over many independent text lines.
  function findGutter(runs, bounds, W) {
    var bins = 144, score = new Array(bins).fill(0)
    var heights = runs.map(function(r) { return r.h }).filter(function(h) { return h < W * 0.12 })
    var normalH = Math.max(1, median(heights))
    runs.forEach(function(r) {
      // Very tall display glyphs/images should not erase a gutter detected across body text.
      var weight = clamp(r.h / normalH, 0.45, 2.2)
      var a = clamp(Math.floor(r.x / W * bins), 0, bins - 1)
      var b = clamp(Math.ceil(r.x1 / W * bins), a + 1, bins)
      for (var i = a; i < b; i++) score[i] += weight
    })
    var smooth = score.map(function(_, i) {
      var total = 0, n = 0
      for (var j = Math.max(0, i - 1); j <= Math.min(bins - 1, i + 1); j++) { total += score[j]; n++ }
      return total / n
    })
    var lo = clamp(Math.floor(bounds.x0 / W * bins), 0, bins - 1)
    var hi = clamp(Math.ceil(bounds.x1 / W * bins), lo + 1, bins)
    var positive = smooth.slice(lo, hi).filter(function(v) { return v > 0.01 })
    if (!positive.length) return null
    var threshold = Math.max(0.7, quantile(positive, 0.18) * 0.5)
    var searchLo = lo + Math.ceil((hi - lo) * 0.16)
    var searchHi = hi - Math.ceil((hi - lo) * 0.16)
    var minBins = Math.max(3, Math.ceil(bins * 0.024))
    var best = null, start = -1
    for (var k = searchLo; k <= searchHi; k++) {
      var low = k < searchHi && smooth[k] <= threshold
      if (low && start < 0) start = k
      if ((!low || k === searchHi) && start >= 0) {
        var end = low ? k + 1 : k
        if (end - start >= minBins) {
          var gx0 = start / bins * W, gx1 = end / bins * W, split = (gx0 + gx1) / 2
          var left = runs.filter(function(r) { return r.cx < split })
          var right = runs.filter(function(r) { return r.cx >= split })
          var balance = Math.min(left.length, right.length) / Math.max(1, runs.length)
          var leftW = split - bounds.x0, rightW = bounds.x1 - split
          if (balance >= 0.08 && leftW >= W * 0.13 && rightW >= W * 0.13) {
            var valley = smooth.slice(start, end).reduce(function(a, v) { return a + v }, 0) / (end - start)
            var merit = (end - start) * (0.6 + balance) / (1 + valley)
            if (!best || merit > best.merit) best = { x0: gx0, x1: gx1, split: split, merit: merit,
              left: left, right: right, balance: balance }
          }
        }
        start = -1
      }
    }
    return best
  }

  function laneFromRuns(runs, W, H, id) {
    var x0 = quantile(runs.map(function(r) { return r.x }), 0.01)
    var x1 = quantile(runs.map(function(r) { return r.x1 }), 0.99)
    var y0 = quantile(runs.map(function(r) { return r.y }), 0.006)
    var y1 = quantile(runs.map(function(r) { return r.y1 }), 0.994)
    return { id: id, runs: runs, x0: clamp(x0 - W * 0.014, 0, W), x1: clamp(x1 + W * 0.014, 0, W),
      y0: clamp(y0 - H * 0.008, 0, H), y1: clamp(y1 + H * 0.008, 0, H) }
  }

  function lanesFor(runs, bounds, gutter, W, H, rtl) {
    if (!gutter) return [laneFromRuns(runs, W, H, 'page')]
    var left = laneFromRuns(gutter.left, W, H, 'left')
    var right = laneFromRuns(gutter.right, W, H, 'right')
    // Keep crop edges out of the gutter, even when a large heading has words on both sides.
    left.x1 = Math.min(left.x1, gutter.x1)
    right.x0 = Math.max(right.x0, gutter.x0)
    var lw = left.x1 - left.x0, rw = right.x1 - right.x0
    var primary, auxiliary
    // Textbooks commonly use a narrow glossary/callout rail. Read the wider narrative lane first;
    // similarly-sized newspaper columns retain normal direction order.
    if (Math.min(lw, rw) < Math.max(lw, rw) * 0.58) {
      primary = lw > rw ? left : right
      auxiliary = primary === left ? right : left
      primary.role = 'main'; auxiliary.role = 'margin'
      return [primary, auxiliary]
    }
    left.role = right.role = 'column'
    return rtl ? [right, left] : [left, right]
  }

  function whitespaceCut(runs, wanted, lo, hi, normalH) {
    var candidates = []
    runs.forEach(function(r) { if (r.y1 >= lo && r.y <= hi) { candidates.push(r.y - normalH * 0.18); candidates.push(r.y1 + normalH * 0.18) } })
    candidates.push(wanted)
    var best = wanted, bestScore = Infinity
    candidates.forEach(function(y) {
      y = clamp(y, lo, hi)
      var crosses = runs.some(function(r) { return r.y < y && r.y1 > y })
      var score = Math.abs(y - wanted) + (crosses ? normalH * 20 : 0)
      if (score < bestScore) { best = y; bestScore = score }
    })
    return best
  }

  function regionsForLane(lane, W, H, viewportAspect, overlapRatio) {
    var width = Math.max(1, lane.x1 - lane.x0)
    var viewH = clamp(width * viewportAspect, H * 0.16, H * 0.82)
    var overlap = clamp(viewH * overlapRatio, H * 0.05, H * 0.18)
    var normalH = Math.max(1, median(lane.runs.map(function(r) { return r.h })))
    var regions = [], y = lane.y0, guard = 0
    while (y < lane.y1 - normalH && guard++ < 20) {
      var wanted = Math.min(lane.y1, y + viewH)
      var end = wanted
      if (wanted < lane.y1 - normalH) {
        end = whitespaceCut(lane.runs, wanted, wanted - viewH * 0.10, wanted + viewH * 0.08, normalH)
      }
      if (end <= y + normalH * 3) end = Math.min(lane.y1, y + viewH)
      regions.push({ x0: lane.x0, y0: y, x1: lane.x1, y1: Math.min(lane.y1, end),
        lane: lane.id, role: lane.role || 'page' })
      if (end >= lane.y1) break
      var nextWanted = end - overlap
      var next = whitespaceCut(lane.runs, nextWanted,
        Math.max(lane.y0, nextWanted - viewH * 0.055),
        Math.min(end - normalH, nextWanted + viewH * 0.055), normalH)
      if (next <= y + normalH) next = end
      y = next
    }
    return regions
  }

  function spanningDisplayLines(runs, gutter, W) {
    if (!gutter || !runs.length) return []
    var normalH = Math.max(1, median(runs.map(function(r) { return r.h })))
    var candidates = runs.filter(function(r) { return r.h >= normalH * 1.38 })
      .sort(function(a, b) { return a.cy - b.cy || a.x - b.x })
    var lines = []
    candidates.forEach(function(run) {
      var line = lines.length ? lines[lines.length - 1] : null
      if (!line || Math.abs(run.cy - line.cy) > Math.max(2, normalH * 0.58)) {
        line = { cy: run.cy, x0: run.x, x1: run.x1, y0: run.y, y1: run.y1, n: 1 }
        lines.push(line)
      } else {
        line.cy = (line.cy * line.n + run.cy) / (line.n + 1); line.n++
        line.x0 = Math.min(line.x0, run.x); line.x1 = Math.max(line.x1, run.x1)
        line.y0 = Math.min(line.y0, run.y); line.y1 = Math.max(line.y1, run.y1)
      }
    })
    return lines.filter(function(line) {
      return line.n >= 2 && line.x0 < gutter.x0 && line.x1 > gutter.x1 && line.x1 - line.x0 > W * 0.42
    })
  }

  function makeDisplaySafe(region, displayLines, sharedWidth, W, H) {
    var out = { x0: region.x0, x1: region.x1, y0: region.y0, y1: region.y1,
      lane: region.lane, role: region.role }
    if (sharedWidth) { out.x0 = sharedWidth.x0; out.x1 = sharedWidth.x1 }
    else displayLines.forEach(function(line) {
      if (line.y1 >= out.y0 && line.y0 <= out.y1) {
        out.x0 = Math.min(out.x0, line.x0 - W * 0.018)
        out.x1 = Math.max(out.x1, line.x1 + W * 0.018)
      }
    })
    // Keep a small strip of source page visible on both sides. Text-run bounds can be fractionally
    // tight around italic/overhanging glyphs, and a little paper margin is easier to read on e-ink.
    var padX = clamp((out.x1 - out.x0) * 0.025, W * 0.012, W * 0.020)
    out.x0 -= padX; out.x1 += padX
    // The status strip overlays the bottom of the raster surface on-device. Reserve enough source
    // context above and below every logical slice that complete glyphs/equations remain clear of it.
    var padY = clamp((region.y1 - region.y0) * 0.04, H * 0.012, H * 0.035)
    out.x0 = clamp(out.x0, 0, W); out.x1 = clamp(out.x1, 0, W)
    out.y0 = clamp(out.y0 - padY, 0, H); out.y1 = clamp(out.y1 + padY, 0, H)
    return out
  }

  function pctRegion(r, W, H) {
    return {
      l: round(clamp(r.x0 / W * 100, 0, 99)), t: round(clamp(r.y0 / H * 100, 0, 99)),
      r: round(clamp((W - r.x1) / W * 100, 0, 99)), b: round(clamp((H - r.y1) / H * 100, 0, 99)),
      lane: r.lane, role: r.role
    }
  }

  function analyze(layout, options) {
    options = options || {}
    var W = +layout.w || 0, H = +layout.h || 0, runs = cleanRuns(layout)
    if (!(W > 0 && H > 0) || runs.length < 8) return { regions: [], reason: 'no-text-layout', columns: 0 }
    var bounds = contentBounds(runs, W, H)
    var gutter = findGutter(runs, bounds, W)
    var lanes = lanesFor(runs, bounds, gutter, W, H, !!options.rtl)
    var aspect = clamp(+options.viewportAspect || 1.32, 0.7, 2.2)
    // A narrow reference rail is useful in the complete Page view, but inserting it after the main
    // lane destroys narrative continuity. Keep it out of sequential Textbook turns; retain its
    // derived regions separately so a future explicit “margin notes” action can expose it without
    // pretending it belongs in the paragraph flow.
    var overlap = clamp(options.overlap == null ? 0.20 : +options.overlap, 0.08, 0.26)
    var readingLanes = lanes.filter(function(lane) { return lane.role !== 'margin' })
    var marginLanes = lanes.filter(function(lane) { return lane.role === 'margin' })
    var regions = [], marginRegions = []
    readingLanes.forEach(function(lane) { regions = regions.concat(regionsForLane(lane, W, H, aspect, overlap)) })
    marginLanes.forEach(function(lane) { marginRegions = marginRegions.concat(regionsForLane(lane, W, H, aspect, overlap)) })
    var displayLines = spanningDisplayLines(runs, gutter, W)
    // A spanning section heading is structural evidence that this page is meant to be read at
    // content width. Use one stable horizontal frame for every view on that source page: no clipped
    // heading in view one and no sideways jump/zoom change in view two.
    var sharedWidth = displayLines.length ? {
      x0: clamp(Math.min(bounds.x0, quantile(displayLines.map(function(line) { return line.x0 }), 0) - W * 0.018), 0, W),
      x1: clamp(Math.max(bounds.x1, quantile(displayLines.map(function(line) { return line.x1 }), 1) + W * 0.018), 0, W)
    } : null
    regions = regions.map(function(region) { return makeDisplaySafe(region, displayLines, sharedWidth, W, H) })
    marginRegions = marginRegions.map(function(region) { return makeDisplaySafe(region, [], null, W, H) })
    return {
      version: 1, page: { w: W, h: H }, columns: gutter ? 2 : 1,
      gutter: gutter ? { x0: round(gutter.x0 / W * 100), x1: round(gutter.x1 / W * 100) } : null,
      spanningLines: displayLines.length,
      widthMode: sharedWidth ? 'content' : (gutter ? 'main' : 'page'),
      lanes: lanes.map(function(l) { return { id: l.id, role: l.role, x0: round(l.x0 / W * 100), x1: round(l.x1 / W * 100) } }),
      regions: regions.map(function(r) { return pctRegion(r, W, H) }),
      marginRegions: marginRegions.map(function(r) { return pctRegion(r, W, H) }),
      overlap: overlap
    }
  }

  function cropString(region) {
    return [region.l, region.t, region.r, region.b].join(',')
  }

  return { analyze: analyze, cropString: cropString }
})
