// What a thrown explosives pack does once it stops moving, and what the
// engineer's plunger does to it afterwards.
//
// Two questions, one rig, because both belong to the same round:
//
// 1. DOES IT LIE FLAT? Every round in `gunfire.js` is aimed nose-along-flight
//    with `mesh.lookAt(position - velocity)`. For a fuse round that is right
//    until it touches something and wrong the moment it does: the pack slides,
//    friction takes the horizontal component, and the only velocity left is
//    the hair of downward that gravity adds and the contact cancels every
//    tick — so `lookAt` stood the slab on its end and buried it in the
//    ground. `layOnSurface` is the fix and this asks the mesh which way its
//    own up points once it has settled.
//
// 2. DOES THE DETONATOR REACH IT? `FireArms::detonateProjectiles` (lnxded
//    0x08287f80) walks the weapon's own array of live rounds and calls
//    `Projectile::detonate()` on each, which is the same call the end of a
//    fuse makes. `GunFire.detonateProjectiles(group)` is that, and the blast
//    it leaves has to be the end-of-life record — splash, no direct hit.
//
// The collider is a flat floor at y = 0 and nothing else, so the contact
// normal is known exactly and the assertions can be angles rather than
// eyeballs.

import * as THREE from 'three';
import { GunFire } from './gunfire.js';

/** The four coefficients `contact-response.js` reads for material 195
 *  (the explosives pack's collision-vertex material) and the ground. */
const MATERIALS = {
  0: { friction: 1.0, elasticity: 0, resistance: 0.02 },
  195: { friction: 1.0 },          // declared but bare: constructor defaults
};

/** A floor at y = 0, as `WorldCollider.cast` hands one back. */
const floor = {
  heightfield: { height: () => 0 },
  cast(ox, oy, oz, dx, dy, dz, maxDist) {
    if (dy >= 0) return null;               // nothing overhead
    const t = (oy - 0) / -dy;
    if (t < 0 || t > maxDist) return null;
    return { t, x: ox + dx * t, y: 0, z: oz + dz * t,
             nx: 0, ny: 1, nz: 0, material: 0, kind: 'terrain' };
  },
};

function packRig() {
  const weapon = new THREE.Group();
  weapon.name = 'ExpPack';
  weapon.userData.fireArms = {
    roundOfFire: 1, fireOnce: true, velocity: 6, muzzles: 1,
    magSize: 4, numOfMag: 1,
    projectile: {
      kind: 'shell', template: 'ExpPackProjectile', timeToLive: 240,
      gravity: 1, material: 70,
      damage: { hasCollisionEffect: false, dieAfterColl: false,
                explosionDamage: 0, damageType: 1, radius: 12,
                material2: 204 },
      endEffect: 'e_ExplGranade',
    },
    throw: { fireDelay: 0.4, hideDuringFireTime: 0.2 },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  // The demokit is a flat slab: wide in x and z, thin in y, lying in its own
  // XZ plane exactly as the exporter bakes it.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.20),
                              new THREE.MeshBasicMaterial());
  body.name = 'ExpPack projectile';
  body.userData.projectileMesh = true;
  weapon.add(muzzle, body);
  return weapon;
}

/**
 * A smoke grenade, as Desert Combat's `SmokeGrenadeProjectile` and Eve of
 * Destruction's `US*SmokeProjectile`s author it: `damageType 1` with `radius
 * 0` (no splash at all), `hasCollisionEffect 0`, `dieAfterColl 0`,
 * `hasOnTimeEffect 1`, `setHasPointPhysics 0`, and the smoke as a
 * `startEffectTemplate` that the bake records as `trailBundle`. `pointBody`
 * leaves the physics word off, which is also what a glb baked before the
 * word was recorded looks like.
 */
function smokeRig({ pointBody = false } = {}) {
  const weapon = new THREE.Group();
  weapon.name = 'SmokeGrenade';
  const projectile = {
    kind: 'shell', template: 'SmokeGrenadeProjectile', timeToLive: 30,
    gravity: 1, material: 70,
    damage: { hasCollisionEffect: false, dieAfterColl: false,
              damageType: 1, radius: 0, material2: 93, hasOnTimeEffect: true },
    trailBundle: 'e_SmokeGrenade',
  };
  if (!pointBody) projectile.hasPointPhysics = false;
  weapon.userData.fireArms = {
    roundOfFire: 1, fireOnce: true, velocity: 20, muzzles: 1,
    magSize: 3, numOfMag: 1,
    projectile,
    throw: { fireDelay: 0.4, hideDuringFireTime: 0.2 },
  };
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.userData.muzzle = true;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.07),
                              new THREE.MeshBasicMaterial());
  body.name = 'SmokeGrenade projectile';
  body.userData.projectileMesh = true;
  weapon.add(muzzle, body);
  return weapon;
}

