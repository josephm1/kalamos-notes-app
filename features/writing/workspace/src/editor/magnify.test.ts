import { describe, it, expect } from "vitest";
import {
  MagnifyModel,
  mapPadStrokes,
  groupStrokesByPause,
  advanceTarget,
  DEFAULT_SETTINGS,
  type PadGeometry,
  type LaneGeometry,
  type MagnifyTarget,
} from "./magnify";
import type { InkStroke, InkPoint } from "../ink/types";
import { boundsOfPoints } from "../ink/types";
import { orderedFlow, type ReflowDoc } from "./reflowModel";

// ---- fixtures -------------------------------------------------------------------------------

const PAD: PadGeometry = { width: 800, height: 280, baselineY: 220, xHeightY: 110 };
const LANE: LaneGeometry = { lineHeight: 44, pageWidth: 600, leftX: 16 };
const TARGET: MagnifyTarget = { afterWord: 2, line: 3, x: 120 };

let strokeSeq = 0;
function stroke(points: Array<[number, number]>, t0 = 0, dt = 10, pressure = 0.7): InkStroke {
  const pts: InkPoint[] = points.map(([x, y], i) => ({ x, y, t: t0 + i * dt, pressure }));
  return {
    id: `s${strokeSeq++}`,
    tool: "pen",
    color: "#000",
    width: 4,
    points: pts,
    bounds: boundsOfPoints(pts),
  };
}

/** A plausible pad word: body between x-height and baseline, a descender below. */
function padWord(x0 = 100, t0 = 0): InkStroke {
  return stroke(
    [
      [x0, PAD.xHeightY + 10],
      [x0 + 60, PAD.baselineY],
      [x0 + 120, PAD.xHeightY + 30],
      [x0 + 150, PAD.baselineY + 20], // descender
    ],
    t0
  );
}

function model(settings = {}) {
  const m = new MagnifyModel(PAD, LANE, settings);
  m.open();
  m.chooseTarget(TARGET);
  return m;
}

// ---- mapping --------------------------------------------------------------------------------

describe("mapPadStrokes (pad → document affine)", () => {
  it("scales by 1/magnification and clamps pathological scales", () => {
    const res = mapPadStrokes([padWord()], PAD, LANE, TARGET, 2.5);
    expect(res).not.toBeNull();
    expect(res!.scale).toBeCloseTo(0.4);
    // Placement preserves the selected pen thickness while scaling coordinates.
    expect(res!.strokes[0].width).toBe(4);
    for (const magnification of [2, 2.5, 3]) {
      for (const width of [1.2, 4, 6.5]) {
        const source = { ...padWord(), width };
        const placed = mapPadStrokes([source], PAD, LANE, TARGET, magnification)!;
        expect(placed.strokes[0].width).toBe(width);
        expect(placed.strokes[0].points[1].x - placed.strokes[0].points[0].x)
          .toBeCloseTo((source.points[1].x - source.points[0].x) / magnification);
      }
    }
    // pathological magnifications are refused, draft-preserving
    expect(mapPadStrokes([padWord()], PAD, LANE, TARGET, 0)).toBeNull();
    expect(mapPadStrokes([padWord()], PAD, LANE, TARGET, -3)).toBeNull();
    expect(mapPadStrokes([padWord()], PAD, LANE, TARGET, 100)).toBeNull(); // scale 0.01 < min
    expect(mapPadStrokes([padWord()], PAD, LANE, TARGET, 0.5)).toBeNull(); // scale 2 > max
    expect(mapPadStrokes([], PAD, LANE, TARGET, 2.5)).toBeNull();
  });

  it("lands the pad baseline exactly on the target ruled line", () => {
    // one point ON the pad baseline must map to the document baseline of line 3
    const s = stroke([[100, PAD.baselineY]]);
    const res = mapPadStrokes([s], PAD, LANE, TARGET, 2.5)!;
    const docBaselineY = (TARGET.line + 1) * LANE.lineHeight;
    expect(res.strokes[0].points[0].y).toBeCloseTo(docBaselineY);
    // and a point at pad x-height sits above it by the scaled body height
    const body = stroke([[100, PAD.xHeightY]]);
    const res2 = mapPadStrokes([body], PAD, LANE, TARGET, 2.5)!;
    expect(res2.strokes[0].points[0].y).toBeCloseTo(
      docBaselineY - (PAD.baselineY - PAD.xHeightY) * 0.4
    );
  });

  it("starts placed ink at target.x and preserves pressure + relative timing", () => {
    const w = padWord(100, 500);
    const res = mapPadStrokes([w], PAD, LANE, TARGET, 2.5)!;
    expect(Math.min(...res.strokes[0].points.map((p) => p.x))).toBeCloseTo(TARGET.x);
    for (let i = 0; i < w.points.length; i++) {
      expect(res.strokes[0].points[i].pressure).toBe(w.points[i].pressure);
      expect(res.strokes[0].points[i].t).toBe(w.points[i].t); // timing untouched
    }
  });

  it("keeps relative geometry between strokes of one group", () => {
    const a = padWord(100, 0);
    const b = padWord(300, 400);
    const res = mapPadStrokes([a, b], PAD, LANE, TARGET, 2)!;
    const ax = res.strokes[0].points[0].x;
    const bx = res.strokes[1].points[0].x;
    expect(bx - ax).toBeCloseTo((300 - 100) * 0.5);
  });

  it("maps ink over a real magnified viewport back to the same document coordinate", () => {
    const viewport = { ...PAD, focusX: 400 };
    const overCaret = stroke([[400, PAD.baselineY], [500, PAD.baselineY]]);
    const res = mapPadStrokes([overCaret], viewport, LANE, TARGET, 2.5)!;
    expect(res.strokes[0].points[0].x).toBeCloseTo(TARGET.x);
    expect(res.strokes[0].points[1].x).toBeCloseTo(TARGET.x + 40);
    expect(res.strokes[0].points[0].y).toBeCloseTo((TARGET.line + 1) * LANE.lineHeight);
  });
});

