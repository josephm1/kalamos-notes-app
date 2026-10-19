// Pure model for the Write-style insert-and-reflow workspace. The block's typed
// text is a list of words; the pen inserts "gap" (open space) or "ink" objects
// between words. Existing words never change — they just reflow. On commit the
// ink becomes inline runs anchored at the right character offset, and if no word
// text changed the block source stays byte-identical. See BUILD_PLAN.md §5.4, §9.

import type { InkStroke } from "../ink/types";

export type Insert = {
  id: string;
  /** Index of the word this insert follows; -1 means before the first word. */
  afterWord: number;
  kind: "gap" | "ink" | "line";
  width: number;
  height: number;
  /** Transient spacing handle coordinates; word/ink positions are already committed. */
  scopeLine?: number;
  scopeX?: number;
  /** Whole ruled lines inserted below this anchor (line inserts only). */
  lines?: number;
  /** Distance from this ink run's visual top to its ruled writing line. */
  baselineOffset?: number;
  /** Linear ruled-page whitespace retained before packing this ink into flow. */
  flowAdvance?: number;
  /**
   * Newly drawn ink remains at its pen position until a reflow gesture packs
   * it into reading order. This mirrors Write: writing itself does not invent
   * horizontal space or reshuffle the paragraph.
   */
  freeX?: number;
  freeY?: number;
  strokes: InkStroke[];
  // NOTE: anchor positions (the slot coords strokes were last synced to) are
  // deliberately NOT part of this model. They live in a ref in PenWorkspace —
  // storing them in state let React rebase anchor-clearing updates against
  // the follow effect's adoption updates, causing an infinite update loop.
};

import type { TextBox } from "../sidecar/schema";

export type ReflowDoc = {
  /** Explicit source-word placement after condensing mixed text and ink; included in Undo. */
  sourceWordPositions?: {text:string;x:number;y:number}[];
  words: string[];
  inserts: Insert[];
  textBoxes?: TextBox[];
  pageObjects?: import("./pageObjects").PageObject[];
};

export function tokenizeWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

export function textFromWords(words: string[]): string {
  return words.join(" ");
}

/** Character offset in `textFromWords(words)` at the slot after `afterWord`. */
export function anchorOffsetForInsert(words: string[], afterWord: number): number {
  if (afterWord < 0) return 0;
  const upto = words.slice(0, afterWord + 1).join(" ");
  return upto.length;
}

let insertCounter = 0;
export function newInsertId(prefix = "ins"): string {
  return `${prefix}-${Date.now().toString(36)}-${insertCounter++}`;
}

/**
 * Ordered flow: word, then any inserts anchored after it (inserts after -1
 * first). Array order is deliberately retained for inserts sharing an anchor:
 * it is their reading order and prevents independently positioned ink/gaps
 * from swapping places after a reflow.
 */
export function orderedFlow(doc: ReflowDoc): Array<
  | { kind: "word"; index: number; text: string }
  | { kind: "insert"; insert: Insert }
> {
  const out: Array<
    { kind: "word"; index: number; text: string } | { kind: "insert"; insert: Insert }
  > = [];
  const insertsAt = (i: number) =>
    doc.inserts.filter((ins) => ins.afterWord === i);
  for (const ins of insertsAt(-1)) out.push({ kind: "insert", insert: ins });
  for (let i = 0; i < doc.words.length; i++) {
    out.push({ kind: "word", index: i, text: doc.words[i] });
    for (const ins of insertsAt(i)) out.push({ kind: "insert", insert: ins });
  }
  return out;
}

/** Re-tokenize after a text edit, clamping insert anchors into range. */
export function retokenize(doc: ReflowDoc, newText: string): ReflowDoc {
  const words = tokenizeWords(newText);
  const max = words.length - 1;
  const inserts = doc.inserts.map((ins) => ({
    ...ins,
    afterWord: Math.min(ins.afterWord, max),
  }));
  return { ...doc, words, inserts };
}

export function removeInsert(doc: ReflowDoc, id: string): ReflowDoc {
  return { ...doc, inserts: doc.inserts.filter((i) => i.id !== id) };
}

export function updateInsert(
  doc: ReflowDoc,
  id: string,
  patch: Partial<Insert>
): ReflowDoc {
  return {
    ...doc,
    inserts: doc.inserts.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  };
}

/**
 * Close every form of reflow whitespace. `flowAdvance` is the otherwise
 * invisible distance used to retain an ink run's original ruled-page
 * position. It must be cleared here as well as visible gap/line inserts;
 * otherwise Collapse closes typed content on the right while leaving the
 * handwriting stranded at its former x/line on the left.
 */
export function collapseSpacing(doc: ReflowDoc): ReflowDoc {
  return {
    ...doc,
    inserts: doc.inserts
      .filter((insert) => insert.kind === "ink")
      .map((insert) => {
        const { flowAdvance: _flowAdvance, ...collapsed } = insert;
        void _flowAdvance;
        return collapsed;
      }),
  };
}
