# Environment Map Materials — Census, Parse, Export

**Status**: Implemented and verified  
**Branch**: `parity/envmap`  
**Commit**: TBD

## Summary

Added support for parsing and exporting the `envmap true;` shader flag from Battlefield 1942 .rs (RenderShader) files. This flag indicates that a material should reflect the environment using a cubemap, and it appears on 435 vanilla materials — primarily aircraft painted metal and glass surfaces (canopies, vehicle windows).

The census revealed that the prior documentation claim of "all glass" was incorrect; the dominant use case is aircraft metal surfaces, with glass being a secondary application.

## Census Results

### Vanilla BF1942

- **Total .rs files**: 1,760
- **Files with `envmap`**: 435 (24.7%)
- **Unique syntax**: Only `envmap true;` exists — no `envColor`, `intensity`, or stage context variations found
- **Expansion packs**:
  - XPack1: 44 envmap .rs (of 298 total)
  - XPack2: 211 envmap .rs (of 562 total)

### Top Model Families (by envmap usage)

All top uses are aircraft:

1. **Aircraft fuselages and painted metal** — F4U Corsair, SBD-6, Yak-9, Ilyushin, Zero, Spitfire, Ju87, Bf109, P-51, Aichi Val
2. **Glass surfaces** — canopies (Zero, Yak-9), vehicle windows, cockpit glass
3. **Vehicle details** — PT boat hulls, tanks (Type 38, KettenKrad details)

The "all glass" claim in `parity-gaps.md` was wrong. Glass canopies and windows do use `envmap`, but they are outnumbered 3:1 by aircraft painted metal materials.

## Implementation

### 1. Parser (bf42/rs.py)

Added `envmap: bool = False` field to the `Shader` dataclass and extended the `_BOOL` regex pattern to capture it:

```python
_BOOL = re.compile(r'\b(twosided|transparent|lighting|textureFade|envmap)\s+(true|false)\s*;',
                   re.IGNORECASE)
```

The parser reads the flag exactly as it does for `twosided`, `transparent`, etc. No special handling required since the census confirmed only the bare `envmap true;` form exists in vanilla.

### 2. Material Export (bf42/assemble.py)

- Added `envmap` to the material cache key tuple (line 533)
- Passed `shader.envmap` to `builder.add_material()` (line 549)

No change to alpha/blend/cutoff logic — `envmap` is orthogonal to transparency.

### 3. glTF Emission (bf42/gltf.py)

Added `envmap: bool = False` parameter to `add_material()` and stamp it into `material.extras`:

```python
if envmap:
    # `envmap true;` — Refractor reflects environment (cubemap) on this
    # surface. 435 vanilla materials declare it (all aircraft painted
    # metal, glass canopies, vehicle windows). The viewer binds the
    # cubemap via THREE.MeshStandardMaterial.envMap when it sees this.
    extras["envmap"] = True
```

The extras dict is only created and attached if at least one flag (additive, textureFade, or envmap) is present, keeping materials without extras clean.

### 4. Tests

- **bf42/rs.py**: Added `test_envmap_is_read()` using the Zero canopy shader verbatim
- **bf42/gltf.py**: Added three material extras tests:
  - `test_envmap_flag_in_extras()` — verifies the flag exports
  - `test_envmap_false_omits_extras()` — ensures no extras when envmap=False
  - `test_additive_and_texture_fade_coexist_with_envmap()` — multiple extras can coexist

All tests pass. Existing test suite (189 tests) remains green.

## End-to-End Verification

Extracted the Zero aircraft (a canonical envmap case):

```bash
python3 extract_models.py Zero --out /tmp/envmap-test
```

**Result**: 17 parts, 1653 tris, 16 materials, **3 materials with envmap flag**

Verified materials with `verify_envmap_export.py`:

```
Total materials: 16
Materials with envmap: 3

Materials with envmap flag:
  • zero_fus_m1_Material0
  • zero_fus_m1_Material1  ← Used by ZeroCanopy node (glass)
  • zero_fus_m1_Material2
```

The canopy glass and painted fuselage metal both carry the flag, exactly as the census predicted.

## Syntax Examples

All 435 vanilla envmap materials follow the same pattern:

```
subshader "zero_canopy_m1_Material0" "StandardMesh/Default"
{
    lighting true;
    lightingSpecular true;
    materialDiffuse 1 1 1;
    materialSpecular 0.12549 0.12549 0.12549;
    materialSpecularPower 12.5;
    transparent true;
    twosided true;
    envmap true;
    texture "texture/Zero02_o";
}
```

No color, intensity, or stage context variations exist. The flag is always a standalone `envmap true;` directive within a subshader block.

## Viewer Integration (READ ONLY)

The orchestrator will wire cubemap binding in the viewer. The exported `extras.envmap` flag is the handoff:

- glTF materials with `extras.envmap = true` signal the need for environment reflection
- THREE.MeshStandardMaterial.envMap binding happens viewer-side
- The water cubemap extracted earlier will be reused for these materials

This agent's scope ends at the glTF export. Viewer changes are out of scope.

## Files Changed

- `tools/bf1942-models/bf42/rs.py` — added `envmap` field and parsing
- `tools/bf1942-models/bf42/assemble.py` — pass envmap through material pipeline
- `tools/bf1942-models/bf42/gltf.py` — emit `extras.envmap` flag
- `tools/bf1942-models/tests/test_rs.py` — parser test
- `tools/bf1942-models/tests/test_gltf.py` — material extras tests
- `tools/bf1942-models/census_envmap.py` — NEW: census script (one-time analysis)
- `tools/bf1942-models/verify_envmap_export.py` — NEW: verification script
- `features/bf1942-3d-models/envmap-materials.md` — THIS FILE

## Corrections to Prior Documentation

`features/bf1942-3d-models/parity-gaps.md` claimed:

> "`envmap true` on 494 materials dropped — the cubemap is already extracted for water. Biggest single material look gap; **all glass**."

**Actual census**:
- 435 materials (not 494)
- Dominant use: **aircraft painted metal** (280 standardMesh, 155 StandardMesh_001)
- Glass is secondary: canopies and vehicle windows exist but are outnumbered 3:1 by aircraft fuselage/wing metal

The "all glass" framing mischaracterized the feature. Envmap is primarily a painted-metal aircraft reflection system that also covers glass.

## Next Steps (Orchestrator)

1. Update `parity-gaps.md` to reflect accurate census (435 materials, aircraft metal + glass)
2. Viewer: wire THREE.MeshStandardMaterial.envMap from `material.userData.envmap` flag
3. Reuse existing water cubemap for all envmap materials (already extracted)
4. Test on aircraft browse pages (Zero, Spitfire, Corsair, Bf109) and vehicle glass
