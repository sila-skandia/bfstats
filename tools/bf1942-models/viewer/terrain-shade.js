// The light an object with no lightmap takes from the ground it stands on
// (ledger DL-10, DL-11; features/level-lighting-laws).
//
// The client keeps one number on every mesh, its intensity (`+0x138`, 255 in
// the open), and multiplies the lit mesh by
//
//   clamp(Terrain.shadowAmbient + template.shadowAmbient + intensity, 0, 255) / 255
//
// as texture stage 1's TFACTOR (`StandardMesh_drawLod` 0x005aeec0, the
// sub-shader's `applyRenderState` 0x005bfdcb). For a static the intensity is
// set once, when the level loads (`ObjectManager::refreshTerrainSampling`),
// from the terrain under its origin (`getObjectIntensity`, client 0x005068c0).
// The terrain's answer at a point is the level's `terrain/shade.png`
// (`bf42/terrainshade.py`): 255 in the open, the ground tile's own luminance
// where `LightmapShadowBits.lsb` says shadow.
//
// Pure functions, no three.js: the page binds them in `level-shading.js`.

/** Under this the terrain's answer counts as shadow (0x008c3e80, 100.0). */
export const SHADOW_BELOW = 100;
export const LIT = 255;

/** The fan of extra samples an object in shadow takes, degrees about +Y
 *  (0x00504bf0: -22.5, -13.5, -4.5, 4.5, 13.5), at 1.1 radii. */
export const FAN_DEGREES = [-22.5, -13.5, -4.5, 4.5, 13.5];
export const FAN_REACH = 1.1;

/**
 * `PatchTerrain::getLightmapBit` (client 0x00680670) over the level's packed
 * bits (`bf42/terrainshade.py` `pack_bits`): whether the point is in the
 * terrain's baked shadow. Returns `bit(x, z)` in the game's metres, or null
 * when the bytes are not that file.
 */
export function shadowBits(bytes) {
  if (!bytes || bytes.length < 16
      || bytes[0] !== 0x42 || bytes[1] !== 0x46 || bytes[2] !== 0x53 || bytes[3] !== 0x42) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 1) return null;
  const perAxis = view.getUint32(8, true);
  const patch = view.getFloat32(12, true);
  if (!(perAxis > 0) || !(patch > 0)) return null;
  return (x, z) => {
    if (!(x >= 0) || !(z >= 0)) return 0;
    const col = Math.trunc(x / patch), row = Math.trunc(z / patch);
    if (col >= perAxis || row >= perAxis) return 0;
    const start = view.getUint32(16 + 4 * (row * perAxis + col), true);
    if (!start) return 0;
    const width = view.getUint32(start, true), height = view.getUint32(start + 4, true);
    const px = Math.trunc(width * ((x - col * patch) / patch));
    const py = Math.min(height - 1, Math.trunc(height * ((z - row * patch) / patch)));
    const from = view.getUint32(start + 8 + 4 * py, true);
    const to = view.getUint32(start + 12 + 4 * py, true);
    // The first run whose running length reaches the texel, else the last.
    let total = 0, word = 0;
    for (let at = from; at < to; at += 2) {
      word = view.getUint16(at, true);
      total += word & 0x1fff;
      if (total >= px) break;
    }
    return (word >> 13) & 1;
  };
}

/**
 * `PatchTerrain::getIntensity` (client 0x00680e50). `spec` is the level's
 * `terrainShade` block, `pixels` its luminance image's bytes one a cell (row 0
 * at z = 0), `bit` the level's `shadowBits`. Returns `at(x, z)` in the game's
 * metres: 255 where the ground is not in baked shadow (or off the terrain),
 * else the shadowed ground's luminance there.
 *
 * Without the bits the image alone answers, a cell at a time: coarser than
 * the client (a 2 m cell against a quarter-metre bit), never brighter than
 * the ground it reads.
 */
export function shadeField(spec, pixels, bit = null) {
  const dim = spec?.dim | 0;
  const cell = Number(spec?.cell);
  if (!(dim > 0) || !(cell > 0) || !pixels || pixels.length < dim * dim) return null;
  return (x, z) => {
    if (!(x >= 0) || !(z >= 0)) return LIT;
    const i = Math.floor(x / cell), j = Math.floor(z / cell);
    if (i >= dim || j >= dim) return LIT;
    if (bit && !bit(x, z)) return LIT;
    return pixels[j * dim + i];
  };
}

/**
 * `ObjectManager::getObjectIntensity` (client 0x005068c0). In the open the
 * origin alone decides. In shadow five more points are asked, a fan `radius *
 * 1.1` out along the sun's light flattened to the ground; the answer is the
 * mean of the shadowed ones when they outnumber the lit ones, and full light
 * otherwise. The origin's own value is not in that mean.
 *
 * `light` is the sun's vector on the ground, `[x, z]`, any length.
 */
export function objectIntensity(at, x, z, radius, light) {
  if (at(x, z) >= SHADOW_BELOW) return LIT;
  const len = Math.hypot(light?.[0] || 0, light?.[1] || 0);
  const lx = len > 0 ? light[0] / len : 0;
  const lz = len > 0 ? light[1] / len : 0;
  const reach = (radius || 0) * FAN_REACH;
  let lit = 0, dark = 0, sum = 0;
  for (const degrees of FAN_DEGREES) {
    const a = degrees * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const value = at(x + (lx * c + lz * s) * reach, z + (lz * c - lx * s) * reach);
    if (value >= SHADOW_BELOW) lit++;
    else { dark++; sum = Math.trunc(sum + value); }
  }
  return lit < dark ? Math.trunc(sum / dark) : LIT;
}

/** Whether the client samples the terrain for a mesh at all: its box has to
 *  fit `Terrain.shadowStaticObjectsCullBox` on every axis (0x00502f60), and
 *  it must not stand more than `shadowSamplingCullY` over the ground
 *  (0x00680e50). */
export function samplesTerrain(extent, cullBox, above, cullY) {
  for (let i = 0; i < 3; i++) if (extent[i] > cullBox[i]) return false;
  return !(above > cullY);
}

/** The colour a mesh of that intensity is multiplied by, 0..1 a channel. */
export function shadeFactor(intensity, ambient, templateAmbient = null) {
  return [0, 1, 2].map(i => {
    const sum = (ambient?.[i] || 0) + (templateAmbient?.[i] || 0) + intensity;
    return Math.min(255, Math.max(0, Math.trunc(sum))) / 255;
  });
}
