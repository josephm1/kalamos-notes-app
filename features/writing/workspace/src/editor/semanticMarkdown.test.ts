import { expect, it } from 'vitest';
import { semanticBlocksToMarkdown } from './semanticMarkdown';
import { materializeSemantic, projectSemantic, copySemanticBindings } from './semanticDocument';
import { parseMarkdown } from '../markdown/parse';

it('exports actual task state and heading/list semantics as readable Markdown', () => {
  const blocks = [{ id: 'title', type: 'heading' as const, text: 'To do' },
    { id: 'milk', type: 'task' as const, text: 'Buy milk', checked: false },
    { id: 'ikea', type: 'task' as const, text: 'Go to Ikea', checked: true }];
  expect(semanticBlocksToMarkdown(blocks)).toBe('# To do\n\n- [ ] Buy milk\n\n- [x] Go to Ikea\n');
  expect(parseMarkdown(semanticBlocksToMarkdown(blocks)).map(block => block.text)).toEqual(['To do', 'Buy milk', 'Go to Ikea']);
});
it('keeps literal syntax out of accidental links, HTML or emphasis', () => {
  const markdown = semanticBlocksToMarkdown([{ id: 'text', type: 'paragraph', text: '<script> **milk** [x] #1' }]);
  expect(markdown).toContain('\\<script\\>');
  expect(parseMarkdown(markdown)[0].text).toBe('<script> **milk** [x] #1');
});
it('exports from the editor state after interaction, rather than stale AI text', () => {
  const [sheet] = materializeSemantic([{ id: 'task', type: 'task', text: 'Buy milk', checked: false }],
    'To do', 548, 740, 56, { measure: text => text.length * 8, space: 8 });
  sheet.sidecar.textBoxes!.find(box => box.checkbox)!.text = '☑';
  sheet.sidecar.textBoxes!.find(box => !box.checkbox)!.text = 'Buy oat milk';
  expect(semanticBlocksToMarkdown(projectSemantic(sheet.source, sheet.sidecar, 'first'))).toBe('- [x] Buy oat milk\n');
});
it('preserves grouped shopping and arrow-linked tasks in editor data and nested Markdown',()=>{
 const blocks=[{id:'buy',type:'task' as const,text:'Buy - Milk',checked:false},
  {id:'eggs',type:'bullet' as const,text:'eggs',parentId:'buy'},
  {id:'banana',type:'bullet' as const,text:'Bananas',parentId:'buy'},
  {id:'song',type:'task' as const,text:'Make a New song',checked:false},
  {id:'dave',type:'task' as const,text:'Speak to Dave about guitar',checked:false,parentId:'song'}];
 const markdown=semanticBlocksToMarkdown(blocks);
 expect(markdown).toContain('  - eggs');expect(markdown).toContain('  - [ ] Speak to Dave');
 const [sheet]=materializeSemantic(blocks,'To do',548,740,56,{measure:t=>t.length*8,space:8});
 expect(projectSemantic(sheet.source,sheet.sidecar,'first')).toEqual(blocks);
 expect(sheet.sidecar.textBoxes!.find(box=>box.semantic?.id==='eggs')!.x)
  .toBeGreaterThan(sheet.sidecar.textBoxes!.find(box=>box.semantic?.id==='buy')!.x);
});
it('rejects unknown groups and cycles instead of silently flattening the document',()=>{
 expect(()=>semanticBlocksToMarkdown([{id:'a',type:'paragraph',text:'A',parentId:'missing'}])).toThrow('unavailable');
 expect(()=>semanticBlocksToMarkdown([{id:'a',type:'paragraph',text:'A',parentId:'b'},{id:'b',type:'paragraph',text:'B',parentId:'a'}])).toThrow('Cyclic');
});

it('page copies remap child relationships with their parent and deleted parents keep surviving content',()=>{
 const blocks=[{id:'buy',type:'task' as const,text:'Buy milk',checked:false},{id:'eggs',type:'bullet' as const,text:'eggs',parentId:'buy'}];
 const [sheet]=materializeSemantic(blocks,'List',548,740,56,{measure:t=>t.length*8,space:8});
 let id=0;const copy=copySemanticBindings(sheet.sidecar,()=>`copy-${++id}`);
 const projected=projectSemantic(sheet.source,copy,'copy');
 expect(projected[1].parentId).toBe(projected[0].id);
 copy.textBoxes=copy.textBoxes!.filter(box=>box.semantic?.id===projected[1].id);
 expect(projectSemantic(sheet.source,copy,'copy')[0]).toEqual({id:projected[1].id,type:'bullet',text:'eggs'});
});

it('exports headings as standard Markdown sections and keeps their tasks out of code blocks',()=>{
 const blocks=[{id:'title',type:'heading' as const,text:'To do'},
  {id:'group',type:'heading' as const,text:'Shopping',parentId:'title'},
  {id:'milk',type:'task' as const,text:'Milk',checked:true,parentId:'group'},
  {id:'eggs',type:'task' as const,text:'Eggs',checked:false,parentId:'group'}];
 const markdown=semanticBlocksToMarkdown(blocks);
 expect(markdown).toBe('# To do\n\n## Shopping\n\n- [x] Milk\n\n- [ ] Eggs\n');
 expect(parseMarkdown(markdown).map(b=>b.type)).toEqual(['heading','heading','listItem','listItem']);
});
