// Two of the school's pilots flown against each other on the engine's own
// airframes (features/dogfight-school): the theatre's reconstructions and the
// tests' duels. `makePlane()` hands back an airframe with the `Aircraft`
// surface (`state`, `setInput`, `integrate`, `lawEngines`); nothing here
// draws.

import { createPilot, gunOf } from './dogfight-pilot.js';
// The jet lessons' own plans, registered on the pilots' as they load.
import './dogfight-jet-plans.js';
import { stateOf, gunSolution, pointNose, energyHeight, len, rotate, basis, bodyRates, add, sub, scale, unit, dot, HAND } from './dogfight-flight.js';

/** The world's tick (`WORLD_TICK_DT`, LOOP-1). */
export const DUEL_DT = 1 / 30;
const DEG = Math.PI / 180;

/**
 * Stand an airframe in the air: at `at` (world), its nose `headingDeg` round
 * from -z toward +x and `pitchDeg` up, flying `speed` along the nose, its
 * engines spun up to the throttle (`flight_harness.mjs` `prime`: each
 * throttle axis at its clipped input, the gearbox settled on its load).
 */
export function placePlane(plane, { at, headingDeg = 0, pitchDeg = 0, speed = 55, throttle = 1 }) {
  const s = plane.state;
  s.position.set(at[0], at[1], at[2]);
  const yaw = -headingDeg * DEG, pitch = pitchDeg * DEG;
  // Yaw about y, then pitch about the body's x: the nose (-z) turned.
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  s.orientation.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  const o = s.orientation;
  const f = rotate({ x: o.x, y: o.y, z: o.z, w: o.w }, [0, 0, -1]);
  s.velocity.set(f[0] * speed, f[1] * speed, f[2] * speed);
  s.angularVelocity?.set?.(0, 0, 0);
  primeEngines(plane, throttle);
  return plane;
}

/**
 * How long an airframe's nose takes to answer the stick: seconds from full
 * aft stick, wings level at `HAND.speed`, until the pitch rate is `HAND.share`
 * of the most it reaches in `HAND.seconds`. The school's Spitfire: 0.3 s.
 */
export function pitchLag(plane) {
  plane.groundHeight = () => 0;
  placePlane(plane, { at: [0, 400, 0], speed: HAND.speed });
  const rates = [];
  for (let i = 0; i < Math.round(HAND.seconds / DUEL_DT); i++) {
    plane.setInput('c_PIPitch', -1);
    plane.setInput('c_PIThrottle', 1);
    plane.integrate(DUEL_DT);
    const s = stateOf(plane.state);
    rates.push(bodyRates(s.orientation, s.angularVelocity).pitch);
  }
  const most = Math.max(...rates);
  const at = rates.findIndex(r => r >= HAND.share * most);
  return most > 0 && at >= 0 ? (at + 1) * DUEL_DT : HAND.ref;
}

/** How long an airframe's roll takes to answer the stick, as `pitchLag`:
 *  full roll stick, wings level at `HAND.speed`. The Spitfire: 0.53 s. */
export function rollLag(plane) {
  plane.groundHeight = () => 0;
  placePlane(plane, { at: [0, 400, 0], speed: HAND.speed });
  const rates = [];
  for (let i = 0; i < Math.round(HAND.seconds / DUEL_DT); i++) {
    plane.setInput('c_PIRoll', 1);
    plane.setInput('c_PIThrottle', 1);
    plane.integrate(DUEL_DT);
    const s = stateOf(plane.state);
    rates.push(Math.abs(bodyRates(s.orientation, s.angularVelocity).roll));
  }
  const most = Math.max(...rates);
  const at = rates.findIndex(r => r >= HAND.share * most);
  return most > 0 && at >= 0 ? (at + 1) * DUEL_DT : HAND.rollRef;
}

/**
 * The roll hands tried on an airframe whose nose does not settle, in order:
 * the roll damping times the Spitfire's (`roll`), then the hand on all
 * three axes (`gain`), each the least change from the one before. The
 * first under which the nose settles is the airframe's.
 */
