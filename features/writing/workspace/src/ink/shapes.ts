// Port of the neutral InkTools.perfectShape algorithm. Opt-in only: ordinary
// handwriting, dots and crossbars must remain untouched. Recognition is geometric,
// not HWR, and consumes a completed stroke after scribble-to-erase gets first refusal.
import {boundsOfPoints,type InkPoint} from './types';
export function perfectShape(points: InkPoint[],lane:number): {x:number;y:number}[] | null {
  const pts = points.map(p => [p.x, p.y])
  if (pts.length < 6) return null
  const b = boundsOfPoints(points); const bb = {w:b.width,h:b.height,cx:b.x+b.width/2,cy:b.y+b.height/2,x0:b.x,y0:b.y,x1:b.x+b.width,y1:b.y+b.height}
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
    const out: {x:number;y:number}[] = []
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

}
function rdp(pts: number[][], eps: number): number[][] {
  if (pts.length < 3) return pts.slice()
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
  let maxD = 0, idx = 0
  const len = Math.hypot(bx - ax, by - ay)
  for (let i = 1; i < pts.length - 1; i++) {
    // A closed path has a zero-length chord. Distance to its start selects
    // the first split; the historical helper otherwise reduced every closed box to nothing.
    const d = len === 0 ? Math.hypot(pts[i][0]-ax,pts[i][1]-ay)
      : Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]]
  const a = rdp(pts.slice(0, idx + 1), eps)
  const b = rdp(pts.slice(idx), eps)
  return a.slice(0, -1).concat(b)
}

function isAxisRect(poly: number[][]) {
  // a 4-corner shape whose sides are all near-horizontal or near-vertical
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4]
    const ang = Math.abs(Math.atan2(y2 - y1, x2 - x1)) % (Math.PI / 2)
    if (Math.min(ang, Math.PI / 2 - ang) > 0.3) return false
  }
  return true
}

