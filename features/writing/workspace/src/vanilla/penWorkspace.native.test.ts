// applyNativeStroke: the device seam — one completed daemon stroke drives a
// whole tool gesture. Runs in jsdom with a stubbed 2D canvas context (jsdom
// has none) and a stubbed ResizeObserver.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { parseMarkdown } from "../markdown/parse";
import { DEFAULT_PREFERENCES } from "../storage/preferences";
import { PenWorkspace, type HwrResult } from "./penWorkspace";
import type { CommitPayload } from "../editor/PenWorkspace";
import {
  boundsOfPoints,
  type InkPoint,
  type InkStroke,
  type InlineInkRun,
} from "../ink/types";

const LINE = DEFAULT_PREFERENCES.lineHeight; // 44

beforeAll(() => {
  // Minimal 2D context: measureText for word layout, no-op drawing.
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 8 }),
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
  });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

function makeWorkspace(
  text = "Alpha beta gamma delta epsilon zeta",
  onCommit: (payload: CommitPayload) => void = () => {},
  existingRuns: InlineInkRun[] = [],
  existingTextBoxes: import("../sidecar/schema").TextBox[] = [],
  native = true
) {
  const block = parseMarkdown(text)[0];
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new PenWorkspace(host, {
    block,
    existingRuns,
    existingTextBoxes,
    prefs: DEFAULT_PREFERENCES,
    eink: true,
    native,
    onCommit,
    onCancel: () => {},
  });
}

function line(x0: number, y0: number, x1: number, y1: number, n = 10): InkPoint[] {
  const pts: InkPoint[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    pts.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, t: i * 4, pressure: 0.5 });
  }
  return pts;
}

function inkStroke(id: string, x0: number, y0: number, x1: number, y1: number): InkStroke {
  const points = line(x0, y0, x1, y1);
  return {
    id,
    tool: "pen",
    color: "#000",
    width: 2,
    points,
    bounds: boundsOfPoints(points),
  };
}

function legacyInkRun(id: string, strokes: InkStroke[]): InlineInkRun {
  const bounds = boundsOfPoints(strokes.flatMap((stroke) => stroke.points));
  return {
    id,
    blockId: "b0",
    anchorOffset: 0,
    contextBefore: "",
    contextAfter: "",
    strokes,
    intrinsicWidth: bounds.width + 8,
    intrinsicHeight: Math.max(LINE, bounds.height + 8),
    baselineOffset: LINE,
    scale: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

function pointerEvent(type: string, pointerId: number, x: number, y: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    buttons: type === "pointerdown" ? 1 : 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "pen" },
    pressure: { value: type === "pointerup" ? 0 : 0.5 },
    tiltX: { value: 0 },
    tiltY: { value: 0 },
  });
  return event as unknown as PointerEvent;
}