export const ROLL_HANDS = Object.freeze([[2, 1], [3, 1], [3, 0.8], [4, 0.8], [4, 0.65], [6, 0.65], [6, 0.5]]
  .map(([roll, gain]) => Object.freeze({ roll, gain })));
/** Settled: the nose's mean error over the last `over` seconds of `seconds`,
 *  put on a direction `side` degrees off and `down` below at `speed`. */
export const SETTLE = Object.freeze({ side: 10, down: 4, seconds: 8, over: 2, within: 3, speed: 64 });

/**
 * How far an airframe's nose is still off a direction `SETTLE.side` degrees
 * to one side and `SETTLE.down` below, `SETTLE.seconds` after the hands
 * (`pointNose`, with `hand`) were put to it: the mean over the last
 * `SETTLE.over`. Flown at `speed`, the speed the lessons fly it at.
 */
export function noseSettle(plane, hand, speed = SETTLE.speed) {
  plane.groundHeight = () => 0;
  placePlane(plane, { at: [0, 600, 0], speed });
  if (hand) plane.state.hand = hand;
  const r = SETTLE.side * Math.PI / 180, d = SETTLE.down * Math.PI / 180;
  const dir = [Math.sin(r) * Math.cos(d), -Math.sin(d), -Math.cos(r) * Math.cos(d)];
  const mem = {};
  const ticks = Math.round(SETTLE.seconds / DUEL_DT), tail = Math.round(SETTLE.over / DUEL_DT);
  let sum = 0;
  for (let i = 0; i < ticks; i++) {
    const k = pointNose(stateOf(plane.state), dir, { fine: 8, mem, dt: DUEL_DT });
    plane.setInput('c_PIPitch', k.pitch); plane.setInput('c_PIRoll', k.roll); plane.setInput('c_PIYaw', k.rudder);
    plane.setInput('c_PIThrottle', 1);
    plane.integrate(DUEL_DT);
    if (i >= ticks - tail) sum += k.off;
  }
  return sum / tail;
}

/**
 * What a lesson's speeds are measured against. The lessons were written on
 * the school's Spitfire, which flies level at `ref` m/s at `height` m, and
 * their starts are its speeds (56 to 62 m/s, three quarters of that). An
 * airframe that flies level more than `slack` times as fast starts every
 * fight faster by that ratio, its `pace`: a jet set off at a Spitfire's
 * cruise is not in the fight the lesson describes.
 */
export const PACE = Object.freeze({ height: 300, from: 90, seconds: 60, over: 10, ref: 75.6, slack: 1.15, knee: 600, roof: 760, sink: 80 });

/** An airframe's level speed at full throttle (m/s): held at `PACE.height`
 *  by a slow nose hold for `PACE.seconds`, the last `PACE.over` averaged. */
export function levelSpeed(plane) {
  plane.groundHeight = () => 0;
  placePlane(plane, { at: [0, PACE.height, 0], speed: PACE.from });
  const speeds = [], mem = {};
  const ticks = Math.round(PACE.seconds / DUEL_DT);
  for (let i = 0; i < ticks; i++) {
    const st = stateOf(plane.state);
    const up = Math.max(-0.25, Math.min(0.25, (PACE.height - st.position[1]) * 0.004 - st.velocity[1] * 0.02));
    const k = pointNose(st, [0, up, -1], { fine: 8, mem, dt: DUEL_DT });
    plane.setInput('c_PIPitch', k.pitch); plane.setInput('c_PIRoll', k.roll); plane.setInput('c_PIYaw', k.rudder);
    plane.setInput('c_PIThrottle', 1);
    plane.integrate(DUEL_DT);
    if (i * DUEL_DT > PACE.seconds - PACE.over) speeds.push(len(stateOf(plane.state).velocity));
  }
  return speeds.reduce((a, b) => a + b, 0) / speeds.length;
}

/** The airframe's own cannon, off its model's extras: the FireArms on the
 *  fire key that fires a bullet, as a duel's `gun`. One barrel on the nose:
 *  no convergence, so the pilots open inside 400 m. Null with none. */
