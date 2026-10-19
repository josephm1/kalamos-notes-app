# Host testing for handwriting processing

The host tests execute the production exchange and editor code. They do not require
another physical-device transcription attempt. The Notes and Agora checkouts
exchange public ZIP/JSON fixtures; neither imports or copies the other's source.

## Coverage and boundaries

| Stage | Executed implementation | Host limitation |
| --- | --- | --- |
| Export and snapshot | Notes `AgoraDocuments`, storage, manifest and region extraction | Robolectric sandbox, supplied actual page image |
| Attachment preparation | Agora `NotesExchangeStore`, format codec, `MessagePayloadBuilder` | Registered fake Notes activity for availability detection |
| Model input | Actual `projectProviderMessages`, `DeepSeekProvider` serializer | Explicit small test conversation and provider configuration, not complete generation admission/UI |
| Model output | Actual streaming parser and `NotesProposalToolProvider` | Loopback SSE fixtures by default; explicit runner for paid live requests |
| Skills | Actual `SkillManager` and `SkillToolProvider` | Sandbox database and explicit test catalog prompt |
| Skill continuation | Actual projector/converter on synthetic protocol rows and real read-tool result | Does not exercise Room scheduling or generation recovery |
| Layout | Actual `materializeTranscriptionPage` and canvas measurement in Chromium | Host system font can differ from Android; no panel/daemon acceptance |
| Save/retry/undo | Actual native transaction, receipt check and original restoration | Private host notebook directory |
| Editing | Existing production workspace gesture tests: tasks, spacing, scribble and undo | Simulated gestures; physical pen must still be tested later |

Ordinary tests use local fixtures, never a paid endpoint. Live calls are a separate,
explicit CLI step. Source strokes remain local; provider messages contain the page
image and compact document/revision/page/region metadata. A bare image cannot safely
identify the saved strokes to replace. The lossless ZIP remains the exchange artifact.

## Reproducing a run

Use an absolute, disposable host output directory. In Notes, invoke
`NotesHostWorkflowTest` with `apps/notes/tools/host-smoke.gradle` and these properties:

- `notesHostDirectory`: sandbox output directory.
- `notesHostStage=export`: export a fixture.
- `notesHostInput`: JSON with `source` and `sidecar` from a saved notebook page.
- `notesHostImage`: actual page JPEG. The current fixture has logical geometry
  500×623 and raster 1000×1246; adapt the fixture geometry for other notebooks.

In the separate Agora checkout, use `delivery/notes-host-smoke.gradle` with
`:app:testPlayDebugUnitTest --tests com.newoether.agora.notes.NotesHostWorkflowTest`.
The build also uses that checkout's normal preview build init script.

- `notesHostZip`: exported `notes-document.zip`.
- `notesHostOutput`: request/results output directory.
- Optional `notesHostReplay`: recorded raw SSE response.
- Optional `notesHostThinking=false`: actual provider non-thinking configuration.
- Optional `notesHostSkill`: candidate Markdown file loaded by the real skill store.
- Optional `notesHostPrior`: first round's `production-tool-results.json`; recreates
  actual assistant-tool/result protocol rows for the skill continuation.

The harness writes `production-request.json`, using the actual provider serializer.
For a live run, Agora's `delivery/notes-host-live.py` accepts `--request`, `--response`
and a local `--key-file` containing `DEEPSEEK_API_KEY` (or `--key-name`). It submits
that exact request to the official endpoint and saves raw SSE plus bounded analysis
metadata. Credentials are never written into the fixture or output. Treat notebook
images, text and exposed provider reasoning logs as private test data.

Replay the resulting SSE through the same Agora test to execute the real tools.
For a skill read, first replay that response, then capture a new request using its
tool-results file as `notesHostPrior`, submit it, and replay the second response.

Build the browser kernel from the writing workspace:

```sh
./node_modules/.bin/esbuild tools/materialize-transcription-host.ts \
  --bundle --platform=browser --format=iife --global-name=HostTranscription \
  --outfile=/tmp/materialize-transcription-browser.js
```

Run `tools/run-transcription-host.mjs` with the bundle, native snapshot, Agora tool
results and an absolute output ending in `/materialized-pages.json`. Playwright must
be resolvable (for bundled installations use `NODE_PATH`); `NOTES_HOST_CHROMIUM`
optionally selects an already installed Chromium executable. No fake text-width
fallback is used. Finally rerun the native test with `notesHostStage=apply` and the
same directory. It checks editable text, page identity, duplicate delivery and exact
original restoration by undo.

## Research and hypotheses

[tldraw's AI architecture](https://tldraw.dev/docs/ai) uses a screenshot plus
simplified shape data and typed, host-applied actions. Borrow the division of
responsibility: the model supplies meaning; the editor supplies layout, identities
and validation. Do not ask the model to emit verbose scene internals or substitute
HTML for ordinary editable ruled text.

[Excalidraw's element skeleton API](https://github.com/excalidraw/excalidraw/blob/master/dev-docs/docs/%40excalidraw/excalidraw/api/excalidraw-element-skeleton.mdx)
also separates minimal generated elements from fully populated editor records.
This supports keeping our semantic blocks small and materializing them locally.

[Agora's skills documentation](https://newo-ether.github.io/Agora/skills/) says
catalogs contain names/descriptions, with bodies read on demand.
[Tool documentation](https://newo-ether.github.io/Agora/tools/) describes multi-pass
calls and persisted protocol results. A skill read therefore costs a model round;
it is not automatically a token or latency saving for simple transcription.

[Obsidian Handwriting](https://github.com/ellimist-afk/handwriting) keeps Markdown
and ink sidecars separate and integrates ink into editor history. Its published
license is CC BY-NC-ND 4.0; no code was copied. Architectural observations are useful,
but it is not evidence that a borrowed recognizer would meet our requirements.

[The author's Reddit discussion](https://www.reddit.com/r/ObsidianMD/comments/1vxbvz1/plugin_that_allows_you_to_handwrite_in_obsidian/)
discusses stale recognition and stroke hashes.
[Another handwriting-model discussion](https://www.reddit.com/r/ObsidianMD/comments/1vyvg8g/trained_the_handwriting_model_for_the_obsidian/)
raises word alignment and checkbox syntax problems. Treat recognition/performance
claims as author reports, not independently verified results. Keep stroke provenance
separate from text and preserve typed checkbox structure.

Next experiments: a varied corpus including uncertain handwriting, names, numbers,
checkboxes, partial selections and mixed text/ink; compare direct tools, on-demand
skill, and thinking settings. Short host-assigned line references may reduce repeated
coordinate/partial-word reasoning, but are not implemented or proven yet. Preserve
partial-unreadable ink and revision checks in every variant. Simple literal
transcription and structural reorganization should be scored separately.

### Staged recognition and provider parity

`notesHostPrior` also restores private `stagedRecognitions` exported by the host
recorder. Production Notes tools, not a test compiler, bind the continuation result.
The prior assistant's exposed reasoning is replayed through the real projector and
DeepSeek serializer. The host config enables `includeAssistantReasoning` whenever
thinking is enabled, matching production generation with DeepSeek tools. An assertion
checks byte-equal replay when the recorded round contains reasoning.

Optional `notesHostMaxTokens` changes only the explicit host test request's output cap;
default4096. It does not modify Agora settings or production generation limits. Use it
to distinguish token truncation from a failed tool contract, and report both outcomes.
The host live runner saves HTTP error bodies privately without credentials.
