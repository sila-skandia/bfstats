# Projectile collision: rounds that stop

Before this, nothing in the viewer collided with anything. A round left the
muzzle and was deleted by a timer or a range cap; it passed through terrain,
buildings and water identically. That is gap **C-1** of
[`parity-audit/projectiles-collision.md`](parity-audit/projectiles-collision.md),
the headline complaint, and it is closed here along with **C-5** (the terrain
query existed but only the aircraft used it), **C-6** (no water test, no splash)
and **M-2** (`Materialmap.raw` never read, so a ground hit could not tell sand
from stone).

Code: [`viewer/collision.js`](../../tools/bf1942-models/viewer/collision.js) (new),
`viewer/gunfire.js`, `viewer/map.html`, `extract_map.py`.
Tests: `tests/test_collision.py` + `tests/collision_harness.mjs`.

---

## What the game does

Refractor collides a projectile against three different things, in three
different ways, and the shapes of the shipped data are what say so.

**Terrain is a heightfield, not a mesh.** `Heightmap.raw` is `dim x dim`
little-endian u16 samples at `worldSize / dim` metres — 512 x 512 on 4 m
spacing for every vanilla 2048 m level ([`bf42/level.py`](../../tools/bf1942-models/bf42/level.py)).
There is **no terrain collision mesh anywhere in the archives**: the heightmap
*is* the collider. Beside it, `Materialmap.raw` is one byte per heightmap
sample carrying the MaterialManager terrain id — 0-15, the family
`materialManagerdefine.con` heads with `rem Default / Water / Dry grass / ... /
Dry sand (El Alamein) / Rock / Sand Road`.

**Water is one horizontal plane** at `Init/Terrain.con`'s `waterLevel`, over the
whole world rather than only under the textured patches. It is material **1**,
`materialDamage 30`, `materialFriction 0.1`. `Em_WaterSprite` declares
`moveToWaterSurface 1`, which is the engine snapping spray to that plane.

**Statics carry real hulls**, stored inside the `.sm` ahead of the LOD chain:
`colCount` layers of `(vertices, faces)` where each face is three i16 indices,
a **defensive material byte** and a flags byte. The material byte is the whole
damage-model hookup — a church reads out as 402 faces of *Interior Stone Wall*,
288 *Exterior brick*, 114 *Wood*, 12 *Glass Pane*.

**What a hit looks like comes from the same table as what it costs.**
`MaterialManager.setEffectTemplate` names one of 73 authored `EffectBundle`s per
`(attacker material, defender material)` pair — 4,099 pairs after last-wins
resolution. The attacker id is `ObjectTemplate.material` on the **Projectile**
(236 allied tank gun, 239 axis heavy tank, 213 airplanes, 218 rifle); the
defender is the terrain byte, water's 1, or the struck hull face's byte.

---

## What the data says

All counts measured, not estimated. Reproduce commands at the bottom.

| map | collision nodes | collision triangles | distinct hull materials | terrain | terrain surfaces |
|---|---|---|---|---|---|
| Wake | 478 | **20,911** | 44 | 512² @ 4 m | 5 (Wet sand 249,019 of 262,144 samples) |
| Bocage | 427 | **21,661** | 51 | 512² @ 4 m | 6 (Juicy grass 146,144) |
| Berlin | 543 | **33,067** | 44 | 512² @ 4 m | 4 (**Reserved/Outside map 259,537**) |

Unique geometry behind those instances is far smaller — Wake 6,300 triangles
across 85 parts, Bocage 8,765 across 128, Berlin 6,411 across 98 — because a map
places the same bunker forty times. Cost of carrying it: Bocage's `scene.glb`
went 68,162 KB to 68,940 KB, **+1.1%**.

Berlin is the one to read twice. Its material map says 259,537 of 262,144
samples are id **7, "Reserved (Outside map)"** — the engine itself calls 99% of
Berlin out of bounds — and the level ships four terrain tiles and no default
patches, so the height lattice rebuilds at **6.3% coverage** and a round fired
over the rest of the world has no ground to hit. That is the terrain export,
not the collider, and it reproduces on a *fresh* extract: it is what the level
contains.

Resolution through the effect table, queried from the shipped
`_shared/damage.json`:

```
attacker 236 (ALLIED LIGHT TANK)        attacker 213 (Airplanes)
  vs   1 Water        e_waterimpact       vs   1 Water        e_RichoWaterHeavy
  vs  10 Dry sand     GroundExplDry       vs  10 Dry sand     e_richoPHeavy
  vs  11 Wet sand     e_ExplAni01         vs  11 Wet sand     e_richoPHeavy
  vs  80 Solid Wood   Exp2CascadesWood    vs  92 Concrete     e_richoPHeavy
  vs  85 Metal        Exp2CascadesMetal
  vs  92 Concrete     Exp2CascadesStone
```

