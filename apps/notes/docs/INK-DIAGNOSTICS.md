# Ink buffer diagnostics and test plan

The physical old-notebook flash and missing live ink are not resolved. Earlier display-policy
experiments failed physical testing and were removed. The previous profile/effective mode178 was
restored; neither a setter result nor an Android screenshot establishes physical panel acceptance.

One confirmed introduced regression is corrected in this build: regional overlay updates once again
clip to their requested region, preserving uncommitted pen pixels elsewhere. A rotated native-graphics
regression covers preserved live pixels, matrix/clip restoration and intentional full-page overwrite.
Diagnostics observe the remaining behavior; they do not select another refresh profile or inject input.

## Build and collection

```bash
./tools/gradle.sh :apps:notes:assembleDebug -Pkalamos.device=bigme -Pkalamos.inkTrace=true
python3 tools/diagnostics/collect-ink-trace.py --duration 90 --output artifacts/ink-test-ordinary
```

Ordinary builds omit `kalamos.inkTrace` or set it false. Release/non-debuggable apps cannot enable the
recorder. Diagnostic app files are local, under the app-specific external `files/ink-trace` directory.
The collector only reads device state, records Android frames, pulls trace files, decodes raw pixels,
and checks snapshot completion/size/hash. It never creates notebooks, writes pen input or changes modes.
The user performs all physical actions. `--pull-only` retrieves retained captures without a new run.

## What is recorded

- One common wall/uptime/nanosecond timeline, process/thread, activity, SurfaceView/controller/manager
  identities, attachment generation, notebook/page identity and stable JS workspace identity.
- File loads, save payload SHA256, save result and immediate readback SHA256/equality; no source text
  is required for those identity checks. Diagnostic readback cost is included separately.
- Completed native samples (first two strokes per controller), batching, callback acceptance/rejection,
  JS receiver identity/run IDs before/after ingestion, and native model render counts.
- Private copies of WebView content and retained host pixels; actual READ_ONLY mapped vendor input
  allocation before clearing, after reset, and before/after early or pen-active blits.
- Pen-active state on blits, complete-vs-regional replacement, clip/matrix, physical canvas dimensions,
  dirty rectangles, invalidation mode, input enable/style and effective policy.
- Service/client/layer dumps at lifecycle boundaries plus periodic checks, compositor surfaces, filtered
  daemon/hwcomposer/app logs, final Android screencap and compositor screenrecord.

The service's separate full-panel output allocation is not exposed by the app's mapped input FD.
The recorder does not claim to capture that allocation or the physical e-ink waveform. The Android
video cannot establish what the panel physically showed. Retain a physical photo/video of a mismatch
and its time; compare it with the synchronized software evidence.

## Capture constraints

No new per-MOVE disk writes or PNG encoding. Existing accumulated samples are observed at pen-up.
Bitmap/raw copies are bounded (80 captures per process; early presentations, first two completed
strokes and up to three pen-active blits per controller). Encoding, writing and hashing run on a bounded image worker; events use a separate bounded
worker queue. The only recycled bitmap is the recorder's private copy. Raw sampling uses a
read-only duplicate and never changes the vendor buffer's position or writes its pixels.

Copy time, diagnostic readback time, skipped captures and queue drops are explicit. Sampling a live
allocation is not atomic; contemporaneous native drawing can affect it. If tracing changes the symptom,
compare with the ordinary build rather than drawing conclusions from diagnostic timing alone.
`summary.json` flags missing/incomplete/hash-mismatched captures and an absent app trace.

## First test: ordinary Notes only

Start the collector, then:

1. Open an existing notebook with distinctive content. Leave it visible for two seconds.
2. Return to the library and create a fresh ruled notebook.
3. Wait two seconds. Note whether any old notebook appears; keep the fresh page untouched initially.
4. Write one short word continuously. Lift the pen and wait two seconds. Record any missing fragments.
5. Return to the library, reopen that new note, and check the saved word and the original note.

Keep this first run independent of Agora so it establishes which stage fails in the common runtime.

## Second test: Agora-owned editor

After the first trace is collected, start a separate collection window. Open/edit a note through
Agora, write one word, use the integration's Back (repeat Attach only as a separate later test), then
open a fresh notebook in standalone Notes and repeat the first-stroke observation. The trace must
show the departing workspace, close/save, controller retirement and new owner in that order.

## How the evidence chooses a fix

| Evidence | Investigation/fix owner |
|---|---|
| New notebook loads an old file hash/run IDs | Storage routing/import/open contract; identify the exact wrong ID/path first |
| Native batch reaches a retired/different JS workspace | Bridge ownership and teardown sequencing; preserve final save before retiring |
| New model is empty but captured WebView/host page contains prior ink | Retained content, queued capture ownership or renderer lifecycle |
| Clean source bitmap produces wrong mapped pixels | Vendor blit region, rotation, density or allocation lifecycle |
| A blit occurs during contact and removes live pixels outside its intended region | Reconciliation scope/scheduling; preserve unfinished native ink |
| Host/model/input buffer are complete but physical strokes are missing | Composition, dirty-region coverage and hardware commit sequence |
| All recorded software layers are fresh but physical old content flashes | Service-owned output/panel history; stop treating repeated input-canvas clears as proof of repair |
| Failed or mismatched save readback | Persistence must be corrected before display tests can certify data safety |

Change one proven failing stage at a time. Keep a before/after trace and require physical acceptance
for both clean notebook opening and intact, responsive live writing. Do not reinstate the rejected
package-profile or pen-contact display-policy experiments.
