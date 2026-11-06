// A pad's hull after a respawn, headless: the map's own pads and visibility
// (`viewer/level-statics.js`), its wreck and respawn (`viewer/vehicle-wrecks.js`
// `stepWrecks`, `respawnVehicle`), the hull sync that hides a hull its pad has
// dropped (`viewer/hull-bodies.js` `syncVehicleSpawnOwnership`) and the
// aircraft's survey (`viewer/aircraft.js` `aircraftSpec`, `Aircraft`), all
// imported from the viewer tree in place through the headless runner's hooks
// (`sim/env.mjs`). Prints one JSON blob for `tests/test_vehicle_respawn.py`.
//
// The level: a tank pad and a fighter pad, the fighter a P-51 shape (an Engine
// carrying a LandingGear carrying a wheel Spring, an elevator Wing), and a
// boat pad. Each hull is driven (`Vehicle`'s constructor takes it out of
// `spawners`), posed by its life (gear up, elevator deflected, turret turned),
// destroyed away from the pad, its wreck lingers and clears, and the pad
// stands it up again (feedback #7 and #9, features/browser-play-feedback-
// 2026-11-06). The body world is a stand-in: `respawnVehicleBody` puts the node
// back at its pad's world pose, as the real one does from `spawnInverse`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createLevelStatics }, { createVehicleWrecks }, { createHullBodies },
  { DamageableVehicle }, { Aircraft, aircraftSpec }, { Vehicle }] = await Promise.all([
  import('three'), imp('level-statics.js'), imp('vehicle-wrecks.js'), imp('hull-bodies.js'),
  imp('vehicle-damage.js'), imp('aircraft.js'), imp('vehicle-base.js'),
]);

const round = v => Math.round(v * 1000) / 1000;
const DT = 1 / 30;

function mesh(name, size = [1, 1, 1]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
  m.name = name;
  return m;
}

function hullRoot(name, at, category) {
  const node = new THREE.Group();
  node.name = name;
  node.userData = {
    control: name, templateKind: 'PlayerControlObject',
    armor: { hitpoints: 100, maxHitpoints: 100 },
    physics: { vehicleCategory: category, mass: 3000 },
  };
  node.position.set(...at);
  node.add(mesh(`${name}Body`, [3, 1, 5]));
  return node;
}

/** A tank: a turret on a yaw rig and a road wheel. */
function tank(at) {
  const node = hullRoot('PanzerIV', at, 'VCLand');
  const turret = mesh('PanzerIVTurret');
  turret.position.set(0, 1, 0);
  turret.userData = { templateKind: 'RotationalBundle',
    rig: { control: 'PanzerIV', axes: { yaw: { input: 'c_PIMouseLookX', min: -180, max: 180 } } } };
  node.add(turret);
  const wheel = mesh('PanzerIVWheel', [0.3, 0.8, 0.8]);
  wheel.position.set(1.4, -0.6, 0);
  wheel.userData = { templateKind: 'Spring', physics: { strength: 1, damping: 1 } };
  node.add(wheel);
  return node;
}

/** A P-51 shape: Engine -> LandingGear -> wheel Spring, and an elevator. */
function fighter(at) {
  const node = hullRoot('P51', at, 'VCAir');
  const engine = new THREE.Group();
  engine.name = 'P51Engine';
  engine.userData = { templateKind: 'Engine', physics: { engineType: 'c_ETPlane', torque: 10 } };
  node.add(engine);
  const gear = new THREE.Group();
  gear.name = 'P51Gear';
  gear.position.set(1.5, 0, 0);
  gear.userData = { templateKind: 'LandingGear', physics: {},
    rig: { control: 'P51', axes: { roll: { input: 'c_PIGear', min: 0, max: -80, driver: 'position' } } } };
  engine.add(gear);
  const wheel = mesh('P51Wheel', [0.3, 0.6, 0.6]);
  wheel.position.set(0, -1.5, 0);
  wheel.userData = { templateKind: 'Spring', physics: { strength: 1, damping: 1 } };
  gear.add(wheel);
  const elevator = mesh('P51Elevator', [2, 0.1, 0.5]);
  elevator.position.set(0, 0.2, 4);
  elevator.userData = { templateKind: 'Wing', physics: {},
    rig: { control: 'P51', axes: { pitch: { input: 'c_PIPitch', min: -20, max: 20 } } } };
  node.add(elevator);
  return { node, gear, wheel, elevator };
}

function boat(at) {
  return hullRoot('Higgins', at, 'VCSea');
}

const turn = (node, axis, degrees) => node.quaternion.multiply(
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis), degrees * Math.PI / 180));

function worldPos(node) {
  node.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
}

