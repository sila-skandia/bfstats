# Parity lab

A private BF1942 dedicated server for real-game runs, so a scenario played in
the game can be replayed and compared in the viewer. The design, the findings
and the plan are in
[`features/parity-lab/README.md`](../../../features/parity-lab/README.md).

The lab runs as you, on its own ports, started and stopped per run. It is a
copy of `server1`, which is never touched. To install it, see
[INSTALL.md](INSTALL.md).

## Running a scenario

From `tools/bf1942-models/`:

```sh
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
Launch it as soon as `start` prints the join line, so the scenario's pregame
gets it in before the round starts. The game closes itself when the round
ends, which closes the recording. Otherwise, quit the game before `stop`: the
recorder closes its file on exit, not on a disconnect.

`stop` prints the viewer URL for each recording, with the run's event log as
the overlay and the scenario's layer as `mode`. A recording made on another
server while the lab ran is named and left out.

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

## Mods

A scenario names its mod per level (`"mod": "desertcombat"`). The viewer URL
`stop` prints then carries `&mod=`, and a mod level writes its event log to
that mod's own `logs/`, which `stop` collects too. Mods the lab needs are
installed as described in [INSTALL.md](INSTALL.md).

Desert Combat 0.7 runs this way (2026-10-06): `dc-*-coop-rec` scenarios: the server
recorder preloaded, bots only. DC's overlays of vanilla levels (El Alamein,
Gazala, ...) take their AI data from vanilla's archives through DC's
`addModPath Mods/BF1942/`. The runs and what they measured are in
`features/desert-combat-parity/lab-ground-truth.md`.

## A second lab beside the shared one

When another session holds the shared lab (a sweep that stops and starts it
every few minutes), a private copy runs on other ports. Copy the install
without its `replays/` (the mods' archives are symlinks, so it is about
20 MB) and point `lab.py` at it; `BF42_LAB_PORT_OFFSET` moves all four ports:

```bash
mkdir -p ~/.cache/<tag>/lab/server/replays
cp -a ~/bf1942-lab/server/{bf1942_lnxded,lib,mods,settings-template,SOURCE.json,recorder.con} ~/.cache/<tag>/lab/server/
BF42_LAB=~/.cache/<tag>/lab BF42_LAB_PORT_OFFSET=10 python3 lab/lab.py start <scenario> --wait 0
```

The server then listens on 14578. Sidecar soldiers can play it without the
game client: `lab/firearms_probe.mjs` runs timed fire, alt-fire, reload and
item presses so the server recorder logs what each did
(`features/fh-fhsw-open-issues/lab-firearms.md`).

## Where runs live

| | |
|---|---|
| `~/bf1942-lab/runs/<yyyymmdd-hhmmss>-<name>/` | `scenario.json`, `settings/` as rendered, `serverlog/ev_14568-*.xml`, `client/replay_*.ndjson`, `server.out`, `run.json` |
| `~/bf1942-lab/current.json` | the running server's pid and run |
| `viewer/replays/<run>/` | copies of the run's recordings and log for `map.html` (gitignored) |

Tests: `python3 -m unittest tests.test_lab`.
