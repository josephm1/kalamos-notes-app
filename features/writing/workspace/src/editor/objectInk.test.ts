import { expect,it } from 'vitest';
import { maskObjectInk, objectContains } from './objectInk';
import { objectSvg,type PageObject } from './pageObjects';
const paper:PageObject={id:'paper',kind:'rectangle',x:40,y:20,width:80,height:60,color:'#000000',strokeWidth:2};
it('masks native paths without joining across opaque paper, leaves outline untouched',()=>{
 const points=[{x:0,y:40,pressure:.2},{x:160,y:40,pressure:.8}];
 const paths=maskObjectInk(points,[paper]);expect(paths).toHaveLength(2);
 expect(paths[0][paths[0].length-1].x).toBeLessThan(40);expect(paths[1][0].x).toBeGreaterThan(120);
 expect(paths[1][0].pressure).toBeGreaterThan(.6);
 expect(maskObjectInk(points,[{...paper,paper:false}])).toEqual([points]);
 expect(objectSvg(paper)).toContain('fill="#ffffff"');expect(objectSvg({...paper,paper:false})).toContain('fill="none"');
});
it('ellipse and triangle respect their geometry instead of treating the bounding box as paper',()=>{
 expect(objectContains({...paper,kind:'ellipse'},{x:40,y:20})).toBe(false);
 expect(objectContains({...paper,kind:'ellipse'},{x:80,y:50})).toBe(true);
 expect(objectContains({...paper,kind:'triangle'},{x:40,y:20})).toBe(false);
 expect(objectContains({...paper,kind:'triangle'},{x:80,y:50})).toBe(true);
});
