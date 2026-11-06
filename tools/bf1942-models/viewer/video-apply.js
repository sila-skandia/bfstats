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
//   DISPLAY MODE          the WebGL canvas's pixel ratio: the mode's height
//                         over the screen's, worked out again on every
//                         resize (full screen, a window, a zoom, another
//                         monitor), never per frame
//
// LIGHTMAPS and ANTI-ALIASING are read when a level is built (the options
// screen says NEXT LEVEL until the level matches).

import {
  DEFAULT_RATIO_CAP, displayOf, displayPixelRatio, onVideoChange, storedVideo, EFFECTS, GRAPHICS,
} from './video-settings.js';
import { setLodPercent } from './mesh-cull.js';
import { setBillboardDistanceScale } from './tree-foliage.js';
import { setEmitterIntensityScale } from './effects-core.js';
import { ENVMAP_SWITCH } from './envmap.js';
import { createTextureQuality } from './texture-quality.js';

/**
 * The WebGL canvas's pixel ratio: `override` (`?dpr`, the bench's) when
 * given, else DISPLAY MODE's `displayHeight` on `display`, else (no screen
 * to measure) the screen's ratio capped at 2, the page's default.
 */
export function pixelRatioFor({ displayHeight = null, display = null, override = null, dpr = 1 } = {}) {
  if (override > 0) return Math.min(4, Math.max(0.25, override));
  return displayPixelRatio(display, displayHeight) ?? Math.min(dpr > 0 ? dpr : 1, DEFAULT_RATIO_CAP);
}

/**
 * `renderer`; `dprOverride` (`?dpr`, or null); `resize()` re-sizes the
 * drawing buffer and takes `pixelRatio()` as it does; `level()` the level
 * object (its `applyViewDistance`), `roots()` the scenes whose textures
 * TEXTURE QUALITY walks.
 */
export function createVideoApply({ renderer, dprOverride = null, resize, level, roots }) {
  let settings = storedVideo();
  const textures = createTextureQuality({ renderer, roots });
  let applied = null;

  /** The ratio the canvas should have now: read by `resize()`, so a window
   *  resize, F11, a zoom or another monitor re-derives it. */
  const pixelRatio = () => pixelRatioFor({
    displayHeight: settings.displayHeight,
    display: displayOf(),
    override: dprOverride,
    dpr: globalThis.devicePixelRatio,
  });

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
    if ((!prev || prev.displayHeight !== settings.displayHeight) && renderer.getPixelRatio() !== pixelRatio()) {
      resize();
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
    pixelRatio,
    /** VIEW DISTANCE's percentage, for `level-sky.js`. */
    viewDistancePercent: () => settings.viewDistance,
    /** LIGHTMAPS, for the level being built. */
    lightmaps: () => settings.lightmaps,
    /** Each frame: textures that arrived since the last walk. */
    tick: now => textures.tick(now),
    textures,
  };
}
