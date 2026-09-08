#!/usr/bin/env bash
# Make a freshly created worktree able to run ./scripts/verify.sh.
#
#   scripts/bootstrap-worktree.sh              # everything that is missing
#   scripts/bootstrap-worktree.sh --refresh    # also re-download the fixture
#   scripts/bootstrap-worktree.sh --no-fixture # skip the fixture (synthetic seed)
#
# A `git worktree add` gives you the source and nothing else: no node_modules,
# no signing key, no database. This does the same setup the CI review workflow
# does, so a change can be verified locally before it becomes a PR and CI is
# reproducing a run you have already seen.
#
# Idempotent — safe to re-run, and skips whatever is already in place.
#
#   per machine   ~/.cache/bfstats-e2e/{template.db,neo4j.dump,template.meta}
#                 the Playwright image, the bf1942-redis container
#   per worktree  ui/node_modules, .e2e/jwt-e2e.pem, .e2e/refresh-secret
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

E2E_CACHE="${BFSTATS_E2E_CACHE:-$HOME/.cache/bfstats-e2e}"
FIXTURE_TAG=e2e-fixture
# Read the tag out of verify.sh rather than repeating it, so a Playwright bump
# does not leave this pre-pulling the wrong image.
PLAYWRIGHT_IMAGE="$(grep -oE 'mcr\.microsoft\.com/playwright:[A-Za-z0-9._-]+' \
    "$REPO_ROOT/scripts/verify.sh" | head -1)"
PLAYWRIGHT_IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.56.1-jammy}"

REFRESH=""
WANT_FIXTURE=1
for arg in "$@"; do
    case "$arg" in
        --refresh)    REFRESH=1 ;;
        --no-fixture) WANT_FIXTURE="" ;;
        -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
        *)            echo "unknown argument: $arg" >&2; exit 1 ;;
    esac
done

step() { echo; echo "==> $*"; }
skip() { echo "    already done — $*"; }

# Provenance of the fixture in the cache: source backup, window, schema head.
show_fixture_meta() {
    if [ -f "$E2E_CACHE/template.meta" ]; then
        sed 's/^/    /' "$E2E_CACHE/template.meta"
    fi
}

missing=()
for cmd in docker sqlite3 openssl; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
if [ ${#missing[@]} -gt 0 ]; then
    echo "❌ Missing required tools: ${missing[*]}" >&2
    exit 1
fi

# ---------------------------------------------------------------- redis
# verify.sh gates on this exact container name, so start it the same way
# docker-compose.dev.yml does rather than diverging.
step "Redis"
if docker ps --format '{{.Names}}' | grep -qx bf1942-redis; then
    skip "bf1942-redis is running"
elif docker ps -a --format '{{.Names}}' | grep -qx bf1942-redis; then
    docker start bf1942-redis >/dev/null
    echo "    started the existing bf1942-redis container"
else
    docker compose -f "$REPO_ROOT/docker-compose.dev.yml" up -d redis
fi

# ------------------------------------------------------- signing material
step "E2E signing material"
# shellcheck source=e2e-secrets.sh
source "$REPO_ROOT/scripts/e2e-secrets.sh"
had_key=""
if [ -s "$REPO_ROOT/.e2e/jwt-e2e.pem" ]; then had_key=1; fi
ensure_e2e_secrets "$REPO_ROOT"
if [ -n "$had_key" ]; then skip ".e2e/jwt-e2e.pem"; fi

# ------------------------------------------------------- asset storage dirs
# verify.sh points the API's ASSETS_STORAGE_PATH at <worktree>/tournament-images,
# which is gitignored and so never exists in a fresh worktree. The API guards
# every lookup with Directory.Exists and degrades quietly, which means a missing
# tree shows up as absent map art rather than an error - the kind of difference
# between two checkouts that is worth removing rather than debugging later.
#
# Only the directories are created. The contents (map art, dossiers, HUD icons)
# are large binaries that live on the assets volume, not in git; a worktree that
# needs them can copy them from the main checkout, and the bf1942-map-images
# skill regenerates them from a game install.
step "Asset storage directories"
created_assets=()
for d in tournaments maps dossiers hud; do
    if [ ! -d "$REPO_ROOT/tournament-images/$d" ]; then
        mkdir -p "$REPO_ROOT/tournament-images/$d"
        created_assets+=("$d")
    fi
done
if [ ${#created_assets[@]} -gt 0 ]; then
    printf '    created tournament-images/{%s}\n' \
        "$(IFS=,; echo "${created_assets[*]}")"
    echo "    (empty — copy map art from another checkout if a spec needs it)"
else
    skip "tournament-images/"
fi

# ------------------------------------------------------------ node_modules
step "UI dependencies"
if [ -d "$REPO_ROOT/ui/node_modules" ] && [ -z "$REFRESH" ]; then
    skip "ui/node_modules"
else
    (cd "$REPO_ROOT/ui" && npm ci)
fi

# ------------------------------------------------------------ real fixture
# Shared per machine, so a second worktree on the same box costs nothing. The
# release is a storage tag carrying no code (scripts/publish-e2e-fixture.sh).
step "Real-data fixture"
if [ -z "$WANT_FIXTURE" ]; then
    echo "    skipped (--no-fixture) — runs will use the synthetic 7-player seed"
elif [ -f "$E2E_CACHE/template.db" ] && [ -z "$REFRESH" ]; then
    skip "$E2E_CACHE/template.db ($(du -h "$E2E_CACHE/template.db" | awk '{print $1}'))"
    show_fixture_meta
elif ! command -v gh >/dev/null 2>&1 || ! command -v zstd >/dev/null 2>&1; then
    echo "⚠️  gh and zstd are needed to download the fixture; runs will fall back"
    echo "    to the synthetic 7-player seed. Install them and re-run, or pass"
    echo "    --no-fixture to make that explicit."
elif ! gh auth status >/dev/null 2>&1; then
    echo "⚠️  gh is not authenticated (\`gh auth login\`); falling back to the"
    echo "    synthetic 7-player seed."
else
    mkdir -p "$E2E_CACHE"
    echo "    downloading the $FIXTURE_TAG release assets (~60 MB compressed)"
    # A missing release is a degradation, not a failure - the suite still runs
    # against the synthetic seed, which is what it did before the fixture existed.
    if gh release download "$FIXTURE_TAG" --dir "$E2E_CACHE" --clobber; then
        # --rm so a later run cannot decompress a stale .zst over a good template.
        for z in "$E2E_CACHE"/*.zst; do
            [ -e "$z" ] || continue
            zstd -d -f -q --rm "$z"
        done
        ls -lh "$E2E_CACHE" | sed 's/^/    /'
        show_fixture_meta
    else
        echo "⚠️  Could not download the $FIXTURE_TAG release; falling back to the"
        echo "    synthetic 7-player seed."
    fi
fi

# -------------------------------------------------------- playwright image
step "Playwright image"
if docker image inspect "$PLAYWRIGHT_IMAGE" >/dev/null 2>&1 && [ -z "$REFRESH" ]; then
    skip "$PLAYWRIGHT_IMAGE"
else
    echo "    pulling $PLAYWRIGHT_IMAGE (~2 GB, once per machine)"
    docker pull "$PLAYWRIGHT_IMAGE"
fi

# ------------------------------------------------------------------ slot
step "Isolation slot for this worktree"
"$REPO_ROOT/scripts/e2e-env.sh" --print | sed 's/^/    /'

echo
echo "Ready. Verify this worktree with:"
echo "    ./scripts/verify.sh              # unit tests + full E2E suite"
echo "    ./scripts/verify.sh --skip-e2e   # unit tests only"
