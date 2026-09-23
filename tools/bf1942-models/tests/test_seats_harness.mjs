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
  TurretRig, FireState, chainOnShot, readWorldPose, AIM_INPUTS, hasAimAxes,
  TURRET_ACCELERATION, axisPeerNodes, turretPeerNodes, detachSpawnedCraft,
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

/** Root (a tank, with the turret its own driving seat really declares) plus
 *  one nested gunner seat -- the Sherman's own shape (SEAT-24: driver=
 *  position0, gunner=1). The tower and gun base are transcribed from
 *  `Sherman.glb`'s extras: a free `c_PIMouseLookX` traverse at 35 deg/s and a
 *  `c_PIMouseLookY` elevation over -20..+5 at 20 deg/s, both under the
 *  Sherman's OWN control, with the cannon and the driver's camera hanging off
 *  the gun base exactly as the real tree has them. The fixture used to leave
 *  the root rigless with a note that classification needed no rig data --
 *  true of classification, and the reason nothing noticed the driver's gun
 *  could not be aimed. */
function sherman() {
  const engine = node('ShermanEngine', {
    templateKind: 'Engine', physics: { engineType: 'c_ETTank' },
  });
  const cannon = node('ShermanGunBarrel', {
    templateKind: 'FireArms', fireArms: { magSize: 30, numOfMag: 1, roundOfFire: 0.5 },
  });
  const driverCamera = node('ShermanCamera', { templateKind: 'Camera', control: 'Sherman' });
  const gunBase = node('ShermanGunBase', {
    control: 'Sherman', templateKind: 'RotationalBundle',
    rig: { axes: { pitch: { input: 'c_PIMouseLookY', min: -20, max: 5, free: false, maxSpeed: 20, direction: 1 } } },
  }, cannon, driverCamera);
  const tower = node('ShermanTower', {
    control: 'Sherman', templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, maxSpeed: 35, direction: 1 } } },
  }, gunBase);
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
    // Its own `setVehicleIconPos` and -- deliberately -- no
    // `setHasTurretIcon`. Both verbatim from `Objects/Vehicles/Land/Sherman/
    // Objects.con`: the word is declared on the ROOT only (VHUD-9), so a hull
    // gunner gets a dot but no dial.
    hud: { vehicleIcon: 'Vehicle/Icon_sherman.tga', vehicleIconPos: [32, 61] },
  }, gunYaw, gunEntry);
  return node('Sherman', {
    control: 'Sherman', templateKind: 'PlayerControlObject',
    hud: {
      hitpoints: 105, maxHitpoints: 105, vehicleIcon: 'Vehicle/Icon_sherman.tga',
      hasTurretIcon: true, vehicleIconPos: [54, 103],
    },
  }, engine, tower, rootEntryA, hullGunner);
}

/** The same Sherman with the hull gunner's `setVehicleIconPos` stripped: a
 *  half-re-extracted tree, where one PCO carries a position and one does
 *  not. The seat-dot decision is per dot, not per vehicle. */
function shermanWithOneUnplacedSeat() {
  const root = sherman();
  root.traverse(o => {
    if (o.name === 'shermanBrowning_PCO1') delete o.userData.hud.vehicleIconPos;
  });
  return root;
}

/** A casemate hull: a fixed gun in the glacis, no turret, and so no
 *  `setHasTurretIcon` anywhere in its `.con` -- the Wespe's own shape, whose
 *  root declares `setVehicleIconPos 55/94` and nothing else of interest here.
 *  It still has an aim rig (the gun traverses a little inside its mantlet),
 *  which is exactly why "the seat has a traverse" was the wrong trigger. */
function wespe() {
  const engine = node('WespeEngine', {
    templateKind: 'Engine', physics: { engineType: 'c_ETTank' },
  });
  const gunBase = node('WespeGunBase', {
    control: 'Wespe', templateKind: 'RotationalBundle',
    rig: { axes: {
      yaw: { input: 'c_PIMouseLookX', min: -15, max: 15, free: false, maxSpeed: 20, direction: 1 },
      pitch: { input: 'c_PIMouseLookY', min: -5, max: 40, free: false, maxSpeed: 15, direction: 1 },
    } },
  }, node('WespeGunBarrel', {
    templateKind: 'FireArms', fireArms: { magSize: 20, numOfMag: 1, roundOfFire: 0.2 },
  }), node('WespeCamera', { templateKind: 'Camera', control: 'Wespe' }));
  const entry = node('WespeEntry', {
    control: 'Wespe', templateKind: 'EntryPoint',
    seat: { control: 'Wespe', entryRadius: 3.6 },
  });
  return node('Wespe', {
    control: 'Wespe', templateKind: 'PlayerControlObject',
    hud: { hitpoints: 80, maxHitpoints: 80, vehicleIcon: 'Vehicle/Icon_wespe.tga',
           vehicleIconPos: [55, 94] },
  }, engine, gunBase, entry);
}

/** Six PlayerControlObjects, six dots. The Hanomag's own icon positions,
 *  read out of `Objects/Vehicles/Land/Hanomag/Objects.con`: root `39/75`,
 *  `Hanomag_MG42_PCO1` `40/65`, then four passengers at `30/59`, `41/55`,
 *  `20/49`, `31/45`. Nothing else about the vehicle matters here. */
