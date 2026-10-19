import { afterEach, beforeAll, expect, it } from 'vitest';
import { PenWorkspace } from './penWorkspace';
import { createNotebookTemplate } from '../editor/notebookTemplates';
import { DEFAULT_PREFERENCES } from '../storage/preferences';
import { parseMarkdown } from '../markdown/parse';
import type { CommitPayload } from '../editor/PenWorkspace';
const workspaces: PenWorkspace[] = [];
beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as {getContext:()=>unknown}).getContext = () => ({font:'',measureText:(text:string)=>({width:text.length*8}),setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},arc(){}});
  (globalThis as unknown as {ResizeObserver:unknown}).ResizeObserver = class {observe(){} disconnect(){}};
});
afterEach(()=>{workspaces.forEach(ws=>ws.destroy());workspaces.length=0;document.body.replaceChildren();});
function open(id='tasks', saved?: CommitPayload, overflow?: (height:number)=>void) {
  const starter = createNotebookTemplate(id,'QA',320,56);
  const host = document.createElement('div');document.body.append(host);
  let payload: CommitPayload | undefined;
  const ws = new PenWorkspace(host,{pageTools:overflow?{index:0,count:1,change(){},overflow}:undefined,block:parseMarkdown(starter.source)[0],existingRuns:saved?.newRuns??[],existingTextBoxes:saved?.textBoxes??starter.sidecar.textBoxes,existingPageObjects:saved?.pageObjects,existingLineHeight:56,prefs:{...DEFAULT_PREFERENCES,lineHeight:56},eink:true,native:true,onCommit:value=>{payload=value;},onCancel(){}});
  workspaces.push(ws); return {ws,host,saved:()=>payload!};
}
function click(host:HTMLElement,label:string) { const el=host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);expect(el).not.toBeNull();el!.click(); }
function pointer(ws:PenWorkspace,type:string,x:number,y:number) {
  const event = new MouseEvent(type,{clientX:x,clientY:y,bubbles:true,button:0,buttons:type==='pointerup'?0:1});
  Object.defineProperties(event,{pointerType:{value:'pen'},pointerId:{value:99},pressure:{value:.5}});ws.containerElement.dispatchEvent(event);
}
it('native checkbox taps are controls, save/reopen checked, and Undo never loses ink',async()=>{
  const {ws,host,saved}=open();
  const box=ws.reflowDoc.textBoxes!.find(b=>b.checkbox)!;
  const result=ws.applyNativeWriteStroke([{x:280,y:box.y+25,t:1,pressure:.5}],false);
  expect(result && 'kind' in result ? result.kind : null).toBe('widget');expect(ws.getNativeInkStrokes()).toHaveLength(0);
  expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  await ws.checkpoint();const reopened=open('tasks',saved());
  expect(reopened.host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  ws.magnifyUndo();expect(ws.reflowDoc.textBoxes!.find(b=>b.checkbox)?.text).toBe('☐');
});
it('a drawn pen tick toggles and clears its outgoing tail without saving ink',async()=>{
  const {ws,host,saved}=open();
  const box=ws.reflowDoc.textBoxes!.find(b=>b.checkbox)!;
  const points=[{x:280,y:box.y+22,t:1,pressure:.5},{x:291,y:box.y+38,t:2,pressure:.5},{x:328,y:box.y-6,t:3,pressure:.5}];
  const result=ws.applyNativeWriteStroke(points,false);
  expect(result).toMatchObject({kind:'widget'});
  expect(result!.rect.x+result!.rect.w).toBeGreaterThan(328);
  expect(result!.rect.y).toBeLessThan(box.y-6);
  expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  expect(ws.getNativeInkStrokes()).toHaveLength(0);
  await ws.checkpoint();expect(saved().newRuns).toHaveLength(0);
  ws.applyNativeWriteStroke([{x:280,y:box.y+22,t:4,pressure:.5}],false);
  expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
  ws.magnifyUndo();expect(ws.reflowDoc.textBoxes!.find(b=>b.checkbox)?.text).toBe('☑');
});
it('two strokes of one checkbox mark toggle once per native batch, independently for each control',()=>{
  const {ws}=open(),batch=new Set<string>();
  const boxes=ws.reflowDoc.textBoxes!.filter(b=>b.checkbox);
  const mark=(y:number)=>[{x:280,y:y+14,t:1,pressure:.5},{x:309,y:y+40,t:2,pressure:.5}];
  ws.applyNativeWriteStroke(mark(boxes[0].y),false,batch);
  ws.applyNativeWriteStroke(mark(boxes[0].y).reverse(),false,batch);
  ws.applyNativeWriteStroke(mark(boxes[1].y),false,batch);
  expect(ws.reflowDoc.textBoxes!.filter(b=>b.checkbox).slice(0,2).map(b=>b.text)).toEqual(['☑','☑']);
  expect(ws.getNativeInkStrokes()).toHaveLength(0);
});
it('handwriting entering a checkbox from outside and long outgoing strokes remain ink',()=>{
  for(const coords of [[[230,135],[280,140]],[[280,135],[390,140]],[[280,135],[290,220]]]) {
    const {ws}=open();
    const result=ws.applyNativeWriteStroke(coords.map(([x,y],t)=>({x,y,t,pressure:.5})),false);
    expect(result).toBeNull();
    expect(ws.reflowDoc.textBoxes!.filter(b=>b.checkbox).every(b=>b.text==='☐')).toBe(true);
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
  }
});
it('finger checklist taps remain checked when vertical spacing moves their row',async()=>{
  const {ws,host,saved}=open();host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click();
  const id=ws.reflowDoc.textBoxes!.find(b=>b.checkbox)!.id;
  ws.setActiveTool('lines');pointer(ws,'pointerdown',20,70);pointer(ws,'pointermove',20,182);pointer(ws,'pointerup',20,182);
  await ws.checkpoint();const box=saved().textBoxes!.find(b=>b.id===id)!;
  expect(box.text).toBe('☑');expect(box.words![0].y).toBeGreaterThan(112);
});
it('WebView pen release activates a checkbox once without a compatibility click saving ink',()=>{
  const {ws,host}=open(),button=host.querySelector<HTMLButtonElement>('[role=checkbox]')!;
  for(const type of ['pointerdown','pointerup']) {
    const event=new MouseEvent(type,{bubbles:true});
    Object.defineProperties(event,{pointerType:{value:'pen'},pointerId:{value:99}});
    button.dispatchEvent(event);
  }
  button.click();
  expect(host.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('true');
  expect(ws.getNativeInkStrokes()).toHaveLength(0);
});
it('free shapes draw, save, export, remain independent of line spacing, and Undo',async()=>{
  const {ws,host,saved}=open('ruled');click(host,'Shapes / free drawing');click(host,'Rectangle');
  pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,215);pointer(ws,'pointerup',180,215);
  expect(ws.reflowDoc.pageObjects).toMatchObject([{kind:'rectangle',x:40,y:125,width:140,height:90}]);
  ws.setActiveTool('lines');pointer(ws,'pointerdown',20,70);pointer(ws,'pointermove',20,182);pointer(ws,'pointerup',20,182);
  expect(ws.reflowDoc.pageObjects![0].y).toBe(125);
  await ws.checkpoint();const reopened=open('ruled',saved());
  expect(reopened.ws.exportSvgPages().join('')).toContain('x="40" y="125" width="140" height="90"');
  ws.magnifyUndo();ws.magnifyUndo();expect(ws.reflowDoc.pageObjects).toHaveLength(0);
});
it('brush pressure and colour are retained with the native felt style',()=>{
  const {ws,host}=open('ruled');click(host,'Write or change pen settings');
  const brush=host.querySelector<HTMLButtonElement>('[aria-label="Brush"]')!;brush.click();
  expect(brush.querySelector('svg')).not.toBeNull();
  expect(host.querySelector('[data-tool=write]')?.getAttribute('data-brush-style')).toBe('brush');
  expect(ws.nativePenType).toBe('felt');click(host,'Blue');click(host,'Write or change pen settings');
  ws.applyNativeWriteStroke([{x:40,y:125,t:1,pressure:.2},{x:100,y:130,t:10,pressure:.9}],false);
  expect(ws.getNativeInkStrokes()[0]).toMatchObject({variableWidth:true,color:'#1838D8',width:4});
  expect(ws.getNativeInkStrokes()[0].pts.map(p=>p.pressure)).toEqual([.2,.9]);
  expect(host.textContent).not.toContain('Shape correction');
});
it('shape handles move, resize and delete independently, with one-step deletion Undo',()=>{
  const {ws,host}=open('ruled');click(host,'Shapes / free drawing');click(host,'Rectangle');
  pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,215);pointer(ws,'pointerup',180,215);
  const drag=(label:string,dx:number,dy:number)=>{
    const target=host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    for (const [type,x,y] of [['pointerdown',0,0],['pointermove',dx,dy],['pointerup',dx,dy]] as const) {
      const e=new MouseEvent(type,{clientX:x,clientY:y,bubbles:true});Object.defineProperties(e,{pointerId:{value:45},pointerType:{value:'pen'}});target.dispatchEvent(e);
    }
  };
  drag('Move shape',20,35);drag('Resize shape',40,30);
  expect(ws.reflowDoc.pageObjects).toMatchObject([{x:60,y:160,width:180,height:120}]);
  click(host,'Delete shape');expect(ws.reflowDoc.pageObjects).toHaveLength(0);
  ws.magnifyUndo();expect(ws.reflowDoc.pageObjects).toMatchObject([{x:60,y:160,width:180,height:120}]);
});

