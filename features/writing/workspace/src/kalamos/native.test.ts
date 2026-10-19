import { afterEach, describe, expect, it, vi } from "vitest";
import { Write2Native } from "./native";
import { PenWorkspace } from "../vanilla/penWorkspace";

describe("Write2Native regional sync", () => {
  it('reuses a checkpointed same-geometry sheet without a daemon reconnect', () => {
    vi.useFakeTimers();
    const bridge={setInkEnabled:vi.fn(),renderInk:vi.fn(),snapshotContentPartial:vi.fn(),
      snapshotContent:vi.fn(),attachInkBox:vi.fn(),detachInkBoxCleared:vi.fn(),setInkStyle:vi.fn(),setPenType:vi.fn(),
      setWritingBounds:vi.fn(),setWritingExclusion:vi.fn()};
    Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
    const surface=document.createElement('div');
    Object.defineProperty(surface,'getBoundingClientRect',{value:()=>({left:0,top:0,right:500,bottom:700})});
    const old={containerElement:surface,currentTool:'select',isKeyboard:false,magnifyOpen:false,getNativeInkStrokes:()=>[]};
    const native=new Write2Native();
    Object.assign(native,{ws:old,attached:true,interactiveWeb:false,dpr:1,boxL:0,boxT:0,boxR:500,boxB:700,boxW:500,boxH:700});
    native.preparePageTurn(); native.detach();
    expect(bridge.setInkEnabled).toHaveBeenLastCalledWith(false);
    expect(bridge.detachInkBoxCleared).not.toHaveBeenCalled();
    native.attach({...old,currentTool:'write',getNativeInkStrokes:()=>[{width:2,color:'#000000',pts:[{x:300,y:100}]}]} as never);
    // Layout/toolbar callbacks cannot postpone the already queued page frame.
    native.syncNative({l:0,t:0,r:500,b:700});
    vi.advanceTimersByTime(0);
    expect(bridge.attachInkBox).not.toHaveBeenCalled();
    expect(bridge.setPenType).toHaveBeenLastCalledWith('ballpoint');
    expect(bridge.snapshotContentPartial).toHaveBeenCalledWith(0,0,500,700,0,0,500,700);
    const replay=JSON.parse(bridge.renderInk.mock.calls[0][0]);
    expect(replay.defer).toBe(1); expect(replay.s[0].p).toEqual([[300,100]]);
    expect(bridge.snapshotContent).not.toHaveBeenCalled();
    native.hooks().onWorkspaceLayout?.();
    vi.advanceTimersByTime(499);
    expect(bridge.setInkEnabled).toHaveBeenLastCalledWith(false);
    const presentations=bridge.renderInk.mock.calls.length;
    vi.advanceTimersByTime(1);
    expect(bridge.setInkEnabled).toHaveBeenLastCalledWith(true);
    expect(bridge.renderInk).toHaveBeenCalledTimes(presentations);
    expect(bridge.snapshotContentPartial).toHaveBeenCalledOnce();
  });
  it('a cancelled sheet load releases the retained controller', () => {
    vi.useFakeTimers();
    const detachInkBoxCleared=vi.fn();
    Object.defineProperty(globalThis,'Bridge',{configurable:true,value:{setInkEnabled:vi.fn(),detachInkBoxCleared,
      setWritingBounds:vi.fn(),setWritingExclusion:vi.fn()}});
    const native=new Write2Native();
    Object.assign(native,{attached:true,ws:{currentTool:'write',isKeyboard:false,magnifyOpen:false}});
    native.preparePageTurn(); native.detach(); native.cancelPageTurn();
    expect(detachInkBoxCleared).toHaveBeenCalledOnce();
  });
  it('changed sheet geometry uses the normal capture and ready-gated attach', () => {
    vi.useFakeTimers();
    const bridge={setInkEnabled:vi.fn(),renderInk:vi.fn(),snapshotContentPartial:vi.fn(),
      snapshotContent:vi.fn(),attachInkBox:vi.fn(),detachInkBoxCleared:vi.fn(),setInkStyle:vi.fn(),
      setWritingBounds:vi.fn(),setWritingExclusion:vi.fn(),setPenType:vi.fn()};
    Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
    const surface=document.createElement('div');
    Object.defineProperty(surface,'getBoundingClientRect',{value:()=>({left:0,top:0,right:550,bottom:700})});
    const workspace={containerElement:surface,currentTool:'write',isKeyboard:false,magnifyOpen:false,getNativeInkStrokes:()=>[]};
    const native=new Write2Native();
    Object.assign(native,{ws:workspace,attached:true,interactiveWeb:false,dpr:1,boxL:0,boxT:0,boxR:500,boxB:700,boxW:500,boxH:700});
    native.preparePageTurn(); native.detach(); native.attach(workspace as never);
    expect(bridge.detachInkBoxCleared).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(220);
    expect(bridge.attachInkBox).toHaveBeenCalledWith(0,0,550,700);
    expect(bridge.snapshotContent).toHaveBeenCalledWith(0,0,550,700);
    expect(bridge.snapshotContentPartial).not.toHaveBeenCalled();
    expect(JSON.parse(bridge.renderInk.mock.calls[0][0]).defer).toBe(1);
    native.suspend();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { Bridge?: unknown }).Bridge;
    window._inkHandler = null;
    window._noteSketch = null;
  });

  it.each(["pen", "recognition", "magnify", "text", "future"])("detects mounted %s dialogs and keeps ownership until the last one closes", (kind) => {
    const root = document.createElement("div");
    document.body.append(root);
    const first = document.createElement("div");
    if (kind === "magnify") first.className = "magnify-settings";
    else if (kind === "text") first.className = "rw-text-editor";
    else first.setAttribute("role", "dialog");
    const second = document.createElement("div"); second.setAttribute("role", "dialog");
    const onDialogChange = vi.fn();
    const host = { root, dialogNotified: false, props: { onDialogChange } };
    const sync = (PenWorkspace.prototype as unknown as { syncDialogOwnership: () => void }).syncDialogOwnership;
    root.append(first); sync.call(host);
    expect(onDialogChange).toHaveBeenLastCalledWith(true);
    root.append(second); first.remove(); sync.call(host);
    expect(onDialogChange).toHaveBeenCalledOnce();
    second.hidden = true; sync.call(host);
    expect(onDialogChange).toHaveBeenLastCalledWith(false);
    root.remove();
  });

  it("waits for the new workspace frame before baking native content", () => {
    vi.useFakeTimers();
    const snapshotContent = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        snapshotContent,
        clearContent: vi.fn(),
      },
    });

    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 44, right: 674, bottom: 840 }),
    });
    const native = new Write2Native();
    native.attach({
      currentTool: "write",
      isKeyboard: false,
      magnifyOpen: false,
      containerElement: surface,
    } as never);

    expect(snapshotContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(63);
    expect(snapshotContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    // A fractional/oversized DOM rect is clipped to the physical viewport;
    // the daemon must never receive an off-panel buffer.
    expect(snapshotContent).toHaveBeenCalledWith(0, 44, 674, window.innerHeight);
    native.suspend();
  });

  it("keeps the content bitmap full-screen and limits only the refresh rect", () => {
    vi.useFakeTimers();
    const snapshotContent = vi.fn();
    const snapshotContentPartial = vi.fn();
    const renderInk = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        renderInk,
        setInkEnabled: vi.fn(),
        snapshotContent,
        snapshotContentPartial,
      },
    });

    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 12, top: 24, right: 612, bottom: 724 }),
    });

    const native = new Write2Native();
    Object.assign(native, {
      ws: {
        containerElement: surface,
        getNativeInkStrokes: () => [],
      },
      attached: true,
      dpr: 2,
      boxL: 0,
      boxT: 0,
      boxR: 1264,
      boxB: 1635,
      boxW: 1264,
      boxH: 1635,
    });

    (native as unknown as {
      syncNative(rect: { l: number; t: number; r: number; b: number }): void;
    }).syncNative({ l: 12, t: 24, r: 612, b: 724 });
    vi.advanceTimersByTime(160);

    expect(snapshotContentPartial).toHaveBeenCalledWith(
      0, 0, 1264, 1635,
      24, 48, 1224, 1448
    );
    expect(snapshotContent).not.toHaveBeenCalled();
    expect(JSON.parse(renderInk.mock.calls[0][0] as string).defer).toBe(1);
  });

  it("hands non-writing tools to the WebView and reveals ink only after reattach is ready", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const attachInkBox = vi.fn();
    const detachInkBox = vi.fn();
    const detachInkBoxCleared = vi.fn();
    const detachInkBoxForWeb = vi.fn();
    const setInteractivePanel = vi.fn();
    const showEditor = vi.fn();
    const skipWakeRefresh = vi.fn();
    const renderInk = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setPenType: vi.fn(),
        skipWakeRefresh,
        attachInkBox,
        setInkStyle: vi.fn(),
        setInkEnabled: vi.fn(),
        flushInk: vi.fn(),
        setWritingBounds: vi.fn(),
        setWritingExclusion: vi.fn(),
        detachInkBox, detachInkBoxCleared, detachInkBoxForWeb,
        setInteractivePanel, showEditor,
        clearContent: vi.fn(),
        renderInk,
        snapshotContent: vi.fn(),
        snapshotContentPartial: vi.fn(),
      },
    });

    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 20, top: 100, right: 620, bottom: 700 }),
    });
    const workspace = {
      currentTool: "write",
      isKeyboard: false,
      containerElement: surface,
      getNativeInkStrokes: () => [],
    };
    const native = new Write2Native();
    Object.assign(native, {
      ws: workspace,
      attached: true,
      dpr: 1,
      boxW: 674,
      boxH: 872,
    });

    const hooks = native.hooks();
    hooks.onWorkspaceTool?.("erase", false);
    expect(detachInkBoxForWeb).toHaveBeenCalledOnce();
    expect(detachInkBoxCleared).not.toHaveBeenCalled();
    expect(detachInkBox).not.toHaveBeenCalled();
    expect(setInteractivePanel).toHaveBeenLastCalledWith(true);
    expect(setInteractivePanel).toHaveBeenCalledTimes(1);

    // Tool and layout callbacks may repeat while Web mode is already active.
    // They must not restart the native animation policy transition.
    hooks.onWorkspaceTool?.("erase", false);
    expect(setInteractivePanel).toHaveBeenCalledTimes(1);

    hooks.onWorkspaceTool?.("write", false);
    vi.advanceTimersByTime(220);
    expect(skipWakeRefresh).not.toHaveBeenCalled();
    expect(attachInkBox).toHaveBeenCalledOnce();
    expect(attachInkBox).toHaveBeenCalledWith(20, 100, 620, 700);
    // Native attach is asynchronous. Mirror the production
    // onInkControllerReady(true) callback before expecting presentation.
    native.renderNoteStrokes();
    expect(showEditor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(140);
    expect(showEditor).toHaveBeenCalledOnce();
    expect(setInteractivePanel).toHaveBeenLastCalledWith(false);
    expect(setInteractivePanel).toHaveBeenCalledTimes(2);
    const rendered = JSON.parse(renderInk.mock.calls[renderInk.mock.calls.length - 1][0] as string);
    expect(rendered.rr).toEqual([0, 0, 600, 600]);
  });

  it("uses the live WebView while moving the toolbar, then restores the daemon", () => {
    vi.useFakeTimers();
    const setInkEnabled = vi.fn();
    const flushInk = vi.fn();
    const detachInkBoxForWeb = vi.fn();
    const setInteractivePanel = vi.fn();
    const attachInkBox = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setInkEnabled,
        flushInk,
        detachInkBoxForWeb,
        setInteractivePanel,
        showWebWorkspace: vi.fn(),
        setWritingBounds: vi.fn(),
        setWritingExclusion: vi.fn(),
        setErasing: vi.fn(),
        snapshotContent: vi.fn(),
        setPenType: vi.fn(),
        skipWakeRefresh: vi.fn(),
        attachInkBox,
        setInkStyle: vi.fn(),
      },
    });
    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 80, right: 674, bottom: 840 }),
    });
    const workspace = {
      currentTool: "write",
      isKeyboard: false,
      magnifyOpen: false,
      containerElement: surface,
      getNativeInkStrokes: () => [],
    };
    const native = new Write2Native();
    Object.assign(native, {
      ws: workspace,
      attached: true,
      surfaceEl: surface,
      dpr: 1,
      boxL: 0,
      boxT: 80,
      boxR: 674,
      boxB: 840,
      boxW: 674,
      boxH: 760,
    });

    const hooks = native.hooks();
    hooks.onWorkspaceToolbarDrag?.(true);
    expect(setInkEnabled).toHaveBeenLastCalledWith(false);
    expect(flushInk).toHaveBeenCalledOnce();
    expect(detachInkBoxForWeb).not.toHaveBeenCalled();

    native.onNativeFlushed();
    expect(detachInkBoxForWeb).toHaveBeenCalledOnce();
    expect(setInteractivePanel).toHaveBeenLastCalledWith(true);

    hooks.onWorkspaceToolbarDrag?.(false);
    expect(setInteractivePanel).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(300);
    expect(attachInkBox).toHaveBeenCalledWith(0, 80, 674, window.innerHeight);
  });

  it.each(["pen", "eraser", "recognition", "text"])("hands %s dialogs to the WebView after the final ink batch", () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const bridge = {
      setInkEnabled: vi.fn(), flushInk: vi.fn(),
      detachInkBoxForWeb: vi.fn(() => events.push("detach")),
      setInteractivePanel: vi.fn(), showWebWorkspace: vi.fn(),
      setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(), setErasing: vi.fn(),
      snapshotContent: vi.fn(), attachInkBox: vi.fn(), setPenType: vi.fn(), setInkStyle: vi.fn(),
    };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const surface = document.createElement("div");
    surface.getBoundingClientRect = () => ({ left: 0, top: 80, right: 600, bottom: 700 } as DOMRect);
    const vectors: unknown[] = [];
    const ws = {
      currentTool: "write", isKeyboard: false, magnifyOpen: false, containerElement: surface,
      getNativeInkStrokes: () => vectors,
      applyNativeWriteStroke: (stroke: unknown) => { vectors.push(stroke); events.push("save"); },
      setNativeDialogHandoff: vi.fn((active) => events.push(active ? "web" : "native")),
    };
    const native = new Write2Native();
    Object.assign(native, { ws, attached: true, surfaceEl: surface, dpr: 1, boxL: 0, boxT: 80 });
    native.hooks().onWorkspaceDialog?.(true);
    expect(bridge.flushInk).toHaveBeenCalledOnce();
    expect(bridge.detachInkBoxForWeb).not.toHaveBeenCalled();
    native.onNoteStrokes([[[20, 30, 0.5], [40, 50, 0.5]]]);
    native.onNativeFlushed();
    expect(events).toEqual(["save", "web", "detach"]);
    native.resume();
    native.hooks().onWorkspaceLayout?.();
    vi.advanceTimersByTime(500);
    expect(bridge.attachInkBox).not.toHaveBeenCalled();
    native.hooks().onWorkspaceDialog?.(false);
    expect(ws.setNativeDialogHandoff).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(300);
    expect(bridge.attachInkBox).toHaveBeenCalledOnce();
    expect(vectors).toHaveLength(1);
  });

  it("retires compact foreground when expanded chrome keeps the same composition bounds", () => {
    vi.useFakeTimers();
    const bridge = {
      setInteractivePanel: vi.fn(), setErasing: vi.fn(), setInkEnabled: vi.fn(), flushInk: vi.fn(),
      setPenType: vi.fn(), setInkStyle: vi.fn(), setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(),
      detachInkBoxForWeb: vi.fn(), attachInkBox: vi.fn(), snapshotContent: vi.fn(),
      snapshotContentPartial: vi.fn(), snapshotMenu: vi.fn(), clearMenuSnapshot: vi.fn(), renderInk: vi.fn(),
    };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const paper = document.createElement("div");
    paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 700 } as DOMRect);
    let expanded = false;
    const ws = {
      currentTool: "write", isKeyboard: false, magnifyOpen: false, containerElement: paper,
      nativeChromeRect: () => expanded ? null : ({ l: 8, t: 100, r: 48, b: 400 }),
      getNativeInkStrokes: () => [],
    };
    const native = new Write2Native();
    native.attach(ws as never); vi.advanceTimersByTime(220); native.renderNoteStrokes();
    expect(bridge.snapshotMenu).toHaveBeenCalledOnce();
    bridge.snapshotContentPartial.mockClear();
    expanded = true;
    native.hooks().onWorkspaceLayout?.();
    expect(bridge.clearMenuSnapshot).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(220);
    expect(bridge.snapshotContentPartial).toHaveBeenLastCalledWith(0, 0, 600, 700, 0, 0, 600, 700);
    expect(bridge.clearMenuSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.snapshotContentPartial.mock.invocationCallOrder[0]);
    native.hooks().onWorkspaceLayout?.(); vi.advanceTimersByTime(220);
    expect(bridge.clearMenuSnapshot).toHaveBeenCalledOnce();
    expect(bridge.snapshotMenu).toHaveBeenCalledOnce();
    expanded = false;
    native.hooks().onWorkspaceLayout?.(); vi.advanceTimersByTime(220);
    expect(bridge.snapshotMenu).toHaveBeenCalledTimes(2);
    expect(bridge.attachInkBox).toHaveBeenCalledOnce();
    expect(bridge.detachInkBoxForWeb).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps chrome above replay and handles native resume rejection (%s)", (resumeRejected) => {
    vi.useFakeTimers();
    const bridge = {
      setInteractivePanel: vi.fn(), setErasing: vi.fn(), setInkEnabled: vi.fn(), flushInk: vi.fn(),
      setPenType: vi.fn(), setInkStyle: vi.fn(), setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(),
      detachInkBoxForWeb: vi.fn(), attachInkBox: vi.fn(), resumeInkBox: vi.fn(), snapshotContent: vi.fn(),
      snapshotContentPartial: vi.fn(), snapshotMenu: vi.fn(), renderInk: vi.fn(), showEditor: vi.fn(),
    };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const paper = document.createElement("div");
    paper.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 700 } as DOMRect);
    const ws = {
      currentTool: "write", isKeyboard: false, magnifyOpen: false, containerElement: paper,
      nativeChromeRect: () => ({ l: 8, t: 100, r: 400, b: 150 }),
      getNativeInkStrokes: () => [{ width: 2, color: "#000", pts: [{ x: 30, y: 120 }, { x: 90, y: 160 }] }],
      setNativeDialogHandoff: vi.fn(),
    };
    const native = new Write2Native();
    native.attach(ws as never); vi.advanceTimersByTime(220); native.renderNoteStrokes();
    expect(bridge.attachInkBox).toHaveBeenCalledOnce();
    expect(bridge.resumeInkBox).not.toHaveBeenCalled();
    expect(bridge.snapshotMenu).toHaveBeenCalledWith(8, 100, 400, 150, 8, 100, 400, 150);
    bridge.renderInk.mockClear(); bridge.snapshotContent.mockClear(); bridge.snapshotMenu.mockClear();
    native.hooks().onWorkspaceDialog?.(true);
    native.hooks().onWorkspaceOverlay?.({ l: 8, t: 100, r: 420, b: 400 });
    native.onNativeFlushed();
    native.hooks().onWorkspaceDialog?.(false);
    vi.advanceTimersByTime(300);
    expect(bridge.resumeInkBox).toHaveBeenCalledWith(0, 0, 600, 700);
    expect(bridge.snapshotContent).not.toHaveBeenCalled();
    expect(bridge.snapshotContentPartial).toHaveBeenLastCalledWith(0, 0, 600, 700, 8, 100, 420, 400);
    if (resumeRejected) native.onNativeResumeRejected();
    native.renderNoteStrokes();
    const replay = JSON.parse(bridge.renderInk.mock.calls[bridge.renderInk.mock.calls.length - 1][0]);
    expect(replay.rr).toEqual(resumeRejected ? [0, 0, 600, 700] : [8, 100, 420, 400]);
    expect(replay.s[0].p).toEqual([[30, 120], [90, 160]]);
    expect(bridge.snapshotMenu).toHaveBeenLastCalledWith(8, 100, 400, 150, 8, 100, resumeRejected ? 400 : 420, resumeRejected ? 150 : 400);
    // Subsequent toolbar state changes remain a retained foreground layer with partial refresh.
    native.hooks().onWorkspaceToolbarLayout?.({ l: 8, t: 100, r: 400, b: 150 }, { l: 8, t: 100, r: 400, b: 150 });
    expect(bridge.snapshotMenu).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(160);
    // A toolbar replacement must update its underlying content too, or the old pill/tab
    // remains baked beneath the new foreground controls.
    expect(bridge.snapshotContentPartial).toHaveBeenLastCalledWith(0, 0, 600, 700, 8, 100, 400, 150);
    native.suspend();
    native.resume(); vi.advanceTimersByTime(220);
    expect(bridge.attachInkBox).toHaveBeenCalledTimes(2);
    expect(bridge.resumeInkBox).toHaveBeenCalledOnce();
  });

  it("does not detach or reattach a dialog dismissed before its flush returns", () => {
    vi.useFakeTimers();
    const bridge = { setInkEnabled: vi.fn(), flushInk: vi.fn(), detachInkBoxForWeb: vi.fn() };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const native = new Write2Native();
    Object.assign(native, { attached: true, ws: { currentTool: "write", isKeyboard: false, magnifyOpen: false } });
    native.hooks().onWorkspaceDialog?.(true);
    native.hooks().onWorkspaceDialog?.(false);
    native.onNativeFlushed();
    vi.advanceTimersByTime(500);
    expect(bridge.detachInkBoxForWeb).not.toHaveBeenCalled();
    expect(bridge.setInkEnabled).toHaveBeenLastCalledWith(true);
  });

  it("refreshes only the old/new toolbar union on tap expansion", () => {
    vi.useFakeTimers();
    const snapshotContentPartial = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setInkEnabled: vi.fn(),
        renderInk: vi.fn(),
        snapshotContent: vi.fn(),
        snapshotContentPartial,
        setWritingBounds: vi.fn(),
        setWritingExclusion: vi.fn(),
      },
    });
    const surface = document.createElement("div");
    const native = new Write2Native();
    Object.assign(native, {
      ws: {
        currentTool: "write",
        isKeyboard: false,
        magnifyOpen: false,
        containerElement: surface,
        getNativeInkStrokes: () => [],
      },
      attached: true,
      dpr: 2,
      boxL: 0,
      boxT: 100,
      boxR: 1264,
      boxB: 1680,
      boxW: 1264,
      boxH: 1580,
    });

    native.hooks().onWorkspaceToolbarLayout?.(
      { l: 0, t: 140, r: 28, b: 198 },
      { l: 8, t: 140, r: 630, b: 198 }
    );
    vi.advanceTimersByTime(160);

    expect(snapshotContentPartial).toHaveBeenCalledWith(
      0, 100, 1264, 1680,
      0, 180, 1260, 296
    );
  });

  it("keeps collapsed, compact and expanded chrome within one composition, with Zoom separate", () => {
    const modal = document.createElement("div");
    modal.className = "v-modal";
    const root = document.createElement("div");
    const paper = document.createElement("div");
    const toolbar = document.createElement("div");
    modal.append(root);
    root.append(paper, toolbar);
    const host = { root, toolbarEl: toolbar, magnifyPad: null, nativeInkSurface: () => paper };
    toolbar.classList.add("toolbar-collapsed");
    expect(PenWorkspace.prototype.nativeCompositionSurface.call(host as never)).toBe(modal);
    toolbar.classList.remove("toolbar-collapsed");
    expect(PenWorkspace.prototype.nativeCompositionSurface.call(host as never)).toBe(modal);
    toolbar.classList.add("toolbar-all-tools");
    expect(PenWorkspace.prototype.nativeCompositionSurface.call(host as never)).toBe(modal);
    expect(PenWorkspace.prototype.nativeCompositionSurface.call({ ...host, magnifyPad: {} } as never)).toBe(paper);
    modal.removeChild(root);
    expect(PenWorkspace.prototype.nativeCompositionSurface.call(host as never)).toBe(root);
  });

  it("bakes expanded chrome with paper-local input and replay inside restricted writing bounds", () => {
    vi.useFakeTimers();
    const bridge = {
      setInteractivePanel: vi.fn(), setErasing: vi.fn(), setPenType: vi.fn(),
      setInkEnabled: vi.fn(), setInkStyle: vi.fn(), setWritingBounds: vi.fn(),
      setWritingExclusion: vi.fn(), attachInkBox: vi.fn(), snapshotContent: vi.fn(),
      snapshotContentPartial: vi.fn(), renderInk: vi.fn(), showEditor: vi.fn(),
    };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const paper = document.createElement("div");
    const composition = document.createElement("div");
    Object.defineProperty(paper, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 120, right: 600, bottom: 700 }),
    });
    Object.defineProperty(composition, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 20, right: 600, bottom: 700 }),
    });
    paper.scrollLeft = 5;
    paper.scrollTop = 40;
    const applyNativeWriteStroke = vi.fn();
    const ws = {
      currentTool: "write", isKeyboard: false, magnifyOpen: false,
      containerElement: paper, nativeInkSurface: () => paper,
      nativeCompositionSurface: () => composition,
      getNativeInkStrokes: () => [{ width: 2, color: "#000000", pts: [{ x: 25, y: 60 }] }],
      applyNativeWriteStroke,
    };
    const native = new Write2Native();
    native.attach(ws as never);
    vi.advanceTimersByTime(220);
    // Includes the header and rail, rather than baking only the inset paper.
    expect(bridge.snapshotContent).toHaveBeenCalledWith(10, 20, 600, 700);
    expect(bridge.attachInkBox).toHaveBeenCalledWith(10, 20, 600, 700);
    expect(bridge.setWritingBounds).toHaveBeenLastCalledWith(90, 100, 590, 680);
    expect(bridge.renderInk).toHaveBeenCalledOnce();
    expect(JSON.parse(bridge.renderInk.mock.calls[0][0]).defer).toBe(1);
    expect(bridge.renderInk.mock.invocationCallOrder[0]).toBeLessThan(bridge.snapshotContent.mock.invocationCallOrder[0]);
    native.renderNoteStrokes();
    const replay = JSON.parse(bridge.renderInk.mock.calls[1][0]);
    expect(replay.defer).toBeUndefined();
    expect(replay.s[0].p).toEqual([[110, 120]]);
    native.onNoteStrokes([[[110, 120, 0.7]]]);
    expect(applyNativeWriteStroke.mock.calls[0][0][0]).toMatchObject({ x: 25, y: 60, pressure: 0.7 });
    // Popup exclusions and bounded chrome refreshes use the same daemon-local origin.
    native.hooks().onWorkspaceOverlay?.({ l: 150, t: 160, r: 250, b: 260 });
    expect(bridge.setWritingExclusion).toHaveBeenLastCalledWith(140, 140, 240, 240);
    native.hooks().onWorkspaceToolbarLayout?.(
      { l: 10, t: 120, r: 100, b: 220 }, { l: 10, t: 120, r: 100, b: 250 }
    );
    vi.advanceTimersByTime(160);
    expect(bridge.snapshotContentPartial).toHaveBeenLastCalledWith(10, 20, 600, 700, 0, 100, 90, 230);
  });

  it("captures the complete edge tab and its old footprint without splitting at the paper inset", () => {
    vi.useFakeTimers();
    const bridge = {
      setInteractivePanel: vi.fn(), detachInkBoxForWeb: vi.fn(), setErasing: vi.fn(),
      setPenType: vi.fn(), setInkEnabled: vi.fn(), setInkStyle: vi.fn(),
      setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(), attachInkBox: vi.fn(),
      snapshotContent: vi.fn(), snapshotContentPartial: vi.fn(), snapshotMenu: vi.fn(), renderInk: vi.fn(),
    };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const modal = document.createElement("div");
    modal.className = "v-modal";
    const root = document.createElement("div");
    const paper = document.createElement("div");
    const toolbar = document.createElement("div");
    modal.append(root); root.append(paper, toolbar);
    Object.defineProperty(modal, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 600, bottom: 700 }),
    });
    Object.defineProperty(paper, "getBoundingClientRect", {
      value: () => ({ left: 12, top: 12, right: 588, bottom: 680 }),
    });
    const tab = { l: 0, t: 100, r: 38, b: 150 };
    const ws = {
      root, toolbarEl: toolbar, magnifyPad: null,
      currentTool: "write", isKeyboard: false, magnifyOpen: false, containerElement: paper,
      nativeInkSurface: () => paper,
      getNativeInkStrokes: () => [],
      nativeCompositionSurface: PenWorkspace.prototype.nativeCompositionSurface,
      nativeChromeRect: () => tab,
    };
    const native = new Write2Native();
    native.attach(ws as never);
    vi.advanceTimersByTime(220);
    expect(bridge.attachInkBox).toHaveBeenLastCalledWith(0, 0, 600, 700);
    expect(bridge.setWritingBounds).toHaveBeenLastCalledWith(12, 12, 588, 680);
    Object.assign(native, { warming: false });
    bridge.attachInkBox.mockClear();
    toolbar.classList.add("toolbar-collapsed");
    native.hooks().onWorkspaceLayout?.();
    vi.advanceTimersByTime(220);
    native.hooks().onWorkspaceToolbarLayout?.({ l: 0, t: 80, r: 48, b: 400 }, tab);
    vi.advanceTimersByTime(400);
    expect(bridge.snapshotMenu).toHaveBeenLastCalledWith(0, 100, 38, 150, 0, 80, 48, 400);
    expect(bridge.snapshotContentPartial).toHaveBeenLastCalledWith(0, 0, 600, 700, 0, 80, 48, 400);
    expect(bridge.detachInkBoxForWeb).not.toHaveBeenCalled();
    expect(bridge.attachInkBox).not.toHaveBeenCalled();
  });

  it("retains the presentation window when expanded composition replaces same-sized paper", () => {
    vi.useFakeTimers();
    const bridge = {
      setInteractivePanel: vi.fn(), detachInkBoxForWeb: vi.fn(), setErasing: vi.fn(),
      setPenType: vi.fn(), setInkEnabled: vi.fn(), setInkStyle: vi.fn(),
      setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(), attachInkBox: vi.fn(),
      snapshotContent: vi.fn(), snapshotContentPartial: vi.fn(),
    };
    Object.defineProperty(globalThis, "Bridge", { configurable: true, value: bridge });
    const paper = document.createElement("div");
    const modal = document.createElement("div");
    let expanded = false;
    const fullRect = { left: 0, top: 0, right: 600, bottom: 700 };
    Object.defineProperty(modal, "getBoundingClientRect", { value: () => fullRect });
    Object.defineProperty(paper, "getBoundingClientRect", {
      value: () => expanded ? { ...fullRect, left: 90, top: 100 } : fullRect,
    });
    const ws = {
      currentTool: "write", isKeyboard: false, magnifyOpen: false, containerElement: paper,
      nativeInkSurface: () => paper, nativeCompositionSurface: () => expanded ? modal : paper,
    };
    const native = new Write2Native();
    native.attach(ws as never);
    vi.advanceTimersByTime(220);
    // Controller-ready ends the warm guard; retained stroke presentation is covered separately.
    Object.assign(native, { warming: false });
    bridge.attachInkBox.mockClear();
    bridge.snapshotContent.mockClear();
    expanded = true;
    native.hooks().onWorkspaceLayout?.();
    native.hooks().onWorkspaceLayout?.();
    expect(bridge.detachInkBoxForWeb).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(179);
    expect(bridge.setInteractivePanel).toHaveBeenLastCalledWith(true);
    expect(bridge.snapshotContent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(221);
    expect(bridge.attachInkBox).toHaveBeenLastCalledWith(0, 0, 600, 700);
    expect(bridge.snapshotContent).toHaveBeenLastCalledWith(0, 0, 600, 700);
    expect(bridge.setWritingBounds).toHaveBeenLastCalledWith(90, 100, 600, 700);
  });

  it("presents the WebView before reattaching after full chrome changes paper geometry", () => {
    vi.useFakeTimers();
    const setInteractivePanel = vi.fn();
    const detachInkBoxForWeb = vi.fn();
    const attachInkBox = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setInteractivePanel,
        detachInkBoxForWeb,
        setErasing: vi.fn(),
        setWritingBounds: vi.fn(),
        setWritingExclusion: vi.fn(),
        setPenType: vi.fn(),
        setInkEnabled: vi.fn(),
        setInkStyle: vi.fn(),
        attachInkBox,
        snapshotContent: vi.fn(),
        snapshotContentPartial: vi.fn(),
      },
    });

    let bounds = {
      left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight,
    };
    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", { value: () => bounds });
    const workspace = {
      currentTool: "write",
      isKeyboard: false,
      magnifyOpen: false,
      containerElement: surface,
      getNativeInkStrokes: () => [],
    };
    const native = new Write2Native();
    Object.assign(native, {
      ws: workspace,
      attached: true,
      surfaceEl: surface,
      interactiveWeb: false,
      dpr: 1,
      boxL: 0,
      boxT: 0,
      boxR: window.innerWidth,
      boxB: window.innerHeight,
      boxW: window.innerWidth,
      boxH: window.innerHeight,
    });

    bounds = {
      left: 90, top: 108, right: window.innerWidth, bottom: window.innerHeight,
    };
    native.hooks().onWorkspaceLayout?.();

    expect(detachInkBoxForWeb).toHaveBeenCalledOnce();
    expect(setInteractivePanel).toHaveBeenLastCalledWith(true);
    expect(setInteractivePanel).toHaveBeenCalledTimes(1);
    expect(attachInkBox).not.toHaveBeenCalled();

    // Repeated ResizeObserver delivery during the CSS transition must not bypass the wait.
    native.hooks().onWorkspaceLayout?.();

    vi.advanceTimersByTime(179);
    expect(setInteractivePanel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(setInteractivePanel).toHaveBeenLastCalledWith(false);
    expect(attachInkBox).not.toHaveBeenCalled();

    vi.advanceTimersByTime(219);
    expect(attachInkBox).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(attachInkBox).toHaveBeenCalledWith(
      90, 108, window.innerWidth, window.innerHeight
    );
  });

  it("keeps the workspace callback alive until the native detach flush is routed", () => {
    vi.useFakeTimers();
    const native = new Write2Native();
    Object.assign(native, { attached: true });
    window._inkHandler = native;
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setInteractivePanel: vi.fn(),
        setErasing: vi.fn(),
        setWritingBounds: vi.fn(),
        setWritingExclusion: vi.fn(),
        detachInkBoxCleared: vi.fn(),
      },
    });

    native.suspend();

    // InkManager.detach() posts its final stroke batch asynchronously. The
    // canonical Planning handler must still own that batch instead of letting
    // it fall through to the removed classic-editor callback.
    expect(window._inkHandler).toBe(native);
    vi.advanceTimersByTime(299);
    expect(window._inkHandler).toBe(native);
    vi.advanceTimersByTime(1);
    expect(window._inkHandler).toBeNull();
  });

  it("ingests an idle stroke batch without rendering or refreshing", () => {
    vi.useFakeTimers();
    const applyNativeWriteStroke = vi.fn();
    const renderInk = vi.fn();
    const snapshotContent = vi.fn();
    const snapshotContentPartial = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: { renderInk, snapshotContent, snapshotContentPartial },
    });
    const surface = document.createElement("div");
    Object.defineProperties(surface, {
      scrollLeft: { value: 0, writable: true },
      scrollTop: { value: 0, writable: true },
    });
    const native = new Write2Native();
    Object.assign(native, {
      ws: { containerElement: surface, applyNativeWriteStroke },
      attached: true,
      dpr: 2,
    });

    native.onNoteStrokes([[[20, 40, 0.5], [40, 60, 0.7]]]);
    vi.advanceTimersByTime(1000);

    expect(applyNativeWriteStroke).toHaveBeenCalledOnce();
    expect(applyNativeWriteStroke.mock.calls[0][1]).toBe(false);
    expect(renderInk).not.toHaveBeenCalled();
    expect(snapshotContent).not.toHaveBeenCalled();
    expect(snapshotContentPartial).not.toHaveBeenCalled();
  });

  it("presents the ruled surface only when the Bigme controller reports ready", () => {
    const renderInk = vi.fn();
    const setWritingBounds = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        renderInk,
        setWritingBounds,
        setWritingExclusion: vi.fn(),
      },
    });
    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 52, right: 674, bottom: 840 }),
    });
    const native = new Write2Native();
    Object.assign(native, {
      ws: {
        currentTool: "write",
        isKeyboard: false,
        magnifyOpen: false,
        containerElement: surface,
        getNativeInkStrokes: () => [{
          width: 2,
          color: "#1838D8",
          selected: false,
          pts: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
        }],
      },
      attached: true,
      warming: true,
      dpr: 2,
      boxW: 1264,
      boxH: 1462,
    });

    native.renderNoteStrokes();

    expect(renderInk).toHaveBeenCalledOnce();
    const payload = JSON.parse(renderInk.mock.calls[0][0] as string);
    expect(payload.rr).toEqual([0, 0, 1264, 1462]);
    expect(payload.s).toHaveLength(1);
    expect(payload.s[0].c).toBe("#1838D8");
    expect(setWritingBounds).toHaveBeenLastCalledWith(0, 0, 1264, 1462);
  });

  it("routes magnify batches in pad-local coordinates", () => {
    vi.useFakeTimers();
    const applyNativeMagnifyStroke = vi.fn();
    const reconcileMagnifyAfterIdle = vi.fn();
    const workspace = document.createElement("div");
    const pad = document.createElement("canvas");
    Object.defineProperties(workspace, {
      scrollLeft: { value: 90, writable: true },
      scrollTop: { value: 140, writable: true },
    });
    const native = new Write2Native();
    Object.assign(native, {
      ws: {
        magnifyOpen: true,
        containerElement: workspace,
        nativeInkSurface: () => pad,
        applyNativeMagnifyStroke,
        reconcileMagnifyAfterIdle,
      },
      attached: true,
      dpr: 2,
    });

    native.onNoteStrokes([[[20, 40, 0.5], [44, 68, 0.7]]]);

    expect(applyNativeMagnifyStroke).toHaveBeenCalledOnce();
    expect(applyNativeMagnifyStroke.mock.calls[0][0]).toEqual([
      expect.objectContaining({ x: 10, y: 20, pressure: 0.5 }),
      expect.objectContaining({ x: 22, y: 34, pressure: 0.7 }),
    ]);
    vi.advanceTimersByTime(119);
    expect(reconcileMagnifyAfterIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reconcileMagnifyAfterIdle).toHaveBeenCalledOnce();
  });

  it("expands to one full-screen daemon and bounds writing to the lower magnify lane", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const attachInkBox = vi.fn();
    const detachInkBox = vi.fn();
    const setWritingBounds = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setPenType: vi.fn(), skipWakeRefresh: vi.fn(), attachInkBox,
        setInkStyle: vi.fn(), setInkEnabled: vi.fn(), flushInk: vi.fn(),
        setWritingBounds, setWritingExclusion: vi.fn(), detachInkBox,
        clearContent: vi.fn(), renderInk: vi.fn(), snapshotContent: vi.fn(),
        snapshotContentPartial: vi.fn(),
      },
    });
    const documentSurface = document.createElement("div");
    const padSurface = document.createElement("canvas");
    Object.defineProperty(documentSurface, "getBoundingClientRect", {
      value: () => ({ left: 20, top: 100, right: 620, bottom: 620 }),
    });
    Object.defineProperty(padSurface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 540, right: 674, bottom: 840 }),
    });
    let magnifyOpen = false;
    const workspace = {
      currentTool: "write",
      isKeyboard: false,
      get magnifyOpen() { return magnifyOpen; },
      containerElement: documentSurface,
      nativeInkSurface: () => magnifyOpen ? padSurface : documentSurface,
      getNativeInkStrokes: () => [],
      getNativeMagnifyStrokes: () => [],
    };
    const native = new Write2Native();
    native.attach(workspace as never);
    vi.advanceTimersByTime(220);
    expect(attachInkBox).toHaveBeenLastCalledWith(20, 100, 620, 620);

    magnifyOpen = true;
    native.hooks().onWorkspaceLayout?.();
    vi.advanceTimersByTime(599);
    expect(attachInkBox).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);

    expect(detachInkBox).toHaveBeenCalledOnce();
    expect(attachInkBox).toHaveBeenLastCalledWith(0, 0, window.innerWidth, window.innerHeight);
    expect(setWritingBounds).toHaveBeenLastCalledWith(0, 540, 674, 840);
  });

  it("attaches the magnify daemon even when Insert Space was selected underneath", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const attachInkBox = vi.fn();
    const setWritingBounds = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setPenType: vi.fn(), skipWakeRefresh: vi.fn(), attachInkBox,
        setInkStyle: vi.fn(), setInkEnabled: vi.fn(), flushInk: vi.fn(),
        setWritingBounds, setWritingExclusion: vi.fn(), detachInkBox: vi.fn(),
        clearContent: vi.fn(), renderInk: vi.fn(), snapshotContent: vi.fn(),
        snapshotContentPartial: vi.fn(),
      },
    });
    const pad = document.createElement("canvas");
    Object.defineProperty(pad, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 540, right: 674, bottom: 840 }),
    });
    const workspace = {
      currentTool: "insert",
      isKeyboard: false,
      magnifyOpen: true,
      containerElement: document.createElement("div"),
      nativeInkSurface: () => pad,
      getNativeMagnifyStrokes: () => [],
    };
    const native = new Write2Native();
    native.attach(workspace as never);
    vi.advanceTimersByTime(420);

    expect(attachInkBox).toHaveBeenCalledWith(0, 0, window.innerWidth, window.innerHeight);
    expect(setWritingBounds).toHaveBeenLastCalledWith(0, 540, 674, 840);
  });

  it("keeps the attach-time wake refresh for an inset ruled workspace", () => {
    vi.useFakeTimers();
    const attachInkBox = vi.fn();
    const skipWakeRefresh = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setPenType: vi.fn(), skipWakeRefresh, attachInkBox,
        setInkStyle: vi.fn(), setInkEnabled: vi.fn(),
        setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(),
        clearContent: vi.fn(), snapshotContent: vi.fn(),
      },
    });
    const surface = document.createElement("div");
    Object.defineProperty(surface, "getBoundingClientRect", {
      value: () => ({
        left: 12, top: 18, right: window.innerWidth - 12, bottom: window.innerHeight - 18,
      }),
    });
    const native = new Write2Native();
    native.attach({
      currentTool: "write",
      isKeyboard: false,
      magnifyOpen: false,
      containerElement: surface,
      getNativeInkStrokes: () => [],
    } as never);
    vi.advanceTimersByTime(220);

    expect(attachInkBox).toHaveBeenCalledWith(
      12, 18, window.innerWidth - 12, window.innerHeight - 18
    );
    expect(skipWakeRefresh).not.toHaveBeenCalled();
  });

  it("restarts a warming document attach when magnify becomes active", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const attachInkBox = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setPenType: vi.fn(), skipWakeRefresh: vi.fn(), attachInkBox,
        setInkStyle: vi.fn(), setInkEnabled: vi.fn(), flushInk: vi.fn(),
        setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(), detachInkBox: vi.fn(),
        clearContent: vi.fn(), renderInk: vi.fn(), snapshotContent: vi.fn(),
        snapshotContentPartial: vi.fn(),
      },
    });
    const documentSurface = document.createElement("div");
    const padSurface = document.createElement("canvas");
    Object.defineProperty(documentSurface, "getBoundingClientRect", {
      value: () => ({ left: 20, top: 100, right: 620, bottom: 620 }),
    });
    Object.defineProperty(padSurface, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 540, right: 674, bottom: 840 }),
    });
    let magnifyOpen = false;
    const workspace = {
      currentTool: "write", isKeyboard: false,
      get magnifyOpen() { return magnifyOpen; },
      containerElement: documentSurface,
      nativeInkSurface: () => magnifyOpen ? padSurface : documentSurface,
      getNativeInkStrokes: () => [], getNativeMagnifyStrokes: () => [],
    };
    const native = new Write2Native();
    native.attach(workspace as never);
    magnifyOpen = true;
    native.hooks().onWorkspaceLayout?.();
    vi.advanceTimersByTime(420);

    expect(attachInkBox).toHaveBeenCalledOnce();
    expect(attachInkBox).toHaveBeenCalledWith(0, 0, window.innerWidth, window.innerHeight);
  });

  it("hands upper-target gestures to the WebView and restores the full-screen daemon", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const setInkEnabled = vi.fn();
    const flushInk = vi.fn();
    const detachInkBox = vi.fn();
    const attachInkBox = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: {
        setInkEnabled, flushInk, detachInkBox, attachInkBox,
        setPenType: vi.fn(), skipWakeRefresh: vi.fn(), setInkStyle: vi.fn(),
        setWritingBounds: vi.fn(), setWritingExclusion: vi.fn(), clearContent: vi.fn(),
        renderInk: vi.fn(), snapshotContent: vi.fn(), snapshotContentPartial: vi.fn(),
      },
    });
    const pad = document.createElement("canvas");
    Object.defineProperty(pad, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 540, right: 674, bottom: 840 }),
    });
    const workspace = {
      currentTool: "write",
      isKeyboard: false,
      magnifyOpen: true,
      containerElement: document.createElement("div"),
      nativeInkSurface: () => pad,
      getNativeMagnifyStrokes: () => [],
    };
    const native = new Write2Native();
    Object.assign(native, { ws: workspace, attached: true, dpr: 1 });

    native.hooks().onWorkspaceMagnifyTargeting?.(true);
    expect(setInkEnabled).toHaveBeenCalledWith(false);
    expect(flushInk).toHaveBeenCalledOnce();
    expect(detachInkBox).toHaveBeenCalledOnce();

    native.hooks().onWorkspaceMagnifyTargeting?.(false);
    vi.advanceTimersByTime(600);
    expect(attachInkBox).toHaveBeenLastCalledWith(0, 0, window.innerWidth, window.innerHeight);
  });

  it("flushes pending daemon vectors before a model action", () => {
    const setInkEnabled = vi.fn();
    const flushInk = vi.fn();
    Object.defineProperty(globalThis, "Bridge", {
      configurable: true,
      value: { setInkEnabled, flushInk },
    });
    const native = new Write2Native();
    Object.assign(native, {
      ws: { currentTool: "write", isKeyboard: false },
      attached: true,
    });
    const action = vi.fn();

    native.hooks().beforeWorkspaceAction?.(action);
    expect(setInkEnabled).toHaveBeenCalledWith(false);
    expect(flushInk).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();

    native.onNativeFlushed();
    expect(action).toHaveBeenCalledOnce();
  });
});

