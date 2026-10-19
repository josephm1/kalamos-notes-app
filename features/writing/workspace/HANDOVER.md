## 2026-10-16 — Eggs trailing-caret correction, awaiting physical acceptance

- Reproduced 18 failing cases: after the last word, horizontal target search returned nothing.
- End-of-row caret now owns the last non-control word for both signs. Existing safe-gap pressure
  and clamps apply; no translation of unrelated preceding words and no checkbox targeting.
- Added 19 cases (620 pass total); retained earlier-row assertions in four updated trailing-caret
  tests. Browser backward/reversal/clamp/history/save checks pass. Bigme/Standard builds and native
  unit checks pass. Root suite retains unrelated Todo credential failure. No physical gestures run.
- Evidence/builds: artifacts/notes-trailing-caret-2026-10-16/verification.md. Installation pending
  current saved/closed confirmation. Plan and audit distinguish browser proof from device acceptance.

## 2026-10-16 — Further work: eggs trailing caret cannot subtract space

- Captured a read-only device screenshot: caret after typed eggs, wide gap toward handwritten hello,
  checked control to the right. User reports backward drag does not move eggs. No device gesture run.
- Added a high-priority unresolved item to NOTES-SPATIAL-LAYOUT.md, including exact edge/after-word
  contacts, fresh versus reopened handles, checkbox exclusion, mixed content, reversal/history/save
  and browser/native-contract then user-owned Bigme acceptance. This differs from the previously
  verified inside-word X contact. Audit report now explicitly records this coverage gap.
- Documentation only; no editor change, APK build or installation. Evidence:
  artifacts/notes-spatial-architecture-2026-10-16/eggs-trailing-caret-error.png.

## 2026-10-16 — Spatial layout audit and collision-pressure architecture

- User rejects the earlier whole-suffix change. Captured the open-device report read-only and
  reproduced two concrete failures before refactoring: spare room moved distant X; right-half X
  contact excluded it during subtraction. See work/spacing-architecture-2026-10-16/reproduced.log.
- Plan/audit: docs/architecture/NOTES-SPATIAL-LAYOUT.md and NOTES-SPATIAL-AUDIT-2026-10-16.md.
- Added one pure spatialLayout engine: collision-pressure horizontal +/- with compact followers,
  iterative whole-word carry, explicit paragraph overflow protection, vertical row/bounds constraints,
  condense with deliberate breaks/indentation, and shared rigid-selection constraints.
- Removed computeLayout's gap/line replay, hidden-content sets/filters and active coordinate-basis
  dictionaries. Spatial transactions capture once and commit positions. Handle reuse requires the
  exact document version/width; newer writing invalidates old snapshots. Pending samples settle on
  save; cancel/mode change/resize restore baseline/history/redo. Rendering no longer mutates task state.
- Same atom adapter for spacing/condense preserves ranges/styles/vectors. Bound task controls follow
  owner rows; unbound row controls shift vertically but stay outside horizontal/condense word flow.
  Free drawings/object-local ink remain independent. Richer attachment semantics remain explicit work.
- Retired gapBasis/lineBasis/scopedInkIds model fields; a tested load normalization discards obsolete
  transient dictionaries while preserving prior coordinates and styles. No sidecar version change.
- 601 workspace tests/45 files, TypeScript, generated bundle, boundaries and whitespace pass. Bigme
  build plus 133 native cases (one existing skip), Standard build/aggregate unit checks pass. Nine
  reader/KOReader tests pass. Root all-tests reaches the existing Todo credential-contract failure
  (296/297 app/content pass); no Todo change.
- Browser Hello +200 leaves X at824; +640 moves X only to833.6; inverse restores exact positions.
  Right-half X contact moves it -200 and clamps at17.6 safe gap. Wrapped +1100 handle reverses exactly;
  vertical +88/-88, save/reopen, Undo/Redo, mixed lasso +100/+44 with accurate bounds and cleared SVG
  transforms, mixed condense and intentional paragraph breaks verified. Repeated condense uses no
  extra Undo entry. Browser console errors empty. Fixtures saved; physical acceptance user-owned.
- Final APKs/logs: artifacts/notes-spatial-architecture-2026-10-16. Bigme SHA256:
  22b0391ee529ccadda77ebde180de9fa0c488368ab801ed89069d1b42b2c8c58.
  User confirmed the note saved/closed; adb install -r succeeded. Installed APK SHA256 matches the audited Bigme build.

## 2026-10-16 — Natural bidirectional spacing

- Reviewed Stylus Labs Write at 401b65d5fe0294cc83171b76a0273b6df3afc979:
  scribblearea.cpp MODE_INSSPACE* selects once and uses an absolute baseline;
  selection.cpp reflowStrokes stages whole-word wrapping. Independent implementation, no copied code.
- Horizontal +/- now translates the same right-hand suffix equally, preserving its internal gaps.
  Closing stops at the preceding word/page edge; no backwards wrapping of left-side words. Whole-word
  forward overflow remains. Removed opportunistic backfill of unrelated intentional following rows.
  Source text words use the same atomic outer-edge caret snapping as text boxes and handwriting.
- Vertical contact starts at zero; taps preserve layout/history. Removed free-ink packing on contact.
  Vertical closure is limited by preceding occupied rows and never conceals or deletes content.
  Stored spacer amounts/handles use actual constrained motion. Small horizontal edits no longer snap
  back at pen-up. Only a hit on the active visible handle reopens an earlier spacer.
- Cancel restores the entire document, history depth and prior redo chain. Unchanged gestures create
  no Undo entry. Removed obsolete packing/inverse/leftward-wrap paths; shared native handoff unchanged.
- 568 writing tests pass, with nine new gesture regressions and revised expectations for the deliberate
  behavior changes. Live RAF preview covers overflow then reversal. All 24 mixed +/- permutations,
  movement, Undo/Redo, save/reopen continue passing. TypeScript and generated bundle pass.
- Browser: contact stays still; +100 horizontal moves mixed suffix exactly, reversing restores exact
  geometry; vertical +88 and -88 restore exact geometry; excessive vertical closure preserves all
  words and stops at prior ink; -50 horizontal moves right-side ink with typed words stationary;
  saved/reopened coordinates match exactly. Final example saved as Natural spacing check.
- Bigme build/native checks pass (133 cases, one existing skip); Standard build/aggregate checks pass;
  nine reader/KOReader checks, boundaries and whitespace pass. test-all reaches the existing unrelated
  Todo embedded-zai-contract credential expectation failure (296/297 app/content pass). No Todo edit.
