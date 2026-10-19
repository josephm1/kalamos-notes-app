import type { InkPoint, InkStroke } from "../ink/types";
import { boundsOfPoints } from "../ink/types";
import { ruledLineIndex } from "./inkPlacement";

function pointSegmentDistance(p: Pick<InkPoint, "x" | "y">, a: Pick<InkPoint, "x" | "y">, b: Pick<InkPoint, "x" | "y">): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
}

function segmentDistance(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint): number {
  const cross = (x: number, y: number, xx: number, yy: number) => x * yy - y * xx;
  const denominator = cross(b.x - a.x, b.y - a.y, d.x - c.x, d.y - c.y);
  if (Math.abs(denominator) > 1e-9) {
    const t = cross(c.x - a.x, c.y - a.y, d.x - c.x, d.y - c.y) / denominator;
    const u = cross(c.x - a.x, c.y - a.y, b.x - a.x, b.y - a.y) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Closest distance between actual vectors, with candidate run-local points
 * translated into the incoming stroke's coordinate system. Used only for
 * small attached marks, after the cheap lane/word bounds checks. */
export function inkStrokeAttachmentDistance(stroke: InkStroke, candidates: InkStroke[], dx = 0, dy = 0): number {
  let distance = Infinity;
  for (const candidate of candidates) {
    for (let i = 0; i < Math.max(1, stroke.points.length - 1); i++) {
      const a = stroke.points[i], b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
      if (!a || !b) continue;
      for (let j = 0; j < Math.max(1, candidate.points.length - 1); j++) {
        const rawC = candidate.points[j], rawD = candidate.points[Math.min(j + 1, candidate.points.length - 1)];
        if (!rawC || !rawD) continue;
        const c = { ...rawC, x: rawC.x + dx, y: rawC.y + dy };
        const d = { ...rawD, x: rawD.x + dx, y: rawD.y + dy };
        distance = Math.min(distance, segmentDistance(a, b, c, d));
        if (distance === 0) return 0;
      }
    }
  }
  return distance;
}

/** A separate descender may have most of its length below its own row.
 * Recover it only when pen-down touches the candidate's letter body, clipped
 * at that row's baseline. Touching a previous word's dangling tail from the
 * following row is deliberately insufficient. */
export function inkStrokeStartsInBody(
  stroke: InkStroke, candidates: InkStroke[], baselineY: number, lineHeight: number, dx = 0, dy = 0
): boolean {
  const first = stroke.points[0];
  if (!first || first.y < baselineY - lineHeight || first.y > baselineY) return false;
  const top = baselineY - lineHeight;
  for (const candidate of candidates) {
    for (let i = 0; i < Math.max(1, candidate.points.length - 1); i++) {
      const a = candidate.points[i], b = candidate.points[Math.min(i + 1, candidate.points.length - 1)];
      if (!a || !b) continue;
      const ay = a.y + dy, by = b.y + dy;
      let lo = 0, hi = 1;
      if (ay === by) {
        if (ay < top || ay > baselineY) continue;
      } else {
        const firstBound = (top - ay) / (by - ay), lastBound = (baselineY - ay) / (by - ay);
        lo = Math.max(0, Math.min(firstBound, lastBound));
        hi = Math.min(1, Math.max(firstBound, lastBound));
        if (lo > hi) continue;
      }
      const c = { x: a.x + dx + (b.x - a.x) * lo, y: ay + (by - ay) * lo };
      const d = { x: a.x + dx + (b.x - a.x) * hi, y: ay + (by - ay) * hi };
      if (pointSegmentDistance(first, c, d) <= lineHeight * 0.16) return true;
    }
  }
  return false;
}

/** Recover word objects from a legacy or magnified burst. Partition by the
 * ruled body lane before horizontal whitespace, so overlapping descenders
 * cannot bridge two rows. Small delayed marks follow the nearest overlapping
 * letter body regardless of their original stroke order. */
export function clusterInkStrokesByWord(strokes: InkStroke[], lineHeight: number, visualOffsetY = 0): InkStroke[][] {
  const measured = strokes.filter((stroke) => stroke.points.length > 0).map((stroke, order) => {
    const bounds = boundsOfPoints(stroke.points);
    return { stroke, order, bounds, line: ruledLineIndex(bounds.y + visualOffsetY, bounds.height, lineHeight) };
  });
  // A short lowercase body is not automatically a dot/crossbar. Restrict
  // cross-row reassignment to compact dots or predominantly horizontal marks.
  const isMark = ({ bounds }: (typeof measured)[number]) =>
    bounds.height <= lineHeight * 0.4 &&
    (Math.max(bounds.width, bounds.height) <= lineHeight * 0.25 || bounds.width >= bounds.height * 1.5);
  const bodies = measured.filter((item) => !isMark(item));
  for (const item of bodies) {
    const owner = bodies.find((body) => body !== item && body.line === item.line - 1 &&
      inkStrokeStartsInBody(item.stroke, [body.stroke], body.line * lineHeight - visualOffsetY, lineHeight));
    if (owner) item.line = owner.line;
  }
  for (const item of measured) {
    if (!isMark(item)) continue;
    let nearest = lineHeight * 0.45;
    let owner = item.line;
    for (const body of bodies) {
      if (body.line !== item.line && body.line !== item.line + 1) continue;
      if (item.bounds.x + item.bounds.width < body.bounds.x || body.bounds.x + body.bounds.width < item.bounds.x) continue;
      const distance = inkStrokeAttachmentDistance(item.stroke, [body.stroke]);
      if (distance < nearest) { nearest = distance; owner = body.line; }
    }
    item.line = owner;
  }
  const widths = measured.map(({ bounds }) => bounds.width).filter((width) => width > 1).sort((a, b) => a - b);
  const medianWidth = widths.length ? widths[Math.floor(widths.length / 2)] : lineHeight * 0.2;
  const wordBreak = Math.max(lineHeight * 0.3, Math.min(lineHeight * 0.42, medianWidth * 1.5));
  measured.sort((a, b) => a.line - b.line || a.bounds.x - b.bounds.x || a.order - b.order);
  const groups: typeof measured[] = [];
  let current: typeof measured = [], right = -Infinity;
  for (const item of measured) {
    if (current.length && (item.line !== current[0].line || item.bounds.x - right > wordBreak)) {
      groups.push(current); current = []; right = -Infinity;
    }
    current.push(item);
    right = Math.max(right, item.bounds.x + item.bounds.width);
  }
  if (current.length) groups.push(current);
  return groups.map((group) => group.sort((a, b) => a.order - b.order).map(({ stroke }) => stroke));
}
