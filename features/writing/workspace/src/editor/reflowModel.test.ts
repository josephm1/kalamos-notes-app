import { describe, it, expect } from "vitest";
import {
  tokenizeWords,
  textFromWords,
  anchorOffsetForInsert,
  orderedFlow,
  retokenize,
  collapseSpacing,
  type ReflowDoc,
} from "./reflowModel";

const doc = (words: string[], inserts: ReflowDoc["inserts"] = []): ReflowDoc => ({
  words,
  inserts,
});

describe("reflowModel", () => {
  it("tokenizes and rejoins text without changing content", () => {
    const words = tokenizeWords("the quick brown fox");
    expect(words).toEqual(["the", "quick", "brown", "fox"]);
    expect(textFromWords(words)).toBe("the quick brown fox");
  });

  it("computes anchor offset at a word slot", () => {
    const words = ["the", "quick", "brown"];
    expect(anchorOffsetForInsert(words, -1)).toBe(0);
    expect(anchorOffsetForInsert(words, 0)).toBe(3); // "the"
    expect(anchorOffsetForInsert(words, 1)).toBe(9); // "the quick"
  });

  it("orders inserts after their anchor word", () => {
    const d = doc(
      ["a", "b"],
      [
        { id: "i1", afterWord: 0, kind: "gap", width: 20, height: 10, strokes: [] },
      ]
    );
    const flow = orderedFlow(d);
    expect(flow.map((f) => f.kind)).toEqual(["word", "insert", "word"]);
  });

  it("retains the order of mixed objects sharing an anchor", () => {
    const d = doc(
      ["a", "b"],
      [
        { id: "ink", afterWord: 0, kind: "ink", width: 20, height: 10, strokes: [] },
        { id: "icon-space", afterWord: 0, kind: "gap", width: 12, height: 10, strokes: [] },
        { id: "lines", afterWord: 0, kind: "line", width: 0, height: 20, lines: 1, strokes: [] },
      ]
    );
    const flow = orderedFlow(d);
    expect(flow.map((f) => (f.kind === "word" ? f.text : f.insert.id))).toEqual([
      "a",
      "ink",
      "icon-space",
      "lines",
      "b",
    ]);
  });

  it("clamps insert anchors when text shrinks", () => {
    const d = doc(
      ["a", "b", "c"],
      [{ id: "i1", afterWord: 2, kind: "ink", width: 20, height: 10, strokes: [] }]
    );
    const next = retokenize(d, "a");
    expect(next.words).toEqual(["a"]);
    expect(next.inserts[0].afterWord).toBe(0);
  });

  it("collapses visible spacing and retained whitespace before handwriting", () => {
    const d = doc(
      ["a", "b"],
      [
        { id: "gap", afterWord: 0, kind: "gap", width: 80, height: 44, strokes: [] },
        { id: "lines", afterWord: 0, kind: "line", width: 0, height: 88, lines: 2, strokes: [] },
        {
          id: "ink",
          afterWord: 0,
          kind: "ink",
          width: 50,
          height: 44,
          flowAdvance: 760,
          baselineOffset: 36,
          strokes: [],
        },
      ]
    );

    const next = collapseSpacing(d);
    expect(next.inserts).toHaveLength(1);
    expect(next.inserts[0]).toMatchObject({
      id: "ink",
      kind: "ink",
      baselineOffset: 36,
    });
    expect(next.inserts[0].flowAdvance).toBeUndefined();
  });
});
