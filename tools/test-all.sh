#!/usr/bin/env bash
set -euo pipefail

# Self-contained check entry point promised by RULES.md. Does not install APKs, write user
# notebooks, regenerate tracked assets, or depend on the original monorepo's test scripts.
NOTES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NOTES_ROOT"
node --test --test-concurrency=1 apps/notes/tests/*.test.mjs features/content-components/tests/*.test.mjs
(
    cd features/writing/workspace
    npm test
    npm run typecheck
    npm run check:sources
)
"$NOTES_ROOT/tools/gradle.sh" testDebugUnitTest --no-daemon "$@"
