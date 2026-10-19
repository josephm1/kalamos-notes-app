// Vanilla shell — mirrors a slice of src/app/App.tsx: open a document, render
// it with PaginatedReader, open the focused PenWorkspace on a block, commit
// edits back through the same pure commit.ts used by the React app, and
// autosave through the DocStore seam. React remains the feature-complete
// reference.
//
// The module is a factory (`createApp`) so the same shell runs in two
// chromes: "browser" (vanilla.html — welcome screen, Open/Save buttons,
// IndexedDB recovery via browserStore) and "kalamos" (the Bigme device build
// — the Kalamos library is the landing surface, storage is the native
// bridge, saving is implicit).

import "./eink.css";
import { parseMarkdown, type Block } from "../markdown/parse";
import { PaginatedReader } from "./paginatedReader";
import { PenWorkspace, type Tool, type HwrClient, type WorkspacePageTools } from "./penWorkspace";
import type { CommitPayload } from "../editor/PenWorkspace";
import { commitBlockEdit } from "../app/commit";
import { History } from "../app/history";
import {
  openMarkdown,
  downloadText,
  saveToHandle,
  supportsSaveHandle,
  type OpenedDocument,
} from "../documents/files";
import type { DocStore } from "../documents/store";
import { createEmptySidecar, type Sidecar } from "../sidecar/schema";
import { fingerprintOf } from "../documents/fingerprint";
import type { InlineInkRun } from "../ink/types";
import { DEFAULT_PREFERENCES, type Preferences } from "../storage/preferences";
import { SAMPLE_DOC } from "../test-fixtures/sample";

type DocState = {
  doc: OpenedDocument;
  blocks: Block[];
  sidecar: Sidecar;
  dirty: boolean;
};
type HistorySnap = { source: string; sidecar: Sidecar };

export type AppChrome = "browser" | "kalamos";

/** Device-mode hooks connecting the pen workspace to the native ink daemon
 * (implemented by src/kalamos/native.ts; absent in the browser). */
export type WorkspaceNativeHooks = {
  native: boolean;
  onWorkspaceOpen?: (ws: PenWorkspace) => void;
  onWorkspaceClose?: () => void;
  onWorkspaceLayout?: () => void;
  onWorkspaceContentRegion?: (rect: {l:number;t:number;r:number;b:number}) => void;
  onWorkspaceTool?: (tool: Tool, keyboard: boolean) => void;
  onWorkspaceOverlay?: (rect: { l: number; t: number; r: number; b: number } | null) => void;
  onWorkspaceMagnifyTargeting?: (active: boolean) => void;
  onWorkspaceMagnifyErasing?: (active: boolean) => void;
  onWorkspaceToolbarDrag?: (active: boolean) => void;
  onWorkspacePageGesture?: (active: boolean) => void;
  onWorkspaceDialog?: (active: boolean) => void;
  onWorkspaceToolbarLayout?: (
    previous: { l: number; t: number; r: number; b: number },
    current: { l: number; t: number; r: number; b: number }
  ) => void;
  /** Apply the ruled workspace's selected colour/width to live native ink. */
  onWorkspaceInkStyle?: (color: string, widthCss: number) => void;
  beforeWorkspaceAction?: (action: () => void) => void;
};

export type CreateAppOptions = {
  notebookToolbar?: boolean;
  documentAction?: {label:string;shortLabel?:string;run:()=>void};
  documentActions?: {label:string;shortLabel?:string;onPress?:()=>boolean;run:()=>void}[];
  pageTools?: WorkspacePageTools;
  store: DocStore;
  chrome: AppChrome;
  /** Kalamos chrome: called after save when the user leaves the document. */
  onExit?: () => void;
  /** Kalamos chrome: adds an AI button to the top bar when provided. */
  onAiOpen?: () => void;
  nativeHooks?: WorkspaceNativeHooks;
  hwr?: HwrClient;
  /** Open the document's first block straight into the ruled pen workspace.
   * Used by notebook-style hosts that want Write's editor without its
   * Markdown reader/file UI. */
  directWorkspace?: boolean;
};

