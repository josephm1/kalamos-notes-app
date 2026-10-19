import { boundsOfPoints, type InkStroke } from '../ink/types';
import type { PageObject } from './pageObjects';

/** A white shape is a free ink owner, not a ruled lane. Coordinates stay relative
 * to its top-left so movement never re-groups letters or changes stroke width. */
export function isPaperObject(o: PageObject) { return o.kind !== 'line' && o.kind !== 'sketch' && o.paper !== false; }
export function objectContains(o: PageObject, p: {x:number;y:number}) {
 const x=(p.x-o.x)/o.width*100,y=(p.y-o.y)/o.height*100;
 if(x<0||x>100||y<0||y>100)return false;
 if(o.kind==='ellipse')return ((x-50)/50)**2+((y-50)/50)**2<=1;
 if(o.kind==='triangle')return y>=Math.abs(x-50)*2;
 if(['star','pentagon','hexagon','trapezoid'].includes(o.kind)) {
  const vertices=Array.from({length:10},(_,i)=>{const a=i*Math.PI/5-Math.PI/2,r=i%2?22:50;return {x:50+Math.cos(a)*r,y:50+Math.sin(a)*r};});
  const polygon=o.kind==='star'?vertices:o.kind==='trapezoid'?[{x:20,y:0},{x:80,y:0},{x:100,y:100},{x:0,y:100}]:Array.from({length:o.kind==='pentagon'?5:6},(_,i)=>{const a=i*Math.PI*2/(o.kind==='pentagon'?5:6)-Math.PI/2;return {x:50+50*Math.cos(a),y:50+50*Math.sin(a)};});
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {const a=polygon[i],b=polygon[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;}
  return inside;
 }
 return o.kind==='rectangle';
}
export function objectInkOnPage(o:PageObject):InkStroke[] {
 return (o.ink??[]).map(s=>({...s,points:s.points.map(p=>({...p,x:p.x+o.x,y:p.y+o.y})),bounds:{...s.bounds,x:s.bounds.x+o.x,y:s.bounds.y+o.y}}));
}
/** Resize the paper around its content. Do not shrink it through saved handwriting. */
export function objectMinimumSize(o:PageObject) {
 const b=boundsOfPoints((o.ink??[]).flatMap(s=>s.points),6);
 return {width:Math.max(12,b.x+b.width),height:Math.max(12,b.y+b.height)};
}
/** Native vectors are drawn over the captured paper. Mask earlier ink against
 * opaque shapes so it cannot leak through their white background. Split paths;
 * never join across a hidden section or mutate the saved original vectors. */
export function maskObjectInk<T extends {x:number;y:number;pressure?:number}>(points:T[], objects:PageObject[]):T[][] {
 if(!points.length)return [];
 const left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y));
 const bounds={x:left,y:top,width:Math.max(...points.map(p=>p.x))-left,height:Math.max(...points.map(p=>p.y))-top};
 objects=objects.filter(o=>isPaperObject(o) && o.x<=bounds.x+bounds.width && o.x+o.width>=bounds.x && o.y<=bounds.y+bounds.height && o.y+o.height>=bounds.y);
 if(!objects.length)return [points];
 const visible=(p:T)=>!objects.some(o=>isPaperObject(o)&&objectContains(o,p));
 const paths:T[][]=[];let path:T[]=[];
 const finish=()=>{if(path.length)paths.push(path);path=[];};
 if(points.length===1)return visible(points[0])?[points]:[];
 for(let i=1;i<points.length;i++) {
  const a=points[i-1],b=points[i];
  const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/2));
  for(let n= i===1?0:1;n<=steps;n++) {
   const t=n/steps,p={...a,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
   if(a.pressure!==undefined && b.pressure!==undefined)p.pressure=a.pressure+(b.pressure-a.pressure)*t;
   if(visible(p))path.push(p);else finish();
  }
 }
 finish();return paths;
}
