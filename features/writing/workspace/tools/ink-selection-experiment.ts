import type { InkRegion } from '../src/editor/inkTranscription';
import type { Sidecar } from '../src/sidecar/schema';

type Snapshot = {
  documentId: string;
  revisionId: string;
  pages: { id: string; sidecar: Sidecar }[];
  inkRegions: InkRegion[];
};
export type SelectionExperiment = {
  documentId: string;
  baseRevisionId: string;
  targetPageIds: string[];
  selections: {
    id: string;
    pageId: string;
    baseline: number;
    bounds: InkRegion['bounds'];
    sourceInkRegionIds: string[];
  }[];
};

/** Host-only prototype. Saved editor baselines determine membership, never AI guesses. */
export function buildLineSelections(snapshot: Snapshot): SelectionExperiment {
  const pageIds = new Set(snapshot.pages.map(page => page.id));
  if (pageIds.size !== snapshot.pages.length) throw Error('Duplicate saved page.');
  const ids = new Set<string>();
  const selections: SelectionExperiment['selections'] = [];
  for (const page of snapshot.pages) {
    const height = page.sidecar.layoutLineHeight;
    if (!height || !Number.isFinite(height) || height < 24) throw Error('Save the ruled grid first.');
    const runs = new Map(page.sidecar.inkRuns.map(run => [run.id, run]));
    const rows = new Map<number, InkRegion[]>();
    for (const region of snapshot.inkRegions.filter(region => region.pageId === page.id)) {
      if (ids.has(region.id)) throw Error('Duplicate ink reference.');
      ids.add(region.id);
      const run = runs.get(region.runId);
      if (!run || run.layoutY === undefined || !Number.isFinite(run.baselineOffset) || run.scale !== 1) {
        throw Error('Selection prototype requires settled, unscaled handwriting.');
      }
      const baseline = run.layoutY + run.baselineOffset;
      const row = Math.round(baseline / height);
      if (!Number.isFinite(baseline) || Math.abs(baseline - row * height) > .5) {
        throw Error('Handwriting does not have a saved ruled baseline.');
      }
      const members = rows.get(row) ?? [];
      members.push(region);
      rows.set(row, members);
    }
    for (const [row, members] of [...rows].sort(([a], [b]) => a - b)) {
      members.sort((a, b) => a.bounds.x - b.bounds.x);
      const x = Math.min(...members.map(region => region.bounds.x));
      const y = Math.min(...members.map(region => region.bounds.y));
      selections.push({
        id: `L${selections.length + 1}`, pageId: page.id, baseline: row * height,
        bounds: { x, y,
          width: Math.max(...members.map(region => region.bounds.x + region.bounds.width)) - x,
          height: Math.max(...members.map(region => region.bounds.y + region.bounds.height)) - y },
        sourceInkRegionIds: members.map(region => region.id),
      });
    }
  }
  if (ids.size !== snapshot.inkRegions.length) throw Error('Ink reference is outside the saved pages.');
  return { documentId: snapshot.documentId, baseRevisionId: snapshot.revisionId,
    targetPageIds: snapshot.pages.map(page => page.id), selections };
}

/** Fine-grained alternative: short labels preserve the original region granularity. */
export function buildRegionSelections(snapshot: Snapshot): SelectionExperiment {
  const grouped = buildLineSelections(snapshot);
  const byId = new Map(snapshot.inkRegions.map(region => [region.id, region]));
  let number = 0;
  return { ...grouped, selections: grouped.selections.flatMap(line =>
    line.sourceInkRegionIds.map(id => ({ id: `S${++number}`, pageId: line.pageId,
      baseline: line.baseline, bounds: byId.get(id)!.bounds, sourceInkRegionIds: [id] }))) };
}
