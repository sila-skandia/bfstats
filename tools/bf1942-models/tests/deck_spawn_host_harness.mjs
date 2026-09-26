// A deck spawn rides the ship it was authored on, not the landing craft
// beside it.
//
// Midway's Fletcher, as the level places her: pad at y 20.437, yaw -127.767,
// eight float nodes (hullHeight 20, 7.5 m up, lift 2), her driver spawn at
// 0/5/32.5 and her fantail spawns at +/-3/5/-43.699. Her stern spawner
// launches an LCVP at 7.2/0.3/-43.699 (hullHeight 2.8, 3.1 m up, lift 6),
// detached as a vehicle of its own and carrying `heldSpawner`. Both float to
// their own draft - the Fletcher 0.21 m down, the LCVP 2.18 m - and the
// fantail spawns, 4 m from the LCVP's origin and 44 m from the Fletcher's,
// have to come down with the Fletcher.

import * as THREE from 'three';
import { createHullBodies } from './hull-bodies.js';

const WATER = 20;
const PAD = [3173.63, 20.437, -2259.6];
const YAW = -127.767;

function hull(name, extra, pad, floats) {
  const node = new THREE.Group();
  node.name = name;
  node.userData = { control: name, templateKind: 'PlayerControlObject',
                    physics: { vehicleCategory: 'VCSea', mass: 1 }, ...extra };
  node.position.fromArray(pad);
  node.rotation.y = -YAW * Math.PI / 180;
  for (const [x, z] of [[-4, -40], [4, -40], [-4, -15], [4, -15],
                        [-4, 15], [4, 15], [-4, 40], [4, 40]].slice(0, floats.count)) {
    const f = new THREE.Group();
    f.userData = { templateKind: 'FloatingBundle',
                   physics: { hullHeight: floats.hullHeight,
                              floatMinLift: floats.lift, floatMaxLift: floats.lift } };
    f.position.set(x * floats.scale, floats.relY, z * floats.scale);
    node.add(f);
  }
  return node;
}

/** A con-frame ship-local point through the pad's pose (`localToWorld(lx, ly, -lz)`). */
function onPad(node, [lx, ly, lz]) {
  node.updateMatrixWorld(true);
  return node.localToWorld(new THREE.Vector3(lx, ly, -lz)).toArray();
}

const root = new THREE.Group();
const fletcher = hull('Fletcher', {}, PAD, { count: 8, hullHeight: 20, lift: 2, relY: 7.5, scale: 1 });
root.add(fletcher);
const lcvpPad = onPad(fletcher, [7.2, 0.3, -43.699]);
const lcvp = hull('Lcvp', { heldSpawner: { spawner: 'FletcherLcvpSpawner', vehicle: 'Lcvp' } },
                  lcvpPad, { count: 4, hullHeight: 2.8, lift: 6, relY: 3.1, scale: 0.05 });
root.add(lcvp);
root.updateMatrixWorld(true);

const spawn = (name, local, vehicle = 'fletcher') =>
  ({ vehicle, name, position: onPad(fletcher, local) });
const spawns = [
  spawn('bow', [0, 5, 32.5]),
  spawn('sternPort', [3, 5, -43.699]),
  spawn('sternStarboard', [-3, 5, -43.699]),
  // A spawn whose vehicle names no hull: placed by position, and still never
  // on the launched craft it stands nearest.
  spawn('unnamed', [3, 5, -43.699], 'nosuchship'),
];
const page = { extras: { vehicleSoldierSpawns: spawns, waterLevel: WATER } };
const hb = createHullBodies(page);
const before = spawns.map(s => s.position.slice());
fletcher.updateMatrixWorld(true);
const fletcherBefore = fletcher.position.y, lcvpBefore = lcvp.position.y;
hb.floatPlacedVehicles([fletcher, lcvp], WATER);
hb.rebaseDeckSpawns();

const out = {
  fletcherDrop: fletcher.position.y - fletcherBefore,
  lcvpDrop: lcvp.position.y - lcvpBefore,
  spawnDrop: Object.fromEntries(spawns.map((s, i) => [s.name, s.position[1] - before[i][1]])),
  spawnSlide: Object.fromEntries(spawns.map((s, i) => [s.name,
    Math.hypot(s.position[0] - before[i][0], s.position[2] - before[i][2])])),
};
console.log(JSON.stringify(out));
