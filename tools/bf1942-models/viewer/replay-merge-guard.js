// Whether a merge's alignment is credible (features/round-replay-merge,
// "The guard"). The clock fit finds the offset most of two files' rare shared
// events agree on, and a handful of events can agree by chance: two rounds of
// one server, their adverts on one timer, lined up 58 events (55 of them the
// server's adverts) and left every kill unmatched (the first real pair,
// 2026-09-29). Over the stretch both files recorded, a round's kills and
// scores reach every client, so two files of one round share nearly all of
// theirs; two rounds share almost none.
//
// - The scores decide. Where both files hold at least `minScoreEvents` score
//   events over their overlap, fewer than `minScoreShare` of them lining up
//   (paired by what they say, on the fitted clock) is two rounds.
// - Where the scores cannot decide (a short or quiet overlap), the server's
//   world clock (the 10-second timer, 0x29) can: the files' world-time
//   offsets, on the fitted clock, more than `worldClockSlack` apart is two
//   rounds.
// - Where neither can, the fit stands, as it did before the guard.
//
// Three.js-free and pure.

import { clockBounds } from './replay-merge-clock.js';
import { eventKey } from './replay-merge-read.js';

/** A merge the guard refused: `guard` is what it measured. */
export class MergeRefused extends Error {
  constructor(message, guard) {
    super(message);
    this.name = 'MergeRefused';
    this.guard = guard;
  }
}

/** `m:ss` or `h:mm:ss`. */
function span(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

/** A file's score events after its own opening, on `map`'s clock, within
 *  `[lo, hi]`, by key in time order. */
function scoresOf(src, map, lo, hi) {
  const out = new Map();
  let n = 0;
  for (const ev of src.events) {
    if (ev.r.e !== 'score' || ev.head) continue;
    const t = map(ev.t);
    if (t < lo || t > hi) continue;
    const key = eventKey(ev.r);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(t);
    n += 1;
  }
  return { byKey: out, n };
}

/** Copies of each key paired in order, within `window` seconds. */
function pairScores(a, b, window) {
  let matched = 0;
  for (const [key, times] of a) {
    const others = b.get(key);
    if (!others) continue;
    let i = 0;
    let j = 0;
    while (i < times.length && j < others.length) {
      const d = times[i] - others[j];
      if (Math.abs(d) <= window) {
        matched += 1;
        i += 1;
        j += 1;
      } else if (d < 0) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  return matched;
}

/**
 * The guard's look at each file's fit against the file it was fitted to:
 * `{ credible, message, files: [{ file, against, method, overlap, scores,
 * worldClock, credible, by, reason }] }`. `fits` are `alignAll`'s, each onto
 * the first file's clock.
 */
export function checkAlignment(sources, fits, opts) {
  const files = [];
  for (let i = 1; i < sources.length; i++) {
    const src = sources[i];
    const fit = fits[i];
    const ref = sources[fit.via];
    const via = fits[fit.via];
    const mine = t => fit.a + fit.b * t;
    const theirs = t => via.a + via.b * t;
    const lo = Math.max(theirs(ref.joinT ?? 0), mine(src.joinT ?? 0));
    const hi = Math.min(theirs(ref.endT ?? ref.lastT), mine(src.endT ?? src.lastT));
    const out = {
      file: src.file, against: ref.file, method: fit.method,
      overlap: [Number(lo.toFixed(3)), Number(hi.toFixed(3))], scores: null, worldClock: null,
      credible: true, by: 'nothing to check', reason: null,
    };
    if (hi > lo) {
      // A fit by the world clock alone is good to a second.
      const window = fit.method === 'clock' ? Math.max(opts.eventWindow, 1.5) : opts.eventWindow;
      const a = scoresOf(ref, theirs, lo, hi);
      const b = scoresOf(src, mine, lo, hi);
      const fewer = Math.min(a.n, b.n);
      const matched = pairScores(a.byKey, b.byKey, window);
      // `held`: the file fitted against's, then this one's.
      out.scores = {
        held: [a.n, b.n], matched,
        share: fewer > 0 ? Number((matched / fewer).toFixed(4)) : null,
        decides: fewer >= opts.minScoreEvents,
      };
      // Each file's world-time offset, from its ticks over the overlap: the
      // lower bound, which a tick held up in its delivery never raises.
      const wa = clockBounds(ref, theirs, lo, hi);
      const wb = clockBounds(src, mine, lo, hi);
      if (wa && wb) {
        out.worldClock = {
          apartSeconds: Number(Math.abs(wa.lo - wb.lo).toFixed(3)), ticks: [wa.ticks, wb.ticks],
        };
      }
    }
    const { scores, worldClock } = out;
    const apart = worldClock && worldClock.apartSeconds > opts.worldClockSlack
      ? `the server's clock puts them ${span(worldClock.apartSeconds)} apart` : null;
    if (scores?.decides) {
      out.by = 'scores';
      if (scores.share < opts.minScoreShare) {
        out.credible = false;
        const said = scores.matched === 1 ? '1 lines up' : `${scores.matched} line up`;
        out.reason = `of the ${Math.min(...scores.held)} kills and scores both recorded, ${said}`
          + (apart ? `, and ${apart}` : '');
      }
    } else if (worldClock) {
      out.by = 'world clock';
      if (apart) {
        out.credible = false;
        out.reason = apart;
      }
    }
    files.push(out);
  }
  const refused = files.filter(f => !f.credible);
  return {
    credible: refused.length === 0,
    message: refused.length
      ? `These look like different rounds: ${refused.map(f => (sources.length > 2 ? `${f.file}: ${f.reason}` : f.reason)).join('; ')}.`
      : null,
    files,
    thresholds: { minScoreShare: opts.minScoreShare, minScoreEvents: opts.minScoreEvents, worldClockSlack: opts.worldClockSlack },
  };
}

/** The guard's findings as lines of text, for the command line and the
 *  page's console. */
export function formatGuard(guard) {
  const lines = ['Guard (are they one round?)'];
  const t = guard.thresholds;
  for (const f of guard.files) {
    const s = f.scores;
    const scores = s
      ? `kills and scores ${s.matched} matched of ${s.held[0]} and ${s.held[1]}`
        + (s.share === null ? '' : ` (${(s.share * 100).toFixed(1)}%${s.decides ? '' : `, too few to decide: ${t.minScoreEvents} needed`})`)
      : 'no stretch in common';
    const clock = f.worldClock ? `, world clocks ${f.worldClock.apartSeconds} s apart` : '';
    lines.push(`  ${f.file} -> ${f.against} (${f.method}): ${scores}${clock}; ${f.credible ? 'one round' : 'REFUSED'} by ${f.by}`);
  }
  lines.push(`  needs ${(t.minScoreShare * 100).toFixed(0)}% of the kills and scores to match where both hold ${t.minScoreEvents} or more,`
    + ` else world clocks within ${t.worldClockSlack} s`);
  return lines;
}
