import { boundsOfPoints, type InkStroke } from '../ink/types';
import { strokesToRun } from '../sidecar/anchors';
import { createEmptySidecar } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';

export type LegacyPage = {
  pageId: string;
  strokes: { id?: string; tool?: string; width?: number; color?: string;
    points: { x: number; y: number; p?: number; pressure?: number; t?: number }[] }[];
  texts?: { id?: string; boxId?: string; text: string; x: number; y: number; size?: number; boxWidth?: number }[];
};

/** Conversion is deliberately non-destructive and does not recognise or reflow ink.
 * Each original stroke becomes an independently editable run at its original CSS
 * position. The host saves an untouched backup before committing these sheets. */
export function convertLegacyPage(page: LegacyPage, title: string, lineHeight = 56) {
  if (!page || !Array.isArray(page.strokes)) throw new Error('Handwriting page has invalid strokes');
  const source = '\u200b';
  const sidecar = createEmptySidecar(title, fingerprintOf(source).hash);
  sidecar.layoutLineHeight = lineHeight;
  for (const [index, old] of page.strokes.entries()) {
    if (!Array.isArray(old.points) || old.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      throw new Error('Handwriting coordinates could not be converted');
    if (!old.points.length) continue;
    const points = old.points.map((p, i) => ({ x: p.x, y: p.y, t: p.t ?? i * 4, pressure: p.pressure ?? p.p ?? .5 }));
    const stroke: InkStroke = { id: `legacy-${index}`, tool: 'pen', color: '#000000',
      width: Number.isFinite(old.width) && old.width! > 0 ? old.width! : 2, points, bounds: boundsOfPoints(points) };
    const b = boundsOfPoints(points, 4);
    const run = strokesToRun([stroke], { id: `legacy-run-${index}`, blockId: 'planning-document',
      anchorOffset: 0, blockText: source, layoutX: b.x, layoutY: b.y });
    if (run) sidecar.inkRuns.push(run);
  }
  // Keep the original line text, including individual entries from old wrapped
  // boxes. They enter the current ruled text model rather than a second renderer.
  sidecar.textBoxes = (page.texts ?? []).map((t, i) => {
    if (typeof t.text !== 'string' || !Number.isFinite(t.x) || !Number.isFinite(t.y))
      throw new Error('Handwriting text could not be converted');
    return { id: `legacy-text-${i}`, blockId: 'planning-document', text: t.text,
      x: Math.max(0, t.x), y: Math.max(0, Math.round(t.y / lineHeight) * lineHeight),
      width: t.boxWidth && t.boxWidth > 0 ? t.boxWidth : 280, size: t.size && t.size > 0 ? t.size : 24,
      autoWidth: !t.boxWidth };
  });
  return { source, sidecar };
}
