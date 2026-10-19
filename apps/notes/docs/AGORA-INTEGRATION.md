> **18 October 2026 — dedicated integration retired.** Notes owns processing and shares images,
> Markdown text or files into Agora through Android's standard share sheet. Current Agora source
> removes its Notes launchers, document inbox, proposal/handwriting tools, result actions,
> automatic return, settings and background processing. KOReader and generic sharing remain.
> The details below record the earlier protocol, retained by Notes only for compatibility;
> they no longer describe entry points offered by the current Agora source. Existing installed
> APKs are unchanged until updated. See [current AI formatting](AI-FORMATTING.md).

# Notes and Agora document workflow

Implemented 12 October 2026. Notes owns editable notebooks; Agora owns conversations, immutable
attachments and proposed revisions. Initial target is the installed Agora e-ink preview. The
ordinary Agora flavors use the same Kotlin protocol, without a sibling-project build dependency.

## Use

As of 18 October 2026, **Format with AI** is self-contained in Notes, with independent provider
settings and a local worker. It no longer uses Agora's background processor or result broadcasts.
See [AI formatting](AI-FORMATTING.md). This document covers only the optional explicit external
attachment/editor workflow. Its URI grants and document validation remain compatible. The separate
Agora toolbar control and Work with Agora shelf entry remain absent from Notes' normal interface.

Agora's attachment menu offers **Write in Kalamos Notes** and **Attach from Kalamos Notes**.
Write opens a dedicated full editor. Attach opens searchable note rows, then a preview. A reserved
native header above the writing WebView has Back, the note title, attachment options and **Attach to
chat**. The action checkpoints and attaches all pages by default; options allow page selection and
handwriting recognition. At most 32 pages are included per attachment. Android Back dismisses an options sheet first. Back from the editor saves locally and returns without adding an attachment;
Back from a picked-note preview returns to the picker, and cancelling the picker returns to Agora.
Existing draft text and other attachments are preserved. Notes-originated attachments still require
an explicit destination choice; a previous linked chat remains a hint.

Agora and its editor handoff use separate tasks. Reopening Agora's icon opens Agora, rather than the
foreign editor above it. Only one handoff is admitted: repeating an entry resumes the exact unfinished
request and retains its original draft owner. Terminal or abandoned receipts cannot create another
note. A failed return keeps an error screen with Retry and Back to Agora, rather than disappearing
behind a toast. Consumed result extras are removed from the launcher intent.

The external Notes fragment owns an activity-scoped WebView and bridge holder, reusing the existing
shell/editor code without stealing the warmed Notes launcher WebView. Requests enter through the final
`onAppReady` boundary after the shared shell publishes its route. The actual router API is
`App.showEditor`; the removed implementation's nonexistent `App.openNotebook` was a missed test defect.
Notes grants one mutable editor owner per notebook, preventing a second window from overwriting it.
Canonical close has an awaitable completion for ordered revision transitions and toolbar handoffs.

Agora Interaction settings contain the integration switch and the page-image default. These are
portable DataStore preferences. The ordinary generation admission freezes the integration preference;
a settings change cannot alter an already admitted Run. Tool-capable models can return a completed
`propose_notes_document` result. Models without tools may return the same supported content as a
completed fenced JSON proposal. Ordinary text answers also offer Create note, with deterministic
heading/list/task import. Failed, partial or invalid proposals never apply.

Completed AI results use the direct **apply** handoff. Notes checkpoints the editor, validates
the base identity and content, stages new page files, and atomically publishes the page index.
There is no revision review dialog, Current/Proposed view, Apply button or save-proposal-copy branch.
Stale or invalid results leave the original editable note open with an error; they never overwrite
new handwriting. Repeated accepted proposal IDs do not apply twice.

## Contract and preservation

ZIP MIME `application/vnd.kalamos.notes-document+zip`, manifest schema `kalamos.notes-document/v1`.
Proposal MIME `application/vnd.kalamos.notes-proposal+json`, schema `kalamos.notes-proposal/v1`.
Document/proposal UUIDs and revision SHA-256 are not timestamps. Blocks have stable identities,
type (heading/paragraph/bullet/numbered/task), literal text and boolean task state. Host code assigns
new proposal/block IDs. Semantic text is derived from editable source/text boxes; task text and its
checkbox share a stable binding. Moves/deletion and copied pages preserve/reassign these bindings.

Bundles contain selected source/sidecars and optional JPEG previews, with exact file checksums.
Paths are restricted to pages/<safe-id>.md/json/jpg. Limits: 100 MiB, 32 pages, 1 MiB manifest,
2000 blocks, 20000 characters per block, 200-character titles and 80000-byte proposals.
Files are transferred through narrow read-granted content URIs; receiving Agora copies them into
its private storage before the grant expires. Opaque sidecars/origin/private paths are excluded
from provider context. Local HWR reads a snapshot without replacing its ink or inventing confidence.

Original complete source and sidecars are preserved before transformation, even when the exported
selection was smaller. Independent annotations, ink and shapes are conservatively retained on
editable preserved pages behind the new structured pages. They are **not automatically re-anchored
into rewritten prose**. This is an explicit safe fallback rather than claiming semantic understanding
of arrows, handwritten corrections or every drawing. Open original copy restores a normal editable
copy. Recovering a missing local note from an Agora attachment explicitly creates a separate identity.

The first release does not implement background sync, arbitrary HTML import into Notes, an embedded
Agora handwriting editor or editable tables. Existing interactive answers remain separate sandboxed
views, with their e-ink adaptation unchanged. No Kalamos Agent/Todo/Books integrations were restored.

## Verification and remaining acceptance

Behavior tests cover real editable task state, semantic copy/movement, preserved vectors/shapes,
idempotent/stale apply, revision hashing, safe ZIP paths/checksums, direct result application and stale result retention and cancelled
attachment non-mutation. Agora covers host IDs, exact draft ownership/CAS, frozen preference, resource
parity, non-tool proposals, archives and existing e-ink behavior. Full Android flavor suites and APK
builds are recorded in artifacts/notes-agora-2026-10-12.

The agent did not draw on or navigate the physical panel, execute paid model requests or claim
physical acceptance. User must test both origin directions, repeated edit/AI rounds, task taps,
handwriting latency and recognition, Android URI/result delivery, keyboard layout and cancellation.
