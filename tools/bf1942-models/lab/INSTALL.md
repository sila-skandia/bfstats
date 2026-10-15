# Installing the parity lab

The lab is a private BF1942 dedicated server for real-game runs. Installing it
builds a copy of the LAN server (`server1`) that the lab can start and stop.
`server1` itself is never changed. Once installed, see [README.md](README.md)
for running scenarios.

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

## Environment overrides

`BF42_LAB`, `BF42_SERVER_SRC`, `BF42_GAME_DIR`, `BF42_MONITOR` and
`BF42_VIEWER_URL`.

## Troubleshooting

| Message | Fix |
|---|---|
| `no server install at ... (set BF42_SERVER_SRC)` | `server1` is not where the lab expects. Point `BF42_SERVER_SRC` at its install. |
| `... exists; setup --force rebuilds it` | The install is already there. Use `--force` only after `server1` changes. |
| `a lab server is running; stop it first` | `setup --force` needs no live run. Run `python3 lab/lab.py stop` first. |
