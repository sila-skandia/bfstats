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
["Where things are at (handoff)"](#where-things-are-at-handoff-2026-10-02)
first -- it states the two-source situation and the consolidation plan.

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
- `addEventToSendQueue` events only exist when a real client joins
  (`sendDatabase`): on a live server with human players the joins, and the
  `createObject`/`destroyObject`/`pickupKit` flows it drives, will arrive as
  real events on top of the sampler's synthetic ones. Check for duplicates
  on the first real-server run.
- One build of the recorder (00:15 run, 2026-10-02) segfaulted the sampler
  during map load; the same feature set in the final build ran 100 s and
  3+ min clean twice. If it recurs, the coredump is the tool
  (`coredumpctl dump <pid> -o /tmp/core && gdb bf1942_lnxded /tmp/core`).
- The w32ded target (`src/target_w32ded.c`, built with -DREC_STAGE3=0)
  has none of stage 3 -- the three detours, parts, engines, armor, tickets and
  the kit derivation. Its object sampler, template names and destruction
  are verified live (see the Windows server port section above); every
  offset above was read from the lnxded binary and the w32ded cross-match
  table so far is in `w32ded-offsets.md`, with the same anchor-chain method.
- Config is read once at load; live toggle is later.

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
