#!/bin/bash
set -e

# Reusable Verification Script for bfstats (Containerized E2E)
# Usage:
#   ./scripts/verify.sh                    (Runs unit tests + all E2E)
#   ./scripts/verify.sh --skip-e2e         (Runs only unit tests)
#   ./scripts/verify.sh e2e/landing.spec   (Runs specific E2E test)
#   ./scripts/verify.sh --project=chromium (Pass any playwright args)
#   ./scripts/verify.sh --all              (Every suite, whatever changed)
#
# Each suite runs only when the change can reach it (changes since origin/main
# plus the working tree, untracked files included):
#   - BF1942 tool tests: the test files that reference a changed file, directly
#     or through other files (scripts/select_model_tests.py), and none when
#     nothing under them changed. A one-file viewer edit runs ~80 of ~490.
#   - API unit tests: when api/, tests/api/ or the solution's build files changed.
#   - Playwright E2E: when ui/, api/, tests/e2e/ or docker-compose.dev.yml
#     changed, or when spec arguments name what to run.
# A change to this script or the selector runs everything. So does CI (CI=true)
# and --all (VERIFY_ALL=1). See features/verify-test-selection/README.md.
#
# Env:
#   PW_ALL_BROWSERS=1  also run the suite under WebKit (~2.3x slower; off by default)
#   PW_WORKERS=8       override the worker count (default 50% of cores)
#   E2E_PREVIEW=1      test the production build rather than the dev server
#                      (~12s build + ~15s tests, vs ~20s tests on the dev
#                      server — slower, but exercises what actually ships)
#   E2E_REUSE=1        talk to whatever is already on :9222 / :5173 instead of
#                      spawning an isolated stack. Do not use across worktrees.
#   E2E_SLOT=N         force isolation slot 0-15
#   E2E_RESET_TEMPLATE=1  remigrate the slim sqlite fixture
#   E2E_SYNTHETIC=1    ignore the real-data fixture and use the 7-player seed
#   E2E_NEO4J=1        start a private Neo4j for this slot (default: off; only
#                      needed by specs that read graph-backed pages)
#   E2E_PW_NETWORK=host|tunnel|relay
#                      how the Playwright container reaches the UI (see the
#                      comment above `docker run`). Default: host on Linux,
#                      tunnel on macOS with Colima, relay on other macOS Docker.
#   PYTHON=...         the interpreter for the tool tests (default: see
#                      scripts/verify-python.sh)
#
# Runs on Linux and macOS (bash 3.2, no util-linux). See
# features/verify-on-macos/README.md.
#
# A fresh worktree needs `./scripts/bootstrap-worktree.sh` once first — it pulls
# node_modules, the real-data fixture and the Playwright image, and generates the
# throwaway JWT signing key this script hands the API.
#
# Isolation: each run binds unique API/UI ports and a throwaway sqlite copy so
# parallel worktrees do not share playertracker.db or collide on 9222/5173.
# See features/isolated-e2e-worktrees/README.md.
#
# Data: if this machine has a real-data fixture in ~/.cache/bfstats-e2e (fetch it
# with `gh release download e2e-fixture`), every run starts from a copy of it.
# Otherwise the API builds the small synthetic seed as before.
# See features/e2e-real-data-fixtures/README.md.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 0. Arguments, and what changed
SKIP_E2E=false
RUN_ALL="${VERIFY_ALL:-}"
[ "${CI:-}" = "true" ] && RUN_ALL=1
PW_ARGS=()

for arg in "$@"; do
    if [[ "$arg" == "--skip-e2e" ]]; then
        SKIP_E2E=true
    elif [[ "$arg" == "--all" ]]; then
        RUN_ALL=1
    else
        PW_ARGS+=("$arg")
    fi
done

# macOS's own python3 is 3.9, too old for the tool tests; this finds a newer one.
# shellcheck source=verify-python.sh
source "$REPO_ROOT/scripts/verify-python.sh"
PYTHON="$(verify_python)"
echo "🐍 Python: $PYTHON ($("$PYTHON" --version 2>&1))"

