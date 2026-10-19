import { normalizeCheckboxNodes } from "./checkboxMarkdown";
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { List, PhrasingContent, Root } from 'mdast';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { clipInlineStyles, parseInlineMarkdown } from './inlineStyles';
import type { SemanticBlock } from './semanticDocument';
import type { InkRegion, TranscriptionBlock } from './inkTranscription';
import { freeInkLaneIndex } from './inkPlacement';

/** Standard Markdown is the model output. IDs, vector ownership and placement are local. */
export function parseNotesMarkdown(markdown:string, literalNumbers=false):SemanticBlock[] {
 if(!markdown.trim()||markdown.length>60000||markdown.includes('\0'))throw Error('Empty or oversized Markdown result.');
 const root=unified().use(remarkParse).use(remarkGfm).parse(markdown) as Root;
 return semanticBlocksFromMarkdownTree(root,markdown,literalNumbers);
}

/** One AST-to-editable-block contract for imported Markdown and AI Markdown. */
export function semanticBlocksFromMarkdownTree(root:Root,markdown:string,literalNumbers=false,preserveOrdinals=false):SemanticBlock[] {
 normalizeCheckboxNodes(root);
 const blocks:SemanticBlock[]=[];
 const inline=(nodes:PhrasingContent[])=>parseInlineMarkdown(toMarkdown({type:'root',children:[{type:'paragraph',children:nodes}]},{extensions:[gfmToMarkdown()]}).trimEnd());
 function add(type:SemanticBlock['type'],nodes:PhrasingContent[],parentId?:string,checked?:boolean){
  const value=inline(nodes);
  if(!value.text.trim())throw Error('Markdown element needs readable text.');
  const block:SemanticBlock={id:`markdown-${blocks.length+1}`,type,text:value.text,...(value.styles.length?{styles:value.styles}:{}),...(parentId?{parentId}:{}),...(type==='task'?{checked:checked??false}:{})};
  blocks.push(block);return block.id;
 }
 function list(node:List,parentId?:string){
  for(const item of node.children){
   const paragraphs=item.children.filter(child=>child.type==='paragraph');
   if(!paragraphs.length)throw Error('Markdown list item needs text.');
   const nested=item.children.findIndex(child=>child.type==='list');
   if(nested>=0&&item.children.slice(nested+1).some(child=>child.type==='paragraph'))throw Error('Unsupported interleaved list paragraphs.');
   // Full-page formatting retains the exact marker as editable text. The shared
   // numbered-block contract has no start/ordinal field and would renumber it.
   const numbered=literalNumbers&&node.ordered&&typeof item.checked!=='boolean';
   const marker=numbered?markdown.slice(item.position!.start.offset!).match(/^\d+[.)]/)?.[0]:undefined;
   if(numbered&&!marker)throw Error('Numbered Markdown item is missing its marker.');
   const nodes=paragraphs.flatMap((p,i)=>i?[{type:'text' as const,value:'\n'},...p.children]:p.children);
   const owner=add(numbered?'paragraph':typeof item.checked==='boolean'?'task':node.ordered?'numbered':'bullet',numbered?[{type:'text',value:marker+' '},...nodes]:nodes,parentId,item.checked??undefined);
   if(preserveOrdinals&&node.ordered&&!numbered&&typeof item.checked!=='boolean') {
    const marker=markdown.slice(item.position!.start.offset!).match(/^\d+[.)]/)?.[0];
    if(!marker)throw Error('Numbered Markdown item is missing its marker.');
    blocks.find(block=>block.id===owner)!.ordinal=Number.parseInt(marker,10);
   }
   for(const child of item.children)if(child.type==='list')list(child,owner);
   else if(child.type!=='paragraph')throw Error(`Unsupported list content: ${child.type}`);
  }
 }
 for(const node of root.children){
  // Heading scope is not list membership: unrelated following actions must not
  // become children of a shopping heading until the next heading appears.
  if(node.type==='heading')add('heading',node.children);
  else if(node.type==='paragraph')add('paragraph',node.children);
  else if(node.type==='list')list(node);
  else if(node.type==='html'&&/^\s*(?:<!--[\s\S]*?-->\s*)+$/.test(node.value))continue;
  else throw Error(`Unsupported Markdown content: ${node.type}`);
 }
 if(!blocks.length)throw Error('No editable Markdown content.');
 return blocks;
}

/** Preserve Markdown soft breaks as distinct editable ruled rows, including inline style offsets. */
export function parseNotesMarkdownRows(markdown:string,literalNumbers=false):SemanticBlock[]{
 return parseNotesMarkdown(markdown,literalNumbers).flatMap(block=>{
  if(!block.text.includes('\n'))return [block];
  let offset=0;
  return block.text.split('\n').flatMap((text,index)=>{
   const start=offset;offset+=text.length+1;
   if(!text.trim())return [];
   const styles=clipInlineStyles(block.styles??[],start,start+text.length);
   return [{...block,id:index?`${block.id}-line-${index}`:block.id,text,...(styles.length?{styles}:{styles:undefined}),...(index&&block.type==='task'?{type:'paragraph' as const,checked:undefined}:{})}];
  });
 });
}