- After user confirmed saved/closed, Bigme install-r succeeds; installed APK SHA verified:
  bf5be92b59af105737d24b1602792ca7f45a11064bee25784b6e4881b53f302b.
  Physical pen/e-ink acceptance remains user-owned. Both APKs/logs: artifacts/notes-natural-spacing-2026-10-16.

## 2026-10-16 — Mixed movement and spacing transaction audit

- User screenshot shows selected eggs inside the box and handwriting displaced to the right.
  Reproduced with real pointer down/move/up: retained SVG keeps preview transform after final left/top
  are committed. Clear pending transform on authoritative overlay reconciliation (also Undo/cancel).
- Saved/moved text-box word coordinates now bypass insertion admission. Replaying insertTextFlow on
  every layout moved selected text independently of selected ink and changed reopened placements.
  New/edited text still enters insertion flow; explicit group movement preserves relative geometry
  and unselected object positions. Reflow is owned by spacing/paragraph edits rather than free moves.
- currentGapBasis retains signed widths. Negative spacers previously recorded zero, causing the
  same negative delta to replay after move/new ink. Materialized text cannot be backfilled by an old
  gap already included in its coordinate basis; previously a downward move could jump text back up.
- Added 39 interaction regressions: same-row mixed collision/drop, signed-space movement, pointer
  cancel, page edge, repeated drags, DOM SVG+box bounds and all 24 permutations of +/- horizontal and
  +/- vertical space followed by movement, Undo/Redo and save/reopen. Five original reproduction
  failures and additional signed/collision failures captured before fixes in work/layout-audit-2026-10-16.
- 559 workspace tests, TypeScript, generated bundle, Notes native/runtime/Bigme native checks, Standard
  aggregate Android checks and both APK builds pass. Reader/KOReader 9 checks pass. Root test-all
  passes Writing then stops at the existing Todo embedded-zai-contract environment credential
  expectation (296/297 app/content pass). No Todo change. Boundaries/whitespace checks pass.
- Browser checks repeated group moves, solid ink inside box, +/- horizontal and +/- vertical space
  restoring original positions, followed by saved/reopened coordinates and another group move.
- Reference-only source review: styluslabs/Write commit401b65d5fe0294cc83171b76a0273b6df3afc979,
  selection.cpp Selection::resetTransform/commitTransform/reflowStrokes and scribblearea.cpp move/
  insert-space handling. Useful principle: pending transform separate from committed coordinates,
  selector bounds follow same transform, staged reflow. No upstream implementation copied/imported.
- User confirms note saved/closed. adb install-r succeeds, installed Bigme APK SHA matches
  b104d2e0bccb9dc9116c3dc5f88c0a8127e5ae3b1b8273d7a0df279c7a73317f.
  Physical device testing remains user-owned. Evidence/artifacts: artifacts/notes-layout-transactions-2026-10-16.

## 2026-10-15 — Selection box and interactive movement correction

- User device screenshot confirms selected handwriting rendered as broken dashes. Root cause:
  Write2Native.redrawInk mapped selected ink to the lasso d flag. Removed that mapping: original
  stroke vectors/brush/width stay solid. One separate solid DOM rectangle bounds the full selected
  typed/ink group; no per-word/per-ink selection outlines. Rectangle and objects preview together.
- Completed selection enters interactive movement mode. The native adapter interprets the entire
  batch under its original lasso owner, then uses existing detachInkBoxForWeb/setInteractivePanel
  handoff. It preserves any pending flush-before-toolbar action. No hard clear or delayed native
  re-enable after this transition. Group movement uses pointer events, including empty space inside
  its selection box. Toolbar glyph changes from Lasso to Move. Lasso menu > Select words explicitly
  starts fresh native dashed capture; Write resets selection and resumes the normal ink path.
- 520 workspace tests, typecheck and generation pass. 91 Notes JS checks, Bigme Notes/runtime/provider
  unit checks, Bigme and Standard Notes builds, boundaries and diff whitespace checks pass. Browser
  verifies one box, solid ink, mixed movement and Move help text; native contract tests prove whole
  batch routing, no dashed selected replay, web detach, no re-enable and pending action preservation.
- User confirmed note saved/closed before installation. Bigme update installed with install -r,
  no data clear or agent device UI testing. Installed SHA-256 verified:
  28d15404cf140b9e966a2f68a761b4e9c88d9c390be7ee9a9bcceaabc288a051.
  Physical latency/panel acceptance remains user-owned. Evidence: artifacts/notes-selection-fix-2026-10-15.

## 2026-10-15 — Notes mixed word blocks and paragraph-aware condense

- Canonical Writing now lassos typed text-box word ranges alongside whole handwritten word clusters.
  Mixed selections move/copy/delete through shared toolbar and popover actions; styles/ranges and
  independent copied vectors survive. Ordinary paragraph frames no longer intercept word gestures.
- Saved/moved text words enter collision layout individually, preserving interleaved handwriting.
  Condense uses visible mixed reading order and preserves short source rows (<65% paper width),
  blank-row boundaries and explicit typed breaks while closing other gaps. Ink body lanes use
  freeInkLaneIndex. Explicit condensed source-word positions participate in Undo and existing save
  output; no sidecar version change. Geometry heuristic still needs the user's real writing review.
- Existing Bigme selection pen/dash implementation retained. Selection pen-up uses 60ms idle rather
  than ordinary writing's 900ms. New pen-down still cancels delivery. Native snapshots union old/new
  selected text rectangles with trail/changed vectors, through the existing bounded capture path.
- 517 Writing tests, typecheck, generated bundle, 91 Notes JS checks, boundary checks and 9 reader/
  KOReader integration checks pass. Bigme Notes/runtime/provider unit tests: 133 total, 1 existing
  skipped Notes check, zero failures. Standard aggregate Android unit tests and Notes builds pass.
  Root test-all stops at existing unrelated Todo embedded-zai-contract environment-credential
  expectation (296/297 app/content checks pass); Todo source left untouched.
- Browser: individual typed move, horizontal gap + Undo, vertical two-row gap, short-row condense,
  closed typed/mixed lasso, same-delta mixed move, copy/delete of both kinds, and save/reopen verified.
  Proof and logs: artifacts/notes-word-blocks-2026-10-15; task outputs include screenshots/report.
- Bigme update installed with adb install -r, no data clear or launch/device UI testing. Installed APK
  SHA-256 matches 3d4567f7661b557b8c6318a537104463551e92c49bc6e09f716d19fd55207e01.
  Physical pen/panel acceptance remains user-owned; generic Android build is not installed on Bigme.

