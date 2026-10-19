> **Historical source document.** Use the root `HANDOVER.md` and
> `features/writing/workspace/HANDOVER.md` for current state. Old paths below are evidence, not
> instructions.

# Kalamos ruled-writing workspace — handover

## Native Planning lifecycle fix — 2026-07-22

Planning is a full editor even though it uses `attachInkBox()` geometry. It must
not use the reader sticky-note teardown, which intentionally preserves physical
panel pixels. `Write2Native.suspend()` now calls the dedicated
`detachInkBoxCleared()` bridge path; native teardown clears the daemon/panel,
empties `InkSurfaceView`'s retained strokes and render parameters, and drops the
old content bitmap without invoking the legacy `clearContent()` recompositor.
This prevents a newly-created Planning notebook from exposing the preceding
notebook's ink buffer.

Native attachment rectangles are also clamped to the physical device-pixel
viewport. On the 1264 px Bigme panel, a fractional CSS right edge previously
rounded up to 1265 px, producing `getPhyViewLayout().left == -1` and refreshing
the ruled background rather than the live pen pixels. The current attachment is
never wider or taller than the panel, and stroke style is explicitly reapplied
when the asynchronous controller attach completes.

Detach flushes the daemon's final stroke batch asynchronously. The workspace therefore keeps its
scoped `window._inkHandler` installed for 300 ms after requesting native detach; otherwise the final
Planning batch can fall through to the classic notebook's global callback. A rapid reattach cancels
that delayed release. Keep this ownership rule and its regression test together.

### Native/WebView tool handoff follow-up

The hard-cleared detach is only for leaving or pausing the full editor. It must not be used when
switching from Write to Insert Space, Blank Lines, Erase, Select, or keyboard mode. Device follow-up
showed that doing so painted a white GU16 frame, hid the SurfaceView, and exposed a still-transparent
WebView; the entire workspace then appeared blank until a later refresh. Transient tool changes now
use `detachInkBoxForWeb()`, which retains the physical frame, clears native retained state without a
white presentation, reveals the already-rendered white workspace DOM, and enables the fast
interactive panel policy. It must not flip the entire WebView background or invalidate the WebView:
both expand the tool switch into an avoidable full redraw. Repeated tool/layout callbacks are also
edge-deduplicated so they do not restart the native panel-policy transition. Returning to Write uses
the workspace DOM as a cover until `onInkControllerReady(true)` renders the authoritative daemon page
and `showEditor()` restores normal composition. The bridge router must forward `showEditor()`;
omitting it silently breaks the covered handoff.

### Select movement and reverse-caret follow-up

Packed handwriting must not be moved by changing only its text anchor on every pen sample. On an
ink-only page those anchors are identical, which snaps the selected word to the far-left flow slot;
the repeated full-overlay rebuild also produces heavy GPU churn. Select now uses a DOM-only preview
in workspace-local coordinates, follows the pen continuously, and commits once on pen-up. Horizontal
placement is preserved while only the baseline snaps to the nearest ruled line.

A reverse Insert Space caret on a lower line must offer crossed words/ink to available capacity on
the preceding line before treating them as concealed. The old order covered the crossed item first,
so a word beside the caret disappeared even when the line above had a large buffer. Regression tests
cover both the pen-following selection and the crossed-word backfill cases.

The comprehensive implementation and refresh contract is in `../../INK-DAEMON-WRITING-GUIDE.md`.

**Updated:** 2026-07-22

## Ownership

This directory in `kalamos-core` is the canonical source of the writing workspace used by Kalamos
Write and Notes Planning. Do not restore a dependency on the former top-level `Write 2.0` checkout,
and do not patch an app's generated `write-workspace.js` or `write-workspace.css` directly.

Run `scripts/sync-kalamos.sh` here to regenerate the managed core assets. Then use
`kalamos-core/scripts/sync-core.sh <app>` to vendor them into each self-contained app repository.
The detailed ownership, host-mode, storage, build, and verification contracts are in `README.md`.

