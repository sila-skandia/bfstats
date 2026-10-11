# Level lighting laws: terrain detail, lightmapped statics, `materialDiffuse`

Status: built 2026-10-11 in the viewer, for every mod. No glb re-bake needed.
A second pass the same day read what dims the grass (the section "The grass:
the ground's shade and the near blend"): two more engine laws, built, which
move Road to Ramelle's grass towards retail and still leave it brighter (see
"Open").

The report was a side-by-side of Forgotten Hope's Road to Ramelle, the viewer
against retail from the same spot on an overcast level: our grass tufts a
bright yellow-green, our ground pale and flat, retail dark with a hard grain.
Three combines in `viewer/level-shading.js` were not the engine's. None is
specific to the level or to the mod.

Evidence images are in `evidence/`:

- `ramelle_retail_before_after.png`: the retail half of the report, the viewer
  before, the viewer after (rendered at 2560 wide and reduced, as the retail
  capture was).
- `before_ramelle.png`, `after_ramelle.png`: the same view at 1000 x 563.
- `wake_bunker_retail_before_after.png`: a vanilla check, the supply bunker on
  Wake against the retail capture of 2026-09-18.
- `ramelle_grass_retail_before_after.png`: the second pass. Retail, the viewer
  with the two new passes off, the viewer with them on (2560 wide, reduced).
- `wake_wire_retail_before_after.png`: the same three on Wake. The wire fence
  behind the bunker is in retail and in "after", and not in "before".

## What was wrong

| Surface | The viewer did | The engine does | Ledger |
|---|---|---|---|
| Terrain | `2 * tile * detail`, 16 detail repeats a patch, no mip bias | `tile + detail - 0.5` (ADDSIGNED), unlit, 32 repeats a patch, mip bias -1.5 | TERR-15, TERR-3, TERR-14 |
| A lightmapped static | `(ambient + globalAmbient + 2 * lightmap) * texture`, on linear colour | `2 * lightmap * texture` in 8-bit display space, nothing added | LM-4 |
| A lit material's `materialDiffuse` | dropped, every material lit as white | scales the sun's term, not the ambient floor | DL-9 (DL-3 struck) |

### Terrain

The multiply scales the detail grain with the tile, so a dark tile had almost
none. The sum gives every tile the same grain in levels, lets deep tones reach
black, and moves the whole level by `mean(detail) - 128`. Installed detail maps
run from a mean of 95 (FH Iwo Jima) and 109 (Road to Ramelle, Kursk) to 150
(Midway, Bocage, Truk), so some levels get darker and some lighter.

### Lightmapped statics

A level's `objectsLightmap.con` gives the bake its own floor
(`raytracer.ambientIntensity 0.05`, the 12 of 255 that a third of every atlas
reads). The viewer added the level's ambient pair on top and did the multiply
on linear colour, which lifted a shadowed wall from a tenth of its texture to
well over half.

### `materialDiffuse`

Forgotten Hope exported 1812 of its 9392 StandardMesh materials at 3ds max's
default grey, 0.588235: every `pega_grassfield`, most of the mod's own statics
and many vehicles. Vanilla has 383 off white (178 at 0.4, the first-person
hands and bodies), XPack1 44, XPack2 121. The viewer reads the colour from
the level's `scene.json` (`materialDiffuse`, the `materials` layer, grouped by
colour) by material name, or from the glb material's own
`extras.materialDiffuse` when a later bake wrote one.

## Measured

Mean colour of a region, 8-bit, retail against the viewer before and after.

Road to Ramelle (the report's capture; the viewer from 1310 / 83.9 / -583, yaw
1.2):

| Region | Retail | Before | After |
|---|---|---|---|
| Field (terrain grass) | 26 / 28 / 9, darkest decile 11 / 13 / 0 | 37 / 38 / 14, darkest decile 26 / 28 / 10 | 24 / 25 / 3, darkest decile 6 / 7 / 0 |
| Stone house wall (lightmapped; its texture alone is 151 / 147 / 129) | 36 / 37 / 31 | 96 / 93 / 81 | 26 / 26 / 22 |
| Grass blades (texel mean over alpha > 0.7: 121 / 149 / 61) | 43 / 51 / 20, brightest decile 60 / 68 / 34 | 92 / 103 / 37, brightest decile 127 / 137 / 44 | 75 / 86 / 32 at 1000 wide; 65 / 74 / 27, brightest decile 99 / 108 / 38, at 2560 wide reduced |
| Sky, tree canopy | unchanged by this work | | |

