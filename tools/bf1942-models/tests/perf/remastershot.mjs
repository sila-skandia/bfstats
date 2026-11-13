// Before/after captures and frame times for remaster mode
// (features/remaster-browser). One headless Google Chrome with WebGPU on the
// Mac's GPU (the bundled headless shell falls back to SwiftShader; WebKit has
// no navigator.gpu), a level opened with and without `?remaster`, the camera
// put on each named view, frames stepped with `__renderOnce`, the canvas
// captured, and the per-frame draw time measured.
//
//   node tests/perf/remastershot.mjs --base http://localhost:5390 --map wake \
//        --out ../../features/remaster-browser/shots [--modes 'retail;remaster'] \
//        [--views airfield,beach] [--extra "&foo=1"] [--frames 120]
//
// Views are in VIEWS below: a position and a yaw/pitch for the free camera.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(path.resolve(here, '../../../../ui/node_modules/playwright/index.mjs'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const base = opt('base', 'http://localhost:5390');
const map = opt('map', 'wake');
const out = opt('out', 'shots');
const modes = opt('modes', 'retail;remaster').split(';');
const slug = m => m.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '');
const extra = opt('extra', '');
const frames = Number(opt('frames', 120));
const W = Number(opt('w', 1600)), H = Number(opt('h', 900));
const only = opt('views', null)?.split(',');
const headed = argv.includes('--headed');
const effect = opt('effect', null);

