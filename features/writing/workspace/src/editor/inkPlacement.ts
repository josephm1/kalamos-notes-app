import type { InkStroke } from "../ink/types";
import { boundsOfPoints, boundsUnion, emptyBounds } from "../ink/types";

function strokeBounds(strokes: InkStroke[]) {
  let bounds = emptyBounds();
  for (const stroke of strokes) bounds = boundsUnion(bounds, boundsOfPoints(stroke.points));
  return bounds;
}

export function translateInkStrokes(strokes: InkStroke[], dx: number, dy: number): InkStroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
    bounds: { ...stroke.bounds, x: stroke.bounds.x + dx, y: stroke.bounds.y + dy },
  }));
}

/**
 * Keep run-local coordinates compact while reporting the exact translation.
 * The caller applies the inverse translation to the run's visual origin (and
 * the same translation to its baseline offset), so already-rendered strokes
 * do not move when a new stroke expands the bounds above or to the left.
 */
export function normalizeInkStrokes(strokes: InkStroke[], pad: number) {
  if (strokes.length === 0) return { strokes, dx: 0, dy: 0 };
  const bounds = strokeBounds(strokes);
  const dx = pad - bounds.x;
  const dy = pad - bounds.y;
  return { strokes: translateInkStrokes(strokes, dx, dy), dx, dy };
}

/**
 * Use the same upper-body lane as spacing and selection. The lower portion
 * of a word's bounds may be a long y/g/p descender belonging to the row above.
 * Baseline numbers are one-based; interactive row numbers are zero-based.
 */
export function ruledLineIndex(visualTop: number, visualHeight: number, lineHeight: number): number {
  return freeInkLaneIndex(visualTop, visualHeight, lineHeight) + 1;
}

/** Distance from the run's visual top to its inferred ruled writing line. */
export function ruledBaselineOffset(visualTop: number, visualHeight: number, lineHeight: number): number {
  return ruledLineIndex(visualTop, visualHeight, lineHeight) * lineHeight - visualTop;
}

/**
 * Choose the interactive row owned by a free (not yet packed) ink word.
 *
 * A bounds centre works for ordinary lowercase writing but assigns a long
 * descender such as `p`, `g`, or `y` to the row below its letter body. The
 * Insert Space caret then moves or conceals the wrong row. Sampling the upper
 * body at 36% keeps normal short marks in their visible band, keeps capitals
 * that rise above a rule with their body, and discounts a thin descender that
 * extends nearly a full line below it.
 */
export function freeInkLaneIndex(
  visualTop: number,
  visualHeight: number,
  lineHeight: number
): number {
  const bodyProbe = visualTop + visualHeight * 0.36;
  return Math.max(0, Math.floor(bodyProbe / lineHeight));
}

/** Place packed ink from its stored ruled-line reference, never by re-centring its changing bounds. */
export function packedInkTop(
  line: number,
  lineHeight: number,
  baselineOffset: number | undefined,
  visualHeight: number
): number {
  if (baselineOffset === undefined) {
    return line * lineHeight + Math.max(0, (lineHeight - visualHeight) / 2);
  }
  return (line + 1) * lineHeight - baselineOffset;
}

export type InkWordMatch = {
  runLeft: number;
  runRight: number;
  runLine: number;
  strokeLeft: number;
  strokeRight: number;
  strokeLine: number;
  strokeHeight: number;
  lineHeight: number;
  /** Milliseconds from the candidate run's last stroke to this stroke. */
  timeGapMs?: number;
  /** Distance from a small mark's centre to the candidate's actual stroke path.
   * Unlike bounding-box overlap this distinguishes neighbouring rows/words. */
  attachmentDistance?: number;
};

/**
 * Full letter strokes must resolve to the same ruled lane. A small upper
 * mark may attach to the lane below it when it overlaps the word, including
 * after a long delay. Timing may support uncertain upper corrections, but
 * must never join an independently placed letter on the next row.
 */
export function shouldMergeIntoInkWord(match: InkWordMatch): boolean {
  const horizontalGap =
    match.strokeRight < match.runLeft
      ? match.runLeft - match.strokeRight
      : match.strokeLeft > match.runRight
        ? match.strokeLeft - match.runRight
        : 0;
  if (horizontalGap > match.lineHeight * 0.55) return false;

  const horizontalOverlap =
    Math.min(match.runRight, match.strokeRight) - Math.max(match.runLeft, match.strokeLeft);
  const hasTiming = match.timeGapMs !== undefined;
  const timeGap = Math.max(0, match.timeGapMs ?? 0);
  const recent = hasTiming && timeGap <= 1200;
  const visiblyOverlaps = horizontalOverlap >= match.lineHeight * 0.03;

  if (match.strokeLine === match.runLine) {
    // Nearby strokes made in one writing burst form a word. After a pause, a
    // separated stroke starts a new word; a late correction may still attach
    // when it visibly crosses the existing ink.
    return !hasTiming || timeGap <= 1200 || visiblyOverlaps;
  }

  const closeToInk = match.attachmentDistance === undefined ||
    match.attachmentDistance <= match.lineHeight * 0.45;
  const obviousUpperCorrection =
    match.strokeHeight <= match.lineHeight * 0.4 &&
    visiblyOverlaps &&
    match.strokeLine === match.runLine - 1 &&
    closeToInk;
  const recentMessyUpperCorrection =
    match.strokeHeight <= match.lineHeight * 0.8 &&
    visiblyOverlaps &&
    match.strokeLine === match.runLine - 1 &&
    recent && timeGap <= 450 && closeToInk;
  return obviousUpperCorrection || recentMessyUpperCorrection;
}

/** Geometry chooses the word; recency breaks only near-identical ties.
 * A five-second-old stem must beat a fresh but more distant neighbouring word
 * when the writer returns to cross a t or dot an i. */
export function inkWordMatchScore(match: InkWordMatch): number {
  const horizontalGap = Math.max(0, match.runLeft - match.strokeRight, match.strokeLeft - match.runRight);
  const mark = match.strokeHeight <= match.lineHeight * 0.4;
  const geometry = mark && match.attachmentDistance !== undefined
    ? match.attachmentDistance + horizontalGap
    : horizontalGap + Math.abs(match.runLine - match.strokeLine) * match.lineHeight;
  return geometry + Math.min(5000, Math.max(0, match.timeGapMs ?? 0)) / 5000;
}
