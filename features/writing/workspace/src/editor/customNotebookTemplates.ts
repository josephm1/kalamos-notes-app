import { createEmptySidecar, validateSidecar, type Sidecar } from '../sidecar/schema';
import { fingerprintOf } from '../documents/fingerprint';

export type CustomNotebookTemplate = {id:string;name:string;category:'Custom';source:string;sidecar:Sidecar};
/** Data-only starters reuse the canonical ruled document. Never execute template HTML/JS.
 * Native discovery restricts reads to flat JSON files; validation happens again at this seam. */
export function parseCustomNotebookTemplates(entries:unknown):CustomNotebookTemplate[] {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0,64).flatMap(entry => {
    if (!entry || typeof entry.filename !== 'string' || !/^[\w .-]+\.json$/i.test(entry.filename)) return [];
    const value=entry.template;
    if (!value || value.schema !== 'kalamos.notes.template.v1' || typeof value.name !== 'string' || !value.name.trim()) return [];
    const name=value.name.trim().slice(0,80), source=typeof value.source === 'string' ? value.source : '\u200b';
    if (source.length>200000 || !value.sidecar || typeof value.sidecar !== 'object') return [];
    const sidecar={...createEmptySidecar(name,fingerprintOf(source).hash),...value.sidecar,
      documentName:name,documentFingerprint:fingerprintOf(source).hash};
    const result=validateSidecar(sidecar);
    if (!result.ok) return [];
    return [{id:`custom:${entry.filename}`,name,category:'Custom' as const,source,sidecar:result.sidecar}];
  });
}
