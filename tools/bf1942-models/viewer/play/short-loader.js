// The Short loader (features/replay-shorts, "The loader" and "The loaders"):
// what a Short shows while it is on its way. Each time it starts it plays one
// scene at random out of play/loaders/: the prone BAR gunner whose brass
// stacks into a pyramid, the duel where every round goes over a head, and the
// WWII small-unit and armour tactics, all drawn from the game's own models.
// The skeleton they share (stage, scale, words, timers, reduced motion, the
// boot shade) is play/loaders/kit.js.
//
// One loader serves the page twice: full screen from the first moment a
// `?short=` link is opened (`bootShortLoader`, before the REPLAY tab has even
// loaded), and over a Short's poster until its video plays (`createShortLoader`).
// It is a nicety: nothing here may throw into the player.

import { bootLoader, createLoader } from './loaders/kit.js';
import { SCENES } from './loaders/scenes.js';

/** A loader: `element` to place, `start()` and `stop()`. Each start plays a
 *  scene at random, not the one it played last. */
export function createShortLoader({ words = 'Loading the Short' } = {}) {
  return createLoader({ scenes: SCENES, words });
}

// --- the boot loader ----------------------------------------------------------

let boot = null;

/** Full screen from page load while a `?short=` link is on its way: the
 *  REPLAY tab, the feed and the Short all load behind it. Ends with
 *  `endBootShortLoader`, when the player opens or the Short is not there. */
export function bootShortLoader() {
  try {
    if (boot) return;
    // The page's boot loader (boot-loader/entry.js) has been up since the
    // first frame with the same words: keep it, rather than start a second.
    const early = globalThis.__bootLoader;
    if (early) {
      early.held = true;
      boot = { end: () => early.end() };
      return;
    }
    boot = bootLoader({ scenes: SCENES, words: 'Loading the Short' });
  } catch (error) {
    console.warn('short-loader: the boot loader', error);
  }
}

export function endBootShortLoader() {
  if (!boot) return;
  const b = boot;
  boot = null;
  b.end();
}
