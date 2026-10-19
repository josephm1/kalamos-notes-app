/* Pure, vendor-neutral stroke geometry. No renderer, clock, HWR service or pen hot-path work.
 * Recognition happens at pen-up. Ambiguity is ordinary ink; deletion is a host transaction. */
;(function(root) {
  'use strict'
  const KEY = 'kalamos.scribbleErase.enabled'
  function enabled() { try { return root.localStorage.getItem(KEY) !== 'false' } catch (_) { return true } }
  function setEnabled(value) { try { root.localStorage.setItem(KEY, String(!!value)) } catch (_) {} }
  function distance(p, a, b) {
    const dx=b.x-a.x, dy=b.y-a.y, len=dx*dx+dy*dy
    const t=len ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)) : 0
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)
  }
  function contact(a,b,c,d,r) {
    const side=(p,q,v)=>(q.x-p.x)*(v.y-p.y)-(q.y-p.y)*(v.x-p.x)
    return side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0 ||
      Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))<=r
  }
  function bounds(points,pad) {
    let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity
    for(const p of points) { l=Math.min(l,p.x);t=Math.min(t,p.y);r=Math.max(r,p.x);b=Math.max(b,p.y) }
    return {x:l-pad,y:t-pad,w:r-l+2*pad,h:b-t+2*pad}
  }
  // Ignore point density and tiny pen jitter when measuring corners. Looking a few
  // CSS pixels either side of a vertex distinguishes a scrub reversal from a smooth loop.
  function sharpTurns(points, cumulative, window) {
    let count = 0, lastTurn = -Infinity
    for (let i = 1; i < points.length - 1; i++) {
      if (cumulative[i] - lastTurn < window * 1.5) continue
      let a = i - 1, b = i + 1
      while (a > 0 && cumulative[i] - cumulative[a] < window) a--
      while (b < points.length - 1 && cumulative[b] - cumulative[i] < window) b++
      if (cumulative[i] - cumulative[a] < window || cumulative[b] - cumulative[i] < window) continue
      const incoming = { x: points[i].x - points[a].x, y: points[i].y - points[a].y }
      const outgoing = { x: points[b].x - points[i].x, y: points[b].y - points[i].y }
      const lengths = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y)
      if (lengths && (incoming.x * outgoing.x + incoming.y * outgoing.y) / lengths < -0.25) {
        count++
        lastTurn = cumulative[i]
      }
    }
    return count
  }

  function sweepLegs(points, axis, minimum, deadband) {
    const legs = []
    let start = 0, extreme = 0, direction = 0
    for (let i = 1; i < points.length; i++) {
      const delta = points[i][axis] - points[extreme][axis]
      if (!direction) {
        if (Math.abs(delta) > deadband) { direction = Math.sign(delta); extreme = i }
      } else if (delta * direction >= 0) extreme = i
      else if (Math.abs(delta) > deadband) {
        if (Math.abs(points[extreme][axis] - points[start][axis]) >= minimum) legs.push([start, extreme])
        start = extreme
        extreme = i
        direction = -direction
      }
    }
    if (Math.abs(points[extreme][axis] - points[start][axis]) >= minimum) legs.push([start, extreme])
    return legs
  }

  function rejected(reason, value) {
    // Numeric intent diagnostics only: never log the user's ink coordinates or text.
    if (root.console) root.console.log('DIAG scribbleRejected reason=' + reason + ' value=' + value)
    return null
  }

  // Measure backwards travel along the LONG dimension of the mark, rather than
  // its dominant pen direction. A row of m's reverses vertically, but progresses
  // forwards along the word. A scrub retraces that progress as well. Arc-length
  // resampling keeps the spatial axis independent of device point density.
  function retracing(points, cumulative) {
    const length = cumulative[cumulative.length - 1]
    const count = 64, samples = []
    let segment = 1
    for (let i = 0; i <= count; i++) {
      const at = length * i / count
      while (segment < points.length - 1 && cumulative[segment] < at) segment++
      const a = points[segment - 1], b = points[segment]
      const span = cumulative[segment] - cumulative[segment - 1]
      const t = span ? (at - cumulative[segment - 1]) / span : 0
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
    const cx = samples.reduce((sum, p) => sum + p.x, 0) / samples.length
    const cy = samples.reduce((sum, p) => sum + p.y, 0) / samples.length
    let xx = 0, xy = 0, yy = 0
    for (const p of samples) { xx += (p.x-cx)**2; xy += (p.x-cx)*(p.y-cy); yy += (p.y-cy)**2 }
    const angle = Math.atan2(2 * xy, xx - yy) / 2
    const ux = Math.cos(angle), uy = Math.sin(angle)
    let forward = 0, backward = 0
    for (let i = 1; i < points.length; i++) {
      const delta = (points[i].x-points[i-1].x)*ux + (points[i].y-points[i-1].y)*uy
      forward += Math.max(0, delta); backward += Math.max(0, -delta)
    }
    return { amount: Math.min(forward, backward), ratio: Math.min(forward, backward) / (forward + backward || 1) }
  }

  function shape(points, pitch) {
    if (!enabled() || !Array.isArray(points) || points.length < 4) return null
    if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
    const original = points, box = bounds(points, 0)
    const diagonal = Math.hypot(box.w, box.h)
    if (diagonal < Math.max(18, (pitch || 44) * 0.4)) return null

    // Opposing directions reinforce in this direction tensor. A directional scrub
    // has high concentration; smooth circular letter loops have low concentration.
    // General approach reviewed against vincentaravantinos/scribble; original code.
    let xx = 0, xy = 0, yy = 0, total = 0
    const cumulative = [0]
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x, dy = points[i].y - points[i - 1].y
      const length = Math.hypot(dx, dy)
      cumulative.push(cumulative[i - 1] + length)
      if (length < 0.25) continue
      xx += dx * dx / length; xy += dx * dy / length; yy += dy * dy / length
      total += length
    }
    if (!total) return null
    const concentration = Math.hypot(xx - yy, 2 * xy) / total
    const angle = Math.atan2(2 * xy, xx - yy) / 2
    const ux = Math.cos(angle), uy = Math.sin(angle)
    const projected = points.map(p => ({ x: p.x * ux + p.y * uy, y: -p.x * uy + p.y * ux }))
    const band = bounds(projected, 0)

    // Three broad passes (two reversals) suffice for a tight, nearly straight scrub.
    // Keep that shorter path stricter than longer gestures: a single out-and-back,
    // ordinary Z, and forward letter waves must remain ink. Point count is not a
    // proxy for effort: native sampling may deliver only the four corner points.
    let legs = sweepLegs(projected, 'x', band.w * 0.55, Math.max(1.5, band.w * 0.035))
    let commonLow = -Infinity, commonHigh = Infinity
    for (const [a, b] of legs) {
      commonLow = Math.max(commonLow, Math.min(projected[a].x, projected[b].x))
      commonHigh = Math.min(commonHigh, Math.max(projected[a].x, projected[b].x))
    }
    const broad = concentration >= 0.85 && band.h <= band.w * 0.85 && band.h >= 2 &&
      legs.length >= 4 && (legs.length >= 6 || concentration >= 0.95) && commonHigh - commonLow >= band.w * 0.45
    const shortBroad = legs.length === 3 && concentration >= 0.96 &&
      band.h >= 2 && band.h <= band.w * 0.18 && commonHigh - commonLow >= band.w * 0.65
    if (broad || shortBroad) return { original, box, legs, mode: 'sweep' }

    // Dense scrubbing can travel across a word in SHORT overlapping sweeps. Requiring
    // every pass to span the entire word rejected the user's actual device gestures.
    // Lighter scrubs need fewer passes, but must retrace along their spatial axis.
    // This separates them from ordinary forward cursive with vertical reversals.
    // Use the rotated band: an identical gesture must not become less dense just
    // because the user scribbles diagonally or uses the rotated Zoom surface.
    const density = cumulative[cumulative.length - 1] / Math.hypot(band.w, band.h)
    if (density < 2.35) return density >= 2.1 ? rejected("density", density.toFixed(2)) : null
    const window = Math.max(3, Math.min(6, (pitch || 44) * 0.1))
    const corners = sharpTurns(original, cumulative, window)
    if (corners < 2) return rejected("corners", corners)
    const minimum = Math.max(4, Math.min(8, (pitch || 44) * 0.12))
    const directions = [
      sweepLegs(projected, 'x', minimum, minimum * 0.6),
      sweepLegs(projected, 'y', minimum, minimum * 0.6),
    ]
    legs = directions[0].length >= directions[1].length ? directions[0] : directions[1]
    if (legs.length < 4) return rejected("reversals", legs.length)
    if (density < 5 || corners < 8 || legs.length < 9) {
      const trace = retracing(original, cumulative)
      // Device rejected a deliberate scrub at 0.16 retracing before accepting
      // 31 sweeps (2026-10-11). Permit modest forward travel, while retaining
      // real backwards distance and repeated old-ink contact as safeguards.
      if (trace.ratio < 0.14 || trace.amount < minimum * 2) return rejected("retracing", trace.ratio.toFixed(2))
    }
    return { original, box, legs, mode: 'scrub' }
  }
  function candidate(points,pitch) { return !!shape(points,pitch) }
  function detect(points,strokes,pitch,wordGroups) {
    const gesture=shape(points,pitch)
    if(!gesture || !strokes.length) return null
    const {original,box,legs}=gesture
    let hits=[]
    strokes.forEach((stroke,index)=>{
      const pts=stroke.points||[]; if(!pts.length || stroke.tool==='selection') return
      const radius=Math.min(6,Math.max(1,(stroke.width||2)/2+1))
      const sb=bounds(pts,radius)
      if(sb.x>box.x+box.w||sb.x+sb.w<box.x||sb.y>box.y+box.h||sb.y+sb.h<box.y) return
      let passes=0
      for(const [a,b] of legs) {
        let hit=false
        for(let i=a+1;i<=b&&!hit;i++) {
          if(pts.length===1) hit=distance(pts[0],original[i-1],original[i])<=radius
          else for(let j=1;j<pts.length&&!hit;j++) hit=contact(original[i-1],original[i],pts[j-1],pts[j],radius)
        }
        if(hit) passes++
      }
      // Whole-stroke erase, like the existing eraser, but never a bounding-box wipe.
      if(passes>=2) hits.push(index)
    })
    if (wordGroups && hits.length) {
      // Intent is path LENGTH inside each word, not sample count (device delivery is uneven).
      // A brief excursion touching a neighbour twice must not erase that neighbour's whole word.
      const support = wordGroups.map(group => {
        const pts = group.flatMap(i => strokes[i]?.points || [])
        if (!pts.length || !group.some(i => hits.includes(i))) return 0
        const box = bounds(pts, 3)
        let length = 0
        for (let i=1; i<original.length; i++) {
          const a=original[i-1], b=original[i], dx=b.x-a.x, dy=b.y-a.y
          let lo=0, hi=1
          // Clip each segment to word bounds; duplicated samples add no support.
          for (const [p,q] of [[-dx,a.x-box.x],[dx,box.x+box.w-a.x],[-dy,a.y-box.y],[dy,box.y+box.h-a.y]]) {
            if (!p) { if (q<0) {hi=-1;break} }
            else if (p<0) lo=Math.max(lo,q/p)
            else hi=Math.min(hi,q/p)
          }
          if (hi>lo) length += Math.hypot(dx,dy)*(hi-lo)
        }
        return length
      })
      const dominant = Math.max(...support, 0)
      const allowed = new Set(wordGroups.flatMap((group,i) =>
        support[i] > 0 && support[i] >= dominant * 0.25 ? group : []))
      const crossed = hits.length
      hits = hits.filter(i => allowed.has(i))
      if (crossed !== hits.length && root.console)
        root.console.log('DIAG scribbleWordIntent crossed=' + crossed + ' kept=' + hits.length)
    }
    if(!hits.length) return rejected("contact", 0)
    if (root.console) root.console.log('DIAG scribbleErase mode=' + gesture.mode + ' sweeps=' + legs.length + ' targets=' + hits.length)
    const all=original.concat(...hits.map(i=>strokes[i].points))
    return {indices:hits,rect:bounds(all,8)}
  }
  root.KalamosScribbleErase={detect,candidate,enabled,setEnabled}
})(globalThis)
