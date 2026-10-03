// Whether the map page's WebGL canvas gets MSAA (three's `antialias`). It is
// a context attribute, so it is decided once, before the renderer exists.
//
// An Intel GPU under Mesa (Linux, ChromeOS) locks up drawing the effect
// sprites -- runs of alpha- and additive-blended quads -- into a 4x MSAA
// target: the GPU's own engine reset fails, the kernel resets the whole chip,
// and Firefox, whose compositor shares the browser process, crashes while
// recovering. With MSAA off it has not hung (features/intel-gpu-msaa-hang).
// So there MSAA is off unless `?aa=1` asks for it; `?aa=0` turns it off
// anywhere, as it always has.

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

/**
 * `{ antialias, reason, gpu }` for the page's `?aa` value and user agent.
 * `probe` is only called on a Mesa platform with no `?aa` override, so most
 * visitors never open the extra context.
 */
export function chooseAntialias({ aa = null, userAgent = '', probe = probeGpu } = {}) {
  if (aa === '0') return { antialias: false, reason: 'aa=0', gpu: '' };
  if (aa === '1') return { antialias: true, reason: 'aa=1', gpu: '' };
  if (!MESA_PLATFORM.test(userAgent) || /Android/.test(userAgent)) {
    return { antialias: true, reason: 'default', gpu: '' };
  }
  const { vendor, renderer } = probe() ?? EMPTY;
  if (/intel/i.test(`${vendor} ${renderer}`)) {
    return { antialias: false, reason: 'intel-mesa', gpu: renderer || vendor };
  }
  return { antialias: true, reason: 'default', gpu: '' };
}
