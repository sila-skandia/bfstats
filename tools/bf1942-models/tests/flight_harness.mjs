// Flies the viewer's flight model (`vehicle-base.js`, `aircraft.js`) outside a
// browser and prints one JSON blob.
//
// Same shape as `physics_harness.mjs` and `collision_harness.mjs`, with one
// difference they do not have: the flight model imports three.js, so it cannot just
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
//
// ALTITUDES ARE DELIBERATE AND SMALL. `PhysicsWing::updatePhysics` fades every
// surface's lift to nothing at `airDensityZeroAtHeight` = 1000 m, so a scenario
// staged at 2000 m — as these were before the model was rebuilt on the read
// equations — is a scenario staged where no Refractor aircraft can fly. Nothing
// here starts above 900 m, and the one case that does is the ceiling test.

import * as THREE from 'three';
import { Vehicle } from './vehicle-base.js';
import { Aircraft, CORSAIR, GRAVITY, calculateLift, aircraftSpec } from './aircraft.js';
import { VehicleCamera } from './vehicle-camera.js';
import { findVehicle } from './vehicle-discovery.js';
import { aimAtDirection, helicopterControl, towardsPoint } from './bot-vehicle-air.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { LIFT_ENGINE_ANGLE, clipAngleStep } from './vectored-engines.js';
import { currentRatio, currentTorque } from './engine-revs.js';
import { vehicleTick } from './world-vehicle-tick.js';
import { bufferInput } from './world-input.js';
import { DamageableVehicle } from './vehicle-damage.js';
import { existsSync, readFileSync } from 'node:fs';

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
function aircraft({ speed = 0, pitch = 0, altitude = 200, throttle = 1,
                    ground = -100000 } = {}) {
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

/** Body pitch rate, rad/s, nose-up positive. */
function pitchRate(plane) {
  return plane.state.angularVelocity.clone()
    .applyQuaternion(plane.state.orientation.clone().invert()).x;
}

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
 * Needed for exactly one measurement: terminal velocity, which is only
 * observable with somebody holding the dive, because an aircraft with any lift
 * at all curves out of a vertical one.
 */
const holdingNose = (target, throttle = 0) => plane => {
  const error = noseDeg(plane) - target;
  plane.setInput('c_PIPitch', Math.max(-1, Math.min(1, error * 0.05)));
  plane.setInput('c_PIThrottle', throttle);
};

/**
 * Hold an *altitude*, which is what "level top speed" means once lift fades
 * with height. A nose-holding pilot flies level only by accident; this one
 * keeps the aircraft in the band where its lift and its thrust belong.
 */
const holdingAltitude = (target, throttle = 1) => plane => {
  const s = plane.state;
  const error = (s.position.y - target) * 0.06 + s.velocity.y * 0.35;
  plane.setInput('c_PIPitch', Math.max(-1, Math.min(1, error * 0.09)));
  plane.setInput('c_PIThrottle', throttle);
};

/** The same, on the flight path. */
const holdingPath = (target, throttle = 1) => plane => {
  const error = pathDeg(plane) - target;
  plane.setInput('c_PIPitch', Math.max(-1, Math.min(1, error * 0.08)));
  plane.setInput('c_PIThrottle', throttle);
};

const results = {};

// --- the equation itself ---------------------------------------------------
//
// `calculateLift` is exported, so its three read properties can be asserted
// directly rather than inferred from a flight: the +-45 degree hard cutoff, the
// coefficient peaking at exactly 1.0 at 22.5 degrees, and the speed exponent
// of 2. Nothing downstream can be right if this is wrong.

{
  const up = new THREE.Vector3(0, 1, 0);
  // A surface at `angle` degrees of attack, unit coefficient, and the reading
  // negated because the caller applies `-lift * surfaceUp`: the numbers below
  // are upward acceleration, which is the sign everything else here is in.
  const at = (angle, speed = 1) => {
    const a = angle / DEG;
    return -calculateLift(
      new THREE.Vector3(0, -Math.sin(a), Math.cos(a)).multiplyScalar(speed), up, 1);
  };
  const curve = {};
  for (const angle of [0, 1, 5, 10, 22.5, 30, 44, 44.9, 45, 45.1, 60, 90]) {
    // Divide out the speed^2 x 0.0025, leaving the bare (0.75c + 0.25s).
    curve[angle] = round(at(angle) / 0.0025, 6);
  }
  results.liftEquation = {
    curve,
    // Peak of the 0.75c term is exactly 1.0 at 22.5 degrees, so the whole
    // bracket there is 0.75 + 0.25 sin(22.5).
    peak: round(at(22.5) / 0.0025, 6),
    peakExpected: round(0.75 + 0.25 * Math.sin(22.5 / DEG), 6),
    // The stall, and it is a cliff in the COEFFICIENT rather than in the
    // return: past +-45 degrees `c` is hard zero and only the 0.25 sin term
    // survives, so a surface loses three quarters of its lift in the width of
    // a floating-point step. The residual is what keeps a tumbling aircraft
    // from being weightless.
    justBelow45: round(at(44.9) / 0.0025, 6),
    justAbove45: round(at(45.1) / 0.0025, 6),
    residualExpected: round(0.25 * Math.sin(45.1 / DEG), 6),
    // Small-angle slope per degree: 0.75 x 45/506.25 + 0.25 x pi/180.
    slopePerDegree: round(at(0.001) / 0.0025 / 0.001, 6),
    slopeExpected: round(0.75 * 45 / 506.25 + 0.25 * Math.PI / 180, 6),
    // Speed exponent: doubling the flow must quadruple the acceleration.
    speedRatio: round(at(10, 2) / at(10, 1), 6),
    // Zero flow is zero lift, and the guard is an exact `len == 0`.
    zeroFlow: calculateLift(new THREE.Vector3(), up, 1),
  };
}

// --- the constants ---------------------------------------------------------

results.constants = {
  gravity: GRAVITY,
  specGravity: CORSAIR.gravity,
  mass: CORSAIR.mass,
  drag: CORSAIR.drag,
  inertiaModifier: CORSAIR.inertiaModifier,
  engines: CORSAIR.engines.length,
  differential: CORSAIR.engines[0].differential,
  fadeSpeed: CORSAIR.engines[0].noPropellerEffectAtSpeed,
  surfaces: CORSAIR.surfaces.length,
  // Every constant the retired lumped model carried. They must all be gone:
  // a spec that still answers to any of these is a spec that still has a free
  // parameter where the engine has arithmetic.
  retired: ['thrust', 'thrustFadeSpeed', 'cruiseSpeed', 'liftSlope', 'aoaClamp',
    'rollRate', 'pitchRate', 'yawRate', 'weathervane', 'weathervaneYaw',
    'slipDamp', 'regulateToLift', 'regulatorSpeed', 'incidence']
    .filter(name => name in CORSAIR),
};

{
  // The engine's thrust scalar, assembled from the read pieces, and the two
  // level-flight roots it solves to. `getCurrentRatio` = 3.5 x setDifferential
  // / gearRatioCurve[100], and gearRatioCurve[100] is 0.94 (EngineTemplate
  // ctor, client 0x005715d0).
  const ratio = 3.5 * CORSAIR.engines[0].differential / 0.94;
  const thrustAt = (speed, altitude, throttle = 1) => {
    const rho = 1 - Math.max(0, Math.min(1, altitude / 1000));
    const e = throttle - rho * speed / CORSAIR.engines[0].noPropellerEffectAtSpeed;
    return (0.1 * Math.abs(throttle) + e * Math.abs(e)) * ratio;
  };
  // Thrust against linear drag, solved by bisection because K is a signed
  // square rather than the linear fade the old model used.
  const levelSpeed = altitude => {
    let low = 1, high = 300;
    for (let i = 0; i < 200; i++) {
      const mid = (low + high) / 2;
      if (thrustAt(mid, altitude) > CORSAIR.drag * mid) low = mid; else high = mid;
    }
    return (low + high) / 2;
  };
  results.solved = {
    ratio: round(ratio),
    deck: round(levelSpeed(0)),
    at200: round(levelSpeed(200)),
    // Thrust rises as speed falls, and it is highest standing still: the
    // signed square is +1 at rest and goes negative past the fade speed.
    thrustCurve: [0, 20, 40, 60, 70, 90, 120].map(speed => ({
      speed, accel: round(thrustAt(speed, 0)),
    })),
    // ...and with the throttle shut the propeller is a brake, which is what
    // caps a dive far below the old model's g/drag = 226.
    idleCurve: [20, 50, 70, 100].map(speed => ({
      speed, accel: round(thrustAt(speed, 0, 0)),
    })),
    // The same speed at three heights: `rho` scales only the speed term, so a
    // high propeller does not know how fast it is going and thrust GROWS.
    thrustByAltitude: [0, 300, 600, 1000].map(altitude => ({
      altitude, accel: round(thrustAt(50, altitude)),
    })),
  };
}

// --- the rig still drives -------------------------------------------------

{
  const plane = aircraft({ speed: 50 });
  // Part-way through the servo travel, so the rate limit is visible rather than
  // only its endpoint: a slammed stick is not an instant control moment.
  //
  // And the rates are now the declared ones. `advanceSurfaces` used to key a
  // deflection on control/input/axis and then step it once per *part*, so the
  // Corsair's two elevators — which share all three — drove the one shared
  // entry twice a frame and it travelled at 120 deg/s against its own
  // `setMaxSpeed 60`. Elevator: 60 deg/s over a 20 degree half-range is 3 of
  // normalised travel a second, so 1/12 s is 0.25. Aileron: 120 over 30 is 4,
  // so 1/3. The elevator entry reading 0.5 here is the defect returning.
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
    physicsSurfaces: plane.surfaces.length,
    servos: plane.servoAxes().size,
    elevator: round(partial['Corsair/c_PIPitch/pitch']),
    aileron: round(partial['Corsair/c_PIRoll/pitch']),
    stops: Object.fromEntries(['c_PIPitch', 'c_PIRoll', 'c_PIYaw'].map(input =>
      [input, round(plane.state.surfaces.get(`Corsair/${input}/pitch`) ?? 0)])),
    hasCamera: !!plane.cameraNode,
    found: findVehicle(spawners, 'Corsair')?.userData?.control ?? null,
  };
}

// --- an Engine never spins its own subtree ---------------------------------
//
// `EngineTemplate` derives from `RotationalBundleTemplate`, so a `.con` may
// write `setInputToRoll c_PIThrottle` on an Engine — but the object it creates
// is a `PhysicsEngine` deriving from `PhysicsNode`, which does not inherit
// `RotationalBundle::handleUpdate`. The Engine node is never posed by that
// axis; the propeller is, through two interface queries at the tail of
// `PhysicsEngine::updatePhysics` (`0x0057bfb0`).
//
// So the three cases `assemble.py` distinguishes have to stay distinguished.
// The one that was a live bug on production: a scene extracted before
// `spinsChildren` existed used to fall back to rotating the Engine node, which
// on a Corsair swung the landing gear, both wheels, the tail wheel and the two
// bay hatches around the prop shaft.

{
  const ENGINE_AXIS = {
    roll: { input: 'c_PIThrottle', min: -3000, max: 5000, free: false,
            driver: 'rate', maxSpeed: 500, direction: 1 },
  };
  const build = (extras, stamp = true) => {
    const root = new THREE.Object3D();
    root.name = 'Corsair';
    root.userData = { control: 'Corsair', templateKind: 'PlayerControlObject' };
    const engine = new THREE.Object3D();
    engine.name = 'CorsairEngine';
    engine.userData = { rig: { control: 'Corsair', axes: ENGINE_AXIS }, ...extras };
    for (const [name, spins] of [['lodCorsairPropeller', true],
                                 ['CorsairLandingGearLeft', false]]) {
      const child = new THREE.Object3D();
      child.name = name;
      if (spins && stamp) child.userData = { spinsWithEngine: true };
      engine.add(child);
    }
    root.add(engine);
    const plane = new Aircraft(root, null, { cockpit: false });
    plane.state.propellerAngle = 90;
    plane.applyRig();
    const angle = obj => round(2 * Math.acos(Math.min(1, Math.abs(obj.quaternion.w))) * DEG, 1);
    return {
      spun: plane.parts.find(part => part.node === engine).spun.map(n => n.name),
      engine: angle(engine),
      propeller: angle(engine.getObjectByName('lodCorsairPropeller')),
      gear: angle(engine.getObjectByName('CorsairLandingGearLeft')),
    };
  };
  results.engineSpin = {
    // The field is present and names the propeller: spin exactly that.
    named: build({ spinsChildren: ['lodCorsairPropeller'] }),
    // Present and empty: this Engine reaches no drawn geometry (Willy,
    // KettenKrad, Elco80). Spin nothing — and the empty list is the whole
    // reason that can be told apart from the case below.
    empty: build({ spinsChildren: [] }),
    // No list, but the children carry the older per-child stamp. That is the
    // intermediate asset generation and the stamps are still the right answer.
    stamped: build({}),
    // Neither field: the asset predates both. Spin nothing, which costs a
    // stationary propeller on an old scene and is the only answer that cannot
    // be wrong — the fallback this replaces rotated the Engine node instead,
    // and took nineteen of a Corsair's nodes round with it.
    legacy: build({}, false),
  };
}

