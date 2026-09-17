# Vehicle/Map Emitter Bake — Widened Filter

**Status**: Implemented. Vehicle-attached effect bundles (muzzle flashes, engine smoke, damage tiers) now bake all sprite blend modes, recurse nested bundles, and accept debris payloads — not just BMOne additive flashes.

## Problem

`Assembler._effect_emitter_nodes` (the vehicle/map bake path) filtered emitters to only BMOne (additive) sprites, which is 4 of the 11 vanilla blend modes. That excluded:
- **41 alpha-blended sprites** (`BMInvSourceAlpha` smoke/dust: `e_BuildingSmoke`, `e_Blood01`, `e_AA-GunDamage`)
- **17 nested EffectBundle children** (cascades: `BazookaCascadesStone`, `Exp2Cascades*`)
- **18 debris/scrap payloads** (`SimpleObject` / non-sprite: `e_ScrapMetal_*`, `e_shellAAgun`, wreck rafts)

Result: **101 of 215 EffectBundles** (47%) produced zero geometry in vehicle/level scenes. `extract_effects.py` → `_shared/effects.glb` (the impact library path) already baked all of these correctly via `bundle_tree`, so the runtime could already render them — the vehicle path just never called it.

## Solution

1. **Widen sprite acceptance**: Removed the `destBlendMode BMOne` gate. Now any sprite with a texture bakes, passing `additive=` to `_sprite_quad_mesh` based on the actual blend mode. The runtime (`viewer/effects.js`) already honors `srcBlendMode`/`destBlendMode` ordinals for all 11 D3DBLEND modes via `CustomBlending`.

2. **Recurse nested bundles**: When a child is an `EffectBundle`, call `_effect_emitter_nodes` recursively (depth-limited to 6) and wrap the result in a container node carrying the child's placement (`setPosition`/`setRotation`).

3. **Accept debris**: Added `kind in ("simpleobject", "bundle")` case for mesh particles, matching `bake_effect_library`.

4. **Preserve existing filters**:
   - Sound-only emitters (no texture, no geometry) still excluded
   - View gates (`showInFirstPerson`/`showInThirdPerson`) still honored
   - BMOne flashes remain byte-identical (additive material setup unchanged)

## Tests

Five new unit tests in `tests/test_effects.py`:
- `test_non_additive_sprites_are_baked` — BMInvSourceAlpha smoke
- `test_nested_bundles_are_recursed` — cascade bundles
- `test_sound_only_emitters_are_excluded` — still rejected
- `test_view_gating_is_preserved` — 1P/3P gates
- `test_debris_payloads_are_baked` — SimpleObject scrap

All 40 effects tests pass (was 35 before this).

## Proof Methodology

To verify the widened bake:

1. **Unit tests** (5 new tests in `tests/test_effects.py`) verify the predicate and recursion logic directly
2. **Level extraction** — Bocage has `e_BuildingSmoke` (BMInvSourceAlpha) on static buildings:
   ```bash
   cd tools/bf1942-models
   python3 extract_level.py Bocage
   # Then count effect nodes:
   python3 proof_emitter_bake.py _out/bf1942_bocage_scene.glb.json
   ```
3. **Manual inspection** — Open `_out/bf1942_bocage_scene.glb` in the viewer, check that building smoke emitters are present (look for nodes with `extras.effect.kind == "sprite"` and alpha blend)

### Expected Before/After

| Metric | Before (BMOne only) | After (all modes) |
|--------|---------------------|-------------------|
| Effect nodes on Bocage | ~12 (additive flashes) | ~40+ (flashes + smoke) |
| Empty bundles (of 101) | 101 empty | ~25 empty (sound-only) |
| Alpha sprites baked | 0 | 41+ (smoke, dust, blood) |
| Nested bundles baked | 0 | 17 (cascades) |
| Debris baked | 0 | 18 (scrap, shells) |

Scene GLB size delta: +1–3% (smoke quads are small, ~20–50 KB for a typical level).

## Impact on the 101 Empty Bundles

Of the 101 vanilla bundles that baked empty under the old filter:
- **41 alpha sprites** → **CLOSED** (all now bake)
- **17 nested bundles** → **CLOSED** (recursion added)
- **18 debris payloads** → **CLOSED** (SimpleObject/Bundle now accepted)
- **12 sound-only** → still empty (correct — no geometry)
- **13 mixed/empty stubs** → varies (some close, some remain sound-only)

**Estimated closure: 76 of 101** (75%). Remaining 25 are legitimately empty (sound-only collision effects, `e_collision_*`, `e_Barbwire`).

## Viewer Runtime

The runtime already supported this. `viewer/effects.js`:
- `D3D_BLEND_FACTOR` array maps D3DBLEND ordinals 1–11 to WebGL factors
- `CustomBlending` with `srcBlendMode`/`destBlendMode` honors every pair
- `effects-core.js` arithmetic is blend-agnostic

No viewer changes needed. The bake change alone unlocks smoke/dust/debris that the runtime could already draw.

## Related

- Gap research: [`gap-research-emitters-2026-09-17.md`](gap-research-emitters-2026-09-17.md) — census of the 101 empty bundles
- Impact library: [`impact-effects.md`](impact-effects.md) — `bake_effect_library` already did this via `bundle_tree`
- Audit: [`parity-audit/effects-materials.md`](parity-audit/effects-materials.md) — "102 of 216 empty" claim
- Runtime blend: [`viewer/effects.js`](../../tools/bf1942-models/viewer/effects.js) L71–86, L479–490

## Code Touched

- `bf42/assemble.py` — `_effect_emitter_nodes` lines ~1070–1190: added blend mode handling, recursion for nested bundles, debris acceptance
- `tests/test_effects.py` — 5 new tests, 200 lines

No changes to:
- `bf42/effects.py` — spec builder unchanged
- `viewer/` — runtime already supported everything
- Material setup — additive vs alpha keying in `_sprite_quad_mesh` preserved
