#!/bin/bash
set -e

# Reusable Verification Script for bfstats (Containerized E2E)
# Usage:
#   ./scripts/verify.sh                    (Runs unit tests + all E2E)
#   ./scripts/verify.sh --skip-e2e         (Runs only unit tests)
#   ./scripts/verify.sh e2e/landing.spec   (Runs specific E2E test)
#   ./scripts/verify.sh --project=chromium (Pass any playwright args)
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
#
# Isolation: each run binds unique API/UI ports and a throwaway sqlite copy so
# parallel worktrees do not share playertracker.db or collide on 9222/5173.
# See features/isolated-e2e-worktrees/README.md.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Check Infrastructure
echo "🔍 Checking infrastructure..."
if ! docker ps | grep -q "bf1942-redis"; then
    echo "❌ Docker containers are not running. Run 'docker-compose up -d' first."
    exit 1
fi

# 2. Run API Unit Tests
echo "🧪 Running API Unit Tests..."
dotnet test tests/api/api.tests.csproj --nologo -v m

# 3. Handle Arguments
SKIP_E2E=false
PW_ARGS=()

for arg in "$@"; do
    if [[ "$arg" == "--skip-e2e" ]]; then
        SKIP_E2E=true
    else
        PW_ARGS+=("$arg")
    fi
done

if [ "$SKIP_E2E" = true ]; then
    echo "⏭️ Skipping E2E tests."
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
    # Isolation env holds a flock on fd 9 until this script exits.
    # shellcheck source=e2e-env.sh
    source "$REPO_ROOT/scripts/e2e-env.sh"
    prepare_e2e_db

    echo "🚀 Starting isolated API on :${API_PORT}..."
    mkdir -p "$(dirname "$DB_PATH")"
    # setsid puts this in its own process group so cleanup can kill the whole
    # tree. Both servers spawn a grandchild that holds the port — `dotnet run`
    # launches the built binary, `npm run dev` launches vite — so killing just
    # the process we backgrounded leaves the real server running.
    setsid bash -c "
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
        Neo4j__Uri='bolt://localhost:7687' \
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
        setsid bash -c "
          cd '$REPO_ROOT/ui' && exec env API_PORT='$API_PORT' UI_PORT='$UI_PORT' \
            npx vite preview --host 127.0.0.1 --port '$UI_PORT' --strictPort
        " > "$E2E_UI_LOG" 2>&1 &
        UI_PID=$!
    else
        echo "📦 Starting UI dev server on :${UI_PORT}..."
        setsid bash -c "
          cd '$REPO_ROOT/ui' && exec env API_PORT='$API_PORT' UI_PORT='$UI_PORT' \
            npm run dev -- --host 127.0.0.1 --port '$UI_PORT' --strictPort
        " > "$E2E_UI_LOG" 2>&1 &
        UI_PID=$!
    fi
fi

# Only tear down what we started. Negative PID targets the whole process group,
# which is what setsid above set up.
cleanup() {
    if [ -n "$API_PID" ] || [ -n "$UI_PID" ]; then
        echo "Cleaning up isolated E2E processes..."
        [ -n "$API_PID" ] && kill -- "-$API_PID" 2>/dev/null || true
        [ -n "$UI_PID" ] && kill -- "-$UI_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

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

if [ -n "$E2E_NEED_TEMPLATE" ]; then
    cache_e2e_template "$DB_PATH"
fi

# 5. Run Playwright E2E Tests in Docker
# We mount the 'ui' directory so the report and results are saved on the host
echo "🐳 Running in Docker (mcr.microsoft.com/playwright:v1.56.1-jammy)..."

set +e # Allow script to continue after test failure to show report info
# Note: no `-e CI=true`. Playwright treats CI as "weak shared runner" and drops
# to one worker with two retries; this suite only runs locally. Non-interactive
# behaviour comes from the reporter config instead.
docker run --rm --network host \
  --add-host=localhost:127.0.0.1 \
  -v "$REPO_ROOT/ui":/work \
  -w /work \
  -e PW_SKIP_WEBSERVER=1 \
  -e PW_ALL_BROWSERS \
  -e PW_WORKERS \
  -e "PLAYWRIGHT_BASE_URL=${PLAYWRIGHT_BASE_URL}" \
  mcr.microsoft.com/playwright:v1.56.1-jammy \
  npx playwright test "${PW_ARGS[@]}"
TEST_EXIT_CODE=$?
set -e

if [ $TEST_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ E2E Tests Failed!"
    echo "📊 View the report: npx playwright show-report ui/playwright-report"
    echo "📸 Screenshots/Traces: ui/test-results/"
    [ -n "${E2E_API_LOG:-}" ] && echo "📜 API log: $E2E_API_LOG"
    exit $TEST_EXIT_CODE
fi

echo "✅ All tests passed!"
