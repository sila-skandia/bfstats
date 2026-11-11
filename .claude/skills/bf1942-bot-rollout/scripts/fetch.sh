#!/bin/bash
# List a mod's levels by bot support, or mirror levels for the runner.
#   fetch.sh <mod folder>                      list every level: shipped / generated / botless
#   fetch.sh <mod folder> <level>[,<level>]    mirror those levels (and the vehicles they place) locally
. "$(dirname "$0")/env.sh"; mod_of "$1" || exit 2
if [ -z "$2" ]; then python3 "$SKILL/fetch_tree.py" --tree "$TREE" --list; exit; fi
python3 "$SKILL/fetch_tree.py" --tree "$TREE" --dest "$MAPS" --levels "$2" --models "$MODELS"
