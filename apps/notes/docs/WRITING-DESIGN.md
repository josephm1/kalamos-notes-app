# Notes writing presentation

17 October 2026, revised for device readability after user feedback. Notes first; KOReader is deferred.
The earlier labelled rail / two-row header and subsequent tiny full compact strip are superseded.

Reference: [Elise Nguyen — Color Writing on Kindle](https://elisenguyen.com/work/color-writing),
especially the five screenshots supplied by the user: colour choices, final colour slots,
pen presets, pen/highlighter menus, and contextual annotation palettes.

## Layout

- Compact mode is a draggable **vertical 48px strip**, with an two-bars collapse/drag handle,
  Pen, Eraser, Select, Undo and Zoom. All other tools appear in expanded mode.
  The expand icon sits at the foot. Existing native drag, exclusion and bounded capture paths remain.
- Expanded mode has **one 48px top bar** with library return, title and page navigation.
  The **48px icon-only rail** contains pen, two colours, eraser, selection, spacing, Zoom,
  text, shapes, typed editing, Format with AI, Undo/Redo and Add page.
- Format with AI is an ordinary toolbar item in expanded mode, with its accessible name and tooltip.
  It has no separate top-bar label or call-to-action treatment.
- Expanded paper reserves 60px on the left, down from 72px in the rejected version. The header
  remains one row at 360, 572 and 674 CSS pixels. The existing bottom gutter stays 20px.
- Pen settings use a 250px square-edged pop-out beside the active tool: actual supported Pen,
  Brush and Marker, five stroke-width samples, colour swatches and the selected colour name.
  Two persistent colour shortcuts switch in one tap; tapping the selected colour opens its palette.
  Choosing a palette colour updates that shortcut. No unsupported pen types are advertised.
- Both layouts retain Zoom. Expanded chrome stops above the lower magnifier pad.

## Ownership and correctness

`features/writing/workspace` owns the opt-in presentation and controls. Notes enables it through
`KalamosWritingHost.notebookToolbar`. The same button nodes move between core and rail and restore
compact order. The controller measures the actual DOM for native composition and exclusions.

Colour, brush and width changes wait for native flush, persist through existing preferences and
notify existing ink-style/tool callbacks. Optional `penQuickColors` is backward compatible with
older preferences; note sidecars and stroke formats are unchanged. Native attach, refresh policy,
live stylus paths, AI processing and external Agora contracts are unchanged.

## Verification

See `artifacts/notes-readable-design-2026-10-17/verification.md`. Automated browser review runs in
an isolated headless Chromium instance against the local layered app, independent of the user's
browser. Checked compact/full transitions, real palette interaction, widths 360/572/674 and Zoom.
Device screenshots and logs are read-only; physical writing and panel acceptance remain user-owned.

The icon glyphs are now 27px rather than 19px, ordinary tool targets are 44px tall, and pen/menu
text is 16px rather than 12px. Compact mode is 306px tall rather than 508px at the 572×772 preview
size despite its larger controls. Copy/delete/convert remain contextual during selection.

## Static toolbar and lasso correction

The Notes presentation is now a single stylesheet without appended historical design overrides.
Compact is fixed at48×306px and the expanded rail48×618px. Toolbar scrolling is disabled.
Short viewports (height≤710px) and deliberate Zoom layout use a94×310px two-column expanded rail;
normal writing, selection, Spacing and menu transitions cannot change its footprint. Selection
copy/delete/convert actions are in the Lasso menu. The compact bar's default vertical position is
viewport-based, not a percentage of content height; dragging remains available.

Live lasso previews show only the sampled path. Polygon closure is used for hit testing at release,
not drawn as an extra closing chord during the gesture. The circular eraser cursor stays hidden
in lasso mode. Bigme completes accepted lassos even when terminal coordinates fall outside paper.
Device logs and automated evidence: artifacts/notes-lasso-fix-2026-10-17/verification.md.

## Press rendering and handle

The compact/collapsed handle uses the runtime's original two vertical bars. Browser touch highlight
is disabled for the writing surface and tool buttons. Buttons have explicit appearance and no
animated/transform press state. The handle remains black on white; selected tools still invert.
Keyboard focus is retained with the existing black outline. Compact and expanded rail containers
clip their button faces to the fixed rounded outline, so pressed paint cannot cover the corners
and appear to change the toolbar width. The fixed expanded wrapper does not clip its controls.
