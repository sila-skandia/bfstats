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
      }
    }
    results.i = {
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
  const descriptor = {
    name,
    extras: { worldSize: 1000, gameplayMode: 'Conquest', ...extras },
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
    flags: room.world.flags.map(f => f.controlPointName),
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

console.log(JSON.stringify(results));
