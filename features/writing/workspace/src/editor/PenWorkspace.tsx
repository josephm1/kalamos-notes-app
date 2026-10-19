import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
import { editableView } from "./blockSource";
import { strokesToRun } from "../sidecar/anchors";
import {
  anchorOffsetForInsert,
  collapseSpacing,
  newInsertId,
  orderedFlow,
  removeInsert,
  retokenize,
  textFromWords,
  tokenizeWords,
  updateInsert,
  type Insert,
  type ReflowDoc,
} from "./reflowModel";
import { reflow, type FlowBox, type PlacedBox } from "../reflow/placement";
import type { Preferences } from "../storage/db";
import {
  normalizeInkStrokes,
  packedInkTop,
  ruledBaselineOffset,
  ruledLineIndex,
  shouldMergeIntoInkWord,
  translateInkStrokes,
} from "./inkPlacement";

export type CommitPayload = { pageObjects?: import("./pageObjects").PageObject[]; layoutLineHeight?: number; sourceWords?: { text: string; x: number; y: number }[]; newSource: string; newRuns: InlineInkRun[]; textBoxes?: import("../sidecar/schema").TextBox[] };

type Tool = "write" | "insert" | "lines" | "erase" | "select";

type Props = {
  block: Block;
  existingRuns: InlineInkRun[];
  prefs: Preferences;
  eink: boolean;
  onCommit: (payload: CommitPayload) => void;
  onCancel: () => void;
};

const MIN_GAP = 28;
// Match the sidecar run padding so baseline offsets survive Done/reopen without
// a coordinate-system adjustment.
const PAD = 4;
const WORKSPACE_FONT = '19px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Dev-only structured logging for on-device debugging (read via remote
// DevTools). Namespaced so it's easy to filter in the console stream.
const dlog = import.meta.env.DEV
  ? (tag: string, data?: unknown) =>
      console.log(`[pw:${tag}]`, data === undefined ? "" : JSON.stringify(data))
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

/**
 * Focused writing workspace (BUILD_PLAN §5.3–5.4). Ink strokes stay in stable
 * run-local coordinates. The layout owns their screen position, exactly as it
 * owns each typed word's position, so reflow cannot translate stroke data and
 * rendering independently. Consecutive nearby strokes group into one atomic,
 * word-sized run.
 */
