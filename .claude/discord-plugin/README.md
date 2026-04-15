# Long-running Claude Code session with Discord plugin

Run a persistent `claude` process on a remote VPS, reachable over Discord via the `claude-plugins-official` Discord plugin. You chat with the session from any Discord client; the VPS keeps the process alive across SSH disconnects and reboots.

## What's in here

- `start-claude-discord.sh` — starts a detached tmux session running `claude --channels plugin:discord@claude-plugins-official`. Idempotent.
- `claude-discord.service` — systemd user unit that runs the start script on boot and keeps the tmux server up.
- `remote-CLAUDE.md` — the per-host `~/.claude/CLAUDE.md` that tells the remote session how to sync with `origin/main`, handle dirty working trees, and behave over Discord.

## Prerequisites

On the VPS:

- `tmux`, `git`, `bash`, `systemd` (with a user manager).
- Claude Code installed — `claude` binary available to your interactive shell. The default script assumes it's at `$HOME/.local/bin/claude`.
- The Discord plugin already installed via `claude`'s plugin system, and the Discord bot token configured via `/discord:configure` (run it once interactively before you hand the session over to systemd).
- The repo you want the session to work on cloned somewhere (e.g. `~/projects/bfstats`).
- Any language runtimes the Discord plugin needs (e.g. `bun`) must be reachable from a **login shell** — `bash -lc 'which bun'` should print a path. If it doesn't, see troubleshooting.

## Setup

All commands below assume you're logged in as the user that will own the session. Running as root works but is unconventional.

### 1. Install the start script

```bash
mkdir -p ~/.bin
cp .claude/discord-plugin/start-claude-discord.sh ~/.bin/start-claude-discord.sh
chmod +x ~/.bin/start-claude-discord.sh
```

Edit the config block at the top of the script if your paths differ from the defaults:

- `PROJECT_PATH` — the repo the session should start in (default: `$HOME/projects/bfstats`)
- `CLAUDE_BIN` — absolute path to the claude binary (default: `$HOME/.local/bin/claude`)
- `SESSION_NAME` — tmux session name (default: `claude`)
- `LOG_FILE` — where the start script's stdout/stderr goes (default: `/var/log/claude-discord.log` — change if non-root and you don't have write access there)
- `CHANNEL_ARG` — the `--channels` argument (default: `plugin:discord@claude-plugins-official`)

You can also override any of these via environment variables without editing the file.

### 2. Install the systemd user unit

```bash
mkdir -p ~/.config/systemd/user
cp .claude/discord-plugin/claude-discord.service ~/.config/systemd/user/claude-discord.service
```

Edit the unit if any of these assumptions don't hold:

- The start script lives at `%h/.bin/start-claude-discord.sh` (change `ExecStart` if different).
- `claude` lives at `%h/.local/bin/` (change the `PATH` environment line if different).
- The tmux session is named `claude` (change `ExecStop`'s `kill-session -t claude` if you changed `SESSION_NAME`).

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now claude-discord
loginctl enable-linger "$USER"
```

`enable-linger` is what lets the user manager keep your services running when you're not logged in — skip it and the session dies the moment you `exit` your SSH shell.

### 3. Install the per-host CLAUDE.md

This tells the long-running session how to sync with main and how to behave over Discord.

```bash
mkdir -p ~/.claude
cp .claude/discord-plugin/remote-CLAUDE.md ~/.claude/CLAUDE.md
# Replace the <PROJECT_PATH> placeholder with the actual path
sed -i "s|<PROJECT_PATH>|$HOME/projects/bfstats|g" ~/.claude/CLAUDE.md
```

`~/.claude/CLAUDE.md` is loaded globally on every `claude` invocation on that host, so these instructions apply to the long-running session without touching the repo's own `CLAUDE.md`.

### 4. (Optional) Periodic git sync via cron

If you want the session to automatically check for updates to `origin/main` on a schedule:

```bash
crontab -e
```

Add:

```
*/30 * * * * /usr/bin/tmux send-keys -t claude "Check origin/main for new commits and fast-forward if the tree is clean." Enter
```

The literal word `Enter` is a tmux reserved key name that sends the Enter key — it's how you submit the line inside the Claude REPL from outside. Don't escape or quote it differently.

If you want an MCP reconnect cron too, it's easy to add, but most people won't need it — VPS uptime is stable enough that the plugin rarely drops. Diagnose first, cron-poke later.

## Verification

```bash
systemctl --user status claude-discord --no-pager        # should be "active (exited)"
tmux ls                                                  # should show the "claude" session
tmux attach -t claude                                    # you should see the Claude REPL
# Detach with Ctrl-b then d — NOT Ctrl-C (that kills claude)
```

Then send a message from Discord and check that you get a reply.

To verify the cron chain, send a harmless test poke manually:

```bash
/usr/bin/tmux send-keys -t claude "hello from send-keys" Enter
tmux attach -t claude    # you should see the line in the REPL
```

## Troubleshooting

Each of these bit us during the initial setup. If you hit any of them, the fix is below.

### `Failed at step EXEC spawning ... Exec format error`

The script's shebang is not at byte 0 of the file — leading whitespace, BOM, or CRLF line endings sneak in via some editors.

```bash
od -c ~/.bin/start-claude-discord.sh | head -1
```

The first printable characters after the offset column must be `#`, `!`, `/`, ... with no leading spaces or `\r`. If it's wrong, rewrite the file via heredoc:

```bash
cat > ~/.bin/start-claude-discord.sh <<'EOF'
...paste the real contents here...
EOF
chmod +x ~/.bin/start-claude-discord.sh
```

Or strip CRLF: `sed -i 's/\r$//' ~/.bin/start-claude-discord.sh`.

### Service shows `active` but `tmux ls` says "no server running"

Two possible causes:

1. **`Type=forking` with default `KillMode=control-group`** — systemd tears down the whole cgroup when the script exits, killing tmux with it. Fix: the unit in this folder is already `Type=oneshot` + `RemainAfterExit=yes`, which avoids this. Make sure you didn't edit it back to forking.

2. **`claude` (or something it needs, like `bun`) isn't on systemd's PATH**, so the command fails instantly, the tmux session ends, and tmux's default `exit-empty on` kills the server. Symptom: `systemd-run --user --pipe /bin/sh -c 'which claude'` says not found.

   The start script wraps the inner command in `bash -lc` specifically to pull in login-shell PATH. That means your dotfiles need to actually add the tool to PATH for login shells. Verify:

       bash -lc 'which claude; which bun'

   If those don't print paths, your `~/.bash_profile` probably doesn't source `~/.bashrc`. Add this to `~/.bash_profile`:

       [ -f ~/.bashrc ] && . ~/.bashrc

   Or add the tools' PATH additions directly to `~/.profile` which is always sourced by login shells.

   As a fallback, add `Environment=PATH=...` lines to the systemd unit with the absolute directories included.

### `systemctl --user` as root doesn't survive logout

Run `loginctl enable-linger root` (or whatever user owns the service). Without linger, the user manager exits when you log out and takes all your user services with it.

### `Ctrl-C` kills claude when I meant to detach

tmux uses a prefix key. To detach from the session (leave claude running, go back to your shell): `Ctrl-b`, release, then `d`. `Ctrl-C` always sends SIGINT to the foreground process inside the session.

### Crontab `%` in date format expansions becomes newlines

In crontab files, unescaped `%` is interpreted as a newline, which truncates your command. If you use `date +%Y...` in a cron command, escape each `%` as `\%`.

### MCP plugin stops responding

First try the `/mcp` command from inside the session (attach with `tmux attach -t claude`, type `/mcp`, detach with `Ctrl-b d`). If the plugin is properly broken, the cleanest recovery is a full restart:

```bash
systemctl --user restart claude-discord
```

## Design notes

- **`bash -lc` wrapper**: the tmux command launches `bash -lc 'exec claude ...'` rather than `claude` directly. The login shell sources your profile chain so PATH additions from bun/nvm/asdf/etc work transparently. `exec` replaces bash with claude to avoid a useless extra process.

- **`exit-empty off`**: set at the top of the start script so the tmux server stays up even if the inner command crashes. This makes debugging possible — you can still attach to the empty session and see what happened.

- **`Type=oneshot` + `RemainAfterExit=yes`**: the combination tells systemd "run this script once, then consider the unit active forever, and don't try to track any child processes." tmux daemonizes itself and lives on independently of the cgroup.

- **`~/.claude/CLAUDE.md`** vs a repo-level `CLAUDE.md`: the per-host file is global to the user on that host, loaded on every `claude` invocation. We use it for VPS-specific instructions (how to sync main, how to behave on Discord) so they don't pollute the project's own `CLAUDE.md` and don't need to be committed per-host.

- **Stash-pull-pop over refuse-on-dirty**: when the sync flow encounters a dirty working tree AND new commits on main, it stashes, pulls, and pops rather than refusing to sync. This respects the user's in-progress edits but still keeps the session on the latest code.

- **Backup branches on divergence**: if main has been rebased or force-pushed, the sync flow creates an `auto-sync-backup/<timestamp>` branch before doing `reset --hard`. The branch gives a grepable recovery point at zero cost — `git branch --list 'auto-sync-backup/*'` will show any sessions where the safety net kicked in.
