# Projectiles, collision and damage — parity gap report

Audit date 2026-09-14, against vanilla `Mods/bf1942` at patch 1.6 plus 16 mods.
Scope: what the game simulates for a round in flight, what it hits, and what
happens when it hits — versus what `tools/bf1942-models/` extracts and
`viewer/` draws. **No code was changed.**

Everything below is reproducible. Unless stated otherwise, commands run from
`/home/dylan/projects/skandia/bfstats/tools/bf1942-models` with
`from extract_models import build_pools, mod_chain, DEFAULT_GAME_DIR`.

---

## The one-line finding

**Nothing in the viewer collides with anything.** A round leaves the muzzle and
is deleted by a timer or a range cap — `gunfire.js:636` for tracers,
`gunfire.js:659` for shells and rockets. It passes through terrain, buildings,
water, vehicles and soldiers identically. The collision geometry needed to fix
that is already parsed by `bf42/stdmesh.py`, already exported for the *model
browser*, and switched off for maps by one keyword argument
(`extract_map.py:1565`, `include_collision=False`).

The second finding is that the entire **impact-effect table is already read into
memory and then thrown away**: `bf42/damage.py:308-310` collects 4,099 distinct
`(attacker material, defender material) → effect template` pairs, and
`DamageTables.as_dict` (`damage.py:170-180`) emits `materials` and `modifiers`
but not `effects`.

---

## A note on naming, before the gaps

The audit brief asked about `setExplosionRadius`, `setExplosionDamage`,
`setMaterialFilter`, `setHasHitPoints`, `setArmorFactor`, `setDamageType`,
`setTimeToLive`, `setGravityModifier`, `setVelocity`, `setRoundOfFire`,
`setNumberOfBullets`, `setDestroyed`, `setWreck`, `setCollisionMesh`,
`NonVisibleObject`, `.cm` files, and `ExplosionEffect`.

**Every one of those spellings has zero hits across all 74 `.rfa` archives.**
They are Refractor 2 / BF2 vocabulary. Refractor 1 uses bare property names
(`explosionRadius`, `hitpoints`, `material`) and has no separate collision-mesh
file type — collision lives inside the `.sm`. Where a BF1942 equivalent exists
it is named below; where none exists the item is closed as **N/A (not in the
engine's data)** rather than reported as a gap.

Reproduce the negative:

```bash
python3 - <<'PY'
import re
from pathlib import Path
from bf42.rfa import RfaArchive
base = Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
rfas = sorted(base.glob('*.rfa'))+sorted((base/'bf1942').glob('*.rfa'))+sorted((base/'bf1942/levels').glob('*.rfa'))
pat = re.compile(r'setMaterialFilter|MaterialFilter|setCollisionMesh|NonVisibleObject|setExplosionRadius|setHasHitPoints|setArmorFactor', re.I)
for p in rfas:
    a = RfaArchive(p)
    for n in sorted(a.entries):
        if not n.lower().endswith(('.con','.inc','.ssc','.rs','.txt')): continue
        try: t = a.read(n).decode('latin-1')
        except Exception: continue
        for i,l in enumerate(t.splitlines(),1):
            if pat.search(l): print(f'{p.name}:{n}:{i} :: {l.strip()}')
PY
# prints nothing
```

---

# 1. Collision — the keystone

## GAP C-1 — A projectile never tests against anything

**Gap.** No projectile, tracer or shell in either viewer performs a single
intersection test; rounds are recycled purely on `timeToLive` or a distance cap.

**Ground truth.** Every vanilla `Projectile` that should register an impact
carries `ObjectTemplate.hasCollisionEffect 1` — 71 templates, e.g.
`Objects/Vehicles/Land/Sherman/Weapons.con :: ShermanProjectile`,
`Objects/HandWeapons/Common/Weapons.con :: RifleProjectile`. The four that
declare `0` are the ones with no ricochet (`BinocularsProjectile`,
`ExpPackProjectile`, `Grenade*Projectile`, `LandmineProjectile`). 15 projectiles
additionally declare `ObjectTemplate.endEffectTemplate` — the detonation bundle
at end of flight (`Torpedo → WaterExplosionTorpedo`,
`Defgun_Projectile → e_ExplDirt`, `Flak38_Projectile → e_FlakBig`,
`Grenade*Projectile → e_ExplGranade`).

**Current state.**
- `viewer/gunfire.js:620-644` — tracer loop: advance position, recycle on
  `age > ttl || travelled > maxRange`. No raycast.
- `viewer/gunfire.js:645-674` — shell/rocket loop: identical, plus gravity and
  a rocket accel ramp. No raycast.
- `viewer/flight.js:652` carries the admission in a comment: *"Real collision
  against buildings is a separate problem; this is only the heightfield and the
  sea"* — and that path is the **aircraft**, not its rounds.
- `viewer/map.html:2075` drives `guns.setFiring(...)` from the pilot's fire
  input; nothing downstream consumes an impact.

**Size.** L. Needs (a) collision geometry in `scene.json`/glb (gaps C-2..C-4),
(b) a broadphase in the viewer, (c) an impact-effect spawner (gap M-1).

**Impact.** Very visible. Fire the Corsair's guns at Wake's tower from 50 m and
the tracers pass through the building and the island and expire in the sea. Any
user who fires at something notices within one burst.

---

## GAP C-2 — Collision geometry is excluded from every map export (keystone)

**Gap.** The map exporter is invoked with `include_collision=False`, so no map
`scene.glb` contains a single collision triangle — even though the assembler
already knows how to emit them.

**Ground truth.** Collision geometry is stored inside the `.sm`, ahead of the
LOD chain, in the layout `stdmesh.py:1-37` already documents:

```
u32 colCount
  per layer:
    u32 blockSize
    u32 unknown[2]              constant (0xEB97C2FA, 5) in all 845 vanilla layers
    u32 vertexCount
      per vertex: f32 x,y,z, f32 unknown
    u32 faceCount
      per face:   i16 v[3], u8 defensiveMaterial, u8 flags
    trailing acceleration data to blockSize
```

Census over `standardMesh.rfa` + `StandardMesh_001.rfa` (1,445 `.sm`, **0 parse
failures**): `colCount` histogram `{0: 805, 1: 435, 2: 205}`, 66,476 collision
faces, **77 distinct material ids**, and the `flags` byte is **0 on every single
face** — it carries nothing in vanilla.

**There are never three collision LODs.** Across all 17 installed mods
(~35,000 `.sm` files) the maximum `colCount` is **2**:

| mod | .sm | colCount histogram |
|---|---|---|
| bf1942 | 1445 | `{0: 805, 1: 435, 2: 205}` |
| FH | 4621 | `{0: 2372, 1: 1093, 2: 1156}` |
| FHSW | 7646 | `{0: 4287, 1: 1227, 2: 2132}` |
| bg42 | 6595 | `{0: 3832, 1: 1181, 2: 1582}` |
| DesertCombat | 1123 | `{0: 529, 1: 345, 2: 248}` |
| EoD | 1907 | `{0: 873, 1: 354, 2: 680}` |
| interstate | 697 | `{0: 223, 1: 466, 2: 8}` |
| (+10 more, all ≤ 2) | | |

Layer 0 is the **coarse** hull (median 12 verts / 12 faces; 96 of 205 two-layer
meshes use a single material id for the whole thing). Layer 1 is the **detailed**
hit mesh (median 104 verts / 134 faces; layer1 ≥ layer0 in 204 of 205 cases,
median face ratio 6.4×). Soldier collision is a *different mechanism* entirely —
`GeometryTemplate.create SkeletonCollisionMesh BodyCollision`
(`Objects/Soldiers/Common/Geometries.con:1`, the only occurrence in the game).
The projectile/vehicle/soldier three-LOD split in the brief is a BF2 convention;
mark the engine's internal use of layer 0 vs layer 1 **UNVERIFIED** without the
binary — the shipped data only shows coarse vs detailed.

Samples:

```
Sherman_Hull_M1.sm  col=2  L0: 14v/24f {50:10,51:9,52:5}   L1: 28v/46f {50:21,51:20,52:5}
Tiger_Hull_M1.sm    col=2  L0: 12v/20f {51:6,53:4,54:10}   L1: 42v/60f {51:40,53:14,54:6}
Afrhouse_M1.sm      col=2  L0: 20v/26f {102:26}            L1: 370v/570f {8:6,90:28,96:6,102:518,118:12}
eu_church_m1.sm     col=2  L0: 129v/95f {99:6,102:89}      L1: 896v/996f {80:8,81:114,96:52,101:402,102:288,117:39,118:30,119:12}
bunker2_M1.sm       col=2  L0: 18v/25f {100:25}            L1: 189v/267f {85:41,93:226}
```

The church reads exactly as the material table predicts: 402 faces of *Interior
Stone Wall*, 288 *Exterior brick Wall*, 114 *Wood*, 52 *Stone stairs*, 39
*Wooden Floor*, 30 *Stone Floor*, 12 *Glass Pane*.

**Current state.** The extractor side is *already built*:
- `bf42/stdmesh.py:211-261` parses every layer, vertex, face, material and flag.
- `bf42/assemble.py:483-542` (`_collision_mesh_indices`) picks the last non-empty
  layer, groups faces by material, and emits one glTF primitive per material
  with `extras = {"collision": true, "defenseMaterial": <id>, "collisionFlags": [...]}`.
- `bf42/assemble.py:1458-1467` hangs a node named `"<Template> collision <layer>"`
  with `extras.collision / collisionLayer / collisionRole` under the template's
  own node, so it inherits the turret/wheel transform.
- `extract_models.py:304` passes `include_collision=not first_person` — the model
  browser gets it.
- **`extract_map.py:1565` passes `include_collision=False`** — the map does not.

Verified empty:

```bash
cd tools/bf1942-models/viewer/maps && python3 - <<'PY'
import struct, json
for p in ("wake/scene.glb","berlin/scene.glb"):
    d=open(p,'rb').read(); ln=struct.unpack_from('<I',d,12)[0]
    j=json.loads(d[20:20+ln])
    print(p, "nodes",len(j['nodes']), "collision-tagged",
          sum('collision' in json.dumps(n).lower() for n in j['nodes']))
PY
# wake/scene.glb nodes 1989 collision-tagged 0
# berlin/scene.glb nodes 789 collision-tagged 0
```

`viewer/map.html:1743-1744` (`isCollision`) and `:1780` already hide collision
nodes on load, and `:2111` already excludes them from shading — that plumbing is
live but currently dead code, because nothing ever arrives.

**Size.** S for the extractor (flip the flag plus gap C-3), M once the viewer
needs a BVH. The budget is the surprise — it is tiny:

| map | statics placed | distinct geometries | with collision | detailed-layer total |
|---|---|---|---|---|
| Wake | 747 | 53 | 32 | 1,891 v / 2,434 tris |
| El Alamein | 898 | 69 | 44 | 3,720 v / 5,047 tris |
| Berlin | 326 | 60 | 55 | 5,301 v / 5,917 tris |
| Omaha Beach | 431 | 71 | 58 | 5,476 v / 7,207 tris |
| Stalingrad | 649 | 70 | 66 | 5,403 v / 6,760 tris |

The whole vanilla mesh library's collision corpus is 66,476 triangles — about
0.9 MB of raw glTF buffer for *every mesh in the game*, shared across hundreds of
instances per map. It is not a size problem.

**Impact.** This is the gate. Nothing in sections 1, 3, 4 or 7 can be built
without it.

---

## GAP C-3 — For buildings, the drawn mesh has no collision; the collision lives in the *other* LOD alternative

**Gap.** The map draws the building's `Exterior` alternative (the `_m2` distance
mesh), which ships **zero collision layers**. Flipping `include_collision` alone
would therefore give a map with collision on tanks and none on houses.

