## 5 November 2026 — Huion lower-row fix accepted by owner

Owner physically tested the installed lower-row candidate on Huion Note E and confirmed:
“yep that works well”, explicitly accepting the fix and requesting a GitHub push.
Treat the Standard blank-lower-row live-ink correction as owner-accepted on this device.
Installed APK SHA256: d35f30a04df18ba38f47bf4393a02eb993b85799434d7f50130c3f509b1b1e67.
The full shared suite passes (752 writing tests, 165 web/content checks, Android unit checks,
typecheck and source graph); Standard and Bigme debug APKs build with canonical generated assets.
This acceptance does not establish Bigme physical panel acceptance, which remains pending.

## 5 November 2026 — Live ink on blank lower rows

Owner narrowed the remaining Huion symptom to starting a word on a new line. Read-only WebView
inspection found a 456.605 CSS-pixel canvas inside 928 pixels of visible paper. The live canvas
and delegated ink presentationArea were sized to committed content, initially only three lines.
The first stroke below that content could therefore be clipped until pen-up grew the canvas;
successive lower strokes also resized its backing buffer. This is a reproduced rendering defect,
not physical confirmation of every reported stutter's cause.

Standard/browser live canvas now covers at least the visible paper, while preserving the existing
committed document height, coordinates and model. Height-only ResizeObserver updates extend the
presentation area and repaint a confirmed in-progress stroke. Dirty/full clears use actual canvas
extent so writing below the old content height cannot leave wet-ink residue. Bigme native canvas
sizing, daemon input, snapshots, refresh timing and ownership remain unchanged.

Regression tests reproduce the old 132px buffer on 900px paper, cover several new rows without
buffer reallocation, and preserve an active stroke through height-only resize. In real desktop
Chromium, four strokes on previously blank rows had zero live raster pixels before pen-up with the
old implementation; the fix paints all four immediately. Initial/final canvas heights change from
132/492px before to 894/894px after, with identical saved point geometry. Synthetic testing disables
delegated trails; actual compositor/device latency and Bigme panel acceptance remain owner-tested.
Reference: https://github.com/WICG/ink-enhancement documents presentationArea clipping to the element.

The previous clean standard APK was installed data-preserving on Huion G2DL3SH00568 and its hash
verified (dcec5157c0dc0f5f8076ed49866836fa29d20fc5fd5ceba54377528cebb94d03).
This lower-row correction was subsequently installed data-preserving and hash-verified; the owner
accepted it as recorded above. Local build/native-migration/newline-verification.json records installation. No automated device pen gestures or notebook mutations were used.
Validation: 752 writing tests, 165 Notes/content checks, typecheck, source graph and the full
Android unit suite pass. Standard and Bigme debug candidates contain regenerated canonical assets.

## 5 November 2026 — Shared source cleanup and stroke-boundary work

Owner still reports stutter when starting strokes/words on the Huion. Read-only WebConsole logs
show pen-down draw times mostly 0.1–0.4ms after the first 4.1ms contact, with dispatch around
3.4–5.7ms and pen-up work up to 11.8ms in that sample. These do not establish the physical cause.

The shared committed-ink renderer now caches bounds of immutable strokes/arrays with weak keys,
keeps identity for zero-distance translations, skips unchanged SVG attributes and retains existing
paths when appending a letter. Geometry changes and Undo still rebuild the affected vectors.
Confirmed input, pressure/tilt/timestamps, prediction exclusion, native ownership, Bigme snapshots,
refresh cadence and protective SDK handoffs retain their contracts.

Removed the unused parallel React editor/reader, duplicate styles/preview entry, 13 dependency
packages, retired edit state machine, unused export/drawing/automatic-shape implementations and
unused spacing function. Browser preview now runs the canonical Android editor. Extracted the
shared commit type and removed the geometry/render circular dependency. Both device builds consume
this cleanup. Removed BigmeInkExperiment and its tests only after confirming no production caller;
the Bigme provider and production daemon/panel safeguards remain. A source-graph check now rejects
unreachable production TypeScript modules and runs in tools/test-all.sh. This is an audited cleanup,
not a claim that all future maintenance work or all device latency has been eliminated.

