// Drives `viewer/ground.js` outside a browser and prints one JSON blob.
//
// Same shape as `flight_harness.mjs`, and it borrows that harness's one trick:
// `tests/test_ground.py` stands the vendored three.js up as a package and
// copies the viewer modules in under their own names, so the file under test
// is the file the page loads, byte for byte.
//
// The jeep is built from the Willy's node tree as the glb carries it —
// transforms and `extras.physics` transcribed from `viewer/models/Willy.glb`
// (which is itself `Objects/Vehicles/Land/Willy/*.con` run through the
// assembler) — for the same reason `flight_harness` builds its Corsair from
// the surface table: the extracted scene is not in the repository, and the
// tree below *is* the data it carries. `GroundVehicle.collectChassis` walks
// this the same way it walks the real thing.
//
// The ground is analytic: a flat plane for most scenarios, a 2 m step down
// for the drop. No collider, no scene, no GL.

import * as THREE from 'three';
import {
  GroundVehicle, WILLYS, TrackedVehicle, TANK,
  engineRatio, gearLadder, engineTorqueFraction, differentialRPM,
  currentDifferentialRPM, engineGripTarget, engineTypeBits, ENGINE_TYPES,
  EngineState, ENGINE_REV_CEILING, ENGINE_REV_FLOOR,
} from './ground.js';
import { GRAVITY } from './physics.js';

const DEG = 180 / Math.PI;
const DT = 1 / 60;

/**
 * The Willy as `extract_map.py` leaves it: engine under the body, wheels
 * under the engine, front springs under their steering bundles. Positions are
 * the glb's (-Z forward, the exporter's mirror already applied). [data]
 */
function willyNode() {
  const root = new THREE.Object3D();
  root.name = 'Willy';
  root.userData = {
    control: 'Willy',
    templateKind: 'PlayerControlObject',
    physics: { mass: 2500, drag: 1.5, vehicleCategory: 'VCLand' },
  };

  const camera = new THREE.Object3D();
  camera.name = 'WillyCamera';
  camera.position.set(-0.38, 0.95, 1.25);
  camera.userData = { templateKind: 'Camera', cameraView: 'CVMInside' };
  root.add(camera);

  const engine = new THREE.Object3D();
  engine.name = 'WillyEngine';
  engine.position.set(0, 0.35, 0.25);
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType: 'c_ETCar', torque: 10.5, differential: 7.0,
      numberOfGears: 5, gearUp: 0.95, gearDown: 0.4,
      // `setMinRotation 0/0/-5000`, `setMaxRotation 0/0/5000`,
      // `setMaxSpeed 0/0/55000`, `setAcceleration 0/0/55000`. The Engine
      // declares NO yaw input at all -- a car steers through its front
      // wheels' own bundles -- so `maxRotation.x` is 0 and the drivetrain's
      // steering term stays 0, which is exactly what makes
      // `getCurrentDifferentialRPM` a no-op for a `c_ETCar`.
      maxRotation: [0, 0, 5000], maxSpeed: [0, 0, 55000],
      acceleration: [0, 0, 55000],
    },
    rig: {
      control: 'Willy', automaticReset: true,
      axes: {
        roll: {
          input: 'c_PIThrottle', min: -5000, max: 5000, free: false,
          driver: 'rate', maxSpeed: 55000, direction: 1,
        },
      },
    },
  };
  root.add(engine);

  const steerRig = {
    control: 'Willy', automaticReset: true,
    axes: {
      yaw: {
        input: 'c_PIYaw', min: -30, max: 30, free: false,
        driver: 'position', maxSpeed: 200, direction: 1,
      },
    },
  };
  for (const side of [1, -1]) {
    const bundle = new THREE.Object3D();
    bundle.name = side > 0 ? 'WillyFrontWheelR' : 'WillyFrontWheelL';
    bundle.position.set(0.6 * side, 0.11, -1.0);
    bundle.userData = { templateKind: 'RotationalBundle', rig: steerRig };
    const spring = new THREE.Object3D();
    spring.name = side > 0 ? 'WillyFrontSpringR' : 'WillyFrontSpringL';
    spring.position.set(0, -0.599, 0);
    spring.userData = {
      templateKind: 'Spring',
      physics: { grip: 'c_PGFRollGrip', strength: 25, damping: 5 },
    };
    bundle.add(spring);
    engine.add(bundle);

    const rear = new THREE.Object3D();
    rear.name = side > 0 ? 'WillyBackSpringR' : 'WillyBackSpringL';
    rear.position.set(0.6 * side, -0.472, 1.21);
    rear.userData = {
      templateKind: 'Spring',
      physics: { grip: 'c_PGFEngineGrip', strength: 25, damping: 5 },
    };
    engine.add(rear);
  }

  const steering = new THREE.Object3D();
  steering.name = 'WillySteering';
  steering.position.set(-0.399, 0.35, -0.15);
  steering.userData = {
    templateKind: 'RotationalBundle',
    rig: {
      control: 'Willy', automaticReset: true,
      axes: {
        roll: {
          input: 'c_PIYaw', min: -60, max: 60, free: false,
          driver: 'position', maxSpeed: 180, direction: -1,
        },
      },
    },
  };
  root.add(steering);
  return root;
}

/** A jeep standing on (or dropped just above) analytic ground. */
function jeep({ ground = () => 0, y = 0.6, speed = 0, surface } = {}) {
  const truck = new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: ground,
    ...(surface ? { surfaceFriction: surface } : {}),
  });
  const s = truck.state;
  s.position.set(0, y, 0);
  // Nose down -Z, the spawn heading; forward speed is -Z velocity.
  s.velocity.set(0, 0, -speed);
  return truck;
}

// --- tanks: the Sherman and the M3A1, transcribed off the live Wake scene ---
//
// Unlike the Willy above (built from `Objects.con`/`Physics.con` because the
// extracted scene is not in the repository), these two are transcribed
// straight off `viewer/maps/wake/scene.glb` node-for-node: every spring's own
// local position and `extras.physics`, read out with a one-off script against
// the actual extract rather than the `.con` source, so `collectChassis`'s
// grip-class walk (`c_PGFEngineGrip` / `c_PGFEngineDummyGrip` /
// `c_PGFRollGrip`) is exercised on the real per-side wheel count (two driven
// bogies a side, not one — TANK-14 says "x2 per side" and the first pass at
// this fixture missed it) rather than a simplified stand-in.

function spring(name, parent, pos, grip, strength, damping) {
  const node = new THREE.Object3D();
  node.name = name;
  node.position.set(...pos);
  node.userData = { templateKind: 'Spring', physics: { grip, strength, damping } };
  parent.add(node);
  return node;
}

/**
 * `Sherman` (`viewer/maps/wake/scene.glb`, node indices 1727-1756): two
 * driven `ShermanWheelL3/R3` bogies a side (`strength 18`/`damping 4`), four
 * dummy rollers a side (`strength 0`/`damping 0`), the Engine's own +-1
 * degree body-lean axes, and the turret rig (`ShermanTower`/`ShermanGunBase`)
 * a driver's own `TrackedVehicle` collects incidentally same as it would the
 * real thing, and never drives.
 */
function shermanNode() {
  const root = new THREE.Object3D();
  root.name = 'Sherman';
  root.userData = {
    control: 'Sherman', templateKind: 'PlayerControlObject',
    physics: { mass: 25000, drag: 2, vehicleCategory: 'VCLand' },
  };
  const lod = new THREE.Object3D(); lod.name = 'lodSherman'; root.add(lod);
  const complex = new THREE.Object3D(); complex.name = 'ShermanComplex'; lod.add(complex);

  const engine = new THREE.Object3D();
  engine.name = 'ShermanEngine';
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType: 'c_ETTank', torque: 4, differential: 4, numberOfGears: 5,
      gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
      // `setMinRotation -1/0/-1`, `setMaxRotation 1/0/1`,
      // `setMaxSpeed 4/0/10`, `setAcceleration 4/0/10`: full throttle in
      // 1/10 = 0.1 s, full lock in 1/4 = 0.25 s.
      maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
    },
    rig: {
      control: 'Sherman', automaticReset: true,
      axes: {
        yaw: { input: 'c_PIYaw', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 4, direction: 1 },
        roll: { input: 'c_PIThrottle', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 10, direction: 1 },
      },
    },
  };
  complex.add(engine);

  const trackL = new THREE.Object3D(); trackL.name = 'ShermanTrackL'; trackL.position.set(-0.009, -0.799, 0); engine.add(trackL);
  const trackR = new THREE.Object3D(); trackR.name = 'ShermanTrackR'; trackR.position.set(0.01, -0.799, 0); engine.add(trackR);
  spring('ShermanWheelL3Dummy', trackL, [-0.999, 0.12, -2.05], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelL3', trackL, [-0.999, 0.12, -1.2], 'c_PGFEngineGrip', 18, 4);
  spring('ShermanWheelL3DummyMiddle', trackL, [-0.999, 0.12, 0.449], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelL3Dummy2', trackL, [-0.999, 0.12, -0.3], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelL3b', trackL, [-0.999, 0.12, 1.249], 'c_PGFEngineGrip', 18, 4);
  spring('ShermanWheelL3Dummy3', trackL, [-0.999, 0.12, 2.049], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelR3Dummy', trackR, [1, 0.12, -2.05], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelR3', trackR, [1, 0.12, -1.2], 'c_PGFEngineGrip', 18, 4);
  spring('ShermanWheelR3DummyMiddle', trackR, [1, 0.12, 0.449], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelR3Dummy2', trackR, [1, 0.12, -0.3], 'c_PGFEngineDummyGrip', 0, 0);
  spring('ShermanWheelR3b', trackR, [1, 0.12, 1.249], 'c_PGFEngineGrip', 18, 4);
  spring('ShermanWheelR3Dummy3', trackR, [1, 0.12, 2.049], 'c_PGFEngineDummyGrip', 0, 0);

  const tower = new THREE.Object3D();
  tower.name = 'ShermanTower';
  tower.position.set(0, -0.8, 0);
  tower.userData = {
    templateKind: 'RotationalBundle',
    rig: {
      control: 'Sherman', automaticReset: false,
      axes: { yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, driver: 'position', maxSpeed: 35, direction: 1 } },
    },
  };
  complex.add(tower);
  return root;
}

