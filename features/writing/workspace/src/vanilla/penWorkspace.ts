import { notebookSheetsToMarkdown } from "../editor/notebookMarkdown";
import { createEmptySidecar } from "../sidecar/schema";
import { writeSelectionClipboard, readSelectionClipboard, hasSelectionClipboard } from "../editor/selectionClipboard";
import type { DocumentAction } from "./documentActions";
import { IMAGE_HANDLES, resizeImage, type ImageHandle } from "../editor/imageResize";
import { audioCard, updateAudioCard } from "./audioCard";
import { AttachmentImages, isAttachmentObject, validPageAttachment, drawAttachment, type Attachment, type PageAttachment, type AudioStatus } from "../editor/pageAttachments";
import { horizontalAnchor, horizontalSpace, verticalSpace, condenseSpace, constrainTranslation, type SpatialAtom, type SpatialPlan } from "../reflow/spatialLayout";
import { styledFragments, styleFont, parseInlineMarkdown, serializeInlineMarkdown } from '../editor/inlineStyles';
import { measureStyledText } from '../editor/textBox';
import { synchronizeTaskControls } from "../editor/semanticDocument";
import { eraseStrokeAtPoint, type EraseMode } from "../ink/erase";
// Canonical DOM editor. Spatial edits use the pure spatialLayout engine;
// ink capture, document projection and native handoff retain separate owners.

import { strokeHitsLasso, validLasso } from "../ink/lasso";
import { scribble, type ScribbleResult } from "../ink/scribble";
import { objectDragBounds, objectPath, objectSvg, drawMarkdownObject, type PageObject } from "../editor/pageObjects";
import { isPaperObject, objectContains, objectInkOnPage, objectMinimumSize, maskObjectInk } from "../editor/objectInk";
import { clipInkPath } from "../ink/clip";
import { inkToolIcon } from "./inkToolIcons";
import { bindPenButton, type PenButtonActivation } from "./penButton";
import { wrapBoxText, placeBoxWords, fitBoxWidth, ruledTextSize, WORKSPACE_FONT_FAMILY, resolveRuledLineHeight, removeBoxWords, withWordRanges, ruledTextFont } from "../editor/textBox";
import { insertTextFlow } from "../reflow/insertText";
import type { Block } from "../markdown/parse";
import type { InkPoint, InkStroke, InlineInkRun, Bounds } from "../ink/types";
import { boundsOfPoints, boundsUnion, emptyBounds } from "../ink/types";
import {
  appendFiltered,
  fillStroke,
  outlinePathD,
  strokeOutline,
  strokeHitsPoint,
} from "../ink/geometry";
import { editableView } from "../editor/blockSource";
import { strokesToRun } from "../sidecar/anchors";
import {
  anchorOffsetForInsert,
  newInsertId,
  orderedFlow,
  removeInsert,
  retokenize,
  textFromWords,
  tokenizeWords,
  updateInsert,
  type Insert,
  type ReflowDoc,
} from "../editor/reflowModel";
import {
  reflow,
  type FlowBox,
  type PlacedBox,
} from "../reflow/placement";
import type { Preferences } from "../storage/db";
import {
  freeInkLaneIndex,
  normalizeInkStrokes,
  packedInkTop,
  ruledBaselineOffset,
  ruledLineIndex,
  shouldMergeIntoInkWord,
  inkWordMatchScore,
  translateInkStrokes,
} from "../editor/inkPlacement";
import type { CommitPayload } from "../editor/PenWorkspace";
import { svg } from "./dom";
import { clusterInkStrokesByWord, inkStrokeAttachmentDistance, inkStrokeStartsInBody } from "../editor/inkGrouping";
import { MagnifyPad, type MagnifyContext } from "./magnifyPad";
import type { LaneGeometry, MagnifyTarget } from "../editor/magnify";

export type Tool = "write" | "insert" | "lines" | "erase" | "select" | "objects";

type DelegatedInkTrailPresenterLike = {
  updateInkTrailStartPoint: (
    event: PointerEvent,
    style: { color: string; diameter: number }
  ) => void;
};

type InkNavigator = Navigator & {
  ink?: {
    requestPresenter: (options: {
      presentationArea: Element;
    }) => Promise<DelegatedInkTrailPresenterLike>;
  };
};

/** One committed stroke in workspace-container CSS coordinates (for the
 * native daemon's renderInk repaint). */
export type NativeInkStroke = {
  pts: { x: number; y: number; pressure: number }[];
  width: number;
  color: string;
  selected: boolean;
  variableWidth?: boolean;
  brushStyle?: InkStroke["brushStyle"];
};

