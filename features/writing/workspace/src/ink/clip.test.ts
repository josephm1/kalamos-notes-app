import { describe, expect, it } from "vitest";
import { clipInkPath } from "./clip";

const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
describe("ink presentation clipping", () => {
  it("clips crossing segments at the page edge without changing source vectors", () => {
    const points = [{ x: 50, y: 80, pressure: .5 }, { x: 50, y: 140, pressure: .8 }];
    expect(clipInkPath(points, bounds)).toEqual([[points[0], { x: 50, y: 100, pressure: .5 }]]);
    expect(points[1].y).toBe(140);
  });
  it("splits both sides of foreground controls without bridging across the hidden area", () => {
    expect(clipInkPath([{ x: -10, y: 50 }, { x: 110, y: 50 }], bounds,
      [{ left: 40, top: 20, right: 60, bottom: 80 }])).toEqual([
      [{ x: 0, y: 50 }, { x: 40, y: 50 }], [{ x: 60, y: 50 }, { x: 100, y: 50 }],
    ]);
  });
  it("keeps dots inside the visible page and drops hidden dots and off-screen paths", () => {
    expect(clipInkPath([{ x: 3, y: 4 }], bounds)).toHaveLength(1);
    expect(clipInkPath([{ x: 3, y: 104 }], bounds)).toEqual([]);
    expect(clipInkPath([{ x: 3, y: 4 }], bounds, [bounds])).toEqual([]);
    expect(clipInkPath([{ x: 10, y: 110 }, { x: 20, y: 120 }], bounds)).toEqual([]);
  });
});
