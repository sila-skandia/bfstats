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
// that ran it (`ld`, sidecar/input.mjs `atAck`); over the last `windowMs` of
// acks the shortest wait is the margin by which the latest word still made
// its tick (counted as if made on time, below). Above `target` (plus the
// page's long frames, below) the page's clock runs slow, below it
// fast, in
// proportion (`tau` ms of error a 100% change), within [1 - maxSlow,
// 1 + maxFast]. Every tick is still exactly 1/30 s of simulation and no word
// is dropped: only how often the page owes one changes, which moves when its
// words arrive. A tick the server starved (`st`) while the page's frames were
// no longer than the margin covers and the sidecar held nothing means the
// margin was too thin for this machine's jitter, so the target grows by
// `bump` and creeps back at `decay` ms a second.
//
// The margin has to cover the page's own frames (2026-10-25). A word is made
// at the first frame after its tick falls due, so it is late by up to one
// frame, and the shortest wait is the margin left for the latest of them.
// Until 2026-10-25 the target was a fixed 8 ms over the last 12 acks (0.6 s),
// so a frame longer than any in it starved the server; a headless page with
// 60-180 ms frames starved 10% of ticks, and every starved tick puts the
// server's soldier a tick of motion (up to 0.17 m in a jump) from the page's
// (features/udp-sidecar/browser.md, "The jump, tick for tick"). Now the page
// notes how late each word was made (`noteWord`: the ticks already due when
// its frame ran them), and the pacer steers the margin each word WOULD have
// had, made on time -- its wait plus its lateness, `ld + late` -- to
// `target` plus the frame length it covers (`coverMs`): the
// `hitchSpare + 1`-th longest frame of the last `frameWindowMs`, never above
// `maxCoverMs`. Long frames that keep coming are covered, at that much
// latency; a few in the window are stalls; a steady page pays nothing.
// (Covering the longest frame outright, a headless page's one 300 ms frame
// held 270 ms of words in the pipe, and the sidecar merged them.)
//
// The page's clock also has to keep the server's time (`feedFrame`, world.js
// `inputFeed`). The page clamps a frame to 0.1 s (map.html), so a page under
// 10 fps lost the rest of every frame: at 9 fps it made 27 words a second for
// the server's 30, and the pacer, at most 4% fast, could not make it up. The
// clamped-off time is now carried into the next frame. And a stall -- a
// frame more than a tick past `coverMs`, and past `hitchFloorMs` and
// `hitchMedian` x the median frame -- runs only `coverMs` of it: the server
// has run the rest without this page's words already, so their words would
// only stand in front of it (c2914afa). So a slow page's every frame is not a
// stall, and a page whose long frames keep coming learns them instead of
// cutting them.

export const INPUT_PACE = Object.freeze({
  // ms: the shortest wait to hold. The server's frame reads datagrams, ticks
  // and sends (D-1), so `ld` includes its few ms of work. [free, numerics]
  target: 8,
  // How far the target may grow after starved ticks, and how it comes back.
  maxTarget: 30,
  bump: 4,
  decay: 0.5,
  // ms of acks the minimum is taken over, and the fewest it needs. [free]
  windowMs: 3000,
  minRows: 4,
  // ms of error that is a 100% change of rate. [free, numerics]
  tau: 1000,
  // The rate's limits. [free: a few percent is not seen in play]
  maxSlow: 0.06,
  maxFast: 0.04,
  // With no ack this long (dead, deploying, between levels), run at 1.
  staleMs: 400,
  // The page's frame clamp (map.html `frame(Math.min(dt, 0.1))`), in ms.
  clampMs: 100,
  // ms of frames the cover is read from; the frames longer than it allowed
  // in that window; its ceiling (six ticks: with the server's three, under
  // the sidecar's merge, input.mjs MERGE_ABOVE); and the stall line's floor
  // and its multiple of the median frame. [free]
  // the median frame. [free]
  frameWindowMs: 6000,
  hitchFloorMs: 100,
  hitchSpare: 2,
  maxCoverMs: 200,
  hitchMedian: 3,
});

/**
 * One frame's world time from the page's clamped `dt` (s) and the pacer's
 * `feed()` (s): the clamped-off time of the frame before carried in, and a
 * stall cut to what the margin covers. Pure; world.js `lookTicks` and `step`
 * both call it with the same arguments, so they count the same ticks.
 *   -> { fed: seconds of world time, before the clock's scale; hitch }
 */
export function feedFrame(dt, feed) {
  if (!(dt > 0)) return { fed: 0, hitch: false };
  if (!feed) return { fed: dt, hitch: false };
  const t = dt + (feed.debt > 0 ? feed.debt : 0);
  if (t >= feed.hitch) return { fed: Math.min(t, feed.cover), hitch: true };
  return { fed: t, hitch: false };
}

