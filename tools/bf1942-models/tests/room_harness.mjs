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
//   n-q the bleed (ledger TKT-4) on rooms with nobody in them: Battle of
//       Britain's flagless `Allied_Base` bleeds the Axis from the first
//       frame; Wake's five points at 20 bleed Japan while the US holds all
//       five and nobody at four; a gate shut for one tick refills the
//       countdown; a level's own max players scales the round once
//
// Laws cited are the engine's (`netcode.md` §1/§2/§5, J-3) as pinned by
// `features/netcode-play-multiplayer/README.md` P2.

import {
  RoomServerCore, frame,
} from './server/rooms.mjs';
import { buildLevelFromDescriptor, loadRealLevel } from './server/level.mjs';
import { bodySpecFor } from './server/level-bodies.mjs';
import { loadVehicleTree } from './server/glb-tree.mjs';
import {
  MSG_JOIN, MSG_ACTION, MSG_INPUT, MSG_LEAVE, MSG_SNAPSHOT, MSG_EVENT,
  MSG_HELLO, MSG_JOIN_SNAPSHOT, MSG_PING,
  encodeInputFrame, decodeSnapshot,
} from './viewer/netcode.js';
import { VehicleOccupancy, classifyRoot, listEntryPoints } from './viewer/seats.js';
import { MAX_CATCH_UP_TICKS } from './viewer/physics.js';
import { flagSide } from './viewer/spawn-flags.js';
import { HEARTBEAT_TIMEOUT_MS, SPAWN_INDEX_MAX } from './server/rooms.mjs';
import { chokeRates } from './server/room-stream.mjs';
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

/** Step a room, one frame at a time through `step(1)`, until `slot`'s
 *  reinforcement wave has them (SPAWN-35, `authority.spawnWaitLeft`). At
 *  most one cycle and a window, 30 s. Every player is still there while
 *  they wait: their pages would be pinging, so the idle drop never comes. */
function stepPastWave(room, slot, step) {
  for (let i = 0; i < 31 * 30 && room.authority.spawnWaitLeft(slot) > 0; i++) {
    for (const connection of room.players.values()) connection.lastSeen = room.now();
    step(1);
  }
}

