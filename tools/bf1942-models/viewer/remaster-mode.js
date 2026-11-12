// Remaster mode (features/remaster-browser): the same sim, levels, models and
// sounds, presented the way a game made today would look and sound.
//
// `?remaster` on map.html turns it on. Without it the page is the
// retail-parity build it always was, so the two can be compared side by side
// on the same level and the same camera. The flag is read once, at module
// load: the renderer, the three build (map.html's import map) and the audio
// chain are all chosen before the first frame and never switch mid-session.

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

/**
 * The tab's remaster setting: the address's `?remaster` (and its flags) when
 * it has one, else what the menu was opened with in this tab (`bfRemaster`
 * in sessionStorage, written by play/index.html and map.html). Null is off.
 */
function remasterSetting() {
  if (params.get('remaster') === '0') return null;
  if (params.has('remaster')) return params.get('remaster');
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('bfRemaster'); } catch { return null; }
}
const SETTING = remasterSetting();

/** True when this page runs in remaster mode. */
export const REMASTER = SETTING !== null;

/**
 * Parts of the remaster turned off for comparison and the frame-time table:
 * `?remaster=noao,nobloom,nofog,nowater,noshadow,nopost,nosky`.
 */
export const REMASTER_OFF = new Set(REMASTER ? SETTING.split(',').filter(Boolean) : []);

/** True when remaster rendering is on but `?remasterAudio=0` keeps the retail audio chain. */
export const REMASTER_AUDIO = REMASTER && params.get('remasterAudio') !== '0';

/**
 * What the remaster modules hand the rest of the page, filled in by
 * remaster-renderer.js once the renderer is up (`materials`, `scene`). The
 * page's own modules reach this registry (on the global, `bfRemasterHooks`,
 * so they need no import and stay loadable by the test harnesses that copy
 * them alone) rather than the remaster modules themselves, which resolve
 * three/webgpu and three/tsl and so can only load under the remaster import
 * map. Empty without `?remaster`.
 */
export const remasterHooks = globalThis.bfRemasterHooks ?? (globalThis.bfRemasterHooks = {});
