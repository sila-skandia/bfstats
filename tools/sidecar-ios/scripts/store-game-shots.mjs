#!/usr/bin/env node
// App Store screenshots of the iPhone app's in-game screen, rendered locally.
//
// The app (tools/sidecar-ios) shows play.bfstats.io/map.html fullscreen and
// landscape, status bar and home indicator hidden, safe areas ignored. This
// script renders the same page from this checkout with local bots and no
// server, at the two App Store iPhone sizes, in ONE headless Chromium:
//
//   6.9"  956x440 CSS px at 3x -> 2868x1320
//   6.3"  874x402 CSS px at 3x -> 2622x1206
//
// Each shot is a fresh page load of Wake Island (vanilla) on the US side with
// 12 bots: `map.html?mod=bf1942&map=wake&team=2&mode=Conquest&botCount=12&shots=1&dpr=3`.
// `team` puts the page in match mode (no site bar), `shots=1` installs the
// test hooks headless, and the touch controls come from the iPhone context
// (isMobile, hasTouch, an iPhone Safari UA: map.html `isTouchDevice`). The
// scene is staged through the hooks: READY, `__deploy` (kit, flag, spawn),
// `__teleport`, `__lookDelta`, `__botCtl` (enemy soldiers placed and frozen),
// `__enterOwner` + a tap on VIEW for the tank's chase view, `__setTrigger` for the
// shot, then the render loop is stopped so the frame holds for the capture.
//
// Run from the repo root (needs ui/node_modules/playwright and the local
// viewer assets under tools/bf1942-models/viewer/{maps,models}):
//
//   node tools/sidecar-ios/scripts/store-game-shots.mjs
//   node tools/sidecar-ios/scripts/store-game-shots.mjs --only 4 --sizes 6.9
//   node tools/sidecar-ios/scripts/store-game-shots.mjs --base http://localhost:5491
//
// Without --base it starts tools/bf1942-models/serve_viewer.py on --port
// (default 5491; never 5273, the owner's) and stops it at the end. It waits
// for any other headless Chromium to finish first (one at a time on this PC).
// Output: features/sidecar-ios-app/store/screenshots/<size>/<n>-in-game*.png.
// Look at every image before shipping it: bots are live and the sim is real.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, 'ui/node_modules/playwright'));

const opts = { base: '', port: 5491, only: '', sizes: '6.9,6.3', out: path.join(ROOT, 'features/sidecar-ios-app/store/screenshots') };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i].replace(/^--/, '');
  if (!(k in opts)) throw new Error(`unknown --${k}`);
  opts[k] = k === 'port' ? +argv[i + 1] : argv[i + 1];
}

