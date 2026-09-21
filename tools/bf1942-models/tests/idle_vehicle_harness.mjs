// An unoccupied vehicle is idle, by all three roads into that state.
//
// The defect this pins: a gun's firing state lives on scene nodes that outlive
// every object driving them. `GunFire.advance` strobes a muzzle flash on a shot
// and hides it again at its `timeToLive`, and walks a recoiling barrel back to
// `userData.home` -- but only while the group is still in `guns.groups`. A seat
// exit splices it out, so both are frozen wherever the exit caught them.
//
//   1. exit while the trigger is down       -> `GunFire.release`
//   2. wreck, then respawn on the pad       -> `idleFirePose` + `idleFireState`
//   3. a vehicle placed at level load       -> `idleFirePose`
//
// The rig is the real shape an assembled vehicle has: a FireArms node with a
// muzzle, a baked flash emitter under that muzzle, and a tracer streak template
// parked on the barrel.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';
import { FireState } from './seats.js';
import { idleFirePose, idleFireState } from './idle-vehicle.js';

/** A tank: a hull with one gun on it, armed the way the exporter arms one. */
function tank() {
  const hull = new THREE.Group();
  hull.name = 'Sherman';
  const gun = new THREE.Group();
  gun.name = 'ShermanGunBarrel';
  gun.position.set(0, 1, -0.5);
  gun.userData.fireArms = {
    roundOfFire: 2, velocity: 400, muzzles: 1,
    magSize: 4, numOfMag: 3, reloadTime: 2,
    heatAddWhenFire: 0.5, coolDownPerSec: 0.1, timeDelayOnOverheat: 3,
    // `recoil.size / recoil.speed` = 0.3 s of recovery: a wide enough window
    // that an exit can land inside it, which is the whole point.
    recoil: { size: 3, speed: 10 },
    tracer: { interval: 1 },
    projectile: { kind: 'shell', template: 'ShermanShell', timeToLive: 3, gravity: 1,
                  material: 70, damage: { hasCollisionEffect: true, explosionDamage: 0 } },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  const flash = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2),
                               new THREE.MeshBasicMaterial());
  flash.name = 'e_MuzzPanz';
  // A long enough life that a 1/60 s advance cannot retire it on its own: the
  // question is whether the exit puts it out, not whether it timed out.
  flash.userData.effect = { kind: 'emitter', timeToLive: 5, size: 1 };
  muzzle.add(flash);
  const streak = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 1),
                                new THREE.MeshBasicMaterial());
  streak.name = 'ShermanGunBarrel_tracer';
  streak.userData.tracerMesh = true;
  gun.add(muzzle, streak);
  hull.add(gun);
  return { hull, gun, flash, streak };
}

function lit(root) {
  const out = [];
  root.traverse(node => {
    const data = node.userData || {};
    if (!node.visible) return;
    if (data.effect || data.tracerMesh || data.projectileMesh || data.projectileTrail) {
      out.push(node.name);
    }
  });
  return out;
}

function offHome(gun) {
  const home = gun.userData.home;
  if (!home) return null;
  return Number(gun.position.distanceTo(home).toFixed(5));
}

const out = {};
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();

// --- 3. a vehicle placed at level load ------------------------------------
//
// Nothing has collected it, so nothing has hidden its baked payloads. This is
// map.html's load sweep, which used to name `effect`, `projectileMesh` and
// `projectileTrail` and leave the streak template drawing on every gun in the
// level that nobody had touched yet.
{
  const { hull, streak } = tank();
  out.loadBefore = lit(hull);
  out.loadStreakBefore = streak.visible;
  idleFirePose(hull);
  out.loadAfter = lit(hull);
}

// --- 1. exit while the trigger is down ------------------------------------
const { hull, gun, flash } = tank();
scene.add(hull);
const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
guns.rand = () => 0.5;
const found = guns.collect(hull, { replace: true, speedScale: 1, roundLifetime: 'data' });
out.collected = found.length;
const group = found[0];
// `collect` hides the baked payloads, which is why entering a vehicle has
// always made the parked streak go away.
out.afterCollect = lit(hull);

guns.setFiring(group, true);
// Two frames: `advance` walks the recoil before it fires the round, so the
// first frame's shot only arms the kick and the second is where the barrel
// first stands away from home. `roundOfFire 2` is one round every 0.5 s, so
// the second frame does not fire again.
guns.advance(1 / 60);
guns.advance(1 / 60);
out.firingLit = lit(hull);
out.firingOffHome = offHome(gun);
out.firingShots = group.shots;

// The exit, one frame into the recoil recovery and with the flash still well
// inside its own life.
guns.release(group);
out.releasedFromIndex = guns.groups.indexOf(group) < 0;
out.exitLit = lit(hull);
out.exitOffHome = offHome(gun);
// And it stays idle: nothing is stepping this gun any more, so if the exit did
// not put it out nothing ever will.
guns.advance(1);
guns.advance(1);
out.exitLitLater = lit(hull);
out.exitOffHomeLater = offHome(gun);
// Idempotent -- `releaseGuns()` can run twice over the same list (leaveManned
// delegating to leaveVehicle).
guns.release(group);
out.doubleReleaseLit = lit(hull);

