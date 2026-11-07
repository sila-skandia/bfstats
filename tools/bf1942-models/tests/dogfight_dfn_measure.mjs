// The Dip, the Flip and the Ninja, measured the same way in every lesson
// (features/dogfight-school, "Can you survive it?"). A lesson's shape harness
// imports this after the head of `dogfight_school_harness.mjs` and scores
// each of its three demos from the nine nearby starts with `scoreMove`.
//
// The seat is the pilot in trouble flying the move (1, the other seat, in
// every Dip / Flip / Ninja demo); the threat is the other one. A move starts
// at the first tick the seat's phase begins with the move's name ('dip',
// 'flip', 'ninja'), or at 0 for the Ninja, which is flown from the start.
//
// - Dip: out of the fight alive. From the move on, no round of his strikes
//   you, and at the end you are past GONE metres apart and still opening,
//   flying, above the ground.
// - Flip: from chased to chaser. Within FLIP_WITHIN seconds of the move you
//   sit in his rear quarter (inside 60 degrees of his tail), your nose within
//   30 degrees of him, inside 350 m, at 35 m/s or more, for 2 s together, and your guns have a
//   landing shot for 0.5 s; his guns have a landing shot for 0.2 s at most
//   from the move on.
// - Ninja: the upper hand from the start, never given back. His guns never
//   have a landing shot for more than 0.2 s in all and no round of his
//   strikes you, and you have a landing shot for 0.5 s or sit in his rear
//   quarter inside 400 m at 35 m/s or more for 3 s.
// Every move also: never closer than 15 m, nobody flies into the ground.

const DEG = 180 / Math.PI;
export const GONE = 900;
export const FLIP_WITHIN = 20;
/** Durations are sums of 1/30 s ticks: compared with this slack, so 15
 *  ticks count as the 0.5 s they are. */
const EPS = 1e-6;
/** Below this you are not in his rear quarter, you are hanging in it: a
 *  pilot at 9-20 m/s under his tail has no shot and no control. */
export const IN_CONTROL = 35;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / ((len(a) * len(b)) || 1)))) * DEG;
/** The nose of a track sample: -Z turned by its quaternion. */
export function noseOf(k) {
  const [x, y, z, w] = k.q;
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/** When the move starts: the seat's first phase named for it, or null. */
export function moveStart(r, kind, seat = 1) {
  if (kind === 'ninja') return 0;
  const k = r.tracks[seat].find(s => String(s.ph ?? '').toLowerCase().startsWith(kind));
  return k ? k.t : null;
}

/**
 * Score one flown demo: `kind` is 'dip', 'flip' or 'ninja'. Returns the
 * measurements and `ok`, whether the move did what its name says.
 */
export function scoreMove(r, kind, seat = 1) {
  const me = r.tracks[seat], him = r.tracks[1 - seat];
  const dt = r.dt;
  const n = Math.min(me.length, him.length);
  const t0 = moveStart(r, kind, seat);
  const out = { kind, t0, ok: false };
  if (t0 === null) return { ...out, why: `no ${kind} phase flown` };
  const i0 = Math.round(t0 / dt);
  let minRange = Infinity, hisShot = 0, myShot = 0, quarter = 0, bestQuarter = 0, flipAt = null, hisShotAll = 0;
  for (let i = 0; i < n; i++) {
    const rel = sub(me[i].p, him[i].p);
    const range = len(rel);
    minRange = Math.min(minRange, range);
    if (him[i].o) hisShotAll += dt;
    if (i < i0) continue;
    if (him[i].o) hisShot += dt;
    if (me[i].o) myShot += dt;
    // In his rear quarter with my nose on him.
    const behind = ang(noseOf(him[i]).map(v => -v), rel) < 60;
    const onHim = ang(noseOf(me[i]), rel.map(v => -v)) < 30;
    const inQuarter = behind && onHim && range < (kind === 'flip' ? 350 : 400) && me[i].v >= IN_CONTROL;
    quarter = inQuarter ? quarter + dt : 0;
    bestQuarter = Math.max(bestQuarter, quarter);
    if (kind === 'flip' && flipAt === null && quarter >= 2 - EPS) flipAt = me[i].t;
  }
  const hitsOnMe = r.rounds.filter(x => x.hit && x.side === 1 - seat && x.hitT >= t0 + 0.5).length;
  const last = n - 1, back = Math.max(0, last - Math.round(3 / dt));
  const endRange = len(sub(me[last].p, him[last].p));
  const opening = endRange - len(sub(me[back].p, him[back].p));
  const grounded = r.end?.why === 'flew into the ground';
  const common = minRange > 15 && !grounded;
  Object.assign(out, {
    minRange: Math.round(minRange), hisShot: +hisShot.toFixed(2), myShot: +myShot.toFixed(2),
    bestQuarter: +bestQuarter.toFixed(2), hitsOnMe, endRange: Math.round(endRange), opening: Math.round(opening),
    endSpeed: Math.round(me[last].v), flipAt, grounded, winner: r.end?.winner ?? null, end: r.end?.why ?? null,
  });
  if (kind === 'dip') {
    out.ok = common && hitsOnMe === 0 && endRange > GONE && opening > 0 && me[last].v > 30;
  } else if (kind === 'flip') {
    out.ok = common && flipAt !== null && flipAt - t0 <= FLIP_WITHIN + EPS && myShot >= 0.5 - EPS && hisShot <= 0.2 + EPS;
  } else {
    out.hisShot = +hisShotAll.toFixed(2);
    out.ok = common && hisShotAll <= 0.2 + EPS && hitsOnMe === 0 && (myShot >= 0.5 - EPS || bestQuarter >= 3 - EPS);
  }
  return out;
}

/** The verdict over the nine starts: 7 or more works, 3 to 6 partly. */
export function verdictOf(scores) {
  const works = scores.filter(s => s.ok).length;
  return { works, of: scores.length, verdict: works >= 7 ? 'works' : works >= 3 ? 'partly' : 'no' };
}
