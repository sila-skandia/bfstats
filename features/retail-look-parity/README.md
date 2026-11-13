# Retail look parity (2026-11-13)

Status: two differences found and fixed (below); the exporter fix is staged,
not published. The owner's report: the water and the flak explosions are
better than retail, "everything else looks a bit bland and lossy".

Retail frames: the repo holds only the three 2026-09 captures in
`level-lighting-laws/evidence/` (Wake, Road to Ramelle, Bocage). A fresh
capture from the Mac client was not possible headless (no screen-capture or
input access from the agent), so Wake is the retail-against-ours pair; the
other levels are ours before and after.

## Differences

| # | Difference | Cause | Fix |
|---|---|---|---|
| 1 | Terrain colour at half retail's resolution; vehicles and weapons a level places at half | `extract_map.py`, `extract_maps_all.py` and `extract_effects.py` capped a texture at 512. The retail packs' largest texture is 1024 (153 of 2492 `.dds`, 651 are 512), so every 1024 Tx tile (4 texels a metre in retail, 2 baked) and every 1024 vehicle or gun texture was resized. Wake, El Alamein, Berlin, Kursk: all their tiles and 11 to 14 object textures each | cap 1024 (lossless for the three packs); `tests/test_texture_cap.py`; trees re-baked into the stage folder |
| 2 | Texture quality below retail's highest | `DEFAULT_VIDEO.textureQuality` was 4 (80 %: no bias). Retail at 100 % adds a -1.5 LOD bias (VID-5), which `texture-quality.js` answers with the GPU's anisotropy; glTF object textures carry anisotropy 1 | default 5; `tests/test_video_settings.py` (VIDEO PERFORMANCE then reads CUSTOM, as HIGH's own file says 80 %) |

## Checked and fine

- Pixels: of Wake's 205 `.dds` textures 173 are identical to the decoded
  source, 13 were the resized ones above, 19 differ only in RGB under
  alpha 0 and in nearly transparent texels (the alpha bleed).
- Mip generation in linear against gamma space: mean difference 0.1 to 0.5
  levels at /2 to /8 on a terrain tile.
- Lightmaps (256 and 128 as shipped), terrain detail (512, 32 repeats), sky
  faces: same size as the source. No tone mapping (`toneMapping` 0).
- The lit combine already runs in display space (`level-shading.js`, DL-2).
- Foliage greens on Wake: mean 61 / 73 / 43 against retail 63 / 73 / 45.

## Not done

- The mods' own 2048 textures are untouched (2026-11-14: the mod level trees
  and the kit parts are now at 1024, below).
- Not re-baked, so they keep their live 512 bakes: vanilla Strasbourg and FH
  Road_To_Ramelle (no archives here); in FHSW a_day_of_zitadelle,
  cretan_village, kiew, nuenen-1944, soletschnogorsk-1941, todtenbruch-1944 and
  tulagi_island; FHSW Europe the same seven plus fall_gelb-1940,
  operation_lilliput, road_to_ramelle, the_attack_on_carentan-1944 and
  spurning_fate-1945, and stashuv_area (the Mac install's copy bakes 5 missing
  meshes, 48 fewer placed objects and no terrain materials). The Mac install's
  archives for these lack Init/Terrain.con or the heightmap (Kiew.rfa is 300 KB
  here); they were first baked on the Linux PC, whose install has them, so a
  bake there finishes them.

## 2026-11-14: the mod trees and the kit parts

- Every exported level of vanilla, xpack1, xpack2, fh, gcmod, desertcombat, eod
  (239), bf1918 (133), fhsw (133 of 140) and fhsweurope (261 of 274) was
  re-baked at 1024 and published on 2026-11-13/14, textures verified 200 before
  the levels went up. The exceptions are listed under "Not done".
- Kit parts: `extract_kits.py` `MAX_TEXTURE` was 512 ("a kit part is a hat"),
  which halved EoD's AK47, bf1918's flamer and GCMOD's e-11. It is 1024 now and
  `tests/test_texture_cap.py` guards it. Census of the live kit glbs against
  the game archives (source dds above 512, stored at 512): bf1918 22, eod 10,
  fhsweurope 4, gcmod 6, fhsw 2, desertcombat 4; fh, xpack2 and vanilla none
  (xpack1 has no kit textures). Those six trees were rebuilt with
  `mod_pipeline.py run --mod <M> --only-steps kits --force-steps`, which also
  optimises, and published textures first, then the models unit.
- What went live: 206 kit glbs (bf1918 40, eod 51, gcmod 6, fhsw 30,
  desertcombat 8, fhsweurope 71) plus 141 kit textures. The Mac install is not
  the one the live kit tables were built from (EoD builds 113 kits against the
  live 128, DesertCombat and the FHSW trees name some pickups differently), so
  `kits.json` and every kit glb that differed beyond its texture stayed as
  live. EoD and DesertCombat got their 1024 textures by pointing the live kit
  glbs at the rebuilt webps (same texture name, downscale-checked against the
  live 512 copy); the other four trees publish the rebuilt glbs, checked equal
  to live apart from the image URIs. Kit textures still at 512 are 512 at
  source.
