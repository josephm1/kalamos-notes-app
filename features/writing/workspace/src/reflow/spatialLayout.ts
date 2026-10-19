/** Geometry only. Every preview is evaluated against the same immutable snapshot. */
export type SpatialAtom = {
  id: string;
  kind: 'word' | 'ink' | 'control';
  x: number;
  y: number;
  width: number;
  height: number;
  line: number;
  breakBefore?: number;
  /** Explicit semantic attachment; never inferred from proximity. */
  ownerId?: string;
};
export type SpatialMetrics = { width: number; lineHeight: number; textGap: number; inkGap: number };
export type SpatialPosition = { x: number; y: number; line: number };
export type SpatialPlan = { positions: Map<string, SpatialPosition>; amount: number };
const EPSILON = 0.001;
const SHORT_LINE_FRACTION = 0.65;
const content = (atoms: readonly SpatialAtom[]) => atoms.filter(atom => atom.kind !== 'control');
const ordered = (atoms: readonly SpatialAtom[]) => [...atoms].sort((a, b) => a.line - b.line || a.x - b.x || a.id.localeCompare(b.id));
const safeGap = (a: SpatialAtom, b: SpatialAtom, metrics: SpatialMetrics) =>
  a.kind === 'ink' || b.kind === 'ink' ? metrics.inkGap : metrics.textGap;
function clearance(a: SpatialAtom, b: SpatialAtom, metrics: SpatialMetrics): number {
  const gap = b.x - a.x - a.width;
  // Existing compact text must not jump apart on the first one-pixel drag.
  return a.line === b.line && gap >= 0 ? Math.min(gap, safeGap(a, b, metrics)) : safeGap(a, b, metrics);
}
function plan(atoms: readonly SpatialAtom[]): SpatialPlan {
  return { positions: new Map(atoms.map(atom => [atom.id, { x: atom.x, y: atom.y, line: atom.line }])), amount: 0 };
}
function place(result: SpatialPlan, atom: SpatialAtom, line: number, x: number, metrics: SpatialMetrics) {
  result.positions.set(atom.id, { x, y: atom.y + (line - atom.line) * metrics.lineHeight, line });
}
function attachControls(atoms: readonly SpatialAtom[], result: SpatialPlan): SpatialPlan {
  const byId = new Map(atoms.map(atom => [atom.id, atom]));
  for (const atom of atoms) {
    if (atom.kind !== 'control' || !atom.ownerId) continue;
    const owner = byId.get(atom.ownerId);
    const position = result.positions.get(atom.ownerId);
    if (owner && position) result.positions.set(atom.id, {
      x: atom.x, y: atom.y + position.y - owner.y, line: atom.line + position.line - owner.line,
    });
  }
  return result;
}

/** A hit anywhere inside a word targets that whole word, including its right half. */
export function horizontalAnchor(atoms: readonly SpatialAtom[], line: number, x: number): number {
  const hit = content(atoms).find(atom => atom.line === line && x >= atom.x && x < atom.x + atom.width);
  return hit ? hit.x : x;
}