/**
 * `M3A1` (`viewer/maps/wake/scene.glb`, node indices 2245-2276): the same
 * two-driven-bogie-a-side pattern as the Sherman (`strength 20`/`damping 5`)
 * plus a second dummy wheel family (`M3A1Wheel2`/`3`), and — what a Sherman
 * has no equivalent of — a genuinely steerable front axle, `M3A1Wheel1`, a
 * `RotationalBundle` on `c_PIYaw` at +-40 degrees (`c_PGFRollGrip`,
 * `strength 28`/`damping 7`), one either side of the hull (TANK-15).
 */
function m3a1Node() {
  const root = new THREE.Object3D();
  root.name = 'M3A1';
  root.userData = {
    control: 'M3A1', templateKind: 'PlayerControlObject',
    physics: { mass: 15000, drag: 2, vehicleCategory: 'VCLand' },
  };
  const lod = new THREE.Object3D(); lod.name = 'lodM3A1'; root.add(lod);
  const complex = new THREE.Object3D(); complex.name = 'M3A1Complex'; lod.add(complex);

  const engine = new THREE.Object3D();
  engine.name = 'M3A1Engine';
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType: 'c_ETTank', torque: 5, differential: 5, numberOfGears: 4,
      gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
      // `setMinRotation -1/0/-1`, `setMaxRotation 1/0/1`,
      // `setMaxSpeed 4/0/10`, `setAcceleration 4/0/10`: full throttle in
      // 1/10 = 0.1 s, full lock in 1/4 = 0.25 s.
      maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
    },
    rig: {
      control: 'M3A1', automaticReset: true,
      axes: {
        yaw: { input: 'c_PIYaw', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 4, direction: 1 },
        roll: { input: 'c_PIThrottle', min: -1, max: 1, free: false, driver: 'position', maxSpeed: 10, direction: 1 },
      },
    },
  };
  complex.add(engine);

  const trackL = new THREE.Object3D(); trackL.name = 'm3a1TrackL'; trackL.position.set(0, -0.749, 0.949); engine.add(trackL);
  spring('M3A1Wheel4Left', trackL, [-0.974, -0.519, -0.6], 'c_PGFEngineGrip', 20, 5);
  spring('M3A1Wheel4Right', trackL, [0.975, -0.519, -0.6], 'c_PGFEngineGrip', 20, 5);
  spring('M3A1Wheel4LeftDummy', trackL, [-0.974, -0.519, -0.3], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel4RightDummy', trackL, [0.975, -0.519, -0.3], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel4LeftBack', trackL, [-0.974, -0.519, 0.499], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel4RightBack', trackL, [0.975, -0.519, 0.499], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel4Left2', trackL, [-0.974, -0.519, 0.799], 'c_PGFEngineGrip', 20, 5);
  spring('M3A1Wheel4Right2', trackL, [0.975, -0.519, 0.799], 'c_PGFEngineGrip', 20, 5);
  spring('M3A1Wheel2a', trackL, [-0.999, 0.18, -1.08], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel2b', trackL, [1, 0.18, -1.08], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel2c', trackL, [-0.999, 0.15, 1.189], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel2d', trackL, [1, 0.15, 1.189], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel3a', trackL, [-1.089, 0.4, 0.074], 'c_PGFEngineDummyGrip', 0, 0);
  spring('M3A1Wheel3b', trackL, [1.09, 0.4, 0.074], 'c_PGFEngineDummyGrip', 0, 0);

  const steerRig = {
    control: 'M3A1', automaticReset: true,
    axes: { yaw: { input: 'c_PIYaw', min: -40, max: 40, free: false, driver: 'position', maxSpeed: 80, direction: 1 } },
  };
  for (const side of [1, -1]) {
    const bundle = new THREE.Object3D();
    bundle.name = side > 0 ? 'M3A1Wheel1R' : 'M3A1Wheel1';
    bundle.position.set(0.449 * side, 0.15, -3);
    bundle.userData = { templateKind: 'RotationalBundle', rig: steerRig };
    spring('M3A1Spring1', bundle, [0.299 * side, -0.999, 0], 'c_PGFRollGrip', 28, 7);
    complex.add(bundle);
  }
  return root;
}

/** A tank standing on (or dropped just above) analytic ground. */
function tank(nodeFn, { ground = () => 0, y = 0.6, speed = 0, surface } = {}) {
  const truck = new TrackedVehicle(nodeFn(), null, {
    cockpit: false, groundHeight: ground,
    ...(surface ? { surfaceFriction: surface } : {}),
  });
  const s = truck.state;
  s.position.set(0, y, 0);
  s.velocity.set(0, 0, -speed);
  return truck;
}

const forwardOf = truck =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(truck.state.orientation);
const upOf = truck =>
  new THREE.Vector3(0, 1, 0).applyQuaternion(truck.state.orientation);

/** Forward road speed, signed. */
const alongOf = truck => truck.state.velocity.dot(forwardOf(truck));

const pitchDeg = truck =>
  Math.asin(Math.max(-1, Math.min(1, forwardOf(truck).y))) * DEG;
const rollDeg = truck => {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(truck.state.orientation);
  return Math.asin(Math.max(-1, Math.min(1, right.y))) * DEG;
};

const round = (value, places = 3) => +value.toFixed(places);

function snapshot(truck) {
  const s = truck.state;
  return {
    speed: round(s.velocity.length()),
    along: round(alongOf(truck)),
    vy: round(s.velocity.y),
    y: round(s.position.y),
    pitch: round(pitchDeg(truck)),
    roll: round(rollDeg(truck)),
    gear: truck.gear,
    grounded: s.grounded,
    loads: truck.wheels.map(w => round(w.load, 2)),
  };
}

function drive(truck, seconds, pilot) {
  truck.clock = truck.clock ?? 0;
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    if (typeof pilot === 'function') pilot(truck, truck.clock);
    truck.integrate(DT);
    truck.clock += DT;
  }
  return truck;
}

const holding = inputs => truck => {
  for (const [name, value] of Object.entries(inputs)) truck.setInput(name, value);
};

const results = {};

// --- the constants and what they solve to -----------------------------------

results.constants = {
  gravity: GRAVITY,
  mass: WILLYS.mass,
  torque: WILLYS.torque,
  differential: WILLYS.differential,
  numberOfGears: WILLYS.numberOfGears,
  gearUp: WILLYS.gearUp,
  gearDown: WILLYS.gearDown,
  wheelRadius: WILLYS.wheelRadius,
  springStrength: WILLYS.springStrength,
  springDamping: WILLYS.springDamping,
  maxSteer: WILLYS.maxSteer,
  // The four constants items 15 and 16 deleted. Asserted absent, because a
  // later edit that reintroduces any of them has reintroduced an invention.
  hasMu: 'mu' in WILLYS,
  hasTankMu: 'mu' in TANK,
  hasLateralMu: 'lateralMu' in TANK,
  hasGearRatios: 'gearRatios' in WILLYS,
  hasReverseRatio: 'reverseRatio' in WILLYS,
  hasRevLimit: 'revLimit' in WILLYS,
};

