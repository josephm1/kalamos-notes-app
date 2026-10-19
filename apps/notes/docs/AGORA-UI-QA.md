# Notes–Agora UI inventory and quality assurance

This covers UI introduced for the integration, including less-visible error/recovery states.
The integration's source locations are apps/notes/app/src/main/assets/web/js/agora-documents.js,
apps/notes/app/src/main/res/layout/agora_session_header.xml, and Agora-eink's notes and ui/chat
packages. Existing writing tools/ordinary bookshelf controls are not new integration UI.

## Kalamos Notes

| Surface | How to reach it | Added elements to inspect |
|---|---|---|
| Library action | Library menu → Work with Agora | Menu label/action and opening the note chooser |
| Expanded writing toolbar | Expand tools → Agora | Agora button; Work with Agora/Attach to chat accessible label; quick iteration while editing |
| Note picker | Agora attachment menu → Attach from Notes; or Notes library action | Actual Notes folders/covers, recent ordering and original pager/count; no copied top toolbar; bottom Back and Search; hold → direct selection → tap multi-selection and Attach group |
| Picker empty states | Search nonsense; test an empty library | Filtered shelf/empty library behavior; keyboard, search close and Back dismissal |
| Locked-note state | Select a note still open in the other Notes window | Error stays visible with picker; Open existing Notes window action; browse another note or Back; original window retains sole edit ownership |
| External editor header | Agora → Write in Notes, or select a note | Back chevron, notebook title, Agora draft subtitle, Options menu, Attach to chat; loading/busy disabled actions and Preparing label |
| Attachment preparation | Notes toolbar → Agora; external header → Options | Work with Agora/Return to Agora heading, note title, page-selection checkboxes, Include page images checkbox, Cancel, Continue in Agora/Attach to chat, preparation/errors |
| Handwriting recognition review | Preparation → Recognize handwriting | Recognize button, progress/status, editable transcription fields per selected page, recognition unavailable/timeout feedback; original ink preserved |
| Original-version recovery | Preparation for a revised linked note → Open original copy | Original copy action and separately opened editable note |
| AI processing return | Successful explicit Notes tool result in active Agora chat | Automatic return and commit; existing notebook grid, editable text/tasks, scribble/spacing/Undo; no normal Apply step. Stale results retain the current editable note and report an error without a dialog. |
| Stale revision/save errors | Review after original changed; failed apply/export | Apply disabled for stale base, explanation and copy option, visible retryable error; dismissal retains current document |
| Native recovery/error dialog | Linked document unavailable locally; malformed request | Recovery explanation, Cancel/Recover buttons, failure messages; no silent note replacement |

## Agora

| Surface | How to reach it | Added elements to inspect |
|---|---|---|
| Attachment menu | Chat composer attachment button | Write in Notes and Attach from Notes actions; hidden when integration disabled |
| Returned note attachment | Attach a note to the draft, then send/open it | Note attachment title, page/image preview, Open in Notes action; correct original draft; no automatic Send |
| AI proposal card | Successful Notes proposal tool result | Proposal title, block-count/handwriting-preservation description, Open in Notes button; direct processing without a review dialog |
| Completed-answer actions | AI response | Create note in Notes or Review revision in Notes action |
| Incoming-note draft chooser | Notes → Continue in Agora | Attach Notes document dialog; New chat draft, existing conversation rows, Linked chat marker, Cancel; destination choice does not send |
| Return/import failures | Interrupted or invalid return | Could not attach note, saved-note reassurance, Retry, Back to Agora; Notes document Retry/Close dialog and snackbars |
| Integration settings | Settings → Interaction | Kalamos Notes toggle and explanation; Include Notes page images toggle/default; enabled/disabled state persistence |
| Session-resume feedback | Reopen Notes action with unfinished exchange | Resuming unfinished note message; original draft ownership retained |

## Check on each surface

