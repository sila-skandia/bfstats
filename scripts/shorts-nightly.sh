#!/usr/bin/env bash
# Replay Shorts, nightly (features/replay-shorts, .claude/skills/replay-shorts):
# film the best kills of the newest shared recordings and upload them, and on
# the first night of a week the week's Battlefield ASMR and action roll. Run by the systemd
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
# Paused (2026-11-08): the owner turned the first arsenal down ("nah I don't
# like it"), so no week's ASMR is made until the owner picks its next form.
# ASMR_WEEKLY=1 runs it anyway.
WEEK=$(date +%G-W%V)
STAMP=$OUT/asmr-$WEEK.done
if [[ ${ASMR_WEEKLY:-0} == 1 && ! -e $STAMP ]]; then
  echo "--- the week's ASMR ($WEEK) ---"
  ASMR_LOG=$OUT/asmr-$WEEK.log
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
    node scripts/shorts-runner.mjs --asmr-mix=week --recordings=10 --gpu --sound --upload --out="$OUT" ${EXTRA[@]+"${EXTRA[@]}"} \
    2>&1 | { grep --line-buffered -v '^replay: ' || true; } | tee "$ASMR_LOG" || true
  if grep -q 'uploaded .*Battlefield ASMR' "$ASMR_LOG"; then touch "$STAMP"; fi
fi

# The week's action roll (the owner, 2026-11-12: "for the recurring job to
# film these, we only need them once a week"), on the first night of each ISO
# week: one 90 s roll, 4K and HD with its link copy, of the week's busiest
# round with no roll yet (scripts/roll-weekly.mjs). A stamp marks the week
# done once it is uploaded; a night that uploads nothing tries again.
# ROLL_WEEKLY=0 skips it.
ROLL_STAMP=$OUT/roll-$WEEK.done
if [[ ${ROLL_WEEKLY:-1} == 1 && ! -e $ROLL_STAMP ]]; then
  echo "--- the week's roll ($WEEK) ---"
  ROLL_LOG=$OUT/roll-$WEEK.log
  ROLL_EXTRA=()
  [[ $(uname) == Darwin ]] && ROLL_EXTRA=(--channel=chrome)
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
    node scripts/roll-weekly.mjs ${ROLL_EXTRA[@]+"${ROLL_EXTRA[@]}"} 2>&1 | tee "$ROLL_LOG" || true
  if grep -q "the week's rolls: [1-9]" "$ROLL_LOG"; then touch "$ROLL_STAMP"; fi
  # A week's take is ~600 MB on disk; the API has the uploaded copies.
  find "$HOME/.cache/bfstats-roll" -maxdepth 2 -path '*/weekly-*' -name '*.mp4' -mtime +14 -delete 2>/dev/null || true
fi

# Retention (the owner, 2026-11-12: "for any short >= week old with 0-1 views
# we get rid of", rolls too; "do the pruning via a re-usable job, it can sit
# in the short scheduled job"): after tonight's uploads, every Short and roll
# 7 days old or more with 0 or 1 views goes, a player's own share excepted.
# SHORTS_PRUNE=0 skips it.
if [[ ${SHORTS_PRUNE:-1} == 1 ]]; then
  echo "--- retention ---"
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") node scripts/shorts-prune.mjs || echo "the prune failed (exit $?)"
fi

# Keep two weeks of filmed videos on disk; the API has the uploaded copies.
# The meta files stay: a meta.rejected.json keeps a turned-down kill unfilmed.
find "$OUT" -mindepth 3 -maxdepth 3 \( -name short.mp4 -o -name poster.jpg -o -name sheet.jpg \) -mtime +14 -delete 2>/dev/null || true
echo "=== $(date -Iseconds) done ==="
