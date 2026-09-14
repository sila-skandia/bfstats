// Flies `viewer/flight.js` outside a browser and prints one JSON blob.
//
// Same shape as `physics_harness.mjs` and `collision_harness.mjs`, with one
// difference they do not have: `flight.js` imports three.js, so it cannot just
// be copied next to the harness and run. `tests/test_flight.py` stands the
// vendored `three.module.js` up as a one-file package under `node_modules` and
// mirrors `vendor/loaders/` beside the module, which is enough to import it
// unmodified. Nothing here touches a renderer, a canvas or the DOM — the
// cockpit fetch is switched off with `{cockpit: false}` and the rest of the
// module is arithmetic on `Object3D`s.
//
// The aircraft is built from the Corsair surface table in
// flight-model.md section 8 rather than from a map glb, for the same reason
// `physics_harness` builds its own terrain: the extracted scenes are not in the
// repository, and the table *is* the data those scenes carry. The rig extras
// are shaped exactly as `ObjectTemplate.rig()` emits them (bf42/con.py), so
// `advanceSurfaces` rate-limits the elevator over its real 60 deg/s and the
// stick reaches full deflection in the time the config says it does.

import * as THREE from 'three';
import { Aircraft, CORSAIR, VehicleCamera, findVehicle } from './flight.mjs';

const DEG = 180 / Math.PI;
const DT = 1 / 60;

/**
 * The Corsair's input-driven surfaces: node, hinge axis, range, servo rate,
 * `sign(setAcceleration)` and the player input. [data, flight-model.md s8]
 */
const SURFACES = [
  ['CorsairFlapLeftOuter', 'pitch', -30, 30, 120, -1, 'c_PIRoll'],
  ['CorsairFlapRightOuter', 'pitch', -30, 30, 120, 1, 'c_PIRoll'],
  ['CorsairFlapTailLeft', 'pitch', -10, 20, 60, -1, 'c_PIPitch'],
  ['CorsairFlapTailRight', 'pitch', -10, 20, 60, -1, 'c_PIPitch'],
  ['CorsairRudder', 'pitch', -15, 15, 60, 1, 'c_PIYaw'],
];

/** A vehicle root shaped the way `extract_map.py` leaves one in the glb. */
function corsairNode() {
  const root = new THREE.Object3D();
  root.name = 'Corsair';
  root.userData = { control: 'Corsair', templateKind: 'PlayerControlObject' };
  const camera = new THREE.Object3D();
  camera.name = 'CorsairCamera';
  camera.position.set(0.028, 1.202, 0.04);
  camera.userData = { templateKind: 'Camera', cameraView: 'CVMInside' };
  root.add(camera);
  for (const [name, axis, min, max, maxSpeed, direction, input] of SURFACES) {
    const node = new THREE.Object3D();
    node.name = name;
    node.userData = {
      rig: {
        control: 'Corsair',
        automaticReset: true,
        axes: {
          [axis]: { input, min, max, free: false, driver: 'position', maxSpeed, direction },
        },
      },
    };
    root.add(node);
  }
  return root;
}

/**
 * An aircraft in the air, trimmed to a state rather than flown into one, so a
 * scenario measures the model and not the hundred seconds before it.
 */
function aircraft({ speed = 0, pitch = 0, altitude = 500, throttle = 1,
                    ground = 0 } = {}) {
  const plane = new Aircraft(corsairNode(), null, { cockpit: false });
  plane.groundHeight = () => ground;
  const s = plane.state;
  s.position.set(0, altitude, 0);
  s.orientation.setFromEuler(new THREE.Euler(pitch, 0, 0, 'XYZ'));
  s.velocity.copy(new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation))
    .multiplyScalar(speed);
  s.throttle = throttle;
  plane.setInput('c_PIThrottle', throttle);
  return plane;
}

const forwardOf = plane =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(plane.state.orientation);
const upOf = plane =>
  new THREE.Vector3(0, 1, 0).applyQuaternion(plane.state.orientation);

/** Nose elevation above the horizon, degrees. */
const noseDeg = plane =>
  Math.asin(Math.max(-1, Math.min(1, forwardOf(plane).y))) * DEG;

