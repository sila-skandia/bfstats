# Level lighting laws: terrain detail, lightmapped statics, `materialDiffuse`

Status: built 2026-10-11 in the viewer, for every mod. No glb re-bake needed.
One part of the report is still open: the grass on Road to Ramelle is closer to
retail but not on it (see "Open").

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

## Open

- **The grass is still brighter than retail.** Retail's blades top out near
  the ambient floor (0.46 to 0.5 of the texel against a floor of 0.41); the
  viewer's reach 0.72 after this work, 0.92 before. Candidates, none proven:
  the engine samples the terrain's shadow mask for an object that has no
  lightmap (`Textures/LightmapShadowBits.lsb`, `Terrain.ShadowAmbient`,
  `Terrain.ShadowBorderFadeTime`, never parsed here) and dims its sun; the
  grass is `transparent true; depthWrite false` with `alphaTestRef 0.7`, so
  retail blends the kept edge with the ground behind it and the viewer cuts it
  hard.
- **Grass density depends on render size.** The capture is retail at a large
  window reduced to 1000 wide. An alpha-tested card loses coverage with every
  mip (the retail DDS keeps 12.5% of its area over 0.7 at mip 0, 5.5% at mip 2,
  0.7% at mip 4), so the same field is sparse at 1000 wide and dense at 2560.
  The texture store also halves `pega_grasses_01` (512 x 1024 to 256 x 512),
  one mip of coverage lost at any size.
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
