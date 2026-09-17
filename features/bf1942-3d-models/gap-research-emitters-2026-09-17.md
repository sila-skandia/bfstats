# Gap research — Emitter / EffectBundle extraction

Date: 2026-09-17. Mission B from [`gap-research-2026-09-17.md`](gap-research-2026-09-17.md).

Sources: [`parity-gaps.md`](parity-gaps.md) keystones 3–5, [`parity-audit/effects-materials.md`](parity-audit/effects-materials.md) A1–A2, [`impact-effects.md`](impact-effects.md), `tools/bf1942-models/bf42/{con,effects,assemble}.py`, vanilla `Mods/bf1942/Archives/Objects.rfa`, Ghidra `BF1942.exe` string xrefs (no re-analyse).

## Verdict

| Claim in parity docs | Live status |
|---|---|
| A1 — `intensity` unparsed (355 emitters) | **Closed before this pass.** `con.py` stores raw `effect_props`; `effects.py` maps `intensity` via `_EMITTER_CRD` and the viewer clock uses `|1/intensity|`. |
| A1 — emitter model ~80% unparsed | **Stale.** After this pass every Emitter `effect_props` key seen in vanilla maps into `emitter_spec`. Remaining gaps are particle-side (`hasStaticColor`, …) and runtime (viewer does not yet gate on `hasOverDamage`). |
| A2 — 102/216 bundles bake empty | **Still true for vehicle/map bake** (`Assembler._effect_emitter_nodes` BMOne filter). **Not true for `extract_effects.py`** (`bundle_tree` + alpha sprites): only **23/215** are empty. |

**Patched this session:** map `hasOverDamage`, `intensityOverTime`, `isSpawnEffect`; capture EffectBundle `addWorkOnMaterial` (and underwater/lod/startOn) written after `addTemplate`. Unit tests in `tests/test_effects.py`. No full map re-extract.

## Pipeline (two bake paths)

```
Objects.rfa *.con
    -> con.ObjectLibrary  (effect_props on EffectBundle/Emitter/Particle)
         |
         +-- effects.bundle_tree / emitter_spec     -> extract_effects.py -> _shared/effects.glb
         |     (all blends; nested bundles; debris meshes)
         |
         +-- assemble._effect_emitter_nodes         -> vehicle/map GLBs
               (SpriteParticle only if destBlendMode BMOne; no nested walk)
```

Impact play uses the first path ([`impact-effects.md`](impact-effects.md)). Muzzle flashes on vehicles still use the second.

## Emitter field coverage (vanilla Objects.rfa)

Census: **363** Emitter templates. Counts are occurrences of that property in Emitter blocks. `MAPPED` = present in `effects.py` `_EMITTER_*` (or typed `template` / view flags).

| property | count | mapped | notes |
|---|---:|---|---|
| `template` | 361 | yes | payload name |
| `timeToLive` | 359 | yes | CRD — emitter emit window |
| **`intensity`** | **354** | **yes** | particles/s; Ghidra `ObjectTemplate.intensity` @ `0x008ebc28` |
| `startRotation` | 340 | yes | CRD roll about DOF |
| `lodDistance` | 301 | yes | float |
| `addEmitterSpeed` / `emitterSpeedScale` | 245 / 245 | yes | inherit host velocity |
| `positionalSpeedInDof/Up/Right` | 195 / 173 / 162 | yes | spawn velocity cone |
| `relativePositionInDof/Up/Right` | 178 / 155 / 90 | yes | spawn box |
| `looping` | 127 | yes | |
| `startAtCreation` | 87 | yes | |
| `rotationalSpeedInRight/Up/Dof` | 81 / 66 / 60 | yes | mesh tumble |
| `IntensityAtSpeed` | 49 | yes | rate × speed scale |
| **`hasOverDamage`** | **33** | **yes (this pass)** | bool; client string `0x008eba18` |
| `moveToWaterSurface` | 30 | yes | |
| `startProbability` | 28 | yes | |
| `delay` | 27 | yes | |
| **`intensityOverTime`** | **23** | **yes (this pass)** | curve; 8 authored with empty args (no-op); string `0x008ebc04` |
| `addChild` | 19 | yes | |
| `showInThirdPerson` / `First` | 17 / 6 | yes | view gate |
| `noPhysics` | 11 | yes | |
| **`isSpawnEffect`** | **2** | **yes (this pass)** | raft spawns; string `0x008eb954` |
| `useCameraOrientation` | 0 in vanilla | yes | map ready |

