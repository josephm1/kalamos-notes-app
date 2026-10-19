import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import './entry';
import { createNotebookTemplate } from '../editor/notebookTemplates';
import { appendPage, initialPages, PAGES_FILE, parsePages } from './workspacePages';
import type { Sidecar } from '../sidecar/schema';
beforeAll(()=>{
  (HTMLCanvasElement.prototype as unknown as {getContext:()=>unknown}).getContext=()=>({font:'',measureText:(text:string)=>({width:text.length*8}),setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},arc(){}});
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
});
afterEach(()=>{window.KalamosWriteWorkspace!.close(false);document.body.replaceChildren();vi.unstubAllGlobals();});
it('completed line insertion publishes separate sheets, turns to them and reopens saved template content',async()=>{
  const files=new Map<string,string>();
  const starter=createNotebookTemplate('week','Pagination QA',320,56);
  const points=[{x:4,y:4,t:1,pressure:.2},{x:50,y:40,t:2,pressure:.8}];
  starter.sidecar.inkRuns=[{id:'last-word',blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',
    intrinsicWidth:58,intrinsicHeight:44,baselineOffset:40,layoutX:120,layoutY:680,scale:1,createdAt:1,updatedAt:1,
    strokes:[{id:'last-stroke',tool:'pen',brushStyle:'brush',color:'#1838D8',width:4,points,bounds:{x:4,y:4,width:46,height:36}}]}];
  files.set('planning.write2.md',starter.source);files.set('planning.write2.json',JSON.stringify(starter.sidecar));
  files.set(PAGES_FILE,JSON.stringify({...appendPage(initialPages(),'manual'),active:0,template:'week'}));
  files.set('planning.page-manual.md','Existing manual sheet');
  const nb={notebookId:'pagination-qa',title:'Pagination QA',pages:[{pageId:'first',strokes:[]},{pageId:'manual',strokes:[]}]};
  vi.stubGlobal('Storage',{loadMeta:()=>nb,saveNotebook:()=>true});
  vi.stubGlobal('Bridge',{getNotebookFile:(_id:string,file:string)=>files.get(file)??'',saveNotebookFile:(_id:string,file:string,text:string)=>{files.set(file,text);return 'ok';}});
  // ResizeObserver remains available after cleanup between tests.
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  window.KalamosWriteWorkspace!.openWorkspaceNotebook('pagination-qa');
  await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')).not.toBeNull());
  const surface=document.querySelector<HTMLElement>('.reflow-surface')!;
  Object.defineProperty(surface,'clientHeight',{value:336});
  document.querySelector<HTMLButtonElement>('[aria-label="Spacing tools"]')!.click();
  document.querySelector<HTMLButtonElement>('[aria-label="Blank-line spacing"]')!.click();
  for(const [type,y] of [['pointerdown',70],['pointermove',182],['pointerup',182]] as const){
    const e=new MouseEvent(type,{clientX:20,clientY:y,bubbles:true,button:0,buttons:type==='pointerup'?0:1});
    Object.defineProperties(e,{pointerType:{value:'pen'},pointerId:{value:11},pressure:{value:.5}});surface.dispatchEvent(e);
  }
  await vi.waitFor(()=>expect(parsePages(files.get(PAGES_FILE)!).pages.length).toBeGreaterThan(2));
  await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')).not.toBe(surface));
  const index=parsePages(files.get(PAGES_FILE)!);
  expect(index.pages[index.pages.length-1].id).toBe('manual');
  expect(files.get('planning.page-manual.md')).toBe('Existing manual sheet');
  const headings=index.pages.slice(0,-1).flatMap(p=>(JSON.parse(files.get(p.sidecarFile)!) as Sidecar).textBoxes!.map(b=>b.text));
  const ink=index.pages.slice(0,-1).flatMap(p=>(JSON.parse(files.get(p.sidecarFile)!) as Sidecar).inkRuns);
  expect(ink).toHaveLength(1);expect(ink[0].strokes[0].points).toEqual(points);
  expect(ink[0].strokes[0].brushStyle).toBe('brush');expect(ink[0].layoutY).toBeLessThan(336);
  expect(headings).toEqual(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
  expect(document.querySelector('[data-text-box-word]')?.textContent).toContain('Monday');
  document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
  await vi.waitFor(()=>expect(parsePages(files.get(PAGES_FILE)!).active).toBe(1));
  await vi.waitFor(()=>expect(document.querySelector('[data-text-box-word]')?.textContent).toContain('Wednesday'));
  await window.KalamosWriteWorkspace!.checkpointWorkspace();
  window.KalamosWriteWorkspace!.close(false);window.KalamosWriteWorkspace!.openWorkspaceNotebook('pagination-qa');
  await vi.waitFor(()=>expect(document.querySelector('[data-text-box-word]')?.textContent).toContain('Wednesday'));
  expect(parsePages(files.get(PAGES_FILE)!).active).toBe(1);
});
it('previews the real first-sheet template in screen proportions without leaving another editor mounted',async()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const svg=await window.KalamosWriteWorkspace!.previewTemplate('meeting');
  expect(svg).toContain(`viewBox="0 0 ${window.innerWidth} ${window.innerHeight}"`);
  expect(svg).toContain('Agenda');expect(svg).toContain('Notes');expect(svg).toContain('Actions');
  expect(svg).toContain('☐');
  expect((svg.match(/<text /g)??[]).length).toBeGreaterThan(5);
  expect(document.querySelector('.pen-workspace')).toBeNull();
});
it('uses registered custom starter data for creation and real previews without sharing mutable fields',async()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const api=window.KalamosWriteWorkspace!;
  const entries=api.registerCustomTemplates([{filename:'qa.json',template:{schema:'kalamos.notes.template.v1',name:'Custom QA',sidecar:{layoutLineHeight:56,textBoxes:[{id:'heading',blockId:'planning-document',text:'Custom heading',x:16,y:0,width:200,size:32}]}}}]);
  expect(entries).toEqual([{id:'custom:qa.json',name:'Custom QA',category:'Custom'}]);
  const first=await api.createTemplate(entries[0].id,'First');
  first.sidecar.textBoxes![0].text='Changed';
  expect((await api.createTemplate(entries[0].id,'Second')).sidecar.textBoxes![0].text).toBe('Custom heading');
  const preview=await api.previewTemplate(entries[0].id);
  expect(preview).toContain('>Custom</text>'); expect(preview).toContain('>heading</text>');
  expect(document.querySelector('.pen-workspace')).toBeNull();
  api.registerCustomTemplates([]);
});

