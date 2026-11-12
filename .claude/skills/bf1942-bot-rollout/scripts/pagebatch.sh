#!/bin/bash
# One ten-minute match of each level on the live page, side by side, judged by the rollout floor.
#   pagebatch.sh <mod folder> <PageName>:<level> [<PageName>:<level> ...]
# Writes bot-layers/<layers>/<level>/page.json and prints a line a level. Five at a time at most:
# more browsers than that and a match can stall. MATCHES=2 plays two.
#
# The record is cumulative: a level's earlier matches stay in front of the new one (pagematch rescore
# --earlier), and the level stands when any counted match passes. OLD_CODE="<what changed since>" marks
# every earlier match as played on other bot code: kept, not counted. Use it for a re-match after a
# bot-code change, when only the new match may decide.
#
# A match whose page never loads, or that dies, leaves the record as it was and prints NO RESULT. Do not
# fetch level trees or publish while matches play: on 2026-11-12 a tree fetch starved the page of its
# assets, fifteen matches timed out, and the old script printed the previous day's figures for them.
. "$(dirname "$0")/env.sh"; mod_of "$1" || exit 2; shift
cd "$TOOLS" || exit 1
modarg=(); [ "$PAGEMOD" != "-" ] && modarg=(--mod "$PAGEMOD")
mkdir -p "$BOT_WORK/page/prev"
# Stopped mid-match: every record goes back where it was.
putback() {
  for p in "$@"; do
    level=${p##*:}
    [ -f "bot-layers/$LAYERS/$level/page.json" ] || { [ -f "$BOT_WORK/page/prev/$LAYERS-$level.json" ] && mv "$BOT_WORK/page/prev/$LAYERS-$level.json" "bot-layers/$LAYERS/$level/page.json"; }
  done
}
trap 'kill $(jobs -p) 2>/dev/null; putback "$@"; exit 130' INT TERM
for p in "$@"; do
  name=${p%%:*}; level=${p##*:}
  file="bot-layers/$LAYERS/$level/page.json"; prev="$BOT_WORK/page/prev/$LAYERS-$level.json"
  rm -f "$prev"; [ -f "$file" ] && mv "$file" "$prev"
  node sim/pagematch.mjs check --map "$name" "${modarg[@]}" --matches "${MATCHES:-1}" \
    --out "$file" > "$BOT_WORK/page/$LAYERS-$level.log" 2>&1 &
done
wait
for p in "$@"; do
  level=${p##*:}
  file="bot-layers/$LAYERS/$level/page.json"; prev="$BOT_WORK/page/prev/$LAYERS-$level.json"
  if [ ! -f "$file" ]; then
    [ -f "$prev" ] && mv "$prev" "$file"
    echo "$level NO RESULT | $(grep -m1 -E "Timeout|Error|pagematch:" "$BOT_WORK/page/$LAYERS-$level.log" | cut -c1-90) | the record is as it was"
    continue
  fi
  new=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['runs']))" "$file")
  if [ -f "$prev" ]; then
    if [ -n "$OLD_CODE" ]; then node sim/pagematch.mjs rescore --file "$file" --earlier "$prev" --old-code "$OLD_CODE" > /dev/null
    else node sim/pagematch.mjs rescore --file "$file" --earlier "$prev" > /dev/null; fi
  fi
  python3 - "$file" "$level" "$new" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); n = int(sys.argv[3])
def line(r):
    ro = r["rollout"]
    return (f"kills {r.get('enemyKillsPerBotMinute')} captures {r.get('capturesTotal')} own-hand {ro['ownHand']} tickets {r.get('tickets')}"
            + ("" if ro["pass"] else f" {ro['why']}") + (" replayed" if r.get("replayed") else ""))
runs = d["runs"]; fresh, earlier = runs[-n:], runs[:-n]
this = "PASS" if any(r["rollout"]["pass"] for r in fresh) else "FAIL"
print(sys.argv[2], this, "| stands" if d["rollout"]["pass"] else "| does not stand", "|", "; ".join(line(r) for r in fresh),
      ("| earlier: " + "; ".join(("(old code) " if r.get("oldCode") else "") + f"{r.get('enemyKillsPerBotMinute')}/{r.get('capturesTotal')}" for r in earlier)) if earlier else "")
PY
done