Parity A1’s “11 of ~45 parsed” described an older `con.py` typed-field set. Today raw capture + `effects.py` covers the Emitter serialiser vocabulary confirmed in `EmitterTemplate::makeScript` (ledger / `symbols.json`).

### Particle-side leftovers (not Emitter)

Still unmapped into `particle_spec` (low count): `hasStaticColor` (35), `alphaTestRefOverTime` (4), `useMipMap` typo (1), `useUVRotation` (1). Flipbooks (`numAnimationFrames`, …) already land.

## EffectBundle props

| property | authored | before this pass | after |
|---|---:|---|---|
| `saveInSeparateFile` | 191 | captured (before `addTemplate`) | same |
| `loadSoundScript` | 83 | captured | same |
| `timeToLive` (bundle-level, before children) | 29 | captured | same |
| **`addWorkOnMaterial`** | **48 lines / 9 bundles** | **dropped** (`child is not None`) | **`work_on_materials: list[int]`** + baked as `extras.effectBundle.workOnMaterials` |
| `min/maxDistanceUnderwaterSurface` | 20 / 20 | dropped after `addTemplate` | in `effect_props` + bake extras |
| `lodDistance` | 15 after children | dropped | captured when after `addTemplate` |
| `setStartOnEffects` | 8 | dropped | captured |

Child-instance `timeToLive` / `setPosition` / `setRotation` after `addTemplate` remain child-scoped (unchanged).

## Why ~102/216 EffectBundles export empty

Parity count: **102 of 216** with zero geometry. Live Objects.rfa: **215** EffectBundles; **101** produce zero nodes under `_effect_emitter_nodes` (direct children only, additive sprites only). That is the number the audits measured.

Breakdown of those **101**:

| cause | count | examples |
|---|---:|---|
| Alpha-only sprites (`BMInvSourceAlpha` smoke/dust/blood) | 41 | `e_BuildingSmoke`, `e_Blood01`, `e_AA-GunDamage` |
| Debris / scrap payloads (`SimpleObject` / non-sprite) not accepted by BMOne path | 18 | `e_ScrapMetal_*`, `e_shellAAgun`, wreck rafts |
| Nested EffectBundle children only (filter does not recurse) | 17 | `BazookaCascadesStone`, `Exp2Cascades*` |
| Sound-only (`Em_Silent` / missing payload) | 12 | `e_collision_*`, `e_Barbwire` |
| Mixed / empty damage stubs | 13 | `GroundExplDry` (alpha + nested), bare `e_*Damage` with no children |

Same library through **`bundle_tree`** (effects.glb path): **23 empty** — almost entirely sound-only and empty armor-damage stubs (`e_AichiValDamage`, …). Smoke and cascades bake.

So the “56% empty” figure is a **vehicle-bake filter**, not a missing parser for `intensity`. Fixing empty exports for atmosphere means dropping or relaxing the BMOne gate in `_effect_emitter_nodes` (and recursing nested bundles), not another CRD field.

## Ghidra (optional, no global analyse)

Open program `/BF1942.exe`. String hits confirming the words this pass wired:

| address | string |
|---|---|
| `0x008ebc28` | `ObjectTemplate.intensity ` |
| `0x008ebc04` | `ObjectTemplate.intensityOverTime ` |
| `0x008eba18` | `ObjectTemplate.hasOverDamage ` |
| `0x008eb954` | `ObjectTemplate.IsSpawnEffect ` |
| `0x008fc124` | `ObjectTemplate.addWorkOnMaterial ` |
| `0x008efdc0` | `EffectBundle` |

Matches prior ledger notes on `EmitterTemplate::makeScript` (client `0x005097a0`).

## Code touched

- `bf42/effects.py` — `_EMITTER_CURVE` (`intensityOverTime`); bools `hasOverDamage`, `isSpawnEffect`
- `bf42/con.py` — `_EFFECT_BUNDLE_SCOPED`; `ObjectTemplate.work_on_materials`
- `bf42/assemble.py` — bake `workOnMaterials` / underwater / lod / startOn into bundle extras
- `tests/test_effects.py` — coverage for the three Emitter words + material list capture

## Still open (not this pass)

1. **`_effect_emitter_nodes` BMOne filter** — root of the 101 empty vehicle attachments.
2. **Viewer runtime** for `hasOverDamage`, `intensityOverTime`, `workOnMaterials` (spec is now present; play logic is not).
3. **Sound** on bundles (`loadSoundScript`) — samples not extracted.
4. **Particle** leftovers listed above.
5. Re-extract of maps/effects.glb — intentionally skipped; next effects bake picks up the new fields.
