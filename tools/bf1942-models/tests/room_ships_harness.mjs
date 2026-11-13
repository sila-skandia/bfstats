// A room's ships (`server/room-ships.mjs`): the page's floating and drive law
// stepped by the room server, in-process with virtual peers on a manual clock,
// on the tree's own Wake (the Shokaku, her two Daihatsus, her Zero and Val,
// and the Hatsuzuki's two Daihatsus).
//
//   load    every floating hull at its float nodes' own draft before the
//           index bakes it, the ships' craft as table rows after the level's
//           own, each room's deck points its own arrays
//   helm    a human at the Shokaku's helm: her one `Ship`, sailed by the
//           input word; the snapshot's row of her; her deck points, her held
//           Zero and a soldier on her deck going with her; another room's
//           points left alone
//   law     the same hull stepped as a bare `Ship` built the page's way, on
//           the same input: the room's pose is that law's
//   box     the hull box her drag and float damping are read off
//   narrow  the static candidates cut to the hull's own box: the same pose
//           with and without it, and fewer candidates
//   sleep   a crewed ship lying still sleeps, and wakes under way
//   leave   the helm let go: she runs on and slows; taken again while she
//           runs, she is the same drive at the speed she had
//   rest    a helm let go with the hull lying still: at rest at once
//   craft   a Daihatsu sailed off, and the pitch word reaching her ramp
//   gun     an AA battery fired from the carrier under way: the room flies
//           it from where she is
//   spawner a ship's spawner stands a second and a third landing craft where
//           she is now, never a fourth; one left empty far off is lost
//   sink    a ship shot into critical goes down, empty or under her helmsman,
//           with her deck points and whoever stands on her; one destroyed in
//           a single blow does not
//   bots    a room with bots: one takes a helm and sails
//   dry     the same room with `ships: false`: no bot at a helm
//   cap     the room cap costing each level by its own maps, and the tier a
//           room runs when the richest does not fit
//
//   node tests/room_ships_harness.mjs [viewerDir]
// prints one JSON object. Run by `tests/test_room_ships.py`.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(process.argv[2]);
installModuleHooks(viewer);
const at = (...parts) => pathToFileURL(path.join(...parts)).href;
const netcode = await import(at(viewer, 'netcode.js'));
const THREE = await import('three');
const { RoomServerCore, frame } = await import(at(HERE, '..', 'server', 'rooms.mjs'));
const { loadRealLevel } = await import(at(HERE, '..', 'server', 'level.mjs'));
const { isSeaHull } = await import(at(HERE, '..', 'server', 'room-ships.mjs'));
const { equilibriumRootY, floatNodesOf } = await import(at(viewer, 'body-float.js'));
const { Ship } = await import(at(viewer, 'ship.js'));
const { hullCollisionKeel, hullCollisionLayers } = await import(at(viewer, 'ship-spec.js'));
const { craftSpawnerOf } = await import(at(viewer, 'spawned-craft.js'));
const { MSG_JOIN, MSG_ACTION, MSG_HELLO, MSG_EVENT, MSG_INPUT, MSG_PING, MSG_SNAPSHOT,
        encodeInputFrame, decodeSnapshot } = netcode;

const FRAME_MS = 1000 / 30;
const out = {};
const quiet = () => {};
const print = console.log;
console.log = quiet; console.warn = quiet; console.error = quiet;

const level = loadRealLevel({ viewerDir: viewer, name: 'wake' });

