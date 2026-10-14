# FHSWEurope and FHSW play-test mechanics, 2026-10-14 night

Status: every group landed on branch `fhswe-mechanics-2026-10-14` (not merged).

- Ten defects are fixed.
- Item 10, the Norden bombs, is partial. Its miss is cut by a quarter to a
  half, and a retail capture is the next step.
- The three reports added during the night are covered too: Midway's deck
  planes and FHSWEurope's sliding bots are fixed, and Omaha's CoOp pits are
  the level's own data.
- Five owner questions and one publish (the FHSW and FHSWEurope gait bundles
  and HUD icon tables) are below.

Eleven defects the owner found play-testing FHSWEurope and FHSW levels baked
and completed on 2026-10-14 (`features/fhsweurope-extraction/README.md`). Each
is treated as a sample of a mechanic, not a map: named in engine terms,
counted over the exported levels of every tree (the rows of each tree's
`maps.json`, never the install), fixed at the owning layer, verified on the
reported level and another, and gated so the next export cannot repeat it.

Scope note: on 2026-10-14 FHSWEurope's `maps.json` grew from 10 to 46 rows and
FHSW's from 70 to 94 (the "pending imports" of the extraction tracker were
imported). Every census here is over those 46 and 94 rows, and over vanilla
(23), XPack1 (29), XPack2 (32), FH (10), DC (35), DC Final (48) and EoD (239),
the trees with a `maps.json`. A count for a tree outside the owner's scope
tonight (DC, DC Final, EoD, FH) is a count only; nothing was baked or patched
there.

## Summary

| # | Defect | Mechanic | Census (exported levels) | Status | Gate added | Commit |
|---|---|---|---|---|---|---|
| 1 | Operation Da: P-40 below the hangar floor, handstand on entry | A hull placed sunk into a static floor; the static as a ride surface (COL-6) | 1,072 hulls stand on a static; 359 placed sunk into it; 6 left sunk after the fix (all EoD) | fixed | `audit_mod.py` placement `hull-sunk-in-static`; corpus | cfeb36d5 |
| 1b | (found by the census) The room server dropped 53% of a level's collision triangles | A multi-primitive collision mesh, primitive 0 only | Operation Da: 176,247 of 331,495 triangles | fixed | `tests/test_glb_scene_primitives.py` | cfeb36d5 |
| 1c | (found by the census) FHSWEurope tigerpass-1943 never loads | A static placed at 1e22 m by the level script stretches the collision index | 1 level | fixed | `tests/test_stands_on_static.py` | cfeb36d5 |
| 2 | FHT Golf Hotel: streaked buildings at distance | A lightmapped mesh keeps LOD 0 alone (new ledger row LOD-6) | 20,439 lightmapped parts on 482 levels shipped rungs the client never builds | fixed (viewer covers every published bake; exporter for the next) | corpus probe `lightmapped_rungs` | cfeb36d5 |
| 3 | Saipan: B-29 air spawn shows the kit's rifle | A spawn into a seat climbs in before the rig loads (SPAWN-25) | 104 levels seat a human on spawn in FHSW and FHSWEurope (770 points) | fixed | `audit_behaviour.mjs` `spawn.seat-shows-kit` | 54b6fc7e |
| 4 | Ilomantsi: SU-122 round selector snaps back | A non-reset RotationalBundle holds its angle (GUN-2) | 489 placed vehicles on 116 levels (FHSW, FHSWEurope) | fixed | `audit_behaviour.mjs` `veh.selector-springs-back` | 54b6fc7e |
| 5 | Bombing the Reich: no B-40 gunner sight | Twin distance-selected sights (LOD-3) and their graft | 74 vehicles affected (FHSW 44, FHSWEurope 30) | fixed; size against retail open | `tests/test_twin_sights.py` | 54b6fc7e |
| new | Midway: deck planes below the deck | A held craft stands at its spawner plus `spawnOffset` (AI-121) | 377 held objects on 74 levels | fixed | `tests/test_held_spawn_offset.py` | 8e648729 |
| new | FHSWEurope: bots slide instead of running | FHSW's leg hub states (per-weapon copies) | every soldier on 140 levels (FHSW, FHSWEurope) | fixed (needs a publish) | corpus probe `gait_clips` | 66993269 |
| 6 | Bombing the Reich: bombers' map symbol | Held objects are map marks of their own (AI-121); declared icon size; `.inc` icons | 651 held symbols, 185 `.inc` dots, 913 wrong sizes | fixed | `tests/test_held_map_marks.py` | 54b6fc7e |
| 7 | Biak: Catfish seaplanes take water damage, sink | A seaplane floats on its FloatingBundles (PHY-3); only a mobile part meets the sea (HP-21, binary and lab) | 251 seaplanes on 41 levels (FHSW, FHSWEurope); EoD's CH-47 22 | fixed; matches the lab's retail rounds | `tests/test_seaplane_water.py`, `tests/test_part_mobility.py` | 6aef47c1, 9c296d7e |
| 8 | Biak: PT boats cannot be driven, torpedoes burst | A ship grounds on her col0 vertices, not her box (`checkVsTerrain`, read in full); torpedo depth FLOAT-1 | 1,738 placements of 332 hull types on 190 levels | fixed (torpedo: retail behaviour in 2 m of water) | `tests/test_ship_underside.py` | 65873e44, 56a213c2 |
| 9 | Bombing the Reich: A-26 rearms anywhere (Mosquito: not reproduced) | A held object authored critical burns down in 2 s and its depot with it (HP-17, SPAWN-24) | 123 burn-down depot templates, 677 placed on 80 levels (FHSW, FHSWEurope); 144 air-spawn reloaders | fixed | `tests/test_supply.py` (two tests) | 9416daea |
| 10 | Bombing the Reich: bombs land ahead of the sight | The motor's own row (PHY-20); a round with every part on its centre keeps its attitude (PHY-21); a round's fins | 352 racks of 66 round templates on 44 levels (FHSW, FHSWEurope) | partial: miss cut from 650-980 m to 330-730 m; the owner checks it in retail (bots fire no bomb racks, so the lab cannot) | `tests/test_round_attitude.py` | 9416daea |
| 11 | Loading screen: the pause after 100% | The load ended on its bytes; the level's build and warm-up ran under the briefing | every level of every tree | fixed | `tests/test_load_briefing_js.py` (two tests) | 114c9902 |
| new | Omaha Charlie sector: hole behind the right bunker (CoOp) | The level's CoOp layer places none of the trenches that cover its heightmap cuts (TKT-3) | 1 level | covered on the owner's request (a departure from retail); re-baked and published | `tests/test_cut_cover_modes.py`; `surveys/census_mode_cut_covers.py` | 6ca7d98d |

## 1. Operation Da 1943: the P-40 in the hangar

### The mechanic

A hull a level places on a static of its own (a ramp, a pier, a hangar floor)
rather than on the terrain. Two engine rules meet here:

- COL-6: a contact is probed along the segment from the hull's root to each
  col0 vertex, against the static's faces, single-sided; the depth is the
  vertex's distance under the face it crossed. A hull whose origin is over a
  floor and whose wheels are under it is pushed straight up out of it the
  first tick it is awake.
- Every static face is a surface a wheel's col0 vertex meets. The viewer
  approximates this with a name gate (`collision-meshes.js`
  `DRIVABLE_TOP_RE`: bridges, decks, bays, planks), which no hangar matches.

