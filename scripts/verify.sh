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
#
# Reuse whatever is already listening. Previously this started a dev server
# unconditionally: if you already had `npm run dev` open, Vite found 5173 taken,
# silently bound 5174 and printed nothing the script checked, while the tests
# carried on against the original server. The health check below passed either
# way, so the mismatch was invisible — and the cleanup trap then killed the
# wrong process.
API_PID=""
UI_PID=""

if curl -sf http://localhost:9222/health > /dev/null 2>&1; then
    echo "🚀 Reusing API already listening on :9222"
else
    echo "🚀 Starting API in background..."
    # setsid puts this in its own process group so cleanup can kill the whole
    # tree. Both servers spawn a grandchild that holds the port — `dotnet run`
    # launches the built binary, `npm run dev` launches vite — so killing just
    # the process we backgrounded leaves the real server running.
    setsid bash -c 'cd api && exec dotnet run --no-build' > /tmp/api-verify.log 2>&1 &
    API_PID=$!
fi

if curl -sf http://localhost:5173 > /dev/null 2>&1; then
    echo "📦 Reusing UI already listening on :5173"
elif [ -n "$E2E_PREVIEW" ]; then
    # Serve the production build instead of the dev server. Slower overall —
    # the build costs ~12s and only saves ~5s of test time — but it exercises
    # what actually ships: bundled, minified, chunk-split output, roughly 5
    # requests per page instead of ~80 on-demand module transforms. Worth it
    # when a change could plausibly break at build time rather than at runtime.
    echo "📦 Building UI for preview (E2E_PREVIEW set)..."
    (cd ui && npm run build > /tmp/ui-build.log 2>&1) || {
        echo "❌ UI build failed. See /tmp/ui-build.log"; exit 1;
    }
    echo "📦 Starting UI preview server in background..."
    setsid bash -c 'cd ui && exec npx vite preview' > /tmp/ui-verify.log 2>&1 &
    UI_PID=$!
else
    echo "📦 Starting UI dev server in background..."
    # --strictPort so a port clash fails loudly instead of drifting to 5174.
    setsid bash -c 'cd ui && exec npm run dev -- --strictPort' > /tmp/ui-verify.log 2>&1 &
    UI_PID=$!
fi

# Only tear down what we started. Negative PID targets the whole process group,
# which is what setsid above set up.
cleanup() {
    if [ -n "$API_PID" ] || [ -n "$UI_PID" ]; then
        echo "Cleaning up background processes..."
        [ -n "$API_PID" ] && kill -- "-$API_PID" 2>/dev/null || true
        [ -n "$UI_PID" ] && kill -- "-$UI_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Wait for API and UI
echo "⏳ Waiting for services to be ready..."
MAX_RETRIES=60
RETRY_COUNT=0
while ! curl -sf http://localhost:9222/health > /dev/null || ! curl -sf http://localhost:5173 > /dev/null; do
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT+1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ Services failed to start. See /tmp/api-verify.log and /tmp/ui-verify.log"
        exit 1
    fi
done
echo "✅ Services are up!"

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
  mcr.microsoft.com/playwright:v1.56.1-jammy \
  npx playwright test "${PW_ARGS[@]}"
TEST_EXIT_CODE=$?
set -e

if [ $TEST_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ E2E Tests Failed!"
    echo "📊 View the report: npx playwright show-report ui/playwright-report"
    echo "📸 Screenshots/Traces: ui/test-results/"
    exit $TEST_EXIT_CODE
fi

echo "✅ All tests passed!"
