import type { Sidecar } from '../sidecar/schema';
import { projectSemantic, type SemanticBlock } from './semanticDocument';
import { semanticBlocksToMarkdown } from './semanticMarkdown';

/** Portable text only. Ink/layout remain in the notebook, never in the shared text. */
export function notebookSheetsToMarkdown(sheets: {source:string;sidecar:Sidecar|undefined}[]):string {
  const seenPreviews=new Set<string>();
  return sheets.map((sheet,page)=>{
    const source=sheet.source.replace(/\u200b/g,'').trim();
    const blocks:SemanticBlock[]=[];
    for(const block of (sheet.sidecar?projectSemantic('',sheet.sidecar,`page-${page}`):[])) {
      const previous=blocks.find(candidate=>candidate.id===block.id);
      if(previous){
        const offset=previous.text.length+1;
        previous.text+='\n'+block.text;
        if(block.styles?.length)previous.styles=[...(previous.styles??[]),...block.styles.map(style=>({...style,start:style.start+offset,end:style.end+offset}))];
      } else blocks.push({...block});
    }
    const boxes=sheet.sidecar?.textBoxes??[];
    const entries:( {y:number;block:SemanticBlock}|{y:number;source:string;id:string})[]=blocks.map(block=>({block,y:Math.min(...boxes.filter(box=>(box.semantic?.id??`text-page-${page}-${box.id}`)===block.id).map(box=>box.y))}));
    for(const object of sheet.sidecar?.pageObjects??[])if(object.kind==='markdown'&&object.markdown)entries.push({y:object.y,source:object.markdown.source,id:object.markdown.id});
    entries.sort((a,b)=>a.y-b.y);
    const parts:string[]=source?[source]:[];let batch:SemanticBlock[]=[];
    const flush=()=>{
      if(!batch.length)return;
      const ids=new Set(batch.map(block=>block.id));
      parts.push(semanticBlocksToMarkdown(batch.map(block=>block.parentId&&!ids.has(block.parentId)?(({parentId,...rest})=>rest)(block):block)).trim());batch=[];
    };
    for(const entry of entries) {
      if('block' in entry){batch.push(entry.block);continue;}
      flush();if(!seenPreviews.has(entry.id)){seenPreviews.add(entry.id);parts.push(entry.source);}
    }
    flush();return parts.filter(Boolean).join('\n\n');
  }).filter(Boolean).join('\n\n');
}
