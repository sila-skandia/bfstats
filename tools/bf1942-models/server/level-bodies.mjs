// The body-world glue `map.html` owns, mirrored for the room server: the
// ground the body modules ask of the heightfield, a node's pose as position +
// row axes and back, which placed nodes become bodies, and the settle pass
// that drops placed hulls onto their springs before the collision index bakes
// them. Split out of `level.mjs` (which re-exports `SETTLE_TICKS`).

import * as THREE from 'three';

import { BodyWorld } from '../viewer/body-world.js';
import {
  buildParkedVehicle, describeVehicleParts,
} from '../viewer/vehicle-bodies.js';
// The body world's ground and a node's pose as `position` + row `axes`: the
// page's own two functions (`hull-bodies.js` imports the same module), which
// this file used to carry as copies named `bodyTerrainOf`/`bodyPoseOf`.
import { bodyPoseOf, bodyTerrain as bodyTerrainOf } from '../viewer/body-pose.js';

export { bodyPoseOf, bodyTerrainOf };

/** Longest a spawned vehicle is given to come to rest (map.html: 300). */
export const SETTLE_TICKS = 300;

/** The quaternion's basis as the body modules' row `axes` (the inverse of
 *  `quaternionFromAxes`: the matrix rows are the axes, mirroring `bodyPoseOf`). */
export function quaternionToAxes(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m.elements;
  return [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]];
}

/** A body position/axes pose written back onto a scene node (map.html
 *  `writeBodyPose`: the world matrix composed from the axes rows, then
 *  decomposed into the node's local transform). */
function writeBodyPose(node, body) {
  const a = body.axes, p = body.pos;
  const m = new THREE.Matrix4().set(
    a[0][0], a[1][0], a[2][0], p[0],
    a[0][1], a[1][1], a[2][1], p[1],
    a[0][2], a[1][2], a[2][2], p[2],
    0, 0, 0, 1);
  if (node.parent) {
    const parentInv = node.parent.matrixWorld.clone().invert();
    m.premultiply(parentInv);
  }
  m.decompose(node.position, node.quaternion, new THREE.Vector3());
  node.updateMatrix();
  node.updateMatrixWorld(true);
}

/** Ships stay scenery (map.html `bodySpecFor`: a hull afloat is a
 *  FloatingBundle's work, and nothing here models one). */
export function bodySpecFor(node, data) {
  if (node?.userData?.physics?.vehicleCategory === 'VCSea') return null;
  return describeVehicleParts(node, data.collisionMeshes);
}

export function settle(root, ownerRoots, heightfield, waterLevel, data) {
  const world = new BodyWorld({
    tables: data.damageTables,
    terrain: bodyTerrainOf(heightfield, waterLevel),
  });
  const settling = [];
  ownerRoots.forEach((node, index) => {
    const spec = node?.userData?.armor ? bodySpecFor(node, data) : null;
    if (!spec) return;
    const parked = buildParkedVehicle(spec, { ...bodyPoseOf(node), asleep: false });
    world.addParked(index, parked, spec);
    settling.push({ node, body: parked.body });
  });
  for (let tick = 0; tick < SETTLE_TICKS; tick++) {
    world.tick();
    if (tick > 30 && settling.every(s => s.body.sleeping)) break;
  }
  for (const { node, body } of settling) writeBodyPose(node, body);
}
