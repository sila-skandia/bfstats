# Parity gaps: visual effects, particles, materials and shaders

Audit of what Refractor draws that `tools/bf1942-models/` does not extract or
`viewer/` does not render. Ground truth is the shipped vanilla install at
`~/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/`, read with
`bf42.rfa.RfaArchive`. Nothing here is implemented — this is an inventory.

Everything in `firing-effects.md`, `map-parity.md`, `flythrough-fidelity-gap.md`
and `rendering-technology.md` that is already solved is excluded from the gap
list and collected at the end under **Already covered**.

**The one-line summary.** The pipeline has a *muzzle-flash* extractor, not an
*effects* extractor: `assemble.py` bakes the additive-blended payload of an
EffectBundle reached from a FireArms and discards everything else, so 102 of
vanilla's 216 EffectBundles produce no geometry at all and the remaining 114 lose
their alpha-blended half. Nothing reads the 4,929-row
`MaterialManager.setEffectTemplate` table that decides which impact effect a
given weapon makes on a given surface. On the material side the `.rs` reader
takes 7 of ~16 attributes: `envmap` (494 materials), `materialSpecular` (1,020),
`materialDiffuse` (383 non-white) and `alphaTestRef` (70) are all dropped, and
the `alphaTestRef` drop mis-renders 61 alpha-tested surfaces — 11 of them fully
opaque. Separately, the level reader misses the `renderer.fogStart/fogEnd`
spelling on **8 levels** and `renderer.setFogColorVec` on **2**, so those maps
ship invented atmosphere despite the level declaring a real one.

---

## Reproducing the surveys

```bash
cd /home/dylan/projects/skandia/bfstats/tools/bf1942-models
# the whole effects catalogue as one text blob
python3 -c "
from bf42.rfa import RfaArchive; from pathlib import Path
b=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(b/'Objects.rfa')
for n in sorted(a.entries):
    if '/effects/' in n.lower() and n.lower().endswith('.con'):
        print('=====',n); print(a.read(n).decode('latin-1'))"
```

Counts below come from that dump plus `Bf1942/Game.rfa`, `standardMesh.rfa`,
`StandardMesh_001.rfa`, `treeMesh.rfa`, `shaders.rfa` and the 23 vanilla
`bf1942/levels/*.rfa` (patch archives `*_0NN.rfa` excluded throughout).

---

## The effects catalogue

`Objects.rfa` holds **389 entries under `Objects/Effects/`, in 202 folders**.
Parsed into the project's own `ObjectLibrary`, that is:

| template kind | count | what it is |
|---|---|---|
| `EffectBundle` / `Bundle` | **216** | the addressable effect — a list of emitters + a lifetime |
| `Emitter` | **362** | spawn rate, spawn volume, initial velocity/rotation |
| `SpriteParticle` | **243** | a billboarded textured quad payload |
| `Particle` | **79** | a `.sm` mesh payload (shell casings, water rings, leaves, tracer streaks) |
| `SimpleObject` | 34 | collision proxies for debris |

Only **39 distinct textures** feed all 243 sprite particles, and all 39 resolve in
`texture.rfa` / `texture_001.rfa` — the entire particle art budget of the game is
39 files.

### Category x {defined / extracted / rendered}

"Bakeable" = at least one emitter payload survives `assemble.py`'s additive
filter (`assemble.py:746-761`). "Rendered" is judged against `viewer/map.html`
and `viewer/index.html`, which drive effects only through
`viewer/gunfire.js` — a node is drawn only if it hangs under a `fireArms` node
and a shot strobes it (`gunfire.js:188-213`).

| category | bundles defined | all emitters bakeable | partially bakeable | nothing bakeable | rendered in viewer |
|---|---:|---:|---:|---:|---|
| water splash / wake / bow spray / dive | 31 | 18 | 7 | 6 | **no** |
| explosion (incl. flak bursts) | 25 | 1 | 15 | 9 | **no** |
| impact / ricochet, per material | 24 | 6 | 11 | 7 | **no** |
| vehicle damage smoke | 23 | 0 | 0 | 23 | **no** |
| vehicle fire | 23 | 4 | 16 | 3 | **no** |
| wreck debris / gibs | 18 | 3 | 1 | 14 | **no** |
| ground dust (track/wheel/feet/prop) | 13 | 3 | 0 | 10 | **no** |
| collision (vehicle-on-vehicle / body) | 12 | 0 | 0 | 12 | **no** |
| **muzzle flash** | 11 | 4 | 7 | 0 | **yes** (flash only) |
| explosion debris cascade, per material | 8 | 0 | 0 | 8 | **no** |
| shell-casing eject | 7 | 6 | 0 | 1 | partly — baked mesh is strobed in place, never ejected |
| impact decal | 6 | 6 | 0 | 0 | **no** (never reached) |
| rocket / shell smoke trail | 6 | 0 | 3 | 3 | **yes** (one sprite, hand-rolled) |
| building fire / smoke / dust | 3 | 0 | 0 | 3 | **no** |
| foliage / wind (`e_LeafWind`, `e_LeafTree`) | 2 | 2 | 0 | 0 | **no** |
| blood | 1 | 0 | 0 | 1 | **no** |
| ambient sandstorm dust (`e_dustWind`) | 1 | 0 | 0 | 1 | **no** |
| landing touchdown (`e_fTouchGround`) | 1 | 0 | 0 | 1 | **no** |
| tracer (`e_Tracer01`) | 1 | 1 | 0 | 0 | **yes** (hand-rolled, not from this bundle) |
| misc prop (`e_Barbwire`) | 1 | 0 | 0 | 1 | **no** |
| **TOTAL** | **216** | **54** | **60** | **102** | |

Weather (rain/snow) is **absent from vanilla** and present in mods, as a *placed
static object* carrying the bundle — see gap E3.

---

# A. Particles and the effect pipeline

## A1 — The emitter data model is 80% unparsed; `intensity` (the emission rate) is missing

**Gap.** `con.py` reads 11 of the ~45 properties an Emitter/Particle declares, and
the missing ones include the emission rate, the spawn volume, the initial
velocity cone, particle rotation, drag, sprite-sheet animation and the
looping/burst distinction — so no reusable emitter schema exists for anything
beyond a single-frame flash.

**Ground truth.** Property census over the 202 effect folders (counts are
occurrences inside blocks of that `create` kind; `PARSED` = handled by
`bf42/con.py`):

*Emitter* (362 templates)

| property | count | parsed | meaning |
|---|---:|---|---|
| `template` | 362 | PARSED | names the payload |
| `timeToLive` | 360 | PARSED | how long the emitter emits |
| **`intensity`** | **355** | no | **particles per second** (`CRD_UNIFORM/11/20/0`) |
| `startRotation` | 341 | no | initial roll of the emission frame |
| `lodDistance` | 301 | no | per-effect cull distance (35 m for shell casings, 900 m for a B-17 fire) |
| `addEmitterSpeed` / `emitterSpeedScale` | 245 / 245 | no | inherit the parent object's velocity |
| `positionalSpeedInDof` | 193 | PARSED | initial velocity along the effect's forward axis |
| `relativePositionInDof` | 179 | PARSED | spawn offset forward |
| `positionalSpeedInUp` / `InRight` | 173 / 161 | no | **the other two axes of the spread cone** |
| `relativePositionInUp` / `InRight` | 158 / 91 | no | **the other two axes of the spawn box** |
| `looping` | 130 | no | continuous vs one-shot |
| `startAtCreation` | 90 | no | fires immediately vs on trigger |
| `rotationalSpeedInRight/Up/Dof` | 83/68/62 | no | tumble rate given to mesh particles |
| `IntensityAtSpeed` | 52 | no | rate scales with host speed (dust, wake) |
| `hasOverDamage` | 33 | no | gated on host damage state |
| `moveToWaterSurface` | 29 | no | snap spawn to the waterline |
| `startProbability` | 28 | no | stochastic gate |
| `delay` | 27 | no | staggered start (`Em_B17FireD1` delays 5 s) |
| `intensityOverTime` | 23 | no | rate ramp |
| `noPhysics` | 11 | no | |

*SpriteParticle* (243 templates)

| property | count | parsed |
|---|---:|---|
| `texture`, `timeToLive`, `colorRGBAOverTime`, `sizeOverTime`, `gravityModifier`, `size`, `destBlendMode` | 244/242/241/236/229/227/226 | PARSED |
| `initRotation` | 242 | no |
| `rotationSpeed` | 181 | no |
| `drag` | 100 | no |
| `rotationSpeedOverTime` | 75 | no |
| `gravityModifierOverTime` | 37 | no |
| `XYSizeRatio` / `XYSizeRatioOverTime` | 34 / 35 | no (non-square sprites — shockwave rings) |
| `hasStaticColor` | 35 | no |
| **`numAnimationFrames` / `initAnimationFrame` / `animationSpeed` / `animationSpeedOverTime`** | 32/32/32/21 | no (**sprite-sheet flipbooks**) |
| `srcBlendMode` | 23 | no |
| `useMipMaps` | 18+1 | no |
| `dragOverTime` | 8 | no |
| `alphaTestRef(OverTime)` | 1 / 4 | no |
| `turnsInMovingDirection` | 2 | no (stretch-along-velocity) |
| `useUVRotation` | 1 | no (matches `shaders/SpriteUVRot.vso`) |

