import {expect,it} from 'vitest';
import {notebookSheetsToMarkdown} from './notebookMarkdown';
import {materializeSemantic} from './semanticDocument';
import {createEmptySidecar} from '../sidecar/schema';

it('shares the edited AI elements, headings, lists and current check state without ink or layout',()=>{
 const sheets=materializeSemantic([{id:'title',type:'heading',text:'Shopping'},{id:'milk',type:'task',text:'Milk',checked:false},{id:'extra',type:'bullet',text:'Bread'}],'Test',600,900,56,{measure:text=>text.length*8,space:8});
 sheets[0].sidecar.textBoxes!.find(box=>box.checkbox)!.text='☑';
 sheets[0].sidecar.textBoxes!.find(box=>box.semantic?.id==='milk'&&!box.checkbox)!.text='Oat milk';
 const text=notebookSheetsToMarkdown(sheets);
 expect(text).toBe('# Shopping\n\n- [x] Oat milk\n\n- Bread');
 expect(text).not.toMatch(/kalamos-planning|data:image|textBoxes|\u200b/);
});
it('retains raw Markdown syntax and notebook page order, skipping ink-only and blank pages',()=>{
 const sidecar=createEmptySidecar('Test','test');
 expect(notebookSheetsToMarkdown([{source:'# First\n\n**Bold**',sidecar},{source:'\u200b',sidecar},{source:'- [ ] Last',sidecar}])).toBe('# First\n\n**Bold**\n\n- [ ] Last');
 expect(notebookSheetsToMarkdown([{source:'\u200b',sidecar}])).toBe('');
});
it('keeps all text when a semantic element continues into a second box',()=>{
 const [sheet]=materializeSemantic([{id:'long',type:'paragraph',text:'First'}],'Test',600,900,56,{measure:text=>text.length*8,space:8});
 const box=sheet.sidecar.textBoxes![0];
 sheet.sidecar.textBoxes!.push({...box,id:'continuation',text:'Second',y:112,semantic:{...box.semantic!,continuation:true}});
 expect(notebookSheetsToMarkdown([sheet])).toBe('First\nSecond');
});