function makeCore(bots = null) {
  const state = { clock: 0 };
  const core = new RoomServerCore({
    levels: new Map([['wake', level]]), defaultLevel: 'wake', now: () => state.clock,
    rules: { gameStartDelay: 0, roundStartDelay: 0 },
    ...(bots ? { bots } : {}),
  });
  core.state = state;
  return core;
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
function join(peer, room, name, team) {
  sendJson(peer, MSG_JOIN, { room, name, team, level: 'wake' });
  const hello = peer.sent.find(b => b[0] === MSG_HELLO);
  return hello ? jsonRow(hello) : null;
}
const IDLE = { forward: 0, strafe: 0, walk: false, crouch: false, prone: false, jump: false,
               fire: false, altFire: false, roll: 0, pitch: 0, pad: false };
function input(peer, over = {}) {
  peer.core.onMessage(peer, frame(MSG_INPUT, encodeInputFrame(++peer.seq, { ...IDLE, ...over }, { x: 0, y: 0 })));
}
function run(core, code, ticks, peers, each = null) {
  const room = core.room(code);
  const t0 = Date.now(); if (process.env.TRACE) process.stderr.write(`run ${code} ${ticks}...`);
  for (let i = 0; i < ticks; i++) {
    core.state.clock += FRAME_MS;
    if (i % 60 === 0) for (const peer of peers) core.onMessage(peer, frame(MSG_PING, Buffer.alloc(4)));
    each?.(i);
    room.frame(FRAME_MS);
  }
  if (process.env.TRACE) process.stderr.write(` ${Date.now() - t0} ms\n`);
}
const r3 = v => Math.round(v * 1000) / 1000;
const worldPos = node => { node.updateWorldMatrix(true, false); const e = node.matrixWorld.elements; return [e[12], e[13], e[14]]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lastSnapshot = peer => {
  const buf = [...peer.sent].reverse().find(b => b[0] === MSG_SNAPSHOT);
  return buf ? decodeSnapshot(buf.subarray(1)) : null;
};
const entryOf = (room, name) => room.instance.table.find(v => v.template.toLowerCase() === name);
const flagOf = (room, name) => room.instance.flags.findIndex(f => new RegExp(name, 'i').test(f.name));

// --- load ----------------------------------------------------------------------
{
  const core = makeCore();
  const a = makePeer(core), b = makePeer(core);
  join(a, 'LOADA', 'alice', 1);
  join(b, 'LOADB', 'bob', 1);
  const ra = core.room('LOADA'), rb = core.room('LOADB');
  const water = ra.instance.collider.waterLevel;
  const drafts = [];
  for (const node of ra.instance.ownerRoots) {
    if (!node || !isSeaHull(node)) continue;
    const floats = floatNodesOf(node);
    if (!floats.length) continue;
    drafts.push({ template: node.userData?.control ?? node.name, y: r3(worldPos(node)[1]),
                  rest: r3(equilibriumRootY(floats, water)), copy: node.userData?.heldSlot > 0 });
  }
  const table = ra.instance.table;
  const firstCraft = table.findIndex(v => v.pad == null && isSeaHull(v.root) && /daihatsu/i.test(v.template));
  const flagA = ra.instance.flags[flagOf(ra, 'shokaku')], flagB = rb.instance.flags[flagOf(rb, 'shokaku')];
  out.load = {
    water, drafts,
    ships: table.filter(v => v.kind === 'ship' && v.live).map(v => v.template.toLowerCase()).sort(),
    craft: table.slice(firstCraft).map(v => ({ template: v.template, kind: v.kind, pad: v.pad, node: v.node != null,
                                               slot: v.craftSlot ?? null, live: !!v.live })),
    wire: ra.vehiclesForWire().slice(firstCraft).map(v => [v.node, v.slot ?? 0, v.live]),
    // Nothing of the level's own rows comes after a ship's craft.
    craftLast: firstCraft >= 0 && table.slice(firstCraft).every(v => v.pad == null),
    ids: table.every((v, i) => v.id === i + 1),
    heldOnShip: ra.instance.held.records.filter(rec => rec.onShip).map(rec => rec.node.userData?.control ?? rec.node.name).sort(),
    pointsOwn: flagA.spawns[0] !== flagB.spawns[0] && flagA.spawns[0].position !== flagB.spawns[0].position,
    pointsEqual: flagA.spawns.every((s, i) => dist(s.position, flagB.spawns[i].position) < 1e-9),
    // The shared report's own rows are not the room's.
    reportUntouched: !level.extras.vehicleSoldierSpawns.includes(flagA.spawns[0]),
  };
}

// --- helm, law, box, narrow, sleep, leave ----------------------------------------
{
  const core = makeCore();
  const helm = makePeer(core), rider = makePeer(core), other = makePeer(core);
  const hH = join(helm, 'HELM', 'helm', 1);
  const hR = join(rider, 'HELM', 'rider', 1);
  join(other, 'ELSE', 'else', 1);
  const room = core.room('HELM'), elsewhere = core.room('ELSE');
  const w = room.world;
  const ship = entryOf(room, 'shokaku');
  const flag = flagOf(room, 'shokaku');
  const all = [helm, rider, other];
  sendJson(helm, MSG_ACTION, { type: 'spawn', team: 1, flag });
  sendJson(rider, MSG_ACTION, { type: 'spawn', team: 1, flag });
  run(core, 'HELM', 30, all);
  const riderSoldier = () => w.player(hR.slot).soldier;
  const inShip = p => { ship.root.updateWorldMatrix(true, false);
    return new THREE.Vector3(...p).applyMatrix4(ship.root.matrixWorld.clone().invert()).toArray(); };
  const deck0 = inShip([riderSoldier().x, riderSoldier().y, riderSoldier().z]);
  const home = worldPos(ship.root);
  const points0 = room.instance.flags[flag].spawns.map(s => s.position.slice());
  const zero = entryOf(room, 'zero');
  const zero0 = worldPos(zero.root);
  const zeroLocal0 = inShip(zero0);

  // Idle at the helm first: she sleeps.
  sendJson(helm, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'enter' });
  run(core, 'HELM', 2, all);
  const drive = w.player(hH.slot).vehicle;
  const driven = w.bodyWorld.get(ship.owner)?.driven;
  out.box = { size: drive?.spec?.size?.map(r3), mass: drive?.spec?.mass, floats: drive?.floats?.length,
              keel: r3(drive?.keel ?? NaN), sampleKeel: r3(drive?.sampleKeel ?? NaN), underside: !!drive?.underside?.length };
  const awakeAtFirst = driven ? !driven.sleeping : null;
  run(core, 'HELM', 150, all, () => { input(helm); input(rider); });
  out.sleep = { awakeAtFirst, asleepIdle: driven?.sleeping ?? null };

  // The bare law beside her: the same node of a room nobody sails, the page's options.
  const twin = entryOf(elsewhere, 'shokaku');
  const inst2 = elsewhere.instance;
  const bare = new Ship(twin.root, inst2.root, {
    cockpit: false, groundHeight: (x, z) => inst2.groundHeightAt(x, z), surfaceFriction: inst2.surfaceFrictionAt,
    waterLevel: inst2.collider.waterLevel, collisionMeshes: level.collisionMeshes,
  });
  bare.groundHeight = (x, z) => { const h = inst2.collider.heightfield.height(x, z); return Number.isFinite(h) ? h : -Infinity; };
  bare.autoFirstPerson = false;
  const spec2 = inst2.ships.specOf(twin.root);
  bare.sampleKeel = hullCollisionKeel(spec2);
  bare.useHullUnderside(hullCollisionLayers(spec2));

  const track = [];
  const candidates = [];
  const SAIL = 360;
  run(core, 'HELM', SAIL, all, i => {
    input(helm, { forward: 1, strafe: i >= 240 ? 1 : 0 });
    input(rider);
    bare.setInput('c_PIThrottle', 1);
    bare.setInput('c_PIYaw', i >= 240 ? 1 : 0);
    bare.integrate(1 / 30);
    if (i === 20) candidates.push(w.bodyWorld.statics.candidateCount());
    if (i % 60 === 59) track.push({ t: (i + 1) / 30, at: worldPos(ship.root).map(r3), speed: r3(drive.state.velocity.length()) });
  });
  const here = worldPos(ship.root);
  const snap = lastSnapshot(rider);
  const row = snap?.vehicles.find(v => v.id === ship.id);
  const q = drive.state.orientation;
  const rs = riderSoldier();
  const deck1 = inShip([rs.x, rs.y, rs.z]);
  const moved = [here[0] - home[0], here[1] - home[1], here[2] - home[2]];
  out.helm = {
    isShip: drive instanceof Ship, shipDrive: drive?.shipDrive === true, kept: ship.shipDrive === drive,
    driver: ship.driver === hH.slot, track,
    sailed: r3(Math.hypot(moved[0], moved[2])), heave: r3(Math.abs(moved[1])),
    awakeUnderWay: driven ? !driven.sleeping : null,
    row: row ? { off: r3(dist([row.x, row.y, row.z], here)), occupied: row.occupied,
                 q: r3(Math.abs(row.q[0] * q.x + row.q[1] * q.y + row.q[2] * q.z + row.q[3] * q.w)),
                 turned: r3(Math.abs(row.q[1])) } : null,
    riderAlive: !w.armorOf(hR.slot).destroyed,
    riderSlid: r3(dist(deck0, deck1)), riderHeight: r3(deck1[1] - deck0[1]),
    // Her deck points went with her, each by her own motion at that point.
    pointsMoved: room.instance.flags[flag].spawns.map((s, i) => r3(dist(s.position, points0[i]))),
    pointsOnDeck: room.instance.flags[flag].spawns.map((s, i) => r3(dist(inShip(s.position), inShipAt(points0[i], ship, home)))),
    elsewherePoints: elsewhere.instance.flags[flagOf(elsewhere, 'shokaku')].spawns
      .map((s, i) => r3(dist(s.position, points0[i]))),
    // Her Zero, held by her spawner: where it stood on her, and no body of its own.
    zeroMoved: r3(dist(worldPos(zero.root), zero0)), zeroOnDeck: r3(dist(inShip(worldPos(zero.root)), zeroLocal0)),
    zeroBody: !!w.bodyWorld.get(zero.owner),
    zeroRow: (() => { const z = snap?.vehicles.find(v => v.id === zero.id); return z ? r3(dist([z.x, z.y, z.z], worldPos(zero.root))) : null; })(),
  };
  /** `p` (world, when she lay at `home` unturned from her load pose) in her frame. */
  function inShipAt(p, entry, homeAt) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...homeAt), entry.home.quaternion, new THREE.Vector3(1, 1, 1));
    return new THREE.Vector3(...p).applyMatrix4(m.invert()).toArray();
  }
  out.law = { off: r3(dist(worldPos(twin.root), here)),
              turn: r3(1 - Math.abs(bare.state.orientation.dot(q))) };

  // The helm let go under way.
  const speedAtExit = drive.state.velocity.length();
  sendJson(helm, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'exit' });
  run(core, 'HELM', 2, all, () => { input(helm); input(rider); });
  const exitAt = worldPos(ship.root);
  const hs = w.player(hH.slot).soldier;
  const leave = { seated: !!w.player(hH.slot).occupancy, driver: ship.driver, coasting: room.instance.ships.coasting,
                  stillDriven: !!w.bodyWorld.get(ship.owner)?.driven, speedAtExit: r3(speedAtExit) };
  run(core, 'HELM', 90, all, () => { input(helm); input(rider); });
  leave.ranOn = r3(dist(worldPos(ship.root), exitAt));
  leave.helmsmanAlive = !w.armorOf(hH.slot).destroyed;
  // Taken again as she goes: the same drive, the speed she had.
  const speedBefore = drive.state.velocity.length();
  sendJson(rider, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'enter' });
  run(core, 'HELM', 1, all, () => { input(helm); input(rider); });
  leave.retaken = { same: w.player(hR.slot).vehicle === drive, driver: ship.driver === hR.slot,
                    coasting: room.instance.ships.coasting,
                    kept: r3(w.player(hR.slot).vehicle?.state.velocity.length() / speedBefore) };
  sendJson(rider, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'exit' });
  // A carrier carries her way for minutes: slower a minute on, still running.
  run(core, 'HELM', 1800, all, () => { input(helm); input(rider); });
  const later = worldPos(ship.root);
  const laterRow = lastSnapshot(helm)?.vehicles.find(v => v.id === ship.id);
  leave.later = { speed: r3(drive.state.velocity.length()), slower: drive.state.velocity.length() < speedAtExit * 0.6,
                  coasting: room.instance.ships.coasting,
                  row: laterRow ? r3(dist([laterRow.x, laterRow.y, laterRow.z], later)) : null,
                  helmsmanAlive: !w.armorOf(hH.slot).destroyed };
  out.leave = leave;
}

