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

// Join does not un-join an already-joined client.
const stateBefore = client.state;
client.join({ name: 'skandia', team: 2 });
results.stateAfterJoin = client.state;
results.stateWasJoined = stateBefore;

client.close();
results.leaveSent = ws.sent.some((f) => f[0] === MSG_LEAVE);
results.socketClosed = ws.closed;
results.closedState = client.state;

console.log(JSON.stringify(results, null, 2));
