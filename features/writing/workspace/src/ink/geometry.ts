// Stroke geometry shared by live drawing and committed rendering. A stroke is
// rendered as ONE filled outline polygon built from a Catmull-Rom smoothed
// centerline with per-sample width (pressure, or velocity when the pen reports
// flat pressure). Using the same geometry everywhere means the ink never
// changes shape between pen-down, pen-up, and the reader view.
// See BUILD_PLAN.md §9 "Ink representation".

import type { InkPoint, InkStroke } from "./types";
import { pressureToWidth } from "./render";

export type XY = { x: number; y: number };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Append a point with a minimum-distance filter so slow writing doesn't pile
 * up noisy samples (which makes smoothing wobble). Mutates `points`. When the
 * candidate is dropped, its pressure still blends into the last kept point so
 * pressure detail isn't lost. Returns true if the point was appended.
 */
export function appendFiltered(
  points: InkPoint[],
  p: InkPoint,
  minDist = 0.9
): boolean {
  const last = points[points.length - 1];
  if (last) {
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy < minDist * minDist) {
      last.pressure = (last.pressure + p.pressure) / 2;
      last.t = p.t;
      return false;
    }
  }
  points.push(p);
  return true;
}

/**
 * Per-point rendered width. Uses smoothed pressure when the pen reports real
 * pressure variation; otherwise falls back to velocity (slower strokes are
 * slightly wider, like a real pen laying down more ink).
 */
export function pointWidths(points: InkPoint[], base: number): number[] {
  const n = points.length;
  const widths = new Array<number>(n);
  if (n === 0) return widths;

  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const pr = Number.isFinite(p.pressure) ? p.pressure : 0;
    if (pr < min) min = pr;
    if (pr > max) max = pr;
  }
  const flatPressure = max <= 0 || max - min < 0.04;

  if (flatPressure) {
    let ema = base;
    for (let i = 0; i < n; i++) {
      const a = points[i === 0 ? 0 : i - 1];
      const b = points[i];
      const dt = Math.max(1, b.t - a.t);
      const v = Math.hypot(b.x - a.x, b.y - a.y) / dt; // px per ms
      const target = base * clamp(1.2 - v * 0.4, 0.6, 1.15);
      ema = ema * 0.7 + target * 0.3;
      widths[i] = ema;
    }
  } else {
    let ema = pressureToWidth(base, points[0].pressure);
    for (let i = 0; i < n; i++) {
      const target = pressureToWidth(base, points[i].pressure);
      ema = ema * 0.65 + target * 0.35;
      widths[i] = ema;
    }
  }
  return widths;
}

type Sample = { x: number; y: number; w: number };

/** Catmull-Rom resample of the centerline with interpolated widths. */
function sampleCenterline(points: InkPoint[], widths: number[]): Sample[] {
  const n = points.length;
  if (n === 1) return [{ x: points[0].x, y: points[0].y, w: widths[0] }];
  const out: Sample[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < n ? i + 2 : n - 1];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = clamp(Math.round(dist / 1.5), 1, 12);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x, y, w: widths[i] + (widths[i + 1] - widths[i]) * t });
    }
  }
  const lp = points[n - 1];
  out.push({ x: lp.x, y: lp.y, w: widths[n - 1] });
  return out;
}

function circleOutline(cx: number, cy: number, r: number): XY[] {
  const pts: XY[] = [];
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Semicircular end-cap fan around `at`, sweeping from +normal to -normal. */
function capFan(at: Sample, nx: number, ny: number): XY[] {
  const pts: XY[] = [];
  const hw = Math.max(0.35, at.w / 2);
  const steps = 5;
  for (let i = 1; i < steps; i++) {
    const a = (i / steps) * Math.PI;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Rotate the normal vector by `a` (normal × tangent plane).
    pts.push({
      x: at.x + (nx * cos + ny * sin) * hw,
      y: at.y + (ny * cos - nx * sin) * hw,
    });
  }
  return pts;
}

/**
 * Build the closed outline polygon of a stroke. The same polygon is filled on
 * canvas while writing and emitted as an SVG path when committed.
 */
export function strokeOutline(points: InkPoint[], base: number, style?: InkStroke["brushStyle"]): XY[] {
  if (points.length === 0) return [];
  // New Pen/Marker styles match the daemon's constant-width ballpoint.
  // Missing style keeps old notebook geometry untouched; Brush keeps pressure.
  const widths = style === "pen" || style === "marker" ? points.map(() => base) : pointWidths(points, base);
  if (points.length === 1) {
    return circleOutline(points[0].x, points[0].y, Math.max(0.5, widths[0] / 2));
  }
  const samples = sampleCenterline(points, widths);
  if (samples.length === 1) {
    return circleOutline(samples[0].x, samples[0].y, Math.max(0.5, samples[0].w / 2));
  }

  const left: XY[] = [];
  const right: XY[] = [];
  const normals: XY[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i === 0 ? 0 : i - 1];
    const b = samples[i === samples.length - 1 ? samples.length - 1 : i + 1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    normals.push({ x: nx, y: ny });
    const hw = Math.max(0.35, samples[i].w / 2);
    left.push({ x: samples[i].x + nx * hw, y: samples[i].y + ny * hw });
    right.push({ x: samples[i].x - nx * hw, y: samples[i].y - ny * hw });
  }

  const last = samples.length - 1;
  const endCap = capFan(samples[last], normals[last].x, normals[last].y);
  const startCap = capFan(samples[0], -normals[0].x, -normals[0].y);
  right.reverse();
  return [...left, ...endCap, ...right, ...startCap];
}

/** SVG path `d` for a closed outline (fill, not stroke). */
export function outlinePathD(outline: XY[]): string {
  if (outline.length === 0) return "";
  let d = `M ${outline[0].x.toFixed(2)} ${outline[0].y.toFixed(2)}`;
  for (let i = 1; i < outline.length; i++) {
    d += ` L ${outline[i].x.toFixed(2)} ${outline[i].y.toFixed(2)}`;
  }
  return d + " Z";
}

/** Fill a stroke's outline onto a canvas context. */
export function fillStroke(
  ctx: CanvasRenderingContext2D,
  points: InkPoint[],
  base: number,
  color: string,
  style?: InkStroke["brushStyle"]
): void {
  const outline = strokeOutline(points, base, style);
  if (outline.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Distance-to-segment hit test along the whole polyline, so fast strokes with
 * sparse points still erase reliably (the gaps between samples count).
 */
export function strokeHitsPoint(
  points: InkPoint[],
  x: number,
  y: number,
  radius: number,
  strokeWidth = 0
): boolean {
  const r = radius + strokeWidth / 2;
  const r2 = r * r;
  if (points.length === 1) {
    const dx = points[0].x - x;
    const dy = points[0].y - y;
    return dx * dx + dy * dy <= r2;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : clamp(((x - a.x) * abx + (y - a.y) * aby) / len2, 0, 1);
    const dx = a.x + abx * t - x;
    const dy = a.y + aby * t - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}
