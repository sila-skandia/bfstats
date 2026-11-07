// Two of the school's pilots flown against each other on the engine's own
// airframes (features/dogfight-school): the theatre's reconstructions and the
// tests' duels. `makePlane()` hands back an airframe with the `Aircraft`
// surface (`state`, `setInput`, `integrate`, `lawEngines`); nothing here
// draws.

import { createPilot } from './dogfight-pilot.js';
import { stateOf, gunSolution, energyHeight, len, rotate, basis, add, sub, scale, unit, dot } from './dogfight-flight.js';

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
function fireRound(me, gun, rand, side, t, barrel) {
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
function segmentNear(a, b, c, r) {
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
  const planes = sides.map((side, i) => {
    const plane = makePlane(side, i);
    plane.groundHeight = (x, z) => groundAt(x, z);
    if (side.state) setPlaneState(plane, side.state, side.throttle ?? 1);
    else placePlane(plane, stage(origin, side.start));
    return plane;
  });
  const pilots = sides.map((side, i) => createPilot(side.plan ?? 'cruiser', { skill: side.skill ?? 1, gun, seed: i + 1 }));
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
  const g = pilots[0].gun;
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
        : pilots[i].step({ me, him, dt, t, groundAt, ceilingBase: 0, arena });
      applyStick(planes[i], out);
      const sol = gunSolution(me, him, { ...pilots[i].gun, width: 5 });
      const hit = out.fire && sol.fire;
      if (hit) onTarget[i] += dt * hitShare(sol.dist);
      if (out.fire) rounds.push(fireRound(me, g, rand, i, t, n));
      tracks[i].push({
        t, p: me.position, q: [me.orientation.x, me.orientation.y, me.orientation.z, me.orientation.w],
        v: len(me.velocity), ph: out.phase, f: out.fire, h: hit,
        e: energyHeight(me.position[1] - origin[1], len(me.velocity)),
        stick: [out.stick.pitch, out.stick.roll, out.stick.rudder, out.throttle],
        // What he is trying to do, and whether his guns have the other on:
        // `o` a shot that lands (the nose on the lead, inside the reach),
        // `z` the kill zone round it (inside the reach, within 8 degrees),
        // `so` / `sd` how far off the lead and how far away.
        in: out.intent, o: sol.fire, z: sol.dist < pilots[i].gun.range && sol.off < 8,
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
      } else if (r.age > (g.reach ?? 600) / g.speed) {
        r.done = true;
      }
    }
  }
  // Where each airframe and pilot ended, to fly on from (`state`, `memory`).
  return { tracks, events, onTarget: onTarget.map(v => +v.toFixed(2)), hits, rounds, end, dt,
           finals: planes.map(p => stateOf(p.state)), mems: pilots.map(p => p.mem) };
}
