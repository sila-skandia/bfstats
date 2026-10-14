# FHSWEurope and FHSW play-test mechanics, 2026-10-14 night

Status: in progress. Group 1 (placement and bake) landed on branch
`fhswe-mechanics-2026-10-14`; groups 2 to 5 follow in this file as they land.

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
finished during the night.

## Questions for the owner

1. Item 2 needs no re-bake for the live site: the viewer deploy hides the rungs
   everywhere. Re-baking would only drop dead bytes (the rungs of 20,439
   lightmapped parts). Wanted, and for which trees?

## Publish commands

None needed for group 1: every fix is viewer or server code (main deploys the
viewer).

## Mechanics the census found that nobody has reported yet

- EoD: six Loach helicopters left 0.12 to 0.73 m into a prop beside their
  helipad after the settle (levels above). EoD is parked.
- FHSW `japanesefarm1_m1`'s rungs use a texture its base does not
  (air_raid_alert_-kure-1945, naichi-1945).
