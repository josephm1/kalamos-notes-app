import {describe,it,expect} from 'vitest';
import {normalizeInlineStyles,clipInlineStyles,deleteInlineStyles,parseInlineMarkdown,serializeInlineMarkdown,styledFragments,styleFont} from './inlineStyles';

describe('inline style ranges',()=>{
 it('combines nested/overlapping flags and merges equal neighbours without mutating callers',()=>{
  const input=[{start:2,end:6,italic:true},{start:0,end:4,bold:true},{start:4,end:6,bold:true},{start:6,end:8,bold:true},{start:3,end:3,strike:true}];
  const before=JSON.stringify(input);
  expect(normalizeInlineStyles('abcdefgh',input)).toEqual([{start:0,end:2,bold:true},{start:2,end:6,bold:true,italic:true},{start:6,end:8,bold:true}]);
  expect(JSON.stringify(input)).toBe(before);
 });
 it('clips styles for pagination without losing a mark spanning the boundary',()=>{
  expect(clipInlineStyles([{start:0,end:4,bold:true},{start:4,end:8,bold:true,italic:true}],2,6)).toEqual([{start:0,end:2,bold:true},{start:2,end:4,bold:true,italic:true}]);
 });
 it('deletes overlapping pre-edit ranges once and shifts/merges surviving marks',()=>{
  const result=deleteInlineStyles('one two three',[{start:0,end:13,bold:true},{start:4,end:7,italic:true}],[{start:3,end:6},{start:5,end:8}]);
  expect(result).toEqual({text:'onethree',styles:[{start:0,end:8,bold:true}]});
  expect(deleteInlineStyles('abc',[{start:0,end:3,bold:true}],[{start:0,end:3}])).toEqual({text:'',styles:[]});
 });
 it('keeps UTF-16 offsets while refusing boundaries inside an emoji',()=>{
  expect(normalizeInlineStyles('A😀B',[{start:1,end:3,italic:true}])).toEqual([{start:1,end:3,italic:true}]);
  expect(()=>normalizeInlineStyles('A😀B',[{start:1,end:2,italic:true}])).toThrow('range');
  expect(deleteInlineStyles('A😀B',[{start:3,end:4,bold:true}],[{start:1,end:3}])).toEqual({text:'AB',styles:[{start:1,end:2,bold:true}]});
  expect(()=>normalizeInlineStyles('text',[{start:-1,end:2,bold:true}])).toThrow();
  expect(()=>normalizeInlineStyles('text',[{start:0,end:5,bold:true}])).toThrow();
 });
 it('derives fragments within a word; repeated words retain their distinct styles',()=>{
  expect(styledFragments('milk milk',[{start:5,end:9,bold:true}],0,4)).toEqual([{text:'milk',start:0,end:4}]);
  expect(styledFragments('unbelievable',[{start:2,end:8,italic:true}],0,12)).toEqual([{text:'un',start:0,end:2},{text:'believ',start:2,end:8,italic:true},{text:'able',start:8,end:12}]);
 });
});

describe('inline Markdown import and export',()=>{
 it.each([
  '**bold and *nested* text**',
  'un**believ**able',
  'milk **milk** *milk*',
  '~~old **bold**~~ and ***both***',
  '**😀😀** and *é*',
  '  **first**  *second*  ',
  '**first second**',
  'first\\nsecond',
  'first\\n\\nsecond',
  '\\*literal\\* and **marked**',
  '**a** *b* ~~c~~',
 ])('preserves plain text and normalized marks through Markdown round trip: %s',input=>{
  const markdown=input.replace(/\\n/g,'\n');
  const parsed=parseInlineMarkdown(markdown);
  expect(parseInlineMarkdown(serializeInlineMarkdown(parsed.text,parsed.styles))).toEqual(parsed);
 });
 it('records decoded text offsets rather than Markdown delimiter/escape offsets',()=>{
  expect(parseInlineMarkdown('\\*a\\* **😀b**')).toEqual({text:'*a* 😀b',styles:[{start:4,end:7,bold:true}]});
  expect(parseInlineMarkdown('  **hi**  ')).toEqual({text:'  hi  ',styles:[{start:2,end:4,bold:true}]});
 });
 it('preserves empty and whitespace-only plain content',()=>{
  for(const text of ['', ' ', '   ', '\n', '\n\n','  x\n\n  y  '])expect(parseInlineMarkdown(serializeInlineMarkdown(text))).toEqual({text,styles:[]});
 });
 it('rejects unsupported inline structures rather than flattening them',()=>{
  for(const markdown of ['![image](image.jpg)','<b>html</b>'])expect(()=>parseInlineMarkdown(markdown)).toThrow('Unsupported inline Markdown');
 });
 it('preserves marked boundary whitespace through Markdown character references',()=>{
  const styles=[{start:0,end:3,bold:true}];
  expect(parseInlineMarkdown(serializeInlineMarkdown(' x ',styles))).toEqual({text:' x ',styles});
 });
 it('export escapes literal delimiters and does not reinterpret ordinary text as a mark',()=>{
  for(const text of ['a * b ** c ~~ d','[ordinary]','<word>','back\\slash','https://example.test'])expect(parseInlineMarkdown(serializeInlineMarkdown(text))).toEqual({text,styles:[]});
 });
});

describe('font composition',()=>{
 it('combines inline bold/italic with heading weight and leaves strike metrics unchanged',()=>{
  const base='27px system-ui, sans-serif';
  expect(styleFont(base,{bold:true,italic:true})).toBe('italic 700 '+base);
  expect(styleFont('700 '+base,{italic:true})).toBe('italic 700 '+base);
  expect(styleFont('italic 700 '+base,{italic:true,bold:true})).toBe('italic 700 '+base);
  expect(styleFont(base,{strike:true})).toBe(base);
  expect(()=>styleFont('inherit',{bold:true})).toThrow('font');
 });
});

it('preserves inline code and links as editable text and metadata through edits and sharing',()=>{
 const parsed=parseInlineMarkdown('Use **[the source](https://example.test)** and `value`.');
 expect(parsed.text).toBe('Use the source and value.');
 expect(parsed.styles).toEqual(expect.arrayContaining([expect.objectContaining({bold:true,href:'https://example.test'}),expect.objectContaining({code:true})]));
 expect(parseInlineMarkdown(serializeInlineMarkdown(parsed.text,parsed.styles))).toEqual(parsed);
 const edited=deleteInlineStyles(parsed.text,parsed.styles,[{start:0,end:4}]);
 expect(parseInlineMarkdown(serializeInlineMarkdown(edited.text,edited.styles))).toEqual(edited);
});
