# Kalamos ink daemon writing guide

**Status:** imported implementation was device-confirmed for real-time ink and clean-buffer
lifecycle on 2026-07-22; the monorepo packaging and fast WebView tool handoff require a new device
acceptance pass  
**Applies to:** full-page handwriting editors, Notes Planning, reader ink boxes, and future Kalamos
surfaces that use the native low-latency ink daemon

This guide records the implementation contract and the failure modes found while integrating the
Kalamos Write ruled-writing experience into Kalamos Notes Planning. These details are correctness
requirements for this e-ink device, not optional optimizations.

Supported input includes **pen hover/proximity tracking before contact**, as well as pen-down writing.
See [Pen hover and proximity](#pen-hover-and-proximity-2026-10-08) for the event path and device evidence.

## 1. Ownership and source of truth

- Vendor-neutral ink contracts belong in `foundation/device-api/`.
- Bigme daemon and panel behavior belongs only in `devices/bigme/`.
- Shared Android lifecycle, bridge and surface behavior belongs in `foundation/android-runtime/`.
- Shared web/native orchestration for the ruled editor belongs in `features/writing/workspace/`.
- An app owns only its routing, branding and app-specific integration.
- Generated `write-workspace.js` and `write-workspace.css` are build products in
  `features/writing/android/`. Never patch them directly.
- Apps compile these modules through the root Gradle build. They must never import another app or a
  historical repository.

After changing the workspace source, regenerate its Android bundle and rebuild affected apps. There
is no source-copy or sync step. See section 12.

## 2. The two-layer model

Writing uses two systems with different jobs:

| Layer | Owns | Must not own |
|---|---|---|
| Web workspace | document model, tools, ruled layout, persistence, selection and reflow | live stylus latency |
| Native `SurfaceView` + daemon | immediate pen pixels and finished native stroke capture | notebook identity or long-term document state |

The native surface is opaque and the WebView is composed with it. The e-ink panel also retains its
last physical pixels. Therefore three things can differ temporarily: the JavaScript model, the
SurfaceView bitmap, and the pixels still visible on the panel. Opening and closing must reconcile all
three explicitly.

Do not add a second template or stroke renderer underneath the ruled workspace. A single editor must
own the visible paper and ink. Notes creates Planning notebooks with a **blank compatibility page per ruled sheet**
only because the shared library schema requires page records; the ruled workspace exclusively owns
the visible lines and writing.

## 3. Coordinate contract

The web layer measures in CSS pixels. The daemon and `SurfaceView` use physical device pixels:

```text
physical coordinate = CSS coordinate × devicePixelRatio
```

The Bigme B7 Pro panel is 1264 × 1680 physical pixels at approximately DPR 1.875. Fractional CSS
edges can round beyond the panel. The failed implementation converted a right edge to 1265 pixels,
which produced a physical layout beginning at x = -1. Pen movement then refreshed fragments of the
ruled background instead of displaying live black strokes.

Always clamp the attachment rectangle to the physical viewport:

```text
panelWidth  = round(window.innerWidth  × DPR)
panelHeight = round(window.innerHeight × DPR)
left/top    = clamp(floor(CSS edge × DPR), panel bounds)
right/bottom = clamp(ceil(CSS edge × DPR), panel bounds)
```

The final width and height must be positive and must never exceed the panel. On this device, a
full-width log must say `1264`, never `1265`, and the physical layout must not start at `-1`.

## 4. Correct open and attach sequence

The order matters because WebView composition, Android layout, daemon connection, and e-ink refresh
are asynchronous.

1. Mount the new web workspace and its ruled paper.
2. Wait for the new WebView frame before capturing native content. Planning currently waits 64 ms;
   native capture then has its own preparation delay.
3. Calculate and clamp the physical attachment rectangle.
4. Size the `SurfaceView` while it is still hidden.
5. Make the surface visible only after Android confirms the requested layout dimensions.
6. Attach the daemon and set bounds/exclusions.
7. Present the authoritative page only from `onInkControllerReady(true)` through the active scoped
   handler's `renderNoteStrokes()`.

Never present the page immediately after calling `attachInkBox()`. That bridge call queues work; the
daemon may not have supplied a Canvas yet.

Style calls can also race attachment. `InkSurfaceView` therefore retains pen width and colour and
reapplies them inside the successful controller attach. Writing correctness must not depend on
whether `setInkStyle()` wins a main-thread scheduling race.

### 4.1 The measured Android host is the geometry authority

The JavaScript calculation `window.innerWidth * devicePixelRatio` is an estimate, not the physical
panel contract. WebView density conversion can round it one pixel beyond the measured Android host.
This has occurred on more than one Bigme geometry: the current HiBreak requested `1073 x 1449` for a
real `1072 x 1448` host, while an earlier panel requested width `1265` for a real width of `1264`.
JavaScript should still clamp its rectangle, but `InkManager.attachInkBox()` must perform the final
clamp against the measured parent view before sizing or showing the `SurfaceView`.

The firmware response is strict and important. `HandwrittenClient.updateLayout()` transforms the
view bounds, checks that the physical screen contains the complete transformed rectangle, and
returns `false` before calling `setLayoutRect()` or rebuilding `mMatrix` when any edge is outside.
For the HiBreak overshoot the diagnostic sequence was:

```text
InkManager: attachInkBox show box=1073x1449 ...
HandwrittenClient: Warning: invalidate layout rect, mPhyViewLayout=Rect(0, -1 - 1449, 1072)
BigmeInkController: HandwrittenClient rejected the post-connect physical layout
InkManager: InkController ready: false (BigmeInkController)
```

The visible result is **“Pen engine unavailable”**. Do not work around it by accepting
`updateLayout() == false`: the daemon matrix is then stale, which reintroduces the rotated layer.
Fix or clamp the requested view geometry. The healthy log must show a box no larger than the measured
host, followed by `post-connect`, `self-check OK`, and `InkController ready: true`.

### 4.2 Bigme physical-canvas rotation order

`HandwrittenClient.connect(logicalWidth, logicalHeight)` swaps the allocation dimensions when the
physical rotation is 90 or 270 degrees. A portrait `1072 x 1448` view therefore legitimately receives
a `1448 x 1072` ION canvas at physical rotation 270. Do not treat the swapped dimensions alone as a
bad allocation and do not manually transpose individual Planning bitmaps or strokes.

The vendor client makes that physical canvas behave like the logical portrait view by installing an
internal `Matrix` every time `getCanvas()` is called. Its firmware implementation has a strict
dependency:

1. `updateRotation()` calculates `mPhyRotation` and the physical screen rectangle.
2. `updateLayout()` transforms the bound view rectangle and rebuilds the canvas `Matrix` from that
   rotation.
3. Only then may Kalamos call `getCanvas()`, draw the canonical page/stroke, or invalidate it.

Never reverse the first two calls. Layout-first can preserve a stale or identity matrix during an
activity/startup rotation transition. The SurfaceView layer will still show the correct horizontal
page, but touching the pen asks the daemon to present its incorrectly oriented ION layer, revealing
vertical rules and no correctly positioned live stroke. Treat `updateLayout() == false` as a failed
daemon attach rather than exposing that corrupt overlay; section 4.1 explains how an oversized
requested view causes that failure and how it must be corrected.

Reader note boxes have an additional rule: size the surface before visibility. Creating a full-screen
surface for even one frame punches a full-screen hole through the WebView, and the persistent panel
can latch that white frame.

## 5. Snapshots, retained composition, and partial refreshes

The daemon surface cannot display live DOM. Native code therefore captures selected WebView regions
into bitmaps and retains them as layers beneath the ink. A native page is composed in this order:

```text
white paper
→ captured WebView content
→ native template (only for classic surfaces that own one)
→ retained ink strokes
→ captured toolbar/menu chrome
→ SurfaceView commit and e-ink refresh
```

Planning passes a blank native template because its ruled lines are already part of the captured
workspace. Rendering rules in both the WebView and native template layer recreates the same
double-owner problem that caused legacy content to appear underneath.

### 5.1 Why captures are serialized

`WebView.draw()` returns a blank image while the WebView is hardware-layered on this device. A
snapshot temporarily switches it to a software layer, invalidates it, waits for DOM paint, captures,
then restores hardware composition. Concurrent captures used to race that single layer flag: one job
could restore hardware while another was settling, producing an intermittent blank toolbar or rail.

All toolbar, menu, and content captures therefore use the single queue in `InkManager`:

1. enqueue a capture job;
2. switch the WebView to software once;
3. invalidate and wait for the job-specific settle interval;
4. draw the bitmap;
5. process the next job without flipping layers;
6. restore hardware only when the queue is empty.

Do not bypass this queue for a “quick” snapshot. Do not run captures concurrently.

### 5.2 Snapshot types

| Operation | Bitmap captured | E-ink region refreshed |
|---|---|---|
| `snapshotContent()` | complete editor/paper bounds | complete paper unless caller supplies a regional contract |
| `snapshotContentPartial()` | complete editor/paper bounds | only the supplied surface-local dirty rectangle |
| `snapshotToolbar()` | full toolbar strip | toolbar strip |
| `snapshotToolbarRegion()` | one control cluster | that cluster only |
| `snapshotMenu()` | current floating menu | union of old and new menu bounds |

The important distinction is **bitmap extent versus refresh extent**. A partial content sync still
captures the full content bitmap at its stable surface origin. Only the physical EPD refresh is
regional. Capturing a cropped dirty bitmap and then storing it as the content layer draws that crop
at `(0,0)`, which pins or duplicates the editor at the top-left.

Extra arguments passed to `snapshotContent()` are ignored by JavaScript. Use the explicit
`snapshotContentPartial()` bridge method.

All refresh rectangles passed to native code are surface-local physical pixels, not CSS pixels and
not absolute window coordinates. Clamp after converting with DPR.

### 5.3 One visible refresh per reconciliation

A deliberate model operation can change both retained strokes and captured DOM. Refreshing each
layer separately creates two stacked GU16 updates and a visible blank/flash between them. The ruled
workspace uses a two-stage transaction:

1. `renderInk(..., defer: 1)` updates native retained strokes without presenting them.
2. `snapshotContent` or `snapshotContentPartial` captures the updated DOM.
3. `setContentSnapshot()` recomposes content plus the already-updated strokes.
4. One EPD refresh presents the complete result.

Dirty CSS rectangles are unioned while changes settle. Direct workspace layout sync debounces for
160 ms; completed scribble erases use 32 ms and magnifier sync uses 60 ms. Regional content
captures retain the full bitmap extent but settle for 48 ms; cold/full captures retain 120 ms. Pen input is gated during reconciliation and normally re-enabled
180 ms after the snapshot request. These values are implementation tuning, not a substitute for the
controller-ready handshake.

### Scribble delivery timing (2026-10-11)

Native pen-up batching ordinarily waits 900ms, intentionally keeping model/JS work away from
ongoing handwriting. `StrokeFlushTiming` now selects 60ms for likely retracing strokes with
sufficient extent/travel and at least two substantial reversals along their longer spatial axis.
This is a scheduling hint, not a second erase recognizer. The existing web detector alone decides
whether ink contact, word intent and gesture geometry justify deletion. Another pen-down cancels
that flush just as before; normal handwriting and disk-save timing retain their accepted idle
windows. No per-MOVE analysis, bitmap capture or waveform change is added. `inkGestureFastFlush`
logs the chosen delay/sample count without ink coordinates. Native timing tests cover short and
vertical scrubs, forward m/w writing, single out-and-back and jitter. Regional erase presentation
still uses its existing coordinated capture; the 840ms reduction is the chosen delivery wait,
not a measured physical panel latency claim.

### Lighter scribble intent (2026-10-11)

The shared neutral detector now accepts three broad passes/two reversals only when they occupy
one tight overlapping band with very high directional concentration. Compact scribbles retain
four meaningful legs and repeated contact with existing ink, but require two sharp turns and a
2.35 travel/extent ratio instead of three and 2.7. Retracing is 0.14 rather than 0.18, retaining
the minimum backwards distance. Device telemetry showed a deliberate scrub rejected at 0.16
before a 31-sweep gesture succeeded. Word-intent filtering is unchanged, so brief neighbour
contact does not expand deletion to that word. Single out-and-back, Z/crossbar, smooth loops,
forward cursive, jitter, rotated gestures and sampling variations have regression coverage.
Recognition stays at pen-up; native writing/refresh timings are unchanged. Physical sensitivity
and accidental-erasure acceptance remains user-owned.

### Regional erase reconciliation (2026-10-11)

`reconcileNativeCommand()` paints silently ingested model changes into the WebView. Its nested
layout/content hooks must be suppressed by the native transaction owner while it runs: the dirty
rectangle already includes that edit. Otherwise the synchronous render callback turns a word-sized
snapshot into a full-sheet update and schedules another GU16 presentation after regional GC16
cleanup. Actual later geometry changes retain their normal lifecycle handling. Native erasing-lasso
transactions also carry `eraseRect`, including the discarded gesture trail and removed ink bounds;
selection/move gestures do not request ghost cleanup. Never reconnect the daemon just to erase.
Regression coverage in `src/kalamos/native.test.ts` checks a nested layout callback, the single
partial capture and absence of another presentation after idle. Physical panel acceptance remains
user-owned; screenshots cannot certify removal of retained e-ink ghosts.

### 5.4 Fast ink commits versus clean model refreshes

The two native refresh styles serve different purposes:

- **Live stroke:** commit only the padded stroke dirty rectangle with the handwriting waveform, then
  blit the clean page back into the daemon buffer without another visible refresh. This gives low
  latency without accumulating A2-style ghost trails.
- **Undo, erase, reflow, page load:** recompose from the authoritative model and use a forced GU16
  refresh. A non-forced ink-biased update may leave a removed stroke ghosted. Restrict GU16 to the
  erase rectangle or paper region; refreshing the toolbar unnecessarily causes visible flashing.

Page replay composes all retained strokes and foreground chrome before a single presentation.
Do not restore shell-first loading: it exposed empty paper before handwriting on larger pages.
The classic controller also parses cold page vectors before presenting; neighbouring pages remain
prefetched at idle. Ruled attachment stages vectors with `defer: 1` before content capture, which
is model-only and never bypasses controller readiness for a visible daemon presentation.

`skipWakeRefresh()` suppresses the attach-time full-screen wake only for a genuinely bounded reader
surface (for example, a sticky-note box) that is guaranteed to perform its own authoritative bounded
presentation. It is a semantic lifecycle choice, not a rectangle-size optimization. **Never call it
from the ruled-workspace adapter:** Planning is a full editor even when headers, margins, or rounded
paper leave its attachment rectangle a few pixels short of the panel. A former pixel-equality check
misclassified that inset editor as a note box; the daemon loaded the complete saved model, but the
panel stayed blank until pen invalidations revealed isolated ruled regions. A subsequent ready-time
near-full render is not a substitute for the one cold-open wake on this firmware.

### 5.5 Ink-to-WebView and WebView-to-ink handoff

Write is daemon-owned, while Insert Space, Blank Lines, Erase, Select, keyboard editing, and target
movement are WebView-owned. A tool switch is **not an editor close**.

The correct transition from ink to a WebView tool is:

1. disable daemon input and flush completed strokes into the scoped model;
2. render the WebView overlay from that now-current model;
3. enter the fast interactive panel policy;
4. retain the already-painted white workspace DOM as the visual cover;
5. detach and clear retained daemon state **without painting a white GU16 frame**;
6. hide the SurfaceView without changing or invalidating the whole WebView.

Using `detachInkBoxCleared()` here caused the whole screen to go white when Insert Space was tapped:
the hard exit painted white, hid the SurfaceView, and exposed a still-transparent WebView. The screen
only returned after an unrelated refresh. Tool handoff must use `detachInkBoxForWeb()`.

Do not solve that blank state by setting the Android WebView background to white and forcing
`invalidate()`/`postInvalidateOnAnimation()` on every switch. The ruled workspace DOM already paints
white paper before the tool callback. A background flip plus whole-WebView invalidation creates a
larger redraw than the established Write implementation and delays carets and reflow. Reveal the
committed DOM frame by hiding the SurfaceView, and deduplicate repeated panel-policy requests from the
tool callback and its accompanying layout callback.

The reverse transition is deliberately covered until ready:

1. restore the normal panel policy;
2. keep the white workspace DOM visible while the SurfaceView is sized and attached underneath;
3. capture the WebView state, including moved text/carets;
4. wait for `onInkControllerReady(true)`;
5. render the authoritative native page;
6. call `showEditor()` to make the WebView transparent and reveal the prepared daemon surface.

This is the same cover-while-loading principle used by the classic handwriting editor. Never make a
blank or stale daemon surface visible and hope a later refresh repairs it.

There is one extra presentation boundary when chrome changes the **physical native-paper bounds**.
Planning full mode insets the writable paper below the top bar and beside the left rail. The native
composition now captures the containing modal, including those controls, while `setWritingBounds`
restricts ink to the paper. An inset paper-only daemon left those WebView bands outside every later
canonical presentation: they could appear during FAST handoff and disappear again on reattach even
though Android screenshots remained correct. Keep model ink paper-local and explicitly translate
replay, incoming strokes, exclusions and refresh regions against the composition's native origin.

Changing composition owners still hides/destroys the old `SurfaceView` asynchronously. Do not call
`attach()` immediately after `disconnect("web")`: keep FAST policy active for the bounded
`WEB_GEOMETRY_PRESENT_MS` window, then use the ordinary capture/attach/readiness sequence. This also
applies when the old paper and new modal happen to have identical outer bounds. Ordinary strokes
and compact floating-toolbar updates retain their existing bounded refreshes. This composition
repair requires physical-device acceptance; screenshot and automated checks do not establish it.

That cover is implemented differently by display capability. Standard Android cannot retain hidden
`SurfaceView` pixels, so `attachInkBox()` explicitly keeps the already-painted WebView background
opaque until the ready-time `showEditor()` call. Bigme must not take that background transition:
its accepted path retains physical panel pixels, and forcing the entire WebView opaque during
reattach can expand a bounded handoff into a full-panel refresh. Keep this as a capability branch,
not a manufacturer check, and repeat both device passes before merging the mechanics.

### 5.6 Library thumbnail ordering

A thumbnail is saved data, not a photograph of whatever happens to be on the panel at one instant.
The exit sequence must be:

```text
flush the final daemon batch into its JavaScript owner
→ checkpoint the complete page model
→ submit that authoritative vector model to InkSurfaceView
→ finish any queued clean WebView/content snapshot
→ copy an immutable native thumbnail bitmap
→ detach and clear the writing surface
→ encode/write the PNG off the UI thread
```

Do not replace this with a fixed delay. A 412 KB device page reproduced the failure: its page JSON
contained handwriting, while the saved PNG contained only the ruled template because capture raced
the heavy-page shell render. `onThumbnailCaptured(id)` is the ownership boundary after which JS may
detach safely. `onThumbnailReady(id)` remains the later disk-write notification used to refresh the
visible library card.

Standard Planning should not normally photograph and reduce the WebView. It renders a final-size PNG
from the authoritative placed vector model, draws rules from the document's actual line height, and
frames non-empty content with a padded bounding box. The crop must contain every stroke, preserve the
library card aspect where the page permits it, clamp at page edges, and use the complete page only for
empty content or when a tighter aspect-safe crop would clip content. Scale the saved pen width with
the crop; an output-pixel minimum makes ordinary writing look artificially heavy. Keep the clean
WebView capture as a fallback if model rendering is unavailable.

Other WebView thumbnail paths can still reduce about 1200 px to 320 px on the Standard reference
device. Always use filtered, dithered bitmap scaling and floating-point destination bounds.
Nearest-neighbour reduction can skip one-pixel rules and break thin curved strokes. This affects only
the PNG and must not introduce a display-mode or refresh-policy branch.

## 6. Stroke and callback ownership

The daemon paints live ink without a WebView round trip. Completed strokes are batched off the hot
path and delivered to JavaScript later.

The active surface owns those callbacks through `window._inkHandler`:

- `onNoteStrokes(strokes)` updates the correct workspace model.
- `onNativeFlushed()` completes an operation that first required a native flush.
- `onNativeSaveRequested()` lets the active owner decide whether an idle checkpoint is appropriate.
- Legacy globals are compatibility fallbacks only when no scoped handler exists.

Do not install another Planning-specific global callback. Do not let an app overlay route daemon
batches around the core handler.

Native detach flushes its last batch asynchronously. The ruled workspace intentionally retains
`window._inkHandler` for 300 ms after requesting detach. Clearing it synchronously allowed the final
Planning strokes to fall through to the classic notebook `window.onStrokesBatch`, contaminating the
old model. A rapid reattach cancels the delayed release.

## 7. Integrating writing, reflow tools, selection, and magnifier

The writing experience is one document model with two input engines. The daemon is active only when
low-latency ink is required. WebView pointer handling is intentionally used for tools that need
continuous feedback from reflowed text, carets, handles, or selection geometry.

### 7.1 Write

The native daemon owns visible pen pixels. When a completed stroke batch arrives, the workspace:

1. converts surface physical pixels back to workspace CSS coordinates;
2. applies scroll or magnifier offsets exactly once;
3. filters redundant close points;
4. creates an ink insert anchored to the nearest mixed-content slot;
5. updates history, vector data, placement, and layout without repainting the DOM.

That last constraint is essential. Even an “idle” WebView invalidation can overlap the next pen-down
and add roughly 40–80 ms of compositor latency. The daemon already owns the visible stroke, so the
web model should ingest it silently and mark itself for reconciliation at the next deliberate action.

Do not feed daemon points through the normal pointer path as well. That produces duplicate strokes
and two competing coordinate conversions.

### 7.2 Insert Space and Blank Lines/caret

These are reflow operations, not drawn annotations:

- Insert Space uses the horizontal drag delta to create, resize, reverse, or remove a scoped gap.
- Blank Lines converts vertical drag distance into a line count and protects that boundary against
  automatic backfill.
- Typed words and ink runs are atomic layout items and must move/wrap together. Insert Space must
  never divide one ink run by assigning its constituent strokes to opposite sides. If contact falls
  inside a handwritten word, snap the visible caret to its leading edge.
- The pure `spatialLayout` engine uses one immutable gesture snapshot and returns committed word
  positions. Temporary handles do not transform the document again during layout or save.
- Horizontal motion from a gap targets its right-hand word on addition and its left-hand word on
  subtraction. Contact inside either half snaps to that word's leading edge; both signs use that
  visible boundary, never a separate raw contact. Spare gaps absorb pressure before a neighbour moves. Subtraction
  leaves words to the caret's right fixed, pushing preceding words when clearance is exhausted and wrapping
  whole words onto previous lines within the same paragraph. Reopening the visible
  handle reverses pushed/wrapped neighbours exactly. Old snapshots are invalid after any new edit.
- Whole-word overflow carries forward iteratively. An explicit paragraph/list boundary reserves its
  own following row. Unrelated next rows are never opportunistically pulled upward.
- Blank Lines starts at zero and rounds to ruled rows. Closing consumes blank rows and pushes earlier
  occupied rows upward, constrained by the page top and actual tall-ink extents. It never hides/deletes words or repacks free ink on contact.
- Taps and cancelled gestures preserve the document and Undo/Redo. Save commits final coordinates,
  including a pending pointer frame. Mode change, resize and cancellation retire pending gestures.
- Checkboxes are controls, not word-pressure items. Explicit semantic controls follow their owner;
  unbound row controls shift vertically. Free-page shapes and object-local ink stay independent.
- Interactive lane ownership uses an upper-body probe (`freeInkLaneIndex`), not the complete bounds
  centre. A long `p`, `g`, or `y` descender can occupy most of the next ruled band while its letter
  body still belongs to the row above. Layout and caret boundary detection must use this helper.
- Stroke timestamps already in the model may break an ambiguous row tie: a nearby stroke within
  240 ms can remain in the current word even if its bounds resolve one row lower. This does not
  store extra history. A clear horizontal return toward the start of a new line still starts a new
  word, regardless of timing.

Production builds emit one bounded `DIAG planningGap` record after each completed gesture. It reports
the scoped line, x/width, stored gap count, and per-line item counts; live drag samples remain silent.

Switching to either tool first flushes native writing, performs the ink-to-WebView handoff from
section 5.5, and uses pointer events so the caret and surrounding content track the pen continuously.
Keeping the daemon active for these drags makes reflow feedback lag behind the physical pen because
the JavaScript model receives only completed batches.

A pointer-up can be lost when a SurfaceView disappears or a relayout replaces the event target.
Listen for `pointerup`, `pointercancel`, and `lostpointercapture` on the surface, with a window-level
capture fallback, or a spacing caret can leave the workspace gesture-locked.

### 7.3 Erase

The eraser operates against vector geometry and history, not against panel pixels alone. Before
erasing, flush current daemon strokes. The workspace may split a grouped ink run into word-sized
pieces so touching one word does not delete an entire phrase.

After a destructive model change, the next native presentation must be authoritative and clean.
Use a forced refresh bounded to the erased area when the native surface remains active; when erase is
WebView-driven, render the changed model there and capture it when returning to Write. Merely painting
white with a fast ink waveform leaves ghosts and does not update persistence.

The stylus eraser signal is not considered authoritative on this daemon. While web erasing is active,
native code discards daemon strokes as a backstop so a firmware tool-detection error cannot repaint
an eraser swipe as black ink.

### 7.4 Select, move, delete, and handwriting recognition

Selection is WebView-driven because hit testing, dashed selection, toolbar state, moving, and delete
all depend on current reflow geometry. A tap selects an ink run; a sufficiently large drag moves it.
Selected native runs are represented with a dashed flag when the page is next rendered.

Packed handwriting needs special handling. Insert Space and finalization can convert a free ink word
into a flow item. Updating only its `afterWord` anchor on every select-drag sample makes ink-only pages
snap to x=0 because every run shares the same empty-text anchor; rebuilding the overlay for each
sample also floods the WebView compositor. During the drag, move the selected SVG directly in
workspace-local CSS coordinates and retain the pen-to-word offset. On pen-up, commit `freeX` at the
horizontal preview position and snap only the word's baseline to the nearest ruled line. Reflow the
model once. Never mix the Android surface's window top with these WebView-local coordinates.

Handwriting recognition is selection-scoped. The HWR candidate sheet is an overlay inside the ruled
surface, so its rectangle must be passed through `setWritingExclusion()` whenever the daemon is
active. Without that exclusion, tapping a candidate can create ink beneath the sheet. Conversion to
text must use the same history, reflow, undo, and persistence path as any other model operation.

Selection-only controls should be hidden on initial entry. Leaving Delete/HWR visible before a
selection overflows the 674 CSS-pixel toolbar and can clip Done.

### 7.5 Undo, redo, collapse, Done, Cancel, and keyboard

Any command that reads or replaces the model must run through `afterNativeFlush`:

```text
disable native input
→ flush completed daemon batches
→ receive onNativeFlushed
→ run exactly one model/history operation
→ reconcile once
→ re-enable input only after the snapshot has landed
```

Undo/redo before a flush can restore a snapshot that never contained the most recent pen strokes.
Done additionally materializes free ink positions, commits spacing results, removes temporary
gap/line operations, rebuilds the compact mixed-content flow, and serializes the sidecar. Hardware
Back must call this same finish path.

Cancel must not accidentally run Done's transform/persistence path. Keyboard mode disables daemon
ownership and makes the WebView authoritative until Write is selected again.

Direct notebook hosts may omit redundant Done/Cancel buttons from the floating toolbar. Their outer
close and hardware Back actions must call the same finish path as Done, including the ordered native
flush, spacing materialization, sidecar commit, persistence, and exit.

### 7.6 Floating toolbar handoff

The collapsed edge tab and the expanded toolbar are captured chrome while the daemon owns writing.
A tap that changes only tab/toolbar visibility must capture the stable content bitmap but refresh
only the union of the old and new toolbar bounds. Do not turn a small chrome expansion into a
full-panel refresh.

Opening the grid/template control into Planning's **full composition** is different from expanding
the floating tab to its compact controls. Full composition reveals a top bar and left rail and
physically insets the writable paper. The native bitmap must include the top bar and rail as well as
that paper, with writing bounds excluding chrome. Use the composition-changing WebView presentation
window in section 5.5 before reattaching. The diagnostic pair is
`DIAG ruledInkGeometryHandoff wait=...` followed later by
`DIAG ruledInkGeometryHandoff reattach`; an immediate FAST→COMIC transition is a regression.

Moving the expanded toolbar is capability-specific. Bigme's persistent panel supports continuous
movement:

```text
pointer down on handle
→ disable daemon input and flush completed strokes
→ detach without a white clear
→ enter fast interactive WebView mode
→ move the live DOM toolbar
→ pointer up
→ restore normal panel policy
→ capture the final toolbar position
→ reattach and present the daemon only after controller-ready
```

Keep the toolbar bounds in the writing exclusion while attached. Do not snapshot every drag sample;
the WebView owns the live gesture, and the final reattach performs one canonical bake.

Standard Android must not use that sequence. An ordinary SurfaceView has no retained panel pixels;
ADB/SurfaceFlinger evidence from the Huion showed that all detach, reattach, alpha and snapshot
handoff variants either refreshed committed ink or made the toolbar lag. Standard therefore does
not construct the native writing owner. Planning and classic Handwriting use their WebView
pointer/canvas path for the complete editor session, and floating toolbar movement changes only DOM
CSS coordinates. Keep native attach/flush/snapshot calls out of Standard toolbar gestures.

This WebView-only Standard path is not a Bigme optimization. Bigme's panel-retained path
intentionally hides and detaches the SurfaceView in its established order. Its comments and
sequencing must remain device-specific and should only change after physical Bigme testing.

The handle also acts as a tap-to-collapse button. Do not begin the native/WebView handoff on
pointer-down; wait until movement crosses the six-CSS-pixel drag threshold. A tap changes only
captured chrome and must never detach the ink controller.

Tapping the active Write pen opens the shared ruled-workspace pen settings. Colour and width are
Writing preferences, not Notes overlay state: persist them through the selected workspace store,
apply them immediately with `setInkStyle`, and retain them on each vector stroke so native repaint
and Standard WebView handoff reproduce the same appearance. The settings panel participates in the
writing exclusion and bounded chrome snapshot contract. Slider movement may update live style, but
capture only once on release rather than refreshing the panel for every sample.

#### Re-enable the shared View on every attach

Final save and thumbnail capture disable ink before flushing. In the shared runtime this also calls
Android `View.setEnabled(false)` on `InkSurfaceView`, and that View flag survives surface
destruction, `GONE`/`VISIBLE`, and the next controller instance. Controller readiness alone is
therefore insufficient: every new `InkSurfaceView.attach()` must restore the View enabled flag
before installing the controller.

This rule is shared by Standard and Bigme. It changes input dispatch only—do not add a panel clear,
display-mode transition, daemon detach, or refresh to this attach repair.

### 7.7 Magnified writing

Magnify is a mode layered over the current tool, not another tool. While open, it owns daemon writing
even if Insert Space or another tool was selected underneath.

The native magnifier composition is full-screen but write bounds are restricted to the lower pad. It
combines two coordinate spaces into window CSS coordinates before conversion to device pixels:

- committed document ink at its scrolled upper-page position;
- current magnifier ink inside the lower pad viewport.

Daemon strokes received in magnify mode are converted back to pad-local coordinates. After a short
idle window, the pad maps large writing into small document runs and reconciles them as separate word
objects so a phrase does not become one giant select/delete target.

Retargeting temporarily needs live upper-document panning. It flushes pad ink, detaches without a
hard white clear, leaves the scoped handler alive for the ordered final batch, switches to fast
interactive WebView mode, and reattaches after targeting ends. Erasing in the pad uses an explicit
native eraser handoff and resynchronizes when the gesture ends.

Classic free-page Handwriting uses the neutral `InkTools.WritingPad` in its zoom variant instead of
copying Planning's reflow-specific host. The viewport shares `write2.magnify.settings`, paints the
template/content/committed stroke model at the selected scale, and maps new pad points directly back
to paper coordinates. On device it must keep the existing full-screen daemon attached, restrict
`setWritingBounds` to the lower canvas, and refresh only that bounded strip. In particular, do not
add a Bigme-only detach/reattach or whole-WebView background transition for classic Zoom.
Both hosts must capture the current pen colour and width on each pad stroke, preserve those fields
through the pad-to-document mapping, and reassert `setInkStyle` when the lower native lane becomes
writable. Per the user's 2026-10-04 thickness preference, placement scales point coordinates by
`1 / magnification` but preserves the captured pen width on the document. A magnified preview of
that committed document may therefore be thicker than live pad ink; page thickness is authoritative.
Replace the staged pad canvas only after the model commit, then
request one bounded post-commit bake. Never substitute a hard-coded black Zoom stroke.

Standard Handwriting is WebView-only. Its classic Zoom may mirror each coalesced pointer segment
directly into the retained upper page canvas for a real-time normal-size preview, but that hot path
must draw only the transformed segment. It must not call `syncNativePage`, request a native
snapshot, or rebuild the complete page during pointer movement. A staged-ink erase or scale change
may rebuild the preview from the committed model. This Standard callback is not part of Bigme's
daemon batch path and must not be used as a reason to change Bigme attachment or refresh policy.

Device handwriting is stylus-owned. WebView `touch` pointer-down must not start main-page pen,
eraser, or Zoom-pad ink; leave touch available to the surrounding interaction layer and explicitly
allow it to drag the upper magnifier target. Toolbar controls and selection UI remain touch
operable. Desktop mouse input may remain as a preview aid. The native daemon is expected to retain
its stylus-only dispatch.

Keep page navigation in the upper document. Overlaying it at the bottom of the mount can cover
Erase, Settings and Close even though every individual target meets the 48px rule. The 34% pad
height and 54% internal baseline are paired geometry: they leave room for 2.5× descenders and keep
the inverse target inside the first visible ruled line. If either value changes, repeat the target
bounds tests and physical checks at 2×, 2.5× and 3×. In Planning full-toolbar mode, retain the
labelled left rail in the upper document and stop it at the 34% pad boundary; hide only compact
floating chrome while Zoom is open.

### 7.8 Persistence and direct Planning documents

A blank direct Planning document is seeded with a zero-width paragraph so the normal block,
sidecar, HWR, and commit machinery has one stable anchor without visible placeholder text. Notes
stores Planning source and sidecar in notebook-scoped `planning.write2.md` and
`planning.write2.json`; the `write2` names are compatibility identifiers, not folder dependencies.

Idle native save requests belong to the scoped handler. Planning intentionally keeps its draft in
memory until the appropriate commit flow, while the classic editor may checkpoint differently. Never
fall through from a present scoped handler into a legacy global save function.

## 8. Three detach modes—do not merge them

`attachInkBox()` geometry is used by three semantically different lifecycle exits:

| Surface | Detach API | Required result |
|---|---|---|
| Reader sticky-note box | `detachInkBox()` | preserve the reader pixels behind the small box |
| Full editor switching to a WebView tool | `detachInkBoxForWeb()` | preserve the current frame, reveal the committed workspace DOM, clear retained daemon state, no full-WebView invalidation or reader callback |
| Full Planning editor | `detachInkBoxCleared()` | flush, white/refresh the editor region, and clear all retained native state |

Planning must never use sticky-note attach, wake-suppression, or teardown policy merely because it
uses box geometry, and a transient tool switch must never use the hard-close path.

Hard editor detach must:

1. Flush pending strokes while the scoped handler still owns them.
2. Push a white bitmap/refresh before disconnecting the daemon.
3. Detach and hide the surface.
4. Clear `displayedStrokes`, deferred stroke callbacks, template parameters, bounds, and content
   bitmap references.
5. Restore the shared view to its neutral full-screen layout for its next owner.

Do not call the classic editor's `clearContent()` during Planning teardown. It recomposes retained
classic state and previously painted the old notebook back into a newly created Planning note.

Do not explicitly recycle bitmaps recently submitted to SurfaceFlinger or the Bigme daemon. Both
consume them asynchronously on this firmware; early recycling caused a native `Bitmap_recycle`
crash. Drop references and allow Android to reclaim them safely.

## 9. Legacy/template isolation

The old parsed-plan/Markdown Planning implementation is not part of the active route. New Planning
notes must not read or write its `plan.md` or `plan-state*.json` files. Historical user files may
remain on disk as inert data, but no executable asset should load them.

When changing the create-note flow, verify all of the following:

- Planning does not invoke the classic page/template editor.
- Its compatibility page template is `blank`, with zero spacing and margin.
- Only `KalamosWriteWorkspace.openWorkspaceNotebook(id)` opens the surface.
- The APK contains the managed `write-workspace.js/css` and no old `planning.js` implementation.
- A newly created note begins with an empty web model and an empty native/panel buffer.

## 10. Symptom-to-cause checklist

| Symptom | First checks |
|---|---|
| Pen moves but only ruled-line fragments refresh | attachment is wider than panel; physical x/y offset is negative; daemon canvas and surface sizes differ |
| Stroke appears only after pen-up or a later refresh | daemon not attached/ready; page presented before ready; style/bounds lost during async attach |
| New note shows old strokes | wrong detach mode; retained `displayedStrokes`; old content recomposition; scoped handler released before final flush |
| Old Markdown/template appears underneath | content snapshot taken before the new frame; legacy creation route/template still active; stale packaged WebView asset |
| Live ink works but Done loses strokes | flush callback routed to the wrong global; active `_inkHandler` missing; persistence runs before native flush completion |
| Full reader flashes white when opening a small note | SurfaceView became visible before it was box-sized |
| Screen turns white when Insert/Lines/Select is tapped | hard-clear detach used for transient WebView handoff; WebView still transparent; interactive panel mode not enabled |
| Android screenshot shows full Planning controls but the panel retains rules/old tab over them | full chrome missing from the authoritative daemon capture; or composition handoff bypassed the FAST WebView presentation window |
| Caret/text movement updates slowly | daemon still owns a reflow tool; fast interactive WebView policy is off; tool switch did not flush and detach |
| Returning to Write reveals blank/stale ink briefly | WebView uncovered daemon before controller ready; missing `showEditor()` ready-time reveal; snapshot queue not settled |

## 11. Logs and device diagnosis

Browser previews cannot validate native latency, daemon composition, waveforms, or persistent panel
state. Use the physical device.

Useful healthy events include:

```text
InkManager: attachInkBox show box=1264x... @(0,...)
InkManager: InkController ready: true (...)
DIAG ruledInkReady presented
DIAG ruledInkBatch strokes=...
InkManager: detachInkBoxCleared: flush and clear full-editor buffer
InkManager: detachInkBoxForWeb: preserve frame and reveal interactive workspace
```

Compare these values between a known-working surface and the new implementation:

- requested box and actual `SurfaceView` width/height;
- logical view layout and physical view layout;
- daemon Canvas dimensions;
- controller-ready ordering relative to presentation;
- stroke-batch owner and detach/clear event.

Android screenshots show the logical composed buffer and can contain completed strokes that the
physical e-ink panel never displayed. A photo and a screenshot disagreeing is useful evidence of a
physical daemon/compositor problem, not proof that stroke capture is working end to end.

## 12. Build, sync, and verification

Build the canonical workspace first:

```bash
cd features/writing/workspace
npm test
npm run typecheck
npm run build:android
```

Then build the affected applications from the repository root:

```bash
./tools/build-apks.sh
```

Build and install the affected self-contained apps. Device acceptance for a full editor must cover:

1. Create a brand-new Planning note and confirm strokes appear in real time.
2. Use Insert Space, Blank Lines/caret, erase, selection, undo/redo, and magnifier.
3. Tap Done, reopen the note, and confirm persistence.
4. Close it and create another Planning note; confirm no old strokes or old template appears.
5. Switch repeatedly between notes and between Planning and another editor.
6. Check logs for exact panel-bounded geometry, ready-before-present ordering, scoped batch routing,
   and hard-clear teardown.

The migrated feature now passes 184 automated workspace tests, TypeScript checking, production
bundle generation and Android builds for Write, Scribe, To-do, Books and Notes. The implementation was
previously user-confirmed on physical hardware for real-time strokes and clean new-note buffers;
acceptance must be repeated for APKs produced by this repository.

## 13. Canonical implementation map

- `features/writing/workspace/src/kalamos/native.ts` — geometry, attach timing, scoped callback
  ownership, hard detach, and native/web synchronization.
- `foundation/android-runtime/src/main/java/com/kalamos/notebook/bridge/InkManager.kt` — lifecycle, stroke
  batching/routing, ready callback, and the two box detach modes.
- `foundation/android-runtime/src/main/java/com/kalamos/notebook/view/InkSurfaceView.kt` — surface lifecycle,
  retained rendering state, style reapplication, and safe buffer teardown.
- `foundation/android-runtime/src/main/java/com/kalamos/notebook/bridge/AndroidBridge.kt` and
  `BridgeRouter.kt` —
  native bridge contract.
- `foundation/android-runtime/src/main/assets/web/js/bridge.js` — stable web bridge facade.
- `devices/bigme/src/main/java/com/kalamos/device/bigme/BigmeInkController.kt` — daemon adapter.
- `features/writing/workspace/src/kalamos/native.test.ts` — geometry, detach, callback-ownership,
  readiness, and native-stroke regression coverage.

The central rule is simple: **one visible editor, one scoped model owner, one panel-bounded daemon
surface, and an explicit hard ownership boundary on close.**

## 2026-10-02 Notes inline text and erasing lasso candidate

The ready candidate is recorded in `artifacts/notes-ready-2026-10-02/QA.md`; it was not installed.
Normal handwriting text input temporarily flushes committed native vectors and uses the existing
canvas handoff to keep template/ink visible while a normal textarea owns Android IME input.
The app paper background is suppressed only while that mirror is active to prevent doubled lines.
Do not bake native content during the transient text session. End restores ownership through the
existing attachment/readiness path. Browser preview advertises the ordinary web-rendering capability;
this is a lab stub, not a change to Bigme provider policy.

Planning's text exclusion includes the attached header and outside Move/Resize/Delete controls.
Recompute bounds after input, completed placement/resize and layout changes; avoid adding bridge
captures for every ink sample. Retain the existing protected chrome reporting, flush ordering,
partial-refresh reconciliation and daemon snapshot policy. Saved layoutLineHeight keeps source,
annotations and ink in their established ruled coordinate system across screen defaults.

Erasing lasso retains selection-pen transport in normal handwriting and intercepts the completed
batch before it is saved as ink. Polygon hit tests operate in page coordinates. Commit deletion once
on pen-up, preserve surviving vectors' placement, and sync the native page once (including no-hit
lassos to clear transient daemon ink). Planning shares the geometry and snapshots before deletion.
Barrel eraser remains ordinary erase. User must accept actual pen, IME and e-ink behavior on device.


