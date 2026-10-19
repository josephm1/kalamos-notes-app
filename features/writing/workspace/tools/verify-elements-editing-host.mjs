// Actual editor gestures on a supplied saved note; never physical-panel acceptance.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const [input,bundle,css,output,width='548',height='740']=process.argv.slice(2);
if(!output)throw Error('Supply source/sidecar JSON, editor bundle, production CSS, output directory, optional width/height.');
fs.mkdirSync(output,{recursive:true});
(async()=>{const out=output.replace(/\/$/,'')+'/';const original=JSON.parse(fs.readFileSync(input));
const browser=await chromium.launch({...(process.env.NOTES_HOST_CHROMIUM?{executablePath:process.env.NOTES_HOST_CHROMIUM}:{})});
try{const page=await browser.newPage({viewport:{width:Number(width),height:Number(height)}});await page.setContent('<body style="margin:0"></body>');await page.addStyleTag({path:css});await page.addScriptTag({path:bundle});
const result=await page.evaluate(async sheet=>{
 let saved;let ws=HostElements.openHostPage(sheet,payload=>{saved=payload});
 const task=ws.reflowDoc.textBoxes.find(b=>b.semantic?.type==='task'&&!b.checkbox&&
   ws.reflowDoc.textBoxes.some(check=>check.checkbox&&check.semantic?.id===b.semantic.id&&check.text==='☐'));
 if(!task)throw Error('Supply a note with at least one unchecked task for the toggle test.');
 document.querySelector('[data-text-box-word="check-'+task.semantic.id+'"] button').click();await new Promise(r=>setTimeout(r,20));
 if(ws.reflowDoc.textBoxes.find(b=>b.checkbox&&b.semantic.id===task.semantic.id).text!=='☑')throw Error('tick failed');
 const word=task.words[task.words.length-1],canvas=document.createElement('canvas').getContext('2d');canvas.font=task.size+'px system-ui';const width=canvas.measureText(word.text).width;
 const scribble=Array.from({length:7},(_,i)=>({x:i%2?word.x+width+1:word.x-2,y:word.y+28-6+i*2,t:i*4,pressure:.5}));
 if(!ws.eraseScribble(scribble,false,false))throw Error('scribble failed');
 if(ws.reflowDoc.textBoxes.find(b=>b.id===task.id)?.text===task.text)throw Error('no deleted word');
 ws.magnifyUndo();if(ws.reflowDoc.textBoxes.find(b=>b.id===task.id).text!==task.text)throw Error('Undo lost text');
 ws.setActiveTool('lines');for(const [type,y] of [['pointerdown',10],['pointermove',98],['pointerup',98]]){
 const e=new MouseEvent(type,{clientX:8,clientY:y,bubbles:true,button:0,buttons:type==='pointerup'?0:1});Object.defineProperties(e,{pointerType:{value:'pen'},pointerId:{value:99},pressure:{value:.5}});ws.containerElement.dispatchEvent(e);
 }
 await ws.checkpoint();const next={...sheet,source:saved.newSource,sidecar:{...sheet.sidecar,inkRuns:saved.newRuns,textBoxes:saved.textBoxes,sourceWords:saved.sourceWords,layoutLineHeight:saved.layoutLineHeight}};
 const owner=next.sidecar.textBoxes.find(b=>b.id===task.id),check=next.sidecar.textBoxes.find(b=>b.checkbox&&b.semantic.id===task.semantic.id);
 if(owner.words[0].y<=task.words[0].y||check.y!==owner.words[0].y)throw Error('spacing failed');
 // Use Chromium's actual hit target and production CSS, rather than bypassing
 // overlapping text/control layers by dispatching directly to the workspace.
 ws.setActiveTool('select');
 const moveIndex=0;
 const span=Array.from(document.querySelectorAll('[data-text-word-index]')).find(el=>el.dataset.textBoxWord===owner.id&&Number(el.dataset.textWordIndex)===moveIndex);
 if(!span)throw Error('word hit target missing');
 const rect=span.getBoundingClientRect(),start={x:rect.left+rect.width/2,y:rect.top+rect.height/2};
 const hit=document.elementFromPoint(start.x,start.y);
 if(!hit||!ws.containerElement.contains(hit))throw Error('word outside viewport');
 const moveDx=-Math.min(24,owner.words[moveIndex].x/2);
 for(const [type,dx] of [['pointerdown',0],['pointermove',moveDx],['pointerup',moveDx]]){
   // Overlay nodes are rebuilt on selection; subsequent events target the live
   // DOM (a real captured pointer would target the workspace itself).
   document.elementFromPoint(start.x+dx,start.y).dispatchEvent(new PointerEvent(type,{clientX:start.x+dx,clientY:start.y,bubbles:true,button:0,buttons:type==='pointerup'?0:1,pointerType:'pen',pointerId:100,pressure:.5}));
 }
 await ws.checkpoint();
 const moved=saved.textBoxes.find(b=>b.id===owner.id);
 if(Math.abs(moved.words[moveIndex].x-owner.words[moveIndex].x-moveDx)>.1||moved.words[moveIndex].y!==owner.words[moveIndex].y)throw Error('word move failed through actual hit target '+JSON.stringify({hit:hit.outerHTML.slice(0,400),start,before:owner.words[moveIndex],after:moved.words[moveIndex]}));
 if(moved.text!==owner.text)throw Error('word move changed canonical wording');
 if(JSON.stringify(moved.styles)!==JSON.stringify(owner.styles))throw Error('word move changed styles');
 if(saved.textBoxes.find(b=>b.id===check.id).text!=='☑')throw Error('word move lost tick');
 const movedSheet={...next,source:saved.newSource,sidecar:{...next.sidecar,inkRuns:saved.newRuns,textBoxes:saved.textBoxes,sourceWords:saved.sourceWords}};
 ws.magnifyUndo();await ws.checkpoint();
 if(saved.textBoxes.find(b=>b.id===owner.id).words[moveIndex].x!==owner.words[moveIndex].x)throw Error('word move Undo failed');
 ws.destroy();document.body.replaceChildren();ws=HostElements.openHostPage(movedSheet);const boxes=ws.reflowDoc.textBoxes;
 if(boxes.find(b=>b.id===owner.id).words[moveIndex].x!==moved.words[moveIndex].x)throw Error('reopen lost moved word');
 if(boxes.find(b=>b.id===check.id).text!=='☑')throw Error('reopen lost tick');
 if(boxes.find(b=>b.id===owner.id).text!==task.text)throw Error('reopen lost words');
 if(JSON.stringify(boxes.find(b=>b.id===owner.id).styles)!==JSON.stringify(task.styles))throw Error('reopen lost inline styles');
 if(boxes.filter(b=>b.semantic?.parentId).length!==sheet.sidecar.textBoxes.filter(b=>b.semantic?.parentId).length)throw Error('reopen lost groups');
 // A model may use a bold paragraph instead of an ATX heading. Check that
 // the actual supplied formatting survives; do not require a heading to exist.
 for(const original of sheet.sidecar.textBoxes){
   const reopened=boxes.find(b=>b.id===original.id);
   if(!reopened||reopened.fontWeight!==original.fontWeight||
      JSON.stringify(reopened.styles)!==JSON.stringify(original.styles))throw Error('reopen lost formatting for '+original.id);
 }
 ws.setActiveTool('select');return {editedSheet:movedSheet,checks:{tick:true,scribble:true,undo:true,spacing:true,wordMove:true,wordMoveUndo:true,reopen:true,groups:true,formatting:true}};
},original);
await page.screenshot({path:out+'editor.png'});
fs.writeFileSync(out+'edited-sheet.json',JSON.stringify(result.editedSheet,null,2));fs.writeFileSync(out+'editing-verification.json',JSON.stringify(result.checks,null,2));console.log(JSON.stringify(result.checks));}finally{await browser.close()}})();
