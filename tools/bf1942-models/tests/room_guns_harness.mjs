// A room's guns (`server/room-guns.mjs`): the seat guns and the bots'
// launchers flown on the room server, in-process with virtual peers on a
// manual clock.
//
//   pins     the stand-in body's numbers against the referee's
//   hello    HELLO's `rounds.seats` on a level whose collider casts, and no
//            guns at all on the unit harness's flat mock (what a room was)
//   seat     on Wake, a human on one of the Shokaku's AA batteries holds the trigger:
//            the server's FireArms fires, its magazine is charged, the rounds meet a soldier on
//            their line and kill them, the kill is the gunner's, the marks go
//            to the gunner alone and the `shot` rows to everyone else
//   leave    the gunner leaves with the trigger held: the gun stops
//   mount    a drivetrain's guns go to its driver only, and a passenger's
//            seat holds none of them
//   hull     a round's direct hit on a hull, priced on the server; a crewed
//            hull marks the firer's crosshair and an empty one does not
//   rocket   a bot's launcher round (`launchBotRound`): flown, its blast
//            hurting and pushing a soldier beside the landing
//   capsules a soldier on foot is met on the capsules of his stance
//            (`server/soldier-capsules.mjs`, off a rig and a pose recipe):
//            the head as the head, the chest as the chest, nothing in the
//            gap between; a bot's own round keeps the stand-in sphere
//   sync     the server's magazine to the gunner's page (`gun` rows), and
//            the page's own count put right (`viewer/gun-sync.js`)
//   page     `viewer/vehicle-hits.js`: with the room flying the seat guns,
//            the page's own seat round reports and marks nothing; a hand
//            weapon's round is still reported
//
//   node tests/room_guns_harness.mjs [viewerDir]
// prints one JSON object. Run by `tests/test_room_guns.py`.

import path from 'node:path';
import os from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(process.argv[2]);
installModuleHooks(viewer);
const at = (...parts) => pathToFileURL(path.join(...parts)).href;
const netcode = await import(at(viewer, 'netcode.js'));
const THREE = await import('three');
const { RoomServerCore, frame } = await import(at(HERE, '..', 'server', 'rooms.mjs'));
const { buildLevelFromDescriptor, fakeLevelDescriptor, loadRealLevel } = await import(at(HERE, '..', 'server', 'level.mjs'));
const roomGuns = await import(at(HERE, '..', 'server', 'room-guns.mjs'));
const referee = await import(at(viewer, 'bot-referee.js'));
const { createVehicleHits } = await import(at(viewer, 'vehicle-hits.js'));
const gunSync = await import(at(viewer, 'gun-sync.js'));
const { FireState } = await import(at(viewer, 'fire-state.js'));
const soldierCapsules = await import(at(HERE, '..', 'server', 'soldier-capsules.mjs'));
const { BotSenses } = await import(at(viewer, 'bot-sense.js'));
const { MSG_JOIN, MSG_ACTION, MSG_HELLO, MSG_EVENT, MSG_INPUT, MSG_PING, encodeInputFrame } = netcode;

const FRAME_MS = 1000 / 30;
const out = {};
const quiet = () => {};
const print = console.log;
console.log = quiet; console.warn = quiet; console.error = quiet;

// --- the rig -------------------------------------------------------------------

/** The unit harness's level with a collider that casts: flat ground at 0. */
function castLevel() {
  const descriptor = fakeLevelDescriptor({ viewerDir: viewer });
  descriptor.name = 'guns';
  descriptor.collider = {
    ...descriptor.collider,
    cast(ox, oy, oz, dx, dy, dz, maxDist) {
      if (!(dy < 0) || !(oy > 0)) return null;
      const t = -oy / dy;
      if (t > maxDist) return null;
      return { t, x: ox + dx * t, y: 0, z: oz + dz * t, nx: 0, ny: 1, nz: 0,
               material: 0, kind: 'terrain', owner: -1, triangle: -1 };
    },
  };
  for (const point of descriptor.extras.controlPoints) point.unableToChangeTeam = true;
  const level = buildLevelFromDescriptor({ viewerDir: viewer, descriptor });
  // The tree's own damage tables, as a real level loads them.
  level.damageTables = JSON.parse(readFileSync(path.join(viewer, 'maps', '_shared', 'damage.json'), 'utf8'));
  return level;
}

