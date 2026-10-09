# The reflection cube most mod levels lost, and the depth map read upside down (2026-10-09)

**Status:** built. Exporter, viewer and the published `scene.json` trees
(vanilla, Road to Rome, Secret Weapons, Eve of Destruction) are fixed; the
`sky/` faces are published by `scripts/publish-mesh-delta.py maps`.

## The report

Eve of Destruction's M.I.A.: the river in front of the US Airbase looked like a
dry mud trough. The water plane was there (a ray down hit `water` at 74 m) and
drawn, but it drew as a flat matte brown over a brown bed, so there was nothing
to tell it apart from the terrain.

Two defects, both general, neither EoD-specific.

## 1. `envmap: null` on 211 of EoD's 239 levels

The water's reflection comes from the level's `ENVMAP_G_.rcm`
(`ShaderManager.setTextureParam envmap`), six 128 px faces. `write_skybox`
resolved each face against the level's own archive only. The faces an `.rcm`
names are full archive paths, and most mod levels name ANOTHER level's:

| Faces named | EoD levels | Example |
|---|---|---|
| the level's own | 28 | |
| Wake's | 43 | Aces Over Vietnam, M.I.A. |
| Kursk's | 28 | Battle at Ling Chow |
| Guadalcanal's | 21 | A Shau |
| Bocage / Bulge / Iwo Jima / Stalingrad / Omaha / Berlin ... | 106 | |
| `texture/sky_envmap/forest_hills/` (in `texture.rfa`) | 4 | Ghost Town |

Vanilla does it too: Invasion of the Philippines names Wake's faces, and Coral
Sea and Truk name their own under folders that do not exist (`Corall_sea`,
`Piti`), while Guadalcanal's first `.rcm` in archive order is a broken
`ENVMAP.rcm` (`textures/ENVMAP_N.tga` over a line of keyboard mash), not the
`ENVMAP_G_.rcm` its `Init.con` runs. All four shipped with `envmap: null` and
flat water, as did Anzio and Baytown (XPack1) and Raid on Agheila (XPack2).

The engine mounts every level archive of the mod chain at its own path and the
texture manager falls back to a basename (`features/level-archive-mounts`).
`mount_level_pools` already builds the texture pool that way, so the fix is to
hand it to `write_skybox`: the level's own files first, then the chain pool by
full path, then by basename with `.tga` to `.dds` (`resolve_ext`). The `.rcm`
`Init.con` names is tried first (`LevelInfo.envmap_rcm`, new), and a candidate
whose faces do not all resolve no longer ends the search.

The cube is part of the `scene` layer, which only a full bake writes. A full
EoD bake is an hour and a half, so `patch_sky.py --mod M --all` re-exports the
cube alone into a published tree: same `LevelContext`, same pool, same
`write_skybox`; a second a level. It is recorded in
`features/level-bake-layers/README.md`.

One EoD level still has none: Mission Impossible names
`GuadalCanal/Textures/envmap_02.dds`, a file no archive holds (Guadalcanal
ships `Envmap_0..5` and `env_Guada_01..06`). Retail cannot load it either.

## 2. The depth map was sampled mirrored north-south

`bf42.terrain.depth_map` writes row 0 at z = 0 and the water shader looks it up
at `v = -worldZ / worldSize`. The viewer loaded it through `TextureLoader`,
whose default `flipY` puts the PNG's first row at v = 1. Every level's depth
read mirrored: M.I.A.'s 56 m river sampled a dry hill across the map and drew at
the shallow alpha (0.5) in the shallow colour; the far bank read as deep.

Measured in the page at world (376, -1288), the deepest river point, lower
centre of the frame, mean RGB:

| | RGB |
|---|---|
| water hidden (the bed) | 62, 49, 38 |
| water, flipY true (before) | 43, 31, 19 |
| water, flipY false (after) | 13, 9, 2 |

After: the opaque deep colour (`water.deepColor 0.235/0.117/0`, M.I.A.'s dark
brown), as the data says. The colour layers and the normal map tile and scroll,
so their orientation is not observable; only the depth map addresses the world,
and only it is flipped. `viewer/level-sky.js`.

