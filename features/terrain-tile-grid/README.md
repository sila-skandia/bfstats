# Terrain tile grid: which patch each Tx tile covers (2026-10-06)

Status: built in `tools/bf1942-models` (`bf42/level.py` `patch_grid` and
`tile_in_window`, used by `extract_map.build_scene` and `bf42/terrain.py`
`default_patches`). The Desert Combat and DC Final bakes of Medina Ridge still
carry the old terrain until they are re-baked; the commands are below.

## What was wrong

DC Medina Ridge's ground came out scrambled. The level ships 8x8 `Tx` tiles
over a 1024 m world, and the bake drew every tile on a fixed 256 m patch
(`PATCH_METERS`). Tx00..03 of each row and column covered the whole map, so the
top-left quadrant of the art was stretched four times, and the other 48 tiles
landed off the heightmap and were listed in `terrain.missingTiles`. The DC
levels report (`~/.cache/dc-sweep/reports/levels.md`, item 3, root cause E)
found it by stitching the tiles both ways against the minimap.

## What the engine does

Two ledger rows, both read in the client and the Linux server:

- **TERR-1: a patch is 64 heightmap samples.** `PatchTerrain::init` cuts the
  heightmap into `dim / 64` patches per axis, each `worldSize / (dim / 64)`
  metres, and gives each patch one tile whose UV spans it. `Terrain.con` has no
  word for the patch size. Every vanilla, XPack1 and XPack2 heightmap is 4 m a
  sample, which is why 256 m was right for so long. Medina Ridge's 512 samples
  over 1024 m make 128 m.
- **TERR-2: only the files inside a window are drawn.** World patch `c` asks for
  file `c - texOffset` (or `c` when the offset is negative), and only while that
  index is non-negative and `c < P - |texOffset|`. Every other patch gets the
  default texture. A shipped file outside the window is never drawn.

TERR-3 (the detail map's repeat) and TERR-4 (the template's defaults) were read
on the way. TERR-3 says the engine's detail UV is the sample index times
`detailTexScale` (0.5 by default, set by no level), which is 32 repeats a patch
against the bake's 16. Which texture stage samples that UV is unread, so it is
not built here. It is per patch either way, so 128 m patches keep the bake's
per-patch count.

## What changed

`build_scene` takes `(P, metres)` from `patch_grid(worldSize, dim)` and passes
the metres to `tile_mesh`, `default_patches` and `patch_mesh`. A tile outside
the window is not drawn and goes into `missingTiles` under its plain name, the
same entry a tile off the heightmap always got, so Kbely_Airfield's report does
not move. `default_patches` lets an out-of-window tile cover nothing, so its
patch gets the default fill as in the engine. The detail and default-texture
repeats stay per patch (TERR-3).

Nothing else reads the patch size. The viewer takes each tile's extent from its
mesh, and the detail repeat is applied in tile UV.

## How it was checked

- **The engine reads.** Both binaries were read: the Linux server by name
  (`features/bf1942-engine-reference/lnxded/decompile.sh`), and the client
  headless on a throwaway copy of the `bf1942-mp-enabler` project, with
  `objdump` for every shift, limit and push order the rows cite. The symbols
  are in `symbols.json`.
- **The census.** Every installed level archive was read: vanilla, XPack1,
  XPack2, DC, DC Final, and read-only every other mod. For each level the
  census took the heightmap's size, `worldSize`, `texOffset` and the shipped
  tiles, then the engine's `P`, patch and window. All 23 vanilla levels and
  every XPack1 and XPack2 level have 256 m patches. In DC and DC Final only
  Medina Ridge (128 m) and Sea Rigs (512 m, no tiles) differ. The only shipped
  files outside the window in those trees are Kbely_Airfield's ninth row and
  column, which are off the heightmap anyway.
- **Byte-identical where nothing should move.** The exporter at the parent
  commit and this one baked the same levels into scratch trees
  (`--no-optimise`): vanilla Wake (offset 2), Tobruk (offset -10), Berlin (the
  shared default fill), Kharkov (1024 m) and GuadalCanal (16 patches), XPack2
  Kbely_Airfield, and DC Medina Ridge and Sea Rigs. 1641 of 1643 files came out
  identical. The two that differ are Medina Ridge's `scene.glb` and
  `scene.json`. In `scene.json` only `terrain.missingTiles` moved (48 entries to
  none). In the glb the 12,628 non-terrain nodes are unchanged, and the 16
  terrain nodes of 256 m became 64 of 128 m. The triangle count is the same,
  524,288.
- **Against the minimap.** Each bake's Tx nodes were drawn top-down from their
  mesh extents and embedded tiles, north up, and compared with
  `Textures/InGameMap.dds`. Both were reduced to 64x64 luminance, with the
  minimap's "Push map" briefing box masked out. The old bake correlates 0.10
  with the minimap and the new one 0.83, with a mean absolute deviation of 10.4
  against 28.7. Mirroring the new render north-south drops it to 0.31, and
  mirroring it east-west or transposing it drops it to 0.0.
