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
