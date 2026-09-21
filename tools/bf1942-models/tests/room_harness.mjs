// The P2 room server under test: one node run, many assertions.
//
// Same pattern as `world_harness.mjs`/`test_flight.py`: the python side
// stands the vendored `three.module.js` up under `node_modules`, copies the
// viewer + server module graphs into a temp overlay (keeping the real
// `server/ -> ../viewer/` import layout so every module runs unmodified),
// then runs this file once and asserts on the JSON blob it prints.
//
// The room protocol is driven IN-PROCESS with virtual `{send, close}`
// peers — the same core `server.mjs` puts on the socket — so the law is
// tested where it lives, with no ports, no races. Real sockets are the
// `room_socket_test.py` file's job.
//
// Scenarios (the P2 brief's (a)-(h), plus two):
//   a   join handshake: HELLO carries slot/room/level/mode/team/name/slots/
//       maxPlayers/flags/vehicles/tickets; joining an unknown code creates
//       the room on the default level and assigns the tie-winning team
//   b   two players on one 30 Hz clock; inputs isolated per player; the
//       wire snapshots reflect the walker, not his neighbour
//   c   the world's own receive law THROUGH the room's feed: trim<=4
//       drop-oldest, one consume per tick, seq dedupe, idle zero, and the
//       >9 backlog collapse bound on the room's own accumulator
//   d   a late joiner's MSG_JOIN_SNAPSHOT carries the live players' states
//   e   explicit MSG_LEAVE frees the slot and rows broadcast; a silent
//       >10 s connection is swept and closed
//   f   MSG_ACTION seat enter moves the player into the hull pose and
//       broadcasts seatEnter; exit returns him to the exit point
//   g   fire events are throttled to ~0.35 s per player
//   h   the byte budget: a full 16-player snapshot is a few hundred bytes
//   i   the REAL wake level loads headless (env REAL_VIEWER): heightfield
//       lattice + materials + static index + a drivable table, and the
//       mount glue round-trips on a real published map
//   j   the glb-tree contract: a vehicle template's JSON chunk yields the
//       seat hierarchy (seats, springs, fireArms, entries) with no geometry
//   m   P4: a deploy row's `spawnIndex` pins the authority to the page's own
//       spawn point (the snap-back defect), the snapshot carries the input
//       `ack`, and the facing on the wire is degrees
//
// Laws cited are the engine's (`netcode.md` §1/§2/§5, J-3) as pinned by
// `features/netcode-play-multiplayer/README.md` P2.

import {
  RoomServerCore, frame,
} from './server/rooms.mjs';
import { buildLevelFromDescriptor, loadRealLevel } from './server/level.mjs';
import { loadVehicleTree } from './server/glb-tree.mjs';
import {
  MSG_JOIN, MSG_ACTION, MSG_INPUT, MSG_LEAVE, MSG_SNAPSHOT, MSG_EVENT,
  MSG_HELLO, MSG_JOIN_SNAPSHOT, MSG_PING,
  encodeInputFrame, decodeSnapshot,
} from './viewer/netcode.js';
import { VehicleOccupancy, classifyRoot, listEntryPoints } from './viewer/seats.js';
import { MAX_CATCH_UP_TICKS } from './viewer/physics.js';
import { HEARTBEAT_TIMEOUT_MS, SPAWN_INDEX_MAX } from './server/rooms.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The overlay's own viewer dir: where the harness runs, `../viewer` sits
// beside it (the python test copies the module graph there), which is also
// where `viewer/models/Willy.glb` + `Zero.glb` land — never the cwd, which
// is the repo root when python drives the subprocess.
const OVERLAY = fileURLToPath(new URL('.', import.meta.url));
const VIEWER_DIR = join(OVERLAY, 'viewer');

const FRAME_MS = 1000 / 30;

function makePeer(tag) {
  return {
    tag,
    sent: [],
    closed: null,
    send(bytes) { this.sent.push(Buffer.from(bytes)); },
    close(code, reason) { this.closed = { code, reason }; },
  };
}

