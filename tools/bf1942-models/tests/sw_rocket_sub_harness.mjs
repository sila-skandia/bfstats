// Drives the Secret Weapons rocket and submarine rules outside a browser and
// prints one JSON blob (`tests/test_sw_rocket_sub.py`): an Engine's heat
// (`rocket-burn.js`, PHY-45), the ridden round (`rocket-ride.js`, FA-29,
// FA-30, CS-16, CAM-4), a boarded carrier's spawn points
// (`spawn-boarded.js`, SPAWN-39), the level's `templateWords`
// (`template-words.js`) and the submarine HUD's seat (`submarine-hud.js`,
// SUB-6).

import * as THREE from 'three';
import { EngineHeat, engineHeatSpec, recoverBar, HEAT_BAR_TYPES } from './rocket-burn.js';
import {
  createRocketRide, roundsLeft, tempCameraPose, vehicleShakeFrame, TEMP_CAMERA_LOOK_AHEAD,
} from './rocket-ride.js';
import { CameraShake } from './fire-shake.js';
import { FireState } from './fire-state.js';
import { shutsSpawnsOnEnter, spawnShutByBoarding } from './spawn-boarded.js';
import { applyTemplateWords, templateWordsOf } from './template-words.js';
import { isSubmarine } from './submarine-hud.js';
import { toolTipTypeOf } from './spawn-safety.js';

const out = {};

// --- the burn -------------------------------------------------------------
const NATTER = { heatIncrement: 0.0003, heatBarType: 'B', inverseHeatBar: true };
const ROCKET = { heatIncrement: 0.00084, heatBarType: 'B', inverseHeatBar: true };
function burnTicks(physics, revs) {
  const heat = new EngineHeat(engineHeatSpec(physics));
  let ticks = 0;
  while (!heat.burnt && ticks < 100000) { heat.step(revs, 1); ticks++; }
  return { ticks, heat: heat.heat, after: heat.step(revs, 1), bar: heat.bar };
}
out.burn = {
  none: engineHeatSpec({ torque: 5 }),
  ctor: engineHeatSpec({ heatIncrement: -1 }),
  spec: engineHeatSpec(NATTER),
  natter: burnTicks(NATTER, 1),
  rocket: burnTicks(ROCKET, 1),
  rocketFlatOut: burnTicks(ROCKET, 1.2),
  idle: burnTicks({ heatIncrement: 0.001 }, 0).ticks,
  types: HEAT_BAR_TYPES,
};
{
  const heat = new EngineHeat(engineHeatSpec(NATTER));
  const kept = heat.step(-0.8, 1000);            // |revs|: reverse heats too
  out.burn.half = { kept, heat: heat.heat, bar: heat.bar };
  const cool = new EngineHeat(engineHeatSpec({ heatIncrement: 0.1, coolingFactor: 0.15 }));
  cool.step(1, 1);                                // 0.1 - 0.15 < 0: floored at 0
  out.burn.cooled = cool.heat;
  const plain = new EngineHeat(engineHeatSpec({ heatIncrement: 0.5 }));
  plain.step(1, 1);
  out.burn.plainBar = plain.bar;                  // ctor type R, not inverted
  out.burn.recover = [
    recoverBar([{ heat: null }, { heat }]),
    recoverBar([{ heat: null }]),
    recoverBar(null),
  ];
}

// --- the shake and the temporary camera ---------------------------------------
const MG = [{ fadeIn: 0, fadeOut: 0, minFactor: 0, timeToShake: 0.1,
              pitch: [0.25, 900], roll: [0.5, 800], yaw: [0.25, 700],
              upDown: [0, 0], leftRight: [0, 0], inOut: [0, 0] }];
{
  const shake = new CameraShake();
  const frames = [];
  for (const dt of [1 / 60, 1 / 60, 1 / 30, 0.2]) {
    const o = {};
    const drawn = vehicleShakeFrame(shake, MG, dt, o);
    frames.push({ dt, drawn, pitch: o.pitch, yaw: o.yaw, roll: o.roll });
  }
  out.shake = frames;
}
{
  const m = new THREE.Matrix4().compose(new THREE.Vector3(100, 50, -20),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1));
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  tempCameraPose(m, 15, pos, quat);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  out.tempCamera = { pos: pos.toArray(), fwd: fwd.toArray(), ahead: TEMP_CAMERA_LOOK_AHEAD };
}

