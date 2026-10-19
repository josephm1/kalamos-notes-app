# Kalamos engineering rules

## Source ownership

1. `foundation/**` must be device-vendor-neutral and app-neutral.
2. `devices/<vendor>/**` is the only place vendor SDK classes, reflection targets and panel policy
   may appear.
3. `features/**` owns reusable product capabilities. Apps configure features; they do not fork them.
4. `apps/<app>/**` owns the application ID, entry point, branding, overlay, app-only services,
   samples and per-application licences.
5. Apps must not depend on other apps. There is no vendored `java-core`, `assets-core`, or sync step.
6. Generated writing JS/CSS is edited only through `features/writing/workspace`; never patch the
   generated files in `features/writing/android` directly.
7. `BookConverter/**` owns conversion, OCR, audit and package-generation behavior. Android runtime
   and app modules consume its output contract; they must not depend on its local models or runs.

## BookConverter boundary

- Keep converter code and documentation in Git, but never add source books, model weights, local
  environments, caches, generated runs or archived runs.
- Those heavy folders are linked to `the retained converter data directory` by
  `BookConverter/scripts/link_external_assets.sh`; the links are intentionally shared and mutable.
- Preserve the MinerU-shaped canonical blocks and `vl_pages.json` contract described in
  `BookConverter/docs/SCHEMA.md`.
- A browser preview is not conversion QA. Review warning-heavy pages in scan, overlay and reflow,
  and never silently accept an incomplete page.

## Device boundary

- Shared runtime code obtains device behavior through `DeviceRegistry` and `DeviceProvider`.
- Bigme implementation details belong only in `devices/bigme`.
- Standard Android and Boox are future provider modules, not conditionals scattered through apps.
- Device selection is compile-time packaging plus provider manifest metadata. A runtime user toggle
  is not a safe substitute for choosing the correct vendor implementation.
- Browser success never proves native ink or e-ink refresh correctness.

## Ink correctness

The contracts in `docs/devices/bigme/INK-WRITING-GUIDE.md` are correctness rules. In particular:

- one visible editor and one scoped stroke owner;
- CSS-to-physical geometry clamped to the panel;
- authoritative presentation only after controller readiness;
- separate transient WebView handoff from hard close/clear;
- retained-buffer clearing when leaving a document;
- explicit snapshot and partial-refresh ownership;
- no second legacy template or renderer behind the workspace.

Do not simplify the timing and lifecycle comments without repeating the physical-device acceptance
matrix.

## Change workflow

1. Read the nearest README and relevant device/feature guide.
2. Make the change in its owner module.
3. Run focused tests, then `./tools/test-all.sh` when shared behavior changed.
4. Build affected APKs. Do not claim installation or device acceptance unless it actually happened.
5. Record a material architecture or device-contract change in `HANDOVER.md`.

MyScript certificate sources are licensed, app-owned material. Keep this repository private unless
their redistribution terms have been reviewed. Never print certificate contents in logs or docs.
