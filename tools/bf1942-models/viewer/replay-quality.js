// A replay's quality, kept up by its frame rate (features/replay-performance,
// "Quality on the fly").
//
// The owner's 2026-11-13 ask, after the phone profile: on any device, when a
// replay cannot hold its frame rate, drop the quality on the fly, mostly on
// its own, with the level it is drawing at shown under the bar's "..." menu
// where the viewer can pin another.
//
// The ladder runs from the viewer's own settings (Full) down. Each step is a
// cap over OPTIONS > VIDEO's choice and a share of the canvas's pixel ratio,
// all of it live (`video-apply.js` `setRuntime`): nothing is stored, and the
// options screen still shows the choice. Anti-aliasing and lightmaps are not
// on it: one is the WebGL context's, the other the level's build.
//
// Auto watches the drawn frames' intervals, median over WINDOW_MS, while the
// replay plays undisturbed (not loading, dragged, seeking or hidden). Under
// SLOW of the target rate it steps down one, lets the page settle, and
// measures again. A step that bought less than HELPED more frames is undone
// and Auto stops there: what holds the frame rate down is not what the
// ladder lowers (a display or a browser capped at 30, a CPU busy with the
// round), and dropping further would only make the picture worse. It never
// steps back up on its own; the menu does.

/** The ladder, best first. `cap` is the most each row may be; `ratioScale`
 *  the canvas's pixel ratio's share. */
export const LADDER = Object.freeze([
  Object.freeze({ id: 'full', name: 'Full', cap: null, ratioScale: 1 }),
  Object.freeze({ id: 'reduced', name: 'Reduced', ratioScale: 0.85,
    cap: Object.freeze({ graphicsQuality: 2, effectsQuality: 2, shadows: false, viewDistance: 90 }) }),
  Object.freeze({ id: 'low', name: 'Low', ratioScale: 0.7,
    cap: Object.freeze({ graphicsQuality: 1, effectsQuality: 1, environmentMapping: false, shadows: false, viewDistance: 75 }) }),
  Object.freeze({ id: 'lowest', name: 'Lowest', ratioScale: 0.5,
    cap: Object.freeze({ graphicsQuality: 1, effectsQuality: 1, environmentMapping: false, shadows: false, viewDistance: 50, textureQuality: 2 }) }),
]);

/** The span of drawn frames one judgement reads, ms. */
export const WINDOW_MS = 4000;
/** The fewest frames a judgement reads (a 2 fps page still gets one). */
export const MIN_FRAMES = 8;
/** After a step, the page's own settling (a resize, textures) is not read. */
export const SETTLE_MS = 2000;
/** Slow: a median rate under this share of the target. */
export const SLOW = 0.75;
/** A step that did not lift the rate by this share is undone. */
export const HELPED = 0.08;
/** A gap this long between frames is the page or the tab stopping, not a
 *  frame; it is not read. */
const GAP_MS = 1000;

/** Where the viewer's pick is kept: 'auto' or a ladder id. */
export const QUALITY_KEY = 'bf42-replay-quality';

/** 'auto' or a ladder id from anything: the query's, the stored one. */
export function qualityMode(value) {
  const v = String(value ?? '').toLowerCase();
  return LADDER.some(s => s.id === v) ? v : v === 'auto' ? 'auto' : null;
}

export function storedQuality(storage = globalThis.localStorage) {
  try { return qualityMode(storage?.getItem(QUALITY_KEY)); } catch { return null; }
}

export function storeQuality(mode, storage = globalThis.localStorage) {
  try { storage?.setItem(QUALITY_KEY, mode); } catch { /* a private window: this replay only */ }
}

const median = list => {
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The governor. `apply(step)` puts a ladder step on the page; `targetFps`
 * is the rate the page is drawing for (the phone's cap, else 60); `mode`
 * 'auto' or a ladder id to start pinned at; `onChange(state)` hears every
 * change; `log` a step's line.
 */
export function createQualityGovernor({ apply, targetFps = 60, mode = 'auto', onChange = null, log = null } = {}) {
  let current = 'auto';
  let step = 0;
  let stopped = false;
  let samples = [];          // [at, interval]
  let last = null;
  let holdUntil = -Infinity;
  let trial = null;          // { from, fps } while a step is judged
  let lastFps = null;

  const state = () => ({ mode: current, step, level: LADDER[step], stopped, fps: lastFps });
  const changed = () => onChange?.(state());
  const go = (next, why) => {
    step = next;
    apply(LADDER[step]);
    samples = [];
    last = null;
    log?.(`replay quality: ${LADDER[step].name}${why ? ` (${why})` : ''}`);
  };

  function setMode(next) {
    const m = qualityMode(next) ?? 'auto';
    current = m;
    trial = null;
    stopped = false;
    samples = [];
    last = null;
    if (m === 'auto') go(0, 'auto');
    else go(LADDER.findIndex(s => s.id === m), 'chosen');
    changed();
  }

  /** Each drawn frame: `now` its time (ms), `busy` true while the page is
   *  loading, dragged, seeking or hidden, when its frames say nothing of the
   *  quality. */
  function frame(now, busy = false) {
    if (current !== 'auto' || stopped) return;
    if (busy || now < holdUntil) { last = null; return; }
    if (last !== null) {
      const interval = now - last;
      if (interval > 0 && interval < GAP_MS) samples.push([now, interval]);
    }
    last = now;
    while (samples.length && samples[0][0] < now - WINDOW_MS) samples.shift();
    if (samples.length < MIN_FRAMES) return;
    // A full window: its first frame at least WINDOW_MS back, less one frame.
    const span = now - samples[0][0] + samples[0][1];
    if (span < WINDOW_MS) return;
    const fps = 1000 / median(samples.map(s => s[1]));
    lastFps = Math.round(fps);
    samples = [];
    if (trial) {
      const was = trial;
      trial = null;
      if (fps < was.fps * (1 + HELPED)) {
        // Lowering did not buy frames: what holds them down is something
        // else. Put back what the step took and stop here.
        go(was.from, `${Math.round(fps)} fps after it, ${Math.round(was.fps)} before: not the quality`);
        stopped = true;
        holdUntil = now + SETTLE_MS;
        changed();
        return;
      }
    }
    if (fps < targetFps * SLOW && step < LADDER.length - 1) {
      trial = { from: step, fps };
      go(step + 1, `${Math.round(fps)} fps against ${targetFps}`);
      holdUntil = now + SETTLE_MS;
      changed();
    }
  }

  /** A seek, a cut, a camera change: its frames are not read for `ms`. */
  function hold(ms = SETTLE_MS, now = globalThis.performance?.now?.() ?? 0) {
    holdUntil = Math.max(holdUntil, now + ms);
    last = null;
  }

  setMode(mode);

  return {
    frame,
    hold,
    setMode,
    get state() { return state(); },
  };
}