// --- the rig: the fake level + a manual clock ---------------------------------
const clock = { ms: 0 };
const levelData = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR });
const core = new RoomServerCore({
  levels: new Map([['test', levelData]]),
  defaultLevel: 'test',
  now: () => clock.ms,
  // No pre-game (ROUND-14) for the scenarios below, which spawn from the
  // first tick; `preGameScenario` plays the shipped 20 / 10.
  rules: { gameStartDelay: 0, roundStartDelay: 0 },
  // The auto-team's tie (`getTeamToAddPlayer`'s `rand() & 1`) lands on team
  // 1 here, so the scenarios below join on a known side.
  random: () => 0,
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
  // Backlog collapse, retail's server law (D-4, `GameServer::update`
  // 0x08132955): a lap owing more than nine ticks runs ONE; nine run whole.
  const before = room3.tick;
  clock.ms += 5000;
  room3.frame(5000);
  const ranGiant = room3.tick - before;
  const beforeTen = room3.tick;
  clock.ms += 10 * 1000 / 30 + 1;
  room3.frame(10 * 1000 / 30 + 1);
  const ranTen = room3.tick - beforeTen;
  const beforeNine = room3.tick;
  clock.ms += 9 * 1000 / 30 + 1;
  room3.frame(9 * 1000 / 30 + 1);
  const ranNine = room3.tick - beforeNine;
  results.c = {
    afterOne,
    // The wire law is trim-to-4 THEN consume-one: the burst of six lands
    // four ([3,4,5,6]) and the tick pops 3, so the surviving buffer holds
    // exactly three.
    capOk: afterOne.length === 3 && afterOne.consumed === 3 && afterOne.lastSeen === 6,
    dedupeOk: player.lastSeen === 9,
    consumedAfterDedupe: afterDedupe,
    idleOk: idleForward === 0,
    collapse: { ranGiant, ranTen, ranNine, lost: room3.ticksLost },
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

// --- (f2) a wreck has no door (SEAT-28) ----------------------------------------
// The room refuses a seat of a destroyed hull as the page does
// (`vehicle-entry.js` `enterVehicle`): FHSWEurope 203 Hill's Stationary_Vickers,
// destroyed by the battery uphill, took a man who could neither aim nor fire.
{
  const pW = attachPeer(core, String(nextTag++));
  joinPeer(core, pW, 'WRK', 'Wrecker', 0);
  const room = core.room('WRK');
  const w = room.world;
  sendJson(pW, MSG_ACTION, { type: 'spawn', flag: 0 });
  const entry = room.instance.table.find(v => v.id === 1);
  const hull = w.vehicleDamage.get(entry.owner);
  hull.damage(hull.hitPoints + 1);
  pW.sent.length = 0;
  sendJson(pW, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'enter' });
  const slot = [...w.players.keys()].at(-1);
  // A late joiner is told the hit place with the hull's hit points: the third
  // word of HELLO's `damage.hulls` row, the side of the world x (PHY-46).
  hull.criticalFlagged = true;
  hull.criticalHitX = -3;
  const lateRow = room.pads.damageState().hulls.find(r => r[0] === 1) ?? null;
  hull.criticalHitX = 4;
  const lateRowRight = room.pads.damageState().hulls.find(r => r[0] === 1) ?? null;
  hull.criticalFlagged = false;
  const lateRowPlain = room.pads.damageState().hulls.find(r => r[0] === 1) ?? null;
  results.f2 = {
    destroyed: hull.destroyed,
    refused: ofType(pW, MSG_EVENT).map(jsonRow).some(r => r.type === 'seatRefused'),
    seated: w.player(slot)?.occupancy != null,
    lateRow, lateRowRight, lateRowPlain,
  };
}

// --- (crew) two players in one hull, and the driver's hull at his own ack -------
// What a page draws a remote hull from (`netcode-render.js`): each row's
// `vehicleId` and `seatIndex`, the server's own seat order (the hull's root is
// seat 0). And what the driver's page corrects its own hull against
// (`netcode-client.js` `selfHull`, `net-room.js` `correctDrivenHull`): the
// hull's row in the snapshot whose own row acknowledges his newest word, both
// built from one tick (`room-stream.mjs` `snapshotRecord`).
{
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  const pW = attachPeer(core, String(nextTag++));
  joinPeer(core, pA, 'CRW', 'Driver', 1);
  joinPeer(core, pB, 'CRW', 'Rider', 1);
  joinPeer(core, pW, 'CRW', 'Watcher', 1);
  const room = core.room('CRW');
  const w = room.world;
  const lap = () => { clock.ms += FRAME_MS; room.frame(FRAME_MS); };
  const rowsOf = peer => decodeSnapshot(ofType(peer, MSG_SNAPSHOT).at(-1).subarray(1));
  const seatOf = (snap, slot) => {
    const p = snap.players.find(r => r.slot === slot);
    return p ? { seated: p.seated, inVehicle: p.inVehicle, vehicleId: p.vehicleId, seatIndex: p.seatIndex } : null;
  };
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0 });
  sendJson(pB, MSG_ACTION, { type: 'spawn', flag: 0 });
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'enter' });
  sendJson(pB, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 1, action: 'enter' });
  lap(); lap();   // a snapshot every other tick
  const entry = room.instance.table.find(v => v.id === 1);
  const seen = rowsOf(pW);
  const both = { driver: seatOf(seen, 1), rider: seatOf(seen, 2),
                 hull: seen.vehicles.find(v => v.id === 1)?.occupied ?? null,
                 seats: room.instance.seatSurveyOf?.(entry) ?? null };
  // The seat the driver holds is refused to the rider's switch (SEAT-11), and
  // to a third player's Use, who is told (`seatRefused`).
  sendJson(pB, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'switch' });
  lap(); lap();
  const afterSwitch = seatOf(rowsOf(pW), 2);
  sendJson(pW, MSG_ACTION, { type: 'spawn', flag: 0 });
  pW.sent.length = 0;
  sendJson(pW, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'enter' });
  lap(); lap();
  const third = { refused: ofType(pW, MSG_EVENT).map(jsonRow).some(r => r.type === 'seatRefused' && r.vehicle === 1),
                  seat: seatOf(rowsOf(pA), 3) };
  // The driver drives: every snapshot of his own acknowledges the word its
  // tick ran and carries the hull where that tick left it.
  const acks = [];
  let exact = true;
  for (let seq = 1; seq <= 40; seq++) {
    const before = ofType(pA, MSG_SNAPSHOT).length;
    sendInput(pA, seq, walkInput({ forwardKeys: 1 }));
    lap();
    if (ofType(pA, MSG_SNAPSHOT).length === before) continue;   // no snapshot this tick
    const snap = rowsOf(pA);
    const self = snap.players.find(r => r.slot === 1);
    const hull = snap.vehicles.find(v => v.id === self.vehicleId);
    const pose = w.vehiclePose(entry.owner);
    acks.push([seq, self.ack]);
    if (!hull || Math.hypot(hull.x - pose.x, hull.y - pose.y, hull.z - pose.z) > 1e-3) exact = false;
  }
  // The driver gets out: the rider still holds the hull.
  sendJson(pA, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'exit' });
  lap(); lap();
  const left = rowsOf(pW);
  // The rider takes the wheel nobody holds: the drive is theirs, and it goes
  // again when they move back off it.
  sendJson(pB, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 0, action: 'switch' });
  lap(); lap();
  const wheel = { driver: entry.driver, seat: seatOf(rowsOf(pW), 2).seatIndex, drives: !!w.player(2).vehicle };
  sendJson(pB, MSG_ACTION, { type: 'seat', vehicle: 1, seat: 1, action: 'switch' });
  lap(); lap();
  wheel.after = { driver: entry.driver, seat: seatOf(rowsOf(pW), 2).seatIndex, drives: !!w.player(2).vehicle,
                  held: entry.seated };
  results.crew = {
    both, afterSwitch, third, acks, exact, wheel,
    afterExit: { driver: seatOf(left, 1), rider: seatOf(left, 2),
                 hull: left.vehicles.find(v => v.id === 1)?.occupied ?? null },
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
    // A land hull's drive gets the page's inputs (`map.html`
    // `buildHullDrive`): the collider and the sea, so it finds the sea BED
    // (PHY-16); each wheel a radius off its own mesh, which the room's scene
    // used to leave undecoded (-Infinity: no wheel ever touched the ground);
    // its col0 probe depth and the root part the sea depth is taken on.
    const landEntry = inst.table.find(v => ['ground', 'tank'].includes(v.kind));
    let land = null;
    if (landEntry) {
      w.addPlayer(2, { team: landEntry.team ?? 1 });
      const lm = inst.mountIntoSeat(w, 2, landEntry, 0);
      const drive = lm?.vehicle;
      if (drive) {
        const p0 = drive.state.position.clone();
        for (let t = 0; t < 60; t++) {
          w.player(2).pending = { input: { forward: 1, strafe: 0 }, lookX: 0, lookY: 0 };
          w.step(1 / 30);
        }
        land = {
          template: landEntry.template,
          collider: Boolean(drive.collider?.heightfield),
          waterLevel: Number.isFinite(drive.water?.waterLevel ?? drive.amphibious?.waterLevel ?? w.collider?.waterLevel),
          radiiFinite: drive.wheels.every(wh => Number.isFinite(wh.radius) && wh.radius > 0),
          probeDepths: drive.wheels.filter(wh => Number.isFinite(wh.contactDepth)).length,
          wheels: drive.wheels.length,
          moved: drive.state.position.distanceTo(p0),
          grounded: drive.state.grounded,
          waterPart: Boolean(bodySpecFor(landEntry.root, data)?.waterPart),
        };
        // The driver gets out of a hull that is moving: it is handed to the
        // body world with its velocity and rolls on (the page's
        // `releaseDrivenBody`), and is not stopped dead.
        const before = drive.state.velocity.length();
        let handed = null;
        const release = w.releaseDriven.bind(w);
        w.releaseDriven = (...a) => { handed = drive.state.velocity.length(); return release(...a); };
        inst.unmountFromSeat(w, 2, landEntry);
        w.releaseDriven = release;
        const body = w.bodyWorld?.get?.(landEntry.owner);
        const speedAfter = body?.body ? Math.hypot(...body.body.v) : null;
        land.coast = { before, handed, speedAfter };
      }
    }
    // The room's ladders (LADDER-1): the page's index, each with the hull it
    // hangs in, and a soldier who walks into a guard tower's ladder climbs it
    // on the authority, to the top's exit, as the page climbs it.
    const ladders = w.collider?.ladders ?? [];
    const ownerName = l => w.collider.statics.ownerNodes[l.owner]?.name ?? null;
    let climb = null;
    const tower = ladders.find(l => ownerName(l) === 'guardtow_M1');
    if (tower) {
      w.addPlayer(3, { team: 1 });
      w.spawnPlayer(3, {});
      const s = w.player(3).soldier;
      const fx = tower.x - tower.zx * 0.7, fz = tower.z - tower.zz * 0.7;
      s.spawn(fx, inst.groundHeightAt(fx, fz), fz, Math.atan2(tower.zx, tower.zz));
      const y0 = s.body.position.y;
      let grabbed = false;
      for (let t = 0; t < 90; t++) {
        w.player(3).pending = { input: { forward: 1, strafe: 0 }, lookX: 0, lookY: 0 };
        w.step(1 / 30);
        grabbed ||= s.climb.active;
      }
      climb = { grabbed, exit: s.climb.lastExit?.kind ?? null,
                rise: Math.round((s.body.position.y - y0) * 10) / 10 };
      w.removePlayer(3);
    }
    results.i = {
      ladders: { count: ladders.length, owned: ladders.filter(l => l.owner >= 0).length,
                 shokaku: ladders.filter(l => ownerName(l) === 'Shokaku').length, climb },
      land,
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
  // relay falls back exactly as the page does).
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
  // The wave (SPAWN-35): a spawn before it is refused with the wait, which
  // the death's row carried too; the death came in the round's first window
  // (t ~ 0.1 s), so the next one, at 25 s, has him.
  kPeer.sent.length = 0;
  sendJson(kPeer, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const early = kPeer.sent.map(b => b[0] === MSG_EVENT ? jsonRow(b) : null).filter(Boolean)
    .find(r => r.type === 'spawnRefused');
  const kStep = n => { for (let i = 0; i < n; i++) { kRoom.frame(FRAME_MS); clock.ms += FRAME_MS; } };
  const waveAt = kRoom.authority.round.clock;
  stepPastWave(kRoom, 1, kStep);
  const waveOpenedAt = kRoom.authority.round.clock;
  // Respawn revives: fresh Armor, the decree lifted, the walk works again.
  sendJson(kPeer, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const hpAfterRespawn = kw.armorOf(1)?.hitPoints ?? null;
  sendInput(kPeer, 1001, walkInput());
  kRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  results.k = {
    killedWait: killed?.sw ?? null,
    earlyRefusedWait: early?.sw ?? null,
    earlyAt: Math.round(waveAt * 100) / 100,
    waveOpenedAt: Math.round(waveOpenedAt * 100) / 100,
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

// --- (wave) the reinforcement wave, a change of side, the flag's side -----------
// SPAWN-35: windows of 5 s every 25 s from the round's start; `killPlayer`
// waits for the next window when more than 5 s is left to it, else the one
// after; a spent wait not taken by a window's close waits for the next.
// `GameServer::setTeam` 0x08131800: the row's side is taken, a live player
// whose side changed dies. `spawnPlayer` 0x0814cb3e: another side's flag
// spawns nobody. The test level's flag 0 is team 1's, flag 1 team 2's.
{
  const pW = attachPeer(core, String(nextTag++));
  const pO = attachPeer(core, String(nextTag++));
  const hW = joinPeer(core, pW, 'WAV', 'Waiter', 1);
  joinPeer(core, pO, 'WAV', 'Other', 2);
  const wRoom = core.room('WAV');
  const ww = wRoom.world;
  const slot = hW.slot;
  const t = () => Math.round(wRoom.authority.round.clock * 100) / 100;
  const step = n => {
    for (let i = 0; i < n; i++) {
      for (const c of wRoom.players.values()) c.lastSeen = wRoom.now();
      clock.ms += FRAME_MS; wRoom.frame(FRAME_MS);
    }
  };
  const stepTo = at => { while (wRoom.authority.round.clock < at) step(1); };
  const rows = peer => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow);
  const ask = (flag, team = 1) => {
    pW.sent.length = 0;
    sendJson(pW, MSG_ACTION, { type: 'spawn', flag, kit: 'assault', team });
    step(1);
    const refused = rows(pW).find(r => r.type === 'spawnRefused') ?? null;
    return { at: t(), refused: !!refused, sw: refused?.sw ?? null, dead: wRoom.authority.dead.has(slot) };
  };
  const die = () => {
    pW.sent.length = 0;
    ww.armorOf(slot).applyDamage(999);
    const at = t();
    step(1);
    const killed = rows(pW).find(r => r.type === 'killed' && r.slot === slot) ?? null;
    return { at, sw: killed?.sw ?? null };
  };
  const out = {};
  out.otherSidesFlag = ask(1);
  out.firstSpawn = ask(0);
  stepTo(10);
  out.deathAt10 = die();                 // 15 s to the window at 25
  stepTo(20);
  out.askAt20 = ask(0);                  // refused, 5 s left
  stepTo(25.05);
  out.askAt25 = ask(0);                  // the window has him
  stepTo(46);
  out.deathAt46 = die();                 // 4 s to the window at 50: the one at 75
  stepTo(56);
  out.askAt56 = ask(0);                  // 19 s left
  stepTo(75.05);
  out.askAt75 = ask(0);
  // Spent at 100, not taken until the window closed at 105: the next, 125.
  stepTo(80);
  out.deathAt80 = die();                 // 20 s to the window at 100
  stepTo(106);
  out.askAt106 = ask(0);
  stepTo(125.05);
  out.askAt125 = ask(0);
  // The deploy screen's tab: alive on team 1, a spawn row for team 2. The
  // side changes for everyone, the live body dies, and the spawn waits.
  pO.sent.length = 0;
  out.sideChange = ask(1, 2);
  const teamRow = rows(pO).find(r => r.type === 'team') ?? null;
  step(1);
  out.sideChange.teamRow = teamRow && { slot: teamRow.slot, team: teamRow.team };
  out.sideChange.connectionTeam = wRoom.players.get(slot).team;
  out.sideChange.worldTeam = ww.player(slot).team;
  out.sideChange.deadAfter = wRoom.authority.dead.has(slot);
  const killedRow = rows(pW).find(r => r.type === 'killed' && r.slot === slot) ?? null;
  out.sideChange.killedWait = killedRow?.sw ?? null;
  // Dead now on team 2: its own flag waits for the wave, team 1's is refused.
  stepTo(150.05);
  out.oldSidesFlagAfter = ask(0, 2);
  out.newSidesFlagAfter = ask(1, 2);
  // SUICIDE (the room's `suicide` action): a death of their own, with its wave.
  pW.sent.length = 0;
  sendJson(pW, MSG_ACTION, { type: 'suicide' });
  step(1);
  const suicided = rows(pW).find(r => r.type === 'killed' && r.slot === slot) ?? null;
  out.suicide = { at: t(), killed: !!suicided, other: suicided?.other ?? null, sw: suicided?.sw ?? null,
                  dead: wRoom.authority.dead.has(slot) };
  results.wave = out;
}

// --- (autoTeam) the side a join with team 0 gets ---------------------------------
// `getTeamToAddPlayer` 0x08261670: the side under its share, a tie at random.
{
  const sides = [];
  for (const coin of [0, 0.9]) {
    const c = new RoomServerCore({ levels: new Map([['test', levelData]]), defaultLevel: 'test',
                                   now: () => clock.ms, random: () => coin });
    const got = [];
    for (let i = 0; i < 4; i++) got.push(joinPeer(c, attachPeer(c, `auto-${coin}-${i}`), 'AUTO', `P${i}`, 0)?.team ?? null);
    sides.push(got);
  }
  results.autoTeam = { coinLow: sides[0], coinHigh: sides[1] };
}

// --- (l) P3: flag capture and the bleed ----------------------------------------
// The law: an un-contested enemy inside the ring flips the owner after
// FLAG_CAPTURE_SECONDS; both teams present freezes. The test level's two
// points weigh 50 each, so one flag a side bleeds nobody, and the capture
// that leaves team 1 holding both (100, over the engine's 99) bleeds team 2
// its 30 a minute: a whole ticket every 2 s, the first a whole interval after
// the capture (ledger TKT-4).
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
  // runs to completion, and team 2 ends up holding nothing at all.
  lw.player(2).soldier.spawn(50, 0, 50);
  tick(300);
  const lRows = () => lRoom.players.get(1).peer.sent
    .filter(b => b[0] === MSG_EVENT).map(b => jsonRow(b));
  const capturedAfter = lRows().find(r => r.type === 'captured');
  const southNow = lw.flags[1].team;
  // Both flags are team 1's now, 100 of weight: team 2 bleeds a whole ticket
  // every 60 / 30 = 2 s, the first 2 s after the capture.
  const isBleed = r => r.type === 'ticket' && r.reason === 'bleed';
  let bleedRow = null;
  for (let i = 0; i < 240 && !bleedRow; i++) {
    tick(1);
    bleedRow = lRows().find(isBleed);
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
    bleedRow: bleedRow
      ? { team: bleedRow.team, count: bleedRow.count, reason: bleedRow.reason } : null,
    // Ticks from the capture's row to the first bleed row; the capture's own
    // tick is the bleed's first.
    bleedGapTicks: bleedRow && capturedAfter ? bleedRow.t - capturedAfter.t : null,
    bleedsBeforeCapture: capturedAfter
      ? lRows().filter(r => isBleed(r) && r.t < capturedAfter.t).length : null,
    held: { ...lRoom.authority.round.held },
    bleeding: { ...lRoom.authority.round.bleeding },
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

// --- (n)-(q) the bleed on rooms of its own ---------------------------------------
// The engine's rule (ledger TKT-4): a side loses one whole ticket every
// `60 / (rate * maxPlayers / 16)` s while the ENEMY's summed `areaValue` over
// the control points it holds is over 99, and the countdown is refilled whole
// on every frame that gate is shut. Each room here plays a level of its own
// with nobody in it (the bleed needs no players, and an empty room has nobody
// to stand in a ring), and keeps the rows its authority raises where the wire
// would carry them. Rooms are 16 slots, the number the levels' rates are
// written for.

/** A room on a descriptor level of `extras`, no vehicles, and its rows. */
function bleedRoom(code, extras) {
  const name = `bleed-${code.toLowerCase()}`;
  // A side with no spawn group and nobody alive is stranded and bleeds at
  // the end-of-round rate (TKT-5, TKT-8); these scenarios test the weight
  // gate, so a side the extras leave with no group gets one carried group
  // far off the field (a real level's deck or tower group: Wake's Japanese
  // carrier, Battle of Britain's Allied towers), which weighs nothing.
  const grouped = new Set([...(extras.soldierSpawns ?? []), ...(extras.vehicleSoldierSpawns ?? [])]
    .filter(sp => sp.group != null).map(sp => sp.team));
  const carried = extras.controlPoints ? [1, 2].filter(team => !grouped.has(team)).map(team => ({
    vehicle: 'OffField', pad: 900 + team, name: `offfield_${team}`, group: 90 + team, team,
    position: [-450 + 900 * (team - 1), 0, -450], rotation: [0, 0, 0],
  })) : [];
  const descriptor = {
    name,
    extras: { worldSize: 1000, gameplayMode: 'Conquest', ...extras,
              ...(carried.length ? { vehicleSoldierSpawns: [...(extras.vehicleSoldierSpawns ?? []), ...carried] } : {}) },
    collider: { waterLevel: null, heightfield: null, statics: null, surfaceHeight() { return 0; } },
    vehicles: [],
  };
  core.levels.set(name, buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor }));
  const room = core.createRoom(code, { level: name });
  const rows = [];
  room.broadcast = row => rows.push(row);      // the wire, with nobody on it
  const bleeds = team => rows.filter(r => r.type === 'ticket' && r.reason === 'bleed'
    && (team == null || r.team === team));
  return { room, rows, bleeds };
}

/** Run a room until `ticks` more engine ticks have gone (a lap can run none
 *  or two, so the count is the room's own). */
function runTicks(room, ticks) {
  const until = room.tick + ticks;
  while (room.tick < until) { clock.ms += FRAME_MS; room.frame(FRAME_MS); }
}

const countsOf = room => ({ 1: room.world.tickets.team1, 2: room.world.tickets.team2 });
const roundOf = room => {
  const r = room.authority.round;
  return { held: { ...r.held }, bleeding: { ...r.bleeding }, tickets: { ...r.tickets } };
};

/** Wake's five points (its Conquest layer): 20 each, all the US's at the
 *  start, and each owns spawns, so each is a flag the room can turn. Wake's
 *  own rates, 5 a minute for Japan and 30 for the US. */
const wakeExtras = () => {
  const names = ['The_beach', 'The_Airfield', 'ALLIES_southbase', 'ALLIES_north_base',
                 'ALLIES_north_village'];
  const at = i => [200 * (i - 2), 0, 300];
  return {
    controlPoints: names.map((name, i) => ({
      name, team: 2, areaValue: 20, spawnGroupId: i + 1, unableToChangeTeam: false,
      radius: 50, timeToGetControl: 10, position: at(i),
    })),
    soldierSpawns: names.map((name, i) => ({
      name: `${name}_spawn`, group: i + 1, team: 2, position: at(i), rotation: [180, 0, 0],
    })),
    tickets: { mode: 'Conquest', team1: 100, team2: 100, lossPerMin: { team1: 5, team2: 30 } },
  };
};
const wakeFlag = (room, name) => room.world.flags.find(f => f.controlPointName === name);

// --- (n) the weight gate: a point with no flag, as on Battle of Britain -----------
// Battle of Britain's own points and rates (Conquest): the Axis airfield,
// uncapturable, 50 for team 1; and the Allies' `Allied_Base`, uncapturable,
// 150 for team 2, whose spawn group 3 holds no soldier spawn, so the world
// makes no flag of it (`spawn-flags.js`). The Allies hold 150 from the first
// frame: the Axis bleeds its 4 a minute, a whole ticket every 15 s. The
// Axis's 50 bleeds nobody, however fast the Allies' 1000 a minute would run.
// No flag here is capturable, which is why the old flag-majority rule bled
// nobody on this level.
{
  const { room, bleeds } = bleedRoom('BOB', {
    controlPoints: [
      { name: 'Axis_East_Airfield', displayName: 'Axis_Airfield', team: 1, areaValue: 50,
        spawnGroupId: 1, secondSpawnGroupId: 2, unableToChangeTeam: true, radius: 50,
        timeToGetControl: 9999, position: [200, 0, 200] },
      { name: 'Allied_Base', displayName: 'Allied_Weapons_Factory', team: 2, areaValue: 150,
        spawnGroupId: 3, secondSpawnGroupId: null, unableToChangeTeam: true, radius: 50,
        timeToGetControl: 9999, position: [-200, 0, -200] },
    ],
    soldierSpawns: [
      { name: 'Axis_spawn', group: 1, team: 1, position: [200, 0, 200], rotation: [180, 0, 0] },
    ],
    tickets: { mode: 'Conquest', team1: 100, team2: 100, lossPerMin: { team1: 4, team2: 1000 } },
  });
  runTicks(room, 1);
  const firstTick = roundOf(room);
  runTicks(room, 61 * 30 - room.tick);
  results.n = {
    flags: room.world.flags.filter(f => f.controlPointName).map(f => f.controlPointName),
    firstTick,
    clock: room.tick / 30,
    tickets: countsOf(room),
    // [the tick of the row, its count] for every ticket the Axis bled.
    axis: bleeds(1).map(r => [r.t, r.count]),
    allies: bleeds(2).length,
  };
}

// --- (o) four of five points at 20 bleed nobody, as on Wake -------------------------
// The US holding all five, 100, bleeds Japan its 5 a minute: a ticket every
// 12 s. Japan taking one leaves the US four of the five, the strict majority
// of the flags the old rule bled Japan for, and 80 of weight: nobody bleeds.
{
  const { room, rows, bleeds } = bleedRoom('WAK', wakeExtras());
  runTicks(room, 1);
  const allUs = roundOf(room);
  runTicks(room, 13 * 30 - room.tick);
  const at13 = { tickets: countsOf(room), bleeds: bleeds().map(r => [r.team, r.t, r.count]) };
  wakeFlag(room, 'The_Airfield').team = 1;
  const takenAt = room.tick;
  runTicks(room, 60 * 30);
  results.o = {
    allUs,
    at13,
    oneTaken: {
      ...roundOf(room),
      tickets: countsOf(room),
      // Every ticket row after the point turned, whatever its reason.
      rows: rows.filter(r => r.type === 'ticket' && r.t > takenAt).length,
      seconds: (room.tick - takenAt) / 30,
    },
  };
}

// --- (p) a shut gate refills the countdown ------------------------------------------
// Wake again, all five the US's: Japan's first ticket at 12 s, and at 18 s
// half the next interval is owed. Japan holds one point for one tick (the US
// weight drops to 80, the gate shuts) and loses it: the engine writes the
// whole 12 s back on the shut frame, so the next ticket comes a whole 12 s
// after the gate reopens, not the 6 s that were owed.
{
  const { room, bleeds } = bleedRoom('WKR', wakeExtras());
  runTicks(room, 18 * 30);
  const owed = room.authority.round.countdowns[1];
  const beforeShut = bleeds(1).map(r => [r.t, r.count]);
  const airfield = wakeFlag(room, 'The_Airfield');
  airfield.team = 1;
  runTicks(room, 1);
  const shut = { countdown: room.authority.round.countdowns[1],
                 bleeding: { ...room.authority.round.bleeding } };
  airfield.team = 2;
  const reopened = room.tick;
  runTicks(room, 14 * 30);
  const next = bleeds(1).find(r => r.t > reopened);
  results.p = {
    owed,
    beforeShut,
    shut,
    next: next ? { gapTicks: next.t - reopened, count: next.count } : null,
    after: bleeds(1).filter(r => r.t > reopened).length,
  };
}

// --- (q) the room's round is scaled once ----------------------------------------------
// Kasserine Pass co-op's own tickets: 100 a side, 15 a minute, and its
// script's `game.maxNrOfPlayers 18`, which sets the start and not the bleed
// (ledger TKT-2). The room scales them once for its 16 slots (`level-data.mjs`
// `scaleTickets`): 100 x 18 / 16 = 112.5, truncated to 112, and 15 a minute,
// a ticket every 4 s. The round has to start where the handshake does, and
// not at 112 x 18 / 16 = 126. One point of 100 for team 2 bleeds team 1.
{
  const { room, bleeds } = bleedRoom('KAS', {
    controlPoints: [
      { name: 'Allied_Hill', team: 2, areaValue: 100, spawnGroupId: 1, position: [100, 0, 100] },
    ],
    soldierSpawns: [
      { name: 'Hill_spawn', group: 1, team: 2, position: [100, 0, 100], rotation: [180, 0, 0] },
    ],
    tickets: { mode: 'CoOp', team1: 100, team2: 100, maxPlayers: 18,
               lossPerMin: { team1: 15, team2: 15 } },
  });
  const start = { world: countsOf(room), round: { ...room.authority.round.tickets },
                  lossPerMin: { ...room.world.tickets.lossPerMin } };
  runTicks(room, 5 * 30);
  const first = bleeds(1)[0];
  results.q = { start, first: first ? [first.t, first.count] : null, tickets: countsOf(room) };
}

// --- (r) radio relay: GameServer::radioMessage -----------------------------------
// Team radio to the speaker's team only; a shout to anyone, of either team,
// within 70 m of the speaker; never back to the speaker.
{
  const rA = attachPeer(core, String(nextTag++));
  const rB = attachPeer(core, String(nextTag++));
  const rC = attachPeer(core, String(nextTag++));
  const hA = joinPeer(core, rA, 'RRR', 'Speaker', 1);
  const hB = joinPeer(core, rB, 'RRR', 'Mate', 1);
  const hC = joinPeer(core, rC, 'RRR', 'Enemy', 2);
  const rRoom = core.room('RRR');
  for (const p of [rA, rB, rC]) sendJson(p, MSG_ACTION, { type: 'spawn', flag: 0 });
  rRoom.frame(FRAME_MS); clock.ms += FRAME_MS;
  const radioRows = peer => ofType(peer, MSG_EVENT).map(jsonRow).filter(r => r.type === 'radio');
  const clear = () => { for (const p of [rA, rB, rC]) p.sent.length = 0; };
  const place = (slot, dx) => {
    const pl = rRoom.world.player(slot);
    const s0 = rRoom.world.player(hA.slot).soldier;
    pl.position = null;
    pl.soldier.body.position.x = s0.x + dx;
    pl.soldier.body.position.y = s0.y;
    pl.soldier.body.position.z = s0.z;
  };
  place(hB.slot, 20);
  place(hC.slot, 30);
  clear();
  sendJson(rA, MSG_ACTION, { type: 'radio', msg: 1, team: true });
  const team = { a: radioRows(rA).length, b: radioRows(rB), c: radioRows(rC).length };
  clear();
  sendJson(rA, MSG_ACTION, { type: 'radio', msg: 49, team: false });
  const nearShout = { b: radioRows(rB).length, c: radioRows(rC).length };
  place(hC.slot, 90);
  clear();
  sendJson(rA, MSG_ACTION, { type: 'radio', msg: 49, team: false });
  const farShout = { b: radioRows(rB).length, c: radioRows(rC).length };
  clear();
  sendJson(rA, MSG_ACTION, { type: 'radio', msg: 99, team: true });
  results.r = {
    teams: [hA.team, hB.team, hC.team],
    team: { a: team.a, c: team.c, row: team.b[0] && { slot: team.b[0].slot, msg: team.b[0].msg,
      broadcast: team.b[0].broadcast, hasAt: Array.isArray(team.b[0].at) } },
    nearShout,
    farShout,
    badId: radioRows(rB).length,
  };
}

// --- (chat) typed chat, the board's numbers and the ping ---------------------------
// `handleChatMessage` (CHAT-4): everyone but the sender, team chat to the
// sender's side, no alive test; each receiver's queue holds four lines and
// sends 15 bytes every 0.5 s (CHAT-2). HELLO and the `stats` rows carry every
// player's score, kills, deaths and ping (J-1, MEME-27).
{
  const cA = attachPeer(core, String(nextTag++));
  const cB = attachPeer(core, String(nextTag++));
  const cC = attachPeer(core, String(nextTag++));
  const hA = joinPeer(core, cA, 'CHT', 'Talker', 1);
  const hB = joinPeer(core, cB, 'CHT', 'Mate', 1);
  const joinSeenByA = ofType(cA, MSG_EVENT).map(jsonRow).find(r => r.type === 'join' && r.slot === hB.slot);
  const hC = joinPeer(core, cC, 'CHT', 'Enemy', 2);
  const room = core.room('CHT');
  const peers = [cA, cB, cC];
  const rows = (peer, type) => ofType(peer, MSG_EVENT).map(jsonRow).filter(r => r.type === type);
  const clear = () => { for (const p of peers) p.sent.length = 0; };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const connection of room.players.values()) connection.lastSeen = room.now();
      room.frame(FRAME_MS); clock.ms += FRAME_MS;
    }
  };
  const out = { joinRowTeam: joinSeenByA?.team ?? null };
  // Nobody has spawned: the relay has no alive test.
  clear();
  sendJson(cA, MSG_ACTION, { type: 'chat', text: 'hello', team: false });
  out.beforeTick = rows(cB, 'chat').length;
  step(1);
  out.all = { a: rows(cA, 'chat').length, b: rows(cB, 'chat'), c: rows(cC, 'chat').length };
  // Team chat, 0.5 s on (the piece clock is per receiver).
  step(16); clear();
  sendJson(cA, MSG_ACTION, { type: 'chat', text: 'flank left', team: true });
  step(1);
  out.team = { a: rows(cA, 'chat').length, b: rows(cB, 'chat'), c: rows(cC, 'chat').length };
  // A line past 63 bytes is cut, and its five pieces take four more half
  // seconds to leave.
  step(16); clear();
  sendJson(cA, MSG_ACTION, { type: 'chat', text: 'x'.repeat(80), team: false });
  let frames = 0;
  while (!rows(cB, 'chat').length && frames < 200) { step(1); frames++; }
  out.long = { bytes: rows(cB, 'chat')[0]?.text.length ?? null, seconds: frames * FRAME_MS / 1000 };
  // Six lines at once: each receiver holds four, and the rest are gone.
  step(16); clear();
  for (let i = 0; i < 6; i++) sendJson(cA, MSG_ACTION, { type: 'chat', text: `line ${i}`, team: false });
  step(30 * 6);
  out.flood = rows(cB, 'chat').map(r => r.text);
  // An empty line and a row that is no text go nowhere.
  clear();
  sendJson(cA, MSG_ACTION, { type: 'chat', text: '   ', team: false });
  sendJson(cA, MSG_ACTION, { type: 'chat', text: 7, team: false });
  step(20);
  out.empty = rows(cB, 'chat').length;

  // The ping: the page answers a pong with the pong's own time, and the room
  // times the round trip on its clock.
  clear();
  send(cB, MSG_PING, Buffer.from([1, 0, 0, 0]));
  const pong = cB.sent.find(b => b[0] === 0x86);
  clock.ms += 80;
  send(cB, MSG_PING, Buffer.from([2, 0, 0, 0, pong[1], pong[2], pong[3], pong[4]]));
  out.ping = { pongs: cB.sent.filter(b => b[0] === 0x86).length, ms: room.players.get(hB.slot).ping };
  // A kill on the round's books, then the next half second's `stats` row.
  room.authority.round.kill({ killer: hA.slot, killerTeam: 1, victim: hC.slot, victimTeam: 2 });
  clear();
  step(16);
  const stats = rows(cC, 'stats').flatMap(r => r.rows);
  out.stats = Object.fromEntries(stats.map(r => [r[0] === hA.slot ? 'a' : r[0] === hB.slot ? 'b' : 'c', r.slice(1)]));
  clear();
  step(45);
  out.statsQuiet = rows(cC, 'stats').length;
  // A late joiner's HELLO carries everyone's numbers.
  const cD = attachPeer(core, String(nextTag++));
  const hD = joinPeer(core, cD, 'CHT', 'Late', 2);
  const slotOf = slot => hD.slots.find(r => r.slot === slot);
  out.hello = {
    a: [slotOf(hA.slot).score, slotOf(hA.slot).kills, slotOf(hA.slot).deaths],
    c: [slotOf(hC.slot).score, slotOf(hC.slot).kills, slotOf(hC.slot).deaths],
    bPing: slotOf(hB.slot).ping, own: hD.stats,
  };
  // A new name reaches every roster, the actor's too.
  clear();
  sendJson(cB, MSG_ACTION, { type: 'name', name: 'Renamed' });
  out.name = { b: rows(cB, 'name')[0] ?? null, a: rows(cA, 'name').length, helloName: room.players.get(hB.slot).name };
  // The slot's tally leaves with its player.
  send(cA, MSG_LEAVE, Buffer.alloc(0));
  const cE = attachPeer(core, String(nextTag++));
  const hE = joinPeer(core, cE, 'CHT', 'Next', 1);
  out.reused = { sameSlot: hE.slot === hA.slot, stats: hE.stats };
  results.chat = out;
}

