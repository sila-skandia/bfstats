// The page's world clock against a real server's tick (the UDP sidecar).
//
// The page makes one input word per world tick on its own clock, and the
// server runs one per tick on its own (ledger D-3). Nothing ties the two
// together, so whatever backlog a word meets stands for good: a hitch's
// catch-up words, or a word that missed its tick, each add a tick to every
// later word's wait, and only a tick the server runs with nothing (D-4's
// zeroed input, "starved") takes one away. Measured on the lab (wire.md
// section 39, 2026-10-24 note): a word waited 74 ms at the median from the
// sidecar to the tick that ran it, with 1-3 words standing, where 0-1 tick is
// the floor.
//
// Retail does not steer here. Its client counts whole 1/30 s ticks off its
// own wall clock (`InputManager::update` 0x0049ce70: the clock base
// 0x0097b5f8 is written nowhere else; more than ten pending collapse to one)
// and `GameClient::update` 0x0048fca0 runs them, more than nine collapsing to
// one (D-4). What bounds its backlog is the server dropping the oldest of
// more than four buffered actions (D-2), which a page cannot afford: the
// page has already run every word it sends.
//
// So this is the standard client-side clock adjustment instead. Each ack
// says how long the acked word waited from reaching the sidecar to the tick
// that ran it (`ld`, sidecar/input.mjs `atAck`); over the last `window`
// acks the shortest wait is the margin by which the latest word still made
// its tick. Above `target` the page's clock runs slow, below it fast, in
// proportion (`tau` ms of error a 100% change), within [1 - maxSlow,
// 1 + maxFast]. Every tick is still exactly 1/30 s of simulation and no word
// is dropped: only how often the page owes one changes, which moves when its
// words arrive. A tick the server starved (`st`) while the page's frames were
// even and the sidecar held nothing means the margin was too thin for this machine's jitter, so the
// target grows by `bump` and creeps back at `decay` ms a second.

export const INPUT_PACE = Object.freeze({
  // ms: the shortest wait to hold. The server's frame reads datagrams, ticks
  // and sends (D-1), so `ld` includes its few ms of work. [free, numerics]
  target: 8,
  // How far the target may grow after starved ticks, and how it comes back.
  maxTarget: 30,
  bump: 4,
  decay: 0.5,
  // Acks the minimum is taken over (20 a second). [free]
  window: 12,
  // ms of error that is a 100% change of rate. [free, numerics]
  tau: 1000,
  // The rate's limits. [free: a few percent is not seen in play]
  maxSlow: 0.06,
  maxFast: 0.04,
  // A frame longer than this is the page's own hitch: the server starved
  // because the page made no words, not because the margin was thin.
  hitchMs: 60,
  // With no ack this long (dead, deploying, between levels), run at 1.
  staleMs: 400,
});

/**
 * update({ rows, now, frameMs }) -> the world clock's rate.
 *   rows     the room client's `inputPath().rows`: `{ n, iq, sq, st, ld }`
 *            per ack, numbered, newest last
 *   now      performance.now()
 *   frameMs  this frame's length
 * state()   what it steers on, for `__net().pace`.
 */
export function createInputPacer(opts = {}) {
  const P = { ...INPUT_PACE, ...opts };
  let seen = 0;
  let win = [];          // { at, ld } newest last
  let target = P.target;
  let lastAt = -Infinity;
  let hitchAt = -Infinity;
  let lastNow = null;
  let scale = 1;
  let starvedEvents = 0;
  let bumped = 0;
  const out = {};
  out.update = ({ rows = [], now, frameMs = 0 }) => {
    if (frameMs > P.hitchMs) hitchAt = now;
    if (lastNow != null && now > lastNow) target = Math.max(P.target, target - (P.decay * (now - lastNow)) / 1000);
    lastNow = now;
    for (const r of rows) {
      if (!(r.n > seen)) continue;
      seen = r.n;
      lastAt = now;
      if (Number.isFinite(r.ld)) win.push(r.ld);
      if (r.st > 0) {
        starvedEvents++;
        // The page's own hitch starves the server whatever the margin, and
        // a word the sidecar still held is its pacing's, not the margin's.
        if (now - hitchAt > 500 && !(r.iq > 0)) { target = Math.min(P.maxTarget, target + P.bump); bumped++; }
      }
    }
    if (win.length > P.window) win = win.slice(-P.window);
    if (now - lastAt > P.staleMs || win.length < Math.min(4, P.window)) {
      // No word of the path: keep whatever the page's wall clock gives.
      if (now - lastAt > P.staleMs) win = [];
      scale = 1;
      return scale;
    }
    const m = Math.min(...win);
    const e = m - target;
    scale = 1 - Math.max(-P.maxFast, Math.min(P.maxSlow, e / P.tau));
    return scale;
  };
  out.state = () => ({
    scale: +scale.toFixed(4),
    target: +target.toFixed(1),
    minWait: win.length ? Math.min(...win) : null,
    starvedEvents,
    bumped,
  });
  out.reset = () => { win = []; scale = 1; lastAt = -Infinity; };
  return out;
}
