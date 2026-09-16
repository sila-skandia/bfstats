// Drives `viewer/seats.js` outside a browser and prints one JSON blob.
//
// Same shape as `ground_harness.mjs`: real `THREE.Object3D` nodes (vendored
// three.js stood up as a package by `test_seats.py`, so `seats.js` imports
// byte-for-byte), no scene, no GL, no renderer -- `surveyVehicle` only ever
// calls `.traverse()`/`.userData`, which a plain Object3D tree gives for free.
//
// The Defgun and Sherman trees below are transcribed from the same data
// BRIEFING2.md's scene survey names (control tags, EntryPoint radii, rig
// axes, FireArms stats) -- not the real glb, which is not in the repository,
// but the same shape `bf42/assemble.py`/`con.py` produce for them.

import * as THREE from 'three';
import {
  surveyVehicle, classifySeat, classifyRoot, findAllVehicleRoots,
  listEntryPoints, VehicleOccupancy, TurretAxis, TurretRig, FireState,
  chainOnShot, readWorldPose,
} from './seats.js';

const results = {};
const round = (n, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

function node(name, userData, ...children) {
  const obj = new THREE.Object3D();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
}

/** A single-seat manned gun, no drivetrain -- the Defgun's own shape. */
function defgun() {
  const yawAxis = node('DefgunTurret', {
    templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: -90, max: 90, free: false, maxSpeed: 90, direction: 1 } } },
  });
  const pitchAxis = node('DefgunGunBase', {
    templateKind: 'RotationalBundle',
    rig: { axes: { pitch: { input: 'c_PIMouseLookY', min: -30, max: 10, free: false, maxSpeed: 50, direction: 1 } } },
  });
  const camera = node('DefgunCamera', { templateKind: 'Camera' });
  const barrel = node('DefgunGunBarrel', {
    templateKind: 'FireArms',
    fireArms: { magSize: 499, numOfMag: 999, roundOfFire: 0.2 },
  });
  const entry = node('DefgunEntry', {
    control: 'Defgun', templateKind: 'EntryPoint',
    seat: { control: 'Defgun', entryRadius: 3.5 },
  });
  pitchAxis.add(camera, barrel);
  yawAxis.add(pitchAxis);
  return node('Defgun', {
    control: 'Defgun', templateKind: 'PlayerControlObject',
    hud: { hitpoints: 50, maxHitpoints: 50, vehicleIcon: 'Vehicle/Icon_defgun.tga' },
  }, yawAxis, entry);
}

/** Root (tank, no rig data needed for classification) + one nested gunner
 *  seat -- the Sherman's own shape (SEAT-24: driver=position0, gunner=1). */
function sherman() {
  const engine = node('ShermanEngine', {
    templateKind: 'Engine', physics: { engineType: 'c_ETTank' },
  });
  const cannon = node('ShermanGunBarrel', {
    templateKind: 'FireArms', fireArms: { magSize: 30, numOfMag: 1, roundOfFire: 0.5 },
  });
  const rootEntryA = node('ShermanEntry', {
    control: 'Sherman', templateKind: 'EntryPoint',
    seat: { control: 'Sherman', entryRadius: 3.6 },
  });
  const gunYaw = node('ShermanBrowningRot', {
    templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: 0, max: 0, free: true, maxSpeed: 60, direction: 1 } } },
    control: 'shermanBrowning_PCO1',
  });
  const gunCamera = node('ShermanBrowningCamera', { templateKind: 'Camera', control: 'shermanBrowning_PCO1' });
  const gunBarrel = node('Browning', {
    templateKind: 'FireArms', control: 'shermanBrowning_PCO1',
    fireArms: { magSize: 500, numOfMag: 1, heatAddWhenFire: 0.05, coolDownPerSec: 0.3, timeDelayOnOverheat: 2 },
  });
  const gunEntry = node('ShermanEntry_2', {
    // `surveyVehicle` buckets by the top-level `control` tag (every non-PCO
    // node carries one, per its own doc); `seat.control` is a second,
    // redundant copy of the same name that only `entryRadius`/legacy readers
    // use. Both must agree, exactly as `bf42/con.py` stamps them.
    control: 'shermanBrowning_PCO1', templateKind: 'EntryPoint',
    seat: { control: 'shermanBrowning_PCO1', entryRadius: 3.6 },
  });
  gunYaw.add(gunCamera, gunBarrel);
  const hullGunner = node('shermanBrowning_PCO1', {
    control: 'shermanBrowning_PCO1', templateKind: 'PlayerControlObject',
  }, gunYaw, gunEntry);
  return node('Sherman', {
    control: 'Sherman', templateKind: 'PlayerControlObject',
    hud: { hitpoints: 105, maxHitpoints: 105, vehicleIcon: 'Vehicle/Icon_sherman.tga' },
  }, engine, cannon, rootEntryA, hullGunner);
}

