// The sidecar socket's origin allowlist (sidecar/wsserver.mjs originAllowed):
// what each Origin header gets, both as the bare check and as a real upgrade
// against a listening WSServer. Prints one JSON object for
// test_sidecar_ws_origin.py.
import http from 'node:http';
import crypto from 'node:crypto';
import { WSServer, originAllowed } from '../sidecar/wsserver.mjs';

const ORIGINS = [
  null,
  'https://bfstats.io',
  'https://www.bfstats.io',
  'https://mesh.bfstats.io',
  'https://mesh.bfstats.io/',
  'https://play.bfstats.io',
  'HTTPS://BFSTATS.IO',
  'http://bfstats.io',
  'https://bfstats.io:8443',
  'https://evil.bfstats.io',
  'https://bfstats.io.evil.com',
  'https://evil.com',
  'http://localhost',
  'http://localhost:5173',
  'https://localhost:8443',
  'http://127.0.0.1:8080',
  'http://[::1]:3000',
  'http://localhost.evil.com',
  'http://127.0.0.1.evil.com:80',
  'http://localhost:5173/path',
  'file://',
  'null',
  'chrome-extension://abcdef',
  'https://extra.example',
];
const EXTRA = ['https://extra.example/'];

const check = Object.fromEntries(ORIGINS.map((o) => [o ?? 'None', {
  plain: originAllowed(o ?? undefined),
  withExtra: originAllowed(o ?? undefined, EXTRA),
}]));

function upgrade(port, origin) {
  return new Promise((resolve) => {
    const headers = {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
    };
    if (origin != null) headers.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port, path: '/', headers });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve('error'));
    req.end();
  });
}

const server = new WSServer({ port: 0, allowOrigins: EXTRA });
const refused = [];
server.on('refused', (o) => refused.push(o));
const { port } = await server.listen();
const live = {};
for (const o of [null, 'https://mesh.bfstats.io', 'http://localhost:5173', 'https://evil.com', 'https://extra.example', 'null']) {
  live[o ?? 'None'] = await upgrade(port, o);
}
server.close();
console.log(JSON.stringify({ check, live, refused }));
process.exit(0);
