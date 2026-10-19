import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../markdown/parse";
import { createEmptySidecar } from "../sidecar/schema";
import { commitBlockEdit } from "./commit";
import type { InlineInkRun } from "../ink/types";

const DOC = `# Title

First paragraph.

Second paragraph.
`;

function fakeRun(blockId: string, id = "run-1"): InlineInkRun {
  return {
    id,
    blockId,
    anchorOffset: 3,
    contextBefore: "Fir",
    contextAfter: "st",
    strokes: [
      {
        id: "s1",
        tool: "pen",
        color: "#000",
        width: 2,
        points: [{ x: 0, y: 0, t: 0, pressure: 0.5 }],
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      },
    ],
    intrinsicWidth: 10,
    intrinsicHeight: 10,
    baselineOffset: 8,
    scale: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("commitBlockEdit", () => {
  it("edits one block and preserves the rest byte-for-byte", () => {
    const blocks = parseMarkdown(DOC);
    const first = blocks.find((b) => b.source === "First paragraph.")!;
    const sidecar = createEmptySidecar("d.md", "h");
    const out = commitBlockEdit({
      source: DOC,
      blocks,
      sidecar,
      editedBlock: first,
      newBlockSource: "First paragraph edited.",
      newRuns: [],
    });
    expect(out.source).toContain("First paragraph edited.");
    expect(out.source).toContain("Second paragraph.");
    expect(out.source).toContain("# Title");
  });

  it("anchors a new ink run to the edited block's new identity", () => {
    const blocks = parseMarkdown(DOC);
    const first = blocks.find((b) => b.source === "First paragraph.")!;
    const sidecar = createEmptySidecar("d.md", "h");
    const out = commitBlockEdit({
      source: DOC,
      blocks,
      sidecar,
      editedBlock: first,
      newBlockSource: "First paragraph.",
      newRuns: [fakeRun(first.id)],
    });
    expect(out.sidecar.inkRuns).toHaveLength(1);
    const newFirst = out.blocks.find((b) => b.source === "First paragraph.")!;
    expect(out.sidecar.inkRuns[0].blockId).toBe(newFirst.id);
  });

  it("carries an existing run forward across an unrelated edit", () => {
    const blocks = parseMarkdown(DOC);
    const second = blocks.find((b) => b.source === "Second paragraph.")!;
    const first = blocks.find((b) => b.source === "First paragraph.")!;
    const sidecar = {
      ...createEmptySidecar("d.md", "h"),
      inkRuns: [fakeRun(first.id)],
    };
    const out = commitBlockEdit({
      source: DOC,
      blocks,
      sidecar,
      editedBlock: second,
      newBlockSource: "Second paragraph changed.",
      newRuns: [],
    });
    const newFirst = out.blocks.find((b) => b.source === "First paragraph.")!;
    expect(out.sidecar.inkRuns).toHaveLength(1);
    expect(out.sidecar.inkRuns[0].blockId).toBe(newFirst.id);
  });
});

describe('placed text annotation commits', () => {
  it('remaps boxes after source changes and replaces only the edited block boxes', () => {
    const blocks = parseMarkdown(DOC);
    const editedBlock = blocks.find(b => b.source === 'First paragraph.')!;
    const other = blocks.find(b => b.source === 'Second paragraph.')!;
    const box = { id: 'box', blockId: editedBlock.id, text: 'Android text', x: 72, y: 120, width: 240, size: 19 };
    const otherBox = { ...box, id: 'other', blockId: other.id };
    const sidecar = { ...createEmptySidecar('d.md', 'h'), textBoxes: [box, otherBox] };
    const saved = commitBlockEdit({ source: DOC, blocks, sidecar, editedBlock, newBlockSource: 'First paragraph edited.', newRuns: [], textBoxes: [{ ...box, x: 144 }] });
    expect(saved.sidecar.textBoxes).toHaveLength(2);
    const restored = saved.sidecar.textBoxes!.find(b => b.id === 'box')!;
    expect(restored.x).toBe(144);
    expect(restored.blockId).toBe(saved.blocks.find(b => b.source === 'First paragraph edited.')!.id);
    const cleared = commitBlockEdit({ source: saved.source, blocks: saved.blocks, sidecar: saved.sidecar, editedBlock: saved.blocks.find(b => b.id === restored.blockId)!, newBlockSource: 'First paragraph edited.', newRuns: [], textBoxes: [] });
    expect(cleared.sidecar.textBoxes?.map(b => b.id)).toEqual(['other']);
  });
});

it('commits free objects for one block while retaining other blocks and removing deleted objects',()=>{
  const blocks=parseMarkdown(DOC), edited=blocks[1], other=blocks[2];
  const sidecar=createEmptySidecar('doc','hash');
  const object={id:'shape',blockId:edited.id,kind:'rectangle' as const,x:10,y:20,width:80,height:60,color:'#000000',strokeWidth:2};
  sidecar.pageObjects=[object,{...object,id:'other',blockId:other.id}];
  const out=commitBlockEdit({source:DOC,blocks,sidecar,editedBlock:edited,newBlockSource:edited.source,newRuns:[],pageObjects:[{...object,x:30}]});
  expect(out.sidecar.pageObjects).toHaveLength(2);
  expect(out.sidecar.pageObjects?.find(o=>o.id==='shape')?.x).toBe(30);
  const removed=commitBlockEdit({source:DOC,blocks,sidecar,editedBlock:edited,newBlockSource:edited.source,newRuns:[],pageObjects:[]});
  expect(removed.sidecar.pageObjects?.map(o=>o.id)).toEqual(['other']);
});
