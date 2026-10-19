# Bigme device provider

This is the only module allowed to know about Bigme's undocumented handwriting daemon and e-ink
panel controls. It implements the neutral contracts from `foundation/device-api`.

Important distinctions:

- animation display policy and interactive display policy are separate modes;
- live daemon ink, final stroke batches, SurfaceView content and retained panel pixels have
  different lifecycles;
- transient writing-tool handoff is not the same operation as closing and clearing an editor;
- physical rectangles must be clamped after CSS-to-device conversion.

Read `docs/devices/bigme/INK-WRITING-GUIDE.md` before modifying this module. Validation requires a
physical device; an Android screenshot does not necessarily show what the e-ink panel displayed.


## Pen hover support

The ink integration supports stylus hover/proximity tracking before pen-down, used by the live
eraser footprint. The user confirmed accurate tracking at roughly 2 cm above the connected six-inch
Bigme on 2026-10-08; range depends on hardware and is not a calibrated distance reading. Hover moves
tool previews without modifying ink. See [the input contract and device evidence](../../docs/devices/bigme/INK-WRITING-GUIDE.md#pen-hover-and-proximity-2026-10-08).
