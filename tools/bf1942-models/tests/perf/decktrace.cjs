#!/usr/bin/env node
// Traces a driven vehicle across a level's drivable decks: a bridge span, a
// repair/reload bay, a carrier deck.
//
// Not a pytest, for `leakcheck.cjs`'s reasons: it needs a static server in front
// of `viewer/` and the extracted level assets behind it.
//
//   cd tools/bf1942-models/viewer && python3 -m http.server 5573 --directory "$PWD" &
//   node decktrace.cjs --base http://localhost:5573 --map bocage
//   node decktrace.cjs --base http://localhost:5573 --map bocage --vehicle '^Willy'
//   node decktrace.cjs --base http://localhost:5573 --map wake --targets 'dock|deck'
//
// The run finds the level's drivable statics by name, stands the vehicle a run-up
// short of one on the heading that crosses it, and holds W through the REAL key
// path (`__keys.add('KeyW')` + `__renderOnce`), which is the only path a tracked
// hull moves down. Per tick it records where the hull is, what the ride surface
// under it is (terrain and deck separately, from the same reference the wheels
// pass), its pitch, and whether it is grounded.
//
// What the numbers are for: `y - surface` is the ride height, and it must hold
// within a few centimetres of the height the vehicle rides on flat ground, with
// no tick-to-tick jump the slope does not explain, no tick below the deck, and
// no airborne stretch on a level span.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  base: 'http://localhost:5573', mod: 'bf1942', map: 'bocage',
  vehicle: '^(Tiger|PanzerIV|Sherman)', targets: null,
  runUp: 26, ticks: 900, width: 480, height: 300,
  software: false, headed: false, out: null, list: false,
  // An explicit crossing, when the automatic one (the deck's long axis, from
  // `runUp` metres outside it) is not the line worth driving: `--start x,z`
  // plus `--yaw <radians>`, and `--zone x0,x1,z0,z1` for the stretch the
  // summary is taken over. A repair station wants this — half its box is the
  // workshop building standing on the pad, which is a wall and should be.
  start: null, yaw: null, zone: null, deck: null,
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opts[key] = true;
  else { opts[key] = Number.isNaN(Number(next)) ? next : Number(next); i++; }
}

