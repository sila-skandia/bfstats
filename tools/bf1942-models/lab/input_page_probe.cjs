// The input path on the live page at a chosen frame rate: a headless map.html
// through a probe sidecar (run with --word-log) deploys on Wake's beach,
// walks in legs and taps Space every 2.5 s, and reads the reconciler's error
// at every acked tick (`__net().trace[]`: `err` m, `dy` mm). The frame rate
// is held by a requestAnimationFrame callback that runs first in each frame
// and spins until the frame's time is up, the way a slow page's own work
// delays its next frame; JITTER adds up to that many ms at random, and GAPS
// a 60-180 ms frame that many times a second (the headless renderer's own
// gaps, wire.md section 39).
//
//   node sidecar/sidecar.mjs 127.0.0.1:14718 --name ip1 --team 2 --ws 18111 --word-log --out run.ndjson
//   python3 serve_viewer.py 5511
//   flock /tmp/claude-1000/bfstats-headless.lock node lab/input_page_probe.cjs out.json
//   python3 lab/input_starve_check.py run.ndjson --page out.json
//
// Env: VPORT (5511), WS (18111), FPS (0: the renderer's own), JITTER (ms, 0),
// GAPS (per s, 0), DUR (s, 20), WALK (1), JUMPS (1), VIEW (1280x720: a
// smaller one renders faster and stalls less), PLAYWRIGHT.
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/home/dylan/projects/skandia/bfstats/ui/node_modules/playwright');
const PORT = process.env.VPORT || 5511;
const WS = process.env.WS || '18111';
const OUT = process.argv[2] || 'inputpage.json';
const FPS = Number(process.env.FPS || 0);
const JITTER = Number(process.env.JITTER || 0);
const GAPS = Number(process.env.GAPS || 0);
const DUR = Number(process.env.DUR || 20);
const WALK = process.env.WALK !== '0';
const JUMPS = process.env.JUMPS !== '0';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = { mode: { FPS, JITTER, GAPS, DUR, WALK, JUMPS }, acks: [], log: [] };
  try {
    const [vw, vh] = (process.env.VIEW || '1280x720').split('x').map(Number);
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    page.on('console', (m) => { if (/error/i.test(m.type())) res.log.push(m.text()); });
    // The frame pacer, armed later (`__fpsCap`), and every frame's start.
    await page.addInitScript(() => {
      window.__frameAt = [];
      window.__fpsCap = null;
      const raf = window.requestAnimationFrame.bind(window);
      let last = performance.now();
      const pace = () => {
        const c = window.__fpsCap;
        if (c) {
          let ms = c.fps > 0 ? 1000 / c.fps : 0;
          if (c.jitter) ms += Math.random() * c.jitter;
          if (c.gaps && Math.random() < c.gaps * Math.max(ms, 16) / 1000) ms = 60 + Math.random() * 120;
          while (performance.now() < last + ms) { /* the frame's own work */ }
        }
        last = performance.now();
        if (window.__frameAt.length < 20000) window.__frameAt.push(last);
        raf(pace);
      };
      raf(pace);
    });
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
    await page.evaluate((c) => { window.__fpsCap = c; }, { fps: FPS, jitter: JITTER, gaps: GAPS });
    await delay(4000);   // the pacer settles at the new rate
    await page.evaluate(() => {
      const a = window.__iacks = [];
      let last = -1;
      const tick = () => {
        for (const e of window.__net().trace ?? []) {
          if (e.seq > last && e.err !== undefined) { last = e.seq; a.push({ seq: e.seq, at: performance.now(), err: e.err, dy: e.dy ?? null }); }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const n0 = await page.evaluate(() => ({ starved: window.__net().starved, sent: window.__net().sentSeq, at: performance.now(), frames: window.__frameAt.length }));
    const t0 = Date.now();
    let nextJump = t0 + 1200;
    let leg = 0;
    while (Date.now() - t0 < DUR * 1000) {
      if (WALK) {
        // Two seconds walking, one standing, turning the leg's heading.
        const phase = Math.floor((Date.now() - t0) / 1000) % 3;
        const want = phase < 2;
        await page.evaluate((w) => { if (w) window.__keys.add('KeyW'); else window.__keys.delete('KeyW'); }, want);
        if (!want && leg % 2 === 0) leg++;
        if (want && leg % 2 === 1) leg++;
      }
      if (JUMPS && Date.now() >= nextJump) {
        await page.evaluate(() => window.__keys.add('Space'));
        await delay(60);
        await page.evaluate(() => window.__keys.delete('Space'));
        nextJump += 2500;
      }
      await delay(100);
    }
    await page.evaluate(() => { window.__keys.delete('KeyW'); });
    const n1 = await page.evaluate(() => ({ starved: window.__net().starved, sent: window.__net().sentSeq, at: performance.now(), frames: window.__frameAt.length }));
    await delay(1000);
    res.window = { from: n0, to: n1 };
    res.acks = await page.evaluate(() => window.__iacks);
    res.frames = await page.evaluate(([a, b]) => window.__frameAt.slice(a, b), [n0.frames, n1.frames]);
    res.pace = await page.evaluate(() => window.__net().pace);
    res.stats = await page.evaluate(() => ({ corrections: window.__net().corrections, yTaken: window.__net().yTaken ?? null }));
  } catch (e) {
    res.error = String(e);
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(res));
    await browser.close();
  }
  const q = (xs, f) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * f))] : null;
  const dys = (res.acks || []).filter((a) => a.dy !== null).map((a) => Math.abs(a.dy)).sort((x, y) => x - y);
  const errs = (res.acks || []).map((a) => a.err * 1000).sort((x, y) => x - y);
  const fr = res.frames || [];
  const gaps = fr.slice(1).map((t, i) => t - fr[i]).sort((x, y) => x - y);
  const w = res.window;
  console.log(JSON.stringify({
    fps: w ? +(1000 * (w.to.frames - w.from.frames) / (w.to.at - w.from.at)).toFixed(1) : null,
    frameMs: { med: q(gaps, 0.5)?.toFixed(1), p99: q(gaps, 0.99)?.toFixed(1), max: gaps.at(-1)?.toFixed(1) },
    starved: w ? w.to.starved - w.from.starved : null, words: w ? w.to.sent - w.from.sent : null,
    dy: { n: dys.length, med: q(dys, 0.5), p99: q(dys, 0.99), max: dys.at(-1), over50: dys.filter((d) => d > 50).length },
    err: { med: q(errs, 0.5), p99: q(errs, 0.99), max: errs.at(-1) },
    pace: res.pace, error: res.error ?? null,
  }));
})();
