// Vanilla port of src/reader/BlockView.tsx.

import type { Block } from "../markdown/parse";
import type { InlineInkRun } from "../ink/types";
import { renderInline, inlineSource } from "./inline";
import { renderInkRun } from "./inkRunView";

/** Split the block text at each run's anchor offset and render ink inline. */
function interleaveInk(text: string, runs: InlineInkRun[]): (Node | string)[] {
  const sorted = [...runs].sort((a, b) => a.anchorOffset - b.anchorOffset);
  const nodes: (Node | string)[] = [];
  let pos = 0;
  for (const r of sorted) {
    const off = Math.max(0, Math.min(r.anchorOffset, text.length));
    if (off > pos) nodes.push(...renderInline(text.slice(pos, off)));
    nodes.push(" ", renderInkRun(r), " ");
    pos = off;
  }
  if (pos < text.length) nodes.push(...renderInline(text.slice(pos)));
  return nodes;
}

export type BlockViewHandlers = {
  onSelect: () => void;
  onOpen: () => void;
};

/**
 * A rendered reading-mode block. Semantic HTML, no visible per-block chrome.
 * Ink runs render inline (after the typed text) sorted by anchor.
 */
export function renderBlock(
  block: Block,
  runs: InlineInkRun[],
  selected: boolean,
  handlers: BlockViewHandlers
): HTMLElement {
  const text = inlineSource(block);
  const content = runs.length ? interleaveInk(text, runs) : renderInline(text);

  const tagFor: Record<string, string> = {
    heading: `h${Math.min(6, Math.max(1, block.depth ?? 1))}`,
    thematicBreak: "hr",
    code: "pre",
    blockquote: "blockquote",
    listItem: "div",
    table: "pre",
  };
  const tag = tagFor[block.type] ?? "p";
  const el = document.createElement(tag);
  el.className = `block block-${block.type}${selected ? " selected" : ""}`;
  el.dataset.blockId = block.id;
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `${block.type} block. Double-tap or press Enter to edit.`);
  el.addEventListener("click", handlers.onSelect);
  el.addEventListener("dblclick", handlers.onOpen);
  el.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      handlers.onOpen();
    }
  });

  const append = (node: Node | string) =>
    el.appendChild(typeof node === "string" ? document.createTextNode(node) : node);

  switch (block.type) {
    case "thematicBreak":
      el.setAttribute("aria-label", "thematic break");
      break;
    case "code": {
      const code = document.createElement("code");
      code.textContent = block.text;
      el.appendChild(code);
      break;
    }
    case "table": {
      el.classList.add("table-source");
      const code = document.createElement("code");
      code.textContent = block.source;
      el.appendChild(code);
      break;
    }
    case "listItem": {
      el.classList.add("list-item");
      const task = block.source.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+/);
      if (task) {
        el.classList.add("task-item");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task[1].toLowerCase() === "x";
        checkbox.readOnly = true;
        checkbox.tabIndex = -1;
        checkbox.setAttribute("aria-hidden", "true");
        el.appendChild(checkbox);
        const span = document.createElement("span");
        for (const n of content) span.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
        el.appendChild(span);
      } else {
        const bullet = document.createElement("span");
        bullet.className = "list-bullet";
        bullet.setAttribute("aria-hidden", "true");
        bullet.textContent = block.ordered ? `${block.listNumber ?? 1}.` : "–";
        el.appendChild(bullet);
        const span = document.createElement("span");
        for (const n of content) span.appendChild(typeof n === "string" ? document.createTextNode(n) : n);
        el.appendChild(span);
      }
      break;
    }
    default:
      for (const n of content) append(n);
  }

  return el;
}
