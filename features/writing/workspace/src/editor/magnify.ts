// Magnified writing mode — pure model (AFK-W1; roadmap §5). Samsung Notes-style: the user
// writes LARGE in a lower pad lane; committed strokes are scaled onto the target ruled line of
// the document and flow through the existing PenWorkspace insert/reflow machinery.
//
// This module owns NO DOM and NO daemon calls: it is the state machine, the target-anchor
// model, the pad→document affine mapping, word grouping, draft recovery, and the
// double-commit guard. The workspace/daemon integration (AFK-W2) drives it.
//
//   closed → choosing-target → writing ⇄ placing
//                            ↘ discard-confirm → closed
//
// Contracts (roadmap §5.4/§5.5):
//  - a target is a stable ReflowDoc anchor (afterWord + line + x), never a raw screen point;
//  - pad strokes stay pad-local until commit; ONE affine scale/translation maps pad baseline
//    and body height onto the target lane baseline; pressure and relative timing survive;
//  - pathological scales clamp, and an unvalidatable transform keeps the pad draft;
//  - one place() = one commit payload = one history item; commits are sequence-guarded so a
//    recovered draft can never replay an already-committed group;
//  - the native stroke batch must be drained before place/undo/close/target moves — the model
//    refuses ('needs-drain') until notifyDrained().

import type { InkPoint, InkStroke } from "../ink/types";
import { boundsOfPoints, boundsUnion, emptyBounds, type Bounds } from "../ink/types";
import { eraseStrokeAtPoint, type EraseMode } from "../ink/erase";

export type MagnifyPhase =
  | "closed"
  | "choosing-target"
  | "writing"
  | "placing"
  | "discard-confirm";

/** Stable document anchor for placement (insert semantics — see reflowModel.Insert). */
export type MagnifyTarget = {
  /** Index of the word the placed ink follows; -1 = before the first word. */
  afterWord: number;
  /** Target ruled line (document workspace lines, 0-based like PenWorkspace lanes). */
  line: number;
  /** X where placed ink starts on that line (workspace px). */
  x: number;
};

/** Geometry of the magnified pad lane, in pad-local px. */
export type PadGeometry = {
  width: number;
  height: number;
  /** Pad ruled baseline y. */
  baselineY: number;
  /** Pad x-height guide y (above the baseline). */
  xHeightY: number;
  /** Actual magnifier mode: document target x is rendered at this pad-local x. */
  focusX?: number;
};

/** Geometry of the destination, in document workspace px. */
export type LaneGeometry = {
  lineHeight: number;
  /** Usable line width — placement wraps beyond it. */
  pageWidth: number;
  /** Left margin x used after a wrap. */
  leftX: number;
};

export type MagnifySettings = {
  magnification: number; // 2 | 2.5 | 3
  autoPlaceMs: number; // idle pause before automatic placement
  advance: "word" | "manual";
  handedness: "left" | "right";
  placement: "ink" | "text";
};

export const DEFAULT_SETTINGS: MagnifySettings = {
  magnification: 2.5,
  autoPlaceMs: 400,
  advance: "word",
  handedness: "right",
  placement: "ink",
};

/** Clamp bounds for the pad→doc scale — outside this the transform is treated as invalid. */
export const SCALE_MIN = 0.15;
export const SCALE_MAX = 1.25;

/** Spacing between consecutively placed groups, as a fraction of line height. */
const ADVANCE_SPACING = 0.35;

// ---------------------------------------------------------------------------------------------
// pad → document mapping
// ---------------------------------------------------------------------------------------------

function strokesBounds(strokes: InkStroke[]): Bounds {
  let b = emptyBounds();
  for (const s of strokes) b = boundsUnion(b, boundsOfPoints(s.points));
  return b;
}

/**
 * The single affine map: pad baseline → target-line baseline, pad body height → document body
 * height (scale = 1/magnification), pad-left → target x. Pressure, tilt and ABSOLUTE t are
 * preserved per point (relative timing therefore survives untouched).
 * Returns null when the transform cannot be validated (empty ink, non-finite geometry, or a
 * clamped-out scale) — the caller must then keep the pad draft instead of committing.
 */
