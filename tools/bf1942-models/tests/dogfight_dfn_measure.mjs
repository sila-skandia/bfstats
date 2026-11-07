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
//   landing shot for 0.5 s (or you shoot him down); his guns have a landing shot for 0.2 s at most
//   from the move on.
//   And having flipped, you stay there: he is never on your six for a second,
//   and you keep coming up with the shot (never IDLE seconds near him without
//   one, unless he is down).
// - Ninja: the ascendancy, won and held (the owner, 2026-11-07: "coming up
//   with a shot, and how to stay there"). You come up with the shot again
//   and again: at least ATTACKS separate attacks (a burst of BURST s of
//   landing shot, more than APART s after the last attack), 0.5 s
//   of landing shot in all and at least one round on him. He never gets a
//   chance: his guns never have a landing shot for more than 0.2 s, no round
//   of his strikes you, and he is never on your six for a second. And you
//   hold it: from your first shot on, for HELD of the time you have the
//   energy (within 30 m of his) or sit behind him, and once you have the
//   advantage (your first attack, or an EDGE m energy lead inside NEAR m)
//   you are never IDLE seconds inside NEAR metres of him without a burst:
//   circling with him at even energy, out of each other's reach, is not the
//   ascendancy, it is a stalemate. Shooting him down counts as every attack
//   the fight still owed.
// The Ninja and the Flip also never hang: never more than SLOW s together
// under IN_CONTROL m/s inside HANG m of him (from the move on). Hanging at
// 8 m/s in front of him is a fall, not a manoeuvre (reviews/dfn-sc.md).
// Every move also: never closer than 15 m, nobody flies into the ground. A
// fight is measured up to the kill: flying past the wreck is not a pass.
//
// "On your six" (`sixLost`, reported for every move): he sits within 60
// degrees of your tail, his nose within 30 degrees of you, inside 400 m. A
// pilot who turns in lockstep with a breaking enemy and lets him round onto
// his tail has handed him the fight, whatever else the numbers say.

const DEG = 180 / Math.PI;
export const GONE = 900;
export const FLIP_WITHIN = 20;
/** Durations are sums of 1/30 s ticks: compared with this slack, so 15
 *  ticks count as the 0.5 s they are. */
const EPS = 1e-6;
/** Below this you are not in his rear quarter, you are hanging in it: a
 *  pilot at 9-20 m/s under his tail has no shot and no control. */
export const IN_CONTROL = 35;
export const SLOW = 3;
export const HANG = 300;
/** A Ninja comes up with the shot this many times. An attack is a burst:
 *  BURST s of landing shot (gaps under a second join), more than APART s
 *  after the last attack began. A two-tick snap is not an attack, and two
 *  snaps 1.9 s apart are not two (reviews/dfn-uh.md, the review). */
export const ATTACKS = 2;
export const BURST = 0.3;
export const APART = 3;
/** The energy lead (m) inside NEAR that counts as having the advantage: from
 *  then on the IDLE clock runs, shot or no shot. */
export const EDGE = 50;
/** The share of the fight after his first shot a Ninja holds the advantage. */
export const HELD = 0.6;
/** The longest a Ninja (or a Flip, once flipped) spends near him, after its
 *  first shot, without coming up with the shot again. Rebuilding a pass's
 *  energy in a climb takes about 8 s (reviews/ascend.md); 20 s is that, the
 *  climb back over him and the dive. */
export const IDLE = 20;
export const NEAR = 600;

/**
 * The nine starts every move is flown from: an L9 orthogonal array over four
 * nudges to the moving seat's start, so every pair of levels of any two
 * nudges is flown once. `dx` sideways and `dz` along (world x and z, metres),
 * `dy` height (metres), `dv` speed (m/s). The first is the start itself, the
 * one the theatre plays. Before 2026-11-07 the nine were x by speed only, so
 * in a symmetric fight the two sideways starts were mirror images and height
 * and range, which decide most bounces, were never moved (reviews/dfn-ot.md,
 * reviews/dfn-ta.md).
 */
