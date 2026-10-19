import { describe, it, expect } from "vitest";
import {
  createEmptySidecar,
  validateSidecar,
  serializeSidecar,
  SIDECAR_SCHEMA_VERSION,
} from "./schema";

describe("sidecar schema", () => {
  it("round-trips an empty sidecar", () => {
    const sc = createEmptySidecar("a.md", "hash-1");
    const parsed = JSON.parse(serializeSidecar(sc));
    const res = validateSidecar(parsed);
    expect(res.ok).toBe(true);
  });

  it("rejects non-sidecar objects", () => {
    expect(validateSidecar({ hello: "world" }).ok).toBe(false);
    expect(validateSidecar(null).ok).toBe(false);
  });

  it("rejects a newer schema version", () => {
    const sc = createEmptySidecar("a.md", "h");
    const res = validateSidecar({ ...sc, schemaVersion: SIDECAR_SCHEMA_VERSION + 5 });
    expect(res.ok).toBe(false);
  });

  it("migrates a v0 sidecar lacking unplacedInk", () => {
    const sc = createEmptySidecar("a.md", "h") as Record<string, unknown>;
    delete sc.unplacedInk;
    sc.schemaVersion = 0;
    const res = validateSidecar(sc);
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.isArray(res.sidecar.unplacedInk)).toBe(true);
  });
});

it("discards malformed saved source placements as a whole", () => {
 const sc = createEmptySidecar("a.md", "h");
 const valid = validateSidecar({...sc, sourceWords:[{text:"hello",x:12,y:44}]});
 expect(valid.ok && valid.sidecar.sourceWords).toEqual([{text:"hello",x:12,y:44}]);
 const invalid = validateSidecar({...sc, sourceWords:[{text:"hello",x:-1,y:44}]});
 expect(invalid.ok && invalid.sidecar.sourceWords).toBeUndefined();
});

it('loads older coordinates and styles while retiring unused transient spacing dictionaries', () => {
  const box = { id: 'typed', blockId: 'b0', text: 'Hello X', x: 20, y: 88, width: 200, size: 19,
    words: [{ text: 'Hello', x: 20, y: 88 }, { text: 'X', x: 180, y: 88 }],
    styles: [{ start: 0, end: 5, bold: true }], gapBasis: { old: -40 }, lineBasis: { old: 2 } };
  const result = validateSidecar({ ...createEmptySidecar('note', 'hash'), textBoxes: [box] });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.sidecar.textBoxes![0].words).toEqual(box.words);
  expect(result.sidecar.textBoxes![0].styles).toEqual(box.styles);
  expect(result.sidecar.textBoxes![0]).not.toHaveProperty('gapBasis');
  expect(result.sidecar.textBoxes![0]).not.toHaveProperty('lineBasis');
  expect(box.gapBasis).toEqual({ old: -40 });
});
