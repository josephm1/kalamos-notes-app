import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PenWorkspace } from "./penWorkspace";
import { parseMarkdown } from "../markdown/parse";
import { DEFAULT_PREFERENCES } from "../storage/preferences";

let workspace: PenWorkspace;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
let resize: ResizeObserverCallback;
const last = <T>(items: T[]): T => items[items.length - 1];

function frame() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(performance.now()));
}

function pointer(type: string, x: number, extra: Partial<PointerEvent> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, Object.fromEntries(Object.entries({
    pointerId: 1, pointerType: "pen", button: 0, buttons: type === "pointerup" ? 0 : 1,
    clientX: x, clientY: 50, pressure: .5, tiltX: 10, tiltY: 20, ...extra,
  }).map(([key, value]) => [key, { value }])));
  workspace.containerElement.dispatchEvent(event);
}

beforeEach(() => {
  frames = new Map(); sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.set(++sequence, callback); return sequence;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {} disconnect() {}
  });
  const host = document.createElement("div"); document.body.append(host);
  workspace = new PenWorkspace(host, {
    block: parseMarkdown("\u200b")[0], existingRuns: [], prefs: DEFAULT_PREFERENCES,
    eink: true, native: false, onCommit() {}, onCancel() {},
  });
  frame();
});

afterEach(() => {
  workspace.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("Standard Android live ink rendering", () => {
  it("covers blank visible rows before their first contact and keeps the buffer stable across new lines", () => {
    Object.defineProperty(workspace.containerElement, "clientHeight", { configurable: true, value: 900 });
    (workspace as any).relayout();
    const canvas = workspace.containerElement.querySelector("canvas")!;
    const initialHeight = canvas.height;
    expect(parseFloat(canvas.style.height)).toBeGreaterThanOrEqual(900);
    const heightWrites = vi.spyOn(canvas, "height", "set");
    const clear = vi.spyOn(canvas.getContext("2d")!, "clearRect");
    for (const y of [180, 260, 340, 420]) {
      pointer("pointerdown", 30, { clientY: y });
      pointer("pointermove", 48, { clientY: y + 20 });
      frame();
      pointer("pointerup", 48, { clientY: y + 20 });
    }
    expect(canvas.height).toBe(initialHeight);
    expect(heightWrites).not.toHaveBeenCalled();
    expect(clear.mock.calls.some(([, y, , height]) => y >= 400 && height > 0)).toBe(true);
    expect(workspace.getNativeInkStrokes()).toHaveLength(4);
  });

  it("extends the presentation area after a height-only resize without losing an active stroke", () => {
    Object.defineProperty(workspace.containerElement, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(workspace.containerElement, "clientHeight", { configurable: true, value: 900 });
    pointer("pointerdown", 30, { clientY: 200 });
    const draw = vi.spyOn(workspace as any, "drawLiveStroke");
    resize([], {} as ResizeObserver);
    expect(workspace.containerElement.querySelector("canvas")!.height).toBe(900);
    expect(draw).toHaveBeenCalledOnce();
    expect(draw.mock.calls[0][0]).toMatchObject([{ x: 30, y: 200 }]);
    pointer("pointermove", 48, { clientY: 220 });
    pointer("pointerup", 48, { clientY: 220 });
    expect(workspace.getNativeInkStrokes()[0].pts).toMatchObject([{ x: 30, y: 200 }, { x: 48, y: 220 }]);
  });

  it("leaves an existing word's DOM untouched when another word is written", () => {
    const points = (x: number, t: number) => [{ x, y: 20, t, pressure: .5 }, { x: x + 12, y: 40, t: t + 10, pressure: .7 }];
    workspace.applyNativeWriteStroke(points(40, 0));
    const word = workspace.containerElement.querySelector('.rw-ink')!;
    const observer = new MutationObserver(() => {});
    observer.observe(word, { subtree: true, childList: true, attributes: true });
    workspace.applyNativeWriteStroke(points(230, 20));
    expect(workspace.containerElement.querySelector('.rw-ink')).toBe(word);
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
  });

  it("appends a letter without rebuilding earlier paths; Undo still restores the prior word", () => {
    workspace.applyNativeWriteStroke([{ x: 40, y: 20, t: 0, pressure: .5 }, { x: 55, y: 40, t: 10, pressure: .7 }]);
    const word = workspace.containerElement.querySelector('.rw-ink')!;
    const path = word.firstElementChild;
    const original = workspace.getNativeInkStrokes();
    workspace.applyNativeWriteStroke([{ x: 60, y: 26, t: 20, pressure: .5 }, { x: 70, y: 40, t: 30, pressure: .7 }]);
    expect(workspace.containerElement.querySelectorAll('.rw-ink')).toHaveLength(1);
    expect(word.children).toHaveLength(2);
    expect(word.firstElementChild).toBe(path);
    workspace.magnifyUndo();
    expect(workspace.getNativeInkStrokes()).toEqual(original);
  });

  it("paints contact immediately and renders a burst once without losing coalesced pressure/tilt samples", () => {
    const draw = vi.spyOn(workspace as any, "drawLiveStroke");
    pointer("pointerdown", 20);
    expect(draw).toHaveBeenCalledTimes(1);
    for (let i = 1; i <= 60; i++) {
      pointer("pointermove", 20 + i * 4, {
        getCoalescedEvents: () => [
          { clientX: 18 + i * 4, clientY: 50, pressure: .3, tiltX: 11, tiltY: 21, timeStamp: i * 10 },
          { clientX: 20 + i * 4, clientY: 50, pressure: .7, tiltX: 12, tiltY: 22, timeStamp: i * 10 + 5 },
        ] as PointerEvent[],
      });
    }
    expect(draw).toHaveBeenCalledTimes(1);
    frame();
    expect(draw).toHaveBeenCalledTimes(2);
    const rendered = draw.mock.calls[1][0] as any[];
    expect(rendered).toHaveLength(121);
    expect(last(rendered)).toMatchObject({ x: 260, pressure: .7, tiltX: 12, tiltY: 22, t: 605 });
    pointer("pointerup", 260);
    const saved = workspace.reflowDoc.inserts.filter(i => i.kind === "ink").flatMap(i => i.strokes.flatMap(s => s.points));
    expect(saved).toHaveLength(121);
    expect(last(saved)).toMatchObject({ pressure: .7, tiltX: 12, tiltY: 22, t: 605 });
    expect(last(workspace.getNativeInkStrokes()[0].pts).x).toBe(260);
  });

  it("replaces predicted tails on the next event and never stores them in the document", () => {
    const draw = vi.spyOn(workspace as any, "drawLiveStroke");
    pointer("pointerdown", 20);
    const prediction = (x: number) => [{ clientX: x, clientY: 50, pressure: .8, timeStamp: 500 }] as PointerEvent[];
    pointer("pointermove", 40, { getPredictedEvents: () => prediction(900) });
    pointer("pointermove", 60, { getPredictedEvents: () => prediction(950) });
    frame();
    expect((last(draw.mock.calls)[0] as any[]).map(p => p.x)).toEqual([20, 40, 60, 950]);
    pointer("pointermove", 80, { getPredictedEvents: () => [] });
    frame();
    expect((last(draw.mock.calls)[0] as any[]).map(p => p.x)).toEqual([20, 40, 60, 80]);
    pointer("pointerup", 80);
    expect(workspace.getNativeInkStrokes()[0].pts.map(p => p.x)).toEqual([20, 40, 60, 80]);
  });

  it.each(["pointerup", "pointercancel", "destroy", "tool"])("retires queued wet-ink work on %s", action => {
    const draw = vi.spyOn(workspace as any, "drawLiveStroke");
    pointer("pointerdown", 20); pointer("pointermove", 80);
    // Simulate even an already-delivered callback after cancellation.
    const queued = [...frames.values()];
    if (action === "destroy") workspace.destroy();
    else if (action === "tool") workspace.setActiveTool("erase");
    else pointer(action, 80);
    const count = draw.mock.calls.length;
    frame();
    queued.forEach(callback => callback(performance.now()));
    expect(draw).toHaveBeenCalledTimes(count);
  });
});