**Ground truth.** `Objects/Buildings/Africa/afr_house1_ste/Objects.con`:

```con
ObjectTemplate.create Bundle afr_house1_ste_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate lodafr_house1_ste

LodSelectorTemplate.create DistanceSelector afr_house1_steSelector
LodSelectorTemplate.addLodDistance 70
ObjectTemplate.create LodObject lodafr_house1_ste
ObjectTemplate.addTemplate afr_house1_steInterior     <- geometry afr_house1_ste_m1  (col=2)
ObjectTemplate.addTemplate afr_house1_steExterior     <- geometry afr_house1_ste_m2  (col=0)
```

`afr_house1_ste_m1.sm` has 2 collision layers (L1: 224 v / 359 f, materials
81/90/96/100/118). `afr_house1_ste_m2.sm` has none. The engine keeps both
alternatives and swaps the *visual* at 70 m; collision is on the physics body,
which is the `Bundle` root carrying `setHasCollisionPhysics 1`.

**Current state.** `bf42/con.py:182-195` (`lod_alternative_role`) maps
`"exterior" → "complex"`, and `con.py:211-221` (`select_lod_alternative`) with
`configuration="complex"` therefore picks the Exterior. Confirmed in the shipped
data — El Alamein's `scene.glb` contains `Afrhouse_m2`, `afr_house2_ste_m2`,
`bunker1_m2`, `hospital_m2`, `barack_m2`, `airrep1_m2`, `landrep1_m2`,
`Supplyde_m2` as drawn geometry:

```bash
cd tools/bf1942-models/viewer/maps && python3 - <<'PY'
import struct, json
d=open("el_alamein/scene.glb",'rb').read(); ln=struct.unpack_from('<I',d,12)[0]
j=json.loads(d[20:20+ln])
g={(n.get('extras') or {}).get('geometry') for n in j['nodes']}
print(sorted(x for x in g if isinstance(x,str) and x.lower().endswith('_m2')))
PY
```

Cross-check against the per-map table in C-2: every geometry reported there as
"NO collision layer" is an `_m2` — `Afrhouse_m2`, `bunker2_m2`, `hospital_m2`,
`o_bunker_m2`, `suburbhouse_*_m2`, `supplyde_m2`, `airrep1_m2`. The pattern is
exact.

**Size.** S. `_collision_mesh_indices` must be called on the *highest-detail*
alternative of the LodObject (or on every alternative, taking the first that has
layers), not on whichever alternative was selected for drawing.

**Impact.** Silent and total: without this, collision would appear to work on
Wake (where the drawn statics are mostly `_m1`) and fail on every European map.

---

## GAP C-4 — Collision-group membership and `hasCollisionPhysics` are dropped

**Gap.** The per-object flags that decide *whether* a thing collides, and *with
what*, are never parsed.

**Ground truth.**
- `ObjectTemplate.setHasCollisionPhysics` — 539 templates;
  `ObjectTemplate.hasCollisionPhysics` — 532 more lines. This is the on/off
  switch. `Objects/Buildings/Common/AlliedAirplaneAmmo/Objects.con` declares `0`.
- `ObjectTemplate.setHasResponsePhysics` / `hasResponsePhysics` — 49 / 492.
- `ObjectTemplate.addToCollisionGroup` — **47 occurrences, exactly two groups**:
  `c_CGProjectiles` (29) and `c_CGLadders` (18).

```con
# Objects/Buildings/Common/churcfence_m1/Objects.con
ObjectTemplate.create SimpleObject churcfencefence_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addToCollisionGroup c_CGProjectiles

# Objects/Buildings/Common/Factory/Objects.con
ObjectTemplate.create SimpleObject Ladder_5m_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.setHasResponsePhysics 1
ObjectTemplate.addToCollisionGroup c_CGLadders
ObjectTemplate.addToCollisionGroup c_CGProjectiles
```

The exact semantics of group membership (whitelist vs. additional mask) is
**UNVERIFIED** — settling it needs the `BF1942.exe` corpus in the
`bf1942-mod-extraction` skill. What is certain is that a church fence and a
ladder are marked differently from a wall, and the extractor cannot tell.

**Current state.** `bf42/con.py:479-737` has no branch for any of these; grep
`addToCollisionGroup|hasCollisionPhysics|hasResponsePhysics` under `bf42/`
returns nothing.

**Size.** S — three fields in `ObjectTemplate`, three keys in the node extras.

**Impact.** Low until C-1/C-2 land; then it is the difference between bullets
stopping on a wire fence and passing through it.

---

## GAP C-5 — Terrain height query exists but is wired only to the aircraft

**Gap.** `map.html` already raycasts the terrain, but only to keep the flown
plane above the ground. Rounds never ask.

**Ground truth.** The heightmap is `dim × dim` 16-bit samples at
`worldSize/dim` metres (`bf42/terrain.py:1-13`), and it *is* fully exported as
geometry — 64 tile meshes on Wake, 4 on Berlin, tagged `extras.kind = "terrain"`.

**Current state.**
- `viewer/map.html:1930-1941` — `groundHeight(x,z)`: a downward `THREE.Raycaster`
  against `terrainMeshes`, clamped at `extras.waterLevel`.
