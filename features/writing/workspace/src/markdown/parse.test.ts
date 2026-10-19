import { describe, it, expect } from "vitest";
import { parseMarkdown, replaceBlockSource } from "./parse";

const DOC = `---
title: t
---

# Heading

First paragraph with **bold**.

- item one
- item two

> a quote

\`\`\`js
code();
\`\`\`
`;

describe("parseMarkdown", () => {
  it("produces positional blocks with exact source slices", () => {
    const blocks = parseMarkdown(DOC);
    for (const b of blocks) {
      expect(DOC.slice(b.sourceStart, b.sourceEnd)).toBe(b.source);
    }
  });

  it("identifies block types", () => {
    const blocks = parseMarkdown(DOC);
    const types = blocks.map((b) => b.type);
    expect(types).toContain("yaml");
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
    expect(types).toContain("blockquote");
    expect(types).toContain("code");
  });

  it("captures heading depth", () => {
    const [, heading] = parseMarkdown(DOC).filter((b) => b.type === "heading");
    const h = parseMarkdown(DOC).find((b) => b.type === "heading")!;
    expect(h.depth).toBe(1);
    void heading;
  });
});

describe("replaceBlockSource", () => {
  it("replaces only the target range, byte-preserving the rest", () => {
    const blocks = parseMarkdown(DOC);
    const heading = blocks.find((b) => b.type === "heading")!;
    const next = replaceBlockSource(DOC, heading, "# New Heading");
    expect(next).toContain("# New Heading");
    // YAML front matter and code fence untouched.
    expect(next).toContain("title: t");
    expect(next).toContain("code();");
    // Everything outside the heading range is identical.
    expect(next.slice(0, heading.sourceStart)).toBe(DOC.slice(0, heading.sourceStart));
    expect(next.slice(heading.sourceStart + "# New Heading".length)).toBe(
      DOC.slice(heading.sourceEnd)
    );
  });

  it("saving without an edit is byte-for-byte identical", () => {
    const blocks = parseMarkdown(DOC);
    const heading = blocks.find((b) => b.type === "heading")!;
    const next = replaceBlockSource(DOC, heading, heading.source);
    expect(next).toBe(DOC);
  });
});
