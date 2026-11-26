#!/usr/bin/env bash
# Install the Replay Shorts nightly on this machine (macOS launchd or Linux
# systemd user timer). Idempotent: run it again to re-render and reload.
#
#   deploy/shorts-nightly/install.sh [--dry-run] [checkout-dir]
#
# checkout-dir is the nightly's own checkout, a detached git worktree of this
# repo at origin/main (default: bfstats-nightly beside this checkout). It is
# made if missing, and given this checkout's ui/node_modules.
# --dry-run prints the rendered units and changes nothing.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
DRY=0
[[ ${1:-} == --dry-run ]] && { DRY=1; shift; }
CHECKOUT=${1:-$(dirname "$REPO")/bfstats-nightly}

render() { sed -e "s#__CHECKOUT__#$CHECKOUT#g" -e "s#__HOME__#$HOME#g" "$1"; }

if [[ $DRY == 1 ]]; then
  echo "checkout: $CHECKOUT"
  if [[ $(uname) == Darwin ]]; then render "$HERE/io.bfstats.shorts.plist"
  else render "$HERE/bfstats-shorts.service"; cat "$HERE/bfstats-shorts.timer"; fi
  exit 0
fi

if [[ ! -e $CHECKOUT ]]; then
  git -C "$REPO" fetch -q origin main
  git -C "$REPO" worktree add --detach "$CHECKOUT" origin/main
fi
CHECKOUT=$(cd "$CHECKOUT" && pwd)
if [[ ! -e $CHECKOUT/ui/node_modules && -d $REPO/ui/node_modules ]]; then
  ln -s "$REPO/ui/node_modules" "$CHECKOUT/ui/node_modules"
fi
mkdir -p "$HOME/.cache/bfstats-shorts"
[[ -s $HOME/.config/bfstats/shorts-upload-key ]] \
  || echo "note: no upload key at ~/.config/bfstats/shorts-upload-key; the nightly will do nothing until there is one"

if [[ $(uname) == Darwin ]]; then
  DEST=$HOME/Library/LaunchAgents/io.bfstats.shorts.plist
  mkdir -p "$(dirname "$DEST")"
  render "$HERE/io.bfstats.shorts.plist" > "$DEST"
  launchctl bootout "gui/$(id -u)/io.bfstats.shorts" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$DEST"
  echo "installed $DEST, running from $CHECKOUT at 03:30"
else
  DEST=$HOME/.config/systemd/user
  mkdir -p "$DEST"
  render "$HERE/bfstats-shorts.service" > "$DEST/bfstats-shorts.service"
  cp "$HERE/bfstats-shorts.timer" "$DEST/bfstats-shorts.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now bfstats-shorts.timer
  echo "installed bfstats-shorts.timer, running from $CHECKOUT at 03:30"
fi
