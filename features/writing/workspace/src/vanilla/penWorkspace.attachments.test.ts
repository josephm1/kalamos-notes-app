import {afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {PenWorkspace} from './penWorkspace';
import {DEFAULT_PREFERENCES} from '../storage/preferences';
import {parseMarkdown} from '../markdown/parse';
import {createEmptySidecar,validateSidecar} from '../sidecar/schema';
import {AttachmentImages,validPageAttachment,webLink} from '../editor/pageAttachments';
import {objectInkOnPage} from '../editor/objectInk';
import type {PageObject} from '../editor/pageObjects';
const instances:PenWorkspace[]=[];
const asset={id:'a'.repeat(64),name:'Photo.jpg',mime:'image/jpeg',width:200,height:100};
const source='data:image/jpeg;base64,aGVsbG8=';
beforeAll(()=>{
 (HTMLCanvasElement.prototype as any).getContext=()=>({font:'',measureText:(t:string)=>({width:t.length*8}),setTransform(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){}});
 (globalThis as any).ResizeObserver=class{observe(){}disconnect(){}};
});
beforeEach(()=>{vi.stubGlobal('Image',class{
 onload?:()=>void;onerror?:()=>void;naturalWidth=200;naturalHeight=100;
 set src(_:string){queueMicrotask(()=>this.onload?.());}
});});
afterEach(()=>{instances.splice(0).forEach(ws=>ws.destroy());document.body.replaceChildren();vi.unstubAllGlobals();});
function setup(objects:PageObject[]=[],load=vi.fn(async()=>source)){
 const host=document.createElement('div');document.body.append(host);const commit=vi.fn(),activate=vi.fn();
 const ws=new PenWorkspace(host,{block:parseMarkdown('\u200b')[0],existingRuns:[],existingPageObjects:objects,prefs:DEFAULT_PREFERENCES,
 eink:true,native:false,loadAttachmentImage:load,onActivateAttachment:activate,onCommit:commit,onCancel(){}});
 instances.push(ws);return {ws,host,commit,activate,load};
}
function pointer(target:Element,type:string,x:number,y:number){
 const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y});
 Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'pen'}});target.dispatchEvent(event);
}
it('embeds image pixels in export and preserves references and placement through save/reopen',async()=>{
 const {ws,host,commit,load}=setup();await ws.addAttachment({kind:'image',attachment:asset});
 expect(ws.currentTool).toBe('objects');expect(load).toHaveBeenCalledTimes(1);
 expect(host.querySelectorAll('[data-page-object]')).toHaveLength(1);
 expect(ws.reflowDoc.pageObjects![0].width/ws.reflowDoc.pageObjects![0].height).toBe(2);
 expect(ws.exportSvgPages().join('')).toContain(`href="${source}"`);
 await ws.checkpoint();const saved=commit.mock.calls[0][0];
 const validation=validateSidecar({...createEmptySidecar('note','fingerprint'),pageObjects:saved.pageObjects});expect(validation.ok).toBe(true);
 const restored=setup(saved.pageObjects);await restored.ws.readyAttachments();
 expect(restored.ws.reflowDoc.pageObjects).toEqual(saved.pageObjects);expect(restored.ws.exportSvgPages().join('')).toContain(source);
});
it('pen move/resize preserves image aspect and Undo restores resized/deleted objects',async()=>{
 const {ws,host}=setup();await ws.addAttachment({kind:'image',attachment:asset});const before={...ws.reflowDoc.pageObjects![0]};
 const move=host.querySelector('[aria-label="Move attachment"]')!;
 pointer(move,'pointerdown',0,0);pointer(move,'pointermove',-10,40);pointer(move,'pointerup',-10,40);
 expect(ws.reflowDoc.pageObjects![0]).toMatchObject({x:before.x-10,y:before.y+40});
 const resize=host.querySelector('[aria-label="Resize attachment"]')!;
 pointer(resize,'pointerdown',0,0);pointer(resize,'pointermove',-70,-30);pointer(resize,'pointerup',-70,-30);
 const resized=ws.reflowDoc.pageObjects![0];expect(resized.width).toBeLessThan(before.width);expect(resized.width/resized.height).toBeCloseTo(2);
 host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();expect(ws.reflowDoc.pageObjects![0].width).toBe(before.width);
 host.querySelector<HTMLButtonElement>('[aria-label="Delete attachment"]')!.click();expect(ws.reflowDoc.pageObjects).toHaveLength(0);
 host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();expect(ws.reflowDoc.pageObjects).toHaveLength(1);
});
it('cancel restores the original geometry of a moved link card',async()=>{
 const {ws,host}=setup();await ws.addAttachment({kind:'link',link:{url:'https://example.org/a',title:'Reference'}});
 const before={...ws.reflowDoc.pageObjects![0]},move=host.querySelector('[aria-label="Move attachment"]')!;
 pointer(move,'pointerdown',0,0);pointer(move,'pointermove',-10,60);pointer(move,'pointercancel',-10,60);
 expect(ws.reflowDoc.pageObjects![0]).toEqual(before);
});
it('audio/file cards activate explicitly and do not autoplay during repaint',async()=>{
 const {ws,host,activate}=setup();const audio={...asset,mime:'audio/mpeg',name:'Voice.mp3'};
 await ws.addAttachment({kind:'audio',attachment:audio});expect(activate).not.toHaveBeenCalled();
 host.querySelector<HTMLButtonElement>('[aria-label="Play audio"]')!.click();expect(activate).toHaveBeenCalledTimes(1);
 ws.setActiveTool('write');ws.arrangeAttachments();expect(activate).toHaveBeenCalledTimes(1);
 await ws.addAttachment({kind:'file',attachment:{...asset,mime:'application/pdf',name:'Paper.pdf'}});
 host.querySelector<HTMLButtonElement>('[aria-label="Open attachment"]')!.click();expect(activate).toHaveBeenCalledTimes(2);
});
it('handwriting on a photo remains with it when moved',async()=>{
 const {ws,host}=setup();await ws.addAttachment({kind:'image',attachment:asset});ws.setActiveTool('write');const object=ws.reflowDoc.pageObjects![0];
 ws.applyNativeWriteStroke([{x:object.x+10,y:object.y+10,t:0,pressure:.5},{x:object.x+25,y:object.y+20,t:1,pressure:.5}],false);
 expect(ws.reflowDoc.pageObjects![0].ink).toHaveLength(1);const original=objectInkOnPage(ws.reflowDoc.pageObjects![0])[0].points[0];
 ws.arrangeAttachments();const move=host.querySelector('[aria-label="Move attachment"]')!;
 pointer(move,'pointerdown',0,0);pointer(move,'pointermove',-8,20);pointer(move,'pointerup',-8,20);
 const moved=objectInkOnPage(ws.reflowDoc.pageObjects![0])[0].points[0];expect(moved.x).toBeCloseTo(original.x-8);expect(moved.y).toBeCloseTo(original.y+20);
});
it('rejects executable URLs, arbitrary asset paths and media mismatch before mutation',async()=>{
 const {ws}=setup();for(const url of ['javascript:alert(1)','file:///data/secrets','https://name:secret@example.org'])expect(webLink(url)).toBeNull();
 await expect(ws.addAttachment({kind:'link',link:{url:'javascript:alert(1)',title:'Bad'}})).rejects.toThrow();
 await expect(ws.addAttachment({kind:'audio',attachment:asset})).rejects.toThrow();
 await expect(ws.addAttachment({kind:'file',attachment:{...asset,id:'../../secret'}})).rejects.toThrow();expect(ws.reflowDoc.pageObjects).toHaveLength(0);
});
it('failed image loading never inserts a partial object',async()=>{
 const {ws}=setup([],vi.fn(async()=>{throw new Error('Missing image');}));
 await expect(ws.addAttachment({kind:'image',attachment:asset})).rejects.toThrow('Missing image');expect(ws.reflowDoc.pageObjects).toHaveLength(0);
});
it('concurrent readiness requests read/decode an image once',async()=>{
 const load=vi.fn(async()=>source),changed=vi.fn(),cache=new AttachmentImages(load,changed),object={kind:'image',attachment:asset} as PageObject;
 await Promise.all([cache.ready([object]),cache.ready([object])]);await cache.ready([object]);
 expect(load).toHaveBeenCalledTimes(1);expect(changed).toHaveBeenCalledTimes(1);expect(cache.source(object)).toBe(source);cache.dispose();
});
it('filters malformed saved media metadata without losing compatible shapes',()=>{
 const shape:PageObject={id:'shape',kind:'rectangle',x:0,y:0,width:40,height:40,color:'#000000',strokeWidth:1};
 const image:PageObject={...shape,id:'image',kind:'image',attachment:asset};
 const result=validateSidecar({...createEmptySidecar('note','fingerprint'),pageObjects:[shape,image,{...image,id:'bad',attachment:{...asset,id:'../secret'}}]});
 expect(result.ok).toBe(true);if(result.ok)expect(result.sidecar.pageObjects).toEqual([shape,image]);
 expect(validPageAttachment({...image,attachment:{...asset,width:Infinity}})).toBe(false);
});

