// One clock for several recordings of a round (replay-merge.js). Each file's
// `t` is its own recorder's clock; reliable events reach every client in one
// order, so each file's shared events are matched to another's on what they
// say and its clock is fitted onto that file's, an offset and a drift. The
// server's world clock (0x29, 0x04) checks the fit. Three.js-free and pure.

import { count, mean, median } from './replay-merge-read.js';

// --- the clocks -----------------------------------------------------------------

/** Longest chain of `pairs` (sorted by the first file's order) that is also
 *  in the second file's order: reliable events arrive in one order on every
 *  client, so a pair that crosses the others is two different events. */
function inOrder(pairs) {
  const tails = [];
  const prev = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    const n = pairs[i].src.n;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]].src.n < n) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(pairs[i]);
  return out.reverse();
}

export const byKey = events => {
  const out = new Map();
  for (const ev of events) {
    if (!out.has(ev.key)) out.set(ev.key, []);
    out.get(ev.key).push(ev);
  }
  return out;
};

/** The events a file shares with every other client: named, not its join's. */
export const shared = src => src.events.filter(ev => ev.cls === 'match' && !ev.head && ev.key);

/** The offset between two files' clocks most of their rare shared events
 *  agree on: every pair of copies of a key either file has only a few of
 *  proposes one, and the busiest bin wins. */
function voteOffset(refBy, srcBy, opts) {
  const votes = [];
  for (const [key, a] of refBy) {
    const b = srcBy.get(key);
    if (!b || a.length > opts.rareKey || b.length > opts.rareKey) continue;
    for (const x of a) for (const y of b) votes.push(x.t - y.t);
  }
  if (!votes.length) return null;
  const bins = new Map();
  for (const v of votes) count(bins, Math.round(v / opts.voteBin));
  let best = null;
  let bestCount = -1;
  for (const bin of bins.keys()) {
    const c = (bins.get(bin - 1) ?? 0) + bins.get(bin) + (bins.get(bin + 1) ?? 0);
    if (c > bestCount || (c === bestCount && Math.abs(bin) < Math.abs(best))) {
      best = bin;
      bestCount = c;
    }
  }
  const centre = best * opts.voteBin;
  const near = votes.filter(v => Math.abs(v - centre) <= 1.5 * opts.voteBin);
  return { offset: median(near), votes: votes.length, support: near.length };
}

/** The pairs of copies of one event, per key in order, within `window` of
 *  each other once `map` has put the second file's times on the first's. */
function pairUp(refBy, srcBy, map, window) {
  const pairs = [];
  for (const [key, b] of srcBy) {
    const a = refBy.get(key);
    if (!a) continue;
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const d = a[i].t - map(b[j].t);
      if (Math.abs(d) <= window) {
        pairs.push({ ref: a[i], src: b[j], key });
        i += 1;
        j += 1;
      } else if (d < 0) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  pairs.sort((p, q) => p.ref.n - q.ref.n);
  return inOrder(pairs);
}

/** `tRef = a + b tSrc` over `pairs`, outliers rejected: least squares where
 *  the pairs span long enough to see a drift, an offset alone otherwise. */
function fitClock(pairs, opts) {
  let use = pairs;
  let fit = null;
  for (let pass = 0; pass < 4 && use.length; pass++) {
    const xs = use.map(p => p.src.t);
    const ys = use.map(p => p.ref.t);
    const span = Math.max(...xs) - Math.min(...xs);
    let a;
    let b = 1;
    let drift = 'fitted';
    if (span >= opts.minDriftSpan && use.length >= 3) {
      const mx = mean(xs);
      const my = mean(ys);
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < xs.length; i++) {
        sxx += (xs[i] - mx) ** 2;
        sxy += (xs[i] - mx) * (ys[i] - my);
      }
      b = sxx > 0 ? sxy / sxx : 1;
      a = my - b * mx;
      if (Math.abs(b - 1) > opts.maxDrift) {
        b = 1;
        drift = 'refused';
      }
    } else {
      drift = 'too short';
    }
    if (b === 1) a = mean(ys.map((y, i) => y - xs[i]));
    fit = { a, b, drift };
    const res = use.map(p => p.ref.t - (a + b * p.src.t));
    const mid = median(res);
    const mad = median(res.map(r => Math.abs(r - mid))) * 1.4826;
    const limit = Math.max(opts.outlierFloor, 4 * mad);
    const kept = use.filter((p, i) => Math.abs(res[i] - mid) <= limit);
    if (kept.length === use.length) break;
    use = kept;
  }
  return { ...fit, used: use };
}

/**
 * Where the 10-second timer (0x29) puts a file against the server's world
 * time, on the clock `map` gives it: each tick is the world time truncated
 * to the second, so `world - t` lies in `[v - t, v - t + 1)`, and as the
 * tick's phase creeps round the second (the server sends it every 10 s and a
 * tick) the bounds close in. In replay_20260928-133433 they close to 39 ms.
 * A round restart (the world time reset at PREGAME) starts a new run; the
 * longest run is read.
 */
export function clockBounds(src, map, from = -Infinity, to = Infinity) {
  const ticks = src.events
    .filter(ev => ev.r.e === 'clock' && !ev.head && (src.joinT === null || ev.t > src.joinT + 1))
    .map(ev => ({ t: map(ev.t), v: ev.r.worldTime }))
    .filter(c => c.t >= from && c.t <= to && Number.isFinite(c.v));
  if (!ticks.length) return null;
  const runs = [[ticks[0]]];
  for (let i = 1; i < ticks.length; i++) {
    const before = ticks[i - 1];
    const jump = (ticks[i].v - ticks[i].t) - (before.v - before.t);
    if (Math.abs(jump) > 2) runs.push([]);
    runs[runs.length - 1].push(ticks[i]);
  }
  const run = runs.sort((a, b) => b.length - a.length)[0];
  const lo = Math.max(...run.map(c => c.v - c.t));
  const hi = Math.min(...run.map(c => c.v - c.t)) + 1;
  return { lo, hi, ticks: run.length };
}

