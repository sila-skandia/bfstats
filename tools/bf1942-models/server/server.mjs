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
//
// The RFC 6455 codec and the socket adapter are `websocket.mjs`; the level
// table the CLI builds is `level-table.mjs`.

import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RoomServerCore } from './rooms.mjs';
import { SocketPeer, acceptKey } from './websocket.mjs';
import { buildLevelTable } from './level-table.mjs';

const NETCODE_PATH = '/netcode';

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
