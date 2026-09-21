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
have not found what prevents it in the engine. **Parked on two observations of
the real game, asked of the owner: does an M3A1 lean hard in a turn above about
40 km/h, and does a jeep with a driver and no throttle roll down a gentle
slope?** The reviewer is checking the two new commits meanwhile.

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

**W3-A (drivetrain) is merged as it stands** (`36ff97e`, 2026-09-20), on the
owner's word ("merge it as-is for now, I will get back to you later"). The two
real-game observations are STILL OWED and decide whether it stays: an occupied
jeep with no throttle rolling down a 5-10 degree slope, and an M3A1 lying over in
a turn above about 40 km/h while a Hanomag stays flat. If retail shows otherwise
the lateral law is wrong somewhere two readers missed. Known on main until then:
the M3A1 leans 32-38 degrees in fast turns; an occupied jeep walks 7.65 m in 10 s
down 5 degrees. Still to do regardless: sample the contact velocity at the same
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
| W4-C build | **tank external camera** — the external view follows the turret, not the hull, built from W4-F's camera read over the existing C-key cycling. Worktree `bfstats-w4c-camera` (branch `w4/camera`), port 5323 | **merged `577de24`** (2026-09-21; the first build agent crashed before writing anything, a second built it; lead review, suite 2178 OK at merge). Chase and front views of a seat whose Camera rides an aimed axis are anchored on the seat Camera with the engine's offsets (`1.2 R`, `0.3` up, ease `1 - exp(-2 dt)`, 1 m terrain clamp); measured camera heading follows the turret 0 to -90.04 degrees with the hull fixed. **Owner's ruling 2026-09-21: keep turret-following as the default** (checked on the page, "the way it follows the turret"). For the record, the build agent's read of `Camera::getTransformation` (lnxded `0x081aaf90`, client `0x005659b0`) has the chase *direction* come from the vehicle root and only the *anchor* ride the turret, against this round's premise. Turret-following ships as the default, labelled a viewer choice; `?chase=engine` runs the law as read, `?chase=legacy` the old framing; the default is one line in `chaseLawFor`. Open: only the Sherman was run, gun pitch not captured, the 7.125 m bounding radius is unverified, gunner seats have no external view here. Report `w4c-camera.md`, with ledger rows (CVM-2, CVM-3, a CVM-1 amendment) ready to paste |

W4-A and W4-F run in parallel; W4-B and W4-C launch once W4-F reports and its
claims pass a second reader.

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
| Spawn-pad soldiers are decoration; crouch and prone play the standing aim | open |
| Ground vehicles have no hull collision; every drive constant is `[free]` until a drive is recorded in wine | open |
| A tank's external camera follows the hull, not the turret | **done, W4-C `577de24`** (turret-following default kept by the owner's ruling) |
| Seat-occupancy dots unfed (positions are live-bound per vehicle) | **done, W4-A `eab59c0`** |
| SCORE BOARD opens nothing | **done, W4-B `e173af4`** |
| Minimap zoom (N) and rotating mode | **done, W4-B `e173af4`** |
| Deploy-screen kit row labels should come from `setKitName` | **done, W4-A `eab59c0`** (needs the `loadouts.json` re-extract) |
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