/** Flight-path elevation above the horizon, degrees. */
function pathDeg(plane) {
  const v = plane.state.velocity;
  return v.length() < 1e-6 ? 0 : Math.asin(Math.max(-1, Math.min(1, v.y / v.length()))) * DEG;
}

/**
 * The signed angle from the nose to the flight path, over +-180 degrees.
 *
 * Read with `atan2` on purpose: this is the number that says whether an
 * aircraft is flying backwards, and an `asin` folds at 90 and cannot.
 */
function alphaDeg(plane) {
  const s = plane.state;
  const speed = s.velocity.length();
  if (speed < 1e-6) return 0;
  const flow = s.velocity.clone().divideScalar(speed);
  return Math.atan2(-flow.dot(upOf(plane)), flow.dot(forwardOf(plane))) * DEG;
}

/** Airspeed resolved along the nose. Negative means tail-first. */
const alongOf = plane => plane.state.velocity.dot(forwardOf(plane));

const round = (value, places = 3) => +value.toFixed(places);

function snapshot(plane) {
  const s = plane.state;
  return {
    speed: round(s.velocity.length()),
    vy: round(s.velocity.y),
    y: round(s.position.y),
    nose: round(noseDeg(plane)),
    path: round(pathDeg(plane)),
    alpha: round(alphaDeg(plane)),
    along: round(alongOf(plane)),
  };
}

/**
 * Step the model, with an optional per-frame pilot.
 *
 * The pilot is a function of the aircraft, called before each tick, which is
 * where a scenario that needs an attitude held puts the stick work. Everything
 * else passes a constant input map, or nothing at all for hands-off.
 */
function fly(plane, seconds, pilot) {
  plane.clock = plane.clock ?? 0;
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    if (typeof pilot === 'function') pilot(plane, plane.clock);
    plane.integrate(DT);
    plane.clock += DT;
  }
  return plane;
}

/** Hold a stick position for the duration. */
const holding = inputs => plane => {
  for (const [name, value] of Object.entries(inputs)) plane.setInput(name, value);
};

/**
 * A proportional elevator that holds the nose at a given elevation.
 *
 * Needed for exactly one measurement: terminal velocity. An aircraft with a
 * lift regulator cannot hold a vertical dive hands-off — 9.82 m/s^2 along a
 * horizontal body-up curves the flight path out of it — so `g / drag` is only
 * observable with somebody holding the dive, which is also how it would be
 * measured in the game.
 */
const holdingNose = (target, throttle = 0) => plane => {
  const error = noseDeg(plane) - target;
  plane.setInput('c_PIPitch', Math.max(-1, Math.min(1, error * 0.05)));
  plane.setInput('c_PIThrottle', throttle);
};

/**
 * The same, on the flight path rather than the nose.
 *
 * dfe5bb9 measured its climb against a path angle, which is the only reading
 * the steady-state solution is written in — the two were the same number then
 * because the flight path was welded to the nose, and they are not now.
 */
const holdingPath = (target, throttle = 1) => plane => {
  const error = pathDeg(plane) - target;
  plane.setInput('c_PIPitch', Math.max(-1, Math.min(1, error * 0.08)));
  plane.setInput('c_PIThrottle', throttle);
};

const results = {};

// --- the constants ---------------------------------------------------------

results.constants = {
  gravity: CORSAIR.gravity,
  thrust: CORSAIR.thrust,
  drag: CORSAIR.drag,
  thrustFadeSpeed: CORSAIR.thrustFadeSpeed,
  regulateToLift: CORSAIR.regulateToLift,
  regulatorSpeed: CORSAIR.regulatorSpeed,
  incidence: CORSAIR.incidence,
  liftSlope: CORSAIR.liftSlope,
  aoaClamp: CORSAIR.aoaClamp,
  rollRate: CORSAIR.rollRate,
  pitchRate: CORSAIR.pitchRate,
  yawRate: CORSAIR.yawRate,
  weathervane: CORSAIR.weathervane,
  weathervaneYaw: CORSAIR.weathervaneYaw,
  slipDamp: CORSAIR.slipDamp,
};

