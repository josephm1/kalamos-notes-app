# Handler and startup audit — 13 October 2026

Scope: searched app-owned Kalamos Notes JavaScript/native code, shared shelf/startup code, and
Agora Kotlin for event handlers, timers, observers, loops and Compose effects. Reviewed Notes startup,
shelf selection/picker, integration bridge/return, Agora Notes host/activity/store/composer closely;
reviewed representative service, remote and overlay loops. This is a targeted lifecycle/performance
audit, not a claim that every function in either application has been performance-profiled.
Search inventory: artifacts/notes-handler-audit-2026-10-13/{notes-events,agora-events}.txt.

## What changed

| Finding | Evidence / change |
|---|---|
| Selection had a late shared-runtime dependency | Notes overlay parses before library-controller. State creation now lives in existing NotesSelection model, loaded immediately before selection UI. Both ordinary shelf and picker call that same factory. Removed deferred DOMContentLoaded callback and neutral-runtime state duplicate. Parser-order test initializes without shared library functions. |
| Hold gesture is deliberately delayed, initialization is not | Existing shelf pointer-capture/550ms timer recognizes a stationary hold after pointerdown. Picker mode uses the same shelf and selection controller; no new service, startup timer or polling loop. Pointer movement cancels picker selection; ordinary Notes still drags. |
| Heading corrected itself via observer | Added app-owned libraryTitle config, consumed directly by initLibrary/renderHeader. Removed heading MutationObserver rather than observing a title the app already owns. |
| Agora incoming host did work with no request | Early return before stores/effects when requestId is null. Chat-list collector now exists only while destination chooser is visible; no inbox collector during ordinary chat use. |
| Cancellation presented as failure | Incoming Compose effects and exchange/inbox lifecycle coroutines now rethrow CancellationException before user-visible failure handling. Durable group commit remains NonCancellable intentionally. |

## Other reviewed instances

| Instance | Assessment |
|---|---|
| Notes selection grid observer | Keeps existing selection marks/count correct after paging/re-rendering. One observer per WebView; childList only, small visible grid. Retained. |
| Shelf/picker ResizeObserver | Required when keyboard, selection strip or window dimensions change. Both modes use the original shelf observer and requestAnimationFrame layout; the duplicate picker observer has been removed. Retained. |
| Notes sheet body observer | Watches removal, disconnects itself and disposes picker observer. Sheet-scoped, not perpetual scanning. Retained. |
| Bridge request timeout |120s rejection deadline, cleared on completion; protects stalled export/HWR. Not a startup delay. Retained. |
| Pending native import check |250ms only while external request loading; stops when ready. Not ordinary startup polling. Native error may keep polling until activity is closed; further simplification should use an explicit native-ready event, with recovery tests. No speculative rewrite. |
| Agora Notes launch gate |Operation-scoped admission, finally released; durable receipt owns session identity. No resume observer/polling or arbitrary delay. Retained. |
| Composer CAS retry |Retries on real revision conflict and suspends on persistence/reload. Not a busy idle loop; preserves all-or-none attachment and ordinary draft semantics. Retained. |
| Service Handler / Settings overlay loop |Service posts a lifecycle transition to next main-loop turn; overlay suspends on pointer events. A Handler or while(true) alone does not mean continuously executing work. Retained. |
| Remote polling |Three-second suspend delay, gated by active/visible/epoch. Separate remote feature, not Notes startup. Retained. |
| Shared automatic book scan |initLibrary dispatches a worker scan, including Notes; scanner migrates records, lists import directories and refreshes metadata. Candidate for profiling/explicit capability policy, not blanket deletion while mixed-content/reader behavior exists. |
| Shared script parsing |Installed Notes reported65 scripts. Many reader/AI assets predate this integration. Candidate for measured module loading work in foundation; do not remove arbitrary reader dependencies from a handwriting processor supporting interactive content. |

## Evidence and limits

Installed pre-cleanup WebView navigation sample: DOMContentLoaded471.7–548.5ms, load557.9ms.
This includes all startup handlers/native shelf reads and is not an attribution to selection, an Android
cold-launch benchmark, or proof of physical panel latency. No measured speedup is claimed.

Notes81 and related shelf/reader516 tests pass. Native Notes20 and Agora Notes/composer18 tests/builds
pass. Source syntax/boundaries/diff checks pass. Physical hold/return acceptance remains user-owned.
No daemon, snapshot or refresh policy changes in this cleanup.

Guidance: [MDN DOMContentLoaded](https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event)
recommends correct dependency placement rather than unnecessary readiness wrappers;
[Android coroutine best practices](https://developer.android.com/kotlin/coroutines/coroutines-best-practices)
requires propagation of cancellation;
[Compose effects](https://developer.android.com/develop/ui/compose/side-effects) scopes asynchronous work
and its cleanup to the UI that owns it. Current improvements use existing components and state owners.

Native hold evidence: on this Bigme, touch pointercancel and
contextmenu arrive510ms after pointerdown, before the550ms timer. Read-only picker had blocked that
menu. The corrected menu → Select path was confirmed working by the user. At their request, the
picker now consumes that same native contextmenu event through the original Notes selection
controller, entering selection directly without a popup. The compatibility release click is suppressed
only for the held card, so another note can be selected immediately. Ordinary Notes menu behavior
remains. No new timer or alternative gesture recognizer; physical direct-selection acceptance pending.
