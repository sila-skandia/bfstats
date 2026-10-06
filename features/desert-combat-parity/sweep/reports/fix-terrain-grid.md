Medina Ridge's terrain is fixed in the exporter. The live DC and DC Final bakes still have the old terrain until you re-bake them; the commands are below. This was package `terrain-grid`.

## What was wrong

The engine sizes a terrain patch from the heightmap, and `Terrain.con` has no setting for it. I read this in both binaries and checked the shifts, limits and push order in `objdump`.

- **TERR-1:** `PatchTerrain::init` (server 0x083d5460, client 0x006819a0) makes `dim >> 6` patches per axis, each `worldSize / P` metres. Each patch holds one Tx tile, and the tile's UV spans the patch. The exporter assumed 256 m. That holds on every vanilla, XPack1 and XPack2 level, but Medina's 512-sample heightmap over 1024 m makes 128 m patches.
- **TERR-2:** the client draws file `c - texOffset` (or `c` when the offset is negative) only while the index is non-negative and `c < P - |texOffset|`. Every other patch gets the default texture.
- I also recorded two side findings:
  - **TERR-3 (open):** the engine's detail UV works out to 32 repeats per patch, but we ship 16. The texture stage that uses it is unread, so I changed nothing.
  - **TERR-4 (moot):** the template's defaults (texOffset 4, worldSize 4096) never decide a shipped level.

## What changed

- `bf42/level.py`: new `patch_grid` and `tile_in_window`.
- `bf42/terrain.py`: `default_patches` gives no coverage to a tile outside the window.
- `extract_map.build_scene` uses both. A tile outside the window is listed in `missingTiles` the same way a tile off the heightmap always was.
- Docs: four ledger rows (TERR-1..4), 8 symbols, the new `features/terrain-tile-grid/README.md` with its `features/README.md` line, and `TERR` added to the knowledge skill's topic map (one line, outside my file list).

Commits (`main..HEAD`): `efa8151d` (the fix), `fbab4d43`, `ca51b7ca`, `70c0cb5c` (docs).

## Census and proof

- **Census:** I read every installed level. All vanilla, XPack1 and XPack2 levels have 256 m patches. In DC and DC Final only Medina Ridge (128 m) and Sea Rigs (512 m, no tiles) differ.
- **Byte compare:** old and new exporters baked Wake, Tobruk, Berlin, Kharkov, GuadalCanal, Kbely_Airfield, Medina and Sea Rigs into scratch trees. 1641 of 1643 files are identical; only Medina's `scene.glb` and `scene.json` differ:
  - In `scene.json`, only `missingTiles` moved, from 48 entries to none.
  - In the glb, the 12,628 non-terrain nodes are unchanged; the 16 terrain tiles at 256 m became 64 at 128 m, with the same 524,288 triangles.
- **Against the minimap:** I drew each bake's tiles top-down and compared them with the level's minimap, with its briefing box masked out. Correlation went from 0.10 (old) to 0.83 (new). Mirroring or transposing the new render drops it to 0.31 or lower. DC Final's Medina bake renders the same.
- **Tests:** I added `tests/test_terrain_grid.py` (9 tests, including `build_scene` run end to end on test archives). I also fixed one `test_level.py` fixture that put Wake's offset on a 1024 m world, which leaves the engine nothing to draw. The full suite passes: 4603 tests, 10 skipped.

## Commands for you to run (DC and DC Final)
```
cd tools/bf1942-models
python3 extract_maps_all.py --mod DesertCombat --levels DC_Medina_Ridge --out viewer/maps/mods/desertcombat --no-optimise -j 1
python3 extract_maps_all.py --mod DC_Final --levels DC_Medina_Ridge --out viewer/maps/mods/dc_final --no-optimise -j 1
python3 optimise_mesh.py viewer/maps/mods/desertcombat/dc_medina_ridge viewer/maps/mods/dc_final/dc_medina_ridge -j 8
cd ../.. && scripts/publish-mesh-delta.py maps --dry-run && scripts/publish-mesh-delta.py maps --hash
```
- Bake after the other packages that touch Medina's `scene.json` have merged, because a full bake rewrites every layer of the level.
- Sea Rigs needs nothing; its output is byte-identical.
- Each raw Medina glb grows from 64.6 to 77.3 MB until `optimise_mesh.py` moves the textures into the shared store.

## Other mods (read-only, wait for the owner to ask)
Old-vs-new terrain-only scratch bakes show 15 levels move:
- **In existing trees:** EoD Closefire, plus nine FHSW levels: Coral_Sea, Dover_Strait, Fall_of_Berlin-1945, July26-1945, monster_of_leningrad, navalbattle_twins, Operation_Hailstone, Operation_Hailstone_mod, Pegasus. The bake commands are in the README.
- **Not baked in any tree:** FH Pegasus, the three GCMOD levels and Pirates' bfp_uncharted_waters.
- **Unchanged:** FHSW's D_DAY_drops, which the brief suspected, and eight FHSW levels that ship no tiles.

## Still open, or belonging to other packages
- **Detail repeat (TERR-3):** fixing it would change every level's ground.
- **Default-fill repeat:** the 4-per-patch figure is our own choice, not the engine's.
- **Broken FHSW/FHSWEurope archives:** six fail to open. Their sizes are 64 KiB multiples, which looks like a truncated install rather than a reader bug.
- **DC parity README rows** (yours to apply): item 3 becomes Fixed in code, re-bake pending, High confidence; root cause E and WP8 are done, pending the re-bake.

Scratch scripts and bakes are in `~/.cache/dc-sweep/terrain-grid/`.