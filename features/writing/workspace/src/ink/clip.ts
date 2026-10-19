export type InkClipRect = { left: number; top: number; right: number; bottom: number };
type Point = { x: number; y: number };

/** Presentation-only clipping. Split paths at hidden regions rather than joining across them;
 * the saved vectors and their editable coordinates remain untouched. */
export function clipInkPath<T extends Point>(points: T[], bounds: InkClipRect, hidden: InkClipRect[] = []): T[][] {
  const paths: T[][] = [];
  let path: T[] = [];
  const finish = () => { if (path.length) paths.push(path); path = []; };
  const inside = (p: Point, r: InkClipRect) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return paths;
  if (points.length === 1) return inside(points[0], bounds) && !hidden.some(r => inside(points[0], r)) ? [[points[0]]] : [];
  const interval = (a: Point, b: Point, r: InkClipRect): [number, number] | null => {
    let lo = 0, hi = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x-r.left], [dx, r.right-a.x], [-dy, a.y-r.top], [dy, r.bottom-a.y]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return null;
    }
    return [lo, hi];
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i-1], b = points[i];
    const visible = interval(a, b, bounds);
    if (!visible) { finish(); continue; }
    let spans = [visible];
    for (const r of hidden) {
      const cut = interval(a, b, r);
      if (!cut) continue;
      spans = spans.flatMap(([lo, hi]) => {
        if (cut[1] < lo || cut[0] > hi) return [[lo, hi] as [number, number]];
        const remaining: [number, number][] = [];
        if (cut[0] > lo) remaining.push([lo, cut[0]]);
        if (cut[1] < hi) remaining.push([cut[1], hi]);
        return remaining;
      });
    }
    const at = (t: number): T => t === 0 ? a : t === 1 ? b : { ...a, x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t };
    for (const [lo, hi] of spans) {
      const start = at(lo), end = at(hi);
      const last = path[path.length-1];
      if (last && (last.x !== start.x || last.y !== start.y)) finish();
      if (!path.length) path.push(start);
      path.push(end);
      if (hi < 1) finish();
    }
    if (!spans.length) finish();
  }
  finish();
  return paths;
}
