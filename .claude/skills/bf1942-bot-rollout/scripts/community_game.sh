#!/bin/bash
# The game folder the community map pack's levels are read from: the install's bf1942 mod, linked,
# with every archive of community-mappack-by-michaels/ linked into its levels folder.
. "$(dirname "$0")/env.sh"
src="$BF1942_GAME/Mods/bf1942"; dst="$BOT_WORK/game-community/Mods/bf1942"
[ -d "$src/Archives" ] || { echo "no install at $BF1942_GAME (set BF1942_GAME)"; exit 1; }
mkdir -p "$dst/Archives/bf1942/levels"
for f in "$src"/*; do [ "$(basename "$f")" = Archives ] || ln -sfn "$f" "$dst/"; done
for f in "$src/Archives"/*; do [ "$(basename "$f")" = bf1942 ] || ln -sfn "$f" "$dst/Archives/"; done
for f in "$src/Archives/bf1942"/*; do [ "$(basename "$f")" = levels ] || ln -sfn "$f" "$dst/Archives/bf1942/"; done
for f in "$src/Archives/bf1942/levels"/* "$REPO/community-mappack-by-michaels"/*.[rR][fF][aA]; do ln -sfn "$f" "$dst/Archives/bf1942/levels/"; done
echo "$BOT_WORK/game-community: $(ls "$dst/Archives/bf1942/levels" | wc -l | tr -d ' ') level archives"