{
  const k = WILLYS;
  const ladder = gearLadder(k.differential, k.numberOfGears);
  results.solved = {
    // Full-rev road speed in top gear, m/s: the engine's own EngineGrip
    // target at that ratio (TANK-9 as corrected), taken at the engine's own
    // rev clamp. No fitted rev ceiling in it.
    revCapSpeed: round(ENGINE_REV_CEILING * ladder[ladder.length - 1]),
    // Per-gear full-rev speeds, the ladder the automatic climbs.
    gearSpeeds: ladder.map(r => round(ENGINE_REV_CEILING * r, 2)),
    // The rev clamp itself, both arms — asymmetric, and reverse runs on the
    // lower one.
    revCeiling: ENGINE_REV_CEILING,
    revFloor: ENGINE_REV_FLOOR,
    reverseCapSpeed: round(ENGINE_REV_FLOOR * ladder[0], 3),
    // The EngineGrip target at the two ends of the gear-change blend. `b`
    // is the gear-change timer; it is 0 in all steady driving, and the whole
    // 46.5 km/h reading came from taking its constructor seed of 1 for the
    // steady value.
    gripTargetSteady: round(engineGripTarget(1, 0, 0, ladder[0]), 3),
    gripTargetMidChange: round(engineGripTarget(1, 0, 0, ladder[0], 1, 0), 3),
    gripTargetMidChangeAtSpeed:
      round(engineGripTarget(1, 0, 0, ladder[0], 1, 4), 3),
    // The ratio ladder itself, and the drive share each gear gets — the two
    // that run in opposite directions.
    ladder: ladder.map(r => round(r, 3)),
    driveShare: ladder.map(r => round(ladder[0] / r, 3)),
    // PHY-5: every spring acts at `g * (-1/9.82)` times its authored
    // strength, which is 1.5 at the shipped -14.73. Four springs at an
    // effective 37.5 carry 14.73, so the heave sits that far in from rest —
    // 0.098 m, where reading `setStrength` literally said 0.147.
    springScale: round(-GRAVITY / 9.82, 4),
    staticCompression: round(-GRAVITY / (4 * 1.5 * k.springStrength)),
    // Heave: omega = sqrt(4 * 1.5 * k), critical damping 2 omega, supplied
    // 4 x 5. The old "exactly critical" coincidence (2*sqrt(100) = 20 = 4*5)
    // depended on dropping the 1.5; with it the ratio is 1/sqrt(1.5).
    heaveOmega: round(Math.sqrt(4 * 1.5 * k.springStrength), 2),
    heaveDampingRatio: round(
      4 * k.springDamping / (2 * Math.sqrt(4 * 1.5 * k.springStrength)), 3),
  };
}

// --- the chassis reads off the tree ------------------------------------------

{
  const truck = jeep();
  results.chassis = {
    wheels: truck.wheels.length,
    driven: truck.wheels.filter(w => w.driven).length,
    steered: truck.wheels.filter(w => w.steered).length,
    engine: { ...truck.engine },
    hasCamera: !!truck.cameraNode,
    riggedParts: truck.parts.length,
    rests: truck.wheels.map(w =>
      [round(w.rest.x, 3), round(w.rest.y, 3), round(w.rest.z, 3)]),
  };
}

// --- settling ----------------------------------------------------------------

// Dropped from a hand's height above its wheels and left alone. It must take
// its weight on all four springs, sit level within the static rake the
// asymmetric wheelbase buys (front axle 0.75 m from the origin, rear 1.46 m,
// so the nose carries two thirds of the weight), and never sink through.
{
  const truck = jeep({ y: 0.8 });
  let minY = Infinity;
  drive(truck, 6, () => {
    minY = Math.min(minY, truck.state.position.y);
  });
  results.settle = {
    ...snapshot(truck),
    minY: round(minY),
    totalLoad: round(truck.wheels.reduce((sum, w) => sum + w.load, 0), 2),
  };
}

// The same, at the page's worst frame. `map.html` clamps `THREE.Clock` at
// 0.1 s; the internal substepper has to make that land where 1/60 does.
{
  const truck = jeep({ y: 0.8 });
  for (let t = 0; t < 6; t += 0.1) truck.integrate(0.1);
  results.settleCoarse = snapshot(truck);
}

// --- parked, and the damper's first tick -------------------------------------
//
// Ten seconds standing still after ten seconds of settling. Nothing may sink
// (every wheel's compression identical at both marks) and nothing may creep
// off on its own. Since PHY-5 the spring axis leans with the hull, so a hull
// on its static rake has a real horizontal component of suspension force and
// only the parking hold answers it; this is the scenario that catches the
// hold being sized in the wrong units.
results.parked = {};
for (const [name, make] of [
  ['willy', () => jeep({ y: 0.6 })],
  ['sherman', () => tank(shermanNode, { y: 1.2 })],
  ['m3a1', () => tank(m3a1Node, { y: 1.5 })],
]) {
  const truck = make();
  drive(truck, 10);
  const p0 = truck.state.position.clone();
  const y0 = p0.y;
  const first = truck.wheels.map(w => round(w.compression, 5));
  drive(truck, 10);
  results.parked[name] = {
    drift: round(Math.hypot(truck.state.position.x - p0.x,
      truck.state.position.z - p0.z), 4),
    sink: round(truck.state.position.y - y0, 6),
    speed: round(truck.state.velocity.length(), 4),
    compressionsHeld:
      JSON.stringify(first) === JSON.stringify(truck.wheels.map(w => round(w.compression, 5))),
    contacts: first.filter(c => c > 0).length,
  };
}

// How often a wheel comes back into contact having been airborne — the ticks
// on which the damper has no backward difference to take. Zeroing its rate
// there (rather than seeding it from the axle's closing speed) turns the
// damper off on every one of these, which is why the count matters.
{
  const bumps = (x, z) => 0.35 * Math.sin(z * 0.8) + 0.2 * Math.sin(z * 0.31 + 1);
  results.recontacts = {};
  for (const [name, make] of [
    ['willy', () => jeep({ ground: bumps, y: 0.6 })],
    ['m3a1', () => tank(m3a1Node, { ground: bumps, y: 1.5 })],
  ]) {
    let contacts = 0;
    let recontacts = 0;
    const probe = make();
    for (let i = 0; i < Math.round(20 / DT); i++) {
      holding({ c_PIThrottle: 1 })(probe);
      const before = probe.wheels.map(w => w.prevCompression);
      probe.integrate(DT);
      probe.wheels.forEach((w, k) => {
        if (w.compression <= 0) return;
        contacts += 1;
        if (before[k] === null) recontacts += 1;
      });
    }
    results.recontacts[name] = {
      contacts,
      recontacts,
      share: round(recontacts / Math.max(1, contacts), 4),
      finite: Number.isFinite(probe.state.position.y),
      apex: round(probe.state.position.y, 2),
    };
  }
}

// --- full throttle -----------------------------------------------------------

// Floored from rest for forty seconds. The speed has to climb the gear
// ladder and settle where faded top-gear drive meets resistance — the
// solved 18.3 m/s, 66 km/h — and it has to still be pointing down -Z.
{
  const truck = jeep();
  drive(truck, 2);           // settle first, so the launch is from rest
  const marks = {};
  drive(truck, 40, (t, clock) => {
    holding({ c_PIThrottle: 1 })(t);
    for (const at of [5, 10, 20]) {
      if (Math.abs(clock - (2 + at)) < DT / 2) marks[at] = round(alongOf(t));
    }
  });
  results.fullThrottle = {
    ...snapshot(truck),
    at5s: marks[5], at10s: marks[10], at20s: marks[20],
    kmh: round(alongOf(truck) * 3.6, 1),
    heading: round(forwardOf(truck).z, 3),
    drift: round(Math.abs(truck.state.position.x), 2),
  };
}

// --- steering ----------------------------------------------------------------

// Up to speed, then half lock held. Positive `c_PIYaw` must curve the path
// to the right — a negative yaw rate, the aircraft convention — hold a
// steady rate without flipping, and keep the body roll inside what a jeep
// visibly does.
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 10, holding({ c_PIThrottle: 1 }));
  const entrySpeed = round(alongOf(truck));
  const heading = t => Math.atan2(-forwardOf(t).x, -forwardOf(t).z);
  let yawSum = 0, ticks = 0, worstRoll = 0, minUp = 1;
  // Accumulated tick by tick, because a 47 deg/s turn held for six seconds
  // goes most of the way round the compass and a single before/after
  // difference folds at 180.
  let turned = 0;
  let last = heading(truck);
  drive(truck, 6, t => {
    holding({ c_PIThrottle: 1, c_PIYaw: 0.5 })(t);
    yawSum += t.state.angularVelocity.y;
    ticks += 1;
    worstRoll = Math.max(worstRoll, Math.abs(rollDeg(t)));
    minUp = Math.min(minUp, upOf(t).y);
    const now = heading(t);
    let step = (now - last) * DEG;
    if (step > 180) step -= 360;
    if (step < -180) step += 360;
    turned += step;
    last = now;
  });
  results.steering = {
    entrySpeed,
    meanYawRate: round((yawSum / ticks) * DEG, 1),
    turnedDeg: round(turned, 1),
    worstRoll: round(worstRoll, 1),
    minUp: round(minUp),
    end: snapshot(truck),
  };
}

