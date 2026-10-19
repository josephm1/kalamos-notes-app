import type { Block } from "../markdown/parse";

/**
 * How a block is edited: inline blocks expose their inline Markdown with the
 * leading marker stripped; structural blocks (code, table, list, blockquote,
 * html) edit their raw source so nothing is lost. See BUILD_PLAN.md §6.
 */
export type EditableView = {
  /** Text shown in the textarea. */
  value: string;
  /** Whether to use a monospace editor. */
  monospace: boolean;
  /** Rebuild the canonical block source from edited text. */
  rebuild: (edited: string) => string;
};

export function editableView(block: Block): EditableView {
  switch (block.type) {
    case "heading": {
      const m = block.source.match(/^(#{1,6}\s+)/);
      const prefix = m ? m[1] : "# ";
      const value = block.source.slice(prefix.length).replace(/\s+#*\s*$/, "");
      return { value, monospace: false, rebuild: (e) => `${prefix}${e}` };
    }
    case "listItem": {
      const m = block.source.match(/^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/);
      const prefix = m ? m[1] : "- ";
      const value = block.source.slice(prefix.length);
      return { value, monospace: false, rebuild: (e) => `${prefix}${e}` };
    }
    case "paragraph":
      return { value: block.source, monospace: false, rebuild: (e) => e };
    case "code":
    case "table":
    case "html":
    case "blockquote":
    default:
      // Edit raw source verbatim.
      return {
        value: block.source,
        monospace: block.type === "code" || block.type === "table",
        rebuild: (e) => e,
      };
  }
}