SWB-7 (2026-10-11) made the load settle leave a hull standing on a static
where the level put it (XPack2's Natter on its ramp), and 0bafde8e made that
need three of the twelve lowest vertices over the static.

### Root cause, measured

The reported hypothesis (`REST_POINTS = 3` from 0bafde8e) is refuted. A/B in a
headless page with the constant rewritten to 1: identical, because ten of the
P-40's twelve lowest vertices are over the floor either way.

The level places the P-40 sunk into the floor. `p40spawner` is at
`2751.59/117.828/2054.54` with no `spawnOffset` (the level's
`ObjectSpawnTemplates.con`). The hangar floor (`hangar1_m1`, in its collision
mesh's fifth primitive) is at 117.27, the terrain under it at 116.66. The P-40's
main wheel springs reach 2.27 m under its origin and its hull 1.22 m, so as
placed the wheels are 1.71 m into the floor and the hull 0.66 m. The settle
held it there (it stands on a static), and:

- entered, the body woke, the floor's contacts pushed the wheels out from under
  the floor and threw it over: pitch -70 degrees at 2 s, upside down (up.y
  -0.96) at 3.5 s, measured in the page with the fix routed off;
- exited after the fix's first half, it sank 0.6 m to the terrain under the
  floor, because the wheels read the ground through the name-gated deck only.

### The fix

`viewer/static-settle.js` (new), one rule for the page's settle
(`hull-bodies.js` `settleSome`) and the room server's
(`server/level-bodies.mjs` `settle`, which had no static rule at all):

- `vehicle-bodies.js` `sunkIntoAStatic` measures COL-6's depth: the segment
  from the origin to every col0 vertex against the level's statics.
- A sunk hull is lifted out by that depth. One whose wheels were in a level
  floor (within about 6 degrees) is then settled onto it, alone, on a ground
  that includes the static tops read from its lifted origin down
  (`staticFloorTerrain`). The P-40 comes to rest nose up 13.5 degrees on its
  tail wheel, origin 119.05.
- Anything else sunk is lifted and left: the Natter's sled is 0.11 to 0.17 m
  into a ramp tilted 9 degrees, and let down it rolled 7.5 m off.
- Whatever a held hull stands on is marked a ride surface at that height
  (`userData.rideSurfaceTop`); `static-index.js` and `drivable-mask.js` then
  count that static's triangles no more than 0.5 m above it as drivable, so
  its walls and roof stay walls and roof.

### Verification

| Case | Before | After |
|---|---|---|
| Operation Da P-40 at load | 117.83, wheels 1.71 m into the floor | 119.05, nose up 13.5 degrees on the floor |
| P-40 entered, 4 s, no input | flips: pitch -70 degrees, then up.y -0.96 | does not move |
| P-40 exited, 6 s | (flipped) | stays at 119.05 (0.6 m sink before the ride surface) |
| doomed_budapest Nimrod pad (1461, 120, -356), the 0bafde8e guard | 119.24 | 119.24 |
| XPack2 hellendoorn Natter / Natter_1 | 65.85 / 62.00 on the ramps | 66.02 / 62.12 on the ramps (lifted out by 0.17 / 0.11), up.y 0.979, not destroyed |
| Room server tree, Operation Da | no static under the P-40 at all (see 1b) | floor found at 117.27; P-40 residual 0 |

### Census (`tools/bf1942-models/surveys/census_hulls_on_statics.mjs`)

Every placed hull, every exported level, through the room server's own level
loader and the shared rule:

| Tree | Levels | Hulls | On a static | Placed sunk | Let down on a floor | On an unnamed static | Left sunk after the settle |
|---|---|---|---|---|---|---|---|
| bf1942 | 23 | 385 | 27 | 14 | 14 | 8 | 0 |
| xpack1 | 29 | 475 | 31 | 17 | 17 | 8 | 0 |
| xpack2 | 32 | 568 | 40 | 21 | 17 | 15 | 0 |
| fh | 10 | 251 | 22 | 11 | 7 | 20 | 0 |
| fhsw | 94 | 4,918 | 242 | 74 | 61 | 190 | 0 |
| fhsweurope | 46 | 2,306 | 164 | 51 | 37 | 142 | 0 |
| desertcombat | 35 | 733 | 33 | 10 | 10 | 16 | 0 |
| dc_final | 48 | 1,069 | 49 | 19 | 19 | 26 | 0 |
| eod | 239 | 7,596 | 503 | 142 | 138 | 344 | 6 |

"On an unnamed static": a static no `DRIVABLE_TOP_RE` name covers, where the
woken hull's wheels used to sink to the terrain. The six left sunk are EoD
Loach helicopters on helipads beside a container or a bunker (abandoned_field,
brothers_in_arms, search_and_destroy, two on urban_warfare, xa_loi_pagoda),
their hull 0.12 to 0.73 m into the neighbouring prop after the floor settle.
EoD is out of tonight's scope; recorded for when it is opened.

### Why it was missed

- The viewer had no code path for it: the static rule (SWB-7) answered "leave
  it where the level put it", which assumed a level never places a hull into a
  static. The P-40's hangar is the case it did not cover.
- No gate existed. The behaviour audit drives each vehicle, but its stepped
  frames (`__renderOnce`) do not integrate a seated plane's body at all; the
  P-40 stood still through 300 of them with the fix off, so a "does it stay put
  on entry" check there cannot see this. The gate is therefore in node, over
  the real settle.
- The room server's level loader dropped every collision primitive past the
  first (1b), so the room never had the floor at all.

### Gate

- `audit_mod.py` placement, cause `hull-sunk-in-static` (major): runs the
  census over the tree's levels and fails any hull whose hull vertices are
  still into a static after the settle. Proved: with the rule disabled it
  reports the P-40 (hull 0.66 m into `hangar1_m1`); with it, nothing.
- `tests/test_stands_on_static.py` (sunk depth, the level-floor rule, the ride
  surface floor-not-roof, the out-of-world mesh), `tests/test_hull_static_census.py`
  (Operation Da through the census).

### 1b. The room server's collision lost every primitive past the first

`server/glb-scene.mjs` `buildSceneTree` read primitive 0 of each mesh. Its own
docstring said a collision primitive past it was decoded too; the code did not.
The page's GLTFLoader makes one mesh per primitive. On Operation Da, 680 of
3,923 collision meshes have more than one primitive and 176,247 of 331,495
collision triangles were past primitive 0, among them the P-40's hangar floor.
Each later collision primitive is now a child mesh, as on the page. Guard:
`tests/test_glb_scene_primitives.py`.

### 1c. tigerpass-1943 never finished loading

FHSWEurope's own `StaticObjects.con` places an `italianhouse05_closed_m1` at
`494.8/6.4205e+020/1.84847e+022`. Its triangles stretched the collision index's
bounds to 1e22 m and its cell table to 3.6e23 entries, which threw; the page
waited at the loading screen (measured: no brief in 120 s with the guard routed
off, the collider up at once with it). `static-index.js` leaves out a mesh
placed farther than 1e6 m from the origin. Guard: `tests/test_stands_on_static.py`
`test_a_mesh_out_of_any_world_is_left_out_of_the_index`.

## 2. FHT Golf Hotel 1944: streaked buildings at distance

### The mechanic

A `.sm` ships up to six LODs, and the client does not keep them all
(mesh-lod-chains: `readLods` stops after the first LOD whose last material has
fewer than 100 vertices). Read tonight in the client (`BF1942.exe`, both
builds, objdump): the same loop stops after LOD 0 when the template's `+0x100`
is set, which LM-1 established is the `.sm` header's lightmap byte. So a
lightmapped mesh is drawn at LOD 0 at every distance. New ledger row
**LOD-6**; it also answers LM-1's open question (why the farther LODs of
vanilla's lightmapped meshes, whose lightmap UVs are all at 0, 0, never draw
black: they are never built).

### Root cause, measured

The two buildings either side of the first flag (`golf_Hotel`, the deploy
screen's default) are `O_Hotel` (`O_Hotel_m1`, FHSW's `standardmesh_001.rfa`).
The mesh is lightmapped (the level ships `ObjectLightmaps/O_Hotel_m1_*.tga`).
Its `.rs` has one subshader, `O_Hotel_m1_Material0`, texture
`texture/O_HueHouseA`, and all three LODs name it. LOD 0's UVs tile
(u -8.8 to 10.6); LOD 1 (220 vertices) and LOD 2 (593) are laid out in 0..1,
for an atlas the `.rs` never names. The exporter shipped them as rungs at
50 m and 100 m, and drawn with the tiling wall texture each face smeared a
column of texels into streaks. The picks in the page named `O_Hotel_m1_lod1`
and `O_Hotel_m1_lod2`. No texture path was wrong: the census below finds one
other rung in every tree whose texture differs from its base.

### The fix

- Exporter: `bf42/assemble.py` `retail_lod_chain(lods, lightmapped)` keeps one
  level for a lightmapped mesh. The next bake of any level ships no rungs for
  such meshes.
- Viewer: `level-statics.js` `liftLods` lifts no chain for a part that carries
  the level's lightmap (`userData.lightmap`, which the exporter gives only a
  lightmapped mesh) and hides its rungs. This fixes every published bake
  without a re-bake; the viewer deploy is the whole fix for the live site.

