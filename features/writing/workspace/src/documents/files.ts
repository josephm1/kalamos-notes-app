// Open/save Markdown via the File System Access API where supported, with an
// <input type="file"> + download fallback. Never claims autosave reached the
// original file unless a write actually succeeded. See BUILD_PLAN.md §8.

import { fingerprintOf, type FileFingerprint } from "./fingerprint";

export type OpenedDocument = {
  docId: string;
  name: string;
  source: string;
  fingerprint: FileFingerprint;
  /** Present only when File System Access granted a writable handle. */
  handle: FileSystemFileHandle | null;
};

export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

export function supportsSaveHandle(): boolean {
  return supportsFileSystemAccess() && "showSaveFilePicker" in window;
}

const MD_ACCEPT = {
  description: "Markdown or text",
  accept: {
    "text/markdown": [".md", ".markdown"],
    "text/plain": [".txt"],
  },
} as const;

function docIdFor(name: string): string {
  // Stable per-name id so recovery/sidecar reconnect on reopen. Filenames are
  // the practical key on the web where full paths are not exposed.
  return `doc:${name}`;
}

export async function openWithPicker(): Promise<OpenedDocument | null> {
  const [handle] = await (window as unknown as {
    showOpenFilePicker: (opts: unknown) => Promise<FileSystemFileHandle[]>;
  }).showOpenFilePicker({
    types: [MD_ACCEPT],
    multiple: false,
  });
  const file = await handle.getFile();
  const source = await file.text();
  return {
    docId: docIdFor(file.name),
    name: file.name,
    source,
    fingerprint: fingerprintOf(source, file.lastModified),
    handle,
  };
}

export function openWithInput(): Promise<OpenedDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const source = await file.text();
      resolve({
        docId: docIdFor(file.name),
        name: file.name,
        source,
        fingerprint: fingerprintOf(source, file.lastModified),
        handle: null,
      });
    };
    input.click();
  });
}

export async function openMarkdown(): Promise<OpenedDocument | null> {
  if (supportsFileSystemAccess()) {
    try {
      return await openWithPicker();
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return null;
      // Fall through to input fallback on any picker failure.
    }
  }
  return openWithInput();
}

export type ConflictCheck =
  | { changed: false }
  | { changed: true; current: FileFingerprint };

/**
 * Re-read the handle and compare against the fingerprint captured at open/save
 * time. Used before overwriting to avoid clobbering external edits.
 */
export async function checkForExternalChange(
  handle: FileSystemFileHandle,
  known: FileFingerprint
): Promise<ConflictCheck> {
  const file = await handle.getFile();
  const source = await file.text();
  const current = fingerprintOf(source, file.lastModified);
  if (current.hash === known.hash && current.size === known.size) {
    return { changed: false };
  }
  return { changed: true, current };
}

export type SaveResult =
  | { ok: true; fingerprint: FileFingerprint; wroteFile: boolean }
  | { ok: false; reason: "conflict" | "no-handle" | "error"; message?: string };

/** Write back to the retained handle, checking for external change first. */
export async function saveToHandle(
  handle: FileSystemFileHandle,
  source: string,
  known: FileFingerprint,
  { force = false }: { force?: boolean } = {}
): Promise<SaveResult> {
  try {
    if (!force) {
      const check = await checkForExternalChange(handle, known);
      if (check.changed) return { ok: false, reason: "conflict" };
    }
    const writable = await (
      handle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }
    ).createWritable();
    await writable.write(source);
    await writable.close();
    return {
      ok: true,
      wroteFile: true,
      fingerprint: fingerprintOf(source, Date.now()),
    };
  } catch (err) {
    return { ok: false, reason: "error", message: (err as Error)?.message };
  }
}

export async function saveWithPicker(
  source: string,
  suggestedName: string
): Promise<{ handle: FileSystemFileHandle; fingerprint: FileFingerprint } | null> {
  const handle = await (
    window as unknown as {
      showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker({ suggestedName, types: [MD_ACCEPT] });
  const writable = await (
    handle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }
  ).createWritable();
  await writable.write(source);
  await writable.close();
  return { handle, fingerprint: fingerprintOf(source, Date.now()) };
}

/** Fallback Save As — triggers a browser download. Does not retain a handle. */
export function downloadText(
  source: string,
  filename: string,
  mime = "text/markdown"
): void {
  const blob = new Blob([source], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