// --- narrow ----------------------------------------------------------------------
{
  const pose = cut => {
    const core = makeCore();
    const helm = makePeer(core);
    const h = join(helm, 'NARROW', 'helm', 1);
    const room = core.room('NARROW');
    const ship = entryOf(room, 'shokaku');
    sendJson(helm, MSG_ACTION, { type: 'spawn', team: 1, flag: flagOf(room, 'shokaku') });
    run(core, 'NARROW', 3, [helm]);
    sendJson(helm, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'enter' });
    const statics = room.world.bodyWorld.statics;
    if (!cut) statics.narrow = undefined;
    let count = 0;
    run(core, 'NARROW', 240, [helm], i => {
      input(helm, { forward: 1, strafe: i > 120 ? -1 : 0 });
      if (i === 60) count = statics.candidateCount();
    });
    return { at: worldPos(ship.root), count, q: room.world.player(h.slot).vehicle.state.orientation.toArray() };
  };
  const cut = pose(true), whole = pose(false);
  out.narrow = { same: dist(cut.at, whole.at), turn: Math.hypot(...cut.q.map((v, i) => v - whole.q[i])),
                 kept: cut.count, of: whole.count };
}

// --- craft -----------------------------------------------------------------------
{
  const core = makeCore();
  const a = makePeer(core);
  const h = join(a, 'CRAFT', 'cox', 1);
  const room = core.room('CRAFT');
  const w = room.world;
  sendJson(a, MSG_ACTION, { type: 'spawn', team: 1, flag: flagOf(room, 'shokaku') });
  run(core, 'CRAFT', 3, [a]);
  const boat = room.instance.table.find(v => /daihatsu/i.test(v.template));
  const from = worldPos(boat.root);
  sendJson(a, MSG_ACTION, { type: 'seat', vehicle: boat.id, seat: 0, action: 'enter' });
  run(core, 'CRAFT', 2, [a]);
  const drive = w.player(h.slot).vehicle;
  let pitch = null;
  run(core, 'CRAFT', 300, [a], i => {
    input(a, { forward: 1, pitch: 1 });
    if (i === 30) pitch = drive?.input('c_PIPitch');
  });
  // A helm taken and let go with the hull lying still: at rest at once, out
  // of the body world, and the wire's row of her is her own pose.
  const carrier = entryOf(room, 'shokaku');
  sendJson(a, MSG_ACTION, { type: 'seat', vehicle: boat.id, seat: 0, action: 'exit' });
  run(core, 'CRAFT', 2, [a], () => input(a));
  sendJson(a, MSG_ACTION, { type: 'seat', vehicle: carrier.id, seat: 0, action: 'enter' });
  run(core, 'CRAFT', 2, [a], () => input(a));
  const adopted = !!w.bodyWorld.get(carrier.owner)?.driven;
  sendJson(a, MSG_ACTION, { type: 'seat', vehicle: carrier.id, seat: 0, action: 'exit' });
  run(core, 'CRAFT', 4, [a], () => input(a));
  const restRow = lastSnapshot(a)?.vehicles.find(v => v.id === carrier.id);
  out.rest = { adopted, running: !!room.instance.ships.runningDriveOf(carrier), body: !!w.bodyWorld.get(carrier.owner),
               row: restRow ? r3(dist([restRow.x, restRow.y, restRow.z], worldPos(carrier.root))) : null,
               rowTurned: restRow ? r3(Math.abs(restRow.q[1])) : null, kept: !!carrier.shipDrive };
  const snap = lastSnapshot(a);
  const row = snap?.vehicles.find(v => v.id === boat.id);
  out.craft = { kind: boat.kind, isShip: drive instanceof Ship, seats: room.instance.seatSurveyOf(boat).order,
                sailed: r3(dist(worldPos(boat.root), from)), pitch,
                row: row ? r3(dist([row.x, row.y, row.z], worldPos(boat.root))) : null,
                afloat: r3(worldPos(boat.root)[1] - room.instance.collider.waterLevel) };
}

