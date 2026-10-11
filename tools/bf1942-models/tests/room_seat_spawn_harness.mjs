// A spawn into a vehicle's seat in a room (`setEnterOnSpawn 1`, ledger
// FHR-10), and the turning arm a held craft rides, on the room's server.
//
//   arm     `viewer/held-arm.js`: the arm's angle is a function of the
//           world's time alone, so two trees at one time stand at one angle
//   clock   `World.tickTime`: the ticks run, plus what a page in a room adds
//   seat    a descriptor level with a seat point on its Willy: the spawn row
//           names the point, the seat row seats him, a second player is
//           refused both, and takes the seat once it is free
//   tarawa  FH's Tarawa off the mod's own tree (when it is extracted): the
//           Hellcat is a table entry of its own on a turning arm, a spawn
//           into it seats its pilot on the arm, and the throttle lets it go
//   agree   the same level built twice, the page's way (the match runner's
//           stage: `hull-bodies.js`, the registry) and the room's, stepped
//           tick for tick: the Hellcat in one place on both, parked, with
//           its pilot, and at the tick the throttle lets it go
//
//   node tests/room_seat_spawn_harness.mjs <viewerDir>
// prints one JSON object. Run by `tests/test_room_seat_spawn.py`.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(process.argv[2]);
installModuleHooks(viewer);
const at = (...parts) => pathToFileURL(path.join(...parts)).href;
const THREE = await import(at(viewer, 'vendor', 'three.module.js'));
const { bindArm, armQuaternionAt, poseHeldArms } = await import(at(viewer, 'held-arm.js'));
const { World } = await import(at(viewer, 'world.js'));
const netcode = await import(at(viewer, 'netcode.js'));
const { RoomServerCore, frame } = await import(at(HERE, '..', 'server', 'rooms.mjs'));
const { buildLevelFromDescriptor, fakeLevelDescriptor, loadRealLevel } = await import(at(HERE, '..', 'server', 'level.mjs'));
const { MSG_JOIN, MSG_ACTION, MSG_INPUT, MSG_HELLO, MSG_EVENT, MSG_SNAPSHOT, encodeInputFrame, decodeSnapshot } = netcode;

const FRAME_MS = 1000 / 30;
const out = {};

// --- the rig -------------------------------------------------------------------

function makePeer(core) {
  const peer = { sent: [], closed: null,
                 send(bytes) { this.sent.push(Buffer.from(bytes)); },
                 close(code, reason) { this.closed = { code, reason }; } };
  peer.core = core;
  core.attach(peer);
  return peer;
}
const jsonRow = buf => JSON.parse(Buffer.from(buf.subarray(1)).toString('utf8'));
const sendJson = (peer, type, row) => peer.core.onMessage(peer, frame(type, Buffer.from(JSON.stringify(row))));
const rowsOf = (peer, type) => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow).filter(r => r.type === type);
function join(peer, room, name, team, level) {
  sendJson(peer, MSG_JOIN, { room, name, team, level });
  const hello = peer.sent.find(b => b[0] === MSG_HELLO);
  return hello ? jsonRow(hello) : null;
}
function lastSnapshot(peer) {
  const snaps = peer.sent.filter(b => b[0] === MSG_SNAPSHOT);
  return snaps.length ? decodeSnapshot(new Uint8Array(snaps[snaps.length - 1].subarray(1))) : null;
}
const idle = (over = {}) => ({ forward: 0, strafe: 0, walk: false, crouch: false, prone: false,
                               jump: false, fire: false, altFire: false, roll: 0, pitch: 0, pad: false, ...over });