export function PenWorkspace({ block, existingRuns, prefs, eink, onCommit, onCancel }: Props) {
  const view = useMemo(() => editableView(block), [block]);
  const inkColor = eink ? "#000000" : prefs.penColor;
  const lineHeight = prefs.lineHeight;

  const [doc, setDoc] = useState<ReflowDoc>(() => {
    const words = tokenizeWords(view.value);
    const inserts: Insert[] = existingRuns.map((r) => ({
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
    return { words, inserts };
  });
  const [tool, setTool] = useState<Tool>("write");
  const [textEdited, setTextEdited] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [selectedInsertId, setSelectedInsertId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(320);

  const historyRef = useRef<ReflowDoc[]>([]);
  const redoRef = useRef<ReflowDoc[]>([]);
  const gesture = useRef<{
    pointerId: number | null;
    mode: Tool | null;
    insertId: string | null;
    startX: number;
    startY: number;
    gapX: number;
    prevWidth: number;
    prevLines: number;
    liveStroke: InkStroke | null;
    lastMove: { x: number; y: number };
  }>({ pointerId: null, mode: null, insertId: null, startX: 0, startY: 0, gapX: 0, prevWidth: 0, prevLines: 0, liveStroke: null, lastMove: { x: 0, y: 0 } });

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const gapRaf = useRef<number | null>(null);
  const pendingGapWidth = useRef(0);
  const pendingLineCount = useRef(0);
  // touch-action is none on the surface (so the browser can't steal pen
  // strokes as pan gestures); one-finger touch scrolling is re-implemented
  // here. Palm guard: touch is ignored during / just after pen contact.
  const touchScroll = useRef<{ id: number; lastY: number } | null>(null);
  const lastPenActivity = useRef(0);
  // Production-safe, bounded timing for the physical-device first-stroke investigation. Logging
  // the first few strokes plus any stroke after an idle gap lets logcat distinguish delayed input
  // dispatch from a delayed browser frame without flooding normal writing sessions.
  const inkTiming = useRef({ stroke: 0, lastEndMs: 0 });

  useEffect(() => {
    dlog("workspace:mount", { blockId: block.id });
    return () => dlog("workspace:unmount", { blockId: block.id });
  }, [block.id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const measure = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    // Use the exact same explicit font as .reflow-surface. Relying on the
    // computed `font` shorthand returned an empty value on the Android device,
    // so words were measured as serif but rendered as system-ui. The growing
    // width error made later words overlap and appear to change order.
    ctx.font = WORKSPACE_FONT;
    const space = Math.max(4, ctx.measureText("x x").width - 2 * ctx.measureText("x").width);
    return { word: (w: string) => ctx.measureText(w).width, space };
  }, []);

  // One ordered flow for typed words, handwriting, explicit horizontal space,
  // and full-line vertical space. Every visible object receives a stable place
  // in reading order; ink is no longer an independent overlay that can collide
  // with or leapfrog typed words.
  const layout = useMemo(() => {
    const flow = orderedFlow(doc);
    const boxes: FlowBox[] = [];
    const extraLinesByKey = new Map<string, number>();
    let extraLines = 0;
    for (const f of flow) {
      if (f.kind === "word") {
        const key = `w${f.index}`;
        boxes.push({ kind: "word", text: f.text, width: measure.word(f.text), key });
        extraLinesByKey.set(key, extraLines);
      } else if (f.insert.kind === "gap") {
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
        extraLines += Math.max(0, f.insert.lines ?? 0);
      }
    }
    const lineWidth = Math.max(40, width - 4);
    const base = reflow(
      boxes,
      lineWidth,
      measure.space,
      0,
      Math.max(measure.space, lineHeight * 0.4)
    );
    const placed = base.placed.map((p) => ({
      ...p,
      line: p.line + (extraLinesByKey.get(p.key ?? "") ?? 0),
    }));

    const slots: { afterWord: number; x: number; line: number }[] = [];
    let firstWord: PlacedBox | null = null;
    for (const p of placed) {
      if (p.kind === "word") {
        const idx = Number((p.key ?? "w-1").slice(1));
        slots.push({ afterWord: idx, x: p.x + p.width, line: p.line });
        if (firstWord === null) firstWord = p;
      }
    }
    slots.push({ afterWord: -1, x: firstWord ? firstWord.x : 0, line: firstWord ? firstWord.line : 0 });

    const inkPlacements = new Map<string, { x: number; y: number }>();
    for (const p of placed) {
      if (p.kind !== "ink") continue;
      const ins = doc.inserts.find((i) => i.id === p.runId);
      if (!ins || ins.kind !== "ink") continue;
      const b = strokesBounds(ins.strokes, PAD);
      const y = packedInkTop(p.line, lineHeight, ins.baselineOffset, b.height);
      inkPlacements.set(ins.id, { x: p.x, y });
    }
    for (const ins of doc.inserts) {
      if (
        ins.kind === "ink" &&
        ins.freeX !== undefined &&
        ins.freeY !== undefined
      ) {
        inkPlacements.set(ins.id, { x: ins.freeX, y: ins.freeY });
      }
    }

    const lineMarkers = doc.inserts
      .filter((i) => i.kind === "line" && (i.lines ?? 0) > 0)
      .map((ins) => {
        const nextWord = placed.find(
          (p) => p.kind === "word" && Number((p.key ?? "w-1").slice(1)) > ins.afterWord
        );
        const lines = ins.lines ?? 0;
        const fallbackLine = (slots.find((s) => s.afterWord === ins.afterWord)?.line ?? 0) + 1 + lines;
        const nextLine = nextWord?.line ?? fallbackLine;
        return { id: ins.id, top: Math.max(0, (nextLine - lines) * lineHeight), lines };
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
    const height = Math.max(prefs.defaultWritingLines * lineHeight, lineCount * lineHeight, inkBottom + 4);
    return { placed, height, slots, inkPlacements, lineMarkers };
  }, [doc, measure, width, lineHeight, prefs.defaultWritingLines]);

  useEffect(() => {
    dlog("layout:flow", {
      width: Math.round(width),
      items: layout.placed.map((p) => ({
        id: p.key,
        kind: p.kind,
        line: p.line,
        x: Math.round(p.x),
        width: Math.round(p.width),
      })),
    });
  }, [layout.placed, width]);

  const slotToPoint = useCallback(
    (afterWord: number) => {
      const s = layout.slots.find((sl) => sl.afterWord === afterWord) ?? layout.slots[layout.slots.length - 1];
      return { x: s.x, top: s.line * lineHeight };
    },
    [layout.slots, lineHeight]
  );

  const nearestSlot = useCallback(
    (x: number, y: number): number => {
      let best = -1;
      let bestDist = Infinity;
      for (const s of layout.slots) {
        const dx = x - s.x;
        const dy = y - (s.line * lineHeight + lineHeight / 2);
        const d = dx * dx + dy * dy * 4;
        if (d < bestDist) {
          bestDist = d;
          best = s.afterWord;
        }
      }
      return best;
    },
    [layout.slots, lineHeight]
  );

  const readingSlotAt = useCallback(
    (x: number, y: number): number => {
      const line = Math.max(0, Math.floor(y / lineHeight));
      let best = -1;
      let bestKey = -Infinity;
      for (const slot of layout.slots) {
        const key = slot.line * 100000 + slot.x;
        const isBefore = slot.line < line || (slot.line === line && slot.x <= x);
        if (isBefore && key > bestKey) {
          bestKey = key;
          best = slot.afterWord;
        }
      }
      return best;
    },
    [layout.slots, lineHeight]
  );

  const materializeFreeInk = useCallback(
    (current: ReflowDoc): ReflowDoc => {
      const visualKeys = new Map<string, number>();
      const visualData = new Map<
        string,
        { x: number; y: number; width: number; height: number; target: number }
      >();
      const wasFree = new Set<string>();
      const lineWidth = Math.max(40, width - 4);
      const inserts = current.inserts.map((ins) => {
        if (ins.kind !== "ink") return ins;
        const placement = layout.inkPlacements.get(ins.id);
        if (!placement || ins.strokes.length === 0) return ins;
        const local = strokesBounds(ins.strokes, PAD);
        const visual = {
          x: placement.x,
          y: placement.y,
          width: local.width,
          height: local.height,
        };
        const centerY = visual.y + visual.height / 2;
        visualKeys.set(
          ins.id,
          Math.floor(centerY / lineHeight) * 100000 + visual.x
        );
        if (ins.freeX === undefined || ins.freeY === undefined) return ins;
        wasFree.add(ins.id);
        const baselineOffset =
          ins.baselineOffset ?? ruledBaselineOffset(visual.y, visual.height, lineHeight);
        const ruledLine = Math.max(1, Math.round((visual.y + baselineOffset) / lineHeight));
        visualData.set(ins.id, {
          ...visual,
          target: (ruledLine - 1) * lineWidth + Math.max(0, visual.x),
        });
        const { freeX: _freeX, freeY: _freeY, ...packed } = ins;
        void _freeX;
        void _freeY;
        return {
          ...packed,
          afterWord: readingSlotAt(visual.x, centerY),
          baselineOffset,
        } as Insert;
      });

      const ordered = [...inserts];
      const anchorsWithInk = new Set(
        inserts.filter((ins) => ins.kind === "ink").map((ins) => ins.afterWord)
      );
      for (const anchor of anchorsWithInk) {
        const indexes = ordered
          .map((ins, index) => ({ ins, index }))
          .filter(({ ins }) => ins.kind === "ink" && ins.afterWord === anchor)
          .map(({ index }) => index);
        const runs = indexes
          .map((index) => ordered[index])
          .sort(
            (a, b) =>
              (visualKeys.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
              (visualKeys.get(b.id) ?? Number.MAX_SAFE_INTEGER)
          );
        indexes.forEach((index, i) => {
          ordered[index] = runs[i];
        });
      }

      // Retain the exact forward distance between the typed anchor and every
      // newly packed ink run. This is the missing information that previously
      // collapsed y=312 handwriting into y=80 after an insertion gesture.
      const withAdvances = [...ordered];
      for (const anchor of anchorsWithInk) {
        const slot = layout.slots.find((candidate) => candidate.afterWord === anchor);
        let cursor = slot ? slot.line * lineWidth + slot.x : 0;
        for (let index = 0; index < withAdvances.length; index++) {
          const ins = withAdvances[index];
          if (ins.afterWord !== anchor) continue;
          if (ins.kind === "gap") {
            cursor += Math.max(0, ins.width);
            continue;
          }
          if (ins.kind !== "ink") continue;
          const visual = visualData.get(ins.id);
          if (wasFree.has(ins.id) && visual) {
            const flowAdvance = Math.max(0, visual.target - cursor);
            withAdvances[index] = { ...ins, flowAdvance };
            dlog("ink:materialize", {
              id: ins.id,
              from: { x: Math.round(visual.x), y: Math.round(visual.y) },
              target: Math.round(visual.target),
              advance: Math.round(flowAdvance),
            });
            cursor += flowAdvance + visual.width;
          } else {
            cursor += Math.max(0, ins.flowAdvance ?? 0) + Math.max(0, ins.width);
          }
        }
      }
      return { ...current, inserts: withAdvances };
    },
    [layout.inkPlacements, layout.slots, lineHeight, readingSlotAt, width]
  );

  // Vertical space acts on a ruled-line boundary, not on an arbitrary x
  // coordinate. Everything whose typed anchor begins below that boundary is
  // shifted by whole lines while retaining its horizontal arrangement.
  const lineAnchorForY = useCallback(
    (y: number): number => {
      const boundary = Math.max(0, Math.round(y / lineHeight));
      let afterWord = -1;
      for (const p of layout.placed) {
        if (p.kind !== "word" || p.line >= boundary) continue;
        const index = Number((p.key ?? "w-1").slice(1));
        afterWord = Math.max(afterWord, index);
      }
      return afterWord;
    },
    [layout.placed, lineHeight]
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = Math.round(width * dpr);
    c.height = Math.round(layout.height * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${layout.height}px`;
    dlog("layout:size", { width, height: Math.round(layout.height) });
  }, [width, layout.height, dpr]);

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, layout.height);
    }
  };

  // The canvas only ever holds the in-progress stroke, so a full clear+refill
  // per frame is cheap and lets live ink use the exact committed geometry —
  // no visual pop on pen-up.
  const drawLiveStroke = (points: InkPoint[], stroke: InkStroke) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, layout.height);
    fillStroke(ctx, points, stroke.width, stroke.color);
  };

  const pushHistory = useCallback(() => {
    historyRef.current.push(doc);
    redoRef.current = [];
  }, [doc]);

  const undo = () => {
    const prev = historyRef.current.pop();
    if (prev) {
      redoRef.current.push(doc);
      setDoc(prev);
      clearCanvas();
    }
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (next) {
      historyRef.current.push(doc);
      setDoc(next);
    }
  };

  const localPoint = (e: React.PointerEvent): InkPoint => {
    const el = containerRef.current!;
    const rect = el.getBoundingClientRect();
    // Content coordinates: include the surface's own scroll offset so writing
    // lands where the pen touches even after the workspace has been scrolled.
    const x = e.clientX - rect.left + el.scrollLeft;
    const y = e.clientY - rect.top + el.scrollTop;
    if (logRef.current) {
      logRef.current.textContent = `${e.pointerType} raw(${e.clientX.toFixed(0)},${e.clientY.toFixed(
        0
      )}) → local(${x.toFixed(0)},${y.toFixed(0)}) p=${(e.pressure || 0).toFixed(2)} [${tool}]`;
    }
    // Keep raw pressure: width mapping detects flat/absent pressure itself
    // and falls back to velocity-based width.
    return { x, y, t: e.timeStamp || performance.now(), pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY };
  };

  const inkVisualBounds = useCallback(
    (ins: Insert): (Bounds & { localX: number; localY: number }) | null => {
      if (ins.kind !== "ink" || ins.strokes.length === 0) return null;
      const placement =
        layout.inkPlacements.get(ins.id) ??
        (ins.freeX !== undefined && ins.freeY !== undefined
          ? { x: ins.freeX, y: ins.freeY }
          : undefined);
      if (!placement) return null;
      const local = strokesBounds(ins.strokes, PAD);
      return {
        x: placement.x,
        y: placement.y,
        width: local.width,
        height: local.height,
        localX: local.x,
        localY: local.y,
      };
    },
    [layout.inkPlacements]
  );

  const inkRunAt = (x: number, y: number): string | null => {
    let hit: string | null = null;
    for (const ins of doc.inserts) {
      if (ins.kind !== "ink" || ins.strokes.length === 0) continue;
      const b = inkVisualBounds(ins);
      if (!b) continue;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) hit = ins.id;
    }
    return hit;
  };

  // ---- Pointer handling: pen (and mouse for dev) writes; touch scrolls. ----
  const onPointerDown = (e: React.PointerEvent) => {
    const handlerStarted = performance.now();
    if (e.pointerType === "pen") lastPenActivity.current = handlerStarted;
    if (e.pointerType === "touch") {
      const sincePen = performance.now() - lastPenActivity.current;
      if (
        gesture.current.pointerId === null &&
        touchScroll.current === null &&
        sincePen > 500
      ) {
        touchScroll.current = { id: e.pointerId, lastY: e.clientY };
      }
      return;
    }
    if (gesture.current.pointerId !== null) return;
    const p = localPoint(e);
    gesture.current.pointerId = e.pointerId;
    gesture.current.startX = e.clientX;
    gesture.current.startY = e.clientY;
    gesture.current.lastMove = { x: p.x, y: p.y };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail if the pointer lifted before this handler ran; the
      // gesture still proceeds with uncaptured events.
    }

    const barrelErase = (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0;
    const active: Tool = barrelErase ? "erase" : tool;
    gesture.current.mode = active;

    if (active === "select") {
      const hit = inkRunAt(p.x, p.y);
      dlog("select:down", { hit, x: Math.round(p.x), y: Math.round(p.y) });
      setSelectedInsertId(hit);
      gesture.current.insertId = hit;
      if (hit) pushHistory();
      return;
    }
    if (active === "erase") {
      eraseAt(p);
      return;
    }
    if (active === "insert") {
      const afterWord = nearestSlot(p.x, p.y);
      const existing = [...doc.inserts]
        .reverse()
        .find((ins) => ins.kind === "gap" && ins.afterWord === afterWord);
      const id = existing?.id ?? newInsertId("gap");
      gesture.current.insertId = id;
      gesture.current.gapX = slotToPoint(afterWord).x;
      gesture.current.prevWidth = existing?.width ?? MIN_GAP;
      pendingGapWidth.current = gesture.current.prevWidth;
      pushHistory();
      setDoc((d) => {
        const packed = materializeFreeInk(d);
        if (existing) return packed;
        const inserts = [...packed.inserts];
        const firstAtAnchor = inserts.findIndex((ins) => ins.afterWord === afterWord);
        const gap: Insert = {
          id,
          afterWord,
          kind: "gap",
          width: MIN_GAP,
          height: lineHeight,
          strokes: [],
        };
        if (firstAtAnchor < 0) inserts.push(gap);
        else inserts.splice(firstAtAnchor, 0, gap);
        return { ...packed, inserts };
      });
      return;
    }
    if (active === "lines") {
      const afterWord = lineAnchorForY(p.y);
      const existing = [...doc.inserts]
        .reverse()
        .find((ins) => ins.kind === "line" && ins.afterWord === afterWord);
      const id = existing?.id ?? newInsertId("line");
      gesture.current.insertId = id;
      gesture.current.prevLines = existing?.lines ?? 0;
      pendingLineCount.current = gesture.current.prevLines;
      pushHistory();
      setDoc((d) => {
        const packed = materializeFreeInk(d);
        if (existing) return packed;
        return {
          ...packed,
          inserts: [
            ...packed.inserts,
            { id, afterWord, kind: "line", width: 0, height: 0, lines: 0, strokes: [] },
          ],
        };
      });
      return;
    }

    // Every stroke starts in a temporary run. Even when its first point falls
    // inside an existing ink bounding box, word membership is decided only on
    // pointer-up from the completed stroke's ruled lane. A capital on the lane
    // below can overlap the capital above; treating that visual hit as proof of
    // membership created the two-line merged objects exposed by Collapse.
    pushHistory();
    const targetId = newInsertId("ink");
    const now = performance.now();
    const afterWord = nearestSlot(p.x, p.y);
    setDoc((d) => ({
      ...d,
      inserts: [
        ...d.inserts,
        {
          id: targetId,
          afterWord,
          kind: "ink",
          width: 0,
          height: lineHeight,
          strokes: [],
          freeX: p.x - PAD,
          freeY: p.y - PAD,
        },
      ],
    }));
    gesture.current.insertId = targetId;
    gesture.current.liveStroke = {
      id: `s-${now.toFixed(0)}`,
      tool: "pen",
      color: inkColor,
      width: prefs.penWidth,
      points: [p],
      bounds: boundsOfPoints([p]),
    };
    // Immediate contact feedback: show the dot before the first move event.
    drawLiveStroke(gesture.current.liveStroke.points, gesture.current.liveStroke);
    const drawFinished = performance.now();
    const timing = inkTiming.current;
    const strokeNumber = ++timing.stroke;
    const idleMs = timing.lastEndMs > 0 ? handlerStarted - timing.lastEndMs : -1;
    const rawEventAge = handlerStarted - e.timeStamp;
    const eventAgeMs = Math.abs(rawEventAge) < 60_000 ? Math.max(0, rawEventAge) : -1;
    requestAnimationFrame((frameTime) => {
      const frameMs = Math.max(0, frameTime - handlerStarted);
      if (strokeNumber <= 10 || idleMs >= 1_000 || eventAgeMs >= 20 || frameMs >= 30) {
        console.info(
          `[kalamos-ink] PEN_DOWN #${strokeNumber}` +
            ` idle=${idleMs < 0 ? "first" : idleMs.toFixed(1)}ms` +
            ` dispatch=${eventAgeMs < 0 ? "unknown" : eventAgeMs.toFixed(1)}ms` +
            ` draw=${(drawFinished - handlerStarted).toFixed(1)}ms` +
            ` frame=${frameMs.toFixed(1)}ms`
        );
      }
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "pen") lastPenActivity.current = performance.now();
    if (touchScroll.current && e.pointerId === touchScroll.current.id) {
      const dy = e.clientY - touchScroll.current.lastY;
      touchScroll.current.lastY = e.clientY;
      const el = containerRef.current;
      if (el) el.scrollTop -= dy;
      return;
    }
    if (e.pointerId !== gesture.current.pointerId) return;
    const p = localPoint(e);
    const mode = gesture.current.mode;

    if (mode === "select" && gesture.current.insertId) {
      const dx = p.x - gesture.current.lastMove.x;
      const dy = p.y - gesture.current.lastMove.y;
      gesture.current.lastMove = { x: p.x, y: p.y };
      const afterWord = nearestSlot(p.x, p.y);
      setDoc((d) => ({
        ...d,
        inserts: d.inserts.map((ins) => {
          if (ins.id !== gesture.current.insertId || ins.kind !== "ink") return ins;
          if (ins.freeX !== undefined && ins.freeY !== undefined) {
            return { ...ins, freeX: ins.freeX + dx, freeY: ins.freeY + dy };
          }
          return { ...ins, afterWord };
        }),
      }));
    } else if (mode === "erase") {
      eraseAt(p);
    } else if (mode === "insert" && gesture.current.insertId) {
      // Live reflow while the gesture is happening: widening the gap pushes
      // every later item in the single flow. Throttled to one state update per
      // frame so the pen and layout remain in lockstep.
      const dx = e.clientX - gesture.current.startX;
      // Starting on an existing spacer edits that spacer. A later leftward
      // gesture therefore reverses an earlier insertion instead of stacking a
      // second, unrelated gap at the same location.
      pendingGapWidth.current = Math.max(0, gesture.current.prevWidth + dx);
      if (gapRaf.current === null) {
        gapRaf.current = requestAnimationFrame(() => {
          gapRaf.current = null;
          const id = gesture.current.insertId;
          if (gesture.current.mode === "insert" && id) {
            setDoc((d) => updateInsert(d, id, { width: pendingGapWidth.current }));
          }
        });
      }
    } else if (mode === "lines" && gesture.current.insertId) {
      const dy = e.clientY - gesture.current.startY;
      pendingLineCount.current = Math.max(
        0,
        gesture.current.prevLines + Math.round(dy / lineHeight)
      );
      if (gapRaf.current === null) {
        gapRaf.current = requestAnimationFrame(() => {
          gapRaf.current = null;
          const id = gesture.current.insertId;
          if (gesture.current.mode === "lines" && id) {
            const lines = pendingLineCount.current;
            setDoc((d) => updateInsert(d, id, { lines, height: lines * lineHeight }));
          }
        });
      }
    } else if (mode === "write" && gesture.current.liveStroke) {
      const stroke = gesture.current.liveStroke;
      const native = e.nativeEvent as PointerEvent;
      const el = containerRef.current!;
      const rect = el.getBoundingClientRect();
      const offX = -rect.left + el.scrollLeft;
      const offY = -rect.top + el.scrollTop;
      const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [native];
      for (const ce of coalesced.length ? coalesced : [native]) {
        appendFiltered(stroke.points, {
          x: ce.clientX + offX,
          y: ce.clientY + offY,
          t: ce.timeStamp || performance.now(),
          pressure: ce.pressure,
          tiltX: ce.tiltX,
          tiltY: ce.tiltY,
        });
      }
      // Low-latency preview: extend the visible tail with the browser's
      // predicted points (never stored — replaced by real samples next frame).
      let renderPoints = stroke.points;
      if (typeof native.getPredictedEvents === "function") {
        const predicted = native.getPredictedEvents().slice(0, 3);
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
      drawLiveStroke(renderPoints, stroke);
    }
  };

  const finishGesture = (e: React.PointerEvent) => {
    if (touchScroll.current && e.pointerId === touchScroll.current.id) {
      touchScroll.current = null;
      return;
    }
    if (e.pointerId !== gesture.current.pointerId) return;
    const g = gesture.current;
    // pointercancel here means the browser stole the gesture (scroll/nav) —
    // prime suspect when a drag "vanishes".
    dlog("gesture:end", { type: e.type, mode: g.mode, id: g.insertId });
    gesture.current = { pointerId: null, mode: null, insertId: null, startX: 0, startY: 0, gapX: 0, prevWidth: 0, prevLines: 0, liveStroke: null, lastMove: { x: 0, y: 0 } };

    if (g.mode === "write" && g.liveStroke && g.insertId) {
      inkTiming.current.lastEndMs = performance.now();
      const stroke: InkStroke = { ...g.liveStroke, bounds: boundsOfPoints(g.liveStroke.points) };
      setDoc((d) => {
        const raw = strokesBounds([stroke]);
        const strokeVisual = strokesBounds([stroke], PAD);
        const strokeLine = ruledLineIndex(strokeVisual.y, strokeVisual.height, lineHeight);
        const strokeStartedAt = stroke.points[0]?.t ?? 0;
        const current = d.inserts.find((i) => i.id === g.insertId);

        let mergeTarget: Insert | undefined;
        let mergeTargetLine: number | undefined;
        if (!current || current.strokes.length === 0) {
          let bestScore = Infinity;
          for (const candidate of d.inserts) {
            if (
              candidate.id === g.insertId ||
              candidate.kind !== "ink" ||
              candidate.strokes.length === 0
            ) continue;
            const visual = inkVisualBounds(candidate);
            if (!visual) continue;
            const baselineY =
              visual.y +
              (candidate.baselineOffset ??
                ruledBaselineOffset(visual.y, visual.height, lineHeight));
            const runLine = Math.max(1, Math.round(baselineY / lineHeight));
            const candidateLastAt = candidate.strokes.reduce((latest, candidateStroke) => {
              const lastPoint = candidateStroke.points[candidateStroke.points.length - 1];
              return Math.max(latest, lastPoint?.t ?? 0);
            }, 0);
            const timeGapMs = Math.max(0, strokeStartedAt - candidateLastAt);
            if (!shouldMergeIntoInkWord({
              runLeft: visual.x,
              runRight: visual.x + visual.width,
              runLine,
              strokeLeft: strokeVisual.x,
              strokeRight: strokeVisual.x + strokeVisual.width,
              strokeLine,
              strokeHeight: strokeVisual.height,
              lineHeight,
              timeGapMs,
            })) continue;
            const horizontalGap =
              strokeVisual.x > visual.x + visual.width
                ? strokeVisual.x - (visual.x + visual.width)
                : visual.x > strokeVisual.x + strokeVisual.width
                  ? visual.x - (strokeVisual.x + strokeVisual.width)
                  : 0;
            // Recency resolves ambiguous lane geometry. In the captured T-bar
            // failure the correct stem was 160–280 ms old, while the visually
            // overlapping word above was about 6.5 seconds old.
            const score =
              horizontalGap +
              Math.abs(runLine - strokeLine) * lineHeight +
              Math.min(timeGapMs, 5000) * 0.04;
            if (score < bestScore) {
              bestScore = score;
              mergeTarget = candidate;
              mergeTargetLine = runLine;
            }
          }
        }

        dlog("ink:group", {
          stroke: g.insertId,
          strokeLine,
          target: mergeTarget?.id ?? null,
          targetLine: mergeTargetLine ?? null,
          timeGap: mergeTarget
            ? Math.round(
                strokeStartedAt -
                  mergeTarget.strokes.reduce((latest, candidateStroke) => {
                    const lastPoint = candidateStroke.points[candidateStroke.points.length - 1];
                    return Math.max(latest, lastPoint?.t ?? 0);
                  }, 0)
              )
            : null,
        });

        const prior = mergeTarget ?? current;
        let incoming = stroke;
        if (prior && prior.kind === "ink" && prior.strokes.length > 0) {
          const visual = inkVisualBounds(prior);
          if (visual) {
            incoming = translateInkStrokes(
              [stroke],
              visual.localX - visual.x,
              visual.localY - visual.y
            )[0];
          }
        }
        const normalized = normalizeInkStrokes([...(prior?.strokes ?? []), incoming], PAD);
        const strokes = normalized.strokes;
        const b = strokesBounds(strokes, PAD);
        const priorVisual = prior?.strokes.length ? inkVisualBounds(prior) : null;
        const priorBaseline =
          prior?.baselineOffset ??
          (priorVisual
            ? ruledBaselineOffset(priorVisual.y, priorVisual.height, lineHeight)
            : undefined);
        const firstFreeTop = raw.y - PAD;
        let next = updateInsert(d, prior?.id ?? g.insertId!, {
          strokes,
          width: b.width,
          height: Math.max(lineHeight, b.height),
          baselineOffset:
            priorBaseline === undefined
              ? ruledBaselineOffset(firstFreeTop, b.height, lineHeight)
              : priorBaseline + normalized.dy,
          ...(prior?.freeX !== undefined && (prior?.strokes.length ?? 0) === 0
            ? { freeX: raw.x - PAD, freeY: raw.y - PAD }
            : prior?.freeX !== undefined && prior?.freeY !== undefined
              ? {
                  freeX: prior.freeX - normalized.dx,
                  freeY: prior.freeY - normalized.dy,
                }
              : {}),
        });
        if (mergeTarget && mergeTarget.id !== g.insertId) {
          next = removeInsert(next, g.insertId!);
        }
        return next;
      });
      clearCanvas();
    } else if (g.mode === "insert" && g.insertId) {
      if (gapRaf.current !== null) {
        cancelAnimationFrame(gapRaf.current);
        gapRaf.current = null;
      }
      const finalWidth = pendingGapWidth.current;
      setDoc((d) => {
        const ins = d.inserts.find((i) => i.id === g.insertId);
        if (!ins || ins.kind !== "gap") return d;
        if (finalWidth < 8) return removeInsert(d, g.insertId!);
        return updateInsert(d, g.insertId!, { width: finalWidth });
      });
    } else if (g.mode === "lines" && g.insertId) {
      if (gapRaf.current !== null) {
        cancelAnimationFrame(gapRaf.current);
        gapRaf.current = null;
      }
      const finalLines = pendingLineCount.current;
      setDoc((d) => {
        const ins = d.inserts.find((i) => i.id === g.insertId);
        if (!ins || ins.kind !== "line") return d;
        if (finalLines < 1) return removeInsert(d, g.insertId!);
        return updateInsert(d, g.insertId!, {
          lines: finalLines,
          height: finalLines * lineHeight,
        });
      });
    }
  };

  const eraseAt = (p: InkPoint) => {
    const radius = 16;
    setDoc((d) => {
      let changed = false;
      const inserts = d.inserts
        .map((ins) => {
          if (ins.kind !== "ink") return ins;
          const visual = inkVisualBounds(ins);
          if (!visual) return ins;
          const localX = p.x - visual.x + visual.localX;
          const localY = p.y - visual.y + visual.localY;
          const survivors = ins.strokes.filter(
            (s) => !strokeHitsPoint(s.points, localX, localY, radius, s.width)
          );
          if (survivors.length !== ins.strokes.length) {
            changed = true;
            const normalized = normalizeInkStrokes(survivors, PAD);
            const b = strokesBounds(normalized.strokes, PAD);
            const baselineOffset =
              (ins.baselineOffset ??
                ruledBaselineOffset(visual.y, visual.height, lineHeight)) + normalized.dy;
            return {
              ...ins,
              strokes: normalized.strokes,
              width: b.width,
              height: Math.max(lineHeight, b.height),
              baselineOffset,
              ...(ins.freeX !== undefined && ins.freeY !== undefined
                ? {
                    freeX: ins.freeX - normalized.dx,
                    freeY: ins.freeY - normalized.dy,
                  }
                : {}),
            };
          }
          return ins;
        })
        .filter((ins) => !(ins.kind === "ink" && ins.strokes.length === 0));
      return changed ? { ...d, inserts } : d;
    });
  };

  const onTextChange = (value: string) => {
    setTextEdited(true);
    pushHistory();
    setDoc((d) => retokenize(d, value));
  };

  /** Remove user-created horizontal and vertical whitespace. Ink already owns
   * a real box in the same flow as typed words, so no synthetic reservation
   * gaps are needed and nothing can be counted twice. */
  const collapse = () => {
    const hasSpacing = doc.inserts.some(
      (i) =>
        i.kind === "gap" ||
        i.kind === "line" ||
        (i.kind === "ink" && (i.flowAdvance ?? 0) > 0)
    );
    if (!hasSpacing) return;
    pushHistory();
    setDoc((d) => {
      const packed = materializeFreeInk(d);
      return collapseSpacing(packed);
    });
  };

  const handleDone = () => {
    const text = textFromWords(doc.words);
    const newSource = textEdited ? view.rebuild(text) : block.source;
    const preserveLayout = doc.inserts.some(
      (insert) =>
        insert.kind === "gap" ||
        insert.kind === "line" ||
        insert.freeX !== undefined ||
        insert.freeY !== undefined ||
        (insert.flowAdvance ?? 0) > 0
    );
    const newRuns: InlineInkRun[] = [];
    for (const ins of doc.inserts) {
      if (ins.kind !== "ink" || ins.strokes.length === 0) continue;
      const visual = inkVisualBounds(ins);
      const afterWord =
        ins.freeX !== undefined && visual
          ? readingSlotAt(visual.x, visual.y + visual.height / 2)
          : ins.afterWord;
      const run = strokesToRun(ins.strokes, {
        blockId: block.id,
        anchorOffset: anchorOffsetForInsert(doc.words, afterWord),
        blockText: text,
        baselineOffset: ins.baselineOffset,
        ...(preserveLayout && visual
          ? { layoutX: visual.x, layoutY: visual.y }
          : {}),
        id: ins.id,
      });
      if (run) newRuns.push(run);
    }
    onCommit({ newSource, newRuns });
  };

  const inkInserts = doc.inserts.filter(
    (i): i is Insert & { kind: "ink" } => i.kind === "ink" && i.strokes.length > 0
  );

  return (
    <div className="pen-workspace" role="group" aria-label="Writing workspace">
      <div
        ref={containerRef}
        className={`reflow-surface tool-${tool}`}
        style={{
          minHeight: layout.height,
          lineHeight: `${lineHeight}px`,
          backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${
            lineHeight - 1
          }px, var(--rule) ${lineHeight - 1}px, var(--rule) ${lineHeight}px)`,
        }}
        onPointerDown={keyboard ? undefined : onPointerDown}
        onPointerMove={keyboard ? undefined : onPointerMove}
        onPointerUp={keyboard ? undefined : finishGesture}
        onPointerCancel={keyboard ? undefined : finishGesture}
        onLostPointerCapture={keyboard ? undefined : finishGesture}
      >
        {!keyboard &&
          layout.placed.map((p) => {
            const top = p.line * lineHeight;
            if (p.kind === "word") {
              return (
                <span key={p.key} className="rw-word" style={{ left: p.x, top, height: lineHeight }}>
                  {p.text}
                </span>
              );
            }
            if (p.kind === "gap") {
              return (
                <span key={p.key} data-insert-id={p.gapId} className="rw-gap" aria-hidden="true" style={{ left: p.x, top, width: p.width, height: lineHeight }} />
              );
            }
            return null;
          })}

        {!keyboard &&
          layout.lineMarkers.map((marker) => (
            <span
              key={marker.id}
              className="rw-line-gap"
              aria-hidden="true"
              style={{
                top: marker.top,
                height: marker.lines * lineHeight,
              }}
            />
          ))}

        {!keyboard &&
          inkInserts.map((ins) => {
            const b = strokesBounds(ins.strokes, PAD);
            const placement = layout.inkPlacements.get(ins.id);
            if (!placement) return null;
            return (
              <svg
                key={ins.id}
                data-insert-id={ins.id}
                className={`rw-ink${selectedInsertId === ins.id ? " selected" : ""}`}
                style={{ left: placement.x, top: placement.y, width: b.width, height: b.height }}
                viewBox={`${b.x} ${b.y} ${Math.max(1, b.width)} ${Math.max(1, b.height)}`}
                width={b.width}
                height={b.height}
              >
                {ins.strokes.map((s) => (
                  <path
                    key={s.id}
                    d={outlinePathD(strokeOutline(s.points, s.width))}
                    fill={inkColor}
                  />
                ))}
              </svg>
            );
          })}

        {keyboard && (
          <textarea
            ref={textareaRef}
            className="rw-textarea"
            autoFocus
            value={textFromWords(doc.words)}
            spellCheck={false}
            style={{ lineHeight: `${lineHeight}px`, minHeight: layout.height }}
            onChange={(e) => onTextChange(e.target.value)}
            aria-label="Edit block text"
          />
        )}

        {!keyboard && <canvas ref={canvasRef} className="rw-canvas" style={{ touchAction: "none" }} />}
      </div>

      {import.meta.env.DEV && (
        <div className="pen-log" aria-hidden="true">
          <span ref={logRef}>pen idle</span>
        </div>
      )}

      <div className="tool-pill" role="toolbar" aria-label="Editing tools">
        <button onClick={undo} aria-label="Undo" title="Undo">↺</button>
        <button onClick={redo} aria-label="Redo" title="Redo">↻</button>
        <span className="pill-sep" aria-hidden="true" />
        <button
          className={!keyboard && tool === "write" ? "active" : ""}
          onClick={() => { setKeyboard(false); setTool("write"); }}
          aria-pressed={!keyboard && tool === "write"}
          title="Write"
        >✎</button>
        <button
          className={!keyboard && tool === "insert" ? "active" : ""}
          onClick={() => { setKeyboard(false); setTool("insert"); }}
          aria-pressed={!keyboard && tool === "insert"}
          aria-label="Insert or remove horizontal space"
          title="Horizontal space — drag right to add, left to remove"
        >⟺</button>
        <button
          className={!keyboard && tool === "lines" ? "active" : ""}
          onClick={() => { setKeyboard(false); setTool("lines"); }}
          aria-pressed={!keyboard && tool === "lines"}
          aria-label="Insert or remove blank lines"
          title="Blank lines — drag down to add, up to remove"
        >↕</button>
        <button
          className={!keyboard && tool === "erase" ? "active" : ""}
          onClick={() => { setKeyboard(false); setTool("erase"); }}
          aria-pressed={!keyboard && tool === "erase"}
          title="Eraser"
        >⌫</button>
        <button
          className={!keyboard && tool === "select" ? "active" : ""}
          onClick={() => { setKeyboard(false); setTool("select"); setSelectedInsertId(null); }}
          aria-pressed={!keyboard && tool === "select"}
          title="Select / move handwriting"
        >◇</button>
        {tool === "select" && selectedInsertId && (
          <button
            className="delete-ink"
            onClick={() => {
              pushHistory();
              setDoc((d) => removeInsert(d, selectedInsertId));
              setSelectedInsertId(null);
            }}
            title="Delete selected handwriting"
          >🗑</button>
        )}
        <button onClick={collapse} aria-label="Collapse spacing" title="Close up spacing (one sentence)">»«</button>
        <button
          className={keyboard ? "active" : ""}
          onClick={() => setKeyboard((k) => !k)}
          aria-pressed={keyboard}
          title="Keyboard"
        >⌨</button>
        <span className="pill-sep" aria-hidden="true" />
        <button className="cancel" onClick={onCancel}>Cancel</button>
        <button className="done" onClick={handleDone}>Done ✓</button>
      </div>
    </div>
  );
}