// --- gun -------------------------------------------------------------------------
{
  const core = makeCore();
  const helm = makePeer(core), gunner = makePeer(core);
  const hH = join(helm, 'GUN', 'helm', 1);
  const hG = join(gunner, 'GUN', 'gunner', 1);
  const room = core.room('GUN');
  const w = room.world;
  const ship = entryOf(room, 'shokaku');
  const flag = flagOf(room, 'shokaku');
  sendJson(helm, MSG_ACTION, { type: 'spawn', team: 1, flag });
  sendJson(gunner, MSG_ACTION, { type: 'spawn', team: 1, flag });
  run(core, 'GUN', 3, [helm, gunner]);
  const home = worldPos(ship.root);
  sendJson(helm, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'enter' });
  // The first of her seats with a gun of its own.
  const survey = room.instance.seatSurveyOf(ship);
  let seatIndex = -1;
  for (let i = 1; i < survey.order && seatIndex < 0; i++) {
    const m = room.instance.mountIntoSeat(w, hG.slot, ship, i);
    if (m && w.player(hG.slot).manned.some(g => g.muzzles?.length)) seatIndex = i;
    room.instance.unmountFromSeat(w, hG.slot, ship);
  }
  sendJson(gunner, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: seatIndex, action: 'enter' });
  run(core, 'GUN', 300, [helm, gunner], () => { input(helm, { forward: 1 }); input(gunner); });
  const gun = w.player(hG.slot).manned[0];
  const ammo0 = gun ? w.fireStateFor(gun.node).ammo : null;
  helm.sent.length = 0;
  const muzzle = new THREE.Vector3();
  let fired = null;
  run(core, 'GUN', 60, [helm, gunner], () => {
    input(helm, { forward: 1 }); input(gunner, { fire: true });
    const shot = room.guns?.guns?.projectiles?.[0];
    if (shot && !fired) fired = { from: dist(shot.mesh.position.toArray(), worldPos(ship.root)) };
  });
  const shots = rowsOf(helm, 'shot').filter(r => r.seat);
  out.gun = { seatIndex, sailed: r3(dist(worldPos(ship.root), home)),
              spent: gun ? ammo0 - w.fireStateFor(gun.node).ammo : null,
              rows: shots.length, slot: shots[0]?.slot === hG.slot,
              // The round leaves her where she is now, not from her pad.
              nearShip: fired ? fired.from < 200 : null, farFromPad: fired ? dist(worldPos(ship.root), home) > 20 : null };
}