### Verification

Frames from 16 m over `golf_Hotel`, before and after (the two wings left and
right of the park): before, both wings draw as vertical streaks; after, their
windows and walls. Second tree, vanilla Berlin: `citymesh3_m1` from 40 m drew
its LOD 1 unlit (flat, a darker roof; its lightmap UVs are all at 0, 0, so the
viewer left it on the lit pass); now it draws LOD 0 under the level's
lightmap, as the client does. The same rule hides 623 vanilla rungs on all 23
vanilla levels.

### Census (`tools/bf1942-models/surveys/census_lod_chains.py`, 40 s)

| Tree | Levels | Parts with rungs | Lightmapped parts shipping rungs | On levels | Meshes |
|---|---|---|---|---|---|
| bf1942 | 23 | 7,462 | 623 | 23 | 46 |
| xpack1 | 29 | 8,604 | 775 | 29 | 62 |
| xpack2 | 32 | 10,723 | 900 | 32 | 91 |
| fh | 10 | 9,645 | 1,249 | 10 | 136 |
| fhsw | 94 | 177,200 | 6,385 | 67 | 289 |
| fhsweurope | 46 | 103,794 | 1,483 | 22 | 165 |
| desertcombat | 35 | 15,227 | 661 | 30 | 44 |
| dc_final | 48 | 22,523 | 1,061 | 42 | 57 |
| eod | 239 | 189,874 | 7,302 | 227 | 150 |

Rungs whose texture is none of their base mesh's: one mesh in every tree,
FHSW's `japanesefarm1_m1` (air_raid_alert_-kure-1945, naichi-1945); not
looked at tonight.

### Why it was missed

- The knowledge base was half-read: mesh-lod-chains noted on 2026-09-26 that
  byte `+0x100` "also stops the chain after LOD 0" with "where it is set is
  still unread"; LM-1 found on 2026-10-12 that it is the lightmap byte, and
  nobody joined the two. `retail_lod_chain` implemented only the vertex rule.
- No gate compared a level's rungs with what the client keeps.

### Gate

- Corpus probe `lightmapped_rungs` (`mod_pipeline.py`): counts lightmapped
  parts shipping rungs per tree and fails if any do while the viewer rule is
  missing. `tests/test_assemble.py`
  `test_a_lightmapped_mesh_keeps_lod_0_alone`, `tests/test_lift_lods.py`.

## Test suite state

The full suite at group 1's commit: 5,990 tests, one failure that is the shared
tree's and not this change's: `test_viewmodel_rigs_on_disk` for FHSW lists ten
kit items with no first-person rig (`USSoldier__SpawnradioDeploy`,
`RussianSoldier__Deploy_M-31` and eight more), left by the FHSW pipeline run that
finished during the night. It stayed the only failure at every later group's
commit (groups 3, 4 and 5: 6,081, 6,089 and 6,091 tests).

## 3. Saipan 1944: a B-29 air spawn leaves the kit's rifle over the seat

### The mechanic

A spawn point with `setEnterOnSpawn 1` seats its player (SPAWN-25..SPAWN-27):
the spawn presses Use where he stands and he takes the nearest seat with a
door in reach. FH's air spawns stack it on a held plane (FHR-10). It must look
exactly as climbing in from the ground does.

### Root cause, measured

The page spawned him (`spawning.js`), drew his weapon, then climbed in
(`vehicle-entry.js` `enterVehicle`, which holsters it). The spawn had started
the kit weapon's rig loading, and it landed about 0.8 s later. `arms-rig.js`
decided whether a landing rig shows with `optPilot && (aircraft || car)`: a
gunner's seat has no drive, so the B-29 bottom-front turret's gunner got the
kit's M1 Garand drawn over the turret's view, with the seat's HUD round it
(page screenshot). The camera and HUD were the seat's all along; climbing in
from the ground worked because the rig was already loaded.

### The fix

`hand-weapon.js` remembers a holster (`soldierKit.holstered`), publishes a
late rig hidden when it is set, and hands the word to `arms-rig.js`, whose one
`seated()` test now reads it. Verified: the rig stays hidden 0.8, 2 and 4 s
after the spawn (it was drawn from 0.8 s). The behaviour audit's new check
reports both seat spawns on FHSWEurope Saipan with the fix routed off (the
B-29 turret and `pt_boat637soldierspawn`'s front gun, a Springfield over the
seat) and none with it; FHSW's Saipan-1944: 0 of 2.

### Census (`surveys/census_seat_spawns.py`)

| Tree | Levels | Levels that seat a human | Points | Vehicle types | Bot-only points |
|---|---|---|---|---|---|
| bf1942 | 23 | 4 | 12 | 2 | 102 |
| xpack1 | 29 | 4 | 12 | 2 | 105 |
| xpack2 | 32 | 8 | 17 | 6 | 102 |
| fh | 10 | 3 | 15 | 7 | 85 |
| fhsw | 94 | 65 | 403 | 206 | 2,893 |
| fhsweurope | 46 | 39 | 367 | 146 | 1,924 |
| desertcombat | 35 | 11 | 44 | 6 | 50 |
| dc_final | 48 | 12 | 43 | 10 | 77 |
| eod | 239 | 33 | 130 | 14 | 141 |

### Why it was missed

The viewer's seated test knew only a driven seat, and no gate spawned into a
seat at all. Gate: `audit_behaviour.mjs` spawn phase, `seatSpawnPhase`
(cause `spawn.seat-shows-kit`), which spawns on each seat flag with a kit other
than the last so the rig loads after the climb in. Guard:
`tests/test_seat_spawn_rig.py`.

## 4. Ilomantsi: the SU-122's round selector snaps back

### The mechanic

FH's ammo selectors are a RotationalBundle that carries one FireArms per round
and is rolled by a key: `SU122GunSelector` rolls its HEAT and HE guns through
180 degrees on `c_PIPitch` (the arrow keys on a land hull), with the HUD needle
`Tankgun_AmmoNeedle_Rot` through 90. Both guns sit 17.5 m under the gun base
with `projectilePosition 0/17.4512/1.7` in their own frame, so the selected
gun's shell starts at the muzzle and the other's 35 m underground, in the
`BulletCatcher17,5m` the hull hangs there. A RotationalBundle that is not
`setAutomaticReset` runs a velocity servo (ledger GUN-2): the key turns it,
release leaves it.

### Root cause, measured

`vehicle-base.js` `advanceSurfaces` servoed every rig axis toward the input
itself, which is the `setAutomaticReset 1` law (a stick surface centring).
Measured on Ilomantsi: ArrowDown held, selector -180 and needle -90; released,
both back to 0 within 0.6 s.

### The fix

