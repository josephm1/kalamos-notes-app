// IndexedDB persistence for recovery, sidecars, recent files, and preferences.
// See BUILD_PLAN.md §8 "Recovery storage".

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Sidecar } from "../sidecar/schema";
import type { FileFingerprint } from "../documents/fingerprint";
import { DEFAULT_PREFERENCES, type Preferences } from "./preferences";

// Type + defaults moved to preferences.ts (shared with non-IndexedDB
// backends); re-exported here so existing imports keep working.
export { DEFAULT_PREFERENCES, type Preferences };

export type RecoverySnapshot = {
  docId: string;
  documentName: string;
  source: string;
  savedFingerprint: FileFingerprint | null;
  /** True when this recovery copy is newer than the last confirmed file save. */
  dirty: boolean;
  updatedAt: number;
};

export type RecentFileMeta = {
  docId: string;
  documentName: string;
  lastOpened: number;
  fingerprint: FileFingerprint | null;
};

interface Write2DB extends DBSchema {
  recovery: { key: string; value: RecoverySnapshot };
  sidecars: { key: string; value: Sidecar & { docId: string } };
  recentFiles: { key: string; value: RecentFileMeta; indexes: { byOpened: number } };
  preferences: { key: string; value: Preferences };
}

const DB_NAME = "write2";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<Write2DB>> | null = null;

export function getDb(): Promise<IDBPDatabase<Write2DB>> {
  if (!dbPromise) {
    dbPromise = openDB<Write2DB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("recovery")) {
          db.createObjectStore("recovery", { keyPath: "docId" });
        }
        if (!db.objectStoreNames.contains("sidecars")) {
          db.createObjectStore("sidecars", { keyPath: "docId" });
        }
        if (!db.objectStoreNames.contains("recentFiles")) {
          const store = db.createObjectStore("recentFiles", { keyPath: "docId" });
          store.createIndex("byOpened", "lastOpened");
        }
        if (!db.objectStoreNames.contains("preferences")) {
          db.createObjectStore("preferences");
        }
      },
    });
  }
  return dbPromise;
}

export async function saveRecovery(snapshot: RecoverySnapshot): Promise<void> {
  const db = await getDb();
  await db.put("recovery", snapshot);
}

export async function loadRecovery(docId: string): Promise<RecoverySnapshot | undefined> {
  const db = await getDb();
  return db.get("recovery", docId);
}

export async function deleteRecovery(docId: string): Promise<void> {
  const db = await getDb();
  await db.delete("recovery", docId);
}

export async function saveSidecar(docId: string, sidecar: Sidecar): Promise<void> {
  const db = await getDb();
  await db.put("sidecars", { ...sidecar, docId });
}

export async function loadSidecar(docId: string): Promise<Sidecar | undefined> {
  const db = await getDb();
  const row = await db.get("sidecars", docId);
  if (!row) return undefined;
  const { docId: _omit, ...rest } = row;
  void _omit;
  return rest;
}

export async function recordRecentFile(meta: RecentFileMeta): Promise<void> {
  const db = await getDb();
  await db.put("recentFiles", meta);
}

export async function listRecentFiles(limit = 10): Promise<RecentFileMeta[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("recentFiles", "byOpened");
  return all.reverse().slice(0, limit);
}

export async function loadPreferences(): Promise<Preferences> {
  const db = await getDb();
  const stored = await db.get("preferences", "user");
  return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  const db = await getDb();
  await db.put("preferences", prefs, "user");
}