describe("applyNativeStroke", () => {
  it("activates toolbar buttons once with pen release and does not ink the controls", () => {
    const ws = makeWorkspace();
    const host = ws.containerElement.parentElement!;
    const button = host.querySelector<HTMLButtonElement>('[data-tool="select"]')!;
    button.dispatchEvent(pointerEvent("pointerdown", 20, 10, 10));
    button.dispatchEvent(pointerEvent("pointerup", 20, 10, 10));
    expect(ws.currentTool).toBe("select");
    button.click(); // Android's compatibility click must not activate again.
    expect(ws.currentTool).toBe("select");
    ws.destroy();
  });

  it("dismisses settings on page pen contact and retains WebView ownership through pen-up", () => {
    const ws = makeWorkspace();
    const internal = ws as unknown as { props: { onPageGestureChange?: (active: boolean) => void }; penSettingsEl: HTMLElement | null };
    const handoff = vi.fn(); internal.props.onPageGestureChange = handoff;
    const panel = document.createElement("div"); panel.setAttribute("role", "dialog");
    ws.containerElement.parentElement!.append(panel); internal.penSettingsEl = panel;
    ws.containerElement.dispatchEvent(pointerEvent("pointerdown", 21, 100, 100));
    expect(panel.isConnected).toBe(false);
    expect(handoff).toHaveBeenCalledWith(true);
    ws.containerElement.dispatchEvent(pointerEvent("pointerup", 21, 120, 100));
    expect(handoff).toHaveBeenLastCalledWith(false);
    ws.destroy();
  });

  it("ignores pen releases that did not start on the toolbar button", () => {
    const ws = makeWorkspace();
    const button = ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-tool="select"]')!;
    button.dispatchEvent(pointerEvent("pointerup", 22, 10, 10));
    expect(ws.currentTool).toBe("write");
    button.dispatchEvent(pointerEvent("pointerdown", 22, 10, 10));
    button.dispatchEvent(pointerEvent("pointercancel", 22, 10, 10));
    button.dispatchEvent(pointerEvent("pointerup", 22, 10, 10));
    expect(ws.currentTool).toBe("write");
    ws.destroy();
  });

  it("releases a popover-dismissal handoff when the workspace is destroyed mid-stroke", () => {
    const ws = makeWorkspace();
    const internal = ws as unknown as { props: { onPageGestureChange?: (active: boolean) => void }; penSettingsEl: HTMLElement | null };
    const handoff = vi.fn();
    internal.props.onPageGestureChange = handoff;
    internal.penSettingsEl = document.createElement("div");
    ws.containerElement.dispatchEvent(pointerEvent("pointerdown", 23, 100, 100));
    ws.destroy();
    expect(handoff.mock.calls).toEqual([[true], [false]]);
  });

  it("mirrors native ink into a ruled canvas only during a standard-display Web handoff", () => {
    const ws = makeWorkspace();
    ws.applyNativeWriteStroke(line(40, LINE + 6, 120, LINE + 20), false);
    const canvas = ws.containerElement.querySelector<HTMLCanvasElement>(".rw-canvas")!;
    const painted: Array<{
      strokeStyle: string;
      lineWidth: number;
      lineCap: string;
      lineJoin: string;
    }> = [];
    const tracedContext = {
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      lineCap: "",
      lineJoin: "",
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke() {
        painted.push({
          strokeStyle: this.strokeStyle,
          lineWidth: this.lineWidth,
          lineCap: this.lineCap,
          lineJoin: this.lineJoin,
        });
      },
    };
    vi.spyOn(canvas, "getContext").mockReturnValue(
      tracedContext as unknown as CanvasRenderingContext2D
    );

    expect(canvas.style.display).toBe("none");
    ws.setNativeWebHandoff(true);
    expect(canvas.style.display).toBe("");
    expect(canvas.width).toBeGreaterThan(0);
    expect(painted[0]).toMatchObject({ strokeStyle: "#909090", lineWidth: 1 });
    expect(painted[painted.length - 1]).toEqual({
      strokeStyle: DEFAULT_PREFERENCES.penColor,
      lineWidth: DEFAULT_PREFERENCES.penWidth,
      lineCap: "round",
      lineJoin: "round",
    });
    // The handoff canvas owns ink; a duplicate SVG run must not be layered over it.
    expect(ws.containerElement.querySelector(".rw-ink")).toBeNull();
    ws.setNativeWebHandoff(false);
    expect(canvas.style.display).toBe("none");
  });

  it("opens with a clean page and expands the toolbar from its edge tab", () => {
    const ws = makeWorkspace();
    const toolbar = ws.containerElement.closest(".pen-workspace")!.querySelector<HTMLElement>(".tool-pill")!;
    const handle = toolbar.querySelector<HTMLButtonElement>('[data-action="toolbar-toggle"]')!;

    expect(toolbar.classList.contains("toolbar-collapsed")).toBe(true);
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(handle.title).toBe("Show toolbar");

    handle.click();
    expect(toolbar.classList.contains("toolbar-collapsed")).toBe(false);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(handle.title).toContain("Drag to move");

    expect(toolbar.classList.contains("toolbar-all-tools")).toBe(false);
    const expand = toolbar.querySelector<HTMLButtonElement>('[data-action="toolbar-expand"]')!;
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expand.click();
    expect(toolbar.classList.contains("toolbar-all-tools")).toBe(true);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    ws.destroy();
  });

  it("opens shared pen colour/width settings and applies them to new native strokes", () => {
    const block = parseMarkdown("Alpha beta")[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onPreferencesChange = vi.fn();
    const onInkStyleChange = vi.fn();
    const ws = new PenWorkspace(host, {
      block,
      existingRuns: [],
      prefs: DEFAULT_PREFERENCES,
      eink: true,
      native: true,
      onPreferencesChange,
      onInkStyleChange,
      onCommit: () => {},
      onCancel: () => {},
    });
    const toolbar = host.querySelector<HTMLElement>(".tool-pill")!;
    toolbar.querySelector<HTMLButtonElement>('[data-action="toolbar-toggle"]')!.click();
    toolbar.querySelector<HTMLButtonElement>('[data-action="write"]')!.click();

    const panel = host.querySelector<HTMLElement>(".pen-settings-panel")!;
    expect(panel).not.toBeNull();
    panel.querySelector<HTMLButtonElement>('[data-color="#1838D8"]')!.click();
    const slider = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
    slider.value = "6.5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onInkStyleChange).toHaveBeenLastCalledWith("#1838D8", 6.5);
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ penColor: "#1838D8", penWidth: 6.5 })
    );
    ws.applyNativeWriteStroke(line(40, LINE + 6, 120, LINE + 20), false);
    expect(ws.reflowDoc.inserts.find((insert) => insert.kind === "ink")?.strokes[0]).toMatchObject({
      color: "#1838D8",
      width: 6.5,
    });
    ws.destroy();
  });

  it("does not start the native toolbar handoff until the drag threshold is crossed", () => {
    const block = parseMarkdown("Alpha beta")[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onToolbarDragChange = vi.fn();
    const onToolbarLayoutChange = vi.fn();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const ws = new PenWorkspace(host, {
      block,
      existingRuns: [],
      prefs: DEFAULT_PREFERENCES,
      eink: true,
      native: true,
      onToolbarDragChange,
      onToolbarLayoutChange,
      onCommit: () => {},
      onCancel: () => {},
    });
    const toolbar = host.querySelector<HTMLElement>(".tool-pill")!;
    const handle = toolbar.querySelector<HTMLButtonElement>('[data-action="toolbar-toggle"]')!;
    try {
      handle.click();
      const layoutCallsBeforeDrag = onToolbarLayoutChange.mock.calls.length;

      handle.dispatchEvent(pointerEvent("pointerdown", 7, 20, 20));
      handle.dispatchEvent(pointerEvent("pointermove", 7, 24, 22));
      expect(onToolbarDragChange).not.toHaveBeenCalled();
      handle.dispatchEvent(pointerEvent("pointermove", 7, 32, 20));
      expect(onToolbarDragChange).toHaveBeenCalledWith(true);
      handle.dispatchEvent(pointerEvent("pointerup", 7, 32, 20));
      expect(onToolbarDragChange).toHaveBeenLastCalledWith(false);
      expect(onToolbarLayoutChange).toHaveBeenCalledTimes(layoutCallsBeforeDrag + 1);
    } finally {
      ws.destroy();
      raf.mockRestore();
    }
  });

  it("uses the selected pen colour and thickness for native Zoom ink", () => {
    const block = parseMarkdown("Alpha beta")[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ws = new PenWorkspace(host, {
      block,
      existingRuns: [],
      prefs: { ...DEFAULT_PREFERENCES, penColor: "#1838D8", penWidth: 6.5 },
      eink: true,
      native: true,
      onCommit: () => {},
      onCancel: () => {},
    });

    ws.toggleMagnify();
    ws.applyNativeMagnifyStroke(line(20, 20, 80, 35));

    expect(ws.getNativeMagnifyStrokes()).toContainEqual(
      expect.objectContaining({ color: "#1838D8", width: 6.5 })
    );
    ws.reconcileMagnifyAfterIdle();
    expect(ws.getNativeInkStrokes()).toContainEqual(
      expect.objectContaining({ color: "#1838D8", width: 6.5 })
    );
    ws.destroy();
    // Keep Zoom recovery state isolated from later workspaces in the same jsdom.
    localStorage.removeItem("write2.magnify.draft");
  });

  it("does not replay the upper document's ink over the Zoom pad or its page controls", () => {
    const ws = makeWorkspace();
    ws.toggleMagnify();
    vi.spyOn(ws.containerElement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 200));
    const nav = ws.containerElement.parentElement!.querySelector<HTMLElement>(".magnify-page-nav")!;
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 100, 80, 60));
    const original = [{ pts: [{ x: 30, y: 130, pressure: .5 }, { x: 250, y: 130, pressure: .5 }], width: 2, color: "#000", selected: false },
      { pts: [{ x: 20, y: 220, pressure: .5 }, { x: 100, y: 240, pressure: .5 }], width: 2, color: "#000", selected: false }];
    vi.spyOn(ws, "getNativeInkStrokes").mockReturnValue(original);
    const shown = ws.getNativeMagnifyStrokes();
    expect(shown).toHaveLength(2);
    expect(shown[0].pts[shown[0].pts.length - 1].x).toBe(98);
    expect(shown[1].pts[0].x).toBe(182);
    expect(shown.every(s => s.pts.every(p => p.y < 200))).toBe(true);
    expect(original[1].pts[0].y).toBe(220);
    ws.destroy();
    localStorage.removeItem("write2.magnify.draft");
  });

  it("Zoom retires tool popups and owns ink even when opened from a web tool", () => {
    const ws = makeWorkspace();
    ws.applyNativeStroke(line(40, LINE + 6, 120, LINE + 20));
    const root = ws.containerElement.parentElement!;
    root.querySelector<HTMLButtonElement>('[data-action="shapes"]')!.click();
    expect(root.querySelector(".pen-settings-panel")).not.toBeNull();
    ws.toggleMagnify();
    expect(root.querySelector(".pen-settings-panel")).toBeNull();
    // The capture must contain paper only here: native replay is the single upper ink owner.
    expect(ws.containerElement.querySelector(".rw-ink")).toBeNull();
    root.querySelector<HTMLButtonElement>('[aria-label="Close magnified writing"]')!.click();
    expect(ws.containerElement.querySelector(".rw-ink")).not.toBeNull();
    ws.destroy();
    localStorage.removeItem("write2.magnify.draft");
  });

  it("clips saved ink at the Zoom strip even during an intermediate full-height paper layout", () => {
    const ws = makeWorkspace();
    ws.toggleMagnify();
    const root = ws.containerElement.parentElement!;
    vi.spyOn(ws.containerElement, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 600));
    vi.spyOn(root.querySelector<HTMLElement>(".magnify-pad")!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 300, 300, 200));
    vi.spyOn(ws, "getNativeInkStrokes").mockReturnValue([
      { pts: [{ x: 20, y: 250, pressure: .5 }, { x: 20, y: 350, pressure: .5 }], width: 2, color: "#000", selected: false },
      { pts: [{ x: 30, y: 360, pressure: .5 }, { x: 40, y: 380, pressure: .5 }], width: 2, color: "#000", selected: false },
    ]);
    const shown = ws.getNativeMagnifyStrokes();
    expect(shown).toHaveLength(1);
    expect(shown[0].pts[shown[0].pts.length - 1].y).toBe(298);
    ws.destroy();
    localStorage.removeItem("write2.magnify.draft");
  });

  it("expanded-rail Undo removes the latest unplaced native Zoom stroke", () => {
    const ws = makeWorkspace();
    ws.toggleMagnify();
    ws.applyNativeMagnifyStroke(line(80, 50, 140, 60));
    expect(ws.getNativeMagnifyStrokes()).toHaveLength(1);
    const root = ws.containerElement.parentElement!;
    root.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeMagnifyStrokes()).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(ws.getNativeMagnifyStrokes()).toHaveLength(1);
    expect(root.querySelector('.magnify-controls [aria-label="Undo last placement"]')).toBeNull();
    ws.destroy();
    localStorage.removeItem("write2.magnify.draft");
  });

  it("scrolls a Zoom target above navigation and still permits manual return to the top", () => {
    const ws = makeWorkspace();
    const surface = ws.containerElement;
    Object.defineProperties(surface, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 800 },
    });
    vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    vi.spyOn(ws, "magnifyInitialTarget").mockReturnValue({line:3,x:180,afterWord:-1});
    ws.toggleMagnify();
    const root = surface.parentElement!;
    const nav = root.querySelector<HTMLElement>(".magnify-page-nav")!;
    vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 160, 320, 60));
    root.querySelector<HTMLButtonElement>('[aria-label="New line"]')!.click();
    const target = root.querySelector<HTMLElement>(".magnify-target")!;
    const visibleBottom = parseFloat(target.style.top) + parseFloat(target.style.height) - surface.scrollTop;
    expect(surface.scrollTop).toBeGreaterThan(0);
    expect(visibleBottom).toBeLessThanOrEqual(152);
    expect(nav.querySelector<HTMLButtonElement>('[aria-label="Previous document page"]')!.disabled).toBe(false);
    nav.querySelector<HTMLButtonElement>('[aria-label="Next document page"]')!.click();
    nav.querySelector<HTMLButtonElement>('[aria-label="Previous document page"]')!.click();
    expect(surface.scrollTop).toBe(0); // browsing back must not auto-jump to the writing target
    ws.destroy();
    localStorage.removeItem("write2.magnify.draft");
  });

  it("updates the target and page text scale when Zoom settings change", () => {
    const ws = makeWorkspace();
    ws.toggleMagnify();
    const root = ws.containerElement.parentElement!;
    const viewport = root.querySelector<HTMLElement>(".magnify-viewport")!;
    expect(viewport.querySelector(".magnify-context")).toBeNull();
    root.querySelector<HTMLButtonElement>('[aria-label="Magnify settings"]')!.click();
    const select = root.querySelector<HTMLSelectElement>(".magnify-settings select")!;
    for (const scale of [2, 2.5, 3]) {
      select.value = String(scale);
      select.dispatchEvent(new Event("change"));
      const fontSize = Number(root.querySelector(".magnify-scene text")!.getAttribute("font-size"));
      expect(fontSize).toBeCloseTo(Number.parseFloat(ws.containerElement.style.getPropertyValue("--ruled-text-size")) * scale);
      const target = root.querySelector<HTMLElement>(".magnify-target")!;
      expect(Number.parseFloat(target.style.width)).toBeCloseTo(window.innerWidth / scale);
    }
    ws.destroy();
    localStorage.removeItem("write2.magnify.settings");
  });

  it("write: a completed stroke becomes a committed ink run", () => {
    const ws = makeWorkspace();
    ws.applyNativeStroke(line(40, LINE + 6, 120, LINE + 20));
    const strokes = ws.getNativeInkStrokes();
    expect(strokes.length).toBe(1);
    expect(strokes[0].pts.length).toBeGreaterThan(2);
    const ink = ws.reflowDoc.inserts.filter((i) => i.kind === "ink");
    expect(ink.length).toBe(1);
    expect(ink[0].strokes.length).toBe(1);
  });

  it("write: a nearby second stroke merges into the same ink word", () => {
    const ws = makeWorkspace();
    ws.applyNativeStroke(line(40, LINE + 6, 80, LINE + 20));
    ws.applyNativeStroke(line(86, LINE + 6, 110, LINE + 20));
    const ink = ws.reflowDoc.inserts.filter((i) => i.kind === "ink");
    expect(ink.length).toBe(1);
    expect(ink[0].strokes.length).toBe(2);
  });

  it("insert: drag right creates a gap sized by the horizontal delta", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(20, 10, 140, 12));
    const gaps = ws.reflowDoc.inserts.filter((i) => i.kind === "gap");
    expect(gaps.length).toBe(1);
    expect(gaps[0].width).toBeCloseTo(120, 0);
    expect(gaps[0].scopeLine).toBe(0);
    expect(gaps[0].scopeX).toBeCloseTo(0, 0);
  });

  it("insert: keeps the first moved word on the far side of the thick caret", () => {
    const ws = makeWorkspace("Insert space drag right");
    ws.setActiveTool("insert");

    // The caret begins inside the leading edge of “right”. A whole typed word
    // cannot be split, so it must clear the final caret instead of straddling it.
    ws.applyNativeStroke(line(150, 10, 250, 10));

    const guide = ws.containerElement.querySelector<HTMLElement>(".rw-insertion-guide")!;
    const moved = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
      (word) => word.textContent === "right"
    )!;
    expect(Number.parseFloat(guide.style.left)).toBeCloseTo(244, 0);
    expect(Number.parseFloat(moved.style.top)).toBe(0);
    expect(Number.parseFloat(moved.style.left)).toBeGreaterThanOrEqual(244);
  });

  it("insert: a tiny reverse drag cannot close already compact words", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(140, 10, 136, 12));
    expect(ws.reflowDoc.inserts.filter((i) => i.kind === "gap").length).toBe(0);
  });

  it("insert: closing compact text keeps all words and does not create a spacer", () => {
    const ws = makeWorkspace("Ok So now");
    const before = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map(w => w.outerHTML);
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(22, 10, 0, 10));
    expect([...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map(w => w.outerHTML)).toEqual(before);
    expect(ws.reflowDoc.inserts.filter(i => i.kind === "gap")).toHaveLength(0);
    ws.destroy();
  });

  it("insert: Done preserves words after a backward caret", () => {
    let source = "";
    const ws = makeWorkspace("Ok So now", (payload) => {
      source = payload.newSource;
    });
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(22, 10, 0, 10));

    const done = [...ws.containerElement.parentElement!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.startsWith("Done")
    )!;
    done.click();
    expect(source).toBe("Ok So now");
  });

  it("Done preserves reverse-moved ink in the reopenable sidecar", () => {
    let committed: CommitPayload | null = null;
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta", (payload) => {
      committed = payload;
    });
    ws.placeMagnifiedGroup([inkStroke("first", 40, LINE + 8, 70, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("second", 100, LINE + 8, 130, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("third", 160, LINE + 8, 190, LINE + 18)], 1);
    const originalIds = ws.reflowDoc.inserts
      .filter((insert) => insert.kind === "ink")
      .map((insert) => insert.id);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(205, LINE + 12, 145, LINE + 12));
    expect(ws.getNativeInkStrokes()).toHaveLength(3);

    const done = [...ws.containerElement.parentElement!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.startsWith("Done")
    )!;
    done.click();

    expect(committed).not.toBeNull();
    const payload = committed!;
    expect(payload.newRuns).toHaveLength(3);
    expect(payload.newRuns.map((run) => run.id)).toEqual(originalIds);
    const finalized = ws.getNativeInkStrokes();

    const reopened = makeWorkspace(
      parseMarkdown(payload.newSource)[0].text,
      () => {},
      payload.newRuns
    );
    const restored = reopened.getNativeInkStrokes();
    expect(restored).toHaveLength(3);
    expect(reopened.reflowDoc.inserts.map((insert) => insert.id)).toEqual(originalIds);
    restored.forEach((stroke, strokeIndex) => {
      stroke.pts.forEach((point, pointIndex) => {
        expect(point.x).toBeCloseTo(finalized[strokeIndex].pts[pointIndex].x, 4);
        expect(point.y).toBeCloseTo(finalized[strokeIndex].pts[pointIndex].y, 4);
      });
    });
  });

  it("Done preserves spaced handwriting until Collapse is explicitly used", () => {
    let committed: CommitPayload | null = null;
    const ws = makeWorkspace("Planning", (payload) => {
      committed = payload;
    });
    ws.placeMagnifiedGroup([inkStroke("first", 40, LINE + 8, 70, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("second", 100, LINE + 8, 130, LINE + 18)], 1);
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(84, LINE + 12, 144, LINE + 12));
    const expected = ws.getNativeInkStrokes();

    const done = [...ws.containerElement.parentElement!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.startsWith("Done")
    )!;
    done.click();

    expect(committed).not.toBeNull();
    expect(committed!.newRuns.every((run) => run.layoutX !== undefined && run.layoutY !== undefined)).toBe(true);
    const reopened = makeWorkspace("Planning", () => {}, committed!.newRuns);
    const restored = reopened.getNativeInkStrokes();
    expect(restored).toHaveLength(expected.length);
    restored.forEach((stroke, strokeIndex) => {
      stroke.pts.forEach((point, pointIndex) => {
        expect(point.x).toBeCloseTo(expected[strokeIndex].pts[pointIndex].x, 4);
        expect(point.y).toBeCloseTo(expected[strokeIndex].pts[pointIndex].y, 4);
      });
    });
  });

  it("collapse removes spacing without deleting reverse-moved words", () => {
    let source = "";
    const ws = makeWorkspace("Ok So now", (payload) => {
      source = payload.newSource;
    });
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(22, 10, 0, 10));
    expect(ws.reflowDoc.words).toEqual(["Ok", "So", "now"]);

    const buttons = [
      ...ws.containerElement.parentElement!.querySelectorAll<HTMLButtonElement>("button"),
    ];
    buttons.find((button) => button.getAttribute("aria-label") === "Spacing tools")!.click();
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[aria-label="Condense spacing"]')!.click();

    expect(ws.reflowDoc.words).toEqual(["Ok", "So", "now"]);
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "gap")).toHaveLength(0);
    expect(
      [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map((word) => word.textContent)
    ).toEqual(["Ok", "So", "now"]);

    buttons.find((button) => button.textContent?.startsWith("Done"))!.click();
    expect(source).toBe("Ok So now");
  });

  it("insert: never cuts a grouped handwriting word into stroke fragments", () => {
    const ws = makeWorkspace();
    ws.applyNativeStroke(line(40, LINE + 6, 75, LINE + 18));
    ws.applyNativeStroke(line(90, LINE + 6, 125, LINE + 18));
    expect(ws.reflowDoc.inserts.filter((ins) => ins.kind === "ink")).toHaveLength(1);
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(83, LINE + 10, 143, LINE + 10));

    expect(ws.reflowDoc.inserts.filter((ins) => ins.kind === "ink")).toHaveLength(1);
    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);
    expect(after[0].x - before[0].x).toBeCloseTo(after[1].x - before[1].x, 4);
    expect(after[0].y - before[0].y).toBeCloseTo(after[1].y - before[1].y, 4);
  });

  it("insert: a caret snapped before the first ink word leaves that word fixed", () => {
    const ws = makeWorkspace("\u200b");
    ws.applyNativeStroke(line(40, LINE + 6, 75, LINE + 18));
    ws.applyNativeStroke(line(90, LINE + 6, 125, LINE + 18));
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(60, LINE + 10, 40, LINE + 10));

    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink")).toHaveLength(1);
    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);
    const firstShift = after[0].x - before[0].x;
    expect(firstShift).toBe(0);
    expect(after).toEqual(before);
  });

  it("insert: settles completed blank-page gaps before a distinct row edit", () => {
    const ws = makeWorkspace("\u200b");
    ws.placeMagnifiedGroup([inkStroke("top-left", 40, 8, 70, 18)], 0);
    ws.placeMagnifiedGroup([inkStroke("top-right", 120, 8, 150, 18)], 0);
    ws.placeMagnifiedGroup([inkStroke("lower-left", 60, LINE + 8, 90, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("lower-right", 140, LINE + 8, 170, LINE + 18)], 1);
    ws.setActiveTool("insert");

    ws.applyNativeStroke(line(100, 12, 140, 12));
    const topAfterFirst = ws.getNativeInkStrokes().slice(0, 2).map((stroke) => stroke.pts[0]);
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "gap")).toHaveLength(1);

    ws.applyNativeStroke(line(120, LINE + 12, 90, LINE + 12));

    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "gap")).toHaveLength(1);
    expect(ws.getNativeInkStrokes().slice(0, 2).map((stroke) => stroke.pts[0])).toEqual(topAfterFirst);
    expect(ws.containerElement.querySelectorAll(".rw-insertion-guide")).toHaveLength(1);
  });

  it("insert: a backward caret keeps every word visible when the preceding row is full", () => {
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta");
    // A full preceding row prevents wrap, but must never turn the caret into
    // a deletion gesture.
    ws.placeMagnifiedGroup([inkStroke("blocker", 40, LINE + 8, 130, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("victim", 160, LINE + 8, 190, LINE + 18)], 1);
    expect(ws.getNativeInkStrokes()).toHaveLength(2);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(205, LINE + 12, 145, LINE + 12));
    expect(ws.getNativeInkStrokes()).toHaveLength(2);

    ws.applyNativeStroke(line(145, LINE + 12, 205, LINE + 12));
    expect(ws.getNativeInkStrokes()).toHaveLength(2);
  });

  it("insert: a backward caret moves left-side handwriting and leaves the right side fixed", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.placeMagnifiedGroup([inkStroke("first", 40, LINE + 8, 70, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("second", 100, LINE + 8, 130, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("third", 160, LINE + 8, 190, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("ahead", 240, LINE + 8, 270, LINE + 18)], 1);
    const before = ws.getNativeInkStrokes();

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(205, LINE + 12, 145, LINE + 12));

    const after = ws.getNativeInkStrokes();
    expect(after).toHaveLength(4);
    expect(after[2].pts[0].x).toBeCloseTo(100);
    expect(after[3]).toEqual(before[3]);
    expect(after[1].pts[0].x).toBeLessThan(before[1].pts[0].x);
  });

  it("insert: left drag before the first word leaves right-side handwriting unchanged", () => {
    // The preceding line is full, but the lower word itself has ample room to
    // move left. Same-row space takes priority over concealment.
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta");
    ws.placeMagnifiedGroup([inkStroke("work", 160, LINE + 8, 190, LINE + 18)], 1);
    const before = ws.getNativeInkStrokes()[0].pts[0];

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(140, LINE + 12, 80, LINE + 12));

    const strokes = ws.getNativeInkStrokes();
    expect(strokes).toHaveLength(1);
    expect(strokes[0].pts[0]).toEqual(before);
    expect(strokes[0].pts[0].y).toBeCloseTo(before.y, 0);
  });

  it("insert: a trailing caret wraps its whole target onto the preceding row", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.placeMagnifiedGroup([inkStroke("left-edge", 4, LINE + 8, 34, LINE + 18)], 1);
    const before = ws.getNativeInkStrokes()[0].pts[0];

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(50, LINE + 12, 10, LINE + 12));

    expect(ws.getNativeInkStrokes()[0].pts[0].y).toBeCloseTo(before.y - LINE);
    expect(ws.getNativeInkStrokes()[0].pts[0].x).toBeCloseTo(282);
  });

  it("insert: trailing reverse pressure preserves reading order across insertion order", () => {
    const ws = makeWorkspace("A");
    // Write the lower word first, then correct the preceding line. Synthetic
    // insertion order is now the opposite of visual reading order.
    ws.placeMagnifiedGroup([inkStroke("lower-first", 160, LINE + 8, 190, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("lower-blocker", 40, LINE + 8, 130, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("upper-later", 40, 8, 70, 18)], 0);
    const before = ws.getNativeInkStrokes();

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(205, LINE + 12, 145, LINE + 12));

    const after = ws.getNativeInkStrokes();
    expect(after[1].pts[0].y).toBeCloseTo(before[1].pts[0].y - LINE);
    expect(after[2]).toEqual(before[2]);
    expect(after[0].pts[0].x - before[0].pts[0].x).toBeCloseTo(-60);
    expect(after[0].pts[0].y).toBeCloseTo(before[0].pts[0].y);
  });

  it("insert: backward wrap pushes only the collided preceding handwriting", () => {
    const ws = makeWorkspace("A");
    ws.placeMagnifiedGroup([inkStroke("early", 40, 8, 70, 18)], 0);
    ws.placeMagnifiedGroup([inkStroke("late", 270, 8, 300, 18)], 0);
    ws.placeMagnifiedGroup([inkStroke("incoming", 20, LINE + 8, 50, LINE + 18)], 1);
    const before = ws.getNativeInkStrokes();

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(60, LINE + 12, 0, LINE + 12));

    const after = ws.getNativeInkStrokes();
    expect(after[0]).toEqual(before[0]);
    expect(after[1].pts[0].x).toBeLessThan(before[1].pts[0].x);
    expect(after[1].pts[after[1].pts.length - 1].x + 17.6).toBeLessThanOrEqual(after[2].pts[0].x);
    expect(after[2].pts[0].y).toBeCloseTo(before[2].pts[0].y - LINE);
  });

  it("insert: backward pressure cascades through earlier rows without losing words", () => {
    const ws = makeWorkspace("A");
    ws.placeMagnifiedGroup([inkStroke("top", 260, 8, 300, 18)], 0);
    ws.placeMagnifiedGroup([inkStroke("previous", 20, LINE + 8, 120, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("later", 170, LINE + 8, 270, LINE + 18)], 1);
    ws.placeMagnifiedGroup([inkStroke("incoming", 20, LINE * 2 + 8, 120, LINE * 2 + 18)], 2);
    const before = ws.getNativeInkStrokes();

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(130, LINE * 2 + 12, 50, LINE * 2 + 12));

    const after = ws.getNativeInkStrokes();
    expect(after).toHaveLength(before.length);
    expect(after[0].pts[0].x).toBeLessThan(before[0].pts[0].x);
    expect(after[1].pts[0].y).toBeCloseTo(before[1].pts[0].y - LINE);
    expect(after[2].pts[0].x).toBeLessThan(before[2].pts[0].x);
    expect(after[3].pts[0].y).toBeCloseTo(before[3].pts[0].y - LINE);
  });

  it("insert: a long descender remains owned by its upper letter-body lane", () => {
    const ws = makeWorkspace("A");
    ws.placeMagnifiedGroup(
      [
        inkStroke("p-body", 40, 14, 70, 40),
        inkStroke("p-descender", 52, 28, 52, 94),
      ],
      0
    );
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(20, 12, 50, 12));

    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);
    expect(after).toHaveLength(2);
    expect(after[0].x).toBeGreaterThan(before[0].x + 20);
    expect(after[1].x).toBeGreaterThan(before[1].x + 20);
    expect(after[0].y).toBeCloseTo(before[0].y, 0);
    expect(after[1].y).toBeCloseTo(before[1].y, 0);
  });

  it("insert: a lower-row caret cannot split an upper-row descender", () => {
    const ws = makeWorkspace("A");
    ws.placeMagnifiedGroup(
      [
        inkStroke("g-body", 40, 14, 70, 40),
        inkStroke("g-descender", 52, 28, 52, 94),
      ],
      0
    );
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink")).toHaveLength(1);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(60, LINE + 12, 30, LINE + 12));

    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink")).toHaveLength(1);
    expect(after).toEqual(before);
  });

  it("insert: a small left move keeps an uncrossed free-ink word on the caret row", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.applyNativeStroke(line(100, LINE + 8, 180, LINE + 18));
    const before = ws.getNativeInkStrokes()[0].pts[0];

    ws.setActiveTool("insert");
    // The visible caret snaps before this word; subtraction cannot move that word.
    ws.applyNativeStroke(line(110, LINE + 12, 100, LINE + 12));

    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    const after = ws.getNativeInkStrokes()[0].pts[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("insert: reverse movement does not pull a forward-side wrapped word", () => {
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta eta theta");
    const word = (text: string) =>
      [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
        (candidate) => candidate.textContent === text
      )!;
    expect(Number.parseFloat(word("theta").style.top)).toBe(LINE);

    ws.setActiveTool("insert");
    // Move the left side; the wrapped forward suffix remains on line 1.
    ws.applyNativeStroke(line(310, 12, 250, 12));
    expect(Number.parseFloat(word("epsilon").style.top)).toBe(0);

    // Theta is ahead/right of this new backward caret and must remain still.
    ws.applyNativeStroke(line(10, LINE + 12, 0, LINE + 12));
    expect(Number.parseFloat(word("theta").style.top)).toBe(LINE);
  });

  it("insert: a backward caret can refill the preceding row with its continuation", () => {
    const ws = makeWorkspace("Ok So Not Too");
    const word = (text: string) =>
      [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
        (candidate) => candidate.textContent === text
      )!;
    ws.setActiveTool("insert");

    // Open a large first-line buffer that wraps Too onto the next line.
    ws.applyNativeStroke(line(64, 12, 300, 12));
    expect(Number.parseFloat(word("Too").style.top)).toBe(LINE);
    const tooRight =
      Number.parseFloat(word("Too").style.left) + Number.parseFloat(word("Too").style.width || "24");

    ws.applyNativeStroke(line(tooRight, LINE + 12, tooRight - 12, LINE + 12));

    expect(word("Too")).not.toBeUndefined();
    expect(Number.parseFloat(word("Too").style.top)).toBe(0);
    expect(ws.reflowDoc.words).toEqual(["Ok", "So", "Not", "Too"]);
  });

  it("magnify: stores visibly separated words as independent ink runs", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.placeMagnifiedGroup(
      [
        inkStroke("one-a", 30, LINE + 8, 36, LINE + 18),
        inkStroke("one-b", 42, LINE + 8, 49, LINE + 18),
        inkStroke("two-a", 85, LINE + 8, 92, LINE + 18),
        inkStroke("two-b", 98, LINE + 8, 105, LINE + 18),
      ],
      1
    );

    const runs = ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink");
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.strokes.length)).toEqual([2, 2]);
  });

  it("insert: keeps an unmodified handwriting word atomic after a vertical tap", () => {
    const ws = makeWorkspace("Alpha beta gamma delta epsilon");
    ws.applyNativeWriteStroke(line(150, 8, 180, 18), false);
    ws.applyNativeWriteStroke(line(190, 8, 220, 18), false);
    expect(ws.reflowDoc.inserts.filter((ins) => ins.kind === "ink")).toHaveLength(1);

    // A vertical tap leaves both ink coordinates and word membership intact.
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(10, 4, 10, 4));
    const packed = ws.reflowDoc.inserts.find((ins) => ins.kind === "ink")!;
    expect(packed.freeX).toBeDefined();

    const before = ws.getNativeInkStrokes();
    const firstRight = Math.max(...before[0].pts.map((point) => point.x));
    const secondLeft = Math.min(...before[1].pts.map((point) => point.x));
    const caretX = (firstRight + secondLeft) / 2;
    const caretY = before[0].pts[0].y;
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(caretX, caretY, caretX + 60, caretY));

    expect(ws.reflowDoc.inserts.filter((ins) => ins.kind === "ink")).toHaveLength(1);
    const after = ws.getNativeInkStrokes();
    expect(after[0].pts[0].x - before[0].pts[0].x).toBeCloseTo(
      after[1].pts[0].x - before[1].pts[0].x,
      4
    );
  });

  it("lines: drag down inserts rounded-line blank space", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(30, 10, 34, 10 + 3 * LINE));
    const lines = ws.reflowDoc.inserts.filter((i) => i.kind === "line");
    expect(lines.length).toBe(1);
    expect(lines[0].lines).toBe(3);
  });

  it("lines: the newest thick handle can be pulled upward to close blank lines", () => {
    const ws = makeWorkspace("Like this text");
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(30, 4, 30, 4 + 3 * LINE));

    let spacer = ws.reflowDoc.inserts.find((insert) => insert.kind === "line");
    expect(spacer?.lines).toBe(3);
    expect(ws.containerElement.querySelector<HTMLElement>(".rw-line-gap")?.style.top).toBe(`${3 * LINE}px`);

    ws.applyNativeStroke(line(30, 3 * LINE, 30, 2 * LINE));
    spacer = ws.reflowDoc.inserts.find((insert) => insert.kind === "line");
    expect(spacer?.lines).toBe(2);
    expect(ws.containerElement.querySelector<HTMLElement>(".rw-line-gap")?.style.top).toBe(`${2 * LINE}px`);
    expect(Number.parseFloat(ws.containerElement.querySelector<HTMLElement>(".rw-word")!.style.top)).toBe(2 * LINE);

    ws.applyNativeStroke(line(30, 2 * LINE, 30, 0));
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "line")).toHaveLength(0);
    expect(ws.containerElement.querySelector(".rw-line-gap")).toBeNull();
    expect(Number.parseFloat(ws.containerElement.querySelector<HTMLElement>(".rw-word")!.style.top)).toBe(0);
  });

  it("lines: a tap leaves content unchanged", () => {
    const ws = makeWorkspace("Like this text");
    ws.setActiveTool("lines");
    ws.applyNativeStroke([{ x: 10, y: 4, t: 0, pressure: 0.5 }]);
    const spacer = ws.reflowDoc.inserts.find((insert) => insert.kind === "line");
    expect(spacer).toBeUndefined();
    const word = ws.containerElement.querySelector<HTMLElement>(".rw-word")!;
    expect(Number.parseFloat(word.style.top)).toBe(0);
    expect(ws.containerElement.querySelector(".rw-line-gap")).toBeNull();
  });

  it("lines: closing occupied rows stops without concealing words", () => {
    const ws = makeWorkspace("Top alpha beta gamma delta epsilon zeta Lower eta theta iota kappa lambda mu");
    const before = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map(w => w.outerHTML);
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(30, LINE, 30, 0));
    expect([...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map(w => w.outerHTML)).toEqual(before);
    expect(ws.reflowDoc.inserts.filter(i => i.kind === "line")).toHaveLength(0);
    ws.destroy();
  });

  it("lines: an upward caret preserves handwriting above its starting boundary", () => {
    const ws = makeWorkspace("Alpha beta");
    // Its centre belongs to line 2, but the descender visibly reaches into
    // line 3. Pulling a boundary-4 caret up to boundary 3 must not leave that
    // descender drawn through the thick caret.
    ws.placeMagnifiedGroup(
      [inkStroke("overhang", 80, 2 * LINE + 10, 120, 3 * LINE + 4)],
      2
    );
    expect(ws.getNativeInkStrokes()).toHaveLength(1);

    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(20, 4 * LINE, 20, 3 * LINE));
    expect(ws.getNativeInkStrokes()).toHaveLength(1);

    ws.applyNativeStroke(line(20, 3 * LINE, 20, 4 * LINE));
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
  });

  it("lines: accepts a new caret placement when release lands outside the surface", () => {
    const ws = makeWorkspace("Like this text");
    try {
      ws.setActiveTool("lines");
      const surface = ws.containerElement;

      surface.dispatchEvent(pointerEvent("pointerdown", 31, 10, 4));
      surface.dispatchEvent(pointerEvent("pointermove", 31, 10, LINE + 4));
      window.dispatchEvent(pointerEvent("pointerup", 31, 10, 4));
      surface.dispatchEvent(pointerEvent("pointerdown", 32, 10, 2 * LINE + 4));
      surface.dispatchEvent(pointerEvent("pointermove", 32, 10, 3 * LINE + 4));
      window.dispatchEvent(pointerEvent("pointerup", 32, 10, 2 * LINE + 4));

      const spacers = ws.reflowDoc.inserts.filter((insert) => insert.kind === "line");
      expect(spacers).toHaveLength(1);
      expect(spacers.map((insert) => insert.scopeLine)).toEqual([0]);
      const handles = surface.querySelectorAll<HTMLElement>(".rw-line-gap");
      expect(handles).toHaveLength(1);
      expect(handles[0].style.top).toBe(`${LINE}px`);
    } finally {
      ws.destroy();
    }
  });

  it("lines: recovers before a new caret placement when pointerup is lost", () => {
    const ws = makeWorkspace("Like this text");
    try {
      ws.setActiveTool("lines");
      const surface = ws.containerElement;

      surface.dispatchEvent(pointerEvent("pointerdown", 41, 10, 4));
      surface.dispatchEvent(pointerEvent("pointerdown", 42, 10, 2 * LINE + 4));
      window.dispatchEvent(pointerEvent("pointerup", 42, 10, 2 * LINE + 4));

      const spacers = ws.reflowDoc.inserts.filter((insert) => insert.kind === "line");
      expect(spacers).toHaveLength(0);
      expect(spacers.map((insert) => insert.scopeLine)).toEqual([]);
    } finally {
      ws.destroy();
    }
  });

  it("lines: new ink after an upward collapse stays at its written coordinates", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(20, 2 * LINE, 20, LINE));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(100, LINE + 8, 130, LINE + 18), false);
    ws.applyNativeWriteStroke(line(180, 3 * LINE + 8, 210, 3 * LINE + 18), false);
    const strokes = ws.getNativeInkStrokes();
    expect(strokes).toHaveLength(2);
    expect(strokes[0].pts[0].y).toBeCloseTo(LINE + 8);
    expect(strokes[1].pts[0].y).toBeCloseTo(3 * LINE + 8);
    ws.destroy();
  });

  it("lines: packing ink written after opening space preserves its ruled row", () => {
    const ws = makeWorkspace("\u200b");
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(20, 0, 20, 2 * LINE));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(100, 3 * LINE + 8, 130, 3 * LINE + 18), false);
    const before = ws.getNativeInkStrokes()[0].pts[0].y;
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(20, 6 * LINE, 20, 7 * LINE));
    expect(ws.getNativeInkStrokes()[0].pts[0].y).toBeCloseTo(before);
    ws.destroy();
  });

  it("lines: sorting old and new ink preserves historical spacer membership", () => {
    const ws = makeWorkspace("\u200b");
    ws.applyNativeWriteStroke(line(100, 2 * LINE + 8, 130, 2 * LINE + 18), false);
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(20, LINE, 20, 2 * LINE));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(180, 8, 210, 18), false);
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0].y).sort((a, b) => a - b);
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(20, 6 * LINE, 20, 7 * LINE));
    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0].y).sort((a, b) => a - b);
    expect(after).toEqual(before);
    ws.destroy();
  });

  it("lines: moves handwriting with typed text on the same ruled line", () => {
    const ws = makeWorkspace("Like this text");
    ws.applyNativeWriteStroke(line(170, 8, 205, 18), false);
    const wordBefore = ws.containerElement.querySelector<HTMLElement>(".rw-word")!;
    const inkBefore = ws.getNativeInkStrokes()[0].pts[0];
    expect(Number.parseFloat(wordBefore.style.top)).toBe(0);
    expect(Math.floor(inkBefore.y / LINE)).toBe(0);

    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(10, 4, 10, 4 + LINE));

    const wordAfter = ws.containerElement.querySelector<HTMLElement>(".rw-word")!;
    const inkAfter = ws.getNativeInkStrokes()[0].pts[0];
    expect(Number.parseFloat(wordAfter.style.top)).toBe(LINE);
    expect(Math.floor(inkAfter.y / LINE)).toBe(1);
    expect(ws.containerElement.querySelector<HTMLElement>(".rw-line-gap")?.style.top).toBe(`${LINE}px`);
    expect(ws.containerElement.querySelector<HTMLElement>(".rw-line-gap")?.style.height).toBe("0px");
    expect(ws.containerElement.style.minHeight).toBe("0px");
  });

  it("lines: moves text that a horizontal spacer wrapped onto the boundary", () => {
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu");
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(100, LINE + 10, 260, LINE + 10));

    const wrapped = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
      (word) => Number.parseFloat(word.style.top) === 2 * LINE
    );
    expect(wrapped).toBeDefined();
    const wrappedText = wrapped!.textContent;

    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(10, 2 * LINE + 4, 10, 3 * LINE + 4));

    const moved = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
      (word) => word.textContent === wrappedText
    );
    expect(Number.parseFloat(moved!.style.top)).toBe(3 * LINE);
  });

  it("erase: a stroke across an ink run removes it", () => {
    const ws = makeWorkspace();
    ws.applyNativeStroke(line(40, LINE + 6, 120, LINE + 20));
    expect(ws.getNativeInkStrokes().length).toBe(1);
    const [run] = ws.getNativeInkStrokes();
    const mid = run.pts[Math.floor(run.pts.length / 2)];
    ws.setActiveTool("erase");
    ws.applyNativeStroke([{ x: mid.x, y: mid.y, t: 0, pressure: 0.5 }]);
    expect(ws.getNativeInkStrokes().length).toBe(0);
  });

  it("select: tap selects a run; drag moves it", () => {
    const ws = makeWorkspace();
    ws.applyNativeStroke(line(40, LINE + 6, 120, LINE + 20));
    const before = ws.getNativeInkStrokes()[0].pts[0];
    ws.setActiveTool("select");
    // Tap on the run selects it.
    ws.applyNativeStroke([{ x: before.x + 2, y: before.y + 2, t: 0, pressure: 0.5 }]);
    expect(ws.selectedId).not.toBeNull();
    expect(ws.getNativeInkStrokes()[0].selected).toBe(true);
    // Drag from the run moves it (free ink translates).
    ws.applyNativeStroke(line(before.x + 2, before.y + 2, before.x + 62, before.y + 24));
    const after = ws.getNativeInkStrokes()[0].pts[0];
    expect(after.x - before.x).toBeCloseTo(60, 0);
  });

  it("select: separates a legacy phrase into word-sized selections before deleting", () => {
    const phrase = [
      inkStroke("is-1", 4, 8, 9, 20),
      inkStroke("is-2", 13, 8, 18, 20),
      inkStroke("enough-1", 48, 8, 54, 20),
      inkStroke("enough-2", 59, 8, 66, 20),
      inkStroke("honestly-1", 100, 8, 107, 20),
      inkStroke("honestly-2", 112, 8, 120, 20),
    ];
    const ws = makeWorkspace("Alpha beta", () => {}, [legacyInkRun("legacy-phrase", phrase)]);
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink")).toHaveLength(1);

    const rightmostStroke = [...ws.getNativeInkStrokes()].sort(
      (a, b) => b.pts[0].x - a.pts[0].x
    )[0];
    const hit = rightmostStroke.pts[Math.floor(rightmostStroke.pts.length / 2)];
    ws.setActiveTool("select");
    ws.applyNativeStroke([{ ...hit, t: 0 }]);

    const inkInserts = ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink");
    expect(inkInserts).toHaveLength(3);
    expect(inkInserts.find((insert) => insert.id === ws.selectedId)?.strokes).toHaveLength(2);
    // Native selection owns visible ink; selection is represented in the vector replay.
    expect(ws.getNativeInkStrokes().filter(stroke=>stroke.selected)).toHaveLength(2);
    expect(inkInserts.find(insert=>insert.id===ws.selectedId)?.width).toBeLessThan(40);

    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>(".delete-ink")!.click();
    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "ink")).toHaveLength(2);
    expect(ws.getNativeInkStrokes()).toHaveLength(4);
  });
});

