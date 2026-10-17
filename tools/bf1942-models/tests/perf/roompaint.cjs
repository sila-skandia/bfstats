#!/usr/bin/env node
// The multiplayer room's remote soldiers in the level's paint: a room server
// on `--map`, two pages of one headless Chromium joined to it, both deployed,
// and in each page the paint count of the other's body (`levelpaint.cjs`
// `countPaint`, surface `remoteSoldier`). Closed at the end, server and all.
//
//   node roompaint.cjs --mod bf1942 --map kasserine_pass   (a vanilla level with soldier paint)
//   node roompaint.cjs --mod fhsw --map battle_of_foy      (the server loads ~100 levels first)
//
// Exit 0 when each page drew the other painted and nothing unpainted, 1 when
// not, 2 when the room could not be staged.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { parseArgs, sleep, modulesDir } = require('./pageprobe.cjs');
const { countPaint } = require('./levelpaint.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const VIEWER = path.join(ROOT, 'viewer');
const opts = parseArgs({ mod: 'bf1942', map: 'kasserine_pass', out: '' });

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const isNet = u => u === '/netcode' || u.startsWith('/netcode/') || u.startsWith('/netcode?');

// The viewer's files, and /netcode handed to the room server, as production's
// proxy does (the page's WebSocket is same-origin).
function bootStatic(port, netPort) {
  const server = http.createServer((req, res) => {
    if (isNet(req.url)) {
      const p = http.request({ host: '127.0.0.1', port: netPort, path: req.url, method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${netPort}` } }, pres => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); });
      req.pipe(p); p.on('error', () => { res.writeHead(502); res.end(); });
      return;
    }
    const file = path.join(VIEWER, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    });
  });
  server.on('upgrade', (req, socket) => {
    if (!isNet(req.url)) { socket.destroy(); return; }
    const p = http.request({ host: '127.0.0.1', port: netPort, path: req.url, method: req.method, headers: req.headers });
    p.on('upgrade', (pres, psocket) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: ${pres.headers.upgrade}\r\nConnection: ${pres.headers.connection}\r\n`
        + `Sec-WebSocket-Accept: ${pres.headers['sec-websocket-accept']}\r\n\r\n`);
      psocket.pipe(socket); socket.pipe(psocket);
      socket.on('error', () => {}); psocket.on('error', () => {});
    });
    p.on('error', () => socket.destroy());
    p.end();
  });
  server.listen(port, '127.0.0.1');
  return server;
}

async function main() {
  const [netPort, webPort] = [await freePort(), await freePort()];
  const args = ['server.mjs', '--port', String(netPort), '--viewer', VIEWER, '--default-level', opts.map];
  if (opts.mod !== 'bf1942') args.push('--mod', opts.mod);
  const room = spawn('node', args, { cwd: path.join(ROOT, 'server'), stdio: ['ignore', 'pipe', 'pipe'] });
  let roomLog = '';
  room.stdout.on('data', d => { roomLog += d; }); room.stderr.on('data', d => { roomLog += d; });
  const web = bootStatic(webPort, netPort);
  const { chromium } = require(path.join(modulesDir(), 'playwright'));
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
  try {
    // The room server loads its tree's whole level table before it answers:
    // seconds for vanilla, minutes for FHSW's hundred-odd levels.
    let up = false;
    for (let i = 0; i < 1500 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${netPort}/netcode/rooms`)).ok; } catch {}
      if (!up) await sleep(400);
    }
    if (!up) { console.error(roomLog.slice(-2000)); return 2; }
    const pages = [];
    for (const [name, team] of [['A', 1], ['B', 2]]) {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
      const page = await ctx.newPage();
      const q = new URLSearchParams({ room: 'paint', name, map: opts.map, mod: opts.mod, shots: '1' });
      await page.goto(`http://127.0.0.1:${webPort}/map.html?${q}`, { timeout: 300000 });
      await page.waitForFunction(() => typeof window.__net === 'function' && window.__net().connected, null, { timeout: 300000 });
      for (let i = 0; i < 240; i++) {
        if (await page.evaluate(() => !!document.querySelector('.ld-overlay[data-state="briefing"]'))) await page.keyboard.press('Enter');
        else if (await page.evaluate(() => window.__deploy?.open)) break;
        await sleep(250);
      }
      let spawned = false;
      for (let i = 0; i < 200 && !spawned; i++) {
        spawned = await page.evaluate(team => {
          const d = window.__deploy; if (!d?.open) return !!window.__soldier?.();
          if (d.team !== team) d.setTeam(team);
          const f = d.flags.find(f => f.team === team && f.spawns > 0 && !f.inactive); if (f) d.select(f.name);
          return d.spawn() && !!window.__soldier();
        }, team);
        if (!spawned) await sleep(250);
      }
      pages.push({ name, page, spawned });
    }
    // Both pages run; the remotes and their bodies load.
    for (let i = 0; i < 40; i++) {
      for (const { page } of pages) await page.evaluate(() => { for (let k = 0; k < 6; k++) window.__renderOnce(640, 400); });
      await sleep(250);
    }
    const report = { mod: opts.mod, map: opts.map, pages: [] };
    for (const { name, page, spawned } of pages) {
      await page.evaluate(([tree, level]) => { window.__probeTree = tree; window.__probeLevel = level; },
        [opts.mod === 'bf1942' ? 'models' : `models/mods/${opts.mod}`, opts.map.toLowerCase()]);
      const c = await page.evaluate(countPaint);
      const remotes = await page.evaluate(() => { let n = 0; window.__scene.traverse(o => { if (/^remote soldier /.test(o.name)) n++; }); return n; });
      report.pages.push({ name, spawned, remotes, remoteSoldier: c.surfaces?.remoteSoldier ?? null, arms: c.surfaces?.arms ?? null, error: c.error });
      if (opts.out) {
        fs.mkdirSync(opts.out, { recursive: true });
        const url = await page.evaluate(() => window.__renderer.domElement.toDataURL('image/jpeg', 0.85));
        fs.writeFileSync(path.join(opts.out, `room-${opts.map}-${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      }
    }
    const ok = report.pages.every(p => p.remotes && p.remoteSoldier && p.remoteSoldier.painted > 0 && !p.remoteSoldier.unpainted);
    console.log(JSON.stringify(report, null, 1));
    if (!report.pages.every(p => p.spawned && p.remotes)) { console.error(roomLog.slice(-2000)); return 2; }
    return ok ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
    web.close();
    room.kill();
  }
}

main().then(code => process.exit(code), e => { console.error(e); process.exit(2); });
