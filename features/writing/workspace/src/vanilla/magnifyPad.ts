import type { EraseMode } from "../ink/erase";
import { validLasso } from "../ink/lasso";
// MagnifyPad — the DOM/interaction layer for magnified writing (AFK-W2; model in
// editor/magnify.ts). The upper document stays visible and stable; a plain 2px target
// rectangle + caret mark the destination; the lower one-third strip is ONE magnified ruled lane
// with baseline/x-height guides. Strokes are captured pad-local (pointer events in the
// preview, native daemon batches on device) and committed through the host's
// placeMagnifiedGroup as one undoable transaction per group.
//
// E-ink rules: pure black/white, outlines only, no animation/transition, ≥48px tap targets,
// no scrollbars. The screenshot's miniature scroll control is deliberately omitted.

import {
  MagnifyModel,
  advanceTarget,
  type LaneGeometry,
  type MagnifySettings,
  type MagnifyTarget,
  type PadGeometry,
  type PlacePayload,
} from "../editor/magnify";
import type { InkPoint, InkStroke } from "../ink/types";
import { boundsOfPoints } from "../ink/types";
import { scribble } from "../ink/scribble";
import { bindPenButton } from "./penButton";

/** What the pad needs from PenWorkspace — implemented there as a thin public seam. */
export interface MagnifyHost {
  /** Ruled line pitch (workspace px). */
  magnifyLineHeight(): number;
  /** Usable page width + left margin for wrap. */
  magnifyLane(): LaneGeometry;
  /** The scrollable workspace surface — target overlay parent + tap coordinate space. */
  magnifySurface(): HTMLElement;
  /** Reading slot (afterWord) for a document-space point. */
  magnifySlotAt(x: number, y: number): number;
  /** Commit one mapped group as ONE ink insert + ONE history item. */
  placeMagnifiedGroup(strokes: InkStroke[], targetLine: number): void;
  /** Undo the last workspace transaction (the pad pairs it with model undo). */
  magnifyUndo(): void;
  magnifyUndoScribble?(): boolean;
  /** Existing typed words and handwriting around the active target line. */
  magnifyContext?(target: MagnifyTarget): MagnifyContext;
  /** Natural opening target, normally immediately after the final visible word. */
  magnifyInitialTarget?(): MagnifyTarget;
  /** Hand the upper document between the native snapshot and live WebView. */
  magnifyTargeting?(active: boolean): void;
  /** Temporarily hand Zoom to the WebView for the live eraser cursor and vector cuts. */
  magnifyErasing?(active: boolean): void;
  /** Erase committed page ink at a document-space point; begin marks one undo transaction. */
  magnifyScribble?(points: InkPoint[], strokes: InkStroke[], restore: (strokes: InkStroke[]) => void): boolean;
  magnifyEraseLasso?(points: InkPoint[], strokes: InkStroke[], line:number): void;
  magnifyDismissToolSettings?(): void;
  magnifyEraserSettings?(): {diameter:number;mode:EraseMode | "lasso";active:boolean};
  magnifyEraseAt?(point: InkPoint, begin: boolean, radius?: number, mode?: EraseMode): void;
  /** Target/context moved and the full-screen native snapshot must be refreshed. */
  magnifyVisualChanged?(): void;
  /** True when the lower lane is backed by the native ink daemon. */
  magnifyNativeActive?(): boolean;
  /** Current Planning pen style; Zoom preserves it for live, staged and committed ink. */
  magnifyInkStyle?(): { color: string; width: number; brushStyle?: InkStroke["brushStyle"] };
  /** Device mode: drain pending daemon vectors before reading/changing pad state. */
  beforeMagnifyAction?(action: () => void): void;
  /** Convert pad strokes to text when placement = "text"; cb(null) on failure. */
  magnifyRecognize?(strokes: InkStroke[], cb: (text: string | null) => void): void;
  /** Place recognized text at the anchor (text placement). */
  placeMagnifiedText?(text: string, afterWord: number): void;
  /** Notified when the pad closes so the workspace can restore its chrome. */
  onMagnifyClosed?(): void;
}

export type MagnifyContext = {
  words: { text: string; x: number; line: number; fragments?:{text:string;font:string;strike?:boolean}[] }[];
  strokes: { points: { x: number; y: number }[]; width: number; color: string }[];
  fontSize?: number;
  baselineInset?: number;
};

// 34% leaves enough room below the 2.5× baseline for long descenders without sacrificing the
// upper-page target context. Keep this synchronized with the vh split in eink.css.
const PAD_FRACTION = 0.34;
/** Keep a small amount of already-covered document visible to the left of
 * the writing focus. This used to be 42% of the magnified viewport; halving
 * it leaves substantially more forward writing room and only a short visual
 * handoff from the previous target box. */
const BACK_CONTEXT_FRACTION = 0.21;
const CONTROLS_HEIGHT = 62;
const STATUS_HEIGHT = 30;
const STORE_KEY = "write2.magnify.settings";
const DRAFT_KEY = "write2.magnify.draft";

export class MagnifyPad {
  private host: MagnifyHost;
  private model: MagnifyModel;
  private padEl: HTMLDivElement;
  private viewportEl: HTMLDivElement;
  private scene: SVGSVGElement;
  private contextEl: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private targetEl: HTMLDivElement;
  private pageNavEl: HTMLDivElement;
  private sheetExtentEl: HTMLDivElement;
  private sheetHeight: number;
  private savedPaperStyle: {size:string;repeat:string;attachment:string};
  private eraserDiameter = 20;
  private eraserMode: EraseMode | "lasso" = "stroke";
  private eraseLassoPoints: InkPoint[] = [];
  private eraserCursor: HTMLDivElement;
  private erasePrevious: {x:number;y:number} | null = null;
  private settingsEl: HTMLDivElement | null = null;
  private live: { pointerId: number; points: InkPoint[] } | null = null;
  private redoPadStrokes: InkStroke[] = [];
  private erasePointer: number | null = null;
  private idleTimer: number;
  private surfaceCapture: (e: MouseEvent) => void;
  private surfacePointerDown: (e: PointerEvent) => void;
  private surfacePointerMove: (e: PointerEvent) => void;
  private surfacePointerUp: (e: PointerEvent) => void;
  private upperGesture: { id: number; x: number; y: number; moved: boolean } | null = null;
  private targetRaf: number | null = null;
  private pendingTarget: { x: number; y: number } | null = null;
  private workspaceEl: HTMLElement | null;
  private resizeHandler: () => void;
  private scrollHandler: () => void;
  private dpr = window.devicePixelRatio || 1;
  private inkMode = true;
  private eraseMode = false;
  closed = false;