// Hands off the wheel again: the steering servo's automatic reset must
// straighten the wheels and the yaw rate die away.
//
// Two entries, because the answer depends on whether the throttle is still
// floored, and that is the whole of PHY-2's "power slide": the Coulomb
// budget is one circle per contact, so a driven wheel spending it on drive
// has nothing left to corner with. `fromSpeed` is a jeep already at its top
// speed when the wheel goes over — the drive demand is then nearly zero
// because the target and the road speed agree, so both axles have their full
// budget and the hull straightens. `fromRest` floors it into the turn from a
// standstill, where the rear axle is saturated for the whole manoeuvre.
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 10, holding({ c_PIThrottle: 1 }));
  drive(truck, 8, holding({ c_PIThrottle: 1, c_PIYaw: 0.4 }));
  const turning = round(truck.state.angularVelocity.y * DEG, 2);
  drive(truck, 4, holding({ c_PIThrottle: 1, c_PIYaw: 0 }));
  results.straighten = {
    turningRate: turning,
    yawRate: round(truck.state.angularVelocity.y * DEG, 2),
    roll: round(rollDeg(truck), 2),
  };
}
// The same, floored from rest — and then with the throttle lifted as well,
// which is what actually ends a power slide.
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 8, holding({ c_PIThrottle: 1, c_PIYaw: 0.4 }));
  drive(truck, 4, holding({ c_PIThrottle: 1, c_PIYaw: 0 }));
  const held = round(truck.state.angularVelocity.y * DEG, 2);
  drive(truck, 4, holding({ c_PIThrottle: 0, c_PIYaw: 0 }));
  results.straightenFromRest = {
    throttleHeld: held,
    throttleLifted: round(truck.state.angularVelocity.y * DEG, 2),
    speed: round(truck.state.velocity.length(), 2),
  };
}

// --- the step ----------------------------------------------------------------

// A 2 m shelf ends at z = -60; the jeep drives off it at speed. All four
// wheels must unload, the fall is plain gravity, and the landing is springs
// doing their work rather than numbers escaping.
{
  const shelf = (x, z) => (z > -60 ? 2 : 0);
  const truck = jeep({ ground: shelf, y: 2.6 });
  drive(truck, 2);
  let airborne = 0, worstSpeed = 0, worstVy = 0, landedAt = null;
  let leftShelfAt = null;
  drive(truck, 20, (t, clock) => {
    holding({ c_PIThrottle: 1 })(t);
    const off = t.state.position.z < -60;
    if (off && leftShelfAt === null) leftShelfAt = clock;
    if (!t.state.grounded) airborne += 1;
    else if (off && landedAt === null && airborne > 0) landedAt = clock;
    worstSpeed = Math.max(worstSpeed, t.state.velocity.length());
    worstVy = Math.min(worstVy, t.state.velocity.y);
  });
  const s = truck.state;
  results.stepDrop = {
    airborneSeconds: round(airborne * DT, 2),
    fellFor: leftShelfAt !== null && landedAt !== null
      ? round(landedAt - leftShelfAt, 2) : null,
    worstSpeed: round(worstSpeed),
    worstVy: round(worstVy),
    finite: [s.position, s.velocity].every(v =>
      Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)),
    end: snapshot(truck),
  };
}

// --- the spring axis leans with the hull (PHY-5) -----------------------------
//
// A slope steep enough to lean the jeep visibly. The probe now runs down the
// hull's own +Y — `SpringTemplate`'s `axisFixation`, which nothing in 18
// installs overrides — so a leaning hull reads its wheels further away than a
// world-vertical drop would, by 1/cos(lean).
{
  const slope = 0.3;                      // ~16.7 degrees
  const ramp = (x, z) => -z * slope;
  const truck = jeep({ ground: ramp, y: 2 });
  drive(truck, 6);
  const s = truck.state;
  results.slope = {
    grounded: s.grounded,
    pitchDeg: round(pitchDeg(truck), 2),
    // It sits pitched with the ground rather than staying level.
    slopeDeg: round(Math.atan(slope) * DEG, 2),
    loads: truck.wheels.map(w => round(w.load, 2)),
    totalLoad: round(truck.wheels.reduce((n, w) => n + w.load, 0), 2),
    // How much further the axis probe reaches than a vertical drop at this
    // lean: exactly 1/cos(pitch), which is what the correction buys.
    axisStretch: round(1 / Math.cos(Math.atan(slope)), 4),
  };
}

// --- material friction (PHY-2) ------------------------------------------------
//
// The whole point of item 16: the surface under the wheel decides the Coulomb
// budget, and the mean of the two contacting materials is what the engine
// spends. `materialFriction` of the vanilla terrain ids, as
// `MaterialManagerdefine.con` authors them.
const TERRAIN_FRICTION = {
  water: 0.1, mud: 0.5, rock: 0.6, grass: 0.8, sand: 0.8,
  dirtRoad: 1.0, defaultGround: 1.0, paved: 1.1, gravel: 1.1,
};

{
  // A wheel's own material (37/38/178) is undefined in vanilla, so it falls
  // back to material 0 at 1.0 and the pair means to 0.5*(1 + ground).
  results.surfaceFriction = {};
  for (const [name, value] of Object.entries(TERRAIN_FRICTION)) {
    const truck = jeep({ surface: () => value });
    drive(truck, 2);
    results.surfaceFriction[name] = {
      pairMean: round(truck.wheels[0].friction, 4),
      // Braking distance from the same entry speed. The only thing that
      // differs between these runs is the material under the tyre.
      stopDistance: null,
    };
  }
  // Brake-to-stop distance per surface, from a common 10 m/s entry.
  for (const [name, value] of Object.entries(TERRAIN_FRICTION)) {
    const truck = jeep({ surface: () => value, speed: 10 });
    drive(truck, 0.5);
    const startZ = truck.state.position.z;
    let stopped = null;
    drive(truck, 12, t => {
      holding({ c_PIThrottle: -1 })(t);
      if (stopped === null && alongOf(t) <= 0.05) {
        stopped = round(Math.abs(t.state.position.z - startZ), 2);
      }
    });
    results.surfaceFriction[name].stopDistance = stopped;
  }
  // Launch is where the surface genuinely bites. First gear asks 10.5 m/s^2
  // of the two rear wheels, which carry only a third of the weight between
  // them — far more than any of these materials can answer — so the jeep
  // leaves the line at the Coulomb cap itself and the time to 10 m/s is a
  // direct read of it.
  for (const [name, value] of Object.entries(TERRAIN_FRICTION)) {
    const truck = jeep({ surface: () => value });
    drive(truck, 1);
    let reached = null;
    drive(truck, 25, (t, clock) => {
      holding({ c_PIThrottle: 1 })(t);
      if (reached === null && alongOf(t) >= 10) reached = round(clock - 1, 2);
    });
    results.surfaceFriction[name].to10 = reached;
    results.surfaceFriction[name].launchAccel =
      round(truck.wheels.filter(w => w.driven).length * 0.5 * (1 + value), 3);
  }
}

{
  // The 1.5:1 hysteresis, observed rather than asserted on a constant: a
  // parked jeep stands on latched contacts, and a jeep that has just been
  // braking hard does not.
  const parked = jeep();
  drive(parked, 2);
  const rolling = jeep({ speed: 12 });
  drive(rolling, 0.5);
  drive(rolling, 1.5, holding({ c_PIThrottle: -1 }));
  const airborne = jeep({ ground: () => -50, y: 5 });
  drive(airborne, 0.5);
  results.gripLatch = {
    parked: parked.wheels.map(w => w.staticGrip),
    braking: rolling.wheels.map(w => w.staticGrip),
    airborne: airborne.wheels.map(w => w.staticGrip),
  };
}

// --- brake and reverse -------------------------------------------------------

// From top speed, throttle hard the other way: brake to a stop. Then keep
// holding it: the same input must back the jeep up, at first gear's pace.
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 30, holding({ c_PIThrottle: 1 }));
  const entry = round(alongOf(truck));
  let stoppedAt = null;
  drive(truck, 10, (t, clock) => {
    holding({ c_PIThrottle: -1 })(t);
    if (stoppedAt === null && Math.abs(alongOf(t)) < 0.5) {
      stoppedAt = round(clock - 32, 2);
    }
  });
  const reversing = round(alongOf(truck));
  drive(truck, 6, holding({ c_PIThrottle: -1 }));
  results.brake = {
    entry,
    stoppedAt,
    reversingAt10s: reversing,
    reverseSpeed: round(-alongOf(truck)),
    reverseKmh: round(-alongOf(truck) * 3.6, 1),
  };
}

// And having reversed, forward throttle brakes the backward motion first.
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 8, holding({ c_PIThrottle: -1 }));
  const backward = round(alongOf(truck));
  drive(truck, 6, holding({ c_PIThrottle: 1 }));
  results.aboutFace = { backward, forward: round(alongOf(truck)) };
}

