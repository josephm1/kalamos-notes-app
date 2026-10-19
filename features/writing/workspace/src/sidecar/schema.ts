import { normalizeInlineStyles } from '../editor/inlineStyles';
// Ink sidecar — persisted as `document-name.write2.json`. Keeps strokes OUT of
// the Markdown so an ordinary editor still opens a clean source file.
// See BUILD_PLAN.md §8 "Required ink sidecar".

import type { InlineInkRun } from "../ink/types";

export const SIDECAR_SCHEMA_VERSION = 1 as const;
export const SIDECAR_MAGIC = "write2.sidecar" as const;

export type BlockAnchor = {
  blockId: string;
  blockType: string;
  contentHash: string;
};

/** Independent typed annotation, in ruled-workspace CSS coordinates. */
export type TextBox = {
  semantic?: import("../editor/semanticDocument").SemanticBinding;
  id: string; blockId: string; text: string; x: number; y: number; width: number; size: number;
  /** Width follows content until the user explicitly resizes the box. */
  autoWidth?: boolean;
  /** Host-measured heading style; absent on older annotations, which retain their font. */
  fontWeight?: 700;
  /** Standard Markdown marks over authoritative UTF-16 text ranges. */
  styles?: import('../editor/inlineStyles').InlineStyle[];
  /** Interactive end-of-row task, still anchored by the shared spacing model. */
  checkbox?: boolean;
  /** Saved word placements share the ruled lane and spacing model with handwriting. */
  words?: import("../editor/textBox").BoxWord[];
};

export type Sidecar = {
  magic: typeof SIDECAR_MAGIC;
  schemaVersion: number;
  /** Fingerprint of the Markdown file this sidecar belongs to. */
  documentFingerprint: string;
  documentName: string;
  updatedAt: number;
  blockAnchors: BlockAnchor[];
  inkRuns: InlineInkRun[];
  textBoxes?: TextBox[];
  pageObjects?: import("../editor/pageObjects").PageObject[];
  /** Planning source word placements; source Markdown remains byte-preserved. */
  sourceWords?: { text: string; x: number; y: number }[];
  layoutLineHeight?: number;
  /** Ink whose anchor could not be confidently remapped after an edit. */
  unplacedInk: InlineInkRun[];
};

export function createEmptySidecar(
  documentName: string,
  documentFingerprint: string
): Sidecar {
  return {
    magic: SIDECAR_MAGIC,
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    documentFingerprint,
    documentName,
    updatedAt: Date.now(),
    blockAnchors: [],
    inkRuns: [],
    unplacedInk: [],
  };
}

export type ValidationResult =
  | { ok: true; sidecar: Sidecar }
  | { ok: false; error: string };

