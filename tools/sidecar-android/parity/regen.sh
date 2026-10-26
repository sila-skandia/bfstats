#!/usr/bin/env bash
# Rebuild every parity fixture from the Node sidecar, then run the Kotlin
# tests against them on every target this PC builds (the JVM and linuxX64
# native; the iOS targets need a Mac). A failing test is a Node change the
# port has not had.
set -euo pipefail
cd "$(dirname "$0")"
for f in *.mjs; do
  echo "== $f"
  node "$f"
done
cd ..
./gradlew -q :core:jvmTest :core:linuxX64Test