A Corsair's machine gun ricochets off everything, which is the point: the table
already distinguishes a 20 mm burst from a Sherman round without anyone
deciding it should.

---

## What was built

### `viewer/collision.js` — new, and imports nothing

Not even `three`. It reads three.js objects through the four fields it actually
needs (`geometry.attributes.position`, `geometry.index`, `geometry.userData`,
`matrixWorld.elements`) and returns plain numbers. That is what lets
`tests/test_collision.py` run the real module under node against fake meshes,
with no renderer and no GL — 22 assertions covering every branch.

Three tests, **cheapest first and each narrowing the segment handed to the
next**, which is the whole performance story:

1. **Water** — `t = (oy - waterLevel) / -dy`, one divide. A round that starts
   below the surface is already wet and is left alone rather than stopped at
   the ceiling it is under.
2. **Terrain** — march the level's own lattice by one cell of horizontal travel
   (so a 1000 m/s round takes four samples over its 16.7 m frame), then bisect
   the bracketing interval eight times, which pins the crossing to under 7 cm.
   A round that starts underground is left alone, for the same reason.
3. **Hulls** — a 32 m uniform XZ grid, counting-sorted at load, walked by DDA
   (Amanatides & Woo) with a per-cell Y-extent reject before any triangle is
   touched, then Möller-Trumbore. Wake packs 20,911 triangles into 1,054 cells
   as 24,671 entries — 1.18 cells per triangle.

Taking terrain and water first is not just ordering: their `t` becomes the
grid's `maxDist`, so a round over open sea never touches a triangle, and a
round over a town only tests what is in front of the ground it was going to hit
anyway.

**Everything is swept.** At 1000 m/s a round moves 16.7 m between frames and a
Bocage church wall is 0.3 m thick, so a point test at the new position misses
it 98 times in 100. The segment from where the round *was* to where it *is*
cannot. That case is the assertion that matters most and it is in the suite
(`test_the_sweep_catches_a_wall_thinner_than_one_frame_of_travel`).

### C-5: one ground-height implementation, not two

`map.html`'s `groundHeight(x, z)` was a downward `THREE.Raycaster` against the
64 terrain tile meshes, wired to the aircraft, the camera clamp and the view
rig. It now delegates to the heightfield — the same grid the engine collides
against, so it is not an approximation of the raycast but the thing the raycast
was approximating — and keeps the raycast as the fallback for a level whose
lattice will not rebuild. The lattice is recovered from the terrain tiles
already in the scene by snapping vertices to `(x / spacing, -z / spacing)`,
verified exact on Bocage: 270,400 vertices, 513 distinct x and 513 distinct z,
every one a multiple of 4. Coverage on Wake and Bocage is 1.0.

That means no new asset and every already-extracted map keeps working.

### C-6: water

A plane test and a splash marker. Six of 23 vanilla maps are mostly water, and
firing over the sea previously showed nothing at all. The hit is snapped
exactly onto `waterLevel` and resolves material 1.

### M-2: the surface under a ground hit

`Materialmap.raw` already ships as `terrain/materials.png` (one byte per
sample, written into the red channel, a couple of KB because the ids come in
large flat regions). The viewer decodes it to a `Uint8Array` once per level and
samples it **nearest** — a bilinear read between id 10 (dry sand) and id 12
(rock) would invent id 11.

Confirmed live: rounds into Wake's airfield came back material **3** (Juicy
grass) and **10** (Dry sand) from adjacent impacts, which is what the map's own
histogram says is there.

### The missing link: attacker material

The effect table is keyed by material id; a round in flight knows only its
template name (`fireArms.projectile.template` in the node extras). So
`extract_map.py` now writes a `projectileTemplate -> material` table into the
shared `damage.json` — **70 entries**, walked off an `ObjectLibrary` it already
builds, no extra archive reads. `con.py` was already parsing the field.

### A gun does not shoot its own hull

