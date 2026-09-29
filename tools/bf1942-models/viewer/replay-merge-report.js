// What a merge measured (replay-merge.js), for the first real pair to settle
// the merge's options: the clock fit and its residuals, what each file lacked,
// how far the files disagree about one object at one moment, how often each
// wrote it, the players' time in range before and after, and what was
// collapsed. Three.js-free and pure.

import {
  angle, count, covered, distance, maxOf, mean, median, plain, poseAt, quantile, SAMPLE_PERIOD, spanAt,
  spread, subtract,
} from './replay-merge-read.js';
import { clockBounds, joinClock, shared } from './replay-merge-clock.js';

/** The fit, its residuals over the matched events, and the checks the world
 *  clocks give, per file, while every time is still the file's own. */
export function alignmentReport(sources, fits, opts) {
  return sources.slice(1).map((src, k) => {
    const i = k + 1;
    const fit = fits[i];
    const ref = sources[fit.via];
    const pair = fit.pair;
    const toRef = t => pair.a + pair.b * t;
    const out = {
      file: src.file, against: ref.file, method: fit.method,
      offset: Number(fit.a.toFixed(4)), drift: fit.b === 1 ? 0 : Number((fit.b - 1).toExponential(3)),
      driftPpm: Number(((fit.b - 1) * 1e6).toFixed(1)), driftFit: fit.drift, matched: pair?.matched ?? 0,
    };
    if (pair?.used?.length) {
      const res = pair.used.map(p => p.ref.t - toRef(p.src.t));
      const abs = res.map(Math.abs);
      out.residualMs = {
        median: Number((median(abs) * 1000).toFixed(1)),
        p95: Number((quantile(abs, 0.95) * 1000).toFixed(1)),
        max: Number((maxOf(abs) * 1000).toFixed(1)),
        mean: Number((mean(res) * 1000).toFixed(2)),
      };
      out.rejected = pair.pairs.length - pair.used.length;
      out.byKind = plain(pair.used.reduce((m, p) => count(m, p.ref.r.e), new Map()));
      // What either file has that the other, recording then, lacks.
      const lo = Math.max(ref.joinT ?? 0, toRef(src.joinT ?? 0));
      const hi = Math.min(ref.endT ?? ref.lastT, toRef(src.endT ?? src.lastT));
      const pairedRef = new Set(pair.pairs.map(p => p.ref));
      const pairedSrc = new Set(pair.pairs.map(p => p.src));
      const missing = (list, paired, time) => plain(list
        .filter(ev => !paired.has(ev) && time(ev.t) >= lo && time(ev.t) <= hi)
        .reduce((m, ev) => count(m, ev.r.e), new Map()));
      out.unmatched = {
        [ref.file]: missing(shared(ref), pairedRef, t => t),
        [src.file]: missing(shared(src), pairedSrc, toRef),
      };
      out.overlap = [Number(lo.toFixed(3)), Number(hi.toFixed(3))];
    }
    // The world clocks, on the reference file's clock: both files' bounds
    // overlap if the fit is right, to within a frame or two of each timer
    // tick's own arrival (its bounds can cross by that much).
    const mine = clockBounds(src, toRef);
    const theirs = clockBounds(ref, t => t);
    if (mine && theirs) {
      const overlap = Math.min(mine.hi, theirs.hi) - Math.max(mine.lo, theirs.lo);
      out.worldClock = {
        [ref.file]: [Number(theirs.lo.toFixed(3)), Number(theirs.hi.toFixed(3))],
        [src.file]: [Number(mine.lo.toFixed(3)), Number(mine.hi.toFixed(3))],
        overlapMs: Number((overlap * 1000).toFixed(0)),
        agree: overlap > -opts.eventWindow / 5,
      };
    }
    const joinMine = joinClock(src, toRef);
    const joinTheirs = joinClock(ref, t => t);
    if (joinMine !== null && joinTheirs !== null) {
      out.joinClockMs = Number(((joinMine - joinTheirs) * 1000).toFixed(0));
    }
    if (fit.method === 'clock') out.note = 'aligned by the world clock alone, to within a second';
    return out;
  });
}

