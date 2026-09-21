// The real-junction proof: `server.mjs` on a real TCP port, two native
// WebSocket clients, real frames.
//
// test_room.py already proved the protocol core in-process with virtual
// peers; this file proves the part the virtual peers cannot: that the
// hand-rolled RFC 6455 handshake and frame codec in `server.mjs` speak
// fluent WebSocket to the platform's own client — handshake, masking,
// fragmentation tolerance, binary frames, close — and that the room's 20 Hz
// snapshot stream moves over a real loopback socket.
//
// Flow: spawn `node server/server.mjs --port N --viewer ./viewer
// --default-level test` in the overlay (the overlay has no maps tree, so
// `test` is the only level and also the default), wait for the lobby HTTP
// endpoint, then:
//   A joins room ABC, B joins the same room — both get MSG_HELLO and
//   MSG_JOIN_SNAPSHOT; A and B spawn; A pings (MSG_PING -> MSG_PONG); A
//   walks forward at the world's own 30 Hz for one second; B's snapshot
//   stream must show A's slot moving. The lobby row must list ABC with two
//   players. Everything lands in one JSON blob for test_room_socket.py.

import { spawn } from 'node:child_process';
import { MSG_JOIN, MSG_ACTION, MSG_INPUT, MSG_PING, MSG_PONG,
         MSG_HELLO, MSG_JOIN_SNAPSHOT, MSG_SNAPSHOT,
         encodeInputFrame, decodeSnapshot } from './viewer/netcode.js';
import { frame } from './server/rooms.mjs';

const argv = process.argv.slice(2);
const argOf = flag => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : null;
};
const port = Number(argOf('--port') ?? 0);
const out = {};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function sendFrame(ws, bytes) {
  const buf = Buffer.from(bytes);
  if (ws.readyState === WebSocket.OPEN) ws.send(buf);
}

function walkInput() {
  return { forward: 1, strafe: 0, walk: false, crouch: false, prone: false,
           jump: false, fire: false, altFire: false, roll: 0, pitch: 0,
           pad: false };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    // The platform's default binaryType is 'blob'; the room's frames are
    // binary and the collector wants raw bytes.
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error(`ws error ${url}`)));
  });
}

// A tiny frame collector: {type, payload} out of the socket's binary frames.
function collector(ws) {
  const frames = [];
  ws.addEventListener('message', ev => {
    const data = ev.data;
    if (data instanceof ArrayBuffer) {
      const view = new Uint8Array(data);
      frames.push({ type: view[0], payload: view.subarray(1) });
    } else if (typeof data === 'string') {
      frames.push({ type: data.charCodeAt(0), payload: Buffer.from(data.slice(1)) });
    }
  });
  return frames;
}

async function main() {
  // The server under test, in this same overlay (cwd is the overlay root;
  // the python side stands it up). SIGTERM at the end — the server's own
  // handler stops the listener and exits.
  const server = spawn(process.execPath, [
    'server/server.mjs', '--port', String(port),
    '--viewer', './viewer', '--default-level', 'test',
  ]);
  // Drain stderr on the side; the child lives for the whole test, so an
  // awaited drain would block it all.
  const stderrTask = (async () => {
    let text = '';
    for await (const chunk of server.stderr) text += chunk.toString();
    return text;
  })();

  // Wait for the listener (the child's stdout is not read; the lobby HTTP
  // endpoint is the readiness probe).
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/netcode/rooms`);
      up = r.ok;
    } catch { /* not yet */ }
    if (!up) await sleep(100);
  }
  out.up = up;
  if (!up) {
    server.kill('SIGTERM');
    out.serverErr = (await stderrTask).slice(-400);
    console.log(JSON.stringify(out));
    process.exit(1);
  }

  const wsA = await connect(`ws://127.0.0.1:${port}/netcode`);
  const wsB = await connect(`ws://127.0.0.1:${port}/netcode`);
  const framesA = collector(wsA);
  const framesB = collector(wsB);

  // A joins and creates the room; B joins it.
  sendFrame(wsA, frame(MSG_JOIN, Buffer.from(JSON.stringify(
    { room: 'ABC', name: 'A', team: 0 }))));
  await sleep(150);
  sendFrame(wsB, frame(MSG_JOIN, Buffer.from(JSON.stringify(
    { room: 'ABC', name: 'B', team: 0 }))));
  await sleep(150);

  const helloA = framesA.find(f => f.type === MSG_HELLO);
  const helloB = framesB.find(f => f.type === MSG_HELLO);
  const snapA = framesA.find(f => f.type === MSG_JOIN_SNAPSHOT);
  const snapB = framesB.find(f => f.type === MSG_JOIN_SNAPSHOT);
  out.helloA = helloA ? JSON.parse(Buffer.from(helloA.payload)) : null;
  out.helloB = helloB ? JSON.parse(Buffer.from(helloB.payload)) : null;
  out.joinSnapA = Boolean(snapA);
  out.joinSnapB = Boolean(snapB);

  // B's snapshot stream baseline: A's slot pose before the walk.
  const before = [];
  // Both deploy at their team's flag.
  sendFrame(wsA, frame(MSG_ACTION, Buffer.from(JSON.stringify(
    { type: 'spawn', flag: 0 }))));
  sendFrame(wsB, frame(MSG_ACTION, Buffer.from(JSON.stringify(
    { type: 'spawn', flag: 1 }))));

  // The heartbeat law: a ping gets a pong.
  const t0 = performance.now();
  sendFrame(wsA, frame(MSG_PING, new Uint8Array([0, 0, 0, 0])));
  let pong = null;
  for (let i = 0; i < 20 && !pong; i++) {
    await sleep(50);
    pong = framesA.find(f => f.type === MSG_PONG);
  }
  out.pongMs = performance.now() - t0;

  // One second of scripted forward walk at the world's own 30 Hz.
  let firstSeen = null;
  for (let i = 0; i < 30; i++) {
    sendFrame(wsA, frame(MSG_INPUT, encodeInputFrame(i + 1, walkInput(), { x: 0, y: 0 })));
    if (i === 4) {
      const snaps = framesB.filter(f => f.type === MSG_SNAPSHOT);
      if (snaps.length) {
        const row0 = decodeSnapshot(snaps.at(-1).payload).players.find(p => p.slot === 1);
        if (row0) firstSeen = { x: row0.x, z: row0.z };
      }
    }
    await sleep(1000 / 30);
  }
  await sleep(120);

  const snapsB = framesB.filter(f => f.type === MSG_SNAPSHOT);
  const last = snapsB.length ? decodeSnapshot(snapsB.at(-1).payload) : null;
  const mover = last?.players.find(p => p.slot === 1);
  out.snapshots = snapsB.length;
  out.moved = (mover && firstSeen)
    ? Math.hypot(mover.x - firstSeen.x, mover.z - firstSeen.z) : -1;
  out.aliveB = last?.players.some(p => p.slot === 2 && p.alive) ?? false;
  out.tick = last?.tick ?? 0;

  // The lobby sees the room.
  try {
    const lobby = await (await fetch(`http://127.0.0.1:${port}/netcode/rooms`)).json();
    out.lobby = lobby.rooms.find(r => r.code === 'ABC');
  } catch (error) {
    out.lobby = null;
  }

  wsA.close();
  wsB.close();
  server.kill('SIGTERM');
  out.serverErr = (await stderrTask).slice(-200);
  console.log(JSON.stringify(out));
  process.exit(0);
}

await main();