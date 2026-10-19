import { describe, expect, it } from "vitest";
import type { InkStroke } from "../ink/types";
import {
  freeInkLaneIndex,
  inkWordMatchScore,
  normalizeInkStrokes,
  packedInkTop,
  ruledBaselineOffset,
  ruledLineIndex,
  shouldMergeIntoInkWord,
} from "./inkPlacement";

function stroke(id: string, x: number, y: number): InkStroke {
  return {
    id,
    tool: "pen",
    color: "#000",
    width: 2,
    points: [{ x, y, t: 0, pressure: 0.5 }],
    bounds: { x, y, width: 0, height: 0 },
  };
}

describe("ruled ink placement", () => {
  it("preserves an existing letter when a second stroke extends above it", () => {
    const oldTop = 50;
    const baselineOffset = 38;
    const result = normalizeInkStrokes([stroke("old", 4, 14), stroke("new", 20, 8)], 4);

    const newTop = oldTop - result.dy;
    const newBaselineOffset = baselineOffset + result.dy;
    const oldPointOnScreen = newTop + result.strokes[0].points[0].y - 4;

    expect(result.dy).toBe(-4);
    expect(oldPointOnScreen).toBe(oldTop + 14 - 4);
    expect(packedInkTop(1, 44, newBaselineOffset, 30)).toBe(
      packedInkTop(1, 44, baselineOffset, 24) - result.dy
    );
  });

  it("keeps a run at the same proportion to its ruled line as its bounds grow downward", () => {
    const offset = ruledBaselineOffset(51, 24, 44);
    expect(offset).toBe(37);
    expect(packedInkTop(1, 44, offset, 24)).toBe(51);
    expect(packedInkTop(1, 44, offset, 38)).toBe(51);
  });

  it("assigns capitals, lowercase letters, and descenders to one lane", () => {
    // All three examples are written on y=88. The capital reaches through the
    // rule above, while the descender continues below the writing line.
    expect(ruledLineIndex(20, 68, 44)).toBe(2);
    expect(ruledLineIndex(61, 27, 44)).toBe(2);
    expect(ruledLineIndex(50, 60, 44)).toBe(2);
  });

  it("keeps the same capital geometry on the next ruled lane", () => {
    expect(ruledLineIndex(64, 68, 44)).toBe(3);
  });

  it("assigns a long descender to its upper letter-body lane", () => {
    expect(freeInkLaneIndex(14, 80, 44)).toBe(0);
    expect(freeInkLaneIndex(58, 80, 44)).toBe(1);
    // Preserve the established visible-row behavior for small pen marks.
    expect(freeInkLaneIndex(48, 18, 44)).toBe(1);
  });

  it("does not merge a full letter written on the adjacent ruled line", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 100,
        runRight: 150,
        runLine: 2,
        strokeLeft: 140,
        strokeRight: 170,
        strokeLine: 3,
        strokeHeight: 34,
        lineHeight: 44,
      })
    ).toBe(false);
  });

  it("does not attach a short capital stroke from the lane below", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 100,
        runRight: 170,
        runLine: 2,
        strokeLeft: 130,
        strokeRight: 160,
        strokeLine: 3,
        strokeHeight: 8,
        lineHeight: 44,
        timeGapMs: 5000,
      })
    ).toBe(false);
  });

  it("uses a recent overlapping stem to recover an ambiguously classified T bar", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 130,
        runRight: 138,
        runLine: 3,
        strokeLeft: 120,
        strokeRight: 155,
        strokeLine: 2,
        strokeHeight: 8,
        lineHeight: 44,
        timeGapMs: 280,
      })
    ).toBe(true);
  });

  it("attaches a recent messy upper cross-stroke despite its tall bounds", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 420,
        runRight: 468,
        runLine: 5,
        strokeLeft: 449,
        strokeRight: 487,
        strokeLine: 4,
        strokeHeight: 30,
        lineHeight: 44,
        timeGapMs: 84,
      })
    ).toBe(true);
  });

  it("does not use rapid timing alone to merge a separately classified next-row stroke", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 100,
        runRight: 160,
        runLine: 3,
        strokeLeft: 125,
        strokeRight: 155,
        strokeLine: 4,
        strokeHeight: 12,
        lineHeight: 44,
        timeGapMs: 90,
      })
    ).toBe(false);
  });

  it("does not use timing to absorb a clear return to the next line", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 260,
        runRight: 310,
        runLine: 3,
        strokeLeft: 40,
        strokeRight: 65,
        strokeLine: 4,
        strokeHeight: 30,
        lineHeight: 44,
        timeGapMs: 90,
      })
    ).toBe(false);
  });

  it("allows an obvious upper correction after a long delay", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 100,
        runRight: 145,
        runLine: 3,
        strokeLeft: 120,
        strokeRight: 126,
        strokeLine: 2,
        strokeHeight: 6,
        lineHeight: 44,
        timeGapMs: 12000,
      })
    ).toBe(true);
  });

  it("starts a new same-lane word after a pause and visible gap", () => {
    expect(
      shouldMergeIntoInkWord({
        runLeft: 100,
        runRight: 150,
        runLine: 2,
        strokeLeft: 165,
        strokeRight: 180,
        strokeLine: 2,
        strokeHeight: 30,
        lineHeight: 44,
        timeGapMs: 1800,
      })
    ).toBe(false);
  });

  it("merges same-lane letters and attached marks after their bounds are known", () => {
    const base = {
      runLeft: 100,
      runRight: 150,
      runLine: 2,
      strokeLeft: 154,
      strokeRight: 174,
      lineHeight: 44,
    };
    expect(shouldMergeIntoInkWord({ ...base, strokeLine: 2, strokeHeight: 32 })).toBe(true);
    expect(
      shouldMergeIntoInkWord({
        ...base,
        strokeLeft: 120,
        strokeRight: 126,
        strokeLine: 1,
        strokeHeight: 6,
        timeGapMs: 500,
      })
    ).toBe(true);
  });
  it("uses the same body row for word grouping and free-ink spacing despite a long tail", () => {
    for (const top of [14, 58, 102]) {
      expect(ruledLineIndex(top, 80, 44)).toBe(freeInkLaneIndex(top, 80, 44) + 1);
    }
    expect(ruledLineIndex(14, 80, 44)).toBe(1);
    expect(ruledLineIndex(58, 30, 44)).toBe(2);
  });

  it("does not use overlapping x bounds alone for a remote upper correction", () => {
    expect(shouldMergeIntoInkWord({
      runLeft: 100, runRight: 160, runLine: 3,
      strokeLeft: 120, strokeRight: 126, strokeLine: 2,
      strokeHeight: 6, lineHeight: 44, timeGapMs: 100,
      attachmentDistance: 35,
    })).toBe(false);
  });

  it("ranks a delayed dot near its own stem ahead of a fresh neighbouring word", () => {
    const base = {
      runLeft: 100, runRight: 150, runLine: 3,
      strokeLeft: 120, strokeRight: 126, strokeLine: 2,
      strokeHeight: 6, lineHeight: 44,
    };
    expect(inkWordMatchScore({ ...base, timeGapMs: 30000, attachmentDistance: 3 }))
      .toBeLessThan(inkWordMatchScore({ ...base, runLine: 2, timeGapMs: 10, attachmentDistance: 12 }));
  });

});
