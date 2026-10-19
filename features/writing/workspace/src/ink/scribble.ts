// One shared implementation for classic WebView and canonical writing.
import '../../../../../foundation/android-runtime/src/main/assets/web/js/scribble-erase.js';
export type ScribblePoint = { x: number; y: number };
export type ScribbleStroke = { points: ScribblePoint[]; width?: number; tool?: string };
export type ScribbleResult = { indices: number[]; rect: { x: number; y: number; w: number; h: number } };
export const scribble = (globalThis as unknown as { KalamosScribbleErase: {
  candidate(points: ScribblePoint[], pitch?: number): boolean;
  detect(points: ScribblePoint[], strokes: ScribbleStroke[], pitch?: number, wordGroups?: number[][]): ScribbleResult | null;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
} }).KalamosScribbleErase;
