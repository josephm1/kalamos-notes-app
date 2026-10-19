import { describe, it, expect } from "vitest";
import {
  planPreviousLine,
  reflow,
  type DirectionalFlowItem,
  type FlowBox,
} from "./placement";

const word = (text: string, width: number): FlowBox => ({ kind: "word", text, width });
const ink = (runId: string, width: number): FlowBox => ({ kind: "ink", runId, width });
const gap = (gapId: string, width: number): FlowBox => ({ kind: "gap", gapId, width });
const advance = (advanceId: string, width: number): FlowBox => ({ kind: "advance", advanceId, width });

describe("reflow", () => {
  it("keeps whole words that fit on one line", () => {
    const boxes = [word("aa", 20), word("bb", 20), word("cc", 20)];
    const { placed, lineCount } = reflow(boxes, 100, 4);
    expect(lineCount).toBe(1);
    expect(placed.every((p) => p.line === 0)).toBe(true);
  });

  it("wraps overflow to the next line without splitting words", () => {
    const boxes = [word("aaaa", 40), word("bbbb", 40), word("cccc", 40)];
    const { placed, lineCount } = reflow(boxes, 90, 4);
    expect(lineCount).toBe(2);
    expect(placed[2].line).toBe(1);
  });

  it("treats an ink run as one atomic box", () => {
    const boxes = [word("aa", 40), ink("r1", 60)];
    const { placed, lineCount } = reflow(boxes, 80, 4);
    expect(lineCount).toBe(2);
    expect(placed[1].kind).toBe("ink");
    expect(placed[1].line).toBe(1);
  });

  it("uses handwriting-sized spacing between consecutive ink words", () => {
    const { placed } = reflow([ink("one", 40), ink("two", 30)], 200, 5, 0, 18);
    expect(placed[0]).toMatchObject({ x: 0 });
    expect(placed[1]).toMatchObject({ x: 58 });
  });

  it("applies an indent (insertion space) to the first line only", () => {
    const boxes = [word("aa", 20)];
    const { placed } = reflow(boxes, 100, 4, 30);
    expect(placed[0].x).toBe(30);
  });

  it("uses a gap's exact width without adding hidden spaces around it", () => {
    const boxes = [word("a", 10), gap("g1", 20), word("b", 10)];
    const { placed } = reflow(boxes, 100, 5);
    expect(placed.map((p) => p.x)).toEqual([0, 10, 30]);
  });

  it("keeps words, ink, and gaps in their original reading order", () => {
    const boxes = [word("a", 10), ink("i1", 20), gap("g1", 15), word("b", 10)];
    const { placed } = reflow(boxes, 48, 4);
    expect(placed.map((p) => p.kind)).toEqual(["word", "ink", "gap", "word"]);
    expect(placed.map((p) => p.line)).toEqual([0, 0, 1, 1]);
  });

  it("preserves structural distance across multiple ruled lines", () => {
    const boxes = [word("a", 10), advance("a1", 215), ink("i1", 20)];
    const { placed } = reflow(boxes, 100, 5);
    expect(placed[2]).toMatchObject({ kind: "ink", line: 2, x: 25 });
  });

  it("moves preserved ink when explicit space is inserted before its advance", () => {
    const original = reflow([word("a", 10), advance("a1", 115), ink("i1", 20)], 100, 5);
    const shifted = reflow([word("a", 10), gap("g", 30), advance("a1", 115), ink("i1", 20)], 100, 5);
    expect(original.placed[2]).toMatchObject({ line: 1, x: 25 });
    expect(shifted.placed[3]).toMatchObject({ line: 1, x: 55 });
  });
});

describe("backward wrap", () => {
  const item = (order: number, line: number, x: number, width: number): DirectionalFlowItem => ({
    order,
    line,
    x,
    width,
  });

  it("compresses an occupied previous row only as much as needed", () => {
    const early = item(0, 0, 20, 30);
    const late = item(1, 0, 260, 40);
    const incoming = item(2, 1, 10, 40);
    const all = [early, late, incoming];
    const plan = planPreviousLine(
      [incoming], 0, 316,
      (line) => all.filter((entry) => entry.line === line),
      () => 16
    )!;

    expect(plan.find(({ item }) => item === early)?.x).toBe(20);
    expect(plan.find(({ item }) => item === late)?.x).toBe(220);
    expect(plan.find(({ item }) => item === incoming)?.x).toBe(276);
  });

  it("rejects an overfull previous row instead of disturbing another row", () => {
    const top = item(0, 0, 260, 40);
    const previous = item(1, 1, 20, 100);
    const later = item(2, 1, 170, 100);
    const incoming = item(3, 2, 10, 100);
    const all = [top, previous, later, incoming];
    const plan = planPreviousLine(
      [incoming], 1, 316,
      (line) => all.filter((entry) => entry.line === line),
      () => 16
    );

    expect(plan).toBeNull();
    expect([top, previous, later, incoming].map(({ line, x }) => ({ line, x }))).toEqual([
      { line: 0, x: 260 },
      { line: 1, x: 20 },
      { line: 1, x: 170 },
      { line: 2, x: 10 },
    ]);
  });
});
