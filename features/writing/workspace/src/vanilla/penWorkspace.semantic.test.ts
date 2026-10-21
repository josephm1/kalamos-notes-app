import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { materializeTranscriptionPage } from '../editor/inkTranscription';
import { createEmptySidecar } from '../sidecar/schema';
import { PenWorkspace } from './penWorkspace';
import { materializeSemantic, projectSemantic } from '../editor/semanticDocument';
import { DEFAULT_PREFERENCES } from '../storage/preferences';
import { parseMarkdown } from '../markdown/parse';
import { parseInlineMarkdown } from '../editor/inlineStyles';
import type { CommitPayload } from '../editor/PenWorkspace';
import type { InkPoint } from '../ink/types';
const workspaces:PenWorkspace[]=[];
beforeAll(()=>{
 (HTMLCanvasElement.prototype as unknown as {getContext:()=>unknown}).getContext=()=>({font:'',measureText:(text:string)=>({width:text.length*8}),setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},arc(){}});
 (globalThis as unknown as {ResizeObserver:unknown}).ResizeObserver=class{observe(){}disconnect(){}};
});
afterEach(()=>{workspaces.forEach(ws=>ws.destroy());workspaces.length=0;document.body.replaceChildren();});
function open(text='Buy  milk',saved?:CommitPayload,native=true){
 const [sheet]=materializeSemantic([{id:'task',type:'task',text,checked:true}],'AI',320,800,44);
 const host=document.createElement('div');document.body.append(host);let result:CommitPayload;
 const ws=new PenWorkspace(host,{block:parseMarkdown(sheet.source)[0],existingRuns:saved?.newRuns??[],existingTextBoxes:saved?.textBoxes??sheet.sidecar.textBoxes,existingLineHeight:44,prefs:DEFAULT_PREFERENCES,eink:true,native,onCommit:value=>{result=value;},onCancel(){}});
 workspaces.push(ws);return {ws,host,sheet,saved:()=>result!};
}
function sweep(left:number,right:number,y:number):InkPoint[]{return Array.from({length:7},(_,i)=>({x:i%2?right:left,y:y-6+i*2,t:i*4,pressure:.5}));}
function pointer(ws:PenWorkspace,type:string,x:number,y:number){
 const event=new MouseEvent(type,{clientX:x,clientY:y,bubbles:true,button:0,buttons:type==='pointerup'?0:1});
 Object.defineProperties(event,{pointerType:{value:'pen'},pointerId:{value:99},pressure:{value:.5}});ws.containerElement.dispatchEvent(event);
}
it('scribbles one typed word, preserves its neighbour and task state, and restores exact text in one Undo',async()=>{
 const {ws,saved}=open();
 expect(ws.eraseScribble(sweep(58,92,25),false,false)).not.toBeNull();
 expect(ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)?.text).toBe('Buy  ');
 expect(ws.reflowDoc.textBoxes!.find(b=>b.checkbox)?.text).toBe('☑');
 await ws.checkpoint();const reopened=open('',saved());
 expect(reopened.ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)?.text).toBe('Buy  ');
 ws.magnifyUndo();expect(ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)?.text).toBe('Buy  milk');
 expect(ws.getNativeInkStrokes()).toHaveLength(0);
});
it('removes an empty AI task and its paired control together; Undo restores both',()=>{
 const {ws}=open('Milk');
 expect(ws.eraseScribble(sweep(8,56,25),false,false)).not.toBeNull();
 expect(ws.reflowDoc.textBoxes).toEqual([]);
 ws.magnifyUndo();expect(ws.reflowDoc.textBoxes!.map(b=>b.text)).toEqual(['Milk','☑']);
});
it('line spacing moves AI words and checkboxes together, saves the same grid, and scribbles the moved word',async()=>{
 const {ws,saved,sheet}=open('First\nSecond');
 ws.setActiveTool('lines');pointer(ws,'pointerdown',8,10);pointer(ws,'pointermove',8,98);pointer(ws,'pointerup',8,98);
 await ws.checkpoint();const result=saved();
 const text=result.textBoxes!.find(b=>!b.checkbox)!,check=result.textBoxes!.find(b=>b.checkbox)!;
 expect(text.words![0].y).toBeGreaterThan(0);expect(check.y).toBe(text.words![0].y);
 expect(result.layoutLineHeight).toBe(44);expect(text.text).toBe('First\nSecond');
 const reopened=open('',result);const y=text.words![1].y+25;
 expect(reopened.ws.eraseScribble(sweep(8,72,y),false,false)).not.toBeNull();
 expect(reopened.ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)?.text).toBe('First\n');
 reopened.ws.magnifyUndo();expect(projectSemantic(sheet.source,{...sheet.sidecar,textBoxes:reopened.ws.reflowDoc.textBoxes},'first')[0]).toMatchObject({id:'task',text:'First\nSecond',checked:true});
});
it('ordinary strokes over typed text stay ink',()=>{
 const {ws}=open('Milk');
 expect(ws.eraseScribble([{x:10,y:25,t:1,pressure:.5},{x:70,y:25,t:2,pressure:.5}],false,false)).toBeNull();
 expect(ws.reflowDoc.textBoxes!.map(b=>b.text)).toEqual(['Milk','☑']);
});

