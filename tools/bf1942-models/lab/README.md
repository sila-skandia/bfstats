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

## Two servers

`--server windows`, before the command, runs the Windows dedicated server,
`BF1942_w32ded.exe` 1.61, under Wine instead of the Linux one, so a scenario
can be recorded on both (the server recorder has a build for each):

```sh
python3 lab/lab.py --server windows setup
python3 lab/lab.py --server windows start lab/scenarios/wake-coop-rec.json
python3 lab/lab.py --server windows stop
```

`BF42_LAB_SERVER=windows` does the same for every command. The two servers
run at once; each has its own install, state, name and ports:

| | Linux | Windows |
|---|---|---|
| install | `~/bf1942-lab/server/` | `~/bf1942-lab/server-w32/` |
| state | `current.json` | `current-w32.json` |
| server name | `bfstats-lab` | `bfstats-lab-w32` |
| ports | 14568, 22001, 23001, 14724 | 14569, 22002, 23002, 14725 |
| run folder | `runs/<stamp>-<name>/` | `runs/<stamp>-<name>-w32/` |

Both render a scenario from the same settings template and read the same
archives: `setup` links each install's to `BF42_SERVER_SRC`'s. The Windows exe
comes from the client install (`BF42_W32_EXE`, default
`<game dir>/BF1942_w32ded.exe`), with the `BFCPRT.dll` it imports; `setup`
warns when the exe is not the 1.61 build the recorder is for (md5
`1f75eb8b55ab5bb4d6782dd6f3be2e45`).

A scenario's `preload` of `recorder.so` gives the Windows server the
recorder's Windows build, `WINMM.dll` from the same folder, copied beside the
exe for the run and removed for a run without it. `start` also sets the exe's
Wine app default `winmm=native,builtin`, because CrossOver otherwise loads
its own winmm. A Linux-only shim in `preload` (`realfire.so`) stops a Windows
start, and `lowfd` is a Linux server fix the Windows server does not get.

The Windows server runs under `script`, whose transcript (its console
screen) is the run's `server.out`. It ignores SIGINT under Wine, so `stop`
sends SIGTERM, and it ends in about a second.

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

The server then listens on 14578.

FHSWEurope levels need `lab/lowfd`, which `start` builds (gcc -m32) and
preloads on every run. The server keeps every archive of its mod paths open
and opens its sockets after the level, so FHSWEurope leaves the game socket
at fd 1135, past select()'s 1024-bit fd_set; the overflow corrupted the
network thread's stack, and the first client to connect, the retail game's
too, crashed it in `NetServer::_update` +1312 (ledger NET-17). The shim moves
the sockets below 1024. A client joining testfield_fhsweu waits about 30 s
for the world dump (861 objects). Under a 1024 open-files limit, as server1
runs, an FHSWEurope level does not load at all: the server exits 0.

## On a Mac

Both servers run on a Mac, at once, from the same commands; installing is in
[INSTALL.md](INSTALL.md#on-a-mac), and why it is built this way is in
[`features/parity-lab/README.md`](../../../features/parity-lab/README.md), "The rig on a Mac".

- **The Windows server** is the CrossOver bottle's `BF1942_w32ded.exe`, run in
  that bottle with CrossOver's `wine` (`BF42_CX_BOTTLE`, default `BF1942`;
  `BF42_WINE` names another wine).
- **The Linux server**: `lab.py` hands `setup`, `start`, `status` and `stop` to
  `lab/linux-container/lab.sh`, which runs the same command in the
  `bf1942-lab-linux` container, in an x86_64 Colima VM of its own
  (`bf1942-lab-x86`). The first command starts the VM and builds the image
  (a few minutes); later ones go straight in. The VM emulates a whole x86
  machine, so the recorder works as on the PC; it keeps a 30-bot round in
  real time, but loading a level takes about 25 s, and a client that joins
  before that gets no answer. `summary` runs on the Mac itself.
- **Both join at `127.0.0.1`**: the Windows server is local, and the VM's
  port forwarder carries the Linux one's UDP ports to the Mac.
- **The client** is BF1942 in the same bottle: the join line names
  `lab/mac/bf1942-client.sh`, which starts it with the join arguments.
  Client recordings need `recordReplays = on` in the game folder's
  `bf42++.ini`.

## Where runs live

| | |
|---|---|
| `~/bf1942-lab/runs/<yyyymmdd-hhmmss>-<name>/` | `scenario.json`, `settings/` as rendered, `serverlog/ev_14568-*.xml`, `client/replay_*.ndjson`, `server/replay_*.ndjson`, `server.out`, `run.json`; a Windows run's folder ends `-w32` |
| `~/bf1942-lab/current.json` | the running Linux server's pid and run (`current-w32.json`: the Windows server's) |
| `viewer/replays/<run>/` | copies of the run's recordings and log for `map.html` (gitignored) |

Tests: `python3 -m unittest tests.test_lab`.
