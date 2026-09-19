# Collision, crashing and damage — Refractor's data, our readers, and what the viewer needs

Research for the Corsair-on-Wake flythrough: can a plane hit terrain, buildings
and water convincingly, using real game data? Every claim below is grounded in
a file read during this survey and marked `confirmed` (read it in the data or
our code), `strong inference` (the data implies it but the final arbiter is the
executable, which was not opened), or `speculative`.

Headline: **real collision hulls exist for essentially everything on Wake and
our toolchain already parses and can already export them.** The map exporter
currently switches them off; flipping one flag re-extracts Wake with hulls.
The damage side is equally concrete: the collision damage tables in `Game.rfa`
say exactly what a plane takes from sand, water, a bunker wall and a palm
trunk, and the Corsair's own `.con` declares the full smoke -> fire ->
explosion -> wreck chain.

> **Read from the executable, 2026-09-19.** Everything this document marks
> `strong inference` because "the final arbiter is the executable, which was
> not opened" has now been read, in
> [collision-response.md](../bf1942-engine-reference/subsystems/collision-response.md) (research round:
> [`features/vehicle-collision-physics/`](../vehicle-collision-physics/README.md)).
> The data side below stands. What changes:
>
> - **Which layer the engine uses** (section 1): a body's collision *vertices*
>   always come from layer 0; the *faces* it is tested against are layer 1 when
>   the vertex side is small (root bounding radius < 4.0 m), a soldier or a
>   projectile, and layer 0 otherwise. Against terrain, a part's layer-0
>   vertices are dropped on the heightfield. There is no third layer in any mod.
> - **The speed and angle multiplier** (section 3) is not a curve to guess:
>   terrain `damage = cos^3 x speedMod x v^2 x damageMod(att, def) x
>   materialDamage(att)`; object against object the same with
>   `angleMod + (1 - angleMod) sin(cos x pi/2)` in place of `cos^3`, times the
>   attacker's `damageMod`. Applied only above 1.0.
> - **It does not saturate "within a frame or two of sustained contact"**: one
>   Armor takes collision damage from one other object - or from the terrain -
>   **once per second**. It does not need to saturate: a Corsair-class plane
>   (speedMod 2) nosing in at 40 m/s and 30 degrees takes 120 on a material-60
>   vertex and 1,200 on a 61/63 vertex from a single event.
> - Both sides of a contact bring their own material: the vertex side the u16
>   stored on the collision **vertex** (which `stdmesh.py` currently reads as a
>   float and drops), the face side the face's.
> - `bf42/damage.py`'s 5,165 modifier pairs is 12 too many: it handles `rem`
>   lines but not `beginRem`/`endRem` blocks (18 phantom cells, e.g. (227,90))
>   and ignores `MaterialManager.setCell` (6 missing). The engine loads 5,153.
>   None of the collision cells quoted below is affected. Two more rules the
>   port needs: the table is keyed by the materials' att/def **group** (equal to
>   the id except for 120 and 166), and an absent cell is 0 damage while a cell
>   created only to carry an effect starts at 1.0.

---

## 1. Collision geometry

### Where it lives: inside the `.sm`, before the LOD chain

A StandardMesh file carries its collision meshes as dedicated *collision
layers* in the same file as the render LODs — not separate `_col` files, not
extra LODs. From the format description at the top of
[`bf42/stdmesh.py`](../../tools/bf1942-models/bf42/stdmesh.py) (lines 11–19):

```
u32   colCount
  per collision layer:
    u32 blockSize
    u32 unknown[2]
    u32 vertexCount
      per vertex: f32 position[3], f32 unknown
    u32 faceCount
      per face: i16 vertex[3], u8 defensiveMaterial, u8 flags
    remaining acceleration data up to blockSize
u32   lodCount             1 for a simple part, 6 for a full LOD chain
```

Each collision face carries a **defensive material id** — that byte is the
whole damage-model hookup (section 3). `confirmed`

### Our reader already surfaces them — completely

