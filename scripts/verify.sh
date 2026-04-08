#!/bin/bash
set -e

# Reusable Verification Script for bfstats (Containerized E2E)
# Usage: 
#   ./scripts/verify.sh                    (Runs unit tests + all E2E)
#   ./scripts/verify.sh --skip-e2e         (Runs only unit tests)
#   ./scripts/verify.sh e2e/landing.spec   (Runs specific E2E test)
#   ./scripts/verify.sh --project=chromium (Pass any playwright args)

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
echo "🚀 Starting API in background..."
cd api
dotnet run --no-build > /tmp/api-verify.log 2>&1 &
API_PID=$!

echo "📦 Starting UI in background..."
cd ../ui
npm run dev > /tmp/ui-verify.log 2>&1 &
UI_PID=$!

# Cleanup on exit
cleanup() {
    echo "Cleaning up background processes..."
    kill $API_PID || true
    kill $UI_PID || true
}
trap cleanup EXIT

# Wait for API and UI
echo "⏳ Waiting for services to be ready..."
MAX_RETRIES=60
RETRY_COUNT=0
while ! curl -s http://localhost:9222/health > /dev/null || ! curl -s http://localhost:5173 > /dev/null; do
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT+1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ Services failed to start."
        exit 1
    fi
done
echo "✅ Services are up!"

# 5. Run Playwright E2E Tests in Docker
# We mount the 'ui' directory so the report and results are saved on the host
echo "🐳 Running in Docker (mcr.microsoft.com/playwright:v1.56.1-jammy)..."

set +e # Allow script to continue after test failure to show report info
docker run --rm --network host \
  -v $(pwd):/work \
  -w /work \
  -e CI=true \
  -e PW_SKIP_WEBSERVER=1 \
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