// --- (t) each room its own tickets ----------------------------------------------
// Rooms AAA and BBB play the same LevelData. The authority spends a room's
// tickets in place, so each room needs its own copy (level-data.mjs
// `scaleTickets`): AAA losing tickets must not reach BBB or the level.
{
  const a = core.room('AAA').world.tickets;
  const b = core.room('BBB').world.tickets;
  const before = { a: a.team1, b: b.team1, level: levelData.extras.tickets.team1 };
  a.team1 -= 7;
  results.t = {
    separate: a !== b && a !== levelData.extras.tickets,
    before,
    after: { a: a.team1, b: b.team1, level: levelData.extras.tickets.team1 },
  };
  a.team1 += 7;
}

// --- (u) the record's analogue throttle and rudder reach the world -------------
// A remote pilot's joystick rudder and lever (and a 14-byte record from an
// older page, which carries their signs alone) through the room's own feed
// into the world's buffered word.
{
  const peer = attachPeer(core, String(nextTag++));
  const hello = joinPeer(core, peer, 'UUU', 'Pilot');
  const room = core.room('UUU');
  const player = room.world.player(hello.slot);
  player.buffer.length = 0;
  player.lastSeen = -1;
  const pilot = walkInput({ forward: 0, forwardKeys: 0.6, rudder: -0.37, roll: 0.5, pitch: -0.25 });
  sendInput(peer, 1, pilot);
  const fresh = player.buffer[player.buffer.length - 1]?.input ?? null;
  const legacy = encodeInputFrame(2, pilot, { x: 0, y: 0 }).slice(0, 4 + 14);
  send(peer, MSG_INPUT, legacy);
  const old = player.buffer[player.buffer.length - 1]?.input ?? null;
  results.u = {
    rudder: fresh?.rudder ?? null,
    forwardKeys: fresh?.forwardKeys ?? null,
    roll: fresh?.roll ?? null,
    legacyRudder: old?.rudder ?? null,
    legacyForwardKeys: old?.forwardKeys ?? null,
    buffered: player.buffer.length,
  };
  player.buffer.length = 0;
}

