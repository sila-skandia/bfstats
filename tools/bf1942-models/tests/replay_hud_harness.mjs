// A round replay's first person, under node: the view that puts the game's
// crosshair where the game put it, and the HUD fed from the recording.
//
// The owner's ask (2026-09-29): "Can we render a cross hair on the FPV that
// would be honest to the game-play? ... placing it exactly where the game
// does would be handy", and then the health bars and the ammunition. The
// game draws its cross at the centre of the screen, so the view has to be
// his: his heading turned by his torso's twist (a third of it is recorded)
// and raised by his aim (0.4 of it), and at each round the round's own axis,
// which a hand weapon fires along the camera.
//
// Same pattern as `replay_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, { ReplayCamera, eyeAim }, hud, { createVehicleHud }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-camera.js'), imp('replay-hud.js'),
  imp('vehicle-hud.js'),
]);

const results = {};
const line = o => JSON.stringify(o);
const r3 = v => +v.toFixed(3) + 0;
const deg = r => (r * 180) / Math.PI;

// One rifleman, pid 3 (the recording player), on BF1942's +Z at first: a BAR
// (item 3) and a grenade (item 4). He stands, then runs forward from 12 s,
// fires a burst of three at 5.0-5.26 s (the last with a 6 degree twist and
// 4 recorded degrees of pitch), changes magazine at 8 s, is refilled at 20 s.
const q = yaw => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
const states = [[0, 'Lb_Stand', 0], [1, 'Lb_RunForward', 0], [2, 'Ub_StandAimBar1918', 0],
                [3, 'Ub_FireBar1918', 0], [4, 'Ub_StandReloadBar1918', 0], [5, 'Lb_Crouch', 0x20]];
const lines = [
  line({ k: 'h', v: 5, start: '', hz: 10 }),
  line({ k: 'anim', t: 0, states }),
  line({ k: 'roster', t: 0.5, p: [[3, 2, 0, 'recorder', 1]] }),
  line({ k: 'e', t: 1, e: 'gameRules', extViews: 1, noseCam: 1, soldierFF: 1, ticketRatio: 1, timeLimit: 0, worldTime: 0, crosshair: 0 }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: 50, tmpl: 'USSoldier', pos: [0, 1, 0], rot: [0, 0, 0] }),
  line({ k: 'e', t: 1, e: 'control', pid: 3, netId: 50 }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1520, netId: 55, tmpl: 'US_Assault', pos: [0, 1, 0], rot: [0, 0, 0] }),
  line({ k: 'e', t: 1, e: 'pickupKit', pid: 3, netId: 55 }),
  line({ k: 'o', t: 1, id: 50, gid: 1, tmpl: 'USSoldier', tid: 1763, team: 2, maxhp: 30 }),
  line({ k: 'a', t: 1, a: [[50, 30, -1]] }),
];
for (let i = 0; i <= 290; i++) {
  const t = +(1 + i * 0.1).toFixed(1);
  const z = t < 12 ? 0 : (t - 12) * 5;
  lines.push(line({ k: 's', t, o: [[50, 0, 2, z, ...q(0)]] }));
}
lines.push(line({ k: 'st', t: 1, o: [[50, 0, 2, 0, 0, 3, 0]] }));
lines.push(line({ k: 'st', t: 5.2, o: [[50, 0, 3, 4, 6, 3, 0]] }));
lines.push(line({ k: 'st', t: 6, o: [[50, 0, 2, 4, 6, 3, 0]] }));
lines.push(line({ k: 'st', t: 8, o: [[50, 0, 4, 0, 0, 3, 0]] }));
lines.push(line({ k: 'st', t: 9, o: [[50, 0, 2, 0, 0, 3, 0]] }));
lines.push(line({ k: 'st', t: 12, o: [[50, 1, 2, 0, 0, 3, 0]] }));
lines.push(line({ k: 'st', t: 16, o: [[50, 5, 2, 0, 0, 4, 0]] }));
// The burst. His camera's axis is recorded with each round (fireInCameraDof):
// straight ahead and level for the first two; the third where his twist and
// pitch have turned it. The recorded 6 and 4 are a third and 0.4 of the
// view's 18 and 10 (BF1942's yaw is the view's negated, as its z is); the
// round itself left at 21 and 11, a turn the 10 Hz records do not have.
const ahead = [0, 0, 1];
const axis = (yaw, pitch) => [-Math.sin(yaw * Math.PI / 180) * Math.cos(pitch * Math.PI / 180),
  Math.sin(pitch * Math.PI / 180), Math.cos(yaw * Math.PI / 180) * Math.cos(pitch * Math.PI / 180)];
