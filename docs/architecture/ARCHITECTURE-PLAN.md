> 2026-10-15 scope update: Play, Learn and Agent and their map/generated-data reader integrations
> are archived. The active app set is Todo, Books, Notes and Explore. KOReader retains pen support
> and annotations. Historical examples below do not reactivate archived apps.

# Kalamos architecture and migration plan

**Status:** adopted target architecture  
**Date:** 2026-07-22  
**Scope:** repository structure, reusable features, Android device support, app assembly, AI-readable documentation, testing, and migration

> **2026-09-12 product amendment:** standalone Write and Scribe are archived under `archive/apps`.
> Notes is the active writing/capture host and Agent owns assisted work. The canonical reusable
> Writing feature remains active. Todo is the Daily Planner and exchanges user-approved tasks and
> goals with Agent through the neutral planner contract in `foundation/documents`.
> See [APP-SYNERGY-PLAN.md](APP-SYNERGY-PLAN.md) for the current cross-app integration map.

## 1. Decision

Kalamos will become **one Git monorepo** with strict internal module boundaries.

We will not preserve the present division into `kalamos-core`, `inksdk`, `kalamos-ui`, and separately vendored application repositories as the target architecture. Those folders are migration sources. They are not constraints on the new design.

The target repository will be called simply **`kalamos`** and will contain:

- reusable foundation modules;
- cohesive user-facing features such as Writing, Library, Reader, and content tools;
- device implementations for Standard Android, Bigme, and Boox;
- independently buildable Android application targets;
- UI and device laboratories;
- catalog, validation, generation, and standalone-export tooling;
- all architecture, integration, and device documentation.

Applications will depend directly on canonical modules inside the monorepo. We will stop permanently copying shared source into every app. Every APK remains self-contained. If a source-level standalone handoff is needed, an export tool will create a reproducible standalone project from the dependency graph and lock file.

The central dependency rule is:

```text
apps → features → foundation
  │                   ↑
  └────→ devices ─────┘
```

Features and device implementations never depend on one another. They communicate only through contracts in `foundation`.

## 2. Why this is better than the current model

The existing vendored-core design made individual repositories portable, but it has reached the point where it creates more risk than protection:

- the ink controller exists in multiple canonical-looking locations and has diverged;
- a shared fix must be synchronized into every app;
- generated and app-owned files are easy to confuse;
- cross-app refactors cannot be atomic;
- an AI must reason about several copies and determine which one is authoritative;
- device mechanisms, hybrid-editor coordination, and product behaviour are mixed together;
- every app carries dependencies and repository configuration it may not use;
- legacy code can remain mounted beneath a new feature even after the visible UI is replaced.

A monorepo provides one revision, one dependency graph, one CI run, one catalog, and atomic changes across a feature and all of its hosts. Strict module boundaries provide the independence that separate repositories were intended to provide, without duplicating source.

Self-contained deployment means the built app contains everything it needs. It does not require each app to carry permanent copies of the source while being developed in the same workspace.

## 3. Goals

### 3.1 Product goals

- Reuse successful experiences, not just isolated source files.
- Allow the same Writing feature to run in Notes and future hosts through explicit host configuration.
- Make ordinary Android pen tablets work without a manufacturer SDK.
- Preserve the device-confirmed low-latency Bigme experience.
- Add Boox through a dedicated implementation without contaminating shared code.
- Support WebView, native Android, Compose, and hybrid features honestly.
- Make a new prototype app cheap to describe, assemble, run, and later promote.
- Give an AI enough structured information to select compatible features and produce a cohesive app.

### 3.2 Engineering goals

- Exactly one canonical source for every behaviour and device mechanism.
- Compile-time enforcement of dependency direction.
- One selected device implementation per APK.
- No manufacturer checks in features.
- No notebook, template, or persistence decisions in device code.
- A real Standard Android pen implementation, not a no-op fallback.
- Stable, versioned contracts for device, bridge, storage, and document data.
- Explicit renderer and capability requirements.
- Reproducible app assembly and standalone export.
- Fast automated tests plus physical-device acceptance gates.
- Documentation and tests for the hard-won snapshot, partial-refresh, lifecycle, and buffer rules.

## 4. Non-goals

The migration will not:

- rewrite working features merely to make them look new;
- convert every WebView to Compose;
- force every feature to support every renderer;
- create one giant device interface;
- package all vendor SDKs into every APK;
- use reflection to guess among every possible device backend at startup;
- change document storage formats as part of the repository move;
- treat browser or emulator success as e-ink device acceptance;
- keep compatibility layers indefinitely.

## 5. Target repository

The final repository layout will be:

```text
kalamos/
├── README.md
├── RULES.md
├── AGENTS.md
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
├── gradle/
│   └── libs.versions.toml
│
├── build-logic/                     # convention plugins and dependency enforcement
│   ├── app/
│   ├── feature/
│   ├── foundation/
│   ├── device/
│   └── quality/
│
├── foundation/                      # stable lower-level contracts and reusable runtimes
│   ├── device-api/
│   ├── ink-model/
│   ├── ink-session/
│   ├── documents/
│   ├── storage-api/
│   ├── bridge-api/
│   ├── web-host/
│   ├── diagnostics/
│   └── test-kit/
│
├── features/                        # cohesive capabilities selected by applications
│   ├── writing/
│   │   ├── kalamos.yaml
│   │   ├── model/
│   │   ├── web/
│   │   ├── android/
│   │   ├── fixtures/
│   │   ├── tests/
│   │   └── docs/
│   ├── library/
│   ├── handwriting-page/
│   ├── reader/
│   ├── content-components/
│   ├── todo/
│   └── ...
│
├── devices/                         # Android hardware and display implementations
│   ├── standard/
│   ├── bigme/
│   ├── boox/
│   └── fake/
│
├── apps/                            # installable Android application targets
│   ├── write/
│   ├── notes/
│   ├── books/
│   ├── todo/
│   ├── scribe/
│   └── sandbox/
│
├── lab/
│   ├── ui/                          # browser preview and visual design laboratory
│   ├── device/                      # small on-device probe/acceptance app
│   └── fixtures/                    # canonical example documents and scenarios
│
├── tools/
│   ├── cli/                         # `kalamos` command
│   ├── catalog/
│   ├── validate/
│   ├── generate-app/
│   └── export-app/
│
└── docs/
    ├── architecture/
    ├── devices/
    ├── features/
    ├── adr/
    ├── migration/
    └── runbooks/
```

