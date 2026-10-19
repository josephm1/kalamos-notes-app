# AI document return and notebook attachment update

## Implemented

- Notes attachments render their actual page image; display-only cover is independent of AI page-image selection. Generic ZIP attachments retain normal presentation. Missing/corrupt preview is reported, not replaced by a notebook icon.
- Saved cover and full images have checksum-validated archive references. Display cover paths are retained with drafts and included in backup/path-cleanup bookkeeping; display cover is not added to AI image inputs.
- Successful explicit Notes tool output automatically opens Notes after the assistant run completes while Agora is foreground. Durable per-owner/proposal receipts prevent old result replay; additional outputs remain accessible through result cards. No automatic message Send.
- Notes automatically materializes and commits validated results. There is no review/apply dialog in any path. Stale or invalid results retain the current editable note and report an error.
- Workspace materialization uses saved ruling/current paper geometry and the editor's font measurement. Text ranges preserve spaces, newlines, and long tokens across pagination; continuation metadata preserves exact joins.
- Scribble erase now hits editable typed words at their actual reflowed positions in the existing gesture/history transaction. Task controls follow their text; normal editing Undo restores removed text.
- Native commits are scoped to exported page IDs. Untouched pages keep IDs/order/files. Previous index is durable before atomic publication. AI revision recovery is available through existing Agora document options → Undo AI processing; it refuses to overwrite subsequent edits. Original-copy recovery remains.
- Page-image cache keys include document revision, viewport and DPR. Changed content/settings changes revision; different geometry uses another key. Cache reads use the small index; export performs the final current-revision check. Rendering cache is bounded to64 files per document.

## Verified so far

Workspace445 tests + typecheck + generated Android bundle passed. Related JS595 checks passed. Notes native31 and neutral documents41 passed; Agora focused26 passed. Full Standard Android native checks passed earlier in this update. Device render diagnostic for Notebook23 first page:135ms, excluding encoding/archive/handoff.

First physical thumbnail checks showed an unwanted fallback icon/label over actual notebook pixels. Root cause found: a broad edit accidentally inserted the placeholder into MEDIA_SUCCESS, after Image. Removed that overlay; source regression check added. Saved Notes thumbnail contains actual ink/rules and no symbol. No final physical AI/pen acceptance yet.

Device preparation logs: old inspect766ms/cache-read644ms/cache-write550ms/export660ms. After eliminating duplicate revision scans in cache operations: inspect800ms/cache-read9ms/export797ms with no render-cache write (cache hit). These are operation measurements, not a full end-to-end benchmark. Unchanged renders are reused; first render and packaging still cost time.

## Physical QA

1. Attach the same unchanged notebook twice; capture actual image and compare timing logs. Change ink, reattach: thumbnail must update. Repeat with AI page images off: real cover remains, model images stay disabled.
2. Ask a supported model to process a handwritten list into a checklist. Explicit successful Notes tool result should return to Notes automatically with no normal Apply step. Unrecognized handwriting needs local recognition or a vision-capable model; text-only models cannot read raw ink.
3. Scribble out a returned word; Undo. Insert horizontal/blank-line space, write in it, tick a task, save/reopen. Keep the existing ruling and positions.
4. Process one page of a multi-page notebook; other pages remain unchanged. Test long text/whitespace across pages.
5. Undo AI processing before later edits restores prior note. After later edits, recovery must not discard them. Repeated results do not reapply.
6. Ordinary ZIP/image/PDF attachments keep their existing behavior. Old Notes attachments without cover use available page image or explicit unavailable state.

## Guidance used

[Tiptap AI edit modes](https://tiptap.dev/docs/ai/ai-toolkit/client/api-reference/review-options) supports immediate application as a configurable workflow. [ProseMirror community guidance on replacing documents](https://discuss.prosemirror.net/t/replacing-a-states-doc/634) highlights preserving transaction/history ownership instead of rebuilding an editor. [Tiptap schema](https://tiptap.dev/docs/editor/core-concepts/schema) and [interactive node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views) separate document meaning from interactive rendering. [Google digital ink](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android) documents recognition context/stroke ordering. These informed the approach; no editor framework replacement was introduced.

## Limits

Current supported return elements remain heading, paragraph, bullet, numbered, task. Richer web components need versioned editable contracts and defined erase/spacing/save behavior; this update does not claim table/form/diagram support. Automatic return requires an explicit structured Notes tool output from a supported model while the chat remains foreground; historical/plain chat answers do not auto-mutate notes.