// ---- word grouping --------------------------------------------------------------------------

describe("groupStrokesByPause", () => {
  it("splits at pen pauses and keeps in-word strokes together", () => {
    const s1 = stroke([[0, 0], [10, 10]], 0); // ends t=10
    const s2 = stroke([[20, 0], [30, 10]], 200); // 190ms gap — same word
    const s3 = stroke([[60, 0], [70, 10]], 2500); // long pause — new word
    const groups = groupStrokesByPause([s1, s2, s3], 1000);
    expect(groups.length).toBe(2);
    expect(groups[0].map((s) => s.id)).toEqual([s1.id, s2.id]);
    expect(groups[1].map((s) => s.id)).toEqual([s3.id]);
  });
});

// ---- target advance / wrap ------------------------------------------------------------------

describe("advanceTarget", () => {
  it("advances along the line with spacing", () => {
    const next = advanceTarget(TARGET, 80, LANE);
    expect(next.line).toBe(TARGET.line);
    expect(next.x).toBeCloseTo(TARGET.x + 80 + LANE.lineHeight * 0.35);
    expect(next.afterWord).toBe(TARGET.afterWord); // anchor stable; order = reading order
  });

  it("wraps the WHOLE next word to the next ruled line at the page edge", () => {
    const nearEdge: MagnifyTarget = { afterWord: 2, line: 3, x: 560 };
    const next = advanceTarget(nearEdge, 80, LANE);
    expect(next.line).toBe(4);
    expect(next.x).toBe(LANE.leftX);
  });
});

// ---- state machine + commits ----------------------------------------------------------------