// --- (v) an older page and a newer one in one room ----------------------------
// A page from before the analogue channels sends 14-byte records; a current
// one sends 17. One room takes both on the same clock: each walks on its own
// record and each sees the other move in its snapshots.
{
  const pOld = attachPeer(core, String(nextTag++));
  const pNew = attachPeer(core, String(nextTag++));
  const helloOld = joinPeer(core, pOld, 'VVV', 'Old', 0);
  const helloNew = joinPeer(core, pNew, 'VVV', 'New', 0);
  const room = core.room('VVV');
  const w = room.world;
  sendJson(pOld, MSG_ACTION, { type: 'spawn', flag: 0 });
  sendJson(pNew, MSG_ACTION, { type: 'spawn', flag: 1 });
  const at = slot => ({ x: w.player(slot).soldier.x, z: w.player(slot).soldier.z });
  const startOld = at(helloOld.slot);
  const startNew = at(helloNew.slot);
  pOld.sent.length = 0;
  pNew.sent.length = 0;
  const sizes = new Set();
  for (let i = 1; i <= 30; i++) {
    const legacy = encodeInputFrame(i, walkInput({ forwardKeys: 1, rudder: -1 }), { x: 0, y: 0 })
      .slice(0, 4 + 14);
    sizes.add(legacy.length);
    send(pOld, MSG_INPUT, legacy);
    const fresh = encodeInputFrame(i, walkInput({ forwardKeys: 0.6, rudder: -0.37 }), { x: 0, y: 0 });
    sizes.add(fresh.length);
    send(pNew, MSG_INPUT, fresh);
    clock.ms += FRAME_MS;
    room.frame(FRAME_MS);
  }
  const travelled = (slot, from) => Math.hypot(at(slot).x - from.x, at(slot).z - from.z);
  const seenBy = (peer, slot, from) => {
    const snaps = ofType(peer, MSG_SNAPSHOT);
    if (!snaps.length) return -1;
    const row = decodeSnapshot(snaps.at(-1).subarray(1)).players.find(p => p.slot === slot);
    return row ? Math.hypot(row.x - from.x, row.z - from.z) : -1;
  };
  results.v = {
    frameSizes: [...sizes].sort(),
    oldTravelled: travelled(helloOld.slot, startOld),
    newTravelled: travelled(helloNew.slot, startNew),
    oldSeenByNew: seenBy(pNew, helloOld.slot, startOld),
    newSeenByOld: seenBy(pOld, helloNew.slot, startNew),
    oldWord: { rudder: w.player(helloOld.slot).last?.input?.rudder ?? null,
               forwardKeys: w.player(helloOld.slot).last?.input?.forwardKeys ?? null },
    newWord: { rudder: w.player(helloNew.slot).last?.input?.rudder ?? null,
               forwardKeys: w.player(helloNew.slot).last?.input?.forwardKeys ?? null },
    closed: [pOld.closed, pNew.closed],
  };
}

// --- (w) a CTF room's HELLO carries its flags ---------------------------------------
// The authority runs the CTF law on a CTF layer (`server/authority.mjs`); a
// client joining mid-round reads where each flag is off its HELLO
// (`ctf.js` `snapshot`), and a Conquest room sends none.
{
  const flagBases = [
    { name: 'USbase', position: [0, 0, 100], team: 2, radius: 5, flagLocation: [0, 7.6, 0],
      flag: { radius: 5, timeToRespawn: 30 } },
    { name: 'JPbase', position: [0, 0, -100], team: 1, radius: 5, flagLocation: [0, 7.6, 0],
      flag: { radius: 5, timeToRespawn: 30 } },
  ];
  const { room } = bleedRoom('CTF', { gameplayMode: 'Ctf', flagBases });
  const ctf = room.authority.ctf;
  ctf.tick(1 / 30, [{ id: 4, team: 2, alive: true, onFoot: true, position: [1, 0, -100] }]);
  const hello = room.helloRow({ slot: 5, team: 1, name: 'Late' });
  const conquest = bleedRoom('CNQ', {}).room.helloRow({ slot: 1, team: 1, name: 'X' });
  results.w = { ctf: JSON.parse(JSON.stringify(hello.ctf)), conquest: conquest.ctf };
}

