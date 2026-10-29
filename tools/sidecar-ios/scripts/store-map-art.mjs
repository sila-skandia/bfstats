#!/usr/bin/env node
// HUD-free scenic renders of vanilla BF1942 levels from the local map viewer,
// for the App Store marketing art (the "server card" faces and a hero
// background). No soldiers, no HUD: the free camera is pinned with
// `?cam=x,y,z,yaw,pitch` and the 3D canvas is read back directly
// (`__renderOnce(w, h)` then `toDataURL`), so nothing in the DOM (HUD, touch
// controls, crosshair, nametags, site bar, menus) can reach the image.
//
//   map.html?mod=bf1942&map=<level>&botCount=0&shots=1&noaudio&cam=...
//
// `shots=1` installs the test hooks; READY is clicked from inside the page
// (`.ld-brief-btn` is display:none headless). The renderer's pixel ratio is
// set to 1 and `__renderOnce(W, H)` sizes the drawing buffer to exactly the
// output size, so a portrait is 1600x2000 and the hero 3200x1800 pixels.
// Textures and terrain are given time to stream (a settle wait plus a run of
// frames) before the capture frame.
//
// Run from the repo root (needs ui/node_modules/playwright and the local
// viewer assets under tools/bf1942-models/viewer/{maps,models}):
//
//   node tools/sidecar-ios/scripts/store-map-art.mjs                # every shot
//   node tools/sidecar-ios/scripts/store-map-art.mjs --only hero --out /tmp/art
//   node tools/sidecar-ios/scripts/store-map-art.mjs --probe wake   # level facts + the default view
//   node tools/sidecar-ios/scripts/store-map-art.mjs --probe wake --views views.json
//     (views.json: { "wake": [{ "cam": [x,y,z,yaw,pitch], "fog": [300,1100], "size": [1600,900] }] })
//   node tools/sidecar-ios/scripts/store-map-art.mjs --out /some/dir --base http://localhost:5491
//
// Without --base it starts tools/bf1942-models/serve_viewer.py on --port
// (default 5491; never 5273, the owner's) and stops it at the end. It waits
// for any other headless Chromium to finish first (one at a time on this PC).
// Look at every image before using it.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, 'ui/node_modules/playwright'));

