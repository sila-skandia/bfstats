#!/bin/bash
# One ten-minute match of each level on the live page, side by side, judged by the rollout floor.
#   pagebatch.sh <mod folder> <PageName>:<level> [<PageName>:<level> ...]
# Writes bot-layers/<layers>/<level>/page.json and prints PASS or FAIL a level. Five at a time at most:
# more browsers than that and a match can stall. MATCHES=2 plays two (a level passes if either does).
. "$(dirname "$0")/env.sh"; mod_of "$1" || exit 2; shift
cd "$TOOLS" || exit 1
modarg=(); [ "$PAGEMOD" != "-" ] && modarg=(--mod "$PAGEMOD")
for p in "$@"; do
  name=${p%%:*}; level=${p##*:}
  node sim/pagematch.mjs check --map "$name" "${modarg[@]}" --matches "${MATCHES:-1}" \
    --out "bot-layers/$LAYERS/$level/page.json" > "$BOT_WORK/page/$LAYERS-$level.log" 2>&1 &
done
wait
for p in "$@"; do
  level=${p##*:}
  python3 - "bot-layers/$LAYERS/$level/page.json" "$level" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    runs = [(r["rollout"]["pass"], r["rollout"]["why"], r.get("enemyKillsPerBotMinute"), r.get("capturesTotal"),
             r["rollout"]["ownHand"], r.get("tickets"), "replayed" if r.get("replayed") else "") for r in d["runs"]]
    print(sys.argv[2], "PASS" if d["rollout"]["pass"] else "FAIL", "| DICE's bar:", d["verdict"], "|",
          "; ".join(f"kills {k} captures {c} own-hand {o} tickets {t} {'' if ok else why} {rp}".strip() for ok, why, k, c, o, t, rp in runs))
except Exception as e:
    print(sys.argv[2], "NO RESULT", e)
PY
done