// --- a ship's spawner --------------------------------------------------------------
{
  const core = makeCore();
  const helm = makePeer(core), cox = makePeer(core);
  const hH = join(helm, 'SPAWNER', 'helm', 1);
  const hC = join(cox, 'SPAWNER', 'cox', 1);
  const room = core.room('SPAWNER');
  const w = room.world;
  const ship = entryOf(room, 'shokaku');
  const flag = flagOf(room, 'shokaku');
  const all = [helm, cox];
  sendJson(helm, MSG_ACTION, { type: 'spawn', team: 1, flag });
  sendJson(cox, MSG_ACTION, { type: 'spawn', team: 1, flag });
  run(core, 'SPAWNER', 3, all);
  // Her own Daihatsus: the craft rows whose spawner hangs on her.
  const record = room.pads.records.find(r => r.slots && /daihatsu/i.test(r.baked.template)
    && craftSpawnerOf(r.baked.root)?.host === ship.root);
  const [first, second, third] = record.slots;
  const offset0 = Math.hypot(worldPos(first.root)[0] - worldPos(ship.root)[0], worldPos(first.root)[2] - worldPos(ship.root)[2]);
  const spawnRows = () => rowsOf(cox, 'padSpawn').filter(r => record.slots.some(e => e.id === r.vehicle)).map(r => r.vehicle);
  const state = () => record.slots.map(e => (e.live ? (w.vehicleDamage.get(e.owner).destroyed ? 'wreck' : 'live') : 'out'));
  const o = { slots: record.slots.length, delay: [record.spawn.minSpawnDelay, record.spawn.maxSpawnDelay],
              abandon: [record.spawn.timeToLive, record.spawn.distance, record.spawn.damageWhenLost],
              atLoad: state() };
  // Nobody takes one: a minute on there is still one.
  run(core, 'SPAWNER', 30 * 30, all, () => { input(helm); input(cox); });
  o.untouched = state();
  // The carrier sails 60 m, then the cox takes the first craft off.
  sendJson(helm, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'enter' });
  run(core, 'SPAWNER', 360, all, () => { input(helm, { forward: 1 }); input(cox); });
  sendJson(helm, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'exit' });
  sendJson(cox, MSG_ACTION, { type: 'seat', vehicle: first.id, seat: 0, action: 'enter' });
  cox.sent.length = 0;
  let stoodAt = null, stood2 = null;
  run(core, 'SPAWNER', 30 * 30, all, i => {
    input(helm); input(cox, { forward: i < 300 ? 1 : 0, strafe: 1 });
    if (stoodAt == null && second.live) {
      stoodAt = i / 30;
      const p = worldPos(second.root), sh = worldPos(ship.root);
      stood2 = { fromShip: r3(Math.hypot(p[0] - sh[0], p[2] - sh[2])), afloat: r3(p[1] - room.instance.collider.waterLevel),
                 fromLoad: r3(dist(p, record.homes[1].position.toArray())) };
    }
  });
  o.second = { after: stoodAt, ...stood2, offsetAtLoad: r3(offset0), rows: spawnRows(), state: state() };
  // The cox takes the second off as well: the third stands. Then no fourth.
  sendJson(cox, MSG_ACTION, { type: 'seat', vehicle: first.id, seat: 0, action: 'exit' });
  run(core, 'SPAWNER', 2, all, () => { input(helm); input(cox); });
  sendJson(cox, MSG_ACTION, { type: 'seat', vehicle: second.id, seat: 0, action: 'enter' });
  const seated2 = w.player(hC.slot).occupancy?.root === second.root;
  run(core, 'SPAWNER', 30 * 30, all, i => { input(helm); input(cox, { forward: 1, strafe: i < 200 ? -1 : 0 }); });
  o.third = { seated: seated2, state: state(), rows: spawnRows() };
  // The first, left empty far from its spawner: `timeToLive`, then `damageWhenLost` a second.
  const hp = w.vehicleDamage.get(first.owner);
  o.abandoned = { hp: r3(hp.hitPoints), max: hp.maxHitPoints, destroyed: hp.destroyed,
                  far: Math.hypot(worldPos(first.root)[0] - record.at[0], worldPos(first.root)[2] - record.at[2]) > record.spawn.distance };
  let most = 0, lost = false;
  run(core, 'SPAWNER', 30 * 60, all, i => {
    input(helm); input(cox, { forward: 1 });
    most = Math.max(most, record.slots.filter(e => e.live && !w.vehicleDamage.get(e.owner).destroyed).length);
    if (hp.destroyed) lost = true;
  });
  o.later = { state: state(), lost, most, rows: spawnRows().length };
  out.spawner = o;
}

