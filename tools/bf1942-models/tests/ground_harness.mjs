// Drives `viewer/wheeled-vehicle.js` (and `tracked-vehicle.js`) outside a
// browser and prints one JSON blob.
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
import { GroundVehicle } from './wheeled-vehicle.js';
import { TrackedVehicle } from './tracked-vehicle.js';
import { WILLYS, TANK } from './ground-specs.js';
import {
  engineRatio, gearLadder, engineTorqueFraction, differentialRPM,
  currentDifferentialRPM, engineGripTarget, engineTypeBits, ENGINE_TYPES,
  EngineState, ENGINE_REV_CEILING, ENGINE_REV_FLOOR,
} from './ground-engine.js';
import { GRAVITY } from './physics.js';
import { createModelRig, keyOf as modelKeyOf } from './model-rig.js';

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

/**
 * The Kubelwagen, the one vanilla `c_ETCar` whose Engine binds `c_PIYaw`.
 *
 * `Objects/Vehicles/Land/Kubelwagen/Physics.con` gives `KubelwagenEngine`
 * `setInputToYaw c_PIYaw` over `setMinRotation -1/0/-1` ..
 * `setMaxRotation 1/0/1` -- the same +-1 degree body lean a `c_ETTank`
 * Engine declares -- alongside the throttle roll every car engine has. The
 * Engine sits between every spring and the root, so an ancestor walk that
 * does not insist on a `RotationalBundle` marks the rear `c_PGFEngineGrip`
 * springs steered as well as the fronts: all four tyres point the same way,
 * the yaw moment cancels, and the car crabs off on a fixed heading. The
 * Willy above is the control -- same mass, same torque ladder, same grip
 * classes, its Engine binding roll only.
 *
 * Everything else is the Willy's tree with the Kubelwagen's own geometry
 * from the same `Physics.con` (front axle 1.2 m ahead of the origin, rear
 * 1.23 m behind, track 1.255 m).
 */
function kubelNode() {
  const root = new THREE.Object3D();
  root.name = 'Kubelwagen';
  root.userData = {
    control: 'Kubelwagen',
    templateKind: 'PlayerControlObject',
    physics: { mass: 2500, drag: 1.5, vehicleCategory: 'VCLand' },
  };

  const camera = new THREE.Object3D();
  camera.name = 'KubelwagenCamera';
  camera.position.set(-0.38, 0.95, 1.25);
  camera.userData = { templateKind: 'Camera', cameraView: 'CVMInside' };
  root.add(camera);

  const engine = new THREE.Object3D();
  engine.name = 'KubelwagenEngine';
  engine.position.set(0, 0.35, 0.25);
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType: 'c_ETCar', torque: 10.5, differential: 7.0,
      numberOfGears: 5, gearUp: 0.95, gearDown: 0.4, gearChangeTime: 0.05,
      maxRotation: [1, 0, 1], maxSpeed: [10, 0, 10], acceleration: [10, 0, 10],
    },
    rig: {
      control: 'Kubelwagen', automaticReset: true,
      axes: {
        yaw: {
          input: 'c_PIYaw', min: -1, max: 1, free: false,
          driver: 'position', maxSpeed: 10, direction: 1, acceleration: 10,
        },
        roll: {
          input: 'c_PIThrottle', min: -1, max: 1, free: false,
          driver: 'position', maxSpeed: 10, direction: 1, acceleration: 10,
        },
      },
    },
  };
  root.add(engine);

  const steerRig = {
    control: 'Kubelwagen', automaticReset: true,
    axes: {
      yaw: {
        input: 'c_PIYaw', min: -30, max: 30, free: false,
        driver: 'position', maxSpeed: 200, direction: 1,
      },
    },
  };
  for (const side of [1, -1]) {
    const bundle = new THREE.Object3D();
    bundle.name = side > 0 ? 'KubelwagenFrontWheelR' : 'KubelwagenFrontWheelL';
    bundle.position.set(0.6275 * side, -0.007, -1.2);
    bundle.userData = { templateKind: 'RotationalBundle', rig: steerRig };
    const front = new THREE.Object3D();
    front.name = side > 0 ? 'KubelwagenFrontSpringR' : 'KubelwagenFrontSpringL';
    front.position.set(0, -0.599, 0);
    front.userData = {
      templateKind: 'Spring',
      physics: { grip: 'c_PGFRollGrip', gripFlags: 2, strength: 25, damping: 5 },
    };
    bundle.add(front);
    engine.add(bundle);

    const rear = new THREE.Object3D();
    rear.name = side > 0 ? 'KubelwagenBackSpringR' : 'KubelwagenBackSpringL';
    rear.position.set(0.6275 * side, -0.423, 1.23);
    rear.userData = {
      templateKind: 'Spring',
      physics: { grip: 'c_PGFEngineGrip', gripFlags: 4, strength: 25, damping: 5 },
    };
    engine.add(rear);
  }
  return root;
}

/** The Kubelwagen on the same analytic ground the `jeep()` helper uses. */
function kubel({ ground = () => 0, y = 0.6, speed = 0, surface } = {}) {
  const truck = new GroundVehicle(kubelNode(), null, {
    cockpit: false, groundHeight: ground,
    ...(surface ? { surfaceFriction: surface } : {}),
  });
  const s = truck.state;
  s.position.set(0, y, 0);
  s.velocity.set(0, 0, -speed);
  return truck;
}

