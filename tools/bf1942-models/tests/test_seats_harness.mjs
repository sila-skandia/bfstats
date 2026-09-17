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
import { GunFire } from './gunfire.js';
import {
  surveyVehicle, classifySeat, classifyRoot, findAllVehicleRoots,
  listEntryPoints, pickNearest, TIE_EPSILON, VehicleOccupancy, TurretAxis,
  TurretRig, FireState, chainOnShot, readWorldPose,
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

// --- a nested PCO's own node name can diverge from its `control` tag -------
//
// Confirmed against the real, live Wake scene headless this round, not
// invented: when a level places more than one instance of a vehicle, the
// export gives every node under the second-and-later instances a scene-wide
// disambiguating suffix -- so `shermanBrowning_PCO1`'s own node ends up named
// `shermanBrowning_PCO1_1` on (at least) one of Wake's two Shermans, while
// every one of ITS OWN descendants still reports the bare `shermanBrowning_
// PCO1` as their `control`/`seat.control`. `surveyVehicle` must key a nested
// PCO's bucket by that shared `control` string, the same way its descendants
// already do -- keying by the node's own (possibly suffixed) name instead
// split one real seat into two: an empty one holding only `.node` (nothing
// ever resolves `owner` to the suffixed name) and a fully-populated one
// holding everything else (entryPoints/axes/fireArms/camera) but no `.node`,
// which both breaks `classifySeat` (no axes/fireArms on the `.node`-holding
// half -- 'seat', not 'gun') and shifts the real gunner from seat position 1
// to 2 in `order`, exactly where SEAT-23/24 says key "2" should reach it.
function shermanWithRenamedGunnerNode() {
  const tank = sherman();
  const gunner = tank.children.find(c => c.name === 'shermanBrowning_PCO1');
  gunner.name = 'shermanBrowning_PCO1_1';   // the node name a real export gives it
  return tank;                              // userData.control stays 'shermanBrowning_PCO1'
}

{
  const tank = shermanWithRenamedGunnerNode();
  const survey = surveyVehicle(tank);
  const gunnerSeat = survey.seats.get('shermanBrowning_PCO1');
  results.renamedGunnerNode = {
    order: survey.order,
    gunnerSeatExists: !!gunnerSeat,
    gunnerSeatHasNode: !!gunnerSeat?.node,
    gunnerSeatFireArms: gunnerSeat?.fireArms.map(n => n.name) ?? [],
    gunnerSeatAxisCount: Object.keys(gunnerSeat?.axes ?? {}).length,
    gunnerKind: gunnerSeat ? classifySeat(gunnerSeat, false) : null,
  };
}

// --- findAllVehicleRoots / listEntryPoints: every seat's own door -----------

{
  const level = node('Level', {}, defgun(), sherman());
  const roots = findAllVehicleRoots(level).map(r => r.name);
  const shermanRoot = findAllVehicleRoots(level).find(r => r.name === 'Sherman');
  const entries = listEntryPoints(shermanRoot, 4).map(e => ({ node: e.node.name, seatId: e.seatId, radius: e.radius }));
  results.entryPoints = { roots, shermanEntries: entries };
}

// --- pickNearest: round 3's second disclosed gap, a deterministic tie-break -
//
// Real numbers from the live Wake scene, not invented: the first Sherman's
// two doors (scratchpad/t2/dump.json, this round) put the driver's own
// EntryPoint and the hull gunner's at world positions ~1.1457e-13 m apart --
// a fixed value transcribed here, not re-measured, since re-measuring it
// needs the real glb this harness deliberately does not load (see the module
// doc). M3A1's four passenger seats compose to a bit-exact tie (0 m apart).

{
  const first = { id: 'first', d: 2.0 };
  const second = { id: 'second', d: 2.0 };            // exact tie
  const noisyAbove = { id: 'noisyAbove', d: 2.0 + 1.1457e-13 };   // the Sherman's own gap
  const noisyBelow = { id: 'noisyBelow', d: 2.0 - 1.1457e-13 };   // the direction that would actually swap it under a bare `<` compare
  const genuinelyCloser = { id: 'genuinelyCloser', d: 1.0 };
  const genuinelyFarther = { id: 'genuinelyFarther', d: 5.0 };
  const disqualified = { id: 'disqualified', d: Infinity };      // out of radius, `nearestEntry`'s own convention
  const fourWayTie = ['a', 'b', 'c', 'd'].map(id => ({ id, d: 3.5 }));   // M3A1's own shape

  results.pickNearest = {
    epsilon: TIE_EPSILON,
    emptyIsNull: pickNearest([], c => c.d),
    allDisqualifiedIsNull: pickNearest([disqualified, { id: 'alsoFar', d: Infinity }], c => c.d),
    exactTieKeepsFirstDeclared: pickNearest([first, second], c => c.d)?.id,
    exactTieKeepsFirstDeclaredReversed: pickNearest([second, first], c => c.d)?.id,
    // The actual bug: a plain `distance < best` would let `noisyBelow` win
    // here (1.999999999... < 2.0), even though nothing about the level says
    // it is really closer -- both candidates share `first`'s declared order.
    noiseAboveKeepsFirstDeclared: pickNearest([first, noisyAbove], c => c.d)?.id,
    noiseBelowKeepsFirstDeclared: pickNearest([first, noisyBelow], c => c.d)?.id,
    fourWayTieKeepsFirstDeclared: pickNearest(fourWayTie, c => c.d)?.id,
    genuinelyCloserWinsRegardlessOfOrder:
      pickNearest([first, genuinelyCloser], c => c.d)?.id === 'genuinelyCloser'
      && pickNearest([genuinelyCloser, first], c => c.d)?.id === 'genuinelyCloser',
    disqualifiedNeverWinsOverAnyRealCandidate:
      pickNearest([disqualified, genuinelyFarther], c => c.d)?.id,
  };
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

// --- held trigger + rate-of-fire: the Defgun's own numbers, ticked in real
// time rather than one `registerShot()` per attempt (round 3's own bug
// report: "held the trigger for 25 stepped frames, ammo stayed at 499 of
// 499"). The rate-of-fire gate lives in `gunfire.js`'s `advance()`, so that
// is what is driven here -- the real class, imported, not a second copy of
// its cadence written out in the harness; an earlier version of this block
// simulated it and therefore agreed with itself no matter what the shipped
// file actually did. `manned()`/`drive()` are what supply `state.canFire` on
// the page, and the loops below stand in for them at its own 1/60 s frame.
//
// A bare group is enough: `advance` only reads `firing`/`cooldown`/`stats`,
// and `fireShot` only needs a muzzle to cycle and no projectile to launch.

function cadenceRig(stats) {
  const guns = new GunFire({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    viewportHeight: () => 800,
  });
  const barrel = new THREE.Object3D();
  barrel.name = 'HarnessBarrel';
  const group = {
    node: barrel, stats: { projectile: null, tracer: null, ...stats },
    muzzles: [barrel], emitters: [], firing: false, cooldown: 0, shots: 0,
    tracerMeshPool: [], projectileMesh: null, recoil: null,
    speedScale: 1, maxRange: 1500, platformVelocity: null, aimRay: null,
    spreadDeg: null,
  };
  guns.groups.push(group);
  return { guns, group };
}

{
  const state = new FireState({ magSize: 499, numOfMag: 999, roundOfFire: 0.2 });
  const { guns, group } = cadenceRig({ roundOfFire: 0.2 });
  const DT = 1 / 60;
  guns.onShot = () => state.registerShot();
  function tick(trigger) {
    state.step(DT);
    guns.setFiring(group, trigger && state.canFire);
    guns.advance(DT);
  }
  for (let i = 0; i < 25; i++) tick(true);
  const after25Frames = state.ammo;
  for (let i = 0; i < 375; i++) tick(true);   // 400 frames total, ~6.7s -- past one 5s period
  const after400Frames = state.ammo;
  for (let i = 0; i < 60; i++) tick(false);   // trigger released
  const afterRelease = state.ammo;
  results.heldTriggerCadence = { after25Frames, after400Frames, afterRelease };
}

// --- the same gate with the trigger TAPPED rather than held. The gun is a
// Sherman's cannon: `roundOfFire 0.35`, one shell every 2.86 s. `setFiring`
// used to zero the cooldown on every rising edge, so releasing and
// re-pressing bought a fresh round each time and a second of tapping emptied
// the whole 30-round magazine (28 shells, reproduced in the browser). One
// second of tapping is one shell; ten seconds of holding is four, 2.86 s
// apart. GUN-5 puts the fire-rate timer in `isReadyToUseFire`'s own gate list
// beside the reload and overheat timers, not on the trigger edge.

{
  const DT = 1 / 60;
  const tap = cadenceRig({ roundOfFire: 0.35 });
  for (let i = 0; i < 60; i++) {
    tap.guns.setFiring(tap.group, i % 2 === 0);
    tap.guns.advance(DT);
  }
  const held = cadenceRig({ roundOfFire: 0.35 });
  held.guns.setFiring(held.group, true);
  for (let i = 0; i < 600; i++) held.guns.advance(DT);
  // An idle gun is still ready the instant the trigger goes down: the timer
  // floors at zero rather than running negative into a backlog the `while`
  // inside `advance` would then fire off in one frame.
  const rested = cadenceRig({ roundOfFire: 0.35 });
  rested.guns.setFiring(rested.group, true);
  rested.guns.advance(DT);
  rested.guns.setFiring(rested.group, false);
  for (let i = 0; i < 600; i++) rested.guns.advance(DT);
  rested.guns.setFiring(rested.group, true);
  rested.guns.advance(DT);
  results.triggerCadence = {
    tappedShotsInOneSecond: tap.group.shots,
    heldShotsInTenSeconds: held.group.shots,
    shotsAfterRestingTenSeconds: rested.group.shots,
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