// The two solved speeds, so a constant that moves without its calibration
// moving with it is caught here rather than in a flight test's error bar.
// flight-model.md section 9a: thrust fade against linear drag, and gravity
// against linear drag.
results.solved = {
  // 15 x (1 - v/70) = 0.0652 v
  cruise: round(CORSAIR.thrust
    / (CORSAIR.thrust / CORSAIR.thrustFadeSpeed + CORSAIR.drag)),
  // g / drag
  terminal: round(CORSAIR.gravity / CORSAIR.drag),
  // Lift at the solved cruise with the nose on the flight path: the regulator
  // pair plus the incidence term, which the calibration makes exactly g.
  liftAtCruise: round(CORSAIR.regulateToLift * 2
    + CORSAIR.liftSlope * (CORSAIR.incidence / DEG) * 53.6676),
  // Where the regulator servo runs out of its +-2 degrees.
  regulatorSaturation: round(CORSAIR.regulatorSpeed),
  // The closure the restoring moment is calibrated against (section 9d): full
  // elevator at cruise must trim to exactly the angle `aoaClamp` saturates at,
  // which is the angle section 9a sized that clamp for. If either constant
  // moves without the other, this stops being `aoaClamp`.
  fullStickTrim: round((CORSAIR.pitchRate / DEG) / CORSAIR.weathervane, 4),
};

// --- the rig still drives -------------------------------------------------

{
  const plane = aircraft({ speed: 53.67 });
  // Part-way through the servo travel, so the rate limit is visible rather than
  // only its endpoint: a slammed stick is not an instant control moment.
  //
  // Recorded rather than predicted, because the rate is not the one the config
  // declares. `advanceSurfaces` keys a deflection on control/input/axis, and
  // the Corsair's two elevators share all three, so each of them steps the one
  // shared entry and it travels at twice the declared 60 deg/s. Pre-existing,
  // unrelated to the flight model, and left alone here; this line is what would
  // notice if it were fixed.
  fly(plane, 1 / 12, holding({ c_PIPitch: -1, c_PIRoll: 1 }));
  const partial = Object.fromEntries(
    [...plane.state.surfaces].map(([key, value]) => [key, round(value)]));
  fly(plane, 1, holding({ c_PIPitch: -1, c_PIRoll: 1 }));
  // Discovery reads `templateKind` and the `spawners` ancestor, so hang the
  // vehicle where the map exporter hangs it.
  const spawners = new THREE.Group();
  spawners.name = 'spawners';
  spawners.add(corsairNode());
  results.rig = {
    parts: plane.parts.length,
    partial,
    surfaces: Object.fromEntries(
      [...plane.state.surfaces].map(([key, value]) => [key, round(value)])),
    hasCamera: !!plane.cameraNode,
    found: findVehicle(spawners, 'Corsair')?.userData?.control ?? null,
  };
}

// --- level flight ----------------------------------------------------------

// dfe5bb9's headline measurement: 148 m held for 40 s at 53.7 m/s, vy -0.06.
{
  const plane = aircraft({ speed: 53.6676, altitude: 148 });
  const start = plane.state.position.y;
  let low = start, high = start;
  for (let i = 0; i < 40 * 60; i++) {
    plane.integrate(DT);
    low = Math.min(low, plane.state.position.y);
    high = Math.max(high, plane.state.position.y);
  }
  results.levelFlight = {
    ...snapshot(plane),
    drift: round(plane.state.position.y - start),
    band: round(high - low),
  };
}

// Two minutes, to catch a phugoid that only diverges slowly.
{
  const plane = aircraft({ speed: 53.6676, altitude: 1000 });
  let low = 1000, high = 1000;
  for (let i = 0; i < 120 * 60; i++) {
    plane.integrate(DT);
    low = Math.min(low, plane.state.position.y);
    high = Math.max(high, plane.state.position.y);
  }
  results.levelFlightLong = { ...snapshot(plane), low: round(low), high: round(high) };
}

