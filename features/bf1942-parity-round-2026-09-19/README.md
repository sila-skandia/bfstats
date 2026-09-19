# Parity round, 2026-09-19: what is left, and who has it

The single place to look for the state of the BF1942 viewer work. It supersedes
the ranked list in [`parity-gaps.md`](../bf1942-3d-models/parity-gaps.md) (dated
09-15) and the two later status files, which disagree with each other. Every row
below was checked against the code or the extracted tree on the date shown, not
copied from a document. The lead edits this file; streams do not (see
[BRIEFING.md](BRIEFING.md)).

## Landed on 2026-09-19

| What | How it was checked |
|---|---|
| The working tree was red: 9 of 1,068 tests. Now 1,116 green, plus 388 API tests | `./scripts/verify.sh --skip-e2e` |
| A `trigger Volume` gun layer replayed every time its sample ended (a PanzerIV cannon is 22 such layers). Now a per-round latch | `test_engine_audio_default.mjs`, shaped on the real layer |
| Splash damage was emitted, stamped on the hit record, implemented in `VehicleDamageSet.applySplash`, and never called. `map.html` now routes a blast through it | `SplashDamageTests` |
| `addSkeletonIK` was gathered onto the vehicle root, once per child of the declaring part. Now exported on the declaring node (`WillySteeringDummy`) | `SkeletonIkExportTests` |
| `extract_loading_assets.py`: `rem` inside `levels/remagen/` read as a comment; `reloader.tga` answered for `loader.tga`; `__wake__` lost its title. Committed red in `471ced3` | `test_adversarial_loading_assets` |
| Four finished branches sat unmerged since 09-17: `parity/envmap`, `parity/sounds`, `parity/tickets`, `parity/muzzle` | trial-merged, 1,116 green, merged |
| A fifth piece sat **uncommitted** in the `parity/muzzle` worktree: `spawnPointManager.groupTeam`, ship deck spawns (`vehicleSoldierSpawns`), deploy-screen ring and footer fixes, the debug sidebar collapsed | rescued as `parity/deploy-spawn-points`, merged, page smoke-tested on Wake |

## Open, by stream

Status words: **open** nothing exists; **data** the extractor emits it and the
viewer ignores it; **re-extract** the code is merged and the published tree
predates it.

### New: BF1942 in the browser (stream A, stream B)

A separate site for playing the maps, apart from the mesh model browser. Design
and findings in [`../bf1942-in-the-browser/README.md`](../bf1942-in-the-browser/README.md).

