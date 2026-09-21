// The room server's network half: an HTTP endpoint and a WebSocket endpoint
// on node:http, with an RFC6455 handshake and frame codec written in ~150
// lines so the repo keeps its zero-dependency rule (the harnesses already
// prove the three.js/WebSocket logic runs headless; this module only moves
// bytes). All protocol handling lives in `rooms.mjs`; here is where a
// transport's rawness ends.
//
//   GET  /netcode/rooms   -> the lobby list (JSON) from RoomServerCore
//   WS   /netcode         -> one join per connection; the join handshake is
//                            MSG_JOIN -> MSG_HELLO -> MSG_JOIN_SNAPSHOT ->
//                            the 20 Hz MSG_SNAPSHOT stream (netcode.js's
//                            framing: one type byte + payload per binary
//                            frame; control records are JSON behind the same
//                            type byte)
//
// CLI: `node server.mjs [--port N] [--viewer <dir>] [--default-level <name>]`.
// The level table is the `viewerDir/maps` tree (every entry with a
// scene.json), plus the `test` descriptor level the harness drives. SIGINT /
// SIGTERM close every room and the listener.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RoomServerCore } from './rooms.mjs';
import { loadRealLevel, buildLevelFromDescriptor } from './level.mjs';

const NETCODE_PATH = '/netcode';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** A frame may not be worth more than a megabyte; the room's payloads are
 *  all under a couple of KB, so this only bounds a runaway client. */
const MAX_FRAME = 1 << 20;

// --- the RFC6455 side --------------------------------------------------------

function acceptKey(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

function writeFrameHead(socket, opcode, length) {
  const head = [0x80 | opcode];
  if (length < 126) head.push(length);
  else if (length < 0x10000) head.push(126, (length >> 8) & 0xff, length & 0xff);
  else {
    head.push(127);
    for (let i = 7; i >= 0; i--) head.push((length >> (8 * i)) & 0xff);
  }
  socket.write(Buffer.from(head));
}

/**
 * One upgraded socket, adapted to the room core's `{send, close}` peer
 * contract (`rooms.mjs` README documents the contract; this is its first
 * implementation). Frames parse incrementally off the socket's data
 * stream; handshake and frame masking follow RFC 6455 exactly.
 */
class SocketPeer {
  constructor(socket, core) {
    this.socket = socket;
    this.core = core;
    this.buf = Buffer.alloc(0);
    this.fragment = null;         // a fragmented message's accumulated bytes
    this.closed = false;
    this.core.attach(this);
  }

  onClose() {
    if (this.closed) return;
    this.closed = true;
    this.core.detach(this);
  }

  /** Outbound: one unmasked FIN binary frame (the wire's only shape). */
  send(bytes) {
    if (this.closed || !bytes?.length) return;
    writeFrameHead(this.socket, 0x2, bytes.length);
    this.socket.write(Buffer.from(bytes));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const rc = Buffer.alloc(0);
    if (code !== null) {
      const payload = Buffer.alloc(2 + reason.length);
      payload.writeUInt16BE(code, 0);
      Buffer.from(reason, 'utf8').copy(payload, 2);
      writeFrameHead(this.socket, 0x8, payload.length);
      this.socket.write(payload);
    }
    this.closed = true;
    try { this.socket.destroy(); } catch { /* already gone */ }
    this.core.detach(this);
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (!this.closed) {
      const frame = takeFrame(this.buf);
      if (!frame) break;
      this.buf = frame.rest;
      try {
        this.#onFrame(frame);
      } catch (error) {
        // A buggy handler must not kill the listener: every connection's
        // frames ride one process. Log the throw and sever the peer — the
        // client's own load path sees a closed socket, not a dead server.
        console.error(`peer handler crashed: ${error.stack?.slice(0, 400) ?? error.message}`);
        this.close(1002, 'handler error');
        return;
      }
    }
  }

  #onFrame(frame) {
    const opcode = frame.opcode;
    if (opcode === 0x8) {                    // close
      this.close(1000, '');
      return;
    }
    if (opcode === 0x9) {                    // protocol ping -> pong
      writeFrameHead(this.socket, 0xa, frame.payload.length);
      this.socket.write(frame.payload);
      return;
    }
    if (opcode === 0xa) return;              // pong; nothing to answer
    if (opcode !== 0x1 && opcode !== 0x2 && opcode !== 0x0) return;
    if (opcode === 0x0) {                    // continuation
      if (this.fragment === null) return;
      this.fragment = Buffer.concat([this.fragment, frame.payload]);
      if (this.fragment.length > MAX_FRAME) { this.close(1009, 'too big'); return; }
      if (!frame.fin) return;
      this.core.onMessage(this, this.fragment);
      this.fragment = null;
      return;
    }
    if (!frame.fin) {                        // a fragmented start
      this.fragment = Buffer.from(frame.payload);
      return;
    }
    this.core.onMessage(this, Buffer.from(frame.payload));
  }
}