CHANGED=""
if [ -z "$RUN_ALL" ]; then
    CHANGED="$("$PYTHON" scripts/select_model_tests.py --changed)"
    if grep -qxE 'scripts/(verify\.sh|select_model_tests\.py)' <<<"$CHANGED"; then
        echo "🔁 verify.sh or the test selector changed: running every suite."
        RUN_ALL=1
    else
        echo "📝 $(grep -c . <<<"$CHANGED" || true) changed file(s) since origin/main (working tree included)."
    fi
fi
# Whether anything changed under one of these path prefixes (an ERE).
changed_under() { [ -n "$RUN_ALL" ] || grep -qE "^($1)" <<<"$CHANGED"; }

# 1. BF1942 tool tests: the synthetic-fixture parsers and the viewer, no
# Battlefield install needed.
if [ -n "$RUN_ALL" ]; then
    echo "Running every BF1942 tool test..."
    "$PYTHON" -m unittest discover -s tools/bf1942-models/tests -v
else
    MODEL_TESTS="$("$PYTHON" scripts/select_model_tests.py --files $CHANGED)"
    if [ "$MODEL_TESTS" = "ALL" ]; then
        echo "Running every BF1942 tool test..."
        "$PYTHON" -m unittest discover -s tools/bf1942-models/tests -v
    elif [ -z "$MODEL_TESTS" ]; then
        echo "⏭️ No BF1942 tool test reaches what changed."
    else
        echo "Running the $(grep -c . <<<"$MODEL_TESTS") BF1942 tool test file(s) the change reaches"
        echo "   (why: python3 scripts/select_model_tests.py --explain; all: --all)..."
        # From the tests folder, as discovery runs them: their helpers import from it.
        (cd tools/bf1942-models/tests && "$PYTHON" -m unittest -v $MODEL_TESTS)
    fi
fi