// --- the ride, against a page of fakes ----------------------------------------
function fakePage({ room = false, firer = 'local' } = {}) {
  const launcher = new THREE.Object3D(); launcher.name = 'Wasserfall';
  const rocket = new THREE.Object3D(); rocket.name = 'WasserfallRocket';
  rocket.userData.physics = { cameraDelayTime: 5, cameraDelayDistance: 15, vehicleCameraShake: 'CstMachinegun' };
  const guns = { onShot: null };
  const log = [];
  const page = {
    camera: new THREE.PerspectiveCamera(),
    guns, LOCAL_PLAYER: 'local', roomJoined: room, soldierDead: false,
    seatFire: false, seatAltFire: false,
    occupancy: { root: launcher, drive: null },
    fireStates: new Map(),
    fireStateFor: node => {
      if (!page.fireStates.has(node)) page.fireStates.set(node, new FireState(node.userData.fireArms));
      return page.fireStates.get(node);
    },
    footTriggerShakes: async () => ({ CstMachinegun: { cameraShake: MG } }),
    seatView: () => ({ firstPerson: true }),
    wrecked: node => !!node.userData.wreck,
    vehicles: {
      seatOfGroup: group => (group.owner ? { playerId: firer, root: group.owner, seatId: 'seat' } : null),
      holder: (root, seatId) => root.userData.heldBy ?? null,
    },
    roundSpawners: { standVehicle: (template, matrix) => { log.push(['stand', template]); rocket.matrix.copy(matrix); rocket.matrix.decompose(rocket.position, rocket.quaternion, rocket.scale); return rocket; } },
    enterVehicle: ({ vehicle }) => {
      log.push(['enter', vehicle.name]);
      page.occupancy = { root: vehicle, drive: vehicle === rocket ? { state: { velocity: new THREE.Vector3(), airspeed: 0 } } : null };
    },
    world: { damageableOf: root => root.userData.hull ?? null },
  };
  return { page, launcher, rocket, guns, log };
}
const LAUNCH = () => ({ position: new THREE.Vector3(10, 20, 30), quaternion: new THREE.Quaternion(),
                        velocity: new THREE.Vector3(0, 45, 0) });
