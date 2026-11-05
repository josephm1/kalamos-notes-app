// Browser preview uses the same DOM editor as both Android device builds.

import { createApp } from "./main";
import { browserStore } from "../documents/browserStore";

createApp(document.getElementById("app")!, {
  store: browserStore,
  chrome: "browser",
});