// --- arm -----------------------------------------------------------------------
//
// FH's rotator: `setContinousRotationSpeed 7/0/0`, baked as five keys a
// quarter turn apart over 360 / 7 s.
const TURN = 360 / 7;
function yawKeys() {
  const times = new Float32Array(5);
  const values = new Float32Array(20);
  const q = new THREE.Quaternion();
  for (let i = 0; i < 5; i++) {
    times[i] = TURN * i / 4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 * i);
    q.toArray(values, i * 4);
  }
  return { times, values };
}
function armRig() {
  const root = new THREE.Object3D();
  const arm = new THREE.Object3D();
  const craft = new THREE.Object3D();
  craft.position.set(140, 300, 0);
  root.add(arm);
  arm.add(craft);
  bindArm(arm, yawKeys());
  return { root, arm, craft };
}
{
  const a = armRig();
  const b = armRig();
  const where = (rig, seconds) => {
    poseHeldArms([{ host: rig.arm }], seconds);
    return rig.craft.getWorldPosition(new THREE.Vector3()).toArray();
  };
  const want = seconds => {
    const angle = seconds * 7 * Math.PI / 180;
    return [140 * Math.cos(angle), 300, -140 * Math.sin(angle)];
  };
  const err = (p, w) => Math.hypot(p[0] - w[0], p[1] - w[1], p[2] - w[2]);
  const q = armQuaternionAt(yawKeys(), -5, new THREE.Quaternion());
  out.arm = {
    at10: err(where(a, 10), want(10)),
    // Past a whole turn, and between two keys.
    wrapped: err(where(a, TURN + 23.5), want(23.5)),
    // Two trees, one time: one place. And not the first tree's last pose.
    apart: err(where(a, 400 / 30), where(b, 400 / 30)),
    moved: err(where(b, 0), where(b, 1)),
    // A second of the 140 m arm at 7 deg/s.
    speed: err(where(a, 30), where(a, 31)),
    // Before time zero the loop runs backwards, not off its first key.
    negative: Math.abs(2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI - 35),
  };
}

// --- clock ---------------------------------------------------------------------
{
  const world = new World({});
  for (let i = 0; i < 90; i++) world.step(1 / 30);
  const ticks = world.ticks;
  const alone = world.tickTime;
  world.tickBase = 1000.5 - ticks;
  out.clock = { ticks, alone, followed: world.tickTime };
}

// --- seat ----------------------------------------------------------------------
if (existsSync(path.join(viewer, 'models', 'Willy.glb'))) {
  const descriptor = fakeLevelDescriptor({ viewerDir: viewer });
  descriptor.name = 'seats';
  descriptor.extras.vehicleSoldierSpawns = [
    { vehicle: 'Willy', spawner: 'willyspawner', pad: 0, name: 'willydriverspawn', group: 9, team: 1,
      position: [40, 0.5, 40], rotation: [0, 0, 0], enterOnSpawn: true },
  ];
  const clock = { ms: 0 };
  const core = new RoomServerCore({
    levels: new Map([['seats', buildLevelFromDescriptor({ viewerDir: viewer, descriptor })]]),
    defaultLevel: 'seats', now: () => clock.ms,
  });
  const pA = makePeer(core);
  const pB = makePeer(core);
  const hello = join(pA, 'SEAT', 'Driver', 1);
  join(pB, 'SEAT', 'Second', 1);
  const room = core.room('SEAT');
  const world = room.world;
  const run = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  const flag = hello.flags.findIndex(f => f.name === 'willydriverspawn');
  const willy = hello.vehicles.find(v => v.template === 'Willy');
  const seatOf = slot => {
    const occ = world.player(slot)?.occupancy;
    return occ ? { template: room.instance.table.find(e => e.root === occ.root)?.template ?? null,
                   seat: occ.order.indexOf(occ.activeSeatId) } : null;
  };
  const spawnRow = { type: 'spawn', flag, spawnIndex: 0, point: 0, kit: null };
  const seatRow = { type: 'seat', vehicle: willy.id, seat: 0, action: 'enter' };

  // The page's order: the spawn, then the seat it predicted.
  sendJson(pA, MSG_ACTION, spawnRow);
  const onPoint = (() => { const s = world.player(1).soldier; return [s.x, s.y, s.z]; })();
  sendJson(pA, MSG_ACTION, seatRow);
  run(2);
  const snap = lastSnapshot(pB);
  const first = {
    flag, enterOnly: room.instance.flags[flag]?.enterOnly === true,
    onPoint, seat: seatOf(1), drives: !!world.player(1).vehicle,
    alive: !world.player(1).armor?.destroyed && world.player(1).armor != null,
    wire: (() => { const p = snap.players.find(r => r.slot === 1); return { seated: p.seated, vehicleId: p.vehicleId, seatIndex: p.seatIndex }; })(),
    vehicleId: willy.id,
    spawnRows: rowsOf(pB, 'spawn').length, seatEnterRows: rowsOf(pB, 'seatEnter').length,
  };

  // A second player's page predicted the same seat: refused, twice.
  sendJson(pB, MSG_ACTION, spawnRow);
  sendJson(pB, MSG_ACTION, seatRow);
  run(2);
  const second = {
    spawnRefused: rowsOf(pB, 'spawnRefused').length, seatRefused: rowsOf(pB, 'seatRefused').map(r => r.vehicle),
    seat: seatOf(2), revived: world.player(2).armor != null,
    // The driver heard none of it.
    leaked: rowsOf(pA, 'spawnRefused').length + rowsOf(pA, 'seatRefused').length,
  };

  // The seat free again, it is his.
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'exit' });
  run(1);
  sendJson(pB, MSG_ACTION, spawnRow);
  sendJson(pB, MSG_ACTION, seatRow);
  run(2);
  const third = { first: seatOf(1), seat: seatOf(2), drives: !!world.player(2).vehicle,
                  seatRefused: rowsOf(pB, 'seatRefused').length };

  // A row with no point on a flag of nothing but seat points spawns nobody,
  // as it did: the authority seats no one on a guess.
  const pC = makePeer(core);
  join(pC, 'SEAT', 'Third', 1);
  sendJson(pC, MSG_ACTION, { type: 'spawn', flag, spawnIndex: 0, kit: null });
  run(1);
  out.seat = { first, second, third, unnamed: { seat: seatOf(3), spawnRows: rowsOf(pA, 'spawn').filter(r => r.slot === 3).length } };
}

