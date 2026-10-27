// FH's mobile guns' killer charge (FHX-30): an invisible round dropped at
// 1 m/s that bursts at the end of its 2.95 s clock. Its `.con` says
// `setHasMobilePhysics 0` and `setHasCollisionPhysics 0`: it stays where it
// was dropped and nothing beside it ends it early. A wall 1.5 m in front of
// the gun is what stood beside the 85mm AA gun on pakfront. Copied beside the
// viewer modules by `test_killer_charge.py`.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { buildCollisionIndex } from './static-index.js';
import { WorldCollider } from './world-collider.js';

function killerRig(flags) {
  const weapon = new THREE.Group();
  weapon.name = 'TransformKillerGunBarrel';
  weapon.userData.fireArms = {
    roundOfFire: 1, velocity: 1, muzzles: 1, magSize: 1, numOfMag: -1, input: 'c_PIAltFire',
    projectile: {
      kind: 'bullet', template: 'TransformKilleProjectile', timeToLive: 2.95, gravity: 0,
      material: 70, stopAtEndEffect: true, ...flags,
      damage: { radius: 6, material2: 613, damageType: 1, hasCollisionEffect: false,
                dieAfterColl: true, hasOnTimeEffect: true },
    },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  weapon.add(muzzle);
  return weapon;
}

function drop(flags) {
  const scene = new THREE.Scene();
  const wall = new THREE.Group();
  wall.name = 'Wall';
  const box = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.5), new THREE.MeshBasicMaterial());
  box.userData.collision = true;
  box.geometry.userData.defenseMaterial = 60;
  wall.add(box);
  wall.position.set(0, 0, -1.5);
  wall.updateMatrixWorld(true);
  scene.add(wall);
  const statics = buildCollisionIndex(scene, { ownerRoots: [wall] });
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(), viewportHeight: () => 900 });
  guns.collider = new WorldCollider({ statics });
  guns.rand = () => 0.5;
  const group = guns.collect(killerRig(flags), {
    replace: true, speedScale: 1, roundLifetime: 'data', maxRange: 1500,
    aimRay: () => ({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } }),
  })[0];
  guns.setFiring(group, true);
  guns.advance(1 / 30);
  guns.setFiring(group, false);
  for (let i = 0; i < 120; i++) guns.advance(1 / 30);
  return guns.hits.map(h => ({ kind: h.kind, blast: h.blast ?? null, splashRadius: h.splashRadius ?? null,
                               point: h.point.map(v => Math.round(v * 100) / 100) }));
}

console.log(JSON.stringify({
  declared: drop({ hasMobilePhysics: false, hasCollisionPhysics: false }),
  undeclared: drop({}),
}));