NEED_API=false
changed_under 'api/|tests/api/|Directory\.Build\.|bfstats\.sln|global\.json|nuget\.config' && NEED_API=true
NEED_E2E=false
if [ "$SKIP_E2E" = false ]; then
    if [ ${#PW_ARGS[@]} -gt 0 ] || changed_under 'ui/|api/|tests/e2e/|docker-compose\.dev\.yml'; then
        NEED_E2E=true
    fi
fi

if [ "$NEED_API" = false ] && [ "$NEED_E2E" = false ]; then
    echo "⏭️ Nothing under api/, ui/ or tests/ changed: no API or E2E tests to run."
    exit 0
fi

# 2. Check Infrastructure
echo "🔍 Checking infrastructure..."
if ! docker ps | grep -q "bf1942-redis"; then
    echo "❌ Redis is not running. In a fresh worktree run:"
    echo "     ./scripts/bootstrap-worktree.sh"
    echo "   or start it alone with:"
    echo "     docker compose -f docker-compose.dev.yml up -d redis"
    exit 1
fi

# 3. Run API Unit Tests
if [ "$NEED_API" = true ]; then
    echo "🧪 Running API Unit Tests..."
    dotnet test tests/api/api.tests.csproj --nologo -v m
else
    echo "⏭️ Nothing the API tests cover changed: skipping them."
fi

if [ "$SKIP_E2E" = true ]; then
    echo "⏭️ Skipping E2E tests."
    exit 0
fi
if [ "$NEED_E2E" = false ]; then
    echo "⏭️ Nothing under ui/, api/ or tests/e2e/ changed: skipping E2E."
    exit 0
fi

# If no specific tests provided, default to all
if [ ${#PW_ARGS[@]} -eq 0 ]; then
    echo "🎭 Running all Playwright E2E Tests..."
else
    echo "🎭 Running Playwright E2E with args: ${PW_ARGS[*]}"
fi

# 4. Start API and UI for E2E
API_PID=""
UI_PID=""
E2E_NEED_TEMPLATE=""
MIGRATIONS_HASH=""
E2E_FIXTURE=synthetic
NEO4J_STARTED=""
E2E_CACHE="${BFSTATS_E2E_CACHE:-$HOME/.cache/bfstats-e2e}"
NEO4J_IMAGE="${NEO4J_IMAGE:-neo4j:5.15-community}"

# Neo4j Community allows one user database per instance, so an isolated graph
# means an isolated container. It costs ~9s and ~1GB, so it is opt-in: most
# specs never load a graph-backed page, and the API treats Neo4j as optional
# (Program.cs only registers the services when Neo4j:Uri is set).
start_e2e_neo4j() {
    [ -n "${E2E_NEO4J:-}" ] || return 0

    if [ ! -f "$E2E_CACHE/neo4j.dump" ]; then
        echo "⚠️  E2E_NEO4J=1 but no graph template at $E2E_CACHE/neo4j.dump"
        echo "   Build one: scripts/make-e2e-graph.sh"
        return 1
    fi

    echo "🕸  Loading graph template into slot ${E2E_SLOT} (:${NEO4J_PORT})..."
    docker rm -f "$NEO4J_CONTAINER" >/dev/null 2>&1 || true
    docker run --rm -v "$NEO4J_DATA_DIR":/w alpine:latest rm -rf /w/data >/dev/null 2>&1 || true
    mkdir -p "$NEO4J_DATA_DIR/data"
    chmod -R 777 "$NEO4J_DATA_DIR"

    docker run --rm -v "$NEO4J_DATA_DIR/data":/data -v "$E2E_CACHE":/dumps:ro \
        "$NEO4J_IMAGE" \
        neo4j-admin database load neo4j --from-path=/dumps --overwrite-destination=true \
        >/dev/null 2>&1 || { echo "❌ neo4j-admin load failed"; return 1; }

    # Before the run, not after: a Ctrl+C while docker creates the container
    # must still have cleanup() remove it.
    NEO4J_STARTED=1
    docker run -d --name "$NEO4J_CONTAINER" -p "${NEO4J_PORT}:7687" \
        -v "$NEO4J_DATA_DIR/data":/data \
        -e NEO4J_AUTH=neo4j/bf1942stats \
        -e NEO4J_server_memory_heap_max__size=512m \
        -e NEO4J_server_memory_pagecache_size=256m \
        "$NEO4J_IMAGE" >/dev/null || return 1
    return 0
}

wait_for_e2e_neo4j() {
    [ -n "$NEO4J_STARTED" ] || return 0
    local deadline=$(( $(date +%s) + 120 ))
    until docker exec "$NEO4J_CONTAINER" \
            cypher-shell -u neo4j -p bf1942stats "RETURN 1;" >/dev/null 2>&1; do
        sleep 1
        if [ "$(date +%s)" -gt "$deadline" ]; then
            echo "❌ Slot Neo4j did not come up."
            docker logs --tail 20 "$NEO4J_CONTAINER" 2>&1 | sed 's/^/   /'
            return 1
        fi
    done
    echo "✅ Slot Neo4j ready on :${NEO4J_PORT}"
}

migrations_hash() {
    {
        find "$REPO_ROOT/api/Migrations" -name '*.cs' ! -name '*Designer.cs' -print0
        printf '%s\0' \
          "$REPO_ROOT/api/E2e/E2eDatabaseSeed.cs" \
          "$REPO_ROOT/api/PlayerTracking/PlayerTrackerDbContext.cs"
    } | sort -z | xargs -0 md5sum | md5sum | awk '{print $1}'
}

cache_e2e_template() {
    local db_path="$1"
    local template="$REPO_ROOT/.e2e/template.db"
    local count
    count="$(sqlite3 "$db_path" "SELECT COUNT(*) FROM Players;" 2>/dev/null || echo 0)"
    if [[ "${count:-0}" -lt 1 ]]; then
        echo "❌ E2E sqlite seed did not apply (Players is empty). See $E2E_API_LOG"
        exit 1
    fi
    mkdir -p "$REPO_ROOT/.e2e"
    sqlite3 "$db_path" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
    rm -f "$template"
    sqlite3 "$db_path" ".backup '$template'"
    echo "$MIGRATIONS_HASH" > "$REPO_ROOT/.e2e/template.hash"
    echo "💾 Cached E2E sqlite template ($(du -h "$template" | awk '{print $1}'), ${count} players)"
}

prepare_e2e_db() {
    mkdir -p "$REPO_ROOT/.e2e/run"
    rm -f "$REPO_ROOT/.e2e/run/playertracker.db" \
          "$REPO_ROOT/.e2e/run/playertracker.db-wal" \
          "$REPO_ROOT/.e2e/run/playertracker.db-shm"

    # A real-data fixture, if this machine has one, wins over the synthetic seed.
    # It is schema-versioned by its own __EFMigrationsHistory rather than by
    # MIGRATIONS_HASH: the API migrates it up to this branch's head on boot, so a
    # worktree that is ahead of the fixture does not need it rebuilt.
    if [ -z "${E2E_SYNTHETIC:-}" ] && [ -f "$E2E_CACHE/template.db" ]; then
        sqlite3 "$E2E_CACHE/template.db" ".backup '$DB_PATH'"
        E2E_FIXTURE=real
        local anchor
        anchor="$(sed -n 's/^anchor=//p' "$E2E_CACHE/template.meta" 2>/dev/null | cut -c1-10)"
        echo "📦 Real-data fixture ($(du -h "$E2E_CACHE/template.db" | awk '{print $1}')${anchor:+, data to $anchor})"
        return
    fi

    MIGRATIONS_HASH="$(migrations_hash)"
    local template="$REPO_ROOT/.e2e/template.db"
    local hash_file="$REPO_ROOT/.e2e/template.hash"

    if [[ -z "${E2E_RESET_TEMPLATE:-}" \
          && -f "$template" \
          && -f "$hash_file" \
          && "$(cat "$hash_file")" == "$MIGRATIONS_HASH" ]]; then
        sqlite3 "$template" ".backup '$DB_PATH'"
        echo "📦 Using cached E2E sqlite template"
    else
        E2E_NEED_TEMPLATE=1
        echo "📦 E2E sqlite template missing or schema changed — API will migrate + seed"
    fi
}

# Runs "$@" as the leader of a new session, so of its own process group, under
# the same PID: `$!` of a backgrounded call is the group cleanup() kills. Both
# servers spawn a grandchild that holds the port (`dotnet run` launches the built
# binary, `npm run dev` launches vite), so killing only the process we
# backgrounded would leave the real server running. setsid(1) is util-linux and
# absent on macOS; this is the same setsid(2) through python3, which step 1
# already needs. Used on every platform, so CI runs the code a Mac runs.
in_new_session() {
    exec python3 -c 'import os, sys; os.getpgrp() == os.getpid() or os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@"
}

# SIGTERM each process group, wait up to 10 s for every member to go, then
# SIGKILL whatever is left. Returning while the API is still in its graceful
# shutdown would leave it running, and its port bound, after verify.sh exits.
stop_groups() {
    local pgid alive n=0
    for pgid in "$@"; do kill -TERM -- "-$pgid" 2>/dev/null || true; done
    while [ "$n" -lt 20 ]; do
        alive=""
        for pgid in "$@"; do kill -0 -- "-$pgid" 2>/dev/null && alive=1; done
        [ -z "$alive" ] && return 0
        sleep 0.5
        n=$((n + 1))
    done
    for pgid in "$@"; do kill -KILL -- "-$pgid" 2>/dev/null || true; done
}

# macOS with Colima: carry this machine's UI port into the VM, on the VM's own
# 127.0.0.1, over the ssh connection Colima already uses. Its own session, like
# the servers, so cleanup() stops it.
open_colima_tunnel() {
    local context profile config host
    context="$(docker context show)"
    profile="${context#colima}"
    profile="${profile#-}"
    config="$REPO_ROOT/.e2e/colima-ssh.config"
    E2E_TUNNEL_LOG="/tmp/bfstats-e2e-${E2E_SLOT:-reuse}-tunnel.log"
    if ! colima ssh-config --profile "${profile:-default}" > "$config" 2>/dev/null; then
        echo "❌ colima ssh-config failed for profile ${profile:-default}. Try E2E_PW_NETWORK=relay."
        return 1
    fi
    host="$(awk '$1 == "Host" { print $2; exit }' "$config")"
    in_new_session ssh -F "$config" -N \
        -o ControlMaster=no -o ControlPath=none \
        -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 \
        -R "127.0.0.1:${UI_PORT}:127.0.0.1:${UI_PORT}" "$host" \
        > "$E2E_TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
}

# Only tear down what we started. Installed before anything starts, so a failure
# between starting the API and starting the UI (a failed preview build, say)
# still stops the API.
cleanup() {
    # The tunnel before the UI: with the UI gone and the tunnel's listener still
    # in the VM, Colima's own forwarder could take the freed port on this Mac.
    [ -n "$TUNNEL_PID" ] && stop_groups "$TUNNEL_PID"
    if [ -n "$API_PID" ] || [ -n "$UI_PID" ]; then
        echo "Cleaning up isolated E2E processes..."
        # Unquoted on purpose: an empty one drops out.
        stop_groups $API_PID $UI_PID
    fi
    if [ -n "$NEO4J_STARTED" ]; then
        docker rm -f "$NEO4J_CONTAINER" >/dev/null 2>&1 || true
    fi
    if [ -n "$PW_CONTAINER" ]; then
        docker rm -f "$PW_CONTAINER" >/dev/null 2>&1 || true
    fi
}
PW_CONTAINER=""
TUNNEL_PID=""
E2E_TUNNEL_LOG=""
trap cleanup EXIT
# Turn Ctrl+C, a closed terminal and a CI cancel into an ordinary exit, so the
# EXIT trap runs on every shell (bash 3.2 included) and at once, rather than
# after whatever foreground command was running decides to finish.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [ -n "${E2E_REUSE:-}" ]; then
    API_PORT="${API_PORT:-9222}"
    UI_PORT="${UI_PORT:-5173}"
    PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:${UI_PORT}}"
    echo "⚠️  E2E_REUSE=1 — talking to whatever is on :${API_PORT} / :${UI_PORT}"
    if ! curl -sf "http://127.0.0.1:${API_PORT}/health" > /dev/null; then
        echo "❌ Nothing healthy on :${API_PORT}. Start the API or drop E2E_REUSE."
        exit 1
    fi
    if ! curl -sf "http://127.0.0.1:${UI_PORT}" > /dev/null; then
        echo "❌ Nothing healthy on :${UI_PORT}. Start the UI or drop E2E_REUSE."
        exit 1
    fi
else
    if ! command -v sqlite3 >/dev/null 2>&1; then
        echo "❌ sqlite3 is required to copy the E2E fixture. Install sqlite."
        exit 1
    fi
    if [ ! -d "$REPO_ROOT/ui/node_modules" ]; then
        echo "❌ ui/node_modules is missing — Playwright has nothing to run."
        echo "   Bootstrap this worktree: ./scripts/bootstrap-worktree.sh"
        exit 1
    fi
    # Isolation env holds a flock on fd 9 until this script exits.
    # shellcheck source=e2e-env.sh
    source "$REPO_ROOT/scripts/e2e-env.sh"

    # A throwaway RS256 key per worktree. Passed explicitly below rather than
    # left to `dotnet user-secrets`, which only exists on a machine somebody has
    # already set up by hand — and which CI, by definition, never has.
    # shellcheck source=e2e-secrets.sh
    source "$REPO_ROOT/scripts/e2e-secrets.sh"
    ensure_e2e_secrets "$REPO_ROOT" || exit 1

    # The slot's Redis db is namespaced against other worktrees but persists
    # between runs of this one, and responses are cached for up to an hour. A
    # fixture change would otherwise be invisible behind a response cached by an
    # earlier run — which looks exactly like the new data never being read.
    docker exec bf1942-redis redis-cli -n "${E2E_SLOT}" FLUSHDB >/dev/null 2>&1 \
      || echo "⚠️  Could not flush redis db ${E2E_SLOT}; cached responses may be stale"

    # Kick Neo4j off first — its ~8s boot then overlaps the sqlite copy and the
    # API start rather than adding to them.
    start_e2e_neo4j || exit 1
    prepare_e2e_db

    # Point the API at this slot's graph, or at nothing. An empty Neo4j:Uri makes
    # Program.cs skip the graph services entirely, which is what keeps the
    # default run cheap; pointing at the shared dev instance instead would let
    # concurrent worktrees write each other's graph.
    if [ -n "$NEO4J_STARTED" ]; then
        E2E_NEO4J_URI="bolt://127.0.0.1:${NEO4J_PORT}"
    else
        E2E_NEO4J_URI=""
    fi

    echo "🚀 Starting isolated API on :${API_PORT}..."
    mkdir -p "$(dirname "$DB_PATH")"
    # Its own session, so cleanup can kill the whole tree (in_new_session above).
    in_new_session bash -c "
      cd '$REPO_ROOT/api' && exec env \
        ASPNETCORE_ENVIRONMENT=Development \
        ASPNETCORE_URLS='http://127.0.0.1:${API_PORT}' \
        DB_PATH='$DB_PATH' \
        REDIS_CONNECTION_STRING='$REDIS_CONNECTION_STRING' \
        REDIS_INSTANCE_NAME='$REDIS_INSTANCE_NAME' \
        DISABLE_BACKGROUND_PROCESSING=true \
        E2E_SEED=true \
        ASSETS_STORAGE_PATH='$REPO_ROOT/tournament-images' \
        Jwt__Issuer='http://127.0.0.1:${API_PORT}' \
        Jwt__Audience='${PLAYWRIGHT_BASE_URL}' \
        Jwt__PrivateKey='${E2E_JWT_PRIVATE_KEY_B64}' \
        RefreshToken__Secret='${E2E_REFRESH_SECRET}' \
        Neo4j__Uri='${E2E_NEO4J_URI}' \
        Neo4j__Username=neo4j \
        Neo4j__Password=bf1942stats \
        Neo4j__Database=neo4j \
        SEQ_URL='http://localhost:5341' \
        dotnet run --no-build --no-launch-profile --urls 'http://127.0.0.1:${API_PORT}'
    " > "$E2E_API_LOG" 2>&1 &
    API_PID=$!

    if [ -n "${E2E_PREVIEW:-}" ]; then
        echo "📦 Building UI for preview (E2E_PREVIEW set)..."
        (cd ui && npm run build > "$E2E_UI_BUILD_LOG" 2>&1) || {
            echo "❌ UI build failed. See $E2E_UI_BUILD_LOG"; exit 1;
        }
        echo "📦 Starting UI preview server on :${UI_PORT}..."
        in_new_session bash -c "
          cd '$REPO_ROOT/ui' && exec env API_PORT='$API_PORT' UI_PORT='$UI_PORT' \
            npx vite preview --host 127.0.0.1 --port '$UI_PORT' --strictPort
        " > "$E2E_UI_LOG" 2>&1 &
        UI_PID=$!
    else
        echo "📦 Starting UI dev server on :${UI_PORT}..."
        in_new_session bash -c "
          cd '$REPO_ROOT/ui' && exec env API_PORT='$API_PORT' UI_PORT='$UI_PORT' \
            npm run dev -- --host 127.0.0.1 --port '$UI_PORT' --strictPort
        " > "$E2E_UI_LOG" 2>&1 &
        UI_PID=$!
    fi
fi

# Wait for API and UI
echo "⏳ Waiting for services to be ready..."
MAX_RETRIES=90
RETRY_COUNT=0
while ! curl -sf "http://127.0.0.1:${API_PORT}/health" > /dev/null \
      || ! curl -sf "http://127.0.0.1:${UI_PORT}" > /dev/null; do
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT+1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ Services failed to start."
        [ -n "${E2E_API_LOG:-}" ] && echo "   API log: $E2E_API_LOG"
        [ -n "${E2E_UI_LOG:-}" ] && echo "   UI log:  $E2E_UI_LOG"
        exit 1
    fi
done
echo "✅ Services are up!"

wait_for_e2e_neo4j || exit 1

if [ -n "$E2E_NEED_TEMPLATE" ]; then
    cache_e2e_template "$DB_PATH"
fi

# 5. Run Playwright E2E Tests in Docker
# We mount the 'ui' directory so the report and results are saved on the host
echo "🐳 Running in Docker (mcr.microsoft.com/playwright:v1.56.1-jammy)..."

# How the container reaches the UI on this machine's 127.0.0.1. The browser
# loads the same http://127.0.0.1:${UI_PORT} origin in every mode.
#   host    Linux: --network host shares this machine's loopback.
#   tunnel  macOS with Colima: Docker's host network is the Colima VM's, so an
#           `ssh -R` into the VM puts this machine's UI port on the VM's
#           127.0.0.1, and the container runs on --network host as on Linux.
#           Not the relay below: Colima's user-mode network loses requests
#           under a browser's load (15 failed tests in a full run; none
#           through the tunnel).
#   relay   other Docker on macOS (Docker Desktop, OrbStack): the container
#           runs on Docker's default network and its init relays its own
#           127.0.0.1:${UI_PORT} to host.docker.internal.
# The init (scripts/e2e-container-init.mjs) runs in every mode: it waits for
# the UI to answer from inside the container, and lets Ctrl+C reach Playwright.
if [ -z "${E2E_PW_NETWORK:-}" ]; then
    E2E_PW_NETWORK=host
    if [ "$(uname -s)" = Darwin ]; then
        E2E_PW_NETWORK=relay
        case "$(docker context show 2>/dev/null)" in
            colima|colima-*) command -v colima >/dev/null 2>&1 && E2E_PW_NETWORK=tunnel ;;
        esac
    fi
fi
PW_INIT=(node /opt/bfstats/e2e-container-init.mjs --port "$UI_PORT")
case "$E2E_PW_NETWORK" in
    host)
        PW_NETWORK=(--network host)
        ;;
    tunnel)
        # Only now, with the UI already holding the port here: Colima forwards
        # every port that listens in the VM back to this Mac, and would
        # otherwise take the UI's port before Vite could.
        open_colima_tunnel || exit 1
        PW_NETWORK=(--network host)
        ;;
    relay)
        PW_NETWORK=(-e E2E_RELAY_TARGET)
        PW_INIT+=(--relay)
        ;;
    *)
        echo "❌ E2E_PW_NETWORK must be host, tunnel or relay (got: $E2E_PW_NETWORK)"
        exit 1
        ;;