// Knocked off trim by 3 m/s of sink: what follows must decay, not grow. A
// model with the flight path welded to the nose passes this trivially because
// the perturbation is deleted on the next frame; one with a divergent long
// period fails it.
{
  const plane = aircraft({ speed: 53.6676, altitude: 1000 });
  plane.state.velocity.y -= 3;
  const sink = [];
  let worst = 0;
  for (let i = 0; i < 180 * 60; i++) {
    plane.integrate(DT);
    worst = Math.max(worst, Math.abs(plane.state.velocity.y));
    if ((i + 1) % (20 * 60) === 0) sink.push(round(plane.state.velocity.y));
  }
  results.phugoid = { sink, worst: round(worst), final: snapshot(plane) };
}

// dfe5bb9's other steady state: a 15 degree climb, which it measured at
// 10.1 m/s and 40.3 m/s against a solution of 10.36 and 40.0. Excess thrust
// along an inclined path, no gravity in the level cruise it starts from:
// 15 (1 - v/70) - 0.0652 v = g sin 15  ->  v = 40.03, vy = 10.36.
{
  const plane = aircraft({ speed: 53.6676, altitude: 1000 });
  fly(plane, 90, holdingPath(15, 1));
  results.climb = {
    ...snapshot(plane),
    solvedSpeed: round(
      (CORSAIR.thrust - CORSAIR.gravity * Math.sin(15 / DEG))
      / (CORSAIR.thrust / CORSAIR.thrustFadeSpeed + CORSAIR.drag)),
  };
}

// --- sink: what happens when it runs out of speed ---------------------------

// Hands off, wings level, nose level, from each entry speed. The aircraft may
// only hold altitude at the one speed the calibration solves for; below it the
// lift deficit has to show up as a descent.
results.sink = [];
for (const speed of [53.6676, 45, 35, 25, 20, 16.7, 12.4, 8]) {
  for (const throttle of [0, 1]) {
    const plane = aircraft({ speed, altitude: 2000, throttle });
    const start = plane.state.position.y;
    fly(plane, 10, holding({ c_PIThrottle: throttle }));
    results.sink.push({
      entry: round(speed, 2),
      throttle,
      drop: round(start - plane.state.position.y),
      ...snapshot(plane),
    });
  }
}

// The lift the model makes at a speed, nose on the flight path, against the
// 14.7295 it has to find. This is the stall curve as a table rather than as a
// flown outcome, so a regression in the speed law is visible directly.
results.liftCurve = [];
for (const speed of [60, 53.6676, 40, 30, 20, 12.4, 10, 5, 2]) {
  const regulated = 2 * CORSAIR.regulateToLift * Math.min(1, speed / CORSAIR.regulatorSpeed);
  const passive = CORSAIR.liftSlope * (CORSAIR.incidence / DEG) * speed;
  const maxAlpha = CORSAIR.liftSlope * CORSAIR.aoaClamp * speed;
  results.liftCurve.push({
    speed: round(speed, 2),
    trimmed: round(regulated + passive),
    ceiling: round(regulated + maxAlpha),
  });
}

// --- the hard pull ---------------------------------------------------------

// Full back stick from cruise until it runs out of energy, then hands off. The
// nose must come back to the flight path and the aircraft must end up flying,
// rather than hanging on a vertical fuselage climbing at a metre a second,
// which is what dfe5bb9's report recorded and could not account for.
for (const [name, throttle] of [['hardPull', 1], ['hardPullIdle', 0]]) {
  const plane = aircraft({ speed: 53.6676, altitude: 3000, throttle });
  const track = [];
  let peakNose = -90, recoveredAt = null, apex = 3000;
  for (let i = 0; i < 90 * 60; i++) {
    plane.setInput('c_PIPitch', i < 4 * 60 ? -1 : 0);
    plane.setInput('c_PIThrottle', throttle);
    plane.integrate(DT);
    plane.clock = (plane.clock ?? 0) + DT;
    peakNose = Math.max(peakNose, noseDeg(plane));
    apex = Math.max(apex, plane.state.position.y);
    // Recovered: stick long released, nose back near the flight path, and
    // enough airspeed to be flying rather than falling.
    if (recoveredAt === null && plane.clock > 5
      && Math.abs(alphaDeg(plane)) < 10 && plane.state.velocity.length() > 30) {
      recoveredAt = round(plane.clock - 4, 2);
    }
    if (i % (5 * 60) === 0) track.push(snapshot(plane));
  }
  results[name] = {
    peakNose: round(peakNose),
    apex: round(apex),
    recoveredAt,
    end: snapshot(plane),
    track,
  };
}

