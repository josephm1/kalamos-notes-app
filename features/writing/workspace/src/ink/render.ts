import type { InkStroke } from "./types";
import { outlinePathD, strokeOutline } from "./geometry";

/**
 * Map raw pressure through a gentle curve with a nonzero minimum, so devices
 * that report poor or constant pressure still produce a legible line.
 * (BUILD_PLAN.md §9 "Ink representation".)
 */
export function pressureToWidth(base: number, pressure: number): number {
  const p = Number.isFinite(pressure) && pressure > 0 ? pressure : 0.5;
  const curved = 0.4 + 0.6 * Math.sqrt(p); // min 40% of base width
  return base * curved;
}


/**
 * Render a variable-width stroke directly onto a canvas context. Fast path
 * used during live drawing — draws pressure-weighted segments.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  fromIndex = 0
): void {
  const pts = stroke.points;
  if (pts.length < 2) {
    if (pts.length === 1) {
      const p = pts[0];
      ctx.beginPath();
      ctx.fillStyle = stroke.color;
      ctx.arc(p.x, p.y, pressureToWidth(stroke.width, p.pressure) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  const start = Math.max(1, fromIndex);
  for (let i = start; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    ctx.beginPath();
    ctx.lineWidth = pressureToWidth(
      stroke.width,
      (a.pressure + b.pressure) / 2
    );
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

/** Build inline SVG markup for a committed run's strokes (sharp on e-ink/HiDPI). */
export function strokesToSvg(
  strokes: InkStroke[],
  width: number,
  height: number
): string {
  const paths = strokes
    .filter((s) => s.tool === "pen")
    .map(
      (s) =>
        `<path d="${outlinePathD(strokeOutline(s.points, s.width, s.brushStyle))}" fill="${s.color}"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${paths}</svg>`;
}
