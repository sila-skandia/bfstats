// `viewer/vehicle-entry.js`: a wreck has no door (ledger SEAT-28). Neither the
// E key's scan nor a caller that names a seat takes one: FHSWEurope 203 Hill's
// Stationary_Vickers, destroyed by the 155 mm battery uphill of it, was manned
// through a named seat and then neither aimed nor fired (HP-15).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { createVehicleEntry } = await import(pathToFileURL(path.join(viewer, 'vehicle-entry.js')).href);

function hull(name, x) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = { templateKind: 'PlayerControlObject', control: name };
  root.position.set(x, 0, 0);
  const door = new THREE.Group();
  door.name = `${name}Entry`;
  root.add(door);
  root.updateMatrixWorld(true);
  return { root, door };
}

const vickers = hull('Stationary_Vickers', 1);       // the wreck, nearer
const spare = hull('Stationary_Vickers_1', 3);       // a standing one
const owners = new Map([[vickers.root, 646], [spare.root, 647]]);
const destroyed = new Set([646]);
const seated = [];
const page = {
  occupancy: null,
  soldier: { x: 0, y: -1, z: 0 },
  collider: { statics: { ownerOf: node => owners.get(node) ?? -1 } },
  world: { vehicleDamage: { get: owner => ({ destroyed: destroyed.has(owner) }) } },
  seatHolder: () => null,
  mayEnterHull: () => true,
  holster() {}, releaseButtons() {}, useLens() {}, markPilot() {}, drawWeapon() {}, resetMobileControls() {},
  setPilot(on, node, seatId) {
    seated.push(node.name);
    page.occupancy = { root: node, seatId };
  },
};
const entry = createVehicleEntry(page);
entry.entryPoints = [
  { node: vickers.door, vehicle: vickers.root, control: 'Stationary_Vickers', seatId: null, radius: 5 },
  { node: spare.door, vehicle: spare.root, control: 'Stationary_Vickers', seatId: null, radius: 5 },
];

const out = {};
out.offered = entry.nearestEntry()?.vehicle.name ?? null;
entry.enterVehicle({ vehicle: vickers.root, seatId: null });
out.wreckSeated = page.occupancy?.root.name ?? null;
entry.enterVehicle({ vehicle: spare.root, seatId: null });
out.standingSeated = page.occupancy?.root.name ?? null;
// Aboard a hull that then burns: a seat of the same hull is not an entry.
destroyed.add(647);
entry.enterVehicle({ vehicle: spare.root, seatId: 'gunner' });
out.switchAboardWreck = page.occupancy?.seatId ?? null;
out.isWreck = [entry.isWreck(vickers.root), entry.isWreck(spare.root)];
out.setPilotCalls = seated;
process.stdout.write(JSON.stringify(out));