export function mapPadStrokes(
  strokes: InkStroke[],
  pad: PadGeometry,
  lane: LaneGeometry,
  target: MagnifyTarget,
  magnification: number
): { strokes: InkStroke[]; bounds: Bounds; scale: number } | null {
  if (strokes.length === 0) return null;
  if (!isFinite(magnification) || magnification <= 0) return null;
  const scale = 1 / magnification;
  if (scale < SCALE_MIN || scale > SCALE_MAX) return null;
  const b = strokesBounds(strokes);
  if (!isFinite(b.x) || !isFinite(b.y) || b.width < 0) return null;

  // Document baseline of the target line — the same convention packedInkTop() recovers from:
  // a run whose baselineOffset lands it on rule (line+1)*lineHeight sits ON that lane.
  const docBaselineY = (target.line + 1) * lane.lineHeight;
  // Legacy blank-pad mode anchors the left edge of the written group at the target. The real
  // magnifier supplies focusX, so a point written over magnified content maps back to that exact
  // document coordinate instead of being re-anchored by the stroke's bounding box.
  const dx = (x: number) => target.x + (x - (pad.focusX ?? b.x)) * scale;
  const dy = (y: number) => docBaselineY + (y - pad.baselineY) * scale;

  const mapped = strokes.map((s) => {
    const points: InkPoint[] = s.points.map((p) => ({
      ...p,
      x: dx(p.x),
      y: dy(p.y),
    }));
    return {
      ...s,
      // Zoom changes the handwriting's size, not the selected pen thickness.
      width: s.width,
      points,
      bounds: boundsOfPoints(points),
    };
  });
  const outBounds = strokesBounds(mapped);
  if (!isFinite(outBounds.x) || !isFinite(outBounds.y)) return null;
  return { strokes: mapped, bounds: outBounds, scale };
}

// ---------------------------------------------------------------------------------------------
// word grouping (pen-pause segmentation for auto-advance)
// ---------------------------------------------------------------------------------------------

