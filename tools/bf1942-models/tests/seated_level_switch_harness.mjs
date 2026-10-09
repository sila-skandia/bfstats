// Pins the local player's side of a level switch: a seat he holds when the
// level goes ends with the level, through `leavePilot` (`local-player.js`),
// before the registry forgets the hulls (`VehicleRegistry.clear`).
//
// What the page did before: `show()` cleared the registry with the pilot box
// still ticked (`markPilot(true)` on the way into the seat) and then read the
// box again as the old free-fly shortcut -- `setPilot(true)` with no seat
// picks the level's first aircraft -- so a player who switched level from a
// Sherman came up seated in the next level's Zero: no soldier, no deploy
// screen (the briefing's READY opens it only with the box unticked), and no
// world record behind the seat, so `world-vehicle-tick.js` never ran for him
// and no gun he boarded from then on fired.
//
// The flow is the page's: the real `VehicleRegistry` and `World`, the real
// `createLocalPlayer` on a stub of what `setPilot`/`leaveSeat` read of the
// page, a Sherman on level A and a Zero on level B. `withFix` runs
// `leavePilot` -> `clear` -> new World; `control` runs the old sequence,
// `clear` -> new World -> `if (optPilot.checked) setPilot(true)`. Both then
// hold the trigger for a tick of level B's world.
//
// The viewer modules load straight out of `viewer/` through the runner's
// module hooks (`sim/env.mjs`). Run by `tests/test_seated_level_switch.py`.
// One JSON object on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [{ World }, { VehicleRegistry }, { createLocalPlayer }, THREE] = await Promise.all([
  imp('world.js'), imp('vehicle-instance.js'), imp('local-player.js'), imp('vendor/three.module.js'),
]);

function node(name, userData, ...children) {
  const obj = new THREE.Object3D();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
}

/** A tank root with one cannon (the Sherman's shape, cut to the root seat). */
function tank(name) {
  const engine = node(`${name}Engine`, { templateKind: 'Engine', physics: { engineType: 'c_ETTank' } });
  const cannon = node(`${name}GunBarrel`, { templateKind: 'FireArms', fireArms: { magSize: 30, numOfMag: 1, roundOfFire: 0.5 } });
  const entry = node(`${name}Entry`, { control: name, templateKind: 'EntryPoint', seat: { control: name, entryRadius: 3.6 } });
  return node(name, { control: name, templateKind: 'PlayerControlObject', hud: { hitpoints: 105 } }, engine, cannon, entry);
}

/** A fighter root: the first aircraft `pickVehicle` would hand the box. */
function fighter(name) {
  const engine = node(`${name}Engine`, { templateKind: 'Engine', physics: { engineType: 'c_ETPlane' } });
  const guns = node(`${name}Guns`, { templateKind: 'FireArms', fireArms: { magSize: 500, numOfMag: 1, roundOfFire: 0.1 } });
  const entry = node(`${name}Entry`, { control: name, templateKind: 'EntryPoint', seat: { control: name, entryRadius: 3.6 } });
  return node(name, { control: name, templateKind: 'PlayerControlObject', hud: { hitpoints: 60 } }, engine, guns, entry);
}

/** The drivetrain surface the world and the registry touch, counting the
 *  fire input it was handed. */
const drives = [];
class StubDrive {
  constructor(root) {
    drives.push(this);
    this.node = root;
    this.inputs = new Map();
    this.firePulls = 0;
    this.resets = 0;
    this.state = {
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), throttle: 0,
      orientation: new THREE.Quaternion(), angularVelocity: new THREE.Vector3(),
    };
  }
  setInput(name, value) { this.inputs.set(name, value); if (name === 'c_PIFire' && value > 0) this.firePulls++; }
  input(name) { return this.inputs.get(name) ?? 0; }
  integrate() {}
  applyTransform() {}
  applyRig() {}
  setFirstPerson() {}
  reset() { this.resets++; }
}

const collider = { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null };
const extrasOf = level => ({
  worldSize: 600, level,
  controlPoints: [{ name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] }],
  soldierSpawns: [{ name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] }],
  tickets: { 1: 100, 2: 100 },
});
const HELD_FIRE = { forward: 0, strafe: 0, forwardKeys: 0, rudder: 0, walk: false, crouch: false, prone: false,
                    jump: false, fire: true, altFire: false, roll: 0, pitch: 0, pad: false };

