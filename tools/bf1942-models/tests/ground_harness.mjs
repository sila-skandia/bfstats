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
import { GroundVehicle, WILLYS, TrackedVehicle, TANK, engineRatio, differentialRPM } from './ground.js';
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
function jeep({ ground = () => 0, y = 0.6, speed = 0 } = {}) {
  const truck = new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: ground,
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
function tank(nodeFn, { ground = () => 0, y = 0.6, speed = 0 } = {}) {
  const truck = new TrackedVehicle(nodeFn(), null, {
    cockpit: false, groundHeight: ground,
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
  revLimit: WILLYS.revLimit,
  mu: WILLYS.mu,
  maxSteer: WILLYS.maxSteer,
};

{
  const k = WILLYS;
  const top = k.gearRatios[k.gearRatios.length - 1];
  results.solved = {
    // Rev-limited speed in top gear, m/s: revLimit x R / (diff x ratio).
    revCapSpeed: round(k.revLimit * k.wheelRadius / (k.differential * top)),
    // Per-gear rev-limited speeds, the ladder the automatic climbs.
    gearSpeeds: k.gearRatios.map(r =>
      round(k.revLimit * k.wheelRadius / (k.differential * r), 2)),
    // Static compression under standing weight: four springs at 25 carry
    // 14.73, so the heave sits g / (4 x 25) in from rest.
    staticCompression: round(-GRAVITY / (4 * k.springStrength)),
    // Heave: omega = sqrt(4k), critical damping 2 omega, supplied 4 x 5.
    heaveOmega: round(Math.sqrt(4 * k.springStrength), 2),
    heaveDampingRatio: round(
      4 * k.springDamping / (2 * Math.sqrt(4 * k.springStrength)), 3),
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
{
  const truck = jeep();
  drive(truck, 2);
  drive(truck, 8, holding({ c_PIThrottle: 1, c_PIYaw: 0.4 }));
  drive(truck, 4, holding({ c_PIThrottle: 1, c_PIYaw: 0 }));
  results.straighten = {
    yawRate: round(truck.state.angularVelocity.y * DEG, 2),
    roll: round(rollDeg(truck), 2),
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
  drive(truck, 15, holding({ c_PIThrottle: 0 }));
  results.coast = { entry, after15s: round(alongOf(truck)) };
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
// The single most important regression guard in this file: verify-r7.md's
// whole correction is that the M3A1 does *not* land on a smooth
// interpolation between the curve's five named points (which would give
// ~5.51) because its index (25) is nowhere near one.
results.tankRatios = {
  sherman: round(engineRatio(4, 5), 4),   // idx=20, an authored point: 4.0
  willy: round(engineRatio(7, 5), 4),     // idx=20 too: 7.0
  m3a1: round(engineRatio(5, 4), 4),      // idx=25, not one: 17.5, not ~5.51
  // Every numberOfGears but 1 and 5 must reduce to exactly 3.5*differential —
  // sampled across the counts a mod could plausibly declare.
  offCurve: [2, 3, 6, 7, 8, 9, 10].map(n => round(engineRatio(3.5, n), 4)),
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
// throttle compares a 34 km/h vehicle against a 114 km/h one (the corrected
// ratio, TANK-3, really is 4.4x), and the faster one is grip-limited, so the
// yaw-rate comparison that used to live here answered a question about top
// speed, not about the front axle. Held instead at a common ~8 m/s by a
// bang-bang throttle, and read as turn RADIUS (v / yawRate), which is what
// "turns tighter" actually means.
results.tankMatchedTurn = [];
for (const [name, builder] of [['sherman', shermanNode], ['m3a1', m3a1Node]]) {
  const t = tank(builder, { y: 0.5 });
  const hold = tt => {
    tt.setInput('c_PIThrottle', tt.state.velocity.length() < 8 ? 1 : 0);
    tt.setInput('c_PIYaw', 1);
  };
  drive(t, 4, tt => tt.setInput('c_PIThrottle', tt.state.velocity.length() < 8 ? 1 : 0));
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
