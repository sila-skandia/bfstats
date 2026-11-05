#!/usr/bin/env bash
# Compute a per-worktree isolation slot (ports, redis db, sqlite path).
#
# Sourced by verify.sh: exports vars and holds a flock on fd 9 for the
# lifetime of the caller. Executed as `scripts/e2e-env.sh --print`: prints
# the preferred slot without locking.
#
# Do not `set -u` when sourced — verify.sh uses optional env vars.

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
fi

E2E_SLOT_COUNT=16
E2E_API_PORT_BASE=9300
E2E_UI_PORT_BASE=5273
# Neo4j Community allows exactly one user database per instance — CREATE DATABASE
# is rejected — so a private graph means a private container, not a private
# database name. 7690+ stays clear of the dev instance on 7687.
E2E_NEO4J_PORT_BASE=7690

_e2e_repo_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  echo "$here"
}

_e2e_hash_slot() {
  local root="$1"
  local hex
  hex="$(printf '%s' "$root" | md5sum | cut -c1-4)"
  echo $(( 16#${hex} % E2E_SLOT_COUNT ))
}

_e2e_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "( sport = :${port} )" 2>/dev/null | grep -q .
    return $?
  fi
  # No ss on macOS. Every server verify.sh starts binds 127.0.0.1.
  (echo >/dev/tcp/127.0.0.1/"${port}") >/dev/null 2>&1
}

# The slot lock is flock(2) on fd 9, taken through python3 rather than the
# flock(1) command, which is util-linux and so absent on macOS. A flock belongs
# to the open file, not to the process that asked for it, so the lock a
# one-line python3 takes on the inherited fd 9 stays held by this shell until
# fd 9 closes: what `flock -n 9` did, since it is a child process too. The
# servers verify.sh starts inherit fd 9 as well, so a leftover one keeps its
# slot taken. Used on every platform, so CI runs the code a Mac runs.
_e2e_lock_fd9() {
  python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null
}

_e2e_unlock_fd9() {
  python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_UN)' 2>/dev/null
}

_e2e_print_exports() {
  cat <<EOF
E2E_SLOT=${E2E_SLOT}
API_PORT=${API_PORT}
UI_PORT=${UI_PORT}
NEO4J_PORT=${NEO4J_PORT}
PLAYWRIGHT_BASE_URL=${PLAYWRIGHT_BASE_URL}
DB_PATH=${DB_PATH}
NEO4J_DATA_DIR=${NEO4J_DATA_DIR}
NEO4J_CONTAINER=${NEO4J_CONTAINER}
REDIS_CONNECTION_STRING=${REDIS_CONNECTION_STRING}
REDIS_INSTANCE_NAME=${REDIS_INSTANCE_NAME}
E2E_API_LOG=${E2E_API_LOG}
E2E_UI_LOG=${E2E_UI_LOG}
EOF
}

_e2e_apply_slot() {
  local slot="$1"
  local root="$2"
  E2E_SLOT="$slot"
  API_PORT=$((E2E_API_PORT_BASE + slot))
  UI_PORT=$((E2E_UI_PORT_BASE + slot))
  NEO4J_PORT=$((E2E_NEO4J_PORT_BASE + slot))
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:${UI_PORT}"
  DB_PATH="${root}/.e2e/run/playertracker.db"
  NEO4J_DATA_DIR="${root}/.e2e/run/neo4j"
  NEO4J_CONTAINER="bfstats-e2e-neo4j-${slot}"
  REDIS_CONNECTION_STRING="localhost:6379,defaultDatabase=${slot}"
  REDIS_INSTANCE_NAME="e2e-${slot}"
  E2E_API_LOG="/tmp/bfstats-e2e-${slot}-api.log"
  E2E_UI_LOG="/tmp/bfstats-e2e-${slot}-ui.log"
  E2E_UI_BUILD_LOG="/tmp/bfstats-e2e-${slot}-ui-build.log"
}

REPO_ROOT="${REPO_ROOT:-$(_e2e_repo_root)}"
PREFERRED_SLOT="${E2E_SLOT:-$(_e2e_hash_slot "$REPO_ROOT")}"

if [[ "${1:-}" == "--print" ]]; then
  _e2e_apply_slot "$PREFERRED_SLOT" "$REPO_ROOT"
  _e2e_print_exports
  exit 0
fi

# Already isolated in this shell (e.g. sourced twice).
if [[ -n "${E2E_SLOT_LOCKED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

mkdir -p /tmp/bfstats-e2e-slots
LOCK_ACQUIRED=0
for offset in $(seq 0 $((E2E_SLOT_COUNT - 1))); do
  candidate=$(( (PREFERRED_SLOT + offset) % E2E_SLOT_COUNT ))
  lock_file="/tmp/bfstats-e2e-slots/${candidate}.lock"
  exec 9>"${lock_file}"
  if ! _e2e_lock_fd9; then
    continue
  fi
  api_port=$((E2E_API_PORT_BASE + candidate))
  ui_port=$((E2E_UI_PORT_BASE + candidate))
  neo4j_port=$((E2E_NEO4J_PORT_BASE + candidate))
  if _e2e_port_in_use "$api_port" || _e2e_port_in_use "$ui_port" \
     || _e2e_port_in_use "$neo4j_port"; then
    _e2e_unlock_fd9 || true
    continue
  fi
  _e2e_apply_slot "$candidate" "$REPO_ROOT"
  LOCK_ACQUIRED=1
  break
done

if [[ "$LOCK_ACQUIRED" -ne 1 ]]; then
  echo "❌ No free E2E isolation slot (tried ${E2E_SLOT_COUNT} API ports ${E2E_API_PORT_BASE}-$((E2E_API_PORT_BASE + E2E_SLOT_COUNT - 1)))." >&2
  echo "   Kill a leftover verify.sh API/UI, or wait for another worktree's run to finish." >&2
  return 1 2>/dev/null || exit 1
fi

export E2E_SLOT API_PORT UI_PORT NEO4J_PORT PLAYWRIGHT_BASE_URL DB_PATH
export NEO4J_DATA_DIR NEO4J_CONTAINER
export REDIS_CONNECTION_STRING REDIS_INSTANCE_NAME
export E2E_API_LOG E2E_UI_LOG E2E_UI_BUILD_LOG
export E2E_SLOT_LOCKED=1

echo "🔒 E2E isolation slot ${E2E_SLOT}  API :${API_PORT}  UI :${UI_PORT}  neo4j :${NEO4J_PORT}  redis db ${E2E_SLOT}  db ${DB_PATH}"