Validation: 750 current writing tests, 165 Notes/content checks, typecheck, source graph and the
full Android unit suite pass. Removed test cases covered removed implementations; current behavior
has additional bounds-cache, SVG identity, unchanged-word and Undo regressions. Production browser
preview opens the sample reader and editor with no page errors. Android assets regenerated from
canonical source. Standard and Bigme APKs built; Bigme-specific unit checks pass. New APKs are
candidates, not installed or physically accepted.

One desktop Chromium comparison of 120 strokes reduced committed SVG attribute changes from
12,100 to 160 and measured boundary work from 66.0ms to 47.9ms total, with identical 2,640 saved
confirmed points. Synthetic input disables delegated compositor trails; this is not device latency.
The previous installed Huion build remains the comparison baseline. Physical Huion/Bigme testing
belongs to the owner. Android Gradle Plugin still emits upstream Gradle deprecation warnings;
no unverified toolchain migration was mixed into the ink cleanup.

## 5 November 2026 — Standard live-ink batching and removal of retired formats

Owner reports intermittent latency during continuous Huion pen strokes. Read-only Android
graphics statistics show occasional slow frames, but do not identify the cause of the reported
physical pen stutter. No automated gestures were performed on the physical device.

Standard pointer input previously rebuilt/cleared/filled the full live outline for every
pointer-move event. It now immediately ingests every delivered coalesced sample (including
pressure, timestamps and tilt), while scheduling at most one outline redraw per animation frame.
Contact still paints synchronously; the latest predicted tail is presentation-only, replaced on
the next event, and never saved. Pen-up/cancel, tool changes, canvas clearing and destruction
cancel and invalidate queued paints. The committed renderer and model, erasers, selection,
Undo/Redo and Bigme daemon ownership are unchanged. This reduces redundant burst work; it does
not make a long outline constant-cost or establish a physical latency improvement.

Primary references checked:
- Chrome input alignment: https://developer.chrome.com/blog/aligning-input-events/
- Confirmed/coalesced/predicted event contract: https://www.w3.org/TR/pointerevents3/
- Android native in-progress ink: https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/ink-api-modules

No desynchronized/front-buffer mode was enabled: Chrome documents tearing/flicker concerns,
and this workspace clears a temporary canvas before committed SVG handoff. Native Android Ink
API remains a candidate for a separate standard-provider implementation; adopting it needs a
complete input/model/presentation handoff rather than another concurrent stroke owner.

Per the owner's explicit new-app/no-backward-compatibility direction, removed Notes' handwriting
upgrade loader, vector converter/API, upgrade backups/writes and associated retired-format tests.
Removed version-0 sidecar upgrading and the embedded Markdown restoration-appendix importer.
Current notebooks and ordinary Markdown import retain their paths. Unsupported notebook metadata
is rejected before editor entry; no device notes were converted, deleted or reset. Existing format
identifiers are kept because renaming current files adds work without simplifying the implementation.

Validation: 755 writing tests, typecheck, regenerated Android assets, 165 Notes/content web tests
and the full `tools/test-all.sh` Android suite pass. Standard and Bigme debug APKs build;
Bigme Notes/runtime/provider checks also pass. Packaged current assets match source and the
retired upgrade loader is absent from both APKs. A desktop Chromium
burst fixture sends 1,440 moves across 120 frames: live redraws decrease from 1,441 to 121,
with identical 1,257 confirmed saved points. Measured draw work in that one run is about 140ms
before / 32ms after; this synthetic burst is not an on-device latency benchmark and disables
delegated compositor trails because synthetic events are untrusted. Physical Huion pen testing
and subsequent Bigme acceptance remain owner-run. The standard candidate was installed on the
connected Huion Note E using `adb install --no-streaming -r`, preserving app data. Installed
SHA256 matches `422abf48c76d5ff4df6eb8cca2c887d2f0e314a65bd0b52e8679c1de0c4fa0e3`.

