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


---

# The viewer binding (2026-09-19, stream D)

The export above landed in `parity/envmap` and nothing read it. It is bound
now, in both `map.html` and the model browser `index.html`, and the strength
is not a number anyone picked.

## What the engine does

The whole stage is one branch of the StandardMesh sub-shader's
`applyRenderState` — the vtable
`dice.ref2.rend.SubShaderBuilder.StandardMesh` (0x009061a4) slot +0x10,
0x005bf690, whose envmap branch runs 0x005bfa80 to 0x005bfdc4. Ghidra had
lost the function again; it was recreated at that proved vtable slot and
cross-read against `objdump -d -M intel` on the retail client.

| step | address | what |
|---|---|---|
| gate | 0x005bfa80 | the material's `envmap` byte (+0x30) is set |
| | 0x005bfa8b | AND the draw context's +0x18 (the level cubemap) is non-NULL |
| | 0x005bfa99 / 0x005bfaa6 | AND neither global kill-switch `0x009abf79` / `0x009abf7a` |
| stage 1 | 0x005bfab3 | bind ctx+0x18 to texture stage 1 (`FUN_006039c0`, fastcall ecx = stage = 1, edx = texture) |
| | 0x005bfad1 | `D3DTSS_TEXTURETRANSFORMFLAGS = 3` (`D3DTTFF_COUNT3`) |
| | 0x005bfaf7 | `D3DTSS_TEXCOORDINDEX = 0x30000` (`D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR`) |
| | 0x005bfc61 | `ALPHAOP = SELECTARG1`, `ARG1 = CURRENT`, `ARG2 = DIFFUSE` |
| | 0x005bfcc6 | `COLOROP = 0x10` — **`D3DTOP_BLENDCURRENTALPHA`** |
| | 0x005bfce1 / 0x005bfcf2 | `COLORARG1 = D3DTA_CURRENT`, `COLORARG2 = D3DTA_TEXTURE` |
| stage 2 | 0x005bfd03 | `COLOROP` / `ALPHAOP = D3DTOP_DISABLE` |
| undo | 0x005bee20 (+0x14) | restores stage 1 `TEXTURETRANSFORMFLAGS = 0` (0x005beef3) and `TEXCOORDINDEX = 1` (0x005bef17), gated on the same +0x30 byte it reads at 0x005beed4 |

`D3DTOP_BLENDCURRENTALPHA` is `Arg1 * A + Arg2 * (1 - A)`, where A is the
alpha of CURRENT — i.e. whatever comes out of stage 0. **Stage 0's alpha op is
set once for the whole StandardMesh path**, at 0x005c0201:
`setAlphaOp(stage 0, D3DTOP_SELECTARG1, D3DTA_TEXTURE, D3DTA_DIFFUSE)` — three
instructions after the same function loads the level cubemap into ctx+0x18
(0x005c01dd, by the name at 0x009061c0). So:

```
A        = the material's own diffuse-texture ALPHA CHANNEL
out.rgb  = lit.rgb * A + cube.rgb * (1 - A)
out.a    = A
```

**There is no reflectivity constant in the stage at all.** The strength is a
per-texel mask that already ships inside the art, and it is inverted: alpha
255 is matte, alpha 0 is a mirror.

### The masks are real, and graded the way you would hope

