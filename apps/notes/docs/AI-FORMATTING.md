# Format with AI in Notes

18 October 2026. Formatting runs in the Notes APK. Agora does not need to be installed or configured.
The AI model itself is accessed through the provider configured in Notes.

## Setup and use

Open **Library menu → AI settings** and enter an OpenAI-compatible HTTPS API base URL and API key.
Choose **Load models**, select a model from the dropdown, then Save. **Refresh models** gets a fresh
list without an app update. Saved settings automatically refresh the list when the dialog opens.
Models explicitly advertised as image-capable are labelled **Images**; providers without capability
metadata are kept in the list without a guessed label. Use an image-capable model for every page.
Choose **Enter model ID manually** if a provider does not publish a compatible catalogue or for a
private model. A failed refresh never changes the saved model or settings. Newly entered keys remain
unsaved until Save, so discovery works before a model has been chosen. The URL excludes `/chat/completions`; Notes
adds that route and uses Bearer authentication. Provider/model selection is independent of Agora
and the shared Kalamos AI configuration. Keys stay in the app's native Secrets store and are excluded
from Android cloud backup and device transfer. An edited endpoint cannot receive a saved key during discovery: enter a new key for that endpoint.
Status replies expose only whether a key is saved;
a blank key keeps the saved value. **Remove key** explicitly clears it.

