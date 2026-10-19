# Kalamos Notes

Notes owns its library chrome, creation sheet, routing, samples.
It compiles the shared Android runtime, writing feature and selected device provider.

Every plain notebook now uses the canonical ruled workspace (the former Planning experience).
There is no Handwriting/Planning choice or separate Notes handwriting editor. New notebooks use
`kind: planning` for persisted compatibility and blank metadata page records; the workspace alone
owns visible rules, ink, text, spacing and native handoff.

Existing handwriting notebooks convert on first open or export. `notebook-migration.js` validates
all original vectors, saves `handwriting.backup.json`, writes every ruled sheet and its index, then
commits the discriminator. Original page files are retained. Failure stays on the shelf and never
falls through to a blank editor. Already-converted notebooks are never reconverted on reopen.
Legacy text entries enter the current ruled text model; their original positions/paper metadata
remain in the backup. Old grid/blank/dotted/weekly/Cornell backgrounds become ruled sheets.

Selection supports tapping a handwritten or typed text-box word to move it, or drawing a lasso
from empty paper to select whole word blocks. A lasso that touches one letter includes the rest of
that handwritten word. Mixed typed/ink selections move, copy and delete together; typed words keep
their source ranges and inline styles. A selection has one solid bounding box; original handwriting stays solid. Completed selection
switches to non-ink interactive movement, with a Move toolbar icon. Drag objects or empty space
inside their box; use Lasso → Select words to draw a new lasso. Paragraph handles
appear in the text editor. Edit a selected text box from the Lasso menu's Edit text action.

Both Bigme lassos retain the existing native spaced selection pen for live preview. Completed
selection taps, moves and loops use a 60ms idle delivery window instead of ordinary writing's 900ms;
these are scheduling values, not measured physical latency. Temporary trails never become notebook
ink. Typed-word moves refresh the union of old and new text bounds alongside changed ink.

Horizontal spacing keeps word blocks atomic, and vertical spacing moves typed and handwritten lanes
together. Condense packs mixed content in visible reading order, closes excessive horizontal gaps
and blank rows, and preserves intentional short line endings. A source row ending before 65% of the
usable paper width, a blank source row, or an explicit typed line break starts a fresh condensed row;
near-full wrapped rows may join. This is a geometry heuristic, not language recognition. Undo and
save/reopen retain the resulting word placements. Pen settings include Pen, pressure-sensitive Brush
and a broad Marker, 17 ink colours and stroke-width controls.
Automatic shape correction has been removed. Shapes in the expanded rail offers Rectangle, Circle,
Line, Triangle, Star and Free sketch, with outline/solid fill and attached Move/Size/Delete controls.
These vectors are independent of ruled spacing and persist in the sidecar, previews and PDF export. All existing Planning spacing, text boxes, Zoom, scribble erase,
separate pages, exports and fast native page-turn behavior remain in the canonical feature.
New notebooks suggest Notebook 1, Notebook 2, etc. The counter survives renames/deletions; cancelling
does not advance it. Names can be edited in the creation prompt or renamed from the shelf menu.
The creation catalogue offers Ruled, Week, Tasks, Meeting and Journal. Labels and end-of-row
checkboxes use the canonical spacing model, save/reopen and Undo. Finger taps and small native pen
taps toggle tasks; native taps are not saved ink and repaint only their small footprint. A notebook's
new sheets inherit its starter with fresh checkboxes. Existing notebooks remain as they were.

The former Layers control was a placeholder. Classic automatic text conversion/handwriting cleanup
settings are not exposed; canonical recognition and spacing remain explicit actions.

Retired app-only handwriting JS/CSS and template assets have been deleted. Shared reader
and sketch controllers stay in foundation because readers and native ready callbacks still use them;
removing those shared consumers would break ink outside Notes.

The Notes shelf has a compact title bar and bottom navigation. Separate Note and Folder buttons
create each directly; the hamburger menu holds Search, Library settings, import and sharing actions.
The Notes library opts into the shared nested-folder contract. Folder cards appear beside notes at
every level, notes created inside a folder stay there, and folder records persist an optional
`parentFolderId`. Existing folder records without that field remain top-level. Deleting a folder
moves its direct notes and subfolders to the deleted folder's parent instead of deleting content.

Library settings in the hamburger menu contains the persistent layout chooser. Small displays default to six items
(3 x 2), with a larger 2 x 2 option; larger displays retain 3 x 3 and 4 x 4 densities. The selected
density controls both responsive shelf geometry and the shared paginator's page capacity. Previews
grow to the available width and height while preserving portrait proportions and complete rows. Planning
previews render directly from the authoritative vector model at final size, then crop to a padded
content bounding box while preserving the card aspect, every stroke, and the selected pen's relative
width. Empty pages retain the full sheet. Every folder cover has a tabbed outer silhouette. Non-empty
folders reserve four inset positions: direct notes use rounded miniature page previews, unused
positions remain unoutlined white space, and direct child folders use their own smaller tabbed folder
outline with a deliberately blank interior. Folder slots never recursively borrow descendant page
previews. A completely empty folder retains the large folder glyph. Notes without a saved thumbnail
are explicitly labelled empty.

