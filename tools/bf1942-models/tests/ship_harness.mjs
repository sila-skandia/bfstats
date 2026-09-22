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
import { Ship, shipSpec, hullGeometry } from './ship.mjs';
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
    // The Engine's own `RotationalBundle` roll axis, as the extractor emits it:
    // `setMinRotation 0/0/-4000` to `setMaxRotation 0/0/5000`, which is what
    // makes `T1` -0.8 astern rather than -1.
    rig: { control: 'Fletcher', automaticReset: true, axes: { roll: {
      input: 'c_PIThrottle', min: -4000, max: 5000, free: false,
      driver: 'rate', maxSpeed: 5000, direction: 1, acceleration: 5000 } } },
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
  // engine takes `DX*DZ` and `DY` off the object's own geometry box -- its OWN,
  // which is why the turret and the water sprite below must not be in it.
  const body = new THREE.Mesh(new THREE.BoxGeometry(18.73, 12, 133.86));
  body.position.set(0, 1, 0);
  hull.add(body);
  // The hull's own collision layer, a metre shallower than the drawn hull: keel
  // at relative y -4.0, which is what `setUnderWater` measures and what rests
  // on the sea bed.
  const col = new THREE.Mesh(new THREE.BoxGeometry(17, 12, 130));
  col.name = 'FletcherComplex collision 1';
  col.position.set(0, 1, 0);
  body.add(col);
  // A turret 12 m up and a wash sprite 5 m down: both are separate objects with
  // geometry of their own, and the root's box contains neither.
  const turret = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 5));
  turret.userData = { templateKind: 'RotationalBundle' };
  turret.position.set(0, 12, -20);
  body.add(turret);
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  wash.userData = { templateKind: 'SpriteParticle' };
  wash.position.set(0, -5, 60);
  body.add(wash);
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
    inertiaLaw: spec.inertiaLaw,
    groundClearance: +spec.groundClearance.toFixed(3),
    boxBottom: +spec.boxBottom.toFixed(3),
    keel: +spec.keel.toFixed(3),
    size: spec.size.map(n => +n.toFixed(3)),
    engines: spec.engines.map(e => ({ id: e.id, engineType: e.engineType,
      position: e.position, differential: e.differential, torque: e.torque,
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

// --- (a2) the geometry box is the root's own mesh -----------------------------
{
  const { hull } = buildFletcher();
  const g = hullGeometry(hull);
  out.geometry = { size: g.size.map(n => +n.toFixed(3)),
                   bottom: +g.bottom.toFixed(3), keel: +g.keel.toFixed(3) };
  // ... and it is measured in the hull's own frame, so a hull at 45 degrees of
  // yaw reports the same box rather than its world AABB.
  hull.rotation.y = Math.PI / 4;
  hull.updateMatrixWorld(true);
  const turned = hullGeometry(hull);
  out.geometryTurned = turned.size.map(n => +n.toFixed(3));
}

// --- (b) the water gate -------------------------------------------------------
{
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  // `+0xa0`, the revs: the value the gate reads and pins, not the pedal.
  ship.revs = 1;
  ship.state.throttle = 1;
  out.gate = {
    // The screw, authored below the waterline: thrust runs, on the revs.
    submerged: ship.waterGate(ship.engines[0], WATER - 4),
    // Lifted clear with the revs up: no thrust, and `+0xa0` is pinned to 1.
    clearOfTheWater: ship.waterGate(ship.engines[0], WATER + 1),
    revsAfterPin: ship.revs,
    // ... and the helm order is untouched: the engine pins the REVS.
    throttleAfterPin: ship.state.throttle,
  };
  ship.revs = 0.01;
  out.gate.clearInTheDeadBand = ship.waterGate(ship.engines[0], WATER + 1);
  // ... and the aircraft's own rule, which is the mirror, taken through the
  // same method by giving the engine a plane's type.
  out.gate.planeSubmerged = ship.waterGate(
    { ...ship.engines[0], engineType: 'c_ETPlane' }, WATER - 4);
}

// --- (b2) inertia, and the angular half of the box law ------------------------
{
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  out.inertia = { x: +ship.inertia.x.toFixed(1), y: +ship.inertia.y.toFixed(1),
                  z: +ship.inertia.z.toFixed(1) };
  // The angular arm of `PhysicsNode`'s box drag, measured on its own at five
  // degrees a second of yaw: `k' = -drag*|w|/mass` times `(Ax+Az)` about y.
  const accel = new THREE.Vector3();
  const moment = new THREE.Vector3();
  ship.state.angularVelocity.set(0, 5 * Math.PI / 180, 0);
  ship.applyDrag(accel, 1 / 120, moment);
  out.angularDrag = {
    momentY: moment.y,
    // ... and what that is as an angular acceleration, which is what the rudder
    // couple has to be compared against: the moment goes through
    // `_torque = moment*mass` and then `/inertia.y`.
    alphaY: moment.y * ship.spec.mass / ship.inertia.y,
  };
}

// --- (c) afloat, under way, and turning --------------------------------------
const headingOf = ship => {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.state.orientation);
  return Math.atan2(fwd.x, fwd.z) * 180 / Math.PI;
};
/** Degrees turned from the build heading (180), signed and unwrapped. */
const turnedBy = ship => ((headingOf(ship) - 180 + 540) % 360) - 180;

function run(ticks, { throttle = 0, yaw = 0, seaBed = null, inertiaLaw = null } = {}) {
  const { hull, scene } = buildFletcher();
  const spec = shipSpec(hull);
  if (inertiaLaw) spec.inertiaLaw = inertiaLaw;
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false, spec });
  ship.autoFirstPerson = false;
  if (seaBed !== null) ship.groundHeight = () => seaBed;
  ship.setInput('c_PIThrottle', throttle);
  ship.setInput('c_PIYaw', yaw);
  const trace = [];
  const marks = {};
  for (let i = 0; i < ticks; i++) {
    ship.integrate(1 / 30);
    if (i % 60 === 0) trace.push(+ship.state.position.y.toFixed(4));
    if (i === 299) {
      marks.tenSeconds = { turned: +turnedBy(ship).toFixed(3),
                           speed: +ship.state.velocity.length().toFixed(4) };
    }
    if (i === ticks - 31) marks.headingBefore = headingOf(ship);
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
    turned: +turnedBy(ship).toFixed(3),
    throttle: +s.throttle.toFixed(4),
    // `PhysicsEngine+0xa0` -- the value the thrust law actually reads.
    revs: +ship.revs.toFixed(4),
    load: +ship.load.toFixed(4),
    underWater: +ship.underWater().toFixed(4),
    aground: ship.aground,
    // Degrees per second over the LAST second, which is the steady rate rather
    // than the spin-up average.
    rate: marks.headingBefore === undefined ? null
      : +(((headingOf(ship) - marks.headingBefore + 540) % 360 - 180)).toFixed(4),
    tenSeconds: marks.tenSeconds ?? null,
    trace,
  };
}