- `viewer/map.html:1943-1951` — `collectTerrain` gathers tiles by `kind`.
- `viewer/map.html:1975` / `:1986` — the only consumers are `Aircraft.groundHeight`
  and `VehicleCamera`.
- `viewer/flight.js:652-661` — the plane's floor clamp.
- `viewer/gunfire.js` — no reference to terrain at all.

**Size.** S. The query already exists and is already cheap; a shell only needs a
segment test between last and current position each frame.

**Impact.** High and cheap. A tank shell burying itself in a dune is the single
most legible improvement available for the least work.

---

## GAP C-6 — Water impact: no splash, no surface test

**Gap.** `waterLevel` is in `scene.json` and a water plane is in the glb, but no
round ever tests against it and there is no splash.

**Ground truth.** Water is material **1** in the MaterialManager table
(`materialFriction 0.1`, `materialResistance 0.1`). The impact effects exist and
are named: `e_waterimpact` (`Objects/Effects/e_waterImpact/Effects.con`, an
`EffectBundle` of `Em_WaterImpact` + `Em_WaterSprite`, `timeToLive 1.8`, with its
own `loadSoundScript Sounds/e_waterimpact.ssc`), plus `e_richoWater`,
`e_RichoWaterHeavy`, `WaterWaterExplosion`, `WaterExplosionTorpedo`,
`e_WaterExplosion`. `Em_WaterSprite` even declares
`ObjectTemplate.moveToWaterSurface 1` — the engine snaps the spray to the
surface (31 templates use this).

A Sherman round into water resolves today, in one line of existing code:

```python
t.effects[(236, 1)]   # -> 'e_waterimpact'
```

**Current state.** `extract_map.py:1445` writes `"waterLevel"`;
`extract_map.py:1306-1321` builds the water quad with `extras.kind = "water"`.
`gunfire.js` references neither.

**Size.** S for the plane test (it is a single `y` comparison), M with the
authored bundle baked (gap M-1 machinery).

**Impact.** Wake, Midway, Coral Sea, Guadalcanal, Iwo Jima and Omaha are mostly
water. Firing over the sea currently shows nothing at all.

---

## GAP C-7 — No hit detection against vehicles or soldiers

**Gap.** The model browser can compute what a round *would* do to a clicked
armour face, but no round ever strikes a vehicle.

**Current state.** `viewer/index.html` builds a full armour inspector on top of
the collision meshes:
- `index.html:2018-2044` `collectCollisions` indexes every mesh whose
  `geometry.userData.collision` is set.
- `index.html:1677` `isCollisionMesh`; `:1989-2008` `applyCollisionState` shows /
  filters them; `:1892-1958` `configureCollisionLegend` ranks them by damage.
- `index.html:2340-2360` builds `lastHit` from `hit.object.geometry.userData.defenseMaterial`.
- `index.html:2435-2444` — the raycaster is driven by **`pointerdown` on the
  canvas**, i.e. the mouse, and the only thing it intersects at `:2447` is the
  angle-drag handle.
- `shoot.mjs:35,158-164` `--collision` is a screenshot mode for that inspector;
  it asserts exported collision geometry exists and records the selected-point
  marker. Nothing fires.

So the pieces are in the same page but never meet: `GunFire` spawns rounds into
`scene`, `collisionTargets` sits in a parallel array, and no code closes the gap.

**Size.** M. Needs the round's per-frame segment tested against
`collisionTargets` (they are already three.js meshes with material ids in
`geometry.userData`), then `damageTables` — already fetched at
`index.html:1683` — turned from a click handler into a hit handler.

**Impact.** High for the model browser, which advertises an armour simulator.
The formula, the tables and the geometry are all there; only the trigger is
missing.

---

## Design sketch — landing collision (the keystone)

**1. Extractor.** In `bf42/assemble.py`, resolve the collision mesh from the
LodObject's *highest-detail* alternative rather than the selected one
(gap C-3), and emit both layers rather than only the last:

```python
# _collision_mesh_indices today keeps `mesh.collision_layers[-1]` (assemble.py:492)
# Emit instead:
#   layer 0 -> extras {"collision": true, "collisionRole": "coarse",   "collisionLayer": 0}
#   layer 1 -> extras {"collision": true, "collisionRole": "detailed", "collisionLayer": 1}
# keeping the existing per-material primitive split and `defenseMaterial`.
```
Then flip `extract_map.py:1565` to `include_collision=True`. Optionally gate it
behind `--collision` so existing map GLBs stay byte-identical until the viewer
can use them.

**2. scene.json schema.** Three additions, all small:

```jsonc
{
  "collision": {
    "layers": 2,                       // for the viewer's LOD choice
    "triangles": 5047,                 // budget, for the load-progress bar
    "materials": [8, 81, 90, 96, 100, 102, 118]   // ids actually present on this map
  },
  "terrain": { "...": "...", "materialMap": "terrain/materials.png" },  // gap M-2
  "damage": {                          // gap M-1
    "materials": { "10": {"label": "Dry sand (El Alamein)", "attGroup": 10, "defGroup": 10, "damage": 30} },
    "modifiers": { "236": {"50": 10} },
    "effects":   { "236": {"10": "GroundExplDry", "1": "e_waterimpact", "92": "Exp2CascadesStone"} }
  }
}
```

Node extras gain `collision`, `collisionRole`, `collisionLayer` (already emitted
by `assemble.py:1458-1467`) plus `hasCollisionPhysics` and `collisionGroups`
(gap C-4).

**3. Viewer.** On load, walk nodes with `extras.collision`, take
`collisionRole === "detailed"` where present (falling back to `"coarse"`), and
build one static BVH over their world-space triangles, keeping a parallel
`Uint8Array` of `defenseMaterial` per triangle. Terrain stays a separate
heightfield query (`map.html:1930`, already written) because a regular grid beats
a BVH for it, and water is a plane test. Per round per frame, test the segment
`[previous, current]` against terrain → water → BVH in that order (cheapest
first), and on a hit look up
`damage.effects[projectile.material][faceMaterial]` to pick the bundle.

**Budget check.** 2.4k–7.2k collision triangles per map (table in C-2); a static
BVH over that is sub-millisecond to build and a few microseconds per query.
Rounds in flight are capped at tens. There is no performance question here.

**Order.** C-3 → C-2 → C-5 (terrain only, proves the loop end-to-end with the
cheapest test) → C-6 → C-1/C-7 → M-1.

---

# 2. Impact effects and materials

## GAP M-1 — The impact-effect table is parsed and then discarded

**Gap.** `damage.py` reads every `MaterialManager.setEffectTemplate` into
`DamageTables.effects`, and `as_dict()` never emits it. The viewer has no impact
effects because the data never reaches it, not because it is hard to get.

**Ground truth.** `Archives/bf1942/Game.rfa`:

| file | role |
|---|---|
| `Bf1942/Game/materialManagerdefine.con` (26,221 B, 926 lines) | 160 `MaterialManager.material` blocks, **155 distinct ids in 0..257**, each with `materialAttGroup`, `materialDefGroup`, `materialDamage`, and for 20 of them `materialFriction` / `materialElasticity` / `materialResistance` |
| `Bf1942/Game/materialManagerSettings.con` (102,341 B, 4,574 lines) | 1,076 terrain cells, then `run damage_system/*` ×50 and `run Collision_Armor/*` ×5 |
| `Bf1942/Game/damage_system/*.con` (42 files) | per weapon: `attGroup` / `defGroup` / `damageMod` / `setEffectTemplate` |
| `Bf1942/Game/collision_Armor/*.con` (7 files) | the same shape for object-on-object collision |

Command histogram over `Game.rfa`: `attGroup` 6,724 · `defGroup` 6,721 ·
`damageMod` 6,721 · **`setEffectTemplate` 4,977** · `material` 169 ·
`materialDamage` 166 · `setCell` 9.

After last-wins resolution that is **5,165 `(att, def)` damage cells and 4,099
`(att, def)` effect cells naming 73 distinct EffectBundles** (76 names appear
across all lines before dedup). Every effect pair also has a damage entry — zero
effect-only pairs.

Material families, from the `rem` headers in `materialManagerdefine.con`:

| range | family |
|---|---|
| 0–15 | terrain: Default, Water, Dry grass, Juicy grass, Dry dirt, Wet dirt, Mud, (7), Gravel, Frozen ground, Dry sand, Wet sand, Rock, Sand Road, Dirt road, Paved road |
| 39–76 | armour classes: 40–42 Infantry, 43–44 scout car, 45–49 Light Vehicle, 50–54 Heavy Vehicle, 55–59 Ship, 60–64 Plane, 65–69 Boat wood, 70 Grenades, 72 PT-boat |
| 79–98 | basic materials: Solid Wood, Wood, Thin Wood, Hollow Wood, Solid Metal, Metal, Thin Metal, Hollow Metal, Solid Stone, Cloth ×3, Concrete, Reinforced Concrete, Flesh, Rubber, Stone/Wood/Iron stairs |
| 100–120, 165–195 | building materials: Exterior/Interior Stone/brick/wooden Wall, fences ×5, Sandbags, Grate, Bamboo walls, Wooden/Stone Floor, Glass Pane, Tree Trunk, Wooden/Metal Door, Wooden/Metal Ladder, Climbing net |
| 199–257 | attacker materials: 199–209 SPLASH DAMAGE, 210 Knives, 213 Airplanes, 214 Pistols, 216 SMG, 218 Rifle, 220 Auto Rifles, 222 Assault Rifles, 224 Machine Guns, 226 Bazookas, 228 AA guns, 230–235 Vehicle guns, 236–239 tank guns by faction/class, 250–255 Naval guns, 257 Bayonet |

A worked resolution — a Sherman round, `material 236`, into five surfaces:

```
att 236 vs def  1 (Water)            mod 0.0   effect e_waterimpact
att 236 vs def 10 (Dry sand)         mod 0.0   effect GroundExplDry
att 236 vs def 80 (Solid Wood)       mod 0.0   effect Exp2CascadesWood
att 236 vs def 85 (Metal)            mod 0.0   effect Exp2CascadesMetal
att 236 vs def 92 (Concrete)         mod 0.0   effect Exp2CascadesStone
att 236 vs def 50 (Sherman rear)     mod 10.0  effect e_ExplArmor
```

Reproduce:

```bash
python3 - <<'PY'
from extract_models import build_pools, mod_chain, DEFAULT_GAME_DIR, load_damage_tables
_,_,objects,game = build_pools(mod_chain(DEFAULT_GAME_DIR,"bf1942"), [])
t = load_damage_tables(game)
print(len(t.materials), "materials;", len(t.modifiers), "modifiers;", len(t.effects), "effects")
print("effects in as_dict?", "effects" in t.as_dict())
for d in (1,10,80,85,92,50): print(236, d, t.modifier(236,d), t.effects.get((236,d)))
PY
# 158 materials; 5165 modifiers; 4099 effects
# effects in as_dict? False
```

Every one of those 73 templates is an `EffectBundle` in `Objects.rfa` of exactly
the shape `assemble.py` **already bakes for muzzle flashes**, and most carry
`loadSoundScript`:

```con
ObjectTemplate.create EffectBundle GroundExplDry        # Objects/Effects/Common/effects.con
ObjectTemplate.addTemplate e_ExplDrySand
ObjectTemplate.addTemplate em_DryDirtSmoke
ObjectTemplate.timeToLive CRD_NONE/1.8/0/0

ObjectTemplate.create EffectBundle e_ExplArmor          # Objects/Effects/e_ExplArmor/Effects.con
ObjectTemplate.loadSoundScript Sounds/e_ExplArmor.ssc
ObjectTemplate.addTemplate Em_ExplArmor_flash
ObjectTemplate.addTemplate Em_ExplArmor_flash1
ObjectTemplate.addTemplate Em_ExplArmor_Cloud
ObjectTemplate.addTemplate Em_ExplArmor_Smoke
ObjectTemplate.addTemplate Em_GibbSmokeSmoke
ObjectTemplate.timeToLive CRD_NONE/1.8/0/0
```

**Current state.**
- `bf42/damage.py:121` declares `effects: dict[tuple[int,int], str]`.
- `bf42/damage.py:308-310` fills it.
- `bf42/damage.py:170-180` `as_dict()` omits it.
- `extract_models.py:632-634` writes `damage.json` from `as_dict()`.
- `viewer/index.html:1683` fetches `damage.json`; `:1707` uses `modifiers`;
  nothing reads effects because nothing is there.
- No map ever gets `damage.json` at all — `extract_map.py` does not call
  `load_damage_tables`.

**Size.** S to emit (one dict comprehension in `as_dict`, plus `damage.json`
alongside `scene.json`). M to *play* — but the EffectBundle baker
(`assemble.py`, the muzzle-flash path from commit `c09ddcc`) and the `.ssc`
player (`viewer/engine-audio.js`, generalised in `69b095d`) both already exist
and were built against the same two formats.

**Impact.** Currently a round that hits something shows and sounds like nothing,
because nothing is hit. Once C-1 lands, this is what makes a hit legible.

---

## GAP M-2 — `Materialmap.raw` is never read, so terrain has no material under a hit

**Gap.** Every level ships a per-sample terrain material id and the extractor
ignores the file. Without it a shell into the ground cannot choose between
`GroundExplDry`, `e_ExplFrozenSnow` and `e_richoWater`.

**Ground truth.** `bf1942/levels/<Map>/Materialmap.raw` is exactly one **byte per
heightmap sample**, same `dim` as `Heightmap.raw`, and the byte is the
MaterialManager terrain id:

| map | world | heightmap | materialmap | distinct ids | dominant |
|---|---|---|---|---|---|
| El Alamein | 2048 m | 524,288 B (512²×2) | 262,144 B (512²) | 6 | **10 Dry sand** (153,912) then 12 Rock (98,634) |
| Wake | 2048 m | 524,288 B | 262,144 B | 5 | **11 Wet sand** (249,019) |
| Berlin | 2048 m | 524,288 B | 262,144 B | 4 | 7 (259,537), 4 Dry dirt, 14 Dirt road |
| Omaha Beach | 2048 m | 524,288 B | 262,144 B | 6 | 7 (216,100), **11 Wet sand** (41,888) |
| Kharkov | 1024 m | 131,072 B (256²×2) | 65,536 B (256²) | 7 | 3 Juicy grass, 7, 12, 5 Wet dirt |

El Alamein being 60 % material 10, which `materialManagerdefine.con` literally
labels *"Dry sand (El Alamein)"*, is the confirmation that the byte is the
material id.

```bash
python3 - <<'PY'
import collections, math
from extract_models import mod_chain, DEFAULT_GAME_DIR
from bf42 import level as lvl
chain = mod_chain(DEFAULT_GAME_DIR,"bf1942")
files = lvl.load_level_files(lvl.find_level_archives(DEFAULT_GAME_DIR,"bf1942","El_Alamein",chain=chain),"El_Alamein")
mm = files.read(files.find("Materialmap.raw"))
print(len(mm), math.isqrt(len(mm)), collections.Counter(mm).most_common())
PY
# 262144 512 [(10, 153912), (12, 98634), (13, 8278), (11, 1307), (8, 10), (2, 3)]
```

`Textures/TerrainPalette.pal` sits beside it. `features/bf1942-3d-models/map-parity.md:230-231`
already flags both as *"parsed by nothing here"* — but frames it as a *texturing*
gap. It is equally a collision gap.

**Current state.** `bf42/level.py` has `Heightmap` / `decode_heightmap`
(`level.py:369-386`, `:980`) and no materialmap reader. `grep -ri materialmap
bf42/ extract_*.py` returns nothing.

**Size.** S. Read the byte array, write it as an indexed PNG next to
`terrain/detail.png`, sample it in the viewer at the terrain hit point.

**Impact.** Medium. It is the difference between every ground impact throwing
the same dust and Omaha's shingle, El Alamein's sand and Kharkov's grass each
behaving as authored.

---

## GAP M-3 — Bullet-hole decals

**Gap.** No decals. Three authored material variants exist and none are built.

**Ground truth.** 15 decal templates, in three families:

```
EffectBundle RichoMetalDecal  -> e_RichoMetalDecal -> Em_RichoMetalDecal -> Fx_RichoMetalDecal -> SimpleObject Decal_metal_m1
EffectBundle RichoStoneDecal  -> e_RichoStoneDecal -> Em_RichoStoneDecal -> Fx_RichoStoneDecal -> SimpleObject Decal_Stone_m1
EffectBundle RichoWoodDecal   -> e_RichoWoodDecal  -> Em_RichoWoodDecal  -> Fx_RichoWoodDecal  -> SimpleObject Decal_Wood_m1
```

