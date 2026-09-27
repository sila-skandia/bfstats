// Where a replayed hull's guns pointed, for a recording whose moving parts
// cannot be put on their nodes: a v3 file has none, and a v4 file keyed every
// part 0 (features/round-replay-capture/README.md §16). A v5 file's parts are
// put on their nodes as recorded (replay-hulls.js `applyJoints`) and win over
// everything here.
//
// Two sources, both the recording's own:
//
// - Every round a v4 or later file records (`f`) left along its gun's line of
//   fire: the FireArms' own axis, or its seat camera's for a
//   `fireInCameraDof` gun (camera-dof.js). Its direction, taken into the
//   hull's frame at that instant (`shotInHull`), is where that gun pointed
//   when it fired. Between two rounds a gun holds the first aim and turns to
//   the next as late as it can at its own traverse speed (`lateTurn`).
// - A v4 file's part records, decoded per hull (`decodeKeyedParts`). A part
//   left out of a record was equal to the entry written before it, so the
//   recorder's order and its rule put each entry back on its part. A decoded
//   part aims a gun only where it carries that gun's own rounds
//   (`matchPart`), and then it aims it every tenth of a second, between the
//   rounds as well as at them.
//
// A v3 file's trigger presses carry the controlled object's own axis -- a
// Defgun's hull, not its barrel -- so they aim nothing.
//
// Frames: directions out are the VIEWER's, in the hull's own frame (forward
// -Z); the recording's are BF1942's (z negated, quaternions (-x, -y, z, w);
// replay-actors.js). Three-free, so `tests/replay_harness.mjs` runs it in node.

import { poseAt, rotate } from './replay-kinematics.js';

/** A decoded part carries a gun when its axis lies within this many degrees
 *  of the gun's rounds at the median; of several, the nearest (a turret's
 *  own traverse part lies as far off as the gun's elevation). In the first
 *  v4 round every gun on an aim rig that fired matched its part to 0.34 or
 *  better. */
export const AIM_MATCH = 2;

/** Seconds between two samples of a part: the recording's own period
 *  (replay-recording.js). A longer gap is a part that held still. */
const SAMPLE_PERIOD = 0.1;

function normalise(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-9 ? [v[0] / n, v[1] / n, v[2] / n] : null;
}

function angleBetween(a, b) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

// --- a v4 file's parts ----------------------------------------------------------

/** How far a part turned to `q` from `prev` (1 - |cos| of half the angle; 0
 *  unmoved): nothing when there was no `prev`, the most when `q` itself is
 *  unknown (a run's head left out before anything was written). */
function turnCost(q, prev) {
  if (!q) return 1;
  if (!prev) return 0;
  const dot = q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3];
  return 1 - Math.min(1, Math.abs(dot));
}

/**
 * One run's entries put back on the hull's `last.length` parts: which `k` of
 * the `n` parts were written. Every choice keeps the recorder's rule (a part
 * left out equals the entry before it); the one taken turns the parts least
 * since `last`, since a gun turns a few degrees a tenth of a second and does
 * not trade values with its neighbour. A walk over (part, entries placed).
 */
function placeRun({ parts, before }, last) {
  const n = last.length;
  const k = parts.length;
  const cost = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  const wrote = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(false));
  cost[0][0] = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= k; j++) {
      const c = cost[i][j];
      if (c === Infinity) continue;
      // Part i left out: it is the entry before it.
      const held = c + turnCost(j > 0 ? parts[j - 1] : before, last[i]);
      if (held < cost[i + 1][j]) {
        cost[i + 1][j] = held;
        wrote[i + 1][j] = false;
      }
      // Part i written: it is the next entry.
      if (j < k) {
        const written = c + turnCost(parts[j], last[i]);
        if (written < cost[i + 1][j + 1]) {
          cost[i + 1][j + 1] = written;
          wrote[i + 1][j + 1] = true;
        }
      }
    }
  }
  const out = new Array(n).fill(null);
  for (let i = n, j = k; i > 0; i--) {
    if (wrote[i][j]) {
      out[i - 1] = parts[j - 1];
      j -= 1;
    } else {
      out[i - 1] = j > 0 ? parts[j - 1] : before;
    }
  }
  return out;
}

/**
 * A v4 file's part records for one hull life, turned back into its parts.
 *
 * The v4 recorder keyed every part 0 (a child object's networkable has no
 * id) and wrote a part only when its rotation differed, by more than 0.002 in
 * any component, from the last part it had written, whichever hull's that
 * was (bf42plus 4fc0352 `sampleParts`). Its walk is the object manager's
 * registry in registration order, so each sample lists a hull's parts
 * together and in the same order (`keyedParts`, replay-recording.js), and a
 * part left out equals the entry before it in the run, or for the run's
 * head the entry before the run (`before`). The hull has as many parts as
 * its longest run.
 *
 * `runs`: `[{ t, parts: [[qx, qy, qz, qw], ...], before }]` in time order,
 * each quaternion the part's rotation relative to the hull (BF1942's).
 * Returns one track per part, `[{ t, q }]`.
 */