describe("HWR convert-to-text", () => {
  function makeHwrWorkspace(result: HwrResult) {
    const block = parseMarkdown("Alpha beta gamma delta epsilon zeta")[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    return new PenWorkspace(host, {
      block,
      existingRuns: [],
      prefs: DEFAULT_PREFERENCES,
      eink: true,
      native: true,
      hwr: {
        available: () => true,
        recognize: (_strokes, _area, _pre, cb) => cb(result),
      },
      onCommit: () => {},
      onCancel: () => {},
    });
  }

  it("replaces the selected ink run with recognized words and shifts later anchors", () => {
    const ws = makeHwrWorkspace({
      text: "hello world",
      words: [
        { label: "hello", candidates: ["hello", "Hello", "help"] },
        { label: "world", candidates: ["world", "would", "word"] },
      ],
    });
    // Write a run, then a second, distant run whose anchor sits later.
    ws.applyNativeStroke(line(40, LINE + 6, 90, LINE + 20));
    ws.applyNativeStroke(line(240, 5 * LINE + 6, 290, 5 * LINE + 20));
    expect(ws.reflowDoc.inserts.filter((i) => i.kind === "ink").length).toBe(2);
    const wordsBefore = ws.reflowDoc.words.length;

    // Select the first run and convert.
    ws.setActiveTool("select");
    const first = ws.getNativeInkStrokes().find((s) => !s.selected)!;
    ws.applyNativeStroke([{ x: first.pts[0].x + 2, y: first.pts[0].y + 2, t: 0, pressure: 0.5 }]);
    const selectedId = ws.selectedId!;
    expect(selectedId).not.toBeNull();

    const convert = [...document.querySelectorAll(".tool-pill .convert-ink")].pop() as HTMLButtonElement;
    expect(convert.style.display).not.toBe("none");
    convert.click();
    const sheet = document.querySelector(".hwr-sheet")!;
    expect(sheet).not.toBeNull();
    const wordButtons = [...sheet.querySelectorAll<HTMLButtonElement>(".hwr-word")];
    expect(wordButtons.map((button) => button.textContent)).toEqual(["hello", "world"]);
    wordButtons[1].click();
    const alternatives = [...sheet.querySelectorAll<HTMLButtonElement>(".hwr-alts button")];
    expect(alternatives.map((button) => button.textContent)).toEqual(["world", "would", "word"]);
    alternatives.find((button) => button.textContent === "would")!.click();
    (sheet.querySelector(".hwr-actions .done") as HTMLButtonElement).click();

    // Ink run replaced by two words; the other run survives.
    expect(ws.reflowDoc.words.length).toBe(wordsBefore + 2);
    expect(ws.reflowDoc.words).toContain("hello");
    expect(ws.reflowDoc.words).toContain("would");
    expect(ws.reflowDoc.inserts.filter((i) => i.kind === "ink").length).toBe(1);
    expect(ws.reflowDoc.inserts.find((i) => i.id === selectedId)).toBeUndefined();
    expect(document.querySelector(".hwr-sheet")).toBeNull();
  });

  it("keeps the original selected run when Keep ink is chosen", () => {
    const ws = makeHwrWorkspace({
      text: "hello world",
      words: [
        { label: "hello", candidates: ["hello", "help"] },
        { label: "world", candidates: ["world", "word"] },
      ],
    });
    ws.applyNativeStroke(line(40, LINE + 6, 110, LINE + 20));
    ws.setActiveTool("select");
    const point = ws.getNativeInkStrokes()[0].pts[0];
    ws.applyNativeStroke([{ x: point.x + 2, y: point.y + 2, t: 0, pressure: 0.5 }]);
    const selectedId = ws.selectedId!;
    const wordsBefore = [...ws.reflowDoc.words];
    ([...document.querySelectorAll(".tool-pill .convert-ink")].pop() as HTMLButtonElement).click();
    const sheet = [...document.querySelectorAll<HTMLElement>(".hwr-sheet")].pop()!;
    (sheet.querySelector(".hwr-word") as HTMLButtonElement).click();
    expect(sheet.querySelector(".hwr-word-options")?.textContent).toContain("Keep original ink");
    (sheet.querySelector(".hwr-word-options .hwr-keep-ink") as HTMLButtonElement).click();

    expect(ws.reflowDoc.words).toEqual(wordsBefore);
    expect(ws.reflowDoc.inserts.find((insert) => insert.id === selectedId)?.kind).toBe("ink");
    expect(document.querySelector(".hwr-sheet")).toBeNull();
  });

  it("shows the error message when recognition is unavailable", () => {
    const ws = makeHwrWorkspace({ error: "unavailable" });
    ws.applyNativeStroke(line(40, LINE + 6, 90, LINE + 20));
    ws.setActiveTool("select");
    const pt = ws.getNativeInkStrokes()[0].pts[0];
    ws.applyNativeStroke([{ x: pt.x + 2, y: pt.y + 2, t: 0, pressure: 0.5 }]);
    ([...document.querySelectorAll(".tool-pill .convert-ink")].pop() as HTMLButtonElement).click();
    const sheet = [...document.querySelectorAll(".hwr-sheet")].pop()!;
    expect(sheet.querySelector(".hwr-msg")!.textContent).toContain("not available");
    (sheet.querySelector("button") as HTMLButtonElement).click();
    expect(document.querySelector(".hwr-sheet")).toBeNull();
  });

  it("keeps Convert visible and actionable when recognition is temporarily unavailable", () => {
    const block = parseMarkdown("Alpha beta")[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ws = new PenWorkspace(host, {
      block,
      existingRuns: [],
      prefs: DEFAULT_PREFERENCES,
      eink: true,
      native: true,
      hwr: {
        available: () => false,
        recognize: (_strokes, _area, _pre, cb) => cb({ error: "unavailable" }),
      },
      onCommit: () => {},
      onCancel: () => {},
    });
    ws.applyNativeStroke(line(40, LINE + 6, 90, LINE + 20));
    ws.setActiveTool("select");
    const pt = ws.getNativeInkStrokes()[0].pts[0];
    ws.applyNativeStroke([{ x: pt.x + 2, y: pt.y + 2, t: 0, pressure: 0.5 }]);

    const convert = host.querySelector<HTMLButtonElement>(".convert-ink")!;
    expect(convert.style.display).not.toBe("none");
    expect(convert.disabled).toBe(false);
    convert.click();
    expect(host.querySelector(".hwr-msg")?.textContent).toContain("not available");
  });
});

describe("native pointer path for drag tools", () => {
  function pointer(type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries({ pointerId: 5, pointerType: "pen", isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: 1, ...extra })) {
      Object.defineProperty(ev, k, { value: v });
    }
    return ev;
  }

  it("insert-space works via pointer events even in native mode", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    const el = ws.containerElement;
    el.dispatchEvent(pointer("pointerdown", 20, 10));
    const guide = el.querySelector(".rw-insertion-guide") as HTMLElement;
    expect(guide).not.toBeNull();
    expect(guide.style.height).toBe(`${LINE}px`);
    el.dispatchEvent(pointer("pointermove", 140, 12));
    expect(guide.style.left).toBe("120px");
    el.dispatchEvent(pointer("pointerup", 140, 12, { buttons: 0 }));
    expect((el.querySelector(".rw-insertion-guide") as HTMLElement).style.left).toBe("120px");
    const gaps = ws.reflowDoc.inserts.filter((i) => i.kind === "gap");
    expect(gaps.length).toBe(1);
  });

  it("insert-space keeps one reusable thick handle at the newest gap edge", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    const el = ws.containerElement;

    ws.applyNativeStroke(line(20, 10, 140, 10));
    ws.applyNativeStroke(line(30, LINE + 10, 130, LINE + 10));

    const guides = el.querySelectorAll<HTMLElement>(".rw-insertion-guide");
    expect(guides).toHaveLength(1);
    expect(guides[0].style.left).toBe("100px");
    expect(guides[0].style.top).toBe(`${LINE}px`);

    ws.applyNativeStroke(line(100, LINE + 10, 50, LINE + 10));
    const activeGap = ws.reflowDoc.inserts.find(
      (insert) => insert.kind === "gap" && insert.scopeLine === 1
    );
    expect(activeGap?.width).toBeCloseTo(50, 0);
    expect((el.querySelector(".rw-insertion-guide") as HTMLElement).style.left).toBe("50px");

    ws.setActiveTool("erase");
    expect(el.querySelector(".rw-insertion-guide")).toBeNull();
  });

  it("dragging an existing insert caret back repacks its typed suffix onto the previous line", () => {
    const ws = makeWorkspace("Ok So Not Too");
    const word = (text: string) =>
      [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
        (candidate) => candidate.textContent === text
      )!;
    ws.setActiveTool("insert");

    ws.applyNativeStroke(line(64, 12, 300, 12));
    expect(Number.parseFloat(word("Too").style.top)).toBe(LINE);

    // Reuse the visible edge of the same gap and almost close it. The word
    // that its outward move wrapped must immediately refill line 0.
    const edge = Number.parseFloat(ws.containerElement.querySelector<HTMLElement>(".rw-insertion-guide")!.style.left);
    ws.applyNativeStroke(line(edge, 12, edge - 216, 12));

    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "gap")).toHaveLength(1);
    expect(Number.parseFloat(word("Too").style.top)).toBe(0);
  });

  it("dragging an existing insert caret back fills the preceding line with handwriting", () => {
    const ws = makeWorkspace("A");
    ws.placeMagnifiedGroup([inkStroke("first", 40, 8, 70, 18)], 0);
    ws.placeMagnifiedGroup([inkStroke("second", 100, 8, 130, 18)], 0);
    const before = ws.getNativeInkStrokes();
    ws.setActiveTool("insert");

    // Push the second handwritten word onto line 1, then pull the same handle
    // back. A word wrapped by this caret must refill its original line.
    ws.applyNativeStroke(line(82, 12, 302, 12));
    expect(ws.getNativeInkStrokes()[1].pts[0].y - before[1].pts[0].y).toBeCloseTo(LINE, 0);
    ws.applyNativeStroke(line(302, 12, 102, 12));

    const after = ws.getNativeInkStrokes();
    expect(after).toHaveLength(before.length);
    expect(after[1].pts[0].y).toBeCloseTo(before[1].pts[0].y, 0);
    expect(after[1].pts[0].x).toBeGreaterThan(after[0].pts[0].x);
  });

  it("wraps handwriting left of a trailing caret onto the previous row", () => {
    const ws = makeWorkspace("A");
    // Line 0 contains the seed text, line 1 is empty, and the handwritten
    // word being adjusted sits on line 2.
    ws.applyNativeWriteStroke(line(40, LINE * 2 + 8, 90, LINE * 2 + 18), false);
    const before = ws.getNativeInkStrokes()[0].pts;
    ws.setActiveTool("insert");

    // The preceding blank row receives this whole word when subtraction reaches the left edge.
    ws.applyNativeStroke(line(100, LINE * 2 + 10, 0, LINE * 2 + 10));

    const after = ws.getNativeInkStrokes()[0].pts;
    before.forEach((point, i) => {
      expect(after[i].x - point.x).toBeCloseTo(222);
      expect(after[i].y).toBeCloseTo(point.y - LINE);
    });
  });

  it("a backward caret leaves a forward continuation below a later correction", () => {
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta eta theta");
    const word = (text: string) =>
      [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].find(
        (candidate) => candidate.textContent === text
      )!;
    ws.setActiveTool("insert");
    // Free the end of line 0 while leaving theta as the line-1 continuation.
    ws.applyNativeStroke(line(310, 12, 200, 12));
    expect(Number.parseFloat(word("theta").style.top)).toBe(LINE);

    // A correction written later on line 0 must remain still, and theta is
    // ahead of the backward caret so it remains on its current row.
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(150, 8, 170, 18), false);
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(250, 12, 300, 12));
    expect(Number.parseFloat(word("theta").style.top)).toBe(LINE);
    ws.applyNativeStroke(line(300, 12, 258, 12));

    expect(Number.parseFloat(word("theta").style.top)).toBe(LINE);
  });

  it("blank-lines pointer tap leaves the page unchanged", () => {
    const ws = makeWorkspace("Like this text");
    ws.setActiveTool("lines");
    const el = ws.containerElement;

    el.dispatchEvent(pointer("pointerdown", 10, 4));
    el.dispatchEvent(pointer("pointerup", 10, 4, { buttons: 0 }));

    const spacer = ws.reflowDoc.inserts.find((insert) => insert.kind === "line");
    expect(spacer).toBeUndefined();
    const word = el.querySelector<HTMLElement>(".rw-word")!;
    expect(Number.parseFloat(word.style.top)).toBe(0);
  });

  it("insert-space reflows downstream text and handwriting onto following ruled lines", () => {
    const ws = makeWorkspace("Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu");
    const el = ws.containerElement;

    // Put one handwritten run on the target lane and another on the lane
    // below. Starting the insert gesture packs them before applying its
    // lane-local horizontal shift.
    ws.applyNativeWriteStroke(line(210, LINE + 8, 250, LINE + 18), false);
    ws.applyNativeWriteStroke(line(210, 2 * LINE + 8, 250, 2 * LINE + 18), false);
    ws.setActiveTool("insert");

    el.dispatchEvent(pointer("pointerdown", 100, LINE + 12));
    const wordsBefore = [...el.querySelectorAll<HTMLElement>(".rw-word")].map((node) => ({
      text: node.textContent,
      left: Number.parseFloat(node.style.left),
      top: Number.parseFloat(node.style.top),
    }));
    const inkBefore = ws.getNativeInkStrokes().map((stroke) => ({
      x: stroke.pts[0].x,
      y: stroke.pts[0].y,
    }));

    el.dispatchEvent(pointer("pointermove", 260, LINE + 12));
    el.dispatchEvent(pointer("pointerup", 260, LINE + 12, { buttons: 0 }));

    const wordsAfter = [...el.querySelectorAll<HTMLElement>(".rw-word")].map((node) => ({
      text: node.textContent,
      left: Number.parseFloat(node.style.left),
      top: Number.parseFloat(node.style.top),
    }));
    const inkAfter = ws.getNativeInkStrokes().map((stroke) => ({
      x: stroke.pts[0].x,
      y: stroke.pts[0].y,
    }));

    for (let index = 0; index < wordsBefore.length; index++) {
      const before = wordsBefore[index];
      const after = wordsAfter[index];
      const beforeLine = before.top / LINE;
      const affected = beforeLine > 1 || (beforeLine === 1 && before.left + 8 * (before.text?.length ?? 0) > 100);
      const beforeLinear = beforeLine * 316 + before.left;
      const afterLinear = (after.top / LINE) * 316 + after.left;
      expect(afterLinear - beforeLinear).toBeGreaterThanOrEqual(0);
      if (!affected) expect(afterLinear).toBe(beforeLinear);
      expect(after.left + 8 * (after.text?.length ?? 0)).toBeLessThanOrEqual(316);
    }
    for (let index = 0; index < inkBefore.length; index++) {
      const before = inkBefore[index];
      const after = inkAfter[index];
      const beforeLinear = Math.floor(before.y / LINE) * 316 + before.x;
      const afterLinear = Math.floor(after.y / LINE) * 316 + after.x;
      expect(afterLinear - beforeLinear).toBeGreaterThanOrEqual(0);
      expect(after.x).toBeLessThanOrEqual(316);
    }
    expect(
      wordsAfter.some((after, index) => {
        const before = wordsBefore[index];
        return (after.top / LINE) * 316 + after.left - ((before.top / LINE) * 316 + before.left) >= 160;
      }) ||
        inkAfter.some((after, index) => {
          const before = inkBefore[index];
          return Math.floor(after.y / LINE) * 316 + after.x - (Math.floor(before.y / LINE) * 316 + before.x) >= 160;
        })
    ).toBe(true);
  });

  it("insert-space consumes existing whitespace before pushing later ink", () => {
    const ws = makeWorkspace();
    ws.applyNativeWriteStroke(line(40, LINE + 8, 60, LINE + 18), false);
    ws.applyNativeWriteStroke(line(100, LINE + 8, 120, LINE + 18), false);
    ws.applyNativeWriteStroke(line(240, LINE + 8, 260, LINE + 18), false);
    const before = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(30, LINE + 10, 80, LINE + 10));

    const after = ws.getNativeInkStrokes().map((stroke) => stroke.pts[0]);
    expect(after[0].x - before[0].x).toBeGreaterThanOrEqual(50);
    expect(after[0].x - before[0].x).toBeLessThan(60);
    expect(after[1].x - before[1].x).toBeCloseTo(35.6);
    expect(after[2].x).toBeCloseTo(before[2].x);
    expect(after[2].y).toBeCloseTo(before[2].y, 0);
  });

  it("insert-space leaves the line below untouched until active-line ink wraps", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(10, 4, 10, 4 + LINE));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(100, 8, 125, 18), false);
    const wordsBefore = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map((node) => ({
      left: node.style.left,
      top: node.style.top,
    }));

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(90, 12, 140, 12));

    const wordsAfter = [...ws.containerElement.querySelectorAll<HTMLElement>(".rw-word")].map((node) => ({
      left: node.style.left,
      top: node.style.top,
    }));
    expect(wordsAfter).toEqual(wordsBefore);
    const ink = ws.getNativeInkStrokes()[0].pts;
    expect(Math.floor(ink[0].y / LINE)).toBe(0);
  });

  it("wrapped handwriting pushes typed text on the destination line with minimum spacing", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.setActiveTool("lines");
    ws.applyNativeStroke(line(10, 4, 10, 4 + LINE));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(270, 8, 300, 18), false);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(260, 12, 340, 12));

    const ink = ws.getNativeInkStrokes()[0].pts;
    expect(Math.floor(ink[0].y / LINE)).toBe(1);
    const inkRight = Math.max(...ink.map((point) => point.x));
    const firstWord = ws.containerElement.querySelector<HTMLElement>(".rw-word")!;
    expect(Number.parseFloat(firstWord.style.top)).toBe(LINE);
    expect(Number.parseFloat(firstWord.style.left)).toBeGreaterThanOrEqual(inkRight + 8);
  });

  it("native write ingestion updates the model without invalidating the DOM", () => {
    const block = parseMarkdown("Alpha beta gamma")[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    let layoutChanges = 0;
    const ws = new PenWorkspace(host, {
      block,
      existingRuns: [],
      prefs: DEFAULT_PREFERENCES,
      eink: true,
      native: true,
      onLayoutChanged: () => layoutChanges++,
      onCommit: () => {},
      onCancel: () => {},
    });
    const before = layoutChanges;

    ws.applyNativeWriteStroke(line(40, LINE + 6, 120, LINE + 20), false);

    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    expect(layoutChanges).toBe(before);
  });

  it("switching tools does not reapply an existing insertion gap to newly written ink", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(100, 10, 220, 10));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(150, LINE + 8, 220, LINE + 18), false);
    const before = ws.getNativeInkStrokes()[0].pts.map((point) => ({ x: point.x, y: point.y }));

    ws.setActiveTool("erase");

    const after = ws.getNativeInkStrokes()[0].pts;
    expect(after).toHaveLength(before.length);
    after.forEach((point, index) => {
      expect(point.x).toBeCloseTo(before[index].x, 4);
      expect(point.y).toBeCloseTo(before[index].y, 4);
    });
  });

  it("keeps handwriting inside an already-open same-line gap at the pen coordinates", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(110, 12, 230, 12));
    ws.setActiveTool("write");

    const first = line(135, 8, 155, 20);
    const second = line(162, 8, 182, 20);
    ws.applyNativeWriteStroke(first, false);
    ws.applyNativeWriteStroke(second, false);

    const ink = ws.getNativeInkStrokes();
    expect(ink).toHaveLength(2);
    ink[0].pts.forEach((point, index) => {
      expect(point.x).toBeCloseTo(first[index].x, 4);
      expect(point.y).toBeCloseTo(first[index].y, 4);
    });
    ink[1].pts.forEach((point, index) => {
      expect(point.x).toBeCloseTo(second[index].x, 4);
      expect(point.y).toBeCloseTo(second[index].y, 4);
    });
    expect(ws.reflowDoc.inserts.filter((ins) => ins.kind === "ink")).toHaveLength(1);

    ws.setActiveTool("erase");
    const afterSwitch = ws.getNativeInkStrokes();
    afterSwitch.forEach((stroke, strokeIndex) => {
      stroke.pts.forEach((point, pointIndex) => {
        expect(point.x).toBeCloseTo(ink[strokeIndex].pts[pointIndex].x, 4);
        expect(point.y).toBeCloseTo(ink[strokeIndex].pts[pointIndex].y, 4);
      });
    });
  });

  it("applies several same-line insertion gestures in creation order", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(150, 12, 270, 12));
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(165, 8, 180, 20), false);
    ws.applyNativeWriteStroke(line(215, 8, 230, 20), false);
    ws.applyNativeWriteStroke(line(255, 8, 270, 20), false);

    ws.setActiveTool("insert");
    ws.applyNativeStroke(line(235, 12, 265, 12));
    ws.applyNativeStroke(line(200, 12, 300, 12));
    ws.applyNativeStroke(line(158, 12, 198, 12));

    const ink = ws.getNativeInkStrokes();
    expect(ink).toHaveLength(3);
    // Source words and ink now form the same translated suffix, including
    // whole-word wrapping when several operations exhaust the current row.
    for (const stroke of ink) for (const point of stroke.pts) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(324);
    }
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(ink);
  });

  it("select and erase use pointer events when the daemon is disabled", () => {
    const ws = makeWorkspace(undefined,undefined,[],[],false);
    ws.applyNativeStroke(line(40, LINE + 6, 120, LINE + 20));
    const run = ws.getNativeInkStrokes()[0];
    const pt = run.pts[Math.floor(run.pts.length / 2)];
    const el = ws.containerElement;

    ws.setActiveTool("select");
    el.dispatchEvent(pointer("pointerdown", pt.x, pt.y));
    el.dispatchEvent(pointer("pointerup", pt.x, pt.y, { buttons: 0 }));
    expect(ws.selectedId).not.toBeNull();

    ws.setActiveTool("erase");
    el.dispatchEvent(pointer("pointerdown", pt.x, pt.y));
    el.dispatchEvent(pointer("pointerup", pt.x, pt.y, { buttons: 0 }));
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
  });

  it("select preview follows the pen and snaps only the baseline on release", () => {
    // Existing/spacing-materialized ink is packed into flow rather than
    // carrying freeX/freeY. This is the state that previously mapped every
    // move sample back to a text slot and jumped to x=0 on ink-only pages.
    const packed = legacyInkRun("packed-word", [inkStroke("packed-stroke", 4, 8, 34, 24)]);
    const ws = makeWorkspace("Alpha beta", () => {}, [packed],[],false);
    const el = ws.containerElement;
    ws.setActiveTool("select");

    const run = ws.getNativeInkStrokes()[0];
    const grab = run.pts[Math.floor(run.pts.length / 2)];
    const before = el.querySelector<SVGElement>(".rw-ink")!;
    const beforeX = Number.parseFloat(before.style.left);
    const beforeY = Number.parseFloat(before.style.top);

    el.dispatchEvent(pointer("pointerdown", grab.x, grab.y));
    el.dispatchEvent(pointer("pointermove", grab.x + 73, grab.y + 61));

    const preview = el.querySelector<SVGElement>(".rw-ink.selected")!;
    expect(Number.parseFloat(preview.style.left) - beforeX).toBeCloseTo(73, 3);
    expect(Number.parseFloat(preview.style.top) - beforeY).toBeCloseTo(61, 3);
    // The high-rate preview is DOM-only; model/reflow commits once on pen-up.
    expect(ws.reflowDoc.inserts.find((ins) => ins.id === "packed-word")?.freeX).toBeUndefined();

    el.dispatchEvent(pointer("pointerup", grab.x + 73, grab.y + 61, { buttons: 0 }));
    const moved = ws.reflowDoc.inserts.find((ins) => ins.id === "packed-word")!;
    expect(moved.freeX).toBeCloseTo(beforeX + 73, 3);
    expect(moved.freeX).toBeGreaterThan(0);
    expect(((moved.freeY ?? 0) + (moved.baselineOffset ?? 0)) % LINE).toBeCloseTo(0, 3);
  });

  it("write tool stays daemon-only in native mode (pointer ignored)", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("write");
    const el = ws.containerElement;
    el.dispatchEvent(pointer("pointerdown", 40, 50));
    el.dispatchEvent(pointer("pointermove", 90, 55));
    el.dispatchEvent(pointer("pointerup", 90, 55, { buttons: 0 }));
    expect(ws.reflowDoc.inserts.filter((i) => i.kind === "ink").length).toBe(0);
  });

  it("magnify target drag does not also run the selected blank-lines tool", () => {
    const ws = makeWorkspace();
    ws.setActiveTool("write");
    ws.applyNativeWriteStroke(line(40, 3 * LINE + 6, 120, 3 * LINE + 20), false);
    const beforeInk = ws.getNativeInkStrokes().map((stroke) =>
      stroke.pts.map((point) => ({ x: point.x, y: point.y }))
    );

    ws.setActiveTool("lines");
    ws.toggleMagnify();
    const el = ws.containerElement;
    const root = el.closest(".pen-workspace")!;
    expect(root.querySelector(".magnify-context-badge")?.textContent).toBe(
      "Write below"
    );
    el.dispatchEvent(pointer("pointerdown", 80, LINE));
    el.dispatchEvent(pointer("pointermove", 180, 4 * LINE));
    el.dispatchEvent(pointer("pointerup", 180, 4 * LINE, { buttons: 0 }));

    expect(ws.reflowDoc.inserts.filter((insert) => insert.kind === "line")).toHaveLength(0);
    expect(ws.getNativeInkStrokes().map((stroke) =>
      stroke.pts.map((point) => ({ x: point.x, y: point.y }))
    )).toEqual(beforeInk);
    expect((el.querySelector(".magnify-target") as HTMLElement).style.left).not.toBe("");
    expect(root.querySelector(".magnify-context-badge")?.textContent).toBe(
      "Tap below to write"
    );
    root.querySelector(".magnify-canvas")?.dispatchEvent(pointer("pointerdown", 20, 20));
    expect(root.querySelector(".magnify-context-badge")?.textContent).toBe(
      "Write below"
    );
    ws.destroy();
  });

  it("keeps the complete magnifier target inside the visible document area", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 674 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 896 });
    const ws = makeWorkspace();
    const el = ws.containerElement;
    Object.defineProperties(el, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 6 * LINE },
    });
    ws.toggleMagnify();

    const dragTo = (x: number, y: number) => {
      el.dispatchEvent(pointer("pointerdown", 160, 3 * LINE));
      el.dispatchEvent(pointer("pointermove", x, y));
      el.dispatchEvent(pointer("pointerup", x, y, { buttons: 0 }));
    };
    const box = el.querySelector(".magnify-target") as HTMLElement;
    dragTo(-500, -500);
    expect(Number.parseFloat(box.style.left)).toBeGreaterThanOrEqual(0);
    // Device geometry puts the first ruled baseline four pixels above the inverse pad
    // viewport. That tiny overlap fits in the workspace padding and must not skip line one.
    expect(Number.parseFloat(box.style.top)).toBeGreaterThanOrEqual(-LINE / 4);
    expect(Number.parseFloat(box.style.top)).toBeLessThan(LINE / 2);

    dragTo(2000, 2000);
    expect(Number.parseFloat(box.style.left) + Number.parseFloat(box.style.width)).toBeLessThanOrEqual(320);
    expect(Number.parseFloat(box.style.top) + Number.parseFloat(box.style.height)).toBeLessThanOrEqual(6 * LINE);
    ws.destroy();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });

  it("keeps only the reduced backward overlap in the magnifier target box", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 674 });
    const ws = makeWorkspace("Alpha beta gamma");
    ws.toggleMagnify();

    const box = ws.containerElement.querySelector<HTMLElement>(".magnify-target")!;
    const label = box.querySelector<HTMLElement>("span")!;
    const boxWidth = Number.parseFloat(box.style.width);
    const backwardOverlap = Number.parseFloat(label.style.left) - 4;
    expect(backwardOverlap).toBeCloseTo(boxWidth * 0.21, 0);

    ws.destroy();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  });
});

