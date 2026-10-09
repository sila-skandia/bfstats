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

## Open

- The water's own look against retail: specular streak width, the fresnel
  shaping and the blurred cube lookup in `level-sky.js` were calibrated on Wake
  (`features/bf1942-3d-models/map-parity.md`), not decompiled. A retail capture
  of M.I.A.'s river from the bank would settle how dark the deep colour reads.
- Mission Impossible's cube (above).
