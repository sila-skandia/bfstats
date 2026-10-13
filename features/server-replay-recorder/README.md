# Server-side round replay recorder

A library loaded into the BF1942 dedicated server that records a whole round
from inside it, as newline-delimited JSON in the bf42plus client recorder's
format. `tools/bf1942-models/viewer/replay-recording.js` plays its files as it
plays a client's.

The client recorder (bf42plus `recordReplays`) sees a round through one
connection: what is near that player. The server recorder reads the one
authoritative world, for every player and bot, 30 times a second, and also
records what no client is sent: projectile flights, AI fake fire and each
bot's AI level of detail.

This file is the state of play. How it got here, with the measurements and
dead ends, is under [research/](research/README.md).

## Status

| target | state |
|---|---|
| Linux server, `bf1942_lnxded` (`recorder.so`) | Works. Checked against a client recording of the same round, and soaked for 13 hours. The 2026-10-12 fixes are covered by the test harness and have not yet run in a live round ([Open](#open)). |
| Windows server, `BF1942_w32ded.exe` (`WINMM.dll`) | Not usable. Builds, but a code review found it would crash the server on the first roster walk, and the DLL cannot load on real Windows ([Windows target](#windows-target)). |

The addresses are those of the lab's `bf1942_lnxded`. Another build of the
server needs its own table.

## Build, turn on, run

```bash
./build.sh
```

builds `build/recorder.so` and installs it as `~/bf1942-lab/server/recorder.so`
(a new file renamed into place, so a running server keeps the copy it
loaded), then builds `build/WINMM.dll`.

Recording is off unless `recorder.con` in the server install's root directory
(the working directory the server runs from) says so. The recorder reads that
one file for every mod. A copy under `mods/bf1942/settings/` takes precedence
over it, so keep only one. `lab.py setup` writes the root copy:

```
recordReplays 1
replaySampleHz 30
```

`replaySampleHz` is rounded to a whole number of the server's 30 Hz ticks
(30, 15, 10). The recorder reads this file itself, so the server's own
config parser never sees the keys. `RECORDER_DEBUG=1` in the environment
prints a diagnostic line every 5 s.

The lab loads it through a scenario's `preload` key; every
`tools/bf1942-models/lab/scenarios/*-rec.json` has one:

```bash
cd tools/bf1942-models
python3 lab/lab.py start lab/scenarios/wake-coop-rec.json --wait 0
python3 lab/lab.py stop
```

Files land in `replays/replay_<unixts>[-<n>].ndjson` under the server's
working directory, one per round. `lab.py stop` copies them into the run
directory and prints a viewer link. Joining with a client is in the
`bf1942-server-lab` skill.

A healthy start prints, in the run's `server.out`, a line for each hook that
went in, ending with `recorder: chat hook in GameServer::handleChatMessage's
slot 0871b20c`.

## Turning it on for each install

Every setup needs the same three things: `recorder.so`, `recorder.con` in the
server's root directory, and the server started with `LD_PRELOAD` pointing at
the `.so`. Only the launch differs. The release build is attached to the
`recorder-v*` GitHub releases; its sha256 is in the release notes.

The recorder's addresses match one server build, `bf1942_lnxded.static` with
sha256 `18237721d2bd92f7bd01902d127cfcb8771b62eea1813ae67de638462e55b2e6`.
Check it with `sha256sum` before recording. On any other build the hooks are
skipped and the recording is partial.

The server root is the directory the server runs from (the install root, not
`mods/<mod>/`). The recorder reads `recorder.con` from there for every mod.
A copy under `mods/bf1942/settings/` takes precedence, so keep only one:

```bash
printf 'recordReplays 1\nreplaySampleHz 30\n' | sudo -u bf1942_user tee <server root>/recorder.con > /dev/null
```

Recordings go to `replays/` under the server root, one file per round.

### Direct

Run the binary from a shell with `LD_PRELOAD` in front. This is what the lab
does, and it is the only route verified in the lab's runs:

```bash
cd <server root>
LD_PRELOAD=<path>/recorder.so ./bf1942_lnxded +config ServerSettings.con +statusMonitor 0 +dedicated 1
```

### systemd standalone (`bf1942.service`)

Not yet tested. The unit runs `start.sh`, which `exec`s `bf1942_lnxded`, so
`Environment=` on the unit should reach the server. Put it in a drop-in:

```bash
sudo mkdir -p /etc/systemd/system/bf1942.service.d
printf '[Service]\nEnvironment=LD_PRELOAD=<path>/recorder.so\n' | sudo tee /etc/systemd/system/bf1942.service.d/recorder.conf > /dev/null
sudo systemctl daemon-reload && sudo systemctl restart bf1942.service
```

Standalone uses the default ports (game 14567). A second server on the same
machine must set its own ports first (see below).

### BFSMD (`bfsmd-<name>.service`)

Verified on `recorder-test`, 2026-10-13. `bfsmd.static` forks `bf1942_lnxded`
as a child, and the child inherits `LD_PRELOAD`. bfsmd itself does not load the
recorder. Put the drop-in on the instance's unit:

```bash
sudo mkdir -p /etc/systemd/system/bfsmd-<name>.service.d
printf '[Service]\nEnvironment=LD_PRELOAD=<instance root>/recorder.so\n' | sudo tee /etc/systemd/system/bfsmd-<name>.service.d/recorder.conf > /dev/null
sudo systemctl daemon-reload && sudo systemctl restart bfsmd-<name>.service
```

The journal tags the child's lines `bfsmd.static[<pid>]`, because the child
inherits that name at fork. Match on the child's PID, not the tag:

```bash
sudo journalctl -u bfsmd-<name>.service --since "5 min ago" | grep "recorder:" | head -n 5
sudo tr '\0' '\n' < /proc/$(pgrep -P $(systemctl show -p MainPID --value bfsmd-<name>.service) | head -n1)/environ | grep LD_PRELOAD
```

### Ports

The recorder doesn't pick ports. The server does, from four keys in
`mods/bf1942/settings/serversettings.con`: `game.serverPort`,
`game.gameSpyPort`, `game.gameSpyLANPort` and `game.ASEPort`. A BFSMD instance
also has them in `servermanager.con`, along with `manager.consolePort`. The
installer writes these from the instance name. Two servers on one machine
need different values for all four.

### Stopping

Stopping the service stops the server process, and the readme's logging notes
say a stop or restart kills it hard. Whether the recorder writes its `end`
record then has not been checked. A file without one is still being written,
or was cut short. `lab.py stop` reports such a recording as `(still open ...)`.

## The source

| file | what is in it |
|---|---|
| `src/core.c` | Everything that does not depend on the binary: config, the sampler, the object tracker, the event decoders, the held-event buffer, chat, projectile pools, the output queue and the JSON writers. |
| `src/core.h` | The contract a target fills in: `struct rec_target`, one field per address or offset, plus the platform functions (safe read, clock, locks, detour install). |
| `src/target_lnxded.c` | The Linux server: its table (`lnxded_target`), the four inline detours and their assembly stubs, and the entry constructor. |
| `src/target_w32ded.c` | The Windows server: its table, the proxy `WINMM.dll` entry and its detours. |
| `tests/core_harness.c`, `tests/run.sh` | A fake server in memory that drives the core; see [Tests](#tests). |
| `build.sh` | Builds both targets. |

Every function has a short comment saying what it does and which thread or
lock it needs. Every row of a target table names the game function the
value was read from.

## How it captures

Two kinds of thing are recorded, by different means.

**The world is sampled.** After every simulated tick the recorder walks the
server's live objects and the player list, and writes what changed: where
each object is, hit points, turrets and other moving parts, engines,
soldiers' aim and animation states, who sits in which seat, control points,
tickets, projectiles in flight. It runs on the game thread, which owns the
world and is not changing it at that moment, so reads are plain loads with
no locking.

**Discrete moments are hooked.** Joins, kills, kit pickups, chat and shots
happen between samples, so the recorder patches the functions they pass
through.

| hook | how | what it gives |
|---|---|---|
| `GameServer::simulateFrame` | vtable slot `0x0871b228` | The clock: run the tick, then sample |
| `ObjectManager::registerObject` / `unregisterObject` | vtable slots `0x087204e0` / `0x087204e4` | The set of live objects, so a sample need not walk all ~5,000 registered ones |
| `GameEventManager::addEventToSendQueue` | inline detour at `0x0812d730` | Every game event queued for a client |
| `GameServer::sendGameEventToAll` | inline detour at `0x08153b10` | Every to-all event once, before it fans out |
| `GameServer::destroyObject` | vtable slot `0x0871b13c` | An object's end, also when no client is connected |
| `GameServer::handleChatMessage` | vtable slot `0x0871b20c` | Each chat line, whole, once |
| `FireArms::fireBarrel` | inline detour at `0x0828aba0` | Every round a player or bot fires |
| inside `FireArms::Fire`, past the fake-fire test | inline detour at `0x0828a230` | A distant bot's shot, for which the server makes no projectile |

A vtable hook replaces one pointer and calls the original through the saved
value. An inline detour overwrites the first bytes of a function with a
jump to a stub, which calls the recorder and then runs the displaced bytes
from a trampoline. Either way the bytes at the site are compared with what
the table expects first; on a mismatch that hook is skipped and the rest
still go in.

### Why not record the network instead

Each client has one UDP connection, and each datagram is shared by four
stream managers: game events, object state ("ghosts"), the player's input,
and file download. Events are small typed messages. Object state is not: for
each client the server sends only the objects near that player, only the
fields that changed since that client's last acknowledgement, quantised and
bit-packed, within about 1 KB per send.

So a tap on the send path gives one player's range-limited, lossy view per
connection, needs a decoder for each of 13 object classes, and gives nothing
when nobody is connected. Reading the object in memory after the tick gives
the same fields before any of that happens, for every object, at full
precision. bf42plus does the equivalent on the client: it reads the world
after the game has applied the updates. The measurements behind this are in
[research/03](research/03-send-path-review.md) and
[research/04](research/04-best-capture-and-parity-round.md).

### Events

The event hook is called once per connection, so a kill with three players
online arrives three times. The recorder compares each payload with the last
16 and writes it once.

Some records are made two ways: from the server's event when a client is
connected, and from the sample when none is (`createPlayer`, `control`,
`pickupKit`, `projPool`, `destroyObject`). Whichever arrives first is
written; the other is dropped. The last kit and controlled object written
for each player are remembered for this, and forgotten when that object is
destroyed or the player leaves.

Events that arrive while no file is open (between rounds, during a join) are
held and written at t 0 of the next file. Held events are state, the latest
of each, at most 1,024 with the oldest dropped first:

| held | one kept per | withdrawn by |
|---|---|---|
| `setLevel`, `gameRules`, `serverInfo`, `serverName`, `challenge`, `gameStatus`, `dbComplete` | type | |
| `createPlayer`, `setTeam`, `control`, `pickupKit`, `enterVehicle` | type and player | the player's `destroyPlayer`; `exitVehicle` for the seat |
| `createObject`, `projPool` | type and net id | a `destroyObject` on the id |

Moments are not held: `clock`, `simStart`, `score`, chat and `radio`.

### Chat

A chat line reaches clients as 15-character pieces, sent on every connection
except the sender's. A lone player's line is therefore sent to nobody, and
with several players each piece arrives once per receiver. The recorder
takes the line where the server handles it whole,
`GameServer::handleChatMessage`, and writes the client recorder's record:

```
{"k":"chat","t":12.345,"pid":5,"team":1,"text":"Alpha Dog: hello all"}
```

`text` is the line as a chat box shows it: `Name: line`, `Name [axis]: line`
or `Name [allies]: line` on the sender's side's channel, and the line alone
for the server's own (`pid` -1). Where the chat slot is not hooked, the line
is assembled from its pieces instead.

## What it writes

Format v5, the client recorder's. The header's `plus` is
`server-replay-recorder/3`. Per-sample kinds are one line per sample holding
every entry that changed.

| `k` | what |
|---|---|
| `h` | Header: format version, recorder, start time, sample rate |
| `o` | An object first seen: net id, template. Its `s`, and `a` if it has armor, follow in the same sample |
| `s` | Position and rotation, `[id, x, y, z, qx, qy, qz, qw]`, on change |
| `a` | Hit points and last player to hit it, on change |
| `d` | An object gone |
| `jn` / `j` | A moving part named (turret, gun mount, propeller, wheel), then its rotation on change |
| `g` | An engine: revs, throttle, flags, gear |
| `st` | A soldier: lower and upper animation state, aim pitch, torso twist, held item, state bits |
| `anim` | The animation state table, `[index, name, flags]`, once a file |
| `p` | A player's seat: `[pid, team, vehicle, root, seat, triggers]`, on change |
| `lod` | A bot's AI level of detail, `[pid, lod]`, on change |
| `cp` | Control points: id, name, template, place, team; then team changes |
| `tk` | Tickets, `[team 1, team 2]`, on change |
| `pn` / `pj` / `pd` | A projectile's flight: named, placed each sample, ended |
| `f` | A shot: firing object, player, weapon template, muzzle position and direction; `"fake":1` for AI fake fire |
| `e` | A game event, named in `e` (list below) |
| `chat` | A chat line |
| `perf` | Once a minute: the sample's and the server's tick cost, object counts, faults, dropped output |
| `end` | The file closed cleanly |

Events written as `e`: `createPlayer`, `destroyPlayer`, `setTeam`, `control`,
`pickupKit`, `enterVehicle`, `exitVehicle`, `createObject`, `destroyObject`,
`projPool`, `score` (kills name the weapon), `radio`, `chat` (the raw
pieces), `gameStatus`, `gameRules`, `clock`, `simStart`, `setLevel`,
`serverInfo`, `serverName`, `challenge`, `dbComplete`. The case for each in
`emit_event_json` (`src/core.c`) says when the server sends it and how its
payload is laid out.

Against a client file of the same round, a server file has every object on
the map rather than those in range, at 30 Hz rather than about 10, and adds
`lod`, `pn`/`pj`/`pd`, `fake` shots and `perf`. It writes one `f` per barrel
where the client writes one per trigger pull. It lacks the client's
`hitFrom` and `roundStats`. The viewer skips `pn`/`pj`/`pd` and `perf`
today.

A value that is not a number (NaN, infinite) leaves its entry out rather
than breaking the line.

## What it reads

The values the sampler reads, for the Linux server. `lnxded_target` in
`src/target_lnxded.c` is the authority: each row there carries the address
of the accessor or constructor it was read from.

**Globals**

| what | address |
|---|---|
| `objectManager` | `0x0871dc24` |
| `objectTemplateManager` | `0x0871dc28` |
| `playerManager` | `0x0871dc2c` |
| `scoreManager` | `0x0871bb58` |
| `dice::bf::setup` (level name `+0x23c`, game mode `+0x240`) | `0x08716b64` |
| `activeAnimationStateMachine` (states `+0x10`, names `+0x41c`) | `0x0873fc9c` |
| `IBotManager::instance` | `0x0874ffe8` |

**Classes, recognised by vtable pointer** (a gcc vptr is the symbol + 8)

| class | vptr |
|---|---|
| `RotationalBundle` (turret, propeller, gun mount) | `0x08724e08` |
| `Engine` | `0x0872bc68` |
| `PhysicsEngine` | `0x0872d608` |
| `BFSoldier` | `0x0872f048` |
| `BFSoldierTemplate` | `0x0872eec8` |
| `ControlPoint` | `0x0872f948` |
| `Projectile` | `0x0873f2c8` |
| `FireArms` / `HandFireArms` | `0x08730da8` / `0x087318c8` |
| `ScoreManager` | `0x0871c008` |
| `BotManager` | `0x0874f768` |

**Fields**

| object | fields |
|---|---|
| Registered-object map (`ObjectManager+0x94`) | An SGI-STL red-black tree: header pointer `+0x94`, count `+0x98`; node parent `+4`, left `+8`, right `+0xc`, key `+0x10`, object `+0x14` |
| Any object | flags `+0x04`, registry key `+0x48`, template `+0x4c`, parent `+0x50`, networkable `+0x68` (its u16 net id at `+4`), transform `+0x74` (a 4x4 matrix, position last), component map `+0xb8` |
| Template | name `+0x08`, id `+0x10` |
| `Armor` (component key `0xc4a4`) | hit points `+0x38`, max `+0x3c`, critical damage `+0xf0`, last player to hit `+0x14` |
| `Engine` | its `PhysicsEngine` `+0x60` (revs `+0xa0`, gear `+0xbc`), throttle `+0x124`, running `+0x142`, disabled `+0x143` |
| `BFSoldier` | aim pitch `+0x284`, torso twist `+0x288`, lower animation state `+0x2b4`, upper `+0x2f8`, held item `+0x3b8`, state bits `+0x3e6`, kit id `+0x408` |
| Player list (`playerManager+0xc`) | node: next `+0`, `BFPlayer` `+8` |
| `BFPlayer` | name `+0x44`, seat object `+0x4c`, seat index `+0x54`, id `+0x58`, soldier or free camera `+0x68`, camera `+0x74`, is-bot `+0x78`, team `+0x7c`, fire and alt-fire `+0x148` / `+0x149`. `+0x0c` is the network id, not the player id |
| `ScoreManager` | a team's score at `+0x10 + team * 0x50`, tickets `+0x48` within it |
| `ControlPoint` | team `+0x174`; its template's name `+0x1e4` |
| `FireArms` | projectile template `+0x194`, pool `+0x1d8`, pool count `+0x1e4`, fake-fire flag `+0x295` |
| `BotManager` | bots `+0x20`, by-player-id table `+0x38`; a bot's AI level of detail `+0x10` |
| `ChatMessage` | target `+0` (0 is the sender's side only), text `+4`, length `+0x48`, sender's player id `+0x4c` |

## Safety

The recorder runs inside a live server, on its game thread.

- **A bad read ends the sample, not the server.** A SIGSEGV or SIGBUS on the
  game thread inside a sample jumps back to the tick entry and the server
  runs on. After 64 faulted samples in one file the recorder closes the file
  with its `end` record and stops. Hooks outside a sample read through
  `/proc/self/mem`, which fails instead of faulting.
- **Nothing is patched unseen.** Every hook site is checked against the
  expected bytes or pointer before it is changed.
- **Output never blocks the game.** Lines are built in memory on the game
  thread; a writer thread swaps the buffer out every 250 ms and writes it.
  The buffer is capped at 64 MB, past which lines are dropped and counted.
- **Tables are bounded.** 8,192 tracked objects, 1,024 held events, 64
  characters a chat line, 64 steps for a tree walk.
- **Off means off.** With no `recordReplays 1` the library reads its config
  and does nothing else: no allocation, no patch, no thread.

## Cost

The sample's time on the game thread, from `perf` lines:

| round | recorder per sample | server's own tick |
|---|---|---|
| El Alamein, 30 bots, no human | 100 us mean, 430-810 us worst | 720-860 us |
| the same with a human flying | 225-265 us mean, about 1.1 ms worst | 2.4-2.9 ms |
| 13-hour soak, 7 rounds | 87-269 us per-minute means, one 14 ms worst sample | 0.6-2.4 ms |

About 0.3 to 0.8% of one core. Most of what is left is number formatting.

## How it was checked

- **Against a client recording of the same round** (El Alamein, a human
  flying a BF109 for 2.7 minutes): vehicles and soldiers agree to 5-9 cm at
  the median and aircraft to about 0.4 m, once the client's 0.12 s display
  lag is allowed for. Seat changes, tickets, control points and the
  1,395-entry animation table are identical. Body states agree about 90%,
  the rest being transition timing.
- **Soak:** 13 hours, seven rounds, zero faults, zero dropped output, every
  line valid JSON.
- **Bots-only rounds:** every real shot has a projectile flight within
  0.1 s; every projectile pool is destroyed by the round's end with no net
  id reused without a `destroyObject` between.

The numbers and run directories are in
[research/05](research/05-tick-recorder-build-log.md).

## Tests

```bash
tests/run.sh
```

builds `tests/core_harness.c`, a fake server laid out in memory, and drives
the core through it. It does not touch the lab's installed `recorder.so`.

| check | what it covers |
|---|---|
| thread mode and tick mode | Events held and written at t 0, the join's events, fan-out to several clients written once, projectile pools, a new file when the level unloads, chat from pieces |
| tick mode, live set | The register/unregister set, pools written again in the next file, destroys through the hooked slot |
| tick mode, world | Root objects, armor, a roster and the chat slot: pose at first sight, turns near yaw 90, net id reuse, non-number floats, the fault budget, kit and control repeats |
| as the viewer reads it | The world file through the viewer's `parseRecording` (needs node) |
| lnxded target | `target_lnxded.c` compiles with `build.sh`'s flags; a string at the end of a memory mapping is read |

Not covered: moving parts, soldiers' states, control points, projectile
flights and tickets through the sampler, and anything in
`target_w32ded.c`.

## Windows target

`build/WINMM.dll` is a proxy the exe's loader picks up from the server's own
directory. The object walk, transforms and template names (the first stage)
ran under Wine. The rest was written from static analysis and has not run.
A code review on 2026-10-12 found:

- **It crashes the server.** `BFPlayer::getName` is called with the wrong
  calling convention, which corrupts the stack and a byte of the player's
  vtable pointer on the first roster walk that sees a player.
- **It cannot load on real Windows.** The exe imports `timeGetTime` from
  `WINMM.dll` by name and the proxy exports no winmm function. Wine stubs
  the import, which is why it loaded there.
- **Player fields are wrong.** `bf_id_off = 0xc` reads the network id, the
  AI accessor returns the player id, and the vehicle and camera offsets are
  swapped.
- **Long names read as empty.** The string reader looks at the wrong offset
  for names of 16 characters or more.
- It still polls from a sampler thread, and has no pool reads, destroy hook
  or chat hook.

None of this is fixed. Its offsets and how they were derived are in
[research/w32ded-offsets.md](research/w32ded-offsets.md), the port's history
in [research/02](research/02-windows-port.md).

## Open

To confirm in a live round (the 2026-10-12 changes have only met the
harness):

- The chat hook goes in, and a typed line gives one `chat` record with the
  typist's name, `pid` and side; a team line carries ` [axis]` or
  ` [allies]`; a console `game.sayAll` is `pid` -1.
- The chat pieces' fields (`first`, `total`, `global`) with a second client
  connected. They have never met real server data.
- Every `o` is followed by an `s` for that id in the same sample, and the
  viewer draws dropped kits, unmanned guns and flags.
- A file after a round change has no `clock` at t 0 carrying the old round's
  time, and one `createPlayer` per player.

Known gaps:

- A round that hits inside one tick (a rifle at close range) has an `f` and
  no flight. A hook on projectile creation would give it one.
- The viewer does not draw the server's projectile flights (`pn`/`pj`/`pd`).
- A server line sent to one client (`GameServer::sayClient`) does not pass
  the chat handler and is not written.
- Where chat is assembled from pieces (no chat hook), receivers more than
  0.4 s out of step lose the line, and a whole line apart write it twice.
- The recorder's `t` is `CLOCK_MONOTONIC`, which stops while the host is
  suspended.
- A file has no `end` record when the server restarts its process for the
  next map; `gameStatus` 5 is flushed to disk first.
- A real `FloatingMine` pool has not been recorded: the lab has no co-op
  level with PT boats.
- One run of `tests/run.sh` in 60 failed its first check (a `gameStatus`
  expected at t 0) and did not recur; the cause is not found.
