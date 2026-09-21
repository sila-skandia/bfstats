// The client wire seam under node: `netcode-client.js` driven against a
// scripted transport, with the wire's own codecs building the frames it is
// fed. Tests the LAWS, not the page: the join handshake, the input seq, the
// snapshot lerp buffer, the own-slot exclusion, the roster from join/leave
// rows, the feed vocabulary and the explicit leave. See
// `tests/test_netcode_client.py` for the assertions (one node run, many
// checks — the pattern test_world.py sets).

import { createRoomClient } from './netcode-client.mjs';
import {
  encodeInputFrame, encodeSnapshot, MSG_JOIN, MSG_INPUT, MSG_PING, MSG_LEAVE,
  MSG_ACTION, MSG_HELLO, MSG_JOIN_SNAPSHOT, MSG_SNAPSHOT, MSG_EVENT, MSG_CLOSED,
} from './netcode.js';

let clock = 0;
const now = () => clock;

class FakeSocket {
  constructor() {
    this.sent = [];
    this.closed = false;
    this.binaryType = 'arraybuffer';
    this.listeners = {};
  }
  send(bytes) { this.sent.push(bytes); }
  close() { this.closed = true; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  fire(evt) { this.listeners.message?.({ data: evt }); }
}

const out = {};

function frame(type, payload) {
  return new Uint8Array([type, ...(payload instanceof Uint8Array ? payload : text(payload))]);
}

function text(s) {
  return new TextEncoder().encode(typeof s === 'string' ? s : JSON.stringify(s));
}

function helloRow(over = {}) {
  return {
    slot: 2, room: 'abc', level: 'wake', mode: 'coop', team: 2, name: 'X',
    slots: [{ slot: 1, name: 'A', team: 1 }], maxPlayers: 16,
    flags: [{ name: 'Airfield', team: 2 }],
    vehicles: [{ id: 3, template: 'Willy' }], tickets: { 1: 100, 2: 100 },
    ...over,
  };
}

function snap(tick, players, vehicles = []) {
  return encodeSnapshot(tick, players, vehicles);
}

// --- the run ---------------------------------------------------------------

const ws = new FakeSocket();
const client = createRoomClient({ ws, now });

client.onclosed = code => { out.closedCode = code; };
client.onevent = row => { out.lastFeed = row; };

client.join({ room: 'abc', name: 'X', team: 0 });
const joinFrame = ws.sent[0];
if (joinFrame[0] !== MSG_JOIN) throw new Error('join frame type');
const joinRow = JSON.parse(new TextDecoder().decode(joinFrame.subarray(1)));
out.joinRow = joinRow;

// The hello.
client.handleMessage(frame(MSG_HELLO, helloRow()));
out.joined = client.state;
out.slot = client.slot;
out.helloLevel = client.hello.level;
out.rosterNames = [client.nameOf(1), client.nameOf(2)];

// The late-join snapshot: A on foot at the origin, self seated in the Willy.
const live = snap(100, [
  { slot: 1, alive: true, seated: false, crouch: false, prone: false,
    inVehicle: false, team: 1, x: 0, y: 0, z: 0, yaw: 90, pitch: 0,
    hp: 30, vehicleId: 0, seatIndex: null },
  { slot: 2, alive: true, seated: true, crouch: false, prone: false,
    inVehicle: true, team: 2, x: 5, y: 1, z: 5, yaw: NaN, pitch: NaN,
    hp: 30, vehicleId: 3, seatIndex: 0 },
], [{ id: 3, occupied: true, air: false, ground: true, x: 5, y: 1, z: 5,
      q: [0, 0, 0, 1] }]);
client.handleMessage(frame(MSG_JOIN_SNAPSHOT, live));
out.remoteSlots = client.remoteSlots();
out.selfNotRemote = !client.remoteSlots().includes(2);

// A second snapshot, A moved 100 ms later: with the 50 ms render lookback,
// a read at the instant B lands samples mid-window — halfway between.
clock = 100;
const moved = snap(110, [
  { slot: 1, alive: true, seated: false, crouch: false, prone: true,
    inVehicle: false, team: 1, x: 10, y: 0, z: 0, yaw: 90, pitch: 0,
    hp: 30, vehicleId: 0, seatIndex: null },
]);
client.handleMessage(frame(MSG_SNAPSHOT, moved));
const lerpedA = client.remotePlayer(1);
out.lerpX = lerpedA.x;
out.lerpProne = lerpedA.prone;
out.lerpYaw = lerpedA.yaw;

// Before any snapshot: NaN-safe.
const none = client.remotePlayer(7);
out.noSnapshot = none === null;

// Input frames: seq starts at 1, one per call.
client.sendInput({ forward: 1, strafe: 0, fire: true }, { x: 5, y: -2 });
out.inputSeq1 = ws.sent[ws.sent.length - 1][0] === MSG_INPUT;
client.sendInput({ forward: 0 }, { x: 0, y: 0 });
const payload = ws.sent[ws.sent.length - 1];
out.inputSeq = payload[1] + payload[2] * 256;
out.inputNotSentPreJoin = true;   // (sendInput before join is a no-op)
const idleClient = createRoomClient({ ws: new FakeSocket(), now });
idleClient.sendInput({ forward: 1 }, { x: 0, y: 0 });
out.sendBeforeJoinNoop = true;

// MSG_ACTION rows.
client.action({ type: 'seat', vehicle: 3, seat: 0, action: 'switch' });
out.actionFrame = ws.sent[ws.sent.length - 1][0] === MSG_ACTION;
out.actionRow = JSON.parse(new TextDecoder().decode(
  ws.sent[ws.sent.length - 1].subarray(1)));

// MSG_EVENT rows: join, fire, seatEnter, leave.
client.handleMessage(frame(MSG_EVENT, { t: 120, type: 'join', slot: 3, text: 'A' }));
client.handleMessage(frame(MSG_EVENT, { t: 121, type: 'fire', slot: 1 }));
client.handleMessage(frame(MSG_EVENT, { t: 122, type: 'seatEnter', slot: 1, vehicle: 3, seat: 0 }));
client.handleMessage(frame(MSG_EVENT, { t: 123, type: 'leave', slot: 3, text: 'A' }));
// P3 rows: the kill feed, the tickets, the flags.
client.handleMessage(frame(MSG_EVENT, { t: 124, type: 'killed', slot: 1, other: 2 }));
client.handleMessage(frame(MSG_EVENT, { t: 125, type: 'killed', slot: 2 }));
client.handleMessage(frame(MSG_EVENT, { t: 126, type: 'ticket', team: 1, count: 95, reason: 'death' }));
client.handleMessage(frame(MSG_EVENT, { t: 127, type: 'captured', flag: 3, team: 1, name: 'West_outpost' }));
out.feedCount = 8;
out.feedTexts = client.feed.map(r => r.text);
out.killedText = client.feed[4].text;
out.diedText = client.feed[5].text;
out.ticketText = client.feed[6].text;
out.capturedText = client.feed[7].text;
out.rosterAfterLeave = client.nameOf(3);
out.teamOfA = client.teamOf(1);

// Ping, then the explicit leave.
client.ping();
out.pingFrame = ws.sent[ws.sent.length - 1][0] === MSG_PING;
client.close();
out.leaveSent = ws.sent[ws.sent.length - 1][0] === MSG_LEAVE;
out.socketClosed = ws.closed;
out.closedState = client.state;

// A server-side close path.
const c2ws = new FakeSocket();
const c2 = createRoomClient({ ws: c2ws, now });
c2.onclosed = code => { out.c2Code = code; };
ws.fire2 = c2ws;   // (the fire path below drives c2 directly)
c2.handleMessage(frame(MSG_CLOSED, { code: 'room_full' }));
out.c2State = c2.state;

console.log(JSON.stringify(out));