// --- the blade mesh gives way to the blurred disc --------------------------
//
// `extras.propellerBlur` (assemble.py's `_propeller_blur`) names both meshes
// and carries the engine's own `addLodComparison` — 0.07 on every vanilla
// propeller — onto the LodObject wrapper. `applyRig` reads it back rather
// than hardcoding a constant, so this is the one place that threshold is
// asserted against the node rather than assumed.

{
  const buildPropeller = () => {
    const root = new THREE.Object3D();
    root.name = 'Corsair';
    root.userData = { control: 'Corsair', templateKind: 'PlayerControlObject' };
    const wrapper = new THREE.Object3D();
    wrapper.name = 'lodCorsairPropeller';
    wrapper.userData = {
      propellerBlur: {
        static: 'CorsairPropellerStatic',
        blurred: 'CorsairPropellerBlurred',
        comparisons: [0.07],
      },
    };
    const blade = new THREE.Object3D();
    blade.name = 'CorsairPropellerStatic';
    const disc = new THREE.Object3D();
    disc.name = 'CorsairPropellerBlurred';
    wrapper.add(blade, disc);
    root.add(wrapper);
    return new Aircraft(root, null, { cockpit: false });
  };

  const visibilityAt = throttle => {
    const plane = buildPropeller();
    plane.state.throttle = throttle;
    plane.applyRig();
    return {
      static: plane.node.getObjectByName('CorsairPropellerStatic').visible,
      blurred: plane.node.getObjectByName('CorsairPropellerBlurred').visible,
    };
  };

  results.propellerBlur = {
    idle: visibilityAt(0),
    belowThreshold: visibilityAt(0.05),
    // Exactly the declared comparison: still the blade, not yet the disc.
    atThreshold: visibilityAt(0.07),
    justAboveThreshold: visibilityAt(0.08),
    fullThrottle: visibilityAt(1),
    // A vehicle without the extras block (an asset extracted before this
    // field existed, or a plain ground vehicle) must collect no pairs at all
    // and cost nothing per frame.
    noExtras: (() => {
      const plane = new Aircraft(corsairNode(), null, { cockpit: false });
      plane.state.throttle = 1;
      plane.applyRig();
      return plane.propellerBlurPairs.length;
    })(),
    // Vanilla's one counter-example to the naming convention: the bf109's
    // *cockpit* LodObject calls its alternatives `bf109CockpitStatic` (the
    // fuselage) and `bf109CockpitBlurred` (the 1P interior), under the
    // `DistCompareSelector` every other cockpit uses. A scene baked before
    // the exporter learned to read the selector carries the stamp anyway, and
    // binding it to the throttle put the pilot outside his own aeroplane
    // below half power. The kind is the gate.
    cockpitNamedLikeAPropeller: (() => {
      const root = new THREE.Object3D();
      root.name = 'BF109';
      root.userData = { control: 'BF109', templateKind: 'PlayerControlObject' };
      const wrapper = new THREE.Object3D();
      wrapper.name = 'lodbf109Cockpit';
      wrapper.userData = {
        propellerBlur: {
          static: 'bf109CockpitStatic',
          blurred: 'bf109CockpitBlurred',
          selectorKind: 'DistCompareSelector',
          distances: [10],
          comparisons: [0.5],
        },
      };
      const exterior = new THREE.Object3D();
      exterior.name = 'bf109CockpitStatic';
      const interior = new THREE.Object3D();
      interior.name = 'bf109CockpitBlurred';
      wrapper.add(exterior, interior);
      root.add(wrapper);
      const plane = new Aircraft(root, null, { cockpit: false });
      plane.state.throttle = 0;
      plane.applyRig();
      return {
        pairs: plane.propellerBlurPairs.length,
        // Untouched by the rig: whatever the cockpit swap set stands.
        exterior: exterior.visible,
        interior: interior.visible,
      };
    })(),
    // A real propeller that declares its kind is still a pair.
    compareSelectorIsStillAPair: (() => {
      const plane = buildPropeller();
      const wrapper = plane.node.getObjectByName('lodCorsairPropeller');
      wrapper.userData.propellerBlur.selectorKind = 'CompareSelector';
      plane.collect();
      return plane.propellerBlurPairs.length;
    })(),
  };
}

// --- what the surface table works out to -----------------------------------
//
// The per-surface coefficients, which are the whole of the aerodynamics now.
// `flapShare` is the finding that tells `setWingLift` and `setFlapLift` apart
// once they have been summed into `coeff`.

{
  const plane = aircraft({ speed: 50 });
  results.surfaceTable = plane.surfaces.map(surface => ({
    id: surface.id,
    coeff: round(surface.coeff),
    flapShare: round(surface.flapShare),
    pitchOffset: surface.pitchOffset,
    apply: [round(surface.apply.x), round(surface.apply.y), round(surface.apply.z)],
    regulates: !!surface.regulateToLift,
  }));
  results.inertia = {
    pitch: round(plane.inertia.x, 0),
    yaw: round(plane.inertia.y, 0),
    roll: round(plane.inertia.z, 0),
  };
}

// --- level top speed, at two heights ---------------------------------------
//
// The corroboration that costs nothing: the AI's authored
// `aiTemplatePlugIn.maxSpeed` for the Corsair is 55.0, and the model is
// supposed to bracket it rather than hit it, because thrust fades with speed
// and the fade is scaled by an air density that thins with height.

results.topSpeed = [];
for (const altitude of [40, 200]) {
  const plane = aircraft({ speed: 30, altitude, throttle: 1 });
  fly(plane, 180, holdingAltitude(altitude, 1));
  results.topSpeed.push({ altitude, ...snapshot(plane) });
}

// --- trim ------------------------------------------------------------------
//
// Hands off at the deck. This is a real equilibrium — it converges from either
// side and holds for four minutes — and it is a shallow powered DESCENT, not
// level flight, because thrust is applied at the propeller hub 0.446 m above
// the centre of mass and the nose-down moment that makes costs about a quarter
// of a degree of trimmed angle of attack.

{
  const plane = aircraft({ speed: 49.4, altitude: 40, throttle: 1 });
  fly(plane, 150, holding({ c_PIThrottle: 1 }));
  const before = snapshot(plane);
  fly(plane, 90, holding({ c_PIThrottle: 1 }));
  results.trim = {
    ...snapshot(plane),
    settled: round(Math.abs(snapshot(plane).vy - before.vy)),
    regulator: round(plane.deflection(plane.surfaces.find(s => s.id === 'regL'))),
  };
}

// How much stick it takes to hold height, and that it is a small amount.
results.levelStick = [];
for (const stick of [0, -0.05, -0.1]) {
  const plane = aircraft({ speed: 49.4, altitude: 400, throttle: 1 });
  const start = plane.state.position.y;
  fly(plane, 30, holding({ c_PIThrottle: 1, c_PIPitch: stick }));
  results.levelStick.push({ stick, drop: round(start - plane.state.position.y), ...snapshot(plane) });
}

// --- the stall, as a curve rather than an outcome --------------------------
//
// The most lift the aircraft can make at a given speed, swept over every angle
// of attack it can reach. `calculateLift`'s coefficient peaks at 22.5 degrees
// and is zero past 45, so this curve has a real maximum — the engine's stall
// model — and where it crosses gravity is the speed below which no stick
// position holds the aircraft up.

results.liftCeiling = [];
for (const speed of [60, 50, 40, 30, 20, 18, 17, 16, 12, 8]) {
  const plane = aircraft({ speed, altitude: 5 });
  let best = -Infinity, bestAlpha = 0;
  for (let alpha = -2; alpha <= 50; alpha += 0.25) {
    plane.state.orientation.setFromEuler(new THREE.Euler(alpha / DEG, 0, 0));
    plane.state.velocity.set(0, 0, -speed);
    plane.state.angularVelocity.set(0, 0, 0);
    // Let the regulator servo find its position at this speed.
    for (let i = 0; i < 120; i++) { plane.regulate(); plane.advanceSurfaces(1 / 120); }
    const lift = plane.surfaces.reduce((total, surface) => {
      const q = new THREE.Quaternion();
      surface.orient(plane.deflection(surface), q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q.premultiply(plane.state.orientation));
      const r = surface.apply.clone().applyQuaternion(plane.state.orientation);
      const raw = calculateLift(plane.state.velocity, up, surface.coeff)
        * plane.medium(plane.state.position.y + r.y);
      return total - Math.max(-200, Math.min(200, raw)) * up.y;
    }, 0);
    if (lift > best) { best = lift; bestAlpha = alpha; }
  }
  results.liftCeiling.push({ speed, maxLift: round(best), atAlpha: round(bestAlpha, 2) });
}

// --- altitude: the 1000 m ceiling ------------------------------------------

results.medium = [];
{
  const plane = aircraft({ speed: 50 });
  for (const y of [0, 250, 500, 900, 1000, 1400]) {
    results.medium.push({ y, medium: round(plane.medium(y), 4) });
  }
  // And submerged, which is the other branch of the same expression.
  plane.waterHeight = 0;
  results.submergedMedium = round(plane.medium(-1), 4);
}

// A full-throttle best-effort climb has to stop short of 1000 m, because that
// is where a Refractor wing stops making lift entirely.
{
  const plane = aircraft({ speed: 49.4, altitude: 40, throttle: 1 });
  let best = 40;
  for (let i = 0; i < 400 * 60; i++) {
    plane.setInput('c_PIThrottle', 1);
    holdingPath(10, 1)(plane);
    plane.integrate(DT);
    best = Math.max(best, plane.state.position.y);
  }
  results.serviceCeiling = { best: round(best), end: snapshot(plane) };
}

// --- the loop --------------------------------------------------------------
//
// The ground truth for this whole change: a retail SBD-T closes a 360 degree
// loop from low level at full throttle in about 11 seconds. A Corsair is a
// fighter and should be quicker. Measured as total BODY pitch travel, because
// a loop is not a change in heading and an attitude angle folds at vertical.

results.loop = [];
for (const [entry, altitude] of [[49.4, 60], [55, 60], [60, 60]]) {
  const plane = aircraft({ speed: entry, altitude, throttle: 1 });
  let travel = 0, closedAt = null, slowest = Infinity, apex = altitude;
  for (let i = 0; i < 30 * 60; i++) {
    plane.setInput('c_PIPitch', -1);
    plane.setInput('c_PIThrottle', 1);
    plane.integrate(DT);
    travel += pitchRate(plane) * DT;
    slowest = Math.min(slowest, plane.state.velocity.length());
    apex = Math.max(apex, plane.state.position.y);
    if (closedAt === null && travel >= 2 * Math.PI) closedAt = round((i + 1) * DT, 2);
  }
  results.loop.push({
    entry, closedAt, slowest: round(slowest), gain: round(apex - altitude),
    // Four loops in thirty seconds means the second one is as good as the
    // first: an aircraft that can only do it once has an energy problem.
    loops: round(travel / (2 * Math.PI), 2),
  });
}

