## 2026-10-19 — Follow-up: native is the sole checkbox pen owner

User saved/closed; installed Bigme APK and verified the pulled installed hash matches
08751b401919380ff78afc249f5e115fabdeea2060a08318d34a3422f5bc558d. Evidence:
artifacts/notes-checkbox-single-owner-2026-10-19/.

Owner observed check-then-revert after installing the first duplicate-contact correction.
Read-only device logcat confirms WebView-triggered flush completion precedes the native stroke
batch by about 900 ms. The previous requested-state fix covered native-before-WebView but not
WebView-before-native: flush may run before the pen-up callback appends its stroke.

In native write mode, checkbox WebView pen release and compatibility click now defer completely
to native completed-stroke handling; they do not request a flush or disable ink. The control's
owner-held activation state survives DOM replacement and suppresses late pen clicks until a new
finger/mouse/keyboard contact. Ordinary WebView pen mode and finger actions retain their existing
path. Native batches still clean temporary marks without saving ink. No daemon/refresh/cadence
policy change. Two reverse-delivery regressions failed before the fix and pass after it, covering
checked and unchecked starts, a 950ms batch delay, later replacement-node click, save/reopen,
Undo and subsequent finger activation. 718 writing tests/typecheck/regeneration/boundaries and
125 Notes/reader/KOReader checks pass. Aggregate apps 321/322 retain the unrelated Todo credential
assertion. Physical pen/panel acceptance remains user-owned.

## 2026-10-19 — Checkbox single-contact and toolbar foreground fixes

- Checkbox pen activation now survives DOM replacement. Native recognition and queued WebView
  activation set an explicit requested state, preventing the same contact's compatibility click
  or native flush from undoing an untick. Temporary checkbox marks remain unsaved; Undo and
  checkpoint/reopen are covered. Reproduced the re-tick with failing tests before fixing it.
- Read-only device screenshot `/tmp/notes-toolbar-overlap.png` shows compact chrome above the
  expanded rail. CDP confirms exactly one expanded toolbar in the DOM: the duplicate is the old
  retained native foreground. Same-geometry layout now retires it through the serialized capture
  queue before the content capture. Compact mode reacquires its foreground without reattaching ink.
- Validation: 717 writing tests, typecheck/regenerated Android assets/boundaries, 116 Notes web
  checks, 9 reader/KOReader checks pass. Standard runtime 58 tests and Notes native 87 tests
  (one skip) pass; Standard Notes APK builds. Aggregate apps gate retains the unrelated known
  Todo protected-credential assertion (320/321 pass). User owns physical-device acceptance.

## 2026-10-17 — Bars handle and stable high-contrast press rendering

- Read-only device screenshot shows the compact handle with a pale blue browser tap highlight.
  Restored the neutral runtime two-bars glyph; removed Notes' arrow override and rotation.
- Disabled WebView tap highlights throughout the writing surface. Tool buttons have explicit
  appearance, no animation/transition/transform, fixed SVG dimensions and pointer-only focus
  outline suppression. Handle stays black on white even while pressed; actual selected tools
  retain black/white inversion and keyboard focus remains available.
- Pressed button faces were painting over rounded toolbar corners because overflow was visible.
  Compact toolbar and expanded rail now clip child painting to the fixed outline without scrolling;
  expanded layout wrapper remains visible for its separate fixed controls. No native policy change.
- Browser checks include real CDP touch-hold on the handle, held/released Eraser/Select/Pen,
  Spacing frame bounds, lasso selection, menus and Zoom. 623 Writing/91 Notes checks pass;
  Standard and Bigme builds and final installation evidence:
  artifacts/notes-toolbar-press-2026-10-17/verification.md. Physical panel confirmation user-owned.

## 2026-10-17 — Lasso completion, raw preview and static toolbar cleanup

- Device log: large lasso delivered, vector frame5→1; three following pen-downs had no completed
  stroke batch. Reproduced native InputProxy dropping a completed lasso when UP/LEAVE is outside
  paper/top bounds. Two tests failed before fix. Finish admitted gestures at last accepted point;
  reject outside starts/orphan releases and prevent duplicate-UP dots. No refresh/cadence changes.
  Actual device terminal coordinates were not logged; physical causal confirmation remains pending.
- Removed premature SVG Z closure from live lasso preview, hid circular tip in lasso mode; added
  isolated tiny-top-mark erase/Undo regression. Drawing remains freehand; erase/select tool owns
  release interpretation. Existing native and WebView owners remain separate.
- Replaced accumulated Notes CSS overrides with one187-line presentation. Fixed compact48×306 and
  expanded48×618 geometry, no toolbar scrollbars; viewport/Zoom intentionally uses94×310 rail when
  short. Context copy/delete/convert now live in the Lasso menu. Spacing/open/activate and selection
  maintain exact toolbar bounds in browser checks. No archived apps or saved-note formats changed.
- 623 Writing tests,91 Notes checks,4 new native completion cases and existing Bigme cases pass;
  typecheck/bundle/boundaries pass. Root suite retains existing Todo credential failure296/297.
  Standard/Bigme build and install evidence: artifacts/notes-lasso-fix-2026-10-17/verification.md.
  No agent device writing gestures or physical acceptance claims.

## 2026-10-17 — Readable controls and a genuinely reduced compact toolbar

- User reports previous 32/34px controls unreadable on-device. Increased tool glyphs 19→27px,
  normal targets 32→44px, compact/full rail width to48px, top bar36→48px and menu text12→16px.
  Pen popup182→250px; expanded paper inset60px. Top bar remains one row; no permanent tool labels.
- Compact now contains only Pen, Eraser, Select, Undo and Zoom plus collapse/expand controls;
  copy/delete/convert remain contextual. Everything else stays in the expanded rail, including
  Format with AI as a normal item. Compact height508→306px at572×772 despite larger controls.
- Feature-owned CSS only plus Notes contract expectation/docs. Existing tools, preferences,
  native flush/drag/capture and geometry measurement paths remain. Browser checks validate exact
  compact membership, bounds at360/572/674, modes, palette and Zoom. User confirms saved/closed
  and authorizes installation. Evidence/builds/install result:
  artifacts/notes-readable-design-2026-10-17/verification.md. Physical testing remains user-owned.

## 2026-10-17 — Corrected compact and expanded Notes chrome

- User rejected the earlier oversized labelled rail/two-row header and supplied five Scribe
  screenshots. The replacement uses a vertical 34px compact strip, a 32px icon-only expanded rail,
  one 36px header and 42px expanded paper inset. Format with AI is a normal toolbar item in both
  layouts, per explicit user correction; no separate top-bar action.
- Added two persistent ink-colour shortcuts and a 182px square-edged Pen/Brush/Marker menu with
  width samples, swatches and selected colour name. All colour/brush/width changes use native flush
  and existing preference/style callbacks. Optional penQuickColors is preference-only; ink/sidecar
  formats, stylus lifecycle and panel policy are unchanged. Compact drag remains canonical.
- 622 Writing tests, 91 Notes checks, typecheck/generation, boundaries, Standard aggregate native
  tests, Bigme Notes/runtime/provider tests and nine reader/KOReader cases pass. Full suite reaches
  existing unrelated Todo credential failure (296/297 app/content). Automated isolated browser
  checks cover widths 360/572/674, colour interaction, mode transitions and Zoom; no console errors.
- User confirmed saved/closed and authorized install. APKs, screenshots, hashes, logs and final
  installation result: artifacts/notes-compact-design-2026-10-17/verification.md. No physical pen
  tests or paid AI requests; physical acceptance remains user-owned. KOReader styling deferred.

## 2026-10-17 — Scribe-inspired Notes writing chrome

- Reviewed the reference's toolbar explorations and final colour-slot pictures. Notes opts into
  feature-owned notebook chrome: writing tools in the left rail; history/page navigation and
  labelled Format with AI in the top bar. Small displays use two header rows. Context settings sit
  beside the rail; compact/collapsed modes, Zoom and existing editing behaviour remain.
- Expanded mode moves the same control nodes and restores compact order. Native lifecycle,
  refresh policy and document formats are unchanged. Separate Agora editor/shelf actions removed;
  background formatting and incoming external contracts remain compatible. KOReader deferred.