describe("typed text insertion", () => {
  it("adds text without replacing handwriting and supports undo", () => {
    const ws = makeWorkspace("Alpha beta");
    ws.applyNativeStroke(line(30, 50, 70, 65));
    const point = ws.getNativeInkStrokes()[0].pts[0];
    ws.setActiveTool("select");
    ws.applyNativeStroke([{ x: point.x + 2, y: point.y + 2, t: 0, pressure: 0.5 }]);
    expect(ws.selectedId).not.toBeNull();
    const before = ws.reflowDoc;
    const host = ws.containerElement.parentElement!;
    host.querySelector<HTMLButtonElement>('[data-action="insert-text"]')!.click();
    expect(host.querySelector('.rw-text-box')).not.toBeNull();
    expect(ws.currentTool).toBe("select");
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
    input.value = "A typed section";
    input.dispatchEvent(new Event("input"));
    host.querySelector<HTMLButtonElement>('.rw-text-box-done')!.click();
    expect(ws.reflowDoc.textBoxes?.[0].text).toBe("A typed section");
    expect(ws.reflowDoc.words).toEqual(before.words);
    expect(ws.reflowDoc.inserts.filter(insert => insert.kind === "ink")).toHaveLength(before.inserts.filter(insert => insert.kind === "ink").length);
    host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.reflowDoc.words).toEqual(before.words);
    expect(ws.reflowDoc.inserts).toEqual(before.inserts);
    expect(ws.reflowDoc.textBoxes?.[0].text).toBe("");
    host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.reflowDoc.textBoxes).toEqual([]);
    ws.destroy();
    host.remove();
  });
});