// --- going down ------------------------------------------------------------------
{
  const core = makeCore();
  const a = makePeer(core), b = makePeer(core), c = makePeer(core);
  const hA = join(a, 'SINK', 'deck', 1);
  const hB = join(b, 'SUNK', 'helm', 1);
  join(c, 'BLOW', 'watch', 1);
  // (i) Nobody at the helm, a soldier on her deck: she is shot into critical.
  {
    const room = core.room('SINK');
    const w = room.world;
    const ship = entryOf(room, 'shokaku');
    const flag = flagOf(room, 'shokaku');
    sendJson(a, MSG_ACTION, { type: 'spawn', team: 1, flag });
    run(core, 'SINK', 30, [a], () => input(a));
    const armor = w.vehicleDamage.get(ship.owner);
    const y0 = worldPos(ship.root)[1];
    const point0 = room.instance.flags[flag].spawns[0].position[1];
    const s0 = w.player(hA.slot).soldier.y;
    const before = { hp: armor.hitPoints, critical: armor.criticalDamage, flagged: armor.criticalFlagged };
    armor.damage(armor.hitPoints - armor.criticalDamage + 1);
    const track = [];
    run(core, 'SINK', 600, [a], i => {
      input(a);
      if (i % 150 === 149) {
        const e = ship.root.matrixWorld.elements;
        track.push({ t: (i + 1) / 30, y: r3(worldPos(ship.root)[1] - y0), bow: r3(-e[9]) });
      }
    });
    const row = lastSnapshot(a)?.vehicles.find(v => v.id === ship.id);
    out.sink = { before, flagged: armor.criticalFlagged, destroyed: armor.destroyed, going: room.instance.ships.sinking(ship),
                 track, row: row ? r3(Math.abs(row.y - worldPos(ship.root)[1])) : null,
                 point: r3(room.instance.flags[flag].spawns[0].position[1] - point0),
                 soldier: r3(w.player(hA.slot).soldier.y - s0) };
  }
  // (ii) Under her helmsman: her drive takes the rates, and goes on when he leaves.
  {
    const room = core.room('SUNK');
    const w = room.world;
    const ship = entryOf(room, 'shokaku');
    sendJson(b, MSG_ACTION, { type: 'spawn', team: 1, flag: flagOf(room, 'shokaku') });
    run(core, 'SUNK', 3, [b]);
    sendJson(b, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'enter' });
    run(core, 'SUNK', 60, [b], () => input(b, { forward: 1 }));
    const drive = w.player(hB.slot).vehicle;
    const armor = w.vehicleDamage.get(ship.owner);
    const y0 = worldPos(ship.root)[1];
    armor.damage(armor.hitPoints - armor.criticalDamage + 1);
    run(core, 'SUNK', 300, [b], () => input(b, { forward: 1 }));
    const manned = { armed: drive.sinking === true, y: r3(worldPos(ship.root)[1] - y0), asleep: w.bodyWorld.get(ship.owner)?.driven?.sleeping };
    sendJson(b, MSG_ACTION, { type: 'seat', vehicle: ship.id, seat: 0, action: 'exit' });
    run(core, 'SUNK', 300, [b], () => input(b));
    out.sunk = { manned, left: { y: r3(worldPos(ship.root)[1] - y0), running: !!room.instance.ships.runningDriveOf(ship),
                                 going: room.instance.ships.sinking(ship) } };
  }
  // (iii) Destroyed in one blow from above her threshold: 0x15 alone, no rate.
  {
    const room = core.room('BLOW');
    const w = room.world;
    const boat = room.instance.table.find(v => /daihatsu/i.test(v.template));
    const armor = w.vehicleDamage.get(boat.owner);
    const y0 = worldPos(boat.root)[1];
    armor.damage(armor.hitPoints + 1);
    run(core, 'BLOW', 90, [c], () => input(c));
    out.blow = { destroyed: armor.destroyed, flagged: armor.criticalFlagged, going: room.instance.ships.sinking(boat),
                 y: r3(worldPos(boat.root)[1] - y0), live: boat.live };
  }
}

