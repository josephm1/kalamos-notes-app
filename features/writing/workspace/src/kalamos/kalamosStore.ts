// Kalamos implementation of the DocStore seam. Documents are notebooks in
// the host app's library; source and ink sidecar are opaque per-notebook files
// behind the native bridge. The configurable filenames let Write's document
// mode and Notes' direct Planning mode share the editor without sharing data.
// persist() IS the save (there is no separate recovery layer), and it touches
// notebook metadata so the host library sorts by recency.
//
// docId === notebookId in this build.

import type { DocStore, PersistState, RecoveredDraft } from "../documents/store";
import type { Sidecar } from "../sidecar/schema";
import { validateSidecar } from "../sidecar/schema";
import { DEFAULT_PREFERENCES, type Preferences } from "../storage/preferences";
import { kalamosStorage } from "./shell";

export const DOC_FILE = "doc.md";
export const SIDECAR_FILE = "doc.write2.json";
const PREFS_KEY = "write2.prefs";

export type KalamosStoreOptions = {
  sourceFile?: string;
  sidecarFile?: string;
  preferencesKey?: string;
  defaultPreferences?: Partial<Preferences>;
};

function hasBridge(): boolean {
  return typeof Bridge !== "undefined";
}

function getNotebookFile(notebookId: string, relPath: string): string {
  if (!hasBridge()) return "";
  // Current Android shells keep writing documents in notebooks/<id>. The fallback supports the
  // browser preview and old host shells; it must not be the normal device route because book-file
  // storage can create a same-id record that masks Planning metadata.
  if (typeof Bridge.getNotebookFile === "function") {
    return Bridge.getNotebookFile(notebookId, relPath) || "";
  }
  return Bridge.getBookFile(notebookId, relPath) || "";
}

export function saveNotebookFile(notebookId: string, relPath: string, content: string): string {
  if (!hasBridge()) return "error";
  if (typeof Bridge.saveNotebookFile === "function") {
    return Bridge.saveNotebookFile(notebookId, relPath, content);
  }
  return Bridge.saveBookFile(notebookId, relPath, content);
}

export function readDocSource(notebookId: string, sourceFile = DOC_FILE): string {
  return getNotebookFile(notebookId, sourceFile);
}

export function createKalamosStore(options: KalamosStoreOptions = {}): DocStore {
  const sourceFile = options.sourceFile ?? DOC_FILE;
  const sidecarFile = options.sidecarFile ?? SIDECAR_FILE;
  const preferencesKey = options.preferencesKey ?? PREFS_KEY;
  const defaults = { ...DEFAULT_PREFERENCES, ...options.defaultPreferences };
  return {
    async loadSidecar(docId: string): Promise<Sidecar | undefined> {
      if (!hasBridge()) return undefined;
      const raw = getNotebookFile(docId, sidecarFile);
      if (!raw) return undefined;
      try {
        const res = validateSidecar(JSON.parse(raw));
        return res.ok ? res.sidecar : undefined;
      } catch {
        return undefined;
      }
    },

    async loadRecovery(): Promise<RecoveredDraft | undefined> {
      // persist() writes the canonical source directly; there is no separate
      // recovery draft to prefer over it.
      return undefined;
    },

    async persist(state: PersistState): Promise<void> {
      if (!hasBridge()) return;
      if (saveNotebookFile(state.docId, sourceFile, state.source) !== "ok") throw new Error("Notebook text could not be saved");
      if (saveNotebookFile(state.docId, sidecarFile, JSON.stringify(state.sidecar)) !== "ok") throw new Error("Notebook ink could not be saved");
      try {
        const store = kalamosStorage();
        const nb = store?.loadMeta(state.docId);
        if (store && nb) store.saveNotebook(nb); // bumps updatedAt for library recency
      } catch {
        // Library metadata is best-effort; source and ink are already saved.
      }
    },

    async loadPreferences(): Promise<Preferences> {
      try {
        const raw = localStorage.getItem(preferencesKey);
        return { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
      } catch {
        return defaults;
      }
    },

    async savePreferences(prefs: Preferences): Promise<void> {
      try {
        localStorage.setItem(preferencesKey, JSON.stringify(prefs));
      } catch {
        // Preferences are non-critical; ignore quota/serialization failures.
      }
    },
  };
}

export const kalamosStore: DocStore = createKalamosStore();
