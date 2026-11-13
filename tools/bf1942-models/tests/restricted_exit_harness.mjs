// The restricted exit (ledger SEAT-42; `viewer/restricted-exit.js`): a seat
// whose PCO template says `hasRestrictedExit` casts the line from the seat to
// its `soldierExitLocation` raised 0.5 m against every object but its own
// hull; blocked, it tries X mirrored; both blocked, the press does nothing.
// The ground never blocks (`ObjectManager::intersectLine` walks objects only).
//
// One Sherman-sized hull (a 3 x 2 x 6 m box) with the Sherman's driver exit
// (-2, 0.5, 0) and `hasRestrictedExit 1`, and walls 0.2 m off either flank.
// Each case asks the page (`vehicle-entry.js` `exitPose`), the room
// (`level-instance.mjs` `exitPoseOf`) and the bots (`bot-units.js`
// `mayExit`). Run by `tests/test_restricted_exit.py`; one JSON blob.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { buildCollisionIndex }, { WorldCollider }, { buildHeightfield },
  { createVehicleEntry }, { restrictedExit, EXIT_TEST_LIFT }, { createBotUnits }] = await Promise.all([
  imp('vendor/three.module.js'), imp('static-index.js'), imp('world-collider.js'), imp('heightfield.js'),
  imp('vehicle-entry.js'), imp('restricted-exit.js'), imp('bot-units.js'),
]);
const { LevelInstance } = await import(pathToFileURL(path.join(viewer, '..', 'server', 'level-instance.mjs')).href);

const round = v => Math.round(v * 1000) / 1000;

function box(name, size, at) {
  const part = new THREE.Object3D();
  part.name = name;
  part.userData = { templateKind: 'SimpleObject', sourceTemplate: name };
  part.position.set(...at);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
  mesh.userData = { collision: true };
  part.add(mesh);
  return part;
}

function tank(at, restricted, exit = [-2, 0.5, 0]) {
  const root = new THREE.Object3D();
  root.name = 'Sherman';
  root.userData = {
    templateKind: 'PlayerControlObject',
    physics: { hasRestrictedExit: restricted, soldierExitLocation: { position: exit, rotation: [0, 0, 0] } },
  };
  root.position.set(...at);
  root.add(box('ShermanHull', [3, 2, 6], [0, 1, 0]));
  return root;
}

// `walls`: 'none', 'left' (the declared side, -x), 'right' or 'both'.
function world(walls, { restricted = true, at = [0, 0, 0], exit, heightfield = null } = {}) {
  const scene = new THREE.Object3D();
  const hull = tank(at, restricted, exit);
  scene.add(hull);
  const roots = [hull];
  // A wall face 0.2 m off each 1.5 m flank, 4 m tall, 10 m long.
  if (walls === 'left' || walls === 'both') {
    const w = box('wall_left', [1, 4, 10], [at[0] - 2.2, at[1] + 2, at[2]]);
    scene.add(w); roots.push(w);
  }
  if (walls === 'right' || walls === 'both') {
    const w = box('wall_right', [1, 4, 10], [at[0] + 2.2, at[1] + 2, at[2]]);
    scene.add(w); roots.push(w);
  }
  scene.updateMatrixWorld(true);
  const statics = buildCollisionIndex(scene, { ownerRoots: roots });
  const collider = new WorldCollider({ statics, heightfield });
  return { hull, collider, owner: statics.ownerOf(hull) };
}

function pageExit(w) {
  const entry = createVehicleEntry({ collider: w.collider, driveFwd: new THREE.Vector3() });
  const vehicle = { node: w.hull, state: { position: w.hull.position.clone(), orientation: w.hull.quaternion.clone() } };
  const e = entry.exitPose(vehicle);
  return { allowed: e.allowed, mirrored: e.mirrored, at: [round(e.x), round(e.y), round(e.z)] };
}

function roomExit(w) {
  const occ = { root: w.hull, exitLocationNode: () => w.hull };
  const e = LevelInstance.prototype.exitPoseOf.call({ collider: w.collider }, occ, w.owner);
  return { allowed: e.allowed, at: [round(e.x), round(e.y), round(e.z)] };
}

function botMayExit(w) {
  const seat = { root: w.hull, exitLocationNode: () => w.hull };
  const units = createBotUnits({ referee: () => null, collider: () => w.collider,
    vehicles: { seatOf: () => seat } });
  return units.mayExit({ playerId: 7 });
}

const out = { lift: EXIT_TEST_LIFT, cases: {} };
for (const walls of ['none', 'left', 'right', 'both']) {
  const w = world(walls);
  out.cases[walls] = { page: pageExit(w), room: roomExit(w), botMayExit: botMayExit(w) };
}
const free = world('both', { restricted: false });
out.unrestrictedBoth = { page: pageExit(free), room: roomExit(free), botMayExit: botMayExit(free) };

// The ground does not block: a hull on a slope (y = x / 4: 2 m under it,
// 2.5 m at x = 10) whose door line, from (8, 2.2) to (10, 2.4), runs into it.
const slope = [];
for (let iz = 0; iz < 4; iz++) {
  for (let ix = 0; ix < 4; ix++) {
    const x0 = ix * 4, x1 = x0 + 4, z0 = -iz * 4, z1 = z0 - 4;
    slope.push(x0, x0 / 4, z0, x1, x1 / 4, z0, x1, x1 / 4, z1, x0, x0 / 4, z0, x1, x1 / 4, z1, x0, x0 / 4, z1);
  }
}
const terrainMesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',
  new THREE.Float32BufferAttribute(slope, 3)));
terrainMesh.updateMatrixWorld(true);
const field = buildHeightfield([terrainMesh], { worldSize: 16, dim: 4 });
const sunk = world('none', { at: [8, 2.2, -8], exit: [2, -0.3, 0], heightfield: field });
const dx = 2, dy = 0.2, len = Math.hypot(dx, dy);
const ground = sunk.collider.cast(8, 2.2, -8, dx / len, dy / len, 0, len, sunk.owner);
out.sunk = { groundOnLine: ground?.kind ?? null, page: pageExit(sunk), botMayExit: botMayExit(sunk) };

// The rule alone: the mirror negates X only and keeps the lifted Y.
const seen = [];
const pure = restrictedExit({
  restricted: true, local: { x: -2.8, y: -0.5, z: 0.3 },
  toWorld: (x, y, z) => ({ x, y, z }), origin: { x: 0, y: 0, z: 0 },
  blocked: (ox, oy, oz, ux, uy, uz, l) => { seen.push([round(ux * l), round(uy * l), round(uz * l)]); return seen.length === 1; },
});
out.pure = { lines: seen, local: [pure.local.x, pure.local.y, pure.local.z], mirrored: pure.mirrored };
process.stdout.write(JSON.stringify(out));