KOReader must release its Bigme daemon on Android Activity pause/stop, even when its Lua event
loop remains alive. `KalamosBridge` registers application lifecycle callbacks at startup and
invalidates queued captures/replays on background handoff. Keep completed stroke vectors queued
for Lua to persist under the departing anchor; never restore the old surface automatically on
resume. This prevents KOReader chrome/ink callbacks painting over Notes. Physical acceptance
requires writing in KOReader, switching to Notes, and confirming the book surface stays absent.


## 2026-10-04 live dialog ownership

Interactive editor dialogs use the existing transient WebView handoff, not native content snapshots
under strokes. Writing detects dialogs inside its workspace (including magnifier settings), drains
the completed native batch, mirrors committed vectors into the regular DOM and uses
`detachInkBoxForWeb`. A delayed flush must not detach after the dialog closes. Clear the dialog
preview before native content capture so editable strokes are not baked into the content layer.
Restore through the existing capture/attach/readiness path. Do not add a white GU16 teardown.

Classic handwriting shares a transient session between text and dialog owners. Its canvas preview
keeps the complete page visible; capture/attach callbacks are gated while any owner remains. All
Notes popovers and other mounted editor dialogs participate. Reset owners on hard editor exit.
Browser/screenshot tests do not establish physical e-ink acceptance; see
`artifacts/modal-ink-overlay-2026-10-04/QA.md` for the candidate and user checks.


