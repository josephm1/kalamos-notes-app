import { expect, it } from 'vitest';
import { IMAGE_HANDLES, resizeImage } from './imageResize';
import type { PageObject } from './pageObjects';
const image: PageObject = { id:'image', kind:'image', x:100, y:100, width:200, height:100, color:'#000', strokeWidth:1 };
for (const handle of IMAGE_HANDLES) it(`${handle} keeps its opposite anchor and resizes the intended axes`, () => {
 const result=resizeImage(image,handle,handle.includes('w')?-40:40,handle.includes('n')?-20:20,600);
 if (handle.length===2) expect(result.width/result.height).toBeCloseTo(2);
 if (handle==='e'||handle==='w') { expect(result.height).toBe(100);expect(result.y).toBe(100);expect(result.width).toBe(240); }
 if (handle==='n'||handle==='s') { expect(result.width).toBe(200);expect(result.x).toBe(100);expect(result.height).toBe(120); }
 if(handle.includes('w'))expect(result.x+result.width).toBe(300);else expect(result.x).toBe(100);
 if(handle.includes('n'))expect(result.y+result.height).toBe(200);else expect(result.y).toBe(100);
});
it('clamps corners to page boundaries without losing the ratio or crossing the opposite corner',()=>{
 for(const handle of IMAGE_HANDLES.filter(h=>h.length===2)) {
  for(const delta of [-10000,10000]) {
   const result=resizeImage(image,handle,delta,delta,600);
   expect(result.x).toBeGreaterThanOrEqual(0);expect(result.y).toBeGreaterThanOrEqual(0);
   expect(result.x+result.width).toBeLessThanOrEqual(600);expect(result.width).toBeGreaterThanOrEqual(48);
   expect(result.height).toBeGreaterThanOrEqual(48);expect(result.width/result.height).toBeCloseTo(2);
  }
 }
});
it('corners preserve the new ratio after independent edge resizing',()=>{
 const stretched=resizeImage(image,'e',100,80,600);
 const result=resizeImage(stretched,'se',30,10,600);expect(result.width/result.height).toBeCloseTo(3);
});