describe("MagnifyModel", () => {
  it("walks closed → choosing-target → writing", () => {
    const m = new MagnifyModel(PAD, LANE);
    expect(m.phase).toBe("closed");
    m.open();
    expect(m.phase).toBe("choosing-target");
    m.chooseTarget(TARGET);
    expect(m.phase).toBe("writing");
  });

  it("place() maps, advances the target, and is one commit", () => {
    const m = model();
    m.addStroke(padWord());
    const res = m.place();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.payload.kind).toBe("ink");
    expect(res.payload.strokes.length).toBe(1);
    expect(res.payload.target).toEqual(TARGET);
    expect(m.padStrokes.length).toBe(0);
    expect(m.target!.x).toBeGreaterThan(TARGET.x);
  });

  it("wraps a whole group to the next line when it would cross the page edge", () => {
    const m = model();
    m.chooseTarget({ afterWord: 2, line: 3, x: 560 }); // 40px of room left
    m.addStroke(padWord()); // ~150px pad → 60px doc at 2.5× — does not fit
    const res = m.place();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.payload.target.line).toBe(4); // moved WHOLE to the next ruled line
    expect(res.payload.target.x).toBe(LANE.leftX);
    expect(Math.min(...res.payload.strokes[0].points.map((p) => p.x))).toBeCloseTo(LANE.leftX);
  });

  it("wraps from the actual right edge when writing starts right of the magnifier caret", () => {
    const pad = { ...PAD, focusX: 400 };
    const m = new MagnifyModel(pad, LANE);
    m.open();
    m.chooseTarget({ afterWord: 2, line: 3, x: 500 });
    m.addStroke(stroke([[600, PAD.xHeightY], [700, PAD.baselineY]]));
    const res = m.place();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.payload.target.line).toBe(4);
    expect(res.payload.bounds.x + res.payload.bounds.width).toBeLessThanOrEqual(LANE.pageWidth);
  });

  it("never double-commits: place after place is empty", () => {
    const m = model();
    m.addStroke(padWord());
    expect(m.place().status).toBe("ok");
    expect(m.place().status).toBe("empty");
  });

  it("erases uncommitted ink under a magnifier-local eraser point", () => {
    const m = model();
    m.addStroke(stroke([[100, 100], [200, 100]]));
    m.addStroke(stroke([[100, 180], [200, 180]]));
    expect(m.erasePadAt(150, 106)).toBe(true);
    expect(m.padStrokes).toHaveLength(1);
    expect(m.padStrokes[0].points[0].y).toBe(180);
    expect(m.erasePadAt(400, 400)).toBe(false);
  });

  it("placed payloads read in order through the reflow model (mixed typed/ink flow)", () => {
    const m = model();
    m.addStroke(padWord(100, 0));
    const first = m.place();
    m.addStroke(padWord(120, 5000));
    const second = m.place();
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;
    // both anchored after word 2 — array order must be their reading order
    const doc: ReflowDoc = {
      words: ["alpha", "beta", "gamma", "delta"],
      inserts: [
        { id: "m1", afterWord: first.payload.target.afterWord, kind: "ink", width: first.payload.bounds.width, height: 44, strokes: first.payload.strokes },
        { id: "m2", afterWord: second.payload.target.afterWord, kind: "ink", width: second.payload.bounds.width, height: 44, strokes: second.payload.strokes },
      ],
    };
    const flow = orderedFlow(doc).map((f) => (f.kind === "word" ? f.text : f.insert.id));
    expect(flow).toEqual(["alpha", "beta", "gamma", "m1", "m2", "delta"]);
  });

  it("invalid transform keeps the pad draft", () => {
    const m = model({ magnification: 100 }); // clamped out
    m.addStroke(padWord());
    const res = m.place();
    expect(res.status).toBe("invalid-transform");
    expect(m.padStrokes.length).toBe(1); // nothing lost
  });

  it("refuses to place before the native batch is drained", () => {
    const m = model();
    m.addStroke(padWord());
    m.markDrainPending();
    expect(m.place().status).toBe("needs-drain");
    m.notifyDrained();
    expect(m.place().status).toBe("ok");
  });

  it("undoLastPlace restores target AND pad context as one transaction", () => {
    const m = model();
    m.addStroke(padWord());
    const placed = m.place();
    expect(placed.status).toBe("ok");
    const undo = m.undoLastPlace();
    expect(undo).not.toBeNull();
    expect(undo!.commitSeq).toBe((placed as { payload: { commitSeq: number } }).payload.commitSeq);
    expect(m.target).toEqual(TARGET); // back where it was
    expect(m.padStrokes.length).toBe(1); // pad context restored
    // and the restored ink is placeable again (no seq deadlock)
    expect(m.place().status).toBe("ok");
  });

  it("undo stays undone until new pen input re-arms auto-place", () => {
    const m = model({ autoPlaceMs: 1800 });
    m.addStroke(padWord(100, 0));
    expect(m.place().status).toBe("ok");
    expect(m.undoLastPlace()).not.toBeNull();
    expect(m.autoPlaceDue(1e12)).toBe(false);
    m.penDidGoDown();
    m.addStroke(padWord(300, 5000));
    expect(m.autoPlaceDue(7000)).toBe(true);
  });

  it("undo is also drain-gated", () => {
    const m = model();
    m.addStroke(padWord());
    m.place();
    m.markDrainPending();
    expect(m.undoLastPlace()).toBeNull();
  });

  // ---- idle race ----
  it("auto-place never fires while the pen is down or before the pause elapses", () => {
    const m = model({ autoPlaceMs: 1800 });
    m.addStroke(padWord(100, 0)); // pen up at t=30
    expect(m.autoPlaceDue(1000)).toBe(false); // pause not elapsed
    expect(m.autoPlaceDue(2000)).toBe(true);
    m.penDidGoDown(); // new stroke started as the timer fired — the race
    expect(m.autoPlaceDue(5000)).toBe(false);
    m.addStroke(padWord(300, 5000)); // stroke completes (pen up at 5030)
    expect(m.autoPlaceDue(5100)).toBe(false);
    expect(m.autoPlaceDue(7000)).toBe(true);
  });

  it("auto-place off means never due", () => {
    const m = model({ autoPlaceMs: 0 });
    m.addStroke(padWord());
    expect(m.autoPlaceDue(1e12)).toBe(false);
  });

  // ---- HWR ----
  it("places text when recognition succeeds under text placement", () => {
    const m = model({ placement: "text" });
    m.addStroke(padWord());
    const res = m.place("hello");
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.payload.kind).toBe("text");
    expect(res.payload.text).toBe("hello");
  });

  it("recognition failure falls back to ink — handwriting is never lost", () => {
    const m = model({ placement: "text" });
    m.addStroke(padWord());
    const res = m.place(null);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.payload.kind).toBe("ink");
    expect(res.payload.strokes.length).toBe(1);
  });

  // ---- close / cancel ----
  it("close with unplaced ink demands a decision; discard closes; cancel resumes", () => {
    const m = model();
    m.addStroke(padWord());
    expect(m.requestClose()).toBe(false);
    expect(m.phase).toBe("discard-confirm");
    m.cancelClose();
    expect(m.phase).toBe("writing");
    expect(m.padStrokes.length).toBe(1);
    m.requestClose();
    m.confirmDiscard();
    expect(m.phase).toBe("closed");
    expect(m.padStrokes.length).toBe(0);
  });

  it("close with a clean pad closes immediately", () => {
    const m = model();
    expect(m.requestClose()).toBe(true);
    expect(m.phase).toBe("closed");
  });

  it("clear-unplaced-ink empties the pad without closing", () => {
    const m = model();
    m.addStroke(padWord());
    m.clearPad();
    expect(m.padStrokes.length).toBe(0);
    expect(m.phase).toBe("writing");
  });

  // ---- draft recovery ----
  it("recovers an unplaced draft across a pause, exactly once", () => {
    const m = model();
    m.addStroke(padWord());
    const draft = m.serializeDraft();
    expect(draft).not.toBeNull();
    // fresh model (app restart)
    const m2 = new MagnifyModel(PAD, LANE);
    expect(m2.restoreDraft(draft!)).toBe(true);
    expect(m2.phase).toBe("writing");
    expect(m2.padStrokes.length).toBe(1);
    expect(m2.target).toEqual(TARGET);
    expect(m2.autoPlaceDue(1e12)).toBe(false); // recovery never silently commits
    expect(m2.place().status).toBe("ok");
  });

  it("a draft whose ink was already committed is refused (no double commit on resume)", () => {
    const m = model();
    m.addStroke(padWord());
    const draft = m.serializeDraft()!; // captured BEFORE placing
    expect(m.place().status).toBe("ok"); // ...then the commit went through
    expect(m.restoreDraft(draft)).toBe(false); // resume must not replay it
    expect(m.padStrokes.length).toBe(0);
  });

  it("an empty pad serializes no draft", () => {
    const m = model();
    expect(m.serializeDraft()).toBeNull();
  });

  // ---- orientation / relayout ----
  it("relayout keeps the anchor and clamps only the geometry", () => {
    const m = model();
    // rotate to a narrower page: the target x is beyond the new width
    const narrow: LaneGeometry = { lineHeight: 44, pageWidth: 100, leftX: 8 };
    m.relayout(narrow);
    expect(m.target!.afterWord).toBe(TARGET.afterWord); // anchor stable
    expect(m.target!.line).toBe(TARGET.line);
    expect(m.target!.x).toBeLessThanOrEqual(99);
    // placement still works in the new geometry and wraps against the new width
    m.addStroke(padWord());
    const res = m.place();
    expect(res.status).toBe("ok");
  });

  it("relayout updates pad geometry so a rotated pad still maps its baseline exactly", () => {
    const m = model();
    const rotatedPad: PadGeometry = {
      width: 1200,
      height: 180,
      baselineY: 140,
      xHeightY: 70,
    };
    m.relayout(LANE, rotatedPad);
    m.addStroke(stroke([[100, rotatedPad.baselineY], [160, rotatedPad.baselineY]]));
    const res = m.place();
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.payload.strokes[0].points[0].y).toBeCloseTo(
      (TARGET.line + 1) * LANE.lineHeight
    );
  });
});

describe("defaults", () => {
  it("ships automatic ink placement defaults", () => {
    expect(DEFAULT_SETTINGS.magnification).toBe(2.5);
    expect(DEFAULT_SETTINGS.autoPlaceMs).toBe(400);
    expect(DEFAULT_SETTINGS.placement).toBe("ink");
  });
});
