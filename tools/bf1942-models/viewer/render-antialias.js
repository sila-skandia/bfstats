// Whether the map page's WebGL canvas gets MSAA (three's `antialias`). It is
// a context attribute, so it is decided once, before the renderer exists.
//
// An Intel GPU under Mesa (Linux, ChromeOS) locks up drawing the effect
// sprites -- runs of alpha- and additive-blended quads -- into a 4x MSAA
// target: the GPU's own engine reset fails, the kernel resets the whole chip,
// and Firefox, whose compositor shares the browser process, crashes while
// recovering. With MSAA off it has not hung (features/intel-gpu-msaa-hang).
// So there MSAA is off unless the player ticks it on OPTIONS > VIDEO or
// `?aa=1` asks for it; `?aa=0` turns it off anywhere, as it always has.

const EMPTY = Object.freeze({ vendor: '', renderer: '' });

/**
 * Which GPU the browser draws with, from a throwaway context that is let go
 * at once: `{ vendor, renderer }`, empty strings when it will not say.
 *
 * Firefox answers in `RENDERER` itself (sanitised to a family, "Intel(R) HD
 * Graphics, or similar") and warns that the debug extension is deprecated;
 * Chromium answers "WebKit WebGL" there and the GPU only through the
 * extension. Never throws.
 */
export function probeGpu(doc = globalThis.document) {
  try {
    const canvas = doc.createElement('canvas');
    const attrs = { antialias: false, depth: false, stencil: false };
    const gl = canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs);
    if (!gl) return EMPTY;
    let vendor = String(gl.getParameter(gl.VENDOR) ?? '');
    let renderer = String(gl.getParameter(gl.RENDERER) ?? '');
    if (/^webkit/i.test(renderer)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (info) {
        vendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) ?? vendor);
        renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? renderer);
      }
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { vendor, renderer };
  } catch {
    return EMPTY;
  }
}

// Where an Intel GPU is driven by Mesa. Android says Linux too, and is not.
const MESA_PLATFORM = /\b(Linux|CrOS)\b/;

/** Where OPTIONS > VIDEO keeps the player's choice: '1', '0', or absent for
 *  the GPU's own default. */
export const ANTIALIAS_KEY = 'bf42-mesh-antialias';

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The stored choice: true, false, or null where the player made none.
 *  Never throws (private mode, blocked site data). */
export function storedAntialias(storage = browserStorage()) {
  try {
    const value = storage?.getItem(ANTIALIAS_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

/** Keep the choice, or forget it with null. */
export function storeAntialias(value, storage = browserStorage()) {
  try {
    if (value === null || value === undefined) storage?.removeItem(ANTIALIAS_KEY);
    else storage?.setItem(ANTIALIAS_KEY, value ? '1' : '0');
  } catch { /* private mode: the choice lasts the page */ }
}

/**
 * `{ antialias, reason, gpu }` for the page's `?aa` value, the player's
 * stored choice (`stored`: true, false or null) and user agent. The query
 * wins over the choice, and the choice over the GPU's default. `probe` is
 * only called on a Mesa platform with neither, so most visitors never open
 * the extra context.
 */
export function chooseAntialias({ aa = null, stored = null, userAgent = '', probe = probeGpu } = {}) {
  if (aa === '0') return { antialias: false, reason: 'aa=0', gpu: '' };
  if (aa === '1') return { antialias: true, reason: 'aa=1', gpu: '' };
  if (stored === true || stored === false) return { antialias: stored, reason: 'stored', gpu: '' };
  if (!MESA_PLATFORM.test(userAgent) || /Android/.test(userAgent)) {
    return { antialias: true, reason: 'default', gpu: '' };
  }
  const { vendor, renderer } = probe() ?? EMPTY;
  if (/intel/i.test(`${vendor} ${renderer}`)) {
    return { antialias: false, reason: 'intel-mesa', gpu: renderer || vendor };
  }
  return { antialias: true, reason: 'default', gpu: '' };
}