- Verification and APKs: artifacts/notes-scribe-design-2026-10-17. 621 Writing tests, 91 Notes
  checks, typecheck, boundaries, nine reader/KOReader checks and native tests pass. Root all-tests
  stops at the existing Todo credential assertion (296/297 app/content). Standard and Bigme builds
  pass. Browser checks cover 674×896 and 572×772, Pen settings and Zoom.
- User authorizes installation/log inspection and retains physical testing. Bigme update installed
  with install -r, data retained; installed APK hash verified. Startup log has no fatal/JS errors.
  No physical writing gestures or paid AI requests. Physical acceptance remains pending.

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

## 2026-10-04 Notes candidate installed

User authorized pushing the prepared candidate. `adb install -r` succeeded on HiBreak
`<BIGME_DEVICE_SERIAL>`, package `com.kalamos.notebook`, retaining existing app data.
APK: `artifacts/notes-ready-2026-10-02/kalamos-notes-bigme.apk`; SHA-256
`cb0b4d8173b6b795abfe2f3d2863d68dbe632a4d1a5361b94e25dff2b8728cf6`.
Physical pen, Android IME and e-ink panel acceptance remain with the user.

## 2026-10-02 Notes ready candidate: inline text, Markdown and erasing lasso

Candidate APK: `artifacts/notes-ready-2026-10-02/kalamos-notes-bigme.apk` (com.kalamos.notebook), SHA-256
`cb0b4d8173b6b795abfe2f3d2863d68dbe632a4d1a5361b94e25dff2b8728cf6`.
Device disconnected; **not installed**. Supersedes the rejected floating text prompt candidate.

Dashed text boxes now have attached headers/corner controls in Planning and handwriting, use the
stock Android IME, and grow rows only on wrap/newline. Saved Planning ruling prevents source rows
collapsing after changing screen defaults. Markdown import supports the complete source with spacing;
export carries readable Markdown, SVG previews and lossless ink/layout data. Notes long-press adds PDF
export; shelf dragging moves notebooks into folders. Both writing modes offer erasing lasso with undo.

Browser verified six-entry shelf at 572×772 and larger 1040×900, folder drag, inline text, handwriting
lasso/undo, template/ink/text PDF preview and Markdown spacing/vector re-import. 214 Writing tests,
52 runtime and 3 Bigme unit tests passed; APK/signature/generated assets verified. Full Node stage:
657 pass / 9 existing failures (two personal credential assertions, seven task schema/feedback checks).
Reader/KOReader 21 passed. See `artifacts/notes-ready-2026-10-02/QA.md` for exact limits and physical
acceptance checklist. Browser results do not prove pen/IME, daemon chrome or e-ink refresh acceptance.

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

# Notes handover

## 2026-10-02 responsive Notes refinement

Handwriting popovers now use a 44px Done target, rounded black/white sheets, compact pen settings and width presets without nested scrolling. Pen release activation has movement/cancellation checks and suppresses the following compatibility click even when the sheet has been removed. Existing exclusion rectangles, queued panel snapshots and close-page recomposition remain intact.

Handwriting now offers Blank, Horizontal, Grid, Dotted, Weekly and Cornell paper. Original SVG sources live in `apps/notes/app/src/main/assets/web/templates`; Weekly/Cornell share normalized geometry across CSS previews, WebView thumbnails and native InkSurfaceView. These templates do not enter Planning's separate ruled model. Creation passes name/template before opening, avoiding post-open autosave races. Library navigation now lets App.showLibrary own the single ordered detach/thumbnail sequence.

Planning Insert text now creates a movable annotation box with Move/Edit/Delete, a focused Android-compatible textarea and Done. Optional version-1 sidecar textBoxes retain independent position and text; commits, undo, checkpoint and thumbnails preserve them. IME resize retains the focused textarea. Boxes clamp their displayed horizontal position on smaller screens, preserving saved placement for larger ones. They are independent annotations, not words within the ink reflow sequence.

Astra identified/fixed three vertical-spacing defects: new ink replaying historical negative spacers, mismatched positive inverse membership, and reordered ink inheriting different spacer membership. Stable scopedInkIds plus regression tests preserve intentional upward concealment, native ownership and refresh timing.

Browser QA: 572×772 (six-inch CSS viewport), 380×640 and 1040×1400 creation; 572×500 keyboard resize; browser stylus release closes Done; text drag/save/reopen. Six shelf items on small screens; larger screens retain 3×3/4×4 options and roomier creation cards. 194 writing tests, TypeScript/bundle build and 35 focused Notes tests pass. Bigme APK builds; installed with adb install -r on connected HiBreak <BIGME_DEVICE_SERIAL>, package update time 2026-10-02 09:29:40. No physical UI interactions or claims of panel acceptance.

Candidate: `artifacts/notes-refinement-2026-10-02/kalamos-notes-bigme.apk`; SHA256 `d5d17fb78de1d52b233af34df265c22cc85ea34a59cd394712923368dc79cd7c`. QA/screenshots alongside it. Earlier word-insertion presentation is superseded by the independent annotation boxes.

## 2026-10-02 UI candidate installed

User authorized installation. `adb install -r` succeeded on connected HiBreak
`<BIGME_DEVICE_SERIAL>`, preserving the existing Notes package/data. Installed artifact:
`artifacts/notes-ui-2026-10-02/kalamos-notes-bigme-ui.apk`, SHA-256
`794582c06fdc388eaec4d59d3300619e6c802bef6623c6b40f28d1531d32be21`.
Package manager confirms installed `com.kalamos.notebook` version 1.0.0/code 1.
No app launch, pen interaction or panel acceptance testing was performed; those remain with the user.
Earlier not-installed statements below describe the preparation checkpoint.


## Install-ready Notes UI candidate

Stable APK: `artifacts/notes-ui-2026-10-02/kalamos-notes-bigme-ui.apk`. Package/API/Bigme provider,
signature validity and exact packaged web assets verified. Its signing certificate matches installed
Notes, permitting a data-preserving replacement install. No install or device interaction test was
performed. Full audit and checksum: `artifacts/notes-ui-2026-10-02/QA.md`.

## 2026-10-02 six-inch monochrome UI

Notes now uses explicit black/white chrome, captions, previews, selected states and dialog backdrops;
no grey opacity or soft shadows. The library defaults to three columns/two rows on screens up to
680 CSS pixels, with a maximum six items and a larger four-item option. Folder and note creation
icons, creation sheets, header, footer and Planning full chrome were adapted to small screens.
Sharing and storage remain reachable through Library menu. Fixed the footer decorator registering
for DOMContentLoaded after App.start had already passed that event.

Planning defaults to 56 CSS pixel rules at six-inch widths (44 on larger displays), with black ink.
Saved preferences remain authoritative to preserve existing note geometry. Text inserts use the
existing word/ink model and undo history, anchored after selected handwriting or at the end of text.
The action flushes pending native ink and enters the existing Select/WebView handoff before showing
the sheet. The separate Edit text control remains in expanded tools.

Final-size model thumbnails now paint every visible rule as two integer-aligned black pixel rows.
Bigme retains its final stroke drain, clean native snapshot queue and immutable thumbnail callback;
only after that callback is the thumbnail replaced with the vector preview, falling back to the
native image on failure. No readiness, buffer clearing, waveform, geometry or timing changes.

Browser QA at 572 x 772 CSS pixels (1072 x 1448 / DPR 1.875) and 390 x 700: folder creation, six-card
capacity, overflow pagination, Planning text insertion, save/reopen and preview rules verified.
Screenshots: artifacts/notes-ui-2026-10-02. Writing: 188 tests; focused Notes: 34 tests; typecheck and
bundle generation pass. Bigme APK builds; not installed. Full repository run: 647/656 Node tests pass,
nine failures in untouched Notes/Todo credential packaging and Play task-schema contracts. Physical
panel, native keyboard and pen/refresh acceptance remain with the user.


## 2026-09-15 external import library refresh

