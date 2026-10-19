import { materializeTranscriptionPage, type InkRegion, type TranscriptionBlock } from '../src/editor/inkTranscription';
import { bindMarkdownResultToInk } from '../src/editor/markdownTranscription';
import { materializeSemantic } from '../src/editor/semanticDocument';
export function materializeHostResult(snapshot:any,results:any){
const proposal=results.results?.[0]??results;
if(proposal.documentId!==snapshot.documentId||proposal.baseRevisionId!==snapshot.revisionId)throw Error('The proposal does not target this exact snapshot.');
if(proposal.operation==='organize'){
 const page=snapshot.pages.find((p:any)=>p.id===proposal.targetPageIds?.[0]);
 if(!page)throw Error('The selected saved page is unavailable.');
 const {width,height}=snapshot.geometry;
 const sheets=materializeSemantic(proposal.blocks,proposal.title,width,height,page.sidecar.layoutLineHeight,{paperWidth:width,paperHeight:height});
 return {sheets,proposal,summary:{pages:sheets.length,editableBoxes:sheets.reduce((n:number,p:any)=>n+(p.sidecar.textBoxes?.length??0),0)}};
}
if(proposal.operation!=='replace_ink')throw Error('Unsupported Notes operation.');
const regions:InkRegion[]=snapshot.inkRegions;
let sourceLines=false;
if(proposal.markdown){
 const page=snapshot.pages.find((p:any)=>p.id===proposal.targetPageIds?.[0]);
 if(!page)throw Error('Markdown source page is unavailable');
 const scoped=regions.filter(r=>r.pageId===page.id);
 const bound=bindMarkdownResultToInk(proposal.markdown,scoped,page.sidecar.layoutLineHeight);
 proposal.blocks=bound.blocks;sourceLines=bound.sourceLines;
}
const byId=new Map(regions.map(region=>[region.id,region]));
const sheets=snapshot.pages.flatMap((page:any)=>{
 const blocks:TranscriptionBlock[]=proposal.blocks.filter((block:TranscriptionBlock)=>block.sourceInkRegionIds.some(id=>byId.get(id)?.pageId===page.id));
 if(!blocks.length)return [];
 if(blocks.some(block=>block.sourceInkRegionIds.some(id=>byId.get(id)?.pageId!==page.id)))throw Error('Block references unknown or mixed pages.');
 return [materializeTranscriptionPage({...page,pageId:page.id},blocks,regions,{width:snapshot.geometry.width,height:snapshot.geometry.height,lineHeight:page.sidecar.layoutLineHeight,sourceLines})];
});
if(!sheets.length)throw Error('No referenced saved page.');
return {sheets,proposal,summary:{pages:sheets.length,editableBoxes:sheets.reduce((n:number,page:any)=>n+(page.sidecar.textBoxes?.length??0),0),remainingInkRuns:sheets.reduce((n:number,page:any)=>n+page.sidecar.inkRuns.length,0)}};
}
