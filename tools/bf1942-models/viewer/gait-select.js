// Which of idle/walk/run a recorded soldier life is doing at a point in time,
// and how confident that read is. Feeds `replay.js`'s gait-animation wiring
// (`features/soldier-locomotion-animation/README.md` sec 6, point 2: "ground
// speed plus the recorded stance selects idle/walk/run/crouchwalk/crawl the
// same way GAIT_FOR does here"). Standalone on purpose: this module neither
// imports nor is imported by `replay.js`, and does not touch it.
//
// **Stance (crouch/prone) is out of scope, and not by choice.**
// `bf42plus/src/replay.cpp`'s sampler (`sampleObjects`, `ObjectState`) writes
// only position, rotation and Armor hit points per object -- grepping that
// file and the rest of bf42plus for "pose"/"crouch"/"prone"/"stance"/"c_Sst"
// turns up nothing. The recording format has no field to read a stance out
// of, for any recording made with the recorder as it exists today. See
// `features/soldier-locomotion-animation/README.md`, section "Stance capture
// (2026-09-16)", for what a recorder change would need and why the two
// obvious shortcuts (the pose-flags byte and the animation-state-machine
// slot) are not proven-safe reads yet. So: this module only ever returns
// 'idle' | 'walk' | 'run'.
//
// Input is exactly the `life` shape `replay.js`'s `parseRecording` builds:
// `{ keys: [{ t, p: [x,y,z], q: [qx,qy,qz,qw] }, ...], ... }`, keys ascending
// in `t`, written only when the object's transform changed by more than the
// recorder's epsilon (round-replay-capture README sec 9 and 11.3/12). This
// module does not import replay.js: replay.js pulls in `three`, which is not
// an installed dependency of a plain `node` run (confirmed: `node -e
// "import('three')"` fails outside a bundler), and a standalone module
// should not need a renderer to answer a question about numbers.
//
// Reference speeds come from `soldier.js`, not restated here: `GAIT_SPEED`
// and `STRAFE_SPEED` are the engine's own two hardcoded tables
// (`BFSoldierTemplate::directionalSpeed`/`::strafeSpeed`, physics.js
// 0x009581b4/0x009581cc), already reverse-engineered, cited and unit-tested
// there. Measured against two real recordings (see
// `tests/test_gait_select.py`): a sustained forward-run burst in
// `replay_20260915-213110.ndjson` (nid 608, t=27.7-31.3s and again
// t=82.9-89.1s) measures 5.6-6.3 m/s against the engine's 6, and a sustained
// *lateral* burst in the same life (t=44.9-47.4s) measures 3.7-4.1 m/s
// against `STRAFE_SPEED[stand]`'s 4 -- both within the sampler's own quoted
// position precision (2 decimal places, i.e. +-0.01 m per axis per sample,
// which at a 0.1 s tick is worth +-0.1-0.2 m/s of jitter on a single
// interval). Neither reference is hit exactly, as expected of a measurement.

import { GAIT_SPEED, STRAFE_SPEED, WALK_SPEED_FACTOR, DIRECTIONAL_SPEED } from './soldier.js';

// Consistency check on the assumption `classify()` below leans on: standing
// still and standing-strafing/backing-up share one reduced top speed. If a
// future edit to either table breaks this, the two-table split needs
// revisiting, not a silent wrong answer -- so it is also asserted in
// `test_gait_select.py`, against the real, imported values rather than the
// literals 4 and 4.
if (STRAFE_SPEED[0] !== DIRECTIONAL_SPEED[1]) {
  throw new Error('gait-select: STRAFE_SPEED[stand] and DIRECTIONAL_SPEED[not-forward] have diverged; the lateral speed table below needs re-deriving.');
}

// Samples are written at up to 10 Hz and only on change (round-replay-capture
// README sec 9). `replay.js`'s own renderer treats a gap between two samples
// as a hold at the earlier one, then interpolates over only the last
// `SAMPLE_PERIOD` seconds before the later one -- "not a slow drift across
// the gap" (README sec 12, "Measured conventions"; `replay.js`'s own
// `SAMPLE_PERIOD` / `sampleAt`). Gait selection mirrors that exactly, on
// purpose: a soldier `replay.js` is drawing as standing still must not be
// reported as running, or the animation and the translation disagree on
// screen. Duplicated rather than imported -- see the file header on why
// `replay.js` cannot be imported here.
export const SAMPLE_PERIOD = 0.1;

// Forward top speed, standing: GAIT_SPEED.run / .walk, i.e. 6 / 2 m/s.
const FORWARD_RUN = GAIT_SPEED.run;
const FORWARD_WALK = GAIT_SPEED.walk;