## 2026-10-04 foreground controls and retained-frame resume

Floating ruled controls must use the retained menu/chrome layer above stroke replay, including the
heavy-page second frame. Flatten snapshots onto white. Window capture coordinates differ from
surface-local bitmap positions on inset editors; convert positions using actual native layout margins.

`resumeInkBox` is a distinct transient-return contract, not a general cold-open optimization. Only
`detachInkBoxForWeb` records eligibility; hard detach consumes it, and measured geometry must match.
JS must also require a previously attached same-geometry workspace and supply affected control bounds.
On native rejection, reset the ready-time replay to the full workspace. Successful resume primes the
complete daemon buffer with `force=false` before the bounded forced presentation. Never prime only
the dirty region: a newly connected daemon otherwise lacks the unchanged page outside those bounds.
Cold opens, app resume, changed geometry and magnifier retain the standard full wake. The ruled
adapter still never calls `skipWakeRefresh`. Physical acceptance remains pending; evidence is in
`artifacts/toolbar-partial-refresh-2026-10-04/QA.md`.

## 2026-10-04 ruled Zoom presentation clipping

The direct-workspace full-screen sizing rule must yield to Zoom's upper 66% paper layout. Native
document vectors must be clipped to that visible, scrolled paper and split around the upper page
navigation; otherwise document ink is replayed over the opaque lower viewport and controls. Clip
only presentation paths, never stored vectors. Staged pad replay is bounded to its viewport too.