// --- the report --------------------------------------------------------------

export function finishReport(ctx) {
  const { report } = ctx;
  const children = ctx.childStats;
  report.duplicates = plain(ctx.dropped);
  report.written = plain(ctx.merged);
  report.children = {
    match: ctx.opts.childMatch, lives: children.lives, inSeveralFiles: children.shared,
    matched: children.matched, unmatched: children.unmatched,
    partOffsetM: spread(children.distances, 3),
    rankVsPosition: children.rankVsPosition,
  };
  report.selection = {
    seconds: Object.fromEntries([...ctx.selection].map(([k, v]) => [k, Number(v.toFixed(1))])),
    switches: plain(ctx.switches),
  };
  report.coverage = coverage(ctx);
  report.pose = poseAgreement(ctx);
  report.rates = sampleRates(ctx);
}

/** When object `id` was in range: in `src`'s file, or (no `src`) in the
 *  merged file. */
function rangeSpans(ctx, id, src = null) {
  if (src) return subtract(src.objects.get(id)?.spans ?? [], ctx.deadSpans(id));
  const out = [];
  for (const seg of ctx.segments.get(id) ?? []) {
    if (!seg.rep) continue;
    const last = out[out.length - 1];
    const to = Math.min(seg.to, ctx.endT);
    if (last && last[1] >= seg.from) last[1] = Math.max(last[1], to);
    else out.push([seg.from, to]);
  }
  return out;
}

/**
 * Each side's player-time in the world (in a soldier or a vehicle, the
 * spawn screen left out) that a file had in range, per file over its own
 * time, and merged over the whole and over each file's time, from the
 * merged players' records.
 */
function coverage(ctx) {
  const tmplOf = new Map();
  for (const src of ctx.sources) {
    for (const [id, o] of src.objects) if (o.opens.length && !tmplOf.has(id)) tmplOf.set(id, o.opens[0].r.tmpl ?? '');
    for (const ev of src.events) if (ev.r.e === 'createObject' && !tmplOf.has(ev.r.netId)) tmplOf.set(ev.r.netId, ev.r.tmpl ?? '');
  }
  const left = new Map();
  for (const src of ctx.sources) {
    for (const ev of src.events) {
      if (ev.r.e !== 'destroyPlayer') continue;
      if (!left.has(ev.r.pid)) left.set(ev.r.pid, []);
      left.get(ev.r.pid).push(ev.t);
    }
  }
  for (const times of left.values()) times.sort((a, b) => a - b);
  // Who was in the world when: [pid, team, root, from, to].
  const stretches = [];
  for (const [pid, list] of ctx.playersOut) {
    for (let i = 0; i < list.length; i++) {
      const [from, e] = list[i];
      const to = list[i + 1]?.[0] ?? ctx.endT;
      const root = e.length >= 4 && e[3] >= 0 ? e[3] : e[2];
      const team = e[1];
      if (root === null || root < 0 || (team !== 1 && team !== 2)) continue;
      if (/camera/i.test(tmplOf.get(root) ?? '')) continue;
      if (!tmplOf.has(root)) continue;
      // Until he leaves, and only while the object lives.
      const gone = (left.get(pid) ?? []).find(t => t > from) ?? Infinity;
      const alive = subtract([[from, Math.min(to, gone)]], ctx.deadSpans(root));
      for (const [a, b] of alive) if (b > a) stretches.push({ pid, team, root, from: a, to: b });
    }
  }
  const tally = (window, spansOf) => {
    const sides = { 1: { inWorld: 0, inRange: 0 }, 2: { inWorld: 0, inRange: 0 } };
    for (const s of stretches) {
      const a = Math.max(s.from, window[0]);
      const b = Math.min(s.to, window[1]);
      if (b <= a) continue;
      sides[s.team].inWorld += b - a;
      sides[s.team].inRange += covered(spansOf(s.root), a, b);
    }
    const out = {};
    for (const team of [1, 2]) {
      const { inWorld, inRange } = sides[team];
      out[team === 1 ? 'axis' : 'allies'] = {
        seconds: Number(inWorld.toFixed(1)), inRange: Number(inRange.toFixed(1)),
        share: inWorld > 0 ? Number((inRange / inWorld).toFixed(4)) : null,
      };
    }
    return out;
  };
  const merged = id => rangeSpans(ctx, id);
  return {
    files: ctx.sources.map(src => ({
      file: src.file, team: teamOf(ctx, src), window: src.live.map(t => Number(t.toFixed(1))),
      alone: tally(src.live, id => rangeSpans(ctx, id, src)),
      merged: tally(src.live, merged),
    })),
    merged: { window: [0, Number(ctx.endT.toFixed(1))], ...tally([0, ctx.endT], merged) },
  };
}