*Particle* (mesh payload, 79 templates): `sizeModifier` (47, per-axis XYZ scale),
`alphaOverTime` (31), `gravityModifierOverTime` (19), `drag` (12) — all unparsed.

*EffectBundle* (216): `saveInSeparateFile` (189), `loadSoundScript` (83),
**`addWorkOnMaterial`** (48 — the effect only plays over those terrain material
ids; `e_wdustPanz` lists 2,3,4,5,6,7,8,9,11,12,14,15), `min/maxDistanceUnderwaterSurface`
(20/20), `lodDistance` (17), `setStartOnEffects` (8) — all unparsed.

`intensity` = particles/second is corroborated by the project's own earlier
finding: `firing-effects.md` records `e_KatyushaFume` as "puffs 0.4-1.2 m at
~100/s", and `Em_KatyushaFume_Smoke` declares `ObjectTemplate.intensity
CRD_NONE/100/0/0`. (Exact units UNVERIFIED against the decompiler.)

Worked example, `Objects/Effects/e_ExplArmor/Effects.con` — the tank-hit
explosion, five emitters, none of which the current schema can express:

```con
ObjectTemplate.create Emitter Em_ExplArmor_Smoke
ObjectTemplate.template Fx_ExplAni_Smoke
ObjectTemplate.addEmitterSpeed 1
ObjectTemplate.emitterSpeedScale 1
ObjectTemplate.delay CRD_NONE/0.1/0/0
ObjectTemplate.intensity CRD_NONE/11/20/0
ObjectTemplate.relativePositionInDof CRD_NONE/-1.2/0/0
ObjectTemplate.positionalSpeedInDof CRD_UNIFORM/2/0/0
ObjectTemplate.positionalSpeedInUp CRD_UNIFORM/2/0/0
```

**Current state.** `bf42/con.py:336-348` (the whole effect field set on
`ObjectTemplate`), `:610-625` (`texture`, `destBlendMode`), `:626-636`
(`gravityModifier`, `positionalSpeedInDof`, `relativePositionInDof`),
`:661-683` (`timeToLive`, `template`, `size`, `sizeOverTime`,
`colorRGBAOverTime`, `showInFirst/ThirdPerson`). Nothing else.
`crd()` at `con.py:104-118` keeps only the first of the three CRD components,
so every `CRD_UNIFORM/a/b/0` spread collapses to `a`.

**Size. L.** Extractor: a real emitter parser (~150 lines in `con.py`, plus a
`CRD` value object that keeps the distribution and both parameters instead of
collapsing to the mean). Schema: an `effects.json` sidecar per mod — bundles ->
emitters -> payloads — rather than baking flattened nodes into each GLB, because
the same 216 bundles are shared by every vehicle. Viewer: a GPU-instanced
billboard particle system (one `InstancedBufferGeometry`, per-instance
age/size/colour, additive and alpha passes separated) plus a small mesh-particle
pool.

**Impact.** Structural. Every other particle gap in this document is downstream
of it; without `intensity`, `looping` and the Up/Right axes you cannot spawn the
right number of particles in the right volume even for effects you already bake.

## A2 — 56% of sprite payloads are discarded by the additive filter, and 102 of 216 bundles bake to nothing

**Gap.** `assemble.py` bakes an emitter only if its payload is an additive
(`destBlendMode BMOne`) sprite or a mesh, so every alpha-blended payload — all
the smoke, dust, steam and cloud — is dropped, and 61 bundles that contain
nothing else produce zero nodes and are silently invisible.

**Ground truth.** Across the 202 effect folders, `destBlendMode` is
`BMInvSourceAlpha` **126** times and `BMOne` **99** times (plus one `BMone`, one
`BMDestAlpha`). Re-running the exporter's own filter over the library:

```
bundles in library: 216
bundles with >=1 resolvable emitter: 175
  fully baked   : 54
  partially baked (alpha-blended half dropped): 60
  ZERO nodes (invisible): 61          + 41 with no resolvable emitter = 102
```

The zero-node set is exactly the atmosphere of a battlefield: `e_damageSmoke`,
`e_BuildingSmoke`, `e_BuildingSmokeSmall`, `e_BuildingSmokeIdleDark`,
`e_BuildingDust`, `e_ExFumeFact`, `e_ExFumePanz`, `e_DryDirtSmoke`,
`e_collision_metal/Stone/Wood/Other`, `e_Blood01`, `e_FlakSmall`,
`GroundExplDry`, `GranadeExplDry`, `GranadeExplDirt`, every `*Damage` bundle
(23), every `*Cascades*` bundle (8).

**Current state.** `bf42/assemble.py:746-748`:

```python
if kind == "spriteparticle":
    if (payload.dest_blend_mode or "").lower() != "bmone":
        continue