## Current behavior

- Kalamos Write calls `openNotebook(id)` and retains its Markdown reader plus focused block editor.
- Notes Planning calls `openWorkspaceNotebook(id)` and enters the ruled handwriting surface directly.
- Both modes share writing, Insert Space, Blank Lines and caret placement, erase, selection,
  collapse, magnifier, undo/redo, native-ink handoff, and optional handwriting recognition.
- Notes Planning persists to `planning.write2.md` and `planning.write2.json`; Write retains its
  established document filenames. The `write2` data identifiers remain solely for compatibility.
- Selection-only toolbar actions are hidden on initial entry so Cancel and Done fit the 674 CSS-pixel
  device viewport. `PenWorkspace.updateToolbarState()` establishes that state during construction.

## Device integration correction — 2026-07-22

Notes initially had an older managed `editor-controller.js`, so `window.onNativeFlushed()` did not
delegate to the active ruled workspace. Native strokes painted immediately, but Done and other
flush-before-action commands could never finish. The current Notes vendor must match core's handler.

Device follow-up showed that sharing those global callbacks was itself the wrong ownership boundary:
the daemon could paint live ink while the saved Planning sidecar remained empty. Core `InkManager`
now routes stroke batches and flush completion directly to the active `window._inkHandler`, falling
back to the older global callbacks only when no scoped handler owns the surface. Keep this dispatch
inside core; app overlays and legacy editor globals must not participate in ruled-workspace ink.

The workspace also used to request its initial native content snapshot in the same JavaScript task
that replaced the previous screen. On the Bigme panel this could bake legacy Planning Markdown
underneath a newly opened ruled page. `src/kalamos/native.ts` now waits 64 ms before requesting the
120 ms native capture, while retaining the 220 ms attach boundary. Keep the timing comment and its
regression test together.

The attach request itself is also asynchronous. The established reader note-box contract calls the
active handler's `renderNoteStrokes()` from `onInkControllerReady(true)`. The ruled workspace now
implements that same contract and performs its authoritative page presentation there. Do not move
that presentation back to the timer immediately following `attachInkBox()`; on Bigme that timer can
run before `HandwrittenClient.connect()` has supplied the daemon Canvas.

Finally, `src/java-core/.../WebViewCache.kt` uses `LOAD_NO_CACHE` for packaged `file:///android_asset`
shell files. The WebView is still warmed once per process, but an APK replacement can no longer
reuse retired JavaScript from the prior installed version.

## Verification completed on 2026-07-22

- 147 tests across 13 files pass, including delayed-detach callback ownership.
- TypeScript type checking passes.
- The production managed bundle builds successfully.
- Browser previews at 674 × 896 CSS pixels confirm direct Planning entry, ruled lines, spacing-tool
  activation, Done-to-library persistence flow, and Write's reader-to-block-editor flow.
- Kalamos Notes and Kalamos Write debug APKs assemble successfully.
- The rebuilt Notes and Write APKs were installed, and the user confirmed on the physical device
  that real-time Planning strokes work and a new Planning note no longer inherits the old buffer.

The full incident record and reusable implementation contract are in
`../../INK-DAEMON-WRITING-GUIDE.md`.

## Important implementation areas

- `src/vanilla/main.ts` — host-mode orchestration and Done/Cancel behavior.
- `src/vanilla/penWorkspace.ts` — pen tools, layout, native handoff, and toolbar state.
- `src/kalamos/entry.ts` — the stable `window.KalamosWriteWorkspace` app-facing API.
- `src/kalamos/kalamosStore.ts` — configurable per-notebook persistence adapter.
- `scripts/sync-kalamos.sh` and `vite.kalamos.config.ts` — managed bundle generation.

Preserve comments around native flushes, lost-pointer recovery, direct-mode blank seeding, and
initial toolbar state; they document device-specific correctness constraints rather than style.
