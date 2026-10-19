> **Historical source document.** Kept for product rationale only. Paths, build commands and project
> boundaries may describe the pre-monorepo layout and are not current instructions.

# Write 2.0 Successor — Product and Build Plan

> **Direction update — 2026-07-14:** The owner has chosen a framework-agnostic
> core and a vanilla JavaScript DOM UI for the next phase. The React recommendation
> later in this original plan is historical and should not guide new work. The
> authoritative migration and e-ink plan is in [HANDOVER.md](./HANDOVER.md).

## 1. Product statement

Build a local-first, pen-first Markdown reader and editor for small Android tablets and e-ink readers. A document should look like a calm reading page. The user touches a Markdown block, adds or edits typed text and handwriting in a comfortable writing workspace, and returns to the clean document without navigating to a separate editor screen. Handwriting may remain visibly handwritten alongside the Markdown text.

The central interaction is inspired by Stylus Labs Write: when content is inserted, everything after the insertion point moves forward and wraps onto later lines. The new product applies that idea to structured Markdown rather than treating the whole page as a freeform drawing.

This plan is for a web application/PWA. The first target is current Chromium-based Android browsers at widths down to 320 CSS pixels and screens around six inches diagonal.

## 2. Product principles

1. **Reading is the default state.** The interface is a document, not a dashboard.
2. **Edit one meaningful block at a time.** A paragraph, heading, list item, quote, code block, or thematic break is the unit of focus.
3. **The pen writes; the finger navigates.** Pen input edits or draws. One-finger touch scrolls. This rule should remain predictable throughout the app.
4. **Markdown remains canonical.** The app must not silently replace a user's file with a proprietary document format.
5. **Ink is first-class content.** Handwriting does not need to become typed text. It must remain editable, movable, and anchored to the relevant Markdown block.
6. **Small-screen space is precious.** Controls appear only in context, then disappear.
7. **Local-first means genuinely local.** Opening, editing, autosaving a recovery copy, and exporting must work offline.
8. **Never lose work.** Every destructive or ambiguous operation is undoable, and saving never overwrites an externally changed file without warning.

## 3. What Stylus Labs Write contributes

Stylus Labs describes Write as a handwriting word processor. Its distinctive implementation groups strokes by ruled lines, uses gaps between stroke groups as possible word breaks, and moves overflowing groups onto the next line when space is inserted. Its published feature list also emphasizes ruled selection/erasing, direct manipulation, bookmarks, ordinary files, and unlimited undo/redo.

The useful ideas to carry forward are:

- live reflow while the insertion gesture is happening;
- moving subsequent content, not painting over it;
- line-aware selection and erasing;
- direct pen manipulation with immediate visual feedback;
- undo/redo as a core editing model, not a recovery afterthought;
- ordinary user-controlled files.

Do **not** copy the original interface or source implementation. The current Write repository is AGPL-3.0. Use it as product research only unless this project deliberately adopts a compatible licence and complies with it. The plan below describes an independent implementation for Markdown.

Research links:

- [Stylus Labs](https://www.styluslabs.com/)
- [Write 3 feature list on Google Play](https://play.google.com/store/apps/details?id=com.styluslabs.writeqt)
- [Stylus Labs Write source repository](https://github.com/styluslabs/Write)
- [Pointer Events overview](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [Pressure-sensitive pointer input](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure)
- [Coalesced events for smoother ink](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)
- [File System Access guidance](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)

## 4. Assessment of the supplied mockups

### Keep

- Markdown rendered as distinct semantic blocks.
- A focused workspace for a selected section.
- Ruled writing lanes.
- A visible insertion point and the idea of opening space after it.
- Local files, explicit saved state, undo, and redo.
- A fallback way to use typed/system handwriting input.

### Change

- Remove permanent block numbers, right-edge boxes, repeated “after block” labels, and full-width separators. They make a reading page look like an editor inspection mode.
- Remove the permanent bottom mode bar. It occupies too much of a six-inch screen and duplicates controls found in the workspace.
- Do not use a large centred modal with its own title, mode switch, instructions, line-count controls, close button, and Done button. It separates the user from the document and creates too many simultaneous decisions.
- Do not open a separate margin drawer for ordinary edits. Marginal notes can be a later feature.
- Replace persistent status text such as “HWR ready” and “Saved” with a small transient status indicator. Show it only while saving, offline, conflicted, or in error.
- Avoid blurring the entire document behind an editor. Preserve enough surrounding text to maintain location and context.

## 5. Proposed interaction model

### 5.1 Reading state

The screen contains:

- a compact top bar, approximately 40–44 CSS pixels high, with Back/Files, filename, and overflow;
- the rendered Markdown page using nearly all remaining width;
- no bottom toolbar;
- no visible per-block controls.

Block hit areas extend slightly into the side margins without adding visible boxes. A pen hover, pen tap, or long press may reveal a faint block highlight. A normal finger swipe scrolls immediately and must never accidentally enter editing.

The top bar collapses while scrolling down and returns when scrolling up or tapping the top edge.

### 5.2 Entering an edit

- Pen tap on a block: open that block in the writing workspace.
- Finger tap on a block: select it subtly; a second tap opens it. This avoids accidental edits while reading.
- Keyboard users: Tab to the block and press Enter.

The selected block expands **in place**. The surrounding document remains visible above and below, dimmed slightly but not blurred. On an extremely short viewport, the editor may occupy the viewport below the top bar, but it must still feel attached to the selected block.

### 5.3 Focused writing workspace

The focused block has three layers:

1. a low-contrast ruled background;
2. laid-out editable text;
3. a transparent ink canvas.

Use a comfortable physical line height. Start at 44 CSS pixels and allow a user preference from 38–56 pixels. The workspace initially shows three or four lines and grows up to about 70% of the viewport; after that it scrolls internally.

A small floating tool pill appears near the lower edge and contains only:

- undo;
- redo;
- pen/eraser toggle;
- keyboard button;
- Done.

The pill collapses to a single pen button after inactivity. Advanced pen colour, width, Markdown type, and block actions live in a secondary sheet opened from the pill or top-bar overflow.

### 5.4 Insert-and-reflow interaction

The minimum viable interaction is:

1. Tap between words or at a line end to place an insertion caret.
2. The caret displays a small pen-sized handle.
3. Drag the handle to the right to create temporary writing space, or simply begin writing and let the space grow automatically.
4. Text after the caret moves right in real time. Whole words that cross the right margin wrap to the next ruled line. This continues through all later lines in the focused block.
5. The completed handwriting becomes an inline ink run. It stays handwritten and participates in the same reflow as a word-sized object.
6. Press Done to commit the ink to the document's sidecar; undo or Cancel restores the original text and ink layout.

Dragging the insertion handle left removes unused space but must never delete text. Deletion is a separate, explicit gesture.

This reproduces the *feeling* of Write's ruled insert-space tool while letting typed Markdown and handwriting coexist. The Markdown stays canonical; the linked sidecar supplies inline ink objects during rendering.

### 5.5 Deletion and correction

For the first release:

- select text and use a visible Delete action;
- use the system keyboard's deletion gestures where available;
- use the eraser on the active ink run;
- lasso an existing ink run to move, resize, or delete it.

Scribble-to-delete typed text is a later feature. It is too easy to trigger accidentally and needs real-device testing before it is enabled.

### 5.6 Input routing and palm rejection

- `pointerType === "pen"`: write, erase, place caret, or manipulate the insertion handle.
- `pointerType === "touch"`: scroll the document. Two-finger gestures may zoom only if a later usability test proves they are needed.
- While a pen is in contact or has been active in the previous 500 ms, ignore touch points beginning inside the writing workspace. This is the web fallback for palm rejection.
- Pen barrel button acts as a temporary eraser when the device reports it. Pen eraser tip should erase strokes in the active ink run.
- Mouse input must remain usable for development and accessibility, but must not define the tablet UX.

## 6. Markdown behaviour

### Supported in the first usable release

- YAML front matter preserved verbatim;
- headings;
- paragraphs;
- ordered and unordered list items;
- task list items;
- blockquotes;
- fenced code blocks;
- inline emphasis, strong text, code, links, and images;
- thematic breaks;
- GitHub-flavoured tables rendered read-only initially.

### Editing rules

- A paragraph or heading is one editable block.
- Each list item is one editable block, including its nested inline formatting.
- A fenced code block opens a monospaced text editor, not the handwriting canvas by default.
- A table opens a compact source editor in version one. Pen-native table editing is out of scope.
- Images can be viewed but not inserted or repositioned in version one.
- Pressing Enter at the start or end of a block creates a sibling block of the appropriate type.
- Backspace at the start may merge with the previous compatible block, but only after this behaviour has dedicated tests.

### Round-trip preservation

Parse Markdown into an AST that includes source offsets. Keep the original source string. When a block is committed, replace only that block's exact source range. Do not reserialize the whole document, because doing so would alter unrelated spacing, wrapping, HTML, or formatting choices.

After every source-range edit, reparse the document and remap block identities. Prefer, in order:

1. an existing explicit stable ID in the session;
2. the previous block type plus a content hash and nearby neighbours;
3. the closest source position.

If remapping is ambiguous, keep the affected ink in a visible “Unplaced ink” recovery area and warn the user; never attach ink to the wrong paragraph and never silently discard it.

## 7. Mixed typed text and handwriting

Handwriting recognition is explicitly deferred. The initial product stores the user's actual strokes and displays them beside typed Markdown.

When a user finishes a group of strokes, convert that group into an **inline ink run**. An ink run is similar to an inline image, but remains editable vector data. It contains:

- a stable ID;
- its strokes and pressure data;
- a block anchor and character offset;
- short text context before and after the anchor for recovery;
- intrinsic width and height;
- baseline alignment and scale;
- creation/update timestamps.

The active editor may show individual strokes. The reading view renders each committed run as inline SVG so it stays sharp on high-DPI and e-ink displays. Its box participates in line wrapping: if it does not fit after the preceding word, the whole run moves to the next line. Do not split one ink run across lines in version one.

Allow the user to insert more handwriting before or after an existing run, lasso a run, move it to another caret, resize it within a conservative range, erase strokes, or delete it. Preserve the original stroke coordinates and apply transforms non-destructively.

Typed editing remains available through a real `<textarea>`, including Android system handwriting keyboards if the user chooses them. That is an alternative input path, not a recognition dependency.

Design the stored ink schema with a version field so recognition can be added later without changing the document model. A future recognizer may offer “Convert ink to text,” but no recognition UI or service belongs in the initial build.

## 8. File and storage model

### Canonical files

- Open `.md`, `.markdown`, and `.txt` files through the File System Access API where supported.
- Retain a file handle for explicit Save in supporting Chromium browsers.
- Feature-detect the API. Fallback to `<input type="file">` for Open and a downloaded file for Save As.
- Never claim that autosave reached the original file unless a write actually succeeded.

### Recovery storage

Use IndexedDB for:

- the latest source snapshot;
- uncommitted block drafts;
- committed and uncommitted ink runs;
- recent-file display metadata;
- user preferences;
- undo history for the current session.

Autosave recovery data after a short idle delay and on `visibilitychange`. Show “Recovered draft” on the next launch if the recovery copy is newer than the last confirmed file save.

### External-change conflicts

Store the file's last modified time, size, and content hash when opened/saved. Before overwriting, compare again. If it changed, offer:

- Save a copy;
- Reload external version;
- Review both sources.

Do not implement an automatic merge in the first version.

### Required ink sidecar

Store persistent ink in `document-name.write2.json`. The sidecar contains a document fingerprint, schema version, block anchors, inline ink runs, and any unplaced recovery ink. Keep strokes out of the Markdown so an ordinary Markdown editor can still open a clean source file.

Where the browser can write both files in a chosen directory, save the Markdown and sidecar together. Otherwise:

- keep the live sidecar safely in IndexedDB;
- provide **Export project** as a package containing both files;
- provide **Export ink sidecar** as a separate download;
- show a clear “Ink saved in this app” status instead of implying it was written beside the Markdown file.

Opening a Markdown file should automatically reconnect the IndexedDB sidecar only when its stored fingerprint and filename match. If a matching external `.write2.json` file is supplied, validate its schema and fingerprint before attaching it.

## 9. Technical architecture

### Recommended stack

- TypeScript;
- React for application UI and block lifecycle;
- Vite for development/build tooling;
- a PWA manifest plus service worker for offline launch;
- Unified/Remark (`remark-parse`, `remark-gfm`) for a positional Markdown AST;
- DOM/CSS for the reading document and text layout;
- Canvas 2D only for live ink and gesture feedback;
- IndexedDB through a small, well-tested wrapper;
- Playwright for browser flows plus unit tests for source edits, reflow, and gesture state.

Do not render the whole document into a canvas. DOM text gives accessibility, selection, responsive layout, and good Markdown rendering. The canvas should be a local overlay owned by the one active block.

### Suggested modules

```text
src/
  app/                 routing, shell, error boundaries
  documents/           open, save, recovery, conflicts
  markdown/            parse, block projection, source-range edits
  reader/              rendered blocks, focus and navigation
  editor/              focused-block state machine and text layout
  ink/                 pointer capture, smoothing, strokes, runs, eraser
  reflow/              insertion anchor, text/ink placement, preview
  sidecar/             schema, anchors, remapping, import/export
  storage/             IndexedDB repositories and migrations
  pwa/                 manifest, service worker, update handling
  accessibility/       keyboard commands, announcements, focus helpers
  test-fixtures/        representative Markdown and recorded strokes
```

### Core state machine

```text
READING
  -> BLOCK_SELECTED
  -> EDITING_TEXT | EDITING_INK
  -> COMMITTING
  -> READING

Any editing state -> CANCELLING -> READING
Any state -> ERROR_RECOVERABLE -> previous safe state
```

Represent this explicitly. Avoid scattered booleans such as `isEditingInk`, `isEditingText`, and `isSaving` that can form impossible combinations.

### Ink representation

```ts
type InkPoint = {
  x: number;
  y: number;
  t: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
};

type InkStroke = {
  id: string;
  tool: "pen" | "eraser";
  points: InkPoint[];
  bounds: { x: number; y: number; width: number; height: number };
};

type InlineInkRun = {
  id: string;
  blockId: string;
  anchorOffset: number;
  contextBefore: string;
  contextAfter: string;
  strokes: InkStroke[];
  intrinsicWidth: number;
  intrinsicHeight: number;
  baselineOffset: number;
  scale: number;
};
```

Store points in workspace coordinates, not screen coordinates. Scale the canvas backing store by `devicePixelRatio`. Use Pointer Events, pointer capture, and feature-detected `getCoalescedEvents()` for smooth fast strokes. Map pressure through a gentle curve with a nonzero minimum width so devices reporting poor pressure still produce legible ink.

Render immediate segments during pointer movement and schedule cleanup/smoothing through `requestAnimationFrame`. Do not wait for React state updates to display the live stroke.

### Reflow engine

Use two separate concepts:

- **text reflow:** browser layout plus measured word boxes for precise caret/animation positions;
- **mixed-content reflow:** typed word boxes and inline ink-run boxes placed in one ordered flow.

Tokenize text only for placement; preserve inline Markdown marks in the source model. Treat each ink run as one atomic word-like box. When insertion space changes:

1. measure the available inline width after the anchor;
2. keep the largest whole-word prefix that fits;
3. move overflow to the next visual line;
4. repeat until all content is placed;
5. apply the same placement rule to subsequent ink-run boxes;
6. animate transforms during the gesture, then allow normal layout to settle on commit.

Never split a grapheme cluster. Very long unbreakable strings may overflow horizontally inside the editor rather than corrupting content.

## 10. Visual design direction

- Neutral paper background with one dark ink colour and one restrained accent colour.
- One readable UI sans-serif and one reading face; permit the user to choose sans/serif later.
- Body text starts around 18–20 CSS pixels on a narrow tablet, with line height 1.5–1.65.
- Reading measure is full available width minus 16–20 pixels per side on tiny screens; cap at approximately 720 pixels on larger screens.
- Minimum touch target is 44 by 44 CSS pixels, but visual icons may be smaller.
- Use borders and shadows sparingly. The active block can use a two-pixel accent edge rather than a card around every block.
- No blur effects in the primary workflow; they are expensive on lower-powered/e-ink hardware and weaken context.
- Provide light, dark, and high-contrast/e-ink themes. The e-ink theme avoids animation, grey-on-grey text, and unnecessary full-screen repaints.
- Honour `prefers-reduced-motion`. Add an explicit “Reduce e-ink refresh” setting that disables reflow animation while preserving immediate final placement.

## 11. Accessibility

- The rendered document remains semantic HTML with real headings, lists, links, quotes, and code.
- Every pen action has a keyboard/touch alternative.
- Focus is moved into the editor on open and restored to the same block on close.
- Status changes such as save failure, recovered draft, or unplaced ink use a polite live region.
- Do not disable browser zoom on the whole app. Apply restrictive `touch-action` only to the active ink canvas.
- Support 200% text scaling without clipping controls.
- Do not rely on colour alone for selection, saving, conflict, or errors.

## 12. Delivery phases

### Phase 0 — foundation and fixtures

- Create the TypeScript web app, test setup, linting, and PWA shell.
- Add Markdown fixtures covering every supported construct, Unicode, very long paragraphs, nested lists, malformed Markdown, and a 1 MB stress document.
- Add viewport presets for 320×568, 360×640, 412×915, and a landscape small tablet.
- Add a developer input panel showing detected pointer type, pressure, buttons, tilt, and event rate. Hide it in production.

**Exit:** app installs/launches offline, tests run, and the input diagnostic works on Android.

### Phase 1 — calm Markdown reader and reliable files

- Open/import a local Markdown file.
- Parse to positional blocks and render safe semantic HTML.
- Implement the compact/collapsing top bar.
- Add recent documents as metadata only; do not build a large library manager.
- Implement Save, Save As, download fallback, recovery snapshots, and conflict detection.

**Exit:** a user can open, read, close, recover, and save a Markdown file without formatting unrelated parts of it.

### Phase 2 — typed block editing

- Add block hit testing and the in-place focused workspace.
- Implement plain text/system-handwriting editing through a real textarea.
- Preserve or deliberately transform inline Markdown for the edited block.
- Implement block split, compatible merge, Cancel, Done, undo, and redo.
- Add source-range round-trip tests.

**Exit:** the full product loop works using Gboard/Samsung handwriting or a keyboard: open → tap block → edit → commit → save.

### Phase 3 — persistent inline handwriting

- Implement Pointer Event routing, capture, pressure, coalesced points, smoothing, and high-DPI rendering.
- Implement erasing, clear, undo, redo, and draft recovery.
- Group completed strokes into inline ink runs anchored at a caret.
- Render committed runs as inline SVG beside typed text.
- Implement the versioned sidecar, IndexedDB persistence, and project/sidecar export.
- Add lasso selection, move-to-caret, conservative scaling, and delete for an ink run.
- Implement palm-rejection heuristics and barrel/eraser buttons where reported.
- Test on at least two Android pen devices if possible, including the smallest target.

**Exit:** ink follows the pen without visible gaps, survives reload, appears alongside the correct Markdown text, and rotating/backgrounding the device does not lose it.

### Phase 4 — insertion space and live reflow

- Add caret placement and insertion handle.
- Add drag-to-open-space and automatic growth while writing.
- Reflow subsequent typed words and inline ink runs across ruled lines in real time.
- Add reduced-motion/e-ink behaviour.
- Stress test long paragraphs, large font size, RTL text, emoji, and long URLs.

**Exit:** opening and closing insertion space never changes text or stroke data, and insertion causes stable, reversible wrapping of typed text and ink runs.

### Phase 5 — mixed-content file hardening

- Remap sidecar anchors after Markdown changes using block identity, offsets, and surrounding text context.
- Add the visible Unplaced ink recovery area for ambiguous anchors.
- Validate sidecar schema migrations and corrupt/partial sidecars.
- Add paired Markdown/sidecar export and import tests.
- Add self-contained HTML export with typed text and inline SVG ink for easy sharing and printing.

**Exit:** Markdown and ink can be closed, moved to another device as a project, reopened, and recovered without misplacing or losing strokes.

### Phase 6 — hardening

- Accessibility audit and keyboard-only pass.
- Offline/update/migration tests.
- Large-document performance profiling and block virtualization if measurements require it.
- Crash recovery, storage quota, permission denial, and file-conflict testing.
- E-ink theme and repaint profiling.

**Exit:** all acceptance criteria below pass on desktop emulation and at least one real Android pen tablet.

## 13. Acceptance criteria

### Reading and small-screen UX

- At 320 CSS pixels wide, body text never requires horizontal scrolling except code/tables/long unbreakable strings.
- When idle in reading mode, no bottom toolbar or per-block controls are visible.
- Opening and closing a block preserves scroll position within 8 CSS pixels.
- At 200% text scaling, primary controls remain reachable and labels do not overlap.

### Pen behaviour

- A pen stroke becomes visible in the next animation frame under normal device load.
- Finger scrolling works when the pen tool is selected.
- Palm touches beginning during pen contact do not create ink.
- Pointer cancellation, app backgrounding, and orientation changes end the current stroke safely.
- A device reporting constant pressure still produces a usable consistent line.

### Markdown integrity

- Saving without an edit produces byte-for-byte identical Markdown.
- Editing one block leaves every byte outside its source range unchanged, except an explicitly tested boundary adjustment.
- YAML front matter and unsupported constructs survive unrelated edits unchanged.
- Reopening the saved file produces the same rendered document and no orphan draft.

### Reliability

- Force-closing after an edit recovers the latest local draft.
- Denying file permission does not lose the recovery copy.
- External file modification is detected before overwrite.
- The installed PWA can reopen a cached app shell and recovery draft with no network.

### Performance

- A representative 1 MB Markdown file becomes readable without freezing the main thread for a visibly long interval; set a measured budget after the first real-device baseline.
- Only the active block owns a live canvas.
- Scrolling does not trigger reparsing of Markdown or rerendering every block.
- Reflow work is limited to the active block and can be cancelled immediately.

## 14. Testing strategy

### Unit tests

- block source-range replacement;
- block ID remapping after edits;
- line/word reflow and reversal;
- Unicode grapheme handling;
- undo/redo command history;
- external-change comparison;
- sidecar schema validation and migration;
- ink-anchor remapping and ambiguous-anchor recovery;
- stroke bounds and coordinate transforms.

### Component/integration tests

- open, render, edit, save, reopen;
- Cancel restores exact source;
- recovery after simulated termination;
- keyboard focus restoration;
- pointer pen/touch routing with synthetic Pointer Events;
- mixed typed/ink wrapping and sidecar reopen;
- paired project import/export;
- permission-denied and download fallback paths.

### Real-device test script

For each target device/browser, record:

- viewport and device pixel ratio;
- pen `pointerType`, pressure range, tilt, eraser, barrel button, and hover;
- whether coalesced events are available;
- palm rejection outcome;
- perceived ink latency;
- system handwriting keyboard behaviour in the textarea;
- file open/save/permission behaviour;
- offline install and relaunch;
- portrait/landscape transitions;
- e-ink ghosting or excessive refresh.

Do not approve a gesture from emulator testing alone.

## 15. Explicit non-goals for the first release

- cloud accounts, sync, or collaboration;
- a notebook/folder management system;
- PDF import or annotation;
- freeform full-page drawing;
- persistent margin drawers;
- bookmarks, clippings, hyperlinks drawn in ink, or split view;
- image editing;
- rich table editing;
- handwriting recognition or conversion to typed text;
- training or integrating a handwriting model;
- exact visual imitation of Stylus Labs Write;
- native Android packaging before the PWA interaction is validated.

These can be considered only after the core block-editing loop feels excellent on a six-inch device.

## 16. Build order for the implementing AI

The implementing AI should build one thin vertical slice before expanding features:

1. Open one Markdown file.
2. Render its semantic blocks in the minimal reader.
3. Tap one paragraph and expand it in place.
4. Add handwriting at a caret and keep it visibly handwritten.
5. Commit it as an inline ink run in the sidecar.
6. Render the run beside typed text after closing and reopening the block.
7. Save/export and reopen the Markdown plus ink project.
8. Add recovery and tests for that loop.
9. Add typed editing through a real textarea without disturbing ink anchors.
10. Only after mixed content is stable add live insertion-space reflow.

At the end of each phase, provide a testable Android URL/build and a short checklist tied to the phase's exit criteria. Do not begin library management, marginalia, sketch mode, or visual polish while any part of the core loop can still lose or corrupt text.

## 17. Decisions to validate with the owner after the first vertical slice

These questions should be answered by using the prototype, not by delaying the initial build:

- Should a finger tap edit immediately or require selection then a second tap?
- Is three or four writing lines the better default on the smallest device?
- Should the active block expand in place or pin beneath the top bar on very small screens?
- Is drag-to-open-space necessary once automatic reflow while writing works?
- Should a newly written stroke group become an inline run after a short pause, after the pen leaves its bounding area, or only when Done is pressed?
- Should adjacent ink runs automatically combine when written on the same baseline?
- Is a paired `.md` + `.write2.json` workflow sufficient, or is a single packaged project format also needed as the primary open/save format?
- Much later, should recognition replace ink, duplicate it as searchable text, or remain entirely optional?

The first prototype should expose these as small configuration flags so real-device testing can compare them without redesigning the architecture.