describe('on-page text box wrapping', () => {
  it('recovers a saved cross-row word group without moving either row of ink', () => {
    const upper = inkStroke('upper', 4, 4, 70, 28);
    const lower = inkStroke('lower', 4, 48, 60, 72);
    const run: InlineInkRun = { id: 'legacy-linked', blockId: '', anchorOffset: 0,
      contextBefore: '', contextAfter: '', strokes: [upper, lower], intrinsicWidth: 74,
      intrinsicHeight: 80, baselineOffset: 30, layoutX: 40, layoutY: 14, scale: 1, createdAt: 0, updatedAt: 0 };
    const ws = makeWorkspace('\u200b', () => {}, [run]);
    expect(ws.reflowDoc.inserts.filter(i => i.kind === 'ink')).toHaveLength(2);
    expect(ws.getNativeInkStrokes().map(s => s.pts.map(p => [p.x, p.y]))).toEqual(
      [upper, lower].map(s => s.points.map(p => [p.x + 40, p.y + 14])));
    ws.destroy();
  });
  it('fits the input width to text and initially places its draft below free handwriting', () => {
    const ws = makeWorkspace('\u200b');
    ws.applyNativeWriteStroke(line(40, LINE * 5 + 10, 90, LINE * 5 + 30), false);
    const before = ws.getNativeInkStrokes();
    const host = ws.containerElement.parentElement!;
    host.querySelector<HTMLButtonElement>('[data-action="insert-text"]')!.click();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
    const node = input.closest<HTMLElement>('.rw-text-box')!;
    expect(parseFloat(node.style.width)).toBe(64);
    expect(parseFloat(node.style.top)).toBeGreaterThan(Math.max(...before.flatMap(s => s.pts.map(p => p.y))));
    input.value = 'Hello there'; input.dispatchEvent(new Event('input'));
    expect(parseFloat(node.style.width)).toBe(96);
    input.value = 'Hi'; input.dispatchEvent(new Event('input'));
    expect(parseFloat(node.style.width)).toBe(64);
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.destroy(); host.remove();
  });
  it('inserts dropped text between ink words and preserves spacing through save and reopen', () => {
    const commit = vi.fn();
    const ws = makeWorkspace('\u200b', commit);
    ws.applyNativeWriteStroke(line(15, LINE + 10, 40, LINE + 25), false);
    ws.applyNativeWriteStroke(line(90, LINE + 10, 150, LINE + 25), false);
    const before = ws.getNativeInkStrokes();
    const state = ws as any;
    state.doc = { ...state.doc, textBoxes: [{ id: 'typed', blockId: '', text: 'Hello', x: 65, y: LINE, width: 64, size: 19 }] };
    state.relayout();
    const typed = state.layout.placed.find((p: any) => p.textBoxId === 'typed');
    const after = ws.getNativeInkStrokes();
    expect(after[0]).toEqual(before[0]);
    expect(Math.min(...after[1].pts.map(p => p.x))).toBeGreaterThan(typed.x + typed.width);
    expect(after[1].pts.map(p => p.y)).toEqual(before[1].pts.map(p => p.y));
    ws.finish();
    const payload = commit.mock.calls[0][0] as CommitPayload;
    const restored = makeWorkspace('\u200b', () => {}, payload.newRuns, payload.textBoxes);
    expect(restored.getNativeInkStrokes()).toEqual(after);
    expect(restored.containerElement.querySelector<HTMLElement>('[data-text-box-word="typed"]')!.style.left).toBe(`${typed.x}px`);
    ws.destroy(); restored.destroy();
  });
  it('lets a new text box insert between an older box’s words rather than being pushed aside', () => {
    const oldBox = { id: 'old', blockId: '', text: 'Project plan', x: 100, y: LINE, width: 200, size: 19 };
    const ws = makeWorkspace('\u200b', () => {}, [], [oldBox,
      { id: 'new', blockId: '', text: 'Hello', x: 160, y: LINE, width: 64, size: 19 }]);
    const items = (ws as any).layout.placed.filter((p: any) => p.textBoxId);
    const project = items.find((p: any) => p.text === 'Project');
    const plan = items.find((p: any) => p.text === 'plan');
    const hello = items.find((p: any) => p.text === 'Hello');
    expect(project.x).toBe(100);
    expect(hello.x).toBeGreaterThanOrEqual(project.x + project.width);
    expect(plan.x).toBeGreaterThan(hello.x + hello.width);
    ws.destroy();
  });
  it('starts at one ruled lane and grows only for wrapping or explicit newlines', () => {
    const ws = makeWorkspace('Alpha beta');
    const host = ws.containerElement.parentElement!;
    host.querySelector<HTMLButtonElement>('[data-action="insert-text"]')!.click();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
    expect(input.rows).toBe(1);
    const lane = ws.magnifyLineHeight();
    expect(input.closest<HTMLElement>('.rw-text-box')!.style.height).toBe(`${lane}px`);
    input.value = 'Short'; input.dispatchEvent(new Event('input'));
    expect(input.rows).toBe(1);
    input.value = 'Short\n'; input.dispatchEvent(new Event('input'));
    expect(input.rows).toBe(2);
    input.value = Array(60).fill('word').join(' '); input.dispatchEvent(new Event('input'));
    expect(input.rows).toBeGreaterThan(2);
    expect(ws.magnifyLineHeight()).toBe(lane);
    ws.destroy(); host.remove();
  });
});