function makeCore() {
  const state = { clock: 0 };
  const core = new RoomServerCore({
    levels: new Map([['guns', castLevel()], ['test', buildLevelFromDescriptor({ viewerDir: viewer })],
                     ['wake', loadRealLevel({ viewerDir: viewer, name: 'wake' })]]),
    defaultLevel: 'guns', now: () => state.clock, random: mulberry(11),
    rules: { gameStartDelay: 0, roundStartDelay: 0 },
  });
  core.state = state;
  return core;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
                 t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makePeer(core) {
  const peer = { sent: [], closed: null, seq: 0,
                 send(bytes) { this.sent.push(Buffer.from(bytes)); },
                 close(code, reason) { this.closed = { code, reason }; } };
  peer.core = core;
  core.attach(peer);
  return peer;
}
const jsonRow = buf => JSON.parse(Buffer.from(buf.subarray(1)).toString('utf8'));
const sendJson = (peer, type, row) => peer.core.onMessage(peer, frame(type, Buffer.from(JSON.stringify(row))));
const rowsOf = (peer, type) => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow).filter(r => r.type === type);
function join(peer, room, name, team, extra = {}) {
  sendJson(peer, MSG_JOIN, { room, name, team, ...extra });
  const hello = peer.sent.find(b => b[0] === MSG_HELLO);
  return hello ? jsonRow(hello) : null;
}
const IDLE = { forward: 0, strafe: 0, walk: false, crouch: false, prone: false, jump: false,
               fire: false, altFire: false, roll: 0, pitch: 0, pad: false };
function input(peer, over = {}) {
  peer.core.onMessage(peer, frame(MSG_INPUT, encodeInputFrame(++peer.seq, { ...IDLE, ...over }, { x: 0, y: 0 })));
}
/** Run `ticks` frames; `each(i)` before each one. */
function run(core, code, ticks, peers, each = null) {
  const room = core.room(code);
  for (let i = 0; i < ticks; i++) {
    core.state.clock += FRAME_MS;
    if (i % 60 === 0) for (const peer of peers) core.onMessage(peer, frame(MSG_PING, Buffer.alloc(4)));
    if (each?.(i) === false) return i;
    room.frame(FRAME_MS);
  }
  return ticks;
}
const round2 = v => Math.round(v * 100) / 100;

// --- pins ----------------------------------------------------------------------
out.pins = {
  radius: [roomGuns.STAND_IN_RADIUS, referee.BOT_BODY_RADIUS],
  height: [roomGuns.STAND_IN_HEIGHT, referee.BOT_BODY_HEIGHT],
  material: [roomGuns.STAND_IN_MATERIAL, referee.BOT_BODY_MATERIAL],
  shotRowTicks: roomGuns.SHOT_ROW_TICKS,
  gunRowTicks: roomGuns.GUN_ROW_TICKS, gunHeartbeatTicks: roomGuns.GUN_HEARTBEAT_TICKS,
  seatAimThinkTicks: (await import(at(HERE, '..', 'server', 'room-bots.mjs'))).BOT_SEAT_AIM_THINK_TICKS,
  syncLead: gunSync.GUN_SYNC_LEAD_S,
};

// --- hello ---------------------------------------------------------------------
{
  const core = makeCore();
  const a = makePeer(core);
  const hello = join(a, 'HELLO', 'alice', 2, { level: 'guns' });
  const b = makePeer(core);
  const flat = join(b, 'FLAT', 'bob', 2, { level: 'test' });
  out.hello = {
    casting: hello.rounds, worldGuns: !!core.room('HELLO').world.guns,
    flat: flat.rounds ?? null, flatGuns: !!core.room('FLAT').world.guns, flatRoomGuns: core.room('FLAT').guns,
  };
}

