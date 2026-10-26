// The live page against a sidecar (Kotlin or Node): a headless map.html
// connects, passes the briefing, deploys on its side's base, walks for a
// while, and reports what a player would see: the connection, the roster, the
// remote soldiers drawn and how far they moved, its own soldier spawned and
// moving, and the server's acknowledgements and corrections.
//
//   python3 tools/bf1942-models/serve_viewer.py 5511        # not 5273: the owner's
//   node tools/sidecar-android/parity/live/page-proof.cjs out.json
//
// Env: VPORT (5511), WS (17995), MAP (wake), TEAM (2), WALK_S (12), WATCH_S (10),
// PLAYWRIGHT (ui/node_modules/playwright). One headless Chromium at a time.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || path.resolve(__dirname, '../../../../ui/node_modules/playwright'));
const PORT = process.env.VPORT || 5511;
const WS = process.env.WS || '17995';
const MAP = process.env.MAP || 'wake';
const TEAM = Number(process.env.TEAM || 2);
const WALK_S = Number(process.env.WALK_S || 12);
const WATCH_S = Number(process.env.WATCH_S || 10);
const OUT = process.argv[2] || 'page-proof.json';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = { ws: WS, steps: [], errors: [] };
  const step = (k, v) => { res.steps.push({ k, at: Date.now(), ...v }); console.log(k, JSON.stringify(v)); };
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
    page.on('pageerror', (e) => res.errors.push(String(e).slice(0, 300)));
    const url = `http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=${MAP}&mode=CoOp&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=${TEAM}`;
    step('goto', { url });
    await page.goto(url);
    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) {
      ready = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (!ready && i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      if (!ready) await delay(1000);
    }
    const net = () => page.evaluate(() => { const n = window.__net(); return { connected: n.connected, slot: n.slot, level: n.level, remotes: Object.keys(n.remoteNames).length, names: Object.values(n.remoteNames), snaps: n.snapCount, worldReady: n.worldReady }; });
    step('connected', { ready, ...(ready ? await net() : {}) });
    if (!ready) throw new Error('the page never joined');
    // Remote soldiers as drawn: positions now and WATCH_S later.
    const remotes = () => page.evaluate(() => {
      const n = window.__net(); const now = performance.now(); const o = {};
      for (const s of n.remoteSlots) { const p = n.remote(s, now); if (p?.alive) o[s] = { name: n.remoteNames[s], x: p.x, z: p.z, inVehicle: !!p.inVehicle }; }
      return o;
    });
    const before = await remotes();
    await delay(WATCH_S * 1000);
    const after = await remotes();
    const moved = Object.keys(after).filter((s) => before[s]).map((s) => ({ slot: s, name: after[s].name, inVehicle: after[s].inVehicle,
      metres: +Math.hypot(after[s].x - before[s].x, after[s].z - before[s].z).toFixed(1) }));
    step('remotes', { alive: Object.keys(after).length, moved: moved.filter((m) => m.metres > 0.5).length, detail: moved });
    // Deploy on our side's base and walk.
    let alive = false;
    for (let tries = 0; tries < 8 && !alive; tries++) {
      const flag = await page.evaluate((team) => {
        const d = window.__deploy; d.setTeam(team);
        const f = d.flags.find((x) => x.team === team && x.spawns > 0);
        d.select(f.name); d.setKit('assault'); d.spawn();
        return f.name;
      }, TEAM);
      for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
      step('deploy', { tries, flag, alive });
    }
    if (!alive) throw new Error('no spawn');
    for (let k = 0; k < 5 && await page.evaluate(() => !!document.querySelector('[data-state="briefing"]')); k++) { await page.keyboard.press('Enter'); await delay(800); }
    const me = () => page.evaluate(() => { const s = window.__soldier(), n = window.__net(); return { x: s.x, z: s.z, alive: !!n.self?.alive, hp: n.self?.hp ?? null, ack: n.ack ?? null, corrections: n.corrections, hard: n.hardCorrections, err: n.correction?.error ?? null, sent: n.sentSeq ?? null }; });
    const m0 = await me();
    await page.evaluate(() => window.__keys.add('KeyW'));
    const t0 = Date.now();
    while (Date.now() - t0 < WALK_S * 1000) {
      // Turn a little now and then, so the walk is not one line into a wall.
      await page.evaluate(() => window.__lookDelta(40, 0));
      await delay(500);
    }
    await page.evaluate(() => window.__keys.delete('KeyW'));
    await delay(1000);
    const m1 = await me();
    step('walked', { from: m0, to: m1, metres: +Math.hypot(m1.x - m0.x, m1.z - m0.z).toFixed(1), corrections: m1.corrections - m0.corrections, hard: m1.hard - m0.hard });
    // The server's own word on where he is: the newest ack row's body.
    const self = await page.evaluate(() => { const s = window.__net().self; return s ? { x: s.x, z: s.z, alive: s.alive, hp: s.hp } : null; });
    step('server-self', { self, pageVsServer: self ? +Math.hypot(self.x - m1.x, self.z - m1.z).toFixed(2) : null });
    step('end', await net());
  } catch (e) {
    res.error = String(e);
    console.log('error', res.error);
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
    await browser.close();
  }
})();