The current root can be migrated into this shape in place after a complete baseline and backup. The final repository name should be `kalamos`; `Kalamos-new` is a temporary working name.

## 6. Vocabulary

Consistent terms will prevent another collection of overlapping “core,” “SDK,” “workspace,” and “implementation” folders.

| Term | Meaning |
|---|---|
| **Foundation** | Stable contracts, data types, and reusable runtimes that contain no app or manufacturer decisions |
| **Feature** | A cohesive user capability such as Writing or Reader, potentially containing web, native, model, schema, and integration code |
| **Device** | One implementation of pen input, display behaviour, composition, and hardware integration for a device family |
| **App** | An installable product that selects features, one device target, identity, navigation, and app-specific workflows |
| **Host adapter** | Small feature-owned or app-owned integration that maps a reusable feature into a particular workflow |
| **Renderer** | Web, WebView hybrid, Android View, or Compose presentation of a feature/model |
| **Lab** | Non-production preview, experiment, probe, and acceptance environment |
| **Catalog** | Generated machine- and human-readable index of features, services, renderers, capabilities, and compatibility |

The name `core` will not be used as a general dumping ground. Existing `kalamos-core` code will be classified into foundation, features, devices, or app-specific code.

## 7. Dependency boundaries

### 7.1 Allowed dependencies

```text
foundation module → another lower-level foundation module
feature           → foundation and explicitly declared feature APIs
device            → foundation:device-api, diagnostics, and test contracts
app               → selected features, foundation host runtime, and one device
lab               → anything required for testing and preview
tool              → manifests, source graph, and build metadata
```

### 7.2 Forbidden dependencies

```text
foundation → feature, device, or app
feature    → a concrete device
device     → feature or app
app        → another app
feature    → another feature's internal implementation
production module → lab
```

### 7.3 Enforcement

Custom convention plugins will label every Gradle module by layer. A build-time graph check will fail on forbidden edges. Static checks will also reject imports of known manufacturer packages outside `devices/*`.

Web dependencies will follow the same rules through generated bundles and import linting. A JavaScript file living in a feature may consume foundation bridge services but may not call a Bigme-specific global or reach into an app overlay.

## 8. Foundation modules

Foundation is intentionally small. New code belongs here only if it is stable, reusable, and independent of a product feature and manufacturer.

### 8.1 `foundation/device-api`

Defines:

- device provider;
- capabilities;
- pen input contract;
- display policy and presentation intent;
- composition contract;
- hardware-key contract;
- attach readiness and failure reasons;
- typed coordinate spaces;
- session and detach intent.

It contains no Bigme/Boox classes, constants, repositories, or detection logic.

### 8.2 `foundation/ink-model`

Defines device-neutral pen samples and strokes:

- x/y in an explicitly named coordinate space;
- pressure, tilt, orientation, tool type, buttons;
- monotonic timestamp;
- stroke begin, batch, end, cancellation;
- serialization helpers where shared.

It does not define notebook ownership or a visual toolbar.

### 8.3 `foundation/ink-session`

Owns the reusable semantics of a hybrid writing session:

- state machine;
- callback ownership and session tokens;
- batching and safe drain;
- readiness gating;
- transient tool handoff versus hard close;
- reconciliation transaction;
- platform capability negotiation;
- structured diagnostics.

It expresses what must happen. The selected device decides how to make it visible on that hardware.

### 8.4 `foundation/documents`

Owns shared document identifiers, schema-version primitives, migration interfaces, and neutral document APIs. Feature-specific document models remain with their feature.

### 8.5 `foundation/storage-api`

Defines storage operations and transactions. Local-file, database, cloud, or app-specific implementations can be selected without putting storage calls directly into UI components.

### 8.6 `foundation/bridge-api`

Defines versioned WebView service groups, request/response schemas, error handling, and generated TypeScript/Kotlin bindings.

Initial service families:

```text
kalamos.navigation/v1
kalamos.storage/v1
kalamos.ink-session/v1
kalamos.display/v1
kalamos.snapshot/v1
kalamos.hardware-input/v1
kalamos.diagnostics/v1
```

The existing `AndroidBridge` remains behind a compatibility facade during migration.

### 8.7 `foundation/web-host`

Owns the reusable Android WebView host, secure bridge registration, asset loading, lifecycle, and renderer coordination. It does not own a Notes route or a Write document.

### 8.8 `foundation/diagnostics` and `foundation/test-kit`

Diagnostics defines structured events and performance counters. Test Kit supplies fake devices, fake storage, deterministic clocks, scenario runners, and contract-test fixtures.

## 9. Feature architecture

### 9.1 A feature is a vertical slice

Writing is not just a JS bundle. Its complete reusable feature includes:

- document model;
- interaction behaviour;
- web renderer;
- native coordinator;
- bridge usage;
- schemas;
- fixtures;
- host modes;
- tests;
- integration and pitfall documentation.

Keeping these together makes it possible to understand and evolve the experience as one capability while preserving internal submodule boundaries.

