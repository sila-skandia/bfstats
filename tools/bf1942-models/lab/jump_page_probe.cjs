// The jump end to end on the live page: a headless map.html through a probe
// sidecar deploys on Wake's beach and taps Space in a rhythm that puts every
// other press inside the server's jump wait (PHY-35: 28 ticks after a
// standing jump), then reads the reconciler's vertical error at every acked
// tick (`__net().trace[].dy`). Before PHY-35 the page jumped on the
// presses the server refused and missed by up to 0.94 m (browser.md).
//
//   node sidecar/sidecar.mjs 127.0.0.1:14688 --name jp1 --team 2 --ws 17961
//   python3 serve_viewer.py 5361
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/jump_page_probe.cjs out.json
//
// Env: VPORT (5361), WS (17961), MODE (taps | apart: one tap every 2.5 s, the
// control no wait can touch), PLAYWRIGHT. It prints the page's frame rate and
// the server ticks that ran no page word (`starved`): each one inside a jump
// moves the server's arc a tick from the page's, whatever the jump law.
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5361;
const WS = process.env.WS || '17961';
const OUT = process.argv[2] || 'jumppage.json';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = { taps: [], acks: [], log: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (/error/i.test(m.type())) res.log.push(m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=wake&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=2`);
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (ok) break;
      if (i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      await delay(1000);
    }
    let alive = false;
    for (let tries = 0; tries < 8 && !alive; tries++) {
      await page.evaluate(() => {
        const d = window.__deploy; d.setTeam(2);
        const f = d.flags.find((x) => x.name === 'The_beach') ?? d.flags.find((x) => x.team === 2 && x.spawns > 0);
        d.select(f.name); d.spawn();
      });
      for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
    }
    if (!alive) throw new Error('no spawn');
    for (let k = 0; k < 5 && await page.evaluate(() => !!document.querySelector('[data-state="briefing"]')); k++) {
      await page.keyboard.press('Enter');
      await delay(800);
    }
    await delay(3000);
    // Every acked tick's vertical error, as the reconciler measured it
    // (`__net().trace[].dy`, mm).
    await page.evaluate(() => {
      const a = window.__jacks = [];
      let last = -1;
      const tick = () => {
        for (const e of window.__net().trace ?? []) if (e.seq > last && e.dy !== undefined) { last = e.seq; a.push({ seq: e.seq, dy: e.dy }); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const probeBody = () => page.evaluate(() => {
      const b = window.__soldierObject?.body;
      return b ? { armed: b.jumpArmed, gate: b.gatePose, pose: b.pose, lower: b.lowerBody && { ...b.lowerBody }, grounded: b.grounded,
        contacted: b.contacted, y: b.position.y, vy: b.velocity.y, queued: b._jumpQueued, swimming: b.swimming, para: b.parachute } : null;
    });
    res.bodyBefore = await probeBody();
    const tap = async (label) => {
      const t = await page.evaluate(() => { window.__keys.add('Space'); return performance.now(); });
      await delay(60);
      await page.evaluate(() => window.__keys.delete('Space'));
      res.taps.push({ label, t, body: res.taps.length < 3 ? await probeBody() : undefined });
    };
    // [label, ms to wait after the tap]: a jump, a tap ~0.75 s later (landed,
    // inside the wait: refused by the server), then one a full second after.
    // MODE=apart: one tap every 2.5 s, never inside a wait (the control).
    const s0 = await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); return window.__net().starved; });
    const t0 = Date.now();
    for (let round = 0; round < 6; round++) {
      if (process.env.MODE === 'apart') { await tap('apart'); await delay(2500); continue; }
      await tap('first'); await delay(550);
      await tap('inside'); await delay(800);
      await tap('outside'); await delay(1800);
    }
    res.fps = await page.evaluate(() => window.__frames) / ((Date.now() - t0) / 1000);
    res.starved = { before: s0, after: await page.evaluate(() => window.__net().starved) };
    await delay(1500);
    res.acks = await page.evaluate(() => window.__jacks);
    res.selfKeys = await page.evaluate(() => Object.keys(window.__net().self ?? {}));
    res.stats = await page.evaluate(() => ({ corrections: window.__net().corrections, yTaken: window.__net().yTaken ?? null }));
  } catch (e) {
    res.error = String(e);
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
    await browser.close();
  }
  const dys = (res.acks || []).filter((a) => a.dy !== null).map((a) => Math.abs(a.dy)).sort((x, y) => x - y);
  if (dys.length) console.log(JSON.stringify({ n: dys.length, median: dys[dys.length >> 1], p99: dys[Math.floor(dys.length * 0.99)], max: dys[dys.length - 1], over50: dys.filter((d) => d > 50).length, fps: res.fps, starved: res.starved, error: res.error ?? null }));
  else console.log(JSON.stringify({ error: res.error ?? 'no acks' }));
})();