// A sustained pull from cruise, sampled every half second: how fast the flight
// path comes round, how far the nose leads it, and what that costs in speed.
{
  const plane = aircraft({ speed: 49.4, altitude: 300 });
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

// --- roll, which nothing commands any more ---------------------------------
//
// There is no `rollRate` constant. The rate below is the ailerons' own lift on
// their own levers against their own damping, and it has to land in the
// surveyed 180-220 deg/s and be symmetric, because the mirroring is authored
// config (`sign(setAcceleration)`) and a broken sign shows up as one direction
// rolling and the other not.

results.roll = {};
for (const [name, stick] of [['left', -1], ['right', 1]]) {
  const plane = aircraft({ speed: 49.4, altitude: 300 });
  fly(plane, 1.5, holding({ c_PIRoll: stick }));
  const before = plane.state.orientation.clone();
  // Quarter of a second, because the geodesic angle between two quaternions
  // folds at 180 and a full second at 210 deg/s is past it.
  fly(plane, 0.25, holding({ c_PIRoll: stick }));
  const delta = before.invert().multiply(plane.state.orientation);
  results.roll[name] = round(4 * 2 * Math.acos(Math.min(1, Math.abs(delta.w))) * DEG);
}

// --- sink: what happens when it runs out of speed ---------------------------

results.sink = [];
for (const speed of [49.4, 45, 35, 25, 20, 16.7, 12.4, 8]) {
  for (const throttle of [0, 1]) {
    // 150 m, where `medium` is still 0.85. Staged any higher and every entry
    // speed sinks for the same reason — there is no air up there — and the
    // measurement stops being about speed.
    const plane = aircraft({ speed, altitude: 150, throttle });
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

// --- terminal dive ---------------------------------------------------------
//
// Not g/drag any more. Past `setNoPropellerEffectAtSpeed` the signed square
// goes negative and the propeller becomes an airbrake worth several g, so a
// dive tops out far below the 226 m/s the old linear fade allowed.

results.terminalDive = [];
for (const throttle of [0, 1]) {
  // Entered at 900 m and flown straight down through sea level and out the
  // bottom, because the brake is scaled by an air density that thickens as it
  // falls: the terminal speed is an altitude-dependent number and the one
  // worth quoting is the one at the deck.
  const plane = aircraft({ speed: 60, pitch: -Math.PI / 2, altitude: 900, throttle });
  let peak = 0;
  for (let i = 0; i < 60 * 60; i++) {
    holdingNose(-90, throttle)(plane);
    plane.integrate(DT);
    peak = Math.max(peak, plane.state.velocity.length());
  }
  results.terminalDive.push({ throttle, peak: round(peak), end: snapshot(plane) });
}

// Hands off from the same dive entry, which is a different question and worth
// recording: an aircraft that still makes lift cannot stay in a vertical dive.
{
  const plane = aircraft({ speed: 80, pitch: -Math.PI / 2, altitude: 900, throttle: 0 });
  fly(plane, 30, holding({ c_PIThrottle: 0 }));
  results.diveRecovery = snapshot(plane);
}

// --- does the nose follow the flight path ----------------------------------
//
// The restoring moment, measured on its own rather than through a manoeuvre.
// The nose is rotated off the flight path without touching the velocity — a
// stick cannot produce that state cleanly — and then the aircraft is left
// alone. The angle has to close, and it has to close because the NOSE moved.
//
// A per-surface model gets this out of `r x F` over the tail surfaces and
// carries no constant for it. The lumped model it replaces needed two.

results.noseTracking = [];
for (const [axis, offset, speed, throttle] of [
  ['pitch', 25, 49.4, 1], ['pitch', -25, 49.4, 1], ['yaw', 20, 49.4, 1],
  // The one that matters for the stall, and it reads differently. At cruise the
  // wing can whip the flight path up to meet the nose in a fraction of a
  // second, so a fast convergence there does not by itself prove a restoring
  // moment exists. At 15 m/s with the throttle shut there is no lift to do that
  // with: the flight path runs away downward faster than anything can follow,
  // the angle gets worse before it gets better, and the only thing that can
  // ever close it is the nose itself travelling. Watch `noseEnd`.
  ['pitch', 40, 15, 0],
]) {
  const plane = aircraft({ speed, altitude: 400, throttle });
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
  let halfLife = null;
  for (let i = 0; i < 12 * 60; i++) {
    plane.integrate(DT);
    const angle = Math.abs(measure());
    if (halfLife === null && angle < Math.abs(start) / 2) halfLife = round((i + 1) * DT, 2);
    if ((i + 1) % 30 === 0 && decay.length < 12) decay.push(round(measure(), 2));
  }
  results.noseTracking.push({
    axis, speed: round(speed, 2), start, halfLife, decay,
    settled: round(measure(), 2),
    // Which end moved. A restoring moment shows up as the nose travelling; the
    // wing pulling the flight path round shows up as it not.
    noseStart, noseEnd: round(noseDeg(plane)),
  });
}

// --- backward flight -------------------------------------------------------
//
// There must be no resting state here. A tumble through the vertical is
// allowed — that is what a departure looks like — but the aircraft has to come
// out of it flying forwards.

{
  const plane = aircraft({ speed: 0, altitude: 400, throttle: 0 });
  plane.setInput('c_PIThrottle', 0);
  plane.state.velocity.set(0, 0, 30);   // nose is -Z, so this is pure tail-first
  let turnedAt = null;
  const track = [];
  for (let i = 0; i < 30 * 60; i++) {
    plane.integrate(DT);
    plane.clock = (plane.clock ?? 0) + DT;
    if (turnedAt === null && alongOf(plane) > 0) turnedAt = round(plane.clock, 2);
    if (i % (5 * 60) === 0) track.push(snapshot(plane));
  }
  results.tailFirst = { turnedAt, end: snapshot(plane), track };
}

// Held full back stick for two minutes, which is how a player gets there: pull
// until the speed is gone, keep pulling. A Corsair that can loop can hold this
// indefinitely, and must never end up on its back going backwards.
{
  const plane = aircraft({ speed: 49.4, altitude: 300 });
  let worstAlong = Infinity, backwardTicks = 0, worstAlpha = 0;
  for (let i = 0; i < 120 * 60; i++) {
    plane.setInput('c_PIPitch', -1);
    plane.setInput('c_PIThrottle', 1);
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
  const plane = aircraft({ speed: 0, pitch: Math.PI / 2, altitude: 500, throttle: 0 });
  plane.setInput('c_PIThrottle', 0);
  let turnedAt = null, settledForward = 0;
  for (let i = 0; i < 40 * 60; i++) {
    plane.integrate(DT);
    plane.clock = (plane.clock ?? 0) + DT;
    if (turnedAt === null && plane.clock > 1 && alongOf(plane) > 0) turnedAt = round(plane.clock, 2);
    if (i > 25 * 60 && alongOf(plane) > 0) settledForward++;
  }
  results.tailSlide = {
    turnedAt,
    settledForward: round(settledForward / (15 * 60), 3),
    end: snapshot(plane),
  };
}

// The hard pull, then hands off: the departure the retail game shows. An idle
// pull to the vertical must fall out of it and come back flying, not hang on
// the propeller.
for (const [name, throttle] of [['hardPull', 1], ['hardPullIdle', 0]]) {
  const plane = aircraft({ speed: 49.4, altitude: 300, throttle });
  let peakNose = -90, recoveredAt = null;
  for (let i = 0; i < 40 * 60; i++) {
    plane.setInput('c_PIPitch', i < 4 * 60 ? -1 : 0);
    plane.setInput('c_PIThrottle', throttle);
    plane.integrate(DT);
    plane.clock = (plane.clock ?? 0) + DT;
    peakNose = Math.max(peakNose, noseDeg(plane));
    if (recoveredAt === null && plane.clock > 5
      && Math.abs(alphaDeg(plane)) < 10 && plane.state.velocity.length() > 25) {
      recoveredAt = round(plane.clock - 4, 2);
    }
  }
  results[name] = { peakNose: round(peakNose), recoveredAt, end: snapshot(plane) };
}

// --- takeoff ---------------------------------------------------------------

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
    // elevator held to the stop indefinitely is a loop, not a takeoff.
    if (plane.state.position.y < 120) plane.setInput('c_PIPitch', speed > 40 ? -0.6 : 0);
    else holdingAltitude(150, 1)(plane);
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

// --- frame rate ------------------------------------------------------------
//
// `map.html` drives this from `THREE.Clock` clamped at 0.1 s, so the model runs
// at whatever the browser gives it. The sub-step count scales with the frame,
// and the servos run inside it — which is the only reason the trim is the same
// number at all three: the lift regulator is a proportional loop closed through
// a rate-limited servo, and a whole 0.1 s frame lets that servo cross its
// entire +-2 degree range in one step and go bang-bang.

results.frameRate = [];
for (const dt of [1 / 60, 1 / 30, 0.1]) {
  const level = aircraft({ speed: 49.4, altitude: 40, throttle: 1 });
  for (let t = 0; t < 150; t += dt) {
    level.setInput('c_PIThrottle', 1);
    level.integrate(dt);
  }
  const back = aircraft({ speed: 0, altitude: 400, throttle: 0 });
  back.setInput('c_PIThrottle', 0);
  back.state.velocity.set(0, 0, 30);
  let turnedAt = null;
  for (let t = 0; t < 30; t += dt) {
    back.integrate(dt);
    if (turnedAt === null && alongOf(back) > 0) turnedAt = round(t, 2);
  }
  results.frameRate.push({
    dt: round(dt, 4),
    trimSpeed: round(level.state.velocity.length()),
    trimSink: round(level.state.velocity.y),
    trimAlpha: round(alphaDeg(level)),
    turnedAt,
    tailFirstEnd: snapshot(back),
  });
}

// --- the interior is grafted once per node, not once per Vehicle ------------
//
// map.html builds a fresh `Vehicle` on the same node every time a seat is
// retaken, and each one used to fetch `<Control>.cockpit.glb` and graft another
// interior beside the last: 6 geometries and 4 textures per Willys entry, never
// released. `loadAsync` is stood in for here — the same `GLTFLoader` module
// instance `vehicle-base.js` imports — so the real `loadCockpit` path runs with no
// network, and a load is a thing that can be counted.

{
  const disposed = new Set();
  const watch = resource => {
    resource.addEventListener('dispose', () => disposed.add(resource.name));
    return resource;
  };
  const skinned = name => {
    const geometry = watch(new THREE.BufferGeometry());
    geometry.name = `${name}.geometry`;
    const map = watch(new THREE.Texture());
    map.name = `${name}.map`;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map }));
    mesh.name = name;
    return mesh;
  };
  const named = (name, userData = {}, ...children) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.userData = userData;
    node.add(...children);
    return node;
  };

  /** A Willys root the way the map glb leaves one: hosts, and the exterior. */
  const jeep = () => named('Willy', { control: 'Willy' },
    named('lodWillyCockpit', {}, named('WillyCockpitExternal')),
    named('lodWillySteering', {}, named('WillyLowSteering')));

  /** `Willy.cockpit.glb`: two swaps of its own, and one for a seat not flown. */
  const cockpitGlb = () => {
    const wheel = named('WillyHighRSteering', {
      rig: {
        control: 'Willy',
        axes: { roll: { input: 'c_PIYaw', min: -90, max: 90, free: false, driver: 'position', maxSpeed: 900, direction: 1 } },
      },
    }, skinned('1P_Willy_str'));
    return named('cockpit', {},
      named('lodWillyCockpit', {
        control: 'Willy',
        lodAlternative: { selected: 'WillyCockpitInternal', replaces: ['WillyCockpitExternal'] },
      }, named('WillyCockpitInternal', {}, skinned('1P_Willy_Hul'))),
      named('lodWillySteering', {
        control: 'Willy',
        lodAlternative: { selected: 'WillyHighRSteering', replaces: ['WillyLowSteering'] },
      }, wheel),
      named('lodWillyGunner', {
        control: 'WillyGunner',
        lodAlternative: { selected: 'WillyGunnerInternal', replaces: [] },
      }, skinned('1P_Willy_Gun')));
  };

  let loads = 0;
  let failNext = false;
  const realLoadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => {
    loads++;
    await Promise.resolve();
    if (failNext) { failNext = false; throw new Error('net::ERR_FAILED'); }
    return { scene: cockpitGlb() };
  };
  const options = { modelsBase: 'http://cockpit.test/models/' };
  const count = (node, name) => {
    let n = 0;
    node.traverse(obj => { if (obj.name === name) n++; });
    return n;
  };
  const wheelAngle = node => round(
    2 * Math.acos(Math.min(1, Math.abs(node.getObjectByName('WillyHighRSteering').quaternion.w))) * DEG);

  // In, steer hard over, out with the wheel still turned, in again.
  const node = jeep();
  const first = new Vehicle(node, null, options);
  const firstGrafted = !!await first.cockpitReady;
  first.setInput('c_PIYaw', 1);
  first.advanceSurfaces(1);
  first.applyRig();
  const leftAt = wheelAngle(node);
  first.setFirstPerson(false);

  const second = new Vehicle(node, null, options);
  const secondGrafted = !!await second.cockpitReady;
  const loadsForOneNode = loads;
  const partsSecond = second.parts.length;
  second.applyRig();                       // stick centred: the wheel's rest
  const restAt = wheelAngle(node);
  second.setFirstPerson(true);
  const inside = {
    interior: node.getObjectByName('WillyCockpitInternal').visible,
    exterior: node.getObjectByName('WillyCockpitExternal').visible,
  };
  second.setFirstPerson(false);
  const outside = {
    interior: node.getObjectByName('WillyCockpitInternal').visible,
    exterior: node.getObjectByName('WillyCockpitExternal').visible,
  };

  // A seat retaken while the first fetch is still in the air.
  loads = 0;
  const racedNode = jeep();
  const racers = [new Vehicle(racedNode, null, options), new Vehicle(racedNode, null, options)];
  const raced = (await Promise.all(racers.map(v => v.cockpitReady))).map(Boolean);
  const racedLoads = loads;

  // A fetch that failed is not remembered; the next `Vehicle` asks again.
  loads = 0;
  failNext = true;
  const flakyNode = jeep();
  const failed = await new Vehicle(flakyNode, null, options).cockpitReady;
  const retried = !!await new Vehicle(flakyNode, null, options).cockpitReady;

  GLTFLoader.prototype.loadAsync = realLoadAsync;
  results.cockpitGraft = {
    firstGrafted, secondGrafted, loadsForOneNode,
    interiors: count(node, 'WillyCockpitInternal'),
    wheels: count(node, 'WillyHighRSteering'),
    partsSecond, leftAt, restAt, inside, outside,
    raced, racedLoads, racedInteriors: count(racedNode, 'WillyCockpitInternal'),
    failed, retried, flakyLoads: loads, flakyInteriors: count(flakyNode, 'WillyCockpitInternal'),
    disposed: [...disposed].sort(),
  };
}