export function ownGun(plane) {
  let gun = null;
  plane?.node?.traverse?.(n => {
    const fa = n.userData?.fireArms, pr = fa?.projectile;
    if (gun || !pr || pr.kind !== 'bullet' || (fa.input && fa.input !== 'c_PIFire') || !(Number(fa.velocity) > 300)) return;
    gun = { speed: Number(fa.velocity), reach: Number(fa.velocity) * (Number(pr.timeToLive) || 1.5), span: 0.5, converge: 0 };
  });
  return gun;
}

/** One airframe type from another, by what the flight law reads of it. */
const signature = plane => {
  const k = plane?.spec ?? {};
  return [k.mass, k.drag, ...(k.size ?? []), k.engines?.length, k.surfaces?.length].join('|');
};
const fits = new Map();
const NEUTRAL = Object.freeze({ hand: null, pace: 1, gun: null });

/**
 * Fit a duel to `plane`'s airframe: `{ hand, pace, gun }`, measured once a
 * type on a second airframe from `makePlane`.
 *
 * - `hand` (`dogfight-flight.js` `HAND`): its pitch lag over the Spitfire's,
 *   where it is clearly slower to answer; it rides on the plane's state, and
 *   the hands damp the pull by that much more.
 * - `pace` (`PACE`): its level speed over the Spitfire's, where it is clearly
 *   faster; the duel starts its fights that much faster.
 * - `gun`: for an airframe paced as a jet, its own cannon (`ownGun`), which
 *   the duel then fights with in place of the school's wing guns.
 *
 * An airframe as quick to answer and no faster than the Spitfire gets
 * `{ hand: null, pace: 1, gun: null }` and is flown exactly as before.
 */
export function fitAirframe(plane, makePlane, key = 0) {
  const sig = signature(plane);
  if (!fits.has(sig)) {
    let fit = NEUTRAL;
    try {
      const lag = pitchLag(makePlane(null, key)) / HAND.ref;
      const hand = lag > HAND.slack ? Object.freeze({ pitch: Math.round(lag * 100) / 100 }) : null;
      const scratch = makePlane(null, key);
      if (hand) scratch.state.hand = hand;
      const level = levelSpeed(scratch);
      const ratio = level / PACE.ref;
      const pace = ratio > PACE.slack ? Math.round(ratio * 100) / 100 : 1;
      // The roll: tried at the speed the lessons start it at, or a little
      // under its own level speed if it cannot fly that fast (BF1918's D.VII).
      const speed = Math.min(SETTLE.speed * pace, 0.85 * level);
      // A roll slower to answer than the Spitfire's by more than the slack
      // is damped by the square of how much slower, flown by the wings'
      // small banks over that much wider a cone, and handled that much more
      // lightly (`pointNose`).
      const rl = rollLag(makePlane(null, key)) / HAND.rollRef;
      let hands = rl > HAND.slack
        ? Object.freeze({ ...hand, roll: Math.round(rl * rl * 10) / 10, fine: Math.round(rl * 100) / 100, gain: Math.round(100 / Math.sqrt(rl)) / 100 })
        : hand;
      // And one whose nose still rocks round a point off to the side takes
      // the first of `ROLL_HANDS` under which it settles.
      if (noseSettle(makePlane(null, key), hands, speed) > SETTLE.within) {
        const tried = ROLL_HANDS.find(h => noseSettle(makePlane(null, key), { ...hands, ...h }, speed) <= SETTLE.within) ?? ROLL_HANDS.at(-1);
        hands = Object.freeze({ ...hands, ...tried });
      }
      fit = Object.freeze({ hand: hands, pace, gun: pace > 1 ? ownGun(plane) : null });
    } catch { fit = NEUTRAL; }
    fits.set(sig, fit);
  }
  const fit = fits.get(sig);
  // A plane that comes with a hand of its own keeps it.
  if (fit.hand && plane?.state && plane.state.hand === undefined) plane.state.hand = fit.hand;
  return fit;
}

