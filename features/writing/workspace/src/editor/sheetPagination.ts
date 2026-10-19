import type { Sidecar } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';
import { sliceBoxWords } from './textBox';

export type SheetContent = { source: string; sidecar: Sidecar };
type Extent = { top: number; bottom: number };

/** Split materialised ruled coordinates, never stroke points or words. This runs only after a
 * deliberate spacing/text operation has checkpointed the native batch, never on the live pen path.
 * Boundaries are whole ruled lanes. A descender crossing a boundary moves its entire lane, including
 * detached dots, typed words and checklist controls. Free objects remain atomic too. */
export function paginateSheet(content: SheetContent, availableHeight: number): SheetContent[] {
  const { source, sidecar } = content;
  const h = sidecar.layoutLineHeight ?? 56;
  const height = Math.floor(availableHeight / h) * h;
  if (!Number.isFinite(height) || height < h * 2) return [content];
  const words = sidecar.sourceWords ?? [];
  // Preserve exact Markdown substrings, including indentation/newlines. Canonical direct workspace
  // exposes the source as whitespace-separated words; do not guess placements for mismatched data.
  const tokens = [...source.matchAll(/\S+\s*/g)];
  if (tokens.length !== words.length) return [content];
  const extents: Extent[] = [
    ...words.map(w => ({ top: w.y, bottom: w.y + h })),
    ...sidecar.inkRuns.map(r => ({ top: r.layoutY ?? 0,
      // Intrinsic bounds already include four-pixel padding. Wide brushes need extra bottom
      // clearance for their outline; moving the run preserves its width/pressure without clipping.
      bottom: (r.layoutY ?? 0) + r.intrinsicHeight + Math.max(0, ...r.strokes.map(s => s.width - 4)) })),
    ...(sidecar.textBoxes ?? []).flatMap(b => b.words?.length
      ? b.words.map(w => ({ top: w.y, bottom: w.y + h })) : [{ top: b.y, bottom: b.y + h }]),
    ...(sidecar.pageObjects ?? []).map(o => ({ top: o.y, bottom: o.y + o.height + o.strokeWidth / 2 })),
  ];
  if (sidecar.inkRuns.some(r => r.layoutY === undefined)) return [content];
  // An oversized free drawing cannot fit a sheet without scaling or cutting it. Keep the original
  // editable document rather than silently clipping it or looping while trying to move it forward.
  if (extents.some(e => !Number.isFinite(e.top) || !Number.isFinite(e.bottom) || e.top < 0)) return [content];
  if (extents.some(e => e.bottom - Math.floor(e.top / h) * h > height)) return [content];
  const bottom = Math.max(0, ...extents.map(e => e.bottom));
  if (bottom <= height) return [content];
  const starts = [0];
  while (starts[starts.length - 1] + height < bottom) {
    const start = starts[starts.length - 1];
    let boundary = start + height;
    // Reserve the bottom margin for descenders; move the crossing lane, not its neighbouring
    // lane merely because their bounds overlap. The previous sheet still renders to start+height,
    // so its surviving descenders fit even when the next sheet starts at an earlier logical row.
    // Chasing every overlapping bound backwards would merge ordinary cursive rows into one giant
    // group and prevent pagination on pages containing descenders on every line.
    const crossing = extents.filter(e => e.top < boundary && e.bottom > boundary);
    boundary = Math.min(boundary, ...crossing.map(e => Math.floor(e.top / h) * h));
    if (boundary <= start) return [content];
    starts.push(boundary);
    if (starts.length > 1000) return [content]; // corrupt coordinates must not allocate unbounded sheets
  }
  const pageAt = (y: number) => {
    let i = starts.length - 1;
    while (i > 0 && y < starts[i]) i--;
    return i;
  };
  const wordPages = words.map(w => pageAt(w.y));
  let textOffset = -1;
  const wordEnds = words.map(word => textOffset += word.text.length + 1);
  return starts.map((start, page) => {
    const selected = words.flatMap((w, i) => wordPages[i] === page ? [{ ...w, y: w.y - start }] : []);
    const chunks = tokens.flatMap((token, i) => wordPages[i] === page
      ? [(i === 0 ? source.slice(0, token.index) : '') + token[0]] : []);
    const newSource = chunks.join('') || '\u200b';
    const newWords = chunks.length ? selected : [{ text: '\u200b', x: 0, y: 0 }];
    return { source: newSource, sidecar: {
      ...sidecar, documentFingerprint: fingerprintOf(newSource).hash, updatedAt: Date.now(),
      sourceWords: newWords,
      inkRuns: sidecar.inkRuns.filter(r => pageAt(r.layoutY!) === page).map(r => {
        // Anchors are local to each sheet; vector geometry stays run-local and byte-identical.
        const before = words.filter((_, i) => wordPages[i] === page &&
          wordEnds[i] <= r.anchorOffset).map(w => w.text).join(' ');
        const text = newWords.map(w => w.text).join(' ');
        const anchorOffset = before.length;
        return { ...r, layoutY: r.layoutY! - start, anchorOffset,
          contextBefore: text.slice(Math.max(0, anchorOffset - 24), anchorOffset),
          contextAfter: text.slice(anchorOffset, anchorOffset + 24) };
      }),
      textBoxes: (sidecar.textBoxes ?? []).flatMap(box => {
        if (!box.words?.length) return pageAt(box.y) === page ? [{ ...box, y: box.y - start }] : [];
        const indices=box.words.flatMap((w,i)=>pageAt(w.y)===page?[i]:[]);
        if(!indices.length)return [];
        const first=indices[0],end=indices[indices.length-1]+1;
        // Spacing keeps a text box's reading order. If imported placements are non-contiguous,
        // preserve their original text rather than inventing a lossy substring.
        const contiguous=indices.length===end-first;
        const piece=contiguous?sliceBoxWords(box.text,box.words,first,end,box.styles):{text:box.text,words:indices.map(i=>box.words![i]),styles:box.styles};
        const placed=piece.words.map(w=>({...w,y:w.y-start}));
        const split=placed.length!==box.words.length;
        return [{ ...box, id: split ? `${box.id}-sheet-${page}` : box.id,
          text:piece.text,styles:piece.styles, semantic:box.semantic?{...box.semantic,...(first>0?{continuation:true}:{})}:undefined,
          x: Math.min(...placed.map(w => w.x)), y: Math.min(...placed.map(w => w.y)),
          words: placed }];
      }),
      pageObjects: (sidecar.pageObjects ?? []).filter(o => pageAt(o.y) === page).map(o => ({ ...o, y: o.y - start })),
      unplacedInk: page === 0 ? sidecar.unplacedInk : [],
    } };
  });
}
