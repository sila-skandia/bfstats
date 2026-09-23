// Drives `viewer/vehicle-bodies.js` and `viewer/body-world.js` outside a
// browser and prints one JSON blob. Both are framework-free: a "scene node" is
// anything with `matrixWorld.elements`, `userData`, `children` and `parent`,
// and a "vehicle" anything with a `state` of the `VehicleState` shape.
import {
  axesFromQuaternion, quaternionFromAxes, describeVehicleParts, DrivenBody,
  buildParkedVehicle, collisionPartsFor, meshEntryFor,
} from './vehicle-bodies.mjs';
import { BodyWorld } from './body-world.mjs';

const out = {};
const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// --- quaternion <-> axes -------------------------------------------------
{
  const s = Math.SQRT1_2;
  // A quarter turn about +Y: the body's X axis points down -Z, its Z down +X.
  const axes = axesFromQuaternion({ x: 0, y: s, z: 0, w: s }, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  out.quarterTurnY = axes;
  const roundTrips = [];
  for (const q of [
    { x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: s, z: 0, w: s }, { x: 1, y: 0, z: 0, w: 0 },
    { x: 0, y: 1, z: 0, w: 0 }, { x: 0, y: 0, z: 1, w: 0 },
    { x: 0.1825742, y: 0.3651484, z: 0.5477226, w: 0.7302967 },
    { x: 0.6, y: -0.64, z: 0.48, w: 0 },
  ]) {
    const a = axesFromQuaternion(q, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const back = quaternionFromAxes(a, { x: 0, y: 0, z: 0, w: 0 });
    // q and -q are the same rotation.
    const sign = (back.x * q.x + back.y * q.y + back.z * q.z + back.w * q.w) < 0 ? -1 : 1;
    roundTrips.push(Math.max(
      Math.abs(sign * back.x - q.x), Math.abs(sign * back.y - q.y),
      Math.abs(sign * back.z - q.z), Math.abs(sign * back.w - q.w)));
  }
  out.quaternionRoundTrip = Math.max(...roundTrips);
}

// --- a placed vehicle, as the assembler exports it ------------------------
// A closed box with outward normals: eight corners indexed xi*4 + yi*2 + zi.
const box = (hx, hy, hz, material) => {
  const v = [], vm = [];
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) { v.push(x, y, z); vm.push(material); }
  const quads = [
    [[4, 5, 7], [4, 7, 6], [1, 0, 0]], [[0, 1, 3], [0, 3, 2], [-1, 0, 0]],
    [[2, 3, 7], [2, 7, 6], [0, 1, 0]], [[0, 1, 5], [0, 5, 4], [0, -1, 0]],
    [[1, 3, 7], [1, 7, 5], [0, 0, 1]], [[0, 2, 6], [0, 6, 4], [0, 0, -1]],
  ];
  const f = [], fm = [], n = [];
  for (const [a, b, normal] of quads) for (const tri of [a, b]) { f.push(...tri); fm.push(material); n.push(...normal); }
  return { v, vm, f, fm, n };
};
const collisionMeshes = {
  meshes: {
    hull_m1: { bbox: [[-1, -0.5, -2], [1, 0.5, 2]], layers: [box(1, 0.5, 2, 45), box(1, 0.5, 2, 45)] },
    wheel_m1: { bbox: [[-0.1, -0.3, -0.3], [0.1, 0.3, 0.3]],
      layers: [{ v: [0, -0.3, 0, 0, -0.2, 0.2, 0, -0.2, -0.2], vm: [37, 37, 37], f: [0, 1, 2], fm: [37], n: [1, 0, 0] }] },
  },
  geometries: { hull_geometry: 'hull_m1', wheel_geometry: 'wheel_m1' },
};
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const node = (name, world, userData = {}) => ({ name, matrixWorld: { elements: world }, userData, children: [], parent: null });
const add = (parent, child) => { parent.children.push(child); child.parent = parent; return child; };
function jeepAt(x, y, z, physics = { mass: 2500, speedMod: 1 }) {
  const root = node('Jeep', translate(x, y, z), { physics, armor: { damageFromWater: true } });
  const hull = add(root, node('JeepHull', translate(x, y, z), { templateKind: 'SimpleObject' }));
  add(hull, node('JeepHull collision 1', translate(x, y, z), { collision: true, sourceGeometry: 'Hull_Geometry' }));
  for (const [i, [wx, wz]] of [[-0.8, -1.5], [0.8, -1.5], [-0.8, 1.5], [0.8, 1.5]].entries()) {
    const spring = add(root, node(`JeepSpring${i}`, translate(x + wx, y - 0.4, z + wz),
      { templateKind: 'Spring', physics: { gripFlags: 2, strength: 25, damping: 5 } }));
    add(spring, node(`JeepSpring${i} collision 0`, translate(x + wx, y - 0.4, z + wz),
      { collision: true, sourceGeometry: 'wheel_geometry' }));
  }
  return root;
}
{
  const spec = describeVehicleParts(jeepAt(10, 5, -20), collisionMeshes);
  out.describe = {
    mass: spec.mass, box: spec.box, speedMod: spec.speedMod, angleMod: spec.angleMod,
    damageMod: spec.damageMod, damageFromWater: spec.damageFromWater,
    boundingRadius: spec.boundingRadius,
    parts: spec.parts.map(p => ({ kind: p.kind, isRoot: p.isRoot, offset: p.offset,
      layers: p.shape.layers.length, spring: p.spring })),
  };
  out.describeAlias = !!meshEntryFor(collisionMeshes, 'HULL_GEOMETRY');
  out.describeNoMass = describeVehicleParts(jeepAt(0, 0, 0, { vehicleCategory: 'VCLand' }), collisionMeshes);
  out.describeUnresolved = describeVehicleParts(jeepAt(0, 0, 0), { meshes: {}, geometries: {} });
  // A rotated root: offsets come back in the BODY frame, not the world's.
  const turned = jeepAt(0, 0, 0);
  // Quarter turn about Y (column-major): X -> -Z, Z -> +X.
  const R = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1];
  turned.matrixWorld.elements = R;
  turned.children[0].matrixWorld.elements = R;
  turned.children[0].children[0].matrixWorld.elements = R;
  // A wheel one metre along the body's own X axis is at world -Z.
  turned.children[1].children[0].matrixWorld.elements = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 1];
  const turnedSpec = describeVehicleParts(turned, collisionMeshes);
  out.describeTurnedOffset = turnedSpec.parts.find(p => p.kind === 'spring').offset;
}