/** Bind reading-order Markdown to saved ruled lines without asking the model for coordinates.
 * A split label + first item can share its original handwritten line. Other line
 * Joined multiword prose is split locally across consecutive source rows; other
 * count mismatches fail before deleting ink rather than guessing away a drawing.
 */
export function bindMarkdownResultToInk(markdown:string,regions:InkRegion[],lineHeight:number):{blocks:TranscriptionBlock[];sourceLines:boolean} {
 if(!regions.length||new Set(regions.map(r=>r.id)).size!==regions.length||new Set(regions.map(r=>r.pageId)).size!==1)throw Error('Markdown replacement needs one saved page.');
 if(!Number.isFinite(lineHeight)||lineHeight<24)throw Error('Invalid ruled line height.');
 const rows=new Map<number,InkRegion[]>();
 for(const region of regions){
  const b=region.bounds;
  if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)throw Error('Invalid handwriting bounds.');
  const row=freeInkLaneIndex(b.y,b.height,lineHeight);
  if(!rows.has(row))rows.set(row,[]);rows.get(row)!.push(region);
 }
 const orderedRows=[...rows.entries()].sort((a,b)=>a[0]-b[0]);
 const lines=orderedRows.map(([,refs])=>refs.sort((a,b)=>a.bounds.x-b.bounds.x).map(r=>r.id));
 let blocks:SemanticBlock[]=parseNotesMarkdownRows(markdown);
 // Markdown prose can join adjacent handwritten lines. Restore those line breaks
 // locally using their relative ink spans; the model never supplies coordinates.
 // Only multiword prose and consecutive, separated-word rows qualify. A short
 // label or isolated drawing must not absorb an otherwise unmatched ink row.
 const missing=lines.length-blocks.length;
 if(missing>0){
  for(let i=0;i<blocks.length;i++){
   const block=blocks[i],words=[...block.text.matchAll(/\S+/g)];
   const source=orderedRows.slice(i,i+missing+1);
   if(!['heading','paragraph'].includes(block.type)||words.length<(missing+1)*2||source.length!==missing+1)continue;
   if(source.some(([row,refs],index)=>refs.length<2 || index>0&&row!==source[index-1][0]+1))continue;
   const spans=source.map(([,refs])=>Math.max(...refs.map(r=>r.bounds.x+r.bounds.width))-Math.min(...refs.map(r=>r.bounds.x)));
   if(spans.some(span=>span<lineHeight*3))continue;
   const total=spans.reduce((a,b)=>a+b,0),split:SemanticBlock[]=[];
   let startWord=0,weight=0;
   for(let row=0;row<source.length;row++){
    weight+=spans[row];
    let endWord=words.length;
    if(row<source.length-1){
     const target=block.text.length*weight/total;
     endWord=startWord+1;
     for(let end=startWord+1;end<=words.length-(source.length-row-1);end++){
      const boundary=words[end-1].index!+words[end-1][0].length;
      const best=words[endWord-1].index!+words[endWord-1][0].length;
      if(Math.abs(boundary-target)<Math.abs(best-target))endWord=end;
     }
    }
    const start=words[startWord].index!,end=words[endWord-1].index!+words[endWord-1][0].length;
    const styles=clipInlineStyles(block.styles??[],start,end);
    split.push({...block,id:row?`${block.id}-source-line-${row}`:block.id,text:block.text.slice(start,end),styles:styles.length?styles:undefined});
    startWord=endWord;
   }
   blocks=[...blocks.slice(0,i),...split,...blocks.slice(i+1)];break;
  }
 }
 const counts=blocks.map(b=>b.text.split('\n').filter(s=>s.trim()).length);
 let excess=counts.reduce((a,b)=>a+b,0)-lines.length;
 const shared=new Set<number>();
 // Formatting may split "Buy - Milk" into a label and a task. Exclude the page
 // title and share only adjacent non-task labels with their first list item.
 for(let i=1;i<blocks.length-1&&excess>0;i++){
  const label=blocks[i],item=blocks[i+1];
  const styledLabel=label.type==='paragraph'&&label.styles?.some(s=>s.bold&&s.start===0&&s.end===label.text.length);
  if(counts[i]===1&&counts[i+1]===1&&(label.type==='heading'||styledLabel||label.type==='task'&&item.parentId===label.id)&&['task','bullet','numbered'].includes(item.type)){
   shared.add(i+1);excess--;
  }
 }
 if(excess!==0)throw Error('Markdown does not match the handwritten line count. Your original ink is retained.');
 let cursor=0;
 const result=blocks.map((block,index)=>{
  const sourceInkRegionIds=shared.has(index)?lines[cursor-1]:lines.slice(cursor,cursor+counts[index]).flat();
  if(!shared.has(index))cursor+=counts[index];
  return {...block,sourceInkRegionIds};
 });
 // Multiple inserted labels/subtask splits need ordinary local ruled reflow;
 // model-supplied geometry is never involved. One split stays on its source row.
 return {blocks:result,sourceLines:shared.size<=1};
}
export function bindMarkdownToInk(markdown:string,regions:InkRegion[],lineHeight:number):TranscriptionBlock[]{
 return bindMarkdownResultToInk(markdown,regions,lineHeight).blocks;
}
