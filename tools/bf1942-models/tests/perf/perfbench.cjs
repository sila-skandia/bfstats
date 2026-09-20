#!/usr/bin/env node
// Frame-pacing bench for the map page's on-foot hot path.
//
// Not a pytest: it needs a static server in front of `viewer/` and a GPU.
// Drives the page through the `?shots` hooks (`__renderOnce`, `__deploy`,
// `__setTrigger`, `__lookDelta`, `__keys`, `__setFly`) the way the screenshot
// tooling does, so nothing here reaches behind the page's own input path.
//
//   node perfbench.cjs bench --base http://localhost:5573 --out before.json
//   node perfbench.cjs bench --dpr 2 --throttle 4 --realtime 120
//   node perfbench.cjs bench --headed --uncap --gpu-timer --skip-stepped --dpr 2 --aa 0 --realtime 20
//   node perfbench.cjs shot --dir shots/before
//   node perfbench.cjs compare shots/before shots/after
//
// `bench` prints one JSON line per phase plus a pacing summary, and writes the
// whole record (per-frame counters included) to --out. Stepped phases count
// draw calls and triangles across BOTH render passes (`renderer.info` with
// autoReset off) and are deterministic; the real-time phase is the number
// that matters for "choppy": frame intervals under CPU throttle at the given
// device pixel ratio, with every long frame attributed to what the page did
// in it (spawns, ticks, casts, program compiles, draw calls).
//
// The renderer-settings matrix (features/mesh-viewer-performance, renderer
// settings):
//   --aa 0              the page's `?aa=0`: no MSAA on the WebGL context
//   --pixel-ratio <r>   the page's `?dpr=<r>`: the WebGL canvas's pixel ratio,
//                       replacing min(devicePixelRatio, 2); --dpr stays the
//                       window's device scale factor
//   --uncap             --disable-gpu-vsync --disable-frame-rate-limit, so a
//                       frame's interval is its cost and not the next vsync
//   --gpu-timer         EXT_disjoint_timer_query_webgl2 around each render
//                       pass, per real-time frame
//   --fire 0            the real-time and stepped phases walk, turn and crouch
//                       with the trigger released
//   --still             ... and stand still: no walking, turning or crouching
//   --mapgate 0         `__mapGate(false)`: the map surfaces repaint every
//                       frame, as before rule 7
//
// Frame TIMES swing 2x between back-to-back runs of identical code on this
// hardware; compare workload counters, profile shares and pacing percentiles
// across several runs rather than one run's milliseconds.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Playwright comes out of `ui/node_modules`, like `shoot.mjs`. A worktree has
// no node_modules of its own, so the main checkout's (the one that owns the
// shared `.git`) is the fallback; PLAYWRIGHT_MODULES overrides both.
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
const MODULES = modulesDir();
const { chromium } = require(path.join(MODULES, 'playwright'));
const { PNG } = require(path.join(MODULES, 'playwright-core', 'lib', 'utilsBundle'));

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'bench';
const opts = {
  base: 'http://localhost:5573',
  mod: 'bf1942', map: 'Wake', weapon: 'Thompson', flag: 'The_Airfield',
  width: 1600, height: 900,
  dpr: 1, throttle: 1, realtime: 60, headed: false,
  out: null, dir: null, seed: 7, profile: true,
  aa: 1, 'pixel-ratio': null, uncap: false, 'gpu-timer': false, fire: 1, still: false, mapgate: 1,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = /^-?\d+(\.\d+)?$/.test(next) ? Number(next) : next; i++; }
  } else opts._ = [...(opts._ || []), a];
}
const firing = opts.fire !== 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const round = (x, d = 1) => (x == null ? null : +Number(x).toFixed(d));