// --- (x) the round's end and the restart (ROUND-9, ROUND-11, HP-20) ---------------
// The flat test level with two tickets for the Axis and no bleed: two deaths
// end the round on tickets (ROUND-2). The room sends the result, clears the
// world (`clearWorld`: the living killed, nothing spent), refuses a human's
// spawn while the round is over (`spawnPlayer`'s `[+0x58] == 1`), and ten
// seconds later restarts: the tickets made again, the rounds won kept, every
// flag back on its level team, and the spawn taken again.
{
  const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
  const descriptor = {
    ...base, name: 'round-end',
    extras: { ...base.extras, tickets: { team1: 2, team2: 100, lossPerMin: { team1: 0, team2: 0 } } },
    vehicles: [],
  };
  core.levels.set('round-end', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor }));
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  sendJson(pA, MSG_JOIN, { room: 'END', name: 'Axe', team: 1, level: 'round-end' });
  sendJson(pB, MSG_JOIN, { room: 'END', name: 'Ally', team: 2, level: 'round-end' });
  const room = core.room('END');
  const w = room.world;
  const rowsOf = peer => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow);
  const step = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  sendJson(pB, MSG_ACTION, { type: 'spawn', flag: 1, kit: 'assault' });
  step(2);
  for (let death = 0; death < 2; death++) {
    w.armorOf(1).applyDamage(999);
    step(2);
    if (death === 0) {
      stepPastWave(room, 1, step);
      sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
      step(1);
      // The Allies take the Axis flag before the end (after A stands on it:
      // a spawn on a flag of the other side's moves him to it): the restart
      // must hand it back.
      w.flags[0].team = 2;
    }
  }
  step(2);
  const endRows = rowsOf(pB);
  const end = endRows.find(r => r.type === 'roundEnd');
  const cleared = endRows.filter(r => r.type === 'killed' && r.cleared).map(r => r.slot);
  const ticketsAtEnd = { ...w.tickets };
  const bAliveAfterEnd = !w.armorOf(2)?.destroyed;
  const helloDuringEnd = room.helloRow({ slot: 9, team: 1, name: 'Late' }).round;
  // A spawn while the round is over is refused, to that player alone.
  pA.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  step(1);
  const refused = rowsOf(pA).some(r => r.type === 'spawnRefused');
  const aDeadDuringEnd = room.authority.dead.has(1);
  // The countdown: nothing at 9 s, the restart by 10 s and a tick or two.
  pB.sent.length = 0;
  step(Math.round(9 * 30));
  const restartedEarly = rowsOf(pB).some(r => r.type === 'restart');
  step(Math.round(1.2 * 30));
  const restart = rowsOf(pB).find(r => r.type === 'restart');
  const roundAfter = { status: room.authority.round.status, tickets: { ...room.authority.round.tickets },
                       roundsWon: { ...room.authority.round.roundsWon } };
  // And the spawn screen works again.
  pB.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  step(1);
  const respawned = rowsOf(pB).some(r => r.type === 'spawn' && r.slot === 1)
    && !room.authority.dead.has(1);
  results.x = {
    end: end ? { winner: end.winner, victoryType: end.victoryType, reason: end.reason,
                 restartIn: end.restartIn, roundsWon: end.roundsWon,
                 medals: end.medals?.length ?? null } : null,
    cleared, ticketsAtEnd: { team1: ticketsAtEnd.team1, team2: ticketsAtEnd.team2 },
    bAliveAfterEnd, helloDuringEnd: helloDuringEnd && { status: helloDuringEnd.status,
                                                        winner: helloDuringEnd.winner },
    refused, aDeadDuringEnd, restartedEarly,
    restart: restart ? { tickets: restart.tickets, flags: restart.flags, roundsWon: restart.roundsWon } : null,
    roundAfter, flagsAfter: w.flags.map(f => f.team), respawned,
    ticketsAfter: { team1: w.tickets.team1, team2: w.tickets.team2 },
  };
}

// --- (y) a room plays the layer it was made on -------------------------------------
// The page's `?mode=` law on the server (`selectGameMode`): a room created
// with a mode plays that layer's flags, tickets and CTF bases; one created
// with none plays the level's default, and the HELLO says which.
{
  const point = (name, team, at) => ({ name, team, areaValue: 50, spawnGroupId: team, position: at });
  const spawn = (name, group, team, at) => ({ name, group, team, position: at, rotation: [180, 0, 0] });
  const conquest = {
    controlPoints: [point('North', 1, [10, 0, 10]), point('South', 2, [-10, 0, -10])],
    tickets: { team1: 100, team2: 100, lossPerMin: { team1: 30, team2: 30 } },
  };
  const ctfLayer = {
    controlPoints: [point('AxisBase', 1, [0, 0, -100]), point('AlliedBase', 2, [0, 0, 100])],
    soldierSpawns: [spawn('A1', 1, 1, [0, 0, -100]), spawn('B1', 2, 2, [0, 0, 100])],
    tickets: null,
    flagBases: [
      { name: 'AlliedFlag', position: [0, 0, 100], team: 2, radius: 5, flagLocation: [0, 7.6, 0],
        flag: { radius: 5, timeToRespawn: 30 } },
      { name: 'AxisFlag', position: [0, 0, -100], team: 1, radius: 5, flagLocation: [0, 7.6, 0],
        flag: { radius: 5, timeToRespawn: 30 } },
    ],
  };
  const descriptor = {
    name: 'layers',
    extras: {
      worldSize: 600, gameplayMode: 'Conquest', ...conquest,
      soldierSpawns: [spawn('N1', 1, 1, [10, 0, 10]), spawn('S1', 2, 2, [-10, 0, -10])],
      modes: { Conquest: { ...conquest }, Ctf: ctfLayer },
    },
    collider: { waterLevel: null, heightfield: null, statics: null, surfaceHeight() { return 0; } },
    vehicles: [],
  };
  core.levels.set('layers', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor }));
  const pC = attachPeer(core, String(nextTag++));
  sendJson(pC, MSG_JOIN, { room: 'LAYCTF', name: 'C', team: 0, level: 'layers', mode: 'ctf' });
  const helloCtf = jsonRow(pC.sent.find(b => b[0] === MSG_HELLO));
  const pD = attachPeer(core, String(nextTag++));
  sendJson(pD, MSG_JOIN, { room: 'LAYDEF', name: 'D', team: 0, level: 'layers' });
  const helloDef = jsonRow(pD.sent.find(b => b[0] === MSG_HELLO));
  const ctfRoom = core.room('LAYCTF');
  results.y = {
    ctf: { mode: helloCtf.mode, modeDefault: helloCtf.modeDefault,
           flags: helloCtf.flags.map(f => f.name), tickets: helloCtf.tickets,
           ctf: Array.isArray(helloCtf.ctf), law: !!ctfRoom.authority.ctf,
           list: core.roomList().find(r => r.code === 'LAYCTF')?.mode },
    def: { mode: helloDef.mode, modeDefault: helloDef.modeDefault,
           flags: helloDef.flags.map(f => f.name), tickets: helloDef.tickets?.team1 ?? null,
           ctf: helloDef.ctf },
  };
}

// --- (z2) a magazine change heard by the others ------------------------------------
// The page names the change its weapon started; the room relays it to
// everyone else (`room-control.mjs` `onReload`), and drops one from the dead,
// a name no template has the shape of, and a repeat on the first's heels.
{
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  joinPeer(core, pA, 'RLD', 'Loader', 1);
  joinPeer(core, pB, 'RLD', 'Ear', 2);
  const room = core.room('RLD');
  const slotA = [...room.players.entries()].find(([, c]) => c.peer === pA)[0];
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  sendJson(pB, MSG_ACTION, { type: 'spawn', flag: 1, kit: 'assault' });
  room.frame(FRAME_MS); clock.ms += FRAME_MS;
  pA.sent.length = 0; pB.sent.length = 0;
  const reloads = peer => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow)
    .filter(r => r.type === 'reload');
  sendJson(pA, MSG_ACTION, { type: 'reload', weapon: 'Thompson' });
  sendJson(pA, MSG_ACTION, { type: 'reload', weapon: 'Thompson' });
  const heard = reloads(pB);
  const echoed = reloads(pA).length;
  clock.ms += 200;
  sendJson(pA, MSG_ACTION, { type: 'reload', weapon: '<script>' });
  sendJson(pA, MSG_ACTION, { type: 'reload' });
  const badNames = reloads(pB).length - heard.length;
  room.world.armorOf(slotA).applyDamage(999);
  room.frame(FRAME_MS); clock.ms += 400;
  sendJson(pA, MSG_ACTION, { type: 'reload', weapon: 'Thompson' });
  const fromTheDead = reloads(pB).length - heard.length - badNames;
  results.z2 = { heard: heard.map(r => ({ slot: r.slot, weapon: r.weapon })), slotA, echoed,
                 badNames, fromTheDead };
}

// --- (z2b) a stab heard and seen by the others ------------------------------------
// The page names the weapon and the FireArms its stab fired; the room relays
// it to everyone else (`room-control.mjs` `onStab`), and drops one from the
// dead or with a name no template has the shape of.
{
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  joinPeer(core, pA, 'STB', 'Stabber', 1);
  joinPeer(core, pB, 'STB', 'Ear', 2);
  const room = core.room('STB');
  const slotA = [...room.players.entries()].find(([, c]) => c.peer === pA)[0];
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  sendJson(pB, MSG_ACTION, { type: 'spawn', flag: 1, kit: 'assault' });
  room.frame(FRAME_MS); clock.ms += FRAME_MS;
  pA.sent.length = 0; pB.sent.length = 0;
  const stabs = peer => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow)
    .filter(r => r.type === 'stab');
  sendJson(pA, MSG_ACTION, { type: 'stab', weapon: 'No4Bayonet', alt: 'No4BayonetStabFireArm' });
  const heard = stabs(pB);
  const echoed = stabs(pA).length;
  sendJson(pA, MSG_ACTION, { type: 'stab', weapon: 'No4Bayonet', alt: '<script>' });
  sendJson(pA, MSG_ACTION, { type: 'stab', weapon: 'No4Bayonet' });
  const badNames = stabs(pB).length - heard.length;
  room.world.armorOf(slotA).applyDamage(999);
  room.frame(FRAME_MS); clock.ms += 400;
  sendJson(pA, MSG_ACTION, { type: 'stab', weapon: 'No4Bayonet', alt: 'No4BayonetStabFireArm' });
  const fromTheDead = stabs(pB).length - heard.length - badNames;
  results.z2b = { heard: heard.map(r => ({ slot: r.slot, weapon: r.weapon, alt: r.alt })), slotA, echoed,
                  badNames, fromTheDead };
}

