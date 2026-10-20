// `fireingForce` (ledger FA-1): a round's shove on the hull its gun is bolted
// to, driven under node through the real `viewer/gun-recoil.js`,
// `viewer/gunfire.js` and `viewer/rigid-body.js`.
//
// The questions, in the order the engine asks them (`FireArms::Fire` lnxded
// `0x0828a090`, the block at `0x0828a43f`):
//
//   R-1  does the push come out backwards along the gun, at the gun's position
//   R-2  is it told once per TRIGGER PULL, not once per barrel
//   R-3  does a gun with no `fireingForce` push nothing
//   R-4  does the acceleration spend one tick, giving v = force / 30
//   R-5  does a gun across the hull slide the tank sideways AND roll it,
//        because the push goes in at the gun rather than the centre of mass
//   R-6  does a shot move a hull that was parked and asleep
//   R-7  does `hull-bodies.js` `recoilOnHull` find the right body: the driven
//        one under a crew, the parked one otherwise, and none for a gun that
//        belongs to no placed object
//
// Run by `tests/test_gun_recoil.py`; prints one JSON object.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir, seedMathRandom } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const THREE = await imp('vendor/three.module.js');
const { fireingPush, pushSlot } = await imp('gun-recoil.js');
const { GunFire } = await imp('gunfire.js');
const { RigidBody, TICK } = await imp('rigid-body.js');
const { createHullBodies } = await imp('hull-bodies.js');
seedMathRandom(11);
const log = console.log;
console.log = () => {};
console.warn = () => {};

const out = {};
const round4 = v => Math.round(v * 1e4) / 1e4;

// --- the rig ----------------------------------------------------------------

// The shipped `Sherman.glb` firing block, trimmed to what a group needs: the
// cannon's own numbers out of `Objects/Vehicles/Land/Sherman/Weapons.con`.
const SHERMAN_CANNON = {
  projectile: { template: 'ShermanProjectile', kind: 'shell' },
  roundOfFire: 0.4,
  velocity: 250,
  magSize: 1,
  numOfMag: 46,
  recoil: { size: 3, speed: 10 },
  fireingForce: 110,
  input: 'c_PIFire',
  control: 'vehicle',
};

/**
 * A gun node stamped the way `bf42/assemble.py` stamps one, standing at
 * `pos` and yawed `yawDeg` about world Y. A tank's gun node points down the
 * barrel, and glTF forward is -Z (`gunfire.js` fires rounds down `(0,0,-1)`).
 */
function gunNode(name, stats, { pos = [0, 0, 0], yawDeg = 0, scale = 1 } = {}) {
  const node = new THREE.Object3D();
  node.name = name;
  node.userData.fireArms = stats;
  node.position.set(pos[0], pos[1], pos[2]);
  node.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  node.scale.setScalar(scale);
  node.updateWorldMatrix(true, false);
  return node;
}

/** A `GunFire` with no world around it, and the pushes it reports. */
function rigGuns(node, { muzzles = 0 } = {}) {
  const scene = new THREE.Scene();
  scene.add(node);
  for (let i = 0; i < muzzles; i++) {
    const muzzle = new THREE.Object3D();
    muzzle.name = `muzzle${i}`;
    muzzle.userData.muzzle = true;
    muzzle.position.set(0, 0, -1 - i);
    node.add(muzzle);
  }
  scene.updateMatrixWorld(true);
  const guns = new GunFire({ scene, camera: new THREE.PerspectiveCamera() });
  const pushes = [];
  guns.hullRecoil = (group, push) => {
    pushes.push({ group: group.node.name, px: push.px, py: push.py, pz: push.pz,
                  ax: push.ax, ay: push.ay, az: push.az });
  };
  const groups = guns.collect(node);
  return { guns, groups, pushes };
}

// --- R-1: the vector -------------------------------------------------------

{
  // A gun at the origin pointing down -Z: the push is +Z, out of the breech.
  const home = gunNode('Home', SHERMAN_CANNON);
  const slot = pushSlot();
  const straight = { ...fireingPush(home.matrixWorld.elements, 110, slot) };
  // Yawed 90 degrees: the barrel points down -X, so the push is +X.
  const across = gunNode('Across', SHERMAN_CANNON, { pos: [2, 1.5, -0.5], yawDeg: 90 });
  const sideways = { ...fireingPush(across.matrixWorld.elements, 110, pushSlot()) };
  // A scaled node must not scale the force: the axis is normalised.
  const big = gunNode('Big', SHERMAN_CANNON, { scale: 4 });
  const scaled = { ...fireingPush(big.matrixWorld.elements, 110, pushSlot()) };
  out.r1 = {
    straight: { ax: round4(straight.ax), ay: round4(straight.ay), az: round4(straight.az),
                px: round4(straight.px), py: round4(straight.py), pz: round4(straight.pz) },
    sideways: { ax: round4(sideways.ax), ay: round4(sideways.ay), az: round4(sideways.az),
                px: round4(sideways.px), py: round4(sideways.py), pz: round4(sideways.pz) },
    scaledLength: round4(Math.hypot(scaled.ax, scaled.ay, scaled.az)),
    // The gates: no force, zero force, a degenerate axis.
    none: fireingPush(home.matrixWorld.elements, undefined, pushSlot()),
    zero: fireingPush(home.matrixWorld.elements, 0, pushSlot()),
    negative: fireingPush(home.matrixWorld.elements, -110, pushSlot()),
    noMatrix: fireingPush(null, 110, pushSlot()),
    // `out` is returned, not a fresh object: no per-shot allocation.
    reusesOut: fireingPush(home.matrixWorld.elements, 110, slot) === slot,
  };
}