/** `src`'s recording player's side, by the merged players' records. */
function teamOf(ctx, src) {
  const list = ctx.playersOut.get(src.local) ?? [];
  return list.length ? list[list.length - 1][1][1] : null;
}

/**
 * How far two files disagree about one object at one moment: at each of
 * the first file's samples while both have it in range, its pose against
 * the other's there. A recording player's own soldier or hull is his
 * client's prediction in his own file, and counted apart. `lag` is the
 * shift of the second file's samples that brings moving objects closest.
 */
function poseAgreement(ctx) {
  const own = new Set();
  for (const src of ctx.sources) {
    for (const [, e] of src.players.get(src.local) ?? []) own.add(e.length >= 4 && e[3] >= 0 ? e[3] : e[2]);
  }
  const pos = { all: [], moving: [], own: [] };
  const rot = { all: [], moving: [], own: [] };
  const moving = [];
  let pairs = 0;
  for (const [i, a] of ctx.sources.entries()) {
    for (const b of ctx.sources.slice(i + 1)) {
      for (const [id, oa] of a.objects) {
        const ob = b.objects.get(id);
        if (!ob?.keys.length || !oa.keys.length) continue;
        const sa = rangeSpans(ctx, id, a);
        const sb = rangeSpans(ctx, id, b);
        for (let k = 1; k < oa.keys.length; k++) {
          const key = oa.keys[k];
          const t = key[0];
          if (!spanAt(sa, t) || !spanAt(sb, t) || !spanAt(sb, t - 0.35) || !spanAt(sb, t + 0.35)) continue;
          const other = poseAt(ob.keys, t);
          if (!other) continue;
          pairs += 1;
          const dp = distance(key, other);
          const dq = angle(key, other);
          const prev = oa.keys[k - 1];
          const speed = t - prev[0] > 0 ? distance(key, prev) / Math.max(t - prev[0], SAMPLE_PERIOD) : 0;
          const bucket = own.has(id) ? 'own' : speed > 1 ? 'moving' : null;
          pos.all.push(dp);
          rot.all.push(dq);
          if (bucket) {
            pos[bucket].push(dp);
            rot[bucket].push(dq);
          }
          if (bucket === 'moving' && moving.length < 40000) moving.push({ key, keys: ob.keys });
        }
      }
    }
  }
  // The lag: the shift of the other file's samples, within 0.3 s, that
  // brings moving objects closest at the median.
  let lag = null;
  if (moving.length >= 20) {
    const step = Math.max(1, Math.floor(moving.length / 4000));
    const sample = moving.filter((_, i) => i % step === 0);
    let best = null;
    for (let d = -0.3; d <= 0.3001; d += 0.01) {
      const m = median(sample.map(({ key, keys }) => {
        const p = poseAt(keys, key[0] + d);
        return p ? distance(key, p) : Infinity;
      }));
      if (!best || m < best.m) best = { d, m };
    }
    lag = { seconds: Number(best.d.toFixed(2)), medianM: Number(best.m.toFixed(3)), samples: sample.length };
  }
  const both = (p, r) => ({ positionM: spread(p, 3), rotationDeg: spread(r, 2) });
  return {
    pairs, all: both(pos.all, rot.all), moving: both(pos.moving, rot.moving),
    recordingPlayers: both(pos.own, rot.own), lag,
  };
}

