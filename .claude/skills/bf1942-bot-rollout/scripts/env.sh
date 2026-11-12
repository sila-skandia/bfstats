#!/bin/bash
# Shared settings for the bot rollout scripts. Source it: . "$(dirname "$0")/env.sh"
#   BOT_WORK      scratch for level trees, staged publishes and logs (default: $TMPDIR/bf1942-bot-rollout)
#   BF1942_GAME   the installed game (default: the Wine prefix's install)
#   BF_MODELS     the local models mirror (default: serve_viewer.py's cache)
REPO=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel) || exit 1
TOOLS=$REPO/tools/bf1942-models
SKILL=$REPO/.claude/skills/bf1942-bot-rollout/scripts
BOT_WORK=${BOT_WORK:-${TMPDIR:-/tmp}/bf1942-bot-rollout}
BF1942_GAME=${BF1942_GAME:-$HOME/.wine/drive_c/EA Games/Battlefield 1942}
BF_MODELS=${BF_MODELS:-$HOME/.cache/bfstats-mesh-remote/models}
SITE=https://mesh.bfstats.io
mkdir -p "$BOT_WORK/trees" "$BOT_WORK/publish" "$BOT_WORK/page" "$BOT_WORK/runs"

# mod_of <layer folder>: sets MOD (the game's mod folder name), TREE (the published path under mesh),
# MAPS (the local level tree), MODELS, GAME (the --game-dir) and PAGEMOD (the page's ?mod=, "-" for none).
# "community" is the community map pack: its levels live in the vanilla tree and its layers under bot-layers/bf1942.
mod_of() {
  case "$1" in
    bf1942)       MOD=bf1942; LAYERS=bf1942; TREE=maps; MAPS=$BOT_WORK/trees/bf1942; MODELS=$BF_MODELS; GAME=$BF1942_GAME; PAGEMOD=- ;;
    community)    MOD=bf1942; LAYERS=bf1942; TREE=maps; MAPS=$BOT_WORK/trees/bf1942; MODELS=$BF_MODELS; GAME=$BOT_WORK/game-community; PAGEMOD=community ;;
    xpack1)       MOD=XPack1; LAYERS=xpack1; TREE=maps/mods/xpack1; MAPS=$BOT_WORK/trees/xpack1; MODELS=$BF_MODELS/mods/xpack1; GAME=$BF1942_GAME; PAGEMOD=xpack1 ;;
    xpack2)       MOD=XPack2; LAYERS=xpack2; TREE=maps/mods/xpack2; MAPS=$BOT_WORK/trees/xpack2; MODELS=$BF_MODELS/mods/xpack2; GAME=$BF1942_GAME; PAGEMOD=xpack2 ;;
    fhsw)         MOD=FHSW; LAYERS=fhsw; TREE=maps/mods/fhsw; MAPS=$BOT_WORK/trees/fhsw; MODELS=$BF_MODELS/mods/fhsw; GAME=$BF1942_GAME; PAGEMOD=fhsw ;;
    fhsweurope)   MOD=FHSWEurope; LAYERS=fhsweurope; TREE=maps/mods/fhsweurope; MAPS=$BOT_WORK/trees/fhsweurope; MODELS=$BF_MODELS/mods/fhsweurope; GAME=$BF1942_GAME; PAGEMOD=fhsweurope ;;
    fh)           MOD=FH; LAYERS=fh; TREE=maps/mods/fh; MAPS=$BOT_WORK/trees/fh; MODELS=$BF_MODELS/mods/fh; GAME=$BF1942_GAME; PAGEMOD=fh ;;
    desertcombat) MOD=DesertCombat; LAYERS=desertcombat; TREE=maps/mods/desertcombat; MAPS=$BOT_WORK/trees/desertcombat; MODELS=$BF_MODELS/mods/desertcombat; GAME=$BF1942_GAME; PAGEMOD=desertcombat ;;
    bf1918)       MOD=bf1918; LAYERS=bf1918; TREE=maps/mods/bf1918; MAPS=$BOT_WORK/trees/bf1918; MODELS=$BF_MODELS/mods/bf1918; GAME=$BF1942_GAME; PAGEMOD=bf1918 ;;
    eod)          MOD=EoD; LAYERS=eod; TREE=maps/mods/eod; MAPS=$BOT_WORK/trees/eod; MODELS=$BF_MODELS/mods/eod; GAME=$BF1942_GAME; PAGEMOD=eod ;;
    gcmod)        MOD=GCMOD; LAYERS=gcmod; TREE=maps/mods/gcmod; MAPS=$BOT_WORK/trees/gcmod; MODELS=$BF_MODELS/mods/gcmod; GAME=$BF1942_GAME; PAGEMOD=gcmod ;;
    *) echo "unknown mod folder: $1 (bf1942 community xpack1 xpack2 fhsw fhsweurope fh desertcombat bf1918 eod gcmod)" >&2; return 1 ;;
  esac
}
