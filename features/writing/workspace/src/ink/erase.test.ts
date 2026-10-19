import { expect,it } from 'vitest';
import { eraseStrokeAtPoint } from './erase';
import {boundsOfPoints,type InkStroke} from './types';
const points=[{x:0,y:0,t:10,pressure:.2},{x:100,y:0,t:110,pressure:.8}];
const stroke:InkStroke={id:'s',tool:'pen',color:'#000',width:2,points,bounds:boundsOfPoints(points)};
it('cuts a sparse crossing into separate stationary vectors, retaining style and interpolated pressure/time',()=>{
 const result=eraseStrokeAtPoint(stroke,50,0,9,'pixel');
 expect(result).toHaveLength(2);expect(result[0].points[result[0].points.length-1].x).toBe(40);expect(result[1].points[0].x).toBe(60);
 expect(result[0].points[result[0].points.length-1].pressure).toBeCloseTo(.44);expect(result[1].points[0].t).toBe(70);
 expect(result.every(s=>s.width===2&&s.color==='#000')).toBe(true);expect(stroke.points).toEqual(points);
});
it('stroke mode deletes only the contacted stroke; a neighbouring stroke stays intact',()=>{
 expect(eraseStrokeAtPoint(stroke,50,0,9,'stroke')).toEqual([]);
 expect(eraseStrokeAtPoint(stroke,50,20,9,'stroke')).toEqual([stroke]);
});
