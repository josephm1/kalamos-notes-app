// Vanilla port of src/reader/InkRunView.tsx.

import type { InlineInkRun } from "../ink/types";
import { outlinePathD, strokeOutline } from "../ink/geometry";
import { svg } from "./dom";

export function renderInkRun(run: InlineInkRun): HTMLElement {
  const w = run.intrinsicWidth * run.scale;
  const h = run.intrinsicHeight * run.scale;

  const root = document.createElement("span");
  root.className = "ink-run";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "handwritten note");
  root.style.width = `${w}px`;
  root.style.height = `${h}px`;
  root.style.verticalAlign = `-${(h - run.baselineOffset * run.scale).toFixed(1)}px`;

  const svgEl = svg("svg", {
    viewBox: `0 0 ${run.intrinsicWidth} ${run.intrinsicHeight}`,
    width: w,
    height: h,
  });
  svgEl.setAttribute("aria-hidden", "true");

  for (const s of run.strokes) {
    if (s.tool !== "pen") continue;
    const path = svg("path", { d: outlinePathD(strokeOutline(s.points, s.width)) });
    path.setAttribute("fill", s.color);
    svgEl.appendChild(path);
  }

  root.appendChild(svgEl);
  return root;
}
