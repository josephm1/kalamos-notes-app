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
