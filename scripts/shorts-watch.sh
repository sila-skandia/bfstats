#!/usr/bin/env bash
# Watches a Shorts run (scripts/shorts-runner.mjs) and says when it needs a hand
# (.claude/skills/replay-shorts, "Guards"). Meant for a Monitor: each line it
# prints is an event.
#
#   scripts/shorts-watch.sh <log> <pid file> [stall seconds, default 360]
#
# - Passes on the lines worth knowing: a recording started, a Short filmed or
#   uploaded, a recording abandoned, an error.
# - STALLED when the runner's heartbeat shows no new frame for the stall time
#   while it is filming (its own guards should have abandoned the recording
#   by then).
# - FROZEN, and kills it, when there has been no heartbeat at all for 2 min
#   (the runner logs one every 30 s while it is alive).
# - ENDED when the process is gone, with the log's last lines.
set -u
log=$1
pidfile=$2
stall=${3:-360}
for _ in $(seq 1 60); do [[ -s $pidfile ]] && break; sleep 2; done
pid=$(cat "$pidfile" 2>/dev/null || true)
if [[ -z $pid ]]; then
  echo "ENDED: no pid file at $pidfile"
  exit 0
fi
echo "watching runner $pid"
seen=$(wc -l < "$log" 2>/dev/null || echo 0)
last_frames=-1
frames_since=$(date +%s)
warned=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 20
  now=$(date +%s)
  total=$(wc -l < "$log")
  if (( total > seen )); then
    sed -n "$((seen + 1)),${total}p" "$log" | grep -E --line-buffered 'candidates|filmed|uploaded|abandoned|took down|replaced|rror|stopped' || true
    seen=$total
  fi
  beat=$(grep 'heartbeat:' "$log" | tail -1)
  age=$(( now - $(stat -c %Y "$log") ))
  if (( age > 120 )); then
    echo "FROZEN: no heartbeat for ${age}s; killing $pid. Last: $(tail -1 "$log")"
    kill -TERM "$pid" 2>/dev/null
    sleep 5
    kill -KILL "$pid" 2>/dev/null
    break
  fi
  frames=$(sed -n 's/.*, \([0-9]*\) frames written.*/\1/p' <<< "$beat")
  if [[ -n $frames ]]; then
    if (( frames != last_frames )); then
      last_frames=$frames
      frames_since=$now
      warned=0
    elif [[ $beat == *filming* ]] && (( now - frames_since > stall )) && (( warned == 0 )); then
      echo "STALLED: no new frame for $(( now - frames_since ))s while ${beat#*heartbeat: }"
      warned=1
    fi
  fi
done
echo "ENDED: $(tail -3 "$log" | tr '\n' ' ')"