// --- classification: GUN-10's own definition ---------------------------------

{
  const gun = defgun();
  const tank = sherman();
  results.classify = {
    defgunRoot: classifyRoot(gun),
    shermanRoot: classifyRoot(tank),
    shermanGunnerSeat: (() => {
      const { seats } = surveyVehicle(tank);
      return classifySeat(seats.get('shermanBrowning_PCO1'), false);
    })(),
    // A root with neither an Engine, nor motion+FireArms, nor even a
    // FireArms at all is a bare seat -- GUN-10's fallthrough (a passenger
    // position, or a hull this round has no drive model for).
    bareSeat: classifyRoot(node('Rider', { control: 'Rider', templateKind: 'PlayerControlObject' },
      node('RiderEntry', { templateKind: 'EntryPoint', seat: { control: 'Rider', entryRadius: 2 } }))),
  };
}

// --- seat order (SEAT-24: driver=position0=key1, gunner=position1=key2) -----

{
  const tank = sherman();
  const { order } = surveyVehicle(tank);
  results.seatOrder = order;
}

// --- findAllVehicleRoots / listEntryPoints: every seat's own door -----------

{
  const level = node('Level', {}, defgun(), sherman());
  const roots = findAllVehicleRoots(level).map(r => r.name);
  const shermanRoot = findAllVehicleRoots(level).find(r => r.name === 'Sherman');
  const entries = listEntryPoints(shermanRoot, 4).map(e => ({ node: e.node.name, seatId: e.seatId, radius: e.radius }));
  results.entryPoints = { roots, shermanEntries: entries };
}

// --- VehicleOccupancy: seat switching, turret build/drop, HUD lookups -------

{
  // Fake drivetrain classes -- VehicleOccupancy only ever calls
  // `new Cls(root, parent, options)` and expects `.control` back; it never
  // reaches into flight.js/ground.js itself (that seam is the whole point of
  // dependency-injecting `classes`, per seats.js's own doc).
  class FakeDrive {
    constructor(root, parent, options) { this.root = root; this.parent = parent; this.options = options; this.control = root.name; }
  }
  const tank = sherman();
  const occ = new VehicleOccupancy(tank, { GroundVehicle: FakeDrive });
  const beforeDrive = occ.drive;
  const drive = occ.ensureDrive({ name: 'scene' }, { groundHeight: () => 0 });
  occ.setActiveSeat(occ.rootId);
  const rootTurret = occ.turret;
  const rootHud = occ.activeHud();
  occ.setActiveSeat(occ.seatIdAt(1));
  const gunnerTurret = occ.turret;
  const gunnerFireArms = occ.activeFireArmsNodes().map(n => n.name);
  const gunnerHud = occ.activeHud();
  results.occupancy = {
    beforeDriveNull: beforeDrive === null,
    driveIsFakeInstance: drive instanceof FakeDrive,
    rootKind: occ.rootKind,
    rootTurretNull: rootTurret === null,          // the tank root has no RotationalBundle rig of its own here
    gunnerTurretIsRig: gunnerTurret instanceof TurretRig,
    gunnerAxisCount: gunnerTurret.axes.length,
    gunnerFireArms,
    rootHudIcon: rootHud.vehicleIcon,
    // R2-31 (verify-r2.md, corrected): hitpoints/armor is the ROOT's alone --
    // the gunner seat's own `hud` block (none declared here) must fall back.
    gunnerHudSameAsRoot: gunnerHud === rootHud,
    exitLocationFallsBackToRoot: occ.exitLocationNode() === occ.root,
  };
}

// --- TurretAxis: deadzone, clamp, and the free-axis wrap ---------------------

