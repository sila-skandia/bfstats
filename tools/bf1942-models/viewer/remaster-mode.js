// Remaster mode (features/remaster-browser): the same game, levels, models
// and sounds, with the sun's real-time shadows, the remaster's water and
// explosions that light what is around them.
//
// It is OPTIONS > VIDEO's REMASTER row, off unless the player ticks it, and
// kept per browser like the other rows. It is read once, as the page loads:
// the renderer and the three build (map.html's import map) are chosen before
// the first frame and never switch mid-game, so a change waits for the next
// level. Without it the page is the retail-parity build it always was.
//
// `?remaster` on the address turns it on for that page alone and
// `?remaster=0` off, whatever is stored: what the test harnesses and a
// side-by-side comparison use.

/** Where OPTIONS > VIDEO keeps the choice: '1', '0', or absent (off). */
export const REMASTER_KEY = 'bf42-mesh-remaster';

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The stored choice: true, false, or null where the player made none.
 *  Never throws (private mode, blocked site data). */
export function storedRemaster(storage = browserStorage()) {
  try {
    const value = storage?.getItem(REMASTER_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

/** Keep the choice, or forget it with null. */
export function storeRemaster(value, storage = browserStorage()) {
  try {
    if (value === null || value === undefined) storage?.removeItem(REMASTER_KEY);
    else storage?.setItem(REMASTER_KEY, value ? '1' : '0');
  } catch { /* private mode: the choice lasts the page */ }
}

/** Whether this browser can run it at all: it needs WebGPU. */
export function remasterSupported(nav = globalThis.navigator) {
  return !!nav?.gpu;
}

/**
 * Whether a page runs remastered: `query` is the address's `remaster` value
 * (null when it has none), `stored` the player's choice, `supported` whether
 * the browser has WebGPU. The address wins over the choice, and nothing
 * turns it on in a browser that cannot draw it. map.html's first script
 * makes the same decision inline, before any module can load.
 */
export function chooseRemaster({ query = null, stored = null, supported = true } = {}) {
  if (!supported) return false;
  if (query !== null) return query !== '0';
  return stored === true;
}

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

/** True when this page runs in remaster mode. */
export const REMASTER = chooseRemaster({
  query: params.has('remaster') ? params.get('remaster') : null,
  stored: storedRemaster(),
  supported: remasterSupported(),
});

/**
 * What the remaster modules hand the rest of the page, filled in by
 * remaster-renderer.js once the renderer is up (`materials`, `scene`). The
 * page's own modules reach this registry (on the global, `bfRemasterHooks`,
 * so they need no import and stay loadable by the test harnesses that copy
 * them alone) rather than the remaster modules themselves, which resolve
 * three/webgpu and three/tsl and so can only load under the remaster import
 * map. Empty without the remaster.
 */
export const remasterHooks = globalThis.bfRemasterHooks ?? (globalThis.bfRemasterHooks = {});