export function horizontalSpace(atoms: readonly SpatialAtom[], line: number, x: number, delta: number, metrics: SpatialMetrics): SpatialPlan {
  const result = plan(atoms);
  if (Math.abs(delta) < EPSILON) return result;
  const all = ordered(content(atoms));
  const row = all.filter(atom => atom.line === line);
  const anchor = horizontalAnchor(atoms, line, x);
  if (!row.length) return result;
  // A gap is a boundary: subtraction acts on its left, addition on its right.
  // A word hit snaps the visible caret to its leading edge; that edge owns both signs.
  if (delta < 0) {
    const index = row.reduce((found, atom, i) => atom.x < anchor - EPSILON ? i : found, -1);
    return index < 0 ? result : backwardSpace(atoms, all, row, index, line, delta, metrics);
  }
  const following = row.findIndex(atom => atom.x + atom.width > anchor + EPSILON);
  // Keep the existing end-of-row addition target on the last content word;
  // a control farther right must never become the target.
  const index = following < 0 ? row.length - 1 : following;
  const seed = row[index], previous = row[index - 1];
  const shift = delta;
  result.amount = shift;
  // Positive motion propagates only when clearance is exhausted. An iterative
  // carry queue handles long paragraphs without recursive layout calls.
  let queue = row.slice(index), currentLine = line, prior: SpatialAtom | undefined = previous;
  const queued = new Set(queue.map(atom => atom.id));
  let carried = false;
  for (let i = 0; i < queue.length; i++) {
    const atom = queue[i];
    const priorPosition = prior ? result.positions.get(prior.id)! : undefined;
    const minimum = prior && priorPosition ? priorPosition.x + prior.width + clearance(prior, atom, metrics) : 0;
    const position = result.positions.get(atom.id)!;
    const desired = atom.id === seed.id && !carried ? atom.x + shift : position.line === currentLine ? position.x : 0;
    const target = Math.max(desired, minimum);
    if (target > 0 && target + atom.width > metrics.width) {
      currentLine++;
      const remaining = queue.slice(i);
      let existing = all.filter(other => result.positions.get(other.id)!.line === currentLine && !queued.has(other.id));
      if (existing[0]?.breakBefore) {
        // Overflow reserves a new row before an explicit paragraph/list boundary.
        // Move that structured suffix vertically instead of merging its words.
        for (const other of atoms) {
          const p = result.positions.get(other.id)!;
          if (!queued.has(other.id) && !other.ownerId && p.line >= currentLine)
            place(result, other, p.line + 1, p.x, metrics);
        }
        existing = [];
      }
      existing.forEach(other => queued.add(other.id));
      queue = [...remaining, ...existing];
      prior = undefined; carried = true; i = -1;
      continue;
    }
    place(result, atom, currentLine, target, metrics);
    prior = atom;
  }
  return attachControls(atoms, result);
}

/** Mirror forward pressure within the seed's paragraph. Words to the right of the caret
 * stay fixed; earlier words move only after their available clearance is exhausted. */
function backwardSpace(atoms: readonly SpatialAtom[], all: SpatialAtom[], row: SpatialAtom[], index: number,
  line: number, delta: number, metrics: SpatialMetrics): SpatialPlan {
  const seedIndex = all.findIndex(atom => atom.id === row[index].id);
  let start = seedIndex;
  while (start > 0 && !all[start].breakBefore) start--;
  const prefix = all.slice(start, all.findIndex(atom => atom.id === row[index].id) + 1);
  const firstLine = all[start].breakBefore ? all[start].line : 0;
  const mirrored = prefix.map(atom => ({...atom, x:metrics.width - atom.x - atom.width,
    line:line - atom.line, y:(line - atom.line) * metrics.lineHeight,
    breakBefore:undefined}));
  const contact = metrics.width - row[index].x - row[index].width;
  const attempt = (amount: number) => horizontalSpace(mirrored, 0, contact, amount, metrics);
  const fits = (candidate: SpatialPlan) => [...candidate.positions.values()].every(p => p.line <= line - firstLine);
  let amount = -delta, candidate = attempt(amount);
  if (!fits(candidate)) {
    let low = 0, high = amount;
    for (let n=0; n<32; n++) {
      const mid = (low + high) / 2;
      if (fits(attempt(mid))) low = mid; else high = mid;
    }
    amount = low; candidate = attempt(amount);
  }
  const result = plan(atoms);
  result.amount = amount < EPSILON ? 0 : -amount;
  if (!result.amount) return result;
  const baselines = new Map(mirrored.map(atom => [atom.id, atom]));
  for (const atom of prefix) {
    const p = candidate.positions.get(atom.id)!;
    const baseline = baselines.get(atom.id)!;
    if (p.line === baseline.line && Math.abs(p.x - baseline.x) < EPSILON) continue;
    const target = Math.max(0, atom.x + baseline.x - p.x);
    place(result, atom, line - p.line, target < EPSILON ? 0 : target, metrics);
  }
  return attachControls(atoms, result);
}

