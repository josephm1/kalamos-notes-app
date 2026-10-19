import { traceInkWorkspace, traceInkEvent } from "./diagnostics";
// Native ink-daemon integration for the core-managed ruled workspace. This is
// the canonical implementation used by both Write and Notes Planning; app
// overlays must not carry their own attach/flush/snapshot implementations.
//
// Model: the daemon normally owns the ruled workspace. In magnify mode it owns
// ONE full-screen snapshot, exactly like Notes Planning: writing bounds admit
// ink only in the lower lane, while upper-document pen input passes through to
// the live WebView. Targeting briefly hides the native surface, then re-bakes
// and re-attaches the same full-screen layer when the pen returns to writing.
// Outside magnify, switching to erase/spacing/lines/keyboard detaches it completely;
// magnify itself overrides the underlying tool and always owns the lower writing lane.

import type { PenWorkspace, Tool } from "../vanilla/penWorkspace";
import type { WorkspaceNativeHooks } from "../vanilla/main";
import { boundsOfPoints, type InkPoint } from "../ink/types";

type CssRect = { l: number; t: number; r: number; b: number };

// A geometry-changing chrome transition exposes WebView bands that were previously covered by the
// opaque SurfaceView. Bigme must see at least one settled WebView presentation while FAST policy is
// still active; immediately calling attach() restores COMIC before the old surface is destroyed.
// Keep this shorter than the 300 ms scoped-handler release window in disconnect().
const WEB_GEOMETRY_PRESENT_MS = 180;

function hasBridge(): boolean {
  return typeof Bridge !== "undefined";
}

export class Write2Native {
  private ws: PenWorkspace | null = null;
  private dpr = 1;
  private boxL = 0; // device px in the WebView/window
  private boxT = 0;
  private boxR = 0;
  private boxB = 0;
  private boxW = 0; // device px
  private boxH = 0;
  private attachTimer: number | undefined;
  private syncTimer: number | undefined;
  private syncDeadline: number | undefined;
  private enableTimer: number | undefined;
  private afterFlush: (() => void) | null = null;
  private fullDirty = false;
  private dirty: CssRect | null = null;
  private eraseDirty: CssRect | null = null;
  private attached = false;
  private pageTurnPending = false;
  private pageTurnChrome = false;
  private pageTurnSettling = false;
  private warming = false;
  private attachedMagnify = false;
  private targeting = false;
  private targetingTimer: number | undefined;
  private toolbarDragging = false;
  private pageGestureActive = false;
  private dialogOpen = false;
  private nativeBatchLayoutOwned = false;
  private webChromeHandoff = false;
  private chromeDirty: CssRect | null = null;
  private resumeDirty: CssRect | null = null;
  private lastChrome: CssRect | null = null;
  private resumeBox: number[] | null = null;

  private magnifyEraserWeb = false;
  private get webChromeActive(): boolean { return this.toolbarDragging || this.pageGestureActive || this.dialogOpen || this.magnifyEraserWeb; }
  private webChromeTimer: number | undefined;
  private geometryTimer: number | undefined;
  private magnifyIdleTimer: number | undefined;
  private snapshotTimer: number | undefined;
  private revealTimer: number | undefined;
  private handlerReleaseTimer: number | undefined;
  private magnifyErasing = false;
  private surfaceEl: HTMLElement | null = null;
  // Track the panel policy locally. Tool and ResizeObserver callbacks often
  // arrive in pairs; repeating the same native policy change needlessly
  // schedules another e-ink mode transition on the UI thread.
  // null means this workspace has not established the host policy yet (for
  // example it may have opened from the fast library view). The first attach
  // must therefore restore ink mode once; later duplicate callbacks are safe
  // to suppress.
  private interactiveWeb: boolean | null = null;

  private setNativeWebHandoff(ws: PenWorkspace | null, active: boolean): void {
    // Keep native orchestration tolerant of older generated workspace bundles during a rolling app
    // update. New bundles expose this method; Bigme and older mocks simply keep their old behavior.
    const candidate = ws as (PenWorkspace & { setNativeWebHandoff?: (value: boolean) => void }) | null;
    candidate?.setNativeWebHandoff?.(active);
  }

  hooks(): WorkspaceNativeHooks {
    return {
      native: true,
      onWorkspaceOpen: (ws) => this.attach(ws),
      onWorkspaceClose: () => this.detach(),
      onWorkspaceLayout: () => { if (!this.nativeBatchLayoutOwned) this.onLayout(); },
      onWorkspaceContentRegion: rect => { if (!this.nativeBatchLayoutOwned) this.syncNative(rect, true); },
      onWorkspaceTool: (tool, keyboard) => this.onTool(tool, keyboard),
      beforeWorkspaceAction: (action) => this.beforeWorkspaceAction(action),
      onWorkspaceOverlay: (rect) => {
        if (this.dialogOpen && rect) this.chromeDirty = this.unionRect(this.chromeDirty, rect);
        this.exclusionRect = rect;
        this.updateWriteProtection();
      },
      onWorkspaceMagnifyTargeting: (active) => this.setMagnifyTargeting(active),
      onWorkspaceMagnifyErasing: (active) => this.setMagnifyErasing(active),
      onWorkspaceToolbarDrag: (active) => {
        this.toolbarDragging = active;
        this.setWebChromeHandoff(this.webChromeActive);
      },
      onWorkspacePageGesture: (active) => {
        this.pageGestureActive = active;
        this.setWebChromeHandoff(this.webChromeActive);
      },
      onWorkspaceDialog: (active) => {
        if (this.dialogOpen !== active) console.log(`DIAG ruledInkDialog ${active ? "web" : "native"}`);
        if (active && this.exclusionRect) this.chromeDirty = this.unionRect(this.chromeDirty, this.exclusionRect);
        this.dialogOpen = active;
        if (!active) this.ws?.setNativeDialogHandoff?.(false);
        this.setWebChromeHandoff(this.webChromeActive);
      },
      onWorkspaceToolbarLayout: (previous, current) =>
        this.syncToolbarRegion(previous, current),
      onWorkspaceInkStyle: (color, widthCss) => this.setInkStyle(color, widthCss),
    };
  }

  private compositionSurface(ws: PenWorkspace): HTMLElement {
    return typeof ws.nativeCompositionSurface === "function"
      ? ws.nativeCompositionSurface() : this.writingSurface(ws);
  }

  /** Paper coordinates remain model-local even when the native bitmap includes surrounding chrome. */
  private paperOffset(ws: PenWorkspace): { x: number; y: number } {
    if (this.compositionSurface(ws) === this.writingSurface(ws)) return { x: 0, y: 0 };
    const r = ws.containerElement.getBoundingClientRect();
    return { x: r.left - this.boxL / this.dpr, y: r.top - this.boxT / this.dpr };
  }

  private writingSurface(ws: PenWorkspace): HTMLElement {
    return typeof ws.nativeInkSurface === "function" ? ws.nativeInkSurface() : ws.containerElement;
  }