// --- coasting ----------------------------------------------------------------

// Throttle released at speed: rolling resistance and engine braking bleed it
// off. No hand brake in the game and none here, so it is a long coast, but
// it must be a coast and not a cruise.
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 20, holding({ c_PIThrottle: 1 }));
  const entry = round(alongOf(truck));
  drive(truck, 3, holding({ c_PIThrottle: 0 }));
  const after3s = round(alongOf(truck));
  drive(truck, 12, holding({ c_PIThrottle: 0 }));
  results.coast = { entry, after3s, after15s: round(alongOf(truck)) };
}

// --- the wheels turn ---------------------------------------------------------

{
  const truck = jeep();
  drive(truck, 2);
  const before = truck.wheels.map(w => w.angle);
  drive(truck, 5, holding({ c_PIThrottle: 1 }));
  results.wheelSpin = {
    turned: truck.wheels.map((w, i) => round(Math.abs(w.angle - before[i]), 1)),
    // Compression lifts the wheel node up its travel; at rest that is the
    // static compression, visible as the node sitting above its glb pose.
    lift: truck.wheels.map(w =>
      round(w.node.position.y - w.basePosition.y, 3)),
  };
}

// --- the camera still reads nothing but state --------------------------------

{
  const truck = jeep();
  drive(truck, 3);
  const pose = truck.cameraPose();
  results.camera = {
    hasNode: !!truck.cameraNode,
    y: round(pose.position.y, 2),
  };
}

// === TrackedVehicle: tanks and half-tracks =================================

// --- the corrected gear-ratio curve, in isolation ---------------------------
//
// The single most important regression guard in this file, and it has been
// wrong once already. TANK-3 (2026-09-19) refuted the "flat at 1.0 between
// five authored slots" model this file used to carry: the curve is filled
// piecewise-linearly, so the M3A1 IS near the smooth interpolation (5.512),
// every gear count gets a real ratio, and the ladder is non-monotonic above
// five gears. 17.5 must never come back.
results.tankRatios = {
  // Full ladders, gear 1..n. The three the brief pins.
  sherman: gearLadder(4, 5).map(r => round(r, 3)),
  willy: gearLadder(7, 5).map(r => round(r, 3)),
  m3a1: gearLadder(5, 4).map(r => round(r, 3)),
  // First gear alone, the number a tracked hull actually spends (TANK-7).
  shermanFirst: round(engineRatio(4, 1, 5), 4),
  willyFirst: round(engineRatio(7, 1, 5), 4),
  m3a1First: round(engineRatio(5, 1, 4), 4),
  // The refuted model said every count but 1 and 5 reduces to 3.5*diff =
  // 12.25 here. None of them does.
  offCurve: [2, 3, 6, 7, 8, 9, 10].map(n => round(engineRatio(3.5, 1, n), 4)),
  // A single gear is index 100, the aircraft case: 3.5*diff/0.94.
  singleGear: round(engineRatio(1, 1, 1), 4),
  // Non-monotonic above five gears: nGears 8, differential 5 -> g1 > g2.
  eightSpeed: gearLadder(5, 8).map(r => round(r, 3)),
  // A mod's 50-speed still lands on real, distinct ratios.
  fiftySpeedEnds: [1, 2, 25, 50].map(g => round(engineRatio(4, g, 50), 3)),
  // The curve itself, read at the decades: `engineRatio(1, i, 100)` is
  // `3.5 / curve[i]`, so the sample is 3.5 over it. This is the shape
  // `overTimeDistribution` fills, including the 0..20 ramp off the ctor
  // default that the refuted model did not have.
  curveByTen: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(i =>
    round(3.5 / engineRatio(1, i, 100), 4)),
};

// --- the second curve (TANK-4), indexed by revs, not by the gear -----------
results.torqueCurve = {
  byTen: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    .map(r => round(engineTorqueFraction(r), 4)),
  peak: round(engineTorqueFraction(0.6), 4),
  // |revs| is clamped at 1.0 and the sign is dropped.
  overRev: round(engineTorqueFraction(4.2), 4),
  negative: round(engineTorqueFraction(-0.6), 4),
};

results.diffRPM = {
  straightFull: round(differentialRPM(1, 0, 1), 4),        // side=0 case via yaw=0: 1
  halfLockOuter: round(differentialRPM(1, 0.5, 1), 4),      // 1*(1-1.5*0.5) = 0.25
  halfLockInner: round(differentialRPM(1, 0.5, -1), 4),     // 1*(1+1.5*0.5)=1.75, clamped to 1
  centreline: round(differentialRPM(1, 0.5, 0), 4),         // side===0: plain throttle
  // TANK-17: zero throttle is zero on both sides regardless of yaw.
  noThrottleRight: round(differentialRPM(0, 0.9, 1), 4),
  noThrottleLeft: round(differentialRPM(0, 0.9, -1), 4),
};

// --- the chassis reads off the tree, for two very different tanks ----------

{
  const t = tank(shermanNode);
  results.shermanChassis = {
    wheels: t.wheels.length,
    driven: t.wheels.filter(w => w.driven).length,
    dummy: t.wheels.filter(w => w.dummy).length,
    steered: t.wheels.filter(w => w.steered).length,
    engine: { differential: t.engine.differential, numberOfGears: t.engine.numberOfGears },
    ratio: round(t.ratio, 4),
    // Every driven wheel found a real side, none dead on the centreline.
    drivenSides: t.wheels.filter(w => w.driven).map(w => w.side),
  };
}
{
  const t = tank(m3a1Node);
  results.m3a1Chassis = {
    wheels: t.wheels.length,
    driven: t.wheels.filter(w => w.driven).length,
    dummy: t.wheels.filter(w => w.dummy).length,
    steered: t.wheels.filter(w => w.steered).length,
    engine: { differential: t.engine.differential, numberOfGears: t.engine.numberOfGears },
    ratio: round(t.ratio, 4),
    steerMax: t.wheels.filter(w => w.steered).map(w => w.steerMax),
  };
}

// --- settling: both tanks stand on only their driven wheels' springs -------
//
// Every dummy roller and the M3A1's own front axle carry real
// strength/damping too (the front axle, `c_PGFRollGrip`, is a genuine tyre),
// but a Sherman's whole 25-tonne hull is carried by just 4 of its 12 spring
// wheels — see `TANK.suspensionTravel`'s own comment for why that changes
// the fallback travel a Willys can get away with.
for (const [key, builder] of [['shermanSettle', shermanNode], ['m3a1Settle', m3a1Node]]) {
  const t = tank(builder, { y: 0.5 });
  drive(t, 4);
  const driven = t.wheels.filter(w => w.driven);
  results[key] = {
    ...snapshot(t),
    drivenLoads: driven.map(w => round(w.load, 2)),
    totalDrivenLoad: round(driven.reduce((sum, w) => sum + w.load, 0), 2),
    dummyLoads: t.wheels.filter(w => w.dummy).map(w => round(w.load, 3)),
  };
}

// --- straight-line driving ---------------------------------------------------

for (const [key, builder] of [['shermanStraight', shermanNode], ['m3a1Straight', m3a1Node]]) {
  const t = tank(builder, { y: 0.5 });
  drive(t, 4);
  const marks = {};
  drive(t, 20, (tt, clock) => {
    holding({ c_PIThrottle: 1 })(tt);
    for (const at of [5, 10, 20]) {
      if (Math.abs(clock - (4 + at)) < DT / 2) marks[at] = round(alongOf(tt));
    }
  });
  results[key] = {
    ...snapshot(t),
    at5s: marks[5], at10s: marks[10], at20s: marks[20],
    kmh: round(alongOf(t) * 3.6, 1),
    heading: round(forwardOf(t).z, 3),
    drift: round(Math.abs(t.state.position.x), 2),
  };
}

// --- turning: both directions, both vehicles, held from a stand-still ------
//
// Held from rest rather than from top speed (unlike Willy's own steering
// test) because that is what actually stressed the model during this track's
// own work: a sustained turn built from a stand-still once rolled the M3A1
// onto its roof (`TANK.angularDamping`'s own comment has the story), so this
// is the regression that constant now has to keep passing.
for (const [key, builder] of [['shermanTurn', shermanNode], ['m3a1Turn', m3a1Node]]) {
  for (const [dir, yaw] of [['right', 0.5], ['left', -0.5]]) {
    const t = tank(builder, { y: 0.5 });
    drive(t, 4);
    let worstUp = 1;
    drive(t, 8, tt => {
      holding({ c_PIThrottle: 1, c_PIYaw: yaw })(tt);
      worstUp = Math.min(worstUp, upOf(tt).y);
    });
    results[`${key}${dir === 'right' ? 'Right' : 'Left'}`] = {
      yawRateDeg: round(t.state.angularVelocity.y * DEG, 2),
      worstUp: round(worstUp, 3),
      grounded: t.state.grounded,
      speed: round(t.state.velocity.length(), 2),
    };
  }
}