```bash
./lab/ui/run-preview.sh notes
./tools/gradle.sh :apps:notes:assembleDebug -Pkalamos.device=standard --no-daemon
./tools/gradle.sh :apps:notes:assembleDebug -Pkalamos.device=bigme --no-daemon
node --test apps/notes/tests/planning-integration.test.mjs
```

The APK is `apps/notes/app/build/outputs/apk/debug/notes-debug.apk`. Native ink, chrome snapshots and
partial panel refreshes require physical-device testing.

Notes is an independently installable writing app. **Format with AI** runs inside Notes with its own
provider/model/API-key settings under **Library menu → AI settings**; Agora is not required.
See [AI formatting](docs/AI-FORMATTING.md). Notes does not read the shared ecosystem provider
configuration. Local handwriting recognition remains available. Agora receives Notes through ordinary Android image/text sharing. The dedicated external
document/editor integration is retired in the current Agora source; see the [sharing boundary](docs/AGORA-INTEGRATION.md).
Retired Agent sharing, artifact import and linked-conversation routes remain removed; their existing
notebooks remain normal editable notes.
The existing KOReader implementation in `integrations/koreader` is retained; Notes itself does
not currently expose a direct KOReader launcher. See [the audit](docs/CODE-AUDIT.md).

Long-press a library note or folder to Select/Deselect it while keeping existing actions. Tap more cards to toggle selection; Select all includes all items in the current folder across pages. The selection bar supports Deselect all, Move, Delete and Done. Folder moves reject cycles. Batch deletion confirms and keeps unselected folder contents by reparenting them. Ctrl+A selects the current folder, Space/Enter toggles focused cards and Escape exits selection.

Notes loads the reusable writing presentation, `features/writing/workspace/src/kalamos/notes-writing-ui.css`, generated by `build:android`. Toolbar glyphs come from the neutral runtime `js/toolbar-icons.js`. Reusing these feature/runtime modules does not require another app to be installed.


Mixed selection movement preserves one translation for ink, typed words and the selection box.
Temporary SVG drag transforms are cleared when coordinates are committed or a gesture is cancelled.
Saved individual word placements are authoritative on reopen; only a new/edited text paragraph
enters automatic text insertion flow. Selection movement leaves other objects at their positions;
use spacing to reflow surrounding words. Spacer coordinate bases retain negative as well as positive
widths, and an old gap cannot pull a moved word back onto its previous row.

## Writing design (17 October 2026, corrected)

Compact mode is a short vertical, draggable strip with Pen, Eraser, Select, Undo and Zoom.
Expanded mode uses a single 48px top bar, a 48px icon rail and 60px paper inset. Pen choices, stroke-width samples and a compact colour
palette pop out beside the selected tool. Two persistent colour shortcuts switch ink in one tap.
Format with AI is an ordinary expanded rail icon. Zoom, history, page management and other
existing editing actions remain available. Icons are 27px and menu text is 16px. The earlier labelled rail, two-row header and tiny full
compact strip are superseded.

Notes opts into the feature's `notebookToolbar` layout. Original controls move between existing
chrome containers; native flush/drag/snapshot ownership stays canonical. Background formatting and
incoming external Agora contracts remain compatible. KOReader presentation is deferred.
See [design notes](docs/WRITING-DESIGN.md).


Long-press a notebook → **Share**, or choose **Share** from its expanded writing toolbar, to open
Android’s normal share sheet with the notebook’s pages as JPEG images. Choose Agora there to use
its existing chat destination picker and image attachment thumbnails, or choose any other image
share target. Sharing creates attachments only; it does not send a chat message. Pages retain their
notebook order and numbered filenames. Up to32 pages can be shared at once; larger notes produce an
explicit limit message. No editable document ZIP or AI request is included in this action.

Long-press a notebook → **Share Markdown** to send its current readable Markdown through Android’s
text share dialog. This includes edited AI-formatted headings, lists and task states from editable
page elements, as well as source Markdown. No images, ink/layout JSON or embedded restoration
appendix are included. Choose Agora or another text target. Ink-only notes should use **Share**
for page images. Import still accepts older exports with an embedded restoration appendix.

Notes is also a standard Android text/Markdown share target. Choose **Kalamos Notes** from another
app’s share dialog to create and open a notebook without choosing a file. Incoming text and granted
UTF-8 Markdown files share the ordinary importer; the current note is saved/closed first. A stable
request ID prevents duplicate notebooks on redelivery; existing saved edits are reopened. Input
is bounded to 1 MB and failures do not silently truncate it. No destination-specific integration
or AI request is involved.

Incoming Markdown is processed into formatted Notes elements rather than displayed as raw source.
Headings, prose, lists, checkbox state and supported inline styling remain editable. Tables and
fenced code use read-only page previews while retaining their Markdown for sharing. These previews
are included in page images, PDFs and saved thumbnails. Import Markdown from the library and
incoming Android shares use the same processing path.
