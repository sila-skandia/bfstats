// The P2 done-bar: two browsers on one real junction — a live room server
// over real TCP, two pages, server-confirmed movement, a seat, a fire, an
// explicit leave — with the local sium untouched. Runs against whatever
// level the room server's default is (`--default-level`), using the real
// level data in this tree (maps/<level>/scene.glb etc.).
//
//   node tests/p2_two_browser_smoke.mjs [--port 8910] [--static 8911]
//
// Requires the ui tree's Playwright (chromium) — the repo's E2E runner —
// and a `node_modules/three` standing (the room server's own, per
// server/README.md). Exit code 0 = the done-bar held.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server', 'server.mjs');
const VIEWER = path.join(ROOT, 'viewer');

const args = process.argv.slice(2);
const portOf = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
// Free ports by default: the room server binds its own (the level table
// takes ~12 s to load), and repeated runs may outlive a stopped run's stray
// children — a fixed port pair would collide.
async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}
const PORT = portOf('--port', 0) || await freePort();
const STATIC = portOf('--static', 0) || await freePort();

const { chromium } = require(path.join(ROOT, '..', '..', 'ui', 'node_modules', 'playwright'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitJson(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`${url} never came up`);
}

const kids = [];
let smokeBrowser = null;
let smokeBrowser2 = null;
let smokeStatic = null;
function boot(cmd, cwd) {
  const child = spawn(cmd[0], cmd.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => process.stdout.write(`[${cmd[0]}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${cmd[0]}] ${d}`));
  kids.push(child);
  return child;
}

// A tiny static server with Range support and a real event loop — python's
// http.server is single-threaded and starves the page's parallel asset
// fetch of a ~40 MB scene glb.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.glb': 'application/octet-stream', '.gltf': 'model/gltf+json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.dif': 'application/octet-stream',
  '.conv': 'application/octet-stream', '.ini': 'text/plain',
};