A RotationalBundle on a key channel (`c_PIPitch`, `c_PIRoll`, `c_PIYaw`,
`c_PIThrottle`) that is not `setAutomaticReset` now integrates its input and
stops at its bounds (`holdsAngle`, `heldBounds`). Aircraft keep the surface
servo (their key channels feed the flight laws: a latched throttle, the
stick), ships hold (their ramps). Measured after: ArrowDown, -180/-90, held
through release; ArrowUp, 0/0, held. With HE latched its muzzle is at the
barrel (y 84.8) and HEAT's 34 m under it (y 50.5), and the reverse with HEAT.
Second tree: FHSW's Hummel on Prokhorovka-1943, 180/90 on ArrowDown, held.

### Census (`surveys/census_held_axes.py`)

| Tree | Placed vehicles with a held key axis | Parts | Named selectors or needles | Levels |
|---|---|---|---|---|
| fhsweurope | 171 | 762 | 531 | 35 |
| fhsw | 318 | 1,449 | 963 | 81 |
| fh | 1 (the GMC's ramp) | 1 | 0 | 2 |
| xpack1 | 2 (an LCVP's ramp, the M3GMC's steering) | 2 | 0 | 4 |
| desertcombat, dc_final | 4 each (aircraft airbrakes and exhaust racks, left on the surface servo) | 27 | 0 | 7, 8 |

The 76mm SPAA's selector is on `c_PIThrottle` (W/S), the owner's "W/S or
up/down".

### Why it was missed

No code path: the viewer had one servo law for every rig axis. No gate drove
a selector. Gate: `audit_behaviour.mjs` `checkHeldAxes` (cause
`veh.selector-springs-back`), proved both ways on Ilomantsi's SU-122. Guard:
`tests/test_held_axis.py`.

## 5. Bombing the Reich: the B-40's gunner sights

### The mechanic

FHSW's aircraft gunners see their sight as a mesh: under each gun a LodObject
whose `DistanceSelector` (`1p_AirReflexSight_Flex1_Selector`, 0.3 to 0.5 m)
draws a blended reticle pane (`1p_AirSight_N-9_m1` and its kin, texture
`texture/N-9`) when the eye is within reach (LOD-1, LOD-3). Each seat hangs
its sight twice, at the Camera and at the Camera plus `OutsideHudOffset`, so
both inside views carry one. Research by a subagent, checked here in the page.

### Root cause, measured

Two viewer defects; the assets were extracted and live.

1. `graftCockpitInto` hung each cockpit swap on the first node of its name.
   Twins share a name all the way down, and the B-40's top and waist seats
   share `AirSight_K-3`: both copies of the belly seat's ring stacked on one
   node, and all six K-3 copies on the top turret's, so the waist gunners'
   rings hung 6.45 m from their eyes.
2. The second inside view of an aircraft is not a "first person" view, and a
   distance-selected swap answered the view before the distance; `NoseHull`
   then hid every mesh of the plane besides.

Before (page frames, belly and waist seats, both views): only the belly
gunner's first view had a ring, drawn twice; the other three views had none.

### The fix

`graftCockpitInto` matches each source to its host by the chain of names
from the root with each node's rank among same-named siblings (`namePath`),
found before anything moves; a twin's replaced stand-in is looked up under its
own host. `CockpitSwap.apply` lets a distance-selected interior answer the
eye's distance alone, in any view; `NoseHull` leaves such a sight
(`nearSight`). After: all four views draw their seat's sight once. The ring's
size and brightness were measured (the disc fills the screen height at
0.15 m; the texture's ring sits at 65% of it with alpha 0.12; ledger DL-1 says
a `lighting false` material is the texture alone, so `materialDiffuse 10` does
not brighten it): matching it to retail's "large" sight needs a capture.

Control: FHSW Saipan's B-29 turrets draw their sights before and after
(unaffected). An FHSW case could not be seated tonight: El Alamein's
Beauforts and Bombing_The_Reich's B-17Gs were not on the field at the
round's start, and entering FHSW's `B40` by a name lookup threw in
`seat-survey.js` `classifySeat` (reading `axes` of an undefined seat, most
likely a non-hull node of that name). Left open.

### Census (`surveys/census_seat_sights.py`, the subagent's; models the rule before the fix)

| Tree | Vehicles with a gunner-seat sight | Seats | Copies on the wrong node | Missing in the cockpit view | Missing in the second view | Vehicles affected |
|---|---|---|---|---|---|---|
| fhsweurope | 86 (31 levels) | 139 | 65 seats | 31 | 67 | 30 |
| fhsw | 129 (71 levels) | 199 | 87 seats | 47 | 90 | 44 |
| bf1942, xpack1, xpack2 | 0 | | | | | 0 |

Unexported levels, count only: FHSWEurope 133 levels place 153 sight
vehicles (56 affected), FHSW 32 levels place 73 (14).

### Why it was missed

The graft's name match assumed a name is unique under a vehicle, and the
nose view's rule was inferred (`NoseHull`'s own comment). No gate looked
through a gunner's eye. Guard: `tests/test_twin_sights.py` (a B-40-shaped
tree through the real graft, swap and hull hide), `tests/test_gun_sight.py`
updated for LOD-3.

## 6. Bombing the Reich: the bombers' minimap symbol

### The mechanic

Each FHSW bomber's bundle adds an `Attitude_indicator_<nation>_Bundle`: a
held spawner 10 m up spawns `Attitude_indicator_BASE_<side>` (no symbol), which
holds `Attitude_indicator_A_<side>` (`Minimap/Attitude_indicator_A_256x256`, a
cross and a needle, `setMinimapIconSize 256`), which holds
`Attitude_indicator_B` 100 m further up the plane's own up axis (the horizon
ball). Each is an object of its own (AI-121), so each is a map mark, shown to
its spawner's side, sliding with the plane's bank and pitch. Research by a
subagent.

### Root cause, measured

The bake keeps the held objects nested inside their plane, and the map drew
only the roots of the `spawners` group: the indicator never drew, and the
player's own bomber was the ring alone. Two more: every icon was drawn at its
picture's width, not its declared size (a 512 px picture declared 256; FH's
64 px carrier sprites declared 32); and `extract_hud_pack.py` read no
`include`, so 35 FHSWEurope templates (77 placed vehicles on 19 levels; FHSW
52 templates, 108 on 34) whose symbol is set in a `.inc` drew a grey dot. The
held objects also counted as seats of their plane: the B-29's seat keys walked
through `Attitude_indicator_BASE_ALLIED`, `_A_ALLIED`, `_B` and
`AlliedAirSpawnSelfReloaderObj`.

### The fix

- `map-friendlies.js` `mapVehicleMarks` adds each hull's held objects that
  have a symbol, with their spawner's team, even on the player's own hull;
  `map-sprites.js` `drawSprite` takes the declared size.
- `extract_hud_pack.py` `objects_con_texts` splices includes
  (`extract_models._inline_includes`); the pipeline's `hud` step re-ran for
  FHSWEurope and FHSW (4,774 to 5,382 and 4,560 to 5,168 templates with a
  symbol; the Bf109-G10 now `minimap_icon_plane_16x16`).
- `seat-survey.js` `surveyVehicle` leaves a held object out of its host's
  seats: the B-29's cycle is now the pilot and its four turrets.

Verified: the full map on Bombing the Reich, once the lazily loaded sprites
land, draws the attitude cross over the airfield's bombers (frame). Guards:
`tests/test_held_map_marks.py`, `tests/test_hud_icons_from_includes.py`.

### Census (`surveys/census_minimap_icons.py`, the subagent's; models the rule before the fix)