const turned = axis(21, 11);
const modelled = axis(18, 10);
lines.push(line({ k: 'f', t: 5.0, id: 50, pid: 3, w: 'Bar1918', p: [0, 2.65, 0], d: ahead, local: 1 }));
lines.push(line({ k: 'f', t: 5.13, id: 50, pid: 3, w: 'Bar1918', p: [0, 2.65, 0], d: ahead, local: 1 }));
lines.push(line({ k: 'f', t: 5.26, id: 50, pid: 3, w: 'Bar1918', p: [0, 2.65, 0], d: turned, local: 1 }));
// A thrown grenade leaves above his view, and moves nothing.
lines.push(line({ k: 'f', t: 17, id: 50, pid: 3, w: 'GrenadeAllies', p: [0, 2.65, 0], d: [0, 0.7, 0.7], local: 1 }));
for (let i = 0; i < 17; i++) {
  lines.push(line({ k: 'f', t: +(22 + i * 0.1).toFixed(2), id: 50, pid: 3, w: 'Bar1918', p: [0, 2.65, 0], d: ahead, local: 1 }));
}
lines.push(line({ k: 'e', t: 20, e: 'special', action: 0 }));
lines.push(line({ k: 'a', t: 25, a: [[50, 18, -1]] }));
lines.push(line({ k: 'end', t: 30 }));
const rec = recording.parseRecording(lines.join('\n'));
const life = rec.lives.find(l => l.nid === 50);

// --- the aim, eased between records, and the view on a round's axis ------------
{
  results.aim = {
    before: recording.aimAt(rec, 50, 5.05),
    halfway: recording.aimAt(rec, 50, 5.15),
    at: recording.aimAt(rec, 50, 5.2),
    scales: [recording.AIM_PITCH_SCALE, recording.AIM_TWIST_SCALE],
    centrePoint: rec.crosshairCentrePoint,
  };
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec, followPid: 3, time: 5, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  const along = (yaw, pitch, d) => {
    const v = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    return r3(deg(v.angleTo(new THREE.Vector3(d[0], d[1], -d[2]).normalize())));
  };
  const model = eyeAim(rec, life, 5.26);
  const view = camera.viewOf(life, 5.26);
  const between = camera.viewOf(life, 5.195);
  const later = camera.viewOf(life, 5.6);
  const thrown = camera.viewOf(life, 17);
  const thrownModel = eyeAim(rec, life, 17);
  camera.setMode('pov');
  camera.update(1 / 60, 5.26);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  results.view = {
    modelDegrees: [r3(deg(model.yaw)), r3(deg(model.pitch))],
    modelOff: along(model.yaw, model.pitch, turned),
    viewOff: along(view.yaw, view.pitch, turned),
    firstOff: along(camera.viewOf(life, 5.0).yaw, camera.viewOf(life, 5.0).pitch, ahead),
    betweenYaw: r3(deg(between.yaw)),
    laterOff: along(later.yaw, later.pitch, modelled),
    thrownMoved: r3(Math.abs(thrown.yaw - thrownModel.yaw) + Math.abs(thrown.pitch - thrownModel.pitch)),
    cameraOff: r3(deg(fwd.angleTo(new THREE.Vector3(turned[0], turned[1], -turned[2]).normalize()))),
    sight: camera.sight ? { kind: camera.sight.kind, nid: camera.sight.life.nid, looking: camera.sight.looking } : null,
    eyeY: r3(cam.position.y),
    lens: cam.fov,
  };
}

