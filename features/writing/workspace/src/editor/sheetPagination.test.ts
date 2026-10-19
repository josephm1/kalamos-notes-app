import { expect, it } from 'vitest';
import { paginateSheet, type SheetContent } from './sheetPagination';
import { createEmptySidecar } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';
import type { InlineInkRun } from '../ink/types';
function content(source='\u200b'): SheetContent {
  return {source,sidecar:{...createEmptySidecar('QA',fingerprintOf(source).hash),layoutLineHeight:56,
    sourceWords:[{text:source,x:0,y:0}]}};
}
function run(id:string,y:number,height=50): InlineInkRun {
  return {id,blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',
    intrinsicWidth:80,intrinsicHeight:height,baselineOffset:45,scale:1,layoutX:30,layoutY:y,
    createdAt:1,updatedAt:1,strokes:[{id:`${id}-stroke`,tool:'pen',brushStyle:'brush',color:'#1838D8',width:4,
      bounds:{x:4,y:4,width:72,height:height-8},points:[{x:4,y:4,t:1,pressure:.2},{x:72,y:height-4,t:2,pressure:.9}]}]};
}
it('moves a crossing descender and all words/checklist controls on its lane, without altering ink',()=>{
  const c=content();c.sidecar.inkRuns=[run('keep',10),run('descender',120,70)];
  c.sidecar.textBoxes=[{id:'label',blockId:'planning-document',text:'Friday',x:16,y:112,width:160,size:32,
    words:[{text:'Friday',x:16,y:112}]},{id:'check',blockId:'planning-document',text:'☑',checkbox:true,x:250,y:112,width:36,size:32,
    words:[{text:'☑',x:250,y:112}]}];
  const result=paginateSheet(c,168);
  expect(result).toHaveLength(2);expect(result[0].sidecar.inkRuns.map(r=>r.id)).toEqual(['keep']);
  expect(result[1].sidecar.inkRuns[0].layoutY).toBe(8);
  expect(result[1].sidecar.inkRuns[0].strokes).toEqual(c.sidecar.inkRuns[1].strokes);
  expect(result[1].sidecar.textBoxes!.map(b=>[b.y,b.text])).toEqual([[0,'Friday'],[0,'☑']]);
  expect(c.sidecar.inkRuns[1].layoutY).toBe(120);
});
it('splits a multiline typed box into editable sheet-local words and retains exact source bytes',()=>{
  const c=content('  # First\n\n- second\tthird  ');
  c.sidecar.sourceWords=[{text:'#',x:0,y:0},{text:'First',x:30,y:0},{text:'-',x:0,y:168},
    {text:'second',x:20,y:168},{text:'third',x:100,y:224}];
  c.sidecar.textBoxes=[{id:'long',blockId:'planning-document',text:'one two three',x:24,y:112,width:200,size:32,
    words:[{text:'one',x:24,y:112},{text:'two',x:80,y:112},{text:'three',x:24,y:168}]}];
  const result=paginateSheet(c,168);
  expect(result.map(p=>p.source).join('')).toBe(c.source);
  expect(result[0].sidecar.textBoxes![0].text).toBe('one two ');
  expect(result.flatMap(p=>p.sidecar.textBoxes!.map(b=>b.text)).join('')).toBe('one two three');
  expect(result[1].sidecar.textBoxes![0]).toMatchObject({text:'three',x:24,y:0});
  expect(result[1].sidecar.sourceWords!.map(w=>w.y)).toEqual([0,0,56]);
  expect(result.every(p=>p.sidecar.documentFingerprint===fingerprintOf(p.source).hash)).toBe(true);
});
it('preserves inserted blank rows over several pages, avoids empty trailing pages, and is stable on reopen',()=>{
  const c=content();c.sidecar.inkRuns=[run('last',56*8+2,40)];
  const parts=paginateSheet(c,56*3);
  expect(parts).toHaveLength(3);expect(parts[2].sidecar.inkRuns[0].layoutY).toBe(114);
  expect(parts.every(p=>paginateSheet(p,56*3).length===1)).toBe(true);
  const exact=content();exact.sidecar.inkRuns=[run('last',112,56)];
  expect(paginateSheet(exact,168)).toEqual([exact]);
});
it('moves complete free objects; declines unsafe legacy/mismatched/oversized geometry',()=>{
  const c=content();c.sidecar.pageObjects=[{id:'shape',kind:'rectangle',x:20,y:140,width:60,height:40,color:'#000000',strokeWidth:2}];
  expect(paginateSheet(c,168)[1].sidecar.pageObjects![0].y).toBe(28);
  c.sidecar.pageObjects[0].height=200;expect(paginateSheet(c,168)).toEqual([c]);
  const old=content();old.sidecar.inkRuns=[{...run('legacy',200),layoutY:undefined}];
  expect(paginateSheet(old,168)).toEqual([old]);
  const mismatch=content('one two');expect(paginateSheet(mismatch,168)).toEqual([mismatch]);
});

it('overlapping descenders on successive rows do not chain the whole page into an unbreakable group',()=>{
  const c=content();c.sidecar.inkRuns=Array.from({length:8},(_,i)=>run(`word-${i}`,i*56+10,60));
  const parts=paginateSheet(c,168);
  expect(parts.length).toBeGreaterThan(1);
  const runs=parts.flatMap(p=>p.sidecar.inkRuns);
  expect(runs.map(r=>r.id)).toEqual(c.sidecar.inkRuns.map(r=>r.id));
  expect(runs.every(r=>r.layoutY!>=0 && r.layoutY!+r.intrinsicHeight<=168)).toBe(true);
  expect(parts[0].sidecar.inkRuns.map(r=>r.id)).toEqual(['word-0','word-1']);
});

it('reserves outline clearance for wide ink at the sheet edge',()=>{
  const c=content();const wide=run('wide',112,50);wide.strokes[0].width=16;c.sidecar.inkRuns=[wide];
  const parts=paginateSheet(c,168);expect(parts).toHaveLength(2);
  expect(parts[1].sidecar.inkRuns[0]).toMatchObject({layoutY:0,strokes:[{width:16}]});
});