| Tree | Held symbols not drawn (attitude indicators) | Placed, a dot for want of `.inc` | Drawn at the wrong size | Mod art drawn right |
|---|---|---|---|---|
| fhsweurope | 230 (84 on 16 levels) | 77 (35 templates, 19 levels) | 389 | 3,134 |
| fhsw | 421 (130 on 24 levels) | 108 (52, 34) | 482 | 5,220 |
| xpack2 | 0 | 0 | 22 | 69 |
| bf1942, xpack1 | 0 | 0 | 20 each | 0 |

What retail does with an empty `setMinimapIcon ""` (FHSW 1,687, FHSWEurope
890 placed objects drawn as dots) is not in the ledger; left as is.

## 7. Biak: the Catfish seaplanes take water damage and despawn

**Mechanic.** Two things.

- **Floating.** An aircraft that carries `FloatingBundle`s rides the sea on
  them by the ship's float law (PHY-3, `body-float.js`).
- **Wetting (ledger HP-21, read from the server binary and checked against
  retail).** A hull's Armor is wet when a mobile part's lowest col0 vertex is
  under the sea, or its origin is.
  - A part whose template leaves `hasMobilePhysics` clear gets a
    `StaticResponsePhysics`, whose `checkVsTerrain` (`0x0825f1b0`) is an empty
    function, so it never meets the sea.
  - A driven hull is tested on its root alone.

### Root cause, measured

- **Parked.** `world-damage.js` `inWaterOwners` called a hull wet when any
  part touched the sea. The Catfish's pontoon `Catfish_floater_m1`
  (`hasMobilePhysics 0`) rides 0.6 to 0.9 m in the water, at the floats'
  equilibrium, which is where the level puts the plane. So the viewer billed
  it `hpLostWhileDamageFromWater`, 10 HP a second, and it died on its pad.
- **Flown.** `Aircraft.bodyForces` was empty, so nothing floated an
  aircraft. Taxied onto the water, the Catfish sank to the sea bed.

### Retail, measured

The lab's server recorder ran two bots-only Biak CoOp rounds
(`lab/scenarios/fhsweurope-battle_of_biak-coop-rec.json`). Both parked
Catfish held 170 of 170 HP for 539 s and for 1,034 s. Their hulls sat 0.5 m
clear of the water, and their pontoons were under it. No bot boarded one.

### The fix, and how it got there

1. **6aef47c1** wet a hull by its root part alone. The outcome was right, but
   the rule was invented.
2. **f969b8f0** reverted it to "any part", on a first binary reading. The lab
   then contradicted that reading.
3. **The second reading found the static handler** (HP-21 records it). The
   viewer now applies it:
   - `vehicle-bodies.js` `partIsMobile` reads a per-template `mobility` table.
     It comes from `_shared/part-mobility.json` (`extract_part_mobility.py`,
     about 15 s a tree, all nine published) or from `collision-meshes.json`'s
     `mobility`, which the `collision` step now writes too. The root is judged
     by its own PHY-17 stamp, because it tests the mesh it borrows from its
     LOD under its own response physics.
   - `body-world.js` `touchesWater` skips static parts and tests a driven hull
     on its root alone, as does `#drivenTerrainDamage`'s water half.
   - A template the table does not name reads as mobile. That covers the
     level-own templates, which the chain-only pass does not read.

