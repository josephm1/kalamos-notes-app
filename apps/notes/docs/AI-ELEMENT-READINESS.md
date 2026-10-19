# AI element integration readiness

2026-10-14. Thinking stays enabled. Agora's generation policy and core settings are
unchanged. Candidate skills are experimental host fixtures, not installed app skills.

## Intended behavior

An ambiguous conversion request should produce literal editable paragraphs at the
original ruled locations. Preserve unfamiliar wording, uncertainty and unconverted
ink. Explicit requests for a to-do list may create task elements, preserve visible
checked states, split items and add useful headings. Explicit organization requests
may reorder and format content without inventing deadlines, priorities or actions.
These are intent guidelines, not a deterministic natural-language classifier.

The AI supplies concise semantic content. Notes creates the actual HTML controls,
measures text and owns placement, gesture editing, task state and persistence.
Heading, paragraph, bullet, numbered and task are currently supported. No additional
skill or tool is needed merely to enable these existing elements.

## Verified locally

A hand-authored format fixture went through Agora's actual streaming parser and
Notes tool, Notes' production materializer in Chromium, and the native apply
transaction. It produced a heading, two tasks (checked/unchecked) and a paragraph,
with six editable text/control boxes and no retained converted ink. Reopening through
a new native repository preserved semantic identity, text, type and checked state.
Duplicate delivery made no change; Undo restored the original pages.

The fixture deliberately tests element integration, not recognition of its original
strokes. It is not a live-model accuracy result and never changed the device notebook.
Actual `PenWorkspace` rendering was inspected locally at 500×623. Its checkbox HTML
controls render both checked states. Existing gesture tests exercise tapping, spacing,
scribble, save/reopen and Undo on transcribed tasks.

Evidence: `artifacts/notes-vision-smoke-2026-10-14/elements-host/`.
Agora focused32 tests, workspace semantic/transcription/gesture16 tests and native
host apply/reopen/duplicate/Undo passed. The only production change in this pass is
concise Notes-tool guidance for the ambiguous default versus explicitly requested
task/list formatting; no new instructions were installed into the skill database.

## Gaps before broader formatting is ready

1. Replacement and organization need separate layout intent. `replace_ink` anchors
   text near its original ruled lanes and preserves unrelated content. `organize`
   re-materializes selected semantic content and retains original ink on kept pages.
   These behaviors do not yet constitute a flexible in-place reorganizer. Use an
   explicit, default-preserve layout policy in a future contract; keep unread ink,
   annotations and other pages anchored, and plan flow around them locally.
2. Iterative typed edits currently use a complete-block organization operation.
   A typed update/insert/remove transaction would preserve untouched elements and
   layout more directly. Reuse document identities and existing history rather than
   adding a separate HTML editor or duplicate task state.
3. Heading semantics persist, but transcription headings currently use the same
   measured font as body text. Styling hierarchy must be added with matching font
   measurement and hit testing; a CSS-only bold/size change could misalign scribble
   targets and wrapping. The local screenshot exposes this limitation.
4. Tables, callouts and richer interactive components need a real element contract:
   schema/state, editor renderer, compact AI projection and defined erase/spacing/
   save/Undo behavior. Add one useful type at a time, using a small registry as needed.
   Avoid inflating the current tool with capabilities that are not implemented.
5. Model acceptance needs labelled checklist, mixed-content, uncertain and iterative
   edit cases. Score source-reference coverage and retained ink as well as readable
   text, task state, layout and token/time cost. A valid tool result alone is insufficient.

No broad layout rewrite or device install was made during this audit. The existing
in-place task path is locally verified; unrestricted reorganization remains work to
do before claiming support.

## Relevant guidance

[Tiptap node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views)
separate interactive editor views from serialized content; task nodes can mix editable
text with controls. [BlockSuite block specs](https://blocksuite.io/guide/block-spec)
separate model schema, view and service. Borrow these boundaries within the existing
web handwriting processor rather than importing a new editor framework.

[tldraw's AI integration](https://tldraw.dev/docs/ai) uses simplified data and typed
editor actions. Keep the AI responsible for meaning and the host responsible for
geometry and native editable elements. A skill should carry reusable workflow or
formatting conventions only when measured tests show it helps. Basic task creation
belongs in the existing tool and renderer.
