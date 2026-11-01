// OPTIONS > VIDEO: the player's video settings, what each one does in the
// client, and where the page keeps them.
//
// The game's VIDEO OPTIONS rows are fields of one settings record (the
// `game.set*` console words write them, BF1942.exe 0x006aefd0..0x006af0c0),
// and the video apply (0x006b0db0, with 0x006aeee0 for the texture fields)
// hands each to the part of the engine that uses it. Ledger rows VID-1..VID-9
// (features/bf1942-engine-reference/ledger.md) carry the addresses; this
// module holds the numbers they read:
//
//   GRAPHICS QUALITY 1..3   renderer.globalLodPercent 0.6 / 0.8 / 1 (the
//                           static meshes' LOD swaps and small-mesh cull,
//                           `mesh-cull.js`), TreeRenderer's
//                           billboardDistanceScale 1 / 1.5 / 2 (where a tree
//                           becomes its card) and lodObjectDistanceLodFactor
//                           0.3 / 0.5 / 1 (VID-1)
//   EFFECTS QUALITY 1..3    the emitters' intensityScale 0.3 / 0.5 / 1: every
//                           emitter spawns that fraction as often (VID-2)
//   ENVIRONMENT MAPPING     the StandardMesh reflection stage on or off (VID-3)
//   LIGHTMAPS               object lightmaps on, or the lit path (VID-4)
//   TEXTURE QUALITY 1..5    20..100 %: the texture manager drops 3, 2, 1, 0, 0
//                           top mip levels, and 100 % adds a mip LOD bias of
//                           -1.5 (VID-5)
//   VIEW DISTANCE 50..100   a percentage of the level's own view distance,
//                           which also resets the fog to the view distance's
//                           law (VID-6, FOG-4)
//   VIDEO PERFORMANCE       LOW / MEDIUM / HIGH run Settings/Default/
//                           Video{Low,Medium,High}.con (VID-8); CUSTOM is any
//                           other mix
//
// With nothing stored every value is the game's HIGH, which is also what
// the viewer drew before these rows existed: LOD percent 1, every emitter at
// its full intensity, reflections and lightmaps on, full mips (80 %), the
// level's whole view distance. Two rows are this site's own: RENDER SCALE
// (the WebGL canvas's pixel ratio, a fraction of the screen's) and
// ANTI-ALIASING, which keeps its own key (`render-antialias.js`).
//
// Kept per browser under `bf42-mesh-video` (JSON). Every read and write is
// wrapped: private mode and blocked site data leave the defaults.

export const VIDEO_KEY = 'bf42-mesh-video';

/** The game's HIGH (Settings/Default/VideoHigh.con) and this page's
 *  extra rows at the look the viewer has always had. */
export const DEFAULT_VIDEO = Object.freeze({
  graphicsQuality: 3,
  effectsQuality: 3,
  environmentMapping: true,
  lightmaps: true,
  textureQuality: 4,
  viewDistance: 100,
  renderScale: 100,
});

/** `Settings/Default/Video{Low,Medium,High}.con`, the files VIDEO
 *  PERFORMANCE runs (BF1942.exe 0x006afc40, 0x006afac8, 0x006af954). Their
 *  shadows line is left out: the viewer draws no dynamic shadows. */
export const PRESETS = Object.freeze({
  1: Object.freeze({ graphicsQuality: 1, effectsQuality: 1, environmentMapping: false, lightmaps: false, textureQuality: 1, viewDistance: 75 }),
  2: Object.freeze({ graphicsQuality: 2, effectsQuality: 2, environmentMapping: false, lightmaps: true, textureQuality: 3, viewDistance: 100 }),
  3: Object.freeze({ graphicsQuality: 3, effectsQuality: 3, environmentMapping: true, lightmaps: true, textureQuality: 4, viewDistance: 100 }),
});

/** VIDEO PERFORMANCE's radio lines: `Options/Video/Performance`. */
export const PERFORMANCE = Object.freeze({ custom: 0, low: 1, medium: 2, high: 3 });

/** GRAPHICS QUALITY's three numbers, by the setting (VID-1, 0x006b0e0d..0x006b0e82). */
export const GRAPHICS = Object.freeze({
  1: Object.freeze({ lodPercent: 0.6, billboardDistanceScale: 1, lodObjectFactor: 0.3 }),
  2: Object.freeze({ lodPercent: 0.8, billboardDistanceScale: 1.5, lodObjectFactor: 0.5 }),
  3: Object.freeze({ lodPercent: 1, billboardDistanceScale: 2, lodObjectFactor: 1 }),
});

/** EFFECTS QUALITY's emitter intensity scale (VID-2, 0x006b0ea3..0x006b0edf). */
export const EFFECTS = Object.freeze({ 1: 0.3, 2: 0.5, 3: 1 });

/** TEXTURE QUALITY: the mips the texture manager skips and the LOD bias
 *  (VID-5, the jump table at 0x006aefb8). */
export const TEXTURE = Object.freeze({
  1: Object.freeze({ mipSkip: 3, lodBias: 0 }),
  2: Object.freeze({ mipSkip: 2, lodBias: 0 }),
  3: Object.freeze({ mipSkip: 1, lodBias: 0 }),
  4: Object.freeze({ mipSkip: 0, lodBias: 0 }),
  5: Object.freeze({ mipSkip: 0, lodBias: -1.5 }),
});

