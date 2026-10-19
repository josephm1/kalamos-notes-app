import { expect, it } from 'vitest';
import { savePaginatedSheet } from './sheetPagination';
import { appendPage, initialPages, parsePages, PAGES_FILE } from './workspacePages';
import { createEmptySidecar } from '../sidecar/schema';
const content={source:'\u200b',sidecar:{...createEmptySidecar('QA','fp'),layoutLineHeight:56,
  sourceWords:[{text:'\u200b',x:0,y:0}],textBoxes:[{id:'overflow',blockId:'planning-document',text:'Sunday',x:16,y:224,width:200,size:32,words:[{text:'Sunday',x:16,y:224}]}]}};
it('publishes every source/ink fragment before the manifest and inserts before later manual sheets',()=>{
  const index={...appendPage(initialPages(),'manual'),active:0,template:'week' as const};
  const writes:{file:string;text:string}[]=[];
  const next=savePaginatedSheet(index,content,168,'generation',(file,text)=>{writes.push({file,text});return 'ok';})!;
  expect(next.pages).toHaveLength(3);expect(next.pages[2]).toEqual(index.pages[1]);expect(next.active).toBe(0);
  expect(writes.map(w=>w.file)).not.toContain('planning.write2.md');
  expect(writes[writes.length-1].file).toBe(PAGES_FILE);expect(parsePages(writes[writes.length-1].text)).toEqual(next);
  expect(next.sheetHeight).toBe(168);expect(next.template).toBe('week');
});
it('a failed fragment save never publishes a truncated index or overwrites the original',()=>{
  const files:string[]=[];
  expect(()=>savePaginatedSheet(initialPages(),content,168,'failure',(file)=>{
    files.push(file);return files.length===3?'error':'ok';
  })).toThrow('Cannot save overflow sheet');
  expect(files).not.toContain(PAGES_FILE);expect(files).not.toContain('planning.write2.json');
});
it('uses stored sheet geometry when a later keyboard/toolbar changes viewport height',()=>{
  const index={...initialPages(),sheetHeight:168};
  const next=savePaginatedSheet(index,content,400,'stable',()=> 'ok')!;
  expect(next.pages).toHaveLength(2);expect(next.sheetHeight).toBe(168);
});
it('does no writes for content that fits',()=>{
  const files:string[]=[];
  expect(savePaginatedSheet(initialPages(),content,336,'fits',file=>{files.push(file);return 'ok';})).toBeNull();
  expect(files).toEqual([]);
});
it('caps an older edge-to-edge sheet height to the new visible paper bounds',()=>{
  const index={...initialPages(),sheetHeight:336};
  const next=savePaginatedSheet(index,content,200,'inset',()=> 'ok')!;
  expect(next.sheetHeight).toBe(168);expect(next.pages).toHaveLength(2);
});