// --- seat, leave, mount ----------------------------------------------------------
{
  const core = makeCore();
  const gunner = makePeer(core);
  const target = makePeer(core);
  // The carrier is Japan's (team 1); the target is the other side's.
  const hG = join(gunner, 'SEAT', 'gunner', 1, { level: 'wake' });
  const hT = join(target, 'SEAT', 'target', 2, { level: 'wake' });
  const room = core.room('SEAT');
  const w = room.world;
  sendJson(gunner, MSG_ACTION, { type: 'spawn', team: 1 });
  sendJson(target, MSG_ACTION, { type: 'spawn', team: 2 });
  run(core, 'SEAT', 3, [gunner, target]);
  const zero = room.instance.table.find(v => /shokaku/i.test(v.template));
  // The first of her gun seats (an anti-aircraft battery: a seat with no
  // drive, whose FireArms is its own).
  const survey = room.instance.seatSurveyOf(zero);
  let seatIndex = -1;
  for (let i = 1; i < survey.order && seatIndex < 0; i++) {
    const m = room.instance.mountIntoSeat(w, hG.slot, zero, i);
    if (m && w.player(hG.slot).manned.some(g => g.muzzles?.length)) seatIndex = i;
    room.instance.unmountFromSeat(w, hG.slot, zero);
  }
  sendJson(gunner, MSG_ACTION, { type: 'seat', vehicle: zero.id, seat: seatIndex, action: 'enter' });
  run(core, 'SEAT', 2, [gunner, target]);
  const player = w.player(hG.slot);
  const gun = player.manned[0];
  const state = w.fireStateFor(gun.node);
  const ammo0 = state.ammo;
  const hp0 = w.armorOf(hT.slot).hitPoints;
  gunner.sent.length = 0; target.sent.length = 0;
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _d = new THREE.Vector3();
  // The target stands in the way of the round in the air, 8 m ahead of it,
  // every tick: where the server flies it, whatever frame its gun fires in.
  const _v = new THREE.Vector3();
  const onTheLine = () => {
    const shot = room.guns.guns.projectiles[0];
    if (!shot) return;
    _v.copy(shot.velocity).normalize();
    _p.copy(shot.mesh.position).addScaledVector(_v, 8);
    w.player(hT.slot).soldier.spawn(_p.x, _p.y - roomGuns.STAND_IN_HEIGHT, _p.z, 0);
  };
  let killedAt = null;
  run(core, 'SEAT', 150, [gunner, target], i => {
    if (rowsOf(target, 'killed').length) { killedAt = i; return false; }
    onTheLine();
    input(gunner, { fire: true });
    return true;
  });
  const killed = rowsOf(target, 'killed')[0] ?? null;
  const shotRows = rowsOf(target, 'shot');
  out.seat = {
    rounds: hG.rounds,
    seatIndex, drivenGroups: player.groups.length,
    muzzles: gun.muzzles.length,
    seatShots: room.guns.stats.seatShots, ammoSpent: Number.isFinite(ammo0) ? ammo0 - state.ammo : null,
    unlimited: state.unlimited,
    hp0, hpLost: round2(hp0 - (w.armorOf(hT.slot)?.hitPoints ?? 0)), killedAt, killed: killed && { slot: killed.slot, other: killed.other },
    wantKilled: { slot: hT.slot, other: hG.slot },
    gunnerMarks: rowsOf(gunner, 'hitMark').length, targetMarks: rowsOf(target, 'hitMark').length,
    shotRowsToOthers: shotRows.length, shotRowsToFirer: rowsOf(gunner, 'shot').length,
    shotRow: shotRows[0] && { slot: shotRows[0].slot, vehicle: shotRows[0].vehicle, seat: shotRows[0].seat,
                              gun: typeof shotRows[0].gun, pos: shotRows[0].pos?.length, dir: shotRows[0].dir?.length,
                              unit: round2(Math.hypot(...(shotRows[0].dir ?? [0]))) },
    wantShot: { slot: hG.slot, vehicle: zero.id },
    // At most one row every SHOT_ROW_TICKS a gun.
    shotRowsCap: Math.ceil(((killedAt ?? 150) + 1) / roomGuns.SHOT_ROW_TICKS) + 1,
  };

  // leave: the trigger held, then out of the seat.
  for (let i = 0; i < 3; i++) { input(gunner, { fire: true }); run(core, 'SEAT', 1, [gunner, target]); }
  const firingBefore = gun.firing;
  sendJson(gunner, MSG_ACTION, { type: 'seat', vehicle: zero.id, seat: seatIndex, action: 'exit' });
  const shotsAtExit = room.guns.stats.seatShots;
  run(core, 'SEAT', 30, [gunner, target], () => { input(gunner, { fire: true }); return true; });
  out.leave = { firingBefore, firingAfter: gun.firing, shotsAfter: room.guns.stats.seatShots - shotsAtExit,
                onFoot: !w.player(hG.slot).occupancy };

}