// --- the camera still reads the same state ---------------------------------

{
  const plane = aircraft({ speed: 49.4, altitude: 300 });
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


// --- the Spitfire, on its own data ------------------------------------------
//
// Until 2026-09-24 every aircraft flew on `CORSAIR`: nothing passed a spec and
// `SPECS` has one entry. `aircraftSpec` now reads a plane's own table off its
// node tree (ledger AI-75). The tree below is the El Alamein Spitfire's, as the
// level glb carries it: the root's `physics`, each `Wing`'s lift pair, offset
// and rig axis, the Engine, a wheel and the fuselage box. Positions are glb
// (z mirrored), rotations the glb quaternions.
function spitfireNode() {
  const root = new THREE.Object3D();
  root.name = 'Spitfire';
  root.userData = { control: 'Spitfire', templateKind: 'PlayerControlObject',
                    physics: { mass: 2500, drag: 0.09, inertiaModifier: [0.85, 0.833, 0.84] } };
  const lod = new THREE.Object3D();
  lod.userData = { templateKind: 'LodObject' };
  const complex = new THREE.Object3D();
  complex.userData = { templateKind: 'Bundle' };
  root.add(lod); lod.add(complex);
  const cockpitLod = new THREE.Object3D();
  cockpitLod.userData = { templateKind: 'LodObject' };
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(11.298, 2.283, 9.14));
  fuselage.name = 'SpitfireCockpitExternal';
  fuselage.userData = { templateKind: 'Bundle' };
  complex.add(cockpitLod); cockpitLod.add(fuselage);
  const wing = (name, t, q, physics, axis) => {
    const n = new THREE.Object3D();
    n.name = name;
    n.position.set(...t);
    if (q) n.quaternion.set(...q);
    n.userData = { templateKind: 'Wing', control: 'Spitfire', physics,
                   ...(axis ? { rig: { control: 'Spitfire', automaticReset: true, axes: { pitch: axis } } } : {}) };
    complex.add(n);
  };
  wing('SpitfireAirbreakLeft', [-1.538, 0.05, 0.882], [0.007997, -0.06052, -0.043527, 0.997185],
       { flapLift: 2, pitchOffset: 0.5, positionOffset: [1.539, -0.05, 0.883], regulateToLift: 4.91, wingToRegulatorRatio: 1 });
  wing('SpitfireAirbreakRight', [1.539, 0.05, 0.882], [0.007997, 0.060511, 0.043536, 0.997186],
       { flapLift: 2, pitchOffset: 0.5, positionOffset: [-1.539, -0.05, 0.883], regulateToLift: 4.91, wingToRegulatorRatio: 1 });
  wing('SpitfireRudderBackVertical', [0, 1.244, 5.452], [0, 0, -0.707101, 0.707113],
       { wingLift: 1.5, flapLift: 1.5, positionOffset: [0, -0.5, 0] },
       { input: 'c_PIYaw', min: -15, max: 15, free: false, driver: 'position', maxSpeed: 60, direction: 1 });
  wing('SpitfireBodyWingVertical', [0, 0, -0.3], [0, 0, -0.707101, 0.707113],
       { wingLift: 2, flapLift: 0, positionOffset: [0, 0, -0.6] });
  for (const [side, x, off] of [['Left', -0.889, 0.5], ['Right', 0.89, -0.5]]) {
    wing(`SpitfireRudderBack${side}`, [x, 0.89, 5.306], null,
         { wingLift: 0.5, flapLift: 0.7, positionOffset: [off, 0, 0] },
         { input: 'c_PIPitch', min: -10, max: 20, free: false, driver: 'position', maxSpeed: 60, direction: -1 });
  }
  wing('SpitfireRudderFrontLeft', [-3.814, 0.275, 0.371], [0.011254, -0.078007, -0.047231, 0.99577],
       { wingLift: 2.4, flapLift: 2.3, pitchOffset: 0.5, positionOffset: [0.5, 0, 0.41] },
       { input: 'c_PIRoll', min: -30, max: 30, free: false, driver: 'position', maxSpeed: 120, direction: -1 });
  wing('SpitfireRudderFrontRight', [3.815, 0.275, 0.371], [0.011254, 0.077998, 0.047239, 0.99577],
       { wingLift: 2.4, flapLift: 2.3, pitchOffset: 0.5, positionOffset: [-0.5, 0, 0.41] },
       { input: 'c_PIRoll', min: -30, max: 30, free: false, driver: 'position', maxSpeed: 120, direction: 1 });
  const engine = new THREE.Object3D();
  engine.name = 'SpitfireEngine';
  engine.position.set(0, 0.5, -4);
  engine.userData = { templateKind: 'Engine', control: 'Spitfire',
                      physics: { engineType: 'c_ETPlane', torque: 15, differential: 5, noPropellerEffectAtSpeed: 70,
                                 maxRotation: [0.3, 0, 5000], maxSpeed: [1000, 0, 500] } };
  complex.add(engine);
  const gear = new THREE.Object3D();
  gear.position.set(-0.645, -0.45, 3.543);
  gear.userData = { templateKind: 'LandingGear' };
  engine.add(gear);
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.671, 0.678));
  wheel.name = 'SpitfireWheel3';
  wheel.position.set(-0.259, -1.1, -0.3);
  wheel.userData = { templateKind: 'Spring' };
  gear.add(wheel);
  return root;
}

function spitfire({ speed = 0, altitude = 300, spec = undefined } = {}) {
  const plane = new Aircraft(spitfireNode(), null, { cockpit: false, ...(spec ? { spec } : {}) });
  plane.groundHeight = () => -100000;
  const s = plane.state;
  s.position.set(0, altitude, 0);
  s.orientation.identity();
  s.velocity.set(0, 0, -speed);
  s.throttle = 1;
  plane.setInput('c_PIThrottle', 1);
  return plane;
}

{
  const spec = aircraftSpec(spitfireNode());
  const elevator = spec.surfaces.find(x => x.id === 'SpitfireRudderBackLeft');
  // The pitch rate a full stick holds, a second after it lands, from a
  // second of hands-off flight at the speed (the speed held for that second).
  const rateAfter = (make, speed, stick) => {
    const plane = make(speed);
    for (let i = 0; i < 60; i++) { plane.state.velocity.setLength(speed); plane.integrate(DT); }
    plane.setInput('c_PIPitch', stick);
    fly(plane, 1);
    return round(pitchRate(plane) * DEG, 1);
  };
  const own = speed => spitfire({ speed });
  const asCorsair = speed => spitfire({ speed, spec: CORSAIR });
  // The engine's plane law (`aimAtDirection` 0x08629cf0 ->
  // `towardsDirection` 0x08629fa0) closed on the airframe: a wanted direction
  // stepped 10 deg below the nose at 55 m/s.
  const loop = (step) => {
    const plane = spitfire({ speed: 55 });
    for (let i = 0; i < 60; i++) { plane.state.velocity.setLength(55); plane.integrate(DT); }
    const e = step * Math.PI / 180;
    const dir = [0, Math.sin(e), -Math.cos(e)];
    let worst = 0, settledAt = null;
    for (let i = 1; i <= 180; i++) {
      const s = plane.state;
      const r = aimAtDirection({ orientation: s.orientation, velocity: [s.velocity.x, s.velocity.y, s.velocity.z],
        angularVelocity: [s.angularVelocity.x, s.angularVelocity.y, s.angularVelocity.z], dir,
        altitudeAlong: () => 1e6, altitude: 300, clearance: 75, airborne: true, throttleFloor: 1, maxSpeed: 60 });
      plane.setInput('c_PIPitch', r.pitch); plane.setInput('c_PIRoll', r.roll); plane.setInput('c_PIYaw', r.rudder);
      plane.integrate(DT);
      const f = forwardOf(plane);
      const err = Math.acos(Math.max(-1, Math.min(1, f.x * dir[0] + f.y * dir[1] + f.z * dir[2]))) * DEG;
      const past = step < 0 ? noseDeg(plane) < step : noseDeg(plane) > step;
      if (past) worst = Math.max(worst, err);
      if (settledAt === null && err < 1.0) settledAt = i * DT;
    }
    return { settledAt: settledAt === null ? null : round(settledAt, 2), overshoot: round(worst, 2) };
  };
  // Level top speed under the box drag law, at the deck and at 200 m.
  const top = altitude => {
    const plane = spitfire({ speed: 30, altitude });
    fly(plane, 180, holdingAltitude(altitude, 1));
    return round(plane.state.velocity.length(), 1);
  };
  results.spitfire = {
    mass: spec.mass, drag: spec.drag, dragLaw: spec.dragLaw, inertiaModifier: spec.inertiaModifier,
    size: spec.size.map(v => round(v, 2)), groundClearance: round(spec.groundClearance, 3),
    throttleRate: spec.throttleRate, surfaces: spec.surfaces.length, engines: spec.engines.length,
    elevatorArm: round(elevator.attach[2], 3), elevatorLift: elevator.wingLift + elevator.flapLift,
    pitchUp40: rateAfter(own, 40, -1), pitchDown40: rateAfter(own, 40, 1),
    pitchUp60: rateAfter(own, 60, -1), pitchDown60: rateAfter(own, 60, 1),
    corsairUp40: rateAfter(asCorsair, 40, -1), corsairUp60: rateAfter(asCorsair, 60, -1),
    loopDown: loop(-10), loopDeep: loop(-25),
    top40: top(40), top200: top(200),
    // A tree with no body physics is still a Corsair.
    fallback: new Aircraft(corsairNode(), null, { cockpit: false }).spec === CORSAIR,
    // A fixed-wing airframe stays on the pedal-and-nose thrust path.
    vectored: new Aircraft(spitfireNode(), null, { cockpit: false }).vectored,
    vectoredEngines: new Aircraft(spitfireNode(), null, { cockpit: false }).vectoredEngines.length,
    specVectored: !!spec.vectored, specInertiaLaw: spec.inertiaLaw ?? null,
    engineOffNose: round(spec.engines[0].offNose, 3),
  };
}


// --- Desert Combat's AH-64: hover engines on input-driven racks -------------
//
// Refractor has no helicopter class. The AH-64 is `AH64/Objects.con` and
// `Physics.con` in DesertCombat's OBJECTS.rfa: three `Engine`s placed
// `setRotation 0/270/0` under three `RotationalBundle` racks that the stick
// and pedals tilt +-20 degrees, a dummy engine on a +-2 degree rack that turns
// the rotor, and a dummy tail engine. The tree below is that, as the extracted
// glb carries it: glb positions (z mirrored), the engines' 0/270/0 as the
// quaternion (-0.7071, 0, 0, -0.7071) that stands their thrust axis straight
// up, each rack's and engine's `rig` extras as `con.py` emits them, and the
// fuselage box (the union of the `AH64_Fus_M1` sub-meshes) and wheels the
// inertia and ride height come from.
const UPRIGHT = [-0.7071068, 0, 0, -0.7071068];
const HOVER_PHYSICS = {
  engineType: 'c_ETPlane', torque: 13.5, differential: 3.5, noPropellerEffectAtSpeed: 3000,
  maxRotation: [5000, 5000, 5000], maxSpeed: [50, 50, 9500], acceleration: [50, 50, 15000],
};
const HOVER_THROTTLE = {
  input: 'c_PIThrottle', min: 1500, max: 5000, free: false, driver: 'rate', maxSpeed: 9500, direction: 1, acceleration: 15000,
};

