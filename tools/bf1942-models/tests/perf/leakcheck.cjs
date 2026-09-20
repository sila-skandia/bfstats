#!/usr/bin/env node
// GPU-resource leak check for the map page's enter/exit cycle.
//
// Not a pytest, for `perfbench.cjs`'s reasons: it needs a static server in
// front of `viewer/` and the extracted assets behind it.
//
//   node leakcheck.cjs --base http://localhost:5573
//   node leakcheck.cjs --software --cycles 4          # SwiftShader, no GPU
//   node leakcheck.cjs --map Wake --vehicle '^Corsair'
//
// Spawns on foot, stands the soldier beside a vehicle, and walks the real E
// key in and out of it: `--warm` cycles first, which are allowed to cost
// whatever a first entry costs (the cockpit glb, its programs, a lazily
// uploaded effect pool), then `--cycles` counted ones. `renderer.info.memory`
// is sampled after every exit, always from OUTSIDE the vehicle, so the samples
// are comparable. Each entry waits on `__cockpitReady()` and then draws the
// cockpit view, so an interior's textures and geometries land in the cycle
// that asked for them rather than in whichever one the fetch finishes in.
//
// A leak is a slope, so that is what fails: a count that ends at least one
// resource per counted cycle above where it started. A pool that uploads one
// mesh late is a step, not a slope, and passes. Whenever a count moved at all
// the check names what the counted cycles uploaded and never gave back — every
// geometry and texture the renderer adopts gets a `dispose` listener, and the
// hook below is on that.
//
// What it caught first: `Vehicle` fetched and grafted `<Control>.cockpit.glb`
// once per instance, and map.html builds an instance per entry — 6 geometries
// and 4 textures per Willys cycle (`cockpitGrafts`, flight.js).
//
// Exit status 0 flat, 1 climbing, 2 the run could not be staged.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Playwright out of `ui/node_modules`, the main checkout's when run from a
// worktree; PLAYWRIGHT_MODULES overrides both. Same as `perfbench.cjs`.
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
function modulesDir() {
  const candidates = [process.env.PLAYWRIGHT_MODULES, path.join(ROOT, 'ui', 'node_modules')];
  try {
    const common = execSync('git rev-parse --git-common-dir', { cwd: ROOT, encoding: 'utf8' }).trim();
    candidates.push(path.join(path.resolve(ROOT, common), '..', 'ui', 'node_modules'));
  } catch { /* not a git checkout; the explicit candidates stand */ }
  const found = candidates.find(c => c && fs.existsSync(path.join(c, 'playwright')));
  if (!found) throw new Error(`playwright not found under ${candidates.filter(Boolean).join(', ')}`);
  return found;
}
const { chromium } = require(path.join(modulesDir(), 'playwright'));

