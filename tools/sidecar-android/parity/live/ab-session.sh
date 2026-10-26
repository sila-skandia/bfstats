#!/usr/bin/env bash
# One scripted page session against one sidecar on the lab, for the Node vs
# Kotlin live A/B (features/sidecar-android-app/parity-audit.md): start the
# sidecar, play the real map.html headless through it (page-proof.cjs: join,
# remotes, deploy, walk), board a Sherman (lab/seat_aim_probe.cjs), chat and
# radio (page-script.mjs), then Ctrl-C it. Run with the lab up and the viewer
# served (python3 serve_viewer.py 5511 in the main checkout).
#
#   parity/live/ab-session.sh node <outdir>
#   parity/live/ab-session.sh /path/to/sidecar.kexe <outdir>
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
MODELS=$(cd "$HERE/../../../bf1942-models" && pwd)
MAIN_MODELS=${MAIN_MODELS:-/home/dylan/projects/skandia/bfstats/tools/bf1942-models}
PW=${PLAYWRIGHT:-/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright}
LOCK=/tmp/claude-1000/bfstats-headless.lock
which=$1; out=$2
mkdir -p "$out"
args=(127.0.0.1:14568 --name skandia-sc --team 2 --ws 17995 --out "$out/run.ndjson" --review "$out/run.review.ndjson")
if [ "$which" = node ]; then
  node "$MODELS/sidecar/sidecar.mjs" "${args[@]}" > "$out/sidecar.log" 2>&1 &
else
  "$which" "${args[@]}" > "$out/sidecar.log" 2>&1 &
fi
pid=$!
for i in $(seq 1 60); do grep -q "joined as player" "$out/sidecar.log" && break; sleep 1; done
echo "joined after ${i}s"
VPORT=5511 WS=17995 TEAM=2 WALK_S=15 WATCH_S=10 PLAYWRIGHT=$PW timeout 400 flock "$LOCK" node "$HERE/page-proof.cjs" "$out/page-proof.json" > "$out/page-proof.log" 2>&1
# Back to the deploy screen first, so the boarding starts from a fresh spawn.
echo '[{"t":0.2,"open":true},{"t":0.5,"text":{"type":"suicide"}},{"t":1,"close":true}]' > "$out/suicide.json"
node "$HERE/page-script.mjs" 17995 "$out/suicide.json" > /dev/null 2>&1
sleep 2
VPORT=5511 WS=17995 SECS=15 PLAYWRIGHT=$PW timeout 400 flock "$LOCK" node "$MAIN_MODELS/lab/seat_aim_probe.cjs" "$out/seat-aim.json" > "$out/seat-aim.log" 2>&1
cat > "$out/chat.json" <<'EOF'
[{"t":0.2,"open":true},{"t":0.5,"text":{"type":"chat","text":"ab check","team":false}},{"t":1,"text":{"type":"radio","msg":3,"team":true}},{"t":2,"close":true}]
EOF
node "$HERE/page-script.mjs" 17995 "$out/chat.json" > /dev/null 2>&1
sleep 1
kill -INT $pid
wait $pid
echo "exit $?" >> "$out/sidecar.log"
