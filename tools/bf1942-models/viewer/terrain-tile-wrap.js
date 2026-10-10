// Which terrain colour maps must not repeat.
//
// A shipped `TxCCxRR` tile is drawn on one patch whose UVs run exactly 0..1
// (`bf42/terrain.py` `_grid_mesh`; ledger TERR-1), and the engine binds
// that stage with CLAMP addressing (ledger TERR-12), and the exporter writes every
// texture of a glb with one REPEAT sampler. Bilinear filtering at u or v of 0 or
// 1 then reads across the wrap into the opposite edge of the same tile, and the
// mip chain and the 16x anisotropy widen that to a line a few pixels wide along
// every patch border: sand-coloured on the dark side of a shadow, dark on the
// sand. A tile's colour map is therefore clamped to its edge.
//
// The default-texture patches are the other kind: one small texture wrapped
// four times across the patch (`default_patches`, UVs up to 4), which needs
// REPEAT. A texture object can be shared between the two kinds (the loader
// deduplicates by image and the texture store by content), so the decision is
// per texture, and a texture a repeating mesh also uses is cloned before it
// is clamped.

/** The largest UV coordinate a geometry carries, or 0 with no UV set. */
export function uvExtent(geometry) {
  const uv = geometry?.attributes?.uv;
  if (!uv) return 0;
  let max = 0;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u > max) max = u;
    if (v > max) max = v;
  }
  return max;
}

/** True when a UV extent leaves the unit square, i.e. the mesh tiles its map. */
export function repeatsTexture(extent) {
  return extent > 1 + 1e-3;
}

/**
 * Plan the wrap of each terrain mesh's map. `uses` is one `{ texture, repeats }`
 * per mesh material (`repeats` from `repeatsTexture(uvExtent(geometry))`).
 * Returns, parallel to `uses`, `'keep'` (repeats, leave it), `'clamp'` (clamp
 * the texture in place: nothing that repeats uses it) or `'clone'` (clamp a
 * private copy: a repeating mesh uses the same texture object).
 */
export function planTileWrap(uses) {
  const repeating = new Set();
  for (const u of uses) if (u.texture && u.repeats) repeating.add(u.texture);
  return uses.map(u => {
    if (!u.texture) return 'keep';
    if (u.repeats) return 'keep';
    return repeating.has(u.texture) ? 'clone' : 'clamp';
  });
}