## 5 November 2026 — Native Android library presentation, first migration stage

Fetched GitHub before editing: local `main` and `origin/main` matched `7ef0a41`; the only
other remote branch (`codex/chatgpt-plan-support`) had no commits absent from local HEAD.
Work is isolated on `codex/native-library`.

Notes now presents ordinary notebook/folder shelf cards with Android views. Saved previews
decode directly from the active storage root on one worker, sampled to card size, and a complete
visible page is published together. This removes visible shelf thumbnail base64 transfer and
WebView image/card construction on the native path. Card width/placement comes from the existing
CSS shelf geometry; grayscale previews, rules, folder tabs/collages/counts and captions retain
the existing appearance. Native taps, long press and folder drops delegate canonical JS actions.
Revision/generation fences reject stale interactions and late decoding after navigation or release.
The existing cache-holder service teardown owns native view/worker cleanup; no extra lifecycle
layer or dependency was added.

`-Pkalamos.nativeLibrary=true|false` controls the presentation at build time. Standard Android
defaults to true; Bigme defaults to false for the initial standard-device review. The optional
Bigme native-shelf build is a later testing candidate, not physical panel acceptance. Menus,
selection mode, integration pickers and book/list/empty states retain their established web
presentation. The JS library remains the sole owner of sorting, paging, storage mutations and
notebook migration/routing. Writing, pen coordinates/pressure/hover, ink lifecycle, snapshots,
refresh policy and generated writing assets are unchanged. This is a shelf migration, not a
completed native writing-editor rewrite, and APK size/startup/pen-latency improvements are not measured.

Validation: 752 writing tests and 168 Notes/content web tests pass. Native checks pass for
Notes (128 tests, one skip), shared runtime (61), standard provider (6) and Bigme provider (23).
Standard, ordinary Bigme and opt-in Bigme native-shelf debug APKs build. Robolectric renders
the native shelf for visual inspection and covers host clamping, callbacks, cancellation/release,
direct PNG loading and grayscale display without changing stored previews. Chromium compares the
real web shelf layout to its native geometry payload at 360/674/900 CSS pixels, with matching
widths, under 0.03px horizontal difference and under 3px row-position difference in those fixtures;
creation-dialog open/cancel retires/restores native cards. The missing `tools/test-all.sh`
referenced by repository rules now runs this export's own web, writing/typecheck and Android tests.
Removed stale preview-script documentation and corrected obsolete notebook-numbering guidance.
The standard native-shelf APK was subsequently installed on the connected Huion Note E with
`adb install -r`, preserving app data. Installed SHA256 matches the build:
`c6f5e14c182e79675e96973f13ce89811882073abafb08ed25d48bccdd066a64`.
Physical pen/panel and device performance acceptance remain owner-run.

## 25 October 2026 — Notes ChatGPT plan support

Notes-owned native account connection, explicit plan/API billing selection, encrypted OAuth vault and completed-only Responses formatting are described in [apps/notes/HANDOVER.md](apps/notes/HANDOVER.md). No feature, vendor or writing implementation was changed. Device acceptance and live account sign-in remain with the owner.

## 25 October 2026 — Move-first lasso and faster compact tool switching

Successful lasso selection now leaves the content immediately draggable. A 44px More actions
(…) button follows its bounds; only tapping it opens the existing small tool menu. Tapping again
closes it. Commands use Copy, Cut, Paste, Duplicate, Delete and Select again; Share text remains
available for typed/Markdown content. The selection menu no longer opens automatically.
Interaction references: OneNote's separate movement/actions interaction and Zoom Whiteboard's
More control:
https://support.microsoft.com/en-us/onenote/onenote-for-ipad-or-iphone-help-and-learning/lasso-select-ink-strokes-in-onenote-for-ipad-or-iphone
https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0058334