| Item | Status |
|---|---|
| The game's own Singleplayer > Instant Battle screen (`menu/SkirmishMenu`), drawn from the game's layout, textures, fonts and strings, that picks a level and a team and launches the map | **merged** `a02122c` (built, then reviewed: titles now come from the lexicon's English column, `?team=` wins over the flag tally, fonts proved against a real in-game frame). Page at `viewer/play/`; pack extracted to `maps/_shared/hud/menu` with `extract_menu_layout.py` |
| A new site, separate from `mesh.bfstats.io`, at `play.bfstats.io` (hostname confirmed by the owner) | **deferred by the owner, 2026-09-20: he will deploy it himself later. No agent work on deployment until asked.** For when that happens: The stream wrote a second nginx pod; held out of main by `458d62c` because memory limits already total 7,296Mi of 7,741Mi (445Mi headroom against the ~1.5Gi rule). The review recommends the existing mesh nginx answer both hostnames: it needs a second `server` block, a real `server_name mesh.bfstats.io` plus `listen 80 default_server` on the existing one, an HAProxy host ACL and a tunnel entry. Not written yet; nothing applied |
| The map page's debug panel hidden from a regular player | **merged** `9ee8289`: panel and fab are absent until `show.dev 1` (or `?dev=1`); the controls stay in the DOM so every headless hook still works |
| The in-game console on the tilde key, with `show.dev 1`, `show.dev = 1`, `show.dev 0` | **merged** `9ee8289`, reconstructed from both binaries ([console.md](../bf1942-in-the-browser/console.md)): no animation, band = `(lineHeight+1)·lines+4` px over at most 20 lines, `white.tga` at alpha 0.8, the game's own `BF1942.font`, the two-line error with an empty working file, a counter that stays constant at the prompt. `=` is a documented one-token tolerance; the engine accepts none. **Decided by the owner, 2026-09-20: tilde opens the console, and only tilde.** The game also binds it to Caps Lock (and 1.61 has no spawn-screen key at all), but the page keeps Caps Lock for redeploy; that is a deliberate departure, not an oversight |

### Vehicle occupants (stream C)

| Item | Status |
|---|---|
| A driver or a gunner is drawn, and his hands stay on the wheel | **merged** `fcf0131`. `addSkeletonIK`'s offsets are in the frame of the child added most recently before the line (IK-1), yaw/pitch/roll in degrees (IK-2), solved as a two-bone reach then a hand-rotation override (IK-3). A seat draws its occupant iff its PCO subtree reaches a `SeatObject` (SEAT-25), which is why a Sherman's driver is invisible and its hull gunner shows from the waist. The occupant wears his kit (`viewer/kit-graft.js`). **Re-extract** needed: the published scenes carry no `skeletonIK` nodes |
| Every published seat pose lay on its back, 0.84 m off its seat | **fixed** in the same merge (root rotation derived as a half turn about (0,1,-1)/sqrt2; the `.baf` root track's standing offset dropped). Passengers were affected as much as drivers. **Re-export** running. Road to Rome now resolves 50 of 50 (its `PassengerInM3GMC` state exists in no animation file; the engine's fallback is reproduced) |

### Viewer wiring for data that now exists (stream D)

| Item | Status |
|---|---|
| `envmap true` on 435 materials | **merged** `bf212b8`. The renderer has no reflectivity constant: `out = lit·A + cube·(1−A)` with A the diffuse texture's own alpha (`D3DTOP_BLENDCURRENTALPHA`, ledger EM-1), camera-space reflection vector (EM-2). Paint reflects under 5%, the Zero's canopy about half. Two shader programs added on Wake, none per frame |
| Ticket counters | **merged**, drawn through the layout's own `ShowTicket` group on the spawn screen and the HUD with the level's nations. **Re-extract** needed for the published levels to carry `tickets`. A live bleed needs a death count and a flag-majority timer the viewer does not have |
| The combat area | **merged.** It is real data in **11 of 23** vanilla levels, not 23: the key is present and `null` in the other twelve. Server rule: 10 s allowance, then 5 HP/s, strictly past the allowance, to the object the player occupies (the hull when seated, CA-7), inclusive edges, altitude never bounded (CA-6). The warning is `menu/InGame`'s own string, misspelling included. Not modelled: the terrain-material test (`materialToGiveDamage`, default 7, CA-5) |
| Sun lens flare and corona | **merged**: parsed for 319 levels in 11 mods. **No vanilla, XPack1 or XPack2 archive ships any of the five flare textures** (all 1,775 archives searched), so the real game shows no ring ghosts either; drawn only where the art exists (bfheroes). Placement is inferred, not read |
| A HUD leaf gated by `>` or `>=` was drawn unconditionally (`condOk` fell through to `true`) | **fixed** in the same merge. It would have put the combat-area warning across every HUD, and had been drawing six weapon-bar slots for a four-item kit |

### Engine research (streams F1 to F3, then verifiers)

**All three reported and all three were independently re-derived (2026-09-19).**
The verdicts overturned several of the reports' own conclusions, so the
verdicts, not the reports, are what is being integrated, on a branch, into
`ledger.md`, `symbols.json` and the subsystem docs. The code changes that
follow are being written up as [`viewer-changes.md`](viewer-changes.md), the
brief for the next build wave. A second session ran a collision-response round
the same evening (`subsystems/collision-response.md`, ledger COL-2 to COL-12);
it independently confirmed the friction budgets and the fall-damage formula,
closed the terrain-material half of the fall-damage question (terrain
`materialDamage` = 30 for all 16 terrain ids), and gives "ground vehicles have
no hull collision" an engine spec.

The ledger has 200 rows. Ten are `open` and nine more are confirmed with an
unread part. The Ghidra bridge is up and the hash matches.

| Stream | Rows |
|---|---|
| F1, damage | **HP-9** explosion falloff inside the radius (the splash formula merged today is the Mod Development Toolkit's linear one, not the binary's); **HP-13** what the client HUD does with Armor status 0x13/0x14/0x15; **SUP-15** what reads `healFactor` and friends; **SUP-17** the in-world supply icon draw path; the fall-damage per-surface material scalar ([groundwork](../bf1942-3d-models/fall-damage-research-groundwork-2026-09-17.md)) |
| F2, vehicle HUD and seats | **VHUD-9** what sets `ShowTurretIcon`, and `IconLookRotation`'s unit, sign and pivot; **VHUD-10** live ammo for a driver's own guns; **HUD-10** `setHudAmmoType` to `Ammo/AmmoType`; **SEAT-11** the `force` value at the seat-switch call; **GUN-2** the turret integrator's closed form; **TANK-4** the gear-ratio curve values |
| F3, movement | **PHY-1** where a jump becomes upward velocity (the client predicts it; the server computes none); **PHY-2** friction force magnitudes per grip class; the car spring and tyre integrator starting at client `0x0057f0d0` |
| Wave 2 | **MMAP-1/2** who writes the minimap zoom and yaw; **LM-3**; **SM-5**; **MEME-11** (80 of 230 menu pages read clean); SIDE-1, SIDE-3 |

### Wave 2, running (launched 2026-09-20)

Built from the verified brief, `viewer-changes.md` (on the integrator's branch
until the other session's corpus work is committed).

| Stream | Owns |
|---|---|
| W2-A movement | jump impulse 6.0 and its arming, the speed ramp, fall damage from the damage tables (`physics.js`, `soldier.js`, the on-foot code in `map.html`) |
| W2-B damage | the two-path explosion rule, integer radius, wreck and critical input gating (`effects-core.js`, `gunfire.js`, `vehicle-damage.js`, `assemble.py`) |
| W2-C turrets and HUD | the velocity-servo `TurretAxis`, `continousRotationSpeed`, `automaticReset`, the wrap rule, `setHasTurretIcon`, `setVehicleIconPos` and the seat dots, the paired dial-sign fix, `aticon` feeds 2 (`seats.js`, `hud.js`, `con.py`) |
| W2-D drivetrain | the gear ladder from the engine's curves, material-sourced friction with the 2.25 / 1.5 hysteresis, the spring law, a hull-collision plan (`ground.js`) |

**Wave 2 lands on `main`.** The collision round's files were committed and
pushed by their own session on 2026-09-20 (`47b273d`, `465ac93`), which unblocked
everything parked on `mesh-wave2`.

| Merged | State |
|---|---|
| W2-A movement | `11042c0`. The review fixed the jump's backward kick (it was taken off a velocity the friction stand-in had just overwritten, so a jump against a wall drove into it), proved the receding-contact skip cannot tunnel, and showed the old `main` had two failures this removes: a body frozen in mid-air at -10 m/s on Wake and an un-jumped 7.5 m/s launch in Berlin |
| The verified research corpus | `5224262`, merged beside the collision round's. `symbols.json` merged by address from the three versions, not by text: 14 corrections, 95 new, one overlap, 1,119 symbols and 222 ledger rows at that point. **A second pass on 2026-09-20 integrated what the two build waves' reviews and the gearbox verifier found** (the console, skeleton IK, the envmap stage, the combat area, the contact-recycle rule, the gearbox and what really propels a tank): **1,184 symbols, 258 ledger rows, no duplicate ids**, three new subsystem write-ups (`console.md`, `skeleton-ik.md`, `combat-area.md`), and `viewer-changes.md` marked 29 of 29 done with an "Open after wave 2" list of 12. One claim went in as a single-reader OPEN row, LOOP-1 (the server's main loop as 60 Hz with a measured frame dt), not as fact. PHY-2's one open disagreement is settled in the row: a vehicle's friction load term is the averaged contact **normal** at `+0x68` (the collision round had it right, an earlier label had it wrong) |
| W2-D drivetrain | `db7b9b9`. Gear ladder from the engine's two curves; per-surface friction from `materialFriction` with the 2.25 / 1.5 hysteresis; springs at 1.5x along the hull's own +Y. The review retracted a wrong claim (a soldier's friction load is NOT always zero: `BFSoldier::handleCollision` writes it at `0x0827d52f` by integer `mov`, invisible to the scan that said otherwise), fixed a parked-vehicle creep (0.74 m / 10 s -> 0.000) and a damper that went blind on every re-contact. **Top speed was then re-derived by a dedicated verifier**, because the reviewer's own reading of `Engine::handleUpdate` moved the Willys from 46.5 to 108 km/h: confirmed. `T = ratio x revs` in metres per second, no wheel radius; a car's revs run to 1.2, a tank's are clamped to 1.0 in `getCurrentDifferentialRPM`. Willys 112.6 km/h, M3A1 67.0, Sherman 53.6, Tiger 46.9 against real 105 / 72 / 48 / 45. TANK-1 and TANK-7 are refuted (ledger rows pending integration): `getEngineType()` is virtual and called nine times, and `updatePhysics` returns at once for a car or a tank. `_shared/damage.json` regenerated in all four trees with `friction` |
| W2-C turrets and HUD | `7032b3e`. `TurretAxis` is the engine's velocity servo; every time through 90 degrees is identical before and after (Sherman 0.667 s, MG42 0.333 s) and post-flick coast falls from 19.7 to 0 degrees. Dial sign fixed as a pair, byte-identical at +90, -90, +45 and 180; dial only for `setHasTurretIcon` hulls in the inside view; seat dots from `setVehicleIconPos`; `aticon` feeds 2. The review stopped stale extracts from drawing six dots in a placeholder staircase. **Needs one more re-extract of vehicles** for `hasTurretIcon` and `vehicleIconPos` to reach the page |
| W2-B damage | `2497920`. Two-path explosion rule (impact iff `damageType 1` and `hasCollisionEffect`; end of life for types 1 and 4, which is how grenades, the explosives pack and landmines go off), integer radius (`radius 0.25` really is 0: the console's `>> int` has no error path), blast centre 0.1 m off the surface, wreck and critical input gating for `drive()` and `pilot()`. Measured on the page: a shell's splash took an M10 7.86 m away from 100 to 76.18 HP (closed form 76.19); a critical turret traversed at exactly 0.2000. The review fixed two live bugs the fuse path had introduced: flak shells rested on the ground and burst 20 m of splash (their `hasCollisionEffect` is not dead: `Projectile::handleCollision` recycles a round on `dieAfterColl \|\| hasCollisionEffect` without exploding it), and a placed explosives pack or landmine detonated by itself after 20 s on an old recycling timer. **The 0.2x seam is patched in the same merge**: spent once, in `TurretRig.step`, after the clamp; a rig-level test pins 0.2 for a slow hand, 0.2 for a saturating one, and zero travel for a wreck |

Carried from that review, not yet acted on:
- **The tick rate claim needs a second reader before it enters the corpus.** The
  reviewer reads lnxded's `g_simulationFps` (30.0, `0x08716b5c`, never written)
  as a scale constant that `Setup::initEngine` doubles into a 60 Hz main loop
  whose frame dt is the *measured* elapsed time (`0x080bc632`, `0x080bc0b0`,
  `0x080bc0f8`), with no fixed-step accumulator below it. If so, PHY-1's 1.12 m
  apex and PHY-6's 0.212 s are the figures at 30 fps, not constants, and the
  corpus README's "game loop settled (30 Hz)" needs qualifying. The viewer keeps
  its own fixed 60 Hz soldier tick either way, now proved identical at 23.7, 30,
  60 and 144 fps.
- Landing on a building costs 3.3x landing on sand (materials 117/118 carry
  `materialDamage 1.0` and `damageMod 0.1` against terrain's product of 0.030):
  what the shipped tables say, newly visible now that the fitted constant is gone.
- Wake's fleet flags (Shokaku, Hatsuzuki) put the soldier in the sea at y = 95
  in both builds: the carriers are not in the static collision index at those
  spawn points, so there is no deck to land on. `North_Base` and `South_Base`
  refuse a jump in both builds. Both predate this round.

### Wave 3, running (launched 2026-09-20)

From `viewer-changes.md`'s "Open after wave 2" and the table below. Same
shape as before: each build gets an adversarial review, each research claim a
second reader, and nothing merges untested.

| Stream | Owns |
|---|---|
| W3-A drivetrain | a tank driven through its tracks (the EngineGrip target on its bogies with the `& 4` differential, capped at 1.0; no hull thrust exists for a ground vehicle), revs as the engine's per-tick filtered state, the 1.2 ceiling gated on engine type, RollGrip in place of the invented cornering stiffness (`ground.js`) |
| W3-B blasts | an explosion hurts a soldier, by the engine's exposure sampling; a grenade bounces, from `materialElasticity` and the projectile's own collision response; the combat area's terrain-material half (the viewer does carry the material map) |
| W3-C game modes | every mode directory a level ships, as a gameplay layer over the shared scene; `map.html?mode=`; Instant Battle launching `SinglePlayer` where a level has one |
| W3-D sounds | the sound scripts on effect bundles: impacts, ricochets, explosions, vehicle deaths, with a bounded voice count |
| W3-E mod chrome | per-mod HUD pack, layouts, fonts and strings along `game.addModPath` (EoD's nations above all); and `verify_models.py` made to tell the truth |
| W3-F research | LOOP-1's second reader (what the simulation's time step really is, server and client), GUN-2b (mouse counts to `PlayerInput`, and whether `TURRET_SPEED_SCALE = 4` is explained), the console's open items |

**W3-F has reported and been verified (2026-09-20).** Reports:
`scratchpad/reports/w3f-research.md` and `w3f-verdict.md`. Not in the corpus
yet - it goes in with wave 3's corpus pass, and the verifier's wording is the
binding one where the two differ.

- **LOOP-1 closes: fixed 30 Hz, `dt = 1/30` exactly, on both binaries.** The
  first reader found the frame loop (`Setup::mainLoop`, measured dt) and missed
  the accumulator one call below it (`Setup::updateInputs` `0x080bc540`,
  client `InputManager::update` `0x0049ce70`). Only the tick dt reaches
  `simulateFrame`; the frame dt reaches `handleFrameUpdate` (object vtable
  `+0x50`, one slot below `handleUpdate`) and an FPS ring. A backlog above 9-10
  ticks collapses to one; dt is never stretched. The "if LOOP-1 holds"
  qualifiers on PHY-1 and PHY-6 come off.
- **GL-2**: the ledger has `0x00466e31` (60.0f) and `0x00466e43` (100.0f) swapped.
- **GUN-2b closes, and not the way the researcher wrote it.** The verifier read
  the DX8 mouse device (`update` `0x0066ffe0`): the axis is a **rate**,
  `input = 0.001 x counts-per-second x (5 x sensitivity + 0.1)`, held for every
  tick of the frame (a `dt = 0` pump leaves the registers alone), then clamped
  to +-16 and quantised to 4096 steps for local players too. Defaults 0.25 on
  foot, land and sea (scale 1.35), **0.75 in aircraft** (3.85). The
  researcher's per-frame-count formula, "one tick per frame gets the mouse" and
  "4 is 5.4 under-fitted" are all refuted. `TURRET_SPEED_SCALE = 4` has no
  basis; the scale belongs at the input stage. Still unproven: that a browser
  `movementX` pixel is one DirectInput count.
- Refuted details that must not be pasted: `BasicPhysicsSystem::update` is a
  live (empty) vtable slot, not unreferenced; `+0x64` is
  `getUpdateFrequencyType`, not `getUpdateFrequency`; the server's 15 ms yield
  depends on `Setup+0x216`.
- The console's open items were not reached.

Queued from this: a viewer stream that replaces `TURRET_SPEED_SCALE` with the
rate formula at the input stage (`seats.js`, the mouse handler in `map.html`),
with the +-16 clamp, per-seat-class sensitivity, and the same value fed to
every tick of a frame. **Launched as W3-G** once W3-B and W3-D reported; it
also researches what `BFSoldier` does with the mouse-look axis on foot, so
`LOOK_SENS` can go the same way if the law can be read.

W3-B (blasts) and W3-D (sounds) have reported and are each with an adversarial
reviewer in their worktrees. W3-B's reviewer is told to settle, from the
binary, where the combat area's material-7 compare gets its material from
before that half ships on: it covers 84% of Berlin's rectangle.

### Not yet assigned

Hull collision between ground vehicles and the world has an engine spec
(`subsystems/collision-response.md`, the other session's round) and a plan
(`features/viewer-ground-hull-collision/README.md`); it is the largest piece
left and is not in wave 3.


| Item | Status |
|---|---|
| Game modes other than Conquest: `find_gameplay_mode` picks one. 1,420 vehicle and 1,736 soldier spawns unread. Instant Battle in the real game runs the `SinglePlayer` layout, so this feeds stream A | open |
| Mod HUD chrome: `extract_hud_pack.py` and `extract_spawn_layout.py` read `Mods/bf1942` only; 16 mods ship their own `menu.rfa` | open |
| Impact and explosion sounds: the bundles carry `loadSoundScript`, the samples are not extracted | open |
| Debris falls through the ground (particles have no collision) | open |
| No dynamic shadows (`castShadow = false` is the only hit) | open |
| `poses.html` cannot fire a weapon (never imports `GunFire`) | open |
| Spawn-pad soldiers are decoration; crouch and prone play the standing aim | open |
| Ground vehicles have no hull collision; every drive constant is `[free]` until a drive is recorded in wine | open |
| A tank's external camera follows the hull, not the turret | open |
| Seat-occupancy dots unfed (positions are live-bound per vehicle) | open |
| SCORE BOARD opens nothing | open |
| Minimap zoom (N) and rotating mode | open, blocked on MMAP-1/2 |
| Deploy-screen kit row labels should come from `setKitName` | open |
| `Water.baseTex`, `envmapcolor`; `aiMeshes.rfa` hulls; palm trunk collision; `c_CGProjectiles` / `c_CGLadders`; `LightmapShadowBits.lsb` (format unknown); Berlin's ground outside its four tiles | open |
| Bar1918 round counter never decrements (`task_4b7d2a66`) | open, unreproduced |
| `verify_models.py` is stale: on the 09-19 vanilla rebuild it calls 42 of 96 models broken, every one a false alarm. It counts projectile, tracer, trail, cockpit and emitter helper nodes as "unbound parts piled on the origin", measures a rifle's length across them (Bar1918 2.02 m against 1.19 m), and does not understand a skinned soldier. Checked by eye: `BritishSoldier`, `AichiVal` and `Bar1918` render correctly. A verifier that always says broken hides the day it is right | open |
| Bots. Nothing about the engine's AI is in the corpus: how a bot is spawned, driven and given a kit, what `aiMeshes.rfa` and a level's `AI/` and `AIPathFinding/` hold, and what the Instant Battle screen's difficulty variables become when a battle starts. Until it is documented the screen's whole left column is switched off (`SHOW_BOT_SETTINGS` in `viewer/play/menu-screen.js`, owner's call 2026-09-20) | open, research first |
| Mod coverage: 18 mods installed; maps and models exist for vanilla, XPack1, XPack2 and EoD only | by choice, for now |

### The lead's own queue

1. ~~Rebuild `viewer/models` for vanilla, XPack1, XPack2 and EoD from the
   game.~~ **Done 2026-09-20 03:41**, 5 h 50 m, almost all of it EoD under
   `--level-all`. 96 / 15 / 29 / 285 entries, every `glb` and `thumb` present,
   44 / 6 / 10 / 74 cockpits. Seat poses: EoD 133 of 133; Road to Rome 40 of
   50 (`PassengerInM3GMC`: "state machine has no Ub_PassengerInM3GMC clip",
   with stream C's reviewer). `extract_all.py` treated that partial pass as
   fatal and skipped the thumbnail stamp; fixed in `42f8f15`. The verifier's
   verdicts are noise until it is fixed (vanilla 42 "broken" of 96, EoD 96 of
   285, the same false alarms): see the wave 2 table.
2. ~~Re-extract every level once wave 1 is merged.~~ **Done 2026-09-20
   06:19** with `main` at `fcf0131`: 23 vanilla, 6 Road to Rome, 9 Secret
   Weapons, 239 EoD, every one rewritten, no failures; seat poses re-exported
   first (64 / 80 / 110 / 323, all resolved). Checked, not assumed: `tickets`
   on all 277, sound areas 35 -> 1,290 on vanilla (Bocage 0 -> 36),
   `vehicleSoldierSpawns` on 9 vanilla levels (Wake's Hatsuzuki deck among
   them), `lensFlare` on 19, a real `combatArea` on 11, 29 `skeletonIK` nodes
   and 32 `splashMaterial` armor blocks in Wake's scene. The page now draws
   Wake's tickets (US 100, Japan 100). `extract_maps_all.py --mod XPack1/2`
   also pulled in the 23 vanilla levels each pack inherits, which the published
   trees have never held; pruned back to own levels. **Still stale:**
   `_shared/damage.json` has no `friction` key until W2-D merges and it is
   regenerated, and wave 2's `setHasTurretIcon` / `setVehicleIconPos` /
   projectile words need one more pass over vehicles after it lands.
3. Publish. Overwriting content on the assets volume is confirm-first.
4. Integrate verified research into `ledger.md` and `symbols.json`.

## How the round runs

- One Opus agent per stream, each in its own git worktree branched from `main`.
  Every agent reads [BRIEFING.md](BRIEFING.md) first.
- When a stream reports, a second agent reviews it adversarially in the same
  worktree: re-derives the claims, runs the tests, drives the page. Past rounds
  found load-bearing errors in most reports this way.
- The lead trial-merges every finished branch into a scratch worktree, runs the
  suite and the page there, and only then merges into `main`.
- Research streams change no files. Their reports come back as text, are
  verified, and only confirmed claims enter the corpus.

## Stream specs

Each spec says what done means. How is yours to work out.

### A. The site and the Instant Battle screen

Tag `a-play`, port 5311. Owns: a new `tools/bf1942-models/play/` (or a name you
argue for), a new extractor beside `extract_spawn_layout.py`, deployment files,
`features/bf1942-in-the-browser/`. In `map.html` you may add only what reads the
launch parameters; the debug panel and the console belong to stream B.

Done means: opening the site shows the Instant Battle screen as the game draws
it, built from `menu/SkirmishMenu` and `menu/SkirmishNavigation` with the game's
plates, fonts and strings, not from CSS that resembles them. It lists the
extracted levels under their in-game titles, shows the selected level's preview
with both teams' flags, selects Axis or Allied, and launches that level on that
team in the map page. The map page is the same source file the mesh site
serves, not a fork. Deployment files for a second small nginx site over the
same assets volume exist, fit the node's memory budget (`CLAUDE.md`,
*Deployment constraints*), and are **not applied**. A capture of your screen
beside the description of the real one in the design doc, element by element.

### B. The console and the debug gate

Tag `b-console`, port 5312. Owns: a new `viewer/console.js`, its tests, the
`#side` panel's visibility in `map.html`, a new `subsystems/console.md` draft
returned as text.

Done means: the client's console is reconstructed from the binary first: what
key opens it, how far it drops and how fast, the wash it lays over the scene,
its font, the prompt, how a line is echoed, the exact error strings and what
the number in `Error (2):` is, history and completion keys, and how a line is
split into object, method and arguments (including whether `=` is accepted).
Then the map page has it: tilde toggles it, it swallows game input while open,
unknown commands answer the way the game does, and `show.dev 1`, `show.dev = 1`
and `show.dev 0` reveal and hide the debug panel, which is otherwise absent for
a regular player, fab included. The registry is built so later streams can add
real commands (`game.showHud` does not exist in 1.61; say what does).

### C. Drivers and gunners

Tag `c-occupant`, port 5313. Owns: `loadSeatPose` and what it calls in
`map.html`, a new viewer module for the IK, `extract_pose.py`'s seat-pose path,
the plan doc. Reference: `models-work/willy-hands-wheel.png`.

Done means: `AnimatedBundle::updateIk` (lnxded `0x08265880`) is read and the
plan's open questions are answered with addresses: the frame the two triples are
in, the rotation order, and what kind of solve it is. A soldier sits in the
Willys' driver seat with both hands on the wheel, and they stay on it as it
turns. A Sherman's driver stays hidden and its hull gunner shows, as in the
game. C-key view cycling still hides the body in first person.

### D. Wiring what the extractor already gives

Tag `d-wiring`, port 5314. Owns: material setup in `map.html` and `index.html`
for envmap, the ticket feed into `hud.js`'s variables, a new module for the
combat-area boundary, lens-flare parsing in `bf42/level.py` plus its draw.

Done means: a Zero's fuselage and a canopy reflect the level's cubemap, by the
engine's own rule for how strongly (read the envmap stage in the renderer before
choosing a number; LM-3 is next door). The spawn screen and HUD show each
team's tickets from `scene.json.tickets` through the layout's own `ShowTicket`
group. Leaving the combat area is visible in 3D the way the game shows it (find
out what the game shows before drawing anything). Flare and corona verbs are
parsed, surveyed across all mods, and drawn if the textures can be found; if
they cannot, say where you looked.

### F1, F2, F3. Research

Tags `f1-damage`, `f2-vehicle`, `f3-movement`. No worktree, no file changes
outside your scratch directory. For each row: the claim, the evidence with
addresses in both binaries where both apply, what it changes in our code (file
and line), and a ledger row in the ledger's table format. Say plainly which
rows you could not close and how far you got.