/**
 * A paced start's height, real metres: as paced up to `PACE.knee`, and from
 * there bent over toward `PACE.roof`, which it never reaches. The lessons'
 * perches (680 and 700 m at the Spitfire's size, 870 and 896 on the F-16)
 * would sit in air with a tenth of its lift, above the roof every jet's
 * pilot flies under (`dogfight-jet-ceiling.js` `ROOF`, 800 m): bent over,
 * the highest start is 735 m on the F-16 and 750 on the MiG-29, and two
 * starts that differ in height still do.
 */
export function pacedHeight(h) {
  const span = PACE.roof - PACE.knee;
  return h <= PACE.knee ? h : PACE.knee + span * (1 - Math.exp(-(h - PACE.knee) / span));
}

/**
 * A side's start at an airframe's pace: the lesson's fight made larger by
 * `pace`, its speed and its place about the fight's centre alike. Heights
 * grow too, as far as the roof lets them (`pacedHeight`).
 *
 * The roof and the air are the sky's, not the ground's. Over ground at
 * `base` m (the fight's origin: a level's own ground under the Range's
 * arena) a jet's fight is staged at the heights it was measured at, in the
 * sky, so it sits that much nearer the ground, by up to `PACE.sink` m;
 * over higher ground than that the rest is bent under the roof like any
 * other height. Lifted whole instead, a perch over Desert Shield's 40 m
 * was bent 34 m nearer its target, and boom and zoom's ace never had the
 * angle to dive.
 */
export function paced(start, pace = 1, base = 0) {
  if (pace === 1 || !start) return start;
  const lift = Math.max(0, base - PACE.sink);
  const at = start.at ? [start.at[0] * pace, pacedHeight(lift + start.at[1] * pace) - base, start.at[2] * pace] : start.at;
  return { ...start, at, speed: (start.speed ?? 55) * pace };
}

/**
 * The fight as a pilot at `pace` sees it. The plans were written in the
 * Spitfire's numbers: zoom until under 55 m/s, open fire inside 130 m, dive
 * when 150 m above. A jet flies the same shapes larger, so its pilot is
 * shown the fight shrunk by its pace, every place and speed alike (angles
 * and seconds are untouched), and flies it as the Spitfire's. `see` takes
 * a flight state, `gun` the gun the pilot thinks with, `arena` the fence,
 * `ground` the ground's height under a place. At pace 1 they hand back what
 * they were given.
 */
export function pilotView(pace = 1) {
  if (pace === 1) return { pace, see: s => s, gun: g => g, arena: a => a, ground: f => f };
  const k = 1 / pace;
  return {
    pace,
    see: s => (s ? { ...s, position: s.position.map(v => v * k), velocity: s.velocity.map(v => v * k) } : s),
    gun: g => ({ ...g, speed: (g.speed ?? 400) * k, reach: (g.reach ?? 600) * k, ...(Number.isFinite(g.range) ? { range: g.range * k } : {}) }),
    arena: a => (a ? { ...a, centre: a.centre.map(v => v * k), radius: a.radius * k } : a),
    ground: f => (x, z) => f(x * pace, z * pace) * k,
  };
}

