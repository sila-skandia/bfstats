// Drives `viewer/vehicle-instance.js` with the real `World` (world.mjs) and a
// stub drivetrain, on the Sherman's own seat shape (the fixture in
// `test_seats_harness.mjs`): one hull, one drive, however many occupants.
//
// Run by `tests/test_vehicle_instance.py`, on `test_world.py`'s module set.

import * as THREE from 'three';
import { World } from './world.mjs';
import { VehicleRegistry, mayEnterHull } from './vehicle-instance.js';
import { mannedByEnemy } from './bot-vehicle.js';

const results = {};

function node(name, userData, ...children) {
  const obj = new THREE.Object3D();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
}

/** The Sherman: a tank root whose driver aims the tower, and a nested hull
 *  gunner with his own Browning (transcribed as `test_seats_harness.mjs`). */
function sherman() {
  const engine = node('ShermanEngine', { templateKind: 'Engine', physics: { engineType: 'c_ETTank' } });
  const cannon = node('ShermanGunBarrel', { templateKind: 'FireArms', fireArms: { magSize: 30, numOfMag: 1, roundOfFire: 0.5 } });
  const gunBase = node('ShermanGunBase', {
    control: 'Sherman', templateKind: 'RotationalBundle',
    rig: { axes: { pitch: { input: 'c_PIMouseLookY', min: -20, max: 5, free: false, maxSpeed: 20, direction: 1 } } },
  }, cannon);
  const tower = node('ShermanTower', {
    control: 'Sherman', templateKind: 'RotationalBundle',
    rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: null, max: null, free: true, maxSpeed: 35, direction: 1 } } },
  }, gunBase);
  const rootEntry = node('ShermanEntry', { control: 'Sherman', templateKind: 'EntryPoint', seat: { control: 'Sherman', entryRadius: 3.6 } });
  const gunYaw = node('ShermanBrowningRot', {
    templateKind: 'RotationalBundle', control: 'shermanBrowning_PCO1',
    rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: 0, max: 0, free: true, maxSpeed: 60, direction: 1 } } },
  });
  const gunBarrel = node('Browning', { templateKind: 'FireArms', control: 'shermanBrowning_PCO1', fireArms: { magSize: 500, numOfMag: 1 } });
  const gunEntry = node('ShermanEntry_2', {
    control: 'shermanBrowning_PCO1', templateKind: 'EntryPoint', seat: { control: 'shermanBrowning_PCO1', entryRadius: 3.6 },
  });
  gunYaw.add(gunBarrel);
  const hullGunner = node('shermanBrowning_PCO1', {
    control: 'shermanBrowning_PCO1', templateKind: 'PlayerControlObject', hud: { vehicleIcon: 'Vehicle/Icon_sherman.tga' },
  }, gunYaw, gunEntry);
  return node('Sherman', { control: 'Sherman', templateKind: 'PlayerControlObject', hud: { hitpoints: 105 } },
    engine, tower, rootEntry, hullGunner);
}

/** A drivetrain stub with the `Vehicle` surface the world and the registry
 *  touch; every `integrate` is counted and records the throttle it saw. */
let drivesBuilt = 0;
class StubTank {
  constructor(root) {
    drivesBuilt++;
    this.node = root;
    this.inputs = new Map();
    this.integrations = 0;
    this.throttles = [];
    this.transforms = 0;
    this.state = {
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), throttle: 0,
      orientation: new THREE.Quaternion(), angularVelocity: new THREE.Vector3(),
    };
  }
  setInput(name, value) { this.inputs.set(name, value); }
  input(name) { return this.inputs.get(name) ?? 0; }
  integrate(dt) {
    this.integrations++;
    const t = this.input('c_PIThrottle');
    this.throttles.push(t);
    this.state.position.z -= t * 10 * dt;
  }
  applyTransform() { this.transforms++; }
  applyRig() {}
  setFirstPerson() {}
}

const collider = { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null };
const EXTRAS = {
  worldSize: 600,
  controlPoints: [{ name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] }],
  soldierSpawns: [{ name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] }],
  tickets: { 1: 100, 2: 100 },
};
const IDLE = { forward: 0, strafe: 0, forwardKeys: 0, rudder: 0, walk: false, crouch: false, prone: false,
               jump: false, fire: false, altFire: false, roll: 0, pitch: 0, pad: false };