Zoom status occupies a separate opaque 30px strip outside the writable viewport. Use the measured
viewport dimensions for mapping/canvas geometry, with a matching pre-mount fallback. The overall
pad remains 34% and its internal baseline remains 54%; target geometry is re-derived on resize and
scale changes. Browser checks at 2×, 2.5× and 3× do not establish physical panel acceptance.
This change preserves attachment, readiness, batch-flush and snapshot/refresh ownership.

## Scribble erasure (2026-10-04)

Scribble recognition is a completed-stroke command, never a second live pen renderer. Normal
native writing remains model-only. Only a strong zigzag that repeatedly contacts saved vectors
is consumed; otherwise it is ordinary ink. Canonical non-Zoom erasure unions dirty bounds and
reconciles at the existing idle snapshot boundary, preserving full retained-bitmap extent and
using partial refresh coordinates with paper origin/scroll offsets. Never detach/reattach merely
to erase. Zoom follows its existing upper/lower canvas reconciliation. Pending Zoom strokes
settle into the page erase snapshot, making Undo independent of pad lifetime. Typed words and
original survivor positions/widths are preserved. Physical acceptance remains with the user;
see `artifacts/notes-scribble-erase-2026-10-04/QA.md` for automated/browser evidence.

## 2026-10-04 Planning sheet controller reuse and canvas readiness

