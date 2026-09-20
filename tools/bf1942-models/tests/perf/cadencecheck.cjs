#!/usr/bin/env node
// Frame-cadence check for the map page: does what the player sees move on
// EVERY frame, or only on the frames the 30 Hz simulation happened to tick?
//
// Not a pytest, for `perfbench.cjs`'s reasons, plus one of its own: this is a
// real-time pacing measurement, so it needs a window. Headless Chromium and
// the hidden preview pane do not tick `requestAnimationFrame` usefully and
// every count below would be noise.
//
//   node cadencecheck.cjs --base http://localhost:5573
//   node cadencecheck.cjs --base http://localhost:5573 --only foot-zoom-pan
//   node cadencecheck.cjs --base http://localhost:5573 --uncap
//
// WHAT IT IS MEASURING. The world ticks at 30 Hz (world.js, THE TICK LAW).
// A 60 Hz display therefore ticks on every other frame, and a page that drew
// raw tick state showed the player a new pose on half its frames and a
// repeat on the rest — a 30 Hz slideshow inside a 60 fps render, which reads
// as "the frame rate feels bad" and is not a renderer problem at all. Each
// scenario below pans, walks, flies or drives at a steady rate for `--frames`
// rendered frames and counts:
//
//   * `movedPct` — the share of frames on which the measured quantity (the
//     camera's rotation, or its world position) changed at all. 100% is a
//     page drawing its own instant; ~50% is a page drawing the last tick.
//   * `cv` — the coefficient of variation of the per-frame steps, zeros
//     included. A smooth pan is a small number; a page alternating a step
//     with a stall sits near or above 1.0 whatever its mean.
//
// A scenario fails when `movedPct` is below `--min` (95 by default). The
// steps themselves are printed so an uneven-but-moving result can be read
// rather than guessed at.
//
// THE HAND. Every panning scenario feeds `__lookDelta` once per rendered
// frame from inside the measuring loop, which is what pointer lock actually
// delivers: the browser coalesces pointer motion and hands the page one
// mousemove per frame. Feeding it off a timer instead measures the timer's
// jitter — under load a `setInterval(4)` misses frames and the check reads
// the miss as a stall.
//
// Exit status 0 all scenarios pass, 1 one or more fail, 2 a scenario could
// not be staged (no such vehicle, the spawn refused, the page threw).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Playwright out of `ui/node_modules`, the main checkout's when run from a
// worktree; PLAYWRIGHT_MODULES overrides both. Same as `leakcheck.cjs`.
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
  base: 'http://localhost:5573', mod: 'bf1942', map: 'Wake',
  flag: 'The_Airfield',
  width: 1280, height: 800,
  frames: 180, settle: 1000, min: 95,
  pan: 3,                 // pixels of pointer motion per rendered frame
  only: null, uncap: false, out: null,
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

// --- the in-page measurement ------------------------------------------------
//
// Injected once and called per scenario. Kept in one string so the page-side
// half reads as one function rather than as a dozen `page.evaluate` closures.
const MEASURE = ({ frames, pan, panY, sweep, sample }) => new Promise(resolve => {
  const cam = window.__camera;
  const THREE = window.__THREE;
  const q = new THREE.Quaternion(), lastQ = new THREE.Quaternion();
  const p = new THREE.Vector3(), lastP = new THREE.Vector3();
  const rotSteps = [], posSteps = [];
  let n = 0, rotated = 0, moved = 0;
  const tick = () => {
    // The hand: one frame's worth of pointer travel, delivered the way
    // pointer lock delivers it. `sweep` reverses it every so many frames, for
    // a rig with a traverse stop it would otherwise pan into and sit against.
    const dir = sweep ? (Math.floor(n / sweep) % 2 ? -1 : 1) : 1;
    if (pan || panY) window.__lookDelta(dir * (pan || 0), dir * (panY || 0));
    cam.getWorldQuaternion(q);
    cam.getWorldPosition(p);
    if (n) {
      const deg = q.angleTo(lastQ) * 180 / Math.PI;
      const dist = p.distanceTo(lastP);
      if (deg > 1e-6) rotated++;
      if (dist > 1e-6) moved++;
      rotSteps.push(+deg.toFixed(4));
      posSteps.push(+dist.toFixed(4));
    }
    lastQ.copy(q);
    lastP.copy(p);
    if (++n <= frames) requestAnimationFrame(tick);
    else resolve({
      frames: n - 1,
      framesRotated: rotated,
      framesMoved: moved,
      rotSteps, posSteps,
      sample,
    });
  };
  requestAnimationFrame(tick);
});