const world = new World({ collider, extras: EXTRAS });
world.addPlayer('human', { team: 1 });
world.addBotPlayer('bot', { team: 1 });
world.addBotPlayer('bot2', { team: 1 });

const log = [];
const registry = new VehicleRegistry({
  classes: { TrackedVehicle: StubTank, GroundVehicle: StubTank },
  buildDrive: inst => inst.occupancy.ensureDrive(null, {}),
  world: () => world,
  adopt: () => log.push('adopt'),
  release: () => log.push('release'),
  thaw: () => log.push('thaw'),
  freeze: () => log.push('freeze'),
});

const tank = sherman();

// 1. A bot takes the wheel: the drive is built once, adopted, thawed.
const botSeat = registry.enter(tank, null, 'bot');
const drive = botSeat.instance.drive;
results.botSeat = { seatId: botSeat.seatId, isRoot: botSeat.isActiveRoot(), drive: !!drive, built: drivesBuilt, log: [...log] };

// 2. The human takes the gunner's seat: the SAME instance, the SAME drive.
const humanSeat = registry.enter(tank, 'shermanBrowning_PCO1', 'human');
results.humanSeat = {
  seatId: humanSeat.seatId, sameInstance: humanSeat.instance === botSeat.instance,
  sameDrive: humanSeat.drive === drive, built: drivesBuilt,
  worldVehicle: world.player('human').vehicle === drive,
  humanTurret: !!humanSeat.turret, botTurret: !!botSeat.turret,
  turretsDiffer: humanSeat.turret !== botSeat.turret,
  heldSeat: registry.enter(tank, 'shermanBrowning_PCO1', 'bot2'),
};

// 3. Thirty ticks, the bot at full throttle and the human pressing nothing:
//    one integration a tick, driven by the root seat's word.
for (let i = 0; i < 30; i++) {
  world.setInput('bot', { ...IDLE, forward: 1 });
  world.setInput('human', IDLE);
  world.step(1 / 30);
}
results.ticks = {
  integrations: drive.integrations,
  lastThrottle: drive.throttles.at(-1),
  moved: +(-drive.state.position.z).toFixed(3),
};

// 4. The human's gunner word never reaches the drive.
world.setInput('bot', IDLE);
world.setInput('human', { ...IDLE, forward: 1 });
world.step(1 / 30);
results.gunnerThrottle = drive.throttles.at(-1);

// 5. The driver climbs to... nowhere (the gunner's seat is held): refused.
results.switchHeld = registry.switchSeat('bot', 'shermanBrowning_PCO1');

// 6. The human leaves; the bot drives on, the hull stays driven.
log.length = 0;
const out = registry.leave('human');
results.humanLeft = {
  emptied: out.emptied, log: [...log], botStill: registry.seatOf('bot')?.seatId ?? null,
  driveKept: registry.seatOf('bot')?.drive === drive, worldCleared: world.player('human').occupancy === null,
};

// 7. The bot takes the gunner's seat: the hull does not move, the root seat
//    lets go of the controls, and the drive coasts under its first occupant.
const beforeSwitch = drive.integrations;
const switched = registry.switchSeat('bot', 'shermanBrowning_PCO1');
world.setInput('bot', { ...IDLE, forward: 1 });
world.step(1 / 30);
results.swap = {
  seatId: switched?.seatId ?? null, sameDrive: switched?.drive === drive,
  throttleReleased: drive.input('c_PIThrottle'), stepped: drive.integrations - beforeSwitch,
  built: drivesBuilt, rootHolder: registry.holder(tank, 'Sherman'),
};

// 8. The last one out parks the hull: pose written, body released, frozen,
//    and the instance forgotten.
log.length = 0;
const transformsBefore = drive.transforms;
// A wheel the drive has lifted by its compression, as `#applyWheels` leaves it.
const wheelNode = new THREE.Object3D();
wheelNode.position.set(1, -0.68, 2);
drive.wheels = [{ node: wheelNode, basePosition: wheelNode.position.clone(), baseQuaternion: wheelNode.quaternion.clone() }];
wheelNode.position.y += 0.14;
wheelNode.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);
const last = registry.leave('bot');
results.lastOut = {
  emptied: last.emptied, log: [...log], transformed: drive.transforms - transformsBefore,
  forgotten: registry.instanceOf(tank) === null,
  wheelY: wheelNode.position.y, wheelTurned: wheelNode.quaternion.w,
};

