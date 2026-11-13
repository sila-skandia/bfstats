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
//   SHADOWS                 the dynamic shadow pass on or off: the
//                           `hasDynamicShadow` objects within 50 m, each
//                           projected on the terrain (VID-7, DSH-1..DSH-9;
//                           `dynamic-shadows.js`, `shadow-pass.js`)
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
// level's whole view distance. HIGH also has SHADOWS on, which the viewer did
// not draw before 2026-11-13. ANTI-ALIASING is this site's own row and
// keeps its own key (`render-antialias.js`).
//
//   DISPLAY MODE            the game's resolution list (VID-11): the
//                           renderer's modes of 640x480 and up, labelled
//                           "%dx%dx%d", the current one selected; SAVE
//                           writes `game.setGameDisplayMode` and
//                           `__changeResolution` (0x006b0db0) switches the
//                           mode. A browser cannot switch the display's
//                           mode, so the page's list is the screen's own
//                           size and the retail heights under it at its
//                           aspect (`displayModes`), and the mode picked is
//                           the WebGL canvas's pixel density: as many
//                           pixels as that mode would have across the
//                           screen (`displayPixelRatio`).
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
  shadows: true,
  // 100 %, the top of the row: retail at its highest draws every mip with
  // a -1.5 LOD bias (VID-5), which `texture-quality.js` answers with the
  // GPU's anisotropy. HIGH's own file says 80 %; nothing chosen is not HIGH.
  textureQuality: 5,
  viewDistance: 100,
  // DISPLAY MODE's height in the screen's own pixels; null is the page's
  // default, the screen's ratio capped at 2 (what it drew before the list).
  displayHeight: null,
});

/** `Settings/Default/Video{Low,Medium,High}.con`, the files VIDEO
 *  PERFORMANCE runs (BF1942.exe 0x006afc40, 0x006afac8, 0x006af954).
 *  `game.setShadows` is 1 in HIGH alone. */
