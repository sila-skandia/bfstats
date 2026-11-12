// The dogfight school's flying hands (features/dogfight-school): the stick a
// skilled pilot moves, worked out from where he wants the nose to go. Pure
// functions of an aircraft's state, so the school's pilots, its theatre and
// its tests fly the same hands.
//
// A pilot does not steer a fighter the way a car is steered. He rolls the
// wings until the lift points where he wants to go (the "lift vector"), then
// pulls. `pointNose` is that: roll the lift onto the wanted direction, pull
// toward it, and near it let the rudder and the elevator do the fine work, so
// the nose settles on a gun solution instead of rolling about it.
//
// The retail bot's plane law (`bot-vehicle-air.js` `towardsDirection`, AI-60)
// caps the climb at a third of the way to vertical and never rolls past the
// horizon, which is why it cannot loop, zoom or split-S. Nothing here is the
// engine's: it is the school's own pilot (INVENTION), flying the engine's
// airframe through the same four channels a human has.
//
// Frames are the viewer's: x right, y up, a body's nose is -z. A state is
// `{ position: [x, y, z], velocity: [x, y, z], orientation: {x, y, z, w},
// angularVelocity: [x, y, z] }` (world). The stick is the drivetrain's signs:
// `pitch` negative pulls the nose up, `roll` positive lowers the right wing,
// `rudder` positive yaws the nose right (measured on the Spitfire's own
// tables, features/dogfight-school "The stick's signs").

import { GRAVITY as RIGID_GRAVITY } from './rigid-body.js';

/**
 * What the hands know of the airframe they fly. They were tuned on the
 * school's Spitfire, whose nose answers the stick in a quarter of a second:
 * its pitch rate is at 63% of what a full pull reaches `HAND.ref` s after
 * the stick goes back. A jet's takes two and a half times as long (the
 * F-16 0.83 s),
 * and a hand that damps for the Spitfire's lag swings a jet's nose through
 * the point it wanted. So an airframe measured laggier than `slack` times
 * the Spitfire carries `state.hand.pitch`, its lag over the Spitfire's, and
 * the pull is damped by that much more (`pointNose`). An airframe with no
 * `hand` is flown as the Spitfire is, to the last decimal.
 *
 * The roll is fitted the same way, from the airframe's own flight
 * (`fitAirframe`). A roll slower to answer than the Spitfire's (0.53 s to
 * 63% of its rate at `speed`) by more than `slack`, as every Forgotten Hope
 * fighter's is (about 1 s, at a third of the Spitfire's rate), carries
 * `hand.roll`, the roll damping times the square of that ratio, `hand.fine`,
 * the cone of small corrective banks widened by it, and `hand.gain`, a
 * lighter hand on all three axes. Without them the hands rolled the lift
 * round a point a few degrees off the nose, past it and back, stop to stop,
 * and a hunter never held its sight on. An airframe whose nose still does
 * not settle on a direction 10 degrees off to one side and 4 below
 * (`noseSettle`: BF1918's Albatros and D.VII, whose roll coasts on past the
 * bank asked for) takes the first of `ROLL_HANDS` under which it does.
 */
export const HAND = Object.freeze({ speed: 100, seconds: 1.5, share: 0.63, ref: 1 / 3, rollRef: 0.53, slack: 1.25 });

/** The engine's gravity (`BasicPhysicsSystem`, 0xC16BAE14 = -14.73f, lnxded
 *  `0x08251e3b`), `rigid-body.js`'s, which `aircraft.js` flies on: the school's
 *  pilots plan on the same number the airframe falls by. */
export const G = -RIGID_GRAVITY;
/** Where every wing stops lifting (`airDensityZeroAtHeight`). */
export const LIFT_CEILING = 1000;
const DEG = Math.PI / 180;