/** The exact world time at a file's own join (0x04), on `map`'s clock:
 *  `world - t`. Late by however long the client took over the join. */
export function joinClock(src, map) {
  const ev = src.events.find(e => e.r.e === 'simStart' && Number.isFinite(e.r.worldTime));
  return ev ? ev.r.worldTime - map(ev.t) : null;
}

/** One file's clock fitted onto another's by their shared events. */
function alignPair(ref, src, opts) {
  const refBy = byKey(shared(ref));
  const srcBy = byKey(shared(src));
  const vote = voteOffset(refBy, srcBy, opts);
  if (!vote) return { matched: 0, pairs: [], vote: null };
  let map = t => t + vote.offset;
  let pairs = pairUp(refBy, srcBy, map, Math.max(opts.eventWindow, 3 * opts.voteBin));
  let fit = pairs.length ? fitClock(pairs, opts) : null;
  if (fit) {
    map = t => fit.a + fit.b * t;
    pairs = pairUp(refBy, srcBy, map, opts.eventWindow);
    if (pairs.length) fit = fitClock(pairs, opts);
  }
  if (!fit) return { matched: 0, pairs: [], vote };
  return { a: fit.a, b: fit.b, drift: fit.drift, matched: fit.used.length, pairs, used: fit.used, vote };
}

/** Every file's clock onto the first's: each against the first, or against
 *  another already fitted when that one shares more of its round, or by the
 *  world clocks alone when no file shares enough events with it. */
export function alignAll(sources, opts) {
  const fits = [{ a: 0, b: 1, drift: 'reference', matched: null, method: 'reference', via: 0 }];
  const done = [0];
  const pending = sources.slice(1).map(s => s.index);
  const direct = new Map();
  while (pending.length) {
    let best = null;
    for (const i of pending) {
      for (const j of done) {
        const key = `${j}|${i}`;
        if (!direct.has(key)) direct.set(key, alignPair(sources[j], sources[i], opts));
        const pair = direct.get(key);
        if (!best || pair.matched > best.pair.matched) best = { i, j, pair };
      }
    }
    const { i, j, pair } = best;
    const via = fits[j];
    if (pair.matched >= opts.minMatches) {
      fits[i] = {
        a: via.a + via.b * pair.a, b: via.b * pair.b, drift: pair.drift, matched: pair.matched,
        method: 'events', via: j, pair,
      };
    } else {
      // No file shares enough of this one's events: the world clocks, if
      // both have them, to the second their ticks allow.
      const mine = clockBounds(sources[i], t => t);
      const theirs = clockBounds(sources[j], t => via.a + via.b * t);
      if (!mine || !theirs) {
        throw new Error(`${sources[i].file} shares only ${pair.matched} events with the other recordings `
          + `(${opts.minMatches} needed) and has no world clock to align by. Are they one round?`);
      }
      const offset = (theirs.lo + theirs.hi) / 2 - (mine.lo + mine.hi) / 2;
      fits[i] = { a: offset, b: 1, drift: 'clock only', matched: pair.matched, method: 'clock', via: j, pair };
    }
    done.push(i);
    pending.splice(pending.indexOf(i), 1);
  }
  return fits;
}

// --- one clock ---------------------------------------------------------------------

/** Every time in `src` moved onto the merged clock by `map` (and continuous
 *  records by `shift` more). */
export function retime(src, map, shift) {
  const state = t => map(t) + shift;
  for (const ev of src.events) ev.t = map(ev.t);
  for (const c of src.chat) c.t = map(c.t);
  for (const f of src.fires) f.t = state(f.t);
  for (const c of src.cps) c.t = map(c.t);
  for (const c of src.tickets) c.t = map(c.t);
  for (const c of src.other) c.t = map(c.t);
  if (src.animT !== null) src.animT = map(src.animT);
  if (src.roster) src.roster.t = map(src.roster.t);
  if (src.joinT !== null) src.joinT = map(src.joinT);
  for (const list of src.players.values()) for (const e of list) e[0] = map(e[0]);
  // What the file still had in range when it ended, it had until then.
  const end = state(src.endT ?? src.lastT);
  for (const o of src.objects.values()) {
    for (const span of o.spans) {
      span[0] = state(span[0]);
      span[1] = span[1] === Infinity ? end : state(span[1]);
    }
    for (const open of o.opens) open.t = state(open.t);
    for (const k of o.keys) k[0] = state(k[0]);
    for (const k of o.hp) k[0] = state(k[0]);
    for (const k of o.st) k[0] = state(k[0]);
  }
  for (const list of src.children.values()) {
    for (const c of list) {
      c.first = state(c.first);
      for (const k of c.keys) k[0] = state(k[0]);
    }
  }
  src.window = [map(0), map(src.endT ?? src.lastT)];
  // What the file saw live: from its join's end, or its first record.
  src.live = [src.joinT ?? src.window[0], src.window[1]];
  // From its first sample it keeps the players, the flags and the tickets:
  // a client still loading its level has none of them.
  src.sampling = [src.firstSample === null ? src.window[1] : Math.max(map(src.firstSample), src.live[0]), src.window[1]];
}

