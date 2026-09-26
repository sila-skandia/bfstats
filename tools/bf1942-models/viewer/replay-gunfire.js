// A ray cast against the replayed hulls, so a round the page fires (a
// replayed shot through the page's own guns) stops on a replayed tank the
// way it stops on a level one: the impact effect on its hull, never a hit
// point billed (map.html skips the replay's rounds in `guns.onImpact`).

import * as THREE from 'three';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const raycaster = new THREE.Raycaster();

export function dynamicCast(player, ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
  if (!player.hulls?.size) return null;
  raycaster.set(_origin.set(ox, oy, oz), _dir.set(dx, dy, dz).normalize());
  raycaster.near = 0.01;
  raycaster.far = maxDist;
  let best = null;
  let bestDist = maxDist;
  for (const hull of player.hulls.values()) {
    if (!hull.group.visible || hull.ghost) continue;
    if (skipOwner === hull.ownerTag) continue;
    const target = hull.wreck?.visible ? hull.wreck : hull.scene;
    const hits = raycaster.intersectObject(target, true);
    const hit = hits.find(h => h.object.visible !== false);
    if (!hit || hit.distance >= bestDist) continue;
    bestDist = hit.distance;
    let nx = 0, ny = 1, nz = 0;
    if (hit.face) {
      _normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      const n = hit.face.normal.clone().applyNormalMatrix(_normalMatrix).normalize();
      nx = n.x; ny = n.y; nz = n.z;
    }
    best = {
      t: hit.distance, x: hit.point.x, y: hit.point.y, z: hit.point.z,
      nx, ny, nz,
      // 61: the armour the level's own hulls carry; the impact effect is
      // the steel one.
      material: 61, owner: hull.ownerTag, kind: 'object',
    };
  }
  return best;
}
