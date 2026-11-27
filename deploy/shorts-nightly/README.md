# Replay Shorts nightly

Runs `scripts/shorts-nightly.sh` at 03:30 every night on a machine with a GPU
and Google Chrome (or Playwright's Chromium on Linux). Each night it films and
uploads the Shorts of the newest recordings, covers for recordings without
one, the week's match recap, then prunes unwatched Shorts and fixes colour
range. What each step does is in the script's comments and in
`.claude/skills/replay-shorts/SKILL.md`.

## How it is set up

The job runs from a checkout of its own: a detached git worktree of this repo,
which `run.sh` brings up to `origin/main` before every run. A working checkout
is often on a branch or holds uncommitted work; the nightly never touches it,
and a change reaches the nightly once it is pushed to `main`.

| File | What |
|---|---|
| `install.sh` | makes the worktree, renders and loads the scheduler unit |
| `run.sh` | what the scheduler runs: update the checkout, run the nightly |
| `io.bfstats.shorts.plist` | the macOS launchd agent (template) |
| `bfstats-shorts.service`, `.timer` | the Linux systemd user units (template) |

The unit files are templates: `__CHECKOUT__` and `__HOME__` are filled in by
`install.sh` for the machine it runs on. Nothing machine-specific is checked in.

## Install

1. Sign the Shorts job in, once: `node scripts/shorts-sign-in.mjs` opens
   bfstats.io's Allow page; sign in there as an admin and press Allow. The
   sign-in is kept in `~/.config/bfstats/shorts-sign-in.json` (mode 600) and
   refreshed by the tools as it falls due; the nightly checks it first and
   does nothing without it (features/replay-shorts, "Signing in").
2. Have `ui/node_modules` installed in this checkout (`npm ci` in `ui/`);
   the nightly's worktree links to it.
3. From this checkout:

   ```bash
   deploy/shorts-nightly/install.sh
   ```

   That makes `../bfstats-nightly` (pass another path as the argument) and
   installs the launchd agent on macOS or the systemd user timer on Linux.
   `--dry-run` prints the rendered units and changes nothing. Re-running it
   is safe.

## Run, watch, stop

| | macOS | Linux |
|---|---|---|
| run now | `launchctl kickstart gui/$(id -u)/io.bfstats.shorts` | `systemctl --user start bfstats-shorts.service` |
| status | `launchctl print gui/$(id -u)/io.bfstats.shorts` | `systemctl --user list-timers bfstats-shorts.timer` |
| remove | `launchctl bootout gui/$(id -u)/io.bfstats.shorts` | `systemctl --user disable --now bfstats-shorts.timer` |

The log is `~/.cache/bfstats-shorts/nightly.log` (launchd's own output in
`launchd.log` beside it). A Mac asleep at 03:30 runs the job once on waking;
the Linux timer is `Persistent`, so a missed night runs at the next boot.

Switches, as environment variables on the unit: `RECORDING_COVERS=0`,
`RECAP_WEEKLY=0`, `SHORTS_PRUNE=0`, `SHORTS_COLOUR=0` turn a step off;
`ASMR_WEEKLY=1` and `ROLL_WEEKLY=1` turn the paused weekly ASMR and action
roll back on.
