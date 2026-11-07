// The dogfight school's ring courses (features/dogfight-school): stick and
// rudder drills with nobody shooting. Each course is a manoeuvre the school's
// hands fly first on the real airframe (`aircraft.js`, the BF1942 flight
// law): a break turn each way, a climbing turn, a wingover, a loop, a split-S,
// a run of reversals. Rings are dropped along the path it flew, so every ring
// is one the Spitfire can reach. The player flies through them against the
// clock; the guide points at the next one.
//
// Pure apart from the airframe it is handed: the tests fly every course in
// node and steer a pilot through its rings (`tests/test_dogfight_school.py`).

import { G, stateOf, pointNose, pullLift, bankAndPull, hardTurn, basis, bankOf, dot, sub, add, scale, unit, len, clamp } from './dogfight-flight.js';
import { placePlane, stage, applyStick, DUEL_DT } from './dogfight-duel.js';

/** A ring's radius, metres: a Spitfire's span (11.3 m) with room either
 *  side, generous enough for a mouse. */
export const RING_RADIUS = 12;
/** The share of full stick the hands fly the courses on. A path flown at the
 *  airframe's limit can never be caught from outside it (no turn is
 *  tighter), so the courses keep a reserve for the pilot catching up. */
export const RESERVE = 0.85;

const DEG = Math.PI / 180;
const flat = v => unit([v[0], 0, v[2]]);
const yawOf = v => Math.atan2(v[0], -v[2]);

/**
 * The courses, easiest first. `start` is metres above the floor's middle,
 * a heading and a speed; `steps` are the hands' segments in order, each
 * flown until it says it is done; `every` is the seconds between rings.
 */
export const COURSES = [
  {
    id: 'break-turns', title: 'Break turns', every: 0.75,
    tagline: 'A hard turn right, then reverse into a hard turn left.',
    tip: 'Roll to about 80 degrees, then pull all the way and hold it. Ease the bank if the nose drops.',
    keys: ['Mouse', 'Arrows'],
    start: { at: [0, 300, 0], headingDeg: 0, speed: 62 },
    steps: [['level', 1.2], ['turn', 1, 180], ['turn', -1, 180], ['level', 1.5]],
  },
  {
    id: 'climbing-turn', title: 'Climbing turn', every: 0.75,
    tagline: 'Turn round while you trade speed for height: the chandelle.',
    tip: 'Bank less, about 55 degrees, and keep pulling. Arrive at the top slow but pointing the other way.',
    keys: ['Mouse', 'Arrows', 'W'],
    start: { at: [0, 250, 0], headingDeg: 0, speed: 82 },
    steps: [['level', 1.2], ['climbTurn', -1, 180], ['level', 1.5]],
  },
  {
    id: 'reversals', title: 'Reversals', every: 0.6,
    tagline: 'Roll from one hard bank to the other, again and again: the scissors\' hands.',
    tip: 'Roll fast, pull only once the wings are over. The rings come quickly.',
    keys: ['Mouse', 'Arrows'],
    start: { at: [0, 300, 0], headingDeg: 0, speed: 60 },
    steps: [['level', 1.2], ['bank', 70, 2.4], ['bank', -70, 2.4], ['bank', 70, 2.4], ['bank', -70, 2.4], ['level', 1.5]],
  },
  {
    id: 'wingover', title: 'Wingover', every: 0.75,
    tagline: 'Climb steep, let the speed die, and let the nose fall round the other way.',
    tip: 'Pull up to about 45 degrees. As the speed goes, roll right to the vertical and let the nose fall round and through the horizon, pointing back.',
    keys: ['Mouse', 'Arrows'],
    start: { at: [0, 250, 0], headingDeg: 0, speed: 78 },
    steps: [['level', 1.2], ['climb', 45, 50], ['fallRound', 1, 170], ['level', 2]],
  },
  {
    id: 'loop', title: 'Loop', every: 0.7,
    tagline: 'Pull straight up and over, all the way round.',
    tip: 'Start fast, wings level, and pull all the way. Keep the wings level over the top; look for the horizon.',
    keys: ['Mouse', 'Arrows', 'W'],
    start: { at: [0, 220, 0], headingDeg: 0, speed: 92 },
    steps: [['level', 1.2], ['loop', 1, 345], ['level', 1.5]],
  },
  {
    id: 'split-s', title: 'Split-S', every: 0.7,
    tagline: 'Roll upside down and pull through: down and back the way you came.',
    tip: 'Start high. Roll inverted, then pull all the way until the horizon comes back level.',
    keys: ['Mouse', 'Arrows', 'S'],
    start: { at: [0, 520, 0], headingDeg: 0, speed: 58 },
    steps: [['level', 1.2], ['roll', 180], ['loop', -1, 170], ['level', 2]],
  },
];

export const courseById = id => COURSES.find(c => c.id === id) ?? null;