const ROUND = { template: 'WasserfallRocket', vehicle: true };
{
  const { page, launcher, rocket, log } = fakePage();
  const ride = createRocketRide(page);
  const group = { owner: launcher };
  const took = ride.onVehicleRound(group, ROUND, LAUNCH());
  const before = ride.state();
  ride.frame(1 / 60);
  const riding = ride.state();
  const speed = page.occupancy.drive.state.velocity.toArray();
  // The shake's table arrives a microtask later.
  ride.shakeView(page.camera);
  await Promise.resolve(); await Promise.resolve();
  const q0 = page.camera.quaternion.clone();
  const undo = ride.shakeView(page.camera);
  const shaken = !page.camera.quaternion.equals(q0);
  undo?.();
  const restored = page.camera.quaternion.equals(q0);
  // The rocket dies with its rider aboard.
  rocket.position.set(0, 100, 0); rocket.updateMatrixWorld(true);
  const out1 = ride.rideOut(rocket);
  const back = page.occupancy.root === launcher;
  page.seatAltFire = true;                      // still held from the detonation
  ride.frame(1);
  const held = ride.state().linger;
  const eye = page.camera.position.toArray();
  page.seatAltFire = false; ride.frame(1);
  page.seatFire = true; ride.frame(0.5);        // a fresh press ends it
  const afterPress = ride.state().linger;
  out.ride = { took, before, riding, speed, shaken, restored, out1, back, held, eye, afterPress, log };
}
{
  // The time runs out by itself; and a second ride-out is nobody's.
  const { page, launcher, rocket } = fakePage();
  const ride = createRocketRide(page);
  ride.onVehicleRound({ owner: launcher }, ROUND, LAUNCH());
  ride.frame(1 / 30);
  ride.rideOut(rocket);
  let frames = 0;
  while (ride.state().linger != null && frames < 1000) { ride.frame(0.1); frames++; }
  out.lingerFrames = frames;
  out.secondRideOut = ride.rideOut(rocket);
}
{
  // Out by the use key: back in the launcher, no camera.
  const { page, launcher } = fakePage();
  const ride = createRocketRide(page);
  ride.onVehicleRound({ owner: launcher }, ROUND, LAUNCH());
  ride.frame(1 / 30);
  page.occupancy = null;
  ride.frame(1 / 30);
  out.useKey = { back: page.occupancy?.root === launcher, linger: ride.state().linger };
}
{
  // A launcher taken or destroyed meanwhile leaves the rider to the wreck.
  const a = fakePage();
  const rideA = createRocketRide(a.page);
  rideA.onVehicleRound({ owner: a.launcher }, ROUND, LAUNCH());
  rideA.frame(1 / 30);
  a.launcher.userData.wreck = true;
  const b = fakePage();
  const rideB = createRocketRide(b.page);
  rideB.onVehicleRound({ owner: b.launcher }, ROUND, LAUNCH());
  rideB.frame(1 / 30);
  b.launcher.userData.heldBy = 'bot1';
  out.noLauncher = [rideA.rideOut(a.rocket), rideB.rideOut(b.rocket)];
}
out.refused = {
  room: createRocketRide(fakePage({ room: true }).page).onVehicleRound({ owner: new THREE.Object3D() }, ROUND, LAUNCH()),
  bot: (() => { const f = fakePage({ firer: 'bot3' }); return createRocketRide(f.page).onVehicleRound({ owner: f.launcher }, ROUND, LAUNCH()); })(),
  plain: (() => { const f = fakePage(); return createRocketRide(f.page).onVehicleRound({ owner: f.launcher }, { template: 'Shell' }, LAUNCH()); })(),
  noModel: (() => { const f = fakePage(); f.page.roundSpawners.standVehicle = () => null; return createRocketRide(f.page).onVehicleRound({ owner: f.launcher }, ROUND, LAUNCH()); })(),
};
{
  // FA-30: the last round of a `destroyVehicleWhenNoAmmo` gun kills its root.
  const { page, rocket, guns } = fakePage();
  createRocketRide(page);
  const hits = [];
  rocket.userData.hull = { destroyed: false, damage: d => hits.push(d) };
  const warhead = new THREE.Object3D();
  warhead.userData.fireArms = { magSize: 1, numOfMag: 1, destroyVehicleWhenNoAmmo: true };
  const plain = new THREE.Object3D();
  plain.userData.fireArms = { magSize: 1, numOfMag: 1 };
  const twoRounds = new THREE.Object3D();
  twoRounds.userData.fireArms = { magSize: 2, numOfMag: 1, destroyVehicleWhenNoAmmo: true };
  guns.onShot({ node: plain, owner: rocket }, 1);
  const afterPlain = hits.length;
  guns.onShot({ node: twoRounds, owner: rocket }, 1);
  const afterFirstOfTwo = hits.length;
  guns.onShot({ node: warhead, owner: rocket }, 1);
  out.warhead = { afterPlain, afterFirstOfTwo, hits };
  const st = new FireState({ magSize: 30, numOfMag: 2 });
  out.rounds = { full: roundsLeft(st), none: roundsLeft(null), unlimited: roundsLeft(new FireState({ magSize: -1, numOfMag: 999 })) };
}