### 9.2 Writing feature

The current Write workspace and the successful Notes Planning integration become `features/writing`.

Its internal responsibilities are:

| Part | Owns |
|---|---|
| `model` | lines, inserts, words, carets, selection, reflow, recognition mapping, undo, serialization |
| `web` | ruled paper, menus, handles, magnifier, interactive tools, DOM rendering |
| `android` | feature-to-ink-session integration and host-facing lifecycle |
| `fixtures` | standalone Write, embedded Planning, stress documents |
| `tests` | model, browser, host-mode, reconciliation, and device scenarios |
| `docs` | specification, integration, pitfalls, and accepted behaviour |

Supported host modes will initially be:

```text
standalone       # Kalamos Write
embedded-plan    # Notes Planning
```

The mode controls creation, completion, cancellation, and storage integration. It does not select a second renderer or a legacy Planning implementation.

### 9.3 Feature APIs and internals

A feature may expose a small public API module when another feature needs it. All other submodules are internal. For example, Notes may depend on `writing:host-api`, not on internal toolbar classes or generated bundle paths.

### 9.4 Renderer declarations

Every feature declares supported renderers:

```text
web
webview-hybrid
android-view
compose
headless
```

The catalog will reject a feature from an incompatible app shell. A future native Writing renderer can share the model and session contracts without pretending the current WebView implementation is native.

### 9.5 Content components

MCQs, checklists, animations, drawing blocks, flashcards, cloze items, and similar tools belong under `features/content-components`. Their authoring schemas and production implementations remain together. The existing content `CATALOGUE.md` becomes a generated authoring view of their manifests.

## 10. Device architecture

### 10.1 Device provider

Each device implementation supplies the same small family of contracts:

```kotlin
interface DeviceProvider {
    val id: String
    val capabilities: DeviceCapabilities
    fun inkInput(): InkInput
    fun display(): DisplayController
    fun composition(): CompositionController
    fun hardwareKeys(): HardwareKeyController?
}
```

This is a provider of separate responsibilities, not one giant controller.

### 10.2 `InkInput`

Owns:

- attach and readiness;
- pen sample delivery;
- live-stroke presentation if hardware accelerated;
- tool, width, colour, pressure, and dash configuration;
- writing bounds and exclusion regions;
- enable/pause/resume;
- detach and release.

It does not know notebook IDs, page templates, persistence, or toolbar commands.

### 10.3 `DisplayController`

Receives semantic requests:

```text
READING_BALANCED
WRITING_LOW_LATENCY
INTERACTIVE_MOVE
CLEAN_RECONCILE
FULL_WAKE
RESTORE_DEFAULT
```

The Bigme implementation maps these to actual panel modes and waveforms. Standard Android uses normal view composition. Features never use numeric waveform constants.

### 10.4 `CompositionController`

Owns hardware-dependent presentation mechanics:

- view/surface ownership;
- WebView and native-layer visibility;
- captured underlays;
- retained composition;
- bounded versus full presentation;
- safe reveal after readiness;
- persistent-panel cleanup.

The reusable session coordinator owns transaction ordering. The device implementation owns the mechanism.

### 10.5 Capabilities

Capabilities are explicit and typed:

```text
ink.realtime
ink.hardware-overlay
ink.pressure
ink.tilt
ink.eraser-tool
ink.dashed-preview
display.explicit-region-refresh
display.fast-interactive-policy
display.clean-waveform
composition.web-snapshot-underlay
composition.persistent-panel
composition.surface-owned-by-device
hardware.page-keys
```

A feature marks each capability as required, degraded, or optional. Unsupported optimizations cannot masquerade as successful no-ops.

## 11. Standard Android device

The default device target is named **`standard`**, not `generic` or `noop`.

It supports Android tablets whose pens arrive through standard `MotionEvent` APIs and requires no manufacturer SDK or special display refresh calls.

### 11.1 Input implementation

The Standard device will:

- accept stylus and eraser tool types;
- consume historical/coalesced points from move events;
- record pressure, tilt, orientation, buttons, and event times where present;
- render the active stroke directly in a native drawing view or surface;
- keep WebView and persistence work off the pen hot path;
- batch completed strokes into the shared session;
- implement bounds and exclusions;
- implement palm rejection based on tool type and active stylus state;
- report absent pressure or tilt honestly.

### 11.2 Display implementation

The Standard device will:

- use normal Android invalidation and composition;
- invalidate bounded regions where useful;
- treat explicit e-ink waveform capability as unsupported rather than pretending to execute it;
- use ordinary view visibility transitions;
- avoid Bigme snapshot delays and retained-buffer work when unnecessary.

### 11.3 Acceptance

- Ink is visible from pen-down with no JS round trip.
- Completed strokes persist and reopen.
- Writing tools, caret, selection, insertion, erasure, and reflow work.
- Tool handoff never blanks the view or loses a stroke.
- The APK contains no Bigme or Boox SDK/code/repository requirement.
- It builds in CI and runs on at least one physical standard Android pen tablet.

## 12. Bigme device

The Bigme implementation begins as a behaviour-preserving extraction of the device-confirmed code. We will not redesign it and hope to rediscover its invariants later.

### 12.1 Bigme-owned mechanisms

- handwriting daemon connection and release;
- daemon Canvas/buffer interaction;
- live style, bounds, exclusions, eraser, pressure, and dash behaviour;
- daemon overlay synchronization and clearing;
- Bigme display-policy service and waveform mapping;
- hardware-specific coordinate corrections;
- retained surface and snapshot implementation;
- diagnostic probes and performance counters.

### 12.2 Non-negotiable invariants

The following are correctness requirements:

1. Physical attach bounds are clamped to the real panel. A 1264-pixel panel never receives 1265 or a negative layout origin.
2. A bounded surface is sized before it becomes visible. A stale full-screen surface must never appear for one frame.
3. Web content covers an unprepared native surface until the daemon is ready and the authoritative page has been presented.
4. WebView captures are serialized under one software-layer ownership window.
5. Captured bitmap extent and physical refresh extent are separate values.
6. Model changes and new snapshots reconcile into one authoritative visible presentation.
7. Live strokes use the fast path; deletes, reflow, load, and final reconciliation use a clean bounded path.
8. Transient Web tool handoff, bounded reader detach, and hard editor close remain separate intents.
9. Scoped callbacks stay owned through asynchronous detach flush and never fall through to another editor.
10. Hard close clears retained strokes, deferred jobs, templates, content, and daemon state.
11. Bitmaps are not recycled while SurfaceFlinger or the daemon may still hold them.
12. Panel policy requests are deduplicated, and toolbar actions do not force whole-WebView redraws.
13. The active Writing feature is the sole visible template/renderer; legacy Planning code cannot remain beneath it.

These rules already have a detailed explanation in `INK-DAEMON-WRITING-GUIDE.md`. During migration, that guide will move to `docs/devices/bigme/ink-writing.md`, and every invariant will gain either an automated contract test, a device scenario, or both.

### 12.3 Extraction order

1. Identify the exact code used by the currently accepted APK.
2. Save baseline logs, screenshots, timings, APK, and source hashes.
3. Copy that implementation unchanged into `devices/bigme`.
4. Wrap it behind foundation contracts.
5. Compare behaviour on device.
6. Move direct device calls out of shared/feature classes one family at a time.
7. Compare after every boundary change.
8. Delete duplicate `inksdk` and app-vendored sources only after acceptance.

## 13. Boox device

Boox will be a separate implementation, not a branch inside the Bigme controller.

The foundation contracts already account for important differences:

- the device may consume motion events;
- the device may own the target surface;
- host `lockCanvas()` may be unsafe while the vendor pipeline is attached;
- readiness and release may be asynchronous in different ways;
- refresh concepts and waveform constants differ.

Work starts in `lab/device`, where the smallest probe app will verify:

1. SDK acquisition, initialization, licensing, and distribution;
2. event and surface ownership;
3. coordinate spaces and density;
4. live ink latency;
5. attach, detach, rapid reattach, background, and resume;
6. partial and clean refresh behaviour;
7. physical-device firmware differences.

Capabilities are marked supported only after hardware evidence. Compiling an existing `OnyxInkController` is not acceptance.

## 14. Device selection

### 14.1 One device per build

Device selection is compile-time:

```text
standard
bigme
boox
```

Example builds:

```text
./gradlew :apps:todo:assembleDebug -Pkalamos.device=standard
./gradlew :apps:notes:assembleDebug -Pkalamos.device=bigme
./gradlew :apps:books:assembleRelease -Pkalamos.device=boox
```

`standard` is the default.

### 14.2 Conditional project inclusion

`settings.gradle.kts` will include only the selected device module. Vendor repositories and dependencies will also be registered conditionally. Therefore a Standard build does not resolve, compile, or package Bigme/Boox code.

The app convention plugin will add the selected provider and expose its ID in `BuildConfig` and the diagnostics screen.

### 14.3 Failure and fallback

An explicitly selected vendor device that fails initialization reports a visible structured error. A device module may deliberately include the Standard implementation as a documented fallback, but it may not silently pretend that the requested hardware path succeeded.

### 14.4 Runtime auto-selection

We will not build a universal auto-detect APK initially. It increases APK size, vendor initialization risk, repository/licensing complexity, and test combinations. It can be added later as a separate distribution if there is a real need.

## 15. App architecture

Each app directory contains only product choices:

```text
apps/notes/
├── app.yaml
├── build.gradle.kts
├── src/main/
│   ├── AndroidManifest.xml
│   ├── kotlin/             # Notes-only navigation and host adapters
│   ├── res/                # branding and Notes-only resources
│   └── assets/overlay/     # Notes-only web routes/styles
├── samples/
└── tests/
```

An app owns:

- application ID, name, icons, and version;
- selected features and their configuration;
- navigation/destinations;
- app-specific workflows;
- storage implementation and data-continuity decisions;
- app-specific overlays and content;
- selected permissions and services.

An app does not own a copied Writing implementation, device controller, shared bridge, or content component.

## 16. App manifest and generated wiring

### 16.1 `app.yaml`

The app manifest is the source of truth for composition:

```yaml
schema: kalamos.app/v1

id: notes
applicationId: com.kalamos.notebook
title: Kalamos Notes
shell: webview-hybrid

features:
  - id: kalamos.library
  - id: kalamos.handwriting-page
  - id: kalamos.reader
  - id: kalamos.writing
    host: embedded-plan

services:
  storage: notes-local
  recognition: myscript

device:
  supported: [standard, bigme, boox]
  default: standard

data:
  compatibility: notes-v1
```

The selected device is still a build parameter; `supported` declares which targets are tested and allowed.

### 16.2 Generated files

The Kalamos CLI resolves the manifest and generates:

- Gradle dependency registration;
- feature registry;
- bridge service registry;
- web entrypoint/import map;
- renderer/host configuration;
- Android resource merge metadata;
- capability validation report;
- `kalamos.lock`.

Generated files live under `build/generated` whenever Gradle permits. Any source-visible generated file has a clear header and hash. Hand edits are rejected.

### 16.3 Lock file

`kalamos.lock` records:

- repository revision;
- app manifest hash;
- selected feature/module revisions;
- selected device;
- generated schema versions;
- vendor dependency versions;
- storage/bridge contract versions;
- export provenance if applicable.

