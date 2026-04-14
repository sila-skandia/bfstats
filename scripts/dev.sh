#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/api"
UI_DIR="$REPO_ROOT/ui"
COMPOSE_FILE="$REPO_ROOT/docker-compose.dev.yml"

api_pid=""
ui_pid=""

cleanup() {
    trap - INT TERM EXIT
    [[ -n "$ui_pid" ]] && kill "$ui_pid" 2>/dev/null || true
    [[ -n "$api_pid" ]] && kill "$api_pid" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Stopping docker-compose services..."
    (cd "$REPO_ROOT" && docker compose -f "$COMPOSE_FILE" down) || true
}
trap cleanup INT TERM EXIT

echo "Starting docker-compose services..."
(cd "$REPO_ROOT" && docker compose -f "$COMPOSE_FILE" up -d)

echo "Starting API in $API_DIR..."
(cd "$API_DIR" && dotnet run) &
api_pid=$!

echo "Starting UI in $UI_DIR..."
(cd "$UI_DIR" && npm run dev) &
ui_pid=$!

wait -n "$api_pid" "$ui_pid"