// --- lying on a slope: the view on his body's own axes -------------------------------
//
// replay_20260928-161948 at 35:24: prone on 27 degrees of downhill, rolled 15
// across it, 8.7 recorded degrees of aim pitch and 0.5 of twist. His round
// is composed the engine's way, on the body: the twist turns it about the
// body's up (-3 per degree in BF1942's frame), the pitch raises it about the
// body's right (2.5 per degree), and it leaves 0.7 m down the body's up from
// his origin. Read off the level, the aim put the view 22 degrees up.
{
  const bodyQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 27 * Math.PI / 180)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 15 * Math.PI / 180));
  const origin = new THREE.Vector3(10, 5, 20);
  const pitch = 8.7;
  const twist = 0.5;
  const ly = -3 * twist * Math.PI / 180;
  const lp = 2.5 * pitch * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(ly) * Math.cos(lp), Math.sin(lp), Math.cos(ly) * Math.cos(lp)).applyQuaternion(bodyQ);
  const eyeAt = new THREE.Vector3(0, -0.7, 0).applyQuaternion(bodyQ).add(origin);
  const q = [bodyQ.x, bodyQ.y, bodyQ.z, bodyQ.w].map(v => +v.toFixed(6));
  const proneStates = [[0, 'Lb_Stand', 0], [1, 'Lb_RunStandToLie', 0x40], [2, 'Lb_Lie', 0x40], [3, 'Lb_LieToStand', 0x40],
                       [4, 'Ub_StandAimMp40', 0], [5, 'Ub_LieMp40', 0], [6, 'Ub_LieFireMp40', 0]];
  const proneLines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'anim', t: 0, states: proneStates }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1727, netId: 60, tmpl: 'GermanSoldier', pos: [10, 5, 20], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 0, name: 'Instant Replay', team: 1, ai: 0, vehNetId: 60 }),
    line({ k: 'e', t: 1, e: 'control', pid: 0, netId: 60 }),
    line({ k: 'o', t: 1, id: 60, gid: 1, tmpl: 'GermanSoldier', tid: 1727, team: 1, maxhp: 30 }),
    line({ k: 's', t: 1, o: [[60, 10, 6, 20, 0, 0, 0, 1]] }),
    line({ k: 's', t: 2, o: [[60, 10, 5, 20, ...q]] }),
    line({ k: 'st', t: 1, o: [[60, 0, 4, 0, 0, 3, 0]] }),
    line({ k: 'st', t: 1.5, o: [[60, 1, 5, 0, 0, 3, 0]] }),
    line({ k: 'st', t: 2, o: [[60, 2, 5, pitch, twist, 3, 0]] }),
    line({ k: 'st', t: 3.1, o: [[60, 2, 6, pitch, twist, 3, 0]] }),
    line({ k: 'st', t: 3.2, o: [[60, 2, 5, pitch, twist, 3, 0]] }),
    line({ k: 'st', t: 8, o: [[60, 3, 5, pitch, twist, 3, 0]] }),
    line({ k: 'st', t: 8.1, o: [[60, 0, 4, 0, 0, 3, 0]] }),
    line({ k: 'f', t: 3, id: 60, pid: 0, w: 'Mp40', p: eyeAt.toArray().map(v => +v.toFixed(4)),
           d: dir.toArray().map(v => +v.toFixed(5)), local: 1 }),
    line({ k: 'end', t: 10 }),
  ];
  const prec = recording.parseRecording(proneLines.join('\n'));
  const prone = prec.lives.find(l => l.nid === 60);
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec: prec, followPid: 0, time: 3, hulls: new Map(), ctx: { camera: cam, groundHeight: () => -100, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  camera.setMode('pov');
  const viewDir = new THREE.Vector3(dir.x, dir.y, -dir.z);
  const fwdOf = quat => new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  const offRound = quat => r3(deg(fwdOf(quat).angleTo(viewDir)));
  // The records alone, away from any round.
  camera.update(1 / 60, 2.5);
  const alone = { pitch: r3(deg(Math.asin(fwdOf(cam.quaternion).y))), off: offRound(cam.quaternion) };
  const rollOf = quat => r3(deg(Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(quat).y)));
  const roll = rollOf(cam.quaternion);
  camera.update(1 / 60, 3);
  const atRound = offRound(cam.quaternion);
  const eye = cam.position.clone();
  const recordedEye = new THREE.Vector3(eyeAt.x, eyeAt.y, -eyeAt.z);
  // What the view was when the aim was read off the level: the body's
  // heading turned by the twist, raised by the aim off the horizontal.
  const heading = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(-bodyQ.x, -bodyQ.y, bodyQ.z, bodyQ.w), 'YXZ').y;
  const level = new THREE.Quaternion().setFromEuler(new THREE.Euler(lp, heading - ly, 0, 'YXZ'));
  results.prone = {
    alone,
    roll,
    atRound,
    roundPitch: r3(deg(Math.asin(viewDir.y))),
    levelOff: offRound(level),
    eyeOff: r3(eye.distanceTo(recordedEye)),
    // The eye across the dive to the ground (1.5 s) and back up (8.1 s).
    lift: [1.4, 1.5, 1.641, 1.782, 2.5, 8.05, 8.1575, 8.3].map(t => r3(recording.eyeLiftAt(prec, 60, t))),
  };
}

