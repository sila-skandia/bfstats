// The shared half of the short map.html probes (fprigprobe, lodblack,
// fogprobe, levelpaint, botgunsound): one headless Chromium on Vulkan ANGLE
// with the default autoplay policy, a level loaded with `&shots=1`, READY
// pressed from inside the page, frames stepped with `__renderOnce`, and the
// browser closed however the probe ends. Run a probe under
// `flock -x /tmp/claude-1000/chromium.lock` when other agents share the PC.
const fs = require('node:fs');
const path = require('node:path');

function modulesDir() {
  if (process.env.PLAYWRIGHT_MODULES) return process.env.PLAYWRIGHT_MODULES;
  for (let dir = __dirname; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const ui = path.join(dir, 'ui', 'node_modules');
    if (fs.existsSync(path.join(ui, 'playwright'))) return ui;
  }
  throw new Error('no ui/node_modules/playwright above this file; set PLAYWRIGHT_MODULES');
}

/** `--key value` pairs over `defaults`; a key whose default is `false` is a bare flag. */
function parseArgs(defaults, argv = process.argv.slice(2)) {
  const opts = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (!(k in opts)) throw new Error(`unknown --${k}`);
    if (opts[k] === false) { opts[k] = true; continue; }
    const v = argv[++i];
    opts[k] = typeof opts[k] === 'number' ? Number(v) : v;
  }
  return opts;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Run `body(probe)` against one browser and close it. `probe` carries the
 * page, `open(url params)`, `step(n)`, `ev(fn, arg)`, `spawn(...)` and the
 * page errors seen so far. `init` is an addInitScript function.
 */
async function withPage({ base, w = 1280, h = 800, init = null, headed = false, code = '' }, body) {
  const { chromium } = require(path.join(modulesDir(), 'playwright'));
  const browser = await chromium.launch({ headless: !headed, args: [
    ...(headed ? [] : ['--use-angle=vulkan', '--enable-features=Vulkan']), '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    if (init) await page.addInitScript(init);
    // `code`: another build's page and modules over this tree's assets, for a
    // before/after on identical data (the .js and .html fetched from there).
    if (code) {
      await page.route(/\.(m?js|html)(\?.*)?$/, route => {
        const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
        const file = path.join(code, rel);
        if (!fs.existsSync(file)) return route.continue();
        return route.fulfill({ body: fs.readFileSync(file), contentType: rel.endsWith('.html') ? 'text/html' : 'text/javascript' });
      });
    }
    await page.addInitScript(() => {
      window.__hw = () => { try { return window.__handWeapon ? window.__handWeapon() : null; } catch { return null; } };
    });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => {
      if (m.type() === 'error' && !/status of 404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300));
    });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const step = async (n, dt = 1 / 60) => {
      for (let left = n; left > 0; left -= 60) {
        await page.evaluate(([c, w, h, dt]) => { for (let i = 0; i < c; i++) window.__renderOnce(w, h, dt); },
          [Math.min(60, left), w, h, dt]);
      }
    };
    const probe = {
      page, ev, step, errors, w, h,
      /** Load `map.html?<params>&shots=1`, press READY, give the page its gesture. */
      async open(params) {
        const q = new URLSearchParams({ ...params, shots: '1' }).toString();
        await page.goto(`${base}/map.html?${q}`, { waitUntil: 'load', timeout: 300000 });
        await page.waitForFunction(() => window.__renderOnce && window.__deploy && window.__scene, null, { timeout: 300000 });
        // The briefing owns the keyboard until READY (`progress.js`
        // `briefingCaptures`), and a key test behind it reads "nothing
        // happened". It comes up only once the load's holds are in, after the
        // hooks: a READY pressed before then is undone when it does. So wait
        // for the overlay to reach the briefing, accept it there, and go on
        // once it is done (a load with no briefing goes straight to done).
        for (let i = 0; i < 240; i++) {
          const state = await page.evaluate(() => document.querySelector('.ld-overlay')?.dataset.state ?? 'done');
          if (state === 'briefing') await page.evaluate(() => document.querySelector('.ld-brief-btn')?.click());
          else if (state === 'done' || state === 'error') break;
          await sleep(250);
        }
        // A real click: the default autoplay policy only lets the audio
        // context run after a gesture, as a player's first click does.
        await page.mouse.click(5, 5).catch(() => {});
        await step(10);
      },
      /** On foot at the first live flag of `team` with kit row `kit`; 'ok' or why not. */
      async spawn(team = 1, kit = null) {
        await ev(() => window.__setOnFoot(true));
        await step(10);
        if (!await ev(() => window.__deploy.open)) {
          await ev(() => window.__damage?.(1e6));
          for (let i = 0; i < 40 && !await ev(() => window.__deploy.open); i++) await step(30);
        }
        const r = await ev(([team, kit]) => {
          const d = window.__deploy;
          if (!d.open) return 'deploy-closed';
          if (d.team !== team) d.setTeam(team);
          if (kit) d.setKit(kit);
          const f = d.flags.find(f => f.team === team && f.spawns > 0 && !f.inactive)
            || d.flags.find(f => f.spawns > 0 && !f.inactive);
          if (!f) return 'no-flag';
          d.select(f.name);
          return d.spawn() ? 'ok' : 'refused';
        }, [team, kit]);
        if (r === 'ok') await step(40);
        return r;
      },
      /** Wait until `__hw()` has a rig and its deploy clip is done. */
      async settleWeapon(name = null, frames = 600) {
        for (let i = 0; i < frames; i += 20) {
          const hw = await ev(() => window.__hw());
          if (hw?.hasGroup && hw.viewmodel && (!name || hw.name === name) && hw.clip && !/deploy/i.test(hw.clip)) return hw;
          await step(20);
          await sleep(50);
        }
        return ev(() => window.__hw());
      },
      /** The WebGL canvas as a JPEG file. */
      async capture(file) {
        const url = await ev(() => window.__renderer.domElement.toDataURL('image/jpeg', 0.85));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
        return file;
      },
    };
    return await body(probe);
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { parseArgs, withPage, sleep, modulesDir };