/**
 * How often each file wrote a moving object both had in range, by how far
 * it was from that file's own player: the server sends by priority, which
 * falls with distance, and a teammate across the map at a flat 0.03
 * (round-replay-capture §19).
 */
function sampleRates(ctx) {
  const BINS = [[0, 100], [100, 250], [250, 420], [420, Infinity]];
  return ctx.sources.map(src => {
    const sampleTimes = new Set();
    for (const o of src.objects.values()) for (const k of o.keys) sampleTimes.add(Math.round(k[0] * 1000));
    const live = src.window[1] - src.window[0];
    const bins = BINS.map(() => ({ seconds: 0, samples: 0 }));
    for (const [id, o] of src.objects) {
      const mine = rangeSpans(ctx, id, src);
      const others = ctx.sources.filter(s => s !== src && s.objects.get(id)?.keys.length).map(s => rangeSpans(ctx, id, s));
      if (!others.length || o.keys.length < 2) continue;
      for (let k = 1; k < o.keys.length; k++) {
        const [t] = o.keys[k];
        const prev = o.keys[k - 1];
        if (t - prev[0] > 1 || !spanAt(mine, t) || !others.some(s => spanAt(s, t))) continue;
        const d = ctx.distanceIn(src, id, t);
        const bin = BINS.findIndex(([lo, hi]) => d >= lo && d < hi);
        if (bin < 0) continue;
        bins[bin].samples += 1;
        bins[bin].seconds += t - prev[0];
      }
    }
    return {
      file: src.file,
      sampleHz: live > 0 ? Number((sampleTimes.size / live).toFixed(2)) : null,
      movingHzByDistance: BINS.map(([lo, hi], i) => ({
        metres: hi === Infinity ? `${lo}+` : `${lo}-${hi}`,
        hz: bins[i].seconds > 0 ? Number((bins[i].samples / bins[i].seconds).toFixed(2)) : null,
        samples: bins[i].samples,
      })),
    };
  });
}


// --- the report, as text --------------------------------------------------------

