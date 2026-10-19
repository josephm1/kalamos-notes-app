import type { Sidecar } from '../sidecar/schema';
import type { InkRegion } from './inkTranscription';
import { freeInkLaneIndex } from './inkPlacement';
import { parseNotesMarkdownRows } from './markdownTranscription';
import { materializeSemantic, ruledTextMeasure, type SemanticGeometry } from './semanticDocument';
import { placeBoxWords } from './textBox';

/** Whole-page image output is matched only against local saved geometry, never model coordinates. */
export function materializeImagePage(markdown:string,source:string,sidecar:Sidecar,regions:InkRegion[],title:string,
 width:number,height:number,lineHeight:number,namespace:string,geometry:SemanticGeometry={}) {
 if(!Number.isFinite(lineHeight)||lineHeight<24)throw Error('Invalid ruled grid.');
 if(sidecar.unplacedInk.length)throw Error('Place unresolved handwriting before formatting this page.');
 if(sidecar.inkRuns.length!==new Set(regions.map(region=>region.runId)).size || sidecar.inkRuns.some(run=>!regions.some(region=>region.runId===run.id)))throw Error('Save all handwriting before formatting this page.');
 const rows=new Map<number,number>();
 const addRow=(row:number,x:number)=>{if(!Number.isFinite(x)||!Number.isFinite(row))throw Error('Invalid saved text position.');rows.set(row,Math.min(rows.get(row)??Infinity,x))};
 for(const region of regions)addRow(freeInkLaneIndex(region.bounds.y,region.bounds.height,lineHeight),region.bounds.x);
 const add=(word:{text:string;y:number;x:number})=>{if(word.text.replace(/\u200b/g,'').trim())addRow(Math.max(0,Math.round(word.y/lineHeight)),word.x)};
 if(source.replace(/\u200b/g,'').trim()&&!sidecar.sourceWords)throw Error('Save typed text positions before formatting this page.');
 sidecar.sourceWords?.forEach(add);
 const measure=geometry.measure??ruledTextMeasure(lineHeight);
 for(const box of sidecar.textBoxes??[]) {
  if(box.checkbox)continue;
  (box.words??placeBoxWords(box.text,box.x,box.y,box.width,lineHeight,measure,geometry.space??measure(' '))).forEach(add);
 }
 const sourceRows=[...rows.keys()].sort((a,b)=>a-b);
 const parsed=parseNotesMarkdownRows(markdown,true);
 if(!sourceRows.length||parsed.length!==sourceRows.length)throw Error('Markdown does not match the occupied ruled rows. Original page retained.');
 if(!/^[a-zA-Z0-9_-]{1,60}$/.test(namespace))throw Error('Invalid result identity.');
 const ids=new Map(parsed.map(block=>[block.id,`${namespace}-${block.id}`]));
 const checkboxRows=new Set<number>();
 for(const checkbox of (sidecar.textBoxes??[]).filter(box=>box.checkbox)) {
  const row=Math.max(0,Math.round(checkbox.y/lineHeight)),position=sourceRows.indexOf(row),block=parsed[position];
  if(checkboxRows.has(row))throw Error('Multiple checkboxes on one ruled row are unsupported. Original page retained.');
  checkboxRows.add(row);
  if(!block||block.type!=='task'||block.checked!==(checkbox.text==='☑'))throw Error('Markdown changed an existing checkbox state or task row. Original page retained.');
 }
 const blocks=parsed.map(block=>({...block,id:ids.get(block.id)!,...(block.parentId?{parentId:ids.get(block.parentId)!}:{})}));
 const sheets=materializeSemantic(blocks,title,width,height,lineHeight,{...geometry,paperWidth:width,paperHeight:height,sourceRows,sourceXs:sourceRows.map(row=>rows.get(row)!)});
 if(sheets.length!==1)throw Error('Markdown does not fit this page. Original page retained.');
 const result=sheets[0];
 result.sidecar.pageObjects=sidecar.pageObjects;
 for(const box of result.sidecar.textBoxes??[]) {
  const bounds={x:box.x,y:box.y,width:box.checkbox?box.width:Math.max(0,...(box.words??[]).map(word=>word.x+measure(word.text)-box.x)),height:lineHeight};
  if((sidecar.pageObjects??[]).some(object=>bounds.x<object.x+object.width&&object.x<bounds.x+bounds.width&&bounds.y<object.y+object.height&&object.y<bounds.y+bounds.height))throw Error('Formatted text would overlap a drawing or object. Original page retained.');
 }
 return {blocks,sheets:[result],sourceRows};
}
