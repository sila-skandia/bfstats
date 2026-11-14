// Does a long replay get slower as it plays? (features/remaster-browser,
// "A replay that slowed as it played"). Plays a recording in headless
// Google Chrome on the Mac's GPU, uncapped, and every `--every` seconds
// prints the median and p90 frame interval, draw calls, the renderer's
// geometries and textures, the scene's object, light and mesh counts and
// the JS heap. A count that only climbs is the leak; a frame time that
// climbs with it is the degradation. Headless presentation pairs a ~30 ms
// interval with a ~2 ms one now and then; read the median, not the p90.
//
//   node tests/perf/remaster_replay_soak.mjs --base http://localhost:5341 \
//     --replay replays/<file>.ndjson [--map liberation_of_caen] [--mod bf1942] \
//     [--seconds 240] [--every 15] [--speed 1] [--start 0] [--retail] [--json out.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(path.resolve(here, '../../../../ui/node_modules/playwright/index.mjs'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = k => argv.includes(`--${k}`);
const base = opt('base', 'http://localhost:5341');
const replay = opt('replay', '');
const map = opt('map', 'liberation_of_caen');
const mod = opt('mod', 'bf1942');
const seconds = Number(opt('seconds', 240));
const every = Number(opt('every', 15));
const speed = Number(opt('speed', 1));
const start = Number(opt('start', 0));
if (!replay) throw new Error('--replay is required');

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--mute-audio', '--enable-precise-memory-info',
    '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const page = await (await browser.newContext({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
const mode = has('retail') ? 'remaster=0' : 'remaster=1&pace=0';
await page.goto(`${base}/map.html?mod=${mod}&map=${map}&replay=${encodeURIComponent(replay)}&${mode}&quality=full&shots=1`, { timeout: 300000 });
await page.waitForFunction(() => window.replay?.statusLine && window.__renderer, null, { timeout: 600000, polling: 500 });
await page.waitForTimeout(4000);
await page.evaluate(({ speed, start }) => {
  const r = window.replay;
  if (start) r.seek(start);
  r.speed = speed; r.playing = true;
  window.__ft = []; let last = performance.now();
  const tick = now => { window.__ft.push(now - last); last = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, { speed, start });

const samples = [];
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < seconds) {
  await page.waitForTimeout(every * 1000);
  const s = await page.evaluate(() => {
    const ft = window.__ft.splice(0);
    const sorted = [...ft].sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
    const info = window.__renderer.info;
    let objects = 0, lights = 0, meshes = 0, visible = 0, points = 0, sprites = 0;
    window.__scene.traverse(o => {
      objects++;
      if (o.isLight) lights++;
      if (o.isPoints) points++;
      if (o.isMesh) { meshes++; if (o.visible) visible++; }
      if (o.isSprite) sprites++;
    });
    const r = window.replay;
    return {
      t: Math.round(r.time), frames: ft.length, med: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), p99: +q(0.99).toFixed(1),
      calls: info.render?.calls, tris: info.render?.triangles, geo: info.memory?.geometries, tex: info.memory?.textures,
      objects, meshes, visible, lights, points, sprites,
      heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      hulls: r.hulls?.size,
    };
  });
  samples.push(s);
  console.log(JSON.stringify(s));
}
if (opt('json')) fs.writeFileSync(opt('json'), JSON.stringify(samples, null, 1));
await browser.close();