Write → Lasso keeps the attached native session and changes its pen type to selection. A compact
switch with unchanged paper geometry now reports one toolbar region instead of duplicate full-page
layout notifications. Its existing serialized regional capture uses the existing 32ms expedited
scheduler rather than the 160ms general scheduler. Flush-before-action, dirty-region union, full
retained-content capture and the 180ms input guard remain. Expanded/changed geometry keeps the
normal layout path. These scheduler values are not measured end-to-end physical latency.
No vendor daemon, waveform or ink-mode policy changed. Owner performs physical-device acceptance.

Validation: typecheck, all 752 writing tests and 133 Notes web tests pass; Android assets regenerated.
Standard and Bigme debug APKs build. Bigme installed with adb install -r, preserving app data.
Packaged JS/CSS match the generated assets. APK SHA256:
c6b49c25d2ff7e6ec8e29b24cf50a1013588c6f8ef76349360dc46a16549125a.
No automated physical pen/panel testing was performed; the owner is testing the installed update.

## 25 October 2026 — Selection actions, cross-page clipboard and spacing overflow

Lasso now enters capture directly, without opening a settings pop-out over the first stroke.
Restarting it clears the old move/direct-selection state before selecting the existing native
dashed selection pen, matching erasing-lasso ownership. Successful selection reveals a contextual
menu automatically: Copy, Cut, Paste, Duplicate, Delete, and Share text for typed/Markdown words.
Native selection still hands off to WebView movement after the completed batch. No vendor input,
waveform, capture queue, refresh timing or daemon lifecycle implementation changed.

A fixed Paste control is available in compact/full tools, disabled without clipboard content.
The writing-owned clipboard is verified in private WebView storage before Cut removes anything;
page changes/editor destruction and process recreation retain it. A failed write leaves the source
selection untouched and reports an error. Paste clones identities and preserves vector appearance,
selected word placements, inline styles and semantic task/heading data; task checkbox identity and
state move with their owner. Cut and Paste each use the existing page-local Undo while that editor remains open.
The clipboard persists until replaced, and its contents never belong in Git or device captures
uploaded to the repository. Sharing uses the existing Notes-owned Android text/plain Markdown
chooser, including the selected words' marks/structure; handwriting is not OCR'd or sent as text.

Positive vertical spacing uses the pre-gesture viewport height for pagination. The immutable split
still publishes complete files before the manifest and retains the original files; it now activates
the first new continuation page so the displaced rows are immediately visible. Other manual pages
remain ordered and untouched. Existing tests cover metadata, original vector identity and reopening.

Validation: writing751/typecheck/Android regeneration and Notes web133 passed. Notes native99
(one skipped) and shared runtime61 passed. Standard and Bigme debug APKs build; installed the Bigme
build via adb install -r, preserving app data, and verified installed SHA256:
3ac58b9ed1f2b7aab505c3616db1d7da66f64b43b12dad11641188a6c209bdfc. Installed runtime inspection
confirmed normal/restarted Lasso requests the selection pen, has an attached native session, and
opens no preliminary menu; erasing lasso requests the same pen type. The Paste control is visible.
Owner is performing physical pen/e-ink acceptance; screenshots do not certify it.

## 24 October 2026 — Compact controls, movable tab and AI scope

Compact Notes exposes Add page and one-tap horizontal spacing. Expanded tools close directly to
the collapsed tab. The collapsed tab arms movement after a 400ms hold; the open pill retains its
six-pixel drag threshold. Both accept pen/touch, keep the existing flush-before-handoff and final
bounded capture, and suppress the drag's delayed compatibility click. Toolbar position is a shared
writing preference restored on page changes/reopen and clamped to available geometry. Expanded
chrome ignores floating offsets. The collapsed tab and open compact grip now share the open
menu’s 48px outer width, 46×40px handle, full outline and 7px corner radius; only the tool rows
are hidden. Removed the old narrow/tall tab sizing and edge-only position override. No daemon cadence, capture queue or waveform changes.

Tapping Format with AI opens the same measured small menu used by the pen tools, with exactly
“Format this page” and “Format this whole notebook”. Selection pins the page before the native flush;
opening or dismissing the menu makes no provider request. Removed the superseded AI long-press
plumbing and unused singular documentAction API. One shared typed documentActions contract now
owns commands and their optional menu choices. The older notebook converter remains because the
current migration path still needs it to preserve existing notes.