// --- the weapon in his hands, its ammunition and its spread ----------------------
{
  const loadouts = { kits: { US_Assault: { primary: 'Bar1918', weapons: [
    { slot: 1, weapon: 'KnifeAllies' }, { slot: 2, weapon: 'Colt' }, { slot: 3, weapon: 'Bar1918' },
    { slot: 4, weapon: 'GrenadeAllies' }] } } };
  results.held = [4, 16.5].map(t => hud.heldWeapon(rec, loadouts, life, t));
  const magazine = { size: 20, magazines: 6, reloadTime: 4.0 };
  const events = hud.weaponEvents(rec, life, 'Bar1918');
  const refills = hud.refillsOf(rec, 3, 3);
  const at = t => hud.handAmmoAt({ ...events, refills }, magazine, t, 'Bar1918');
  results.ammo = {
    events: { rounds: events.rounds.length, reloads: events.reloads },
    refills,
    spawn: at(2),
    afterBurst: at(6),
    reloading: at(10),
    reloaded: at(12.1),
    refilled: at(20.5),
    // 17 more from a full 20 after the refill: 3 left.
    burst2: at(24),
  };
  // A bazooka's one round: dry, then a new one reloadTime later with a spare fewer.
  const tube = { rounds: [3], reloads: [], refills: [] };
  results.tube = [2.9, 3.1, 8.9, 9.2].map(t => hud.handAmmoAt(tube, { size: 1, magazines: 6, reloadTime: 5.6, autoReload: true }, t, 'Bazooka'));
  // The spread: a Thompson's block. Still: at its floor. Three rounds: the
  // fire channel, 0.35 each less its decay. Running: the speed channel.
  const thompson = { min: 0.4, fire: [2.0, 0.35, 0.06], mod: [1.2, 1.05, 0.9], turn: [0, 0, 0, 0],
                     speed: [0.8, 0.2, 0.2, 0.1], misc: [2.5, 2.5, 0.1] };
  results.spread = {
    still: r3(hud.spreadAt(rec, life, thompson, events.rounds, 4.9)),
    burst: r3(hud.spreadAt(rec, life, thompson, events.rounds, 5.3)),
    settled: r3(hud.spreadAt(rec, life, thompson, events.rounds, 9)),
    running: r3(hud.spreadAt(rec, life, thompson, events.rounds, 13)),
    none: hud.spreadAt(rec, life, null, events.rounds, 13),
    settle: [r3(hud.settleTime(thompson)), r3(hud.settleTime({ min: 0.75, fire: [3.5, 0.25, 0.03], mod: [1.0, 0.85, 0.5] }))],
  };
}