const round = (v, p = 3) => (Number.isFinite(v) ? +v.toFixed(p) : v);

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

  const step = async frames => {
    for (let left = frames; left > 0; left -= 10) {
      await page.evaluate(([n, w, h]) => {
        for (let i = 0; i < n; i++) window.__renderOnce(w, h);
      }, [Math.min(10, left), opts.width, opts.height]);
    }
  };

  const url = `${opts.base}/map.html?mod=${opts.mod}&map=${opts.map}&shots`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 600000 });
  // The level is up when the scene and the placed vehicles are; `networkidle`
  // never settles on this page (ambient audio, lazily fetched effect pools), so
  // it gets a short grace period and no more.
  await page.waitForFunction(() => window.__renderOnce && window.__scene
    && window.__vehicles && window.__vehicles().length > 0,
    null, { timeout: 600000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await step(20);

  // Spawn on foot before taking a vehicle. The world consumes one buffered
  // input per PLAYER per tick, and there is no local player until the deploy
  // screen has spawned one — so a vehicle entered straight off the free camera
  // collects W and never spends it, and the trace comes back stationary.
  await page.evaluate(() => window.__setOnFoot(true));
  await step(10);
  if (!await page.evaluate(() => window.__deploy.spawn())) {
    throw new Error('the deploy screen refused to spawn');
  }
  await step(30);

  // Every drivable static in the level, by the same name rule `static-index.js`
  // uses, with the world box the trace needs to pick a crossing line.
  const decks = await page.evaluate(pattern => {
    const re = new RegExp(pattern, 'i');
    const out = [];
    const box = new window.__THREE.Box3();
    window.__scene.traverse(node => {
      if (!node.name || !re.test(node.name)) return;
      // Only placements, not the collision primitives inside them.
      if (/collision/i.test(node.name)) return;
      if (out.some(o => o.node === node.parent?.name)) return;
      box.setFromObject(node);
      if (!Number.isFinite(box.min.x)) return;
      out.push({
        node: node.name,
        min: [box.min.x, box.min.y, box.min.z].map(v => +v.toFixed(2)),
        max: [box.max.x, box.max.y, box.max.z].map(v => +v.toFixed(2)),
      });
    });
    return out;
    // Keep this in step with `DRIVABLE_TOP_RE` in `viewer/static-index.js`; this
    // file cannot import the module the page loads.
  }, String(opts.targets
    || 'bridge|repairpoint|repaircist|reloadbay|repairbay|repairstation|landrep|airrep|supplyde|bay|ramp|overpass|dock|flightdeck|freightdeck|hardsurface|deck'));

  if (opts.list) {
    console.log(JSON.stringify({ map: opts.map, decks }, null, 1));
    return 0;
  }
  if (!decks.length) throw new Error(`no drivable statics matching on ${opts.map}`);
  const nums = v => String(v).split(',').map(Number);

  // The vehicle: whichever placed one matches, nearest to the first deck.
  const chosen = await page.evaluate(([pattern, decksIn, only]) => {
    const want = new RegExp(pattern, 'i');
    const centre = d => [(d.min[0] + d.max[0]) / 2, (d.min[2] + d.max[2]) / 2];
    const best = { owner: null, deck: null, distance: Infinity };
    for (const v of window.__vehicles()) {
      if (!v.pos || v.destroyed || !want.test(v.name)) continue;
      for (const deck of decksIn) {
        if (only && deck.node !== only) continue;
        const [cx, cz] = centre(deck);
        const d = Math.hypot(v.pos[0] - cx, v.pos[2] - cz);
        if (d < best.distance) {
          best.distance = d;
          best.owner = v.owner; best.name = v.name; best.deck = deck;
        }
      }
    }
    return best;
  }, [String(opts.vehicle), decks, opts.deck ? String(opts.deck) : null]);
  if (chosen.owner === null) throw new Error(`no vehicle matching ${opts.vehicle} on ${opts.map}`);
  if (!await page.evaluate(o => window.__enterOwner(o), chosen.owner)) {
    throw new Error(`could not take owner ${chosen.owner} (${chosen.name})`);
  }
  await step(20);

  // Cross the deck along its LONG horizontal axis, starting `runUp` metres
  // outside it so the approach ramp is part of the run.
  const plan = await page.evaluate(([deck, runUp, startIn, yawIn]) => {
    const spanX = deck.max[0] - deck.min[0];
    const spanZ = deck.max[2] - deck.min[2];
    const alongX = spanX >= spanZ;
    const cx = (deck.min[0] + deck.max[0]) / 2;
    const cz = (deck.min[2] + deck.max[2]) / 2;
    // Heading: yaw 0 points -Z (the spawn heading), yaw -pi/2 points +X.
    const yaw = yawIn !== null ? yawIn : (alongX ? -Math.PI / 2 : 0);
    const start = startIn || (alongX ? [deck.min[0] - runUp, cz] : [cx, deck.max[2] + runUp]);
    const y = window.__drive().ground(start[0], start[1]).height;
    window.__drive().place(start[0], y + 1.2, start[1], yaw);
    return { alongX, yaw, start, startY: y };
  }, [chosen.deck, opts.runUp, opts.start ? nums(opts.start) : null,
      opts.yaw !== null ? Number(opts.yaw) : null]);
  await step(40);                      // let the springs settle before the run

  // A build from before the deck fix has neither the hull-sweep hook nor pitch
  // on the drive state nor a `deck` in the ground answer, and its `ground(x, z)`
  // already folds its own height raster in. Detecting that is what lets one tool
  // produce both halves of a before/after.
  const legacy = await page.evaluate(() => !window.__drive().sweep);
  if (legacy) console.error('# legacy build: no deck hooks, surface is its own raster');

  // The real key path: the only one a tracked hull moves down. `captured` is
  // what pointer lock would have set and the seated input branch reads it
  // (`held = captured ? keys : EMPTY_KEYS`); headless Chromium never grants a
  // lock, so `__setFly(true)` stands in for it, exactly as `leakcheck.cjs` does
  // for the E key. Without it W is collected and never spent, and the trace
  // comes back with a top speed of zero.
  await page.evaluate(() => { window.__setFly(true); window.__keys.add('KeyW'); });

  const trace = [];
  let stalled = false;
  const batch = 15;
  for (let done = 0; done < opts.ticks; done += batch) {
    const rows = await page.evaluate(([n, w, h, old]) => {
      const out = [];
      const THREE = window.__THREE;
      const fwd = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        window.__renderOnce(w, h);
        const drive = window.__drive();
        if (!drive) break;
        const s = drive.state();
        const p = s.position;
        // The same reference the wheels use: about the axle plus the step they
        // can mount. Read the deck and the pure terrain separately.
        const fromY = p.y + 0.5;
        const surface = drive.ground(p.x, p.z, fromY);
        const terrain = old ? surface : drive.ground(p.x, p.z);
        let pitch = s.pitch;
        if (pitch === undefined) {
          // A pre-fix build has no pitch on the state; take it off the driven
          // node, found by matching the hull's own position.
          pitch = null;
          window.__scene.traverse(node => {
            if (pitch !== null || !node.name || !/^(Tiger|Willy|Sherman|PanzerIV|Kubel)/i.test(node.name)) return;
            const at = node.getWorldPosition(new THREE.Vector3());
            if (Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) > 0.6) return;
            fwd.set(0, 0, -1).applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()));
            pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y))) * 180 / Math.PI;
          });
        }
        out.push({
          x: p.x, y: p.y, z: p.z,
          surface: surface.height,
          deck: surface.deck === undefined ? null : surface.deck,
          terrain: terrain.height,
          friction: surface.friction,
          along: s.along, grounded: s.grounded, pitch, roll: s.roll ?? null,
        });
      }
      return out;
    }, [batch, opts.width, opts.height, legacy]);
    for (const row of rows) trace.push(row);
    if (!rows.length) break;
    // Stop once the run has plainly ended: a hull jammed against a wall for two
    // seconds would otherwise dominate every average in the summary. `stall` in
    // the result says whether this fired.
    const tail = trace.slice(-120);
    if (tail.length >= 120 && tail.every(p => Math.abs(p.along) < 0.5)) {
      stalled = true;
      break;
    }
  }
  await page.evaluate(() => { window.__keys.delete('KeyW'); });

  const deck = chosen.deck;
  const zone = opts.zone ? nums(opts.zone) : null;
  const inside = zone
    ? p => p.x >= zone[0] && p.x <= zone[1] && p.z >= zone[2] && p.z <= zone[3]
    : p => p.x >= deck.min[0] && p.x <= deck.max[0]
        && p.z >= deck.min[2] && p.z <= deck.max[2];
  const onDeck = trace.filter(p => inside(p)
    && (legacy ? p.surface > p.terrain - 1e-6 : Number.isFinite(p.deck)));
  let biggestJump = 0;
  for (let i = 1; i < onDeck.length; i++) {
    biggestJump = Math.max(biggestJump, Math.abs(onDeck[i].y - onDeck[i - 1].y));
  }
  const rides = onDeck.map(p => p.y - p.surface);
  const flat = trace.filter(p => !inside(p) && p.grounded).map(p => p.y - p.surface);
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const result = {
    map: opts.map, mod: opts.mod,
    vehicle: chosen.name, owner: chosen.owner,
    deck: deck.node, deckBox: { min: deck.min, max: deck.max },
    plan: { alongX: plan.alongX, start: plan.start.map(v => round(v, 2)), yaw: round(plan.yaw, 3) },
    zone: zone || null,
    ticks: trace.length,
    legacy,
    stalled,
    ticksOnDeck: onDeck.length,
    crossedDeck: onDeck.length > 0,
    // Ride height on the deck against ride height on open ground: the deck must
    // carry the vehicle exactly as the terrain does.
    rideOnDeck: round(mean(rides)),
    rideOnGround: round(mean(flat)),
    lowestRideOnDeck: round(rides.length ? Math.min(...rides) : NaN),
    // Below the deck top at any point is the "sinks through it" bug.
    ticksBelowDeck: onDeck.filter(p => p.y < (p.deck ?? p.surface) - 0.01).length,
    airborneOnDeck: onDeck.filter(p => !p.grounded).length,
    biggestJump: round(biggestJump),
    deckRange: onDeck.length
      ? [round(Math.min(...onDeck.map(p => p.deck ?? p.surface)), 2),
         round(Math.max(...onDeck.map(p => p.deck ?? p.surface)), 2)]
      : null,
    terrainUnderDeck: onDeck.length
      ? [round(Math.min(...onDeck.map(p => p.terrain)), 2), round(Math.max(...onDeck.map(p => p.terrain)), 2)]
      : null,
    frictionOnDeck: onDeck.length
      ? [round(Math.min(...onDeck.map(p => p.friction)), 3), round(Math.max(...onDeck.map(p => p.friction)), 3)]
      : null,
    topSpeed: round(Math.max(...trace.map(p => Math.abs(p.along)))),
    // Pitch: nose up on an approach ramp or a humped span, level on a flat pad.
    pitchOnDeck: onDeck.length
      ? [round(Math.min(...onDeck.map(p => p.pitch)), 2), round(Math.max(...onDeck.map(p => p.pitch)), 2)]
      : null,
    pageErrors: errors,
  };
  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify({ ...result, trace }, null, 1));
    result.traceWritten = opts.out;
  }
  console.log(JSON.stringify(result, null, 1));
  return result.crossedDeck && result.ticksBelowDeck === 0 ? 0 : 1;
}

main().then(code => process.exit(code), err => {
  console.error(err.stack || String(err));
  process.exit(2);
});
