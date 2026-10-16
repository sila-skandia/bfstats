// The sidecar wire seam under node: `net-sidecar.js` driven against a scripted
// socket and real v5 record shapes. Tests the LAWS, not the page: the roster
// and slot from createPlayer, the transform and stance the renderer reads, the
// own-slot exclusion, the input frame's type byte and increasing seq, the
// action and leave frames, and the event rows the page's feed consumes.
//
// The records below are copied from a real sidecar capture
// (tools/bf1942-models/run.ndjson), so the shapes are the sidecar's own, not a
// paraphrase of them. See `tests/test_sidecar_client.py` for the assertions.

import { createSidecarClient, createSidecarState, yawPitchOf } from './net-sidecar.mjs';
import { decodeInputFrame, MSG_INPUT, MSG_ACTION, MSG_LEAVE, INPUT_BYTES } from './netcode.js';

class FakeSocket {
  constructor() { this.sent = []; this.closed = false; }
  send(bytes) { this.sent.push(bytes); }
  close() { this.closed = true; }
}

const results = {};

// --- the pure state: records in, room-shaped state out ----------------------

const pure = createSidecarState();
// A small state table whose indices name stances, as the engine's does.
const ANIM = [];
ANIM[1] = 'Lb_Stand';
ANIM[2] = 'Lb_Lie';
ANIM[3] = 'Lb_RunStandToLie';
ANIM[4] = 'Lb_StandToCrouch';
ANIM[5] = 'Ub_FireType99';

