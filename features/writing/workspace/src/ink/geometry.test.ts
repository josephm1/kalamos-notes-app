import { describe, expect, it } from "vitest";
import type { InkPoint } from "./types";
import {
  appendFiltered,
  outlinePathD,
  pointWidths,
  strokeHitsPoint,
  strokeOutline,
} from "./geometry";

function pt(x: number, y: number, pressure = 0.5, t = 0): InkPoint {
  return { x, y, t, pressure };
}

describe("appendFiltered", () => {
  it("keeps points that move past the threshold", () => {
    const pts = [pt(0, 0)];
    expect(appendFiltered(pts, pt(5, 0), 1)).toBe(true);
    expect(pts).toHaveLength(2);
  });

  it("drops sub-threshold jitter but blends its pressure", () => {
    const pts = [pt(0, 0, 0.4)];
    expect(appendFiltered(pts, pt(0.2, 0.2, 0.8), 1)).toBe(false);
    expect(pts).toHaveLength(1);
    expect(pts[0].pressure).toBeCloseTo(0.6);
  });
});

describe("pointWidths", () => {
  it("maps higher pressure to wider lines", () => {
    const pts = [pt(0, 0, 0.2, 0), pt(10, 0, 0.2, 10), pt(20, 0, 0.9, 20), pt(30, 0, 0.9, 30)];
    const w = pointWidths(pts, 4);
    expect(w[3]).toBeGreaterThan(w[0]);
  });

  it("falls back to velocity when pressure is flat: slower is wider", () => {
    // Same constant pressure; first segment slow, last segment fast.
    const pts = [
      pt(0, 0, 0.5, 0),
      pt(2, 0, 0.5, 40), // slow
      pt(4, 0, 0.5, 80), // slow
      pt(40, 0, 0.5, 90), // fast
      pt(80, 0, 0.5, 100), // fast
    ];
    const w = pointWidths(pts, 4);
    expect(w[2]).toBeGreaterThan(w[4]);
  });
});

describe("strokeOutline", () => {
  it("builds a closed fillable polygon around the centerline", () => {
    const pts = [pt(0, 0), pt(20, 0), pt(40, 5), pt(60, 5)];
    const outline = strokeOutline(pts, 4);
    expect(outline.length).toBeGreaterThan(pts.length * 2);
    // Every outline point stays within base-width reach of the centerline band.
    for (const o of outline) {
      expect(o.y).toBeGreaterThan(-6);
      expect(o.y).toBeLessThan(11);
    }
    const d = outlinePathD(outline);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
  });

  it("renders a single point as a dot outline", () => {
    const outline = strokeOutline([pt(10, 10, 0.5)], 4);
    expect(outline.length).toBeGreaterThanOrEqual(8);
    for (const o of outline) {
      expect(Math.hypot(o.x - 10, o.y - 10)).toBeLessThanOrEqual(4);
    }
  });
});

describe("strokeHitsPoint", () => {
  it("hits the gap between two distant samples (segment test)", () => {
    const pts = [pt(0, 0), pt(100, 0)];
    expect(strokeHitsPoint(pts, 50, 3, 5)).toBe(true);
  });

  it("misses points far from the polyline", () => {
    const pts = [pt(0, 0), pt(100, 0)];
    expect(strokeHitsPoint(pts, 50, 40, 5)).toBe(false);
  });
});

it('explicit Pen and Marker keep their width when pressure or timestamps change',()=>{
  const points=[{x:10,y:10,t:0,pressure:.1},{x:100,y:10,t:10,pressure:1}];
  const different=points.map((p,i)=>({...p,t:i*100,pressure:.5}));
  expect(strokeOutline(points,4,'pen')).toEqual(strokeOutline(different,4,'pen'));
  expect(strokeOutline(points,8,'marker')).toEqual(strokeOutline(different,8,'marker'));
  expect(strokeOutline(points,4,'brush')).not.toEqual(strokeOutline(different,4,'brush'));
});