// --- tarawa --------------------------------------------------------------------
if (existsSync(path.join(viewer, 'maps', 'mods', 'fh', 'tarawa-1943', 'scene.glb'))) {
  const data = loadRealLevel({ viewerDir: viewer, name: 'tarawa-1943', mod: 'fh' });
  const clock = { ms: 0 };
  const core = new RoomServerCore({ levels: new Map([['tarawa-1943', data]]), defaultLevel: 'tarawa-1943',
                                    now: () => clock.ms });
  const pA = makePeer(core);
  const pB = makePeer(core);
  const pC = makePeer(core);
  const hello = join(pA, 'TARAWA', 'Pilot', 2);
  join(pB, 'TARAWA', 'Wingman', 2);
  join(pC, 'TARAWA', 'Driver', 2);
  const room = core.room('TARAWA');
  const world = room.world;
  const instance = room.instance;
  const run = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  const hellcat = instance.table.find(e => e.template === 'F6F_Hellcat');
  const rec = instance.held.records.find(r => r.node === hellcat?.root);
  const poseOf = entry => { const p = world.vehiclePose(entry.owner); return [p.x, p.y, p.z]; };
  // Where the craft is at a tick, worked out apart from the room's world:
  // the level's own keys at that tick's time, on the rotator's own place.
  const armNode = rec.host;
  const centre = armNode.getWorldPosition(new THREE.Vector3());
  const keys = data.armTracks.get(armNode.levelNode);
  const want = ticks => {
    const q = armQuaternionAt(keys, ticks / 30, new THREE.Quaternion());
    const arm = new THREE.Matrix4().compose(armNode.position, q, armNode.scale);
    return new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().multiplyMatrices(armNode.parent.matrixWorld, arm).multiply(rec.local)).toArray();
  };
  const err = (p, w) => Math.hypot(p[0] - w[0], p[1] - w[1], p[2] - w[2]);
  // The angle it has gone round the rotator, in degrees.
  const bearing = p => Math.atan2(p[2] - centre.z, p[0] - centre.x) * 180 / Math.PI;

  const table = {
    hellcatNode: hellcat?.node ?? null, hellcatKind: hellcat?.kind ?? null,
    wire: hello.vehicles.find(v => v.id === hellcat.id) ?? null,
    // A carried point's row is its hull's point, never a second hull.
    fletchers: instance.table.filter(e => e.template.toLowerCase() === 'fletcher').length,
    lvts: instance.table.filter(e => e.template.toLowerCase() === 'lvt-4' && e.node != null).length,
    keys: keys?.times?.length ?? 0, turn: keys ? keys.times[keys.times.length - 1] : null,
    held: instance.held.records.map(r => r.node.userData?.control ?? r.node.name),
    radius: Math.hypot(rec.local.elements[12], rec.local.elements[14]),
  };

  // Nobody in it: it rides the arm.
  const start = poseOf(hellcat);
  run(90);
  const parked = { tick: world.ticks, roomTick: room.tick, err: err(poseOf(hellcat), want(world.ticks)),
                   travelled: err(poseOf(hellcat), start), startErr: err(start, want(0)),
                   turned: Math.abs(bearing(poseOf(hellcat)) - bearing(start)),
                   radius: Math.hypot(poseOf(hellcat)[0] - centre.x, poseOf(hellcat)[2] - centre.z),
                   height: poseOf(hellcat)[1] - centre.y };

  // A second room of the same level, made later, turns on its own time.
  const pD = makePeer(core);
  join(pD, 'TARAWA2', 'Other', 2, 'tarawa-1943');
  const room2 = core.room('TARAWA2');
  const hellcat2 = room2.instance.table.find(e => e.template === 'F6F_Hellcat');
  const other = { err: err((() => { const p = room2.world.vehiclePose(hellcat2.owner); return [p.x, p.y, p.z]; })(), want(0)),
                  firstStill: err(poseOf(hellcat), want(world.ticks)) };

  // The spawn into it: the row the page sends, then its seat row.
  const flag = hello.flags.findIndex(f => f.name === 'hellcatpilotspawn');
  const spawnRow = { type: 'spawn', flag, spawnIndex: 0, point: 0, kit: null };
  const seatRow = { type: 'seat', vehicle: hellcat.id, seat: 0, action: 'enter' };
  sendJson(pA, MSG_ACTION, spawnRow);
  const body = world.player(1).soldier;
  // In plan: `Soldier.spawn` stands a body on the ground under the point.
  const livePoint = new THREE.Vector3().fromArray(instance.flags[flag].spawns[0].carrierLocal)
    .applyMatrix4(hellcat.root.matrixWorld);
  const pointErr = Math.hypot(body.x - livePoint.x, body.z - livePoint.z);
  const bakedErr = Math.hypot(body.x - instance.flags[flag].spawns[0].position[0],
                              body.z - instance.flags[flag].spawns[0].position[2]);
  sendJson(pA, MSG_ACTION, seatRow);
  const occ = world.player(1).occupancy;
  const seated = { flag, pointErr, bakedErr, onHellcat: occ?.root === hellcat.root, seat: occ ? occ.order.indexOf(occ.activeSeatId) : null,
                   drives: !!world.player(1).vehicle, kind: world.player(1).kind };
  run(45);
  const state = world.player(1).vehicle.state;
  const snap = lastSnapshot(pB);
  const wireHull = snap.vehicles.find(v => v.id === hellcat.id);
  const wirePilot = snap.players.find(p => p.slot === 1);
  const held = {
    tick: world.ticks, err: err(state.position.toArray(), want(world.ticks)), speed: state.velocity.length(),
    released: rec.released,
    wire: { tick: snap.tick, seated: wirePilot.seated, vehicleId: wirePilot.vehicleId, seatIndex: wirePilot.seatIndex,
            hullErr: err([wireHull.x, wireHull.y, wireHull.z], want(snap.tick)), occupied: wireHull.occupied },
  };

  // Another page predicted the same cockpit.
  sendJson(pB, MSG_ACTION, spawnRow);
  sendJson(pB, MSG_ACTION, seatRow);
  const taken = { spawnRefused: rowsOf(pB, 'spawnRefused').length, seatRefused: rowsOf(pB, 'seatRefused').length,
                  seated: !!world.player(2).occupancy };

  // The throttle: the hold drops, with the arm's speed.
  let seq = 1;
  let releasedAt = null;
  let releaseSpeed = null;
  for (let i = 0; i < 120 && releasedAt == null; i++) {
    pA.core.onMessage(pA, frame(MSG_INPUT, encodeInputFrame(seq++, idle({ forwardKeys: 1 }), { x: 0, y: 0 })));
    run(1);
    if (rec.released) { releasedAt = i + 1; releaseSpeed = state.velocity.length(); }
  }
  run(30);
  const flown = { releasedAt, releaseSpeed, offArm: err(state.position.toArray(), want(world.ticks)) };

  // An LVT's seat point: the driver of the LVT it rides.
  const lvtFlag = hello.flags.findIndex(f => f.name === 'lvtsoldierspawn');
  const points = instance.flags[lvtFlag]?.spawns ?? [];
  const point = points.findIndex(p => instance.carrierOf(p)?.live !== false && instance.carrierOf(p));
  const carrier = instance.carrierOf(points[point]);
  sendJson(pC, MSG_ACTION, { type: 'spawn', flag: lvtFlag, spawnIndex: 0, point, kit: null });
  sendJson(pC, MSG_ACTION, { type: 'seat', vehicle: carrier.id, seat: 0, action: 'enter' });
  run(1);
  const lvt = { points: points.length, carrier: carrier?.template ?? null,
                apart: Math.hypot(carrier.home.position.x - points[point].position[0], carrier.home.position.z - points[point].position[2]),
                seated: world.player(3).occupancy?.root === carrier.root, drives: !!world.player(3).vehicle };

  out.tarawa = { table, parked, other, seated, held, taken, flown, lvt };
}