it('a transcribed ink task uses the normal checkbox, spacing, scribble and saved editor history',async()=>{
 const sidecar=createEmptySidecar('Transcription','hash');sidecar.layoutLineHeight=44;
 sidecar.inkRuns=[{id:'run',blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',intrinsicWidth:80,intrinsicHeight:32,baselineOffset:36,layoutX:16,layoutY:52,scale:1,createdAt:1,updatedAt:1,strokes:[{id:'stroke',tool:'pen',color:'#000',width:3,points:[{x:4,y:4,t:1,pressure:.5},{x:72,y:28,t:2,pressure:.5}],bounds:{x:4,y:4,width:68,height:24}}]}];
 const region={id:'region',pageId:'first',runId:'run',strokeIds:['stroke'],bounds:{x:16,y:52,width:80,height:32}};
 const next=materializeTranscriptionPage({pageId:'first',source:'\u200b',sidecar},[{id:'transcribed',type:'task',text:'Buy  milk',checked:false,sourceInkRegionIds:['region']}],[region],{width:320,height:800,lineHeight:44,measure:s=>s.length*8,space:8});
 const {ws,host,saved}=open('',{newSource:next.source,newRuns:next.sidecar.inkRuns,textBoxes:next.sidecar.textBoxes,layoutLineHeight:44});
 expect(ws.getNativeInkStrokes()).toHaveLength(0);
 host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click();
 ws.setActiveTool('lines');pointer(ws,'pointerdown',8,10);pointer(ws,'pointermove',8,98);pointer(ws,'pointerup',8,98);
 await ws.checkpoint();const payload=saved(),box=payload.textBoxes!.find(b=>!b.checkbox)!;
 expect(payload.textBoxes!.find(b=>b.checkbox)?.y).toBe(box.words![0].y);
 expect(payload.textBoxes!.find(b=>b.checkbox)?.text).toBe('☑');
 const reopened=open('',payload),milk=box.words![1];
 expect(reopened.ws.eraseScribble(sweep(milk.x-3,milk.x+35,milk.y+25),false,false)).not.toBeNull();
 expect(reopened.ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)?.text).toBe('Buy  ');
 reopened.ws.magnifyUndo();
 expect(reopened.ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)?.text).toBe('Buy  milk');
 expect(reopened.ws.reflowDoc.textBoxes!.find(b=>b.checkbox)?.text).toBe('☑');
 expect(reopened.ws.getNativeInkStrokes()).toHaveLength(0);
});

it('new headings share bold measurement, rendering, export and editing while older boxes keep their original font',async()=>{
 const prior=HTMLCanvasElement.prototype.getContext;
 const spy=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((function(){
  return {font:'',measureText(text:string){return {width:text.length*(this.font.startsWith('700 ')?9:8)}},setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},arc(){}};
 }) as unknown as typeof prior);
 try {
  const [sheet]=materializeSemantic([{id:'title',type:'heading',text:'To do'}],'AI',320,800,44);
  const title=sheet.sidecar.textBoxes![0];expect(title.fontWeight).toBe(700);
  expect(title.words![1].x).toBe(43);
  const host=document.createElement('div');document.body.append(host);let result:CommitPayload;
  const ws=new PenWorkspace(host,{block:parseMarkdown(sheet.source)[0],existingRuns:[],existingTextBoxes:[title,{...title,id:'old',semantic:{...title.semantic!,id:'old'},fontWeight:undefined,y:132,words:title.words!.map(w=>({...w,y:132}))}],existingLineHeight:44,prefs:DEFAULT_PREFERENCES,eink:true,native:true,onCommit:value=>{result=value},onCancel(){}});
  workspaces.push(ws);
  expect(host.querySelector<HTMLElement>('[data-text-box-word="semantic-title"]')!.style.fontWeight).toBe('700');
  expect(host.querySelector<HTMLElement>('[data-text-box-word="old"]')!.style.fontWeight).not.toBe('700');
  expect(ws.exportSvgPages()[0]).toContain('font-weight="700"');
  expect(ws.eraseScribble(sweep(41,63,25),false,false)).not.toBeNull();
  expect(ws.reflowDoc.textBoxes!.find(b=>b.id===title.id)!.text).toBe('To ');
  ws.magnifyUndo();await ws.checkpoint();
  expect(result!.textBoxes!.find(b=>b.id===title.id)!.fontWeight).toBe(700);
  expect(result!.textBoxes!.find(b=>b.id===title.id)!.text).toBe('To do');
 }finally {spy.mockRestore()}
});