function attachPeer(core, tag) {
  const peer = makePeer(tag);
  peer._core = core;
  core.attach(peer);
  return peer;
}

function ofType(peer, type) {
  return peer.sent.filter(b => b[0] === type);
}

function jsonRow(buf) {
  return JSON.parse(Buffer.from(buf.subarray(1)).toString('utf8'));
}

function send(peer, type, payload) {
  peer._core.onMessage(peer, frame(type, payload));
}

function sendJson(peer, type, row) {
  send(peer, type, Buffer.from(JSON.stringify(row)));
}

function sendInput(peer, seq, input, look = { x: 0, y: 0 }) {
  send(peer, MSG_INPUT, encodeInputFrame(seq, input, look));
}

function joinPeer(core, peer, room, name, team = 0) {
  sendJson(peer, MSG_JOIN, { room, name, team });
  const helloBuf = peer.sent.find(b => b[0] === MSG_HELLO);
  return helloBuf ? jsonRow(helloBuf) : null;
}

function walkInput(over = {}) {
  return { forward: 1, strafe: 0, walk: false, crouch: false, prone: false,
           jump: false, fire: false, altFire: false, roll: 0, pitch: 0,
           pad: false, ...over };
}

const results = {};

// --- the rig: the fake level + a manual clock ---------------------------------
const clock = { ms: 0 };
const levelData = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR });
const core = new RoomServerCore({
  levels: new Map([['test', levelData]]),
  defaultLevel: 'test',
  now: () => clock.ms,
});
let nextTag = 1;

// --- (a) join handshake --------------------------------------------------------
{
  const p1 = attachPeer(core, String(nextTag++));
  const hello = joinPeer(core, p1, 'AAA', 'One', 0);
  const snap = ofType(p1, MSG_JOIN_SNAPSHOT);
  results.a = {
    helloOk: Boolean(hello && hello.slot === 1 && hello.room === 'AAA'
      && hello.level === 'test' && hello.mode === 'Conquest'
      && hello.team === 1                          // tie -> team 1
      && hello.name === 'One' && Array.isArray(hello.slots) && hello.slots.length === 0
      && hello.slots.every(s => Number.isInteger(s.slot))
      && hello.maxPlayers === 16
      && Array.isArray(hello.flags) && hello.flags.length === 2
      && hello.flags.every(f => Number.isInteger(f.team))
      && Array.isArray(hello.vehicles) && hello.vehicles.length === 2
      && hello.vehicles.every(v => Number.isInteger(v.id) && typeof v.template === 'string')
      && hello.tickets.team1 === 100 && hello.tickets.team2 === 100),
    flags: hello?.flags,
    vehicles: hello?.vehicles,
    joinSnapOk: snap.length === 1,
    lobby: core.roomList().find(r => r.code === 'AAA'),
  };
}

// --- (b) two players, one 30 Hz clock, input isolation -------------------------
{
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  joinPeer(core, pA, 'BBB', 'One', 0);
  joinPeer(core, pB, 'BBB', 'Two', 0);
  const room2 = core.room('BBB');
  const c1 = room2.players.get(1);
  const c2 = room2.players.get(2);
  const w = room2.world;
  c1.peer.sent.length = 0;
  c2.peer.sent.length = 0;
  // The deploy actions move the soldier to the flag's spawn line; capture
  // the poses AFTER them so the walk law measures only the walk.
  sendJson(c1.peer, MSG_ACTION, { type: 'spawn', flag: 0 });
  sendJson(c2.peer, MSG_ACTION, { type: 'spawn', flag: 1 });
  const spawn1 = { x: w.player(1).soldier.x, z: w.player(1).soldier.z };
  const spawn2 = { x: w.player(2).soldier.x, z: w.player(2).soldier.z };
  let seq = 0;
  for (let i = 0; i < 30; i++) {
    seq++;
    sendInput(c1.peer, seq, walkInput());
    clock.ms += FRAME_MS;
    room2.frame(FRAME_MS);
  }
  const p1Now = w.player(1).soldier;
  const p2Now = w.player(2).soldier;
  const snaps = ofType(c2.peer, MSG_SNAPSHOT);
  let p1WireTravelled = -1;
  if (snaps.length) {
    const last = decodeSnapshot(snaps.at(-1).subarray(1));
    const row = last.players.find(p => p.slot === 1);
    p1WireTravelled = row
      ? Math.hypot(row.x - spawn1.x, row.z - spawn1.z) : -1;
  }
  results.b = {
    ticksRun: room2.clock.ticks,
    p1Travelled: Math.hypot(p1Now.x - spawn1.x, p1Now.z - spawn1.z),
    p2Still: Math.hypot(p2Now.x - spawn2.x, p2Now.z - spawn2.z),
    snapshots: snaps.length,
    p1WireTravelled,
  };
}

