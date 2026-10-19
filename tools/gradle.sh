#!/usr/bin/env bash
set -euo pipefail

# Run Gradle inside Android Studio's Flatpak when available. Prefer the Flatpak SDK's OpenJDK 17
# extension: Android Studio's bundled JBR now tracks Java 25, which this Gradle version cannot use.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v flatpak >/dev/null 2>&1 && flatpak info com.google.AndroidStudio >/dev/null 2>&1; then
  printf -v ARGS ' %q' "$@"
  exec flatpak run --env=FLATPAK_ENABLE_SDK_EXT=openjdk17 --command=sh com.google.AndroidStudio -c "
    cd '$ROOT'
    if [ ! -f /usr/lib/sdk/openjdk17/enable.sh ]; then
      echo 'The OpenJDK 17 extension matching Android Studio\x27s Flatpak runtime branch is required.' >&2
      exit 1
    fi
    . /usr/lib/sdk/openjdk17/enable.sh
    export PATH=\"\$JAVA_HOME/bin:\$PATH\"
    ./gradlew$ARGS
  "
fi

cd "$ROOT"
exec ./gradlew "$@"
