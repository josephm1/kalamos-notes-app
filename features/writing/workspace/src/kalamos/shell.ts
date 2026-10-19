// Typed access to the Kalamos shell's lexical globals. `Storage` in the
// Kalamos web layer is a lexical `const` from a classic script (storage-web.js)
// that shadows the DOM's Storage class for later scripts; at type level the
// DOM wins, so we duck-type at runtime instead of redeclaring.

export type KalamosNotebook = {
  notebookId: string;
  title: string;
  kind?: string;
  updatedAt?: string;
  pages: Array<{ pageId: string; strokes: unknown }>;
};

export type KalamosStorageApi = {
  loadLibrary?(): {notebooks:Array<{notebookId:string;title:string;kind?:string}>};
  loadMeta(notebookId: string): KalamosNotebook | null;
  saveNotebook(notebook: KalamosNotebook): boolean;
  /** Persist a deterministic model-rendered PNG without re-capturing WebView pixels. */
  saveRenderedThumbnail?(notebookId: string, dataUrl: string): boolean;
};

export function kalamosStorage(): KalamosStorageApi | null {
  try {
    const s = Storage as unknown as Partial<KalamosStorageApi>;
    if (typeof s.loadMeta === "function" && typeof s.saveNotebook === "function") {
      return s as KalamosStorageApi;
    }
  } catch {
    // Storage not defined at all (shouldn't happen — DOM always has one).
  }
  return null;
}