```

`_effect_bundle_node` returns `None` when no emitter baked
(`assemble.py:793-795`), and `build_node` short-circuits every EffectBundle into
it (`assemble.py:1356-1360`) — so an attached bundle that is pure smoke leaves no
trace in the GLB and no entry in the report's skipped list.

**Size. M** given A1's parser (**L** standalone). Extractor: drop the filter, keep
`srcBlendMode`/`destBlendMode` per payload. Viewer: a second, alpha-blended,
depth-sorted particle pass.

**Impact.** Structural for any "battle" rendering; cosmetic for the current
static flythrough, where nothing is shooting. The honest framing: the viewer
today can draw a gun firing but cannot draw anything that has *been* hit.

## A3 — The impact-effect table (`MaterialManager.setEffectTemplate`, 4,929 rows) is never read

**Gap.** Which effect a hit produces — spark on metal, dust plume on sand, ring
on water, blood on a soldier — is a 4,929-row (attacker material x defender
material) table in `Game.rfa`, and nothing in the pipeline reads it; the viewer
draws no impact at all.

**Ground truth.** `Mods/bf1942/Archives/bf1942/Game.rfa`,
`Bf1942/Game/MaterialManagerSettings.con` and the 46 scripts it `run`s
(`collision_Armor/{HeavyArmor,LightArmor,NoArmor,ObjectiveArmor,PlaneArmor,PTRaftArmor,RaftArmor}.con`
plus `damage_system/*.con`). The row form is stateful, same as the damage table
the project already replays:

```con
MaterialManager.attGroup 70
MaterialManager.defGroup 43
MaterialManager.damageMod 0
MaterialManager.setEffectTemplate e_Collision_Granade_Metal
```

- 4,977 `setEffectTemplate` statements, **4,929 distinct (att, def, effect) rows**.
- **76 distinct effect templates** referenced. Top: `e_collision_metal` 646,
  `e_Collision_ship` 277, `e_collision_Other` 263, `e_RichoMetal` 250,
  `e_collision_Wood` 220, `e_ExplArmor` 216, `e_richoPHeavy` 208,
  `RichoWoodDecal` 160, `e_RichoKnifeMetal` 145, `e_ExplGranade` 140,
  `e_RichoGround` 129, `BombSmallNS_Expl` 128, `e_collision_Stone` 121.
- The material ids are named in `Bf1942/Game/materialManagerdefine.con` (155
  materials): 0 Default, 1 Water, 2 Dry grass, 3 Juicy grass, 4 Dry dirt,
  5 Wet dirt, 6 Mud, 8 Gravel, 9 Frozen ground, 10 Dry sand, 11 Wet sand,
  12 Rock, 13 Sand road, 14 Dirt road, 15 Paved road, then armour classes 39-72,
  basic materials 79-98, and weapon classes 210-257 (knives, pistols, SMG,
  rifle, auto rifle, assault rifle, MG, bazooka, AA gun, tanks).

The defender material for a *terrain* hit comes from the per-patch
`Textures/MaterialMap.raw` + `TerrainPalette.pal`, which `map-parity.md` already
records as parsed by nothing.

**Current state.** `bf42/damage.py:230-300` replays exactly these scripts, keeps
`material` / `materialAttGroup` / `materialDefGroup` / `materialDamage` /
`attGroup` / `defGroup` / `damageMod`, and never matches `setEffectTemplate` —
the `elif` chain has no branch for it. No caller asks for it either.
`viewer/gunfire.js` has no collision query at all: tracers and projectiles
recycle on `TRACER_MAX_RANGE` / `timeToLive` (`gunfire.js:39-40`), never on a hit.

**Size. S** for the extractor (one extra `elif` in `damage.py` plus a
`(att,def) -> effect` dict on `DamageTables`; the replay machinery already
exists). **M** for the viewer, which needs a raycast against terrain + statics and
a surface->material lookup, and is gated on A1/A2 for anything to spawn.

**Impact.** Structural: this is the entire "shooting feels connected to the world"
layer, and the data is complete and machine-readable. It is also the cheapest
extraction win in the document.

## A4 — Damage-state effects (`addArmorEffect`, 430 declarations) are unparsed

**Gap.** A vehicle's smoke-at-half-health / fire-at-critical is declared as a
threshold table on the object, and nothing parses it, so the 23 `*Damage` and 23
`*Fire` bundles have no trigger even if they were bakeable.

**Ground truth.** `ObjectTemplate.addArmorEffect <hpThreshold> <effect> <x/y/z>`,
430 occurrences in `Objects.rfa` (396 outside `MOVE_FILES`), e.g.
`Objects/MOVE_FILES/explFire_Test_m1/Objects.con:
ObjectTemplate.addArmorEffect 0 e_BuildingFire 0/0/0`. Mod levels use it too
(FHSW `Arctic_Convoy-1942/objects/Ju88A/Objects.con:
ObjectTemplate.addArmorEffect 500 e_snowfall_heavy2_f50 0/0/0`). Companions in
the same vocabulary, also unparsed: `endEffectTemplate` (16),
`deathEffectName` (1), `hasCollisionEffect` (71), `hasOnTimeEffect` (29),
`hasStartEffect` (18), `stopAtEndEffect` (45), `invisibleAtEndEffect` (29),
`useMMOnEndEffect` (3), `timeOnEndEffect` (1), `IsSpawnEffect` (2),
`setNoPropellerEffectAtSpeed` (33 — when the prop-wash dust stops).

**Current state.** None of these strings appears in `bf42/*.py`
(`grep -rn "addArmorEffect\|endEffectTemplate\|hasCollisionEffect" --include='*.py'`
returns nothing).

**Size. S** extractor (parse into a list on `ObjectTemplate`, emit as node
extras), **M** viewer (needs a damage model to drive it — or a debug slider).

**Impact.** Cosmetic today (nothing takes damage in the viewer); structural if
wrecks or a damage demo are ever wanted. Worth parsing early because it is three
lines and it is the only thing that explains what the 46 `*Damage`/`*Fire`
bundles are *for*.

## A5 — Shell casings are baked as a static flash, not ejected

**Gap.** The 7 shell-eject bundles bake their casing mesh as a hidden node that
`gunfire.js` strobes in place; the engine ejects a tumbling rigid particle that
falls under gravity.

**Ground truth.** `Objects/Effects/e_shell792mm/Effects.con`:

```con
ObjectTemplate.create Emitter Em_Shell792mm
ObjectTemplate.lodDistance 35
ObjectTemplate.intensity CRD_NONE/10/0/0
ObjectTemplate.positionalSpeedInUp    CRD_UNIFORM/0.4/0.9/0
ObjectTemplate.positionalSpeedInRight CRD_UNIFORM/0.8/1.5/0
ObjectTemplate.rotationalSpeedInDof   CRD_EXPONENTIAL/-20/0/1
ObjectTemplate.rotationalSpeedInUp    CRD_UNIFORM/10/0/1
ObjectTemplate.rotationalSpeedInRight CRD_UNIFORM/4/0/1
ObjectTemplate.create Particle Fx_Shell792mm
ObjectTemplate.geometry StandardMesh:Shell792mmHI_m1
ObjectTemplate.timeToLive CRD_NONE/1/0/0
ObjectTemplate.gravityModifier CRD_NONE/0.5/0/0
```

Every velocity and tumble term above is unparsed (A1). Seven bundles:
`e_shell9mm`, `e_shell792mm`, `e_Shell792D`, `e_shell1250mm`, `e_shellAAgun`,
`e_shellAir`, `e_shellM1Garand`.

**Current state.** `bf42/assemble.py:757-761` bakes the mesh payload with only
`timeToLive` and the ramps; `viewer/gunfire.js:212-213` shows/hides it. No
kinematics.

**Size. S** once A1 lands (the mesh-particle pool is the same one
`gunfire.js` already has for projectiles). **Impact:** cosmetic, but it is the
single most-noticed detail in a cockpit view and the data is four lines.

## A6 — Impact decals are extracted and then unreachable

**Gap.** `RichoStoneDecal` / `RichoMetalDecal` / `RichoWoodDecal` bake cleanly
(6/6 bundles, all emitters bakeable) but nothing ever instantiates them, because
they are only ever named by the `MaterialManager` table of gap A3.

**Ground truth.** `Objects/Effects/e_Decal_{Metal,Stone,Wood}/`, meshes
`Decal_metal_m1` / `Decal_stone_m1` / `Decal_wood_m1` in `standardMesh.rfa`, each
with an explicitly authored decal shader:

```rs
subshader "Decal_stone_m1_Material0" "StandardMesh/Default"
{
  materialDiffuse 0.388235 0.388235 0.388235;
  blendSrc sourceAlpha;  blendDest invsourceAlpha;
  transparent true;  depthWrite false;  alphaTestRef 0.5;
  texture "texture/Decal_stone_I";
}
```

Referenced 160 / 93 / 90 times respectively in the impact table.

**Current state.** Reachable only via A3. Also mis-materialled by gap B1
(`alphaTestRef 0.5` dropped) and B3 (`depthWrite false` dropped).

**Size. S** on top of A3. **Impact:** cosmetic, but decals are what make a
firefight leave a mark; they are also the cheapest possible particle (one quad,
no simulation).

---

# B. Materials and shaders

## B0 — `shaders.rfa` is compiled DX8 bytecode; there is nothing to extract

**Not a gap — settling the question.** `shaders.rfa` is 9,181 bytes, 12 entries,
all compiled vertex/pixel shader objects:

```
shaders/FlareShader.vso          shaders/Sprite.vso
shaders/SkinningShader2Bones.vso shaders/SpriteFog.vso
shaders/newbf2_SkinningShader2Bones.vs   shaders/SpriteLighting.vso
shaders/skinningShadowGen.vso    shaders/SpriteUVRot.vso
shaders/SpriteUVRotLighting.vso  shaders/Tree/Billboard.pso
shaders/Tree/Sprite.vso          shaders/Tree/SpriteFog.vso
```

No source, no parameters, nothing referenced from any `.con` or `.rs`. Nothing
reads it and nothing should. It is useful only as *evidence*: the existence of
`Sprite{,Fog,Lighting,UVRot,UVRotLighting}.vso` confirms five distinct
sprite-particle paths the emitter data selects between (`useUVRotation`,
per-particle lighting, fogged sprites) — all of which the pipeline currently
collapses to one unlit additive quad.

The real material language is the `.rs` subshader text, 4,048 blocks across
1,572 files, every one declaring technique `"StandardMesh/Default"` (there is
exactly one technique name in vanilla).

## B1 — `alphaTestRef` is not parsed: 61 alpha-tested surfaces mis-render, 11 fully opaque

**Gap.** `rs.py` matches only the old brace-syntax `alphaTest greater 0.7`, not
the subshader-syntax `alphaTestRef 0.7`, so every alpha-tested cutout in the
subshader vocabulary exports as a sorted alpha blend — and the 11 that do not
also say `transparent true` export as fully **opaque**.

**Ground truth.** `standardMesh.rfa` + `StandardMesh_001.rfa`: 70 blocks declare
`alphaTestRef` (61 in `standardMesh.rfa` alone); refs are 0.7 (47), 0.4 (6),
0.5 (5), 0.8 (2), 0.3 (1). The 11 with no `transparent true` — these render as
solid quads today:

```
Brit_Scouthelm_m1_Material1        0.7   (helmet foliage net)
Germ_ScoutHelm_m1_Material1        0.7
Germ_ScoutHelm_Desert_m1_Material1 0.7
Jap_ScoutHelm_m1_Material2         0.7
Russ_ScoutHelm_m1_Material8        0.7
US_ScoutHelm_m1_Material1          0.7
churcfencefence_m1_Material0       0.4   (churchyard railings)
eu_churchfence_m1_Material23       0.4
ironbrdg1fence_m1_Material8        0.4   (iron bridge railing)
Parachute_m1_Material0             0.3   (canopy)
PanzerIV_Whe4_M1_Material2         0.7
```

The other 50 (`climbnet_3m/6m/…`, `citymesh1/2/3fence`, `Milifence_*`,
`hangar1_M1` glazing, `B17_Fus_M1` markings, `Gato_Hull_m1`, the three decals)
are exported BLEND instead of MASK.

Reproduce:
```bash
python3 - <<'EOF'
from bf42.rfa import RfaArchive; from bf42 import rs; from pathlib import Path
import re
b=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives'
a=RfaArchive(b/'standardMesh.rfa')
B=re.compile(r'\bsubshader\s+"([^"]+)"\s+"[^"]+"\s*\{',re.I)
for n in a.entries:
    if not n.lower().endswith('.rs'): continue
    t=a.read(n).decode('latin-1')
    for m in B.finditer(t):
        s,e=rs._brace_span(t,m.end()-1); body=t[s:e].lower()
        if 'alphatestref' in body and 'transparent true' not in body:
            print(n, m.group(1))
EOF
```

**Current state.** `bf42/rs.py:34`
(`_ALPHATEST = re.compile(r'\balphaTest\s+(\w+)\s+([0-9.]+)\s*;')` — requires an
operator token, so `alphaTestRef 0.7;` never matches) and `bf42/rs.py:50`
(`alpha_test: float | None`). Consumed at `bf42/assemble.py:438-439`:

```python
alpha_cutoff=None if shader.additive else shader.alpha_test,
blend=shader.transparent and shader.alpha_test is None,
```

so `alpha_test is None` forces BLEND for the 50 and OPAQUE for the 11.

**Size. S.** One regex in `rs.py` + one test. No viewer change (glTF `MASK`
already round-trips).

**Impact.** Real and visible, and the cheapest fix in the document. Opaque scout
helmets and opaque parachutes are outright wrong; blended chain-link fences
produce the classic sort-order flicker when two fences overlap, and they also
write no depth, so anything behind a fence draws in the wrong order.

## B2 — `envmap true` (494 materials) is dropped although the cubemap is already extracted

**Gap.** 494 of 4,048 vanilla materials declare an environment-map reflection
stage; the level's cubemap is already extracted and shipped (`extras.envmap`,
used by the water shader), but no vehicle or building material ever reflects it.

**Ground truth.** 494 `envmap true` blocks across 405 `.rs` files. It is
concentrated exactly where it should be — canopies, windscreens, gauges,
polished metal:

```rs
subshader "1P_Katyusha_M1_Material1" "StandardMesh/Default"
{
  lighting true;  lightingSpecular true;
  materialDiffuse 1 1 1;
  materialSpecular 0.572549 0.572549 0.572549;  materialSpecularPower 12.5;
  transparent true;  envmap true;  depthWrite false;
  texture "texture/katy_window_I";
}
```

The cubemap source is bound per level:
`ShaderManager.setTextureParam envmap bf1942\levels\Tobruk\Textures\ENVMAP_G_.rcm`
(23/23 levels), and `extract_map.py` already exports the six faces
(`scene.json: "envmap": [6 files]`).

**Current state.** `bf42/rs.py:32-37` has no `envmap` pattern; `Shader` has no
field. `viewer/map.html:784-785` states the position explicitly: *"Not modelled:
the optional specular term (lightingSpecular, ~1/3 of materials) and the envmap
reflection stage."*

**Size. M.** Extractor: one regex + a material extras flag. Viewer: the map path
already builds bespoke materials in `bindDynamicShading` (`map.html:786`) and
already has the cubemap loaded for water, so it is a handful of GLSL lines plus
a per-material branch. The model browser (`index.html`) would need its own pass.

**Impact.** Cosmetic but high-visibility: every aircraft canopy and vehicle
window in the game currently reads as flat tinted glass. This is the largest
single "why does it look like a model viewer and not like the game" material gap.

## B3 — `materialDiffuse` / `materialSpecular` / `materialSpecularPower` / `lightingSpecular` / `depthWrite` are dropped

**Gap.** Five per-material attributes that the engine feeds straight into its
fixed-function light and blend state are not parsed, so 383 materials render at
the wrong brightness, 1,020 lose their specular highlight entirely, and 77
translucent surfaces write depth they should not.

**Ground truth.** Census over 4,048 subshader blocks:

| attribute | blocks | effect when dropped |
|---|---:|---|
| `materialDiffuse` != `1 1 1` | **383** | surface renders brighter than the engine draws it (e.g. `Decal_stone_m1` 0.388, `1P_Katyusha_M1_Material0` 0.514, `1p_Aichi_Val_Gun_m1_Material0` 0.5) |
| `materialSpecular` > 0 | **1,020** | no highlight (values 0.03-0.9) |
| `materialSpecularPower` | 1,485 | — (exponent for the above; 12.5 is the overwhelming default, 13.5/19.5/21 also occur) |
| `lightingSpecular true` | 1,353 | the on/off switch for the above |
| `depthWrite false` | **77** | translucent glass writes depth and occludes what is behind it |
| `materialAmbient` (brace syntax only) | 133 | — |

`viewer/map.html:775-777` asserts *"materialDiffuse is `1 1 1` in 3202 of 3523
vanilla `.rs` declarations; no materialAmbient attribute exists"*. Re-measured
here over `standardMesh.rfa` + `StandardMesh_001.rfa` + `treeMesh.rfa` +
`Objects.rfa`: 4,048 subshader blocks, of which **383** declare a non-white
`materialDiffuse`, and `materialAmbient` **does** exist — 133 times, in the
brace-syntax `Art/*.rs` overrides (e.g.
`Objects/Vehicles/Land/Chi-ha/Art/Chi-Ha_Left_Whe1_m1.rs`). The comment's
conclusion (white is the norm) holds; its counts and its "no materialAmbient"
claim do not.

**Current state.** `bf42/rs.py:32-37` — `_BOOL` covers only
`twosided|transparent|lighting`; there is no pattern for any `material*`
attribute, `lightingSpecular` (deliberately excluded by the comment at
`rs.py:30-31`) or `depthWrite`.

**Size. S** extractor (four regexes, four fields, pass through as glTF
`baseColorFactor` + a `specular` extras block). **M** viewer to actually shade
with it, since the engine's model is fixed-function Blinn in display space and
`bindDynamicShading` would need the extra term.

**Impact.** `depthWrite false` is a correctness bug (cosmetic but wrong-looking:
cockpit glass hiding the cockpit). `materialDiffuse` is a modest brightness error
on ~9% of materials. Specular is the genuinely missing look — it is what makes
the engine's vehicles read as painted metal.

## B4 — `textureFade true` (69 materials) is dropped

**Gap.** 69 materials declare `textureFade true`, all of them a `texture/black_o`
quad inside a building shell; the exporter renders them as opaque black.

**Ground truth.** e.g. `standardMesh/afr_house1_ste_m1.rs`:

```rs
subshader "afr_house1_ste_m1_Material3" "StandardMesh/Default"
{ lighting true; lightingSpecular false; materialDiffuse 1 1 1;
  textureFade true; texture "texture/black_o"; }
```

69 blocks, and exactly 69 `.sm` materials carry the per-material render-flag
value 4 (see B5) — a 1:1 correspondence that identifies the flag bit. The
semantics (distance fade? camera-proximity fade of an interior occluder?) are
**UNVERIFIED**; the count and the correspondence are not.

**Current state.** No pattern in `bf42/rs.py`; these export as ordinary opaque
black surfaces.

**Size. S** to extract, **S** to apply once the semantics are settled (worth one
pass against the `bf1942-mod-extraction` decompiler corpus — search for the
`textureFade` attribute string in the `SubShaderBuilder.StandardMesh` `.rdata`
block the project already located at `0x005bf690`).

**Impact.** Cosmetic, bounded — 69 surfaces, all interior fillers in African and
European house shells. Listed because it is cheap and because the .sm flag gives
a free cross-check.

## B5 — The `.sm` per-material render-flag word is read and discarded

**Gap.** `stdmesh.Material.unknown` holds four u32s; the fourth is a per-material
render-flag word that the exporter ignores.

**Ground truth.** Over 1,285 meshes / 3,622 LOD-0 materials in
`standardMesh.rfa`, `unknown[3]` takes values 0 (3,308), 2 (163), 1 (79),
4 (69), 12 (2), 9 (1). Cross-referenced against the mesh's own `.rs`:

| `unknown[3]` | correlation |
|---|---|
| 4 | **69/69 exactly `textureFade true`** |
| 2 | 195/207 `transparent true` (the sorted-blend class) |
| 1 | 44/76 `transparent true`, 60/76 `twosided true` |
| 0 | 2,832 plain + 270 `envmap` + 111 `lighting false` + 87 `twosided` |

The other two `unknown` slots and `Material.flags` are not render flags:
`flags` is the D3D FVF (1041 <-> stride 32 position/normal/uv; 9233 <-> stride 40
with a lightmap UV2), and `primitive` is 4 (triangle list) for every vanilla
StandardMesh material.

**Current state.** `bf42/stdmesh.py:57-66` stores `unknown: tuple[int,int,int,int]`;
no consumer.

**Size. S.** **Impact:** negligible on its own — the `.rs` is the authority and
carries the same information more legibly. Recorded so the field stops being
"unknown", and as a validation oracle for B1/B4 (any material whose `.rs` says
nothing but whose flag word is 2 is a candidate mis-parse).

## B6 — Transparency sorting is whatever three.js does

**Gap.** The engine sorted transparent geometry per-object with explicit
`depthWrite` control per material; the exporter emits glTF `BLEND` and lets
three.js sort by object centroid, with no `depthWrite` information at all.

**Ground truth.** 238 `transparent true` blocks, 77 of which pair it with
`depthWrite false`, and 24 of which declare an explicit `blendSrc`/`blendDest`
pair (20 of those `blendDest one` — additive). The engine therefore has three
distinct translucent classes; the exporter has one-and-a-half (BLEND, plus an
`extras.additive` flag honoured by the viewer at `gunfire.js:228-229`).

**Current state.** `bf42/gltf.py:244-255` — `additive` -> `BLEND` + extras,
`alpha_cutoff` -> `MASK`, else `blend` -> `BLEND`. No `depthWrite`, no render
order.

**Size. S** extractor / **M** viewer (a `renderOrder` policy and per-material
`depthWrite`). **Impact:** cosmetic; mostly subsumed by fixing B1, which moves
50 of the worst offenders out of the blend bucket entirely.

## B7 — Scrolling UVs are implemented in the model browser but not the map

**Gap.** `setAnimatedTextureSpeed` (tank tracks, belts) animates in
`viewer/index.html` and is dead data in `viewer/map.html`.

**Ground truth.** `ObjectTemplate.setAnimatedTextureSpeed -0.006/0`; parsed at
`bf42/con.py:566-571`, exported at `bf42/assemble.py:1560`
(`extras["animatedTextureSpeed"] = [-u, v]`).

**Current state.** `viewer/index.html:2563-2600` implements it
(`collectScrolling`, 60 Hz tick scaling, throttle-gated, with the
Group-vs-Mesh trap handled). `grep -n animatedTextureSpeed viewer/map.html`
returns **nothing** — only two comments referencing the trap by name
(`map.html:665`, `:677`).

**Size. S.** Lift `collectScrolling` into a shared module; the map has no
throttle for parked vehicles, so drive it from the piloted vehicle's throttle and
leave the rest static (which is also what the engine does).

**Impact.** Cosmetic and small — but it is a straight copy of code that already
exists and is already debugged.

---

# C. Level-wide atmosphere

## C1 — The sun's lens flare and corona (21/23 levels) are fully declared and not extracted

**Gap.** Every level but two declares a `LensFlare` object with 5 flare elements
and 2 coronas, complete with textures, sizes, scales, colours and blend modes;
none of it is parsed, exported or drawn.

**Ground truth.** `bf1942/levels/<Level>/Init/SkyAndSun.con` — 21/23 levels carry
`ObjectTemplate.initLensFlares` + `setLensFlareCount 5`, and 21/23 carry
`Sky.setSun sun`. Tobruk's block in full:

```con
ObjectTemplate.create LensFlare TSun
ObjectTemplate.setLensFlareCount 5
ObjectTemplate.setBackFlareCount 0
ObjectTemplate.setCoronaCount 2
ObjectTemplate.initLensFlares
ObjectTemplate.setVisibilityAngleDeg 360
ObjectTemplate.setFlareSrcBlend BMSourceAlpha 0
ObjectTemplate.setFlareDestBlend BMOne 0
ObjectTemplate.setFlareTexture ring5.tga 0
ObjectTemplate.setFlareSize 3 0
ObjectTemplate.setFlareScale -1.5 0        rem position along the flare axis
ObjectTemplate.setFlareColor 255/255/255/50 0
ObjectTemplate.setFlareDistFadeScale 1 0
...  rem flares 1..4: ring3 0.5, ring4 0.3, ring5 2, ring5 0
ObjectTemplate.setCoronaTexture sunflare7.tga 0
ObjectTemplate.setCoronaSize 2 0
ObjectTemplate.setCoronaColor 255/255/200/225 0
ObjectTemplate.setCoronaTexture sunflare9.tga 1
ObjectTemplate.setCoronaSize 5 1   ObjectTemplate.setCoronaScale 5 1
ObjectTemplate.setCoronaColor 255/150/0/100 1    rem red aura
Object.create TSun
Object.name sun
ObjectTemplate.setflarefadeall 0.1
ObjectTemplate.setcoronafadeall 0.3
Sky.setSun sun
```

`shaders/FlareShader.vso` in `shaders.rfa` confirms the engine has a dedicated
path for it.

**Texture sourcing caveat.** `ring3/4/5.tga` and `sunflare7/9.tga` are **not in
any archive under `Mods/bf1942/`** on this install, nor loose on disk, nor in
`BF1942.exe`'s string table. The only copy in the whole install is
`Mods/bfheroes/Archives/Texture.rfa` -> `Texture/ring{3,4,5}.tga`,
`Texture/sunflare{7,9}.tga`. Either this install's `texture.rfa` is missing a
folder or the flare shipped elsewhere; either way the five files are recoverable.
Flagged so nobody burns an hour concluding the data is absent. **UNVERIFIED:**
whether vanilla on a complete install resolves them from a path we have not
found.

**Current state.** `bf42/level.py:875-903` parses the `sky.*` / `cloud.*`
namespaces and nothing in the `LensFlare`/`objecttemplate.setflare*` family.
`map-parity.md` already lists "the `LensFlare`/corona sun object" under *Not
reproduced*, so this is a known-open item — what is new here is that the data
model is complete and trivially parseable (12 setters, all `<value> <index>`).

**Size. M.** Extractor: ~40 lines in `level.py` + 5 textures into the level
payload. Viewer: a screen-space flare chain along the sun-to-centre axis with an
occlusion test, ~120 lines; the sun direction (`sky.sunLightDirectionVec`) is
already in `scene.json`.

**Impact.** Cosmetic, high perceptual value. A flythrough that turns toward the
sun currently shows nothing where the game shows a two-corona glare — and the sky
faces already carry a *painted* sun glow, so the mismatch is visible as a bright
patch with no bloom.

## C2 — 8 levels get invented fog because the extractor only knows one of two fog spellings

**Gap.** `bf42/level.py` parses `renderer.fogLinearStart/End` (5 levels) and not
`renderer.fogStart/fogEnd` (9 levels), so 8 levels that *do* declare a fog range
receive the `0.5 x viewDistance -> viewDistance` fallback instead.

**Ground truth.** All 23 vanilla levels, from their `Init.con`:

| level | `Game.setViewDistance` | declared `fogStart`/`fogEnd` | declared `fogLinear*` | extracted (`scene.json`) |
|---|---:|---|---|---|
| Battle_of_Britain | 550 | **100 / 500** | – | 275 -> 550 |
| Battleaxe | 400 | **110 / 400** | – | 200 -> 400 |
| Berlin | 100 | **0 / 100** | – | 50 -> 100 |
| Coral_sea | 500 | **300 / 500** | – | 250 -> 500 |
| Invasion_of_the_Philippines | 500 | **25 / 475** | – | 250 -> 500 |
| Liberation_of_Caen | 225 | **50 / 225** | – | 112.5 -> 225 |
| Omaha_Beach | 300 | **-50 / 290** | – | 150 -> 300 |
| Truk | 380 | **250 / 500** | – | 190 -> 380 |
| Kharkov | 400 | -40 / 400 | 120 / 200 | 120 -> 200 (linear wins) |
| Gazala / Kasserine / Stalingrad / Tobruk | – | – | declared | verbatim (correct) |
| the other 10 | – | – | – | derived (correct — nothing declared) |

Worst cases: Invasion_of_the_Philippines fogs from **25 m** in game and from
250 m in the extract; Omaha_Beach starts fogging *behind the camera* (-50) and
gets 150; Battle_of_Britain starts at 100 and gets 275.

Reproduce:
```bash
python3 - <<'EOF'
from bf42.rfa import RfaArchive; from pathlib import Path; import re
b=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/bf1942/levels'
for p in sorted(b.glob('*.rfa')):
    if re.search(r'_0\d\d$',p.stem): continue
    a=RfaArchive(p)
    for n in a.entries:
        if not n.lower().endswith('.con'): continue
        for l in a.read(n).decode('latin-1').splitlines():
            if re.match(r'\s*renderer\.(fogstart|fogend|foglinear|setfogcolor)',l,re.I):
                print(p.stem, l.strip())
EOF
```

**Current state.** `bf42/level.py:854-857`:

```python
elif cmd == "foglinearstart" and tokens:
    info.fog_start = float(tokens[0])
elif cmd == "foglinearend" and tokens:
    info.fog_end = float(tokens[0])
```

and the fallback at `extract_map.py:1440-1441`:

```python
fog_end   = info.fog_end   if info.fog_end   is not None else view_distance
fog_start = info.fog_start if info.fog_start is not None else view_distance * 0.5
```

`flythrough-fidelity-gap.md` states "declare `renderer.fogLinearStart/End`
**5 / 23**" — true as written, but it surveyed only that spelling, and the
derived-fog rule it introduced is therefore doing work on 8 levels where real
numbers exist.

**Size. S.** Two `elif` branches + a precedence decision for Kharkov (which
declares both; `fogStart/fogEnd` appears in `Init.con` and `fogLinearStart/End`
in the same file — settle by declaration order, or against the decompiler, and
record it). Then re-extract.

**UNVERIFIED:** that `renderer.fogStart/fogEnd` and
`renderer.fogLinearStart/End` are the same renderer state rather than two
different fog models. The value ranges (0-500 metres, a start below an end,
negative starts) are consistent with linear fog in both spellings, and no level
uses a density-style fraction.

**Impact.** Structural for map fidelity, and it directly undercuts the
already-shipped fog work — 8 of 23 vanilla maps currently render an atmosphere
DICE did not author. Cheapest high-impact fix in the document alongside B1.

## C3 — 2 levels get the grey default fog colour because of `renderer.setFogColorVec`

**Gap.** Midway and Truk declare their fog colour as `renderer.setFogColorVec`;
`level.py` matches only `fogColorVec`, so both ship the hard-coded
`(0.7, 0.7, 0.7)` default.

**Ground truth.**
`bf1942/levels/Midway/Init.con: renderer.setFogColorVec 0.812/0.832/0.921` and
`bf1942/levels/Truk/Init.con: renderer.setFogColorVec 0.812/0.832/0.921` — a pale
Pacific blue. 21/23 levels use `fogColorVec`; 2/23 use `setFogColorVec`; 23/23
declare one or the other.

Confirmed in the shipped extracts:
```
viewer/maps/midway/scene.json : "fogColor": [0.7, 0.7, 0.7]
viewer/maps/truk/scene.json   : "fogColor": [0.7, 0.7, 0.7]
```
against e.g. `coral_sea` `[0.926, 0.945, 0.965]`.

**Current state.** `bf42/level.py:849` (`if cmd == "fogcolorvec"`), default at
`bf42/level.py:337` (`fog_color: tuple = (0.7, 0.7, 0.7)`).

**Size. S.** Accept both spellings; re-extract Midway and Truk.

**Impact.** Cosmetic but total on those two maps: the haze wall, and the band the
sky mesh is painted to meet, are neutral grey instead of pale blue. Also worth a
defensive change — a level that declares *no* fog colour should be reported, not
silently given grey.

## C4 — Terrain cast shadows: no dynamic shadow of any kind, and 3 shadow directives unused

**Gap.** Nothing in the viewer casts or receives a shadow, and the engine's three
shadow controls are parsed-but-unused or unparsed.

**Ground truth.**
- `shadow.shadowColor 0.5` — 23/23 levels. **Parsed** (`level.py:870-873`),
  **exported** (`extract_map.py:1426-1427`, visible as
  `"shadowColor": 0.55` in `viewer/maps/tobruk/scene.json`), and **never read by
  the viewer** (`grep -n shadowColor viewer/map.html` finds only a comment at
  `map.html:701`).
- `Terrain.ShadowAmbient 80/80/80` — 23/23 vanilla levels, 866 declarations
  across the installed mods. Unparsed.
- `Terrain.ShadowBorderFadeTime` (23/23), `Terrain.ShadowSamplingCullY` (20/23),
  `shadow.ShadowSamplingCullY` (2 levels). Unparsed.
- `hasDynamicShadow 1` — 237 declarations in `Objects.rfa` (`ObjectTemplate` 144,
  `GeometryTemplate` 116), split HandWeapons 104 / Vehicles 101 / Soldiers 55.
  This is the engine's projected per-object shadow, which every vehicle and
  soldier casts. Unparsed.
- `TreeRenderer.billboardlightscale 0.5` — 4 levels. Unparsed.

**Current state.** `viewer/map.html` never sets `castShadow`, `receiveShadow` or
`renderer.shadowMap` (`grep` returns nothing). The pre-baked static lightmaps
(`bindLightmaps`, `map.html:695`) are the only shadowing that exists.

**Size. M** for dynamic object shadows (a single directional shadow map over the
piloted vehicle and nearby statics is well within budget — `map-parity.md`
measures worst-case Tobruk at 9.7 ms of a 16.7 ms frame; an 8-bit blob-shadow
decal projected onto terrain would be **S** and closer to what Refractor did).
Terrain cast shadows remain **L** and blocked on `LightmapShadowBits.lsb`.

**Impact.** Cosmetic but conspicuous: a flown aircraft currently has no shadow
under it on the sand, which is the first thing that reads as wrong on a low pass.
Note the correct scope — objects casting on terrain, not terrain self-shadowing,
which is the already-documented `.lsb` ceiling.

## C5 — Weather exists in mods as a placed object and would extract as an empty node

**Gap.** No vanilla level has weather, but 42 mod levels place a rain/snow object
whose only content is an EffectBundle; the extractor places it and emits nothing,
with no warning.

**Ground truth.** The mechanism is a normal static: `Object.create snowfall_m1`
in `StaticObjects.con`, and
`objects/Buildings/Common/snowfall_m1/Objects.con: ObjectTemplate.addTemplate e_snowfall`.

| mod | levels with weather placements | placements | templates |
|---|---:|---:|---|
| FHSW | 18 | 739 | `snowfall_m1`, `snowfall_heavy_m1`, `snowfall_heavy_low_m1`, `rainfall_heavy_m1`, `e_rain` |
| bf1918 | 13 | 18 | `rain_m1`, `rain_wind_m1`, `snowfall_m1`, `snowfall_wind_m1`, `snowfallheavy_m1` |
| bg42 | 6 | 8 | `e_snow` |
| bfheroes | 3 | 3 | `rainstorm1024` |
| FH | 2 | 337 | `snowfall_m1` (Battle_Of_Foy 299, Soletschnogorsk-1941 38) |
| WarFront | 0 | 0 | (`e_weather_snow` defined, never placed) |
| **bf1942 (vanilla)** | **0** | **0** | — |

Vanilla's nearest equivalent is `e_dustWind` (a `Particle` of `windDust_m1`
spawned in a 100 x 30 x 70 m box, `intensity 10-20`, ttl 15-30 s), attached to
`Objects/Vegetation/Common/Afri_Sandstorm` and `Afri_Bush_SandStorm` — neither of
which any vanilla level places. Plus `e_LeafWind` / `e_LeafTree` (mesh leaves,
`lodDistance 150`), also unplaced in vanilla.

Reproduce:
```bash
python3 - <<'EOF'
from bf42.rfa import RfaArchive; from pathlib import Path; import re, collections
r=Path.home()/'.wine/drive_c/EA Games/Battlefield 1942/Mods'
P=re.compile(r'^\s*Object\.create\s+((?:snowfall|rainfall|rain_|rainstorm|sandstorm|e_rain|e_snow)\S*)\s*$',re.I|re.M)
for mod in ['bf1942','FH','FHSW','bf1918','bfheroes','bg42']:
    d=r/mod/'Archives/bf1942/levels'
    if not d.is_dir(): continue
    c=collections.Counter()
    for p in d.glob('*.rfa'):
        if re.search(r'_0\d\d$',p.stem): continue
        a=RfaArchive(p)
        for n in a.entries:
            if n.lower().endswith('.con'):
                for m in P.finditer(a.read(n).decode('latin-1')): c[(p.stem,m.group(1))]+=1
    print(mod, sum(c.values()), 'across', len({k[0] for k in c}), 'levels')
EOF
```

**Current state.** `extract_map.py:1325-1361` tracks skipped instances, but an
EffectBundle child that bakes to nothing (gap A2) is not a skip — `build_node`
returns a node with no children, or the bundle returns `None`
(`assemble.py:793-795`) and the parent placement stands as an empty transform.
Nothing surfaces in `scene.json`.

**Size. S** for a diagnostic ("N placed objects resolved to an effect bundle with
no renderable content"), **M** once A1/A2 exist (weather is then just a looping
emitter with a large spawn box and `addEmitterSpeed 0`).

**Impact.** Zero for vanilla (correctly — the game has no weather). Structural for
the mod maps the site already serves: Battle_Of_Foy renders as a clear winter
day where the game is a snowstorm.

## C6 — Sky and cloud parameters parsed selectively; several level-lighting directives unparsed

**Gap.** A handful of small level directives are either parsed and dropped on the
floor, or not parsed at all.

**Ground truth / current state**, all from the 23 vanilla `Init*.con`:

| directive | levels | state |
|---|---:|---|
| `renderer.specularColor .3/.3/.3` | 23 | **parsed into `LightingInfo.specular_color` (`level.py:866-867`) and never exported** — `extract_map.py:1419-1427` writes only ambient/diffuse/globalAmbient/shadowColor |
| `renderer.animatedMeshAmbientColor` | 22 | unparsed (soldier/animated-mesh ambient) |
| `renderer.animatedMeshDiffuseFactor` | 7 | unparsed |
| `renderer.animatedMeshAmbient` | 1 (Coral Sea) | unparsed |
| `renderer.globalLodPercent` | 22 | unparsed (documented as deliberately skipped in `flythrough-fidelity-gap.md`) |
| `shaderManager.setDefaultShaderSolidColor 0.2/0.2/0.2` | 22 | unparsed (the colour an unresolved shader falls back to — would make missing-texture cases match the game) |
| `Sky.setCloudFog 0` | 23 | unparsed |
| `Cloud.setName` / `setSrcBlend BMSourceAlpha` / `setDstBlend BMInvSourceAlpha` | 23 each | unparsed (the viewer hard-codes an alpha-blended cloud layer at `map.html:941`) |
| `TextureManager.mipmaps 0/1` | 46 stmts / 23 levels | unparsed (brackets the sky block — sky faces are authored unmipped) |
| `renderer.beginGlobalCluster` / `endGlobalCluster` | 40 in Objects.rfa, 17 in 4 levels | unparsed (static batching hint; no visual consequence) |

**Size. S** each. **Impact.** Mostly negligible individually. The two worth doing
are `specularColor` (it is already parsed — exporting it costs two lines and it
is the missing input for B3's specular term) and `setDefaultShaderSolidColor`
(makes the handful of unresolved-texture surfaces fail the way the game fails).

---

# D. Water

`map-parity.md` and `flythrough-fidelity-gap.md` already closed the big items —
the `water.*` console block is parsed, two scroll layers combine MODULATE2X in
display space, depth-ramped colour and alpha come off a heightmap-derived depth
map, Blinn specular runs off `water.lightDirection`, the env cubemap is sampled
with a fresnel term at a fixed coarse mip, fog is linear. What is left:

## D1 — Four `water.*` directives are undeclared to the parser

**Gap.** `water.baseTex` (16 levels), `water.envmapcolor` (3), and Guadalcanal's
`water.bumpTex` / `bumpTile` / `envIntensity` / `specularBumpmapFactor` are not
in `level.py`'s water branch.

**Ground truth.**
```
Aberdeen  Init/Terrain.con : Water.baseTex texture/Water          (16 levels)
Battle_of_Britain Init.con : water.envmapcolor 0.70/0.80/0.70     (3 levels)
GuadalCanal Init/Terrain.con: Water.bumpTex texture/normalMap
GuadalCanal Init/Terrain.con: Water.bumpTile 0.4
GuadalCanal Init/Terrain.con: Water.envIntensity 0.6
GuadalCanal Init/Terrain.con: Water.specularBumpmapFactor 0.01
El_Alamein Init.con        : water.wateShallowAlpha 0.5           (typo; engine ignores it too)
```
`water.envIntensity` is precisely the reflection strength the current shader
hand-tunes, and `water.envmapcolor` is precisely the tint it does not apply.

**Current state.** `bf42/level.py:920-975` — the water branch handles colour,
deep/shallow colour, two layers, normal map, all six scroll/tile scalars,
specular, alpha depths. No `basetex`, `envmapcolor`, `bumptex`, `bumptile`,
`envintensity`, `specularbumpmapfactor`.

**Size. S.** Six parse lines, four scene.json keys, two shader uniforms
(`envIntensity` and `envmapColor` replace two hand-tuned constants).

**Impact.** Cosmetic and narrow — but `envIntensity`/`envmapcolor` would replace
calibrated guesses with declared numbers on 4 levels, which is exactly the
epistemic upgrade the flythrough doc asks for elsewhere.

## D2 — No bow wave, wake, shoreline foam, splash or water-touch effect

**Gap.** 31 water EffectBundles — the whole "things interact with water" layer —
exist in the data and nothing renders any of them.

**Ground truth.** `Objects/Effects/`: `e_WaterFront`, `e_WaterFrontBig`,
`e_WaterFrontBigSub`, `e_WaterFrontPTBoat`, `e_WaterBackBig/Medium/Small/Raft`,
`e_WaterBoatSvall`, `e_WaterBoatSvallNarrow`, `e_WaterBoatSvallSub`,
`e_WaterShoreSvall`, `e_waterBoatSink`, `e_waterBoatSinkEf`,
`e_waterBoatSinkSmall`, `e_WaterTorpedo`, `e_WaterTouchGuy`,
`e_WaterTouchPlane`, `e_WaterTouchVehicles`, `e_Water06Dive`,
`e_Water06DiveSub7`, `e_Water10BDive`, `e_Water10BDiveBack`, `e_Water510Dive`,
`e_waterImpact`, `e_waterImpactSmall`, `e_explWater01`, `e_WaterExplosion`,
`e_RichoWater`, `e_RichoWaterHeavy`. They use dedicated meshes from
`Objects/Effects/Common/Geometries.con`: `watermesh_m1`, `watermesh_streak_m1`,
`watermesh_streak1_m1`, `watermesh_ring_m1`, `Richo_WaterBase_m1`.

The bow wave is a *speed-driven, mesh-particle* effect, not a shader term
(`e_WaterFront`, abridged):

```con
ObjectTemplate.create Emitter Em_WaterFront
ObjectTemplate.looping 1   ObjectTemplate.startAtCreation 1
ObjectTemplate.addEmitterSpeed 1   ObjectTemplate.emitterSpeedScale 1
ObjectTemplate.lodDistance 600
ObjectTemplate.intensity CRD_UNIFORM/5/20/0
ObjectTemplate.IntensityAtSpeed 10          rem rate scales with hull speed
ObjectTemplate.relativePositionInRight CRD_NONE/1.3/0/0     rem starboard bow
ObjectTemplate.positionalSpeedInUp CRD_NONE/4/0/0
ObjectTemplate.create Particle Fx_WaterFrontMesh
ObjectTemplate.geometry watermesh_m1
ObjectTemplate.sizeModifier 2/1/3
ObjectTemplate.sizeOverTime 0/1.10007|100/3.20005
```

and the bundle is gated to the waterline with
`minDistanceUnderwaterSurface 0` / `maxDistanceUnderwaterSurface 10`, with
`moveToWaterSurface 1` on the impact emitters.

**Current state.** Blocked on A1 (`IntensityAtSpeed`, `sizeModifier`,
`alphaOverTime`, `moveToWaterSurface`, the Up/Right axes are all unparsed) and
A2 (most of these are alpha-blended). The water shader
(`map.html:988-1170`) does colour, alpha, specular and reflection and has no
concept of a disturbance.

**Size. M** after A1/A2. The `watermesh_*` meshes already extract through the
normal path. **Impact:** cosmetic; but a boat with no wake is the most obvious
single "this is not the game" tell on the naval maps, and it is the only water
gap left that the engine solves with geometry rather than a shader.

## D3 — No underwater rendering

**Gap.** Below the waterline the viewer renders the world exactly as above it.

**Ground truth.** The engine gates effects on submersion —
`minDistanceUnderwaterSurface` / `maxDistanceUnderwaterSurface`, 20 declarations
each across the bundles — so it has a submersion test. No level declares an
underwater fog colour or density in any vanilla `.con`
(surveyed all 23; the `renderer.*` namespace has no underwater member).

**Current state.** `grep -n "underwater" viewer/map.html` -> nothing. The water
quad is `THREE.DoubleSide` with `depthWrite: false` (`map.html:1054-1057`), so
from below you see the surface shader's topside appearance and unfogged terrain
beyond it.

**Size. S** for a plausible-looking tint+fog swap on submersion; **UNVERIFIED**
what the engine actually does, and there is no declared data to drive it — so
anything built here is invention, not parity. Recorded mainly so it is not
mistaken for a data gap.

**Impact.** Cosmetic and rare (the flythrough can fly under water; nothing else
goes there).

---

# E. Level data the viewer ignores

Collected from `bf42/level.py` and the vanilla level survey. C2, C3, C4 and C6
above are the significant ones. The remainder:

## E1 — `MaterialMap.raw` + `TerrainPalette.pal` unparsed (already recorded)

Per-patch terrain surface classification. `map-parity.md` already lists it under
"Expensive but possible". Its *new* significance is gap A3: without it, an impact
on terrain cannot look up a defender material, so the per-surface impact effect
cannot be selected even with the table in hand. It is the blocker on the terrain
half of A3 (statics carry `ObjectTemplate.material`, 136 declarations, which is
already parsed at `con.py:574-578`).

**Size. M** (undocumented format; the palette side is small). **Impact:**
structural, but only as a dependency of A3.

## E2 — Objects whose only content is an effect vanish without a report entry

Covered under C5; restating as a pipeline gap: `scene.json`'s `objects.skipped`
and `objects.unresolvedTemplates` do not include "placed, resolved, produced no
geometry". Tobruk reports `skipped: [1]`, `unresolvedTemplates: [1]`,
`missingMeshes: []` — a clean bill of health that a silently-empty effect bundle
would not disturb. **Size S. Impact:** diagnostic only, but it is why C5 was
invisible until this audit.

## E3 — `GeometryTemplate.shadowColor`, `GeometryTemplate.hasDynamicShadow` in level-local objects

Kharkov declares `GeometryTemplate.shadowColor 0.2/0.3/0.6` (8 statements) in its
own `StaticObjects.con`, and Battle_of_Britain / Caen / Kasserine declare
`hasDynamicShadow` on level-local templates (38 statements). Unparsed; subsumed
by C4. **Size S. Impact:** negligible.

---

# Priority

Sorted by impact per unit of work. "Blocked by" names the gap that must land
first, not a general dependency.

| # | gap | size | impact | blocked by |
|---|---|---|---|---|
| 1 | **B1** `alphaTestRef` unparsed — 11 surfaces opaque, 50 wrongly blended | S | visible bug, wrong today | — |
| 2 | **C2** 8 levels get invented fog (`renderer.fogStart/fogEnd`) | S | wrong atmosphere on 8/23 maps; undercuts shipped fog work | — |
| 3 | **C3** Midway + Truk get grey default fog colour (`setFogColorVec`) | S | wrong atmosphere on 2/23 maps | — |
| 4 | **A3** impact-effect table (4,929 rows) never read | S (extract) / M (render) | structural — the whole hit-feedback layer | A1+A2 to *render*; extraction is standalone |
| 5 | **B7** scrolling UVs work in `index.html`, absent in `map.html` | S | cosmetic; code already exists and is debugged | — |
| 6 | **C6** `renderer.specularColor` parsed and never exported | S | two lines; unblocks B3's specular term | — |
| 7 | **D1** four `water.*` directives unparsed (`envIntensity`, `envmapcolor`, bump set) | S | replaces hand-tuned constants with declared data on 4 levels | — |
| 8 | **A1** emitter data model 80% unparsed (`intensity`, cone, flipbooks, drag, rotation) | L | structural — every particle gap is downstream | — |
| 9 | **A2** additive-only filter drops 56% of payloads; 102/216 bundles invisible | M | structural — smoke, dust, fire, damage | A1 |
| 10 | **B2** `envmap true` on 494 materials dropped; cubemap already extracted | M | biggest single material look gap (all glass) | — |
| 11 | **C1** sun lens flare + corona, 21/23 levels, fully declared | M | high perceptual value; data complete | flare textures sourced from bfheroes |
| 12 | **B3** `materialDiffuse` / specular set / `depthWrite false` dropped | S / M | 383 too-bright + 1,020 unlit-specular + 77 depth bugs | C6 for `specularColor` |
| 13 | **C4** no dynamic object shadows; 4 shadow directives unused | S (blob) / M (shadow map) | conspicuous — a flown aircraft casts nothing | — |
| 14 | **D2** bow wave / wake / splash / shore foam (31 bundles) | M | most obvious naval-map tell | A1, A2 |
| 15 | **A4** damage-state effects (`addArmorEffect`, 430 decls) | S / M | cosmetic now, structural if wrecks arrive | A1, A2 |
| 16 | **C5** mod weather placed but renders nothing (42 levels) | S (diag) / M (render) | structural for mod maps already served | A1, A2 |
| 17 | **A5** shell casings strobed in place, not ejected | S | cosmetic, high cockpit visibility | A1 |
| 18 | **A6** decals extracted and unreachable | S | cosmetic; cheapest possible particle | A3 |
| 19 | **B6** transparency sorting / `depthWrite` policy | S / M | cosmetic; mostly cured by B1 | B1 |
| 20 | **E1** `MaterialMap.raw` + `TerrainPalette.pal` | M | blocker on the terrain half of A3 | — |
| 21 | **B4** `textureFade true` (69 materials) | S | cosmetic, bounded, semantics UNVERIFIED | — |
| 22 | **C6** remaining small directives (`animatedMesh*`, `Cloud.set*Blend`, `setDefaultShaderSolidColor`, `mipmaps`) | S | negligible individually | — |
| 23 | **E2** empty-effect placements not reported | S | diagnostic | — |
| 24 | **B5** `.sm` per-material render-flag word discarded | S | negligible; useful as a validation oracle | — |
| 25 | **D3** no underwater rendering | S | cosmetic, rare, and no declared data to drive it | — |
| 26 | **E3** level-local `shadowColor` / `hasDynamicShadow` | S | negligible | C4 |

---

# Already covered — not re-reported

Verified present in the code, and excluded from the gap list above:

- **Muzzle flashes** as EffectBundle emitters with size/colour ramps, DOF motion
  and first/third-person view selection — `assemble.py:710-788`,
  `gunfire.js:212-320`, `firing-effects.md`.
- **Typed projectiles** (bullet / shell / rocket), `visibleDummyProjectileTemplate`,
  `setEngineType c_ETRocket`, gravity, ttl — `assemble.py:806-930`,
  `firing-effects.md`.
- **Tracers**: `setTracerTemplate` interval, `tracerScaler`, the real 0.006 m
  `TLight_m1` streak, screen-space minimum width, convergence —
  `gunfire.js:37-78`, commit `69b095d`.
- **Rocket / shell smoke trails** as pooled billboard puffs —
  `assemble.py:827-871`, `gunfire.js:67`.
- **Additive blending** end-to-end: `blendDest one` detection (`rs.py:54-62`),
  glTF `extras.additive` (`gltf.py:244-250`), viewer honouring it
  (`gunfire.js:228-229`).
- **`lighting false` -> unlit** and `KHR_materials_unlit` — `rs.py:49`,
  `gltf.py:256-266`.
- **Alpha-tested foliage via the brace syntax** (`alphaTest greater 0.7`, 127
  blocks in `Art/*.rs`) — `rs.py:34`, `assemble.py:438`. (The subshader spelling
  is gap B1.)
- **Foliage translucency floor / light palm fronds** — `assemble.py:648-655`,
  `gltf.py:235-243`, commit `08662ca`.
- **Object lightmaps** (atlas, flipY, modulate-2x, replaces analytic lighting) —
  `map.html:672-760`, commit `10970b9`.
- **Engine-faithful dynamic shading** (MODULATE2X in display space, verified
  against the decompiled renderer) — `map.html:762-875`, commit `f713a82`.
- **Terrain pre-lit tiles + detail combine + anisotropy** — `map.html:560-660`.
- **Sky mesh, `setRotAngle`, `changeOfsSkyHeight`, unlit/fog-free, camera-locked** —
  `map.html:877-936`, `map-parity.md`.
- **Clouds, data-driven** (`Sky.addCloud` only when a live cloud geometry is
  declared; vanilla correctly emits `"clouds": null`) — `level.py:841-903`,
  `extract_map.py` `write_cloud_assets`, `flythrough-fidelity-gap.md`.
- **Fog, draw distance, far-plane clamp** (`Game.setViewDistance`,
  `max(VD, fogEnd) * 1.05`) — `map.html:1700-1742`,
  `flythrough-fidelity-gap.md`. (The `fogStart/fogEnd` spelling is gap C2.)
- **Water**: full `water.*` block, two-layer MODULATE2X in display space,
  depth-derived colour/alpha, Blinn specular, env-cubemap fresnel at a fixed
  coarse mip, linear fog — `map.html:988-1176`, commit `636b633`.
- **Env cubemap extraction** (`ENVMAP_G_.rcm` -> 6 faces, `scene.json.envmap`).
  (Its use on *meshes* is gap B2.)
- **`textureManager.alternativePath`** theatre skin resolution — `rfa.py:83-84`,
  `rfa.py:271-301`.
- **Flag cloth animation** (`FlagBlow` clips, per-team geometry swap) —
  `map.html:353-374`, `con.py:505-515`.
- **`LightmapShadowBits.lsb`** terrain cast shadows — the documented ceiling
  (`map-parity.md`); restated only as context in C4.
- **Rendering technology**: three.js/WebGL, no WASM/WebGPU
  (`rendering-technology.md`). Nothing in this document changes that — every gap
  here is an extraction or a GLSL/instancing problem, and the heaviest
  (A1+A2, a few thousand instanced billboards) is routine for WebGL2.
