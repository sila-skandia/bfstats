# Installing the parity lab

The lab is a private BF1942 dedicated server for real-game runs. Installing it
builds a copy of the LAN server (`server1`) that the lab can start and stop.
`server1` itself is never changed. Once installed, see [README.md](README.md)
for running scenarios.

This page is the Linux PC's install; a Mac's is [On a Mac](#on-a-mac).

## Requirements

- The `server1` install at `/home/bf1942_user/instances/server1` (set
  `BF42_SERVER_SRC` if it lives elsewhere).
- The Wine BF1942 client at `~/.wine/drive_c/EA Games/Battlefield 1942`
  (`BF42_GAME_DIR`).
- The bf1942-monitor collector at `~/.wine/bf1942-monitor/collector/bf1942-monitor.sh`
  (`BF42_MONITOR`).
- Python 3, run from `tools/bf1942-models/`.
- Ports 14568, 22001, 23001 and 14724 free while a run is live.

## Install

From `tools/bf1942-models/`:

1. Build the lab install from `server1`:

   ```sh
   python3 lab/lab.py setup
   ```

2. Optional: add a mod that `server1` does not have, linked from the Wine client:

   ```sh
   python3 lab/lab.py setup --mods-from-client DesertCombat
   ```

3. Check it. `status` should report that no run is live:

   ```sh
   python3 lab/lab.py status
   python3 -m unittest tests.test_lab
   ```

## After `server1` changes

Rebuild the install so the settings template matches `server1`. This needs no
run to be live:

```sh
python3 lab/lab.py setup --force
```

`--force` keeps the mods that `SOURCE.json` lists, so the client mods survive
the rebuild.

## What setup writes

| Path | Contents |
|---|---|
| `~/bf1942-lab/server/` | The server binary and `lib/` copied from `server1`. Each mod's `archives/` is linked to `server1`'s. |
| `~/bf1942-lab/server/mods/<mod>/` | Client mods from `--mods-from-client`: a lower-case tree of links to the client's `.con`, `.dat` and `.rfa` files. Nothing is copied, and the client install is never written. |
| `~/bf1942-lab/server/settings-template/` | Settings snapshotted from `server1` at setup, without bfsmd's files and the remote console password. |

A mod is linked this way because the 1.6 Linux server lower-cases every path
before it opens it (`readmes/readme-linux.txt` in `server1`).

## On a Mac

Neither server needs `server1`: the Linux one comes from the tarball
hootmeow/bf1942-linux's installer downloads, and runs in an emulated x86_64
Linux VM; the Windows one is the client install's, and runs in CrossOver.

### Requirements

- CrossOver, with a bottle named `BF1942` holding the game at
  `C:\EA Games\Battlefield 1942`, and `BF1942_w32ded.exe` 1.61 and
  `bfcprt.dll` beside it (the MoonGamers installer puts both there).
- Homebrew's `colima`, `docker`, `qemu` and `lima-additional-guestagents`
  (the last lets Lima run an x86_64 guest on Apple silicon):

  ```sh
  brew install colima docker qemu lima-additional-guestagents
  ```

- `gh`, signed in, for the recorder's release.

### Install

From `tools/bf1942-models/`:

1. Fetch and unpack the Linux server. This is the BFSMD tarball the
   installer uses; its `bf1942_lnxded.static` is the build the server
   recorder is for (sha256 `18237721d2bd92f7bd01902d127cfcb8771b62eea1813ae67de638462e55b2e6`).
   On a Mac, `lab.py` reads it from `~/bf1942-lab/linux-src` (`BF42_SERVER_SRC`).

   ```sh
   mkdir -p ~/bf1942-lab/downloads ~/bf1942-lab/linux-src
   curl -L -o ~/bf1942-lab/downloads/linux-bf1942-server-bfsm-hitreg.tar \
     https://files.bf1942.online/server/linux/linux-bf1942-server-bfsm-hitreg.tar
   tar -x --strip-components=1 -C ~/bf1942-lab/linux-src \
     -f ~/bf1942-lab/downloads/linux-bf1942-server-bfsm-hitreg.tar
   shasum -a 256 ~/bf1942-lab/linux-src/bf1942_lnxded.static
   ```

2. Build both installs. The first Linux command starts the `bf1942-lab-x86`
   VM and builds the image, a few minutes:

   ```sh
   python3 lab/lab.py setup
   python3 lab/lab.py --server windows setup
   ```

3. Put both builds of the server recorder where the scenarios' `preload`
   points, after `setup` (a `setup --force` of the Linux install removes them):

   ```sh
   cd ~/bf1942-lab/server
   gh release download recorder-v0.3.0 --repo sila-skandia/bfstats \
     --pattern 'recorder.so*' --pattern 'WINMM.dll*'
   shasum -a 256 -c recorder.so.sha256 && shasum -a 256 -c WINMM.dll.sha256
   ```

4. Check it: a recorded round on both servers at once.

   ```sh
   python3 lab/lab.py start lab/scenarios/wake-coop-rec.json --wait 0
   python3 lab/lab.py --server windows start lab/scenarios/wake-coop-rec.json --wait 0
   python3 lab/lab.py status; python3 lab/lab.py --server windows status
   python3 lab/lab.py stop; python3 lab/lab.py --server windows stop
   ```

   Each `stop` lists `server: server/replay_<unix>.ndjson`. On the Linux one,
   the run's `server.out` has the recorder's `... hooked at ...` lines; on
   the Windows one, `~/bf1942-lab/server-w32/recorder.log` lists its seven
   detours.

### What it makes

| | |
|---|---|
| Colima profile `bf1942-lab-x86` | an x86_64 VM emulated by QEMU: 4 CPUs, 4 GiB, a 30 GiB disk, the home folder mounted (9p), and the grpc port forwarder, which carries UDP. `colima delete -p bf1942-lab-x86` removes it. The default Colima VM is not touched. |
| `bf1942-lab-linux` image and container | in that VM, made again when the `Dockerfile` or the mounts change; the repo, `~/bf1942-lab` and the game folder are mounted at their own paths |
| `~/bf1942-lab/server/`, `~/bf1942-lab/server-w32/` | the two installs |
| the bottle's registry | `AppDefaults\BF1942_w32ded.exe\DllOverrides`, `winmm=native,builtin`, set at a recorded Windows start |

## Environment overrides

`BF42_LAB`, `BF42_SERVER_SRC`, `BF42_GAME_DIR`, `BF42_MONITOR` and
`BF42_VIEWER_URL`. `BF42_LAB_SERVER` (`linux` or `windows`) is the default
for `--server`, `BF42_W32_EXE` the Windows server's exe and `BF42_WINE` the
wine that runs it. On a Mac also `BF42_CROSSOVER`, `BF42_CX_BOTTLE`,
`BF42_COLIMA_PROFILE` and `BF42_LAB_CONTAINER`.

## Troubleshooting

| Message | Fix |
|---|---|
| `no server install at ... (set BF42_SERVER_SRC)` | `server1` is not where the lab expects. Point `BF42_SERVER_SRC` at its install. |
| `... exists; setup --force rebuilds it` | The install is already there. Use `--force` only after `server1` changes. |
| `a lab server is running; stop it first` | `setup --force` needs no live run. Run `python3 lab/lab.py stop` first. |
| `no BFCPRT.dll beside ...` | The Windows server imports it. Copy it from the game folder beside `BF1942_w32ded.exe`. |
| A Windows run with no `recorder.log` | The recorder did not load. `start` sets `winmm=native,builtin` for the exe; check its warning, and `WINMM.dll` in `~/bf1942-lab/server-w32/`. |
| Mac: `no answer from 127.0.0.1:14568`, or the game stuck connecting | The emulated Linux server is still loading the level (about 25 s). Join once `start` reports the round, or in the scenario's pregame after that. |
| Mac: `lab.sh: the bf1942-lab-x86 VM is not x86_64` | A profile of that name was made for arm64. `colima delete -p bf1942-lab-x86` and run the command again. |
| Mac: every recorder detour `skipped` | The server ran in an arm64 VM, under user-mode emulation, where `/proc/self/mem` cannot read it. Use the x86_64 VM `lab.sh` makes. |
