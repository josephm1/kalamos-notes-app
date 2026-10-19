// Mixed-content reflow: place typed word boxes and inline ink-run boxes into
// one ordered flow across ruled lines. Pure + testable. See BUILD_PLAN.md §9
// "Reflow engine". Each ink run is one atomic word-like box; never split a run
// or a grapheme cluster across lines in v1.

export type FlowBox =
  | { kind: "word"; text: string; width: number; key?: string; textBoxId?: string; textWordIndex?: number; breakBefore?: number }
  | { kind: "ink"; runId: string; width: number; key?: string }
  | { kind: "gap"; gapId: string; width: number; key?: string }
  | { kind: "advance"; advanceId: string; width: number; key?: string };

export type PlacedBox = FlowBox & {
  line: number;
  x: number;
};

export type ReflowResult = {
  placed: PlacedBox[];
  lineCount: number;
};

export type DirectionalFlowItem = {
  line: number;
  x: number;
  width: number;
  order: number;
};

export type DirectionalPlacement<T> = { item: T; line: number; x: number };

/**
 * Plan one backward line crossing without mutating the live layout. Incoming
 * items take the right edge and existing words move left only as needed.
 * Returning null keeps both rows independent when the complete sequence does
 * not fit; one caret must never recursively disturb unrelated earlier rows.
 */
export function planPreviousLine<T extends DirectionalFlowItem>(
  incoming: T[],
  targetLine: number,
  lineWidth: number,
  itemsAtLine: (line: number) => T[],
  spacing: (left: T, right: T) => number
): DirectionalPlacement<T>[] | null {
  if (targetLine < 0) return null;

  const incomingSet = new Set(incoming);
  const existing = itemsAtLine(targetLine)
    .filter((item) => !incomingSet.has(item))
    .sort((a, b) => a.x - b.x || a.order - b.order);
  const sequence = [...existing, ...incoming];
  const placements: DirectionalPlacement<T>[] = [];
  let cursor = lineWidth;

  for (let index = sequence.length - 1; index >= 0; index--) {
    const item = sequence[index];
    const latestX = cursor - item.width;
    if (latestX < 0) return null;
    const x = incomingSet.has(item) ? latestX : Math.min(item.x, latestX);
    if (x < 0) return null;
    placements.push({ item, line: targetLine, x });
    cursor = x - (index > 0 ? spacing(sequence[index - 1], item) : 0);
  }
  return placements;
}

/**
 * Greedy line-breaking: keep the largest whole-word prefix that fits, move
 * overflow to the next line, repeat. `spaceWidth` is inserted between boxes on
 * the same line. `indent` (e.g. insertion space) offsets the first line.
 */
export function reflow(
  boxes: FlowBox[],
  lineWidth: number,
  spaceWidth: number,
  indent = 0,
  inkSpaceWidth = spaceWidth
): ReflowResult {
  const placed: PlacedBox[] = [];
  let line = 0;
  let x = indent;
  let previous: FlowBox | null = null;

  for (const box of boxes) {
    if (box.kind === "word" && box.breakBefore) { line += box.breakBefore; x = 0; previous = null; }
    // A structural advance preserves the original linear ruled-page distance
    // before a free ink run is admitted to reflow. Unlike an ordinary box it
    // may span several whole lines. Later inserted gaps still add before it,
    // so downstream content moves while its original line spacing survives.
    if (box.kind === "advance") {
      placed.push({ ...box, line, x });
      const total = x + Math.max(0, box.width);
      line += Math.floor(total / lineWidth);
      x = total % lineWidth;
      previous = box;
      continue;
    }

    // A gap is already an explicit amount of whitespace. Adding the ordinary
    // inter-word space on either side made its visual size larger than the
    // gesture and was a major source of cumulative horizontal drift.
    const needsSpace =
      x > (line === 0 ? indent : 0) &&
      previous?.kind !== "gap" &&
      previous?.kind !== "advance" &&
      box.kind !== "gap";
    const naturalSpace =
      previous?.kind === "ink" && box.kind === "ink"
        ? Math.max(spaceWidth, inkSpaceWidth)
        : spaceWidth;
    const advance = (needsSpace ? naturalSpace : 0) + box.width;

    if (x + advance > lineWidth && x > (line === 0 ? indent : 0)) {
      // Wrap: move this box to the next line.
      line += 1;
      x = 0;
      placed.push({ ...box, line, x });
      x += box.width;
    } else {
      const startX = needsSpace ? x + naturalSpace : x;
      placed.push({ ...box, line, x: startX });
      x = startX + box.width;
    }
    previous = box;
  }

  return { placed, lineCount: line + 1 };
}

/** Tokenize text into word boxes using a measuring function. */
export function tokenize(
  text: string,
  measure: (word: string) => number
): FlowBox[] {
  const words = text.split(/(\s+)/).filter((w) => w.trim().length > 0);
  return words.map((text) => ({ kind: "word", text, width: measure(text) }));
}
