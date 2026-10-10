// The rounds a rack carries in view (`loaded-rounds.js`), on a rig shaped
// like the exporter's AV-8A: a FireArms node with four muzzles and one hidden
// baked `projectile` body whose template is the rack's
// `visibleDummyProjectileTemplate`. Beside it a Stuka-shaped rack whose body
// is the projectile's own geometry, which draws nothing on the hull.
//
// Three roads: the parked hull at level load (`restoreLoadedRounds`), a seat
// firing through `GunFire` with a `FireState` behind `roundsLeft`, and a
// respawn after the magazine is spent.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { FireState } from './seats.js';
import { idleFirePose } from './idle-vehicle.js';
import {
  drawsLoadedRounds, loadedRoundsOf, mountLoadedRounds, restoreLoadedRounds, syncLoadedRounds,
} from './loaded-rounds.js';

/** A rack as `assemble.py` bakes one: muzzles, then the hidden body. */
function rack(name, { round, body, muzzles, magSize, numOfMag, pitchDeg = 0 }) {
  const gun = new THREE.Group();
  gun.name = name;
  gun.userData.fireArms = {
    roundOfFire: 2, velocity: 500, magSize, numOfMag, reloadTime: 5,
    asynchronyFire: true,
    projectile: { kind: 'rocket', template: round, timeToLive: 20, gravity: 0,
                  material: 710, damage: { hasCollisionEffect: true, explosionDamage: 0 } },
  };
  for (let i = 0; i < muzzles; i++) {
    const muzzle = new THREE.Object3D();
    muzzle.name = `${name} muzzle ${i + 1}`;
    muzzle.userData.muzzle = { index: i };
    // `addFireArmsPosition <pos> <ypr>`: the AV-8A's outer rails toe in 1.6°.
    muzzle.position.set(i % 2 ? 4.233 : -4.233, -0.577, -1.375);
    muzzle.rotation.y = (i % 2 ? -1 : 1) * 1.593 * Math.PI / 180;
    // A bomb rack's `addFireArmsPosition 0/35/0`: the release direction.
    if (pitchDeg) { muzzle.rotation.set(-pitchDeg * Math.PI / 180, 0, 0); }
    gun.add(muzzle);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 2.9), new THREE.MeshBasicMaterial());
  mesh.name = `${name} projectile`;
  mesh.userData.projectileMesh = { template: body, geometry: 'Rocket_Aim9' };
  // The body's own baked rotation, which the round keeps inside its aimed
  // container (`spawnProjectile`) and a loaded round must keep on the pylon.
  mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  mesh.visible = false;
  gun.add(mesh);
  return gun;
}

function harrier() {
  const hull = new THREE.Group();
  hull.name = 'AV-8A';
  const aim9 = rack('AV8AAim9Rack', { round: 'Aim9', body: 'Aim9Dummy', muzzles: 4, magSize: 4, numOfMag: 2 });
  hull.add(aim9);
  return { hull, aim9 };
}

/** The F-14B's Mk 83 rack: four muzzles aimed 35 degrees down, on a hull
 * that is itself yawed and pitched so a local-frame mistake cannot pass. */
function tomcat() {
  const hull = new THREE.Group();
  hull.name = 'F-14B';
  hull.rotation.set(0.1, 0.7, -0.05);
  const bombs = rack('F14BMk83Rack', { round: 'MK83', body: 'MK83Dummy', muzzles: 4, magSize: 4, numOfMag: 1, pitchDeg: 35 });
  hull.add(bombs);
  return { hull, bombs };
}

function stuka() {
  const hull = new THREE.Group();
  hull.name = 'Stuka';
  const bombs = rack('StukaBombRack', { round: 'DiveBomberBomb', body: 'DiveBomberBomb', muzzles: 2, magSize: 2, numOfMag: 1 });
  hull.add(bombs);
  return { hull, bombs };
}

const shown = gun => loadedRoundsOf(gun).map(r => r.visible);
const out = {};

// --- the parked hull at level load -----------------------------------------
{
  const { hull, aim9 } = harrier();
  const { hull: plane, bombs } = stuka();
  out.drawsAim9 = drawsLoadedRounds(aim9);
  out.drawsStuka = drawsLoadedRounds(bombs);
  out.beforeMount = loadedRoundsOf(aim9).length;
  const level = new THREE.Group();
  level.add(hull, plane);
  out.restored = restoreLoadedRounds(level);
  out.afterMount = shown(aim9);
  out.stukaRounds = loadedRoundsOf(bombs).length;
  // Each round sits on its muzzle, at the muzzle's origin, with the body's own
  // rotation on top of the muzzle's aim.
  const rounds = loadedRoundsOf(aim9);
  out.parents = rounds.map(r => r.parent.name);
  out.localPositions = rounds.map(r => r.position.toArray());
  const first = rounds[0];
  const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  // World-frame check against the rack: the 1.6 degree toe-in is the
  // muzzle's aim, not the dummy's, so every round shows the body's rotation
  // relative to the rack and nothing else.
  level.updateMatrixWorld(true);
  const rackQ = aim9.getWorldQuaternion(new THREE.Quaternion());
  const rel = r => rackQ.clone().invert().multiply(r.getWorldQuaternion(new THREE.Quaternion()));
  out.keepsBodyRotation = rounds.every(r => Math.abs(rel(r).dot(expected)) > 0.999999);
  out.names = rounds.map(r => r.name);
  // Not a firing payload: the idle sweep leaves the pylons alone.
  idleFirePose(level);
  out.afterIdleSweep = shown(aim9);
  // Mounting again adds nothing.
  out.mountTwice = mountLoadedRounds(aim9).length;
  out.childrenPerMuzzle = aim9.children.filter(c => c.userData.muzzle).map(m => m.children.length);
}