it('requests pagination only at completion of a positive line operation, not ordinary ink or relayout',()=>{
  const requested:number[]=[];
  const {ws}=open('week',undefined,height=>requested.push(height));
  Object.defineProperty(ws.containerElement,'clientHeight',{value:672,configurable:true});
  ws.applyNativeWriteStroke([{x:50,y:80,t:1,pressure:.5},{x:120,y:85,t:2,pressure:.5}],false);
  expect(requested).toEqual([]);
  ws.setActiveTool('lines');pointer(ws,'pointerdown',20,70);pointer(ws,'pointermove',20,182);
  expect(requested).toEqual([]);pointer(ws,'pointerup',20,182);
  expect(requested).toEqual([672]);
});

it('selection and eraser pop-outs retain accessible, pen-friendly actions',()=>{
 const {host}=open('ruled');click(host,'Select or move words');
 const panel=host.querySelector('[aria-label="Lasso settings"]')!;
 expect(panel.querySelector('[aria-label="Copy selection"]')?.hasAttribute('disabled')).toBe(true);
 expect(panel.querySelectorAll('svg').length).toBe(3);
 click(host,'Select words');expect(host.querySelector('[aria-label="Lasso settings"]')).toBeNull();
 click(host,'Eraser');expect(host.querySelector('[aria-label="Stroke eraser"] svg')).not.toBeNull();
 click(host,'Erasing lasso');expect(host.querySelector('[aria-label="Erasing lasso"]')?.getAttribute("aria-pressed")).toBe("true");
});

