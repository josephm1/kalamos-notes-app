> **Historical source document.** Use `features/writing/workspace/README.md` for current ownership and
> commands. This file preserves the pre-monorepo explanation for provenance only.

# Kalamos ruled-writing workspace

This directory is the canonical source for the ruled handwriting editor shared by Kalamos Write
and the Planning mode in Kalamos Notes. It lives in `kalamos-core` so neither app depends on a
sibling repository or source checkout.

## Ownership and runtime boundary

- TypeScript, tests, and the device bundle build live here.
- `scripts/sync-kalamos.sh` generates `write-workspace.js` and `write-workspace.css` into
  `kalamos-core/src/assets-core/web/`.
- `kalamos-core/scripts/sync-core.sh <app>` vendors those generated assets into an app's managed
  `assets-core` tree.
- App-owned overlays only choose when to open the workspace. They do not copy or fork its editing,
  storage, or native-ink logic.
- Once synced, each app repository and APK is self-contained. No path lookup, symlink, module import,
  or build step reaches back into this directory or another app.

## Two supported host modes

`openNotebook(id)` is Kalamos Write's document mode. It retains the paginated Markdown reader and
opens the ruled editor for a selected block.

`openWorkspaceNotebook(id)` is the Notes Planning mode. It opens the same ruled editor immediately,
without exposing a reader, file picker, Markdown controls, samples, or AI panel. Its source and ink
sidecar use separate per-notebook filenames (`planning.write2.md` and `planning.write2.json`) so it
cannot collide with a Write document stored in the same notebook container.

Both modes share the pen model and therefore keep identical behavior for native low-latency writing,
Insert Space, Blank Lines, caret placement, erase, select/move/delete, magnified writing, undo/redo,
and optional handwriting recognition.

## Build and verify

```bash
cd kalamos-core/write-workspace
npm ci
npm test
npm run typecheck
./scripts/sync-kalamos.sh

cd ../..
kalamos-core/scripts/sync-core.sh kalamos-write
kalamos-core/scripts/sync-core.sh kalamos-notes
```

After syncing, run each app's preview and Android build. Native ink behavior still requires the
physical e-ink device; browser tests validate routing, layout, tools, and persistence contracts only.

## Storage compatibility

The internal sidecar schema retains its existing `write2.sidecar` magic and filenames for backward
compatibility with current Kalamos Write documents. These are data-format identifiers, not links to
an external project. Changing them would require a deliberate migration.