out.afloat = run(300);
out.ahead = run(900, { throttle: 1 });
out.astern = run(900, { throttle: -1 });
out.turning = run(900, { throttle: 1, yaw: 1 });
out.turningOther = run(900, { throttle: 1, yaw: -1 });
// The same run on a SOLID BOX's inertia -- `/12` rather than the engine's `/3`,
// which is what this file carried before W8-A. Everything else is identical, so
// the difference is the inertia and nothing else: it is what the hull does in the
// first seconds of a turn, and it is NOT the steady rate, which the two `Wing`s
// set between them.
out.turningSolidBox = run(900, { throttle: 1, yaw: 1, inertiaLaw: 'box' });
// ... sampled early, where the difference lives.
out.helmAnswer = [1, 2, 3, 5].map(seconds => ({
  seconds,
  geometry: run(Math.round(seconds * 30) + 1, { throttle: 1, yaw: 1 }).turned,
  box: run(Math.round(seconds * 30) + 1, { throttle: 1, yaw: 1, inertiaLaw: 'box' }).turned,
}));

// --- (d) aground --------------------------------------------------------------
// The sea bed at 17.0: the keel (relative y -4.0) rests on it at a root y of
// 21.0, which is 0.775 m ABOVE her draft, so she is held up as well as held
// still. Full ahead throughout.
out.beached = run(900, { throttle: 1, seaBed: 17.0 });
// The same shoal met at speed: she makes way over deep water, hits it, and
// stops. Driven by hand so the approach and the grounding are separable.
{
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  ship.autoFirstPerson = false;
  // Deep water for the first 300 m of her run; a sandbank beyond it.
  ship.groundHeight = (x, z) => (-z > 300 ? 17.0 : 0);
  ship.setInput('c_PIThrottle', 1);
  const track = [];
  let struck = -1;
  for (let i = 0; i < 4000; i++) {
    ship.integrate(1 / 30);
    if (struck < 0 && ship.aground) struck = i;
    if (i % 500 === 0 || i === 3999) {
      track.push({ t: +(i / 30).toFixed(1), z: +(-ship.state.position.z).toFixed(2),
                   y: +ship.state.position.y.toFixed(3),
                   speed: +ship.state.velocity.length().toFixed(4),
                   aground: ship.aground });
    }
  }
  out.ranAground = {
    struckAt: struck < 0 ? null : +(struck / 30).toFixed(2),
    track,
    // Ten more seconds of full ahead after she is stuck, and then astern: a car
    // would drive itself out, a beached hull does not.
    heldAhead: null, heldAstern: null,
  };
  const zStuck = -ship.state.position.z;
  for (let i = 0; i < 300; i++) ship.integrate(1 / 30);
  out.ranAground.heldAhead = { moved: +(-ship.state.position.z - zStuck).toFixed(4),
                               speed: +ship.state.velocity.length().toFixed(4) };
  ship.setInput('c_PIThrottle', -1);
  for (let i = 0; i < 900; i++) ship.integrate(1 / 30);
  out.ranAground.heldAstern = { moved: +(-ship.state.position.z - zStuck).toFixed(4),
                                speed: +ship.state.velocity.length().toFixed(4),
                                aground: ship.aground };
}

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