// Non-forward (strafing, or backing up -- see the DIRECTIONAL_SPEED/
// STRAFE_SPEED check above) top speed, standing: 4 m/s, and the walk-toggle
// fraction of it.
const LATERAL_RUN = STRAFE_SPEED[0];
const LATERAL_WALK = LATERAL_RUN * WALK_SPEED_FACTOR;

// idle/walk and walk/run boundaries are the midpoints of the engine's own
// discrete speeds, not independently chosen numbers: BF1942 infantry have no
// acceleration ramp (physics.js `SoldierBody.step`, "you are at speed on the
// frame you press the key and stopped on the frame you release it"), so a
// clean sample sits at 0, at a walk speed, or at a run speed, and the
// boundary belongs exactly between the two it separates.
const FORWARD_WALK_MIN = FORWARD_WALK / 2;
const FORWARD_RUN_MIN = (FORWARD_WALK + FORWARD_RUN) / 2;
const LATERAL_WALK_MIN = LATERAL_WALK / 2;
const LATERAL_RUN_MIN = (LATERAL_WALK + LATERAL_RUN) / 2;

// How much of a soldier's own top speed range counts as full confidence when
// a sample sits that far from the nearest boundary above. 1.5 m/s is half the
// forward walk/run gap (4 m/s), chosen so a clean run or walk sample reads
// near 1.0 and only the boundary neighbourhood itself reads low.
const CONFIDENCE_MARGIN = 1.5;

// Minimum time a raw reading has to persist before it flips the *reported*
// gait (point 4: hysteresis against per-sample noise). 0.2 s is two sample
// periods at the recorder's 10 Hz: every single-tick misreading actually
// observed in the two real recordings this was checked against (a partial
// distance on the one tick that mixes "was idle" and "started moving", at a
// genuine gait change) lasted exactly one tick, ~0.1 s; 0.2 s clears that
// with margin while still confirming a real, sustained change inside a
// quarter-second.
const MIN_DWELL_S = 0.2;

// cos(60 degrees). A movement direction within 60 degrees of facing counts as
// "forward enough" to use the forward speed table; beyond that (strafing,
// backing up, or a diagonal closer to sideways than to forward) uses the
// lateral one. Chosen, not measured -- the real per-sample dot products this
// was checked against separate far more sharply than this threshold needs:
// in both real recordings, forward-run intervals cluster at dot 0.8-1.0
// (mean 0.90 and 0.89) while the sustained lateral bursts cluster at dot
// -0.1..0.1 (one file) or -1..-0.5 (backing up, the other file) -- nothing
// observed falls in the 0.2-0.7 band this threshold sits in the middle of.
const FORWARD_COS = 0.5;
const BACKWARD_COS = -0.5;

// Above this gap, two consecutive samples are treated as "the object held
// still, then changed" rather than "the object moved throughout" -- see
// `rawSegments`. 0.15 s is 1.5 sample periods: real back-to-back samples
// while something moves continuously land at dt = 0.10-0.11 s in both real
// recordings (ordinary scheduler jitter around the recorder's 10 Hz gate,
// which fires on the first frame *at or after* 1/10 s, never exactly on it),
// and nothing between 1 and 1.5 ticks was ever observed. Below this, speed is
// `dist / dt` outright; a version of this module that applied the
// hold-then-interpolate windowing (below) to every gap **larger than exactly
// one tick** measured a run at 6.11-6.14 m/s median against the engine's 6 --
// a real, reproducible ~2% bias from squeezing an 0.11 s step's distance into
// an 0.10 s window -- which is why the cutoff is 1.5 ticks and not 1.
const GAP_THRESHOLD = 1.5 * SAMPLE_PERIOD;