Positioned collapsed tabs have a complete rounded border on both sides, instead of retaining the
left-edge tab’s open border. Owner confirmed the previous installed update was substantially better;
this outline correction was identified in a local ADB screenshot. Captures and user notes stay local.

Entire-notebook formatting keeps the original page IDs in an app-owned persistent queue, uses the
existing image-only native job per page, and checkpoints/validates each new revision before the next
request. Each successful page saves before continuing; an error stops the remaining queue. A pending
native job can finish while Notes is closed; reopening the notebook resumes remaining pages. New
overflow sheets are not added to the original conversion scope. Existing per-page revision validation,
Undo and idempotent application remain authoritative.

Default notebook numbering uses only current library titles; deleted/renamed notebooks and the old
local counter no longer reserve numbers. With no numbered titles remaining, creation starts at
Notebook 1. Imported numbered titles still prevent collisions.

Validation: writing745/typecheck/Android regeneration; Notes web132; Notes native99 (one skipped)
and shared runtime61 passed. Standard and Bigme debug APKs build. Installed the Bigme build with
adb install -r, preserving app data, and verified its installed SHA256:
0196ed3fd49de76d2df4a056046731193a67e240417961dc174ffa8f09c90b10. Local ADB screenshots and WebView inspection verify the complete
floating-tab border and two-option AI menu with outline icons; opening it starts no formatting.
A subsequent installed-device check verifies equal collapsed/open compact handle dimensions
(46×40 CSS px), outer width (48 CSS px), position, outline and corner radius.
Physical pen latency, retained panel appearance and gesture acceptance remain owner-run.

## 21 October 2026 — Delayed erase flash resolved: per-client idle recommit

Owner still saw a whole-panel flash after the local erase completed. The captured reproduction
issued one bounded GU16/GC16 erase transaction, no later JS refresh, no daemon detach/reattach,
and an ordinary model-only idle save around 2.5 seconds later. Android screenshots/explicit app
refresh logs cannot certify physical-panel behavior. Firmware inspection confirmed
HandwrittenClient.setRecommitEnabled(boolean, int delay, int mode) forwards to the service with
that registered client's ID. Bigme now explicitly disables this independent idle replay immediately
after connect, before input/overlay activation; an absent optional API logs a warning and retains
writing. It does not change package policy, waveforms, the capture queue or the existing 180ms
input gate. After the data-preserving installation, the owner confirmed that the delayed flash
was gone on the connected Bigme. This acceptance covers the reported scribble-erase regression;
it does not establish compatibility with other firmware versions.

Also removed hidden reader rendering from direct-editor commits. An integration regression exercises
actual erase, native idle-save dispatch and app persistence: erased ink and image references save
while every editor DOM node remains unchanged. This failed before the direct-host guard because
idle saving rewrote hidden filename DOM. Reader-mode commits retain their reader refresh.

## 21 October 2026 — Direct Select beside Lasso

The pointer button selects words or the topmost page object by pen contact using the existing
selection/movement engine in WebView mode. It does not ask the daemon to capture a lasso, and
blank-paper contact creates neither ink nor a selection trail. Image selection exposes the same
corner/edge grips and delete control. Word selection retains grouping, movement, Undo and the
shared selection-actions menu (tap Select again). Lasso remains the separate group-selection tool.
Compact/full toolbar footprints each gain one fixed row; wrapping still depends only on viewport.
Attachment DOM caches include the direct-selection mode so switching from a moved lasso selection
cannot reuse an inert image hit target. Owner performs physical pen/e-ink acceptance.

## 21 October 2026 — Direct attachment picking, image grips and local erase damage

Attach menu rows accept matching pen releases and suppress the same contact's compatibility click.
Image/audio/file open Android's picker directly, without a second status panel. Link opens URL entry.
Cancellation restores the small menu under the same dialog owner. Selected images have eight grips:
corners retain the current ratio and opposite corner; edge midpoints change one axis. Centre drag
moves the image; Undo/save and SVG/canvas thumbnail/export preserve its resulting dimensions.
Add Page now precedes Previous in the expanded header, reducing the left rail by one item.