// --- (c) the world's receive law through the room's own feed -------------------
{
  const room3 = core.room('AAA');
  const peer = room3.players.get(1).peer;
  const w = room3.world;
  const player = w.player(1);
  player.buffer.length = 0;
  player.lastSeen = -1;
  // Burst: six sequenced packets in one lap — the receive law trims to four,
  // dropping the oldest; the very first tick consumes the oldest survivor.
  for (let s = 1; s <= 6; s++) sendInput(peer, s, walkInput(), { x: 0, y: 0 });
  clock.ms += FRAME_MS;
  room3.frame(FRAME_MS);
  const afterOne = {
    length: player.buffer.length,
    seqs: [...player.buffer.map(e => e.seq)],
    consumed: player.last?.seq,
    lastSeen: player.lastSeen,
  };
  // A duplicate seq is ignored (D-3); the next tick pops the next oldest.
  sendInput(peer, 3, walkInput(), { x: 0, y: 0 });
  clock.ms += FRAME_MS;
  room3.frame(FRAME_MS);
  // A fresh seq appends; ticks consume 5, then 6, then 9.
  sendInput(peer, 9, walkInput({ forward: 0 }), { x: 0, y: 0 });
  clock.ms += FRAME_MS;
  room3.frame(FRAME_MS);
  const afterDedupe = player.last?.seq;         // 5
  clock.ms += FRAME_MS;
  room3.frame(FRAME_MS);                        // consumes 6
  clock.ms += FRAME_MS;
  room3.frame(FRAME_MS);                        // consumes 9
  clock.ms += FRAME_MS;
  room3.frame(FRAME_MS);                        // empty -> the zeroed idle word
  const idleForward = player.last?.input?.forward;
  // Backlog collapse: one giant lap runs at most MAX_CATCH_UP_TICKS ticks
  // and drops the rest (the D-4 >9 collapse, in the room's own accumulator).
  const before = room3.clock.ticks;
  clock.ms += 5000;
  room3.frame(5000);
  results.c = {
    afterOne,
    // The wire law is trim-to-4 THEN consume-one: the burst of six lands
    // four ([3,4,5,6]) and the tick pops 3, so the surviving buffer holds
    // exactly three.
    capOk: afterOne.length === 3 && afterOne.consumed === 3 && afterOne.lastSeen === 6,
    dedupeOk: player.lastSeen === 9,
    consumedAfterDedupe: afterDedupe,
    idleOk: idleForward === 0,
    collapse: {
      ran: room3.clock.ticks - before,
      max: MAX_CATCH_UP_TICKS,
      bounded: room3.clock.ticks - before <= MAX_CATCH_UP_TICKS,
    },
  };
}

// --- (d) a late join's snapshot carries the live state -------------------------
{
  const room4 = core.room('BBB');
  const p3 = attachPeer(core, String(nextTag++));
  joinPeer(core, p3, 'BBB', 'Three', 0);
  const snap = ofType(p3, MSG_JOIN_SNAPSHOT).at(-1);
  const decoded = snap ? decodeSnapshot(snap.subarray(1)) : null;
  const walker = decoded?.players.find(p => p.slot === 1);
  results.d = {
    joinOk: room4.playerCount() === 3,
    livePlayers: decoded?.players.length,
    walkerAlive: Boolean(walker?.alive),
    walkerTravelled: walker ? Math.hypot(walker.x - 10, walker.z - 10) : -1,
    bothTeams: decoded ? new Set(decoded.players.map(p => p.team)).size : 0,
  };
}