const RECORDS = [
  { k: 'h', v: 5, plus: 'sidecar', start: '2026-10-15T12:14:07', hz: 10, host: '192.168.1.226', port: 14568, name: 'sidecar' },
  { k: 'anim', t: 0, states: ANIM },
  { k: 'e', t: 0.1, e: 'serverName', name: 'bfstats-lab' },
  { k: 'e', t: 0.3, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con' },
  // The human first, then the sidecar: the sidecar is NOT pid 0, so a client
  // that assumed it would name the wrong player.
  { k: 'e', t: 2.84, e: 'createPlayer', pid: 0, name: 'skandia', team: 2, ai: 0, netId: 1, vehNetId: 2, camNetId: 2, kitNetId: 0 },
  { k: 'e', t: 2.839, e: 'createPlayer', pid: 1, name: 'sidecar', team: 1, ai: 0, netId: 3, vehNetId: 4, camNetId: 4, kitNetId: 0 },
  { k: 'e', t: 2.824, e: 'createPlayer', pid: 255, name: 'Kazuyoshi Shiokawa', team: 1, ai: 1, netId: 511, vehNetId: 589, camNetId: 512, kitNetId: 593 },
  { k: 'e', t: 23.677, e: 'control', pid: 255, netId: 512 },
  { k: 'o', t: 2.33, id: 512, tid: 1754, tmpl: 'USMarineSoldier', team: 0 },
  { k: 'o', t: 2.33, id: 544, tid: 2790, tmpl: 'M3A1', team: 0 },
  // A pure-yaw quaternion: yaw 180 degrees, x = z = 0.
  { k: 's', t: 23.7, o: [[512, 1017.5, 105.6, 857.1, 0, 1, 0, 0], [544, 1017.31, 105.62, 857.08, 0, 0, 0, 1]] },
  { k: 'st', t: 23.7, o: [[512, 2, 5, 0, 0, 0, 0]] },          // lower 2 = Lb_Lie -> prone
  { k: 'e', t: 24.1, e: 'score', pid: 255, kind: 3, victim: 0, weapon: 5 },
  // The server's order on a kill (owner's live session, 2026-10-16, t 153.58):
  // the killer's kill row, then the victim's own death row (kind 4).
  { k: 'e', t: 24.1, e: 'score', pid: 0, kind: 4 },
  { k: 'e', t: 25.0, e: 'chat', pid: 0, text: 'hello' },
  { k: 'e', t: 26.0, e: 'enterVehicle', pid: 255, netId: 544 },
  { k: 's', t: 26.1, o: [[544, 1017.4, 105.6, 857.2, 0, 1, 0, 0]] },
];
for (const r of RECORDS) pure.ingest(r);

const snap = pure.snapshot();
results.purePlayers = snap.players.map((p) => p.slot);
results.pureVehicles = snap.vehicles.map((v) => ({ id: v.id, template: v.template }));
results.pureTick = snap.tick;
results.pureProne = pure.playerRow(256)?.prone ?? null;      // pid 255 -> slot 256
results.pureInVehicle = pure.playerRow(256)?.inVehicle ?? null;
results.pureVehicleId = pure.playerRow(256)?.vehicleId ?? null;
results.pureYaw = pure.playerRow(256)?.yaw ?? null;
results.pureX = pure.playerRow(256)?.x ?? null;
results.purePitch = pure.playerRow(256)?.pitch ?? null;
results.pureZ = pure.playerRow(256)?.z ?? null;

// The engine frame to the page's: a soldier walking engine +z at engine yaw
// +30 degrees (decoded quaternion [0, sin15, 0, cos15], forward = (sin, 0,
// cos)) is, in the viewer, at -z walking (sin30, -cos30): body yaw 150, as
// the page's soldier walks along (sin yaw, 0, cos yaw).
const frame = createSidecarState();
frame.ingest({ k: 'e', t: 0, e: 'createPlayer', pid: 3, name: 'f', team: 2, ai: 0, netId: 9, vehNetId: 700 });
const s15 = Math.sin(Math.PI / 12), c15 = Math.cos(Math.PI / 12);
frame.ingest({ k: 's', t: 1, o: [[700, 10, 1, 20, 0, s15, 0, c15]] });
results.frameZ = frame.playerRow(4).z;
results.frameYaw = frame.playerRow(4).yaw;
// Tickets and a flag from the server's own state.
const rowsSeen = [];
const tick = createSidecarClient({ ws: new FakeSocket(), now: () => 0 });
tick.onevent = (row) => rowsSeen.push(row);
tick.handleMessage(JSON.stringify({ k: 'tk', t: 1, v: [12, 48] }));
tick.handleMessage(JSON.stringify({ k: 'e', t: 1, e: 'cp', id: 515, team: 2, tmpl: 'The_Beach' }));
tick.handleMessage(JSON.stringify({ k: 'e', t: 2, e: 'cp', id: 515, team: 1, tmpl: 'The_Beach' }));
tick.handleMessage(JSON.stringify({ k: 'o', t: 1, id: 550, tid: 1, tmpl: 'Sherman', team: 0 }));
tick.handleMessage(JSON.stringify({ k: 's', t: 1, o: [[550, 1, 2, 3, 0, 0, 0, 1]] }));
tick.handleMessage(JSON.stringify({ k: 'jn', t: 1, o: [[550, 1000, 'ShermanTower']] }));
tick.handleMessage(JSON.stringify({ k: 'j', t: 1, o: [[550, 1000, 0, 0.5, 0, 0.866]] }));
results.joints = tick.remoteVehicle(550)?.joints;
results.ticketRows = rowsSeen.filter((r) => r.type === 'ticket').map((r) => [r.team, r.count]);
results.captureRows = rowsSeen.filter((r) => r.type === 'captured').map((r) => [r.cp, r.team, r.quiet]);
// A gunner's seat (no createObject of its own) rides its hull.
frame.ingest({ k: 'o', t: 1, id: 674, tid: 2790, tmpl: 'M3A1', team: 0 });
frame.ingest({ k: 'e', t: 1, e: 'enterVehicle', pid: 3, netId: 675 });
results.seatVehicle = frame.playerRow(4).vehicleId;
results.seatIndex = frame.playerRow(4).seatIndex;
frame.ingest({ k: 'e', t: 1, e: 'exitVehicle', pid: 3 });
// The server's ack of the page's input words, and scope-out.
results.ackBefore = frame.playerRow(4).ack;
frame.ingest({ k: 'ack', t: 1, seq: 41 });
frame.ingest({ k: 'ack', t: 1, seq: 40 });
results.ackAfter = frame.playerRow(4).ack;
frame.ingest({ k: 'd', t: 2, id: 700 });
results.aliveAfterScopeOut = frame.playerRow(4).alive;

// The quaternion law on its own: pure yaw, and a pitch.
results.yawOfYaw180 = yawPitchOf([0, 1, 0, 0]).yaw;
results.yawOfIdentity = yawPitchOf([0, 0, 0, 1]).yaw;
results.pitchOfIdentity = yawPitchOf([0, 0, 0, 1]).pitch;

// --- the client: the same records over a socket -----------------------------

const ws = new FakeSocket();
const client = createSidecarClient({ ws, now: () => 0 });
let joined = 0;
const feed = [];
client.onjoined = () => { joined++; };
client.onevent = (row) => feed.push(row);

for (const r of RECORDS) client.handleMessage(JSON.stringify(r) + '\n');

results.slot = client.slot;
results.state = client.state;
results.joinedCalls = joined;
results.helloName = client.hello?.name ?? null;
results.helloServer = client.hello?.server ?? null;
results.helloLevel = client.hello?.level ?? null;
results.remoteSlots = client.remoteSlots().sort((a, b) => a - b);
results.remoteNames = client.remoteSlots().map((s) => client.nameOf(s)).sort();
results.teamOfMine = client.teamOf(client.slot);
results.selfNotRemote = !client.remoteSlots().includes(client.slot);
results.snapCount = client.snapCount();
results.vehicleTemplates = [...client.vehicles.values()].map((v) => v.template).sort();
const v544 = client.remoteVehicle(544);
results.remoteVehicle544 = v544
  ? { id: v544.id, x: v544.x, q: v544.q, occupied: v544.occupied, qNorm: Math.hypot(...v544.q) }
  : null;
results.feedTypes = feed.map((r) => r.type);
// The sidecar names its player by id: a stale "sidecar" ahead of the new
// "sidecar_1" must not be taken for it.
{
  const c2 = createSidecarClient({ ws: new FakeSocket(), now: () => 0 });
  c2.handleMessage(JSON.stringify({ k: 'h', v: 5, name: 'sidecar' }));
  c2.handleMessage(JSON.stringify({ k: 'e', t: 1, e: 'createPlayer', pid: 0, name: 'sidecar', team: 2, ai: 0, netId: 1, vehNetId: 2, camNetId: 2 }));
  c2.handleMessage(JSON.stringify({ k: 'e', t: 1, e: 'createPlayer', pid: 1, name: 'sidecar_1', team: 2, ai: 0, netId: 3, vehNetId: 4, camNetId: 4 }));
  c2.handleMessage(JSON.stringify({ k: 'me', pid: 1 }));
  results.slotById = c2.slot;
}
// Every ghosted object lerps between its bracketing samples at render time.
{
  const lp = createSidecarState();
  lp.ingest({ k: 'o', t: 0, id: 700, tid: 2916, tmpl: 'Sherman', team: 0 });
  lp.ingest({ k: 's', t: 10.0, o: [[700, 0, 0, 0, 0, 0, 0, 1]] });
  lp.ingest({ k: 's', t: 10.1, o: [[700, 1, 0, 2, 0, 0, 0, 1]] });
  const mid = lp.xfAt(700, 10.05), newest = lp.xfAt(700), past = lp.xfAt(700, 11);
  results.lerpMid = [mid.x, mid.z];
  results.lerpNewest = [newest.x, newest.z];
  results.lerpHolds = [past.x, past.z];
}
// The page's 'killed' row is the room's: slot = who died, other = who killed.
results.killedRows = feed.filter((r) => r.type === 'killed').map((r) => ({ slot: r.slot, other: r.other, weapon: r.weapon }));
// A soldier stands on his feet: the wire's origin is a metre over them.
{
  const onFoot = createSidecarState();
  for (const r of RECORDS) { if (r.e === 'enterVehicle') break; onFoot.ingest(r); }
  results.soldierFeetY = onFoot.playerRow(256)?.y ?? null;
}

// Input before join goes nowhere; after join it is one MSG_INPUT frame per
// call with a strictly increasing seq, and the payload decodes back.
const beforeJoin = createSidecarClient({ ws: new FakeSocket(), now: () => 0 });
results.inputBeforeJoin = beforeJoin.sendInput({ forward: 1 }, { dx: 0, dy: 0 });

const seqA = client.sendInput({ forward: 1, strafe: 0 }, { dx: 3, dy: -2 });
const seqB = client.sendInput({ forward: 0, strafe: 1 }, { dx: 0, dy: 0 });
results.inputSeqs = [seqA, seqB];
const frames = ws.sent.filter((f) => f[0] === MSG_INPUT);
results.inputFrames = frames.length;
results.inputType = frames.length ? frames[0][0] : null;
const decoded = frames.length ? decodeInputFrame(frames[0].subarray(1)) : null;
results.inputRoundTrip = decoded ? decoded.seq === seqA : false;
results.inputBytes = frames.length ? frames[0].length - 5 : null;
results.inputBytesExpected = INPUT_BYTES;

// The action frame: JSON behind the type byte.
client.radio(12, true);
const actionFrame = ws.sent.filter((f) => f[0] === MSG_ACTION).pop();
results.actionType = actionFrame ? actionFrame[0] : null;
results.actionRow = actionFrame ? JSON.parse(new TextDecoder().decode(actionFrame.subarray(1))) : null;
results.sentActions = client.sentActions.length;

// A join names a side only: the spawn is the deploy screen's.
client.join({ name: 'skandia', team: 2 });
const joinFrame = ws.sent.filter((f) => f[0] === MSG_ACTION).pop();
results.joinRow = joinFrame ? JSON.parse(new TextDecoder().decode(joinFrame.subarray(1))) : null;

// Join does not un-join an already-joined client.
const stateBefore = client.state;
client.join({ name: 'skandia', team: 2 });
results.stateAfterJoin = client.state;
results.stateWasJoined = stateBefore;

client.close();
results.leaveSent = ws.sent.some((f) => f[0] === MSG_LEAVE);
results.socketClosed = ws.closed;
results.closedState = client.state;

// --- the level lifecycle: a load replayed at connect is history, a load once
// live restarts the world and tells the page; the kit rides the player row --
{
  const lc = createSidecarState();
  const recs = [
    { k: 'e', t: 0.3, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con' },
    { k: 'e', t: 1, e: 'createPlayer', pid: 1, name: 'retail', team: 2, ai: 0, netId: 3, vehNetId: 4, camNetId: 4, kitNetId: 0 },
    { k: 'e', t: 1, e: 'createObject', tid: 1754, netId: 630, tmpl: 'USMarineSoldier' },
    { k: 'e', t: 1, e: 'createObject', tid: 1524, netId: 634, tmpl: 'UsMarine_Assault' },
    { k: 'e', t: 1, e: 'control', pid: 1, netId: 630 },
    { k: 'e', t: 1, e: 'pickupKit', pid: 1, netId: 634 },
    { k: 's', t: 1.1, o: [[630, 10, 101, 20, 0, 0, 0, 1]] },
    // A restart replayed at connect: reset, but no row for the page.
    { k: 'e', t: 5, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con' },
  ];
  for (const r of recs) lc.ingest(r);
  const replayRows = lc.state.pending.splice(0).filter(r => r.type === 'levelChange').length;
  const afterReplayObjects = lc.state.objects.size;
  for (const r of recs.slice(1, 7)) lc.ingest(r);
  results.kitRow = lc.playerRow(lc.slotOfPid(1))?.kit ?? null;
  lc.ingest({ k: 'live' });
  lc.ingest({ k: 'e', t: 9, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con' });
  const live1 = lc.state.pending.splice(0).filter(r => r.type === 'levelChange');
  lc.ingest({ k: 'e', t: 12, e: 'setLevel', level: 'bf1942/levels/midway/', mode: 'conquest.con' });
  const live2 = lc.state.pending.splice(0).filter(r => r.type === 'levelChange');
  for (const st of [1, 2, 3, 1]) lc.ingest({ k: 'e', t: 20, e: 'gameStatus', status: st });
  const live3 = lc.state.pending.splice(0).filter(r => r.type === 'levelChange');
  results.lifecycle = { live3, replayRows, afterReplayObjects, objectsAfterLive: lc.state.objects.size,
    rosterAfterLive: lc.state.roster.size, live1, live2 };
}

// --- server time: samples are timed by the ghost block's tick ----------------
// The server sends 20 blocks a second over its 30 ticks: blocks one and two
// ticks apart in turn, arriving evenly every 50 ms with a little jitter. A
// soldier walking 0.2 m a tick must be drawn at one speed.
function drawnSpeeds(withTick) {
  let pageMs = 0;
  const sock = new FakeSocket();
  const c = createSidecarClient({ ws: sock, now: () => pageMs });
  const send = (rec) => c.handleMessage(JSON.stringify(rec));
  send({ k: 'e', t: 0, e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'coop.con' });
  send({ k: 'e', t: 0, e: 'createPlayer', pid: 3, name: 'walker', team: 2, ai: 1, netId: 9, vehNetId: 600, camNetId: 10, kitNetId: 0 });
  send({ k: 'e', t: 0, e: 'createObject', tid: 1754, netId: 600, tmpl: 'USMarineSoldier', pos: [0, 0, 0], rot: [0, 0, 0] });
  send({ k: 'e', t: 0, e: 'control', pid: 3, netId: 600 });
  const jitter = [0, 7, -5, 12, 3, -8, 9, 0, -4, 6];
  const arrivals = [];
  let tick = 3000;
  for (let i = 0; i < 60; i++) {
    tick += i % 2 ? 2 : 1;
    arrivals.push({ at: 1000 + i * 50 + jitter[i % jitter.length], tick });
  }
  // The page's frames at 60 Hz: deliver what has arrived, then draw.
  const xs = [];
  for (let at = 1000; at < 4000; at += 1000 / 60) {
    while (arrivals.length && arrivals[0].at <= at) {
      const a = arrivals.shift();
      pageMs = a.at;
      send({ k: 's', t: a.at / 1000, ...(withTick ? { tick: a.tick } : {}), o: [[600, 0.2 * (a.tick - 3000), 1, 0, 0, 0, 0, 1]] });
    }
    pageMs = at;
    if (at >= 1500 && arrivals.length) xs.push(c.remotePlayer(4, at)?.x ?? null);
  }
  const speeds = [];
  for (let i = 1; i < xs.length; i++) speeds.push((xs[i] - xs[i - 1]) * 60);
  return { frames: speeds.length, min: +Math.min(...speeds).toFixed(3), max: +Math.max(...speeds).toFixed(3) };
}
results.tickTiming = drawnSpeeds(true);
results.arrivalTiming = drawnSpeeds(false);

// --- the view: a standing soldier's twist turns his view off his body -------
{
  const v = createSidecarState();
  v.ingest({ k: 'e', t: 0, e: 'createPlayer', pid: 3, name: 'stander', team: 2, ai: 0, netId: 9, vehNetId: 600, camNetId: 10, kitNetId: 0 });
  v.ingest({ k: 'e', t: 0, e: 'control', pid: 3, netId: 600 });
  v.ingest({ k: 'o', t: 0, id: 600, tid: 1754, tmpl: 'USMarineSoldier', team: 0 });
  v.ingest({ k: 's', t: 1, o: [[600, 0, 1, 0, 0, 0, 0, 1]] });
  const still = v.playerRow(4);
  v.ingest({ k: 'st', t: 1, o: [[600, 1, 68, 0, -14, 3, 64]] });
  const twisted = v.playerRow(4);
  results.viewYaw = { stillYaw: still.yaw, stillView: still.viewYaw, twistedYaw: twisted.yaw, twistedView: twisted.viewYaw };
}

console.log(JSON.stringify(results, null, 2));
