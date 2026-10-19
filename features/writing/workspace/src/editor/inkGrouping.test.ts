import { describe, expect, it } from "vitest";
import { boundsOfPoints, type InkStroke } from "../ink/types";
import { clusterInkStrokesByWord, inkStrokeAttachmentDistance, inkStrokeStartsInBody } from "./inkGrouping";

function stroke(id: string, coords: number[][], start = 0): InkStroke {
  const points = coords.map(([x, y], i) => ({ x, y, pressure: 0.5, t: start + i * 10 }));
  return { id, points, bounds: boundsOfPoints(points), tool: "pen", width: 2, color: "#000" };
}
const ids = (groups: InkStroke[][]) => groups.map((group) => group.map(({ id }) => id));

describe("word recovery by body lane", () => {
  it("separates hopefully and better when y descends through the next word", () => {
    const hopefully = stroke("hopefully", [[40, 18], [60, 38], [80, 22], [105, 40], [111, 88], [100, 90]]);
    const better = stroke("better", [[40, 62], [60, 85], [80, 64], [115, 87]], 1000);
    expect(ids(clusterInkStrokesByWord([hopefully, better], 44))).toEqual([["hopefully"], ["better"]]);
  });

  it("keeps a separately drawn long p stem with the upper letter body", () => {
    const body = stroke("body", [[40, 14], [70, 40]]);
    const descender = stroke("descender", [[52, 28], [52, 94]], 200);
    const lower = stroke("lower", [[52, 70], [80, 85]], 1000);
    expect(ids(clusterInkStrokesByWord([body, descender, lower], 44)))
      .toEqual([["body", "descender"], ["lower"]]);
    expect(inkStrokeStartsInBody(descender, [body], 44, 44)).toBe(true);
    expect(inkStrokeStartsInBody(lower, [body, descender], 44, 44)).toBe(false);
  });

  it("preserves disconnected letters and splits whitespace on each row", () => {
    const a = stroke("a", [[40, 20], [48, 42]]);
    const b = stroke("b", [[52, 18], [61, 42]]);
    const c = stroke("c", [[100, 20], [110, 42]]);
    const d = stroke("d", [[40, 62], [51, 85]]);
    expect(ids(clusterInkStrokesByWord([a, b, c, d], 44))).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("attaches a delayed t cross and i dot to the lower stem rather than the upper row", () => {
    const upper = stroke("upper", [[48, 10], [61, 23]]);
    const t = stroke("t", [[50, 34], [50, 83]]);
    const i = stroke("i", [[59, 52], [59, 83]]);
    const cross = stroke("cross", [[43, 40], [55, 40]], 20000);
    const dot = stroke("dot", [[59, 43]], 30000);
    expect(ids(clusterInkStrokesByWord([upper, t, i, cross, dot], 44))).toEqual([["upper"], ["t", "i", "cross", "dot"]]);
  });

  it("uses screen coordinates when recovering run-local strokes", () => {
    const upper = stroke("upper", [[4, 4], [25, 24], [40, 76]]);
    const lower = stroke("lower", [[4, 48], [40, 74]]);
    expect(ids(clusterInkStrokesByWord([upper, lower], 44, 54))).toEqual([["upper"], ["lower"]]);
  });

  it("does not change stored vectors or stroke order within a word", () => {
    const right = stroke("right", [[30, 12], [40, 40]]);
    const left = stroke("left", [[20, 12], [27, 40]], 5000);
    const input = [right, left], before = JSON.stringify(input);
    expect(ids(clusterInkStrokesByWord(input, 44))).toEqual([["right", "left"]]);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("attached mark geometry", () => {
  it("measures dots, crossings and translated run-local vectors", () => {
    const stem = stroke("stem", [[4, 4], [4, 40]]);
    expect(inkStrokeAttachmentDistance(stroke("dot", [[104, 99]]), [stem], 100, 100)).toBe(5);
    expect(inkStrokeAttachmentDistance(stroke("bar", [[100, 110], [120, 110]]), [stem], 100, 100)).toBe(0);
    expect(inkStrokeAttachmentDistance(stroke("dot", [[104, 110]]), [stem], 100, 100)).toBe(0);
  });
});