/**
 * Desert Combat's Humvee, transcribed node for node off
 * `viewer/models/mods/desertcombat/Humvee.glb` (which is
 * `Objects/Vehicles/Land/Humvee/{Objects,Physics}.con` in DC's `OBJECTS.rfa`
 * run through the assembler): the Willy's shape, with the one difference that
 * matters here. `HumveeEngine` declares its throttle as a POSITION axis --
 * `setMinRotation 0/0/-100` .. `setMaxRotation 0/0/100`, `setMaxSpeed 0/0/100`,
 * `setAcceleration 0/0/3000`, span 200, below the 360 an accumulator needs
 * (`con.ACCUMULATOR_SPAN`) -- where the Willy's is a +-5000 rate. The Pickup,
 * Technical, Lada, DPV and EE-9 declare the same range, and every wheel hangs
 * under the Engine, the fronts inside their `c_PIYaw` bundles.
 */
function humveeNode() {
  const root = new THREE.Object3D();
  root.name = 'Humvee';
  root.userData = {
    control: 'Humvee',
    templateKind: 'PlayerControlObject',
    physics: { mass: 3000, drag: 0.5, vehicleCategory: 'VCLand' },
  };

  const engine = new THREE.Object3D();
  engine.name = 'HumveeEngine';
  engine.position.set(0, 0.35, 0.25);
  engine.userData = {
    templateKind: 'Engine',
    physics: {
      engineType: 'c_ETCar', torque: 10, differential: 7,
      numberOfGears: 4, gearUp: 0.95, gearDown: 0.4, gearChangeTime: 0.01,
      maxRotation: [0, 0, 100], maxSpeed: [0, 0, 100], acceleration: [0, 0, 3000],
    },
    rig: {
      control: 'Humvee', automaticReset: true,
      axes: {
        roll: {
          input: 'c_PIThrottle', min: -100, max: 100, free: false,
          driver: 'position', maxSpeed: 100, direction: 1, acceleration: 3000,
        },
      },
    },
  };
  root.add(engine);

  const steerRig = {
    control: 'Humvee', automaticReset: true,
    axes: {
      yaw: {
        input: 'c_PIYaw', min: -50, max: 50, free: false,
        driver: 'position', maxSpeed: 200, direction: 1, acceleration: 200,
      },
    },
  };
  const grip = { grip: 'c_PGFEngineGrip', gripFlags: 4, strength: 30, damping: 5 };
  for (const side of [1, -1]) {
    const bundle = new THREE.Object3D();
    bundle.name = side > 0 ? 'HumveeFrontWheelR' : 'HumveeFrontWheelL';
    bundle.position.set(0.9 * side, 0.1, -1.0);
    bundle.userData = { templateKind: 'RotationalBundle', rig: steerRig };
    const front = new THREE.Object3D();
    front.name = side > 0 ? 'HumveeFrontSpringR' : 'HumveeFrontSpringL';
    front.position.set(0, -0.599, 0);
    const wheel = side > 0 ? 'Humvee_WheelR_M1' : 'Humvee_WheelL_M1';
    front.userData = { templateKind: 'Spring', geometry: wheel, physics: { ...grip } };
    bundle.add(front);
    engine.add(bundle);

    const rear = new THREE.Object3D();
    rear.name = side > 0 ? 'HumveeBackSpringR' : 'HumveeBackSpringL';
    rear.position.set(0.9 * side, -0.372, 2.5);
    rear.userData = { templateKind: 'Spring', geometry: wheel, physics: { ...grip } };
    engine.add(rear);
  }
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

// --- the Kubelwagen: a car Engine that binds c_PIYaw --------------------------
//
// Same scenario as `steering` above, run on both cars. The Kubelwagen must
// turn like the Willy, and only its two `c_PGFRollGrip` fronts may come back
// steered. Before the `RotationalBundle` guard in `collectChassis` all four
// of its springs were steered, which pointed every tyre the same way: the
// hull translated sideways on a near-constant heading -- a couple of degrees
// of yaw over six seconds of half lock against the Willy's hundreds.
{
  const turnOf = build => {
    const truck = build();
    drive(truck, 2);
    drive(truck, 10, holding({ c_PIThrottle: 1 }));
    const heading = t => Math.atan2(-forwardOf(t).x, -forwardOf(t).z);
    let turned = 0;
    let last = heading(truck);
    let crab = 0;
    drive(truck, 6, t => {
      holding({ c_PIThrottle: 1, c_PIYaw: 0.5 })(t);
      const now = heading(t);
      let step = (now - last) * DEG;
      if (step > 180) step -= 360;
      if (step < -180) step += 360;
      turned += step;
      last = now;
      // How far the velocity has slipped out of the nose: a crabbing hull
      // travels sideways with no yaw to show for it.
      const v = t.state.velocity;
      const along = v.dot(forwardOf(t));
      const speed = v.length();
      crab = Math.max(crab, speed > 1 ? Math.abs(Math.asin(
        Math.min(1, Math.sqrt(Math.max(0, speed * speed - along * along)) / speed))) * DEG : 0);
    });
    return {
      wheels: truck.wheels.length,
      driven: truck.wheels.filter(w => w.driven).length,
      steered: truck.wheels.filter(w => w.steered).length,
      steeredAreRollGrip: truck.wheels
        .filter(w => w.steered).every(w => !w.driven),
      steerMax: truck.wheels.map(w => w.steerMax),
      turnedDeg: round(turned, 1),
      worstSlipDeg: round(crab, 1),
      end: snapshot(truck),
    };
  };
  results.kubelwagen = { kubel: turnOf(kubel), willy: turnOf(jeep) };
}

// --- an Engine's position axis poses nothing (ledger PHY-15) ----------------
//
// Throttle and full lock held, and every wheel read back in the hull's own
// frame. `Engine::handleUpdate` never turns its angles into a transform, so
// the Engine node must stay where the glb put it whatever its span, a wheel's
// centre may only move up and down its spring, and a steered wheel turns
// about its own bundle. Before the fix `applyRig` posed the Humvee's Engine
// at the full 100 degrees of its throttle roll and all four wheels orbited
// the hull about 1.5 m; the Kubelwagen's +-1 degree lean moved its wheels by
// a centimetre, which nobody saw. The Willy, whose throttle is a rate axis,
// is the control: it never posed.
{
  const hullFrame = truck => {
    truck.node.updateMatrixWorld(true);
    const inverse = truck.node.matrixWorld.clone().invert();
    const out = {};
    truck.node.traverse(obj => {
      if (obj.userData?.templateKind !== 'Spring') return;
      const m = new THREE.Matrix4().multiplyMatrices(inverse, obj.matrixWorld);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      out[obj.name] = { pos: p, axleYaw: Math.atan2(-axle.z, axle.x) * DEG, axleUp: axle.y };
    });
    return out;
  };
  const engineTurn = root => {
    let deg = null;
    root.traverse(obj => {
      if (obj.userData?.templateKind === 'Engine') {
        deg = 2 * Math.acos(Math.min(1, Math.abs(obj.quaternion.w))) * DEG;
      }
    });
    return deg;
  };
  const poseOf = build => {
    const truck = build();
    drive(truck, 1);
    const rest = hullFrame(truck);
    drive(truck, 2, holding({ c_PIThrottle: 1, c_PIYaw: 1 }));
    const held = hullFrame(truck);
    const wheels = Object.fromEntries(Object.entries(held).map(([name, w]) => {
      const r = rest[name];
      return [name, {
        horizontalShift: round(Math.hypot(w.pos.x - r.pos.x, w.pos.z - r.pos.z), 4),
        verticalShift: round(w.pos.y - r.pos.y, 4),
        steerDeg: round(w.axleYaw - r.axleYaw, 2),
        axleUp: round(w.axleUp, 4),
      }];
    }));
    const throttleKey = [...truck.state.surfaces.keys()].find(k => k.endsWith('/c_PIThrottle/roll'));
    return {
      engineTurnDeg: round(engineTurn(truck.node), 4),
      // The servo still runs: only the pose is gone.
      throttleSurface: throttleKey ? round(truck.state.surfaces.get(throttleKey), 3) : null,
      steered: truck.wheels.filter(w => w.steered).map(w => w.node.name).sort(),
      travelled: round(truck.state.position.length(), 1),
      wheels,
    };
  };
  const humvee = () => {
    const truck = new GroundVehicle(humveeNode(), null, { cockpit: false, groundHeight: () => 0 });
    truck.state.position.set(0, 0.6, 0);
    return truck;
  };
  results.enginePosesNothing = { humvee: poseOf(humvee), kubel: poseOf(kubel), willy: poseOf(jeep) };

  // The model browser's rig (`model-rig.js`) and the controls preview that
  // shares it, on the same tree: the throttle is still offered, the steering
  // bundle still turns, and the Engine does not.
  const rig = createModelRig({ rememberMap() {} });
  const root = humveeNode();
  rig.collectRig(root);
  rig.setInput(modelKeyOf('Humvee', 'c_PIThrottle'), 1);
  rig.setInput(modelKeyOf('Humvee', 'c_PIYaw'), 1);
  rig.applyRig();
  const bundle = root.getObjectByName('HumveeFrontWheelR');
  const engine = root.getObjectByName('HumveeEngine');
  results.enginePosesNothing.modelRig = {
    engineTurnDeg: round(engineTurn(root), 4),
    bundleTurnDeg: round(2 * Math.acos(Math.min(1, Math.abs(bundle.quaternion.w))) * DEG, 2),
    throttleOffered: rig.rigged.some(part => part.node === engine
      && part.axes.roll?.input === 'c_PIThrottle'),
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
  const held = round(truck.state.angularVelocity.y * DEG, 2);
  drive(truck, 4, holding({ c_PIThrottle: 0, c_PIYaw: 0 }));
  results.straighten = {
    turningRate: turning,
    // Wheel centred, throttle still floored. It does NOT come straight, and
    // it gets worse with time rather than better: a half-lock turn at 31 m/s
    // lifts the inside rear clear of the ground (its load reads 0), so the
    // whole of the tractive effort is on one side of the hull and the couple
    // that makes keeps the slide going for as long as the throttle does.
    throttleHeld: held,
    // Lift off and it unwinds: the revs decay, the target falls to the road
    // speed, the rear axle gets its circle back and the front axle — which
    // never spends any of its own on drive — straightens the hull.
    yawRate: round(truck.state.angularVelocity.y * DEG, 2),
    roll: round(rollDeg(truck), 2),
    speed: round(alongOf(truck), 2),
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
  // (b) `& 4`: the frame MAX while revs >= 0, the frame MIN while revs < 0.
  const tankMax = new EngineState(ENGINE_SPECS.sherman);
  tankMax.revs = 0.5;
  for (const v of [0.1, 0.3, 0.2]) tankMax.sample(v);
  const tankMin = new EngineState(ENGINE_SPECS.sherman);
  tankMin.revs = -0.5;
  for (const v of [-0.1, -0.3, -0.2]) tankMin.sample(v);
  // The boundary: `fucompp` sets C3 on equality, so `test ah,0x45` is
  // non-zero and the `jne` at 0x0824c926 goes to the MAX arm. A tank at
  // exactly zero revs keeps the max, not the min.
  const tankZero = new EngineState(ENGINE_SPECS.sherman);
  tankZero.revs = 0;
  for (const v of [-0.3, 0.2, -0.1]) tankZero.sample(v);
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
    tankAtZeroRevsKeepsMax: round(tankZero.load, 5),
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


// --- the pre-extract path: a tree older than the code that reads it -------
//
// `maxRotation`, `maxSpeed` and `acceleration` only started reaching
// `extras.physics` with this branch's `bf42/con.py`. Every published
// `scene.glb` today predates it, and `map.html` builds the drivable hull from
// the LEVEL scene, so until the lead re-extracts, none of the three is
// present. Throttle always degraded safely; steering degraded to a dead stick
// and a tracked hull's steering IS the differential. Both now fall back to
// the raw input, and this is the regression that says so.
{
  const strip = root => {
    root.traverse(n => {
      const phys = n.userData && n.userData.physics;
      if (phys && n.userData.templateKind === 'Engine') {
        delete phys.maxRotation; delete phys.maxSpeed; delete phys.acceleration;
      }
    });
    return root;
  };
  const yawOf = truck => new THREE.Euler()
    .setFromQuaternion(truck.state.orientation, 'YXZ').y;
  const lap = (truck, seconds) => {
    let acc = 0;
    let prev = yawOf(truck);
    drive(truck, seconds, t => {
      t.setInput('c_PIThrottle', 1);
      t.setInput('c_PIYaw', 1);
      let d = yawOf(t) - prev;
      prev = yawOf(t);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      acc += d;
    });
    return acc * DEG;
  };
  results.preExtract = {};
  for (const [name, build] of [
    ['sherman', () => tank(shermanNode, { y: 0.5 })],
    ['m3a1', () => tank(m3a1Node, { y: 0.5 })],
    ['willy', () => jeep()],
    ['shermanStale', () => new TrackedVehicle(strip(shermanNode()), null,
      { cockpit: false, groundHeight: () => 0 })],
    ['m3a1Stale', () => new TrackedVehicle(strip(m3a1Node()), null,
      { cockpit: false, groundHeight: () => 0 })],
    ['willyStale', () => new GroundVehicle(strip(willyNode()), null,
      { cockpit: false, groundHeight: () => 0 })],
  ]) {
    const truck = build();
    truck.state.position.set(0, name.startsWith('willy') ? 0.6 : 1.2, 0);
    drive(truck, 3);
    let top = 0;
    drive(truck, 14, t => {
      t.setInput('c_PIThrottle', 1);
      top = Math.max(top, alongOf(t));
    });
    results.preExtract[name] = {
      stale: truck.engine.stale,
      topKmh: round(top * 3.6, 1),
      yawDeg: round(lap(truck, 6), 1),
    };
  }
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
    // wheeled-vehicle.js's drivable-deck gate asks before it trusts a hit's owner;
    // the mock world has no decks, so nothing is one.
    isDrivableOwner: () => false,
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

// --- driving onto a drivable deck -------------------------------------------
//
// The deck is analytic here, exactly as the ground under every other scenario
// in this harness is, but it is analytic in the SHAPE the real query has: a
// height that only exists at or below the reference the caller passes. That
// reference is the thing under test — `wheeled-vehicle.js` must ask from the axle plus
// the step it can mount, so a deck in reach is the floor and a deck overhead
// (driving under a bridge) is not.
//
// Layout, driving down -Z from the origin: flat ground to z = -6, a 4 m ramp
// rising to 1 m, then a 200 m pad at 1 m. The reload/repair bay of the bug
// report, with its "little incline".
//
// The pad used to be 14 m, which is where `padPitch` went wrong. At the
// engine's own rotational inertia (`getGeometryInertia`, four times a solid
// box's) a Sherman's pitch mode is 0.75 Hz, so the hull takes three seconds
// to come level after the crest — and a 14 m pad at road speed is under a
// second of it. The measurement was landing mid-decay and reading 2.3 deg of
// "not level". The pad is now long enough that the last sample on it is a
// settled one, and `padSettleSeconds` says how long the settling took rather
// than the tolerance being widened to hide it.
const PAD_Y = 1.0;
const PAD_LENGTH = 200;
const rampTop = z => {
  const d = -z;
  if (d < 6) return -Infinity;
  if (d < 10) return ((d - 6) / 4) * PAD_Y;
  if (d <= 10 + PAD_LENGTH) return PAD_Y;
  return -Infinity;
};
/**
 * The ramp's own angle: 1 m of rise over a 4 m run. Everything the deck can
 * demand of a hull's attitude is this number, and a hull whose load-bearing
 * springs span less than the 4 m run (both vehicles here do) is demanded all
 * of it, so it is the target a slow ascent is measured against rather than a
 * fitted threshold.
 */
const RAMP_ANGLE_DEG = round(Math.atan(PAD_Y / 4) * DEG, 2);
/** The analytic stand-in for `WorldCollider.surfaceHeight(x, z, fromY)`. */
const deckGround = topOf => (x, z, fromY) => {
  const deck = topOf(z);
  if (Number.isFinite(fromY) && deck > 0 && fromY >= deck) return deck;
  return 0;
};
/** ... and for `deckNormal`: the surface's own normal, not a difference. */
const deckGroundNormal = topOf => (x, z, fromY, out) => {
  const deck = topOf(z);
  if (!(Number.isFinite(fromY) && deck > 0 && fromY >= deck)) return false;
  // One-sided slope of the analytic deck, which on the ramp is 1/4 and on the
  // pad is nothing.
  const e = 0.05;
  const a = topOf(z - e), b = topOf(z + e);
  const slope = Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (2 * e) : 0;
  const len = Math.hypot(0, 1, -slope);
  out[0] = 0; out[1] = 1 / len; out[2] = -slope / len;
  return true;
};

for (const [name, build, radius] of [
  ['jeep', () => new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: deckGround(rampTop),
    deckNormal: deckGroundNormal(rampTop),
  }), 0.35],
  ['tiger', () => new TrackedVehicle(shermanNode(), null, {
    cockpit: false, groundHeight: deckGround(rampTop),
    deckNormal: deckGroundNormal(rampTop),
  }), 0.5],
]) for (const [mode, pilot, seconds] of [
  // Floored, which is how the bug was reported. From 6 m of run-up both
  // vehicles arrive at the ramp foot doing about 8 m/s.
  ['', t => t.setInput('c_PIThrottle', 1), 14],
  // ...and the same ramp at a walking 1 m/s, where the hull has time to take
  // up the attitude the deck demands and the peak is the ramp's own angle
  // rather than a transient. Held with the pedal rather than by seeding a
  // velocity, so the drivetrain is in the loop exactly as above.
  ['Slow', t => t.setInput('c_PIThrottle', alongOf(t) < 1 ? 1 : 0), 30],
]) {
  const truck = build();
  truck.state.position.set(0, name === 'jeep' ? 0.6 : 1.2, 0);
  drive(truck, 2);                       // let the springs settle on the flat
  const restY = truck.state.position.y;
  // The attitude the vehicle holds standing on flat ground. Neither hull is
  // at exactly zero — a Willys sits 1.2 degrees nose-down on its own springs
  // — so "level on the pad" means "back to this", not "back to zero".
  const restPitch = pitchDeg(truck);
  const trace = [];
  drive(truck, seconds, t => {
    pilot(t);
    const s = t.state;
    trace.push({
      z: round(s.position.z, 3), y: round(s.position.y, 3),
      deck: round(Math.max(0, rampTop(s.position.z) === -Infinity ? 0 : rampTop(s.position.z)), 3),
      pitch: round(pitchDeg(t), 2), grounded: s.grounded,
      v: round(alongOf(t), 2),
    });
  });
  // Everything from the moment the hull is over the ramp to the end of the
  // pad — the WHOLE pad, so a hull bouncing 40 m along it is not off the end
  // of the window.
  const onDeck = trace.filter(p => p.z <= -6 && p.z >= -(10 + PAD_LENGTH));
  const onPad = trace.filter(p => p.z <= -11 && p.z >= -(9 + PAD_LENGTH));
  const onRamp = trace.filter(p => p.z <= -6.5 && p.z >= -9.5);
  let biggestJump = 0;
  for (let i = 1; i < onDeck.length; i++) {
    biggestJump = Math.max(biggestJump, Math.abs(onDeck[i].y - onDeck[i - 1].y));
  }
  // The first tick on the pad from which the hull holds its flat-ground
  // attitude to within half a degree for a whole second. This is the number
  // the 14 m pad could not contain.
  let settle = null;
  for (let i = 0; i + 60 < onPad.length; i++) {
    if (onPad.slice(i, i + 60).every(p => Math.abs(p.pitch - restPitch) < 0.5)) { settle = i; break; }
  }
  const loadedZ = truck.wheels.filter(w => w.strength > 0).map(w => w.rest.z);
  results[`${name}OntoPad${mode}`] = {
    restY: round(restY, 3),
    restPitch: round(restPitch, 2),
    reachedPad: onPad.length > 0,
    // Ride height above the surface, on the flat and on the pad: the same
    // number, so the pad carries the vehicle exactly as the ground does.
    padRide: onPad.length ? round(onPad[onPad.length - 1].y - PAD_Y, 3) : null,
    flatRide: round(restY, 3),
    // Never below the pad's top surface.
    lowestOnPad: onPad.length ? round(Math.min(...onPad.map(p => p.y)), 3) : null,
    // Never airborne on the deck, and no tick-to-tick jump the 1/4 ramp at this
    // speed cannot explain (the old `CLIMB_STEP` nudge moved 0.2 m a tick on its
    // own, and the raster's cell steps threw the hull clear of the surface).
    airborneOnDeck: onDeck.filter(p => !p.grounded).length,
    // Where those ticks are: a jeep at 8 m/s over the convex break where the
    // ramp meets the pad leaves the ground for a moment, which is what a jeep
    // does over a crest. What must NOT happen is airborne ticks along the flat
    // run of the pad itself.
    airborneOnPad: onPad.filter(p => !p.grounded).length,
    airborneZs: onDeck.filter(p => !p.grounded).map(p => p.z),
    biggestJump: round(biggestJump, 3),
    // --- attitude ---------------------------------------------------------
    // The ramp's own angle, and the span of the LOAD-BEARING springs. A
    // Sherman's eight `c_PGFEngineDummyGrip` rollers are `strength 0`/
    // `damping 0` and carry none of the hull, so the supported span is the
    // two real bogie rows (2.449 m), not the 4.1 m the rollers cover — which
    // is why the deck demands this hull the ramp's whole angle rather than a
    // bridged fraction of it.
    rampAngleDeg: RAMP_ANGLE_DEG,
    loadedSpanZ: round(Math.max(...loadedZ) - Math.min(...loadedZ), 3),
    vAtRampFoot: round(trace.find(p => p.z <= -6)?.v ?? 0, 2),
    // ...and at the crest, where the ramp meets the pad, which is the launch
    // speed of any hop over the convex break.
    vAtCrest: round(trace.find(p => p.z <= -10)?.v ?? 0, 2),
    // Nose up the incline...
    peakRampPitch: onRamp.length ? round(Math.max(...onRamp.map(p => p.pitch)), 2) : null,
    // ...and level again on the pad, measured once it has settled, with the
    // settling time reported rather than absorbed into a tolerance.
    padPitch: onPad.length ? round(onPad[onPad.length - 1].pitch, 2) : null,
    padPitchVsRest: onPad.length ? round(onPad[onPad.length - 1].pitch - restPitch, 2) : null,
    padSettleSeconds: settle === null ? null : round(settle / 60, 2),
    finalZ: round(trace[trace.length - 1].z, 2),
  };
}

// How much of the ramp's angle a Sherman takes up as a function of how fast it
// meets it. This is why the floored run peaks at half the ramp's angle while
// the walking one takes all of it, and it is not a stiffness or a geometry
// limit: the two load-bearing bogie rows span 2.449 m across a 4 m run, so the
// deck demands the hull the whole 14.04 degrees at every speed.
//
// What happens instead, read off the per-wheel loads: the ramp lifts the hull
// about 0.3 m before the rear row has pitched down to follow it, the rear row
// runs out of its 0.35 m of travel and unloads completely, and the tank
// teeters on the front row alone for the length of the ramp. With no rear
// spring there is no pitch stiffness, so the nose comes up under the front
// row's moment against the hull's rotational inertia — and the peak arrives
// the moment the rear row touches down again, which is why it is a rate, not
// an angle. At the engine's `getGeometryInertia` (four times a solid box's)
// that rate is a quarter of what it was.
{
  const speeds = [1, 2, 3, 4, 6, 8];
  results.tankRampPitchBySpeed = speeds.map(hold => {
    const truck = new TrackedVehicle(shermanNode(), null, {
      cockpit: false, groundHeight: deckGround(rampTop),
      deckNormal: deckGroundNormal(rampTop),
    });
    truck.state.position.set(0, 1.2, 0);
    drive(truck, 2);
    let peak = -Infinity;
    drive(truck, 12, t => {
      t.setInput('c_PIThrottle', alongOf(t) < hold ? 1 : 0);
      const z = t.state.position.z;
      if (z <= -6.5 && z >= -9.5) peak = Math.max(peak, pitchDeg(t));
    });
    return { hold, peak: Number.isFinite(peak) ? round(peak, 2) : null };
  });
}

// Under a bridge: the span is 8 m up, the vehicle is on the ground below it, and
// it must stay there. This is the regression the shared height overlay caused —
// anything at (x, z) was lifted onto whatever deck was over it, vehicles and
// soldiers alike — and the reference height is what fixes it.
{
  const spanTop = z => (-z >= 10 && -z <= 30 ? 8 : -Infinity);
  const truck = new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: deckGround(spanTop),
    deckNormal: deckGroundNormal(spanTop),
  });
  truck.state.position.set(0, 0.6, 0);
  drive(truck, 2);
  const trace = [];
  drive(truck, 10, t => {
    t.setInput('c_PIThrottle', 1);
    trace.push({ z: round(t.state.position.z, 2), y: round(t.state.position.y, 3) });
  });
  const beneath = trace.filter(p => p.z <= -11 && p.z >= -29);
  results.underTheSpan = {
    passedBeneath: beneath.length > 0,
    highestBeneath: beneath.length ? round(Math.max(...beneath.map(p => p.y)), 3) : null,
  };
}

// What the hull sweep asks the collider for. The deck gate is two numbers and
// they have to track the surface the vehicle is riding: a lip within a step of
// it is a kerb, anything above is a wall. A mock that answers "nothing hit"
// records them.
{
  const seen = [];
  const gateCollider = {
    waterLevel: -Infinity,
    statics: { ownerOf: () => -1 },
    sweepSphere(ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner, skipBodies,
                deckStepTop, deckFloorCos) {
      seen.push({ z: round(oz, 2), stepTop: round(deckStepTop, 3),
                  floorCos: deckFloorCos });
      return null;
    },
  };
  const truck = new GroundVehicle(willyNode(), null, {
    cockpit: false, groundHeight: deckGround(rampTop),
    deckNormal: deckGroundNormal(rampTop), collider: gateCollider,
  });
  truck.state.position.set(0, 0.6, 0);
  drive(truck, 2);
  const onFlat = seen[seen.length - 1];
  seen.length = 0;
  drive(truck, 12, holding({ c_PIThrottle: 1 }));
  // The sweep the hull made while it was squarely on the pad, a little past
  // the crest rather than the last one of the run.
  const onPad = seen.filter(p => p.z <= -12 && p.z >= -22).pop();
  results.deckGate = {
    asked: seen.length > 0,
    // On the flat: the ground (0) plus the step.
    flatStepTop: onFlat && onFlat.stepTop,
    flatFloorCos: onFlat && onFlat.floorCos,
    // On the pad: the pad (1) plus the same step, so the gate rose with the
    // surface — which is what makes a lip a kerb and a parapet a wall.
    padStepTop: onPad && onPad.stepTop,
    padFloorCos: onPad && onPad.floorCos,
    finalZ: round(truck.state.position.z, 2),
  };
}


// --- a wheeled hull reads its own chassis (`GroundVehicle`, 2026-10-06) ------
//
// The Willy as its real glb nests it: the hull mesh is `WillyCockpitExternal`'s
// (`Willy_Hull_M1`, 1.734 x 1.523 x 3.636 off its `.sm` header), under the
// cockpit `LodObject`, under the root's own `lodWilly` and `WillyComplex`, with
// the passenger's `PlayerControlObject` after it. That is where the engine's
// inertia geometry search lands (`inertiaGeometryNode`, COL-13), and the same
// tree scaled to a SCUD-B's box stands in for a heavy truck. The springs carry
// a wheel mesh, so each wheel's radius is measured rather than the table's.
function nestedWilly({ size = [1.734, 1.523, 3.636], mass = 2500, drag = 1.5,
                       passengerFirst = false, wheelRadius = 0.364 } = {}) {
  const root = willyNode();
  root.userData.physics = { ...root.userData.physics, mass, drag };
  const lod = new THREE.Object3D();
  lod.name = 'lodWilly';
  lod.userData = { templateKind: 'LodObject', geometry: null };
  const complex = new THREE.Object3D();
  complex.name = 'WillyComplex';
  complex.userData = { templateKind: 'Bundle', geometry: null };
  const cockpitLod = new THREE.Object3D();
  cockpitLod.name = 'lodWillyCockpit';
  cockpitLod.userData = { templateKind: 'LodObject', geometry: null };
  const external = new THREE.Object3D();
  external.name = 'WillyCockpitExternal';
  external.userData = { templateKind: 'SimpleObject', geometry: 'Willy_Hull_M1' };
  const hull = new THREE.Mesh(new THREE.BoxGeometry(...size).translate(0, size[1] / 2 - 0.19, 0.49));
  hull.name = 'Willy_Hull_M1';
  external.add(hull);
  cockpitLod.add(external);
  const passenger = new THREE.Object3D();
  passenger.name = 'WillyPassengerPCO';
  passenger.userData = { templateKind: 'PlayerControlObject', control: 'WillyPassengerPCO' };
  const parts = [...root.children];
  for (const part of parts) root.remove(part);
  root.add(lod);
  lod.add(complex);
  if (passengerFirst) complex.add(passenger, cockpitLod);
  else complex.add(cockpitLod, passenger);
  for (const part of parts) complex.add(part);
  root.traverse(node => {
    if (node.userData?.templateKind !== 'Spring') return;
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.21, 2 * wheelRadius, 2 * wheelRadius));
    wheel.name = `${node.name}_wheel`;
    node.add(wheel);
  });
  return root;
}

