// After every source-range edit we reparse and remap block identity so ink
// stays anchored to the right block. Preference order (BUILD_PLAN.md §6):
//   1. an existing explicit stable id in the session;
//   2. block type + content hash + nearby neighbours;
//   3. the closest source position.

import type { Block } from "./parse";
import { contentHash } from "../documents/fingerprint";

export type IdentityMap = {
  /** oldBlockId -> newBlockId */
  mapping: Record<string, string>;
  /** old block ids that could not be confidently remapped. */
  ambiguous: string[];
};

export function remapBlocks(oldBlocks: Block[], newBlocks: Block[]): IdentityMap {
  const mapping: Record<string, string> = {};
  const ambiguous: string[] = [];
  const usedNew = new Set<string>();

  const newByHash = new Map<string, Block[]>();
  for (const nb of newBlocks) {
    const key = hashKey(nb);
    const arr = newByHash.get(key);
    if (arr) arr.push(nb);
    else newByHash.set(key, [nb]);
  }

  for (const ob of oldBlocks) {
    // Preference 2: exact type+content hash match, uniquely.
    const candidates = (newByHash.get(hashKey(ob)) ?? []).filter(
      (b) => !usedNew.has(b.id)
    );
    if (candidates.length === 1) {
      mapping[ob.id] = candidates[0].id;
      usedNew.add(candidates[0].id);
      continue;
    }
    if (candidates.length > 1) {
      // Disambiguate by closest source position.
      const best = closestByPosition(ob, candidates);
      mapping[ob.id] = best.id;
      usedNew.add(best.id);
      continue;
    }

    // Preference 3: closest same-type block by source position.
    const sameType = newBlocks.filter(
      (b) => b.type === ob.type && !usedNew.has(b.id)
    );
    if (sameType.length > 0) {
      const best = closestByPosition(ob, sameType);
      // Only accept as non-ambiguous if reasonably close in the document.
      mapping[ob.id] = best.id;
      usedNew.add(best.id);
      ambiguous.push(ob.id); // flagged: matched only by position
      continue;
    }

    ambiguous.push(ob.id);
  }

  return { mapping, ambiguous };
}

function hashKey(b: Block): string {
  return `${b.type}:${contentHash(b.text)}`;
}

function closestByPosition(target: Block, candidates: Block[]): Block {
  let best = candidates[0];
  let bestDist = Math.abs(best.sourceStart - target.sourceStart);
  for (const c of candidates.slice(1)) {
    const d = Math.abs(c.sourceStart - target.sourceStart);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
