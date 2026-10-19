import { createEmptySidecar, type Sidecar, type TextBox } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';
import { placeBoxWords, ruledTextSize, sliceBoxWords, ruledTextFont } from './textBox';
import { semanticDepths, semanticOrder } from './semanticHierarchy';
import { clipInlineStyles, normalizeInlineStyles, styleFont, type InlineStyle } from './inlineStyles';
import { measureStyledText } from './textBox';
export type SemanticBlock = {id:string;type:'heading'|'paragraph'|'bullet'|'numbered'|'task';text:string;checked?:boolean;ordinal?:number;parentId?:string;styles?:InlineStyle[];preview?:{source:string;lines:string[]}};
export type SemanticBinding = {id:string;type:SemanticBlock['type'];role:'text'|'checkbox';continuation?:boolean;sourceInkRegionIds?:string[];parentId?:string};
/** Text stays owned by editable text boxes. Bindings carry identity/type, never a duplicate text. */
export function projectSemantic(source:string, sidecar:Sidecar, pageId:string):SemanticBlock[] {
 const result:SemanticBlock[]=[];
 if(source.replace(/\u200b/g,'').trim())result.push({id:`source-${pageId}`,type:'paragraph',text:source.replace(/\u200b/g,'')});
 const boxes=sidecar.textBoxes??[];
 const checks=new Map(boxes.filter(b=>b.semantic?.role==='checkbox').map(b=>[b.semantic!.id,b.text==='☑']));
 for(const b of boxes.filter(b=>!b.checkbox).sort((a,b)=>a.y-b.y||a.x-b.x)){
  const s=b.semantic;result.push({id:s?.id??`text-${pageId}-${b.id}`,type:s?.type??'paragraph',text:s?.type==='bullet'&&!s.continuation?b.text.replace(/^• /,''):s?.type==='numbered'&&!s.continuation?b.text.replace(/^\d+\. /,''):b.text,
   ...(s?.type==='task'?{checked:checks.get(s.id)??false}:{}),...(s?.type==='numbered'&&!s.continuation&&/^\d+\. /.test(b.text)?{ordinal:Number(b.text.match(/^\d+/)![0])}:{}),...(s?.parentId?{parentId:s.parentId}:{}),
   ...(b.styles?.length?{styles:clipInlineStyles(b.styles,s?.type==='bullet'&&!s.continuation?2:s?.type==='numbered'&&!s.continuation?(b.text.match(/^\d+\. /)?.[0].length??0):0,b.text.length)}:{})});
 }
 const known=new Set(result.map(block=>block.id));
 return result.map(block=>block.parentId&&!known.has(block.parentId)?(({parentId,...rest})=>rest)(block):block);
}
export type SemanticGeometry = { measure?: (text:string)=>number; space?:number; paperWidth?:number; paperHeight?:number; sourceRows?:number[]; sourceXs?:number[] };
/** Use the very same ruled font as the editor. Callers can inject measurement in non-DOM tests. */
export function ruledTextMeasure(lineHeight:number,type?:string):(text:string)=>number {
 const context=typeof document==='undefined'?null:document.createElement('canvas').getContext('2d');
 if(!context)throw new Error('Ruled text measurement is unavailable');
 context.font=ruledTextFont(lineHeight,type);
 return text=>context.measureText(text).width;
}
/** Native geometry is never model supplied. Materialize supported blocks into existing editor controls. */
export function materializeSemantic(blocks:SemanticBlock[],title:string,width:number,height:number,lineHeight=56,geometry:SemanticGeometry={}){
 const sheets:{source:string;sidecar:Sidecar}[]=[];
 const w=Math.max(120,geometry.paperWidth??width-24),h=Math.max(24,Math.min(120,lineHeight));
 const rows=Math.max(2,Math.floor((geometry.paperHeight??height-64)/h));
 const normalMeasure=geometry.measure??ruledTextMeasure(h);
 const headingMeasure=geometry.measure??ruledTextMeasure(h,'heading');
 const size=ruledTextSize(h),textWidth=Math.max(40,w-84);
 const depths=semanticDepths(blocks);
 let row=0, number=0;
 const page=()=>{const source='\u200b',sidecar=createEmptySidecar(title,fingerprintOf(source).hash);sidecar.layoutLineHeight=h;sidecar.textBoxes=[];sidecar.sourceWords=[{text:source,x:0,y:0}];sheets.push({source,sidecar});row=0;return sidecar;};
 let sidecar=page();
 for(const [blockIndex,block] of (geometry.sourceRows?blocks:semanticOrder(blocks)).entries()){
  if(geometry.sourceRows) {
   const sourceRow=geometry.sourceRows[blockIndex];
   if(!Number.isInteger(sourceRow)||sourceRow<row||sourceRow>=rows)throw Error("Markdown rows do not fit the original ruled grid. Original page retained.");
   row=sourceRow;
  }
  if(block.preview) {
   let offset=0;
   while(offset<block.preview.lines.length) {
    if(row>=rows)sidecar=page();
    const count=Math.min(rows-row,block.preview.lines.length-offset);
    sidecar.pageObjects??=[];
    sidecar.pageObjects.push({id:`preview-${block.id}-${offset}`,kind:'markdown',x:8,y:row*h,width:w-16,height:count*h,color:'#000000',strokeWidth:1,
      markdown:{id:block.id,source:block.preview.source,lines:block.preview.lines.slice(offset,offset+count)}});
    row+=count;offset+=count;
   }
   continue;
  }
  const measure=block.type==='heading'?headingMeasure:normalMeasure;
  const space=geometry.space??Math.max(4,measure('x x')-2*measure('x'));
  const prefix=block.type==='bullet'?'• ':block.type==='numbered'?`${block.ordinal??++number}. `:'';
  const indent=(depths.get(block.id)??0)*h/2;
  const left=geometry.sourceXs?Math.max(0,geometry.sourceXs[blockIndex]):16+indent;
  const available=geometry.sourceXs?Math.max(1,w-left-(block.type==='task'?52:8)):Math.max(40,textWidth-indent);
  const text=prefix+block.text,styles=normalizeInlineStyles(block.text,block.styles??[]).map(mark=>({...mark,start:mark.start+prefix.length,end:mark.end+prefix.length}));
  const context=styles.length?document.createElement('canvas').getContext('2d'):null;
  if(styles.length&&!context)throw Error('Styled text measurement is unavailable');
  const measureRange=styles.length?(value:string,start:number)=>measureStyledText(text,styles,start,start+value.length,(part,mark)=>{context!.font=styleFont(ruledTextFont(h,block.type),mark);return context!.measureText(part).width;}):undefined;
  const words=placeBoxWords(text,left,0,available,h,measure,space,measureRange);
  if(geometry.sourceRows && words.some(word=>word.y>=h || word.x+(measureRange?measureRange(word.text,word.textStart??0):measure(word.text))>w-(block.type==='task'?52:8)))throw Error("Formatted text is too wide for its original ruled row. Original page retained.");
  // Empty/whitespace-only blocks still own one editable annotation and retain their exact text.
  let first=0,part=0,baseLine=0;
  do {
   if(row>=rows)sidecar=page();
   const limit=baseLine+rows-row;
   let end=first;while(end<words.length&&words[end].y/h<limit)end++;
   if(end===first&&first<words.length){sidecar=page();baseLine=Math.floor(words[first].y/h);continue;}
   const piece=words.length?sliceBoxWords(text,words,first,end):{text,words:[]};
   const id=part?`${block.id}-part-${part}`:block.id;
   const placed=piece.words.map(word=>({...word,y:word.y+(row-baseLine)*h}));
   const semantic:SemanticBinding={id:block.id,type:block.type,role:'text',...(block.parentId?{parentId:block.parentId}:{}),...(part?{continuation:true}:{})};
   const offset=words.length?(first===0?0:words[first].textStart!):0;
   const pieceStyles=clipInlineStyles(styles,offset,offset+piece.text.length);
   const box:TextBox={id:`semantic-${id}`,blockId:'planning-document',text:piece.text,x:left,y:row*h,width:available,size,autoWidth:false,...(block.type==='heading'?{fontWeight:700 as const}:{}),...(pieceStyles.length?{styles:pieceStyles}:{}),semantic,words:placed};
   sidecar.textBoxes!.push(box);
   if(block.type==='task'&&part===0)sidecar.textBoxes!.push({id:`check-${id}`,blockId:'planning-document',text:block.checked?'☑':'☐',checkbox:true,x:w-44,y:placed[0]?.y??row*h,width:36,size,semantic:{id:block.id,type:'task',role:'checkbox',...(block.parentId?{parentId:block.parentId}:{})}});
   // The ruled line is the spacing unit. Do not invent an empty row per element:
   // short checklists otherwise spill onto extra pages during each AI round trip.
   // Explicit blank lines inside text remain represented by placeBoxWords.
   row=placed.length?Math.round(placed[placed.length-1].y/h)+1:row+1;
   first=end;part++;baseLine=end<words.length?Math.floor(words[end].y/h):0;
  }while(first<words.length);
 }
 return sheets;
}

