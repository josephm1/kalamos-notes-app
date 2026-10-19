import { useMemo } from "react";
import type { InlineInkRun } from "../ink/types";
import { outlinePathD, strokeOutline } from "../ink/geometry";

/** Render a committed ink run as inline SVG so it stays sharp on HiDPI/e-ink. */
export function InkRunView({ run }: { run: InlineInkRun }) {
  const paths = useMemo(
    () =>
      run.strokes
        .filter((s) => s.tool === "pen")
        .map((s) => ({
          d: outlinePathD(strokeOutline(s.points, s.width)),
          color: s.color,
        })),
    [run]
  );

  const w = run.intrinsicWidth * run.scale;
  const h = run.intrinsicHeight * run.scale;

  return (
    <span
      className="ink-run"
      role="img"
      aria-label="handwritten note"
      style={{ width: w, height: h, verticalAlign: `-${(h - run.baselineOffset * run.scale).toFixed(1)}px` }}
    >
      <svg
        viewBox={`0 0 ${run.intrinsicWidth} ${run.intrinsicHeight}`}
        width={w}
        height={h}
        aria-hidden="true"
      >
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} />
        ))}
      </svg>
    </span>
  );
}
