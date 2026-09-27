# Parity lab

A private BF1942 dedicated server for real-game runs, so a scenario played in
the game can be replayed and compared in the viewer. The design, the findings
and the plan are in
[`features/parity-lab/README.md`](../../../features/parity-lab/README.md).

The lab is a copy of the LAN server (`server1`) that runs as you, on its own
ports, started and stopped per run. `server1` is never touched.

## Usage

From `tools/bf1942-models/`:

```sh
python3 lab/lab.py setup                              # once: build ~/bf1942-lab/server from server1
python3 lab/lab.py start lab/scenarios/wake-coop.json # render settings, start, wait for the round
python3 lab/lab.py status                             # uptime, players spawned, kits, vehicles, kills
python3 lab/lab.py stop                               # stop, collect the run, stage it for the viewer
python3 lab/lab.py summary ~/bf1942-lab/runs/<run>    # the run's event log summarised (--json)
```

`start` prints the join command. The port rides on the address: BF1942.exe
ignores `+port` and would join server1 on 14567.

```sh
~/.wine/bf1942-monitor/collector/bf1942-monitor.sh +joinServer 192.168.1.226:14568 +isInternet 0
```

The scoreboard names the server: `bfstats-lab`, not `BF1942 server1`.

With `recordReplays = on` in `bf42plus.ini`, the client records from the join.
Launch it as soon as `start` prints the join line, and the scenario's pregame
gets it in before the round starts. The game closes itself when the round
ends (its between-maps restart does not come back under Wine), which closes
the recording. Quit it yourself before `stop` otherwise: the recorder closes
its file on exit, not on a disconnect. `stop` then prints the viewer URL for each recording, with the
run's event log as the overlay and the scenario's layer as `mode`. A recording
made on another server while the lab ran is named and left out.

## A scenario

`lab/scenarios/*.json`:

| key | |
|---|---|
| `name` | the run directory's suffix |
| `levels` | `[{map, mode, mod}]`; `mode` is `GPM_COOP` (bots), `GPM_CQ`, `GPM_CTF` or `GPM_TDM` |
| `serverSettings` | `game.<key> <value>` lines over server1's `ServerSettings.con` (not the ports) |
| `autoexec` | console lines appended to `ServerAutoExec.con`; `aiSettings.setMaxNBots N` sets the bot count, split evenly between the sides |
| `preload` | a 32-bit `.so` for `LD_PRELOAD` (the server recorder, when it exists) |
| `human` | what the person at the client does |

## Where things live

| | |
|---|---|
| `~/bf1942-lab/server/` | the install: the binary and `lib/` copied, each mod's `archives/` linked to server1's, `settings-template/` snapshotted from server1 at `setup` (without bfsmd's files and the remote console password) |
| `~/bf1942-lab/runs/<yyyymmdd-hhmmss>-<name>/` | `scenario.json`, `settings/` as rendered, `serverlog/ev_14568-*.xml`, `client/replay_*.ndjson`, `server.out`, `run.json` |
| `~/bf1942-lab/current.json` | the running server's pid and run |
| `viewer/replays/<run>/` | copies of the run's recordings and log for `map.html` (gitignored) |

Environment overrides: `BF42_LAB`, `BF42_SERVER_SRC`, `BF42_GAME_DIR`,
`BF42_MONITOR`, `BF42_VIEWER_URL`.

Tests: `python3 -m unittest tests.test_lab`.