After checkpoint drains and persists completed ink, a Planning sheet transition may retain the
connected controller when measured composition bounds match and the source is settled Write
mode without Zoom or a dialog. Input stays disabled while the old DOM owner is retired; the new
sheet replaces deferred vectors and full retained content, then presents the paper and refreshes
foreground chrome. No attach wake, hard clear or SurfaceView recreation is needed in this path.
Changed geometry, failed load, cold notebook open and app lifecycle boundaries use normal teardown.
This mirrors KOReader's retained-controller strategy without replacing WebView's capture queue.

A Canvas object alone does not establish readiness: firmware returned 0x0 at 22:06:52 while the
previous check logged success. Require full measured logical dimensions or their physical rotation
swap. Reject empty/partial allocations and clean up the client. Shared attach retries at most twice
at 80 ms, scoped to an attach generation; detach/new attach invalidates delayed retries/readiness.
The screenshot captured the complete page while the user reported missing physical-panel regions;
this evidence does not confirm a repair of the panel symptom. Physical testing remains pending.

### Fast retained page scheduling (2026-10-04)

Same-geometry Planning turns schedule their composition without a JS debounce. Dirty regions
still union, but later toolbar/layout callbacks cannot postpone the earliest pending deadline.
Same-geometry observer notifications during the settling interval do not request a second page
presentation. Pen input resumes 500 ms after the capture request using only setInkEnabled(true):
no attach/wake/snapshot is performed merely to enable it. Cold opens, geometry changes and Zoom
retain their normal readiness safeguards. This short pen gate is deliberate; page-turn latency
on the physical panel still requires user measurement.

