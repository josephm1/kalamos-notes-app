# Short selection references: host experiment

2026-10-14. Tested on this computer with thinking enabled. No APK was installed,
no Agora generation setting changed, and no experimental skill entered the device.

## Source data

All live recognition comparisons use the user's actual saved handwriting from the
device. The page image was rendered from those strokes using the production Notes
renderer. No artificial handwriting was supplied to the model. This is one page
tested repeatedly, not six distinct handwriting samples.

Synthetic fixtures are used separately for validation and element behavior. They
are not counted as handwriting-recognition evidence. A local device backup also
contains twenty non-empty saved ink pages across nineteen notebooks; its private
inventory is recorded for the next broader corpus. Those pages have not yet been
run through this AI comparison.

## Prototype interface

`features/writing/workspace/tools/ink-selection-experiment.ts` groups exported ink
regions using saved editor baselines. Ten regions become four labelled lines. A
split word is therefore included in its line without requiring the model to join
stroke fragments. The local binding records the exact document revision, selected
pages, member regions and bounds. Only short labels and line bounds are exposed to
the model.

Agora's test-only `NotesSelectionExperiment` derives a candidate schema from the
existing tool definition. The AI returns `sourceSelectionIds`. The adapter validates
the immutable snapshot and expands these labels into exact `sourceInkRegionIds`,
then executes the real Notes tool. Its output follows the existing production
materializer and native commit path. The production tool/wire contract has not been
replaced by this experiment.

The actual Agora attachment/payload/projector/provider serializer and SSE parser are
used. Only the experimental selection projection/schema/expansion are new. This
comparison tests a combined simplified interface: grouped references, a compact
catalog and a shorter description. It does not isolate short labels alone.

## Results

Three live runs per direct variant, alternating controls and selection tests after
the initial pair. All thinking enabled with the same output limit. Same user image
and request. Cache rates and response timing varied; this is preliminary evidence,
not a statistical benchmark.

| Direct interface | Mean input tokens | Mean output tokens | Mean API time | Reference coverage |
| --- | ---: | ---: | ---: | --- |
| Existing region references | 3,259 | 2,016 | 10.74 s | All 10 regions in 3/3 |
| Short line selections | 2,392 | 1,533 | 9.96 s | All 4 lines → all 10 regions in 3/3 |

Selections used approximately 27% fewer input tokens and 24% fewer output tokens.
Mean API time improved approximately 7%; individual timings overlap. Both interfaces
covered all sources in this small direct comparison. A selected whole line expands
to all its member strokes, preventing an omitted member such as the earlier missing
“brown” reference. Wrong selection choice is still possible and not solved by labels.

Recognition remained variable: “He” versus “the”, capitalization changes, and one
selection run read “ove” rather than “over”. This interface does not establish better
recognition accuracy. No human ground-truth labels were assumed for ambiguous words.

All three selection outputs passed replay through the real parser, experimental
adapter and production Notes tool. The first also passed production Chromium
materialization and native save/reopen/duplicate/Undo: four editable blocks, no
unconsumed converted ink, same page, and exact original restoration.

## Skill continuation

A shorter experimental skill was read through the actual SkillManager/read tool and
actual provider continuation protocol. The read round took 1.62 s and 60 output
tokens. The continuation spent 26.33 s and the full 4,096 output tokens on exposed
reasoning, hit the limit and produced no tool result. The real provider reports this
as a truncation error. An expected-error replay test verifies that no Notes tool
call occurs; it is a failed conversion, not a successful result hidden behind a
passing schema test.

The exposed logs show repeated reconsideration of the ambiguous reading and whether
lines should be combined. More reference instructions would not demonstrate a fix
for this. No skill or thinking-budget change is recommended from this attempt.

## Tests and implementation limits

- Four host grouping tests cover same-line fragments, tall strokes, separate pages,
  unknown/duplicate regions and rejection of unsettled, scaled or off-grid data.
- Actual tool tests reject stale snapshots, unknown labels and repeated selections,
  and verify expansion into exact original regions.
- Workspace typecheck and focused13 grouping/transcription/gesture tests passed.
- Native host apply/reopen/duplicate/Undo passed.
- Final focused Agora checks include the expected token-limit failure path. A failed
  truncation response is recorded with no proposal; it is never applied.

Two Gradle invocations initially collided on shared report files. They were rerun
sequentially; no AI request needed repeating because its raw response was retained.

The line prototype deliberately rejects unsupported geometry. It also operates on
whole lines: when only part is readable, leaving the line unchanged retains readable
ink too. A real integration needs short sub-selection references for partial edits,
explicit distinction between preserving layout and reorganization, and stable export
bindings across cancellation/retries. Use more of the user's notes before adopting
the contract. Keep these protections in code rather than adding lengthy prompts.

Private evidence: `artifacts/notes-vision-smoke-2026-10-14/selection-comparison.json`,
`selection-direct/`, `selection-region-control/`, `selection-skill-next/`, and
`selection-native/native-verification.json`. These contain actual user note data and
provider logs and must not be published as public fixtures.
