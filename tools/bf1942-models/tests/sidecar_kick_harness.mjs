// The sidecar against a server that ends the session (sidecar.mjs
// 'disconnected', rejoin.mjs classifyDisconnect). A fake server on a UDP port
// accepts the sidecar's ConnectRequest, then after a moment sends one
// Disconnect datagram with the case's reason and message (sendDisconnect
// 0x08436360: [8] u32 reason, [12..] 512 chars). The harness listens on the
// sidecar's page socket as a page would, and counts what the sidecar sends
// the server afterwards: a second ConnectRequest, or a ServerInfoRequest
// (the rejoin probe), is the sidecar trying to get back on.
//
//   node tests/sidecar_kick_harness.mjs <case> <scratch dir>
//
// Cases: kicked (0x15 with a reason), banned (0x16), closed (0x0d from the
// server), timeout (0x0a: a drop, which rejoins). Prints one JSON line.
import dgram from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR = path.join(here, '..', 'sidecar', 'sidecar.mjs');
const [which, scratch] = process.argv.slice(2);
const CASES = {
  kicked: { reason: 0x15, message: 'Kicked for teamkilling' },
  banned: { reason: 0x16, message: '' },
  closed: { reason: 0x0d, message: '' },
  timeout: { reason: 0x0a, message: '' },
};
const c = CASES[which];
if (!c) { console.error(`no case ${which}`); process.exit(2); }

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const srv = dgram.createSocket('udp4');
const seen = { connectRequests: 0, probes: 0, afterDisconnect: { connectRequests: 0, probes: 0 } };
let peer = null, disconnected = false;
srv.on('message', (m, rinfo) => {
  const type = m[2] >> 4;
  const into = disconnected ? seen.afterDisconnect : seen;
  if (type === 1) {
    into.connectRequests++;
    if (disconnected) return;          // the server is gone for this client
    peer = rinfo;
    const acc = Buffer.alloc(13);
    acc[2] = 2 << 4;                   // ConnectAccept
    acc[8] = 7;                        // the id this connection gets
    acc.writeUInt32LE(123456, 9);
    srv.send(acc, rinfo.port, rinfo.address);
    setTimeout(() => {
      const d = Buffer.alloc(0x20c);
      d[0] = 7;
      d[2] = 5 << 4;                   // Disconnect
      d.writeUInt32LE(c.reason, 8);
      d.write(c.message, 12, 'latin1');
      disconnected = true;
      srv.send(d, peer.port, peer.address);
    }, 800);
  } else if (type === 9) {
    into.probes++;                     // ServerInfoRequest: the rejoin's probe; never answered
  }
});
await new Promise((r) => srv.bind(0, '127.0.0.1', r));
const wsPort = await freePort();

const child = spawn(process.execPath, [SIDECAR, `127.0.0.1:${srv.address().port}`, '--name', 'kickme', '--ws', String(wsPort),
  '--out', path.join(scratch, `${which}.ndjson`), '--review', path.join(scratch, `${which}.review.ndjson`),
  '--connect-timeout', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
let exitCode = null;
const exited = new Promise((r) => child.on('exit', (code) => { exitCode = code; r(); }));

// The page: connect as soon as the feed is up, keep every row.
const rows = [];
for (let i = 0; i < 50; i++) {
  if (/live feed/.test(log)) break;
  await new Promise((r) => setTimeout(r, 100));
}
const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/`);
ws.onmessage = (e) => { try { rows.push(JSON.parse(e.data)); } catch { /* not a row */ } };

// Long enough for bf42++'s first probe (1 s) and two more (every 2 s).
await Promise.race([exited, new Promise((r) => setTimeout(r, 6000))]);
const stillRunning = exitCode === null;
if (stillRunning) child.kill('SIGINT');
await exited;
srv.close();

process.stdout.write(JSON.stringify({
  case: which,
  exitCode, stillRunning,
  seen,
  serverLeft: rows.filter((r) => r.k === 'e' && r.e === 'serverLeft'),
  states: rows.filter((r) => r.k === 'server').map((r) => ({ state: r.state, title: r.title ?? null, text: r.text ?? null })),
  log: log.split('\n').filter((l) => /disconnected us|not rejoining|probing|rejoin/.test(l)),
}) + '\n');