{
  // In a room: the room's own round is stood as the prediction, the room is
  // told, and the seats it gives are followed without seat rows of the page's.
  const { page, launcher, rocket, guns, log } = fakePage({ room: true });
  const sent = [];
  let quiet = 0;
  page.netSendAction = row => sent.push(row);
  page.roundVehicleFor = root => (root === launcher ? { id: 7, launcher: 3, node: rocket } : null);
  page.withServerSeat = fn => { quiet++; return fn(); };
  page.roundSpawners.standVehicle = (template, matrix, opts) => { log.push(['stand', template, opts.node === rocket]); return rocket; };
  const ride = createRocketRide(page);
  const took = ride.onVehicleRound({ owner: launcher }, ROUND, LAUNCH());
  ride.frame(1 / 30);
  const riding = ride.state().riding;
  const warhead = new THREE.Object3D();
  warhead.userData.fireArms = { magSize: 1, numOfMag: 1, destroyVehicleWhenNoAmmo: true };
  rocket.userData.hull = { destroyed: false, damage: () => sent.push('LOCAL DAMAGE') };
  guns.onShot({ node: warhead, owner: rocket }, 1);
  const afterWarhead = [...sent];
  ride.rideOut(rocket);
  const back = page.occupancy.root === launcher;
  // A refusal undoes a ride.
  const b = fakePage({ room: true });
  b.page.netSendAction = () => {};
  b.page.roundVehicleFor = () => ({ id: 7, launcher: 3, node: b.rocket });
  b.page.withServerSeat = fn => fn();
  const rideB = createRocketRide(b.page);
  rideB.onVehicleRound({ owner: b.launcher }, ROUND, LAUNCH());
  rideB.frame(1 / 30);
  rideB.launchRefused({ why: 'flying' });
  out.roomRide = { took, riding, log, afterWarhead, back, quiet,
                   refusedBack: b.page.occupancy.root === b.launcher, refusedRiding: rideB.state().riding };
}
{
  // A bot's launcher: out of it without an exit, into the round with its
  // velocity, and back when the round dies.
  const { page, launcher, rocket } = fakePage({ firer: 'bot3' });
  const seats = new Map([['bot3', { root: launcher, seatId: 'seat', drive: null }]]);
  const calls = [];
  const bot = { playerId: 'bot3' };
  page.vehicles.seatOf = id => seats.get(id) ?? null;
  page.vehicles.holder = () => null;
  page.botUnits = () => ({
    invalidate() {},
    candidates: () => [
      { vehicleId: launcher.uuid, seatId: 'seat', isRoot: true, name: 'launcher' },
      { vehicleId: rocket.uuid, seatId: 'pilot', isRoot: true, name: 'rocket' },
    ],
  });
  page.referee = () => ({
    bots: [bot],
    leaveVehicle: (b, opts) => { calls.push(['leave', opts]); seats.delete(b.playerId); },
    enterVehicle: (b, door) => {
      calls.push(['enter', door.name]);
      seats.set(b.playerId, door.name === 'rocket'
        ? { root: rocket, seatId: 'pilot', drive: { state: { velocity: new THREE.Vector3(), airspeed: 0 } } }
        : { root: launcher, seatId: 'seat', drive: null });
      return true;
    },
  });
  const ride = createRocketRide(page);
  const took = ride.onVehicleRound({ owner: launcher }, ROUND, LAUNCH());
  ride.frame(1 / 30);
  const riding = ride.state().bots;
  const speed = seats.get('bot3').drive.state.velocity.toArray();
  const human = ride.state().riding;
  const out1 = ride.botRideOut(bot);
  out.botRide = { took, riding, speed, human, out1, back: seats.get('bot3')?.root === launcher,
                  calls, again: ride.botRideOut(bot), left: ride.state().bots };
}