Returning from Agent's `NoteImportActivity` must reload the authoritative library index before the
shelf accepts another action. The import activity writes the notebook and `library.json` while the
Notes WebView is paused; retaining the old in-memory index both hides the imported card and risks
orphaning it when a later rename, move, or delete saves that stale index. The neutral runtime now
calls `loadLibrary()` whenever a visible library resumes; that function also renders the refreshed
shelf.

## 2026-09-15 save on note exit and app background

Classic Notes and Planning now treat both note exit and Android pause as durable checkpoints. The
native ink batch is flushed before the document model is saved; Planning remains mounted for a
background checkpoint and suspends its native surface only after persistence completes. A fast
resume invalidates the pending suspend so a late pause callback cannot detach an active workspace.
Closing a Planning note also checkpoints the live workspace rather than saving an older committed
snapshot. Automated source-contract tests cover the ordering; physical-device acceptance remains
with the user.

## 2026-09-14 Planning compact tools

The compact Planning pop-out now uses its limited horizontal space for direct writing operations.
Undo and Redo remain available in the expanded top bar only; compact mode exposes Pen, Eraser,
Select, Space, Lines, Close spacing, Zoom, and Type. This is a Notes-owned CSS composition change:
the shared Writing toolbar still owns the action buttons and full-mode layout, and no controls are
cloned.

## 2026-09-09 responsive library density and clearer previews

Notes now turns the footer grid icon into a labelled density chooser with persistent 2 x 2, 3 x 3,
and 4 x 4 options. The app-owned CSS adapts columns, rows, card widths, and compact labels while the
neutral library controller accepts a configurable page capacity, so pagination remains consistent
at 4, 9, or 16 notes per screen. Standard Planning thumbnails render at final size from the saved
vector model and use a padded content bounding box, preserving every stroke without leaving most of
a lightly written card blank. Rules use the document's real line height and pen widths scale with the
crop instead of receiving an artificial three-pixel minimum. Empty notes retain the full page and are
labelled `Empty note`. Every folder card has a tabbed outer silhouette. Non-empty covers retain four
positions: direct note previews keep a rounded page outline, unused positions are plain unoutlined
white space, and a direct child-folder position has its own smaller tabbed folder outline. A
child-folder miniature remains blank regardless of its descendant pages; cover previews never flatten
the hierarchy recursively. A completely empty folder retains the existing large folder glyph.

All 32 Notes tests and all 171 ruled-writing tests pass, TypeScript checking passes, and the Standard
Notes APK builds. The data-preserving replacement APK (SHA-256
`62a0888f5ca8f51f899723dbee04cb07398a8d4556daddd3c981c5dc80b1191e`) was installed with
`adb install -r` on Huion Note E / X50 `<ANDROID_DEVICE_SERIAL>`. `tools/test-all.sh` progressed through
the writing and app suites before stopping in the unrelated reader regression where
`ReaderImageLongPress` is undefined in `features/reader/tests/book-reader-regressions.mjs`. Browser
visual QA was unavailable because the local preview webview did not attach. Physical layout and
e-ink acceptance remain pending user testing.

**Migrated:** 2026-07-22

**Application ID:** `com.kalamos.notebook` (preserved for data and licence continuity)

**Build:** passed

**Installed:** yes

**Device acceptance:** pending user testing

## Planning boundary

Planning uses only the shared writing feature. Its app-owned responsibilities are:

- show Planning in the creation sheet;
- hide and disable classic handwriting templates while Planning is selected;
- create one explicitly blank compatibility page and mark the notebook `kind: planning`;
- route create/reopen to `KalamosWriteWorkspace.openWorkspaceNotebook(id)`;
- delegate Back, pause and resume to the scoped workspace lifecycle.

The APK contains no `planning.js`, `NotesPlanning`, gesture command lab, parsed-plan/review UI,
`plan.md` or `plan-state*.json` access, nor the former sample plan text. Existing legacy files in a
user's notebook remain inert; this migration does not delete user data.

Planning persists through the compatible `planning.write2.md` and `planning.write2.json` names. The
`write2` token is a data-format identifier, not a source dependency. These files must use the
notebook-file bridge and live under `notebooks/<id>` beside `meta.json`; sending them through the
book-file bridge creates a same-ID `books/<id>` record that can mask the Planning metadata.

Builds predating the notebook-file bridge may already have misplaced Planning source/sidecars.
Storage recovery is intentionally non-destructive: a first read copies each missing file back into
the notebook record, retains the old directory as a recovery copy, and ignores it unless it carries
a real EPUB, PDF or book manifest. Do not “repair” this by deleting either device directory.

## Ink and chrome rules

Planning follows the shared contract in `docs/devices/bigme/INK-WRITING-GUIDE.md`. Classic Notes
chrome additionally uses native toolbar/menu snapshots. Its important lexical rule is:

```js
if (typeof Bridge !== 'undefined') Bridge.snapshotToolbar(...)
```

`bridge.js` declares a script-scope `const Bridge`; it is not `window.Bridge`. Changing the guard to
`window.Bridge` silently suppresses the initial toolbar and rail capture. The full incident history
is in `docs/devices/bigme/NOTES-TOOLBAR-SNAPSHOT.md`.

Planning is also a full-editor lifecycle even though its ruled paper is inset by Notes chrome. The
shared `Write2Native` adapter must not call the reader-only `skipWakeRefresh()` API. Doing so can load
and render every saved stroke into the daemon while leaving the physical page blank until later pen
invalidations reveal small regions. The regression test lives with the shared writing source rather
than in an app-owned Planning implementation.

### Standard Planning latency acceptance (2026-09-09)

On Huion Note E / X50, Planning is the shared direct ruled workspace—not the classic Handwriting
page editor. On-device timing ruled out automatic HWR and a congested pen-down handler: recognition
is explicit-only and measured pen-down work was normally 4–13 ms. The remaining hiccup coincided
with Mali texture-allocation/GPUAUX errors. The shared workspace now uses delegated ink, primes it
at contact, keeps stable canvas dimensions, clears only the wet stroke's dirty rectangle, and reuses
unchanged committed SVG nodes across pen-up relayouts. Diagnostic pen-down and pen-up phase messages
use the `DIAG [kalamos-ink]` prefix so the Android WebChromeClient forwards them to logcat.

The Standard APK with these changes was installed in place and the user reported the new-line
hiccup resolved. This does not constitute acceptance of unrelated tools or the Bigme path.

## Manual acceptance checklist

1. Confirm the library initially uses the remembered content density (three-by-three for a fresh
   install) with the Books 86:131 ratio. Tap the footer grid icon and verify 2 x 2, 3 x 3, and 4 x 4
   each change both the visible card count and the page total, survive an app restart, and never
   clip card titles. Confirm previews bound themselves to the occupied writing with a small ruled
   margin, include every stroke, keep the apparent pen thickness consistent with the full note, and
   do not leave a dominant blank lower half. Every folder must have a tab on its outer silhouette. A
   non-empty folder reserves four positions; a note occupies one rounded miniature page, unused
   positions leave no visible placeholder lines, and a nested folder has its own smaller tabbed
   outline with a blank interior even when it contains pages. A completely empty folder keeps the
   large folder glyph. Uncaptured empty notes must say
   `Empty note`. Also confirm
   New Note/New Folder live in the header rather than consuming shelf cells. Open New Note and
   confirm the shelf remains visible behind the opaque chooser, with only the selected mode and
   selected template highlighted black; inactive choices remain white. Tapping the library title
   must do nothing: the obsolete `All`/folder-chip/`+ folder` dialog is removed from the Notes DOM.
2. Open a classic Handwriting notebook: confirm toolbar/rail appear immediately and live pen works.
   Open Zoom, verify the magnified page context, 2×/2.5×/3× controls, target navigation, placement,
   the selected pen colour/width, and that closing restores ordinary page writing.
3. Create Handwriting notes with each template: confirm template selection still applies.
4. Create Planning: confirm no template chooser/content leaks into the ruled workspace.
5. Confirm real-time Planning strokes, Insert Space, Blank Lines/caret, selection/move, erase,
   magnifier and undo/redo. With Planning's toolbar fully expanded, open Zoom and confirm the
   labelled left rail remains visible above the lower writing pad. On Standard, drag and release
   both floating toolbars and confirm they follow the pointer live without committed writing
   flashing. On Bigme, confirm its retained-panel live handoff remains unchanged.