`stdmesh.parse()` returns `StandardMesh.collision_layers`, a list of
`CollisionLayer(vertices, vertex_unknown, faces)` where each `CollisionFace`
holds `(vertices, material_id, flags)`
([`stdmesh.py:117–152, 211–261`](../../tools/bf1942-models/bf42/stdmesh.py#L211)).
Nothing about collision is skipped or lossy. `confirmed`

The assembler can already *export* them to glTF:
[`assemble.py:404–464`](../../tools/bf1942-models/bf42/assemble.py#L404)
(`_collision_mesh_indices`) picks the last layer with non-degenerate faces,
splits it into one primitive per defensive material with extras
`{"collision": true, "defenseMaterial": id, "collisionFlags": [...]}`, and
[`assemble.py:1270–1282`](../../tools/bf1942-models/bf42/assemble.py#L1270)
hangs a node named `"<template> collision <layer>"` with extras
`{collision, collisionLayer, collisionRole, sourceTemplate, sourceGeometry}`
under the part. The model browser's "show armour regions" toggle
([`viewer/index.html:1625`](../../tools/bf1942-models/viewer/index.html#L1625))
renders exactly these, so the pipeline is proven end to end. `confirmed`

The map exporter deliberately turns this off — the one line that keeps hulls
out of the flythrough today,
[`extract_map.py:695–698`](../../tools/bf1942-models/extract_map.py#L695):

```python
assembler = Assembler(
    meshes, textures, objects, library,
    lod=0, max_texture=args.max_texture, include_collision=False,
    lightmaps=lightmaps)
```

`viewer/maps/wake/scene.glb` accordingly contains **0** collision nodes
(verified by parsing the glb's node table). `confirmed`

### Layer semantics

Meshes carry 0–2 layers. The Corsair hull has two: layer 0 with 28 triangles
over materials {60, 61, 63}, layer 1 with 111 triangles over {60, 61, 63, 90}
(`corsair_hull_m1.sm`, parsed). Layer 0 is the coarse mesh and layer 1 the
detailed per-material one; the convention (matching BfMeshView, our format
reference) is that the coarse layer serves object-vs-object physics and the
detailed one projectile hits and per-face armour. Our assembler exports the
detailed layer (it iterates `reversed(...)` and takes the first non-empty).
Layer counts and contents `confirmed`; which layer the engine binds to which
query was `strong inference` and is now read (note at the top): vertices from
layer 0 always, faces from layer 1 for small bodies, soldiers and projectiles
and from layer 0 for large ones - so the convention quoted above is close but
not the rule.

### TreeMesh plants have hulls too — our reader currently skips them

`.tm` files embed their own collision block:
[`treemesh.py:166–184`](../../tools/bf1942-models/bf42/treemesh.py#L166)
recognises it (magic `FA C2 97 EB`, version 5, vertices of 16 bytes = 3
floats + u16 material + pad, faces of 4 u16 = 3 indices + material, then a
BSP) — and then **skips over it** (`_skip_collision`). Parsed by hand for this
survey:

| plant | collision | detail |
|---|---|---|
| `palmhigh_m1.tm` | yes | 11 verts / 15 faces, material 165, trunk 0..7.7 m |
| `pacific_palm_large_1_m1.tm` | yes | 11 / 15, material 80 (wood), trunk to 11.4 m |
| `pacific_palm_2_m1.tm` | yes | 11 / 15, material 166 |
| `jungle_plantball_m1.tm` | none (zero marker) | bushes are fly-through |
| `jungle_plant22_m1.tm` | none | ditto |

So palm trunks are real collidable prisms and bushes intentionally have no
hull — matching the game, where you clip a palm and die but fly through
scrub. Promoting `_skip_collision` to a parser is a ~20-line change with the
layout already written down in the skip code. `confirmed` (measured on the
shipped `.tm` files)

### The physics flags

From the Corsair's template
([`Objects.con`](#3-what-a-collision-does-to-the-plane), scratchpad extract,
lines 8–14): `hasMobilePhysics 1`, `hasCollisionPhysics 1`,
`hasResponsePhysics 1`. A static building sets only the latter two —
`Objects/Buildings/Common/guardtow/Objects.con` in `Objects.rfa`:

```
ObjectTemplate.create Bundle guardtow_M1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.setHasResponsePhysics 1
```

and its ladder additionally declares collision groups
(`addToCollisionGroup c_CGLadders` / `c_CGProjectiles`). Effects declare none
of the three.

- `hasMobilePhysics` — the object is a moving physics body of its own,
  integrated separately from its parent. Our own
  [`con.py:224–229`](../../tools/bf1942-models/bf42/con.py#L224) documents
  the observable consequence: parts flagged this way are separate bodies (a
  Corsair's landing gear hangs off its Engine yet does not spin with the
  propeller). `confirmed` (as far as the observable behaviour goes)
- `hasCollisionPhysics` — the object's collision layers participate in
  collision detection at all. `strong inference` from usage: everything
  solid sets it, effects and cameras do not.
- `hasResponsePhysics` — a detected collision also produces a physical
  response (impulse/stop) rather than detection only (triggers, water
  touchers). `strong inference`, same basis.

### Survey: collision availability across Wake's placed objects

Full sweep of `StaticObjects.con` (747 placements, 38 unique templates)
against the meshes each template's geometry chain resolves to
(`wake_collision_survey.py`, run for this document):

| template | count | col layers | layer tris (L0 / L1) | note |
|---|---|---|---|---|
| palmhigh_m1 | 131 | TreeMesh | trunk hull in `.tm` | see above |
| jungle_plantball_m1 | 95 | TreeMesh | none | bush, fly-through |
| tankobs_ste_m1 | 58 | 2 | 8 / 24 | tank obstacle |
| pacific_palm_large_1_m1 | 57 | TreeMesh | trunk hull in `.tm` | |
| stebarbwire_m1 | 46 | 1 | 16 | |
| jungle_plant* (6 kinds) | 128 | TreeMesh | none | bushes |
| pacific_palm_1/2/3, palmshort | 90 | TreeMesh | trunk hulls | |
| pacificfarm2_m1 | 13 | 4 | 36 / 228 | hangar-sized farm |
| sandbagi/u/l_m1 | 33 | 1–2 | 10–106 / 134–147 | |
| stebarrel1_m1, ammobox, stecrate1, mediclocker | 30 | 1 | 12–18 | |
| defgun_bunker_m1 | 6 | 2 | 20 / 122 | |
| pacificfarm1_m1 | 5 | 5 | 65 / 380 | |
| pacific_palm_4_m1 | 5 | 1 | 19 | the one StandardMesh palm |
| supplyde_m1 | 4 | 4 | 32 / 133 | |
| guardtow_m1 | 4 | 3 | 14 / 112 | |
| bunker1_m1 | 3 | 4 | 40 / 248 | |
| woodbrdg_m1 | 2 | 2 | 20 / 60 | |
| radarbun_m1, bunker2_m1, airrep1_m1 | 3 | 3–8 | up to 92 / 262 | airrep1 = the hangar |
| island1/2/3 | 3 | — | — | shoreline *sound* lines, not geometry (they are the `sounds.areas` entries in scene.json) |
| AlliedAirplaneAmmo | 8 | — | — | meshless ammo trigger |

**Every building and prop a plane could meaningfully hit ships a real
collision hull; the only "missing" ones are bushes (correctly hull-less), the
sound-line pseudo-objects, and palms whose hulls sit in the `.tm` our reader
skips.** No approximation needed. `confirmed`

The spawned vehicles have hulls as well (all collision layers, all sub-meshes
summed): Corsair 9 layers / 329 tris, Shokaku (carrier) 12 / 2455, Hatsuzuki
10 / 1378, Sherman 19 / 243, Willy 7 / 137, DefGun 4 / 72, AA_Allies 1 / 12,
LCVP 8 / 377. `confirmed`

---

## 2. Terrain collision

### What the engine has

- `Heightmap.raw`: 512 x 512 little-endian u16 samples. World size 2048 m, so
  sample spacing = `worldSize / dim` = **4 m**
  ([`level.py:667–676`](../../tools/bf1942-models/bf42/level.py#L667)).
- Height decode: `raw / 65535 * 256 * yScale` with Wake's `yScale 0.6`
  → 0..153.6 m ([`level.py:20–22, 239–243`](../../tools/bf1942-models/bf42/level.py#L239);
  the constant is validated against object `absolutePosition` Y in
  [`terrain.py`'s docstring](../../tools/bf1942-models/bf42/terrain.py)).
- `Init/Terrain.con`: `waterLevel 95.0`, `seaFloorLevel 10`, `materialSize 512`.
- `Materialmap.raw`: 512 x 512 bytes, one terrain material id per heightmap
  cell. Wake's histogram: material 11 "Wet sand" 249,019 cells (95%),
  10 "Dry sand" 5,883, 3 "Juicy grass" 5,802, 12 "Rock" 803, 13 "Sand road"
  637. These ids are exactly the attacker materials in the damage tables
  (section 3). `confirmed`

The engine collides vehicles against this heightfield analytically (there is
no terrain collision mesh anywhere in the archives — the heightmap *is* the
collider), with the per-cell material map supplying the damage material.
Heightfield-as-collider `strong inference`; the data layout `confirmed`.

### What our extraction has today

`scene.json` keeps `worldSize`, `waterLevel`, and the water block
(`water.maxDepth` 50.6 m plus `water/depth.png`, which is metres of water
above each sample — i.e. the *seabed* is recoverable underwater but land
heights are clamped to 0). The raw heights are **not** exported. The terrain
does, however, ship as geometry: 64 grid-mesh nodes in `scene.glb` tagged
`extras.kind: "terrain"` (16 textured island tiles + 48 `terrainDefault`
sea-floor patches — full coverage of the 8 x 8 patch world,
[`terrain.py` docstring](../../tools/bf1942-models/bf42/terrain.py) notes Wake
specifically), vertices exactly on the 4 m sample grid with absolute
positions. `confirmed`

### Height lookup at arbitrary (x, z) in the viewer

Coordinate note first: the exporter negates Z
([`gltf.py`](../../tools/bf1942-models/bf42/gltf.py): "positions and normals
get their Z negated"), so viewer coords are `(x, y, -z_refractor)`. The
heightmap is addressed in Refractor coords: `ix = x / 4`, `iz = -z_viewer / 4`.

Two ways to get the samples, either fine:

1. **No pipeline change** — rebuild the grid from `scene.glb` at load: walk
   nodes with `userData.kind === 'terrain'`, read each position attribute
   (they are world-space, on 4 m multiples), write `y` into a
   `Float32Array(513 * 513)` indexed by `(x/4, -z/4)`. Covers the full world
   because default patches are exported too. ~1 MB, one-time cost.
2. **Exporter change** — have `extract_map.py` copy `Heightmap.raw` (512 KB)
   next to `scene.json` and record `{dim, yScale, worldSize}`; decode in the
   viewer with the level.py formula. Cleaner, also captures maps we have not
   re-extracted with option 1's assumptions.

Then per query: clamp to grid, bilinear-interpolate the four surrounding
samples (the engine's own patches are bilinear quads split into two
triangles; for crash detection bilinear is indistinguishable). O(1), no
raycast.

**Water**: the plane collides with `y = waterLevel = 95.0` wherever
`terrainHeight < 95` — which on Wake is most of the world (the engine's water
covers the whole grid, not just textured patches;
[`extract_map.py:536–538`](../../tools/bf1942-models/extract_map.py#L536)).
The effective crash surface is `max(terrainHeight(x,z), 95.0)`, with the
water-vs-land distinction deciding the effect (splash vs dust) and the damage
material (1 = Water vs 11 = Wet sand). `confirmed` (data), surface-max
formulation ours.

---

## 3. What a collision does to the plane

### The two data sources

**Per-vehicle knobs** — the Corsair's `Objects.con`
(`Objects/Vehicles/Air/Corsair/Objects.con`, extracted copy in the scratchpad;
lines 10–34):

```
ObjectTemplate.drag 0.0652
ObjectTemplate.mass 2500
ObjectTemplate.hasCollisionPhysics 1
ObjectTemplate.hasResponsePhysics 1
ObjectTemplate.explosionRadius 8
ObjectTemplate.explosionDamage 5
ObjectTemplate.hasArmor 1
ObjectTemplate.angleMod 1
ObjectTemplate.speedMod 2
ObjectTemplate.hitpoints 100
ObjectTemplate.maxhitpoints 100
ObjectTemplate.material 60
ObjectTemplate.criticalDamage 20
ObjectTemplate.hpLostWhileCriticalDamage 1.5
ObjectTemplate.explosionForceMod 15
ObjectTemplate.hpLostWhileUpSideDown 10
ObjectTemplate.hpLostWhileDamageFromWater 10
ObjectTemplate.damageFromWater 1
```

Every flyable plane in vanilla sets `speedMod 2` / `angleMod 1` (surveyed all
`Vehicles/*/Objects.con`: planes 2/1; jeeps and light tanks 1; heavy tanks
0.75; submarines 0.05). `speedMod`/`angleMod` scale collision damage received
by impact speed and angle — the per-vehicle values are `confirmed`, and the
multiplier is now read from the executable (note at the top): `speedMod x v^2`
times an angle factor that `angleMod 1` pins at 1, which is why a glancing
scrape costs a plane as much as a head-on hit.

**The MaterialManager tables** — `Mods/bf1942/Archives/bf1942/Game.rfa`,
loaded with our own [`bf42/damage.py`](../../tools/bf1942-models/bf42/damage.py)
(158 materials, 5,165 modifier pairs from 41 scripts). Collision damage has
its own script family, `Bf1942/Game/collision_Armor/`:

```
HeavyArmor.con  LightArmor.con  NoArmor.con  ObjectiveArmor.con
PlaneArmor.con  PTRaftArmor.con  RaftArmor.con
```

The documented damage formula (from `damage.py`'s header, sourced from the
MDT Damage System tutorial): `direct = materialDamage(att) * damageMod(att, def)
* cos(angle) * distanceMod`. For collisions the same material lookup applies
with the attacker being *the surface you hit* and the defender being *the
collision face of you that hit it*, then scaled by speed/angle via
`speedMod`/`angleMod`. Formula for projectiles `confirmed`; collision variant
`strong inference` from the table structure below, which only makes sense
read that way.

### The actual numbers (queried from the loaded tables)

The Corsair's collision faces carry defensive materials **60/61/63/90**
(hull), **37** (wheels), **45** (propeller) — parsed from its `.sm` files.
Attacker materials and what they do to those faces:

| attacker | base dmg | vs hull 61/63 | vs hull 60 | vs prop 45 | vs wheels 37 | effect |
|---|---|---|---|---|---|---|
| 0 Ground (default) | 30 | x0.1 = **3** | x0.01 = 0.3 | 0.3 | **no entry = 0** | e_collision_Other |
| 1 Water | 30 | x0.1 = **3** | 0.3 | x0.5 = **15** | no entry | none |
| 9–13 ground family (frozen/sand/rock/road) | 30 | **3** | 0.3 | 0.3 | no entry | e_collision_Other |
| 12 Rock vs 61 | 30 | x0.5 = **15** | | | | |
| 80–83, 107, 113, 117, 166 wood family | 1 (107: 0) | ~**0.1** | 0–0.1 | 0.1 | no entry | e_collision_Wood |
| 84–87, 90, 193 metal family | 1 | **0.1** | 0.1 | 0.1 | no entry | e_collision_metal |
| 88, 92–93, 100, 102, 118 stone/concrete | 1 | **0.1** | 0.1 | 0.1 | no entry | e_collision_Stone |
| 236 allied tank gun (for scale) | 10 | x20 = 200 | 200 | 60 | — | e_ExplArmor |

(Wake's 28 distinct static-object face materials all fall in the
wood/metal/stone families above; the island's terrain cells are materials
11/10/3/12/13, all base 30.) `confirmed` — every row queried from the loaded
tables via `damage.py`.

Three design facts fall out:

1. **Wheels are free.** No ground or water material has any entry against
   material 37, and an undefined pair means no effect
   ([`damage.py:143–148`](../../tools/bf1942-models/bf42/damage.py#L143)).
   A gear-down touchdown does zero table damage by construction. `confirmed`
2. **Planes cannot hurt buildings.** As attacker (material 60) the plane has
   no entries against any building material — buildings on Wake are
   indestructible scenery. (60 does have 0.1-entries against soldiers,
   vehicles, and other planes — ramming works.) `confirmed`
3. **Instant explosion is not scripted; it is arithmetic.** Ground vs hull is
   3 per event and a wall is 0.1 per event *before* the engine's speed/angle
   multiplier (`speedMod 2` on every plane). At flying speed the multiplier
   turns those into the full 100 HP within a frame or two of sustained
   contact — while a slow taxi scrape really does cost a fraction of a
   hitpoint and a bounce (that is what `hasResponsePhysics` provides). So:
   proportional damage that saturates almost instantly at speed, not a
   special case. The magnitudes are `confirmed`. **Corrected 2026-09-19:** the
   multiplier is `cos^3 x speedMod x v^2`, and contact is *not* sustained
   damage - one event per second per surface - so the slow taxi scrape costs
   nothing at all below the 1.0 threshold (about 2.2 m/s square-on for a
   plane against a wall's 0.1 cell; about 0.4 to 1.3 m/s against the ground,
   whose `materialDamage` is 30) and the crash is one fatal event, not a ramp.

Also relevant post-crash: `damageFromWater 1` + `hpLostWhileDamageFromWater
10` (HP/s in water), `hpLostWhileUpSideDown 10` (HP/s inverted), and
`criticalDamage 20` + `hpLostWhileCriticalDamage 1.5` — once below 20 HP the
plane is critical and bleeds 1.5 HP/s, so a burning Corsair dies in ~13 s
even if it touches nothing else. Values `confirmed`; the "engine loses power
when critical" behaviour is game knowledge, `strong inference` here.

---

## 4. Damage states, wrecks and death effects

### What `bf42/damage.py` covers (and does not)

It replays `MaterialManagerSettings.con` and every `damage_system/*` and
`collision_Armor/*` script into `DamageTables` (materials, attGroup/defGroup,
damageMod, `setEffectTemplate`), provides `direct_damage` / `splash_damage`
with the documented formula, and joins every `Projectile` template to its
launchers (`collect_weapons`). It does **not** model armor-effect thresholds,
wreck LODs, collision physics, or anything per-vehicle — those live in the
object templates below. `confirmed`

### The HP-threshold effect chain

`ObjectTemplate.addArmorEffect <hp> <effect> <offset>` on the Corsair
(Objects.con lines 28–33):

| HP threshold | effect | what it is (read from `Objects/Effects/...`) |
|---|---|---|
| 65 | `em_CorsairDamage` + `em_PlaneDamage` | looping engine-smoke emitters; `hasOverDamage 1`, `IntensityAtSpeed 15`, sprite `e_muzs2_I`, offset places it on the cowling (`0/0.103/2.11`) |
| 20 | `e_CorsairFire` | two fire emitters + two smoke emitters, looping, 16-frame animated `e_FireEngine256` additive sprites, `fire.ssc` crackle sound |
| 0 | `e_ExplGas` | the fireball: ~50 particles of 16-frame `e_ExplAni06`, additive, size 3–3.5 m growing 2x, bundle lives 3 s, `ExplGas.ssc` boom |
| 0 | `e_ScrapMetal_Corsair` | see wreck chain below |
| -1 | `WaterWaterExplosion` | water-death splash (created in `Objects/Effects/Common/effects.con`) |

Semantics — the effect runs while armor is at/below its threshold (so smoke
from 65 down, fire from 20 down), 0 fires on destruction, -1 on destruction
in water: `strong inference` (thresholds and templates themselves
`confirmed`).

### The wreck chain — two wrecks, different jobs

**Wreck 1 — the destroyed LOD.** The vehicle's LOD selector
(Objects.con lines 55–64, 298–306):

```
ObjectTemplate.addTemplate CorsairComplex
ObjectTemplate.addTemplate CorsairSimple
ObjectTemplate.addTemplate CorsairWreck        <- geometry Wreck_Corsair1_M1
...
LodSelectorTemplate.create DistCompareSelector2 CorsairLodSelector
LodSelectorTemplate.hasDestroyedLod 1
```

When the object is destroyed the selector draws the wreck child instead of
Complex/Simple. Our assembler already understands the `wreck` configuration
([`con.py:151–163`](../../tools/bf1942-models/bf42/con.py#L151)) and the
viewer already ships `viewer/models/Corsair.wreck.glb`. `confirmed`

**Wreck 2 — the thrown body.** `e_ScrapMetal_Corsair`
(`Objects/Effects/e_scrapmetal_Corsair/Effects.con`) is the piece that makes
crashes look right: alongside three generic scrap emitters
(`Em_ScrapMetal_Plane_1/2/3`, which hurl `scrap_metal1/2/3_m1` debris meshes
upward at 5–17 m/s — `Objects/Effects/Common/effects.con`), its
`Em_ScrapMetal_Corsair` emitter's **particle template is the wreck object
itself**:

```
ObjectTemplate.create Emitter Em_ScrapMetal_Corsair
ObjectTemplate.template Wreck_Corsair2_m1
ObjectTemplate.positionalSpeedInDof CRD_UNIFORM/5/-5/0
ObjectTemplate.positionalSpeedInUp CRD_UNIFORM/1/5/0
ObjectTemplate.positionalSpeedInRight CRD_UNIFORM/5/-5/0
```

and that object (`Objects/MOVE_FILES/Wreck_Corsair2_M1/Objects.con`) is a
real physics body:

```
ObjectTemplate.create Bundle Wreck_Corsair2_M1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.setHasResponsePhysics 1
ObjectTemplate.destroyed 1
ObjectTemplate.hasMobilePhysics 1
ObjectTemplate.sinkInToLandAfterDeathSpeed 0.1
ObjectTemplate.mass 1200
ObjectTemplate.addTemplate e_ScrapMetalSmoke
ObjectTemplate.startoneffects 1
```

So the death sequence the game actually performs: fireball + sparks + smoke
(`e_ExplGas`), generic scrap tossed in an arc, and a burning wreck hull
(`Wreck_Corsair2_M1`, its own collision + `sinkInToLandAfterDeathSpeed 0.1`
so it settles and slowly sinks into the ground, trailing `e_ScrapMetalSmoke`).
All `confirmed` from the `.con` files; the wreck mesh has its own collision
layer (42 + 27 tris, material 86, in `corsair_wreckfus1/2_m1.sm`).

### What a believable viewer crash needs (all assets exist)

1. HP <= 65: attach looping smoke sprite emitter at the cowling offset.
2. HP <= 20: add fire + heavy smoke; start the 1.5 HP/s bleed.
3. HP <= 0 (or high-speed impact): swap render model to the wreck
   (`Corsair.wreck.glb` is already extracted), play the `e_ExplGas`
   parameters (they are literally keyframes: sprite counts, sizes, colour
   ramps and blend modes are in the `.con`), throw 3 scrap meshes + the wreck
   with the emitter's velocity ranges, let the wreck fall to
   `max(terrain, water)` and sink at 0.1 m/s.
4. Water death: splash instead of fireball (`WaterWaterExplosion`), then sink.

---

## 5. Wake Island: what a plane can hit, and what the extraction has

### The collidable inventory (from the survey in section 1)

- **Terrain**: 512 x 512 heightfield, mostly seabed under the y = 95 water
  plane; the island ring rises to ~153.6 m ceiling (in practice a few metres
  above sea level).
- **Water**: flat plane at y = 95 over the entire 2048 m world.
- **Statics**: 747 placements / 38 templates — bunkers (bunker1/2, defgun
  bunkers, radar bunker), the airfield hangar (`airrep1_m1`), farms
  (`pacificfarm1/2`), guard towers, wooden bridge, sandbag lines, barbed
  wire, tank obstacles, barrels/crates/ammoboxes, one StandardMesh palm kind,
  ~370 TreeMesh palms (trunk hulls in `.tm`), ~250 TreeMesh bushes (no hulls,
  correctly). Everything with a mesh has a hull.
- **Vehicles from spawners** (32): 7 Willys, 6 DefGuns, 6 AA guns, 3
  Shermans, 3 Brownings, 2 M3A1s, Corsair, SBD, SBD-T, the destroyer
  Hatsuzuki and the carrier **Shokaku** (2,455 collision tris — a real
  landable/crashable deck).
- Not collidable: `island1/2/3` (shoreline wave-sound lines; they surface in
  `scene.json.sounds.areas`) and the meshless `AlliedAirplaneAmmo` triggers.

`confirmed` (survey run against `Wake.rfa` + `Wake_000` + `Wake_003` and the
mesh archives).

### What `viewer/maps/wake/` gives us today

`scene.glb` (1,831 nodes): every placement is a root node carrying its
translation/rotation, node names are template names (`bunker1_M1`,
`pacificfarm2Exterior`, ...), extras give `templateKind`/`geometry` per part
and `kind: terrain|water|sky|spawners` for the specials; the Corsair sits
under `spawners` with rig extras and its camera node (`flight.js` already
drives it). `scene.json` gives `worldSize`, `waterLevel`, water depth map +
`maxDepth`, fog, draw distance. `confirmed`

**Missing for collision, in order of value:**

1. Heights above sea level — not exported (recoverable from the terrain
   meshes at load, or export `Heightmap.raw`; section 2).
2. Collision hulls — excluded by `include_collision=False`; one-line flip +
   re-extract. Until then the render meshes double as raycast targets, at
   ~30x the triangle cost.
3. TreeMesh trunk hulls — need the small `treemesh.py` parser change
   (section 1), plus assembler plumbing mirroring what StandardMesh already
   has (`_treemesh_index` currently returns no collisions).
4. Terrain material ids (`Materialmap.raw`) — only needed to flavour impact
   effects/damage by surface; nice-to-have.
5. Per-face defensive materials reach the glb already when hulls are on
   (`defenseMaterial` extras) — nothing extra needed for material-correct
   damage against statics.

---

## 6. Recommended implementation

### Shape of the problem

One dynamic body (the plane, ~100–160 m/s), ~750 static objects whose
world-space AABBs never change, an analytic heightfield, and a flat water
plane. At 60 fps a fast plane moves ~1.7–2.7 m per frame; Wake's walls,
palm trunks and sandbags are 0.1–0.5 m thick — **discrete point tests will
tunnel; every test must be swept** (segment from previous to current
position, plus probe offsets).

### Recommended architecture

**Terrain and water: analytic, no meshes involved.**
Height lookup per probe point (section 2), compare against
`max(terrain, 95)`. This is exact (the engine's own collider is the same
grid) and costs nanoseconds. Do not raycast the terrain tiles. Landing
logic: if the contact probes are the wheels, gear is down, descent rate and
pitch are inside limits, and the surface is land — roll instead of crash,
which is also faithful to the tables (wheels take no damage).

**Statics: real hulls, uniform-grid broadphase, swept segment narrowphase.**

- Re-extract Wake with `include_collision=True` (and keep hull nodes out of
  the render pass — `map.html:1305` already detects
  `userData.collision`). Total narrowphase geometry is tiny: summing the
  coarse layers across all 747 placements is roughly **9,000 triangles for
  the whole island** (survey numbers, section 1); even the detailed layers
  sum to only ~40k.
- Broadphase: hash each placement's world AABB (from its hull, computed once
  at load) into a 64 m uniform grid. Per frame, walk the cells the swept
  segment crosses: typically 1–2 cells, 0–20 candidate objects (dense only
  around the airbase and village).
- Narrowphase: 3–5 swept probes (nose, wingtip left/right, tail, belly) as
  segments in the object's local frame against its hull triangles — either a
  hand-rolled segment/triangle loop or a `THREE.Raycaster` per probe against
  the candidate's collision mesh. At ~10–100 coarse tris per object and <20
  candidates, worst case is ~5 probes x 20 objects x 100 tris = 10k
  ray-triangle tests, and the typical airborne frame is zero candidates.
  No BVH library needed at this scale (three-mesh-bvh remains an easy
  upgrade if mods with denser maps arrive).
- Palms: after the `treemesh.py` change, collapse each trunk hull to an
  analytic capsule (centre line + radius ~0.35 m, height from the hull's Y
  extent) — segment-vs-capsule is cheaper and visually identical. Bushes:
  nothing.
- Ships/vehicles: same grid; the carrier is worth its real hull so the deck
  is landable (a downward probe over its AABB gives deck height).

Skip physics engines (ammo/rapier/cannon): one body, static world, and we
need Refractor's semantics (material tables, wheel exemption), not solver
features. `strong inference` as a judgement call; everything it rests on is
measured above.

**Damage: implement the tables, not a hack.** On contact with relative
normal speed `v_n` (m/s): look up attacker material (terrain cell material,
water = 1, or the struck hull face's `defenseMaterial` extra for statics),
defender material (which probe hit: hull 61, wheels 37, prop 45), then

```
damage = materialDamage(att) * damageMod(att, def) * speedMod * min(1, v_n / v_ref)
```

with `v_ref ~ 10 m/s` chosen so a full-speed wall or ground strike deals
hundreds of times the per-event base (matching the in-game "instant" death)
while a 5 m/s scrape costs ~1 HP and bounces. Wheels-first contacts deal 0 by
table. Then the threshold chain from section 4 drives smoke (65), fire + 1.5
HP/s bleed (20), and the explosion/scrap/wreck sequence (0), with the water
variant when the surface was material 1. Tables and thresholds `confirmed`;
`v_ref` is our tuning knob standing in for the executable's speed curve
(`strong inference`).

### Per-frame budget

| stage | typical | worst case |
|---|---|---|
| heightfield probes (5 bilinear lookups) | < 1 us | < 1 us |
| broadphase grid walk | < 1 us | ~5 us |
| swept narrowphase | 0 (no candidates airborne) | ~10k ray-tri ≈ 0.1–0.3 ms |
| damage lookup + effects bookkeeping | negligible | negligible |

Total: effectively free against a 16.7 ms frame; the crash *effects* (particle
sprites) will cost more than the collision ever does.

---

## Appendix: files consulted

Repo readers and pipeline: `tools/bf1942-models/bf42/stdmesh.py`,
`treemesh.py`, `terrain.py`, `level.py`, `damage.py`, `assemble.py`,
`con.py`, `gltf.py`, `extract_map.py`, `extract_models.py`;
viewer: `viewer/map.html`, `viewer/flight.js`, `viewer/index.html`,
`viewer/maps/wake/scene.json`, `viewer/maps/wake/scene.glb` (node table),
`viewer/models/Corsair*.glb` (presence).

Game data (via `bf42.rfa`): `Mods/bf1942/Archives/Objects.rfa`
(`Objects/Vehicles/Air/Corsair/*`, `Objects/Buildings/Common/guardtow/`,
`Objects/Effects/e_CorsairDamage|e_CorsairFire|e_scrapmetal_Corsair|
e_ExplGas|e_scrapmetal_Plane/Effects.con`, `Objects/Effects/Common/effects.con`,
`Objects/MOVE_FILES/Wreck_Corsair2_M1/*`),
`Archives/bf1942/Game.rfa` (`materialManagerdefine.con`,
`collision_Armor/*.con` — 7 files),
`Archives/bf1942/levels/Wake.rfa` + `Wake_000` + `Wake_003`
(`StaticObjects.con`, `Init/Terrain.con`, `Heightmap.raw`,
`Materialmap.raw`, `Conquest/*`), `standardMesh.rfa` + `StandardMesh_001.rfa`
(all `corsair_*.sm`, plus every mesh reachable from Wake's static templates),
`treeMesh.rfa` (`palmhigh_m1.tm` and four others, collision blocks parsed by
hand).

Survey script: `wake_collision_survey.py` (session scratchpad; rerunnable —
it only needs the repo tools and the game install).