  private usesSelectionPen(ws: PenWorkspace | null = this.ws): boolean {
    return !!ws && (ws.usesNativeSelectionPen ?? ws.currentTool === "select");
  }

  private wantsDaemon(ws: PenWorkspace | null = this.ws): ws is PenWorkspace {
    return (
      !this.webChromeActive &&
      !!ws &&
      (ws.magnifyOpen || ((ws.currentTool === "write" || this.usesSelectionPen(ws)) && !ws.isKeyboard))
    );
  }

  private inkStyle(ws: PenWorkspace | null = this.ws): { color: string; width: number } {
    const candidate = ws as (PenWorkspace & {
      getInkStyle?: () => { color: string; width: number };
    }) | null;
    if (this.usesSelectionPen(ws) && !ws?.magnifyOpen) return {color:"#000000",width:1.5};
    const style = candidate?.getInkStyle?.();
    return {
      color: style?.color || "#000000",
      width: typeof style?.width === "number" && style.width > 0 ? style.width : 2.4,
    };
  }

  private setInkStyle(color: string, widthCss: number): void {
    if (!this.attached || !hasBridge()) return;
    try {
      Bridge.setInkStyle(Math.max(2, Math.round(widthCss * this.dpr)), color);
    } catch (e) {
      console.warn("[w2n] live ink style failed", e);
    }
  }

  attach(ws: PenWorkspace, resumeDirty: CssRect | null = null) {
    const previousBox = [this.boxL, this.boxT, this.boxR, this.boxB];
    const retainPage = this.pageTurnPending && this.attached;
    this.pageTurnPending = false;
    this.ws = ws;
    traceInkWorkspace(ws, "js.workspaceAttached");
    if (!hasBridge()) return;
    if (this.dialogOpen) { this.setWebChromeHandoff(true); return; }
    window.clearTimeout(this.handlerReleaseTimer);
    // Returning from Insert/Lines/Erase leaves the panel in fast
    // WebView mode. Restore the normal writing policy once before reconnecting
    // the daemon; repeated layout callbacks must not restart that transition.
    if (this.interactiveWeb !== false && typeof Bridge.setInteractivePanel === "function") {
      Bridge.setInteractivePanel(false);
      this.interactiveWeb = false;
    }
    this.warming = true;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    const surface = this.compositionSurface(ws);
    this.surfaceEl = surface;
    this.attachedMagnify = ws.magnifyOpen;
    const wr = surface.getBoundingClientRect();
    // CSS layout can end on a fractional device pixel. On the 1264 px Bigme
    // panel, ceil(right * dpr) previously created a 1265 px daemon buffer and
    // a physical layout starting at x=-1. Keep the native box inside the real
    // device-pixel viewport so canvas pixels and invalidation rectangles share
    // the same coordinate space.
    const panelW = Math.max(1, Math.round(window.innerWidth * dpr));
    const panelH = Math.max(1, Math.round(window.innerHeight * dpr));
    if (ws.magnifyOpen) {
      // Keep one stable HWC layer over the whole screen. Moving the target now changes only
      // bounds/snapshot pixels; it never destroys and recreates a small SurfaceView.
      this.boxL = 0;
      this.boxT = 0;
      this.boxR = panelW;
      this.boxB = panelH;
    } else {
      this.boxL = Math.min(panelW - 1, Math.max(0, Math.floor(wr.left * dpr)));
      this.boxT = Math.min(panelH - 1, Math.max(0, Math.floor(wr.top * dpr)));
      this.boxR = Math.min(panelW, Math.max(this.boxL + 1, Math.ceil(wr.right * dpr)));
      this.boxB = Math.min(panelH, Math.max(this.boxT + 1, Math.ceil(wr.bottom * dpr)));
    }
    this.boxW = Math.max(1, this.boxR - this.boxL);
    this.boxH = Math.max(1, this.boxB - this.boxT);
    const nextBox = [this.boxL, this.boxT, this.boxR, this.boxB];
    if (retainPage && !ws.magnifyOpen && previousBox.every((value, index) => value === nextBox[index])) {
      // Device-confirmed fast page turns (2026-10-04; INK-WRITING-GUIDE.md):
      // keep the same controller/buffer, as KOReader does. Reattaching here
      // adds a cold wake and can expose a temporarily empty daemon Canvas.
      // Checkpoint MUST drain/save the old sheet before this ownership transfer.
      // Replace vectors + captured paper together; matching geometry is required
      // so the old controller matrix and buffer still describe this surface.
      window._noteSketch = { w: this.boxW, h: this.boxH };
      window._inkHandler = this;
      this.warming = false;
      this.pageTurnChrome = true;
      this.pageTurnSettling = true;
      this.updateWriteProtection();
      // Surface reuse must also transfer pen semantics: the outgoing page
      // may have had Lasso active while the new sheet opens in ordinary Write.
      if (typeof Bridge.setPenType === "function") Bridge.setPenType(this.usesSelectionPen(ws) ? "selection" : (ws.nativePenType ?? "ballpoint"));
      const style = this.inkStyle(ws);
      this.setInkStyle(style.color, style.width);
      this.syncNative(this.workspaceRegion(), true);
      console.log("DIAG ruledPageTurn reused controller");
      return;
    }
    if (retainPage) {
      // A changed surface cannot inherit the old controller's geometry.
      this.disconnect("hard");
      this.ws = ws;
    traceInkWorkspace(ws, "js.workspaceAttached");
      this.surfaceEl = surface;
      this.warming = true;
    }
    const canResume = !!resumeDirty && !!this.resumeBox &&
      this.resumeBox.every((value, index) => value === nextBox[index]) &&
      typeof Bridge.resumeInkBox === "function" && !ws.magnifyOpen;
    this.resumeBox = null;
    const originX = this.boxL / dpr, originY = this.boxT / dpr;
    this.resumeDirty = canResume ? {
      l: resumeDirty!.l - originX, t: resumeDirty!.t - originY,
      r: resumeDirty!.r - originX, b: resumeDirty!.b - originY,
    } : null;
    window._noteSketch = { w: this.boxW, h: this.boxH };
    window._inkHandler = this;

    // Pre-bake the WebView while InkSurfaceView is still GONE. A newly-created magnifier canvas
    // needs a committed WebView frame before Android captures it; an immediate capture sees the
    // canvas' initial white backing store and makes Ink mode look blank. Two compositor beats plus
    // InkManager's own 120ms capture delay still complete well before the surface is attached.
    const magnify = ws.magnifyOpen;
    window.clearTimeout(this.snapshotTimer);
    const preBake = () => {
      if (this.ws !== ws || this.targeting || this.webChromeActive || !hasBridge()) return;
      try {
        // Stage vectors without presenting or using the daemon Canvas. The
        // content capture can now compose a complete first frame, rather than
        // publishing typed paper alone before controller-ready replays ink.
        if (typeof ws.getNativeInkStrokes === "function") this.redrawInk(undefined, true);
        if (this.resumeDirty) {
          const r = this.devRect(this.resumeDirty);
          Bridge.snapshotContentPartial(this.boxL, this.boxT, this.boxR, this.boxB, r[0], r[1], r[2], r[3]);
        } else Bridge.snapshotContent(this.boxL, this.boxT, this.boxR, this.boxB);
      } catch (e) {
        console.warn("[w2n] pre-bake failed", e);
      }
    };
    if (magnify) {
      this.snapshotTimer = window.setTimeout(preBake, 140);
    } else {
      // Opening a direct Planning workspace replaces the old page and mounts
      // the ruled DOM in one JavaScript task. Capturing synchronously here can
      // therefore bake the previous legacy Markdown frame into the native
      // SurfaceView even though the new DOM already exists. Give the WebView
      // one presentation window first; InkManager then waits another 120 ms
      // in software-layer mode before drawing, still ahead of the 220 ms
      // daemon attach below.
      this.snapshotTimer = window.setTimeout(preBake, 64);
    }
    window.clearTimeout(this.attachTimer);
    this.attachTimer = window.setTimeout(() => {
      if (
        this.ws !== ws ||
        this.targeting ||
        this.webChromeActive ||
        !this.wantsDaemon(ws) ||
        !hasBridge()
      ) return;
      try {
        Bridge.setPenType(this.usesSelectionPen(ws) && !ws.magnifyOpen ? "selection" : (ws.nativePenType ?? "ballpoint"));
        if (typeof Bridge.setErasing === "function") Bridge.setErasing(this.magnifyErasing);
        Bridge.setInkEnabled(true);
        // Ruled workspaces are page editors even when app chrome leaves a narrow inset around the
        // writing surface. They need the controller's attach-time wake refresh: without it the
        // daemon can contain the complete restored page while the panel reveals only regions
        // touched by later pen invalidations. Small reader note boxes use a separate adapter and
        // retain their bounded-box refresh policy there.
        if (canResume) Bridge.resumeInkBox!(this.boxL, this.boxT, this.boxR, this.boxB);
        else Bridge.attachInkBox(this.boxL, this.boxT, this.boxR, this.boxB);
        const style = this.inkStyle(ws);
        Bridge.setInkStyle(Math.max(2, Math.round(style.width * dpr)), style.color);
      } catch (e) {
        console.warn("[w2n] attach failed", e);
      }
      this.attached = true;
      // Bounds are stateful on InkSurfaceView and are re-applied when the controller becomes ready.
      // Set them immediately so a full-screen attach never has an unbounded pen-input frame.
      this.updateWriteProtection();
      // Do not render here. attachInkBox() only queues the native operation;
      // HandwrittenClient may not have a Canvas yet. The shared, proven note-
      // box handshake calls renderNoteStrokes() after onInkControllerReady(true).
    }, magnify ? 420 : 220);
  }