6. Tap Done, reopen, then create another Planning note: confirm persistence and an empty ink buffer.
   Return to the library and confirm Planning cards still reopen as Planning rather than classic
   Handwriting; this specifically covers the former same-ID split-store regression.
7. Repeatedly switch between classic Handwriting and Planning: confirm no stale chrome, template,
   strokes or callbacks cross the boundary.
8. For both a light page and a heavily written page, return to the library immediately after the
   last stroke. Confirm the thumbnail contains every stroke, rules remain continuous, and reopening
   then closing the notebook replaces any older broken thumbnail. Standard classic Handwriting
   renders a 320 x 487 PNG edge-to-edge using the Books shelf's 86:131 ratio. Standard Planning
   deterministically renders the vector model into the same aspect using a padded content bounding
   box, with WebView capture retained only as a fallback; Bigme captures its native page. PNG
   replacement is atomic on all paths, so repeatedly
   entering/exiting while the library loads must never show a half-written image.
9. Exit one notebook after writing, then open another Handwriting notebook and a Planning notebook.
   Confirm pen input works immediately in both; each new native attach must restore Android View
   input after the thumbnail exit disabled it.


### 2026-10-04 Unified ruled Notes editor

Planning is now the only plain Notes editor and the default creation path. App-only classic
handwriting toolbar, text dialogs, templates and routing were retired. Their initial JS/CSS snapshot
was subsequently deleted on 2026-10-11 at the user's request. Shared foundation reader/sketch controllers
remain active for their other consumers and native callback seam.

Legacy conversion backs up original metadata and vectors to `handwriting.backup.json` before
writing sidecars; original page files remain untouched. All sheets and `planning.pages.json` must
save before committing `kind: planning`. Failed upgrades stay on the shelf; reopening an upgraded
note cannot overwrite edited sheets. Strokes retain CSS positions/width/pressure/timing. Old paper
backgrounds become ruled sheets and old text enters the canonical text model; originals are retained
in the recovery backup.

Canonical selection now includes drawn lasso, whole-group move, copy, delete and existing HWR.
Extraction retains page coordinates and one Undo transaction. Copies have independent vectors/IDs
and land one lane below. Erasing lasso remains in Eraser; shape correction is opt-in in Pen settings.
The closed-path simplifier was fixed to avoid discarding closed boxes. Native shape corrections
report the union of old/new vector bounds through the existing bounded replacement path; normal
writing remains free of DOM invalidations in native stroke callbacks. Existing Planning tools,
text/spacing behavior, separate sheets and exports remain. Automatic classic cleanup/live HWR
settings are retired; Layers was only a placeholder. See README for current tool coverage.

No native lifecycle, daemon geometry, capture or refresh timings changed. Keep the same-box
controller reuse, earliest sync deadline, complete-frame composition and 500 ms input-only rearm
comments and guards. Browser checks do not establish physical pen/panel acceptance.

Validation/evidence: `artifacts/unified-notes-2026-10-04/` (see QA.md for final results and APK).

Final checks: 324 Writing tests, 51 focused Notes checks, standard Android unit build and Bigme APK
pass. Combined shared Node phase retains nine unrelated Play/credential failures. Browser checked
572×772 and 1000×800; APK contents exclude archived UI/templates. Replacement install succeeded,
data retained, lastUpdateTime 2026-10-04 22:51:27. Physical acceptance remains with the user.


### 2026-10-04 Native spaced lasso and simpler compact toolbar

Both selection and erasing lassos now use the existing native `selection` pen, including the retained
SDK dash intervals and running phase. Gesture batches never become notebook ink. Changed vector
bounds plus transient trail are replaced through the existing short partial-refresh schedule;
controller attachment/geometry, page-turn safeguards and input rearm timing remain intact. Returning
to Write and reusing the controller on a new sheet explicitly restores ballpoint/normal width.
Native selection commands flush before copy/delete/HWR. WebView fallback's detached preview bug was
fixed; its spaced trail remains attached after overlay redraw.

Compact now keeps Undo, pen, eraser, lasso, text and previous/next/add page. Spacing, collapse, Zoom,
Pages overview, redo and text editing stay in the expanded toolbar. Contextual selected-ink actions
remain available. Browser checked at six-inch and larger viewports. 331 Writing tests and 34 focused
Notes checks pass; combined suite retains the same nine unrelated Play/credential failures. See
`artifacts/native-lasso-2026-10-04/QA.md` for build/install and physical acceptance status.

Final APK replacement installed successfully with app data retained. SHA-256 and package update time
are in `artifacts/native-lasso-2026-10-04/QA.md` and `install-verification.log`. Final Writing suite
is 331/331; device pen/refresh acceptance remains with the user.

### 2026-10-04 Palm-safe page taps

The canonical workspace now suppresses finger page taps during observed pen contact/hover and for
1.8s after pen activity, including native stroke batches. Broad and multiple touch contacts cancel
navigation, and a rejected resting contact must lift before a fresh tap can qualify. Deliberate
quiet finger taps still navigate existing sheets; toolbar arrows/Add page remain available.
No native rendering/refresh/rearm policy change. 337 Writing tests/typecheck/build pass; physical
palm acceptance remains with the user. See `artifacts/palm-rejection-2026-10-04/QA.md`.

### 2026-10-04 Swipe turns replace edge taps and palm cooldown

Supersedes the previous palm guard: no 1.8s delay, hover blocker or contact-size class.
Single horizontal finger swipe turns one existing sheet: left next/right previous. Taps never
turn; vertical scroll, cancelled/short/diagonal/long-held gestures don't navigate. Pen contact,
native batch activity and multi-touch cancel pending swipes. Explicit page buttons unchanged.
No daemon/refresh/rearm policy changes. 332 Writing tests/typecheck/generated bundle pass.
See `artifacts/swipe-page-turns-2026-10-04/QA.md`; physical acceptance remains user-owned.

### 2026-10-04 Whole-word scribble erase

Scribble hits now expand to the canonical word groups also used for moving/selecting handwriting,
so un-crossed letters/dots/crossbars are removed with the word. Separate neighbouring words in
legacy/Zoom/lasso inserts survive. Native partial dirty rectangle expands to the full erased word,
including pen width; no full-refresh/attach scheduling changes. Zoom staging and one-step Undo/Redo
remain. 335 Writing tests/typecheck/bundle pass; physical acceptance remains user-owned.
Evidence/APK: `artifacts/word-scribble-erase-2026-10-04/`.

### 2026-10-04 Native main-page scribble residue

User photo exposed scribble ghosting that digital screencap omitted. Canonical native scribble
completion now asks for stronger cleanup over word/trail bounds after authoritative recomposition.
Bigme GC16 stays regional, separately tracked from any full layout update; no whole-panel clean,
new capture/attach/rearm delay or live-pen change. A brief local flash may occur. Zoom refresh route
unchanged. 336 Writing tests and Standard/Bigme build/tests pass. User panel acceptance is pending.
Evidence: `artifacts/scribble-ghost-clean-2026-10-04/QA.md`.

### 2026-10-04 Lighter scribble with dominant-word targeting

Two clear broad back-and-forth cycles/lighter compact scrubs now qualify; normal handwriting tests
remain protected by direction/retracing/size/contact checks. Word intent uses path length, not sample
count: incidental neighbouring hits below 25% of the dominant word's support survive. Deliberately
scribbling both words still erases both. Whole-word and Zoom transactions unchanged. Legacy phrase
survivors keep their page position. No native refresh/timing change. 346 Writing tests and build pass;
user performs physical acceptance. See `artifacts/lighter-word-scribble-2026-10-04/QA.md`.

### 2026-10-05 Smart notebook starters, paint styles and free objects

