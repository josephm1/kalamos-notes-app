// Browser entry for vanilla.html — the pre-seam behavior: #app host,
// welcome screen, File System Access open/save, IndexedDB persistence.

import { createApp } from "./main";
import { browserStore } from "../documents/browserStore";

createApp(document.getElementById("app")!, {
  store: browserStore,
  chrome: "browser",
});