function hanomag() {
  const POSITIONS = [
    ['Hanomag', [39, 75]],
    ['Hanomag_MG42_PCO1', [40, 65]],
    ['Hanomag_Passanger_PCO2', [30, 59]],
    ['Hanomag_Passanger_PCO3', [41, 55]],
    ['Hanomag_Passanger_PCO4', [20, 49]],
    ['Hanomag_Passanger_PCO5', [31, 45]],
  ];
  const seats = POSITIONS.slice(1).map(([id, pos]) => node(id, {
    control: id, templateKind: 'PlayerControlObject',
    hud: { vehicleIcon: 'Vehicle/Icon_hanomag.tga', vehicleIconPos: pos },
  }, node(`${id}_Entry`, {
    control: id, templateKind: 'EntryPoint', seat: { control: id, entryRadius: 3 },
  })));
  return node('Hanomag', {
    control: 'Hanomag', templateKind: 'PlayerControlObject',
    hud: { hitpoints: 100, maxHitpoints: 100, vehicleIcon: 'Vehicle/Icon_hanomag.tga',
           vehicleIconPos: POSITIONS[0][1] },
  }, node('HanomagEngine', { templateKind: 'Engine', physics: { engineType: 'c_ETCar' } }),
     node('HanomagEntry', {
       control: 'Hanomag', templateKind: 'EntryPoint',
       seat: { control: 'Hanomag', entryRadius: 3 },
     }),
     ...seats);
}

/** The V-100's own shape, and the reason `surveyVehicle` has a preference
 *  rule at all: one driving seat declaring a steered front axle AND a turret,
 *  with the wheels traversed first. Both are `RotationalBundle`s under the
 *  same control and both want the `yaw` slot, so first-wins handed it to
 *  `V-100FrontWheelR` and left `V-100Turret` unreachable. Thirteen vehicles
 *  across vanilla and the mods have this shape (M3GMC's turret against its
 *  steering; the M113 family's and the LVT4's `pitch` against a gun-hatch or
 *  ramp animation), so it is a rule, not a one-off. The elevation axis is
 *  here too, to pin what the rig may and may not claim. */
function mixedAxisCar() {
  const engine = node('V-100Engine', {
    control: 'V-100', templateKind: 'Engine', physics: { engineType: 'c_ETCar' },
  });
  const wheelR = node('V-100FrontWheelR', {
    control: 'V-100', templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIYaw', min: -40, max: 40, free: false, maxSpeed: 2, direction: 1 } } },
  });
  const wheelL = node('V-100FrontWheelL', {
    control: 'V-100', templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIYaw', min: -40, max: 40, free: false, maxSpeed: 2, direction: 1 } } },
  });
  // Declared LAST, exactly as the glb traverses it.
  const turret = node('V-100Turret', {
    control: 'V-100', templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, maxSpeed: 50, direction: 1 } } },
  });
  const gunBase = node('V-100GunBase', {
    control: 'V-100', templateKind: 'RotationalBundle',
    rig: { axes: { pitch: { input: 'c_PIMouseLookY', min: -15, max: 40, free: false, maxSpeed: 40, direction: 1 } } },
  });
  const entry = node('V-100Entry', {
    control: 'V-100', templateKind: 'EntryPoint',
    seat: { control: 'V-100', entryRadius: 3 },
  });
  turret.add(gunBase);
  return node('V-100', {
    control: 'V-100', templateKind: 'PlayerControlObject',
  }, engine, wheelR, wheelL, turret, entry);
}

/** A jeep: a steered front axle and nothing the mouse reaches. Willy's shape,
 *  the negative case for `hasAimAxes`. */
function jeep() {
  const engine = node('WillyEngine', {
    control: 'Willy', templateKind: 'Engine', physics: { engineType: 'c_ETCar' },
  });
  const steer = node('WillyWheel1', {
    control: 'Willy', templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIYaw', min: -35, max: 35, free: false, maxSpeed: 2, direction: 1 } } },
  });
  const entry = node('WillyEntry', {
    control: 'Willy', templateKind: 'EntryPoint',
    seat: { control: 'Willy', entryRadius: 2.3 },
  });
  return node('Willy', {
    control: 'Willy', templateKind: 'PlayerControlObject',
  }, engine, steer, entry);
}

/** Stationary Browning: Point is traversed first and declares both axes, but
 *  pitch is a dummy (`maxSpeed: 0`). Rotation owns the real elevation. Without
 *  a maxSpeed preference the pitch slot sticks on Point and elevation is dead. */
