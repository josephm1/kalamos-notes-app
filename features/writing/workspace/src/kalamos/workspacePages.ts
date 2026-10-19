import type { NotebookTemplateId } from "../editor/notebookTemplates";
/** Page one retains the original filenames, so existing notebooks need no migration. */
export type WorkspacePage = { id: string; sourceFile: string; sidecarFile: string };
export type WorkspacePages = { version: 1; active: number; coverId?:string; template?: NotebookTemplateId; sheetHeight?: number; pages: WorkspacePage[] };
export const PAGES_FILE = 'planning.pages.json';
export function initialPages(): WorkspacePages {
  return { version: 1, active: 0, pages: [{ id: 'first', sourceFile: 'planning.write2.md', sidecarFile: 'planning.write2.json' }] };
}
export function parsePages(raw: string): WorkspacePages {
  if (!raw) return initialPages();
  const value = JSON.parse(raw) as WorkspacePages;
  if (value.version !== 1 || !Array.isArray(value.pages) || !value.pages.length ||
    value.pages.some(p => !p || !/^[a-zA-Z0-9_-]+$/.test(p.id) ||
      !/^planning\.[a-zA-Z0-9_.-]+\.md$/.test(p.sourceFile) ||
      !/^planning\.[a-zA-Z0-9_.-]+\.json$/.test(p.sidecarFile)) ||
    new Set(value.pages.map(p => p.id)).size !== value.pages.length ||
    new Set(value.pages.map(p => p.sourceFile)).size !== value.pages.length ||
    new Set(value.pages.map(p => p.sidecarFile)).size !== value.pages.length) throw new Error('Invalid notebook page index');
  return { version: 1, ...(typeof value.coverId==="string" && value.pages.some(p=>p.id===value.coverId)?{coverId:value.coverId}:{}), ...(Number.isFinite(value.sheetHeight) && value.sheetHeight! >= 48 && value.sheetHeight! <= 12000 ? {sheetHeight:value.sheetHeight} : {}), ...(value.template && ["ruled","week","tasks","meeting","journal"].includes(value.template) ? {template:value.template} : {}), pages: value.pages, active: Math.max(0, Math.min(value.pages.length - 1, Number.isInteger(value.active) ? value.active : 0)) };
}
export function appendPage(index: WorkspacePages, id: string): WorkspacePages {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || index.pages.some(p => p.id === id)) throw new Error('Invalid new page id');
  return { ...index, version: 1, active: index.pages.length, pages: [...index.pages,
    { id, sourceFile: `planning.page-${id}.md`, sidecarFile: `planning.page-${id}.json` }] };
}

/** Replace the active sheet with immutable saved fragments, inserting continuations immediately
 * after it. Later manually-created sheets retain their identities, order and files. */
export function replaceWithContinuations(index: WorkspacePages, ids: string[], sheetHeight: number): WorkspacePages {
  if (ids.length < 2 || new Set(ids).size !== ids.length || ids.some(id =>
    !/^[a-zA-Z0-9_-]+$/.test(id) || index.pages.some(page => page.id === id))) throw new Error('Invalid continuation ids');
  const pages = ids.map(id => ({id,sourceFile:`planning.page-${id}.md`,sidecarFile:`planning.page-${id}.json`}));
  return {...index, sheetHeight, pages:[...index.pages.slice(0,index.active),...pages,...index.pages.slice(index.active+1)]};
}