// A horizontal displacement implying a speed above this is not a gait, it is
// a discontinuity: found for real in `replay_20260915-210619.ndjson`, nid
// 608 (`USMarineSoldier`), t=103.37->103.47 -- 40.037 m inside one 0.1 s
// window, 400 m/s. The recording's own `p` record at t=103.468,
// `[[0,2,608]]`, dates a vehicle-exit to the same instant: the player got
// back into their soldier body somewhere else on the map, 22.3 s after they
// last drove it (t=81.293, `p` record `[[0,2,531]]`, entering vehicle net id
// 531). So a soldier life's position stream is not guaranteed continuous
// across occupying a vehicle -- the documented "a gap is a hold" convention
// (round-replay-capture README sec 12) holds for a soldier standing or lying
// somewhere, but not across this boundary, which this module has no way to
// detect on its own (it never sees `p` records, only one life's `keys`). 12
// m/s is comfortably above the fastest *legitimate* reading either real
// recording produced once the jitter bias above is fixed (a forward+strafe
// diagonal is bounded by hypot(FORWARD_RUN, LATERAL_RUN) = 7.2 m/s) and
// nowhere near 400.
const TELEPORT_SPEED = 12;

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/**
 * World-space forward direction from a recorded quaternion `[x, y, z, w]`:
 * the local +Z axis (`spawnYaw`'s doc comment in soldier.js: "+Z is forward
 * ... in Refractor's frame") rotated by the quaternion `bf42plus/src/
 * replay.cpp`'s `toQuat` reads off the object's absolute transform. Only the
 * horizontal (x, z) part is used by callers; y is left in for completeness.
 *
 * Not independently re-derived here -- checked empirically instead, the way
 * this codebase settles a convention question (README sec 12's own soldier
 * yaw-flip story is exactly this kind of bug): rotating this formula's
 * output and dotting it against the *measured* movement direction is what
 * produced the clean 0.8-1.0-versus-(-0.1..0.1) separation `FORWARD_COS` is
 * picked against, on real recorded quaternions and real recorded positions.
 * A wrong axis or a wrong handedness would have produced noise, not two
 * separated clusters.
 */
function forwardXZ(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  return [2 * (x * z + w * y), 1 - 2 * (x * x + y * y)];
}

/** cos(angle) between the horizontal movement direction (dx, dz) and the
 * average of two endpoint facings, or null when either is degenerate (no
 * horizontal movement, or -- never observed, but not assumed away -- a
 * facing quaternion with no horizontal component). Averaging the two
 * endpoints rather than picking one is cheap and adequate at 10 Hz: a
 * soldier cannot turn far in one tick. */
function facingDot(dx, dz, dist, qa, qb) {
  if (!(dist > 1e-4)) return null;
  const [fax, faz] = forwardXZ(qa);
  const [fbx, fbz] = forwardXZ(qb);
  const fx = fax + fbx, fz = faz + fbz;
  const flen = Math.hypot(fx, fz);
  if (!(flen > 1e-6)) return null;
  return (dx * fx + dz * fz) / (dist * flen);
}

/** 'forward' | 'backward' | 'strafe' | null (not moving, or facing unknown). */
function headingLabel(dot) {
  if (dot == null) return null;
  if (dot >= FORWARD_COS) return 'forward';
  if (dot <= BACKWARD_COS) return 'backward';
  return 'strafe';
}

/**
 * Idle/walk/run from a horizontal speed and an optional facing dot. Missing
 * or ambiguous heading (`dot == null`, e.g. no rotation data) falls back to
 * the forward table -- the "forward-only is a fine v1" default from the
 * feature brief, applied when there is nothing to say otherwise.
 */
function classify(speed, dot) {
  const forwardish = dot == null || dot >= FORWARD_COS;
  const walkMin = forwardish ? FORWARD_WALK_MIN : LATERAL_WALK_MIN;
  const runMin = forwardish ? FORWARD_RUN_MIN : LATERAL_RUN_MIN;
  if (speed < walkMin) return 'idle';
  if (speed < runMin) return 'walk';
  return 'run';
}

/** Distance from `speed` to the nearer of the two boundaries `classify` used. */
function boundaryClearance(speed, dot) {
  const forwardish = dot == null || dot >= FORWARD_COS;
  const walkMin = forwardish ? FORWARD_WALK_MIN : LATERAL_WALK_MIN;
  const runMin = forwardish ? FORWARD_RUN_MIN : LATERAL_RUN_MIN;
  return Math.min(Math.abs(speed - walkMin), Math.abs(speed - runMin));
}