function ah64Node() {
  const root = new THREE.Object3D();
  root.name = 'AH64';
  root.userData = { control: 'AH64', templateKind: 'PlayerControlObject',
                    physics: { mass: 2500, drag: 0.8, inertiaModifier: [0.4, 0.4, 0.4] } };
  const lod = new THREE.Object3D();
  lod.userData = { templateKind: 'LodObject' };
  const complex = new THREE.Object3D();
  complex.name = 'AH64Complex';
  complex.userData = { templateKind: 'Bundle' };
  root.add(lod); lod.add(complex);
  const cockpitLod = new THREE.Object3D();
  cockpitLod.userData = { templateKind: 'LodObject' };
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(5.054, 4.187, 14.447).translate(0, 0.4465, -0.0395));
  fuselage.name = 'AH64CockpitExternal';
  fuselage.userData = { templateKind: 'Bundle' };
  complex.add(cockpitLod); cockpitLod.add(fuselage);
  for (const [name, x, y, z] of [['AH64WheelLeftSpring', -0.961, -1.63, -3.763],
                                  ['AH64WheelRightSpring', 0.961, -1.63, -3.763],
                                  ['AH64WheelBackSpring', 0, -0.961, 6.986]]) {
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.106, 0.378, 0.396));
    wheel.name = name;
    wheel.position.set(x, y, z);
    wheel.userData = { templateKind: 'Spring' };
    complex.add(wheel);
  }
  const rack = (name, position, axes) => {
    const node = new THREE.Object3D();
    node.name = name;
    node.position.set(...position);
    node.userData = { templateKind: 'RotationalBundle', rig: { control: 'AH64', automaticReset: true, axes } };
    complex.add(node);
    return node;
  };
  const tilt = (input, limit, direction) => ({ input, min: -limit, max: limit, free: false, driver: 'position',
                                               maxSpeed: 150 * direction, direction, acceleration: 150 });
  const engine = (parent, name, physics, roll, automaticReset = true, quaternion = UPRIGHT) => {
    const node = new THREE.Object3D();
    node.name = name;
    if (quaternion) node.quaternion.set(...quaternion);
    node.userData = { templateKind: 'Engine', control: 'AH64', physics,
                      rig: { control: 'AH64', automaticReset, axes: { roll } } };
    parent.add(node);
    return node;
  };
  engine(rack('AH64DummyEngineRack', [0, 1.4, -2.2], { pitch: tilt('c_PIPitch', 2, 1), roll: tilt('c_PIRoll', 2, -1) }),
         'AH64DummyEngine',
         { engineType: 'c_ETPlane', torque: 0.1, differential: 0.1, noPropellerEffectAtSpeed: 50,
           maxRotation: [0, 0, 1000], maxSpeed: [0, 0, 9500], acceleration: [0, 0, 15000] },
         { input: 'c_PIThrottle', min: 50, max: 1000, free: false, driver: 'rate', maxSpeed: 9500, direction: 1, acceleration: 15000 });
  const tail = new THREE.Object3D();
  tail.name = 'AH64DummyRearEngineRack';
  tail.position.set(0, 1.884, 6.116);
  tail.userData = { templateKind: 'Bundle' };
  complex.add(tail);
  engine(tail, 'AH64DummyRearEngine',
         { engineType: 'c_ETPlane', torque: 0.1, differential: 0.1, noPropellerEffectAtSpeed: 100,
           maxRotation: [0, 0, 500], maxSpeed: [0, 0, 1], acceleration: [0, 0, 100] },
         { input: 'c_PIThrottle', min: 50, max: 500, free: false, driver: 'rate', maxSpeed: 1, direction: 1, acceleration: 100 },
         false, null);
  // Front and rear racks take the PEDALS on their roll axis, in opposite
  // senses: that is the yaw couple. The middle one takes the stick's roll.
  engine(rack('AH64EngineRack1', [0, 2, -2.5], { pitch: tilt('c_PIPitch', 20, 1), roll: tilt('c_PIYaw', 20, -1) }),
         'AH64HoverEngine1', HOVER_PHYSICS, HOVER_THROTTLE);
  engine(rack('AH64EngineRack2', [0, 2, 2.5], { pitch: tilt('c_PIPitch', 20, 1), roll: tilt('c_PIYaw', 20, 1) }),
         'AH64HoverEngine2', HOVER_PHYSICS, HOVER_THROTTLE);
  engine(rack('AH64EngineRack3', [0, 2, 0], { pitch: tilt('c_PIPitch', 20, 1), roll: tilt('c_PIRoll', 20, -1) }),
         'AH64HoverEngine3', HOVER_PHYSICS, HOVER_THROTTLE);
  return root;
}

/** An AH-64 on flat ground at 0 (or in the air), collective set. */
function ah64({ altitude = null, collective = 0 } = {}) {
  const heli = new Aircraft(ah64Node(), null, { cockpit: false });
  heli.groundHeight = () => 0;
  heli.state.position.set(0, altitude ?? heli.spec.groundClearance, 0);
  heli.setInput('c_PIThrottle', collective);
  return heli;
}
const hoverEngine = heli => heli.vectoredEngines.find(e => e.id === 'AH64HoverEngine3');
/** Body angular rates, rad/s: x pitch (nose-up +), y yaw (nose-left +), z roll. */
const bodyRates = plane => plane.state.angularVelocity.clone()
  .applyQuaternion(plane.state.orientation.clone().invert());
const vec = v => [round(v.x), round(v.y), round(v.z)];