const opts = { base: '', port: 5491, only: '', probe: '', views: '', settle: '20', out: path.join(ROOT, 'features/sidecar-ios-app/store/map-art') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i].replace(/^--/, '');
  if (!(k in opts)) throw new Error(`unknown --${k}`);
  opts[k] = k === 'port' ? +argv[i + 1] : argv[i + 1];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The shots: level, output name, size, and the camera (x, y, z, yaw, pitch;
// yaw = atan2(dx, dz) toward the target, pitch negative looks down).
// `fov` overrides the camera's vertical field of view (degrees).
const PORTRAIT = [1600, 2000], HERO = [3200, 1800];
// Portrait card faces (PORTRAIT) were dropped for real app screenshots; add
// one here with a camera found through --probe if they come back.
const SHOTS = [
  // Wake's village on the ridge above the lagoon, the island's arc beyond;
  // the sky is the upper half, shaded down in its middle for a headline.
  { name: 'hero', level: 'wake', size: HERO, cam: [980, 135, -1290, 0.8288, -0.1041], fog: [300, 1100], shade: true },
];

function headless() {
  try { return execSync("ps -eo pid,args | grep -E '[h]eadless_shell|[c]hrom(e|ium).*--headless'").toString().trim().split('\n').filter(Boolean).length; } catch { return 0; }
}

async function waitForServer(base) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/map.html`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`viewer not answering at ${base}`);
}

async function openLevel(browser, base, level, cam) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const camQ = cam ? `&cam=${cam.map(v => +v.toFixed(4)).join(',')}` : '';
  await page.goto(`${base}/map.html?mod=bf1942&map=${level}&botCount=0&shots=1&noaudio${camQ}`, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.ld-overlay')?.dataset.state === 'briefing', null, { timeout: 300000, polling: 1000 });
  await page.evaluate(() => document.querySelector('.ld-brief-btn').click());
  await page.waitForFunction(() => window.__renderOnce && window.__look && window.__camera, null, { timeout: 120000, polling: 500 });
  return { ctx, page, errors };
}

// Pose the camera and draw `frames` frames at W x H, returning a PNG buffer.
async function render(page, [W, H], cam, { frames = 30, fov, fog } = {}) {
  const url = await page.evaluate(async ({ W, H, cam, frames, fov, fog }) => {
    const r = window.__renderer, c = window.__camera, s = window.__scene;
    r.setPixelRatio(1);
    if (fov) c.fov = fov;
    // `fog: [start, end]` pushes the level's haze out (the far plane follows).
    if (fog && s.fog) { s.fog.near = fog[0]; s.fog.far = fog[1]; c.far = fog[1] * 1.05; c.updateProjectionMatrix(); }
    for (let i = 0; i < frames; i++) {
      c.position.set(cam[0], cam[1], cam[2]);
      window.__look.yaw = cam[3]; window.__look.pitch = cam[4];
      window.__renderOnce(W, H, 1 / 60);
      if (i % 5 === 4) await new Promise(res => setTimeout(res, 50));
    }
    c.position.set(cam[0], cam[1], cam[2]);
    window.__look.yaw = cam[3]; window.__look.pitch = cam[4];
    window.__renderOnce(W, H, 1 / 60);
    return r.domElement.toDataURL('image/png');
  }, { W, H, cam, frames, fov, fog });
  return Buffer.from(url.split(',')[1], 'base64');
}

// A headline area: the upper middle darkened by an elliptical falloff (deepest
// at the top centre, gone by the horizon), the rest of the frame untouched.
async function shade(page, png) {
  const url = await page.evaluate(async b64 => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const W = img.width, H = img.height, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.save(); g.translate(W / 2, H * 0.12); g.scale(1, 0.42);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.62);
    r.addColorStop(0, 'rgba(8,14,26,0.62)'); r.addColorStop(0.55, 'rgba(8,14,26,0.38)'); r.addColorStop(1, 'rgba(8,14,26,0)');
    g.fillStyle = r; g.fillRect(-W, -H * 3, W * 2, H * 6); g.restore();
    const v = g.createLinearGradient(0, 0, 0, H * 0.5);
    v.addColorStop(0, 'rgba(6,10,20,0.35)'); v.addColorStop(1, 'rgba(6,10,20,0)');
    g.fillStyle = v; g.fillRect(0, 0, W, H * 0.5);
    return cv.toDataURL('image/png');
  }, png.toString('base64'));
  return Buffer.from(url.split(',')[1], 'base64');
}

async function probe(browser, base, level) {
  const { ctx, page, errors } = await openLevel(browser, base, level);
  try {
    await sleep(+opts.settle * 1000);
    const info = await page.evaluate(() => {
      const w = window.__world?.();
      const ex = w?.extras ?? {};
      const objs = (window.__objectives?.() ?? []);
      return {
        worldSize: window.__worldExtras?.(),
        cameraDefault: ex.camera ?? null,
        flags: (Array.isArray(objs) ? objs : Object.values(objs ?? {})).slice(0, 20).map(o => ({ n: o.name ?? o.id, p: (o.pos ?? o.position ?? []).map?.(Math.round) })),
        vehicles: (window.__vehicles?.() ?? []).map(v => `${v.name}@${v.pos.map(Math.round).join(',')}`).slice(0, 40),
        cam: [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z, window.__look.yaw, window.__look.pitch].map(v => +v.toFixed(2)),
        fov: window.__camera.fov, far: window.__camera.far, fog: [window.__scene.fog?.near, window.__scene.fog?.far],
        deployOpen: window.__deploy?.open,
      };
    });
    console.log(JSON.stringify(info, null, 1));
    // --views: a JSON list of views, or a .json file of { level: [views] }.
    let views = opts.views ? JSON.parse(opts.views.endsWith('.json') ? fs.readFileSync(opts.views, 'utf8') : opts.views) : null;
    if (views && !Array.isArray(views)) views = views[level];
    if (!views?.length) views = [info.cam];
    fs.mkdirSync(opts.out, { recursive: true });
    for (const [i, v] of views.entries()) {
      const file = path.join(opts.out, `probe-${level}-${i}.png`);
      fs.writeFileSync(file, await render(page, v.size ?? [800, 1000], v.cam ?? v, { frames: 20, fov: v.fov, fog: v.fog }));
      console.log(file);
    }
    if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await ctx.close();
  }
}

async function shoot(browser, base, shot) {
  const { ctx, page, errors } = await openLevel(browser, base, shot.level, shot.cam);
  try {
    // Draw the view at the output size while assets stream, then capture.
    await render(page, shot.size, shot.cam, { frames: 5, fov: shot.fov, fog: shot.fog });
    await sleep(+opts.settle * 1000);
    const png = await render(page, shot.size, shot.cam, { frames: 60, fov: shot.fov, fog: shot.fog });
    fs.mkdirSync(opts.out, { recursive: true });
    const file = path.join(opts.out, `${shot.name}.png`);
    fs.writeFileSync(file, shot.shade ? await shade(page, png) : png);
    if (shot.shade) fs.writeFileSync(path.join(opts.out, `${shot.name}-raw.png`), png);
    // Canvas PNGs are RGBA; the art wants plain RGB (python3 + Pillow).
    for (const f of [file, ...(shot.shade ? [path.join(opts.out, `${shot.name}-raw.png`)] : [])])
      execSync(`python3 -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[1], optimize=True)" ${JSON.stringify(f)}`);
    console.log(`${file}  ${execSync(`file -b ${JSON.stringify(file)}`).toString().trim()}`);
    if (errors.length) console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  let server = null;
  let base = opts.base;
  if (!base) {
    server = spawn('python3', [path.join(ROOT, 'tools/bf1942-models/serve_viewer.py'), String(opts.port)], { stdio: 'ignore' });
    base = `http://localhost:${opts.port}`;
  }
  try {
    await waitForServer(base);
    for (let i = 0; i < 240 && headless(); i++) {
      if (i === 0) console.error('another headless Chromium is running; waiting');
      await sleep(5000);
    }
    if (headless()) throw new Error('another headless Chromium is still running');
    const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] });
    try {
      if (opts.probe) {
        for (const level of opts.probe.split(',')) await probe(browser, base, level);
      } else {
        const only = opts.only ? opts.only.split(',') : null;
        for (const shot of SHOTS) if (!only || only.includes(shot.name)) await shoot(browser, base, shot);
      }
    } finally {
      await browser.close();
    }
  } finally {
    server?.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