it('Select drags one deterministic typed word, preserves its neighbours and saves/Undo restores exact positions',async()=>{
 const {ws,saved}=open('Buy  milk',undefined,false);
 await ws.checkpoint();const original=saved().textBoxes![0].words!;
 ws.setActiveTool('select');const milk=original[1];
 pointer(ws,'pointerdown',milk.x+3,milk.y+25);pointer(ws,'pointermove',milk.x+53,milk.y+69);pointer(ws,'pointerup',milk.x+53,milk.y+69);
 const words=ws.reflowDoc.textBoxes![0].words!;
 expect(words[0]).toEqual(original[0]);expect(words[1].x).toBe(milk.x+50);expect(words[1].y).toBe(44);
 expect(ws.reflowDoc.textBoxes![0].text).toBe('Buy  milk');expect(ws.reflowDoc.textBoxes![1].text).toBe('☑');
 await ws.checkpoint();const reopened=open('',saved());expect(reopened.ws.reflowDoc.textBoxes![0].words![1]).toEqual(words[1]);
 ws.magnifyUndo();await ws.checkpoint();expect(saved().textBoxes![0].words).toEqual(original);
});
it('native Select uses the same typed word units and horizontal spacing still moves the selected lane',async()=>{
 const {ws,saved}=open();const before=ws.reflowDoc.textBoxes![0].words![1];
 ws.setActiveTool('select');ws.applyNativeStroke([{x:before.x+3,y:25,t:1,pressure:.5},{x:before.x+53,y:69,t:2,pressure:.5}]);
 expect(ws.reflowDoc.textBoxes![0].words![1].y).toBe(44);
 ws.setActiveTool('insert');ws.applyNativeStroke([{x:80,y:60,t:3,pressure:.5},{x:120,y:60,t:4,pressure:.5}]);
 await ws.checkpoint();const box=saved().textBoxes![0];expect(box.words![1].x).toBeGreaterThan(before.x+50);
 expect(box.words![0].y).toBe(0);expect(box.text).toBe('Buy  milk');expect(box.semantic!.id).toBe('task');
});
it('cancelling a word drag makes no content or history mutation',()=>{
 const {ws}=open('Buy milk',undefined,false);const before=JSON.stringify(ws.reflowDoc);
 const word=ws.reflowDoc.textBoxes![0].words![1];ws.setActiveTool('select');
 pointer(ws,'pointerdown',word.x+3,25);pointer(ws,'pointermove',word.x+40,69);pointer(ws,'pointercancel',word.x+40,69);
 expect(JSON.stringify(ws.reflowDoc)).toBe(before);
});

it('moving after line spacing uses one coordinate basis for adjacent typed blocks',async()=>{
 const [sheet]=materializeSemantic([{id:'a',type:'task',text:'Milk',checked:true},{id:'b',type:'task',text:'Eggs',checked:false}],'AI',320,800,44);
 const {ws,saved}=open('',{newSource:sheet.source,newRuns:[],textBoxes:sheet.sidecar.textBoxes} as CommitPayload);
 ws.setActiveTool('lines');ws.applyNativeStroke([{x:8,y:10,t:1,pressure:.5},{x:8,y:98,t:2,pressure:.5}]);
 await ws.checkpoint();const before=saved().textBoxes!;const milk=before.find(b=>b.semantic?.id==='a'&&!b.checkbox)!;
 ws.setActiveTool('select');ws.applyNativeStroke([{x:milk.words![0].x+3,y:milk.words![0].y+25,t:3,pressure:.5},{x:milk.words![0].x+27,y:milk.words![0].y+25,t:4,pressure:.5}]);
 await ws.checkpoint();const after=saved().textBoxes!;
 expect(after.find(b=>b.id===milk.id)!.words![0].x).toBe(milk.words![0].x+24);
 expect(after.find(b=>b.id===milk.id)!.words![0].y).toBe(milk.words![0].y);
 expect(after.filter(b=>b.id!==milk.id)).toEqual(before.filter(b=>b.id!==milk.id));
 ws.magnifyUndo();await ws.checkpoint();expect(saved().textBoxes).toEqual(before);
});

it('wrapped fragments of a single long word move together without AI word-block output',async()=>{
 const text='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';const {ws,saved}=open(text);
 await ws.checkpoint();const before=saved().textBoxes![0].words!;expect(before.length).toBeGreaterThan(1);
 ws.setActiveTool('select');const first=before[0];
 ws.applyNativeStroke([{x:first.x+3,y:first.y+25,t:1,pressure:.5},{x:first.x+3,y:first.y+113,t:2,pressure:.5}]);
 await ws.checkpoint();const after=saved().textBoxes![0];expect(after.text).toBe(text);
 expect(after.words!.map(w=>w.y)).toEqual(before.map(w=>w.y+88));expect(after.words!.map(w=>w.x)).toEqual(before.map(w=>w.x));
});