{
  const spec = { min: -90, max: 90, free: false, maxSpeed: 90, direction: 1 };
  const rig = node('Axis', {});
  const axis = new TurretAxis('yaw', rig, spec);
  // Below the ~20px/tick deadzone at the shipped TURRET_SENSITIVITY (0.05):
  // GUN-3's own hardcoded ±1.0 deadzone on the ±40-clamped input register.
  axis.feed(6);
  axis.step(1 / 60);
  const belowDeadzone = axis.angle;

  // Sustained, well past the deadzone: the axis must actually move, and in
  // the fed direction's sign convention (whichever `TurretAxis` picks --
  // asserted for stability, not re-derived here). A single `feed(30)` per
  // tick clears the deadzone (30*TURRET_SENSITIVITY=1.5) but barely: the
  // input register (`driven`) is small relative to its own ±40 ceiling, so
  // the target velocity this drives is a small fraction of `maxSpeed` --
  // real play accumulates several mousemove events (several `feed()` calls)
  // between two rendered frames, which this single-feed-per-tick loop does
  // not reproduce. Good enough to prove direction; the clamp test below
  // feeds a saturating value instead, so it does not depend on this nuance.
  for (let i = 0; i < 120; i++) { axis.feed(30); axis.step(1 / 60); }
  const movedAngle = axis.angle;

  // Pinned at the input register's own ±40 ceiling (feed far exceeds it),
  // so the target velocity is the full `maxSpeed` and the ramp
  // (`TURRET_RAMP_TIME`) is the only thing left standing between rest and
  // the clamp -- 5 real seconds is comfortably past both. Must sit exactly
  // at the declared max, never beyond it (GUN-4: setState's clamp,
  // reproduced per-tick by TurretAxis.step itself here rather than a
  // separate setState call).
  for (let i = 0; i < 300; i++) { axis.feed(2000); axis.step(1 / 60); }
  const clampedAngle = axis.angle;

  // A free (min==max) axis wraps through ±180 instead of clamping.
  const freeAxis = new TurretAxis('yaw', node('FreeAxis', {}), { free: true, maxSpeed: 90, direction: 1 });
  for (let i = 0; i < 400; i++) { freeAxis.feed(2000); freeAxis.step(1 / 60); }
  const freeAngle = freeAxis.angle;

  results.turretAxis = {
    belowDeadzone: round(belowDeadzone),
    movedNonZero: Math.abs(movedAngle) > 1,
    movedSameSignAsInput: Math.sign(movedAngle) === Math.sign(30),
    clampedAtMax: round(clampedAngle) === 90,
    freeStaysInWrapRange: freeAngle <= 180 && freeAngle >= -180,
  };
}

// --- FireState: gate order, heat/overheat, reload ---------------------------

{
  const limited = new FireState({ magSize: 3, numOfMag: 2, reloadTime: 1 });
  const shots = [];
  for (let i = 0; i < 5; i++) {
    shots.push({ canFire: limited.canFire, ammo: limited.ammo, magsLeft: limited.magsLeft });
    if (limited.canFire) limited.registerShot();
    limited.step(1 / 60);
  }
  // Emptying the mag starts a reload; canFire must refuse until it completes,
  // then hand back a full mag from the second one in the pouch.
  let reloadTicks = 0;
  while (limited.reloadRemaining > 0) { limited.step(1 / 30); reloadTicks++; }
  const afterReload = { ammo: limited.ammo, magsLeft: limited.magsLeft, canFire: limited.canFire };

  const heated = new FireState({ magSize: -1, heatAddWhenFire: 0.4, coolDownPerSec: 0.2, timeDelayOnOverheat: 2 });
  for (let i = 0; i < 3; i++) heated.registerShot();   // 3*0.4 = 1.2, clamps to 1 -> overheats
  const heatAfterShots = heated.heat;                  // captured before any cooldown step below
  const overheatedCanFire = heated.canFire;
  const overheatRemainingAfterShots = heated.overheatRemaining;
  heated.step(2.1);
  const canFireAfterCooldown = heated.canFire;

  const unlimited = new FireState({ magSize: -1, numOfMag: -1 });
  results.fireState = {
    shots,
    reloadTookAboutReloadTime: reloadTicks >= 25 && reloadTicks <= 35,
    afterReload,
    heatClampsAtOne: heatAfterShots >= 1,
    overheatedCanFire,
    overheatRemainingAfterShots: round(overheatRemainingAfterShots, 2),
    canFireAfterCooldown,
    unlimitedNeverBlocksOnAmmo: (() => {
      for (let i = 0; i < 50; i++) unlimited.registerShot();
      return unlimited.canFire;
    })(),
  };
}

// --- chainOnShot: wraps without discarding whatever ran first ---------------

{
  const calls = [];
  const guns = { onShot: group => calls.push(['first', group]) };
  chainOnShot(guns, group => calls.push(['second', group]));
  guns.onShot({ id: 1 });
  results.chainOnShot = { order: calls.map(c => c[0]), sawGroup: calls[0][1].id === 1 && calls[1][1].id === 1 };
}

// --- readWorldPose: a nested node's world pose follows its parent's --------

{
  const parent = new THREE.Object3D();
  parent.position.set(10, 0, 0);
  const child = new THREE.Object3D();
  child.position.set(0, 2, 0);
  parent.add(child);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  readWorldPose(child, pos, quat);
  const before = pos.toArray();
  parent.position.set(10, 0, 5);
  readWorldPose(child, pos, quat);
  results.readWorldPose = { before, after: pos.toArray() };
}

process.stdout.write(JSON.stringify(results, null, 2));
