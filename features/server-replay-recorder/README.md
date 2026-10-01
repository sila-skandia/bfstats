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

## What exists

- `src/recorder.c`: the recorder (plain C, `gcc -m32 -shared`).
- `src/w32ded-recorder.c`: the same recorder ported to the **Windows
  dedicated server** (`BF1942_w32ded.exe`, retail v1.61), built as a proxy
  `WINMM.dll` that the exe loads by name (Windows search order; winmm
  imports rerouted to the system dll). Derivation and live run:
  [w32ded-offsets.md](w32ded-offsets.md).
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
| `BFPlayer`: id / name / ai / team / vehicle / camera / controlled / kit | u16 `+0xc` / string `+0x44` / byte `+0x78` / `+0x7c` / `+0x68` / `+0x74` / `+0x68` / (not a field) | `getId` `0x080560e0`, `getName` `0x08056070`, `getIsAIPlayer` `0x08056120`, `setTeam` `0x080556b0`, and `GameEventManager::createPlayer` `0x0812d080`: the event's `vehicleNetworkID` comes from the object at `+0x68` (the soldier on spawning, the free camera on death is `control`), `cameraNetworkID` from `+0x74`, and the kit is NOT a BFPlayer field -- the builder takes it from the soldier's template (class id 0x9493 via the template's getClassID slot, vptr+0xc), then `getKit` (vptr+0x17c) -> objectManager lookup (vptr+0x20, fallback +0x24) |
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

1. **Three game-thread detours** (RWX trampolines, patched through
   `/proc/self/mem`; each site's bytes are checked before anything is
   written, and a mismatch skips the hook):
   - `GameServer::sendGameEventToAll` `0x08153b10` -- every to-all event once:
     kills (`score` with the weapon's template name), chat, radio,
     gameStatus, gameRules, the 10 s world clock. This is the event surface
     the client recorder reconstructs from the wire; here it is captured at
     the source. NOTE: `GameEventManager::addEventToSendQueue` `0x0812d730`
     is also hooked but is dead in the lab -- createPlayer, createObject,
     destroyObject and pickupKit are only *built* for a real client's join
     database (`GameServer::sendDatabase`), never streamed as events, so a
     recorder that starts with the round sees none of them. The sampler
     synthesises the roster (createPlayer/control) and kits itself instead.
   - `FireArms::fireBarrel(IPlayer*, Mat4&, int)` `0x0828aba0` -- every round
     any player or bot fires, as `f` records with the weapon template, its
     root's net id and the firing player's id (`getBFPlayer 0x08052ac0`).
     This is the gunfire sound timeline, and on the server it is every shot
     on the map, not one client's ~520 m window.
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
     replicates `GameEventManager::createPlayer`'s kit lookup (template
     class id 0x9493 -> `getKit` -> objectManager) and writes a
     `pickupKit` event plus the kit object's own `o` record -- which sits
     DISABLED in the registered map until dropped, so the watch pass emits
     it however it is flagged. A live run: 33/33 pickups bound, and the
     viewer parsed 30/30 soldiers with distinct kit templates (Medic,
     Scout, Engineer, AT, Assault, both sides).
   - The format is v5 (`jn` needs it for keyed parts), and a mid-round
     seek keeps one file per join like the client recorder.

The header lies: `BFPlayer+0x4c` and `+0x50` were listed as vehicle and
camera in stage 2 and every kitNetId the old sampler wrote was actually the
free camera's id -- the cause of "every player has the same kit".

### Still open

- Playtest 2026-10-02 (Dylan, viewer): the parked AichiVal shows no
  propeller and no engine sound. A parked plane not spinning is the engine
  model working; the silent engine is the next item.
- Engine running/disabled flags and the throttle servo are read at the
  client's Engine offsets (`+0x15c`, `+0x15d`, `+0x124`) without server-side
  verification -- the silent engine note on a running vehicle is the symptom
  of that guess being wrong. RECORDER_DEBUG dumps one engine's dwords
  0x100-0x1c0 per process for exactly that check; the revs themselves
  (`pe+0xA0`) are verified.
- `st` aim pitch/torso twist are written as 0: the server's storage for the
  replicated aim was not found (the client's BFSoldierNetworkable offsets do
  not exist on the server's own BFSoldier). Soldier head-aim therefore does
  not track in replays; the anim state names table (`anim` line) is also
  unwritten, so states play by index.
- `addEventToSendQueue` events only exist when a real client joins
  (`sendDatabase`): on a live server with human players the joins, and the
  `createObject`/`destroyObject`/`pickupKit` flows it drives, will arrive as
  real events on top of the sampler's synthetic ones. Check for duplicates
  on the first real-server run.
- One build of the recorder (00:15 run, 2026-10-02) segfaulted the sampler
  during map load; the same feature set in the final build ran 100 s and
  3+ min clean twice. If it recurs, the coredump is the tool
  (`coredumpctl dump <pid> -o /tmp/core && gdb bf1942_lnxded /tmp/core`).
- `src/w32ded-recorder.c` (the Windows server port) is still stage 2: it
  has none of this -- the three detours, parts, engines, armor, tickets and
  the kit derivation. Every offset above was read from the lnxded binary;
  the w32ded offsets will differ and `w32ded-offsets.md` has the method.
- Config is read once at load; live toggle is later.

Run it:

```bash
features/server-replay-recorder/build.sh
python3 tools/bf1942-models/lab/lab.py start tools/bf1942-models/lab/scenarios/wake-coop-rec.json
# let a round run 60 s+, then:
python3 tools/bf1942-models/lab/lab.py stop
# the recording is in ~/bf1942-lab/server/replays/ (copy into the run dir by hand;
# lab.py stop does not stage the server's replays/ yet)
```

Check the result in the viewer (serve `tools/bf1942-models/viewer/` and open
`map.html?replay=replays/<file>.ndjson`), or assert the parse directly:
`import('/replay-recording.js')` in the page, `parseRecording(text)`, and
check `version==5`, `soldiers` with `kitTemplate`, `joints` (a Map: root nid
-> parts), `engines`, `fires`, `deaths`, `tickets`.