- **Tests.** `tests/test_terrain_grid.py` pins `patch_grid` and
  `tile_in_window` on the census's real cases. It also runs `build_scene` end
  to end on level archives the test writes: a fine heightmap gets 64 m patches,
  a 4 m one keeps 256 m, and a file outside the window is left undrawn and
  reported missing. One fixture in `tests/test_level.py` put Wake's offset on a
  1024 m world, which leaves no window at all, so it now uses Wake's real
  2048 m.

Scratch scripts are in `~/.cache/dc-sweep/terrain-grid/`: `census.py`,
`affected.py`, `bake_compare.sh`, `diff_bakes.py`, `medina_compare.py`,
`glb_node_diff.py`, and the client Ghidra scripts under `ghidra/`.

## Re-bake

The patch is drawn geometry, so this is the `scene` layer and needs a full bake
(`features/level-bake-layers/README.md`). In the trees in scope, only Medina
Ridge moves, in DC and in DC Final. DC Final's archive ships the level's own
`Terrain.con` and heightmap and takes the tiles from DC's archive through its
mod chain. Sea Rigs comes out byte-identical: it has no tiles and no dry ground
to fill.

    cd tools/bf1942-models
    python3 extract_maps_all.py --mod DesertCombat --levels DC_Medina_Ridge \
        --out viewer/maps/mods/desertcombat --no-optimise -j 1
    python3 extract_maps_all.py --mod DC_Final --levels DC_Medina_Ridge \
        --out viewer/maps/mods/dc_final --no-optimise -j 1
    python3 optimise_mesh.py viewer/maps/mods/desertcombat/dc_medina_ridge \
        viewer/maps/mods/dc_final/dc_medina_ridge -j 8
    cd ../..
    scripts/publish-mesh-delta.py maps --dry-run
    scripts/publish-mesh-delta.py maps --hash

A full bake writes every layer of the level from the code at hand. So bake
after the other DC packages that touch Medina Ridge's `scene.json` have merged,
or re-run their layer patches afterwards. `extract_maps_all.py` also rewrites
the mod's `_shared/vehicle-sounds.json` and the level's `maps.json` row, both
deterministic. Each raw glb grows by the 48 tile images it now carries (DC:
64.6 MB to 77.3 MB before `optimise_mesh.py` moves the images into the texture
store).

### The other mods (read-only here)

These mods are outside routine extraction, so their trees wait for the owner to
ask for them by name. The census flagged 26 of their levels. Terrain-only
scratch bakes (`--terrain-only`, old exporter against new) show which of those
actually move:

| Tree | Levels that move | Baked today |
|---|---|---|
| `eod` | Closefire (128 m, 16 tiles) | yes |
| `fhsw` | Coral_Sea (512 m), Dover_Strait (1024 m; 37 of its 101 files fall outside the window), Fall_of_Berlin-1945 (128 m), July26-1945 (512 m), monster_of_leningrad (1024 m), navalbattle_twins (1024 m: 64 tiles that covered a 2048 m corner of an 8192 m world now cover all of it), Operation_Hailstone and Operation_Hailstone_mod (four rows past the window), Pegasus (128 m) | yes |
| `fh`, `gcmod`, `pirates` | Pegasus; GC_Mini_Dant, GC_Mos_Eisley, GC_Tatooine; bfp_uncharted_waters | no, these trees hold only `_shared/` |

Eight FHSW levels that ship no tiles (3rd_Solomon_Sea, Battle_of_Leyte_Gulf_day2,
Escape_from_Leyte, Monster_des_Stahles, Operation_A, Operation_Kikusui_day1,
Operation_zengen, Surigao_Strait-1944) came out identical. So did FHSW's
D_DAY_drops: its 37 files outside the window are off the heightmap too, which
the old bake already left undrawn. When the owner asks, the full bakes are:

    python3 extract_maps_all.py --mod EoD --levels Closefire --out viewer/maps/mods/eod --no-optimise -j 1
    python3 extract_maps_all.py --mod FHSW --levels Coral_Sea Dover_Strait Fall_of_Berlin-1945 \
        July26-1945 monster_of_leningrad navalbattle_twins Operation_Hailstone \
        Operation_Hailstone_mod Pegasus --out viewer/maps/mods/fhsw --no-optimise -j 4

Then run `optimise_mesh.py` over those level directories and publish as above.

## Open

- **The detail map's repeat (TERR-3).** The engine's vertex math gives 32
  repeats a patch, and the bake ships 16 (`DETAIL_REPEATS`,
  `viewer/level-shading.js`). The texture stage that samples the detail UV is
  not read yet, so the number is unchanged. Changing it moves every level's
  `scene.json` (`terrain.detailRepeats`) and the look of all ground.
- **The default fill's repeat.** `DEFAULT_TILE_REPEATS` (4 a patch) is the
  bake's own choice. The engine's default-texture patch uses the tile UV, once
  a patch, as far as `Patch_init` shows, but the draw call that binds the
  default texture is unread. Kept per patch.
- **Six FHSW and FHSWEurope archives fail to open** (Berlin-1945-Outskirts,
  Stalingrad_RedSquare, fht_battle_of_kohima-1944, fht_conquest_of_java-1942,
  guangxi_counterattack-1940, operation_ketsu4). Their index ends early, and
  the files' sizes are 64 KiB multiples, which looks like a truncated install
  rather than a reader bug. The census could not check them.
