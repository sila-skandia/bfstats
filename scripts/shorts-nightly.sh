#!/usr/bin/env bash
# Replay Shorts, nightly (features/replay-shorts, .claude/skills/replay-shorts):
# film the best kills of the newest shared recordings and upload them, and on
# the first night of a week the week's Battlefield ASMR and match recap. Run by the systemd
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

# The week's match recap (features/match-recap; the owner, 2026-11-15: the
# rolls are "a bit too extreme in their panning for regular players ...
# perhaps we pivot to generating match recaps"), on the first night of each
# ISO week: the week's busiest round with no recap yet, its key moments the
# recorder saw well faded one into the next, then its salt, 4K and HD with its
# link copy (scripts/roll-weekly.mjs --recap). A round with too few moments
# moves on to the next. A stamp marks the week done once one is uploaded; a
# night that uploads nothing tries again. RECAP_WEEKLY=0 skips it.
RECAP_STAMP=$OUT/recap-$WEEK.done
if [[ ${RECAP_WEEKLY:-1} == 1 && ! -e $RECAP_STAMP ]]; then
  echo "--- the week's recap ($WEEK) ---"
  RECAP_LOG=$OUT/recap-$WEEK.log
  RECAP_EXTRA=()
  [[ $(uname) == Darwin ]] && RECAP_EXTRA=(--channel=chrome)
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
    node scripts/roll-weekly.mjs --recap ${RECAP_EXTRA[@]+"${RECAP_EXTRA[@]}"} 2>&1 | tee "$RECAP_LOG" || true
  if grep -q "the week's recaps: [1-9]" "$RECAP_LOG"; then touch "$RECAP_STAMP"; fi
  # A week's take is ~700 MB on disk; the API has the uploaded copies.
  find "$HOME/.cache/bfstats-recap" -maxdepth 2 -path '*/weekly-*' -name '*.mp4' -mtime +14 -delete 2>/dev/null || true
fi

# The week's action roll, kept in the arsenal but no longer weekly (the owner,
# 2026-11-15: the recaps replace it; the rolls already live stay live).
# ROLL_WEEKLY=1 films one as before (scripts/roll-weekly.mjs).
ROLL_STAMP=$OUT/roll-$WEEK.done
if [[ ${ROLL_WEEKLY:-0} == 1 && ! -e $ROLL_STAMP ]]; then
  echo "--- the week's roll ($WEEK) ---"
  ROLL_LOG=$OUT/roll-$WEEK.log
  ROLL_EXTRA=()
  [[ $(uname) == Darwin ]] && ROLL_EXTRA=(--channel=chrome)
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") \
    node scripts/roll-weekly.mjs ${ROLL_EXTRA[@]+"${ROLL_EXTRA[@]}"} 2>&1 | tee "$ROLL_LOG" || true
  if grep -q "the week's rolls: [1-9]" "$ROLL_LOG"; then touch "$ROLL_STAMP"; fi
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

# Colour range (2026-11-18): every video goes out at TV range, which Reddit's
# upload needs. The runners encode it so; a player's studio share is whatever
# their browser wrote, so re-encode anything still full range.
# SHORTS_COLOUR=0 skips it.
if [[ ${SHORTS_COLOUR:-1} == 1 ]]; then
  echo "--- colour range ---"
  SHORTS_UPLOAD_KEY=$(tr -d '\n' < "$KEY_FILE") node scripts/shorts-colour.mjs || echo "the colour pass failed (exit $?)"
fi

# Keep two weeks of filmed videos on disk; the API has the uploaded copies.
# The meta files stay: a meta.rejected.json keeps a turned-down kill unfilmed.
find "$OUT" -mindepth 3 -maxdepth 3 \( -name short.mp4 -o -name poster.jpg -o -name sheet.jpg \) -mtime +14 -delete 2>/dev/null || true
echo "=== $(date -Iseconds) done ==="