// --- mount, hull, rocket (the unit level: a Willy and flat ground) --------------------
{
  const core = makeCore();
  const gunner = makePeer(core);
  const target = makePeer(core);
  const hG = join(gunner, 'SEAT', 'gunner', 2, { level: 'guns' });
  const hT = join(target, 'SEAT', 'target', 1, { level: 'guns' });
  const room = core.room('SEAT');
  const w = room.world;
  sendJson(gunner, MSG_ACTION, { type: 'spawn', team: 2 });
  sendJson(target, MSG_ACTION, { type: 'spawn', team: 1 });
  run(core, 'SEAT', 3, [gunner, target]);
  const willy = room.instance.table.find(v => /willy/i.test(v.template));

  // mount: a passenger holds none of the drivetrain's guns.
  const m = room.instance.mountIntoSeat(w, hG.slot, willy, 1);
  out.mount = { passengerGroups: w.player(hG.slot).groups.length, passengerDrive: !!m?.vehicle };
  room.instance.unmountFromSeat(w, hG.slot, willy);

  // hull: a round the room flew, on the Willy, empty and then crewed.
  const damage = w.vehicleDamage.get(willy.owner);
  const before = damage.hitPoints;
  const at0 = willy.home.position;
  const record = () => ({ kind: 'object', owner: willy.owner, damage: 7, point: [at0.x, at0.y + 1, at0.z],
                          stamp: { firer: hG.slot, team: 2, weapon: 'Zero', hull: -1 } });
  gunner.sent.length = 0;
  const empty = room.hits.onRound(record());
  const marksEmpty = rowsOf(gunner, 'hitMark').length;
  sendJson(target, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'enter' });
  run(core, 'SEAT', 2, [gunner, target]);
  const seated = w.player(hT.slot).occupancy?.root === willy.root;
  const crewed = room.hits.onRound(record());
  out.hull = {
    before, afterEmpty: round2(before - (empty?.direct?.lost ?? 0)), lostEmpty: round2(empty?.direct?.lost ?? 0),
    lostCrewed: round2(crewed?.direct?.lost ?? 0), hp: round2(damage.hitPoints), seated,
    marksEmpty, marksCrewed: rowsOf(gunner, 'hitMark').length - marksEmpty,
    lastHit: damage.lastHitPlayer ?? null, wantLastHit: hG.slot,
  };
  sendJson(target, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'exit' });
  run(core, 'SEAT', 2, [gunner, target]);

  // rocket: a bot's launcher round, flown here, its blast beside a soldier.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'room-guns-'));
  try {
    const file = path.join(tmp, 'Bazooka.glb');
    writeFileSync(file, launcherGlb());
    await room.guns.loadBotLaw();
    const s = w.player(hT.slot).soldier;
    const hpBefore = w.armorOf(hT.slot).hitPoints;
    target.sent.length = 0;
    // From 12 m off and 2 m up, onto the ground a metre and a half beside them.
    const origin = [s.x + 12, s.y + 2, s.z];
    const aim = [s.x + 1.5 - origin[0], s.y - origin[1], s.z - origin[2]];
    const len = Math.hypot(...aim);
    const bot = { playerId: hG.slot, inputIndex: 0, aimDeviation: 0, weaponAi: { name: 'Bazooka' },
                  aimRay: () => ({ origin, dir: aim.map(v => v / len) }) };
    const launched = room.guns.launchBotRound(bot, { velocity: 50 }, name => (name === 'Bazooka' ? file : null));
    const unknown = room.guns.launchBotRound({ ...bot, weaponAi: { name: 'No4' } }, {}, () => null);
    const inFlight = room.guns.guns.projectiles.length;
    run(core, 'SEAT', 30, [gunner, target]);
    out.rocket = {
      launched, unknown, inFlight, landed: room.guns.guns.projectiles.length === 0,
      botRounds: room.guns.stats.botRounds,
      hpLost: round2(hpBefore - w.armorOf(hT.slot).hitPoints),
      lastHit: w.armorOf(hT.slot).lastHit ?? null, wantLastHit: hG.slot,
      blastRows: rowsOf(target, 'blast').filter(r => r.slot === hT.slot).length,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // crew: a round that wrecks a crewed hull kills its crew for the firer (AI-76).
  sendJson(target, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'enter' });
  run(core, 'SEAT', 2, [gunner, target]);
  gunner.sent.length = 0;
  const wreck = room.hits.onRound({ kind: 'object', owner: willy.owner, damage: 1e4, point: [at0.x, at0.y + 1, at0.z],
                                    stamp: { firer: hG.slot, team: 2, weapon: 'Zero', hull: -1 } });
  run(core, 'SEAT', 3, [gunner, target]);
  const died = rowsOf(gunner, 'killed').find(r => r.slot === hT.slot) ?? null;
  out.crew = { hullDead: w.vehicleDamage.get(willy.owner).destroyed, lost: round2(wreck?.direct?.lost ?? 0),
               killed: died && { slot: died.slot, other: died.other }, want: { slot: hT.slot, other: hG.slot } };
}

