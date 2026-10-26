#!/usr/bin/env node
'use strict';
// A smoke test of the sidecar as the desktop app runs it: Electron's own
// binary with ELECTRON_RUN_AS_NODE=1, against a stand-in server on 127.0.0.1,
// on any platform. CI runs it on Linux and Windows (.github/workflows/
// sidecar-desktop.yml), from the checkout and again from the packaged app.
//
//   node scripts/smoke-sidecar.js                       the checkout's sidecar under node_modules' Electron
//   node scripts/smoke-sidecar.js --unpacked dist/linux-unpacked
//                                                       the packaged app's binary and bundled sidecar
//   node scripts/smoke-sidecar.js --electron <exe> --script <sidecar.mjs>
//
// What it checks, twice (left with `leave` on stdin, then with stdin closed,
// as when the app is gone):
//   - the pre-join GameSpy \status\ query reaches the server's query port, and
//     the answer names the level;
//   - a game folder that has the mod but no Python 3 (or, packaged, no Python
//     helpers) falls to the published tables at once, saying why, instead of
//     waiting on or spawning Python per lookup (downloads are off here, so
//     the answer is "none");
//   - a ConnectRequest reaches the server, and its ConnectAccept is acked;
//   - `live feed:` is printed, the feed listens on 127.0.0.1, refuses a
//     foreign page's Origin (403) and upgrades bfstats.io's (101);
//   - the leave sends the server a Disconnect and the sidecar exits 0.
// The stand-in sends nothing after its ConnectAccept, so nothing beyond the
// handshake is exercised; the lab (skill bf1942-server-lab) is the full join.

const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PACKAGED_NATIVE, nativeBinaryPath, nativeTarget } = require('../src/sidecar-engine');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const TIMEOUT_MS = Number(opt('timeout', 45)) * 1000;
const PREJOIN_MAX_MS = 10_000;   // the GameSpy answer and the no-Python fall-through, well inside the app's wait
const EXIT_MAX_MS = 8_000;       // the app kills a sidecar that takes longer than 6 s to leave

/**
 * The sidecars to smoke, each { label, exe, script }: the Node one (Electron
 * with ELECTRON_RUN_AS_NODE=1 and sidecar.mjs) and, on Linux, the native
 * Kotlin one (src/sidecar-engine.js; script null). `--engine node|kotlin`
 * runs one; the default runs every engine the platform has, and a missing
 * native binary there is a failure (npm run build-sidecar builds it).
 */
function targets() {
  const want = opt('engine', 'all');
  const unpacked = opt('unpacked');
  const out = [];
  let node; let native;
  if (unpacked) {
    const dir = path.resolve(unpacked);
    const exe = path.join(dir, process.platform === 'win32' ? 'bfstats-sidecar.exe' : 'bfstats-sidecar');
    node = { exe, script: path.join(dir, 'resources', 'sidecar', 'sidecar.mjs'), what: `packaged ${dir}` };
    native = nativeTarget() ? path.join(dir, 'resources', PACKAGED_NATIVE) : null;
  } else {
    // In plain Node, require('electron') is the path of the platform's binary.
    const exe = opt('electron') ?? require(path.join(ROOT, 'node_modules', 'electron'));
    const script = path.resolve(opt('script') ?? path.join(ROOT, '..', 'bf1942-models', 'sidecar', 'sidecar.mjs'));
    node = { exe, script, what: 'checkout' };
    native = opt('native') ?? nativeBinaryPath({ packaged: false, appDir: ROOT, env: {} });
  }
  if (want === 'all' || want === 'node') out.push({ label: 'node', ...node });
  if (want === 'kotlin' || (want === 'all' && native)) {
    out.push({ label: 'kotlin', exe: native ?? `(no native sidecar for ${process.platform}-${process.arch})`, script: null, what: node.what });
  }
  return out;
}

const PT = { ConnectRequest: 1, ConnectAccept: 2, ConnectAcceptAck: 4, Disconnect: 5 };
const GAMESPY_ANSWER = '\\gamename\\bfield1942\\gameId\\bf1942\\mapname\\Wake\\gametype\\coop\\hostname\\Smoke test server\\final\\';

function udp(onMessage) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (msg, rinfo) => onMessage(msg, rinfo, s));
    s.once('error', reject);
    s.bind(0, '127.0.0.1', () => resolve(s));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

/** The status of a WebSocket upgrade to the feed with this Origin (101, 403 ...). */
function upgradeStatus(port, origin) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/', timeout: 5000,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', Origin: origin,
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('bfstats-smoke-key').toString('base64'),
      },
    });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.on('error', (e) => resolve(`error ${e.code || e.message}`));
    req.end();
  });
}