const L9 = [[0, 0, 0, 0], [0, 1, 1, 1], [0, 2, 2, 2], [1, 0, 1, 2], [1, 1, 2, 0], [1, 2, 0, 1], [2, 0, 2, 1], [2, 1, 0, 2], [2, 2, 1, 0]];
const LEVELS = { dx: [0, -30, 30], dz: [0, -30, 30], dy: [0, -10, 10], dv: [0, -3, 3] };
export const STARTS = L9.map(([a, b, c, d]) => ({ dx: LEVELS.dx[a], dz: LEVELS.dz[b], dy: LEVELS.dy[c], dv: LEVELS.dv[d] }));
/** A start nudged by one of `STARTS`. */
export function nudge(start, { dx = 0, dz = 0, dy = 0, dv = 0 }) {
  return { ...start, at: [start.at[0] + dx, start.at[1] + dy, start.at[2] + dz], speed: start.speed + dv };
}

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
  // A plane shot down is out of the fight: flying past the wreck is not a
  // pass, so the fight is measured up to the kill.
  const downAt = r.end?.why === 'shot down' ? r.end.t : Infinity;
  const n = Math.min(me.length, him.length, ...(Number.isFinite(downAt) ? [Math.round(downAt / dt) + 1] : []));
  const t0 = moveStart(r, kind, seat);
  const out = { kind, t0, ok: false };
  if (t0 === null) return { ...out, why: `no ${kind} phase flown` };
  const i0 = Math.round(t0 / dt);
  let minRange = Infinity, hisShot = 0, myShot = 0, quarter = 0, bestQuarter = 0, flipAt = null, hisShotAll = 0;
  // He on my six: now, longest, and since the flip; my attacks; the advantage held.
  let six = 0, sixLost = 0, sixAfterFlip = 0, attacks = 0, lastShotAt = -Infinity, firstShot = null, heldTicks = 0, afterTicks = 0;
  // Near him without a burst, since I had the advantage (Ninja) or the flip (Flip).
  let hang = 0, hangMax = 0;
  let idle = 0, idleMax = 0, burst = 0, burstCounted = false, lastAttackAt = -Infinity, edgeAt = null;
  for (let i = 0; i < n; i++) {
    const rel = sub(me[i].p, him[i].p);
    const range = len(rel);
    minRange = Math.min(minRange, range);
    if (him[i].o) hisShotAll += dt;
    if (i < i0) continue;
    if (him[i].o) hisShot += dt;
    if (me[i].o) myShot += dt;
    hang = me[i].v < IN_CONTROL && range < HANG ? hang + dt : 0;
    hangMax = Math.max(hangMax, hang);
    // In his rear quarter with my nose on him.
    const behind = ang(noseOf(him[i]).map(v => -v), rel) < 60;
    const onHim = ang(noseOf(me[i]), rel.map(v => -v)) < 30;
    const inQuarter = behind && onHim && range < (kind === 'flip' ? 350 : 400) && me[i].v >= IN_CONTROL;
    quarter = inQuarter ? quarter + dt : 0;
    bestQuarter = Math.max(bestQuarter, quarter);
    if (kind === 'flip' && flipAt === null && quarter >= 2 - EPS) flipAt = me[i].t;
    // He on my six: within 60 degrees of my tail, his nose on me, inside 400 m.
    const onMySix = ang(noseOf(me[i]).map(v => -v), rel.map(v => -v)) < 60 && ang(noseOf(him[i]), rel) < 30 && range < 400;
    six = onMySix ? six + dt : 0;
    sixLost = Math.max(sixLost, six);
    if (flipAt !== null) sixAfterFlip = Math.max(sixAfterFlip, six);
    // An attack: a burst of landing shot (gaps under a second join) of BURST
    // s, more than APART s after the last attack.
    let bursting = false;
    if (me[i].o) {
      if (me[i].t - lastShotAt > 1) { burst = 0; burstCounted = false; }
      burst += dt;
      lastShotAt = me[i].t;
      if (burst >= BURST - EPS) {
        bursting = true;
        if (!burstCounted && me[i].t - lastAttackAt > APART) { attacks++; lastAttackAt = me[i].t; }
        burstCounted = true;
        if (firstShot === null) firstShot = me[i].t;
      }
    }
    if (edgeAt === null && range < NEAR && me[i].e >= him[i].e + EDGE) edgeAt = me[i].t;
    const counting = kind === 'flip' ? flipAt !== null : (firstShot !== null || edgeAt !== null);
    if (bursting) idle = 0;
    else if (counting && range < NEAR) { idle += dt; idleMax = Math.max(idleMax, idle); }
    if (firstShot !== null) {
      afterTicks++;
      if (me[i].e >= him[i].e - 30 || (behind && range < 500)) heldTicks++;
    }
  }
  const hitsOnMe = r.rounds.filter(x => x.hit && x.side === 1 - seat && x.hitT >= t0 + 0.5).length;
  const hitsOnHim = r.rounds.filter(x => x.hit && x.side === seat && x.hitT >= t0).length;
  const held = afterTicks ? heldTicks / afterTicks : 0;
  const last = n - 1, back = Math.max(0, last - Math.round(3 / dt));
  const endRange = len(sub(me[last].p, him[last].p));
  const opening = endRange - len(sub(me[back].p, him[back].p));
  const grounded = r.end?.why === 'flew into the ground';
  const killed = r.end?.why === 'shot down' && r.end.winner === seat;
  const stayed = (killed || idleMax <= IDLE + EPS) && hangMax <= SLOW + EPS;
  const common = minRange > 15 && !grounded;
  Object.assign(out, {
    minRange: Math.round(minRange), hisShot: +hisShot.toFixed(2), myShot: +myShot.toFixed(2),
    bestQuarter: +bestQuarter.toFixed(2), hitsOnMe, endRange: Math.round(endRange), opening: Math.round(opening),
    endSpeed: Math.round(me[last].v), flipAt, grounded, winner: r.end?.winner ?? null, end: r.end?.why ?? null,
    sixLost: +sixLost.toFixed(2), sixAfterFlip: +sixAfterFlip.toFixed(2), attacks, hitsOnHim, held: +held.toFixed(2),
    idle: +idleMax.toFixed(2), hang: +hangMax.toFixed(2), killed,
  });
  if (kind === 'dip') {
    out.ok = common && hitsOnMe === 0 && endRange > GONE && opening > 0 && me[last].v > 30;
  } else if (kind === 'flip') {
    out.ok = common && flipAt !== null && flipAt - t0 <= FLIP_WITHIN + EPS && (killed || myShot >= 0.5 - EPS) && hisShot <= 0.2 + EPS
      && sixAfterFlip < 1 && stayed;
  } else {
    out.hisShot = +hisShotAll.toFixed(2);
    out.ok = common && hisShotAll <= 0.2 + EPS && hitsOnMe === 0 && sixLost < 1
      && (killed || (attacks >= ATTACKS && myShot >= 0.5 - EPS && hitsOnHim >= 1 && held >= HELD)) && stayed;
  }
  return out;
}

/** The verdict over the nine `STARTS`: 7 or more works, 3 to 6 partly. */
export function verdictOf(scores) {
  const works = scores.filter(s => s.ok).length;
  return { works, of: scores.length, verdict: works >= 7 ? 'works' : works >= 3 ? 'partly' : 'no' };
}
