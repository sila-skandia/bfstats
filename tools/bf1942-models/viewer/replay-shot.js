// The shot (features/replay-creator-view): what a clip of the round is made
// of beyond its two ends -- the camera move across it and the slow motion
// over part of it -- and which round of a burst is worth riding.
//
// A shot is `{ in, out }` on the timeline, the camera keys that fall inside
// it (replay-camtrack.js), and a ramp: a stretch the replay's clock runs
// slowly over, eased in and out so the cut does not jolt. The creator keeps
// one shot at a time and saves it as a clip.
//
// Pure -- no DOM, no three -- so `tests/replay_creator_harness.mjs` runs it.

/** What a ramp slows the clock to. 1 is the clip at its own speed. */
export const RAMP_SPEEDS = Object.freeze([1, 0.5, 0.25, 0.1]);
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
