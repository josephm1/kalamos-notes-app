import { type ReactNode } from "react";
import type { Block } from "../markdown/parse";
import type { InlineInkRun } from "../ink/types";
import { renderInline, inlineSource } from "./inline";
import { InkRunView } from "./InkRunView";

/** Split the block text at each run's anchor offset and render ink inline. */
function interleaveInk(text: string, runs: InlineInkRun[]): ReactNode[] {
  const sorted = [...runs].sort((a, b) => a.anchorOffset - b.anchorOffset);
  const nodes: ReactNode[] = [];
  let pos = 0;
  sorted.forEach((r, i) => {
    const off = Math.max(0, Math.min(r.anchorOffset, text.length));
    if (off > pos) nodes.push(...renderInline(text.slice(pos, off), `seg${i}-`));
    nodes.push(" ", <InkRunView key={r.id} run={r} />, " ");
    pos = off;
  });
  if (pos < text.length) nodes.push(...renderInline(text.slice(pos), "segEnd-"));
  return nodes;
}

type Props = {
  block: Block;
  runs: InlineInkRun[];
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
};

/**
 * A rendered reading-mode block. Semantic HTML, no visible per-block chrome.
 * Ink runs render inline (after the typed text) sorted by anchor. Hit area
 * extends slightly into the side margins via CSS without a visible box.
 */
export function BlockView({ block, runs, selected, onSelect, onOpen }: Props) {
  const text = inlineSource(block);
  const content: ReactNode = runs.length
    ? interleaveInk(text, runs)
    : renderInline(text);

  const common = {
    className: `block block-${block.type}${selected ? " selected" : ""}`,
    "data-block-id": block.id,
    tabIndex: 0,
    role: "button" as const,
    "aria-label": `${block.type} block. Double-tap or press Enter to edit.`,
    onClick: onSelect,
    onDoubleClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onOpen();
      }
    },
  };

  switch (block.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.depth ?? 1));
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      return <Tag {...common}>{content}</Tag>;
    }
    case "thematicBreak":
      return <hr {...common} aria-label="thematic break" />;
    case "code":
      return (
        <pre {...common}>
          <code>{block.text}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote {...common}>{content}</blockquote>;
    case "listItem": {
      const task = block.source.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+/);
      if (task) {
        const checked = task[1].toLowerCase() === "x";
        return (
          <div {...common} className={`${common.className} list-item task-item`}>
            <input
              type="checkbox"
              checked={checked}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
            />
            <span>{content}</span>
          </div>
        );
      }
      return (
        <div {...common} className={`${common.className} list-item`}>
          <span className="list-bullet" aria-hidden="true">
            {block.ordered ? `${block.listNumber ?? 1}.` : "–"}
          </span>
          <span>{content}</span>
        </div>
      );
    }
    case "table":
      return (
        <pre {...common} className={`${common.className} table-source`}>
          <code>{block.source}</code>
        </pre>
      );
    default:
      return <p {...common}>{content}</p>;
  }
}