// --- a seat gun's magazine, heat and readiness -------------------------------------
{
  const mg = { magSize: 30, numOfMag: 3, reloadTime: 2, roundOfFire: 10, heatAddWhenFire: 0.05,
               coolDownPerSec: 0.2, timeDelayOnOverheat: 3 };
  const shots = Array.from({ length: 12 }, (_, i) => 1 + i * 0.1);
  const { state, last } = hud.gunStateAt(mg, shots, 2.5);
  const cannon = hud.gunStateAt({ magSize: 1, numOfMag: 20, reloadTime: 4, roundOfFire: 0.25 }, [1], 2);
  results.gun = {
    ammo: state.ammo, magsLeft: state.magsLeft, heat: r3(state.heat), last: r3(last),
    cannon: { ammo: cannon.state.ammo, reloading: r3(cannon.state.reloadRemaining), magsLeft: cannon.state.magsLeft },
  };
}

// --- the HUD's variables, fed in first person and taken back after ------------------
{
  const data = { crossHair: 'CHTCrossHair', hudAmmo: 'ATAmmoBar', magazine: { size: 20, magazines: 6, reloadTime: 4 },
                 hud: { ammoBar: 'Ingame/Magbar_Bar_empty_32x64.tga', ammoBarFill: 'Ingame/Magbar_Bar_full_32x64.tga', ammoBarSize: 48 },
                 deviation: { min: 0.75, fire: [3.5, 0.25, 0.03], mod: [1.0, 0.85, 0.5], speed: [2.25, 0.2, 0.2, 0.1] } };
  const player = {
    rec, followPid: 3, recordingPid: 3, soldiers: null,
    ctx: { loadouts: () => ({ kits: { US_Assault: { primary: 'Bar1918', weapons: [{ slot: 3, weapon: 'Bar1918' }] } } }) },
    camera: { sight: { kind: 'foot', life } },
  };
  const replayHud = new hud.ReplayHud(player);
  replayHud.data.set('bar1918', data);
  const art = {
    stanceNation: team => (team === 2 ? 'us' : 'ger'),
    kitHealthArt: (team, kit) => ({ healthBarIcon: `healthbar_empty_${kit}`, healthBarFullIcon: `healthbar_full_${kit}` }),
    ammoBarCode: name => ({ ABAmmoBarOnly: 1 }[name] ?? 7),
  };
  const vars = {};
  replayHud.update(26);
  replayHud.feed(vars, art);
  const foot = { ...vars };
  const aim = replayHud.crosshairAim();
  player.camera.sight.looking = true;
  const looking = replayHud.crosshairAim();
  player.camera.sight = null;
  replayHud.update(26.1);
  replayHud.feed(vars, art);
  results.feed = {
    foot: {
      icon: foot['Soldier/SoldierIcon'], shown: foot['Soldier/ShowSoldierIcon'],
      hp: [foot['Soldier/SoldierHitPoints'], foot['Soldier/SoldierMaxHitPoints']],
      bar: foot['Soldier/SoldierHealthBarIcon'],
      ammo: [foot['Ammo/AmmoType'], foot['Ammo/PrimaryAmmo'], foot['Ammo/MaxPrimaryAmmo'], foot['Ammo/PrimaryMag']],
      vehicle: foot['Vehicle/ShowVehicleIcon'], weapon: foot['Weapon/ShowWeaponIcon'],
    },
    aim: { style: aim.style, centre: aim.centre, deviation: r3(aim.deviation) },
    looking: looking.style,
    after: {
      shown: vars['Soldier/ShowSoldierIcon'], hp: vars['Soldier/SoldierHitPoints'] ?? null,
      ammo: vars['Ammo/PrimaryAmmo'] ?? null, aim: replayHud.crosshairAim(),
    },
  };
}

