import {describe,it,expect} from 'vitest';
import {perfectShape} from './shapes';
const points=(xy:number[][])=>xy.map(([x,y],i)=>({x,y,t:i*10,pressure:.5}));
describe('opt-in shape correction',()=>{
  it('straightens a deliberate line while leaving short writing alone',()=>{
    expect(perfectShape(points([[10,10],[30,11],[50,10],[70,11],[90,10],[110,11]]),56)).toHaveLength(2);
    expect(perfectShape(points([[10,10],[11,11],[12,10],[13,11],[14,10],[15,11]]),56)).toBeNull();
  });
  it('corrects a closed box, retaining its outer extent',()=>{
    const shape=perfectShape(points([[10,10],[50,11],[110,10],[109,50],[110,110],[50,109],[10,110],[11,50],[10,10]]),56);
    expect(shape).toHaveLength(5);
    expect(shape?.[0]).toEqual(shape?.[shape.length-1]);
  });
  it('does not mistake a backtracking erase zigzag for a line',()=>{
    expect(perfectShape(points([[10,10],[100,12],[12,15],[105,18],[10,20],[100,22]]),56)).toBeNull();
  });
});
