# Android integration guidance applied to Notes/Agora

Reviewed 13 October 2026 after repeated integration regressions. Community discussion helps identify
failure patterns; the implementation rules below come from current Android documentation and
Google's maintained sample. These are review requirements, not proof of physical e-ink acceptance.

- Activity result callbacks must register unconditionally in stable order when recreated. Keep
  request/document/draft identity saved separately, because Android may kill either process.
  Source: https://developer.android.com/training/basics/intents/result
- Compose effect keys determine restart/disposal; long-lived observers need updated callbacks.
  Do not use an eventual activity lifecycle event as the only way to finish an unrelated operation.
  Source: https://developer.android.com/develop/ui/compose/side-effects
- Give business decisions a state owner; navigation stays a UI responsibility. A consumed action,
  saved request and current UI need coherent state rather than independent ad-hoc booleans.
  Source: https://developer.android.com/topic/architecture/ui-layer/events
- Follow existing components and explicit state holders instead of duplicating screens or global
  editor objects. Reference implementation: https://github.com/android/nowinandroid

Community discussions reviewed:
https://www.reddit.com/r/androiddev/comments/fmyhvv/introducing_the_activity_result_apis/
https://www.reddit.com/r/androiddev/comments/tk8gyw/code_review_request_jetpack_compose_effect_that/
These older threads highlight process-death registration and effect-lifecycle pitfalls; do not copy
historical API examples over current Android documentation.

## Actual corrections and acceptance requirements

Notes activity/bridge holders are scoped to the external editor; native ownership retires on stop
and rejects stale layout callbacks. Picker validates ownership before hiding selection UI and waits
for previous editor cleanup. Selection reuses canonical shelf UI. These fix explicit code gaps;
physical device state was also recovered by reboot, so blanket claims of permanent prevention are
not warranted.

Agora's Notes launch previously kept a remembered busy flag until ON_RESUME. That event is not the
completion of dispatch, and a canceled/reused task or install interruption can leave the guard
latched. NotesLaunchGate now protects the dispatch coroutine only and releases in finally for
success/failure/cancellation. The existing durable NotesExchangeStore continues to fence live
sessions. Three gate tests cover repeated calls without resume, duplicates during dispatch, and
exception/cancellation recovery. Existing NotesExchangeActivity recreation/routing tests also ran.
The latest silent tap was not conclusively attributed to a sampled busy flag; launch logging and
physical retry must confirm the end-to-end behavior rather than treating tests as proof.

Before accepting this integration: tap from new/existing chats, cancel/repeat, return/reopen, switch
apps, reinstall while a request is pending, kill/recreate activities, open an already-owned note,
and change theme/font/shelf density. Verify the same draft/note identities and visible error states.
Physical-panel ink tests remain distinct from Compose/WebView/API tests.