// Free-camera views per level: [x, y, z, yaw, pitch]. The free camera looks
// along (sin yaw, ., cos yaw): yaw 0 is +Z, pi/2 is +X (east).
export const VIEWS = {
  wake: {
    airfield: [1000, 108, -1080, 2.4, -0.12],
    beach: [1180, 101, -1270, 0.9, -0.08],
    hill: [905, 170, -900, -2.6, -0.25],
    bunker: [1308, 110, -1195, 1.57, -0.05],
    sun: [1240, 112, -1140, -0.35, 0.12],
  },
  battle_of_britain: {
    base: [1180, 116, -1640, 2.67, -0.12],
    approach: [1257, 118, -1293, -3.02, -0.06],
    airfield: [300, 94, -230, 2.37, -0.08],
    overview: [1000, 260, -1100, -2.6, -0.32],
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome', headless: !headed,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const report = {};
try {
  for (const mode of modes) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 9).join('\n')}`));
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !/status of 404|Failed to load resource/.test(t)) errors.push(t.slice(0, 400));
      if (m.type() === 'warning' && /WebGPU|TSL|NodeMaterial|THREE/.test(t)) errors.push(`warn: ${t.slice(0, 300)}`);
    });
    const q = `map=${map}&shots=1&mute&botCount=0${mode.startsWith('remaster') ? `&${mode}` : ''}${extra}`;
    const t0 = Date.now();
    await page.goto(`${base}/map.html?${q}`, { waitUntil: 'load', timeout: 300000 });
    try {
      await page.waitForFunction(() => window.__renderOnce && window.__scene, null, { timeout: 300000 });
    } catch (e) {
      console.log(mode, 'never ready', errors.join('\n'));
      await page.close();
      continue;
    }
    for (let i = 0; i < 240; i++) {
      const state = await page.evaluate(() => document.querySelector('.ld-overlay')?.dataset.state ?? 'done');
      if (state === 'briefing') await page.evaluate(() => document.querySelector('.ld-brief-btn')?.click());
      else if (state === 'done' || state === 'error') break;
      await sleep(250);
    }
    const adapter = await page.evaluate(async () => {
      if (!navigator.gpu) return 'no navigator.gpu';
      const a = await navigator.gpu.requestAdapter();
      return a ? `${a.info?.vendor} ${a.info?.architecture}` : 'no adapter';
    });
    const loadS = (Date.now() - t0) / 1000;
    report[mode] = { adapter, loadS, views: {}, errors };
    const evalFile = opt('eval', null);
    if (evalFile) {
      const fn = fs.readFileSync(evalFile, 'utf8');
      const res = await page.evaluate(`(async () => { ${fn} })()`);
      console.log(mode, 'eval:', JSON.stringify(res, null, 1));
    }
    // The page's own animation loop would draw frames between ours and
    // share the GPU with the measurement: stop it; `__renderOnce` drives.
    await page.evaluate(() => window.__renderer.setAnimationLoop(null));
    const views = Object.entries(VIEWS[map] || {}).filter(([k]) => !only || only.includes(k));
    for (const [name, [x, y, z, yaw, pitch]] of views) {
      const r = await page.evaluate(async ([x, y, z, yaw, pitch, W, H, frames, effect]) => {
        const cam = window.__camera;
        const put = () => {
          cam.position.set(x, y, z);
          if (window.__look) { window.__look.yaw = yaw; window.__look.pitch = pitch; }
          cam.rotation.set(pitch, yaw, 0, 'YXZ');
          cam.updateMatrixWorld();
        };
        // Warm: let every texture arrive and every pipeline compile.
        for (let i = 0; i < 30; i++) { put(); window.__renderOnce(W, H); await new Promise(r => setTimeout(r, 30)); }
        const gl = window.__renderer;
        // `--effect name@x,y,z@frames`: play one effect and capture it
        // `frames` thirtieths of a second in, instead of timing the view.
        if (effect) {
          const [ename, at, n] = effect.split('@');
          const names = window.__effectNames?.() ?? [];
          const pick = names.find(e => e.toLowerCase() === ename.toLowerCase())
            ?? names.find(e => e.toLowerCase().includes(ename.toLowerCase()));
          for (let pass = 0; pass < 2; pass++) {
            window.__stopEffects?.();
            window.__playEffect(pick, at.split(',').map(Number));
            for (let i = 0; i < Number(n); i++) { put(); window.__renderOnce(W, H, 1 / 30); }
            if (pass === 0) await new Promise(r => setTimeout(r, 400));
          }
          return { url: gl.domElement.toDataURL('image/png'), median: 0, p95: 0, cpu: 0, gpu: null, calls: pick };
        }
        // Frame time: the CPU cost of a frame plus the GPU's, the second by
        // waiting for the queue after each frame.
        const dev = gl.backend?.device;
        const times = [], cpu = [], gpu = [];
        for (let i = 0; i < frames; i++) {
          put();
          const t = performance.now();
          window.__renderOnce(W, H);
          cpu.push(performance.now() - t);
          if (dev) {
            await dev.queue.onSubmittedWorkDone();
            if (gl.backend?.trackTimestamp) {
              const ms = await gl.resolveTimestampsAsync('render');
              if (typeof ms === 'number') gpu.push(ms);
            }
          } else {
            const c = gl.getContext();
            const px = new Uint8Array(4);
            c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px);
          }
          times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        cpu.sort((a, b) => a - b);
        put();
        window.__renderOnce(W, H);
        const url = gl.domElement.toDataURL('image/png');
        return {
          url,
          median: times[times.length >> 1],
          cpu: cpu[cpu.length >> 1],
          gpu: gpu.length ? gpu.sort((a, b) => a - b)[gpu.length >> 1] : null,
          p95: times[Math.floor(times.length * 0.95)],
          calls: gl.info?.render?.calls ?? gl.info?.render?.drawCalls ?? null,
        };
      }, [x, y, z, yaw, pitch, W, H, frames, effect]).catch(e => {
        console.log(mode, name, 'failed:', e.message.split('\n')[0], '\n', [...new Set(errors)].slice(0, 12).join('\n'));
        return null;
      });
      if (!r) continue;
      const file = path.join(out, `${map}_${name}${effect ? `_${slug(effect.split('@')[0])}` : ''}_${slug(mode)}.png`);
      fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
      report[mode].views[name] = { median: +r.median.toFixed(2), p95: +r.p95.toFixed(2), cpu: +r.cpu.toFixed(2), gpu: r.gpu == null ? null : +r.gpu.toFixed(2), calls: r.calls, file };
      console.log(mode, name, `median ${r.median.toFixed(2)} ms p95 ${r.p95.toFixed(2)} ms cpu ${r.cpu.toFixed(2)} ms gpu ${r.gpu?.toFixed(2) ?? '-'} ms calls ${r.calls}`, file);
    }
    if (errors.length) console.log(mode, 'errors:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
    await page.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, `${map}_report.json`), JSON.stringify(report, null, 1));