// --- (e) explicit leave + the silent drop sweep --------------------------------
{
  const room5 = core.room('BBB');
  const c1 = room5.players.get(1);
  const c2 = room5.players.get(2);
  c1.peer.sent.length = 0;
  sendJson(c2.peer, MSG_LEAVE, {});
  const leaveRow = ofType(c1.peer, MSG_EVENT).map(jsonRow)
    .find(r => r.type === 'leave');
  const slotFreed = !room5.players.has(2);
  const pNew = attachPeer(core, String(nextTag++));
  const hello = joinPeer(core, pNew, 'BBB', 'Back', 0);
  const sweepRoom = core.room('AAA');
  const watcher = attachPeer(core, String(nextTag++));
  joinPeer(core, watcher, 'AAA', 'Watcher', 0);
  const victim = sweepRoom.players.get(1);
  const witness = sweepRoom.players.get(2);
  witness.peer.sent.length = 0;
  victim.lastSeen = 0;                       // silent since the epoch
  clock.ms += HEARTBEAT_TIMEOUT_MS + 100;    // past the sweep window
  sweepRoom.frame(0);                        // a no-elapsed lap: sweep only
  const leaveRows = ofType(witness.peer, MSG_EVENT).map(jsonRow);
  results.e = {
    leaveOk: Boolean(leaveRow && leaveRow.type === 'leave' && leaveRow.slot === 2),
    slotFreed,
    reuseOk: hello?.slot === 2,
    sweepDropped: Boolean(victim.peer.closed),
    sweepRow: leaveRows.find(r => r.type === 'leave')?.slot ?? null,
  };
}

// --- (f) MSG_ACTION seat enter / exit -----------------------------------------
{
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  joinPeer(core, pA, 'CCC', 'Seater', 0);
  joinPeer(core, pB, 'CCC', 'Witness', 0);
  const room6 = core.room('CCC');
  const w = room6.world;
  pA.sent.length = 0;
  pB.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0 });
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'enter' });
  clock.ms += FRAME_MS;
  room6.frame(FRAME_MS);
  const entry1 = room6.instance.table.find(v => v.id === 1);
  const driverSeen = entry1.driver === 1;    // read BEFORE the exit below
  const pose = w.vehiclePose(entry1.owner);
  const snap = ofType(pB, MSG_SNAPSHOT).at(-1);
  const seen = snap ? decodeSnapshot(snap.subarray(1)).players.find(p => p.slot === 1) : null;
  const enterRow = ofType(pB, MSG_EVENT).map(jsonRow).find(r => r.type === 'seatEnter');
  const snapOk = Boolean(seen && seen.seated && seen.inVehicle
    && seen.vehicleId === 1 && seen.seatIndex === 0
    && Math.hypot(seen.x - pose.x, seen.z - pose.z) < 1e-3);
  const held = w.player(1).occupancy?.root === entry1.root;
  // Exit: seatExit broadcasts and the soldier stands at the exit point.
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'exit' });
  const exitRow = ofType(pB, MSG_EVENT).map(jsonRow).find(r => r.type === 'seatExit');
  const soldier = w.player(1).soldier;
  results.f = {
    enterRow: enterRow && { type: enterRow.type, slot: enterRow.slot,
      vehicle: enterRow.vehicle, seat: enterRow.seat },
    snapOk,
    held,
    driverSeen,
    exitRow: exitRow && { type: exitRow.type, slot: exitRow.slot },
    unmounted: w.player(1).occupancy === null,
    exitDist: Math.hypot(soldier.x - pose.x, soldier.z - pose.z),
  };
}