```con
# Objects/Effects/e_Decal_Stone/effects.con
ObjectTemplate.create Emitter Em_RichoStoneDecal
ObjectTemplate.template Fx_RichoStoneDecal
ObjectTemplate.startProbability 1
ObjectTemplate.lodDistance 800
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/2/0/0
ObjectTemplate.relativePositionInUp CRD_NONE/0.001/0/0   <- the 1 mm lift off the surface
```

They are wired into the matrix like any other impact effect:
`RichoWoodDecal` 160 cells, `RichoMetalDecal` 93, `RichoStoneDecal` 90.

**Current state.** No decal path in `gunfire.js` or `map.html`. The decal bodies
are `SimpleObject`s with real geometry, so the existing mesh assembler could bake
them the same way it bakes `projectileMesh`.

**Size.** M — a pooled decal ring buffer with a depth-offset and a lifetime,
plus the bake.

**Impact.** Medium-high once C-1/C-7 land. A wall that shows where you shot it
is the cheapest possible proof that collision is real.

---

## GAP M-4 — Material physical properties (`friction` / `elasticity` / `resistance`) are dropped

**Gap.** `damage.py` reads `materialDamage` and ignores the three physics
numbers on the same block.

**Ground truth.** 20 materials declare all three (terrain 0–15 plus 70, 72,
96–98):

```con
rem Dry sand (El Alamein)
MaterialManager.material 10
MaterialManager.materialDamage 30
MaterialManager.materialFriction 0.8
MaterialManager.materialElasticity 0
MaterialManager.materialResistance 0.05

rem Grenades
MaterialManager.material 70
MaterialManager.materialFriction 2.0
MaterialManager.materialElasticity 2.0    <- why a grenade bounces
MaterialManager.materialResistance 2.0
```

**Current state.** `bf42/damage.py:294-297` handles `materialdamage`; the
`Material` dataclass (`damage.py:44-56`) has no friction/elasticity/resistance
field, and the `elif` chain at `damage.py:286-310` has no branch for them.

**Size.** S (three fields, three branches, three dict keys).

**Impact.** Low on its own; it is what a future ricochet or grenade-bounce would
need, and it also governs ground handling for vehicles.

---

## Closed: `setMaterialFilter` and friends — N/A

`setMaterialFilter` / `MaterialFilter` / `setDefensiveMaterial` / `setMaterial` /
`material.create` have **zero hits across all 74 archives** (command above). The
BF1942 equivalents, all of which *are* covered by the gaps above:

- attacker side → `ObjectTemplate.material` (137 lines) / `material2` (49)
- defender side → the `.sm` collision face byte, or `ObjectTemplate.Material` on
  the target (12 lines, e.g. `Objects/Soldiers/Common/CommonSoldierData.inc:37 ::
  ObjectTemplate.Material 40`)
- effect gating → `ObjectTemplate.addWorkOnMaterial`, **48 lines, terrain ids
  1–15 only**, on 9 dust/spray bundles (`e_wdustPanz`, `e_WaterTouchPlane`,
  `e_wdirtPanz`, …). This *is* a real material filter, and `con.py` does not
  parse it — S-sized, folded into M-2.

---

# 3. Projectile flight

## GAP P-1 — Drag, deviation and `endEffectTemplate` are never parsed

**Gap.** Three real, shipped projectile properties have no branch in `con.py`.

**Ground truth.**

- **`ObjectTemplate.drag`** — 172 lines, of which **9 on `Projectile`**:
  `Torpedo 0.08`, `AircraftTorpedo 0.04`, `PTBoatTorpedo 0.04`,
  `FighterBomb 0.08`, `DiveBomberBomb 0.08`, `HeavyBomberBomb 0.08`,
  `KatyushaRocket 1.0`, `DepthCharge 5`, `FloatingMine 50`. (`setDragModifier`
  exists but only on 3 `FloatingBundle` torpedo floaters at `8000.0`.)
- **Deviation is data-driven after all** — the brief's `setDeviation` does not
  exist, but a whole family does, on `HandFireArms` and `FireArms`:

  | command | lines | example |
  |---|---|---|
  | `setMinDev` | 30 | `Objects/Stationary_Weapons/Mg42/Objects.con :: setMinDev 0.7` |
  | `setFireDev` | 24 | `Objects/HandWeapons/Bar1918/Objects.con :: setFireDev 3.5 0.25 0.03` |
  | `setSpeedDev` | 16 | `... :: setSpeedDev 2.25 0.2 0.2 0.1` |
  | `setMiscDev` | 16 | `... :: setMiscDev 2.5 2.5 0.1` |
  | `setTurnDev` | 14 | `... :: setTurnDev 0 0 0 0` |
  | `setDevMod` | 12 | `Objects/HandWeapons/K98/Objects.con :: setDevMod 1 0.7 0.5` |
  | `addDevFire` | 7 | `Objects/HandWeapons/Bazooka/Objects.con :: addDevFire 0.08` |
  | `minDeviation` / `maxDeviation` | 4 / 4 | `Bazooka :: maxDeviation 0.5`, `GrenadeAllies :: maxDeviation 0.08` |

  Vehicle guns carry it too: `Coaxial_browning setMinDev 0.75`,
  `fletcher_GunBarrel setMinDev 1`, `PrinceOW_CannonPipes4 setMinDev 2`,
  `YamatoFatCannon setMinDev 2`. So a battleship's main battery has a 2-degree
  cone and the viewer fires it as a laser.
- **`ObjectTemplate.endEffectTemplate`** — 15 `Projectile` templates, the
  detonation bundle: `Torpedo/AircraftTorpedo/PTBoatTorpedo → WaterExplosionTorpedo`,
  `DepthCharge/FloatingMine → e_WaterExplosion`,
  `AA_Allies_Projectile/Flak38_Projectile/Carrier_AA_Projectile/AA_POW_Projectile/YamatoProjectile → e_FlakBig`,
  `Defgun_Projectile → e_ExplDirt`,
  `ExpPack/Grenade*/Landmine → e_ExplGranade`.

**Current state.** `bf42/con.py:610-667` parses `gravityModifier`, `timeToLive`,
`velocity`, `magSize`, `tracerScaler`, `setEngineType`, `startEffectTemplate`,
`visibleDummyProjectileTemplate`. It has **no branch** for `drag`, any deviation
command, or `endEffectTemplate`. `damage.py:335-353` does not read them either.

**Size.** S for parsing and for the `projectile` dict in the node extras; S again
for the viewer (`drag` is one term in the integrator; deviation is a per-shot
cone on the muzzle direction). M only if `setFireDev`'s three-parameter
accumulate/decay model is reconstructed faithfully — its exact semantics
(spread-per-shot, decay rate, cap?) are **UNVERIFIED** and would want the binary.

**Impact.** Medium. A held MG burst currently walks into a single pixel; in game
it opens up. The AA guns' airburst (`e_FlakBig` at end of flight) is entirely
missing.

---

## GAP P-2 — Flight constants are invented where the data is authored

**Gap.** The viewer's rocket acceleration, gravity handling and display speed
are hardcoded constants rather than derived values, and the comments say so.

**Ground truth / current state.**

| viewer constant | `gunfire.js` | authored source |
|---|---|---|
| `ROCKET_ACCEL = 25` m/s² | `:65` | nothing — `c_ETRocket` appears **once** in the game (`Objects/Vehicles/Land/KatyushaRocket/Physics.con:8`); the real thrust would come from the Engine template + `mass 20` + `drag 1.0` |
| `GRAVITY`, imported from `physics.js` | `:40` | **closed.** Was a local `9.81`; it is the engine's signed `-14.73` now (`BasicPhysicsSystem` ctor, `0x00578f00`), taken from the module that owns the constant. Still open on the same row: `spec.gravity` multiplies it only for `kind === 'shell'` — rockets are pinned to `gravity: 0` regardless of their own `gravityModifier`, so the Katyusha's declared default of 1 is ignored |
| `TRACER_SPEED_SCALE = 0.15`, `PROJECTILE_SCALE_CUTOFF = 150` | `:37-38` | a deliberate display hack for the turntable; `map.html` passes `speedScale: 1`. A round slowed in speed alone is not slowed in time, so `gravityScale` now carries the square of the applied scale and the slowed round draws the real arc; inert wherever the scale is 1 |
| `TRAIL_PUFF_SPACING = 0.9` m, `MAX_TRAIL_PUFFS = 96` | `:67-68` | the bundle's own emitter `intensity` (particles/second) is parsed for flashes but not used to rate the trail |
| `ttl: Math.min(spec.timeToLive \|\| 10, 20)` | `:502` | clamps the authored value; `KatyushaRocket` declares `timeToLive 20` |
| `maxRange` 250 m (browser) / 1500 m (map) | `:40`, `map.html:1898` | invented; the game ends a round on ttl or a hit |

