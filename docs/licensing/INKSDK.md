# InkSDK attribution and licence

The Kalamos ink contracts, defaults, performance counters and Bigme handwriting controller
build on **[InkSDK](https://github.com/imedwei/inksdk)** by **Ed Wei (imedwei) and contributors**.
Thank you for the original low-latency e-ink integration, vendor-interface research and
measurement work. Credit and copyright in that work remain with its respective authors.

Upstream reference inspected for attribution: `33c71c9578007db3f2b3ee4767e63472b9802600`.
This is an attribution reference, not a claim that the modified code is an unchanged snapshot
or that it was originally imported at that revision.

## This adaptation

The Kalamos InkSDK adaptation is distributed under **GNU GPL version 3**
(SPDX: `GPL-3.0-only`). Each ink module includes the complete licence in `LICENSE`.
The adaptation includes reorganized device-neutral contracts, a standard Android stylus
provider, editing/capture controls, diagnostics and Bigme lifecycle/composition changes.
It is maintained independently and is not an official upstream InkSDK release or a
manufacturer SDK. It does not include the upstream Onyx provider.

This licence applies to these ink modules, not automatically to every unrelated Kalamos app,
third-party library or device firmware. Preserve original authorship and notices when modifying
or redistributing source. Binary distributions must also satisfy GPLv3's corresponding-source
requirements; credit alone is not a replacement for the licence or source.

## Dependencies and firmware

- AndroidX Annotation: Android Open Source Project contributors, Apache-2.0.
- AndroidHiddenApiBypass: [LSPosed contributors](https://github.com/LSPosed/AndroidHiddenApiBypass),
  Apache-2.0; used only by the optional Bigme provider.
- Gradle wrapper: Gradle contributors, Apache-2.0; existing wrapper headers are preserved.

The Apache licence is reproduced in `LICENSES/Apache-2.0.txt` alongside this document.
Dependencies retain their original notices and terms. Bigme firmware interfaces are accessed
at runtime through reflection; proprietary firmware is not relicensed or included as SDK binaries.
