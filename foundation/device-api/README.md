# Device API

Vendor-neutral contracts for device behavior. `DeviceRegistry` reads the provider class from the
application manifest and exposes its `InkController` and display-policy hooks to the runtime.

This module must never import Bigme, Boox/Onyx, or another vendor SDK. The public Android stylus
implementation lives in `devices/standard`; vendor checks do not belong here or in apps.

Display handoff is also capability-based. `supportsPersistentDisplayHandoff=true` means a device
physically retains the last submitted frame after its native writing surface is hidden (Bigme).
Ordinary Android displays leave this false, so the writing feature mirrors committed vectors into
its ruled DOM before the runtime hides the native surface. Do not replace this contract with
manufacturer checks.

## Stylus hover / proximity

The ink integration can support non-contact pen position on hardware that reports hover. The
current writing feature receives it through Android/WebView pen pointer movement, separately from
completed native ink strokes. Hover is for previews and must not commit or erase ink. There is no
separate proximity callback in `InkController` at present; callers must not assume hover or a fixed
hover range on every provider. See [the documented Bigme input path](../../docs/devices/bigme/INK-WRITING-GUIDE.md#pen-hover-and-proximity-2026-10-08).