## 2026-10-11 — Faster scribble delivery installed

- User asks to shorten scribble trigger time. Native completed strokes previously waited the normal 900ms idle before reaching the web detector. New neutral StrokeFlushTiming schedules likely retracing strokes at 60ms. Cheap pen-up-only longer-axis reversal/extent/travel hint; no per-MOVE work, point copying, geometry deletion or alternate detector. Regular handwriting retains 900ms, disk saves 2500ms, and new pen-down cancels the scheduled flush as before.
- Hint is scheduling only: existing JS detector remains authoritative for handwriting safeguards, repeated contact, whole-word grouping and neighbour intent. Existing targeted erase refresh/capture and daemon attachment policy remain unchanged. Numeric inkGestureFastFlush logs enable subsequent device timing checks. This removes 840ms of scheduled wait for matching gestures; not claiming measured physical panel latency or acceptance.
- Foundation native unit tests including two timing scenarios pass; 427 Writing tests, typecheck/generated assets, boundaries and 29 Notes integration/handoff checks pass. Full test-all has the same two unrelated embedded ZAI packaging failures (Notes/Todo; 660/662 Node pass) and does not reach subsequent stages. Bigme APK build/install succeeds.
- Installed artifacts/notes-scribble-response-2026-10-11/notes-fast-scribble.apk, SHA256 3f05bc878f8ea425efbcc55b61d4fe70c680bae104b6009e018a0b727c0fed17, lastUpdateTime 2026-10-11 22:09:48. No physical taps; user reopens Notes to test response and ongoing handwriting latency.

## 2026-10-11 — Lower-effort scribble erasing installed

- User still needs prolonged scribbling. Device telemetry rejected retracing 0.16 then accepted 31 sweeps. Neutral shared detector now allows 0.14 (previously 0.18), retaining minimum backwards distance, repeated ink contact and word-intent filtering.
- A tight highly directional overlapping scrub can activate with three passes/two reversals (four corner samples). Compact scrubs keep four legs but require two sharp turns and travel/extent 2.35 instead of three turns/2.7. Broad short gesture has stricter band/overlap constraints to protect Z and single out-and-back. No pen-move processing, latency or refresh changes; prior bounded erase reconciliation preserved.
- 427 Writing tests pass, including short/rotated gestures, forward drift, dense sampling, ordinary cursive/loops/Z/jitter protection and grazed-neighbour preservation. Typecheck/generated bundle, boundaries and 29 focused Notes checks pass. Broad test-all has the same two unrelated Notes/Todo ZAI packaging contract failures (660/662 Node pass), so later full-suite stages not reached. Bigme APK build succeeds.
- Installed notes-light-scribble.apk on <BIGME_DEVICE_SERIAL>, lastUpdateTime 2026-10-11 21:59:42; SHA256 e8485517723b0cec2d387df1efbb69632105ca870c77acd28ce7bf0307dc0ad3. Logs/build/tests/APK in artifacts/notes-light-scribble-2026-10-11. No device taps; actual sensitivity/false-positive acceptance remains user-owned. Reopen Notes to test.

## 2026-10-11 — Bounded erase reconciliation installed

- User reports erased words require full refresh. Read-only device logs show regional GC16 followed by another full-sheet GU16; root cause is reconcileNativeCommand -> relayout/render -> nested onWorkspaceLayout during the native sync transaction. That callback widens dirty bounds and schedules another frame. Native transaction ownership now suppresses only those synchronous callbacks with try/finally; independent later layout/geometry events remain supported.
- Native erasing lasso now carries the bounded clean-erase rectangle for both removed strokes and discarded lasso trail. Selection/move retains normal regional GU16. Scribble recognition, persistence, live pen latency, capture serialization, waveform constants and attachment lifecycle are unchanged.
- Regression covers nested layout emission and verifies one partial capture/vector staging, no full capture or repeated bake after idle. 417 Writing tests, typecheck/generated bundle, boundaries and 29 focused Notes integration/handoff tests pass. Full test-all stops at two unrelated existing embedded ZAI credential-packaging contract failures in Notes/Todo (660/662 Node tests pass); later stages were not reached.
- Bigme APK build/install succeeded. artifacts/notes-erase-region-2026-10-11/notes-erase-region.apk SHA256 df7b51cd4ca245cae169cc60b641624cba2926c3ba58af07f43372947a6a48bd; package lastUpdateTime 2026-10-11 21:54:26. Before logs/screenshot retained beside APK. No physical taps or claimed panel acceptance; user must reopen Notes and retry erase. Browser cannot validate daemon/EPD ghosts.

## 2026-10-02 attached text-box headers — browser review

User requested both page controls and prompt heading attached above their text boxes, with browser
verification before device deployment. Page Move/Edit/Delete forms one joined full-width strip with
44 px targets. Prompt Insert/Edit heading and textarea share one bordered frame; redundant Text
label removed, helper moved below. Black/white styling retained. Ruled positions and native lifecycle
unchanged. Canonical source built through build:android; 204 writing tests and typecheck pass.

Browser screenshots: artifacts/notes-attached-header-2026-10-02, 572×772, 380×640, 1040×1400,
and 572×420 keyboard-height checks. Focus retained, actions visible; page header/frame widths and
left edge match, joined after drag. Browser preview left visible for user review. No APK built or
installed for this styling revision; device retains notes-text-prompt-2026-10-02 candidate.

## 2026-10-02 dedicated text entry prompt

User rejected the inline floating input. Insert/Edit now opens an opaque black/white text prompt
with a normal multiline textarea, Cancel and Insert/Save buttons (48 px targets), without page
rules behind the field. The entered text returns to the existing ruled word layout and dotted
placement frame. Move control is labelled Move. No native timing/composition code was changed.

Prompt lives outside the reflow surface, retaining Android composing input during resize; background
page/toolbar are inert and the existing overlay exclusion and chrome refresh callbacks cover prompt
open/close. Live drafts remain checkpointable. Cancel/Escape restore original text/word positions;
new cancelled boxes are removed. Pen release activates actions with a compatibility-click guard.

Browser verified insertion/cancellation and 572×772, 380×640, 1040×1400 layouts, plus 572×420
keyboard-height focus retention and visible actions. Typecheck, generated bundle, Bigme APK succeed;
204 writing tests pass. Full Node suite remains 648/657 with nine existing unrelated failures.
Installed com.kalamos.notebook on connected HiBreak with adb install -r; lastUpdateTime
2026-10-02 11:11:34. No physical pen/panel/Android IME acceptance claimed.