// --- a Spring the assembler gave no collision node ------------------------
// A tree extracted before `stdmesh.DEGENERATE_CROSS_SQ` stopped eating a
// wheel probe's millimetre triangle has the Spring but not the node under it.
// `describeVehicleParts` resolves the probe through the Spring's own
// `geometry` instead; that is where `PhysicsSpring` reads it from anyway.
function jeepWithBareSprings(x, y, z, { geometry = 'wheel_geometry' } = {}) {
  const root = node('Jeep', translate(x, y, z),
    { physics: { mass: 2500, speedMod: 1 }, armor: {} });
  const hull = add(root, node('JeepHull', translate(x, y, z), { templateKind: 'SimpleObject' }));
  add(hull, node('JeepHull collision 1', translate(x, y, z),
    { collision: true, sourceGeometry: 'Hull_Geometry' }));
  for (const [i, [wx, wz]] of [[-0.8, -1.5], [0.8, -1.5], [-0.8, 1.5], [0.8, 1.5]].entries()) {
    add(root, node(`JeepSpring${i}`, translate(x + wx, y - 0.4, z + wz),
      { templateKind: 'Spring', geometry,
        physics: { gripFlags: 2, strength: 25, damping: 5 } }));
  }
  return root;
}
{
  const spec = describeVehicleParts(jeepWithBareSprings(10, 5, -20), collisionMeshes);
  out.bareSprings = {
    springs: spec.parts.filter(p => p.kind === 'spring').length,
    body: spec.parts.filter(p => p.kind === 'body').length,
    offsets: spec.parts.filter(p => p.kind === 'spring').map(p => p.offset),
    spring: spec.parts.find(p => p.kind === 'spring').spring,
    box: spec.box,
  };
  // A geometry with no collision of its own stays scenery: no invention.
  out.bareSpringsUnresolved = describeVehicleParts(
    jeepWithBareSprings(0, 0, 0, { geometry: 'no_such_geometry' }), collisionMeshes)
    .parts.filter(p => p.kind === 'spring').length;
  // And a Spring that HAS its node is counted once, not twice, even though it
  // also names the geometry.
  const both = jeepAt(0, 0, 0);
  for (const child of both.children) {
    if (child.userData.templateKind === 'Spring') child.userData.geometry = 'wheel_geometry';
  }
  out.bareSpringsNoDoubleCount =
    describeVehicleParts(both, collisionMeshes).parts.filter(p => p.kind === 'spring').length;
}