/** An effect player that records what a round attaches and stops: enough of
 *  `EffectPlayer` for `round-launch.js` / `projectile-flight.js`. */
function effectStub() {
  const stub = {
    plays: [], stops: 0,
    has: () => true,
    play(name, opts = {}) {
      const handle = { name, attached: !!opts.attach, stopped: false,
                       stop() { if (!handle.stopped) { handle.stopped = true; stub.stops++; } } };
      stub.plays.push(handle);
      return handle;
    },
  };
  return stub;
}

const out = {};
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
const guns = new GunFire({ scene, camera, viewportHeight: () => 900 });
guns.rand = () => 0.5;
guns.collider = floor;
guns.materials = MATERIALS;

const group = guns.collect(packRig(), {
  replace: true,
  speedScale: 1,
  roundLifetime: 'data',
  // Thrown forward and level from chest height, the way a pack is put down.
  aimRay: () => ({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } }),
})[0];
out.collected = !!group;

guns.setFiring(group, true);
guns.advance(1 / 30);
guns.setFiring(group, false);
out.inFlight = guns.projectiles.length;

const shot = guns.projectiles[0];
out.hasBody = !!shot?.body;

// Fly, land, slide, settle. 8 s of 30 Hz ticks is far more than the pack
// needs and far less than its 240 s fuse.
for (let i = 0; i < 240 && !shot.body.resting; i++) guns.advance(1 / 30);
out.resting = !!shot.body.resting;
out.contacts = shot.body.contacts;
out.restY = Math.round(shot.mesh.position.y * 1000) / 1000;

// The question: which way is the slab's own up pointing? Flat on a level
// floor means local +Y within a hair of world +Y. Standing on its end — the
// bug — reads 90 degrees.
const up = new THREE.Vector3(0, 1, 0).applyQuaternion(shot.mesh.quaternion);
out.tiltDegrees = Math.round(
  THREE.MathUtils.radToDeg(up.angleTo(new THREE.Vector3(0, 1, 0))) * 100) / 100;
// And it is still a rotation, not a mirror: a basis built the wrong way round
// turns the mesh inside out, which a determinant of -1 would show.
out.determinant = Math.round(
  new THREE.Matrix4().makeRotationFromQuaternion(shot.mesh.quaternion)
    .determinant() * 1000) / 1000;
// It faces the way it was thrown (-Z), not some arbitrary axis.
const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(shot.mesh.quaternion);
out.headingDot = Math.round(nose.dot(new THREE.Vector3(0, 0, -1)) * 1000) / 1000;

// It stays put and stays flat: a settled round must not creep or tip over the
// rest of its fuse.
const settled = shot.mesh.position.clone();
for (let i = 0; i < 300; i++) guns.advance(1 / 30);
out.driftAfter10s = Math.round(settled.distanceTo(shot.mesh.position) * 1000) / 1000;
out.tiltAfter10s = Math.round(THREE.MathUtils.radToDeg(
  new THREE.Vector3(0, 1, 0).applyQuaternion(shot.mesh.quaternion)
    .angleTo(new THREE.Vector3(0, 1, 0))) * 100) / 100;

// Put three more down, then work the plunger.
for (let i = 0; i < 3; i++) {
  group.cooldown = 0;
  guns.setFiring(group, true);
  guns.advance(1 / 30);
  guns.setFiring(group, false);
}
out.liveBeforePlunger = guns.liveProjectiles(group);
out.hitsBefore = guns.hits.length;
out.detonated = guns.detonateProjectiles(group);
out.liveAfterPlunger = guns.liveProjectiles(group);
out.projectilesAfter = guns.projectiles.length;
const record = guns.hits[0];
out.blastKind = record?.kind ?? null;
out.blastRadius = record?.splashRadius ?? null;
out.blastNormal = record?.normal ?? null;
// A second pull with nothing left to set off is not an error and not a blast.
out.secondPull = guns.detonateProjectiles(group);