// --- a seat: the hull's icon, health, dots, guns --------------------------------
{
  const seatHud = { vehicleIcon: 'Vehicle/Icon_Sherman.tga', crossHairType: 'CHTCrossHair',
                    primaryAmmoIcon: 'Ammo/Icon_shell.tga', primaryAmmoBar: 'ABAmmoBarOnly', hasTurretIcon: true,
                    numberOfWeaponIcons: 1 };
  const gunNode = new THREE.Object3D();
  gunNode.name = 'ShermanGunBarrel';
  gunNode.userData.fireArms = { magSize: 1, numOfMag: 30, reloadTime: 0.35, roundOfFire: 0.35 };
  const occupancy = {
    rootId: 'root', order: ['root', 'gunner'],
    hudOf: () => seatHud,
    seatInfo: id => (id === 'root' ? { hud: { ...seatHud, maxHitpoints: 900 } } : null),
    fireArmsNodesOf: () => [gunNode],
    seatDotsAt: (id, others, team) => [{ state: 1, x: 54, y: 103 }, { state: others.length ? 3 : 2, x: 60, y: 90 }],
    showsTurretIconAt: (id, inside) => inside,
  };
  const root = new THREE.Object3D();
  root.updateMatrixWorld(true);
  const hull = { occupancy, root, groups: [{ node: gunNode, muzzles: [{}] }], seatIdAt: i => occupancy.order[i] ?? null };
  const tankLife = { nid: 900, created: 0, destroyed: Infinity, hp: [{ t: 0, hp: 900 }, { t: 10, hp: 612 }], maxhp: 900 };
  const tankRec = { ...rec, fires: [{ t: 11, nid: 900, weapon: 'ShermanGunBarrel', press: false }], lives: [...rec.lives, tankLife] };
  const cam = new THREE.PerspectiveCamera();
  cam.rotation.y = -0.5;
  cam.updateMatrixWorld(true);
  const player = { rec: tankRec, followPid: 3, recordingPid: 3, soldiers: null,
    ctx: { loadouts: () => null, camera: cam }, camera: { sight: { kind: 'seat', life: tankLife, hull, seat: 0 } } };
  const replayHud = new hud.ReplayHud(player);
  const vars = {};
  replayHud.update(11.5);
  replayHud.feed(vars, { ammoBarCode: name => ({ ABAmmoBarOnly: 1 }[name] ?? 7), stanceNation: () => 'us' });
  results.seat = {
    icon: vars['Vehicle/VehicleIcon'], shown: vars['Vehicle/ShowVehicleIcon'],
    hp: [vars['Vehicle/VehicleHitPoints'], vars['Vehicle/VehicleMaxHitPoints']],
    dots: vars['Occupied/OccupiedData'],
    turret: vars['IconLookRotation'] === undefined ? null : r3(vars['IconLookRotation']),
    ammo: [vars['Ammo/PrimaryAmmoText'], vars['Ammo/PrimaryMag'], vars['Ammo/PrimaryAmmoBar']],
    ready: r3(vars['Ammo/ReloadTime']),
    soldierHp: vars['Soldier/SoldierHitPoints'],
    aim: replayHud.crosshairAim(),
    weapon: vars['Weapon/ShowWeaponIcon'],
  };
  // Back on foot: the seat's variables go.
  player.camera.sight = { kind: 'foot', life };
  replayHud.update(26);
  replayHud.feed(vars, {});
  results.seat.leftVehicleVars = ['Vehicle/VehicleIcon', 'Ammo/PrimaryAmmoText', 'Occupied/OccupiedData']
    .filter(name => vars[name] !== undefined);
  results.seat.backOnFoot = vars['Vehicle/ShowVehicleIcon'];
}