// A sustained pull from cruise, sampled every half second: how fast the flight
// path comes round, how far the nose leads it, and what that costs in speed.
// The nose lead is the number the calibration predicts — full elevator should
// trim the angle of attack to `aoaClamp` and no further.
{
  const plane = aircraft({ speed: 53.6676, altitude: 4000 });
  const pull = [];
  let path = 0;
  for (let i = 0; i < 4 * 60; i++) {
    const before = pathDeg(plane);
    plane.setInput('c_PIPitch', -1);
    plane.integrate(DT);
    path = (pathDeg(plane) - before) / DT;
    if ((i + 1) % 30 === 0) {
      pull.push({ pathRate: round(path, 1), lead: round(alphaDeg(plane), 2), ...snapshot(plane) });
    }
  }
  results.sustainedPull = pull;
}

// --- does the nose follow the flight path ----------------------------------

// The restoring moment, measured on its own rather than through a manoeuvre.
// The nose is rotated off the flight path without touching the velocity — a
// stick cannot produce that state cleanly, because the lift it makes on the
// way curves the path too — and then the aircraft is left alone. The angle has
// to close. With no pitch-restoring moment in the model it simply sits there,
// which is the third leg of the reported bug.
results.noseTracking = [];
for (const [axis, offset, speed, throttle] of [
  ['pitch', 25, 53.6676, 1], ['pitch', -25, 53.6676, 1], ['yaw', 20, 53.6676, 1],
  // The one that matters for the stall, and it reads differently. At cruise the
  // wing can whip the flight path up to meet the nose in a fraction of a
  // second, so a fast convergence there does not by itself prove a restoring
  // moment exists. At 15 m/s with the throttle shut there is no lift to do that
  // with: the flight path runs away downward faster than anything can follow,
  // the angle gets worse before it gets better, and the only thing that can
  // ever close it is the nose itself travelling. Watch `noseEnd`.
  ['pitch', 40, 15, 0],
]) {
  const plane = aircraft({ speed, altitude: 4000, throttle });
  plane.setInput('c_PIThrottle', throttle);
  const radians = offset / DEG;
  plane.state.orientation.multiply(new THREE.Quaternion().setFromEuler(
    axis === 'pitch' ? new THREE.Euler(radians, 0, 0) : new THREE.Euler(0, radians, 0)));
  const measure = axis === 'pitch'
    ? () => alphaDeg(plane)
    : () => {
      const s = plane.state;
      const flow = s.velocity.clone().divideScalar(s.velocity.length());
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(s.orientation);
      return Math.atan2(flow.dot(right), flow.dot(forwardOf(plane))) * DEG;
    };
  const start = round(measure());
  const noseStart = round(noseDeg(plane));
  const decay = [];
  let halfLife = null, settledWorst = 0;
  for (let i = 0; i < 10 * 60; i++) {
    plane.integrate(DT);
    const angle = Math.abs(measure());
    if (halfLife === null && angle < Math.abs(start) / 2) halfLife = round((i + 1) * DT, 2);
    // Once it has converged once, does it stay converged? Sampled from two
    // seconds on, which is past every transient in these four cases.
    if (i > 2 * 60) settledWorst = Math.max(settledWorst, angle);
    if ((i + 1) % 30 === 0 && decay.length < 12) decay.push(round(measure(), 2));
  }
  results.noseTracking.push({
    axis, speed: round(speed, 2), start, halfLife, decay,
    settled: round(measure(), 2),
    settledWorst: round(settledWorst),
    // Which end moved. A restoring moment shows up as the nose travelling; the
    // wing pulling the flight path round shows up as it not.
    noseStart, noseEnd: round(noseDeg(plane)),
  });
}

// --- backward flight -------------------------------------------------------

