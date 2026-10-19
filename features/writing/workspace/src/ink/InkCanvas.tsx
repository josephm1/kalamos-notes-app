import { useEffect, useRef, useCallback } from "react";
import type { InkPoint, InkStroke } from "./types";
import { boundsOfPoints, boundsUnion } from "./types";
import { drawStroke } from "./render";

let strokeCounter = 0;
function nextStrokeId(): string {
  return `s${Date.now().toString(36)}-${strokeCounter++}`;
}

type Props = {
  width: number;
  height: number;
  tool: "pen" | "eraser";
  color: string;
  penWidth: number;
  strokes: InkStroke[];
  onChange: (strokes: InkStroke[]) => void;
  /** Called whenever a pen event lands, so parent can gate palm rejection. */
  onPenActivity?: () => void;
};

/**
 * Transparent ink overlay owned by the one active block. Only the pen writes;
 * touch is ignored while the pen is (or was recently) active. Mouse is allowed
 * for development. See BUILD_PLAN.md §5.6 and §9.
 */
export function InkCanvas({
  width,
  height,
  tool,
  color,
  penWidth,
  strokes,
  onChange,
  onPenActivity,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveStroke = useRef<InkStroke | null>(null);
  const activePointerId = useRef<number | null>(null);
  const lastPenActivity = useRef(0);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const s of strokes) {
      if (s.tool === "pen") drawStroke(ctx, s);
    }
  }, [strokes, width, height, dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    redrawAll();
  }, [width, height, dpr, redrawAll]);

  const toWorkspace = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const pointFrom = (e: PointerEvent | React.PointerEvent): InkPoint => {
    const { x, y } = toWorkspace(e);
    return {
      x,
      y,
      t: performance.now(),
      pressure: (e as PointerEvent).pressure ?? 0.5,
      tiltX: (e as PointerEvent).tiltX,
      tiltY: (e as PointerEvent).tiltY,
    };
  };

  const shouldIgnore = (e: React.PointerEvent): boolean => {
    if (e.pointerType === "touch") {
      // Palm rejection: ignore touch during / just after pen contact.
      const sincePen = performance.now() - lastPenActivity.current;
      if (activePointerId.current !== null || sincePen < 500) return true;
      // Touch is for scrolling, not writing.
      return true;
    }
    return false;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") {
      lastPenActivity.current = performance.now();
      onPenActivity?.();
    }
    if (shouldIgnore(e)) return;
    if (activePointerId.current !== null) return;

    // Barrel button (buttons bit 2) or eraser pointer -> erase.
    const eraseNow =
      tool === "eraser" ||
      (e.buttons & 32) !== 0 || // eraser tip
      (e.buttons & 2) !== 0; // barrel button

    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;

    if (eraseNow) {
      liveStroke.current = null;
      eraseAt(pointFrom(e));
      return;
    }

    const p = pointFrom(e);
    liveStroke.current = {
      id: nextStrokeId(),
      tool: "pen",
      color,
      width: penWidth,
      points: [p],
      bounds: boundsOfPoints([p]),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerId !== activePointerId.current) return;
    if (e.pointerType === "pen") lastPenActivity.current = performance.now();

    const eraseNow =
      tool === "eraser" || (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0;
    if (eraseNow || !liveStroke.current) {
      if (eraseNow) eraseAt(pointFrom(e));
      return;
    }

    const stroke = liveStroke.current;
    const prevLen = stroke.points.length;

    const native = e.nativeEvent as PointerEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function"
        ? native.getCoalescedEvents()
        : [native];
    for (const ce of coalesced.length ? coalesced : [native]) {
      stroke.points.push(pointFrom(ce));
    }

    // Draw only the new segment(s) for low latency; no React round-trip.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx) drawStroke(ctx, stroke, prevLen);
  };

  const finishStroke = (e: React.PointerEvent) => {
    if (e.pointerId !== activePointerId.current) return;
    activePointerId.current = null;
    const stroke = liveStroke.current;
    liveStroke.current = null;
    if (!stroke || stroke.points.length === 0) return;
    stroke.bounds = boundsOfPoints(stroke.points);
    onChange([...strokes, stroke]);
  };

  const eraseAt = (p: InkPoint) => {
    const radius = 12;
    const survivors = strokes.filter((s) => !strokeHitsPoint(s, p, radius));
    if (survivors.length !== strokes.length) {
      onChange(survivors);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="ink-canvas"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onPointerLeave={(e) => {
        // Ending safely on leave prevents dangling strokes on backgrounding.
        if (e.pointerId === activePointerId.current) finishStroke(e);
      }}
    />
  );
}

function strokeHitsPoint(stroke: InkStroke, p: InkPoint, radius: number): boolean {
  for (const q of stroke.points) {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (dx * dx + dy * dy <= radius * radius) return true;
  }
  return false;
}

/** Union bounds of a set of strokes (used to size a committed run). */
export function strokesBounds(strokes: InkStroke[]) {
  return strokes.reduce(
    (acc, s) => boundsUnion(acc, s.bounds),
    boundsOfPoints([])
  );
}
