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

## Landed on 2026-09-21

| What | How it was checked |
|---|---|
| **Aircraft drowned in mid-air.** HP-5's water tick asked `WorldCollider.surfaceHeight`, which is a function of x and z alone, so any hull over open water counted as *in* it at any altitude — a plane flying over the sea lost `hpLostWhileDamageFromWater` every second until it exploded, with nothing shooting at it. 10 HP/s for every vanilla aircraft (a 100 HP Corsair dead in ten seconds over Wake), 75 HP/s for a Secret Weapons Flettner. `world.js` now asks `touchesWater` (`body-world.js`), which is `checkVsTerrain`'s own rule — collision-response.md §7, the lowest **tested** collision vertex below the water level — so altitude decides it. The x/z query stays in front of it as the cheap cull, which keeps a tank on a bridge over a river out of the water as `85cc7d4` intended | `test_world.py` water contact cases; on Wake, a driven SBD held over open sea loses 0 HP at 300 m, 120 m and 96 m, and 10 HP/s once its belly is under the plane; ten seconds of untouched sim moves none of the level's 32 vehicles |

## Landed on 2026-09-22

| What | How it was checked |
|---|---|
| **Wave 4 HUD, scoreboard, camera & minimap (`eab59c0`, `e173af4`, `577de24`)**: Seat-occupancy dots resolve live states (local/friend/enemy/empty); deploy-screen kit rows label from `setKitName`; scoreboard button opens `menu/InGame` board; minimap cycles 3 zoom levels with the N key and rotates with player heading; tank external camera tracks the turret/gun-base rather than hull | Adversarial reviews and test harnesses in `w4/hud`, `w4/board-map`, `w4/camera`; full suite 2151 tests OK |
| **Carrier and destroyer gameplay parity (`0e1cd1e1`)**: Deck aircraft child spawners (`holdObject 1`) parsed in `con.py` and assembled as static held children in `assemble.py`; ship pitch axis routed in `world.js` for landing craft ramps (`Lcvp_Ramp`, `DaihatsuLanding`) and submarine dive planes; destroyer secondary turret rotation peered in `seats.js` without welding other inputs; nested seat dismount cleaned up; beaching hull-scrape effect and audio hooked without impact damage | Unit tests in `test_assemble.py`, `test_con.py`, `test_seats.py`, and map viewer inspection |
| **Ship and swimming physics waves 7–9 (`d265a6fa`, `7300024c`, `8f00bfd9`, `c8677b83`, `18852ccc`)**: Ships float at authored draft (`FloatingBundle`), answer the helm, sink on critical damage with deck spawns disabled; ground vehicles have engine-faithful inertia; soldiers enter swimming mode (`c_SstSwim`) on deep water, drown when submerged, and are locked out of weapon dispatch while swimming | `test_world.py`, `test_mouse_input.py`, `viewer-ships/README.md`, `viewer-swimming/README.md` |

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
| The way back out of a level: Escape puts the menu up, and from it you leave the game or start another | **built 2026-09-20.** The same screen, because in the game it is the same screen — `play/index.html`'s controller moved to `viewer/play/skirmish.js` and `map.html` mounts it on a canvas over the running level, opaque, with the pack's new fourth page up: `menu/ExitMenu`'s button, reading END CURRENT GAME because `Join/Disconnect/ShowDisconnect` is 2 for a singleplayer game. Escape is back to the game, START is the next level, END CURRENT GAME is the `game.disconnect` the console word already did. **Re-publish** the menu pack: `menu-layout.json` gained the page, vanilla's and all three mods'. Open: whether the engine reads a bare `IntData` `CullNode` as non-zero-is-true (the data says yes, the client was not opened), and touch, which has no Escape key |
| Sound on by default on the menu, with a mute of its own | **built 2026-09-21.** `audio.js` `attachMuteToggle`: a speaker in the menu screen's top right, one icon for playing / muted / blocked-by-the-browser. Muted is a state of the controller, so it outranks the gesture unlock and the next `start()` — a click elsewhere cannot restart the loop. Remembered in `bf42-mesh-menu-muted`, and scoped to the menu: the loading music keeps its own badge and the game its own setting |
| The "click to fly" plate, replaced by the game's own free roam | **built 2026-09-21.** A click on open ground on the spawn map unselects (`deployUnchosen`, every ring sits back); the commit then takes the free camera instead of spawning, as do CLOSE and Escape, and Caps Lock brings the screen back. `#gate` is gone with its CSS and `GATE_TEXT` — every way into the free camera is a user gesture now, so `enterFreeCam` captures the pointer on the way through, and closing the Escape menu captures rather than leaving a plate to click. Open: touch, which has neither Escape nor Caps Lock |
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

**W3-E (mod chrome) is merged** (`cba208f`, 2026-09-20), verdict MERGE WITH
FIXES. Reports: `w3e-modchrome.md`, `w3e-review.md`. Merged by hand with another
session's mod picker (`7d536e8`), which had rewritten the same Instant Battle
page: its mod resolution won, the stream's per-mod pack resolver fills in behind
it, and `buildLevels` joins against a mod's own `menu-levels.json` when its pack
carries one. Checked in the browser for bf1942, xpack1 and eod.
- Extracted into the local shared tree (from the merged code):
  `extract_hud_mods.py --mod EoD|XPack1|XPack2` -> 582 / 40 / 49 files plus a
  `pack.json` each under `maps/mods/<id>/_shared/hud`. To publish: those three
  directories only; nothing under `maps/_shared` changes.
- Reviewer fixes: `extract_hud_mods.py --mod bf1942` would have deleted the
  vanilla pack; `_001` patch archives were never layered for menu.rfa; the mod
  was dropped on START and on the bare-page redirect; Australia drew a US flag.
- Left open (in `features/authentic-spawn-map/README.md` section 10): mod kit
  photographs are never extracted (87 in EoD, all under nation subdirectories);
  a team's nation is a LEVEL property, not a skin property (30 EoD team/level
  rows and vanilla's Caen disagree with `SKIN_NATION`); Pathet Lao bases fly the
  NVA flag in-game; `verify_models.py`'s origin-pile check is anchored on the
  scene origin and misses a Sherman whose 27 parts collapse onto the hull.

**Sonnet fix streams for the items the wave 3 reviews left open** (launched
2026-09-20 at the owner's request; each in its own worktree, each reviewed before
it merges):

