#!/usr/bin/env bash
# The studio's tutorial videos, made from the tour itself: the tour walked
# with the mouse in a headless page (steps-tour.js), the page captured as it
# runs, then the whole tour and each step encoded as its own video
# (cut-tour-videos.cjs). Run it again whenever a control the tour shows
# changes; nothing is recorded by hand.
#
#   make-tour-videos.sh [out-dir] [--replay replays/<file>.ndjson] [--base http://localhost:5273]
#
# Needs the viewer served (the owner's checkout on :5273 by default), ffmpeg,
# and no other headless browser running. The frames take about 1 GB while it
# runs; they are deleted once encoded.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="${HOME}/.cache/bfstats-studio-tour/videos"
if [[ $# -gt 0 && "$1" != --* ]]; then
  out="$1"
  shift
fi
extra=("$@")

if [[ "$(ps -eo args | grep -c '[h]eadless_shell' || true)" != 0 ]]; then
  echo "a headless browser is already running; wait for it to finish (one at a time on this PC)" >&2
  exit 1
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is not installed" >&2; exit 1; }

mkdir -p "$out"
cd "$out"
rm -f ./*.mp4
node "$here/studio-probe.cjs" --steps "$here/steps-tour.js" --out tour.json --shots tour --video "$out" "${extra[@]}"
node -e '
const r = require(process.argv[1]);
const bad = Object.entries(r.steps).filter(([k, v]) => k !== "open" && k !== "end" && (v?.error || v?.movedOn === false));
if (r.error || bad.length) {
  console.error("the tour did not run through:", r.error ?? "", JSON.stringify(bad).slice(0, 2000));
  process.exit(1);
}' "$out/tour.json"
node "$here/cut-tour-videos.cjs" --dir "$out" --report tour.json
# The videos, and the clip the tour recorded along the way (the studio's own download).
ls -la "$out"
