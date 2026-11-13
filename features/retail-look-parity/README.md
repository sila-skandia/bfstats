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

- The mods' trees (FH, FHSW, FHSWEurope, DC, EoD, bf1918, GC...) were not
  re-baked here; anyone baking them passes `--max-texture 1024` or takes the
  new default. Kit parts (`extract_kits.py` `MAX_TEXTURE` 512) and the
  mods' own 2048 textures are untouched.