Artifact/screenshots: artifacts/notes-text-prompt-2026-10-02. APK SHA256
088c66b2d09ee27c7167eca4bf707b6aff1c4bbcfe441898baf885f907c1dd77.
Microsoft reference checks: Word text boxes (support.microsoft.com/en-au/word/add-copy-or-remove-a-text-box-in-word)
and Xbox keyboard example in Microsoft Learn keyboard-interactions. Prompt is adapted for Android
keyboard and monochrome UI; no copied OS keyboard implementation.

## 2026-10-02 ruled text boxes and expanded-toolbar composition

Supersedes the earlier independent annotation-box behavior. Text boxes now have a dotted outline,
Move/Edit/Delete controls and keyboard textarea editing. Their individual words enter the shared
ruled layout before horizontal/vertical spacing, snap to ruled lanes when dragged, and persist
final word coordinates on commit. Existing optional textBoxes remain readable; schema version
stays 1. Undo, concealment and Collapse account for boxed words. Text baselines follow the rules.

Expanded native mode now composes the complete modal (header, top toolbar, rail and paper),
while writing protection stays confined to the paper. Coordinate offsets cover replay, incoming
ink, scroll, exclusions and dirty refresh rectangles. Existing flush/readiness, cold-wake sequence,
180 ms handoff presentation and bounded partial refresh remain intact. No Kotlin daemon changes.
Astra reviewed this native handoff. Physical disappearance is a candidate fix, not panel acceptance.

Browser QA: 572×772 and 1040×1400; insertion of one ruled line moves typed words by 56 px;
box drag moves words by 40 px horizontally and one lane vertically; save/reload/reopen retains
individual word positions. Larger viewport has no horizontal document overflow. 201 writing tests
pass (including 19 native tests); Android bundle and Bigme APK build. Full suite: 648/657 Node
checks pass, with the same nine unrelated credential/task-schema failures. User performs device QA.

Installed with adb install -r on HiBreak <BIGME_DEVICE_SERIAL>; package com.kalamos.notebook,
lastUpdateTime 2026-10-02 09:59:28. No physical UI interactions. Artifact and browser screenshots:
`artifacts/notes-ruled-text-2026-10-02`; APK SHA256
`1a815783068b0de49b8bcc1be3db1913ca7dfc1f4f63fc0ac322e96b1f59982f`.

# Ruled-writing feature handover

**Updated:** 2026-07-22  
**Owner:** `features/writing/workspace`  
**Device contract:** `docs/devices/bigme/INK-WRITING-GUIDE.md`

## 2026-10-02 responsive Notes refinement

Handwriting popovers now use a 44px Done target, rounded black/white sheets, compact pen settings and width presets without nested scrolling. Pen release activation has movement/cancellation checks and suppresses the following compatibility click even when the sheet has been removed. Existing exclusion rectangles, queued panel snapshots and close-page recomposition remain intact.

Handwriting now offers Blank, Horizontal, Grid, Dotted, Weekly and Cornell paper. Original SVG sources live in `apps/notes/app/src/main/assets/web/templates`; Weekly/Cornell share normalized geometry across CSS previews, WebView thumbnails and native InkSurfaceView. These templates do not enter Planning's separate ruled model. Creation passes name/template before opening, avoiding post-open autosave races. Library navigation now lets App.showLibrary own the single ordered detach/thumbnail sequence.

Planning Insert text now creates a movable annotation box with Move/Edit/Delete, a focused Android-compatible textarea and Done. Optional version-1 sidecar textBoxes retain independent position and text; commits, undo, checkpoint and thumbnails preserve them. IME resize retains the focused textarea. Boxes clamp their displayed horizontal position on smaller screens, preserving saved placement for larger ones. They are independent annotations, not words within the ink reflow sequence.

Astra identified/fixed three vertical-spacing defects: new ink replaying historical negative spacers, mismatched positive inverse membership, and reordered ink inheriting different spacer membership. Stable scopedInkIds plus regression tests preserve intentional upward concealment, native ownership and refresh timing.

Browser QA: 572×772 (six-inch CSS viewport), 380×640 and 1040×1400 creation; 572×500 keyboard resize; browser stylus release closes Done; text drag/save/reopen. Six shelf items on small screens; larger screens retain 3×3/4×4 options and roomier creation cards. 194 writing tests, TypeScript/bundle build and 35 focused Notes tests pass. Bigme APK builds; installed with adb install -r on connected HiBreak <BIGME_DEVICE_SERIAL>, package update time 2026-10-02 09:29:40. No physical UI interactions or claims of panel acceptance.

Candidate: `artifacts/notes-refinement-2026-10-02/kalamos-notes-bigme.apk`; SHA256 `d5d17fb78de1d52b233af34df265c22cc85ea34a59cd394712923368dc79cd7c`. QA/screenshots alongside it. Earlier word-insertion presentation is superseded by the independent annotation boxes.

## 2026-10-02 Notes presentation and text insertion

The Kalamos store accepts host-specific default preferences; Notes Planning uses 56px lines on
small screens and black ink without overriding saved preferences. Insert text reuses word insertion,
ink anchors and undo history. It drains pending native ink and uses the existing Select tool handoff
before showing the WebView sheet; it does not create another ink owner. Select handwriting first to
choose the section, or append to existing text. Expanded tools retain the separate full text editor.

Thumbnail rules are black integer-aligned output rows, two pixels thick at 320px output width, to
survive small shelf reduction. Ink width and crop remain unchanged. Bigme's queued native snapshot
and thumbnail callback remain the close boundary; the completed native preview is then replaced by
the vector renderer when available. No change to native readiness, refresh or detach sequencing.
188 writing tests and TypeScript/bundle build pass. Browser acceptance covers layout and persistence;
physical device acceptance is pending.

## Durable lifecycle checkpoints

`checkpointWorkspace()` is the non-exiting persistence seam for host pause/background events. It
flushes the native ink surface, commits the returned strokes into the authoritative model, and waits
for persistence without firing the workspace exit callback. Hosts must suspend the native surface
only after that promise settles. `finishWorkspace()` remains the exiting equivalent. The Kalamos
entrypoint guards asynchronous pause completion with a lifecycle sequence so a quick resume cannot
be followed by a stale detach.

## Content-bounded Planning thumbnails

Standard Planning now produces its library preview directly from the authoritative placed vector
model at the final 320 x 487 size. The renderer uses the saved rule spacing, pressure-sensitive ink
outlines at their saved pen widths, and a padded content bounding box. Pen widths scale with the crop;
do not impose a fixed output-pixel minimum. The crop preserves the 86:131 card aspect, clamps to page
edges, and never excludes content; an empty model retains the full page. WebView capture remains a
fallback. The host must request this preview after the final save and before destroying the workspace.