A Tiger's barrel starts metres inside `Tiger_Hull_M1`, so without this every
shot detonates at the muzzle. Each collision triangle carries an owner id (one
per placed static, one per *spawned vehicle* rather than one for the whole
spawner group, so a Sherman's round still stops on the Willy parked beside it),
and the firing group's owner is resolved once and cached.

---

## What was measured

Real Chromium (Playwright, the one `shoot.mjs` already uses), software GL,
1280x800, against the real extracted levels. No page errors, no failed
requests.

**Per-cast cost**, 300,000 casts per map at pseudo-random positions across the
whole world:

| query | Wake<br>20,911 tris / 1,054 cells | Bocage<br>21,661 / 1,410 | Berlin<br>33,067 / 192 |
|---|---|---|---|
| level flight, 16.7 m segment — the 1000 m/s frame | **1,699 ns** | **1,232 ns** | **2,120 ns** |
| straight down from 400 m — the longest segment anything asks | **1,619 ns** | **1,941 ns** | **2,104 ns** |
| candidate triangles per query | 4.5 | 2.7 | 10.7 |

Berlin is the worst case of the three and still 2.1 µs: it packs half again as
many triangles into a *fifth* as many cells, because the whole level is one
dense city block, so a query there really does test ten triangles instead of
three. That is the shape of the curve — it follows local density, not map
total, which is the property a uniform grid is chosen for.

The `WorldCollider`'s own per-cast accumulator reported 4.38 µs over a live
burst, but Chromium clamps `performance.now()` to ~5 µs, so that figure is a
granularity artefact rounded up. The batch timings above are the real number.

Against the budget in
[`features/flyable-vehicles/collision-and-crash.md`](../flyable-vehicles/collision-and-crash.md)
§6, which allowed 0.1-0.3 ms worst case for *one* body: a held burst from a
12 rps gun keeps tens of rounds in the air, and 40 rounds x 1.7 µs is
**68 µs per frame — 0.4% of a 16.7 ms frame**. There is a `MAX_CASTS_PER_FRAME`
lid of 192 anyway (rounds past it are tested next frame against a segment that
carries the untested step forward, so they still cannot tunnel); the live burst
peaked at 5.4 casts per frame and never came near it.

Build cost is one pass at level load: Wake's 20,911 triangles counting-sorted
into 1,054 cells, and 270,400 terrain vertices snapped into the lattice.

**Behaviour — flown, fired, and read back.** Corsair on Wake, throttle up,
nose over, trigger held for 420 frames, 84 rounds:

```
16 recorded hits (the record is a ring of 16), all three surface kinds:
  8x water    material  1  ->  e_RichoWaterHeavy   y exactly 95.0
  2x terrain  material  3  ->  e_RichoPHeavy       (Juicy grass)
  4x terrain  material 10  ->  e_richoPHeavy       (Dry sand)
  2x object   material 93  ->  e_richoPHeavy       (Reinforced Concrete)
tracers in flight after the trigger released: 0
```

**It does not shoot itself.** The failure mode that would read as "the guns
stopped working" rather than as a bug is a round detonating on the firer's own
hull, which is where every muzzle sits. The Corsair resolved to owner id 812;
every object hit came back owner **431** — the concrete bunker it was parked
beside, struck at 5.6 m and 6.3 m — and **zero** hits had `owner === firer`.
The hit record carries both ids so this stays checkable.

Geometric probes against the loaded level agreed: a ray fired horizontally at
Wake's `supplyde_m1` from 40 m out stopped on it at t = 40.9 m against material
93, and straight-down probes over the lagoon returned `water` at y = 95.

**Bocage and Berlin** were probed the same way and behave identically —
21,661 and 33,067 triangles indexed, heightfield 512² with the material map
loaded, a horizontal ray into `eu_church_M1` stopping at t = 69.3 m on material
90 and into `rusruin01_m1` at t = 6.5 m on material 94, and straight-down probes
returning `water` over Bocage's river and `terrain` material 5 (Wet dirt)
inland. Neither could be **flown and fired**, because `setPilot` only looks for
a Corsair, a Spitfire or a Zero and neither level spawns one; the firing loop
itself is verified on Wake only, the collider on all three.

---

## What is still missing

Named honestly, because each one is a separate piece of work.

- **The authored effects are selected but not played.** The hit resolves to
  `GroundExplDry` / `e_waterimpact` / `Exp2CascadesStone` and the name is on the
  hit record, but drawing it needs the 73 `EffectBundle`s baked into the level
  glb the way muzzle flashes already are (`assemble.py`'s
  `_effect_bundle_node` is the entry point and is already reusable). Until then
  the viewer draws a tinted additive puff, sized and coloured by material
  family, and that is a marker, not a reconstruction. Gap **M-1**'s "play" half.
- **No impact sound.** Most of those bundles carry `loadSoundScript` — the
  `.ssc` player shipped in `69b095d` — but the samples are not extracted, so
  there is nothing to play. Extractor work, blocked on the same bake.
- **No decals** (gap M-3). `RichoStoneDecal` / `RichoMetalDecal` /
  `RichoWoodDecal` are 15 authored templates with real geometry and a
  `relativePositionInUp 0.001` lift; a pooled decal ring buffer is the cheapest
  possible proof that collision is real, and it is not built.
- **No explosion or splash damage** (gap E-1). `radius` on 29 projectiles and
  `material2` on 49 are parsed into `damage.json`'s weapon list but nothing
  detonates.
- **Vehicles and soldiers are collidable, but nothing is damaged** (gap C-7).
  Rounds stop on a parked vehicle's hull and report its `defenseMaterial`; the
  damage tables are loaded in the same page and are not consulted.
- **Collision groups are still dropped** (gap C-4). `c_CGProjectiles` and
  `c_CGLadders` are 47 declarations the extractor does not parse, so a wire
  fence stops a round exactly like a wall.
- **TreeMesh trunks have no hulls.** `treemesh.py` recognises the collision
  block and skips it, so Wake's ~370 palms are fly-through. Roughly 20 lines,
  with the layout already written down in the skip code.
- **Only re-extracted maps have hulls.** Collision is in the export path but
  every level has to be re-run to get it. A map without hulls still collides
  against terrain and water and says so in the stats panel (`collision hulls not
  exported`) rather than failing quietly.
- **Berlin has no ground outside its four tiles**, so a round fired over the
  rest of the world falls to the sea instead of the dirt. The level declares
  99% of itself "Reserved (Outside map)" and ships no default patches, so this
  may well be right; settling it is a terrain-export question, not a collision
  one. `__collision().heightfield.coverage` is there to make it visible —
  Wake and Bocage both come back at 1.0, Berlin at 0.063.

---

## Reproduce

Re-extract a level with collision (it is on by default; `--no-collision` opts
out). Measured 41-61 s per level:

```bash
cd tools/bf1942-models
python3 extract_map.py Wake   --out ./viewer/maps
python3 extract_map.py Bocage --out ./viewer/maps
python3 extract_map.py Berlin --out ./viewer/maps
```

Count what landed:

```bash
cd tools/bf1942-models/viewer/maps && python3 - <<'PY'
import struct, json, collections
for name in ("wake", "bocage", "berlin"):
    d = open(f"{name}/scene.glb", "rb").read()
    ln = struct.unpack_from('<I', d, 12)[0]
    j = json.loads(d[20:20 + ln])
    nodes = [n for n in j['nodes'] if (n.get('extras') or {}).get('collision')]
    mats, tris = collections.Counter(), 0
    for n in nodes:
        for p in j['meshes'][n['mesh']]['primitives']:
            c = j['accessors'][p['indices']]['count'] // 3
            tris += c
            mats[(p.get('extras') or {}).get('defenseMaterial')] += c
    print(f"{name}: {len(nodes)} nodes, {tris} triangles, {len(mats)} materials")
PY
# wake: 478 nodes, 20911 triangles, 44 materials
# bocage: 427 nodes, 21661 triangles, 51 materials
# berlin: 543 nodes, 33067 triangles, 44 materials
```

Check the effect table and the attacker ids the viewer reads:

```bash
cd tools/bf1942-models/viewer/maps && python3 - <<'PY'
import json
d = json.load(open('_shared/damage.json'))
print(len(d['projectiles']), "projectiles;",
      sum(len(r) for r in d['effects'].values()), "effect pairs")
print(d['projectiles']['shermanprojectile'], d['projectiles']['corsairprojectile'])
for defender in ('1', '10', '92'):
    print(236, defender, d['effects']['236'][defender])
PY
# 70 projectiles; 4099 effect pairs
# {'material': 236} {'material': 213}
# 236 1 e_waterimpact
# 236 10 GroundExplDry
# 236 92 Exp2CascadesStone
```

Run the tests (unittest; there is no pytest here):

```bash
cd tools/bf1942-models
touch tests/__init__.py
python3 -m unittest discover -s tests -t . -q
rm -f tests/__init__.py
```

`tests/test_collision.py` skips itself if `node` is not installed; everything
else is pure Python.

In the browser, start the `model-viewer` launch config and open
`map.html?map=Wake&shots`. `window.__collision()` reports the built index and
drains the accumulated cast cost; `window.__castRay([x,y,z],[dx,dy,dz],len)`
probes it directly; `window.__getFire().hits` is the last sixteen impacts with
their surface, material and resolved bundle.