Surface.lockCanvas(Rect) can enlarge its in/out buffer-damage rectangle. commitPage now passes a
copy, keeping the caller's e-ink presentation and erase-clean bounds independent of buffer damage.
The native regression reproduces enlargement to the full surface and verifies a local refresh and
cleanup with image content retained. Unchanged image DOM nodes also remain mounted during unrelated
writing/erase reconciliation, with explicit object stacking instead of detach/reinsert on every pass.
No daemon reconnect, waveform, capture queue or scheduling changes. Physical acceptance is owner-run.

## 21 October 2026 — Compact AI action and page attachments

Compact Notes replaces Zoom with the existing Format with AI action without adding a row. Zoom
remains in expanded tools. Expanded tools include one Attach menu, use a fixed single column when
it fits, and retain the smaller-screen two-column layout without rail scrolling. The menu follows
the existing small pen-menu presentation; audio cards contain play/pause and elapsed/total time.

Files import through Android's picker on a Notes-owned IO worker into the active data root's
immutable attachments store. Shared workspace page objects own geometry, image aspect-preserving
resize, move/delete, Undo/save, snapshots and self-contained image export/thumbnail rendering.
Links open externally; files use a narrow FileProvider cache. No app/sibling source dependency or
provider/AI request. Native audio releases on background/close and observes audio focus. Timer
updates never mutate writing DOM while the daemon is active; pen audio controls reuse bounded
widget reconciliation and single-owner activation. No vendor code, daemon cadence, waveform or
hard-close mechanics changed. Resource IDs remain valid across page copies and Undo.

Physical testing remains owner-run. Desktop checks and builds do not certify e-ink acceptance.

## 20 October 2026 — Fail-closed API credential storage

Removed the plaintext fallback when Keystore encryption is unavailable. New writes require
verified AES-GCM ciphertext and checked synchronous preference commits; a failed write preserves
the existing credential. Legacy plaintext migrates in place and must be encrypted/verified before
substitution. Keystore reads do not create replacement keys; key creation is serialized, fresh IVs
remain required. Secret preferences and their interrupted-write .bak file are excluded from both
legacy backup and Android12+ cloud/device-transfer routes. Provider URL changes cannot inherit a
saved credential without an explicit new key or clear operation. Keys remain native-only.

JVM security regressions use real AES-GCM; Robolectric explicitly injects that cipher rather than
relying on the removed plaintext fallback. No provider calls, device installation or physical-panel
acceptance was performed. See .local/tidy-2026-10-20/verification.json for final checks.

## Upstream attribution and ink licensing — 19 October 2026

Added prominent original-project credit and licence scope. Ink modules now use GPL-3.0-only;
Ed Wei's original InkSDK is credited in module notices and docs/licensing/INKSDK.md. Original
reader plugin/bridge AGPL and launcher/JNI MIT notices remain separate. Complete licence texts
and dependency attributions are included. Licensing/documentation changes only; no pen behavior,
refresh policy, binary build or device acceptance change.

## Remove retired MyScript provider — 19 October 2026

Removed the SDK dependency, native recognizer, app certificate and all bundled recognition
resources. The shared recognition contract reports unavailable without an optional host provider;
AI formatting and normal pen input remain independent. Standard and Bigme APK builds, runtime and Notes native
tests pass; the independent Standard export also builds and tests without MyScript.
Writing718/typecheck/regeneration pass; the monorepo full apps gate retains its
unrelated Todo credential assertion. Rebuilt APKs contain no MyScript assets, native libraries or classes. No installation or
physical-device acceptance is claimed for this change.

The public source history excludes the retired certificate/resources and local machine paths.
API credentials, notebooks and build artifacts must remain outside Git.

## Reusable InkSDK and generic reader contract — 19 October 2026