{
  const spec = aircraftSpec(ah64Node());
  const hover = spec.engines.find(e => e.id === 'AH64HoverEngine3');
  const helicopter = {
    spec: {
      vectored: !!spec.vectored, inertiaLaw: spec.inertiaLaw ?? null, liftEngineAngle: LIFT_ENGINE_ANGLE,
      engines: spec.engines.length, groundClearance: round(spec.groundClearance), size: spec.size.map(v => round(v)),
      offNose: Object.fromEntries(spec.engines.map(e => [e.id, round(e.offNose, 2)])),
      chain: hover.chain.map(c => ({ id: c.id, axes: Object.keys(c.axes), roll: c.axes.roll.input })),
      throttle: { input: hover.throttle.input, min: hover.throttle.min, max: hover.throttle.max,
                  automaticReset: hover.throttle.automaticReset, acceleration: hover.throttle.acceleration },
      maxRotationZ: hover.maxRotationZ,
    },
  };

  // The thrust axis, as the rack stands: straight up at rest, tilted by the
  // rack's own servo once the stick moves it.
  {
    const heli = ah64();
    const engine = hoverEngine(heli);
    const dir = new THREE.Vector3(), arm = new THREE.Vector3();
    const at = inputs => {
      engine.reset();
      engine.stepBundles(1, name => inputs[name] ?? 0);
      engine.pose(heli.state.orientation, dir, arm);
      return { dir: vec(dir), arm: vec(arm) };
    };
    helicopter.axis = { rest: at({}), pitch: at({ c_PIPitch: 1 }), roll: at({ c_PIRoll: 1 }),
                        yawFront: (() => { const e = heli.vectoredEngines.find(x => x.id === 'AH64HoverEngine1');
                          e.stepBundles(1, n => (n === 'c_PIYaw' ? 1 : 0)); e.pose(heli.state.orientation, dir, arm); return vec(dir); })(),
                        yawRear: (() => { const e = heli.vectoredEngines.find(x => x.id === 'AH64HoverEngine2');
                          e.stepBundles(1, n => (n === 'c_PIYaw' ? 1 : 0)); e.pose(heli.state.orientation, dir, arm); return vec(dir); })() };
  }

  // The idle floor: collective down (or reversed) the throttle angle clips at
  // setMinRotation's 1500 of 5000, and the revs settle on it.
  {
    const heli = ah64({ collective: 0 });
    const engine = hoverEngine(heli);
    fly(heli, 6);
    const idle = { t1: round(engine.t1, 4), revs: round(engine.revs, 4), y: round(heli.state.position.y),
                   grounded: heli.state.grounded };
    heli.setInput('c_PIThrottle', -1);
    fly(heli, 1);
    idle.t1Reversed = round(engine.t1, 4);
    heli.setInput('c_PIThrottle', 1);
    fly(heli, 6 * DT);
    idle.t1After6Ticks = round(engine.t1, 4);
    fly(heli, 0.5);
    idle.t1Full = round(engine.t1, 4);
    helicopter.idle = idle;
  }

  // The gearbox's own fixed point, re-derived here from engine-revs.js:
  // `revs = 2*(T1 - L)`, `L` the per-tick mean of `0.99*K*ratio/
  // getCurrentTorque()` over the frame's four evaluations, `K = 0.1*revs +
  // e*|e|`, `e = revs - rho*(v.fwd)/3000` (`speedTerm`). Found by bisection:
  // the map's slope is steep enough near full power that plain iteration
  // oscillates.
  const fixedPoint = (t1, speedTerm = 0) => {
    const ratio = currentRatio(3.5);
    const residual = r => {
      const e = r - speedTerm;
      const l0 = (0.1 * Math.abs(r) + e * Math.abs(e)) * ratio / currentTorque(13.5, r);
      let load = 0;
      for (let n = 0; n < 4; n++) load = 0.99 * (load * n + l0) / (n + 1);
      return r - Math.max(-1, Math.min(1.2, 2 * (t1 - load)));
    };
    let lo = 0, hi = 1.2;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (residual(mid) > 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };
  {
    const measured = collective => {
      const heli = ah64({ collective });
      fly(heli, 12);
      return round(hoverEngine(heli).revs, 4);
    };
    helicopter.gearbox = { idleExpected: round(fixedPoint(0.3), 4), idle: measured(0) };
  }

  // Collective up: it lifts off and climbs. Down again: it comes back to the
  // idle floor and sinks, and lands.
  {
    const heli = ah64({ collective: 1 });
    const engine = hoverEngine(heli);
    fly(heli, 6);
    const climb = { y: round(heli.state.position.y), vy: round(heli.state.velocity.y), revs: round(engine.revs, 4) };
    // The same fixed point at full collective, climbing: the speed term is the
    // climb rate along the (near-vertical) thrust axis, rho at the engine.
    const dir = new THREE.Vector3(), arm = new THREE.Vector3();
    engine.pose(heli.state.orientation, dir, arm);
    const rho = 1 - Math.min(1, (heli.state.position.y + arm.y) / 1000);
    helicopter.gearbox.fullExpected = round(fixedPoint(1, rho * heli.state.velocity.dot(dir) / 3000), 4);
    heli.setInput('c_PIThrottle', 0);
    fly(heli, 8);
    climb.releasedVy = round(heli.state.velocity.y);
    climb.releasedRevs = round(engine.revs, 4);
    climb.releasedT1 = round(engine.t1, 4);
    fly(heli, 30);
    climb.landedY = round(heli.state.position.y);
    climb.landed = heli.state.grounded;
    helicopter.climb = climb;
    helicopter.gearbox.full = climb.revs;
  }

  // The collective that holds altitude, by bisection on the settled vertical
  // speed at 100 m, with a pilot holding the attitude level on the cyclic.
  // The AH-64 does not hold it hands-off: its rotor-turning dummy engine sits
  // 2.2 m forward of the others and pushes up, a slow nose-up moment the data
  // carries and the pilot has to fly against.
  {
    const levelling = collective => heli => {
      const attitude = new THREE.Euler().setFromQuaternion(heli.state.orientation, 'YXZ');
      const w = bodyRates(heli);
      const stick = v => Math.max(-1, Math.min(1, v));
      heli.setInput('c_PIThrottle', collective);
      heli.setInput('c_PIPitch', stick(0.05 * attitude.x * DEG + 0.2 * w.x * DEG));
      heli.setInput('c_PIRoll', stick(0.05 * attitude.z * DEG + 0.2 * w.z * DEG));
    };
    const settle = collective => {
      const heli = ah64({ altitude: 100, collective });
      fly(heli, 20, levelling(collective));
      return heli;
    };
    let lo = 0.3, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (settle(mid).state.velocity.y > 0) hi = mid; else lo = mid;
    }
    const collective = (lo + hi) / 2;
    const heli = settle(collective);
    const attitude = new THREE.Euler().setFromQuaternion(heli.state.orientation, 'YXZ');
    helicopter.hover = { collective: round(collective, 4), vy: round(heli.state.velocity.y),
                         y: round(heli.state.position.y), revs: round(hoverEngine(heli).revs, 4),
                         t1: round(hoverEngine(heli).t1, 4), nose: round(attitude.x * DEG, 2),
                         bank: round(attitude.z * DEG, 2) };

    // Cyclic forward from that hover: nose down, and it flies forward.
    const cyclic = settle(collective);
    cyclic.setInput('c_PIRoll', 0);
    cyclic.setInput('c_PIPitch', 0.5);
    fly(cyclic, 0.5);
    const pushRate = bodyRates(cyclic).x;
    cyclic.setInput('c_PIPitch', 0);
    fly(cyclic, 2.5);
    helicopter.cyclic = { pitchRate: round(pushRate, 4), nose: round(noseDeg(cyclic), 2),
                          forward: round(alongOf(cyclic)), vx: round(cyclic.state.velocity.x),
                          vz: round(cyclic.state.velocity.z) };

    // Roll and pedals from the same hover, against the Corsair's own answer
    // to the same stick: the sign convention is the data's, so they agree.
    const rate = (make, input) => {
      const plane = make();
      fly(plane, 0.5);
      plane.setInput(input, 1);
      fly(plane, 0.5);
      return bodyRates(plane);
    };
    const heliAt = () => ah64({ altitude: 100, collective });
    const plane = () => aircraft({ speed: 60, altitude: 300 });
    const heliRoll = rate(heliAt, 'c_PIRoll'), planeRoll = rate(plane, 'c_PIRoll');
    const heliYaw = rate(heliAt, 'c_PIYaw'), planeYaw = rate(plane, 'c_PIYaw');
    const heliPitch = rate(heliAt, 'c_PIPitch'), planePitch = rate(plane, 'c_PIPitch');
    helicopter.signs = {
      roll: [round(heliRoll.z, 4), round(planeRoll.z, 4)],
      yaw: [round(heliYaw.y, 4), round(planeYaw.y, 4)],
      pitch: [round(heliPitch.x, 4), round(planePitch.x, 4)],
    };
  }

  // The engine switched off (`Engine+0x142` clear): no input, revs held at
  // zero, and it drops. Under water the same, by the aircraft's water rule.
  {
    const heli = ah64({ altitude: 100, collective: 1 });
    fly(heli, 2);
    heli.engineRunning = false;
    fly(heli, 2);
    const off = { revs: hoverEngine(heli).revs, vy: round(heli.state.velocity.y) };
    const wet = ah64({ altitude: 30, collective: 1 });
    wet.groundHeight = () => -1000;
    wet.waterHeight = 50;
    fly(wet, 1);
    helicopter.engineOff = off;
    helicopter.underWater = { revs: Math.max(...wet.vectoredEngines.map(e => Math.abs(e.revs))),
                              vy: round(wet.state.velocity.y) };
  }

  // A seat left with the stick over leaves the rack node posed; the next
  // Aircraft on the same hull must still read the rack's authored rest.
  {
    const node = ah64Node();
    const first = new Aircraft(node, null, { cockpit: false });
    node.getObjectByName('AH64EngineRack3').quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -20 * Math.PI / 180);
    const second = new Aircraft(node, null, { cockpit: false });
    const dir = new THREE.Vector3(), arm = new THREE.Vector3();
    const up = heli => vec(hoverEngine(heli).pose(new THREE.Quaternion(), dir, arm));
    helicopter.reentry = { first: up(first), second: up(second),
                           offNose: round(second.spec.engines.find(e => e.id === 'AH64HoverEngine3').offNose, 3) };
  }

  // reset() parks it with every engine back at rest.
  {
    const heli = ah64({ collective: 1 });
    fly(heli, 3);
    heli.reset();
    helicopter.reset = heli.vectoredEngines.every(e => e.revs === 0 && e.roll.angle === 0
      && e.chain.every(c => c.axes.every(a => a.reg.angle === 0)));
  }

  // Parked with the pilot aboard and the collective released, standing 6
  // degrees nose-up and 3 over on its wheels: the idle floor's thrust is off
  // the vertical, and the wheels' contact friction (`groundFriction`, the
  // plain-contact arm of `addFriction` a `c_PGFDummyGrip` takes) holds it.
  // With the engine stopped (the pilot's seat empty) there is no thrust at all.
  {
    const parked = running => {
      const heli = ah64({ collective: 0 });
      heli.state.orientation.setFromEuler(new THREE.Euler(6 * Math.PI / 180, 0, 3 * Math.PI / 180, 'YXZ'));
      heli.engineRunning = running;
      const p0 = heli.state.position.clone();
      fly(heli, 20);
      return { moved: round(Math.hypot(heli.state.position.x - p0.x, heli.state.position.z - p0.z), 4),
               speed: round(Math.hypot(heli.state.velocity.x, heli.state.velocity.z), 4),
               revs: round(hoverEngine(heli).revs, 4), grounded: heli.state.grounded };
    };
    helicopter.parked = { running: parked(true), stopped: parked(false) };
    // Touching down at 10 m/s, the same contact slides it to a stop at
    // mu * 1.5 * 9.82 = 14.73 m/s^2 (mu the mean of 1.0 and 1.0).
    const slide = ah64({ collective: 0 });
    slide.state.velocity.set(0, 0, -10);
    fly(slide, 0.5);
    const half = Math.hypot(slide.state.velocity.x, slide.state.velocity.z);
    fly(slide, 0.5);
    helicopter.slide = { half: round(half, 3), speed: round(Math.hypot(slide.state.velocity.x, slide.state.velocity.z), 3) };
    // The friction holds the hull only while it is down: full collective lifts it.
    const lift = ah64({ collective: 1 });
    fly(lift, 4);
    helicopter.liftOff = { agl: round(lift.state.position.y - lift.spec.groundClearance), grounded: lift.state.grounded };
    // A fixed-wing aircraft rolls on as before.
    const plane = aircraft({ speed: 10, altitude: CORSAIR.groundClearance, throttle: 0, ground: 0 });
    fly(plane, 1);
    helicopter.fixedWingRolls = round(Math.hypot(plane.state.velocity.x, plane.state.velocity.z), 3);
  }

  // The collective is a held axis: let go, the Engine's own roll axis
  // (`setAutomaticReset 1`) falls straight back to its 1500 floor. The note
  // and the rotor read the revs of the named Engine, not the collective.
  {
    const heli = ah64({ altitude: 100, collective: 1 });
    fly(heli, 2);
    const up = round(hoverEngine(heli).t1, 4);
    heli.setInput('c_PIThrottle', 0);
    fly(heli, 0.25);
    const dummy = heli.vectoredEngines.find(e => e.id === 'AH64DummyEngine');
    helicopter.collectiveHeld = { up, released: round(hoverEngine(heli).t1, 4) };
    helicopter.rpm = {
      dummy: round(heli.engineRpm('AH64DummyEngine'), 4), dummyRevs: round(Math.abs(dummy.revs), 4),
      hover: round(heli.engineRpm('AH64HoverEngine1'), 4),
      hoverRevs: round(Math.abs(heli.vectoredEngines.find(e => e.id === 'AH64HoverEngine1').revs), 4),
      throttle: round(heli.state.throttle, 4), rotor: heli.rotorEngine?.id ?? null,
      fixedWing: aircraft().engineRpm('engine'),
    };
    const auth = heli.controlAuthority();
    helicopter.hovers = heli.hovers;
    helicopter.authority = { pitch: round(auth.pitch, 4), roll: round(auth.roll, 4), yaw: round(auth.yaw, 4) };
  }

  // A bot's helicopter law on the airframe: climb off the pad, transit 500 m
  // over a 40 m hill, hover over the point, then land on it.
  {
    const hill = (x, z) => 40 * Math.exp(-(((x - 150) ** 2 + (z + 200) ** 2) / (2 * 80 ** 2)));
    const heli = ah64({ collective: 0 });
    heli.groundHeight = hill;
    const target = [300, hill(300, -400) + 75, -400];
    const state = {};
    const out = { arrived: null, landed: null, maxTilt: 0, minAgl: Infinity, hoverDrift: 0 };
    let land = false, rudder = 0;
    for (let i = 0; i < 100 * 30; i++) {
      const s = heli.state;
      const t = (i + 1) / 30;
      if (out.arrived !== null && t > out.arrived + 10) land = true;
      const w = s.angularVelocity;
      const r = helicopterControl(state, {
        orientation: s.orientation, position: [s.position.x, s.position.y, s.position.z],
        velocity: [s.velocity.x, s.velocity.y, s.velocity.z], angularVelocity: [w.x, w.y, w.z], target,
        clearance: 50, groundAt: hill, maxSpeed: 90, radius: 10, hover: true, land, dt: 1 / 30,
        grounded: s.grounded, authority: heli.controlAuthority(),
      });
      if (out.arrived === null && r.arrived) out.arrived = round(t, 2);
      if (out.landed === null && r.landed) out.landed = round(t, 2);
      // The world tick writes the law's rudder straight onto the hull, as it
      // does the stick (no spring since 2026-10-06, MLK-10).
      rudder = r.rudder;
      heli.setInput('c_PIThrottle', r.collective);
      heli.setInput('c_PIYaw', rudder);
      heli.setInput('c_PIRoll', r.roll);
      heli.setInput('c_PIPitch', r.pitch);
      heli.integrate(1 / 30);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.orientation);
      out.maxTilt = Math.max(out.maxTilt, Math.acos(Math.min(1, up.y)) * DEG);
      if (t > 5 && !land) out.minAgl = Math.min(out.minAgl, s.position.y - hill(s.position.x, s.position.z) - heli.spec.groundClearance);
      // How far off the point it hovers once it has settled over it.
      if (out.arrived !== null && !land && t > out.arrived + 9) {
        out.hoverDrift = Math.max(out.hoverDrift, Math.hypot(s.position.x - target[0], s.position.z - target[2]));
      }
    }
    const s = heli.state;
    out.maxTilt = round(out.maxTilt, 2);
    out.minAgl = round(out.minAgl, 2);
    out.hoverDrift = round(out.hoverDrift, 2);
    out.final = { off: round(Math.hypot(s.position.x - target[0], s.position.z - target[2]), 2),
                  grounded: s.grounded, speed: round(s.velocity.length(), 3) };
    helicopter.pilot = out;
  }

  results.helicopter = helicopter;
}

// --- `calculateAndClipAngle`'s two laws, on their own -----------------------
{
  const tick = (axis, reg, input, seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) clipAngleStep(reg, axis, input, dt);
    return round(reg.angle, 3);
  };
  // An AH-64 hover engine's throttle: automaticReset, 1500..5000 at 15000 deg/s.
  const throttle = { min: 1500, max: 5000, free: false, maxSpeed: 9500, direction: 1, acceleration: 15000, automaticReset: true };
  const t = { angle: 0, speed: 0 };
  const floor = tick(throttle, t, 0, 1 / 30);
  const up = tick(throttle, t, 1, 0.1);
  const reversed = tick(throttle, t, -1, 1);
  // The Flettner's hover engine: NO automaticReset, 40..100, maxSpeed 100 at
  // 750 deg/s^2 — the servo law, so the collective stays where it was left.
  const latch = { min: 40, max: 100, free: false, maxSpeed: 100, direction: 1, acceleration: 750, automaticReset: false };
  const f = { angle: 0, speed: 0 };
  const latchFloor = tick(latch, f, 0, 1 / 30);
  const latchRaised = tick(latch, f, 1, 0.3);
  const latchHeld = tick(latch, f, 0, 1);
  const latchLowered = tick(latch, f, -1, 2);
  // A negative maxSpeed with a negative acceleration: the servo law turns the
  // same way as 150/150, the automaticReset law the other way.
  const signed = { min: -20, max: 20, free: false, maxSpeed: -150, direction: -1, acceleration: 150 };
  const servoSigned = tick({ ...signed, automaticReset: false }, { angle: 0, speed: 0 }, 1, 0.2);
  const resetSigned = tick({ ...signed, automaticReset: true }, { angle: 0, speed: 0 }, 1, 0.2);
  // Both bounds zero: a single +-360 wrap.
  const wrapped = tick({ min: 0, max: 0, free: true, maxSpeed: 100, direction: 1, acceleration: 1e9, automaticReset: false },
                       { angle: 170, speed: 100 }, 1, 0.2, 0.2);
  // No acceleration and no continuous rotation: the engine returns untouched.
  const frozen = tick({ min: -20, max: 20, free: false, maxSpeed: 150, direction: 1, acceleration: 0, automaticReset: true },
                      { angle: 7, speed: 0 }, 1, 1);
  results.clipAngle = { floor, up, reversed, latchFloor, latchRaised, latchHeld, latchLowered,
                        servoSigned, resetSigned, wrapped, frozen };
}

// --- a surface servo stops at full deflection -------------------------------
//
// A pilot's mouse is a rate past 1 (MLK-7, up to the wire's +-16), and a
// vectored airframe's channels reach the hull unclipped, Wings included (a
// Harrier's ailerons and pitch/roll wings, a helicopter's tail flap). The
// part's angle stops at its bound (GUN-2), so the servo does too.
{
  const plane = aircraft({ speed: 80, altitude: 300 });
  plane.setInput('c_PIRoll', 3.46);
  plane.setInput('c_PIPitch', -3.47);
  for (let i = 0; i < 90; i++) plane.integrate(1 / 30);
  const over = {};
  for (const surface of plane.surfaces) {
    const input = surface.axis?.input;
    if (input !== 'c_PIRoll' && input !== 'c_PIPitch') continue;
    over[surface.key] = round(plane.state.surfaces.get(surface.key) ?? 0, 4);
  }
  results.surfaceClip = over;
}

