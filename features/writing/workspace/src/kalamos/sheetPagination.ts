import { paginateSheet, type SheetContent } from '../editor/sheetPagination';
import { PAGES_FILE, replaceWithContinuations, type WorkspacePages } from './workspacePages';

/** Publish immutable sheet files first and the manifest last. Never overwrite the checkpointed
 * original: interruption/save failure leaves it authoritative, with all ink and Markdown intact.
 * This is deliberately outside the pen hot path and uses the normal retained page-turn handoff. */
export function savePaginatedSheet(index: WorkspacePages, content: SheetContent, height: number,
  generation: string, save: (file: string, text: string) => string): WorkspacePages | null {
  const lineHeight = content.sidecar.layoutLineHeight ?? 56;
  const visibleHeight = Math.floor(height / lineHeight) * lineHeight;
  // Retain saved sheet geometry when more room becomes available, but never let an older
  // edge-to-edge height defeat new paper margins or a smaller device's actual visible bounds.
  // IME height is captured before focus by the workspace; resizing alone never invokes this.
  const sheetHeight = Math.min(index.sheetHeight ?? visibleHeight, visibleHeight);
  const parts = paginateSheet(content, sheetHeight);
  if (parts.length < 2) return null;
  const next = replaceWithContinuations(index, parts.map((_,i) => `${generation}-${i}`), sheetHeight);
  for (let i = 0; i < parts.length; i++) {
    const page = next.pages[next.active+i];
    if (save(page.sourceFile, parts[i].source) !== 'ok' ||
      save(page.sidecarFile, JSON.stringify(parts[i].sidecar)) !== 'ok') throw new Error('Cannot save overflow sheet');
  }
  if (save(PAGES_FILE, JSON.stringify(next)) !== 'ok') throw new Error('Cannot publish overflow sheets');
  return next;
}
