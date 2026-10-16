// An `isSticky` round against an object and against the ground, through
// `gunfire.js` under node, and one JSON blob.
//
// `Projectile::handleCollision` (lnxded 0x0831ee80, the test at 0x0831ef16):
// a sticky round that strikes an OBJECT becomes its child at the contact and
// stays there, its fuse running on; a terrain contact is the ordinary one.
// The world is a floor at y = 0 (terrain, no owner) and a wall of owner 0 at
// z = -3.1, whose node stands for a tank that then drives off and turns.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir(process.argv[2] ?? null);
installModuleHooks(viewer);
const THREE = await import('three');
const { GunFire } = await import(pathToFileURL(path.join(viewer, 'gunfire.js')).href);

const MATERIALS = { 0: { friction: 1.0, elasticity: 0, resistance: 0.02 }, 814: { friction: 1.0 } };

function world(wallNode) {
  return {
    heightfield: { height: () => 0 },
    statics: { ownerNodes: [wallNode], ownerOf: () => -1 },
    cast(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = null;
      if (dy < 0) {
        const t = oy / -dy;
        if (t >= 0 && t <= maxDist) {
          best = { t, x: ox + dx * t, y: 0, z: oz + dz * t, nx: 0, ny: 1, nz: 0,
                   material: 0, kind: 'terrain', owner: -1 };
        }
      }
      if (wallNode && dz < 0 && oz > -3.1) {
        const t = (oz + 3.1) / -dz;
        const y = oy + dy * t;
        if (t >= 0 && t <= maxDist && (!best || t < best.t) && y > 0 && y < 3) {
          best = { t, x: ox + dx * t, y, z: -3.1, nx: 0, ny: 0, nz: 1,
                   material: 0, kind: 'static', owner: 0 };
        }
      }
      return best;
    },
  };
}

function rig(sticky) {
  const weapon = new THREE.Group();
  weapon.name = 'stickysocks';
  const damage = { radius: 12, material2: 604, damageType: 1, hasCollisionEffect: false,
                   dieAfterColl: false, hasOnTimeEffect: true };
  if (sticky) damage.isSticky = true;
  weapon.userData.fireArms = {
    roundOfFire: 1, fireOnce: true, velocity: 10, muzzles: 1, magSize: 1, numOfMag: 1,
    projectile: { kind: 'shell', template: 'stickysocksProjectile', timeToLive: 5,
                  gravity: 0.85, material: 814, hasPointPhysics: false, damage },
  };
  const muzzle = new THREE.Object3D();
  muzzle.userData.muzzle = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), new THREE.MeshBasicMaterial());
  body.name = 'stickysocks projectile';
  body.userData.projectileMesh = true;
  weapon.add(muzzle, body);
  return weapon;
}

const round = v => Math.round(v * 1000) / 1000;
const vec = p => [round(p.x), round(p.y), round(p.z)];

function throwAt({ sticky, wall = true }) {
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera(), viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  const tank = new THREE.Object3D();
  scene.add(tank);
  guns.collider = world(wall ? tank : null);
  guns.materials = MATERIALS;
  const group = guns.collect(rig(sticky), {
    replace: true, speedScale: 1, roundLifetime: 'data',
    aimRay: () => ({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } }),
  })[0];
  guns.setFiring(group, true);
  guns.advance(1 / 30);
  guns.setFiring(group, false);
  const shot = guns.projectiles[0];
  for (let i = 0; i < 60; i++) guns.advance(1 / 30);
  const out = { stuck: !!shot.stuck, bodyStuck: !!shot.body?.stuck, resting: !!shot.resting,
                at: vec(shot.mesh.position), contacts: shot.body?.contacts ?? 0 };
  // The tank drives 5 m along x and turns a quarter about y.
  tank.position.set(5, 0, 0);
  tank.rotation.y = Math.PI / 2;
  tank.updateMatrixWorld(true);
  guns.advance(1 / 30);
  out.afterMove = vec(shot.mesh.position);
  const q = new THREE.Quaternion();
  tank.getWorldQuaternion(q);
  out.wearsTankRotation = round(Math.abs(q.dot(shot.mesh.quaternion)));
  // The fuse runs on: 5 s, then the blast and the round gone.
  for (let i = 0; i < 150 && guns.projectiles.length; i++) guns.advance(1 / 30);
  out.blasted = guns.hits.length;
  out.leftInFlight = guns.projectiles.length;
  return out;
}

console.log(JSON.stringify({
  sticky: throwAt({ sticky: true }),
  plain: throwAt({ sticky: false }),
  stickyOnGround: throwAt({ sticky: true, wall: false }),
}));