// The period-2 limit cycle guard. Driven at full lock at one sub-step per
// rendered frame, the model used to settle into a textbook alternating
// oscillation — body roll rate flipping -15.08 / +14.91 deg/s and the four
// wheel loads swapping sides on alternate frames, for ever — which is the
// judder a player sees and is also what scrambles the differential, since
// the loads the track forces scale with are the ones oscillating. Recorded
// as the sign changes in the roll rate over a second of a settled turn: a
// converged integrator gives 0 or 1, the limit cycle gives one per frame.
{
  const t = tank(shermanNode, { y: 0.5 });
  drive(t, 4);
  drive(t, 8, holding({ c_PIThrottle: 1, c_PIYaw: 1 }));
  let flips = 0;
  let previous = Math.sign(t.state.angularVelocity.z);
  let worst = 0;
  const loadSwing = [];
  drive(t, 1, tt => {
    holding({ c_PIThrottle: 1, c_PIYaw: 1 })(tt);
    const sign = Math.sign(tt.state.angularVelocity.z);
    if (sign !== 0 && previous !== 0 && sign !== previous) flips += 1;
    if (sign !== 0) previous = sign;
    worst = Math.max(worst, Math.abs(tt.state.angularVelocity.z));
    loadSwing.push(tt.wheels.filter(w => w.load > 0).map(w => w.load));
  });
  // How far a single wheel's load moves between consecutive frames, as a
  // fraction of its own value: the limit cycle swung them ~40% every frame.
  let worstLoadStep = 0;
  for (let i = 1; i < loadSwing.length; i++) {
    for (let j = 0; j < loadSwing[i].length; j++) {
      const a = loadSwing[i - 1][j];
      const b = loadSwing[i][j];
      if (a > 0.1) worstLoadStep = Math.max(worstLoadStep, Math.abs(b - a) / a);
    }
  }
  results.tankSteadyTurn = {
    rollSignFlipsPerSecond: flips,
    worstRollRateDeg: round(worst * DEG, 2),
    worstLoadStep: round(worstLoadStep, 4),
  };
}

// The steered front axle's own contribution, measured the only way it means
// anything: at a MATCHED speed. Comparing the two hulls' yaw rate at full
// throttle compares a 53.6 km/h vehicle against a 67.2 km/h one, and both
// are grip-limited, so the yaw-rate comparison that used to live here
// answered a question about top speed, not about the front axle. Held
// instead at a common ~4 m/s by a bang-bang throttle, and read as turn
// RADIUS (v / yawRate), which is what "turns tighter" actually means.
//
// 4 m/s, not 8: a turning tracked hull spends its Coulomb budget scrubbing
// the tracks sideways and cannot hold 8 m/s through a half-lock turn at any
// throttle — the Sherman settles at 4.1. That is the differential's own
// arithmetic (at half lock the outer track's target is `revs * 0.25`), not a
// limitation of the model.
results.tankMatchedTurn = [];
for (const [name, builder] of [['sherman', shermanNode], ['m3a1', m3a1Node]]) {
  const t = tank(builder, { y: 0.5 });
  // Half lock, not full. At full lock `getCurrentDifferentialRPM` gives the
  // outer track `clamp(revs * (1 - 1.5), -1, 1)` — it is driven BACKWARDS at
  // half the inner track's speed — so a tracked hull at full lock is very
  // nearly pivoting and cannot hold 8 m/s at any throttle. That is the
  // engine's own arithmetic, not a limitation of the model.
  const hold = tt => {
    tt.setInput('c_PIThrottle', tt.state.velocity.length() < 4 ? 1 : 0);
    tt.setInput('c_PIYaw', 0.5);
  };
  drive(t, 4, tt => tt.setInput('c_PIThrottle', tt.state.velocity.length() < 4 ? 1 : 0));
  drive(t, 12, hold);
  const v = t.state.velocity.length();
  const w = Math.abs(t.state.angularVelocity.y);
  results.tankMatchedTurn.push({
    name,
    speed: round(v, 2),
    yawRateDeg: round(t.state.angularVelocity.y * DEG, 2),
    radius: w > 1e-4 ? round(v / w, 1) : null,
  });
}

// A wider sweep, Sherman and M3A1 both, purely as the stability regression
// guard: every one of these must come out with the vehicle still upright.
results.tankStability = [];
for (const [name, builder] of [['sherman', shermanNode], ['m3a1', m3a1Node]]) {
  for (const yaw of [0.3, 0.5, 0.7, 1.0]) {
    const t = tank(builder, { y: 0.5 });
    drive(t, 3);
    let worstUp = 1;
    drive(t, 8, tt => {
      holding({ c_PIThrottle: 1, c_PIYaw: yaw })(tt);
      worstUp = Math.min(worstUp, upOf(tt).y);
    });
    results.tankStability.push({ name, yaw, worstUp: round(worstUp, 3) });
  }
}

// A second, harder stability case, distinct from the sweep above: turning
// held from the vehicle's own straight-line top speed rather than
// accelerating into it. The M3A1's extra ~10 m/s of entry speed very nearly
// doubles the centripetal load a held turn puts through the suspension, and
// this is what actually found `TANK.angularDamping`'s final value — 5.0
// (the fix for the stand-still case) survived the sweep above but still
// rolled the M3A1 here, at 12.0.
for (const [key, builder] of [['shermanHardTurn', shermanNode], ['m3a1HardTurn', m3a1Node]]) {
  const t = tank(builder, { y: 0.5 });
  drive(t, 4);
  drive(t, 6, holding({ c_PIThrottle: 1 }));
  const entrySpeed = t.state.velocity.length();
  let worstUp = 1;
  drive(t, 8, tt => {
    holding({ c_PIThrottle: 1, c_PIYaw: 0.6 })(tt);
    worstUp = Math.min(worstUp, upOf(tt).y);
  });
  results[key] = {
    entrySpeed: round(entrySpeed, 2),
    worstUp: round(worstUp, 3),
    grounded: t.state.grounded,
  };
}

// --- TANK-17: no pivoting on the spot from a stand-still --------------------

{
  const t = tank(shermanNode, { y: 0.5 });
  drive(t, 4);
  drive(t, 3, holding({ c_PIThrottle: 0, c_PIYaw: 1 }));
  results.tankPivot = {
    yawRate: round(t.state.angularVelocity.y, 5),
    speed: round(t.state.velocity.length(), 5),
  };
}

// --- reverse: the differential formula's own sign, no separate gear --------

{
  const t = tank(shermanNode, { y: 0.5 });
  drive(t, 4);
  drive(t, 8, holding({ c_PIThrottle: -1 }));
  results.tankReverse = { along: round(alongOf(t), 3) };
}

// --- reset -------------------------------------------------------------------

{
  const t = tank(shermanNode, { y: 0.5 });
  drive(t, 4, holding({ c_PIThrottle: 1, c_PIYaw: 0.5 }));
  const beforeAngles = t.wheels.map(w => w.angle);
  t.reset();
  results.tankReset = {
    velocity: t.state.velocity.toArray().map(v => round(v)),
    angularVelocity: t.state.angularVelocity.toArray().map(v => round(v)),
    everSpun: beforeAngles.some(a => Math.abs(a) > 0.1),
    anglesAfter: t.wheels.map(w => w.angle),
  };
}

// --- the two tracks visibly move at different rates mid-turn ---------------
//
// The entire visible point of differential steering: `TrackedVehicle` rolls
// a driven wheel at its own side's commanded rate (`this.ratio *
// differentialRPM(...)`), so a turn must show the two sides' wheels having
// travelled different amounts, not just the body having yawed.
{
  const t = tank(shermanNode, { y: 0.5 });
  drive(t, 4);
  const before = t.wheels.map(w => w.angle);
  drive(t, 4, holding({ c_PIThrottle: 1, c_PIYaw: 0.6 }));
  const turned = t.wheels.map((w, i) => Math.abs(w.angle - before[i]));
  const left = t.wheels.map((w, i) => [w, turned[i]]).filter(([w]) => w.driven && w.side < 0).map(([, a]) => a);
  const right = t.wheels.map((w, i) => [w, turned[i]]).filter(([w]) => w.driven && w.side > 0).map(([, a]) => a);
  results.tankWheelSpin = {
    left: left.map(a => round(a, 2)),
    right: right.map(a => round(a, 2)),
    // Same side, same rate — a differential splits left from right, not the
    // two bogies sharing one track.
    leftConsistent: round(Math.max(...left) - Math.min(...left), 3),
    rightConsistent: round(Math.max(...right) - Math.min(...right), 3),
  };
}


// === EngineState: every drivetrain constant against its ledger row =========
//
// `Engine::handleUpdate` 0x0823e120 (TANK-12), `PhysicsEngine::feedbackLoop`
// 0x0824c850 (TANK-13), `getCurrentDifferentialRPM` 0x0824c990 (TANK-9) and
// `EngineTemplate::getEngineType` slot +0xa0 (TANK-1). These run the state
// object directly, tick by tick, with no vehicle around it — so a viewer
// change that happens to look right on the page still has to answer for the
// arithmetic.

