// The boot loader: a loading scene from the very first frame of a page whose
// own code takes seconds to arrive. map.html's module is about 360 files and
// play/index.html's about 80; on a cold cache (a first visit, and the first
// load after every deploy, which moves every module to a new URL) map.html
// was black for twelve seconds before its load screen could draw.
//
// So this is not a module. scripts/build-boot-loader.mjs bundles it, with
// play/loaders/kit.js and the scenes, into one classic script,
// play/boot-loader.bundle.js, and mesh/stamp-viewer.mjs inlines that into the
// page at image build (`data-inline`). It runs as the parser reaches it, first
// in <body>, before any of the page's module requests start, so only the
// scene's two or three small sprites are fetched. A local server loads it by
// its `src`.
//
// The page hands over by calling `window.__bootLoader.end()`: map.html when its
// load overlay begins (progress.js), the front end when its first screen is up,
// or the Short loader for a `?short=` link (short-loader.js), which holds it.
// It is a nicety: nothing here may throw into the page.

import { bootLoader } from '../loaders/kit.js';
import { SCENES } from '../loaders/scenes.js';

/** The words for this page and address, or null where the page draws its own
 *  first frame (a relay join's connect screen, a headless capture, the
 *  debug panel with no level). */
export function bootWords(page, params) {
  if (params.has('shots')) return null;
  if (page === 'map') {
    if (params.has('relay') && !params.has('replay')) return null;
    if (params.has('replay')) return 'Loading the replay';
    if (params.has('map')) return 'Loading the battle';
    return null;
  }
  if (page === 'front') {
    if (params.get('tab') === 'replay' && params.get('short')) return 'Loading the Short';
    if (params.get('tab') === 'replay') return 'Loading BattleView';
    return 'Loading';
  }
  return null;
}

(() => {
  try {
    const script = document.currentScript;
    const words = bootWords(script?.dataset.page ?? '', new URLSearchParams(location.search));
    if (!words) return;
    const boot = bootLoader({ scenes: SCENES, words });
    let ended = false;
    window.__bootLoader = {
      /** Set by a later loader that keeps this one up as its own. */
      held: false,
      end() {
        if (ended) return;
        ended = true;
        if (window.__bootLoader === this) delete window.__bootLoader;
        boot.end();
      },
    };
    // A page whose code failed to arrive would never hand over: show it.
    addEventListener('error', event => {
      if (event.target instanceof HTMLScriptElement || event.error) window.__bootLoader?.end();
    }, true);
  } catch (error) {
    console.warn('boot-loader:', error);
  }
})();