`ObjectTemplate.mass` (68 lines) and `ObjectTemplate.drag` are both unparsed, so
a physical integrator is not currently possible from the manifest.

**Size.** S–M. Parsing `mass` and `drag` is S; replacing `ROCKET_ACCEL` with a
real thrust model needs the Engine template's own fields and is M.

**Impact.** Low-medium and honestly documented already in
`features/bf1942-3d-models/firing-effects.md`. Listed for completeness, not as a
priority.

---

## Closed: guided weapons — N/A

`Guided`, `setGuided`, `setTurnSpeed`, `numberOfBullets` have zero hits in
vanilla and zero in DesertCombat, FH, FHSW, XPack1 and bf1918. There is no
guided or wire-guided weapon in Refractor 1. Torpedoes are `setEngineType
c_ETTorpedo` (2 templates) and run straight.

---

# 4. Explosions and area damage

## GAP E-1 — No explosion, no splash, no area damage anywhere

**Gap.** Nothing detonates. The splash half of the documented damage formula is
computed by the model browser's inspector (`index.html:1739-1746`
`splashAtCentre`) for a *hypothetical* shot at the blast centre, and never
otherwise.

**Ground truth.** BF1942 splits this in two:

- **Projectile splash.** `ObjectTemplate.material2` (49 templates) is the
  attacker id for the splash pass, and `ObjectTemplate.radius` is its extent —
  29 projectiles declare one:

  ```
  BazookaProjectile 4     ExpPackProjectile 12    Grenade{Allies,Axis}Projectile 15
  LandmineProjectile 4    Torpedo 30              AircraftTorpedo 30
  FighterBomb 20          DiveBomberBomb 20       HeavyBomberBomb 30
  AA_Allies_Projectile 20 Defgun_Projectile 12    Flak38_Projectile 20
  KatyushaRocket 15       M10/Priest/Sexton/WespeProjectile 15
  DepthCharge 100         PTBoatTorpedo 30        FloatingMine 15
  Fletcher/HatsuzukiProjectile 10                 POWProjectile 20
  ```
  `material2 -1` (17 fighter-MG projectiles, e.g.
  `Objects/Vehicles/Air/bf109/Weapons.con:33`) means "no splash pass".
  The formula is `materialDamage(att2) * damageMod(att2, splashMaterial) * (1 - d/radius)`
  and is already implemented at `bf42/damage.py:158-168`.

- **Vehicle death blast.** `ObjectTemplate.explosionRadius` (35 templates) and
  `explosionDamage` (49) live on the `PlayerControlObject`, not on a projectile —
  `Objects/Vehicles/Land/Sherman/Objects.con:15-16` is `explosionRadius 8` /
  `explosionDamage 5`, with `explosionForceMod 13` at `:29`. Nearly every vanilla
  vehicle is 8/5; Elco80 and Type38 are 5/5; the Battle of Britain factory is
  `explosionRadius 20`.

**Current state.**
- `bf42/con.py` parses **none** of `explosionRadius`, `explosionDamage`,
  `explosionForceMod`, `material2`, `radius`.
- `bf42/damage.py:335-343` does read `material2` and `radius` — but only into
  `damage.json`'s weapon list, which only `index.html` consumes, and only for the
  static inspector.
- `gunfire.js` has no explosion path at all.

**Size.** M. Blocked on C-1 (nothing detonates until something is hit).

**Impact.** High once collision lands: a Katyusha rocket arriving with no
explosion would be worse than one that vanishes.

---

## Closed: splash damage through cover — UNVERIFIED, and not in the data

Nothing in the shipped `.con` data expresses an occlusion or line-of-sight test
for splash. Whether Refractor traces from the blast centre to each victim, or
applies `1 - d/radius` unconditionally, is **UNVERIFIED** — the tutorial formula
at `bf42/damage.py:13-14` has no occlusion term. Settling it requires the
`BF1942.exe` corpus. Treat unconditional falloff as the honest default.

---

# 5. Damage model

## GAP D-1 — `damage.py` is an offline calculator; nothing in the world uses it

**Gap.** The damage system is fully extracted and correctly implemented — and is
reachable only through a click in the model browser. No map ever loads it and no
projectile ever consults it.

**Ground truth / current state.** Extracted and working:
`materialManagerdefine.con` → 158 materials; `damage_system/*` +
`Collision_Armor/*` → 5,165 modifiers from 41 scripts, 10 `run` targets absent
(the XPack-only ones, correctly recorded as `missingScripts`); 100 weapons joined
by `projectileTemplate`. `index.html:1680-1746` re-implements
`direct = materialDamage(att) * damageMod(att,def) * cos(angle) * distanceMod`
faithfully in JS.

But `extract_map.py` never calls `load_damage_tables` (grep confirms), so
`damage.json` exists only under the models tree, and `map.html` never fetches it.

**Size.** S to ship `damage.json` per map (or once, shared). M to use it.

**Impact.** Invisible today; it is the payload that makes C-1/C-7 mean something.

---

## GAP D-2 — `addArmorEffect` — the entire damage-state ladder — is unparsed

**Gap.** BF1942's smoke/fire/death-effect system is `addArmorEffect`, and
`con.py` has no branch for it. 433 lines across 55 templates are discarded.

**Ground truth.** `Objects/Vehicles/Land/Sherman/Objects.con:21-37`:

```con
ObjectTemplate.hasArmor 1
ObjectTemplate.hitpoints 100
ObjectTemplate.maxhitpoints 100
ObjectTemplate.material 50
ObjectTemplate.criticalDamage 12
ObjectTemplate.hpLostWhileCriticalDamage 1.5
ObjectTemplate.hpLostWhileUpSideDown 10
ObjectTemplate.hpLostWhileDamageFromWater 10
ObjectTemplate.addArmorEffect 50 e_PanzDamage 0/0.9/-1.8
ObjectTemplate.addArmorEffect 12 e_PanzFire   0/1.2/-1.4
ObjectTemplate.addArmorEffect  0 e_ExplGas    0/0/0
ObjectTemplate.addArmorEffect  0 e_scrapmetal 0/0/0
ObjectTemplate.addArmorEffect -1 WaterWaterExplosion 0/0/0
```

Grammar: `addArmorEffect <hpThreshold> <effectTemplate> <x/y/z offset>`.
Threshold `0` is the death effect (this is the `explosionTemplate` /
`setDeathEffect` the brief asked for — neither spelling exists; `deathEffectName`
occurs exactly once, `Objects/Vehicles/Sea/AA_Enterprise/Objects.con`).
Threshold `-1` is the underwater variant. So a Sherman smokes below 50 HP,
burns below 12, and at 0 throws `e_ExplGas` + `e_scrapmetal`.

**Current state.** `bf42/con.py:572-594` parses `hasArmor`, `material`,
`hitpoints`, `maxhitpoints`, `criticalDamage`, `hpLostWhileCriticalDamage`.
`assemble.py:1650-1663` forwards them for the root template only, into
`report.armor`. `addArmorEffect`, `hpLostWhileUpSideDown`,
`hpLostWhileDamageFromWater`, `damageFromWater`, `hasOverDamage`,
`timeToLiveAfterDeath`, `sinkInToLandAfterDeathSpeed` have no branch.

**Minor labelling bug spotted in passing.** `assemble.py:1657` exports
`template.material` as `"splashMaterial"`. On a `PlayerControlObject`,
`ObjectTemplate.material` is that object's **defending** material (Sherman = 50)
— exactly what `damage.py:5-9` documents. The splash material is the
*projectile's* `material2`. `index.html:1741` then reads `report.armor.splashMaterial`
and feeds it to `damageMod(weapon.material2, splashMaterial)`, which happens to
be the right pairing, so the number is correct and only the name is wrong.

