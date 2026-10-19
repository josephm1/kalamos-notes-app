/** A pause checkpoint never owns the ink surface. The caller supplies the existing
 * save/flush boundary and generation-scoped release; thumbnail work is model-only. */
export class BackgroundSave {
 private pending=new Map<object,Promise<void>>();
 private released=new Set<object>();
 private releases=new Map<object,()=>void>();
 private versions=new Map<string,number>();
 private previews=new Map<string,string>();
 run(owner:object,id:string,checkpoint:()=>Promise<void>,release:()=>void,
  thumbnail:()=>Promise<{signature:string;dataUrl:string|null;current:()=>boolean}>,
  save:(dataUrl:string)=>boolean):Promise<void>{
  this.releases.set(owner,release);
  const existing=this.pending.get(owner);if(existing){if(this.released.has(owner))release();return existing;}
  const version=(this.versions.get(id)??0)+1;this.versions.set(id,version);
  const task=(async()=>{
   // A failed save still releases background ink ownership. No thumbnail may
   // claim unsaved writing is durable, and no unhandled rejection is discarded.
   try {await checkpoint();} finally {this.released.add(owner);this.releases.get(owner)?.();}
   const preview=await thumbnail();
   if(this.versions.get(id)!==version||!preview.current())return;
   if(!preview.dataUrl)throw Error('Could not render the saved notebook preview');
   if(this.previews.get(id)===preview.signature)return;
   if(!save(preview.dataUrl))throw Error('Could not save the notebook preview');
   this.previews.set(id,preview.signature);
  })();
  this.pending.set(owner,task);
  void task.finally(()=>{if(this.pending.get(owner)===task){this.pending.delete(owner);this.releases.delete(owner);this.released.delete(owner);}}).catch(()=>{});
  return task;
 }
 invalidate(id:string){this.versions.set(id,(this.versions.get(id)??0)+1);this.previews.delete(id);}
}
