import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { parseMarkdown, type Block } from "../markdown/parse";
import { PaginatedReader } from "../reader/PaginatedReader";
import { PenWorkspace, type CommitPayload } from "../editor/PenWorkspace";
import { TopBar, type SaveStatus } from "./TopBar";
import { InputDiagnostics } from "./InputDiagnostics";
import { OverflowSheet } from "./OverflowSheet";
import {
  reduce,
  initialState,
  activeBlockId,
  type MachineState,
  type MachineEvent,
} from "./machine";
import { commitBlockEdit } from "./commit";
import { History } from "./history";
import {
  openMarkdown,
  saveToHandle,
  saveWithPicker,
  downloadText,
  supportsSaveHandle,
  type OpenedDocument,
} from "../documents/files";
import { fingerprintOf, type FileFingerprint } from "../documents/fingerprint";
import { createEmptySidecar, type Sidecar } from "../sidecar/schema";
import { exportHtml, exportProject, exportSidecar } from "../sidecar/export";
import {
  DEFAULT_PREFERENCES,
  deleteRecovery,
  loadPreferences,
  loadRecovery,
  loadSidecar,
  recordRecentFile,
  savePreferences,
  saveRecovery,
  saveSidecar,
  type Preferences,
} from "../storage/db";
import { WelcomeScreen } from "./WelcomeScreen";

type DocState = {
  doc: OpenedDocument;
  blocks: Block[];
  sidecar: Sidecar;
  fingerprint: FileFingerprint;
  dirty: boolean;
};

type HistorySnap = { source: string; sidecar: Sidecar; fingerprint: FileFingerprint };