// 9. A gunner alone in a parked hull: no drive until someone drives.
const alone = registry.enter(tank, 'shermanBrowning_PCO1', 'human');
results.gunnerAlone = { drive: !!alone.drive, built: drivesBuilt };
const driver = registry.enter(tank, null, 'bot');
results.driverArrives = { drive: !!driver.drive, gunnerSeesIt: alone.drive === driver.drive, built: drivesBuilt };

// 10. The entry rule (features/vehicle-entry-team-rule, ledger SEAT-26/27):
//     the hull is its crew's side, nobody's when empty. `ghost` has no world
//     record, so no side: the page's free camera flying a vehicle.
{
  // Both sides need a flag: a player is spawned on one of his own team's,
  // and takes the flag's team when his has none (world-players.js).
  const w = new World({ collider, extras: {
    ...EXTRAS,
    controlPoints: [...EXTRAS.controlPoints, { name: 'South', spawnGroupId: 2, team: 2, position: [-10, 0, -10] }],
    soldierSpawns: [...EXTRAS.soldierSpawns, { name: 'S1', group: 2, team: 2, position: [-10, 0, -10], rotation: [0, 0, 0] }],
  } });
  w.addPlayer('ally', { team: 2 });
  w.addBotPlayer('ally2', { team: 2 });
  w.addBotPlayer('axis', { team: 1 });
  const reg = new VehicleRegistry({
    classes: { TrackedVehicle: StubTank, GroundVehicle: StubTank },
    buildDrive: inst => inst.occupancy.ensureDrive(null, {}),
    world: () => w,
  });
  const hull = sherman();
  const seats = () => Object.fromEntries(reg.instanceOf(hull)?.seats ?? []);
  const r = {};
  r.emptyTeam = reg.teamOf(hull);
  r.allyDrives = !!reg.enter(hull, null, 'ally');
  r.crewedTeam = reg.teamOf(hull);
  // The enemy at the free gunner's door: refused, and nothing moved.
  r.axisIntoGunner = reg.enter(hull, 'shermanBrowning_PCO1', 'axis') !== null;
  r.axisSeated = reg.seatOf('axis') !== null;
  r.seatsAfterRefusal = seats();
  r.friendIntoGunner = !!reg.enter(hull, 'shermanBrowning_PCO1', 'ally2');
  // The driver steps out: the gunner still crews it, the wheel stays barred.
  reg.leave('ally');
  r.teamWithGunnerOnly = reg.teamOf(hull);
  r.axisIntoFreeWheel = reg.enter(hull, null, 'axis') !== null;
  // The last one out: nobody's again, and the enemy may take it.
  const out = reg.leave('ally2');
  r.emptiedTeam = { emptied: out?.emptied ?? null, team: reg.teamOf(hull) };
  r.axisSteals = !!reg.enter(hull, null, 'axis');
  r.stolenTeam = reg.teamOf(hull);
  r.allyIntoStolen = reg.enter(hull, 'shermanBrowning_PCO1', 'ally') !== null;
  // No side passes and stamps nothing.
  r.ghostIntoGunner = !!reg.enter(hull, 'shermanBrowning_PCO1', 'ghost');
  r.teamAfterGhost = reg.teamOf(hull);
  // A refusal leaves the refused player where he sits.
  reg.leave('ghost');
  const other = sherman();
  reg.enter(other, null, 'ally');
  r.refusedFromAnotherHull = reg.enter(hull, 'shermanBrowning_PCO1', 'ally') !== null;
  r.stillInOther = reg.seatOf('ally')?.root === other;
  // A seat switch inside his own hull is not an entry: no rule.
  r.axisSwitchesInOwnHull = reg.switchSeat('axis', 'shermanBrowning_PCO1')?.seatId ?? null;
  results.team = r;
  results.teamRule = {
    mayEnterHull: [[0, 1], [0, 2], [2, 2], [2, 1], [1, 2], [2, 0], [0, 0]].map(([h, t]) => mayEnterHull(h, t)),
    mannedByEnemy: [[{ hullTeam: 2 }, 1], [{ hullTeam: 2 }, 2], [{ hullTeam: 0 }, 1], [{ hullTeam: 2 }, 0], [{}, 1]]
      .map(([c, t]) => mannedByEnemy(c, t)),
  };
}

process.stdout.write(JSON.stringify(results));
