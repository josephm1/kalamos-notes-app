// Android feature build: one classic IIFE script + one CSS file, generated into this feature's
// Android library. Every app consumes that single library directly from the monorepo. IIFE is
// required —
// the Kalamos WebView loads file:///android_asset pages without
// allowFileAccessFromFileURLs, so ES module scripts are CORS-blocked there.

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist-kalamos",
    emptyOutDir: true,
    target: "es2017",
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/kalamos/entry.ts",
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "write-workspace.js",
        assetFileNames: "write-workspace.[ext]",
      },
    },
  },
});