it('native audio pen contact activates once, saves no dot, and periodic time updates do no writing DOM work',async()=>{
 const {ws,host,activate}=setup();await ws.addAttachment({kind:'audio',attachment:{...asset,mime:'audio/mpeg',durationMs:90000}});
 ws.setActiveTool('write');(ws as any).nativeInkActive=true;
 const object=ws.reflowDoc.pageObjects![0],button=host.querySelector('[aria-label="Play audio"]')!;
 pointer(button,'pointerdown',0,0);pointer(button,'pointerup',0,0);expect(activate).not.toHaveBeenCalled();
 const batch=new Set<string>();const points=[{x:object.x+15,y:object.y+20,t:0,pressure:.5}];
 const before=JSON.stringify(ws.reflowDoc);expect(ws.applyNativeWriteStroke(points,false,batch)).toMatchObject({kind:'widget'});
 ws.applyNativeWriteStroke(points,false,batch);expect(activate).toHaveBeenCalledTimes(1);expect(JSON.stringify(ws.reflowDoc)).toBe(before);
 ws.updateAttachmentAudio({id:asset.id,playing:true,positionMs:1000,durationMs:90000});
 expect(host.querySelector('.rw-audio-time')?.textContent).toBe('0:01 / 1:30');
 const click=new MouseEvent('click',{bubbles:true});Object.defineProperty(click,'pointerType',{value:'pen'});
 host.querySelector('[aria-label="Pause audio"]')!.dispatchEvent(click);expect(activate).toHaveBeenCalledTimes(1);
 ws.updateAttachmentAudio({id:asset.id,playing:true,positionMs:2000,durationMs:90000});
 expect(host.querySelector('.rw-audio-time')?.textContent).toBe('0:01 / 1:30');
 ws.arrangeAttachments();expect(host.querySelector('.rw-audio-time')?.textContent).toBe('0:02 / 1:30');
});

it('ordinary writing retains the already-decoded image DOM instead of rebuilding it',async()=>{
 const {ws,host}=setup();await ws.addAttachment({kind:'image',attachment:asset});ws.setActiveTool('write');
 const node=host.querySelector('[data-page-object]');
 ws.applyNativeWriteStroke([{x:12,y:10,t:0,pressure:.5},{x:22,y:15,t:1,pressure:.5}],true);
 expect(host.querySelector('[data-page-object]')).toBe(node);
});