{
  const build = options => {
    const truck = new GroundVehicle(nestedWilly(options), null, { cockpit: false, groundHeight: () => 0 });
    truck.state.position.set(0, 0.6, 0);
    return truck;
  };
  const describe = truck => ({
    box: truck.geometryBox && truck.geometryBox.map(v => round(v, 4)),
    inertia: [truck._inertia.x, truck._inertia.y, truck._inertia.z].map(v => round(v, 4)),
    mass: truck.mass, drag: truck.drag,
    boundingRadius: round(truck._boundingRadius, 4),
    wheelRadius: truck.wheels.map(w => round(w.radius, 4)),
  });
  // The yaw rate one second into a full-lock turn from 10 m/s: the transient
  // the inertia sets. Same springs and engine and the same `drag / mass`, so
  // the box is what differs (it also sizes the drag radius, which at 10 m/s
  // is worth a few hundredths of a m/s^2).
  const turnIn = truck => {
    drive(truck, 1);
    truck.state.velocity.set(0, 0, -10);
    drive(truck, 0.5, holding({ c_PIThrottle: 0.3 }));
    drive(truck, 1, holding({ c_PIThrottle: 0.3, c_PIYaw: 1 }));
    return round(Math.abs(truck.state.angularVelocity.y) * DEG, 2);
  };
  const scud = { size: [3.42, 2.16, 11.57], mass: 10000, drag: 6 };
  results.ownChassis = {
    willy: describe(build()),
    passengerFirst: describe(build({ passengerFirst: true })),
    kubel: describe(build({ size: [1.625, 1.245, 3.715], wheelRadius: 0.34 })),
    scud: describe(build(scud)),
    willyTable: [WILLYS.inertiaPitch, WILLYS.inertiaYaw, WILLYS.inertiaRoll],
    turnIn: { willy: turnIn(build()), scud: turnIn(build(scud)) },
  };
}


