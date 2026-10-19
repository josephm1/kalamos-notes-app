import type { DirectionalFlowItem, DirectionalPlacement } from './placement';

/** Insert whole typed words at a visual caret. Existing whitespace absorbs the insertion;
 * only a colliding suffix moves, and overflow precedes the next lane's existing content. */
export function insertTextFlow<T extends DirectionalFlowItem & { breakBefore?: number }>(
  incoming: T[], existing: T[], lineWidth: number, spacing: (a: T, b: T) => number, snap = true
): DirectionalPlacement<T>[] {
  if (!incoming.length) return [];
  const positions = new Map<T, { line: number; x: number }>();
  const at = (item: T) => positions.get(item) ?? item;
  const all = [...existing, ...incoming];
  const ordered = (items: T[]) => items.slice().sort((a, b) => at(a).x - at(b).x || a.order - b.order);
  const first = incoming[0];
  let anchor = first.x;
  const hit = existing.find(item => item.line === first.line && anchor > item.x && anchor < item.x + item.width);
  if (hit && snap) {
    const before = Math.max(0, hit.x - spacing(first, hit));
    const after = hit.x + hit.width + spacing(hit, first);
    const nearest = Math.abs(anchor - before) < Math.abs(anchor - after) ? before : after;
    // Only magnetise near a boundary. A drop deep inside a long word reserves its
    // requested position and displaces that whole word, rather than jumping sideways.
    if (Math.abs(nearest - anchor) <= 8) anchor = nearest;
  }
  const delta = anchor - first.x;
  for (const item of incoming) positions.set(item, { line: item.line, x: Math.max(0, item.x + delta) });
  const incomingSet = new Set(incoming);
  const processed = new Set<T>();
  // Iterative carry avoids recursion for a long imported paragraph on a narrow screen.
  const place = (sequence: T[], startLine: number, previous: T | null = null) => {
    let line = startLine, cursor = previous ? at(previous).x + previous.width : 0;
    let queue = sequence;
    for (let index = 0; index < queue.length; index++) {
      const item = queue[index];
      const minimum = previous ? cursor + spacing(previous, item) : 0;
      const desired = at(item).line === line ? at(item).x : 0;
      let x = Math.max(desired, minimum);
      if (!previous && incomingSet.has(item) && x + item.width > lineWidth) x = Math.max(0, lineWidth - item.width);
      if (x > 0 && x + item.width > lineWidth) {
        const carry = queue.slice(index);
        const carrySet = new Set(carry);
        line++;
        const downstream = ordered(all.filter(other => at(other).line === line && !carrySet.has(other) && !incomingSet.has(other)));
        const pendingRow = incoming.filter(other => other.line === line && !processed.has(other) && !carrySet.has(other));
        const nextIncoming = pendingRow[0]?.breakBefore ? [] : pendingRow;
        queue = [...carry.filter(other => incomingSet.has(other)), ...nextIncoming,
          ...carry.filter(other => !incomingSet.has(other)), ...downstream];
        // Typed continuations retain their insertion column; displaced existing words
        // start at the next lane's edge.
        carry.forEach(other => positions.set(other, { line, x: incomingSet.has(other) ? anchor : 0 }));
        cursor = 0; previous = null; index = -1;
        continue;
      }
      positions.set(item, { line, x });
      if (incomingSet.has(item)) processed.add(item);
      cursor = x + item.width; previous = item;
    }
  };
  for (const line of [...new Set(incoming.map(item => item.line))].sort((a, b) => a - b)) {
    const words = ordered(incoming.filter(item => item.line === line && !processed.has(item)));
    if (!words.length) continue;
    const prior = incoming.slice(0, incoming.indexOf(words[0])).filter(item => processed.has(item)).pop();
    const targetLine = prior
      ? Math.max(line, at(prior).line + Math.max(words[0].breakBefore ?? 0, line - prior.line)) : line;
    words.forEach(item => positions.set(item, { ...at(item), line: targetLine }));
    const x = at(words[0]).x;
    const row = ordered(all.filter(item => at(item).line === targetLine && (!incomingSet.has(item) || processed.has(item))));
    const prefix = row.filter(item => at(item).x + item.width <= x);
    const suffix = row.filter(item => !prefix.includes(item));
    place([...words, ...suffix], targetLine, prefix[prefix.length - 1] ?? null);
  }
  return [...positions].map(([item, position]) => ({ item, ...position }));
}