New creation catalogue follows Notes UI references: numbered Notebook titles, Ruled/Week/Tasks/
Meeting/Journal starters, row-end checkbox controls, and new sheets inheriting the chosen starter.
Checkbox/heading anchors share canonical spacing; toggled state saves/reopens and is undoable.
Shape correction toggle removed. Pen/Brush/Marker, 17 colours and a separate expanded-toolbar Shapes
chooser added. Free shapes/sketches have Move/Size/Delete controls and remain outside ruled reflow;
sidecar, thumbnail and exports retain them. New Pen/Marker width matches constant-width native ink;
legacy geometry unchanged. Brush replay retains pressure and uses felt. Native checkbox batches own
one bounded composition, avoiding nested full-paper layout refreshes. Preserve those comments/hooks.
364 Writing tests, typecheck/bundle, 35 Notes checks, boundaries, Bigme build/tests and Standard unit
suite pass. Full Node suite has the same nine unrelated credential/Play failures (735/744 pass).
Browser verified at six-inch and large sizes. APK installed 2026-10-05 22:17:18; physical acceptance
pending user testing. Evidence and exact APK: `artifacts/smart-notebooks-2026-10-05/QA.md`.

### 2026-10-07 Automatic overflow sheets

After positive line insertion or text-box acceptance, canonical Writing checkpoints and moves
complete overflowing rows onto new separate sheets. Continuations precede later manual pages;
current page stays selected and existing compact/expanded navigation and swipes reach them.
Materialised ink, source text, template labels, checked rows and shapes survive save/reopen.
Immutable save files precede manifest publication; old files remain for recovery. No device pen,
page-turn timing or refresh policy modifications. Persisted sheet height prevents toolbar/keyboard
repartition; an oversized atomic drawing remains editable. Session Undo resets at this sheet boundary.
Evidence and pending physical panel checks: `artifacts/pagination-2026-10-07/QA.md`.
376 Writing tests/typecheck/generated bundle, boundaries and Bigme build/unit checks pass; same
9 unrelated full Node failures remain. APK installed successfully at 2026-10-07 21:41:10; panel
acceptance remains pending user testing.

Browser follow-up: the unsupported data URL was a connection-refused error page left after the
preview server stopped. Restarted the normal Notes HTTP preview; development-browser pagination,
compact/expanded navigation, 572×772 and 1000×800 layouts, and save/reopen on Page 2 of 2 now pass,
with no warning/error console records. Screenshot evidence and recovery details are in the QA file.
The connected device still reports the latest installation at 2026-10-07 21:41:10; no reinstall needed.
Physical panel acceptance remains user-owned.

### 2026-10-07 Paper gutters and simpler notebook chooser

12px top/side, 20px bottom paper clearance; expanded rail keeps the same paper gutter. Pagination
caps older full-bleed heights on explicit operations so a would-be clipped bottom row moves to its
continuation. Existing native coordinate/refresh/latency policies are preserved. Template chooser
now has decorative SVG previews, single names, more space and no help paragraphs. Default numbered
name stays keyboard-free until edited. Browser checks at 572×772 and 1000×800 pass; 377 Writing and
35 Notes tests plus Bigme build/unit/boundary checks pass. Same nine unrelated full Node failures.
See `artifacts/notes-margins-2026-10-07/QA.md`. Physical panel acceptance remains user-owned.
APK installed successfully; package lastUpdateTime 2026-10-07 21:53:27.

### 2026-10-07 Faithful screen-ratio template previews

Notebook creation follows `Notes UI/Screenshot_20260707-001609.png`: large page previews with a
thin rounded paper outline, no enclosing item card, and selection circles before single captions.
The chooser renders actual first-sheet SVGs via the canonical PenWorkspace export renderer and
current screen geometry/preferences, including paper gutters, heading positions and checkbox rows.
Isolated preview workspaces are native-disabled, never save or mount a second visible editor, and
are destroyed after export. Default PDF geometry remains unchanged. Do not replace this with
symbolic previews: new layouts must remain faithful to their actual template model.
378 Writing tests, typecheck/generated bundle, boundaries and Bigme APK/provider checks pass.
Browser checks at 572×772 and 1000×800 fit without internal scrolling, selection works, and no
warning/error logs appear. Notes checks pass 52/53 with the existing credential failure; full Node
suite retains the same nine unrelated credential/Play failures (735/744). Installed on connected
Bigme, lastUpdateTime 2026-10-07 22:04:38. Physical panel acceptance remains user-owned.
Evidence and APK: `artifacts/template-previews-2026-10-07/QA.md`.

### 2026-10-07 Categorised editable templates and blank controls

Creation now has Recent, Reused, Work, Study, Personal and Pages (complete catalogue), with six
previews per catalogue page and larger previews for a single-row category. Recent sorts successful
creations by date; Reused contains starters created more than once, sorted by count. Cancelling does
not alter usage. Category/page changes select a visible starter, and empty categories disable Create.
New starters: Cornell, McKinsey-inspired problem solving, Project, Daily log, Revision and Outline.
Labels and checklists are ordinary ruled text fields with spacing/save/export behavior. Cornell's
column divider is a separately editable free vector, so it does not follow ruled spacing operations.
Native ink/presentation/refresh policies unchanged. Pages/new notebook creation use current screen
height to fit new sections, with actual first-sheet previews from the canonical renderer.
Notes Create/Cancel/Done and pen brush/eraser/shape choices are blank at rest; selected choices turn
black, including white vector icons on selected shape controls. App-scoped overrides preserve other
apps' button policies and colour palette swatches.
384 Writing tests, typecheck/generated bundle, 26 Notes planning integration checks, boundaries and
Bigme APK build pass. Browser verified six-inch 708/708 catalogue height, large 673/673 Work height,
category/page selection, empty Reused state, and Cornell create/save/Recent. A chooser ASI runtime
error caught during QA was fixed and did not recur. APK installed 2026-10-07 22:16:30; physical panel
acceptance remains user-owned. Details/sources/screenshots in template-previews QA.

### 2026-10-07 Stable three-template chooser

User requested consistent three previews per catalogue page at six-inch size, even for partially
filled categories, with Previous / page indicator / Next always present (including 1 / 1).
Categories now only Recent, Work, Study, Personal. Ruled belongs to Personal; first-use defaults
there until actual Recent usage exists. Removed Reused/Pages filters and count-dependent resizing.
Hidden placeholders reserve all three slots on sparse pages; the same grid and pager geometry are
preserved. Browser at 572×772 measured identical 585.546875px dialog height for Recent (one item),
Work (three) and Work page 2 (one); Study shows 1 / 1 and disabled arrows. Screenshot:
`artifacts/template-previews-2026-10-07/stable-three-templates.png`.
JS syntax, typecheck/generated bundle, 26 Notes planning checks and Bigme APK build pass.
Installed successfully, package lastUpdateTime 2026-10-07 22:23:11. APK `notes-stable-catalogue.apk`
SHA-256: 3e9055a5851ed610a7d761a54d8969853e3e3728b527225eb5cbb36069964c33.
Native ink/refresh unchanged; no device input automated, physical acceptance remains user-owned.

### 2026-10-07 Outlined controls, selected-only fill

Clarified Notes policy: visible black outlines on white resting controls, black fill only for
selection/press. Restored outlines for Create/Cancel/Done, categories and catalogue navigation,
brush/eraser/shape choices, toolbar and shelf header controls. App-owned CSS overrides shared
primary actions to white at rest without altering other applications or ink-colour swatches.
Browser verified six-inch chooser category/action fills and 1px borders, plus toolbar selected pen
black versus white resting tools. Native ink, geometry and refresh contracts unchanged.
26 Notes checks and Bigme build pass; installed successfully 2026-10-07 22:26:29.
Evidence: `artifacts/template-previews-2026-10-07/outlined-controls.png`.
APK: `notes-outlined-controls.apk`; SHA-256:
ef1094ec046eea7aa37da4ab68984cc9ce60a4d7ef5f6846d61764d39189a313.
Physical acceptance remains user-owned; no device input automated.

### 2026-10-07 Attached template catalogue, tabs and Custom folder

Categories use joined outlined accessible tabs (Recent/Work/Study/Personal/Custom), selected black.
Template paging reuses Notes' prev/next SVG icons with accessible labels and persistent page count.
An outlined page-shaped content panel attaches directly below the tab strip and contains previews
and pager. Six-inch browser client/scroll heights 585/585; panel top exactly equals tabs bottom.
Custom empty state disables Create and preserves the same three-slot layout.