### User acceptance and preservation notes (2026-10-04)

The user tested the fast scheduling APK installed at 22:21:22 and responded “brilliant”. This
accepts the qualitative page-turn latency improvement on that connected Bigme device. It does
not establish a measured sub-250 ms result, acceptance on other devices, or explicit resolution
of the earlier physical half-screen symptom.

Preserve the complete sequence when refactoring:

1. Drain and persist the departing sheet before retiring its scoped model owner.
2. Reuse the connected controller only for eligible same-geometry sheets; preserve fallback
   teardown/readiness for cold opens, changed geometry, Zoom, failed loads and lifecycle exits.
3. Replace retained vectors and full content bitmap in one composition. Dirty refresh extent
   is a separate contract; partial refresh must not shrink or relocate the retained bitmap.
4. Keep the earliest pending sync deadline. Later layout/chrome callbacks union dirty bounds
   rather than restart the ordinary 160 ms delay, which previously added hundreds of milliseconds.
5. Suppress redundant same-geometry mounting notifications while the sheet settles.
6. Resume pen input after the short gate with setInkEnabled only. Do not add an attach, snapshot
   or forced refresh to that timer; the destination page is already presented.
7. Retain complete Canvas-size validation and generation-scoped bounded attach retries.

Regression checks live in Write2Native regional-sync tests: same-geometry reuse, changed-geometry
fallback, failed-load cleanup, non-postponed page request, no duplicate observer refresh and no
presentation when pen input enables. Physical retesting is required for changes to this sequence.


