#!/usr/bin/env bash
# The iPhone app's simulator smoke test (CI: .github/workflows/sidecar-ios.yml).
#
#   tools/sidecar-ios/scripts/simulator-smoke.sh path/to/BfstatsIO.app out-dir
#
# Boots an iPhone simulator, installs the app and:
#   1. screenshots the server list, a server and join by address against the
#      live bfstats.io list (read only);
#   2. starts a stand-in server on 127.0.0.1 (scripts/stand-in-server.mjs: it
#      answers the GameSpy query and accepts the connect; CI never joins a real
#      game server) and, once per page socket (direct, bridge, auto), launches
#      the app to join it: the Kotlin sidecar starts, the real play.bfstats.io
#      page opens in the WKWebView, and the app writes what the page's socket
#      did to Documents/smoke-<socket>.json, which this copies out with a
#      screenshot of the game.
# Writes out-dir/summary.md (also to the job summary) and fails unless the
# auto socket opened and carried the sidecar's first frames.
set -euo pipefail

APP="$1"
OUT="$2"
BUNDLE=io.bfstats.app
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=14600
mkdir -p "$OUT"

# The newest iPhone the runner has.
UDID="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
d = json.load(sys.stdin)["devices"]
best = None
for rt, devs in d.items():
    if "iOS" not in rt:
        continue
    ver = tuple(int(x) for x in rt.rsplit("iOS-", 1)[-1].split("-") if x.isdigit())
    for dev in devs:
        if dev["name"].startswith("iPhone") and "SE" not in dev["name"]:
            key = (ver, "Pro" in dev["name"], dev["name"])
            if best is None or key > best[0]:
                best = (key, dev["udid"], dev["name"], rt)
print(best[1])
print(best[2] + " / " + best[3], file=sys.stderr)
')"
echo "simulator: $UDID"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"

shot() { xcrun simctl io "$UDID" screenshot --type=png "$OUT/$1.png" >/dev/null 2>&1 || echo "(no screenshot $1)"; }
launch() { xcrun simctl launch "$UDID" "$BUNDLE" -stillMotion YES "$@" >/dev/null; }
quit() { xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true; sleep 1; }
docs() { echo "$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)/Documents"; }

# ---- 1. the screens ------------------------------------------------------------
launch; sleep 15; shot 1-servers; quit
launch -smokeScreen server; sleep 15; shot 2-server; quit
launch -smokeScreen address; sleep 6; shot 3-join-by-address; quit

# ---- 2. the join and the page socket --------------------------------------------
node "$HERE/stand-in-server.mjs" --port "$PORT" --status "$OUT/stand-in.json" > "$OUT/stand-in.log" 2>&1 &
STAND_IN=$!
trap 'kill $STAND_IN 2>/dev/null || true' EXIT
sleep 1

for MODE in direct bridge auto; do
  rm -f "$(docs)/smoke-$MODE.json"
  launch -smokeJoin "127.0.0.1:$PORT" -smokeSocket "$MODE"
  for _ in $(seq 1 90); do
    [ -f "$(docs)/smoke-$MODE.json" ] && break
    sleep 1
  done
  sleep 2
  shot "4-play-$MODE"
  cp "$(docs)/smoke-$MODE.json" "$OUT/" 2>/dev/null || echo "{\"socket\":\"$MODE\",\"why\":\"no report\"}" > "$OUT/smoke-$MODE.json"
  quit
done
kill "$STAND_IN" 2>/dev/null || true
sleep 1

xcrun simctl spawn "$UDID" log show --last 15m --style compact \
  --predicate 'process == "BfstatsIO" AND (eventMessage CONTAINS "sidecar" OR eventMessage CONTAINS "bridge" OR eventMessage CONTAINS "page" OR eventMessage CONTAINS "smoke")' \
  > "$OUT/app.log" 2>&1 || true

python3 - "$OUT" <<'PY'
import json, os, sys
out = sys.argv[1]
rows = []
ok = False
for mode in ("direct", "bridge", "auto"):
    try:
        r = json.load(open(os.path.join(out, f"smoke-{mode}.json")))
    except Exception as e:
        r = {"why": f"unreadable: {e}"}
    ev = r.get("events", [])
    why = next((f'{e["kind"]}: {e["detail"]}' for e in ev if e["kind"].startswith("direct-")), "")
    rows.append(f'| {mode} | {r.get("transport", "none")} | {"yes" if r.get("opened") else "no"} | {"yes" if r.get("firstMessage") else "no"} | {why} |')
    if mode == "auto":
        ok = bool(r.get("opened") and r.get("firstMessage"))
try:
    st = json.load(open(os.path.join(out, "stand-in.json")))
except Exception:
    st = {}
lines = [
    "## iPhone simulator smoke test",
    "",
    "The real play.bfstats.io page in the app's WKWebView, joined through the Kotlin sidecar to a stand-in server on 127.0.0.1.",
    "",
    "| page socket | used | opened | sidecar frames reached the page | why direct was left |",
    "|---|---|---|---|---|",
    *rows,
    "",
    f'Stand-in server: GameSpy queries {st.get("gamespyAsked", 0)}, ConnectRequests {st.get("connectRequests", 0)}, '
    f'acked {st.get("acked", False)}, Disconnect {st.get("disconnected", False)}.',
]
text = "\n".join(lines) + "\n"
open(os.path.join(out, "summary.md"), "w").write(text)
print(text)
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    open(summary, "a").write(text)
sys.exit(0 if ok else 1)
PY