// Launched tail-first, hands off. There must be no resting state here: the
// aircraft has to turn around and fly, or fall out of the sky nose-first.
{
  const plane = aircraft({ speed: 0, altitude: 4000, throttle: 0 });
  plane.setInput('c_PIThrottle', 0);
  plane.state.velocity.set(0, 0, 30);   // nose is -Z, so this is pure tail-first
  let turnedAt = null, backwardTicks = 0;
  const track = [];
  for (let i = 0; i < 30 * 60; i++) {
    plane.integrate(DT);
    plane.clock = (plane.clock ?? 0) + DT;
    if (alongOf(plane) < 0) backwardTicks++;
    else if (turnedAt === null) turnedAt = round(plane.clock, 2);
    if (i % (5 * 60) === 0) track.push(snapshot(plane));
  }
  results.tailFirst = {
    turnedAt,
    backwardSeconds: round(backwardTicks * DT, 2),
    end: snapshot(plane),
    track,
  };
}

// Held full back stick for half a minute, which is how a player gets there:
// pull until the speed is gone, keep pulling. The nose-to-path angle must
// never settle past 90 degrees.
{
  const plane = aircraft({ speed: 53.6676, altitude: 6000 });
  let worstAlong = Infinity, backwardTicks = 0, worstAlpha = 0;
  for (let i = 0; i < 60 * 60; i++) {
    plane.setInput('c_PIPitch', -1);
    plane.integrate(DT);
    const along = alongOf(plane);
    worstAlong = Math.min(worstAlong, along);
    worstAlpha = Math.max(worstAlpha, Math.abs(alphaDeg(plane)));
    if (along < 0) backwardTicks++;
  }
  results.heldPull = {
    worstAlong: round(worstAlong),
    worstAlpha: round(worstAlpha),
    backwardSeconds: round(backwardTicks * DT, 2),
    end: snapshot(plane),
  };
}

// Dropped from rest, nose up, no airspeed at all — the classic way into a
// tail-slide, and the case an `asin` angle of attack reads as zero.
{
  const plane = aircraft({ speed: 0, pitch: Math.PI / 2, altitude: 4000, throttle: 0 });
  plane.setInput('c_PIThrottle', 0);
  let backwardTicks = 0, turnedAt = null;
  for (let i = 0; i < 40 * 60; i++) {
    plane.integrate(DT);
    plane.clock = (plane.clock ?? 0) + DT;
    if (alongOf(plane) < 0) backwardTicks++;
    else if (turnedAt === null && plane.clock > 1) turnedAt = round(plane.clock, 2);
  }
  results.tailSlide = {
    turnedAt,
    backwardSeconds: round(backwardTicks * DT, 2),
    end: snapshot(plane),
  };
}

// --- terminal dive ---------------------------------------------------------

{
  const plane = aircraft({ speed: 150, pitch: -Math.PI / 2, altitude: 60000, throttle: 0 });
  plane.groundHeight = () => -Infinity;
  let peak = 0;
  for (let i = 0; i < 120 * 60; i++) {
    holdingNose(-90, 0)(plane);
    plane.integrate(DT);
    peak = Math.max(peak, plane.state.velocity.length());
  }
  results.terminalDive = { peak: round(peak), end: snapshot(plane) };
}

// Hands off from the same dive entry, which is a different question and worth
// recording: an aircraft whose regulator makes 9.82 along body-up cannot stay
// in a vertical dive, and pulls out of it on its own.
{
  const plane = aircraft({ speed: 150, pitch: -Math.PI / 2, altitude: 20000, throttle: 0 });
  plane.setInput('c_PIThrottle', 0);
  fly(plane, 60);
  results.diveRecovery = snapshot(plane);
}

// --- takeoff ---------------------------------------------------------------

