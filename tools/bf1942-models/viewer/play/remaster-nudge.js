// A quiet pointer to OPTIONS > VIDEO > REMASTER for a player who has never
// met it (features/remaster-browser, "Finding the row").
//
// The remaster is off until ticked, and the row is three clicks deep, so a
// player who never opens VIDEO never learns the page can draw sun shadows.
// Until they do, the front end marks the way there:
//
//   - OPTIONS on the main nav, on every other tab, and VIDEO on OPTIONS' own
//     row, wear a slow warm glow, and every few seconds give a short shiver,
//     the way a pager buzzes once and then waits;
//   - the REMASTER row itself carries a NEW badge.
//
// The glow and the shiver stop for good once the player has opened VIDEO
// with the row on it (`SEEN_KEY`). The badge stays until the player ticks
// the row or unticks it: a choice made is the badge's answer. Nothing is
// drawn in a browser without WebGPU, where the row is not drawn either, and
// nothing in a level: only `play/index.html` turns the nudge on (`enable`),
// so the in-game Escape menu never repaints for it.

import { remasterSupported, storedRemaster } from '../remaster-mode.js';
import { menuMovie } from './menu-movie.js';

/** Set once the player has seen the REMASTER row. */
export const SEEN_KEY = 'bf42-mesh-remaster-seen';

/** The cue's warm amber, the menu's own highlight family. */
const AMBER = [1, 0.72, 0.22];

/** The badge's lettering: dark ink on the amber. */
export const BADGE_INK = [0.1, 0.07, 0.02, 1];

/** One shiver every PERIOD ms, lasting SHIVER ms. */
const PERIOD = 4200;
const SHIVER = 520;

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

let enabled = false;
let seenThisPage = false;
const listeners = new Set();
let ticking = false;

function seen() {
  if (seenThisPage) return true;
  try { return browserStorage()?.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

/** Whether the movie is already repainting every screen 25 times a second. */
function movieDriving() {
  const frame = menuMovie.frame();
  return !!frame && !frame.paused;
}

/** About 30 repaints a second while a cue is drawn and nothing else is
 *  repainting; none once every cue is gone. */
function tick() {
  if (!remasterNudge.badge() && !remasterNudge.wanted()) { ticking = false; return; }
  if (!movieDriving() && !document.hidden) {
    for (const fn of listeners) {
      try { fn(); } catch (error) { console.warn('remaster-nudge: a repaint threw', error); }
    }
  }
  setTimeout(() => requestAnimationFrame(tick), 33);
}

function startTicking() {
  if (ticking || !enabled || !listeners.size) return;
  ticking = true;
  requestAnimationFrame(tick);
}

const rgba = a => `rgba(${AMBER.map(v => Math.round(v * 255)).join(',')},${a})`;

export const remasterNudge = {
  /** Turn the cues on for this page (the front end only). */
  enable() { enabled = true; startTicking(); },

  /** OPTIONS and VIDEO glow and shiver: the row has never been seen. */
  wanted() {
    return enabled && remasterSupported() && storedRemaster() === null && !seen();
  },

  /** REMASTER wears NEW: no choice made yet. */
  badge() {
    return enabled && remasterSupported() && storedRemaster() === null;
  },

  /** The player has the row in front of them: no more glow or shiver. */
  markSeen() {
    if (seenThisPage) return;
    seenThisPage = true;
    try { browserStorage()?.setItem(SEEN_KEY, '1'); } catch { /* lasts the page */ }
  },

  /** Repaint on each cue frame; returns the unsubscribe. */
  onTick(fn) {
    listeners.add(fn);
    startTicking();
    return () => listeners.delete(fn);
  },

  /** The shiver's sideways offset, in layout units, at `now`: a decaying
   *  buzz at the start of each period, still between. */
  offset(now = performance.now()) {
    const p = now % PERIOD;
    if (p > SHIVER) return 0;
    const decay = 1 - p / SHIVER;
    return Math.sin((p / 1000) * Math.PI * 2 * 22) * 1.6 * decay;
  },

  /** The glow's strength at `now`, 0..1: a slow breath, brightest as the
   *  shiver lands. */
  glow(now = performance.now()) {
    const breath = 0.5 + 0.5 * Math.sin((now / PERIOD) * Math.PI * 2 * 2);
    const p = now % PERIOD;
    const kick = p < SHIVER ? 1 - p / SHIVER : 0;
    return Math.min(1, 0.35 + 0.4 * breath + 0.5 * kick);
  },

  /** A warm edge around `rect` ([x, y, w, h] in layout units). */
  paintGlow(ctx, rect, now = performance.now()) {
    const g = this.glow(now);
    const [x, y, w, h] = rect;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = rgba(0.9 * g);
    ctx.shadowBlur = 10;
    ctx.strokeStyle = rgba(0.25 + 0.6 * g);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    // A second, tighter pass so the edge reads on a bright plate too.
    ctx.shadowBlur = 3;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  },

  /** The NEW badge, its left edge at x, centred on y: an amber tab,
   *  breathing gently. Returns the rect the word goes in, for the caller to
   *  letter in the menu's own face (`BADGE_INK`). */
  paintBadge(ctx, x, y, now = performance.now()) {
    const g = 0.5 + 0.5 * Math.sin((now / 1400) * Math.PI * 2);
    const w = 30;
    const h = 13;
    const top = Math.round(y - h / 2);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = rgba(0.35 + 0.45 * g);
    ctx.shadowBlur = 4 + 4 * g;
    ctx.fillStyle = rgba(0.85 + 0.15 * g);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, top, w, h, 2);
    else ctx.rect(x, top, w, h);
    ctx.fill();
    ctx.restore();
    return [x, top, w, h];
  },

  /** For tests and `window.__menu`. */
  get state() {
    return { enabled, wanted: this.wanted(), badge: this.badge(), seen: seen(), ticking };
  },
};
