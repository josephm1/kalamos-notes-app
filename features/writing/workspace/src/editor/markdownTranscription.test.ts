import {describe,it,expect} from 'vitest';
import {bindMarkdownToInk,bindMarkdownResultToInk,parseNotesMarkdown} from './markdownTranscription';
import {materializeTranscriptionPage,type InkRegion,type TranscriptionSheet} from './inkTranscription';
import {createEmptySidecar} from '../sidecar/schema';
const region=(n:number,row:number):InkRegion=>({id:`ink-${n}`,pageId:'first',runId:`run-${n}`,strokeIds:[`stroke-${n}`],bounds:{x:16,y:row*44+4,width:80,height:28}});
describe('local Markdown handwriting processing',()=>{
 it('ignores harmless trailing comments but never executes or accepts active HTML',()=>{
  expect(parseNotesMarkdown('# Note\n- [ ] Milk\n\n<!-- All items were unchecked on the page. -->').map(b=>b.text)).toEqual(['Note','Milk']);
  expect(()=>parseNotesMarkdown('<img src=x onerror=alert(1)>')).toThrow('Unsupported');
 });
 it('binds the actual failed response with inserted categories and split task label',()=>{
  const md='# To Do\n\n## Shopping\n- [ ] Buy\n  - [ ] milk\n  - [ ] eggs\n  - [ ] oranges\n\n## Errands\n- [ ] Go to Ikea\n\n## Music\n- [ ] Make a new song\n  - [ ] Speak to Dave about guitar\n\n<!-- All items were unchecked on the page. -->';
  const refs=Array.from({length:7},(_,i)=>region(i+1,i));
  const result=bindMarkdownResultToInk(md,refs,44);
  expect(result.blocks).toHaveLength(11);expect(result.sourceLines).toBe(false);
  expect(new Set(result.blocks.flatMap(b=>b.sourceInkRegionIds)).size).toBe(7);
  expect(result.blocks[3].parentId).toBe(result.blocks[2].id);
  expect(result.blocks[10].parentId).toBe(result.blocks[9].id);
 });
 it('preserves styling and nested checkbox tasks without attaching unrelated actions to a heading',()=>{
  const b=parseNotesMarkdown('# To do\n## Buy\n- [ ] **Milk**\n- [x] eggs\n- [ ] Go to Ikea\n- [ ] Make a song\n  - [ ] Speak to Dave');
  expect(b.map(x=>x.text)).toEqual(['To do','Buy','Milk','eggs','Go to Ikea','Make a song','Speak to Dave']);
  expect(b[2].styles).toEqual([{start:0,end:4,bold:true}]);expect(b[3].checked).toBe(true);
  expect(b[4].parentId).toBeUndefined();expect(b[6].parentId).toBe(b[5].id);
 });
 it('binds Markdown reading order to nonconsecutive saved source rows, combining same-row ink regions',()=>{
  const refs=[region(2,6),{...region(3,2),bounds:{x:120,y:92,width:40,height:28}},region(1,2)];
  expect(bindMarkdownToInk('- [ ] Milk\n\n- [ ] eggs',refs,44).map(b=>b.sourceInkRegionIds)).toEqual([['ink-1','ink-3'],['ink-2']]);
 });
 it('shares the original Buy-Milk line for a split label and first task',()=>{
  const refs=[region(1,0),region(2,2),region(3,3),region(4,5)];
  expect(bindMarkdownToInk('# To do\n## Buy\n- [ ] Milk\n- [ ] eggs\n- [ ] Go to Ikea',refs,44).map(b=>b.sourceInkRegionIds)).toEqual([['ink-1'],['ink-2'],['ink-2'],['ink-3'],['ink-4']]);
 });
 it('restores joined prose source lines without changing words, styling or later task references',()=>{
  const refs=[region(1,0),{...region(2,0),bounds:{x:140,y:4,width:90,height:28}},region(3,1),{...region(4,1),bounds:{x:140,y:48,width:130,height:28}},region(5,2)];
  const bound=bindMarkdownResultToInk('# **hello world what do you make of this**\n\n- [ ] Dog',refs,44);
  expect(bound.blocks.map(b=>b.text)).toEqual(['hello world what','do you make of this','Dog']);
  expect(bound.blocks.slice(0,2).map(b=>b.sourceInkRegionIds)).toEqual([['ink-1','ink-2'],['ink-3','ink-4']]);
  expect(bound.blocks[2].sourceInkRegionIds).toEqual(['ink-5']);
  expect(bound.blocks[0].styles).toEqual([{start:0,end:16,bold:true}]);
  expect(bound.blocks[1].styles).toEqual([{start:0,end:19,bold:true}]);
  expect(bound.sourceLines).toBe(true);
  expect(()=>bindMarkdownResultToInk('# Short title\n\n- [ ] Dog',refs,44)).toThrow('line count');
  const drawingRows=[region(1,0),{...region(3,1),bounds:{x:16,y:48,width:280,height:28}},region(5,2)];
  expect(()=>bindMarkdownResultToInk('# hello world what do you make of this\n\n- [ ] Dog',drawingRows,44)).toThrow('line count');
 });
 it('binds soft-break paragraphs to each source line',()=>{
  expect(bindMarkdownToInk('First line\nSecond line',[region(1,0),region(2,3)],44).map(b=>b.sourceInkRegionIds)).toEqual([['ink-1'],['ink-2']]);
 });
 it('retains originals on omitted/extra lines and unsupported Markdown',()=>{
  const refs=[region(1,0),region(2,1)],before=JSON.stringify(refs);
  expect(()=>bindMarkdownToInk('One',refs,44)).toThrow('line count');
  expect(()=>bindMarkdownToInk('- One\n- Two\n- Three',refs,44)).toThrow('line count');
  expect(()=>parseNotesMarkdown('<script>alert(1)</script>')).toThrow('Unsupported');
  expect(parseNotesMarkdown('[external](https://example.com)')[0]).toMatchObject({text:'external',styles:[{href:'https://example.com'}]});expect(JSON.stringify(refs)).toBe(before);
 });
 it('keeps each source row, editable words and checkboxes, original template, drawing, and source model',()=>{
  const refs=[region(1,0),region(2,2),region(3,3),region(4,5)],sidecar=createEmptySidecar('To do','hash');sidecar.layoutLineHeight=44;
  sidecar.inkRuns=refs.map(r=>({id:r.runId,blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',intrinsicWidth:80,intrinsicHeight:28,baselineOffset:24,layoutX:r.bounds.x,layoutY:r.bounds.y,scale:1,createdAt:1,updatedAt:1,strokes:[{id:r.strokeIds[0],tool:'pen',color:'#000',width:2,points:[{x:0,y:0,t:0,pressure:.5},{x:80,y:24,t:1,pressure:.5}],bounds:{x:0,y:0,width:80,height:24}}]}));
  sidecar.pageObjects=[{id:'drawing',kind:'rectangle',x:300,y:350,width:30,height:30,color:'#000',strokeWidth:2}];
  const sheet:TranscriptionSheet={pageId:'first',source:'\u200b',sidecar},before=JSON.stringify(sheet);
  const blocks=bindMarkdownToInk('# To do\n## Buy\n- [ ] Milk\n- [ ] eggs\n- [ ] Go to Ikea',refs,44);
  const next=materializeTranscriptionPage(sheet,blocks,refs,{width:548,height:740,lineHeight:44,measure:s=>s.length*8,space:8,sourceLines:true});
  const texts=next.sidecar.textBoxes!.filter(b=>!b.checkbox);
  expect(texts.map(b=>b.y)).toEqual([0,88,88,132,220]);expect(texts[2].x).toBeGreaterThan(texts[1].x+24);
  expect(next.sidecar.inkRuns).toEqual([]);expect(next.sidecar.pageObjects).toEqual(sidecar.pageObjects);
  expect(next.sidecar.layoutLineHeight).toBe(44);expect(next.source).toBe(sheet.source);expect(JSON.stringify(sheet)).toBe(before);
  expect(next.sidecar.textBoxes!.filter(b=>b.checkbox)).toHaveLength(3);
 });
});
