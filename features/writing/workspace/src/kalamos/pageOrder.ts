import type { WorkspacePages } from './workspacePages';
/** Reordering changes manifest order only. Stable IDs and files preserve every vector. */
export function reorderPages(index:WorkspacePages,ids:string[],position:number):WorkspacePages{
 const selected=new Set(ids),moving=index.pages.filter(p=>selected.has(p.id)),remaining=index.pages.filter(p=>!selected.has(p.id));
 if(!moving.length)throw new Error('Select pages first');
 const at=Math.max(0,Math.min(remaining.length,position)),pages=[...remaining.slice(0,at),...moving,...remaining.slice(at)];
 return {...index,pages,active:pages.findIndex(p=>p.id===index.pages[index.active].id)};
}
export function removePages(index:WorkspacePages,ids:string[]):WorkspacePages{
 const selected=new Set(ids),pages=index.pages.filter(p=>!selected.has(p.id));
 if(!pages.length)throw new Error('Keep at least one page');
 const active=pages.findIndex(p=>p.id===index.pages[index.active].id);
 return {...index,pages,active:active<0?Math.min(index.active,pages.length-1):active,...(index.coverId&&selected.has(index.coverId)?{coverId:undefined}:{})};
}
