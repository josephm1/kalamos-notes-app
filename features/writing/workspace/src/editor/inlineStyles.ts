import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfmToMarkdown } from 'mdast-util-gfm';
import type { PhrasingContent, Root, Text } from 'mdast';

/** UTF-16 ranges into authoritative plain text. Coordinates never determine formatting. */
export type InlineStyle = { start:number; end:number; bold?:boolean; italic?:boolean; strike?:boolean;code?:boolean;href?:string };
export type InlineFlags = Pick<InlineStyle,'bold'|'italic'|'strike'|'code'|'href'>;
export type TextRange = { start:number; end:number };
export type StyledFragment = InlineStyle & { text:string };
export type StyledText = { text:string; styles:InlineStyle[] };
const flags = (value:InlineFlags):InlineFlags => ({...(value.bold?{bold:true}:{}),...(value.italic?{italic:true}:{}),...(value.strike?{strike:true}:{}),...(value.code?{code:true}:{}),...(value.href?{href:value.href}:{})});
const same = (a:InlineFlags,b:InlineFlags) => !!a.bold===!!b.bold && !!a.italic===!!b.italic && !!a.strike===!!b.strike && !!a.code===!!b.code && a.href===b.href;
const marked = (style:InlineFlags) => !!(style.bold||style.italic||style.strike||style.code||style.href);
function boundary(text:string,index:number) {
 return Number.isInteger(index)&&index>=0&&index<=text.length && !(index>0&&index<text.length&&/[\uD800-\uDBFF]/.test(text[index-1])&&/[\uDC00-\uDFFF]/.test(text[index]));
}
function validateRange(text:string,range:TextRange) {
 if(!boundary(text,range.start)||!boundary(text,range.end)||range.start>range.end)throw new Error('Invalid inline text range.');
}
function append(result:InlineStyle[],style:InlineStyle) {
 if(style.start===style.end||!marked(style))return;
 const previous=result[result.length-1];
 if(previous&&previous.end===style.start&&same(previous,style))previous.end=style.end;
 else result.push({start:style.start,end:style.end,...flags(style)});
}
/** Overlapping input marks become disjoint combined flags; callers' arrays are never mutated. */
export function normalizeInlineStyles(text:string,styles:readonly InlineStyle[]=[]):InlineStyle[] {
 const events=new Map<number,{style:InlineStyle;delta:number}[]>();
 for(const style of styles){
  validateRange(text,style);
  for(const key of ['bold','italic','strike','code'] as const)if(style[key]!==undefined&&typeof style[key]!=='boolean')throw Error('Invalid inline style.');
  if(style.href!==undefined&&(typeof style.href!=='string'||style.href.length>8192))throw Error('Invalid inline link.');
  if(style.start===style.end)continue;
  for(const [at,delta] of [[style.start,1],[style.end,-1]]){const values=events.get(at)??[];values.push({style,delta});events.set(at,values);}
 }
 const result:InlineStyle[]=[],active={bold:0,italic:0,strike:0,code:0},links=new Map<string,number>();let previous=0;
 for(const [at,values] of [...events].sort(([a],[b])=>a-b)) {
  if(links.size>1)throw Error('Conflicting inline links.');
  const href=links.keys().next().value;
  append(result,{start:previous,end:at,bold:active.bold>0,italic:active.italic>0,strike:active.strike>0,code:active.code>0,...(href?{href}:{})});
  for(const {style,delta} of values){
   for(const key of ['bold','italic','strike','code'] as const)if(style[key])active[key]+=delta;
   if(style.href){const count=(links.get(style.href)??0)+delta;if(count)links.set(style.href,count);else links.delete(style.href);}
  }
  previous=at;
 }
 return result;
}
/** Clip already-normalized ranges to a substring and shift its origin to zero. */
export function clipInlineStyles(styles:readonly InlineStyle[],start:number,end:number):InlineStyle[] {
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start)throw new Error('Invalid inline text range.');
 const result:InlineStyle[]=[];
 for(const style of styles){const left=Math.max(start,style.start),right=Math.min(end,style.end);if(right>left)append(result,{start:left-start,end:right-start,...flags(style)});}
 return result;
}
/** All offsets are relative to the pre-edit text; overlapping deletions are applied only once. */
export function deleteInlineStyles(text:string,styles:readonly InlineStyle[],ranges:readonly TextRange[]):StyledText {
 const normalized=normalizeInlineStyles(text,styles),cuts:TextRange[]=[];
 for(const range of [...ranges].sort((a,b)=>a.start-b.start)){
  validateRange(text,range);if(range.start===range.end)continue;
  const prior=cuts[cuts.length-1];if(prior&&range.start<=prior.end)prior.end=Math.max(prior.end,range.end);else cuts.push({...range});
 }
 const result:StyledText={text:'',styles:[]};let cursor=0;
 const keep=(start:number,end:number)=>{
  const offset=result.text.length;result.text+=text.slice(start,end);
  for(const style of clipInlineStyles(normalized,start,end))append(result.styles,{...style,start:style.start+offset,end:style.end+offset});
 };
 for(const cut of cuts){keep(cursor,cut.start);cursor=cut.end;}keep(cursor,text.length);return result;
}
export function styledFragments(text:string,styles:readonly InlineStyle[]=[],start=0,end=text.length):StyledFragment[] {
 validateRange(text,{start,end});const normalized=normalizeInlineStyles(text,styles),result:StyledFragment[]=[];let cursor=start;
 const add=(left:number,right:number,style:InlineFlags={})=>{if(right>left)result.push({text:text.slice(left,right),start:left,end:right,...flags(style)});};
 for(const style of normalized){const left=Math.max(start,style.start),right=Math.min(end,style.end);if(right<=left)continue;add(cursor,left);add(left,right,style);cursor=right;}
 add(cursor,end);return result;
}