// --- (g) fire throttling -------------------------------------------------------
{
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  joinPeer(core, pA, 'DDD', 'Firer', 0);
  joinPeer(core, pB, 'DDD', 'Bystander', 0);
  const room7 = core.room('DDD');
  pA.sent.length = 0;
  pB.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0 });
  let seq = 100;
  for (let i = 0; i < 35; i++) {
    seq++;
    sendInput(pA, seq, walkInput({ fire: true }));
    clock.ms += FRAME_MS;
    room7.frame(FRAME_MS);
  }
  const fireRows = ofType(pB, MSG_EVENT).map(jsonRow).filter(r => r.type === 'fire');
  const gaps = [];
  for (let i = 1; i < fireRows.length; i++) gaps.push(fireRows[i].t - fireRows[i - 1].t);
  results.g = {
    events: fireRows.length,
    gaps,
    throttled: fireRows.length >= 2 && gaps.every(g => g >= 9),
    sameSlot: fireRows.length && fireRows.every(r => r.slot === 1),
  };
}

// --- (h) the byte budget at 16 players -----------------------------------------
{
  const peers = [];
  const roomCode = 'EEE';
  for (let i = 0; i < 16; i++) {
    const p = attachPeer(core, String(nextTag++));
    peers.push(p);
    joinPeer(core, p, roomCode, `P${i}`, 0);
  }
  const room8 = core.room(roomCode);
  for (const [slot, conn] of room8.players) {
    conn.peer.sent.length = 0;
    sendJson(conn.peer, MSG_ACTION, { type: 'spawn', flag: 0 });
  }
  const watcher = room8.players.get(1).peer;
  watcher.sent.length = 0;
  clock.ms += FRAME_MS;
  room8.frame(FRAME_MS);
  const snap = ofType(watcher, MSG_SNAPSHOT).at(-1);
  const decoded = snap ? decodeSnapshot(snap.subarray(1)) : null;
  results.h = {
    players: room8.playerCount(),
    bytes: snap ? snap.length : -1,
    decodedPlayers: decoded?.players.length ?? 0,
    ok: Boolean(snap && snap.length <= 640 && decoded?.players.length === 16),
  };
}

// --- (i) the real wake level, headless ----------------------------------------
{
  const real = process.env.REAL_VIEWER;
  if (real) {
    const data = loadRealLevel({ viewerDir: real, name: 'wake' });
    const hf = data.heightfield;
    let filled = 0;
    for (const h of hf.heights) if (!Number.isNaN(h)) filled++;
    const inst = data.instantiate();
    const w = inst.world;
    const kinds = new Set(inst.table.map(v => v.kind));
    const drivable = inst.table.find(v => ['air', 'ground', 'tank'].includes(v.kind));
    let mountOk = false, unmountOk = false;
    if (drivable) {
      w.addPlayer(1, { team: 1 });
      const m = inst.mountIntoSeat(w, 1, drivable, 0);
      mountOk = Boolean(m?.vehicle) && drivable.driver === 1;
      unmountOk = Boolean(m && inst.unmountFromSeat(w, 1, drivable));
    }
    results.i = {
      loaded: true,
      dim: hf.dim,
      spacing: hf.spacing,
      latticeFilled: filled,
      latticeCells: hf.heights.length,
      materials: hf.materials?.length ?? 0,
      table: inst.table.map(v => `${v.template}:${v.kind}`),
      statics: Boolean(inst.statics),
      collider: Boolean(w.collider),
      mountOk,
      unmountOk,
      kinds: [...kinds],
    };
  } else {
    results.i = { loaded: false };
  }
}

// --- (j) the glb-tree contract --------------------------------------------------
{
  const willy = loadVehicleTree(join(VIEWER_DIR, 'models', 'Willy.glb'));
  const zero = loadVehicleTree(join(VIEWER_DIR, 'models', 'Zero.glb'));
  const count = (tree, kind) => {
    let n = 0;
    tree.traverse(obj => {
      if (obj.userData?.templateKind === kind) n++;
    });
    return n;
  };
  results.j = {
    willy: {
      control: willy.userData?.control,
      kind: classifyRoot(willy),
      seats: count(willy, 'SeatObject'),
      springs: count(willy, 'Spring'),
      fireArms: count(willy, 'FireArms'),
      entries: listEntryPoints(willy).length,
    },
    zero: {
      control: zero.userData?.control,
      kind: classifyRoot(zero),
      entries: listEntryPoints(zero).length,
      fireArms: count(zero, 'FireArms'),
      seatables: new VehicleOccupancy(zero).order.length,
    },
    occupancySurvey: (() => {
      const occ = new VehicleOccupancy(willy);
      return occ.order.join(',');
    })(),
  };
}