async function launch() {
  // Headless runs on ANGLE over Vulkan, which is what the screenshot tooling
  // uses and what gives deterministic stepped frames. Real-time pacing is a
  // headed measurement: headless Chromium under CDP CPU throttling runs
  // away on this page (frames grow from 0.2 s to 5 s over a minute, with
  // the renderer's RSS climbing) even with the page's own loop stopped,
  // while the same throttle in a window holds a steady 35-38 fps. A window
  // also cannot create a WebGL context under the ANGLE flags on this
  // machine, so --headed takes the system GL unless --angle is given.
  const angle = opts.headed && !opts.angle ? [] : ['--use-angle=vulkan', '--enable-features=Vulkan'];
  // Uncapped, a frame's interval is what the frame cost rather than the next
  // vsync; a 60 Hz cap hides whether a cheaper frame would have been faster.
  const uncap = opts.uncap ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  const browser = await chromium.launch({
    headless: !opts.headed,
    args: [
      ...angle, ...uncap, '--ignore-gpu-blocklist',
      '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: opts.dpr,
  });
  const logs = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  return { browser, page, logs };
}

async function load(page) {
  // `nopreserve` drops the per-frame drawing-buffer copy `?shots` turns on,
  // so a pacing run measures the page a player gets; `shot` mode needs the
  // buffer kept for toDataURL and does not pass it.
  const settings = `${opts.aa === 0 ? '&aa=0' : ''}${opts['pixel-ratio'] ? `&dpr=${opts['pixel-ratio']}` : ''}`;
  const url = `${opts.base}/map.html?mod=${opts.mod}&map=${opts.map}&weapon=${opts.weapon}&shots${opts.preserve ? '' : '&nopreserve'}${settings}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__renderOnce && window.__deploy && window.__scene, null, { timeout: 300000 });
  await page.waitForLoadState('networkidle', { timeout: 300000 }).catch(() => {});
  await sleep(3000);
  return (Date.now() - t0) / 1000;
}

/** What the context actually came up with, so every run records the settings
 *  it measured rather than the flags it was asked for: MSAA samples, whether
 *  the drawing buffer is preserved, the pixel ratio, the GL behind it. Also
 *  arms a count of real `webglcontextlost` events and applies --mapgate. */
async function rendererInfo(page) {
  return page.evaluate(gate => {
    const r = window.__renderer, gl = r.getContext();
    const attrs = gl.getContextAttributes();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    window.__lostEvents = 0;
    r.domElement.addEventListener('webglcontextlost', () => { window.__lostEvents++; });
    if (gate === 0) window.__mapGate?.(false);
    return {
      gl: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      antialias: attrs.antialias, samples: gl.getParameter(gl.SAMPLES),
      preserveDrawingBuffer: attrs.preserveDrawingBuffer,
      pixelRatio: r.getPixelRatio(), devicePixelRatio: window.devicePixelRatio,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      timerQuery: gl.getSupportedExtensions().includes('EXT_disjoint_timer_query_webgl2'),
      mapGate: window.__mapGate?.() ?? null,
    };
  }, opts.mapgate);
}

/** Install the in-page stepped bench: N deterministic frames, counters on the last. */
async function installBench(page) {
  await page.evaluate(([w, h]) => {
    const r = window.__renderer, gl = r.getContext();
    const small = o => {
      if (!o || typeof o !== 'object') return o;
      const s = {};
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 60)) s[k] = v;
        else if (Array.isArray(v)) s[`${k}.len`] = v.length;
      }
      return s;
    };
    window.__bench = (label, n, perFrame) => {
      const t = [], calls = [];
      r.info.autoReset = false;
      for (let i = 0; i < n; i++) {
        perFrame && perFrame(i);
        r.info.reset();
        const a = performance.now();
        window.__renderOnce(w, h);
        gl.finish();
        t.push(performance.now() - a);
        calls.push(r.info.render.calls);
      }
      const tris = r.info.render.triangles;
      r.info.autoReset = true;
      const sorted = [...t].sort((x, y) => x - y);
      let objects = 0, meshes = 0;
      window.__scene.traverse(o => { objects++; if (o.isMesh) meshes++; });
      const hw = window.__handWeapon?.();
      return {
        label, n,
        meanMs: +(t.reduce((s, x) => s + x, 0) / n).toFixed(2),
        p50: +sorted[n >> 1].toFixed(2), p95: +sorted[Math.floor(n * 0.95)].toFixed(2), max: +sorted[n - 1].toFixed(2),
        drawCallsLast: calls[n - 1], drawCallsMax: Math.max(...calls), drawCallsMean: Math.round(calls.reduce((s, x) => s + x, 0) / n),
        tris,
        geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length,
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
        sceneChildren: window.__scene.children.length, objects, meshes,
        effects: small(window.__effects?.()),
        hw: hw ? small(hw) : null,
        soldier: window.__soldier?.() ? small(window.__soldier()) : null,
      };
    };
  }, [opts.width, opts.height]);
}

/** Walk to on foot, spawn, and wait for the arms rig. */
async function spawn(page) {
  await page.evaluate(() => window.__setOnFoot(true));
  const dep = await page.evaluate(() => {
    try { window.__deploy.select(window.__perfFlag); return window.__deploy.spawn(); } catch (e) { return `deploy error: ${e.message}`; }
  });
  await page.waitForFunction(() => window.__handWeapon()?.viewmodel, null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  return dep;
}

function selfTime(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const selfMs = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const cf = byId.get(profile.samples[i]).callFrame;
    const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
    selfMs.set(key, (selfMs.get(key) || 0) + (profile.timeDeltas[i] || 0) / 1000);
  }
  const total = [...selfMs.values()].reduce((a, b) => a + b, 0);
  return {
    totalMs: Math.round(total),
    top: [...selfMs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
      .map(([k, v]) => ({ share: +(100 * v / total).toFixed(1), ms: Math.round(v), fn: k })),
  };
}

/** The browser's process tree, each process with its Chromium type. Playwright
 *  exposes no browser pid; the browser is this node process's child, so it is
 *  the chromium row whose parent is us. */
function browserTree() {
  const rows = execSync('ps -eo pid=,ppid=,rss=,args=', { encoding: 'utf8' }).trim().split('\n').map(l => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    return m && { pid: +m[1], ppid: +m[2], rssMB: Math.round(+m[3] / 1024), args: m[4] };
  }).filter(Boolean);
  const kids = new Map();
  for (const r of rows) { if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r); }
  const rootPid = rows.find(r => r.ppid === process.pid && /chrom/i.test(r.args) && !/--type=/.test(r.args))?.pid;
  if (!rootPid) return [];
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    const self = rows.find(r => r.pid === pid);
    if (self) {
      const type = /--type=(\S+)/.exec(self.args)?.[1];
      const kind = pid === rootPid ? 'browser' : type === 'gpu-process' ? 'gpu' : type === 'renderer' ? 'renderer' : type === 'utility' ? 'utility' : 'other';
      out.push({ ...self, kind });
    }
    for (const k of kids.get(pid) || []) stack.push(k.pid);
  }
  return out;
}

/** Descendant processes of the browser, by Chromium process type, RSS in MB. */
function processRss() {
  try {
    const out = { browser: 0, gpu: 0, renderer: 0, utility: 0, other: 0, total: 0 };
    const tree = browserTree();
    if (!tree.length) return null;
    for (const p of tree) { out[p.kind] += p.rssMB; out.total += p.rssMB; }
    return out;
  } catch { return null; }
}

/** CPU clock ticks by process type and thread name across the browser's tree,
 *  from /proc: the renderer's main thread against its compositor, the GPU
 *  process's command decoder against the display compositor. Diffed over a
 *  phase, it says which thread a frame is waiting on. */
const CLK_TCK = (() => { try { return Number(execSync('getconf CLK_TCK', { encoding: 'utf8' }).trim()) || 100; } catch { return 100; } })();
function threadTicks() {
  const out = {};
  try {
    for (const p of browserTree()) {
      let tids = [];
      try { tids = fs.readdirSync(`/proc/${p.pid}/task`); } catch { continue; }
      for (const tid of tids) {
        try {
          const stat = fs.readFileSync(`/proc/${p.pid}/task/${tid}/stat`, 'utf8');
          // The name sits in parentheses and may hold spaces; utime and stime
          // are fields 14 and 15, counted from the state after the ')'.
          const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
          const name = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
          const key = `${p.kind}:${name}`;
          out[key] = (out[key] || 0) + Number(rest[11]) + Number(rest[12]);
        } catch { /* the thread exited between the listing and the read */ }
      }
    }
  } catch { /* no /proc; the phase reports no thread breakdown */ }
  return out;
}
function threadCpu(before, after, seconds) {
  const pctOf = ticks => +(100 * ticks / CLK_TCK / seconds).toFixed(1);
  const byThread = Object.keys(after).map(k => [k, (after[k] || 0) - (before[k] || 0)])
    .filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1]);
  const byKind = {};
  for (const [k, t] of byThread) { const kind = k.split(':')[0]; byKind[kind] = (byKind[kind] || 0) + t; }
  return {
    pctOfOneCore: Object.fromEntries(Object.entries(byKind).map(([k, t]) => [k, pctOf(t)])),
    threads: byThread.slice(0, 12).map(([k, t]) => ({ thread: k, pct: pctOf(t) })),
  };
}

/**
 * The real-time phase. Trigger held, W held, crouch toggled every 3 s, the
 * view panned every 8 ms, the pouch refilled and the soldier put back at
 * his starting pose every 10 s — a man walking into walls while turning
 * diverges chaotically between runs, and ten seconds of that is as much
 * as two builds can be expected to share; without the reset one run of the
 * same build drew 280 calls a frame and the next 515. Every frame is
 * sampled from a requestAnimationFrame that runs after the renderer's own
 * loop (registered later, so it fires later in the same frame), which is
 * what lets `renderer.info` read as "the frame just drawn".
 *
 * `--fire 0` releases the trigger and `--still` stops the walking, turning
 * and crouching. Each frame also records how long the main thread took from
 * the frame's start to the end of the page's `frame()` (three's loop callback
 * runs its loop before re-requesting, so this callback is next), the CPU time
 * inside the two `renderer.render` calls, and with `--gpu-timer` the GPU's:
 * `main` the level pass, `near` the arms pass, `tail` everything the GPU did
 * from the end of one frame's near pass to the next frame's main pass — the
 * drawing buffer's MSAA resolve and hand-off, the compositors, and idle when
 * nothing was waiting. Timer queries cannot nest, so the three are a chain.
 */
async function realtime(page, seconds) {
  return page.evaluate(async ([ms, fire, still, gpuTimer]) => {
    const r = window.__renderer, gl = r.getContext();
    r.info.autoReset = false;
    r.info.reset();
    const start = window.__soldier();
    window.__setFly(true);
    if (!still) window.__keys.add('KeyW');
    window.__setTrigger(fire);
    // Map-surface repaints, counted at the one call every repaint makes
    // (`drawArt`'s clearRect), so a run says how often rule 7 let one through.
    const repaints = { minimap: 0, fullmap: 0 };
    const unwrap = [];
    for (const [key, id] of [['minimap', 'minimap-canvas'], ['fullmap', 'fullmap-canvas']]) {
      const ctx = document.getElementById(id)?.getContext('2d');
      if (!ctx) continue;
      const clear = ctx.clearRect;
      ctx.clearRect = function (...a) { repaints[key]++; return clear.apply(this, a); };
      unwrap.push(() => { delete ctx.clearRect; });
    }
    const ext = gpuTimer ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    const gpu = { main: [], between: [], near: [], tail: [] };
    const js = { main: [], near: [] };
    const pending = [];
    let frameNo = 0, active = null, disjoint = 0;
    const boundary = next => {
      if (!ext) return;
      if (active) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(active); active = null; }
      if (next) { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); active = { q, kind: next, frame: frameNo }; }
    };
    const poll = () => {
      if (!ext || !pending.length) return;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        disjoint++;
        for (const p of pending) gl.deleteQuery(p.q);
        pending.length = 0;
        return;
      }
      let i = 0;
      for (; i < pending.length; i++) {
        const p = pending[i];
        if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
        gpu[p.kind][p.frame] = gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(p.q);
      }
      pending.splice(0, i);
    };
    // `pre` is requested from inside three's loop callback, before three
    // re-requests its own frame, so next frame it runs first: this tick minus
    // `pre` is the page's whole loop callback, simulation included. The rAF
    // timestamp is no substitute uncapped — it is the begin-frame's time, and
    // begin-frames queue ahead of a busy main thread.
    let preT = null, running = true;
    const pre = () => { preT = performance.now(); };
    const render = r.render;
    r.render = function (scene, camera) {
      const main = scene === window.__scene;
      if (main) {
        frameNo++;
        if (running) requestAnimationFrame(pre);
      }
      boundary(main ? 'main' : 'near');
      const a = performance.now();
      render.call(this, scene, camera);
      (main ? js.main : js.near)[frameNo] = performance.now() - a;
      boundary(main ? 'between' : 'tail');
    };
    const frames = [];
    let last = performance.now();
    let lastSpawned = window.__effects().spawned, lastShots = window.__handWeapon()?.shots ?? 0;
    let lastTicks = window.__soldier()?.ticks ?? 0;
    const tick = t => {
      const now = performance.now();
      const loopMs = preT == null ? null : now - preT;
      preT = null;
      const sinceBegin = now - t;
      poll();
      const fx = window.__effects(), hw = window.__handWeapon(), sol = window.__soldier();
      frames.push([
        +(t - last).toFixed(2),
        r.info.render.calls, r.info.render.triangles,
        fx.particles, fx.spawned - lastSpawned,
        (sol?.ticks ?? 0) - lastTicks, sol?.casts ?? 0,
        (hw?.shots ?? 0) - lastShots,
        r.info.programs.length, r.info.memory.textures, r.info.memory.geometries,
        performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0,
        window.__scene.children.length,
        loopMs == null ? null : +loopMs.toFixed(2), frameNo,
      ]);
      frames[frames.length - 1].sinceBegin = +sinceBegin.toFixed(2);
      lastSpawned = fx.spawned; lastShots = hw?.shots ?? 0; lastTicks = sol?.ticks ?? 0;
      r.info.reset();
      last = t;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    let k = 0;
    const pan = still ? null : setInterval(() => { window.__lookDelta((k++ % 40) < 20 ? 25 : -25, 0); }, 8);
    const crouch = still ? null : setInterval(() => {
      if (window.__keys.has('ControlLeft')) window.__keys.delete('ControlLeft'); else window.__keys.add('ControlLeft');
    }, 3000);
    const refill = setInterval(() => {
      window.__refill?.();
      if (start) window.__teleport(start.x, start.y, start.z, start.yaw);
    }, 10000);
    await new Promise(res => setTimeout(res, ms));
    running = false;
    clearInterval(pan); clearInterval(crouch); clearInterval(refill);
    window.__setTrigger(false);
    window.__keys.delete('KeyW'); window.__keys.delete('ControlLeft');
    r.render = render;
    boundary(null);
    for (let n = 0; n < 60 && pending.length; n++) {
      await new Promise(res => requestAnimationFrame(res));
      poll();
    }
    for (const f of unwrap) f();
    r.info.autoReset = true;
    frames.shift();
    // Per-frame GPU and render-call CPU columns, joined on the frame number,
    // then the time from the begin-frame's timestamp to the end of frame().
    for (const f of frames) {
      const n = f[14];
      f.push(gpu.main[n] ?? null, gpu.near[n] ?? null, gpu.tail[n] ?? null, js.main[n] ?? null, js.near[n] ?? null, f.sinceBegin);
    }
    return {
      frames, repaints, disjoint, timer: !!ext, unread: pending.length,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      lostEvents: window.__lostEvents ?? null,
    };
  }, [seconds * 1000, firing, !!opts.still, !!opts['gpu-timer']]);
}

function stats(xs) {
  const v = xs.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  return { n: v.length, mean: round(v.reduce((a, b) => a + b, 0) / v.length, 2), p50: round(pct(v, 0.5), 2), p95: round(pct(v, 0.95), 2) };
}

function pacing(frames) {
  if (!frames.length) return { frames: 0, skipped: true };
  const dts = frames.map(f => f[0]);
  const s = [...dts].sort((a, b) => a - b);
  const total = dts.reduce((a, b) => a + b, 0);
  let jitter = 0;
  for (let i = 1; i < dts.length; i++) jitter += Math.abs(dts[i] - dts[i - 1]);
  const long = frames.map((f, i) => [i, ...f]).filter(f => f[1] > 33);
  return {
    frames: dts.length,
    fps: round(1000 * dts.length / total),
    p50: round(pct(s, 0.5)), p95: round(pct(s, 0.95)), p99: round(pct(s, 0.99)), max: round(s[s.length - 1]),
    jitterMs: round(jitter / Math.max(1, dts.length - 1), 2),
    over33ms: long.length, over50ms: dts.filter(x => x > 50).length, over100ms: dts.filter(x => x > 100).length,
    over16_7ms: dts.filter(x => x > 16.7).length,
    drawCalls: { mean: Math.round(frames.reduce((a, f) => a + f[1], 0) / frames.length), max: Math.max(...frames.map(f => f[1])) },
    trisMean: Math.round(frames.reduce((a, f) => a + f[2], 0) / frames.length),
    particlesMax: Math.max(...frames.map(f => f[3])),
    shots: frames.reduce((a, f) => a + f[7], 0),
    spawnsPerFrameMax: Math.max(...frames.map(f => f[4])),
    ticksPerFrameMax: Math.max(...frames.map(f => f[5])),
    castsPerFrameMax: Math.max(...frames.map(f => f[6])),
    programs: { start: frames[0][8], end: frames[frames.length - 1][8] },
    textures: { start: frames[0][9], end: frames[frames.length - 1][9] },
    heapMB: { start: frames[0][11], end: frames[frames.length - 1][11], max: Math.max(...frames.map(f => f[11])) },
    sceneChildrenMax: Math.max(...frames.map(f => f[12])),
    loopCpuMs: stats(frames.map(f => f[13])),
    beginToEndMs: stats(frames.map(f => f[20])),
    renderCpuMs: { main: stats(frames.map(f => f[18])), near: stats(frames.map(f => f[19])) },
    gpuMs: { main: stats(frames.map(f => f[15])), near: stats(frames.map(f => f[16])), tail: stats(frames.map(f => f[17])) },
    // The worst frames, each with what the page did in it.
    longest: [...frames.map((f, i) => [i, ...f])].sort((a, b) => b[1] - a[1]).slice(0, 12).map(f => ({
      i: f[0], ms: f[1], calls: f[2], particles: f[4], spawned: f[5], ticks: f[6], casts: f[7], shots: f[8],
      programs: f[9], textures: f[10], heapMB: f[12], mainMs: f[14], gpuMain: f[16], gpuNear: f[17], gpuTail: f[18],
    })),
  };
}

async function bench() {
  const { browser, page, logs } = await launch();
  const results = { mode: 'bench', opts, startedAt: new Date().toISOString(), phases: [], rss: [] };
  const rssTimer = setInterval(() => { const r = processRss(); if (r) results.rss.push({ t: Date.now(), ...r }); }, 5000);
  // The browser's own pid, so a script that runs this can confirm afterwards
  // that no window it opened outlived the run.
  try { results.browserPid = browserTree()[0]?.pid ?? null; } catch { results.browserPid = null; }
  try {
    results.loadS = await load(page);
    results.renderer = await rendererInfo(page);
    console.log(JSON.stringify({ label: 'renderer', browserPid: results.browserPid, ...results.renderer }));
    await page.evaluate(flag => { window.__perfFlag = flag; }, opts.flag);
    await installBench(page);
    const phase = async (label, n, src) => {
      const res = await page.evaluate(([label, n, src]) => window.__bench(label, n, src ? new Function('i', src) : null), [label, n, src || null]);
      results.phases.push(res);
      console.log(JSON.stringify(res));
      return res;
    };
    await phase('fly-static', 120);
    await phase('fly-pan', 240, 'window.__lookDelta(12, 0)');
    results.deploy = await spawn(page);
    await phase('deploy-clip', 200);
    await phase('onfoot-idle', 120);
    await phase('onfoot-pan', 240, 'window.__lookDelta(12, 0)');
    await page.evaluate(() => { for (let i = 0; i < 10; i++) window.__lookDelta(0, 20); });
    // The first burst on a cold page, in real time: nothing has fired yet, so
    // whatever the first rounds have to build — programs, texture uploads,
    // pool misses — lands in these frames. Under the run's throttle, since a
    // compile that hides at 60 Hz on a desktop is the hitch a laptop feels.
    // It fires under --fire 0 too, so both arms start from warmed pools.
    const cdp = await page.context().newCDPSession(page);
    if (opts.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
    const first = await page.evaluate(async (ms) => {
      const r = window.__renderer;
      r.info.autoReset = false;
      r.info.reset();
      const frames = [];
      let last = performance.now(), running = true;
      const tick = t => {
        frames.push([+(t - last).toFixed(2), r.info.programs.length, r.info.memory.textures, r.info.memory.geometries, window.__effects().particles, window.__handWeapon()?.shots ?? 0]);
        r.info.reset();
        last = t;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__setFly(true);
      window.__setTrigger(true);
      await new Promise(res => setTimeout(res, ms));
      running = false;
      window.__setTrigger(false);
      r.info.autoReset = true;
      frames.shift();
      return frames;
    }, 4000);
    if (opts.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const firstDts = first.map(f => f[0]);
    results.firstBurst = {
      frames: first.length,
      programs: { start: first[0][1], end: first[first.length - 1][1] },
      textures: { start: first[0][2], end: first[first.length - 1][2] },
      geometries: { start: first[0][3], end: first[first.length - 1][3] },
      over33ms: firstDts.filter(x => x > 33).length,
      max: round(Math.max(...firstDts)),
      longest: first.map((f, i) => [i, ...f]).sort((a, b) => b[1] - a[1]).slice(0, 6).map(f => ({ i: f[0], ms: f[1], programs: f[2], textures: f[3], particles: f[5], shots: f[6] })),
    };
    console.log(JSON.stringify({ label: 'first-burst-4s', ...results.firstBurst }));
    await page.waitForFunction(() => window.__effects().particles === 0, null, { timeout: 30000 }).catch(() => {});
    // Stepped firing while walking, crouching and panning, under the profiler.
    // Skipped by --skip-stepped: a headed pacing run wants the real-time
    // phase on a page that has fired only its first burst, and on the Iris
    // Xe's system GL these stepped phases — 150 frames of ~1,000 draws with a
    // gl.finish() each, as fast as they will go, at DPR 2 — have ended in an
    // 8 s frame and a lost WebGL context twice (see the feature README).
    if (!opts['skip-stepped']) {
      if (opts.profile) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      }
      await page.evaluate(([fire, still]) => {
        window.__setFly(true);
        if (!still) window.__keys.add('KeyW');
        window.__setTrigger(fire);
      }, [firing, !!opts.still]);
      if (opts.profile) await cdp.send('Profiler.start');
      const script = opts.still ? 'if (i % 100 === 0) window.__refill();'
        : 'window.__lookDelta(i % 60 < 30 ? 14 : -14, 0); if (i % 90 === 0) { if (window.__keys.has("ControlLeft")) window.__keys.delete("ControlLeft"); else window.__keys.add("ControlLeft"); } if (i % 100 === 0) window.__refill();';
      for (let b = 0; b < 6; b++) {
        await phase(`${firing ? 'firing' : 'moving'}-${opts.still ? 'still' : 'walk-pan'}-${b}`, 150, script);
      }
      if (opts.profile) {
        const { profile } = await cdp.send('Profiler.stop');
        results.profileStepped = selfTime(profile);
        // The raw profile, for DevTools or for the inclusive time under one
        // function (`drawMinimap`, say), which a self-time table cannot give.
        if (opts.cpuprofile) fs.writeFileSync(opts.cpuprofile, JSON.stringify(profile));
      }
      await page.evaluate(() => { window.__setTrigger(false); window.__keys.delete('KeyW'); window.__keys.delete('ControlLeft'); });
      await phase('after-release', 120);
    }
    // Real time, under throttle. The profiler stays off here so the pacing is
    // the page's own; --profile-realtime turns it on for attribution.
    if (opts.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: opts.throttle });
    if (opts['profile-realtime']) await cdp.send('Profiler.start');
    const ticks0 = threadTicks();
    const t0 = Date.now();
    const rt = await realtime(page, opts.realtime);
    const cpu = threadCpu(ticks0, threadTicks(), (Date.now() - t0) / 1000);
    const frames = rt.frames;
    if (opts['profile-realtime']) {
      const { profile } = await cdp.send('Profiler.stop');
      results.profileRealtime = selfTime(profile);
    }
    if (opts.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results.realtime = {
      label: `realtime-${firing ? 'firing' : 'moving'}-${opts.still ? 'still' : 'walk-pan'}-${opts.realtime}s`,
      dpr: opts.dpr, pixelRatio: results.renderer.pixelRatio, antialias: results.renderer.antialias,
      throttle: opts.throttle, headed: !!opts.headed, uncapped: !!opts.uncap, mapGate: results.renderer.mapGate,
      buffer: rt.buffer, ...pacing(frames),
      gpuTimer: rt.timer ? { disjoint: rt.disjoint, unread: rt.unread } : null,
      mapRepaints: rt.repaints, cpu,
    };
    if (frames.length) {
    // A run whose context was lost draws nothing and paces perfectly; say so
    // rather than report it.
    results.realtime.contextLost = results.realtime.drawCalls.max === 0;
    results.realtime.lostEvents = rt.lostEvents;
    results.realtime.hw = await page.evaluate(() => window.__handWeapon());
    results.realtime.effects = await page.evaluate(() => window.__effects());
    results.realtime.collider = await page.evaluate(() => window.__collision?.());
    // Every world matrix against a fresh recompute: the static subtrees that
    // opt out of three's per-frame walk must not have drifted after a minute
    // of walking, firing and turning.
    results.realtime.matrixDrift = await page.evaluate(() => window.__matrixDrift?.() ?? null);
    if (results.realtime.matrixDrift) console.log(`--- matrix drift after real time: ${JSON.stringify(results.realtime.matrixDrift)}`);
    results.frames = frames;
    console.log(JSON.stringify({ ...results.realtime, longest: undefined, hw: undefined }));
    console.log('--- longest frames (i, ms, calls, particles, spawned, ticks, casts, shots, programs, textures, heapMB, mainMs, gpu main/near/tail)');
    for (const f of results.realtime.longest) console.log(JSON.stringify(f));
    await phase('after-realtime', 120);
    if (results.profileStepped) {
      console.log(`--- profile self time, stepped firing (total ${results.profileStepped.totalMs} ms)`);
      for (const l of results.profileStepped.top.slice(0, 25)) console.log(`${l.share.toFixed(1).padStart(5)}%  ${String(l.ms).padStart(6)}ms  ${l.fn}`);
    }
    if (results.profileRealtime) {
      console.log(`--- profile self time, real time (total ${results.profileRealtime.totalMs} ms)`);
      for (const l of results.profileRealtime.top.slice(0, 25)) console.log(`${l.share.toFixed(1).padStart(5)}%  ${String(l.ms).padStart(6)}ms  ${l.fn}`);
    }
    }
  } finally {
    clearInterval(rssTimer);
    results.logs = logs.slice(0, 40);
    if (results.rss.length) {
      const first = results.rss[0], lastR = results.rss[results.rss.length - 1];
      console.log(`--- rss MB first/last: gpu ${first.gpu}/${lastR.gpu} renderer ${first.renderer}/${lastR.renderer} utility ${first.utility}/${lastR.utility} total ${first.total}/${lastR.total}`);
    }
    console.log(`--- console errors/warnings: ${logs.length}`);
    for (const l of logs.slice(0, 10)) console.log(l);
    if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(results));
    await browser.close();
  }
}

/**
 * Parity captures: the on-foot view at fixed stepped frames under a seeded
 * random, so two builds can be compared pixel for pixel. `arms` is the idle
 * rig, `burst` is 40 frames into a held trigger (flashes, tracers, sprites),
 * `settled` is 240 frames after release (decals that outlived the burst),
 * and `minimap` is the HUD canvas at the same moment.
 */
async function shot() {
  if (!opts.dir) throw new Error('shot needs --dir');
  fs.mkdirSync(opts.dir, { recursive: true });
  opts.preserve = true;
  const { browser, page } = await launch();
  try {
    await load(page);
    await page.evaluate(flag => { window.__perfFlag = flag; }, opts.flag);
    // From here every frame is a stepped one. The page's own animation loop
    // would otherwise keep integrating real time — the soldier's 60 Hz clock
    // and the deviation model's 30 Hz one both carry a fractional tick
    // between frames, so even a spawn that ran live for 2.5 s leaves the
    // accumulators in a phase that decides which frame a tick lands on,
    // which decides the spread on a round, its hit, its bundle, and every
    // random draw after it. Stopped before the spawn, two captures of the
    // same build are the same picture to the pixel.
    await page.evaluate(() => window.__renderer.setAnimationLoop(null));
    await spawn(page);
    const save = async (name, selector) => {
      const data = await page.evaluate(sel => {
        const canvas = sel ? document.querySelector(sel) : window.__renderer.domElement;
        return canvas.toDataURL('image/png');
      }, selector || null);
      fs.writeFileSync(path.join(opts.dir, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    };
    const step = (n, src) => page.evaluate(([n, src]) => {
      const f = src ? new Function('i', src) : null;
      for (let i = 0; i < n; i++) { f && f(i); window.__renderOnce(window.__perfW, window.__perfH); }
    }, [n, src || null]);
    await page.evaluate(([w, h, seed]) => { window.__perfW = w; window.__perfH = h; window.__seedRandom(seed); }, [opts.width, opts.height, opts.seed]);
    await step(200);
    await save('arms');
    await page.evaluate(() => { for (let i = 0; i < 10; i++) window.__lookDelta(0, 20); });
    await step(30);
    await page.evaluate(() => { window.__seedRandom(window.__perfSeed = 11); window.__setTrigger(true); });
    await step(40, 'window.__lookDelta(i < 20 ? 6 : -6, 0)');
    await save('burst');
    await save('minimap', '#minimap-canvas');
    await page.evaluate(() => window.__setTrigger(false));
    await step(240);
    await save('settled');
    const state = await page.evaluate(() => ({ hw: window.__handWeapon(), effects: window.__effects(), soldier: window.__soldier() }));
    fs.writeFileSync(path.join(opts.dir, 'state.json'), JSON.stringify(state, null, 1));
    console.log(`captured to ${opts.dir}: ${JSON.stringify({ shots: state.hw?.shots, particles: state.effects.particles, decals: state.effects.decals })}`);
  } finally {
    await browser.close();
  }
}

/** Pixel diff of two capture directories: count of differing pixels per image. */
function compare() {
  const [a, b] = opts._ || [];
  if (!a || !b) throw new Error('compare needs two directories');
  const names = fs.readdirSync(a).filter(f => f.endsWith('.png') && fs.existsSync(path.join(b, f)));
  let worst = 0;
  for (const name of names) {
    const A = PNG.sync.read(fs.readFileSync(path.join(a, name)));
    const B = PNG.sync.read(fs.readFileSync(path.join(b, name)));
    if (A.width !== B.width || A.height !== B.height) { console.log(`${name}: size differs ${A.width}x${A.height} vs ${B.width}x${B.height}`); worst = 1; continue; }
    let differ = 0, over8 = 0, maxDelta = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      if (d) differ++;
      if (d > 8) over8++;
      if (d > maxDelta) maxDelta = d;
    }
    const pixels = A.width * A.height;
    const share = 100 * over8 / pixels;
    worst = Math.max(worst, share);
    console.log(`${name}: ${A.width}x${A.height}  differing ${differ} (${(100 * differ / pixels).toFixed(3)}%)  >8/255: ${over8} (${share.toFixed(3)}%)  max channel delta ${maxDelta}`);
  }
  return worst;
}

(async () => {
  if (mode === 'bench') await bench();
  else if (mode === 'shot') await shot();
  else if (mode === 'compare') compare();
  else throw new Error(`unknown mode ${mode}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