// --- an amphibian: a tank on land, a boat afloat (`amphibious.js`) ----------
//
// Desert Combat's BMP-2 as its glb carries it: the Sherman fixture's tracks on
// a `c_ETTank` Engine, and beside them the `BMP2_WaterEngine` (`c_ETShip`,
// 0/-0.75/-1, differential 2.3, torque 1.5, roll -5..20 on `c_PIThrottle`),
// four `BMP2_Floater`s (`hullHeight 3.4`, lift 3.2..3.4) and two rudder
// `Wing`s on `c_PIYaw`, rolled 90 degrees. The water engine is the LAST
// Engine the walk meets, which is what used to make the whole hull a Ship.
function amphibianNode() {
  const root = shermanNode();
  root.name = 'BMP2';
  root.userData = { control: 'BMP2', templateKind: 'PlayerControlObject',
                    physics: { mass: 25000, drag: 2, vehicleCategory: 'VCLand' } };
  root.traverse(node => { if (node.userData?.rig) node.userData.rig.control = 'BMP2'; });
  const complex = root.getObjectByName('ShermanComplex');
  // The hull's own mesh: `hullGeometry`'s box (floats' footprint, drag faces).
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.1, 2.1, 6.7).translate(0, 0.45, 0));
  hull.name = 'BMP2_Hull_m1';
  complex.add(hull);
  const water = new THREE.Object3D();
  water.name = 'BMP2_WaterEngine';
  water.position.set(0, -0.75, 1);
  water.userData = {
    templateKind: 'Engine', control: 'BMP2',
    physics: { engineType: 'c_ETShip', torque: 1.5, differential: 2.3, noPropellerEffectAtSpeed: 20,
               maxRotation: [0, 0, 20], maxSpeed: [0, 0, 20], acceleration: [0, 0, 15] },
    rig: { control: 'BMP2', automaticReset: true,
           axes: { roll: { input: 'c_PIThrottle', min: -5, max: 20, free: false, driver: 'position', maxSpeed: 20, direction: 1 } } },
  };
  complex.add(water);
  for (const [z, direction] of [[-2, -1], [2, 1]]) {
    const rudder = new THREE.Object3D();
    rudder.name = z < 0 ? 'BMP2_RudderStern' : 'BMP2_RudderAft';
    rudder.position.set(0, -0.3, z);
    rudder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
    rudder.userData = {
      templateKind: 'Wing', control: 'BMP2',
      physics: { wingLift: 0, flapLift: 1, positionOffset: [0, 0, 0] },
      rig: { control: 'BMP2', automaticReset: true,
             axes: { pitch: { input: 'c_PIYaw', min: -7, max: 7, free: false, driver: 'position', maxSpeed: 18, direction } } },
    };
    complex.add(rudder);
  }
  for (const [x, y, z] of [[2.5, 0.97, 2.5], [-2.5, 0.97, 2.5], [2.5, 0.93, -2.5], [-2.5, 0.93, -2.5]]) {
    const float = new THREE.Object3D();
    float.name = 'BMP2_Floater';
    float.position.set(x, y, z);
    float.userData = { templateKind: 'FloatingBundle', control: 'BMP2',
                       physics: { hullHeight: 3.4, floatMaxLift: 3.4, floatMinLift: 3.2, sinkingSpeedMod: 5 } };
    root.add(float);
  }
  return root;
}