esac
PW_INIT+=(--)
echo "🔀 Playwright network: $E2E_PW_NETWORK"
# Named, so cleanup() can remove it if the docker CLI goes before the container.
PW_CONTAINER="bfstats-e2e-playwright-$$"

set +e # Allow script to continue after test failure to show report info
# Note: no `-e CI=true`. Playwright treats CI as "weak shared runner" and drops
# to one worker with two retries; this suite only runs locally. Non-interactive
# behaviour comes from the reporter config instead.
docker run --rm --name "$PW_CONTAINER" "${PW_NETWORK[@]}" \
  --add-host=localhost:127.0.0.1 \
  -v "$REPO_ROOT/ui":/work \
  -v "$REPO_ROOT/scripts/e2e-container-init.mjs":/opt/bfstats/e2e-container-init.mjs:ro \
  -w /work \
  -e PW_SKIP_WEBSERVER=1 \
  -e PW_ALL_BROWSERS \
  -e PW_WORKERS \
  -e "PLAYWRIGHT_BASE_URL=${PLAYWRIGHT_BASE_URL}" \
  mcr.microsoft.com/playwright:v1.56.1-jammy \
  "${PW_INIT[@]}" npx playwright test "${PW_ARGS[@]}"
TEST_EXIT_CODE=$?
set -e

if [ $TEST_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ E2E Tests Failed!"
    echo "📊 View the report: npx playwright show-report ui/playwright-report"
    echo "📸 Screenshots/Traces: ui/test-results/"
    [ -n "${E2E_API_LOG:-}" ] && echo "📜 API log: $E2E_API_LOG"
    [ -n "$E2E_TUNNEL_LOG" ] && echo "📜 Tunnel log: $E2E_TUNNEL_LOG"
    exit $TEST_EXIT_CODE
fi

echo "✅ All tests passed!"