Notes-owned bridge `notes.templates.list` creates/reads `/sdcard/Kalamos/notes/templates/custom`.
Folder was explicitly created on connected device and verified empty (`total 0`); no samples added.
Flat capped JSON files are parsed/validated by canonical writing source, registered with safe text
names, and rendered/created through the existing ruled model. Starter copies isolate new notebooks;
source words/ink/text boxes/free objects feed faithful previews. Native ink/refresh untouched.
Format, size/filename limits and coordinate behavior: `apps/notes/docs/CUSTOM-TEMPLATES.md`.

388 Writing tests, 26 Notes planning checks, typecheck/generated bundle, boundaries and Bigme build
pass. Browser checks include empty Custom, joined tabs, Work icon next to page 2 and attached panel.
An initial preview test assertion expected unsplit text; fixed to assert the actual per-word SVG.
APK installed successfully 2026-10-07 22:33:47. Physical panel acceptance remains user-owned.
APK `artifacts/template-previews-2026-10-07/notes-custom-tabs.apk`; SHA-256:
553df72a6468823a7f9014ae658f1f9d6eab46d930e5afdb84245abc7e6ade56.
Screenshot `artifacts/template-previews-2026-10-07/attached-template-panel.png`.


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

### 2026-10-11 Agent linked writing route

Notes now accepts a bounded Agent-writing launch request, maps each conversation to a Notes-owned notebook, and uses the canonical Done/Back save path before exporting all pages. Notes app overlay adds routing/export only; no writing, daemon, refresh or generated source changes. Return uses a cache-only FileProvider read grant. New app route tests 3/3 pass; Bigme and Standard builds pass; Bigme Notes and Agent updates installed with data retained. See ../../artifacts/agent-notes-writing-2026-10-11/VERIFICATION.md. Physical pen and Android handoff acceptance remains pending user testing.

### 2026-10-11 Library selection and direct Agent sharing

User clarified embedded Notes section in Agent, not an external app launch. Notes library long-press now adds Send to Agent and Select/Deselect; app-owned selection bar offers Select all across current-folder pages, Deselect all, Move, confirmed Delete and Done. Folder moves reject cycles; deleted folders retain unselected contents via reparenting. Neutral page exporter is shared with embedded Agent writing, preserving canonical ink ownership. Both apps installed with data retained; physical testing pending. Detailed receipt: ../../artifacts/agent-integrated-notes-2026-10-11/VERIFICATION.md.
## 2026-10-11 — Notes UI startup ordering repaired

- User reports older shelf and notebook toolbar after shared UI extraction. Notes synchronously reads KalamosToolbarIcons.svg, but its document.write dependency is queued until the current script returns. This can throw before onLibraryReady is registered, leaving neutral shelf chrome and fallback toolbar glyphs. Shared shell now loads the neutral icon registry with a parser-blocking script before app-overlay; Notes removes its redundant queued load. Keep this ordering when reorganizing assets.
- Regression executes the real icon registry and Notes overlay in shell order, deliberately leaving document.write dependencies queued, and verifies shelf hook registration and icon availability. All 39 focused Notes shelf/integration/handoff checks pass. Bigme APK build and data-preserving install succeed. Ink, refresh and fast scribble code are unchanged.
- Installed artifacts/notes-ui-startup-2026-10-11/notes-ui-startup.apk, SHA256 e0360edf1eacd5f8f05d444955075bdbb18d81ec8f86096634a38bed811f9d84; lastUpdateTime 2026-10-11 22:22:42. Browser tool still reports no connected tabs; prior localhost policy denial was not bypassed. Physical UI acceptance remains pending user reopen/test.
## 2026-10-11 — Retired Notes code deleted; redundant startup removed

- User confirmed the icon load-order fix and requested removal of obsolete code. Deleted archive/apps/notes-handwriting (separate old JS/CSS and six paper templates plus READMEs). Git history retains previous committed source; no runtime archive remains for this editor. Existing notebook conversion/backups stay supported to preserve saved notes. Shared reader/sketch controllers remain live consumers, not dead Notes code.
- Shared shelf now obeys libraryFolderBar before creating DOM, so Notes no longer creates/removes the unused folder-chip bar. Removed its cleanup branch. Agent no longer reloads the icon registry; both hosts use the one blocking shared-shell load. Regression covers enabled/disabled folder bars and shared icon loading without duplicate host loads.
- 427 Writing tests, typecheck/generated assets, boundaries, 51 focused Notes checks, 22 reader/KOReader checks and Standard native unit tests pass. Broad Node suite: 662/664 pass; two pre-existing Notes/Todo credential-packaging contract failures remain. Notes and Agent Bigme APKs build successfully. Installed data-preserving Notes cleanup APK at 22:26:38; artifacts/notes-cleanup-2026-10-11/notes-cleanup.apk SHA256 fda1b5820d49e7379f4d40c54cd49642481e956a847d2172262cceadf918bd93. Physical acceptance remains user-owned.
## 2026-10-11 — Shelf selection/navigation UI candidate (not installed)

- Read-only adb screenshot confirms the fixed selection bar covers the shelf navigator. Replaced text-only disconnected buttons with a joined icon/label group; routed clicks through closest button so SVG paths work. Selection strip now lives in library flex flow before the footer, leaving pagination accessible. Added Select all and Move glyphs to the neutral registry. Joined creation and pagination chrome, retained outlined white controls, and abbreviated visible page count while keeping its accessible description.
- Grid ResizeObserver handles selection/search height changes; preview width modestly reduces to preserve six complete cards where legible (minimum 110px when available), with smaller windows still paginating fewer rows. Interaction regression verifies selection across three screens and clicking icon children. 57 focused Notes checks and Bigme APK build pass. Ink/native lifecycle and refresh paths unchanged.
- Candidate artifacts/notes-shelf-ui-2026-10-11/notes-shelf-ui.apk. Not installed: user specifically requests browser design verification before deployment. CUA still reports no connected browser tabs, despite adb device connection. Earlier browser policy denial has not been bypassed. Resume with actual browser attachment, verify 6-inch/large layouts, selection/navigation and icons, then install after visual QA. Before screenshot retained beside APK.
## 2026-10-11 — Shelf UI browser-verified and installed

- Browser recovery: empty tab list was not a disconnected browser. Selected the existing IAB, created a fresh tab, found the local preview server stopped, restarted the standard layered preview server, then opened a fresh tab after its network-error page. No raw CDP or alternate-browser bypass used.
- Actual browser QA at 536×724 and 900×1200 confirms icons, connected selection strip, six/nine complete cards respectively, and navigator below the strip. Selected a note through its context menu, navigated Next and Last while retaining selection, confirmed boundary buttons disable correctly, and verified responsive pagination. Native panel acceptance remains user-owned.
- Screenshots: artifacts/notes-shelf-ui-2026-10-11/browser-six-inch.jpg and browser-large.jpg. 57 focused checks and APK build previously passed. Installed the same candidate with adb install -r, preserving app data. APK SHA256 4d1a8f4494cf348c21ce909d8a70af33bbba13ca19d927bf324223e83b163b06. Earlier candidate entry below records the initial verification blocker, now resolved.
## 2026-10-11 — Borderless page arrows and working Library settings

- Device screenshot confirms the density popover's children inherited fixed 48px footer icon-button widths, wrapping 2×2/3×2 vertically and clipping labels. Deleted that popover and its styles. Density now lives in Library settings, accessible through the footer gear or Library menu, with native radio semantics and explicit black/white styling outside the footer. Row/count labels derive from actual available grid geometry. Supported options are recalculated for the current screen width, including after resize. Removed the enclosing arrow border and page-label side borders.
- Browser QA at 536×724: select 4 notes, close, reload, confirm persisted choice, restore 6 notes and turn page; all works with unboxed arrows. At 900×1200: settings offers 4/9/16, and selecting 16 renders sixteen items with corrected paginator. Screenshots and before-device capture in artifacts/notes-shelf-settings-2026-10-11. 57 focused Notes tests pass; Bigme APK builds and data-preserving install succeeds. Native ink/refresh paths unchanged; user owns panel acceptance.
- Installed notes-shelf-settings.apk SHA256 e6e93140b5e422183efe566773df45b1e04071f560d151ff64fb441101d1f755. README updated with settings location.
## 2026-10-11 — Compact shelf chrome installed