/** Until `peer`'s player stands again (the wave, SPAWN-35). */
function stepUntilAlive(core, room, peer, hello, peers) {
  for (let i = 0; i < 40 * 30; i++) {
    if (!room.authority.dead.has(hello.slot) && !room.world.armorOf(hello.slot)?.destroyed) return true;
    if (i % 30 === 0) sendJson(peer, MSG_ACTION, { type: 'spawn', team: hello.team });
    run(core, room.code, 1, peers);
  }
  return false;
}

/** A launcher's model glb, JSON chunk only: the live tree's Bazooka FireArms
 *  (its `fireArms` block as `extract` bakes it), its muzzle and its round. */
function launcherGlb() {
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Bazooka', children: [1, 2], extras: { fireArms: {
        projectile: { template: 'BazookaProjectile', kind: 'shell', trail: null, timeToLive: 10.0, gravity: 0.2,
                      material: 226,
                      damage: { radius: 4.0, material2: 200, damageType: 1, hasCollisionEffect: true } },
        roundOfFire: 1.0, magSize: 1, numOfMag: 6, magType: 0, reloadTime: 5.6, autoReload: true,
        velocity: 50.0, blastAmmoCount: false, fireInCameraDof: true, input: 'c_PIFire', control: 'vehicle',
        muzzles: 1 } } },
      { name: 'Bazooka muzzle 1', extras: { muzzle: true } },
      { name: 'Bazooka projectile', extras: { projectileMesh: true } },
    ],
  };
  return jsonGlb(doc);
}

/** A glb with a JSON chunk and nothing else. */
function jsonGlb(doc) {
  let json = Buffer.from(JSON.stringify(doc));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8);
  header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, json]);
}