// --- agree ---------------------------------------------------------------------
if (existsSync(path.join(viewer, 'maps', 'mods', 'fh', 'tarawa-1943', 'scene.glb'))) {
  const sim = async file => import(at(HERE, '..', 'sim', file));
  const { loadViewerModules, routeConsole } = await sim('env.mjs');
  const M = await loadViewerModules(viewer);
  routeConsole(true);
  const { realLevel } = await sim('level.mjs');
  const { createStage } = await sim('stage.mjs');
  const level = await realLevel(M, { maps: path.join(viewer, 'maps', 'mods', 'fh'),
                                     models: path.join(viewer, 'models', 'mods', 'fh'), map: 'tarawa-1943' });
  const stage = createStage(M, level, { vehicles: true });
  const instance = loadRealLevel({ viewerDir: viewer, name: 'tarawa-1943', mod: 'fh' }).instantiate(null);
  const DT = 1 / 30;
  const pageRec = stage.hullBodies.heldCraft.find(r => /F6F_Hellcat/i.test(r.node.userData?.control ?? r.node.name));
  const entry = instance.table.find(e => e.template === 'F6F_Hellcat');
  const serverRec = instance.held.records.find(r => r.node === entry.root);
  // Where each side's simulation has the craft and how it is turned: its
  // drive's state with a pilot in it, else its node, which the hold writes.
  const poseOf = (node, drive) => {
    if (drive?.state) return { p: drive.state.position.clone(), q: drive.state.orientation.clone() };
    node.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    node.matrixWorld.decompose(p, q, new THREE.Vector3());
    return { p, q };
  };
  let pageDrive = null, roomDrive = null;
  const run = (n, each = null) => {
    let gap = 0, turn = 0;
    for (let i = 1; i <= n; i++) {
      each?.(i);
      const report = stage.world.step(DT);
      stage.afterBots();
      stage.afterCapture(report, DT);
      instance.world.step(DT);
      const a = poseOf(pageRec.node, pageDrive);
      const b = poseOf(entry.root, roomDrive);
      gap = Math.max(gap, a.p.distanceTo(b.p));
      turn = Math.max(turn, a.q.angleTo(b.q) * 180 / Math.PI);
    }
    return { gap, turn, pageTick: stage.world.ticks, serverTick: instance.world.ticks };
  };
  const parked = run(300);

  // The spawn into the seat: the page's walk picks the point, the room is
  // handed it by its place in the flag's spawns.
  const flag = stage.world.flags.find(f => f.name === 'hellcatpilotspawn');
  stage.world.addPlayer('local', { team: 2 });
  const spawned = stage.world.spawnPlayer('local', { flag, enter: true, group: flag.spawns[0].group });
  const handle = stage.vehicles.enter(spawned.spawn.carrierNode, null, 'local');
  const roomFlag = instance.world.flags.find(f => f.name === 'hellcatpilotspawn');
  instance.world.addPlayer(1, { team: 2 });
  instance.world.spawnPlayer(1, { flag: roomFlag, point: roomFlag.spawns[flag.spawns.indexOf(spawned.spawn)] });
  const mounted = instance.mountIntoSeat(instance.world, 1, entry, 0);
  const seat = { carrier: spawned.spawn.carrierNode === pageRec.node, page: handle?.root === pageRec.node && !!handle?.drive,
                 room: mounted?.occupancy.root === entry.root && !!mounted?.vehicle,
                 // Taken on both: the page's point is off, the room's has no seat to give.
                 pageOff: flag.spawns[0].inactive === true, roomOpen: instance.seatPointOpen(roomFlag.spawns[0], 2) };
  pageDrive = handle?.drive ?? null;
  roomDrive = mounted?.vehicle ?? null;
  const held = run(300);
  held.pageSpeed = handle.drive.state.velocity.length();
  held.roomSpeed = mounted.vehicle.state.velocity.length();

  // The throttle, opened on both at one tick.
  const word = { forward: 0, strafe: 0, forwardKeys: 1, rudder: 0, roll: 0, pitch: 0 };
  let pageAt = null, roomAt = null;
  const flown = run(60, i => {
    stage.world.setInput('local', word, { x: 0, y: 0 });
    instance.world.setInput(1, word, { x: 0, y: 0 }, i);
    if (pageAt == null && pageRec.released) pageAt = i - 1;
    if (roomAt == null && serverRec.released) roomAt = i - 1;
  });
  out.agree = { parked, seat, held, flown: { ...flown, pageAt, roomAt } };
}

process.stdout.write(JSON.stringify(out) + '\n');
