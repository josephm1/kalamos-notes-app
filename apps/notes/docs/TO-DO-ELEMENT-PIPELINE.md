# To do: recognition, grouped elements and Markdown

2026-10-14. Real device notebook “To do”, retrieved read-only through its existing
bridge. Its source, sidecar and page index are retained privately. The device's own
production export was used: logical548×740, raster1096×1480. The notebook contains
13 saved ink regions. No artificial handwriting, no device note mutation, no install.
Thinking remains enabled throughout.

## What changed

- Added optional `parentId` to existing semantic elements, the Agora tool arguments
  and wire model, neutral document validation, local semantic bindings, native
  projection and returned-element verification. Unknown parents, cycles and nesting
  deeper than four levels are rejected. Old flat documents remain valid.
- Semantic layout derives indentation from relationships. Markdown export derives
  nested lists from the same elements; it is an interchange view, not a second owner
  of text or checkbox state. Copies remap parent identities; surviving children of a
  deleted/out-of-scope parent project as roots without losing their content.
- Updated compact transcription guidance: use context to identify unclear words,
  preserve readable wording, do not polish sentences, and keep drawings as ink.
- Fixed a real edge case: a title region has y=-3.47. The production exporter accepts
  such visible ink, but the old materializer rejected it. Visible intersecting regions
  are now accepted and text anchors clamped inside the page; wholly off-page regions
  remain rejected. Original source strokes are not rewritten to fix coordinates.
- Added a pure recognition-formatting compiler in Agora. It validates exact snapshot
  and stable element identity, binds formatting output to the existing recognition
  sources and emits `replace_ink`. This avoids applying `organize`, which would retain
  original ink on extra pages. The compiler is invoked by the existing app tools and the same host harness.

## Tool/skill responsibility

AI output is individual typed elements and relationships, not notebook HTML, CSS,
JavaScript or stroke code. The host resolves provenance and materializes controls in
the existing ruled editor. The page index/template remains owned by Notes.

Recognition is the first job: image → readable words + stable source bindings.
Formatting is the second: known words → headings/tasks/bullets + relationships.
Do not commit the intermediate result during a combined workflow: validate the
original revision, compile the final result and publish one reversible transaction.
The staged host experiment is now wired into the existing production tools; exact
continuation/save verification is recorded in the follow-up section.

A formatting-only skill can hold reusable organization conventions. It should not
repeat provenance validation or renderer rules. Agora's actual SkillManager/read tool
and continuation protocol were used for the candidate; it was not installed on the
device. No global generation or thinking policy changed.

## Observed results

| Experiment | API time | Input tokens | Output tokens | Result |
| --- | ---: | ---: | ---: | --- |
| Faithful image transcription | 19.36 s | 3,777 | 3,875 | 7 blocks; all 13 regions |
| One-pass image → flat checklist | 24.88 s | 3,801 | 4,096 | Thinking exhausted limit; no tool |
| One-pass checklist with short fine references | 25.03 s | 3,202 | 4,096 | Thinking exhausted limit; no tool |
| Format recognized text, direct tool | 14.32 s | 2,240 | 2,784 | Heading + 6 flat tasks |
| Formatting-only skill, read + continuation | 10.57 s | 5,105 summed | 1,925 summed | Flat tasks; retained arrow marker |
| Format recognized text with grouped contract | 8.21 s | 2,340 | 1,656 | Heading, 3 tasks, 3 nested bullets |

One sample per variant. Cache-hit rates vary. These are API times, excluding local
preparation. The two-stage recognition+grouping total is about27.56s and5,531 output
tokens; it is not cheaper than the failed one-pass request, but it completed. The
formatting-only skill showed a promising output/latency difference in one comparison,
with more total input. It is not established as a general efficiency gain.

The grouped result placed eggs and bananas under “Buy - Milk”, and the arrow-linked
follow-up under “Make a New song”; “Go to Ikea” remained independent. This interpretation
matches the visible indentation/arrow in the saved page. The AI read the final word as
“guitar”; user confirmation is pending. Do not silently substitute a different word
based on a voice-transcript ambiguity. Parent relationships are now persisted rather
than being represented only by spaces or inferred anew during every AI pass.

## Verification

The real Agora projector/provider serializer/parser/tool were used. Grouping was
compiled into an in-place transcription through the tested helper. Actual workspace
materialization produced ten text/control boxes with zero retained converted ink.
Native save/reopen preserves text, task state and parent IDs; duplicate delivery
does not mutate; Undo restores exact original pages. A host test supplies the actual
device page-index metadata and verifies ruling/template fields survive the commit.

Workspace full tests and generated bundle/typecheck passed; focused Agora and neutral
document tests passed, including group validation and binding rejection cases. Native
grouped fixture passed. Fresh candidate builds are prepared separately; they do not
constitute panel acceptance or completion of app-level staged orchestration.