/** The three vanilla drivetrains, exactly as `Physics.con` authors them. */
const ENGINE_SPECS = {
  willy: {
    engineType: 'c_ETCar', torque: 10.5, differential: 7, numberOfGears: 5,
    gearUp: 0.95, gearDown: 0.4,
    maxRotation: [0, 0, 5000], maxSpeed: [0, 0, 55000], acceleration: [0, 0, 55000],
  },
  sherman: {
    engineType: 'c_ETTank', torque: 4, differential: 4, numberOfGears: 5,
    gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
    maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
  },
  tiger: {
    engineType: 'c_ETTank', torque: 3.5, differential: 3.5, numberOfGears: 5,
    gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
    maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
  },
  m3a1: {
    engineType: 'c_ETTank', torque: 5, differential: 5, numberOfGears: 4,
    gearUp: 0.95, gearDown: 0.45, gearChangeTime: 0.05,
    maxRotation: [1, 0, 1], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10],
  },
};

const TICK = 1 / 30;

results.engineTypes = {
  // The 26-entry jump table at 0x086cf7b0, and the ctor default 0 at
  // 0x0823f078 for anything that is not one of the six.
  names: { ...ENGINE_TYPES },
  car: engineTypeBits('c_ETCar'),
  tank: engineTypeBits('c_ETTank'),
  plane: engineTypeBits('c_ETPlane'),
  ship: engineTypeBits('c_ETShip'),
  rocket: engineTypeBits('c_ETRocket'),
  torpedo: engineTypeBits('c_ETTorpedo'),
  caseInsensitive: engineTypeBits('C_ETTANK'),
  unknown: engineTypeBits('c_ETHovercraft'),
  absent: engineTypeBits(undefined),
  // bit 0 is the ONLY gate on updatePhysics, and neither ground type has it.
  carHasThrust: (engineTypeBits('c_ETCar') & 1) !== 0,
  tankHasThrust: (engineTypeBits('c_ETTank') & 1) !== 0,
  planeHasThrust: (engineTypeBits('c_ETPlane') & 1) !== 0,
  shipHasThrust: (engineTypeBits('c_ETShip') & 1) !== 0,
};

results.diffRPMByType = {
  // (type & 4) == 0: the rev state, raw and unclamped, even at +1.2 and even
  // for a wheel well off the centreline. A car steers with its front wheels.
  carAtCeiling: round(currentDifferentialRPM(1.2, 0, 1, engineTypeBits('c_ETCar')), 4),
  carSteering: round(currentDifferentialRPM(1.2, 0.5, 1, engineTypeBits('c_ETCar')), 4),
  // (type & 4): split per side, then clamped to +-1 — which is where a
  // tank's 1.0 ceiling comes from, not from the rev clamp.
  tankAtCeiling: round(currentDifferentialRPM(1.2, 0, 1, engineTypeBits('c_ETTank')), 4),
  tankOuterHalfLock: round(currentDifferentialRPM(1.0, 0.5, 1, engineTypeBits('c_ETTank')), 4),
  tankInnerHalfLock: round(currentDifferentialRPM(1.0, 0.5, -1, engineTypeBits('c_ETTank')), 4),
  tankOuterFullLock: round(currentDifferentialRPM(1.0, 1, 1, engineTypeBits('c_ETTank')), 4),
  // side === 0 returns the rev state raw on a tank too (0x0824ca4a).
  tankCentreline: round(currentDifferentialRPM(1.2, 0.5, 0, engineTypeBits('c_ETTank')), 4),
  // An unknown type has no bits at all, so it behaves as a car here.
  unknownAtCeiling: round(currentDifferentialRPM(1.2, 0.5, 1, 0), 4),
};

{
  // The template defaults `EngineTemplate::EngineTemplate` 0x0823efc0 writes,
  // and `setNumberOfGears`'s own [1,5] clamp at 0x0823fd10.
  const bare = new EngineState({});
  const overGeared = new EngineState({ numberOfGears: 8, differential: 5 });
  const underGeared = new EngineState({ numberOfGears: 0 });
  results.engineDefaults = {
    numberOfGears: bare.numberOfGears,
    differential: bare.differential,
    torque: bare.torque,
    gearUp: bare.gearUp,
    gearDown: bare.gearDown,
    gearChangeTime: bare.gearChangeTime,
    bits: bare.bits,
    gear: bare.gear,
    revs: bare.revs,
    blend: bare.blend,
    gearsClampedHigh: overGeared.numberOfGears,
    gearsClampedLow: underGeared.numberOfGears,
    // The ladder a clamped 8-speed actually gets: five gears, the five-speed
    // ladder, NOT the non-monotonic eight-speed one the curve would give.
    clampedLadder: overGeared.ladder.map(r => round(r, 3)),
    rawEightSpeed: gearLadder(5, 8).map(r => round(r, 3)),
  };
}

{
  // The rev filter, run open-loop at full throttle with no load. `0.05` is
  // per TICK and not per second, so the wall-clock spool-up follows the tick
  // rate — the whole of TANK-12's rate qualifier.
  const e = new EngineState(ENGINE_SPECS.sherman);
  const trace = [];
  for (let i = 0; i < 200; i++) {
    e.tick(TICK, 1, 0);
    if (i < 4 || i === 9 || i === 39 || i === 199) {
      trace.push({ tick: i + 1, revs: round(e.revs, 5), t1: round(e.throttleTerm, 4), gear: e.gear });
    }
  }
  results.revFilter = {
    trace,
    ceiling: round(e.revs, 5),
    // One tick from rest with T1 already at 1: exactly the gain.
    firstStepFromT1: (() => {
      const probe = new EngineState({ ...ENGINE_SPECS.sherman, maxRotation: [1, 0, 0] });
      probe.tick(TICK, 1, 0);
      return round(probe.revs, 6);
    })(),
    // And the floor, reverse.
    floor: (() => {
      const probe = new EngineState(ENGINE_SPECS.sherman);
      for (let i = 0; i < 400; i++) probe.tick(TICK, -1, 0);
      return round(probe.revs, 5);
    })(),
  };
}

{
  // T1 is the CLIPPED ROLL ANGLE over maxRotation.z, not the pedal: a Willy
  // reaches it in 5000/55000 = 0.091 s and a Sherman in 1/10 = 0.1 s, and a
  // mod that changes either changes throttle response.
  const spool = spec => {
    const e = new EngineState(spec);
    let ticks = 0;
    while (e.throttleTerm < 0.999 && ticks < 300) { e.tick(TICK, 1, 0); ticks += 1; }
    return { seconds: round(ticks * TICK, 4), ticks };
  };
  const slow = new EngineState({ ...ENGINE_SPECS.sherman, maxRotation: [1, 0, 2], maxSpeed: [4, 0, 10], acceleration: [4, 0, 10] });
  slow.tick(TICK, 1, 0);
  results.throttleTerm = {
    willy: spool(ENGINE_SPECS.willy),
    sherman: spool(ENGINE_SPECS.sherman),
    // Double maxRotation.z with the same rate and the term is half as far
    // along after one tick: the divisor is real.
    doubledMaxRotation: round(slow.throttleTerm, 5),
    // No roll limit at all falls back to the pedal.
    noLimit: (() => {
      const e = new EngineState({ ...ENGINE_SPECS.sherman, maxRotation: [1, 0, 0] });
      e.tick(TICK, 0.5, 0);
      return round(e.throttleTerm, 4);
    })(),
  };
  // The steering term is the sibling: yaw angle over maxRotation.x, 0.25 s
  // to full lock on a Sherman, and 0 for an Engine with no yaw limit.
  const steer = new EngineState(ENGINE_SPECS.sherman);
  let steerTicks = 0;
  while (steer.steer < 0.999 && steerTicks < 300) { steer.tick(TICK, 1, 1); steerTicks += 1; }
  const carSteer = new EngineState(ENGINE_SPECS.willy);
  for (let i = 0; i < 60; i++) carSteer.tick(TICK, 1, 1);
  results.steerTerm = {
    shermanSeconds: round(steerTicks * TICK, 4),
    carSteer: round(carSteer.steer, 5),
  };
}

