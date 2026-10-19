import { describe, expect, it } from "vitest";
import { thumbnailCrop } from "./penWorkspace";

const PAGE = { width: 600, height: 840 };
const ASPECT = 86 / 131;

describe("thumbnailCrop", () => {
  it("keeps the complete page for an empty note", () => {
    expect(thumbnailCrop(PAGE.width, PAGE.height, null, 44, ASPECT)).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 840,
    });
  });

  it("zooms a short top-heavy note to its occupied content with ruled context", () => {
    const content = { x: 120, y: 70, width: 180, height: 90 };
    const crop = thumbnailCrop(PAGE.width, PAGE.height, content, 44, ASPECT);
    expect(crop.width).toBeLessThan(PAGE.width);
    expect(crop.height).toBeLessThan(PAGE.height);
    expect(crop.x).toBeLessThanOrEqual(content.x);
    expect(crop.y).toBeLessThanOrEqual(content.y);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(content.x + content.width);
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(content.y + content.height);
  });

  it("clamps a bottom note inside the page without cutting its content", () => {
    const content = { x: 360, y: 730, width: 180, height: 70 };
    const crop = thumbnailCrop(PAGE.width, PAGE.height, content, 44, ASPECT);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(PAGE.width);
    expect(crop.y + crop.height).toBeLessThanOrEqual(PAGE.height);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(content.x + content.width);
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(content.y + content.height);
  });
});