Measured on freshly re-extracted glbs (`glb_alpha.py`, a scratch script that
reads each material's base-colour PNG back and histograms its alpha):

| material | alpha range | mean | max reflection |
|---|---|---|---|
| `zero_fus_m1_Material0` (painted fuselage) | 242–255 | 248.0 | 5% |
| `zero_fus_m1_Material1` / `Material2` (canopy glass) | 120–255 | 205.4 | 53% |
| `Corsair_hull_m1_Material0` / `Material1` | 119–255 | 236.5 | 53% |
| `Corsair_cock_m1_Material0` | 102–255 | 189.1 | 60% |
| `militable_m1_Material0`, `stebarrel1_m1_Material0`, `planeeng_m1_Material0` | 255–255 | 255.0 | **0%** |

Paint stays paint, glass shines, and three of Wake's fourteen `envmap`
materials reflect nothing at all — which is the engine's result too, not a
failed binding. The model browser's readout says so in words for exactly this
reason.

### Two consequences worth knowing

- **The reflection is camera-locked.** `D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR`
  builds the reflection vector in VIEW space, and with `TEXTURETRANSFORMFLAGS`
  only ever toggled between 3 and 0 (and no matrix written by either function
  that touches it) the transform is identity, so the cube is indexed by that
  view-space vector directly. That is the DX7/8-era chrome sheen that swims as
  you orbit the aircraft rather than a world-stable mirror. Reproduced as-is.
  The identity transform is an inference from the flags; nobody read a
  `SetTransform(D3DTS_TEXTURE1)`.
- **Envmap costs the material its texture-fade stage.** The non-envmap path
  (0x005bfdcb onward) uses the same stage 1 for `MODULATE(CURRENT, TFACTOR)`,
  the distance fade. The two branches are exclusive in the binary. We model
  neither fade on these materials, so nothing is lost here — but it explains
  the structure.

## Where it lives

`viewer/envmap.js` holds the rule as GLSL text plus two predicates and imports
no `three`, so `tests/test_envmap.py` drives the real module under node with
no WebGL and no assets (10 tests).

- **`map.html`** binds it inside the existing `bindDynamicShading` pass, right
  after that pass writes stage 0's own `MODULATE2X(TEXTURE, DIFFUSE)` — which
  is exactly where stage 1 belongs, because `CURRENT` is stage 0's output. The
  level cubemap moved out of `setupWater` into `setupEnvCube`, so a level with
  no water still reflects; the water's fresnel term now shares that one cube
  instead of loading its own. Materials with the flag get a separate program
  cache key.
- **`index.html`** has no level and therefore no engine-true answer to "whose
  sky". Rather than baking one in it lists the extracted levels for the active
  mod, remembers the choice, and takes `?env=<level>` in a link. It keeps
  GLTFLoader's `MeshStandardMaterial` under its own neutral rig on purpose
  (the page exists to show what the extraction produced), so the stage is
  applied to `outgoingLight` just before `<opaque_fragment>` — the same
  position relative to that page's shading that stage 1 has relative to
  stage 0.

One trap worth recording: a glTF material is shared by many meshes, so the
binding is reached once per mesh. Patching `onBeforeCompile` twice redefines
every varying and function and the program silently falls back to three's
error shader. `bindEnvmap` marks the material and returns early.

## Verifying it

Served from this worktree on 5314, with `Zero`/`Corsair` re-extracted into a
scratch directory (the published tree predates the export — every material in
the shared `Zero.glb` reads `envmap=False`) and Wake re-extracted beside them.

The A/B is against a **control build** of the viewer — every file symlinked
from the worktree except `envmap.js`, whose `wantsEnvmap` is patched to return
false — served on 5315. The first attempt instead removed `scene.json.envmap`,
which also kills the water's own fresnel term and changed 24% of the frame;
that measurement was discarded.

| check | result |
|---|---|
| Wake, two Corsairs framed from front-left-above, 1280x800 | 19 material instances carry the flag, 19 get the envmap program with the binding, 0 without |
| pixels changed, whole frame | 4.76% (48,787 of 1,024,000), max channel delta 178 |
| direction | brighter: mean RGB sum 206.5 → 234.8 over the changed pixels |
| Zero in the model browser, `?env=Wake` | 19 instances / 3 distinct materials, all on the `bf-envmap` program; readout reads "3 materials reflect Wake's sky, up to 52% at the shiniest texel" (the canopy's alpha 120 is 52.9%) |
| pixels changed, browser | 0.51% — concentrated on the canopy, because the fuselage's own alpha caps it at 5% |

That last row is the whole feature in one number: the same binding moves the
glass a lot and the paint barely, out of the art's own channel.

Captures: `scratchpad/d-wiring/env-on.png`, `env-off.png`, `env-diff-full.png`,
`browse-on.png`, `browse-off.png`.

## Corrections to the census above

The census section's "Next Steps (Orchestrator)" list said to bind
`THREE.MeshStandardMaterial.envMap` and reuse the water cubemap. The first
half is wrong: three's `envMap` is PBR image-based lighting, which is not the
engine's combine — it would add a reflection term instead of blending the
surface out toward one, and no alpha channel would control it. The second half
is right, and is what `setupEnvCube` does.

## Files changed

- `tools/bf1942-models/viewer/envmap.js` — NEW: the rule, engine addresses and all
- `tools/bf1942-models/viewer/map.html` — `setupEnvCube`, the `bindDynamicShading` hook
- `tools/bf1942-models/viewer/index.html` — the binding, the level picker, the readout
- `tools/bf1942-models/tests/envmap_harness.mjs`, `tests/test_envmap.py` — NEW

## Still open

- The occlusion of the reflection by `lightingSpecular` (about a third of
  materials) is still not modelled; it is a separate stage-0 term.
- Whether anything ever installs a `D3DTS_TEXTURE1` matrix (see above).
- LM-3's call-site pairing: see the round report.

## 2026-09-20 review: re-derived, with two corrections

Every address in the stage reading above was re-derived from the shipped
binary with `objdump -d -M intel` rather than through Ghidra, so it can be
reproduced with one command:

```
objdump -d -M intel --start-address=0x005bfa70 --stop-address=0x005bfd20 \
  "$HOME/.wine/drive_c/EA Games/Battlefield 1942/BF1942.exe"
```

The stage is `SetTextureStageState(stage, state, value)` through the device
vtable's `+0xfc`, arguments pushed right to left, and it reads out exactly as
claimed once you notice `ebp = 1` (set at 0x005bf6ca and again at 0x005bf903)
is both the stage index and, where it appears as a state, `D3DTSS_COLOROP`:

| address | call | meaning |
|---|---|---|
| 0x005bfad1 | stage 1, state 0x18, value `ebx`=3 | `TEXTURETRANSFORMFLAGS = D3DTTFF_COUNT3` |
| 0x005bfaf7 | stage 1, state 0x0b, value `ecx`=0x30000 | `TEXCOORDINDEX = D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR` |
| 0x005bfc61 | stage 1, state 4, value `esi`=2 | `ALPHAOP = D3DTOP_SELECTARG1` |
| 0x005bfc83 | stage 1, state 5, value 1 | `ALPHAARG1 = D3DTA_CURRENT` |
| 0x005bfc95 | stage 1, state 6, value 0 | `ALPHAARG2 = D3DTA_DIFFUSE` |
| 0x005bfcc6 | stage 1, state 1, value 0x10 | `COLOROP = D3DTOP_BLENDCURRENTALPHA` |
| 0x005bfce1 | stage 1, state 2, value 1 | `COLORARG1 = D3DTA_CURRENT` |
| 0x005bfcfd | stage 1, state 3, value 2 | `COLORARG2 = D3DTA_TEXTURE` |

The shadow tables the report named check out as bases plus `stage * 4`:
colour op/arg1/arg2 at 0x009c92cc / 0x009c92dc / 0x009c92ec, alpha at
0x009c92fc / 0x009c930c / 0x009c931c — the stage-1 writes above land on
0x009c92d0 / 0x009c92e0 / 0x009c92f0 and 0x009c9300 / 0x009c9310 / 0x009c9320,
which is what the binary does.

**The blend direction is right**, and it now rests on the enum's own
documentation rather than recollection. `D3DTOP_BLENDCURRENTALPHA = 16`
(= 0x10, counted from `D3DTOP_DISABLE = 1` in wine's
`/usr/include/wine/windows/d3d8types.h:884-899`) sits directly under the
comment `// Linear alpha blend: Arg1*(Alpha) + Arg2*(1-Alpha)` in Microsoft's
own `d3dtypes.h` (Windows Kit 10, `um/d3dtypes.h:1676-1682`). ARG1 is CURRENT,
the lit surface, so an OPAQUE texel (A = 1) shows paint and a TRANSPARENT one
shows the cubemap. If it ran the other way every aircraft in the game would be
a mirror; it does not, and measured Zero paint alpha of 242..255 really is at
most 5% reflection. `D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR = 0x30000` is the
same header, line 82.

**Correction 1 — the undo addresses were one operand out.** The sibling at
0x005bee20 does restore stage 1, gated on the same `+0x30` byte it reads at
0x005beed4, but the transform-flags write is **0x005beef3**
(`mov DWORD PTR ds:0x9c93a0,0x0`, with the D3D call pushing value 0, state
0x18, stage 1). 0x005bef06 — the address the first pass named — is the
`cmp DWORD PTR ds:0x9c93b0,esi` that guards the *TEXCOORDINDEX* restore, whose
write is 0x005bef17. The shadow read that guards the transform-flags restore
is 0x005beedb.

**Correction 2 — stage 0's alpha op is not set "once".** 0x005c0201 does set
`SELECTARG1(TEXTURE, DIFFUSE)` beside the cubemap load, and that is the value
the blend factor comes from. But the sibling reset re-asserts the same three
values at 0x005bee8e / 0x005bee94 / 0x005bee9a whenever the `+0x31` byte is
set, and two other sub-shaders write the same stage-0 alpha shadow
(0x009c92fc): 0x0062e370 sets `D3DTOP_MODULATE`, 0x0064ce63 the same
`SELECTARG1`. Every writer on the StandardMesh path agrees, so the conclusion
stands — but "set once for the whole path" is not what the image says.

### The transparency question

A canopy is both reflective and see-through, and in the engine **one alpha
does both jobs**: stage 1's `ALPHAOP = SELECTARG1(CURRENT)` passes stage 0's
alpha straight through, so the fragment alpha that reaches the frame-buffer
blend (or the alpha test) is the same texture alpha that chose how much
cubemap to mix in. The viewer reproduces that without having to try: the patch
mixes on `diffuseColor.a` and leaves `gl_FragColor.a` alone, and three writes
that same value out. A texel that is half mirror is half transparent, as in
the game. The one divergence worth recording is that three's `diffuseColor.a`
is `opacity * texel.a` rather than `texel.a`, so a material whose `opacity` is
below 1 would reflect more than the engine gives it; no extracted `envmap`
material carries one today (checked on the Zero and the Corsair in the model
browser: `transparent: false`, `alphaTest: 0`, `opacity: 1` on all 19 flagged
instances).

### Cost, measured

Wake, `renderer.info.programs.length` after the level settles, hardware GL:
**26 without the binding, 28 with it** — two programs, because the flagged
materials fall into two parameter classes, not two per material. Twenty more
forced `__renderOnce` frames leave both counts unmoved, so nothing recompiles
per frame. `onBeforeCompile` is reached once per material, and `tBfEnv` is
attached to that material's own uniform set, which is why one shared program
still samples the right cube.

### `?env=` was case-sensitive

`maps.json` names the level `Wake`; every other link into this viewer spells
it the way `map.html?map=` does. `?env=wake` therefore matched nothing and
fell through to whichever level shipped a cubemap first — the model browser
said "3 materials reflect **Aberdeen's** sky" for a link that asked for Wake.
Matched case-insensitively now. `envUniforms` was also never cleared between
models, so it grew by a few entries per model browsed and held a cube alive
behind each.