/** The level and the page's modules over it. */
function stage() {
  const root = new THREE.Group();
  root.name = 'level';
  const spawners = new THREE.Group();
  spawners.name = 'spawners';
  spawners.userData.kind = 'spawners';
  root.add(spawners);
  const tankNode = tank([100, 0, 0]);
  const plane = fighter([200, 2, 0]);
  const boatNode = boat([300, 0, 0]);
  for (const n of [tankNode, plane.node, boatNode]) spawners.add(n);
  const pad = (spawner, vehicle, position) => ({ spawner, vehicle, team: 1, position,
    templates: { 1: vehicle }, minSpawnDelay: 20, maxSpawnDelay: 20 });
  const extras = {
    objectSpawns: [pad('tankspawner', 'PanzerIV', [100, 0, 0]), pad('planespawner', 'P51', [200, 2, 0]),
      pad('boatspawner', 'Higgins', [300, 0, 0])],
    controlPoints: [],
  };
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(200, 3, 10);
  const optVehicles = { checked: true };
  const statics = createLevelStatics({
    camera, drawDistance: () => 1000, extras, levelClips: [], optEntire: { checked: false },
    optVehicles, templateNameOf: n => n.userData?.control ?? n.name, world: { flags: [] },
  });
  statics.indexScene(root);

  const vehicleDamage = new Map();
  const world = {
    falling: new Set(), fireStates: new Map(), players: new Map(),
    addDamageable(owner, node, armor) {
      const v = new DamageableVehicle(armor, { owner, name: node?.name ?? null });
      vehicleDamage.set(owner, v);
      return v;
    },
  };
  const nodes = [tankNode, plane.node, boatNode];
  const padPose = new Map(nodes.map(n => { n.updateWorldMatrix(true, false); return [n, n.matrixWorld.clone()]; }));
  // The human, who stands where the test puts him (SPAWN-14 measures him alone).
  const human = { soldier: null };
  const page = {
    vehicles: { instanceOf: () => null, lastFlightOf: () => null },
    vehicleDamage, world, fireStates: new Map(), collider: null, extras,
    get soldier() { return human.soldier; }, soldierDead: false,
    optOnFoot: { checked: true }, optPilot: { checked: false },
    vehiclePads: statics,
    freezeVehicle: node => statics.freezeVehicle(node),
    respawnVehicleBody: owner => {
      const node = nodes[owner];
      const m = padPose.get(node).clone();
      node.parent.updateWorldMatrix(true, false);
      m.premultiply(node.parent.matrixWorld.clone().invert());
      m.decompose(node.position, node.quaternion, node.scale);
      THREE.Object3D.prototype.updateMatrixWorld.call(node, true);
    },
    retireVehicleBody() {},
  };
  const wrecks = createVehicleWrecks(page);
  wrecks.registerDamageables(nodes);
  const hulls = createHullBodies({
    get damageVisuals() { return wrecks.damageVisuals; },
    vehicleSpawnActive: n => statics.vehicleSpawnActive(n),
    get spawnersRoot() { return statics.spawnersRoot; },
    dropEntryPoints() {},
    collider: { statics: { enableOwner() {}, disableOwner() {}, setBodyOwner() {} } },
  });
  const frame = () => {
    wrecks.stepWrecks(DT);
    hulls.syncVehicleSpawnOwnership();
    statics.applyVisibility();
  };
  const run = seconds => { for (let t = 0; t < seconds; t += DT) frame(); };
  /** Destroyed where it stands, no wreck model: the no-wreck path, which
   *  fades the intact hull and then clears it (HP-19's 10 s). */
  const destroy = owner => {
    vehicleDamage.get(owner).damage(1e6);
    Object.assign(wrecks.damageVisuals.get(owner), {
      wrecked: true, latched: false, removed: false, wreckAge: 0, hidden: [], respawnIn: null,
    });
  };
  const drawn = node => {
    for (let n = node; n; n = n.parent) if (!n.visible) return false;
    return node.children.some(c => c.isMesh && c.visible);
  };
  return { root, spawners, tankNode, plane, boatNode, statics, wrecks, frame, run, destroy, drawn,
           human, padPose, vehicleDamage };
}