export const clamp = (v, lo = -1, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const unit = a => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
export const angleBetween = (a, b) => Math.acos(clamp(dot(unit(a), unit(b)))) / DEG;

/** `q` applied to `v` (a unit quaternion's rotation). */
export function rotate(q, v) {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z,
          iz * w + iw * -z + ix * -y - iy * -x];
}

/** The airframe's nose, top and right wing, world unit vectors. */
export function basis(q) {
  return { F: rotate(q, [0, 0, -1]), U: rotate(q, [0, 1, 0]), R: rotate(q, [1, 0, 0]) };
}

/** Body rates in the pilot's words, rad/s: nose up, right wing down, nose
 *  right are positive. `w` is the world angular velocity. */
export function bodyRates(q, w) {
  const { F, U, R } = basis(q);
  return { pitch: dot(w, R), roll: dot(w, F), yaw: -dot(w, U) };
}

/** Height plus the height the speed would buy in a zoom: the one number an
 *  energy fighter watches (specific energy over g, metres). */
export const energyHeight = (y, speed) => y + speed * speed / (2 * G);

/** The bank, degrees, right wing down positive, and whether he is inverted. */
export function bankOf(q) {
  const { F, U, R } = basis(q);
  const lvlR = unit(cross(F, [0, 1, 0]));
  const b = Math.atan2(-dot(R, [0, 1, 0]), dot(U, [0, 1, 0])) / DEG;
  return { bank: b, inverted: U[1] < 0, levelRight: lvlR };
}

/** The nose's elevation above the horizon, degrees. */
export const pitchOf = q => Math.asin(clamp(rotate(q, [0, 0, -1])[1])) / DEG;

/**
 * The stick that puts the nose on `dir` (a world direction): roll the lift
 * onto it, pull toward it, and inside `fine` degrees track it with the
 * elevator and rudder while easing the wings toward `upright` (the
 * horizon's up, or any other lift direction to settle on).
 *
 * `pull` caps the elevator (1 = full aft), `push` how far forward it may go
 * (BF1942 has no g limit, but negative g gives the target the belly), `gain`
 * scales the whole response.
 */
