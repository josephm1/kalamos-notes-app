/** Closed lasso hit testing in page coordinates. Boundary contact counts as a hit. */
export type Point = { x: number; y: number };
function onSegment(p: Point, a: Point, b: Point) {
  const cross = (p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
  return Math.abs(cross) < 1e-7 && p.x >= Math.min(a.x,b.x)-1e-7 && p.x <= Math.max(a.x,b.x)+1e-7 && p.y >= Math.min(a.y,b.y)-1e-7 && p.y <= Math.max(a.y,b.y)+1e-7;
}
function intersects(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  return onSegment(a,c,d) || onSegment(b,c,d) || onSegment(c,a,b) || onSegment(d,a,b) || (side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0);
}
export function validLasso(polygon: Point[]) {
  return polygon.length >= 3 && Math.max(...polygon.map(p=>p.x))-Math.min(...polygon.map(p=>p.x)) >= 4 && Math.max(...polygon.map(p=>p.y))-Math.min(...polygon.map(p=>p.y)) >= 4;
}
export function pointInLasso(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[j], b=polygon[i];
    if (onSegment(p,a,b)) return true;
    if ((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function strokeHitsLasso(points: Point[], polygon: Point[]) {
  if (!validLasso(polygon)) return false;
  if (points.some(p=>pointInLasso(p,polygon))) return true;
  for (let k=1;k<points.length;k++) for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) if(intersects(points[k-1],points[k],polygon[j],polygon[i])) return true;
  return false;
}