## Standard WebView low-latency ink

Standard Android Planning owns ink in the WebView. Do not enable the Bigme daemon for Huion devices.
The live canvas is transient and transparent: request the delegated ink presenter, prime it on
pointerdown, and use application prediction only when no presenter exists. Keep canvas pixel
dimensions unchanged unless layout dimensions genuinely change; assigning `width` or `height`
destroys the context backing store.

During a live Huion trace, pen-down JavaScript was normally 4–13 ms but the Mali driver emitted
`BAD ALLOC` and `GPUAUX Null anb` during canvas/DOM work. The hot path therefore clears only the
previous wet-stroke bounds rather than the complete high-DPI page. Pen-up reconciliation preserves
unchanged `.rw-ink` SVG elements and their paths, rebuilding only inserts whose immutable stroke
references changed. HWR is not a stroke-completion task; it remains explicit behind Convert.

Production diagnostics are intentionally bounded. `DIAG [kalamos-ink] PEN_DOWN` reports idle,
dispatch, draw and next-frame times; `PEN_UP` reports merge scan, model, render, total and next-frame
times. The Android WebChromeClient forwards that prefix to logcat. The user accepted the Standard
Planning new-line latency fix on 2026-09-09.

## Hard-won lifecycle rules

Bigme Planning must retain the attach-time cold-open wake refresh. `skipWakeRefresh()` belongs to
genuinely bounded reader surfaces, not this full ruled editor. Do not infer lifecycle semantics by
testing whether the writing rectangle exactly equals the panel: app chrome makes Planning slightly
inset. That check previously suppressed the wake and reproduced the characteristic state where the
complete restored stroke model was submitted to the daemon but the physical page stayed blank until
small pen invalidations revealed pieces of it. `native.test.ts` deliberately covers an inset ruled
workspace and requires that it does not call `skipWakeRefresh()`.

The Bigme controller also has a firmware-defined rotation dependency: call `updateRotation()` before
`updateLayout()`. The latter builds the transform installed on the daemon canvas by `getCanvas()`.
Layout-first can leave the correct portrait SurfaceView covering a rotated landscape ION buffer;
pen invalidation then reveals vertical rules underneath. The ordering and its JVM regression test
belong in `devices/bigme`, not in this vendor-neutral workspace.

The full editor must not use reader sticky-note teardown. `Write2Native.suspend()` uses the dedicated
hard-clear path: native teardown flushes the daemon, clears retained `InkSurfaceView` strokes/render
parameters and drops old content without running the retired template recompositor. This prevents a
new document from exposing the preceding document's ink buffer.

Attachment rectangles are clamped twice. The TypeScript clamp prevents ordinary fractional-edge
overflow, but it is not authoritative: `window.innerWidth * devicePixelRatio` can itself round one
pixel larger than the real Android host. `InkManager.attachInkBox()` must retain the final clamp
against its measured parent. A 1264-pixel panel previously received 1265; the HiBreak later requested
1073x1449 for a 1072x1448 host. Bigme then logs `invalidate layout rect`, returns false before building
the daemon matrix, and the UI reports “Pen engine unavailable.” Never ignore that false result; fix
the bounds. Keep both the TypeScript geometry tests and `InkBoxGeometryTest`.

Detach can deliver a final daemon batch asynchronously. The scoped `_inkHandler` therefore remains
installed briefly after requesting detach; a rapid reattach cancels that delayed release. Without
this ownership window, a final batch can fall into a different editor's global callback.

## Native/WebView tool handoff

Hard clear is only for leaving or pausing the full editor. Insert Space, Blank Lines, caret, Erase,
Select and keyboard mode use the transient WebView handoff. A previous hard clear painted a white
GU16 frame, hid the surface and exposed a transparent WebView, making the whole workspace appear
blank until a later refresh.

Transient handoff retains the physical frame, clears only transient native state, reveals the
already-rendered workspace DOM and enables fast interactive panel policy. Do not invalidate the
entire WebView or flip its whole background. Returning to Write keeps the DOM as cover until
`onInkControllerReady(true)` presents the authoritative daemon page. The router must forward
`showEditor()`.

Full Planning composition captures the containing modal, including the top bar and left rail, while
native writing bounds remain restricted to the inset paper. Paper-only capture could display the
controls during FAST handoff but lose them on daemon reattach, despite correct Android screenshots.
`nativeCompositionSurface()` separates capture ownership from `nativeInkSurface()`. Replay and input
translate between paper-local model coordinates and the captured composition origin; popup exclusions
and compact chrome refreshes also use that origin. Magnify retains its full-screen composition.

Composition changes retain the `WEB_GEOMETRY_PRESENT_MS` FAST presentation window after hiding the
old surface, including when owner identity changes with identical outer bounds. Preserve readiness,
flush, wake refresh and bounded toolbar sync. Automated regressions cover capture coverage, writable
bounds, scrolled replay/input, exclusions and the delayed transition. Physical acceptance is pending.

## Selection and reverse-caret behavior

Selected handwriting follows the pen in workspace-local coordinates using a DOM-only preview and
commits once on pen-up. Horizontal placement is preserved; only the baseline snaps to the nearest
ruled line. Re-anchoring packed handwriting on every sample makes ink-only words snap to a far-left
flow slot and creates avoidable GPU churn.

Insert Space is directional: dragging right moves only content at/after the caret; dragging left
moves only content before/intersecting it. The other side stays fixed, and reverse movement never
deletes or conceals content. Overflow continues on the previous line, at its far right when empty.
An occupied adjacent row compresses left as needed. If the complete sequence cannot fit, the
crossing is rejected; a single caret never recursively changes unrelated earlier rows.
Use visible row/x order, not creation order. A handwriting run is one atomic word: an internal caret
snaps to its nearer outside edge and must never divide the run's strokes. Row ownership and boundary
detection both use the upper letter body, so a long descender is not stolen by a caret on the row
below. Blank ink-only Planning settles earlier gap transforms into the displayed run coordinates
before adding a distinct caret; this prevents accumulated gaps from reselecting moved words across
rows. A 240 ms comparison of
existing stroke timestamps resolves only ambiguous continuations; a clear return starts a new row.
Release builds log one compact `DIAG planningGap` line per completed gesture, not per drag sample.

## Current verification