  detach() {
    if (this.pageTurnPending) {
      this.ws = null;
      return;
    }
    this.chromeDirty = null;
    this.resumeDirty = null;
    this.lastChrome = null;
    this.dialogOpen = false;
    this.magnifyEraserWeb = false;
    this.toolbarDragging = false;
    this.pageGestureActive = false;
    this.webChromeHandoff = false;
    this.setNativeWebHandoff(this.ws, false);
    window.clearTimeout(this.webChromeTimer);
    window.clearTimeout(this.geometryTimer);
    this.geometryTimer = undefined;
    this.ws = null;
    this.suspend();
  }

  /** Bridge-only hard detach (app pause/close) — keeps the workspace reference. */
  suspend() {
    this.pageTurnPending = false;
    this.pageTurnChrome = false;
    this.resumeBox = null;
    this.chromeDirty = null;
    this.resumeDirty = null;
    this.toolbarDragging = false;
    this.pageGestureActive = false;
    this.webChromeHandoff = false;
    this.setNativeWebHandoff(this.ws, false);
    window.clearTimeout(this.webChromeTimer);
    this.disconnect("hard");
  }

  /** Called only after checkpoint drains/persists pen ink. Retire old DOM timers
   * before replacing its owner, but keep the physical page/controller connected.
   * This is a sheet transition, not a general shortcut for close or app pause. */
  preparePageTurn(): void {
    if (!this.attached || this.warming || this.webChromeActive || this.ws?.magnifyOpen || !this.wantsDaemon()) return;
    this.pageTurnPending = true;
    window.clearTimeout(this.syncTimer);
    this.syncDeadline = undefined;
    window.clearTimeout(this.enableTimer);
    window.clearTimeout(this.revealTimer);
    window.clearTimeout(this.snapshotTimer);
    window.clearTimeout(this.geometryTimer);
    this.geometryTimer = undefined;
    window.clearTimeout(this.webChromeTimer);
    this.resumeDirty = null;
    this.resumeBox = null;
    this.dirty = null;
    this.eraseDirty = null;
    this.fullDirty = false;
    Bridge.setInkEnabled(false);
  }

  cancelPageTurn(): void {
    if (!this.pageTurnPending) return;
    this.pageTurnPending = false;
    if (!this.ws) this.detach();
    else if (this.attached && hasBridge()) Bridge.setInkEnabled(true);
  }