/**
 * `life.keys` cut into contiguous, non-overlapping raw (unsmoothed) readings:
 * `{ start, end, speed, dot, teleport }`, `[start, end)` in the recording's
 * own clock, covering all of time from -Infinity (before the first sample:
 * nothing has been seen moving yet) to +Infinity (after the last one: held
 * there, same as any other gap -- see the file header on why a gap means a
 * hold).
 *
 * Three cases per pair of consecutive samples, checked in this order:
 *
 * - **A teleport** (the interval's own natural speed -- `dist / dt` for a
 *   normal tick, `dist / SAMPLE_PERIOD` for a genuine gap, see below --
 *   exceeds `TELEPORT_SPEED`): the position changed by more than anything
 *   gaited here can cover, so the *whole* interval is left as a hold
 *   (`speed: 0`, `teleport: true`) rather than reporting a fictitious
 *   sprint. `selectGait` reads this as idle with zero confidence -- honest
 *   under-claiming, not a guess -- and does not attempt to interpolate
 *   across it (that is a position/rendering concern, `replay.js`'s, not a
 *   gait one). Checked against both branches' speed formulas below, not only
 *   the genuine-gap one the real example (see `TELEPORT_SPEED`'s own
 *   comment) happens to fall into -- a quick vehicle entry/exit could just
 *   as easily land the same discontinuity inside one normal-width tick, and
 *   nothing here should depend on it not doing that.
 * - **A normal tick** (`dt <= GAP_THRESHOLD`, the overwhelmingly common case
 *   while something is moving continuously -- 247 of 249 intervals in one
 *   real recording, 220 of 227 in the other): the object moved throughout,
 *   `speed = dist / dt` outright.
 * - **A genuine gap** (`dt > GAP_THRESHOLD`): held at the earlier sample,
 *   then one `SAMPLE_PERIOD`-wide moving interval ending at the later one --
 *   mirroring exactly how `replay.js` draws it, and why: this module and the
 *   renderer must not disagree about when a soldier starts moving.
 *
 * Exported for tests and for anyone who wants the unsmoothed reading
 * `selectGait` itself never returns -- "no speculation presented as fact"
 * cuts both ways, and the raw numbers this is built from should stay
 * checkable independently of the hysteresis layered on top.
 */
export function rawSegments(life) {
  const keys = life && life.keys ? life.keys : [];
  const segs = [];
  if (keys.length === 0) return segs;
  segs.push({ start: -Infinity, end: keys[0].t, speed: 0, dot: null, teleport: false });
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    const dt = b.t - a.t;
    if (!(dt > 0)) continue; // out-of-order or duplicate timestamps: skip, don't fabricate a speed
    const dx = b.p[0] - a.p[0];
    const dz = b.p[2] - a.p[2];
    const dist = Math.hypot(dx, dz);

    if (dt <= GAP_THRESHOLD) {
      const speed = dist / dt;
      if (speed > TELEPORT_SPEED) {
        segs.push({ start: a.t, end: b.t, speed: 0, dot: null, teleport: true });
        continue;
      }
      const dot = facingDot(dx, dz, dist, a.q, b.q);
      segs.push({ start: a.t, end: b.t, speed, dot, teleport: false });
      continue;
    }
    const windowedSpeed = dist / SAMPLE_PERIOD;
    if (windowedSpeed > TELEPORT_SPEED) {
      segs.push({ start: a.t, end: b.t, speed: 0, dot: null, teleport: true });
      continue;
    }
    const holdEnd = b.t - SAMPLE_PERIOD;
    segs.push({ start: a.t, end: holdEnd, speed: 0, dot: null, teleport: false });
    const dot = facingDot(dx, dz, dist, a.q, b.q);
    segs.push({ start: holdEnd, end: b.t, speed: windowedSpeed, dot, teleport: false });
  }
  segs.push({ start: keys[keys.length - 1].t, end: Infinity, speed: 0, dot: null, teleport: false });
  return segs;
}

/**
 * Raw segments with hysteresis applied: the *reported* gait only switches
 * once a differing raw reading has persisted for `MIN_DWELL_S`, absorbing
 * single-tick noise (a partial distance on the one sample that straddles a
 * real start/stop, or a measurement blip) into whichever gait already held.
 * `raw` is kept per segment for inspection; `gait` is what a caller should
 * animate; `pending` marks a segment whose raw reading has not yet earned a
 * switch (it is still reporting the previous gait).
 *
 * This confirms **retroactively**, which a live gait-selector could not:
 * `selectGait` is answering questions about a whole recording that already
 * happened, so once a candidate has held for `MIN_DWELL_S`, every segment
 * back to where that candidate *started* is relabelled, not just the one
 * that crossed the threshold. Without this, the reported switch boundary
 * lags the evidence for it by however long the raw segments straddling the
 * threshold happen to be -- observed for real in
 * `replay_20260915-210619.ndjson`: a run-to-idle deceleration passes through
 * the walk band for a full 0.2 s of raw evidence, but that evidence starts
 * mid-way through one raw sample interval, so a version of this function
 * that only relabelled forward reported an 0.112 s walk segment (under
 * `MIN_DWELL_S`) before falling to idle -- correct about *when* to switch,
 * wrong about *where* the boundary was. Relabelling backward to
 * `pendingStart` fixes it: every reported segment is now part of a run at
 * least `MIN_DWELL_S` wide, except possibly the last (if the recording ends
 * mid-accumulation, there is no future evidence to confirm or refute it, so
 * it stays reported as whatever was last confirmed, honestly marked
 * `pending`).
 */
