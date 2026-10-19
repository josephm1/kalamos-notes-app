import {expect,it,vi,beforeEach,afterEach} from 'vitest';
import {markdownImportBlocks} from './markdownImport';
import {materializeSemantic,copySemanticBindings} from './semanticDocument';
import {notebookSheetsToMarkdown} from './notebookMarkdown';
import {validateSidecar,serializeSidecar} from '../sidecar/schema';
import {objectSvg,drawMarkdownObject} from './pageObjects';

beforeEach(()=>{vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({font:'',measureText:(text:string)=>({width:text.length*8})} as unknown as CanvasRenderingContext2D)});
afterEach(()=>vi.restoreAllMocks());
const source='# Draft\n\nA **bold**, *italic* and ~~old~~ paragraph.\n\n- [x] Keep\n- Other\n\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |\n\n```kotlin\nval literal = "<script>"\n    println(literal)\n```\n\nLast paragraph.';
const geometry={measure:(text:string)=>text.length*8,space:8,paperWidth:480,paperHeight:280};
it('processes prose as editable formatted elements and tables and code as readable objects',()=>{
 const blocks=markdownImportBlocks(source,38);
 expect(blocks.find(block=>block.type==='heading')?.text).toBe('Draft');
 expect(blocks.find(block=>block.text.includes('paragraph'))?.styles).toEqual(expect.arrayContaining([expect.objectContaining({bold:true}),expect.objectContaining({italic:true}),expect.objectContaining({strike:true})]));
 expect(blocks.find(block=>block.type==='task')?.checked).toBe(true);
 const previews=blocks.filter(block=>block.preview);
 expect(previews).toHaveLength(2);
 expect(previews[0].preview!.lines.join('\n')).toContain('Alpha');
 expect(previews[0].preview!.lines.join('\n')).not.toContain('| --- |');
 expect(previews[1].preview!.lines[0]).toBe('val literal = "<script>"');
 expect(previews[1].preview!.lines.join('\n')).not.toContain('```');
 const sheets=materializeSemantic(blocks,'Draft',480,560,56,geometry);
 expect(sheets.length).toBeGreaterThan(1);
 expect(sheets.every(sheet=>sheet.source==='\u200b')).toBe(true);
 const restored=sheets.map(sheet=>{const value=validateSidecar(JSON.parse(serializeSidecar(sheet.sidecar)));if(!value.ok)throw Error(value.error);return {source:sheet.source,sidecar:value.sidecar};});
 const markdown=notebookSheetsToMarkdown(restored);
 expect(markdown).toContain('| Name | Value |\n| --- | --- |\n| Alpha | 42 |');
 expect(markdown).toContain('```kotlin\nval literal = "<script>"\n    println(literal)\n```');
 expect(markdown.match(/```kotlin/g)).toHaveLength(1);
 expect(markdown.indexOf('| Name')).toBeGreaterThan(markdown.indexOf('- Other'));
 expect(markdown.indexOf('Last paragraph.')).toBeGreaterThan(markdown.indexOf('```kotlin'));
});
it('escapes previews in SVG and draws their visible text in canvas thumbnails',()=>{
 const sheets=materializeSemantic(markdownImportBlocks('```html\n<script>alert(1)</script>\n```'),'Code',480,560,56,geometry);
 const object=sheets[0].sidecar.pageObjects![0];
 expect(objectSvg(object)).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
 expect(objectSvg(object)).not.toContain('<script>');
 const ctx={save:vi.fn(),restore:vi.fn(),fillRect:vi.fn(),strokeRect:vi.fn(),fillText:vi.fn()} as unknown as CanvasRenderingContext2D;
 drawMarkdownObject(ctx,object);expect(ctx.fillText).toHaveBeenCalledWith('<script>alert(1)</script>',expect.any(Number),expect.any(Number));
 const copy=copySemanticBindings(sheets[0].sidecar,()=> 'copy-id');
 expect(copy.pageObjects![0].markdown!.id).toBe('copy-id');
 expect(sheets[0].sidecar.pageObjects![0].markdown!.id).not.toBe('copy-id');
});
it('keeps unsupported inline links and code viewable with original Markdown preserved',()=>{
 const text='Read [the source](https://example.com) and `literal`.';
 const sheets=materializeSemantic(markdownImportBlocks(text),'Link',480,560,56,geometry);
 expect(sheets[0].sidecar.pageObjects??[]).toHaveLength(0);expect(sheets[0].sidecar.textBoxes![0].text).toBe('Read the source and literal.');
 expect(notebookSheetsToMarkdown(sheets)).toBe(text);
});
it('rejects unsupported HTML explicitly instead of replacing editable prose with a preview',()=>{
 for(const text of ['Hello <script>world</script>','- Milk <script>alert(1)</script>','| A | B |\n| - | - |\n| <input type="text"> | kept |'])expect(()=>markdownImportBlocks(text)).toThrow('Unsupported Markdown');
});
it('uses the same AST-owned checkbox and comment contract for imports and formatting',()=>{
 const blocks=markdownImportBlocks('- Main\n\n  <input type="checkbox" checked>\n\n  <!-- list comment -->\n\n  - Child');
 expect(blocks.map(b=>[b.text,b.type,b.checked])).toEqual([['Main','task',true],['Child','bullet',undefined]]);
 expect(blocks.every(b=>!b.preview)).toBe(true);
});
it('renders a list with explicit rich inline content without losing item boundaries or task states',()=>{
 const source='- [x] Read [source](https://example.com)\n  - Keep `value`\n- [ ] Next';
 const blocks=markdownImportBlocks(source);
 expect(blocks.every(block=>!block.preview)).toBe(true);
 expect(blocks.map(block=>block.text)).toEqual(['Read source','Keep value','Next']);
 expect(blocks[0].checked).toBe(true);expect(blocks[2].checked).toBe(false);
});
it('retains reference definitions needed by rendered links across export and reimport',()=>{
 const source='Read [the source][doc].\n\n[doc]: https://example.com/path "Title"';
 const blocks=markdownImportBlocks(source);
 expect(blocks).toHaveLength(1);expect(blocks[0].text).toBe('Read the source.');
 const sheets=materializeSemantic(blocks,'Reference',480,560,56,geometry);
 const exported=notebookSheetsToMarkdown(sheets);
 expect(exported).toContain('[the source](https://example.com/path)');expect(markdownImportBlocks(exported)[0].text).toBe('Read the source.');
});
it('lays out wide tables as labelled rows within the available reading width',()=>{
 const source='| A | B | C | D |\n| - | - | - | - |\n| Alpha | Beta | Gamma | Delta |\n| One | Two | Three | Four |';
 const preview=markdownImportBlocks(source,24)[0].preview!;
 expect(preview.lines).toEqual(['A: Alpha','B: Beta','C: Gamma','D: Delta','','A: One','B: Two','C: Three','D: Four']);
 expect(preview.lines.every(line=>line.length<=24)).toBe(true);expect(preview.source).toBe(source);
});
it('preserves code examples containing checkbox tags and original numbered markers',()=>{
 const source='```html\n- Sample <input type="checkbox">\n```\n\n7. Seventh\n8. Eighth';
 const blocks=markdownImportBlocks(source);
 expect(blocks[0].preview?.lines.join('\n')).toContain('- Sample <input type="checkbox">');
 expect(blocks.slice(1).map(b=>[b.text,b.ordinal])).toEqual([['Seventh',7],['Eighth',8]]);
});
it('does not convert invalid source or invalid rendering geometry into a preview',()=>{
 expect(()=>markdownImportBlocks('')).toThrow();expect(()=>markdownImportBlocks('Text\0')).toThrow();
 expect(()=>markdownImportBlocks('Text',0)).toThrow('display width');
});

it('retains explicit nested numbering through materialization and portable sharing',()=>{
 const text='7. First\n\n   3. Child\n\n8. Second';
 const blocks=markdownImportBlocks(text);
 expect(blocks.map(b=>b.ordinal)).toEqual([7,3,8]);
 expect(blocks.every(b=>b.type==='numbered')).toBe(true);
 const sheets=materializeSemantic(blocks,'Numbered',480,560,56,geometry);
 expect(notebookSheetsToMarkdown(sheets)).toBe('7. First\n\n  3. Child\n\n8. Second');
});

it('imports the complete shared CRISPR Markdown document without unsupported-content errors',()=>{
 const source="# CRISPR\u2013Cas9: A Five-Minute Primer \ud83e\uddec\n\n> **Note:** This document exists to exercise markdown rendering *and* say something true about biology. Every formatting element below is deliberate.\n\n## 1. The Central Idea\n\nCRISPR\u2013Cas9 is a **programmable nuclease**: a guide RNA (gRNA) base-pairs with a target DNA sequence, and the Cas9 protein cuts both strands ~3 bp upstream of a short motif called the **PAM** (`5'-NGG-3'` for *Streptococcus pyogenes* Cas9).\n\nTwo components, one job:\n\n- **gRNA** \u2014 provides *specificity* (20 nt spacer)\n- **Cas9** \u2014 provides *cleavage* (two nuclease domains: HNH and RuvC)\n\n### 1.1 Why it matters\n\n| Application | Edit type | Typical efficiency\\* |\n| :--- | :---: | ---: |\n| Gene knockout | NHEJ indels | 60\u201390% |\n| Knock-in | HDR template | 1\u201320% |\n| Base editing | C\u2022G \u2192 T\u2022A | 30\u201360% |\n| Transcriptional repression | dCas9-KRAB | *not a cut* |\n\n<sub>\\*Rough ranges in commonly used cell lines; hugely context-dependent.</sub>\n\n---\n\n## 2. The Repair Pathway Matters\n\nAfter the double-strand break, the cell chooses a repair route:\n\n1. **NHEJ** \u2014 fast, error-prone \u2192 frameshifts \u2192 loss of function\n2. **HDR** \u2014 precise, S/G2-phase restricted \u2192 requires a donor template\n   - ssODN for small edits (<50 bp)\n   - plasmid or AAV for larger cassettes\n3. **MMEJ** \u2014 microhomology-mediated, produces predictable deletions\n\n> \"The cut is easy. The repair is the hard part.\"\n>\n> \u2014 Every genome engineer, eventually\n>\n> > And this is a nested blockquote, testing indentation depth.\n\n## 3. A Minimal Design Snippet\n\n```python\n# Naive PAM scan on the forward strand\nimport re\n\ndef find_spacers(seq: str, pam: str = \"NGG\") -> list[str]:\n    pattern = rf\"(?=([ACGT]{{20}})(?={pam}))\"\n    return [m.group(1) for m in re.finditer(pattern, seq.upper())]\n\nseq = \"ACGT\" * 50\nprint(len(find_spacers(seq)))   # \u2192 0; no PAM present\n```\n\nOn-target score, very loosely:\n\n$$\n\\text{score} \\approx f(\\text{GC content}) \\times g(\\text{position-specific nucleotides})\n$$\n\n## 4. Practical Checklist\n\n- [x] Choose a PAM-adjacent spacer\n- [x] Check for off-target sites (\u22643 mismatches + PAM)\n- [ ] Validate with a T7 endonuclease assay\n- [ ] Sequence clones to confirm the allele\n- [ ] ~~Assume it worked~~ *Always sequence.*\n\n### Glossary\n\n**PAM** : Protospacer adjacent motif; Cas9 will not cut without one.  \n**Indel** : Insertion or deletion produced by imprecise repair.  \n**HDR** : Homology-directed repair; the precise-but-rare pathway.\n\n<details>\n<summary>Click to expand: a common misconception</summary>\n\nCas9 does **not** \"edit the gene.\" It *cuts* DNA. The cell's repair machinery does the editing, which is why delivery timing, cell cycle state, and repair-pathway choice dominate outcomes.\n\n</details>\n\n---\n\n### Feature inventory\n\n`*italic*` \u00b7 `**bold**` \u00b7 `***both***` \u00b7 `~~strike~~` \u00b7 `inline code` \u00b7 <kbd>Ctrl</kbd>+<kbd>C</kbd> \u00b7 H<sub>2</sub>O \u00b7 10<sup>9</sup> cells \u00b7 ==highlight== (extension-dependent)\n\n- Inline link: [CRISPR overview \u2014 NCBI](https://www.ncbi.nlm.nih.gov/)\n- Reference link: [Doudna & Charpentier, 2014][jc]\n- Auto-link: <https://www.addgene.org/>\n- Image (placeholder): ![Schematic of Cas9 bound to guide RNA and target DNA](https://placehold.co/600x160?text=Cas9+%2B+gRNA+%2B+target+DNA)\n- Escaped characters: \\*not italic\\* and a literal pipe \\| inside text\n\nA line ending with two spaces  \nforces a hard break \u2014 like that one.\n\n[jc]: https://www.science.org/doi/10.1126/science.1258096 \"Genome Engineering with CRISPR-Cas9\"";
 const blocks=markdownImportBlocks(source,26);
 expect(blocks.length).toBeGreaterThan(20);
 const sheets=materializeSemantic(blocks,"CRISPR",480,560,56,geometry);
 const text=notebookSheetsToMarkdown(sheets);
 expect(text).toContain("<sub>");expect(text).toContain("```python");expect(text).toContain("<details>");
 expect(sheets.flatMap(sheet=>sheet.sidecar.textBoxes??[]).filter(box=>box.checkbox)).toHaveLength(5);
});

it('read-only text shares the notebook baseline and does not cover or frame the rules',()=>{
 const [sheet]=materializeSemantic(markdownImportBlocks('```js\nconst x = 1;\n```'),'Code',480,560,56,geometry);
 const object=sheet.sidecar.pageObjects![0],svg=objectSvg(object);
 expect(svg).not.toContain('<rect');expect(svg).toContain('y="45.95"');
});
