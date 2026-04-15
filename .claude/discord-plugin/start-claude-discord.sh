#!/usr/bin/env bash
set -euo pipefail

# === Configuration (override via env or edit here) ===
PROJECT_PATH="${PROJECT_PATH:-$HOME/projects/bfstats}"
CLAUDE_BIN="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
SESSION_NAME="${SESSION_NAME:-claude}"
LOG_FILE="${LOG_FILE:-/var/log/claude-discord.log}"
CHANNEL_ARG="${CHANNEL_ARG:-plugin:discord@claude-plugins-official}"

# === Logging ===
exec >> "$LOG_FILE" 2>&1
echo "=== $(date -Iseconds) start ==="

# === Bail if the session is already running ===
cd "$PROJECT_PATH"
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "session '$SESSION_NAME' already running; nothing to do"
    exit 0
fi

# Keep the tmux server alive even if the inner command crashes,
# so you can always attach to debug.
tmux set-option -g exit-empty off 2>/dev/null || true

# Spawn the session via a login shell (bash -l) so PATH additions
# from ~/.bashrc / ~/.bash_profile / bun / nvm / etc are picked up.
# exec replaces the bash process with claude so there's no extra layer.
tmux new-session -d -s "$SESSION_NAME" \
    "bash -lc 'exec \"$CLAUDE_BIN\" --channels \"$CHANNEL_ARG\"'"

echo "spawned claude session '$SESSION_NAME'"
