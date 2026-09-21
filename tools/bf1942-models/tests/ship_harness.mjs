// Sails `viewer/ship.js` outside a browser and prints one JSON blob.
//
// Same arrangement as `flight_harness.mjs`, which `test_ship.py` reuses:
// `ship.js` imports three and `flight.js`, so both are copied in and the
// vendored three is published as a one-file package.
//
// The hull is built here as an `Object3D` tree carrying exactly the `userData`
// a map glb carries, because that is what `shipSpec` reads. Every number in it
// is the Fletcher's own authored data --
// `Objects/Vehicles/Sea/fletcher/Objects.con` and its `Physics.con`: mass
// 2 500 000, drag 3, `Fletcher_Engine` `c_ETShip` at 0/-4/40 with
// `setDifferential 2` and `setNoPropellerEffectAtSpeed 120`, `Fletcher_rudder`
// and `Fletcher_HullWing` at 0/-5/+-55 with `setWingLift 0 / setFlapLift 2` on
// `c_PIYaw` and opposite `setAcceleration` signs, and eight `Fletcher_Floater`
// at relY 7.5 with `setHullHeight 20` / `setFloatMin/MaxLift 2`. The glb frame
// mirrors z, so the node translations below are the `.con` values with z
// negated, exactly as `bf42/gltf.py` writes them.
import * as THREE from 'three';
import { Ship, shipSpec } from './ship.mjs';
import { GRAVITY } from './flight.mjs';

const WATER = 20;
/** The Fletcher's closed-form draft: 20 + 20 - 9.82*20/(8*2) - 7.5. */
const DRAFT = 20.225;

const node = (name, extras, position, quaternion = null) => {
  const obj = new THREE.Object3D();
  obj.name = name;
  obj.userData = extras;
  obj.position.set(position[0], position[1], -position[2]);   // mirror z
  if (quaternion) obj.quaternion.set(...quaternion);
  return obj;
};

function buildFletcher() {
  const hull = node('Fletcher', {
    templateKind: 'PlayerControlObject', control: 'Fletcher',
    physics: { mass: 2500000, drag: 3, vehicleCategory: 'VCSea',
               vehicleType: 'VTDestroyer' },
    armor: { hitpoints: 300, maxHitpoints: 300, criticalDamage: 50 },
  }, [0, DRAFT, 0]);
  hull.add(node('Fletcher_Engine', {
    templateKind: 'Engine', control: 'Fletcher',
    physics: { engineType: 'c_ETShip', torque: 2, differential: 2,
               noPropellerEffectAtSpeed: 120,
               maxRotation: [0, 0, 5000], maxSpeed: [0, 0, 5000],
               acceleration: [0, 0, 5000] },
  }, [0, -4, 40]));
  // Both rudders carry `setRotation 0/0/-90`, which the exporter writes as a
  // quaternion about z. Opposite `direction` is the whole steering story.
  for (const [name, z, direction] of [['Fletcher_rudder', -55, 1],
                                      ['Fletcher_HullWing', 55, -1]]) {
    hull.add(node(name, {
      templateKind: 'Wing', control: 'Fletcher',
      physics: { wingLift: 0, flapLift: 2, positionOffset: [0, 0, 0] },
      rig: { control: 'Fletcher', automaticReset: true, axes: { pitch: {
        input: 'c_PIYaw', min: -25, max: 25, free: false, driver: 'position',
        maxSpeed: 15, direction, acceleration: 10 * direction } } },
    }, [0, -5, z], [0, 0, -Math.SQRT1_2, Math.SQRT1_2]));
  }
  for (const [x, z] of [[-1.999, -50], [2, -50], [-4.999, -17], [5, -17],
                        [-4.999, 17], [5, 17], [-1.999, 50], [2, 50]]) {
    hull.add(node('Fletcher_Floater', {
      templateKind: 'FloatingBundle', control: 'Fletcher',
      physics: { hullHeight: 20, floatMaxLift: 2, floatMinLift: 2,
                 sinkingSpeedMod: 1 },
    }, [x, 7.5, z]));
  }
  // A hull mesh, so the bounding box is a destroyer's and not a point. The
  // engine takes `DX*DZ` and `DY` off the object's own geometry box.
  const body = new THREE.Mesh(new THREE.BoxGeometry(18.73, 12, 133.86));
  body.position.set(0, 1, 0);
  hull.add(body);
  const scene = new THREE.Scene();
  scene.add(hull);
  scene.updateMatrixWorld(true);
  return { hull, scene };
}

