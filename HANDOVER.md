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

MyScript resources are private app-owned material; do not publish this repository publicly. Do not add notebook captures, local credentials, build caches or signing keys.