{
  // The gearbox. Up needs `revs > gearUp` AND the lockout expired AND a gear
  // to go to; down needs only `revs < gearDown` and a gear to come back to.
  const armed = new EngineState(ENGINE_SPECS.sherman);
  armed.revs = 1.0;                       // past gearUp
  armed.blend = 1.0;                      // lockout still running
  armed.tick(TICK, 1, 0);
  const lockedGear = armed.gear;
  const free = new EngineState(ENGINE_SPECS.sherman);
  free.blend = 0;
  free.revs = 1.0;
  free.tick(TICK, 1, 0);
  const down = new EngineState(ENGINE_SPECS.sherman);
  down.gear = 4;
  down.blend = 1.0;                       // NO lockout on the way down
  down.revs = 0.1;
  down.tick(TICK, 0, 0);
  const floorGear = new EngineState(ENGINE_SPECS.sherman);
  floorGear.revs = -0.5;
  floorGear.blend = 0;
  floorGear.tick(TICK, -1, 0);
  results.gearbox = {
    upBlockedByLockout: lockedGear,
    upWhenFree: free.gear,
    downIgnoresLockout: down.gear,
    downStopsAtFirst: floorGear.gear,
    // The lockout expires `gearChangeTime` into the object's life and is
    // never re-armed: a Sherman's 0.05 s is one tick and a bit.
    lockoutTicksSherman: (() => {
      const e = new EngineState(ENGINE_SPECS.sherman);
      let n = 0;
      while (e.blend > 0 && n < 200) { e.tick(TICK, 0, 0); n += 1; }
      return n;
    })(),
    // The Willys authors none, so it takes the ctor default of 1.0 s.
    lockoutTicksWilly: (() => {
      const e = new EngineState(ENGINE_SPECS.willy);
      let n = 0;
      while (e.blend > 0 && n < 200) { e.tick(TICK, 0, 0); n += 1; }
      return n;
    })(),
    // And nothing re-arms it: a gear change leaves it at zero.
    lockoutAfterShift: (() => {
      const e = new EngineState(ENGINE_SPECS.sherman);
      for (let i = 0; i < 10; i++) e.tick(TICK, 1, 0);
      e.revs = 1.0;
      const before = e.gear;
      e.tick(TICK, 1, 0);
      return { blend: round(e.blend, 6), shifted: e.gear > before };
    })(),
  };
}

{
  // The brake byte: set only when the pedal OPPOSES the rev direction, and
  // against literal +-0.1. When it is set the EngineGrip target is discarded
  // whole, which is the engine's entire brake.
  const cases = [];
  for (const [pedal, revs] of [[-1, 0.5], [-0.05, 0.5], [1, -0.5], [0.05, -0.5],
                               [1, 0.5], [-1, -0.5], [0, 0.5]]) {
    const e = new EngineState(ENGINE_SPECS.sherman);
    e.revs = revs;
    e.tick(TICK, pedal, 0);
    cases.push({ pedal, revs, braking: e.braking, target: round(e.target(1), 4) });
  }
  results.brakeByte = cases;
}

{
  // The load, `feedbackLoop` 0x0824c850 (TANK-13). Three separate facts.
  const dv = 0.4;
  // (a) `& 2` clamps each sample to [-1, +1] — car AND tank.
  const clampedTank = new EngineState(ENGINE_SPECS.sherman);
  clampedTank.revs = 1.0;
  clampedTank.sample(10);
  const clampedCar = new EngineState(ENGINE_SPECS.willy);
  clampedCar.sample(10);
  // (b) `& 4`: the frame MAX while revs > 0, the frame MIN while revs <= 0.
  const tankMax = new EngineState(ENGINE_SPECS.sherman);
  tankMax.revs = 0.5;
  for (const v of [0.1, 0.3, 0.2]) tankMax.sample(v);
  const tankMin = new EngineState(ENGINE_SPECS.sherman);
  tankMin.revs = -0.5;
  for (const v of [-0.1, -0.3, -0.2]) tankMin.sample(v);
  // (c) the car's running mean, x0.99, over every contacting part — so the
  // two free-rolling fronts' honest zeroes halve a Willy's load.
  const carAll = new EngineState(ENGINE_SPECS.willy);
  carAll.revs = 1.0;
  for (let i = 0; i < 2; i++) carAll.sample(dv);
  const carWithZeroes = new EngineState(ENGINE_SPECS.willy);
  carWithZeroes.revs = 1.0;
  for (const v of [dv, 0, dv, 0]) carWithZeroes.sample(v);
  const one = new EngineState(ENGINE_SPECS.willy);
  one.revs = 1.0;
  one.sample(dv);
  results.load = {
    // L0 = dv * ratio / (torqueCurve(revs) * setTorque). Willy gear 1:
    // 0.4 * 7.0 / (0.7 * 10.5).
    singleSample: round(one.load, 5),
    expectedSingle: round(dv * 7.0 / (engineTorqueFraction(1.0) * 10.5) * 0.99, 5),
    clampedTank: round(clampedTank.load, 5),
    clampedCar: round(clampedCar.load, 5),
    tankKeepsMax: round(tankMax.load, 5),
    tankKeepsMin: round(tankMin.load, 5),
    carTwoSamples: round(carAll.load, 5),
    carFourWithTwoZeroes: round(carWithZeroes.load, 5),
    meanScale: round(one.load / (dv * 7.0 / (engineTorqueFraction(1.0) * 10.5)), 4),
    // The tail of handleUpdate keeps the previous value and clears the
    // accumulator, so samples belong to the tick that follows them.
    clearedOnTick: (() => {
      const e = new EngineState(ENGINE_SPECS.willy);
      e.sample(dv);
      const held = round(e.load, 5);
      e.tick(TICK, 1, 0);
      return { held, after: round(e.load, 5), prev: round(e.prevLoad, 5), count: e.loadCount };
    })(),
  };
}

// The fleet's ceilings, straight off the ladder and the type's own clamp.
// `ratio_top * 1.2` for a c_ETCar and `* 1.0` for a c_ETTank (TANK-9).
results.fleetCeilings = Object.fromEntries(
  Object.entries({
    willy: [7, 5, 'c_ETCar'],
    kubelwagen: [7, 5, 'c_ETCar'],
    katyusha: [5, 4, 'c_ETCar'],
    sherman: [4, 5, 'c_ETTank'],
    panzerIV: [4, 5, 'c_ETTank'],
    tiger: [3.5, 5, 'c_ETTank'],
    m3a1: [5, 4, 'c_ETTank'],
    hanomag: [5, 4, 'c_ETTank'],
  }).map(([name, [diff, gears, type]]) => {
    const ladder = gearLadder(diff, gears);
    const cap = (engineTypeBits(type) & 4) ? 1.0 : ENGINE_REV_CEILING;
    return [name, {
      top: round(ladder[ladder.length - 1] * cap, 3),
      kmh: round(ladder[ladder.length - 1] * cap * 3.6, 1),
      reverse: round(ladder[0] * (engineTypeBits(type) & 4 ? 1.0 : ENGINE_REV_FLOOR), 3),
    }];
  }));

// --- hull collision against static objects -----------------------------------
//
// A wall in front of the jeep: the vehicle must not drive through it. The mock
// collider reports a single static plane at z = -10 (facing +Z toward the
// vehicle).
{
  const WALL_Z = -10;
  const COLLISION_RADIUS = WILLYS.boundingRadius; // 1.8 m
  const mockCollider = {
    waterLevel: -Infinity,
    statics: { ownerOf: () => -1 },
    sweepSphere(ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner) {
      // Wall normal faces +Z (toward the vehicle). Sphere centre touches when
      // z = WALL_Z + radius (for a wall facing +Z, the sphere centre at contact
      // is `radius` ahead of the wall plane).
      if (dz !== 0) {
        const t = (WALL_Z + radius - oz) / dz;
        if (t >= 0 && t <= maxDist) {
          return {
            t,
            x: ox + dx * t, y: oy + dy * t, z: oz + dz * t,
            nx: 0, ny: 0, nz: 1,
            material: 0, owner: 0, kind: 'object',
          };
        }
      }
      return null;
    },
  };

  const truck = new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: () => 0, collider: mockCollider,
  });
  const s = truck.state;
  s.position.set(0, 0.6, 0);
  s.velocity.set(0, 0, -10);                   // ~36 km/h into the wall

  drive(truck, 5, holding({ c_PIThrottle: 1 }));

  results.hullCollision = {
    stoppedAtZ: round(truck.state.position.z, 2),
    wallZ: WALL_Z,
    // The collision radius plus a 2 cm skin means the centre stops just short
    // of WALL_Z + radius.
    stoppedShortOfWall: truck.state.position.z > WALL_Z,
    vz: round(truck.state.velocity.z, 3),
    // It is not embedded past the wall.
    clear: truck.state.position.z >= WALL_Z + COLLISION_RADIUS - 0.5,
  };
}

// Without a collider the jeep drives straight through — the old behaviour.
{
  const truck = new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: () => 0,
  });
  const s = truck.state;
  s.position.set(0, 0.6, 0);
  s.velocity.set(0, 0, -10);

  drive(truck, 5, holding({ c_PIThrottle: 1 }));

  results.hullCollisionNoCollider = {
    stoppedAtZ: round(truck.state.position.z, 2),
    // Past the wall — no collision without the collider.
    throughWall: truck.state.position.z < -10,
  };
}

process.stdout.write(JSON.stringify(results, null, 2));