// --- 2. wreck, then respawn on the pad ------------------------------------
//
// `wreckVehicle` hides the intact hull with whatever `visible` flags its
// children carry, and `respawnVehicle` turns the subtree back on -- so a flash
// left lit by a *destroyed* vehicle (killOccupantInWreck releases the guns, but
// a wreck can also be left mid-life by the frame it died on) comes back with it.
// Re-light it by hand here, because that is exactly the state the hull is in
// underneath the wreck.
{
  flash.visible = true;
  gun.position.set(gun.userData.home.x, gun.userData.home.y,
                   gun.userData.home.z + 0.1);
  // A spent, hot, mid-reload gun, held in the WeakMap the page keys on the
  // node -- and a respawn reuses the node.
  const states = new WeakMap();
  const state = new FireState(gun.userData.fireArms);
  states.set(gun, state);
  state.ammo = 0;
  state.heat = 1;
  state.reloadRemaining = 1.4;
  state.magsLeft = 0;
  out.wreckedState = { ammo: state.ammo, heat: state.heat,
                       reload: state.reloadRemaining, mags: state.magsLeft,
                       canFire: state.canFire };
  out.wreckedLit = lit(hull);

  idleFirePose(hull);
  // The page names both its own map and the world's; they are usually the same
  // object, which the de-duplication inside has to survive.
  out.respawnReset = idleFireState(hull, [states, states]);
  out.respawnLit = lit(hull);
  out.respawnOffHome = offHome(gun);
  out.respawnState = { ammo: state.ammo, heat: state.heat,
                       reload: state.reloadRemaining, mags: state.magsLeft,
                       canFire: state.canFire };
}

// --- the emitter's own transform, across repeated entries -----------------
//
// The half of the latch that hiding the node does not reach. `advance` places
// a drifting emitter at `basePos + drift` every frame and rewrites a
// billboarded one's quaternion; both stop dead when the group leaves the
// index, and `collect` re-reads `basePos`/`baseQuat` off whatever it finds on
// the next entry. Without the restore in `release`, the drift is re-baked as
// the authored placement and the emitter walks one more drift from the muzzle
// per enter-fire-exit cycle -- reproduced on the page with Kasserine Pass'
// AA_Allies, `Em_MuzzAAgunB_WSmoke` (`speedInDof 10`, 0.5 s life): authored
// local z -1.0, then -1.667, -2.0, -2.333 after one, two and three cycles.
{
  const scene2 = new THREE.Scene();
  const camera2 = new THREE.PerspectiveCamera();
  // A camera that is not at identity, so the billboard has something to write.
  camera2.quaternion.setFromEuler(new THREE.Euler(0.3, 0.7, 0.1));
  const guns2 = new GunFire({ scene: scene2, camera: camera2, viewportHeight: () => 900 });
  guns2.rand = () => 0.5;
  const { hull: aa, flash: smoke } = tank();
  smoke.name = 'Em_MuzzAAgunB_WSmoke';
  smoke.position.set(0, 0, -1);
  smoke.userData.effect = { kind: 'emitter', timeToLive: 0.5, size: 1,
                            speedInDof: 10, billboard: true };
  scene2.add(aa);
  out.driftAuthored = [smoke.position.x, smoke.position.y, smoke.position.z]
    .map(v => Number(v.toFixed(4)));
  out.driftCycles = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const [g] = guns2.collect(aa, { replace: false, speedScale: 1, roundLifetime: 'data' });
    guns2.setFiring(g, true);
    guns2.advance(1 / 60);   // the round leaves, the emitter opens at age 0
    guns2.advance(0.2);      // 2 m of drift along the direction of fire
    guns2.release(g);        // the exit, mid-drift
    out.driftCycles.push([smoke.position.x, smoke.position.y, smoke.position.z]
      .map(v => Number(v.toFixed(4))));
  }
  out.driftQuat = [smoke.quaternion.x, smoke.quaternion.y, smoke.quaternion.z,
                   smoke.quaternion.w].map(v => Number(v.toFixed(4)));
}

// --- the module's own contract --------------------------------------------
{
  // An already-idle tree costs nothing and reports nothing.
  const { hull: quiet } = tank();
  idleFirePose(quiet);
  const again = idleFirePose(quiet);
  out.idempotentHidden = again.hidden;
  out.idempotentUnrecoiled = again.unrecoiled;
  // A node with no `home` is not a recoil node, and must not be moved.
  const bare = new THREE.Object3D();
  bare.name = 'NoHome';
  bare.userData.fireArms = { roundOfFire: 1 };
  bare.position.set(1, 2, 3);
  idleFirePose(bare);
  out.bareKeptPosition = [bare.position.x, bare.position.y, bare.position.z];
  // And a lookup holding no state for the node is not an error.
  out.emptyLookup = idleFireState(quiet, [new WeakMap(), null, undefined]);
}

console.log(JSON.stringify(out));
