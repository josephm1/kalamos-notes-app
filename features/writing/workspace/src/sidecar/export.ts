// Export helpers: paired project, standalone sidecar, and self-contained HTML
// with typed text + inline SVG ink for sharing/printing. See BUILD_PLAN.md §8, §12.

import type { Block } from "../markdown/parse";
import type { Sidecar } from "./schema";
import { serializeSidecar } from "./schema";
import { strokesToSvg } from "../ink/render";
import { downloadText } from "../documents/files";

export function sidecarFilename(documentName: string): string {
  const base = documentName.replace(/\.(md|markdown|txt)$/i, "");
  return `${base}.write2.json`;
}

export function exportSidecar(sidecar: Sidecar): void {
  downloadText(
    serializeSidecar(sidecar),
    sidecarFilename(sidecar.documentName),
    "application/json"
  );
}

/**
 * Export both files as a single JSON "project" bundle. Simple, dependency-free
 * container so a project moves between devices without a zip library.
 */
export function exportProject(
  documentName: string,
  source: string,
  sidecar: Sidecar
): void {
  const bundle = {
    format: "write2.project",
    version: 1,
    documentName,
    markdown: source,
    sidecar,
  };
  const base = documentName.replace(/\.(md|markdown|txt)$/i, "");
  downloadText(JSON.stringify(bundle, null, 2), `${base}.write2project.json`, "application/json");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Minimal self-contained HTML export (typed text + inline SVG ink). */
export function exportHtml(
  documentName: string,
  blocks: Block[],
  sidecar: Sidecar
): void {
  const runsByBlock = new Map<string, Sidecar["inkRuns"]>();
  for (const run of sidecar.inkRuns) {
    const arr = runsByBlock.get(run.blockId) ?? [];
    arr.push(run);
    runsByBlock.set(run.blockId, arr);
  }

  const body = blocks
    .map((b) => {
      const runs = runsByBlock.get(b.id) ?? [];
      const inkHtml = runs
        .map((r) => {
          const svg = strokesToSvg(r.strokes, r.intrinsicWidth, r.intrinsicHeight);
          return `<span class="ink" style="display:inline-block;vertical-align:baseline;width:${r.intrinsicWidth}px;height:${r.intrinsicHeight}px">${svg}</span>`;
        })
        .join(" ");
      const text = escapeHtml(b.text);
      const inner = inkHtml ? `${text} ${inkHtml}` : text;
      switch (b.type) {
        case "heading":
          return `<h${b.depth ?? 1}>${inner}</h${b.depth ?? 1}>`;
        case "thematicBreak":
          return "<hr/>";
        case "code":
          return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
        case "blockquote":
          return `<blockquote>${inner}</blockquote>`;
        default:
          return `<p>${inner}</p>`;
      }
    })
    .join("\n");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    documentName
  )}</title><style>body{font:18px/1.6 Georgia,serif;max-width:720px;margin:24px auto;padding:0 16px;color:#1a1a1a}.ink svg{overflow:visible}</style></head><body>${body}</body></html>`;

  const base = documentName.replace(/\.(md|markdown|txt)$/i, "");
  downloadText(html, `${base}.html`, "text/html");
}