it('finger and pen outside settings dismiss without requiring a Done button',()=>{
 const {ws,host}=open('ruled');
 for (const pointerType of ['touch','pen']) {
  click(host,'Write or change pen settings');
  expect(host.querySelector('[aria-label="Close pen settings"]')).toBeNull();
  const event=new MouseEvent('pointerdown',{clientX:100,clientY:200,bubbles:true,button:0});
  Object.defineProperties(event,{pointerType:{value:pointerType},pointerId:{value:99},pressure:{value:.5}});
  ws.containerElement.dispatchEvent(event);
  expect(host.querySelector('[aria-label="Pen settings"]')).toBeNull();
  pointer(ws,'pointerup',100,200);
 }
});

it('template heading edits persist through reopening and Undo restores the label',async()=>{
 const {ws,host,saved}=open('tasks');
 click(host,'Edit heading: Priorities');
 const input=host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
 expect(input.value).toBe('Priorities');
 input.value='Work around the house';input.dispatchEvent(new Event('input',{bubbles:true}));
 host.querySelector<HTMLButtonElement>('.rw-text-box-done')!.click();
 await ws.checkpoint();
 const reopened=open('tasks',saved());
 expect(reopened.ws.reflowDoc.textBoxes![0].text).toBe('Work around the house');
 ws.magnifyUndo();expect(ws.reflowDoc.textBoxes![0].text).toBe('Priorities');
});