- 15 test files / 184 tests pass.
- TypeScript checking passes.
- The classic-script Android bundle builds and is byte-identical to the generated output directory.
- The four monorepo debug APKs assemble with the feature library.

For the 2026-09-09 Standard Planning changes, all 32 Notes integration tests and the Standard Notes
APK build also pass. APK audit found only `StandardDeviceProvider`; the installed APK SHA-256 is
`62a0888f5ca8f51f899723dbee04cb07398a8d4556daddd3c981c5dc80b1191e`.

Physical-device acceptance has not yet been repeated from this repository. The user's prior device
confirmation applies to the imported implementation, not automatically to the new packaging.

Important source areas:

- `src/vanilla/main.ts` — host orchestration and Done/Cancel;
- `src/vanilla/penWorkspace.ts` — tools, layout and native handoff;
- `src/kalamos/entry.ts` — stable app-facing API;
- `src/kalamos/kalamosStore.ts` — notebook persistence adapter;
- `src/kalamos/native.ts` — geometry, readiness and scoped callback ownership;
- `scripts/build-android.sh` — the sole generation boundary.

Preserve comments around native flushes, lost-pointer recovery, direct-mode blank seeding and initial
toolbar state; they document device correctness rather than style.


## 2026-10-07 — Tool pop-outs and editable template sections

Canonical writing source now supplies monochrome Pen/Brush/Marker icons and reflects the
chosen brush on the toolbar. Eraser/Lasso menus use compact icon rows; lasso exposes existing
selection/copy/delete actions, not unimplemented Smart/Free modes from the reference.
Notes toolbar uses separators instead of individual rectangular button borders, including
disabled page controls. Selection still inverts black/white.

Pen, eraser, lasso and shapes settings have no Done button. Outside finger contact dismisses
without starting a page swipe; outside pen contact retains the existing transient WebView
gesture owner until pen-up, avoiding a daemon attachment mid-stroke. Dialog ownership,
exclusions, native flush barriers and regional refresh callbacks remain in place. No daemon
or Android refresh-policy source changed.

Starter text headings (template-* text boxes, excluding checkboxes) open the normal text
editor on tap. First-row confirmation stays below the field rather than off-screen. Width
is edited through the existing text-box resize handle. A thick section-bottom drag handle
uses startLines/finishLines, preserving row anchors, downstream handwriting/text, Undo,
save/export and overflow pagination. Cornell's divider tracks the Summary boundary for
these section drags; other free shapes remain independent. Only the selected template
section exposes handles after tapping a heading. Section height changes remain whole-sheet
ruled spacing, not independent per-column ink reflow. Template IDs are retained on rename.

Verified: 392 Writing tests, 26 Notes integration tests, typecheck/generated Android bundle,
boundaries and Bigme debug build pass. Browser at 572×772: icon brushes, compact/expanded
menus, first-row Done reachable, eraser choice closes, heading editor, section drag moves
Summary by one 56px row and Undo restores it. Physical ink/panel acceptance is user-owned.
Installed successfully on <BIGME_DEVICE_SERIAL>; package update time 2026-10-07 22:57:12.
APK: artifacts/template-previews-2026-10-07/notes-tools-sections.apk
SHA-256: 5360adec4efe8058f801072186c875b28b58553e84b67b7d0cf337f0ef224caf
Screenshots: brush-icons-browser.png, eraser-popout-browser.png, lasso-popout-browser.png,
editable-template-section.png under artifacts/template-previews-2026-10-07/.


## 2026-10-07 — White Shapes with attached handwriting

Reviewed Notes UI shape reference Screenshot_20260707-001740.png and captured device-before.png.
Move/resize/delete now reuse the movable-text SVG icons in a compact attached strip. Shape
chooser removes explanatory copy and uses an accessible Outline checkbox. Closed shapes
default to white paper; outline-only leaves paper visible. Line/sketch remain open vectors.
Toggling Outline applies to the selected shape and future drawing style. Legacy solid colour
fill remains readable, but new paper is white with the chosen stroke colour.

Canonical PageObject owns optional local ink vectors. Write strokes beginning inside opaque
paper go to that owner before ruled word grouping, not to ordinary ink runs. Moving the paper
translates its handwriting exactly; resizing changes paper dimensions without scaling pen
width/text geometry, and minimum bounds prevent shrinking through existing content. Sidecar
validation, Undo, deletion, native strokes, browser fallback, thumbnail and SVG export include
owned vectors. Rule spacing leaves free objects/content independent. Scribble/stroke/lasso
erasers include owned ink; stroke and scribble erasure on paper protect hidden page ink.

Native retained vectors mask earlier ink through closed paper geometry (presentation-only);
saved originals remain available when paper is deleted. This is necessary because native
vectors sit above captured WebView content. Native write completion preserves no-DOM ingestion
and existing flush/attach/partial refresh mechanisms. No device/runtime policy changed.
Browser live canvas sits above opaque paper for the fallback pen trail.

Validation: 398 Writing tests, typecheck, generated bundle and boundaries pass. Full shared
JS matrix: 735/744 pass; same nine existing Notes/Todo personal credential and Play checks
fail, unrelated to shapes. Remaining test-all stages run separately: Reader 1, KOReader 21
and Standard Android unit-test Gradle tasks pass. Bigme Notes APK build passes.
Browser 572×772: white paper masks rules, icon controls, free stroke drawn inside and moved
with paper, Outline checkbox/menu. Screenshots under artifacts/sticky-shapes-2026-10-07/:
shapes-menu.png, sticky-shape.png, device-before.png. Physical panel acceptance is user-owned.
APK installed on <BIGME_DEVICE_SERIAL>; package update time 2026-10-07 23:10:54.
APK artifacts/sticky-shapes-2026-10-07/notes-sticky-shapes.apk
SHA-256: 2686edfd6c3b4ff8487264f66f070114db11c57bc3daaa80cd055db9a22f728b


## 2026-10-07 — live shape geometry and unified Spacing menu

Fixed the live shape preview at the canonical Writing owner. An outer inline SVG's x/y
attributes do not position it in HTML: the preview now uses an explicitly positioned wrapper
and local SVG coordinates. It appears at pen contact immediately, follows the current endpoint
for all eight shapes, shrinks when the pen returns, and commits the same bounds on pen-up.
Comments and a regression test preserve this distinction from freehand trail bounds.

Shapes now has an overlapping-shapes icon and subtitle. Following the Notes UI reference,
the menu offers rectangle, circle, line, triangle, star, trapezoid, pentagon and hexagon,
solid/dotted/dashed borders, ten colours and the Outline checkbox. Paper remains white by
default. Shape colour/width/style preferences are independent from the writing pen; local
owned handwriting and existing native handoff/exclusion/partial-refresh paths remain intact.
No native Java or device refresh policy changed.

