#!/usr/bin/env bash
# Replay Shorts, nightly (features/replay-shorts, .claude/skills/replay-shorts):
# film the best kills of the newest shared recordings and upload them, and on
# the first night of a week the week's Battlefield ASMR. Run by the systemd
# user timer bfstats-shorts.timer on Linux, or the launchd agent
# io.bfstats.shorts on a Mac (both in deploy/shorts-nightly/), which runs it
# from its own checkout brought up to origin/main first.
# The API's keys skip every kill already clipped, so a recording is only filmed
# once whatever the window.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=$HOME/.cache/bfstats-shorts
KEY_FILE=$HOME/.config/bfstats/shorts-upload-key
LOG=$OUT/nightly.log
mkdir -p "$OUT"
exec >> "$LOG" 2>&1
echo "=== $(date -Iseconds) start ==="

if [[ ! -s $KEY_FILE ]]; then
  echo "no upload key at $KEY_FILE; nothing done"
  exit 1
fi

# One headless browser at a time on this PC: wait up to 30 min for another
# session's to finish, then leave it for tomorrow.
for _ in $(seq 1 60); do
  if ! pgrep -f 'headless_shell|chrome.*--headless' > /dev/null; then break; fi
  sleep 30
done
if pgrep -f 'headless_shell|chrome.*--headless' > /dev/null; then
  echo "another headless browser is running; skipped tonight"
  exit 0
fi

cd "$REPO"
# A Mac has no Playwright Chromium: drive the installed Google Chrome.
EXTRA=()
[[ $(uname) == Darwin ]] && EXTRA=(--channel=chrome)
SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
  node scripts/shorts-runner.mjs --recordings=10 --max=3 --gpu --sound --upload --out="$OUT" ${EXTRA[@]+"${EXTRA[@]}"} \
  | { grep --line-buffered -v '^replay: ' || true; } || echo "the nightly pass failed (exit $?)"

# The week's Battlefield ASMR (the owner: "1 asmr clip a week"), on the first
# night of each ISO week: the arsenal, each of the week's guns alone in its
# level, its report then its rounds going past (--asmr-mix=week). A stamp marks the week
# done once it is uploaded; a night that uploads nothing tries again.
WEEK=$(date +%G-W%V)
STAMP=$OUT/asmr-$WEEK.done
if [[ ! -e $STAMP ]]; then
  echo "--- the week's ASMR ($WEEK) ---"
  ASMR_LOG=$OUT/asmr-$WEEK.log
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
    node scripts/shorts-runner.mjs --asmr-mix=week --recordings=10 --gpu --sound --upload --out="$OUT" ${EXTRA[@]+"${EXTRA[@]}"} \
    2>&1 | { grep --line-buffered -v '^replay: ' || true; } | tee "$ASMR_LOG" || true
  if grep -q 'uploaded .*Battlefield ASMR' "$ASMR_LOG"; then touch "$STAMP"; fi
fi

# Keep two weeks of filmed videos on disk; the API has the uploaded copies.
# The meta files stay: a meta.rejected.json keeps a turned-down kill unfilmed.
find "$OUT" -mindepth 3 -maxdepth 3 \( -name short.mp4 -o -name poster.jpg -o -name sheet.jpg \) -mtime +14 -delete 2>/dev/null || true
echo "=== $(date -Iseconds) done ==="
