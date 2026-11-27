#!/usr/bin/env bash
# Replay Shorts, nightly (features/replay-shorts, .claude/skills/replay-shorts):
# film the best kills of the newest shared recordings and upload them, and on
# the first night of a week the week's Battlefield ASMR and match recap. Run by the systemd
# user timer bfstats-shorts.timer on Linux or the launchd agent
# io.bfstats.shorts on macOS, through deploy/shorts-nightly/run.sh, from its
# own checkout brought up to origin/main first (deploy/shorts-nightly/README.md).
# The API's keys skip every kill already clipped, so a recording is only filmed
# once whatever the window.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=$HOME/.cache/bfstats-shorts
SIGN_IN=${SHORTS_SIGN_IN:-$HOME/.config/bfstats/shorts-sign-in.json}
LOG=$OUT/nightly.log
mkdir -p "$OUT"
exec >> "$LOG" 2>&1
echo "=== $(date -Iseconds) start ==="

# Every tool below writes as the account the Shorts job signed in as
# (scripts/shorts-sign-in.mjs, once, in a browser; features/replay-shorts,
# "Signing in"). Check it first, refreshing it if it is due, so a lapsed
# sign-in stops the night here rather than after an hour of filming.
if ! (cd "$REPO" && node scripts/shorts-sign-in.mjs --status); then
  echo "no usable Shorts sign-in at $SIGN_IN; run node scripts/shorts-sign-in.mjs once. Nothing done"
  exit 1
fi

# One headless browser at a time on this machine: wait up to 30 min for another
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
node scripts/shorts-runner.mjs --recordings=10 --max=3 --gpu --sound --upload --out="$OUT" ${EXTRA[@]+"${EXTRA[@]}"} \
  | { grep --line-buffered -v '^replay: ' || true; } || echo "the nightly pass failed (exit $?)"

# Covers (features/replay-feed, "Covers nobody picked"): most recordings come
# straight from a player's game with nobody at a browser to pick a frame, and
# a link to one previews with its cover. Film a frame for the newest that have
# none; one that has a cover is never touched. RECORDING_COVERS=0 skips it.
if [[ ${RECORDING_COVERS:-1} == 1 ]]; then
  echo "--- covers ---"
  node scripts/recording-covers.mjs --recordings=12 --gpu --upload ${EXTRA[@]+"${EXTRA[@]}"} \
    | { grep --line-buffered -v '^replay: ' || true; } || echo "the covers pass failed (exit $?)"
fi

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
  node scripts/shorts-prune.mjs || echo "the prune failed (exit $?)"
fi

# Colour range (2026-11-18): every video goes out at TV range, which Reddit's
# upload needs. The runners encode it so; a player's studio share is whatever
# their browser wrote, so re-encode anything still full range.
# SHORTS_COLOUR=0 skips it.
if [[ ${SHORTS_COLOUR:-1} == 1 ]]; then
  echo "--- colour range ---"
  node scripts/shorts-colour.mjs || echo "the colour pass failed (exit $?)"
fi

# Keep two weeks of filmed videos on disk; the API has the uploaded copies.
# The meta files stay: a meta.rejected.json keeps a turned-down kill unfilmed.
find "$OUT" -mindepth 3 -maxdepth 3 \( -name short.mp4 -o -name poster.jpg -o -name sheet.jpg \) -mtime +14 -delete 2>/dev/null || true
echo "=== $(date -Iseconds) done ==="
