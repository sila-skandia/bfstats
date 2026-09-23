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

// --- (a3) no mesh down the chain: a landing craft --------------------------------
// The Daihatsu's hull is a `SimpleObject` under its cockpit `LodObject`, so
// the chain finds nothing; the fallback measures every mesh but the effects'
// in the root's own frame (a world AABB of the yawed craft read 20.8 m square).
{
  const craft = new THREE.Object3D();
  craft.userData = { templateKind: 'PlayerControlObject', physics: { mass: 30000, vehicleCategory: 'VCSea' } };
  const lod = new THREE.Object3D(); lod.userData = { templateKind: 'LodObject' };
  const simple = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.4, 14.1));
  simple.userData = { templateKind: 'SimpleObject' };
  simple.position.set(0, -0.13, 0);
  const effects = new THREE.Object3D(); effects.userData = { templateKind: 'EffectBundle' };
  const foam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); foam.position.set(0, -2.5, 6);
  effects.add(foam);
  lod.add(simple); craft.add(lod); craft.add(effects);
  craft.rotation.y = Math.PI / 4;
  craft.updateMatrixWorld(true);
  const g = hullGeometry(craft);
  out.craftGeometry = { size: g.size.map(n => +n.toFixed(3)), keel: +g.keel.toFixed(3) };
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

// --- (e) the reef wall: W9-A ---------------------------------------------------
//
// Midway's own sea bed, measured on the z = -1903 line: a flat ocean floor at
// 0.01 for hundreds of metres, then ONE 4 m heightfield cell that rises to
// 16.31 (a 63.8 degree face), then the lagoon shelf. A hull that is grounded on
// her ORIGIN's column alone sails over the floor with nothing to stop her, puts
// her bow up to half her length INSIDE that wall, and is then billed crash
// damage for a contact with a vertical face --
// `c^3 * speedMod * V^2 * damageMod(wetSand, shipHull) * materialDamage`, where
// the middle term is 10.0 (`Bf1942/Game/Collision_Armor/HeavyArmor.con`, the
// `rem *** Wet Sand ***` blocks) and the last is 30, so the product is 300 and
// one square-on contact at 15 m/s is thousands of hit points.
//
// The bill is computed here from the hull's own footprint rather than from
// `ship.js`, so this asserts the ship against the terrain and not against
// itself. `damage` is `handleCollisionLandOrWater`'s land arm
// (`0x08154960`) for a ship: `|c|^3 * 0.05 * |v|^2 * 300`, gated at > 1.0.
{
  const WALL_START = 1500, WALL_END = 1508, WALL_TOP = 24.0;
  const bed = (x, z) => {
    const d = -z;
    if (d <= WALL_START) return 0.01;
    if (d >= WALL_END) return WALL_TOP;
    return 0.01 + (WALL_TOP - 0.01) * (d - WALL_START) / (WALL_END - WALL_START);
  };
  // The face's own normal, from the gradient: dh/dz over the wall, 0 elsewhere.
  const slope = (WALL_TOP - 0.01) / (WALL_END - WALL_START);
  const bedNormal = (x, z, out) => {
    const d = -z;
    if (d <= WALL_START || d >= WALL_END) return out.set(0, 1, 0);
    // h rises with d = -z, so dh/dz = -slope; n = normalize(0, 1, -dh/dz).
    return out.set(0, 1, slope).normalize();
  };
  const { hull, scene } = buildFletcher();
  const ship = new Ship(hull, scene, { waterLevel: WATER, cockpit: false });
  ship.autoFirstPerson = false;
  ship.groundHeight = bed;
  ship.groundNormal = bedNormal;
  ship.setInput('c_PIThrottle', 1);
  // The footprint the engine's `checkVsTerrain` would sample: the collision
  // box's bottom face, in the hull's own frame. Independent of `ship.js`.
  const keel = ship.spec.keel;
  const [dx, , dz] = ship.spec.size;
  const corners = [];
  for (const fz of [-0.5, -0.25, 0, 0.25, 0.5]) {
    for (const fx of [-0.5, 0, 0.5]) corners.push([fx * dx, keel, fz * dz]);
  }
  const probe = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const worstOf = () => {
    const s = ship.state;
    let worst = 0, dmg = 0;
    for (const [lx, ly, lz] of corners) {
      probe.set(lx, ly, lz).applyQuaternion(s.orientation);
      const x = s.position.x + probe.x, z = s.position.z + probe.z;
      const under = bed(x, z) - (s.position.y + probe.y);
      if (!(under > 0)) continue;
      if (under > worst) worst = under;
      bedNormal(x, z, nrm);
      const v = s.velocity.length();
      if (!(v > 0)) continue;
      const c = Math.abs(s.velocity.dot(nrm) / (v * nrm.length()));
      const bill = Math.abs(c) ** 3 * 0.05 * v * v * 300;
      if (bill > 1.0 && bill > dmg) dmg = bill;
    }
    return { worst, dmg };
  };
  let buried = 0, worstBill = 0, struck = -1, topSpeed = 0;
  for (let i = 0; i < 9000; i++) {
    ship.integrate(1 / 30);
    const { worst, dmg } = worstOf();
    if (worst > buried) buried = worst;
    if (dmg > worstBill) worstBill = dmg;
    if (ship.state.velocity.length() > topSpeed) topSpeed = ship.state.velocity.length();
    if (struck < 0 && ship.aground) struck = i;
  }
  const zStuck = -ship.state.position.z;
  for (let i = 0; i < 300; i++) ship.integrate(1 / 30);
  out.reef = {
    struckAt: struck < 0 ? null : +(struck / 30).toFixed(2),
    topSpeed: +topSpeed.toFixed(3),
    // The deepest any part of the hull ever got under the bed. The whole point.
    buried: +buried.toFixed(4),
    // What the crash-damage path would have been handed, in hit points.
    worstBill: +worstBill.toFixed(2),
    aground: ship.aground,
    y: +ship.state.position.y.toFixed(3),
    z: +(-ship.state.position.z).toFixed(2),
    speed: +ship.state.velocity.length().toFixed(4),
    // Ten more seconds of full ahead once she is stuck.
    heldAhead: +(-ship.state.position.z - zStuck).toFixed(4),
    // She must not be perched above the waterline: her keel rests on the bed
    // she actually reached, not on the top of the wall ahead of her.
    keelAboveWater: +(ship.state.position.y + keel - WATER).toFixed(3),
  };
}

console.log(JSON.stringify(out));