it('Zoom turns notebook sheets independently of vertical scrolling and stays open on the new sheet',async()=>{
  const files=new Map<string,string>([
    [PAGES_FILE,JSON.stringify({...appendPage(initialPages(),'second'),active:0})],
    ['planning.write2.md','First sheet'],['planning.page-second.md','Second sheet'],
  ]);
  const nb={notebookId:'zoom-pages-qa',title:'Zoom pages QA',pages:[{pageId:'first',strokes:[]},{pageId:'second',strokes:[]}]};
  vi.stubGlobal('Storage',{loadMeta:()=>nb,saveNotebook:()=>true});
  vi.stubGlobal('Bridge',{getNotebookFile:(_id:string,file:string)=>files.get(file)??'',saveNotebookFile:(_id:string,file:string,text:string)=>{files.set(file,text);return 'ok';}});
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  window.KalamosWriteWorkspace!.openWorkspaceNotebook('zoom-pages-qa');
  await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[data-action="magnify"]')!.click();
  expect(document.querySelector('.magnify-pad')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')?.textContent).toContain('Second'));
  await vi.waitFor(()=>expect(document.querySelector('.magnify-pad')).not.toBeNull());
  expect(parsePages(files.get(PAGES_FILE)!).active).toBe(1);
  expect(document.querySelector('.reflow-surface')?.textContent).toContain('Second');
  document.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.click();
  await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')?.textContent).toContain('First'));
  await vi.waitFor(()=>expect(document.querySelector('.magnify-pad')).not.toBeNull());
  expect(parsePages(files.get(PAGES_FILE)!).active).toBe(0);
  expect(document.querySelector('.reflow-surface')?.textContent).toContain('First');
  localStorage.removeItem('write2.magnify.draft');
});

it('overview copy-to publishes only complete page files and leaves the source intact',async()=>{
 const files=new Map<string,string>();
 const starter=createNotebookTemplate('tasks','Source',320,56);
 files.set(`source/${PAGES_FILE}`,JSON.stringify({...appendPage(initialPages(),'second'),active:0}));
 files.set('source/planning.write2.md',starter.source);files.set('source/planning.write2.json',JSON.stringify(starter.sidecar));
 files.set('source/planning.page-second.md','Second');
 files.set(`target/${PAGES_FILE}`,JSON.stringify(initialPages()));files.set('target/planning.write2.md','Existing target');
 const notebooks=new Map(['source','target'].map(id=>[id,{notebookId:id,title:id==='target'?'Target':'Source',kind:'planning',pages:[{pageId:'first',strokes:[]}]}]));
 let rejectSidecar=true;
 vi.stubGlobal('Storage',{loadMeta:(id:string)=>notebooks.get(id),loadLibrary:()=>({notebooks:[{notebookId:'target',title:'Target',kind:'planning'}]}),saveNotebook:()=>true});
 vi.stubGlobal('Bridge',{getNotebookFile:(id:string,file:string)=>files.get(`${id}/${file}`)??'',saveNotebookFile:(id:string,file:string,text:string)=>{
  if(rejectSidecar&&id==='target'&&file.startsWith('planning.page-copy-')&&file.endsWith('.json'))return 'error';
  files.set(`${id}/${file}`,text);return 'ok';
 }});
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 window.KalamosWriteWorkspace!.openWorkspaceNotebook('source');
 await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')).not.toBeNull());
 const click=(label:string)=>(document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
 click('Page overview');await vi.waitFor(()=>expect(document.querySelector('[aria-label="Select page 1"]')).not.toBeNull());
 click('Select page 1');click('Copy to');click('Target');
 await vi.waitFor(()=>expect(document.querySelector('.rw-page-overview [role="alert"]')?.textContent).toContain('Cannot copy page'));
 expect(parsePages(files.get(`target/${PAGES_FILE}`)!).pages).toHaveLength(1);
 expect(files.get('target/planning.write2.md')).toBe('Existing target');
 rejectSidecar=false;click('Copy to');click('Target');
 await vi.waitFor(()=>expect(parsePages(files.get(`target/${PAGES_FILE}`)!).pages).toHaveLength(2));
 const copied=parsePages(files.get(`target/${PAGES_FILE}`)!).pages[1];
 expect(files.get(`target/${copied.sourceFile}`)).toBe(files.get('source/planning.write2.md'));
 expect(files.get(`target/${copied.sidecarFile}`)).toBe(files.get('source/planning.write2.json'));
 expect(parsePages(files.get(`source/${PAGES_FILE}`)!).pages).toHaveLength(2);
});
it('awaitable editor close completes cleanup before a different notebook is opened',async()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  const files=new Map<string,string>();
  const notebooks=new Map(['before','after'].map(id=>[id,{notebookId:id,title:id,pages:[{pageId:'first',strokes:[]}]}]));
  for(const id of notebooks.keys())files.set(`${id}/planning.write2.md`,`${id} document`);
  vi.stubGlobal('Bridge',{
    loadMeta:(id:string)=>JSON.stringify(notebooks.get(id)),
    getNotebookFile:(id:string,file:string)=>files.get(`${id}/${file}`)??'',
    saveNotebookFile:(id:string,file:string,value:string)=>{files.set(`${id}/${file}`,value);return 'ok';},
  });
  vi.stubGlobal('Storage',{loadMeta:(id:string)=>notebooks.get(id),saveNotebook:()=>true,saveRenderedThumbnail:()=>{}});
  const editor=window.KalamosWriteWorkspace!;
  editor.openWorkspaceNotebook('before');
  await vi.waitFor(()=>expect(document.querySelector('.pen-workspace')).not.toBeNull());
  await editor.checkpointWorkspace();
  await editor.closeAndWait(false);
  expect(editor.isOpen()).toBe(false);
  expect(document.querySelector('.pen-workspace')).toBeNull();
  editor.openWorkspaceNotebook('after');
  await vi.waitFor(()=>expect(document.querySelector('.pen-workspace')).not.toBeNull());
  await editor.checkpointWorkspace();
  await Promise.resolve();
  expect(editor.isOpen()).toBe(true);
  expect(document.querySelector('.pen-workspace')).not.toBeNull();
  expect(files.get('after/planning.write2.md')).toContain('after document');
  await editor.closeAndWait(false);
});

it('materializes AI text using the selected saved page ruling and saved sheet height',async()=>{
 const starter=createNotebookTemplate('ruled','Saved grid',320,44);
 const files=new Map([['planning.write2.json',JSON.stringify(starter.sidecar)],[PAGES_FILE,JSON.stringify({...initialPages(),sheetHeight:176})]]);
 vi.stubGlobal('Bridge',{getNotebookFile:(_id:string,file:string)=>files.get(file)??''});
 const result=await window.KalamosWriteWorkspace!.materializeNotebookSemantic('saved-grid',Array.from({length:8},(_,i)=>({id:'task'+i,type:'task' as const,text:'Task '+i})),'Saved grid','first');
 expect(result.length).toBeGreaterThan(1);
 expect(result.every(s=>s.sidecar.layoutLineHeight===44)).toBe(true);
 expect(result.flatMap(s=>s.sidecar.textBoxes!).every(b=>b.y<176&&b.y%44===0)).toBe(true);
 await expect(window.KalamosWriteWorkspace!.materializeNotebookSemantic('saved-grid',[],'Missing','missing')).rejects.toThrow('unavailable');
});

it('materializes only the referenced saved transcription page at its own saved grid',async()=>{
 const starter=createNotebookTemplate('ruled','Transcribe',320,44);
 starter.sidecar.layoutLineHeight=44;starter.sidecar.sourceWords=[{text:'\u200b',x:0,y:0}];
 starter.sidecar.inkRuns=[{id:'run',blockId:'planning-document',anchorOffset:0,contextBefore:'',contextAfter:'',intrinsicWidth:48,intrinsicHeight:32,baselineOffset:36,layoutX:16,layoutY:52,scale:1,createdAt:1,updatedAt:1,strokes:[{id:'s',tool:'pen',color:'#000',width:3,points:[{x:4,y:4,t:1,pressure:.5},{x:44,y:28,t:2,pressure:.5}],bounds:{x:4,y:4,width:40,height:24}}]}];
 const files=new Map([['planning.write2.md','\u200b'],['planning.write2.json',JSON.stringify(starter.sidecar)],[PAGES_FILE,JSON.stringify({...initialPages(),sheetHeight:176})]]);
 vi.stubGlobal('Bridge',{getNotebookFile:(_id:string,file:string)=>files.get(file)??''});
 const region={id:'r',pageId:'first',runId:'run',strokeIds:['s'],bounds:{x:16,y:52,width:48,height:32}};
 const result=await window.KalamosWriteWorkspace!.materializeNotebookTranscription('saved-grid',[{id:'typed',type:'paragraph',text:'Milk',sourceInkRegionIds:['r']}],[region]);
 expect(result).toHaveLength(1);expect(result[0].pageId).toBe('first');expect(result[0].source).toBe('\u200b');
 expect(result[0].sidecar.inkRuns).toEqual([]);expect(result[0].sidecar.textBoxes![result[0].sidecar.textBoxes!.length-1]).toMatchObject({text:'Milk',y:44,size:27});
 expect(JSON.parse(files.get('planning.write2.json')!).inkRuns).toHaveLength(1);
});


async function revisionFixture(){
 const files=new Map<string,string>([['planning.write2.md','Before revision'],[PAGES_FILE,JSON.stringify(initialPages())]]);
 vi.stubGlobal('Storage',{loadMeta:()=>({notebookId:'revision-qa',title:'Revision QA',pages:[{pageId:'first',strokes:[]}]}),saveNotebook:()=>true});
 vi.stubGlobal('Bridge',{getNotebookFile:(_id:string,file:string)=>files.get(file)??'',saveNotebookFile:(_id:string,file:string,text:string)=>{files.set(file,text);return 'ok';}});
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const opened=vi.fn(),closed=vi.fn();window.KalamosWritingHost={onDocumentOpened:opened,onDocumentClosed:closed};
 const api=window.KalamosWriteWorkspace!;api.openWorkspaceNotebook('revision-qa');
 await vi.waitFor(()=>expect(document.querySelector('.reflow-surface')?.textContent).toContain('Before'));
 return {api,files,opened,closed};
}
it('publishes a revision without leaving the note, then saves only into the new page files',async()=>{
 const {api,files,opened,closed}=await revisionFixture();
 document.querySelector<HTMLButtonElement>('[data-action="toolbar-toggle"]')!.click();
 const updated={...initialPages(),pages:[{id:'formatted',sourceFile:'planning.page-formatted.md',sidecarFile:'planning.page-formatted.json'}]};
 const result=await api.commitNotebookRevision('revision-qa',async()=>{
  expect(api.isOpen()).toBe(true);expect(document.querySelector('.reflow-surface')?.textContent).toContain('Before');
  expect(document.getElementById('kalamos-write-workspace-root')!.inert).toBe(true);
  files.set('planning.page-formatted.md','After revision');files.set(PAGES_FILE,JSON.stringify(updated));return 'saved';
 });
 expect(result).toBe('saved');expect(api.isOpen()).toBe(true);expect(closed).not.toHaveBeenCalled();expect(opened).toHaveBeenCalledTimes(1);
 expect(document.querySelector('.reflow-surface')?.textContent).toContain('After');expect(document.querySelector('.tool-pill')?.classList.contains('toolbar-collapsed')).toBe(false);
 await api.checkpointWorkspace();expect(files.get('planning.page-formatted.md')).toBe('After revision');expect(files.get('planning.write2.md')).toBe('Before revision');
 delete window.KalamosWritingHost;
});
it('keeps the saved original editable after a failed revision publication',async()=>{
 const {api,opened,closed}=await revisionFixture();
 await expect(api.commitNotebookRevision('revision-qa',async()=>{throw Error('Commit rejected')})).rejects.toThrow('Commit rejected');
 expect(api.isOpen()).toBe(true);expect(document.querySelector('.reflow-surface')?.textContent).toContain('Before');expect(closed).not.toHaveBeenCalled();expect(opened).toHaveBeenCalledTimes(1);
 expect(document.getElementById('kalamos-write-workspace-root')!.inert).toBe(false);await api.checkpointWorkspace();delete window.KalamosWritingHost;
});
it('does not reopen a note deliberately closed while the revision is publishing',async()=>{
 const {api,closed}=await revisionFixture();
 await api.commitNotebookRevision('revision-qa',async()=>{api.close(false);return 'saved';});
 expect(api.isOpen()).toBe(false);expect(closed).toHaveBeenCalledTimes(1);delete window.KalamosWritingHost;
});

it('opens the overview from the top-right button and Back returns to the same live page',async()=>{
 const {api,closed}=await revisionFixture();const original=document.querySelector('.reflow-surface');
 document.querySelector<HTMLButtonElement>('[aria-label="Page overview"]')!.click();
 await vi.waitFor(()=>expect(document.querySelector('[aria-label="Select page 1"]')).not.toBeNull());
 expect(document.querySelector('.rw-page-overview')?.getAttribute('aria-modal')).toBe('true');
 expect(api.finishWorkspace()).toBe(true);
 await vi.waitFor(()=>expect(document.querySelector('.rw-page-overview')).toBeNull());
 expect(api.isOpen()).toBe(true);expect(document.querySelector('.reflow-surface')).toBe(original);expect(closed).not.toHaveBeenCalled();delete window.KalamosWritingHost;
});
