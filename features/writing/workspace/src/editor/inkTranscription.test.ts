import {describe,it,expect} from 'vitest';
import {materializeTranscriptionPage,type InkRegion,type TranscriptionSheet} from './inkTranscription';
import {createEmptySidecar} from '../sidecar/schema';
import type {InlineInkRun} from '../ink/types';
export function transcriptionFixture(){
 const run=(id:string,x:number):InlineInkRun=>({id,blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',intrinsicWidth:48,intrinsicHeight:32,baselineOffset:36,layoutX:x,layoutY:52,scale:1,createdAt:1,updatedAt:1,strokes:[{id:id+'-stroke',tool:'pen',color:'#1838D8',width:3,points:[{x:4,y:4,t:1,pressure:.3},{x:44,y:28,t:2,pressure:.8}],bounds:{x:4,y:4,width:40,height:24}}]});
 const sidecar=createEmptySidecar('Note','hash');sidecar.layoutLineHeight=44;sidecar.inkRuns=[run('one',16),run('two',150)];
 sidecar.sourceWords=[{text:'Keep',x:16,y:0}];
 sidecar.textBoxes=[{id:'annotation',blockId:'planning-document',text:'Keep annotation',x:16,y:176,width:200,size:27}];
 sidecar.pageObjects=[{id:'drawing',kind:'rectangle',x:220,y:220,width:50,height:50,color:'#000',strokeWidth:2,ink:[run('draw',0).strokes[0]]}];
 const sheet:TranscriptionSheet={pageId:'first',source:'Keep  \n',sidecar};
 const regions:InkRegion[]=sidecar.inkRuns.map(r=>({id:'region-'+r.id,pageId:'first',runId:r.id,strokeIds:r.strokes.map(s=>s.id),bounds:{x:r.layoutX!,y:r.layoutY!,width:r.intrinsicWidth,height:r.intrinsicHeight}}));
 return {sheet,regions,geometry:{width:320,height:440,lineHeight:44,measure:(s:string)=>Array.from(s).length*8,space:8}};
}
describe('scoped ink transcription',()=>{
 it('replaces one word with editable task while preserving the other word, drawing, source and annotation exactly',()=>{
  const {sheet,regions,geometry}=transcriptionFixture(),before=JSON.stringify(sheet);
  const next=materializeTranscriptionPage(sheet,[{id:'milk',type:'task',text:'Buy  milk',checked:false,sourceInkRegionIds:['region-one']}],regions,geometry);
  expect(JSON.stringify(sheet)).toBe(before);expect(next.source).toBe(sheet.source);
  expect(next.sidecar.inkRuns).toEqual([sheet.sidecar.inkRuns[1]]);
  expect(next.sidecar.pageObjects).toEqual(sheet.sidecar.pageObjects);expect(next.sidecar.textBoxes![0]).toEqual(sheet.sidecar.textBoxes![0]);
  const box=next.sidecar.textBoxes![1];expect(box.text).toBe('Buy  milk');expect(box.y).toBe(44);expect(box.size).toBe(27);
  expect(box.words?.map(w=>w.y)).toEqual([44,44]);expect(box.semantic?.sourceInkRegionIds).toEqual(['region-one']);expect(next.sidecar.textBoxes![2].checkbox).toBe(true);
 });
 it('lets multiple recognized blocks consume one region once and stack on existing ruled lanes',()=>{
  const {sheet,regions,geometry}=transcriptionFixture();
  const next=materializeTranscriptionPage(sheet,[{id:'a',type:'paragraph',text:'One',sourceInkRegionIds:['region-one']},{id:'b',type:'task',text:'Two',checked:true,sourceInkRegionIds:['region-one']}],regions,geometry);
  expect(next.sidecar.inkRuns.map(r=>r.id)).toEqual(['two']);
  expect(next.sidecar.textBoxes!.slice(1).map(b=>b.y)).toEqual([44,88,88]);
 });
 it('rejects unknown refs, changed strokes, identity collisions and overlapping output without changing source',()=>{
  const {sheet,regions,geometry}=transcriptionFixture(),before=JSON.stringify(sheet);
  const block={id:'a',type:'paragraph' as const,text:'Words',sourceInkRegionIds:['missing']};
  expect(()=>materializeTranscriptionPage(sheet,[block],regions,geometry)).toThrow('unavailable');
  expect(()=>materializeTranscriptionPage(sheet,[{...block,sourceInkRegionIds:['region-one']}],[{...regions[0],strokeIds:['gone']}],geometry)).toThrow('changed');
  expect(()=>materializeTranscriptionPage(sheet,[{...block,text:'Text '.repeat(150),sourceInkRegionIds:['region-one']}],regions,geometry)).toThrow('covering');
  expect(JSON.stringify(sheet)).toBe(before);
 });
 it('preserves a partial run survivor at its exact page position',()=>{
  const {sheet,regions,geometry}=transcriptionFixture();const run=sheet.sidecar.inkRuns[0];
  run.strokes.push({...run.strokes[0],id:'survivor',points:run.strokes[0].points.map(p=>({...p,x:p.x+70})),bounds:{x:74,y:4,width:40,height:24}});
  const next=materializeTranscriptionPage(sheet,[{id:'a',type:'paragraph',text:'Word',sourceInkRegionIds:['region-one']}],regions,geometry);
  expect(next.sidecar.inkRuns[0].strokes).toEqual([run.strokes[1]]);
  expect(next.sidecar.inkRuns[0].layoutX).toBe(86);
  expect(next.sidecar.inkRuns[0].layoutY).toBe(run.layoutY);
 });
 it('accepts visible ink crossing the page edge, clamps text placement and rejects wholly off-page regions',()=>{
  const {sheet,regions,geometry}=transcriptionFixture();
  sheet.source='\u200b';sheet.sidecar.sourceWords=[];
  regions[0].bounds={x:-3,y:-4,width:48,height:32};
  const block={id:'edge-title',type:'heading' as const,text:'To do',sourceInkRegionIds:['region-one']};
  const next=materializeTranscriptionPage(sheet,[block],regions,{...geometry});
  expect(next.sidecar.textBoxes![next.sidecar.textBoxes!.length-1].x).toBe(16);
  expect(next.sidecar.textBoxes![next.sidecar.textBoxes!.length-1].y).toBe(0);
  expect(next.sidecar.inkRuns.map(run=>run.id)).toEqual(['two']);
  expect(()=>materializeTranscriptionPage(sheet,[block],[{...regions[0],bounds:{x:-60,y:0,width:48,height:32}}],geometry)).toThrow('Invalid');
 });
});

it('transcription starts naturally on its original ruled line and retains word order',()=>{
 const {sheet,regions,geometry}=transcriptionFixture();sheet.source='\u200b';sheet.sidecar.sourceWords=[];sheet.sidecar.textBoxes=[];sheet.sidecar.inkRuns=[sheet.sidecar.inkRuns[0]];
 regions[0].bounds.x=170;
 const next=materializeTranscriptionPage(sheet,[{id:'line',type:'paragraph',text:'Buy milk and eggs',sourceInkRegionIds:['region-one']}],[regions[0]],geometry);
 const box=next.sidecar.textBoxes![0];expect(box.x).toBe(16);expect(box.y).toBe(44);expect(box.words!.map(w=>w.text)).toEqual(['Buy','milk','and','eggs']);expect(box.words!.every(w=>w.y===44)).toBe(true);
});
it('same-line word blocks stay ordered after unconverted earlier words',()=>{
 const {sheet,regions,geometry}=transcriptionFixture();sheet.source='\u200b';sheet.sidecar.sourceWords=[];sheet.sidecar.textBoxes=[];
 const next=materializeTranscriptionPage(sheet,[{id:'first',type:'paragraph',text:'Milk',sourceInkRegionIds:['region-one']},{id:'second',type:'paragraph',text:'eggs',sourceInkRegionIds:['region-two']}],regions,geometry);
 const boxes=next.sidecar.textBoxes!;expect(boxes[0].y).toBe(44);expect(boxes[1].y).toBe(44);expect(boxes[1].x).toBeGreaterThan(boxes[0].x+32);expect(boxes.map(b=>b.text)).toEqual(['Milk','eggs']);
});
it('the editor restores ruled source order when a model emits same-line blocks backwards',()=>{
 const {sheet,regions,geometry}=transcriptionFixture();sheet.source='\u200b';sheet.sidecar.sourceWords=[];sheet.sidecar.textBoxes=[];
 regions[1].bounds.y=48; // Different glyph bounds, same owning ruled lane.
 const blocks=[{id:'second',type:'paragraph' as const,text:'eggs',sourceInkRegionIds:['region-two']},
  {id:'first',type:'paragraph' as const,text:'Milk',sourceInkRegionIds:['region-one']}];
 const before=JSON.stringify(blocks);
 const next=materializeTranscriptionPage(sheet,blocks,regions,geometry);
 expect(JSON.stringify(blocks)).toBe(before);
 const boxes=next.sidecar.textBoxes!;
 expect(boxes.map(b=>b.text)).toEqual(['Milk','eggs']);expect(boxes.map(b=>b.y)).toEqual([44,44]);
 expect(boxes[1].x).toBeGreaterThan(boxes[0].x+32);
});