- Shelf header is a 44px title/breadcrumb bar, down from 72px; footer is 64px, down from 78px. This returns 42px to the notebook grid. Deleted removed header-action DOM/styles; retained folder breadcrumbs/back navigation. Footer plus opens one New note/New folder chooser using existing creation handlers. Hamburger holds Search, Library settings (layout preference), import, sharing and sync. No standalone search or settings icons remain on the shelf.
- Shared creationCardsInGrid config renamed libraryCreationInChrome, reflecting either header/footer ownership; only Notes opts in. No old-name compatibility branch. Menus share one builder, icon labels, outside-pointer/Escape dismissal and listener cleanup. Ruled workspace toolbars, ink and native refresh behavior unchanged.
- Actual IAB QA at 536×724 and 900×1200: compact bar dimensions, six/nine card shelves, page turns, New note template chooser, New folder prompt, Search and Library settings from hamburger, outside-tap dismissal. Creation prompts cancelled to avoid fixture writes. Screenshots in artifacts/notes-compact-shelf-2026-10-11. 57 focused Notes tests and 427 Writing tests/typecheck/bundle/boundaries pass. Broad Node suite 663/665 passes with the two existing Notes/Todo credential-packaging failures; test-all stops there. Bigme APK build/install succeeds, preserving existing app data. Physical acceptance remains user-owned.
- Installed notes-compact-shelf.apk SHA256 f3b8a842d5576d52cb09f8286a3ab2db9cb9565e1a3da912d568b543de8143aa. README now describes the bottom New and hamburger settings/search locations.
## 2026-10-11 — Direct creation and larger shelf previews installed

- Replaced bottom plus/creation popup with separate Note and Folder icon/label actions. Existing creation handlers retained. Removed obsolete popup styling and plus glyph. On narrow screens below 480px only Previous/Next remain (first/last hidden) so all interactive controls fit with two 44px creation targets.
- Removed fixed preview width caps; calculate width from available shelf width and height, portrait ratio, caption budget, complete preferred rows and legibility floor. Reduced outer padding and row gaps to enlarge six-inch previews; retain rounding/tab margin and resize/selection observer. Browser measured six-inch preview width 158px versus previous cap 150px; nine-card larger-screen previews 196.5px versus cap 150px. Last row remains inside grid, including selection mode.
- Actual IAB checks: 536×724, narrow 380×700 and larger 900×1200, direct Note and Folder prompts (cancelled), six/nine card fit, selection page turning and complete rows. Screenshots in artifacts/notes-larger-previews-2026-10-11. 57 focused Notes tests and Bigme APK build pass; data-preserving install succeeds. Native ink/refresh code unchanged; user owns panel acceptance.
- APK notes-larger-previews.apk SHA256 283300f333ee0e5085cab7eccd220085ac1574751c9e82c974fac53516e38776. README describes direct creation and adaptive preview sizing.
## 2026-10-11 — Creation dialog overflow corrected

- Device screenshot shows huge black heading SVG pushing creation controls below the dialog. Recent shelf style removal accidentally matched notes-create-heading rules. Restored explicit 28px heading icon dimensions, unfilled monochrome SVG strokes and compact flex heading; commented why this is dialog-owned styling. Dialog uses border-box and preview max-height from viewport, with shorter-screen input/spacing budgets and portrait previews shrinking before controls overflow.
- Browser verified 536×724 Recent and Work categories: dialog scrollHeight equals clientHeight, Cancel/Create visible; 536×500 Work also fits (463px client/scroll height). Screenshots and before capture in artifacts/notes-create-dialog-2026-10-11. 57 focused checks and Bigme build pass. Data-preserving install succeeds. Ink/refresh paths unchanged.
- Installed notes-create-dialog.apk SHA256 390ef67d9ded909433991a151dc224b751ee3a03f081d731b5f1ff165b2e4ff4. Physical panel acceptance remains user-owned.
## 2026-10-11 — Folder preview missing-thumbnail/update fix

- Existing folder collage code was present but left notebook cells completely blank without a saved thumbnail and never registered folder slots for thumbnail completion. Folder notebook slots now reuse renderNoteThumb (paper placeholder when missing, actual image when available). Separate visibleFolderThumbs registry resets each grid render and refreshes all visible slots on onThumbnailReady/onCoverReady, even when no standalone notebook card is visible. Direct child folder silhouettes and four-slot hierarchy remain unchanged.
- Regression with actual DOM verifies a missing-thumbnail ruled note appears in its folder and is replaced by the asynchronous image without a standalone card. 22 focused shelf/folder/selection checks pass; Bigme build succeeds. Browser verifies existing one-image/four-slot folder rendering. Data-preserving install succeeds. Native ink/refresh behavior unchanged; actual To Do acceptance user-owned.
- artifacts/notes-folder-preview-2026-10-11/notes-folder-preview.apk SHA256 4d15d2fcbdd77a0d43ab9d34b49b7ec8a6d8bfd83b593df07d7dd2806c20dedf; browser screenshot retained beside APK.
## 2026-10-11 — Folder slot zero-height correction

- Follow-up device screenshot shows fallback paper collapsed to a horizontal border. Reproduced using isolated browser fixture with one missing-thumbnail notebook in To Do: slot height 0, paper height 2px. Shared cover align-items:center shrinks empty grid cells. Notes slot CSS now stretches both axes; fallback paper is absolutely inset into its slot. Browser confirms slot/paper height 108.3px and intact miniature page; existing saved-thumbnail slots remain visible. Previous DOM-only test did not exercise CSS layout, so this reproduction is the relevant visual evidence.
- 22 focused tests/build pass; data-preserving APK install succeeds. artifacts/notes-folder-slot-2026-10-11 holds APK, device before screenshot and browser fallback screenshot. Native ink/refresh untouched. Missing thumbnails show paper placeholders; actual saved previews display when available. User physical acceptance pending.
## 2026-10-11 — Folder Back hierarchy and header chevron installed

- Device screenshot confirms oversized circular folder-back styling. Notes now uses shared prev SVG in a plain 40px borderless header target within the 44px bar. Shared libraryNavigateUp handles one parent at a time, resets shelf pagination, returns false at root; both header click and App.onAndroidBack use it. Custom app-rendered shelves bypass this helper to retain their existing routing.
- Regression invokes actual App router from child folder: child→parent→root without exit, then one exit at root. Browser six-inch header screenshot and parent button return to root verified. 427 Writing tests/typecheck/bundle/boundaries pass; broad Node suite 665/667 with the same two existing Notes/Todo credential-packaging failures. Bigme Notes build/install succeeds, preserving data. Hardware Back acceptance remains user-owned.
- artifacts/notes-folder-back-2026-10-11/notes-folder-back.apk SHA256 154018120511026c0e5371daee8b5bcc2e75a7469822c26765477e36e3cf2336. Before device/header browser screenshots retained beside APK. Ink/refresh unchanged.

## 2026-10-12 — Latest Notes Standard build installed on Huion

Built the latest working-tree Notes source for Standard Android and installed on Huion Note E (Android 15/API 35, ARM64, <ANDROID_DEVICE_SERIAL>). Existing standard WebView writing route retains the prior Huion toolbar/ink fix; no runtime changes were required. Signing matches the previous installation; adb install -r succeeds with app data retained. Pulled installed APK hash matches candidate b696a7f25fb64f8726fa675b8f3b9f9a77dc91dba46296001deb22f9bfa8448f. Previous APK/private app data backed up locally, excluded from future publication.

427 writing tests/typecheck/regeneration/boundaries pass; broad apps 665/667 and Notes 65/66 retain existing credential-packaging failures. Reader/KOReader 22/22 and Standard provider/shared runtime native unit tasks pass; APK builds. Standard manifest/DEX verified with no Bigme/hidden-API bypass; all app/writing assets match source. No physical interaction or acceptance claimed. User device testing and later explicit private GitHub publication remain pending. Receipt: artifacts/notes-standard-2026-10-12/VERIFICATION.md.