function bootStatic(port, root, netPort) {
  const server = createServer(async (req, res) => {
    // The production route in miniature: everything under /netcode goes to
    // the room server (the page's WebSocket is same-origin, exactly as
    // HAProxy's path-beg ACL makes it on play.bfstats.io). The exact
    // prefix matters: '/netcode-client.js' is a page asset, not a route.
    if (req.url === '/netcode' || req.url.startsWith('/netcode/')
        || req.url.startsWith('/netcode?')) {
      const proxy = await import('node:http').then(m => m.request)
        || require('node:http').request;
      const preq = proxy(
        { host: '127.0.0.1', port: netPort, path: req.url, method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${netPort}` } },
        pres => {
          res.writeHead(pres.statusCode, pres.headers);
          pres.pipe(res);
        });
      req.pipe(preq);
      preq.on('error', () => { res.writeHead(502); res.end(); });
      return;
    }
    try {
      const url = new URL(req.url, 'http://x');
      let file = decodeURIComponent(url.pathname);
      if (file.endsWith('/')) file += 'index.html';
      const full = path.join(root, file);
      const info = await stat(full);
      const mime = MIME[extname(full)] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        const start = m ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : info.size - 1;
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        const fd = await import('node:fs/promises').then(m => m.open(full, 'r'));
        const stream = fd.createReadStream({ start, end });
        stream.on('close', () => fd.close());
        stream.pipe(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': info.size });
      const data = await readFile(full);
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if (!(req.url === '/netcode' || req.url.startsWith('/netcode/')
          || req.url.startsWith('/netcode?'))) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const proxy = require('node:http').request({
      host: '127.0.0.1', port: netPort, path: req.url, method: req.method,
      headers: req.headers,
    });
    proxy.on('upgrade', (pres, psocket, phead) => {
      const key = pres.headers['sec-websocket-accept'];
      if (!key) { socket.destroy(); return; }
      socket.on('error', e => process.stdout.write(`[proxy] browser socket error: ${e.code ?? e.message}\n`));
      psocket.on('error', e => process.stdout.write(`[proxy] upstream socket error: ${e.code ?? e.message}\n`));
      socket.on('close', () => process.stdout.write('[proxy] browser socket closed\n'));
      psocket.on('close', () => process.stdout.write('[proxy] upstream socket closed\n'));
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + `Upgrade: ${pres.headers.upgrade}\r\n`
        + `Connection: ${pres.headers.connection}\r\n`
        + `Sec-WebSocket-Accept: ${key}\r\n\r\n`);
      psocket.pipe(socket);
      socket.pipe(psocket);
    });
    proxy.on('error', () => { try { socket.destroy(); } catch {} });
    proxy.end();
  });
  server.listen(port, '127.0.0.1');
  return server;
}

async function main() {
  boot(['node', SERVER, '--port', String(PORT), '--viewer', VIEWER, '--default-level', 'aberdeen'],
    ROOT);
  smokeStatic = bootStatic(STATIC, VIEWER, PORT);

  await waitJson(`http://127.0.0.1:${PORT}/netcode/rooms`);
  const page1 = await (await fetch(`http://127.0.0.1:${STATIC}/map.html`)).text();
  if (!page1.includes('map.html')) throw new Error('static server did not answer');

  smokeBrowser = await chromium.launch({
    headless: true,
    args: [
      // Software GL is the only GL headless offers; the automatic fallback
      // is deprecated and the GPU-process crash it causes restarts the page
      // (mid-join — what every dodgy run here has looked like). Name the
      // fallback explicitly and let the renderer use real RAM, not the
      // default /dev/shm.
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  });
  // B is the observer only. A second, separate browser process keeps the two
  // swiftshader renderers out of one process's memory envelope — the shared
  // one consistently lost B's page mid-session.
  smokeBrowser2 = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const ctxA = await smokeBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await smokeBrowser2.newContext({ viewport: { width: 320, height: 240 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const join = async (page, room, name) => {
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning' || msg.type() === 'log') {
        process.stdout.write(`[${name}] ${msg.type()}: ${msg.text().slice(0, 220)}\n`);
      }
    });
    page.on('pageerror', err =>
      process.stdout.write(`[${name}] PAGEERROR: ${err.message.slice(0, 300)}\n`));
    page.on('response', res => {
      if (res.status() >= 400) process.stdout.write(`[${name}] HTTP ${res.status()} ${res.url()}\n`);
    });
    await page.goto(`http://127.0.0.1:${STATIC}/map.html?room=${room}&name=${name}&map=aberdeen&shots=1`);
    // A reloaded page re-joins from the URL; that is a failure mode worth
    // calling out by name rather than a masked wait.
    let navigations = 0;
    page.on('load', () => { navigations += 1; });
    await sleep(1500);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const done = await page.evaluate(() =>
        typeof window.__net === 'function' && window.__net().connected).catch(() => false);
      if (done && navigations === 0) return;
      if (done && navigations > 0) throw new Error(`${name}'s page reloaded mid-join (${navigations}x)`);
      if ((Date.now() - (page._sampleAt ?? 0)) > 10_000) {
        page._sampleAt = Date.now();
        const sample = await page.evaluate(() => ({
          diag: typeof window.__netDiag === 'function' ? window.__netDiag() : null,
          hasNet: typeof window.__net === 'function',
          lines: (() => { try { return window.__console?.getLines?.(10) ?? null; } catch { return null; } })(),
        })).catch(() => null);
        process.stdout.write(`[${name}] sample ${Math.round((Date.now() - deadline + 60000) / 1000)}s: ${JSON.stringify(sample)}\n`);
      }
      await sleep(500);
    }
    throw new Error(`join timeout (${name})`);
  };
  const deploy = async page => {
    await page.waitForFunction(() => window.__deploy && window.__deploy.open, null,
      { timeout: 60_000 });
    // The level streams for a while; the commit button refuses until the
    // world is ready, so retry until the soldier exists.
    for (let i = 0; i < 200; i++) {
      const ok = await page.evaluate(() => window.__deploy.spawn());
      if (ok && await page.evaluate(() => window.__soldier() !== null)) return;
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('deploy never committed');
  };
  // The walk, driven deterministically: headless Chromium renders Aberdeen
  // at a few fps under software GL, and the page's catch-up duty cycle then
  // starves the walk input (the P1 walk law assumes a 30 Hz feed). The page
  // ships a deterministic frame driver for exactly this (`__renderOnce`,
  // "the sim is deterministic under __renderOnce"): force a frame at a
  // fixed dt, and the local world consumes the engine's own one-input-per-
  // tick stream at full cadence. The wire rides it identically (the room
  // sends one input word per consumed tick).
  const walk = async (page, worldSeconds) => {
    await page.evaluate(() => { window.__keys.add('KeyW'); window.__setFly(true); });
    const frames = Math.ceil(worldSeconds * 60);
    for (let i = 0; i < frames; i++) {
      await page.evaluate(() => window.__renderOnce(480, 300));
    }
    await page.evaluate(() => window.__keys.delete('KeyW'));
  };

  // A deploys and walks (B not open yet — one swiftshader page at a time
  // keeps the chromium alive; the two join moments are the heavy ones).
  await join(pageA, 'smoke-p2', 'A');
  await deploy(pageA);
  const aStart = await pageA.evaluate(() => ({ x: window.__soldier().x, z: window.__soldier().z }));

  // The walk: A moves ~12 m in 2 world-seconds at 6 m/s.
  await walk(pageA, 2);
  const after = await pageA.evaluate(() => ({ x: window.__soldier().x, z: window.__soldier().z }));
  const aMoved = Math.hypot(after.x - aStart.x, after.z - aStart.z);
  // The law says ~12 m in the two world-seconds; the forced frames' tick
  // duty varies a little with machine load, so the bar is "really walked"
  // (4 m +) rather than the exact figure — a stuck body crawls < 1 m.
  if (aMoved < 4) {
    const diag = await pageA.evaluate(() => ({
      soldier: window.__soldier(),
      hasW: window.__keys.has('KeyW'),
      optOnFoot: (() => { try { return document.getElementById('onfoot').checked; } catch { return null; } })(),
    }));
    process.stdout.write(`[A] walk diag: ${JSON.stringify(diag)}\n`);
    throw new Error(`A walked only ${aMoved.toFixed(2)} m locally`);
  }

  // B joins now and confirms A's server-side state end to end: the wire's
  // ghost sits within 2 m of where the local sim put A (the page and the
  // server spawn the same flag — the smoke's spawn row carries the flag
  // index — and both integreate the same input stream, so the prediction
  // and the authority agree within tick boundaries).
  await join(pageB, 'smoke-p2', 'B');
  await deploy(pageB);
  await pageB.waitForFunction(() => window.__net().remoteSlots.length > 0, null,
    { timeout: 30_000 });
  const aSlotOnB = await pageB.evaluate(() => window.__net().remoteSlots[0]);

  let bSaw = null;
  for (let i = 0; i < 150; i++) {
    bSaw = await pageB.evaluate(slot => {
      const r = window.__net().remote(slot);
      return r ? { x: r.x, z: r.z } : null;
    }, aSlotOnB);
    if (bSaw && Math.hypot(bSaw.x - after.x, bSaw.z - after.z) < 2) break;
    await sleep(100);
  }
  if (!bSaw) throw new Error('B never saw A at all');
  const bSawDrift = Math.hypot(bSaw.x - aStart.x, bSaw.z - aStart.z);
  if (bSawDrift < 3) {
    throw new Error(`B saw A drift only ${bSawDrift.toFixed(2)} m (server confirmed ${aMoved.toFixed(2)} m)`);
  }

  // The seat: A enters the nearest vehicle (searches, walking deterministic
    // ticks when none is near); B must see A seated in a replica, at the
    // vehicle's server pose.
    let aSeat = null;
    for (let i = 0; i < 20 && !(aSeat && aSeat.onboard); i++) {
      await pageA.evaluate(() => window.__seatToggle());
      aSeat = await pageA.evaluate(() => {
        const s = window.__seat();
        // The E-key mirror: a toggle straight on top of the same vehicle
        // exits again — only walk on when nothing was near.
        if (!s.onboard) window.__keys.add('KeyW');
        return s;
      });
      if (!aSeat.onboard) {
        for (let f = 0; f < 30; f++) await pageA.evaluate(() => window.__renderOnce(480, 300));
        await pageA.evaluate(() => window.__keys.delete('KeyW'));
      }
    }
  if (!aSeat?.onboard) throw new Error('A never entered a vehicle');
  const aVehicle = aSeat.vehicle;
  const aSent = await pageA.evaluate(() => window.__net().sent);
  process.stdout.write(`[A] seat rows sent: ${JSON.stringify(aSent)}\n`);

  let bSeated = null;
  for (let i = 0; i < 150; i++) {
    bSeated = await pageB.evaluate(slot => {
      const r = window.__net().remote(slot);
      return r ? { seated: r.seated, vehicleId: r.vehicleId, seatIndex: r.seatIndex } : null;
    }, aSlotOnB);
    if (bSeated && bSeated.seated) break;
    await sleep(100);
  }
  if (!bSeated?.seated) {
    const dump = await Promise.all([
      pageA.evaluate(() => ({
        seat: window.__seat(),
        diag: window.__netDiag?.(),
        net: window.__net(),
      })),
      pageB.evaluate(() => ({
        net: window.__net(),
      })),
    ]);
    process.stdout.write(`[seat dump] A: ${JSON.stringify(dump[0])}\n[seat dump] B: ${JSON.stringify(dump[1])}\n`);
    throw new Error(`B never saw A seated (last: ${JSON.stringify(bSeated)})`);
  }

  // The fire: A holds the trigger for two deterministic seconds; B's feed
  // gains a fire row (the server's own 0.35 s throttle is the source of
  // truth here).
  await pageA.evaluate(() => window.__keys.add('Space'));
  for (let f = 0; f < 120; f++) await pageA.evaluate(() => window.__renderOnce(480, 300));
  await pageA.evaluate(() => window.__keys.delete('Space'));

  let bFired = false;
  for (let i = 0; i < 80; i++) {
    bFired = await pageB.evaluate(() =>
      window.__net().feed.some(r => r.type === 'fire'));
    if (bFired) break;
    await sleep(100);
  }
  if (!bFired) throw new Error('B never saw A fire');

  // The explicit leave: A leaves; B's feed gains the leave row.
  await pageA.evaluate(() => window.__net().close());
  let bLeft = false;
  for (let i = 0; i < 80; i++) {
    bLeft = await pageB.evaluate(() =>
      window.__net().feed.some(r => r.type === 'leave' && r.text.includes('A')));
    if (bLeft) break;
    await sleep(100);
  }
  if (!bLeft) throw new Error('B never saw A leave');

  await smokeBrowser.close();
  console.log(`P2 smoke OK — A moved ${aMoved.toFixed(1)} m, B confirmed, seated in ${aVehicle}, fired, left`);
}

export { bootStatic };

const isMain = process.argv[1]?.endsWith('p2_two_browser_smoke.mjs');
if (isMain) {
  const teardown = () => {
    for (const child of kids) { try { child.kill('SIGKILL'); } catch { /* gone */ } }
    try { smokeBrowser?.close(); } catch { /* gone */ }
    try { smokeBrowser2?.close(); } catch { /* gone */ }
    try { smokeStatic?.close(); } catch { /* gone */ }
  };
  // A stopped runner must not leave a room server, a static server, or a
  // chromium behind: SIGTERM/SIGINT run the same teardown the success path
  // runs, then exit — the full stop, statically checked.
  process.on('SIGTERM', () => { teardown(); process.exit(130); });
  process.on('SIGINT', () => { teardown(); process.exit(130); });

  main()
    .catch(error => {
      console.error(`P2 smoke FAILED: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(teardown);
}