// --- (z3) a reported landing, priced by the room (HP-9, HP-10, KNOCK-4..9) ---------
// The shooter's page reports where its round met what (`room-hits.mjs`): a
// direct hit costs the hull its hit points (a `hull` row), a blast three
// metres from a soldier on foot costs him its priced damage and throws him
// (a `blast` row with the push, his body flying on the server, the snapshot
// naming the flight), and a report from the dead or off the shape is dropped.
{
  const real = process.env.REAL_VIEWER;
  const { readFileSync } = await import('node:fs');
  const tables = real ? JSON.parse(readFileSync(join(real, 'maps', '_shared', 'damage.json'), 'utf8')) : null;
  const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
  const descriptor = {
    ...base, name: 'hits', vehicles: undefined,
    extras: {
      ...base.extras,
      objectSpawns: [{ vehicle: 'Willy', team: 1, position: [40, 0, 40], rotation: [0, 0, 0],
                       minSpawnDelay: 5, maxSpawnDelay: 10, controlPointName: 'North' }],
    },
  };
  const level = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor });
  level.damageTables = tables;
  core.levels.set('hits', level);
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  sendJson(pA, MSG_JOIN, { room: 'HITS', name: 'Shooter', team: 1, level: 'hits' });
  sendJson(pB, MSG_JOIN, { room: 'HITS', name: 'Target', team: 2, level: 'hits' });
  const room = core.room('HITS');
  const w = room.world;
  const step = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  sendJson(pB, MSG_ACTION, { type: 'spawn', flag: 1, kit: 'assault' });
  step(10);
  const willy = room.instance.table.find(e => e.template === 'Willy');
  const hullHp = () => w.vehicleDamage.get(willy.owner).hitPoints;
  const hpBefore = hullHp();
  pB.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'impact', point: [40, 1, 40], hit: { vehicle: willy.id },
                             damage: 10, splash: null });
  step(1);
  const hullRow = pB.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow).find(r => r.type === 'hull');
  // The blast: material 200 (`damage.json`: 10 damage, a mod of 2.5 against
  // the soldier's 40, so it cannot kill a 30-point soldier), radius 10, three
  // metres from him: inside half the radius, where it pushes.
  const sb = w.player(2).soldier;
  const target = { x: sb.x, y: sb.y, z: sb.z };
  const hpTargetBefore = w.armorOf(2).hitPoints;
  pA.sent.length = 0; pB.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'impact', point: [target.x + 3, target.y + 0.5, target.z], hit: null,
                             damage: 0, splash: { radius: 10, material2: 200, yMod: 1, force: 150 } });
  const blastRow = pA.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow).find(r => r.type === 'blast');
  const lost = hpTargetBefore - w.armorOf(2).hitPoints;
  step(1);
  const v = sb.body.velocity;
  const speedAfter = Math.hypot(v.x, v.y, v.z);
  const flightOnServer = sb.body.knockback?.family ?? null;
  step(4);
  const snap = ofType(pA, MSG_SNAPSHOT).at(-1);
  const wireFlight = snap ? decodeSnapshot(snap.subarray(1)).players.find(p => p.slot === 2)?.flight : null;
  // The shapes the room drops.
  const hpBeforeBad = hullHp();
  sendJson(pA, MSG_ACTION, { type: 'impact', point: [40, 1], hit: { vehicle: willy.id }, damage: 10 });
  sendJson(pA, MSG_ACTION, { type: 'impact', point: [40, 1, 40], hit: { vehicle: 99 }, damage: 10 });
  w.armorOf(1).applyDamage(999);
  step(1);
  sendJson(pA, MSG_ACTION, { type: 'impact', point: [40, 1, 40], hit: { vehicle: willy.id }, damage: 10 });
  step(1);
  results.z3 = {
    tables: !!tables, hpBefore, hullRow: hullRow ? { vehicle: hullRow.vehicle, hp: hullRow.hp } : null,
    willyId: willy.id,
    blastRow: blastRow ? { slot: blastRow.slot, push: blastRow.push.map(n => Math.round(n)) } : null,
    lost, speedAfter, flightOnServer, wireFlight, droppedLoss: hpBeforeBad - hullHp(),
  };
}

// --- (z3p) the medic bag and the wrench, run by the room (room-packs.mjs) -------
// A page names each round of its pack (`{type: 'pack', weapon}`); the room
// runs `useMedPack` / `useRepairPack` (`healing-packs.js`) on its own world:
// the bag heals every wounded soldier within 10 m, the enemy included, and
// the holder at the lower rate; the wrench repairs a wounded hull in reach,
// not while the holder crouches and not one the other side holds; the heal
// reaches the healed player's snapshot. Off-shape rounds are dropped.
{
  const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
  const descriptor = {
    ...base, name: 'packs', vehicles: undefined,
    extras: {
      ...base.extras,
      objectSpawns: [{ vehicle: 'Willy', team: 1, position: [40, 0, 40], rotation: [0, 0, 0],
                       minSpawnDelay: 5, maxSpawnDelay: 10, controlPointName: 'North' }],
    },
  };
  const level = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor });
  core.levels.set('packs', level);
  const pA = attachPeer(core, String(nextTag++));
  const pB = attachPeer(core, String(nextTag++));
  sendJson(pA, MSG_JOIN, { room: 'PACKS', name: 'Medic', team: 1, level: 'packs' });
  sendJson(pB, MSG_JOIN, { room: 'PACKS', name: 'Enemy', team: 2, level: 'packs' });
  const room = core.room('PACKS');
  const w = room.world;
  const step = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'medic' });
  sendJson(pB, MSG_ACTION, { type: 'spawn', flag: 1, kit: 'assault' });
  step(5);
  const sa = w.player(1).soldier;
  const sb = w.player(2).soldier;
  const place = (s, x, z) => s.spawn(x, sa.y, z, 0);
  const hp = slot => w.armorOf(slot).hitPoints;
  const r3 = v => Math.round(v * 1000) / 1000;
  const pack = (peer, weapon) => sendJson(peer, MSG_ACTION, { type: 'pack', weapon });
  // The bag: the enemy 6 m off, both wounded.
  place(sa, 10, 10); place(sb, 16, 10);
  w.armorOf(1).applyDamage(10); w.armorOf(2).applyDamage(10.6);
  step(30);
  const before = { a: hp(1), b: hp(2) };
  pack(pA, 'MedPack');
  const bag = { a: r3(hp(1) - before.a), b: r3(hp(2) - before.b) };
  step(3);
  const snap = ofType(pB, MSG_SNAPSHOT).at(-1);
  const wireHp = snap ? decodeSnapshot(snap.subarray(1)).players.find(p => p.slot === 2)?.hp : null;
  // Out of reach: 12 m.
  place(sb, 22, 10);
  step(30);
  const far0 = hp(2);
  pack(pA, 'MedPack');
  const far = r3(hp(2) - far0);
  // Not a pack, and the enemy's own kit carries no MedPack (an assault kit
  // when the room can name it; the harness level has no loadouts, so the
  // weapon gate is what refuses here).
  step(30);
  const odd0 = hp(1);
  pack(pA, 'Thompson');
  const notPack = r3(hp(1) - odd0);
  // The rate: twenty rounds at once are capped at the bucket.
  step(60);
  const burst0 = hp(1);
  for (let i = 0; i < 20; i++) pack(pA, 'MedPack');
  const burst = Math.round((hp(1) - burst0) / 0.15);
  // The wrench: the Willy wounded, the engineer two metres off.
  const willy = room.instance.table.find(e => e.template === 'Willy');
  const hull = w.vehicleDamage.get(willy.owner);
  hull.damage(5);
  place(sa, 38, 40);
  step(30);
  const h0 = hull.hitPoints;
  pack(pA, 'RepairPack');
  const standing = r3(hull.hitPoints - h0);
  step(30);
  sa.stance = 'crouch';
  const h1 = hull.hitPoints;
  pack(pA, 'RepairPack');
  const crouched = r3(hull.hitPoints - h1);
  // Crouched, the wrench's lift goes to every page (SUP-28): a mine 1.5 m
  // off is passed on; one 5 m off, a round the wrench does not lift, and a
  // standing holder's claim are not.
  const disarmRows = () => ofType(pB, MSG_EVENT).map(jsonRow).filter(r => r?.type === 'disarm');
  // The stance is set at each claim: the room's input step stands him up.
  const lift = (at, template = 'LandmineProjectile', stance = 'crouch') => {
    sa.stance = stance;
    sendJson(pA, MSG_ACTION, { type: 'pack', weapon: 'RepairPack', disarm: { at, template } });
  };
  step(30);
  lift([sa.x + 1.5, sa.y, sa.z]);
  step(1);
  const liftNear = disarmRows().at(-1) ?? null;
  step(30);
  lift([sa.x + 5, sa.y, sa.z]);
  step(30);
  lift([sa.x + 1, sa.y, sa.z], 'APLandmineT1');
  step(1);
  const liftRefused = disarmRows().length;
  sa.stance = 'stand';
  step(30);
  lift([sa.x + 1, sa.y, sa.z], 'LandmineProjectile', 'stand');
  step(1);
  const liftStanding = disarmRows().length;
  step(30);
  willy.keptTeam = 2;
  const h2 = hull.hitPoints;
  pack(pA, 'RepairPack');
  const enemyHull = r3(hull.hitPoints - h2);
  willy.keptTeam = 0;
  // The dead heal nobody.
  step(30);
  place(sb, 12, 40);
  w.armorOf(1).applyDamage(999);
  step(1);
  const dead0 = hp(2);
  pack(pA, 'MedPack');
  results.z3p = { before, bag, wireHp, wantWireHp: Math.round(before.b + 0.25), wireBefore: Math.round(before.b), far, notPack, burst,
                  standing, crouched, enemyHull, deadHeal: r3(hp(2) - dead0),
                  liftNear: liftNear && { slot: liftNear.slot, template: liftNear.template,
                                          dx: r3(liftNear.at[0] - sa.x) },
                  liftRefused, liftStanding };
}

// --- (z4) a static's hit points go to every client (Battle of Britain's factory) -
// A placed object with an Armor and no seat is named by its `scene.glb` node:
// a direct hit on it is priced like a hull's and its hit points go out as an
// `object` row, the name the page finds its own copy by.
{
  const real = process.env.REAL_VIEWER;
  if (real) {
    core.levels.set('battle_of_britain', loadRealLevel({ viewerDir: real, name: 'battle_of_britain' }));
    const pA = attachPeer(core, String(nextTag++));
    sendJson(pA, MSG_JOIN, { room: 'BOB-REAL', name: 'Bomber', team: 1, level: 'battle_of_britain' });
    const room = core.room('BOB-REAL');
    const step = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
    sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
    step(2);
    const table = new Set(room.instance.table.map(e => e.owner));
    let factory = null;
    for (const [owner] of room.world.vehicleDamage.byOwner) {
      const node = room.instance.ownerRoots[owner];
      if (!table.has(owner) && node?.levelNode != null) { factory = { owner, node: node.levelNode, name: node.name }; break; }
    }
    pA.sent.length = 0;
    if (factory) {
      sendJson(pA, MSG_ACTION, { type: 'impact', point: [0, 0, 0], hit: { node: factory.node },
                                 damage: 250, splash: null });
      step(1);
    }
    const objectRow = pA.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow).find(r => r.type === 'object');
    results.z4 = {
      factory, objectRow: objectRow ? { node: objectRow.node, hp: objectRow.hp, destroyed: objectRow.destroyed } : null,
      hp: factory ? room.world.vehicleDamage.get(factory.owner).hitPoints : null,
      max: factory ? room.world.vehicleDamage.get(factory.owner).maxHitPoints : null,
    };
    // A wreck is still a body (`ResponsePhysicsManager::update` 0x0825d0b0
    // asks no destroyed flag, HP-21): a parked hull killed in the room keeps
    // its parked body, and loses it at its Armor's time to live (HP-19).
    const w = room.world;
    const hull = room.instance.table.find(e => e.live && w.bodyWorld?.get(e.owner)?.parked);
    if (hull) {
      const entry = () => w.bodyWorld.get(hull.owner) ?? null;
      w.vehicleDamage.get(hull.owner).damage(1e6, null);
      step(2);
      const dead = entry();
      const wreck = { template: hull.template, destroyed: w.vehicleDamage.get(hull.owner).destroyed,
                      body: !!dead, parked: !!dead?.parked };
      let seconds = 0;
      while (entry() && seconds < 120) { step(30); seconds++; }
      wreck.goneAfter = seconds;
      results.z4.wreckBody = wreck;
    }
  }
}