describe('text input prompt', () => {
  it('cancels a new draft without leaving a text box or disabling the page', () => {
    const ws = makeWorkspace('Alpha beta');
    const host = ws.containerElement.parentElement!;
    host.querySelector<HTMLButtonElement>('[data-action="insert-text"]')!.click();
    const prompt = host.querySelector('[role="group"][aria-label="Insert text"]')!;
    expect(prompt.closest('.rw-text-box')).not.toBeNull();
    const input = prompt.querySelector('textarea')!;
    input.value = 'Discard this'; input.dispatchEvent(new Event('input'));
    Array.from(prompt.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!.click();
    expect(ws.reflowDoc.textBoxes).toEqual([]);
    expect(host.querySelector('.rw-text-editor')).toBeNull();
    expect(ws.containerElement.inert).not.toBe(true);
    ws.destroy(); host.remove();
  });

  it('pen release inserts once and suppresses the following compatibility click', () => {
    const ws = makeWorkspace('Alpha beta');
    const host = ws.containerElement.parentElement!;
    host.querySelector<HTMLButtonElement>('[data-action="insert-text"]')!.click();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
    input.value = 'Pen input'; input.dispatchEvent(new Event('input'));
    const done = host.querySelector<HTMLButtonElement>('.rw-text-box-done')!;
    done.dispatchEvent(pointerEvent('pointerdown', 41, 100, 100));
    done.dispatchEvent(pointerEvent('pointerup', 41, 100, 100));
    done.click();
    expect(host.querySelector('.rw-text-editor')).toBeNull();
    expect(ws.reflowDoc.textBoxes?.[0].text).toBe('Pen input');
    host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.reflowDoc.textBoxes?.[0].text).toBe('');
    ws.destroy(); host.remove();
  });

  it('Escape restores existing text and word positions after editing', () => {
    const original = { id: 'prompt-box', blockId: 'b', text: 'Saved text', x: 20, y: 56, width: 240, size: 19,
      words: [{text:'Saved',x:20,y:56},{text:'text',x:90,y:56}] };
    const ws = makeWorkspace('Alpha beta', undefined, [], [original]);
    ws.setActiveTool('select');
    const host = ws.containerElement.parentElement!;
    Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Edit text')!.click();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
    input.value = 'Changed'; input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    expect(ws.reflowDoc.textBoxes?.[0].text).toBe(original.text);
    expect(ws.reflowDoc.textBoxes?.[0].words).toEqual(original.words);
    ws.destroy(); host.remove();
  });
});

describe("small shelf thumbnail rules", () => {
  it("paints every visible rule as solid integer pixel rows before scaling ink", () => {
    const ws = makeWorkspace("\u200b");
    Object.defineProperties(ws.containerElement, { clientWidth: { value: 600 }, clientHeight: { value: 840 } });
    const rectangles: number[][] = [];
    const context = { font: "", fillStyle: "", measureText: () => ({ width: 0 }),
      fillRect: (...args: number[]) => rectangles.push(args), save: () => {}, restore: () => {},
      translate: () => {}, scale: () => {}, fillText: () => {} };
    const ctx = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const png = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,test");
    expect(ws.renderThumbnailDataUrl()).toContain("data:image/png");
    const rules = rectangles.slice(1);
    expect(rules).toHaveLength(19);
    expect(rules.every(([, y, , height]) => Number.isInteger(y) && height === 2)).toBe(true);
    png.mockRestore();
    ctx.mockRestore();
    ws.destroy();
    ws.containerElement.parentElement?.remove();
  });
});

describe('text annotation keyboard lifecycle', () => {
  it('retains the focused textarea through keyboard-driven relayout and checkpoints live text', () => {
    const commit = vi.fn();
    const ws = makeWorkspace('Alpha beta', commit);
    const host = ws.containerElement.parentElement!;
    host.querySelector<HTMLButtonElement>('[data-action="insert-text"]')!.click();
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Text box content"]')!;
    input.value = 'Keyboard draft';
    input.dispatchEvent(new Event('input'));
    input.focus();
    (ws as unknown as { relayout(): void }).relayout();
    expect(document.activeElement).toBe(input);
    expect(input.isConnected).toBe(true);
    ws.finish();
    expect(commit.mock.calls[0][0].textBoxes[0].text).toBe('Keyboard draft');
    ws.destroy(); host.remove();
  });
});

describe('ruled text box spacing', () => {
  const box = { id: 'typed', blockId: '', text: 'Plan now', x: 30, y: LINE, width: 180, size: 19 };
  const words = (ws: PenWorkspace) => [...ws.containerElement.querySelectorAll<HTMLElement>('[data-text-box-word="typed"]')].map(n => ({text:n.textContent, x:parseFloat(n.style.left), y:parseFloat(n.style.top)}));
  it('moves boxed words and handwriting down together, then restores both when space is closed', () => {
    const ws = makeWorkspace('\u200b', () => {}, [], [box]);
    ws.placeMagnifiedGroup([inkStroke('same-row', 160, LINE + 8, 180, LINE + 18)], 1);
    const before = words(ws);
    const inkBefore = ws.getNativeInkStrokes()[0].pts[0].y;
    ws.setActiveTool('lines');
    ws.applyNativeStroke(line(8, LINE, 8, LINE * 2));
    expect(words(ws).map(w => w.y)).toEqual(before.map(w => w.y + LINE));
    expect(ws.getNativeInkStrokes()[0].pts[0].y - inkBefore).toBeCloseTo(LINE, 0);
    ws.applyNativeStroke(line(8, LINE * 2, 8, LINE));
    expect(words(ws)).toEqual(before);
    expect(ws.getNativeInkStrokes()[0].pts[0].y).toBeCloseTo(inkBefore, 0);
    ws.destroy();
  });
  it('opens space between boxed words and shifts ink on the same lane without moving earlier text', () => {
    const ws = makeWorkspace('\u200b', () => {}, [], [box]);
    ws.placeMagnifiedGroup([inkStroke('same-row', 110, LINE + 8, 130, LINE + 18)], 1);
    const before = words(ws);
    const inkBefore = ws.getNativeInkStrokes()[0].pts[0].x;
    ws.setActiveTool('insert');
    ws.applyNativeStroke(line(65, LINE + 12, 105, LINE + 12));
    const after = words(ws);
    expect(after[0]).toEqual(before[0]);
    expect(after[1].x - before[1].x).toBeGreaterThanOrEqual(40);
    expect(ws.getNativeInkStrokes()[0].pts[0].x - inkBefore).toBeGreaterThanOrEqual(40);
    ws.destroy();
  });
  it('saves final individual word placements and restores spacing without replaying transient spacers', () => {
    const commit = vi.fn();
    const ws = makeWorkspace('\u200b', commit, [], [box]);
    ws.setActiveTool('insert');
    ws.applyNativeStroke(line(65, LINE + 12, 105, LINE + 12));
    ws.setActiveTool('lines');
    ws.applyNativeStroke(line(8, LINE, 8, LINE * 2));
    const before = words(ws);
    ws.finish();
    const payload = commit.mock.calls[0][0] as CommitPayload;
    const restored = makeWorkspace('\u200b', () => {}, payload.newRuns, payload.textBoxes);
    expect(words(restored)).toEqual(before);
    expect(restored.reflowDoc.inserts.some(i => i.kind === 'gap' || i.kind === 'line')).toBe(false);
    ws.destroy(); restored.destroy();
  });
  it('preserves typed words above an upward spacer', () => {
    const ws = makeWorkspace('\u200b', () => {}, [], [box]);
    const before = words(ws);
    ws.setActiveTool('lines');
    ws.applyNativeStroke(line(8, LINE * 2, 8, LINE));
    expect(words(ws)).toEqual(before);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(words(ws)).toEqual(before);
    ws.destroy();
  });
});

describe('eraser gesture undo', () => {
  it('keeps surviving ink in the same page position when a lasso removes its neighbour', () => {
    const ws = makeWorkspace('\u200b');
    ws.applyNativeStroke(line(40, 60, 120, 60));
    const state = ws as any;
    const insert = state.doc.inserts.find((i: any) => i.kind === 'ink');
    insert.strokes.push({...insert.strokes[0], points:insert.strokes[0].points.map((p:any)=>({...p,x:p.x+150,y:p.y+50}))});
    state.relayout();
    const before = ws.getNativeInkStrokes();
    const first = before[0].pts;
    const x = Math.min(...first.map(p=>p.x)), y = Math.min(...first.map(p=>p.y));
    ws.setEraserMode('lasso');
    ws.applyNativeStroke([{x:x-8,y:y-8,t:0,pressure:.5},{x:x+100,y:y-8,t:1,pressure:.5},{x:x+100,y:y+15,t:2,pressure:.5},{x:x-8,y:y+15,t:3,pressure:.5}]);
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    expect(ws.getNativeInkStrokes()[0].pts).toEqual(before[1].pts);
    ws.destroy();
  });

  it('erases a crossing stroke with a lasso and restores it with one undo', () => {
    const ws = makeWorkspace('\u200b');
    ws.applyNativeStroke(line(40, 60, 120, 60));
    const before = ws.getNativeInkStrokes();
    const pts = before.flatMap(s=>s.pts);
    const x = Math.min(...pts.map(p=>p.x)), y = Math.min(...pts.map(p=>p.y));
    ws.setEraserMode('lasso');
    ws.applyNativeStroke([{x:x-8,y:y-8,t:0,pressure:.5},{x:x+100,y:y-8,t:1,pressure:.5},{x:x+100,y:y+15,t:2,pressure:.5},{x:x-8,y:y+15,t:3,pressure:.5}]);
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.destroy();
  });
  it('covers sparse swipe samples without losing the undo snapshot', () => {
    const ws = makeWorkspace('\u200b');
    ws.applyNativeStroke(line(40, 60, 120, 60));
    const before = ws.getNativeInkStrokes(), p = before[0].pts[0];
    ws.setActiveTool('erase');
    ws.applyNativeStroke(line(p.x-50,p.y,p.x+180,p.y,2));
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.destroy();
  });
});

