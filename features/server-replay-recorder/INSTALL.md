# Installing the server recorder

The recorder is a library the game server loads at start. It writes every round
to a file under the server's `replays/` folder, from the server's own state,
and the map viewer plays those files. This page is for installing it on a
server. The lab's build and test steps are in the [README](README.md).

## What you need

- **`recorder.so`** from the latest `recorder-v*` release, with its
  `recorder.so.sha256`:

  ```bash
  gh release download recorder-v0.1.0 --repo sila-skandia/bfstats --pattern recorder.so --pattern recorder.so.sha256
  ```

  ```bash
  sha256sum -c recorder.so.sha256
  ```

- **A matching server build.** The recorder's memory addresses belong to one
  binary, `bf1942_lnxded.static`, with sha256
  `18237721d2bd92f7bd01902d127cfcb8771b62eea1813ae67de638462e55b2e6`. Check the
  file your server runs (`bf1942_lnxded` is usually a symlink to it):

  ```bash
  sha256sum <server root>/bf1942_lnxded.static
  ```

  On any other build, the recorder skips the hooks it can't place
  (`detour skipped` in the log) and the recordings are partial. Don't use it.

## 1. Turn recording on

Put one file in the server root, the directory the server runs from. It is the
same directory for every mod:

```
recordReplays 1
replaySampleHz 30
```

```bash
printf 'recordReplays 1\nreplaySampleHz 30\n' | sudo -u <server user> tee <server root>/recorder.con > /dev/null
```

Keep only this copy. A `recorder.con` under `mods/bf1942/settings/` takes
precedence over it. Without any `recorder.con`, the recorder logs
`no recorder.con; recording off` and does nothing else.

## 2. Start the server with `LD_PRELOAD`

Put `recorder.so` in the server root, then pick the launch method your server
uses.

### Run it by hand

```bash
cd <server root>
LD_PRELOAD=<server root>/recorder.so ./bf1942_lnxded +config ServerSettings.con +statusMonitor 0 +dedicated 1
```

### systemd standalone (`bf1942.service`)

Not tested yet. The unit runs `start.sh`, which `exec`s `bf1942_lnxded`, so the
environment set on the unit should reach the server. Add a drop-in:

```bash
sudo mkdir -p /etc/systemd/system/bf1942.service.d
```

```bash
printf '[Service]\nEnvironment=LD_PRELOAD=<server root>/recorder.so\n' | sudo tee /etc/systemd/system/bf1942.service.d/recorder.conf > /dev/null
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart bf1942.service
```

### BFSMD (`bfsmd-<name>.service`)

Tested on a BFSMD instance, 2026-10-13. `bfsmd.static` starts the server as a
child process, and the child inherits `LD_PRELOAD`. bfsmd itself doesn't load
the recorder. Add the drop-in to the instance's unit:

```bash
sudo mkdir -p /etc/systemd/system/bfsmd-<name>.service.d
```

```bash
printf '[Service]\nEnvironment=LD_PRELOAD=<instance root>/recorder.so\n' | sudo tee /etc/systemd/system/bfsmd-<name>.service.d/recorder.conf > /dev/null
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart bfsmd-<name>.service
```

## 3. Ports

The recorder doesn't set ports, and each server needs its own. The four keys in
`mods/bf1942/settings/serversettings.con` are `game.serverPort`,
`game.gameSpyPort`, `game.gameSpyLANPort` and `game.ASEPort`. A BFSMD instance
also has them in `servermanager.con`, along with `manager.consolePort`. The
installer writes these from the instance name.

## 4. Check it's recording

Once a round starts, the server log should show, in this order:

```
recorder: config recorder.con: recordReplays 1, 30 Hz
recorder: event queue hooked at 0812d730
... more hooks ...
recorder: recording to replays/replay_<unix>.ndjson
```

A hook that says `not the expected code, detour skipped` or `not hooked` means
the build doesn't match. For BFSMD, the journal tags the child's lines
`bfsmd.static[<pid>]`, which is the tag inherited at fork. Find the child's PID
with the command below, and match on that PID instead.

```bash
sudo journalctl -u bfsmd-<name>.service --since "5 min ago" | grep "recorder:" | head -n 5
```

```bash
sudo tr '\0' '\n' < /proc/$(pgrep -P $(systemctl show -p MainPID --value bfsmd-<name>.service) | head -n1)/environ | grep LD_PRELOAD
```

The file in `replays/` should grow while the round runs, at about 30 lines a
second. Once a minute the file gets a `perf` line. `faults 0` and `dropped 0`
mean the recording is healthy.

## Stopping and collecting

Stopping the service kills the server process. Whether the recorder then writes
its `end` record is not yet checked. A file without an `end` record is still
being written, or was cut short. Copy the file from `replays/` in the server root
to wherever you read recordings.

## Upgrading

Replace `recorder.so` by renaming a new file into place, not by copying over the
old one. A running server keeps the old copy mapped, and overwriting it can
crash the server. Then restart the server to load the new one.

```bash
cp recorder.so recorder.so.new && mv -f recorder.so.new <server root>/recorder.so
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No `recorder:` lines at all | `LD_PRELOAD` isn't reaching the server. Check the child's environment with the command above. |
| `no recorder.con; recording off` | `recorder.con` is missing from the server root, or it's in the wrong directory. |
| `not the expected code, detour skipped` | The server binary doesn't match the build. |
| BFSMD: no lines under `bfsmd.static` | Expected. Look for the child's PID. |
| Files are missing, or `faults` is above 0 | Check the server log for `faulted` lines, and the build. |
