#!/usr/bin/env bash
#
# Populate a bfstats checkout's local assets folder with map preview images, so a fresh
# clone can serve /stats/assets/maps without anything being committed to git.
#
# Both `dotnet run` (via api/Properties/launchSettings.json) and scripts/verify.sh point
# ASSETS_STORAGE_PATH at <repo>/tournament-images, which is gitignored. Maps therefore
# belong at <repo>/tournament-images/maps.
#
#   ./hydrate_local.sh                      # extract from a local BF1942 install
#   ./hydrate_local.sh --minimaps           # include minimaps too
#   ./hydrate_local.sh --from-cluster       # download from Hetzner instead (no game needed)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="${BF1942_DIR:-$HOME/.wine/drive_c/EA Games/Battlefield 1942}"
REPO=""
FROM_CLUSTER=0
EXTRACT_ARGS=()

usage() {
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
    cat <<'EOF'

Options:
  --repo PATH          bfstats checkout to hydrate (default: the repo you are standing in)
  --game-dir PATH      BF1942 installation (default: $BF1942_DIR or the wine path)
  --from-cluster       Copy the maps tree down from the Hetzner pod instead of extracting.
                       Use this on a machine with no BF1942 install.
  --minimaps           Also fetch/extract the 512x512 minimaps
  --minimap-size PX    Downscale minimaps (256 is a good tradeoff)
  --force              Re-extract images that already exist
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo)         REPO="$2"; shift 2 ;;
        --game-dir)     GAME_DIR="$2"; shift 2 ;;
        --from-cluster) FROM_CLUSTER=1; shift ;;
        --minimaps)     EXTRACT_ARGS+=(--minimaps); shift ;;
        --minimap-size) EXTRACT_ARGS+=(--minimap-size "$2"); shift 2 ;;
        --force)        EXTRACT_ARGS+=(--force); shift ;;
        -h|--help)      usage; exit 0 ;;
        *)              echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

# Resolve the checkout. Standing inside it is the common case; --repo covers the rest.
if [[ -z "$REPO" ]]; then
    REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [[ -z "$REPO" || ! -f "$REPO/bfstats.sln" ]]; then
    echo "Not a bfstats checkout: ${REPO:-<none>}" >&2
    echo "Run this from inside the repo, or pass --repo /path/to/bfstats" >&2
    exit 1
fi

# Read the path the API actually uses rather than hardcoding it, so this keeps working if
# launchSettings.json changes. The path there is relative to the api/ working directory.
ASSETS_REL="$(python3 - "$REPO" <<'PY'
import json, sys
repo = sys.argv[1]
try:
    with open(f"{repo}/api/Properties/launchSettings.json") as fh:
        profiles = json.load(fh)["profiles"]
    for profile in profiles.values():
        path = profile.get("environmentVariables", {}).get("ASSETS_STORAGE_PATH")
        if path:
            print(path)
            break
    else:
        print("../tournament-images")
except Exception:
    print("../tournament-images")
PY
)"

ASSETS_DIR="$(cd "$REPO/api" && cd "$(dirname "$ASSETS_REL")" 2>/dev/null && pwd)/$(basename "$ASSETS_REL")" \
    || ASSETS_DIR="$REPO/tournament-images"
MAPS_DIR="$ASSETS_DIR/maps"

echo "repo:   $REPO"
echo "assets: $ASSETS_DIR  (from ASSETS_STORAGE_PATH=$ASSETS_REL)"
mkdir -p "$MAPS_DIR"

if [[ "$FROM_CLUSTER" == "1" ]]; then
    POD="$(kubectl --context hetzner -n bf42-stats get pods -l app=bf42-stats \
             -o jsonpath='{.items[0].metadata.name}')"
    echo "source: hetzner pod $POD"
    # Pull only what was asked for. Minimaps are the bulk of the transfer.
    if [[ " ${EXTRACT_ARGS[*]+${EXTRACT_ARGS[*]}} " == *" --minimaps "* ]]; then
        REMOTE_TAR=(tar cf - -C /mnt/data/assets/maps .)
    else
        REMOTE_TAR=(tar cf - --exclude='*.map.png' -C /mnt/data/assets/maps .)
    fi
    kubectl --context hetzner -n bf42-stats exec "$POD" -c nginx -- \
        "${REMOTE_TAR[@]}" | tar xf - -C "$MAPS_DIR"
else
    if [[ ! -d "$GAME_DIR/Mods" ]]; then
        echo "No BF1942 install at: $GAME_DIR" >&2
        echo "Pass --game-dir, set BF1942_DIR, or use --from-cluster to download instead." >&2
        exit 1
    fi
    echo "source: $GAME_DIR"
    # ${arr[@]+"${arr[@]}"} is the portable way to expand a possibly-empty array under
    # `set -u`. Plain ${arr[@]-} would hand argparse a stray empty argument.
    python3 "$SCRIPT_DIR/extract_map_images.py" \
        --game-dir "$GAME_DIR" --out "$MAPS_DIR" \
        ${EXTRACT_ARGS[@]+"${EXTRACT_ARGS[@]}"}
fi

THUMBS=$(find "$MAPS_DIR" -name '*.png' ! -name '*.map.png' | wc -l)
MINIS=$(find "$MAPS_DIR" -name '*.map.png' | wc -l)
echo
echo "hydrated $MAPS_DIR"
echo "  thumbnails: $THUMBS"
echo "  minimaps:   $MINIS"
echo "  manifest:   $([[ -f "$MAPS_DIR/manifest.json" ]] && echo present || echo MISSING)"
echo
echo "The API picks these up with no restart. Try:"
echo "  curl -o /dev/null -w '%{http_code}\\n' http://localhost:9222/stats/assets/maps/bf1942/wake"
