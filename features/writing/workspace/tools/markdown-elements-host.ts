import { parseNotesMarkdown } from '../src/editor/markdownTranscription';
import { materializeSemantic } from '../src/editor/semanticDocument';
/** Host smoke test uses the production Markdown parser. No source ink is changed. */
export function materializeMarkdownSmoke(markdown:string,width:number,height:number,lineHeight=56) {
 const blocks=parseNotesMarkdown(markdown);
 const sheets=materializeSemantic(blocks,blocks.find(b=>b.type==='heading')?.text??'Note',width,height,lineHeight,{paperWidth:width,paperHeight:height});
 return {blocks,sheets,flattenedStyles:[],sourceInkBound:false};
}