/**
 * Fly a course's hands on an airframe from its start, staged over `origin`
 * (its ground in y). Returns the path (a sample a tick: position, the nose's
 * quaternion, speed, stick) and the rings dropped on it: each a position,
 * the direction of flight through it, and the second it comes at.
 */
export function flyCourse(course, makePlane, { origin = [0, 0, 0], groundAt = () => origin[1], dt = DUEL_DT, seconds = 60 } = {}) {
  const plane = makePlane();
  plane.groundHeight = (x, z) => groundAt(x, z);
  placePlane(plane, stage(origin, course.start));
  const h0 = flat(basis(stateOf(plane.state).orientation).F);
  const track = [];
  let step = 0, since = 0, mem = { turned: 0, lastYaw: null, phi: null, lastPhi: null };
  for (let n = 0; n * dt <= seconds && step < course.steps.length; n++) {
    const s = stateOf(plane.state);
    const out = hands(course.steps[step], s, mem, since, h0);
    if (out.done) {
      step++;
      since = 0;
      mem = { turned: 0, lastYaw: null, phi: null, lastPhi: null };
      n--;
      continue;
    }
    applyStick(plane, out);
    track.push({ t: track.length * dt, seg: step, p: s.position, q: [s.orientation.x, s.orientation.y, s.orientation.z, s.orientation.w],
                 v: len(s.velocity), dir: unit(s.velocity), stick: [out.stick.pitch, out.stick.roll, out.stick.rudder, out.throttle] });
    plane.integrate(dt);
    since += dt;
  }
  const rings = [];
  for (let t = 1.2 + course.every; t < track.length * dt - 0.3; t += course.every) {
    const k = track[Math.round(t / dt)];
    rings.push({ p: k.p, dir: k.dir, t: +t.toFixed(2), throttle: k.stick[3] });
  }
  const low = Math.min(...track.map(k => k.p[1] - groundAt(k.p[0], k.p[2])));
  return { course, h0, track, rings, dt, complete: step >= course.steps.length, seconds: +(track.length * dt).toFixed(1), low: Math.round(low),
           slowest: Math.round(Math.min(...track.map(k => k.v))) };
}

/** One segment's stick, or `{ done }` when it has flown its part. */
function hands(seg, s, mem, since, h0, boost = 0) {
  const [kind, a, b] = seg;
  const P = clamp(RESERVE + boost, 0, 1);
  const { F } = basis(s.orientation);
  const go = (stick, throttle = 1) => ({ stick: { pitch: stick.pitch, roll: stick.roll, rudder: stick.rudder }, throttle });
  // The heading turned so far, unwrapped.
  const yaw = yawOf(flat(F));
  if (mem.lastYaw !== null) {
    let d = yaw - mem.lastYaw;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    mem.turned += d;
  }
  mem.lastYaw = yaw;
  const turned = Math.abs(mem.turned) / DEG;
  switch (kind) {
    case 'level': {
      if (since >= a) return { done: true };
      return go(pointNose(s, flat(F), { fine: 12 }));
    }
    case 'turn': {
      if (turned >= b) return { done: true };
      return go(hardTurn(s, a, { pull: P }));
    }
    case 'climbTurn': {
      if (turned >= b) return { done: true };
      return go(hardTurn(s, a, { climb: 9, maxBank: 58, pull: P }));
    }
    case 'bank': {
      if (since >= b) return { done: true };
      return go(bankAndPull(s, a, 0.8 * P));
    }
    case 'climb': {
      // Nose up to `a` degrees, held until the speed is down to `b`.
      if (len(s.velocity) <= b || since > 8) return { done: true };
      const dir = add(scale(flat(F), Math.cos(a * DEG)), [0, Math.sin(a * DEG), 0]);
      return go(pointNose(s, dir, { fine: 8 }));
    }
    case 'fallRound': {
      // Rolled to the vertical with a light pull: the nose falls round
      // sideways to the other way. Done once it points back and down.
      if (turned >= b && F[1] < 0) return { done: true };
      return go(bankAndPull(s, a * 85, 0.45), 0.8);
    }
    case 'roll': {
      if (Math.abs(bankOf(s.orientation).bank) >= a - 12) return { done: true };
      return go(bankAndPull(s, a, 0));
    }
    case 'loop': {
      // In the vertical plane of the start's heading: `a` +1 pulls up and
      // over, -1 (from inverted) pulls down and through; done when the nose
      // has come `b` degrees round.
      const phi = Math.atan2(F[1], dot(F, h0));
      if (mem.lastPhi !== null) {
        let d = phi - mem.lastPhi;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        mem.phi += d;
      } else mem.phi = 0;
      mem.lastPhi = phi;
      if (Math.abs(mem.phi) / DEG >= b) return { done: true };
      const p = phi + a * Math.PI / 2;
      const centre = add(scale(h0, Math.cos(p)), [0, Math.sin(p), 0]);
      return go(pullLift(s, centre, P));
    }
    default:
      return { done: true };
  }
}