export function pointNose(state, dir, opts = {}) {
  const { pull = 1, push = 0.3, upright = [0, 1, 0], rollGain = 2.4 } = opts;
  const fine = (opts.fine ?? 10) * (state.hand?.fine ?? 1);
  // An airframe whose roll coasts on past the bank it was asked for (its
  // `hand.roll`, `hand.gain`, fitted by `fitAirframe` from how its nose
  // settles) is rolled with that much more damping and a lighter hand.
  const gain = opts.gain ?? 1;
  // The roll hand's lighter touch is the roll's: the pull keeps its gain.
  const rollHand = gain * (state.hand?.gain ?? 1);
  const rollDamp = (opts.rollDamp ?? 0.6) * (state.hand?.roll ?? 1);
  const q = state.orientation;
  const { F, U, R } = basis(q);
  const rates = bodyRates(q, state.angularVelocity);
  const D = unit(dir);
  const fd = dot(F, D), ud = dot(U, D), rd = dot(R, D);
  const off = Math.acos(clamp(fd)) / DEG;
  // Where the lift should point: at the wanted direction when it is well off
  // the nose, settling toward `upright` as it comes onto it.
  const toward = Math.atan2(rd, ud);
  const ux = dot(R, upright), uy = dot(U, upright);
  const level = Math.abs(ux) + Math.abs(uy) > 1e-6 ? Math.atan2(ux, uy) : 0;
  const w = smooth(fine * 0.4, fine * 1.6, off);
  // Near the target the wings bank by the sideways error, the way a pilot
  // walks the sight across with small rolls, instead of rolling the lift
  // round a point that keeps jumping sides.
  const sideErr = Math.atan2(rd, fd);
  const pitchErr = Math.atan2(ud, fd);
  const mem = opts.mem;
  if (mem) {
    // A slow integral of the fine errors: the trim the airframe wants.
    const dt = opts.dt ?? 1 / 30;
    const near = off < fine;
    if (!Number.isFinite(mem.iP)) mem.iP = 0;
    if (!Number.isFinite(mem.iS)) mem.iS = 0;
    mem.iP = near ? clamp((mem.iP ?? 0) + pitchErr * dt, -0.25, 0.25) : (mem.iP ?? 0) * 0.95;
    mem.iS = near ? clamp((mem.iS ?? 0) + sideErr * dt, -0.25, 0.25) : (mem.iS ?? 0) * 0.95;
  }
  const { kBank = 2.5, kBankI = 0, kPitchI = 2.0, kPitch = 2.5 } = opts;
  const fineBank = clamp(kBank * sideErr + kBankI * (mem?.iS ?? 0), -70 * DEG, 70 * DEG);
  const rollErr = w * toward + (1 - w) * (level + fineBank);
  const roll = clamp(rollHand * (rollGain * rollErr - rollDamp * rates.roll));
  // The pull: the angle to the target in the plane of the wings' lift, less
  // the pitch rate already under way. Rolling a long way first, the pull
  // waits (a pilot unloads, rolls, then pulls).
  const rollingFirst = clamp(1 - Math.max(0, Math.abs(toward) / DEG - 60) / 60, 0.15, 1);
  // The pitch rate under way is taken off the pull, by more on an airframe
  // whose nose is slower to answer (`HAND`): it will coast further.
  const lag = state.hand?.pitch ?? 1;
  let up = (pitchErr > 0 ? kPitch : kPitch * 0.75) * pitchErr + kPitchI * (mem?.iP ?? 0) - 0.55 * lag * rates.pitch;
  if (off > fine * 1.6) up = Math.max(up, 0) * rollingFirst + Math.min(up, 0) * rollingFirst;
  up = clamp(up * gain, -push, pull);
  // The rudder trims the last few degrees sideways.
  const rudder = off < fine * 2 ? clamp(rollHand * (2.4 * sideErr + 2 * (mem?.iS ?? 0) - 0.4 * rates.yaw)) : clamp(-0.3 * rates.yaw);
  return { pitch: -up, roll, rudder, off };
}

/** The roll stick for a bank error's push (`want`) less the roll rate's
 *  damping (`damp`), through the airframe's roll hand (`HAND`): a slow
 *  roller's roll damped `hand.roll` times as hard and handled `hand.gain`
 *  as lightly, or it rolls past the bank asked for, on into a dive (the
 *  Thach weave's 80-degree turns went inverted on FHSW's Yak 9). */
function rollStick(state, want, damp) {
  const h = state.hand;
  return clamp((h?.gain ?? 1) * (want - damp * (h?.roll ?? 1)));
}

/**
 * Roll the lift onto `liftDir` (a world direction, taken square to the nose)
 * and hold `pull` of aft stick: a loop, a break turn, the pull of a yo-yo.
 */
export function pullLift(state, liftDir, pull = 1, { rollGain = 2.4, rollDamp = 0.32 } = {}) {
  const q = state.orientation;
  const { F, U, R } = basis(q);
  const rates = bodyRates(q, state.angularVelocity);
  const L = sub(liftDir, scale(F, dot(liftDir, F)));
  const ang = len(L) > 1e-6 ? Math.atan2(dot(R, L), dot(U, L)) : 0;
  const roll = rollStick(state, rollGain * ang, rollDamp * rates.roll);
  const ready = clamp(1 - Math.max(0, Math.abs(ang) / DEG - 45) / 60, 0.1, 1);
  return { pitch: -clamp(pull * ready, -1, 1), roll, rudder: clamp(-0.3 * rates.yaw), off: 0 };
}

/**
 * Hold a bank (degrees, right wing down positive) and an amount of aft
 * stick: the turn a pilot flies by the horizon, not by a point.
 */