const out = {};

// --- (a) the spec, read off the tree -----------------------------------------
{
  const { hull } = buildFletcher();
  const spec = shipSpec(hull);
  out.spec = {
    mass: spec.mass, drag: spec.drag, throttleMin: spec.throttleMin,
    throttleRate: spec.throttleRate,
    size: spec.size.map(n => +n.toFixed(3)),
    engines: spec.engines.map(e => ({ id: e.id, engineType: e.engineType,
      position: e.position, differential: e.differential,
      fade: e.noPropellerEffectAtSpeed })),
    surfaces: spec.surfaces.map(s => ({ id: s.id, attach: s.attach,
      input: s.input, direction: s.direction, wingLift: s.wingLift,
      flapLift: s.flapLift, min: s.min, max: s.max, maxSpeed: s.maxSpeed })),
  };
  // A hull with no Engine is not a ship: a `Lcvp` without its engine node, or
  // a raft, must not be handed a drive model.
  const bare = new THREE.Object3D();
  bare.userData = { templateKind: 'PlayerControlObject',
                    physics: { mass: 30000, vehicleCategory: 'VCSea' } };
  out.specWithoutEngine = shipSpec(bare);
}

// --- (b) the water gate -------------------------------------------------------
{
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  ship.state.throttle = 1;
  out.gate = {
    // The screw, authored below the waterline: thrust runs.
    submerged: ship.waterGate(ship.engines[0], WATER - 4),
    // Lifted clear with the throttle open: no thrust, and the stored throttle
    // is pinned to 1.
    clearOfTheWater: ship.waterGate(ship.engines[0], WATER + 1),
    throttleAfterPin: ship.state.throttle,
  };
  ship.state.throttle = 0.01;
  out.gate.clearInTheDeadBand = ship.waterGate(ship.engines[0], WATER + 1);
  // ... and the aircraft's own rule, which is the mirror, taken through the
  // same method by giving the engine a plane's type.
  out.gate.planeSubmerged = ship.waterGate(
    { ...ship.engines[0], engineType: 'c_ETPlane' }, WATER - 4);
}

// --- (c) afloat, under way, and turning --------------------------------------
function run(ticks, { throttle = 0, yaw = 0 } = {}) {
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  ship.autoFirstPerson = false;
  ship.setInput('c_PIThrottle', throttle);
  ship.setInput('c_PIYaw', yaw);
  const trace = [];
  for (let i = 0; i < ticks; i++) {
    ship.integrate(1 / 30);
    if (i % 60 === 0) trace.push(+ship.state.position.y.toFixed(4));
  }
  const s = ship.state;
  // `flight.js`'s own FORWARD is (0, 0, -1) -- three's convention, and the
  // axis thrust is applied along. `along > 0` is therefore ahead.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
  return {
    y: +s.position.y.toFixed(4),
    vy: +s.velocity.y.toFixed(5),
    speed: +s.velocity.length().toFixed(4),
    along: +s.velocity.dot(fwd).toFixed(4),
    heading: +(Math.atan2(fwd.x, fwd.z) * 180 / Math.PI).toFixed(3),
    // Degrees turned since the hull was built, signed and unwrapped: the
    // starting heading is 180 (FORWARD is -z), which is exactly where a raw
    // atan2 comparison wraps and calls two opposite turns the same turn.
    turned: +(((Math.atan2(fwd.x, fwd.z) * 180 / Math.PI) - 180 + 540) % 360
              - 180).toFixed(3),
    throttle: +s.throttle.toFixed(4),
    trace,
  };
}

out.afloat = run(300);
out.ahead = run(900, { throttle: 1 });
out.astern = run(900, { throttle: -1 });
out.turning = run(900, { throttle: 1, yaw: 1 });
out.turningOther = run(900, { throttle: 1, yaw: -1 });

// A hull dropped a metre above its draft comes back down to it and stays.
{
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  ship.state.position.y += 1;
  for (let i = 0; i < 6000; i++) ship.integrate(1 / 30);
  out.dropped = { y: +ship.state.position.y.toFixed(3),
                  vy: +ship.state.velocity.y.toFixed(5) };
}

console.log(JSON.stringify(out));
