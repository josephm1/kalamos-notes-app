# Standard Android device provider

This module is the vendor-neutral Android tablet target. It uses public `MotionEvent` stylus input
and ordinary `SurfaceView` composition. It contains no BigMe daemon reflection, hidden-API bypass,
e-ink waveform calls or vendor repository dependency.

The controller:

- accepts standard stylus input and passes finger/eraser gestures to the WebView;
- consumes Android historical/coalesced pen samples;
- renders the live stroke on the native surface before any JavaScript round trip;
- batches all historical samples from one Android move into one surface presentation, avoiding a
  transaction backlog that makes ink catch up only at pen-up;
- applies writing bounds, toolbar exclusions, pressure width and dashed selection preview;
- sends completed vector strokes through the same shared session callback as other devices.

Build it with `-Pkalamos.device=standard` (the default). Use
`-Pkalamos.device=bigme` explicitly for BigMe builds. Physical latency, palm rejection, eraser
delivery and persistence still require a user acceptance pass on each tablet.

The optional InkEditingController contract supports NativeActivity hosts such as modified KOReader:
capture-only eraser/selection gestures, per-contact drawing decisions, excluded toolbar contacts,
and cropped chrome updates. NativeActivity hosts forward their owned raw MotionEvents through the
host adapter; ordinary Notes Views use the existing listener. Do not feed a contact through both.
Authoritative bitmap replacement uses SRC so a transparent reset actually retires old live pixels.