## 2026-10-04 Native lasso preview contract

The canonical workspace now reuses the existing `selection` pen for both selection and erasing
lassos. `InkDefaults.dashIntervals()` already gives the daemon a spaced dash pattern, and its
running phase continues across native segments. Do not replace this with a WebView live path on
Bigme: ordinary browser/Standard fallback may draw SVG, but the device's live latency belongs to
the existing controller. No vendor pen implementation or interval values were changed.

`usesNativeSelectionPen` governs ownership. Completed native trails route through the workspace's
selection/erase gesture interpreter, never its writing commit path. After interpretation the host
stages authoritative saved vectors and requests the existing bounded partial capture/refresh over
the trail plus changed/moved/deselected vectors. A selection batch suppresses its synchronous layout
callback to avoid expanding this deliberately small dirty area. Chrome keeps its foreground snapshot
and exclusion contracts. Normal writing retains its no-DOM native callback path.

Restore ballpoint and saved width when leaving lasso, including the fast same-controller page-turn
branch. Switching eraser submodes must drain the old gesture before changing its interpreter. Copy,
delete and recognition drain pending native gestures before applying model commands. Dashed trails
must not appear in saved pages, exports or thumbnails. Browser fallback inserts its preview after
overlay redraw so that redraw cannot disconnect the SVG trail.

331 Writing tests and focused Notes checks pass; browser proves compact/expanded tool coverage and
fallback preview/selection. Physical low-latency pen/panel acceptance is still user-owned. Evidence:
`artifacts/native-lasso-2026-10-04/`.

### Canonical scribble whole-word erase (2026-10-04)

The shared scribble detector still identifies repeatedly crossed strokes. Canonical Writing then
expands these hits using `clusterInkStrokesByWord`, the same partition used for selection/movement.
Do not replace this with stroke-only removal or whole-insert deletion: disconnected letters belong
with their word, but phrase-sized legacy/Zoom/lasso inserts can contain separate words. Staged Zoom
ink must settle into the document before expansion so its Undo transaction remains coherent.

The returned partial-refresh rectangle unions the gesture with ALL removed word vectors and width
padding, not merely directly crossed strokes. Otherwise saved data looks correct while detached
letters remain on the physical panel. Preserve the existing native no-DOM completion and bounded
refresh/rearm schedules. Regression evidence: `artifacts/word-scribble-erase-2026-10-04/`;
physical pen/panel acceptance remains with the user.

### Dense main-page scribble residue cleanup (2026-10-04)

User photo showed faint scribble absent from screencap, while logs showed whole-editor forced GU16
updates. Canonical native main-page scribble completion therefore sends a separate `eraseRect` with
its deferred `renderInk`. SurfaceView consumes it after authoritative paper/content/ink/chrome
composition via neutral `InkController.syncOverlayClean`; Bigme implements clamped regional GC16.
Normal GU16 remains; GC16 can briefly flash ONLY word/trail bounds. Do not enlarge cleanup when a
full layout capture is coalesced, carry it across hard detach, trigger it for normal writing or shape/
selection changes, or clean a bitmap before erased vectors are removed. No new attach, snapshots or
rearm delays. Zoom keeps its existing refresh route. Physical acceptance remains pending; evidence
and regression checks are in `artifacts/scribble-ghost-clean-2026-10-04/`.

## Pen hover and proximity (2026-10-08)

The Kalamos ink integration supports tracking the stylus tip **before it touches the screen** on
hardware that reports hover. This is useful for an eraser footprint, placement guides and other
non-destructive tool previews. It is a supported input feature, not a synthetic pen-down gesture.

**Physical-device evidence:** on 2026-10-08 the user confirmed that the connected six-inch Bigme
accurately follows the eraser tip while the pen is roughly **two centimetres above the screen**.
This is a user-observed approximate range, not a calibrated distance measurement or a guaranteed
range for every pen/device. Position is available; this observation does not establish a distance
or altitude API.

### Current input path

- The Android/WebView input path delivers pen pointer movement without contact. In the canonical
  writing workspace, `pointermove` with `pointerType === "pen"` can update a tool cursor even with
  no active pen-down gesture. Do not guard all pointer movement behind an active stroke ID.
- The ordinary sheet's `showEraserTip` and Zoom's `wirePadPointer` use those coordinates to show a
  transparent circle matching the selected eraser diameter. Hover moves the guide; it must **not**
  erase ink, create stroke data, change Undo history or mark a notebook modified.
- Contact owns the erase/write transaction. Pen-up/cancel, surface exit and tool changes retire the
  cursor; subsequent hover movement can show it again. Erasing lasso uses its dotted path instead
  of a circular footprint.
