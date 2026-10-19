import {beforeAll,describe,it,expect} from 'vitest';
import {materializeSemantic,projectSemantic,synchronizeTaskControls,copySemanticBindings} from './semanticDocument';
import {paginateSheet} from './sheetPagination';
import {validateSidecar} from '../sidecar/schema';
import {parseInlineMarkdown} from './inlineStyles';
beforeAll(()=>{(HTMLCanvasElement.prototype as unknown as {getContext:()=>unknown}).getContext=()=>({font:'',measureText:(text:string)=>({width:Array.from(text).length*8})});});
describe('editable semantic documents',()=>{
 it('materializes task controls and derives edited text and state from the real editor',()=>{
  const [sheet]=materializeSemantic([{id:'task-1',type:'task',text:'Buy milk',checked:false}],'Shopping',600,800);
  expect(sheet.sidecar.textBoxes?.find(b=>b.checkbox)?.text).toBe('☐');
  sheet.sidecar.textBoxes!.find(b=>b.checkbox)!.text='☑';sheet.sidecar.textBoxes!.find(b=>!b.checkbox)!.text='Buy oat milk';
  expect(projectSemantic(sheet.source,sheet.sidecar,'first')).toEqual([{id:'task-1',type:'task',text:'Buy oat milk',checked:true}]);
  const validated=validateSidecar(JSON.parse(JSON.stringify(sheet.sidecar)));
  expect(validated.ok&&validated.sidecar.textBoxes?.[0].semantic?.id).toBe('task-1');
 });
 it('has readable headings/lists without literal Markdown syntax',()=>{
  const [sheet]=materializeSemantic([{id:'h',type:'heading',text:'Shopping'},{id:'b',type:'bullet',text:'Milk'},{id:'n',type:'numbered',text:'Bread'}],'List',600,800);
  expect(sheet.sidecar.textBoxes?.map(b=>b.text)).toEqual(['Shopping','• Milk','1. Bread']);
  expect(projectSemantic(sheet.source,sheet.sidecar,'first').map(b=>b.text)).toEqual(['Shopping','Milk','Bread']);
 });
 it('clips marked ranges during pagination and strips only the first bullet prefix on projection',()=>{
  const marked=parseInlineMarkdown('Buy **milk milk milk milk milk milk milk milk**');
  const sheets=materializeSemantic([{id:'b',type:'bullet',...marked}],'Styles',180,120,44,{paperWidth:180,paperHeight:88});
  const boxes=sheets.flatMap(s=>s.sidecar.textBoxes!.filter(b=>!b.checkbox));
  expect(boxes.length).toBeGreaterThan(1);
  const projected=sheets.flatMap(s=>projectSemantic(s.source,s.sidecar,'first'));
  expect(projected.map(b=>b.text).join('')).toBe(marked.text);
  let offset=0;const styles=projected.flatMap(b=>{const at=offset;offset+=b.text.length;return (b.styles??[]).map(mark=>({...mark,start:mark.start+at,end:mark.end+at}));});
  expect(styles[0].start).toBe(4);expect(styles[styles.length-1].end).toBe(marked.text.length);
  for(const sheet of sheets){const pieces=paginateSheet(sheet,44);expect(pieces.flatMap(p=>p.sidecar.textBoxes??[]).every(b=>(b.styles??[]).every(mark=>mark.end<=b.text.length))).toBe(true);}
 });
 it('paginates while preserving logical bindings',()=>{
  const blocks=Array.from({length:40},(_,i)=>({id:'task-'+i,type:'task' as const,text:'Task '+i,checked:i===7}));
  const sheets=materializeSemantic(blocks,'List',600,500);expect(sheets.length).toBeGreaterThan(1);
  expect(sheets.flatMap(s=>projectSemantic(s.source,s.sidecar,'p')).map(b=>b.id)).toEqual(blocks.map(b=>b.id));
  const first=sheets[0];const parts=paginateSheet(first,112);
  expect(parts.flatMap(s=>s.sidecar.textBoxes??[]).filter(b=>b.semantic?.role==='text').map(b=>b.semantic!.id)).toEqual(first.sidecar.textBoxes!.filter(b=>!b.checkbox).map(b=>b.semantic!.id));
 });
 it('keeps a short grouped checklist on one ruled page without invented blank rows',()=>{
  const blocks=[{id:'title',type:'heading' as const,text:'To do'},{id:'buy',type:'heading' as const,text:'Buy'},
   ...Array.from({length:6},(_,i)=>({id:'task-'+i,type:'task' as const,text:'Task '+i,checked:i===0,parentId:'buy'}))];
  const sheets=materializeSemantic(blocks,'To do',548,740,56,{paperWidth:548,paperHeight:740});
  expect(sheets).toHaveLength(1);
  expect(sheets[0].sidecar.textBoxes!.filter(b=>!b.checkbox).map(b=>b.y)).toEqual(blocks.map((_,i)=>i*56));
  expect(projectSemantic(sheets[0].source,sheets[0].sidecar,'first')).toEqual(blocks);
 });
 it('moving/deleting task text moves/removes only its paired control',()=>{
  const [sheet]=materializeSemantic([{id:'task',type:'task',text:'Move',checked:true}],'List',600,800);
  const boxes=sheet.sidecar.textBoxes!;boxes[0].y=224;boxes[0].words=undefined;
  expect(synchronizeTaskControls(boxes)[1].y).toBe(224);
  expect(synchronizeTaskControls(boxes.slice(1))).toEqual([]);
 });
 it('page copies assign fresh semantic identity while retaining task pairing',()=>{
  const [sheet]=materializeSemantic([{id:'task',type:'task',text:'Copy',checked:true}],'List',600,800);
  const copy=copySemanticBindings(sheet.sidecar,()=> 'new-task');
  expect(copy.textBoxes?.map(b=>b.semantic?.id)).toEqual(['new-task','new-task']);
  expect(sheet.sidecar.textBoxes?.[0].semantic?.id).toBe('task');
 });
 it('does not mutate unrelated shapes or sidecars during projection',()=>{
  const [sheet]=materializeSemantic([{id:'p',type:'paragraph',text:'Idea'}],'Note',600,800);
  sheet.sidecar.pageObjects=[{id:'shape',kind:'rectangle',x:1,y:1,width:10,height:10,color:'#000000',strokeWidth:1}];
  const before=JSON.stringify(sheet.sidecar);projectSemantic(sheet.source,sheet.sidecar,'first');expect(JSON.stringify(sheet.sidecar)).toBe(before);
 });
});

it('keeps exact whitespace, explicit blank lines and unsplit token text through measured pagination',()=>{
 const text='  Plan  now\n\nhttps://example.test/'+ 'long'.repeat(70)+'\n😀😀😀  done  ';
 const sheets=materializeSemantic([{id:'p',type:'paragraph',text}],'Exact',320,280,44,{measure:s=>Array.from(s).length*8,space:8,paperWidth:296,paperHeight:220});
 const boxes=sheets.flatMap(s=>s.sidecar.textBoxes!.filter(b=>!b.checkbox));
 expect(boxes.map(b=>b.text).join('')).toBe(text);
 expect(boxes.slice(1).every(b=>b.semantic?.continuation)).toBe(true);
 for(const box of boxes){
  expect(box.size).toBe(27);
  expect(box.words!.every(w=>w.y%44===0&&w.y<220&&w.x+Array.from(w.text).length*8<=228)).toBe(true);
  expect(box.words!.every(w=>box.text.slice(w.textStart,w.textEnd)===w.text)).toBe(true);
 }
 const paginated=boxes.length?paginateSheet(sheets[0],88):[];
 expect(paginated.flatMap(s=>s.sidecar.textBoxes!.map(b=>b.text)).join('')).toBe(boxes[0].text);
});