  constructor(host: MagnifyHost, mount: HTMLElement) {
    this.host = host;
    this.workspaceEl = host.magnifySurface().closest(".pen-workspace");
    // Zoom reveals the same complete sheet through a shorter viewport. Retain its original
    // extent even when its lower rows are blank; otherwise there is nothing to scroll down to.
    this.sheetHeight = host.magnifySurface().clientHeight;
    const paperStyle=host.magnifySurface().style;
    this.savedPaperStyle={size:paperStyle.backgroundSize,repeat:paperStyle.backgroundRepeat,attachment:paperStyle.backgroundAttachment};
    if(this.sheetHeight>0) {
      paperStyle.backgroundSize=`100% ${this.sheetHeight}px`;
      paperStyle.backgroundRepeat="no-repeat";
      paperStyle.backgroundAttachment="local";
    }
    this.sheetExtentEl = document.createElement("div");
    this.sheetExtentEl.className = "magnify-sheet-extent";
    this.sheetExtentEl.style.height = `${this.sheetHeight}px`;
    host.magnifySurface().append(this.sheetExtentEl);
    document.body.classList.add("magnify-active");
    this.workspaceEl?.classList.add("magnify-open");
    const settings = { ...this.loadSettings(), autoPlaceMs: 400 };
    this.model = new MagnifyModel(this.padGeometry(), host.magnifyLane(), settings);
    this.model.open();

    // ---- lower pad strip ----
    this.padEl = document.createElement("div");
    this.padEl.className = `magnify-pad hand-${this.model.settings.handedness}`;
    this.viewportEl = document.createElement("div");
    this.viewportEl.className = "magnify-viewport ink-mode";
    this.scene = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.scene.classList.add("magnify-scene");
    this.scene.setAttribute("aria-hidden", "true");
    this.contextEl = document.createElement("div");
    this.contextEl.className = "magnify-context";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "magnify-canvas";
    // Status is opaque chrome outside the daemon's writable lane, not a badge over ink.
    this.eraserCursor=document.createElement("div");
    this.eraserCursor.className="magnify-eraser-cursor";
    this.eraserCursor.hidden=true;
    this.viewportEl.append(this.scene, this.canvas, this.eraserCursor);
    this.padEl.append(this.contextEl, this.viewportEl);
    this.padEl.appendChild(this.buildControls());
    mount.appendChild(this.padEl);
    this.ctx = this.canvas.getContext("2d")!;

    // ---- upper target rectangle + caret ----
    this.targetEl = document.createElement("div");
    this.targetEl.className = "magnify-target";
    this.targetEl.innerHTML = "<span>HERE</span>";
    host.magnifySurface().appendChild(this.targetEl);
    this.pageNavEl = this.buildPageNav();
    mount.appendChild(this.pageNavEl);
    // Finger/manual browsing updates chrome and the native snapshot, but deliberately does not
    // invoke target-follow: users can inspect earlier rows without being pulled back down.
    this.scrollHandler = () => {
      this.updatePageNav();
      this.host.magnifyVisualChanged?.();
    };
    host.magnifySurface().addEventListener("scroll", this.scrollHandler);


    // A completed tap on the upper document chooses the target. Listening for click rather
    // than pointerdown leaves native WebView scrolling/panning responsive; a drag does not
    // synthesize a click, so it never jumps the target accidentally.
    this.surfaceCapture = (e: MouseEvent) => {
      if (this.upperGesture?.moved) {
        this.upperGesture = null;
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      this.upperGesture = null;
      e.stopPropagation();
      e.preventDefault();
      const surface = host.magnifySurface();
      const r = surface.getBoundingClientRect();
      this.runCommand(() => this.setTargetFromPoint(
        e.clientX - r.left + surface.scrollLeft,
        e.clientY - r.top + surface.scrollTop
      ));
    };
    this.surfacePointerDown = (e: PointerEvent) => {
      if(!(e.target as Element)?.closest("button,input,textarea,[role=dialog]"))this.host.magnifyDismissToolSettings?.();
      // Magnify mode owns pen/mouse input in the upper document. Claim it before the
      // workspace's bubble-phase listener can start the previously selected tool (for
      // example, a target drag must never also become a Blank Lines gesture). Touch is
      // deliberately left alone so the workspace's existing finger-scroll path still runs.
      if (e.pointerType !== "touch") e.stopImmediatePropagation();
      if (this.inkMode) {
        this.inkMode = false;
        this.viewportEl.classList.remove("ink-mode");
        this.viewportEl.classList.add("web-mode");
        this.renderContext();
        this.host.magnifyTargeting?.(true);
      }
      this.upperGesture = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
      };
      const surface = host.magnifySurface();
      const r = surface.getBoundingClientRect();
      this.moveTargetGuide(
        e.clientX - r.left + surface.scrollLeft,
        e.clientY - r.top + surface.scrollTop
      );
    };
    this.surfacePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch") e.stopImmediatePropagation();
      const g = this.upperGesture;
      if (!g || g.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 10) g.moved = true;
      if (g.moved) {
        const surface = host.magnifySurface();
        const r = surface.getBoundingClientRect();
        const x = e.clientX - r.left + surface.scrollLeft;
        const y = e.clientY - r.top + surface.scrollTop;
        // Match line insertion: move the visible guide immediately, then fold model/context work
        // into at most one update per animation frame.
        this.moveTargetGuide(x, y);
        this.pendingTarget = { x, y };
        if (this.targetRaf === null) {
          this.targetRaf = requestAnimationFrame(() => {
            this.targetRaf = null;
            const pending = this.pendingTarget;
            this.pendingTarget = null;
            if (pending) this.setTargetFromPoint(pending.x, pending.y, true);
          });
        }
        e.preventDefault();
      }
    };
    this.surfacePointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") e.stopImmediatePropagation();
      const g = this.upperGesture;
      if (!g || g.id !== e.pointerId || !g.moved) return;
      if (this.targetRaf !== null) cancelAnimationFrame(this.targetRaf);
      this.targetRaf = null;
      const surface = host.magnifySurface();
      const r = surface.getBoundingClientRect();
      this.setTargetFromPoint(
        e.clientX - r.left + surface.scrollLeft,
        e.clientY - r.top + surface.scrollTop,
        true
      );
      this.pendingTarget = null;
      this.updatePageNav();
      this.upperGesture = null;
    };
    host.magnifySurface().addEventListener("pointerdown", this.surfacePointerDown, true);
    host.magnifySurface().addEventListener("pointermove", this.surfacePointerMove, true);
    host.magnifySurface().addEventListener("pointerup", this.surfacePointerUp, true);
    host.magnifySurface().addEventListener("pointercancel", this.surfacePointerUp, true);
    host.magnifySurface().addEventListener("click", this.surfaceCapture, true);

    this.wirePadPointer();
    // Construction used a pre-mount fallback. Commit the measured inner viewport before any
    // draft restoration or placement; borders/insets must not create two different affine maps.
    this.updateSheetExtent();
    this.model.relayout(host.magnifyLane(), this.padGeometry());
    this.sizeCanvas();
    // recovered draft (app pause with unplaced ink) — consumed at most once
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (draft && this.model.restoreDraft(draft)) this.renderTarget();
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* no draft */
    }
    if (!this.model.target) {
      // Open beside real content, not at the bottom edge of the scroll surface. This makes
      // the destination and its magnified context immediately legible.
      const lane = host.magnifyLane();
      this.chooseBoundedTarget(
        host.magnifyInitialTarget?.() ?? { afterWord: 1e9, line: 0, x: lane.leftX }
      );
    }
    this.renderTarget();
    this.drawPad();

    this.resizeHandler = () => {
      this.updateSheetExtent();
      const pad = this.padGeometry();
      this.model.relayout(this.host.magnifyLane(), pad);
      if (this.model.target) this.chooseBoundedTarget(this.model.target);
      this.sizeCanvas();
      this.renderTarget();
      this.updatePageNav();
    };
    window.addEventListener("resize", this.resizeHandler);

    this.idleTimer = window.setInterval(() => {
      // Device batches already arrive after InkManager's idle flush and use the native timer below;
      // the browser path uses this direct 400ms pause timer.
      if (!this.host.magnifyNativeActive?.() && this.model.autoPlaceDue(Date.now())) {
        this.runCommand(() => this.place());
      }
    }, 250);
    this.showTargetPage();
  }

  /** Exact DOM lane owned by InkSurfaceView while magnify mode is open. */
  nativeSurface(): HTMLElement {
    return this.viewportEl;
  }

  documentChromeRects(): DOMRect[] {
    return [this.pageNavEl.getBoundingClientRect()];
  }

  /** Completed daemon stroke in pad-local CSS coordinates. No DOM paint here: the daemon
   * already owns the live pixels and a WebView invalidation would add pen latency. */
  applyNativeStroke(points: InkPoint[]): void {
    if (points.length === 0 || this.tryScribble(points)) return;
    const style = this.host.magnifyInkStyle?.() ?? { color: "#000000", width: 4 };
    this.redoPadStrokes = [];
    this.model.penDidGoDown();
    this.model.addStroke({
      id: `mp-native-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      tool: "pen",
      color: style.color,
      brushStyle: "brushStyle" in style ? style.brushStyle : "pen",
      width: style.width,
      points,
      bounds: boundsOfPoints(points),
    });
  }

  /** Native batches arrive after the daemon's 900ms idle flush. Give the user a little more pause,
   * then place/reflow and refresh the upper page while keeping persistent Ink mode selected. */
  reconcileAfterIdle(): void {
    if (this.model.padStrokes.length === 0) return;
    this.runCommand(() => this.place());
  }

  nativeStrokes(): InkStroke[] {
    // The ruled page, typed text, existing document ink and caret are one WebView canvas snapshot.
    // Native retained vectors therefore contain only unplaced live writing over that snapshot.
    return this.model.padStrokes;
  }

  private runCommand(action: () => void) {
    if (this.host.beforeMagnifyAction) this.host.beforeMagnifyAction(action);
    else action();
  }

  private buildPageNav(): HTMLDivElement {
    const nav = document.createElement("div");
    nav.className = "magnify-page-nav";
    nav.setAttribute("aria-label", "Magnify document pages");
    const prev = this.controlButton("up", "Previous document page", () => this.runCommand(() => this.setPage(this.currentPage() - 1)));
    const label = document.createElement("span");
    label.className = "magnify-page-label";
    const next = this.controlButton("down", "Next document page", () => this.runCommand(() => this.setPage(this.currentPage() + 1)));
    const views = document.createElement("div");
    views.className = "magnify-view-navigation";
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "Scroll within current sheet");
    views.append(prev, label, next);
    nav.append(views);
    return nav;
  }

  private updateSheetExtent() {
    const h=this.host.magnifySurface().clientHeight;
    if(h>0 && this.sheetHeight>0) this.sheetExtentEl.style.height=`${Math.ceil(this.sheetHeight/h)*h}px`;
  }

  private pageHeight(): number {
    return Math.max(1, this.host.magnifySurface().clientHeight);
  }

  private pageCount(): number {
    const surface = this.host.magnifySurface();
    return Math.max(1, Math.ceil(surface.scrollHeight / this.pageHeight()));
  }

  private currentPage(): number {
    const top = this.host.magnifySurface().scrollTop;
    let best = 0;
    let distance = Infinity;
    for (let page = 0; page < this.pageCount(); page++) {
      const d = Math.abs(top - this.pageOffset(page));
      if (d < distance) {
        best = page;
        distance = d;
      }
    }
    return best;
  }

  private pageOffset(page: number): number {
    const surface = this.host.magnifySurface();
    const maxScroll = Math.max(0, surface.scrollHeight - surface.clientHeight);
    return Math.min(page * this.pageHeight(), maxScroll);
  }

  private setPage(page: number) {
    const surface = this.host.magnifySurface();
    const clamped = Math.max(0, Math.min(this.pageCount() - 1, page));
    const previousTop = surface.scrollTop;
    surface.scrollTop = this.pageOffset(clamped);
    this.updatePageNav();
    if (surface.scrollTop !== previousTop) this.host.magnifyVisualChanged?.();
  }

  private updatePageNav() {
    const label = this.pageNavEl.querySelector<HTMLElement>(".magnify-page-label");
    if (label) label.textContent = `${this.currentPage() + 1} / ${this.pageCount()}`;
    const buttons = this.pageNavEl.querySelectorAll<HTMLButtonElement>(".magnify-view-navigation button");
    const surface = this.host.magnifySurface();
    // Auto-follow may scroll only part of a view. Up must still be available immediately,
    // rather than waiting until the nearest numbered view changes to 2.
    buttons[0].disabled = surface.scrollTop <= 0;
    buttons[1].disabled = surface.scrollTop >= Math.max(0, surface.scrollHeight - surface.clientHeight);
  }

  private showTargetPage(target = this.model.target) {
    if (!target) return;
    const surface = this.host.magnifySurface();
    const g = this.padGeometry();
    const m = this.model.settings.magnification;
    const baseline = (target.line + 1) * this.host.magnifyLineHeight();
    const top = Math.max(0, baseline - g.baselineY / m);
    const bottom = baseline + (g.height - g.baselineY) / m;
    const rect = surface.getBoundingClientRect();
    const nav = this.pageNavEl?.getBoundingClientRect();
    const left = rect.left + target.x - (g.focusX ?? g.width * BACK_CONTEXT_FRACTION) / m - surface.scrollLeft;
    const right = left + g.width / m;
    // Only reserve the floating navigation when this crop crosses its horizontal span.
    // Scroll minimally, never clamp the writing destination to the last visible ruled row.
    const safeHeight = nav && nav.height > 0 && right > nav.left && left < nav.right
      ? Math.max(1, Math.min(surface.clientHeight, nav.top - rect.top - 8))
      : surface.clientHeight;
    const previousTop = surface.scrollTop;
    if (safeHeight > 0 && bottom > previousTop + safeHeight) surface.scrollTop = bottom - safeHeight;
    else if (top < previousTop) surface.scrollTop = top;
    this.updatePageNav();
    if (surface.scrollTop !== previousTop) this.host.magnifyVisualChanged?.();
  }

  // ---- geometry ----
  private padGeometry(): PadGeometry {
    const h = Math.round(window.innerHeight * PAD_FRACTION) - CONTROLS_HEIGHT - STATUS_HEIGHT - 6;
    const height = this.viewportEl?.clientHeight || Math.max(100, h);
    const width = this.viewportEl?.clientWidth || window.innerWidth;
    // Keep the baseline just above the vertical centre. The old 58% position clipped long
    // descenders against the control bar and pushed the inverse target above the first page.
    const baselineY = Math.round(height * 0.54);
    const m =
      (this.model ? this.model.settings.magnification : this.loadSettings().magnification) ?? 2.5;
    const bodyPad = this.host.magnifyLineHeight() * 0.55 * m; // x-height above baseline
    return {
      width,
      height,
      baselineY,
      xHeightY: Math.max(12, Math.round(baselineY - bodyPad)),
      focusX: Math.round(width * BACK_CONTEXT_FRACTION),
    };
  }

  private sizeCanvas() {
    const g = this.padGeometry();
    const w = this.viewportEl.clientWidth || window.innerWidth;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(g.height * this.dpr);
    this.canvas.style.height = `${g.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawPad();
  }

  // ---- target ----
  /** Keep the inverse pad viewport wholly inside the currently visible document area. */
  private boundTarget(target: MagnifyTarget): MagnifyTarget {
    const surface = this.host.magnifySurface();
    const lane = this.host.magnifyLane();
    const g = this.padGeometry();
    const m = this.model.settings.magnification;
    const lh = this.host.magnifyLineHeight();
    const boxWidth = g.width / m;
    const boxHeight = g.height / m;
    const focusOffset = (g.focusX ?? g.width * BACK_CONTEXT_FRACTION) / m;
    const visibleLeft = surface.scrollLeft;
    const visibleWidth = surface.clientWidth || lane.pageWidth;
    const minX = Math.max(lane.leftX, visibleLeft + focusOffset);
    const maxX = Math.max(
      minX,
      Math.min(lane.pageWidth, visibleLeft + visibleWidth - (boxWidth - focusOffset))
    );
    let line = Math.max(0, target.line);
    if (surface.clientHeight > 0) {
      const visibleTop = surface.scrollTop;
      const baselineOffset = g.baselineY / m;
      const belowBaseline = boxHeight - baselineOffset;
      // At the very start of the document the pad baseline can sit a few pixels lower than
      // the first ruled-line pitch. Rejecting that tiny, natural overlap into the workspace's
      // existing top padding skips the entire first line. Allow exactly that baseline excess
      // on page one; scrolled pages still keep the target strictly inside their visible area.
      const topAllowance = visibleTop === 0 ? Math.max(0, baselineOffset - lh) : 0;
      const minLine = Math.max(
        0,
        Math.ceil((visibleTop - topAllowance + baselineOffset) / lh) - 1
      );
      const maxLine = Math.max(
        minLine,
        Math.floor((visibleTop + surface.clientHeight - belowBaseline) / lh) - 1
      );
      line = Math.max(minLine, Math.min(maxLine, line));
    }
    if(this.sheetHeight>0)line=Math.min(line,Math.max(0,Math.floor(this.sheetHeight/lh)-1));
    return { ...target, line, x: Math.max(minX, Math.min(maxX, Math.round(target.x))) };
  }

  private chooseBoundedTarget(target: MagnifyTarget) {
    this.redoPadStrokes = []; // pad-local coordinates belong to this exact target/scale
    // Commands may advance across the visible upper-page boundary. Scroll to that page before
    // clamping; clamping first pins New line/Next target to the final visible line forever.
    this.showTargetPage(target);
    this.model.chooseTarget(this.boundTarget(target));
  }

  private setTargetFromPoint(x: number, y: number, live = false) {
    if (this.model.padStrokes.length > 0) this.place(); // moving the target places first
    const lh = this.host.magnifyLineHeight();
    const bounded = this.boundTarget({ afterWord: -1, line: Math.floor(y / lh), x });
    bounded.afterWord = this.host.magnifySlotAt(
      bounded.x,
      (bounded.line + 0.5) * lh
    );
    this.model.chooseTarget(bounded);
    this.renderTarget(live);
    this.drawPad();
  }

  private moveTargetGuide(x: number, y: number) {
    const lh = this.host.magnifyLineHeight();
    const t = this.boundTarget({
      afterWord: this.model.target?.afterWord ?? -1,
      line: Math.floor(y / lh),
      x,
    });
    this.positionTargetBox(t);
  }

  private positionTargetBox(t: MagnifyTarget) {
    const lh = this.host.magnifyLineHeight();
    const g = this.padGeometry();
    const m = this.model.settings.magnification;
    const focusX = g.focusX ?? g.width * BACK_CONTEXT_FRACTION;
    const docBaseline = (t.line + 1) * lh;
    this.targetEl.style.display = "";
    this.targetEl.style.left = `${t.x - focusX / m}px`;
    this.targetEl.style.top = `${docBaseline - g.baselineY / m}px`;
    this.targetEl.style.height = `${g.height / m}px`;
    this.targetEl.style.width = `${g.width / m}px`;
    const label = this.targetEl.querySelector<HTMLElement>("span");
    if (label) label.style.left = `${focusX / m + 4}px`;
  }

  private renderTarget(live = false) {
    const t = this.model.target;
    if (!t) {
      this.targetEl.style.display = "none";
      this.contextEl.replaceChildren();
      return;
    }
    this.positionTargetBox(t);
    // Crop the bottom of the current document page and snap only when the target crosses a
    // page boundary. This keeps readable text anchored at the top and avoids repaint churn.
    if (!live) this.showTargetPage();
    this.renderContext();
    if (!live) this.host.magnifyVisualChanged?.();
  }

  private renderContext() {
    const target = this.model.target;
    if (!target) return;
    const badge = document.createElement("span");
    badge.className = "magnify-context-badge";
    badge.textContent = this.inkMode ? (this.eraseMode ? "Erase ink" : "Write below") : "Tap below to write";
    const hint = document.createElement("span");
    hint.className = "magnify-context-hint";
    hint.textContent = `${this.model.settings.magnification.toFixed(1)}×`;
    this.contextEl.replaceChildren(badge, hint);
    this.drawPad();
  }

  // ---- pad pointer capture (preview input path; daemon attach is DEV-W) ----
  private wirePadPointer() {
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", (e) => {
      this.host.magnifyDismissToolSettings?.();
      if (e.pointerType === "touch") return;
      if (this.live || this.erasePointer !== null) return;
      if (!this.inkMode) {
        // The first lower tap is a deliberate persistent mode switch, not the first ink dot.
        this.inkMode = true;
        this.viewportEl.classList.remove("web-mode");
        this.viewportEl.classList.add("ink-mode");
        this.renderContext();
        this.host.magnifyTargeting?.(false);
        e.preventDefault();
        return;
      }
      const barrelErase = (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0;
      // On device the daemon already receives and renders normal pen gestures. Android also lets
      // those MotionEvents reach the WebView; accepting both paths duplicates every stroke in the
      // model. Only eraser gestures deliberately pass through to this WebView handler.
      if (this.host.magnifyNativeActive?.() && !this.eraseMode && !barrelErase) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events (tests/QA) have no active pointer to capture */
      }
      if (this.eraseMode || barrelErase) {
        this.erasePrevious=null;
        this.erasePointer = e.pointerId;
        this.eraseLassoPoints=[];
        this.eraseAtPadPoint(e, true);
        e.preventDefault();
        return;
      }
      this.redoPadStrokes = [];
      this.model.penDidGoDown();
      const r = this.canvas.getBoundingClientRect();
      this.live = {
        pointerId: e.pointerId,
        points: [
          { x: e.clientX - r.left, y: e.clientY - r.top, t: Date.now(), pressure: e.pressure || 0.6 },
        ],
      };
    });
    this.canvas.addEventListener("pointerleave",()=>{this.eraserCursor.hidden=true;});
    this.canvas.addEventListener("pointermove", (e) => {
      if(this.eraseMode && this.eraserMode!=="lasso" && e.pointerType!=="touch") {
        const r=this.canvas.getBoundingClientRect();this.eraserCursor.hidden=false;
        this.eraserCursor.style.width=this.eraserCursor.style.height=`${this.eraserDiameter}px`;
        this.eraserCursor.style.left=`${e.clientX-r.left}px`;this.eraserCursor.style.top=`${e.clientY-r.top}px`;
      }
      if (this.erasePointer === e.pointerId) {
        this.eraseAtPadPoint(e, false);
        e.preventDefault();
        return;
      }
      if (!this.live || e.pointerId !== this.live.pointerId) return;
      const r = this.canvas.getBoundingClientRect();
      this.live.points.push({
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        t: Date.now(),
        pressure: e.pressure || 0.6,
      });
      this.drawPad();
    });
    const finish = (e: PointerEvent) => {
      if (this.erasePointer === e.pointerId) {
        this.eraseAtPadPoint(e, false);
        if(this.eraserMode==="lasso" && validLasso(this.eraseLassoPoints)) {
          const polygon=this.eraseLassoPoints;
          const target=this.model.target, g=this.padGeometry(),m=this.model.settings.magnification;
          const map=(p:InkPoint):InkPoint=>({...p,x:target!.x+(p.x-(g.focusX??g.width*BACK_CONTEXT_FRACTION))/m,y:(target!.line+1)*this.host.magnifyLineHeight()+(p.y-g.baselineY)/m});
          // Settle pending vectors before the host takes its erase Undo snapshot. This keeps
          // lasso deletion reversible even when Zoom closes before Undo is pressed.
          if(target&&this.host.magnifyEraseLasso){
            this.host.magnifyEraseLasso(polygon.map(map),this.model.padStrokes.map(stroke=>({...stroke,points:stroke.points.map(map)})),target.line);
            this.model.restorePadStrokes([]);
          }
          this.eraseLassoPoints=[];this.drawPad();
        }
        this.erasePointer = null;
        this.erasePrevious = null;
        this.eraserCursor.hidden=true;
        this.host.magnifyVisualChanged?.();
        e.preventDefault();
        return;
      }
      if (!this.live || e.pointerId !== this.live.pointerId) return;
      const pts = this.live.points;
      this.live = null;
      if (pts.length >= 2 && (e.type === "pointercancel" || !this.tryScribble(pts))) {
        const style = this.host.magnifyInkStyle?.() ?? { color: "#000000", width: 4 };
        this.model.addStroke({
          id: `mp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          tool: "pen",
          color: style.color,
      brushStyle: "brushStyle" in style ? style.brushStyle : "pen",
          width: style.width,
          points: pts,
          bounds: boundsOfPoints(pts),
        });
      }
      this.drawPad();
    };
    this.canvas.addEventListener("pointerup", finish);
    this.canvas.addEventListener("pointercancel", finish);
  }

  private tryScribble(points: InkPoint[]): boolean {
    const target = this.model.target;
    const m = this.model.settings.magnification;
    if (!target || !this.host.magnifyScribble || !scribble.candidate(points, this.host.magnifyLineHeight()*m)) return false;
    const g = this.padGeometry();
    const map = (p: InkPoint): InkPoint => ({ ...p,
      x: target.x+(p.x-(g.focusX ?? g.width*BACK_CONTEXT_FRACTION))/m,
      y: (target.line+1)*this.host.magnifyLineHeight()+(p.y-g.baselineY)/m });
    const before = this.model.padStrokes.slice();
    const mapped = before.map(s => ({ ...s, points: s.points.map(map) }));
    const erased = this.host.magnifyScribble(points.map(map), mapped, remaining => {
      this.model.restorePadStrokes(before.filter((_,i) => remaining.includes(mapped[i])));
      this.drawPad();
    });
    if (erased) { this.host.magnifyVisualChanged?.(); this.saveDraft(); }
    return erased;
  }

  private eraseAtPadPoint(e: PointerEvent, begin: boolean) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if(this.eraserMode==="lasso") {
      this.eraseLassoPoints.push({x,y,t:Date.now(),pressure:.5});this.drawPad();
      this.ctx.beginPath();this.ctx.setLineDash([3,5]);
      this.eraseLassoPoints.forEach((p,i)=>i?this.ctx.lineTo(p.x,p.y):this.ctx.moveTo(p.x,p.y));
      this.ctx.strokeStyle="#000";this.ctx.lineWidth=1;this.ctx.stroke();this.ctx.setLineDash([]);return;
    }
    this.eraserCursor.hidden=false;
    this.eraserCursor.style.width=this.eraserCursor.style.height=`${this.eraserDiameter}px`;
    this.eraserCursor.style.left=`${x}px`;this.eraserCursor.style.top=`${y}px`;
    const from=this.erasePrevious??{x,y};
    const steps=Math.max(1,Math.ceil(Math.hypot(x-from.x,y-from.y)/Math.max(2,this.eraserDiameter/4)));
    const target = this.model.target;
    const g=this.padGeometry(),m=this.model.settings.magnification;
    for(let i=1;i<=steps;i++) {
      const px=from.x+(x-from.x)*i/steps,py=from.y+(y-from.y)*i/steps;
      this.model.erasePadAt(px,py,this.eraserDiameter/2,this.eraserMode);
      if(target&&this.host.magnifyEraseAt) this.host.magnifyEraseAt({
        x:target.x+(px-(g.focusX??g.width*BACK_CONTEXT_FRACTION))/m,
        y:(target.line+1)*this.host.magnifyLineHeight()+(py-g.baselineY)/m,
        t:Date.now(),pressure:e.pressure||.5,
      },begin&&i===1,this.eraserDiameter/(2*m),this.eraserMode);
    }
    this.erasePrevious={x,y};
    this.drawPad();
  }

  // ---- drawing ----
  private drawPad() {
    const g = this.padGeometry();
    const w = this.canvas.width / this.dpr;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, g.height);
    this.scene.setAttribute("viewBox", `0 0 ${w} ${g.height}`);
    this.scene.setAttribute("preserveAspectRatio", "none");
    const target = this.model.target;
    if (!target) {
      this.scene.replaceChildren();
      return;
    }
    const context = this.host.magnifyContext?.(target) ?? { words: [], strokes: [] };
    const m = this.model.settings.magnification;
    const focusX = g.focusX ?? Math.round(w * BACK_CONTEXT_FRACTION);
    const lh = this.host.magnifyLineHeight();
    const docBaseline = (target.line + 1) * lh;
    const tx = (x: number) => focusX + (x - target.x) * m;
    const ty = (y: number) => g.baselineY + (y - docBaseline) * m;

    // Actual ruled page at magnified scale, not an abstract handwriting guide. Static magnifier
    // content is SVG/DOM because Android WebView reliably captures it even while the opaque native
    // ink surface occludes the WebView; an updated canvas backing store was captured as stale white.
    const ns = "http://www.w3.org/2000/svg";
    const frag = document.createDocumentFragment();
    const firstLine = Math.floor(target.line - g.baselineY / (lh * m)) - 1;
    const lastLine = Math.ceil(target.line + (g.height - g.baselineY) / (lh * m)) + 1;
    for (let line = Math.max(0, firstLine); line <= lastLine && (this.sheetHeight<=0||(line+1)*lh<=this.sheetHeight); line++) {
      const y = ty((line + 1) * lh);
      const rule = document.createElementNS(ns, "line");
      rule.setAttribute("x1", "0");
      rule.setAttribute("x2", String(w));
      rule.setAttribute("y1", String(y));
      rule.setAttribute("y2", String(y));
      rule.setAttribute("stroke", "#000");
      rule.setAttribute("stroke-width", "1");
      frag.appendChild(rule);
    }

    // Typed words occupy their real document positions.
    for (const word of context.words) {
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", String(tx(word.x)));
      text.setAttribute("y", String(ty((word.line + 1) * lh - (context.baselineInset ?? lh * 0.22))));
      text.setAttribute("fill", "#000");
      text.setAttribute("font-size", String((context.fontSize ?? 19) * m));
      text.setAttribute("font-family", 'system-ui, -apple-system, "Segoe UI", sans-serif');
      text.textContent = word.text;
      if(word.fragments?.length)text.replaceChildren(...word.fragments.map(run=>{
        const span=document.createElementNS(ns,'tspan');span.textContent=run.text;
        span.setAttribute('font-weight',/(?:^|\s)(?:700|bold)(?:\s|$)/.test(run.font)?'700':'400');
        span.setAttribute('font-style',run.font.includes('italic')?'italic':'normal');
        if(run.strike)span.setAttribute('text-decoration','line-through');
        return span;
      }));
      frag.appendChild(text);
    }

    // Existing committed handwriting is transformed with the very same document→viewport map.
    for (const stroke of context.strokes) {
      if (stroke.points.length < 2) continue;
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", stroke.points.map((point, i) =>
        `${i === 0 ? "M" : "L"}${tx(point.x)} ${ty(point.y)}`
      ).join(" "));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke.color);
      path.setAttribute("stroke-width", String(Math.max(1, stroke.width * m)));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      frag.appendChild(path);
    }

    this.scene.replaceChildren(frag);

    // Unplaced device ink belongs only to the daemon overlay. Drawing it into the WebView as well
    // makes a later snapshot contain one copy while retained native vectors add a second copy.
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (!this.host.magnifyNativeActive?.() || this.eraseMode) this.strokePaths(ctx, this.model.padStrokes, 1);
    if (this.live && this.live.points.length > 1) {
      const style = this.host.magnifyInkStyle?.() ?? { color: "#000000", width: 4 };
      ctx.lineWidth = style.width;
      ctx.strokeStyle = style.color;
      const pts = this.live.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  private strokePaths(ctx: CanvasRenderingContext2D, strokes: InkStroke[], scale: number) {
    for (const s of strokes) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * scale);
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * scale, s.points[0].y * scale + (scale < 1 ? this.padGeometry().baselineY * (1 - scale) : 0));
      for (const p of s.points)
        ctx.lineTo(p.x * scale, p.y * scale + (scale < 1 ? this.padGeometry().baselineY * (1 - scale) : 0));
      ctx.stroke();
    }
  }

  // ---- controls ----
  private controlButton(icon: string, title: string, action: () => void): HTMLButtonElement {
    const paths: Record<string, string> = {
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      prev: '<path d="M15 5l-7 7 7 7"/>', next: '<path d="M9 5l7 7-7 7"/>',
      up: '<path d="M5 15l7-7 7 7"/>', down: '<path d="M5 9l7 7 7-7"/>',
      newLine: '<path d="M19 5v9H5m5-5-5 5 5 5"/>',
      undo: '<path d="M9 8H4V3m0 5c3-4 9-5 13-1s3 10-1 13"/>',
      eraser: '<path d="M5 15l7-9 7 6-6 7H8zM11 19h9"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/><circle cx="12" cy="12" r="7"/>',
    };
    const b = document.createElement("button");
    b.title = title;
    b.setAttribute("aria-label", title);
    b.type = "button";
    if (paths[icon]) b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[icon]}</svg>`;
    else b.textContent = icon;
    bindPenButton(b, action);
    return b;
  }

  private buildControls(): HTMLElement {
    const row = document.createElement("div");
    row.className = "magnify-controls";
    const btn = (label: string, title: string, fn: () => void) => {
      const b = this.controlButton(label, title, fn);
      row.appendChild(b);
      return b;
    };
    btn("prev", "Previous target", () => this.runCommand(() => this.nudgeTarget(-1)));
    btn("next", "Next target", () => this.runCommand(() => this.nudgeTarget(1)));
    btn("newLine", "New line", () => this.runCommand(() => this.newLine()));
    btn("settings", "Magnify settings", () => this.runCommand(() => this.toggleSettings()));
    const close = btn("close", "Close magnified writing", () => this.requestClose());
    close.className = "magnify-close";
    return row;
  }

  /** The main toolbar is the single owner of tool choice and eraser settings. */
  syncEraserSettings() {
    const settings=this.host.magnifyEraserSettings?.();
    if(!settings)return;
    this.eraserDiameter=settings.diameter;this.eraserMode=settings.mode;this.eraseMode=settings.active;
    this.eraserCursor.hidden=true;
    this.host.magnifyErasing?.(settings.active);
    this.renderContext();this.drawPad();
  }

  private nudgeTarget(dir: 1 | -1) {
    if (this.model.padStrokes.length > 0) this.place();
    const t = this.model.target;
    if (!t) return;
    const lane = this.host.magnifyLane();
    const lh = this.host.magnifyLineHeight();
    const step = lh * 2;
    if (dir > 0) this.chooseBoundedTarget(advanceTarget({ ...t, x: t.x + step - lh * 0.35 }, 0, lane));
    else {
      let x = t.x - step;
      let line = t.line;
      if (x < lane.leftX) {
        line = Math.max(0, line - 1);
        x = line === t.line ? lane.leftX : lane.pageWidth - step;
      }
      this.chooseBoundedTarget({ afterWord: this.host.magnifySlotAt(x, (line + 0.5) * lh), line, x });
    }
    this.renderTarget();
  }

  private newLine() {
    if (this.model.padStrokes.length > 0) this.place();
    const t = this.model.target;
    if (!t) return;
    const lane = this.host.magnifyLane();
    const lh = this.host.magnifyLineHeight();
    this.chooseBoundedTarget({
      afterWord: this.host.magnifySlotAt(lane.leftX, (t.line + 1.5) * lh),
      line: t.line + 1,
      x: lane.leftX,
    });
    this.renderTarget();
  }

  /** Hardware page keys move Previous/Next while the pad is open. */
  onPageKey(direction: 1 | -1) {
    this.runCommand(() => this.nudgeTarget(direction));
  }

  place() {
    if (this.model.padStrokes.length === 0) return;
    const commit = (text: string | null) => {
      const res = this.model.place(text);
      if (res.status !== "ok") return;
      this.applyPayload(res.payload);
      this.chooseBoundedTarget(res.nextTarget);
      this.renderTarget();
      this.drawPad();
    };
    if (this.model.settings.placement === "text" && this.host.magnifyRecognize) {
      this.host.magnifyRecognize(this.model.padStrokes, commit);
    } else {
      commit(null);
    }
  }

  private applyPayload(payload: PlacePayload) {
    if (payload.kind === "text" && payload.text && this.host.placeMagnifiedText) {
      this.host.placeMagnifiedText(payload.text, payload.target.afterWord);
    } else {
      this.host.placeMagnifiedGroup(payload.strokes, payload.target.line);
    }
  }

  /** Expanded toolbar owns Undo; its caller has already drained native ink. */
  undo() {
    if (this.host.magnifyUndoScribble?.()) { this.drawPad(); this.host.magnifyVisualChanged?.(); return; }
    // A toolbar press flushes completed native vectors first. Undo the newest unplaced
    // stroke before an earlier document transaction; otherwise it would remain visible.
    if (this.model.padStrokes.length) {
      this.redoPadStrokes.push(this.model.padStrokes[this.model.padStrokes.length - 1]);
      this.model.restorePadStrokes(this.model.padStrokes.slice(0, -1));
      this.drawPad();
      this.host.magnifyVisualChanged?.();
      this.saveDraft();
      return;
    }
    this.model.undoLastPlace();
    this.host.magnifyUndo(); // one commit = one workspace history item
    this.renderTarget();
    this.drawPad();
  }

  redoPendingStroke(): boolean {
    const stroke = this.redoPadStrokes.pop();
    if (!stroke) return false;
    this.model.restorePadStrokes([...this.model.padStrokes, stroke]);
    this.drawPad();
    this.host.magnifyVisualChanged?.();
    this.saveDraft();
    return true;
  }

  /** A workspace Redo changes document context, not staged pad coordinates. */
  refreshContext() { this.renderTarget(); }

  // ---- settings ----
  private loadSettings(): Partial<MagnifySettings> {
    try {
      const settings = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Partial<MagnifySettings>;
      // Placement is always automatic now; old per-user Off/manual values are ignored.
      settings.autoPlaceMs = 400;
      return settings;
    } catch {
      return {};
    }
  }

  private saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.model.settings));
    } catch {
      /* full/unavailable */
    }
  }

  private toggleSettings() {
    if (this.settingsEl) {
      this.settingsEl.remove();
      this.settingsEl = null;
      return;
    }
    const s = this.model.settings;
    const el = document.createElement("div");
    el.className = "magnify-settings";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Zoom settings");
    const header = document.createElement("div");
    header.className = "magnify-settings-header";
    const heading = document.createElement("strong");
    heading.textContent = "Zoom settings";
    const done = this.controlButton("close", "Close zoom settings", () => this.toggleSettings());
    header.append(heading, done);
    el.append(header);
    const select = (label: string, opts: Array<[string, string]>, cur: string, set: (v: string) => void) => {
      let current = cur;
      const l = document.createElement("label");
      l.textContent = label;
      const sel = document.createElement("select");
      for (const [v, txt] of opts) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = txt;
        o.selected = v === cur;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => {
        const value = sel.value;
        this.runCommand(() => {
          if (this.closed || this.settingsEl !== el) return;
          // Finish ink using the scale at which it was drawn before changing its mapping.
          if (this.model.padStrokes.length) this.place();
          if (this.model.padStrokes.length) { sel.value = current; return; }
          set(value);
          current = value;
          this.saveSettings();
          this.padEl.className = `magnify-pad hand-${this.model.settings.handedness}`;
          this.model.relayout(this.host.magnifyLane(), this.padGeometry());
          if (this.model.target) this.chooseBoundedTarget(this.model.target);
          this.renderTarget();
        });
      });
      l.appendChild(sel);
      el.appendChild(l);
    };
    select("Magnify", [["2", "2×"], ["2.5", "2.5×"], ["3", "3×"]], String(s.magnification), (v) => {
      s.magnification = Number(v);
    });
    select("Advance", [["word", "After each word"], ["manual", "Manual only"]], s.advance, (v) => {
      s.advance = v as MagnifySettings["advance"];
    });
    select("Hand", [["right", "Right"], ["left", "Left"]], s.handedness, (v) => {
      s.handedness = v as MagnifySettings["handedness"];
    });
    select("Placement", [["ink", "Ink"], ["text", "Convert to text"]], s.placement, (v) => {
      s.placement = v as MagnifySettings["placement"];
    });
    this.padEl.appendChild(el);
    this.settingsEl = el;
  }

  // ---- close / pause ----
  requestClose() {
    this.runCommand(() => this.requestCloseNow());
  }

  private requestCloseNow() {
    // There is no manual Place step: closing drains and commits any final daemon batch first.
    if (this.model.padStrokes.length > 0) this.place();
    if (this.model.padStrokes.length > 0) return; // asynchronous recognition is still pending
    if (this.model.requestClose()) {
      this.dispose();
    }
  }

  /** App pause: save a recoverable draft; commits are seq-guarded against replay. */
  saveDraft() {
    const draft = this.model.serializeDraft();
    try {
      if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* unavailable */
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    const paperStyle=this.host.magnifySurface().style;
    paperStyle.backgroundSize=this.savedPaperStyle.size;paperStyle.backgroundRepeat=this.savedPaperStyle.repeat;paperStyle.backgroundAttachment=this.savedPaperStyle.attachment;
    this.host.magnifyErasing?.(false);
    this.host.magnifyTargeting?.(false);
    window.clearInterval(this.idleTimer);
    if (this.targetRaf !== null) cancelAnimationFrame(this.targetRaf);
    window.removeEventListener("resize", this.resizeHandler);
    this.host.magnifySurface().removeEventListener("scroll", this.scrollHandler);
    this.host.magnifySurface().removeEventListener("click", this.surfaceCapture, true);
    this.host.magnifySurface().removeEventListener("pointerdown", this.surfacePointerDown, true);
    this.host.magnifySurface().removeEventListener("pointermove", this.surfacePointerMove, true);
    this.host.magnifySurface().removeEventListener("pointerup", this.surfacePointerUp, true);
    this.host.magnifySurface().removeEventListener("pointercancel", this.surfacePointerUp, true);
    this.targetEl.remove();
    this.sheetExtentEl.remove();
    this.pageNavEl.remove();
    this.padEl.remove();
    this.workspaceEl?.classList.remove("magnify-open");
    document.body.classList.remove("magnify-active");
    this.host.onMagnifyClosed?.();
  }
}