export type VanillaApp = {
  openDocument(opened: OpenedDocument): Promise<void>;
  openSample(): Promise<void>;
  /** True while the focused pen workspace modal is open. */
  isEditing(): boolean;
  /** Close the workspace if open (cancel, no commit). Returns true if closed. */
  closeWorkspace(): boolean;
  /** Commit the open workspace as if Done was pressed. */
  finishWorkspace(): boolean;
  /** Flush, commit, and persist the open workspace without leaving it. */
  checkpointWorkspace(): Promise<void>;
  /** Reader page turn for hardware page keys. */
  pageBy(dir: -1 | 1): void;
  /** Flush the debounced persist immediately. */
  saveNow(): Promise<void>;
  /** Current markdown source (null when no document is open). */
  getSource(): string | null;
  /** Deterministic final-size preview of the currently open ruled workspace. */
  renderWorkspaceThumbnail(): string | null;
  /**
   * Replace the document source from outside the pen workspace (AI revise).
   * Goes through the same history/persist path as a pen commit, so undo works.
   */
  applyExternalSource(newSource: string): boolean;
  destroy(): void;
};

export function createApp(host: HTMLElement, opts: CreateAppOptions): VanillaApp {
  const { store, chrome } = opts;
  host.classList.add("vanilla-app");
  host.classList.toggle("direct-workspace", !!opts.directWorkspace);

  let prefs: Preferences = DEFAULT_PREFERENCES;
  let docState: DocState | null = null;
  let selectedId: string | null = null;
  let reader: PaginatedReader | null = null;
  let workspace: PenWorkspace | null = null;
  let workspaceBackdrop: HTMLElement | null = null;
  const history = new History<HistorySnap>();

  const topBar = document.createElement("div");
  topBar.className = "v-top-bar";
  const filenameEl = document.createElement("span");
  filenameEl.className = "v-filename";
  filenameEl.textContent = "Kalamos Write — e-ink preview";
  if (chrome === "browser") {
    const openBtn = document.createElement("button");
    openBtn.textContent = "Open a Markdown file";
    openBtn.addEventListener("click", () => void handleOpenFile());
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", () => void handleSave());
    topBar.append(filenameEl, openBtn, saveBtn);
  } else {
    const backBtn = document.createElement("button");
    backBtn.className = "v-back";
    backBtn.textContent = "◀ Library";
    backBtn.addEventListener("click", () => void exitToLibrary());
    topBar.append(backBtn, filenameEl);
    if (opts.onAiOpen) {
      const aiBtn = document.createElement("button");
      aiBtn.className = "v-ai";
      aiBtn.textContent = "AI";
      aiBtn.setAttribute("aria-label", "AI assistant");
      aiBtn.addEventListener("click", () => opts.onAiOpen!());
      topBar.append(aiBtn);
    }
  }

  const contentHost = document.createElement("div");
  host.append(topBar, contentHost);

  function docIdOf(name: string): string {
    return `doc:${name}`;
  }

  async function attachDocument(opened: OpenedDocument) {
    let sidecar = await store.loadSidecar(opened.docId);
    if (!sidecar || sidecar.documentFingerprint !== opened.fingerprint.hash) {
      // Keep ink when the document text changed underneath us; only a
      // browser-side name mismatch (a different file reusing the id) drops it.
      const sameDoc =
        sidecar && (chrome === "kalamos" || sidecar.documentName === opened.name);
      sidecar = sameDoc
        ? { ...sidecar!, documentFingerprint: opened.fingerprint.hash }
        : createEmptySidecar(opened.name, opened.fingerprint.hash);
    }

    const rec = await store.loadRecovery(opened.docId);
    let source = opened.source;
    if (rec && rec.dirty && rec.source !== opened.source) {
      // First vanilla milestone keeps this simple: prefer the recovered draft
      // silently rather than porting the recovery-banner UI yet.
      source = rec.source;
    }

    history.clear();
    let blocks = parseMarkdown(source);
    // A notebook canvas still needs one stable block anchor. A zero-width
    // paragraph is visually blank but round-trips through the normal Write
    // commit/sidecar model, including handwriting-to-text conversion.
    if (opts.directWorkspace && blocks.length === 0) {
      source = "\u200b";
      blocks = parseMarkdown(source);
    }
    if (opts.directWorkspace) {
      blocks = [{ id: "planning-document", type: "paragraph", sourceStart: 0, sourceEnd: source.length, source, text: source }];
      sidecar = { ...sidecar, inkRuns: sidecar.inkRuns.map(r=>({ ...r, blockId: "planning-document" })), textBoxes: sidecar.textBoxes?.map(b=>({ ...b, blockId: "planning-document" })) };
    }
    docState = {
      doc: { ...opened, source },
      blocks,
      sidecar,
      dirty: false,
    };
    selectedId = null;
    renderReading();
    if (opts.directWorkspace && blocks[0]) openEditor(blocks[0]);
  }

  async function handleOpenFile() {
    const opened = await openMarkdown();
    if (opened) await attachDocument(opened);
  }

  async function openSample() {
    await attachDocument({
      docId: docIdOf("sample.md"),
      name: "sample.md",
      source: SAMPLE_DOC,
      fingerprint: fingerprintOf(SAMPLE_DOC),
      handle: null,
    });
  }

  let autosaveTimer: number | undefined;
  function schedulePersist(next: DocState) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => void persistNow(next).catch(error => console.warn("[notes-save] autosave failed", error)), 800);
  }

  function persistNow(state: DocState): Promise<void> {
    window.clearTimeout(autosaveTimer);
    return store.persist({
      docId: state.doc.docId,
      documentName: state.doc.name,
      source: state.doc.source,
      sidecar: state.sidecar,
      dirty: state.dirty,
    });
  }

  async function handleSave() {
    if (!docState) return;
    const { doc } = docState;
    if (doc.handle && supportsSaveHandle()) {
      const res = await saveToHandle(doc.handle, doc.source, doc.fingerprint, {});
      if (res.ok) {
        docState = { ...docState, doc: { ...doc, fingerprint: res.fingerprint }, dirty: false };
      }
    } else {
      downloadText(doc.source, doc.name);
      docState = { ...docState, dirty: false };
    }
  }

  async function exitToLibrary() {
    closeWorkspace();
    if (docState) await persistNow(docState);
    opts.onExit?.();
  }

  function runsByBlock(sidecar: Sidecar): Map<string, InlineInkRun[]> {
    const map = new Map<string, InlineInkRun[]>();
    for (const r of sidecar.inkRuns) {
      const arr = map.get(r.blockId) ?? [];
      arr.push(r);
      map.set(r.blockId, arr);
    }
    return map;
  }

  function handleSelect(blockId: string) {
    if (!docState) return;
    if (prefs.fingerTapEdits || selectedId === blockId) {
      handleOpenBlock(blockId);
      return;
    }
    selectedId = blockId;
    renderReading();
  }

  function handleOpenBlock(blockId: string) {
    if (!docState) return;
    const block = docState.blocks.find((b) => b.id === blockId);
    if (!block) return;
    openEditor(block);
  }

  function openEditor(block: Block) {
    if (!docState) return;
    const backdrop = document.createElement("div");
    backdrop.className = "v-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = opts.directWorkspace ? "v-modal toolbar-mode-collapsed" : "v-modal";
    const header = document.createElement("div");
    header.className = "v-modal-header";
    const title = document.createElement("span");
    title.className = "v-modal-title";
    title.textContent = opts.directWorkspace ? docState.doc.name : `Editing ${block.type}`;
    const closeBtn = document.createElement("button");
    const backIcon = window.KalamosToolbarIcons?.svg("prev");
    if (opts.directWorkspace && backIcon) closeBtn.innerHTML = backIcon;
    else closeBtn.textContent = opts.directWorkspace ? "‹" : "✕";
    closeBtn.setAttribute("aria-label", "Close editor");
    closeBtn.addEventListener("click", () => {
      if (opts.directWorkspace && workspace) workspace.finish();
      else handleCancel();
    });
    if (opts.directWorkspace) header.append(closeBtn, title);
    else header.append(title, closeBtn);
    const body = document.createElement("div");
    modal.append(header, body);
    backdrop.appendChild(modal);
    host.appendChild(backdrop);
    workspaceBackdrop = backdrop;

    const hooks = opts.nativeHooks;
    const runs = runsByBlock(docState.sidecar).get(block.id) ?? [];
    workspace = new PenWorkspace(body, {
      pageTools: opts.pageTools,
      notebookToolbar: opts.notebookToolbar,
      documentAction:opts.documentAction,
      documentActions:opts.documentActions,
      block,
      existingRuns: runs,
      existingLineHeight: opts.directWorkspace ? docState.sidecar.layoutLineHeight : undefined,
      existingSourceWords: opts.directWorkspace ? docState.sidecar.sourceWords : undefined,
      existingPageObjects: docState.sidecar.pageObjects?.filter(o => !o.blockId || o.blockId === block.id),
      existingTextBoxes: docState.sidecar.textBoxes?.filter((b) => b.blockId === block.id),
      prefs,
      eink: true,
      native: hooks?.native ?? false,
      onLayoutChanged: hooks?.onWorkspaceLayout,
      onContentRegionChange: hooks?.onWorkspaceContentRegion,
      onToolChange: hooks?.onWorkspaceTool,
      onBeforeNativeAction: hooks?.beforeWorkspaceAction,
      hwr: opts.hwr,
      onOverlayChange: hooks?.onWorkspaceOverlay,
      onMagnifyTargeting: hooks?.onWorkspaceMagnifyTargeting,
      onMagnifyErasing: hooks?.onWorkspaceMagnifyErasing,
      onToolbarDragChange: hooks?.onWorkspaceToolbarDrag,
      onPageGestureChange: hooks?.onWorkspacePageGesture,
      onDialogChange: hooks?.onWorkspaceDialog,
      onToolbarLayoutChange: hooks?.onWorkspaceToolbarLayout,
      onInkStyleChange: hooks?.onWorkspaceInkStyle,
      onPreferencesChange: (next) => {
        prefs = next;
        void store.savePreferences(next);
      },
      onToolbarModeChange: (mode) => {
        modal.classList.remove(
          "toolbar-mode-collapsed",
          "toolbar-mode-compact",
          "toolbar-mode-full"
        );
        modal.classList.add(`toolbar-mode-${mode}`);
      },
      showSessionActions: !opts.directWorkspace,
      onCommit: (payload, intent) => {
        handleCommit(block, payload);
        if (intent === "checkpoint") {
          return docState ? persistNow(docState) : Promise.resolve();
        }
        if (opts.directWorkspace && docState) {
          // Keep the workspace DOM and native paper alive until the host has
          // hidden its floating toolbar and captured the clean page preview.
          const committed = docState;
          void persistNow(committed).then(
            () => opts.onExit?.(),
            error => { console.warn("[notes-save] exit save failed", error); window.alert("Notebook could not be saved. Your page is still open; please try again."); }
          );
          return;
        }
        hooks?.onWorkspaceClose?.();
        backdrop.remove();
        workspace?.destroy();
        workspace = null;
        workspaceBackdrop = null;
      },
      onCancel: handleCancel,
    });
    hooks?.onWorkspaceOpen?.(workspace);

    function handleCancel() {
      hooks?.onWorkspaceClose?.();
      backdrop.remove();
      workspace?.destroy();
      workspace = null;
      workspaceBackdrop = null;
      if (opts.directWorkspace) opts.onExit?.();
    }
  }

  function closeWorkspace(): boolean {
    if (!workspace) return false;
    opts.nativeHooks?.onWorkspaceClose?.();
    workspaceBackdrop?.remove();
    workspace.destroy();
    workspace = null;
    workspaceBackdrop = null;
    return true;
  }

  function finishWorkspace(): boolean {
    if (!workspace) return false;
    workspace.finish();
    return true;
  }

  function handleCommit(block: Block, payload: CommitPayload) {
    if (!docState) return;
    const before: HistorySnap = { source: docState.doc.source, sidecar: docState.sidecar };
    const out = opts.directWorkspace ? {
      source: payload.newSource,
      blocks: [{ ...block, sourceEnd: payload.newSource.length, source: payload.newSource, text: payload.newSource }],
      sidecar: { ...docState.sidecar, documentFingerprint: fingerprintOf(payload.newSource).hash, updatedAt: Date.now(), inkRuns: payload.newRuns, textBoxes: payload.textBoxes, pageObjects: payload.pageObjects, sourceWords: payload.sourceWords, layoutLineHeight: payload.layoutLineHeight },
    } : commitBlockEdit({
      source: docState.doc.source,
      blocks: docState.blocks,
      sidecar: docState.sidecar,
      editedBlock: block,
      newBlockSource: payload.newSource,
      newRuns: payload.newRuns,
      textBoxes: payload.textBoxes,
      pageObjects: payload.pageObjects,
    });
    const after: HistorySnap = { source: out.source, sidecar: out.sidecar };
    history.push({ label: "edit block", before, after });
    docState = {
      ...docState,
      doc: { ...docState.doc, source: out.source },
      blocks: out.blocks,
      sidecar: out.sidecar,
      dirty: true,
    };
    schedulePersist(docState);
    selectedId = null;
    renderReading();
  }

  function applySnapshot(snap: HistorySnap) {
    if (!docState) return;
    docState = {
      ...docState,
      doc: { ...docState.doc, source: snap.source },
      blocks: parseMarkdown(snap.source),
      sidecar: snap.sidecar,
      dirty: true,
    };
    schedulePersist(docState);
    renderReading();
  }

  const onKeydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      const snap = history.undo();
      if (snap) applySnapshot(snap);
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      const snap = history.redo();
      if (snap) applySnapshot(snap);
    }
  };
  window.addEventListener("keydown", onKeydown);

  function renderReading() {
    contentHost.innerHTML = "";
    if (!docState) {
      if (chrome === "browser") renderWelcome();
      return;
    }
    filenameEl.textContent = docState.doc.name;
    if (opts.directWorkspace) {
      reader?.destroy();
      reader = null;
      return;
    }
    const readerRoot = document.createElement("div");
    contentHost.appendChild(readerRoot);
    reader?.destroy();
    reader = new PaginatedReader(readerRoot, {
      blocks: docState.blocks,
      runsByBlock: runsByBlock(docState.sidecar),
      selectedId,
      onSelect: handleSelect,
      onOpen: handleOpenBlock,
    });
  }

  function renderWelcome() {
    const wrap = document.createElement("div");
    wrap.className = "v-welcome";
    const h1 = document.createElement("h1");
    h1.textContent = "Kalamos Write";
    const p = document.createElement("p");
    p.textContent = "Vanilla-JS / e-ink preview shell. React remains the feature-complete reference.";
    const actions = document.createElement("div");
    actions.className = "v-actions";
    const openFileBtn = document.createElement("button");
    openFileBtn.textContent = "Open a Markdown file";
    openFileBtn.addEventListener("click", () => void handleOpenFile());
    const sampleBtn = document.createElement("button");
    sampleBtn.textContent = "Try the sample document";
    sampleBtn.addEventListener("click", () => void openSample());
    actions.append(openFileBtn, sampleBtn);
    wrap.append(h1, p, actions);
    contentHost.appendChild(wrap);
  }

  async function boot() {
    prefs = await store.loadPreferences();
    renderReading();
  }
  void boot();

  let checkpointPending:Promise<void>|null=null;
  return {
    openDocument: attachDocument,
    openSample,
    isEditing: () => workspace !== null,
    closeWorkspace,
    finishWorkspace,
    checkpointWorkspace: () => {
      if(checkpointPending)return checkpointPending;
      const task=workspace?workspace.checkpoint():docState?persistNow(docState):Promise.resolve();
      checkpointPending=task;
      void task.finally(()=>{if(checkpointPending===task)checkpointPending=null;}).catch(()=>{});
      return task;
    },
    pageBy: (dir) => reader?.pageBy(dir),
    saveNow: async () => {
      if (docState) await persistNow(docState);
    },
    getSource: () => docState?.doc.source ?? null,
    renderWorkspaceThumbnail: () => workspace?.renderThumbnailDataUrl() ?? null,
    applyExternalSource(newSource: string): boolean {
      if (!docState || newSource === docState.doc.source) return false;
      const before: HistorySnap = { source: docState.doc.source, sidecar: docState.sidecar };
      const after: HistorySnap = { source: newSource, sidecar: docState.sidecar };
      history.push({ label: "ai edit", before, after });
      docState = {
        ...docState,
        doc: { ...docState.doc, source: newSource },
        blocks: parseMarkdown(newSource),
        dirty: true,
      };
      schedulePersist(docState);
      selectedId = null;
      renderReading();
      return true;
    },
    destroy() {
      window.removeEventListener("keydown", onKeydown);
      window.clearTimeout(autosaveTimer);
      closeWorkspace();
      reader?.destroy();
      reader = null;
      docState = null;
      host.innerHTML = "";
      host.classList.remove("vanilla-app", "direct-workspace");
    },
  };
}