// --- bots ------------------------------------------------------------------------
{
  const core = makeCore({ enabled: true, perRoom: 8, node: 8, vehicles: true });
  const a = makePeer(core);
  join(a, 'BOTS', 'human', 2);
  const room = core.room('BOTS');
  await room.bots.ready;
  sendJson(a, MSG_ACTION, { type: 'spawn', team: 2 });
  const table = room.instance.table;
  const homes = new Map(table.filter(v => v.kind === 'ship').map(v => [v, worldPos(v.root)]));
  run(core, 'BOTS', 30 * 45, [a], () => input(a));
  const enters = rowsOf(a, 'seatEnter').filter(r => table[r.vehicle - 1]?.kind === 'ship');
  const helms = enters.filter(r => r.seat === 0);
  let far = 0;
  for (const [entry, from] of homes) far = Math.max(far, dist(worldPos(entry.root), from));
  out.bots = { bots: room.bots.count, units: !!room.bots.units, shipSeats: enters.length, helms: helms.length,
               botHelm: helms.some(r => room.bots.slots.has(r.slot)), farthest: r3(far) };
}

// --- bots, the ships left alone (`--bot-ships off`) ---------------------------------
{
  const core = makeCore({ enabled: true, perRoom: 8, node: 8, vehicles: true, ships: false });
  const a = makePeer(core);
  join(a, 'DRY', 'human', 2);
  const room = core.room('DRY');
  await room.bots.ready;
  sendJson(a, MSG_ACTION, { type: 'spawn', team: 2 });
  const table = room.instance.table;
  run(core, 'DRY', 30 * 20, [a], () => input(a));
  out.dry = { bots: room.bots.count,
              helms: rowsOf(a, 'seatEnter').filter(r => table[r.vehicle - 1]?.kind === 'ship' && r.seat === 0).length,
              offered: room.bots.units.candidates().filter(c => c.kind === 'ship').length };
}

