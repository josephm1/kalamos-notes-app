import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {parseMarkdown} from '../markdown/parse';
import {DEFAULT_PREFERENCES} from '../storage/preferences';
import {PenWorkspace} from './penWorkspace';
import type {TextBox} from '../sidecar/schema';
const workspaces:PenWorkspace[]=[];
beforeAll(()=>{
  (HTMLCanvasElement.prototype as any).getContext=()=>({font:'',measureText:(text:string)=>({width:text.length*8}),setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}});
  (globalThis as any).ResizeObserver=class{observe(){}disconnect(){}};
});
afterEach(()=>{workspaces.splice(0).forEach(ws=>ws.destroy());document.body.replaceChildren();});
const stroke=(coords:number[][])=>coords.map(([x,y],t)=>({x,y,t,pressure:.5}));
function setup(boxes:TextBox[],native=true){
 const host=document.createElement('div');document.body.append(host);const commit=vi.fn();
 const ws=new PenWorkspace(host,{block:parseMarkdown('\u200b')[0],existingRuns:[],existingTextBoxes:boxes,prefs:DEFAULT_PREFERENCES,eink:true,native,onCommit:commit,onCancel(){}});
 workspaces.push(ws);return {ws,host,commit};
}
const box:TextBox={id:'shopping',blockId:'',text:'buy milk',x:30,y:88,width:200,size:19};
function words(ws:PenWorkspace){return [...ws.containerElement.querySelectorAll<HTMLElement>('[data-text-box-word]')].map(n=>({text:n.textContent,x:parseFloat(n.style.left),y:parseFloat(n.style.top)}));}
const lasso=stroke([[20,78],[240,78],[240,125],[20,125],[20,78]]);
function condense(host:HTMLElement){host.querySelector<HTMLButtonElement>('[aria-label="Spacing tools"]')!.click();host.querySelector<HTMLButtonElement>('[aria-label="Condense spacing"]')!.click();}
describe('word blocks across typed text and handwriting',()=>{
 it('moves just the tapped typed word and preserves the other word through save/reopen',()=>{
  const {ws,commit}=setup([box]);const before=words(ws);ws.setActiveTool('select');
  ws.applyNativeStroke(stroke([[35,92],[75,136]]));
  expect(words(ws)[0]).toEqual({text:'buy',x:70,y:132});expect(words(ws)[1]).toEqual(before[1]);
  ws.finish();const saved=commit.mock.calls[0][0];const restored=setup(saved.textBoxes).ws;
  expect(words(restored)).toEqual(words(ws));
 });
 it('lassos mixed blocks, moves them together, copies and deletes without losing surrounding text',()=>{
  const {ws,host}=setup([box]);ws.applyNativeWriteStroke(stroke([[160,94],[180,116]]),false);
  const beforeInk=ws.getNativeInkStrokes()[0].pts;const beforeText=words(ws);
  ws.setActiveTool('select');ws.selectLasso(lasso);
  expect(host.querySelectorAll('.rw-selection-box')).toHaveLength(1);
  expect(ws.usesNativeSelectionPen).toBe(false);
  ws.applyNativeStroke(stroke([[35,92],[55,136]]));
  expect(words(ws).map((w,i)=>[w.x-beforeText[i].x,w.y-beforeText[i].y])).toEqual([[20,44],[20,44]]);
  expect(ws.getNativeInkStrokes()[0].pts[0].x-beforeInk[0].x).toBeCloseTo(20);
  expect(ws.getNativeInkStrokes()[0].pts[0].y-beforeInk[0].y).toBeCloseTo(44);
  ws.duplicateSelectedInk();expect(words(ws)).toHaveLength(4);expect(ws.getNativeInkStrokes()).toHaveLength(2);
  host.querySelector<HTMLButtonElement>('[aria-label="Delete selected words"]')!.click();
  expect(words(ws)).toHaveLength(2);expect(ws.getNativeInkStrokes()).toHaveLength(1);
  ws.magnifyUndo();expect(words(ws)).toHaveLength(4);expect(ws.getNativeInkStrokes()).toHaveLength(2);
 });
 it('keeps all strokes of a handwritten word when the lasso touches only one letter',()=>{
  const {ws}=setup([]);ws.applyNativeWriteStroke(stroke([[40,94],[50,115]]),false);ws.applyNativeWriteStroke(stroke([[58,94],[68,115]]),false);
  ws.setActiveTool('select');ws.selectLasso(stroke([[36,90],[52,90],[52,120],[36,120],[36,90]]));
  expect(ws.getNativeInkStrokes().filter(s=>s.selected)).toHaveLength(2);
 });
 it('condenses mixed words into one reading order and retains a short intentional line ending',()=>{
  const {ws,host,commit}=setup([{...box,text:'buy milk\nTomorrow',words:[{text:'buy',x:30,y:88},{text:'milk',x:210,y:88},{text:'Tomorrow',x:30,y:176}]}]);
  ws.applyNativeWriteStroke(stroke([[120,94],[150,115]]),false);
  condense(host);const placed=words(ws),ink=ws.getNativeInkStrokes()[0];
  expect(placed[0].y).toBe(0);expect(placed[1].y).toBe(0);expect(placed[2].y).toBe(44);
  expect(placed[0].x).toBeLessThan(ink.pts[0].x);expect(placed[1].x).toBeGreaterThan(ink.pts[1].x);
  expect(placed[1].x).toBeLessThan(210);
  ws.finish();const saved=commit.mock.calls[0][0];expect(words(setup(saved.textBoxes).ws)).toEqual(placed);
  ws.magnifyUndo();expect(words(ws)[1].x).toBe(210);
 });
 it('joins nearly full wrapped rows, while short rows remain separate without explicit newlines',()=>{
  const {ws,host}=setup([{...box,text:'First continuation final',words:[{text:'First',x:30,y:88},{text:'continuation',x:210,y:88},{text:'final',x:30,y:132}]}]);
  condense(host);expect(words(ws).map(w=>w.y)).toEqual([0,0,0]);
  const second=setup([{...box,text:'Buy Milk',words:[{text:'Buy',x:30,y:88},{text:'Milk',x:30,y:132}]}]);
  condense(second.host);expect(words(second.ws).map(w=>w.y)).toEqual([0,44]);
 });
});