describe('scribble native reconciliation', () => {
  it('unions erase bounds once at idle and never reattaches the daemon', () => {
    vi.useFakeTimers();
    const bridge={renderInk:vi.fn(),setInkEnabled:vi.fn(),snapshotContent:vi.fn(),snapshotContentPartial:vi.fn(),attachInkBox:vi.fn()};
    Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
    const surface=document.createElement('div');
    const native=new Write2Native();
    const reconcileNativeCommand=vi.fn(() => {
      // Real PenWorkspace.relayout -> render emits this hook while a silent
      // native erase is being reconciled. It must not schedule a second bake.
      native.hooks().onWorkspaceLayout?.();
    });
    Object.assign(native,{ws:{containerElement:surface,getNativeInkStrokes:()=>[],reconcileNativeCommand,
      applyNativeWriteStroke:vi.fn().mockReturnValue({rect:{x:10,y:20,w:80,h:60},indices:[0]})},attached:true,dpr:2,boxL:0,boxT:0,boxR:1000,boxB:1500,boxW:1000,boxH:1500});
    native.onNoteStrokes([[[10,20,.5]],[[20,30,.5]]]);
    expect(bridge.snapshotContentPartial).not.toHaveBeenCalled();
    vi.advanceTimersByTime(31);
    expect(bridge.snapshotContentPartial).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reconcileNativeCommand).toHaveBeenCalledOnce();
    expect(bridge.snapshotContentPartial).toHaveBeenCalledOnce();
    expect(bridge.snapshotContentPartial).toHaveBeenCalledWith(0,0,1000,1500,20,40,180,160);
    expect(bridge.snapshotContent).not.toHaveBeenCalled();
    expect(bridge.attachInkBox).not.toHaveBeenCalled();
    expect(JSON.parse(bridge.renderInk.mock.calls[0][0]).eraseRect).toEqual([20,40,180,160]);
    vi.advanceTimersByTime(500);
    expect(bridge.renderInk).toHaveBeenCalledOnce();
    expect(bridge.snapshotContentPartial).toHaveBeenCalledOnce();
    expect(bridge.snapshotContent).not.toHaveBeenCalled();
    delete (globalThis as any).Bridge; vi.useRealTimers();
  });
});


