// `viewer/render-antialias.js` under node: whether the map page asks for MSAA,
// and how it reads which GPU it is on (see `test_render_antialias.py`). The
// module is imported from the viewer tree in place through `sim/env.mjs`'s
// hooks, so the file under test is the file the page loads.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { ANTIALIAS_KEY, chooseAntialias, probeGpu, storeAntialias, storedAntialias } = await import(pathToFileURL(path.join(viewer, 'render-antialias.js')).href);

const UA = {
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  chromeOS: 'Mozilla/5.0 (X11; CrOS x86_64 16002.44.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};
const GPU = {
  firefoxIntel: { vendor: 'Intel', renderer: 'Intel(R) HD Graphics, or similar' },
  chromeIntel: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) Xe Graphics (ADL GT2), OpenGL 4.6)' },
  nvidia: { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 3050 Ti Laptop GPU/PCIe/SSE2' },
  amd: { vendor: 'AMD', renderer: 'AMD Radeon Graphics (radeonsi, renoir, LLVM 20.1.8, DRM 3.61)' },
  silent: { vendor: '', renderer: '' },
};

// Each case counts its probes: the extra context should only be opened where
// the answer depends on it.
function choose(aa, userAgent, gpu, stored = null) {
  let probes = 0;
  const result = chooseAntialias({ aa, stored, userAgent, probe: () => { probes++; return gpu; } });
  return { ...result, probes };
}

const results = { choose: {
  linuxFirefoxIntel: choose(null, UA.linuxFirefox, GPU.firefoxIntel),
  linuxChromeIntel: choose(null, UA.linuxChrome, GPU.chromeIntel),
  chromeOSIntel: choose(null, UA.chromeOS, GPU.chromeIntel),
  linuxNvidia: choose(null, UA.linuxChrome, GPU.nvidia),
  linuxAmd: choose(null, UA.linuxFirefox, GPU.amd),
  linuxSilent: choose(null, UA.linuxFirefox, GPU.silent),
  linuxProbeNull: choose(null, UA.linuxFirefox, null),
  androidIntel: choose(null, UA.android, GPU.chromeIntel),
  windowsIntel: choose(null, UA.windows, GPU.chromeIntel),
  macIntel: choose(null, UA.mac, GPU.chromeIntel),
  forcedOnIntel: choose('1', UA.linuxFirefox, GPU.firefoxIntel),
  forcedOffWindows: choose('0', UA.windows, GPU.nvidia),
  otherValueIntel: choose('2', UA.linuxFirefox, GPU.firefoxIntel),
  emptyUa: choose(null, '', GPU.firefoxIntel),
  storedOnIntel: choose(null, UA.linuxFirefox, GPU.firefoxIntel, true),
  storedOffWindows: choose(null, UA.windows, GPU.nvidia, false),
  queryOverStored: choose('0', UA.windows, GPU.nvidia, true),
} };

// The choice OPTIONS > VIDEO keeps: what is read back after each write, and
// a storage that throws (private mode) answering "no choice".
function memoryStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    raw: () => map.get(ANTIALIAS_KEY) ?? null,
  };
}
const kept = memoryStorage();
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
                  removeItem() { throw new Error('blocked'); } };
results.stored = { none: storedAntialias(kept) };
storeAntialias(true, kept);
results.stored.on = { value: storedAntialias(kept), raw: kept.raw() };
storeAntialias(false, kept);
results.stored.off = { value: storedAntialias(kept), raw: kept.raw() };
storeAntialias(null, kept);
results.stored.cleared = { value: storedAntialias(kept), raw: kept.raw() };
kept.setItem(ANTIALIAS_KEY, 'yes');
results.stored.junk = storedAntialias(kept);
storeAntialias(true, blocked);
results.stored.blocked = storedAntialias(blocked);
results.stored.noStorage = storedAntialias(null);

// probeGpu against stand-in documents: what each browser answers, and what
// happens when there is no context or the canvas throws.
function fakeDoc({ webgl2 = true, webgl = true, renderer, vendor, unmasked, throws = false }) {
  const log = { lost: 0, contexts: [] };
  const gl = {
    VENDOR: 0x1f00, RENDERER: 0x1f01,
    getParameter(p) {
      if (p === 0x1f00) return vendor;
      if (p === 0x1f01) return renderer;
      if (p === 0x9245) return unmasked?.vendor;
      if (p === 0x9246) return unmasked?.renderer;
      return null;
    },
    getExtension(name) {
      if (name === 'WEBGL_debug_renderer_info') return unmasked ? { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 } : null;
      if (name === 'WEBGL_lose_context') return { loseContext: () => { log.lost++; } };
      return null;
    },
  };
  const doc = {
    createElement: () => ({
      getContext(kind, attrs) {
        if (throws) throw new Error('blocked');
        log.contexts.push({ kind, antialias: attrs?.antialias });
        if (kind === 'webgl2') return webgl2 ? gl : null;
        return webgl ? gl : null;
      },
    }),
  };
  return { doc, log };
}
function probe(spec) {
  const { doc, log } = fakeDoc(spec);
  return { ...probeGpu(doc), ...log };
}
results.probe = {
  firefox: probe({ vendor: 'Intel', renderer: 'Intel(R) HD Graphics, or similar' }),
  chrome: probe({ vendor: 'WebKit', renderer: 'WebKit WebGL', unmasked: GPU.chromeIntel }),
  chromeNoExtension: probe({ vendor: 'WebKit', renderer: 'WebKit WebGL' }),
  webgl1Only: probe({ webgl2: false, vendor: 'Intel', renderer: 'Intel(R) HD Graphics, or similar' }),
  noContext: probe({ webgl2: false, webgl: false }),
  throws: probe({ throws: true }),
};

process.stdout.write(JSON.stringify(results));
