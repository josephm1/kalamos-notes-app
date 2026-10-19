import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./parse";
import { remapBlocks } from "./remap";

describe("remapBlocks", () => {
  it("maps unchanged blocks to themselves by content", () => {
    const a = parseMarkdown("# A\n\nBody one.\n\nBody two.\n");
    const b = parseMarkdown("# A\n\nBody one edited.\n\nBody two.\n");
    const { mapping } = remapBlocks(a, b);
    const aTitle = a.find((x) => x.type === "heading")!;
    const bTitle = b.find((x) => x.type === "heading")!;
    expect(mapping[aTitle.id]).toBe(bTitle.id);

    const aTwo = a.find((x) => x.source === "Body two.")!;
    const bTwo = b.find((x) => x.source === "Body two.")!;
    expect(mapping[aTwo.id]).toBe(bTwo.id);
  });

  it("flags a position-only match as ambiguous", () => {
    const a = parseMarkdown("First.\n\nSecond.\n");
    const b = parseMarkdown("Totally different.\n\nSecond.\n");
    const { ambiguous } = remapBlocks(a, b);
    const aFirst = a.find((x) => x.source === "First.")!;
    expect(ambiguous).toContain(aFirst.id);
  });
});
