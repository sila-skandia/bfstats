# Server-side round replay recorder

Stage 2 (watchable): a 32-bit `.so` loaded into `bf1942_lnxded` with the lab's
scenario `preload` key records the whole battlefield from inside the server as
newline-delimited JSON in the bf42plus client recorder's format
(`h`/`e`/`o`/`s`/`d` lines), so
`tools/bf1942-models/viewer/replay-recording.js` can play the file: it writes
the `setLevel` line (the viewer's level question, answered server-side), the
roster (`createPlayer` with bot names, teams, ai), and `control` events
binding each player to the object he controls (his soldier on spawning, his
free camera on death), then samples every networked root object's transform.

Where this sits: `features/parity-lab/README.md` phase plan item 3. The client
side recorder (bf42plus `recordReplays`, dsound.dll side-car) sees the round
through one connection; the server sees the authoritative world for every
player and bot, no client cooperation needed.

An agent picking this feature up: read
["The best capture"](#the-best-capture-2026-10-04) first -- the design this
POC is to be replaced by, and the experiments that come before it. "Review:
sampling, and the send path" before it measures why the POC's replays play
worse than the client's. "Where things are at (handoff)" below is the 2026-10-02
state of the w32ded port.

## What exists

The recorder is one shared core plus two thin target layers, selected at
build time:

- `src/core.c`: everything target-independent -- config read, tracking
  hash, quaternion math, the ndjson emitters, the sampler, vanish logic,
  and the stage-3 capture logic (detour callbacks, joints, engines, armor,
  tickets, kits, roster synthesis). Every address, struct offset and OS
  call goes through the target table in `src/core.h`.
- `src/core.h`: the target contract: the offset table (globals, map and
  object layouts, stage-3 layouts) plus the platform shims (safe read,
  clock, string reads, tree successor, locks, sleep, detour install,
  thread start).
- `src/target_lnxded.c`: bf1942_lnxded -- SGI-STL layouts, /proc/self/mem
  preads, ELF-constructor entry + pthread, and the stage-3 RWX-trampoline
  detours. Built with `-DREC_STAGE3=1`.
- `src/target_w32ded.c`: BF1942_w32ded.exe -- proxy `WINMM.dll`, MSVC
  (VC7/Dinkumware) layouts, `IsBadReadPtr` reads, DllMain +
  CreateThread entry, winmm IAT reroute. Built with `-DREC_STAGE3=0`:
  stage 1 only (object map walk, transforms, destruction, template
  names), detour layer stubbed until its sites are cross-matched.

The stage-3 code paths are compiled out of the w32ded target; porting
them means filling in that target's table (see the handoff below), not
copying code. Same ndjson as the lnxded recorder (the w32ded one at
format v4, stage 1), playable by
tools/bf1942-models/viewer/replay-recording.js.

- `build.sh`: builds both (`recorder.so` into the lab as
  `~/bf1942-lab/server/recorder.so`, `build/WINMM.dll`).
- `tools/bf1942-models/lab/scenarios/wake-coop-rec.json`: wake-coop with the
  preload, no client needed.

## Turned on or off

`mods/bf1942/settings/recorder.con` in the server install (the lab's
`settings-template/recorder.con` renders it into every run):

```
recordReplays 1
replaySampleHz 10
```

Off unless present. The shipped server's own config parser is not touched:
the recorder reads its own file, so no console round-trip is needed and an
unknown key cannot break the server's `.con` parsing.

## The layout it reads (verified in the server binary)

Decompiled with `features/bf1942-engine-reference/lnxded/decompile.sh` (run it
with `TMPDIR=/tmp`: mktemp's default template contains a dot, which Ghidra's
project-path check refuses):

| what | address / offset | source |
|---|---|---|
| `dice::ref2::world::objectManager` | global `0x0871dc24` (pointer) | nm |
| registered-objects map | `om+0x94`: header-node ptr, `om+0x98` node count; node: parent +4, left +8, right +0xc, pair key +0x10, `IObject*` +0x14 | `ObjectManager::registerObject` `0x0819b4a0`, ctor `0x08199650` |
| `BObject<IObject>` flags | u32 `+0x04` | `updateFlags` `0x081931c0` |
| template pointer | `+0x4c` | `BObject` ctor `0x08191480` |
| registered-map key (= gid) | `+0x48` | `registerObject 0x0819b4a0` (`+0x58` is NOT the id: a live run read 168276372s there) |
| absolute transform | `Mat4` at `+0x74` (rows a,b,c then position) | `getAbsoluteTransformation` `0x08196780` |
| `ObjectTemplate` name / id | `std::string` `+0x08` / u32 `+0x10` | `getName` `0x081d4c60`, `getId` `0x0816af60` |
| networkable / its u16 id | `IObject+0x68` -> net, word `+4` | live-verified on a soldier; the event builders read the same shape. NOT the `+0xc4` virtual: on the server those IObject slots are pure-virtual in `BObject<IObject>`'s vtable |
| `dice::ref2::world::playerManager` | global `0x0871dc2c` (pointer) | nm |
| player list | `pm+0xc`; node: next +0, `BFPlayer*` +8 | `GameServer::updateGameLogic` `0x081505c0` |
| `BFPlayer`: id / name / ai / team / vehicle / camera / controlled / kit | `+0x58` (`+0xc` is the network id; corrected 2026-10-04) / string `+0x44` / byte `+0x78` / `+0x7c` / `+0x68` / `+0x74` / `+0x68` / (not a field) | `getId` `0x080560e0`, `getName` `0x08056070`, `getIsAIPlayer` `0x08056120`, `setTeam` `0x080556b0`, and `GameEventManager::createPlayer` `0x0812d080`: the event's `vehicleNetworkID` comes from the object at `+0x68` (the soldier on spawning, the free camera on death is `control`), `cameraNetworkID` from `+0x74`, and the kit is NOT a BFPlayer field -- the builder takes it from the soldier's template (class id 0x9493 via the template's getClassID slot, vptr+0xc), then `getKit` (vptr+0x17c) -> objectManager lookup (vptr+0x20, fallback +0x24) |
| vtables (gcc: a vptr holds symbol + 8) | `RotationalBundle` `0x08724e08`, `Engine` `0x0872bc68`, `BFSoldier` `0x0872f048`, `PhysicsEngine` `0x0872d608`, `ScoreManager` `0x0871c008` | nm (no subclasses of any of them: exact vptr matching is safe) |
| `BFSoldier` animation state machines | `getAnimationState(int) 0x0826d060` = `soldier+0x2b4 + i*0x44` (lower i=0, upper i=1); held item `getActiveItemIndex 0x0827f920` = `+0x3b8`; state bits `getStateBits 0x0827e1c0` = u16 `+0x3e6` | nm + decompile |
| `Engine` | PhysicsEngine pointer at `+0x60` (Engine::init `0x0823e110` reads it, `PhysicsEngine::enterPush` is called through it); revs `pe+0xA0`, gear `pe+0xBC` | `PhysicsEngine::updatePhysics 0x0824cbb0`, ctor `0x0824c6f0` (gear inits to 1) |
| `Armor` | hp `+0x38`, max hp `+0x3c`, critical damage `+0xf0`, last-hit player `+0x14`; found in the component map at `IObject+0xb8`, key 0xc4a4, value at node+0x14 | `Armor::getHitPoints 0x08173f30` and siblings (same offsets as the client's), `BObject<ICompositeObject>::queryComponent 0x08193fd0` |
| `ScoreManager` | global `dice::ref2::world::scoreManager` `0x0871bb58` (NOT `setup+0x410`: that is the EventLogger); `getTeamScore(team) = this + 0x10 + team*0x50`; ticket count at `TeamScore+0x48` | nm, `getTeamScore 0x081616c0`, `TeamScore::setTickets 0x081610a0` |
| level / mode | `*0x08716b64` (Setup) + `0x23c` name string, `+0x240` gpm enum (CQ=2, TDM=3, COOP=4, OBJECTIVEMODE=5; `stringToGPM` `0x08060620`) | `Setup::getCurrentLevel` `0x080bfeb0`, `setCurrentLevel(CampaignEntry)` `0x080bfd70` |

This libstdc++ is the old SGI STL (`__default_alloc_template`), which is why
the map is a header **pointer**, not an inline header. The lab binary and the
bf42plus copy of `bf1942_lnxded.static` differ in 549 scattered bytes but have
identical symbol addresses; the recorder hardcodes the lab binary's addresses
and its README says so.

`/proc/self/mem` preads with 64-bit offsets: 32-bit `off_t` sign-extends
0xf7xxxxxx heap addresses and silently returns zeros (the first empty-walk
run). All reads go through it, so a pointer racing a destroy costs a skipped
sample, not a crashed server.

## What the runs showed (2026-10-01)

- `.so` loads, config read, sampler thread runs, server unaffected.
- Full round captured: 34 soldier objects (28 US, 6 Japanese; the rest of
  team 1 was still riding the landing craft when the run stopped. Soldiers
  spawn as children of their Daihatsu and only become root objects, and so
  visible to this recorder, once they exit), 30 bot names in the roster,
  `control` events binding soldiers and free cameras to pids, control-point
  and vehicle transforms at 10 Hz, destruction lines.
- `setLevel` verified live: `wake`, gpm 4 -> `CoOp`.
- ~2 MB per two minutes of round.

Two sampler bugs fixed on the way, both worth knowing:

- The first sampler version read the rb-tree as a modern libstdc++ map
  (inline header); this binary is the old SGI STL, so the map is a header
  *pointer* at `om+0x94` and every walk saw an empty tree until that was
  read out of the `ObjectManager` ctor.
- Walking the tree with no step bound can spin: a node was first walked
  while the round was still loading, `successor()` cycled, and the thread
  never returned (dbg lines stopped, file froze, process stayed at 100%).
  The walk is now bounded to the map's own count + 16.

## Stage 3: parity with the client recorder (2026-10-02)

Three capture surfaces, all verified in live wake-coop runs and by parsing the
resulting file through `replay-recording.js` (the viewer's own parser):

1. **Four game-thread detours** (RWX trampolines, patched through
   `/proc/self/mem`; each site's bytes are checked before anything is
   written, and a mismatch skips the hook):
   - `GameServer::sendGameEventToAll` `0x08153b10` -- every to-all event once:
     kills (`score` with the weapon's template name), chat, radio,
     gameStatus, gameRules, the 10 s world clock. This is the event surface
     the client recorder reconstructs from the wire; here it is captured at
     the source. `GameEventManager::addEventToSendQueue` `0x0812d730` is
     hooked too. It is reached through `GameEventManager::addEvent`, which
     every per-client sender calls once per connected client
     (sendGameEventToAll's own fan-out, enterVehicle, exitVehicle,
     radioMessage, handlePickup, handleDrop, _giveDamage,
     triggerObjectSpawner, ...), and from the builders a joining client's
     database is made of. With no client connected it is never reached,
     which is why the lab saw nothing there; the sampler synthesises the
     roster (createPlayer/control) and kits itself. With N clients connected,
     one event reaches the hooks N (+1) times back to back with the same
     payload, and `on_event` drops the copies (same type and payload within
     5 ms).
   - `FireArms::fireBarrel(IPlayer*, Mat4&, int)` `0x0828aba0` -- `f`
     records with the weapon template, its root's net id and the firing
     player's id (`getBFPlayer 0x08052ac0`): the gunfire sound timeline for
     the whole map, not one client's ~520 m window. One call is one
     projectile.
   - Fake rounds: `FireArms::Fire` at `0x0828a230`, past its `fakeFire`
     test. A bot shooting a bot that no human is near fires *fake*: the
     timer, recoil, heat and ammo run, but `fireBarrel` is skipped and the
     AI rolls the hit (`EntryInfoWrapper::execute` `0x08617f30` sets it
     through `FireArms::setFakeFire` `0x0828e310`; the `InfoWrapper`
     interpreter entries in `AIbehaviours.con` turn it on for every armed
     type). Every round passes `0x0828a230` once; the fake ones are written
     there as `f` with `"fake":1`, the launch matrix (`ebp-0x58`) as their
     transform. Without them a bots-only round had about 4 `f` per kill,
     led by aircraft and ship guns; with them the first five minutes of
     Wake held 1834 fake rounds (Browning 1496, MG42 334) beside 136 real.
     Kills from fake fire carry no weapon (`GameServer::giveDamage` gets
     weapon id -1): the 49 `(none)` kills of a Wake round.
2. **Sampler additions** (same thread as stage 2):
   - Moving parts: every registered `RotationalBundle` (122 of them on Wake:
     turrets, gun mounts, Daihatsu ramps and MG mounts, M3A1 wheels and
     doors) emits `jn` on first sight (template name + position in the
     root's frame) and `j` (relative quaternion) when it changes. This is
     what turns propellers and turrets. They are child objects with NO net
     id, which is why stage 2's root-only, id-gated pass saw none of them.
   - Engines: `g` records with revs from the `PhysicsEngine` (the engine
     note the vehicle-audio plays), gear, and flags/throttle read at the
     client's offsets until verified (see open items).
   - Soldiers: `st` records -- lower/upper animation state machines
     (`+0x2b4/+0x2f8`), held item (`+0x3b8`), state bits (`+0x3e6`).
   - Armor: `a` records on hit-point change and `maxhp`/`crit` on the first
     `o` -- the damage, smoke, burning and destruction timeline. The Armor
     component is read straight out of the object's component map
     (`IObject+0xb8`), no virtual call.
   - Tickets: `tk` records from the `ScoreManager` global (`0x0871bb58`).
   - Kits: when a player's controlled object changes, the recorder
     replicates `GameEventManager::createPlayer`'s kit lookup by safe reads:
     the template's vptr is `BFSoldierTemplate`'s (the only vtable whose
     getClassID answers 0x9493), the kit id is `soldier+0x408` (the body of
     `getKitId`, the vslot 0x17c call), and the kit object is a find in the
     objectManager's id maps at `om+0x48`, then `om+0x60` (the bodies of
     vslots 0x20 and 0x24). It used to make those three virtual calls from
     the sampler thread, and the last is a `std::map::find` racing the game
     thread's inserts and erases. It writes a
     `pickupKit` event plus the kit object's own `o` record -- which sits
     DISABLED in the registered map until dropped, so the watch pass emits
     it however it is flagged. A live run: 33/33 pickups bound, and the
     viewer parsed 30/30 soldiers with distinct kit templates (Medic,
     Scout, Engineer, AT, Assault, both sides).
   - The format is v5 (`jn` needs it for keyed parts).
   - One file per round. The sampler closes the file, with its `end`
     record, when the registered-object count falls below a quarter of the
     file's peak (the level unloading; a round restart on the same map
     unloads too) or the setup names another level. It opens the next once
     the count climbs again. A client's join does not split the file:
     `ServerInfoEvent` (0x1a), which used to, is only built by
     `GameServer::processReceivedPackets`, the join handshake.

The header lies: `BFPlayer+0x4c` and `+0x50` were listed as vehicle and
camera in stage 2 and every kitNetId the old sampler wrote was actually the
free camera's id -- the cause of "every player has the same kit".

### Still open

- Playtest 2026-10-02 (Dylan, viewer): the parked AichiVal shows no
  propeller and no engine sound. A parked plane not spinning is the engine
  model working; the silent engine is the next item.
- Engine running/disabled flags and the throttle input were first read at the
  client's Engine offsets (`+0x15c`, `+0x15d`, `+0x124`) without server-side
  verification -- the silent engine note on a running vehicle is the symptom
  of that guess being wrong. The server's own layout (`+0x142` running,
  `+0x143` disabled, `+0x124` throttle input, confirmed live 2026-10-02:
  engines at revs 0.795 read running=1) comes from `Engine::handleMessage`
  `0x0823e730` / `Engine::handlePlayerInput` `0x0823e5e0`. RECORDER_DEBUG
  dumps one engine's dwords
  0x100-0x1c0 per process for exactly that check; the revs themselves
  (`pe+0xA0`) are verified. The consolidation briefly reverted this fix
  (rebuilt from pre-fix source); re-applied and re-verified 2026-10-02 in
  `replay_1790896490.ndjson` (1446 engine samples, all running=1, revs to
  1.15, zero running=0 samples).
- `st` aim pitch/torso twist are written as 0: the server's storage for the
  replicated aim was not found (the client's BFSoldierNetworkable offsets do
  not exist on the server's own BFSoldier). Soldier head-aim therefore does
  not track in replays; the anim state names table (`anim` line) is also
  unwritten, so states play by index.
- No run has had a real client connected. With one, a join's database
  (createPlayer for every player, createObject for every object, pickupKit)
  lands in the file on top of the sampler's synthetic roster, and the
  per-client senders' events (enterVehicle, exitVehicle, radio, damage)
  start arriving. The fan-out copies are dropped (`tests/run.sh` covers it
  with a fake target); whether the viewer copes with the join database's
  duplicates is unchecked.
- One build of the recorder (00:15 run, 2026-10-02) segfaulted the sampler
  during map load. The kit lookup's virtual calls from the sampler thread
  (a `std::map::find` racing the game thread) fit that, and are safe reads
  now. If it recurs, the coredump is the tool
  (`coredumpctl dump <pid> -o /tmp/core && gdb bf1942_lnxded /tmp/core`).
- A lab-stopped file has no `end` record: the server dies by SIGINT's
  default action, so no exit handler runs. Every line is flushed as written,
  so nothing else is lost.
- The w32ded target (`src/target_w32ded.c`) is built with -DREC_STAGE3=1:
  the addEventToSendQueue and sendGameEventToAll detours, the roster walk,
  engines, armor, tickets and kits, with several table rows still marked
  candidate there and in `w32ded-offsets.md` pass 4. fireBarrel's w32
  address is not located. Nothing past stage 1 is verified live, and never
  with a client connected.
- Config is read once at load; live toggle is later.

## Adversarial review (2026-10-03)

What a read of `src/` turned up, and what each fix was checked against.
`tests/run.sh` drives the core through a fake target (no server) and covers
the first four.

- **A client's join froze the server.** `ServerInfoEvent` (0x1a), sent to
  every joining client, closed the file from the game thread. The join's
  next events were held, and the sampler flushed them through `write_line`
  while it already held the write lock. That is a default pthread mutex, so
  the sampler deadlocked holding it, and the game thread's next write
  (a shot, a kill, the 10 s clock) hung on it forever. Reproduced with the
  fake target: `HANG`. Now a join is recorded and nothing more; splits are
  the sampler's; held events flush with the lock already held.
- **The game thread reset the sampler's tables mid-walk.** The same 0x1a
  path zeroed the tracking hash, the parts, players and soldiers while the
  sampler was using them.
- **Same-second files truncated each other.** `replay_<unix>.ndjson` was
  opened with "w", so a split in the same second as the last open
  overwrote that file (the reproduction lost the whole first file). A taken
  name now gets `-<n>`.
- **Every connected client duplicated every event.** See the
  addEventToSendQueue note above.
- **The part-state array could be overrun.** Part ids grew without bound
  (each re-keyed slot took a new one) and indexed a `MAX_PARTS + 1` array:
  heap corruption once a long round respawned enough vehicles. The state
  lives in the part's slot now, and slots of parts unseen for 5 s are
  reused.
- **Tables that filled for good.** The soldier table (128) and the kit
  watch (256) were never pruned. After that many spawns, new soldiers got
  no `st` lines and new kits no `o` record. The roster never noticed a player
  leaving, nor a reused pid with a new name. Soldiers are pruned every
  sample, done kits are dropped, and a player missing from three complete
  roster walks gets `destroyPlayer` (a renamed pid gets `destroyPlayer`
  then `createPlayer`).
- **Most gunfire was missing.** See fake rounds above: bot-on-bot fire
  away from humans never reaches `fireBarrel`.
- **Kill weapons were garbage.** The server's `ScoreMsgEvent` is packed:
  the weapon is payload +6 and the next field +10 (`ScoreMsgEvent::serialize`
  `0x0811c8d0`), not the client struct's +8/+12. Every kill had
  `weaponName ""`. After the fix, 65/65 kills of a Wake round match the
  server event log's weapons (49 `(none)`, AichiVal 8, Hatsuzuki 6,
  Corsair 1, Bar1918 1).
- **Smaller ones.** Template and level names went into JSON unescaped. The
  game-thread entry points assume 16-byte stack alignment that GCC 3.2
  callers do not give (`force_align_arg_pointer` now; this .so is built for
  SSE). `system("mkdir")` forked the server at every open (`mkdir(2)`).
  The lnxded installer published each trampoline pointer after patching
  its site (safe only because the constructor runs before any game thread).
  `build.sh` copied over the lab's `recorder.so` in place, rewriting the
  pages a running server executes (now an atomic rename). The w32ded
  `sendGameEventToAll` trampoline copied the whole 94-byte body, two
  `call rel32` included, which land in the heap once a client is connected
  (now a 10-byte prologue with nothing relative in it). Its fire stub read
  the return address as `this` (latent: no fire site yet).

Runs after the fixes (`~/bf1942-lab/runs/20261003-*`): Wake co-op 21 min
(31 MB, parts table flat at ~144, 163/163 kits with their `o` record); a
Wake round played to its end at 809 s and the server's next round (the file
closed 0.1 s after `gameStatus` 2, and the next opened with the new round's
world); El Alamein co-op 7.8 min (54/54 kits bound, a German bot's `ü`
the first non-ASCII name); Midway co-op 9.5 min (289 parts, 63 engines,
885 fire records); the final build through a 31-minute Wake round (file
closed 0.3 s after `gameStatus` 2: the split waits three samples); Wake with
the fake-round hook, a round over in 385 s (2802 `f`, 2481 of them fake;
12 of its 24 kills carry no weapon in the event log).

## Where things are at (handoff, 2026-10-02)

The consolidation is done. One shared core plus two thin target layers,
selected at build time (see "What exists" above):

- `src/core.c` + `src/core.h` — the config read, tracking hash, quaternion
  math, ndjson emitters, sampler, vanish logic, and the whole stage-3
  capture logic (detour callbacks, joints, engines, armor, tickets, kits,
  roster synthesis). Every address, struct offset and OS call goes through
  the `struct rec_target` table in `core.h`.
- `src/target_lnxded.c` — the lnxded layer: SGI-STL layouts, /proc/self/mem
  preads, ELF-constructor entry + pthread, and the stage-3 RWX-trampoline
  detours (`-DREC_STAGE3=1`). Stage 3 complete and verified live after the
  split (wake-coop 138 s, v5, all record kinds, viewer parse clean).
- `src/target_w32ded.c` — the w32ded layer: proxy `WINMM.dll`, MSVC
  (VC7/Dinkumware) layouts, IsBadReadPtr reads, DllMain + CreateThread,
  winmm IAT reroute (`-DREC_STAGE3=0`). Stage 1 only: its stage-3 code
  paths are compiled out and its detour layer is a deliberate no-op stub.

The old fork (`recorder.c`, `w32ded-recorder.c`) is gone; do not resurrect
it. The former ~250 copy-identical lines now exist once, in the core.

**The plan for whoever implements the w32ded stage-3 port** (do not copy
stage 3 -- it lives in the core already):

1. Cross-match the stage-3 sites and layouts through the anchor chain:
   the three detour targets (addEventToSendQueue, sendGameEventToAll,
   fireBarrel -- their addresses in `src/target_lnxded.c`'s defines), the
   playerManager/BFPlayer fields, the ScoreManager global, the Engine/
   PhysicsEngine and BFSoldier offsets, and the Armor component map.
   Fill them into `struct rec_target` in `src/target_w32ded.c` (the
   stage-3 rows are there, zeros where unverified).
2. Read a std::string: the lnxded shim is the SGI one-pointer shape
   (`src/target_lnxded.c`'s read_string); the Dinkumware shape for the
   w32ded shim is open (the template-name reader in the same file is the
   live-verified reference for template names specifically).
   Also parameterize `rbtree_find_value` in `src/core.c` (it hardcodes the
   SGI map-object shape -- header ptr at mapaddr, count at +4; an MSVC map
   object is laid out differently).
3. Replace the stub `install_detours` with a Windows mechanism (IAT
   patches or VirtualProtect byte patches; the /proc/self/mem RWX
   trampoline has no Windows equivalent) and set `-DREC_STAGE3=1` in
   build.sh's w32ded line when it lands.
4. The stage-3 header version (5) and the detour-driven write lock
   (`flush_each_line`) follow from step 3, not by hand.

Porting inputs, in reading order:

1. `w32ded-offsets.md` -- the anchor chain method (classManager IDs, culler
   strings, BObject ctor constants locate lnxded's named functions inside
   the stripped w32ded) and the cross-match table so far.
2. The lnxded stage-3 section above -- the capture surface to replicate and
   its lnxded offsets (also in `src/target_lnxded.c`'s table, with each
   field naming the accessor or ctor it was read from).
3. The lnxded "Still open" list -- several items (engine flags read at
   client offsets, `st` aim pitch unwritten) are guesses to re-derive
   server-side, not copy.

Not committed as of this note: README/w32ded-offsets.md edits, the w32ded
spin-bound fix, the untracking of `build/` artifacts.

## Windows server port (BF1942_w32ded.exe)

The same recorder runs inside the Windows dedicated server as a proxy
`WINMM.dll` (`src/target_w32ded.c`; derivation and evidence in
[w32ded-offsets.md](w32ded-offsets.md)).

**How it loads.** w32ded imports winmm (`timeGetTime` and friends). Windows
resolves DLL imports from the application directory before System32, so a
`WINMM.dll` built next to the exe is loaded by the loader itself; its
DllMain reroutes the game's winmm IAT entries to the real system winmm.dll
and starts the sampler thread. No injected code, no game logic touched; on
a Windows host nothing beyond copying the file, under wine the same file
loads. Antivirus may quarantine a locally placed `WINMM.dll` (hijacking is
also a malware technique) -- whitelist it on the server host.

**Offsets, cross-matched from lnxded.** The two servers are one source tree
compiled twice (GCC 3.2.3 vs MSVC 7): the classManager registration IDs
(`0xc355/6/7`, `0xc35b`), the culler error strings and the `BObject` ctor's
field constants locate lnxded's named functions inside the stripped w32ded.
Engine class layout carries over unchanged; the STL does not, and every
STL-typed read was re-derived from the w32ded disassembly.

| what | lnxded | w32ded |
|---|---|---|
| objectManager global | `0x0871dc24` | `0x0074c52c` |
| ObjectManager ctor | `0x08199650` | `0x004c8960` |
| registerObject | OM vtable+0xd8 (`0x0819b4a0`) | OM vtable+0xd8 (`0x004c7440`) |
| registered map | om+0x94, SGI: header ptr, node parent+4 left+8 right+0xc key+0x10 obj+0x14 | om+0xa0, MSVC: head +4 size +8, node left+0 parent+4 right+8 key+0xc obj+0x10 nil byte+0x15 |
| `BObject` fields | flags +4, template +0x4c, id +0x48, Mat4 +0x74 | identical (ctor `0x004d0220`) |
| ObjectTemplate name | std::string +8 (chars via one ptr) | getName = vtable+0x14, returns this+8; live reader: chars +0x0c, len +0x1c (62% of roots named) |
| hp / maxhp / criticalDamage | +0x100 / +0x104 / +0x160 | +0x104 / +0x108 / +0x164 (save `0x004fdc80`) |

**What the run showed.** Wine, Wake GPM_CQ: 844 root objects of 1,140
registered, movement at 10 Hz with sane Wake coordinates, destruction
lines, template names on 62% of roots (`PALMHIGH_M1`, `tankobs_ste_M1`,
`stebarbwire_m1`...). Same ndjson the viewer parses.

**Launch gotchas.** `+game bf1942` and a `mods/bf1942/init.con` copy are
required, or the server dialogs "couldn't find current mod from
maplist.con". w32ded's SetConsoleMode dialogs "couldn't change console
flags" when stdin/stdout are pipes with no console attached -- run it with
a real console/pty:

```
script -qec "wine BF1942_w32ded.exe +game bf1942 +restart 1 +dedicated 1" out.log
```

**Status.** Stage-2 equivalent: the object sampler, template names and
destruction only. The stage-3 surfaces (the three detours, joints, engines,
armor, tickets, kits) are not ported; each detour site needs its w32ded
address through the anchor chain in w32ded-offsets.md. With the lnxded
stage-3 work above landed, that port is unblocked.

Run it:

```bash
features/server-replay-recorder/build.sh            # build/WINMM.dll
# copy WINMM.dll next to BF1942_w32ded.exe with its game dir, recorder.con
# in mods/bf1942/settings/, then launch as above; the recording is in
# replays/ under the exe's cwd
```

Run it (linux):

```bash
features/server-replay-recorder/build.sh
features/server-replay-recorder/tests/run.sh      # the core against a fake target
python3 tools/bf1942-models/lab/lab.py start tools/bf1942-models/lab/scenarios/wake-coop-rec.json
# let a round run 60 s+, then:
python3 tools/bf1942-models/lab/lab.py stop
# stop copies the server's recordings into the run dir's server/ and the
# viewer's replays/<run>/, and prints a viewer URL for each
```

Scenarios with the recorder preloaded: `wake-coop-rec`, `elalamein-coop-rec`
(armour), `midway-coop-rec` (aircraft and ships), `mapchange-coop-rec`
(a Wake round to its end and the next, for the per-round split).

Check the result in the viewer (serve `tools/bf1942-models/viewer/` and open
`map.html?replay=replays/<file>.ndjson`), or assert the parse directly:
`import('/replay-recording.js')` in the page, `parseRecording(text)`, and
check `version==5`, `soldiers` with `kitTemplate`, `joints` (a Map: root nid
-> parts), `engines`, `fires`, `deaths`, `tickets`.

## Review: sampling, and the send path (2026-10-04)

The question: the bf42plus client recorder plays cleanly and the server's does
not (tanks slide, nobody sits in a vehicle, soldiers hold no pose). Is that
because the client's is event-based and the server's sampled, and should the
server recorder hook the path the server sends clients their updates by?

**Both recorders sample.** The client recorder writes positions, turrets,
engines and bodies by walking the client's applied world at 10 Hz on its render
loop (round-replay-capture §4A, §9, §19). Only the discrete story (joins,
kills, seats, kits) comes from the event stream. Its `s` records are 0.100 to
0.112 s apart. The server holds every field any client is sent, so sampling
it can lose nothing a client recording has. Every defect below is a field the
recorder does not read yet, not a limit of sampling.

### What the server file lacks, measured

El Alamein lab round (`20261003-214603`, `replay_1791027968`) against the
Bocage client recording `replay_20260928-133433`:

| | server | client |
|---|---|---|
| `p` (seat, root, triggers) | 0 | 2,912 |
| `enterVehicle` / `exitVehicle` | 0 / 0 | 210 / 154 |
| `control` into a vehicle seat | 0 of 153 (all soldiers or free cameras) | 187 of 367 |
| `anim` state table | none | once |
| Willy front wheel `j` | 68 | 1,880 |
| lower state `Lb_RunForward` among `st` | 0 of 3,158 | 8,457 of 20,279 |

- **Nobody in a vehicle.** The viewer seats a player from `p`,
  `enterVehicle` or a `control` into a seat (`replay-recording.js` `rootOf`).
  A server file has none, and a soldier aboard is a child object, so his root
  gets a `d` and `place()` (`replay-bodies.js`) draws him nowhere. Every hull
  has an empty crew: undriven, so a wheeled vehicle's derived steering is zero
  (wheels straight through every turn), and a static gun takes no audio slot
  for its rounds. The recorder watches `BFPlayer+0x68`. The control
  object the ghost manager replicates to a client is `getVehicle()`:
  `GhostManager::updatePlayerControlObject` `0x08142210` calls BFPlayer vslot
  0x3c, `BFPlayer::getVehicle` `0x080560c0`, which returns `+0x4c`.
  `BFPlayer::setVehicle` `0x08052310` stores its int argument, likely the seat,
  at `+0x54`. The trigger flags are `+0x148/+0x149` (§14 of
  round-replay-capture). Read in the disassembly, not yet live.
- **No poses.** With no `anim` line, `bodyAt` (`replay-recording.js`) finds
  no state, so every soldier reads as standing, not firing, reloading,
  swimming or lying. The server's state indices are the client's table: mapped
  through the Bocage file's, the server's lower 915 is `Lb_Lie` and upper 91
  `Ub_StandAimPanzershreck`, on AT kits.
- **Where the soldier's replicated state lives.**
  `BFSoldierNetworkable::getNetUpdate` `0x082246e0` writes from a ring of
  0x88-byte records at `*(net+0x4c) + idx*0x88`, `idx = *(net+0x28)`, `net`
  the soldier's networkable (`IObject+0x68`): position `+0x08`, velocity
  `+0x14` (mask 2), rotation `+0x3c` (mask 4), the aim pair `+0x68`/`+0x6c`
  (masks 0x10/8, the two values `st` writes as 0 today), lower and upper
  animation state `+0x70`/`+0x74` (masks 0x20/0x40), the Armor's value
  `+0x78` (mask 0x80). The recorder reads the body's own state machines at
  `BFSoldier+0x2b4`, where no locomotion state ever appears; the ring is what
  a client is sent.
- **Wheels and suspension.** The server does not rebuild a cosmetic part's
  transform, so `j` (read from the part's absolute transform) barely moves for
  steered wheels. `RotationalBundleNetworkable::getNetUpdate` `0x082345c0`
  sends the angles from `*(net+0x50) + idx*0x2c`. Springs
  (`SpringNetworkable::getNetUpdate` `0x08239190`) are not recorded at all.
- **Timing.** The sampler is a second thread reading through
  `/proc/self/mem`, waking every 1/30 s and stamping the wall clock at the
  start of its walk, while the game thread ticks at 30 Hz. In steady motion
  over 6 m/s, 19% of its 3-tick intervals hold 2 ticks of movement (the
  client's: 4%), about 0.3 m of jitter at 10 m/s. Its gaps are 0.096 or
  0.128 s (the client's 0.100 to 0.112), and the viewer holds a sample until
  0.1 s before the next, so every long gap is a 28 ms stop. A walk can also
  straddle a tick, and a Mat4 can tear.
- **Kills named nobody (fixed).** The recorder read the player id at
  `BFPlayer+0xc`, which is the player's network id (2p+1):
  `GameEventManager::createPlayer` `0x0812d080` writes `getId()`
  (`0x080560e0`, `+0x58`) as the event's player id and `+0xc` into the field
  after it. The roster, `control`, `pickupKit` and `f` carried 453..511, the
  score events 226..255, so no kill matched a soldier. Now `+0x58`: in
  `20261004-073008-elalamein-coop-rec` the 30 roster ids are the score
  events' and 12 of 12 kills name both players. The w32ded table cites the
  same builder for its `+0x0c` and is probably the same mistake; unchecked.
- **The sliding is mostly the bots.** The angle between a hull's heading and
  its travel is as wide in a client recording of a lab bot round
  (`replay_20260927-075756`: 29% of samples over 4 m/s more than 10 degrees
  off) as in the server's (32%). The humans of Bocage drive at 8%.

### Hooking the send path

The send is `GameServer::update` `0x08132940` ->
`processGameStateAndSendPackets` `0x08139420` -> per connection
`updateGhostManager` `0x08137710` -> `getRelevantObjects(conn, viewpoint,
viewDistance + 20)` `0x08137390` -> `GhostManager::update` `0x08141c70` -> each
object's `<class>Networkable::getNetUpdate`. As a data source it is worse
than the world:

- It runs once per connected client. A bots-only server sends nothing, which
  is why the `addEventToSendQueue` hook saw nothing in the lab.
- Each stream is one client's view: the radius plus his own side, at a
  priority-scheduled 20 Hz x 1044-byte budget. A tap of it is what bf42plus
  already records.
- It is a bit-packed delta stream against acknowledged baselines. Playing it
  means writing a reader for each of the 13 networkable classes (strategy C)
  and logging the acks too.

Two variants would work. A phantom connection inside the server (infinite
radius, unlimited rate, every packet acknowledged, transmit to a file) records
a lossless "server demo", but needs a fake player and viewpoint, and playing it
needs the 13 readers or a real client fed the demo. A real spectator client
(bf42plus recording, under wine) with the relevance radius lifted for its
connection (the radius is a float argument at the call in
`updateGhostManager`) gets client fidelity for the whole map with no new
decoding, at a client process and a player slot per server, and still without
tank shells and rockets (§13 of round-replay-capture).

### Recommended

Keep the server recorder. Use the send path as its clock and its spec:

1. Sample on the game thread: detour `processGameStateAndSendPackets`, which
   runs every frame after the tick and before the send. Sample every third
   tick, stamped with the tick count. No `/proc/self/mem`, no torn reads, no
   races with the game thread.
2. Read each field where `getNetUpdate` reads it: the soldier ring (aim,
   states, velocity), the RotationalBundle ring, springs, and `getVehicle`
   `+0x4c` / `+0x54` / the triggers for `p`. Write the `anim` table once a
   file.
3. Take the 13 `getNetUpdate` functions as the checklist: a server field for
   every mask bit is parity with any client.
4. Write the velocity into `s`. The viewer can then ease between samples on a
   curve, which no client recording allows.

## The best capture (2026-10-04)

The owner's follow-up: cost is no object and the POC is not the design; what
captures a round at full fidelity? Three readings settle it (ledger P-3, P-4,
AI-135):

- **Inputs alone cannot rebuild a round.** The bots' scheduler runs tasks
  until the wall clock passes a frame budget, and the random numbers are
  seeded from `time(0)` (AI-135). The truly event-based recording, inputs
  plus a re-simulation, is out.
- **The server builds a client's view of an object only while a client
  ghosts it.** A probe recorder on a bots-only round read every soldier's,
  turret's and steered wheel's replication ring: index 0, default values, in
  every sample (P-3). Hooking the send therefore records nothing without
  clients, and with clients only what each is sent. The fields those rings
  are copied from are all live on the server objects, and the copy routine
  (`updateStateMask`) is the engine's own list of what a player can ever be
  shown (P-4).
- **The client derives some of what it draws.** Bots on a bots-only server
  never reach `Lb_RunForward` in the state the server would send; a client
  recording of a lab round shows bots in it 18% of the time. Either the client
  computes locomotion from motion, or the server simulates a bot far from any
  human in less detail (its AI LOD, which also makes its fire fake, AI-134).
  Open.

### The options, ranked by what they can hold

| | Coverage | Rate | Precision | Server truth (projectiles, hits) | Client-derived cosmetics |
|---|---|---|---|---|---|
| Inputs + re-simulation | everything | any | exact | yes | yes |
| **Omniscient state capture in the server** | every object | every 30 Hz tick | unquantized | yes | derived by the viewer |
| Spectator client, relevance lifted | every object, if the budget allows | 0.1 s ghosts (P-2) | wire-quantized | no (its own re-simulation) | yes |
| Tap or phantom connection on the send path | what the connection is sent | 0.1 s | wire-quantized | no | no |

The first is impossible (AI-135). The spectator client's ceiling is the
wire's: one 1,024-byte send stream per connection (J-1) carrying the whole
map, so the priority scheduler starves the far objects. It also needs a
client process and a player slot per server, and whether a spectator raises
nearby bots' AI LOD, and so changes the round it records, is unread. The tap
records less than the rings it serializes.

### Recommended: the omniscient state capture

A recorder in the server that does, every tick and for every object, what
`updateStateMask` does for one connection's relevant set, and keeps what no
client is sent:

1. **Clock.** On the game thread, after each `simulateFrame` (GameServer
   vslot 0x140, D-1), stamped with the tick number. Direct reads (the game
   thread owns the world), no `/proc/self/mem`, no torn transforms.
2. **The client-visible state, unquantized.** Per networkable class, the live
   fields its `updateStateMask` copies: soldiers per P-4, vehicles
   (`SimpleObjectNetworkable`), turrets (`RotationalBundleNetworkable`),
   wheels and suspension (`SpringNetworkable`), engines, control points,
   kits, projectiles. The 13 classes are the checklist.
3. **The server's truth.** Every projectile in the projectile map each tick
   (flight and impact, which no client has: a client flies its own copy),
   every damage application with attacker, weapon and amount, every shot real
   and fake, each bot's AI LOD (so the viewer knows when the server itself
   simplified a bot), the seats (`getVehicle` `+0x4c`, `+0x54`), and each
   player's consumed `PlayerAction` (D-3), the input every client cosmetic is
   derived from.
4. **The events,** as now, plus the join database synthesised at file start.
5. **Binary records** into a buffer on the game thread, compressed and
   written by a writer thread; a converter to ndjson for the viewer.

The viewer derives the cosmetics a client computes (locomotion, steered
wheels) from motion and input. It does that today for client files that
lack them.

### Experiments, in order

1. **The parity oracle.** One lab round with a human client recording beside
   the server recorder. Every record in the client's file, for objects in its
   relevance set, must be reproducible from the server's. It settles P-4's
   open question and is the acceptance test for the capture.
2. **Server projectiles.** Walk the projectile map per tick; check real
   rounds' flights against the event log's kills.
3. **AI LOD.** Record it per bot; a lab round with the LOD manager disabled
   (`AILODManager::lodEnable` `0x08476290`) shows what full detail looks like
   on a bots-only server.