function stationaryBrowning() {
  const point = node('StationaryBrowningPoint', {
    control: 'Stationary_Browning', templateKind: 'RotationalBundle',
    rig: {
      axes: {
        yaw: { input: 'c_PIMouseLookX', min: -70, max: 70, free: false, maxSpeed: 90, direction: 1 },
        pitch: { input: 'c_PIMouseLookY', min: null, max: null, free: true, maxSpeed: 0, direction: 1 },
      },
    },
  });
  const rotation = node('StationaryBrowningRotation', {
    control: 'Stationary_Browning', templateKind: 'RotationalBundle',
    rig: {
      axes: {
        yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, maxSpeed: 0, direction: 1 },
        pitch: { input: 'c_PIMouseLookY', min: -70, max: 30, free: false, maxSpeed: 90, direction: 1 },
      },
    },
  });
  const arms = node('Browning_unlimited', {
    control: 'Stationary_Browning', templateKind: 'FireArms',
    fireArms: { input: 'c_PIFire', magSize: -1 },
  });
  const cam = node('StationaryBrowningCamera', {
    control: 'Stationary_Browning', templateKind: 'Camera',
  });
  const entry = node('StationaryBrowningEntry', {
    control: 'Stationary_Browning', templateKind: 'EntryPoint',
    seat: { control: 'Stationary_Browning', entryRadius: 2 },
  });
  point.add(rotation);
  rotation.add(arms);
  rotation.add(cam);
  return node('Stationary_Browning', {
    control: 'Stationary_Browning', templateKind: 'PlayerControlObject',
  }, point, entry);
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
    // `c_ETShip`. The engine has no ship propulsion code at all: `c_ETShip = 9`
    // has bit 0 set (`operator<<(std::ostream&, EngineType)` `0x0823ef60`), so
    // `PhysicsEngine::updatePhysics` runs the SAME thrust body an aeroplane
    // gets. A helm is a drive seat, not a passenger seat.
    shipRoot: classifyRoot(node('Fletcher',
      { control: 'Fletcher', templateKind: 'PlayerControlObject' },
      node('Fletcher_Engine', {
        templateKind: 'Engine', physics: { engineType: 'c_ETShip' },
        control: 'Fletcher' }),
      node('FletcherEntry', { templateKind: 'EntryPoint',
        seat: { control: 'Fletcher', entryRadius: 3 } }))),
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
  // reaches into flight.js/wheeled-vehicle.js itself (that seam is the whole point of
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
    // The driving seat of a tank aims its own main gun: two axes, the tower's
    // free traverse and the gun base's elevation, both `c_PIMouseLookX/Y`.
    rootTurretIsRig: rootTurret instanceof TurretRig,
    rootTurretAxes: rootTurret ? rootTurret.axes.map(a => a.axisName).sort() : null,
    rootTurretFreeYaw: !!rootTurret?.axes.find(a => a.axisName === 'yaw')?.spec.free,
    gunnerTurretIsRig: gunnerTurret instanceof TurretRig,
    gunnerAxisCount: gunnerTurret.axes.length,
    gunnerFireArms,
    rootHudIcon: rootHud.vehicleIcon,
    // R2-31 (verify-r2.md, corrected): hitpoints/armor is the ROOT's alone.
    // `shermanBrowning_PCO1` really does declare its own `setVehicleIcon` and
    // `setVehicleIconPos` -- both verbatim in `Objects.con` -- so `activeHud()`
    // returns the SEAT's block, not the root's, and it is the absence of
    // hitpoints in that block that keeps the invariant. `feedVehicleHud`
    // reads them off `seatInfo(rootId)` for that reason.
    gunnerHudIcon: gunnerHud.vehicleIcon,
    gunnerHudHasNoHitpoints: gunnerHud.hitpoints === undefined,
    rootHudHitpoints: rootHud.hitpoints,
    // A seat that declares no block of its own still falls back to the root's
    // -- the Hanomag's passengers do declare one, but a Defgun-style single
    // seat vehicle has only the one block for `activeHud()` to find.
    gunnerFallsBackWhenItHasNone: (() => {
      const bare = new VehicleOccupancy(defgun());
      bare.setActiveSeat(bare.rootId);
      return bare.activeHud() === bare.seatInfo(bare.rootId).hud;
    })(),
    exitLocationFallsBackToRoot: occ.exitLocationNode() === occ.root,
  };

  // A rig per seat, kept: traverse the tower, climb to the hull gun and back,
  // and the tower must still be where it was left. Before the rigs were
  // cached, `setActiveSeat` built a fresh one whose angle started at zero.
  const held = new VehicleOccupancy(sherman(), { GroundVehicle: FakeDrive });
  held.setActiveSeat(held.rootId);
  const towerAxis = held.turret.axes.find(a => a.axisName === 'yaw');
  // 60 frames at full right: with the 4x-scaled acceleration the turret
  // reaches ~140 deg/s in under half a second, so 60 frames (~2 s) puts it
  // well past the 30-deg threshold the test below asserts on, without wrapping
  // the free yaw axis past its ±180 bound (which 120 frames did once the ramp
  // got faster).
  for (let i = 0; i < 60; i++) { held.turret.aim(120, 0); held.turret.step(1 / 60); }
  const traversed = round(towerAxis.angle, 2);
  held.setActiveSeat(held.seatIdAt(1));
  const rigWhileAway = held.turret;
  held.setActiveSeat(held.rootId);
  results.turretAcrossSeats = {
    traversed,
    rigWhileAwayIsTheGunners: rigWhileAway !== held.turret,
    sameRigOnReturn: held.turret.axes.find(a => a.axisName === 'yaw') === towerAxis,
    angleOnReturn: round(held.turret.axes.find(a => a.axisName === 'yaw').angle, 2),
  };

  // Mouse right traverses right. `aim` takes the browser's screen sense, and
  // `_apply` puts the node's own rotation through RIG_SIGN; negating at the
  // call site as well (which `lookDelta` used to do) inverted every gun.
  const sense = new VehicleOccupancy(sherman(), { GroundVehicle: FakeDrive });
  sense.setActiveSeat(sense.rootId);
  const towerNode = sense.turret.axes.find(a => a.axisName === 'yaw').node;
  for (let i = 0; i < 60; i++) { sense.turret.aim(120, 0); sense.turret.step(1 / 60); }
  const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(towerNode.quaternion);
  // +X is the vehicle's own right (TANK-10/12's `side` convention).
  results.aimSense = { rightwardsX: round(facing.x, 3) };

  // What the rig claims, and what it leaves alone.
  const mixed = new VehicleOccupancy(mixedAxisCar(), { GroundVehicle: FakeDrive });
  mixed.setActiveSeat(mixed.rootId);
  const jeepOcc = new VehicleOccupancy(jeep(), { GroundVehicle: FakeDrive });
  jeepOcc.setActiveSeat(jeepOcc.rootId);
  const browning = new VehicleOccupancy(stationaryBrowning());
  browning.setActiveSeat(browning.rootId);
  // Same-axis-same-input: the V-100's steered wheels (`c_PIYaw`) must NOT be
  // peered under the turret (`c_PIMouseLookX`), even though they lose the same
  // `yaw` slot. The slot winner still replaces; only the peering is gated.
  const mixedYaw = mixed.seatInfo(mixed.rootId).axes.yaw;
  results.aimAxisSelection = {
    shermanRootHasAim: hasAimAxes(occ.seatInfo(occ.rootId)),
    mixedHasAim: hasAimAxes(mixed.seatInfo(mixed.rootId)),
    mixedRigAxes: mixed.turret.axes.map(a => a.axisName).sort(),
    mixedRigInputs: mixed.turret.axes.map(a => a.spec.input).sort(),
    mixedRigNodes: mixed.turret.axes.map(a => a.node.name).sort(),
    // The steering bundles are still there for `applyRig` to pose; losing the
    // `seat.axes` slot costs them nothing, because nothing but the aim rig
    // reads that map.
    mixedYawSlotNode: mixedYaw.node.name,
    mixedYawPeers: (mixedYaw.peers || []).map(n => n.name).sort(),
    mixedYawPeerCount: (mixedYaw.peers || []).length,
    jeepHasAim: hasAimAxes(jeepOcc.seatInfo(jeepOcc.rootId)),
    jeepTurretNull: jeepOcc.turret === null,
    aimInputs: AIM_INPUTS,
    browningYawNode: browning.seatInfo(browning.rootId).axes.yaw.node.name,
    browningPitchNode: browning.seatInfo(browning.rootId).axes.pitch.node.name,
  };

  // Fletcher dual-turret shape (Issue 4): two identical-spec bundles under the
  // same PCO and same axis/input. Both land in `peers`; a single TurretAxis
  // drives both; the helper unwraps winner-first for `cameraRidesTurret`.
  {
    const fwd = node('Fletcher_cannon', {
      control: 'Fletcher', templateKind: 'RotationalBundle',
      rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, maxSpeed: 30, direction: 1 } } },
    });
    const fwdFront = node('Fletcher_cannon_Front', {
      control: 'Fletcher', templateKind: 'RotationalBundle',
      rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, maxSpeed: 30, direction: 1 } } },
    });
    const engine = node('Fletcher_Engine', {
      control: 'Fletcher', templateKind: 'Engine', physics: { engineType: 'c_ETShip' },
    });
    const entry = node('FletcherEntry', {
      control: 'Fletcher', templateKind: 'EntryPoint',
      seat: { control: 'Fletcher', entryRadius: 3 },
    });
    const fletcher = node('Fletcher', {
      control: 'Fletcher', templateKind: 'PlayerControlObject',
    }, engine, fwd, fwdFront, entry);
    const survey = surveyVehicle(fletcher);
    const yawEntry = survey.seats.get('Fletcher').axes.yaw;
    const peerNames = (yawEntry.peers || []).map(n => n.name).sort();
    const occF = new VehicleOccupancy(fletcher);
    occF.setActiveSeat(occF.rootId);
    const rigAxis = occF.turret.axes.find(a => a.axisName === 'yaw');
    // Step the single rig axis and confirm both peers follow by the same delta.
    const q0fwd = fwd.quaternion.clone();
    const q0front = fwdFront.quaternion.clone();
    occF.turret.aim(1, 0);
    occF.turret.step(1 / 30);
    const movedFwd = fwd.quaternion.angleTo(q0fwd);
    const movedFront = fwdFront.quaternion.angleTo(q0front);
    results.dualTurret = {
      yawPeerNames: peerNames,
      yawPeerCount: (yawEntry.peers || []).length,
      yawSlotNode: yawEntry.node.name,
      yawSlotInput: yawEntry.spec.input,
      singleRigAxis: occF.turret.axes.filter(a => a.axisName === 'yaw').length,
      rigPeerCount: rigAxis ? rigAxis.peers.length : 0,
      bothPeersMove: movedFwd > 1e-6 && movedFront > 1e-6,
      peersMoveTogether: Math.abs(movedFwd - movedFront) < 1e-9,
      helperSeat: turretPeerNodes(survey.seats.get('Fletcher'), 'yaw').map(n => n.name).sort(),
      helperAxis: axisPeerNodes(yawEntry).map(n => n.name).sort(),
      helperMissingAxis: turretPeerNodes(survey.seats.get('Fletcher'), 'pitch').length,
    };
  }
}