/** Bound task controls follow their text element; deleting the text deletes only its paired control. */
export function synchronizeTaskControls(boxes:TextBox[]):TextBox[]{
 const owners=new Map<string,TextBox>();
 for(const b of boxes)if(b.semantic?.role==='text'&&!owners.has(b.semantic.id))owners.set(b.semantic.id,b);
 return boxes.flatMap(b=>{
  if(b.semantic?.role!=='checkbox')return [b];
  const owner=owners.get(b.semantic.id);if(!owner)return [];
  const y=owner.words?.[0]?.y??owner.y;
  return [{...b,y,words:b.words?.map(w=>({...w,y}))}];
 });
}
export function copySemanticBindings(sidecar:Sidecar,newId:()=>string):Sidecar{
 const ids=new Map<string,string>();
 for(const box of sidecar.textBoxes??[])if(box.semantic&&!ids.has(box.semantic.id))ids.set(box.semantic.id,newId());
 const markdownIds=new Map<string,string>();
 for(const object of sidecar.pageObjects??[])if(object.markdown&&!markdownIds.has(object.markdown.id))markdownIds.set(object.markdown.id,newId());
 return {...sidecar,pageObjects:sidecar.pageObjects?.map(object=>object.markdown?{...object,markdown:{...object.markdown,id:markdownIds.get(object.markdown.id)!}}:object),textBoxes:sidecar.textBoxes?.map(box=>{
  if(!box.semantic)return box;
  let id=ids.get(box.semantic.id);if(!id){id=newId();ids.set(box.semantic.id,id);}
  return {...box,semantic:{...box.semantic,id,...(box.semantic.parentId?{parentId:ids.get(box.semantic.parentId)??box.semantic.parentId}:{})}};
 })};
}