function waitFor(pred, ms, what, out) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const v = pred();
      if (v) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error(`timed out after ${ms} ms waiting for ${what}\n--- sidecar output ---\n${out.join('\n')}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function run(exe, script, label, mode) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-smoke-'));
  // A game folder that has the base mod (its objects.rfa missing: the bundled
  // CRC answers) and an interpreter that does not exist.
  fs.mkdirSync(path.join(tmp, 'game', 'Mods', 'BF1942', 'Archives'), { recursive: true });
  const packets = [];
  let gamespyAsked = 0;
  // The stand-in accepts the connect (ConnectAccept: [8] the connection's id,
  // [9..12] the server's clock; netconn.mjs) and then says nothing more.
  const game = await udp((msg, rinfo, s) => {
    const type = msg.length >= 3 ? msg[2] >> 4 : -1;
    packets.push(type);
    if (type === PT.ConnectRequest) {
      const accept = Buffer.alloc(13);
      accept[2] = PT.ConnectAccept << 4;
      accept[8] = 1;
      accept.writeUInt32LE(1000, 9);
      s.send(accept, rinfo.port, rinfo.address);
    }
  });
  const query = await udp((msg, rinfo, s) => {
    if (msg.toString('latin1').includes('\\status\\')) { gamespyAsked++; s.send(Buffer.from(GAMESPY_ANSWER, 'latin1'), rinfo.port, rinfo.address); }
  });
  const wsPort = await freePort();
  const env = {
    ...process.env,
    ...(script ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    SIDECAR_LIVE_LIST: 'off',
    SIDECAR_TABLES_URL: 'off',
    SIDECAR_CACHE: path.join(tmp, 'cache'),
    SIDECAR_CDKEY_FILE: path.join(tmp, 'cdkeys.json'),
    BF1942_DIR: path.join(tmp, 'game'),
    SIDECAR_PYTHON: path.join(tmp, 'no-such-python'),
  };
  const argv = [...(script ? [script] : []), `127.0.0.1:${game.address().port}`, '--name', 'SmokeTest', '--team', '1', '--ws', String(wsPort),
    '--out', path.join(tmp, 'smoke.ndjson'), '--review', path.join(tmp, 'smoke.review.ndjson'), '--leave-on-stdin',
    '--query-port', String(query.address().port)];
  const t0 = Date.now();
  const child = spawn(exe, argv, { cwd: tmp, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const out = [];
  let exit = null;
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => { exit = { code, signal, at: Date.now() }; resolve(exit); }));
  child.once('error', (e) => out.push(`[smoke] spawn failed: ${e.message}`));
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => { pending += d; const lines = pending.split(/\r?\n/); pending = lines.pop(); out.push(...lines); });
    stream.on('end', () => { if (pending) out.push(pending); });
  }
  const has = (re) => out.find((l) => re.test(l));
  try {
    const plays = await waitFor(() => has(/\[sidecar\] the server plays /), PREJOIN_MAX_MS, 'the pre-join level line', out);
    const prejoinMs = Date.now() - t0;
    assert.match(plays, /the server plays wake coop \(mod bf1942, from its gamespy\): tables from none/i, plays);
    assert.ok(gamespyAsked >= 1, 'no GameSpy \\status\\ query reached the query port');
    // The checkout has the Python helpers and no Python here; the packaged app has no helpers.
    assert.ok(has(/is not a working Python 3|the Python helpers are not here/), 'no word that the game folder cannot compute the tables here');

    const feed = await waitFor(() => has(/\[sidecar\] live feed: http:\/\/127\.0\.0\.1:\d+\//), TIMEOUT_MS, 'the live feed line', out);
    const feedPort = Number(/127\.0\.0\.1:(\d+)/.exec(feed)[1]);
    assert.equal(feedPort, wsPort, feed);
    await waitFor(() => packets.includes(PT.ConnectAcceptAck), TIMEOUT_MS, 'a ConnectRequest and the ConnectAcceptAck at the server', out);
    assert.equal(await upgradeStatus(feedPort, 'https://evil.example'), 403, 'a foreign Origin was not refused');
    assert.equal(await upgradeStatus(feedPort, 'https://mesh.bfstats.io'), 101, "bfstats.io's Origin was not upgraded");

    const leaveAt = Date.now();
    if (mode === 'leave') child.stdin.write('leave\n');
    else child.stdin.end();
    await Promise.race([exited, new Promise((r) => setTimeout(r, EXIT_MAX_MS))]);
    if (!exit) throw new Error(`the sidecar did not exit within ${EXIT_MAX_MS} ms of the ${mode}\n--- sidecar output ---\n${out.join('\n')}`);
    await new Promise((r) => setTimeout(r, 200));   // the last datagram
    assert.equal(exit.code, 0, `exit code ${exit.code} (signal ${exit.signal})\n${out.join('\n')}`);
    assert.ok(packets.includes(PT.Disconnect), 'the server got no Disconnect');
    const why = mode === 'leave' ? 'asked on stdin' : 'stdin closed';
    assert.ok(has(new RegExp(`\\[sidecar\\] leaving \\(${why}\\)`)), `no "leaving (${why})" line\n${out.join('\n')}`);
    console.log(`[smoke] ${label}: pre-join in ${prejoinMs} ms, live feed on ${feedPort}, connect accepted and acked, Origin 403/101, `
      + `left with a Disconnect, exit 0 in ${exit.at - leaveAt} ms`);
  } finally {
    if (!exit) child.kill();
    game.close(); query.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold a file a moment longer */ }
  }
}

(async () => {
  for (const { label, exe, script, what } of targets()) {
    for (const [p, kind] of [[exe, label === 'node' ? 'Electron binary' : 'native sidecar'], [script, 'sidecar.mjs']]) {
      if (p !== null && !fs.existsSync(p)) { console.error(`[smoke] ${label}: no ${kind} at ${p}`); process.exit(2); }
    }
    console.log(`[smoke] ${label}, ${what}: ${exe}${script ? ` (ELECTRON_RUN_AS_NODE=1) ${script}` : ''}`);
    for (const mode of ['leave', 'stdin-close']) await run(exe, script, `${label} ${mode}`, mode);
  }
  console.log('[smoke] ok');
})().catch((e) => { console.error(`[smoke] FAILED: ${e.message}`); process.exit(1); });