/** RENDER SCALE's steps, percent of the screen's own pixel ratio. */
export const RENDER_SCALES = Object.freeze([50, 75, 100, 125, 150]);

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** A whole, valid settings object out of anything (a stored blob, a partial
 *  change): missing or broken fields take the default. */
export function normalizeVideo(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const bool = (x, d) => (typeof x === 'boolean' ? x : d);
  const scale = Number(v.renderScale);
  return {
    graphicsQuality: clampInt(v.graphicsQuality, 1, 3, DEFAULT_VIDEO.graphicsQuality),
    effectsQuality: clampInt(v.effectsQuality, 1, 3, DEFAULT_VIDEO.effectsQuality),
    environmentMapping: bool(v.environmentMapping, DEFAULT_VIDEO.environmentMapping),
    lightmaps: bool(v.lightmaps, DEFAULT_VIDEO.lightmaps),
    textureQuality: clampInt(v.textureQuality, 1, 5, DEFAULT_VIDEO.textureQuality),
    // The game's edit box takes 50..100 and the setter caps at 100 (0x006af061).
    viewDistance: clampInt(v.viewDistance, 50, 100, DEFAULT_VIDEO.viewDistance),
    renderScale: RENDER_SCALES.includes(scale) ? scale : DEFAULT_VIDEO.renderScale,
    // The last mix that matched no preset, which CUSTOM brings back (the
    // game's CUSTOM runs the profile's VideoCustom.con, 0x006af3ba).
    custom: v.custom && typeof v.custom === 'object' ? stripCustom(v.custom) : null,
  };
}

function stripCustom(value) {
  const { custom: _custom, ...rest } = normalizeVideo({ ...value, custom: null });
  return rest;
}

/** Which VIDEO PERFORMANCE line `settings` is: the preset it matches on
 *  every field a preset sets, else CUSTOM (0). */
export function performanceOf(settings) {
  const v = normalizeVideo(settings);
  for (const [level, preset] of Object.entries(PRESETS)) {
    if (Object.entries(preset).every(([k, x]) => v[k] === x)) return Number(level);
  }
  return PERFORMANCE.custom;
}

/** `settings` with a preset's values written over it (the extras kept).
 *  CUSTOM (0) brings back the last mix that matched no preset, if any. */
export function applyPreset(settings, level) {
  const v = normalizeVideo(settings);
  const preset = Number(level) === PERFORMANCE.custom ? v.custom : PRESETS[level];
  if (!preset) return v;
  const { renderScale: _scale, ...game } = preset;
  return normalizeVideo({ ...v, ...game, custom: v.custom });
}

/** The view distance the client draws to: the level's own times the row's
 *  percentage (VID-6: `fild [+0x18]`, `fmul 0.01`, `fmul [+0x1c]`). */
export function scaledViewDistance(levelDistance, percent) {
  return levelDistance * normalizeVideo({ viewDistance: percent }).viewDistance / 100;
}

/** The fog the client's view distance setter writes (FOG-4, 0x00462b30):
 *  start a quarter of it, end all of it, each 50 m less when the quarter is
 *  over 50 m. */
export function viewDistanceFog(distance) {
  const quarter = distance * 0.25;
  return quarter > 50
    ? { start: quarter - 50, end: distance - 50 }
    : { start: quarter, end: distance };
}

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The stored settings, defaults where none. Never throws. */
export function storedVideo(storage = browserStorage()) {
  try {
    const text = storage?.getItem(VIDEO_KEY);
    return normalizeVideo(text ? JSON.parse(text) : {});
  } catch {
    return normalizeVideo({});
  }
}

/** Whether the player has stored anything at all. */
export function hasStoredVideo(storage = browserStorage()) {
  try { return storage?.getItem(VIDEO_KEY) != null; } catch { return false; }
}

/** Keep `settings`, or forget them with null. Never throws. */
export function storeVideo(settings, storage = browserStorage()) {
  try {
    if (settings === null || settings === undefined) storage?.removeItem(VIDEO_KEY);
    else storage?.setItem(VIDEO_KEY, JSON.stringify(normalizeVideo(settings)));
  } catch { /* private mode: the choice lasts the page */ }
}

const listeners = new Set();

/** Be told when a screen on this page changes the settings: `fn(settings)`.
 *  Returns the unsubscribe. The level page applies what it can live. */
export function onVideoChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Store a change (a partial object) and tell the page. Returns the whole
 *  new settings. */
export function changeVideo(change, storage = browserStorage()) {
  let next = change === null ? normalizeVideo({}) : normalizeVideo({ ...storedVideo(storage), ...change });
  // A mix no preset matches is CUSTOM's from now on.
  if (change !== null && performanceOf(next) === PERFORMANCE.custom) next = normalizeVideo({ ...next, custom: next });
  storeVideo(change === null ? null : next, storage);
  for (const fn of listeners) {
    try { fn(next); } catch (error) { console.warn('video settings listener failed', error); }
  }
  return next;
}
