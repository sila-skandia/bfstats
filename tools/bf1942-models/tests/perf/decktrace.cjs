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
//   node decktrace.cjs --base http://localhost:5573 --map bocage --targets bridge --out trace.json
//
// `--list` prints the decks the scan found and stops. `--out <file>` writes the
// full per-tick trace beside the summary; without it the summary still carries
// `path`, one row every `--every` ticks, and `stallAt` when the run jammed —
// enough to put a stall on the map.
//
// NOT a hull-sweep test. With the body solver up (every current build), the
// driven vehicle reports `hullSolved: true` and its contact with the statics —
// a parapet, a workshop wall, a bridge pier — is resolved by `body-statics.js`
// through the body world, while the drive model's own swept sphere
// (the `collider.sweepSphere` call in `tracked-vehicle.js` / `wheeled-vehicle.js`)
// stands down.
// `hullSolved` and the per-tick `contacts` in the result are that path's
// numbers. `--sweep` runs the old path instead (`__hullSolver(false)`: statics
// out of the solver, the swept sphere back on) for an A/B. The deck RIDE — the
// wheels on the span, which is what the summary grades — is neither: it is the
// ground probe `__drive().ground()` answers, the same in both modes.
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
  software: false, headed: false, out: null, list: false, sweep: false,
  every: 10,                           // `path` sampling interval, in ticks
  // An explicit crossing, when the automatic one (the deck's long axis, from
  // `runUp` metres outside it) is not the line worth driving: `--start x,z`
  // plus `--yaw <radians>`, and `--zone x0,x1,z0,z1` for the stretch the
  // summary is taken over. A repair station wants this — half its box is the
  // workshop building standing on the pad, which is a wall and should be.
  start: null, yaw: null, zone: null, deck: null,
};
// `--key value` and `--key=value` both work. An unknown key is an error: a
// mistyped one used to land in `opts` unread, so `--targets=bridge` ran the
// default target list and picked a repair pad without a word.
const argv = process.argv.slice(2);
const parse = v => (Number.isNaN(Number(v)) ? v : Number(v));
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
  const eq = argv[i].indexOf('=');
  const key = argv[i].slice(2, eq < 0 ? undefined : eq);
  if (!(key in opts)) throw new Error(`unknown option --${key}`);
  const next = argv[i + 1];
  if (eq >= 0) opts[key] = parse(argv[i].slice(eq + 1));
  else if (next === undefined || next.startsWith('--')) opts[key] = true;
  else { opts[key] = parse(next); i++; }
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

  // Every drivable static in the level, by the same name rule `collision-meshes.js`
  // uses, with the world box the trace needs to pick a crossing line.
  const decks = await page.evaluate(pattern => {
    const re = new RegExp(pattern, 'i');
    const out = [];
    const taken = new Set();
    const THREE = window.__THREE;
    const box = new THREE.Box3();
    const local = new THREE.Box3();
    const part = new THREE.Box3();
    const toLocal = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    // A placed vehicle's parts match too (`B17_Bay_Left`, `Katyusha_Ramp`); the
    // loose match is harmless to the collider but they are not decks.
    const vehicleNames = new Set(window.__vehicles().map(v => v.name));
    const under = (node, test) => {
      for (let n = node.parent; n; n = n.parent) if (test(n)) return true;
      return false;
    };
    window.__scene.traverse(node => {
      if (!node.name || !re.test(node.name)) return;
      // Only placements, not the collision primitives inside them.
      if (/collision/i.test(node.name)) return;
      // Nor the meshes nested inside a placement already taken: a repair depot
      // is `landrep1_supply` > `landrep1_m1` > `landrep1_m1_lod1_6`, every level
      // of which matches `landrep`. The traversal is parent-first, so an
      // ancestor walk against what was taken is enough.
      if (under(node, n => taken.has(n))) return;
      if (vehicleNames.has(node.name) || under(node, n => vehicleNames.has(n.name))) return;
      box.setFromObject(node);
      if (!Number.isFinite(box.min.x)) return;
      taken.add(node);
      // The placement's own box, in its own frame. A bridge is placed at any
      // heading, and the world box of one at 45 degrees is near square, so its
      // long side says nothing about which way the span runs. The local axis
      // whose extent covers the most ground in XZ is the span.
      toLocal.copy(node.matrixWorld).invert();
      local.makeEmpty();
      node.traverse(o => {
        if (!o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        local.union(part.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(toLocal, o.matrixWorld)));
      });
      let span = null;
      if (!local.isEmpty()) {
        const mid = local.getCenter(new THREE.Vector3());
        for (const k of ['x', 'y', 'z']) {
          const a = mid.clone(); a[k] = local.min[k];
          const b = mid.clone(); b[k] = local.max[k];
          a.applyMatrix4(node.matrixWorld); b.applyMatrix4(node.matrixWorld);
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          if (!span || len > span.len) span = { len, a, b };
        }
      }
      out.push({
        node: node.name,
        min: [box.min.x, box.min.y, box.min.z].map(v => +v.toFixed(2)),
        max: [box.max.x, box.max.y, box.max.z].map(v => +v.toFixed(2)),
        // The span: its two ends' ground position and length, for the crossing.
        span: span && span.len > 0 ? {
          from: [span.a.x, span.a.z].map(v => +v.toFixed(2)),
          to: [span.b.x, span.b.z].map(v => +v.toFixed(2)),
          length: +span.len.toFixed(2),
        } : null,
      });
    });
    return out;
    // Keep this in step with `DRIVABLE_TOP_RE` in `viewer/collision-meshes.js`; this
    // file cannot import the module the page loads.
  }, String(opts.targets
    || 'bridge|repairpoint|repaircist|reloadbay|repairbay|repairstation|landrep|airrep|bay|ramp|overpass|dock|flightdeck|freightdeck|hardsurface|deck'));

  if (opts.list) {
    console.log(JSON.stringify({ map: opts.map, decks }, null, 1));
    return 0;
  }
  if (!decks.length) throw new Error(`no drivable statics matching on ${opts.map}`);
  const nums = v => String(v).split(',').map(Number);

  // The vehicle and the deck together: the (matching vehicle, listed deck) pair
  // standing closest. Every candidate deck came through `--targets`, so the
  // list decides WHICH kind of deck; proximity only picks one of them (the
  // vehicle is placed at the run-up anyway). `--deck <node>` pins it.
  const chosen = await page.evaluate(([pattern, decksIn, only]) => {
    const want = new RegExp(pattern, 'i');
    const centre = d => [(d.min[0] + d.max[0]) / 2, (d.min[2] + d.max[2]) / 2];
    const best = { owner: null, deck: null, distance: Infinity };
    for (const v of window.__vehicles()) {
      // `test-hooks-world.js` reports `x, y, z`; the older hook had `pos`.
      const at = Number.isFinite(v.x) ? [v.x, v.y, v.z] : v.pos;
      if (!at || v.destroyed || !want.test(v.name)) continue;
      for (const deck of decksIn) {
        if (only && deck.node !== only) continue;
        const [cx, cz] = centre(deck);
        const d = Math.hypot(at[0] - cx, at[2] - cz);
        if (d < best.distance) {
          best.distance = d;
          best.owner = v.owner; best.name = v.name; best.deck = deck;
        }
      }
    }
    return best;
  }, [String(opts.vehicle), decks, opts.deck ? String(opts.deck) : null]);
  if (chosen.owner === null) {
    throw new Error(`no vehicle matching ${opts.vehicle} on ${opts.map}`
      + (opts.deck ? ` beside a deck named ${opts.deck}` : ''));
  }
  if (!await page.evaluate(o => window.__enterOwner(o), chosen.owner)) {
    throw new Error(`could not take owner ${chosen.owner} (${chosen.name})`);
  }
  await step(20);

  // Cross the deck along its span (its long axis in its own frame, see the
  // scan), starting `runUp` metres short of its end so the approach ramp is
  // part of the run. Without a span (no geometry under the node) fall back to
  // the world box's long side.
  const plan = await page.evaluate(([deck, runUp, startIn, yawIn]) => {
    let from, to;
    if (deck.span) ({ from, to } = deck.span);
    else {
      const cx = (deck.min[0] + deck.max[0]) / 2;
      const cz = (deck.min[2] + deck.max[2]) / 2;
      const alongX = deck.max[0] - deck.min[0] >= deck.max[2] - deck.min[2];
      from = alongX ? [deck.min[0], cz] : [cx, deck.max[2]];
      to = alongX ? [deck.max[0], cz] : [cx, deck.min[2]];
    }
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    const axis = [(to[0] - from[0]) / len, (to[1] - from[1]) / len];
    // Heading: yaw 0 points -Z (the spawn heading), yaw -pi/2 points +X, so a
    // heading (hx, hz) is yaw atan2(-hx, -hz).
    const yaw = yawIn !== null ? yawIn : Math.atan2(-axis[0], -axis[1]);
    const start = startIn || [from[0] - axis[0] * runUp, from[1] - axis[1] * runUp];
    const y = window.__drive().ground(start[0], start[1]).height;
    window.__drive().place(start[0], y + 1.2, start[1], yaw);
    return { axis, yaw, start, startY: y };
  }, [chosen.deck, opts.runUp, opts.start ? nums(opts.start) : null,
      opts.yaw !== null ? Number(opts.yaw) : null]);
  await step(40);                      // let the springs settle before the run

  // A build from before the deck fix has neither the hull-sweep hook nor pitch
  // on the drive state nor a `deck` in the ground answer, and its `ground(x, z)`
  // already folds its own height raster in. Detecting that is what lets one tool
  // produce both halves of a before/after.
  const legacy = await page.evaluate(() => !window.__drive().sweep);
  if (legacy) console.error('# legacy build: no deck hooks, surface is its own raster');
  // Which path answers the statics: see the header. `__hullSolver` is absent on
  // a build from before the body solver, where the sweep is the only path.
  const solver = await page.evaluate(sweep => (window.__hullSolver
    ? window.__hullSolver(sweep ? false : undefined) : null), !!opts.sweep);
  if (opts.sweep && !solver) console.error('# --sweep: no __hullSolver on this build, the sweep is already the path');

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
          hullSolved: s.hullSolved ?? null,
          // This tick's static contacts from `body-statics.js`, and the most
          // upright-facing one's normal: a wall is ~0, a floor ~1.
          contacts: s.hullContacts ? s.hullContacts.length : null,
          contactNormalY: s.hullContacts?.length
            ? Math.max(...s.hullContacts.map(c => c.normalY)) : null,
        });
      }
      return out;
    }, [batch, opts.width, opts.height, legacy]);
    for (const row of rows) trace.push(row);
    if (!rows.length) break;
    // Stop once the run has plainly ended: a hull jammed against a wall for 120
    // ticks would otherwise dominate every average in the summary. `stalled` in
    // the result says whether this fired. Net ground covered, not speed: a Tiger
    // nosing up the Bocage depot's slab edge shoves back and forth at 0.3-3 m/s
    // for 500 ticks and goes nowhere, and a speed test never saw it.
    const tail = trace.slice(-120);
    if (tail.length >= 120
      && Math.hypot(tail[119].x - tail[0].x, tail[119].z - tail[0].z) < 1) {
      stalled = trace.length - tail.length;   // the first tick of that window
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
  const row = (p, i) => ({
    tick: i, x: round(p.x, 2), y: round(p.y, 2), z: round(p.z, 2),
    surface: round(p.surface, 2), deck: p.deck === null ? null : round(p.deck, 2),
    along: round(p.along, 2), grounded: p.grounded, pitch: round(p.pitch, 1),
    onDeck: inside(p), contacts: p.contacts,
  });
  // The run at a glance, one row every `--every` ticks plus the last, so a
  // stall or a drop can be placed without the full `--out` trace.
  // `contacts` on a sampled row is the most seen on any tick since the last
  // one, so a brush with a wall between samples still shows.
  const every = Math.max(1, Number(opts.every) || 10);
  const sampled = [];
  let peak = null;
  trace.forEach((p, i) => {
    if (p.contacts !== null) peak = Math.max(peak ?? 0, p.contacts);
    if (i % every && i !== trace.length - 1) return;
    sampled.push({ ...row(p, i), contacts: peak });
    peak = null;
  });

  const result = {
    map: opts.map, mod: opts.mod,
    vehicle: chosen.name, owner: chosen.owner,
    deck: deck.node, deckBox: { min: deck.min, max: deck.max }, span: deck.span,
    plan: { axis: plan.axis.map(v => round(v, 3)), start: plan.start.map(v => round(v, 2)), yaw: round(plan.yaw, 3) },
    zone: zone || null,
    ticks: trace.length,
    legacy,
    hullSolved: trace.length ? trace[trace.length - 1].hullSolved : null,
    solver,
    stalled: stalled !== false,
    // Where the hull stopped, with what was touching it: `contacts` > 0 and a
    // `contactNormalY` near 0 is a wall the body solver met.
    stallAt: stalled !== false
      ? { ...row(trace[stalled], stalled), contactNormalY: round(trace[stalled].contactNormalY, 2) }
      : null,
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
    every,
    path: sampled,
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