// --- the driven vehicle as a body -------------------------------------------
{
  const vehicle = { state: {
    position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 4, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0.5, z: 0 } } };
  const body = new DrivenBody(vehicle, { mass: 2500, inertiaModifier: [1, 1, 1], box: [2, 1, 4], boundingRadius: 3 });
  // v + w x r with r = (0, 0, 2): (4,0,0) + (0,0.5,0) x (0,0,2) = (4 + 1, 0, 0).
  out.drivenTangent = body.tangentSpeed([1, 2, 5], [0, 0, 0]);
  body.translate([0.5, 0, 0]);
  out.drivenTranslated = { ...vehicle.state.position };
  // 30 m/s^2 along +X at a point 2 m along +Z: dv = 1 m/s; torque r x a =
  // (0,0,2) x (30,0,0) = (0, 60, 0); Iy = (dz^2 + dx^2)/3 = 20/3; dw = 60/30/(20/3) = 0.3.
  body.addAccelerationAt([1.5, 2, 5], [30, 0, 0]);
  body.addFrictionAt([0, 0, 0], [99, 99, 99]);   // dropped by design
  body.flush(1 / 30);
  out.drivenFlushed = { velocity: { ...vehicle.state.velocity }, angular: { ...vehicle.state.angularVelocity } };
  // The accumulators are spent.
  body.flush(1 / 30);
  out.drivenFlushedTwice = { ...vehicle.state.velocity };
  // Turned a quarter turn about Y the same world torque lands on the same BODY axis (Y).
  vehicle.state.orientation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  vehicle.state.angularVelocity = { x: 0, y: 0, z: 0 };
  body.sync();
  body.addAccelerationAt([body.pos[0], body.pos[1], body.pos[2] + 2], [30, 0, 0]);
  body.flush(1 / 30);
  out.drivenTurnedAngular = { ...vehicle.state.angularVelocity };
  // Clamp: 1e5 m/s^2 is cut to 1000 before it is spent.
  vehicle.state.velocity = { x: 0, y: 0, z: 0 };
  body.sync();
  body.addAcceleration([1e5, 0, 0]);
  body.flush(1 / 30);
  out.drivenClamped = vehicle.state.velocity.x;
}

// --- the hull-contact hand-over to the drive model --------------------------
//
// `wheeled-vehicle.js` runs the viewer's own friction solver, so a driven vehicle's
// resolved contacts are handed to it rather than answered here
// (collision-response.md section 8). The hand-over is opt-in — a vehicle that
// has not declared `hullContacts` gets nothing — and the list is emptied at
// the top of every tick, by `sync`.
{
  const vehicle = { state: {
    position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } } };
  const body = new DrivenBody(vehicle, { mass: 2500, box: [2, 1, 4], boundingRadius: 3 });
  // No `hullContacts` declared: nothing is published and nothing throws.
  body.noteContact({ count: 1, avgNormal: [0, 0, 1], avgRelPos: [0, 0, 0],
                     friction: 1, resistance: 0.01 }, [0, 0, 0]);
  out.hullContactsOptIn = vehicle.hullContacts ?? null;

  vehicle.hullContacts = [];
  // A response with no contact this tick publishes nothing.
  body.noteContact({ count: 0, avgNormal: [0, 0, 0], avgRelPos: [0, 0, 0],
                     friction: 1, resistance: 0.01 }, [0, 0, 0]);
  out.hullContactsEmptyResponse = vehicle.hullContacts.length;

  const response = { count: 2, avgNormal: [0, 0.25, 0.9], avgRelPos: [0.1, -0.2, -1.5],
                     friction: 0.95, resistance: 0.01 };
  body.noteContact(response, [1, 2, 3]);
  out.hullContact = vehicle.hullContacts[0];
  // The normal is a COPY: the solver reuses its accumulator in place.
  response.avgNormal[1] = 99;
  out.hullContactNormalCopied = vehicle.hullContacts[0].normal[1];
  // And the tick's list is cleared by `sync`, so a tick with no contact
  // clears the drive model's view of them.
  body.sync();
  out.hullContactsClearedBySync = vehicle.hullContacts.length;
  // Capped, so a hull wedged in a corner cannot grow it without bound.
  for (let i = 0; i < 50; i++) body.noteContact(response, [0, 0, 0]);
  out.hullContactsCap = vehicle.hullContacts.length;
}

