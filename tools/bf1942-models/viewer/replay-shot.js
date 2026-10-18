// The shot (features/replay-creator-view): what a clip of the round is made
// of beyond its two ends -- the camera move across it and the slow motion
// over part of it -- and which round of a burst is worth riding.
//
// A shot is `{ in, out }` on the timeline, the camera keys that fall inside
// it (replay-camtrack.js), and a ramp: a stretch the replay's clock runs
// slowly over, eased in and out so the cut does not jolt. The creator keeps
// one shot at a time and saves it as a clip.
//
// Inside the clip's two ends sits the action (`actionOf`): the round leaving
// the barrel and what it hit. The clip is deliberately wider -- a lead-in to
// set up, a tail to let the wreck burn -- so the camera move and the slow
// motion go on the action, not on the clip. `fitKeys` moves a move built the
// other way onto it, and `screenSeconds` says how long it takes to watch.
//
// Pure -- no DOM, no three -- so `tests/replay_creator_harness.mjs` runs it.

/** What a ramp slows the clock to. 1 is the clip at its own speed. */
export const RAMP_SPEEDS = Object.freeze([1, 0.5, 0.25, 0.1]);
/** The shortest stretch a camera move reads as a move over rather than a cut
 *  across, seconds of the round. A sniper's round kills 0.16 s after the
 *  trigger: an action shorter than this is grown forward from the shot so
 *  the camera has room to travel. */
export const ACTION_MIN = 1;
/** How long an action runs on past the hit: the camera lands a moment after
 *  it, on the wreck or the body, rather than stopping dead on the flash. */
export const ACTION_SETTLE = 0.4;
/** Seconds of the recording the clock takes to reach the ramp's speed at
 *  each end: a hard cut to a tenth of the speed reads as a dropped frame. */
export const RAMP_EASE = 0.35;

/** A shot with no camera move and no slow motion. */
export const noRamp = () => ({ in: null, out: null, speed: 1, ease: RAMP_EASE });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  if (a === b) return x >= b ? 1 : 0;
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** A ramp read back from the browser's storage, with whatever it is missing
 *  filled in; `null` for one that is not an object. */
export function rampOf(kept) {
  if (!kept || typeof kept !== 'object') return noRamp();
  const time = v => (Number.isFinite(v) ? v : null);
  const speed = RAMP_SPEEDS.includes(kept.speed) ? kept.speed : 1;
  return { in: time(kept.in), out: time(kept.out), speed, ease: Number.isFinite(kept.ease) ? clamp(kept.ease, 0, 4) : RAMP_EASE };
}

/** Whether a ramp does anything at all. */
export const ramping = ramp => Boolean(ramp) && ramp.speed > 0 && ramp.speed < 1;

/**
 * The stretch a ramp runs over, inside the shot: its own ends where it has
 * them, the shot's where it does not (`span`, `{ t0, t1 }`, or null for no
 * shot). Null when neither gives it two ends in order.
 */
export function rampSpanOf(ramp, span = null) {
  if (!ramp) return null;
  let t0 = ramp.in ?? span?.t0 ?? null;
  let t1 = ramp.out ?? span?.t1 ?? null;
  if (t0 === null || t1 === null) return null;
  // The slow stretch lives inside the clip: ends kept from a clip since
  // marked elsewhere do not drag it back across the round.
  if (span) {
    t0 = clamp(t0, span.t0, span.t1);
    t1 = clamp(t1, span.t0, span.t1);
  }
  if (!(t1 > t0)) return null;
  return { t0, t1 };
}

/**
 * The replay's clock at `t` under the ramp: `base` at the stretch's ends,
 * the ramp's speed through its middle, smoothed over `ease` seconds at each
 * end (never more than half the stretch). Null where the ramp has nothing to
 * say -- it is off, it has no stretch, or `t` is outside it -- and the clock
 * is the page's own again.
 */
export function rampSpeedAt(ramp, span, t, base = 1) {
  if (!ramping(ramp) || !Number.isFinite(t)) return null;
  const at = rampSpanOf(ramp, span);
  if (!at) return null;
  if (t < at.t0 || t > at.t1) return null;
  const want = Math.min(base, ramp.speed);
  const ease = clamp(ramp.ease ?? RAMP_EASE, 0, (at.t1 - at.t0) / 2);
  const k = Math.min(smooth(at.t0, at.t0 + ease, t), smooth(at.t1, at.t1 - ease, t));
  return base + (want - base) * k;
}

