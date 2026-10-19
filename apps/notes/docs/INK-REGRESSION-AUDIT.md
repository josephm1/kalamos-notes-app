# Agora-era ink regression audit — 13 October 2026

The user reports that Notes writing worked before the Agora integration. The current build still
flashes another notebook and initially hides/fragments handwriting. Acceptance remains failed.
Treat the pre-Agora APK as the comparison baseline, not merely the earlier policy experiment.

## Evidence from the actual failed run

Notebook 19 (`nb-of33-rd36-lz9c`), Notes process 17246, Bigme HiBreak. Device-clock events start
at 13:22:54. All current-process captures completed; aggregate collector warnings refer to a prior
process and must not be attributed to this run.

- New workspace loads an empty ink sidecar and renders zero strokes. The current client allocation
  before reset contains uninitialized stripes, not the previously photographed old handwritten page.
- After reset the mapped allocation is white. The WebView capture, host page and subsequent mapped
  allocation contain the fresh ruled page, with no prior notebook vectors.
- The first stroke's 326 samples reach the active owner and appear continuously in both mapped
  pen-up pixels and the host bitmap. No host blit interrupts this stroke while contact is active.
- All changed stroke pixels, all 326 sample centers and 3,575 interpolated centerline probes are
  inside the union of 36 actual service commit rectangles. This excludes a gross missing dirty-region
  or rotation/offset error in this recorded stroke; it does not prove output pixels at each commit.
- At pen-up, the host posts the completed stroke; the daemon copy has `force=false`. HWC reports
  no dirty region and skips a visible commit. The user reports recovery after approximately 30 seconds.
- In a second controlled test the user reports no visible new ink. The existing `Bridge.refreshChrome()`
  makes it appear immediately. This probe also changes WebView capture layers and triggers several
  full normal compositor commits. Its daemon GU16 request covers the menu, not the written word.
  Therefore it does NOT establish that an extra regional GU16 per stroke is the correct root fix.
- Saves/readback hashes in this run match. Notes were checkpointed and backed up again after the probe.

## Exact packaged comparison

Baseline: `artifacts/notes-agora-2026-10-12/notes-before.apk` (pre-integration retained APK).
Compare initial integration and navigation redesign APKs alongside that baseline. Do not assume
current dirty Git source identifies the moment a change shipped.

BigmeInkController, its InputProxy, InkManager and InkSurfaceView compiled behavior are unchanged
across those three APKs. The packaged native writing adapter's 40 methods and entry pause/resume
were also unchanged. The first integration added a second activity using the unchanged global WebView holder; the
navigation redesign isolates that external holder while keeping the launcher singleton. Integration
changes still affect activity ownership and invocation ordering;
unchanged paint code does not absolve its new callers. Later buffer/policy repair attempts are a
separate set of changes and must be audited separately.

## Ownership map for the next correction

| Responsibility | Owner |
|---|---|
| Agora admission, return, editor lease and isolated external activity | apps/notes/exchange |
| Workspace open/close/checkpoint and native adapter call ordering | features/writing/workspace/src/kalamos |
| Activity/WebView/SurfaceView lifetime and capture scheduling | foundation/android-runtime |
| Live input, mapped buffer reconciliation and daemon activation | devices/bigme |
| Device-neutral ink operations and passive diagnostic observer | foundation/device-api |

Keep route/session fixes out of drawing code. Keep firmware reflection out of the shared runtime.
Avoid mixing a structural reorganization, hardware-policy experiment and behavioral fix in one
candidate: each should be independently reviewable and its effect visible in the trace.

## Remaining boundary and next discriminating test

The firmware's composed output (fd12, physical allocation stride1472, visible width1448) is separate
from the client input allocation. Its pixels are not exposed by the Binder API or dumpsys. Direct
/proc access is denied; do not claim these pixels were inspected or change system permissions.
A device restart with the same installed APK/policy tests persistent daemon/driver state left across
APK replacements. User performs that test. If both symptoms remain, compare the pre-Agora runtime's
activity/context and capture presentation against the current build using controlled physical runs.
The exact source cause of the old-page flash and delayed live presentation remains unproven.

Evidence: artifacts/notes-ink-diagnostics-2026-10-13/user-failed-run and settle-refresh-probe.
Collector rotation decoder corrected and tested for both firmware matrices; raw data is untouched.

## Post-restart result and lifecycle safeguard

User confirms both symptoms disappeared after device restart with the same APK. User then wrote
through Agora's Notes option and created/wrote a fresh standalone notebook; both continued working.
This establishes retained device state contributed, but does not prove the originating trigger or
permanent recovery from every service/driver fault.

Added a shared `InkHostLifecycle` gate separating Android visibility epochs from ordered attachment
requests. Android onStop synchronously flushes/retire/detaches the current native owner without an
extra display clear. Stop invalidates queued bridge/layout work; hard detach invalidates pending
layout callbacks. Native attachment readiness is exposed to the adapter so resume reconciles its
cached attached flag after native stop. Existing pen cadence, waveform, mapped clear and blending
sequence are unchanged. This closes concrete delayed-WebView/later-layout ownership gaps; it is
not a claim to reset the firmware's global output buffer or repair all retained panel history.

Gate tests cover stopped and retired callbacks, no old-ticket revival on resume, and ordered
detach→attach within one host. Runtime integration test covers native stop without a JS checkpoint,
retired stroke rejection and resume requiring readiness. Writing436/Notes19/runtime57 pass;
root native tests passed before the last focused additions. APK built, installation awaiting USB
reconnection after device disconnected. Hash 0a96c5b5430d225ee437f35847219e055a1a2e8f3bb80ae8f2a14076228640ad.