/** Split an ordered stroke list into word groups at pen pauses ≥ pauseMs. */
export function groupStrokesByPause(strokes: InkStroke[], pauseMs: number): InkStroke[][] {
  const groups: InkStroke[][] = [];
  let current: InkStroke[] = [];
  let lastEnd = -Infinity;
  for (const s of strokes) {
    if (s.points.length === 0) continue;
    const start = s.points[0].t;
    if (current.length > 0 && start - lastEnd >= pauseMs) {
      groups.push(current);
      current = [];
    }
    current.push(s);
    lastEnd = s.points[s.points.length - 1].t;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// ---------------------------------------------------------------------------------------------
// target advance
// ---------------------------------------------------------------------------------------------

/**
 * Next target after placing a group of document-space width `placedWidth` at `target`.
 * Wraps to the next ruled line when past the page edge — the WHOLE next word starts on the new
 * line (a single handwritten word is never split; the reflow engine handles downstream pushes).
 */
export function advanceTarget(
  target: MagnifyTarget,
  placedWidth: number,
  lane: LaneGeometry
): MagnifyTarget {
  const spacing = lane.lineHeight * ADVANCE_SPACING;
  let x = target.x + placedWidth + spacing;
  let line = target.line;
  if (x > lane.pageWidth - spacing) {
    line += 1;
    x = lane.leftX;
  }
  // afterWord is unchanged: consecutive inserts at one anchor keep array order = reading
  // order (reflowModel.orderedFlow), which is exactly how successive placed words read.
  return { afterWord: target.afterWord, line, x };
}

// ---------------------------------------------------------------------------------------------
// draft recovery + the model itself
// ---------------------------------------------------------------------------------------------

export type MagnifyDraft = {
  v: 1;
  target: MagnifyTarget;
  strokes: InkStroke[];
  /** Sequence guard: a draft captured at seq N is dead once placedSeq ≥ N. */
  seq: number;
  savedAt: number;
};

export type PlacePayload = {
  kind: "ink" | "text";
  target: MagnifyTarget;
  /** Document-space strokes (ink placement). */
  strokes: InkStroke[];
  bounds: Bounds;
  scale: number;
  /** Recognized text (text placement only). */
  text?: string;
  /** Monotonic commit id — one payload = one undoable history item. */
  commitSeq: number;
};

export type PlaceResult =
  | { status: "ok"; payload: PlacePayload; nextTarget: MagnifyTarget }
  | { status: "needs-drain" }
  | { status: "empty" }
  | { status: "invalid-transform" };

export class MagnifyModel {
  phase: MagnifyPhase = "closed";
  target: MagnifyTarget | null = null;
  padStrokes: InkStroke[] = [];
  settings: MagnifySettings;

  private pad: PadGeometry;
  private lane: LaneGeometry;
  private seq = 0; // bumps on every stroke batch added
  private placedSeq = 0; // seq consumed by the last successful place()
  private drainPending = false;
  private penDown = false;
  /** Undo/recovery drafts remain user-controlled until new pen input arrives. */
  private autoPlaceArmed = false;
  private lastPenUpAt = 0;
  /** Undo support: place() remembers what it consumed so undo can restore pad context. */
  private lastCommit: { target: MagnifyTarget; strokes: InkStroke[]; commitSeq: number } | null =
    null;

  constructor(pad: PadGeometry, lane: LaneGeometry, settings?: Partial<MagnifySettings>) {
    this.pad = pad;
    this.lane = lane;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  // ---- lifecycle ----
  open(): void {
    if (this.phase !== "closed") return;
    this.phase = "choosing-target";
  }

  chooseTarget(t: MagnifyTarget): void {
    if (this.phase === "closed") return;
    // Moving the target with unplaced ink requires an explicit decision — same as close.
    if (this.padStrokes.length > 0 && this.phase === "writing") return;
    this.target = { ...t };
    this.phase = "writing";
  }

  /** Close request. With unplaced ink this parks in discard-confirm and returns false. */
  requestClose(): boolean {
    if (this.padStrokes.length > 0) {
      this.phase = "discard-confirm";
      return false;
    }
    this.reset();
    return true;
  }

  confirmDiscard(): void {
    if (this.phase !== "discard-confirm") return;
    this.reset();
  }

  cancelClose(): void {
    if (this.phase !== "discard-confirm") return;
    this.phase = "writing";
  }

  private reset(): void {
    this.phase = "closed";
    this.target = null;
    this.padStrokes = [];
    this.drainPending = false;
    this.penDown = false;
    this.autoPlaceArmed = false;
    this.lastCommit = null;
  }

  // ---- pad ink intake ----
  penDidGoDown(): void {
    this.penDown = true;
    this.autoPlaceArmed = false;
  }

  /** A completed pad-local stroke (from pointer events or the native daemon batch). */
  addStroke(stroke: InkStroke): void {
    if (this.phase !== "writing") return;
    this.padStrokes.push(stroke);
    this.seq++;
    this.penDown = false;
    this.autoPlaceArmed = true;
    const pts = stroke.points;
    this.lastPenUpAt = pts.length ? pts[pts.length - 1].t : Date.now();
  }

  /** Restore a scribble transaction without auto-placing ink returned by Undo. */
  restorePadStrokes(strokes: InkStroke[]): void {
    this.padStrokes = strokes.slice();
    this.autoPlaceArmed = false;
    this.penDown = false;
    this.seq++;
  }

  clearPad(): void {
    this.padStrokes = [];
    this.autoPlaceArmed = false;
    this.seq++;
  }

  /** Erase uncommitted magnifier ink in pad coordinates. Committed page ink is erased by the
   * host in document coordinates, so one eraser gesture can naturally affect both layers. */
  erasePadAt(x: number, y: number, radius = 10, mode: EraseMode = "stroke"): boolean {
    const survivors = this.padStrokes.flatMap(stroke => eraseStrokeAtPoint(stroke,x,y,radius,mode));
    if (survivors.length === this.padStrokes.length && survivors.every((s,i)=>s===this.padStrokes[i])) return false;
    this.padStrokes = survivors;
    this.seq++;
    this.autoPlaceArmed = survivors.length > 0;
    return true;
  }

  // ---- native batch drain gate ----
  /** The integration flags that daemon strokes may still be in flight. */
  markDrainPending(): void {
    this.drainPending = true;
  }

  notifyDrained(): void {
    this.drainPending = false;
  }

  // ---- auto-place timing (the idle race) ----
  /**
   * True when the idle timer may fire: never while the pen is down, never mid-pause-window,
   * never with nothing to place. `now` is the same clock as InkPoint.t.
   */
  autoPlaceDue(now: number): boolean {
    if (this.settings.autoPlaceMs <= 0) return false;
    if (this.phase !== "writing") return false;
    if (this.penDown) return false;
    if (!this.autoPlaceArmed) return false;
    if (this.padStrokes.length === 0) return false;
    return now - this.lastPenUpAt >= this.settings.autoPlaceMs;
  }

  // ---- place / undo ----
  /**
   * Commit the current pad strokes to the target as ONE payload/history item.
   * `recognizedText` places text instead of ink when settings.placement === 'text'; a null
   * recognizedText under 'text' placement falls back to ink (recognition failure never loses
   * the handwriting).
   */
  place(recognizedText?: string | null): PlaceResult {
    if (this.phase !== "writing" || !this.target) return { status: "empty" };
    if (this.drainPending) return { status: "needs-drain" };
    if (this.padStrokes.length === 0) return { status: "empty" };
    if (this.seq <= this.placedSeq) return { status: "empty" }; // double-commit guard

    let mapped = mapPadStrokes(
      this.padStrokes,
      this.pad,
      this.lane,
      this.target,
      this.settings.magnification
    );
    if (!mapped) return { status: "invalid-transform" }; // pad draft stays intact

    // Whole-group wrap: use the ACTUAL mapped right edge. In real-magnifier mode the user can
    // begin to the right of the fixed caret, so target.x + width underestimates the occupied area
    // and lets handwriting escape beyond the page edge.
    if (
      this.target.x > this.lane.leftX &&
      mapped.bounds.x + mapped.bounds.width > this.lane.pageWidth
    ) {
      this.target = { ...this.target, line: this.target.line + 1, x: this.lane.leftX };
      mapped = mapPadStrokes(
        this.padStrokes,
        this.pad,
        this.lane,
        this.target,
        this.settings.magnification
      );
      if (!mapped) return { status: "invalid-transform" };
    }

    // At the page start, writing left of the magnifier caret would otherwise produce negative
    // document coordinates. Shift the caret just enough to keep the whole group on the paper.
    if (mapped.bounds.x < this.lane.leftX) {
      this.target = {
        ...this.target,
        x: this.target.x + (this.lane.leftX - mapped.bounds.x),
      };
      mapped = mapPadStrokes(
        this.padStrokes,
        this.pad,
        this.lane,
        this.target,
        this.settings.magnification
      );
      if (!mapped) return { status: "invalid-transform" };
    }

    const asText = this.settings.placement === "text" && !!recognizedText;
    const payload: PlacePayload = {
      kind: asText ? "text" : "ink",
      target: { ...this.target },
      strokes: mapped.strokes,
      bounds: mapped.bounds,
      scale: mapped.scale,
      commitSeq: this.seq,
      ...(asText ? { text: recognizedText as string } : {}),
    };
    this.lastCommit = {
      target: { ...this.target },
      strokes: this.padStrokes,
      commitSeq: this.seq,
    };
    this.placedSeq = this.seq;
    this.padStrokes = [];
    this.autoPlaceArmed = false;
    // Advance from the actual rendered right edge, not merely from the caret. This keeps each
    // following auto-placed group in bounds when the user's pad strokes start right of focusX.
    const occupiedAdvance = mapped.bounds.x + mapped.bounds.width - this.target.x;
    const nextTarget = advanceTarget(this.target, occupiedAdvance, this.lane);
    this.target = nextTarget;
    return { status: "ok", payload, nextTarget };
  }

  /**
   * Model side of undoing the LAST place(): restores the pre-commit target and the pad
   * strokes (pad context), so the user can immediately rewrite or re-place. The document-side
   * removal is the workspace history's job — one commitSeq = one history item there too.
   */
  undoLastPlace(): { target: MagnifyTarget; commitSeq: number } | null {
    if (this.drainPending) return null;
    const last = this.lastCommit;
    if (!last) return null;
    this.target = { ...last.target };
    this.padStrokes = last.strokes;
    this.seq++; // restored strokes are placeable again
    // An undo must remain undone while the user inspects or edits the restored
    // pad context. A new completed stroke re-arms normal idle placement;
    // explicit Place remains available immediately.
    this.autoPlaceArmed = false;
    this.lastCommit = null;
    return { target: { ...last.target }, commitSeq: last.commitSeq };
  }

  // ---- draft recovery (app pause with unplaced ink) ----
  serializeDraft(): MagnifyDraft | null {
    if (this.padStrokes.length === 0 || !this.target) return null;
    return {
      v: 1,
      target: { ...this.target },
      strokes: this.padStrokes,
      seq: this.seq,
      savedAt: Date.now(),
    };
  }

  /**
   * Restore a recovered draft. Refuses drafts already consumed by a commit (seq guard) — an
   * app resume can therefore never duplicate a placed group, only recover a genuinely
   * unplaced one.
   */
  restoreDraft(draft: MagnifyDraft | null | undefined): boolean {
    if (!draft || draft.v !== 1) return false;
    if (draft.seq <= this.placedSeq) return false; // that ink was already committed
    if (draft.strokes.length === 0) return false;
    this.phase = "writing";
    this.target = { ...draft.target };
    this.padStrokes = draft.strokes.slice();
    this.seq = Math.max(this.seq, draft.seq);
    // Recovery is deliberately non-committing. Otherwise lastPenUpAt=0 makes
    // the first interval tick silently place an unreviewed pause draft.
    this.autoPlaceArmed = false;
    return true;
  }

  /** Re-derive the target rectangle after a relayout — the ANCHOR is stable; only geometry
   * changed. Never applied to already-placed ink (that lives in the document model). */
  relayout(lane: LaneGeometry, pad?: PadGeometry): void {
    const clampX = (x: number) => Math.min(x, Math.max(lane.leftX, lane.pageWidth - 1));
    this.lane = lane;
    if (pad) this.pad = pad;
    if (this.target) this.target = { ...this.target, x: clampX(this.target.x) };
  }
}
