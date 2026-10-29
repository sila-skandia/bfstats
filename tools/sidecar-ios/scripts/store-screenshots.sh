#!/usr/bin/env bash
# App Store screenshots of the iPhone app's screens (CI: .github/workflows/sidecar-ios.yml).
#
#   tools/sidecar-ios/scripts/store-screenshots.sh path/to/BfstatsIO.app out-dir
#
# App Store Connect takes exact pixel sizes per display class. This boots the
# newest "iPhone N Pro Max" (6.9": 1320 x 2868, the one set the store
# requires; it scales it down for the smaller classes) and "iPhone N Pro"
# (6.3": 1206 x 2622) and shoots the server list, a server and join by address
# against the live bfstats.io list into out-dir/6.9/ and out-dir/6.3/.
#
# What makes them store-clean, unlike the smoke test's shots:
#   - the status bar is Apple's: 9:41, full Wi-Fi, a charged battery;
#   - a fresh simulator posts system banners ("Ready for Apple Intelligence")
#     over the first app it sees, so a throwaway launch takes them first;
#   - a player name is filled in, so the server screen's Join is live.
# The in-game shots are not taken here (CI never joins a game server); see
# features/sidecar-ios-app/README.md, "Store screenshots".
set -euo pipefail

APP="$1"
OUT="$2"
BUNDLE=io.bfstats.app
NAME=skandia
mkdir -p "$OUT"

# The newest iPhone whose name is exactly "iPhone <n> <suffix>".
device() {
  xcrun simctl list devices available -j | python3 -c '
import json, re, sys
suffix = sys.argv[1]
d = json.load(sys.stdin)["devices"]
best = None
for rt, devs in d.items():
    if "iOS" not in rt:
        continue
    ver = tuple(int(x) for x in rt.rsplit("iOS-", 1)[-1].split("-") if x.isdigit())
    for dev in devs:
        m = re.fullmatch(r"iPhone (\d+) " + re.escape(suffix), dev["name"])
        if m:
            key = (ver, int(m.group(1)))
            if best is None or key > best[0]:
                best = (key, dev["udid"], dev["name"], rt)
if best is None:
    sys.exit("no iPhone " + suffix)
print(best[1])
print(best[2] + " / " + best[3], file=sys.stderr)
' "$1"
}

shoot() {
  local class="$1" suffix="$2" want="$3"
  local udid dir
  udid="$(device "$suffix")"
  dir="$OUT/$class"
  mkdir -p "$dir"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  xcrun simctl install "$udid" "$APP"

  launch() { xcrun simctl launch "$udid" "$BUNDLE" -stillMotion YES -name "$NAME" "$@" >/dev/null; }
  quit() { xcrun simctl terminate "$udid" "$BUNDLE" >/dev/null 2>&1 || true; sleep 1; }
  shot() { xcrun simctl io "$udid" screenshot --type=png "$dir/$1.png" >/dev/null; }

  # The throwaway launch: the system's first-boot banners land on it.
  launch; sleep 30; quit

  launch; sleep 15; shot 1-servers; quit
  launch -smokeScreen server; sleep 15; shot 2-server; quit
  # A second, named server page for the marketing art (falls back to the first
  # populated server when it is empty).
  launch -smokeScreen server -smokeServer MoonGamers; sleep 15; shot 2b-server-moongamers; quit
  launch -smokeScreen address; sleep 6; shot 3-join-by-address; quit

  xcrun simctl shutdown "$udid" || true

  for f in "$dir"/*.png; do
    size="$(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w "x" h}')"
    if [ "$size" != "$want" ]; then
      echo "::warning::$f is $size, App Store Connect's $class class wants $want"
    fi
    echo "| $class | $(basename "$f") | $size |" >> "$OUT/sizes.md"
  done
}

echo "| class | shot | pixels |" > "$OUT/sizes.md"
echo "|---|---|---|" >> "$OUT/sizes.md"
shoot 6.9 "Pro Max" 1320x2868
shoot 6.3 "Pro" 1206x2622

{ echo "## App Store screenshots"; echo; cat "$OUT/sizes.md"; } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
