// Storage seam for the vanilla shell. The browser build persists through
// IndexedDB + the File System Access API (browserStore.ts); the Kalamos
// device build persists through the native bridge's per-notebook book files
// (src/kalamos/kalamosStore.ts). The shell only talks to this interface.

import type { Sidecar } from "../sidecar/schema";
import type { Preferences } from "../storage/preferences";

export type RecoveredDraft = {
  source: string;
  /** True when the draft is newer than the last confirmed save. */
  dirty: boolean;
};

export type PersistState = {
  docId: string;
  documentName: string;
  source: string;
  sidecar: Sidecar;
  dirty: boolean;
};

export interface DocStore {
  loadSidecar(docId: string): Promise<Sidecar | undefined>;
  /** A draft newer than the opened file, if the backend keeps one. */
  loadRecovery(docId: string): Promise<RecoveredDraft | undefined>;
  /**
   * Persist the working state. For the browser this is a recovery snapshot
   * (the canonical file is written explicitly via Save); for Kalamos this IS
   * the save — doc.md and the ink sidecar are written together.
   */
  persist(state: PersistState): Promise<void>;
  loadPreferences(): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<void>;
}