**Thinking level** offers Off (the default), Low, High, Maximum and Provider default.
Saved configurations without a thinking setting migrate to Off. Direct DeepSeek uses
`thinking.type=disabled` for Off, or `thinking.type=enabled` plus `reasoning_effort` for other
explicit levels. OpenRouter uses `reasoning.effort` and requires parameter support; other
OpenAI-compatible endpoints receive `reasoning_effort`. Provider default omits these controls.
Unsupported explicit levels can fail at the provider; Notes does not retry with higher thinking.
Queued jobs record the thinking choice and fail if it changes before execution.
The user's connected device already selects `https://api.deepseek.com` / `deepseek-flash`;
this update retains those settings and defaults missing thinking configuration to Off.
Protocols checked against [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/),
[DeepSeek vision](https://api-docs.deepseek.com/guides/vision/) and
[OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Choose **Format with AI** from the expanded writing toolbar. If setup is incomplete, this opens
Notes' AI settings. Notes checkpoints the current page once, captures its saved JPEG and revision, and queues
one local WorkManager job. The preparation path skips document ZIP export, editable-block projection,
cover/thumbnail rendering, preview-cache writes and repeated checkpoints. Native admission records
only the JPEG plus small local identity/revision/page/provider metadata; no source or sidecar files
are copied into the job. Metadata stays local and is not included in the provider message. Pressing the action immediately announces preparation, then formatting and saving. Native Android
toasts appear above the ink surface once per phase, with a persistent summary in the existing bottom
20px gutter. State changes capture only that gutter, leaving paper/toolbar geometry unchanged.
Browser previews use a larger bottom WebView toast. Success remains briefly; failures keep their
reason until dismissal (browser), closing the note or retrying. No animated dots or spinner, and
polling does not repeat the same toast. Preparation, provider, result-reading and local-placement
errors share this feedback path; failed placement never becomes a success notification.
The job can continue with Notes in the background. No chat or external activity is opened.

Every page—including typed-only and mixed pages—uses one handwriting/Markdown prompt and one
rendered JPEG. No existing text blocks, document JSON, coordinates, notebook files or credentials
are placed in the model message. The API key is used only for provider authentication. The selected
model returns plain Markdown; document identity, revision and page scope stay local.

The prompt requests exactly one nonempty Markdown line per occupied ruled row, preserving words,
reading order and checkbox states. It permits headings, lists, tasks and inline emphasis, and forbids
explanations, HTML and code fences. The exact instruction is `NotesAiFormatter.MARKDOWN_PROMPT`.
The whole selected page is reformatted: existing typed content and handwriting become editable text.

Local saved ink/text geometry determines the occupied rows and the leftmost text position on each
row. Parsed Markdown rows are matched in reading order to those positions; the original blank grid
gaps are preserved independently of Markdown blank lines. The model supplies no placement coordinates.
Numbered list markers are retained literally as editable paragraph text, including explicit
starts, restarts and nested numbers; no automatic counter can alter them. In this path, parsed row
order takes precedence over regrouping children by parent. Multiple saved checkbox controls on one
row reject formatting rather than collapsing into one control. Rows cannot wrap into extra rows or spill onto another page. A line-count mismatch, overflow, changed
existing checkbox state, unresolved ink or overlap with a retained page object rejects the result
without replacing the original page. Drawn page objects are retained. Multiple text columns on one
ruled row are treated as one row; arbitrary spatial layouts are not reconstructed. Equal row counts
cannot prove that a model assigned the correct words to each row: transcription still depends on
following the prompt.

The editor validates the exact captured revision and materializes editable content. It then
checkpoints and retires the old model, atomically replaces the selected page slot, and refreshes the
same note surface using the existing sheet-turn retention path. No library route, note-close event,
cover capture or external reopen occurs. The old frame remains visible while committing; toolbar
mode, Zoom and scroll position are restored. The old model cannot save over the new revision.
Publication failure reloads the saved original; deliberately navigating away during commit never
reopens the note. If the user has moved to another page, that active page remains selected. Original revision undo remains
available. Writing or editing while the request runs makes the result stale; it cannot overwrite the
newer page. Empty, truncated or invalid responses fail without changing the saved note.

Model discovery uses a read-only `GET <base URL>/models` with Bearer authentication, following
[OpenAI](https://developers.openai.com/api/reference/resources/models/methods/list),
[OpenRouter](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
and [DeepSeek](https://api-docs.deepseek.com/api/list-models/) response conventions. It does not send
a note or start model generation. Other API formats still require manual entry and must offer the
OpenAI-compatible chat endpoint used by the formatter. Notes does not infer vision capability from
model names. Pagination/oversized-list limits are reported with manual entry available.

## Ownership and recovery

- `app/src/main/java/com/kalamos/notebook/ai`: own settings, bounded provider request, model catalogue and worker.
- `exchange/NotesBackgroundProcessing.kt`: durable request/receipt, unique request admission,
  idempotent completion and acknowledgment. Credentials never enter jobs or receipts.
- `exchange/AgoraDocuments.kt`: existing Notes-owned validation, revision transaction and recovery;
  the historical class name also serves the optional external document exchange.
- `web/js/notes-ai-settings.js`: setup dialog; `agora-documents.js` retains the shared revision
  application UI but dispatches formatting through `notes.ai.*` local methods.

WorkManager uniquely schedules each request and waits for network access. Completed requests are
not sent again. A process death after a request was marked running produces an interruption error,
rather than automatically repeating a possibly charged provider call. A new attempt requires a new
explicit Format action. Configuration changes while queued fail the old request if its model or
endpoint changed. Results remain local until acknowledged by the editor.

Old pending external formatting receipts become actionable interruption errors; already delivered
local receipts still use the normal revision checks. Removed the external processing receiver,
broadcast/replay dispatch and grants for the private job directory. Optional explicit Agora
attachment/editor entry points remain separate and compatible; see [external exchange](AGORA-INTEGRATION.md).

## Verification

Native tests cover prompt-plus-JPEG payloads (including typed-only pages), host-bound identities,
invalid/incomplete responses, settings, stale revision rejection, replacement/undo and interrupted
job recovery. Writing and web tests cover local row placement, inline styles, nested tasks, checkbox
preservation, overflow and the application transaction. Computer tests use copies of eight saved
device notebooks with controlled Markdown, including representative Notebook 27/28 transcriptions;
they verify original row/left anchors and save/reopen stability without making an AI request.
Evidence: `artifacts/notes-image-grid-2026-10-18/verification.md`. This revision has not been installed;
physical panel testing remains user-owned.