export function App() {
  const [state, dispatch] = useReducer(
    (s: MachineState, e: MachineEvent) => reduce(s, e),
    initialState
  );
  const [docState, setDocState] = useState<DocState | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [recovered, setRecovered] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = useRef(new History<HistorySnap>());
  const autosaveTimer = useRef<number | undefined>(undefined);
  const focusReturn = useRef<string | null>(null);

  // Load preferences + apply theme.
  useEffect(() => {
    loadPreferences().then(setPrefs);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
    if (prefs.reduceEinkRefresh) document.documentElement.dataset.reduceMotion = "true";
    else delete document.documentElement.dataset.reduceMotion;
  }, [prefs.theme, prefs.reduceEinkRefresh]);

  // Offline status flag.
  useEffect(() => {
    const update = () => {
      if (!navigator.onLine) setStatus("offline");
    };
    window.addEventListener("offline", update);
    window.addEventListener("online", () => setStatus("idle"));
    return () => window.removeEventListener("offline", update);
  }, []);

  const transientStatus = useCallback((s: SaveStatus, ms = 1800) => {
    setStatus(s);
    window.setTimeout(() => setStatus((cur) => (cur === s ? "idle" : cur)), ms);
  }, []);

  const scheduleRecovery = useCallback(
    (next: DocState) => {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = window.setTimeout(() => {
        void saveRecovery({
          docId: next.doc.docId,
          documentName: next.doc.name,
          source: next.doc.source,
          savedFingerprint: next.fingerprint,
          dirty: next.dirty,
          updatedAt: Date.now(),
        });
        void saveSidecar(next.doc.docId, next.sidecar);
      }, 800);
    },
    []
  );

  // Autosave recovery on backgrounding too.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && docState) {
        void saveRecovery({
          docId: docState.doc.docId,
          documentName: docState.doc.name,
          source: docState.doc.source,
          savedFingerprint: docState.fingerprint,
          dirty: docState.dirty,
          updatedAt: Date.now(),
        });
        void saveSidecar(docState.doc.docId, docState.sidecar);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [docState]);

  const attachDocument = useCallback(
    async (opened: OpenedDocument) => {
      // Reconnect sidecar from IndexedDB when fingerprint + name match.
      let sidecar: Sidecar | undefined = await loadSidecar(opened.docId);
      if (
        !sidecar ||
        sidecar.documentName !== opened.name ||
        sidecar.documentFingerprint !== opened.fingerprint.hash
      ) {
        if (sidecar && sidecar.documentName === opened.name) {
          // Same file name but content changed since ink was stored: keep ink
          // but refresh fingerprint; remap will run on next edit.
          sidecar = { ...sidecar, documentFingerprint: opened.fingerprint.hash };
        } else {
          sidecar = createEmptySidecar(opened.name, opened.fingerprint.hash);
        }
      }

      // Offer recovered draft if newer than the confirmed save.
      const rec = await loadRecovery(opened.docId);
      const source = opened.source;
      if (rec && rec.dirty && rec.source !== opened.source) {
        setRecovered(rec.source);
      }

      history.current.clear();
      const next: DocState = {
        doc: { ...opened, source },
        blocks: parseMarkdown(source),
        sidecar,
        fingerprint: opened.fingerprint,
        dirty: false,
      };
      setDocState(next);
      setSelectedId(null);
      dispatch({ type: "DESELECT" });
      void recordRecentFile({
        docId: opened.docId,
        documentName: opened.name,
        lastOpened: Date.now(),
        fingerprint: opened.fingerprint,
      });
    },
    []
  );

  const handleOpen = useCallback(async () => {
    try {
      const opened = await openMarkdown();
      if (opened) await attachDocument(opened);
    } catch (err) {
      transientStatus("error");
      dispatch({ type: "ERROR", message: (err as Error).message });
    }
  }, [attachDocument, transientStatus]);

  const applySnapshot = useCallback(
    (snap: HistorySnap) => {
      setDocState((cur) =>
        cur
          ? {
              ...cur,
              doc: { ...cur.doc, source: snap.source },
              blocks: parseMarkdown(snap.source),
              sidecar: snap.sidecar,
              dirty: true,
            }
          : cur
      );
    },
    []
  );

  const doUndo = useCallback(() => {
    const snap = history.current.undo();
    if (snap) applySnapshot(snap);
  }, [applySnapshot]);
  const doRedo = useCallback(() => {
    const snap = history.current.redo();
    if (snap) applySnapshot(snap);
  }, [applySnapshot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const activeId = activeBlockId(state);

  const handleSelect = useCallback(
    (blockId: string) => {
      if (prefs.fingerTapEdits) {
        focusReturn.current = blockId;
        dispatch({ type: "OPEN_EDIT", blockId, mode: "ink" });
        return;
      }
      // Select-then-second-tap to open (§5.2).
      if (selectedId === blockId) {
        focusReturn.current = blockId;
        dispatch({ type: "OPEN_EDIT", blockId, mode: "ink" });
      } else {
        setSelectedId(blockId);
        dispatch({ type: "SELECT_BLOCK", blockId });
      }
    },
    [prefs.fingerTapEdits, selectedId]
  );

  const handleOpenBlock = useCallback((blockId: string) => {
    focusReturn.current = blockId;
    dispatch({ type: "OPEN_EDIT", blockId, mode: "ink" });
  }, []);

  const handleCommit = useCallback(
    (block: Block, payload: CommitPayload) => {
      setDocState((cur) => {
        if (!cur) return cur;
        dispatch({ type: "COMMIT" });
        const before: HistorySnap = {
          source: cur.doc.source,
          sidecar: cur.sidecar,
          fingerprint: cur.fingerprint,
        };
        const out = commitBlockEdit({
          source: cur.doc.source,
          blocks: cur.blocks,
          sidecar: cur.sidecar,
          editedBlock: block,
          newBlockSource: payload.newSource,
          newRuns: payload.newRuns,
        });
        const after: HistorySnap = {
          source: out.source,
          sidecar: out.sidecar,
          fingerprint: cur.fingerprint,
        };
        history.current.push({ label: "edit block", before, after });
        const next: DocState = {
          ...cur,
          doc: { ...cur.doc, source: out.source },
          blocks: out.blocks,
          sidecar: out.sidecar,
          dirty: true,
        };
        scheduleRecovery(next);
        return next;
      });
      dispatch({ type: "COMMIT_DONE" });
      setSelectedId(null);
      // Restore focus to the block on close.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(
          `[data-block-id="${focusReturn.current}"]`
        );
        el?.focus();
      });
      if (!supportsSaveHandle() || !docState?.doc.handle) {
        if (payload.newRuns.length) transientStatus("ink-local", 2400);
      }
    },
    [scheduleRecovery, transientStatus, docState]
  );

  const handleCancel = useCallback(() => {
    dispatch({ type: "CANCEL" });
    dispatch({ type: "CANCEL_DONE" });
    setSelectedId(null);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-block-id="${focusReturn.current}"]`)
        ?.focus();
    });
  }, []);

  const handleSave = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!docState) return;
      setStatus("saving");
      const { doc, fingerprint } = docState;
      if (doc.handle && supportsSaveHandle()) {
        const res = await saveToHandle(doc.handle, doc.source, fingerprint, { force });
        if (res.ok) {
          const fp = res.fingerprint;
          setDocState((cur) => (cur ? { ...cur, fingerprint: fp, dirty: false } : cur));
          void deleteRecovery(doc.docId);
          transientStatus("saved");
        } else if (res.reason === "conflict") {
          setStatus("conflict");
        } else {
          transientStatus("error");
        }
      } else {
        // Fallback: download the Markdown; ink stays in-app.
        downloadText(doc.source, doc.name);
        setDocState((cur) => (cur ? { ...cur, dirty: false } : cur));
        transientStatus(docState.sidecar.inkRuns.length ? "ink-local" : "saved", 2400);
      }
    },
    [docState, transientStatus]
  );

  const handleSaveAs = useCallback(async () => {
    if (!docState) return;
    if (supportsSaveHandle()) {
      try {
        const res = await saveWithPicker(docState.doc.source, docState.doc.name);
        if (res) {
          setDocState((cur) =>
            cur
              ? {
                  ...cur,
                  doc: { ...cur.doc, handle: res.handle },
                  fingerprint: res.fingerprint,
                  dirty: false,
                }
              : cur
          );
          transientStatus("saved");
        }
      } catch {
        /* cancelled */
      }
    } else {
      downloadText(docState.doc.source, docState.doc.name);
      transientStatus("saved", 2400);
    }
  }, [docState, transientStatus]);

  const updatePrefs = useCallback((patch: Partial<Preferences>) => {
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      void savePreferences(next);
      return next;
    });
  }, []);

  const acceptRecovered = useCallback(() => {
    if (recovered == null) return;
    setDocState((cur) =>
      cur
        ? {
            ...cur,
            doc: { ...cur.doc, source: recovered },
            blocks: parseMarkdown(recovered),
            dirty: true,
          }
        : cur
    );
    setRecovered(null);
  }, [recovered]);

  const blocks = docState?.blocks ?? [];
  const runsByBlock = useMemo(() => {
    const map = new Map<string, Sidecar["inkRuns"]>();
    for (const r of docState?.sidecar.inkRuns ?? []) {
      const arr = map.get(r.blockId) ?? [];
      arr.push(r);
      map.set(r.blockId, arr);
    }
    return map;
  }, [docState?.sidecar.inkRuns]);

  if (!docState) {
    return (
      <div className="app">
        <TopBar
          filename={null}
          status={status}
          onOpen={handleOpen}
          onOverflow={() => setOverflowOpen(true)}
        />
        <WelcomeScreen onOpen={handleOpen} onOpenRecent={attachDocument} />
        <InputDiagnostics />
      </div>
    );
  }

  return (
    <div className={`app${state.name === "EDITING" ? " editing" : ""}`}>
      <TopBar
        filename={docState.doc.name}
        status={status}
        onOpen={handleOpen}
        onOverflow={() => setOverflowOpen(true)}
      />

      {recovered != null && (
        <div className="recovery-banner" role="status" aria-live="polite">
          <span>A newer recovered draft is available.</span>
          <button onClick={acceptRecovered}>Use recovered draft</button>
          <button onClick={() => setRecovered(null)}>Keep saved file</button>
        </div>
      )}

      {docState.sidecar.unplacedInk.length > 0 && (
        <div className="unplaced-ink" role="status" aria-live="polite">
          {docState.sidecar.unplacedInk.length} handwritten note(s) could not be
          re-anchored and are kept here.
        </div>
      )}

      <PaginatedReader
        blocks={blocks}
        runsByBlock={runsByBlock}
        selectedId={selectedId}
        eink={prefs.theme === "eink"}
        onSelect={handleSelect}
        onOpen={handleOpenBlock}
      />

      {state.name === "EDITING" &&
        activeId &&
        (() => {
          const block = blocks.find((b) => b.id === activeId);
          if (!block) return null;
          return (
            <div className={`editor-modal-backdrop${prefs.theme === "eink" ? " eink" : ""}`}>
              <div className="editor-modal" role="dialog" aria-modal="true" aria-label="Edit section">
                <div className="editor-modal-header">
                  <span className="editor-modal-title">Editing {block.type}</span>
                  <button className="icon-btn" onClick={handleCancel} aria-label="Close editor">
                    ✕
                  </button>
                </div>
                <PenWorkspace
                  block={block}
                  existingRuns={runsByBlock.get(block.id) ?? []}
                  prefs={prefs}
                  eink={prefs.theme === "eink"}
                  onCommit={(payload) => handleCommit(block, payload)}
                  onCancel={handleCancel}
                />
              </div>
            </div>
          );
        })()}

      {overflowOpen && (
        <OverflowSheet
          prefs={prefs}
          dirty={docState.dirty}
          canUndo={history.current.canUndo()}
          canRedo={history.current.canRedo()}
          onUpdatePrefs={updatePrefs}
          onClose={() => setOverflowOpen(false)}
          onSave={() => handleSave()}
          onSaveForce={() => handleSave({ force: true })}
          onSaveAs={handleSaveAs}
          onUndo={doUndo}
          onRedo={doRedo}
          onExportProject={() =>
            exportProject(docState.doc.name, docState.doc.source, docState.sidecar)
          }
          onExportSidecar={() => exportSidecar(docState.sidecar)}
          onExportHtml={() =>
            exportHtml(docState.doc.name, docState.blocks, docState.sidecar)
          }
          conflict={status === "conflict"}
        />
      )}

      <InputDiagnostics />
    </div>
  );
}

// Re-export for potential external fingerprint use.
export { fingerprintOf };