function stats(steps) {
  if (!steps.length) return { mean: 0, cv: 0 };
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  if (!mean) return { mean: 0, cv: 0 };
  const varc = steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length;
  return { mean: +mean.toFixed(4), cv: +(Math.sqrt(varc) / mean).toFixed(3) };
}

// --- staging ----------------------------------------------------------------

async function spawnOnFoot(page) {
  const ok = await page.evaluate(flag => {
    window.__setOnFoot(true);
    window.__deploy.select(flag);
    return window.__deploy.spawn();
  }, opts.flag);
  if (ok === false) throw new StagingError(`deploy refused flag ${opts.flag}`);
  await page.waitForFunction(() => window.__handWeapon()?.viewmodel, null, { timeout: 30000 })
    .catch(() => { /* a weapon without a viewmodel still aims */ });
  await sleep(2500);
  // `captured`: the page only accepts steering and pointer input once the fly
  // gate has been taken, and a headless-driven window never clicks it.
  await page.evaluate(() => window.__setFly(true));
}

async function enterNamed(page, pattern) {
  // `__enterOwner` reports `car || aircraft`, so a bare gun/seat root — a
  // Defgun, an AA mount — answers false even when the seat was taken. The
  // gun lists are the honest signal for one: entry collects them.
  const res = await page.evaluate(async re => {
    const match = new RegExp(re, 'i');
    const v = window.__vehicles().find(x => match.test(x.name));
    if (!v) return { err: 'no such vehicle', names: window.__vehicles().map(x => x.name) };
    const drivable = window.__enterOwner(v.owner);
    await window.__cockpitReady();
    const groups = window.__gunGroups();
    return { ok: drivable || groups.manned > 0 || groups.vehicle > 0, name: v.name, groups };
  }, pattern);
  if (res.err || !res.ok) {
    throw new StagingError(`${pattern}: ${res.err || 'entry refused'}`);
  }
  await sleep(1500);
  return res.name;
}

/**
 * Point the soldier somewhere he can actually walk.
 *
 * A body standing still against a wall is standing still for an honest
 * reason, and the cadence counters cannot tell that apart from a stutter —
 * so the walking scenario has to start facing open ground. Probe by walking
 * briefly and reading the body's own `blocked`/`speed`, and turn a chunk of
 * a circle between tries. Returns the yaw that worked, or null.
 */
async function faceClear(page, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const from = await page.evaluate(() => window.__walkState());
    const state = await page.evaluate(async () => {
      window.__keys.add('KeyW');
      await new Promise(r => setTimeout(r, 1200));
      const s = window.__walkState();
      window.__keys.delete('KeyW');
      return { blocked: s?.blocked, speed: s?.speed ?? 0, yaw: s?.yaw ?? 0,
               x: s?.x ?? 0, z: s?.z ?? 0 };
    });
    // Not "did he start moving" but "did he keep moving": a body that takes
    // two steps and then leans on a wall passes the first test and fails the
    // measurement, which is the trap that made this helper necessary.
    const travelled = Math.hypot(state.x - (from?.x ?? 0), state.z - (from?.z ?? 0));
    if (!state.blocked && state.speed > 0.5 && travelled > 2) return state.yaw;
    // ~45 degrees of turn: the axis saturates at the wire's +-16, which is
    // 48 degrees on one tick, so one batch of counts is about an eighth turn.
    await page.evaluate(() => window.__lookDelta(400, 0));
    await sleep(200);
  }
  return null;
}

