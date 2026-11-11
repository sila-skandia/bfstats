#!/bin/bash
# Accept levels under the owner's rollout, stage their layers and publish them WITHOUT menu flags.
#   rollout.sh <batch name> <mod folder>:<level>[,<level>...] [<mod folder>:...]
# Prints, per mod, the "<PageName>:<level>" pairs pagebatch.sh takes. The menu files are held back in
# $BOT_WORK/publish/<batch>.menu until menus.sh publishes them. Rollback copies of every live file the
# publish replaces are kept in $BOT_WORK/publish/<batch>.rollback.
. "$(dirname "$0")/env.sh"
batch=$1; shift; [ -n "$batch" ] && [ $# -gt 0 ] || { echo "rollout.sh <batch> <mod>:<levels> ..."; exit 2; }
REASON=${REASON:-"Owner's rollout, 2026-11-11: after playing Tunis-1943 against its generated bots the owner asked for every level with a fight to go live. Two or more seeds at 8 and 16 a side, the garrison; the checks it fails are listed with this verdict, and a match on the page decides whether it keeps its menu flag."}
root=$BOT_WORK/publish/$batch
rm -rf "$root" "$root.menu" "$root.rollback" "$root.menuroot"; mkdir -p "$root"; : > "$root.calls"
cd "$TOOLS" || exit 1
for spec in "$@"; do
  folder=${spec%%:*}; levels=${spec##*:}; mod_of "$folder" || exit 2
  for l in ${levels//,/ }; do
    python3 -c "import json,sys; v=json.load(open('bot-layers/$LAYERS/$l/verdict.json')); sys.exit(0 if v.get('accepted') or v.get('verdict')=='pass' else 1)" \
      || node sim/botbatch.mjs accept --levels "$l" --mod "$MOD" --owner --reason "$REASON" 2>&1 | tail -1 | cut -c1-90
  done
  python3 publish_bot_layers.py --root "$root" --game-dir "$GAME" --mod "$MOD" --levels "$levels" 2>&1 | grep -E "staged|rror|efus|closed" | cut -c1-70
  curl -s "$SITE/$TREE/maps.json?cb=$RANDOM" | python3 -c "
import json,sys
d=json.load(sys.stdin); rows=d if isinstance(d,list) else d.get('maps') or d.get('levels')
names={str(r['report']).split('/')[0].lower(): r.get('name') for r in rows if r.get('report')}
want='$levels'.split(',')
print('$folder', ' '.join(f'{names[l]}:{l}' for l in want if l in names))
miss=[l for l in want if l not in names]
if miss: print('NOT IN maps.json:', miss, file=sys.stderr)" >> "$root.calls"
done
cd "$REPO" || exit 1
( cd "$root" && find maps -type f ) | while read -r f; do
  mkdir -p "$root.rollback/$(dirname "$f")"
  curl -s -f -o "$root.rollback/$f" "$SITE/$f?cb=$RANDOM" || true
done
( cd "$root" && find maps -name menu-levels.json ) | while read -r m; do mkdir -p "$root.menu/$(dirname "$m")"; mv "$root/$m" "$root.menu/$m"; done
python3 scripts/publish-mesh-delta.py maps --hash --hash-remote --list --root "$root" --hash-manifest "$root/hashes-maps.json" 2>&1 | tail -2
echo "== page calls (pagebatch.sh <mod folder> <PageName>:<level> ...)"; cat "$root.calls"
