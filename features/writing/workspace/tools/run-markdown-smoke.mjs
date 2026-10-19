// Image-only model output -> existing GFM parser -> real editor. Never commits source ink.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const [input,kernel,editor,css,output]=process.argv.slice(2);
if(!output)throw Error('Supply Markdown, parser bundle, editor bundle, CSS and output directory.');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({...(process.env.NOTES_HOST_CHROMIUM?{executablePath:process.env.NOTES_HOST_CHROMIUM}:{})});
try{
 const page=await browser.newPage({viewport:{width:548,height:740}});
 await page.setContent('<body style="margin:0"></body>');
 await page.addScriptTag({path:kernel});
 const result=await page.evaluate(markdown=>HostMarkdown.materializeMarkdownSmoke(markdown,548,740,56),fs.readFileSync(input,'utf8'));
 fs.writeFileSync(output+'/materialized.json',JSON.stringify(result,null,2));
 fs.writeFileSync(output+'/first-sheet.json',JSON.stringify(result.sheets[0],null,2));
 await page.addStyleTag({path:css});await page.addScriptTag({path:editor});
 for(let i=0;i<result.sheets.length;i++){
  await page.evaluate(sheet=>{document.body.replaceChildren();HostElements.openHostPage(sheet)},result.sheets[i]);
  await page.screenshot({path:output+`/page-${i+1}.png`});
 }
 console.log(JSON.stringify({pages:result.sheets.length,elements:result.blocks.length,taskControls:result.blocks.filter(b=>b.type==='task').length,flattenedStyles:result.flattenedStyles,sourceInkBound:result.sourceInkBound}));
}finally{await browser.close()}