function debouncedSegments(life) {
  const raw = rawSegments(life);
  if (raw.length === 0) return raw;
  const out = raw.map(seg => ({
    start: seg.start, end: seg.end, speed: seg.speed, dot: seg.dot,
    teleport: seg.teleport, raw: classify(seg.speed, seg.dot), gait: null, pending: false,
  }));
  let confirmed = out[0].raw;
  let pendingGait = null;
  let pendingSince = null;
  let pendingStart = -1;
  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    if (seg.raw === confirmed) {
      pendingGait = null;
      pendingSince = null;
      pendingStart = -1;
      seg.gait = confirmed;
      continue;
    }
    if (seg.raw !== pendingGait) {
      pendingGait = seg.raw;
      pendingSince = seg.start;
      pendingStart = i;
    }
    if (seg.end - pendingSince >= MIN_DWELL_S) {
      confirmed = pendingGait;
      for (let j = pendingStart; j <= i; j++) { out[j].gait = confirmed; out[j].pending = false; }
      pendingGait = null;
      pendingSince = null;
      pendingStart = -1;
    } else {
      seg.gait = confirmed; // not yet earned a switch: still reporting the old gait
      seg.pending = true;
    }
  }
  return out;
}

/** Binary search for the segment covering `t`. `segs` must be the ascending,
 * contiguous, gap-free output of `debouncedSegments`/`rawSegments`. */
function segmentAt(segs, t) {
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t < segs[mid].end) hi = mid; else lo = mid + 1;
  }
  return segs[lo];
}

// life -> its debounced timeline, computed once. Pure from a caller's point
// of view (same `(life, t)` in, same result out; `life` is never written to)
// -- this only avoids re-walking the same life's keys on every call, which
// matters once a caller is asking per soldier per rendered frame.
const timelineCache = new WeakMap();

function timelineFor(life) {
  let timeline = timelineCache.get(life);
  if (!timeline) {
    timeline = debouncedSegments(life);
    timelineCache.set(life, timeline);
  }
  return timeline;
}

/**
 * What gait a recorded soldier life is in at time `t` (seconds, the
 * recording's own clock -- the same one `life.keys[].t` and `replay.js`'s
 * playback clock use), and how sure this is.
 *
 * @param {{keys: Array<{t:number, p:number[], q:number[]}>}} life
 * @param {number} t
 * @returns {{gait: 'idle'|'walk'|'run', speed: number,
 *            heading: 'forward'|'backward'|'strafe'|null, confidence: number}}
 *
 * `speed` is the raw horizontal speed of the segment covering `t` (m/s, not
 * smoothed beyond the hold/interpolate windowing `rawSegments` already
 * applies). `heading` is movement direction relative to facing, from the
 * recorded quaternion; null while not moving or when facing could not be
 * determined. `confidence` is 0..1: how far the reading sits from the
 * nearest gait boundary (`CONFIDENCE_MARGIN` for full confidence), halved
 * while a gait switch is debouncing, and exactly 0 for a life with no
 * samples at all.
 */
export function selectGait(life, t) {
  const keys = life && life.keys ? life.keys : [];
  if (keys.length === 0) {
    return { gait: 'idle', speed: 0, heading: null, confidence: 0 };
  }
  const timeline = timelineFor(life);
  const seg = segmentAt(timeline, t);
  let confidence;
  if (seg.teleport) {
    // Not "idle, but we didn't check heading" (that's the 2/3 a plain idle
    // reading gets below) -- "no idea what was happening here at all."
    confidence = 0;
  } else {
    confidence = clamp01(boundaryClearance(seg.speed, seg.dot) / CONFIDENCE_MARGIN);
    if (seg.pending) confidence *= 0.5;
  }
  return {
    gait: seg.gait,
    speed: seg.speed,
    heading: headingLabel(seg.dot),
    confidence,
  };
}

// Exposed for tests and for a caller that wants to justify a threshold
// decision rather than take this module's word for it.
export const THRESHOLDS = Object.freeze({
  forwardWalkMin: FORWARD_WALK_MIN,
  forwardRunMin: FORWARD_RUN_MIN,
  lateralWalkMin: LATERAL_WALK_MIN,
  lateralRunMin: LATERAL_RUN_MIN,
  forwardCos: FORWARD_COS,
  backwardCos: BACKWARD_COS,
  minDwellS: MIN_DWELL_S,
  samplePeriod: SAMPLE_PERIOD,
  gapThreshold: GAP_THRESHOLD,
  teleportSpeed: TELEPORT_SPEED,
});