const opts = {
  base: 'http://localhost:5573', mod: 'bf1942', map: 'wake',
  vehicle: '^Willy', warm: 2, cycles: 5,
  width: 640, height: 400, software: false, headed: false, out: null,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opts[key] = true;
  else { opts[key] = Number.isNaN(Number(next)) ? next : Number(next); i++; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class StagingError extends Error {}

async function main() {
  const gl = opts.software
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : opts.headed ? [] : ['--use-angle=vulkan', '--enable-features=Vulkan'];
  const browser = await chromium.launch({
    headless: !opts.headed,
    args: [...gl, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    return await run(browser);
  } finally {
    await browser.close();
  }
}

async function run(browser) {
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Frames are stepped, never waited for: a hidden tab's loop does not tick.
  // Batches of ten because SwiftShader drops the context on a long tight
  // loop through the viewmodel's near pass.
  const step = async frames => {
    for (let left = frames; left > 0; left -= 10) {
      await page.evaluate(([n, w, h]) => {
        for (let i = 0; i < n; i++) window.__renderOnce(w, h);
      }, [Math.min(10, left), opts.width, opts.height]);
    }
  };
  const stepUntil = async (predicate, arg, frames = 120) => {
    for (let done = 0; done < frames; done += 5) {
      if (await page.evaluate(predicate, arg)) return true;
      await step(5);
    }
    return page.evaluate(predicate, arg);
  };

  const url = `${opts.base}/map.html?mod=${opts.mod}&map=${opts.map}&shots`;
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__renderOnce && window.__deploy && window.__scene,
    null, { timeout: 300000 });
  await page.waitForLoadState('networkidle', { timeout: 300000 }).catch(() => {});

  await step(10);
  await page.evaluate(() => window.__setOnFoot(true));
  await step(10);
  if (!await page.evaluate(() => window.__deploy.spawn())) throw new StagingError('the deploy screen refused to spawn');
  await page.waitForFunction(() => window.__handWeapon()?.viewmodel, null, { timeout: 60000 })
    .catch(() => { /* a kit with no arms rig still walks up to a jeep */ });
  await step(30);

  const owner = await page.evaluate(pattern => {
    const wanted = new RegExp(pattern, 'i');
    return window.__vehicles().find(v => wanted.test(v.name) && !v.destroyed && v.pos)?.owner ?? null;
  }, String(opts.vehicle));
  if (owner === null) throw new StagingError(`no vehicle matching ${opts.vehicle} on ${opts.map}`);

  // Every geometry and texture the renderer adopts gets a `dispose` listener
  // from it; that registration is the upload, and the event is the release.
  await page.evaluate(() => {
    const THREE = window.__THREE;
    const live = window.__leakLive = { geometries: new Map(), textures: new Map() };
    window.__leakCycle = null;
    const hook = (proto, bucket) => {
      const add = proto.addEventListener;
      proto.addEventListener = function (type, listener) {
        if (type === 'dispose' && !bucket.has(this)) {
          bucket.set(this, window.__leakCycle);
          add.call(this, 'dispose', () => bucket.delete(this));
        }
        return add.call(this, type, listener);
      };
    };
    hook(THREE.BufferGeometry.prototype, live.geometries);
    hook(THREE.Texture.prototype, live.textures);
  });

  // `captured` is what pointer lock would have set; headless Chromium does
  // not grant one, and E is refused without it.
  await page.evaluate(() => window.__setFly(true));
  const pressE = () => page.evaluate(() => {
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' }));
  });
  const seated = () => page.evaluate(() => document.querySelector('#pilot').checked);
  const SEAT_COOLDOWN_MS = 1100;   // `SEAT_TOGGLE_COOLDOWN_MS`, real time

  const samples = [];
  const started = Date.now();
  const total = opts.warm + opts.cycles;
  for (let cycle = 0; cycle < total; cycle++) {
    const counted = cycle >= opts.warm;
    await page.evaluate(([id, mark]) => {
      window.__leakCycle = mark;
      // Where it stands now, not where it spawned: once driven it is a body
      // on its own springs and settles a little every time it is parked.
      const at = window.__vehicles().find(v => v.owner === id).pos;
      window.__teleport(at[0] - 1.6, at[1] + 1, at[2], 0);
    }, [owner, counted ? cycle - opts.warm : null]);
    if (!await stepUntil(() => !!window.__nearEntry())) {
      throw new StagingError(`cycle ${cycle}: no entry point in reach beside owner ${owner}`);
    }

    await pressE();
    if (!await seated()) throw new StagingError(`cycle ${cycle}: E did not seat the soldier`);
    const interior = await page.evaluate(() => window.__cockpitReady());
    await step(20);                      // the cockpit view, interior drawn
    await sleep(SEAT_COOLDOWN_MS);

    await pressE();
    if (await seated()) throw new StagingError(`cycle ${cycle}: E did not leave the vehicle`);
    await step(20);                      // on foot again, arms back up
    const memory = await page.evaluate(() => ({ ...window.__renderer.info.memory }));
    samples.push({ cycle, counted, interior, ...memory, seconds: Math.round((Date.now() - started) / 1000) });
    console.log(JSON.stringify(samples[samples.length - 1]));
    await sleep(SEAT_COOLDOWN_MS);
  }

  // The baseline is the last warm sample, so `--cycles` n means n differences.
  const window_ = samples.slice(Math.max(0, opts.warm - 1));
  const growth = kind => window_[window_.length - 1][kind] - window_[0][kind];
  const result = {
    vehicle: opts.vehicle, owner, warm: opts.warm, cycles: opts.cycles,
    geometries: window_.map(s => s.geometries), textures: window_.map(s => s.textures),
    growth: { geometries: growth('geometries'), textures: growth('textures') },
    pageErrors: errors,
  };
  result.leaking = ['geometries', 'textures'].filter(kind => result.growth[kind] >= opts.cycles);

  if (result.growth.geometries > 0 || result.growth.textures > 0) {
    // What the counted cycles uploaded and nothing has released, by where it
    // hangs in the scene — or that it hangs nowhere, which is its own answer.
    // Listed for a step as well as for a slope: `pooled` is effects.js's own
    // mark on a mesh it will reuse, which is what a step usually turns out to
    // be (a flipbook sprite clones its quad per pooled instance, so the pool
    // growing to a new peak is one geometry).
    result.survivors = await page.evaluate(() => {
      const where = new Map();
      const pathOf = obj => {
        const names = [];
        for (let n = obj; n; n = n.parent) names.push(n.name || n.type);
        return names.reverse().join('/');
      };
      const pooled = new Set();
      window.__scene.traverse(obj => {
        if (obj.geometry) where.set(obj.geometry, pathOf(obj));
        if (obj.geometry && obj.userData?.poolKey) pooled.add(obj.geometry);
        for (const material of [obj.material].flat().filter(Boolean)) {
          for (const [slot, value] of Object.entries(material)) {
            if (value?.isTexture) where.set(value, `${pathOf(obj)} .${slot}`);
          }
        }
      });
      const list = bucket => [...bucket]
        .filter(([, cycle]) => cycle !== null)
        .map(([resource, cycle]) => ({
          cycle,
          name: resource.name || resource.type || resource.constructor.name,
          at: where.get(resource) || '(not in the scene)',
          pooled: pooled.has(resource),
        }));
      return {
        geometries: list(window.__leakLive.geometries),
        textures: list(window.__leakLive.textures),
      };
    });
  }

  console.log(JSON.stringify(result, null, 2));
  if (opts.out) fs.writeFileSync(opts.out, `${JSON.stringify({ ...result, samples }, null, 2)}\n`);
  if (result.leaking.length) {
    console.error(`LEAK: ${result.leaking.join(' and ')} climbed across ${opts.cycles} warm enter/exit cycles`);
    return 1;
  }
  console.log(`flat: ${opts.cycles} warm enter/exit cycles, geometries ${result.growth.geometries >= 0 ? '+' : ''}${result.growth.geometries}, textures ${result.growth.textures >= 0 ? '+' : ''}${result.growth.textures}`);
  return 0;
}

main().then(
  code => process.exit(code),
  error => {
    console.error(error instanceof StagingError ? `could not stage the run: ${error.message}` : error);
    process.exit(2);
  },
);