const parser=unified().use(remarkParse).use(remarkGfm);
/** Parse inline Markdown only. Blank paragraph separators stay literal text inside the box. */
export function parseInlineMarkdown(markdown:string):StyledText {
 // Framing retains leading/trailing spaces without treating a typed annotation's leading
 // indentation as a code block. Spaces around the sentinels preserve delimiter boundaries.
 const prefix='\uE000 ',suffix=' \uE001';
 const input='\uE000&#x20;'+markdown+'&#x20;\uE001';
 const tree=parser.parse(input) as Root;
 let text='';const styles:InlineStyle[]=[];
 const visit=(node:PhrasingContent,active:InlineFlags)=>{
  if(node.type==='text'){const start=text.length;text+=node.value;append(styles,{start,end:text.length,...active});return;}
  if(node.type==='inlineCode'){const start=text.length;text+=node.value;append(styles,{start,end:text.length,...active,code:true});return;}
  if(node.type==='link'){
   const bare=node.children.every(child=>child.type==='text')&&(!node.position||!input.slice(node.position.start.offset,node.position.end.offset).startsWith('['));
   node.children.forEach(child=>visit(child,bare?active:{...active,href:node.url}));return;
  }
  if(node.type==='break'){const start=text.length;text+='\n';append(styles,{start,end:text.length,...active});return;}
  if(node.type==='strong'||node.type==='emphasis'||node.type==='delete'){
   const next={...active,...(node.type==='strong'?{bold:true}:node.type==='emphasis'?{italic:true}:{strike:true})};
   node.children.forEach(child=>visit(child,next));return;
  }
  throw new Error(`Unsupported inline Markdown: ${node.type}. Supported inline types are text, code, links and emphasis.`);
 };
 let previousEnd:number|undefined;
 for(const node of tree.children){
  if(node.type!=='paragraph')throw new Error(`Unsupported inline Markdown block: ${node.type}.`);
  if(previousEnd!==undefined){const start=node.position?.start.offset;if(start===undefined)throw new Error('Missing Markdown position.');text+=input.slice(previousEnd,start);}
  node.children.forEach(child=>visit(child,{}));previousEnd=node.position?.end.offset;
 }
 if(!text.startsWith(prefix)||!text.endsWith(suffix))throw new Error('Unsupported inline Markdown boundary.');
 const plain=text.slice(prefix.length,-suffix.length);
 return {text:plain,styles:normalizeInlineStyles(plain,clipInlineStyles(normalizeInlineStyles(text,styles),prefix.length,text.length-suffix.length))};
}