It makes builds and standalone exports reproducible.

## 17. Feature manifests and catalog

Every reusable feature has `kalamos.yaml`:

```yaml
schema: kalamos.feature/v1
id: kalamos.writing
version: 1.0.0
summary: Ruled handwriting and document-reflow workspace

renderers: [webview-hybrid]
hosts: [standalone, embedded-plan]

modules:
  model: model
  web: web
  android: android

dependsOn:
  - kalamos.foundation.ink-session@^1
  - kalamos.foundation.documents@^1

capabilities:
  required:
    - ink.realtime
  degraded:
    - display.explicit-region-refresh
    - composition.web-snapshot-underlay

bridge:
  consumes:
    - kalamos.ink-session/v1
    - kalamos.storage/v1

storage:
  schemas:
    - schemas/write-document-v1.json

scenarios:
  - cold-open
  - write-live
  - ink-web-ink-handoff
  - insert-space
  - caret-cross-line
  - hard-close-clears-buffer
```

### 17.1 Generated catalog

The catalog tool produces:

- `catalog.json` for tools and AI;
- `CATALOG.md` for people;
- dependency and capability graph;
- renderer matrix;
- device support matrix;
- tested/untested scenario status.

There is no manually maintained second list of what exists.

### 17.2 Documentation package

Each feature includes:

| File | Purpose |
|---|---|
| `README.md` | What it is, when to use it, and a minimal example |
| `SPEC.md` | Accepted user-visible behaviour |
| `INTEGRATION.md` | Host configuration, lifecycle, services, and app example |
| `PITFALLS.md` | Known failure modes and non-obvious constraints |
| `CHANGELOG.md` | Compatibility and migrations |
| fixtures/tests | Executable examples and evidence |

Device-confirmed specifications retain the existing change-control rule: update them only after affected hardware behaviour is accepted.

## 18. AI composition workflow

An AI working in the repository will follow a deterministic workflow:

1. Read root rules and the target app’s manifest.
2. Describe the requested user capability, renderer, storage needs, and device targets.
3. Query `catalog.json` rather than searching other apps for code to copy.
4. Select the smallest compatible feature set.
5. Read each selected feature’s manifest, integration guide, pitfalls, and relevant device docs.
6. Edit `app.yaml` and app-owned host/overlay code only.
7. Run `kalamos validate`.
8. Run `kalamos generate`.
9. Preview web behaviour in the UI lab.
10. Build the Standard target.
11. Build and physically verify every affected e-ink target.
12. Update specifications only after acceptance.

The validation tool checks:

- missing feature dependencies;
- renderer incompatibility;
- missing required capabilities;
- duplicate bridge endpoints;
- Android resource collisions;
- storage-schema conflicts;
- undeclared permissions;
- feature dependency cycles;
- forbidden layer dependencies;
- generated-file drift.

An AI never copies Writing code from `archive/apps/write` into `apps/notes`. It changes the
canonical Writing feature and the small Notes host adapter the manifest requires.

## 19. UI and device laboratories

### 19.1 UI lab

The current `kalamos-ui` evolves into `lab/ui`.

It provides:

- browser previews at device dimensions and DPR;
- live reload;
- feature fixtures and state controls;
- component gallery;
- visual regression screenshots;
- app-shell previews.

It imports canonical feature web sources. It does not contain a competing production implementation.

### 19.2 Device lab

The current ink demo evolves into `lab/device`, a deliberately small Android app that can load:

- raw pen input probe;
- live stroke surface;
- attach/detach stress test;
- coordinate visualizer;
- refresh-region visualizer;
- snapshot/composition scenarios;
- WebView handoff scenario;
- hardware-key probe;
- performance counters and log export.

New device support is proven here before a full product app obscures failures with unrelated code.

## 20. Hybrid ink session

### 20.1 Explicit state machine

The shared session uses:

```text
IDLE
  → PREPARING_INK
  → INK_ACTIVE
  → FLUSHING_FOR_TOOL
  → WEB_INTERACTIVE
  → PREPARING_INK
  → INK_ACTIVE
  → HARD_CLOSING
  → IDLE
```

Transitions are serialized, idempotent, logged, and cancellable. A session token identifies the owner of all native and web callbacks.

### 20.2 Detach intent

The three behaviours are typed:

```text
TRANSIENT_WEB_TOOL
CLOSE_BOUNDED_READER_INK
HARD_EDITOR_CLOSE
```

They may share plumbing but never share semantics accidentally.

### 20.3 Reconciliation transaction

A model-changing operation follows one transaction:

```text
gate input
→ flush active strokes to the owning model
→ update canonical model
→ prepare retained native state without presentation
→ capture required web layers
→ compose one authoritative frame
→ present one bounded refresh
→ restore the correct mode
→ re-enable input
```

Bigme fulfills this using retained surfaces, snapshots, and EPD refresh. Standard Android can fulfill it with normal view composition. The feature observes the same successful transaction.

### 20.4 Snapshot contract

Snapshot requests explicitly contain:

- source layer and source coordinate space;
- full capture bounds;
- destination origin;
- dirty/presentation bounds;
- expected readiness generation;
- whether the result becomes a retained layer;
- clean or fast presentation intent.

This prevents the earlier mistake where a cropped dirty bitmap was retained at `(0,0)` and caused content to pin or duplicate at the top-left.

## 21. Archived Write and active Notes reference composition

### 21.1 Archived Write app

`archive/apps/write` historically selected:

- Writing in `standalone` host mode;
- Library if required by the product;
- local document storage;
- recognition service;
- the build-selected device.

It owns Write branding and navigation. It does not own the Writing implementation.

### 21.2 Notes app

`apps/notes` selects:

- Notes shell and library;
- handwriting-page feature;
- reader and content components;
- Writing in `embedded-plan` host mode;
- Notes storage and creation adapter;
- the build-selected device.

Planning creation writes only the storage compatibility record needed by Notes. It does not mount legacy Planning HTML, Markdown placeholder text, a second ruled template, or global ink callbacks.

### 21.3 Shared acceptance scenarios

- cold open shows guidelines with no stale ink;
- writing appears from pen-down and tracks the stylus;
- close and reopen persist the correct document;
- a new note begins with empty native, web, and device buffers;
- Insert Space, Blank Lines, caret, erase, and selection enter responsive interactive mode;
- moved content follows the pen and snaps to the nearest valid target;
- crossing lines preserves content when a valid buffer exists;
- return to ink reveals only a ready authoritative surface;
- undo/redo/erase/reflow produce one bounded reconciliation;
- Done, Cancel, back, pause, and destroy use the correct close path;
- no legacy template or old Markdown appears underneath.

The same scenarios run against both hosts. A failure in one host indicates a host adapter or lifecycle leak, never a reason to fork Writing.

## 22. Build and developer workflow

### 22.1 Common commands

The root wrapper and CLI provide:

```text
./kalamos catalog
./kalamos validate
./kalamos preview notes
./kalamos build notes --device standard --debug
./kalamos build notes --device bigme --debug
./kalamos test feature writing
./kalamos test device bigme
./kalamos new app journal
./kalamos export app notes --device bigme
```

The CLI is a thin, documented front end to Gradle and repository tools. Gradle commands remain available for debugging and CI.

### 22.2 New app workflow

1. Generate an app directory and `app.yaml`.
2. Select features from the catalog.
3. Generate app wiring.
4. Add app identity, navigation, and app-owned host adapters.
5. Preview supported web renderers.
6. Build Standard Android.
7. Add and test vendor targets only when needed.

### 22.3 Standalone source export

`tools/export-app` resolves the app’s transitive module graph and creates a clean project containing:

- the app;
- selected feature/foundation source or locally published artifacts;
- selected device implementation;
- Gradle wrapper and locked versions;
- licenses and notices;
- generated settings and dependency wiring;
- provenance and verification manifest.

The export is tested by building it outside the monorepo. Exported copies are products, not places where canonical development continues.

## 23. Testing

### 23.1 Layers

| Level | Purpose | Environment |
|---|---|---|
| Manifest/schema | Catalog and app composition correctness | CI/local |
| Unit | Models, coordinates, state machine, resolver | JVM/JS |
| Feature contract | Host modes, bridge, persistence, renderer | Browser/JVM |
| Device contract | Attach, events, display, composition, detach | Fake/emulator/device |
| Integration | WebView/native and complete app wiring | Emulator/device |
| Visual | Layout and known states | UI lab/device |
| Hardware acceptance | Latency, e-ink refresh, firmware behaviour | Physical device |

### 23.2 Mandatory ink scenarios

- attach readiness and explicit failure;
- pen-down latency;
- historical/coalesced sample handling;
- pressure, eraser, selection, and bounds;
- CSS/window/surface coordinate conversion;
- cold open and ready-time reveal;
- transient tool handoff;
- bounded reader close;
- hard close and stale-buffer clearing;
- pause, resume, process recreation, and rapid reopen;
- asynchronous callback drain and owner isolation;
- serialized snapshots;
- full capture with bounded refresh;
- deferred render cancellation;
- undo, erase, reflow, and page-load reconciliation;
- WebView hardware/software layer recovery;
- device initialization failure and declared fallback.

### 23.3 Performance telemetry

Record per device:

- pen down to first visible pixel;
- pen up to retained/native commit;
- pen up to model delivery;
- tool tap to interactive renderer readiness;
- tool completion to ready ink mode;
- full and partial refresh counts;
- refresh bounds and intent;
- snapshot queue duration;
- dropped/coalesced samples;
- attach and detach duration.

Thresholds are platform-specific and based on accepted baselines. Standard LCD and Bigme e-ink do not need identical numbers, but each target has regression budgets.

## 24. Continuous integration

CI runs:

1. formatting, linting, and forbidden-import checks;
2. manifest and schema validation;
3. dependency-direction and cycle validation;
4. catalog regeneration drift check;
5. foundation and feature unit tests;
6. fake-device contract suite;
7. browser fixtures and visual smoke tests;
8. Standard Android builds for all active apps;
9. isolated Bigme and Boox compile jobs;
10. selected app integration tests;
11. standalone export build test;
12. lock/provenance verification.

Physical Bigme and Boox acceptance remains a human/device-lab gate. A successful vendor compile cannot update an accepted device specification by itself.

## 25. Documentation

### 25.1 Root

- architecture overview and dependency diagram;
- contributor and AI rules;
- generated catalog;
- device support matrix;
- app/feature ownership map;
- migration status;
- release and acceptance matrix.

### 25.2 Architecture decisions

Record ADRs for:

1. monorepo and module boundaries;
2. feature vertical slices;
3. one compile-time device per APK;
4. device contract decomposition;
5. versioned bridge services;
6. app and feature manifests;
7. hybrid reconciliation transaction;
8. standalone export instead of permanent vendoring;
9. storage compatibility during migration.

### 25.3 Device documentation

Every device includes:

- supported hardware/firmware and evidence date;
- dependency/license instructions;
- capability matrix;
- event/surface ownership;
- coordinate rules;
- display-policy mapping;
- attach/detach lifecycle;
- structured log events;
- performance baseline;
- pitfalls;
- physical acceptance checklist.

### 25.4 Code comments

