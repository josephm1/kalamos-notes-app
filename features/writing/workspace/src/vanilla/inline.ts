// Vanilla port of src/reader/inline.tsx. Same matching logic (image, link,
// inline code, strong, emphasis), producing real DOM nodes instead of React
// elements. No raw HTML is injected — every node is built with createElement.

import type { Block } from "../markdown/parse";

/** Remove a block's leading Markdown marker so we render its inline content. */
export function inlineSource(block: Block): string {
  const s = block.source;
  switch (block.type) {
    case "heading":
      return s.replace(/^#{1,6}\s+/, "").replace(/\s+#*\s*$/, "");
    case "blockquote":
      return s
        .split("\n")
        .map((l) => l.replace(/^\s*>\s?/, ""))
        .join("\n");
    case "listItem":
      return s.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "");
    default:
      return s;
  }
}

const PATTERN =
  /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/;

/** Minimal, safe inline Markdown -> DOM node renderer. */
export function renderInline(text: string): (Node | string)[] {
  const nodes: (Node | string)[] = [];
  let rest = text;

  while (rest.length > 0) {
    const m = PATTERN.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));

    if (m[1] !== undefined) {
      const img = document.createElement("img");
      img.src = m[2];
      img.alt = m[1];
      img.className = "inline-img";
      nodes.push(img);
    } else if (m[3] !== undefined) {
      const a = document.createElement("a");
      a.href = m[4];
      a.target = "_blank";
      a.rel = "noreferrer noopener";
      a.textContent = m[3];
      nodes.push(a);
    } else if (m[5] !== undefined) {
      const code = document.createElement("code");
      code.textContent = m[5];
      nodes.push(code);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      const strong = document.createElement("strong");
      strong.textContent = m[6] ?? m[7];
      nodes.push(strong);
    } else if (m[8] !== undefined || m[9] !== undefined) {
      const em = document.createElement("em");
      em.textContent = m[8] ?? m[9];
      nodes.push(em);
    }

    rest = rest.slice(m.index + m[0].length);
  }

  return nodes;
}
