#!/usr/bin/env bash
# Rebuild every parity fixture from the Node sidecar, then run the Kotlin
# tests against them. A failing test is a Node change the port has not had.
set -euo pipefail
cd "$(dirname "$0")"
for f in *.mjs; do
  [ "$f" = lib.mjs ] && continue # shared helpers, not a generator
  echo "== $f"
  node "$f"
done
cd ..
./gradlew -q :core:test
