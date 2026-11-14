// Frame pacing of a match with bots in remaster mode (features/remaster-browser,
// "A match with bots").
//
// The owner's report (2026-11-13): "really stuttery", on the live site, in a
// match. The frame-time table in the README is a still camera with no bots at
// a pixel ratio of 1; a match at a laptop's own size is another question. This
// opens a level with bots in headless Google Chrome at 1728 x 1117 and a pixel
// ratio of 2 (a 16-inch MacBook Pro's default), spawns the player on foot,
// walks and turns for `--seconds`, and prints how many frames came late.
//
//   node tests/perf/remaster_match.mjs --base http://localhost:5273 \
//        [--map el_alamein] [--bots 16] [--seconds 45] [--retail]
//
//   --uncapped        no vsync: the median is what a frame costs
//   --phases          every frame's phases (map.html `frameCost`: the
//                     simulation, the presentation, the draw, the HUD) as
//                     median, p90, p99 and worst, and what the frames over
//                     15.5 ms of script were made of
//   --ab <switch>     with --uncapped: flip `__remaster.tune.<switch>` every
//                     1.5 s and print the frame time with it on and off. The
//                     only way to time one change on a busy machine, where
//                     two runs differ by more than the change does.
//                     `hooks.<path>` flips a remaster hook instead
//                     (`hooks.tracer.everyRound`: every round drawn).
//
// A late frame is one shown more than 25 ms after the last. The page's own
// pacer (frame-pacer.js) is on, as it is for a player (`pace=1`).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(path.resolve(here, '../../../../ui/node_modules/playwright/index.mjs'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(`--${k}`);
const base = opt('base', 'http://localhost:5273');
const map = opt('map', 'el_alamein');
const bots = Number(opt('bots', 16));
const seconds = Number(opt('seconds', 45));
const uncapped = has('uncapped');
const ab = opt('ab', null);

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    ...(uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])],
});
const context = await browser.newContext({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 200)));
const mode = has('retail') ? 'remaster=0' : 'remaster=1&pace=1';
await page.goto(`${base}/map.html?map=${map}&${mode}&botCount=${bots}&botSkill=0.75&shots=1`, { timeout: 240000 });
await page.waitForFunction(() => window.__deploy && window.__camera && window.__renderer, null, { timeout: 300000 });
await page.waitForTimeout(12000);
await page.mouse.click(640, 400).catch(() => {});
await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.__setOnFoot(true); await wait(1500);
  const d = window.__deploy; d.select(d.flags.findIndex(f => f.side)); await wait(300); d.spawn(); await wait(8000);
  window.__ft = []; window.__phases = []; let last = performance.now();
  const cost = window.__frameCost;
  const tick = now => {
    window.__ft.push(now - last); last = now;
    if (cost) window.__phases.push([cost.sim, cost.present, cost.draw, cost.hud, cost.total]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // The soldier walks and turns, as a player does.
  const keys = ['KeyW', 'KeyD', 'KeyW', 'KeyA'];
  let k = 0;
  window.__walk = setInterval(() => {
    const code = keys[k++ % keys.length];
    for (const c of keys) window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    if (window.__look) window.__look.yaw += 0.6;
  }, 2500);
});
const median = list => { const s = [...list].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const frames = async ms => {
  await page.evaluate(() => { window.__ft.length = 0; window.__phases.length = 0; });
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__ft.slice(1));
};

if (ab) {
  await page.evaluate(() => {
    window.__abSet = (name, value) => {
      if (!name.startsWith('hooks.')) { window.__remaster.tune[name] = value; return; }
      const path = name.slice(6).split('.');
      const leaf = path.pop();
      path.reduce((o, k) => o[k], window.bfRemasterHooks)[leaf] = value;
    };
  });
  const on = [], off = [];
  for (let c = 0; c < 10; c++) {
    for (const state of [true, false]) {
      await page.evaluate(([name, value]) => window.__abSet(name, value), [ab, state]);
      await page.waitForTimeout(350);
      (state ? on : off).push(median(await frames(1300)));
    }
  }
  await page.evaluate(name => window.__abSet(name, true), ab);
  const saved = on.map((v, i) => off[i] - v);
  console.log(JSON.stringify({ switch: ab, on: +median(on).toFixed(2), off: +median(off).toFixed(2), saves: +median(saved).toFixed(2) }));
} else {
  const f = await frames(seconds * 1000);
  const sorted = [...f].sort((a, b) => a - b);
  const at = x => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))].toFixed(1);
  console.log(JSON.stringify({
    map, bots, mode: has('retail') ? 'retail' : 'remaster', uncapped, frames: f.length,
    median: at(0.5), p95: at(0.95), p99: at(0.99), worst: Math.round(sorted.at(-1)),
    late: f.filter(x => x > 25).length, over50: f.filter(x => x > 50).length,
    pacer: await page.evaluate(() => window.__framePacer?.state ?? null),
  }));
  if (has('phases')) {
    const rows = await page.evaluate(() => window.__phases.slice(1));
    const names = ['sim', 'present', 'draw', 'hud', 'total'];
    const out = {};
    names.forEach((name, i) => {
      const col = rows.map(r => r[i]).sort((a, b) => a - b);
      const q = x => +col[Math.min(col.length - 1, Math.floor(col.length * x))].toFixed(1);
      out[name] = { median: q(0.5), p90: q(0.9), p99: q(0.99), worst: +col.at(-1).toFixed(1) };
    });
    const over = rows.filter(r => r[4] > 15.5);
    const mean = i => +(over.reduce((a, r) => a + r[i], 0) / Math.max(1, over.length)).toFixed(1);
    out.over = { frames: over.length, sim: mean(0), present: mean(1), draw: mean(2), hud: mean(3) };
    console.log(JSON.stringify({ phases: out }));
  }
}
await browser.close();