// --- R-2 / R-3: once per pull ----------------------------------------------

{
  // One barrel, one pull.
  const single = rigGuns(gunNode('ShermanGunBarrel', SHERMAN_CANNON));
  single.guns.fireShot(single.groups[0]);
  // Four barrels fired as one salvo (`asynchronyFire` unset): still one push.
  const salvoStats = { ...SHERMAN_CANNON, asynchronyFire: false };
  const salvo = rigGuns(gunNode('FourBarrel', salvoStats), { muzzles: 4 });
  salvo.guns.fireShot(salvo.groups[0]);
  // A gun that declares none (the Sherman's coaxial Browning).
  const quiet = { ...SHERMAN_CANNON };
  delete quiet.fireingForce;
  const coax = rigGuns(gunNode('Coaxial_browning', quiet));
  coax.guns.fireShot(coax.groups[0]);
  // Three pulls in a row: three pushes.
  const held = rigGuns(gunNode('Held', SHERMAN_CANNON));
  for (let i = 0; i < 3; i++) held.guns.fireShot(held.groups[0]);
  out.r2 = {
    singleBarrels: single.groups[0].muzzles.length,
    singlePushes: single.pushes.length,
    salvoBarrels: salvo.groups[0].muzzles.length,
    salvoShots: salvo.groups[0].shots,
    salvoPushes: salvo.pushes.length,
    heldPushes: held.pushes.length,
    coaxPushes: coax.pushes.length,
    coaxFired: coax.groups[0].shots,
    // The flash-only path (`GunFire.flash`, a bot's round the referee already
    // resolved) carries no recoil, as it carries no round.
    flashPushes: (() => {
      const r = rigGuns(gunNode('Flashed', SHERMAN_CANNON));
      r.guns.flash(r.groups[0]);
      return r.pushes.length;
    })(),
  };
}

// --- R-4 / R-5 / R-6: what the hull does with it ---------------------------

/** A Sherman-shaped body: `mass`, `inertiaModifier` and the collision box of
 *  the shipped `Sherman.glb` spec, standing level at the origin. */
function sherman({ asleep = false } = {}) {
  const body = new RigidBody({
    mass: 30000,
    inertiaModifier: [1, 1, 1],
    box: [3.2, 2.8, 6.4],
    position: [0, 0, 0],
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  });
  if (asleep) body.setSleepiness(0);
  return body;
}

{
  // The gun pointing straight ahead, at the turret's height and over the
  // hull's middle: the push is pure reverse, and the 1.6 m arm above the
  // centre of mass pitches the nose up as it goes.
  const ahead = sherman();
  const push = fireingPush(gunNode('Ahead', SHERMAN_CANNON,
                                   { pos: [0, 1.6, 0] }).matrixWorld.elements,
                           110, pushSlot());
  ahead.addAccelerationAt([push.px, push.py, push.pz], [push.ax, push.ay, push.az]);
  ahead.step(TICK);
  // The gun turned across the hull and standing where a Sherman's mantlet is:
  // the same force, but the arm turns it into a slide AND a roll.
  const across = sherman();
  const sidePush = fireingPush(gunNode('Across', SHERMAN_CANNON,
                                       { pos: [1.4, 1.6, 0.6], yawDeg: 90 }).matrixWorld.elements,
                               110, pushSlot());
  across.addAccelerationAt([sidePush.px, sidePush.py, sidePush.pz],
                           [sidePush.ax, sidePush.ay, sidePush.az]);
  across.step(TICK);
  out.r4 = {
    // v = a * dt, one tick, with gravity's own tick on top of the Y term.
    forwardVz: round4(ahead.v[2]),
    forwardVx: round4(ahead.v[0]),
    expectedVz: round4(110 * TICK),
    // Gravity is seeded every tick, so Y is never the gun's business.
    forwardSpin: round4(Math.hypot(ahead.w[0], ahead.w[1], ahead.w[2])),
  };
  out.r5 = {
    vx: round4(across.v[0]),
    vz: round4(across.v[2]),
    rollRate: round4(across.w[2]),
    yawRate: round4(across.w[1]),
    spin: round4(Math.hypot(across.w[0], across.w[1], across.w[2])),
  };
  // R-6: a hull the level parked and nothing has touched. `recoilOnHull`
  // wakes it as `FireArms::Fire` wakes the root's physics node (vtable
  // `+0xd4`), and `step`'s own `WAKE_ACCEL_SQ` test would catch a push this
  // large anyway (2.5, against 110^2) — so a parked hull moves either way,
  // and the explicit wake is what answers for a force under 1.58 m/s^2 and
  // for the frame the hull sleeps again.
  const parked = sherman({ asleep: true });
  const asleepFirst = parked.sleeping;
  parked.wake();
  parked.addAccelerationAt([push.px, push.py, push.pz], [push.ax, push.ay, push.az]);
  parked.step(TICK);
  const unwoken = sherman({ asleep: true });
  unwoken.addAccelerationAt([push.px, push.py, push.pz], [push.ax, push.ay, push.az]);
  unwoken.step(TICK);
  // A push below the wake floor: here the explicit wake is the whole story.
  const tiny = sherman({ asleep: true });
  const tinyPush = fireingPush(gunNode('Tiny', SHERMAN_CANNON).matrixWorld.elements,
                               1, pushSlot());
  tiny.addAccelerationAt([tinyPush.px, tinyPush.py, tinyPush.pz],
                         [tinyPush.ax, tinyPush.ay, tinyPush.az]);
  tiny.step(TICK);
  const tinyWoken = sherman({ asleep: true });
  tinyWoken.wake();
  tinyWoken.addAccelerationAt([tinyPush.px, tinyPush.py, tinyPush.pz],
                              [tinyPush.ax, tinyPush.ay, tinyPush.az]);
  tinyWoken.step(TICK);
  out.r6 = {
    asleepFirst,
    parkedVz: round4(parked.v[2]),
    unwokenVz: round4(unwoken.v[2]),
    tinyUnwokenVz: round4(tiny.v[2]),
    tinyWokenVz: round4(tinyWoken.v[2]),
  };
}

