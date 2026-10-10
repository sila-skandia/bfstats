# Terrain edge wrap: what the engine draws past the heightmap (2026-10-10)

Status: built in the viewer, no re-bake. `viewer/level-edge.js` repeats the
terrain, `viewer/level-sky.js` `extendWater` and a `RepeatWrapping` depth map
repeat the sea, and `viewer/heightfield.js` (the collider) wraps the same way
(collision, below). Retail corroboration from a recording is open (below).

## What was wrong

A level ended at the edge of its heightmap: terrain and sea were cut off at
`worldSize` and beyond was the fog-coloured background. The owner, who plays
retail, said the game does not end there. On Wake (any mod) it showed from a
carrier near the west edge and from a plane flying out.

## What the engine does

Read from the client binary (and the Linux server for collision). The rows are
TERR-5..TERR-8 and WATER-1..WATER-3 in
`features/bf1942-engine-reference/ledger.md`.

| Question | Answer | Status |
|---|---|---|
| (a) Terrain outside `[0, worldSize]` | **Wrapped copies.** The visible-cell walk `0x00682ed0` covers the camera's far-plane square with the cell range unclamped, finds each cell's data by `index & (cellsPerRow - 1)`, and shifts its bounding sphere back out to where the unmasked index lies. The ground is periodic with period `worldSize` in both axes, out to the far plane (the view distance, which is also where the fog ends). Not clamped, not mirrored, not nothing | verified |
| (a) The texture those patches get | The wrapped patch's own: the cell's tile is picked from the patch table by the same masked index, so an outside patch shows the Tx tile of the in-world patch it wraps to, or the default texture where that patch has none (TERR-2) | verified for the tile, inferred for the lightmap |
| (a) How far | The camera's far plane (`0x00682f9c`..`0x00682fc8`: `far * sqrt(tan(vfov/2)^2 + tan(hfov/2)^2 + 1)` as a square, then a six-plane frustum test per cell) | verified |
| (b) The water | Not one plane: a table of 256 m tiles, `n = int(worldSize / 256)` a side (`0x00655130`), each with a 17 x 17-vertex colour block. Its draw `0x006557a0` is the terrain's walk again: far-plane square, `tile & (n - 1)`, frustum test, and the tile drawn at its **unmasked** position. So the sea past the edge is the in-world sea tiled, shallows and all | verified |
| (b) The water's colour and depth outside the world | Per-vertex, computed once per tile from the terrain height at the vertex (`0x006546e0`), so outside the world it is the wrapped tile's. A tile whose 289 samples are all above the water is skipped (`0x006545b0`) | verified (the colour pairs' layout inferred) |
| (c) Statics, vehicles, anything else | Not repeated. The object manager and its cells are separate from the terrain's, and nothing in the wrapped walk touches them. The only other consumer of the wrapped walk is the cell collector under an object's footprint (`0x00683de0`) | inferred (no recording yet) |
| (d) Collision on the client | **Wraps.** `HeightMap::getSample` (`0x0062f9f0`) is `data[((z & mask) << log2) + (x & mask)]`, and `PatchTerrain::getHeight` (`0x006807f0`) hands it unmasked ints | verified |
| (d) Collision on the server | **Wraps**, the same way: `HeightMap::getHeight(int,int)` `0x0838d660` is the same masked index, and `PatchTerrain::getHeightAndNormal` `0x083d6f10` passes it unmasked ints | verified |

The terrain material does not wrap: `PatchTerrain::getMaterial` `0x083d6800`
returns 0 outside the world (TERR-9). The water depth is the constant sea plane
minus the wrapped height (TERR-10, inferred).

The border strip matters. The index `dim` wraps to 0, so the last 4 m strip of
the world (sample `dim - 1` to sample `dim`) slopes into the first column's
height, and a hull that crosses the edge drives onto the repeated ground. The
bake draws the last row and column from the last sample (`Heightmap.height_at`
clamps); `stitch` and the collider (`wrapSeam`) both move them to sample 0. On Wake, Midway,
Guadalcanal, Truk and Coral Sea the two borders are identical (the maps are
designed so the wrap is invisible); on land levels the step across the seam is
metres (mean over the border: Berlin 9.5 m, Liberation of Caen 11 to 18 m,
Santo Croce 13 to 15 m, Kharkov 5 to 6 m, El Alamein 1 to 2 m).

## What was built

- **Terrain** (`level-edge.js`). After the collider is built, every terrain
  mesh gets a copy at `(i W, 0, k W)` for each world copy the camera's far plane
  reaches, up to a ring of two worlds. A copy is a `THREE.Mesh` that shares the
  original's geometry and material, so it costs no memory and no texture
  uploads; copies are made the first time a camera can see one. Each frame a
  copy is visited only when its square is within the far plane of the camera
  (`visibleCopies`, a pure function under test), and three's own bounding-sphere
  test drops the patches out of the frustum, the far plane included. Fog is the
  scene's, so the far end fades as it does inside the world.
- **The seam** (`stitch`). The bake's last row and column are moved to the
  wrapped sample's height (the first column's, the first row's), so a copy
  meets the original with no crack. The collider does the same to its lattice
  (`wrapSeam`), so the order of the two no longer matters.
- **Collision** (`heightfield.js`). `Heightfield.height` is periodic with period
  `worldSize` in both axes; row and column `dim` of the lattice are sample 0, so
  the last 4 m strip slopes into the first column as in the engine. The tile-snapped
  lattice (a level baked without `terrain/heightmap.png`) gets `wrapSeam` too, and
  a sample whose partner is a hole keeps the baked height. `heightInWorld` is the
  same read without the wrap (NaN outside) and is what `nav-map.js` samples, so
  the bots' search grid, their spawns and their routes stay on `[0, worldSize]`.
  `material` stays 0 outside (TERR-9). `level-terrain.js` `groundHeight`'s raycast
  fallback folds its query into the world. `surfaceHeight`, soldiers, hulls, planes,
  projectiles, `body-ground`, `ground-contact` and the replay viewer all go through
  `Heightfield.height` and so follow the engine; statics and vehicles are not
  repeated, only terrain and sea.
- **Water** (`level-sky.js`). The plane grows by the same ring of worlds, and
  its depth map is `RepeatWrapping` instead of `ClampToEdge`, so every fragment
  shades as the in-world fragment it wraps to. Only a level with a depth map
  grows: a dry level has no wet tile for the engine to repeat.

Minimap, combat area, nav and bots do not see the copies: they live in their
own group under the scene, outside the level root every one of those walks.

## Cost

Wake, 1280 x 720, headless Chromium on ANGLE over Vulkan, `renderer.info`
summed over every pass of one `__renderOnce` frame (`autoReset` off), then 60
stepped frames timed with a `gl.finish()` at the end. Workload, not fps, is the
number to trust: this laptop's power profile moves the milliseconds.

| View | Draw calls before / after | Triangles before / after | ms a frame before / after |
|---|---|---|---|
| mid-world, no copy reachable | 533 / 533 | 218,284 / 218,284 | 10.2 to 11.2 / 7.7 (same work; the laptop's profile moved) |
| 30 m from the west edge, 7 m over the sea | 9 / 27 | 16,398 / 163,854 | 1.3 to 2.3 / 1.2 to 1.5 |
| 320 m up over the west edge | 7 / 17 | 14 / 81,934 | 1.3 to 1.8 / 1.3 to 1.4 |
| 140 m up over the south-west corner | 8 / 22 | 8,206 / 122,894 | 1.2 to 1.3 / 1.5 to 1.6 |

Away from an edge the cost is zero (`visibleCopies` returns nothing and no copy
is built). At an edge it is the patches of the copy the frustum and the far
plane reach: Wake's patches are 8,192 triangles each, so the view 30 m from the
edge draws 18 more of them (147k triangles), well under a third of the 524k a
whole Wake terrain holds. A copy's meshes are made the first time the camera
can reach it and cost no geometry or texture memory.

Evidence that the horizon band is ground and sea, not void (mean RGB of a
4-row band; the void is the fog-coloured background):

| View | Row | Before | After |
|---|---|---|---|
| Wake, 7 m over the sea, west edge | 390 | 179 187 198 (void) | 92 103 110 (sea) |
| Wake, 140 m up, south-west corner | 390 | 180 187 197 (void) | 152 160 170 (sea fading into fog) |
| El Alamein, 30 m over the west edge | 650 | 183 160 122 | 109 91 63 (the east edge's hill) |
| Kbely, 40 m over the south edge (night) | 500 | 2 6 18 (void) | 50 50 28 (terrain) |
| Kursk, east edge | 500 | 79 74 65 (void) | 43 37 26 (terrain) |

Screenshots are not committed. The poses (free camera, `?mod=<mod>&map=<map>&botCount=0&shots&noaudio`,
`__camera.position`, `__look.yaw` / `.pitch`, `__renderOnce`): Wake (30, 102, -1000)
yaw -pi/2 pitch -0.04, (60, 320, -1000) yaw -pi/2 pitch -0.22 and (40, 140, -2000)
yaw -2.4 pitch -0.08; DC Final Wake the first of those; El Alamein 30 m above the
ground at (40, -700) looking west; Kursk 25 m above (1000, -500) looking east;
XPack2 Kbely_Airfield 40 m above (1000, -2030) looking -z.

## What is open

- **Retail frame.** No owner recording near an edge was checked. The binary read
  is unambiguous (verified on both binaries), so the server lab was not run.
- **The lightmap** on an outside patch is inferred to follow the wrapped patch.
- **Cell detail levels.** The engine picks a patch's detail 0..3 by distance
  (TERR-8); the viewer draws the full patch everywhere, as it does inside the
  world.
- **No bake is needed.** Nothing here is derived from data the level glb and
  `scene.json` do not carry (`level-bake-layers` has no entry to add).

## Collision check (2026-10-10, headless, ::5391)

A soldier (spawned over the wrapped ground, `__teleport` 3 m up, 90 stepped frames)
and the drawn terrain under him, raycast against the originals and the copies:
El Alamein and Kursk, 50 m and 300 m past the west, east, north and south edges
and two corners: resting height equals the drawn height to 0.000 m at 22 of 24
points; 0.18 m (Kursk 50 m NE) and 0.30 m (El Alamein 50 m SW) at two corner
points, a cell's triangle diagonal against the collider's bilinear (a gap that
exists inside the world too). A 3 m step scan of the collider against the drawn
copy from 60 m inside to 60 m outside each edge (El Alamein, Liberation of Caen):
0.000 m worst difference over 41 points a side. A Sherman placed 50 and 300 m past
the edges rests 0.81 to 0.93 m over the drawn ground everywhere, the in-world value
being 0.85 (El Alamein) and 0.84 (Caen). Driven west off Caen's edge, 18 m down
the seam step (the east edge sits 18 m above the west), it left the ground for a
moment, landed and went on across the repeated ground. A Spitfire dived 60 m up
past El Alamein's west and east edges ends within a frame's fall of the drawn
ground (crash at 2.6 m above it, or a landing at 1.03 m, the in-world landing being
1.02 m). A Daihatsu sailed 335 m off Wake's west edge floats at the water plane
(95.98 to 96.00 against 95 plus the draft). `__combatArea()`: Kursk and El Alamein
read `outsideFor` 0 inside and out, because a level without a declared area counts
every position as inside (`combat-area.js` `step`), unchanged by this build and for
the combat-area work to settle; the rectangle test and the material half
(`getMaterial` is 0 outside, never 7) read no heights.
