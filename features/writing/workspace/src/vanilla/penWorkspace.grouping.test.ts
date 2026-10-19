import { beforeAll, describe, expect, it } from "vitest";
import { parseMarkdown } from "../markdown/parse";
import { DEFAULT_PREFERENCES } from "../storage/preferences";
import type { InkPoint } from "../ink/types";
import { convertLegacyPage } from "../kalamos/legacyNotebook";
import { PenWorkspace } from "./penWorkspace";

beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
    font: "", measureText: (text: string) => ({ width: text.length * 8 }),
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, arc() {},
  });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
});
function workspace() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new PenWorkspace(host, {
    block: parseMarkdown("\u200b")[0], existingRuns: [], prefs: DEFAULT_PREFERENCES,
    eink: true, native: true, onCommit() {}, onCancel() {},
  });
}
function points(coords: number[][], start: number): InkPoint[] {
  return coords.map(([x, y], i) => ({ x, y, pressure: 0.5, t: start + i * 10 }));
}
const words = (ws: PenWorkspace) => ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink");

describe("completed native stroke word membership", () => {
  it("keeps hopefully's long y separate from better on the next rule even in a rapid batch", () => {
    const ws = workspace();
    ws.applyNativeWriteStroke(points([[40, 18], [60, 38], [80, 22], [105, 40], [111, 88], [100, 90]], 0), false);
    ws.applyNativeWriteStroke(points([[40, 62], [60, 85], [80, 64], [115, 87]], 100), false);
    expect(words(ws)).toHaveLength(2);
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts.map(({ x, y }) => [x, y]));
    ws.setActiveTool("insert");
    // Inserting on the lower row must not move the upper word's descender.
    ws.applyNativeStroke(points([[20, 65], [50, 65]], 1000));
    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts.map(({ x, y }) => [x, y]));
    expect(after[0]).toEqual(before[0]);
    expect(after[1][0][0]).toBeGreaterThan(before[1][0][0]);
  });

  it("attaches a separately drawn p stem at its upper body, without joining a lower word at its tail", () => {
    const ws = workspace();
    ws.applyNativeWriteStroke(points([[40, 14], [70, 40]], 0), false);
    ws.applyNativeWriteStroke(points([[52, 28], [52, 94]], 3000), false);
    expect(words(ws)).toHaveLength(1);
    ws.applyNativeWriteStroke(points([[52, 70], [80, 85]], 3100), false);
    expect(words(ws)).toHaveLength(2);
    expect(words(ws)[0].strokes).toHaveLength(2);
  });

  it("returns a delayed crossbar and dot to their older lower-row stems", () => {
    const ws = workspace();
    ws.applyNativeWriteStroke(points([[50, 34], [50, 83]], 0), false);
    ws.applyNativeWriteStroke(points([[59, 52], [59, 83]], 100), false);
    const lowerId = words(ws)[0].id;
    ws.applyNativeWriteStroke(points([[48, 10], [61, 23]], 2000), false);
    expect(words(ws)).toHaveLength(2);
    const before = ws.getNativeInkStrokes().slice(0, 2);
    ws.applyNativeWriteStroke(points([[43, 40], [55, 40]], 20000), false);
    ws.applyNativeWriteStroke(points([[59, 43]], 30000), false);
    expect(words(ws)).toHaveLength(2);
    expect(words(ws).find(({ id }) => id === lowerId)?.strokes).toHaveLength(4);
    expect(ws.getNativeInkStrokes().slice(0, 2)).toEqual(before);
  });

  it("allows a writer to return to an earlier word after writing another word", () => {
    const ws = workspace();
    ws.applyNativeWriteStroke(points([[50, 55], [60, 83]], 0), false);
    const oldId = words(ws)[0].id;
    ws.applyNativeWriteStroke(points([[120, 55], [150, 83]], 2000), false);
    ws.applyNativeWriteStroke(points([[52, 56], [58, 78]], 30000), false);
    expect(words(ws)).toHaveLength(2);
    expect(words(ws).find(({ id }) => id === oldId)?.strokes).toHaveLength(2);
  });
});

describe('selection lasso and copy', () => {
  it('selects crossed vectors without moving them or nearby unselected ink', () => {
    const ws=workspace();
    ws.applyNativeWriteStroke(points([[40,18],[60,38]],0),false);
    ws.applyNativeWriteStroke(points([[200,18],[220,38]],500),false);
    const before=ws.getNativeInkStrokes().map(s=>s.pts);
    ws.selectLasso(points([[30,5],[80,5],[80,50],[30,50],[30,5]],1000));
    const after=ws.getNativeInkStrokes().map(s=>s.pts);
    expect(after).toEqual(expect.arrayContaining(before));
    ws.duplicateSelectedInk();
    const copied=ws.getNativeInkStrokes();
    expect(copied).toHaveLength(3);
    expect(new Set(words(ws).flatMap(s=>s.strokes.map(stroke=>stroke.id))).size).toBe(3);
    expect(copied[2].width).toBe(copied[1].width);
    ws.magnifyUndo();
    expect(ws.getNativeInkStrokes()).toHaveLength(2);
  });
  it('empty lasso does not change any vectors',()=>{
    const ws=workspace();ws.applyNativeWriteStroke(points([[40,18],[60,38]],0),false);
    const before=ws.getNativeInkStrokes();
    ws.selectLasso(points([[300,300],[350,300],[350,350],[300,350],[300,300]],1000));
    ws.duplicateSelectedInk();expect(ws.getNativeInkStrokes()).toEqual(before);
  });
});


it('reopens converted legacy strokes at their original full-width page coordinates',()=>{
  const legacy={pageId:'p',strokes:[{width:3,points:[{x:10,y:20,p:.3,t:0},{x:25,y:40,p:.7,t:10}]},{width:2,points:[{x:270,y:100,p:.5,t:20},{x:300,y:120,p:.5,t:30}]}]};
  const converted=convertLegacyPage(legacy,'Old notebook');
  const host=document.createElement('div');document.body.appendChild(host);
  const ws=new PenWorkspace(host,{block:parseMarkdown(converted.source)[0],existingRuns:converted.sidecar.inkRuns,prefs:DEFAULT_PREFERENCES,eink:true,native:true,onCommit(){},onCancel(){}});
  expect(ws.getNativeInkStrokes().map(s=>s.pts.map(p=>[p.x,p.y]))).toEqual(legacy.strokes.map(s=>s.points.map(p=>[p.x,p.y])));
});

it('retired automatic shape correction never changes handwriting, even with an old preference',()=>{
  localStorage.setItem('write2.shapeCorrection','true');
  const ws=workspace();
  const result=ws.applyNativeWriteStroke(points([[10,10],[30,11],[50,10],[70,11],[90,10],[110,11]],0),false);
  expect(result).toBeNull(); expect(ws.getNativeInkStrokes()[0].pts).toHaveLength(6);
  ws.magnifyUndo();expect(ws.getNativeInkStrokes()).toHaveLength(0);
  ws.destroy();localStorage.removeItem('write2.shapeCorrection');
});