Verified on Biak: parked, both Catfish hold 170 HP. Entered, the Catfish runs
up on the water and climbs off it to 109 m (6aef47c1's float law).

**Not built.** A static part's terrain contact, which is also empty in the
engine, still runs in the viewer's body world.

### Census (`surveys/census_seaplanes.py`)

| Tree | Seaplanes placed | Levels |
|---|---|---|
| fhsw | 136 | 25 of 94 |
| fhsweurope | 115 | 16 of 46 |
| eod | 22 (the CH-47's floats) | 21 of 239 |
| the rest | 0 | |

### Why it was missed

The float law was written for `Ship`, and nothing gave it to an aircraft. No
gate parked a plane on water, and which parts may meet the sea was never
read. Guards:

- `tests/test_seaplane_water.py`: a static pontoon leaves the hull dry, a
  mobile part wets it, and a driven hull is tested on its root;
- `tests/test_part_mobility.py`;
- corpus `seaplane-floats`.

## 8. Biak: the PT Elco boats cannot be driven; their torpedoes burst at the bow

**Mechanic.** A ship grounds where her col0 vertices meet the bed
(`ResponsePhysics::checkVsTerrain`, the `ship.js` header). Her torpedo runs
6.58 m deep (FLOAT-1).

### Root cause, measured

`ship.js` sampled the bed over a grid on the collision BOX's bottom face, flat
at the box's lowest point. FHSWEurope's `PT_Boat636` (`pt_hull_m1`) has:

- a box 1.506 m deep from end to end;
- a col0 underside 1.35 m deep a third of the way back from the bow;
- a col0 underside 0.72 m deep at the stern.

The four PT boats in Biak's dock float at 64.66 over a bed that shoals from
62.74 under the bow to 63.36 to 64.18 under the stern. The water is at 65.
The box put each stern on the bed: `aground` true, forward throttle at
`revs` 0.68 for 6 s gave speed 0.

The torpedo is not a defect of its own. In 2 m of water its 6.58 m running
depth puts it into the bed at the muzzle. Measured: placed in deep water
(`__placeShip`), the same boat made 20 m/s and its torpedo ran per FLOAT-1.

### The fix

- `ship.js` `undersideSamples`: the footprint is every col0 vertex. That is
  the engine's rule, read in full on 2026-10-15: `checkVsTerrain` tests each
  vertex against the bed, one `impulseOn` per vertex under it. The first
  version (65873e44) also sampled grid columns on the col0 faces. The engine
  makes no such densification, and 56a213c2 removed it.
- For a col0 of more than ten vertices, the jump at `0x0825b04f` the file
  called an unread separate arm is a bow-and-stern box pre-test. It skips the
  terrain test while both ends stand R over the bed (`clearOfTheBed`) and
  then rejoins the loop. Every hull writes `underWater`.
- `Ship.useHullUnderside` installs the footprint, and `hull-bodies.js` calls
  it with the hull parts' layer-0 col0 in the body frame
  (`hullCollisionLayers`) when a sea hull is taken.
- A hull without a col0 sidecar keeps the box.

After:

- Biak PT boat: from the dock, 1.5, 9.0, 14.8, 17.8, 19.3 and 19.9 m/s over
  6 s, never aground, and astern works.
- Guadalcanal Fletcher: 11.1 m/s after 10 s, not aground.
- Midway Yamato: 12.0 m/s, not aground.

Both are as before.

### Census (`surveys/census_ship_undersides.py`)

The census lists driven sea hulls whose col0 underside lies more than 0.3 m
above the box keel on average. Each is a hull the box made deeper than her
own hull wherever she met a shoal.

| Tree | Hull types | Placements | Affected types | Affected placements | Levels |
|---|---|---|---|---|---|
| bf1942 | 14 | 129 | 11 | 82 | 8 |
| xpack1 | 15 | 140 | 12 | 93 | 11 |
| xpack2 | 15 | 141 | 11 | 90 | 9 |
| fh | 18 | 42 | 16 | 35 | 4 |
| fhsw | 177 | 812 | 140 | 435 | 37 |
| fhsweurope | 133 | 734 | 97 | 402 | 30 |
| desertcombat | 16 | 93 | 13 | 33 | 7 |
| dc_final | 21 | 127 | 15 | 33 | 9 |
| eod | 26 | 743 | 17 | 535 | 75 |

The big hulls' col0 has no flat bottom. The Enterprise, the Yamato and the
Hatsuzuki are a keel line of vertices, steep sides, and the deck's overhang
above. Their mean "overdraft" is several metres, because the lowest face over
a mid-beam column is the overhang. Such a hull now grounds on her keel
vertices alone, which is the engine's rule. Vanilla's carriers cannot be
driven, so this reaches only the destroyers, submarines and landing craft
that can.

The "more than 10 vertices" question is closed (see above): every hull runs
the vertex loop.

### Why it was missed

The box footprint was written for the vanilla capital ships, whose box bottom
is their keel. No test placed a hull whose box is deeper than its hull over
a shoal. Guard: `tests/test_ship_underside.py`. Corpus `ship-col0-underside`.

## Added during the night: Omaha Charlie sector, the hole behind the right bunker

**Mechanic.** The level's own CoOp script places no trenches (TKT-3: the
host runs the level's root `<mode>.con`). FHSWEurope cuts the heightmap
42 m down, to 0.0 m, in rectangles inland of the bunkers. Only the SW trench
pieces cover the cuts: 161 placements, all at y = 40, with
`sw_trench_ceil_wide_m1` caps.
`Conquest/AdditionalStaticObjects.con` places them. `Coop.con` runs
`Singleplayer/AdditionalStaticObjects` instead, which places smoke, wire, a
sandbag and a tank obstacle, and no trenches. Both calls sit outside
`if v_arg1 == host`, so clients run them too.

**Root cause.** It is not a viewer defect. The bake has every trench (all
1,835 archive placements match a glb node within 5 cm). The exporter tags
them `modes: ["Conquest"]`, and `pruneToMode` drops them in CoOp, as the
engine does with this data.

Measured over the 154 cut samples behind the bunker, counting drawn meshes
only:

- **Conquest:** 151 covered. The other three sit 3 cm outside the trench
  ends, under their walls.
- **CoOp:** 145 open. That is the reported hole.

Research by a subagent.

**Census (`surveys/census_mode_cut_covers.py`).** The census looks for mode
statics seated in a heightmap cut that a layer the level runs leaves open:

| Tree | Levels with mode statics | Affected |
|---|---|---|
| fhsweurope | 13 of 46 | 1: omaha_charlie-sector-1944, CoOp, 640 open cut samples (about 10,240 m²) |
| fhsw | 4 of 94 | 0 |
| bf1942, xpack1 | 0 | 0 |
| xpack2 | 4 of 32 | 0 |

**Status.** Covered, as a deliberate departure from retail on the owner's
request (2026-10-15). `extract_map.py` `cut_cover_modes` widens a
mode-tagged static seated in a heightmap cut to every layer of the level
where no static of that layer covers the same cut. A cut is a sample at
least 2 m under the static's origin and 5 m under the rim within 64 m, with
the origin no more than 2 m over that rim. Each case is recorded as
`scene.json` `objects.modeStatics.cutCovers`.

- Omaha re-baked: 164 statics widened and 703 trench nodes in CoOp. A CoOp
  frame from behind the east bunker shows the pits capped, and the census
  finds no open cut.
- Published: the `scene.glb`, `.glb.gz` and `scene.json`, live hashes
  matched.
- Commit 6ca7d98d; guard `tests/test_cut_cover_modes.py`.
- No other exported level has an open cut (the census), so no other level
  changes when re-baked.

**Why it was not caught.** It is parity. The gate that would catch the mod's
own hole is the census.

## 9. Bombing the Reich: the A-26 and the Mosquito rearm anywhere

**Mechanic.** A held object that burns itself down.

- **The object.** FHSW's bombers carry `AlliedAirSpawnSelfReloaderSpawner`
  (Axis: `AxisAirSpawnSelfReloaderSpawner`), which holds
  `AlliedAirSpawnSelfReloaderObj` and its 20 m ammo depot, rows 5 to 10.
- **Its Armor.** The object has 200 hit points against `criticalDamage 201`,
  with `hpLostWhileCriticalDamage 100`. An Armor at or under its own threshold
  bleeds from its first second (HP-17, the "scripted burn-downs"), so it is
  destroyed at 2 s.
- **The depot.** A destroyed Armor stops the depot under it (`SupplyDepot::
  update` returns at `0x083241c9`) and drops the hold (AI-121).
- **The spawner.** It makes the next object after its delay (SPAWN-24).
  Bombing the Reich's own copy of the template says 45 s; the mod's says 120.

So retail reloads a bomber in one pulse of about 2 s every 47 s, wherever it
is. The level's fixed `AlliedAirplaneSupplyDepot`s (137 of them, 20 m) and
the hangars' repair points rearm it at any time.

### Root cause, measured

`level-load.js` `collectSupplyDepots` hung the reloader's depot on the bomber
for as long as the bomber lived. The test: take the A-26 up 2.5 km from the
Allied field, with no ammo depot within 300 m, and drop the Norden rack (8
bombs). Before the fix the rack read 8 again within 5 s.

The bake carries everything the rule needs: the held object's `armor` and its
spawner's `minSpawnDelay` / `maxSpawnDelay`.

The bomb racks are not the cause. Every one says `numOfMag 1` (no spares).
The engine's default for a FireArms without the word is 3, not unlimited:
`FireArmsTemplate` constructor `0x0828d4e0` writes `+0x234` = 3, and
`makeScript` `0x0828e3b0` prints `+0x234` as `numOfMag`. `fire-state.js`
reads an absent word as unlimited, and that is recorded below as an
unreported finding.

### The fix

- `supply.js` `heldObjectLife(armor)`: `ceil(hitpoints / rate)` for an Armor
  authored at or under its threshold, else Infinity.
- `level-load.js` gives a depot inside such a held object a life and a gap,
  the spawner's delay (`calcSpawnDelay` draws in `[min, max]`; the mean
  stands in).
- `SupplyField.update` serves the depot only while the object lives, and
  restarts the clock when the carrier respawns.

The burn-down depots now live:

| Depot | Alive (s) | Gone (s) |
|---|---|---|
| The bombers' reloaders | 2 | 45 or 120 |
| The towed guns' repair dummies | 3 | 1 |
|  | 8 | 9,999 (once) |
| The flak's ammo objects | 15 | 2 |
| The ship counters' jump-start depots | 15 | 30 |

`BomberSelfRepairer` (199 against 200) does not burn down, and its 1,500 m
repair aura stays.

Verified on Bombing the Reich: the A-26, emptied 2.5 km out, stayed empty
for 17 s and then refilled once, at its reloader's next life.

**The Mosquito.** Not reproduced. `Mosquito_B_MkIV` carries no reloader. Its
rack (`numOfMag 1`) stayed empty for 40 s, 2.5 km out, both before and after
the fix. Two things rearm it:

- the level's fixed depots: the 20 m plane depots, and the hangar's
  `AirplaneRepairpoint`, which reaches 500 m with an ammo row;
- any A-26 or Lancaster flying within 20 m during that bomber's reloader
  pulse.

Owner question 4.

### Census (`surveys/census_held_depots.py`)

| Tree | Burn-down depot templates | Placed | Levels | Of them, the air-spawn reloaders |
|---|---|---|---|---|
| fhsw | 74 | 479 | 52 | 114 (65 Allied, 49 Axis) |
| fhsweurope | 49 | 198 | 28 | 30 |
| every other tree | 0 | | | |

### Why it was missed

The depot code knew one held-object rule: wait out `SpawnDelayAtStart`, for
FHSW's ObjectiveMode killers. Nothing read the held object's own Armor.
Guards:

- `tests/test_supply.py`: `test_a_held_object_authored_critical_lives_its_bleed_out`
  and `test_a_burn_down_depot_works_in_pulses_and_restarts_with_its_carrier`;
- corpus `held-depot-burn-down`.

## 10. Bombing the Reich: bombs land ahead of the sight

**Mechanic.** FHSW's Norden bombs are rounds with a motor and a fin.

- `NordenBomb_Engine` is a `c_ETRocket` with torque 20, differential 20 and
  `noPropellerEffectAtSpeed 350`, at `setRotation 0/30/0`.
- `NordenBomb_wing` has `flapLift 1`, at `setRotation 0/60/0`.
- Both sit at `0/0/0`.

PHY-20 pushes along the Engine's own row 2. PHY-21 gives a push a moment only
through its arm. With both parts on the centre of mass, nothing turns the
bomb, and it keeps its launch attitude. Its fin then lifts by the wing law
(physics.md §4).

The `.con` pitch convention is nose-down positive.
`A26_BombSight_Bundle`'s `0/-30/0` bakes as nose-up and its child's `0/90/0`
as nose-down. So the motor pushes 30° under the bomb's nose, and the fin's
plane lies 60° under the horizon.

### Measured first (A-26 at 100 m/s, level, released over the map's centre)

The sight line runs from the live camera's eye through the reticle
(`BombSight_Standard`), 72° under the horizon. The reticle bundle's own axis
is 60°.

| Altitude | Sight on the ground | Impact before | Miss before | Impact after | Miss after |
|---|---|---|---|---|---|
| 300 m | 99 m ahead | 753 m | 654 m | 430 m | 331 m |
| 600 m | 196 m | 1,142 m | 946 m | 638 m | 442 m |
| 1,000 m | 325 m | 1,302 m | 977 m | 1,058 m | 733 m |

Before the fix the viewer pushed the motor along the flight path and held the
bomb's nose on it ("the fins weathervane", `rocket-flight` open item 2). The
bomb's horizontal speed grew from 98 to 158 m/s.

### The fix (partial)

- `projectile-flight.js` `motorAxis` turns the push by the Engine's pitch
  (`rocket-flight` open item 10, now honoured).
- A full-body round whose every Engine and Wing sits on its centre of mass
  (`rocket-motor.js` `partsOnCentre`) keeps its launch attitude and is drawn
  in it.
- Its fins push by the aircraft's law (`wingPush`: `calculateLift`, a medium
  of `1 - y/1000`, 10 under water, a ±200 clamp).