it('inline marks stay attached to whole word gestures, deletion, Undo and reopened text',async()=>{
 const marked=parseInlineMarkdown('Buy **mi*lk*** ~~eggs~~');
 const [sheet]=materializeSemantic([{id:'task',type:'task',...marked,checked:true}],'Styles',320,800,44);
 const {ws,saved}=open('',{newSource:sheet.source,newRuns:[],textBoxes:sheet.sidecar.textBoxes} as CommitPayload);
 await ws.checkpoint();const original=saved();const box=original.textBoxes!.find(b=>!b.checkbox)!;
 const milk=box.words!.find(w=>w.text==='milk')!;expect(box.words!.filter(w=>w.text==='milk')).toHaveLength(1);
 ws.setActiveTool('select');ws.applyNativeStroke([{x:milk.x+2,y:milk.y+25,t:1,pressure:.5},{x:milk.x+2,y:milk.y+69,t:2,pressure:.5}]);
 await ws.checkpoint();expect(saved().textBoxes!.find(b=>b.id===box.id)!.styles).toEqual(box.styles);
 ws.magnifyUndo();
 expect(ws.eraseScribble(sweep(milk.x-2,milk.x+34,milk.y+25),false,false)).not.toBeNull();
 await ws.checkpoint();const after=saved().textBoxes!.find(b=>b.id===box.id)!;
 expect(after.text).toBe('Buy  eggs');expect(after.styles).toEqual([{start:5,end:9,strike:true}]);
 ws.magnifyUndo();await ws.checkpoint();expect(saved().textBoxes!.find(b=>b.id===box.id)!.styles).toEqual(box.styles);
 const reopened=open('',saved());expect(reopened.ws.reflowDoc.textBoxes!.find(b=>b.id===box.id)!.styles).toEqual(box.styles);
 expect(ws.exportSvgPages().join('')).toContain('font-style="italic"');expect(ws.exportSvgPages().join('')).toContain('text-decoration="line-through"');
});
it('the existing text editor updates marked text atomically and Undo retains the original marks',async()=>{
 const marked=parseInlineMarkdown('Buy **milk**');
 const [sheet]=materializeSemantic([{id:'task',type:'task',...marked,checked:true}],'Styles',320,800,44);
 const {ws,saved,host}=open('',{newSource:sheet.source,newRuns:[],textBoxes:sheet.sidecar.textBoxes} as CommitPayload, false);
 ws.setActiveTool('select');
 host.querySelector<HTMLButtonElement>('.rw-text-box-edit')!.click();
 const input=host.querySelector<HTMLTextAreaElement>('.rw-text-box-input')!;
 expect(input.value).toBe('Buy **milk**');
 input.value='Buy *oat milk*';input.dispatchEvent(new Event('input',{bubbles:true}));
 host.querySelector<HTMLButtonElement>('.rw-text-box-done')!.click();
 await ws.checkpoint();const box=saved().textBoxes!.find(b=>!b.checkbox)!;
 expect(box.text).toBe('Buy oat milk');expect(box.styles).toEqual([{start:4,end:12,italic:true}]);
 ws.magnifyUndo();await ws.checkpoint();expect(saved().textBoxes!.find(b=>!b.checkbox)!.styles).toEqual(marked.styles);
});

it('Select taps and moves a typed word without drawing a lasso and restores it with Undo',()=>{
 const {ws,host}=open('Buy milk',undefined,false);
 host.querySelector<HTMLButtonElement>('[data-action="pointer"]')!.click();
 const words=ws.reflowDoc.textBoxes!.find(b=>!b.checkbox)!;
 const placed=(ws as any).textBoxWords(words.id).find((w:any)=>w.text==='milk');
 const x=placed.x+4,y=placed.line*44+20;
 pointer(ws,'pointerdown',x,y);pointer(ws,'pointermove',x+30,y+44);pointer(ws,'pointerup',x+30,y+44);
 const moved=(ws as any).textBoxWords(words.id).find((w:any)=>w.text==='milk');
 expect(moved.x).toBeCloseTo(placed.x+30);expect(moved.line).toBe(placed.line+1);
 expect(ws.usesNativeSelectionPen).toBe(false);expect((ws as any).selectionLassoPoints).toEqual([]);
 host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
 const restored=(ws as any).textBoxWords(words.id).find((w:any)=>w.text==='milk');
 expect(restored.x).toBe(placed.x);expect(restored.line).toBe(placed.line);
});
