# Notes code audit — 12 October 2026

18 October amendment: Notes now owns [AI formatting](AI-FORMATTING.md), a narrow provider setup
and a private worker. The general shared AI/HTTP/WebSocket bridge and ecosystem configuration
remain absent. Optional Agora document exchange is separate from the built-in formatter.

## Scope

Reviewed the latest Notes-owned Android entry points, manifest, app bridge, web startup,
library/selection controls, import/export code and tests, plus inherited native bridge services.
The current work retains the generic Android scribble-trail correction. No notebook deletion,
format conversion or ink/refresh-policy refactor is part of this cleanup.

## Integration inventory

| Component | Before cleanup | Result |
|---|---|---|
| Kalamos Agent | Shelf/context sharing; exported note picker; artifact import; linked-conversation notebook and return attachment; package query and cache FileProvider | Deleted from Notes |
| Shared ecosystem AI configuration | Notes inherited provider status, shared secret lookup, HTTP and WebSocket dispatch from CoreAppBridge; configuration is managed by Agent | Notes now extends LocalAppBridge; these services are absent from its bridge |
| Todo, Books, Learn, Play, Explore | No direct Notes launch/import/share routes found; some neutral contracts and host-specific branches exist in reusable libraries | No active Notes routes to remove; other app implementations left intact |
| KOReader | No direct launcher in Notes. Reader/plugin support exists in integrations/koreader and reusable components | Retained unchanged |
| Android file picker, PDF printing/export and Markdown import/export | System document workflows, with no dedicated ecosystem recipient | Retained |
| MyScript | Licensed handwriting-recognition SDK inside Notes, not another installed app | Retained |

Agent's embedded writing feature is reusable feature code and continues to work independently of
Notes installation. Agent's previous external Notes exchange actions no longer have Notes endpoints.
No app-owned integration implementation was deleted from another app.

## Cleanup performed

- Deleted AgentWriting, NotePickerActivity, NoteImportActivity, agent-writing.js, its cache-provider
  XML and all corresponding manifest/bridge/UI routes.
- Deleted the no-op NotesApp subclass; the manifest uses the neutral KalamosApp directly.
- Removed the unused Notes page-export helper load, the redundant direct documents-module
  dependency and the placeholder Sync status action, which only showed a toast.
- Extracted existing local status/HWR/event-channel behavior into LocalAppBridge. CoreAppBridge
  layers its existing AI/network services on top for other hosts. Notes inherits only the local
  layer. There is no disable flag or dormant Notes integration dispatcher.
- Encoded unknown-method errors through JSONObject so names with quotes remain valid JSON.
- Removed obsolete Agent-route tests and replaced the stale personal-credential packaging
  expectation with standalone-boundary checks. Notes presentation tests no longer read Agent files.

Previously Agent-created/imported notebooks and historical origin files are retained as user data.
Ordinary PDF/Markdown export, local recognition, selection, folder navigation and writing remain.

## Packaging and source limitations

Notes still compiles the canonical foundation and writing libraries. The unminified debug APK may
contain unused generic AI/network classes or shared browser assets that other hosts use. These are
not registered Notes endpoints. Removing them from the repository would break other apps; a future
standalone source export should include only the necessary module/dependency closure and use a
reviewed release-shrinking/asset-packaging strategy. This cleanup does not claim a minimal APK or a
complete redesign of the foundation library.

The existing APK uses a development signing certificate and unchanged version 1.0.0; release
signing/versioning remains part of publication preparation. The repository includes app-owned
MyScript licensed material; keep the planned GitHub project private. No credentials, local user
backups, generated APKs or private device data should enter the source export.

## Verification

- Notes: 65/65 tests pass.
- Writing: 428 tests, typecheck, Android regeneration and ownership boundaries pass.
- Broad app/component checks: 665/666 pass; only the previously documented Todo credential-
  packaging expectation fails. Aggregate test-all stops there.
- Reader/KOReader: 22/22 pass separately.
- Standard build and shared native unit tasks pass. Agent/Books Kotlin compilation passes.
- Bigme build and final installation/package evidence are recorded in the artifact receipt.

Physical writing, panel behavior, recognition and export acceptance remain user tests.
Artifacts: artifacts/notes-standalone-audit-2026-10-12.
