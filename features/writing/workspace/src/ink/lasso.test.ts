import { describe, it, expect } from "vitest";
import { strokeHitsLasso, validLasso } from "./lasso";
const square = [{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}];
describe("erasing lasso",()=>{
  it("hits enclosed dots and crossing segments with both ends outside",()=>{
    expect(strokeHitsLasso([{x:20,y:20}],square)).toBe(true);
    expect(strokeHitsLasso([{x:0,y:20},{x:40,y:20}],square)).toBe(true);
    expect(strokeHitsLasso([{x:10,y:10}],square)).toBe(true);
  });
  it("leaves outside strokes and rejects taps or narrow gestures",()=>{
    expect(strokeHitsLasso([{x:0,y:0},{x:40,y:0}],square)).toBe(false);
    expect(validLasso([{x:1,y:1},{x:2,y:2},{x:1,y:3}])).toBe(false);
  });
});
