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
//
// ALTITUDES ARE DELIBERATE AND SMALL. `PhysicsWing::updatePhysics` fades every
// surface's lift to nothing at `airDensityZeroAtHeight` = 1000 m, so a scenario
// staged at 2000 m — as these were before the model was rebuilt on the read
// equations — is a scenario staged where no Refractor aircraft can fly. Nothing
// here starts above 900 m, and the one case that does is the ceiling test.

import * as THREE from 'three';
import { Aircraft, CORSAIR, GRAVITY, Vehicle, calculateLift, VehicleCamera, findVehicle } from './flight.mjs';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';

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
// instance `flight.mjs` imports — so the real `loadCockpit` path runs with no
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

process.stdout.write(JSON.stringify(results, null, 2));