/** Drive, destroy away from the pad, wreck clears, the pad stands it again. */
function respawnCase() {
  const s = stage();
  s.run(1);
  const atLoad = {
    tankShown: s.drawn(s.tankNode), planeShown: s.drawn(s.plane.node),
    clearance: round(aircraftSpec(s.plane.node).groundClearance),
    wheelAnchorY: round(aircraftSpec(s.plane.node).wheels[0].anchor[1]),
  };
  const gearRest = s.plane.gear.quaternion.clone();
  const turretRest = s.tankNode.getObjectByName('PanzerIVTurret').quaternion.clone();
  const wheelRest = s.tankNode.getObjectByName('PanzerIVWheel').position.clone();

  // Somebody drives each: the constructor takes the node out of `spawners`.
  s.statics.thawVehicle(s.plane.node);
  const flight = new Aircraft(s.plane.node, s.root, { cockpit: false });
  const drive = new Vehicle(s.tankNode, s.root, { cockpit: false });
  const driven = { planeParent: s.plane.node.parent.name, tankParent: s.tankNode.parent.name,
    flightClearance: round(flight.spec.groundClearance) };
  // Their lives: the plane climbs out gear up, stick back; the tank drives off
  // with its turret round and a wheel up on its spring.
  s.plane.node.position.set(600, 150, 0);
  turn(s.plane.gear, [0, 0, 1], -80);
  turn(s.plane.elevator, [1, 0, 0], 15);
  s.tankNode.position.set(160, 0, 40);
  turn(s.tankNode.getObjectByName('PanzerIVTurret'), [0, 1, 0], 70);
  s.tankNode.getObjectByName('PanzerIVWheel').position.y += 0.2;
  s.root.updateMatrixWorld(true);
  void drive;

  s.destroy(0);
  s.destroy(1);
  let hiddenWhileGone = false;
  let respawnedAt = null;
  for (let t = 0; t < 40; t += DT) {
    s.frame();
    if (!s.tankNode.visible || !s.plane.node.visible) hiddenWhileGone = true;
    if (respawnedAt == null && !s.wrecks.damageVisuals.get(1).removed
        && !s.wrecks.damageVisuals.get(1).wrecked) respawnedAt = round(t);
  }
  const padAt = node => new THREE.Vector3().setFromMatrixPosition(s.padPose.get(node));
  const after = {
    respawnedAt, hiddenWhileGone,
    tankParent: s.tankNode.parent.name, planeParent: s.plane.node.parent.name,
    tankShown: s.drawn(s.tankNode), planeShown: s.drawn(s.plane.node),
    tankOnPad: round(worldPos(s.tankNode).distanceTo(padAt(s.tankNode))),
    planeOnPad: round(worldPos(s.plane.node).distanceTo(padAt(s.plane.node))),
    live: [s.statics.vehicleSpawnActive(s.tankNode), s.statics.vehicleSpawnActive(s.plane.node)],
    gearAtRest: s.plane.gear.quaternion.angleTo(gearRest) < 1e-6,
    elevatorAtRest: s.plane.elevator.quaternion.angleTo(new THREE.Quaternion()) < 1e-6,
    turretAtRest: s.tankNode.getObjectByName('PanzerIVTurret').quaternion.angleTo(turretRest) < 1e-6,
    wheelAtRest: s.tankNode.getObjectByName('PanzerIVWheel').position.distanceTo(wheelRest) < 1e-9,
    hp: [s.vehicleDamage.get(0).hitPoints, s.vehicleDamage.get(1).hitPoints],
    // Frozen again: parked, out of the per-frame matrix walk.
    frozen: [Object.hasOwn(s.tankNode, 'updateMatrixWorld'), Object.hasOwn(s.plane.node, 'updateMatrixWorld')],
  };
  // The next pilot's survey: the same undercarriage as at load.
  s.statics.thawVehicle(s.plane.node);
  const next = new Aircraft(s.plane.node, s.root, { cockpit: false });
  after.nextClearance = round(next.spec.groundClearance);
  after.nextWheelAnchorY = round(next.spec.wheels[0].anchor[1]);
  return { atLoad, driven, after };
}

/** A plane left parked gear-up (bellied in, its pilot out) and taken again
 *  without a respawn: the survey reads the airframe at rest, and leaves the
 *  pose it found. */
function parkedGearUp() {
  const { node, gear } = fighter([0, 2, 0]);
  const atRest = aircraftSpec(node);
  turn(gear, [0, 0, 1], -80);
  node.updateMatrixWorld(true);
  const up = aircraftSpec(node);
  return {
    restClearance: round(atRest.groundClearance), gearUpClearance: round(up.groundClearance),
    restAnchorY: round(atRest.wheels[0].anchor[1]), gearUpAnchorY: round(up.wheels[0].anchor[1]),
    poseKept: gear.quaternion.angleTo(new THREE.Quaternion()) > 1,
  };
}

/** SPAWN-14: a pad does not stand a land or air hull up with the human on
 *  foot within 2 m of it; it asks again every frame. A boat is not held. */
function clearance() {
  const s = stage();
  s.run(1);
  s.destroy(0);
  s.destroy(2);
  // The human stands on the tank pad, his origin a metre over his feet.
  s.human.soldier = { x: 100.5, y: -1, z: 0.5 };
  const visual = s.wrecks.damageVisuals;
  s.run(40);
  const held = { tankBack: !visual.get(0).removed, boatBack: !visual.get(2).removed };
  // 3 m off the point: clear, and the pad stands it on its next frame.
  s.human.soldier = { x: 103, y: -1, z: 0 };
  s.run(DT * 2);
  const stepsOff = { tankBack: !visual.get(0).removed };
  return { held, stepsOff, tankShown: s.drawn(s.tankNode) };
}

console.log(JSON.stringify({ respawn: respawnCase(), parkedGearUp: parkedGearUp(), clearance: clearance() }));