/** The next complete frame's bytes (mask applied) and the unread remainder,
 *  or null while the buffer holds less than one whole frame. */
function takeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let off = 2;
  if (length === 126) {
    if (buf.length < 4) return null;
    length = (buf[2] << 8) | buf[3];
    off = 4;
  } else if (length === 127) {
    if (buf.length < 10) return null;
    length = Number(BigUInt64BE(buf, 2));
    off = 10;
  }
  if (length > MAX_FRAME) return { opcode: 0x8, payload: Buffer.alloc(0), fin, rest: buf };
  const maskOff = masked ? off + 4 : off;
  if (buf.length < maskOff + length) return null;
  let payload = buf.subarray(maskOff, maskOff + length);
  if (masked) {
    const key = [buf[off], buf[off + 1], buf[off + 2], buf[off + 3]];
    const out = Buffer.alloc(length);
    for (let i = 0; i < length; i++) out[i] = payload[i] ^ key[i & 3];
    payload = out;
  }
  return { opcode, payload, fin, rest: buf.subarray(maskOff + length) };
}

function BigUInt64BE(buf, at) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[at + i]);
  return v;
}

// --- the listener --------------------------------------------------------------

/**
 * One HTTP server: the lobby GET and the WS upgrade, both wired to one
 * RoomServerCore. `levelTable` maps level names to LevelData (the harness's
 * `test` level included); `defaultLevel` names the level a fresh join code
 * lands on.
 */
export function makeServer({ core, port = 8787, host = '0.0.0.0' }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === `${NETCODE_PATH}/rooms`) {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ rooms: core.roomList() }));
      return;
    }
    if (url.pathname === NETCODE_PATH) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('websocket upgrade required');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    if (url.pathname !== NETCODE_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n`
      + '\r\n');
    if (head && head.length) socket.write(head);
    const peer = new SocketPeer(socket, core);
    socket.on('data', chunk => peer.onData(chunk));
    socket.on('close', () => peer.onClose());
  });

  const listener = server.listen(port, host, () => {
    console.log(`bfstats netcode room server listening on :${port} (default level ${core.defaultLevel})`);
  });

  const stop = () => {
    try { server.close(); } catch { /* already closed */ }
    core.stop();
  };
  let stopping = false;
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    stop();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return { server, stop };
}

// --- the CLI ------------------------------------------------------------------

function parseArgs(argv) {
  const out = { port: 8787, viewer: null, defaultLevel: 'wake' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (flag === '--port' && Number.isInteger(Number(value))) out.port = Number(value);
    else if (flag === '--viewer' && value) out.viewer = value;
    else if (flag === '--default-level' && value) out.defaultLevel = value;
    else i--;
  }
  return out;
}

function buildLevelTable(viewerDir) {
  const levels = new Map();
  const mapsDir = join(viewerDir, 'maps');
  if (existsSync(mapsDir)) {
    for (const entry of readdirSync(mapsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(mapsDir, entry.name, 'scene.json'))) continue;
      try {
        levels.set(entry.name, loadRealLevel({ viewerDir, name: entry.name }));
        console.log(`level ${entry.name}: loaded`);
      } catch (error) {
        console.log(`level ${entry.name}: skipped (${error.message})`);
      }
    }
  }
  // The harness's fake level, always registered: the socket test joins it
  // with {level: 'test'} (a plain join creates on the default level instead).
  levels.set('test', buildLevelFromDescriptor({ viewerDir }));
  return levels;
}

/** The CLI's own entry is `node server.mjs`; importing this module (the
 *  socket test does) must not start a listener. */
const isMain = process.argv[1]?.endsWith('server.mjs');

if (isMain) {
  const args = parseArgs(process.argv.slice(1));
  const here = fileURLToPath(new URL('.', import.meta.url));
  const viewerDir = args.viewer ? String(args.viewer)
    : join(here, '..', 'viewer');
  const levels = buildLevelTable(viewerDir);
  const core = new RoomServerCore({
    levels,
    defaultLevel: levels.has(args.defaultLevel) ? args.defaultLevel : 'test',
  });
  makeServer({ core, port: args.port });
  core.start();
}