it('section boundary uses ruled spacing to move headings and ink together, with Undo',()=>{
 const {ws,host}=open('meeting');
 ws.applyNativeWriteStroke([{x:50,y:300,t:1,pressure:.5},{x:100,y:305,t:2,pressure:.5}],false);
 const before=ws.getNativeInkStrokes()[0].pts[0].y;
 ws.setActiveTool('select');
 const boundary=host.querySelector<HTMLButtonElement>('[aria-label="Resize section: Agenda"]')!;
 for (const [type,y] of [['pointerdown',224],['pointermove',336],['pointerup',336]] as const) {
  const e=new MouseEvent(type,{clientX:40,clientY:y,bubbles:true});
  Object.defineProperties(e,{pointerId:{value:50},pointerType:{value:'touch'}});boundary.dispatchEvent(e);
 }
 expect(ws.getNativeInkStrokes()[0].pts[0].y).toBe(before+112);
 expect(host.querySelector('[data-text-box-word="template-2"]')?.getAttribute('style')).toContain('336px');
 ws.magnifyUndo();expect(ws.getNativeInkStrokes()[0].pts[0].y).toBe(before);
});

it('white paper shapes keep free handwriting through move, resize, spacing, reopen, delete and Undo',async()=>{
 const {ws,host,saved}=open('ruled');click(host,'Shapes / free drawing');click(host,'Rectangle');
 pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,250);pointer(ws,'pointerup',180,250);
 ws.setActiveTool('write');ws.applyNativeWriteStroke([{x:70,y:170,t:1,pressure:.2},{x:110,y:190,t:2,pressure:.9}],false);
 expect(ws.reflowDoc.inserts.filter(i=>i.kind==='ink')).toHaveLength(0);
 expect(ws.reflowDoc.pageObjects![0].ink![0].points[0]).toMatchObject({x:30,y:45});
 expect(ws.exportSvgPages()[0]).toContain('fill="#ffffff"');
 ws.setActiveTool('objects');
 const drag=(label:string,dx:number,dy:number)=>{
  const target=host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  expect(target.querySelector('svg')).not.toBeNull();
  for(const [type,x,y] of [['pointerdown',0,0],['pointermove',dx,dy],['pointerup',dx,dy]] as const){
   const e=new MouseEvent(type,{clientX:x,clientY:y,bubbles:true});Object.defineProperties(e,{pointerId:{value:45},pointerType:{value:'pen'}});target.dispatchEvent(e);
  }
 };
 drag('Move shape',20,35);expect(ws.getNativeInkStrokes()[0].pts[0]).toMatchObject({x:90,y:205});
 drag('Resize shape',40,30);expect(ws.getNativeInkStrokes()[0].pts[0]).toMatchObject({x:90,y:205});expect(ws.getNativeInkStrokes()[0].width).toBe(DEFAULT_PREFERENCES.penWidth);
 ws.setActiveTool('lines');pointer(ws,'pointerdown',20,70);pointer(ws,'pointermove',20,182);pointer(ws,'pointerup',20,182);
 expect(ws.getNativeInkStrokes()[0].pts[0]).toMatchObject({x:90,y:205});
 await ws.checkpoint();const reopened=open('ruled',saved());expect(reopened.ws.getNativeInkStrokes()[0].pts[0]).toMatchObject({x:90,y:205});
 ws.setActiveTool('objects');click(host,'Delete shape');expect(ws.getNativeInkStrokes()).toHaveLength(0);
 ws.magnifyUndo();expect(ws.getNativeInkStrokes()).toHaveLength(1);
});
it('Outline is a checkbox and outline-only shapes keep ordinary ruled writing',()=>{
 const {ws,host}=open('ruled');click(host,'Shapes / free drawing');
 const outline=host.querySelector('[aria-label="Outline only"]')!;expect(outline.getAttribute('role')).toBe('checkbox');expect(outline.getAttribute('aria-checked')).toBe('false');
 click(host,'Outline only');expect(outline.getAttribute('aria-checked')).toBe('true');click(host,'Rectangle');
 pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,250);pointer(ws,'pointerup',180,250);
 ws.setActiveTool('write');ws.applyNativeWriteStroke([{x:70,y:170,t:1,pressure:.5},{x:110,y:190,t:2,pressure:.5}],false);
 expect(ws.reflowDoc.pageObjects![0].paper).toBe(false);expect(ws.reflowDoc.pageObjects![0].ink).toBeUndefined();expect(ws.getNativeInkStrokes()).toHaveLength(1);
});
it('eraser removes shape-owned handwriting and Undo restores it',()=>{
 const {ws,host}=open('ruled');click(host,'Shapes / free drawing');click(host,'Rectangle');
 pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,250);pointer(ws,'pointerup',180,250);
 ws.setActiveTool('write');ws.applyNativeWriteStroke([{x:70,y:170,t:1,pressure:.5},{x:110,y:190,t:2,pressure:.5}],false);
 ws.setActiveTool('erase');ws.applyNativeStroke([{x:90,y:180,t:3,pressure:.5}]);
 expect(ws.getNativeInkStrokes()).toHaveLength(0);ws.magnifyUndo();expect(ws.getNativeInkStrokes()).toHaveLength(1);
});

