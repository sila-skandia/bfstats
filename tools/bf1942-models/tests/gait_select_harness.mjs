// Drives `viewer/gait-select.js` outside a browser and prints one JSON blob.
// `test_gait_select.py` copies this file and the module (plus `soldier.js`
// and `physics.js`, which it imports) into a temporary directory and asserts
// on the output -- same trick as `soldier_harness.mjs`/`test_soldier.py`.
//
// argv[2] is the path to `tests/fixtures/`, read directly from its real
// location rather than copied alongside the modules: the fixtures are two
// full recordings (round-replay-capture README sec 11.8) and there is no
// reason to duplicate 60+ KB of NDJSON into a throwaway temp dir just to
// import three small ES modules from it.
//
// The NDJSON reader below is deliberately minimal and re-implemented rather
// than imported from `replay.js`: `replay.js` pulls in `three`, which is not
// resolvable under a plain `node` run (checked directly: `node -e
// "import('three')"` fails outside a bundler), and this harness only needs
// two record kinds (`o` for the template name, `s` for samples) to build the
// `{ keys, soldier }` shape `selectGait` actually consumes -- it is not a
// second implementation of `parseRecording`, just enough of the documented
// format (round-replay-capture README sec 9) to get real `life.keys` out of
// a real file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectGait, rawSegments, THRESHOLDS } from '../viewer/gait-select.js';
import { GAIT_SPEED, STRAFE_SPEED, DIRECTIONAL_SPEED, WALK_SPEED_FACTOR } from '../viewer/soldier.js';