// --- the vehicle HUD: the dial's trigger and the seat dots -------------------

{
  class FakeDrive {
    constructor(root) { this.root = root; this.control = root.name; }
  }
  const tank = new VehicleOccupancy(sherman(), { GroundVehicle: FakeDrive });
  tank.setActiveSeat(tank.rootId);
  const driverInside = tank.showsTurretIcon(true);
  const driverChase = tank.showsTurretIcon(false);
  const driverDots = tank.seatDots();
  tank.setActiveSeat(tank.seatIdAt(1));
  const gunnerInside = tank.showsTurretIcon(true);
  const gunnerDots = tank.seatDots();

  const casemate = new VehicleOccupancy(wespe(), { GroundVehicle: FakeDrive });
  casemate.setActiveSeat(casemate.rootId);

  const apc = new VehicleOccupancy(hanomag(), { GroundVehicle: FakeDrive });
  apc.setActiveSeat(apc.seatIdAt(2));

  // A scene baked before `con.py` learned `setHasTurretIcon`: the field is
  // simply absent, and absent must read as "no dial", not as "unknown, so
  // show it anyway".
  const stale = new VehicleOccupancy(defgun());
  stale.setActiveSeat(stale.rootId);

  results.turretIconTrigger = {
    driverInside,
    driverChase,
    gunnerInside,
    casemateInside: casemate.showsTurretIcon(true),
    casemateHasAim: hasAimAxes(casemate.seatInfo(casemate.rootId)),
    staleExtractInside: stale.showsTurretIcon(true),
  };
  results.seatDots = {
    shermanFromTheDriversSeat: driverDots,
    shermanFromTheGunnersSeat: gunnerDots,
    hanomagFromTheThirdSeat: apc.seatDots(),
    // Six leaves in the layout, six `VehiclePosX1..6` pairs in the engine.
    hanomagSeatCount: apc.order.length,
    // A seat with no position in its extract is VHUD-2's state 0 -- "draws
    // nothing" -- not a live dot with a null position. The layout's own rects
    // are that variable pair's authored placeholders, not seat positions.
    defgunDots: stale.seatDots(),
    // Half a re-extract: the root carries its position, the seat does not.
    // The decision is per dot.
    mixedFromTheRoot: (() => {
      const mixed = new VehicleOccupancy(shermanWithOneUnplacedSeat());
      mixed.setActiveSeat(mixed.rootId);
      return mixed.seatDots();
    })(),
    // The live-occupancy half (wave 4): `tank` is sitting in the gunner's
    // seat (position 1) when these run, so the driver's seat is the one an
    // occupant row can fill.
    shermanGunnerWithFriendDriver: tank.seatDots([{ seat: 0, team: 1 }], 1),
    shermanGunnerWithEnemyDriver: tank.seatDots([{ seat: 0, team: 2 }], 1),
    shermanGunnerRowOnTheLocalSeat: tank.seatDots([{ seat: 1, team: 2 }], 1),
    // `apc` sits in position 2 of the six-seat Hanomag; two enemy passengers
    // in the driver's and the fourth passenger's seats.
    hanomagCrew: apc.seatDots(
      [{ seat: 0, team: 1 }, { seat: 4, team: 1 }], 2),
  };
}

