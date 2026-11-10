#!/bin/bash
# One command for the recording-ml trial (features/recording-ml):
#
#   tools/recording-ml/run.sh             fetch what is new, export, build, analyse
#   tools/recording-ml/run.sh --no-sync   the same on the recordings already here
#
# Everything it reads and writes besides the public feed is under
# ~/.cache/bfstats-recml (or $BFSTATS_RECML_DIR): raw recordings, the name
# key, tables, Parquet, the virtualenv and the reports in out/. A run on an
# unchanged corpus re-exports nothing and takes about two minutes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MODELS="$REPO/tools/bf1942-models"
DATA="${BFSTATS_RECML_DIR:-$HOME/.cache/bfstats-recml}"
PY="$DATA/venv/bin/python"

if [ ! -x "$PY" ]; then
    python3 -m venv "$DATA/venv"
    "$DATA/venv/bin/pip" install --quiet -r "$HERE/requirements.txt"
fi

if [ "${1:-}" != "--no-sync" ]; then
    "$PY" "$HERE/sync.py" --data "$DATA"
fi

# Tables without names (air encounters, ticks, kills, tickets, ...).
node --max-old-space-size=8000 "$MODELS/export_recording_tables.mjs" --data "$DATA" \
    --commit "$(git -C "$REPO" rev-parse --short HEAD)"

# The tank school's own extract, afresh each run so a recording removed from
# the feed leaves nothing behind, then flattened with names keyed.
rm -rf "$DATA/extract/tankfights"
node --max-old-space-size=8000 "$MODELS/extract_tank_fights.mjs" "$DATA/raw" --out "$DATA/extract/tankfights" \
    --feed "$DATA/raw/feed.json" --glb-cache "$DATA/catalogue/glb-guns.json" 2>&1 | grep -v '^replay:' | tail -n 1
"$PY" "$HERE/flatten_tank_fights.py" --data "$DATA"

"$PY" "$HERE/build_tables.py" --data "$DATA"
"$PY" "$HERE/approach_model.py" --data "$DATA" > /dev/null
"$PY" "$HERE/tank_first_shots.py" --data "$DATA" > /dev/null
"$PY" "$HERE/status.py" --data "$DATA"
echo
echo "Reports: $DATA/out/approach.md, tank_first_shots.md, status.md, approach-lead-times.png"