Horizontal spacing, blank-line spacing and condensing share one Spacing popup. Existing
spacing algorithms are unchanged; selecting a mode dismisses the popup through the existing
pen-safe menu handoff. Shape width uses a live SVG stroke sample instead of a numeric px label,
including its colour and dash style; non-scaling-stroke keeps the sample width honest at
responsive sizes.

Browser verification at 572×772: all controls fit without scrolling; menu selection works.
Held pen test from (160,230) to (420,430) produced preview and committed bounds of
260×200 at exactly the same position, with no pen-up jump. Device log inspection did not
provide useful shape-pointer diagnostics; the root cause was confirmed in source and browser.
Screenshots: artifacts/sticky-shapes-2026-10-07/{live-shape-pen-down,expanded-shapes-menu,
spacing-menu,shape-width-preview}.png.

Validation: Writing 401/401 and Notes 26/26 tests pass; typecheck, bundle regeneration,
boundary checks and Bigme Notes APK build pass. Full shared JS suite remains 735/744,
with the same nine unrelated Notes/Todo credential and Play checks failing. The full script
stops at that stage; Reader/KOReader/Standard Android checks passed separately earlier in
this task. Physical panel acceptance remains user-owned.

Installed final APK on <BIGME_DEVICE_SERIAL>; package update time 2026-10-07 23:20:34.
APK: artifacts/sticky-shapes-2026-10-07/notes-shapes-spacing.apk
SHA-256: 08194578d98b1adbceece9304c9becb0056f5a3df1473b45a32523cda532d90d


## 2026-10-07 — Zoom composition and controls repair

User photo IMG_20261007_232443298.jpg showed unscaled-looking old page ink across the lower
Zoom lane. Android screencaps captured the ordinary page rather than the photo's physical
panel state; do not treat those screenshots as panel acceptance.

Canonical PenWorkspace now retires tool settings before opening Zoom and restores overlay
ownership on both entry/exit. Native Zoom owns upper ink even when opened from a WebView tool;
otherwise a captured DOM copy could coexist with retained native vectors. Saved page vectors
are explicitly clipped above the opaque Zoom strip, independently of the paper's current bounds:
CSS/SurfaceView transitions can briefly expose the old full-height paper. This is presentation
clipping only, never deletion of canonical vectors. Regression checks cover both tool ownership
and intermediate full-height clipping. Existing attach, flush, ready-time replay, retained capture
and refresh scheduling are unchanged; no Android/device-policy code was modified.

MagnifyPad relayouts its model from the measured inner viewport immediately after mounting,
before draft recovery or placement. Pre-mount fallback and measured geometry must not remain
separate mappings. Comments document this contract. Controls use icons and thin dividers;
Zoom is the sole active tool indicator while open. Its expanded rail remains scrollable without
a visible scrollbar. Close and settings-dismiss use the same icon vocabulary.

Verification: 403 Writing tests pass, typecheck/generated bundle, boundaries and Bigme APK build
pass. Focused Notes planning/dialog tests pass. All Notes tests: 52/53, with the existing protected
personal GLM credential check failing, unrelated to Zoom. Browser at 572×772 verified pen input,
automatic placement, scale changes, popup dismissal and clean separated document/pad bounds.
Final screenshot: artifacts/zoom-review-2026-10-07/browser-zoom.png. Physical acceptance remains
with the user; the photo's panel symptom still needs a device check after reopening Zoom.

Installed artifacts/zoom-review-2026-10-07/notes-zoom.apk on <BIGME_DEVICE_SERIAL>;
package lastUpdateTime 2026-10-07 23:31:10.
SHA-256: 1c8a9b3e64a9defa36058c4b2fa3355f8db69c9671b1f5977aa9ceb9036bbc7b


### Follow-up — full-height Zoom scrolling and slimmer toolbar (2026-10-07)

User clarified HEIGHT, not width: Zoom must reveal the whole current ruled sheet, including
blank lower rows. Horizontal crop/focus bounds are retained. A presentation-only extent retains
the original sheet viewport height after Zoom reduces the upper view; it survives overlay rebuilds
and is removed on close. Target-follow now scrolls only enough to expose the inverse writing crop,
reserving the floating up/down navigation only when the crop overlaps its horizontal span.
It never changes saved stroke coordinates. Manual scrolling updates chrome/capture without
invoking follow, and Up is available after even a partial automatic scroll.

User rejected duplicate sheet navigation in the floating Zoom control. Final UI retains only
up/down there. The EXISTING notebook Previous/Next controls are relocated to the top toolbar;
no duplicate handlers/buttons remain. Undo/Redo move to the expanded left rail only and are
hidden in compact mode. The lower Zoom strip no longer duplicates Undo. Rail Undo/Redo support
unplaced Zoom vectors before falling back to document history; redo vectors are cleared when
writing resumes or target/scale changes so pad-local coordinates cannot leak to another target.
Zoom remains open across notebook sheet turns after checkpoint and destination model mount,
using the existing native cold/geometry fallback, never the ordinary fast-sheet controller reuse.
UI reference reviewed: Notes UI/Screenshot_20260707-001635.png and prototype README/code.

Validation: 406 Writing tests and 29 focused Notes planning/dialog tests pass; typecheck, regenerated
Android bundle, boundary checks and Bigme APK build pass. Browser 572×772 verifies compact lacks
Undo/Redo, expanded history is in the left rail, sheet arrows are in the top bar, and sheet turns
preserve Zoom. Target-follow measured scrollTop=111, target bottom=431.98, floating navigation
starts at439.53; Up returned scrollTop to0. Final screenshot:
artifacts/zoom-review-2026-10-07/browser-zoom-final.png. Physical panel retest remains user-owned.

Final installed APK: artifacts/zoom-review-2026-10-07/notes-zoom-navigation.apk
Device <BIGME_DEVICE_SERIAL>, package lastUpdateTime 2026-10-07 23:42:42.
SHA-256: 818df6809006b90f6fbec4183cf584cb19df712c531a0b3af99681214e48174f

## 2026-10-08 — Zoom sheet boundary, eraser and settled toolbar capture