/**
 * noteWord(seq, lateMs)  a word sent: how long its tick had been due when
 *            the frame that ran it began (net-room.js `sendTickInputs`)
 * update({ rows, now, frameMs, wallMs, hitch }) -> the world clock's rate.
 *   rows     the room client's `inputPath().rows`: `{ n, seq, iq, sq, st,
 *            ld }` per ack, numbered, newest last
 *   now      performance.now()
 *   frameMs  this frame's `dt` as the world got it (clamped)
 *   wallMs   this frame's length on the wall clock, unclamped (else frameMs)
 *   hitch    the world cut this frame as a stall (`feedFrame`)
 * feed()    the next frame's `{ debt, hitch, cover }` in seconds, for world.js
 *           `inputFeed` (null until a frame has been seen)
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
  let hitches = 0;
  let owed = 0;          // ms the clamp cut off the last frame
  let frames = [];       // { at, ms, cut } newest last
  const late = new Map(); // page seq -> ms its word was made late
  const out = {};
  let cached = null;
  const stats = () => {
    if (cached) return cached;
    const all = frames.map((f) => f.ms).sort((a, b) => a - b);
    const median = all.length ? all[all.length >> 1] : 0;
    const spare = all.length > P.hitchSpare ? all[all.length - 1 - P.hitchSpare] : median;
    const cover = Math.min(P.maxCoverMs, Math.max(median, spare));
    cached = { cover, median };
    return cached;
  };
  const lines = () => {
    if (!frames.length) return null;
    const { cover, median } = stats();
    return {
      hitchMs: Math.max(P.hitchFloorMs, cover + 1000 / 30, P.hitchMedian * median),
      coverMs: Math.max(cover, 1000 / 30),
    };
  };
  out.update = ({ rows = [], now, frameMs = 0, wallMs = frameMs, hitch = false }) => {
    const before = lines();
    const clamped = frameMs >= P.clampMs - 0.5;
    const len = clamped ? Math.max(frameMs, wallMs) : frameMs;
    owed = hitch ? 0 : (clamped ? Math.max(0, wallMs - frameMs) : 0);
    if (hitch) hitches++;
    // A stall, or a frame longer than any the margin was built on: a starve
    // it brings is the frame's, not the margin's.
    if (hitch || (before && len > before.coverMs)) hitchAt = now;
    if (len > 0) frames.push({ at: now, ms: len, cut: hitch });
    while (frames.length && frames[0].at < now - P.frameWindowMs) frames.shift();
    cached = null;
    if (lastNow != null && now > lastNow) target = Math.max(P.target, target - (P.decay * (now - lastNow)) / 1000);
    lastNow = now;
    for (const r of rows) {
      if (!(r.n > seen)) continue;
      seen = r.n;
      lastAt = now;
      // The wait it would have had, made on time. A row whose word the page
      // has no lateness for (an older sidecar's) counts as made on time.
      if (Number.isFinite(r.ld)) win.push({ at: now, ld: r.ld + (late.get(r.seq) ?? 0) });
      if (r.st > 0) {
        starvedEvents++;
        // The page's own long frame starves the server whatever the margin,
        // and a word the sidecar still held is its pacing's, not the margin's.
        if (now - hitchAt > 500 && !(r.iq > 0)) { target = Math.min(P.maxTarget, target + P.bump); bumped++; }
      }
    }
    while (win.length && win[0].at < now - P.windowMs) win.shift();
    if (now - lastAt > P.staleMs || win.length < P.minRows) {
      // No word of the path: keep whatever the page's wall clock gives.
      if (now - lastAt > P.staleMs) win = [];
      scale = 1;
      return scale;
    }
    let m = Infinity;
    for (const w of win) if (w.ld < m) m = w.ld;
    const e = m - (target + stats().cover);
    scale = 1 - Math.max(-P.maxFast, Math.min(P.maxSlow, e / P.tau));
    return scale;
  };
  out.noteWord = (seq, lateMs) => {
    if (!Number.isInteger(seq) || !Number.isFinite(lateMs)) return;
    late.set(seq, Math.max(0, lateMs));
    if (late.size > 512) late.delete(late.keys().next().value);
  };
  out.feed = () => {
    const l = lines();
    if (!l) return null;
    return { debt: owed / 1000, hitch: l.hitchMs / 1000, cover: l.coverMs / 1000 };
  };
  out.state = () => {
    const l = lines();
    let m = null;
    for (const w of win) if (m === null || w.ld < m) m = w.ld;
    return {
      scale: +scale.toFixed(4),
      target: +target.toFixed(1),
      // The margin it holds: the target plus the frame length it covers.
      margin: +(target + stats().cover).toFixed(1),
      minWait: m,
      starvedEvents,
      bumped,
      hitches,
      hitchMs: l ? +l.hitchMs.toFixed(1) : null,
      coverMs: l ? +l.coverMs.toFixed(1) : null,
    };
  };
  out.reset = () => { win = []; scale = 1; lastAt = -Infinity; };
  return out;
}