describe('saved Planning lanes across screens', () => {
  it.each([undefined,44])('preserves separate saved lines with a 56px screen default (%s)', savedLane => {
    const host=document.createElement('div');document.body.append(host);
    const ws=new PenWorkspace(host,{block:parseMarkdown('Alpha beta gamma')[0],existingRuns:[],
      existingSourceWords:[{text:'Alpha',x:0,y:264},{text:'beta',x:0,y:308},{text:'gamma',x:0,y:352}],
      existingLineHeight:savedLane,prefs:{...DEFAULT_PREFERENCES,lineHeight:56},eink:true,native:true,onCommit:()=>{},onCancel:()=>{}});
    expect(ws.magnifyLineHeight()).toBe(44);
    const placed=(ws as any).layout.placed.filter((p:any)=>p.kind==='word');
    expect(placed.map((p:any)=>p.line)).toEqual([6,7,8]);
    ws.destroy();
  });
});

describe('scribble erase transactions', () => {
  const sweep = (x:number,y:number): InkPoint[] => Array.from({length:7},(_,i)=>({x:x+(i%2 ? 45 : -45),y:y-6+i*2,t:i*4,pressure:.5}));
  it.each([true,false])('scribbles an AI task word on its ruled position and Undo restores paired controls (render=%s)',render=>{
    const boxes:import('../sidecar/schema').TextBox[]=[
      {id:'ai-task',blockId:'planning-document',text:'Buy milk',x:16,y:0,width:240,size:27,semantic:{id:'task',type:'task',role:'text'}},
      {id:'ai-check',blockId:'planning-document',text:'☐',checkbox:true,x:280,y:0,width:36,size:27,semantic:{id:'task',type:'task',role:'checkbox'}}];
    const ws=makeWorkspace('\u200b',()=>{},[],boxes);
    const word=(ws as any).layout.placed.find((p:any)=>p.textBoxId==='ai-task'&&p.text==='milk');
    const y=(word.line+1)*LINE-2-(ws as any).textSize*.23-(ws as any).textSize/2;
    const points=sweep(word.x+word.width/2,y).map(p=>({...p,x:word.x+word.width/2+(p.x-word.x-word.width/2)*.3}));
    expect(ws.eraseScribble(points,false,render)).not.toBeNull();
    expect(ws.reflowDoc.textBoxes!.find(b=>b.id==='ai-task')!.text.trim()).toBe('Buy');
    expect(ws.reflowDoc.textBoxes!.some(b=>b.id==='ai-check')).toBe(true);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.reflowDoc.textBoxes!.find(b=>b.id==='ai-task')!.text).toBe('Buy milk');
    expect(ws.reflowDoc.textBoxes!.find(b=>b.id==='ai-check')!.text).toBe('☐');
    ws.destroy();
  });
  it('clears a Standard pen scrub on release without another stroke and restores only the word on Undo', () => {
    const ws=makeWorkspace('\u200b',()=>{},[],[],false);
    ws.applyNativeWriteStroke(line(80,50,80,80));
    const before=ws.getNativeInkStrokes(), p=before[0].pts[4];
    const points=sweep(p.x,p.y), el=ws.containerElement;
    el.dispatchEvent(pointerEvent('pointerdown',91,points[0].x,points[0].y));
    for(const point of points.slice(1)) el.dispatchEvent(pointerEvent('pointermove',91,point.x,point.y));
    expect((ws as any).liveCanvasBounds).not.toBeNull();
    const clearRect=vi.fn();
    vi.spyOn((ws as any).canvasEl,'getContext').mockReturnValue({setTransform:vi.fn(),clearRect});
    const end=points[points.length-1];
    el.dispatchEvent(pointerEvent('pointerup',91,end.x,end.y));
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
    expect(clearRect).toHaveBeenCalled();
    expect((ws as any).liveCanvasBounds).toBeNull();
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.destroy();
  });
  it('erases saved ink without DOM work in the native callback and restores it with one Undo', () => {
    const ws=makeWorkspace('\u200b');
    ws.applyNativeWriteStroke(line(80,50,80,80));
    ws.applyNativeWriteStroke(line(250,50,250,80));
    const before=ws.getNativeInkStrokes(), p=before[0].pts[Math.floor(before[0].pts.length/2)];
    const render=vi.spyOn(ws as any,'render');
    const result=ws.applyNativeWriteStroke(sweep(p.x,p.y),false);
    expect(result).not.toBeNull();
    expect(render).not.toHaveBeenCalled();
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    expect(ws.getNativeInkStrokes()[0].pts).toEqual(before[1].pts);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.destroy();
  });
  it.each([true, false])('erases an entire disconnected word but preserves nearby words/rows (render=%s)', render => {
    const letters = [80,98,116,134].map((x,i) => inkStroke(`letter-${i}`,x,50,x+10,80));
    const dot = inkStroke('delayed-dot',139,43,140,44);
    const cross = inkStroke('delayed-cross',130,60,149,60);
    const neighbour = inkStroke('other-word',240,50,250,80);
    const nextRow = inkStroke('other-row',80,130,90,160);
    const ws=makeWorkspace('\u200b',()=>{},[legacyInkRun('phrase',[...letters,dot,cross,neighbour,nextRow])]);
    const before=ws.getNativeInkStrokes();
    const p=before[0].pts[4];
    const narrow=sweep(p.x,p.y).map(point=>({...point,x:p.x+(point.x-p.x)*12/45}));
    const result=ws.eraseScribble(narrow,false,render)!;
    expect(result).not.toBeNull();
    // Recognition hit just the first letter, yet word grouping removes the whole word.
    expect(result.indices).toEqual([0]);
    expect(ws.getNativeInkStrokes().map(s=>s.pts)).toEqual(before.slice(6).map(s=>s.pts));
    for(const stroke of before.slice(0,6)) for(const point of stroke.pts) {
      expect(point.x).toBeGreaterThanOrEqual(result.rect.x);
      expect(point.x).toBeLessThanOrEqual(result.rect.x+result.rect.w);
      expect(point.y).toBeGreaterThanOrEqual(result.rect.y);
      expect(point.y).toBeLessThanOrEqual(result.rect.y+result.rect.h);
    }
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(ws.getNativeInkStrokes().map(s=>s.pts)).toEqual(before.slice(6).map(s=>s.pts));
    ws.destroy();
  });

  it('erases disconnected letters in a staged Zoom word, retaining a separate word and one Undo', () => {
    const ws=makeWorkspace('\u200b');
    const pending=[...([80,98,116,134].map((x,i)=>inkStroke(`zoom-letter-${i}`,x,50,x+10,80))),
      inkStroke('zoom-dot',139,43,140,44),inkStroke('zoom-neighbour',240,50,250,80)];
    let staged=pending;
    const p=pending[0].points[4];
    const narrow=sweep(p.x,p.y).map(point=>({...point,x:p.x+(point.x-p.x)*12/45}));
    expect(ws.magnifyScribble(narrow,pending,s=>{staged=s})).toBe(true);
    expect(staged).toEqual([]);
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    expect(ws.getNativeInkStrokes()[0].pts.map(p=>p.x)).toEqual(pending[5].points.map(p=>p.x));
    expect(ws.magnifyUndoScribble()).toBe(true);
    expect(ws.getNativeInkStrokes()).toHaveLength(6);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    ws.destroy();
  });

  it('keeps a neighbouring word when only the ends of two scrub passes graze it', () => {
    const ws=makeWorkspace('\u200b',()=>{},[legacyInkRun('phrase',[
      inkStroke('main-body',40,50,80,80),inkStroke('main-dot',70,43,71,44),
      inkStroke('neighbour',112,50,114,80)])]);
    const before=ws.getNativeInkStrokes();
    const p=before[0].pts[0];
    const dx=p.x-40,dy=p.y-50;
    const scribble=Array.from({length:7},(_,i)=>({x:i%2?100:20,y:62+i*2,t:i*4,pressure:.5}));
    scribble.push({x:116,y:75,t:28,pressure:.5},{x:20,y:76,t:32,pressure:.5},{x:116,y:77,t:36,pressure:.5});
    const result=ws.eraseScribble(scribble.map(p=>({...p,x:p.x+dx,y:p.y+dy})),false,false);
    expect(result).not.toBeNull();
    expect(ws.getNativeInkStrokes().map(s=>s.pts)).toEqual([before[2].pts]);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toEqual(before);
    ws.destroy();
  });

  it('restores staged Zoom ink and committed ink as one transaction, with redo', () => {
    const ws=makeWorkspace('\u200b');
    ws.applyNativeWriteStroke(line(80,50,80,80));
    const before=ws.getNativeInkStrokes(), p=before[0].pts[4];
    const pending:InkStroke[]=[{id:'pending-zoom',tool:'pen',color:'#000',width:3,points:line(p.x+10,p.y-10,p.x+10,p.y+10),bounds:boundsOfPoints([])}];
    let staged=pending;
    expect(ws.magnifyScribble(sweep(p.x,p.y),pending,s=>{staged=s})).toBe(true);
    expect(staged).toHaveLength(0);
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
    expect(ws.magnifyUndoScribble()).toBe(true);
    expect(staged).toHaveLength(0);
    expect(ws.getNativeInkStrokes()).toHaveLength(2);
    expect(ws.getNativeInkStrokes()[0]).toEqual(before[0]);
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
    expect(staged).toHaveLength(0);
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
    ws.destroy();
  });
});

describe('Zoom scribble routing', () => {
  it('recognizes in pad coordinates and Undo still restores ink after closing Zoom', () => {
    localStorage.removeItem('write2.magnify.draft');
    const ws=makeWorkspace('\u200b'); ws.toggleMagnify();
    const pad=(ws as any).magnifyPad;
    const geometry=pad.padGeometry();
    const x=geometry.focusX+50, y=geometry.baselineY;
    ws.applyNativeMagnifyStroke(line(x,y-25,x,y+25));
    const live=ws.getNativeMagnifyStrokes();
    expect(live).toHaveLength(1);
    ws.applyNativeMagnifyStroke(Array.from({length:7},(_,i)=>({x:x+(i%2?60:-60),y:y-12+i*4,t:i*4,pressure:.5})));
    expect(ws.getNativeMagnifyStrokes()).toHaveLength(0);
    expect(ws.getNativeInkStrokes()).toHaveLength(0);
    ws.toggleMagnify();
    ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
    expect(ws.getNativeInkStrokes()).toHaveLength(1);
    expect(ws.getNativeInkStrokes()[0].width).toBe(live[0].width);
    ws.destroy(); localStorage.removeItem('write2.magnify.draft');
  });
});


it('native lasso gestures select ink without saving the dashed gesture or accepting duplicate DOM pen input',()=>{
  const ws=makeWorkspace('\u200b');
  ws.applyNativeWriteStroke(line(40,20,70,40),false);
  ws.setActiveTool('select');
  const el=ws.containerElement;
  for(const type of ['pointerdown','pointerup']) {
    const event=new MouseEvent(type,{clientX:30,clientY:10,bubbles:true,buttons:type==='pointerdown'?1:0});
    Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'pen'},pressure:{value:.5}});
    el.dispatchEvent(event);
  }
  expect(ws.selectedId).toBeNull();
  ws.applyNativeStroke([{x:30,y:10},{x:90,y:10},{x:90,y:60},{x:30,y:60},{x:30,y:10}].map((p,i)=>({...p,t:i*10,pressure:.5})));
  expect(ws.selectedId).not.toBeNull();expect(ws.getNativeInkStrokes()).toHaveLength(1);
});

it('WebView lasso preview remains connected after selection overlay redraw',()=>{
  const ws=makeWorkspace('\u200b',undefined,[],[],false);
  ws.setActiveTool('select');
  function event(type:string,x:number,y:number) {
    const e=new MouseEvent(type,{clientX:x,clientY:y,bubbles:true,buttons:type==='pointerup'?0:1});
    Object.defineProperties(e,{pointerId:{value:7},pointerType:{value:'pen'},pressure:{value:.5}});return e;
  }
  ws.containerElement.dispatchEvent(event('pointerdown',30,10));
  const preview=ws.containerElement.querySelector('.rw-erase-lasso path');
  expect(preview?.isConnected).toBe(true);expect(preview?.getAttribute('stroke-dasharray')).toBe('6 10');
  ws.containerElement.dispatchEvent(event('pointermove',90,60));
  expect(ws.containerElement.querySelector('.rw-erase-lasso path')?.getAttribute('d')).toContain('90,60');
  expect(ws.containerElement.querySelector('.rw-erase-lasso path')?.getAttribute('d')).not.toMatch(/Z|C|Q/);
  ws.containerElement.dispatchEvent(event('pointerup',90,60));
  expect(ws.containerElement.querySelector('.rw-erase-lasso')).toBeNull();
});

it('native ink cancels a pending swipe; a fresh finger swipe needs no cooldown', () => {
  let now = 5000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const host = document.createElement('div'); document.body.append(host);
  const change = vi.fn();
  const ws = new PenWorkspace(host, {block:parseMarkdown('Text')[0],existingRuns:[],
    prefs:DEFAULT_PREFERENCES,eink:true,native:true,onCommit(){},onCancel(){},
    pageTools:{index:0,count:2,change}});
  const surface = ws.containerElement;
  surface.getBoundingClientRect = () => ({left:0,top:0,width:500,height:700,right:500,bottom:700,x:0,y:0,toJSON(){}});
  const pointer = (type:string, id:number, kind='touch', x=450, y=200) => {
    const e = new MouseEvent(type,{bubbles:true,clientX:x,clientY:y});
    Object.defineProperties(e,{pointerId:{value:id},pointerType:{value:kind},width:{value:10},height:{value:10}});
    surface.dispatchEvent(e);
  };
  try {
    pointer('pointerdown',1); ws.noteNativePenActivity(); pointer('pointerup',1,'touch',300);
    expect(change).not.toHaveBeenCalled();
    pointer('pointerdown',2); pointer('pointerup',2);
    expect(change).not.toHaveBeenCalled();
    now += 2000; pointer('pointerdown',3,'pen');
    now += 3000; pointer('pointerdown',4); pointer('pointerup',4,'touch',300);
    expect(change).not.toHaveBeenCalled();
    pointer('pointerup',3,'pen');
    pointer('pointerdown',5); pointer('pointerdown',6); pointer('pointerup',6); pointer('pointerup',5,'touch',300);
    pointer('pointerdown',7); pointer('pointermove',7,'touch',445,260); pointer('pointerup',7,'touch',300,265);
    expect(change).not.toHaveBeenCalled();
    pointer('pointerdown',8); pointer('pointerup',8,'touch',300);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith(1);
  } finally { ws.destroy(); host.remove(); clock.mockRestore(); }
});