// --- capsules --------------------------------------------------------------------
{
  // A four-bone skeleton: the pelvis a metre up, the chest a quarter over
  // it, the neck 0.42 over that and the head 0.03 over the neck (a head's
  // capsule runs on from its parent, `capsuleSegment`). Lying, the pelvis
  // turns it all forward (+Z).
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'room-guns-poses-'));
  try {
    const poses = path.join(tmp, 'models', 'poses');
    mkdirSync(path.join(poses, 'rigs'), { recursive: true });
    writeFileSync(path.join(poses, 'rigs', 'TestSoldier.rig.glb'), jsonGlb({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'TestSoldier', children: [1], extras: { rigRoot: true } },
        { name: 'Bip01', children: [2], extras: { joint: true } },
        { name: 'Bip01 Spine2', children: [3], extras: { joint: true } },
        { name: 'Bip01 Neck', children: [4], extras: { joint: true } },
        { name: 'Bip01 Head', extras: { joint: true } },
      ],
    }));
    const up = { bip01: [0, 0, 0, 1, 0, 1, 0], 'bip01 spine2': [0, 0, 0, 1, 0, 0.25, 0], 'bip01 neck': [0, 0, 0, 1, 0, 0.42, 0],
                 'bip01 head': [0, 0, 0, 1, 0, 0.03, 0] };
    const h = Math.SQRT1_2;
    writeFileSync(path.join(poses, 'TestSoldier__Rifle.pose.json'), JSON.stringify({
      format: 'bf1942-pose-recipe/1', soldier: 'TestSoldier', pose: 'Rifle', rig: 'rigs/TestSoldier.rig.glb',
      root: { name: 'TestSoldier holding Rifle', q: [0, 0, 0, 1] }, joints: up,
      clips: { stand: { still: up }, crouch: { still: { ...up, bip01: [0, 0, 0, 1, 0, 0.5, 0] } },
               lie: { still: { ...up, bip01: [h, 0, 0, h, 0, 0.2, 0] } } },
    }));
    const table = [{ bone: 'Bip01_Head', distSq: 0.02, material: 40, stretch: 2.0 },
                   { bone: 'Bip01_Spine2', distSq: 0.08, material: 41, stretch: -0.45 },
                   { bone: 'Bip01_L_Calf', distSq: 0.03, material: 42, stretch: 0.3 }];
    const caps = soldierCapsules.loadStanceCapsules({ modelsDirs: [path.join(tmp, 'models')], soldier: 'TestSoldier', table });
    const headY = stance => round2(caps?.[stance]?.find(c => c.material === 40)?.origin[1]);
    const lieHead = caps?.prone?.find(c => c.material === 40)?.origin ?? [];

    const level = castLevel();
    level.paths = { levelDir: null, sharedDir: null, modelsDirs: [path.join(tmp, 'models')], glbsDir: null };
    level.soldierBody = { collisionBones: table };
    level.loadouts = { kits: {}, levels: { guns: { 1: { soldier: 'TestSoldier' }, 2: { soldier: 'TestSoldier' } } } };
    const state = { clock: 0 };
    const core = new RoomServerCore({ levels: new Map([['guns', level]]), defaultLevel: 'guns', now: () => state.clock,
                                      random: mulberry(3), rules: { gameStartDelay: 0, roundStartDelay: 0 } });
    core.state = state;
    const gunner = makePeer(core), target = makePeer(core);
    const hG = join(gunner, 'CAPS', 'gunner', 2, { level: 'guns' });
    const hT = join(target, 'CAPS', 'target', 1, { level: 'guns' });
    const room = core.room('CAPS');
    sendJson(gunner, MSG_ACTION, { type: 'spawn', team: 2 });
    sendJson(target, MSG_ACTION, { type: 'spawn', team: 1 });
    run(core, 'CAPS', 3, [gunner, target]);
    const s = room.world.player(hT.slot).soldier;
    const group = { firer: hG.slot };
    // A level ray across them, 5 m off to their side, at a height over the feet.
    const across = (height, firer = group) => {
      const hit = room.guns.bodyCast(s.x - 5, s.y + height, s.z, 1, 0, 0, 20, firer);
      return hit ? { target: hit.target, material: hit.material, bone: hit.bone } : null;
    };
    const asHuman = { head: across(1.7), chest: across(1.25), gap: across(0.5) };
    // The same rays when the firer is a bot: the same body.
    const has = room.bots.has;
    room.bots.has = slot => slot === hG.slot;
    const asBot = { head: across(1.7), gap: across(0.5) };
    room.bots.has = has;
    const standingBones = room.guns.soldierBones(room.world.player(hT.slot));
    // A server told to keep its bots on the stand-in body (`capsuleRays` false).
    const core2 = new RoomServerCore({ levels: new Map([['guns', level]]), defaultLevel: 'guns', now: () => state.clock,
                                       random: mulberry(3), rules: { gameStartDelay: 0, roundStartDelay: 0 },
                                       bots: { enabled: true, capsuleRays: false } });
    core2.state = state;
    const g2 = makePeer(core2), t2 = makePeer(core2);
    const hG2 = join(g2, 'CAPS2', 'gunner', 2, { level: 'guns' });
    const hT2 = join(t2, 'CAPS2', 'target', 1, { level: 'guns' });
    const room2 = core2.room('CAPS2');
    sendJson(g2, MSG_ACTION, { type: 'spawn', team: 2 });
    sendJson(t2, MSG_ACTION, { type: 'spawn', team: 1 });
    run(core2, 'CAPS2', 3, [g2, t2]);
    const s2 = room2.world.player(hT2.slot).soldier;
    const across2 = height => { const hit = room2.guns.bodyCast(s2.x - 5, s2.y + height, s2.z, 1, 0, 0, 20, { firer: hG2.slot });
      return hit ? { target: hit.target, material: hit.material, bone: hit.bone } : null; };
    const humanOnStandInServer = across2(1.7);
    room2.bots.has = slot => slot === hG2.slot;
    const asBotStandIn = { head: across2(1.7), gap: across2(0.5), wantTarget: hT2.slot,
                           bones: room2.guns.soldierBones(room2.world.player(hT2.slot)) };
    // The sense pick (`bot-sense.js` `_rays`): a bone, never the last of the array.
    const senses = new BotSenses({ random: mulberry(5) });
    senses.soldierBones = () => [[0, 1.7, 0], [0.2, 1.2, 0.1], [9, 9, 9]];
    const picked = new Set();
    for (let i = 0; i < 200; i++) {
      const ray = senses._rays(null, [0, 1.6, 30], { soldier: { yaw: 0, stance: 'stand' } }, [0, 0, 0], 30);
      picked.add(ray?.offset?.join(','));
    }
    const plain = new BotSenses({ random: mulberry(5) })._rays(null, [0, 1.6, 30], { soldier: { yaw: 0, stance: 'stand' } }, [0, 0, 0], 30);
    // Turned a quarter turn, lying: the head is forward of the feet, along the yaw.
    Object.defineProperty(s, 'pose', { get: () => 2, configurable: true });
    s.yaw = Math.PI / 2;
    const lying = room.guns.capsulesOf(hT.slot)?.find(c => c.material === 40)?.origin ?? [];
    out.capsules = {
      stances: caps ? Object.keys(caps).filter(k => k !== 'bones' && caps[k]) : null,
      bones: caps?.bones ? Object.fromEntries(Object.entries(caps.bones).map(([k, v]) => [k, v.length])) : null,
      headY: { stand: headY('stand'), crouch: headY('crouch'), prone: headY('prone') },
      lieHeadForward: round2(lieHead[2]),
      stanceOf: [soldierCapsules.stanceOf(0), soldierCapsules.stanceOf(1), soldierCapsules.stanceOf(2)],
      asHuman, asBot, wantTarget: hT.slot, asBotStandIn, humanOnStandInServer,
      standingBones: standingBones?.length ?? null, headBone: standingBones?.find(b => Math.abs(b[1] - 1.7) < 1e-6) ?? null,
      sensePicks: [...picked].sort(), plainPickHeight: plain?.offset?.[1] ?? null,
      lyingHeadOffset: [round2(lying[0] - s.x), round2(lying[2] - s.z)],
      noFiles: soldierCapsules.loadStanceCapsules({ modelsDirs: [tmp], soldier: 'TestSoldier', table }),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// --- sync ------------------------------------------------------------------------
{
  // The law (`gun-sync.js`), on a 30-round, 4-magazine gun at 10 rounds a second.
  const make = (over = {}) => Object.assign(new FireState({ magSize: 30, numOfMag: 4, reloadTime: 3, roundOfFire: 10 }), over);
  const fix = (state, server, opts) => ({ changed: gunSync.reconcileGun(state, server, opts),
    ammo: state.ammo, mags: state.magsLeft, reload: state.reloadRemaining });
  const full = { ammo: 30, mags: 3, reload: 0, heat: 0, overheat: 0 };
  out.syncLaw = {
    same: fix(make(), full),
    // The page has spent three the server has not, trigger held: its lead.
    lead: fix(make({ ammo: 27, held: true }), full),
    // The same with the trigger let go: the server's word.
    idle: fix(make({ ammo: 27, held: false }), full),
    // A hull someone emptied before: the page thought it full.
    emptied: fix(make(), { ammo: 4, mags: 1, reload: 0 }),
    // The server is reloading and the page is not.
    reloading: fix(make({ ammo: 2 }), { ammo: 0, mags: 2, reload: 2.4 }),
    // The page began its reload a moment before the server's last rounds landed.
    ahead: fix(make({ ammo: 0, reloadRemaining: 3 }), { ammo: 2, mags: 3, reload: 0 }),
    // The page reloads a magazine the server still has most of.
    wrong: fix(make({ ammo: 0, reloadRemaining: 3 }), { ammo: 22, mags: 3, reload: 0 }),
    unlimited: gunSync.reconcileGun(new FireState({ magSize: -1 }), full),
    order: gunSync.fireArmsOrder({ traverse(visit) { for (const n of [{ userData: {} }, { name: 'a', userData: { fireArms: {} } }, { name: 'b', userData: { fireArms: {} } }]) visit(n); } }).map(n => n.name),
  };

  // The rows: a human in the Zero's seat (its pose is of no interest here).
  const core = makeCore();
  const gunner = makePeer(core), other = makePeer(core);
  const hG = join(gunner, 'SYNC', 'gunner', 2, { level: 'guns' });
  join(other, 'SYNC', 'other', 1, { level: 'guns' });
  const room = core.room('SYNC');
  sendJson(gunner, MSG_ACTION, { type: 'spawn', team: 2 });
  run(core, 'SYNC', 3, [gunner, other]);
  const zero = room.instance.table.find(v => /zero/i.test(v.template));
  gunner.sent.length = 0; other.sent.length = 0;
  sendJson(gunner, MSG_ACTION, { type: 'seat', vehicle: zero.id, seat: 0, action: 'enter' });
  run(core, 'SYNC', 2, [gunner, other]);
  const onEnter = rowsOf(gunner, 'gun');
  const player = room.world.player(hG.slot);
  const gun = player.groups.find(g => g.stats?.projectile?.kind === 'bullet') ?? player.groups[0];
  const order = roomGuns.fireArmsNodes(zero.root);
  const state = room.world.fireStateFor(gun.node);
  const ammo0 = state.ammo;
  gunner.sent.length = 0;
  run(core, 'SYNC', 60, [gunner, other], () => { input(gunner, { fire: true }); return true; });
  const firing = rowsOf(gunner, 'gun');
  const mine = firing.flatMap(r => r.guns).filter(g => g[0] === order.indexOf(gun.node));
  gunner.sent.length = 0;
  run(core, 'SYNC', roomGuns.GUN_HEARTBEAT_TICKS + 5, [gunner, other]);
  out.sync = {
    onEnter: onEnter.length, enterRow: onEnter[0] && { slot: onEnter[0].slot, vehicle: onEnter[0].vehicle, guns: onEnter[0].guns.length },
    wantEnter: { slot: hG.slot, vehicle: zero.id },
    enterAmmo: onEnter[0]?.guns.find(g => g[0] === order.indexOf(gun.node))?.[1], ammo0,
    spent: ammo0 - state.ammo,
    rowsWhileFiring: mine.length, rowsCap: Math.ceil(60 / roomGuns.GUN_ROW_TICKS) + 2,
    lastRowAmmo: mine.at(-1)?.[1], serverAmmoNearLast: state.ammo,
    falling: mine.every((g, i) => i === 0 || g[1] <= mine[i - 1][1]),
    toOthers: rowsOf(other, 'gun').length,
    heartbeat: rowsOf(gunner, 'gun').length,
  };
}

// --- page ----------------------------------------------------------------------
{
  const LOCAL = 'local';
  function makePage({ seats }) {
    const reported = [], raised = [];
    const page = {
      LOCAL_PLAYER: LOCAL, seatRoundsFromServer: seats,
      reportImpact: record => reported.push(record),
      raiseHitIndication: () => raised.push(true),
      vehicles: { firerOf: group => group?.seatOf ?? null, instanceOf: () => null },
      damageVisuals: new Map(), vehicleDamage: { get: () => null, applyHit: () => null, applySplash: () => [] },
      world: { players: new Map(), player: () => null, armorOf: () => null },
      bots: [], bodyAt: () => null, capsulesOf: () => null, soldier: null, soldierArmor: null, soldierDead: false,
      optOnFoot: { checked: true }, optPilot: { checked: false }, guns: { materials: null, modifiers: null },
      camera: { position: { toArray: () => [0, 0, 0] } }, applyDamage: () => {}, applyDamageToPlayer: () => {},
    };
    return { hits: createVehicleHits(page), reported, raised };
  }
  const seatGroup = { seatOf: LOCAL };
  const handGroup = { firer: LOCAL };
  const remoteGroup = { replay: true };
  const hit = group => ({ kind: 'soldier', target: 'b1', owner: -1, damage: 12, firerGroup: group, point: [0, 0, 0] });
  const go = (seats, group) => {
    const p = makePage({ seats });
    p.hits.applyVehicleHit(hit(group));
    return { reported: p.reported.length, marked: p.raised.length };
  };
  out.page = {
    seatWithServerRounds: go(true, seatGroup),
    handWithServerRounds: go(true, handGroup),
    seatWithoutServerRounds: go(false, seatGroup),
    handBuiltWithServerRounds: (() => { const p = makePage({ seats: true });
      p.hits.applyVehicleHit({ kind: 'object', owner: 3, damage: 5, point: [0, 0, 0] }); return p.reported.length; })(),
    remoteCopy: go(true, remoteGroup).reported,
  };
}

print(JSON.stringify(out));
