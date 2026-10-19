// Ambient declarations for the Kalamos app shell globals available at
// runtime inside the device WebView (and stubbed by the browser preview
// server). `Bridge` and `Storage` are lexical consts declared by classic
// scripts in the foundation WebView assets — NOT window properties, so guard with
// `typeof Bridge !== "undefined"`, never `window.Bridge`.

declare const Bridge: {
  isInkSessionAttached?(): boolean;
  // Book-file storage (per-notebook opaque files)
  getBookFile(notebookId: string, relPath: string): string;
  saveBookFile(notebookId: string, relPath: string, content: string): string;
  // Writing-document files live beside notebook metadata. Optional only so browser-preview fakes
  // and older app shells can use the compatibility fallback in kalamosStore.
  getNotebookFile?(notebookId: string, relPath: string): string;
  saveNotebookFile?(notebookId: string, relPath: string, content: string): string;

  // Native ink daemon
  attachInkBox(l: number, t: number, r: number, b: number): boolean;
  /** Reader note-box detach: preserve the surrounding reader and signal its legacy callback. */
  detachInkBox(): void;
  /** Full-editor exit: clear persistent panel pixels and all retained daemon state. */
  detachInkBoxCleared?(): void;
  /** Transient tool handoff: expose an opaque WebView without first painting a white frame. */
  detachInkBoxForWeb?(): void;
  /** Repair WebView visibility when the daemon was already detached. */
  showWebWorkspace?(): void;
  /** True only when hidden native pixels remain visible on the physical display (Bigme). */
  supportsPersistentDisplayHandoff?(): boolean;
  setInkStyle(widthPx: number, colorHex: string): void;
  setPenType(type: "ballpoint" | "felt" | "selection"): void;
  setInteractivePanel(active: boolean): void;
  setErasing(active: boolean): void;
  setInkEnabled(enabled: boolean): void;
  renderInk(json: string): void;
  flushInk(): void;
  setWritingBounds(l: number, t: number, r: number, b: number): void;
  setWritingExclusion(l: number, t: number, r: number, b: number): void;
  showEditor?(): void;
  enterLibrary?(): void;

  // E-ink snapshot/bake pipeline
  snapshotContent(l: number, t: number, r: number, b: number): void;
  snapshotContentPartial(
    l: number, t: number, r: number, b: number,
    rl: number, rt: number, rr: number, rb: number
  ): void;
  skipWakeRefresh(): void;
  resumeInkBox?(l: number, t: number, r: number, b: number): void;
  snapshotMenu?(l: number, t: number, r: number, b: number, rl: number, rt: number, rr: number, rb: number): void;
  snapshotToolbarRegion(l: number, t: number, r: number, b: number): void;
  clearContent(): void;
  /** Standard-only direct capture of the authoritative WebView paper region, in device pixels. */
  captureWebThumbnail?(
    notebookId: string,
    left: number,
    top: number,
    right: number,
    bottom: number
  ): void;

  // HWR (MyScript seam). bridge.js wraps the JSON: args in as object,
  // {reqId}|{err} out as object; results arrive via window.onHwrEvent.
  hwrStatus(lang: string): string;
  hwrDownload(lang: string): { reqId?: string; err?: string };
  hwrRecognize(args: {
    mode?: "text" | "gesture" | "shape";
    lang: string;
    strokes: number[][][];
    area?: { w: number; h: number };
    preContext?: string;
  }): { reqId?: string; err?: string };

  showToast(msg: string): void;
};

// NOTE: the Kalamos `Storage` lexical global collides with the DOM Storage
// type and cannot be redeclared here — use kalamosStorage() from shell.ts.

declare const App: {
  current: string;
  showLibrary?: () => void;
};

interface Window {
  KalamosWritingHost?: {notebookToolbar?:boolean;onDocumentClosed?:(notebookId:string)=>void;onDocumentOpened?:(notebookId:string)=>void;documentActions?: {label:string;shortLabel?:string;icon?:string;onPress?:(notebookId:string)=>boolean;run:(notebookId:string)=>void}[];documentAction?: {label:string;shortLabel?:string;run:(notebookId:string)=>void}};
  KalamosWriteWorkspace?: import("./entry").KalamosWriteWorkspaceApi;
  KalamosToolbarIcons?: {
    svg(name: string): string;
  };
  onHwrEvent?: (json: string) => void;
  onNativeFlushed?: () => void;
  _noteSketch?: { w: number; h: number } | null;
  _inkHandler?: {
    onNoteStrokes(strokes: number[][][]): void;
    onNativeFlushed?: () => void;
  } | null;
}
