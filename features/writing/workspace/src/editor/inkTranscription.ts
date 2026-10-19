import type { Sidecar, TextBox } from '../sidecar/schema';
import type { Bounds, InlineInkRun } from '../ink/types';
import { boundsOfPoints } from '../ink/types';
import { freeInkLaneIndex } from './inkPlacement';
import { type SemanticBlock, ruledTextMeasure } from './semanticDocument';
import { placeBoxWords, ruledTextSize } from './textBox';
import { semanticDepths, semanticOrder } from './semanticHierarchy';
import { normalizeInlineStyles, styleFont } from './inlineStyles';
import { measureStyledText, ruledTextFont } from './textBox';

/** Local, revision-bound metadata from Notes. Models only return these region IDs. */
export type InkRegion = { id:string; pageId:string; runId:string; strokeIds:string[]; bounds:Bounds };
export type TranscriptionBlock = SemanticBlock & { sourceInkRegionIds:string[] };
export type TranscriptionSheet = { pageId:string; source:string; sidecar:Sidecar };
export type TranscriptionGeometry = { width:number; height:number; lineHeight:number; measure?:(text:string)=>number; space?:number; sourceLines?:boolean };
const overlap=(a:Bounds,b:Bounds)=>a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
const localBounds=(run:InlineInkRun)=>boundsOfPoints(run.strokes.flatMap(s=>s.points),4);
function runBounds(run:InlineInkRun):Bounds {
 if(run.layoutX===undefined||run.layoutY===undefined)throw new Error('Save this page before replacing handwriting.');
 return {x:run.layoutX,y:run.layoutY,width:localBounds(run).width,height:localBounds(run).height};
}
/** Replace referenced vectors in one saved page. No layout mutation of unrelated content. */
export function materializeTranscriptionPage(sheet:TranscriptionSheet,blocks:TranscriptionBlock[],regions:InkRegion[],geometry:TranscriptionGeometry):TranscriptionSheet {
 const {sidecar}=sheet,h=geometry.lineHeight,measure=geometry.measure??ruledTextMeasure(h);
 const headingMeasure=geometry.measure??ruledTextMeasure(h,'heading');
 if(!Number.isFinite(h)||h<24||!Number.isFinite(geometry.width)||!Number.isFinite(geometry.height))throw new Error('Invalid notebook geometry.');
 const byId=new Map(regions.map(r=>[r.id,r]));
 if(byId.size!==regions.length)throw new Error('Duplicate handwriting region.');
 const remove=new Map<string,Set<string>>();
 const boxIds=new Set((sidecar.textBoxes??[]).map(b=>b.id));
 const semanticIds=new Set((sidecar.textBoxes??[]).flatMap(b=>b.semantic?[b.semantic.id]:[]));
 for(const block of blocks){
  if(!block.text.trim()||!block.sourceInkRegionIds?.length||new Set(block.sourceInkRegionIds).size!==block.sourceInkRegionIds.length)throw new Error('Transcription needs readable text and exact handwriting references.');
  if(semanticIds.has(block.id))throw new Error('Transcription element identity already exists.');
  semanticIds.add(block.id);
  for(const ref of block.sourceInkRegionIds){
   const region=byId.get(ref);
   if(!region||region.pageId!==sheet.pageId)throw new Error('Handwriting region is unavailable on this page.');
   const b=region.bounds;
   if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0||b.x+b.width<=0||b.y+b.height<=0||b.x>=geometry.width||b.y>=geometry.height||!region.strokeIds.length||new Set(region.strokeIds).size!==region.strokeIds.length)throw new Error('Invalid handwriting region.');
   const run=sidecar.inkRuns.find(r=>r.id===region.runId);
   if(!run||region.strokeIds.some(id=>!run.strokes.some(s=>s.id===id)))throw new Error('Handwriting changed. Attach the current page again.');
   if(!remove.has(run.id))remove.set(run.id,new Set());
   for(const id of region.strokeIds)remove.get(run.id)!.add(id);
  }
 }
 const remaining=sidecar.inkRuns.flatMap(run=>{
  const selected=remove.get(run.id);if(!selected)return [run];
  const strokes=run.strokes.filter(s=>!selected.has(s.id));if(!strokes.length)return [];
  const old=localBounds(run),next=localBounds({...run,strokes}),dx=next.x-old.x,dy=next.y-old.y;
  runBounds(run); // Partial run edits need a settled visual origin.
  return [{...run,strokes,layoutX:run.layoutX!+dx,layoutY:run.layoutY!+dy,intrinsicWidth:next.width,intrinsicHeight:next.height,baselineOffset:run.baselineOffset-dy}];
 });
 const occupied:Bounds[]=[...remaining,...sidecar.unplacedInk].map(runBounds);
 occupied.push(...(sidecar.pageObjects??[]).map(o=>({x:o.x,y:o.y,width:o.width,height:o.height})));
 for(const box of sidecar.textBoxes??[]){
  const boxMeasure=box.fontWeight===700?headingMeasure:measure;
  const boxSpace=geometry.space??Math.max(4,boxMeasure('x x')-2*boxMeasure('x'));
  const context=box.styles?.length?document.createElement('canvas').getContext('2d'):null;
  if(box.styles?.length&&!context)throw Error('Styled text measurement is unavailable');
  const rangeMeasure=(value:string,start:number)=>box.styles?.length?measureStyledText(box.text,box.styles,start,start+value.length,(part,mark)=>{context!.font=styleFont(ruledTextFont(h,box.fontWeight===700?'heading':undefined),mark);return context!.measureText(part).width;}):boxMeasure(value);
  const words=box.words??placeBoxWords(box.text,box.x,box.y,box.width,h,boxMeasure,boxSpace,rangeMeasure);
  occupied.push(...words.map(w=>({x:w.x,y:w.y,width:rangeMeasure(w.text,w.textStart??0),height:h})));
 }
 if(sheet.source.replace(/\u200b/g,'').trim()&&!sidecar.sourceWords)throw new Error('Save typed page text before replacing handwriting.');
 occupied.push(...(sidecar.sourceWords??[]).filter(w=>w.text.replace(/\u200b/g,'').trim()).map(w=>({x:w.x,y:w.y,width:measure(w.text),height:h})));
 const added:TextBox[]=[],nextRow=new Map<string,number>();let number=0;
 const refCounts=new Map<string,number>();
 for(const block of blocks)for(const ref of block.sourceInkRegionIds)refCounts.set(ref,(refCounts.get(ref)??0)+1);
 const flow=!geometry.sourceLines&&Array.from(refCounts.values()).some(count=>count>1);
 const placed:(Bounds&{sourceRow:number})[]=[];
 const depths=semanticDepths(blocks);let flowRow=0;
 // Original ruled rows and within-row source order belong to the editor, not
 // to the sequence in which a model happened to emit its tool arguments.
 const anchors=new Map(blocks.map(block=>{
  const refs=block.sourceInkRegionIds.map(id=>byId.get(id)!);
  return [block.id,{row:Math.min(...refs.map(r=>freeInkLaneIndex(r.bounds.y,r.bounds.height,h))),x:Math.min(...refs.map(r=>r.bounds.x))}];
 }));
 const ordered=flow?semanticOrder(blocks):[...blocks].sort((a,b)=>{
  const left=anchors.get(a.id)!,right=anchors.get(b.id)!;
  return left.row-right.row||left.x-right.x;
 });
 for(const block of ordered){
  const blockMeasure=block.type==='heading'?headingMeasure:measure;
  const blockSpace=geometry.space??Math.max(4,blockMeasure('x x')-2*blockMeasure('x'));
  const refs=block.sourceInkRegionIds.map(id=>byId.get(id)!);
  const anchorX=Math.max(0,Math.min(...refs.map(r=>r.bounds.x)));
  const row=Math.max(Math.min(...refs.map(r=>freeInkLaneIndex(r.bounds.y,r.bounds.height,h))),flow?flowRow:0,...refs.map(r=>geometry.sourceLines?0:nextRow.get(r.id)??0));
  const y=row*h, right=geometry.width-60;
  if(geometry.sourceLines&&placed.some(b=>b.sourceRow!==row&&b.y<y+h&&b.y+b.height>y))throw Error('Markdown text wraps into another source line. Your original ink is retained.');
  // Preserve ruled-line and word order, not the original handwriting's x coordinate.
  // Unconverted words to the left remain before this text; later words limit its width.
  const prefixContent=occupied.filter(b=>b.x<anchorX && b.y<y+h && b.y+b.height>y);
  if(geometry.sourceLines)prefixContent.push(...placed.filter(b=>b.y<y+h&&b.y+b.height>y));
  const x=flow?16+(depths.get(block.id)??0)*h/2:Math.max(16+(geometry.sourceLines?(depths.get(block.id)??0)*h/2:0),...prefixContent.map(b=>b.x+b.width+4));
  // A neighbour on the target row limits wrapping width; lower occupied lanes remain obstacles.
  const neighbours=occupied.filter(b=>b.x>x&&b.y<y+h&&b.y+b.height>y);
  const width=Math.min(right,...neighbours.map(b=>b.x-4))-x;
  if(width<24)throw new Error('Transcription does not fit beside existing content. Add space or select surrounding handwriting.');
  const prefix=block.type==='bullet'?'• ':block.type==='numbered'?`${++number}. `:'';
  const text=prefix+block.text,styles=normalizeInlineStyles(block.text,block.styles??[]).map(mark=>({...mark,start:mark.start+prefix.length,end:mark.end+prefix.length}));
  const context=styles.length?document.createElement('canvas').getContext('2d'):null;
  if(styles.length&&!context)throw Error('Styled text measurement is unavailable');
  const styledMeasure=(value:string,start:number)=>styles.length?measureStyledText(text,styles,start,start+value.length,(part,mark)=>{context!.font=styleFont(ruledTextFont(h,block.type),mark);return context!.measureText(part).width;}):blockMeasure(value);
  const words=placeBoxWords(text,x,y,width,h,blockMeasure,blockSpace,styledMeasure);
  const rects=words.map(w=>({x:w.x,y:w.y,width:styledMeasure(w.text,w.textStart??0),height:h}));
  const checkbox=block.type==='task'?{x:geometry.width-44,y,width:36,height:h}:null;
  if(rects.some(r=>r.y+r.height>geometry.height||r.x+r.width>right||occupied.some(o=>overlap(r,o))) || checkbox&&occupied.some(o=>overlap(checkbox,o)))throw new Error('Transcription does not fit without covering existing content. Add space or select surrounding handwriting.');
  const id=`semantic-${block.id}`,checkId=`check-${block.id}`;
  if(boxIds.has(id)||block.type==='task'&&boxIds.has(checkId))throw new Error('Transcription element identity already exists.');
  boxIds.add(id);boxIds.add(checkId);
  const semantic={id:block.id,type:block.type,role:'text' as const,sourceInkRegionIds:[...block.sourceInkRegionIds],...(block.parentId?{parentId:block.parentId}:{})};
  added.push({id,blockId:'planning-document',text,x,y,width,size:ruledTextSize(h),autoWidth:false,...(block.type==='heading'?{fontWeight:700 as const}:{}),...(styles.length?{styles}:{}),words,semantic});
  if(checkbox)added.push({id:checkId,blockId:'planning-document',text:block.checked?'☑':'☐',checkbox:true,...checkbox,size:ruledTextSize(h),semantic:{...semantic,role:'checkbox'}});
  occupied.push(...rects,...(checkbox?[checkbox]:[]));
  placed.push(...rects.map(rect=>({...rect,sourceRow:row})));
  const end=Math.max(row,...words.map(w=>Math.round(w.y/h)))+1;
  for(const ref of refs)nextRow.set(ref.id,end);
  if(flow)flowRow=end;
 }
 return {...sheet,sidecar:{...sidecar,inkRuns:remaining,textBoxes:[...(sidecar.textBoxes??[]),...added]}};
}
