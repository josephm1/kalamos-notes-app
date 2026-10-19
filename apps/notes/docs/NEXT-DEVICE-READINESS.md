# Before the next device build

1. Update transcription intent: readable words remain unchanged; surrounding context can resolve unclear words. No polishing or paraphrasing unless requested. Preserve drawings/diagrams.
2. Choose and test source references: short fine-grained references with optional line groups; allow partial text conversion without deleting non-text ink. Bind references to the exact exported snapshot.
3. Separate layout intent: default transcription preserves the original ruled row and word order; Notes measures and places words locally; explicitly requested organization can reflow and create supported headings/lists/tasks. Preserve unrelated content and notebook grid behavior.
4. Extend interactive-state merge: compare exported base, current document and AI result. Preserve newer user state for stable elements. Existing task checked state is implemented; define the same contract for future supported controls.
5. Define conflicts: independent state edits merge automatically; simultaneous content changes, removed elements or changed handwriting cannot be silently overwritten. Prefer retaining user edits and the saved AI result without a review/apply dialog. Checkbox-state-only merge and rejection for content/ink/type/deletion conflicts are implemented and tested; future control codecs remain pending.
6. Test with the user's actual device notes: contextual word recognition, punctuation/marks, mixed text/drawings, partial selections and requested formatting. Separate recognition evidence from synthetic validation fixtures.
7. Test iterative editing: process → edit/tick/space/scribble → reattach → process again. Check merged state, element identities, newer revisions, duplicate results and recovery.
8. Run release checks: affected tool/contract/editor/native tests, fresh-build APKs and installed-contract compatibility. Keep thinking on; no experimental skill is installed unless it demonstrates a benefit.
9. Prepare focused device QA after host checks pass: install candidate builds, then test handwriting responsiveness, note switching, old-page flash, Agora return, real thumbnails, interaction state, save/reopen and Undo. Physical acceptance is not established by host tests.

Supported current elements: heading, paragraph, bullet, numbered, task. Future arbitrary HTML/component types are not promised by this checklist; each needs a schema, state and editing contract before merge support.


2026-10-14 host follow-up: compact source-bound formatting and a full two-cycle
To do workflow pass. Newer checkbox ticks merge into actual model results; Undo
keeps the newer pre-AI state. Short generated checklists no longer receive an
invented blank row per element. Source ordering is determined by the editor, even
when tool arguments arrive backwards. Workspace473 and full Android unit suite
pass. Whole test-all remains686/687JS due to the known unrelated Todo credential
packaging check. No new device build installed.

Fresh raw-region recognition still exhausted8192tokens once; a line-reference
experiment succeeded with984outputtokens. User then requested image-only Markdown:
both smoke runs returned valid headings/nested tasks and both became editable
ruled elements locally. A known word(Bananas) was misread as Cucumbers in both
runs; user accepts occasional recognition errors and prioritizes formatting and
low output cost. These are private experiments, not a deployed Markdown result
route: explicit source scope/revision and drawing preservation remain required
when committing handwriting. Do not interpret arbitrary chat Markdown as an
authorized note replacement.


Latest implementation: single submitted handwriting page has a production
Markdown-only route. Agora captures identity/revision/scope; Notes parses and maps
returned text to original ruled rows. No AI block IDs/coordinates or mandatory
skill reads. 505 workspace tests, full Notes/neutral native and 45 focused Agora
tests pass, plus real-note local native/Chromium replay. Existing Markdown replay
still has a known word misread; no new paid recognition run or token claim.
Line count/wrap ambiguity rejects with saved original ink intact. Free-ink
mixed-diagram classification remains a limitation; explicit page objects remain.