- Only FHSW's Norden bombs, its container bombs and the lantern are such
  rounds. No vanilla, XPack, DC, FH or EoD round qualifies.

The miss is cut by a quarter to a half, but it is still 330 to 730 m. Each
change is ledger-grounded, and none is tuned to the sight.

**Open.** What is left is unread:

- **The launch attitude.** The rack and its muzzles carry no rotation, and
  the engine may pitch the round at spawn.
- **Inherited angular velocity.**
- **The wing's ceiling.** It is 1,000 m, so at the heights bombers fly the
  fin does nothing and the motor's 30° line rules.
- **The sight.** Whether retail's sight view uses the same eye.

The owner is checking it in the real game (2026-10-15). A bots-only lab
round cannot capture a drop, because the AI fires the bombers' guns and never
their racks. A drop flown by a human with the server recorder on would give
the release pose, the round's 30 Hz track and the impact
(`lab/scenarios/fhsweurope-bombing_the_reich-coop-rec.json`).

### Census (`surveys/census_round_attitude.py`)

| Tree | Racks of held-attitude rounds | Round templates | Levels | Racks of tilted-motor rounds | Levels |
|---|---|---|---|---|---|
| fhsw | 190 | 66 | 27 | 338 | 53 |
| fhsweurope | 162 | 66 | 17 | 250 | 28 |
| every other tree | 0 | | | 0 | |