// --- his zoom: the body record's bit, the weapon's lens, a rifle's scope ------------
//
// A scout (pid 4) zooms his K98 sniper at 3 s (bit 0x20, 0x80 while it
// changes) and back at 6 s; a rifleman's BAR zoom keeps the cross.
{
  const zoomLines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'anim', t: 0, states: [[0, 'Lb_Stand', 0], [1, 'Ub_StandAimK98Sniper', 0]] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1727, netId: 70, tmpl: 'GermanSoldier', pos: [0, 1, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 4, name: 'scout', team: 1, ai: 0, vehNetId: 70 }),
    line({ k: 'e', t: 1, e: 'control', pid: 4, netId: 70 }),
    line({ k: 'o', t: 1, id: 70, gid: 1, tmpl: 'GermanSoldier', tid: 1727, team: 1, maxhp: 30 }),
    line({ k: 's', t: 1, o: [[70, 0, 2, 0, 0, 0, 0, 1]] }),
    line({ k: 'st', t: 1, o: [[70, 0, 1, 0, 0, 3, 0x41]] }),
    line({ k: 'st', t: 3.0, o: [[70, 0, 1, 0, 0, 3, 0xe1]] }),
    line({ k: 'st', t: 3.1, o: [[70, 0, 1, 0, 0, 3, 0x61]] }),
    line({ k: 'st', t: 6.0, o: [[70, 0, 1, 0, 0, 3, 0xc1]] }),
    line({ k: 'st', t: 6.1, o: [[70, 0, 1, 0, 0, 3, 0x41]] }),
    line({ k: 'end', t: 10 }),
  ];
  const zrec = recording.parseRecording(zoomLines.join('\n'));
  const scout = zrec.lives.find(l => l.nid === 70);
  scout.kitTemplate = 'Ger_Scout';
  const sniper = { crossHair: 'CHTNone', hudAmmo: 'ATAmmoBar', magazine: { size: 5, magazines: 3, reloadTime: 1.6 },
                   zoom: { fov: 0.1, soldierFov: 0.6, scope: true, sniperSight: true, icon: 'sniper.tga', unZoomBetweenFire: 3, toggle: true } };
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const player = {
    rec: zrec, followPid: 4, recordingPid: null, soldiers: null, hulls: new Map(),
    ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100,
           loadouts: () => ({ kits: { Ger_Scout: { primary: 'K98Sniper', weapons: [{ slot: 3, weapon: 'K98Sniper' }] } } }) },
  };
  const camera = new ReplayCamera(player);
  const replayHud = new hud.ReplayHud(player);
  replayHud.data.set('k98sniper', sniper);
  player.camera = camera;
  player.hud = replayHud;
  camera.setMode('pov');
  const fovs = {};
  const step = t => { camera.update(1 / 60, t); replayHud.update(t); };
  step(2.9);
  fovs.before = r3(cam.fov);
  step(3.05);
  fovs.first = r3(cam.fov);
  for (let i = 0; i < 40; i++) step(3.2 + i / 60);
  fovs.zoomed = r3(cam.fov);
  const vars = {};
  replayHud.feed(vars, {});
  const scopedAim = replayHud.crosshairAim();
  for (let i = 0; i < 60; i++) step(6.2 + i / 60);
  fovs.after = r3(cam.fov);
  const vars2 = { 'CrossHair/ScopeIndex': 0 };
  replayHud.feed(vars2, {});
  results.zoom = {
    bits: [2.5, 3.05, 4, 6.05, 7].map(t => recording.bodyAt(zrec, 70, t).zoomed),
    zoomOf: replayHud.zoomOf(scout, 4),
    fovs,
    scope: { show: vars['CrossHair/ShowCrossHair'], index: vars['CrossHair/ScopeIndex'],
             icon: vars['CrossHair/ScopeIcon'], sniper: vars['CrossHair/SniperSight'] },
    scopedAim: { style: scopedAim.style, scoped: scopedAim.scoped },
    unzoomedIndex: vars2['CrossHair/ScopeIndex'],
    unzoomedAim: replayHud.crosshairAim().scoped,
  };
  // A BAR's zoom: 0.5 rad, no scope, the cross stays.
  replayHud.data.set('k98sniper', { ...sniper, crossHair: 'CHTCrossHair', zoom: { fov: 0.5, soldierFov: 0.6, toggle: true } });
  step(4);
  results.zoom.barAim = replayHud.crosshairAim().scoped;
  results.zoom.barFov = r3(replayHud.zoomOf(scout, 4).fov);
}

// --- the page's cross asks the replay first ---------------------------------------
{
  const replayAim = { style: 'CHTIcon', deviation: 0, scoped: false, centre: false };
  const vehicleHud = createVehicleHud({ replayAim, occupancy: null, handWeapon: null });
  const plain = createVehicleHud({ replayAim: null, occupancy: null, handWeapon: null, optOnFoot: { checked: false } });
  results.pageAim = { replay: vehicleHud.crosshairAim(), none: plain.crosshairAim() };
}

process.stdout.write(JSON.stringify(results));