it('erasing on opaque paper preserves the page ink hidden beneath it',()=>{
 const {ws,host}=open('ruled');
 ws.applyNativeWriteStroke([{x:70,y:170,t:1,pressure:.5},{x:110,y:190,t:2,pressure:.5}],false);
 click(host,'Shapes / free drawing');click(host,'Rectangle');
 pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,250);pointer(ws,'pointerup',180,250);
 expect(ws.getNativeInkStrokes()).toHaveLength(0);
 ws.setActiveTool('write');ws.applyNativeWriteStroke([{x:70,y:170,t:3,pressure:.5},{x:110,y:190,t:4,pressure:.5}],false);
 ws.setActiveTool('erase');ws.applyNativeStroke([{x:90,y:180,t:5,pressure:.5}]);
 expect(ws.reflowDoc.inserts.filter(i=>i.kind==='ink')).toHaveLength(1);
 ws.setActiveTool('objects');click(host,'Delete shape');expect(ws.getNativeInkStrokes()).toHaveLength(1);
});

it('live shapes start at pen contact and track the current endpoint before pen-up',()=>{
 const {ws,host}=open('ruled');
 for(const label of ['Rectangle','Circle','Line','Triangle','Star','Trapezoid','Pentagon','Hexagon']){
  click(host,'Shapes / free drawing');click(host,label);
  pointer(ws,'pointerdown',60,130);
  const draft=host.querySelector<HTMLElement>('.page-object-draft')!;
  expect(draft.style.left).toBe('60px');expect(draft.style.top).toBe('130px');
  pointer(ws,'pointermove',230,300);pointer(ws,'pointermove',180,240);
  expect(draft.style.width).toBe('120px');expect(draft.style.height).toBe('110px');
  expect(draft.querySelector('svg')?.getAttribute('x')).toBe('0');
  pointer(ws,'pointerup',180,240);
  expect(ws.reflowDoc.pageObjects!.slice(-1)[0]).toMatchObject({x:60,y:130,width:120,height:110});
  click(host,'Delete shape');
 }
});
it('shape colour, width and border style apply independently of handwriting settings',()=>{
 const {ws,host}=open('ruled');click(host,'Shapes / free drawing');
 click(host,'Shape colour: Red');click(host,'Shape dashed line');click(host,'Increase shape line width');click(host,'Rectangle');
 pointer(ws,'pointerdown',40,125);pointer(ws,'pointermove',180,250);pointer(ws,'pointerup',180,250);
 expect(ws.reflowDoc.pageObjects![0]).toMatchObject({color:'#E01010',strokeWidth:3,lineStyle:'dashed',paper:true});
 expect(ws.exportSvgPages()[0]).toContain('stroke-dasharray="8 5"');
 expect(ws.reflowDoc.pageObjects![0].ink).toBeUndefined();
});

it('Spacing groups existing tools and width preview reflects actual style',()=>{
 const {host}=open('ruled');click(host,'Spacing tools');
 expect(host.querySelector('[aria-label="Horizontal spacing"]')).not.toBeNull();
 expect(host.querySelector('[aria-label="Condense spacing"]')).not.toBeNull();
 click(host,'Blank-line spacing');expect(host.querySelector('[aria-label="Spacing settings"]')).toBeNull();
 expect(host.querySelector('[data-action="spacing"]')?.getAttribute('aria-pressed')).toBe('true');
 click(host,'Shapes / free drawing');click(host,'Increase shape line width');
 expect(host.querySelector('.rw-shape-width-preview path')?.getAttribute('stroke-width')).toBe('3');
 click(host,'Shape dashed line');expect(host.querySelector('.rw-shape-width-preview path')?.getAttribute('stroke-dasharray')).toBe('9 5');
});