// Parked on the strip, full throttle, rotate at 40 m/s, hold the climb to 120 m
// and then fly level. The aircraft must unstick, stay unstuck, and not arrive
// back on the ground.
{
  const plane = aircraft({ speed: 0, altitude: 1.2, throttle: 0, ground: 0 });
  plane.state.throttle = 0;
  let unstuckAt = null, unstuckSpeed = null, groundedAfterUnstick = 0;
  const track = [];
  for (let i = 0; i < 90 * 60; i++) {
    const t = i * DT;
    const speed = plane.state.velocity.length();
    plane.setInput('c_PIThrottle', 1);
    // Rotate at 40, then stop pulling once the climb is established: an
    // elevator held to the stop indefinitely is a prop-hang, not a takeoff.
    plane.setInput('c_PIPitch',
      speed > 40 && plane.state.position.y < 120 ? -0.6
        : noseDeg(plane) > 4 ? 0.25 : 0);
    plane.integrate(DT);
    if (unstuckAt === null && plane.state.position.y > 3) {
      unstuckAt = round(t, 2);
      unstuckSpeed = round(speed);
    } else if (unstuckAt !== null && plane.state.grounded) {
      groundedAfterUnstick++;
    }
    if (i % (10 * 60) === 0) track.push(snapshot(plane));
  }
  results.takeoff = {
    unstuckAt, unstuckSpeed, groundedAfterUnstick,
    end: snapshot(plane),
    track,
  };
}

// --- roll, which the change must not have touched --------------------------

results.roll = {};
for (const [name, stick] of [['left', -1], ['right', 1]]) {
  const plane = aircraft({ speed: 53.6676, altitude: 2000 });
  fly(plane, 1, holding({ c_PIRoll: stick }));
  const before = plane.state.orientation.clone();
  // Quarter of a second, because the geodesic angle between two quaternions
  // folds at 180 and a full second at 190 deg/s is past it.
  fly(plane, 0.25, holding({ c_PIRoll: stick }));
  const delta = before.invert().multiply(plane.state.orientation);
  results.roll[name] = {
    // Full-stick roll rate at cruise, deg/s. dfe5bb9 measured 191 either way.
    rate: round(4 * 2 * Math.acos(Math.min(1, Math.abs(delta.w))) * DEG),
    commanded: round(Math.abs(plane.state.angularVelocity.z) * DEG),
  };
}

// --- frame rate ------------------------------------------------------------

// `map.html` drives this from `THREE.Clock` clamped at 0.1 s, so the model runs
// at whatever the browser gives it. The restoring moment is a rate applied per
// step, which is exactly the shape of thing that can go unstable on a long
// frame, so hold the same two scenarios at three step sizes.
results.frameRate = [];
for (const dt of [1 / 60, 1 / 30, 0.1]) {
  const level = aircraft({ speed: 53.6676, altitude: 1000 });
  for (let t = 0; t < 40; t += dt) level.integrate(dt);
  const back = aircraft({ speed: 0, altitude: 4000, throttle: 0 });
  back.setInput('c_PIThrottle', 0);
  back.state.velocity.set(0, 0, 30);
  let backwardTicks = 0;
  for (let t = 0; t < 30; t += dt) {
    back.integrate(dt);
    if (alongOf(back) < 0) backwardTicks++;
  }
  results.frameRate.push({
    dt: round(dt, 4),
    levelDrift: round(level.state.position.y - 1000),
    levelSpeed: round(level.state.velocity.length()),
    backwardSeconds: round(backwardTicks * dt, 2),
    tailFirstEnd: snapshot(back),
  });
}

// --- level top speed -------------------------------------------------------

{
  const plane = aircraft({ speed: 20, altitude: 2000, throttle: 1 });
  fly(plane, 120, holdingNose(0, 1));
  results.topSpeed = snapshot(plane);
}

// --- the camera still reads the same state ---------------------------------

{
  const plane = aircraft({ speed: 53.6676, altitude: 300 });
  const camera = new VehicleCamera(plane, { groundHeight: () => 0 });
  fly(plane, 2);
  const cockpit = camera.update(DT);
  camera.setMode('chase');
  fly(plane, 1);
  const chase = camera.update(DT);
  results.camera = {
    cockpitY: round(cockpit.position.y),
    chaseBehind: round(chase.position.clone().sub(plane.state.position).length()),
    modes: camera.mode,
  };
}

process.stdout.write(JSON.stringify(results, null, 2));