Comments explain non-obvious invariants, ownership, ordering, and device constraints. They should not duplicate obvious code. Every timing delay must say what asynchronous boundary it covers, how it was measured, and what readiness signal would allow it to be removed.

Hard-won fixes should ideally exist in four places:

```text
clear contract
→ focused code comment
→ executable scenario/test
→ integration or pitfall documentation
```

## 26. Migration strategy

Migration is incremental. The currently working Bigme apps remain installable throughout.

### Phase 0 — Baseline and source census

**Actions**

- Record current repository revisions and uncommitted work.
- Build and archive accepted Write and Notes Bigme APKs.
- Capture device logs, screenshots, videos/timings, storage fixtures, and scenario results.
- Hash every `inkcontroller`, `inksdk`, Write workspace, bridge, and Planning implementation.
- Determine which divergent Bigme files produced the accepted APK.
- Inventory current storage and bridge contracts.
- Back up on-device test data.

**Exit**

- The accepted behaviour is reproducible.
- Every duplicate has an identified origin and status.
- No migration begins from an assumed “latest” file.

### Phase 1 — Create the monorepo skeleton

**Actions**

- Create root Gradle settings, version catalog, build logic, and quality rules.
- Create foundation, features, devices, apps, lab, tools, and docs directories.
- Import Git history where practical using subtree/filter tools rather than plain copying.
- Add module-layer labels and forbidden dependency checks.
- Keep current app repositories untouched as reference builds.

**Exit**

- Empty/reference modules build.
- CI understands the new graph.
- No working app has yet been removed.

### Phase 2 — Foundation contracts and fake device

**Actions**

- Implement typed coordinate spaces, pen data, capabilities, display intents, composition requests, and detach intents.
- Implement the hybrid session state machine.
- Add fake device, deterministic clock, and contract suite.
- Add compatibility facade for existing bridge/controller calls.

**Exit**

- Session lifecycle can be tested without hardware.
- No foundation code imports a vendor or app package.

### Phase 3 — Writing feature extraction

**Actions**

- Move the canonical Write model, web renderer, native integration, fixtures, and docs under `features/writing`.
- Make standalone and embedded-plan host modes explicit.
- Remove hidden dependence on Write app globals and Notes legacy callbacks.
- Characterize every existing Writing tool before refactoring its internals.

**Exit**

- Writing runs in the UI lab and fake-device host.
- Both host modes pass shared browser/model scenarios.

### Phase 4 — Bigme device extraction

**Actions**

- Move the exact accepted controller and display implementation into `devices/bigme` unchanged.
- Adapt it to foundation contracts.
- Move direct `EinkCenter` and controller-factory calls out of feature/foundation code.
- Preserve snapshot serialization, retained composition, partial refresh, and all three detach modes.
- Run Write on device after each boundary move.

**Exit**

- The user confirms Writing on Bigme.
- Feature and foundation code contain no Bigme imports/checks.
- Baseline scenarios and performance remain within accepted limits.

### Phase 5 — Write app in the monorepo (superseded and archived)

**Actions**

- Retain the former app under `archive/apps/write` as provenance only.
- Add Write-only identity, navigation, storage, and host adapter.
- Build with the Bigme device.
- Verify data compatibility and app independence.

**Exit**

- New monorepo Write replaces the reference APK on device with user acceptance.
- It has no path to historical `Write 2.0` or old app source.

### Phase 6 — Notes app and Planning host

**Implementation status (2026-07-22):** source migration, boundary tests, APK build and installation
are complete. Physical-device acceptance is in progress with the user.

**Actions**

- Create `apps/notes/app.yaml` and migrate Notes-owned workflows.
- Select Writing in embedded-plan mode.
- Remove the old Planning renderer, Markdown placeholder, template path, and competing callbacks.
- Preserve Notes application ID and on-device data.
- Run all shared Writing scenarios plus Notes creation/open/close flows.

**Exit**

- User confirms Planning and handwriting on Bigme.
- New notes never show old strokes or legacy Planning content.
- Write and Notes use the same feature modules.

### Phase 7 — Standard Android device

**Actions**

- Implement native standard stylus input and live stroke rendering.
- Implement normal display/composition behaviour.
- Add the Standard build to Write and Notes.
- Test on an ordinary Android pen tablet.

**Exit**

- Writing works without vendor SDKs.
- Standard builds resolve no vendor dependencies.
- Tool and persistence scenarios pass.

### Phase 8 — Catalog, app generation, and export

**Actions**

- Finalize feature/app manifest schemas.
- Generate catalog and support matrices.
- Implement validate, generate-app, and export-app tools.
- Build exported projects outside the monorepo.

**Exit**

- An AI can compose a valid prototype from the catalog.
- Invalid combinations fail before Android compilation.
- Standalone source handoff is reproducible without permanent vendoring.

### Phase 9 — Remaining applications and features

Migrate in this order:

1. Books and Reader;
2. Todo;
3. Scribe;
4. remaining active tools;
5. experimental projects that still have product value.

For every source file, choose one destination: foundation, feature, device, app, lab, tool, documentation, or archive. “Shared misc” is not a destination.

### Phase 10 — Boox

**Actions**

- Prove hardware behaviour in the device lab.
- Implement only verified capabilities.
- Build Writing and Notes for Boox.
- Record firmware-specific evidence.

**Exit**

- User/device testing confirms the shared Writing scenarios.
- Boox dependencies do not affect Standard or Bigme builds.

### Phase 11 — Retire legacy layout

**Actions**

- Confirm every active app and document fixture is migrated.
- Tag and archive old repositories read-only.
- Remove duplicate controller/workspace/build outputs from the active tree.
- Update root rules to describe only the monorepo.
- Rename the final repository/folder to `kalamos` when convenient.

**Exit**