export function bankAndPull(state, bankDeg, pull = 1, { rollGain = 2.6, rollDamp = 0.5 } = {}) {
  const q = state.orientation;
  const rates = bodyRates(q, state.angularVelocity);
  let err = bankDeg - bankOf(q).bank;
  if (err > 180) err -= 360;
  if (err < -180) err += 360;
  const roll = rollStick(state, rollGain * err * DEG, rollDamp * rates.roll);
  // Rolling a long way first, the pull waits.
  const ready = clamp(1 - Math.max(0, Math.abs(err) - 30) / 60, 0.2, 1);
  return { pitch: -clamp(pull * ready, -1, 1), roll, rudder: clamp(-0.3 * rates.yaw), off: Math.abs(err) };
}

/** The hardest level turn: full aft stick, the bank eased off the vertical
 *  by the sink so the height holds. `side` is +1 right, -1 left; `climb`
 *  (m/s) asks the turn to climb (or, negative, to dive) as it goes. */
export function hardTurn(state, side, { climb = 0, pull = 1, maxBank = 82 } = {}) {
  const vy = state.velocity[1];
  const bank = clamp(maxBank - 2.5 * Math.max(0, climb - vy) + 1.5 * Math.max(0, vy - climb), 45, 92);
  return bankAndPull(state, side * bank, pull);
}

/** The direction of `liftDir` taken square to the nose: what a pull would
 *  turn the nose toward. */
export function liftToward(state, target) {
  const { F } = basis(state.orientation);
  const d = sub(target, state.position);
  return unit(sub(d, scale(F, dot(d, F))));
}

/**
 * The lead a gun needs: where to put the nose so a round fired now at
 * `speed` (plus the shooter's own speed along the nose) meets a target
 * moving at its present velocity, falling at `gravity`. Two passes of the
 * time of flight are enough at gun ranges.
 */
export function leadPoint(shooter, target, { speed = 400, gravity = 0, accel = null } = {}) {
  // The round leaves with the shooter's own velocity on top of the muzzle's
  // (`round-launch.js` `addRootSpeed`), so the sum is relative: the target's
  // motion less the shooter's, at the muzzle speed. A turning target's
  // acceleration (`accel`, world m/s^2) bends the lead round his turn.
  const rel = sub(target.position, shooter.position);
  const rv = sub(target.velocity, shooter.velocity);
  const a = accel ?? [0, 0, 0];
  let t = len(rel) / speed;
  let aim = rel;
  for (let i = 0; i < 4; i++) {
    aim = add(add(add(rel, scale(rv, t)), scale(a, 0.5 * t * t)), [0, 0.5 * gravity * t * t, 0]);
    t = len(aim) / speed;
  }
  return add(shooter.position, aim);
}

/** Whether a burst now would hit: the nose within a target's width of the
 *  lead point, inside the gun's reach. */
export function gunSolution(shooter, target, { speed = 400, gravity = 0, range = 350, width = 6, accel = null } = {}) {
  const lp = leadPoint(shooter, target, { speed, gravity, accel });
  const d = sub(lp, shooter.position);
  const dist = len(d);
  const { F } = basis(shooter.orientation);
  const off = Math.acos(clamp(dot(F, unit(d)))) / DEG;
  const tolerance = Math.max(1.2, Math.atan2(width, Math.max(1, dist)) / DEG);
  return { lead: lp, off, dist, fire: dist < range && off < tolerance, tolerance };
}

function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** An aircraft state in this module's shape from a drive's (`Aircraft.state`:
 *  three.js vectors and a quaternion). */
export function stateOf(s) {
  if (!s) return null;
  return {
    position: [s.position.x, s.position.y, s.position.z],
    velocity: [s.velocity.x, s.velocity.y, s.velocity.z],
    orientation: { x: s.orientation.x, y: s.orientation.y, z: s.orientation.z, w: s.orientation.w },
    angularVelocity: s.angularVelocity ? [s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z] : [0, 0, 0],
    // What the hands know of this airframe (`HAND`), where it was fitted.
    ...(s.hand ? { hand: s.hand } : {}),
  };
}