// --- TurretAxis: the engine's velocity servo (GUN-2 + GUN-2b) ---------------

{
  // The engine's own step. LOOP-1: a fixed 30 Hz tick, `dt = 1/30` exactly,
  // and `map.html` now runs the servo on it rather than on the render dt.
  const DT = 1 / 30;
  const TICKS = seconds => Math.round(seconds * 30);

  // The real numbers, read out of `Objects.rfa` this round:
  //   ShermanTower        setMaxSpeed 35/25/0  setAcceleration 1000/0/0
  //                       no setMinRotation / setMaxRotation  -> free
  //   StationaryMG42Point setMaxSpeed 70/0/0   setAcceleration 5000/0/0
  //                       setMinRotation -70/0/0  setMaxRotation 70/0/0
  const SHERMAN_YAW = {
    input: 'c_PIMouseLookX', free: true, min: null, max: null,
    maxSpeed: 35, acceleration: 1000, direction: 1,
  };
  const MG42_YAW = {
    input: 'c_PIMouseLookX', free: false, min: -70, max: 70,
    maxSpeed: 70, acceleration: 5000, direction: 1,
  };
  // `PlayerInput[c_PIMouseLookX]` for a hand moving `counts` a second at the
  // shipped LandSea sensitivity: `0.001 * counts * (5*0.25 + 0.1)`. Every
  // stationary weapon and gunner seat in vanilla is on that profile
  // (`mouse-input.js`, the `setVehicleCategory` survey).
  const SHIPPED_SCALE = 5 * 0.25 + 0.1;
  const axisAt = counts => 0.001 * counts * SHIPPED_SCALE;

  /** Hold a steady axis value for `seconds`, then let go for `coast`.
   *  The value is SET, not accumulated: the engine hands the same number to
   *  every tick of a frame and replaces it at the next pump. Travel is
   *  unwrapped so a free axis's +-360 correction does not truncate it. */
  function drive(spec, input, seconds, coast = 0) {
    const axis = new TurretAxis('yaw', node('Driven', {}), spec);
    let travel = 0, prev = 0, held = 0;
    const tick = () => {
      axis.step(DT);
      let d = axis.angle - prev;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      travel += Math.abs(d);
      prev = axis.angle;
    };
    axis.setInput(input);
    for (let i = 0; i < TICKS(seconds); i++) tick();
    held = travel;
    axis.setInput(0);
    for (let i = 0; i < TICKS(coast); i++) tick();
    return { axis, travel, held, coast: travel - held };
  }

  // The servo's steady state: `speed -> input * maxSpeed`, with no clamp on
  // the input at all. Input 1 is exactly `maxSpeed`; the shipped scale at
  // 1000 counts a second is 1.35, so a Sherman tower really is commanded at
  // 47.25 deg/s and an MG42 at 94.5.
  const shermanUnit = drive(SHERMAN_YAW, 1, 2.0);
  const shermanThousand = drive(SHERMAN_YAW, axisAt(1000), 2.0);
  // Half a second for the MG42: at 94.5 deg/s a full two would run this
  // widened copy into its +-180 bound and measure the stop, not the rate.
  const mg42Thousand = drive({ ...MG42_YAW, min: -180, max: 180 },
    axisAt(1000), 0.5);
  // ...and an input above 1 commands MORE than `setMaxSpeed`, right up to the
  // wire's own +-16. The old model clamped here and could not.
  const shermanFast = drive(SHERMAN_YAW, 4, 1.0);

  // The ramp: `speed` winds up at |acceleration| deg/s^2 -- the axis's own
  // `setAcceleration`, unscaled by anything now -- until it reaches the
  // commanded rate. An axis with no `setAcceleration` in its extract falls
  // back to `TURRET_ACCELERATION`.
  function speedAfter(spec, seconds, input = 1) {
    const a = new TurretAxis('yaw', node('WindUp', {}), spec);
    a.setInput(input);
    for (let i = 0; i < TICKS(seconds); i++) a.step(DT);
    return a.speed;
  }
  const ownAccel = { free: true, maxSpeed: 35, direction: 1, acceleration: 350 };
  const fallbackAccel = { free: true, maxSpeed: 35, direction: 1 };

  // Release: the engine has no bank, so the only thing left after the hand
  // stops is the velocity register ramping down.
  const flick = new TurretAxis('yaw', node('Flick', {}), SHERMAN_YAW);
  flick.setInput(1);
  flick.step(DT);
  const flickTick = flick.angle;
  flick.setInput(0);
  let flickAfter = 0, prevF = flick.angle;
  for (let i = 0; i < 30; i++) {
    flick.step(DT);
    flickAfter += Math.abs(flick.angle - prevF);
    prevF = flick.angle;
  }

  // The clamp, in the engine's own order: `> max` first, `< min` second, on
  // the authored components, with nothing zeroing the speed register.
  const clamped = drive(MG42_YAW, 5, 5.0);
  const clampedAtMax = round(clamped.axis.angle, 4);
  // ...and the reverse works straight off the stop: one second back at
  // 350 deg/s would cover 350 degrees, so it runs into the far bound.
  clamped.axis.setInput(-5);
  for (let i = 0; i < 30; i++) clamped.axis.step(DT);
  const afterReverse = round(clamped.axis.angle, 2);

  // The wrap gate is BOTH BOUNDS ZERO, not a zero-width range (GUN-2). A
  // `min == max == 45` axis pins at 45; `con.py` now marks only the first
  // free, and `_clip` is what acts on it.
  const freeAxis = new TurretAxis('yaw', node('FreeAxis', {}),
    { free: true, min: null, max: null, maxSpeed: 90, direction: 1 });
  freeAxis.setInput(1);
  for (let i = 0; i < 400; i++) freeAxis.step(DT);
  const pinned = new TurretAxis('yaw', node('Pinned', {}),
    { free: false, min: 45, max: 45, maxSpeed: 90, direction: 1 });
  pinned.setInput(1);
  for (let i = 0; i < 400; i++) pinned.step(DT);

  // `continousRotationSpeed * dt`, added every tick in the non-automaticReset
  // path whatever the input is doing (GUN-2). Fed nothing at all here, so the
  // whole of the motion below is that term.
  const windmill = new TurretAxis('yaw', node('Windmill', {}),
    { free: true, min: null, max: null, maxSpeed: 110, acceleration: 10,
      direction: 1, continuousRotation: 12 });
  let windmillTravel = 0, prevW = 0;
  for (let i = 0; i < 30; i++) {
    windmill.step(DT);
    let d = windmill.angle - prevW;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    windmillTravel += d;
    prevW = windmill.angle;
  }
  // ...and it rides ON TOP of an input-driven traverse rather than replacing
  // it: same axis, same second, with a 60 deg/s ask held over.
  const both = new TurretAxis('yaw', node('Both', {}),
    { free: true, min: null, max: null, maxSpeed: 110, acceleration: 1e6,
      direction: 1, continuousRotation: 12 });
  both.setInput(60 / 110);
  let bothTravel = 0, prevB = 0;
  for (let i = 0; i < 30; i++) {
    both.step(DT);
    let d = both.angle - prevB;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    bothTravel += d;
    prevB = both.angle;
  }

  // `automaticReset`: the angle ramps STRAIGHT to `input * maxRotation` at
  // |acceleration| deg/s (a rate, not an acceleration), with no velocity
  // register and no continuous term -- and returns to zero at the same rate
  // when the hand lets go. A steering wheel, in other words.
  const wheelSpec = {
    input: 'c_PIMouseLookX', free: false, min: -60, max: 60,
    maxSpeed: 100, acceleration: 120, direction: 1, automaticReset: true,
  };
  const wheel = new TurretAxis('yaw', node('Wheel', {}), wheelSpec);
  wheel.setInput(1);
  for (let i = 0; i < 30; i++) wheel.step(DT);
  const wheelHeld = round(wheel.angle, 2);
  const wheelSpeedRegister = wheel.speed;
  wheel.setInput(0);
  for (let i = 0; i < 8; i++) wheel.step(DT);
  const wheelHalfWayHome = round(wheel.angle, 2);
  for (let i = 0; i < 30; i++) wheel.step(DT);
  const wheelHome = round(wheel.angle, 2);
  // One tick from rest moves exactly `|acceleration| * dt` degrees, which is
  // what makes this a rate law rather than an acceleration one.
  const wheelOne = new TurretAxis('yaw', node('WheelOne', {}), wheelSpec);
  wheelOne.setInput(1);
  wheelOne.step(DT);

  // HP-15: `RotationalBundle::handlePlayerInput` scales all three axes by 0.2
  // while the vehicle is critically damaged. The servo sees the scaled input,
  // so the steady rate is one fifth -- `map.html` passes the multiplier in.
  const healthy = drive(SHERMAN_YAW, 1, 2.0);
  const hurt = new TurretAxis('yaw', node('Hurt', {}), SHERMAN_YAW);
  hurt.setInput(1);
  let hurtTravel = 0, prevH = 0;
  for (let i = 0; i < 60; i++) {
    hurt.step(DT, 0.2);
    let d = hurt.angle - prevH;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    hurtTravel += Math.abs(d);
    prevH = hurt.angle;
  }

  // The same penalty at the RIG, the way `map.html` really drives it: the page
  // sets `rig.inputScale` from the hull's live Armor, calls `rig.aim(x, y)`
  // once per pumped frame with the engine axis pair, and then `step(dt)` with
  // no argument for each tick of that frame. Two wave-2 streams each added the
  // 0.2 -- one in `aim()`, one in `step()` -- and git merged both without a
  // conflict. Spent twice it would be 0.04; spent once it is 0.2 whatever the
  // hand is doing, which is what these three numbers pin. Built without a
  // seat: the rig is only its axes and its scale here.
  // The first 60 ticks are thrown away so the velocity register has settled:
  // a Sherman's 1000 deg/s^2 takes 0.56 s to reach the 560 deg/s that input 16
  // commands, and a ramp counted into the total is a ratio that is nearly but
  // not exactly a fifth.
  const rigTravel = (inputScale, input) => {
    const rig = Object.create(TurretRig.prototype);
    rig.axes = [new TurretAxis('yaw', node('RigYaw', {}), SHERMAN_YAW)];
    rig.inputScale = inputScale;
    let travel = 0, prev = 0;
    for (let i = 0; i < 120; i++) {
      rig.aim(input, 0);
      rig.step(DT);
      if (i === 59) { prev = rig.axes[0].angle; continue; }
      if (i < 60) continue;
      let d = rig.axes[0].angle - prev;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      travel += Math.abs(d);
      prev = rig.axes[0].angle;
    }
    return travel;
  };
  // 16 is the wire's own ceiling, i.e. the fastest hand the engine can encode.
  const rigHealthyFast = rigTravel(1, 16);
  const rigCriticalFast = rigTravel(0.2, 16);
  const rigCriticalSlow = rigTravel(0.2, 0.2) / rigTravel(1, 0.2);
  const rigWreck = rigTravel(0, 16);

  results.turretServo = {
    rigCriticalFastRatio: round(rigCriticalFast / rigHealthyFast, 3),
    rigCriticalSlowRatio: round(rigCriticalSlow, 3),
    rigWreckDegrees: round(rigWreck, 4),
    // Input 1 is exactly `setMaxSpeed`; 1000 counts a second at the shipped
    // sensitivity is 1.35 of them.
    shippedAxisAtThousandCounts: round(axisAt(1000), 6),
    shermanUnitDegPerSec: round(shermanUnit.travel / 2.0, 1),
    shermanMaxSpeed: 35,
    shermanThousandDegPerSec: round(shermanThousand.travel / 2.0, 2),
    shermanThousandExpected: round(35 * axisAt(1000), 2),
    mg42ThousandDegPerSec: round(mg42Thousand.travel / 0.5, 1),
    mg42ThousandExpected: round(70 * axisAt(1000), 2),
    // No +-1 clamp: input 4 really is four times `setMaxSpeed`. Read off the
    // velocity register, which is the commanded rate exactly once the ramp has
    // finished, rather than off the travel, which still carries it.
    shermanFastSteadySpeed: round(shermanFast.axis.speed, 4),
    ownAccelAtTenth: round(speedAfter(ownAccel, 0.1), 1),
    fallbackAccelAtTenth: round(speedAfter(fallbackAccel, 0.1), 1),
    fallbackAccelAtHalf: round(speedAfter(fallbackAccel, 0.5), 1),
    fallbackAcceleration: TURRET_ACCELERATION,
    // No bank: a one-frame flick turns the axis by one tick of servo, and
    // what follows is only the register ramping down.
    flickOneTickDegrees: round(flickTick, 3),
    flickCoastDegrees: round(flickAfter, 2),
    clampedAtMax,
    declaredMax: MG42_YAW.max,
    declaredMin: MG42_YAW.min,
    afterReverse,
    freeWrapped: freeAxis.angle <= 180 && freeAxis.angle >= -180,
    zeroWidthRangePins: round(pinned.angle, 4),
    continuousOnlyDegrees: round(windmillTravel, 2),
    continuousPlusInputDegrees: round(bothTravel, 2),
    wheelHeld,
    wheelMaxRotation: 60,
    wheelSpeedRegisterStaysZero: wheelSpeedRegister === 0,
    wheelHalfWayHome,
    wheelHome,
    wheelOneTickDegrees: round(wheelOne.angle, 4),
    wheelRatePerTick: round(120 * DT, 4),
    healthyDegrees: round(healthy.travel, 2),
    criticallyDamagedDegrees: round(hurtTravel, 2),
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

// --- seat pose animation strings (SEAT-9) ----------------------------------
//
// `Ub_PassengerInWilly`/`Lb_PassengerInWilly` name the animation states the
// engine's own `setUseSeat` resolves for a passenger seat. The driver seat has
// neither — it falls back to the soldier's own template. The survey must carry
// the strings through unchanged and leave them null on a seat that declares
// none.

{
  const passengerSeat = node('WillyPassengerSeat', {
    control: 'WillyPassenger', templateKind: 'SeatObject',
    seat: {
      control: 'WillyPassenger', entryRadius: 2.3,
      poseAnimation: { upperBody: 'Ub_PassengerInWilly', lowerBody: 'Lb_PassengerInWilly' },
    },
  });
  const entry = node('WillyEntry', {
    control: 'WillyPassenger', templateKind: 'EntryPoint',
    seat: { control: 'WillyPassenger', entryRadius: 2.3 },
  });
  const camera = node('WillyCamera', {
    control: 'WillyPassenger', templateKind: 'Camera',
    cameraView: { control: 'WillyPassenger', cvm: { CVMInside: true, CVMChase: false } },
  });
  const root = node('WillyPassengerSeatObj', {
    control: 'WillyPassenger', templateKind: 'SeatObject',
    seat: { control: 'WillyPassenger' },
  }, passengerSeat, entry, camera);
  const { seats } = surveyVehicle(root);
  const seat = seats.get('WillyPassenger');
  results.seatPose = {
    hasPoseAnimation: !!seat?.poseAnimation,
    upperBody: seat?.poseAnimation?.upperBody,
    lowerBody: seat?.poseAnimation?.lowerBody,
    cameraViewModes: seat?.cameraViewModes,
  };

  // The bare driver seat (from the jeep fixture) declares none.
  const { seats: driverSeats } = surveyVehicle(jeep());
  const driver = driverSeats.get('Willy');
  results.seatPose.driverHasNoPose = driver?.poseAnimation === null;
}

// A ship's ObjectSpawner craft: a nested PCO with a body (`physics.mass`) in
// the sea category leaves its carrier for the `spawners` group, world pose
// kept; a seat PCO (no mass) and a deck aircraft (VCAir) stay.
{
  const pco = (name, physics, ...kids) => node(name, { templateKind: 'PlayerControlObject', control: name, physics }, ...kids);
  const craft = pco('Daihatsu', { mass: 30000, vehicleCategory: 'VCSea' });
  craft.position.set(10, 2, -30);
  const seat = pco('HatsuzukiDeckMG42PCO', { vehicleCategory: 'VCSea' });
  const plane = pco('Zero', { mass: 2500, vehicleCategory: 'VCAir' });
  const ship = pco('Hatsuzuki', { mass: 1e6, vehicleCategory: 'VCSea' }, craft, seat, plane);
  ship.position.set(600, 90, -1400);
  ship.rotation.y = 0.5;
  const spawners = node('spawners', { kind: 'spawners' }, ship);
  const root = node('level', {}, spawners);
  root.updateMatrixWorld(true);
  const before = craft.getWorldPosition(new THREE.Vector3());
  const moved = detachSpawnedCraft(root);
  root.updateMatrixWorld(true);
  const after = craft.getWorldPosition(new THREE.Vector3());
  results.spawnedCraft = {
    moved: moved.map(o => o.name),
    craftParent: craft.parent?.name, seatParent: seat.parent?.name, planeParent: plane.parent?.name,
    drift: round(before.distanceTo(after), 6),
    roots: findAllVehicleRoots(root).map(o => o.name).sort(),
  };
}

process.stdout.write(JSON.stringify(results, null, 2));