  /**
   * Disconnect the daemon without conflating two very different exits:
   *
   * - hard: leaving/pausing the editor; clear persistent panel pixels.
   * - web: a transient tool handoff; preserve the visible frame, reveal the
   *   already-painted workspace DOM and enable its fast interactive policy.
   *
   * Using the hard path for Insert Space/Blank Lines painted a white GU16
   * frame immediately before hiding the SurfaceView. Because the WebView was
   * still transparent, the whole workspace then appeared blank until some
   * later system refresh. The dedicated web handoff performs no white frame.
   */
  private disconnect(mode: "hard" | "web") {
    this.pageTurnChrome = false;
    this.pageTurnSettling = false;
    window.clearTimeout(this.attachTimer);
    this.attachTimer = undefined;
    window.clearTimeout(this.handlerReleaseTimer);
    this.handlerReleaseTimer = undefined;
    const wasAttached = this.attached;
    this.attached = false;
    window.clearTimeout(this.syncTimer);
    this.syncDeadline = undefined;
    window.clearTimeout(this.enableTimer);
    window.clearTimeout(this.targetingTimer);
    window.clearTimeout(this.webChromeTimer);
    window.clearTimeout(this.geometryTimer);
    this.geometryTimer = undefined;
    window.clearTimeout(this.magnifyIdleTimer);
    window.clearTimeout(this.snapshotTimer);
    window.clearTimeout(this.revealTimer);
    this.revealTimer = undefined;
    this.dirty = null;
    this.eraseDirty = null;
    this.fullDirty = false;
    this.warming = false;
    this.targeting = false;
    this.magnifyErasing = false;
    this.afterFlush = null;
    this.surfaceEl = null;
    window._noteSketch = null;
    if (hasBridge()) {
      try {
        const webHandoff = mode === "web" && this.ws !== null;
        // A toolbar click and its resulting layout change can both request
        // Web mode. Changing the native mode only on the state edge avoids a
        // duplicate animation/default-mode cycle in the critical handoff.
        if (webHandoff) {
          if (!this.interactiveWeb && typeof Bridge.setInteractivePanel === "function") {
            Bridge.setInteractivePanel(true);
            this.interactiveWeb = true;
          }
        } else {
          // Hard exits always restore the default policy. This also repairs a
          // direct magnifier-targeting handoff that bypassed interactiveWeb.
          if (typeof Bridge.setInteractivePanel === "function") Bridge.setInteractivePanel(false);
          this.interactiveWeb = false;
        }
        if (wasAttached) {
          if (typeof Bridge.setErasing === "function") Bridge.setErasing(false);
          Bridge.setWritingBounds(0, 0, 0, 0);
          Bridge.setWritingExclusion(0, 0, 0, 0);
          if (webHandoff && typeof Bridge.detachInkBoxForWeb === "function") {
            // The workspace DOM was rendered before this callback. Preserve
            // that frame, remove the daemon surface without painting white,
            // and clear native retained state. Do not invalidate the whole
            // WebView: that was measurably slower than Write's proven path.
            Bridge.detachInkBoxForWeb();
          } else if (webHandoff) {
            // Compatibility with an older native shell. Its reader-oriented
            // detach is not ideal, but it preserves the visible frame.
            Bridge.detachInkBox();
            if (typeof Bridge.enterLibrary === "function") Bridge.enterLibrary();
          } else {
            // A ruled workspace is a complete editor, not a reader sticky
            // note. Its physical pixels must be cleared before disconnect so
            // a new Planning note cannot inherit the previous daemon buffer.
            if (typeof Bridge.detachInkBoxCleared === "function") Bridge.detachInkBoxCleared();
            else Bridge.detachInkBox();
          }
        } else if (webHandoff && typeof Bridge.showWebWorkspace === "function") {
          // A layout callback may request Web mode after the native surface
          // has already gone; still ensure the daemon layer remains hidden.
          Bridge.showWebWorkspace();
        }
      } catch (e) {
        console.warn("[w2n] detach failed", e);
      }
    }
    // detach() flushes its pending native batch asynchronously on the main
    // thread. Keep this handler installed until that flush has selected its
    // owner; clearing it synchronously lets the batch fall through to the
    // classic editor's global onStrokesBatch callback. A rapid reattach
    // cancels this release and continues using the same canonical handler.
    this.handlerReleaseTimer = window.setTimeout(() => {
      if (!this.attached && window._inkHandler === this) window._inkHandler = null;
    }, 300);
  }

  /** Re-attach after app resume while the workspace is still open. */
  resume() {
    // A stopped Android host retires native ownership synchronously, even if its WebView's
    // async pause checkpoint was delayed. Reconcile the adapter before deciding to skip attach.
    if (this.attached && hasBridge() && typeof Bridge.isInkSessionAttached === "function" &&
        !Bridge.isInkSessionAttached()) this.suspend();
    const ws = this.ws;
    if (this.dialogOpen) {
      ws?.setNativeDialogHandoff?.(true);
      this.setWebChromeHandoff(true);
      return;
    }
    if (!this.webChromeActive && this.wantsDaemon(ws) && !this.attached) {
      this.attach(ws);
    }
  }

  isOpen(): boolean {
    return this.ws !== null;
  }

  /**
   * Complete the same readiness handshake used by the device-verified reader
   * ink boxes. `attachInkBox()` is asynchronous: requesting the attach does
   * not mean Bigme's Canvas is ready. The shared shell calls
   * `renderNoteStrokes()` only after `onInkControllerReady(true)`, so this is
   * the first safe point to present the prepared ruled page and its existing
   * strokes to the daemon.
   *
   * Keeping this method on the canonical handler also satisfies the existing
   * `_inkHandler` contract used by book/EPUB/PDF note boxes; Notes does not
   * need an app-local daemon implementation or a timing guess.
   */
  onNativeResumeRejected() {
    this.resumeDirty = null;
  }