Wake, the supply bunker's west wall (retail `Screenshot From 2026-09-18
22-56-51.png`, the viewer from 1308 / 110 / -1195 looking east; texture alone
161 / 160 / 151):

| | Retail | Before | After |
|---|---|---|---|
| Wall | 97 / 93 / 82 | 149 / 146 / 138 | 96 / 96 / 90 |

Bocage, a barracks wall out of the sun (retail `Screenshot From 2026-09-23
21-11-20.png`, not the same wall for certain; texture alone 107 / 103 / 96):
retail 70 / 67 / 59, the viewer's half-lit face after 70 / 68 / 63, its
darkest face after 27 / 26 / 24, the same faces before 107 / 103 / 96 and
80 / 77 / 72.

## How it was checked

- Playwright with Vulkan against the worktree's own `serve_viewer.py`, one
  Chromium at a time, `&shots=1&botCount=0`, the animation loop stopped, the
  camera set by `__camera.position` and `__look`, `__renderOnce` repeated until
  two captures were byte-identical (the control), `toDataURL` to PNG.
- Before and after on one build of everything else: only `level-shading.js`
  was swapped for the committed one.
- A wall's texture alone: the same view with every material's
  `lightMapIntensity` set to 0.
- Vanilla before and after on Bocage (the lumber mill and two barracks),
  Tobruk (the allied base) and Wake (the airfield and the bunker).
- `tests/test_level.py` (the detail sum), `tests/test_scene_layers.py` (the
  layer, and a bake patched by every layer is unchanged),
  `tests/test_cockpit_light.py` (the uniform, the name table, the glb's own
  extras winning, the cockpit's rule untouched).

## What changed on disk

- `viewer/level-shading.js`: `bindTerrainDetail`, `bindLightmaps`,
  `bindDynamicShading`.
- `scene_layers.py` `layer_materials`: the `materialDiffuse` key. It now
  mounts the level's pools the way a bake does, so a patch and a bake read the
  same files (`extract_map.mount_level_pools` is idempotent for that).
- `bf42/assemble.py`, `bf42/gltf.py`: a bake writes `extras.materialDiffuse`
  on a lit, off-white material and keeps two shaders that differ only in that
  colour apart. `bf42/terrain.py`: `DETAIL_REPEATS` 32, `apply_detail` is the
  sum.
- Every published `scene.json` that has a game install behind it was patched
  with `patch_scene.py --layer materials --mod <M> --all` (vanilla, XPack1,
  XPack2, FH, DesertCombat, DC_Final, EoD). Not published: that is
  `scripts/publish-mesh-delta.py maps --hash` when the viewer code ships.

## The grass: the ground's shade and the near blend

Read from the client after the first pass left the grass 1.45 times retail.
Both candidates the first pass named turned out to be real, and neither is
about grass: they are how every unlightmapped StandardMesh is drawn.

| | The viewer did | The engine does | Ledger |
|---|---|---|---|
| A mesh with no lightmap, standing on shadowed ground | drew it at full light | multiplies it by `(Terrain.shadowAmbient + intensity) / 255`, the intensity being the luminance of the ground's own tile under the object's origin where the level's shadow bits are set, 255 elsewhere | DL-10, DL-11 |
| A `transparent true` material that names an alpha test | cut it at the reference at every distance | blends it, reference 0, within the geometry's `alphaLodDistance` (100 m by default); cuts it at the reference, unblended, past that | DL-12 |

**The shade.** `Textures/LightmapShadowBits.lsb` is a run-length bitmap of the
terrain's baked shadow, a quarter of a metre a bit. When a level starts the
client asks the terrain about every static whose mesh fits a 5 m box: where the
bit under its origin is set, it reads the luminance of the terrain's colour
tile there and that is the mesh's intensity (after a five-point check that an
object at a shadow's far edge is not counted as shadowed). Road to Ramelle's
terrain was baked with its objects casting shadows, so 1919 of its 2185 grass
fields stand on a set bit, their own; the ground there has a luminance near 32
and `Terrain.ShadowAmbient` is 80/80/90, so a shaded field is drawn at 0.44 of
its lit colour (blue 0.48). The five-point check lets about 1100 of them back
into the light. A vehicle or a soldier is asked every frame and fades to the
answer over `ShadowBorderFadeTime`; that is not built.

**The blend.** Up close the whole card is drawn, each texel as opaque as its
alpha, over what is behind it, with no depth written (`depthWrite false`).
Cutting it at 0.7 kept an eighth of the texture's area: a field read as a few
hard blades. Vanilla has 59 such materials, FH 193; 22 vanilla geometries opt
out with `alphaLodDistance 0` (the wire and the fences).

### Measured

Road to Ramelle, the same view, green pixels (`g > r + 6 and g > b + 12`) of
the band the grass is in, 8-bit:

| | Retail | Before | After |
|---|---|---|---|
| Mean | 42 / 50 / 20 | 51 / 60 / 21 | 52 / 61 / 22 |
| Median | 43 / 52 / 20 | 52 / 61 / 23 | 52 / 61 / 23 |
| Brightest decile | 59 / 67 / 33 | 94 / 104 / 37 | 79 / 89 / 35 |
| Darkest decile | 28 / 36 / 9 | 21 / 29 / 5 | 32 / 40 / 13 |
| Share of the band that is grass | 20 % | 3.5 % | 11.6 % |

"Before" here is byte for byte the first pass's "after". The brightest decile
went from 1.6 to 1.34 times retail's and the grass covers three times the
pixels it did; the mean did not move, because the fields the five-point check
leaves lit are now drawn whole.

Wake: the wire fence behind the supply bunker, in the retail capture, is drawn
(the blend carries a strand whose filtered alpha never reaches the reference).
Elsewhere the frame is unchanged: 0.7 % of that view's pixels move by more than
8, none on Bocage (four views) and 0.2 % on Tobruk (two).

### How it was checked

- The same harness as the first pass, on port 5397, one Chromium at a time,
  closed in a `finally`. Before and after are one build: "before" resets every
  bound material's shade to white and puts the alpha-LOD materials back to the
  cut state in the page before each render. The control (two identical
  captures) held for every view.
- `tests/test_terrain_shade.py` (the `.lsb` reader, the client's run walk and
  DXT1 decode, the layer on a synthetic level) with `test_terrain_shade.mjs`
  (the viewer's reader against bytes the Python packed, the five-point rule,
  the cull box, the colour, the page's wiring); `tests/test_scene_layers.py`
  (the two new `materials` keys, the `Terrain.*` words).

### What changed on disk

- `bf42/terrainshade.py`, new. The `terrainShade` layer of `scene_layers.py`:
  scene.json `terrainShade` (the four `Terrain.*` words and two side files,
  `terrain/shadowbits.png`, the bits repacked and carried as a PNG's bytes,
  and `terrain/shade.png`, the shadowed ground's luminance a 2 m cell). 0.1 to
  0.6 MB a level; a level with no bits has no key.
- The `materials` layer gains `alphaBlend` (the material names) and
  `alphaLodDistance` (by geometry, where a script sets one).
- `viewer/terrain-shade.js`, new, pure. `viewer/level-shading.js`: the
  `bfShade` uniform in `bindDynamicShading`, `bindTerrainShade`,
  `bindAlphaLod`, `updateAlphaLod`.
- The shared trees were patched with `patch_scene.py --layer terrainShade
  materials --mod <M> --all` for bf1942, XPack1, XPack2 and FH. Not published.
  DesertCombat, DC_Final and EoD were not patched: there the viewer draws as
  before until they are.

## Open

- **The grass is still brighter than retail**, 1.23 times at the mean and 1.34
  at the brightest decile. What is left is not read. Leads: which way along
  the sun the five-point check reaches (the con's vector is used; the other
  way shades about 80 more fields); whether the client's box and radius are
  the placement's scaled ones; the lit term itself (the DL-9 sum is still
  inferred, and retail's unshaded fields may be dimmer than the viewer's);
  fog on the far fields. One capture cannot separate them: a retail capture
  of a single field from close by, in the lab, would.
- ~~The engine samples the terrain's shadow mask for an object that has no
  lightmap~~ Read and built: DL-10, DL-11.
- ~~Retail blends the kept edge with the ground behind it~~ Read and built:
  DL-12.
- **Grass density** is 11.6 % of the band against retail's 20 %. The texture
  store halves `pega_grasses_01` (512 x 1024 to 256 x 512), which thins a
  blended blade as well as a cut one; exempting alpha-tested foliage from the
  halving is a texture-store change and a re-publish of `viewer/textures/`,
  not done here. The client also sorts a near mesh's triangles
  (`triangleSortLodDistance`, 10 m); the viewer sorts objects.
- **A moving object's shade.** A tank under a tree darkens in retail
  (`objectsVisualUpdate`, DL-11). The page shades statics only.
- **A `transparent true` material with no alpha test, past its distance**, is
  drawn unblended by DL-12's reading; the viewer blends it everywhere.
- **The glb merges materials by texture and flags**, under the first one's
  name. Until a level is re-baked, a material whose `materialDiffuse` differs
  from a sibling sharing its texture takes the sibling's. The grass fields all
  share 0.588. A re-bake of every tree fixes it (`extract_maps_all.py`, the
  budget in CLAUDE.md); nothing here needs one to work.
- **Interiors.** `2 * lightmap * texture` leaves a texel of 12 at a tenth of
  its texture. No retail capture from inside a building was compared.
- **Wake's sand is patchier than retail's.** In front of the bunker retail
  reads 157 / 130 / 86 with a decile spread of 140 to 172, the viewer 138 /
  113 / 72 with 96 to 168, before and after alike: the viewer's tiles carry
  dark patches retail does not show there.
- **Fog on distant trees.** Retail's far tree line reads 39 / 42 / 34 at the
  median, the viewer's 22 / 25 / 18; the two views do not share a distance, so
  this is a lead, not a measurement.
- **A two-sided card's back face.** Direct3D lights a back face with the
  vertex normal as stored; the viewer flips the normal there. Not changed: the
  tree canopy's mean already matches retail.
- **The cockpit's rule** (DL-5) does not take `materialDiffuse`. Vanilla
  cockpit materials at 0 and 0.078 are a lead for that row's unexplained
  magnitude.
