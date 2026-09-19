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
| A new site, separate from `mesh.bfstats.io`, that serves the map page and its assets | open (A) |
| The game's own Singleplayer > Instant Battle screen (`menu/SkirmishMenu`), drawn from the game's layout, textures, fonts and strings, that picks a level and a team and launches the map | open (A) |
| The map page's debug panel (level picker, fog, wireframe, vehicles, pilot, spawn on foot, sound) hidden from a regular player | open (B). The panel is collapsed behind a `Maps` fab as of today; it must disappear entirely |
| The in-game console on the tilde key, reconstructed from the client, with `show.dev 1` (and `show.dev = 1`) revealing the debug panel | open (B) |

### Vehicle occupants (stream C)

| Item | Status |
|---|---|
| A driver or a gunner is not drawn: `loadSeatPose` bails when a seat has no `poseAnimation` | open (C), [plan](../bf1942-3d-models/vehicle-occupant-pose-plan.md) steps 3 to 6 |
| Hands follow the steering wheel (`addSkeletonIK`) | data (C) |

### Viewer wiring for data that now exists (stream D)

| Item | Status |
|---|---|
| `envmap true` on 435 materials (aircraft painted metal first, glass second): exported as `material.extras.envmap`, no viewer binding | data (D) |
| Ticket counters: `scene.json.tickets` exists after re-extract; `map.html` hardcodes `ShowTicket = false` | data (D) |
| The combat-area boundary is in all 23 `scene.json` files and the 3D view never reads it | data (D) |
| Sun lens flare and corona: 16 verbs on 21 of 23 levels, parsed by nothing | open (D) |

### Engine research (streams F1 to F3, then verifiers)

The ledger has 200 rows. Ten are `open` and nine more are confirmed with an
unread part. The Ghidra bridge is up and the hash matches.

| Stream | Rows |
|---|---|
| F1, damage | **HP-9** explosion falloff inside the radius (the splash formula merged today is the Mod Development Toolkit's linear one, not the binary's); **HP-13** what the client HUD does with Armor status 0x13/0x14/0x15; **SUP-15** what reads `healFactor` and friends; **SUP-17** the in-world supply icon draw path; the fall-damage per-surface material scalar ([groundwork](../bf1942-3d-models/fall-damage-research-groundwork-2026-09-17.md)) |
| F2, vehicle HUD and seats | **VHUD-9** what sets `ShowTurretIcon`, and `IconLookRotation`'s unit, sign and pivot; **VHUD-10** live ammo for a driver's own guns; **HUD-10** `setHudAmmoType` to `Ammo/AmmoType`; **SEAT-11** the `force` value at the seat-switch call; **GUN-2** the turret integrator's closed form; **TANK-4** the gear-ratio curve values |
| F3, movement | **PHY-1** where a jump becomes upward velocity (the client predicts it; the server computes none); **PHY-2** friction force magnitudes per grip class; the car spring and tyre integrator starting at client `0x0057f0d0` |
| Wave 2 | **MMAP-1/2** who writes the minimap zoom and yaw; **LM-3**; **SM-5**; **MEME-11** (80 of 230 menu pages read clean); SIDE-1, SIDE-3 |

### Wave 2, not yet assigned

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
| Mod coverage: 18 mods installed; maps and models exist for vanilla, XPack1, XPack2 and EoD only | by choice, for now |

### The lead's own queue

1. Rebuild `viewer/models` for vanilla, XPack1, XPack2 and EoD **from the
   game** (running). The local vanilla `models.json` had been cut to one entry
   by a subset extraction on 09-18 23:43.
2. Re-extract every level once the streams' extractor changes are merged, so the
   tree picks up tickets, building sounds, `vehicleSoldierSpawns`,
   `splashMaterial`, `skeletonIK`, `envmap` and the widened emitter bake in one
   pass rather than five.
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
