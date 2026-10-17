// `viewer/vehicle-entry.js`: where E reaches a door. The page asks the
// server's own finder (`GameServer::toggleEntryPoint` 0x0814ee70 ->
// `BFfindEntryPoint(origin, 3.0, team, useEntryRadius = 1)` 0x0831d770):
// the doors of every hull whose bounding sphere comes within 3 m of the
// soldier's origin (`ObjectManager::getObjectsFromGrid` 0x0819dc40, ledger
// SEAT-31), then the nearest free one inside its own `setEntryRadius`
// (SEAT-32). The M3A1 is Wake's, as the server posed it on 2026-10-17 (engine
// frame, the con's own offsets, `Objects/Vehicles/Land/m3a1/Objects.con`).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { createVehicleEntry } = await import(pathToFileURL(path.join(viewer, 'vehicle-entry.js')).href);
const { boundingRadius } = await import(pathToFileURL(path.join(viewer, 'entry-points.js')).href);

function node(parent, name, [x, y, z] = [0, 0, 0]) {
  const n = new THREE.Group();
  n.name = name;
  n.position.set(x, y, z);
  parent.add(n);
  return n;
}

// The M3A1: root PCO -> lodM3A1 -> M3A1Complex, and under the Complex the
// driver's two doors (`M3A1Entry`, 3.5 m), the Browning's PCO with its two
// (the same spots), the four passenger PCOs with `M3A1Entry3` (2.6 m) each,
// and the front wheels, 3 m forward (the harness has no meshes).
const m3a1 = new THREE.Group();
m3a1.name = 'M3A1';
m3a1.userData = { templateKind: 'PlayerControlObject', control: 'M3A1' };
m3a1.position.set(1017.31, 105.63, 857.08);
m3a1.quaternion.set(0.0049, -0.8425, 0.0072, 0.5387).normalize();
const complex = node(node(m3a1, 'lodM3A1'), 'M3A1Complex');
const doors = [];
const door = (parent, name, at, seatId, radius) => {
  doors.push({ node: node(parent, name, at), vehicle: m3a1, control: 'M3A1', seatId, radius });
};
door(complex, 'M3A1Entry', [0, 0.13, 2], 'driver', 3.5);
door(complex, 'M3A1Entry', [0, 0.13, 0], 'driver', 3.5);
const browning = node(complex, 'M3A1Browning_PCO1', [0.5, 1.25, 0.67]);
door(browning, 'M3A1Entry', [-0.5, -1.12, 1.33], 'browning', 3.5);
door(browning, 'M3A1Entry', [-0.5, -1.12, -0.67], 'browning', 3.5);
for (const id of ['passenger2', 'passenger3', 'passenger4', 'passenger5']) {
  door(node(complex, `M3A1_Passanger_PCO${id.slice(-1)}`), 'M3A1Entry3', [0, 0, -2.599], id, 2.6);
}
node(complex, 'M3A1Wheel1', [-0.449, 0.15, 3]);
node(complex, 'M3A1Wheel1', [0.45, 0.15, 3]);
m3a1.updateMatrixWorld(true);

// A gun with nothing but a door at its origin, 3.5 m wide (a `Defgun`'s
// radius), and the same gun with a 0.5 m mesh: the grid's side of the reach.
function gun(name, x, meshRadius) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = { templateKind: 'PlayerControlObject', control: name };
  root.position.set(x, 0, 0);
  if (meshRadius) root.add(new THREE.Mesh(new THREE.SphereGeometry(meshRadius, 8, 6)));
  const entry = node(root, `${name}Entry`);
  root.updateMatrixWorld(true);
  return { node: entry, vehicle: root, control: name, seatId: null, radius: 3.5 };
}

const held = new Set();
const page = {
  occupancy: null,
  soldier: { x: 0, y: 0, z: 0 },
  collider: null,
  world: null,
  seatHolder: (vehicle, seatId) => (held.has(seatId) ? 'someone' : null),
  mayEnterHull: () => true,
};
const entry = createVehicleEntry(page);
// `soldier` is his feet; the finder measures from his origin, a metre up.
const offered = (x, feet, z) => {
  Object.assign(page.soldier, { x, y: feet, z });
  const pick = entry.nearestEntry();
  return pick ? pick.seatId ?? pick.vehicle.name : null;
};
const world = n => { const v = n.getWorldPosition(new THREE.Vector3()); return [v.x, v.y, v.z].map(c => +c.toFixed(3)); };

const out = {};
out.m3a1Radius = +boundingRadius(m3a1).toFixed(4);
out.rearDoor = world(doors[4].node);
out.centreDoor = world(doors[1].node);
entry.entryPoints = doors;
// Where the page stood and pressed six times without a seat (0.66 m off the
// rear door, 3.27 m off the hull's origin across the ground and 3.50 m from
// his origin): the hull is in the 3 m query (its sphere is 3.31 m here, the
// Browning's doors setting it, and more with the hull's mesh) and the rear
// door is 1.4 m off his origin, inside its 2.6. The finder gives the first
// passenger's seat there; the refusal was not the finder's.
out.atRearDoor = offered(1020.2, 105.9, 858.6);
out.rearHullDistance = +Math.hypot(1020.2 - 1017.31, 106.9 - 105.63, 858.6 - 857.08).toFixed(3);
// Where it seated at once: 1.8 m off the hull's origin, the centre door.
out.atCentre = offered(1015.9, 105.9, 858.2);
// The four passenger seats taken: the rear door has no seat to give, and the
// centre door is 3.46 m off his origin there (his origin 1.14 m over it),
// inside its 3.5: the driver's seat.
for (const id of ['passenger2', 'passenger3', 'passenger4', 'passenger5']) held.add(id);
out.rearAllTaken = offered(1020.2, 105.9, 858.6);
held.clear();
// Further back, out of the rear door's 2.6 m and the centre door's 3.5:
// nothing.
out.behindOut = offered(1021.9, 105.9, 859.6);

// The grid's own refusal: a door 3.2 m off, inside its 3.5 m radius, of a hull
// whose sphere is the door's point: 3.2 is not under 3 + 0. Give the gun a
// 0.5 m mesh and 3.2 is under 3.5.
const bare = gun('BareGun', 3.2, 0);
const meshed = gun('MeshedGun', 3.2, 0.5);
entry.entryPoints = [bare];
out.bareGun = offered(0, -1, 0);
out.bareRadius = boundingRadius(bare.vehicle);
entry.entryPoints = [meshed];
out.meshedGun = offered(0, -1, 0);
out.meshedRadius = +boundingRadius(meshed.vehicle).toFixed(3);
// Inside 3 m the grid always holds the hull: the door's radius decides.
bare.vehicle.position.set(2.9, 0, 0);
bare.vehicle.updateMatrixWorld(true);
entry.entryPoints = [bare];
out.bareGunNear = offered(0, -1, 0);
process.stdout.write(JSON.stringify(out));
