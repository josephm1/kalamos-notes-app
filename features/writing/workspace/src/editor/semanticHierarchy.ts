export type HierarchicalElement = { id: string; parentId?: string };

/** Relationships are document data; depth/indentation is a derived presentation. */
export function semanticDepths(blocks: HierarchicalElement[]): Map<string, number> {
  const byId = new Map(blocks.map(block => [block.id, block]));
  if (byId.size !== blocks.length) throw Error('Duplicate semantic identity.');
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) throw Error('Cyclic element group.');
    const block = byId.get(id);
    if (!block) throw Error('Element group is unavailable.');
    visiting.add(id);
    const value = block.parentId ? depth(block.parentId) + 1 : 0;
    if (value > 4) throw Error('Element groups are too deeply nested.');
    visiting.delete(id); depths.set(id, value); return value;
  };
  blocks.forEach(block => depth(block.id));
  return depths;
}

/** Keep sibling order while emitting each parent's children together. */
export function semanticOrder<T extends HierarchicalElement>(blocks: T[]): T[] {
  semanticDepths(blocks);
  const children = new Map<string | undefined, T[]>();
  for (const block of blocks) {
    const siblings = children.get(block.parentId) ?? [];
    siblings.push(block); children.set(block.parentId, siblings);
  }
  const result: T[] = [];
  const visit = (parentId?: string) => {
    for (const block of children.get(parentId) ?? []) { result.push(block); visit(block.id); }
  };
  visit(); return result;
}