export type HwrWord = {
  label?: string;
  candidates?: string[];
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type HwrResult = {
  error?: string;
  text?: string;
  candidates?: { text?: string; label?: string }[];
  words?: HwrWord[];
};

/** Handwriting-recognition seam (optional host provider on device; absent in the
 * browser, which hides the convert action). */
export type HwrClient = {
  available(): boolean;
  recognize(
    strokes: number[][][],
    area: { w: number; h: number },
    preContext: string,
    cb: (r: HwrResult) => void
  ): void;
};

export type WorkspacePageTools = { overview?: () => void; index: number; count: number; change: (action: -1 | 1 | "add") => void; overflow?: (height: number) => void };

export type PenWorkspaceProps = {
  /** Group expanded notebook navigation above a dedicated writing-tool rail. */
  notebookToolbar?: boolean;
  loadAttachmentImage?: (attachment: Attachment) => Promise<string>;
  onActivateAttachment?: (object: PageObject) => void;
  onAttachmentError?: (message: string) => void;
  onShareSelection?: (markdown: string) => void;
  onSelectionError?: (message: string) => void;
  documentActions?: DocumentAction[];
  pageTools?: WorkspacePageTools;
  block: Block;
  existingRuns: InlineInkRun[];
  existingSourceWords?: { text: string; x: number; y: number }[];
  existingLineHeight?: number;
  existingPageObjects?: PageObject[];
  existingTextBoxes?: import("../sidecar/schema").TextBox[];
  prefs: Preferences;
  eink: boolean;
  onCommit: (payload: CommitPayload, intent?: "finish" | "checkpoint") => void | Promise<void>;
  onCancel: () => void;
  hwr?: HwrClient;
  /** Interactive chrome over the ruled surface (toolbar or HWR sheet) —
   * native mode masks its combined bounds from the pen via setWritingExclusion. */
  onOverlayChange?: (rect: { l: number; t: number; r: number; b: number } | null) => void;
  /**
   * Device-capable mode. The native daemon owns writing and lasso previews;
   * other tools use the ordinary pointer handlers and render committed ink
   * into the DOM while the native surface is detached.
   */
  native?: boolean;
  /** Fired after any relayout/overlay/toolbar DOM change (native re-bake hook). */
  onLayoutChanged?: () => void;
  /** A control changed pixels without moving page content; window CSS bounds. */
  onContentRegionChange?: (rect: {l:number;t:number;r:number;b:number}) => void;
  /** Full-screen native mode: temporarily reveal the WebView while the pen moves the target. */
  onMagnifyTargeting?: (active: boolean) => void;
  /** Magnifier eraser: keep the daemon layer but pass pen gestures through to the WebView. */
  onMagnifyErasing?: (active: boolean) => void;
  /** Fired when the active tool or keyboard mode changes. */
  onToolChange?: (tool: Tool, keyboard: boolean) => void;
  /** The toolbar drag temporarily hands the page from the native daemon to
   * the live WebView, then re-bakes and restores daemon input on release. */
  onToolbarDragChange?: (active: boolean) => void;
  onPageGestureChange?: (active: boolean) => void;
  /** Settings dialogs own the live WebView until dismissed; preserve the ruled model. */
  onDialogChange?: (active: boolean) => void;
  /** A tap-only expand/collapse can update just the old/new toolbar footprint
   * instead of refreshing the complete ruled page. Bounds are window CSS px. */
  onToolbarLayoutChange?: (
    previous: { l: number; t: number; r: number; b: number },
    current: { l: number; t: number; r: number; b: number }
  ) => void;
  /** Persist a user-visible ruled-writing preference change. */
  onPreferencesChange?: (prefs: Preferences) => void;
  /** Apply colour/width immediately to a live native ink controller. */
  onInkStyleChange?: (color: string, widthCss: number) => void;
  /** Mirrors the drawing editor's tab → compact → full chrome progression. */
  onToolbarModeChange?: (mode: "collapsed" | "compact" | "full") => void;
  /** Native mode: drain the daemon's pending stroke batch before a command
   * that reads or changes the model (tool switch, undo, keyboard, Done). */
  onBeforeNativeAction?: (action: () => void) => void;
  /** Direct notebook hosts auto-commit through their outer close control and
   * therefore omit redundant Cancel/Done toolbar actions. */
  showSessionActions?: boolean;
};

const PAD = 4;

/** Content-aware crop for library previews. The returned box always contains the supplied content,
 * stays inside the page, and preserves the target aspect whenever the page itself permits it. */
export function thumbnailCrop(
  pageWidth: number,
  pageHeight: number,
  content: Bounds | null,
  lineHeight: number,
  targetAspect: number
): Bounds {
  if (!content || content.width < 0 || content.height < 0) {
    return { x: 0, y: 0, width: pageWidth, height: pageHeight };
  }
  const padX = Math.max(24, lineHeight * 0.75);
  const padY = lineHeight * 1.5;
  const wantedWidth = Math.min(
    pageWidth,
    Math.max(lineHeight * 3, content.width + padX * 2)
  );
  const wantedHeight = Math.min(
    pageHeight,
    Math.max(lineHeight * 4, content.height + padY * 2)
  );
  let width = wantedWidth;
  let height = wantedHeight;
  if (width / height > targetAspect) height = width / targetAspect;
  else width = height * targetAspect;
  if (width > pageWidth || height > pageHeight) {
    const fit = Math.min(pageWidth / width, pageHeight / height);
    width *= fit;
    height *= fit;
    // Never trade away note content just to force the thumbnail aspect.
    if (width < wantedWidth || height < wantedHeight) {
      width = pageWidth;
      height = pageHeight;
    }
  }
  const centerX = content.x + content.width / 2;
  const centerY = content.y + content.height / 2;
  return {
    x: Math.max(0, Math.min(pageWidth - width, centerX - width / 2)),
    y: Math.max(0, Math.min(pageHeight - height, centerY - height / 2)),
    width,
    height,
  };
}

function lineCountForDrag(previousLines: number, dy: number, lineHeight: number): number {
  return previousLines + Math.round(dy / lineHeight);
}

const dlog = import.meta.env.DEV
  ? (tag: string, data?: unknown) =>
      console.log(`[vpw:${tag}]`, data === undefined ? "" : JSON.stringify(data))
  : () => {};

function strokesBounds(strokes: InkStroke[], pad = 0): Bounds {
  let b = emptyBounds();
  for (const s of strokes) b = boundsUnion(b, boundsOfPoints(s.points));
  if (strokes.length === 0) return b;
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

function wordIndexForOffset(words: string[], offset: number): number {
  for (let k = words.length - 1; k >= 0; k--) {
    if (anchorOffsetForInsert(words, k) <= offset) return k;
  }
  return -1;
}

type Layout = {
  placed: PlacedBox[];
  height: number;
  slots: { afterWord: number; x: number; line: number }[];
  inkPlacements: Map<string, { x: number; y: number }>;
  lineMarkers: { id: string; top: number; lines: number }[];
};

type VisualItem = {
  placedIndex?: number;
  inkId?: string;
  kind: "word" | "ink";
  line: number;
  x: number;
  width: number;
  order: number;
};

type SpacingSession = {
  id: string; kind: "gap" | "line"; baseline: ReflowDoc; atoms: SpatialAtom[];
  afterWord: number; line: number; x: number; amount: number; width: number; result?: ReflowDoc;
};

/**
 * Focused writing workspace. Mounts into `container` and calls back through
 * `props.onCommit` / `props.onCancel`. Ink strokes stay in stable run-local
 * coordinates; the layout owns their screen position exactly as it owns each
 * typed word's position, so reflow cannot translate stroke data and
 * rendering independently.
 */
export class PenWorkspace {
  private props: PenWorkspaceProps;
  private view: ReturnType<typeof editableView>;
  private inkColor: string;
  private penWidth: number;
  private notebookColorSlot = 0;
  private lineHeight: number;

  private doc: ReflowDoc;
  private tool: Tool = "write";
  private objectKind: PageObject["kind"] = "rectangle";
  private objectOutline = false;
  private objectColor = "#000000";
  private objectWidth = 2;
  private objectLineStyle: NonNullable<PageObject["lineStyle"]> = "solid";
  private selectedObjectId: string | null = null;
  private objectDraft: {id:number; start:InkPoint; points:InkPoint[]} | null = null;
  get nativePenType(): "ballpoint" | "felt" { return this.props.prefs.brushStyle === "brush" ? "felt" : "ballpoint"; }
  private eraserTip: HTMLDivElement | null = null;
  private eraserDiameter = 20;
  private eraserMode: EraseMode | "lasso" = "stroke";
  private selectionLassoPoints: InkPoint[] = [];
  private eraseLassoPoints: InkPoint[] = [];
  private eraseLassoEl: SVGSVGElement | null = null;
  private textEdited = false;
  private keyboard = false;
  private nativeInkActive: boolean;
  // A normal Android display cannot keep a SurfaceView visible during toolbar movement: hiding it
  // loses the page, while leaving it visible occludes the WebView toolbar. This temporary preview
  // renders the same committed vector model in the DOM without changing native write-tool state.
  private nativeWebHandoff = false;
  private nativeDialogHandoff = false;
  private dialogNotified = false;
  private dialogObserver: MutationObserver | null = null;
  // Once selected, objects stay in interactive WebView manipulation until a new lasso is requested.
  private selectionInteraction = false;
  private directSelection = false;
  private selectedInsertId: string | null = null;
  private selectedTextWord: {boxId:string;index:number} | null = null;
  private selectedTextWords = new Map<string, Set<number>>();
  private blockDrag: {start: InkPoint; last: InkPoint} | null = null;
  private textWordDrag: {pointerId:number;boxId:string;index:number;indices:number[];start:{x:number;y:number};origin:{x:number;y:number};last:{x:number;y:number}} | null = null;
  private selectedTemplateSectionId: string | null = null;
  /** The most recently touched spacer of each kind owns the one persistent
   * thick handle. Older spacing remains in the layout without leaving a row
   * of heavy carets across the document. */
  private activeSpacingInsertIds: Partial<Record<"gap" | "line", string>> = {};

  private root: HTMLElement;
  private containerEl: HTMLDivElement;
  private canvasEl: HTMLCanvasElement;
  private textareaEl: HTMLTextAreaElement;
  private logEl: HTMLSpanElement | null = null;
  private toolbarEl: HTMLDivElement;
  private copyBtn: HTMLButtonElement | null = null;
  private deleteBtn: HTMLButtonElement | null = null;
  private convertBtn: HTMLButtonElement | null = null;
  private hwrSheetEl: HTMLElement | null = null;
  private hwrExclusionRect: { l: number; t: number; r: number; b: number } | null = null;
  private textPromptEl: HTMLElement | null = null;
  private textPromptExclusionRect: { l: number; t: number; r: number; b: number } | null = null;
  private acceptTextPrompt: (() => void) | null = null;
  private penSettingsEl: HTMLElement | null = null;
  private settingsDismissGesture = false;
  private penSettingsExclusionRect: { l: number; t: number; r: number; b: number } | null = null;
  private width = 320;

  private spacingSession: SpacingSession | null = null;
  private lastSpacing: SpacingSession | null = null;
  private spacingCheckpoint: { doc: ReflowDoc; redo: ReflowDoc[]; depth: number } | null = null;
  private historyStack: ReflowDoc[] = [];
  private scribbleTransactions = new WeakSet<ReflowDoc>();
  private redoStack: ReflowDoc[] = [];
  private magnifyPad: MagnifyPad | null = null;
  private magnifyWebViewMode = false;
  private gesture: {
    pointerId: number | null;
    mode: Tool | null;
    insertId: string | null;
    startX: number;
    startY: number;
    gapX: number;
    gapLine: number;
    prevWidth: number;
    prevLines: number;
    liveStroke: InkStroke | null;
    lastMove: { x: number; y: number };
    /** Select uses one DOM-only preview during the high-rate drag. Committing
     * the model on every pen sample made packed ink jump between flow slots
     * and rebuilt the complete overlay dozens of times per second. */
    selectOrigin: { x: number; y: number } | null;
    selectPosition: { x: number; y: number } | null;
    selectMoved: boolean;
  } = {
    pointerId: null, mode: null, insertId: null,
    startX: 0, startY: 0, gapX: 0, gapLine: 0,
    prevWidth: 0, prevLines: 0, liveStroke: null,
    lastMove: { x: 0, y: 0 },
    selectOrigin: null, selectPosition: null, selectMoved: false,
  };

  private dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  private gapRaf: number | null = null;
  private pendingGapWidth = 0;
  private pendingLineCount = 0;
  private touchScroll: { id: number; lastY: number; startX: number; startY: number; started: number; axis: "horizontal" | "vertical" | null } | null = null;
  private touchContacts = new Set<number>();
  private penContact = false;
  private inkStrokeCount = 0;
  private inkCommitCount = 0;
  private lastInkEndMs = 0;
  private delegatedInkPresenter: DelegatedInkTrailPresenterLike | null = null;
  private liveCanvasBounds: Bounds | null = null;
  private renderedInkStrokes = new Map<string, InkStroke[]>();
  private nativeModelDirty = false;
  private checkboxActivations = new Map<string, PenButtonActivation>();
  private insertionGuide: { x: number; top: number } | null = null;

  private get textSize() { return ruledTextSize(this.lineHeight); }
  private get textFont() { return ruledTextFont(this.lineHeight); }
  private headingMeasures = new Map<string,{word:(text:string)=>number;space:number}>();
  private inlineMeasureContext:CanvasRenderingContext2D|null=null;
  private boxFont(box?:import("../sidecar/schema").TextBox) { return ruledTextFont(this.lineHeight,box?.fontWeight===700?'heading':undefined); }
  private styledMeasure(box:import("../sidecar/schema").TextBox,value:string,start:number) {
    if(!box.styles?.length)return this.boxMeasure(box).word(value);
    const ctx=this.inlineMeasureContext??(this.inlineMeasureContext=document.createElement('canvas').getContext('2d'));
    if(!ctx)throw Error('Styled text measurement is unavailable');
    return measureStyledText(box.text,box.styles,start,start+value.length,(part,mark)=>{
      ctx.font=styleFont(this.boxFont(box),mark);return ctx.measureText(part).width;
    });
  }
  private measuredBoxWords(box:import("../sidecar/schema").TextBox){
    const measure=this.boxMeasure(box);
    return box.words??placeBoxWords(box.text,box.x,box.y,box.width,this.lineHeight,measure.word,measure.space,(value,start)=>this.styledMeasure(box,value,start));
  }
  private wordFragments(box:import("../sidecar/schema").TextBox|undefined,index:number|undefined,value:string) {
    const word=box?this.measuredBoxWords(box)[index??-1]:undefined;
    if(!box?.styles?.length || word?.textStart===undefined)return [{text:value,start:0,end:value.length}];
    return styledFragments(box.text,box.styles,word.textStart,word.textEnd);
  }
  private boxMeasure(box:import("../sidecar/schema").TextBox) {
    if(box.fontWeight!==700)return this.measure;
    const font=this.boxFont(box);let measure=this.headingMeasures.get(font);
    if(!measure){
      const ctx=document.createElement('canvas').getContext('2d');
      if(!ctx)throw new Error('Heading measurement is unavailable');
      ctx.font=font;
      measure={word:(text:string)=>ctx.measureText(text).width,space:Math.max(4,ctx.measureText('x x').width-2*ctx.measureText('x').width)};
      this.headingMeasures.set(font,measure);
    }
    return measure;
  }

  private measure: { word: (w: string) => number; space: number };
  private layout!: Layout;
  private ro: ResizeObserver;
  private attachmentImages: AttachmentImages;
  private destroyed = false;
  private pageObjectNodes = new Map<string,{object:PageObject;tool:Tool;direct:boolean;selected:string|null;native:boolean;source:string|undefined;node:HTMLElement}>();
  private audioStates = new Map<string, AudioStatus>();
  private attachmentActivations = new Map<string, PenButtonActivation>();

  constructor(root: HTMLElement, props: PenWorkspaceProps) {
    this.props = props;
    this.attachmentImages = new AttachmentImages(props.loadAttachmentImage, () => {
      if (!this.destroyed) { this.renderOverlay(); this.props.onLayoutChanged?.(); }
    });
    this.view = editableView(props.block);
    // E-ink is a presentation theme, not a reason to discard ink colour. Bigme's native path and
    // the classic drawing editor already accept per-stroke colours; monochrome panels render them
    // as greys while colour-capable and Standard targets preserve the selected value.
    this.inkColor = props.prefs.penColor;
    this.penWidth = props.prefs.penWidth;
    this.notebookColorSlot = Math.max(0, props.prefs.penQuickColors?.findIndex(colour => colour.toLowerCase() === props.prefs.penColor.toLowerCase()) ?? 0);
    // A notebook keeps its saved ruled lanes when opened on a different screen.
    // Pre-field sidecars can be recognized from the two historical lane spacings.
    this.lineHeight = resolveRuledLineHeight(props.existingLineHeight, props.existingSourceWords, props.prefs.lineHeight);
    this.nativeInkActive = !!props.native;
    this.root = root;

    const words = tokenizeWords(this.view.value);
    const inserts: Insert[] = props.existingRuns.map((r) => ({
      id: r.id,
      afterWord: wordIndexForOffset(words, r.anchorOffset),
      kind: "ink",
      width: r.intrinsicWidth,
      height: r.intrinsicHeight,
      baselineOffset: r.baselineOffset,
      ...(r.layoutX !== undefined && r.layoutY !== undefined
        ? { freeX: r.layoutX, freeY: r.layoutY }
        : {}),
      strokes: r.strokes,
    }));
    this.doc = { words, inserts, pageObjects: props.existingPageObjects ?? [], textBoxes: (props.existingTextBoxes ?? []).map((box) => ({ ...box, y: Math.max(0, Math.round(box.y / this.lineHeight) * this.lineHeight) })) };

    const measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d")!;
    ctx.font = this.textFont;
    const space = Math.max(4, ctx.measureText("x x").width - 2 * ctx.measureText("x").width);
    this.measure = { word: (w: string) => ctx.measureText(w).width, space };

    // ---- Build static DOM shell ----
    this.root.className = "pen-workspace";
    this.root.setAttribute("role", "group");
    this.root.setAttribute("aria-label", "Writing workspace");

    this.containerEl = document.createElement("div");
    this.containerEl.className = `reflow-surface tool-${this.tool}`;
    this.containerEl.style.lineHeight = `${this.lineHeight}px`;
    this.containerEl.style.setProperty("--ruled-text-size", `${this.textSize}px`);
    this.containerEl.style.backgroundImage = `repeating-linear-gradient(to bottom, transparent, transparent ${
      this.lineHeight - 1
    }px, var(--rule) ${this.lineHeight - 1}px, var(--rule) ${this.lineHeight}px)`;
    // Pen contact cancels a finger swipe; hover must not impose a navigation cooldown.
    this.root.addEventListener("pointerdown", this.observePenActivity, true);
    window.addEventListener("pointerup", this.observePenActivity, true);
    window.addEventListener("pointercancel", this.observePenActivity, true);
    this.containerEl.addEventListener("pointerdown", this.onPointerDown);
    this.containerEl.addEventListener("pointermove", this.onPointerMove);
    this.containerEl.addEventListener("pointerleave", this.hideEraserTip);
    this.containerEl.addEventListener("pointerup", this.finishGesture);
    this.containerEl.addEventListener("pointercancel", this.finishGesture);
    this.containerEl.addEventListener("lostpointercapture", this.finishGesture);
    // The device WebView can lose a surface-targeted pointerup after relayout
    // rebuilds the overlay. Capture pointer endings at window level as well so
    // a placed spacer caret cannot leave the workspace gesture-locked.
    window.addEventListener("pointerup", this.finishGesture, true);
    window.addEventListener("pointercancel", this.finishGesture, true);

    this.canvasEl = document.createElement("canvas");
    this.canvasEl.className = "rw-canvas";
    this.canvasEl.style.touchAction = "none";
    this.textareaEl = document.createElement("textarea");
    this.textareaEl.className = "rw-textarea";
    this.textareaEl.spellcheck = false;
    this.textareaEl.setAttribute("aria-label", "Edit block text");
    this.textareaEl.addEventListener("input", () => this.onTextChange(this.textareaEl.value));

    // Attach both persistent nodes up front — renderOverlay() only toggles
    // their visibility from here on. (Appending them lazily on first render
    // broke insertBefore(frag, canvasEl), since canvasEl wasn't a child yet.)
    this.containerEl.append(this.canvasEl, this.textareaEl);

    this.root.appendChild(this.containerEl);

    // Let Chromium's compositor extend the wet trail between JavaScript pointer deliveries. The
    // Huion exposes this API, and it avoids waiting on the Mali-backed WebView canvas frame path.
    const ink = (navigator as InkNavigator).ink;
    if (ink?.requestPresenter) {
      ink.requestPresenter({ presentationArea: this.canvasEl }).then(
        (presenter) => {
          this.delegatedInkPresenter = presenter;
          console.info("DIAG [kalamos-ink] delegated presenter ready");
        },
        (error) => console.info(`DIAG [kalamos-ink] delegated presenter unavailable: ${String(error)}`)
      );
    }

    if (import.meta.env.DEV) {
      const logWrap = document.createElement("div");
      logWrap.className = "pen-log";
      logWrap.setAttribute("aria-hidden", "true");
      this.logEl = document.createElement("span");
      this.logEl.textContent = "pen idle";
      logWrap.appendChild(this.logEl);
      this.root.appendChild(logWrap);
    }

    this.toolbarEl = this.buildToolbar();
    this.root.appendChild(this.toolbarEl);
    if (props.native) {
      // Dialog ownership is scoped to this editor. Observe mounted dialogs as well as the
      // existing sheets so magnifier settings and future accessible dialogs share the handoff.
      this.dialogObserver = new MutationObserver(() => this.syncDialogOwnership());
      this.dialogObserver.observe(this.root, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"],
      });
    }
    // Apply the initial visibility/pressed state immediately. Delete and HWR
    // are selection-only controls; leaving them visible until the first tool
    // change overflows the 674px device toolbar and clips Done.
    this.updateToolbarState();
    requestAnimationFrame(() => {
      if (this.root.isConnected) this.syncWritingExclusion();
    });

    this.ro = new ResizeObserver(() => {
      const width = this.containerEl.clientWidth;
      if (width <= 0 || width === this.width) return;
      this.settleSpacingGesture(true);
      this.lastSpacing = null;
      this.width = width;
      this.relayout();
    });
    this.ro.observe(this.containerEl);
    void this.readyAttachments().catch(error => this.props.onAttachmentError?.(error.message));
    this.width = this.containerEl.clientWidth || 320;

    this.relayout();
    // Repair historical cross-row word groups on load without changing any pen points.
    // Single-row runs retain their original segmentation and saved baseline.
    for (const ins of [...this.doc.inserts]) {
      const position = this.layout.inkPlacements.get(ins.id);
      if (!position || ins.strokes.length < 2) continue;
      const overall = strokesBounds(ins.strokes, PAD);
      const groups = clusterInkStrokesByWord(ins.strokes, this.lineHeight, position.y - overall.y);
      const lanes = groups.map(group => {
        const bounds = strokesBounds(group, PAD);
        return freeInkLaneIndex(position.y + bounds.y - overall.y, bounds.height, this.lineHeight);
      });
      if (new Set(lanes).size > 1) this.splitInkRunIntoWords(ins.id);
    }
    dlog("workspace:mount", { blockId: props.block.id });
  }

  async readyAttachments(): Promise<void> { await this.attachmentImages.ready(this.doc.pageObjects ?? []); }

  async addAttachment(value: PageAttachment): Promise<void> {
    const width = Math.max(48, Math.min(this.width - 32, value.kind === 'image' ? 320 : 280));
    const ratio = value.kind === 'image' && value.attachment.width && value.attachment.height
      ? value.attachment.height / value.attachment.width : 1;
    const object: PageObject = { ...value, id: newInsertId('attachment'), blockId: this.props.block.id,
      x: Math.min(24, Math.max(0, this.width-width)), y: Math.max(0, this.containerEl.scrollTop + this.lineHeight),
      width, height: value.kind === 'image' ? Math.max(48, width*ratio) : value.kind === 'audio' ? 52 : 76,
      color: '#000000', strokeWidth: 1, paper: false };
    if (!['image','audio','file','link'].includes(object.kind) || !validPageAttachment(object)) throw new Error('Invalid attachment');
    if (object.kind === 'image') await this.attachmentImages.ready([object]);
    if (this.destroyed) throw new Error('The page was closed. Open Attach again on the intended page.');
    this.pushHistory(); this.doc = { ...this.doc, pageObjects: [...(this.doc.pageObjects ?? []), object] };
    this.selectedObjectId = object.id; this.setTool('objects'); this.relayout();
    this.props.onLayoutChanged?.();
  }

  updateAttachmentAudio(status: AudioStatus): void {
    if (!status || typeof status.playing!=='boolean' || !/^[a-f0-9]{64}$/.test(status.id) || ![status.positionMs,status.durationMs].every(n=>Number.isFinite(n)&&n>=0)) return;
    const previous=this.audioStates.get(status.id); this.audioStates.set(status.id,status);
    if (this.nativeInkActive && previous?.playing===status.playing) return;
    const card=this.containerEl.querySelector<HTMLElement>(`[data-audio-attachment="${status.id}"]`);
    if (!card) return;
    updateAudioCard(card,status);
    // Periodic timers must never reconcile the daemon while somebody is writing. Only an
    // explicit playback state transition uses the existing bounded control refresh.
    if (this.nativeInkActive && previous?.playing!==status.playing) {
      const rect=card.getBoundingClientRect();
      this.props.onContentRegionChange?.({l:rect.left,t:rect.top,r:rect.right,b:rect.bottom});
    }
  }
  private attachmentActivation(id:string):PenButtonActivation {
    let value=this.attachmentActivations.get(id);
    if(!value){value={activatedAt:-Infinity};this.attachmentActivations.set(id,value);}return value;
  }

  arrangeAttachments(): void { this.afterNativeFlush(() => this.setTool('objects')); }

  destroy() {
    this.destroyed = true; this.attachmentImages.dispose(); this.pageObjectNodes.clear();
    this.settleSpacingGesture(true);
    this.root.removeEventListener("pointerdown", this.observePenActivity, true);
    this.containerEl.removeEventListener("pointerleave", this.hideEraserTip);
    this.eraserTip?.remove();
    window.removeEventListener("pointerup", this.observePenActivity, true);
    window.removeEventListener("pointercancel", this.observePenActivity, true);
    this.setSettingsDismissGesture(false);
    this.dialogObserver?.disconnect();
    this.dialogObserver = null;
    if (this.magnifyPad) {
      this.magnifyPad.saveDraft(); // recoverable, seq-guarded against double commit
      this.magnifyPad.dispose();
      this.magnifyPad = null;
    }
    this.closeTextPrompt(false);
    this.ro.disconnect();
    window.removeEventListener("pointerup", this.finishGesture, true);
    window.removeEventListener("pointercancel", this.finishGesture, true);
    this.closePenSettings(false);
    this.props.onDialogChange?.(false);
    this.closeHwrSheet();
    this.props.onOverlayChange?.(null);
    dlog("workspace:unmount", { blockId: this.props.block.id });
  }

  /** Commit the current workspace through the same native-flush path as the
   * visible Done button. App shells use this for hardware Back without
   * duplicating the editor's final reflow/sidecar logic. */
  finish(): void {
    this.acceptTextPrompt?.();
    this.afterNativeFlush(() => { void this.handleDone("finish"); });
  }

  /** Flush and persist the current workspace without closing it. Android pause uses this so the
   * final daemon batch is part of the saved model while returning to the app can resume in place. */
  checkpoint(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.afterNativeFlush(() => {
        void this.handleDone("checkpoint").then(resolve, reject);
      });
    });
  }

  /** Native has already delivered its completed batch before asking for an idle save.
   * Persist that model without another flush, tool change, render or ink suspension.
   * Zoom owns a separate recoverable draft and must not be committed here. */
  saveDeliveredNativeDraft(): Promise<void> {
    if(this.magnifyPad)return Promise.resolve();
    return this.handleDone("checkpoint");
  }

  // ---- Magnified writing (AFK-W2; model in editor/magnify.ts, UI in magnifyPad.ts) ----
  // The pad is a MODE layered over the workspace, not a Tool: while open, a capture-phase
  // listener turns upper-document taps into target choices, so none of the existing tool
  // paths (or the native daemon ownership rules) are touched.

  toggleMagnify(): void {
    if (this.magnifyPad) {
      this.magnifyPad.requestClose();
      return;
    }
    this.afterNativeFlush(() => {
      // Retire the previous tool sheet before changing the composition bounds. Otherwise its
      // retained chrome survives above the Zoom lane and the now-shorter page clips its controls.
      this.closePenSettings();
      this.magnifyPad = new MagnifyPad(this, this.root);
      this.magnifyPad.syncEraserSettings();
      this.renderOverlay();
      this.updateToolbarState();
      this.props.onLayoutChanged?.();
    });
  }

  get magnifyOpen(): boolean {
    return !!this.magnifyPad;
  }

  onMagnifyClosed(): void {
    this.magnifyPad = null;
    this.renderOverlay();
    this.updateToolbarState();
    this.props.onLayoutChanged?.();
  }

  /** Active native writing surface. Magnify mode deliberately moves daemon ownership from
   * the upper document to the lower pad canvas. */
  nativeInkSurface(): HTMLElement {
    return this.magnifyPad?.nativeSurface() ?? this.containerEl;
  }

  /** Keep every toolbar mode inside one authoritative composition. The collapsed tab extends
   * into the paper margin; a paper-sized SurfaceView splits that tab across WebView/native
   * layers during captures. Paper-local writing bounds still exclude the surrounding chrome.
   * Zoom deliberately retains its separate lower writing surface. */
  nativeCompositionSurface(): HTMLElement {
    if (this.magnifyPad) return this.nativeInkSurface();
    return this.root.closest<HTMLElement>(".v-modal") ?? this.root;
  }

  /** Floating controls are foreground chrome, never part of the content beneath native ink. */
  nativeChromeRect(): { l: number; t: number; r: number; b: number } | null {
    // Zoom's full-screen composition still needs a settled foreground capture of its top tools.
    // Never capture the full-screen toolbar wrapper: that would cover the pad with old paper.
    if (this.toolbarEl.classList.contains("toolbar-all-tools") && !this.magnifyPad) return null;
    const chrome = this.magnifyPad ? this.toolbarEl.querySelector<HTMLElement>(".toolbar-core") : this.toolbarEl;
    const r = chrome?.getBoundingClientRect();
    if (!r) return null;
    return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }

  magnifyNativeActive(): boolean {
    // Magnify is its own native-writing mode and overrides the previously selected workspace
    // tool. MagnifyPad asks during construction, before this.magnifyPad has been assigned, so
    // neither that field nor nativeInkActive (which reflects the underlying tool) is a valid gate.
    return !!this.props.native;
  }

  magnifyInkStyle(): { color: string; width: number; brushStyle?: InkStroke["brushStyle"] } {
    return this.getInkStyle();
  }

  magnifyContext(target: MagnifyTarget): MagnifyContext {
    const lineRadius = 3;
    const words = this.layout.placed
      .filter((placed) =>
        placed.kind === "word" && Math.abs(placed.line - target.line) <= lineRadius
      )
      .map((placed) => ({
        text: placed.kind === "word" ? placed.text : "",
        x: placed.x,
        line: placed.line,
        ...(placed.kind==='word'&&placed.textBoxId?{fragments:this.wordFragments(this.doc.textBoxes?.find(b=>b.id===placed.textBoxId),placed.textWordIndex,placed.text).map(run=>({text:run.text,font:styleFont(this.boxFont(this.doc.textBoxes?.find(b=>b.id===placed.textBoxId)),run),...('strike' in run&&run.strike?{strike:true}:{})}))}:{}),
      }));
    const top = (target.line - lineRadius) * this.lineHeight;
    const bottom = (target.line + lineRadius + 1) * this.lineHeight;
    const strokes = this.getNativeInkStrokes()
      .filter((stroke) => stroke.pts.some((point) => point.y >= top && point.y <= bottom))
      .map((stroke) => ({
        points: stroke.pts.map((point) => ({ x: point.x, y: point.y })),
        width: stroke.width,
        color: stroke.color,
      }));
    return { words, strokes, fontSize: this.textSize, baselineInset: 2 + this.textSize * 0.23 };
  }

  magnifyInitialTarget(): MagnifyTarget {
    const lastWord = [...this.layout.placed].reverse().find((placed) => placed.kind === "word");
    if (!lastWord || lastWord.kind !== "word") {
      return { afterWord: -1, line: 0, x: 0 };
    }
    const boxWidth = this.lineHeight * 1.55;
    const afterX = lastWord.x + lastWord.width + this.measure.space;
    const wraps = afterX + boxWidth > this.width;
    return {
      afterWord: Math.max(-1, this.doc.words.length - 1),
      line: lastWord.line + (wraps ? 1 : 0),
      x: wraps ? 0 : Math.round(afterX),
    };
  }

  magnifyTargeting(active: boolean): void {
    this.magnifyWebViewMode = active;
    // In WebView mode the daemon is detached, so committed ink must be present in the live DOM.
    // In Ink mode the full-screen native composition owns those same strokes.
    this.renderOverlay();
    this.props.onMagnifyTargeting?.(active);
  }

  /** Temporarily mirror native-owned committed ink into the DOM for non-persistent displays. */
  setNativeWebHandoff(active: boolean): void {
    this.nativeWebHandoff = active;
    this.renderOverlay();
    // Zoom already has a live SVG mirror. Keep it live while erasing: a one-shot
    // canvas capture would preserve deleted strokes and paint rules beyond the sheet.
    if (active && !this.magnifyPad) this.drawNativeWebHandoffFrame();
    else {
      this.sizeCanvas();
      this.clearCanvas();
    }
  }

  /** Mirror committed vectors while settings own the WebView. Retire this preview before the
   * clean native capture on close so editable ink is never baked into the content bitmap. */
  setNativeDialogHandoff(active: boolean): void {
    if (this.nativeDialogHandoff === active) return;
    this.nativeDialogHandoff = active;
    this.renderOverlay();
  }

  /** Current style for the native bridge. Keeping this on the workspace avoids guessing which
   * host-specific localStorage key owns Planning versus standalone Write preferences. */
  /** Passive debug identity/counts; no source text, model mutation or presentation. */
  getInkDiagnosticState(): { words: number; runIds: string[] } {
    return { words: this.doc.words.length, runIds: this.doc.inserts.map(insert => insert.id) };
  }

  getInkStyle(): { color: string; width: number; brushStyle?: InkStroke["brushStyle"] } {
    return { color: this.inkColor, width: this.penWidth, brushStyle: this.props.prefs.brushStyle ?? "pen" };
  }

  magnifyDismissToolSettings() { this.closePenSettings(); }

  magnifyEraserSettings() { return {diameter:this.eraserDiameter,mode:this.eraserMode,active:this.tool==="erase"}; }
  magnifyEraseLasso(points:InkPoint[],strokes:InkStroke[],line:number) {
    if(strokes.length)this.placeMagnifiedGroup(strokes,line,false);
    this.eraseLasso(points);
  }

  magnifyErasing(active: boolean): void {
    this.props.onMagnifyErasing?.(active);
  }

  magnifyEraseAt(point: InkPoint, begin: boolean, radius = 10, mode: EraseMode = "stroke"): void {
    if (begin) this.pushHistory();
    this.eraseAt(point, radius, mode);
  }

  magnifyUndoScribble(): boolean {
    if (!this.scribbleTransactions.has(this.doc)) return false;
    this.undo();
    return true;
  }

  magnifyScribble(points: InkPoint[], strokes: InkStroke[], restore: (strokes: InkStroke[]) => void): boolean {
    return !!this.eraseScribble(points, false, true, { strokes, restore });
  }

  reconcileNativeCommand(): void {
    if (this.nativeModelDirty) this.relayout();
  }

  magnifyVisualChanged(): void {
    this.props.onLayoutChanged?.();
  }

  reconcileMagnifyAfterIdle(): void {
    this.magnifyPad?.reconcileAfterIdle();
  }

  beforeMagnifyAction(action: () => void): void {
    this.afterNativeFlush(action);
  }

  applyNativeMagnifyStroke(points: InkPoint[]): void {
    this.magnifyPad?.applyNativeStroke(points);
  }

  getNativeMagnifyStrokes(): NativeInkStroke[] {
    // Full-screen magnify composition has two coordinate spaces. Convert both to window CSS
    // coordinates here: committed document ink belongs at its upper-page position, while live
    // magnifier ink belongs inside the lower viewport. Native.redrawInk can then use zero offset.
    const documentRect = this.containerEl.getBoundingClientRect();
    const padRect = this.magnifyPad?.nativeSurface().getBoundingClientRect();
    const padTop = this.root.querySelector(".magnify-pad")?.getBoundingClientRect().top;
    // CSS resize/SurfaceView capture can observe an intermediate full-height paper. The opaque
    // Zoom strip is an independent occlusion boundary, so never replay old page ink behind it,
    // even during that frame. Only presentation paths are clipped; saved vectors stay untouched.
    const documentBottom = padTop !== undefined && padTop > documentRect.top
      ? Math.min(documentRect.bottom, padTop) : documentRect.bottom;
    const documentInk = this.getNativeInkStrokes().flatMap((stroke) => {
      const margin = stroke.width / 2 + 1;
      const bounds = { left: documentRect.left + margin, top: documentRect.top + margin,
        right: documentRect.right - margin, bottom: documentBottom - margin };
      const hidden = (this.magnifyPad?.documentChromeRects() ?? []).map(r => ({
        left: r.left-margin, top: r.top-margin, right: r.right+margin, bottom: r.bottom+margin,
      }));
      const points = stroke.pts.map(point => ({ ...point,
        x: documentRect.left + point.x - this.containerEl.scrollLeft,
        y: documentRect.top + point.y - this.containerEl.scrollTop,
      }));
      return clipInkPath(points, bounds, hidden).map(pts => ({
      ...stroke,
        pts,
      }));
    });
    const padInk = (this.magnifyPad?.nativeStrokes() ?? []).flatMap((stroke) => {
      const points = stroke.points.map((point) => ({
        x: (padRect?.left ?? 0) + point.x,
        y: (padRect?.top ?? 0) + point.y,
        pressure: point.pressure ?? 0.5,
      }));
      const margin = stroke.width / 2 + 1;
      const paths = padRect && padRect.width > 0 && padRect.height > 0
        ? clipInkPath(points, { left: padRect.left+margin, top: padRect.top+margin,
            right: padRect.right-margin, bottom: padRect.bottom-margin })
        : [points];
      return paths.map(pts => ({ pts, width: stroke.width, color: stroke.color, selected: false, variableWidth: stroke.brushStyle === "brush" }));
    });
    return [...documentInk, ...padInk];
  }

  magnifyLineHeight(): number {
    return this.lineHeight;
  }

  magnifyLane(): LaneGeometry {
    return { lineHeight: this.lineHeight, pageWidth: this.width, leftX: 0 };
  }

  magnifySurface(): HTMLElement {
    return this.containerEl;
  }

  magnifySlotAt(x: number, y: number): number {
    return this.readingSlotAt(x, y);
  }

  magnifyUndo(): void {
    this.undo();
  }

  /** Commit one mapped writing burst as spatially separated word inserts and
   * one history item. This keeps a phrase written in one magnifier pass from
   * becoming one giant selection/deletion object. */
  placeMagnifiedGroup(strokes: InkStroke[], targetLine: number, recordHistory = true): void {
    if (strokes.length === 0) return;
    if (recordHistory) this.pushHistory();
    const inserts = clusterInkStrokesByWord(strokes, this.lineHeight).map((wordStrokes): Insert => {
      const raw = strokesBounds(wordStrokes);
      const normalized = normalizeInkStrokes(wordStrokes, PAD);
      const b = strokesBounds(normalized.strokes, PAD);
      return {
        id: newInsertId("mag"),
        afterWord: this.readingSlotAt(raw.x, raw.y + raw.height / 2),
        kind: "ink",
        width: b.width,
        height: Math.max(this.lineHeight, b.height),
        // the magnify mapping put the group's baseline exactly on the target rule
        baselineOffset: (targetLine + 1) * this.lineHeight - (raw.y - PAD),
        freeX: raw.x - PAD,
        freeY: raw.y - PAD,
        strokes: normalized.strokes,
      };
    });
    this.doc = { ...this.doc, inserts: [...this.doc.inserts, ...inserts] };
    this.relayout();
  }

  /** Text placement (HWR success): insert recognized words after the anchor word. */
  placeMagnifiedText(text: string, afterWord: number): void {
    const newWords = tokenizeWords(text);
    if (newWords.length === 0) return;
    this.pushHistory();
    const words = [...this.doc.words];
    const at = Math.max(0, Math.min(words.length, afterWord + 1));
    words.splice(at, 0, ...newWords);
    const inserts = this.doc.inserts.map((ins) =>
      ins.afterWord >= at ? { ...ins, afterWord: ins.afterWord + newWords.length } : ins
    );
    this.textEdited = true;
    this.doc = { ...this.doc, words, inserts };
    this.relayout();
  }

  magnifyRecognize(strokes: InkStroke[], cb: (text: string | null) => void): void {
    const hwr = this.props.hwr;
    if (!hwr || !hwr.available()) {
      cb(null); // recognition unavailable → the pad falls back to ink placement
      return;
    }
    const pts = strokes.map((s) => s.points.map((p) => [p.x, p.y, p.pressure ?? 0.5]));
    hwr.recognize(
      pts,
      { w: Math.max(1, Math.round(this.width)), h: Math.max(1, Math.round(this.layout.height)) },
      "",
      (res) => cb(res && !res.error && res.text ? res.text : null)
    );
  }

  // ---- Layout (mirrors the React `layout` useMemo) ----
  private computeLayout(): Layout {
    const doc = this.doc;
    const flow = orderedFlow(doc);
    const boxes: FlowBox[] = [];
    const extraLinesByKey = new Map<string, number>();
    let extraLines = 0;
    const breaks = new Map<number, number>();
    if (!this.textEdited) {
      let end = 0, index = 0;
      for (const match of this.view.value.matchAll(/\S+/g)) {
        const count = (this.view.value.slice(end, match.index).match(/\n/g) ?? []).length;
        if (index > 0 && count) breaks.set(index, count);
        end = match.index! + match[0].length; index++;
      }
    }
    for (const f of flow) {
      if (f.kind === "word") {
        const key = `w${f.index}`;
        boxes.push({ kind: "word", text: f.text, width: this.measure.word(f.text), key, breakBefore: breaks.get(f.index) });
        extraLinesByKey.set(key, extraLines);
      } else if (f.insert.kind === "gap") {
        if (f.insert.scopeLine !== undefined && f.insert.scopeX !== undefined) {
          continue;
        }
        boxes.push({ kind: "gap", gapId: f.insert.id, width: Math.max(f.insert.width, 2), key: f.insert.id });
        extraLinesByKey.set(f.insert.id, extraLines);
      } else if (f.insert.kind === "ink") {
        if (f.insert.freeX !== undefined && f.insert.freeY !== undefined) continue;
        if ((f.insert.flowAdvance ?? 0) > 0) {
          const advanceKey = `advance-${f.insert.id}`;
          boxes.push({
            kind: "advance",
            advanceId: advanceKey,
            width: f.insert.flowAdvance ?? 0,
            key: advanceKey,
          });
          extraLinesByKey.set(advanceKey, extraLines);
        }
        const b = strokesBounds(f.insert.strokes, PAD);
        const inkWidth = Math.max(2, f.insert.width, b.width);
        boxes.push({ kind: "ink", runId: f.insert.id, width: inkWidth, key: f.insert.id });
        extraLinesByKey.set(f.insert.id, extraLines);
      } else {
        if (f.insert.scopeLine === undefined) {
          extraLines += Math.max(0, f.insert.lines ?? 0);
        }
      }
    }
    const lineWidth = Math.max(40, this.width - 4);
    const base = reflow(
      boxes,
      lineWidth,
      this.measure.space,
      0,
      Math.max(this.measure.space, this.lineHeight * 0.4)
    );
    let placed = base.placed.map((p) => ({
      ...p,
      line: p.line + (extraLinesByKey.get(p.key ?? "") ?? 0),
    }));
    const savedSourceWords=doc.sourceWordPositions??(!this.textEdited?this.props.existingSourceWords:undefined);
    if (savedSourceWords?.length === doc.words.length && savedSourceWords.every((w,i)=>w.text===doc.words[i]) &&
        savedSourceWords.every((word,index,words)=>{
          const end=word.x+this.measure.word(word.text),next=words[index+1];
          return end<=lineWidth&&(!next||next.y!==word.y||end+this.measure.space<=next.x);
        })) {
      placed=placed.map(p=>{
        if(p.kind!=='word'||!p.key?.startsWith('w'))return p;
        const word=savedSourceWords[Number(p.key.slice(1))];
        return word?{...p,x:word.x,line:Math.round(word.y/this.lineHeight)}:p;
      });
    }
    // An annotation is a group of ordinary word boxes, not a floating bitmap. Include it
    // before scoped transforms so ink, typed words and mixed line crossings use one algorithm.
    for (const box of doc.textBoxes ?? []) {
      const measure=this.boxMeasure(box);
      const width = Math.max(40, Math.min(box.width, lineWidth));
      const x = Math.max(0, Math.min(box.x, lineWidth - width));
      const words = box.checkbox ? [{text:box.text, x:Math.max(0,lineWidth-44), y:box.words?.[0]?.y ?? box.y}]
        : box.words ?? placeBoxWords(box.text, x, box.y, width, this.lineHeight, measure.word, measure.space,(value,start)=>this.styledMeasure(box,value,start));
      words.forEach((word, index) => {
        const wordWidth = this.styledMeasure(box,word.text,word.textStart??0);
        const overflow = word.x + wordWidth > lineWidth;
        placed.push({ kind: "word", text: word.text, width: wordWidth, key: `t:${box.id}:${index}`,
          textBoxId: box.id, textWordIndex: index, breakBefore: word.breakBefore, x: overflow ? 0 : word.x,
          line: Math.max(0, Math.round(word.y / this.lineHeight)) + (overflow ? 1 : 0) });
      });
    }
    const inkPlacements = new Map<string, { x: number; y: number }>();
    for (const p of placed) {
      if (p.kind !== "ink") continue;
      const ins = doc.inserts.find((i) => i.id === p.runId);
      if (!ins || ins.kind !== "ink") continue;
      const b = strokesBounds(ins.strokes, PAD);
      const y = packedInkTop(p.line, this.lineHeight, ins.baselineOffset, b.height);
      inkPlacements.set(ins.id, { x: p.x, y });
    }
    for (const ins of doc.inserts) {
      if (ins.kind === "ink" && ins.freeX !== undefined && ins.freeY !== undefined) {
        inkPlacements.set(ins.id, { x: ins.freeX, y: ins.freeY });
      }
    }

    // A dropped text box inserts into the page's word flow. Its collision footprint uses
    // actual text, not the editor's rectangular background; descenders keep their owning lane.
    const admittedTextBoxes = new Set<string>();
    for (const textBox of doc.textBoxes ?? []) {
      // Explicit word coordinates are authoritative after a move/save. Re-running
      // text insertion here can separate selected text from the ink in its group.
      // Only a new/edited paragraph without word placements enters insertion flow.
      if (textBox.words) { admittedTextBoxes.add(textBox.id); continue; }
      const visual: (VisualItem & { textBoxId?: string; breakBefore?: number })[] = [];
      placed.forEach((item, index) => {
        if (item.kind === "word" || item.kind === "ink") visual.push({
          placedIndex: index, inkId: item.kind === "ink" ? item.runId : undefined,
          textBoxId: item.kind === "word" ? item.textBoxId : undefined,
          breakBefore: item.kind === "word" ? item.breakBefore : undefined,
          kind: item.kind, line: item.line, x: item.x, width: item.width, order: index,
        });
      });
      for (const ins of doc.inserts) {
        if (ins.kind !== "ink" || ins.freeX === undefined || ins.freeY === undefined) continue;
        const position = inkPlacements.get(ins.id);
        if (!position) continue;
        const bounds = strokesBounds(ins.strokes, PAD);
        visual.push({ inkId: ins.id, kind: "ink", x: position.x, width: bounds.width,
          line: freeInkLaneIndex(position.y, bounds.height, this.lineHeight), order: visual.length });
      }
      const incoming = visual.filter(item => item.textBoxId === textBox.id);
      // An empty active draft still needs a small writing slot while the Android IME is open.
      if (!incoming.length && this.textPromptEl?.parentElement?.dataset.textBox === textBox.id) {
        incoming.push({ kind: "word", textBoxId: textBox.id, x: textBox.x,
          line: Math.round(textBox.y / this.lineHeight), width: textBox.width, order: visual.length });
      }
      const spacing=(a:VisualItem & {textBoxId?:string},b:VisualItem & {textBoxId?:string})=>
        a.kind==='ink'||b.kind==='ink'?Math.max(this.measure.space,this.lineHeight*.25):this.measure.space+(a.textBoxId!==b.textBoxId?4:0);
      const existing=visual.filter(item=>!item.textBoxId||admittedTextBoxes.has(item.textBoxId));
      const plan = insertTextFlow(incoming, existing, lineWidth, spacing,
        incoming.some(item => item.placedIndex !== undefined));
      for (const { item, line, x } of plan) {
        if (item.placedIndex !== undefined) placed[item.placedIndex] = { ...placed[item.placedIndex], line, x };
        else if (item.inkId) {
          const current = inkPlacements.get(item.inkId);
          if (current) inkPlacements.set(item.inkId, { x, y: current.y + (line - item.line) * this.lineHeight });
        }
      }
      admittedTextBoxes.add(textBox.id);
    }

    const taskOwners = new Map<string, number>();
    for (const box of doc.textBoxes ?? []) {
      if (box.semantic?.role !== "text" || taskOwners.has(box.semantic.id)) continue;
      const first = placed.find(item => item.kind === "word" && item.textBoxId === box.id);
      if (first) taskOwners.set(box.semantic.id, first.line);
    }
    placed = placed.map(item => {
      if (item.kind !== "word" || !item.textBoxId) return item;
      const binding = doc.textBoxes?.find(box => box.id === item.textBoxId)?.semantic;
      const row = binding?.role === "checkbox" ? taskOwners.get(binding.id) : undefined;
      return row === undefined ? item : { ...item, line: row };
    });

    // Packed ink follows the final box placement after every scoped gap.
    // Free ink already has an explicit placement updated in the loop above.
    for (const box of placed) {
      if (box.kind !== "ink") continue;
      const ins = doc.inserts.find((candidate) => candidate.id === box.runId);
      if (!ins || ins.kind !== "ink" || ins.freeX !== undefined || ins.freeY !== undefined) continue;
      const bounds = strokesBounds(ins.strokes, PAD);
      inkPlacements.set(ins.id, {
        x: box.x,
        y: packedInkTop(box.line, this.lineHeight, ins.baselineOffset, bounds.height),
      });
    }

    const slots: { afterWord: number; x: number; line: number }[] = [];
    let firstWord: PlacedBox | null = null;
    for (const p of placed) {
      if (p.kind === "word" && !p.textBoxId) {
        const idx = Number((p.key ?? "w-1").slice(1));
        slots.push({ afterWord: idx, x: p.x + p.width, line: p.line });
        if (firstWord === null) firstWord = p;
      }
    }
    slots.push({ afterWord: -1, x: firstWord ? firstWord.x : 0, line: firstWord ? firstWord.line : 0 });

    const lineMarkers = doc.inserts
      .filter((i) => i.kind === "line")
      .map((ins) => {
        const lines = ins.lines ?? 0;
        if (ins.scopeLine !== undefined) {
          // The flat caret is the live edge of the opened space. As the pen
          // drags down, keep it immediately above the content being moved.
          return {
            id: ins.id,
            top: Math.max(0, (ins.scopeLine + lines) * this.lineHeight),
            lines,
          };
        }
        const nextWord = placed.find(
          (p) => p.kind === "word" && Number((p.key ?? "w-1").slice(1)) > ins.afterWord
        );
        const fallbackLine = (slots.find((s) => s.afterWord === ins.afterWord)?.line ?? 0) + 1 + lines;
        const nextLine = nextWord?.line ?? fallbackLine;
        return { id: ins.id, top: Math.max(0, (nextLine - lines) * this.lineHeight), lines };
      });

    let inkBottom = 0;
    for (const ins of doc.inserts) {
      if (ins.kind === "ink" && ins.strokes.length) {
        const b = strokesBounds(ins.strokes, PAD);
        const placement = inkPlacements.get(ins.id);
        if (placement) inkBottom = Math.max(inkBottom, placement.y + b.height);
      }
    }
    const lineCount = placed.reduce((max, p) => Math.max(max, p.line + 1), 1);
    const height = Math.max(
      this.props.prefs.defaultWritingLines * this.lineHeight,
      lineCount * this.lineHeight,
      inkBottom + 4,
      ...(doc.pageObjects ?? []).map(o => o.y + o.height + 24),
      ...(doc.textBoxes ?? []).map((b) => b.y + Math.max(2, wrapBoxText(b.text, Math.max(1, Math.min(b.width, this.width) - 24), this.boxMeasure(b).word).length) * b.size * 1.4 + 72)
    );
    return { placed, height, slots, inkPlacements, lineMarkers };
  }

  private relayout() {
    this.layout = this.computeLayout();
    this.nativeModelDirty = false;
    dlog("layout:flow", {
      width: Math.round(this.width),
      items: this.layout.placed.map((p) => ({
        id: p.key,
        kind: p.kind,
        line: p.line,
        x: Math.round(p.x),
        width: Math.round(p.width),
      })),
    });
    this.sizeCanvas();
    this.render();
  }

  private nearestSlot(x: number, y: number): number {
    let best = -1;
    let bestDist = Infinity;
    for (const s of this.layout.slots) {
      const dx = x - s.x;
      const dy = y - (s.line * this.lineHeight + this.lineHeight / 2);
      const d = dx * dx + dy * dy * 4;
      if (d < bestDist) {
        bestDist = d;
        best = s.afterWord;
      }
    }
    return best;
  }

  private ruledLineAt(y: number): number {
    return Math.max(0, Math.floor(y / this.lineHeight));
  }

  private readingSlotAt(x: number, y: number): number {
    const line = Math.max(0, Math.floor(y / this.lineHeight));
    let best = -1;
    let bestKey = -Infinity;
    for (const slot of this.layout.slots) {
      const key = slot.line * 100000 + slot.x;
      const isBefore = slot.line < line || (slot.line === line && slot.x <= x);
      if (isBefore && key > bestKey) {
        bestKey = key;
        best = slot.afterWord;
      }
    }
    return best;
  }

  private lineAnchorForY(y: number): number {
    const boundary = Math.max(0, Math.round(y / this.lineHeight));
    let afterWord = -1;
    for (const p of this.layout.placed) {
      if (p.kind !== "word" || p.textBoxId || p.line >= boundary) continue;
      const index = Number((p.key ?? "w-1").slice(1));
      afterWord = Math.max(afterWord, index);
    }
    return afterWord;
  }

  private sizeCanvas() {
    const pixelWidth = Math.round(this.width * this.dpr);
    const pixelHeight = Math.round(this.layout.height * this.dpr);
    const cssWidth = `${this.width}px`;
    const cssHeight = `${this.layout.height}px`;
    // Assigning either canvas dimension destroys its drawing state and reallocates the GPU backing
    // store. Relayout runs after every completed stroke, but the ruled page size usually has not
    // changed; keep that common path allocation-free.
    if (this.canvasEl.width !== pixelWidth) this.canvasEl.width = pixelWidth;
    if (this.canvasEl.height !== pixelHeight) this.canvasEl.height = pixelHeight;
    if (this.canvasEl.style.width !== cssWidth) this.canvasEl.style.width = cssWidth;
    if (this.canvasEl.style.height !== cssHeight) this.canvasEl.style.height = cssHeight;
    dlog("layout:size", { width: this.width, height: Math.round(this.layout.height) });
  }

  private clearCanvas() {
    const ctx = this.canvasEl.getContext("2d");
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.layout.height);
    }
    this.liveCanvasBounds = null;
  }

  /** Clear only the transient wet-ink footprint. Clearing the complete high-DPI Planning page for
   * every pointer sample made the Mali driver process a full-surface GPU operation even though the
   * canvas contains only the current stroke. */
  private clearLiveCanvas() {
    const bounds = this.liveCanvasBounds;
    if (!bounds) return;
    const ctx = this.canvasEl.getContext("2d");
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
    this.liveCanvasBounds = null;
  }

  /**
   * Paint the complete transient Standard-display page on the existing HTML canvas.
   *
   * A normal Android SurfaceView cannot provide the Bigme panel's retained pixels. Rendering only
   * SVG inserts also proved insufficient on device because the latest daemon batch is ingested
   * without a DOM relayout. This frame is rebuilt after that flush: ruled paper plus the canonical
   * committed vectors, with the live toolbar left in ordinary DOM above/outside this canvas.
   */
  private drawNativeWebHandoffFrame() {
    const cssHeight = Math.max(this.layout.height, this.containerEl.clientHeight);
    this.canvasEl.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvasEl.height = Math.max(1, Math.round(cssHeight * this.dpr));
    this.canvasEl.style.width = `${this.width}px`;
    this.canvasEl.style.height = `${cssHeight}px`;
    const ctx = this.canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, cssHeight);

    // Draw the rules explicitly instead of depending on a compositor repaint of the CSS gradient.
    // These values intentionally match InkSurfaceView.drawDisplayedStrokes' snapshot rules. Any
    // colour or half-pixel difference becomes a visible pulse when a Standard SurfaceView hides.
    ctx.beginPath();
    for (let y = this.lineHeight; y < cssHeight; y += this.lineHeight) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.strokeStyle = "#909090";
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const stroke of this.getNativeInkStrokes()) {
      if (stroke.pts.length === 0) continue;
      // The native display path is a fixed-width, round-capped Android Canvas path. Reusing the
      // pressure-sensitive live-Web geometry here made committed letters subtly change weight and
      // outline during toolbar handoff, which looked like the writing itself flashing.
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const first = stroke.pts[0];
      if (stroke.pts.length === 1) {
        ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < stroke.pts.length; index += 1) {
        const point = stroke.pts[index];
        ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    }
  }

  private drawLiveStroke(points: InkPoint[], stroke: InkStroke) {
    if (this.nativeInkActive) return; // daemon paints live ink itself
    const ctx = this.canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.clearLiveCanvas();
    fillStroke(ctx, points, stroke.width, stroke.color, stroke.brushStyle);
    const bounds = boundsOfPoints(points);
    const pad = Math.max(3, stroke.width * 2);
    this.liveCanvasBounds = {
      x: Math.max(0, bounds.x - pad),
      y: Math.max(0, bounds.y - pad),
      width: Math.min(this.width, bounds.x + bounds.width + pad) - Math.max(0, bounds.x - pad),
      height:
        Math.min(this.layout.height, bounds.y + bounds.height + pad) -
        Math.max(0, bounds.y - pad),
    };
  }

  private pushHistory() {
    this.historyStack.push(this.doc);
    this.redoStack = [];
  }

  private undo = () => {
    this.settleSpacingGesture(true);
    const prev = this.historyStack.pop();
    if (prev) {
      this.redoStack.push(this.doc);
      this.doc = prev;
      this.clearCanvas();
      this.relayout();
    }
  };

  private redo = () => {
    this.settleSpacingGesture(true);
    const next = this.redoStack.pop();
    if (next) {
      this.historyStack.push(this.doc);
      this.doc = next;
      this.relayout();
    }
  };

  private localPoint(e: PointerEvent): InkPoint {
    const el = this.containerEl;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const y = e.clientY - rect.top + el.scrollTop;
    if (this.logEl) {
      this.logEl.textContent = `${e.pointerType} raw(${e.clientX.toFixed(0)},${e.clientY.toFixed(
        0
      )}) → local(${x.toFixed(0)},${y.toFixed(0)}) p=${(e.pressure || 0).toFixed(2)} [${this.tool}]`;
    }
    return { x, y, t: e.timeStamp || performance.now(), pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY };
  }

  private inkVisualBounds(ins: Insert): (Bounds & { localX: number; localY: number }) | null {
    if (ins.kind !== "ink" || ins.strokes.length === 0) return null;
    const placement =
      this.layout.inkPlacements.get(ins.id) ??
      (ins.freeX !== undefined && ins.freeY !== undefined ? { x: ins.freeX, y: ins.freeY } : undefined);
    if (!placement) return null;
    const local = strokesBounds(ins.strokes, PAD);
    return { x: placement.x, y: placement.y, width: local.width, height: local.height, localX: local.x, localY: local.y };
  }

  private inkRunAt(x: number, y: number): string | null {
    let hit: string | null = null;
    for (const ins of this.doc.inserts) {
      if (ins.kind !== "ink" || ins.strokes.length === 0) continue;
      const b = this.inkVisualBounds(ins);
      if (!b) continue;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) hit = ins.id;
    }
    return hit;
  }

  /** Convert one legacy/magnified phrase-sized insert into independently
   * selectable word-sized inserts without changing their visible positions. */
  private splitInkRunIntoWords(id: string): string[] {
    const index = this.doc.inserts.findIndex((insert) => insert.id === id);
    const ins = this.doc.inserts[index];
    if (!ins || ins.kind !== "ink") return [];
    const placement = this.layout.inkPlacements.get(ins.id);
    if (!placement) return [id];

    const overall = strokesBounds(ins.strokes, PAD);
    const groups = clusterInkStrokesByWord(ins.strokes, this.lineHeight, placement.y - overall.y);
    if (groups.length < 2) return [id];
    const wasFree = ins.freeX !== undefined && ins.freeY !== undefined;
    const originalBaseline =
      placement.y +
      (ins.baselineOffset ?? ruledBaselineOffset(placement.y, overall.height, this.lineHeight));
    const pieces = groups.map((strokes, groupIndex) => {
      const subset = strokesBounds(strokes, PAD);
      const visualX = placement.x + (subset.x - overall.x);
      const visualY = placement.y + (subset.y - overall.y);
      const normalized = normalizeInkStrokes(strokes, PAD);
      const bounds = strokesBounds(normalized.strokes, PAD);
      return { strokes: normalized.strokes, bounds, visualX, visualY, groupIndex };
    });
    const multipleLanes = new Set(pieces.map(piece => ruledLineIndex(piece.visualY, piece.bounds.height, this.lineHeight))).size > 1;
    const wordInserts = pieces.map((piece, pieceIndex): Insert => {
      const common: Insert = {
        id: pieceIndex === 0 ? ins.id : newInsertId("ink-word"),
        afterWord: wasFree
          ? this.readingSlotAt(piece.visualX, piece.visualY + piece.bounds.height / 2)
          : ins.afterWord,
        kind: "ink",
        width: piece.bounds.width,
        height: Math.max(this.lineHeight, piece.bounds.height),
        baselineOffset: multipleLanes ? ruledBaselineOffset(piece.visualY, piece.bounds.height, this.lineHeight) : originalBaseline - piece.visualY,
        strokes: piece.strokes,
      };
      if (wasFree || multipleLanes) {
        return { ...common, freeX: piece.visualX, freeY: piece.visualY };
      }
      const previous = pieces[pieceIndex - 1];
      const flowAdvance =
        pieceIndex === 0
          ? ins.flowAdvance
          : Math.max(0, piece.visualX - (previous.visualX + previous.bounds.width));
      return {
        ...common,
        ...(flowAdvance !== undefined && flowAdvance > 0 ? { flowAdvance } : {}),
      };
    });
    this.doc = {
      ...this.doc,
      inserts: [
        ...this.doc.inserts.slice(0, index),
        ...wordInserts,
        ...this.doc.inserts.slice(index + 1),
      ],
    };
    this.relayout();
    return wordInserts.map((insert) => insert.id);
  }

  private inkWordAt(x: number, y: number): string | null {
    const hit = this.inkRunAt(x, y);
    if (!hit) return null;
    if (this.splitInkRunIntoWords(hit).length < 2) return hit;
    // Re-hit the unchanged visual point against the new word-sized boxes. A
    // tap in genuine whitespace should select nothing rather than the phrase.
    return this.inkRunAt(x, y);
  }

  private activeSpacingInsert(kind: "gap" | "line"): Insert | undefined {
    const activeId = this.activeSpacingInsertIds[kind];
    const active = activeId
      ? this.doc.inserts.find((insert) => insert.id === activeId && insert.kind === kind)
      : undefined;
    if (active) return active;
    const latest = [...this.doc.inserts].reverse().find((insert) => insert.kind === kind);
    if (latest) this.activeSpacingInsertIds[kind] = latest.id;
    return latest;
  }

  /** The horizontal Blank Lines handle is drawn on the moving edge, not on
   * the original boundary stored by the spacer. Starting near that edge must
   * reopen the spacer that produced it so an upward drag closes space. */
  private lineHandleAt(y: number): Insert | undefined {
    const active = this.activeSpacingInsert("line");
    if (!active) return undefined;
    const marker = this.layout.lineMarkers.find((candidate) => candidate.id === active.id);
    return marker && Math.abs(marker.top - y) <= 8 ? active : undefined;
  }

  /** Insert Space gets the same reusable-handle behavior at the right edge of
   * its active gap. */
  private gapHandleAt(x: number, y: number): Insert | undefined {
    const active = this.activeSpacingInsert("gap");
    if (
      !active ||
      active.scopeX === undefined ||
      active.scopeLine === undefined ||
      this.ruledLineAt(y) !== active.scopeLine
    ) {
      return undefined;
    }
    const edge = Math.max(0, active.scopeX + active.width);
    return Math.abs(edge - x) <= 8 ? active : undefined;
  }

  // ---- Pointer handling: pen (and mouse for dev) writes; touch scrolls. ----
  /** Keep one owner for the entire stroke that dismisses a tool popover. */
  private setSettingsDismissGesture(active: boolean) {
    if (this.settingsDismissGesture === active) return;
    this.settingsDismissGesture = active;
    this.nativeInkActive = !active && !!this.props.native && (this.tool === "write" || this.usesNativeSelectionPen) && !this.keyboard;
    this.props.onPageGestureChange?.(active);
  }

  /** Daemon batches can bypass DOM pen events. Never rely on the web gesture owner alone. */
  noteNativePenActivity(): void {
    this.touchScroll = null;
  }

  private observePenActivity = (e: PointerEvent) => {
    if (e.pointerType !== "pen") return;
    this.penContact = e.type === "pointerdown";
    if(e.type==="pointerup"||e.type==="pointercancel")this.hideEraserTip();
    this.touchScroll = null;
  };

  private hideEraserTip = () => { if(this.eraserTip)this.eraserTip.hidden=true; };

  /** A transparent tip marker, not ink: never save or include it in native page captures.
   * Fixed coordinates keep it aligned when erasing relayouts/rebuilds the ruled surface. */
  private showEraserTip(e:PointerEvent) {
    const barrel=(e.buttons&34)!==0;
    if(this.magnifyPad || e.pointerType==="touch" || (this.tool!=="erase"&&!barrel) || this.eraserMode==="lasso") {this.hideEraserTip();return;}
    if(!this.eraserTip){this.eraserTip=document.createElement("div");this.eraserTip.className="rw-eraser-tip";this.eraserTip.setAttribute("aria-hidden","true");this.root.append(this.eraserTip);}
    const rect=this.containerEl.getBoundingClientRect();
    this.eraserTip.hidden=e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom;
    this.eraserTip.style.left=`${e.clientX}px`;this.eraserTip.style.top=`${e.clientY}px`;
    this.eraserTip.style.width=this.eraserTip.style.height=`${this.eraserDiameter}px`;
  }

  private typedWordAt(x:number,y:number) {
    return [...this.layout.placed].reverse().find((p):p is PlacedBox & {kind:'word';textBoxId:string;textWordIndex:number} =>
      p.kind==='word' && !!p.textBoxId && p.textWordIndex!==undefined &&
      !this.doc.textBoxes?.find(b=>b.id===p.textBoxId)?.checkbox &&
      x>=p.x && x<=p.x+p.width && y>=p.line*this.lineHeight && y<(p.line+1)*this.lineHeight);
  }
  private typedWordIndices(boxId:string,index:number):number[] {
    const box=this.doc.textBoxes?.find(b=>b.id===boxId);if(!box)return [index];
    const words=withWordRanges(box.text,this.measuredBoxWords(box));const offset=words[index]?.textStart;
    const token=offset===undefined?undefined:Array.from(box.text.matchAll(/\S+/gu)).find(m=>m.index!<=offset && offset<m.index!+m[0].length);
    if(!token)return [index];
    return words.flatMap((w,i)=>w.textStart!==undefined && w.textStart>=token.index! && w.textStart<token.index!+token[0].length?[i]:[]);
  }
  private selectTypedWord(boxId: string, index: number) {
    this.selectedInsertId = null;
    this.selectedTextWord = {boxId,index};
    this.selectedTextWords = new Map([[boxId,new Set(this.typedWordIndices(boxId,index))]]);
  }

  private selectedBlockAt(x: number, y: number): boolean {
    const word = this.typedWordAt(x,y);
    const bounds=this.selectionInteraction?this.getSelectedBlockBounds():null;
    return !!(bounds && x>=bounds.x && x<=bounds.x+bounds.width && y>=bounds.y && y<=bounds.y+bounds.height) ||
      !!(word && this.selectedTextWords.get(word.textBoxId)?.has(word.textWordIndex)) ||
      !!(this.selectedInsertId && this.inkRunAt(x,y) === this.selectedInsertId);
  }

  /** Visible word rectangles also bound native snapshots when a selection contains only text. */
  getSelectedBlockBounds(): Bounds | null {
    const rects: Bounds[] = [];
    for (const word of this.layout.placed) {
      if(word.kind==='word' && word.textBoxId && this.selectedTextWords.get(word.textBoxId)?.has(word.textWordIndex!))
        rects.push({x:word.x,y:word.line*this.lineHeight,width:word.width,height:this.lineHeight});
    }
    const ink=this.doc.inserts.find(i=>i.id===this.selectedInsertId);
    const b=ink?.kind==='ink'?this.inkVisualBounds(ink):null;
    if(b)rects.push(b);
    return rects.length?rects.reduce((a,b)=>boundsUnion(a,b)):null;
  }

  private previewSelectedBlocks(dx: number, dy: number) {
    const bounds = this.getSelectedBlockBounds();
    if (!bounds) return;
    ({ dx, dy } = constrainTranslation(bounds, dx, dy, this.spatialMetrics()));
    this.containerEl.querySelectorAll<SVGElement | HTMLElement>('.rw-ink.selected,.rw-selection-box').forEach(node=>node.style.transform=`translate(${dx}px,${dy}px)`);
    this.containerEl.querySelectorAll<HTMLElement>('[data-text-box-word]').forEach(node=>{
      if(this.selectedTextWords.get(node.dataset.textBoxWord!)?.has(Number(node.dataset.textWordIndex)))
        node.style.transform=`translate(${dx}px,${dy}px)`;
    });
  }

  private moveSelectedBlocks(dx: number, dy: number) {
    const bounds=this.getSelectedBlockBounds();if(!bounds)return;
    ({ dx, dy } = constrainTranslation(bounds, dx, dy, this.spatialMetrics()));
    if(!dx&&!dy)return;
    this.pushHistory();
    const textBoxes=this.placedTextBoxes().map(box=>{
      const indices=this.selectedTextWords.get(box.id);
      const words=box.words?.map((w,i)=>indices?.has(i)?{...w,x:w.x+dx,y:w.y+dy}:w);
      return {...box,words,x:words?.length?Math.min(...words.map(w=>w.x)):box.x,
        y:words?.length?Math.min(...words.map(w=>w.y)):box.y};
    });
    const inserts=this.doc.inserts.map(ins=>{
      if(ins.id!==this.selectedInsertId||ins.kind!=='ink')return ins;
      const visual=this.inkVisualBounds(ins);if(!visual)return ins;
      return {...ins,freeX:visual.x+dx,freeY:visual.y+dy,
        afterWord:this.readingSlotAt(visual.x+dx,visual.y+dy+visual.height/2)};
    });
    this.doc={...this.doc,textBoxes:synchronizeTaskControls(textBoxes),inserts};this.relayout();this.props.onLayoutChanged?.();
  }

  /** Word units use exact text ranges, including fragments of a long wrapped token. */
  private moveTypedWord(boxId:string,index:number,x:number,y:number) {
    const word=this.textBoxWords(boxId).find(w=>w.textWordIndex===index);if(!word)return;
    if(!this.selectedTextWords.get(boxId)?.has(index))this.selectTypedWord(boxId,index);
    this.moveSelectedBlocks(x-word.x,y-word.line*this.lineHeight);
  }
  private onPointerDown = (e: PointerEvent) => {
    this.showEraserTip(e);
    const handlerStarted = performance.now();
    if (this.keyboard) return;
    if (this.penSettingsEl &&
        !(e.target as Element)?.closest("button,input,textarea,[role=dialog]")) {
      // Keep the transient WebView owner through this whole outside-page gesture. Closing the
      // settings must not start a daemon attach in the middle of the pen's first resumed stroke.
      this.setSettingsDismissGesture(e.pointerType !== "touch" && !!this.props.native);
      this.closePenSettings();
      // A finger tap dismisses only; never seed a page swipe from the same contact.
      // Pen input continues below under the existing transient WebView stroke owner.
      if (e.pointerType === "touch") return;
    }
    if (e.pointerType === "touch") {
      this.touchContacts.add(e.pointerId);
      const allowed = !this.penContact && this.touchContacts.size === 1;
      if (!allowed) this.touchScroll = null;
      if (this.gesture.pointerId === null && this.touchScroll === null && allowed) {
        if ((e.target as Element)?.closest("button,textarea,input,[role=dialog]") || this.textPromptEl || this.penSettingsEl || this.root.querySelector('[role="dialog"]')) return;
        this.touchScroll = { id: e.pointerId, lastY: e.clientY, startX: e.clientX, startY: e.clientY, started: handlerStarted, axis: null };
      }
      return;
    }
    // Native writing and both lassos use the daemon. Spacing/stroke-erase/text tools
    // use the detached WebView path. Never process one gesture in both owners.
    if (this.tool === "objects") {
      if ((e.target as Element)?.closest("button,input,textarea,[data-page-object]")) return;
      const p=this.localPoint(e);this.objectDraft={id:e.pointerId,start:p,points:[p]};
      this.previewObject();this.containerEl.setPointerCapture?.(e.pointerId);return;
    }
    if (this.nativeInkActive) return;
    if (this.gesture.pointerId !== null) {
      // A new pen contact proves the old pointer ended. Recover from a missing
      // WebView pointerup before accepting the new caret placement.
      this.finishGesture({
        pointerId: this.gesture.pointerId,
        type: "pointerrestart",
      } as PointerEvent);
    }
    if (this.gesture.pointerId !== null) return;
    const p = this.localPoint(e);
    this.gesture.pointerId = e.pointerId;
    this.gesture.startX = e.clientX;
    this.gesture.startY = e.clientY;
    this.gesture.lastMove = { x: p.x, y: p.y };
    try {
      this.containerEl.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail if the pointer lifted before this handler ran; the
      // gesture still proceeds with uncaptured events.
    }

    const barrelErase = (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0;
    const active: Tool = barrelErase ? "erase" : this.tool;
    this.gesture.mode = active;

    if (active === "select") {
      this.selectedObjectId = null;
      if(this.selectedBlockAt(p.x,p.y)) {
        this.blockDrag={start:p,last:p};return;
      }
      this.selectedTextWords.clear();
      // A lasso group stays atomic when dragged; ordinary taps can still select a word.
      const hit = this.inkRunAt(p.x, p.y) === this.selectedInsertId
        ? this.selectedInsertId : this.inkWordAt(p.x, p.y);
      const textWord=!hit?this.typedWordAt(p.x,p.y):undefined;
      if(textWord){
        this.selectTypedWord(textWord.textBoxId,textWord.textWordIndex);
        this.textWordDrag={pointerId:e.pointerId,boxId:textWord.textBoxId,index:textWord.textWordIndex,indices:this.typedWordIndices(textWord.textBoxId,textWord.textWordIndex),start:p,origin:{x:textWord.x,y:textWord.line*this.lineHeight},last:p};
        this.renderOverlay();this.updateToolbarState();return;
      }
      this.selectedTextWord=null;
      if (!hit && !this.directSelection) this.selectionLassoPoints = [p];
      dlog("select:down", { hit, x: Math.round(p.x), y: Math.round(p.y) });
      this.selectedInsertId = hit;
      this.gesture.insertId = hit;
      const selected = hit ? this.doc.inserts.find((ins) => ins.id === hit) : undefined;
      const visual = selected?.kind === "ink" ? this.inkVisualBounds(selected) : null;
      this.gesture.selectOrigin = visual ? { x: visual.x, y: visual.y } : null;
      this.gesture.selectPosition = visual ? { x: visual.x, y: visual.y } : null;
      this.gesture.selectMoved = false;
      if (hit) this.pushHistory();
      this.updateToolbarState();
      this.renderOverlay();
      if (this.selectionLassoPoints.length) this.drawEraseLasso();
      return;
    }
    if (active === "erase") {
      if (this.eraserMode === "lasso" && !barrelErase) {
        this.eraseLassoPoints = [p];
        this.drawEraseLasso();
      } else {
        this.pushHistory();
        this.eraseAt(p,this.eraserDiameter/2,this.eraserMode==="pixel"?"pixel":"stroke");
      }
      return;
    }
    if (active === "insert") {
      const handle = this.gapHandleAt(p.x, p.y);
      const afterWord = this.nearestSlot(p.x, p.y);
      const line = handle?.scopeLine ?? this.ruledLineAt(p.y);
      const started = this.startGap(afterWord, line, p.x, handle?.id);
      this.insertionGuide = {
        x: started.scopeX + started.prevWidth,
        top: line * this.lineHeight,
      };
      this.gesture.insertId = started.id;
      this.gesture.gapX = started.scopeX;
      this.gesture.gapLine = line;
      this.gesture.prevWidth = started.prevWidth;
      this.pendingGapWidth = started.prevWidth;
      return;
    }
    if (active === "lines") {
      const handle = this.lineHandleAt(p.y);
      const boundary = handle?.scopeLine ?? Math.max(0, Math.round(p.y / this.lineHeight));
      const afterWord = handle?.afterWord ?? this.lineAnchorForY(p.y);
      const started = this.startLines(afterWord, boundary, handle?.id);
      this.gesture.insertId = started.id;
      this.gesture.gapLine = boundary;
      this.gesture.prevLines = started.prevLines;
      this.pendingLineCount = started.prevLines;
      return;
    }

    // Every stroke starts in a temporary run; word membership is decided on
    // pointer-up from the completed stroke's ruled lane (see finishGesture).
    this.pushHistory();
    const targetId = newInsertId("ink");
    const now = performance.now();
    const afterWord = this.nearestSlot(p.x, p.y);
    this.doc = {
      ...this.doc,
      inserts: [
        ...this.doc.inserts,
        { id: targetId, afterWord, kind: "ink", width: 0, height: this.lineHeight, strokes: [], freeX: p.x - PAD, freeY: p.y - PAD },
      ],
    };
    this.gesture.insertId = targetId;
    this.gesture.liveStroke = {
      id: `s-${now.toFixed(0)}`,
      tool: "pen",
      brushStyle: this.props.prefs.brushStyle ?? "pen",
      color: this.inkColor,
      width: this.penWidth,
      points: [p],
      bounds: boundsOfPoints([p]),
    };
    // Paint contact before any DOM/model relayout. The empty temporary insert does not affect the
    // visible page until pen-up, and rebuilding the full ruled overlay here made the first mark
    // wait behind style/layout work—most noticeably after the WebView had been idle.
    this.drawLiveStroke(this.gesture.liveStroke.points, this.gesture.liveStroke);
    // Prime delegated presentation at contact rather than waiting for the first move event. The
    // following hardware samples can then extend the trail through Chromium's compositor at once.
    if (this.delegatedInkPresenter) {
      this.delegatedInkPresenter.updateInkTrailStartPoint(e, {
        color: this.gesture.liveStroke.color,
        diameter: Math.max(
          1,
          this.gesture.liveStroke.width * (0.5 + Math.max(0, e.pressure || 0.5))
        ),
      });
    }
    const drawFinished = performance.now();
    const strokeNumber = ++this.inkStrokeCount;
    const idleMs = this.lastInkEndMs > 0 ? handlerStarted - this.lastInkEndMs : -1;
    const rawEventAge = handlerStarted - e.timeStamp;
    const eventAgeMs = Math.abs(rawEventAge) < 60_000 ? Math.max(0, rawEventAge) : -1;
    requestAnimationFrame((frameTime) => {
      const frameMs = Math.max(0, frameTime - handlerStarted);
      if (strokeNumber <= 10 || idleMs >= 1_000 || eventAgeMs >= 20 || frameMs >= 30) {
        console.info(
          `DIAG [kalamos-ink] PEN_DOWN #${strokeNumber}` +
            ` idle=${idleMs < 0 ? "first" : idleMs.toFixed(1)}ms` +
            ` dispatch=${eventAgeMs < 0 ? "unknown" : eventAgeMs.toFixed(1)}ms` +
            ` draw=${(drawFinished - handlerStarted).toFixed(1)}ms` +
            ` frame=${frameMs.toFixed(1)}ms`
        );
      }
    });
  };

  private onPointerMove = (e: PointerEvent) => {
    this.showEraserTip(e);
    if (this.keyboard) return;
    if (this.touchScroll && e.pointerId === this.touchScroll.id) {
      const dy = e.clientY - this.touchScroll.lastY;
      const dx = Math.abs(e.clientX - this.touchScroll.startX);
      const totalY = Math.abs(e.clientY - this.touchScroll.startY);
      // Lock once: a vertical scroll must never turn into a page swipe near its end.
      if (!this.touchScroll.axis && Math.max(dx, totalY) > 10)
        this.touchScroll.axis = dx > totalY * 1.5 ? "horizontal" : "vertical";
      this.touchScroll.lastY = e.clientY;
      if (this.touchScroll.axis === "vertical") this.containerEl.scrollTop -= dy;
      return;
    }
    if (this.objectDraft?.id===e.pointerId) {
      this.objectDraft.points.push(this.localPoint(e));this.previewObject();return;
    }
    if (this.nativeInkActive) return;
    if (e.pointerId !== this.gesture.pointerId) return;
    const p = this.localPoint(e);
    const mode = this.gesture.mode;

    if(mode==='select' && this.blockDrag){
      this.blockDrag.last=p;this.previewSelectedBlocks(p.x-this.blockDrag.start.x,p.y-this.blockDrag.start.y);
    } else if(mode==='select' && this.textWordDrag){
      const drag=this.textWordDrag;drag.last=p;
      for(const index of drag.indices){
        const node=this.containerEl.querySelector<HTMLElement>(`[data-text-box-word="${drag.boxId}"][data-text-word-index="${index}"]`);
        if(node)node.style.transform=`translate(${p.x-drag.start.x}px,${p.y-drag.start.y}px)`;
      }
    } else if (mode === "select" && this.selectionLassoPoints.length) {
      this.selectionLassoPoints.push(p);
      this.drawEraseLasso();
    } else if (mode === "select" && this.gesture.insertId && this.gesture.selectPosition) {
      const dx = p.x - this.gesture.lastMove.x;
      const dy = p.y - this.gesture.lastMove.y;
      this.gesture.lastMove = { x: p.x, y: p.y };
      const next = {
        x: this.gesture.selectPosition.x + dx,
        y: this.gesture.selectPosition.y + dy,
      };
      this.gesture.selectPosition = next;
      const origin = this.gesture.selectOrigin;
      if (origin && Math.hypot(next.x - origin.x, next.y - origin.y) > 2) {
        this.gesture.selectMoved = true;
      }
      // The preview stays in the same workspace-local coordinate system as
      // the pen. Do not run reflow here: packed handwriting otherwise snaps
      // to the shared text anchor (often x=0 on an ink-only page) instead of
      // following the stylus, and each rebuild overloads the WebView/GPU.
      const selectedEl = this.containerEl.querySelector<SVGElement>(".rw-ink.selected");
      const selectionBox=this.containerEl.querySelector<HTMLElement>('.rw-selection-box');
      if(selectionBox&&origin)selectionBox.style.transform=`translate(${next.x-origin.x}px,${next.y-origin.y}px)`;
      if (selectedEl) {
        selectedEl.style.left = `${next.x}px`;
        selectedEl.style.top = `${next.y}px`;
      }
    } else if (mode === "erase") {
      if (this.eraseLassoPoints.length) {
        this.eraseLassoPoints.push(p);
        this.drawEraseLasso();
      } else {
        this.eraseAlong(this.gesture.lastMove, p);
        this.gesture.lastMove = p;
      }
    } else if (mode === "insert" && this.gesture.insertId) {
      const dx = e.clientX - this.gesture.startX;
      this.pendingGapWidth = this.gesture.prevWidth + dx;
      this.moveInsertionGuide(
        this.gesture.gapX + this.pendingGapWidth,
        this.gesture.gapLine * this.lineHeight
      );
      if (this.gapRaf === null) {
        this.gapRaf = requestAnimationFrame(() => {
          this.gapRaf = null;
          const id = this.gesture.insertId;
          if (this.gesture.mode === "insert" && id) {
            this.previewSpacing(this.pendingGapWidth);
          }
        });
      }
    } else if (mode === "lines" && this.gesture.insertId) {
      const dy = e.clientY - this.gesture.startY;
      this.pendingLineCount = Math.max(
        -this.gesture.gapLine,
        lineCountForDrag(this.gesture.prevLines, dy, this.lineHeight)
      );
      if (this.gapRaf === null) {
        this.gapRaf = requestAnimationFrame(() => {
          this.gapRaf = null;
          const id = this.gesture.insertId;
          if (this.gesture.mode === "lines" && id) {
            const lines = this.pendingLineCount;
            this.previewSpacing(lines);
          }
        });
      }
    } else if (mode === "write" && this.gesture.liveStroke) {
      const stroke = this.gesture.liveStroke;
      const el = this.containerEl;
      const rect = el.getBoundingClientRect();
      const offX = -rect.left + el.scrollLeft;
      const offY = -rect.top + el.scrollTop;
      const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
      for (const ce of coalesced.length ? coalesced : [e]) {
        appendFiltered(stroke.points, {
          x: ce.clientX + offX,
          y: ce.clientY + offY,
          t: ce.timeStamp || performance.now(),
          pressure: ce.pressure,
          tiltX: ce.tiltX,
          tiltY: ce.tiltY,
        });
      }
      let renderPoints = stroke.points;
      // Delegated ink and application-side prediction must not run together because their two
      // predicted tails can fork. Preserve prediction as the fallback on unsupported browsers.
      if (!this.delegatedInkPresenter && typeof e.getPredictedEvents === "function") {
        const predicted = e.getPredictedEvents().slice(0, 3);
        if (predicted.length) {
          renderPoints = stroke.points.concat(
            predicted.map((pe) => ({
              x: pe.clientX + offX,
              y: pe.clientY + offY,
              t: pe.timeStamp || performance.now(),
              pressure: pe.pressure,
            }))
          );
        }
      }
      this.drawLiveStroke(renderPoints, stroke);
      if (this.delegatedInkPresenter) {
        this.delegatedInkPresenter.updateInkTrailStartPoint(e, {
          color: stroke.color,
          diameter: Math.max(1, stroke.width * (0.5 + Math.max(0, e.pressure || 0.5))),
        });
      }
    }
  };

  private finishGesture = (e: PointerEvent) => {
    if (e.pointerType === "touch") this.touchContacts.delete(e.pointerId);
    if (this.keyboard) return;
    if (this.touchScroll && e.pointerId === this.touchScroll.id) {
      const touch = this.touchScroll;
      this.touchScroll = null;
      const dx = e.clientX - touch.startX;
      const dy = e.clientY - touch.startY;
      const threshold = Math.max(48, Math.min(80, this.containerEl.clientWidth * 0.12));
      // One deliberate horizontal swipe turns one existing sheet on release. Taps never turn.
      if (e.type === "pointerup" && touch.axis !== "vertical" &&
          Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 2 &&
          performance.now() - touch.started < 1000 && !this.penContact && this.props.pageTools) {
        const direction = dx < 0 ? 1 : -1;
        if (direction < 0 ? this.props.pageTools.index > 0 : this.props.pageTools.index < this.props.pageTools.count - 1)
          this.props.pageTools.change(direction);
      }
      return;
    }
    if(this.objectDraft?.id===e.pointerId) {
      const draft=this.objectDraft;this.objectDraft=null;
      this.containerEl.querySelector(".page-object-draft")?.remove();
      if(e.type==="pointerup") {
        draft.points.push(this.localPoint(e));const b=boundsOfPoints(draft.points);
        if(Math.max(b.width,b.height)>8) {
          this.pushHistory(); const object = this.makeObject(draft.points); this.selectedObjectId = object.id;
          this.doc={...this.doc,pageObjects:[...(this.doc.pageObjects??[]),object]};
          this.relayout();this.props.onLayoutChanged?.();
        }
      }return;
    }
    if (this.nativeInkActive) return;
    if (e.pointerId !== this.gesture.pointerId) return;
    const g = this.gesture;
    this.insertionGuide = null;
    dlog("gesture:end", { type: e.type, mode: g.mode, id: g.insertId });
    this.gesture = {
      pointerId: null, mode: null, insertId: null,
      startX: 0, startY: 0, gapX: 0, gapLine: 0,
      prevWidth: 0, prevLines: 0, liveStroke: null,
      lastMove: { x: 0, y: 0 },
      selectOrigin: null, selectPosition: null, selectMoved: false,
    };

    if(g.mode==='select' && this.blockDrag){
      const drag=this.blockDrag;this.blockDrag=null;
      if(e.type==='pointerup')this.moveSelectedBlocks(drag.last.x-drag.start.x,drag.last.y-drag.start.y);
      this.renderOverlay();this.updateToolbarState();
    } else if(g.mode==='select' && this.textWordDrag){
      const drag=this.textWordDrag;this.textWordDrag=null;
      if(e.type==='pointerup')this.moveTypedWord(drag.boxId,drag.index,drag.origin.x+drag.last.x-drag.start.x,drag.origin.y+drag.last.y-drag.start.y);
      this.renderOverlay();this.updateToolbarState();
    } else if (g.mode === "select" && this.selectionLassoPoints.length) {
      const points = this.selectionLassoPoints;
      this.selectionLassoPoints = [];
      this.eraseLassoEl?.remove(); this.eraseLassoEl = null;
      if (e.type !== "pointercancel") this.selectLasso(points);
    } else if (g.mode === "erase" && this.eraseLassoPoints.length) {
      const points = this.eraseLassoPoints;
      this.eraseLassoPoints = [];
      this.eraseLassoEl?.remove();
      this.eraseLassoEl = null;
      if (e.type !== "pointercancel") this.eraseLasso(points);
    } else if (g.mode === "write" && g.liveStroke && g.insertId) {
      this.lastInkEndMs = performance.now();
      const stroke: InkStroke = { ...g.liveStroke, bounds: boundsOfPoints(g.liveStroke.points) };
      if (e.type === "pointercancel" || !this.eraseScribble(stroke.points, true)) this.commitWriteStroke(g.insertId, stroke);
      else {
        // Accepted scrubs never enter the saved model. Clear their wet-ink trail too:
        // relayout removes the erased word's SVG, but leaves this separate canvas intact.
        this.clearLiveCanvas();
      }
    } else if (g.mode === "insert" && g.insertId) {
      if (this.gapRaf !== null) {
        cancelAnimationFrame(this.gapRaf);
        this.gapRaf = null;
      }
      if (e.type === "pointercancel") this.restoreSpacingCheckpoint();
      else this.finishGap(this.pendingGapWidth);
    } else if (g.mode === "lines" && g.insertId) {
      if (this.gapRaf !== null) {
        cancelAnimationFrame(this.gapRaf);
        this.gapRaf = null;
      }
      if (e.type === "pointercancel") this.restoreSpacingCheckpoint();
      else this.finishLines(this.pendingLineCount);
    } else if (g.mode === "select") {
      if (g.insertId && g.selectMoved && g.selectPosition) {
        const selected = this.doc.inserts.find(
          (ins) => ins.id === g.insertId && ins.kind === "ink"
        );
        if (selected?.kind === "ink") {
          const bounds = strokesBounds(selected.strokes, PAD);
          const baselineOffset =
            selected.baselineOffset ??
            ruledBaselineOffset(g.selectPosition.y, bounds.height, this.lineHeight);
          // Horizontal placement remains where the word followed the pen.
          // Only its baseline snaps to the nearest ruled line on pen-up.
          const baseline = Math.max(
            this.lineHeight,
            Math.round((g.selectPosition.y + baselineOffset) / this.lineHeight) * this.lineHeight
          );
          const freeX = Math.max(0, Math.min(this.width - bounds.width, g.selectPosition.x));
          const freeY = Math.max(0, baseline - baselineOffset);
          this.doc = {
            ...this.doc,
            inserts: this.doc.inserts.map((ins) =>
              ins.id === g.insertId && ins.kind === "ink"
                ? {
                    ...ins,
                    freeX,
                    freeY,
                    baselineOffset,
                    afterWord: this.readingSlotAt(freeX, freeY + bounds.height / 2),
                  }
                : ins
            ),
          };
          this.relayout();
        }
      }
      this.updateToolbarState();
    }
    this.setSettingsDismissGesture(false);
    if(this.tool==='select' && !this.directSelection && this.selectionInteraction && !this.selectedInsertId && !this.selectedTextWords.size)this.startLasso();
  };

  // ---- Per-tool actions shared by the pointer gestures (live drags) and
  // ---- applyNativeStroke (completed daemon strokes). ----

  private spatialMetrics() {
    return { width: Math.max(40, this.width - 4), lineHeight: this.lineHeight,
      textGap: this.measure.space, inkGap: Math.max(this.measure.space, this.lineHeight * 0.4) };
  }

  /** Resolve visible positions once; later previews never replay old spacers. */
  private materializeSpatialDocument(): ReflowDoc {
    const inserts: Insert[] = [];
    for (const ins of this.doc.inserts) {
      if (ins.kind !== "ink") continue;
      const visual = this.inkVisualBounds(ins);
      if (!visual) continue;
      const groups = clusterInkStrokesByWord(ins.strokes, this.lineHeight, visual.y - visual.localY);
      groups.forEach((group, index) => {
        const subset = strokesBounds(group, PAD), normalized = normalizeInkStrokes(group, PAD);
        const x = visual.x + subset.x - visual.localX, y = visual.y + subset.y - visual.localY;
        const line = freeInkLaneIndex(y, subset.height, this.lineHeight);
        inserts.push({ ...ins, id: index === 0 ? ins.id : newInsertId("ink-word"),
          strokes: normalized.strokes, width: subset.width, height: Math.max(this.lineHeight, subset.height),
          freeX: x, freeY: y, baselineOffset: (line + 1) * this.lineHeight - y,
          flowAdvance: undefined });
      });
    }
    const sourceWordPositions = this.doc.words.map((text, index) => {
      const word = this.layout.placed.find(item => item.kind === "word" && item.key === `w${index}`)!;
      return { text, x: word.x, y: word.line * this.lineHeight };
    });
    return { ...this.doc, inserts, sourceWordPositions, textBoxes: this.placedTextBoxes() };
  }

  private spatialAtoms(doc: ReflowDoc): SpatialAtom[] {
    const atoms: SpatialAtom[] = [];
    doc.sourceWordPositions!.forEach((word, index) => {
      if (!word.text.replace(/[\s\u200b]/g, "")) return;
      const source = this.layout.placed.find(item => item.key === `w${index}`);
      atoms.push({ id: `w${index}`, kind: "word", ...word, width: this.measure.word(word.text),
        height: this.lineHeight, line: Math.round(word.y / this.lineHeight),
        breakBefore: source?.kind === "word" ? source.breakBefore : undefined });
    });
    const owners = new Map<string, string>();
    for (const box of doc.textBoxes ?? []) {
      if (box.semantic?.role === "text" && box.words?.length && !owners.has(box.semantic.id))
        owners.set(box.semantic.id, `t:${box.id}:0`);
    }
    for (const box of doc.textBoxes ?? []) {
      box.words!.forEach((word, index) => atoms.push({
        id: `t:${box.id}:${index}`, kind: box.checkbox ? "control" : "word",
        x: word.x, y: word.y, line: Math.round(word.y / this.lineHeight),
        width: this.styledMeasure(box, word.text, word.textStart ?? 0), height: this.lineHeight,
        breakBefore: Math.max(word.breakBefore ?? 0, index === 0 && box.semantic?.role === "text" && !box.semantic.continuation ? 1 : 0),
        ownerId: box.semantic?.role === "checkbox" ? owners.get(box.semantic.id) : undefined,
      }));
    }
    for (const ins of doc.inserts) {
      const bounds = strokesBounds(ins.strokes, PAD);
      atoms.push({ id: ins.id, kind: "ink", x: ins.freeX!, y: ins.freeY!,
        line: freeInkLaneIndex(ins.freeY!, bounds.height, this.lineHeight), width: bounds.width, height: bounds.height });
    }
    return atoms;
  }

  private applySpatialPlan(doc: ReflowDoc, plan: SpatialPlan): ReflowDoc {
    const sourceWordPositions = doc.sourceWordPositions!.map((word, index) => {
      const position = plan.positions.get(`w${index}`);
      return position ? { ...word, x: position.x, y: position.y } : word; // Invisible source placeholder.
    });
    const textBoxes = doc.textBoxes?.map(box => {
      const words = box.words!.map((word, index) => {
        const position = plan.positions.get(`t:${box.id}:${index}`)!;
        return { ...word, x: position.x, y: position.y };
      });
      return { ...box, words, x: words.length ? Math.min(...words.map(word => word.x)) : box.x,
        y: words.length ? Math.min(...words.map(word => word.y)) : box.y };
    });
    const inserts = doc.inserts.map(ins => {
      const position = plan.positions.get(ins.id)!;
      return { ...ins, freeX: position.x, freeY: position.y };
    });
    return { ...doc, sourceWordPositions, textBoxes, inserts };
  }

  private beginSpacing(kind: "gap" | "line", afterWord: number, line: number, x: number, preferredId?: string) {
    this.spacingCheckpoint = { doc: this.doc, redo: this.redoStack, depth: this.historyStack.length };
    this.pushHistory();
    const previous = this.lastSpacing;
    if (previous && preferredId === previous.id && previous.result === this.doc && previous.width === this.width) {
      this.spacingSession = { ...previous };
    } else {
      const baseline = this.materializeSpatialDocument();
      const atoms = this.spatialAtoms(baseline);
      this.spacingSession = { id: newInsertId(kind), kind, baseline, atoms, afterWord, line,
        x: kind === "gap" ? horizontalAnchor(atoms, line, x) : 0, amount: 0, width: this.width };
    }
    const session = this.spacingSession!;
    this.activeSpacingInsertIds = { [kind]: session.id };
    this.previewSpacing(session.amount);
    return session;
  }

  private startGap(afterWord: number, line: number, x: number, preferredId?: string) {
    const session = this.beginSpacing("gap", afterWord, line, x, preferredId);
    return { id: session.id, prevWidth: session.amount, scopeX: session.x };
  }

  private previewSpacing(amount: number) {
    const session = this.spacingSession!;
    const metrics = this.spatialMetrics();
    const plan = session.kind === "gap"
      ? horizontalSpace(session.atoms, session.line, session.x, amount, metrics)
      : verticalSpace(session.atoms, session.line, amount, metrics);
    session.amount = plan.amount;
    if (session.kind === "gap" && this.gesture.mode === "insert")
      this.insertionGuide = { x: Math.max(0, session.x + plan.amount), top: session.line * this.lineHeight };
    const positioned = this.applySpatialPlan(session.baseline, plan);
    const marker: Insert = { id: session.id, kind: session.kind, afterWord: session.afterWord,
      scopeLine: session.line, scopeX: session.kind === "gap" ? session.x : undefined,
      width: session.kind === "gap" ? plan.amount : 0, lines: session.kind === "line" ? plan.amount : undefined,
      height: this.lineHeight, strokes: [] };
    this.doc = { ...positioned, inserts: [...positioned.inserts, marker] };
    this.relayout();
  }

  private settleSpacingGesture(cancel: boolean) {
    if (!this.spacingSession || this.gesture.pointerId === null) return;
    this.finishGesture({ pointerId: this.gesture.pointerId, type: cancel ? "pointercancel" : "pointerup" } as PointerEvent);
  }

  private restoreSpacingCheckpoint() {
    const checkpoint = this.spacingCheckpoint;
    if (!checkpoint) return;
    this.doc = checkpoint.doc;
    this.redoStack = checkpoint.redo;
    this.historyStack.length = checkpoint.depth;
    this.spacingCheckpoint = null;
    this.spacingSession = null;
    this.relayout();
  }

  private finishSpacing(amount: number) {
    const session = this.spacingSession!;
    this.previewSpacing(amount);
    const original = this.spacingCheckpoint!.doc.inserts.find(insert => insert.id === session.id);
    const before = session.kind === "gap" ? original?.width ?? 0 : original?.lines ?? 0;
    if (Math.abs(session.amount - before) < 0.001) { this.restoreSpacingCheckpoint(); return; }
    if (session.amount === 0) this.doc = session.baseline;
    this.lastSpacing = { ...session, result: this.doc };
    this.spacingCheckpoint = null; this.spacingSession = null;
    this.relayout(); this.props.onLayoutChanged?.();
  }

  private finishGap(finalWidth: number) {
    const session = this.spacingSession!;
    this.finishSpacing(finalWidth);
    this.logFinishedGap(session.line, session.x, session.amount);
  }

  /** One bounded production record per completed gesture. Detailed `dlog`
   * output stays development-only so live caret movement cannot flood logcat. */
  private logFinishedGap(line: number, x: number, width: number) {
    if (import.meta.env.DEV) return;
    const lanes = new Map<number, number>();
    const count = (lane: number) => lanes.set(lane, (lanes.get(lane) ?? 0) + 1);
    for (const item of this.layout.placed) {
      if (item.kind === "word" || item.kind === "ink") count(item.line);
    }
    for (const insert of this.doc.inserts) {
      if (insert.kind !== "ink" || insert.freeX === undefined) continue;
      const placement = this.layout.inkPlacements.get(insert.id);
      if (!placement) continue;
      count(freeInkLaneIndex(placement.y, strokesBounds(insert.strokes, PAD).height, this.lineHeight));
    }
    const occupied = [...lanes].sort(([a], [b]) => a - b).slice(0, 12);
    const signature = occupied.map(([lane, items]) => `${lane}:${items}`).join(",");
    const gaps = this.doc.inserts.filter((insert) => insert.kind === "gap").length;
    console.log(
      `DIAG planningGap line=${line} x=${Math.round(x)} width=${Math.round(width)} gaps=${gaps} lanes=${signature}`
    );
  }

  private spacingPageHeight = 0;
  private startLines(afterWord: number, scopeLine: number, preferredId?: string) {
    this.spacingPageHeight = this.containerEl.clientHeight;
    const session = this.beginSpacing("line", afterWord, scopeLine, 0, preferredId);
    return { id: session.id, prevLines: session.amount };
  }

  private finishLines(finalLines: number) {
    this.finishSpacing(finalLines);
    if (finalLines > 0) this.requestOverflowPagination(this.spacingPageHeight);
  }

  /** Pagination is a deliberate document operation, not a per-stroke/layout observer. In particular,
   * toolbar expansion, rotation and the Android keyboard must not repartition existing sheets.
   * The host checkpoints through the native flush barrier before reading materialised coordinates. */
  private requestOverflowPagination(height = this.containerEl.clientHeight) {
    if (height > 0) this.props.pageTools?.overflow?.(height);
  }

  /** Complete a write stroke: group into an ink word (merge scoring) and relayout. */
  private commitWriteStroke(insertId: string, stroke: InkStroke, render = true) {
    const commitStarted = performance.now();
    const owner = [...(this.doc.pageObjects ?? [])].reverse().find(o => isPaperObject(o) && objectContains(o,stroke.points[0]));
    if (owner) {
      const points=stroke.points.map(p=>({...p,x:p.x-owner.x,y:p.y-owner.y}));
      const local={...stroke,points,bounds:boundsOfPoints(points)};
      this.doc={...this.doc,inserts:this.doc.inserts.filter(ins=>ins.id!==insertId),pageObjects:this.doc.pageObjects?.map(o=>o.id===owner.id?{...o,ink:[...(o.ink??[]),local]}:o)};
      // Native already painted it. Preserve the no-DOM completion contract.
      if(render){this.clearLiveCanvas();this.relayout();}else{this.layout=this.computeLayout();this.nativeModelDirty=true;}
      return;
    }
    const raw = strokesBounds([stroke]);
    const strokeVisual = strokesBounds([stroke], PAD);
    const strokeLine = ruledLineIndex(strokeVisual.y, strokeVisual.height, this.lineHeight);
    const strokeStartedAt = stroke.points[0]?.t ?? 0;
    const current = this.doc.inserts.find((i) => i.id === insertId);

    let mergeTarget: Insert | undefined;
    let mergeTargetLine: number | undefined;
    if (!current || current.strokes.length === 0) {
      let bestScore = Infinity;
      for (const candidate of this.doc.inserts) {
        if (candidate.id === insertId || candidate.kind !== "ink" || candidate.strokes.length === 0) continue;
        const visual = this.inkVisualBounds(candidate);
        if (!visual) continue;
        const baselineY = visual.y + (candidate.baselineOffset ?? ruledBaselineOffset(visual.y, visual.height, this.lineHeight));
        const runLine = Math.max(1, Math.round(baselineY / this.lineHeight));
        const candidateLastAt = candidate.strokes.reduce((latest, candidateStroke) => {
          const lastPoint = candidateStroke.points[candidateStroke.points.length - 1];
          return Math.max(latest, lastPoint?.t ?? 0);
        }, 0);
        const timeGapMs = Math.max(0, strokeStartedAt - candidateLastAt);
        const match = {
          runLeft: visual.x, runRight: visual.x + visual.width, runLine,
          strokeLeft: strokeVisual.x, strokeRight: strokeVisual.x + strokeVisual.width,
          strokeLine, strokeHeight: strokeVisual.height, lineHeight: this.lineHeight,
          timeGapMs, attachmentDistance: undefined as number | undefined,
        };
        // A separately drawn p/g/y stem can descend into the next lane. Its pen-down must
        // touch this word's letter body; crossing an old descender's tail is not enough.
        if (strokeVisual.height > this.lineHeight * 0.4 && strokeLine === runLine + 1 &&
          inkStrokeStartsInBody(stroke, candidate.strokes, runLine * this.lineHeight, this.lineHeight,
            visual.x - visual.localX, visual.y - visual.localY)) match.strokeLine = runLine;
        if (!shouldMergeIntoInkWord(match)) continue;
        if (strokeVisual.height <= this.lineHeight * 0.4) {
          match.attachmentDistance = inkStrokeAttachmentDistance(stroke, candidate.strokes,
            visual.x - visual.localX, visual.y - visual.localY);
          if (!shouldMergeIntoInkWord(match)) continue;
        }
        const score = inkWordMatchScore(match);
        if (score < bestScore) {
          bestScore = score;
          mergeTarget = candidate;
          mergeTargetLine = runLine;
        }
      }
    }
    const scanFinished = performance.now();

    dlog("ink:group", {
      stroke: insertId,
      strokeLine,
      target: mergeTarget?.id ?? null,
      targetLine: mergeTargetLine ?? null,
    });

    const prior = mergeTarget ?? current;
    let incoming = stroke;
    if (prior && prior.kind === "ink" && prior.strokes.length > 0) {
      const visual = this.inkVisualBounds(prior);
      if (visual) {
        incoming = translateInkStrokes([stroke], visual.localX - visual.x, visual.localY - visual.y)[0];
      }
    }
    const normalized = normalizeInkStrokes([...(prior?.strokes ?? []), incoming], PAD);
    const strokes = normalized.strokes;
    const b = strokesBounds(strokes, PAD);
    const priorVisual = prior?.strokes.length ? this.inkVisualBounds(prior) : null;
    const priorBaseline =
      prior?.baselineOffset ?? (priorVisual ? ruledBaselineOffset(priorVisual.y, priorVisual.height, this.lineHeight) : undefined);
    const firstFreeTop = raw.y - PAD;
    let next = updateInsert(this.doc, prior?.id ?? insertId, {
      strokes,
      width: b.width,
      height: Math.max(this.lineHeight, b.height),
      baselineOffset: priorBaseline === undefined ? ruledBaselineOffset(firstFreeTop, b.height, this.lineHeight) : priorBaseline + normalized.dy,
      ...(prior?.freeX !== undefined && (prior?.strokes.length ?? 0) === 0
        ? { freeX: raw.x - PAD, freeY: raw.y - PAD }
        : prior?.freeX !== undefined && prior?.freeY !== undefined
          ? { freeX: prior.freeX - normalized.dx, freeY: prior.freeY - normalized.dy }
          : {}),
    });
    if (mergeTarget && mergeTarget.id !== insertId) {
      next = removeInsert(next, insertId);
    }
    this.doc = next;
    const modelFinished = performance.now();
    if (render) {
      this.clearLiveCanvas();
      this.relayout();
    } else {
      // Native writing already painted the stroke. Keep the model/layout
      // current for grouping and saving, but do not mutate the DOM: any view
      // invalidation here competes with Bigme's daemon/EPD command queue.
      this.layout = this.computeLayout();
      this.nativeModelDirty = true;
    }
    const renderFinished = performance.now();
    const commitNumber = ++this.inkCommitCount;
    requestAnimationFrame((frameTime) => {
      const total = renderFinished - commitStarted;
      const frameMs = Math.max(0, frameTime - commitStarted);
      if (commitNumber <= 10 || total >= 16 || frameMs >= 30) {
        console.info(
          `DIAG [kalamos-ink] PEN_UP #${commitNumber}` +
            ` scan=${(scanFinished - commitStarted).toFixed(1)}ms` +
            ` model=${(modelFinished - scanFinished).toFixed(1)}ms` +
            ` render=${(renderFinished - modelFinished).toFixed(1)}ms` +
            ` total=${total.toFixed(1)}ms frame=${frameMs.toFixed(1)}ms`
        );
      }
    });
    return null;
  }

  // ---- Native daemon seam ----

  /**
   * Route one completed pen stroke (workspace-container CSS px, as delivered
   * by the ink daemon after a pen pause) through the active tool. Drag tools
   * apply the whole gesture at once: the stroke IS the drag path.
   */
  applyNativeWriteStroke(points: InkPoint[], render = true, checkboxGestures = new Set<string>(), existingInk?:ReadonlySet<string>): ScribbleResult | {kind:"widget";rect:{x:number;y:number;w:number;h:number}} | null {
    if (points.length === 0) return null;
    // The same single-owner control contract as checkboxes: native pen taps on audio controls
    // activate once per batch, retire the temporary dot and never become notebook strokes.
    for (const object of this.doc.pageObjects ?? []) {
      if (object.kind!=='audio' || !object.attachment) continue;
      const first=points[0],left=object.x,right=object.x+44,top=object.y,bottom=object.y+object.height;
      if(first.x<left||first.x>right||first.y<top||first.y>bottom ||
        !points.every(p=>p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom&&Math.hypot(p.x-first.x,p.y-first.y)<=12))continue;
      const activation=this.attachmentActivation(object.id);
      activation.activatedAt=performance.now();activation.nativePenContact=this.nativeOwnsControlPen();
      const key=`audio-${object.id}`;
      if(!checkboxGestures.has(key)){checkboxGestures.add(key);this.props.onActivateAttachment?.(object);}
      return {kind:'widget',rect:{x:object.x-4,y:object.y-4,w:object.width+8,h:object.height+8}};
    }
    // Checkbox taps and short drawn marks delivered by the daemon are controls, not saved ink.
    // The caller replaces only this small region through the existing native
    // composition transaction; ordinary strokes still do no DOM work.
    for (const placed of this.layout.placed) {
      if (placed.kind !== "word" || !placed.textBoxId) continue;
      const box = this.doc.textBoxes?.find(b => b.id === placed.textBoxId && b.checkbox);
      if (!box) continue;
      const top = placed.line*this.lineHeight;
      const left=placed.x-4,right=placed.x+44,bottom=top+this.lineHeight,first=points[0];
      // Contact must begin on this control. Allow a tick's short outgoing tail, but never
      // capture handwriting approaching from the task text or a drag across other rows.
      if (first.x < left || first.x > right || first.y < top || first.y > bottom) continue;
      if (!points.every(p => p.x >= left-12 && p.x <= right+16 && p.y >= top-12 && p.y <= bottom+12)) continue;
      // An X can have two strokes in one native batch. It is still one checkbox action.
      const activation = this.checkboxActivation(box.id);
      activation.activatedAt = performance.now();
      activation.nativePenContact = this.nativeOwnsControlPen();
      if (!checkboxGestures.has(box.id)) {
        this.setChecklist(box.id, box.text !== "☑");
        checkboxGestures.add(box.id);
      }
      // Erase the complete temporary mark, including the part outside the control face.
      const bounds=boundsOfPoints(points,Math.max(4,this.penWidth));
      const x=Math.min(left,bounds.x),y=Math.min(top,bounds.y);
      return {kind:"widget", rect:{x,y,w:Math.max(right,bounds.x+bounds.width)-x,h:Math.max(bottom,bounds.y+bounds.height)-y}};
    }
    const erased = this.eraseScribble(points, false, render, undefined, existingInk);
    if (erased) return erased;
    const first = points[0];
    this.pushHistory();
    const targetId = newInsertId("ink");
    this.doc = {
      ...this.doc,
      inserts: [
        ...this.doc.inserts,
        { id: targetId, afterWord: this.nearestSlot(first.x, first.y), kind: "ink", width: 0, height: this.lineHeight, strokes: [], freeX: first.x - PAD, freeY: first.y - PAD },
      ],
    };
    const filtered: InkPoint[] = [];
    for (const pt of points) appendFiltered(filtered, pt);
    const pts = filtered.length >= 2 ? filtered : points;
    const stroke: InkStroke = {
      id: `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      tool: "pen",
      brushStyle: this.props.prefs.brushStyle ?? "pen",
      color: this.inkColor,
      width: this.penWidth,
      points: pts,
      bounds: boundsOfPoints(pts),
    };
    this.commitWriteStroke(targetId, stroke, render);
    return null;
  }

  applyNativeStroke(points: InkPoint[]): void {
    if (this.keyboard || points.length === 0) return;
    const first = points[0];
    const last = points[points.length - 1];
    const tool = this.tool;

    if (tool === "write") {
      this.applyNativeWriteStroke(points);
      return;
    }
    if (tool === "insert") {
      const handle = this.gapHandleAt(first.x, first.y);
      const afterWord = this.nearestSlot(first.x, first.y);
      const line = handle?.scopeLine ?? this.ruledLineAt(first.y);
      const { prevWidth } = this.startGap(afterWord, line, first.x, handle?.id);
      this.finishGap(prevWidth + (last.x - first.x));
      return;
    }
    if (tool === "lines") {
      const handle = this.lineHandleAt(first.y);
      const boundary = handle?.scopeLine ?? Math.max(0, Math.round(first.y / this.lineHeight));
      const afterWord = handle?.afterWord ?? this.lineAnchorForY(first.y);
      const { prevLines } = this.startLines(afterWord, boundary, handle?.id);
      this.finishLines(
        Math.max(-boundary, lineCountForDrag(prevLines, last.y - first.y, this.lineHeight))
      );
      return;
    }
    if (tool === "erase") {
      if (this.eraserMode === "lasso") this.eraseLasso(points);
      else {
        this.pushHistory();
        this.eraseAt(points[0],this.eraserDiameter/2,this.eraserMode==="pixel"?"pixel":"stroke");
        for (let i = 1; i < points.length; i++) this.eraseAlong(points[i - 1], points[i]);
      }
      return;
    }
    if(this.selectedTextWords.size && this.selectedBlockAt(first.x,first.y)) {
      if(Math.hypot(last.x-first.x,last.y-first.y)>12)this.moveSelectedBlocks(last.x-first.x,last.y-first.y);
      this.renderOverlay();this.updateToolbarState();return;
    }
    this.selectedTextWords.clear();
    // Match the WebView path: start on the selected group to move it; start
    // on empty paper to lasso. A native trail is discarded after interpreting it.
    const hit = this.inkRunAt(first.x,first.y) === this.selectedInsertId
      ? this.selectedInsertId : this.inkWordAt(first.x, first.y);
    const textWord=!hit?this.typedWordAt(first.x,first.y):undefined;
    if(textWord){
      this.selectTypedWord(textWord.textBoxId,textWord.textWordIndex);
      if(Math.hypot(last.x-first.x,last.y-first.y)>12)this.moveTypedWord(textWord.textBoxId,textWord.textWordIndex,textWord.x+last.x-first.x,textWord.line*this.lineHeight+last.y-first.y);
      this.renderOverlay();this.updateToolbarState();return;
    }
    this.selectedTextWord=null;
    if (!hit && validLasso(points)) { this.selectLasso(points); return; }
    this.selectedInsertId = hit;
    if (hit && Math.hypot(last.x - first.x, last.y - first.y) > 12) {
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      this.pushHistory();
      this.doc = {
        ...this.doc,
        inserts: this.doc.inserts.map((ins) => {
          if (ins.id !== hit || ins.kind !== "ink") return ins;
          const visual = this.inkVisualBounds(ins);
          if (!visual) return ins;
          const bounds = strokesBounds(ins.strokes, PAD);
          const baselineOffset =
            ins.baselineOffset ?? ruledBaselineOffset(visual.y, bounds.height, this.lineHeight);
          const targetY = visual.y + dy;
          const baseline = Math.max(
            this.lineHeight,
            Math.round((targetY + baselineOffset) / this.lineHeight) * this.lineHeight
          );
          const freeX = Math.max(0, Math.min(this.width - bounds.width, visual.x + dx));
          const freeY = Math.max(0, baseline - baselineOffset);
          return {
            ...ins,
            freeX,
            freeY,
            baselineOffset,
            afterWord: this.readingSlotAt(freeX, freeY + bounds.height / 2),
          };
        }),
      };
      this.relayout();
    }
    this.updateToolbarState();
    this.renderOverlay();
  }

  /** All committed workspace ink in container CSS coords, for Bridge.renderInk. */
  getNativeInkStrokes(includeObjectInk = true): NativeInkStroke[] {
    const out: NativeInkStroke[] = [];
    for (const ins of this.doc.inserts) {
      if (ins.kind !== "ink" || ins.strokes.length === 0) continue;
      // Free ink normally has a direct-coordinate fallback so newly ingested
      // native strokes can render before the next DOM relayout. That fallback
      // must not resurrect a run deliberately concealed by a negative spacer.
      const placement =
        this.layout.inkPlacements.get(ins.id) ??
        (ins.freeX !== undefined && ins.freeY !== undefined ? { x: ins.freeX, y: ins.freeY } : undefined);
      if (!placement) continue;
      const b = strokesBounds(ins.strokes, PAD);
      const selected = this.selectedInsertId === ins.id;
      for (const s of ins.strokes) {
        out.push({
          pts: s.points.map((pt) => ({
            x: placement.x + (pt.x - b.x),
            y: placement.y + (pt.y - b.y),
            pressure: pt.pressure ?? 0.5,
          })),
          width: s.width,
          color: s.color,
          selected,
          variableWidth: s.brushStyle === "brush",
          brushStyle: s.brushStyle,
        });
      }
    }
    const objects=this.doc.pageObjects??[];
    const visible=out.flatMap(stroke=>maskObjectInk(stroke.pts,objects).map(pts=>({...stroke,pts})));
    if (!includeObjectInk) return visible;
    objects.forEach((object,index)=>{
      for(const stroke of objectInkOnPage(object)) {
        const pts=stroke.points.map(p=>({x:p.x,y:p.y,pressure:p.pressure}));
        visible.push(...maskObjectInk(pts,objects.slice(index+1)).map(path=>({pts:path,width:stroke.width,color:stroke.color,selected:false,variableWidth:stroke.brushStyle==="brush",brushStyle:stroke.brushStyle})));
      }
    });
    return visible;
  }

  get containerElement(): HTMLElement {
    return this.containerEl;
  }

  /** Render the visible ruled page from the same placed vector model used by the editor.
   *
   * WebView.draw() flattens a one-CSS-pixel stroke into a much larger bitmap before thumbnail
   * reduction. Thin rules and handwriting then land between output pixels and appear broken or
   * inconsistently grey. Drawing directly at the final size keeps the geometry authoritative and
   * lets each saved pen width scale with the same content crop as the rest of the note.
   */
  renderThumbnailDataUrl(targetWidth = 320, targetHeight = Math.round(320 * 131 / 86)): string | null {
    const pageWidth = Math.max(1, this.containerEl.clientWidth || this.width);
    const pageHeight = Math.max(1, this.containerEl.clientHeight);
    const strokes = this.getNativeInkStrokes(false);

    // Find the space actually occupied by the note. Keep enough neighbouring ruled paper to make
    // position meaningful, but do not spend most of a library card on untouched space below a
    // short note. The crop always expands around (never through) content.
    let minX = pageWidth;
    let minY = pageHeight;
    let maxX = 0;
    let maxY = 0;
    let hasContent = false;
    for (const stroke of strokes) {
      for (const point of stroke.pts) {
        hasContent = true;
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
    const thumbnailBoxes=new Map(this.doc.textBoxes?.map(box=>[box.id,box]));
    const measure = document.createElement("canvas").getContext("2d");
    if (measure) measure.font = this.textFont;
    for (const placed of this.layout.placed) {
      if (placed.kind !== "word") continue;
      if (placed.text.replace(/\u200b/g, "").trim().length === 0) continue;
      hasContent = true;
      if(measure)measure.font=this.boxFont(placed.textBoxId?thumbnailBoxes.get(placed.textBoxId):undefined);
      const wordWidth = placed.width;
      minX = Math.min(minX, placed.x);
      minY = Math.min(minY, placed.line * this.lineHeight);
      maxX = Math.max(maxX, placed.x + wordWidth);
      maxY = Math.max(maxY, (placed.line + 1) * this.lineHeight);
    }

    for (const object of this.doc.pageObjects ?? []) {
      hasContent = true; minX = Math.min(minX, object.x); minY = Math.min(minY, object.y);
      maxX = Math.max(maxX, object.x+object.width); maxY = Math.max(maxY, object.y+object.height);
    }
    const crop = thumbnailCrop(
      pageWidth,
      pageHeight,
      hasContent ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null,
      this.lineHeight,
      targetWidth / targetHeight
    );
    const cropLeft = crop.x;
    const cropTop = crop.y;
    const cropWidth = crop.width;
    const cropHeight = crop.height;

    const scale = Math.min(targetWidth / cropWidth, targetHeight / cropHeight);
    if (!Number.isFinite(scale) || scale <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    const drawWidth = cropWidth * scale;
    const drawHeight = cropHeight * scale;
    // Paint rules in final output pixels, before scaling the ink. Two solid pixel rows survive
    // the six-inch shelf's roughly 2:1 reduction; fractional grey strokes can vanish entirely.
    const offsetY = (targetHeight - drawHeight) / 2;
    ctx.fillStyle = "#000";
    for (let y = this.lineHeight; y < pageHeight; y += this.lineHeight) {
      if (y < cropTop || y >= cropTop + cropHeight) continue;
      ctx.fillRect((targetWidth - drawWidth) / 2, Math.round(offsetY + (y - cropTop) * scale), drawWidth, 2);
    }
    ctx.save();
    ctx.translate(
      (targetWidth - drawWidth) / 2 - cropLeft * scale,
      (targetHeight - drawHeight) / 2 - cropTop * scale
    );
    ctx.scale(scale, scale);

    // Typed/HWR words share the same measured font and ruled-lane placement as the live DOM.
    ctx.fillStyle = "#000";
    ctx.font = this.textFont;
    ctx.textBaseline = "middle";
    for (const placed of this.layout.placed) {
      if (placed.kind !== "word") continue;
      ctx.textBaseline = "alphabetic";
      ctx.font=this.boxFont(placed.textBoxId?thumbnailBoxes.get(placed.textBoxId):undefined);
      let x=placed.x;const baseline=(placed.line+1)*this.lineHeight-2-this.textSize*.23;
      for(const run of this.wordFragments(placed.textBoxId?thumbnailBoxes.get(placed.textBoxId):undefined,placed.textWordIndex,placed.text)){
        ctx.font=styleFont(this.boxFont(placed.textBoxId?thumbnailBoxes.get(placed.textBoxId):undefined),run);
        ctx.fillText(run.text,x,baseline);const width=ctx.measureText(run.text).width;
        if('strike' in run&&run.strike){ctx.beginPath();ctx.moveTo(x,baseline-this.textSize*.3);ctx.lineTo(x+width,baseline-this.textSize*.3);ctx.stroke();}
        x+=width;
      }
    }

    for (const stroke of strokes) {
      if (stroke.pts.length === 0) continue;
      // Preserve the editor's actual pen width. A fixed output-pixel minimum makes a zoomed crop
      // look like it was written with a much heavier pen than the full page.
      fillStroke(
        ctx,
        stroke.pts.map((point) => ({ ...point, t: 0 })),
        stroke.width,
        stroke.color,
        stroke.brushStyle
      );
    }
    for (const object of this.doc.pageObjects ?? []) {
      if(isAttachmentObject(object)){drawAttachment(ctx,object,this.attachmentImages.image(object));for(const stroke of objectInkOnPage(object))fillStroke(ctx,stroke.points,stroke.width,stroke.color,stroke.brushStyle);continue;}
      if(object.kind==='markdown'){drawMarkdownObject(ctx,object);for(const stroke of objectInkOnPage(object))fillStroke(ctx,stroke.points,stroke.width,stroke.color,stroke.brushStyle);continue;}
      ctx.save(); ctx.translate(object.x, object.y); ctx.scale(object.width/100, object.height/100);
      const path = new Path2D(objectPath(object)); ctx.strokeStyle = object.color; ctx.fillStyle = object.filled ? object.color : "#ffffff";
      ctx.setLineDash(object.lineStyle==="dotted"?[1,4]:object.lineStyle==="dashed"?[8,5]:[]);
      ctx.lineWidth = object.strokeWidth*100/Math.max(1, Math.min(object.width, object.height));
      if (isPaperObject(object)) ctx.fill(path);
      ctx.stroke(path); ctx.restore();
      for(const stroke of objectInkOnPage(object))fillStroke(ctx,stroke.points,stroke.width,stroke.color,stroke.brushStyle);
    }
    ctx.restore();
    return canvas.toDataURL("image/png");
  }

  /** Read-only view of the reflow document (tests + HWR convert). */
  get reflowDoc(): ReflowDoc {
    return this.doc;
  }

  /** PDF export defaults to its established page geometry. Template previews request exactly
   * the visible paper height and one full sheet, using this same model/vector renderer. */
  exportSvgPages(options: { pageHeight?: number; singlePage?: boolean } = {}): string[] {
    const escape = (s: string) => s.replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]!));
    const pageHeight = options.pageHeight && Number.isFinite(options.pageHeight)
      ? Math.max(1, options.pageHeight)
      : Math.max(this.lineHeight*8, Math.floor(this.width*1.414/this.lineHeight)*this.lineHeight);
    const height = options.singlePage ? pageHeight : Math.max(this.lineHeight*8, this.layout.height);
    const ink = this.getNativeInkStrokes(false).map(s=> s.variableWidth ? `<path d="${outlinePathD(strokeOutline(s.pts.map(p=>({...p,t:0})),s.width,s.brushStyle))}" fill="${escape(s.color)}"/>` : s.pts.length === 1 ? `<circle cx="${s.pts[0].x}" cy="${s.pts[0].y}" r="${s.width/2}" fill="${escape(s.color)}"/>` : `<polyline points="${s.pts.map(p=>`${p.x},${p.y}`).join(" ")}" fill="none" stroke="${escape(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
    const svgBoxes=new Map(this.doc.textBoxes?.map(box=>[box.id,box]));
    const text = this.layout.placed.filter(p=>p.kind === "word").map(p=>`<text x="${p.x}" y="${(p.line+1)*this.lineHeight-2-this.textSize*0.23}" font-family="${escape(WORKSPACE_FONT_FAMILY)}" font-size="${this.textSize}" font-weight="${(p.kind==='word'&&p.textBoxId?svgBoxes.get(p.textBoxId):undefined)?.fontWeight===700?700:400}" fill="#000">${(p.kind==='word'&&p.textBoxId?svgBoxes.get(p.textBoxId):undefined)?.styles?.length?this.wordFragments(p.kind==='word'&&p.textBoxId?svgBoxes.get(p.textBoxId):undefined,p.kind==='word'?p.textWordIndex:undefined,p.kind==='word'?p.text:'').map(run=>`<tspan font-weight="${('bold' in run&&run.bold)||(p.kind==='word'&&p.textBoxId?svgBoxes.get(p.textBoxId):undefined)?.fontWeight===700?700:400}" font-style="${'italic' in run&&run.italic?'italic':'normal'}" text-decoration="${'strike' in run&&run.strike?'line-through':'none'}">${escape(run.text)}</tspan>`).join(''):escape(p.kind==='word'?p.text:'')}</text>`).join("");
    const pages: string[] = [];
    for(let top=0;top<height;top+=pageHeight) {
      const rules = Array.from({length:Math.floor(pageHeight/this.lineHeight)},(_,i)=>`<path d="M0 ${top+(i+1)*this.lineHeight} H${this.width}" stroke="#000" stroke-width="1"/>`).join("");
      pages.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${this.width} ${pageHeight}" width="${this.width}" height="${pageHeight}"><rect x="0" y="${top}" width="${this.width}" height="${pageHeight}" fill="#fff"/>${rules}${text}${ink}${(this.doc.pageObjects??[]).map(object=>objectSvg(object,this.attachmentImages.source(object))+objectInkOnPage(object).map(stroke=>`<path d="${outlinePathD(strokeOutline(stroke.points,stroke.width,stroke.brushStyle))}" fill="${escape(stroke.color)}"/>`).join("")).join("")}</svg>`);
    }
    return pages;
  }

  get selectedId(): string | null {
    return this.selectedInsertId;
  }

  get currentTool(): Tool {
    return this.tool;
  }

  /** Public tool switch (native module, HWR actions, tests). */
  setActiveTool(tool: Tool) {
    this.setTool(tool);
  }

  get isKeyboard(): boolean {
    return this.keyboard;
  }

  get usesNativeSelectionPen(): boolean {
    return (this.tool === "select" && !this.selectionInteraction && !this.directSelection) || (this.tool === "erase" && this.eraserMode === "lasso");
  }

  setEraserMode(mode: EraseMode | "lasso") {
    // Drain the previous mode before changing how a completed daemon gesture
    // is interpreted. Changing within Eraser still needs to update native ownership.
    this.afterNativeFlush(()=>{ this.eraserMode=mode; this.setTool("erase"); });
  }

  private eraseAlong(from: { x: number; y: number }, to: InkPoint) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x-from.x, to.y-from.y)/Math.max(2,this.eraserDiameter/4)));
    for (let i=1; i<=steps; i++) this.eraseAt({ ...to, x: from.x+(to.x-from.x)*i/steps, y: from.y+(to.y-from.y)*i/steps },this.eraserDiameter/2,this.eraserMode==="pixel"?"pixel":"stroke");
  }

  private drawEraseLasso() {
    if (!this.eraseLassoEl || !this.eraseLassoEl.isConnected) {
      this.eraseLassoEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.eraseLassoEl.classList.add("rw-erase-lasso");
      this.containerEl.appendChild(this.eraseLassoEl);
    }
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", (this.selectionLassoPoints.length ? this.selectionLassoPoints : this.eraseLassoPoints).map((p,i)=>`${i ? "L" : "M"}${p.x},${p.y}`).join(" "));
    path.setAttribute("fill", "none"); path.setAttribute("stroke", "#000");
    path.setAttribute("stroke-width", "1.5"); path.setAttribute("stroke-dasharray", "6 10");
    this.eraseLassoEl.replaceChildren(path);
  }

  /** Native delivery can contain a whole new word. Freeze eligibility before ingesting its
   * strokes so fresh writing in blank space cannot erase itself later in the same batch. */
  snapshotScribbleInkTargets(): ReadonlySet<string> {
    return new Set([
      ...this.doc.inserts.flatMap(ins=>ins.kind==='ink'?ins.strokes.map(stroke=>stroke.id):[]),
      ...(this.doc.pageObjects??[]).flatMap(object=>(object.ink??[]).map(stroke=>stroke.id)),
    ]);
  }

  eraseScribble(points: InkPoint[], historyPushed = false, render = true, staged?: { strokes: InkStroke[]; restore: (strokes: InkStroke[]) => void }, existingInk?:ReadonlySet<string>): ScribbleResult | null {
    // With no old ink or typed text there is nothing to erase, regardless of stroke shape.
    if(existingInk?.size===0 && !this.doc.textBoxes?.some(box=>!box.checkbox&&box.text.trim()))return null;
    if (!scribble.candidate(points, this.lineHeight)) return null;
    const paperOwner=[...(this.doc.pageObjects??[])].reverse().find(o=>isPaperObject(o)&&objectContains(o,points[0]));
    const wordGroups: number[][] = [];
    const placed: { id: string; points: { x: number; y: number }[]; width: number }[] = [];
    for (const ins of this.doc.inserts) {
      if (ins.kind !== "ink" || paperOwner) continue;
      const visual = this.inkVisualBounds(ins);
      if (!visual) continue;
      const strokes=existingInk?ins.strokes.filter(stroke=>existingInk.has(stroke.id)):ins.strokes;
      const firstIndex = placed.length;
      for (const stroke of strokes) placed.push({ id: stroke.id, width: stroke.width,
        points: stroke.points.map(p => ({ x: p.x + visual.x - visual.localX, y: p.y + visual.y - visual.localY })) });
      const indexes = new Map(strokes.map((stroke,i) => [stroke.id,firstIndex+i]));
      wordGroups.push(...clusterInkStrokesByWord(strokes,this.lineHeight,visual.y-visual.localY)
        .map(group => group.map(stroke => indexes.get(stroke.id)!)));
    }
    for(const object of this.doc.pageObjects??[]) {
      if(paperOwner && object.id!==paperOwner.id)continue;
      const strokes=objectInkOnPage(object).filter(stroke=>!existingInk||existingInk.has(stroke.id)), firstIndex=placed.length;
      for(const stroke of strokes)placed.push({id:stroke.id,width:stroke.width,points:stroke.points});
      const indexes=new Map(strokes.map((stroke,i)=>[stroke.id,firstIndex+i]));
      wordGroups.push(...clusterInkStrokesByWord(strokes,this.lineHeight).map(group=>group.map(stroke=>indexes.get(stroke.id)!)));
    }
    // Typed words enter the existing scribble classifier as hit regions, never as saved ink.
    // Use visible placements after spacing/reflow, and leave task controls paired to their text.
    const typedTargets = new Map<string,{boxId:string;index:number}>();
    if(!paperOwner) for(const word of this.layout.placed) {
      if(word.kind!=='word'||!word.textBoxId||word.textWordIndex===undefined)continue;
      if(this.doc.textBoxes?.find(box=>box.id===word.textBoxId)?.checkbox)continue;
      const bottom=(word.line+1)*this.lineHeight-2-this.textSize*.23, top=Math.max(0,bottom-this.textSize);
      const hitPoints:{x:number;y:number}[]=[];
      for(let y=top;y<=bottom;y+=4)hitPoints.push({x:word.x,y},{x:word.x+word.width,y});
      const id=`typed:${word.key}`;
      typedTargets.set(id,{boxId:word.textBoxId,index:word.textWordIndex});
      wordGroups.push([placed.length]);placed.push({id,points:hitPoints,width:1});
    }
    const beforePad = staged?.strokes ?? [];
    const padIndexes = new Map(beforePad.map((stroke,i) => [stroke.id,placed.length+i]));
    wordGroups.push(...clusterInkStrokesByWord(beforePad,this.lineHeight)
      .map(group => group.map(stroke => padIndexes.get(stroke.id)!)));
    const result = scribble.detect(points, [...placed, ...beforePad], this.lineHeight, wordGroups);
    if (!result) return null;
    // Settle pending Zoom vectors without advancing the target or adding a second Undo.
    // The erase snapshot then owns ALL crossed ink, even after the pad is closed/reopened.
    if (staged && beforePad.length) {
      const line = Math.max(0, Math.round(points.reduce((sum,p) => sum+p.y,0)/points.length/this.lineHeight)-1);
      this.placeMagnifiedGroup(beforePad, line, false);
      staged.restore([]);
    }
    const ids = new Set(result.indices.map(i => i < placed.length ? placed[i].id : beforePad[i-placed.length].id));
    const erasedPoints: InkPoint[] = [];
    let erasePad = 8;
    for (const ins of this.doc.inserts) {
      if (ins.kind !== "ink" || !ins.strokes.some(stroke => ids.has(stroke.id))) continue;
      const visual = this.inkVisualBounds(ins);
      if (!visual) continue;
      // Use the SAME word partition as selection/movement, including delayed dots and crossbars.
      // A lasso/legacy/Zoom insert may contain several words: do not delete its whole phrase.
      const groups = clusterInkStrokesByWord(ins.strokes.filter(stroke=>!existingInk||existingInk.has(stroke.id)), this.lineHeight, visual.y - visual.localY);
      for (const group of groups) {
        if (!group.some(stroke => ids.has(stroke.id))) continue;
        for (const stroke of group) {
          ids.add(stroke.id);
          erasePad = Math.max(erasePad, stroke.width / 2 + 2);
          erasedPoints.push(...stroke.points.map(p => ({ ...p,
            x: p.x + visual.x - visual.localX, y: p.y + visual.y - visual.localY })));
        }
      }
    }
    for(const object of this.doc.pageObjects??[])for(const stroke of objectInkOnPage(object)) {
      if(!ids.has(stroke.id))continue;
      erasedPoints.push(...stroke.points);erasePad=Math.max(erasePad,stroke.width/2+2);
    }
    const typed = new Map<string,Set<number>>();
    for(const id of ids){
      const target=typedTargets.get(id);if(!target)continue;
      if(!typed.has(target.boxId))typed.set(target.boxId,new Set());
      typed.get(target.boxId)!.add(target.index);
      erasedPoints.push(...placed.find(p=>p.id===id)!.points.map(p=>({...p,pressure:.5,t:0})));
    }
    // Native partial refresh must cover the ENTIRE erased word, not just the crossed letters.
    // Otherwise the model is correct but un-crossed letters remain visible on the e-ink panel.
    const dirty = boundsUnion({ x: result.rect.x, y: result.rect.y, width: result.rect.w, height: result.rect.h },
      boundsOfPoints(erasedPoints, erasePad));
    result.rect = { x: dirty.x, y: dirty.y, w: dirty.width, h: dirty.height };
    if(typed.size && !historyPushed){this.pushHistory();historyPushed=true;}
    this.removeInkStrokes(stroke => ids.has(stroke.id), historyPushed, typed.size?false:render);
    if(typed.size){
      // Settle spacing before deleting: surviving words retain their current page coordinates.
      const boxes=this.placedTextBoxes().flatMap(box=>{
        const indices=typed.get(box.id);if(!indices)return [box];
        const visible=this.textBoxWords(box.id);
        const selected=new Set(visible.flatMap((word,i)=>indices.has(word.textWordIndex!)?[i]:[]));
        const next=removeBoxWords(box.text,box.words??[],selected,box.styles);
        return next.text.trim()?[{...box,...next}]:[];
      });
      this.doc={...this.doc,textBoxes:synchronizeTaskControls(boxes)};
      if(render)this.relayout();else {this.layout=this.computeLayout();this.nativeModelDirty=true;}
    }
    if (staged) this.scribbleTransactions.add(this.doc);
    return result;
  }

  /** Select whole vector strokes using visible page coordinates, never bounding-box
   * containment alone. Normalisation plus explicit placement preserves every pen point;
   * one history entry owns extraction/grouping so Undo restores the original runs. */
  selectLasso(polygon: InkPoint[]) {
    if (!validLasso(polygon)) return;
    const selected: InkStroke[] = [];
    const ids = new Set<string>();
    this.selectedTextWords.clear();this.selectedTextWord=null;
    for(const word of this.layout.placed) {
      if(word.kind!=='word'||!word.textBoxId||word.textWordIndex===undefined)continue;
      const box=this.doc.textBoxes?.find(b=>b.id===word.textBoxId);if(box?.checkbox)continue;
      const y=word.line*this.lineHeight;
      // Hit the text body rather than empty space at the bottom of its lane.
      const rect=[{x:word.x,y},{x:word.x+word.width,y},{x:word.x+word.width,y:y+this.textSize*1.2},
        {x:word.x,y:y+this.textSize*1.2},{x:word.x,y}];
      if(!strokeHitsLasso(rect,polygon) && !polygon.some(p=>p.x>=word.x&&p.x<=word.x+word.width&&p.y>=y&&p.y<=y+this.textSize*1.2))continue;
      if(!this.selectedTextWords.has(word.textBoxId))this.selectedTextWords.set(word.textBoxId,new Set());
      this.typedWordIndices(word.textBoxId,word.textWordIndex).forEach(i=>this.selectedTextWords.get(word.textBoxId!)!.add(i));
    }
    for (const ins of this.doc.inserts) {
      if (ins.kind !== "ink") continue;
      const visual = this.inkVisualBounds(ins);
      if (!visual) continue;
      // Legacy/lasso runs may contain a phrase: recover word units before hit testing.
      for(const group of clusterInkStrokesByWord(ins.strokes,this.lineHeight,visual.y-visual.localY)) {
        const strokes=group.map(stroke=>{
          const points=stroke.points.map(p=>({...p,x:p.x+visual.x-visual.localX,y:p.y+visual.y-visual.localY}));
          return {...stroke,points,bounds:boundsOfPoints(points)};
        });
        if(!strokes.some(stroke=>strokeHitsLasso(stroke.points,polygon)))continue;
        selected.push(...strokes);strokes.forEach(stroke=>ids.add(stroke.id));
      }
    }
    if (!selected.length) { this.selectedInsertId = null; this.updateToolbarState(); this.renderOverlay(); return; }
    this.pushHistory();
    this.removeInkStrokes(stroke => ids.has(stroke.id), true, false);
    const b = strokesBounds(selected, PAD);
    const normalized = normalizeInkStrokes(selected, PAD);
    const id = newInsertId("ink");
    this.doc = { ...this.doc, inserts: [...this.doc.inserts, { id, kind: "ink",
      afterWord: this.nearestSlot(b.x,b.y), width: b.width, height: Math.max(this.lineHeight,b.height),
      baselineOffset: ruledBaselineOffset(b.y,b.height,this.lineHeight),
      freeX: b.x, freeY: b.y,
      strokes: normalized.strokes }] };
    this.selectedInsertId = id;
    this.relayout(); this.updateToolbarState();
  }

  private startLasso() {
    this.directSelection=false; this.selectionInteraction=false;
    this.selectedInsertId=null; this.selectedTextWord=null; this.selectedTextWords.clear();
    this.closePenSettings(); this.setTool("select");
  }

  /** Snapshot exact selected text ranges and vectors before Cut can change the source page. */
  copySelectedBlocks(cut = false) {
    const bounds=this.getSelectedBlockBounds(); if(!bounds)return;
    const ins=this.doc.inserts.find(i=>i.id===this.selectedInsertId && i.kind==='ink');
    const visual=ins ? this.inkVisualBounds(ins) : null;
    const textBoxes=this.selectedTextBoxes();
    try { writeSelectionClipboard({bounds,ink:ins&&visual?{...ins,freeX:visual.x,freeY:visual.y}:undefined,textBoxes}); }
    catch { this.props.onSelectionError?.('Could not save the clipboard. Your selection is unchanged.'); return; }
    if(cut)this.deleteSelectedBlocks();
    this.updateToolbarState();
  }

  pasteSelection() {
    const clip=readSelectionClipboard();if(!clip)return;
    this.pushHistory();
    const dx=Math.max(0,Math.min(clip.bounds.x,this.width-clip.bounds.width))-clip.bounds.x;
    const dy=this.containerEl.scrollTop+this.lineHeight-clip.bounds.y;
    let inserts=this.doc.inserts;
    this.selectedInsertId=null; this.selectedTextWords.clear(); this.selectedTextWord=null;
    if(clip.ink){
      const id=newInsertId('ink');
      inserts=[...inserts,{...clip.ink,id,freeX:clip.ink.freeX!+dx,freeY:clip.ink.freeY!+dy,
        afterWord:this.nearestSlot(clip.bounds.x+dx,clip.bounds.y+dy),
        strokes:clip.ink.strokes.map((stroke,i)=>({...stroke,id:`${id}-${i}`}))}];
      this.selectedInsertId=id;
    }
    const semanticIds=new Map<string,string>();
    for(const box of clip.textBoxes)if(box.semantic && !semanticIds.has(box.semantic.id))semanticIds.set(box.semantic.id,newInsertId('semantic'));
    const firstText=new Set<string>();
    const boxes=clip.textBoxes.map(box=>{
      const id=newInsertId('text');
      const words=(box.words??[]).map(word=>({...word,x:word.x+dx,y:word.y+dy}));
      if(!box.checkbox)this.selectedTextWords.set(id,new Set(words.map((_,i)=>i)));
      const semantic=box.semantic?{...box.semantic,id:semanticIds.get(box.semantic.id)!,
        sourceInkRegionIds:undefined,parentId:box.semantic.parentId?semanticIds.get(box.semantic.parentId):undefined,
        continuation:box.semantic.role==='text' && firstText.has(box.semantic.id)}:undefined;
      if(box.semantic?.role==='text')firstText.add(box.semantic.id);
      return {...box,id,blockId:this.props.block.id,semantic,x:words.length?Math.min(...words.map(w=>w.x)):box.x+dx,
        y:words.length?Math.min(...words.map(w=>w.y)):box.y+dy,words};
    });
    this.doc={...this.doc,inserts,textBoxes:[...this.placedTextBoxes(),...boxes]};
    this.tool='select';this.directSelection=false;this.selectionInteraction=false;
    this.setTool('select');this.relayout();this.props.onLayoutChanged?.();
  }

  private selectedTextBoxes() {
    const textBoxes=this.placedTextBoxes().flatMap(box=>{
      const indices=this.selectedTextWords.get(box.id);if(!indices?.size||!box.words)return [];
      const others=new Set(box.words.flatMap((_,i)=>indices.has(i)?[]:[i]));
      const selected=removeBoxWords(box.text,box.words,others,box.styles);
      return [{...box,...selected,x:Math.min(...selected.words.map(w=>w.x)),y:Math.min(...selected.words.map(w=>w.y))}];
    });
    const ids=new Set(textBoxes.flatMap(box=>box.semantic?[box.semantic.id]:[]));
    const controls=this.placedTextBoxes().filter(box=>box.checkbox && box.semantic && ids.has(box.semantic.id));
    return [...textBoxes,...controls];
  }

  selectedMarkdown(): string {
    // Handwritten vectors are never OCR'd or silently included in a text share.
    return notebookSheetsToMarkdown([{source:'',sidecar:{...createEmptySidecar('Selection',''),textBoxes:this.selectedTextBoxes()}}]);
  }

  duplicateSelectedInk() {
    const ins=this.doc.inserts.find(i=>i.id===this.selectedInsertId);
    const visual=ins?.kind==='ink'?this.inkVisualBounds(ins):null;
    if(!visual&&!this.selectedTextWords.size)return;
    this.pushHistory();
    const textBoxes=this.placedTextBoxes(),copies: typeof textBoxes=[];
    const selectedCopies=new Map<string,Set<number>>();
    for(const box of textBoxes) {
      const indices=this.selectedTextWords.get(box.id);if(!indices||!box.words)continue;
      const others=new Set(box.words.flatMap((_,i)=>indices.has(i)?[]:[i]));
      const selected=removeBoxWords(box.text,box.words,others,box.styles);
      const id=newInsertId('text');const words=selected.words.map(w=>({...w,y:w.y+this.lineHeight}));
      copies.push({...box,...selected,id,words,x:Math.min(...words.map(w=>w.x)),y:Math.min(...words.map(w=>w.y)),semantic:undefined});
      selectedCopies.set(id,new Set(words.map((_,i)=>i)));
    }
    let inserts=this.doc.inserts;
    if(ins?.kind==='ink'&&visual) {
      const id=newInsertId('ink');
      inserts=[...inserts,{...ins,id,freeX:visual.x,freeY:visual.y+this.lineHeight,strokes:ins.strokes.map((stroke,i)=>({...stroke,id:`${id}-${i}`,
          bounds:{...stroke.bounds},points:stroke.points.map(p=>({...p}))}))}];
      this.selectedInsertId=id;
    }
    this.selectedTextWords=selectedCopies;this.selectedTextWord=null;
    this.doc={...this.doc,inserts,textBoxes:[...textBoxes.map(box=>({...box})),...copies]};
    this.relayout();this.updateToolbarState();
  }

  private deleteSelectedBlocks() {
    if(!this.selectedInsertId&&!this.selectedTextWords.size)return;
    this.pushHistory();
    const textBoxes=this.placedTextBoxes().flatMap(box=>{
      const indices=this.selectedTextWords.get(box.id);
      if(!indices||!box.words)return [{...box}];
      const remaining=removeBoxWords(box.text,box.words,indices,box.styles);
      return remaining.words.length?[{...box,...remaining}]:[];
    });
    this.doc={...this.doc,textBoxes:synchronizeTaskControls(textBoxes),inserts:this.doc.inserts.filter(i=>i.id!==this.selectedInsertId)};
    this.selectedInsertId=null;this.selectedTextWords.clear();this.selectedTextWord=null;
    this.relayout();this.startLasso();
  }

  private eraseLasso(polygon: InkPoint[]) {
    if (!validLasso(polygon)) return;
    this.removeInkStrokes((stroke, visual) => strokeHitsLasso(stroke.points.map(p => ({
      x: p.x+visual.x-visual.localX, y: p.y+visual.y-visual.localY })), polygon));
  }

  private removeInkStrokes(hit: (stroke: InkStroke, visual: NonNullable<ReturnType<PenWorkspace["inkVisualBounds"]>>) => boolean,
    historyPushed = false, render = true) {
    let changed = false;
    const inserts = this.doc.inserts.map(ins => {
      if (ins.kind !== "ink") return ins;
      const visual = this.inkVisualBounds(ins);
      if (!visual) return ins;
      const survivors = ins.strokes.filter(stroke => !hit(stroke, visual));
      if (survivors.length === ins.strokes.length) return ins;
      changed = true;
      // Rebase survivors exactly as the ordinary eraser does, keeping page placement stable.
      const normalized = normalizeInkStrokes(survivors, PAD);
      const b = strokesBounds(normalized.strokes, PAD);
      return { ...ins, strokes: normalized.strokes, width: b.width,
        height: Math.max(this.lineHeight, b.height),
        baselineOffset: (ins.baselineOffset ?? ruledBaselineOffset(visual.y, visual.height, this.lineHeight)) + normalized.dy,
        // Older phrase inserts can be flow-anchored. Preserve the survivor's page
        // coordinates too: normalising must not pull the untouched neighbour left/up.
        freeX: visual.x - visual.localX - normalized.dx + b.x,
        freeY: visual.y - visual.localY - normalized.dy + b.y };
    }).filter(ins => ins.kind !== "ink" || ins.strokes.length > 0);
    const pageObjects=this.doc.pageObjects?.map(object=>{
      const visual={x:object.x,y:object.y,width:object.width,height:object.height,localX:0,localY:0};
      const ink=object.ink?.filter(stroke=>!hit(stroke,visual));
      if(ink?.length===object.ink?.length)return object;
      changed=true;return {...object,ink};
    });
    if (!changed) return;
    if (!historyPushed) this.pushHistory();
    this.doc = { ...this.doc, inserts, pageObjects };
    if (render) this.relayout();
    else { this.layout = this.computeLayout(); this.nativeModelDirty = true; }
  }

  private eraseAt(p: InkPoint, radius = 16, mode: EraseMode = "stroke") {
    // Object ink uses the existing eraser hit test without normalising its origin.
    const owner=[...(this.doc.pageObjects??[])].reverse().find(o=>isPaperObject(o)&&objectContains(o,p));
    if (mode === "pixel") {
      let changed = false;
      const pageObjects = this.doc.pageObjects?.map(object => {
        if (owner && object.id !== owner.id) return object;
        const ink = object.ink?.flatMap(stroke => eraseStrokeAtPoint(stroke,p.x-object.x,p.y-object.y,radius,mode));
        if (!ink || ink.length===object.ink?.length && ink.every((s,i)=>s===object.ink?.[i])) return object;
        changed = true; return {...object,ink};
      });
      if (changed) { this.doc={...this.doc,pageObjects};this.relayout(); }
    } else this.removeInkStrokes((stroke,visual)=>this.doc.pageObjects?.some(o=>(!owner||o.id===owner.id)&&o.ink?.some(s=>s.id===stroke.id))===true &&
      strokeHitsPoint(stroke.points,p.x-visual.x,p.y-visual.y,radius,stroke.width),true);
    if(owner)return; // Paper is opaque: never erase hidden page ink through it.
    const groupedHit = this.inkRunAt(p.x, p.y);
    if (groupedHit) this.splitInkRunIntoWords(groupedHit);
    let changed = false;
    const inserts = this.doc.inserts
      .map((ins) => {
        if (ins.kind !== "ink") return ins;
        const visual = this.inkVisualBounds(ins);
        if (!visual) return ins;
        const localX = p.x - visual.x + visual.localX;
        const localY = p.y - visual.y + visual.localY;
        const survivors = ins.strokes.flatMap(s => eraseStrokeAtPoint(s,localX,localY,radius,mode));
        if (survivors.length !== ins.strokes.length || survivors.some((s,i)=>s!==ins.strokes[i])) {
          changed = true;
          const normalized = normalizeInkStrokes(survivors, PAD);
          const b = strokesBounds(normalized.strokes, PAD);
          const baselineOffset = (ins.baselineOffset ?? ruledBaselineOffset(visual.y, visual.height, this.lineHeight)) + normalized.dy;
          return {
            ...ins,
            strokes: normalized.strokes,
            width: b.width,
            height: Math.max(this.lineHeight, b.height),
            baselineOffset,
            ...(ins.freeX !== undefined && ins.freeY !== undefined
              ? { freeX: ins.freeX - normalized.dx, freeY: ins.freeY - normalized.dy }
              : {}),
          };
        }
        return ins;
      })
      .filter((ins) => !(ins.kind === "ink" && ins.strokes.length === 0));
    if (changed) {
      this.doc = { ...this.doc, inserts };
      this.relayout();
    }
  }

  private onTextChange(value: string) {
    this.textEdited = true;
    this.pushHistory();
    this.doc = retokenize(this.doc, value);
    this.relayout();
  }

  private collapse = () => {
    const baseline = this.materializeSpatialDocument();
    const atoms = this.spatialAtoms(baseline);
    const plan = condenseSpace(atoms, this.spatialMetrics());
    if (atoms.every(atom => { const p = plan.positions.get(atom.id)!; return p.x === atom.x && p.y === atom.y; })) return;
    this.pushHistory();
    this.doc = this.applySpatialPlan(baseline, plan);
    this.lastSpacing = null;
    this.selectedInsertId = null; this.selectedTextWord = null; this.selectedTextWords.clear();
    this.relayout(); this.props.onLayoutChanged?.();
  };

  private handleDone = (intent: "finish" | "checkpoint" = "finish"): Promise<void> => {
    this.settleSpacingGesture(false);
    // Save authoritative word and ink coordinates. Handle metadata is transient;
    // condensing is an explicit edit and never part of persistence.
    const preserveLayout = this.doc.inserts.some(
      (insert) =>
        insert.kind === "gap" ||
        insert.kind === "line" ||
        (insert.kind === "ink" &&
          (insert.freeX !== undefined ||
            insert.freeY !== undefined ||
            (insert.flowAdvance ?? 0) > 0))
    );

    const text = textFromWords(this.doc.words);
    const newSource = this.textEdited ? this.view.rebuild(text) : this.props.block.source;
    const newRuns: InlineInkRun[] = [];
    for (const ins of this.doc.inserts) {
      if (
        ins.kind !== "ink" ||
        ins.strokes.length === 0
      ) continue;
      const visual = this.inkVisualBounds(ins);
      const afterWord =
        ins.freeX !== undefined && visual
          ? this.readingSlotAt(visual.x, visual.y + visual.height / 2)
          : ins.afterWord;
      const run = strokesToRun(ins.strokes, {
        blockId: this.props.block.id,
        anchorOffset: anchorOffsetForInsert(this.doc.words, afterWord),
        blockText: text,
        baselineOffset: ins.baselineOffset,
        ...(preserveLayout && visual
          ? { layoutX: visual.x, layoutY: visual.y }
          : {}),
        id: ins.id,
      });
      if (run) newRuns.push(run);
    }
    return Promise.resolve(this.props.onCommit({ newSource, newRuns, pageObjects: this.doc.pageObjects, layoutLineHeight: this.lineHeight, sourceWords: this.layout.placed.filter((p) => p.kind === "word" && !p.textBoxId).map(p => ({ text: p.kind === "word" ? p.text : "", x: p.x, y: p.line*this.lineHeight })), textBoxes: this.placedTextBoxes() }, intent));
  };

  private afterNativeFlush(action: () => void) {
    if (this.nativeInkActive && this.props.onBeforeNativeAction) {
      this.props.onBeforeNativeAction(action);
    } else {
      action();
    }
  }

  private requestTool(tool: Tool) {
    if (tool === this.tool && !this.keyboard) return;
    this.afterNativeFlush(() => this.setTool(tool));
  }

  private setTool(tool: Tool) {
    if (tool !== "select") this.directSelection = false;
    this.settleSpacingGesture(true);
    this.hideEraserTip();
    if (this.nativeModelDirty) {
      // Silent daemon ingestion kept `layout` current but deliberately left
      // the DOM untouched. A deliberate tool change is the safe point to
      // expose that model through the WebView-backed tools.
      this.containerEl.style.minHeight = "0px";
      this.sizeCanvas();
      this.nativeModelDirty = false;
    }
    this.keyboard = false;
    this.closeHwrSheet();
    if (tool !== "select") this.acceptTextPrompt?.();
    if (tool !== "write") this.closePenSettings();
    if(tool!=="select" || this.tool!=="select") {
      this.selectionInteraction=false;
      this.selectedInsertId=null;this.selectedTextWord=null;this.selectedTextWords.clear();
    }
    this.tool = tool;
    this.magnifyPad?.syncEraserSettings();
    this.nativeInkActive = !!this.props.native && (tool === "write" || this.usesNativeSelectionPen);
    if (tool !== "select") this.selectedInsertId = null;
    this.containerEl.className = `reflow-surface tool-${this.tool}`;
    this.updateToolbarState();
    this.renderOverlay();
    this.props.onToolChange?.(this.tool, this.keyboard);
    this.props.onLayoutChanged?.();
  }

  private textBoxWords(id: string) {
    return this.layout.placed.filter((p): p is PlacedBox & { kind: "word" } => p.kind === "word" && p.textBoxId === id)
      .sort((a, b) => (a.textWordIndex ?? 0) - (b.textWordIndex ?? 0));
  }

  /** Materialize current visual words on save; transient spacer operations are not replayed on reopen. */
  private placedTextBoxes(): import("../sidecar/schema").TextBox[] {
    return (this.doc.textBoxes ?? []).map((box) => {
      const placed = this.textBoxWords(box.id);
      const original = this.measuredBoxWords(box);
      const words = placed.map(p => ({ ...original[p.textWordIndex!], text: p.text, x: p.x, y: p.line * this.lineHeight,
        ...(p.breakBefore ? { breakBefore: p.breakBefore } : {}) }));
      return { ...box,
        x: words.length ? Math.min(...words.map((w) => w.x)) : box.x,
        y: words.length ? Math.min(...words.map((w) => w.y)) : box.y,
        words };
    });
  }

  private textBoxBounds(box: import("../sidecar/schema").TextBox) {
    const words = this.textBoxWords(box.id);
    const left = words.length ? Math.min(...words.map((w) => w.x)) : box.x;
    const top = words.length ? Math.min(...words.map((w) => w.line * this.lineHeight)) : box.y;
    const right = words.length ? Math.max(...words.map((w) => w.x + w.width)) : left + box.width;
    const bottom = words.length ? Math.max(...words.map((w) => (w.line + 1) * this.lineHeight)) : top + this.lineHeight;
    return { left, top, width: Math.max(64, right - left + 4), height: bottom - top };
  }

  private openInsertText() {
    this.setTool("select");
    this.pushHistory();
    const y = Math.max(this.containerEl.scrollTop + this.lineHeight,
      ...this.layout.placed.map(p => (p.line + 2) * this.lineHeight),
      ...this.doc.inserts.filter(ins => ins.kind === "ink").map(ins =>
        (this.layout.inkPlacements.get(ins.id)?.y ?? 0) + strokesBounds(ins.strokes, PAD).height + this.lineHeight),
      this.toolbarEl.getBoundingClientRect().bottom - this.containerEl.getBoundingClientRect().top + this.containerEl.scrollTop + this.lineHeight + 48);
    const box = { id: newInsertId("text"), blockId: this.props.block.id, text: "", x: 24,
      y: Math.ceil(y / this.lineHeight) * this.lineHeight,
      width: 64, size: this.textSize, autoWidth: true };
    this.doc = { ...this.doc, textBoxes: [...(this.doc.textBoxes ?? []), box] };
    this.relayout();
    this.editTextBox(box.id, true);
  }

  private closeTextPrompt(refresh = true) {
    const editor = this.textPromptEl;
    if (!editor) return;
    const rect = editor.parentElement!.getBoundingClientRect();
    editor.parentElement?.classList.remove("typing");
    editor.remove();
    this.containerEl.classList.remove("rw-text-editing");
    this.textPromptEl = null; this.acceptTextPrompt = null;
    this.textPromptExclusionRect = null;
    this.syncWritingExclusion();
    if (refresh) this.reportChromeRegion(rect);
  }

  private editTextBox(id: string, isNew = false) {
    if (this.textPromptEl) return;
    const box = this.doc.textBoxes?.find((b) => b.id === id);
    const node = this.containerEl.querySelector<HTMLElement>(`[data-text-box="${id}"]`);
    if (!box || !node) return;
    // Read before focusing Android IME: keyboard resize is not a new sheet size.
    const sheetHeight = this.containerEl.clientHeight;
    const before = this.doc;
    const measure=this.boxMeasure(box);
    const bounds = this.textBoxBounds(box);
    let draftX = bounds.left, draftY = bounds.top;
    const editor = document.createElement("div");
    editor.className = "rw-text-editor";
    editor.setAttribute("role", "group");
    editor.setAttribute("aria-label", isNew ? "Insert text" : "Edit text");
    const input = document.createElement("textarea");
    input.className = "rw-text-box-input";
    input.style.font=this.boxFont(box);
    input.setAttribute("aria-label", "Text box content");
    const markdownEditing=!!box.styles?.length;
    input.value = markdownEditing?serializeInlineMarkdown(box.text,box.styles):box.text; input.spellcheck = false;
    if(markdownEditing)input.setAttribute('aria-label','Text box content (Markdown styling)');
    const draftContent=()=>markdownEditing?parseInlineMarkdown(input.value):{text:input.value,styles:undefined};
    input.style.lineHeight = `${this.lineHeight}px`;
    input.style.backgroundImage = this.containerEl.style.backgroundImage;
    input.style.backgroundPosition = "0 -2px";
    // Textarea line boxes centre glyphs; placed words sit on the rule. Align the draft to
    // that same baseline without increasing a lane's height or resizing the Android IME.
    input.style.paddingTop = `${Math.max(0, (this.lineHeight - this.textSize * 1.2) / 2 - 4)}px`;
    let autoWidth = box.autoWidth !== false;
    node.style.width = `${autoWidth ? fitBoxWidth(input.value, this.width - draftX, measure.word) : Math.min(box.width, this.width - draftX)}px`;
    const rowsForText = () => input.value.split("\n").reduce((total, paragraph) => {
      const words = placeBoxWords(paragraph, 0, 0, Math.max(40, parseFloat(node.style.width) - 4), this.lineHeight, measure.word, measure.space);
      return total + Math.max(1, ...words.map(w => 1 + Math.round(w.y / this.lineHeight)));
    }, 0);
    input.rows = rowsForText();
    node.style.height = `${input.rows * this.lineHeight}px`;
    const actions = document.createElement("div"); actions.className = "rw-text-editor-header";
    // The first ruled row has no room above it. Keep confirmation reachable below
    // the resize/move handles rather than letting the header escape the viewport.
    if (bounds.top < 48) { actions.style.bottom = "auto"; actions.style.top = "calc(100% + 48px)"; }
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
    const done = document.createElement("button"); done.type = "button";
    done.textContent = "Done"; done.className = "rw-text-box-done";
    const update = () => {
      let draft:ReturnType<typeof draftContent>;
      try{draft=draftContent();input.setCustomValidity('');done.disabled=false;}
      catch(error){input.setCustomValidity(error instanceof Error?error.message:'Unsupported Markdown styling');done.disabled=true;return;}
      if (autoWidth) node.style.width = `${fitBoxWidth(input.value, this.width - draftX, measure.word)}px`;
      this.doc = { ...this.doc, textBoxes: this.doc.textBoxes?.map((b) => b.id === id
        ? { ...b, text: draft.text, styles:draft.styles, x: draftX, y: draftY, width: parseFloat(node.style.width) - 4, autoWidth, words: undefined } : b) };
      this.relayout();
      const current = this.doc.textBoxes?.find(b => b.id === id);
      if (current && input.value.trim()) {
        const position = this.textBoxBounds(current);
        node.style.left = `${position.left}px`; node.style.top = `${position.top}px`;
      }
      input.rows = rowsForText();
      node.style.height = `${input.rows * this.lineHeight}px`;
    };
    const save = () => {
      if (!editor.isConnected) return;
      if(!input.checkValidity()){input.reportValidity();return;}
      if (input.value !== (markdownEditing?serializeInlineMarkdown(box.text,box.styles):box.text) || draftX !== bounds.left || draftY !== bounds.top || Math.abs(parseFloat(node.style.width)-box.width)>4) { this.historyStack.push(before); this.redoStack = []; update(); }
      input.blur(); this.closeTextPrompt(); this.relayout();
      this.requestOverflowPagination(sheetHeight);
    };
    const discard = () => {
      if (!editor.isConnected) return;
      this.doc = isNew ? { ...before, textBoxes: before.textBoxes?.filter(b => b.id !== id) } : before;
      if (isNew) this.historyStack.pop();
      input.blur(); this.closeTextPrompt(); this.relayout();
    };
    for (const [selector, resizing] of [[".rw-text-box-handle", false], [".rw-text-box-resize", true]] as const) {
      const handle = node.querySelector<HTMLButtonElement>(selector)!;
      let start: { id:number; x:number; y:number; left:number; top:number; width:number; autoWidth:boolean } | null = null;
      handle.addEventListener("pointerdown", e=>{ if (!editor.isConnected) return; e.preventDefault(); e.stopPropagation(); start={id:e.pointerId,x:e.clientX,y:e.clientY,left:draftX,top:draftY,width:parseFloat(node.style.width),autoWidth}; handle.setPointerCapture(e.pointerId); });
      handle.addEventListener("pointermove", e=>{
        if (!start || start.id !== e.pointerId) return;
        if(resizing) { autoWidth=false; node.style.width=`${Math.max(64,Math.min(this.width-draftX,start.width+e.clientX-start.x))}px`; }
        else { draftX=Math.max(0,Math.min(this.width-start.width,start.left+e.clientX-start.x)); draftY=Math.max(0,start.top+Math.round((e.clientY-start.y)/this.lineHeight)*this.lineHeight); node.style.left=`${draftX}px`; node.style.top=`${draftY}px`; }
        update();
      });
      const release=(e:PointerEvent)=>{ if(!start || start.id!==e.pointerId)return; if(e.type==="pointercancel"){draftX=start.left;draftY=start.top;autoWidth=start.autoWidth;node.style.width=`${start.width}px`;node.style.left=`${draftX}px`;node.style.top=`${draftY}px`;} start=null;update();this.syncWritingExclusion();this.reportChromeRegion(node.getBoundingClientRect()); };
      handle.addEventListener("pointerup",release); handle.addEventListener("pointercancel",release); handle.addEventListener("lostpointercapture",release);
    }
    input.addEventListener("input", () => { update(); this.syncWritingExclusion(); this.reportChromeRegion(node.getBoundingClientRect()); });
    const activate = (button: HTMLButtonElement, action: () => void) => {
      let start: { id: number; x: number; y: number } | null = null;
      let penUp = -Infinity;
      button.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "pen") start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      button.addEventListener("pointercancel", () => { start = null; });
      button.addEventListener("pointerup", (e) => {
        if (!start || start.id !== e.pointerId) return;
        const tapped = Math.hypot(e.clientX - start.x, e.clientY - start.y) < 10;
        start = null;
        if (!tapped || button.disabled) return;
        e.preventDefault(); e.stopPropagation(); penUp = performance.now(); action();
      });
      button.addEventListener("click", (e) => {
        if (performance.now() - penUp < 600) { e.preventDefault(); return; }
        action();
      });
    };
    activate(cancel, discard); activate(done, save);
    editor.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); discard(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });
    actions.append(cancel, done); editor.append(actions, input); node.append(editor); node.classList.add("typing");
    this.containerEl.classList.add("rw-text-editing");
    this.textPromptEl = editor; this.acceptTextPrompt = save;
    update();
    this.containerEl.querySelectorAll<HTMLElement>(`[data-text-box-word="${id}"]`).forEach(word => word.style.visibility = "hidden");
    const rect = node.getBoundingClientRect();
    this.textPromptExclusionRect = { l: rect.left - 24, t: rect.top - 48, r: rect.right + 24, b: rect.bottom + 44 };
    this.syncWritingExclusion(); this.reportChromeRegion(rect);
    input.focus(); input.scrollIntoView?.({ block: "nearest" });
  }

  private textBoxIcon(kind: "move" | "resize" | "delete"): string {
    const paths = kind === "move" ? '<path d="M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4"/>'
      : kind === "resize" ? '<path d="M5 5l14 14M5 11V5h6M13 19h6v-6"/>'
      : '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }

  private renderTextBoxes() {
    this.containerEl.querySelectorAll<HTMLElement>(".rw-text-box").forEach((node) => {
      if (!this.doc.textBoxes?.some((b) => b.id === node.dataset.textBox)) node.remove();
    });
    if (this.tool !== "select" || this.keyboard) return;
    for (const box of this.doc.textBoxes ?? []) {
      if (box.checkbox) continue;
      if (box.id.startsWith("template-") && this.selectedTemplateSectionId && box.id !== this.selectedTemplateSectionId) {
        this.containerEl.querySelector<HTMLElement>(`[data-text-box="${box.id}"]`)?.remove();
        continue;
      }
      const retained = this.containerEl.querySelector<HTMLElement>(`[data-text-box="${box.id}"]`);
      if (retained?.contains(this.textPromptEl)) {
        this.containerEl.querySelectorAll<HTMLElement>(`[data-text-box-word="${box.id}"]`).forEach(word => word.style.visibility = "hidden");
        retained.querySelector<HTMLTextAreaElement>("textarea")?.scrollIntoView?.({ block: "nearest" });
        continue;
      }
      retained?.remove();
      const bounds = this.textBoxBounds(box);
      const node = document.createElement("div");
      node.className = "rw-text-box editable"; node.dataset.textBox = box.id;
      if(box.id.startsWith("template-"))node.dataset.templateControl="true";
      node.classList.toggle('controls-active',box.id.startsWith('template-') || this.selectedTextWord?.boxId===box.id);
      node.addEventListener('click',e=>{
        if((e.target as Element)?.closest('button,input,textarea') || this.selectedTextWord?.boxId===box.id)return;
        this.selectedTextWord={boxId:box.id,index:0};this.renderOverlay();
      });
      node.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${Math.min(Math.max(bounds.width, box.autoWidth === false ? box.width : 0), this.width - bounds.left)}px;height:${bounds.height}px;font-size:${this.textSize}px`;
      const content = document.createElement("div"); content.className = "rw-text-box-content";
      node.appendChild(content);
      const handle = document.createElement("button"); handle.className = "rw-text-box-handle";
      handle.innerHTML = this.textBoxIcon("move"); handle.setAttribute("aria-label", "Move text box");
      let drag: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
      const wordNodes = () => this.containerEl.querySelectorAll<HTMLElement>(`[data-text-box-word="${box.id}"]`);
      handle.addEventListener("pointerdown", (e) => {
        if (this.textPromptEl) return;
        e.preventDefault(); e.stopPropagation();
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        e.stopPropagation();
        drag.dx = Math.max(-bounds.left, Math.min(this.width - bounds.left - bounds.width, e.clientX - drag.x));
        drag.dy = Math.max(-bounds.top, Math.round((e.clientY - drag.y) / this.lineHeight) * this.lineHeight);
        node.style.transform = `translate(${drag.dx}px,${drag.dy}px)`;
        wordNodes().forEach((n) => n.style.transform = node.style.transform);
      });
      const finish = (e: PointerEvent) => {
        if (!drag || drag.id !== e.pointerId) return;
        e.stopPropagation();
        const { dx, dy } = e.type === "pointercancel" ? { dx: 0, dy: 0 } : drag;
        drag = null;
        if (dx || dy) {
          this.pushHistory();
          const visible = this.placedTextBoxes().find((b) => b.id === box.id)!;
          this.doc = { ...this.doc, textBoxes: this.doc.textBoxes?.map((b) => b.id === box.id
            ? { ...visible, x: visible.x + dx, y: visible.y + dy,
                words: visible.words?.map((w) => ({ ...w, x: w.x + dx, y: w.y + dy })) } : b) };
        }
        this.relayout(); this.props.onLayoutChanged?.();
      };
      handle.addEventListener("pointerup", finish); handle.addEventListener("pointercancel", finish); handle.addEventListener("lostpointercapture", finish);
      node.addEventListener("dblclick", () => this.editTextBox(box.id));
      const edit = document.createElement("button"); edit.className = "rw-text-box-edit"; edit.textContent = "Edit text"; edit.addEventListener("click", () => this.editTextBox(box.id));
      const remove = document.createElement("button"); remove.className = "rw-text-box-delete"; remove.innerHTML = this.textBoxIcon("delete"); remove.setAttribute("aria-label", "Delete text box");
      remove.addEventListener("click", () => { this.closeTextPrompt(); this.pushHistory(); this.doc = { ...this.doc, textBoxes: this.doc.textBoxes?.filter((b) => b.id !== box.id) }; this.relayout(); this.props.onLayoutChanged?.(); });
      const resize = document.createElement("button"); resize.className = "rw-text-box-resize";
      resize.innerHTML = this.textBoxIcon("resize"); resize.setAttribute("aria-label", "Resize text box");
      let sizing: { id: number; x: number; width: number; height: number } | null = null;
      resize.addEventListener("pointerdown", e => {
        e.preventDefault(); e.stopPropagation();
        if (this.textPromptEl) return;
        sizing = { id: e.pointerId, x: e.clientX, width: bounds.width, height: bounds.height };
        resize.setPointerCapture(e.pointerId);
      });
      resize.addEventListener("pointermove", e => {
        if (!sizing || sizing.id !== e.pointerId) return;
        node.style.width = `${Math.max(64, Math.min(this.width - bounds.left, sizing.width + e.clientX - sizing.x))}px`;
      });
      const finishSize = (e: PointerEvent) => {
        if (!sizing || sizing.id !== e.pointerId) return;
        const original = sizing; sizing = null;
        if (e.type !== "pointercancel") {
          this.pushHistory();
          this.doc = { ...this.doc, textBoxes: this.doc.textBoxes?.map(b => b.id === box.id
            ? { ...b, x: bounds.left, y: bounds.top, width: parseFloat(node.style.width), autoWidth: false, words: undefined } : b) };
        } else { node.style.width = `${original.width}px`; }
        this.relayout(); this.props.onLayoutChanged?.();
      };
      resize.addEventListener("pointerup", finishSize); resize.addEventListener("pointercancel", finishSize); resize.addEventListener("lostpointercapture", finishSize);
      const tools = document.createElement("div"); tools.className = "rw-text-box-tools"; tools.append(edit);
      if (bounds.top < 48) { tools.style.bottom="auto";tools.style.top="calc(100% + 48px)"; }
      // Template labels already open on tap; duplicating an Edit button adds clutter.
      if (!box.id.startsWith("template-")) node.prepend(tools);
      node.append(handle, remove, resize);
      if (box.id.startsWith("template-")) {
        // A template section ends at the next heading row. Its boundary uses the
        // SAME line insert as the spacing tool: downstream ink/text move together
        // and completion retains Undo, save/export and overflow pagination.
        const next = this.placedTextBoxes().filter(b => !b.checkbox && b.id.startsWith("template-") && b.y > bounds.top).sort((a,b) => a.y-b.y)[0];
        const boundaryY = next?.y ?? Math.max(bounds.top + this.lineHeight * 2, this.containerEl.clientHeight - this.lineHeight);
        const boundary = document.createElement("button");
        boundary.className = "rw-section-boundary";
        boundary.setAttribute("aria-label", `Resize section: ${box.text}`);
        boundary.title = "Drag to change section height";
        boundary.style.top = `${boundaryY - bounds.top}px`;
        const column = this.doc.pageObjects?.find(object => object.id === "cornell-divider");
        const sectionRight = column && bounds.left < column.x ? column.x : this.width - 12;
        boundary.style.width = `${Math.max(40, sectionRight - bounds.left)}px`;
        let start: {id:number;y:number;dy:number} | null = null;
        boundary.addEventListener("pointerdown", e => {
          if (this.textPromptEl) return;
          e.preventDefault(); e.stopPropagation();
          start={id:e.pointerId,y:e.clientY,dy:0};boundary.setPointerCapture?.(e.pointerId);
        });
        boundary.addEventListener("pointermove", e => {
          if (!start || start.id !== e.pointerId) return;
          e.stopPropagation();
          start.dy=Math.max(bounds.top + this.lineHeight - boundaryY, Math.round((e.clientY-start.y)/this.lineHeight)*this.lineHeight);
          boundary.style.transform=`translateY(${start.dy}px)`;
        });
        const finishSection = (e:PointerEvent) => {
          if (!start || start.id !== e.pointerId) return;
          e.stopPropagation(); const dy=e.type === "pointercancel" ? 0 : start.dy;start=null;boundary.style.transform="";
          if (!dy) return;
          this.afterNativeFlush(() => {
            const row=Math.max(0,Math.round(boundaryY/this.lineHeight));
            const operation=this.startLines(this.lineAnchorForY(boundaryY),row);
            this.finishLines(operation.prevLines + Math.round(dy/this.lineHeight));
            // Cornell's starter divider ends where the summary begins. Other free
            // shapes keep their independent positions, as in ordinary line spacing.
            const summary=this.placedTextBoxes().find(b => b.id === "template-3");
            if (column && summary) {
              this.doc={...this.doc,pageObjects:this.doc.pageObjects?.map(object => object.id === column.id ? {...object,height:Math.max(this.lineHeight,summary.y-object.y)} : object)};
              this.relayout();
            }
            this.props.onLayoutChanged?.();
          });
        };
        boundary.addEventListener("pointerup",finishSection);boundary.addEventListener("pointercancel",finishSection);
        boundary.addEventListener("lostpointercapture",finishSection);node.append(boundary);
      }
      node.addEventListener("pointerdown", (e) => {
        // Plain text in Select uses the same pen word gesture as ink. Controls
        // retain their own drag/edit handlers, and finger presses stay local.
        if (e.pointerType !== "pen" || (e.target as Element)?.closest("button,input,textarea")) e.stopPropagation();
      });
      this.containerEl.appendChild(node);
    }
  }

  private toggleKeyboard() {
    this.keyboard = !this.keyboard;
    if (this.keyboard) this.closePenSettings();
    this.nativeInkActive = !!this.props.native && (this.tool === "write" || this.usesNativeSelectionPen) && !this.keyboard;
    this.updateToolbarState();
    this.renderOverlay();
    this.props.onToolChange?.(this.tool, this.keyboard);
    this.props.onLayoutChanged?.();
  }

  // ---- Toolbar (built once; state reflected via updateToolbarState) ----
  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement("div");
    // Match the drawing editor's tab-first progression: the ruled page opens
    // clean, and the complete toolbar appears only when its edge tab is tapped.
    bar.className = "tool-pill toolbar-collapsed";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Editing tools");

    const btn = (
      fallback: string,
      icon: string,
      title: string,
      onClick: () => void,
      ariaLabel?: string,
      action?: string
    ) => {
      const b = document.createElement("button");
      const iconHtml = window.KalamosToolbarIcons?.svg(icon);
      if (iconHtml) {
        b.innerHTML = iconHtml;
        b.classList.add("toolbar-icon-button");
      } else {
        b.textContent = fallback;
      }
      b.dataset.icon = icon;
      b.dataset.label = title;
      if (action) b.dataset.action = action;
      b.title = title;
      b.setAttribute("aria-label", ariaLabel ?? title);
      // The handle retains its own tap/drag completion protocol.
      bindPenButton(b, onClick, icon !== "handle");
      return b;
    };

    const sep = () => {
      const s = document.createElement("span");
      s.className = "pill-sep";
      s.setAttribute("aria-hidden", "true");
      return s;
    };

    const clampToolbarPosition = () => {
      if (!bar.classList.contains("toolbar-positioned") || bar.classList.contains("toolbar-all-tools")) return;
      const root = this.root.getBoundingClientRect(), rect = bar.getBoundingClientRect();
      // A saved position must remain reachable after rotation or opening the taller pill.
      const left = Math.max(0,Math.min(parseFloat(bar.style.left),root.width-rect.width));
      const top = Math.max(0,Math.min(parseFloat(bar.style.top),root.height-rect.height));
      bar.style.left = `${left}px`; bar.style.top = `${top}px`;
    };
    const reportToolbarLayout = (before: DOMRect) => {
      requestAnimationFrame(() => {
        clampToolbarPosition();
        this.syncWritingExclusion();
        const after = bar.getBoundingClientRect();
        if (this.props.onToolbarLayoutChange) {
          this.props.onToolbarLayoutChange(
            { l: before.left, t: before.top, r: before.right, b: before.bottom },
            { l: after.left, t: after.top, r: after.right, b: after.bottom }
          );
        } else {
          this.props.onLayoutChanged?.();
        }
      });
    };

    const core = document.createElement("div");
    core.className = "toolbar-core";
    const rail = document.createElement("div");
    rail.className = "toolbar-more-rail";
    const shapes=btn("◇","shape","Shapes / free drawing",()=>this.afterNativeFlush(()=>{
      this.setTool("objects"); this.openObjectSettings(shapes);
    }),"Shapes / free drawing","shapes");shapes.innerHTML=inkToolIcon("shapes");shapes.dataset.label="Shapes";shapes.dataset.tool = "objects"; shapes.classList.add("toolbar-more");rail.append(shapes);

    const expandBtn = btn(
      "▦",
      "template",
      "Expand tools",
      () => {
        const expanded = bar.classList.toggle("toolbar-all-tools");
        if (!expanded && this.props.notebookToolbar) {
          bar.classList.add("toolbar-collapsed");
          handleBtn.setAttribute("aria-expanded", "false");
          handleBtn.title = "Hold to move; tap to show toolbar";
          handleBtn.setAttribute("aria-label", "Show toolbar");
        }
        arrangeExpandedTools(expanded);
        expandBtn.setAttribute("aria-expanded", String(expanded));
        expandBtn.setAttribute("aria-pressed", String(expanded));
        expandBtn.title = expanded ? (this.props.notebookToolbar ? "Collapse tools" : "Use compact toolbar") : "Expand tools";
        expandBtn.setAttribute("aria-label", expanded ? (this.props.notebookToolbar ? "Collapse tools" : "Use compact toolbar") : "Expand tools");
        this.props.onToolbarModeChange?.(expanded ? "full" : this.props.notebookToolbar ? "collapsed" : "compact");
        requestAnimationFrame(() => {
          clampToolbarPosition();
          this.syncWritingExclusion();
          this.props.onLayoutChanged?.();
        });
      },
      "Expand tools",
      "toolbar-expand"
    );
    expandBtn.classList.add("toolbar-expand");
    expandBtn.dataset.label = "Compact";
    expandBtn.setAttribute("aria-expanded", "false");
    expandBtn.setAttribute("aria-pressed", "false");
    bar.appendChild(expandBtn);

    // Reuse these history controls in both layouts rather than cloning them, so pen flushes,
    // Zoom placement Undo and native chrome ownership keep one action path.
    const undoBtn = btn("↶", "undo", "Undo", () => this.afterNativeFlush(() => {
      if (this.magnifyPad) this.magnifyPad.undo(); else this.undo();
    }), "Undo", "undo");
    const redoBtn = btn("↷", "redo", "Redo", () => this.afterNativeFlush(() => {
      if (!this.magnifyPad?.redoPendingStroke()) { this.redo(); this.magnifyPad?.refreshContext(); }
    }), "Redo", "redo");
    for (const history of [undoBtn, redoBtn]) {
      history.classList.add("toolbar-more", "toolbar-history");
      history.dataset.label = history.dataset.action === "undo" ? "Undo" : "Redo";
    }
    rail.prepend(undoBtn, redoBtn);
    const writeBtn = btn(
      "✎",
      "pen",
      "Write / pen settings",
      () => {
        if (this.tool === "write" && !this.keyboard) {
          this.togglePenSettings(writeBtn);
          return;
        }
        this.afterNativeFlush(() => {
          this.setTool("write");
          this.openPenSettings(writeBtn);
        });
      },
      "Write or change pen settings",
      "write"
    );
    writeBtn.dataset.tool = "write";
    core.appendChild(writeBtn);
    const spacingLabel=this.props.notebookToolbar ? "Horizontal spacing" : "Spacing tools";
    const spacingBtn=btn("↔","spaceHorizontal",spacingLabel,()=>this.afterNativeFlush(()=>{
      if(this.props.notebookToolbar && !bar.classList.contains("toolbar-all-tools") && this.tool!=="insert") {
        this.closePenSettings(); this.setTool("insert");
      } else this.openSpacingSettings(spacingBtn);
    }),spacingLabel,"spacing");
    spacingBtn.dataset.tool="insert";spacingBtn.dataset.label="Spacing";spacingBtn.classList.add("toolbar-more");rail.append(spacingBtn);
    const eraseBtn = btn("⌫", "eraser", "Eraser", () => this.afterNativeFlush(() => { this.setTool("erase"); this.openEraserSettings(eraseBtn); }), "Eraser", "erase");
    eraseBtn.dataset.tool = "erase";
    core.appendChild(eraseBtn);
    const selectBtn = btn("□", "lasso", "Tap a word to move, or draw around words to select", () => this.afterNativeFlush(()=>this.startLasso()), "Select or move words", "select");
    selectBtn.dataset.tool = "select";
    core.appendChild(selectBtn);
    const pointerBtn = btn("↖", "pointer", "Tap to select or move an item", () => this.afterNativeFlush(() => {
      if (this.directSelection && this.tool === "select") { this.openLassoSettings(pointerBtn); return; }
      this.directSelection = true; this.selectedObjectId = null;
      this.setTool("select");
    }), "Select item", "pointer");
    pointerBtn.innerHTML=inkToolIcon('pointer'); pointerBtn.classList.add('toolbar-icon-button');
    pointerBtn.dataset.tool="select"; pointerBtn.dataset.label="Select";
    core.append(pointerBtn);

    this.copyBtn = btn("⧉", "copy", "Copy selected words", () => this.afterNativeFlush(()=>this.duplicateSelectedInk()), "Copy selected words", "copy");
    this.copyBtn.className = "copy-ink";
    this.copyBtn.dataset.label = "Copy";
    core.appendChild(this.copyBtn);

    this.deleteBtn = btn("×", "delete", "Delete selected words", () => this.afterNativeFlush(() => this.deleteSelectedBlocks()), "Delete selected words", "delete");
    this.deleteBtn.className = "delete-ink";
    this.deleteBtn.dataset.label = "Delete";
    core.appendChild(this.deleteBtn);

    this.convertBtn = btn(
      "A",
      "text",
      "Convert selected handwriting to text",
      () => this.afterNativeFlush(()=>this.convertSelectedToText()),
      "Convert selected handwriting to text",
      "convert"
    );
    this.convertBtn.className = "convert-ink";
    this.convertBtn.dataset.label = "Convert";
    core.appendChild(this.convertBtn);

    const magnifyBtn = btn(
      "+",
      "magnify",
      "Magnified writing — write large below, placed small at the target",
      () => this.toggleMagnify(),
      "Magnified writing",
      "magnify"
    );
    magnifyBtn.classList.add("toolbar-secondary", "toolbar-more");
    magnifyBtn.dataset.label = "Zoom";
    rail.appendChild(magnifyBtn);
    const textBtn = btn("T", "text", "Add a movable text box",
      () => this.afterNativeFlush(() => this.openInsertText()), "Insert text", "insert-text");
    textBtn.classList.add("toolbar-secondary", "toolbar-more");
    textBtn.dataset.label = "Text";
    rail.appendChild(textBtn);
    if (this.props.pageTools) {
      for (const [action,label,icon,fallback] of [["add","Add page","newNote","+"],[-1,"Previous page","prev","‹"],[1,"Next page","next","›"]] as const) {
        const pageBtn = btn(fallback,icon,label,()=>this.afterNativeFlush(()=>this.props.pageTools!.change(action)),label,`page-${action}`);
        pageBtn.dataset.label = action === -1 ? "Previous" : action === 1 ? "Next" : "Add page"; pageBtn.classList.add("toolbar-page-button");
        pageBtn.disabled = action === -1 ? this.props.pageTools.index === 0 : action === 1 ? this.props.pageTools.index === this.props.pageTools.count-1 : false;
        if (action === "add" && !this.props.notebookToolbar) { pageBtn.classList.add("toolbar-more"); rail.appendChild(pageBtn); }
        else {
          core.appendChild(pageBtn);
          if(action===-1){
            const overview=btn("Pages","grid","Page overview",()=>this.afterNativeFlush(()=>this.props.pageTools!.overview?this.props.pageTools!.overview():this.openPageSettings(overview)),"Page overview","pages");
            overview.classList.add("toolbar-page-overview");overview.innerHTML+=`<span>${this.props.pageTools.index+1}/${this.props.pageTools.count}</span>`;
            core.append(overview);
          }
        }
      }
    }
    for (const [index, action] of (this.props.documentActions ?? []).entries()) {
      const documentBtn = btn(action.label, action.icon ?? "ai", action.label, () => {
        if (action.options?.length) {
          this.afterNativeFlush(() => this.openDocumentActionMenu(documentBtn, action));
        } else this.runDocumentAction(action);
      }, action.label, index === 0 ? "document-action" : `document-action-${index}`);
      documentBtn.dataset.label = action.shortLabel ?? action.label;
      documentBtn.classList.add("toolbar-more"); rail.append(documentBtn);
    }
    const pasteBtn=btn("Paste","paste","Paste selection",()=>this.afterNativeFlush(()=>this.pasteSelection()),"Paste selection","paste");
    pasteBtn.innerHTML=inkToolIcon('paste');pasteBtn.classList.add('toolbar-more');pasteBtn.dataset.label='Paste';rail.append(pasteBtn);
    const keyboardBtn = btn(
      "ABC",
      "keyboard",
      "Insert or edit typed text",
      () => this.afterNativeFlush(() => this.toggleKeyboard()),
      "Edit typed text",
      "keyboard"
    );
    keyboardBtn.classList.add("toolbar-secondary", "toolbar-more");
    keyboardBtn.dataset.label = "Edit text";
    rail.appendChild(keyboardBtn);
    core.appendChild(sep());

    if (this.props.showSessionActions !== false) {
      const cancelBtn = btn("Cancel", "close", "Cancel editing", () => this.props.onCancel(), "Cancel editing", "cancel");
      cancelBtn.className = "cancel toolbar-text-button";
      core.appendChild(cancelBtn);

      const doneBtn = btn("Done", "check", "Finish editing", () => this.afterNativeFlush(this.handleDone), "Finish editing", "done");
      doneBtn.className = "done toolbar-text-button";
      core.appendChild(doneBtn);
    }

    // Move the original controls, preserving their flush handlers, state and native ownership.
    // Restore their exact compact order on exit; no cloned buttons or second toolbar owner.
    const colorSlots: HTMLButtonElement[] = [];
    if (this.props.notebookToolbar) {
      for (const slot of [0, 1]) {
        const color = document.createElement("button");
        color.type = "button";
        color.className = "toolbar-color-slot";
        color.dataset.colorSlot = String(slot);
        color.innerHTML = '<span aria-hidden="true"></span>';
        bindPenButton(color, () => this.afterNativeFlush(() => {
          const colours = this.notebookColors();
          if (this.inkColor.toLowerCase() === colours[slot].toLowerCase()) {
            this.notebookColorSlot = slot;
            this.openNotebookPalette(color);
          } else {
            this.notebookColorSlot = slot;
            this.closePenSettings();
            this.applyNotebookStyle(colours[slot], this.penWidth);
            this.reportChromeRegion(color.getBoundingClientRect());
          }
        }));
        colorSlots.push(color);
      }
      writeBtn.after(...colorSlots);
    }
    const compactCore = Array.from(core.children);
    const compactRail = Array.from(rail.children);
    const arrangeExpandedTools = (expanded: boolean) => {
      if (!this.props.notebookToolbar) return;
      this.closePenSettings(false);
      spacingBtn.title = expanded ? "Spacing tools" : "Horizontal spacing";
      spacingBtn.setAttribute("aria-label",spacingBtn.title);
      if (!expanded) {
        core.replaceChildren(...compactCore);
        rail.replaceChildren(...compactRail);
        return;
      }
      const navigation = compactCore.filter(el => el.classList.contains("toolbar-page-button") || el.classList.contains("toolbar-page-overview"));
      const tools = [writeBtn, ...colorSlots, eraseBtn, selectBtn, pointerBtn, spacingBtn, magnifyBtn, textBtn, shapes,
        keyboardBtn, pasteBtn, ...compactRail.filter(el => (el as HTMLElement).dataset.action?.startsWith("document-action")), undoBtn, redoBtn,
        this.copyBtn!, this.deleteBtn!, this.convertBtn!];
      for (const tool of [writeBtn, eraseBtn, selectBtn]) {
        tool.dataset.label = tool === writeBtn ? "Pen" : tool === eraseBtn ? "Eraser" : "Select";
      }
      core.replaceChildren(...navigation, ...compactCore.filter(el => el.classList.contains("cancel") || el.classList.contains("done")));
      rail.replaceChildren(...tools);
    };
    bar.classList.toggle("notebook-toolbar", !!this.props.notebookToolbar);
    bar.append(core, rail);

    const savedPosition = this.props.prefs.toolbarPosition;
    if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
      bar.style.left = `${Math.max(0,savedPosition.left)}px`;
      bar.style.top = `${Math.max(0,savedPosition.top)}px`;
      bar.classList.add("toolbar-positioned");
    }
    let suppressToolbarToggle = false;
    const handleBtn = btn(
      "||",
      "handle",
      "Show toolbar",
      () => {
        if (suppressToolbarToggle) {
          return;
        }
        const before = bar.getBoundingClientRect();
        const collapsed = bar.classList.toggle("toolbar-collapsed");
        if (collapsed) {
          bar.classList.remove("toolbar-all-tools");
          arrangeExpandedTools(false);
          expandBtn.setAttribute("aria-expanded", "false");
          expandBtn.setAttribute("aria-pressed", "false");
          expandBtn.title = "Expand tools";
          expandBtn.setAttribute("aria-label", "Expand tools");
        }
        handleBtn.setAttribute("aria-expanded", String(!collapsed));
        handleBtn.title = collapsed ? "Hold to move; tap to show toolbar" : "Drag to move; tap to hide toolbar";
        handleBtn.setAttribute(
          "aria-label",
          collapsed ? "Show toolbar" : "Move or hide toolbar"
        );
        this.props.onToolbarModeChange?.(collapsed ? "collapsed" : "compact");
        reportToolbarLayout(before);
      },
      "Show toolbar",
      "toolbar-toggle"
    );
    handleBtn.className = "toolbar-handle toolbar-icon-button";
    handleBtn.setAttribute("aria-expanded", "false");
    handleBtn.style.touchAction = "none";
    bar.appendChild(handleBtn);

    let drag:
      | {
          pointerId: number;
          startRect: DOMRect;
          startX: number;
          startY: number;
          barLeft: number;
          barTop: number;
          rootLeft: number;
          rootTop: number;
          maxLeft: number;
          maxTop: number;
          moved: boolean;
        }
      | null = null;

    let dragHoldTimer: number | undefined;
    let dragArmed = false;
    let handlePen = false;
    let handleReleasedAt = -Infinity;
    handleBtn.addEventListener("pointerdown", (event) => {
      if (drag) return;
      event.preventDefault();
      suppressToolbarToggle = false;
      handlePen = event.pointerType === "pen";
      dragArmed = !bar.classList.contains("toolbar-collapsed");
      window.clearTimeout(dragHoldTimer);
      if (!dragArmed) dragHoldTimer = window.setTimeout(() => {
        dragArmed = true; suppressToolbarToggle = true;
      }, 400);
      const rect = bar.getBoundingClientRect();
      const rootRect = this.root.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startRect: rect,
        startX: event.clientX,
        startY: event.clientY,
        barLeft: rect.left,
        barTop: rect.top,
        rootLeft: rootRect.left,
        rootTop: rootRect.top,
        maxLeft: Math.max(rootRect.left, rootRect.right - rect.width),
        maxTop: Math.max(rootRect.top, rootRect.bottom - rect.height),
        moved: false,
      };
      handleBtn.setPointerCapture?.(event.pointerId);
    });

    handleBtn.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!dragArmed) {
        if (Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>10) window.clearTimeout(dragHoldTimer);
        return;
      }
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        // A tap on the dual-purpose handle only expands/collapses chrome. Starting the native
        // handoff after the drag threshold prevents that tap from detaching and reattaching the
        // ink surface, which is both wasteful on Standard and a visible refresh risk on Bigme.
        this.props.onToolbarDragChange?.(true);
      }
      const left = Math.min(drag.maxLeft, Math.max(drag.rootLeft, drag.barLeft + dx));
      const top = Math.min(drag.maxTop, Math.max(drag.rootTop, drag.barTop + dy));
      bar.style.left = `${left - drag.rootLeft}px`;
      bar.style.top = `${top - drag.rootTop}px`;
      bar.classList.add("toolbar-positioned");
      event.preventDefault();
      this.syncWritingExclusion();
    });

    const finishToolbarDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = drag.moved;
      const startRect = drag.startRect;
      drag = null;
      window.clearTimeout(dragHoldTimer);
      if (event.type !== "pointerup") suppressToolbarToggle = true;
      if (handleBtn.hasPointerCapture?.(event.pointerId)) {
        handleBtn.releasePointerCapture(event.pointerId);
      }
      if (!moved) {
        if (event.type === "pointerup" && handlePen && !suppressToolbarToggle) {
          handleReleasedAt = performance.now(); handleBtn.click();
        }
        return;
      }
      this.props.prefs = {...this.props.prefs, toolbarPosition: {left:parseFloat(bar.style.left),top:parseFloat(bar.style.top)}};
      this.props.onPreferencesChange?.(this.props.prefs);
      this.props.onToolbarDragChange?.(false);
      suppressToolbarToggle = true;
      this.syncWritingExclusion();
      // Standard Android keeps the native writing surface attached during toolbar movement. The
      // DOM therefore moves behind that opaque surface and this one bounded old/new capture makes
      // the final position visible without a SurfaceView or display-mode transition. Bigme's live
      // handoff also uses the report to reconcile its final captured position after reattach.
      reportToolbarLayout(startRect);
    };
    // Swallow the delayed compatibility click after an explicit pen release.
    handleBtn.addEventListener("click", event => {
      if (event.isTrusted && performance.now()-handleReleasedAt<600) event.stopImmediatePropagation();
    }, true);
    handleBtn.addEventListener("pointerup", finishToolbarDrag);
    handleBtn.addEventListener("pointercancel", finishToolbarDrag);
    handleBtn.addEventListener("lostpointercapture", finishToolbarDrag);

    requestAnimationFrame(clampToolbarPosition);
    return bar;
  }

  private togglePenSettings(anchor: HTMLElement) {
    if (this.penSettingsEl) {
      this.closePenSettings();
      return;
    }
    this.openPenSettings(anchor);
  }

  private runDocumentAction(action: DocumentAction) {
    if (action.onPress?.() === false) return;
    this.afterNativeFlush(() => { this.closePenSettings(); action.run?.(); });
  }

  private openDocumentActionMenu(anchor: HTMLElement, action: DocumentAction) {
    this.closePenSettings(false);
    const panel = document.createElement("div");
    panel.className = "pen-settings-panel rw-tool-menu rw-document-actions";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", action.label);
    const heading = document.createElement("strong"); heading.textContent = action.label; panel.append(heading);
    for (const option of action.options ?? []) {
      const button = document.createElement("button"); button.type = "button";
      button.setAttribute("aria-label", option.label);
      button.innerHTML = window.KalamosToolbarIcons?.svg(option.icon ?? "ai") ?? inkToolIcon("pen");
      const label = document.createElement("span"); label.textContent = option.label; button.append(label);
      bindPenButton(button, () => this.runDocumentAction(option)); panel.append(button);
    }
    this.mountNotebookMenu(panel, anchor);
  }

  private openPageSettings(anchor: HTMLElement) {
    const pages = this.props.pageTools;
    if (!pages) return;
    this.closePenSettings(false);
    const panel = document.createElement("div");
    panel.className = "pen-settings-panel rw-eraser-settings";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Notebook pages");
    const title = document.createElement("strong"); title.textContent = `Page ${pages.index + 1} of ${pages.count}`;
    panel.append(title);
    for (const [action, label, disabled] of [[-1, "Previous page", pages.index === 0], [1, "Next page", pages.index === pages.count - 1], ["add", "Add page", false]] as const) {
      const button = document.createElement("button"); button.textContent = label; button.disabled = disabled;
      button.addEventListener("click", () => { this.closePenSettings(); pages.change(action); });
      panel.append(button);
    }
    this.root.append(panel); this.penSettingsEl = panel;
    const r = this.root.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(r.left+8, Math.min(this.props.notebookToolbar ? a.right+1 : a.left, r.right-panel.getBoundingClientRect().width-8))}px`;
    panel.style.top = `${Math.max(r.top+8, Math.min(this.props.notebookToolbar ? a.top : a.bottom+8, r.bottom-panel.getBoundingClientRect().height-8))}px`;
    requestAnimationFrame(() => { if (this.penSettingsEl !== panel) return; const b = panel.getBoundingClientRect(); this.penSettingsExclusionRect = { l:b.left,t:b.top,r:b.right,b:b.bottom }; this.syncWritingExclusion(); this.reportChromeRegion(b); });
  }

  /** Free objects stay outside the ruled reflow model. This is deliberate: a
   * diagram must not break into handwriting words when a lane is spaced. */
  private makeObject(points: InkPoint[]): PageObject {
    const bounds=this.objectKind==="sketch"?boundsOfPoints(points):objectDragBounds(points[0],points[points.length-1]);
    const {x,y}=bounds,width=Math.max(1,bounds.width),height=Math.max(1,bounds.height);
    const selected = this.objectKind === "line" ? [points[0], points[points.length - 1]] : points;
    return { id: newInsertId("object"), blockId: this.props.block.id, kind: this.objectKind, x, y, width, height,
      color: this.objectColor, strokeWidth: this.objectWidth, lineStyle:this.objectLineStyle, paper: !this.objectOutline,
      points: selected.map(p => ({ x: (p.x-x)/width*100, y: (p.y-y)/height*100 })) };
  }

  private previewObject() {
    const draft = this.objectDraft;
    if (!draft) return;
    let node = this.containerEl.querySelector<HTMLElement>(".page-object-draft");
    if (!node) { node = document.createElement("div"); node.className = "page-object-draft"; this.containerEl.append(node); }
    const object=this.makeObject(draft.points);
    // Outer SVG x/y attributes position nested SVG only, not an HTML child.
    // Use the same CSS wrapper geometry as the committed object throughout contact/drag.
    node.style.cssText=`left:${object.x}px;top:${object.y}px;width:${object.width}px;height:${object.height}px;right:auto;bottom:auto`;
    node.innerHTML = objectSvg({...object,x:0,y:0});
  }

  private nativeOwnsControlPen(): boolean {
    return this.nativeInkActive && this.tool === "write" && !this.magnifyPad;
  }

  private checkboxActivation(id: string): PenButtonActivation {
    let activation = this.checkboxActivations.get(id);
    if (!activation) { activation = { activatedAt: -Infinity }; this.checkboxActivations.set(id, activation); }
    return activation;
  }

  private setChecklist(id: string, checked: boolean) {
    const box = this.doc.textBoxes?.find(b => b.id === id && b.checkbox);
    // The daemon may already have applied this contact while the WebView waited for its flush.
    // Repeating the requested state must not toggle again, add history or capture another frame.
    if (!box || (box.text === "☑") === checked) return;
    const node = Array.from(this.containerEl.querySelectorAll<HTMLElement>("[data-text-box-word]")).find(n => n.dataset.textBoxWord === id);
    const rect = node?.getBoundingClientRect();
    this.pushHistory(); const text = checked ? "☑" : "☐";
    this.doc = { ...this.doc, textBoxes: this.doc.textBoxes?.map(b => b.id === id ? { ...b, text, words: b.words?.map(w => ({ ...w, text })) } : b) };
    // Checked state changes no lane geometry. Keep this repaint bounded;
    // relayout() would request a whole-paper native capture for one checkbox.
    this.layout = this.computeLayout(); this.nativeModelDirty = false; this.renderOverlay();
    if (rect) this.props.onContentRegionChange?.({l:rect.left-4,t:rect.top,r:rect.left+44,b:rect.bottom});
  }

  private renderPageObjects() {
    const ids=new Set(this.doc.pageObjects?.map(object=>object.id));
    for(const [id,cached] of this.pageObjectNodes)if(!ids.has(id)){cached.node.remove();this.pageObjectNodes.delete(id);}
    const native=!!(this.nativeInkActive && !this.nativeWebHandoff && !this.nativeDialogHandoff && !this.magnifyWebViewMode);
    for (const [index, object] of (this.doc.pageObjects ?? []).entries()) {
      const cached=this.pageObjectNodes.get(object.id),source=this.attachmentImages.source(object);
      if(cached && cached.object===object && cached.tool===this.tool && cached.direct===this.directSelection && cached.selected===this.selectedObjectId && cached.native===native && cached.source===source){
        // Appending an already mounted image detaches/reinserts its decoded layer and damages
        // its whole footprint during a local text erase. Retain both the node and its parentage.
        const z=String(4+index); if(cached.node.style.zIndex!==z)cached.node.style.zIndex=z;
        if(cached.node.parentNode!==this.containerEl)this.containerEl.append(cached.node);
        continue;
      }
      cached?.node.remove();
      const node = document.createElement("div"); node.className = "rw-page-object";
      this.pageObjectNodes.set(object.id,{object,tool:this.tool,direct:this.directSelection,selected:this.selectedObjectId,native,source,node});
      node.dataset.pageObject = object.id; node.style.zIndex=String(4+index);
      const paint = (value: PageObject) => {
        node.style.left = `${value.x}px`; node.style.top = `${value.y}px`;
        node.style.width = `${value.width}px`; node.style.height = `${value.height}px`;
        if(value.kind==='audio' && value.attachment) {
          content.replaceChildren(audioCard(value,this.audioStates.get(value.attachment.id),()=>this.props.onActivateAttachment?.(value),
            this.attachmentActivation(value.id),()=>this.nativeOwnsControlPen()));
        } else content.innerHTML = objectSvg({ ...value, x: 0, y: 0 }, this.attachmentImages.source(value));
        const nativeOwnsInk=this.nativeInkActive && !this.nativeWebHandoff && !this.nativeDialogHandoff && !this.magnifyWebViewMode;
        if(!nativeOwnsInk && value.ink?.length) {
          const ink=document.createElementNS("http://www.w3.org/2000/svg","svg");
          ink.classList.add("rw-object-ink");ink.setAttribute("viewBox",`0 0 ${value.width} ${value.height}`);
          for(const stroke of value.ink){const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",outlinePathD(strokeOutline(stroke.points,stroke.width,stroke.brushStyle)));path.setAttribute("fill",stroke.color);ink.append(path);}
          content.append(ink);
        }
      };
      const content = document.createElement("div"); content.className = "rw-page-object-content"; node.append(content);
      paint(object);
      if (this.tool === "objects" || this.tool === "select" && this.directSelection) {
        node.classList.add("editable");
        if (this.selectedObjectId !== object.id) {
          node.classList.add("unselected");
          content.addEventListener("pointerdown", e => { e.stopPropagation(); e.preventDefault(); this.selectedObjectId = object.id; this.selectedInsertId=null; this.selectedTextWord=null; this.selectedTextWords.clear(); this.renderOverlay(); this.updateToolbarState(); });
          this.containerEl.append(node); continue;
        }
        const controls = document.createElement("div"); controls.className = "rw-object-actions";
        const move = document.createElement("button"); move.innerHTML = this.textBoxIcon("move"); move.setAttribute("aria-label", isAttachmentObject(object) ? "Move attachment" : "Move shape");
        const resize = document.createElement("button"); resize.innerHTML = this.textBoxIcon("resize"); resize.setAttribute("aria-label", isAttachmentObject(object) ? "Resize attachment" : "Resize shape");
        const remove = document.createElement("button"); remove.innerHTML = this.textBoxIcon("delete"); remove.setAttribute("aria-label", isAttachmentObject(object) ? "Delete attachment" : "Delete shape");
        bindPenButton(remove, () => { this.pushHistory(); this.doc = { ...this.doc, pageObjects: this.doc.pageObjects?.filter(o => o.id !== object.id) }; this.relayout(); this.props.onLayoutChanged?.(); });
        if (object.kind === "image") { node.classList.add("rw-image-selected"); controls.append(remove); }
        else controls.append(move, resize, remove);
        if (isAttachmentObject(object) && object.kind !== 'image' && object.kind !== 'audio') {
          const open = document.createElement('button');
          open.textContent = 'Open';
          open.className = 'rw-attachment-open';
          open.setAttribute('aria-label', 'Open attachment');
          bindPenButton(open, () => this.props.onActivateAttachment?.(object)); controls.append(open);
        }
        if (object.y < 36) { controls.style.bottom = "auto"; controls.style.top = "0px"; }
        node.append(controls);
        const bindDrag = (target: HTMLElement, sizing: boolean | ImageHandle) => {
          let gesture: { id: number; x: number; y: number; before: PageObject; changed: boolean } | null = null;
          target.style.touchAction = "none";
          target.addEventListener("pointerdown", e => {
            e.stopPropagation(); e.preventDefault();
            if (gesture || e.button > 0) return;
            const current = this.doc.pageObjects?.find(o => o.id === object.id); if (!current) return;
            this.pushHistory(); gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, before: current, changed: false };
            target.setPointerCapture?.(e.pointerId);
          });
          target.addEventListener("pointermove", e => {
            if (!gesture || gesture.id !== e.pointerId) return; e.stopPropagation();
            const dx = e.clientX-gesture.x, dy = e.clientY-gesture.y, before = gesture.before;
            const minimum = objectMinimumSize(before);
            const value = typeof sizing === 'string' ? resizeImage(before, sizing, dx, dy, this.width)
              : sizing ? { ...before, width: Math.max(minimum.width, Math.min(this.width-before.x, before.width+dx)), height: Math.max(minimum.height, before.height+dy) }
              : { ...before, x: Math.max(0, Math.min(this.width-before.width, before.x+dx)), y: Math.max(0, before.y+dy) };
            gesture.changed = true;
            this.doc = { ...this.doc, pageObjects: this.doc.pageObjects?.map(o => o.id === object.id ? value : o) };
            paint(value);
          });
          const finish = (e: PointerEvent) => {
            if (!gesture || gesture.id !== e.pointerId) return; e.stopPropagation();
            if (e.type === "pointercancel") this.doc = { ...this.doc, pageObjects: this.doc.pageObjects?.map(o => o.id === object.id ? gesture!.before : o) };
            gesture = null; this.relayout(); this.props.onLayoutChanged?.();
          };
          target.addEventListener("pointerup", finish); target.addEventListener("pointercancel", finish);
        };
        bindDrag(content, false);
        if (object.kind === 'image') {
          content.setAttribute('aria-label', 'Move attachment');
          for (const handle of IMAGE_HANDLES) {
            const grip = document.createElement('div');
            grip.className = 'rw-image-handle'; grip.dataset.handle = handle;
            grip.setAttribute('aria-label', `Resize image ${handle}`);
            node.append(grip); bindDrag(grip, handle);
          }
        } else { bindDrag(move, false); bindDrag(resize, true); }
      }
      this.containerEl.append(node);
    }
  }

  private openObjectSettings(anchor: HTMLElement) {
    this.closePenSettings(false);
    const panel = document.createElement("div"); panel.className = "pen-settings-panel rw-shape-settings";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Shapes");
    const header = document.createElement("div"); header.className = "pen-settings-header";
    const title = document.createElement("strong"); title.textContent = "Shapes";
    header.append(title);

    const grid = document.createElement("div"); grid.className = "rw-shape-grid";
    for (const [kind, label] of [["rectangle", "Rectangle"], ["ellipse", "Circle"], ["line", "Line"], ["triangle", "Triangle"], ["star", "Star"], ["trapezoid", "Trapezoid"], ["pentagon", "Pentagon"], ["hexagon", "Hexagon"]] as const) {
      const button = document.createElement("button"); button.setAttribute("aria-label", label); button.setAttribute("aria-pressed", String(this.objectKind === kind));
      const sample: PageObject = { id: "preview", kind, paper:false, x: 4, y: 4, width: 32, height: 32, color: "#000000", strokeWidth: 2, points: kind === "line" ? [{x:0,y:100},{x:100,y:0}] : [{x:0,y:70},{x:25,y:20},{x:60,y:80},{x:100,y:30}] };
      button.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true">${objectSvg(sample)}</svg><span>${label}</span>`;
      bindPenButton(button, () => { this.objectKind = kind; this.closePenSettings(); }); grid.append(button);
    }
    const fill = document.createElement("button");
    fill.className="rw-shape-outline";fill.setAttribute("role","checkbox");fill.setAttribute("aria-label","Outline only");
    const reflect = () => { fill.innerHTML=`<span aria-hidden="true" class="rw-outline-check">${this.objectOutline ? "✓" : ""}</span><span>Outline</span>`; fill.setAttribute("aria-checked", String(this.objectOutline)); };
    const selected=this.doc.pageObjects?.find(o=>o.id===this.selectedObjectId);
    if(selected && selected.kind!=="line" && selected.kind!=="sketch")this.objectOutline=selected.paper===false;
    reflect(); bindPenButton(fill, () => {
      this.objectOutline = !this.objectOutline;
      if(selected){
        this.pushHistory();this.doc={...this.doc,pageObjects:this.doc.pageObjects?.map(o=>o.id===selected.id?{...o,paper:!this.objectOutline,filled:false}:o)};
        this.relayout();this.props.onLayoutChanged?.();
      }
      reflect(); this.reportChromeRegion(panel.getBoundingClientRect());
    });
    const section=(label:string)=>{const title=document.createElement("strong");title.className="rw-shape-section";title.textContent=label;return title;};
    const editSelected=(patch:Partial<PageObject>)=>{
      if(selected){this.pushHistory();this.doc={...this.doc,pageObjects:this.doc.pageObjects?.map(o=>o.id===selected.id?{...o,...patch}:o)};this.relayout();this.props.onLayoutChanged?.();}
      this.reportChromeRegion(panel.getBoundingClientRect());
    };
    if(selected){this.objectColor=selected.color;this.objectWidth=selected.strokeWidth;this.objectLineStyle=selected.lineStyle??"solid";}
    const styles=document.createElement("div");styles.className="rw-shape-styles";
    for(const style of ["solid","dotted","dashed"] as const){
      const button=document.createElement("button");button.setAttribute("aria-label",`Shape ${style} line`);button.setAttribute("aria-pressed",String(this.objectLineStyle===style));
      button.innerHTML=`<svg viewBox="0 0 64 24" aria-hidden="true"><path d="M6 12H58" ${style==="solid"?"":`stroke-dasharray="${style==="dotted"?"1 5":"9 5"}"`}/></svg>`;
      bindPenButton(button,()=>{this.objectLineStyle=style;Array.from(styles.children).forEach(b=>b.setAttribute("aria-pressed",String(b===button)));editSelected({lineStyle:style});reflectWidth();});styles.append(button);
    }
    const colours=document.createElement("div");colours.className="rw-shape-colours";
    for(const [color,label] of [["#000000","Black"],["#ffffff","White"],["#E01010","Red"],["#E8600C","Orange"],["#FFCC00","Yellow"],["#188C1C","Green"],["#00BFFF","Sky"],["#1838D8","Blue"],["#4622C0","Purple"],["#E04088","Pink"]]){
      const button=document.createElement("button");button.style.setProperty("--shape-colour",color);button.setAttribute("aria-label",`Shape colour: ${label}`);button.setAttribute("aria-pressed",String(color===this.objectColor));
      bindPenButton(button,()=>{this.objectColor=color;Array.from(colours.children).forEach(b=>b.setAttribute("aria-pressed",String(b===button)));editSelected({color});reflectWidth();});colours.append(button);
    }
    const width=document.createElement("div");width.className="rw-shape-width";
    const value=document.createElement("div");value.className="rw-shape-width-preview";
    value.setAttribute("role","img");
    const reflectWidth=()=>{value.setAttribute("aria-label",`Shape line width preview: ${this.objectWidth} pixels`);value.innerHTML=`<svg viewBox="0 0 180 32" aria-hidden="true"><path d="M10 16H170" fill="none" stroke="${this.objectColor}" stroke-width="${this.objectWidth}" vector-effect="non-scaling-stroke" stroke-linecap="round" ${this.objectLineStyle==="solid"?"":`stroke-dasharray="${this.objectLineStyle==="dotted"?"1 5":"9 5"}"`}/></svg>`;};
    for(const [label,delta] of [["Decrease shape line width",-1],["Increase shape line width",1]] as const){
      const button=document.createElement("button");button.setAttribute("aria-label",label);button.textContent=delta<0?"−":"+";
      bindPenButton(button,()=>{this.objectWidth=Math.max(1,Math.min(12,this.objectWidth+delta));reflectWidth();editSelected({strokeWidth:this.objectWidth});});width.append(button);
    }
    reflectWidth();width.insertBefore(value,width.lastChild);
    panel.append(header, grid,section("Style"),styles,section("Colours"),colours,section("Line width"),width,fill); this.root.append(panel); this.penSettingsEl = panel;
    const r = this.root.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(r.left+8, Math.min(this.props.notebookToolbar ? a.right+1 : a.left, r.right-panel.getBoundingClientRect().width-8))}px`;
    panel.style.top = `${Math.max(r.top+8, Math.min(this.props.notebookToolbar ? a.top : a.bottom+8, r.bottom-panel.getBoundingClientRect().height-8))}px`;
    requestAnimationFrame(() => { if (this.penSettingsEl !== panel) return; const b = panel.getBoundingClientRect(); this.penSettingsExclusionRect = {l:b.left,t:b.top,r:b.right,b:b.bottom}; this.syncWritingExclusion(); this.reportChromeRegion(b); });
  }

  /** Group UI only: all three operations retain their existing flush, history and reflow paths. */
  private openSpacingSettings(anchor:HTMLElement) {
    this.closePenSettings(false);
    const panel=document.createElement("div");panel.className="pen-settings-panel rw-tool-menu rw-spacing-settings";
    panel.setAttribute("role","dialog");panel.setAttribute("aria-label","Spacing settings");
    const heading=document.createElement("strong");heading.textContent="Spacing";panel.append(heading);
    for(const [label,icon,action] of [
      ["Horizontal spacing","spaceHorizontal",()=>this.requestTool("insert")],
      ["Blank-line spacing","spaceVertical",()=>this.requestTool("lines")],
      ["Condense spacing","collapse",this.collapse],
    ] as const){
      const button=document.createElement("button");button.setAttribute("aria-label",label);
      button.innerHTML=window.KalamosToolbarIcons?.svg(icon)??`<span aria-hidden="true">${icon==="spaceVertical"?"↕":icon==="collapse"?"»«":"↔"}</span>`;
      const caption=document.createElement("span");caption.textContent=label;button.append(caption);
      bindPenButton(button,()=>this.afterNativeFlush(()=>{this.closePenSettings();action();}));panel.append(button);
    }
    this.root.append(panel);this.penSettingsEl=panel;
    const r=this.root.getBoundingClientRect(),a=anchor.getBoundingClientRect();
    panel.style.left=`${Math.max(r.left+8,Math.min(this.props.notebookToolbar ? a.right+1 : a.left,r.right-panel.getBoundingClientRect().width-8))}px`;
    panel.style.top=`${Math.max(r.top+8,Math.min(this.props.notebookToolbar ? a.top : a.bottom+8,r.bottom-panel.getBoundingClientRect().height-8))}px`;
    requestAnimationFrame(()=>{if(this.penSettingsEl!==panel)return;const b=panel.getBoundingClientRect();this.penSettingsExclusionRect={l:b.left,t:b.top,r:b.right,b:b.bottom};this.syncWritingExclusion();this.reportChromeRegion(b);});
  }

  private openEraserSettings(anchor: HTMLElement) {
    this.closePenSettings(false);
    const panel = document.createElement("div");
    panel.className = "pen-settings-panel rw-eraser-settings rw-tool-menu";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Eraser settings");
    const title = document.createElement("strong"); title.textContent = "Eraser";
    panel.append(title);
    for (const [mode, label] of [["stroke", "Stroke eraser"], ["lasso", "Erasing lasso"], ["pixel", "Pixel eraser"]] as const) {
      const button = document.createElement("button");
      button.innerHTML=inkToolIcon(mode === "lasso" ? "lasso" : mode === "pixel" ? "pixelEraser" : "eraser"); const caption=document.createElement("span"); caption.textContent=label; button.append(caption); button.setAttribute("aria-label",label); button.setAttribute("aria-pressed", String(this.eraserMode === mode));
      bindPenButton(button, () => this.afterNativeFlush(()=>{this.eraserMode=mode;this.setTool("erase");this.openEraserSettings(anchor);}));
      panel.append(button);
    }
    const preview=document.createElement("div");preview.className="magnify-eraser-size-preview";preview.setAttribute("role","img");
    const row=document.createElement("div");row.className="magnify-eraser-diameter";
    const diameter=document.createElement("span");
    const reflect=()=>{
      preview.innerHTML=`<svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="${this.eraserDiameter/2}" fill="white" stroke="black"/></svg>`;
      preview.setAttribute("aria-label",`Eraser diameter: ${this.eraserDiameter} pixels`);diameter.textContent=`${this.eraserDiameter} px`;
      this.magnifyPad?.syncEraserSettings();
    };
    for(const [label,delta] of [["Decrease eraser diameter",-2],["Increase eraser diameter",2]] as const){
      const b=document.createElement("button");b.textContent=delta<0?"−":"+";b.setAttribute("aria-label",label);
      bindPenButton(b,()=>{this.eraserDiameter=Math.max(6,Math.min(80,this.eraserDiameter+delta));reflect();});row.append(b);
    }
    row.insertBefore(diameter,row.lastChild);panel.append(preview,row);reflect();
    this.root.append(panel); this.penSettingsEl = panel;
    const r = this.root.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(r.left+8, Math.min(this.props.notebookToolbar ? a.right+1 : a.left, r.right-panel.getBoundingClientRect().width-8))}px`;
    panel.style.top = `${Math.max(r.top+8, Math.min(this.props.notebookToolbar ? a.top : a.bottom+8, r.bottom-panel.getBoundingClientRect().height-8))}px`;
    requestAnimationFrame(() => { if (this.penSettingsEl !== panel) return; const b = panel.getBoundingClientRect(); this.penSettingsExclusionRect = { l:b.left,t:b.top,r:b.right,b:b.bottom }; this.syncWritingExclusion(); this.reportChromeRegion(b); });
  }

  /** Context actions use the existing native flush and exclusion/partial-refresh handoff.
   * This menu does not change dotted native lasso capture or word grouping. */
  private openLassoSettings(anchor:HTMLElement) {
    this.closePenSettings(false);
    const panel=document.createElement("div"); panel.className="pen-settings-panel rw-tool-menu rw-lasso-settings";
    panel.setAttribute("role","dialog");panel.setAttribute("aria-label","Selection actions");
    const title=document.createElement("strong");title.textContent="Selection";panel.append(title);
    const action=(label:string,icon:string,callback:()=>void,disabled=false)=>{
      const button=document.createElement("button");button.innerHTML=inkToolIcon(icon);
      const caption=document.createElement("span");caption.textContent=label;button.append(caption);
      button.setAttribute("aria-label",label);button.disabled=disabled;
      bindPenButton(button,()=>this.afterNativeFlush(()=>{this.closePenSettings();callback();}));panel.append(button);
    };
    action("Select again","lasso",()=>this.startLasso());
    const hasSelection=!!this.selectedInsertId||this.selectedTextWords.size>0;
    action("Copy selection","copy",()=>this.copySelectedBlocks(),!hasSelection);
    action("Cut selection","cut",()=>this.copySelectedBlocks(true),!hasSelection);
    action("Paste selection","paste",()=>this.pasteSelection(),!hasSelectionClipboard());
    action("Duplicate selection","copy",()=>this.duplicateSelectedInk(),!hasSelection);
    action("Delete selection","delete",()=>this.deleteSelectedBlocks(),!hasSelection);
    if(this.props.onShareSelection && this.selectedTextWords.size)action("Share text","share",()=>{
      const markdown=this.selectedMarkdown();if(markdown)this.props.onShareSelection?.(markdown);
    });
    if (this.props.hwr?.available()) action("Convert selection to text","text",()=>this.convertSelectedToText(),!this.selectedInsertId);
    const selectedBoxId=this.selectedTextWord?.boxId??(this.selectedTextWords.size===1?[...this.selectedTextWords.keys()][0]:undefined);
    if(selectedBoxId)action("Edit text","text",()=>this.editTextBox(selectedBoxId));
    this.root.append(panel);this.penSettingsEl=panel;
    const r=this.root.getBoundingClientRect(),a=anchor.getBoundingClientRect();
    panel.style.left=`${Math.max(r.left+8,Math.min(this.props.notebookToolbar ? a.right+1 : a.left,r.right-panel.getBoundingClientRect().width-8))}px`;
    panel.style.top=`${Math.max(r.top+8,Math.min(this.props.notebookToolbar ? a.top : a.bottom+8,r.bottom-panel.getBoundingClientRect().height-8))}px`;
    requestAnimationFrame(()=>{if(this.penSettingsEl!==panel)return;const b=panel.getBoundingClientRect();this.penSettingsExclusionRect={l:b.left,t:b.top,r:b.right,b:b.bottom};this.syncWritingExclusion();this.reportChromeRegion(b);});
  }

  private notebookColors(): [string, string] {
    const saved = this.props.prefs.penQuickColors;
    return saved && saved.length === 2 && saved.every(c => /^#[0-9a-f]{6}$/i.test(c))
      ? saved : [this.props.prefs.penColor, "#1838D8"];
  }

  private notebookPalette(): Array<[string, string]> {
    return [["#000000","Black"],["#808080","Grey"],["#800020","Burgundy"],["#8A4A18","Brown"],
      ["#D4A000","Amber"],["#188C1C","Green"],["#00BFFF","Sky"],["#1838D8","Blue"],
      ["#9418B0","Purple"],["#D81884","Pink"],["#E01010","Red"],["#E8600C","Orange"],
      ["#FFCC00","Yellow"],["#80C000","Lime"],["#0C8C84","Teal"],["#000080","Navy"],
      ["#FF7F50","Coral"],["#4622C0","Indigo"]];
  }

  private notebookColorName(colour: string): string {
    return this.notebookPalette().find(([value]) => value.toLowerCase() === colour.toLowerCase())?.[1] ?? "Custom";
  }

  private applyNotebookStyle(colour: string, width: number, brush = this.props.prefs.brushStyle ?? "pen") {
    const slots = [...this.notebookColors()] as [string, string];
    slots[this.notebookColorSlot] = colour;
    this.inkColor = colour;
    this.penWidth = Math.max(1, Math.min(20, width));
    this.props.prefs = {...this.props.prefs, penColor: colour, penWidth: this.penWidth,
      brushStyle: brush, penQuickColors: slots};
    this.props.onPreferencesChange?.(this.props.prefs);
    this.props.onInkStyleChange?.(colour, this.penWidth);
    this.updateToolbarState();
    this.props.onToolChange?.(this.tool, this.keyboard);
  }

  /** A single measured pop-out owns pen options and palette input, just like existing tool menus. */
  private mountNotebookMenu(panel: HTMLElement, anchor: HTMLElement) {
    this.root.append(panel);
    this.penSettingsEl = panel;
    const root = this.root.getBoundingClientRect(), button = anchor.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const besideRail = !!anchor.closest(".toolbar-more-rail") || !this.toolbarEl.classList.contains("toolbar-all-tools");
    const x = besideRail ? button.right + 1 : button.left;
    panel.style.left = `${Math.max(4, Math.min(x, window.innerWidth - size.width - 4))}px`;
    panel.style.top = `${Math.max(root.top + 4, Math.min(button.top, root.bottom - size.height - 4))}px`;
    requestAnimationFrame(() => {
      if (this.penSettingsEl !== panel) return;
      const rect = panel.getBoundingClientRect();
      this.penSettingsExclusionRect = {l:rect.left,t:rect.top,r:rect.right,b:rect.bottom};
      this.syncWritingExclusion(); this.reportChromeRegion(rect);
    });
  }

  private notebookSwatches(panel: HTMLElement, back: () => void) {
    const grid = document.createElement("div"); grid.className = "scribe-palette";
    const current = document.createElement("button"); current.className = "scribe-colour-name";
    current.setAttribute("aria-label", "Back to pen settings");
    const reflect = () => {
      current.textContent = this.notebookColorName(this.inkColor);
      current.style.setProperty("--slot-color", this.inkColor);
      grid.querySelectorAll<HTMLButtonElement>("button").forEach(button =>
        button.setAttribute("aria-pressed", String(button.dataset.color?.toLowerCase() === this.inkColor.toLowerCase())));
    };
    for (const [colour, name] of this.notebookPalette()) {
      const button = document.createElement("button"); button.type = "button";
      button.dataset.color = colour; button.setAttribute("aria-label", name); button.title = name;
      button.innerHTML = '<span aria-hidden="true"></span>'; button.style.setProperty("--slot-color", colour);
      bindPenButton(button, () => this.afterNativeFlush(() => {
        this.applyNotebookStyle(colour, this.penWidth); reflect(); this.reportChromeRegion(panel.getBoundingClientRect());
      })); grid.append(button);
    }
    bindPenButton(current, back); panel.append(grid, current); reflect();
  }

  private openNotebookPalette(anchor: HTMLElement) {
    this.closePenSettings(false);
    const panel = document.createElement("div"); panel.className = "pen-settings-panel scribe-menu scribe-colour-menu";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Ink colour");
    this.notebookSwatches(panel, () => this.openNotebookPenSettings(anchor));
    this.mountNotebookMenu(panel, anchor);
  }

  private openNotebookPenSettings(anchor: HTMLElement) {
    this.closePenSettings(false);
    const panel = document.createElement("div"); panel.className = "pen-settings-panel scribe-menu scribe-pen-menu";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Pen settings");
    for (const [style, name] of [["pen","Pen"],["brush","Brush"],["marker","Marker"]] as const) {
      const button = document.createElement("button"); button.className = "scribe-pen-choice";
      button.innerHTML = `${inkToolIcon(style)}<span>${name}</span><span aria-hidden="true">‹</span>`;
      button.setAttribute("aria-label", name);
      button.setAttribute("aria-pressed", String(style === (this.props.prefs.brushStyle ?? "pen")));
      bindPenButton(button, () => this.afterNativeFlush(() => {
        this.applyNotebookStyle(this.inkColor, style === "marker" ? 8 : style === "brush" ? 4 : 2.4, style);
        this.openNotebookPenSettings(anchor);
      })); panel.append(button);
    }
    const widths = document.createElement("div"); widths.className = "scribe-widths";
    for (const width of [1, 2.4, 4, 8, 12]) {
      const button = document.createElement("button"); button.setAttribute("aria-label", `Pen width ${width} pixels`);
      button.setAttribute("aria-pressed", String(Math.abs(this.penWidth - width) < 0.1));
      button.innerHTML = `<svg viewBox="0 0 28 26" aria-hidden="true"><path d="M5 18Q18 0 12 13T23 8" fill="none" stroke="currentColor" stroke-width="${Math.min(width, 6)}"/></svg>`;
      bindPenButton(button, () => this.afterNativeFlush(() => {
        this.applyNotebookStyle(this.inkColor, width); this.openNotebookPenSettings(anchor);
      })); widths.append(button);
    }
    panel.append(widths);
    this.notebookSwatches(panel, () => this.openNotebookPalette(anchor));
    const scribbleButton = document.createElement("button"); scribbleButton.className = "scribe-scribble";
    scribbleButton.textContent = "Scribble to erase";
    scribbleButton.setAttribute("aria-pressed", String(scribble.enabled()));
    bindPenButton(scribbleButton, () => {
      scribble.setEnabled(!scribble.enabled()); scribbleButton.setAttribute("aria-pressed", String(scribble.enabled()));
      this.reportChromeRegion(panel.getBoundingClientRect());
    }); panel.append(scribbleButton);
    this.mountNotebookMenu(panel, anchor);
  }

  private openPenSettings(anchor: HTMLElement) {
    if (this.props.notebookToolbar) { this.openNotebookPenSettings(anchor); return; }
    this.closePenSettings(false);
    const panel = document.createElement("div");
    panel.className = "pen-settings-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Pen settings");

    const header = document.createElement("div");
    header.className = "pen-settings-header";
    const title = document.createElement("strong");
    title.textContent = "Pen settings";
    header.append(title);

    const preview = document.createElement("div");
    preview.className = "pen-settings-preview";
    const previewLine = document.createElement("span");
    preview.appendChild(previewLine);

    const colourHeading = document.createElement("strong");
    colourHeading.className = "pen-settings-label";
    colourHeading.textContent = "Colour";
    const colours = document.createElement("div");
    colours.className = "pen-settings-colours";
    const palette: Array<[string, string]> = [
      ["#000000", "Black"],
      ["#000080", "Navy"],
      ["#00BFFF", "Sky"],
      ["#FFCC00", "Yellow"],
      ["#80C000", "Lime"],
      ["#800020", "Burgundy"],
      ["#FF7F50", "Coral"],
      ["#8A4A18", "Brown"],
      ["#E01010", "Red"],
      ["#E8600C", "Orange"],
      ["#D4A000", "Amber"],
      ["#188C1C", "Green"],
      ["#0C8C84", "Teal"],
      ["#1838D8", "Blue"],
      ["#4622C0", "Indigo"],
      ["#9418B0", "Purple"],
      ["#D81884", "Pink"],
    ];

    const widthRow = document.createElement("div");
    widthRow.className = "pen-settings-width";
    const widthLabel = document.createElement("strong");
    widthLabel.textContent = "Line width";
    const widthValue = document.createElement("output");
    const widthSlider = document.createElement("input");
    widthSlider.type = "range";
    widthSlider.min = "1";
    widthSlider.max = "20";
    widthSlider.step = "0.5";
    widthSlider.value = String(this.penWidth);
    widthSlider.setAttribute("aria-label", "Pen line width");

    const reflectStyle = () => {
      previewLine.style.background = this.inkColor;
      previewLine.style.height = `${Math.max(1, this.penWidth)}px`;
      widthValue.value = `${this.penWidth.toFixed(1).replace(/\.0$/, "")} px`;
      for (const swatch of Array.from(colours.querySelectorAll<HTMLButtonElement>("button"))) {
        swatch.classList.toggle(
          "selected",
          swatch.dataset.color?.toLowerCase() === this.inkColor.toLowerCase()
        );
      }
    };

    const applyStyle = (color: string, width: number) => {
      this.inkColor = color;
      this.penWidth = Math.max(1, Math.min(20, width));
      this.props.prefs = { ...this.props.prefs, penColor: this.inkColor, penWidth: this.penWidth };
      this.props.onPreferencesChange?.(this.props.prefs);
      this.props.onInkStyleChange?.(this.inkColor, this.penWidth);
      reflectStyle();
    };

    for (const [color, name] of palette) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "pen-settings-swatch";
      swatch.dataset.color = color;
      swatch.title = name;
      swatch.setAttribute("aria-label", name);
      swatch.style.background = color;
      swatch.addEventListener("click", () => {
        applyStyle(color, this.penWidth);
        this.reportChromeRegion(panel.getBoundingClientRect());
      });
      colours.appendChild(swatch);
    }

    widthSlider.addEventListener("input", () => {
      applyStyle(this.inkColor, Number.parseFloat(widthSlider.value));
    });
    // Do not snapshot every slider sample. The native controller receives live style updates during
    // input; one bounded chrome capture on release updates the baked value and preview.
    widthSlider.addEventListener("change", () => {
      this.reportChromeRegion(panel.getBoundingClientRect());
    });
    widthRow.append(widthLabel, widthValue, widthSlider);
    const scribbleButton = document.createElement("button");
    scribbleButton.type = "button";
    scribbleButton.className = "scribble-erase-toggle";
    scribbleButton.title = "Draw one continuous zigzag over handwriting, then lift the pen. Undo restores the ink.";
    const reflectScribble = () => {
      scribbleButton.textContent = `Scribble to erase: ${scribble.enabled() ? "On" : "Off"}`;
      scribbleButton.setAttribute("aria-pressed", String(scribble.enabled()));
    };
    bindPenButton(scribbleButton, () => { scribble.setEnabled(!scribble.enabled()); reflectScribble(); this.reportChromeRegion(panel.getBoundingClientRect()); });
    reflectScribble();
    const brushes = document.createElement("div"); brushes.className="pen-settings-brushes";
    for (const [style,label] of [["pen","Pen"],["brush","Brush"],["marker","Marker"]] as const) {
      const button=document.createElement("button"); button.type="button";button.innerHTML=inkToolIcon(style);button.setAttribute("aria-label",label);button.title=label;button.dataset.brushStyle=style;
      button.setAttribute("aria-pressed",String((this.props.prefs.brushStyle??"pen")===style));
      bindPenButton(button,()=>{
        this.props.prefs={...this.props.prefs,brushStyle:style};
        applyStyle(this.inkColor,style==="marker"?8:style==="brush"?4:2.4);
        for(const item of Array.from(brushes.children)) item.setAttribute("aria-pressed",String(item===button));
        // Reflect choices before the existing chrome-capture callback so native snapshots see
        // the new glyph and selected row together, not the old panel beside a new pen style.
        this.updateToolbarState();
        this.props.onToolChange?.(this.tool,this.keyboard);
      }); brushes.append(button);
    }
    panel.append(header, brushes, preview, colourHeading, colours, widthRow, scribbleButton);
    this.root.appendChild(panel);
    this.penSettingsEl = panel;
    reflectStyle();

    const anchorRect = anchor.getBoundingClientRect();
    const rootRect = this.root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(
      rootRect.left + margin,
      Math.min(anchorRect.left, rootRect.right - panelRect.width - margin)
    );
    let top = anchorRect.bottom + 8;
    if (top + panelRect.height > rootRect.bottom - margin) {
      top = anchorRect.top - panelRect.height - 8;
    }
    top = Math.max(rootRect.top + margin, Math.min(top, rootRect.bottom - panelRect.height - margin));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;

    requestAnimationFrame(() => {
      if (this.penSettingsEl !== panel) return;
      const rect = panel.getBoundingClientRect();
      this.penSettingsExclusionRect = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
      this.syncWritingExclusion();
      this.reportChromeRegion(rect);
    });
  }

  private closePenSettings(refresh = true) {
    const panel = this.penSettingsEl;
    if (!panel) return;
    const oldRect = panel.getBoundingClientRect();
    panel.remove();
    this.penSettingsEl = null;
    this.penSettingsExclusionRect = null;
    if (refresh) {
      this.syncWritingExclusion();
      this.reportChromeRegion(oldRect);
    }
  }

  private reportChromeRegion(rect: DOMRect) {
    const region = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
    if (this.props.onToolbarLayoutChange) {
      this.props.onToolbarLayoutChange(region, region);
    } else {
      this.props.onLayoutChanged?.();
    }
  }

  private syncDialogOwnership() {
    const dialogActive = Array.from(this.root.querySelectorAll<HTMLElement>(
      '[role="dialog"], .magnify-settings, .rw-text-editor'
    )).some((element) => !element.closest('[hidden]') && getComputedStyle(element).display !== "none");
    if (dialogActive !== this.dialogNotified) {
      this.dialogNotified = dialogActive;
      this.props.onDialogChange?.(dialogActive);
    }
  }

  private syncWritingExclusion() {
    this.syncDialogOwnership();
    // Expanded chrome follows the drawing editor: the writing surface is
    // physically inset below the top bar and beside the rail, so no floating
    // toolbar exclusion is needed. Floating sheets still need protection.
    const toolbar = this.toolbarEl?.getBoundingClientRect();
    const toolbarRect =
      !this.toolbarEl?.classList.contains("toolbar-all-tools") &&
      toolbar && toolbar.width > 0 && toolbar.height > 0
        ? { l: toolbar.left, t: toolbar.top, r: toolbar.right, b: toolbar.bottom }
        : null;
    if (this.textPromptEl?.parentElement) {
      const r = this.textPromptEl.parentElement.getBoundingClientRect();
      const header = this.textPromptEl.querySelector<HTMLElement>(".rw-text-editor-header")?.getBoundingClientRect();
      this.textPromptExclusionRect = { l:Math.min(r.left-24,header?.left ?? r.left), t:Math.min(r.top-48,header?.top ?? r.top), r:Math.max(r.right+24,header?.right ?? r.right), b:Math.max(r.bottom+44,header?.bottom ?? r.bottom) };
    }
    const rects = [toolbarRect, this.hwrExclusionRect, this.penSettingsExclusionRect, this.textPromptExclusionRect].filter(
      (rect): rect is { l: number; t: number; r: number; b: number } => rect !== null
    );
    if (rects.length === 0) {
      this.props.onOverlayChange?.(null);
      return;
    }
    this.props.onOverlayChange?.(
      rects.reduce((union, rect) => ({
        l: Math.min(union.l, rect.l),
        t: Math.min(union.t, rect.t),
        r: Math.max(union.r, rect.r),
        b: Math.max(union.b, rect.b),
      }))
    );
  }

  private updateToolbarState() {
    const hasSelection=this.tool==='select' && (!!this.selectedInsertId || this.selectedTextWords.size>0);
    if(hasSelection && !this.selectionInteraction) {
      this.selectionInteraction=true;
      this.nativeInkActive=false;
      // Prepare the solid vector frame before the native host detaches its dashed capture surface.
      this.renderOverlay();
      if(this.props.notebookToolbar)requestAnimationFrame(()=>{
        if(!this.root.isConnected || this.tool!=='select' || !this.getSelectedBlockBounds())return;
        const anchor=this.toolbarEl.querySelector<HTMLElement>('[data-action="select"]');
        if(anchor)this.openLassoSettings(anchor);
      });
    }
    this.toolbarEl.querySelector<HTMLButtonElement>('[data-action="paste"]')?.toggleAttribute('disabled',!hasSelectionClipboard());
    this.toolbarEl.classList.toggle("selection-active",hasSelection);
    if (this.props.notebookToolbar) {
      const colours = this.notebookColors();
      this.toolbarEl.querySelectorAll<HTMLButtonElement>("[data-color-slot]").forEach(button => {
        const colour = colours[Number(button.dataset.colorSlot)];
        const selected = Number(button.dataset.colorSlot) === this.notebookColorSlot && colour.toLowerCase() === this.inkColor.toLowerCase();
        button.style.setProperty("--slot-color", colour);
        button.setAttribute("aria-pressed", String(selected));
        button.setAttribute("aria-label", `Ink shortcut ${Number(button.dataset.colorSlot) + 1}: ${this.notebookColorName(colour)}${selected ? "; tap to change colour" : ""}`);
        button.title = button.getAttribute("aria-label")!;
      });
    }
    const buttons = Array.from(this.toolbarEl.querySelectorAll("button"));
    for (const b of buttons) {
      const tool = b.dataset.tool as Tool | undefined;
      if (tool === "select" && b.dataset.action !== "pointer") {
        const glyph=this.selectionInteraction?"move":"lasso";
        if(b.dataset.selectionGlyph!==glyph){b.innerHTML=inkToolIcon(glyph);b.dataset.selectionGlyph=glyph;}
        b.classList.add("toolbar-icon-button");
        b.title=this.selectionInteraction?"Move selected words; tap for selection actions":"Draw a lasso to select words";
        b.dataset.label=this.selectionInteraction ? "Move" : "Lasso";
      }
      if (tool === "write") {
        const style=this.props.prefs.brushStyle??"pen";
        if (b.dataset.brushStyle!==style) { b.innerHTML=inkToolIcon(style); b.dataset.brushStyle=style; b.dataset.icon=style; b.classList.add("toolbar-icon-button"); }
        b.title=`${style[0].toUpperCase()+style.slice(1)} / pen settings`;
      }
      if (tool) {
        const isActive = (tool !== "select" || (b.dataset.action === "pointer") === this.directSelection) && (!this.magnifyPad || tool==="write" || tool==="erase") && !this.keyboard && (this.tool === tool || b.dataset.action === "spacing" && this.tool === "lines");
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", String(isActive));
      }
      if (b.dataset.action === "keyboard") {
        b.classList.toggle("active", this.keyboard);
        b.setAttribute("aria-pressed", String(this.keyboard));
      }
      if (b.dataset.action === "magnify") {
        b.classList.toggle("active", !!this.magnifyPad);
        b.setAttribute("aria-pressed", String(!!this.magnifyPad));
      }
    }
    this.toolbarEl.classList.toggle("has-ink-selection",hasSelection);
    if (this.copyBtn) this.copyBtn.style.display = hasSelection ? "" : "none";
    if (this.deleteBtn) {
      this.deleteBtn.style.display = hasSelection ? "" : "none";
    }
    if (this.convertBtn) {
      const show = this.tool === "select" && this.selectedInsertId && this.props.hwr;
      this.convertBtn.style.display = show ? "" : "none";
      // Keep the contextual conversion affordance visible and actionable. The recognition seam
      // reports a useful unavailable/error sheet when its language assets are missing; disabling
      // the button used to render it as a blank dashed square on monochrome Android.
      this.convertBtn.disabled = false;
    }
    this.props.onLayoutChanged?.(); // toolbar state is part of the baked chrome
  }

  // ---- HWR: convert a selected ink run to text (on demand only) ----

  private convertSelectedToText() {
    const id = this.selectedInsertId;
    const hwr = this.props.hwr;
    if (!id || !hwr) return;
    const ins = this.doc.inserts.find((i) => i.id === id);
    if (!ins || ins.kind !== "ink" || ins.strokes.length === 0) return;
    const visual = this.inkVisualBounds(ins);
    if (!visual) return;
    const b = strokesBounds(ins.strokes, PAD);
    const strokes = ins.strokes.map((s) =>
      s.points.map((pt) => [visual.x + (pt.x - b.x), visual.y + (pt.y - b.y), pt.pressure ?? 0.5])
    );
    const afterWord =
      ins.freeX !== undefined ? this.readingSlotAt(visual.x, visual.y + visual.height / 2) : ins.afterWord;
    const preContext = textFromWords(this.doc.words.slice(0, afterWord + 1));
    hwr.recognize(
      strokes,
      { w: Math.max(1, Math.round(this.width)), h: Math.max(1, Math.round(this.layout.height)) },
      preContext,
      (res) => this.openHwrSheet(id, afterWord, res)
    );
  }

  private closeHwrSheet() {
    if (!this.hwrSheetEl) return;
    this.hwrSheetEl.remove();
    this.hwrSheetEl = null;
    this.hwrExclusionRect = null;
    this.syncWritingExclusion();
    this.props.onLayoutChanged?.();
  }

  private openHwrSheet(insertId: string, afterWord: number, res: HwrResult) {
    this.closeHwrSheet();
    const sheet = document.createElement("div");
    sheet.className = "hwr-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Convert handwriting to text");

    if (res.error) {
      const msg = document.createElement("span");
      msg.className = "hwr-msg";
      msg.textContent = res.error === "unavailable" ? "Recognition is not available." : `Recognition failed: ${res.error}`;
      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("click", () => this.closeHwrSheet());
      sheet.append(msg, closeBtn);
    } else {
      const fallback = tokenizeWords((res.text ?? "").trim());
      const recognized = (res.words ?? [])
        .map((word) => ({
          text: (word.label ?? "").trim(),
          alternatives: (word.candidates ?? []).map((candidate) => candidate.trim()).filter(Boolean),
        }))
        .filter((word) => word.text.length > 0);
      const choices = recognized.length > 0
        ? recognized
        : fallback.map((text, index) => ({
            text,
            alternatives: fallback.length === 1 && index === 0
              ? (res.candidates ?? [])
                  .map((candidate) => (candidate.text ?? candidate.label ?? "").trim())
                  .filter(Boolean)
              : [],
          }));

      const instruction = document.createElement("div");
      instruction.className = "hwr-instruction";
      instruction.textContent = "Tap a word to choose another reading.";
      const wordStrip = document.createElement("div");
      wordStrip.className = "hwr-words";
      wordStrip.setAttribute("role", "group");
      wordStrip.setAttribute("aria-label", "Recognized words");
      const optionPanel = document.createElement("div");
      optionPanel.className = "hwr-word-options";
      optionPanel.textContent = "Each word can be checked separately.";
      const renderOptions = (index: number) => {
        const selected = choices[index];
        for (const [buttonIndex, button] of [...wordStrip.querySelectorAll<HTMLButtonElement>(".hwr-word")].entries()) {
          const active = buttonIndex === index;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        }
        optionPanel.replaceChildren();
        const label = document.createElement("span");
        label.className = "hwr-option-label";
        label.textContent = `Other readings for “${selected.text}”`;
        optionPanel.appendChild(label);
        const alternatives = document.createElement("div");
        alternatives.className = "hwr-alts";
        const seen = new Set<string>();
        for (const alternative of [selected.text, ...selected.alternatives]) {
          const text = alternative.trim();
          if (!text || seen.has(text)) continue;
          seen.add(text);
          const button = document.createElement("button");
          button.textContent = text;
          button.classList.toggle("active", text === selected.text);
          button.addEventListener("click", () => {
            choices[index].text = text;
            const wordButton = wordStrip.querySelectorAll<HTMLButtonElement>(".hwr-word")[index];
            if (wordButton) wordButton.textContent = text;
            renderOptions(index);
          });
          alternatives.appendChild(button);
        }
        optionPanel.appendChild(alternatives);
        const keep = document.createElement("button");
        keep.className = "hwr-keep-ink";
        keep.textContent = "Keep original ink";
        keep.title = "Close without replacing any of the selected handwriting";
        keep.addEventListener("click", () => this.closeHwrSheet());
        optionPanel.appendChild(keep);
      };

      for (const [index, choice] of choices.entries()) {
        const wordButton = document.createElement("button");
        wordButton.className = "hwr-word";
        wordButton.textContent = choice.text;
        wordButton.setAttribute("aria-pressed", "false");
        wordButton.addEventListener("click", () => renderOptions(index));
        wordStrip.appendChild(wordButton);
      }
      const actions = document.createElement("div");
      actions.className = "hwr-actions";
      const keep = document.createElement("button");
      keep.className = "hwr-keep-ink";
      keep.textContent = "Keep ink";
      keep.addEventListener("click", () => this.closeHwrSheet());
      const replace = document.createElement("button");
      replace.className = "done";
      replace.textContent = "Replace ink";
      replace.addEventListener("click", () => {
        const text = choices.map((choice) => choice.text.trim()).filter(Boolean).join(" ");
        this.closeHwrSheet();
        if (text) this.applyHwrReplace(insertId, afterWord, text);
      });
      actions.append(keep, replace);
      sheet.append(instruction, wordStrip, optionPanel, actions);
      if (choices.length > 0) renderOptions(0);
    }

    this.root.appendChild(sheet);
    this.hwrSheetEl = sheet;
    const r = sheet.getBoundingClientRect();
    this.hwrExclusionRect = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    this.syncWritingExclusion();
    this.props.onLayoutChanged?.();
  }

  /** Replace an ink run with recognized words spliced after its anchor word. */
  private applyHwrReplace(insertId: string, afterWord: number, text: string) {
    const inserted = text.split(/\s+/).filter(Boolean);
    if (inserted.length === 0) return;
    this.pushHistory();
    const without = removeInsert(this.doc, insertId);
    const words = [
      ...this.doc.words.slice(0, afterWord + 1),
      ...inserted,
      ...this.doc.words.slice(afterWord + 1),
    ];
    // retokenize only clamps anchors; shift anchors past the splice ourselves.
    const inserts = without.inserts.map((ins) =>
      ins.afterWord > afterWord ? { ...ins, afterWord: ins.afterWord + inserted.length } : ins
    );
    this.doc = { ...this.doc, words, inserts };
    this.textEdited = true;
    this.selectedInsertId = null;
    this.relayout();
    this.updateToolbarState();
  }

  // ---- Rendering ----
  private render() {
    // The surface is the scrolling flex child. Giving it the document's full
    // height makes it consume the modal and pushes the fixed tool footer out
    // of view after blank lines are inserted. Its absolutely positioned
    // canvas/overlay still provide the full scrollable content extent.
    this.containerEl.style.minHeight = "0px";
    this.renderOverlay();
    this.props.onLayoutChanged?.();
  }

  /** Rebuild the word/gap/line/ink overlay; canvas and textarea persist. */
  private renderOverlay() {
    const c = this.containerEl;
    const retainedInk = new Map<string, SVGElement>();
    Array.from(c.children).forEach((child) => {
      // Retain image/widget DOM across unrelated handwriting/text changes; decoding a photo
      // again on every word would put attachment work on the ordinary writing path.
      if(!this.keyboard && child instanceof HTMLElement && child.dataset.pageObject)return;
      // Keep the on-page input and Android composing state across IME resize.
      if (this.textPromptEl && child instanceof HTMLElement && child.contains(this.textPromptEl)) return;
      // the magnify target overlay is owned by MagnifyPad and survives overlay rebuilds
      if (child instanceof HTMLElement && (child.classList.contains("magnify-target") || child.classList.contains("magnify-sheet-extent"))) return;
      if (child instanceof SVGElement && child.classList.contains("rw-ink")) {
        const id = child.dataset.insertId;
        if (id) retainedInk.set(id, child);
        return;
      }
      if (child !== this.canvasEl && child !== this.textareaEl) c.removeChild(child);
    });

    if (this.keyboard) {
      this.textareaEl.value = textFromWords(this.doc.words);
      this.textareaEl.style.lineHeight = `${this.lineHeight}px`;
      this.textareaEl.style.minHeight = `${this.layout.height}px`;
      this.textareaEl.style.display = "";
      this.canvasEl.style.display = "none";
      return;
    }
    this.textareaEl.style.display = "none";
    const nativeOwnsVisibleInk =
      (this.nativeInkActive || (!!this.magnifyPad && !!this.props.native)) &&
      !this.magnifyWebViewMode && !this.nativeWebHandoff && !this.nativeDialogHandoff;
    this.canvasEl.style.display = nativeOwnsVisibleInk ? "none" : "";

    const frag = document.createDocumentFragment();
    const textBoxesById=new Map(this.doc.textBoxes?.map(box=>[box.id,box]));
    for (const p of this.layout.placed) {
      const top = p.line * this.lineHeight;
      if (p.kind === "word") {
        const span = document.createElement("span");
        span.className = "rw-word";
        span.style.font = this.boxFont(p.textBoxId?textBoxesById.get(p.textBoxId):undefined);
        span.style.lineHeight = "1.2";
        span.style.left = `${p.x}px`;
        span.style.top = `${top}px`;
        span.style.height = `${this.lineHeight}px`;
        span.textContent = p.text;
        const styledBox=p.textBoxId?textBoxesById.get(p.textBoxId):undefined;
        if(styledBox?.styles?.length){
          span.replaceChildren(...this.wordFragments(styledBox,p.textWordIndex,p.text).map(run=>{
            const part=document.createElement('span');part.textContent=run.text;
            part.style.font=styleFont(this.boxFont(styledBox),run);
            if('strike' in run&&run.strike)part.style.textDecoration='line-through';
            return part;
          }));
        }
        const checkBox = p.textBoxId ? this.doc.textBoxes?.find(b => b.id === p.textBoxId && b.checkbox) : undefined;
        if (checkBox) {
          const check = document.createElement("button"); check.className = "rw-checklist-toggle";
          check.setAttribute("role", "checkbox"); check.setAttribute("aria-label", "Task complete");
          check.setAttribute("aria-checked", String(checkBox.text === "☑"));
          check.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/>${checkBox.text === "☑" ? '<path d="M6 12l4 4 8-9"/>' : ""}</svg>`;
          // While native writing owns the paper, only its completed strokes toggle pen controls.
          // Finger and non-native pen taps remain WebView controls with the normal flush handoff.
          // Capture the state the user pressed, rather than toggling whatever the flush delivers.
          // Keep the compatibility-click guard outside this node: renderOverlay replaces it.
          bindPenButton(check, () => {
            const checked = checkBox.text !== "☑";
            this.afterNativeFlush(() => this.setChecklist(checkBox.id, checked));
          }, true, this.checkboxActivation(checkBox.id), () => this.nativeOwnsControlPen());
          span.replaceChildren(check);
        }
        // Starter headings are real text boxes, not baked-in template decoration.
        // Finger controls open the existing editor through the native flush handoff,
        // keeping line anchors, Undo, persistence and the Android IME unchanged.
        const heading = p.textBoxId ? this.doc.textBoxes?.find(b => b.id === p.textBoxId && !b.checkbox && b.id.startsWith("template-")) : undefined;
        if (heading) {
          const edit = document.createElement("button");
          edit.className = "rw-template-heading";
          edit.textContent = p.text; edit.setAttribute("aria-label", `Edit heading: ${heading.text}`);
          bindPenButton(edit, () => this.afterNativeFlush(() => {
            this.selectedTemplateSectionId = heading.id;
            this.setTool("select");
            this.editTextBox(heading.id);
          }));
          span.replaceChildren(edit);
        }
        if (p.textBoxId) {
          span.dataset.textBoxWord=p.textBoxId;span.dataset.textWordIndex=String(p.textWordIndex);
        }
        frag.appendChild(span);
      } else if (p.kind === "gap") {
        const span = document.createElement("span");
        span.className = "rw-gap";
        span.setAttribute("aria-hidden", "true");
        span.dataset.insertId = p.gapId;
        span.style.left = `${p.x}px`;
        span.style.top = `${top}px`;
        span.style.width = `${p.width}px`;
        span.style.height = `${this.lineHeight}px`;
        frag.appendChild(span);
      }
    }

    const activeLineId = this.tool === "lines" ? this.activeSpacingInsert("line")?.id : undefined;
    for (const marker of this.layout.lineMarkers) {
      if (marker.id !== activeLineId) continue;
      const span = document.createElement("span");
      span.className = "rw-line-gap";
      span.setAttribute("aria-hidden", "true");
      span.style.top = `${marker.top}px`;
      span.style.height = "0px";
      frag.appendChild(span);
    }

    const activeGap = this.tool === "insert" ? this.activeSpacingInsert("gap") : undefined;
    const persistentGapGuide =
      activeGap?.scopeX !== undefined && activeGap.scopeLine !== undefined
        ? {
            x: Math.max(0, activeGap.scopeX + activeGap.width),
            top: activeGap.scopeLine * this.lineHeight,
          }
        : null;
    const insertionGuide = this.insertionGuide ?? persistentGapGuide;
    if (insertionGuide) {
      const guide = document.createElement("span");
      guide.className = "rw-insertion-guide";
      guide.setAttribute("aria-hidden", "true");
      guide.style.left = `${insertionGuide.x}px`;
      guide.style.top = `${insertionGuide.top}px`;
      guide.style.height = `${this.lineHeight}px`;
      frag.appendChild(guide);
    }

    // In pencil/write mode committed ink lives in the daemon layer (renderInk
    // from getNativeInkStrokes). Other tools render it in the DOM because the
    // daemon surface is detached.
    const inkInserts = nativeOwnsVisibleInk || (this.nativeWebHandoff && !this.magnifyPad)
      ? []
      : this.doc.inserts.filter(
          (i): i is Insert & { kind: "ink" } => i.kind === "ink" && i.strokes.length > 0
        );
    for (const ins of inkInserts) {
      const b = strokesBounds(ins.strokes, PAD);
      const placement = this.layout.inkPlacements.get(ins.id);
      if (!placement) continue;
      let svgEl = retainedInk.get(ins.id);
      const previousStrokes = this.renderedInkStrokes.get(ins.id);
      const pathsChanged =
        !svgEl ||
        !previousStrokes ||
        previousStrokes.length !== ins.strokes.length ||
        previousStrokes.some((stroke, index) => stroke !== ins.strokes[index]);
      if (!svgEl) svgEl = svg("svg", {}) as SVGElement;
      svgEl.setAttribute("viewBox", `${b.x} ${b.y} ${Math.max(1, b.width)} ${Math.max(1, b.height)}`);
      svgEl.setAttribute("width", String(b.width));
      svgEl.setAttribute("height", String(b.height));
      svgEl.setAttribute("class", `rw-ink${this.selectedInsertId === ins.id ? " selected" : ""}`);
      svgEl.setAttribute("data-insert-id", ins.id);
      // A preview is a pending transform only. Once the model owns the final position
      // (including Undo/cancel), never apply that delta again on the retained SVG node.
      svgEl.style.transform = "";
      (svgEl as unknown as HTMLElement).style.left = `${placement.x}px`;
      (svgEl as unknown as HTMLElement).style.top = `${placement.y}px`;
      if (pathsChanged) {
        svgEl.replaceChildren();
        for (const s of ins.strokes) {
          const path = svg("path", { d: outlinePathD(strokeOutline(s.points, s.width, s.brushStyle)) });
          path.setAttribute("fill", s.color);
          svgEl.appendChild(path);
        }
      }
      this.renderedInkStrokes.set(ins.id, ins.strokes.slice());
      if (!retainedInk.has(ins.id)) frag.appendChild(svgEl);
      retainedInk.delete(ins.id);
    }

    for (const [id, stale] of retainedInk) {
      stale.remove();
      this.renderedInkStrokes.delete(id);
    }

    if(this.tool==='select') {
      const bounds=this.getSelectedBlockBounds();
      if(bounds) {
        const box=document.createElement('div');box.className='rw-selection-box';box.setAttribute('aria-label','Selected words');
        box.style.cssText=`left:${bounds.x}px;top:${bounds.y}px;width:${bounds.width}px;height:${bounds.height}px`;
        frag.append(box);
      }
    }
    c.insertBefore(frag, this.canvasEl);
    this.renderTextBoxes();
    this.renderPageObjects();
  }

  /** Keep the solid lane-height caret on the live edge of the gesture without
   * rebuilding the whole overlay for every high-rate pen sample. */
  private moveInsertionGuide(x: number, top: number) {
    this.insertionGuide = { x, top };
    const guide = this.containerEl.querySelector<HTMLElement>(".rw-insertion-guide");
    if (!guide) return;
    guide.style.left = `${x}px`;
    guide.style.top = `${top}px`;
  }
}