The initial host editor preview omitted the `.vanilla-app` theme wrapper and therefore
showed no ruling. Corrected previews use actual editor CSS/theme; this was a host-view
mistake, not evidence that the device notebook template was removed. The separate
Markdown styling preview also retains ruling, but its bold title is a styling
experiment, not claimed to be the current ruled editor's typography.

## Remaining before device readiness

1. Improve staged recognition reliability/efficiency at the actual configured output
   limit. Production multi-pass tools are wired and exact continuation has passed.
2. Extend state merge when new supported interactive components are introduced;
   existing checkbox-state three-way merging is implemented and tested.
3. Extend inline rich-text styles with matched measurement/editing contracts. New
   headings already share host-generated bold typography and geometry across renderers.
4. Exercise two-cycle editing and grouped content through checkbox taps, scribble,
   spacing, save/reopen and another AI request. Expand actual-device note cases for
   drawings, source coverage and ambiguous words. Physical panel QA remains separate.

## Guidance

[Agora skills](https://newo-ether.github.io/Agora/skills/) use compact catalogs and
on-demand bodies; [tools](https://newo-ether.github.io/Agora/tools/) carry calls/results
through multiple passes. Keep data/validation in the tool and reusable conventions
in an optional skill, measured independently.

[Tiptap task items](https://tiptap.dev/docs/editor/extensions/nodes/task-item) support
nesting as editor structure. [BlockSuite block specs](https://blocksuite.io/guide/block-spec)
separate models, views and services. [ProseMirror's community discussion](https://discuss.prosemirror.net/t/using-replacearoundstep-to-convert-bullet-list-to-todo-list/3545)
emphasizes transforming nested list types while keeping each intermediate document
valid. These support a small typed hierarchy in our existing editor, not asking AI
to rewrite a webpage or adding a replacement editor framework.

Private evidence and previews: `artifacts/to-do-processing-2026-10-14/`. Never publish
the original note, rendered image or exposed external-provider logs without permission.

## Follow-up: production staged tools and interactive state

The next implementation wires the compiler into Agora's existing tools. Recognition may
set `deferToFormatting=true`; its uncommitted result exposes stable IDs/text and a
`recognitionProposalId`, with no apply-capable structured result. The formatting tool
loads conversation-bound private provenance and returns one final `replace_ink` result.
Retry identity is shared with the staged recognition. No new tool or installed skill.

Notes now prepares and commits with the same native state-conflict checks. A newer
checkbox tick is retained while independent AI content changes apply; Undo restores
the current pre-AI state. Changed text/ink/geometry, removal or conversion of a locally
changed task, and unknown control states still reject. This is existing checkbox
support, not arbitrary HTML-state merge. New control codecs must be explicit.

New headings use persisted host-generated weight700 with the same ruled size/baseline.
Measurement, wrapping, hit boxes, editing, thumbnails and SVG export share that weight.
Older annotations retain their original font/positions. Inline rich-text spans remain
unimplemented; a Markdown export is not a promise of arbitrary Markdown rendering.

The exact continuation test initially produced HTTP400 because the host harness omitted
`includeAssistantReasoning`, which production Agora already sets for thinking DeepSeek
tool runs. Corrected test configuration preserves prior exposed reasoning. No production
provider setting or global thinking policy was changed to work around this error.
See private `production-staged` and `production-staged-protocol` evidence and the
current handover entry for final test/build status.

## Named exports and repeated tests

The exported file is now based on notebook title (`To do.notes.zip`), in a separate
private request directory so older attachments are never overwritten. Rename affects
the next export. Notes validates filename collisions on shelf rename and generates
numbered names for creation/import; comparison includes case and Unicode normalization.
Revision/element identities remain private contract data, not exposed file names.

Host fixture now uses the real notebook name instead of Host note. Repeated normal
user requests, thinking ON/4096cap: earlier full guidance failed; compact guidance
first19.324s/3688output succeeds all13refs, second22.176s/4096partialJSON fails.
Fine-region short-label prototype12.731s/2264output succeeds references but reads
Bananas as cucumbers; do not adopt it from speed alone. These are real user ink images.

Formatting continuation also exposed a guidance/contract mismatch: generic new-block
support conflicts with staged exact-ID binding. The initial tool/result required the exact block set. The follow-up below replaces
that limitation with host-bound source references for added semantic elements.

Actual returned To do page passes Chromium checkbox/scribble/Undo/spacing/checkpoint/
reopen/groups/heading tests; reusable tools/verify-elements-editing-host.mjs runs the
real PenWorkspace on supplied source/sidecar. Native repository then saves edited
content, reopens the tick, changes revision, ignores old duplicate delivery and exports
the edited immutable note. Private evidence iterative-edit-tests/. This is host testing,
not physical input or panel acceptance.


## Deterministic word units and compact staged formatting

The existing sidecar already holds authoritative text, character ranges and measured
word placements. Reuse it: no new DSL, per-word AI objects, second text owner or
replacement editor. Markdown remains a derived portable export. The AI supplies
text, element type and optional parent relationship. Notes measures and wraps words
with the actual font, records their ranges and owns gestures, controls and persistence.
This follows the separation demonstrated in [MyScript JIIX](https://developer.myscript.com/doc/interactive-ink/3.2/reference/web/jiix/)
and [tldraw's agent](https://tldraw.dev/starter-kits/agent); it does not adopt either
project's wire format as a replacement notebook format.

Ordinary transcription uses the original ruled row and word order, with natural
left positioning after any retained earlier content. It need not reproduce handwriting
x coordinates. Explicitly requested organization may use subsequent ruled rows.

Staged formatting supplies only recognitionProposalId, blocks and optional title.
The host retrieves document/revision/page identity and original ink bindings. Existing
recognized IDs remain present; an added or split semantic element references one
recognized block through sourceRefs. Identical source groups can supply multiple
elements and are consumed once. Different overlapping groups and unknown/unbound
references reject before writing. This supports a Buy heading and separate Milk task
without asking the AI to reconstruct stroke arrays or notebook code.

Select now moves deterministic typed word ranges through the existing web pen and
completed native-stroke paths. Wrapped fragments of one word move together. Moving
keeps canonical wording intact; it changes placement, not textual reading order.
Existing layout collision handling still applies. Cancel makes no history entry;
Undo and saved word placements use the existing editor mechanisms.

Real To do result, production CSS and Chromium hit testing caught a text-box overlay
that stopped pen presses before reaching word selection. Corrected the plain-text
Select event path while retaining control/finger handlers. The browser verification
now passes tick, scribble, Undo, line spacing, one-word movement, movement Undo,
checkpoint/reopen, groups and heading styling. Model tests separately cover native
Select, horizontal spacing, cancellation and long wrapped words.

The denser split result exposed a nearby Edit button over part of a word. Select
now shows non-template controls only for the active text block; plain content can
be selected by pen or click. The rerun targets the actual Milk word and passes.
Moving after blank-line insertion also exposed mixed pre/post-spacing coordinate
bases. Movement now bakes all text placements in the same current basis, preserving
neighbors and ticks; an adjacent-block regression test covers it. Actual Chromium
preview was inspected after save/reopen. Physical UI acceptance remains pending. No Bigme daemon, refresh or snapshot policy
changed. Browser tests do not establish physical pen/panel acceptance.


Live follow-up: the actual recognized To do content was formatted with thinking ON
and an explicit host diagnostic cap of8192. One request completed in9.047s with1873
output tokens(1290 reasoning), returning Buy as heading and Milk/eggs/Bananas tasks.
The added Milk element used one recognized source reference; no HTML, CSS or word
geometry was emitted. Real provider/parser/tool replay, Chromium materialization
and native apply/reopen/template/duplicate/Undo all passed. Fourteen editor boxes
include host-generated checkbox controls; all converted ink was consumed. This is
a formatting test using earlier real-note recognition, not a new recognition accuracy
result or proof of repeated reliability/skill savings. No experimental skill installed.
Private evidence: word-unit-tests/. Workspace471/typecheck/generated assets pass.


## Image-to-Markdown smoke experiment

User asked to try an image plus a simple formatting prompt, accepting occasional
recognition mistakes if formatting/editability is right. Exact device image,36-word
prompt, no tool/region metadata. Two thinking-enabled high-effort runs returned
standard headings and nested GFM tasks:15.252s/1086input/2434output, then2.905s/
1086input/206output(896cachedinput). First output includes2373reasoning+61Markdown;
repeat152reasoning+54Markdown. Host-only low-effort(still thinking enabled) trial:
2.860s/1086input/220output(165reasoning+55Markdown),no cache hit. All three read
Bananas as Cucumbers; low-effort also reads finalguitar asguitars. No accuracy
improvement claimed. These small uncontrolled samples do not guarantee latency
or output budgets. Provider settings in Agora remain unchanged.

Host-only adapter uses existing unified/remark-parse/remark-gfm and the production
semantic materializer. Both original Markdown answers render on one ruled page and
pass actual editor checkbox/scribble/Undo/spacing/wordmove/reopen/groups/heading
checks. Original ink is not consumed: image-only Markdown has no provenance bindings.
Inline emphasis/strike is reported as flattened, not supported styled spans. No
automatic Markdown response route installed; arbitrary chat Markdown must not
become an authorized notebook replacement.

Standard Markdown export corrected after this experiment: heading ancestry sets
ATX depth, list ancestry sets indentation. Tasks under headings no longer become
accidental indented code. Existing text/state remain authoritative.

[olmOCR](https://github.com/allenai/olmocr) uses image-to-Markdown document output;
[community handwriting workflows](https://www.reddit.com/r/ObsidianMD/comments/1tk6ozz/convert_handwritten_notes_pdf_or_image_to/)
report the same pattern. These support testing standard Markdown, not adopting
their recognizer or promising its performance. [DeepSeek's thinking documentation](https://api-docs.deepseek.com/guides/thinking_mode/)
supports lower effort with thinking enabled; this was an isolated host experiment.
Private evidence word-unit-tests/image-markdown-smoke/; the original input and
provider records are gitignored.


## Standard inline Markdown marks (2026-10-14)

Prompt experiment keeps the original instruction and appends: “You may also use
standard Markdown styling such as bold, italics and strikethrough where useful.”
The prototype prompt is Agora delivery/notes-markdown-prompt.txt, not a deployed
automatic Markdown response route. Test on exact user image, thinking enabled/
host low effort: appended variant2.945s/1108input/228output, but invented Potatoes
and Oranges; record failure rather than mistake it for improved recognition. An
earlier rephrased styling prompt4.149s/1101input/241output produced bold paragraphs
and flattened task intent. Neither proves reliable formatting choice from one run.
No global generation settings changed.

Notes now supports compact inline bold/italic/strike marks over authoritative text
UTF16 ranges. Existing word placements remain the gesture units even for marks
inside a word. Standard remark/GFM parse+maintained Markdown serializer resolve
syntax; the model need not emit ranges, HTML, CSS or word geometry for the Markdown
route. Existing semantic-wire optional styles preserve marks across further tool
round trips. Supported subset: headings, paragraph/list/task structure and bold/
italic/strike. Explicit links, HTML, inline code and images reject in this importer
instead of silently claiming arbitrary Markdown support; bare URLs remain text.

Font metrics share mark runs with DOM, canvas thumbnails, SVG export and Zoom
context. Strike is presentation, never task state. Deletion shifts/clips marks,
pagination clips/rebases them, movement leaves them attached to text ranges. The
existing styled-text textarea displays derived inline Markdown and reparses it
into text/marks; invalid unsupported markup does not publish an edit. Save and
Undo retain text/styles/positions together; old unstyled boxes retain literal
editing behavior. Native exports join continuation marks and strip list prefixes;
apply validates actual text/marks against the proposal.

Actual model bold output rendered and inspected. It passed native organization
apply/reopen/duplicate/Undo using host-bound revision metadata. This confirms
style transport, not automatic image-to-Markdown source authorization. Separate
styled interaction fixture based on existing To do wording exercises bold, italic
and strike with checkboxes: real Chromium tick/scribble/spacing/movement/Undo/
reopen assertions pass. Fixture formatting is deterministic test data, not a new
recognition sample. Workspace499 tests/typecheck/generated assets pass, full Android
unit suite and focused Agora checks pass. Full test-all still686/687JS with known
unrelated Todo ZAI credential check. New builds are prepared; no install/physical
acceptance. Private evidence image-markdown-smoke/native-styled-result and
editor-styled/styled-editing-check.


### Recognition vs presentation investigation

Saved exposed provider record for the added Potatoes/Oranges run already reports
those as visible handwritten entries before generating Markdown. Exact image
bytes match originaldevice-page.jpg. Thus additions occurred in model recognition,
not Notes parser/editor or a stale image; records do not prove a deeper causal
mechanism. Surrounding shopping context could bias recognition, an inference only.

A63-word prompt separating literal wording/order from Markdown styling yielded
three shopping entries(no addeditemcount) in two low-effort thinking runs:2.601s/
1126input/194output and4.975s/1126input/702output(896cachedinput second). Both retain
nested Dave item under song, but Bananas misreadBolognese/potatoes. This improves
observed item-count behavior, not proven semantic fidelity. Separate group-label
clarification tested next. Keep word recognition independent of presentation.


## Production simplification, 2026-10-14

Single submitted handwriting pages use a minimal Markdown output tool. The model
receives the page image and compact context; no schema of per-word blocks, UUIDs,
geometry or ink refs. Host admission owns the immutable binding. Notes parses
GFM headings, paragraphs, nested lists and tasks, and inline bold/italic/strike,
then maps ordered text to the frozen source rows and runs normal editor/native
commit. Split label/item can stay on their original row; the model never lays out
words. Explicit page objects, template, save and Undo paths remain unchanged.
Mixed free-ink drawings and arbitrary line-count changes are not solved by this
ordinal mapping; mismatches fail without deleting original ink. No new paid
model evaluation has been run for this contract; local replay is integration
verification only, not recognition or token evidence.
