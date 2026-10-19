# Handwriting API transcription repair

## Established failure

User's device shows Notes document unavailable: No value for schema. Android stage log confirms
Agora accepted automatic application and launched Notes. Code reproduces failure: NotesProposal.schema
is default-valued; previous Json encoder omitted defaults while native validator requires schema.
Kotlin decode/roundtrip tests hid this by restoring defaults. Fixed encoding with encodeDefaults=true
and explicitNulls=false, preserving checked:false and schema/operation without null new-note identities.
New wire test asserts actual JSON fields; neutral Notes validator fixture accepts the same form.
Historical exact HTTP request/output was not available through ADB; do not claim it was inspected.

## Further problem corrected

Existing organize operation preserved all original ink on separate kept pages. It never replaced
handwriting, and whole-page projection could duplicate independent source/annotations. Handwriting
conversion is now a distinct replace_ink operation via dedicated Agora tool replace_notes_handwriting.

- Notes exports stable local ink-region references and trusted page-space bounds. Raw stroke IDs stay
  local; AI gets compact IDs/bounds and selected page images/text.
- Each returned text/task names sourceInkRegionIds. Notes validates base revision/exported scope and
  expands only known provenance to original ink. Unknown, repeated, missing, empty, unread references
  cannot delete ink. Unreferenced handwritten words remain.
- Workspace copies original pages, removes referenced strokes and inserts normal editable textboxes
  on saved ruled positions using measured font. Existing source/textboxes/shapes/unplaced ink remain.
  If text cannot fit without covering unrelated content, operation fails without publishing.
- Native verifies unchanged sidecar fields/unconsumed ink, stages changed page files, and atomically
  publishes index retaining original page identities/order. Previous index supports exact Undo;
  stale/repeated/interrupted operations retain existing recovery and receipt protections.
- Text/task controls use existing spacing/reflow/scribble/history. No second editor or Bigme policy.

## Diagnostics

Agora privately retains up to12 bounded Notes-only records: input projection, image page/checksum
metadata, tool arguments and validated wire; no HTTP credentials or image base64. Notes privately
records received payload + validation/processing stages, accessible through current WebView's
notes.agora.diagnostics; no broad data export. Native request failures capture exact reason. Data stays
local unless user explicitly shares it. Physical recording requires a fresh attachment with region IDs.

## Current evidence

Workspace451 tests/typecheck/bundle regeneration, focused native Notes36/documents42, Agora33,
related JS596 checks passed. Full test-all workspace451 passed; app/content680 of681 passed, one
preexisting unrelated Todo embedded-zai-contract failure. Remaining reader/KOReader22 and full Standard Android native checks passed separately. Device APK install-r hashes verified:
Notes d38b3b484e351e8b33d0a27ea51506cfe7e7bf148a19c65e8eadceb659dc8a44
Agora 0b19d5c6867293d13b31c308079a83e83155d21684951601b85da5e66ea3c50c
Physical transcription/gestures acceptance pending; active goal remains unfinished until actual result.

## Physical matrix

Fresh attach → API handwritten paragraph→typed samepage. Partial conversion preserves other word,
drawing and independent typed annotation. Checklist has functioning controls. Scribble returned word,
insert space, write, save/reopen and Undo. Repeated conversion uses newest revision/ref IDs; old results
cannot overwrite. Unread text remains ink. Text-only model needs transcription text from a recognizer;
vision model needs included page images (display cover is not AI input).

## Architecture direction

See docs/architecture/NOTES-WEB-DOCUMENT-CORE.md: small headless web document + operation planner,
existing ruled view, storage/recovery adapter, external service adapters, trusted web element registry.
This is the target direction, not a completed wholesale migration. Current fix is first bounded step.

## Guidance

[Kotlin encodeDefaults](https://kotlinlang.org/api/kotlinx.serialization/kotlinx-serialization-json/kotlinx.serialization.json/-json-builder/encode-defaults.html), [BlockSuite store/commands/views](https://blocksuite.io/guide/overview), [tldraw typed store](https://tldraw.dev/reference/store/Store), [Excalidraw semantic element creation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton), [ProseMirror transaction/history community discussion](https://discuss.prosemirror.net/t/replacing-a-states-doc/634), [ML Kit recognition context](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android).
