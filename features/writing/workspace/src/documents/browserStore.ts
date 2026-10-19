// Browser implementation of the DocStore seam: IndexedDB for recovery
// snapshots, sidecars, and preferences — exactly the behavior the vanilla
// shell had before the seam existed. Canonical file writes stay explicit
// (Save button → File System Access / download) and are not routed here.

import type { DocStore, PersistState, RecoveredDraft } from "./store";
import type { Sidecar } from "../sidecar/schema";
import {
  loadPreferences,
  savePreferences,
  loadSidecar,
  saveSidecar,
  saveRecovery,
  loadRecovery,
} from "../storage/db";
import type { Preferences } from "../storage/preferences";

export const browserStore: DocStore = {
  loadSidecar(docId: string): Promise<Sidecar | undefined> {
    return loadSidecar(docId);
  },

  async loadRecovery(docId: string): Promise<RecoveredDraft | undefined> {
    const rec = await loadRecovery(docId);
    if (!rec) return undefined;
    return { source: rec.source, dirty: rec.dirty };
  },

  async persist(state: PersistState): Promise<void> {
    await saveRecovery({
      docId: state.docId,
      documentName: state.documentName,
      source: state.source,
      savedFingerprint: null,
      dirty: state.dirty,
      updatedAt: Date.now(),
    });
    await saveSidecar(state.docId, state.sidecar);
  },

  loadPreferences(): Promise<Preferences> {
    return loadPreferences();
  },

  savePreferences(prefs: Preferences): Promise<void> {
    return savePreferences(prefs);
  },
};
