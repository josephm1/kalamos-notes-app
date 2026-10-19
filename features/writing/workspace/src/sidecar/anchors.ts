// Build inline ink runs from a completed stroke group and attach them to a
// block anchor with recovery context. See BUILD_PLAN.md §7.

import type { InkStroke, InlineInkRun } from "../ink/types";
import { boundsOfPoints, boundsUnion, emptyBounds } from "../ink/types";

let runCounter = 0;
function nextRunId(): string {
  return `run-${Date.now().toString(36)}-${runCounter++}`;
}

/**
 * Convert a group of strokes into an inline ink run, normalizing stroke
 * coordinates so the run's origin is (0,0). Non-destructive: original relative
 * geometry is preserved; only translated into run-local space.
 */
export function strokesToRun(
  strokes: InkStroke[],
  opts: {
    blockId: string;
    anchorOffset: number;
    blockText: string;
    baselineOffset?: number;
    layoutX?: number;
    layoutY?: number;
    contextRadius?: number;
    id?: string;
    createdAt?: number;
  }
): InlineInkRun | null {
  const penStrokes = strokes.filter((s) => s.tool === "pen" && s.points.length > 0);
  if (penStrokes.length === 0) return null;

  const bounds = penStrokes.reduce(
    (acc, s) => boundsUnion(acc, boundsOfPoints(s.points)),
    emptyBounds()
  );

  const pad = 4;
  const originX = bounds.x - pad;
  const originY = bounds.y - pad;

  const normalized: InkStroke[] = penStrokes.map((s) => {
    const points = s.points.map((p) => ({ ...p, x: p.x - originX, y: p.y - originY }));
    return { ...s, points, bounds: boundsOfPoints(points) };
  });

  const radius = opts.contextRadius ?? 16;
  const offset = Math.max(0, Math.min(opts.anchorOffset, opts.blockText.length));
  const now = Date.now();

  return {
    id: opts.id ?? nextRunId(),
    blockId: opts.blockId,
    anchorOffset: offset,
    contextBefore: opts.blockText.slice(Math.max(0, offset - radius), offset),
    contextAfter: opts.blockText.slice(offset, offset + radius),
    strokes: normalized,
    intrinsicWidth: bounds.width + pad * 2,
    intrinsicHeight: bounds.height + pad * 2,
    baselineOffset: opts.baselineOffset ?? bounds.height + pad,
    ...(opts.layoutX !== undefined && opts.layoutY !== undefined
      ? { layoutX: opts.layoutX, layoutY: opts.layoutY }
      : {}),
    scale: 1,
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
  };
}
