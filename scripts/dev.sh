#!/usr/bin/env bash
# Run the dev stack: the docker-compose services, the API (:9222) and the UI
# (:5173). Ctrl+C stops all of it, and so does either server exiting.
#
# Written for bash 3.2 as well, because that is the bash macOS ships.
# shellcheck disable=SC2329 # cleanup and its helpers run from the EXIT trap
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/api"
UI_DIR="$REPO_ROOT/ui"
COMPOSE_FILE="$REPO_ROOT/docker-compose.dev.yml"

api_pid=""
ui_pid=""
# The compose services this run started, and so the ones it stops. A service
# already running belongs to someone else: bootstrap-worktree.sh starts redis,
# and every worktree's E2E runs share it, so it keeps running.
started=""

compose() {
    (cd "$REPO_ROOT" && docker compose -f "$COMPOSE_FILE" "$@")
}

# A pid and every process below it. `dotnet run` starts the built API and
# `npm run dev` starts vite as children, and those are what hold the ports,
# so stopping only the pid we backgrounded leaves them running.
process_tree() {
    local child
    echo "$1"
    for child in $(pgrep -P "$1" 2>/dev/null || true); do
        process_tree "$child"
    done
}

# TERM both servers' trees, give them 20s to shut down (the API's background
# services take several seconds), then KILL whatever is left.
stop_servers() {
    local pids="" alive pid i
    for pid in "$api_pid" "$ui_pid"; do
        if [[ -n "$pid" ]]; then
            pids="$pids $(process_tree "$pid")"
        fi
    done
    [[ -n "${pids// /}" ]] || return 0

    # shellcheck disable=SC2086 # word-splitting the pid list is the point
    kill -TERM $pids 2>/dev/null || true
    for ((i = 0; i < 40; i++)); do
        alive=""
        for pid in $pids; do
            if kill -0 "$pid" 2>/dev/null; then alive="$alive $pid"; fi
        done
        [[ -n "$alive" ]] || return 0
        sleep 0.5
    done
    echo "Still running after 20s, killing:$alive"
    # shellcheck disable=SC2086
    kill -KILL $alive 2>/dev/null || true
}

cleanup() {
    trap - EXIT
    echo "Stopping API and UI..."
    stop_servers
    if [[ -n "$started" ]]; then
        echo "Stopping docker-compose services:$started"
        # shellcheck disable=SC2086 # one argument per service
        compose rm --stop --force $started || true
    fi
}
# Signals exit, and the exit runs cleanup once.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

running="$(compose ps --services --status running 2>/dev/null || true)"
for svc in $(compose config --services); do
    if ! grep -qx "$svc" <<<"$running"; then
        started="$started $svc"
    fi
done

echo "Starting docker-compose services..."
compose up -d

echo "Starting API in $API_DIR..."
(cd "$API_DIR" && dotnet run) &
api_pid=$!

echo "Starting UI in $UI_DIR..."
(cd "$UI_DIR" && npm run dev) &
ui_pid=$!

# No `wait -n` before bash 4.3, so poll until either server exits.
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$ui_pid" 2>/dev/null; do
    sleep 1
done
if kill -0 "$api_pid" 2>/dev/null; then
    echo "UI exited; shutting everything down."
else
    echo "API exited; shutting everything down."
fi
exit 1