// --- a boarded carrier's points -----------------------------------------------
{
  const sub = { userData: { physics: { disableSpawnPointsOnEnter: true } } };
  const ship = { userData: { physics: {} } };
  out.boarded = {
    byNode: shutsSpawnsOnEnter({}, sub),
    byRow: shutsSpawnsOnEnter({ disableOnEnter: true }, ship),
    neither: shutsSpawnsOnEnter({}, ship),
    empty: spawnShutByBoarding({ disableOnEnter: true }, sub, () => null),
    held: spawnShutByBoarding({ disableOnEnter: true }, sub, () => 'bot7'),
    shipHeld: spawnShutByBoarding({}, ship, () => 'local'),
    noCarrier: spawnShutByBoarding({ disableOnEnter: true }, null, () => 'local'),
  };
}

// --- the level's template words -------------------------------------------------
{
  const TABLE = {
    natterengine: { physics: { heatIncrement: 0.0003, heatBarType: 'B', inverseHeatBar: true } },
    wasserfallfirearmsbundle: { fireArms: { disableWhenFired: true, projectile: { vehicle: true } } },
    wasserfallguns: { fireArms: { destroyVehicleWhenNoAmmo: true } },
    gato: { physics: { disableSpawnPointsOnEnter: true, subPos: true } },
  };
  const root = new THREE.Object3D();
  const node = (name, userData = {}) => { const o = new THREE.Object3D(); o.name = name; o.userData = userData; root.add(o); return o; };
  const engine = node('NatterEngine', { physics: { torque: 500, heatIncrement: 0.5 } });
  const launcher = node('WasserfallFireArmsBundle_1', { fireArms: { projectile: { template: 'WasserfallRocket', kind: 'shell' }, magSize: 1 } });
  const stale = node('WasserfallGuns', { fireArms: { projectile: 'WasserFallProjectile' } });
  const notAGun = node('wasserfallguns', {});
  const gato = node('Gato', {});
  const other = node('Sherman', { physics: { mass: 1 } });
  const touched = applyTemplateWords(root, TABLE);
  out.words = {
    touched,
    engine: engine.userData.physics,
    launcher: launcher.userData.fireArms,
    stale: stale.userData.fireArms,
    notAGun: notAGun.userData.fireArms ?? null,
    gato: gato.userData.physics,
    other: other.userData.physics,
    lookup: !!templateWordsOf({ name: 'Gato_12' }, TABLE),
    none: applyTemplateWords(root, undefined) + applyTemplateWords(root, {}),
  };
}

// --- who sees the submarine HUD ------------------------------------------------
{
  const data = [0.009, 0.03, 1, 10, 19.5, 40, 5];
  out.subPos = {
    oldBoat: isSubmarine({ vehicleType: 'VTSubmarine', submarineData: data }),
    oldTruck: isSubmarine({ vehicleType: 'VTLightTank', submarineData: data }),
    helm: isSubmarine({ vehicleType: 'VTSubmarine', submarineData: data, subPos: true }),
    deckGun: isSubmarine({ vehicleType: 'VTSubmarine', submarineData: data, subPos: false }),
    modHelm: isSubmarine({ vehicleType: 'VTLightTank', submarineData: data, subPos: true }),
    noBlock: isSubmarine({ vehicleType: 'VTSubmarine', subPos: true }),
  };
}

// --- SPAWN-14's exemption: the hull's tooltip type ------------------------------
{
  const layout = { vehicles: { wasserfallrocket: 36, wasserfall: 36, spitfire: 5 } };
  out.toolTip = {
    own: toolTipTypeOf({ name: 'Spitfire', userData: { hud: { toolTipType: 36 } } }, layout),
    table: toolTipTypeOf({ name: 'WasserfallRocket_1', userData: { control: 'WasserfallRocket' } }, layout),
    suffixed: toolTipTypeOf({ name: 'Spitfire_3', userData: {} }, layout),
    unknown: toolTipTypeOf({ name: 'Natter', userData: {} }, layout),
    noLayout: toolTipTypeOf({ name: 'WasserfallRocket', userData: {} }, null),
  };
}

console.log(JSON.stringify(out));
