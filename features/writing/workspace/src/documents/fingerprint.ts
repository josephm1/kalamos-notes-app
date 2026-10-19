// Small, dependency-free content hash used for document fingerprints, block
// content hashes, and external-change detection. Not cryptographic — it only
// needs to detect change and identify content. See BUILD_PLAN.md §8.

export function contentHash(input: string): string {
  // FNV-1a 32-bit, hex, with length suffix to reduce accidental collisions.
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${input.length.toString(16)}`;
}

export type FileFingerprint = {
  hash: string;
  size: number;
  lastModified: number;
};

export function fingerprintOf(text: string, lastModified = Date.now()): FileFingerprint {
  return {
    hash: contentHash(text),
    size: text.length,
    lastModified,
  };
}

export function fingerprintsMatch(a: FileFingerprint, b: FileFingerprint): boolean {
  return a.hash === b.hash && a.size === b.size;
}