/** The engines where a pilot holding `input` would have them by now. */
export function primeEngines(plane, input = 1) {
  const s = plane.state;
  plane.setInput('c_PIThrottle', input);
  const q = s.orientation;
  const fx = -(2 * (q.x * q.z + q.w * q.y)), fy = -(2 * (q.y * q.z - q.w * q.x)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const along = s.velocity.x * fx + s.velocity.y * fy + s.velocity.z * fz;
  const rho = 1 - Math.max(0, Math.min(1, s.position.y / 1000));
  for (const engine of plane.lawEngines ?? []) {
    const axis = engine.throttle;
    if (!axis || !engine.roll) continue;
    const x = axis.direction < 0 ? -input : input;
    engine.roll.angle = Math.max(axis.min, Math.min(axis.max, x * axis.max));
    for (let i = 0; i < 400; i++) {
      engine.thrust?.(along, rho);
      engine.advance?.(DUEL_DT, input, true);
    }
  }
}

/** How close a round must pass to strike a fighter (half a Spitfire's span). */
export const HIT_RADIUS = 7;
/** Rounds that bring a fighter down: one a tick is the duel's stream of fire,
 *  so this is most of a second of solid hits. */
export const KILL_HITS = 22;

/**
 * One round of a burst, from one of the two wing guns in turn: each sits
 * `gun.span` metres out on its wing and points `gun.converge` degrees in, so
 * the two streams cross `span / tan(converge)` ahead (the Spitfire's 2.5 m
 * and 1.6 degrees: about 90 m) and part again beyond it. Each leaves at the
 * muzzle speed plus the shooter's own velocity (`round-launch.js`
 * `platformVelocity`), scattered inside a small spread.
 */
export function fireRound(me, gun, rand, side, t, barrel) {
  const { F, U, R } = basis(me.orientation);
  const hand = barrel % 2 === 0 ? 1 : -1;
  const inward = Math.tan((gun.converge ?? 1.6) * DEG) * -hand;
  const a = rand() * 2 * Math.PI, r = Math.sqrt(rand()) * Math.tan(GUN_SPREAD * DEG);
  const d = unit(add(add(F, scale(R, inward)), add(scale(U, Math.sin(a) * r), scale(R, Math.cos(a) * r))));
  const v = add(me.velocity, scale(d, gun.speed));
  const p = add(add(me.position, scale(F, 2)), scale(R, hand * (gun.span ?? 2.5)));
  return { side, t, p, start: p, v, age: 0, done: false, hit: false };
}

/**
 * The parts of a fighter a round can strike, in its own frame (x right, y
 * up, nose -z), metres: the wing, the fuselage and the tailplane as boxes,
 * a Spitfire's proportions. A round has to meet one; passing between the
 * wing and the tail, or over the wing's thin edge, is a miss, as it is
 * against the hull's collision meshes in the world.
 */
export const AIRFRAME = [
  { c: [0, -0.2, -0.6], h: [5.6, 0.22, 1.1] },
  { c: [0, 0.1, 0.4], h: [0.55, 0.65, 4.6] },
  { c: [0, 0.3, 4.4], h: [1.6, 0.12, 0.55] },
  { c: [0, 1.0, 4.5], h: [0.08, 0.8, 0.6] },
];

/** Whether the round's step `a..b` crosses one of `AIRFRAME`'s boxes on
 *  the fighter in `state`. */
export function strikesAirframe(a, b, state) {
  const { F, U, R } = basis(state.orientation);
  const toBody = p => { const d = sub(p, state.position); return [dot(d, R), dot(d, U), -dot(d, F)]; };
  const pa = toBody(a), pb = toBody(b);
  for (const box of AIRFRAME) {
    if (segmentBox(pa, pb, box.c, box.h)) return true;
  }
  return false;
}

function segmentBox(a, b, c, h) {
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i], lo = c[i] - h[i] - a[i], hi = c[i] + h[i] - a[i];
    if (Math.abs(d) < 1e-9) { if (lo > 0 || hi < 0) return false; continue; }
    let u0 = lo / d, u1 = hi / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether the segment a..b passes within `r` of `c`. */
export function segmentNear(a, b, c, r) {
  const ab = sub(b, a), ac = sub(c, a);
  const l2 = Math.max(1e-9, ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]);
  const t = Math.max(0, Math.min(1, (ac[0] * ab[0] + ac[1] * ab[1] + ac[2] * ab[2]) / l2));
  const d = sub(c, add(a, scale(ab, t)));
  return d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < r * r;
}

/** The guns' spread, half-angle in degrees: the cone a burst fills. */
export const GUN_SPREAD = 0.4;

/**
 * The share of a burst that meets a fighter `dist` metres off: the
 * fighter's disc (5 m) against the spread's at that range. Close in, every
 * round; at 300 m, about half.
 */
export function hitShare(dist, radius = 5, spread = GUN_SPREAD) {
  const a = Math.atan2(radius, Math.max(1, dist)) / DEG;
  return Math.min(1, (a / spread) ** 2);
}

