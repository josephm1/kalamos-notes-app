// User preferences — split from db.ts so storage backends that don't use
// IndexedDB (the Kalamos device build) can share the type and defaults
// without pulling `idb` into their bundle.

export type Preferences = {
  lineHeight: number; // 38..56
  theme: "light" | "dark" | "eink";
  reduceEinkRefresh: boolean;
  penColor: string;
  penWidth: number;
  penQuickColors?: [string, string];
  brushStyle?: "pen" | "brush" | "marker";
  fingerTapEdits: boolean; // §17 flag: immediate vs select-then-tap
  defaultWritingLines: number; // §17 flag: 3 or 4
};

export const DEFAULT_PREFERENCES: Preferences = {
  lineHeight: 44,
  theme: "light",
  reduceEinkRefresh: false,
  penColor: "#1b2a4a",
  penWidth: 2.4,
  fingerTapEdits: false,
  defaultWritingLines: 3,
};