| Stream | What it fixes |
|---|---|
| S1 level nations | A team's flag is a LEVEL property: the Instant Battle screen derives it from the level's own control points the way `map.html` does (30 EoD team/level rows and vanilla's Caen were wrong); Pathet Lao bases stop flying the NVA flag - an unmapped nation shows no flag |
| S2 kit photographs | `extract_hud_pack.py` globs `menu/Texture/Kits/**` with directory-qualified names (EoD's 87, SW's 6, RtR's 2 from `menu_001.rfa`); `kitPhoto()` reads the kit's own `setKitIcon` from `loadouts.json` |
| S3 verifier | `origin_pile` anchored on the scene origin misses a Sherman whose 27 parts pile on the hull origin; a comparative rule that keeps the 10 EoD false alarms suppressed |
| S4 sound lifecycle | wreck fire stops with its wreck and on level change; sounds requested while the AudioContext is suspended no longer fire together on resume; a bundle attached to a moving object sounds |

Not given to an agent yet: vehicle guns never get `randomPlay` (needs
`extract_map._sound_layers`, which the game-modes stream is rewriting - after it
lands), and the 26-voice arithmetic (needs the client mixer read in Ghidra).

**Publishing** (owner: "publish, commit and push, no need to confirm",
2026-09-20): a size-and-json delta of `viewer/models` and `viewer/maps` against
the volume is going up group by group (`scratchpad/publish/publish-delta.py`,
manifests last, nothing deleted): 1,979 model files / 0.64 GB and 1,729 map
files / 14.9 GB - every `scene.glb` changed. `models/mods/eod` is held back
until its re-extraction finishes.

**W3-A (drivetrain) rework has reported** (`w3a-drivetrain-rework.md`) and is
back with its reviewer: both blockers claimed closed, brake closed, but a jeep
with a driver still rolls down a 5 degree slope, roll reversals got worse, and
the M3A1 leans 39 degrees and loses its turn-in at top speed.

**W3-G (mouse input) is merged** (`91dbf3f`, 2026-09-20), verdict MERGE WITH
FIXES. Reports: `w3g-mouse.md`, `w3g-review.md`. Checked on the merged page: on
foot, 1,200 counts over a second turn the view 144.90 degrees and 480 counts of
pitch over 12 ticks move it 19.32 - yaw is three times pitch, as read.
- `TURRET_SPEED_SCALE`, `TURRET_DEGREES_PER_PIXEL` and the on-foot `LOOK_SENS`
  are gone; the input stage (`viewer/mouse-input.js`) is the engine's rate law,
  clamp and 12-bit wire, held for every tick of a frame; the four
  `game.set*MouseSensitivity` words are on the console and do not clamp, because
  `0x006eb1a0` does not.
- Second reader confirmed the soldier look law byte for byte (pitch `-= input`,
  yaw `-= 3 x input`, degrees per tick; `setRotateZDeg` multiplies by pi/180 at
  `0x086b1ca4`) and added two scalers the stream missed: while zoomed both axes
  are scaled by the weapon's `zoomFov` (+0x270, not `SoldierZoomFov`), and recoil
  is added into the same axes before the x3.
- FEEL, for the owner: on-foot PITCH is 3.1x slower than before at every hand
  speed (yaw within 5%); a Sherman tower is 2.7x slower at ordinary hand speeds
  (35 deg/s per unit of input); a Defgun winds up 4x slower. All three are the
  read law. `countsPerPixel` (default 1.0, `?turret=`) is the one unproven unit -
  the 3.7% agreement with the old constant is coincidence-prone; set it by play.
- UNRESOLVED, not merely unverified: `BFSoldier+0x288` is rotated into the same
  transform a second time when the soldier is moving, which read literally turns
  a walking soldier twice as fast. Retail does not, so something outside
  `handlePlayerInput` cancels one of them. The viewer applies the tick's own
  rotation only.
- Left: recoil bypasses the look law here; the touch pad has never aimed an
  on-foot soldier (pre-existing); aircraft stick input is a separate consumer.

**W3-A (drivetrain), third round.** The cliff launch is closed (sharp cliff jeep
98.6 km/h, under its flat top); the M3A1 still leans 32-38 degrees (main: 5.5)
and the arithmetic says an isotropic friction budget tips anything whose contact
patches sit further below its origin than its half-track is wide. Two readers
have not found what prevents it in the engine. **Both observations were answered by the
owner on 2026-09-22 — the lean is right** (see W3-A, closed); the jeep creep
remains an open defect. The reviewer is checking the two new commits meanwhile.

**All four Sonnet fix streams are merged** (2026-09-20), each reviewed by the
lead from its diff, a trial merge, the suite and a page check:
- **S2 kit photographs** (`0c391fa`): vanilla's pack byte-identical from the
  merged code (262 files compared); packs re-extracted locally, EoD 669 files,
  XPack1 42, XPack2 55; EoD's spawn screen now shows EoD's own kit photographs.
- **S3 verifier** (`0590dd2`): the origin-pile check clusters parts by shared
  world point wherever it is, folding a lone rider into its ancestor; vanilla
  94/2/0, XPack1 13/2/0, XPack2 25/4/0 re-run by the lead and unchanged.
- **S1 level nations** (`0c45e26` + lead's `13ebfc7`): the menu derives a team's
  nation from the level's own control points. Vanilla moves in exactly one row
  (Liberation of Caen's allies become Canada); EoD in 13 (not the 30 the review
  estimated - that figure was never reproduced by a script). **The lead caught a
  regression at merge**: `teamNation`'s last fallback had become `'unknown'`,
  which would have taken the US flag off Omaha, Iwo Jima, Coral Sea, Midway and
  Truk and the German one off Kasserine, because `nationFromVehicles` only names
  jp, rus and brit. `'unknown'` now wins only when a side's own flags vote for it.
  `menu-levels.json` regenerated locally (vanilla and the three packs).
- **S4 sound lifecycle** (`08d3327`): an effect handle's `stop()` cuts its voice,
  every level change silences the pool, a suspended AudioContext drops one-shots
  and remembers loops, an attached effect sounds and follows its object. The
  suspended path is proven under node only - every browser to hand starts running.

**W3-C (game modes) is merged** (`48244c9`, 2026-09-20), verdict MERGE WITH
FIXES. Reports: `w3c-gamemodes.md`, `w3c-review.md`.
- `GameTypes/<x>.con` is the index (read in `Setup::setNextLevel` `0x080bf160`,
  jump table `0x86ba190`), but a game type does NOT load one directory: 35 of
  3,048 scripts straddle two, including every Road to Rome and 8 of 9 Secret
  Weapons CoOp scripts. The reviewer added composed layers keyed by game type;
  Instant Battle launches `mode=CoOp`.
- **PUBLISH ORDER: the viewer code must be live before re-extracted levels are
  uploaded.** A re-extracted multi-layer glb holds the union of every mode's pads
  and flags; main's old page has no `pruneToMode` and would show 58 vehicles on
  Wake and two flags on its beach. The code deploys itself from main (Jenkins),
  so: merge, let the image roll, THEN re-extract and publish levels. The publish
  now running uploads levels extracted BEFORE this stream, which are safe.
- Re-extract (after the drivetrain question settles, so it is done once):
  `extract_maps_all.py` for vanilla, and `--mod EoD|XPack1|XPack2 --out
  viewer/maps/mods/<id> --levels <the pack's own>`; about +2.3% on disk.
- Left: pruned nodes are never disposed; ObjectiveMode bindings and `Ctf.con`
  flag bases are not placed; no mode picker (URL only).

**W3-A (drivetrain) is merged and now CLOSED** (`36ff97e`, 2026-09-20; ruled on
by the owner 2026-09-22). It was merged on his word ("merge it as-is for now, I
will get back to you later") with two real-game observations owed, and the M3A1's
32-38 degree lean is now **accepted as correct**: *"as far as I am concerned it
looks almost exactly like the real game mechanics."* The lateral law stays, the
two owed observations are no longer owed, and the lean is **behaviour to preserve
— a later stream that reduces it has caused a regression, not made an
improvement.** W6-C was told so mid-flight. Still an open defect, separately: an
occupied jeep walks 7.65 m in 10 s down 5 degrees. Still to do regardless: sample the contact velocity at the same
point the tyre force is applied (`u` is taken at `wheel.rest`).

**The model extractor was spending hours proving a negative** (`774696c`).
`--level-all` exported each model once per level - assembled it, decoded every
texture, built the glb - and only THEN checked whether any texture had come from
that level. EoD is 285 x 239 = 68,115 full exports; the job had kept 129 of
62,090 after three hours of 16 cores. The check now runs first, from the archive
index alone, through the same filter `add_level` registers with. Vanilla output
identical (263 glbs, 263 manifest variants, 90 level variants) in 72 s.

**The final re-extract is done and verified** (2026-09-20, 12:05-13:22, 77 min
for everything; `scratchpad/reextract-v3.log`, every stage exit 0, no traceback).
EoD's model catalogue took FIVE MINUTES (was 3+ hours and unfinished); EoD's 239
levels are the remaining 58. Checked: catalogues 96 / 15 / 29 / 285, every model
with a thumb on disk; level variants 90 / 9 / 15 / 147; levels 23 / 6 / 9 / 239,
every one carrying `modes` (73 / 30 / 45 / 812 layers); Wake's 36 Engine nodes
carry `maxRotation`, `maxSpeed` and `acceleration`; Anzio has the composed `CoOp`
layer. On the page: vanilla Wake is 32 vehicles and 7 Willys in Conquest, and
`?mode=CoOp` gives the SinglePlayer layer's 23 vehicles, no Willys, 2 Chi-Ha,
tickets 140 v 100. Also extracted: the effects and effect-sound packs for EoD,
XPack1 and XPack2 (their pages were 404ing `effects.glb`).

**PUBLISHED AND VERIFIED (2026-09-20 14:30).** Models 0.79 GB in 3 minutes, maps
14.98 GB in 51 minutes, over eight parallel `kubectl exec` streams, 355 units, no
failures. A full re-listing of the volume against the local trees: models 8,321
of 8,321, maps 35,401 of 35,401 present at the right size, nothing to send, 70
legacy files on the volume left alone. Live on mesh.bfstats.io: Wake carries its
four mode layers and 36 Engine nodes with `maxRotation`; Anzio has its composed
`CoOp` layer; Caen's allies are Canadian; EoD's catalogue is 285 with 285 thumbs;
the three mods' effects packs and kit photographs answer 200; EoD's A Shau loads
with its own kit photographs and no failed request.
- The publisher is now in the repo: `scripts/publish-mesh-delta.py` (size delta,
  parallel units, sizes verified, manifests last, resumable, never deletes;
  `--dry-run` says what would go).
- Two traps it records: ONE exec stream to Hetzner is about 1 MB/s whatever the
  uplink, so use streams, not bandwidth; and a big listing streamed out of
  `kubectl exec` can arrive TRUNCATED with no error (30,707 of 35,471 lines),
  which reads as thousands of missing files - list to a file on the pod and
  check the count.

**The delta publish is running** (`scratchpad/publish/publish-v2.log`): models
5,044 files / 1.2 GB, then maps 1,301 files / 15.0 GB, gzip -1 on the wire
(a `scene.glb` shrinks 15-27%), a group at a time, sizes checked, manifests
last, nothing deleted. The uplink is the limit at roughly 1.2 MB/s.

**Re-extract and publish, restarted.** The old EoD model job and the first
publish (stopped between groups at 113 of 281, 5.83 GB) were both uploading or
producing output the drivetrain and game-modes extractors supersede. Running
now: `scratchpad/reextract-v3.sh` - all four catalogues and every level with
main's final extractor. The live site already serves `game-modes.js`, so the
publish-order rule is met; the delta publish follows the extraction.

**W3-A (drivetrain), third review: MERGE-IF.** The two new commits hold; the
washboard "regression" was a framing error (at a matched 31 m/s entry main
reaches a 54.85 m apex and 454 km/h, the branch 3.88 m and 114 km/h). The M3A1's
node origin is shipped data (`setPosition 0/-0.749/-0.949` plus 0.519), giving
half-track / patch-depth ratios M3A1 0.70, Hanomag 1.24, Sherman 1.00, Willys
1.20 against a grass budget of mu 0.90 - so the branch predicts the M3A1 leans
and the HANOMAG DOES NOT, which makes the Hanomag the control. Mergeable as it
stands if the owner sees, in the real game, (1) an occupied jeep with no throttle
roll down a 5-10 degree slope and (2) an M3A1 lie over in a turn above about
40 km/h while a Hanomag stays flat. Otherwise DO NOT MERGE until explained. (`w3c-gamemodes.md`). **W3-G
(mouse input) has reported and is in review** (`w3g-mouse.md`).

**W3-A (drivetrain) was reviewed: DO NOT MERGE, sent back to its author**
(2026-09-20). Reports: `w3a-drivetrain.md`, `w3a-review.md`; the reviewer's
comparison scripts are in `scratchpad/r3a/`.
- The research held: TANK-13 is MAX for `revs >= 0` and MIN below (the earlier
  gearbox verifier had it inverted), only an EngineGrip wheel feeds the load,
  `F*30` is the engine's gain and the drivetrain is frame-rate independent
  (Willys 111.2, Sherman 53.6, M3A1 67.2 km/h reproduced exactly).
- Blocker W: on a 0.35 m / 12 m washboard the Willys reaches a 148 m apex and
  454 km/h (main: 1.13 m / 58 km/h). The tyre frame is the hull's plane, not the
  contact's, and a buried axle reads metres of spring compression.
- Blocker E: on today's assets no tracked vehicle steers, because
  `physics.maxRotation` is absent from every shipped `scene.glb` and steering
  has no fallback. **Levels as well as models must be re-extracted** once this
  lands (the drivable hull is built from the level scene).
- Brake is 2x too long; the engine's tyre-friction accumulator is a running mean
  (`addFrictionAtAbsolutePosition` `0x08254e50`; springs sum, tyres mean), but
  the mean alone rolls the M3A1 over, so more of the rule is unread.
- A parked jeep rolls down a 5 degree slope; roll chatter at full lock.

**W3-B (blasts) is merged** (`cf7f352`, 2026-09-20), reviewer's verdict MERGE
WITH FIXES, four fixes committed. Reports: `w3b-blasts.md`, `w3b-review.md`.
- The painted combat boundary is safe and ships on. The engine samples the
  terrain material under the occupied object's x/z every tick (no contact
  needed), shares the rectangle's 10 s timer and resets it when you step off.
  Material 7 is the map edge painted as a ring round one playable pocket: across
  23 levels 0 of 749 soldier spawns, 0 of 115 control points and 0 of 724 object
  spawns stand on it. The stream's wording ("the streets are what is not
  painted") was refuted and rewritten; the mechanic was confirmed.
- Confirmed from bytes: crouching in the open takes double a standing man's
  splash (identical 9-sample tables, divisors 9 and 18); the sample offsets are
  never rotated; `v_n' = v_n (1 - e) / 2` with a constant 0.5 and no mass, so a
  grenade (pair e = 1.0) never rebounds and skids on its tangential speed.
- Refuted and fixed: materials 195 and 232 ARE declared, so they carry the
  Material constructor's 0.01 resistance, not material 0's 0.02.
- Merge note: main (the collision session) had already added `elasticity` /
  `resistance` to `bf42/damage.py` as optional, emitted only when authored. That
  shape won; the consumers own the constructor fallback.

**W3-D (sounds) is merged** (`cca9822`, 2026-09-20), verdict MERGE WITH FIXES.
Reports: `w3d-sounds.md`, `w3d-review.md`.
- Extracted into the local shared tree: `python3 extract_effects.py --mod bf1942
  --out viewer/maps/_shared` -> 83 sounding bundles, 46 scripts, 677 layers,
  192 samples, 2,283,777 B, `_shared/sounds` 156 -> 348 files. Checked on Wake:
  pack loads, a grenade blast starts its sources inside the budget.
- Reviewer fixes: `silence()` left `trigger Volume` latches armed (ghost
  explosions after a level change); ten vanilla bundles carry two scripts in
  their tree and only one played; `effects.glb` was not reproducible run to run.
- **The 26-voice budget is the viewer's arithmetic, not the engine's**: the
  32-voice hardware limit is proven, the subtraction of the 2D reservations is
  not (SND-2b), and drop-versus-steal is a viewer choice (SND-1). `randomPlay`
  as "pick one" is a reading of the data (SND-6).
- To publish with the rest: `_shared/effects.glb`, `effects.report.json`,
  `effects.sounds.json` and the 192 new files under `_shared/sounds`.
 - Left open: wreck fire never ends (holds 3 voices), sounds queued while the
   AudioContext is suspended fire together on resume, vehicle guns still do not
   get `randomPlay` (needs `extract_map._sound_layers` and a level re-extract).

### Wave 4, merged (launched 2026-09-21)

Five items the owner picked from "Not yet assigned" on 2026-09-21, split by what
each needs first. Same shape as before: research reports as text and gets a
second reader, builds get an adversarial review, nothing merges untested.

| Stream | Owns | State |
|---|---|---|
| W4-F research | the three engine reads the builds below are blocked on: (1) the in-game **scoreboard** — which meme page it is, what it lists, how it is fed; (2) the **tank external camera** law — which view mode targets the turret and how the camera is positioned; (3) **MMAP-1/2** — who writes the minimap zoom and yaw. No worktree, no file changes | **reported, second-read 2026-09-21.** Camera + minimap CONFIRMED (crop base is 2.3 as a *double* `0x008d62a0`; zoom is 3 levels, `+0x48 = level+0.5`; `+0x68` = player heading, written every frame). Scoreboard core CONFIRMED with two corrections: the deploy button is a *single* `BfButtonNode` → `Kit/ScoreboardSpawnInterface` (not 18 per-locale), and the art ships `.dds`. Two gaps left open (the `+0x58` static store, the N-key increment of the zoom counter) — non-blocking for the builds |
| W4-A build | **seat-occupancy dots** (feed the live per-vehicle occupancy into the six dots, `seats.js` `seatDots()` / `hud.js` `seatDotPosition`) and **deploy-screen kit labels** (extract `ObjectTemplate.setKitName` into `loadouts.json`, resolve the lexicon key, swap the hardcoded Scout/Assault/... row labels). No engine read needed: `vehicleIconPos` is already in the re-extracted scenes, and `setKitName 2 "RESPAWN_AT"` is a lexicon key like the menu titles. Worktree `bfstats-w4a-hud` (branch `w4/hud`), port 5321 | **merged `eab59c0`** (review MERGE; the netcode room harness needed `seat-dots.js` after the merge — `865c02a`). Seat dots live; kit labels need the post-merge `loadouts.json` re-extract to carry `kitName` (vanilla shows the same SCOUT/ASSAULT/... either way; EoD re-points `RESPAWN_SCOUT`→Sniper once re-extracted) |
| W4-B build | **SCORE BOARD** (the in-game board behind `deployScoreBtn`) and **minimap zoom (N) + rotating mode**, built from W4-F's verified reads. Worktree `bfstats-w4b-board` (branch `w4/board-map`), port 5322 | **merged `e173af4`** (2026-09-21; the first build agent crashed mid-stream, a second finished it; lead review on the merged page, suite 2244 OK). `N` steps three eased levels and `game.setStaticMinimap 0` turns the map about the player. The widget's span is now the engine's own, `1/crop` of the map (0.659 / 0.287 / 0.125), read from the pointer inverse `0x00469360` — level 0 shows far more than the old 0.25, and the window no longer stops at the map edge. The board is `menu/InGame` entry 47, extracted by `extract_scoreboard_layout.py`; opens from `deployScoreBtn` and on held `Tab`; fed the local player, a room's roster and `killed` events, zeros otherwise. Open: the N-key increment, the list's row-fill code and what columns 0/150/355-450 carry are unread; mods fall back to vanilla's board; **`_shared/hud/scoreboard/` (268 KB) must be published with the viewer code**. Report `w4b-board.md`, with ledger rows (MMAP-1/2 confirmed, new MEME-14) ready to paste |
| W4-C build | **tank external camera** — the external view follows the turret, not the hull, built from W4-F's camera read over the existing C-key cycling. Worktree `bfstats-w4c-camera` (branch `w4/camera`), port 5323 | **merged `577de24`** (2026-09-21; the first build agent crashed before writing anything, a second built it; lead review, suite 2178 OK at merge). Chase and front views of a seat whose Camera rides an aimed axis are anchored on the seat Camera with the engine's offsets (`1.2 R`, `0.3` up, ease `1 - exp(-2 dt)`, 1 m terrain clamp); measured camera heading follows the turret 0 to -90.04 degrees with the hull fixed. **Owner's ruling 2026-09-21: keep turret-following as the default** (checked on the page, "the way it follows the turret"). For the record, the build agent's read of `Camera::getTransformation` (lnxded `0x081aaf90`, client `0x005659b0`) has the chase *direction* come from the vehicle root and only the *anchor* ride the turret, against this round's premise. Turret-following ships as the default, labelled a viewer choice; `?chase=engine` runs the law as read, `?chase=legacy` the old framing; the default is one line in `chaseLawFor`. Open: only the Sherman was run, gun pitch not captured, the 7.125 m bounding radius is unverified. ~~gunner seats have no external view here~~ — every seat cycles since 2026-09-23 (`features/vehicle-camera-toggle-sweep`, the law anchored on the active seat's Camera). Report `w4c-camera.md`, with ledger rows (CVM-2, CVM-3, a CVM-1 amendment) ready to paste |

W4-A and W4-F run in parallel; W4-B and W4-C launch once W4-F reports and its
claims pass a second reader.

### Wave 5, running (launched 2026-09-21)

Four streams. Two are defects the owner found playing the thing; one is the
soldier work that has been the largest visible miss since the round opened; one
is the bots research that "Not yet assigned" has been waiting on. Each in its
own worktree from `main` at `2883708`, same shape as before: builds get an
adversarial review, research claims get a second reader, nothing merges
untested.

| Stream | Owns | Port |
|---|---|---|
| W5-A soldiers | **an explosion hurts the man on foot** (HP-9/HP-10: `applySplash` walks registered vehicles only, so a grenade at the local player's feet costs him nothing), **crouch and prone play their own aim** instead of the standing clip, and what can honestly be done about spawn-pad soldiers being decoration. Explicitly NOT bot behaviour, which is W5-D's | **merged `e195a33`** (review MERGE WITH FIXES, `0b9337a` `ecc1a64` `fa7cee6`). **The brief was stale**: the on-foot splash gap (HP-9/HP-10) was already built and merged by W3-B on 09-20 - the local player has been in `splashTargets()` with `soldier-exposure.js` behind it since then, and the stream was right to change nothing. It re-derived the law anyway: `checkForHitOnSoldier` `0x08156090`, 9/9/3 samples by pose, the crouch and stand tables byte-identical over all 108 bytes so standing's 0.5 cap is one doubled divisor; the reviewer found the pose names (`c_AsmIsCrouching` 0x20, `c_AsmIsLying` 0x40, registered `0x0829920a`/`0x0829923a`), so 1 is crouch and 2 is prone with no inversion. Measured: standing 6.00 HP at 9 m of a radius-10 grenade, crouching 12.00. **Crouch and prone now play their own clips** - the root cause was `#gaitFor` answering `'stand'` for any stationary soldier. **A remote player in a room never played a walk or a run at all** (gait halves bound `runLower`/`runUpper`, selection asked `actions.run`); prone remotes stood up. Reviewer's own finds: a band defect where `walkSpeedFactor` applied in every pose put a crouch-walker and a crawler below their own bands, so both drew standing still (`0b9337a`); two tests that passed against a mutant (`ecc1a64`); and the fallback claim was wrong - a moving crouched or prone soldier on an un-re-extracted rig used to play `idle` and now plays `walk`, on 97 of 99 rigs (`fa7cee6`). Corrections: **28 weapons, not 26** (both surveys used a whitelist missing `RepairPack` and misspelling `WalterP38`), and the re-extract is **99 rigs, 163 -> ~224 MB**, not 196. Open: HP-9's falloff shape is still the Mod Toolkit's linear one; `Ub_CrouchRaiseWeapon` duplicates the standing draw-in on all 28 weapons | 5331 |
| W5-B parachute | Stepping out of a flying aircraft drops you where the plane was. In the game you fall, the scream fires, the fart easter egg exists, and the chute opens on 9 and glides you down still able to look and shoot. Reads the engine first: the server is unstripped for this — `BFSoldier::setIsParachuting(bool)` `0x08276f90`, `BFSoldier::triggerFallingAnimation()` `0x0827e920`, `setParachuteSpeed` / `setParachuteDrag`, sound triggers `c_SstFallingHigh` / `c_SstOpenParachute` / `c_SstParachuteLand`, and the `Ub_Parachute{Open,Fall,HitGround,Die,DeadHitGround}` clip names. `ShowParachute` is already in the corpus as a world-icon HUD flag (SUP-17) | **merged `7f6f451`** (review MERGE WITH FIXES, `6657331`; lead's radius change `28f464a`). Bailing out at altitude now drops you: free fall arms on **both** `speed.y < -8.0` and `height above terrain > 10.0` (PARA-1), the scream schedule is the `.ssc`'s own layer times (0, 1.2, 2.3, 3.3 s) and **the fart is `soprupp.wav` at 11.5 s of continuous falling - about 830 m**, a time threshold and not a random pick. 9 really is the ripcord: there is no `c_PIParachute`, it is `c_PIMenuSelect9` -> TemplateMessage 18 -> `setIsParachuting(true)`, accepted only while the lower state is `Lb_ParachuteFall`. **PARA-2 refutes a shipped corpus row**: `setParachuteSpeed` is an *acceleration*, 30 m/s^2 along a forward axis every tick, not a terminal speed - so the glide ratio is radius-free at 2.037:1. The reviewer confirmed the whole free-fall block including the clamp sense, and **found the writer the stream could not**: `lastCollisionHeight` is written inline at the tail of `Armor::update` (`0x081730b0`-`0x081730e7`), raising to the current `y` every tick out of contact, so the engine does **not** damp `F` for a parachutist. It also corrected PARA-6's window - HP-14 bills the full impact speed, so survivability needs `r >= 2.354`, not 1.563, and the shipped 1.8 was outside it. Lead set the radius to **2.5** and deleted the re-stamp: the landing is now free for the engine's own reason. **Still open**: free fall reaches 129.8 m/s horizontal at t = 2 s and no radius in the window tames it (172 m/s at 2.354) - either retail really does fling you or one read is wrong, and the engine's reading was shipped rather than a cap invented. `exitVehicle`'s bail branch has never run end-to-end headlessly (pointer-lock); `surfaceHeight` is called without `fromY` so it misses decks; multiplayer is **confirmed** broken, not merely unreplicated - and bit 22, already spent on jump as a documented departure, is precisely the engine's own ripcord, so whoever wires it must move jump. No audio plays yet and there is no 3P parachute clip (extracted soldier glbs carry zero animations) | 5332 |
| W5-C idle when unoccupied | A tank or plane keeps its firing animation when nobody is in it — on exit with the trigger down, on the respawn after a wreck (the owner's repro is a Spitfire crashed mid-burst), and on a freshly placed vehicle. Three entry points, two candidate latches: `world.js`'s `fireStates` WeakMap keyed on a node that survives a respawn, and `gunfire.js`'s `group.firing` with `viewmodel-anim.js`'s `fireRunning`. The same shape as wave 3's `silence()` leaving `trigger Volume` latches armed | **merged `7e42c68`** (review MERGE WITH FIXES, `44a276e`). The latch was four limbs, not the three the brief guessed: `GunFire.advance` is the only thing that resets a gun's flash, recoil and streak state, and `releaseGuns` splices the group out of the index the instant a seat empties, so whatever the gun caught is frozen for the level. The fourth limb the reviewer found and fixed: `advance` also *places* a drifting emitter, and `collect` re-reads its drifted position as the authored one on the next entry, so the emitter walks one more drift from the muzzle every cycle, forever - **589 of 3,998 published glbs carry such an emitter**. Two of the three entry points were carried by no test (deleting both call sites left the suite byte-identical); `IdleVehicleWiringTests` now pins all three on `map.html`'s source. Lead's own before/after on `battle_of_britain`: **15 drawn tracer templates -> 0**, named. The build's "0.100 m" out-of-battery figure is wrong, it is **0.26667 m**; the fix zeroes it either way. The audio commit fixes a real bug but not the one its message claims (the no-spec-with-weapon-patches case is unreachable in vanilla and all three mods; what it really fixes is `leaveVehicle` never clearing `aircraft`/`car`, so an engine load in flight at the exit starts voices on an empty vehicle). Open: `setupEngineAudio`'s in-flight guard should ask `!occupancy`, so a vacated vehicle can still run audibly for up to 2.4 s | 5333 |
| W5-D bots, research | The corpus has nothing on the engine's AI. The server is fully symbolised for it — `BotMain` 379 symbols, `BotManager` 275, `Bot` 148, `AIPathfinding` 201, `AIInformationGrid` 114, `AIMain` 105, `AISettings` 91, `AIStrategicObject` 75, plus `AITemplateManager`, `AILandingZone`, `AITemplateCover`, `BotBehaviour`. Question 5 is the one with a build behind it: what the Instant Battle screen's difficulty variables become, which is what `SHOW_BOT_SETTINGS` in `viewer/play/menu-screen.js` is switched off waiting for. Closes with a staged cost estimate for the smallest bot worth shooting at. No worktree changes beyond its own feature doc | **reported and second-read, merged `e26af7f`** (`features/bf1942-ai-research-2026-09-21/README.md`; corrections `384b0b8`). A bot is an ordinary player: `BotMain` owns a `PlayerInput` and pushes it through `AIPlayer::addInput` into the **same `ActionBuffer` at `BFPlayer+0x144` the network fills** - no bot-specific path exists below the input layer. The AI is a time budget, not a per-bot loop, and an infantry bot's plan interpreter has 13 instructions. Difficulty is one knob, `aiSettings.setBotSkill`, with **exactly ten call sites in the whole server** (plan-step rate and trigger accuracy, nothing else) - and vanilla never calls it, so the running value is the constructor's 0.75. Bot aim has a closed form; the `C` term is an anti-aircraft penalty on the shooter. **The verifier overturned the report's tick-order claim**: `updateAI` is at `+0x1b3` by layout but runs **first**, gated on `getGameStatus() == 1` - gcc parked the `if` body at the end of the function and it `jmp`s back into the body. The 'one tick of bot latency' conclusion built on it is refuted. It also **settled AI-19**: the Instant Battle AI SKILL slider is **inert in retail 1.61** - the menu writes an int at `+0x64`, the conversion reads a byte at `+0x88` that has a getter and no setter anywhere in the image, so that path always gets 0.5. Wiring `SHOW_BOT_SETTINGS` to the real table is therefore an improvement on the game, to be labelled as one. Cost: a bot worth shooting at is ~2-3 days plus one small extractor addition (`Ai/Weapons.con` fields nothing reads today); a bot that walks needs a navigation source; a bot that plays Conquest is weeks | — |

Nobody is building bots this wave. W5-D produces the document that makes it
possible and an honest price for it.

### Wave 5 addendum: W5-E, the descent and the camera (2026-09-21)

Two things the owner reported after playing the merged parachute: the canopy
descends at about half the real game's rate, and C should take the view outside
a falling soldier. **Merged 2026-09-22 as `67c12cb`** (`670064d`, `26a6a45`, `a4e6f7d`,
`c95d2d1`), review MERGE WITH FIXES. It had sat unmerged since 09-21 because the
main checkout had another session's uncommitted work in `map.html`; see wave 6
for how the one-line overlap was got round. The engine findings are already
in `ledger.md` (`1cb95ff`) so nothing here is lost if the branch goes stale.

**The owner's "half speed" was the thread that unravelled it.** The lead's
hypothesis — that the glide term is input-gated — is **dead**: a third and
fourth independent read found no conditional between the multiply and the call
and no input channel in the operand's provenance. The real answer is PARA-10:
`BFSoldier::handleCollision` hands the collision handler a **zero speed vector**
while the parachuting bit is set, so a canopy landing is free at any speed and
PARA-6's lower bound rested on a floor the engine never applies. Radius back to
**1.8**, descent **3.126 → 6.030 m/s** (1.93x), landing still free, a no-chute
drop still lethal.

**What is left open, for the next phase:**

| Item | Where it stands |
|---|---|
| **A third-person soldier and a canopy mesh** | The blocker for the camera the owner asked for. `viewer/soldier-camera.js` and the `chase-camera.js` placement law are built and correct, but driving them shows **a featureless grey field** at altitude and a conspicuous empty hole in frame lower down, because nothing is drawn there. The external views are therefore **gated behind `?soldier3p=1`, off by default** — showing a grey void is worse than the key doing nothing. `__footView('chase')` already puts the camera where it belongs, so **the model is the only missing half**. Note the extracted soldier glbs carry **zero animations**; the 18 `3PParachute*.baf` clips exist (Open 41 frames, Glide 12, Ground 6, Fall 12) but nothing exports a 3P clip — that is a pipeline feature, not viewer work |
| **C on foot is a no-op** | CAM-1: the engine authorises one view mode for a soldier and `BFSoldier::nextCamera` is an empty function, so this is parity. The owner will press C on foot and get nothing; if that is unwanted it is a deliberate departure to be made and labelled, not a bug. **Made 2026-09-23**: the departure ships on by default behind the page's own `soldierExternalViews` server switch (`viewer/server-settings.js`, `?foot3p=0` or the side panel to turn it off); see `features/vehicle-camera-toggle-sweep` |
| **PARA-6 is still not closed** | The composite-radius chain contradicts itself: the soldier's own geometry radius is exactly 1.0, `getBoundingRadius` returns 0 when `flags & 1`, and CAM-3 proves `setIsParachuting` **clears** that bit on open — giving ~1.0 stowed and ~13.79 open, neither flyable. One reading in that chain is wrong. **This is the thread to pull**; the radius is currently set by play, not by the engine |
| **PARA-9, free-fall run-off** | 129.8 m/s horizontal at t = 2.0 s, the reading confirmed four times, no exemption found and no max-speed member anywhere in `ref2::world`. PARA-10 removes the "but fall damage exists" objection without resolving it |
| **The client's channel-26 handler** | CAM-2: the server cannot settle what C does to a parachutist. Best lead is that W4-C put the client's `Camera::getTransformation` at `0x005659b0`, so its `setViewMode` sibling is nearby and its callers are the toggle |
| **`exitVehicle`'s bail branch has still never run end-to-end headlessly** | Seating needs pointer lock; `__bailOut` remains the only headless entry. Carried from W5-B |
| **The parachute does not replicate** | Confirmed, not merely unverified: `netcode.js` encodes bits 4/20/21/22 only and `deploy`/`dead` are not in the codec. **Bit 22 is already spent on jump as a documented departure, and bit 22 is precisely `c_PIMenuSelect9`, the engine's own ripcord** — so whoever wires this must move jump first |

### Wave 6, running (launched 2026-09-22)

**W5-E landed first** (`67c12cb`), which is what had been blocking it: the branch
had sat unmerged since 09-21 because `map.html` was dirty in the main checkout.
It still was, and it still is — another session is live in
`viewer/play/**`, `viewer/ground.js`, `bf42/meme.py` and the two menu-layout
extractors. The overlap turned out to be one line: the dirty hunk is at
`map.html:13237` and the branch's are at 972/2409/8142/8221/8239/13553/14091, so
a stash, the merge and `stash pop --index` landed it with the other session's
staged state intact. 2,316 tests green on the trial worktree.

| Stream | Owns | State |
|---|---|---|
| W6-A bombs | The aircraft secondary weapon, built from `../plane-bombs-and-torpedoes/README.md` §4-§5 (G-1…G-6) and BOMB-1…BOMB-12. The spec's own headline is that the extractor was never the problem: every rack is already parsed and stamped into the shipped glb, and the weapon dies on a three-line guard in `gunfire.js:484` that refuses a group with no flash, no tracer, no recoil and `velocity 0` — which is precisely a bomb rack. Own worktree | **merged `b8184ef`**, review MERGE WITH FIXES (`7199667`) |
| W6-B third-person soldier | The largest visible miss in the viewer: **nothing draws a human body in the world.** The camera half is done and merged — `soldier-camera.js` and the `chase-camera.js` placement law are correct and `__footView('chase')` already puts the camera where it belongs — and it is gated behind `?soldier3p=1` because driving it shows a grey field. The extracted soldier glbs carry **zero animations** and nothing exports a 3P clip, so this is a pipeline feature: the stance and gait families, and the canopy plus the 18 `3PParachute*.baf` clips. Own worktree | **merged `a60b260`** |
| W6-C hull vs statics | The largest unbuilt piece: a driven hull against the world, from `../viewer-ground-hull-collision/README.md` §3 and `collision-response.md`. Vehicle-against-vehicle has gone through the solver since 09-20; a building still stops a hull on the swept sphere and a plane that noses in is levelled out instead of tumbling. Told to port §6.1's `-1.0` rather than the engine's `+1.0` sign bug, and to feed a hull contact into per-wheel friction as an `N.y ≈ 0` sample rather than as grip. **The brief originally dangled the M3A1 lean as the bigger prize; that was withdrawn mid-flight when the owner ruled the lean correct, and the stream is now told to measure the lean before and after and report any movement as a regression.** Own worktree | **merged `3469648`** |
| W6-G netcode snap-back | The owner's own report: creating a game locally and joining it snapped his view back a few steps, constantly. Another agent had made it go away with `location.hostname !== '127.0.0.1'` in `onsnapshot` — a hostname test switching authority off where it is easiest to observe. It never reached `main` and is now reverted out of the working tree. The real defect is that a correction is `soldier.spawn()`, a respawn-shaped teleport that discards every input sent since the snapshot, with **no input replay** — so any standing divergence is a repeated snap rather than one that converges. This is P4's own scope. Own worktree | **merged `47f0224`** |
| W6-H verifier truth | `verify_models.py` called 42 of 96 vanilla models broken and every one was a false alarm. S3 already fixed the origin-pile half (`0590dd2`); what is left is the weapon length measured across a tracer (`Bar1918` 2.02 m against 1.19 m), the skinned soldier it does not understand, and the Sherman whose 27 parts collapse onto the hull. **Required to build deliberately broken models and show it still catches them** — a verifier that now passes everything is the same bug with the sign flipped. Own worktree | **merged `fbe6ee7`** |
| W6-E ships, research | The owner's three ship reports, read from the engine. No file changes outside its own feature doc | **reported `6024efd`**, second reader running. See below |
| W6-F spawner teams | The one ship defect already proven from the data: `teamOnVehicle` read as a team index. Own worktree | **merged `0934813`** (2026-09-22). See below |

**The ships round, and what the first pass already established.** The owner
reported three things after playing: destroyers sit high enough to show a
propeller, a spawn point on a ship puts you in the ocean, and Midway spawns the
Axis ships for *both* fleets. They are three different bugs.

- **The team one is proven and does not need research.** Every ship spawner
  declares `ObjectTemplate.teamOnVehicle 1` beside `setObjectTemplate 2 enterprise`
  and `setObjectTemplate 1 shokaku`, and `ObjectSpawns.con` gives each instance
  its own `setteam`. `level.py:1309-1312` reads `teamonvehicle` into
  `SpawnTemplate.owner_team`, and `spawn_vehicle` (`level.py:1355-1356`) lets it
  **override the instance's own team** — so both fleets get the team-1 hull. The
  shipped extract says so out loud: `{'spawner': 'carrierSpawner', 'vehicle':
  'shokaku', 'team': 2}`. **`teamOnVehicle` is not a team index**: across the
  vanilla levels it takes the values 1 (139 spawners), 2 (7) and **0 (33)**, and 0
  is not a team. 127 spawners that declare both teams' templates carry
  `teamOnVehicle 1`, across **Battle of Britain, Coral Sea, Guadalcanal, Invasion
  of the Philippines, Iwo Jima, Midway, Omaha Beach, Truk and Wake** — every one
  of them currently Axis for both sides. W6-F owns the fix; W6-E owes the engine
  read of what the flag really is (`ObjectSpawner::spawnObject` lnxded
  `0x083140a0`; no `setTeamOnVehicle` symbol exists, so it is a registered
  property).
- **The propeller is buoyancy, and the authored y is not the waterline.** Midway's
  `waterLevel` is 20. The destroyer instances are authored at y = **20.4371**;
  the battleships at y = **12.7**, which is 7.3 m *below* the same waterline. So
  the engine settles a ship both up and down, and the viewer draws it where
  authored because **nothing reads `FloatingBundle`** — `PhysicsFloatingBundle` is
  named in physics.md and nowhere consumed. `Fletcher_Floater` is `hullHeight 20`,
  `floatMaxLift 2`, `floatMinLift 2`.
- **The deck exists in our data and not in our collision.** Midway's
  `vehicleSoldierSpawns` carry y = 29.837 and 32.437, 10-12 m above the waterline,
  which is right. A ship is a dynamic object and not a static, so there is no deck
  in the statics index to land on — the same mechanism an earlier round guessed at
  for Wake's Shokaku and Hatsuzuki putting a soldier in the sea at y = 95. W6-E
  owes what geometry a ship contributes and how a soldier rides a moving one.
- Also noticed and handed to W6-E: the deck spawn at `[3194.183, 32.437,
  -2243.676]` carries `team: 1` while the ship spawner instance at the *same*
  position carries `team: 2`, so the soldier-spawn team may be a second bug.
- `c_ETShip` is not one of the three engine types `seats.js:186-196` has a drive
  model for, so a ship helm deliberately falls through to a bare `'seat'`.

**W6-F is merged** (`0934813`, 2026-09-22), record in
[`../teamonvehicle-is-a-bool/README.md`](../teamonvehicle-is-a-bool/README.md).
`teamOnVehicle` is a **bool**, proved four ways in lnxded rather than argued from
the data alone: a single `char` at `ObjectSpawnerTemplate+0x185`; registered with
the type string `"bool"` (`0x086b1e97`, written at `0x082a8946`) where
`nrOfObjectToSpawn` gets `"int"` and the delays `"float"`;
`ObjectSpawnerTemplate::makeScript` (`0x08314f70`) round-trips it as the
**literal** line `ObjectTemplate.teamOnVehicle 1` with no value appended, so the
engine itself can never write anything else; and `ObjectSpawner::spawnObject`
(`0x083140a0`) picks the hull with `map<u32, IObjectTemplate*>::find(this->team)`
on the **instance's** team at `+0x134`, consulting `+0x185` only to decide whether
to stamp that team onto the spawned object afterwards. The lead verified the two
strings independently in the image; `0x086e15e0` really is the whole line, and its
neighbour `ObjectTemplate.useButtonRadius ` really does end in the space that a
value would go in.

- **Two corrections to the lead's own survey**, which is why the stream was told
  to reproduce it: the first pass counted patch archives as separate levels, so
  the real vanilla figures are 88 spawners at `1`, 8 at `2`, 33 at `0`. **Truk was
  never affected** — its 33 are all `0`, which failed the old `in (1, 2)` guard —
  and vanilla's `teamOnVehicle 2` spawners all declare a single team, so `2` never
  moved a hull either. Across the mods: EoD alone writes `0` on 9,274 spawners.
- Fixed in vanilla on **Midway, Guadalcanal, Iwo Jima and Omaha Beach**, 12
  spawners and 30 placed instances; and in the mods on FHSW (1,652 instances),
  bg42 (330), bf1918 (699), FinnWars (118), FH (105), WarFront (53), DC_Final
  (24), EoD (37), DesertCombat (23), GCMOD (11), bfheroes (26), FHSWEurope (3)
  and XPack1 (4). Battle of Britain, Wake and Coral Sea don't move, each for its
  own reason — Wake's carrier spawner really does declare `shokaku` for both.
- **The deck spawns came right with it, as the same bug one step downstream.** The
  wrong hull meant reading the wrong ship's `Objects.con`, and
  `GlobalSpawnGroups.con` binds `hatsuzuki`'s groups 70/71/82/83 to team 1 where
  `fletcher`'s 68/69/80/81 are team 2. No separate fix.
- **Every American hull had been shipping with no engine or gun sound**, because
  `spawned_vehicle_templates` dropped the other half of such a spawner. Midway's
  `sounds.vehicles` goes 16 → 21, gaining `fletcher`, `fletcher2`, `enterprise`,
  `princeow` and `Gato`.
- Checked by the lead on a real extraction rather than from the report: Midway's
  team 2 is fletcher, fletcher2, enterprise, princeow and Gato, its team 1
  hatsuzuki, hatsuzuki2, shokaku, yamato and Sub7c, with all 17 American deck
  points team 2 and all 16 Japanese team 1. Suite 2,334 green at the trial merge,
  2,369 on main after it.
- Left open: an instance with no `setteam` (or `setteam 0`) still falls back to
  `vehicles.get(2) or vehicles.get(1)`, where the engine's `map.find` misses and
  `spawnObject` returns `0xffffffff` — so EoD's Green_Hell `Mortar_spawner` is
  arguably an empty pad. Proving the miss path needs a live server.

**W6-E reported** (`6024efd`, 858 lines,
[`../bf1942-ships-research-2026-09-22/README.md`](../bf1942-ships-research-2026-09-22/README.md)),
**and it collapses the owner's first report into his third.**
`PhysicsFloatingBundle::updatePhysics` is read in full (lnxded `0x0824d640`,
client `0x0057e980`, the client entry *derived* from the "No geometry for parent
in floatingBundle." string rather than guessed). `hullHeight` is a **datum, not a
dimension**: `f = 0` when the float node sits at `waterLevel + hullHeight` and
`-1` at the waterline, the force is purely world-vertical applied at the node, so
pitch and roll righting falls out of the torque term and nothing else levels a
ship. The closed-form equilibrium `Σ(-f)·lift = 9.82` predicts eight vanilla
hulls, and **every Midway pad is authored within 0.7 m of the ALLIED ship's
draft** — so a Fletcher on its own pad sits 0.21 m high, with its screw still
2.2 m under, while the Hatsuzuki that SPAWN-1 put there instead sits **6.07 m
above its own waterline**. The lead recomputed both from the archives. The
propeller the owner saw was the wrong ship on the pad, and W6-F has already
fixed it; what remains is that **nothing settles at all**, because
`map.html:5755` is `if (vehicleCategory === 'VCSea') return null;`.

- The lead's own first recount said 16 float nodes, not 8, and would have falsely
  refuted the report: `Sea/fletcher/Objects.con` defines **two** hulls, `Fletcher`
  and `Fletcher2`, 8 floaters each. Scope a component count to its own
  `ObjectTemplate.create` block.
- `waterHeight` (`+0x1b0`) and `dragModifier` (`+0x1c0`) are read by **nothing**,
  so `Hatsuzuki`'s `dragModifier 8000` is dead. Flagged to the second reader
  because a negative from a whole-image scan is exactly the shape of claim W2-D's
  review once overturned.
- **A ship starts sinking at `criticalDamage`, not death** — only Armor message
  `0x14` arms the rate, and each float node sinks at its own rate scaled by its
  `x+z` offset from the hull centre, which is why a ship goes down by one end.
  `BFSpawnPoint::getActive` refuses deck spawns on the same threshold, so a
  burning destroyer stops offering them exactly as it starts going down.
- **The earlier round's deck-spawn explanation is refuted.** `BFSpawnPoint::spawn`
  (`0x08163d70`) is a bare `setAbsolutePosition`; a ship is a dynamic body the
  pair filter never skips, so "the carriers are not in the static collision index"
  was the wrong model, and the hull's `collision 1` node *is* in the shipped glb.
  The report's own leading candidate for the viewer bug is that
  `soldier.js`'s `settle()` probes downward only, while several spawns are
  authored *inside* the hull (`FletcherSoldierSpawn` `relY 5` under a `relY 7.5`
  deck) — it never ran the page, so the second reader was told to.
- `c_ETShip` is on the **aircraft** thrust law with bit 3 as its water rule, and
  the submarine dive turns out to be the floater's own `min`/`max` lift term under
  a `RotationalBundle` — no new subsystem for either.
- **Held out of the corpus deliberately.** It is committed as a report; its 13
  ledger rows and 30 symbols enter `ledger.md` and `symbols.json` only after the
  second reader, per this round's rule. Priorities set for that reader: the
  `1 + 24f` damping sign reversal (if it is backwards every ship oscillates), the
  "read by nothing" negatives, and running the deck-spawn check on the page.
- **Re-extraction owed** (the hull mesh in `scene.glb` is wrong too, not just the
  json): vanilla's GuadalCanal, Iwo_Jima, Midway and Omaha_Beach, XPack1's husky,
  and EoD's five. Nothing published, and nothing written into the shared
  `viewer/maps` tree.

**Wave 6 is closed: all six streams merged, suite 2,488 green, main at `a60b260`.**
What each one turned out to be, where it differs from what its brief expected:

- **W6-A bombs.** A plane drops bombs for the first time. The review's job was the
  collateral, because BOMB-1 lands on every multi-barrel `FireArms` and not only
  on racks: it re-derived `Fire` (`0x0828a090`) and `fireFinished` (`0x08288470`)
  from the bytes without reference to the build record and all six load-bearing
  claims hold, so game-wide is right. **Three of the stream's worked examples were
  wrong, all three verified by the lead against `Objects.rfa`**: the Katyusha
  declares `setAsynchronyFire 1` and so really does fire one rail a pull (the OLD
  comment's conclusion was right), `Elco80_Torpedos` likewise, and `CorsairGuns`
  is `magSize 900` — the 600-round magazines that halve from 50 s to 25 are
  `SBDGuns`, `SBD-TGuns` and `IlyushinGuns`. The stream's own two best catches
  were spec errors: `gravityScale` is `0/0` = **NaN** at a zero release, which
  would have deleted gravity from every bomb, and `Bomb.ssc`'s first sounding
  patch is the LOOPING whistle. Two of its hedges closed in its favour —
  Refractor's update dispatch is a flat registry (`ObjectManager::updateObjects`
  `0x0819be10`), not parent recursion, so a torpedo's child `Engine` does run.
- **W6-B third-person soldier.** There is a man in the world and **he breathes**:
  657 px move between two frames 0.4 s apart while he stands still, which a
  constant clip cannot do. 68.3% of the chase-view box is body. `?soldier3p=1` is
  gone and the default is on. The absences are half the result:
  **`Ub_ParachuteIdle` does not exist**, `Lb_ParachuteFall` names
  `3pExplosionFly*`, ten of the eighteen `3PParachute*.baf` files are named by no
  state, and the three stance clips were never stills but 17-18 frame breathing
  loops the pose files had been sampling one frame of. It also corrected
  `PARACHUTE_VIEW_RADIUS`: a parachutist is **13.3 m** tall, so at 3.0 the canopy
  sat entirely off-frame.
- **W6-C hull vs statics.** A driven hull probes its own col0 vertices into the
  shared contact solver instead of meeting a building through `sweepSphere`. The
  plan deferred the vertex probe as needing col0 plumbed; the 09-20 round had
  already plumbed it. **It found a defect on main**: the sweep pins position and
  cancels only the normal component, so a Willy driven into Bocage's `barack_m1`
  never moves — frozen, `grounded: false`, pitch and roll exactly 0.00 — while its
  velocity sawtooths 22 → 36.9 m/s for ever. A BF109 at 60 m/s used to log **zero
  contacts and fly through a church**. And the new path costs **0.407 ms/tick
  against the sweep's 0.463**, so it is cheaper than what it removed.
- **W6-G netcode.** The owner's local snap-back was two sims walking on different
  headings from different spawn points: `rooms.mjs` asked for `advance: true` while
  the page picked its own (45 m apart), and then `soldier.spawn(x, y, z)` left
  `soldier.js:382`'s `yaw = 0` default to wipe the client's facing, so the two
  integrated the same input 17.719 degrees apart and separated at 1.85 m/s for
  ever. What proved it was heading rather than latency is that the divergence was
  almost entirely **lateral**. A third defect fell out: remote soldiers were drawn
  at a **57th** of their heading, radians written and degrees assumed. 9 teleports
  in 20 s → 0 in 30. The previous agent's `location.hostname` test is reverted.
- **W6-H verifier.** It can be believed and it can still fail: **seven mutated
  real models caught, four of which passed before** — collapsed binds, a stripped
  skeleton, a Sherman missing its whole tower, and an emptied `boundParts`. EoD
  221/56/8 exit 1 → 251/34/0 exit 0, with the eight BROKEN verdicts **proved**
  false rather than suppressed. Two real things the noise hid: EoD's M79 family
  genuinely draws no receiver, trigger or magazine (the game has the same holes),
  and the origin-pile check cannot catch a weapon collapsing on its own.

**Carried as a fact and deliberately not acted on.** `ground.js` computes inertia
as a solid box's `(a^2+b^2)/12` — `WILLYS` 0.40/1.27/1.29 are exactly those values
for its 1.6x1.5x3.6 box, checked by the lead — where the engine's
`getGeometryInertia` is `(DY^2+DZ^2)/3`, **four times larger**. Every ground
vehicle is therefore 4x more responsive in roll than the engine would be. Since
the owner has ruled the current lean a match for the real game, closing that gap
would reduce the lean about fourfold and would be a **regression**. Either the
engine read is wrong or something else compensates; it is an open tension, not a
task.

**The re-extract, at last done once rather than four times.** Poses through
`extract_pose.py --shared-assets` (`poses/gaits/` 5,302,423 → 9,505,203 B, and the
extractor prints `absent: Ub_ParachuteIdle`, so the absence is data). All 23
vanilla levels through `extract_maps_all.py`, which carries W6-F's four ship
levels, the deck-spawn sign fix everywhere a ship stands, and W6-A's four new
projectile fields that a placed aircraft needs. **Nothing published.**

### Waves 7 and 8: ships, and water (2026-09-22)

The owner drove what wave 6 shipped and reported defects from play. Both waves are
**merged**; main carried 2,639 tests green at the end of them.

| Stream | Owns | State |
|---|---|---|
| W7-A ships, build | Buoyancy, propulsion, deck spawns, guns and seat cycling, sinking — from the second-read research | **merged `d265a6fa`** |
| W7-B inertia fallout | Ground inertia taken to the engine's `getGeometryInertia` on the owner's instruction, and the tests that were fitted to the old constant | **merged `58489690`** |
| W8-A ships, round 2 | The owner's three follow-ups: too quick, does not run aground, spawns do not follow a moved hull | **merged `7300024c`** |
| W8-B water and swimming | A man walks on water; in the game he swims and drowns | **merged `8f00bfd9`** |

**Ships now float at their real draft, drive, beach, sink, and carry their spawns.**
Eight hulls placed from the closed form `Σ(−f)·lift = 9.82` match the research's
predictions to the table's own rounding. `SETTLE_TICKS` was deliberately not
raised: the law reproduces the verdict's 300-tick residuals exactly (Fletcher
0.147 m), which is the argument for solving rather than iterating.

- **Guns and seat cycling were never broken.** The stream was told to verify before
  writing and did: a Fletcher's helm already collected 4 gun groups and the number
  row already moved between positions. `TurretAxis` and `VehicleOccupancy` never
  cared that the root had no drive model. The only defect was `__enterOwner`
  returning false.
- **"Too quick" was the ACCELERATION, not the top speed**, and W8-A said so rather
  than hiding that two numbers moved the other way. A destroyer was reaching 17
  knots two seconds after the pedal went down; speed at 2 s is now 4.5-5.1x lower.
  The mechanism is that a ship's thrust throttle is the gearbox's **rev** state and
  its load is `K·ratio/torque` — a speed-dependent governor holding a Fletcher at
  0.48 revs at full pedal (`viewer/engine-revs.js`).
- Top speed **rose** because the drag box was a **world AABB at the hull's moored
  heading**: Midway's Fletcher was given 100.56 x 35.95 x 82.80 m, a 19 m beam read
  as 100 m, and her drag changed with which way she was parked.
- **The steady turn is authored data and no code lever reaches it.**
  `55/tan(25°) = 118 m`, speed- and inertia-independent; the lead verified the ±25°
  rudder in `fletcher/Physics.con`. A real Fletcher's circle is about three times
  that, so **the game turns tighter than the ship did**. Ship inertia was still a
  quarter of the engine's and is fixed — worth 3.9x in the first 2 s of rudder and
  nothing at all in the steady rate.
- **PHY-10, new**: `setUnderWater`'s only physics caller is
  `ResponsePhysics::checkVsTerrain`, and the value is a **keel depth in metres** —
  the minimum y of the col0 vertices against the water level. Left open and said
  so: an `n > 10` arm calls neither setter, so a capital ship may never have it
  written at all.
- Two corpus corrections, one to a brief the lead had passed on: `getCurrentRatio()`
  is **gear**-indexed, not rev-indexed, so a ship's 7.447 is exact at every rev;
  and `throttleMin` is −0.8.

**Water.** `settle()` was putting the feet on `max(heightfield, waterLevel)` —
right for a vehicle on a bridge, wrong for a man. `BFSoldier::updateSwimming`
(`0x08282190`) is read in full: enter above **0.43 m** of depth, leave at **0.35 or
below**, and in between the soldier is **teleported** to `surfaceY − 0.4` rather
than solved. A ladder neither starts nor ends a swim.

- **Drowning is the VEHICLE's own timer**, armed by the swim flag and not by
  contact: a soldier-specific clause in `Armor::setLastHitMaterialIndex` gives a
  `CID_BFSoldierTemplate` object `armor[0x11] = isSwimming()` where everything else
  gets 1. 90 s of grace then 1 HP/s against 30 HP, dead at 119 — verified by the
  lead in `CommonSoldierData.inc`, measured on the page as destroyed at 120 in
  5-second buckets. One dry tick restores the whole grace.
- **It refuted a claim in our own code.** `armor.js`'s header said the water tick
  "explicitly skips soldiers — no HP loss at all", citing an `R4-13` from a
  `verify-r4.md` not in the tree. The merge left the refutation in the ledger and
  the feature doc but not in the file; the lead corrected it (`f66b567`), because a
  wrong comment in the code outlives any report.
- The weapon is stowed, **read not assumed**: all five swim states declare
  `c_AsmHideWeapon` (5 of 5, lead-verified) and `enableItem` returns early while
  that bit is up. A swimmer cannot jump (`handleSwimAction` discards `c_PIAction`)
  but can still fire.
- **One invented number, labelled as such**: the swim speed ceiling. The engine's
  cap is the box drag `physics.js` does not carry — its sphere law balances at
  167 m/s — so `walkSpeedFactor`'s 2.0 m/s stands in, with the box law's own 2.06
  noted as independent support.

**A methodology find worth more than either feature.** A with/without-body pixel
differential is invalid while the page's rAF loop is running: Playwright's page
composites, so water, sky and sim all move between the two captures. A run doing
this reported **59.6% of an empty ocean as the soldier** and had to be redone.
Stop the loop, pin the time-driven uniforms, and **always run the zero control**.
It is also how a real clip is told from a still mesh — 657 px moving 0.4 s apart
while a soldier stands "still" is his breathing loop.

**Published 2026-09-22.** A size delta of 442 files / 1.45 GB against a 20 GB tree
(models 226 / 0.24 GB, maps 216 / 1.21 GB), 70 legacy files on the volume left
alone. The publish-order rule was checked first, not assumed: all seven new modules
answered 200 on `mesh.bfstats.io` and `swim.js` was confirmed to be the real module
rather than a 200-with-index-page. Also fixed on the way through: the publisher
reported "no filebrowser pod; scale it up first" when the cluster was merely
unreachable, which invited scaling a pod that had been running 16 days (`04195b7`).

### Radio commands and the message log (2026-09-23)

The F1..F8 radio and the top-left kill / game-information / chat log, rebuilt
from the client binary and the game's own menu data. Everything about it -
what was read, from which addresses, what was built and what is still open -
is in [`../radio-and-chat-log/README.md`](../radio-and-chat-log/README.md).
Branch `viewer/radio-chat`, worktree `bfstats-radio-chat`.

| Item | Status |
|---|---|
| Radio menu: the strip, the seven pages, the key handler (verified line for line), messages, the vehicle remap, CLOSEST, the spam limit | **built**, not merged |
| Voices: team radio flat in the listener's language, shouts in 3D in the speaker's (10..55 m ramp, 70 m reach); vanilla, XPack1 (`it`, `fre`), XPack2, EoD | **built**; assets **published** 2026-09-23 |
| Message log: three sections, per-section 5 s timers, team colours, ticket flags, the outline, kill / team kill / death / capture / all-points lines, the centre kill message | **built**, not merged |
| Room relay (`GameServer::radioMessage`): team radio to the team, shouts within 70 m | **built**, not merged (`test_room.py` (r)) |
| Bots reacting to radio (`AIRadio` strengths feeding MoveTo, Fire, TakeCover, MedicAssist, Change) | **open**: rules read, not wired; bot behaviours still take "no radio" |
| Hand signs on a shout, minimap flash for the speaker, medic / repair map marker | **open** |
| Player text chat (say all / say team input) | **open**; `chat-log.js playerChatLine` has the line format |
| Why on-foot kills print `[killed]` in retail although the server stamps the weapon; `BfMenu+0x6DC` (conquest's radio game mode) | **open** engine reads |

### Not yet assigned

Hull collision between ground vehicles and the world has an engine spec
(`subsystems/collision-response.md`, the other session's round) and a plan
(`features/viewer-ground-hull-collision/README.md`); it is the largest piece
left and is not in wave 3.

**Vehicle against vehicle is built (2026-09-20, the other session).** A rammed
vehicle is a rigid body on its own wheel springs: it is pushed, spun and hurt,
and so is whoever hit it, by the engine's own contact solver and crash-damage
formulas. Record and open items in `features/vehicle-collision-physics/README.md`.
What that leaves of the piece above is the driven hull against *statics*, which
still stops on the swept sphere, and a drive model that tumbles when it crashes.


| Item | Status |
|---|---|
| Game modes other than Conquest: `find_gameplay_mode` picks one. 1,420 vehicle and 1,736 soldier spawns unread. Instant Battle in the real game runs the `SinglePlayer` layout, so this feeds stream A | open |
| Mod HUD chrome: `extract_hud_pack.py` and `extract_spawn_layout.py` read `Mods/bf1942` only; 16 mods ship their own `menu.rfa` | open |
| Impact and explosion sounds: the bundles carry `loadSoundScript`, the samples are not extracted | open |
| Debris falls through the ground (particles have no collision) | open |
| No dynamic shadows (`castShadow = false` is the only hit) | open |
| `poses.html` cannot fire a weapon (never imports `GunFire`) | open |
| Spawn-pad soldiers are decoration; crouch and prone play the standing aim | **assigned, W5-A** (with the on-foot splash gap) |
| Ground vehicles have no hull collision; every drive constant is `[free]` until a drive is recorded in wine | open (vehicle-vs-vehicle rigid body collision is done `47b273d`; hull vs statics open) |
| Carrier deck aircraft spawners, ramp pitch, and turret peering | **done (`0e1cd1e1`, `features/carrier-destroyer-parity/`)** |
| Ship buoyancy, draft placement, driving, and sinking | **done (`d265a6fa`, `7300024c`, `features/viewer-ships/`)** |
| Water swimming and drowning mechanics | **done (`8f00bfd9`, `18852ccc`, `features/viewer-swimming/`)** |
| A tank's external camera follows the hull, not the turret | **done, W4-C `577de24`** (turret-following default kept by the owner's ruling) |
| Seat-occupancy dots unfed (positions are live-bound per vehicle) | **done, W4-A `eab59c0`** |
| SCORE BOARD opens nothing | **done, W4-B `e173af4`** |
| Minimap zoom (N) and rotating mode | **done, W4-B `e173af4`** |
| Deploy-screen kit row labels should come from `setKitName` | **done, W4-A `eab59c0`** (EoD `loadouts.json` re-extracted with `kitName`) |
| `Water.baseTex`, `envmapcolor`; `aiMeshes.rfa` hulls; palm trunk collision; `c_CGProjectiles` / `c_CGLadders`; `LightmapShadowBits.lsb` (format unknown); Berlin's ground outside its four tiles | open |
| Bar1918 round counter never decrements (`task_4b7d2a66`) | open, unreproduced |
| `verify_models.py` is stale: on the 09-19 vanilla rebuild it calls 42 of 96 models broken, every one a false alarm. It counts projectile, tracer, trail, cockpit and emitter helper nodes as "unbound parts piled on the origin", measures a rifle's length across them (Bar1918 2.02 m against 1.19 m), and does not understand a skinned soldier. Checked by eye: `BritishSoldier`, `AichiVal` and `Bar1918` render correctly. A verifier that always says broken hides the day it is right | open |
| Bots. Nothing about the engine's AI is in the corpus: how a bot is spawned, driven and given a kit, what `aiMeshes.rfa` and a level's `AI/` and `AIPathFinding/` hold, and what the Instant Battle screen's difficulty variables become when a battle starts. Until it is documented the screen's whole left column is switched off (`SHOW_BOT_SETTINGS` in `viewer/play/menu-screen.js`, owner's call 2026-09-20) | **assigned, W5-D** (research only; the screen's left column stays off until it reports) |
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
   **Re-extracted locally 2026-09-21, not yet published:** all **99**
   viewmodel rigs through `extract_viewmodel.py` so the stance families
   W5-A reads actually exist on disk (166 MB → 222 MB; every rig carries
   the eight new clips, and the absences are data — `proneReload` on the
   56 weapons with no reload, `proneFire` on 14, `proneDeploy` on 2). And
   the bail-out sounds through `extract_soldier_sounds.py` into
   `viewer/maps/_shared/sounds` (11 samples; `c_SstParachuteLand`
   correctly reported missing — the engine ships no such script, PARA-7).
   Still owed from earlier waves: `loadouts.json` for W4-A's `kitName`,
   `skeletonIK` nodes in the published scenes, `hasTurretIcon` /
   `vehicleIconPos` on vehicles, `crossHairType` on the mods' levels, and
   `_shared/hud/scoreboard/` with the viewer code.
4. ~~Integrate verified research into `ledger.md` and `symbols.json`.~~
   **Done 2026-09-21** (`e0a1099`), for wave 5: three new sections —
   PARA-1…PARA-9 (the parachute), AI-1…AI-25 (the bot subsystem) and
   ANIM-10…ANIM-12 (per-stance upper-body states) — plus the pose
   constants on HP-10. 317 ledger rows, no duplicate ids. `symbols.json`
   merged **by address**: 49 new, 5 updated in place, 1,263 total, no
   duplicate addresses, file order untouched. Two refutations are
   recorded as such rather than quietly replaced: PARA-2
   (`setParachuteSpeed` is an acceleration) and AI-4 (the AI runs first,
   not last — the `+0x1b3` offset is layout, not execution).

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

### W4-F. Research (scoreboard, tank camera, minimap)

Tag `w4f-research`. No worktree, no file changes outside your scratch
directory. Three reads, each reported with the claim, the evidence (addresses in
both binaries where both apply), what it changes in our code (file and line), and
a ledger row in the ledger's table format:

1. **The in-game scoreboard.** Which meme page it is (the `menu/InGame` group or
   a separate page), what it lists (players, kills, tickets, control points?),
   how it is fed, and what the `SCORE BOARD` button on the deploy/respawn screen
   opens. The viewer's `deployScoreBtn` (`map.html`) is a button in name only.
2. **The tank external camera.** Which view mode the external/chase camera is,
   and whether it targets the hull or the turret. The viewer's external view
   follows the hull; the game's follows the turret. Read the camera law (the
   `CameraTemplate` / view-mode code, `cameraViewModes` already parsed by
   `con.py`) and say exactly what the external camera tracks and how it is
   positioned.
3. **MMAP-1/2.** Who writes the minimap zoom and the minimap yaw. The ledger has
   `BfMap__animate` recomputing the displayed rotation each frame with no easing,
   and `+0x68` (the target angle) and `+0x58` unread. Close both: what sets the
   zoom (the `N` key / `game.setMinimapZoom`?) and what sets the yaw, and what
   `game.setStaticMinimap` does.

Say plainly which rows you could not close and how far you got.

### W4-A. HUD wiring: seat dots and kit labels

Tag `w4a-hud`, port 5321. Worktree `bfstats-w4a-hud` (branch `w4/hud`). Owns:
`seats.js` `seatDots()` and its feed in `map.html`, `hud.js` `seatDotPosition`,
`extract_loadouts.py` / `bf42/kit.py` for `setKitName`, and the deploy-screen kit
row in `map.html`.

Done means: the six seat-occupancy dots on the vehicle HUD show the live
per-vehicle occupancy (who is in which seat), fed from the `VehicleOccupancy`
that already tracks seat switches — `vehicleIconPos` is already in the
re-extracted scenes, so this is wiring, not extraction. And the deploy screen's
five kit rows are labelled from the engine's own `ObjectTemplate.setKitName`
(a lexicon key such as `RESPAWN_AT`, resolved through the same lexicon the menu
titles use), not the hardcoded Scout/Assault/Anti-tank/Medic/Engineer. Extract
`setKitName` into `loadouts.json`, resolve the key, and swap the labels. Prove
both on the page with a capture; keep the suite green.

### W4-B. SCORE BOARD and minimap zoom/rotation

Tag `w4b-board`, port 5322. Worktree `bfstats-w4b-board` (branch `w4/board-map`).
Owns: the scoreboard surface in `map.html` (behind `deployScoreBtn`), the
minimap zoom and rotating mode in `map.html`'s minimap code. Built from W4-F's
verified reads.

Done means: `SCORE BOARD` opens the in-game board the way the game draws it
(from W4-F's page read), fed with whatever the game feeds it. And the minimap
zooms on `N` and has the rotating mode, by the engine's own zoom and yaw law
(from W4-F's MMAP-1/2 read), not a guess. Prove both on the page with a capture;
keep the suite green.

### W4-C. Tank external camera

Tag `w4c-camera`, port 5323. Worktree `bfstats-w4c-camera` (branch `w4/camera`).
Owns: the external/chase camera in `map.html` (the C-key view cycling and the
camera it drives). Built from W4-F's camera read.

Done means: the tank's external view follows the turret, not the hull, by the
engine's own camera law (from W4-F's read), over the existing C-key cycling.
Prove it on the page with a capture (a turreted tank, external view, turret
traversed); keep the suite green.
