# The tick recorder: build log (2026-10-05 to 2026-10-12)

How the current lnxded recorder was built and checked: the capture, its cost, the parity rounds, events against a client, projectile pools and the 2026-10-12 review fixes. What is open now is in the [README](../README.md#open).

## The new recorder (2026-10-05)

"The best capture" built for lnxded (`-DREC_TICK=1`). The w32ded target and
the test harness's thread mode still run the POC's sampler thread from the
same core.

### How it captures

- **The clock.** GameServer's vtable slot 0x140 (`simulateFrame`,
  `0x0815c2a0`; the vtable is in `.data` at `0x0871b0e0`) is replaced by a
  wrapper that runs the server's tick and then samples. A sample is the
  world after a tick, stamped on the same monotonic clock as the event and
  fire hooks. `simulateFrame` returns 1 in `eax`; the float argument passes
  through as its bits.
- **The reads.** Plain loads on the game thread, which owns the world and is
  not changing it while the sample runs. A SIGSEGV or SIGBUS on the game
  thread inside a sample jumps back to the tick entry (`sigsetjmp`), ends
  that sample and lets the server run on; any other fault goes to the
  handler that was there before ours. After 64 faulted samples in one file
  the recorder closes it with its `end` record and stops for good.
  `tests/run.sh` points the sample at a `PROT_NONE` page to prove it.
- **The live set.** Walking all ~5,000 registered objects was 461 of a
  sample's 520 us. `registerObject` and `unregisterObject` are called only
  through the ObjectManager vtable (164 and 60 call sites, none direct; slots
  `0x087204e0`/`0x087204e4`, in `.data`), so two slot hooks keep an exact set
  of live objects. A new object is looked at for 30 samples and then kept in
  the per-tick list (~600 on El Alamein) or set aside as scenery. A full walk
  every 10 s, and at once when the world halves (`deleteAllRegisteredObjects`
  has three direct calls), reconciles the set and keeps what it knows.
- **The output.** Lines are made on the game thread into memory; a writer
  thread swaps the buffer out every 250 ms and writes it. Opening and closing
  a file are markers in the same stream. Each kind of per-sample record is
  one line per sample (`{"k":"s","t":..,"o":[[...],...]}`, the client's
  shape). Numbers are formatted by a small fixed-point writer that matches
  printf byte for byte (4 million values checked). `gameStatus` 5 (ENDMAP)
  is written to disk at once: the server restarts its process for the next
  map without running exit handlers, so a file has no `end` record.

### What it writes

