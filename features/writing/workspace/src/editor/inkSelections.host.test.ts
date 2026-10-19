import { describe, expect, it } from 'vitest';
import { buildLineSelections, buildRegionSelections } from '../../tools/ink-selection-experiment';
import { createEmptySidecar } from '../sidecar/schema';

function fixture() {
  const sidecar = createEmptySidecar('Selection fixture', 'hash');
  sidecar.layoutLineHeight = 44;
  sidecar.inkRuns = ['one', 'two'].map((id, index) => ({
    id, blockId: 'planning-document', anchorOffset: 0, contextBefore: '', contextAfter: '',
    intrinsicWidth: 48, intrinsicHeight: 32, baselineOffset: 36, layoutX: 16 + index * 100,
    layoutY: 52, scale: 1, createdAt: 1, updatedAt: 1, strokes: [],
  }));
  const inkRegions = sidecar.inkRuns.map(run => ({ id: 'region-' + run.id,
    pageId: 'first', runId: run.id, strokeIds: [run.id + '-stroke'],
    bounds: { x: run.layoutX!, y: 52, width: 48, height: 32 } }));
  return { documentId: 'document', revisionId: 'revision',
    pages: [{ id: 'first', sidecar }], inkRegions };
}
describe('host line-selection prototype', () => {
  it('retains fine-grained choices with short labels when part of a line is uncertain', () => {
    const result = buildRegionSelections(fixture());
    expect(result.selections.map(selection => [selection.id, selection.sourceInkRegionIds]))
      .toEqual([['S1', ['region-one']], ['S2', ['region-two']]]);
    expect(result.selections.map(selection => selection.baseline)).toEqual([88, 88]);
  });
  it('binds all same-baseline regions including a split word to one short selection', () => {
    const snapshot = fixture();
    const before = JSON.stringify(snapshot);
    const result = buildLineSelections(snapshot);
    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]).toMatchObject({ id: 'L1', pageId: 'first', baseline: 88,
      sourceInkRegionIds: ['region-one', 'region-two'] });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('uses authoritative baselines when tall strokes overlap another line visually', () => {
    const snapshot = fixture();
    snapshot.pages[0].sidecar.inkRuns[1].baselineOffset += 44;
    const result = buildLineSelections(snapshot);
    expect(result.selections.map(line => line.sourceInkRegionIds)).toEqual([['region-one'], ['region-two']]);
  });
  it('keeps page scopes distinct and rejects duplicate, unsettled or unknown provenance', () => {
    const snapshot = fixture();
    expect(() => buildLineSelections({ ...snapshot, inkRegions: [...snapshot.inkRegions, snapshot.inkRegions[0]] })).toThrow('Duplicate');
    expect(() => buildLineSelections({ ...snapshot, inkRegions: [{ ...snapshot.inkRegions[0], pageId: 'missing' }] })).toThrow('outside');
    snapshot.pages[0].sidecar.inkRuns[0].layoutY = undefined;
    expect(() => buildLineSelections(snapshot)).toThrow('settled');
  });
  it('assigns distinct labels across pages and refuses scaled or off-grid runs', () => {
    const snapshot = fixture();
    snapshot.pages.push({ id: 'second', sidecar: structuredClone(snapshot.pages[0].sidecar) });
    snapshot.inkRegions.push(...snapshot.inkRegions.map(region => ({ ...region,
      id: 'other-' + region.id, pageId: 'second' })));
    expect(buildLineSelections(snapshot).selections.map(line => [line.id, line.pageId]))
      .toEqual([['L1', 'first'], ['L2', 'second']]);
    snapshot.pages[0].sidecar.inkRuns[0].scale = 2;
    expect(() => buildLineSelections(snapshot)).toThrow('unscaled');
    snapshot.pages[0].sidecar.inkRuns[0].scale = 1;
    snapshot.pages[0].sidecar.inkRuns[0].baselineOffset += 10;
    expect(() => buildLineSelections(snapshot)).toThrow('baseline');
  });
});