// --- the world loop ---------------------------------------------------------
{
  const tables = { materials: { 0: { attGroup: 0, defGroup: 0, damage: 30, friction: 1, resistance: 0.02 },
    45: { attGroup: 45, defGroup: 45, damage: 1, friction: 1 } },
    modifiers: { 45: { 45: 0.1 }, 0: { 45: 0.01 } } };
  const terrain = { height: () => 0, normal: (x, z, o) => { o[0] = 0; o[1] = 1; o[2] = 0; return o; }, material: () => 0, waterLevel: null };
  const events = [];
  const world = new BodyWorld({ tables, terrain, onDamage: (owner, r, at, other) => events.push({ owner, other, damage: r.damage, tick: world.ticks }) });
  const spec = describeVehicleParts(jeepAt(0, 0, 0), collisionMeshes);
  const parked = buildParkedVehicle(spec, { position: [0, 0.9, 0], axes: IDENTITY, asleep: false });
  world.addParked(7, parked, spec);
  out.worldOwnersTagged = parked.parts.every(p => p.owner === 7);
  let ticks = 0;
  while (!parked.body.sleeping && ticks < 400) { world.tick(); ticks++; }
  out.worldSettle = { ticks, y: parked.body.pos[1], sleeping: parked.body.sleeping, events: events.length };
  // Rest: four wheels share |g| = 14.73 at 1.5 * 25 per metre, so each sinks
  // 14.73 / (4 * 37.5) = 0.0982 m; the wheel's lowest vertex is 0.4 + 0.3 below the root.
  out.worldExpectedRestY = 0.7 - 14.73 / (4 * 1.5 * 25);

  // A driven body at 15 m/s into the sleeping one: both are damaged once, the
  // parked one wakes and moves, and step() runs whole ticks only.
  const vehicle = { state: { position: { x: -6, y: parked.body.pos[1], z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 15, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 } } };
  const driven = new DrivenBody(vehicle, spec);
  world.addDriven(9, driven, collisionPartsFor(spec, driven, { hullOnly: true }), spec);
  out.worldDrivenHullOnly = world.get(9).parts.every(p => p.kind === 'body');
  const x0 = parked.body.pos[0];
  let ran = 0;
  for (let frame = 0; frame < 90; frame++) {
    vehicle.state.position.x += vehicle.state.velocity.x / 60;
    ran += world.step(1 / 60);
  }
  out.worldRam = {
    ticksFor90Frames: ran,
    parkedMoved: parked.body.pos[0] - x0,
    parkedWoke: parked.body.sleepiness > 0,
    drivenSlowed: vehicle.state.velocity.x < 15,
    victims: [...new Set(events.map(e => e.owner))].sort(),
    perVictimFirstSecond: [7, 9].map(o => events.filter(e => e.owner === o && e.tick <= events[0].tick + 29).length),
  };
  world.remove(9);
  out.worldRemoved = world.get(9) === null && world.entries.size === 1;
  // A stalled tab owes thousands of ticks; the backlog is dropped, not replayed.
  const before = world.ticks;
  world.step(60);
  out.worldBacklog = world.ticks - before;
}

console.log(JSON.stringify(out));
