// OPTIONS > VIDEO on the map page (and so in a replay, which is the map page):
// the player's settings (`video-settings.js`) put into the renderer and the
// systems that draw. Read once when the page starts and applied again on
// every change the options screen makes, live where the client's own change
// is live:
//
//   GRAPHICS QUALITY      the statics' `globalLodPercent` (`mesh-cull.js`) and
//                         where trees become cards (`tree-foliage.js`)
//   EFFECTS QUALITY       every emitter's intensity (`effects-core.js`)
//   ENVIRONMENT MAPPING   the reflection stage's switch (`envmap.js`)
//   TEXTURE QUALITY       the textures' finest mip and anisotropy
//                         (`texture-quality.js`)
//   VIEW DISTANCE         the far plane, the fog and the statics' cull
//                         (`level-sky.js`)
//   RENDER SCALE          the WebGL canvas's pixel ratio
//
// LIGHTMAPS and ANTI-ALIASING are read when a level is built (the options
// screen says NEXT LEVEL until the level matches).

import { onVideoChange, storedVideo, EFFECTS, GRAPHICS } from './video-settings.js';
import { setLodPercent } from './mesh-cull.js';
import { setBillboardDistanceScale } from './tree-foliage.js';
import { setEmitterIntensityScale } from './effects-core.js';
import { ENVMAP_SWITCH } from './envmap.js';
import { createTextureQuality } from './texture-quality.js';

/** The pixel ratio RENDER SCALE `scale` (percent) gives over `base`, the
 *  ratio the page drew at before the row existed. Capped at 4. */
export function scaledPixelRatio(base, scale) {
  const r = base * (scale > 0 ? scale : 100) / 100;
  return Math.min(4, Math.max(0.25, r));
}

/**
 * `renderer`; `basePixelRatio` (what the page asked for: `?dpr`, else the
 * screen's capped at 2); `resize()` re-sizes the drawing buffer; `level()`
 * the level object (its `applyViewDistance`), `roots()` the scenes whose
 * textures TEXTURE QUALITY walks.
 */
export function createVideoApply({ renderer, basePixelRatio, resize, level, roots }) {
  let settings = storedVideo();
  const textures = createTextureQuality({ renderer, roots });
  let applied = null;

  function apply(next = storedVideo()) {
    const prev = applied;
    settings = next;
    const g = GRAPHICS[settings.graphicsQuality] ?? GRAPHICS[3];
    setLodPercent(g.lodPercent);
    // The viewer's tree swap is HIGH's; the others are fractions of it.
    setBillboardDistanceScale(g.billboardDistanceScale / GRAPHICS[3].billboardDistanceScale);
    setEmitterIntensityScale(EFFECTS[settings.effectsQuality] ?? 1);
    ENVMAP_SWITCH.value = settings.environmentMapping ? 1 : 0;
    if (!prev || prev.textureQuality !== settings.textureQuality) textures.set(settings.textureQuality);
    if (!prev || prev.renderScale !== settings.renderScale) {
      const ratio = scaledPixelRatio(basePixelRatio, settings.renderScale);
      if (renderer.getPixelRatio() !== ratio) {
        renderer.setPixelRatio(ratio);
        resize();
      }
    }
    if (prev && prev.viewDistance !== settings.viewDistance) {
      try { level()?.applyViewDistance?.(); } catch (error) { console.warn('view distance', error); }
    }
    applied = { ...settings };
    return applied;
  }

  apply(settings);
  onVideoChange(next => apply(next));

  return {
    apply,
    get settings() { return settings; },
    /** VIEW DISTANCE's percentage, for `level-sky.js`. */
    viewDistancePercent: () => settings.viewDistance,
    /** LIGHTMAPS, for the level being built. */
    lightmaps: () => settings.lightmaps,
    /** Each frame: textures that arrived since the last walk. */
    tick: now => textures.tick(now),
    textures,
  };
}