/** Stand the soldier on open ground: an aircraft's own parking spot, a few
 *  metres to one side. A flag's soldier spawn can be inside a bunker, and a
 *  body that walks into its wall reads here as a stutter. */
async function standOnOpenGround(page) {
  const placed = await page.evaluate(() => {
    const plane = window.__vehicles().find(v => /corsair|zero|sbd/i.test(v.name));
    if (!plane?.pos) return false;
    return window.__teleport(plane.pos[0] + 10, plane.pos[1] + 1, plane.pos[2], 0);
  });
  if (!placed) throw new StagingError('no aircraft to stand beside');
  await sleep(600);
}

async function resetFoot(page) {
  await page.evaluate(() => {
    window.__setAim(false);
    window.__setTrigger(false);
    window.__keys.delete('KeyW');
  });
}

// Every scenario: stage it, let it settle, measure, and say which number
// decides the verdict.
const SCENARIOS = [
  {
    name: 'foot-hip-pan',
    what: 'standing, hip, panning — the view must turn every frame',
    metric: 'rotated',
    async stage(page) { await resetFoot(page); },
    measure: { pan: opts.pan },
  },
  {
    name: 'foot-zoom-pan',
    what: 'standing, aiming down the sight, panning — the case the player reported',
    metric: 'rotated',
    async stage(page) { await resetFoot(page); await page.evaluate(() => window.__setAim(true)); },
    measure: { pan: opts.pan },
  },
  {
    name: 'foot-prone-zoom-fire-pan',
    what: 'prone, aiming, holding the trigger, panning',
    metric: 'rotated',
    async stage(page) {
      await resetFoot(page);
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
        window.__setAim(true);
        window.__setTrigger(true);
      });
      await sleep(1200);
    },
    async after(page) {
      await page.evaluate(() => {
        window.__setTrigger(false);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
      });
      await sleep(400);
    },
    measure: { pan: opts.pan },
  },
  {
    name: 'foot-walk',
    what: 'walking forward — the eye must move every frame',
    metric: 'moved',
    // Re-spawn first. Several hundred frames of panning have left the soldier
    // facing wherever the pan stopped, and a body walking into the airfield's
    // wall stands still for honest reasons — which would read here as a
    // pacing failure. A spawn puts him back on the pad facing the way the
    // level author pointed him.
    async stage(page) {
      await resetFoot(page);
      await standOnOpenGround(page);
      if (await faceClear(page) === null) {
        throw new StagingError('nowhere to walk from this spot');
      }
      await page.evaluate(() => window.__keys.add('KeyW'));
    },
    async after(page) { await page.evaluate(() => window.__keys.delete('KeyW')); },
    // Blocked means "he hit something", not "the page stuttered"; say so
    // rather than letting the verdict imply the wrong thing.
    async note(page) {
      const s = await page.evaluate(() => window.__walkState());
      return { blocked: !!s?.blocked, speed: +(s?.speed ?? 0).toFixed(3) };
    },
    measure: {},
  },
  {
    name: 'plane-cockpit',
    what: 'a Corsair in level flight — the cockpit eye must move every frame',
    metric: 'moved',
    async stage(page) {
      await resetFoot(page);
      await enterNamed(page, '^(corsair|zero)');
      await page.evaluate(async () => {
        const pl = window.__plane();
        const s = pl.state().position;
        pl.place(s.x, s.y + 150, s.z, 0, 0, -60);
        window.__keys.add('KeyW');
      });
      await sleep(1200);
    },
    async after(page) { await page.evaluate(() => window.__keys.delete('KeyW')); },
    measure: {},
  },
  {
    name: 'car-drive',
    what: 'a Willys under power — the driver eye must move every frame',
    metric: 'moved',
    async stage(page) {
      await enterNamed(page, '^Willy');
      await page.evaluate(() => {
        const car = window.__drive();
        const s = car.state().position;
        window.__placeCar(s.x, s.z, 0, 8);
        window.__keys.add('KeyW');
      });
      await sleep(1500);
    },
    async after(page) { await page.evaluate(() => window.__keys.delete('KeyW')); },
    measure: {},
  },
  {
    name: 'tank-turret-pan',
    what: 'a Sherman tower traversing — the gunner eye must turn every frame',
    metric: 'rotated',
    async stage(page) {
      await enterNamed(page, '^Sherman');
      await sleep(800);
    },
    measure: { pan: opts.pan * 2 },
  },
  {
    name: 'gun-turret-pan',
    what: 'a Defgun traversing — the gunner eye must turn every frame',
    metric: 'rotated',
    async stage(page) {
      await enterNamed(page, '^Defgun');
      await sleep(800);
    },
    // A coastal gun has a traverse stop and a one-way pan of this length
    // reaches it; sweep so the measurement is of the servo moving and not of
    // the gun sitting against its own limit. The direction change costs the
    // one frame the servo spends crossing zero.
    measure: { pan: opts.pan * 2, sweep: 45 },
  },
];