describe('native selection pen',()=>{
  it.each(['select','erase'] as const)('switches %s lasso to spaced native ink and restores the writing pen without reconnecting',(tool)=>{
    const bridge={setPenType:vi.fn(),setInkStyle:vi.fn(),setWritingBounds:vi.fn(),setWritingExclusion:vi.fn(),attachInkBox:vi.fn(),detachInkBoxForWeb:vi.fn()};
    Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
    const surface=document.createElement('div');
    const ws={currentTool:tool as string,usesNativeSelectionPen:true,containerElement:surface,getInkStyle:()=>({width:3,color:'#000000'}),getNativeInkStrokes:()=>[]};
    const native=new Write2Native();Object.assign(native,{ws,attached:true,dpr:2,boxW:1000,boxH:1500});
    native.hooks().onWorkspaceTool?.(tool,false);
    expect(bridge.setPenType).toHaveBeenLastCalledWith('selection');
    expect(bridge.setInkStyle).toHaveBeenLastCalledWith(3,'#000000');
    ws.currentTool='write';ws.usesNativeSelectionPen=false;native.hooks().onWorkspaceTool?.('write',false);
    expect(bridge.setPenType).toHaveBeenLastCalledWith('ballpoint');
    expect(bridge.setInkStyle).toHaveBeenLastCalledWith(6,'#000000');
    expect(bridge.attachInkBox).not.toHaveBeenCalled();expect(bridge.detachInkBoxForWeb).not.toHaveBeenCalled();
    delete (globalThis as any).Bridge;
  });
  it.each(['select','erase'] as const)('routes %s lasso vectors as gestures and clears only their changed bounds',(tool)=>{
    vi.useFakeTimers();
    const bridge={setInkEnabled:vi.fn(),renderInk:vi.fn(),snapshotContentPartial:vi.fn(),snapshotContent:vi.fn()};
    Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
    const surface=document.createElement('div');
    const applyNativeStroke=vi.fn(),applyNativeWriteStroke=vi.fn();
    const native=new Write2Native();
    Object.assign(native,{ws:{currentTool:tool,usesNativeSelectionPen:true,containerElement:surface,getNativeInkStrokes:()=>[],applyNativeStroke,applyNativeWriteStroke},attached:true,dpr:2,boxL:0,boxT:0,boxR:1000,boxB:1500,boxW:1000,boxH:1500});
    native.onNoteStrokes([[[100,100,.5],[200,100,.5],[200,200,.5],[100,200,.5],[100,100,.5]]]);
    expect(applyNativeStroke).toHaveBeenCalledOnce();expect(applyNativeWriteStroke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(32);
    expect(bridge.snapshotContentPartial).toHaveBeenCalledWith(0,0,1000,1500,88,88,212,212);
    expect(bridge.snapshotContent).not.toHaveBeenCalled();
    const replay=JSON.parse(bridge.renderInk.mock.calls[0][0]);expect(replay.s).toEqual([]);
    if (tool === 'erase') expect(replay.eraseRect).toEqual([88,88,212,212]);
    else expect(replay).not.toHaveProperty('eraseRect');
    delete (globalThis as any).Bridge;vi.useRealTimers();
  });
});

it('native selection refresh includes both old and new word positions after a move',()=>{
  vi.useFakeTimers();
  const bridge={setInkEnabled:vi.fn(),renderInk:vi.fn(),snapshotContentPartial:vi.fn(),snapshotContent:vi.fn()};
  Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
  const surface=document.createElement('div');let moved=false;
  const getNativeInkStrokes=()=>[{width:2,color:'#000000',selected:true,pts:[{x:moved?300:10,y:moved?200:20,pressure:.5}]}];
  const native=new Write2Native();Object.assign(native,{ws:{currentTool:'select',containerElement:surface,getNativeInkStrokes,applyNativeStroke:()=>{moved=true}},attached:true,dpr:1,boxL:0,boxT:0,boxR:500,boxB:750,boxW:500,boxH:750});
  native.onNoteStrokes([[[50,50,.5],[100,100,.5]]]);vi.advanceTimersByTime(32);
  expect(bridge.snapshotContentPartial).toHaveBeenCalledWith(0,0,500,750,4,14,306,206);
  expect(bridge.snapshotContent).not.toHaveBeenCalled();
  delete (globalThis as any).Bridge;vi.useRealTimers();
});


it('keeps scribble ghost cleanup regional even when a full layout sync joins it, then clears the flag', () => {
  vi.useFakeTimers();
  const renderInk=vi.fn(),snapshotContent=vi.fn(),snapshotContentPartial=vi.fn();
  Object.defineProperty(globalThis,'Bridge',{configurable:true,value:{renderInk,snapshotContent,snapshotContentPartial,setInkEnabled:vi.fn()}});
  const surface=document.createElement('div');
  const native=new Write2Native();
  Object.assign(native,{ws:{containerElement:surface,getNativeInkStrokes:()=>[]},attached:true,
    dpr:2,boxL:0,boxT:0,boxR:1000,boxB:1400,boxW:1000,boxH:1400});
  native.syncNative({l:200,t:500,r:300,b:600},true,true);
  native.syncNative(); // A layout reconciliation must not enlarge the GC16 cleanup.
  vi.advanceTimersByTime(32);
  expect(snapshotContent).toHaveBeenCalledOnce();
  expect(JSON.parse(renderInk.mock.calls[0][0])).toMatchObject({defer:1,eraseRect:[400,1000,600,1200]});
  native.syncNative({l:10,t:20,r:30,b:40},true); // Lasso/shape sync is not a scribble erase.
  vi.advanceTimersByTime(32);
  expect(JSON.parse(renderInk.mock.calls[1][0])).not.toHaveProperty('eraseRect');
  expect(snapshotContentPartial).toHaveBeenCalledWith(0,0,1000,1400,20,40,60,80);
  native.detach();vi.useRealTimers();
});

it('brush repaint carries pressure and selects felt without a daemon reconnect',()=>{
  const bridge={setPenType:vi.fn(),setInkStyle:vi.fn(),setWritingBounds:vi.fn(),setWritingExclusion:vi.fn(),renderInk:vi.fn(),attachInkBox:vi.fn(),detachInkBoxForWeb:vi.fn()};
  Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
  const surface=document.createElement('div');
  const ws={currentTool:'write',nativePenType:'felt',usesNativeSelectionPen:false,containerElement:surface,getInkStyle:()=>({width:4,color:'#1838D8'}),getNativeInkStrokes:()=>[{width:4,color:'#1838D8',variableWidth:true,pts:[{x:10,y:20,pressure:.2},{x:30,y:40,pressure:.9}]}]};
  const native=new Write2Native();Object.assign(native,{ws,attached:true,dpr:2,boxW:1000,boxH:1500});
  native.hooks().onWorkspaceTool?.('write',false);native.redrawInk(undefined,true);
  expect(bridge.setPenType).toHaveBeenLastCalledWith('felt');
  const replay=JSON.parse(bridge.renderInk.mock.calls[bridge.renderInk.mock.calls.length-1][0]);
  expect(replay.s[0]).toMatchObject({vw:1,c:'#1838D8',w:8,p:[[20,40,.2],[60,80,.9]]});
  expect(bridge.attachInkBox).not.toHaveBeenCalled();expect(bridge.detachInkBoxForWeb).not.toHaveBeenCalled();
  delete (globalThis as any).Bridge;
});
it('native checkbox batches suppress nested hooks and update only the checkbox footprint',()=>{
  vi.useFakeTimers();
  const bridge={setInkEnabled:vi.fn(),renderInk:vi.fn(),snapshotContentPartial:vi.fn(),snapshotContent:vi.fn()};
  Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
  const surface=document.createElement('div');
  const native=new Write2Native();
  const gestures:Set<string>[]=[];
  const snapshots:ReadonlySet<string>[]=[],snapshotScribbleInkTargets=vi.fn(()=>new Set(['old-ink']));
  const ws={currentTool:'write',containerElement:surface,magnifyOpen:false,getNativeInkStrokes:()=>[],snapshotScribbleInkTargets,applyNativeWriteStroke:(_points:unknown,_render:boolean,batch:Set<string>,existing:ReadonlySet<string>)=>{
    gestures.push(batch);
    snapshots.push(existing);
    native.hooks().onWorkspaceLayout?.();
    native.hooks().onWorkspaceContentRegion?.({l:260,t:112,r:308,b:168});
    return {kind:'widget',rect:{x:260,y:112,w:48,h:56}};
  }};
  Object.assign(native,{ws,attached:true,dpr:1,boxL:0,boxT:0,boxR:320,boxB:700,boxW:320,boxH:700});
  native.onNoteStrokes([[[280,130,.5]],[[290,140,.5]]]);vi.advanceTimersByTime(32);
  expect(gestures).toHaveLength(2);expect(gestures[0]).toBe(gestures[1]);
  expect(snapshotScribbleInkTargets).toHaveBeenCalledOnce();expect(snapshots[0]).toBe(snapshots[1]);
  expect(bridge.snapshotContentPartial).toHaveBeenCalledOnce();
  expect(bridge.snapshotContentPartial).toHaveBeenCalledWith(0,0,320,700,260,112,308,168);
  expect(bridge.snapshotContent).not.toHaveBeenCalled();
  native.onNoteStrokes([[[280,130,.5]]]);
  expect(gestures[2]).not.toBe(gestures[0]);
  expect(snapshots[2]).not.toBe(snapshots[0]);
  delete (globalThis as any).Bridge;vi.useRealTimers();
});

it('refreshes old and new typed-word bounds when a native selection moves no ink',()=>{
  vi.useFakeTimers();
  const bridge={setInkEnabled:vi.fn(),renderInk:vi.fn(),snapshotContentPartial:vi.fn(),snapshotContent:vi.fn()};
  Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
  const surface=document.createElement('div');let moved=false;
  const native=new Write2Native();
  Object.assign(native,{ws:{currentTool:'select',containerElement:surface,getNativeInkStrokes:()=>[],
    getSelectedBlockBounds:()=>({x:moved?300:10,y:moved?200:20,width:80,height:44}),
    applyNativeStroke:()=>{moved=true}},attached:true,dpr:1,boxL:0,boxT:0,boxR:500,boxB:750,boxW:500,boxH:750});
  native.onNoteStrokes([[[50,50,.5],[100,100,.5]]]);vi.advanceTimersByTime(32);
  expect(bridge.snapshotContentPartial).toHaveBeenCalledWith(0,0,500,750,4,14,386,250);
  expect(bridge.snapshotContent).not.toHaveBeenCalled();
  expect(JSON.parse(bridge.renderInk.mock.calls[0][0]).s).toEqual([]);
  delete (globalThis as any).Bridge;vi.useRealTimers();
});

it('hands a completed selection batch to non-ink movement without losing its pending toolbar command',()=>{
  vi.useFakeTimers();
  const bridge={setInkEnabled:vi.fn(),flushInk:vi.fn(),setInteractivePanel:vi.fn(),detachInkBoxForWeb:vi.fn(),
    detachInkBoxCleared:vi.fn(),setErasing:vi.fn(),setWritingBounds:vi.fn(),setWritingExclusion:vi.fn(),
    renderInk:vi.fn(),snapshotContentPartial:vi.fn(),snapshotContent:vi.fn()};
  Object.defineProperty(globalThis,'Bridge',{configurable:true,value:bridge});
  const surface=document.createElement('div');
  const ws={currentTool:'select',usesNativeSelectionPen:true,containerElement:surface,getNativeInkStrokes:()=>[],
    applyNativeStroke:vi.fn(()=>{ws.usesNativeSelectionPen=false}),applyNativeWriteStroke:vi.fn()};
  const native=new Write2Native();Object.assign(native,{ws,attached:true,dpr:1,boxL:0,boxT:0,boxR:500,boxB:750,boxW:500,boxH:750});
  const command=vi.fn();native.hooks().beforeWorkspaceAction!(command);
  native.onNoteStrokes([[[40,40,.5],[100,100,.5]],[[50,50,.5],[110,110,.5]]]);
  expect(ws.applyNativeStroke).toHaveBeenCalledTimes(2);expect(ws.applyNativeWriteStroke).not.toHaveBeenCalled();
  expect(bridge.detachInkBoxForWeb).toHaveBeenCalledOnce();expect(bridge.detachInkBoxCleared).not.toHaveBeenCalled();
  expect(bridge.setInteractivePanel).toHaveBeenLastCalledWith(true);
  native.onNativeFlushed();native.onNativeFlushed();expect(command).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(bridge.setInkEnabled).not.toHaveBeenCalledWith(true);
  expect(bridge.snapshotContentPartial).not.toHaveBeenCalled();expect(bridge.renderInk).not.toHaveBeenCalled();
  delete (globalThis as any).Bridge;vi.useRealTimers();
});

it('replays selected handwriting with solid original strokes rather than the lasso dash flag',()=>{
  const renderInk=vi.fn();Object.defineProperty(globalThis,'Bridge',{configurable:true,value:{renderInk}});
  const surface=document.createElement('div');
  const native=new Write2Native();Object.assign(native,{ws:{magnifyOpen:false,containerElement:surface,
    getNativeInkStrokes:()=>[{selected:true,width:3,color:'#000000',pts:[{x:10,y:20},{x:30,y:40}]}]},
    attached:true,dpr:1,boxL:0,boxT:0,boxR:500,boxB:750,boxW:500,boxH:750});
  native.redrawInk();
  const strokes=JSON.parse(renderInk.mock.calls[0][0]).s;
  expect(strokes).toEqual([{w:3,c:'#000000',p:[[10,20],[30,40]]}]);
  delete (globalThis as any).Bridge;
});


it('idle native save persists only the delivered model without invoking flush or presentation',async()=>{
 const calls:Record<string,ReturnType<typeof vi.fn>>={};
 for(const name of ['flushInk','setInkEnabled','attachInkBox','detachInkBox','snapshotContent','renderInk'])calls[name]=vi.fn();
 Object.defineProperty(globalThis,'Bridge',{configurable:true,value:calls});
 const saveDeliveredNativeDraft=vi.fn(async()=>{}),native=new Write2Native();
 Object.assign(native,{ws:{saveDeliveredNativeDraft},attached:true});
 native.onNativeSaveRequested();await Promise.resolve();expect(saveDeliveredNativeDraft).toHaveBeenCalledOnce();
 for(const fn of Object.values(calls))expect(fn).not.toHaveBeenCalled();
 Object.assign(native,{ws:null});native.onNativeSaveRequested();expect(saveDeliveredNativeDraft).toHaveBeenCalledOnce();
});
