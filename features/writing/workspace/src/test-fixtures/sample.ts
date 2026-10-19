// A representative sample document covering the supported constructs.
export const SAMPLE_DOC = `---
title: Field Notes
author: You
---

# Field Notes

A calm reading page you can **write on** with a pen. Tap a paragraph to open
it in the focused workspace, then add _handwriting_ right where you need it.

## Foundation

- Markdown stays canonical; the app never rewrites your file.
- Handwriting is stored as vector ink in a companion sidecar.
- Everything works offline, local-first.

### A short list

1. Open a Markdown file.
2. Tap a block to focus it.
3. Write with your pen and press Done.

> Ink is first-class content. It stays handwritten and moves with its block.

Here is some \`inline code\` and a [link](https://www.styluslabs.com/) for context.

\`\`\`ts
function reflow(boxes: Box[], width: number) {
  // keep the largest whole-word prefix that fits
  return place(boxes, width);
}
\`\`\`

- [ ] Try the eraser
- [x] Add a handwritten note

---

The end. Unicode is fine too: café, naïve, 日本語, emoji 🖊️.
`;