v5, readable by the viewer as it stands. The header's `plus` is
`server-replay-recorder/3` since 2026-10-12
([Review fixes](#review-fixes-2026-10-12)), `/2` before. New against the POC:

| `k` | what | from |
|---|---|---|
| `chat` | a chat line as the chat box shows it, the client's record (since 2026-10-12) | `GameServer::handleChatMessage`'s vtable slot |
| `p` | `[pid, team, vehicle, root, seat, triggers]`, the client's seat record, on change | `BFPlayer::getVehicle` `+0x4c`, its root, `+0x54`, triggers `+0x148/+0x149` |
| `st` | aim pitch and torso twist now real | `BFSoldier+0x284/+0x288` (P-4) |
| `anim` | `[index, name, flags]`, once a file | the name map at `activeAnimationStateMachine+0x41c`, flags `state+0x24` |
| `cp` | control points: id, name, template, place, team; then team changes | `ControlPoint+0x174`, template `+0x1e4` |
| `lod` | `[pid, lod]` for bots, on change (AI-136) | `BotMain+0x10` through `IBotManager::instance` (the BotManager itself) |
| `pn` / `pj` / `pd` | a projectile's flight: named, placed each sample, ended | Projectile roots (vptr `0x0873f2c8`) |
| `e` `projPool` | a weapon's pool of networked rounds, as the client's event 0x05 (since 2026-10-05, [below](#projectile-pools-2026-10-05)) | the event with a client connected; the weapon's own pool always |
| `e` `destroyObject` | a networked object's end, as the client's event 0x06, with no client connected too (same section) | `GameServer::destroyObject`'s vtable slot |
| `perf` | once a minute: the sample's and the server's tick cost, objects, the file's faults, dropped output | |

The viewer skips `pn`/`pj`/`pd` and `perf` today. It reads `lod` into
`rec.lods` and tags a bot at LOD 1 or 2 on the followed player's card, and
it reads `fake` on an `f` record
([round-replay-fidelity](../../round-replay-fidelity/README.md#what-a-server-recording-adds-2026-10-05)).
Since 2026-10-12 an object's `s` entry, and with Armor its `a` entry, are
written in the sample of its `o` and then on change; before, on change
alone.

### What it costs

The sample's time on the game thread, with the server's own tick for scale
(`perf` lines):

| round | recorder per sample | server's tick |
|---|---|---|
| El Alamein, 30 bots, no human | 100 us mean, 430-810 us max | 720-860 us |
| the same with a human flying | 225-265 us mean, ~1.1 ms max | 2.4-2.9 ms |
| 13 h soak, 7 rounds (below) | 87-269 us per-minute means; one 14 ms worst sample | 0.6-2.4 ms |

About 0.3-0.8% of one core. It got there from 544 us: the live set took the
walk away, template and player names (a `/proc/self/mem` read each) moved to
first sight, the part table gained an index, and printf left the hot path.
What is left is mostly formatting; moving it to the writer thread is the
next step if a 64-player server needs it.

### How it was checked

- **Bots-only El Alamein.** Every real shot (fireBarrel) has a projectile
  flight within 0.1 s, in a full-walk run (493 of 493) and in a live-set run
  (101 of 101). Objects seen twice are soldiers leaving and re-entering
  vehicles, the same in both modes. In the viewer's own crew logic
  (`crewOf`), hulls are crewed in 604 of 1,668 moments; the POC's file had
  none of 5,833.
- **The second parity round** (`~/bf1942-lab/runs/20261005-070852-parity-elalamein-rec`):
  the owner flew a BF109 for 2.7 minutes with his client recording. Server
  time = client time + 72.475 s (his plane's track).
  - Every object his client did not control is drawn 0.12 s behind the
    server; allowing for it, vehicles and soldiers agree to 5-9 cm at the
    median and aircraft to ~0.4 m. His own plane, which his client predicts,
    agrees to 0.38 m with no lag. The server has it every 0.033 s, the client
    every 0.108 s.
  - Seats: the same transitions (soldier 961, BF109 575, the free camera),
    within the client's 0.1 s.
  - The animation table: 1,395 states, identical in index, name and flags.
  - Body states: lower 92%, upper 89% the same (with no lag shift); 165 of
    the 189 upper mismatches are the same state within 0.3 s, most of the
    rest the client's weapon-specific variant (`Ub_LieToStandK98`) of the
    server's generic one. Where his client showed a soldier running, the
    server agreed 91%. Aim: pitch 0.0 degrees apart at the median, 0.2 at
    p90; twist 0.0 and 1.6.
  - Engine revs of his plane: 0.005 apart at the median.
  - Tickets and control points: the same values, names and owners.
  - His shots: 468 on the server, 279 on the client. The server writes one
    `f` per barrel (`fireBarrel`), the client one per trigger pull: 189
    BF109 bursts x 2 barrels + 90 StG 44 rounds = 468. All 378 BF109 rounds
    have a flight (12 samples over ~160 m at the median); 59 of 90 StG 44
    rounds do, the rest hit inside one tick.
  - The viewer parses the 15-minute file in 0.4 s with nothing skipped, and
    crews hulls in 2,275 of 8,356 moments (seats 0, 1 and 2).
- **A 13-hour soak** (`20261004-180859-parity-elalamein-rec`): seven rounds,
  one file each, zero faults, zero dropped output, every line valid JSON. The
  laptop slept from 22:26 to 06:35 in the seventh round; the server and the
  recorder carried on after it. The recorder's `t` is `CLOCK_MONOTONIC`,
  which stops in a suspend, so that file's 3,232 s are 1,231 s before the
  sleep and 2,001 s after it, with the server event log's 8-hour gap folded
  out.

### Events against a client (2026-10-05)

The owner saw one kill of his twice at 3:50. Every to-all event was written
once per connected client plus once: the event hook copied `size` bytes from
the payload, but the size table is the maker's `sizeof`, header included, so
it read 12 bytes past each event, and a client's clone (different heap
neighbours) never matched its original. It now copies and compares the
payload alone, against the last 16 events rather than the last one. The same
read could fault at a page's end; it no longer leaves the event. Checked
event by event against the owner's client file of the same round, three
decoders were also wrong for the server's own objects and are fixed:

- `createObject` (CreateObjectEvent::serialize `0x0811d360`): a
  has-transform flag at payload +6, the position at +7 and the rotation at
  +19 only when it is set. The decoder read +8 and +20 (positions like
  -134217728).
- `score` (ScoreMsgEvent::serialize `0x0811c8d0`): victim, weapon and body
  part are serialized only for kinds 3 and 6, and the body part is one byte;
  other kinds are written with the kind and player alone.
- `challenge` (0x14, 52 bytes) was missing from the table, so never written.

A round with the owner connected (2026-10-06, `20261006-200339-parity-elalamein-rec`)
showed the kills single (11 of his in each file, same victims) but 62
`pickupKit` and 100 `control` events twice: the sampler makes those two
itself for a round with no client, and with one connected the server's own
arrive a tick or so apart, outside the fan-out window. Each player's last
control object and kit is now kept, and a repeat of it is dropped whichever
path wrote first.

`destroyObject`, `exitVehicle`, `serverInfo`, `serverName`, `setLevel`,
`simStart` and `clock` matched the client's; `enterVehicle` matched once the
client's 9 s delay in taking the join's database is allowed for.
`tests/run.sh` now gives every copy of a fake event different bytes past its
payload; the old core fails it with the field's numbers (one kill written
five times for three clients). The viewer's copy of that round
(`viewer/replays/20261005-070852-parity-elalamein-rec/replay_1791148138.ndjson`)
has had its exact duplicates removed; the run directory keeps the original.

### Projectile pools (2026-10-05)

The client's `projPool` (event 0x05, `CreateMultipleObjectsEvent`, 22 bytes
with its header) tells the viewer which networked objects are a weapon's
rounds: grenades, mines, charges, the binoculars' spot and the PT boat's
`FloatingMine`. `classify()` in `replay-recording.js` makes a pool's objects,
and every object of a template a pool made, projectiles. A server file had
none, so it classified by the `Projectile` suffix alone, and a dropped
`FloatingMine` was a hull asking for a `FloatingMine.glb`.

**Where the server builds it** (ledger FA-2, J-5). A weapon makes its
networked rounds once, in its constructor: `FireArms::initProjectilePool`
`0x08287a80` calls `GameServer::spawnMultipleObjects` `0x081324a0`, which
makes `count` objects and, for every connection whose database has gone
(`+8`), calls `GameEventManager::createMultipleObjects` `0x0812d510`. That
puts the event straight into the client's send queue. Nothing sends it
again: a joining client's database (`sendDatabase` `0x08134400`) carries the
rounds as single `createObject`s at the origin. With no client connected the
event is never built, which is why the hooks never saw one.

**Layouts.** The server's event object (vptr `0x0871a7c8`, 0x16 bytes) holds
the template id at `+0xc`, the first object's net id at `+0x10` (u16) and the
count at `+0x12` (i32). `serialize` `0x0811d500` writes 32, 16 and 4 bits of
them. In the payload they sit at 0, 4 and 6, as in the client's struct. The
pool stays on the weapon for its life: the projectile template at
`FireArms+0x194`, the objects in a `vector<IObject*>` at `+0x1d8`/`+0x1dc`, the
count at `+0x1e4`. A weapon is a `FireArms` (vptr `0x08730da8`) or a
`HandFireArms` (`0x087318c8`), and both are in the registered map.

**What the recorder writes.** The client's record:

```
{"k":"e","t":20.058,"e":"projPool","tid":1293,"tmpl":"GrenadeAxisProjectile","netId":590,"count":3}
```

- With a client connected, from the event (`emit_event_json`; held until a
  file opens, one line a pool).
- Always, from the tick sample. A weapon is read while it is new in the live
  set, and every weapon in the set is read once when a file opens
  (`live_pools`), because weapons are not kept in the per-tick list. A table
  by first net id keeps one record per pool per file, whichever path saw it
  first. A weapon whose pool reuses a dead weapon's ids is written again.

So a server file has every pool standing when it opens and every pool made
after. A client file has only the pools made after its join.

**And `destroyObject` with no client.** Pools alone made server files worse.
The server reuses a dead object's net id for the next one, and a server
file with no client had no `destroyObject` (0x06): the event is built only
per connection, in `GameServer::destroyObject` (ledger J-6). The viewer
keeps a life by id until a `destroyObject` ends it, so a soldier or kit made
on a dead weapon's grenade ids became part of that pooled life: kept the
grenade's template, counted as a projectile, and was not drawn as a soldier.
A 25-minute El Alamein file had 109 such objects. Without pools the same
merging happened, more rarely: 10 objects in the 15-minute parity file took
an earlier object's life. (The viewer was changed the same day to start a
new life on another template or registry key in a server file,
round-replay-fidelity; the record below is what a client file says.) The
recorder now hooks
`GameServer::destroyObject`'s vtable slot (`0x0871b13c`) and writes the
client's `destroyObject` for every networked object the server destroys.
With a client connected, the event comes first and the hook's copy is
dropped by the fan-out check. A destroy while no file is open is the last
level's teardown and is not held for the next file. A `destroyObject` on a
pool's first id also clears that pool from the table.

**How it was checked.**

- `tests/run.sh`, both modes. The event fanned out to three clients is
  written once, and the sample does not write it again. A disabled
  `HandFireArms` and a `FireArms` are written once a file and again in the
  next, and a respawned launcher on the same ids is written again.
  `harness live` runs the live set: a weapon that has become scenery is
  written again when the next file opens. It fails without the hook's note
  (the event's pool written twice) and without the file-open pass (no pools
  in the live set's second file). It also destroys a launcher's rounds
  through the hooked slot, the first with a client's event before it: one
  `destroyObject` each, and none for a destroy between files.
- Bots-only lab rounds, no client, so every record is the sample's or the
  destroy hook's:
  - Wake (`~/bf1942-lab/runs/20261005-082144-projpool-wake-rec`, 7.5 min):
    76 pools, the client's counts and templates (`GrenadeAxisProjectile` and
    `GrenadeAlliesProjectile` 3, `LandmineProjectile` and
    `ExpPackProjectile` 9, `BinocularsProjectile` 1). Each pool's ids end at
    or just below the `pickupKit` made at the same spawn, as in client files
    (599 x3, then kit 602).
  - El Alamein (`20261005-082947-projpool-elalamein-rec`, 25 min of round):
    217 pools, the one grenade thrown (`o` 618 at 990 s) inside a pool of its
    template, 11 pools written twice on the same ids, each at a new kit. It
    showed the 109 merged lives above.
  - El Alamein again with the destroy hook
    (`20261005-191346-projpool-elalamein-rec`, 12 min to the round's end):
    68 pools and 401 `destroyObject`, none twice. The rounds of every pool
    are destroyed, the ones standing at the round's end in its teardown.
    No `o` record reuses an id another template had without a
    `destroyObject` in between.
  - The viewer's `parseRecording` (in Node) marks every life of the five
    pool templates `pooled` and `projectile` in all three files.
- No vanilla co-op map the lab server has carries a `FloatingMineLauncher`
  (Truk does, and the server install has no Truk). The harness's file with
  a dropped `FloatingMine` added: with its `projPool` the viewer makes the
  mine a projectile, without it a hull.

### Review fixes (2026-10-12)

A review of the recorder's code against its files found the defects below.
The format's `v` stays 5: every record is one a v5 client file has, in the
client's shape, and the viewer was not changed. `plus` went from
`server-replay-recorder/2` to `/3`, so a file says which recorder wrote it.

**First sight.** An object's first sight wrote its `o` and nothing else, so
one that never moved a centimetre had no place in the file, and one never
hit had no hit points: in `replay_1791317756` of the 2026-10-07 review
round, 95 of the 312 net ids the sampler gave an `o` (79 dropped kits, 10
stationary guns, the 5 control points, a soldier). The `s` entry, and with
Armor the `a` entry, are now written in the sample of the `o`, as the
client recorder does. An object that goes and comes back (a soldier out of
a vehicle) is a first sight again.

**Turns.** The moved test summed the four quaternion differences with their
signs, and for a yaw near 90 degrees two of them cancel: 90 to 102 sums to
0.0077, under the 0.008 threshold. Each component is now compared on its
own, at 0.008: the 0.9 degrees it was for a yaw from yaw 0, 1.8 at most.

**A net id handed on inside one sample.** First-sight `o` records are
written during the walk and the vanished objects' `d` after it, both by net
id. When an object went and another was given its id between two samples,
the file read `o` N then `d` N, and the viewer ended the new life's time in
the world. The old life's `d` is now written just before the new `o` (a
table of the registry key each net id was last given an `o` for; 256 KB).
A kit's `o` from the kit watch goes the same way. None of the review
round's three files has the case.

**Held events.** What arrives with no file open was kept and written at
t 0 of the next file: each one, but the latest of each of a join's five
handshake events, one `createPlayer` for all players (each replaced the
last), and nothing more once 1024 were held. Two files of the review round
open with the round before's `clock`, `worldTime` 435 and 618, and the real
one, 0, follows at 4.8 and 6.5 s. Held now is state, the latest line a key,
in arrival order; when 1024 are held the oldest goes:

| held, the latest | key | withdrawn by |
|---|---|---|
| `setLevel`, `gameRules`, `serverInfo`, `serverName`, `challenge`, `gameStatus`, `dbComplete` | the type | |
| `createPlayer`, `setTeam`, `control`, `pickupKit`, `enterVehicle` | the type and the player | his `destroyPlayer`; `exitVehicle` for the seat |
| `createObject`, `projPool` | the type and the net id | a `destroyObject` on the id |

Not held: `clock` and `simStart` (the round clock at another time), `score`,
chat, `radio`, and the three that withdraw. An event's stamp reads the
file's start once.

**Chat.** The recorder wrote a chat line's pieces as `e` `chat` events,
which the viewer reads only from a file older than v3; from v3 it reads the
client's `chat` record, the line as its chat box showed it. How the server
handles a line (lnxded, read in the binary):

- Every line passes `GameServer::handleChatMessage(ChatMessage const&)`
  `0x08134a70` once, whole, through the GameServer vtable's slot
  `0x0871b20c` (`+0x124`; no direct caller). A client's line arrives in
  pieces and `StringManager::processReceivedEvent` `0x0815d580` calls the
  slot when the last is in, with the sender's player id the server knows;
  the server's own go through `GameServer::say` `0x08139cb0`, sender -1.
  `ChatMessage`: target `+0` (0 the sender's side only), text `+4`, length
  `+0x48` (63 at most), sender `+0x4c`.
- The handler queues the line on every connection but the sender's, and
  with target 0 only on his side's (`StringManager::addStringMsg`
  `0x0815d280`, the connection's manager at `+0x2c`).
- Each connection sends its queue one line after another, 15 characters a
  piece and a piece every 0.5 s (`StringManager::updateSendStream`
  `0x0815d3c0`, from `ClientConnection::transmitMsgs` `0x081154a0`), as a
  `ChatFragmentEvent` (0x28, ctor `0x08120d30`) through that connection's
  own event queue.

So the event hook is given each piece once per receiver, on each receiver's
own clock, and nothing of a line nobody else is sent: a lone player's chat,
which is every line typed in a lab round, makes no event at all. The
recorder now hooks the handler's slot (`gs_chat_slot`, like
`destroyObject`'s) and writes the client's record:

```
{"k":"chat","t":12.345,"pid":5,"team":1,"text":"Alpha Dog: hello all"}
```

`text` is `Name: line`, `Name [axis]: line` or `Name [allies]: line` on the
sender's side's channel, and the line alone for the server's own (`pid` -1,
`team` 0); the name and side are the roster walk's. In five client files,
of 233 chat-box lines matched to their first piece, the 27 shown with a
side's tag are the 27 whose piece has the byte at `+2` set, which bf42plus
names `broadcast` and writes as `global`: it is the side's channel. Where
the slot is not hooked (w32ded, or a slot that holds something else) the
line is put together from its pieces, a line in progress a sender, 16 at a
time: exact while one client is sent it or the receivers are in step (the
limits are under Still open). The pieces are still written as `e` `chat`,
now once a piece and with the text cut at the piece's length: the field
past it is the allocator's, which trailed into the text and made every
receiver's copy a different event.

**Smaller.**

- `lnxded_read_string` needed all 128 bytes readable, so a name within 127
  bytes of the end of a mapping read as empty and its player was skipped by
  every roster walk. It takes what the read returns.
- The last kit and controlled object written for a player id (which drop a
  repeat) outlived the player and the object. A `destroyObject` on the net
  id, the player's `destroyPlayer` and another name on the pid now clear
  them; the same name again (the walk meeting a player an event introduced,
  a later join's database) does not, so the 2026-10-06 duplicates stay
  gone.
- A value that is not a number (NaN, infinite, past 1e9) leaves its entry or
  field out. printf wrote `nan` and `inf`, which is not JSON, and one such
  entry cost the whole sample's line; the fast writer wrote 0, a sample at
  the world's origin.
- The fault count was the process's, and at 64 the recorder turned off with
  its file open: the event and fire hooks went on writing into it. The
  count is the file's, and the 64th closes the file with its `end`.
- The detour stubs' asm block ended in `.data` and the compiler, which does
  not see that, assembled the functions it emitted next (`lnxded_lock`
  among them) into `.data`. The server's process has executable data, so it
  ran. The block now returns to the section it was entered in.

**How it was checked.** `tests/run.sh`, which now also drives root objects,
an Armor, a roster and the chat handler's slot through the core
(`harness world`), reads the result with the viewer's `parseRecording` when
node is there, builds `target_lnxded.c` with `build.sh`'s flags and runs its
string read against a mapping's end. Against the sources before the fixes
every new check fails (held: the clock, both statuses, one `createPlayer`
of three, the newest dropped; no `s` or `a` at first sight; the turn
unwritten; `"maxhp":inf` and `[803,nan,7]` in the file; `o` 805 before `d`
805, and the viewer's second life on 805 with no time in the world; no
`chat` record; one `control` for a pid's two players; a kill written after
the recorder gave up). Its "live set" check also failed about half its runs
on unchanged code: it read the two files in name order, and
`replay_T-1.ndjson` sorts before `replay_T.ndjson`.

**Not checked against a server.** The lab server was not run. To confirm:

- The chat hook: the server's log says `chat hook in
  GameServer::handleChatMessage's slot 0871b20c`; a line typed to everyone
  is one `chat` record `Name: line` with the typist's `pid` and side, a line
  on the side's channel has ` [axis]` or ` [allies]` after the name, and a
  `game.sayAll` from the console is `pid` -1. That a client's line reaches
  the slot rests on `dice::bf::game` (`0x0870d918`) being the GameServer
  with its primary vtable.
- The pieces' fields have still met no real data on the server (a round
  needs a second client for a piece to be made): `first`, `global` 1 on the
  side's channel, `total` on every piece, a `text` of 15 characters at most.
- The `.so` loads and hooks as before with its functions in `.text`.

