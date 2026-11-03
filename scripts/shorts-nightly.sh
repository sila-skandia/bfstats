#!/usr/bin/env bash
# Replay Shorts, nightly (features/replay-shorts, .claude/skills/replay-shorts):
# film the best kills of the newest shared recordings and upload them. Run by
# the systemd user timer bfstats-shorts.timer on this PC (deploy/shorts-nightly/).
# The API's keys skip every kill already clipped, so a recording is only filmed
# once whatever the window.
set -euo pipefail

REPO=/home/skandia/projects/skandia/bfstats
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
SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
  node scripts/shorts-runner.mjs --recordings=10 --max=3 --gpu --sound --upload --out="$OUT" \
  | { grep -v '^replay: ' || true; }

# Keep two weeks of filmed videos on disk; the API has the uploaded copies.
# The meta files stay: a meta.rejected.json keeps a turned-down kill unfilmed.
find "$OUT" -mindepth 3 -maxdepth 3 \( -name short.mp4 -o -name poster.jpg -o -name sheet.jpg \) -mtime +14 -delete 2>/dev/null || true
echo "=== $(date -Iseconds) done ==="