- There is one active source tree and one canonical implementation of every shared concern.
- Legacy projects are clearly archival and cannot enter production builds.

## 27. Mapping from the current folders

| Current source | Target | Treatment |
|---|---|---|
| `kalamos-core/src/java-core` | split across `foundation`, `features`, and app hosts | classify by responsibility; no bulk “core” move |
| `kalamos-core/src/assets-core/web` | relevant feature web modules | keep production source beside its feature |
| `kalamos-core/write-workspace` | `features/writing` | becomes canonical Writing feature |
| `kalamos-core/inkcontroller` | `devices/bigme` and `devices/boox` after reconciliation | accepted implementation wins based on evidence |
| top-level `inksdk` | `devices/*` and `lab/device` | merge useful code; remove as competing project |
| app-vendored `inkcontroller` copies | none | delete after target device acceptance |
| `kalamos-ui` | `lab/ui` | preview canonical feature sources |
| `kalamos-write` | `archive/apps/write` | retained historical app source; excluded from active builds |
| `kalamos-notes` | `apps/notes` | keep only Notes-owned code and host adapters |
| `kalamos-books` | `apps/books` plus reader features | separate product from reusable reader |
| `kalamos-todo` | `apps/todo` plus todo feature | classify reusable versus app-owned behaviour |
| `Write 2.0` | archive/reference only | no build or runtime link |
| root ink guide | `docs/devices/bigme/ink-writing.md` | preserve and link from Writing and Bigme docs |
| `sync-core.sh` | retired | replaced by direct module dependencies and export tool |
| `new-app.sh` | `tools/generate-app` | manifest/catalog-aware generation |

## 28. Risks and controls

| Risk | Control |
|---|---|
| Monorepo becomes an unstructured mega-project | layer convention plugins, dependency checks, feature ownership, public/internal APIs |
| Bigme regression during extraction | baseline first, exact-copy first, one boundary at a time, physical acceptance |
| Foundation becomes the new dumping ground | narrow admission rule and architecture review; vertical behaviour remains in features |
| Features become too small and fragmented | split on independent lifecycle, reuse, and versioning—not file size |
| Device API becomes lowest common denominator | capability negotiation and separate small contracts |
| Standard pen path is sluggish | native hot path, historical samples, bounded drawing, performance telemetry |
| Vendor SDK breaks normal builds | conditional device project/repository inclusion |
| AI catalog becomes stale | generate it from validated manifests and fail CI on drift |
| App manifest and Gradle wiring diverge | generated wiring plus manifest hash verification |
| Legacy code remains active underneath new feature | delete old route/renderer/callback and test single-owner lifecycle |
| Storage breaks during repository migration | freeze formats, compatibility fixtures, preserve app IDs, back up device data |
| Standalone source is still needed | reproducible export tool and external build test |

## 29. Pitfalls that are explicitly forbidden

- No second `core`, `common`, `sdk`, or `shared` project with overlapping ownership.
- No permanent source vendoring between active modules.
- No app-to-app dependency or source copy.
- No feature import of Bigme, Boox, manufacturer detection, or waveform constants.
- No device implementation that knows note type, template, or save path.
- No “not Bigme means Boox” selection.
- No no-op advertised as Standard Android writing.
- No universal vendor APK before single-device builds are proven.
- No untyped rectangle at the web/window/surface boundary.
- No overlapping WebView snapshot ownership.
- No conflation of capture extent and refresh extent.
- No conflation of transient tool handoff and hard close.
- No early callback release that allows a stroke to reach another editor.
- No legacy Planning renderer beneath Writing.
- No bitmap recycling while a system/vendor consumer may retain it.
- No unexplained fixed delay where a readiness contract can exist.
- No changing storage formats during structural migration.
- No deleting the accepted implementation before its replacement passes on device.

## 30. Definition of done

The migration is complete when:

- one `kalamos` monorepo contains every active foundation, feature, device, app, lab, and tool;
- no active app carries a vendored copy of shared source;
- foundation, feature, device, and app dependency rules are automatically enforced;
- Writing is one feature used by Write and Notes Planning;
- Standard Android provides real low-latency native pen input without vendor SDKs;
- Bigme preserves the accepted daemon, snapshot, partial-refresh, and lifecycle behaviour;
- Boox support is based on physical-device evidence;
- exactly one device implementation is selected per normal APK build;
- vendor dependencies are absent from Standard builds;
- every reusable feature and device has validated metadata, tests, integration docs, and pitfalls;
- the catalog lets people and AI select compatible capabilities without copying another app;
- app generation and standalone export are reproducible;
- legacy `Write 2.0`, duplicated `inksdk`, vendored controller, and old Planning implementations cannot enter active builds;
- the hard-won ink lessons exist as contracts, focused comments, tests, scenarios, and documentation.

## 31. First execution slice

The first implementation slice is deliberately narrow and immediately proves the new structure:

1. Baseline the accepted Bigme Write and Notes builds.
2. Create the root monorepo skeleton and dependency enforcement.
3. Add `foundation/device-api`, `foundation/ink-model`, `foundation/ink-session`, diagnostics, and fake device.
4. Extract `features/writing` with standalone and embedded-plan host modes.
5. Move the exact accepted Bigme implementation into `devices/bigme` behind the new contracts.
6. Historical step: create the standalone Write host (now archived under `archive/apps/write`).
7. Obtain device acceptance.
8. Create `apps/notes`, select the same Writing feature, and remove the legacy Planning path.
9. Obtain device acceptance.
10. Implement `devices/standard` and prove both apps on a normal Android pen tablet.

Only after this slice is accepted should we invest heavily in catalog automation, app generation, remaining app migration, and Boox. It creates the correct seams while protecting the working feature that was hardest to achieve.