// --- rememberExcessInput: a flick's excess is spent over later ticks ---------
//
// Ledger MLK-16 and GUN-2: vanilla's elevator Wings (`CorsairFlapTailLeft/
// Right`, `rememberExcessInput 1`) add each tick's input to a backlog held to
// +-40, spend `clamp(backlog, +-1)` a tick, and take an input against the
// backlog's sign whole. The exporter carries the flag in the Wing's
// `physics`; the ailerons and the rudder do not declare it.
{
  const remembering = () => {
    const root = corsairNode();
    for (const child of root.children) {
      if (child.name.startsWith('CorsairFlapTail')) {
        child.userData.physics = { rememberExcessInput: true };
      }
    }
    return root;
  };
  const ELEVATOR = 'Corsair/c_PIPitch/pitch';
  const AILERON = 'Corsair/c_PIRoll/pitch';
  const run = (words, node = remembering(), afterTick = null) => {
    const plane = new Aircraft(node, null, { cockpit: false });
    plane.groundHeight = () => -100000;
    plane.state.position.set(0, 300, 0);
    plane.state.velocity.set(0, 0, -80);
    const spent = [], surface = [], aileron = [];
    words.forEach((word, tick) => {
      plane.setInput('c_PIPitch', word.pitch ?? 0);
      plane.setInput('c_PIRoll', word.roll ?? 0);
      plane.integrate(1 / 30);
      spent.push(round(plane.state.spentInputs.get(ELEVATOR) ?? NaN, 6));
      surface.push(round(plane.state.surfaces.get(ELEVATOR) ?? 0, 6));
      aileron.push(round(plane.state.surfaces.get(AILERON) ?? 0, 6));
      if (afterTick) afterTick(plane, tick);
    });
    return { spent, surface, aileron, backlog: round(plane.state.excessInputs.get(ELEVATOR) ?? 0, 6),
             remembering: [...plane.servoAxes().keys()].filter(k => plane._remembering.has(k)) };
  };
  const zeros = n => Array.from({ length: n }, () => ({}));
  const flick = run([{ pitch: -3.46 }, ...zeros(5)]);
  const plain = run([{ pitch: -3.46 }, ...zeros(5)], corsairNode());
  const flip = run([{ pitch: -3.46 }, { pitch: 0.5 }, ...zeros(2)]);
  const held = run([...Array.from({ length: 90 }, () => ({ pitch: -3.47 })), ...zeros(45)]);
  const gentle = run(Array.from({ length: 5 }, () => ({ pitch: -0.6 })));
  const aileronFlick = run([{ roll: 3.46 }, ...zeros(3)]);
  // The drive's reset (aircraft.js `reset`) clears the servos: no carry.
  const reset = run([{ pitch: -3.46 }, ...zeros(2)], remembering(), (plane, tick) => {
    if (tick === 0) { plane.state.surfaces.clear(); plane.state.inputs.clear(); }
  });
  // The backlog is spent once a tick however the tick is sub-stepped: the
  // Corsair's integrate runs eight 1/240 s steps, and a 1/60 s caller two
  // calls a tick.
  const halfSteps = (() => {
    const plane = new Aircraft(remembering(), null, { cockpit: false });
    const out = [];
    for (let frame = 0; frame < 8; frame++) {
      plane.setInput('c_PIPitch', frame < 2 ? -3.46 : 0);
      plane.integrate(1 / 60);
      out.push(round(plane.state.spentInputs.get(ELEVATOR) ?? NaN, 6));
    }
    return out;
  })();
  const heldReleased = held.spent.slice(90);
  results.excessInput = {
    remembering: flick.remembering,
    flickSpent: flick.spent,
    flickSurface: flick.surface,
    plainSurface: plain.surface,
    plainSpent: plain.spent,
    flipSpent: flip.spent,
    flipBacklog: flip.backlog,
    heldFullAfterRelease: heldReleased.filter(v => v === -1).length,
    heldThen: heldReleased.slice(40, 43),
    gentleSpent: gentle.spent,
    gentleBacklog: gentle.backlog,
    aileronFlick: aileronFlick.aileron,
    resetSpent: reset.spent,
    halfSteps,
  };
}

// --- a ship's ramp: its own servo carries a key's step ----------------------
//
// The LCVP's `Lcvp_Ramp` (`setMaxRotation 0/90/0`, `setMaxSpeed 0/45/0`,
// `c_PIPitch`) as a rig part: the world hands it the arrows' step (no spring
// of the viewer's, MLK-10) and `advanceSurfaces` moves it at 45 deg/s over its
// 90 and stops it at its bound.
{
  const root = corsairNode();
  const ramp = new THREE.Object3D();
  ramp.name = 'Lcvp_Ramp';
  ramp.userData = { templateKind: 'RotationalBundle', rig: { control: 'Lcvp', automaticReset: false,
    axes: { pitch: { input: 'c_PIPitch', min: 0, max: 90, free: false, driver: 'position',
                     maxSpeed: 45, direction: 1, acceleration: 30 } } } };
  root.add(ramp);
  const plane = new Aircraft(root, null, { cockpit: false });
  const at = [];
  for (let tick = 0; tick < 120; tick++) {
    plane.setInput('c_PIPitch', tick < 75 ? 1 : 0);
    plane.integrate(1 / 30);
    if (tick === 29 || tick === 59 || tick === 74 || tick === 104) {
      at.push(round(plane.state.surfaces.get('Lcvp/c_PIPitch/pitch') ?? 0, 4));
    }
  }
  results.rampServo = at;
}