// --- (k) P3: armor at spawn, the death decree, respawn -------------------------
// The authority: a spawn builds the kit's Armor; destroying it inside the
// world makes the room decree a death (killed row, ticket row, input gate),
// and the deploy action revives.
{
  const pk = attachPeer(core, String(nextTag++));
  const hk = joinPeer(core, pk, 'KKK', 'K', 0);
  const kRoom = core.room('KKK');
  const kPeer = kRoom.players.get(1).peer;
  const kw = kRoom.world;
  // A spawn: fresh Armor at the kit's max (30 — the harness's loadouts-less
  // sidecar falls back exactly as the page does).
  sendJson(kPeer, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const armorAtSpawn = { hp: kw.armorOf(1)?.hitPoints ?? null,
                         max: kw.armorOf(1)?.maxHitPoints ?? null };
  // The death decree: the world's own damage funnel drops the Armor.
  kw.armorOf(1).applyDamage(999);
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const rows = kPeer.sent.map(b => b[0] === MSG_EVENT ? jsonRow(b) : null)
    .filter(Boolean);
  const killed = rows.find(r => r.type === 'killed');
  const deathTicket = rows.find(r => r.type === 'ticket' && r.reason === 'death');
  const deadLatch = kRoom.authority.dead.has(1);
  const lastSnap = ofType(kPeer, MSG_SNAPSHOT).at(-1);
  const aliveOnWire = lastSnap
    ? decodeSnapshot(lastSnap.subarray(1)).players.find(p => p.slot === 1)?.alive
    : null;
  // The input gate: a dead player's word does not reach the world.
  kw.player(1).pending = null;
  sendInput(kPeer, 1000, walkInput());
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const deadPending = kw.player(1).pending;
  // Respawn revives: fresh Armor, the decree lifted, the walk works again.
  sendJson(kPeer, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const hpAfterRespawn = kw.armorOf(1)?.hitPoints ?? null;
  sendInput(kPeer, 1001, walkInput());
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  results.k = {
    armorAtSpawn,
    hpAtSpawnOk: armorAtSpawn.hp === 30 && armorAtSpawn.max === 30,
    killedRow: killed && killed.slot === 1 && killed.other == null,
    deathTicket: deathTicket && deathTicket.team === 1 && deathTicket.count === 99,
    deadLatch,
    aliveOnWire: aliveOnWire === false,
    deadPending,
    hpAfterRespawn,
    reviveOk: hpAfterRespawn === 30 && !kRoom.authority.dead.has(1),
  };
}

// --- (l) P3: flag capture and the majority bleed -------------------------------
// The law: an un-contested enemy inside the ring flips the owner after
// FLAG_CAPTURE_SECONDS; both teams present freezes; then the majority-flag
// timer drains the loser's `lossPerMin` once a second.
{
  const pl = attachPeer(core, String(nextTag++));
  const hl = joinPeer(core, pl, 'LLL', 'L', 0);       // first: team 1
  const lRoom = core.room('LLL');
  const lw = lRoom.world;
  sendJson(pl, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });   // North
  lRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const northBefore = lw.flags[0].team;
  // The capture: teleport the lone player to the ENEMY's South flag and
  // stand there for the full window — the capture law reads only positions.
  lw.player(1).soldier.spawn(-10, 0, -10);
  // A second player (team 2 — the tie rule offers it) keeps the ring
  // defended: contest freezes progress.
  const p2 = attachPeer(core, String(nextTag++));
  joinPeer(core, p2, 'LLL', 'D', 0);
  const l2Peer = core.room('LLL').players.get(2).peer;
  sendJson(l2Peer, MSG_ACTION, { type: 'spawn', flag: 1, kit: 'assault' });
  lw.player(2).soldier.spawn(-10.5, 0, -10);
  // The heartbeat: the server sweeps a connection silent for 15 s, and this
  // scenario spans more than that — ping like the page's own room client.
  const pingPeers = () => {
    const t = clock.ms & 0xffffffff;
    const ping = peer => send(peer, MSG_PING,
      Buffer.from([t & 0xff, (t >> 8) & 0xff, (t >> 16) & 0xff, (t >> 24) & 0xff]));
    for (const c of lRoom.players.values()) ping(c.peer);
  };
  let sincePing = 0;
  const tick = n => {
    for (let i = 0; i < n; i++) {
      lRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
      if (++sincePing >= 150) { sincePing = 0; pingPeers(); }
    }
  };
  tick(60);
  const contestFroze = lw.flags[1].team === 2;
  const capturedBefore = lRoom.players.get(1).peer.sent
    .filter(b => b[0] === MSG_EVENT).map(b => jsonRow(b))
    .some(r => r.type === 'captured');
  // The defender leaves the map: lone team-1 inside South -> the capture
  // runs to completion, and team 2 ends up holding nothing at all (the
  // majority the bleed keys off).
  lw.player(2).soldier.spawn(50, 0, 50);
  tick(300);
  const rowsAfter = lRoom.players.get(1).peer.sent
    .filter(b => b[0] === MSG_EVENT).map(b => jsonRow(b));
  const capturedAfter = rowsAfter.find(r => r.type === 'captured');
  const southNow = lw.flags[1].team;
  // Both flags are team 1's now: team 2 owns nothing capturable, so team 2
  // bleeds 30/60 per second — a `flag_majority` row within a few seconds.
  let majorityRow = null;
  for (let i = 0; i < 240 && !majorityRow; i++) {
    tick(1);
    majorityRow = lRoom.players.get(1).peer.sent
      .filter(b => b[0] === MSG_EVENT).map(b => jsonRow(b))
      .find(r => r.type === 'ticket' && r.reason === 'flag_majority');
  }
  results.l = {
    northBefore,
    southBefore: 2,
    contestFroze,
    capturedBefore,
    capturedRow: capturedAfter && {
      flag: capturedAfter.flag, team: capturedAfter.team, name: capturedAfter.name,
    },
    southTeamAfter: southNow,
    southFlipped: southNow === 1 && !capturedBefore,
    majorityRow: majorityRow
      ? { team: majorityRow.team, count: majorityRow.count } : null,
    bleedTicket: majorityRow?.team === 2 && majorityRow.count < 100,
  };
}

// --- (m) P4: one spawn pick, the input ack, and the wire's own units ----------
// The snap-back defect (features/netcode-play-multiplayer/SNAPBACK.md): the
// authority walked the flag's spawn list on every deploy row while the page did
// not, so the two sims stood the same soldier on DIFFERENT spawn points of the
// same flag -- 45 m and 17.7 deg apart on Aberdeen -- and both then ran the
// same forward word along different headings until the correction teleported
// the player back, twice a second, forever.
//
// Three things are pinned here:
//   * a deploy row carrying `spawnIndex` puts the authority on exactly that
//     spawn point, and does NOT advance past it;
//   * a row without one keeps the old walk (a client that does not send it);
//   * the snapshot carries the input `ack` and the facing in DEGREES, which is
//     what makes the client's reconciliation possible and its remotes point the
//     right way.
{
  const pm = attachPeer(core, String(nextTag++));
  joinPeer(core, pm, 'MMM', 'M', 0);
  const mRoom = core.room('MMM');
  const mPeer = mRoom.players.get(1).peer;
  const mw = mRoom.world;
  const flag = mw.flags[0];

  // The page's own pick, made with the page's own call, so the two sides are
  // compared against one law rather than two.
  const asPage = new Map();
  for (const index of [0, 1, 2]) {
    mw.player(1).spawnIndex = index;
    mw.spawnPlayer(1, { flag });
    asPage.set(index, { x: mw.player(1).soldier.x, z: mw.player(1).soldier.z,
                        yaw: mw.player(1).soldier.yaw,
                        name: mw.player(1).spawn?.name ?? null });
  }

  // A pinned row: the authority lands on the point the row names, and stays on
  // it (no advance).
  const pinned = [];
  for (const index of [0, 1, 2]) {
    sendJson(mPeer, MSG_ACTION, { type: 'spawn', flag: 0, spawnIndex: index });
    mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
    const sol = mw.player(1).soldier;
    const want = asPage.get(index);
    pinned.push({
      index,
      spawnIndex: mw.player(1).spawnIndex,
      name: mw.player(1).spawn?.name ?? null,
      pageName: want.name,
      agrees: Math.hypot(sol.x - want.x, sol.z - want.z) < 1e-6
        && Math.abs(sol.yaw - want.yaw) < 1e-9,
      yawGapDeg: Math.abs(sol.yaw - want.yaw) * 180 / Math.PI,
    });
  }

  // No index in the row: the authority keeps walking the list itself.
  mw.player(1).spawnIndex = 0;
  sendJson(mPeer, MSG_ACTION, { type: 'spawn', flag: 0 });
  mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const unpinnedIndex = mw.player(1).spawnIndex;

  // The ack and the units, on the wire.
  sendJson(mPeer, MSG_ACTION, { type: 'spawn', flag: 0, spawnIndex: 0 });
  mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  mPeer.sent.length = 0;
  const ackTrace = [];
  for (let i = 1; i <= 4; i++) {
    sendInput(mPeer, 500 + i, walkInput());
    // Two laps per word so the 20 Hz snapshot stream fires for each of them.
    mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
    mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
    const snap = ofType(mPeer, MSG_SNAPSHOT).at(-1);
    const row = snap
      ? decodeSnapshot(snap.subarray(1)).players.find(p => p.slot === 1) : null;
    if (row) ackTrace.push({ ack: row.ack, yaw: row.yaw });
  }
  // An idle tick does not move the acknowledgement on: the engine's zeroed
  // word carries no seq, so there is nothing new for the client to reconcile
  // against.
  mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const lastSnapM = ofType(mPeer, MSG_SNAPSHOT).at(-1);
  const afterIdle = lastSnapM
    ? decodeSnapshot(lastSnapM.subarray(1)).players.find(p => p.slot === 1)?.ack
    : null;

  // The units. The descriptor level authors no spawn rotation, so turn the
  // soldier with a look word and read the facing back off the wire: degrees,
  // matching the World's radians exactly (`netcode-render.js` converts with
  // its own rad(), and shipping radians under a degrees field drew every
  // remote soldier at a 57th of its heading).
  for (let i = 1; i <= 6; i++) {
    sendInput(mPeer, 600 + i, walkInput(), { x: 4, y: 0 });
    mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
    mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  }
  const turnedSnap = ofType(mPeer, MSG_SNAPSHOT).at(-1);
  const turnedRow = turnedSnap
    ? decodeSnapshot(turnedSnap.subarray(1)).players.find(p => p.slot === 1) : null;

  results.m = {
    pinned,
    unpinnedIndex,
    ackTrace,
    afterIdle,
    soldierYawDeg: mw.player(1).soldier.yaw * 180 / Math.PI,
    soldierYawRad: mw.player(1).soldier.yaw,
    wireYawDeg: turnedRow?.yaw ?? null,
    spawnIndexMax: SPAWN_INDEX_MAX,
  };
  // A row with an absurd index is clamped out rather than trusted into a
  // modulo over a huge number.
  sendJson(mPeer, MSG_ACTION, { type: 'spawn', flag: 0, spawnIndex: 1e12 });
  mRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  results.m.absurdIndex = mw.player(1).spawnIndex;
}

console.log(JSON.stringify(results));