// Zoom's visible diameter is in pad pixels, not document pixels. Regressing this map
// silently multiplies the eraser footprint and deletes neighbouring letter strokes.
describe('Zoom eraser controls',()=>{
  it('maps the visible radius to the document and defaults to individual strokes',()=>{
    localStorage.removeItem('write2.zoom.eraser');
    const ws=makeWorkspace('\u200b');ws.toggleMagnify();
    const pad=(ws as any).magnifyPad;
    const erase=vi.spyOn(ws,'magnifyEraseAt');
    pad.eraseAtPadPoint(pointerEvent("pointerdown",1,80,40),true);
    expect(erase).toHaveBeenCalled();
    expect(erase.mock.calls[0][2]).toBeCloseTo(10/pad.model.settings.magnification);
    expect(erase.mock.calls[0][3]).toBe('stroke');
    ws.destroy();
  });
  it('shares the toolbar diameter and pixel selection without a duplicate Zoom control',()=>{
    localStorage.removeItem('write2.zoom.eraser');
    const ws=makeWorkspace('\u200b');ws.toggleMagnify();
    const pad=(ws as any).magnifyPad;
    (ws as any).openEraserSettings(ws.containerElement.parentElement!.querySelector('[data-tool="erase"]'));
    const panel=ws.containerElement.parentElement!.querySelector('[aria-label="Eraser settings"]')!;
    (panel.querySelector('[aria-label="Increase eraser diameter"]') as HTMLButtonElement).click();
    expect(panel.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Eraser diameter: 22 pixels');
    (panel.querySelector('[aria-label="Pixel eraser"]') as HTMLButtonElement).click();
    expect(ws.magnifyEraserSettings().mode).toBe('pixel');
    expect(pad.eraserMode).toBe('pixel');
    expect(ws.containerElement.parentElement!.querySelector('[aria-label="Zoom eraser"]')).toBeNull();
    ws.destroy();localStorage.removeItem('write2.zoom.eraser');
  });
});


it('Zoom erasing lasso settles staged ink and preserves Undo after closing Zoom',()=>{
  const ws=makeWorkspace('\u200b');ws.toggleMagnify();
  const pad=(ws as any).magnifyPad;
  const geometry=pad.padGeometry();
  ws.applyNativeMagnifyStroke(line(geometry.focusX+20,geometry.baselineY-10,geometry.focusX+40,geometry.baselineY));
  expect(ws.getNativeMagnifyStrokes()).toHaveLength(1);
  const target=pad.model.target,m=pad.model.settings.magnification;
  const map=(p:InkPoint)=>({...p,x:target.x+(p.x-geometry.focusX)/m,y:(target.line+1)*ws.magnifyLineHeight()+(p.y-geometry.baselineY)/m});
  const strokes=pad.model.padStrokes.map((s:InkStroke)=>({...s,points:s.points.map(map)}));
  const polygon=[{x:geometry.focusX+10,y:geometry.baselineY-20},{x:geometry.focusX+50,y:geometry.baselineY-20},{x:geometry.focusX+50,y:geometry.baselineY+10},{x:geometry.focusX+10,y:geometry.baselineY+10}].map(p=>map({...p,t:0,pressure:.5}));
  ws.magnifyEraseLasso(polygon,strokes,target.line);pad.model.restorePadStrokes([]);
  expect(ws.getNativeInkStrokes()).toHaveLength(0);
  ws.toggleMagnify();
  ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
  expect(ws.getNativeInkStrokes()).toHaveLength(1);ws.destroy();
});

it('eraser hover shows a correctly sized transparent tip without editing ink',()=>{
  const ws=makeWorkspace('\u200b');ws.setActiveTool('erase');
  vi.spyOn(ws.containerElement,'getBoundingClientRect').mockReturnValue({left:0,top:0,right:300,bottom:500,width:300,height:500,x:0,y:0,toJSON(){return {};}});
  ws.containerElement.dispatchEvent(pointerEvent('pointermove',1,45,60));
  const tip=ws.containerElement.parentElement!.querySelector<HTMLElement>('.rw-eraser-tip')!;
  expect(tip.hidden).toBe(false);expect(tip.style.left).toBe('45px');expect(tip.style.top).toBe('60px');
  expect(tip.style.width).toBe(`${ws.magnifyEraserSettings().diameter}px`);
  expect(ws.getNativeInkStrokes()).toHaveLength(0);
  ws.setActiveTool('write');expect(tip.hidden).toBe(true);ws.destroy();
});


describe('host document handoff',()=>{
 it('keeps a separate AI action in the expanded rail and flushes pen input before invoking it',()=>{
  const host=document.createElement('div');document.body.append(host);
  const queued:Array<()=>void>=[],agora=vi.fn(),ai=vi.fn(),onPress=vi.fn(()=>true);
  const ws=new PenWorkspace(host,{block:parseMarkdown('Notes')[0],existingRuns:[],prefs:DEFAULT_PREFERENCES,eink:true,native:true,onCommit(){},onCancel(){},documentAction:{label:'Work with Agora',shortLabel:'Agora',run:agora},documentActions:[{label:'Format with AI',shortLabel:'AI',onPress,run:ai}],onBeforeNativeAction:action=>queued.push(action)});
  const buttons=host.querySelectorAll<HTMLButtonElement>('[data-action^="document-action"]');
  expect(buttons).toHaveLength(2);expect(buttons[1].dataset.label).toBe('AI');
  expect(buttons[1].getAttribute('aria-label')).toBe('Format with AI');expect(buttons[1].classList.contains('toolbar-more')).toBe(true);
  buttons[1].click();expect(onPress).toHaveBeenCalledOnce();expect(ai).not.toHaveBeenCalled();expect(agora).not.toHaveBeenCalled();
  onPress.mockReturnValue(false);buttons[1].click();expect(queued).toHaveLength(1);
  queued[0]();expect(ai).toHaveBeenCalledOnce();expect(agora).not.toHaveBeenCalled();ws.destroy();host.remove();
 });

 it('uses the writing toolbar exclusion and waits for the native pen flush before opening host UI',()=>{
  const host=document.createElement('div');document.body.append(host);
  const queued:Array<()=>void>=[],run=vi.fn();
  const ws=new PenWorkspace(host,{block:parseMarkdown('Notes')[0],existingRuns:[],prefs:DEFAULT_PREFERENCES,eink:true,native:true,onCommit(){},onCancel(){},documentAction:{label:'Return to Agora',run},onBeforeNativeAction:action=>queued.push(action)});
  const button=host.querySelector<HTMLButtonElement>('[data-action="document-action"]')!;
  expect(button.closest('.tool-pill')).not.toBeNull();expect(button.getAttribute('aria-label')).toBe('Return to Agora');
  button.click();expect(run).not.toHaveBeenCalled();expect(queued).toHaveLength(1);queued[0]();expect(run).toHaveBeenCalledOnce();ws.destroy();host.remove();
 });
});

it('notebook expansion relocates the same live controls and restores compact order', () => {
  const host = document.createElement('div'); document.body.append(host);
  const queued: (() => void)[] = [], format = vi.fn();
  const ws = new PenWorkspace(host, {
    block: parseMarkdown('Notebook')[0], existingRuns: [], prefs: DEFAULT_PREFERENCES,
    eink: true, native: true, notebookToolbar: true, showSessionActions: false,
    pageTools: {index: 0, count: 2, change: vi.fn()},
    documentActions: [{label: 'Format with AI', run: format}],
    onBeforeNativeAction: action => queued.push(action), onCommit() {}, onCancel() {},
  });
  const core = host.querySelector('.toolbar-core')!, rail = host.querySelector('.toolbar-more-rail')!;
  const originalCore = [...core.children], originalRail = [...rail.children];
  const write = host.querySelector('[data-action="write"]')!;
  const ai = host.querySelector<HTMLButtonElement>('[data-action="document-action"]')!;
  const expand = host.querySelector<HTMLButtonElement>('[data-action="toolbar-expand"]')!;
  host.querySelector<HTMLButtonElement>('[data-action="toolbar-toggle"]')!.click();
  expand.click();
  expect(rail.querySelector('[data-action="write"]')).toBe(write);
  expect(rail.querySelector('[data-action="magnify"]')).not.toBeNull();
  expect(rail.querySelector('[data-action="document-action"]')).toBe(ai);
  expect(rail.querySelector('[data-action="undo"]')).not.toBeNull();
  expect(core.querySelector('[data-action="pages"]')).not.toBeNull();
  ai.click(); expect(format).not.toHaveBeenCalled(); expect(queued).toHaveLength(1);
  queued.shift()!(); expect(format).toHaveBeenCalledTimes(1);
  expand.click();
  expect([...core.children]).toEqual(originalCore);
  expect([...rail.children]).toEqual(originalRail);
  expand.click(); expand.click();
  expect(host.querySelectorAll('[data-action="write"]')).toHaveLength(1);
  expect([...core.children]).toEqual(originalCore);
  ws.destroy(); host.remove();
});

it('notebook colour shortcuts wait for flush, preserve both slots, and persist palette/brush/width changes', () => {
  const host = document.createElement('div'); document.body.append(host);
  const queued: (() => void)[] = [], preferences = vi.fn(), inkStyle = vi.fn();
  const ws = new PenWorkspace(host, {
    block: parseMarkdown('Notebook')[0], existingRuns: [], prefs: {...DEFAULT_PREFERENCES,penColor:'#000000'},
    eink: true, native: true, notebookToolbar: true, onCommit() {}, onCancel() {},
    onBeforeNativeAction: action => queued.push(action), onPreferencesChange: preferences, onInkStyleChange: inkStyle,
  });
  const slot = (n: number) => host.querySelector<HTMLButtonElement>(`[data-color-slot="${n}"]`)!;
  slot(1).click(); expect(inkStyle).not.toHaveBeenCalled(); queued.shift()!();
  expect(ws.getInkStyle().color).toBe('#1838D8');
  expect(preferences.mock.lastCall![0].penQuickColors).toEqual(['#000000','#1838D8']);
  slot(1).click(); queued.shift()!();
  const red = host.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Red"]')!;
  red.click(); expect(ws.getInkStyle().color).toBe('#1838D8'); queued.shift()!();
  expect(ws.getInkStyle().color).toBe('#E01010');
  expect(preferences.mock.lastCall![0].penQuickColors).toEqual(['#000000','#E01010']);
  expect(slot(1).getAttribute('aria-label')).toContain('Red');
  host.querySelector<HTMLButtonElement>('[aria-label="Back to pen settings"]')!.click();
  host.querySelector<HTMLButtonElement>('[role="dialog"] [aria-label="Marker"]')!.click();queued.shift()!();
  expect(ws.getInkStyle()).toMatchObject({color:'#E01010',width:8,brushStyle:'marker'});
  host.querySelector<HTMLButtonElement>('[aria-label="Pen width 4 pixels"]')!.click();queued.shift()!();
  expect(ws.getInkStyle().width).toBe(4);
  const saved=preferences.mock.lastCall![0]; ws.destroy();host.remove();
  const next = document.createElement('div');document.body.append(next);
  const reopened = new PenWorkspace(next, {block:parseMarkdown('Notebook')[0],existingRuns:[],prefs:saved,
    eink:true,native:true,notebookToolbar:true,onCommit(){},onCancel(){}});
  expect(reopened.getInkStyle()).toMatchObject({color:'#E01010',width:4,brushStyle:'marker'});
  expect(next.querySelector('[data-color-slot="1"]')?.getAttribute('aria-label')).toContain('Red');
  reopened.destroy();next.remove();
});

it('erasing lasso removes a tiny isolated top-row mark and undo restores exactly that ink',()=>{
  const ws=makeWorkspace('\u200b');
  ws.applyNativeWriteStroke(line(280,20,282,21,3),false);
  const before=ws.getNativeInkStrokes();expect(before).toHaveLength(1);
  const p=before[0].pts[0];ws.setEraserMode('lasso');
  ws.applyNativeStroke([{x:p.x-8,y:p.y-8},{x:p.x+10,y:p.y-8},{x:p.x+10,y:p.y+10},{x:p.x-8,y:p.y+10}].map((v,i)=>({...v,t:i,pressure:.5})));
  expect(ws.getNativeInkStrokes()).toHaveLength(0);
  ws.containerElement.parentElement!.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
  expect(ws.getNativeInkStrokes()).toEqual(before);ws.destroy();
});


it('upward spacing pushes earlier rows, preserves undo and saved ink coordinates', () => {
  let saved: CommitPayload | null = null;
  const ws = makeWorkspace('Planning', payload => { saved = payload; });
  for (const [id, row] of [['upper',2],['target',4],['suffix',6]] as const)
    ws.placeMagnifiedGroup([inkStroke(id,100,row*LINE+8,130,row*LINE+18)],row);
  const original=ws.getNativeInkStrokes();
  ws.setActiveTool('lines');
  ws.applyNativeStroke(line(30,3*LINE,30,0));
  const moved=ws.getNativeInkStrokes();
  expect(moved.map(s=>s.pts[0].y)).toEqual([LINE+8,2*LINE+8,4*LINE+8]);
  expect(moved.map(s=>s.pts[0].x)).toEqual([100,100,100]);
  const host=ws.containerElement.parentElement!;
  host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
  expect(ws.getNativeInkStrokes()).toEqual(original);
  host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
  expect(ws.getNativeInkStrokes()).toEqual(moved);
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('Done'))!.click();
  expect(saved).not.toBeNull();
  const reopened=makeWorkspace('Planning',()=>{},saved!.newRuns);
  expect(reopened.getNativeInkStrokes()).toEqual(moved);
  reopened.destroy();ws.destroy();
});

it('backward wrapping pushes earlier ink and survives undo, redo and reopen', () => {
  let saved: CommitPayload | null = null;
  const ws=makeWorkspace('Planning',payload=>{saved=payload;});
  ws.placeMagnifiedGroup([inkStroke('earlier',270,8,300,18)],0);
  ws.placeMagnifiedGroup([inkStroke('incoming',20,LINE+8,50,LINE+18)],1);
  const original=ws.getNativeInkStrokes();
  ws.setActiveTool('insert');
  ws.applyNativeStroke(line(60,LINE+12,20,LINE+12));
  const moved=ws.getNativeInkStrokes();
  expect(moved).toHaveLength(2);
  expect(moved[0].pts[0].x).toBeLessThan(original[0].pts[0].x);
  expect(moved[1].pts[0].y).toBe(8);
  const host=ws.containerElement.parentElement!;
  host.querySelector<HTMLButtonElement>('[data-action="undo"]')!.click();
  expect(ws.getNativeInkStrokes()).toEqual(original);
  host.querySelector<HTMLButtonElement>('[data-action="redo"]')!.click();
  expect(ws.getNativeInkStrokes()).toEqual(moved);
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.startsWith('Done'))!.click();
  const reopened=makeWorkspace('Planning',()=>{},saved!.newRuns);
  expect(reopened.getNativeInkStrokes()).toEqual(moved);
  reopened.destroy();ws.destroy();
});

it('passive native draft save persists completed ink without a flush, rerender or input change',async()=>{
 const saved=vi.fn(),ws=makeWorkspace('Planning',saved);const flush=vi.fn(),layout=vi.fn();
 (ws as any).props.onBeforeNativeAction=flush;(ws as any).props.onLayoutChanged=layout;
 ws.applyNativeWriteStroke([{x:20,y:20,t:1,pressure:.5},{x:40,y:35,t:2,pressure:.6}],false);
 layout.mockClear();await ws.saveDeliveredNativeDraft();expect(saved).toHaveBeenCalledOnce();
 expect(saved.mock.calls[0][0].newRuns.length).toBeGreaterThan(0);expect(saved.mock.calls[0][1]).toBe('checkpoint');expect(flush).not.toHaveBeenCalled();expect(layout).not.toHaveBeenCalled();ws.destroy();
});
