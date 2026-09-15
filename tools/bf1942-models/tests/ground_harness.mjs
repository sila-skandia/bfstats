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
import { GroundVehicle, WILLYS } from './ground.js';
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

process.stdout.write(JSON.stringify(results, null, 2));