export function decodeKeyedParts(runs) {
  const n = runs.reduce((most, run) => Math.max(most, run.parts.length), 0);
  const tracks = Array.from({ length: n }, () => []);
  const last = new Array(n).fill(null);
  for (const run of runs) {
    placeRun(run, last).forEach((q, i) => {
      if (!q) return;
      last[i] = q;
      tracks[i].push({ t: run.t, q });
    });
  }
  return tracks;
}

/** A part's axis in the hull's frame (viewer axes): its forward (BF1942's
 *  +Z) for `sense` 1, its back for -1 (a mount authored facing aft of the
 *  gun it carries, as a Sherman's cupola Browning is). */
export function partForward(q, sense = 1) {
  const v = rotate(q, [0, 0, sense]);
  return [v[0], v[1], -v[2]];
}

/** A decoded part's track as directions in the hull's frame. */
export function partAim(track, sense = 1) {
  return track.map(({ t, q }) => ({ t, dir: partForward(q, sense) }));
}

// --- rounds ---------------------------------------------------------------------

/**
 * A recorded round in its hull's frame at the instant it was fired (viewer
 * axes): `{ t, weapon, dir, pos }`, `pos` where it left, relative to the
 * hull. Null without a direction or a hull pose.
 */
export function shotInHull(life, shot) {
  if (!Array.isArray(shot?.dir)) return null;
  const pose = poseAt(life, shot.t);
  if (!pose) return null;
  const inverse = [-pose.q[0], -pose.q[1], -pose.q[2], pose.q[3]];
  const dir = normalise(rotate(inverse, [shot.dir[0], shot.dir[1], -shot.dir[2]]));
  if (!dir) return null;
  const pos = Array.isArray(shot.pos)
    ? rotate(inverse, [shot.pos[0] - pose.p[0], shot.pos[1] - pose.p[1], -shot.pos[2] - pose.p[2]])
    : null;
  return { t: shot.t, weapon: shot.weapon ?? '', dir, pos };
}

/**
 * Which decoded part carries a gun, from the gun's own rounds (`shots`, from
 * `shotInHull`): the part and sense whose axis lies along the rounds'
 * directions when they left, `{ part, sense, error }` with the median error
 * in degrees, or null when none comes within `limit`.
 */
export function matchPart(tracks, shots, limit = AIM_MATCH) {
  let best = null;
  tracks.forEach((track, part) => {
    for (const sense of [1, -1]) {
      const errors = [];
      for (const shot of shots) {
        const dir = directionAt(track, shot.t, ({ q }) => partForward(q, sense));
        if (dir) errors.push(angleBetween(dir, shot.dir));
      }
      if (!errors.length) continue;
      errors.sort((a, b) => a - b);
      const error = errors[errors.length >> 1];
      if (!best || error < best.error) best = { part, sense, error };
    }
  });
  return best && best.error <= limit ? best : null;
}

// --- a track at a time ------------------------------------------------------------

/** The samples either side of `t` in a time-ordered list: `a` the last at or
 *  before it, `b` the first after it, either null. */
export function bracket(samples, t) {
  if (!samples.length || t < samples[0].t) return { a: null, b: samples[0] ?? null };
  let lo = 0;
  let hi = samples.length - 1;
  if (t >= samples[hi].t) return { a: samples[hi], b: null };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return { a: samples[lo], b: samples[hi] };
}

/** How far from sample `a` to `b` a part has come at `t`: held until the
 *  sample period before `b`, then straight on (replay-recording.js
 *  `sampleAt`'s law). */
export function blendAt(a, b, t) {
  const start = Math.max(a.t, b.t - SAMPLE_PERIOD);
  return t <= start ? 0 : Math.min(1, (t - start) / (b.t - start));
}

/** A dense track's direction at `t` (`dirOf(sample)`, by default its
 *  `dir`), eased between samples by `blendAt`; null before its first. */
export function directionAt(samples, t, dirOf = sample => sample.dir) {
  const { a, b } = bracket(samples, t);
  if (!a) return null;
  const from = dirOf(a);
  if (!b) return from;
  const k = blendAt(a, b, t);
  if (k <= 0) return from;
  const to = dirOf(b);
  return normalise([
    from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k,
  ]) ?? from;
}

/**
 * An axis that was at `from` degrees at `start` and must be at `to` when a
 * round leaves at `arrive`: where it is at `t`, turning as late as it can at
 * `rate` deg/s, the gun's own traverse speed. A gunner lays his gun and then
 * fires; this is the least motion that still has it laid in time. A hand
 * can turn a gun faster than its `setMaxSpeed` (the mouse's input is a rate
 * up to 16), so where `rate` cannot make the turn between `start` and
 * `arrive` it turns just fast enough. `free` for an axis that turns all the
 * way round, which takes the short way.
 */
export function lateTurn(from, to, t, arrive, rate, { start = -Infinity, free = false } = {}) {
  let span = to - from;
  if (free) span -= 360 * Math.round(span / 360);
  const window = arrive - start;
  const pace = window > 0 ? Math.max(rate, Math.abs(span) / window) : rate;
  const reach = Math.max(0, arrive - t) * pace;
  return to - Math.max(-reach, Math.min(reach, span));
}
