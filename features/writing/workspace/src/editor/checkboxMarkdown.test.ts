import {expect,it} from 'vitest';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {Root} from 'mdast';
import {normalizeCheckboxNodes} from './checkboxMarkdown';
import {parseNotesMarkdownRows} from './markdownTranscription';

it('accepts inert checkbox metadata in inline and block list children',()=>{
 const input='# To Do\n- Buy milk <input type="checkbox" disabled>\n  - Eggs <input checked type="checkbox" disabled="disabled" />\n  - Flour\n\n    <input type="checkbox">\n- Bananas';
 const blocks=parseNotesMarkdownRows(input);
 expect(blocks.map(block=>[block.type,block.text,block.checked])).toEqual([['heading','To Do',undefined],['task','Buy milk',false],['task','Eggs',true],['task','Flour',false],['bullet','Bananas',undefined]]);
});
it('does not admit arbitrary HTML, event attributes, multiple boxes or orphan checkbox tags',()=>{
 for(const input of ['- Milk <input type="text">','- Milk <input type="checkbox" onclick="alert(1)">','- Milk <script>alert(1)</script>','<input type="checkbox">','- Milk\n<input type="checkbox">','- Milk <input type="checkbox"><input type="checkbox">','- [x] Milk <input type="checkbox">'])expect(()=>parseNotesMarkdownRows(input)).toThrow();
});
it('uses HTML boolean semantics and retains standard GFM checkbox states',()=>{
 expect(parseNotesMarkdownRows('- [x] Done\n- [ ] Pending').map(b=>b.checked)).toEqual([true,false]);
 expect(parseNotesMarkdownRows("- Milk <input type='checkbox' checked='false'>")[0].checked).toBe(true);
 expect(parseNotesMarkdownRows('- [x] Milk <input type="checkbox" checked>')[0].checked).toBe(true);
});
it('attaches a separate HTML child to its AST list owner, never the preceding nested item',()=>{
 const blocks=parseNotesMarkdownRows('- Main\n  - Child\n  <input type="checkbox" checked>');
 expect(blocks.map(b=>[b.text,b.type,b.checked])).toEqual([['Main','task',true],['Child','bullet',undefined]]);
 expect(blocks[1].parentId).toBe(blocks[0].id);
});
it('keeps inline and fenced code byte content untouched by checkbox normalization',()=>{
 const root=unified().use(remarkParse).use(remarkGfm).parse('```html\n- Milk <input type="checkbox">\n```\n\n- Example: `<input type="checkbox">`') as Root;
 const before=JSON.stringify(root);normalizeCheckboxNodes(root);expect(JSON.stringify(root)).toBe(before);
});
it('ignores comments in list bodies and inline content without dropping actual text',()=>{
 expect(parseNotesMarkdownRows('- Milk\n\n  <!-- unchecked -->\n- Eggs <!-- note --> fresh').map(b=>b.text)).toEqual(['Milk','Eggs  fresh']);
});
it('removes only the checkbox metadata row and retains real continuation rows',()=>{
 expect(parseNotesMarkdownRows('- Milk\n  tomorrow\n  <input type="checkbox">').map(b=>[b.text,b.type])).toEqual([['Milk','task'],['tomorrow','paragraph']]);
});
