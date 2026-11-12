// OPTIONS > VIDEO's TEXTURE QUALITY on the map page.
//
// In the client the row is a texture manager setting: 20, 40 and 60 % drop
// the top 3, 2 and 1 mip levels of every texture it loads, 80 % keeps them
// all, and 100 % keeps them all and adds a mip LOD bias of -1.5 (0x006aeee0,
// the jump table at 0x006aefb8; ledger VID-5). Its purpose in 2002 was video
// memory. A browser has no LOD bias to set and a loaded glTF texture is
// already in video memory, so the page does what it can that looks the same:
//
//   - a dropped mip is `TEXTURE_MIN_LOD`: the sampler never reads finer than
//     that level, which is what a texture without its top levels draws;
//   - 100 %'s sharper distant textures are anisotropic filtering at the
//     GPU's maximum, the modern way to the same end. 80 % leaves each
//     texture's own anisotropy (the terrain's tile art already has the
//     maximum, `level-shading.js`), which is how the page drew before.
//
// Nothing here runs at 80 %, the default: no texture is touched. Off it, the
// page's textures are walked on a change and whenever the renderer holds a
// new number of them (a level loading, a vehicle spawning), at most once a
// second. Mipmapped 2D textures only: a texture without mips has no level to
// skip, and a cube is the sky's.

import * as THREE from 'three';
import { TEXTURE } from './video-settings.js';

const MIPMAP_FILTERS = new Set([
  THREE.NearestMipmapNearestFilter, THREE.NearestMipmapLinearFilter,
  THREE.LinearMipmapNearestFilter, THREE.LinearMipmapLinearFilter,
]);

/** Whether `texture` has mip levels the sampler can be kept off. */
export function hasMips(texture) {
  if (!texture?.isTexture || texture.isCubeTexture || texture.isRenderTargetTexture) return false;
  if (!MIPMAP_FILTERS.has(texture.minFilter)) return false;
  return texture.generateMipmaps || (texture.mipmaps?.length ?? 0) > 1;
}

/** `{ minLod, anisotropy }` for quality `q` (1..5): `anisotropy` null leaves
 *  the texture's own. */
export function textureState(q, maxAnisotropy = 1) {
  const t = TEXTURE[q] ?? TEXTURE[4];
  return { minLod: t.mipSkip, anisotropy: t.lodBias < 0 ? maxAnisotropy : null };
}

/**
 * The page's texture quality: `set(q)` on a change, `tick(now)` each frame.
 * `roots()` lists the scenes whose materials' maps it walks.
 */
export function createTextureQuality({ renderer, roots }) {
  // Remaster mode's WebGPU renderer (features/remaster-browser) has no GL
  // sampler state to poke: its textures keep full mips and the anisotropy
  // the level gave them, and TEXTURE QUALITY is a no-op there.
  if (renderer.isRemaster) {
    return { get quality() { return 4; }, get state() { return { minLod: 0, anisotropy: null, touched: 0, webgl2: false, maxAnisotropy: 16 }; }, set: () => 0, tick() {}, walk: () => 0 };
  }
  const gl = renderer.getContext();
  const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const aniso = renderer.extensions.get('EXT_texture_filter_anisotropic');
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  let quality = 4;
  let state = textureState(quality, maxAnisotropy);
  // What each texture was last given, by texture: `minLod|anisotropy|version`.
  let given = new WeakMap();
  let touched = new Set();
  let lastCount = -1;
  let lastWalk = 0;
  let dirty = false;

  const idle = () => state.minLod === 0 && state.anisotropy === null && touched.size === 0;

  function applyTo(texture) {
    if (!hasMips(texture)) return false;
    const handle = renderer.properties.get(texture).__webglTexture;
    if (!handle) return false;
    const own = Math.min(maxAnisotropy, Math.max(1, texture.anisotropy || 1));
    const a = state.anisotropy ?? own;
    const key = `${state.minLod}|${a}|${texture.version}`;
    if (given.get(texture) === key) return true;
    renderer.state.bindTexture(gl.TEXTURE_2D, handle);
    if (webgl2) gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_LOD, state.minLod);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, a);
    given.set(texture, key);
    if (state.minLod === 0 && state.anisotropy === null) touched.delete(texture);
    else touched.add(texture);
    return true;
  }

  function walk() {
    lastWalk = performance.now();
    dirty = false;
    const seen = new Set();
    let count = 0;
    for (const root of roots()) {
      root?.traverse?.(obj => {
        const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
        for (const m of mats) {
          const map = m?.map;
          if (!map || seen.has(map)) continue;
          seen.add(map);
          if (applyTo(map)) count++;
        }
      });
    }
    // Textures handed back to their own state that the walk no longer
    // reaches (a level gone) are forgotten; what is still drawn was reset.
    for (const t of [...touched]) if (!seen.has(t)) touched.delete(t);
    return count;
  }

  return {
    get quality() { return quality; },
    get state() { return { ...state, touched: touched.size, webgl2, maxAnisotropy }; },
    /** A new TEXTURE QUALITY: every reachable texture now. */
    set(q) {
      quality = TEXTURE[q] ? q : 4;
      state = textureState(quality, maxAnisotropy);
      given = new WeakMap();
      return walk();
    },
    /** Each frame: walk again when the renderer's texture count moved. */
    tick(now = performance.now()) {
      if (idle()) return;
      const count = renderer.info.memory.textures;
      if (count !== lastCount) { lastCount = count; dirty = true; }
      if (dirty && now - lastWalk > 1000) walk();
    },
    walk,
  };
}