/**
 * The action a clip is of: the round leaving at `fire` and what it did at
 * `hit`, grown to `min` so a camera move across it is a move, and held
 * inside `span` (the clip, which carries a lead-in before the shot and a
 * tail after the hit). Null where nothing of it is left.
 *
 * This is the stretch the camera move and the slow motion belong on. A clip
 * marked round a bazooka kill is 6.4 s long and 0.9 s of it is the round in
 * the air: a move spread over the clip's own ends crawls on long after the
 * tank has blown up.
 */
export function actionOf(fire, hit = fire, span = null, min = ACTION_MIN) {
  if (!Number.isFinite(fire)) return null;
  const end = Number.isFinite(hit) && hit > fire ? hit + ACTION_SETTLE : fire;
  let t0 = fire;
  let t1 = Math.max(end, fire + Math.max(0, min));
  if (span) {
    t0 = clamp(t0, span.t0, span.t1);
    t1 = clamp(t1, span.t0, span.t1);
  }
  return t1 - t0 > 1e-3 ? { t0, t1 } : null;
}

/**
 * `keys` with the ones inside `span` slid and scaled so the first sits at
 * `beat.t0` and the last at `beat.t1` -- the camera move fitted to the
 * action, the keys between it kept in their places proportionally. Null
 * where there is nothing to fit or it already fits.
 */
export function fitKeys(keys, span, beat) {
  const inside = keysIn(keys, span);
  if (inside.length < 2 || !beat || !(beat.t1 > beat.t0)) return null;
  const a = inside[0].t;
  const b = inside[inside.length - 1].t;
  if (!(b > a)) return null;
  if (Math.abs(a - beat.t0) < 1e-3 && Math.abs(b - beat.t1) < 1e-3) return null;
  const k = (beat.t1 - beat.t0) / (b - a);
  const moved = new Map(inside.map(key => [key, { ...key, t: beat.t0 + (key.t - a) * k }]));
  return (keys ?? []).map(key => moved.get(key) ?? key).sort((x, y) => x.t - y.t);
}

/**
 * How long `t0` to `t1` of the round takes on screen under the ramp: the
 * clock's own seconds over the speed it runs them at, stepped across the
 * stretch, so a move through slow motion reads as the seconds the viewer
 * actually waits. The eased ends are counted as they are run.
 */
export function screenSeconds(ramp, span, t0, t1, base = 1, steps = 240) {
  if (!(t1 > t0) || !(base > 0)) return 0;
  const dt = (t1 - t0) / steps;
  let out = 0;
  for (let i = 0; i < steps; i++) {
    const speed = rampSpeedAt(ramp, span, t0 + dt * (i + 0.5), base) ?? base;
    out += dt / Math.max(1e-6, speed);
  }
  return out;
}

/** A ramp's speed as the panel and the plate word it: `1/4`. */
export function speedWord(speed) {
  if (!(speed > 0) || speed >= 1) return '1x';
  const n = Math.round(1 / speed);
  return `1/${n}`;
}

/** The camera keys that fall inside `span` (`{ t0, t1 }`), in time order. */
export function keysIn(keys, span) {
  if (!span) return [];
  return (keys ?? []).filter(k => k.t >= span.t0 - 1e-6 && k.t <= span.t1 + 1e-6);
}

/**
 * The stretch between the clip's own camera keys -- the first and the last
 * inside the shot -- as a ramp's ends `{ in, out }`, or null with fewer than
 * two keys inside it: "slow down between the key frames" in one move.
 */
export function rampBetweenKeys(keys, span) {
  const inside = keysIn(keys, span);
  if (inside.length < 2) return null;
  const t0 = inside[0].t;
  const t1 = inside[inside.length - 1].t;
  return t1 > t0 ? { in: t0, out: t1 } : null;
}

/**
 * Which recorded shot made which kill: `Map<fire, kill>` over the dossier's
 * facts (replay-dossier.js `killFactsOf`), so a round in flight is known for
 * a killing one by one lookup rather than a walk of every kill.
 */
export function killByFire(facts) {
  const out = new Map();
  for (const [kill, fact] of facts) if (fact?.round?.f) out.set(fact.round.f, kill);
  return out;
}

/**
 * The next round of `pid`'s that kills somebody, from `t` on: `{ kill, f }`,
 * or null. `pid` null takes the round's next kill by anyone. Team kills are
 * not offered. The facts are `killFactsOf`'s, in the kills' own time order,
 * and the round must still be ahead of the clock so the camera can set up
 * over the shooter's shoulder before he fires.
 */
export function nextKillShot(facts, pid, t) {
  for (const [kill, fact] of facts) {
    if (kill.kind !== 'kill') continue;
    if (pid !== null && pid !== undefined && kill.killer !== pid) continue;
    const f = fact?.round?.f;
    if (!f || f.t < t) continue;
    return { kill, f };
  }
  return null;
}