function loadLives(path) {
  const text = readFileSync(path, 'utf8');
  const lives = new Map();
  const lifeFor = nid => {
    let life = lives.get(nid);
    if (!life) { life = { nid, tmpl: '', keys: [] }; lives.set(nid, life); }
    return life;
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.k === 'o') {
      const life = lifeFor(r.id);
      if (r.tmpl) life.tmpl = r.tmpl;
    } else if (r.k === 's') {
      for (const o of r.o) {
        lifeFor(o[0]).keys.push({ t: r.t, p: [o[1], o[2], o[3]], q: [o[4], o[5], o[6], o[7]] });
      }
    }
  }
  for (const life of lives.values()) life.soldier = /soldier/i.test(life.tmpl);
  return [...lives.values()];
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarizeSpeeds(segs) {
  const vals = segs.filter(s => s.end > s.start && Number.isFinite(s.start) && Number.isFinite(s.end))
    .map(s => s.speed).filter(v => v > 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  return {
    n: vals.length,
    min: vals[0], p25: percentile(vals, 0.25), median: percentile(vals, 0.5),
    p75: percentile(vals, 0.75), p90: percentile(vals, 0.9), max: vals.at(-1),
  };
}

// Merge consecutive same-gait readings (sampled at each raw segment's
// midpoint, since a debounced gait can only change at a raw segment
// boundary) into runs, to check dwell time end to end through the public
// API alone -- no reach into the module's internal timeline.
function gaitRuns(life, segs) {
  const runs = [];
  for (const seg of segs) {
    if (!(seg.end > seg.start)) continue;
    const mid = Number.isFinite(seg.start) && Number.isFinite(seg.end) ? (seg.start + seg.end) / 2
      : Number.isFinite(seg.start) ? seg.start + 1 : seg.end - 1;
    const { gait } = selectGait(life, mid);
    const last = runs.at(-1);
    if (last && last.gait === gait) last.end = seg.end;
    else runs.push({ gait, start: seg.start, end: seg.end });
  }
  return runs;
}

function analyzeRecording(path) {
  const lives = loadLives(path);
  const soldier = lives.find(l => l.soldier);
  const segs = rawSegments(soldier);
  const runs = gaitRuns(soldier, segs);
  // Dwell durations for every run except the first/last, which are
  // unbounded ([-Infinity, ...) and [..., +Infinity)) and so cannot chatter.
  const bounded = runs.slice(1, -1);
  const minRunDuration = bounded.length ? Math.min(...bounded.map(r => r.end - r.start)) : null;
  const sampleAt = t => ({ t, ...selectGait(soldier, t) });
  return {
    soldierNid: soldier.nid,
    soldierTmpl: soldier.tmpl,
    keyCount: soldier.keys.length,
    span: [soldier.keys[0].t, soldier.keys.at(-1).t],
    rawSpeedStats: summarizeSpeeds(segs),
    runs: runs.map(r => ({ gait: r.gait, start: r.start, end: r.end, duration: r.end - r.start })),
    minBoundedRunDuration: minRunDuration,
    farBeforeFirst: sampleAt(soldier.keys[0].t - 1000),
    longAfterLast: sampleAt(soldier.keys.at(-1).t + 1000),
  };
}

function makeSyntheticLife(points, q = [0, 0, 0, 1]) {
  // points: [[t, x, z], ...]. y left at 0 -- horizontal-only, per the module.
  return { tmpl: 'USSoldier', soldier: true, keys: points.map(([t, x, z]) => ({ t, p: [x, 0, z], q })) };
}

function synthetic() {
  const IDENTITY = [0, 0, 0, 1]; // faces +Z, per forwardXZ's convention

  // Exactly the engine's own run speed, forward, for 2s: 0.6 m per 0.1s tick.
  const runLife = makeSyntheticLife(
    Array.from({ length: 21 }, (_, i) => [i * 0.1, 0, i * 0.6]), IDENTITY);
  // Exactly the engine's own walk speed, forward: 0.2 m per 0.1s tick.
  const walkLife = makeSyntheticLife(
    Array.from({ length: 21 }, (_, i) => [i * 0.1, 0, i * 0.2]), IDENTITY);
  // Standing strafe top speed (4 m/s) moving along +X -- perpendicular to the
  // identity quaternion's +Z facing, so dot should read ~0.
  const strafeLife = makeSyntheticLife(
    Array.from({ length: 21 }, (_, i) => [i * 0.1, i * 0.4, 0]), IDENTITY);
  // Never moves.
  const idleLife = makeSyntheticLife([[0, 0, 0], [1, 0, 0], [5, 0, 0], [10, 0, 0]], IDENTITY);
  // A long idle hold, one single-tick run-speed blip (0.1s, under
  // MIN_DWELL_S), then a long hold at the new position -- the noise case
  // point 4 asks to demonstrate does not chatter. (Snapping back to the
  // original position in a second single tick, rather than holding, would
  // make a second raw 'run' reading -- moving backward, but still fast
  // enough to classify 'run' under the lateral table -- immediately after
  // the first, and two consecutive one-tick 'run' readings legitimately
  // total the full MIN_DWELL_S and so *should* confirm; that is not this
  // test.)
  const blipLife = makeSyntheticLife([
    [0, 0, 0], [5, 0, 0],
    [5.1, 0, 0.62], // one tick at 6.2 m/s
    [10, 0, 0.62], // long hold at the new position, not a second reading
  ], IDENTITY);
  // A vehicle-exit-shaped discontinuity, isolated: a long hold, then 40 m in
  // one 0.1s window (400 m/s) -- the exact shape found for real in
  // replay_20260915-210619.ndjson (see gait-select.js's TELEPORT_SPEED
  // comment), reproduced synthetically so the assertion does not depend on
  // that fixture's exact timings surviving future edits.
  const teleportLife = makeSyntheticLife([
    [0, 0, 0], [22, 0, 0], [22.1, 0, 40],
  ], IDENTITY);

  const sample = (life, ts) => ts.map(t => ({ t, ...selectGait(life, t) }));

  return {
    run: sample(runLife, [1.0]),
    walk: sample(walkLife, [1.0]),
    strafe: sample(strafeLife, [1.0]),
    idle: sample(idleLife, [2.5]),
    beforeFirst: sample(runLife, [-5]),
    afterLast: sample(runLife, [1000]),
    blip: sample(blipLife, [0.5, 4.95, 5.05, 5.15, 7, 15]),
    teleport: sample(teleportLife, [22.05]),
  };
}

const fixturesDir = process.argv[2];
const recordings = {
  'replay_20260915-213110.ndjson': analyzeRecording(join(fixturesDir, 'replay_20260915-213110.ndjson')),
  'replay_20260915-210619.ndjson': analyzeRecording(join(fixturesDir, 'replay_20260915-210619.ndjson')),
};

// Specific instants cross-checked by hand against the raw NDJSON before this
// harness existed (see the exploration notes in the session that wrote this
// module) -- forward, strafe and backward each measured at the same ~4 m/s
// "lateral" speed in real data, which is the finding that motivated the
// heading-aware threshold at all.
const file213110 = join(fixturesDir, 'replay_20260915-213110.ndjson');
const file210619 = join(fixturesDir, 'replay_20260915-210619.ndjson');
const soldier213110 = loadLives(file213110).find(l => l.soldier);
const soldier210619 = loadLives(file210619).find(l => l.soldier);

const namedInstants = {
  forward_213110_t28_5: { t: 28.5, ...selectGait(soldier213110, 28.5) },
  strafe_213110_t46_3: { t: 46.3, ...selectGait(soldier213110, 46.3) },
  forward_210619_t14_45: { t: 14.45, ...selectGait(soldier210619, 14.45) },
  strafe_210619_t19_0: { t: 19.0, ...selectGait(soldier210619, 19.0) },
  backward_210619_t109_85: { t: 109.85, ...selectGait(soldier210619, 109.85) },
  // The vehicle-exit teleport itself (TELEPORT_SPEED's comment): 40 m inside
  // one 0.1 s window, landing at t=103.47.
  teleport_210619_t103_42: { t: 103.42, ...selectGait(soldier210619, 103.42) },
};

console.log(JSON.stringify({
  constants: {
    ...THRESHOLDS,
    forwardRun: GAIT_SPEED.run,
    forwardWalk: GAIT_SPEED.walk,
    lateralRun: STRAFE_SPEED[0],
    lateralWalk: STRAFE_SPEED[0] * WALK_SPEED_FACTOR,
    directionalSpeed1: DIRECTIONAL_SPEED[1],
    strafeSpeed0: STRAFE_SPEED[0],
  },
  recordings,
  namedInstants,
  synthetic: synthetic(),
}));
