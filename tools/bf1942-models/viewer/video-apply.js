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
//   SHADOWS               the dynamic shadow pass (`shadow-pass.js` reads
//                         `settings.shadows` each frame, as the client reads
//                         game +0x4d0 each frame)
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

/** The canvas's pixel ratio at least, however far a runtime cap scales it. */
export const MIN_RUNTIME_RATIO = 0.5;

/** `settings` with no field above `cap`'s: numbers at the lower, switches
 *  on only where both are. LIGHTMAPS and DISPLAY MODE are not capped (the
 *  one is read when a level is built, the other is the ratio's, which the
 *  runtime scales instead). */
export function capVideo(settings, cap) {
  if (!cap) return settings;
  const out = { ...settings };
  for (const key of ['graphicsQuality', 'effectsQuality', 'textureQuality', 'viewDistance']) {
    if (Number.isFinite(cap[key]) && Number.isFinite(out[key])) out[key] = Math.min(out[key], cap[key]);
  }
  for (const key of ['environmentMapping', 'shadows']) {
    if (cap[key] === false && key in out) out[key] = false;
  }
  return out;
}

/**
 * The WebGL canvas's pixel ratio: `override` (`?dpr`, the bench's) when
 * given, else DISPLAY MODE's `displayHeight` on `display`, else (no screen
 * to measure) the screen's ratio capped at 2, the page's default. With no
 * mode chosen the answer is at most `cap`.
 */
export function pixelRatioFor({ displayHeight = null, display = null, override = null, dpr = 1, cap = DEFAULT_RATIO_CAP } = {}) {
  if (override > 0) return Math.min(4, Math.max(0.25, override));
  const ratio = displayPixelRatio(display, displayHeight) ?? Math.min(dpr > 0 ? dpr : 1, DEFAULT_RATIO_CAP);
  // `cap` holds only while no mode is chosen: the list's default entry is
  // the screen at DEFAULT_RATIO_CAP, and a phone replay's is lower.
  return displayHeight == null ? Math.min(ratio, cap) : ratio;
}

/**
 * `renderer`; `dprOverride` (`?dpr`, or null); `ratioCap`, the pixel ratio
 * at most with no DISPLAY MODE chosen (a phone replay's is lower,
 * `replay-phone.js`); `initial`, the settings to start from instead of the
 * stored ones (a phone replay's, until OPTIONS > VIDEO changes one);
 * `resize()` re-sizes the
 * drawing buffer and takes `pixelRatio()` as it does; `level()` the level
 * object (its `applyViewDistance`), `roots()` the scenes whose textures
 * TEXTURE QUALITY walks.
 */
export function createVideoApply({ renderer, dprOverride = null, ratioCap = DEFAULT_RATIO_CAP, initial, resize, level, roots }) {
  // What the player chose (or the page's defaults), and what is drawn: the
  // choice under the runtime cap a replay's quality governor sets
  // (`setRuntime`, replay-quality.js), which is never stored.
  let chosen = initial ?? storedVideo();
  let runtime = { cap: null, ratioScale: 1 };
  // While the replay studio records (`setFull`), the page draws at Full:
  // the player's stored choice (HIGH with none), the desktop's pixel ratio,
  // and no runtime cap, whatever a phone's profile or the governor set. The
  // recording is the canvas itself, so a lowered drawing is a lowered Short.
  let full = false;
  const target = () => (full ? storedVideo() : capVideo(chosen, runtime.cap));
  let settings = target();
  const textures = createTextureQuality({ renderer, roots });
  let applied = null;

  /** The ratio the canvas should have now: read by `resize()`, so a window
   *  resize, F11, a zoom or another monitor re-derives it. The runtime
   *  scale lowers it, never under `MIN_RUNTIME_RATIO`; `?dpr` is the bench's
   *  and stays as given. */
  const pixelRatio = () => {
    const ratio = pixelRatioFor({
      displayHeight: full ? storedVideo().displayHeight : chosen.displayHeight,
      display: displayOf(),
      override: dprOverride,
      dpr: globalThis.devicePixelRatio,
      cap: full ? DEFAULT_RATIO_CAP : ratioCap,
    });
    if (full || dprOverride > 0 || !(runtime.ratioScale < 1)) return ratio;
    return Math.min(ratio, Math.max(MIN_RUNTIME_RATIO, ratio * runtime.ratioScale));
  };

  function apply(next = storedVideo()) {
    chosen = next;
    return draw();
  }

  /** The runtime cap: `{ cap, ratioScale }`, `cap` a partial settings
   *  object no field of which is raised past the choice (`capVideo`), and
   *  `ratioScale` the canvas's pixel ratio's share, 1 for the whole. Null
   *  lifts it. Live: the canvas resizes and every row re-applies. */
  function setRuntime(next = null) {
    const prevScale = runtime.ratioScale;
    runtime = { cap: next?.cap ?? null, ratioScale: next?.ratioScale > 0 ? Math.min(1, next.ratioScale) : 1 };
    draw();
    if (runtime.ratioScale !== prevScale && renderer.getPixelRatio() !== pixelRatio()) resize();
    return applied;
  }

  /** Draw at Full (`on`) or as before. Synchronous: the canvas has its new
   *  size when this returns, so a recording's crop measured next is the
   *  full one. */
  function setFull(on) {
    if (Boolean(on) === full) return applied;
    full = Boolean(on);
    draw();
    if (renderer.getPixelRatio() !== pixelRatio()) resize();
    return applied;
  }

  function draw() {
    const prev = applied;
    settings = target();
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
    setRuntime,
    setFull,
    get full() { return full; },
    /** What is drawn: the choice under the runtime cap. */
    get settings() { return settings; },
    /** What the player chose, for the options screen. */
    get chosen() { return chosen; },
    get runtime() { return runtime; },
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