// --- driving ----------------------------------------------------------------

async function main() {
  const browser = await chromium.launch({
    headless: false,                       // real-time pacing needs a window
    args: [
      '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required',
      ...(opts.uncap ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
    ],
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

  const url = `${opts.base}/map.html?mod=${opts.mod}&map=${opts.map}&shots&nopreserve`;
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__renderOnce && window.__deploy && window.__scene,
    null, { timeout: 300000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(3000);
  await spawnOnFoot(page);

  const wanted = opts.only
    ? SCENARIOS.filter(s => s.name === opts.only)
    : SCENARIOS;
  if (!wanted.length) throw new StagingError(`no scenario named ${opts.only}`);

  const results = [];
  let failed = 0;
  for (const scenario of wanted) {
    await scenario.stage(page);
    await sleep(opts.settle);
    const raw = await page.evaluate(MEASURE, {
      frames: opts.frames,
      pan: scenario.measure.pan || 0,
      panY: scenario.measure.panY || 0,
      sweep: scenario.measure.sweep || 0,
      sample: scenario.metric,
    });
    const note = await scenario.note?.(page);
    await scenario.after?.(page);
    const steps = scenario.metric === 'rotated' ? raw.rotSteps : raw.posSteps;
    const hit = scenario.metric === 'rotated' ? raw.framesRotated : raw.framesMoved;
    const pct = +(100 * hit / raw.frames).toFixed(1);
    const { mean, cv } = stats(steps);
    const pass = pct >= opts.min;
    if (!pass) failed++;
    const record = {
      scenario: scenario.name, what: scenario.what,
      metric: scenario.metric, frames: raw.frames,
      framesChanged: hit, movedPct: pct, min: opts.min,
      meanStep: mean, cv,
      steps: steps.slice(40, 64),
      ...(note ? { note } : {}),
      pass,
    };
    results.push(record);
    console.log(JSON.stringify(record));
  }

  const drift = await page.evaluate(() => window.__matrixDrift());
  console.log(JSON.stringify({ matrixDrift: drift }));
  if (errors.length) console.log(JSON.stringify({ pageErrors: errors }));
  const summary = {
    summary: true, base: opts.base, uncap: !!opts.uncap,
    loadavg: fs.readFileSync('/proc/loadavg', 'utf8').trim(),
    scenarios: results.length, failed,
  };
  console.log(JSON.stringify(summary));
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ summary, results, drift }, null, 2));
  return failed ? 1 : 0;
}

main().then(code => process.exit(code)).catch(e => {
  console.error(e instanceof StagingError ? `staging: ${e.message}` : e);
  process.exit(e instanceof StagingError ? 2 : 2);
});