// --- a rotated muzzle: the dummy hangs level --------------------------------
{
  const { hull, bombs } = tomcat();
  mountLoadedRounds(bombs);
  hull.updateMatrixWorld(true);
  const rounds = loadedRoundsOf(bombs);
  const rackQ = bombs.getWorldQuaternion(new THREE.Quaternion());
  const body = bombs.children.find(c => c.userData.projectileMesh);
  const bodyQ = body.quaternion.clone();
  // Each round's rotation relative to the rack, against the body's own baked one.
  out.mk83RelativeAngles = rounds.map(r => {
    const rel = rackQ.clone().invert().multiply(r.getWorldQuaternion(new THREE.Quaternion()));
    return rel.angleTo(bodyQ);
  });
  out.mk83Parents = rounds.map(r => r.parent.name);
  out.mk83MuzzleAim = bombs.children.filter(c => c.userData.muzzle).map(m => m.rotation.x * 180 / Math.PI);
  // The muzzle keeps its aim for the fired round.
  const muzzle = rounds[0].parent;
  out.mk83FireDirTilt = new THREE.Vector3(0, 0, -1).applyQuaternion(muzzle.quaternion).angleTo(new THREE.Vector3(0, 0, -1)) * 180 / Math.PI;
  // The round sits on the muzzle's position.
  out.mk83WorldAtMuzzle = rounds.every(r =>
    r.getWorldPosition(new THREE.Vector3()).distanceTo(r.parent.getWorldPosition(new THREE.Vector3())) < 1e-9);
}

// --- the magazine, by hand ---------------------------------------------------
{
  const { aim9 } = harrier();
  mountLoadedRounds(aim9);
  out.sync = {};
  for (const left of [4, 3, 2, 1, 0]) {
    syncLoadedRounds(aim9, left);
    out.sync[left] = shown(aim9);
  }
  syncLoadedRounds(aim9, Infinity);
  out.syncUnlimited = shown(aim9);
}

// --- a seat firing through GunFire -----------------------------------------
{
  const { hull, aim9 } = harrier();
  const scene = new THREE.Scene();
  scene.add(hull);
  const camera = new THREE.PerspectiveCamera();
  const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
  guns.rand = () => 0.5;
  const states = new WeakMap();
  states.set(aim9, new FireState(aim9.userData.fireArms));
  guns.roundsLeft = group => states.get(group.node)?.ammo ?? Infinity;
  guns.onShot = (group, rounds) => states.get(group.node)?.registerShot?.(rounds);
  const [group] = guns.collect(hull, { replace: true, speedScale: 1, roundLifetime: 'data' });
  out.groupLoadedRounds = group.loadedRounds;
  out.afterCollect = shown(aim9);
  const fired = [];
  guns.setFiring(group, true);
  // One round every 0.5 s: four frames a quarter second apart carry two rounds.
  for (let i = 0; i < 4; i++) {
    guns.advance(0.25);
    states.get(aim9).step(0.25);
    fired.push({ shots: group.shots, ammo: states.get(aim9).ammo, shown: shown(aim9) });
  }
  guns.setFiring(group, false);
  out.fired = fired;
  // Empty the rack and let the reload run: the pylons come back full.
  guns.setFiring(group, true);
  for (let i = 0; i < 8; i++) { guns.advance(0.25); states.get(aim9).step(0.25); }
  guns.setFiring(group, false);
  out.spent = { shots: group.shots, ammo: states.get(aim9).ammo, shown: shown(aim9) };
  for (let i = 0; i < 24; i++) { states.get(aim9).step(0.25); guns.advance(0.25); }
  out.reloaded = { ammo: states.get(aim9).ammo, shown: shown(aim9) };
  // The respawn road: the fresh object's magazines are new.
  syncLoadedRounds(aim9, 0);
  out.respawnBefore = shown(aim9);
  restoreLoadedRounds(hull);
  out.respawnAfter = shown(aim9);
}

console.log(JSON.stringify(out));