// ---------------------------------------------------------------------------
// A round with no blast still rests, and the smoke riding it keeps playing.
//
// The smoke grenade is not a fuse round (nothing to burst), and until
// 2026-10-10 that put it on the ballistic path: recycled at its first touch,
// its attached bundle stopped with it, and a thrown smoke grenade showed
// nothing. HP-9e says the engine leaves it alive, and it does: it lies there
// for its 30 s and smokes from where it lies.
{
  const fx = effectStub();
  const guns2 = new GunFire({ scene: new THREE.Scene(), camera, viewportHeight: () => 900 });
  guns2.rand = () => 0.5;
  guns2.collider = floor;
  guns2.materials = MATERIALS;
  guns2.effects = fx;
  const smoke = guns2.collect(smokeRig(), {
    replace: true, speedScale: 1, roundLifetime: 'data',
    // Lobbed, as a grenade is thrown.
    aimRay: () => ({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0.3, z: -0.954 } }),
  })[0];
  guns2.setFiring(smoke, true);
  guns2.advance(1 / 30);
  guns2.setFiring(smoke, false);
  const shot2 = guns2.projectiles[0];
  const run = fx.plays[0] ?? null;
  const smokeOut = {
    inFlight: guns2.projectiles.length,
    hasBody: !!shot2?.body,
    fuse: shot2?.fuse ?? null,
    ttl: shot2?.ttl ?? null,
    runName: run?.name ?? null,
    runAttached: run?.attached ?? null,
  };
  let frames = 0;
  for (; frames < 300 && !shot2.body.resting; frames++) guns2.advance(1 / 30);
  smokeOut.resting = !!shot2.body.resting;
  smokeOut.contacts = shot2.body.contacts;
  smokeOut.framesToRest = frames;
  smokeOut.restY = Math.round(shot2.mesh.position.y * 1000) / 1000;
  smokeOut.liveAtRest = guns2.projectiles.length;
  smokeOut.runStoppedAtRest = run?.stopped ?? null;
  // No impact record: a contact-surviving round plays no collision effect and
  // takes no impact path (HP-9d).
  smokeOut.hitsAtRest = guns2.hits.length;
  // Lie there a while longer: still live, still smoking.
  for (let i = 0; i < 150; i++) guns2.advance(1 / 30);
  smokeOut.liveAfter5s = guns2.projectiles.length;
  smokeOut.runStoppedAfter5s = run?.stopped ?? null;
  // Then the 30 s run out: the round goes, the run stops, and with `radius
  // 0` there is no end-of-life blast to record.
  for (let i = 0; i < 30 * 30; i++) guns2.advance(1 / 30);
  smokeOut.liveAfterFuse = guns2.projectiles.length;
  smokeOut.runStoppedAfterFuse = run?.stopped ?? null;
  smokeOut.hitsAfterFuse = guns2.hits.length;
  smokeOut.stops = fx.stops;
  out.smoke = smokeOut;
}

// The control: the same round as a point body (or from a glb baked before
// `hasPointPhysics` was recorded). The engine gives a surviving point body no
// response at all (collision-response.md section 10), nothing has read what
// it does next, so the viewer keeps ending it at the wall — and says so.
{
  const fx = effectStub();
  const guns3 = new GunFire({ scene: new THREE.Scene(), camera, viewportHeight: () => 900 });
  guns3.rand = () => 0.5;
  guns3.collider = floor;
  guns3.materials = MATERIALS;
  guns3.effects = fx;
  const point = guns3.collect(smokeRig({ pointBody: true }), {
    replace: true, speedScale: 1, roundLifetime: 'data',
    aimRay: () => ({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0.3, z: -0.954 } }),
  })[0];
  guns3.setFiring(point, true);
  guns3.advance(1 / 30);
  guns3.setFiring(point, false);
  const shot3 = guns3.projectiles[0];
  const pointOut = { hasBody: !!shot3?.body, ttl: shot3?.ttl ?? null };
  let frames = 0;
  for (; frames < 300 && guns3.projectiles.length; frames++) guns3.advance(1 / 30);
  pointOut.framesToEnd = frames;
  pointOut.live = guns3.projectiles.length;
  pointOut.runStopped = fx.plays[0]?.stopped ?? null;
  out.pointBody = pointOut;
}

console.log(JSON.stringify(out));