**Size.** S to parse, M to play (needs gap M-1's bundle baker).

**Impact.** Medium. A burning tank is one of BF1942's signature images and there
is currently no damage state of any kind.

---

## GAP D-3 — `hasDestroyedLod` is inferred from a name instead of read

**Gap.** The engine flags the destroyed alternative on the `LodSelectorTemplate`;
the repo guesses it from the child template's name.

**Ground truth.** 34 `LodSelectorTemplate.hasDestroyedLod 1` declarations in
`Objects.rfa` — 13 aircraft, 20 land vehicles, and `window_M1`. The Sherman
chain, `Objects/Vehicles/Land/Sherman/Objects.con`:

```con
ObjectTemplate.create LodObject lodSherman
ObjectTemplate.addTemplate ShermanComplex
ObjectTemplate.addTemplate ShermanSimple
ObjectTemplate.addTemplate ShermanWreck
ObjectTemplate.lodSelector ShermanLodSelector
...
ObjectTemplate.create SimpleObject ShermanWreck
ObjectTemplate.geometry Wreck_Sherman_m1
...
LodSelectorTemplate.create DistCompareSelector2 ShermanLodSelector
LodSelectorTemplate.hasDestroyedLod 1
LodSelectorTemplate.addLodDistance 135
```

`hasDestroyedLod 1` says the **last** alternative is the destroyed one.

**Current state.** `bf42/con.py:706-724` handles only `addloddistance` and
`addlodcomparison`; the `LodSelector` dataclass (`con.py:151-179`) has no field
for `hasDestroyedLod`, and `tests/test_con.py:230` feeds the line in without
asserting anything about it. The wreck is instead found by
`lod_alternative_role` (`con.py:182-195`) testing `"wreck" in name`.

Measured against all 34 flags this is right **33 times and wrong once**:
`lodWindow` (`Objects/MOVE_FILES/window_M1/Objects.con`) names its destroyed
alternative `WindowBroken`, so the role comes back `None`,
`available_configurations` never reports `"wreck"`, and `select_lod_alternative`
falls back to `children[0]` = `WindowWhole`.

**Size.** S.

**Impact.** Low in vanilla (one miss, on a dead asset). Higher for mods, where
naming conventions vary — worth fixing as a correctness matter rather than a
visible one.

---

## GAP D-4 — `collect_weapons` does not strip `beginrem` blocks

**Gap.** `damage.py`'s weapon scanner reads commented-out data as live.

**Ground truth.** `Objects.rfa` has 14 `beginrem … endrem` blocks containing
weapon/damage fields, e.g. `Objects/HandWeapons/Sg44/Weapons.con:1-17` declares a
dead `sg44Projectile` with `material 216`, while the live one
(`Objects/HandWeapons/Common/Weapons.con:210-223`) is `material 223`.

**Current state.** `damage.py:369` iterates `text.splitlines()` directly;
`ObjectLibrary.add_con` at `con.py:480` calls `strip_comments` and `collect_weapons`
does not. In vanilla the output is byte-identical either way — `projectiles.setdefault`
(`damage.py:384`) is first-wins and archive iteration order happens to reach the
live template first — but that is luck, not correctness.

```bash
python3 - <<'PY'
from extract_models import build_pools, mod_chain, DEFAULT_GAME_DIR
from bf42.con import strip_comments
from bf42.damage import collect_weapons
_,_,objects,_ = build_pools(mod_chain(DEFAULT_GAME_DIR,"bf1942"), [])
s = {n: objects.try_read(n).decode('latin-1') for n in objects.names()
     if n.lower().endswith('.con') and objects.try_read(n)}
a = {w.name: w.as_dict() for w in collect_weapons(s)}
b = {w.name: w.as_dict() for w in collect_weapons({k: strip_comments(v) for k,v in s.items()})}
print(len(a), len(b), [k for k in a if a[k] != b.get(k)])
PY
# 100 100 []
```

**Size.** S (one call).

**Impact.** Zero today, latent for mods.

---

# 6. Destructible objects in levels

## GAP X-1 — Destructible statics are level-local `PlayerControlObject`s, and none are exported as destructible

**Gap.** The map extractor treats every static as permanent scenery; it does not
record which ones have hit points, what they become, or that they become
anything.

**Ground truth.** **No template in `Objects.rfa` under `Objects/Buildings/*` (396
files) or `Objects/Vegetation/*` (229 files) declares `hasArmor`.** Vanilla
buildings are indestructible. The only armoured non-vehicle templates in
`Objects.rfa` are `Stationary_Browning` / `Stationary_MG42` (hp 45, material 45),
the dev asset `explFire_Test_m1` (hp 2, material 40), and `window_M1`.

`window_M1` is the one true destructible static and it is **unreferenced** — no
level's `StaticObjects.con` places it and no `Objects.con` addTemplates it. Dead
content:

```con
# Objects/MOVE_FILES/window_M1/Objects.con
ObjectTemplate.create Bundle Window_m1
ObjectTemplate.hasArmor 1
ObjectTemplate.maxhitpoints 1
ObjectTemplate.Material 41
ObjectTemplate.addArmorEffect 0 e_ExplWindow 0/0/0
ObjectTemplate.stayAsDestroyed 1
ObjectTemplate.noCollisionsAsDestroyed 1
LodSelectorTemplate.create DistCompareSelector2 WindowLodSelector
LodSelectorTemplate.hasDestroyedLod 1
ObjectTemplate.addTemplate WindowWhole     # geometry windowWhole_M1
ObjectTemplate.addTemplate WindowBroken    # geometry windowBroken_M1
```

The real destructible statics live **inside level archives**, declared as
`PlayerControlObject` precisely because only PCO carries the armour machinery —
all in `Battle_of_Britain.rfa`:

| template | archive path | hp | material | wreck lifetime |
|---|---|---|---|---|
| `Britain_Factory` | `bf1942/Levels/Battle_of_Britain/Objects/Britain_Factory/Objects.con` | 1000 | 45 | `timeToLiveAfterDeath 10` |
| `Factory_Objective` | `.../Objects/ObjectiveFactory/Objects.con` | 1000 | 45 | |
| `Britain_Factory_AI` | `.../Objects/Britain_Factory_AI/Objects.con` | 1000 | 45 | |
| `RadarTower` + 4 named variants | `.../Objects/RadarTower/Objects.con` | 600 | 45 | `timetoliveafterdeath 9999` (permanent) |

```con
# bf1942/Levels/Battle_of_Britain/Objects/RadarTower/Objects.con:7-16
ObjectTemplate.explosionRadius 8
ObjectTemplate.explosionDamage 5
objectTemplate.criticalDamage 20
ObjectTemplate.HasArmor 1
ObjectTemplate.HitPoints 600
ObjectTemplate.Material 45
ObjectTemplate.timetoliveafterdeath 9999
...
ObjectTemplate.addTemplate RadarTowerComplex / RadarTowerSimple / RadarTowerWreck
LodSelectorTemplate.hasDestroyedLod 1
```

Truk's `Elco80`/`Type38` (hp 500) and Caen's `Pak40` (hp 50) / `CDNRaft` are the
other level-local armoured objects, but those are vehicles.

Separately, `standardMesh.rfa` ships **pre-authored destruction-state meshes**
that nothing in the pipeline is aware of: `bunker2_des1_m1.sm`,
`bunker2_des2_m1.sm` (both with full collision layers), the
`ruin_suburbhouse_*`/`ruin_stalingrad*`/`ruin_citymesh*` family, and the
`wreck_t34*` / `b17_wreckfuse1` bodies.

**Current state.** `extract_map.py` (via commit `0380713`, `add_level_objects`)
does resolve level-local ObjectTemplates, so Battle of Britain's factories and
radar towers *are* placed. But their `hitpoints` / `Material` / `hasDestroyedLod`
reach nothing: `con.py` parses hitpoints (`:579-594`) but `extract_map.py` never
writes them into `scene.json`, and node extras (verified above) carry no armour
keys at all.

**Size.** M. Extractor: export `{hitpoints, criticalDamage, material,
hasDestroyedLod, wreckTemplate, timeToLiveAfterDeath}` per placed static, and
bake the wreck alternative as a hidden sibling (the mechanism already exists —
`MODEL_CONFIGURATIONS = ("complex", "wreck")` at `con.py:83`). Viewer: swap on
zero HP.

**Impact.** Medium, and map-specific. Battle of Britain's whole objective is
destroying factories and radar towers; today they are scenery.

---

# 7. Debris, decals, craters

## GAP X-2 — Gibs and scrap are never spawned

**Gap.** The debris system is fully authored and entirely absent.

**Ground truth.** 71 gib/scrap templates. Ten are real physics bodies with
geometry — `Gibb_concret20_m1`, `Gibb_concret45_m1`, `Gibb_concret60_m1`,
`Gibb_wood20/40/72/90_m1`, `Gibb_Mroof15/30/30_nc_m1` — plus
`scrap_metal1/2/3_m1`:

```con
# Objects/MOVE_FILES/Gibb_concret20_m1/Objects.con
ObjectTemplate.create SimpleObject Gibb_concret20_m1
ObjectTemplate.geometry Gibb_concret20_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.setHasResponsePhysics 1
ObjectTemplate.hasMobilePhysics 1
ObjectTemplate.destroyed 1
ObjectTemplate.timeToLiveAfterDeath  3
ObjectTemplate.fadeAtTimeToLiveAfterDeath 1
ObjectTemplate.timeToStartFadeAfterDeath 1
ObjectTemplate.sinkInToLandAfterDeathSpeed 10
```

The rest are the emitters that throw them (`Em_ScrapMetal_Corsair`,
`Em_ScrapAAFlak38_*`, `Em_GibbPlaneSm_01..04`) and the smoke that accompanies
them (`e_GibbSmokeMetal/Stone/Wood/Plane`), all reached from `addArmorEffect 0`
(gap D-2). Counts: `destroyed` 34, `timeToLiveAfterDeath` 17,
`sinkInToLandAfterDeathSpeed` 28.

**Current state.** None of `destroyed`, `timeToLiveAfterDeath`,
`sinkInToLandAfterDeathSpeed`, `fadeAtTimeToLiveAfterDeath`,
`timeToStartFadeAfterDeath` has a branch in `bf42/con.py`.

**Size.** M, blocked on D-2 and C-1.

**Impact.** Medium — this is what a destroyed thing *looks* like.

---

## GAP X-3 — Craters and terrain deformation

**Gap.** None exist in the viewer.

**Ground truth.** **Refractor 1 has no terrain deformation.** There is no
authored crater mesh, no heightmap-write command, and no `deformTerrain`-style
property anywhere in the archives. Ground impacts are represented by the
particle bundles of gap M-1 (`GroundExplDry`, `e_ExplDrySand`, `MajorImpact_Sand`
/ `_Stone` / `_Metal`) and — on hard surfaces — by the ricochet decals of gap
M-3. Craters as persistent geometry are **not a parity gap; they never existed.**

**Current state.** N/A.

**Size.** N/A — closed.

**Impact.** None. Recorded so the question is not re-asked.

---

# Priority table

Sorted by impact ÷ size. "Blocked-by" is a hard dependency, not a preference.

| # | Gap | Size | Impact | Blocked by |
|---|---|---|---|---|
| 1 | **C-3** Collision resolved from the wrong LOD alternative (`_m2` has none) | S | Silent total failure of C-2 on European maps | — |
| 2 | **C-2** `include_collision=False` on every map export (`extract_map.py:1565`) | S (extractor) | Keystone; unblocks everything | C-3 |
| 3 | **M-1** 4,099 impact-effect pairs parsed then dropped (`damage.py:170-180`) | S to emit | Hits become legible; 73 authored bundles + sounds unlock | — (emit) / C-1 (play) |
| 4 | **C-5** Terrain raycast exists, wired only to the aircraft (`map.html:1930`) | S | Shells stop in the ground — highest visible return per line | C-2 or none |
| 5 | **C-6** No water surface test, no splash | S | Six of 23 vanilla maps are mostly water | M-1 for the bundle |
| 6 | **M-2** `Materialmap.raw` never read (1 B/sample, ids 0–15) | S | Ground impacts match the authored surface | M-1 |
| 7 | **C-1** No projectile collision loop at all (`gunfire.js:620-674`) | L | The headline complaint | C-2, C-5 |
| 8 | **D-1** `damage.py` never reaches the map | S ship / M use | Makes a hit mean something | C-1 |
| 9 | **P-1** `drag`, deviation family, `endEffectTemplate` unparsed | S | MG cones, AA airbursts, torpedo detonations | — |
| 10 | **C-7** No hit detection vs. vehicles/soldiers | M | The model browser already advertises the calculator | C-2 |
| 11 | **E-1** No explosion / splash (`radius` on 29 projectiles, `material2` on 49) | M | Rockets and bombs need it or C-1 looks worse | C-1 |
| 12 | **D-2** `addArmorEffect` ladder unparsed (433 lines / 55 templates) | S parse / M play | Burning and smoking vehicles | M-1 |
| 13 | **M-3** Bullet-hole decals (3 material families, 15 templates) | M | Cheapest proof collision is real | C-1 |
| 14 | **X-1** Destructible level statics not exported as destructible | M | Battle of Britain's objective | C-1, D-1 |
| 15 | **C-4** `hasCollisionPhysics` / collision groups dropped | S | Fences and ladders behave wrongly | C-2 |
| 16 | **X-2** Gibs and scrap never spawned (71 templates) | M | What a destroyed thing looks like | D-2, C-1 |
| 17 | **D-3** `hasDestroyedLod` inferred from name (33/34 in vanilla) | S | Correctness; matters for mods | — |
| 18 | **M-4** `materialFriction/Elasticity/Resistance` dropped (20 materials) | S | Future ricochet / grenade bounce | — |
| 19 | **P-2** Hardcoded `ROCKET_ACCEL`, ttl clamp, range caps | S–M | Already documented; low return | — |
| 20 | **D-4** `collect_weapons` does not strip `beginrem` | S | Zero today, latent for mods | — |

**Closed as N/A (verified absent from the engine's data):** `setMaterialFilter`
and the whole `set*` vocabulary in the brief · guided / wire-guided weapons ·
`numberOfBullets` · three collision LODs (max is 2, across 17 mods) · `.cm` files
· `NonVisibleObject` / `setCollisionMesh` · terrain deformation and craters.

**Left UNVERIFIED (would need the `BF1942.exe` corpus):** which collision layer
the engine uses for which query · `c_CGProjectiles` / `c_CGLadders` semantics
(whitelist vs. additive mask) · whether splash damage is occluded by cover ·
`setFireDev`'s three-parameter accumulate/decay model.

---

# Already covered — checked and found done

So the next reader does not re-report these:

- **Projectile taxonomy.** Bullet / shell / rocket typing from geometry presence
  plus a child `c_ETRocket` Engine — `assemble.py`, commit `4df314e`, documented
  in `features/bf1942-3d-models/firing-effects.md`.
- **Muzzle velocity, `timeToLive`, `gravityModifier`, `tracerScaler`, tracer
  interval, `roundOfFire`, `magSize`, recoil, `visibleDummyProjectileTemplate`,
  `startEffectTemplate`** — all parsed (`con.py:301-332`, `:610-667`) and flown
  (`gunfire.js:483-508`).
- **Muzzle flash fidelity.** Additive blending from `.rs` `blendSrc/blendDest`
  (`rs.py`), emitter drift via `positionalSpeedInDof` / `relativePositionInDof`
  (`gunfire.js:569-574`), `sizeOverTime` / `colorRGBAOverTime` replay with a 3×
  clamp (`gunfire.js:561-581`), first/third-person emitter selection
  (`gunfire.js:347-350`).
- **Tracer visibility.** Real `TLight_m1` baked, `tracerScaler 50` applied
  uniformly, screen-space width floor — commit `69b095d`, `gunfire.js:414-481`.
- **Barrel alternation and convergence.** `addFireArmsPosition` ypr toe-in;
  barrels cycle rather than volley (`gunfire.js:340-343`).
- **Gun sound.** `loadSoundScript` walked to FireArms; `.ssc` distance ramps do
  near/far handover (`extract_map.py`, `viewer/engine-audio.js`).
- **The MaterialManager tables themselves.** Located, loaded, and correctly
  implemented — 158 materials, 5,165 modifiers, 41 scripts, 10 correctly-recorded
  missing `run` targets, 100 weapons (`bf42/damage.py`, documented at
  `features/bf1942-3d-models/README.md:730-810`). Only the `effects` half is
  dropped (gap M-1).
- **The armour inspector.** Collision-face selection, per-material damage
  ranking, angle term, shots-to-destroy, splash-at-centre, range slider
  (`viewer/index.html:1677-2360`, README `:653-728`). It is a static calculator,
  which is why C-7 is still a gap.
- **Collision `.sm` parsing.** `stdmesh.py:211-261` reads every layer, vertex,
  face, material and flag, with 0 failures across 1,445 vanilla meshes. The
  format is *not* the gap; the export path is.
- **Terrain heightfield raycast.** Written, correct and cheap
  (`map.html:1925-1951`) — just not used by rounds (gap C-5).
- **Wreck geometry.** `MODEL_CONFIGURATIONS = ("complex", "wreck")`
  (`con.py:83`); `--configuration-all` exports both (README `:183-189`). The
  mesh exists; only the transition is missing (gap X-1).