/** Serialize derived markup; it is never a second authoritative document. */
export function serializeInlineMarkdown(text:string,styles:readonly InlineStyle[]=[]):string {
 const normalized=normalizeInlineStyles(text,styles);
 type Container={children:PhrasingContent[]};
 const prefix='\uE000 ',suffix=' \uE001';
 const paragraph:{type:'paragraph';children:PhrasingContent[]}={type:'paragraph',children:[{type:'text',value:prefix}]};
 const stack:{kind:string;node:Container}[]=[{kind:'paragraph',node:paragraph}];
 for(const fragment of styledFragments(text,normalized)){
  const active=[...(fragment.href?['link:'+fragment.href]:[]),...(fragment.bold?['strong']:[]),...(fragment.italic?['emphasis']:[]),...(fragment.strike?['delete']:[])];
  // Preserve an existing outer mark while adding a nested mark, including a marked space.
  const continuing=stack.slice(1).map(entry=>entry.kind).filter(kind=>active.includes(kind));
  const kinds=[...continuing,...active.filter(kind=>!continuing.includes(kind))];
  let shared=0;while(shared<kinds.length&&stack[shared+1]?.kind===kinds[shared])shared++;
  stack.splice(shared+1);
  for(const kind of kinds.slice(shared)){
   const node=kind.startsWith('link:')?{type:'link' as const,url:kind.slice(5),children:[] as PhrasingContent[]}:{type:kind as 'strong'|'emphasis'|'delete',children:[] as PhrasingContent[]};
   stack[stack.length-1].node.children.push(node);stack.push({kind,node});
  }
  const children=stack[stack.length-1].node.children,previous=children[children.length-1];
  if(fragment.code){children.push({type:'inlineCode',value:fragment.text});continue;}
  if(previous?.type==='text')(previous as Text).value+=fragment.text;else children.push({type:'text',value:fragment.text});
 }
 paragraph.children.push({type:'text',value:suffix});
 const framed=toMarkdown({type:'root',children:[paragraph]},{extensions:[gfmToMarkdown()],emphasis:'*',strong:'*'}).replace(/\n$/,'');
 const left=/^\uE000(?: |&#x20;)/.exec(framed),right=/(?: |&#x20;)\uE001$/.exec(framed);
 if(!left||!right)throw new Error('Unsupported Markdown serialization boundary.');
 const markdown=framed.slice(left[0].length,-right[0].length);
 // CommonMark cannot represent every arbitrary marked whitespace range. Never silently
 // alter text or formatting when those cases occur (including delimiter-boundary ambiguity).
 const roundtrip=parseInlineMarkdown(markdown);
 if(roundtrip.text!==text||JSON.stringify(roundtrip.styles)!==JSON.stringify(normalized))throw new Error('This formatting cannot be represented as inline Markdown without changing the text or marks.');
 return markdown;
}
/** Add marks to a host-owned CSS font. Strike is rendered separately and never changes width. */
export function styleFont(baseFont:string,style:InlineFlags):string {
 if(!style.bold&&!style.italic)return baseFont;
 const size=/(?:^|\s)(?:\d*\.)?\d+(?:px|pt|em|rem|%)(?:\/[^\s]+)?\s/.exec(baseFont);
 if(!size)throw new Error('Unsupported base text font.');
 const split=size.index+(size[0].startsWith(' ')?1:0),prefix=baseFont.slice(0,split).trim().split(/\s+/).filter(Boolean);
 const retained=prefix.filter(p=>p!=='normal'&&!(style.bold&&(p==='bold'||p==='bolder'||/^[1-9]00$/.test(p)))&&!(style.italic&&(p==='italic'||p==='oblique')));
 if(style.italic)retained.unshift('italic');
 if(style.bold)retained.push('700');
 return [...retained,baseFont.slice(split)].join(' ');
}