// --- R-7: the page's own body lookup ---------------------------------------

{
  // `hull-bodies.js` as the page builds it, with only the two things
  // `recoilOnHull` reads: the static index's owner lookup and the body world.
  const owners = new Map();
  const page = {
    collider: { statics: { ownerOf: node => owners.get(node) ?? -1 } },
  };
  const hb = createHullBodies(page);
  const parkedBody = sherman({ asleep: true });
  const drivenState = {
    position: { x: 0, y: 0, z: 0 },
    orientation: new THREE.Quaternion(),
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
  };
  // A `DrivenBody`-shaped stand-in: the real class needs a whole drive model,
  // and what is under test here is which body `recoilOnHull` picks and what it
  // calls on it.
  const driven = {
    woken: 0, calls: [],
    wake() { this.woken += 1; },
    addAccelerationAt(p, a) { this.calls.push({ p: [...p], a: [...a] }); },
    state: drivenState,
  };
  const entries = new Map([
    [1, { owner: 1, parked: { body: parkedBody }, driven: null }],
    [2, { owner: 2, parked: null, driven }],
  ]);
  hb.bodyWorld = { get: owner => entries.get(owner) ?? null };

  const parkedGun = gunNode('ParkedTank', SHERMAN_CANNON, { pos: [0, 1.6, 0] });
  const drivenGun = gunNode('CrewedTank', SHERMAN_CANNON, { pos: [1.4, 1.6, 0.6], yawDeg: 90 });
  const orphanGun = gunNode('Emplacement', SHERMAN_CANNON);
  owners.set(parkedGun, 1);
  owners.set(drivenGun, 2);
  // `orphanGun` is in no map: `ownerOf` answers -1, as it does for a gun on a
  // static emplacement or a hull whose pad has not spawned it.

  const parkedPush = fireingPush(parkedGun.matrixWorld.elements, 110, pushSlot());
  const drivenPush = fireingPush(drivenGun.matrixWorld.elements, 110, pushSlot());
  const beforeSleep = parkedBody.sleeping;
  const tookParked = hb.recoilOnHull(parkedGun, parkedPush);
  const tookDriven = hb.recoilOnHull(drivenGun, drivenPush);
  const tookOrphan = hb.recoilOnHull(orphanGun, parkedPush);
  const tookNothing = hb.recoilOnHull(parkedGun, null);
  parkedBody.step(TICK);
  out.r7 = {
    tookParked, tookDriven, tookOrphan, tookNothing,
    parkedAsleepBefore: beforeSleep,
    parkedAwakeAfter: !parkedBody.sleeping,
    parkedVz: round4(parkedBody.v[2]),
    drivenWoken: driven.woken,
    drivenCalls: driven.calls.length,
    // The driven hull's gun points across it: +X, at the mantlet.
    drivenAccel: driven.calls[0]?.a.map(round4),
    drivenAt: driven.calls[0]?.p.map(round4),
    // No body world at all (the model browser's turntable).
    noWorld: (() => {
      const bare = createHullBodies(page);
      return bare.recoilOnHull(parkedGun, parkedPush);
    })(),
  };
}

// --- the vanilla table, for the record --------------------------------------

out.vanilla = {
  // `Objects.rfa` of the shipped game, read 2026-10-18. The two destroyers'
  // declarations are commented out with `rem`, so they push nothing.
  Sherman: 110, T34: 100, Tiger: 90, 'T34-85': 90, M10: 90, Wespe: 80,
  PanzerIV: 70, 'Chi-ha': 60, Priest: 60, Sexton: 60, Katyusha: 30, Yamato: 10,
};

console.log = log;
console.log(JSON.stringify(out));