it('offers the same toolbar copy and delete actions for a single typed word',()=>{
 const {ws,host}=setup([box]);ws.setActiveTool('select');ws.applyNativeStroke(stroke([[35,92],[35,92]]));
 const copy=host.querySelector<HTMLButtonElement>('[aria-label="Copy selected words"]')!;
 expect(copy.style.display).not.toBe('none');copy.click();expect(words(ws)).toHaveLength(3);
 host.querySelector<HTMLButtonElement>('[aria-label="Delete selected words"]')!.click();expect(words(ws)).toHaveLength(2);
 ws.magnifyUndo();expect(words(ws)).toHaveLength(3);
});

it('selects every visual fragment of an overlong typed word as one block',()=>{
 const {ws}=setup([{...box,text:'extraordinary milk',width:64}]);
 const before=words(ws);ws.setActiveTool('select');ws.applyNativeStroke(stroke([[35,92],[55,136]]));
 const after=words(ws);const token=before.filter(w=>w.text!=='milk');
 expect(token.length).toBeGreaterThan(1);
 token.forEach((word,i)=>{expect(after[i].x-word.x).toBe(20);expect(after[i].y-word.y).toBe(44);});
 // Selection movement preserves the group geometry and leaves unselected objects in place.
 // Inserting/removing space is the explicit reflow operation.
 expect(after[after.length-1]).toEqual(before[before.length-1]);
});

it('switches a native-selected ink group to pointer movement with one separate box',()=>{
 const {ws,host}=setup([]);
 ws.applyNativeWriteStroke(stroke([[40,94],[60,116]]),false);
 ws.applyNativeWriteStroke(stroke([[180,94],[200,116]]),false);
 const before=ws.getNativeInkStrokes();
 ws.setActiveTool('select');expect(ws.usesNativeSelectionPen).toBe(true);
 ws.selectLasso(stroke([[20,78],[220,78],[220,125],[20,125],[20,78]]));
 expect(ws.usesNativeSelectionPen).toBe(false);
 expect(ws.getNativeInkStrokes().map(s=>s.pts)).toEqual(before.map(s=>s.pts));
 expect(host.querySelectorAll('.rw-selection-box')).toHaveLength(1);
 expect(host.querySelectorAll('.rw-ink path[stroke-dasharray]')).toHaveLength(0);
 const pointer=(type:string,x:number,y:number)=>{
   const event=new MouseEvent(type,{clientX:x,clientY:y,bubbles:true,buttons:type==='pointerup'?0:1});
   Object.defineProperties(event,{pointerId:{value:7},pointerType:{value:'pen'},pressure:{value:.5}});
   ws.containerElement.dispatchEvent(event);
 };
 pointer('pointerdown',50,100);pointer('pointermove',80,144);
 const previews=[...host.querySelectorAll<HTMLElement>('.rw-ink.selected,.rw-selection-box')];
 expect(previews).toHaveLength(2);expect(previews.every(n=>n.style.transform==='translate(30px,44px)')).toBe(true);
 pointer('pointerup',80,144);
 ws.getNativeInkStrokes().forEach((s,i)=>s.pts.forEach((p,j)=>{
   expect(p.x-before[i].pts[j].x).toBeCloseTo(30);expect(p.y-before[i].pts[j].y).toBeCloseTo(44);
 }));
 expect(ws.usesNativeSelectionPen).toBe(false);
 host.querySelector<HTMLButtonElement>('[aria-label="Select or move words"]')!.click();
 expect(ws.usesNativeSelectionPen).toBe(true);expect(host.querySelector('.rw-selection-box')).toBeNull();
});