- Readable titles/body at the device's normal and larger font settings; no clipped controls or horizontal scrolling.
- Familiar Notes bookshelf covers, typography, borders and spacing; picker inherits paper/ink/font tokens.
- Touch targets, keyboard focus, hardware Back and visible Cancel all have predictable effects.
- Footer/header remains reachable with long lists, long titles, many pages or the keyboard shown.
- Selected/disabled/busy states remain distinguishable on the monochrome display.
- Cancel never attaches/sends/applies; saving a copy does not overwrite the original.
- Return to the originating app/chat works; completed sessions do not reopen on app launch.
- Existing saved handwriting remains visible immediately after viewing, editing and returning.

## Styling boundary

The current picker is a selection-only mode of `#library-view`. It calls the same `renderLibrary`,
`renderGrid`, `renderHeader`, folder navigation, thumbnail pipeline, `renderPagination`, layout observer
and `KalamosNotesSelection` controller as the ordinary Notes bookshelf. There is no independent picker
controller, grid, pagination state, dialog wrapper or layout observer. `enterShelfPicker` temporarily
replaces the normal menu with Search and removes creation controls; selection actions become Attach
instead of Move/Delete. Closing restores the normal routes/controls. AppLibrary.readOnly prevents
context mutation and dragging in picker mode. Native exchange header and copied Notes top toolbar are absent in the picker; Back is on the bottom bar. It returns only after opening an editor. Current user settings and future
shelf design changes therefore affect both through the same DOM/styles/rendering path.

Browser/source checks are not physical panel or handwriting acceptance.

## Multiple-note picker — 13 October

The picker uses the real Notes bookshelf and its original selection controller. Its app-owned adapter
changes available actions and the open route; it has no independent folder/page/search/selection state.
Card/folder markup, recency rules, layout/density, thumbnails and pagination are the same source paths.
The footer search icon toggles the original search strip; narrow screens use the same previous/count/
next composition and omit first/last as the shelf does. Picker creation/hamburger/Move/Delete remain omitted.

Physical QA:

1. In Agora, Attach from Notes: compare covers, folder tiles, recent order and footer against Notes.
2. Search from the bottom icon, find a note on another page/in a folder, close search, and page again.
3. Hold a note: selection starts immediately without a popup. Release it, then tap another, navigate pages/folders and select more. Ticks/count persist.
4. Select all affects the current folder or search results. Clear/Done behave like the shelf.
5. Attach the group: all selected notes appear as separate attachments in the same original chat draft;
   existing draft text/attachments remain and nothing sends automatically.
6. Cancel returns without attachments. A locked/unreadable note shows an error and publishes no partial group.
7. Tap one note normally: preview/editor, Back, Attach and existing writing remain usable.
8. Repeat at the shelf's two/three-column settings and larger font size; bottom controls stay reachable.

Limits: 32 notes per group, up to 32 pages per note and 100 MiB total. Larger notes can use the
single-note page chooser. Both apps need the updated batch-result contract; older Agora versions do
not import a multi-document result. Source-render screenshots are browser QA, not physical acceptance.

Current startup ownership: NotesSelection.create in the existing selection model loads before UI.
There is no deferred selection initializer. Both ordinary shelf and picker use existing shelf hold
recognition; in the picker a native hold enters selection directly, then taps add/remove notes. The ordinary Notes shelf retains its existing menu. See HANDLER-STARTUP-AUDIT.md for other
startup/lifecycle findings and retained observers. Physical hold and multi-attachment QA is pending.

Physical confirmation 2026-10-13: direct hold enters selection without a popup; releasing and tapping a second note shows 2 selected. User confirmed on the installed Bigme build. Other matrix items require their own acceptance.

AI/grid and thumbnail acceptance matrix: [AI-DOCUMENT-RETURN.md](AI-DOCUMENT-RETURN.md). Actual images replace ZIP presentation for Notes only; unchanged page renders are cached with revision/viewport keys.
