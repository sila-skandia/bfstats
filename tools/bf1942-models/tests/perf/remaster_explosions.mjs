// Frame times while things blow up in remaster mode (features/remaster-browser).
//
// The owner's report (2026-11-13): "very laggy at key moments, when I shoot
// something that explodes". The frame that first draws an effect's sprites,
// a destroyed vehicle's flying parts or its wreck needed pipelines nothing
// had built, and waited for them. This opens a level in headless Google
// Chrome (WebGPU on the Mac's GPU), destroys one vehicle of each kind in
// view of the free camera, then a second of the first few kinds, then plays
// every explosion effect in the library, and prints the longest frame after
// each. Last, it spawns on foot and throws what the kit throws (a grenade,
// an explosives pack): a round cloned out of the hand rig once carried the
// rig's material into the world, the sun's shadow pass threw on it, and the
// picture stopped while the game ran on ("when I throw a grenade the game
// hangs", the owner, 2026-11-13). A frame that throws is a failure here.
//
//   node tests/perf/remaster_explosions.mjs --base http://localhost:5273 \
//        [--map wake] [--modes 'remaster=syncpipes;remaster'] [--settle 15000]
//
// Each mode gets a `pipelineSalt` of its own (remaster-sky.js): macOS keeps
// compiled shaders between runs, so without it only the first run of a
// build ever pays for a pipeline and every later one reads as fixed.
// `remaster=syncpipes` is the behaviour before the fix.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(path.resolve(here, '../../../../ui/node_modules/playwright/index.mjs'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const base = opt('base', 'http://localhost:5273');
const map = opt('map', 'wake');
const modes = opt('modes', 'remaster=syncpipes;remaster').split(';');
const settle = Number(opt('settle', 15000));

const browser = await chromium.launch({
  channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
let failed = false;
for (const mode of modes) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  // The page's frame loop catches what a frame throws and logs it once.
  page.on('console', m => { if (m.type() === 'error' && /frame threw/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  const salt = Math.floor(Math.random() * 1e6) + 1;
  await page.goto(`${base}/map.html?map=${map}&${mode}&shots=1&mute&pipelineSalt=${salt}`, { timeout: 180000 });
  await page.waitForFunction(() => window.__vehicles && window.__camera && window.__renderer, null, { timeout: 180000 });
  await page.waitForTimeout(settle);
  const result = await page.evaluate(async () => {
    const cam = window.__camera;
    const frame = () => new Promise(r => requestAnimationFrame(r));
    const lookFrom = at => {
      cam.position.set(at[0] + 25, at[1] + 6, at[2] + 25);
      cam.lookAt(at[0], at[1] + 1, at[2]);
      cam.updateMatrixWorld();
    };
    // 30 frames looking, the event, then `n - 30` frames: the longest of those.
    const run = async (n, at, fire) => {
      const gaps = [];
      let last = performance.now();
      for (let i = 0; i < n; i++) {
        lookFrom(at);
        if (i === 30) fire();
        await frame();
        const t = performance.now();
        gaps.push(t - last);
        last = t;
      }
      const after = gaps.slice(30);
      return { worst: Math.round(Math.max(...after)), over50: after.filter(g => g > 50).length };
    };
    const alive = () => window.__vehicles().filter(v => v.pos && v.hp > 0 && !v.absent);
    const firstOfKind = list => {
      const kinds = new Map();
      for (const v of list) if (!kinds.has(v.template || v.name)) kinds.set(v.template || v.name, v);
      return kinds;
    };
    const out = { first: [], second: [], effects: [] };
    const first = firstOfKind(alive());
    for (const [name, v] of [...first].slice(0, 8)) {
      for (let i = 0; i < 40; i++) { lookFrom(v.pos); await frame(); }
      out.first.push({ name, ...(await run(210, v.pos, () => window.__damageVehicle(v.owner, 1e6))) });
    }
    const second = firstOfKind(alive().filter(v => first.has(v.template || v.name)));
    for (const [name, v] of [...second].slice(0, 4)) {
      for (let i = 0; i < 40; i++) { lookFrom(v.pos); await frame(); }
      out.second.push({ name, ...(await run(210, v.pos, () => window.__damageVehicle(v.owner, 1e6))) });
    }
    const names = (window.__effectNames?.() ?? []).filter(n => /expl|blast|bomb|grenade/i.test(n)).slice(0, 14);
    const spot = [cam.position.x + 60, cam.position.y, cam.position.z + 10];
    const ground = window.__groundAt?.(spot[0], spot[2]);
    if (Number.isFinite(ground)) spot[1] = ground;
    for (const name of names) {
      for (let i = 0; i < 20; i++) { lookFrom(spot); await frame(); }
      out.effects.push({ name, ...(await run(150, spot, () => window.__playEffect(name, spot))) });
    }
    // On foot: every kit slot thrown or fired once, and the frames after it.
    out.thrown = [];
    if (window.__setOnFoot && window.__deploy && window.__selectKitWeapon) {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      window.__setOnFoot(true); await wait(1500);
      const d = window.__deploy;
      d.select(d.flags.findIndex(f => f.side)); await wait(300); d.spawn(); await wait(7000);
      for (const slot of [3, 4, 5]) {
        window.__selectKitWeapon(slot); await wait(2500);
        const name = window.__handWeapon?.()?.name ?? null;
        if (!name || out.thrown.some(t => t.name === name)) continue;
        const gaps = [];
        let last = performance.now();
        window.__setTrigger(true);
        for (let i = 0; i < 240; i++) {
          if (i === 24) window.__setTrigger(false);
          await frame();
          const now = performance.now(); gaps.push(now - last); last = now;
        }
        out.thrown.push({ name, worst: Math.round(Math.max(...gaps)) });
      }
    }
    out.pipelines = window.__remaster?.asyncPipelines?.() ?? null;
    return out;
  });
  console.log(`== ${mode}`);
  for (const group of ['first', 'second', 'effects', 'thrown']) {
    const rows = result[group];
    const worst = rows.reduce((a, r) => (r.worst > a.worst ? r : a), { worst: 0, name: '-' });
    console.log(`${group.padEnd(8)} ${rows.length} events, worst frame ${worst.worst} ms (${worst.name}), `
      + `${rows.filter(r => r.over50).length} with a frame over 50 ms`);
    for (const r of rows.filter(r => r.worst > 60)) console.log(`           ${r.name}: ${r.worst} ms`);
  }
  if (result.pipelines) console.log(`pipelines built off the thread during play: ${result.pipelines.built}`);
  for (const e of errors) console.log(`page error: ${e}`);
  // The fixed mode holds every event under 100 ms; `syncpipes` is the
  // comparison and is allowed to be what it was.
  if (!/syncpipes/.test(mode) && [...result.first, ...result.second, ...result.effects].some(r => r.worst > 100)) failed = true;
  if (errors.length) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