it('cut and paste carry mixed vectors and styled text across editor lifetimes, with independent Undo',async()=>{
 const {clearSelectionClipboard}=await import('../editor/selectionClipboard');clearSelectionClipboard();
 const styled={...box,styles:[{start:4,end:8,bold:true}]};
 const source=setup([styled]);
 source.ws.placeMagnifiedGroup([{id:'cut-ink',tool:'pen',color:'#1838D8',width:3,points:stroke([[140,94],[170,106]]),bounds:{x:140,y:94,width:30,height:12}}],2);
 const original=source.ws.getNativeInkStrokes();
 source.ws.setActiveTool('select');source.ws.selectLasso(lasso);
 expect(source.ws.selectedMarkdown()).toContain('**milk**');
 source.ws.copySelectedBlocks(true);
 expect(words(source.ws)).toHaveLength(0);expect(source.ws.getNativeInkStrokes()).toHaveLength(0);
 source.host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
 expect(words(source.ws).map(w=>w.text)).toEqual(['buy','milk']);expect(source.ws.getNativeInkStrokes()).toEqual(original);
 source.ws.destroy();
 const target=setup([]);
 target.host.querySelector<HTMLButtonElement>('[data-action="paste"]')!.click();
 expect(words(target.ws).map(w=>w.text)).toEqual(['buy','milk']);
 const pasted=target.ws.getNativeInkStrokes();expect(pasted).toHaveLength(1);expect(pasted[0].color).toBe('#1838D8');
 expect(target.ws.reflowDoc.inserts.filter(i=>i.kind==='ink')[0].strokes[0].id).not.toBe('cut-ink');expect(target.ws.selectedMarkdown()).toContain('**milk**');
 expect(target.ws.usesNativeSelectionPen).toBe(false);
 target.host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
 expect(words(target.ws)).toHaveLength(0);expect(target.ws.getNativeInkStrokes()).toHaveLength(0);
 target.host.querySelector<HTMLButtonElement>('[data-action="paste"]')!.click();expect(words(target.ws)).toHaveLength(2);
 clearSelectionClipboard();
});

it('clipboard persistence failure leaves a cut selection untouched and reports the failure',()=>{
 const {ws}=setup([box]);ws.setActiveTool('select');ws.selectLasso(lasso);
 const before=words(ws);
 const save=vi.spyOn(Object.getPrototypeOf(localStorage),'setItem').mockImplementation(()=>{throw new Error('quota');});
 try{ws.copySelectedBlocks(true);expect(words(ws)).toEqual(before);expect(ws.getSelectedBlockBounds()).not.toBeNull();}
 finally{save.mockRestore();}
});

it('cut/paste and text sharing preserve task Markdown and checked state without reusing semantic identity',async()=>{
 const {clearSelectionClipboard}=await import('../editor/selectionClipboard');clearSelectionClipboard();
 const task:TextBox={...box,text:'buy milk',semantic:{id:'original-task',type:'task',role:'text'},styles:[{start:4,end:8,bold:true}]};
 const check:TextBox={id:'check',blockId:'',text:'☑',checkbox:true,x:260,y:88,width:36,size:19,semantic:{id:'original-task',type:'task',role:'checkbox'}};
 const source=setup([task,check]);source.ws.setActiveTool('select');source.ws.selectLasso(lasso);
 expect(source.ws.selectedMarkdown()).toBe('- [x] buy **milk**');
 source.ws.copySelectedBlocks(true);expect(source.ws.reflowDoc.textBoxes).toHaveLength(0);
 const target=setup([]);target.ws.pasteSelection();
 expect(target.ws.selectedMarkdown()).toBe('- [x] buy **milk**');
 const pasted=target.ws.reflowDoc.textBoxes!;
 expect(pasted[0].semantic!.id).not.toBe('original-task');expect(pasted[1].semantic!.id).toBe(pasted[0].semantic!.id);
 expect(pasted[1].text).toBe('☑');clearSelectionClipboard();
});