{
  // A bank at z = -40 running down 1 in 5 to a 6 m deep bed; the sea at -1.
  const WL = -1;
  const bed = (x, z) => (z > -40 ? 0 : Math.max(-6, (z + 40) / 5));
  const collider = { heightfield: { height: bed }, waterLevel: WL, deckHeight: () => NaN, sweepSphere: () => null };
  // The page's own ground: the sea is a floor to it (`WorldCollider.surfaceHeight`).
  const surface = (x, z) => Math.max(bed(x, z), WL);
  const amphibian = () => {
    const truck = new TrackedVehicle(amphibianNode(), null, {
      cockpit: false, groundHeight: surface, collider, waterLevel: WL,
      surfaceFriction: (x, z) => (bed(x, z) <= WL ? 0.1 : 1.0),
    });
    truck.state.position.set(0, 0.6, 0);
    return truck;
  };
  const out = {};
  {
    const truck = amphibian();
    out.engineType = truck.engine.engineType;
    out.hasKit = !!truck.amphibious;
    out.kit = { engines: truck.amphibious.engines.length, floats: truck.amphibious.floats.length,
                rudders: truck.amphibious.surfaces.length };
    // Ten seconds on the flat, as the Sherman: the water engine's revs pin at
    // 1.0 on the first press and it pushes nothing (`0x0824d047`).
    drive(truck, 5, holding({ c_PIThrottle: 1 }));
    out.land = { along: round(alongOf(truck), 2), wrevs: round(truck.amphibious.revs, 3),
                 afloat: truck.amphibious.afloat, grounded: truck.state.grounded };
    const sherman = tank(shermanNode, { ground: () => 0 });
    drive(sherman, 5, holding({ c_PIThrottle: 1 }));
    out.land.sherman = round(alongOf(sherman), 2);
    // On down the bank and out to sea: afloat, pushed by the screw.
    drive(truck, 35, holding({ c_PIThrottle: 1 }));
    const s = truck.state;
    out.sea = { z: round(s.position.z, 1), y: round(s.position.y, 2), along: round(alongOf(truck), 2),
                wrevs: round(truck.amphibious.revs, 3), afloat: truck.amphibious.afloat,
                grounded: s.grounded, bedUnder: round(bed(s.position.x, s.position.z), 1),
                pitch: round(pitchDeg(truck), 2), roll: round(rollDeg(truck), 2) };
    // The rudders turn her afloat: `c_PIYaw` right.
    const f0 = forwardOf(truck);
    drive(truck, 5, holding({ c_PIThrottle: 1, c_PIYaw: 1 }));
    const f1 = forwardOf(truck);
    const turned = Math.atan2(f0.x * f1.z - f0.z * f1.x, f0.x * f1.x + f0.z * f1.z) * DEG;
    out.turn = { deg: round(turned, 1), roll: round(rollDeg(truck), 2) };
    // Let go of the throttle: she slows and stays afloat.
    drive(truck, 20, holding({ c_PIThrottle: 0, c_PIYaw: 0 }));
    out.coast = { speed: round(truck.state.velocity.length(), 2), afloat: truck.amphibious.afloat,
                  y: round(truck.state.position.y, 2) };
  }
  // With nobody at the wheel (`Engine+0x142` clear) neither engine runs.
  {
    const truck = amphibian();
    truck.engineRunning = false;
    drive(truck, 3, holding({ c_PIThrottle: 1 }));
    out.stopped = { along: round(alongOf(truck), 3), revs: truck.engine.revs, wrevs: truck.amphibious.revs };
  }
  // A plain tank carries no kit.
  out.shermanKit = tank(shermanNode).amphibious;
  results.amphibian = out;

  // ... and since 2026-10-06 neither it nor a jeep stands on the sea: the
  // floor is the bed for every land hull (`checkVsTerrain`, water makes no
  // impulse) and below the sea the hull's box drag takes the submerged
  // multiplier (`HullWater`). Both drive off the same bank at full throttle.
  const sinker = (kind, withSea = true) => {
    const node = kind === 'jeep' ? nestedWilly() : (() => {
      const root = shermanNode();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.49, 1.6, 5.76).translate(0, 0.6, 0));
      hull.name = 'Sherman_Hull_M1';
      root.getObjectByName('ShermanComplex').add(hull);
      return root;
    })();
    const Cls = kind === 'jeep' ? GroundVehicle : TrackedVehicle;
    const truck = new Cls(node, null, {
      cockpit: false, groundHeight: surface,
      ...(withSea ? { collider, waterLevel: WL } : {}),
      surfaceFriction: (x, z) => (bed(x, z) <= WL ? 0.1 : 1.0),
    });
    truck.state.position.set(0, 0.6, 0);
    let fastest = 0;
    drive(truck, 30, t => {
      t.setInput('c_PIThrottle', 1);
      if (t.state.position.z < -70) fastest = Math.max(fastest, t.state.velocity.length());
    });
    const s = truck.state;
    return {
      hasWater: !!truck.water, z: round(s.position.z, 1),
      aboveBed: round(s.position.y - bed(s.position.x, s.position.z), 2),
      belowSea: round(WL - s.position.y, 2), depth: round(truck.water?.depth ?? 0, 2),
      fastestDeep: round(fastest, 2), grounded: s.grounded,
    };
  };
  results.landHullsInTheSea = {
    jeep: sinker('jeep'), tank: sinker('tank'),
    // The same jeep with no sea handed to it keeps the page's floor.
    jeepNoSea: sinker('jeep', false),
  };
}

process.stdout.write(JSON.stringify(results, null, 2));
