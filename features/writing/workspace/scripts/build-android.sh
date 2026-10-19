#!/usr/bin/env bash
# Build the canonical Writing source and install its generated artifacts into the feature's
# Android library. This is an intra-feature generation step; it never copies code into an app.

set -euo pipefail
WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_ASSETS="$(cd "$WORKSPACE/../android/src/main/assets/web" && pwd)"

cd "$WORKSPACE"
npx vite build -c vite.kalamos.config.ts

if grep -qE 'import\.meta|import\(' dist-kalamos/write-workspace.js; then
  echo "error: write-workspace.js contains import.meta or dynamic import()" >&2
  echo "       Android loads it as a classic file:// script" >&2
  exit 1
fi

install -m 0644 dist-kalamos/write-workspace.js "$ANDROID_ASSETS/js/write-workspace.js"
install -m 0644 dist-kalamos/write-workspace.css "$ANDROID_ASSETS/css/write-workspace.css"
install -m 0644 src/kalamos/notes-writing-ui.css "$ANDROID_ASSETS/css/notes-writing-ui.css"

echo "Generated features/writing/android assets"