/**
 * The stick that flies the course from where the airframe is: the school's
 * hands for the part of the course you are on (a hard turn, a loop...),
 * flown from your own state, with more pull when the path lies on the lift
 * side and, well off the path, a turn back toward it a little ahead. The
 * guide shows it and the instructor flies it. `mem` keeps the place along
 * the path and the hands' own memory; `dt` is the time since the last call.
 */
export function steerCourse(state, flown, mem = {}, dt = flown.dt) {
  const { track, course, h0 } = flown;
  let j = mem.j ?? 0, best = Infinity;
  for (let i = Math.max(0, j - 15); i < Math.min(track.length, j + 90); i++) {
    const d = len(sub(track[i].p, state.position));
    if (d < best) { best = d; j = i; }
  }
  mem.j = j;
  const k = track[j];
  if (mem.seg !== k.seg) { mem.seg = k.seg; mem.hands = { turned: 0, lastYaw: null, phi: null, lastPhi: null }; mem.since = 0; }
  mem.since = (mem.since ?? 0) + dt;
  const { U } = basis(state.orientation);
  const v = len(state.velocity);
  const dir = v > 1 ? scale(state.velocity, 1 / v) : k.dir;
  let e = sub(k.p, state.position);
  e = sub(e, scale(dir, dot(e, dir)));
  const boost = clamp(dot(e, U) * 0.06, -0.4, 1 - RESERVE);
  const out = hands(course.steps[k.seg], state, mem.hands, mem.since, h0, boost);
  let stick = out.stick ?? { pitch: k.stick[0], roll: k.stick[1], rudder: k.stick[2] };
  const w = clamp((best - 5) / 20, 0, 0.7);
  if (w > 0) {
    const ahead = track[Math.min(track.length - 1, j + Math.round(0.6 / flown.dt))];
    const fix = pointNose(state, sub(ahead.p, state.position), { fine: 8 });
    stick = { pitch: stick.pitch + (fix.pitch - stick.pitch) * w, roll: stick.roll + (fix.roll - stick.roll) * w,
              rudder: stick.rudder + (fix.rudder - stick.rudder) * w };
  }
  return { stick, throttle: out.throttle ?? k.stick[3], off: best, done: j >= track.length - 1 };
}

/**
 * Whether the move from `a` to `b` (positions) crossed the ring's plane
 * going its way: null if not, else how far from its middle, metres.
 */
export function crossing(ring, a, b) {
  const da = dot(sub(a, ring.p), ring.dir), db = dot(sub(b, ring.p), ring.dir);
  if (!(da < 0 && db >= 0)) return null;
  const f = da / (da - db);
  const at = add(a, scale(sub(b, a), f));
  return len(sub(at, ring.p));
}

/**
 * Fly a course with `steerCourse` from its start, or from a start moved by
 * `nudge` (metres, and m/s on the speed), the way a pilot follows a guide:
 * `lag` ticks late and `gain` as hard. How many rings it threads: the
 * tests hold every course to it.
 */
export function threadCourse(course, flown, makePlane, { origin = [0, 0, 0], groundAt = () => origin[1], dt = DUEL_DT,
                                                       nudge = [0, 0, 0, 0], lag = 0, gain = 1 } = {}) {
  const plane = makePlane();
  plane.groundHeight = (x, z) => groundAt(x, z);
  const st = course.start;
  placePlane(plane, stage(origin, { ...st, at: [st.at[0] + nudge[0], st.at[1] + nudge[1], st.at[2] + nudge[2]], speed: st.speed + nudge[3] }));
  const rings = flown.rings;
  let i = 0, hits = 0, misses = 0, worst = 0, away = 0, best = Infinity;
  const mem = {};
  const queue = [];
  for (let n = 0; n * dt < 90 && i < rings.length; n++) {
    const a = stateOf(plane.state);
    queue.push(steerCourse(a, flown, mem));
    const out = queue.length > lag ? queue.shift() : queue[0];
    applyStick(plane, { stick: { pitch: out.stick.pitch * gain, roll: out.stick.roll * gain, rudder: out.stick.rudder * gain }, throttle: out.throttle });
    plane.integrate(dt);
    const b = stateOf(plane.state);
    const off = crossing(rings[i], a.position, b.position);
    const d = len(sub(rings[i].p, b.position));
    best = Math.min(best, d);
    away = d > best + 30 ? away + dt : 0;
    if (off !== null || away > 2) {
      if (off !== null && off <= RING_RADIUS) { hits++; worst = Math.max(worst, off); } else misses++;
      i++;
      best = Infinity;
      away = 0;
    }
  }
  return { hits, misses, rings: rings.length, worst: +worst.toFixed(1) };
}
