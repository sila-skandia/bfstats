#!/bin/bash
# Publish the menu flags as the gate now has them: every accepted layer of each mod gets its
# `generatedBots` flag (bots in the level list, with the site's mark), every withdrawn one loses it.   menus.sh <batch name> <mod folder> [<mod folder> ...]
# Run it after pagebatch.sh and withdraw.py, so only levels that passed are still accepted.
. "$(dirname "$0")/env.sh"
batch=$1; shift; [ -n "$batch" ] && [ $# -gt 0 ] || { echo "menus.sh <batch> <mod folder> ..."; exit 2; }
root=$BOT_WORK/publish/$batch-menus; rm -rf "$root" "$root.only"; mkdir -p "$root" "$root.only"
cd "$TOOLS" || exit 1
for folder in "$@"; do
  mod_of "$folder" || exit 2
  any=$(ls -d bot-layers/$LAYERS/*/ 2>/dev/null | head -1 | xargs basename)
  python3 publish_bot_layers.py --root "$root" --game-dir "$GAME" --mod "$MOD" --levels "$any" 2>&1 | grep -E "menu rows|rror"
done
( cd "$root" && find maps -name menu-levels.json ) | while read -r m; do mkdir -p "$root.only/$(dirname "$m")"; cp "$root/$m" "$root.only/$m"; done
cd "$REPO" && python3 scripts/publish-mesh-delta.py maps --hash --hash-remote --list --root "$root.only" --hash-manifest "$root.only/hashes-maps.json" 2>&1 | tail -2
python3 "$SKILL/live.py"