/** The report as lines of text: what `merge_replays.mjs` prints. */
export function formatMergeReport(report) {
  const lines = [];
  const pct = v => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`);
  const kinds = obj => Object.entries(obj ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  lines.push('Merged recordings');
  for (const [i, s] of (report.sources ?? []).entries()) {
    lines.push(`  ${i + 1}. ${s.file}  v${s.version}  ${s.start || 'no start'}  ${s.midRound ? 'begun mid-round' : 'begun at the join'}`
      + `  player ${s.local ?? '?'} (${s.localFrom})  merged ${s.window[0]}..${s.window[1]} s`);
  }
  if (report.merged) lines.push(`  merged: ${report.merged.duration} s, ${report.merged.lines} lines`);
  for (const w of report.warnings ?? []) lines.push(`  warning: ${w}`);
  lines.push('', 'Alignment (each file onto the one it was fitted against)');
  for (const a of report.alignment ?? []) {
    lines.push(`  ${a.file} -> ${a.against}: ${a.method}, offset ${a.offset} s, drift ${a.driftPpm} ppm (${a.driftFit}),`
      + ` ${a.matched} events matched${a.rejected ? `, ${a.rejected} rejected` : ''}`);
    if (a.residualMs) {
      lines.push(`    residual |r|: median ${a.residualMs.median} ms, p95 ${a.residualMs.p95} ms, max ${a.residualMs.max} ms, mean r ${a.residualMs.mean} ms`);
    }
    if (a.worldClock) {
      const { overlapMs } = a.worldClock;
      const how = overlapMs >= 0 ? `their bounds overlap by ${overlapMs} ms` : `their bounds miss by ${-overlapMs} ms`;
      lines.push(`    world clock (0x29): ${a.worldClock.agree ? 'agrees' : 'DISAGREES'}, ${how}`);
    }
    if (a.joinClockMs !== undefined) lines.push(`    world clock at the joins (0x04): ${a.joinClockMs} ms apart`);
    if (a.unmatched) {
      for (const [file, byKind] of Object.entries(a.unmatched)) lines.push(`    unmatched in ${file}: ${kinds(byKind)}`);
    }
    if (a.note) lines.push(`    ${a.note}`);
  }
  if (report.events) {
    lines.push('', 'Events a file lacked while it was recording');
    for (const m of report.events.missing) lines.push(`  ${m.file}: ${kinds(m.byKind)}`);
  }
  if (report.pose) {
    const p = report.pose;
    const line = (name, x) => `  ${name}: position median ${x.positionM.median ?? '-'} m, p95 ${x.positionM.p95 ?? '-'} m;`
      + ` rotation median ${x.rotationDeg.median ?? '-'} deg, p95 ${x.rotationDeg.p95 ?? '-'} deg (${x.positionM.n})`;
    lines.push('', `Pose disagreement where two files had an object at once (${p.pairs} samples)`);
    lines.push(line('all', p.all), line('moving', p.moving), line('recording players\' own', p.recordingPlayers));
    if (p.lag) lines.push(`  state lag of the later file: ${p.lag.seconds} s (median ${p.lag.medianM} m there)`);
  }
  if (report.rates) {
    lines.push('', 'Sample rates');
    for (const r of report.rates) {
      lines.push(`  ${r.file}: ${r.sampleHz} Hz of samples; moving objects both had, by distance from its player: `
        + r.movingHzByDistance.map(b => `${b.metres} m ${b.hz ?? '-'} Hz`).join(', '));
    }
  }
  if (report.coverage) {
    lines.push('', 'Player-time in range (spawn screen left out)');
    for (const f of report.coverage.files) {
      lines.push(`  ${f.file} (${f.team === 1 ? 'Axis' : f.team === 2 ? 'Allies' : '?'} player), ${f.window[0]}..${f.window[1]} s:`
        + ` alone Axis ${pct(f.alone.axis.share)}, Allies ${pct(f.alone.allies.share)};`
        + ` merged Axis ${pct(f.merged.axis.share)}, Allies ${pct(f.merged.allies.share)}`);
    }
    const m = report.coverage.merged;
    lines.push(`  merged over ${m.window[0]}..${m.window[1]} s: Axis ${pct(m.axis.share)}, Allies ${pct(m.allies.share)}`);
  }
  if (report.children) {
    const c = report.children;
    lines.push('', `Parts and engines (${c.match}): ${c.lives} lives, ${c.inSeveralFiles} in several files,`
      + ` ${c.matched} matched, ${c.unmatched} unmatched, part offset median ${c.partOffsetM.median ?? '-'} m`
      + ` p95 ${c.partOffsetM.p95 ?? '-'} m, rank and position disagree on ${c.rankVsPosition}`);
  }
  if (report.anim) {
    lines.push(`Animation tables: ${report.anim.tables.map(x => `${x.file} ${x.identical ? 'identical' : 'renumbered'}`).join(', ')}`);
  }
  if (report.selection) {
    lines.push(`Object file chosen by: ${kinds(report.selection.seconds)} (seconds); switches: ${kinds(report.selection.switches)}`);
  }
  lines.push('', `Collapsed or left out: ${kinds(report.duplicates)}`);
  return lines.join('\n');
}
