// Client for the shared Kalamos HWR seam (optional host provider; see docs/features/HANDWRITING-RECOGNITION.md). Originally adapted from Notes'
// NotesPlanningHWR: request via Bridge.hwrRecognize, correlate the
// window.onHwrEvent result by reqId, chain any previous event handler.

import type { HwrClient, HwrResult, HwrWord } from "../vanilla/penWorkspace";

const LANG = "en-US";

function hasBridge(): boolean {
  return typeof Bridge !== "undefined";
}

type HwrEvent = {
  id?: string;
  type?: string;
  mode?: string;
  candidates?: { text?: string; label?: string }[];
  words?: HwrWord[];
  message?: string;
};

const callbacks: Record<string, (r: HwrResult) => void> = {};
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const prev = window.onHwrEvent;
  window.onHwrEvent = (json: string) => {
    let ev: HwrEvent | null = null;
    try {
      ev = typeof json === "string" ? (JSON.parse(json) as HwrEvent) : (json as HwrEvent);
    } catch {
      ev = null;
    }
    const cb = ev && ev.id ? callbacks[ev.id] : undefined;
    if (ev && cb) {
      if (ev.type === "result") {
        delete callbacks[ev.id!];
        const c = ev.candidates || [];
        cb({ text: c.length ? c[0].text || "" : "", candidates: c, words: ev.words });
      } else if (ev.type === "error") {
        delete callbacks[ev.id!];
        cb({ error: ev.message || "failed" });
      }
      return;
    }
    if (prev) prev(json);
  };
}

export const kalamosHwr: HwrClient = {
  available(): boolean {
    try {
      return hasBridge() && Bridge.hwrStatus(LANG) === "ready";
    } catch {
      return false;
    }
  },

  recognize(strokes, area, preContext, cb) {
    if (!hasBridge() || !Bridge.hwrRecognize) {
      cb({ error: "unavailable" });
      return;
    }
    install();
    const r = Bridge.hwrRecognize({ mode: "text", lang: LANG, strokes, area, preContext: preContext || "" });
    if (!r || r.err || !r.reqId) {
      cb({ error: (r && r.err) || "unavailable" });
      return;
    }
    callbacks[r.reqId] = cb;
  },
};