/** Validate a parsed object as a sidecar and migrate older versions forward. */
export function validateSidecar(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Sidecar is not an object." };
  }
  const obj = input as Record<string, unknown>;
  if (obj.magic !== SIDECAR_MAGIC) {
    return { ok: false, error: "Not a compatible Kalamos ink sidecar." };
  }
  const version = obj.schemaVersion;
  if (typeof version !== "number") {
    return { ok: false, error: "Missing schema version." };
  }
  if (version > SIDECAR_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Sidecar schema v${version} is newer than this app (v${SIDECAR_SCHEMA_VERSION}).`,
    };
  }

  let migrated:Sidecar;
  try{migrated=migrate(obj);}catch(error){return {ok:false,error:error instanceof Error?error.message:'Invalid inline styles'};}
  if (!Array.isArray(migrated.inkRuns) || !Array.isArray(migrated.blockAnchors)) {
    return { ok: false, error: "Sidecar is missing required arrays." };
  }
  return { ok: true, sidecar: migrated as Sidecar };
}

/** Placeholder migration chain — extend as the schema evolves. */
function migrate(obj: Record<string, unknown>): Sidecar {
  const out = { ...obj } as Sidecar;
  // v0 -> v1: ensure unplacedInk exists.
  if (!Array.isArray(out.unplacedInk)) out.unplacedInk = [];
  if (out.textBoxes !== undefined) out.textBoxes = Array.isArray(out.textBoxes)
    ? out.textBoxes.filter((b) => b && typeof b.id === "string" && typeof b.blockId === "string" && typeof b.text === "string" &&
      [b.x, b.y, b.width, b.size].every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.width > 0 && b.size > 0).map(({ gapBasis: _gapBasis, lineBasis: _lineBasis, ...b }: TextBox & { gapBasis?: unknown; lineBasis?: unknown }) => ({ ...b,
        fontWeight: b.fontWeight===700 ? 700 : undefined,
        styles: b.styles?.length ? normalizeInlineStyles(b.text,b.styles) : undefined,
        semantic: b.semantic && /^[a-zA-Z0-9_-]{1,120}$/.test(b.semantic.id) &&
          ['heading','paragraph','bullet','numbered','task'].includes(b.semantic.type) &&
          ['text','checkbox'].includes(b.semantic.role) ? b.semantic : undefined,
        words: Array.isArray(b.words) && b.words.every((w) => w && typeof w.text === "string" && Number.isFinite(w.x) && Number.isFinite(w.y) && w.x >= 0 && w.y >= 0) ? b.words : undefined,
      })) : [];
  if (out.sourceWords !== undefined) out.sourceWords = Array.isArray(out.sourceWords) && out.sourceWords.every(w =>
    w && typeof w.text === "string" && Number.isFinite(w.x) && Number.isFinite(w.y) && w.x >= 0 && w.y >= 0)
    ? out.sourceWords : undefined;
  if (!Number.isFinite(out.layoutLineHeight) || out.layoutLineHeight! < 24 || out.layoutLineHeight! > 120) out.layoutLineHeight = undefined;
  if (out.pageObjects !== undefined) out.pageObjects = Array.isArray(out.pageObjects) ? out.pageObjects.filter(o =>
    o && typeof o.id === "string" && ["markdown","rectangle","ellipse","line","triangle","star","sketch","trapezoid","pentagon","hexagon"].includes(o.kind) &&
    (o.kind!=='markdown'||(o.markdown&&typeof o.markdown.id==='string'&&o.markdown.id.length<=120&&typeof o.markdown.source==='string'&&o.markdown.source.length<=1_048_576&&Array.isArray(o.markdown.lines)&&o.markdown.lines.length<=1000&&o.markdown.lines.every(line=>typeof line==='string'&&line.length<=4096))) &&
    [o.x,o.y,o.width,o.height,o.strokeWidth].every(Number.isFinite) && o.x>=0 && o.y>=0 && o.width>0 && o.height>0 &&
    o.strokeWidth>0 && /^#[0-9a-f]{6}$/i.test(o.color) &&
    (o.points === undefined || Array.isArray(o.points) && o.points.every(p=>p && Number.isFinite(p.x)&&Number.isFinite(p.y))) &&
    (o.paper === undefined || typeof o.paper === "boolean") &&
    (o.lineStyle === undefined || ["solid","dotted","dashed"].includes(o.lineStyle)) &&
    (o.ink === undefined || Array.isArray(o.ink) && o.ink.every(s=>s && typeof s.id === "string" &&
      Number.isFinite(s.width) && s.width>0 && /^#[0-9a-f]{6}$/i.test(s.color) &&
      Array.isArray(s.points) && s.points.length>0 && s.points.every(p=>p && [p.x,p.y,p.t,p.pressure].every(Number.isFinite)) &&
      s.bounds && [s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height].every(Number.isFinite)))) : [];
  out.schemaVersion = SIDECAR_SCHEMA_VERSION;
  return out;
}

export function serializeSidecar(sidecar: Sidecar): string {
  return JSON.stringify(sidecar, null, 2);
}