export function verticalSpace(atoms: readonly SpatialAtom[], boundary: number, rows: number, metrics: SpatialMetrics): SpatialPlan {
  const words = atoms.filter(atom => atom.kind !== 'control' || !atom.ownerId);
  const moving = words.filter(atom => atom.line >= boundary), result = plan(atoms);
  if (!moving.length || rows === 0) return result;
  const requested = Math.round(rows);
  if (requested >= 0) {
    result.amount = requested;
    for (const atom of moving) place(result, atom, atom.line + requested, atom.x, metrics);
    return attachControls(atoms, result);
  }
  const preceding = [...new Set(words.filter(atom => atom.line < boundary).map(atom => atom.line))].sort((a,b)=>b-a);
  const attempt = (amount: number): SpatialPlan | null => {
    const candidate = plan(atoms), lower = [...moving];
    for (const atom of moving) place(candidate, atom, atom.line - amount, atom.x, metrics);
    for (const line of preceding) {
      const row = words.filter(atom => atom.line === line);
      const nextLine = Math.min(...lower.map(atom => candidate.positions.get(atom.id)!.line));
      let shift = Math.min(0, nextLine - 1 - line);
      for (const upper of row) for (const next of lower) {
        if (upper.x < next.x + next.width && next.x < upper.x + upper.width) {
          const p = candidate.positions.get(next.id)!;
          shift = Math.min(shift, Math.floor((p.y - upper.y - upper.height + EPSILON) / metrics.lineHeight));
        }
      }
      if (line + shift < 0) return null;
      for (const atom of row) place(candidate, atom, line + shift, atom.x, metrics);
      lower.push(...row);
    }
    if (moving.some(atom => candidate.positions.get(atom.id)!.line < 0)) return null;
    candidate.amount = amount ? -amount : 0;
    return attachControls(atoms, candidate);
  };
  let low = 0, high = Math.min(-requested, Math.min(...moving.map(atom => atom.line)));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (attempt(mid)) low = mid; else high = mid - 1;
  }
  return low ? attempt(low) ?? result : result;
}

/** Close whitespace while preserving explicit breaks, short rows and relative indentation. */
export function condenseSpace(atoms: readonly SpatialAtom[], metrics: SpatialMetrics): SpatialPlan {
  const result = plan(atoms), words = ordered(content(atoms));
  if (!words.length) return result;
  const rowEnds = new Map<number, number>(), rowStarts = new Map<number, number>();
  for (const atom of words) {
    rowEnds.set(atom.line, Math.max(rowEnds.get(atom.line) ?? 0, atom.x + atom.width));
    rowStarts.set(atom.line, Math.min(rowStarts.get(atom.line) ?? Infinity, atom.x));
  }
  const left = Math.min(...rowStarts.values());
  let line = 0, cursor = 0, prior: SpatialAtom | undefined;
  for (const atom of words) {
    const nextRow = prior !== undefined && atom.line !== prior.line;
    const deliberate = nextRow && (rowEnds.get(prior!.line)! < metrics.width * SHORT_LINE_FRACTION || atom.line - prior!.line > 1);
    const newLine = prior && ((atom.breakBefore ?? 0) > 0 || deliberate);
    if (newLine) { line += Math.max(1, atom.breakBefore ?? 0); cursor = Math.max(0, rowStarts.get(atom.line)! - left); prior = undefined; }
    const gap = prior ? safeGap(prior, atom, metrics) : 0;
    let x = cursor + gap;
    if (x > 0 && x + atom.width > metrics.width) { line++; x = 0; }
    place(result, atom, line, x, metrics);
    cursor = x + atom.width; prior = atom;
  }
  return attachControls(atoms, result);
}

export function constrainTranslation(bounds: { x: number; y: number; width: number }, dx: number, dy: number, metrics: SpatialMetrics) {
  return {
    dx: Math.max(-bounds.x, Math.min(Math.max(0, metrics.width - bounds.x - bounds.width), dx)),
    dy: Math.max(-Math.floor(bounds.y / metrics.lineHeight) * metrics.lineHeight, Math.round(dy / metrics.lineHeight) * metrics.lineHeight),
  };
}