The collider's heightfield reads the same PNG orientation through a canvas (no
flip), which is how the mismatch was found: a ray down at (376, -1288) hit
`water`, the mirrored point (376, -760) hit terrain at 75.8 m.

## What was checked

- `tests/test_write_skybox.py`: another level's faces through the chain pool, a
  misspelt folder by basename, `.tga` names finding `.dds`, the named `.rcm`
  first and a failed one skipped, an unreadable face failing only its `.rcm`.
- `tests/test_level.py` `EnvmapRcmTests`: the `setTextureParam envmap` parse.
- `patch_sky.py --all` over vanilla (4 levels gained a cube), XPack1 (6),
  XPack2 (5), EoD (210 of 211).
- The M.I.A. measurement above.

## 3. The reflection term was a third of the pixel (2026-10-10)

A retail capture of Ghost Town (EoD) from a soldier standing in the river, the
view raked 3 degrees down across the water, against the same framing in the
viewer at world (428, -256), 33 m of water, looking up-river. Mean RGB of
horizontal bands, the retail rows at the distance the band's height implies:

| | 18 m | 37 m | 100 m |
|---|---|---|---|
| retail | 33, 26, 14 | 32, 23, 11 | 26, 20, 10 |
| viewer before | 52, 47, 42 | 62, 58, 56 | 105, 102, 103 |
| viewer, sky term off | 29, 20, 7 | 24, 15, 2 | 24, 15, 1 |
| viewer after | 46, 40, 34 | 43, 38, 34 | 52, 48, 45 |

Ghost Town's water is `color 0.478/0.322/0.027`, `deepColor 0.282/0.141/0`,
layers `water02` x `water06` (modulate-2x of the two layers is a 0.32
multiplier, and the viewer's layered base of (24,15,2) is 0.33 x deepColor,
right where retail's 0.4 sits). Everything retail does not have is the
reflected cube: the fresnel peak of 0.55 (set on Wake, where a blue cube over
teal water hides it) mixed a third of the grey `forest_hills` cube into brown
water at grazing incidence, pushed the alpha up with it, and flattened the
layers' ripple texture into a grey sheet. The peak is now 0.06
(`level-sky.js`, `float fresnel = 0.02 + 0.06 * ...`). The rim glint stays.

What the bands still carry past retail is scene fog (the 100 m band is a
quarter of the way to the fog colour) and the Blinn lobe off
`specularColor 0.65/0.55/0.4` at `streakFactor 0.001`, which the capture does
not show in frame. Whether `PatchTerrain/Water` takes the vertex fog at all is
not settled: the far water in the capture meets hills that are far more fogged
than it is, but those hill pixels are hundreds of metres up the slope.

Checked on Wake after the change: the lagoon keeps its teal, its ripple texture
and the horizon fade (the fade is the fog, not the cube).

Black Water (EoD), the owner's second pair of captures, same day: `color
0/0.247/0`, `deepColor 0.314/0.157/0`, layers `water04` x `water05` (a 0.17
multiplier), alpha 0.4 to 0.6 m. Retail from the Docks looking into the sun is
near-black water with a broad beige specular band. The viewer before the change
drew it as a blue mirror of the sky with the beige lobe low in the frame, which
is what "opaque where the sun hits it, transparent elsewhere" described. After,
from the river at world (840, -600) looking at the sun: near (116,98,73) under
the streak, mid (81,69,55), far (67,61,56); retail near reads (120,100,70). The
far band is the one that still differs, and it is the fog again: on both
captures the trees on the far bank are hazed to the fog colour while the water
at their feet is still dark. Our water fogs to (67,61,56) at that distance.

## Open

- The water's own look against retail: specular streak width and the blurred
  cube lookup in `level-sky.js` were calibrated on Wake
  (`features/bf1942-3d-models/map-parity.md`), not decompiled. Section 3 has
  the one retail measurement so far; a second level with a dark cube would
  confirm the 0.06 peak, and a capture with the sun in frame would size the
  streak.
- Whether the engine fogs the water plane (section 3).
- Mission Impossible's cube (above).