/** Hand a pilot's answer to the airframe's four channels. */
export function applyStick(plane, out) {
  plane.setInput('c_PIPitch', out.stick.pitch);
  plane.setInput('c_PIRoll', out.stick.roll);
  plane.setInput('c_PIYaw', out.stick.rudder);
  plane.setInput('c_PIThrottle', out.throttle);
}

/**
 * A lesson's start, in world terms: `origin` is the point the fight is
 * staged over (its ground height in y), each side's `at` is metres from it
 * (y above the ground there).
 */
export function stage(origin, side) {
  return { ...side, at: [origin[0] + side.at[0], origin[1] + side.at[1], origin[2] + side.at[2]] };
}

/** An airframe put exactly where a live one is: `state` holds `stateOf`'s
 *  arrays (`dogfight-flight.js`), the engines run up to `throttle`. */
export function setPlaneState(plane, state, throttle = 1) {
  const s = plane.state;
  s.position.set(...state.position);
  s.velocity.set(...state.velocity);
  const o = state.orientation;
  s.orientation.set(o.x, o.y, o.z, o.w);
  s.angularVelocity?.set?.(...(state.angularVelocity ?? [0, 0, 0]));
  primeEngines(plane, throttle);
  return plane;
}

/**
 * Fly a duel: `sides` is two `{ plan, start, skill }`, `makePlane(side, i)`
 * builds an airframe. A side may start from a live airframe instead
 * (`state`, with `throttle`), and may hold a fixed `stick` (`{ pitch, roll,
 * rudder, throttle }`, guns quiet) in place of a plan: the live fight's
 * "show me" flies both from the frozen moment. Returns each side's track (one sample a tick), the phase
 * changes with what the pilot said, and the seconds each side had a firing
 * solution while its trigger was down ("hits": rounds that would land).
 * The fight ends at `seconds`, or a moment after one side has been on target
 * for `killAfter` seconds in all, or one hits the ground.
 */