- The circle is foreground tool chrome, not document ink. Preserve the existing native/WebView
  handoff so native ink does not conceal it; never bake a tool cursor into persisted page content.
- Hover is independent of daemon completed-stroke batches. This documents the working input path,
  not a new `InkController` callback or a promise that daemon batches contain proximity events.

Do not turn hover into contact for palm rejection or page-navigation suppression: the current
workspace records pen contact on down/up/cancel, while hover remains a non-destructive preview.
Browser tests cover preview movement without document mutation; physical hover support and range
were confirmed by the user. Reference: `features/writing/workspace/src/vanilla/penWorkspace.ts`,
`features/writing/workspace/src/vanilla/magnifyPad.ts`, and
`artifacts/zoom-review-2026-10-07/browser-eraser-tip.png`.

## 2026-10-13 Allocation cleanup candidate — physical acceptance pending

Controller teardown must wipe the mapped pixel allocation after disabling input/overlay/blending
and before disconnect, even when SurfaceView destruction bypasses a host hard-close frame. This
allocation wipe has no invalidation; transient tool handoff preserves the physical display. Cold
attach also clears the validated mapped canvas before activating consumers, guarding reused vendor
allocations. Boundary logs inspect the existing read-only mapping; expect nonWhitePixels=0 after reset.
Correction after regression audit: regional updates must clip the mapped buffer blit to their
logical rectangle as well as scope inValidate. Replacing the entire allocation during a regional
update can erase unfinished native ink outside that region. Null-region authoritative page
reconciliation still replaces the whole page. Preserve the firmware matrix and use explicit
source/destination bitmap rectangles for physical-pixel composition. This correction has automated
coverage; physical acceptance remains pending.

The earlier runtime isolation candidate failed user testing. A later read-only mapped-buffer capture
has continuous rules while the earlier user photo shows a gap. The samples are not simultaneous and
cannot certify the panel or original attach state. New candidate needs Agora exit→fresh note→first
stroke acceptance; see artifacts/notes-daemon-buffer-2026-10-13/VERIFICATION.md.

### 2026-10-13 Service-owned overlay reset candidate

Mapped input allocation reset alone failed user testing: another notebook still flashed even with
nonWhitePixels=0 logged. The service commits a different full-panel output buffer. Firmware exposes
IHandwrittenService.clearOverlay(id); normal HandwrittenClient.disconnect does not invoke it. The
candidate calls this existing API for the exact registered client before activation and disconnect,
with consumers disabled, in addition to clearing the mapped allocation. Active blending remains.
Client reset ownership/rejection tests pass; actual service-call execution and physical flash
resolution await the next user run. Do not mark this accepted from tests or mapped-buffer counts.

### 2026-10-13 Effective package policy and live ink — follow-up pending

Bigme setters accepted mode180 while readback stayed178. Its installed settings app first selects
DisplayPolicy.COLOR_MODE_CUSTOM before applying a custom waveform; EinkCenter now follows this
sequence and reports rejection. Readback180 is verified. User reports the old notebook did not flash
in that run, but panel handwriting became fragmented despite complete Android screenshot/model.
The follow-up keeps180 for opening and requests previously effective178 on first actual pen contact,
with no per-MOVE policy calls or changes to MODE_HANDWRITE/native vectors. Retire restores page policy
and rejects late contact; a changed tool policy is reapplied at next contact. Physical acceptance
must cover both opening and live writing; neither automated state tests nor screenshots establish it.

### Correction: 2026-10-13 policy experiments rejected and removed

The effective180 and split180→178 candidates above failed physical writing tests. Their code/tests
were removed; do NOT treat those proposals as accepted implementation guidance. Exact pre-policy
APK40056d1f3e8a27980363aece68750eed85858864de6056e9d9c607db8aa1526c and previous default profile/effective178
are restored. Package settings survive install-r and required explicit owned-package restoration;
no permanent profile override remains. Original other-notebook flash is unresolved. Preserve the
restored writing behavior while investigating; recorded logical frames are not panel acceptance.


## 2026-10-15 Selection command delivery and mixed text bounds

The native spaced selection pen remains the live preview owner. `StrokeFlushTiming` takes an
explicit selection flag from `InkManager.dashMode`: selection taps, moves and lassos use a 60ms
post-pen-up idle window, while ordinary pen batching and scribble detection keep their prior policy.
This is a scheduler delay, not an end-to-end latency measurement. A new pen-down still cancels the
queued flush, and existing owner/generation/flush-before-action guards remain authoritative.

Selections can contain typed text-box word ranges as well as complete handwritten word clusters.
After interpretation the regional capture covers the union of the trail, changed ink vectors and
both previous/current selected text rectangles. A text-only move must repaint its old position too,
even when `getNativeInkStrokes()` is empty or unchanged. The existing deferred vector staging,
serialized full-extent content capture, bounded refresh and pen re-enable contracts still apply.
No vendor pen implementation, dash interval, package policy or daemon overlay reset was changed.
Software/browser checks and installation passed; physical pen/panel behavior awaits user acceptance.


## 2026-10-15 Selection capture ends before movement

The `d` replay flag must never represent selection of saved handwriting: it applies the lasso dash
pattern to the original letters. Selection now uses one separate DOM bounding rectangle, while
saved vectors retain their original appearance. After a nonempty lasso/tap selection the workspace
sets interactive movement ownership. Native batch delivery latches its gesture interpreter for the
whole batch, then hands off through the existing no-white-frame `detachInkBoxForWeb` path and
`setInteractivePanel(true)`. Preserve the queued flush-before-action callback during this handoff.
Cancel pending snapshot/re-enable work; dragging must not reconnect the dashed pen. Pointer previews
translate the whole group and its box, committing one model operation on pen-up. Starting another
lasso is explicit through Select words; Write restores ordinary native ink. Erasing lasso retains
its existing capture behavior. Software/browser checks pass; hardware acceptance remains pending.

## 2026-10-17 Completed lasso admission at paper boundaries

A down accepted inside paper owns its completed native stroke. An UP/LEAVE outside the writing
bounds or over chrome must finish that stroke with its last accepted point; it must not drop the
whole batch or route that release as a toolbar activation. Outside coordinates never become a
segment through chrome. New contacts outside paper remain excluded; moving or releasing inside
cannot create ink without an admitted down. Duplicate release packets cannot create extra dots.

The Bigme input proxy preserves the existing callback thread, paint cadence, main-thread completed
batch and scoped runtime owner. It changes admission/completion only, with no snapshot, attach or
waveform change. Robolectric InputProxy tests cover normal and capture-only completion, top/side
exits, excluded starts, finger rejection and duplicate releases. Two boundary regressions failed
before the correction. Device logs showed three pen-downs without completed batches, consistent
with this failure; the actual terminal coordinates were not recorded, so causal physical
confirmation remains user-owned. Evidence: artifacts/notes-lasso-fix-2026-10-17.

### 2026-10-18 Notes background persistence and model previews

The ruled editor handles the existing native idle-save callback by persisting **already delivered**
model vectors. It must not call its ordinary toolbar checkpoint from that callback: the toolbar
path disables input and requests a flush, which would interrupt the idle-save caller's ink session.
No rendering, attachment, snapshots or presentation are owned by this passive save. Zoom retains
its separate recoverable draft.

Home retains the ordered flush/checkpoint followed by generation-scoped suspend. After the save,
thumbnail rendering reads saved page files into an offscreen non-native workspace and atomically
writes a PNG; it never captures the daemon, hides chrome or requests a panel refresh. Explicit close
invalidates older pending background previews and uses the same model-rendered thumbnail strategy.
The old ruled screenshot fallback has been removed. Shared classic-reader capture APIs still have
active consumers. Automated/browser checks do not establish physical Home/resume handwriting
continuity; evidence and installation status: `artifacts/notes-home-save-2026-10-18/verification.md`.
