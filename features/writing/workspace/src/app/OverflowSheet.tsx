import type { Preferences } from "../storage/db";

type Props = {
  prefs: Preferences;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  conflict: boolean;
  onUpdatePrefs: (patch: Partial<Preferences>) => void;
  onClose: () => void;
  onSave: () => void;
  onSaveForce: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onExportProject: () => void;
  onExportSidecar: () => void;
  onExportHtml: () => void;
};

/** Secondary sheet for advanced actions and preferences (§5.3). */
export function OverflowSheet({
  prefs,
  dirty,
  canUndo,
  canRedo,
  conflict,
  onUpdatePrefs,
  onClose,
  onSave,
  onSaveForce,
  onSaveAs,
  onUndo,
  onRedo,
  onExportProject,
  onExportSidecar,
  onExportHtml,
}: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="Actions and settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <strong>Document</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {conflict && (
          <div className="conflict-notice" role="alert">
            <p>This file changed on disk since you opened it.</p>
            <div className="row">
              <button onClick={onSaveAs}>Save a copy</button>
              <button onClick={onSaveForce}>Overwrite anyway</button>
            </div>
          </div>
        )}

        <div className="sheet-group">
          <button onClick={onSave}>Save{dirty ? " •" : ""}</button>
          <button onClick={onSaveAs}>Save As…</button>
        </div>

        <div className="sheet-group">
          <button disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button disabled={!canRedo} onClick={onRedo}>
            Redo
          </button>
        </div>

        <div className="sheet-group">
          <button onClick={onExportProject}>Export project (.md + ink)</button>
          <button onClick={onExportSidecar}>Export ink sidecar</button>
          <button onClick={onExportHtml}>Export HTML</button>
        </div>

        <hr />

        <div className="sheet-settings">
          <label>
            Theme
            <select
              value={prefs.theme}
              onChange={(e) =>
                onUpdatePrefs({ theme: e.target.value as Preferences["theme"] })
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="eink">E-ink / high contrast</option>
            </select>
          </label>

          <label>
            Line height: {prefs.lineHeight}px
            <input
              type="range"
              min={38}
              max={56}
              value={prefs.lineHeight}
              onChange={(e) => onUpdatePrefs({ lineHeight: Number(e.target.value) })}
            />
          </label>

          <label>
            Writing lines
            <select
              value={prefs.defaultWritingLines}
              onChange={(e) =>
                onUpdatePrefs({ defaultWritingLines: Number(e.target.value) })
              }
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={prefs.fingerTapEdits}
              onChange={(e) => onUpdatePrefs({ fingerTapEdits: e.target.checked })}
            />
            Finger tap edits immediately
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={prefs.reduceEinkRefresh}
              onChange={(e) => onUpdatePrefs({ reduceEinkRefresh: e.target.checked })}
            />
            Reduce e-ink refresh (no reflow animation)
          </label>

          <label className="color">
            Pen colour
            <input
              type="color"
              value={prefs.penColor}
              onChange={(e) => onUpdatePrefs({ penColor: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