export function runDuel({ makePlane, sides, seconds = 60, origin = [0, 0, 0], groundAt = () => origin[1],
                          gun = {}, killHits = KILL_HITS, dt = DUEL_DT, arena = null }) {
  const fitted = [];
  const planes = sides.map((side, i) => {
    const plane = makePlane(side, i);
    fitted[i] = fitAirframe(plane, makePlane, i);
    plane.groundHeight = (x, z) => groundAt(x, z);
    return plane;
  });
  // Each staged at its own pace, as the live fight stages them
  // (`dogfight-live.js`, features/dogfight-lessons-jets).
  sides.forEach((side, i) => {
    if (side.state) setPlaneState(planes[i], side.state, side.throttle ?? 1);
    else placePlane(planes[i], stage(origin, paced(side.start, fitted[i].pace, origin[1])));
  });
  // An airframe paced as a jet fights with its own cannon, and its pilot
  // sees the fight at the Spitfire's size (`pilotView`).
  const guns = sides.map((_, i) => gunOf(fitted[i].gun ?? gun));
  const views = sides.map((_, i) => pilotView(fitted[i].pace));
  const pilots = sides.map((side, i) => createPilot(side.plan ?? 'cruiser', { skill: side.skill ?? 1, gun: views[i].gun(fitted[i].gun ?? gun), seed: i + 1 }));
  const grounds = views.map(v => v.ground(groundAt));
  const fences = views.map(v => v.arena(arena));
  // A copy of each memory: a pilot writes into his, and two duels flown on
  // from one frozen moment must not share one.
  for (const [i, side] of sides.entries()) Object.assign(pilots[i].mem, structuredClone(side.memory ?? {}));
  const tracks = [[], []];
  const events = [];
  const onTarget = [0, 0];
  const hits = [0, 0];
  const rounds = [];
  let rng = 0x2545f491;
  const rand = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
  const lastPhase = ['', ''];
  let end = null;
  const ticks = Math.round(seconds / dt);
  for (let n = 0; n <= ticks; n++) {
    const t = n * dt;
    const states = planes.map(p => stateOf(p.state));
    for (let i = 0; i < 2; i++) {
      const me = states[i], him = states[1 - i];
      const held = sides[i].stick;
      const out = held
        ? { stick: { pitch: held.pitch ?? 0, roll: held.roll ?? 0, rudder: held.rudder ?? 0 }, throttle: held.throttle ?? 1,
            fire: false, phase: 'hold', say: 'Holding the stick where it is', move: 'Holding on', intent: 'setup' }
        : pilots[i].step({ me: views[i].see(me), him: views[i].see(him), dt, t, groundAt: grounds[i], ceilingBase: 0, arena: fences[i], pace: fitted[i].pace });
      applyStick(planes[i], out);
      const sol = gunSolution(me, him, { ...guns[i], width: 5 });
      const hit = out.fire && sol.fire;
      if (hit) onTarget[i] += dt * hitShare(sol.dist);
      if (out.fire) rounds.push(fireRound(me, guns[i], rand, i, t, n));
      tracks[i].push({
        t, p: me.position, q: [me.orientation.x, me.orientation.y, me.orientation.z, me.orientation.w],
        v: len(me.velocity), ph: out.phase, f: out.fire, h: hit,
        e: energyHeight(me.position[1] - origin[1], len(me.velocity)),
        stick: [out.stick.pitch, out.stick.roll, out.stick.rudder, out.throttle],
        // What he is trying to do, and whether his guns have the other on:
        // `o` a shot that lands (the nose on the lead, inside the reach),
        // `z` the kill zone round it (inside the reach, within 8 degrees),
        // `so` / `sd` how far off the lead and how far away.
        in: out.intent, o: sol.fire, z: sol.dist < guns[i].range && sol.off < 8,
        so: Math.round(sol.off * 10) / 10, sd: Math.round(sol.dist),
        // The propeller's engine revs (`Aircraft.rotorEngine`), which the
        // theatre turns the blades on; null for an airframe with none.
        rv: planes[i].rotorEngine ? Math.round(planes[i].rotorEngine.revs * 1000) / 1000 : null,
        // Whether his eyes have the other plane this tick (1), or he is
        // flying on where he last saw him (0): "he has lost you".
        sees: out.sees === false ? 0 : 1,
      });
      if (out.phase !== lastPhase[i]) {
        events.push({ t, side: i, phase: out.phase, say: out.say, move: out.move, intent: out.intent });
        lastPhase[i] = out.phase;
      }
      if (end === null && hits[i] >= killHits) {
        end = { t, winner: i, why: 'shot down' };
        events.push({ t, side: i, phase: 'kill', say: 'Enough rounds on him to bring him down', move: out.move });
      }
      if (end === null && me.position[1] - groundAt(me.position[0], me.position[2]) < 3) {
        end = { t, winner: 1 - i, why: 'flew into the ground' };
      }
    }
    if (end && t > end.t + 2.5) break;
    for (const p of planes) p.integrate(dt);
    // The rounds in the air fly a tick and meet whoever they pass within
    // a fighter's reach of.
    const after = planes.map(p => stateOf(p.state));
    for (const r of rounds) {
      if (r.done) continue;
      const from = r.p;
      r.p = [from[0] + r.v[0] * dt, from[1] + r.v[1] * dt, from[2] + r.v[2] * dt];
      r.age += dt;
      const target = after[1 - r.side];
      if (segmentNear(from, r.p, target.position, HIT_RADIUS) && strikesAirframe(from, r.p, target)) {
        r.done = true; r.hit = true; r.hitT = t + dt; r.hitAt = r.p;
        if (end === null) hits[r.side]++;
      } else if (r.age > (guns[r.side].reach ?? 600) / guns[r.side].speed) {
        r.done = true;
      }
    }
  }
  // Where each airframe and pilot ended, to fly on from (`state`, `memory`).
  return { tracks, events, onTarget: onTarget.map(v => +v.toFixed(2)), hits, rounds, end, dt, fits: fitted,
           finals: planes.map(p => stateOf(p.state)), mems: pilots.map(p => p.mem) };
}