// --- the extracted glbs, when this PC has them --------------------------------
//
// Optional: the model tree is not in the repository. When it is there, the
// real Desert Combat helicopters are built from their own glbs and flown, and
// two fixed-wing aircraft are checked to stay off the engine law.
{
  const base = process.env.BF42_VIEWER_MODELS;
  const glb = path => {
    const data = readFileSync(path);
    let offset = 12, json = null, bin = null;
    while (offset + 8 <= data.length) {
      const length = data.readUInt32LE(offset), type = data.readUInt32LE(offset + 4);
      offset += 8;
      if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8', offset, offset + length));
      else if (type === 0x4e4942) bin = data.subarray(offset, offset + length);
      offset += length;
    }
    // No images under node: the textures are dropped, the geometry kept.
    delete json.images; delete json.textures; delete json.samplers;
    for (const material of json.materials || []) {
      const pbr = material.pbrMetallicRoughness || {};
      delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
      delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
      delete material.extensions;
    }
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
      if (json[key]) json[key] = json[key].filter(name => !/texture/i.test(name));
    }
    const pad = (bytes, fill) => Buffer.concat([bytes, Buffer.alloc((4 - bytes.length % 4) % 4, fill)]);
    const chunk = (bytes, type) => {
      const header = Buffer.alloc(8);
      header.writeUInt32LE(bytes.length, 0); header.writeUInt32LE(type, 4);
      return [header, bytes];
    };
    const body = Buffer.concat([...chunk(pad(Buffer.from(JSON.stringify(json)), 0x20), 0x4e4f534a),
                                ...(bin ? chunk(pad(Buffer.from(bin), 0), 0x4e4942) : [])]);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + body.length, 8);
    const out = Buffer.concat([head, body]);
    return new Promise((resolve, reject) => new GLTFLoader().parse(
      out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), 'file:///', g => resolve(g.scene.children[0]), reject));
  };
  const helis = ['AH64', 'Mi24D', 'UH-60', 'Mi8', 'AH-6', 'SA-342G', 'MH-53'];
  const planes = ['F-15C', 'A10', 'Mig29'];
  const dc = name => `${base}/mods/desertcombat/${name}.glb`;
  if (base && [...helis, ...planes].every(name => existsSync(dc(name)))) {
    const real = { helicopters: {}, planes: {} };
    for (const name of helis) {
      const heli = new Aircraft(await glb(dc(name)), null, { cockpit: false });
      heli.groundHeight = () => 0;
      heli.state.position.set(0, heli.spec.groundClearance, 0);
      heli.setInput('c_PIThrottle', 0);
      fly(heli, 3);
      const idleY = heli.state.position.y - heli.spec.groundClearance;
      heli.setInput('c_PIThrottle', 1);
      fly(heli, 6);
      const climbed = heli.state.position.y - heli.spec.groundClearance;
      heli.setInput('c_PIThrottle', 0);
      fly(heli, 8);
      real.helicopters[name] = { vectored: heli.vectored, engines: heli.vectoredEngines.length,
                                 idleY: round(idleY), climbed: round(climbed), releasedVy: round(heli.state.velocity.y),
                                 hovers: heli.hovers, inertiaPairing: heli.spec.inertiaPairing ?? null };
    }
    // Parked on their own wheels, pilot aboard, collective released, nose 6
    // degrees up: the reviewer's AH-64 walked off at 2.6 m/s after 10 s.
    // A hull staged nose-high also rocks down onto its gear, and its origin,
    // two metres above the wheels, swings forward over them: the UH-60, whose
    // `.2` is its light pitch axis (COL-13), settles from 6 degrees to level
    // in 22 s, moves 0.11 m by 20 s and 0.14 m in all, then stands still.
    real.parked = {};
    for (const name of ['AH64', 'UH-60', 'Mi24D', 'AH-6']) {
      const heli = new Aircraft(await glb(dc(name)), null, { cockpit: false, surfaceFriction: () => 0.8 });
      heli.groundHeight = () => 0;
      heli.state.position.set(0, heli.spec.groundClearance, 0);
      heli.state.orientation.setFromEuler(new THREE.Euler(6 * Math.PI / 180, 0, 0, 'YXZ'));
      heli.setInput('c_PIThrottle', 0);
      fly(heli, 20);
      real.parked[name] = { moved: round(Math.hypot(heli.state.position.x, heli.state.position.z), 3),
                            grips: [...new Set(heli.spec.wheels.map(w => w.grip))] };
    }
    // The `c_PGFRollGripWhenOccupied` airframes, parked level with the seat
    // taken: the Harrier, and DC Final's helicopters, which stand on one
    // DummyGrip wheel and RollGrip mains. RollGrip asks back only the velocity
    // along the axle (PHY-2), so these roll freely; `groundFriction` once read
    // that velocity after overwriting it and pushed every such wheel along
    // -axle, and a parked Harrier slid 247 m and turned 61 degrees in 20 s, a
    // DC Final UH-60 63 m and 176 degrees. They are stood level rather than
    // at the six degrees above: a hull nose-high on rolling mains with its
    // idle thrust tilted back does roll back on them, a few millimetres a
    // second, which is the law and not the bug.
    const dcf = name => `${base}/mods/dc_final/${name}.glb`;
    real.rollGripParked = {};
    for (const [name, path] of [['AV-8B', dc('AV-8B')], ['dc_final/UH-60', dcf('UH-60')],
                                ['dc_final/Mi24D', dcf('Mi24D')], ['dc_final/Mi8', dcf('Mi8')]]) {
      if (!existsSync(path)) continue;
      const craft = new Aircraft(await glb(path), null, { cockpit: false, surfaceFriction: () => 0.8 });
      craft.groundHeight = () => 0;
      craft.state.position.set(0, craft.spec.groundClearance, 0);
      craft.setInput('c_PIThrottle', 0);
      let turned = 0;
      const nose = new THREE.Vector3();
      for (let i = 0; i < 20 * 60; i++) {
        craft.integrate(DT);
        nose.set(0, 0, -1).applyQuaternion(craft.state.orientation);
        turned = Math.max(turned, Math.abs(Math.atan2(-nose.x, -nose.z)) * DEG);
      }
      real.rollGripParked[name] = {
        occupied: craft.engineRunning,
        moved: round(Math.hypot(craft.state.position.x, craft.state.position.z), 3),
        turned: round(turned, 2),
        grips: [...new Set(craft.spec.wheels.map(w => w.grip))],
      };
    }
    // A pilot keying an airframe through the page's own air-seat tick
    // (`world-vehicle-tick.js` `vehicleTick`, which shapes W/S into the held
    // `c_PIThrottle` and hands the pedals and arrows over as they are, MLK-10),
    // one 30 Hz world tick at a time. `keys` is the page's input word:
    // `forward` W/S, `rudder` D/A, `pitch` ArrowUp/ArrowDown (Air.con's
    // `c_PIPitch` +1/-1). `attitude` is the hull's in world terms; `tilt` is
    // how far its up axis leans from vertical, which a yaw does not change.
    // `hull` stands in for the seat's damageable (`World.occupiedDamageable`).
    const keyed = (craft, hull = null) => {
      const seat = {
        id: 'pilot', kind: 'air', vehicle: craft,
        occupancy: { turret: null, isActiveRoot: () => true, applyTurrets() {}, activeFireArmsNodes: () => [] },
        gate: { blocked: false, rotationalScale: 1 }, buffer: [], pending: null, held: null,
        stick: { roll: 0, pitch: 0 }, groups: [], manned: [],
      };
      const world = { occupiedDamageable: () => hull, falling: null, fireStateFor: () => null, guns: null };
      const integrators = new Map([[craft, seat]]);
      const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), body = new THREE.Vector3();
      const attitude = () => {
        const q = craft.state.orientation;
        fwd.set(0, 0, -1).applyQuaternion(q); right.set(1, 0, 0).applyQuaternion(q); up.set(0, 1, 0).applyQuaternion(q);
        body.copy(craft.state.angularVelocity).applyQuaternion(q.clone().invert());
        return { pitch: Math.asin(Math.max(-1, Math.min(1, fwd.y))) * DEG, bank: Math.atan2(-right.y, up.y) * DEG,
                 heading: Math.atan2(-fwd.x, -fwd.z) * DEG, tilt: Math.acos(Math.min(1, up.y)) * DEG,
                 y: craft.state.position.y, pitchRate: body.x * DEG, yawRate: body.y * DEG, rollRate: body.z * DEG };
      };
      const tick = keys => {
        bufferInput(seat, { forwardKeys: keys.forward ?? 0, rudder: keys.rudder ?? 0, roll: keys.roll ?? 0,
                            pitch: keys.pitch ?? 0, pad: !!keys.pad });
        vehicleTick(world, seat, 1 / 30, integrators);
        return attitude();
      };
      return { tick, attitude };
    };
    // The owner's Harrier flight: S for 3 s to lift on the jets, W for 4 s to
    // transition, ArrowDown for 1 s to pull up, then 2 s more on W. With the
    // RollGrip bug it left the pad already turning and was banked 41 degrees
    // by the end of the W, and the pull dropped the nose.
    if (existsSync(dc('AV-8B'))) {
      const harrier = new Aircraft(await glb(dc('AV-8B')), null, { cockpit: false, surfaceFriction: () => 0.8 });
      harrier.groundHeight = () => 0;
      harrier.state.position.set(0, harrier.spec.groundClearance, 0);
      const pilot = keyed(harrier);
      let maxBank = 0;
      const hold = (seconds, keys) => {
        for (let i = 0; i < Math.round(seconds * 30); i++) maxBank = Math.max(maxBank, Math.abs(pilot.tick(keys).bank));
        return pilot.attitude();
      };
      hold(1, {});
      const lifted = hold(3, { forward: -1 });
      const transitioned = hold(4, { forward: 1 });
      const pulled = hold(1, { forward: 1, pitch: -1 });
      const after = hold(2, { forward: 1 });
      real.harrierOwner = {
        liftedY: round(lifted.y, 1), maxBank: round(maxBank, 2), heading: round(after.heading, 2),
        pitchBeforePull: round(transitioned.pitch, 2), pitchAtRelease: round(pulled.pitch, 2),
        pitchAfter: round(after.pitch, 2), climbedAfter: round(after.y - transitioned.y, 1),
      };
    }
    // A helicopter that goes critical in a climb: its engines stop and stay
    // stopped while the pilot holds full collective, and start again once it
    // is out of critical (PHY-14, HP-13: 0x14 stops and latches, 0x13 restarts
    // an occupied one). The hull is the page's own `DamageableVehicle` off
    // the glb's armour, so the hook reads the getters the page has; and a
    // re-boarding mid-critical (`#syncEngine` setting the byte on message 4)
    // is undone on the next tick, which is the latch.
    {
      const root = await glb(dc('AH64'));
      const heli = new Aircraft(root, null, { cockpit: false });
      heli.groundHeight = () => 0;
      heli.state.position.set(0, 200, 0);
      const hull = new DamageableVehicle(root.userData.armor);
      const pilot = keyed(heli, hull);
      const phase = (seconds, keys) => {
        for (let i = 0; i < Math.round(seconds * 30); i++) pilot.tick(keys);
        return { running: heli.engineRunning, revs: round(heli.rotorEngine.revs, 3), vy: round(heli.state.velocity.y, 2) };
      };
      const climb = phase(3, { forward: 1 });
      hull.damage(hull.hitPoints - hull.criticalDamage + 1);
      const critical = phase(3, { forward: 1 });
      heli.engineRunning = true;
      pilot.tick({ forward: 1 });
      const reboarded = heli.engineRunning;
      hull.heal(hull.maxHitPoints);
      const recovered = phase(3, { forward: 1 });
      real.criticalStops = { climb, critical, recovered, reboarded, wasCritical: hull.criticalDamage !== null };
    }
    // Spinning free, nothing pushing: engines stopped, no gravity, no drag,
    // at rest, an arbitrary rate about a skew axis. The engine keeps omega in
    // world axes and has no gyroscopic term (COL-8), so it must not move
    // while the hull turns 70 degrees; with `omega x I.omega` the UH-60's
    // .2/.6/.6 tensor precessed it by 0.63 rad/s in 2 s.
    {
      const heli = new Aircraft(await glb(dc('UH-60')), null, { cockpit: false });
      heli.groundHeight = () => -Infinity;
      heli.spec.gravity = 0;
      heli.spec.drag = 0;
      heli.engineRunning = false;
      heli.state.position.set(0, 500, 0);
      heli.state.angularVelocity.set(0.3, 0.5, 0.2);
      const w0 = heli.state.angularVelocity.clone(), q0 = heli.state.orientation.clone();
      for (let i = 0; i < 60; i++) heli.integrate(1 / 30);
      real.torqueFree = {
        drift: heli.state.angularVelocity.clone().sub(w0).length(),
        turned: round(2 * Math.acos(Math.min(1, Math.abs(heli.state.orientation.dot(q0)))) * DEG, 1),
      };
    }
    // Pedal alone in a hover: 3 s holding height on W taps, 2 s of D, 2 s
    // hands off, against the same hover flown without the pedal (the hover
    // itself drifts a degree a second in pitch: nothing trims it). The
    // engine has no gyroscopic term (COL-8); with one, the DC UH-60 rolled
    // at 38 deg/s and leaned 22 degrees off the hover it would have flown.
    real.yawOnly = {};
    for (const name of ['UH-60', 'AH64', 'Mi24D']) {
      const fly = async pedal => {
        const heli = new Aircraft(await glb(dc(name)), null, { cockpit: false });
        heli.groundHeight = () => 0;
        heli.state.position.set(0, 100, 0);
        const pilot = keyed(heli);
        const height = () => (heli.state.velocity.y < 0 ? 1 : 0);
        for (let i = 0; i < 3 * 30; i++) pilot.tick({ forward: height() });
        const track = [];
        for (let i = 0; i < 2 * 30; i++) track.push(pilot.tick({ forward: height(), rudder: pedal ? 1 : 0 }));
        for (let i = 0; i < 2 * 30; i++) track.push(pilot.tick({ forward: height() }));
        return track;
      };
      const control = await fly(false), pedal = await fly(true);
      let lean = 0, pitchRate = 0, rollRate = 0, yawRate = 0;
      pedal.forEach((p, i) => {
        lean = Math.max(lean, Math.abs(p.tilt - control[i].tilt));
        pitchRate = Math.max(pitchRate, Math.abs(p.pitchRate - control[i].pitchRate));
        rollRate = Math.max(rollRate, Math.abs(p.rollRate - control[i].rollRate));
        yawRate = Math.max(yawRate, Math.abs(p.yawRate));
      });
      real.yawOnly[name] = { yawRate: round(yawRate, 1), lean: round(lean, 2),
                             pitchRate: round(pitchRate, 2), rollRate: round(rollRate, 2) };
    }
    // A bot in the Harrier flies the plane law (AI-60), which is what DC's
    // data gives it: its `AV8BCtrl` is a jet's `ControlInfo3d` (maxSpeed 60,
    // turnRadius 25, maxClimbAngle 0.305), and the engine has no other law.
    // The helicopters' hover law cannot fly it: its collective raises the
    // lift by going positive, and the Harrier's positive `c_PIThrottle`
    // opens the forward engine and closes the lift jets (`hovers` false), so
    // it drove down the strip at 80 m/s and never left it. The plane law
    // takes off on the forward engine, as the bot did in retail, and goes
    // 3 km to its point; there it orbits, which is that law's arrival. With
    // the RollGrip bug it swerved 17 degrees and banked 10 on its roll.
    if (existsSync(dc('AV-8B'))) {
      const harrier = new Aircraft(await glb(dc('AV-8B')), null, { cockpit: false, surfaceFriction: () => 0.8 });
      harrier.groundHeight = () => 0;
      harrier.state.position.set(0, harrier.spec.groundClearance, 0);
      const pilot = keyed(harrier);
      const target = [0, 80, -3000];
      let airborne = false, arrived = null, liftedAt = null, maxBank = 0, minY = Infinity, swerve = 0;
      for (let i = 0; i < 60 * 30 && arrived === null; i++) {
        const s = harrier.state, w = s.angularVelocity;
        const r = towardsPoint({
          orientation: s.orientation, position: [s.position.x, s.position.y, s.position.z],
          velocity: [s.velocity.x, s.velocity.y, s.velocity.z], angularVelocity: [w.x, w.y, w.z], target,
          clearance: 50, groundAt: () => 0, altitudeAlong: () => s.position.y, altitude: s.position.y,
          airborne, maxSpeed: 60, radius: 25,
        });
        airborne = r.airborne;
        // `bot-pilot.js` `planePower`: a vectored airframe's throttle is the
        // held axis, as the law asks; the stick is the pad's.
        const a = pilot.tick({ forward: Math.max(-1, Math.min(1, r.throttle)), rudder: r.rudder,
                               roll: r.roll, pitch: r.pitch, pad: true });
        if (liftedAt === null && s.position.y > 10) liftedAt = round((i + 1) / 30, 1);
        if (airborne) minY = Math.min(minY, s.position.y);
        else swerve = Math.max(swerve, Math.abs(a.heading));
        maxBank = Math.max(maxBank, Math.abs(a.bank));
        if (r.arrived) arrived = round((i + 1) / 30, 1);
      }
      real.harrierBot = { hovers: harrier.hovers, liftedAt, arrived, minY: round(minY, 1), maxBank: round(maxBank, 1),
                          swerve: round(swerve, 2) };
    }
    // The bot's law flies each of them 700 m and puts it down on the point.
    real.pilot = {};
    for (const name of ['AH64', 'UH-60', 'Mi24D', 'AH-6', 'Mi8']) {
      const heli = new Aircraft(await glb(dc(name)), null, { cockpit: false });
      heli.groundHeight = () => 0;
      heli.state.position.set(0, heli.spec.groundClearance, 0);
      const target = [500, 75, -500];
      const state = {};
      let arrived = null, landed = null, land = false, rudder = 0, maxTilt = 0;
      for (let i = 0; i < 150 * 30; i++) {
        const s = heli.state;
        const t = (i + 1) / 30;
        if (arrived !== null && t > arrived + 10) land = true;
        const w = s.angularVelocity;
        const r = helicopterControl(state, {
          orientation: s.orientation, position: [s.position.x, s.position.y, s.position.z],
          velocity: [s.velocity.x, s.velocity.y, s.velocity.z], angularVelocity: [w.x, w.y, w.z], target,
          clearance: 50, groundAt: () => 0, maxSpeed: 90, radius: 10, hover: true, land, dt: 1 / 30,
          grounded: s.grounded, authority: heli.controlAuthority(),
        });
        if (arrived === null && r.arrived) arrived = round(t, 2);
        if (landed === null && r.landed) landed = round(t, 2);
        // The world writes the law's rudder straight onto the hull (no
        // spring of the viewer's, MLK-10), as the scenario above does.
        rudder = r.rudder;
        heli.setInput('c_PIThrottle', r.collective);
        heli.setInput('c_PIYaw', rudder);
        heli.setInput('c_PIRoll', r.roll);
        heli.setInput('c_PIPitch', r.pitch);
        heli.integrate(1 / 30);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.orientation);
        maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, up.y)) * DEG);
      }
      const s = heli.state;
      real.pilot[name] = { arrived, landed, maxTilt: round(maxTilt, 1),
                           off: round(Math.hypot(s.position.x - 500, s.position.z + 500), 2), grounded: s.grounded };
    }
    for (const name of planes) {
      const plane = new Aircraft(await glb(dc(name)), null, { cockpit: false });
      real.planes[name] = { vectored: plane.vectored, inertiaLaw: plane.spec.inertiaLaw ?? null,
                            offNose: Math.max(...plane.spec.engines.map(e => e.offNose)), hovers: plane.hovers,
                            inertiaPairing: plane.spec.inertiaPairing ?? null };
    }
    // The Harrier is vectored (its lift jets point down) but does not hover on
    // its collective: W opens the forward engine. Its bots keep the plane law.
    if (existsSync(dc('AV-8B'))) {
      const harrier = new Aircraft(await glb(dc('AV-8B')), null, { cockpit: false });
      real.harrier = { vectored: harrier.vectored, hovers: harrier.hovers };
    }
    results.realGlbs = real;
  } else {
    results.realGlbs = null;
  }
}

process.stdout.write(JSON.stringify(results, null, 2));
