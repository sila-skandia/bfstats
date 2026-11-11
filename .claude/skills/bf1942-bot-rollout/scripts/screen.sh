#!/bin/bash
# Generate a bot layer for each level and judge it in the headless runner (a reduced matrix).
#   screen.sh <mod folder> <level>[,<level>...]      e.g. screen.sh fhsweurope adak_race,kursk-1943
# Writes tools/bf1942-models/bot-layers/<layers>/<level>/ (the layer, generated.json, verdict.json).
# SEEDS (default 2) and JOBS (default 6) may be set. A level on foot only: FOOT=1.
. "$(dirname "$0")/env.sh"; mod_of "$1" || exit 2
levels=$2; [ -n "$levels" ] || { echo "screen.sh <mod folder> <levels>"; exit 2; }
cd "$TOOLS" || exit 1
veh=(--vehicles); [ -n "$FOOT" ] && veh=()
for level in ${levels//,/ }; do
  [ -f "$MAPS/$level/scene.glb" ] || { echo "$level: not in $MAPS; run fetch.sh $1 $level first"; continue; }
  echo "== $level start $(date +%H:%M)"
  node sim/botbatch.mjs level "${veh[@]}" --maps "$MAPS" --models "$MODELS" --mod "$MOD" --levels "$level" \
    --game-dir "$GAME" --out "$BOT_WORK/runs/$1" --seeds "${SEEDS:-2}" --jobs "${JOBS:-6}" \
    2> "$BOT_WORK/runs/$1-$level.err" | tail -3
  python3 - "bot-layers/$LAYERS/$level/verdict.json" "$level" <<'PY'
import json, sys
try:
    v = json.load(open(sys.argv[1]))
    print(sys.argv[2], "->", v.get("outcome"), "| lint errors:", len(v.get("lintErrors") or []),
          "|", {k: (s.get("verdict"), len(s.get("failed") or [])) for k, s in (v.get("sizes") or {}).items()})
except Exception as e:
    print(sys.argv[2], "-> no verdict:", e)
PY
done