## 2026-10-12 — Standard scribble wet-ink trail cleared on release

User reports the crossed word disappears but its scrub remains until writing again on Huion. Device screenshot saved at artifacts/notes-standard-2026-10-12/scribble-before.png confirms visible trail after hello. WebView finishGesture accepted the erase and relaid out saved SVG ink but skipped the separate live-canvas cleanup normally performed by commitWriteStroke. Accepted pointer scrubs now clear only their temporary wet-ink footprint immediately. Native daemon callback, recognition sensitivity, persistence and panel policy are unchanged.

Regression dispatches Standard pen down/move/up, verifies actual canvas clear and erased model without another pen stroke, and confirms one Undo restores only the original word. 428 Writing tests, typecheck, regeneration and boundaries pass; broad Node 665/667 retains existing Notes/Todo credential-packaging failures. Initial regression used Array.at beyond the configured TS target; corrected to indexed access before the successful checks. Standard APK builds; packaged feature assets match source and Standard provider is selected without Bigme DEX. adb install -r succeeds, data retained, installed SHA256 matches 826277db5ca2800f108f93d8a057904521490880bc3dadd5a09520968312b45e. Physical acceptance awaits user reopen/scribble test. Artifact: artifacts/notes-standard-2026-10-12/notes-standard-scribble-clear.apk.

### Bigme follow-up audit, 12 October 2026

The Standard wet-canvas cleanup gap is not present in Bigme native writing: accepted scrub results trigger bounded native synchronization without another stroke, stage vectors excluding the erased word and discarded gesture, capture the clean page region, and replace the daemon bitmap using SRC plus regional GC16 clean refresh. Existing native tests cover idle reconciliation without another pen event and no duplicate capture/daemon reattach. All 43 native bridge tests pass; Bigme Notes APK builds successfully. Bigme candidate saved as notes-bigme-scribble-check.apk beside this receipt, not installed on the attached Huion. No physical Bigme acceptance claimed; panel verification requires the user on Bigme hardware.

## 2026-10-12 — Notes standalone integration audit and cleanup

User requests tidier Notes code and deletion of other app integrations except KOReader. Removed Notes-owned Agent send/import/picker/linked-writing code, activities, cache provider, bridge methods and UI controls; kept previously created/imported notebooks as user data. Deleted the no-op NotesApp subclass, unused page-export helper load, redundant direct documents dependency and misleading Sync status placeholder. LocalAppBridge now owns existing neutral status/HWR/event delivery; Notes extends it directly, without AI/network dispatch or a disable flag. CoreAppBridge retains existing services for the other hosts. Notes no longer reads shared Agent-managed provider status/credentials. Shared library assets/classes remain necessary to other apps and are not claimed to have been stripped from unminified debug packaging.

No direct Notes routes to Todo/Books/Learn/Play/Explore were found. Notes has no direct KOReader launcher; integrations/koreader and existing reader support are retained. Ordinary Android file/print export and local MyScript HWR remain. Notes presentation tests now use neutral modules instead of Agent sources; retired Agent-route and stale Notes embedded-credential expectations replaced by standalone boundary checks.

65 Notes checks and 428 writing tests/typecheck/regeneration/boundaries pass; broad apps 665/666 retain one existing Todo credential-packaging failure. Final Notes/reader/KOReader 87/87 pass separately. Standard native unit/build, Bigme Notes build and Agent/Books Kotlin compilation pass. Both APKs verified to lack Notes Agent activities/classes/asset/provider and match current app/writing assets. Standard installed data-preserving on Huion; pulled installed APK SHA256 matches 820b6709127f36ed007e67daf413f51d16a223b7f196f4333fb0e3d7847670cf. Bigme candidate built only. No physical navigation/ink/recognition/export acceptance claimed. Full audit: apps/notes/docs/CODE-AUDIT.md; receipts/APKs: artifacts/notes-standalone-audit-2026-10-12. GitHub publication remains pending user acceptance and explicit instruction; private only.

## 2026-10-12 — Notes/Agora linked-document candidates installed

Implemented the approved Notes-owned document/Agora immutable attachment and proposal workflow.
Dedicated content-URI ZIP boundary, exact revisions and proposal identities, reviewed task/text
materialization, non-destructive HWR, originals and preserved editable ink/shapes, native-flushed
canonical toolbar action, same-draft Agora CAS, chooser, settings, completed tool/JSON/text support
and backup references. No removed Kalamos Agent routes restored. Actual source is Agora-eink;
Agora-interactive remains clean. 435 writing and 90 Notes/reader checks, native/bundle tests, both
Notes builds and Agora 3071 Play/3088 F-Droid tests pass. Aggregate Kalamos apps 668/669 retains known
Todo credential expectation failure. Bigme Notes and Agora e-ink preview installed data-preserving
on attached <BIGME_DEVICE_SERIAL>; pulled APK hashes match. Standard APK built for disconnected Huion.
No device UI/ink/model acceptance or live paid request claimed. Independent handwritten annotations
are retained on editable preserved pages, not automatically re-anchored into rewritten text. Details,
hashes and remaining user acceptance: artifacts/notes-agora-2026-10-12/VERIFICATION.md; contract:
apps/notes/docs/AGORA-INTEGRATION.md. Private GitHub publication remains pending user confirmation.

## 2026-10-13 — Notes/Agora navigation and toolbar correction installed

The initial 12 October integration was rejected by the user. Corrected nonexistent shell editor API,
startup hook ordering, shared WebView stealing, delayed close/reopen, hidden return, canceled/recreated
launches and competing draft/editor owners. External Notes has an isolated real editor, reserved
native header, explicit Attach to chat and save-without-attachment Back. Agora keeps its own task and
resumes one exact unfinished request with its original owner. Notes' expanded toolbar now has Agora;
long-press integration removed. Prepare→await close→launch and saved return route reload the same note
without an old model overwriting accepted revisions. Searchable chooser/readable review UI visually
checked at six-inch/narrow/keyboard sizes; native Android header rendered and geometry tested.

436 writing, 95 Notes/reader/KOReader checks, root Standard native unit tests, 3077 Play and 3094 F-Droid
tests pass (three skips each Agora flavor). Aggregate Node673/674 retains existing Todo credential
expectation failure; later stages ran separately. Both Notes targets and Agora preview build. Bigme
Notes/Agora updated data-preserving; pulled installed hashes match. No physical pen/task/panel or paid
model acceptance claimed. Standard candidate built only for disconnected Huion. Private GitHub awaits
user acceptance and explicit instruction. Evidence: artifacts/notes-agora-redesign-2026-10-12/VERIFICATION.md.

## 25 October 2026 — ChatGPT account and plan connection

Notes AI settings now opens app-owned native ChatGPT account controls: browser PKCE/OIDC sign-in, saved accounts, explicit plan consent, live model catalog, account selection and logout. Account secrets use an Android Keystore vault and are excluded from cloud backup and device transfer, including interrupted SharedPreferences backups. Credentials never enter the WebView bridge, notebooks or proposals. Auth is adapted from LearnHarness with its AGPL license retained; no sibling dependency or source-sync script was added.

Plan formatting uses the official Responses endpoint with `store:false` and `stream:true`, then creates the existing reviewable page proposal only after `response.completed`. Partial, failed and incomplete streams cannot become revisions. API-key settings remain separately selectable; plan errors never fall back to a saved API key. Plan requests use the model's default reasoning behavior rather than carrying API-provider thinking settings across billing routes. Account eligibility, consent and live inference still require owner sign-in. Device ink and refresh policy are unchanged.

Validation: all 123 Notes JVM tests and 135 Notes web checks pass; the Standard Android APK builds. This includes signed identity/PKCE/callback tests, completed-stream-only proposals, disconnected-plan refusal to use a saved API key and backup exclusions. Candidate: `builds/2026-10-25/kalamos-notes/Kalamos-Notes-standard.apk` in the parent working directory; SHA256 `0ba9a6253a22ccdd0ab71a55ac6a828a7d43b80ae23dea53df5dff2c7278f4c8`. No device was connected to ADB at completion, so this candidate was not installed. Live sign-in and physical acceptance remain with the owner.