Shared API/providers now expose optional editing capabilities so KOReader can reuse Notes'
Standard MotionEvent pen implementation. Standard backing updates use SRC for authoritative
transparent clears; capture-only gestures and cropped chrome preserve ordinary writing. Bigme
method bodies/cadence unchanged. Notes still owns document semantics above the ink SDK. Native
API/provider42 tests and Notes87 tests (one skip) pass in the canonical workspace. Generic/Bigme
builds remain separate packaging targets; there is no app-to-app or sibling source dependency.

## Toolbar foreground and single checkbox pen owner — 19 October 2026

Independent export recheck:718 writing tests, typecheck and Android regeneration;116 Notes web
checks;58 runtime and87 Notes native tests (one skip); Standard and Bigme Notes APK builds pass.
All515 exported application/feature/runtime files match the canonical current source byte-for-byte.


Synchronized the latest canonical Notes source after owner confirmation that the checkbox fix works.
Expanded chrome now retires the compact toolbar bitmap through the native capture queue without
recreating the ink surface. Checkbox pen contacts have one native owner while native writing is
active; WebView finger taps and non-native pen mode retain ordinary controls. This handles native
batch delivery after an earlier WebView event, including late compatibility clicks after DOM redraw.
Temporary pen marks are cleaned without saving them. No daemon cadence or waveform changes.

Canonical validation: 718 writing tests/typecheck/regeneration/boundaries and 125 Notes/reader checks
pass. Standard native runtime58 and Notes87 tests (one skip) passed for the native toolbar handoff;
both Notes targets built. Latest checkbox Bigme APK installed data-preserving and verified by pulling
its installed hash:08751b401919380ff78afc249f5e115fabdeea2060a08318d34a3422f5bc558d. Device artifacts,
notebooks and API settings are excluded from this repository. Physical testing belongs to the owner.

## Protect new handwriting in blank areas — 19 October 2026

Native delivery now snapshots eligible old ink IDs once before ingesting a stroke batch. Later
strokes cannot erase earlier fresh strokes from that same batch; with no old ink or typed text,
scribble recognition is bypassed. Word-level erase expansion also honors eligibility. A later
batch can erase the written word normally. No gesture thresholds/classifier or native daemon
lifecycle changes.713 writing tests pass, including blank paper, older ink elsewhere, later erase
and Undo, and old-word expansion preserving fresh strokes. Physical device testing is user-owned.

## Pen checkbox marks — 19 October 2026

Native checkbox gestures accept a short tick/X starting on the control, including a bounded
outgoing tail. Refresh cleanup covers the whole mark; no gesture stroke is saved. One control
activation per delivered native batch handles multi-stroke marks. New batches can uncheck it.
Contacts starting outside and long outgoing strokes remain handwriting. WebView pen release
still toggles once without its compatibility click double-activating. Existing Undo/save contracts
remain.710 writing and115 Notes web tests pass; Standard/Bigme builds pass. Physical testing belongs
to the owner. The pictured Markdown inventory deliberately backticks its literal examples;
normal bold, italic, combined and strike render correctly in a real import/browser check.

# Notes source snapshot — 19 October 2026

Exported from the active Kalamos workspace, including its uncommitted current source. Original workspace base commit: 67c98ce (not a claim that the exported files match that commit). Other apps/history/artifacts are excluded. This repository retains module boundaries and an independently resolvable Gradle build.

Latest change: collapsed and compact toolbars now use the enclosing modal as native composition, like expanded mode. Paper-local writing bounds and Zoom's dedicated surface remain. This removes the split native/WebView boundary across the edge tab. The installed Bigme APK was verified; disappearance of transient panel artifacts awaits owner testing. Canonical writing suite:706 passing tests; original Notes native suite:87 tests, one skip.

Recent active features include self-contained image-to-Markdown AI formatting, model discovery/thinking settings, in-note result updates, progress/error notifications, generic Android image/Markdown sharing and receipt, formatted Markdown imports, read-only tables/code/rich text, page overview, Home-save and thumbnails. API keys remain in on-device settings.

Do not add notebook captures, local credentials, build caches or signing keys.
