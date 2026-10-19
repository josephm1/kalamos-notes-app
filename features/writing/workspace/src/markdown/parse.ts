// Parse Markdown into positional top-level blocks, keeping exact source ranges
// so committing a block replaces only that block's source. The original source
// string is always retained. See BUILD_PLAN.md §6 "Round-trip preservation".

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import type { Root, RootContent } from "mdast";

export type BlockType =
  | "heading"
  | "paragraph"
  | "listItem"
  | "list"
  | "blockquote"
  | "code"
  | "thematicBreak"
  | "table"
  | "html"
  | "yaml"
  | "other";

export type Block = {
  /** Stable-for-this-parse id; remapped across edits by the sidecar layer. */
  id: string;
  type: BlockType;
  /** Byte/char offsets into the canonical source string. */
  sourceStart: number;
  sourceEnd: number;
  /** Exact source slice for this block. */
  source: string;
  /** Plain rendered text (best-effort) used for editing + anchoring. */
  text: string;
  /** Heading depth when type === "heading". */
  depth?: number;
  /** Ordered/unordered when a list item. */
  ordered?: boolean;
  /** 1-based number for an ordered list item. */
  listNumber?: number;
  /** Code language when a fenced code block. */
  lang?: string;
};

export type ParsedDocument = {
  source: string;
  blocks: Block[];
  /** Fingerprint of the source (see documents/fingerprint). */
};

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm);

export function parseMarkdown(source: string): Block[] {
  const tree = processor.parse(source) as Root;
  const blocks: Block[] = [];
  let counter = 0;

  const pushBlock = (b: Omit<Block, "id">) => {
    blocks.push({ id: `b${counter++}`, ...b });
  };

  for (const node of tree.children) {
    // Flatten lists so each item is its own editable block (§6).
    if (node.type === "list") {
      const ordered = node.ordered ?? false;
      let n = node.start ?? 1;
      for (const item of node.children) {
        const range = nodeRange(item, source);
        if (!range) continue;
        pushBlock({
          type: "listItem",
          sourceStart: range.start,
          sourceEnd: range.end,
          source: source.slice(range.start, range.end),
          text: extractText(item),
          ordered,
          listNumber: ordered ? n : undefined,
        });
        n += 1;
      }
      continue;
    }

    const range = nodeRange(node, source);
    if (!range) continue;
    pushBlock({
      type: mapType(node.type),
      sourceStart: range.start,
      sourceEnd: range.end,
      source: source.slice(range.start, range.end),
      text: extractText(node),
      depth: node.type === "heading" ? node.depth : undefined,
      lang: node.type === "code" ? node.lang ?? undefined : undefined,
    });
  }

  return blocks;
}

function mapType(t: string): BlockType {
  switch (t) {
    case "heading":
    case "paragraph":
    case "listItem":
    case "list":
    case "blockquote":
    case "code":
    case "thematicBreak":
    case "table":
    case "html":
    case "yaml":
      return t;
    default:
      return "other";
  }
}

function nodeRange(
  node: RootContent,
  source: string
): { start: number; end: number } | null {
  const pos = node.position;
  if (!pos || pos.start.offset == null || pos.end.offset == null) return null;
  // Trim to not swallow the trailing block-separating newline; keep the block
  // slice tight so replacements don't disturb surrounding blank lines.
  let start = pos.start.offset;
  let end = pos.end.offset;
  // Clamp defensively.
  start = Math.max(0, Math.min(start, source.length));
  end = Math.max(start, Math.min(end, source.length));
  return { start, end };
}

/** Best-effort plain-text extraction for editing + ink anchoring. */
export function extractText(node: RootContent): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map((c) => extractText(c as RootContent)).join("");
  }
  return "";
}

/**
 * Replace exactly one block's source range within the canonical source and
 * return the new source. Everything outside the range is byte-preserved.
 */
export function replaceBlockSource(
  source: string,
  block: Block,
  newSource: string
): string {
  return (
    source.slice(0, block.sourceStart) +
    newSource +
    source.slice(block.sourceEnd)
  );
}