- Zoom retains the real sheet height when shortening the upper viewport. The final scroll view can contain blank paper; rules stop at the original bottom. Closing Zoom restores the original paper background styles.
- Zoom eraser defaults to individual strokes, with hold (or a second tap) opening size and Strokes/Pixels settings. A live diameter circle and swept samples follow the pointer. The saved-page radius is divided by magnification; previously a fixed document-space radius erased an oversized visible area. Pixel cutting interpolates segment/circle intersections, keeps style/pressure/timestamps and never mutates original vectors.
- Erasing uses the existing transient native/WebView handoff so its cursor and cuts are visible immediately. Zoom's committed ink remains a live SVG mirror during that handoff rather than a stale one-shot canvas; ordinary page-turn and Standard-display handoff paths are retained.
- Zoom reports only the top toolbar core as foreground chrome. Existing ready-time capture now recaptures the settled tools, addressing the user report that a compressed toolbar corrected itself after touch. Physical-panel acceptance remains pending; browser screenshots cannot prove panel state.
- Validation: 410 Writing tests and 29 focused Notes integration/handoff tests pass. Android bundle and Bigme Notes APK build pass. Browser verified at 572×772: diameter changes, mode selection, expanded toolbar and blank final sheet tail. Screenshots: artifacts/zoom-review-2026-10-07/browser-zoom-eraser.png and browser-zoom-sheet-bottom.png.
- Installed notes-zoom-eraser.apk via adb install -r on <BIGME_DEVICE_SERIAL>; package lastUpdateTime 2026-10-08 00:00:19. SHA256 8f51ca7409651c792b4504a32993f7febe25a627a13e4a683e7cd4da9bfe0f7e. No device taps performed.
- During generation a stylesheet edit used the wrong source variable. Corrected before APK build/install by recovering the exact preceding installed stylesheet, formatting it as CSS source and restoring matching comments, then appending the new eraser rules. No TypeScript remains in CSS; regenerated build is clean.

## 2026-10-08 — One toolbar eraser for page and Zoom

- Removed Zoom's duplicate eraser button, settings panel and separate preference owner. The main toolbar now owns Stroke eraser, Erasing lasso and Pixel eraser, diameter +/- controls and its circle preview. The same settings drive ordinary page gestures and Zoom's correctly scaled tip. Writing/Eraser active states remain visible in the top toolbar while Zoom is open.
- Zoom's lower controls retain only target previous/next, new line, Zoom settings and close. Pen or finger contact outside the main settings dismisses the pop-out, including the lower writing area. Switching to the top Pen tool restores Zoom writing through the existing native handoff.
- Zoom lasso uses the existing polygon/stroke test and settles pending vectors before the erase history snapshot, preserving Undo after closing Zoom. Pixel cutting reuses the existing vector circle cutter. Smaller diameters use correspondingly tighter sweep sampling on the ordinary page.
- Validation: 411 Writing tests; 29 focused Notes integration/handoff tests; typecheck/Android bundle, module boundaries and Bigme Notes APK build pass. Browser at 572×772 confirmed unified modes/diameter, no lower eraser duplicate, outside pen dismissal and return to writing. Screenshot: artifacts/zoom-review-2026-10-07/browser-unified-eraser.png. Physical panel acceptance remains user-owned.
- Installed notes-unified-eraser.apk via adb install -r on <BIGME_DEVICE_SERIAL>. Package lastUpdateTime 2026-10-08 00:07:28; SHA256 ad3bb8b34ba32755d832a9f493fda4d4688e31f6e30814fd82628f75f57363f4. No device taps performed.

## 2026-10-08 — Visible eraser tip

- Added a transparent circular tip guide on the ordinary sheet, following pen hover/contact at the toolbar-selected diameter. Zoom's existing circle now also follows hover. Lasso retains its dotted polygon rather than suggesting a circular erasure footprint.
- Marker is tool chrome with pointer-events:none, not persisted ink. Ordinary tip uses fixed pointer coordinates so reflow cannot move it away from the pen; hide on lift/cancel, surface exit and tool change. Destroy removes it. No refresh-policy or daemon-latency change.
- Browser at 572×772 verified the 20px guide centred at pen coordinate (450,600), with outside contact dismissing the menu. Screenshot artifacts/zoom-review-2026-10-07/browser-eraser-tip.png. 412 Writing tests pass, including hover without document mutation; Android bundle and Bigme APK build pass. Physical-panel behaviour remains for user acceptance.
- Installed notes-eraser-tip.apk via adb install -r. Package lastUpdateTime 2026-10-08 00:12:51; SHA256 4abc434acbf714758204c650030b446fc63da08deb632fe31fdb4b1afd8dceb0. No device taps.

## 2026-10-08 — Page overview and count between navigation arrows

- Both compact and expanded toolbars now place one overview glyph with `current/total` between Previous/Next. Removed the separate expanded Pages entry and the Notes CSS rule that hid overview in compact mode. Direct selection and page turns reopen through the existing checkpoint/preparePageTurn path; Zoom retention remains supported.
- New full-screen page overview follows the supplied BOOX photos: thumbnail selection, Select all, Copy, Copy to another notebook, Move left/right, move to numbered position, Cover and Remove. Per user correction, there is no Undo in this overview. Bottom-right density glyphs select 6, 9 or 16 pages and persist the UI preference; footer uses compact batch counts.
- Previews reuse the real vector/page renderer, with lazy rendering and per-overview caching only for visible pages. No native bitmap or tool cursor capture. Cover identity is stored in the page manifest, survives reorder, clears if removed, and drives the shelf preview on exit.
- Page order/removal changes manifest membership only: saved markdown/sidecar files retain their identities. Copy writes both files before publishing its index. Each mutation first retains `planning.pages.previous.json`; removed files remain on disk for manual recovery. No Undo control or permanent source deletion.
- Validation: 417 Writing tests, 29 focused Notes integration/handoff tests, typecheck/generated Android bundle, module boundaries and Bigme APK build pass. New tests cover selection/density/navigation, stable ordering, cover parsing, removal boundaries and cross-notebook copy failure/success. Browser at 572×772 verified copy/reorder/removal, destination chooser, cover selection, direct page selection (`2/2`), expanded/compact navigator and all grid sizes. QA copy/reorder/removal changes were restored; QA notebook page 2 was deliberately set as its cover. Physical panel acceptance remains user-owned.
- Screenshots: artifacts/zoom-review-2026-10-07/browser-page-overview.png and browser-page-navigator.png. APK: artifacts/zoom-review-2026-10-07/notes-page-overview.apk.

Installed via adb install -r on <BIGME_DEVICE_SERIAL>; package lastUpdateTime 2026-10-08 00:31:43. SHA256 657280220dc0926019eaad5e14ca1c82e5e038cfc887f2571ffaa46c72de11b7. No device taps performed.
