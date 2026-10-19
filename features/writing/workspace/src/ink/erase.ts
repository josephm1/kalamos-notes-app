import { boundsOfPoints, type InkPoint, type InkStroke } from './types';
import { strokeHitsPoint } from './geometry';
export type EraseMode = 'stroke' | 'pixel';

/** Cut vector segments at the circular tip, including sparse segments whose endpoints are
 * outside. Surviving fragments keep page coordinates, pressure, timing and pen width; joining
 * the two sides would paint erased pixels back on the next native replay/export. */
export function eraseStrokeAtPoint(stroke: InkStroke, x: number, y: number, radius: number, mode: EraseMode): InkStroke[] {
  if (!strokeHitsPoint(stroke.points, x, y, radius, stroke.width)) return [stroke];
  if (mode === 'stroke') return [];
  const r = Math.max(0, radius) + stroke.width / 2;
  const paths: InkPoint[][] = [];
  let path: InkPoint[] = [];
  const finish = () => { if (path.length) paths.push(path); path = []; };
  const outside = (p: InkPoint) => Math.hypot(p.x-x,p.y-y) >= r;
  if (stroke.points.length === 1) return outside(stroke.points[0]) ? [stroke] : [];
  for (let i=1;i<stroke.points.length;i++) {
    const a=stroke.points[i-1], b=stroke.points[i], dx=b.x-a.x, dy=b.y-a.y;
    const ox=a.x-x, oy=a.y-y, aa=dx*dx+dy*dy;
    const bb=2*(ox*dx+oy*dy), cc=ox*ox+oy*oy-r*r;
    const discriminant=bb*bb-4*aa*cc;
    const cuts=[0,1];
    if (aa>0 && discriminant>0) {
      const root=Math.sqrt(discriminant);
      for(const t of [(-bb-root)/(2*aa),(-bb+root)/(2*aa)]) if(t>0&&t<1)cuts.push(t);
    }
    cuts.sort((u,v)=>u-v);
    const at=(t:number):InkPoint=>({...a,x:a.x+dx*t,y:a.y+dy*t,t:a.t+(b.t-a.t)*t,pressure:a.pressure+(b.pressure-a.pressure)*t});
    for(let j=1;j<cuts.length;j++) {
      const lo=cuts[j-1],hi=cuts[j];
      if(!outside(at((lo+hi)/2))) {finish();continue;}
      const start=at(lo),end=at(hi),last=path[path.length-1];
      if(last&&(last.x!==start.x||last.y!==start.y))finish();
      if(!path.length)path.push(start);
      path.push(end);
    }
  }
  finish();
  return paths.map((points,i)=>({...stroke,id:`${stroke.id}-cut-${i}`,points,bounds:boundsOfPoints(points)}));
}