export const PRESETS = Object.freeze({
  1: Object.freeze({ graphicsQuality: 1, effectsQuality: 1, environmentMapping: false, lightmaps: false, shadows: false, textureQuality: 1, viewDistance: 75 }),
  2: Object.freeze({ graphicsQuality: 2, effectsQuality: 2, environmentMapping: false, lightmaps: true, shadows: false, textureQuality: 3, viewDistance: 100 }),
  3: Object.freeze({ graphicsQuality: 3, effectsQuality: 3, environmentMapping: true, lightmaps: true, shadows: true, textureQuality: 4, viewDistance: 100 }),
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

/** The RENDER SCALE row's steps, percent of the default pixel ratio. The
 *  row is gone (DISPLAY MODE replaced it); a stored percentage is moved to
 *  the nearest display mode when it is read (`migrateRenderScale`). */
export const RENDER_SCALES = Object.freeze([50, 75, 100, 125, 150]);

/** The heights the list offers under the screen's own, at its aspect: the
 *  modes a 2002 card enumerated (640x480, 800x600, 1280x720, 1024x768,
 *  1600x900 ...) and today's 1080p, 1440p and 2160p. */
export const DISPLAY_HEIGHTS = Object.freeze([480, 600, 720, 768, 900, 1080, 1440, 2160]);

/** The page's pixel ratio with no mode chosen: the screen's, capped at 2. */
export const DEFAULT_RATIO_CAP = 2;

/** The bits per pixel every entry reads: a WebGL drawing buffer is 8 bits a
 *  channel, the game's X8R8G8B8 (0x0063dcb0). */
export const DISPLAY_BPP = 32;

/** The screen the page is on, in its own pixels: `{ cssWidth, cssHeight,
 *  dpr, width, height }`, null where there is none (node). */
export function displayOf(screenLike = globalThis.screen, dpr = globalThis.devicePixelRatio) {
  const cssWidth = Number(screenLike?.width);
  const cssHeight = Number(screenLike?.height);
  const ratio = Number(dpr) > 0 ? Number(dpr) : 1;
  if (!(cssWidth > 0 && cssHeight > 0)) return null;
  return { cssWidth, cssHeight, dpr: ratio,
           width: Math.round(cssWidth * ratio), height: Math.round(cssHeight * ratio) };
}

const modeOf = (display, height, extra = {}) => {
  const width = Math.round(height * display.width / display.height);
  return { width, height, label: `${width}x${height}x${DISPLAY_BPP}`, ...extra };
};

/** The page's own mode: the screen's height at the default ratio. */
export function defaultDisplayHeight(display) {
  return Math.round(display.cssHeight * Math.min(display.dpr, DEFAULT_RATIO_CAP));
}

/**
 * DISPLAY MODE's entries for `display`, top to bottom: the screen's own size
 * first, then the page's default where the ratio cap puts it under that
 * (a phone's 3x screen), then every `DISPLAY_HEIGHTS` height under the
 * screen's at its aspect, as the game lists only modes of 640x480 and up
 * (0x006b0520: width > 639 and height > 479). Each `{ width, height, label,
 * native?, default? }`; nothing above the screen's own pixels, as no
 * display mode is bigger than the panel.
 */
export function displayModes(display) {
  if (!display) return [];
  const native = display.height;
  const fallback = defaultDisplayHeight(display);
  const out = [modeOf(display, native, { native: true, default: fallback === native })];
  if (fallback < native) out.push(modeOf(display, fallback, { default: true }));
  for (const h of [...DISPLAY_HEIGHTS].reverse()) {
    if (h >= native || h === fallback) continue;
    const mode = modeOf(display, h);
    if (mode.width > 639 && mode.height > 479) out.push(mode);
  }
  return out.sort((a, b) => b.height - a.height);
}

/** The entry `displayHeight` picks on `display`: the one nearest it (a mode
 *  stored on a bigger screen falls to this one's own size), or the page's
 *  default with none chosen. */
export function chosenDisplayMode(display, displayHeight) {
  const modes = displayModes(display);
  if (!modes.length) return null;
  if (displayHeight == null) return modes.find(m => m.default) ?? modes[0];
  return modes.reduce((a, m) => (Math.abs(m.height - displayHeight) < Math.abs(a.height - displayHeight) ? m : a));
}

/** The WebGL canvas's pixel ratio for DISPLAY MODE `displayHeight` on
 *  `display`: the mode's height over the screen's in CSS pixels, so the
 *  canvas has the mode's density at any window size (full screen, a
 *  window, under the nav bar). Clamped to 0.25..4; null with no screen. */
export function displayPixelRatio(display, displayHeight) {
  const mode = chosenDisplayMode(display, displayHeight);
  if (!mode) return null;
  return Math.min(4, Math.max(0.25, mode.height / display.cssHeight));
}

/** The game's whole frame for a stage `w` x `h` (CSS pixels) on `display`,
 *  when the stage is a crop of it; null when the stage draws the frame whole.
 *
 *  The game fixes the vertical angle (`renderer.fieldOfView 1`, ledger VIEW-8)
 *  and takes the sides from the display mode's shape: 88.3 degrees across on
 *  a 16:9 screen. A browser window on that screen is shorter than it, by the
 *  tabs, the address bar and the taskbar (1920x953 on a maximised Windows
 *  Chrome), so the same vertical angle over the shorter stage would show 95
 *  degrees across with everything 12 % smaller: a wider, faster-looking
 *  picture than the game ever drew there. So a stage wider than the screen's
 *  shape shows the middle of the frame the game would draw full screen, as
 *  wide as the stage: `{ fullWidth, fullHeight, offsetY }` for three's
 *  `setViewOffset`. A stage as narrow as the screen or narrower (a tall
 *  window) draws its own frame, as the game does in any mode narrower than
 *  16:9. So does any stage on a portrait screen: no display mode the game
 *  lists is taller than wide, and a phone held upright would otherwise see
 *  28 degrees across. */
export function screenFrame(w, h, display) {
  if (!(w > 0 && h > 0) || !display) return null;
  const screenAspect = display.cssWidth / display.cssHeight;
  if (!(screenAspect >= 1) || w / h <= screenAspect * 1.001) return null;
  const fullHeight = w / screenAspect;
  return { fullWidth: w, fullHeight, offsetY: (fullHeight - h) / 2 };
}

/** Give `dst` the crop `src` draws with (three's `setViewOffset`), or none,
 *  without allocating: a pass drawn over the world's (the first-person arms)
 *  must crop the same frame, or the gun would sit 12 % smaller than the world
 *  around it. Call before `dst.updateProjectionMatrix()`. */
export function copyViewOffset(dst, src) {
  const v = src.view;
  if (v?.enabled) {
    if (dst.view) Object.assign(dst.view, v);
    else dst.view = { ...v };
  } else if (dst.view) {
    dst.view.enabled = false;
  }
}

/** A stored RENDER SCALE percentage as DISPLAY MODE: the entry nearest the
 *  height it drew at (the default's height times the percentage). 100 %, or
 *  no screen to measure, is no choice. */
export function migrateRenderScale(scale, display) {
  const s = Number(scale);
  if (!display || !RENDER_SCALES.includes(s) || s === 100) return null;
  return chosenDisplayMode(display, defaultDisplayHeight(display) * s / 100)?.height ?? null;
}

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** A whole, valid settings object out of anything (a stored blob, a partial
 *  change): missing or broken fields take the default. */
export function normalizeVideo(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  const bool = (x, d) => (typeof x === 'boolean' ? x : d);
  const height = Math.round(Number(v.displayHeight));
  return {
    graphicsQuality: clampInt(v.graphicsQuality, 1, 3, DEFAULT_VIDEO.graphicsQuality),
    effectsQuality: clampInt(v.effectsQuality, 1, 3, DEFAULT_VIDEO.effectsQuality),
    environmentMapping: bool(v.environmentMapping, DEFAULT_VIDEO.environmentMapping),
    lightmaps: bool(v.lightmaps, DEFAULT_VIDEO.lightmaps),
    shadows: bool(v.shadows, DEFAULT_VIDEO.shadows),
    textureQuality: clampInt(v.textureQuality, 1, 5, DEFAULT_VIDEO.textureQuality),
    // The game's edit box takes 50..100 and the setter caps at 100 (0x006af061).
    viewDistance: clampInt(v.viewDistance, 50, 100, DEFAULT_VIDEO.viewDistance),
    displayHeight: v.displayHeight != null && height >= 240 && height <= 8640 ? height : DEFAULT_VIDEO.displayHeight,
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
  // A preset leaves the display mode alone (the game's SAVE takes the mode
  // from the list, not from Video{Low,Medium,High}.con).
  const { displayHeight: _mode, ...game } = preset;
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

/** The stored settings, defaults where none. A RENDER SCALE percentage
 *  kept before DISPLAY MODE existed reads as the nearest mode on `display`.
 *  Never throws. */
export function storedVideo(storage = browserStorage(), display = displayOf()) {
  try {
    const text = storage?.getItem(VIDEO_KEY);
    const raw = text ? JSON.parse(text) : {};
    // A choice kept before SHADOWS was a row: a preset keeps its own
    // shadows line (LOW and MEDIUM stay LOW and MEDIUM), any other mix the
    // default.
    if (raw && typeof raw === 'object' && text && typeof raw.shadows !== 'boolean') {
      const kept = normalizeVideo(raw);
      const preset = Object.values(PRESETS).find(p =>
        Object.entries(p).every(([k, x]) => k === 'shadows' || kept[k] === x));
      if (preset) raw.shadows = preset.shadows;
    }
    if (raw && typeof raw === 'object' && raw.displayHeight == null && 'renderScale' in raw) {
      raw.displayHeight = migrateRenderScale(raw.renderScale, display);
    }
    return normalizeVideo(raw);
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
export function changeVideo(change, storage = browserStorage(), display = displayOf()) {
  let next = change === null ? normalizeVideo({}) : normalizeVideo({ ...storedVideo(storage, display), ...change });
  // A mix no preset matches is CUSTOM's from now on.
  if (change !== null && performanceOf(next) === PERFORMANCE.custom) next = normalizeVideo({ ...next, custom: next });
  storeVideo(change === null ? null : next, storage);
  for (const fn of listeners) {
    try { fn(next); } catch (error) { console.warn('video settings listener failed', error); }
  }
  return next;
}