// --- (z5) an abandoned hull's clock (SPAWN-13) -----------------------------------
// A pad's hull left farther from its pad than its spawner's `Distance`, with
// nobody in it and no soldier near, counts `timeToLive` down in 0.5 s steps and
// then loses `damageWhenLost` a second; one near its pad keeps its clock full.
{
  const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
  const descriptor = {
    ...base, name: 'abandon', vehicles: undefined,
    extras: {
      ...base.extras,
      objectSpawns: [{ vehicle: 'Willy', team: 1, position: [40, 0, 40], rotation: [0, 0, 0],
                       minSpawnDelay: 5, maxSpawnDelay: 10, controlPointName: 'North',
                       timeToLive: 2, distance: 5, damageWhenLost: 4 }],
    },
  };
  core.levels.set('abandon', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor }));
  const pA = attachPeer(core, String(nextTag++));
  sendJson(pA, MSG_JOIN, { room: 'ABANDON', name: 'Walker', team: 1, level: 'abandon' });
  const room = core.room('ABANDON');
  const step = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  const willy = room.instance.table.find(e => e.template === 'Willy');
  const hp = () => room.world.vehicleDamage.get(willy.owner).hitPoints;
  step(Math.round(4 * 30));
  const atPad = hp();
  // Off its pad: the room's own pose answers through `vehiclePose`, and a
  // descriptor hull with no body answers from its registration pose.
  room.world.positions.set(willy.owner, [140, 0, 140]);
  step(Math.round(4 * 30));
  const away = hp();
  results.z5 = { max: room.world.vehicleDamage.get(willy.owner).maxHitPoints, atPad, away };
}

// --- (z) the room's vehicle pads (SPAWN-2, SPAWN-10..SPAWN-19, HP-20) ------------
// One pad under North, which changes hands: the Axis's Willy, the Allies'
// Zero. The room stands the holder's template on it, a hull's death takes
// its crew and runs the pad's delay from the death (`calcSpawnDelay` over the
// room's players), the wreck on the pad goes when the next hull comes, a
// capture changes what the pad hands out but never the hull already
// standing, and the round's end clears the hulls while the restart stands
// the level's own again.
{
  const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
  const descriptor = {
    ...base, name: 'pads', vehicles: undefined,
    extras: {
      ...base.extras,
      tickets: { team1: 2, team2: 100, lossPerMin: { team1: 0, team2: 0 } },
      objectSpawns: [{
        vehicle: 'Willy', team: 1, position: [40, 0, 40], rotation: [0, 0, 0],
        minSpawnDelay: 5, maxSpawnDelay: 10, spawnDelayAtStart: 0, controlPointName: 'North',
        templates: { 1: 'Willy', 2: 'Zero' },
      }],
    },
  };
  core.levels.set('pads', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor }));
  const pP = attachPeer(core, String(nextTag++));
  sendJson(pP, MSG_JOIN, { room: 'PADS', name: 'Pilot', team: 1, level: 'pads' });
  const hello = jsonRow(pP.sent.find(b => b[0] === MSG_HELLO));
  const room = core.room('PADS');
  const w = room.world;
  const rows = () => pP.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow);
  const step = n => { for (let i = 0; i < n; i++) { clock.ms += FRAME_MS; room.frame(FRAME_MS); } };
  const willy = room.instance.table.find(e => e.template === 'Willy');
  const zero = room.instance.table.find(e => e.template === 'Zero');
  const kill = entry => w.vehicleDamage.get(entry.owner).damage(1e6, null);
  sendJson(pP, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  step(2);
  // The Pilot takes the Willy; its death kills him and leaves a wreck.
  sendJson(pP, MSG_ACTION, { type: 'seat', vehicle: willy.id, seat: 0, action: 'enter' });
  step(1);
  const seated = !!w.player(1).occupancy;
  pP.sent.length = 0;
  kill(willy);
  step(2);
  const death = rows();
  const killedInHull = death.some(r => r.type === 'killed' && r.slot === 1);
  const hullRow = death.find(r => r.type === 'hull' && r.vehicle === willy.id);
  const unseated = !w.player(1).occupancy;
  // The delay runs from the death: 5 + 5 * (1 - 1/16) with one player in.
  const delay = room.pads.records[0].pad.delay;
  pP.sent.length = 0;
  step(Math.round(9 * 30));
  const before = rows().filter(r => r.type === 'padSpawn' || r.type === 'vehicleGone');
  step(Math.round(1.5 * 30));
  const replaced = rows().filter(r => r.type === 'padSpawn' || r.type === 'vehicleGone')
    .map(r => [r.type, r.vehicle, r.template ?? null]);
  const freshHp = w.vehicleDamage.get(willy.owner).hitPoints;
  // The Allies take North: the Willy standing stays; its next death brings a Zero.
  w.flags[0].team = 2;
  step(2);
  const stillWilly = willy.live && !zero.live;
  pP.sent.length = 0;
  kill(willy);
  step(Math.round(10.5 * 30));
  const afterCapture = rows().filter(r => r.type === 'padSpawn').map(r => r.template);
  // The round's end (two Axis tickets, one spent above and one now) clears
  // the hulls; the restart stands the level's Willy on North again. North
  // goes back to the Axis first, or the Pilot would deploy on the Allies'.
  w.flags[0].team = 1;
  stepPastWave(room, 1, step);
  sendJson(pP, MSG_ACTION, { type: 'spawn', flag: 0, kit: 'assault' });
  step(1);
  pP.sent.length = 0;
  w.armorOf(1).applyDamage(999);
  step(3);
  const ended = rows();
  const goneAtEnd = ended.filter(r => r.type === 'vehicleGone').map(r => r.vehicle);
  pP.sent.length = 0;
  step(Math.round(10.5 * 30));
  const restarted = rows();
  results.z = {
    hello: hello.vehicles.map(v => ({ template: v.template, pad: v.pad, live: v.live })),
    seated, killedInHull, unseated,
    hullRow: hullRow ? { hp: hullRow.hp, destroyed: hullRow.destroyed } : null,
    delay, before, replaced, freshHp, maxHp: w.vehicleDamage.get(willy.owner).maxHitPoints,
    willyId: willy.id, zeroId: zero.id, stillWilly, afterCapture,
    roundEnded: ended.some(r => r.type === 'roundEnd'), goneAtEnd,
    restartSpawns: restarted.filter(r => r.type === 'padSpawn').map(r => r.template),
    restarted: restarted.some(r => r.type === 'restart'),
    liveAfter: room.instance.table.filter(e => e.live).map(e => e.template),
  };
}

// --- (preGame) the pre-game's setTeam (SPAWN-21) -----------------------------------
// The room loads its pads in the pre-game, so a `spawnDelayAtStart` pad with
// its own `Object.setTeam` stands its hull at once; one with no side of its
// own keeps the delay (`deployables.js` `preGameSetTeam`, the page's law).
{
  const base = buildLevelFromDescriptor({ viewerDir: VIEWER_DIR }).descriptor;
  const pad = (vehicle, team, x) => ({
    vehicle, team, position: [x, 0, 40], rotation: [0, 0, 0],
    minSpawnDelay: 30, maxSpawnDelay: 30, spawnDelayAtStart: 1, controlPointName: 'North',
  });
  const descriptor = {
    ...base, name: 'pregame', vehicles: undefined,
    extras: { ...base.extras, objectSpawns: [pad('Willy', 1, 40), pad('Zero', 0, 80)] },
  };
  core.levels.set('pregame', buildLevelFromDescriptor({ viewerDir: VIEWER_DIR, descriptor }));
  const pQ = attachPeer(core, String(nextTag++));
  sendJson(pQ, MSG_JOIN, { room: 'PREGAME', name: 'Early', team: 1, level: 'pregame' });
  const room = core.room('PREGAME');
  results.preGame = room.pads.records.map(r => ({ template: r.spawn.vehicle, live: r.live.size }));
}

// --- R-1: retail's one-pass choke (`chokeBandwidth` 0x08132cc0) ------------------
{
  const conns = n => new Map(Array.from({ length: n }, (_, i) => [i + 1, { rate: 20, budget: 1400 }]));
  const view = m => [...m.values()].map(c => [c.rate, c.budget]);
  const off = conns(16); chokeRates(off, 0);
  const under = conns(2); chokeRates(under, 2 * 20 * 1400);
  // cap 100000 over 4: share 25000, 25000 / 20 = 1250 > 260 -> budget cut.
  const budget = conns(4); chokeRates(budget, 100_000);
  // cap 16000 over 4: share 4000, 4000 / 20 = 200 <= 260 -> rate 15, budget kept.
  const rate = conns(4); chokeRates(rate, 16_000);
  // rates already at the floor are left alone.
  const floor = new Map([[1, { rate: 10, budget: 1400 }]]); chokeRates(floor, 1000);
  results.choke = { off: view(off), under: view(under), budget: view(budget), rate: view(rate), floor: view(floor) };
}

