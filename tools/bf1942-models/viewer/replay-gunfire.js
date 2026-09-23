// Recorded shots through the page's gun system (ctx.guns): a fire event
// replayed from its soldier's gun group, and the ray cast that lets the
// page's rounds hit replayed vehicles.

import * as THREE from 'three';

export function dynamicCast(player, ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
  if (!player.entities.length) return null;
  const rayOrigin = new THREE.Vector3(ox, oy, oz);
  const rayDir = new THREE.Vector3(dx, dy, dz).normalize();
  const raycaster = new THREE.Raycaster(rayOrigin, rayDir, 0.01, maxDist);
  let bestHit = null;
  let bestDist = maxDist;

  for (const entity of player.entities) {
    if (!entity.group.visible || entity.life.soldier) continue;
    if (skipOwner >= 0 && entity.life.nid === skipOwner) continue;
    const targetObj = (entity.wreck && entity.wreck.visible) ? entity.wreck : entity.normal;
    if (!targetObj) continue;

    const hits = raycaster.intersectObject(targetObj, true);
    if (hits.length > 0 && hits[0].distance < bestDist) {
      const hit = hits[0];
      bestDist = hit.distance;
      let nx = 0, ny = 1, nz = 0;
      if (hit.face) {
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        const worldNorm = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
        nx = worldNorm.x; ny = worldNorm.y; nz = worldNorm.z;
      }
      bestHit = {
        t: hit.distance,
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z,
        nx, ny, nz,
        material: 61,
        owner: entity.life.nid,
        kind: 'object',
      };
    }
  }
  return bestHit;
}

export function triggerGunFire(player, f) {
  if (!player.ctx.guns) return;
  const entity = player.entities.find(e => e.life.soldier && (f.pid !== undefined ? e.life.pid === f.pid : true)) || player.entities.find(e => e.life.soldier);
  if (!entity?.gunGroup) return;

  const dirVec = f.dir ? new THREE.Vector3(f.dir[0], f.dir[1], -f.dir[2]).normalize() : new THREE.Vector3(0, 0, -1);
  const startPos = new THREE.Vector3(f.pos[0], f.pos[1] + 1.35, -f.pos[2]).addScaledVector(dirVec, 0.7);

  entity.gunGroup.aimRay = () => ({ origin: startPos, dir: dirVec });
  player.ctx.guns.fireShot(entity.gunGroup);

  if (player.ctx.fetchHandFireSound && player.ctx.playHandFire && f.weapon) {
    player.ctx.fetchHandFireSound(f.weapon).then(fire => {
      if (fire) player.ctx.playHandFire(fire);
    }).catch(() => {});
  }
}
