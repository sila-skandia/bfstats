// The sidecar's --name-from-page (features/game-profiles): the page's socket
// comes up first, the page's `{type:'identity', name}` action names the
// player, and only then does the ConnectRequest go out. A fake server on a UDP
// port accepts the connection and notes when the ConnectRequest came; the
// harness is the page, on the sidecar's socket.
//
//   node tests/sidecar_identity_harness.mjs <case> <scratch dir>
//
// Cases:
//   identity  the page sends a name as soon as the socket opens
//   null      the page has no name: {name: null}, no wait
//   timeout   no page at all: --name-wait runs out, --name is used
//   invalid   a name with a quote: --name is used at once
//   long      a 30-character name: cut to the server's 23
//   late      the page names the player after the connect: ignored
//   noflag    no --name-from-page: the connect goes out at once, an identity is ignored
// Prints one JSON line.
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR = path.join(here, '..', 'sidecar', 'sidecar.mjs');
const [which, scratch] = process.argv.slice(2);
const CASES = {
  identity: { flag: true, send: 'Page Soldier', wait: 10 },
  null: { flag: true, send: null, wait: 10 },
  timeout: { flag: true, page: false, wait: 1.5 },
  invalid: { flag: true, send: 'say "hi"', wait: 10 },
  long: { flag: true, send: 'A'.repeat(20) + 'BCDEFGHIJK', wait: 10 },
  late: { flag: true, page: false, wait: 1, lateSend: 'Too Late' },
  noflag: { flag: false, send: 'Page Soldier' },
};
const c = CASES[which];
if (!c) { console.error(`no case ${which}`); process.exit(2); }

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

const t0 = Date.now();
const ms = () => Date.now() - t0;
const srv = dgram.createSocket('udp4');
const seen = { connectAt: null, connectRequests: 0 };
srv.on('message', (m, rinfo) => {
  const type = m[2] >> 4;
  if (type !== 1) return;
  seen.connectRequests++;
  seen.connectAt ??= ms();
  const acc = Buffer.alloc(13);
  acc[2] = 2 << 4;                   // ConnectAccept
  acc[8] = 7;
  acc.writeUInt32LE(123456, 9);
  srv.send(acc, rinfo.port, rinfo.address);
});
await new Promise((r) => srv.bind(0, '127.0.0.1', r));
const wsPort = await freePort();
const out = path.join(scratch, `${which}.ndjson`);

const args = [SIDECAR, `127.0.0.1:${srv.address().port}`, '--name', 'Fallback Name', '--ws', String(wsPort),
  '--out', out, '--review', path.join(scratch, `${which}.review.ndjson`),
  '--connect-timeout', '0', '--no-prejoin', '--tables-url', 'off'];
if (c.flag) args.push('--name-from-page', '--name-wait', String(c.wait));
const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const lines = [];
const onData = (d) => {
  log += d;
  for (const l of String(d).split('\n')) if (l.trim()) lines.push({ at: ms(), line: l });
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
let exitCode = null;
const exited = new Promise((r) => child.on('exit', (code) => { exitCode = code; r(); }));
const until = async (re, limit = 8000) => {
  const end = Date.now() + limit;
  while (!re.test(log) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  return re.test(log);
};

const action = (row) => Buffer.concat([Buffer.from([0x05]), Buffer.from(JSON.stringify(row), 'utf8')]);
const openPage = async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/`);
  ws.binaryType = 'arraybuffer';
  await new Promise((r) => { ws.onopen = r; ws.onerror = r; });
  return ws;
};
let identityAt = null;
await until(/live feed/);
const feedAt = lines.find((l) => /live feed/.test(l.line))?.at ?? null;
let ws = null;
if (c.page !== false) {
  ws = await openPage();
  ws.send(action({ type: 'identity', name: c.send }));
  identityAt = ms();
}
await until(/\[sidecar\] .* as "/, 12000);
if (c.lateSend) {
  ws = await openPage();
  ws.send(action({ type: 'identity', name: c.lateSend }));
  await until(/identity ignored/, 1500);
}
await new Promise((r) => setTimeout(r, which === 'noflag' ? 700 : 300));
try { ws?.close(); } catch { /* gone */ }
child.kill('SIGINT');
await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))]);
if (exitCode === null) child.kill('SIGKILL');
srv.close();

let header = null;
try {
  header = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((r) => r.k === 'h') ?? null;
} catch { /* no recording */ }
const nameLine = lines.find((l) => /\[sidecar\] player name: /.test(l.line));
const joinLine = lines.find((l) => /\[sidecar\] .* as "/.test(l.line));
process.stdout.write(JSON.stringify({
  case: which,
  feedAt, identityAt,
  connectAt: seen.connectAt,
  connectRequests: seen.connectRequests,
  nameLine: nameLine ? nameLine.line.trim() : null,
  nameLineAt: nameLine?.at ?? null,
  joinedAs: joinLine ? /as "([^"]*)"/.exec(joinLine.line)[1] : null,
  headerName: header?.name ?? null,
  log: lines.map((l) => l.line.trim()).filter((l) => /player name|identity|profile name|cannot be sent|no identity|--name-from-page/.test(l)),
}) + '\n');
