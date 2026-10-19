# Content components

This feature owns Kalamos' app-neutral interactive learning contracts, attempt reducer, scoring,
bounded pen model, scenario graph, and browser renderer. `apps/learn`, `apps/play`, and Books supply
their own generation, source, persistence, and navigation adapters.

The runtime is closed data, not an extension API: model output is validated JSON and may never
provide HTML, JavaScript, CSS, executable SVG, or remote asset URLs. Each template is described to
providers by a compact manifest; only selected JSON Schemas are placed in a generation prompt.

The public browser globals are `KalamosContent` and `KalamosContentRenderer`. The CommonJS export
from `content-core.js` is the same contract used by Node tests.

See [`docs/features/CONTENT-COMPONENTS.md`](../../docs/features/CONTENT-COMPONENTS.md) for the
catalogue, contracts, asset boundary, pen protocol and extension checklist.
