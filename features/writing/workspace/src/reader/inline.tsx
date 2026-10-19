import { Fragment, type ReactNode } from "react";
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

/**
 * Minimal, safe inline Markdown -> React renderer. Handles images, links,
 * inline code, strong, and emphasis. No raw HTML is injected. (BUILD_PLAN §6.)
 */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  const push = (n: ReactNode) => nodes.push(<Fragment key={`${keyPrefix}${key++}`}>{n}</Fragment>);

  // Regex covers: image, link, code, strong (** or __), emphasis (* or _).
  const pattern =
    /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/;

  while (rest.length > 0) {
    const m = pattern.exec(rest);
    if (!m) {
      push(rest);
      break;
    }
    if (m.index > 0) push(rest.slice(0, m.index));

    if (m[1] !== undefined) {
      push(<img src={m[2]} alt={m[1]} className="inline-img" />);
    } else if (m[3] !== undefined) {
      push(
        <a href={m[4]} target="_blank" rel="noreferrer noopener">
          {m[3]}
        </a>
      );
    } else if (m[5] !== undefined) {
      push(<code>{m[5]}</code>);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      push(<strong>{m[6] ?? m[7]}</strong>);
    } else if (m[8] !== undefined || m[9] !== undefined) {
      push(<em>{m[8] ?? m[9]}</em>);
    }

    rest = rest.slice(m.index + m[0].length);
  }

  return nodes;
}
