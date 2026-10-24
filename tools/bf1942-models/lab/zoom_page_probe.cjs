// The zoomed look end to end on the live page: a headless map.html through a
// probe sidecar deploys a rifleman whose rifle zooms (Tobruk's British
// engineer, the No4, zoomFov 0.4), zooms with a real right-button press, and
// moves the mouse in fine and coarse strokes through the page's own look path
// (`__lookDelta`). After each stroke it waits for the acks to settle and reads
// the page's view (its own soldier) and the server's view at the acked tick
// (`__net().self`: the aim register x 2.5 and the twist's yaw), so the check
// is the page's turn against the server's for the same hand.
//
//   node lab/hit_target.mjs ...     (not needed: nobody is shot)
//   node sidecar/sidecar.mjs 127.0.0.1:14608 --name zp1 --team 2 --ws 17982
//   python3 serve_viewer.py 5296
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/zoom_page_probe.cjs out.json
//
// Env: VPORT (5296), WS (17982), MAP (tobruk), KIT (engineer), PLAYWRIGHT.
// features/udp-sidecar/wire.md section 44 has what it showed.
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5296;
const WS = process.env.WS || '17982';
const MAP = process.env.MAP || 'tobruk';
const KIT = process.env.KIT || 'engineer';
const OUT = process.argv[2] || 'zoompage.json';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = { strokes: [], log: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (/error/i.test(m.type())) res.log.push(m.text()); });
    await page.goto(`http://127.0.0.1:${PORT}/map.html?mod=bf1942&map=${MAP}&shots=1&sidecar=ws%3A%2F%2F127.0.0.1%3A${WS}&team=2`);
    for (let i = 0; i < 240; i++) {
      const ok = await page.evaluate(() => !!(window.__net?.().connected && window.__deploy?.flags.length)).catch(() => false);
      if (ok) break;
      if (i % 5 === 4) { await page.keyboard.press('Enter').catch(() => {}); await page.mouse.click(631, 527).catch(() => {}); }
      await delay(1000);
    }
    let alive = false;
    for (let tries = 0; tries < 8 && !alive; tries++) {
      await page.evaluate((kit) => {
        const d = window.__deploy; d.setTeam(2);
        const f = d.flags.find((x) => x.team === 2 && x.spawns > 0) ?? d.flags[0];
        d.select(f.name); d.setKit(kit); d.spawn();
      }, KIT);
      for (let k = 0; k < 30 && !alive; k++) { await delay(300); alive = await page.evaluate(() => !!(window.__soldier() && window.__net().self?.alive && window.__net().ack > 0)); }
    }
    if (!alive) throw new Error('no spawn');
    await delay(2500);
    // The rifle in hand: select the kit's slots in turn (`__selectKitWeapon`,
    // a number key; the wheel's `__cycleKitWeapon` only moves the bar, and
    // the next button press would commit it instead of zooming).
    for (let slot = 0; slot <= 6; slot++) {
      if (slot) { await page.evaluate((k) => window.__selectKitWeapon?.(k), slot); await delay(1500); }
      res.weapon = await page.evaluate(() => window.__handWeapon()?.name);
      if (/no4|k98|garand|springfield|mosin|arisaka/i.test(res.weapon || '')) break;
    }
    // Every correction the reconciler makes, summed (degrees of view): what
    // the server's acked view took back from the page's.
    await page.evaluate(() => {
      const z = window.__zfix = { n: 0, sum: 0, max: 0 };
      let seen = window.__net().corrections;
      const tick = () => {
        const n = window.__net();
        if (n.corrections !== seen && n.correction) {
          seen = n.corrections;
          const d = Math.hypot(n.correction.yawDelta ?? 0, n.correction.pitchDelta ?? 0) * 180 / Math.PI;
          z.n++; z.sum += d; z.max = Math.max(z.max, d);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const read = () => page.evaluate(() => {
      const s = window.__soldierObject, n = window.__net(), self = n.self;
      const c = window.__camera; c.updateMatrixWorld();
      const e = c.matrixWorld.elements;
      return {
        // The drawn view: the camera's forward, in the page's degrees.
        page: { yaw: Math.atan2(e[8], e[10]) * 180 / Math.PI, pitch: Math.asin(-e[9]) * 180 / Math.PI,
          bodyYaw: s.yaw * 180 / Math.PI, twist: s.twist ?? null, simPitch: s.pitch * 180 / Math.PI },
        server: self ? { viewYaw: self.viewYaw ?? null, viewPitch: self.viewPitch ?? null, aim: self.aim ?? null, twist: self.twist ?? null } : null,
        fov: window.__soldier().fov, corrections: n.corrections, ack: n.ack, fix: { ...window.__zfix },
      };
    });
    // The mission briefing owns the pointer until it is accepted (Enter, the
    // game's READY key; progress.js `briefingCaptures`).
    for (let k = 0; k < 5 && await page.evaluate(() => !!document.querySelector('[data-state="briefing"]')); k++) {
      await page.keyboard.press('Enter');
      await delay(800);
    }
    // The buttons need the page captured (page-input.js `buttonChange`); a
    // click on the canvas captures it (and fires one round into the sand).
    for (let k = 0; k < 5 && !(await page.evaluate(() => window.__captured?.())); k++) {
      await page.mouse.click(640, 360);
      await delay(1500);
    }
    res.captured = await page.evaluate(() => window.__captured?.());
    // One right-button press; pressed again while the page's field of view
    // has not moved (a press during the weapon's draw is refused).
    const zoom = async () => {
      const fov0 = (await read()).fov;
      for (let k = 0; k < 6; k++) {
        await page.evaluate(() => window.__chordEvent('down', 2, 2));
        await delay(120);
        await page.evaluate(() => window.__chordEvent('up', 2, 0));
        await delay(1500);
        if (Math.abs((await read()).fov - fov0) > 1) return;
      }
    };
    // [label, frames, counts x, counts y per frame]; each stroke is sent one
    // __lookDelta a frame, then the page waits for the acks.
    const strokes = [
      ['hip fine pitch', 60, 0, 1],
      ['hip coarse yaw', 20, 6, 0],
      ['ZOOM'],
      ['zoomed fine pitch', 60, 0, -1],
      ['zoomed fine yaw', 60, 1, 0],
      ['zoomed coarse pitch', 20, 0, 6],
      ['zoomed coarse yaw', 20, -6, 0],
      ['ZOOM'],
      ['hip fine pitch again', 60, 0, -1],
    ];
    for (const st of strokes) {
      if (st[0] === 'ZOOM') { await zoom(); res.strokes.push({ label: 'zoom toggled', fov: (await read()).fov }); continue; }
      const [label, frames, cx, cy] = st;
      const before = await read();
      await page.evaluate(([n, x, y]) => new Promise((done) => {
        let i = 0;
        const step = () => { window.__lookDelta(x, y); if (++i < n) requestAnimationFrame(step); else done(); };
        requestAnimationFrame(step);
      }), [frames, cx, cy]);
      // At the stroke's last frame: the page's drawn view against the
      // server's at the newest ack, the lead a shot fired now would carry.
      const end = await read();
      await delay(1500);
      const after = await read();
      res.strokes.push({ label, before, end, after });
      console.log(label, JSON.stringify({ before, after }));
    }
    // A zoom only the page took (the latch set without a press on the wire):
    // the server's soldier stays at the hip, and the page takes its word.
    const z0 = await page.evaluate(() => window.__net().zoomFixes ?? null);
    await page.evaluate(() => window.__setAim(true));
    await delay(200);
    const zMid = await page.evaluate(() => window.__handWeapon()?.zoomed);
    await delay(2000);
    res.desync = { pageOnlyZoom: zMid, after: await page.evaluate(() => window.__handWeapon()?.zoomed),
      zoomFixes: (await page.evaluate(() => window.__net().zoomFixes ?? null)) - (z0 ?? 0),
      serverZoom: await page.evaluate(() => window.__net().self ? null : null) };
    console.log('desync', JSON.stringify(res.desync));
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