// --- the cap: each level at its own cost ----------------------------------------------
{
  const registry = await import(at(HERE, '..', 'server', 'room-registry.mjs'));
  const { LevelTable, levelCost } = await import(at(HERE, '..', 'server', 'level-table.mjs'));
  const M = registry.ROOM_MEMORY, T = registry.BOT_TIERS;
  // The levels' own numbers, as their `scene.json` gives them.
  const scenes = {
    midway: { worldSize: 4096, ai: { searchMaps: [{ name: 'Tank0' }, { name: 'Infantry1' }, { name: 'Boat2', waterMap: true },
                                                  { name: 'LandingCraft3', waterMap: true }, { name: 'Car4' }] } },
    wake: { worldSize: 2048, ai: { searchMaps: [{ name: 'Tank0' }, { name: 'Infantry1' }, { name: 'Boat2', waterMap: true },
                                                { name: 'LandingCraft3', waterMap: true }, { name: 'Car4' }] } },
    berlin: { worldSize: 2048, ai: { searchMaps: [{ name: 'Tank0' }, { name: 'Infantry1' }, { name: 'Car4' }] } },
    stalingrad: { worldSize: 1024, ai: { searchMaps: [{ name: 'Tank0' }, { name: 'Infantry1' }, { name: 'Car4' }] } },
    bare: {},
  };
  const table = () => new LevelTable(Object.keys(scenes), name => Object.create(level, { name: { value: name } }),
    name => levelCost(scenes[name]));
  const core = (budget = M.budget, bots = { enabled: true, perRoom: 15, node: 32, vehicles: true }) =>
    new registry.RoomServerCore({ levels: table(), defaultLevel: 'wake', now: () => 0, memoryBudgetMb: budget, bots,
                                  rules: { gameStartDelay: 0, roundStartDelay: 0 } });
  const one = name => {
    const c = core();
    return { cost: c.levelCost(name), mapMb: Math.round(registry.navMapMb(c.levelCost(name))),
             tier: c.tierFor(name), estimate: c.memoryEstimateMb({ level: name, tier: c.tierFor(name) }),
             all: c.memoryEstimateMb({ level: name, tier: T.hulls }) };
  };
  const o = { memory: M, tiers: T, levels: Object.fromEntries(Object.keys(scenes).map(name => [name, one(name)])) };
  // What Midway's ships tier would need: the budget of a 832Mi limit.
  { const c = core(748); o.raised = { tier: c.tierFor('midway'), estimate: c.memoryEstimateMb({ level: 'midway', tier: T.ships }) }; }
  // Real rooms (every name loads this tree's Wake; the cost is the name's).
  const made = (c, code, name) => {
    const peer = makePeer(c);
    sendJson(peer, MSG_JOIN, { room: code, name: code, team: 1, level: name });
    const room = c.room(code);
    return room ? { tier: room.botTier } : (peer.closed?.reason ?? jsonRow(peer.sent.find(b => b[0] === netcode.MSG_CLOSED) ?? Buffer.from([0, 123, 125])).code ?? 'refused');
  };
  {
    const c = core();
    o.midway = { first: made(c, 'MIDA', 'midway'), estimate: c.memoryEstimateMb(), second: made(c, 'MIDB', 'midway'),
                 other: made(c, 'STAL', 'stalingrad'), rooms: [...c.rooms.keys()] };
    const room = c.room('MIDA');
    await room.bots.ready;
    o.midway.kinds = [...new Set(room.bots.units?.candidates().map(u => u.kind) ?? [])].sort();
    o.midway.botsOn = room.bots.enabled;
  }
  {
    const c = core();
    o.wake = { a: made(c, 'WAKA', 'wake'), b: made(c, 'WAKB', 'wake'), two: c.memoryEstimateMb(),
               berlin: made(c, 'BERL', 'berlin'), three: c.memoryEstimateMb(),
               // The last megabytes: a third level's room runs a lower tier, or none.
               stalingrad: made(c, 'STAL', 'stalingrad'), four: c.memoryEstimateMb() };
    // The hull maps are the level's: the second Wake room's units hold the first's.
    const ra = c.room('WAKA'), rb = c.room('WAKB');
    await ra.bots.ready; await rb.bots.ready;
    o.wake.shared = !!ra.bots.units && Object.getPrototypeOf(ra.bots.units).navByMap === Object.getPrototypeOf(rb.bots.units).navByMap;
    // A room moving to Midway is costed as it will be, without itself.
    o.wake.move = { tier: c.tierFor('midway', { without: 'WAKA' }), changed: c.changeLevel('WAKB', { level: 'midway' }) };
  }
  out.cap = o;
}

console.log = print;
console.log(JSON.stringify(out));
