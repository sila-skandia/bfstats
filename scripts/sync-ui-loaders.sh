#!/usr/bin/env bash
# Copies the loading scenes (tools/bf1942-models/viewer/play/loaders) into the
# stats site, which builds from ui/ alone and so cannot import them from tools/.
# The scene modules go under ui/src for Vite to bundle; the sprites go under
# ui/public, where the stats site's viewer-root.js stand-in points them.
#
# Run it after changing a scene or a sprite. tests/test_loaders.py fails while
# the copy differs from the source. See features/replay-shorts/README.md,
# "The loaders on the stats site".
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/tools/bf1942-models/viewer/play/loaders"
js="$root/ui/src/components/common/game-loaders/play/loaders"
img="$root/ui/public/game-loaders/play/loaders"

mkdir -p "$js" "$img"
find "$js" -maxdepth 1 -name '*.js' -delete
find "$img" -maxdepth 1 -name '*.webp' -delete
cp "$src"/*.js "$js"/
cp "$src"/*.webp "$img"/
echo "synced $(ls "$js"/*.js | wc -l) modules and $(ls "$img"/*.webp | wc -l) sprites"
