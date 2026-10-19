// Pure document-commit logic: replace one block's source range, reparse, remap
// block identity, and carry ink runs forward. Kept pure for unit testing.
// See BUILD_PLAN.md §6.

import type { Block } from "../markdown/parse";
import { parseMarkdown, replaceBlockSource } from "../markdown/parse";
import { remapBlocks } from "../markdown/remap";
import { contentHash } from "../documents/fingerprint";
import type { Sidecar, BlockAnchor } from "../sidecar/schema";
import type { InlineInkRun } from "../ink/types";

export type CommitInput = {
  source: string;
  blocks: Block[];
  sidecar: Sidecar;
  editedBlock: Block;
  newBlockSource: string;
  /** The complete set of ink runs for the edited block after editing. */
  newRuns: InlineInkRun[];
  pageObjects?: import("../editor/pageObjects").PageObject[];
  textBoxes?: import("../sidecar/schema").TextBox[];
};

export type CommitOutput = {
  source: string;
  blocks: Block[];
  sidecar: Sidecar;
};

export function commitBlockEdit(input: CommitInput): CommitOutput {
  const { source, blocks, sidecar, editedBlock, newBlockSource, newRuns } = input;

  const newSource = replaceBlockSource(source, editedBlock, newBlockSource);
  const newBlocks = parseMarkdown(newSource);
  const { mapping } = remapBlocks(blocks, newBlocks);

  const mapId = (oldId: string): string | null => mapping[oldId] ?? null;
  const newEditedId = mapId(editedBlock.id);

  // Carry forward runs of OTHER blocks; the editor owns the edited block's runs.
  const placed: InlineInkRun[] = [];
  const unplaced: InlineInkRun[] = [...sidecar.unplacedInk];

  for (const run of sidecar.inkRuns) {
    if (run.blockId === editedBlock.id) continue; // replaced by newRuns below
    const newId = mapId(run.blockId);
    if (newId) placed.push({ ...run, blockId: newId });
    else unplaced.push(run);
  }

  // Replace the edited block's runs with the editor's complete set.
  for (const run of newRuns) {
    if (newEditedId) placed.push({ ...run, blockId: newEditedId });
    else unplaced.push(run);
  }

  const blockAnchors: BlockAnchor[] = newBlocks.map((b) => ({
    blockId: b.id,
    blockType: b.type,
    contentHash: contentHash(b.text),
  }));

  const nextSidecar: Sidecar = {
    ...sidecar,
    updatedAt: Date.now(),
    blockAnchors,
    inkRuns: placed,
    textBoxes: [
      ...(sidecar.textBoxes ?? []).filter((b) => input.textBoxes === undefined || b.blockId !== editedBlock.id),
      ...(input.textBoxes ?? []),
    ].map((b) => ({ ...b, blockId: mapId(b.blockId) ?? b.blockId })),
    pageObjects: [
      ...(sidecar.pageObjects ?? []).filter(o => input.pageObjects === undefined || o.blockId !== editedBlock.id),
      ...(input.pageObjects ?? []),
    ].map(o => ({ ...o, ...(o.blockId ? {blockId:mapId(o.blockId) ?? o.blockId} : {}) })),
    unplacedInk: unplaced,
  };

  return { source: newSource, blocks: newBlocks, sidecar: nextSidecar };
}
