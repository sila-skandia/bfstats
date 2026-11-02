# Installing the server recorder

The recorder is a library the game server loads at start. It writes every round
to a file under the server's `replays/` folder, from the server's own state,
and the map viewer plays those files. This page is for installing it on a
server. The lab's build and test steps are in the [README](README.md).

Linux servers (`bf1942_lnxded`) start below. Windows servers
(`BF1942_w32ded.exe`) are in [Windows server](#windows-server).

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

Two more keys are on unless set to 0: `recordHits` (each hit the server
counts toward a player's accuracy) and `recordImpacts` (each projectile's
impact point). Add `recordHits 0` or `recordImpacts 0` to leave either out.

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
recorder: config recorder.con: recordReplays 1, 30 Hz, recordHits 1, recordImpacts 1
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

## Windows server

The Windows build is `WINMM.dll`. It is experimental: it has run under Wine
in the lab, not yet on a real Windows host. It records objects, players and
the game's events. Shots, hits, impacts, chat lines and some vehicle detail
come only from the Linux build for now.

It is built so that it cannot take the server down. Its reads fail instead
of faulting, and a fault anywhere in its own code ends that pass, not the
server. After 64 faults in one round's file it stops recording. On any exe
other than the one it was built for, it records nothing and only passes the
server's winmm calls through.

### What you need

- **`WINMM.dll`** and `WINMM.dll.sha256` from the latest `recorder-v*`
  release. In PowerShell, check the file with:

  ```powershell
  (Get-FileHash WINMM.dll -Algorithm SHA256).Hash
  ```

  and compare the hash with the one in `WINMM.dll.sha256`.

- **`BF1942_w32ded.exe` version 1.61**, md5
  `1f75eb8b55ab5bb4d6782dd6f3be2e45`:

  ```powershell
  (Get-FileHash BF1942_w32ded.exe -Algorithm MD5).Hash
  ```

  It needs nothing else: no runtime to install. It uses only `kernel32.dll`
  and `msvcrt.dll`, which every Windows has.

### Install

1. Stop the server.
2. Copy `WINMM.dll` into the folder that holds `BF1942_w32ded.exe`. Windows
   loads a dll from the program's own folder before the system's, so the
   server picks it up with no other change. Every winmm call the server
   makes still goes to the system's `winmm.dll`.
3. Put `recorder.con` in the same folder:

   ```
   recordReplays 1
   replaySampleHz 30
   ```

   A `recorder.con` under `Mods\bf1942\Settings\` takes precedence over it.
4. Start the server as usual.

### Check it's recording

The recorder writes `recorder.log` beside the exe. Once the first level
loads, it should hold:

```
recorder: config recorder.con: recordReplays 1, 30 Hz, recordHits 1, recordImpacts 1
recorder: detour at 00478490
recorder: detour at 00471090
recorder: writer and sampler threads started
recorder: recording to replays/replay_<unix>.ndjson
```

The file in `replays\` should grow while the round runs, one file each
round.

| `recorder.log` says | meaning |
|---|---|
| `this exe ... is not BF1942_w32ded.exe 1.61` | Another server version. Nothing is recorded; the server runs as it would without the dll. |
| `no recorder.con; recording off` | `recorder.con` is missing or in the wrong folder. |
| `not the expected code, detour skipped` | The exe is patched. Objects and players are still recorded, game events are not. |
| `fault ... caught` | A read or hook was cut short and the server ran on. A few over a long session are harmless. |
| `faults in one file, recording stopped` | Recording is off until the server restarts. Send the log and the file. |
| no `recorder.log` at all | The dll is not in the exe's folder, or the folder is not writable. |

### Remove it

Stop the server and delete `WINMM.dll` (and `recorder.con` if you like). To
upgrade, stop the server, replace the file, and start it again; a running
server holds the dll open.
