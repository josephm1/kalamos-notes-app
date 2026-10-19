import { ruledTextSize } from "./textBox";
/** Free-page objects deliberately do not enter ruled word grouping or spacing.
 * Their vectors are saved in the sidecar and included in snapshots/export/preview. */
export type PageObject = {
  id:string; blockId?:string; kind:'markdown'|'rectangle'|'ellipse'|'line'|'triangle'|'star'|'sketch'|'trapezoid'|'pentagon'|'hexagon';
  /** Read-only Markdown preview. Source is portable content; lines are display only. */
  markdown?:{id:string;source:string;lines:string[]};
  x:number; y:number; width:number; height:number; color:string; strokeWidth:number;
  /** Explicit false means outline-only; missing preserves white paper by default. */
  paper?:boolean; lineStyle?:'solid'|'dotted'|'dashed'; ink?:import('../ink/types').InkStroke[];
  filled?:boolean; points?:{x:number;y:number}[];
};
export function objectPath(o:PageObject):string {
  if((o.kind==='sketch'||o.kind==='line')&&o.points?.length) return (o.points??[]).map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');
  if(o.kind==='line') return 'M0 0L100 100';
  if(o.kind==='trapezoid') return 'M20 0H80L100 100H0Z';
  if(o.kind==='pentagon'||o.kind==='hexagon') {const count=o.kind==='pentagon'?5:6;return Array.from({length:count},(_,i)=>{const a=i*Math.PI*2/count-Math.PI/2;return `${i?'L':'M'}${50+50*Math.cos(a)},${50+50*Math.sin(a)}`;}).join(' ')+'Z';}
  if(o.kind==='triangle') return 'M50 0L100 100L0 100Z';
  if(o.kind==='ellipse') return 'M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z';
  if(o.kind==='star') return Array.from({length:10},(_,i)=>{const a=i*Math.PI/5-Math.PI/2,r=i%2?22:50;return `${i?'L':'M'}${50+Math.cos(a)*r},${50+Math.sin(a)*r}`}).join(' ')+'Z';
  return 'M0 0H100V100H0Z';
}
export function objectSvg(o:PageObject):string {
  if(o.kind==='markdown'&&o.markdown) {
    const escape=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
    const lines=o.markdown.lines,lineHeight=o.height/Math.max(1,lines.length);
    const longest=Math.max(1,...lines.map(line=>line.length));
    const size=Math.min(ruledTextSize(lineHeight),Math.max(1,o.width-16)/(longest*.62));
    return `<svg x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}">${lines.map((line,index)=>`<text x="8" y="${(index+1)*lineHeight-2-size*.23}" font-family="monospace" font-size="${size}" fill="#000" xml:space="preserve">${escape(line)}</text>`).join('')}</svg>`;
  }
  const color=/^#[0-9a-f]{6}$/i.test(o.color)?o.color:'#000000';
  return `<svg x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible"><path d="${objectPath(o)}" fill="${o.kind==='sketch'||o.kind==='line'?'none':o.filled?color:o.paper===false?'none':'#ffffff'}" stroke="${color}" stroke-width="${o.strokeWidth}" ${o.lineStyle==='dotted'?'stroke-dasharray="1 4"':o.lineStyle==='dashed'?'stroke-dasharray="8 5"':''} vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** Closed shapes use contact and current endpoint, not the accumulated trail bounds.
 * Returning toward contact shrinks the shape rather than keeping an earlier excursion. */
export function objectDragBounds(start:{x:number;y:number},end:{x:number;y:number}) {
 const x=Math.max(0,Math.min(start.x,end.x)),y=Math.max(0,Math.min(start.y,end.y));
 return {x,y,width:Math.max(1,Math.max(start.x,end.x)-x),height:Math.max(1,Math.max(start.y,end.y)-y)};
}

/** Canvas thumbnail counterpart of the same read-only SVG preview. */
export function drawMarkdownObject(ctx:CanvasRenderingContext2D,o:PageObject):void {
  if(o.kind!=='markdown'||!o.markdown)return;
  const lines=o.markdown.lines,lineHeight=o.height/Math.max(1,lines.length);
  const longest=Math.max(1,...lines.map(line=>line.length));
  const size=Math.min(ruledTextSize(lineHeight),Math.max(1,o.width-16)/(longest*.62));
  ctx.save();
  ctx.fillStyle='#000000';ctx.font=`${size}px monospace`;ctx.textBaseline='alphabetic';
  lines.forEach((line,index)=>ctx.fillText(line,o.x+8,o.y+(index+1)*lineHeight-2-size*.23));ctx.restore();
}
