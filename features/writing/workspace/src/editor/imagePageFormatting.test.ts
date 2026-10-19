import {beforeAll,describe,it,expect} from 'vitest';
import {projectSemantic} from './semanticDocument';
import {materializeImagePage} from './imagePageFormatting';
import {createEmptySidecar} from '../sidecar/schema';
import type {InkRegion} from './inkTranscription';
beforeAll(()=>{HTMLCanvasElement.prototype.getContext=(()=>({font:'',measureText:(s:string)=>({width:s.length*8})})) as any;});
const region=(id:string,row:number,x=40):InkRegion=>({id,pageId:'first',runId:id,strokeIds:[id+'-s'],bounds:{x,y:row*56+4,width:80,height:32}});
function fixture(){const sidecar=createEmptySidecar('Test','hash');sidecar.layoutLineHeight=56;sidecar.sourceWords=[{text:'\u200b',x:0,y:0}];return sidecar;}
const ink=(id:string,row:number,x=40)=>({id,blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',intrinsicWidth:80,intrinsicHeight:32,baselineOffset:52,layoutX:x,layoutY:row*56+4,scale:1,createdAt:1,updatedAt:1,strokes:[]});
const run=(md:string,sc:ReturnType<typeof fixture>,refs:InkRegion[])=>materializeImagePage(md,'\u200b',sc,refs,'Test',548,740,56,'result',{measure:s=>s.length*8,space:8});
describe('whole-page Markdown aligned to the saved ruled grid',()=>{
 it('combines same-row typed/ink and retains original blank gaps and row starts',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',2,40),ink('b',5,80)];
  sc.textBoxes=[{id:'typed',blockId:'planning-document',text:'Existing text',x:160,y:112,width:260,size:27,words:[{text:'Existing',x:160,y:112,textStart:0,textEnd:8},{text:'text',x:232,y:112,textStart:9,textEnd:13}]}];
  const before=JSON.stringify(sc),result=run('# Combined row\n\n\n- [x] Completed',sc,[region('a',2),region('b',5,80)]);
  expect(result.sourceRows).toEqual([2,5]);const boxes=result.sheets[0].sidecar.textBoxes!;
  expect(boxes.filter(b=>!b.checkbox).map(b=>[b.y,b.x])).toEqual([[112,40],[280,80]]);
  expect(boxes.find(b=>b.checkbox)).toMatchObject({text:'☑',y:280});
  expect(boxes[0].fontWeight).toBe(700);expect(result.sheets[0].sidecar.inkRuns).toEqual([]);
  expect(boxes.some(b=>b.text==='Existing text')).toBe(false);expect(JSON.stringify(sc)).toBe(before);
 });
 it('uses soft breaks and hard breaks as separate rows while retaining marks',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',1),ink('b',3),ink('c',4)];
  const result=run('**First** line\nSecond line  \n~~Third~~ line',sc,[region('a',1),region('b',3),region('c',4)]);
  expect(result.blocks.map(b=>b.text)).toEqual(['First line','Second line','Third line']);
  expect(result.sheets[0].sidecar.textBoxes!.map(b=>b.y)).toEqual([56,168,224]);
  expect(result.blocks[0].styles?.[0].bold).toBe(true);expect(result.blocks[2].styles?.[0].strike).toBe(true);
 });
 it('keeps nested tasks on their source rows with stable parent and checkbox bindings',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',0),ink('b',1,68),ink('c',2,96)];
  const result=run('- [ ] Main\n  - [x] Child\n    - [ ] Grandchild',sc,[region('a',0),region('b',1,68),region('c',2,96)]);
  expect(result.blocks[1].parentId).toBe(result.blocks[0].id);expect(result.blocks[2].parentId).toBe(result.blocks[1].id);
  expect(result.sheets[0].sidecar.textBoxes!.filter(b=>!b.checkbox).map(b=>[b.x,b.y])).toEqual([[40,0],[68,56],[96,112]]);
 });
 it('supports typed-only pages without retaining duplicate original text',()=>{
  const sc=fixture();sc.sourceWords=[{text:'Old',x:30,y:168},{text:'text',x:70,y:168}];
  const result=materializeImagePage('**Old text**','Old text',sc,[],'Test',548,740,56,'typed',{measure:s=>s.length*8,space:8});
  expect(result.sourceRows).toEqual([3]);expect(result.sheets[0].source).toBe('\u200b');expect(result.sheets[0].sidecar.textBoxes![0]).toMatchObject({text:'Old text',x:30,y:168});
 });
 it('rejects omitted/extra lines and overflow without mutating saved content',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',2),ink('b',4)];const refs=[region('a',2),region('b',4)],before=JSON.stringify(sc);
  for(const md of ['Joined row','One\nTwo\nThree','Verylong '.repeat(100)+'\nLast'])expect(()=>run(md,sc,refs)).toThrow();
  expect(JSON.stringify(sc)).toBe(before);
 });
 it('retains drawings and rejects replacement text that would cover one',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',2)];sc.pageObjects=[{id:'shape',kind:'rectangle',x:400,y:350,width:30,height:30,color:'#000',strokeWidth:2}];
  expect(run('Text',sc,[region('a',2)]).sheets[0].sidecar.pageObjects).toEqual(sc.pageObjects);
  sc.pageObjects[0].x=40;sc.pageObjects[0].y=112;expect(()=>run('Text',sc,[region('a',2)])).toThrow('overlap');
 });
 it('rejects checkbox loss or changed checked state at the same original row',()=>{
  const sc=fixture();sc.textBoxes=[{id:'task',blockId:'planning-document',text:'Milk',x:40,y:112,width:260,size:27},{id:'check',blockId:'planning-document',text:'☑',checkbox:true,x:450,y:112,width:36,size:27}];
  expect(()=>run('- [ ] Milk',sc,[])).toThrow('checkbox');expect(()=>run('Milk',sc,[])).toThrow('checkbox');
  expect(run('- [x] Milk',sc,[]).sheets[0].sidecar.textBoxes!.find(b=>b.checkbox)?.text).toBe('☑');
 });
 it('rejects a single oversized word instead of allowing it beyond the page edge',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',2,450)];expect(()=>run('Oversizedword',sc,[region('a',2,450)])).toThrow('wide');
 });

 it('preserves explicit numbered markers and nested restarts as editable text',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',1),ink('b',2),ink('c',3),ink('d',4)];
  const result=run('7. **Seven**\n   1) Child\n   9) Other\n8. Eight',sc,[region('a',1),region('b',2),region('c',3),region('d',4)]);
  const boxes=result.sheets[0].sidecar.textBoxes!;
  expect(boxes.map(b=>b.text)).toEqual(['7. Seven','1) Child','9) Other','8. Eight']);
  expect(boxes.map(b=>b.y)).toEqual([56,112,168,224]);
  expect(result.blocks[0].styles).toEqual([{start:3,end:8,bold:true}]);
  expect(projectSemantic(result.sheets[0].source,JSON.parse(JSON.stringify(result.sheets[0].sidecar)),'first')).toEqual(result.blocks);
 });
 it('rejects multiple same-state checkboxes on one row without mutating the original',()=>{
  const sc=fixture();sc.textBoxes=[{id:'task',blockId:'planning-document',text:'Milk Eggs',x:40,y:112,width:260,size:27},
   ...[100,450].map((x,i)=>({id:'check-'+i,blockId:'planning-document',text:'☑',checkbox:true,x,y:112,width:36,size:27}))];
  const original=JSON.stringify(sc);expect(()=>run('- [x] Milk Eggs',sc,[])).toThrow('Multiple checkboxes');expect(JSON.stringify(sc)).toBe(original);
 });
 it('keeps continuation rows ahead of nested children with a matching saved projection',()=>{
  const sc=fixture();sc.inkRuns=[ink('a',1),ink('b',3),ink('c',4)];
  const result=run('- [ ] Parent\n  continuation\n  - Child',sc,[region('a',1),region('b',3),region('c',4)]);
  const sheet=result.sheets[0];
  expect(sheet.sidecar.textBoxes!.filter(b=>!b.checkbox).map(b=>[b.text,b.y])).toEqual([['Parent',56],['continuation',168],['• Child',224]]);
  expect(projectSemantic(sheet.source,JSON.parse(JSON.stringify(sheet.sidecar)),'first')).toEqual(result.blocks);
 });

});