// --- (runOver) a room's moving hull runs a soldier over --------------------------------
// The owner's report (2026-11-12): a vehicle rolling over a soldier left them
// stuck under it. The room never told its collider where a driven hull
// stood (`level-instance.mjs` `publishHullPoses`), so on the server a soldier
// met only the hull's baked ghost and nothing a driven hull did could push or
// run them over. On real Wake: one player drives a land hull flat out, the
// other is stood on foot in its path; the room's own rows must name the
// driver as the killer (`authority.mjs`, `roadkill`), or, under 8 m/s, the
// soldier must be pushed clear and alive.
{
  const real = process.env.REAL_VIEWER;
  if (real) {
    const rClock = { ms: 0 };
    const rCore = new RoomServerCore({
      levels: new Map([['wake', loadRealLevel({ viewerDir: real, name: 'wake' })]]),
      defaultLevel: 'wake', now: () => rClock.ms, rules: { gameStartDelay: 0, roundStartDelay: 0 },
    });
    const pD = attachPeer(rCore, 'r-driver');
    const pV = attachPeer(rCore, 'r-victim');
    const hD = joinPeer(rCore, pD, 'RUNOVER', 'Driver', 1);
    const hV = joinPeer(rCore, pV, 'RUNOVER', 'Victim', 2);
    const rRoom = rCore.room('RUNOVER');
    const rw = rRoom.world;
    const inst = rRoom.instance;
    const lap = () => { rClock.ms += FRAME_MS; rRoom.frame(FRAME_MS); };
    const entry = inst.table.find(v => v.kind === 'tank') ?? inst.table.find(v => v.kind === 'ground');
    const out = { template: entry?.template ?? null, driverSlot: hD?.slot ?? null, victimSlot: hV?.slot ?? null };
    if (entry && hD && hV) {
      const dSlot = hD.slot, vSlot = hV.slot;
      // Each on a flag of their own side: the room spawns nobody on the
      // other side's (`spawnPlayer` 0x0814cb3e).
      const own = team => Math.max(0, inst.flags.findIndex(f => flagSide(f) === team));
      sendJson(pD, MSG_ACTION, { type: 'spawn', flag: own(1), kit: 'assault' });
      sendJson(pV, MSG_ACTION, { type: 'spawn', flag: own(2), kit: 'assault' });
      lap();
      sendJson(pD, MSG_ACTION, { type: 'seat', vehicle: entry.id, seat: 0, action: 'enter' });
      lap();
      out.seated = entry.driver === dSlot;
      const drive = rw.player(dSlot)?.vehicle;
      // Flat out for two seconds (the room's own input feed, as (i) drives):
      // Wake's first Willy is doing 10 m/s by then, and 18 m on it meets a
      // wall, so the victim is stood 5 m ahead of it.
      const throttle = () => { rw.player(dSlot).pending = { input: walkInput(), lookX: 0, lookY: 0 }; };
      for (let i = 0; i < 60; i++) { throttle(); lap(); }
      const st = drive?.state;
      const speed = st ? Math.hypot(st.velocity.x, st.velocity.z) : 0;
      out.speedBefore = Math.round(speed * 100) / 100;
      out.published = inst.collider?.moved?.has(entry.owner) ?? false;
      if (st && speed > 1) {
        // The victim, stood 5 m ahead along the hull's motion.
        const ux = st.velocity.x / speed, uz = st.velocity.z / speed;
        const x = st.position.x + ux * 5, z = st.position.z + uz * 5;
        const victim = rw.player(vSlot);
        victim.soldier.spawn(x, inst.groundHeightAt(x, z), z, 0);
        const hp0 = victim.armor?.hitPoints ?? null;
        pV.sent.length = 0;
        let closest = Infinity, inside = 0;
        for (let i = 0; i < 90; i++) {
          throttle();
          lap();
          const s = victim.soldier.body.position;
          const p = drive.state.position;
          closest = Math.min(closest, Math.hypot(s.x - p.x, s.z - p.z));
          if (victim.armor?.destroyed) break;
        }
        const rows = ofType(pV, MSG_EVENT).map(jsonRow);
        const killed = rows.find(r => r.type === 'killed' && r.slot === vSlot) ?? null;
        out.hp0 = hp0;
        out.hp = victim.armor?.hitPoints ?? null;
        out.closest = Math.round(closest * 100) / 100;
        out.killed = killed;
        out.contactSpeed = Math.round(Math.hypot(drive.state.velocity.x, drive.state.velocity.z) * 100) / 100;
      }
    }
    results.runOver = out;
  } else {
    results.runOver = { loaded: false };
  }
}

// --- (rules) the pre-game and the team-kill law, on the shipped settings -----
// A room on `ROOM_RULES` (the dedicated serversettings.con): a new map holds
// every spawn for 20 s and a restart for 10 (ROUND-14); a team kill marks the
// victim, punish mode counts it only on `punish`, and the fifth punished team
// kill kicks (FF-9..FF-11).
{
  const rClock = { ms: 0 };
  const rCore = new RoomServerCore({ levels: new Map([['test', levelData]]), defaultLevel: 'test',
                                     now: () => rClock.ms, random: () => 0 });
  const lap = (n = 1) => {
    const room = rCore.room('RUL');
    for (let i = 0; i < n; i++) {
      for (const c of room.players.values()) c.lastSeen = room.now();
      rClock.ms += FRAME_MS; room.frame(FRAME_MS);
    }
  };
  const rows = peer => peer.sent.filter(b => b[0] === MSG_EVENT).map(jsonRow);
  const pA = attachPeer(rCore, 'rulA');
  const pB = attachPeer(rCore, 'rulB');
  const pC = attachPeer(rCore, 'rulC');
  const hello = joinPeer(rCore, pA, 'RUL', 'Alpha', 1);
  joinPeer(rCore, pB, 'RUL', 'Bravo', 1);
  joinPeer(rCore, pC, 'RUL', 'Charlie', 2);
  const room = rCore.room('RUL');
  const out = { rules: { ...room.authority.rules }, hello: hello?.round ?? null };
  // The pre-game: refused with the clock as the wait.
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, team: 1 });
  out.early = rows(pA).find(r => r.type === 'spawnRefused') ?? null;
  lap(10 * 30);
  pA.sent.length = 0;
  sendJson(pA, MSG_ACTION, { type: 'spawn', flag: 0, team: 1 });
  out.mid = rows(pA).find(r => r.type === 'spawnRefused') ?? null;
  lap(10 * 30 + 2);
  out.roundStart = rows(pA).some(r => r.type === 'roundStart');
  out.status = room.authority.round.status;
  for (const [peer, flag, team] of [[pA, 0, 1], [pB, 0, 1], [pC, 1, 2]]) {
    sendJson(peer, MSG_ACTION, { type: 'spawn', flag, team });
  }
  out.spawned = [1, 2, 3].map(slot => !room.world.player(slot)?.armor?.destroyed && room.authority.mayInput(slot));
  // A team kill: Alpha (slot 1) kills Bravo (slot 2).
  const kill = (victim, killer) => {
    const armor = room.world.player(victim).armor;
    armor.applyDamage(armor.hitPoints + armor.maxHitPoints);
    armor.lastHit = killer;
    lap(1);
  };
  const respawn = (peer, slot, flag, team) => {
    for (let i = 0; i < 200 * 30 && room.authority.spawnWaitLeft(slot) > 0; i++) lap(1);
    sendJson(peer, MSG_ACTION, { type: 'spawn', flag, team });
  };
  kill(2, 1);
  out.afterTk = room.authority.teamKillsOf(1);
  // Punish mode: forgive does nothing, punish counts it.
  sendJson(pB, MSG_ACTION, { type: 'tk', verb: 'forgive' });
  out.afterForgive = room.authority.teamKillsOf(1);
  sendJson(pB, MSG_ACTION, { type: 'tk', verb: 'punish' });
  out.afterPunish = room.authority.teamKillsOf(1);
  out.punishedRow = rows(pA).find(r => r.type === 'teamKillPunished') ?? null;
  sendJson(pB, MSG_ACTION, { type: 'tk', verb: 'punish' });
  out.twice = room.authority.teamKillsOf(1);
  // Alpha's next death pays one wave for the team kill.
  respawn(pB, 2, 0, 1);
  const before = room.authority.round.clock;
  kill(1, 3);
  const killed = rows(pA).filter(r => r.type === 'killed' && r.slot === 1).at(-1) ?? null;
  out.penaltyWait = killed?.sw ?? null;
  out.penaltyPhase = Math.round((before % 25) * 1000) / 1000;
  out.afterDeath = room.authority.teamKillsOf(1);
  // Four more punished team kills: the fifth reaches nrOfTKToKick and kicks.
  respawn(pA, 1, 0, 1);
  for (let n = 0; n < 4; n++) {
    respawn(pB, 2, 0, 1);
    kill(2, 1);
    sendJson(pB, MSG_ACTION, { type: 'tk', verb: 'punish' });
  }
  out.kicked = { closed: pA.closed, inRoom: room.players.has(1),
                 leave: rows(pC).some(r => r.type === 'leave' && r.slot === 1) };
  results.rules = out;

  // Punish mode off (the engine's own default): the counts rise at once, a
  // forgive takes one back, the limit kills the killer, and their next spawn
  // asks kick them.
  const oClock = { ms: 0 };
  const oCore = new RoomServerCore({ levels: new Map([['test', levelData]]), defaultLevel: 'test',
                                     now: () => oClock.ms, random: () => 0,
                                     rules: { gameStartDelay: 0, tkPunishMode: false, nrOfTKToKick: 2 } });
  const oA = attachPeer(oCore, 'offA');
  const oB = attachPeer(oCore, 'offB');
  joinPeer(oCore, oA, 'OFF', 'Alpha', 1);
  joinPeer(oCore, oB, 'OFF', 'Bravo', 1);
  const oRoom = oCore.room('OFF');
  const oLap = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const c of oRoom.players.values()) c.lastSeen = oRoom.now();
      oClock.ms += FRAME_MS; oRoom.frame(FRAME_MS);
    }
  };
  const oKill = (victim, killer) => {
    const armor = oRoom.world.player(victim).armor;
    armor.applyDamage(armor.hitPoints + armor.maxHitPoints);
    armor.lastHit = killer;
    oLap(1);
  };
  const oRespawn = (peer, slot) => {
    for (let i = 0; i < 200 * 30 && oRoom.authority.spawnWaitLeft(slot) > 0; i++) oLap(1);
    sendJson(peer, MSG_ACTION, { type: 'spawn', flag: 0, team: 1 });
  };
  const off = {};
  oLap(1);
  sendJson(oA, MSG_ACTION, { type: 'spawn', flag: 0, team: 1 });
  sendJson(oB, MSG_ACTION, { type: 'spawn', flag: 0, team: 1 });
  oKill(2, 1);
  off.afterTk = oRoom.authority.teamKillsOf(1);
  sendJson(oB, MSG_ACTION, { type: 'tk', verb: 'punish' });
  off.afterPunish = oRoom.authority.teamKillsOf(1);
  sendJson(oB, MSG_ACTION, { type: 'tk', verb: 'forgive' });
  off.afterForgive = oRoom.authority.teamKillsOf(1);
  oRespawn(oB, 2); oKill(2, 1);
  oRespawn(oB, 2); oKill(2, 1);
  oLap(1);
  off.killerDead = !oRoom.authority.mayInput(1);
  off.atLimit = oRoom.authority.teamKillsOf(1);
  oRespawn(oA, 1);
  off.kicked = { closed: oA.closed, inRoom: oRoom.players.has(1) };
  results.rulesOff = off;
}

// --- (stranded) a side with no spawn group and nobody alive loses (TKT-5) ----
// Weapon Bunkers in small: Iraq's only group rides a carrier the room holds
// (a static it can destroy); with it gone and nobody of Iraq alive, Iraq
// bleeds at the at-end rate, 1000 a minute, its first ticket a whole
// `60 / rate` after it is stranded.
{
  const { room, rows, bleeds } = bleedRoom('STR', {
    controlPoints: [
      { name: 'US_base', team: 2, areaValue: 50, spawnGroupId: 1, unableToChangeTeam: true,
        radius: 50, timeToGetControl: 9999, position: [200, 0, 200] },
    ],
    soldierSpawns: [
      { name: 'US_spawn', group: 1, team: 2, position: [200, 0, 200], rotation: [180, 0, 0], changeTeam: false },
    ],
    vehicleSoldierSpawns: [
      { vehicle: 'Bunker', pad: 7, name: 'Iraq_spawn', group: 99, team: 1, position: [-200, 0, -200],
        rotation: [0, 0, 0], changeTeam: false },
    ],
    tickets: { mode: 'Conquest', team1: 100, team2: 100, lossPerMin: { team1: 5, team2: 5 } },
  });
  const out = {};
  runTicks(room, 30);
  out.whole = { ...countsOf(room) };
  // The room's own answer for the carrier (`carriedPointGone`), forced gone.
  const spawn = room.instance.extras.vehicleSoldierSpawns[0];
  room.instance.carriedPointGone = s => s === spawn;
  const strandedAt = room.tick;
  runTicks(room, 25 * 30);
  const iraq = bleeds(1);
  out.first = iraq.length ? Math.round((iraq[0].t - strandedAt) / 30 * 100) / 100 : null;
  out.last = iraq.length ? iraq.at(-1).count : null;
  out.bled = iraq.length;
  const end = rows.find(r => r.type === 'roundEnd') ?? null;
  out.end = end ? { winner: end.winner, reason: end.reason,
                    at: Math.round((end.t - strandedAt) / 30 * 100) / 100 } : null;
  out.us = bleeds(2).length;
  results.stranded = out;
}

console.log(JSON.stringify(results));