A tilted motor on a round whose parts do not all sit on its centre is turned
off the flight path instead (`motorAxis`'s path frame).

### Why it was missed

`rocket-flight` recorded the tilt as an open item and judged it "no worse".
Nothing compared a bomb's impact with its sight. Guards:

- `tests/test_round_attitude.py`: the round's wing law equals the aircraft's;
  only parts-on-centre rounds are held; the motor axis is 30° under the nose;
- corpus `round-held-attitude`.

## 11. The loading screen: the pause after 100%

**Mechanic.** This is the viewer's own load sequence, not the engine's. In
retail the `mp_briefing` screen follows the loading screen
(`features/briefing-screen`). The ledger is silent on when retail takes its
loading picture down relative to its own level build, so the fix rests on the
owner's request: keep the picture up until the briefing is ready.

### Measured first (`tools/bf1942-models` page, warm HTTP cache, one headless Chromium)

An init script logged the overlay's state and bar, the main thread's long
tasks and frame gaps, and the page's own warm-up timings (`__warmup`). Times
are milliseconds from navigation.

| Bombing the Reich, before | t |
|---|---|
| bar 88% (bytes in) | 1,769 |
| texture queue drains, `end()` called, bar 100%, briefing state | 6,006 |
| main thread blocked (long task), briefing frozen | 6,499 to 7,580 |
| `worldReady` (the level's tail: statics, collider, bindings) | 7,576 |
| warm-up (program links, texture uploads) resolved | 8,916 |

The texture queue can drain before the level's own tail runs. Its path
(`texReport`) called `load.end()`, and the briefing went up over 1.5 s of
level build and 1.3 s of program links. The briefing's plate, faces and flags
started loading only on that first paint. That is the reported pause: a
briefing screen, empty or frozen, for 2 to 3 s on this machine. Longer on a
cold cache or a slower GPU: the warm-up's own notes record one 8 to 9.5 s
link on an Iris Xe.

### The fix

- **`progress.js`.** `handle.hold(promise, { step })` keeps the loading
  picture up until the promise settles, and keeps its step open, so the bar
  shows what is left instead of waiting full. `end()` also waits for the
  briefing module's `ready()`. A 30 s cap releases a hold that never
  settles. `end()` now settles once per load: a second path's call after
  READY had raised the briefing again.
- **`briefing-screen.js`.** `ready()` resolves when the faces, plate, knapp
  and both flags are in. The assets load once, from the first `paint`, which
  comes when the level's briefing data arrives.
- **`level-load.js`.** A `world` step (weight 6, "preparing the level") is
  held on `warmups.level`, which settles after `worldReady` and the warm-up.

| After | Bombing the Reich | Wake (vanilla) |
|---|---|---|
| bar at the last byte | 89% at 5,362 | 84% at 1,906 |
| main-thread block | 5,366 to 6,300, under the loading picture | none over 300 ms |
| warm-up resolved | 7,528 | 2,298 |
| bar 100%, briefing state | 7,533 | 2,305 |
| long tasks after the briefing | none | none |
| READY to done | 173 | 82 |

### Census

Every level of every tree loads through this path. The bar's held step and
the briefing gate apply to all of them. The models page's corner overlay has
no briefing and ignores holds.

### Why it was missed

The load's last step was "the bytes are in". Nothing measured the time
from the full bar to the first briefing frame. The briefing's art was lazy by
design, to keep the load light. Guard: `tests/test_load_briefing_js.py`
covers a held step, the briefing's art, the second `end()` and `end()`
settling once.

## Added 2026-10-15: the Garand's spread, prone or crouched

**Reported.** The Garand scatters even prone or crouched, where retail shows
a pin-point cross.

**The data** is `M1Garand`, FHSW's `M1Garand.inc`, which FHSWEurope inherits:

- `setMinDev 0.35`;
- `setFireDev 5 2.25 0.12`;
- `setDevMod 1.5 1 0.9`;
- `setTurnDev 5 0.4 0.4 0.4`;
- `setCrossHairType CHTCrossHair`, `fireInCameraDof 1`;
- `setRecoilForceUp CRD_UNIFORM/1.0/2.0`, `setGoBackOnRecoil 0`.

**The viewer, measured on FHSWEurope Alpenfestung (US assault kit).**

- At rest the cone is 0.35 hundredths of a radian, standing and prone alike
  (DEV-2: `minDev` is not scaled by stance). The crosshair is a 2 px gap.
- A shot adds 2.25 (DEV-4: the fire raise is unscaled, its decay ÷M).
- Prone, the cone is back to 0.35 within 0.6 s.
- The round leaves from the eye (`fireInCameraDof`). It is pushed by
  `round-launch.js` `deviate`: a square of `total / 100` radians on each
  axis (DEV-9).
- On the map page the visible round itself meets the soldiers' capsules
  (`guns.bodyCast`).
- Recoil kicks the view about 1° a shot and keeps it (FA-2..FA-5,
  `goBack 0`). It moves the aim, not the cone.
- The turn channel climbs only on fast swings: DEV-10's input is about 1.0
  at 90 deg/s.

Every link matches its ledger row.

**Found and fixed.** The player hitscan against the bots
(`hand-fire.js` `resolvePlayerShotOnBots`) is used on pages whose rounds
carry no `bodyCast`. It rolled a disc of the cone read as degrees, 1.75
times DEV-9's reach, with a draw of its own apart from the visible round.
It now draws the engine's square in hundredths of a radian. Commit
c67b69c1, guard `tests/test_player_shot_cone.py`.

**Not found.** No difference on the map page. A cone of 0.35 to 2.6 (one
shot) is 0.2 to 1.5 degrees, and two fast shots reach the 5 cap, about 3
degrees. Retail runs the same law, so a spray of quick semi-automatic
shots spreads there too.

## Added during the night: Midway's deck planes below the deck

Reported with a frame: a Wildcat on the Enterprise's deck sunk to its wings.

**Mechanic.** A craft a ship's spawner holds (`holdObject 1`) is created at the
spawner's position plus its `spawnOffset`, and the hold puts it back there
every tick until its engine turns (AI-121, SPAWN-23).

**Root cause, measured.** `spawned-craft.js` held the craft at the spawner's
baked pose; its comment says `spawnOffset` is 0/0/0 on every vanilla ship
spawner, which is true. FHSW's carriers say `0/1.983/0` (F4F-4) and `0/1.94/0`
(Devastator). On FHSWEurope Midway the Wildcat's origin stood at 37.52 over a
deck at 37.55.

**Fix.** `heldLocal` adds the offset (Refractor axes, z negated) to the hold;
the room server shares the module. After: the F4F-4 at 39.50 (1.95 m over the
deck), the Devastator 39.46, the deck SBD 39.10, as the Japanese carriers'
planes (no offset, 2.1 m) already stood; before/after frame from beside the
Wildcat. FHSW's Midway is the same data. Commit 8e648729.

**Census.** Held objects with a non-zero `spawnOffset` on exported levels: FHSW
246 on 43 levels, FHSWEurope 131 on 25, DC 9 and DC Final 10 on 3 each; none in
vanilla, XPack1, XPack2, FH or EoD. A pad's `objectSpawns` row carries no
`spawnOffset` at all; whether any exported pad declares one is not counted
(the exporter keeps the word only for held spawners).

**Why missed.** A vanilla-only assumption written as a comment; no gate looked
at a held craft against its deck. Guard: `tests/test_held_spawn_offset.py`.

## Added during the night: FHSWEurope's bots slide instead of running

**Mechanic.** A soldier's legs play the lower-body state for his gait
(`Lb_RunForward`, `Lb_WalkForward`, `Lb_CrouchForward`, `Lb_Crouch`). FHSW makes
each an empty hub whose `addTransitionItem` hands over to the state copied per
weapon in hand (`Lb_RunForwardLowerNormal` ->
`3P/LowerNormal/3PRunLowerLowerNormal.baf` at 1.6, copied to
`Lb_RunForward<Weapon>` by `LowersNormalWeapons.inc`; 923 such copies, 870 on
the generic clip). Research by a subagent.

**Root cause, measured.** `extract_pose.py` read the clip from the hub alone,
so the FHSW and FHSWEurope trees' shared `poses/gaits/lower.gait.glb` held 10
clips with no run, walk, crouch-walk or crouch (87,792 bytes; vanilla's holds
14, 141,972), and `gaits.json` recorded "state machine has no Lb_RunForward
clip". `bot-visuals.js` then left the legs on `stand.lower` while the body
moved. The same bundle drives the player's third-person body, remote players
and replays.

**Fix.** `lower_state_of` resolves a hub to its `LowerNormal` copy, else to the
clip most of its copies share, in the gait export and the stance and gait
resolvers. The pipeline's `poses_shared` step re-ran for FHSWEurope and FHSW:
142,004 bytes, 14 clips. Verified: 8 bots on doomed_budapest, sampled ten
times, play `walk.lower` and `run.lower`. Commit 66993269.

**Census.** Every soldier on the 46 FHSWEurope and 94 FHSW exported levels;
FH, vanilla, the packs, DC, DC Final and EoD had all 14 clips.

**Why missed.** The extractor wrote the failure into `gaits.json`'s `errors`
and nothing read it. Gate: corpus probe `gait_clips` (a tree's leg bundle
must carry all seven gait clips). Guard: `tests/test_gaits.py`
`test_a_hub_lower_state_plays_its_lower_normal_copy`.

## Questions for the owner

Answered on 2026-10-15:

- **Item 7.** Engine questions are settled in the binary or the lab, never
  asked. HP-21 and two lab rounds did it.
- **Omaha.** Cover the pits: done.
- **Item 9.** The Mosquito rearms correctly in retail (owner rechecked).
- **Item 10.** The owner checks it in the real game. The lab cannot: its bots
  fire guns only, never a bomb rack (a 17-minute Bombing the Reich round,
  `lab/scenarios/fhsweurope-bombing_the_reich-coop-rec.json`).

Open:

1. Item 2 needs no re-bake for the live site, because the viewer hides the
   rungs everywhere. Re-baking would only drop dead bytes (the rungs of
   20,439 lightmapped parts). Wanted, and for which trees?

## Publish commands

Published 2026-10-15, each checked against live with `?cb=` and sha256:

- `models/mods/{fhsweurope,fhsw}/poses/gaits/lower.gait.glb` and `.glb.gz`
  (the bots' run and walk);
- `maps/mods/{fhsweurope,fhsw}/_shared/hud/minimap-icons.json`;
- `maps/mods/fhsweurope/omaha_charlie-sector-1944/scene.glb`, `.glb.gz` and
  `scene.json` (the CoOp cut covers);
- `maps/**/_shared/part-mobility.json` for all nine trees (HP-21's table).

Everything else is viewer code, which main's deploy carries once the branch
is merged. The new code reads all of these, and the old viewer ignores the
new files.

## Mechanics the census found that nobody has reported yet

- FHSW's bombers and air spawns carry SupplyDepots inside held objects
  (`AlliedAirSpawnSelfReloaderObj`, the attitude indicator's repair depots).
  Taken up in item 9: the reloader burns down in 2 s, so the 1 s
  `TimeToLive` never counts.
- FHSW's towed guns ride the same burn-down rule: a repair dummy that lives
  3 s in 4, and a spawn-object depot that lives 8 s once (delay 9999). The
  viewer has no towing mechanic. These depots now follow the engine's
  lifecycle (item 9), but what they do in a towed round is unread.
- `fire-state.js` reads a FireArms with no `numOfMag` as having unlimited
  spares; the engine's default is 3 (ledger FA-12). No shipped weapon with a
  magazine omits the word, so nothing changes live.
- A ship's col0 of more than 10 vertices takes an unread arm of
  `checkVsTerrain` (item 8); every PT and capital ship has one.
- FHSWEurope's El Alamein-style pads: the viewer's `__enterSeat` throws in
  `seat-survey.js` `classifySeat` when handed a node that is not a hull
  (FHSW Bombing_The_Reich's `B40` by name).

- EoD: six Loach helicopters left 0.12 to 0.73 m into a prop beside their
  helipad after the settle (levels above). EoD is parked.
- FHSW `japanesefarm1_m1`'s rungs use a texture its base does not
  (air_raid_alert_-kure-1945, naichi-1945).