  renderNoteStrokes() {
    if (!this.ws || !this.attached || !hasBridge()) return;
    const presentedWorkspace = this.ws;
    this.redrawInk(this.resumeDirty ?? this.workspaceRegion());
    this.captureFloatingChrome(this.resumeDirty);
    this.resumeDirty = null;
    this.warming = false;
    this.updateWriteProtection();
    // The white workspace DOM covers the editor during reconnection. Only
    // restore normal transparent WebView composition after the daemon Canvas
    // is ready and the authoritative ruled page has been rendered into it.
    // Bigme's inValidate() returns after accepting the GU16 request, not after the panel has
    // physically presented it. Uncovering the SurfaceView in that same UI turn can expose its
    // pre-refresh white frame. Keep the already-painted WebView cover for one short settle window,
    // then reveal only if this workspace still owns the surface.
    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      this.revealTimer = undefined;
      if (this.ws !== presentedWorkspace || !this.attached) return;
      // Retire a temporary DOM frame only after its replacement native page is ready.
      this.setNativeWebHandoff(presentedWorkspace, false);
      if (typeof Bridge.showEditor === "function") Bridge.showEditor();
      console.log("DIAG ruledInkReady presented");
    }, 140);
  }

  // ---- Daemon batch delivery (window._inkHandler contract) ----
  /** Idle/stop notification follows native batch delivery. Never use checkpoint()
   * here: its toolbar flush path disables input and would interrupt live writing. */
  onNativeSaveRequested() {
    const ws=this.ws;if(!ws)return;
    void ws.saveDeliveredNativeDraft().catch(error=>console.warn('[notes-native-draft] save failed',error));
  }

  onNoteStrokes(strokes: number[][][]) {
    const ws = this.ws;
    if (!ws || !this.attached) { traceInkEvent("js.batchDropped", { attached: this.attached, hasWorkspace: !!ws, count: strokes.length }); return; }
    traceInkWorkspace(ws, "js.batchBefore", { count: strokes.length });
    if (strokes.some(stroke => stroke?.length)) ws.noteNativePenActivity?.();
    const magnify = ws.magnifyOpen;
    const el = magnify ? this.writingSurface(ws) : ws.containerElement;
    const er = el.getBoundingClientRect();
    const offset = this.paperOffset(ws);
    const t0 = performance.now();
    const selectionBatch=!magnify && this.usesSelectionPen(ws);
    const checkboxGestures=new Set<string>();
    const existingInk=!magnify&&!selectionBatch?ws.snapshotScribbleInkTargets?.():undefined;
    for (const s of strokes) {
      if (!s || s.length === 0) continue;
      const pts: InkPoint[] = s.map((p, i) => ({
        x: p[0] / this.dpr + (magnify ? -er.left : el.scrollLeft - offset.x),
        y: p[1] / this.dpr + (magnify ? -er.top : el.scrollTop - offset.y),
        t: t0 + i * 4, // daemon strokes carry no timestamps; geometry dominates merging
        pressure: typeof p[2] === "number" ? p[2] : 0.5,
      }));
      // For ordinary writing the daemon already owns visible pixels. Update the vector model
      // and its internal placement data without touching DOM/canvas/layout
      // nodes; even an "idle" WebView invalidation can collide with the next
      // Bigme pen-down and add 40-80ms of compositor latency.
      if (selectionBatch) {
        // A native selection stroke is a temporary gesture, NEVER notebook ink.
        // Compare the model before/after to cover moved/deselected words as well
        // as the lasso trail. Stage a complete vector frame but refresh only this
        // union; existing chrome snapshots remain foreground owners.
        const before=ws.getNativeInkStrokes();
        const beforeBlocks=ws.getSelectedBlockBounds?.();
        this.nativeBatchLayoutOwned=true;
        try { ws.applyNativeStroke(pts); } finally { this.nativeBatchLayoutOwned=false; }
        const after=ws.getNativeInkStrokes();
        const old=new Set(before.map(s=>JSON.stringify(s))), next=new Set(after.map(s=>JSON.stringify(s)));
        const changed=[...before.filter(s=>!next.has(JSON.stringify(s))),...after.filter(s=>!old.has(JSON.stringify(s)))];
        const textBounds=[beforeBlocks,ws.getSelectedBlockBounds?.()].flatMap(b=>b?[
          {x:b.x,y:b.y,t:0,pressure:.5},{x:b.x+b.width,y:b.y+b.height,t:0,pressure:.5}]:[]);
        const dirtyPoints=[...pts,...textBounds,...changed.flatMap(s=>s.pts.map(p=>({...p,t:0,pressure:p.pressure??.5})))];
        const pad=Math.max(6,...changed.map(s=>s.width*2));
        const b=boundsOfPoints(dirtyPoints,pad);
        const x=b.x+offset.x-el.scrollLeft,y=b.y+offset.y-el.scrollTop;
        this.syncNative({l:x,t:y,r:x+b.width,b:y+b.height},true,ws.currentTool === "erase");
      } else if (magnify) ws.applyNativeMagnifyStroke(pts);
      else {
        // Native control taps, like lassos, own their bounded presentation
        // below. Suppress nested layout/region hooks from issuing another bake.
        this.nativeBatchLayoutOwned = true;
        let changed: ReturnType<PenWorkspace["applyNativeWriteStroke"]>;
        try { changed = ws.applyNativeWriteStroke(pts, false, checkboxGestures, existingInk); }
        finally { this.nativeBatchLayoutOwned = false; }
        if (changed) {
          const x = changed.rect.x + offset.x - el.scrollLeft;
          const y = changed.rect.y + offset.y - el.scrollTop;
          this.syncNative({ l: x, t: y, r: x+changed.rect.w, b: y+changed.rect.h }, true, "indices" in changed);
        }
      }
    }
    // Selection is now a model operation, not another ink session. The workspace prepared
    // solid vectors and a separate box during interpretation. Drain the whole native batch
    // under its original gesture owner, then use the existing no-white-frame web handoff.
    if(selectionBatch && !this.wantsDaemon(ws)) {
      const pendingAction=this.afterFlush;
      this.disconnect("web");
      // A toolbar command may have forced delivery of this very lasso. Its ordered
      // onNativeFlushed notification must still run that command exactly once.
      this.afterFlush=pendingAction;
    }
    traceInkWorkspace(ws, "js.batchAfter", { count: strokes.length });
    if (magnify) {
      window.clearTimeout(this.magnifyIdleTimer);
      this.magnifyIdleTimer = window.setTimeout(() => {
        if (this.ws === ws && ws.magnifyOpen) ws.reconcileMagnifyAfterIdle();
      }, 120);
    }
  }

  /** Drain native vectors before a deliberate model/UI command. Live writing
   * remains entirely native; this path is entered only by toolbar actions. */
  private beforeWorkspaceAction(action: () => void) {
    if (!this.attached || !hasBridge()) {
      action();
      return;
    }
    this.afterFlush = action;
    try {
      Bridge.setInkEnabled(false);
      Bridge.flushInk();
    } catch (e) {
      console.warn("[w2n] flush-before-action failed", e);
      this.afterFlush = null;
      action();
    }
  }

  /** Called directly by InkManager after the completed batch has been handed
   * to this workspace, so the model is current before the queued command. */
  onNativeFlushed() {
    const action = this.afterFlush;
    this.afterFlush = null;
    if (!action) return;
    action();
    // A command that stays in write mode (undo/redo) schedules one canonical
    // reconciliation. Keep input gated until its snapshot has landed.
    if (this.attached && this.wantsDaemon()) {
      window.clearTimeout(this.enableTimer);
      this.enableTimer = window.setTimeout(() => {
        if (this.attached && hasBridge()) Bridge.setInkEnabled(true);
      }, 420);
    }
  }

  private onLayout() {
    // ResizeObserver/layout callbacks fire while the SurfaceView is coming
    // up. Folding those into the warm prime used to expand its 2x2 refresh to
    // the whole modal, which looked like a full-screen flash.
    const ws = this.ws;
    if (!ws || this.targeting || this.webChromeActive) return;
    // ResizeObserver may report several intermediate layouts while full chrome is appearing. The
    // first changed rectangle owns the WebView presentation window; a later callback must not call
    // attach() early and collapse that window back to the original race.
    if (this.geometryTimer !== undefined) return;
    if (!this.wantsDaemon(ws)) {
      if (this.attached || this.surfaceEl) this.disconnect("web");
      return;
    }
    // MagnifyPad emits one visual-change callback from inside its constructor, before
    // PenWorkspace.magnifyPad has been assigned. A second callback follows immediately after the
    // assignment. Never let the first attach's warm-up suppress that real mode transition.
    if (this.warming && ws.magnifyOpen === this.attachedMagnify) return;
    const surface = this.compositionSurface(ws);
    const r = surface.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const panelW = Math.max(1, Math.round(window.innerWidth * dpr));
    const panelH = Math.max(1, Math.round(window.innerHeight * dpr));
    const next = ws.magnifyOpen ? {
      l: 0,
      t: 0,
      r: panelW,
      b: panelH,
    } : {
      l: Math.min(panelW - 1, Math.max(0, Math.floor(r.left * dpr))),
      t: Math.min(panelH - 1, Math.max(0, Math.floor(r.top * dpr))),
      r: Math.min(panelW, Math.max(1, Math.ceil(r.right * dpr))),
      b: Math.min(panelH, Math.max(1, Math.ceil(r.bottom * dpr))),
    };
    if (
      !this.attached || surface !== this.surfaceEl || next.l !== this.boxL ||
      next.t !== this.boxT || next.r !== this.boxR || next.b !== this.boxB
    ) {
      const wasAttached = this.attached;
      const previous = { l: this.boxL, t: this.boxT, r: this.boxR, b: this.boxB };
      this.disconnect("web");
      if (!wasAttached) {
        this.attach(ws);
        return;
      }
      /*
       * Full Planning chrome is a real layout mode: its inset paper and surrounding header/rail
       * share one captured composition. Switching composition owners must still release the old
       * SurfaceView before the new capture/attach sequence, even if their rectangles match. After
       * detachInkBoxForWeb(), SurfaceFlinger destroys the old SurfaceView asynchronously. Reattaching
       * in this same JavaScript turn used to restore COMIC mode before that destruction completed,
       * so Android screenshots showed the new toolbar while the physical e-ink panel retained the
       * old ruled pixels in the newly exposed top/left bands.
       *
       * Leave the committed WebView authoritative in FAST mode for one bounded presentation window,
       * then begin the normal capture/ready-covered attach. Do not apply this pause to pen strokes,
       * ordinary tool switches, or tap-only compact-toolbar snapshots.
       */
      console.log(
        `DIAG ruledInkGeometryHandoff wait=${WEB_GEOMETRY_PRESENT_MS}ms ` +
          `from=${previous.l},${previous.t},${previous.r},${previous.b} ` +
          `to=${next.l},${next.t},${next.r},${next.b}`
      );
      this.geometryTimer = window.setTimeout(() => {
        this.geometryTimer = undefined;
        if (this.ws !== ws || this.webChromeActive || !this.wantsDaemon(ws)) return;
        console.log("DIAG ruledInkGeometryHandoff reattach");
        this.attach(ws);
      }, WEB_GEOMETRY_PRESENT_MS);
      return;
    }
    // Same-geometry observer notifications during sheet mounting do not
    // change the frame just captured. Avoid a duplicate page presentation.
    if (!this.pageTurnSettling) this.syncNative(this.workspaceRegion());
    this.updateWriteProtection();
  }

  /** A stationary tap that expands/collapses the floating toolbar changes no
   * document geometry. Re-capture the stable full content bitmap but refresh
   * only the union of its old and new footprints. */
  private syncToolbarRegion(previous: CssRect, current: CssRect) {
    if (!this.attached || this.webChromeActive) return;
    const originX = this.boxL / this.dpr;
    const originY = this.boxT / this.dpr;
    const refresh = {
      l: Math.min(previous.l, current.l) - originX,
      t: Math.min(previous.t, current.t) - originY,
      r: Math.max(previous.r, current.r) - originX,
      b: Math.max(previous.b, current.b) - originY,
    };
    // The underlying content snapshot may still contain the OLD toolbar. Replacing only the
    // foreground bitmap exposes that baked copy when the pill grows, shrinks or moves.
    // Re-bake the complete content, presenting only the old/new footprint union.
    this.captureFloatingChrome(refresh);
    this.syncNative(refresh);
    this.updateWriteProtection();
  }

  /** Capture through InkManager's serialized menu pipeline. It retains this bitmap ABOVE
   * replayed strokes and redraws it after every page render, including heavy-page second frames. */
  private captureFloatingChrome(refresh?: CssRect | null): boolean {
    const rect = this.ws?.nativeChromeRect?.();
    if (!rect || !hasBridge() || typeof Bridge.snapshotMenu !== "function") return false;
    const ox = this.boxL / this.dpr, oy = this.boxT / this.dpr;
    const local = { l: rect.l - ox, t: rect.t - oy, r: rect.r - ox, b: rect.b - oy };
    const dirty = this.unionRect(refresh ?? this.lastChrome, local);
    this.lastChrome = local;
    const bounds = [Math.floor(rect.l * this.dpr), Math.floor(rect.t * this.dpr),
      Math.ceil(rect.r * this.dpr), Math.ceil(rect.b * this.dpr)] as const;
    const region = this.devRect(dirty);
    Bridge.snapshotMenu(...bounds, region[0], region[1], region[2], region[3]);
    return true;
  }

  private onTool(tool: Tool, keyboard: boolean) {
    const useDaemon = !!this.ws?.magnifyOpen || ((tool === "write" || this.usesSelectionPen()) && !keyboard);
    if (!useDaemon) {
      this.disconnect("web");
      return;
    }
    if (!this.attached && this.ws) this.attach(this.ws);
    else if (hasBridge()) {
      // Both tools keep the same scoped native surface. Reset the pen type on
      // every switch so temporary lasso dashes cannot leak into ordinary writing.
      if (typeof Bridge.setPenType === "function") Bridge.setPenType(this.usesSelectionPen() && !this.ws?.magnifyOpen ? "selection" : (this.ws?.nativePenType ?? "ballpoint"));
      const style=this.inkStyle(); this.setInkStyle(style.color,style.width);
      this.updateWriteProtection();
    }
  }

  /** Ruled writing surface — the only region that needs a visible refresh
   * when handing the already-rendered WebView frame to the daemon. */
  private workspaceRegion(): CssRect {
    return { l: 0, t: 0, r: this.boxW / this.dpr, b: this.boxH / this.dpr };
  }

  // ---- Daemon ink repaint ----
  redrawInk(rr?: CssRect, defer = false, eraseRect?: CssRect) {
    const ws = this.ws;
    if (!ws || (!this.attached && !(defer && this.warming)) || !hasBridge()) return;
    const magnify = ws.magnifyOpen;
    const el = magnify ? this.writingSurface(ws) : ws.containerElement;
    const dpr = this.dpr;
    const offset = this.paperOffset(ws);
    const offX = magnify ? 0 : offset.x - el.scrollLeft;
    const offY = magnify ? 0 : offset.y - el.scrollTop;
    const out: {
      t: string; sp: number; mg: number; dpr: number; b: number[];
      s: { w: number; c: string; p: number[][]; d?: number; vw?: number }[]; rr?: number[]; defer?: number; eraseRect?: number[];
    } = { t: "blank", sp: 0, mg: 0, dpr, b: [0, 0, this.boxW, this.boxH], s: [] };
    const strokes = magnify ? ws.getNativeMagnifyStrokes() : ws.getNativeInkStrokes();
    for (const st of strokes) {
      if (!Array.isArray(st.pts)) continue;
      const so: { w: number; c: string; p: number[][]; d?: number; vw?: number } = {
        w: Math.max(2, Math.round(st.width * dpr)),
        c: st.color,
        p: st.pts.map((pt) => [Math.round((pt.x + offX) * dpr), Math.round((pt.y + offY) * dpr), ...(st.variableWidth ? [pt.pressure] : [])]),
      };
      if (st.variableWidth) so.vw = 1;
      // Selection decorates a separate DOM rectangle, never the saved handwriting path.
      // `d` belongs only to transient lasso capture; replaying selected ink with it breaks letters.
      out.s.push(so);
    }
    if (rr) out.rr = this.devRect(rr);
    if (eraseRect) out.eraseRect = this.devRect(eraseRect);
    if (defer) out.defer = 1;
    try {
      Bridge.renderInk(JSON.stringify(out));
    } catch (e) {
      console.warn("[w2n] renderInk failed", e);
    }
  }

  // ---- Coordinated DOM + ink sync: ONE visible EPD refresh per flush ----
  // The native bake recomposites the retained ink strokes (renderFromState:
  // white + content bitmap + displayedStrokes), so the flush first updates
  // the retained strokes via renderInk(defer:1) (model only, no presentation),
  // then snapshotContent bakes the DOM and refreshes the
  // dirty region once with everything already in sync — this is what removes
  // the pen-off blank flash of two stacked full-screen GU16 refreshes.
  syncNative(rect?: CssRect, completedErase = false, cleanErase = false) {
    if (!this.attached || this.targeting) return;
    // Keep erase bounds separate: a simultaneous full layout update must not turn
    // regional ghost cleanup into a whole-panel flash. Never clean on live pen input.
    if (cleanErase && rect) this.eraseDirty = this.unionRect(this.eraseDirty, rect);
    if (rect === undefined || this.ws?.magnifyOpen) this.fullDirty = true;
    else this.dirty = this.unionRect(this.dirty, rect);
    // A new sheet schedules a fast reconciliation, but ResizeObserver and
    // toolbar callbacks follow it. They must add dirty bounds without pushing
    // that deadline back to the ordinary 160 ms layout debounce repeatedly.
    // Device logs showed 256–307 ms of avoidable postponement when these
    // notifications restarted the timer. Keep earliest-deadline coalescing;
    // reverting to trailing debounce restores the half-second page-turn lag.
    const delay = this.ws?.magnifyOpen ? 60 : this.pageTurnChrome ? 0 : completedErase ? 32 : 160;
    const deadline = performance.now() + delay;
    if (this.syncDeadline !== undefined && this.syncDeadline <= deadline) return;
    window.clearTimeout(this.syncTimer);
    this.syncDeadline = deadline;
    this.syncTimer = window.setTimeout(() => {
      this.syncDeadline = undefined;
      if (!this.attached || !hasBridge()) return;
      const pageTurn = this.pageTurnChrome;
      try {
        Bridge.setInkEnabled(false);
        // Reconciliation paints the already-accounted model into the DOM. Its render()
        // emits onWorkspaceLayout, but this is NOT a second edit/geometry transaction.
        // Letting that nested hook run widens a word erase to the full sheet and queues
        // another GU16 frame after the local GC16 cleanup (device logs, 2026-10-11).
        // Suppress only synchronous hooks here; later real resize/tool changes still
        // follow the ordinary geometry/attachment policy.
        this.nativeBatchLayoutOwned = true;
        try { this.ws?.reconcileNativeCommand?.(); }
        finally { this.nativeBatchLayoutOwned = false; }
        // Update native retained strokes only. snapshotContent below performs
        // the single render/presentation after the WebView capture arrives.
        this.redrawInk(undefined, true, this.eraseDirty ?? undefined);
        if (this.fullDirty || !this.dirty) {
          Bridge.snapshotContent(this.boxL, this.boxT, this.boxR, this.boxB);
        } else {
          const d = this.devRect(this.dirty);
          // Keep the retained content bitmap full-screen and aligned at the
          // surface origin; only the EPD refresh is regional. Capturing just
          // `d` makes InkSurfaceView draw that cropped bitmap at (0, 0), which
          // pins the editor modal to the top-left. The bridge has a distinct
          // partial method — extra arguments to snapshotContent are ignored.
          Bridge.snapshotContentPartial(
            this.boxL, this.boxT, this.boxR, this.boxB,
            d[0], d[1], d[2], d[3]
          );
        }
        if (this.pageTurnChrome) {
          this.pageTurnChrome = false;
          this.captureFloatingChrome();
        }
      } catch (e) {
        console.warn("[w2n] sync failed", e);
      }
      this.dirty = null;
      this.eraseDirty = null;
      this.fullDirty = false;
      this.warming = false;
      window.clearTimeout(this.enableTimer);
      this.enableTimer = window.setTimeout(() => {
        // The 500 ms page-turn gate delays PEN INPUT, not page presentation.
        // Enabling the already-connected controller changes no pixels, so it
        // must not attach, capture or force-refresh the page again. This lets
        // rapid finger page turns finish before the pen starts writing.
        this.pageTurnSettling = false;
        if (this.attached && hasBridge()) Bridge.setInkEnabled(true);
      }, pageTurn ? 500 : 180);
    }, delay);
  }

  // ---- Write protection: ONE bounds rect + ONE exclusion rect ----
  updateWriteProtection() {
    const ws = this.ws;
    if (!ws || !this.attached || !hasBridge()) return;
    const dpr = this.dpr;
    try {
      const magnify = ws.magnifyOpen;
      const wr = this.writingSurface(ws).getBoundingClientRect();
      const composed = this.compositionSurface(ws) !== this.writingSurface(ws);
      const bounds = magnify ? {
        l: Math.floor(wr.left * dpr), t: Math.floor(wr.top * dpr),
        r: Math.ceil(wr.right * dpr), b: Math.ceil(wr.bottom * dpr),
      } : composed
        ? {
            l: Math.max(0, Math.floor(wr.left * dpr) - this.boxL),
            t: Math.max(0, Math.floor(wr.top * dpr) - this.boxT),
            r: Math.min(this.boxW, Math.ceil(wr.right * dpr) - this.boxL),
            b: Math.min(this.boxH, Math.ceil(wr.bottom * dpr) - this.boxT),
          }
        : { l: 0, t: 0, r: this.boxW, b: this.boxH };
      Bridge.setWritingBounds(bounds.l, bounds.t, bounds.r, bounds.b);
      // The tool pill / modal header sit outside the bounds; a dedicated
      // exclusion is only needed for overlays INSIDE the ruled surface
      // (the HWR candidate sheet adds one in the HWR module).
      const excl = this.exclusionRect;
      if (excl) {
        Bridge.setWritingExclusion(
          Math.floor(excl.l * dpr) - this.boxL,
          Math.floor(excl.t * dpr) - this.boxT,
          Math.ceil(excl.r * dpr) - this.boxL,
          Math.ceil(excl.b * dpr) - this.boxT
        );
      } else {
        Bridge.setWritingExclusion(0, 0, 0, 0);
      }
      this.drawProtectDebug(
        magnify ? { l: wr.left, t: wr.top, r: wr.right, b: wr.bottom } : (() => {
          const r = ws.containerElement.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom };
        })(),
        excl
      );
    } catch (e) {
      console.warn("[w2n] write protection failed", e);
    }
  }

  /** ?protect=1: outline the bounds (solid) + exclusion (dashed) rects. The
   * debug DOM is part of the baked chrome, so it shows on the device panel. */
  private drawProtectDebug(bounds: CssRect, excl: CssRect | null) {
    if (!/[?&]protect=1/.test(location.search)) return;
    let box = document.getElementById("w2-protect-debug");
    if (!box) {
      box = document.createElement("div");
      box.id = "w2-protect-debug";
      box.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99;";
      document.body.appendChild(box);
    }
    const mk = (r: CssRect, dash: boolean) =>
      `<div style="position:fixed;left:${r.l}px;top:${r.t}px;width:${r.r - r.l}px;height:${r.b - r.t}px;` +
      `outline:2px ${dash ? "dashed" : "solid"} #000;outline-offset:-2px;pointer-events:none;"></div>`;
    box.innerHTML = mk(bounds, false) + (excl ? mk(excl, true) : "");
  }

  /** Set by overlays (e.g. the HWR sheet) that float over the ruled surface. */
  exclusionRect: CssRect | null = null;

  /** Shared transient WebView handoff for settings and toolbar movement. Standard Android never constructs this class: its workspace,
   * pen input, and floating toolbar all remain in the ordinary WebView pointer/canvas path. */
  private setWebChromeHandoff(active: boolean) {
    if (active === this.webChromeHandoff || !hasBridge()) return;
    this.webChromeHandoff = active;
    window.clearTimeout(this.webChromeTimer);
    window.clearTimeout(this.attachTimer);
    window.clearTimeout(this.snapshotTimer);
    window.clearTimeout(this.syncTimer);
    this.syncDeadline = undefined;
    window.clearTimeout(this.enableTimer);

    if (active) {
      const chrome = this.ws?.nativeChromeRect?.() ?? this.exclusionRect;
      if (chrome) this.chromeDirty = this.unionRect(this.chromeDirty, chrome);
      if (this.attached) {
        this.beforeWorkspaceAction(() => {
          this.disconnectChromeForWeb(this.ws);
        });
      } else if (this.surfaceEl || this.warming) {
        this.disconnectChromeForWeb(this.ws);
      } else {
        try {
          if (!this.interactiveWeb && typeof Bridge.setInteractivePanel === "function") {
            Bridge.setInteractivePanel(true);
            this.interactiveWeb = true;
          }
          if (typeof Bridge.showWebWorkspace === "function") Bridge.showWebWorkspace();
        } catch (e) {
          console.warn("[w2n] chrome WebView handoff failed", e);
        }
      }
      return;
    }

    const ws = this.ws;
    // If the flush callback has not run yet, it will observe false and keep
    // the existing daemon. Its ordinary re-enable timer completes the tap.
    if (this.attached || !ws) return;
    if (!this.wantsDaemon(ws)) {
      try {
        if (!this.interactiveWeb && typeof Bridge.setInteractivePanel === "function") {
          Bridge.setInteractivePanel(true);
          this.interactiveWeb = true;
        }
        if (typeof Bridge.showWebWorkspace === "function") Bridge.showWebWorkspace();
      } catch (e) {
        console.warn("[w2n] chrome WebView restore failed", e);
      }
      return;
    }
    try {
      if (typeof Bridge.setInteractivePanel === "function") Bridge.setInteractivePanel(false);
      this.interactiveWeb = false;
    } catch (e) {
      console.warn("[w2n] chrome ink-mode restore failed", e);
    }
    this.webChromeTimer = window.setTimeout(() => {
      if (this.ws !== ws || this.webChromeActive || !this.wantsDaemon(ws)) return;
      const chrome = ws.nativeChromeRect?.();
      const dirty = chrome ? this.unionRect(this.chromeDirty, chrome) : this.chromeDirty;
      this.chromeDirty = null;
      this.attach(ws, dirty);
    }, 80);
  }

  /**
   * Transient settings/toolbar handoff through the established Bigme WebView path.
   *
   * Bigme's persistent panel retains the submitted native pixels while the SurfaceView is
   * disconnected, so the live WebView can move the toolbar without exposing an empty writing
   * frame. Standard deliberately never calls this method: destroying its ordinary SurfaceView
   * was the source of the visible composition refresh.
   */
  private disconnectChromeForWeb(ws: PenWorkspace | null) {
    const disconnectIfStillActive = () => {
      // A short tap can finish while Bigme's ordered native flush is pending. Keep the daemon
      // attached in that case and remove the unused Web handoff canvas.
      if (this.ws !== ws || !this.webChromeActive) {
        if (this.ws === ws) this.setNativeWebHandoff(ws, false);
        return;
      }
      if (this.dialogOpen) ws?.setNativeDialogHandoff?.(true);
      this.resumeBox = this.attached ? [this.boxL, this.boxT, this.boxR, this.boxB] : null;
      this.disconnect("web");
    };
    disconnectIfStillActive();
  }

  /** Upper-document pen mode: drop the opaque snapshot so the WebView can pan/retarget, then
   * re-bake and restore the full-screen daemon when the gesture finishes. */
  private setMagnifyErasing(active: boolean) {
    // Erasing already belongs to the WebView. Use the established transient handoff so the
    // diameter cursor and vector cuts are visible immediately, instead of behind an opaque
    // daemon snapshot. Normal writing returns through the existing readiness/capture queue.
    this.magnifyEraserWeb = active;
    this.magnifyErasing = false;
    this.setWebChromeHandoff(this.webChromeActive);
  }

  private setMagnifyTargeting(active: boolean) {
    const ws = this.ws;
    if (!ws?.magnifyOpen || this.magnifyEraserWeb || active === this.targeting || !hasBridge()) return;
    this.targeting = active;
    window.clearTimeout(this.attachTimer);
    window.clearTimeout(this.snapshotTimer);
    window.clearTimeout(this.syncTimer);
    this.syncDeadline = undefined;
    window.clearTimeout(this.enableTimer);
    window.clearTimeout(this.targetingTimer);
    if (active) {
      try {
        Bridge.setInkEnabled(false);
        Bridge.flushInk();
        Bridge.detachInkBox();
        if (typeof Bridge.setInteractivePanel === "function") Bridge.setInteractivePanel(true);
      } catch (e) {
        console.warn("[w2n] target handoff failed", e);
      }
      // Leave the JS handler alive briefly so detach's ordered flush cannot lose recent pad ink.
      this.targetingTimer = window.setTimeout(() => { this.attached = false; }, 100);
      return;
    }
    try {
      if (typeof Bridge.setInteractivePanel === "function") Bridge.setInteractivePanel(false);
    } catch (e) {
      console.warn("[w2n] interactive panel restore failed", e);
    }
    this.targetingTimer = window.setTimeout(() => {
      if (this.ws !== ws || !ws.magnifyOpen) return;
      this.attached = false;
      this.attach(ws);
    }, 80);
  }

  private devRect(r: CssRect): number[] {
    const dpr = this.dpr;
    return [
      Math.max(0, Math.floor(r.l * dpr)),
      Math.max(0, Math.floor(r.t * dpr)),
      Math.min(this.boxW, Math.ceil(r.r * dpr)),
      Math.min(this.boxH, Math.ceil(r.b * dpr)),
    ];
  }

  private unionRect(a: CssRect | null, b: CssRect): CssRect {
    if (!a) return { ...b };
    return { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
  }
}
