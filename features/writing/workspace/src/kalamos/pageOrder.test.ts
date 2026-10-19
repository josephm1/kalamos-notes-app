import {it,expect} from 'vitest';
import {initialPages,appendPage,parsePages} from './workspacePages';
import {reorderPages,removePages} from './pageOrder';
const book=()=>appendPage(appendPage(initialPages(),'second'),'third');
it('moves a selected block while retaining active sheet identity and file names',()=>{
 const before=book(),next=reorderPages(before,['first','second'],1);
 expect(next.pages.map(p=>p.id)).toEqual(['third','first','second']);
 expect(next.pages[next.active]).toEqual(before.pages[before.active]);expect(before.pages.map(p=>p.id)).toEqual(['first','second','third']);
});
it('removal preserves remaining files and chooses a valid active sheet',()=>{
 const before={...book(),coverId:'third'},next=removePages(before,['third']);
 expect(next.pages).toEqual(before.pages.slice(0,2));expect(next.active).toBe(1);expect(next.coverId).toBeUndefined();
 expect(()=>removePages(before,before.pages.map(p=>p.id))).toThrow('Keep at least one');
});
it('persists valid cover identity and ignores a cover absent from the manifest',()=>{
 expect(parsePages(JSON.stringify({...book(),coverId:'second'})).coverId).toBe('second');
 expect(parsePages(JSON.stringify({...book(),coverId:'absent'})).coverId).toBeUndefined();
});
