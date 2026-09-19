#!/usr/bin/env bash
# Point a fresh worktree's viewer at the main checkout's extracted assets.
#
#   tools/bf1942-models/link_viewer_assets.sh            # from inside a worktree
#   tools/bf1942-models/link_viewer_assets.sh /path/to/worktree
#
# `viewer/maps` (15 GB) and most of `viewer/models` are gitignored and live in
# the main checkout only, so a worktree's viewer has nothing to load. `maps` is
# wholly ignored and is linked as one directory. `models` is not: four
# first-person fixtures under `models/viewmodels/` are tracked, so replacing the
# directory with a symlink makes git report them deleted. Entries are linked one
# by one around whatever the worktree already has.
#
# The links are read-only in spirit: never run an extractor with `--out`
# pointing through them. Extract into your own scratch directory instead.
set -euo pipefail

MAIN=/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer
WORKTREE=${1:-$(git rev-parse --show-toplevel)}
VIEWER="$WORKTREE/tools/bf1942-models/viewer"

if [ "$(realpath "$VIEWER")" = "$(realpath "$MAIN")" ]; then
  echo "this is the main checkout; nothing to link" >&2
  exit 0
fi

if [ ! -e "$VIEWER/maps" ]; then
  ln -s "$MAIN/maps" "$VIEWER/maps"
  echo "linked maps"
fi

link_entries() {
  local from=$1 to=$2 linked=0
  mkdir -p "$to"
  shopt -s nullglob dotglob
  for entry in "$from"/*; do
    local name
    name=$(basename "$entry")
    [ -e "$to/$name" ] || [ -L "$to/$name" ] && continue
    ln -s "$entry" "$to/$name"
    linked=$((linked + 1))
  done
  echo "linked $linked entries into ${to#"$WORKTREE"/}"
}

link_entries "$MAIN/models" "$VIEWER/models"
# `viewmodels` exists in the worktree already (the tracked fixtures), so the
# pass above skipped it; fill in the untracked rigs beside them.
link_entries "$MAIN/models/viewmodels" "$VIEWER/models/viewmodels"

git -C "$WORKTREE" status --short -- tools/bf1942-models/viewer | grep -v '^??' \
  && { echo "tracked viewer files changed; undo before committing" >&2; exit 1; } \
  || echo "git status clean under viewer/"
