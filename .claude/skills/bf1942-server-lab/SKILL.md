---
name: bf1942-server-lab
description: >
  Starts the BF1942 server lab on this PC: a private dedicated server with bots
  (co-op mode) that the game client joins with the bf42plus recorder on, so a real
  round can be recorded, then replayed in the map viewer with the server's own event
  log alongside. Use this whenever the user wants to start, resurrect, check or stop
  the lab server, record or capture a round with bots from the real game (for the
  replay or the round report), replay a real round in the viewer, or run a parity
  scenario against the real game. Also use it when they say they joined and can't see
  any bots, or ended up on server1, and when adding a scenario (map, mode, bot count)
  or sharing the lab with another session.
---

# BF1942 server lab

The lab is a copy of the LAN server (`server1`) that runs under the desktop
login on port 14568, started and stopped per run by
`tools/bf1942-models/lab/lab.py`. The
client joins it with the bf42plus recorder on; `stop` gathers the server's
event log and the client's recording into a run directory and prints a viewer
URL. It only works on this PC: it copies `/home/bf1942_user/instances/server1`
and uses the Wine client in `~/.wine`.

Leave server1 alone. It runs under bfsmd and systemd as `bf1942_user`, and
changing it needs sudo. The lab exists so that none of that is needed.

Design, findings and plan: `features/parity-lab/README.md`. Tool usage:
`tools/bf1942-models/lab/README.md`.

## Run it from the main checkout

Use `/home/dylan/projects/skandia/bfstats/tools/bf1942-models`, not a worktree.
`stop` copies the run into its own checkout's `viewer/replays/`, and the
owner's viewer on :5273 serves the main checkout, so a run stopped from a
worktree prints a URL that 404s.

## Record a round

1. **Check the lab is free.**
   `python3 lab/lab.py status`. If a run is live that the user did not start
   (another session's, e.g. `tk-*`), ask before stopping it. If it says the
   last server exited on its own, `stop` collects that run.

2. **Start it without waiting.**
   `python3 lab/lab.py start lab/scenarios/wake-coop.json --wait 0`.
   Pass the join line it prints to the user straight away: the scenario has a
   90 s pregame so the client can connect before the round starts and the
   bots spawn, and then the recording covers the whole round.

3. **The user joins.** Launching the game takes over their screen, so leave it
   to them unless they ask you to:

   ```
   ~/.wine/bf1942-monitor/collector/bf1942-monitor.sh +joinServer 192.168.1.226:14568 +isInternet 0
   ```

   The port goes on the address. BF1942 ignores `+port` and joins 14567,
   which is server1: no bots, Conquest layout. The scoreboard should say
   `bfstats-lab`. Recording needs `recordReplays = on` in
   `~/.wine/drive_c/EA Games/Battlefield 1942/bf42plus.ini`.

4. **During the round,** `python3 lab/lab.py status` shows players spawned per
   side, kits, vehicles and kills. On the spawn screen the free camera is the
   recording's relevance centre: the client only receives motion within about
   520 m of it.

5. **The round ends.** A 32-player Wake co-op round lasts about 7 minutes. The
   game then closes itself: BF1942 restarts its process between maps, that
   restart does not come back under Wine, and with one round a map every round
   end is a map change. This is expected, and it closes the recording cleanly.

6. **Stop and collect.** `python3 lab/lab.py stop`. It prints:
   - the run directory `~/bf1942-lab/runs/<yyyymmdd-hhmmss>-<scenario>/`
     (`serverlog/`, `client/`, `settings/`, `run.json`);
   - `not collected: ... joined '<name>'` for a recording made on another
     server while the lab ran;
   - `(still open ...)` if the game was still running, in which case the copy
     has no `end` record;
   - the viewer URL. It carries `&serverlog=` and `&mode=CoOp`, and loads from
     :5273.

7. **Report.** Give the user the viewer URL and the highlights of
   `python3 lab/lab.py summary ~/bf1942-lab/runs/<run>`: players per side,
   starting tickets, kits and vehicles. The round result and every bot's name
   and score are in the log's `<bf:roundstats>` block. The Browser pane
   usually has WebGL disabled, and a headless Wake load costs about 5 minutes
   of CPU on the machine the owner is using, so let the user look at the
   replay themselves. `alignServerLog` can be checked in Node without a
   browser: the replay parsers in `viewer/replay-recording.js` and
   `viewer/replay-server-log.js` import nothing else.

## Scenarios

`tools/bf1942-models/lab/scenarios/*.json`. `wake-coop.json` is the baseline:
Wake, one round, 15 bots a side, 32 slots.

| key | |
|---|---|
| `name` | the run directory's suffix |
| `levels` | `[{map, mode, mod}]`; bots only exist in `GPM_COOP` |
| `serverSettings` | `game.<key>` values over server1's settings; the ports cannot be changed |
| `autoexec` | console lines; `aiSettings.setMaxNBots N` gives N bots split evenly between the sides |
| `human` | what the person at the client does |

Keep these in mind when writing one:

- **Leave room for the recording client.** Set `setMaxNBots` at least 2 below
  `serverMaxPlayers`; whether a bot makes way for a human on a full server is
  unverified.
- **Co-op plays the level's `SinglePlayer/` layer,** not `Conquest/`. The
  viewer's name for it is `mode=CoOp`, and the event log header says `GPM_CQ`
  regardless.
- **Starting tickets scale with max players.** They are the level's value ×
  ticket ratio ÷ 100 × `serverMaxPlayers` ÷ 16, so 100 becomes 200 at 32
  players and 50 at 8.
- **Keep one level and one round.** Whether `setMaxNBots` survives a level
  reload is unverified, and the client leaves at the round's end anyway.
- **Keep the 90 s pregame** (`serverGameStartDelay`) for any run with a
  recording.

## When something is off

| symptom | cause and fix |
|---|---|
| joined, only me, no bots | the client is on server1. The recording's event 0x1B names the server; rejoin with the `ip:port` line above |
| `start`: "already running" | a run is live; `status` shows whose, so ask before stopping one you did not start |
| `start`: "the server exited" | read the run's `server.out`, then check that ports 14568, 22001, 23001 and 14724 are free (`ss -ulpn`) |
| no client recording collected | `recordReplays` is off; or the recording joined another server; or the client joined before `start` |
| the recording covers only part of the round | the client joined after the round started; start again and join during the pregame |
| viewer URL 404s | the run was stopped from a worktree; copy `~/bf1942-lab/runs/<run>/{client,serverlog}` files into the main checkout's `viewer/replays/<run>/` |
| server1's settings changed and the lab should follow | `python3 lab/lab.py setup --force` while no run is live |

## Sharing the lab

One server at a time: `start` refuses while one runs. A session that wants
lab time waits until `~/bf1942-lab/current.json` has been gone for a while,
names its scenarios so its runs are recognisable, and deletes its test runs'
copies under `viewer/replays/` afterwards. Stopping another session's run is
fine only when that session said so.