function session() {
  const s = {
    world: null, currentRoot: null,
    optPilot: { checked: false }, optOnFoot: { checked: false },
    log: [], netRows: [],
  };
  s.registry = new VehicleRegistry({
    classes: { TrackedVehicle: StubDrive, GroundVehicle: StubDrive, Aircraft: StubDrive },
    buildDrive: inst => inst.occupancy.ensureDrive(null, {}),
    world: () => s.world,
    adopt: () => s.log.push('adopt'), release: () => s.log.push('release'),
    thaw: () => s.log.push('thaw'), freeze: () => s.log.push('freeze'),
  });
  // What `setPilot`, `leaveSeat` and `mountLocalSeat` read of the page.
  const page = {
    LOCAL_PLAYER: 'local',
    camera: { fov: 60, near: 0.1 },
    get vehicles() { return s.registry; },
    get world() { return s.world; },
    get optPilot() { return s.optPilot; },
    get optOnFoot() { return s.optOnFoot; },
    view: null, viewFor: null, remoteCrewTeam: null,
    pickVehicle: () => s.currentRoot.children.find(c => c.userData.templateKind === 'PlayerControlObject') ?? null,
    netSeatRow: action => ({ action }),
    netSendAction: row => s.netRows.push(row.action),
    disposeSeatPose: () => s.log.push('disposeSeatPose'),
    clearVehicleHud: () => s.log.push('clearVehicleHud'),
    forgetSeatViews: () => s.log.push('forgetSeatViews'),
    rebuildVehicleInterp: () => {}, updateMobileControls: () => {},
    buildSeatView: () => {}, warmSubtree: () => {}, feedVehicleHud: () => {},
    loadSeatPose: () => {}, noteOccupiedVehicle: () => {},
  };
  s.localPlayer = createLocalPlayer(page);
  return s;
}

function levelA(s) {
  s.world = new World({ collider, extras: extrasOf('Bocage') });
  s.world.addPlayer('local', { team: 1 });
  s.currentRoot = node('Bocage', {}, tank('Sherman'));
  return s.currentRoot.children[0];
}
function levelB(s) {
  s.drivesAtLevel = drives.length;
  s.world = new World({ collider, extras: extrasOf('GuadalCanal') });
  s.currentRoot = node('GuadalCanal', {}, fighter('Zero'), tank('Sherman'));
}

function seatState(s) {
  const seat = s.localPlayer.occupancy;
  const record = s.world.player('local');
  return {
    seat: seat ? `${seat.root.name}:${seat.seatId}` : null,
    pilotBox: s.optPilot.checked,
    worldRecord: !!record,
    mounted: !!record?.occupancy,
  };
}

/** Level B's world, one tick with the trigger held, as the page's frame
 *  would feed it: a seat with a record behind it reaches `vehicleTick`. */
function holdFire(s) {
  const seated = drives.slice(s.drivesAtLevel);
  s.world.setInput('local', HELD_FIRE);
  s.world.step(1 / 30);
  return { drives: seated.length, firePulls: seated.reduce((n, d) => n + d.firePulls, 0) };
}

function run({ fix }) {
  const s = session();
  const sherman = levelA(s);
  // The E key's path into the Sherman's driver's seat: the pilot box is
  // marked and the seat taken (`vehicle-entry.js` `enterVehicle`).
  s.localPlayer.markPilot(true);
  s.localPlayer.setPilot(true, sherman, null);
  const before = seatState(s);
  const shermanDrive = s.localPlayer.occupancy?.drive ?? null;

  // The switch, in `level-load.js` `show()`'s order.
  if (fix) s.localPlayer.leavePilot();
  const afterLeave = seatState(s);
  s.registry.clear();
  levelB(s);
  if (s.optPilot.checked) s.localPlayer.setPilot(true);
  const after = seatState(s);
  const firePulls = holdFire(s);
  return {
    before, afterLeave, after,
    shermanReset: shermanDrive ? shermanDrive.resets : null,
    netRows: s.netRows,
    ...firePulls,
  };
}

const results = { withFix: run({ fix: true }), control: run({ fix: false }) };

// A deploy on level B after the fix: the soldier's seat is a fresh entry
// with a record behind it, and the trigger reaches the drive.
{
  const s = session();
  const sherman = levelA(s);
  s.localPlayer.markPilot(true);
  s.localPlayer.setPilot(true, sherman, null);
  s.localPlayer.leavePilot();
  s.registry.clear();
  levelB(s);
  s.world.addPlayer('local', { team: 1 });
  const shermanB = s.currentRoot.children.find(c => c.name === 'Sherman');
  s.localPlayer.markPilot(true);
  s.localPlayer.setPilot(true, shermanB, null);
  results.redeploy = { ...seatState(s), ...holdFire(s) };
}

console.log(JSON.stringify(results));
