import type { InlineInkRun } from "../ink/types";

/** Current editor checkpoint contract shared by the DOM editor and its hosts. */
export type CommitPayload = { pageObjects?: import("./pageObjects").PageObject[]; layoutLineHeight?: number; sourceWords?: { text: string; x: number; y: number }[]; newSource: string; newRuns: InlineInkRun[]; textBoxes?: import("../sidecar/schema").TextBox[] };
