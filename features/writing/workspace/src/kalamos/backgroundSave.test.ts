import {it,expect,vi} from 'vitest';
import {BackgroundSave} from './backgroundSave';
const preview=(signature='saved')=>({signature,dataUrl:'data:image/png;base64,fixture',current:()=>true});
it('waits for completed save before releasing ink and writes thumbnail after release',async()=>{
 const events:string[]=[],queue=new BackgroundSave();let finish!:()=>void;
 const task=queue.run({},'note',()=>new Promise<void>(r=>{finish=()=>{events.push('saved');r();};}),()=>{events.push('release');},async()=>{events.push('render');return preview();},()=>{events.push('thumbnail');return true;});
 expect(events).toEqual([]);finish();await task;expect(events).toEqual(['saved','release','render','thumbnail']);
});
it('coalesces overlapping pause requests from the same model',async()=>{
 const queue=new BackgroundSave(),owner={},checkpoint=vi.fn(()=>new Promise<void>(r=>{finish=r;}));let finish!:()=>void;
 const release=vi.fn(),render=vi.fn(async()=>preview()),save=vi.fn(()=>true);
 const first=queue.run(owner,'note',checkpoint,release,render,save),second=queue.run(owner,'note',checkpoint,release,render,save);
 expect(first).toBe(second);finish();await first;expect(checkpoint).toHaveBeenCalledOnce();expect(release).toHaveBeenCalledOnce();expect(save).toHaveBeenCalledOnce();
});
it('releases after save failure but never renders an unsaved thumbnail, and allows retry',async()=>{
 const queue=new BackgroundSave(),owner={},release=vi.fn(),render=vi.fn(async()=>preview()),save=vi.fn(()=>true);
 await expect(queue.run(owner,'note',async()=>{throw Error('disk full');},release,render,save)).rejects.toThrow('disk full');
 expect(release).toHaveBeenCalledOnce();expect(render).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
 await queue.run(owner,'note',async()=>{},release,render,save);expect(save).toHaveBeenCalledOnce();
});
it('rejects old previews after a newer owner or close invalidates them',async()=>{
 const queue=new BackgroundSave(),save=vi.fn(()=>true);let finish!:(p:ReturnType<typeof preview>)=>void;
 const first=queue.run({},'note',async()=>{},()=>{},()=>new Promise(r=>{finish=r;}),save);await Promise.resolve();
 await queue.run({},'note',async()=>{},()=>{},async()=>preview('new'),save);finish(preview('old'));await first;expect(save).toHaveBeenCalledOnce();
 const stale=queue.run({},'note',async()=>{},()=>{},()=>new Promise(r=>{finish=r;}),save);await Promise.resolve();queue.invalidate('note');finish(preview('after close'));await stale;expect(save).toHaveBeenCalledOnce();
});
it('skips obsolete file signatures and unchanged previews; failed preview writes can retry',async()=>{
 const queue=new BackgroundSave(),owner={},save=vi.fn(()=>true);
 await queue.run(owner,'note',async()=>{},()=>{},async()=>({...preview(),current:()=>false}),save);expect(save).not.toHaveBeenCalled();
 await queue.run(owner,'note',async()=>{},()=>{},async()=>preview(),save);await queue.run(owner,'note',async()=>{},()=>{},async()=>preview(),save);expect(save).toHaveBeenCalledOnce();
 save.mockReturnValueOnce(false);await expect(queue.run(owner,'note',async()=>{},()=>{},async()=>preview('changed'),save)).rejects.toThrow('preview');
 await queue.run(owner,'note',async()=>{},()=>{},async()=>preview('changed'),save);expect(save).toHaveBeenCalledTimes(3);
});

it('a later pause updates the scoped release while the same checkpoint is still pending',async()=>{
 const queue=new BackgroundSave(),owner={};let finish!:()=>void;const oldRelease=vi.fn(),currentRelease=vi.fn();
 const task=queue.run(owner,'note',()=>new Promise<void>(r=>{finish=r;}),oldRelease,async()=>preview(),()=>true);
 queue.run(owner,'note',async()=>{},currentRelease,async()=>preview(),()=>true);finish();await task;
 expect(oldRelease).not.toHaveBeenCalled();expect(currentRelease).toHaveBeenCalledOnce();
});

it('a second pause during thumbnail generation still releases the newly paused session',async()=>{
 const queue=new BackgroundSave(),owner={};let finish!:(p:ReturnType<typeof preview>)=>void;
 const firstRelease=vi.fn(),secondRelease=vi.fn();
 const task=queue.run(owner,'note',async()=>{},firstRelease,()=>new Promise(r=>{finish=r;}),()=>true);await Promise.resolve();
 expect(firstRelease).toHaveBeenCalledOnce();queue.run(owner,'note',async()=>{},secondRelease,async()=>preview(),()=>true);
 expect(secondRelease).toHaveBeenCalledOnce();finish(preview());await task;
});
