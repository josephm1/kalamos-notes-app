// Ink data model — see BUILD_PLAN.md §7 and §9 "Ink representation".
// Coordinates are stored in *workspace* coordinates, not screen coordinates.

export type InkPoint = {
  x: number;
  y: number;
  t: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
};

export type InkStroke = {
  id: string;
  tool: "pen" | "eraser";
  brushStyle?: "pen" | "brush" | "marker";
  color: string;
  /** Base stroke width in px before pressure mapping. */
  width: number;
  points: InkPoint[];
  bounds: Bounds;
};

export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * An inline ink run behaves like an inline image but stays editable vector
 * data. It participates in line wrapping as one atomic word-like box.
 */
export type InlineInkRun = {
  id: string;
  blockId: string;
  /** Character offset within the block's rendered text where the run anchors. */
  anchorOffset: number;
  /** Short text context for recovery/remapping after source edits. */
  contextBefore: string;
  contextAfter: string;
  strokes: InkStroke[];
  intrinsicWidth: number;
  intrinsicHeight: number;
  baselineOffset: number;
  /**
   * Optional ruled-workspace placement. When present, reopening restores the
   * run at the exact page position the user left instead of packing it back
   * into reading flow. Older sidecars omit these fields and retain the legacy
   * inline behaviour.
   */
  layoutX?: number;
  layoutY?: number;
  scale: number;
  createdAt: number;
  updatedAt: number;
};

export function emptyBounds(): Bounds {
  return { x: 0, y: 0, width: 0, height: 0 };
}

export function boundsOfPoints(points: InkPoint[], pad = 0): Bounds {
  if (points.length === 0) return emptyBounds();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

export function boundsUnion(a: Bounds, b: Bounds): Bounds {
  if (a.width === 0 && a.height === 0) return b;
  if (b.width === 0 && b.height === 0) return a;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
