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
| Linux server, `bf1942_lnxded` (`recorder.so`) | Works. Checked against a client recording of the same round, and soaked for 13 hours. The 2026-10-12 fixes are covered by the test harness and have not yet run in a live round ([Open](#open)). The `hg` and `i` records (2026-11-01) ran in a bots-only lab round, and so did the events it used to drop (`roundStats`, `hitFrom`, `special`; [How it was checked](#how-it-was-checked)), and the board's `ps`, `scoreTable` and the round's result on `gameStatus`. |
| Windows server, `BF1942_w32ded.exe` (`WINMM.dll`) | Not usable. Builds, but a code review found it would crash the server on the first roster walk, and the DLL cannot load on real Windows ([Windows target](#windows-target)). |

The addresses are those of the lab's `bf1942_lnxded`. Another build of the
server needs its own table.

## Build and run in the lab

```bash
./build.sh
```

builds `build/recorder.so` and installs it as `~/bf1942-lab/server/recorder.so`
(a new file renamed into place, so a running server keeps the copy it
loaded), then builds `build/WINMM.dll`.

For a deviation fit, build a separate copy with `-DREC_FIRE_INDEX=1` and
point a scenario's `preload` at it; never install it over `recorder.so`.
Each `f` then also carries the launch matrix's right and up rows (`ra`,
`rb`), all three rows and the point at full float precision, and `gi`, the
server's input index at `fireBarrel` (ledger DEV-14). `pj` places carry 4
decimals. `tools/bf1942-models/lab/dev_index_probe.mjs` has the commands.

Recording is off unless `recorder.con` in the server install's root directory
(the working directory the server runs from) says so. The recorder reads that
one file for every mod. A copy under `mods/bf1942/settings/` takes precedence
over it, so keep only one. `lab.py setup` writes the root copy:

```
recordReplays 1
replaySampleHz 30
recordHits 1
recordImpacts 1
```

`replaySampleHz` is rounded to a whole number of the server's 30 Hz ticks
(30, 15, 10). `recordHits` and `recordImpacts` are on unless set to 0; they
switch the `hg` and `i` records ([What it writes](#what-it-writes)), and with
both 0 their two detours are not installed. The recorder reads this file itself, so the server's own
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

## Installing it on a server

For server managers: getting `recorder.so`, turning recording on, the three
launch methods (run by hand, systemd standalone, BFSMD), ports, checks and
upgrading are in [INSTALL.md](INSTALL.md).

## The source

| file | what is in it |
|---|---|
| `src/core.c` | Everything that does not depend on the binary: config, the sampler, the object tracker, the event decoders, the held-event buffer, chat, projectile pools, the output queue and the JSON writers. |
| `src/core.h` | The contract a target fills in: `struct rec_target`, one field per address or offset, plus the platform functions (safe read, clock, locks, detour install). |
| `src/target_lnxded.c` | The Linux server: its table (`lnxded_target`), the eight inline detours and their assembly stubs, and the entry constructor. |
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
| `BFPlayer::addBulletsGivingDamage` | inline detour at `0x08054910` | Each hit the accuracy table counts (IMP-11): `hg` |
| `GameServer::handleCollisionForProjectile` | inline detour at `0x08153ba0`, wrapping the call | Each projectile collision, the `game.drawDebug` segment (IMP-9): `i`, written when the call returns |
| inside `GameServer::_giveDamage`, where a seat's player's hit octant is chosen | inline detour at `0x0814bd5e` | Every player's hit direction, bots' too (HFD-14): `hitFrom` with `pid` |
| `GameServer::triggerSpecialGameEvent` | inline detour at `0x081591a0` | Every player's depot refill, bots' too (NET-19): `special` with `pid` |

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
| `welcome` | type and the line's id | |
| `mapList` | type and the entry (its map, mode and mod) | |

Moments are not held: `clock`, `simStart`, `score`, chat, `radio`, `vote`,
`hitFrom`, `special`, `roundStats`, `sessionId` and `raw`.

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
| `ps` | A player's score board counters, `[pid, score, kills, deaths, ping, gold, silver, bronze]`, on change (below) |
| `bai` | A bot's active behaviour and Change target, `[pid, behaviour vptr, target handle, x, y, z, target net id]`, on change (lnxded tick mode only; below) |
| `cp` | Control points: id, name, template, place, team; then team changes |
| `tk` | Tickets, `[team 1, team 2]`, on change |
| `pn` / `pj` / `pd` | A projectile's flight: named, placed each sample, ended |
| `f` | A shot: firing object, player, weapon template, muzzle position and direction; `"fake":1` for AI fake fire |
| `hg` | A hit the server credits to a player's accuracy: `pid`, stat id `tid`, its template `tmpl` (below) |
| `i` | A projectile's collision: shooter `pid`, stat id `tid`, `tmpl`, fire origin `o`, impact point `p`, the hit object's root `obj`, `dmg` (below) |
| `e` | A game event, named in `e` (list below) |
| `chat` | A chat line |
| `perf` | Once a minute: the sample's and the server's tick cost, object counts, faults, dropped output |
| `end` | The file closed cleanly |

Events written as `e`: `createPlayer`, `destroyPlayer`, `setTeam`, `control`,
`pickupKit`, `enterVehicle`, `exitVehicle`, `createObject`, `destroyObject`,
`projPool`, `score` (kills name the weapon), `radio`, `chat` (the raw
pieces), `gameStatus`, `gameRules`, `clock`, `simStart`, `setLevel`,
`serverInfo`, `serverName`, `challenge`, `dbComplete`, and from 2026-11-01
`roundStats`, `hitFrom`, `special`, `welcome`, `vote`, `mapList`,
`sessionId` and `raw`. The case for each in `emit_event_json`
(`src/core.c`) says when the server sends it and how its payload is laid
out (NET-18..NET-20). One `e` is the recorder's own, read from the server
and sent to no client: `scoreTable` (below).

The 2026-11-01 records use the client recorder's names and fields (bf42plus
`replay.cpp` `decodeEvent` and its event cases), so the viewer reads them as
it reads a client's:

```
{"k":"e","t":180.2,"e":"roundStats","stat":"fired","pid":5,"rows":[{"tid":3001,"tmpl":"Mp40","n":13}]}
{"k":"e","t":28.2,"e":"hitFrom","pid":247,"dir":4,"strength":2}
{"k":"e","t":40.1,"e":"special","action":0,"pid":6}
{"k":"e","t":0,"e":"welcome","id":0,"text":"Welcome to bfstats-lab"}
{"k":"e","t":0,"e":"mapList","add":1,"map":"wake","mode":"conquest","mod":"bf1942"}
{"k":"e","t":61.0,"e":"vote","action":1,"type":0,"pid":5,"target":6,"yes":1,"required":2}
{"k":"e","t":3.0,"e":"sessionId","id":"_ClientID_3"}
{"k":"e","t":95.4,"e":"raw","type":30,"size":14,"raw":"0105"}
```

- `roundStats` (0x30 `destroyed`, 0x31 `fired`, 0x32 `hit`): every player's
  round tally, bots' included, from the to-all hook at the round's end: the
  server sends them to all with no client needed (NET-18).
- `hitFrom` and `special` go to one connection each, and the queue hook
  cannot tell whose, so the two detours above write them for every player
  with his `pid`, and the queue's copies are not written. A client file's
  copies have no `pid` (the recording player's own); the viewer takes a
  `pid` where one is given (`rec.hitsTaken`, `rec.refills`). Without the
  detours (the bytes at a site do not match) the queue's copy is written
  as the client writes it.
- `welcome`, `mapList` and `sessionId` reach the recorder only when a
  client joins (they go to the joining connection); each join writes them
  again.
- SetTempCamera 0x0E, FlagHolder 0x1E, ControlPointCaptured 0x25 and
  TriggerObjectSpawner 0x3B are the client recorder's `raw`: `type`,
  `size` with the 12-byte header, `raw` the payload in hex. Their fields'
  meanings are not read (sweep entries 15 and 16).

The score board and the round's result (2026-11-01, sweep entries 4 and 5;
no client recorder writes these):

```
{"k":"e","t":0.000,"e":"scoreTable","kill":1,"death":0,"tk":-2,"capture":10,"attack":2,"defence":5,"objective":5,"objectiveTk":-15}
{"k":"ps","t":503.112,"ps":[[245,0,0,2,0,0,0,0],[235,6,6,4,0,0,0,0]]}
{"k":"e","t":1570.531,"e":"gameStatus","status":2,"winner":1,"victory":1}
```

- `scoreTable` is the ScoreManager's points, its eight getters (`getDeath`
  0x08163840 .. `getObjectiveTK` 0x08163920, `+0x3c`..`+0x58`), the ones
  `scoreEvent` pays: once a file at the first sample, again when one
  changes. The viewer scores with it in place of the pack's table.
- `ps` is each player's own counters, bots' included: score `+0xc0`, kills
  `+0xa4`, deaths `+0xa0`, ping `+0x94` (the fields the server's GameSpy
  report reads, MEME-27) and the medal counters `+0xe8`, `+0xec`, `+0xf0`
  (`giveMedal`, ROUND-9), one entry a player whenever any of the seven
  moves, all of them in a new file's first sample. The server's own counters
  are the board's truth: on the 2026-11-01 Wake round 3 of 30 players had a
  team kill the server counted (`tks` 1 in its log) with no ScoreMsg 6
  heard, so a score paid from the recorded events was 2 high for them.
- `gameStatus` 2 and 5 carry the ScoreManager's `winner` (`+0x5c`: 1 Axis,
  2 Allies, 0 a draw) and `victory` (`+0x5d`, ROUND-6). The victory type is
  set after the status turns (ROUND-13), so a 2 is finished at the end of
  the tick it came in and stamped when it came; a 5 is written as it comes,
  for it is put on disk at once. The server's own event log, written on the
  way into 2, always says victory type 4.

`bai` names the behaviour by its vtable: the `BotBehaviour` that
`BotMain::getActiveBehaviour` 0x08525fd0 returns, its vptr the symbol of
`vtable for dice::bf::ai::BB<Name>` + 8 (`nm -C bf1942_lnxded.static`), 0
before the bot has a body. The target is `BotMain+0x198`, which a Change
plan's `ChangeVehicle` instruction sets every tick it runs (AI-138) and
`planExecution` clears otherwise (0xffffffff); while it is set the record
carries that unit's Information position (the seat object's absolute
position, the point the Change plan's distances are measured to) and its
object's net id, so the `o` records name the seat. The position is a call
into the game (`AIObject` vt+0x1c), so only tick mode writes it.
`features/fhsweurope-extraction` ("Rheinuebung's ship seats") reads it.

`hg` and `i` are the server's own accuracy bookkeeping, for every player:

```
{"k":"hg","t":12.345,"pid":5,"tid":3001,"tmpl":"Mp40"}
{"k":"i","t":12.345,"pid":5,"tid":3001,"tmpl":"Mp40","o":[1012.31,24.10,833.20],"p":[1040.50,23.75,861.00],"obj":812,"dmg":1}
```

One `hg` per call of `addBulletsGivingDamage`, the "hit" column of the
round-end accuracy table (IMP-11): `giveDamage` makes it for a direct hit on
a side's object (XHIT-4, only with `game.serverHitIndication 1`, the shipped
setting), and `handleExplosion` once per blast that hurt an enemy (HP-9b).
`tid` is the stat id `fireBarrel` stores: the hand weapon on foot, the
vehicle mounted. One `i` per call of `handleCollisionForProjectile`, the
segment `game.drawDebug` keeps (IMP-9): `o` the round's fire origin (HFD-4),
`p` the contact plus the round's position, in the frame of `f`'s `p`. `pid`
is the round's owner (-1 when it had none), `obj` the net id of the hit
object's root (-1 for terrain). `dmg` is 1 when a hit was credited inside
the call: a direct hit, or an explosive round's own blast, which
`handleCollisionForProjectile` sets off itself (IMP-12). A grenade's or a
timed charge's blast is an `hg` with no `i`. `tmpl` is left out for a stat
id the template manager does not hold. Both are written when they happen,
outside the sample, in the order the server ran them: a call's `hg` comes
before its `i`.

Against a client file of the same round, a server file has every object on
the map rather than those in range, at 30 Hz rather than about 10, and adds
`lod`, `pn`/`pj`/`pd`, `fake` shots and `perf`. It writes one `f` per barrel
where the client writes one per trigger pull. Its `hitFrom` and `special`
are every player's where a client file has its own player's. The viewer
skips `perf`; it reads
`pn`/`pj`/`pd` into flights ([In the viewer](#in-the-viewer)).

### In the viewer

`replay-recording.js` reads `pn`/`pj`/`pd` into `rec.flights`, one per flight
(`pn` to `pd`; a pooled key flies many), `{ key, tmpl, t0, t1, track }`, and
`linkFlights` links each to its `f` and its `i`, neither of which carries the
key. The shot is the nearest real `f` (not `fake`) up to two samples before
the first `pj`, its muzzle a tick or two of the flight's speed behind that
place (15 m of slack: the Defgun's `f` is 13.9 m back) and ahead of it, along
its direction or within 6 m to its side (a rack's two bombs leave 3.5 m
either side of the rack's one point). The collision is the nearest `i` from
the last `pj` to a sample past the `pd`, within the last leg's travel, whose
fire origin `o` is the shot's muzzle. The first `pj` is a tick out of the
barrel (3.3 m for a tank shell), so the drawn path is the muzzle a sample
earlier, the places, and the `i` point.

| file | flights | heavy rounds linked to `f` / to `i` |
|---|---|---|
| `20261101-104230-elalamein-coop-lod0-rec` | 797 | 35/35 / 35/35 (bomb, 2 Panzershreck, 23 tank shells, 9 Priest) |
| `20261007-060803-review-bots-bocage-coop-lod0-rec` (no `i`) | 1,115 | 129/129 / none to link |
| `20261013-205342-wake-coop-rec` (no `i`) | 290 | Defgun 6/6, Hatsuzuki 34/34, bombs 8/8 |

`replay-flights.js` draws the flights of every round the page would draw as
a body (`kind` shell or rocket: shells, rockets, bombs), with the mesh of the
FireArms that fires it (the hull's model, or the hand weapon's glb the shot
names), nose down its velocity, and the gun fires with no round of its own
(`serverFlies`, `fireWithoutRound`: the flash, the kick, the sound, no
round). At the end it plays the game's collision effect for the round's
material against the surface the page's colliders find at the `i` point
(armour on a hull, the ground's own on terrain); a flak shell gone in the air
(proximity or clock, no `i`) plays its end-of-life burst; in a file with no
`i` at all the surface is looked for past the last `pj`. Bullets, one to
three samples long, are still the page's own rounds from `f`, and the
networked rounds stay `replay-props.js`'s. Checked in the page: every heavy
round on El Alamein and the older Bocage file drawn 0 m off its path, an
effect at every end, no page-fired body round beside any of them; a client
recording still fires its own (features/replay-feature-sweep-2026-11-01,
entry 2).

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
| `ScoreManager` | a team's score at `+0x10 + team * 0x50`, tickets `+0x48` within it; points `+0x3c`..`+0x58` (death, kill, tk, capture, attack, defence, objective, objectiveTk, i32); winner byte `+0x5c`, victory type byte `+0x5d` |
| `BFPlayer` (the board) | ping `+0x94`, deaths `+0xa0`, kills `+0xa4`, score `+0xc0`, medals `+0xe8` / `+0xec` / `+0xf0` (i32 each) |
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

`hg` and `i` cost per event, not per sample: a handful of reads and one
line each, outside the sample. On El Alamein co-op with 30 bots at AI LOD 0
(every shot real, 2026-11-01) 8 minutes made 224 `i` and 89 `hg` lines,
35 KB of a 26.6 MB file, and the sample's mean stayed at 320-470 us. Turn
either off in `recorder.con` (`recordHits 0`, `recordImpacts 0`).

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

- **The events it used to drop** (2026-11-01, Wake co-op, 30 bots, no
  client, 47 minutes, `~/bf1942-lab/runs/20261101-185429-events3-wake-coop-rec`):
  both new detours went in; 59 `roundStats` for the 27 players with a
  tally, and each player's `fired` total equals his real `f` lines and his
  `hit` total his `hg` lines, 27 of 27; 685 `hitFrom` over all 30 bots, all
  eight sectors, the strongest 191 (HFD-2's 0.75 cap); 4,485 `special`, all
  action 0, over 29 bots. The viewer's `parseRecording` read the file with
  nothing skipped, and its Accuracy board took every tallied player from the
  server's tally (`source` `server`). `welcome`, `mapList`, `vote`,
  `sessionId` and the `raw` four need a client joined and met only the
  harness.

- **The board and the result** (2026-11-01, Wake co-op, 30 bots, no
  client, 26 minutes, `~/bf1942-lab/runs/20261101-202218-a6board-wake-coop-rec`,
  the recorder preloaded from a scratch build): `scoreTable` was vanilla's
  ScoreManagerSettings.con; the last `ps` of every player equals the log's
  `bf:roundstats` score, kills and deaths, 30 of 30; the round's
  `gameStatus` 2 carried winner 1 and victory 1 where the log has winner 1
  and type 4. It came twice, 0.08 s apart (the server sent the status
  again); the viewer takes the first. No medal counter moved.

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
| tick mode, hits | `hg` and `i` through the core's hook entries: the line shapes, a stat id named through the template manager and one without, a hit object's root, terrain, dmg inside a call and a nested one; `recordHits 0` and `recordImpacts 0` |
| tick mode, events | The 2026-11-01 events: `welcome` and `mapList` held and written once at t 0, `vote`, `roundStats` with named rows and the stale rows cut, `hitFrom` and `special` from the queue (no `pid`) and from the two hook entries (each player's `pid`, the queue's copies dropped), the four `raw` types; then the file through the viewer's `parseRecording` (`rec.roundStats`, `rec.hitsTaken`, `rec.refills`); the board's `ps` (each player once, again only on a change) and `scoreTable` (again on a change); `gameStatus` 2 with the victory type set after it in the same tick, and 5 as it comes |
| lnxded target | `target_lnxded.c` compiles with `build.sh`'s flags; a string at the end of a memory mapping is read; the hit, impact and refill stubs pass their arguments through to the original and return its value |

Not covered: the `hitFrom` stub's reads of `_giveDamage`'s frame (the lab
checks it), moving parts, soldiers' states, control points, projectile
flights and tickets through the sampler, the stubs' detours patched into
the real binary (the lab checks those), and anything in
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

- `hg` and `i` with a human playing (2026-11-01 met only a bots-only LOD 0
  round, `~/bf1942-lab/runs/20261101-104230-elalamein-coop-lod0-rec`): there
  every `hg` fell inside an `i` with `dmg` 1, per player one for one, since
  no grenade or charge blast hurt anyone. Small-arms `i` lines with `dmg` 0
  are the misses that touched something; a round that touches nothing
  leaves no `i`.

- The chat hook goes in, and a typed line gives one `chat` record with the
  typist's name, `pid` and side; a team line carries ` [axis]` or
  ` [allies]`; a console `game.sayAll` is `pid` -1.
- The chat pieces' fields (`first`, `total`, `global`) with a second client
  connected. They have never met real server data.
- Every `o` is followed by an `s` for that id in the same sample, and the
  viewer draws dropped kits, unmanned guns and flags.
- A file after a round change has no `clock` at t 0 carrying the old round's
  time, and one `createPlayer` per player.

- `welcome`, `mapList`, `sessionId` and `vote` with a client joined, and
  which of 0x0E, 0x1E, 0x25 and 0x3B a vanilla round sends at all.
- A bot at a depot is refilled (`special`) about every 0.1 s, where the one
  client file checked (`replay_20260927-203459`) has its player's every
  0.5 s. Which caller of `triggerSpecialGameEvent` sets the bots' rate is
  not read. The viewer writes one log row a visit, so it shows no more
  rows, but its `lastRefill` is one for all players, and neither the
  refill nor the hit-direction log row names the player: a viewer change
  in `replay-recording.js` (`special`, `hitTaken`), not made here.

Known gaps:

- `i`'s `pid` is the round's `+0x108`, which `fireBarrel` writes only when
  it has a player (`0x0828b4e3`; the null-player path skips it). A pooled
  round an unmanned gun auto-fires may carry its last owner's id.

- A round that hits inside one tick (a rifle at close range) has an `f` and
  no flight. A hook on projectile creation would give it one.
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