const SIZES = { '6.9': { width: 956, height: 440 }, '6.3': { width: 874, height: 402 } };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// In-page helpers, installed after the hooks exist.
const HELPERS = () => {
  const world = () => window.__botCtl(window.__bots()[0].id).world;
  window.__go = (x, z, yaw) => { const y = world().groundHeight(x, z); window.__teleport(x, y + 0.05, z, yaw); return y; };
  // A bot taken out of the AI: out of any seat, never boarding, stood at
  // (x, z) facing yaw, its tick emptied so it holds the pose.
  window.__place = (id, x, z, yaw) => {
    const c = window.__botCtl(id); if (!c) return false;
    if (c.vehicle) { try { window.__botDismount(id); } catch (_) {} }
    Object.defineProperty(c, 'vehicleCandidates', { get: () => [], set() {}, configurable: true });
    Object.defineProperty(c, 'enterRequest', { get: () => null, set() {}, configurable: true });
    const w = c.world, y = w.groundHeight(x, z), p = w.player(c.playerId);
    if (!p?.soldier) return false;
    p.soldier.spawn(x, y, z, yaw); c.setPosition(x, y, z); c.route = null; c.onRespawn?.();
    c.tick = () => {};
    return true;
  };
  // Enemy (team 1, Japanese) bots, on foot first.
  window.__enemies = () => window.__bots().filter(b => b.team === 1).sort((a, b) => !!a.vehicle - !!b.vehicle).map(b => b.id);
  // Our side parked out of the way (South Base), out of any seat, so none
  // walks into frame with a nametag or shoots the staged enemies.
  window.__parkFriends = () => window.__bots().filter(b => b.team === 2)
    .forEach((b, i) => window.__place(b.id, 990 + (i % 4) * 3, -862 - Math.floor(i / 4) * 3, 0));
  // A point `d` m along C->T and `s` m to its right.
  window.__fwd = (C, T, d, s) => {
    const L = Math.hypot(T[0] - C[0], T[1] - C[1]), fx = (T[0] - C[0]) / L, fz = (T[1] - C[1]) / L;
    return [C[0] + fx * d + fz * s, C[1] + fz * d - fx * s];
  };
  // Pull the trigger and hold the frame `after` rendered frames past the first round.
  window.__fireAndHold = (after = 1, release = true) => new Promise(res => {
    const s0 = window.__handWeapon().shots; let n = -1;
    window.__setTrigger(true);
    const tick = () => {
      if (n < 0 && window.__handWeapon().shots > s0) n = 0;
      if (n >= 0 && n++ >= after) { window.__renderer.setAnimationLoop(null); if (release) window.__setTrigger(false); res(true); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};

// Each scene: the kit and flag to spawn on, then the staging in the page.
const SCENES = [
  {
    n: 4, file: '4-in-game.png', kit: 'assault', flag: 'Village',
    // Wake's village plateau, BAR up, a Japanese rifleman at the crosshair
    // and another to the left, a burst going out.
    stage: async page => {
      await page.evaluate(() => {
        const C = [1030, -1245], T = [1080, -1200];
        const yaw = Math.atan2(T[0] - C[0], T[1] - C[1]);
        const [a, b] = window.__enemies();
        window.__place(a, ...window.__fwd(C, T, 14, 1.2), yaw + Math.PI + 0.6);
        window.__place(b, ...window.__fwd(C, T, 21, -5.5), yaw + Math.PI - 0.5);
        window.__go(...C, yaw);
      });
      await sleep(1500); await page.evaluate(() => window.__parkFriends()); await sleep(1000);
      await page.evaluate(() => window.__fireAndHold(1));
    },
  },
  {
    n: 5, file: '5-in-game-bazooka.png', kit: 'antitank', flag: 'Landing_Beach',
    // The landing beach under the US flag: Japanese infantry coming up the
    // sand from the water, the bazooka shouldered at them. (The AI's
    // Daihatsus take ~10 minutes to beach, and a craft moved there by hand
    // floats wrong, so the boat is not in this one.)
    stage: async page => {
      await page.evaluate(() => {
        const C = [1146, -727], T = [1160, -702];
        const yaw = Math.atan2(T[0] - C[0], T[1] - C[1]);
        const e = window.__enemies();
        [[11, -2.5, 0.2], [15, 3, -0.3], [20, -7, 0.1], [24, 6, 0.4]].forEach(([d, s, dy], i) =>
          window.__place(e[i], ...window.__fwd(C, T, d, s), yaw + Math.PI + dy));
        window.__go(...C, yaw);
        window.__lookDelta(0, 40);
      });
      await sleep(2000); await page.evaluate(() => window.__parkFriends()); await sleep(1000);
      await page.evaluate(() => window.__renderer.setAnimationLoop(null));
    },
  },
  {
    n: 6, file: '6-in-game-vehicle.png', kit: 'assault', flag: 'Village',
    // The village Sherman in the chase view, a Japanese squad up the lane.
    stage: async page => {
      const ok = await page.evaluate(() => {
        const tank = window.__vehicles().filter(v => v.name.startsWith('Sherman') && !v.absent && !v.destroyed)
          .sort((a, b) => Math.hypot(a.pos[0] - 1059, a.pos[2] + 1223) - Math.hypot(b.pos[0] - 1059, b.pos[2] + 1223))[0];
        if (!tank) return false;
        window.__go(tank.pos[0] - 4, tank.pos[2] - 4, 0);
        return window.__enterOwner(tank.owner);
      });
      if (!ok) throw new Error('could not board the village Sherman');
      await sleep(3000);
      // The vehicle camera is the VIEW button's, not `__footView` (that is the
      // soldier's): tap it, as a thumb would, for the chase view.
      const view = await page.evaluate(() => {
        const r = document.getElementById('mobile-claw-view-btn').getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await page.touchscreen.tap(...view);
      await sleep(1500);
      // The pad faces +x down the lane to the flag; three Japanese up it.
      await page.evaluate(() => {
        const t = window.__vehicles().find(v => v.owner === window.__occupancy.rootId)?.pos ?? [1040, 110, -1227];
        const en = window.__enemies();
        window.__place(en[0], t[0] + 14, t[2] + 6.5, -Math.PI / 2 + 0.3);
        window.__place(en[1], t[0] + 18, t[2] - 5, -Math.PI / 2 - 0.4);
        window.__place(en[2], t[0] + 24, t[2] + 3, -Math.PI / 2);
      });
      await sleep(1500); await page.evaluate(() => window.__parkFriends()); await sleep(1000);
      await page.evaluate(() => window.__renderer.setAnimationLoop(null));
    },
  },
];

function headless() {
  try { return execSync("ps -eo pid,args | grep -E '[h]eadless_shell'").toString().trim().split('\n').filter(Boolean).length; } catch { return 0; }
}

async function waitForServer(base) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/map.html`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error(`viewer not answering at ${base}`);
}

async function shoot(browser, base, sizeName, scene) {
  const ctx = await browser.newContext({ viewport: SIZES[sizeName], deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    const url = `${base}/map.html?mod=bf1942&map=wake&team=2&mode=Conquest&botCount=12&botSkill=0.5&shots=1&dpr=3`;
    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction(() => document.querySelector('.ld-overlay')?.dataset.state === 'briefing', null, { timeout: 300000, polling: 1000 });
    await page.evaluate(() => document.querySelector('.ld-brief-btn').click());
    await page.waitForFunction(() => window.__deploy?.open && window.__bots?.().length >= 12, null, { timeout: 120000, polling: 500 });
    await page.evaluate(HELPERS);
    const spawned = await page.evaluate(([kit, flag]) => window.__deploy.setKit(kit) && window.__deploy.select(flag) !== false && window.__deploy.spawn(), [scene.kit, scene.flag]);
    if (!spawned) throw new Error(`spawn refused (${scene.kit} at ${scene.flag})`);
    await page.waitForFunction(() => !window.__deploy.open && window.__handWeapon()?.viewmodel && window.__handWeapon().clip === 'idle', null, { timeout: 60000, polling: 250 });
    await page.evaluate(() => window.__parkFriends());
    await scene.stage(page);
    const dir = path.join(opts.out, sizeName);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, scene.file);
    await page.screenshot({ path: file });
    if (process.env.SHOTS_DEBUG) {
      console.log(JSON.stringify(await page.evaluate(() => {
        const c = window.__camera.position;
        return window.__bots().map(b => ({ id: b.id, team: b.team, name: b.name, hp: b.hp, v: b.vehicle, pos: (b.pos || []).map(Math.round),
          d: b.pos ? Math.round(Math.hypot(b.pos[0] - c.x, b.pos[2] - c.z)) : null }));
      })));
    }
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
    for (let i = 0; i < 120 && headless(); i++) {
      if (i === 0) console.error('another headless Chromium is running; waiting');
      await sleep(5000);
    }
    if (headless()) throw new Error('another headless Chromium is still running');
    const browser = await chromium.launch({ headless: true, args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    try {
      const only = opts.only ? opts.only.split(',').map(Number) : null;
      for (const sizeName of opts.sizes.split(',')) {
        for (const scene of SCENES) {
          if (only && !only.includes(scene.n)) continue;
          await shoot(browser, base, sizeName, scene);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    server?.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
