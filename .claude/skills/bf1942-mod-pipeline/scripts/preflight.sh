#!/usr/bin/env bash
# Pre-flight for a mod extraction run: who else is writing the tree, disk, the
# browser lock, the install, and whether the main checkout's extractor code is
# clean enough to run from. Read-only. Usage: preflight.sh <Mod|id> [levels...]
set -uo pipefail
MOD=${1:-}
[ -n "$MOD" ] || { echo "usage: preflight.sh <Mod> [Level ...]" >&2; exit 2; }
shift || true
REPO=$(git rev-parse --show-toplevel 2>/dev/null || echo /home/dylan/projects/skandia/bfstats)
MAIN=/home/dylan/projects/skandia/bfstats
TOOLS=$MAIN/tools/bf1942-models
GAME=${BF1942_GAME_DIR:-"$HOME/.wine/drive_c/EA Games/Battlefield 1942"}
ok()   { printf '  [ok]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }

echo "== other writers of the shared asset tree"
if pgrep -af 'extract_[a-z_]+\.py|audit_[a-z_]+\.(py|mjs)|shoot\.mjs|mod_pipeline\.py|extract_map\.py' | grep -v pgrep | grep -v preflight; then
  warn "extractors or audits are running; a second promote() replaces level directories under them. Wait or coordinate."
else
  ok "no extractor, audit or thumbnail run is active"
fi

echo "== headless browser lock (thumbnails and the render/behaviour gates take it)"
LOCK=/tmp/claude-1000/chromium.lock
if [ -e "$LOCK" ] && fuser "$LOCK" >/dev/null 2>&1; then
  warn "$LOCK is held by pid(s): $(fuser "$LOCK" 2>/dev/null)"
else
  ok "chromium lock is free"
fi

echo "== disk"
FREE_GB=$(df -BG --output=avail "$MAIN" | tail -1 | tr -dc 0-9)
if [ "${FREE_GB:-0}" -lt 40 ]; then warn "${FREE_GB} GB free; the guard kills a step below 15 GB and a level is 30-100 MB"; else ok "${FREE_GB} GB free"; fi

echo "== the install"
MODDIR=$(find "$GAME/Mods" -maxdepth 1 -iname "$MOD" -print -quit 2>/dev/null)
if [ -z "$MODDIR" ]; then
  # a tree id was given; map it through the pipeline's MODS
  MODDIR=$(cd "$TOOLS" && python3 -c "import mod_pipeline as M,sys;print(M.resolve_mod(sys.argv[1]).install)" "$MOD" 2>/dev/null)
  [ -n "$MODDIR" ] && MODDIR=$(find "$GAME/Mods" -maxdepth 1 -iname "$MODDIR" -print -quit)
fi
if [ -z "$MODDIR" ]; then warn "no Mods/<$MOD> folder under $GAME"; else
  ARCH=$(find "$MODDIR" -maxdepth 1 -iname archives -print -quit)
  LEVELS=$(find "$ARCH" -ipath '*/bf1942/levels/*.rfa' 2>/dev/null | wc -l)
  ok "$MODDIR: $LEVELS level archives, sound archive: $( [ -n "$(find "$ARCH" -maxdepth 1 -iname 'sound*.rfa' -print -quit)" ] && echo yes || echo NO)"
  TRUNC=$(find "$ARCH" -ipath '*/bf1942/levels/*.rfa' -printf '%s %p\n' 2>/dev/null | awk '$1 % 65536 == 0 {print $2}')
  [ -n "$TRUNC" ] && warn "truncated level archives (size a multiple of 64 KiB), they will skip:" && echo "$TRUNC" | sed 's/^/         /'
  for L in "$@"; do
    if find "$ARCH" -ipath "*/bf1942/levels/$L.rfa" -print -quit | grep -q .; then ok "level $L is in the install"; else warn "level $L: no archive of that name (names are case-insensitive here, exact in the game)"; fi
  done
fi

echo "== the code you would run"
cd "$MAIN" || exit 1
DIRTY=$(git status --short -- tools/bf1942-models | grep -v '^??' | grep -v 'viewer/models/viewmodels' )
if [ -n "$DIRTY" ]; then
  warn "the main checkout has uncommitted extractor edits (another session's); run from a detached worktree:"
  echo "$DIRTY" | sed 's/^/         /'
  echo "         git worktree add --detach ~/.cache/pipeline-wt HEAD && tools/bf1942-models/link_viewer_assets.sh ~/.cache/pipeline-wt"
else
  ok "no uncommitted extractor edits in the main checkout"
fi
git fetch -q origin 2>/dev/null
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null); AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null)
[ "${BEHIND:-0}" -gt 0 ] && warn "local main is $BEHIND commits behind origin/main (exporter fixes may be missing)" || ok "local main is not behind origin/main (ahead by ${AHEAD:-0})"

echo "== the recipe's own view"
cd "$TOOLS" && python3 mod_pipeline.py run --mod "$MOD" ${*:+--levels "$@"} --dry-run --no-gates 2>&1 | grep -E '^\[' | sed 's/^/  /'
echo
echo "Now: python3 mod_pipeline.py run --mod $MOD ${*:+--levels $*} -j 12 --no-gates   (detached, from the worktree if WARNed above)"
