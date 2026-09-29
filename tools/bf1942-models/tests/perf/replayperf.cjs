#!/usr/bin/env node
// What a round replay costs on map.html (features/replay-performance): the
// time to a watchable round and the long tasks on the way, then playback
// windows at a few points of the round with the replay's own frame split by
// stage (`replay.guard.run`'s names), then a drag along the timeline, and
// what the GPU was asked to delete and upload again after one seek.
//
//   node replayperf.cjs --base http://localhost:5491 --replay replays/<file>.ndjson
//     [--windows 300,1300,2300] [--secs 10] [--speed 1] [--profile <dir>] [--out summary.json]
//
// `--profile <dir>` writes a CPU profile of the load and of each window
// there. One headless Chromium (ANGLE on Vulkan), closed at the end: the
// owner tests on this machine. Frame times in headless follow the machine's
// state (power profile, other agents' runs); compare runs taken back to back.
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
const { chromium } = require(path.join(modulesDir(), 'playwright'));

const opts = { base: 'http://localhost:5273', replay: '', windows: '300,1300,2300', secs: '10', speed: '1',
  profile: '', out: '' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i].replace(/^--/, '');
  if (!(k in opts)) throw new Error(`unknown --${k}`);
  opts[k] = argv[i + 1];
}
if (!opts.replay) throw new Error('--replay replays/<file>.ndjson is required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GL_CALLS = ['deleteTexture', 'texStorage2D', 'deleteBuffer', 'bufferData', 'deleteProgram', 'linkProgram'];

/** Self time by function, the top `n`, from a CDP profile. */
function selfTimes(profile, n = 25) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const self = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const us = profile.timeDeltas[i] ?? 0;
    const cf = nodes.get(id).callFrame;
    const key = `${cf.functionName || '(anon)'} ${(cf.url || '').split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
    total += us;
  });
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
  });
  const report = { opts, load: {}, windows: [], scrub: null, seekGl: null };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(calls => {
      window.__long = [];
      try {
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) window.__long.push({ at: e.startTime, ms: e.duration });
        }).observe({ type: 'longtask', buffered: true });
      } catch {}
      window.__gl = {};
      for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
        for (const name of calls) {
          const orig = C?.prototype?.[name];
          if (!orig) continue;
          C.prototype[name] = function (...a) { window.__gl[name] = (window.__gl[name] ?? 0) + 1; return orig.apply(this, a); };
        }
      }
    }, GL_CALLS);
    const cdp = await page.context().newCDPSession(page);
    if (opts.profile) {
      fs.mkdirSync(opts.profile, { recursive: true });
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    const t0 = Date.now();
    await page.goto(`${opts.base}/map.html?mod=bf1942&replay=${opts.replay}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.replay?.statusLine, null, { timeout: 600000, polling: 250 });
    report.load.readySeconds = (Date.now() - t0) / 1000;
    // The replay's first frames after it says it is ready, where the
    // highlights used to read the whole round in one piece.
    await sleep(3000);
    if (opts.profile) {
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(path.join(opts.profile, 'load.cpuprofile'), JSON.stringify(profile));
      report.load.selfTimes = selfTimes(profile);
    }
    Object.assign(report.load, await page.evaluate(() => {
      const r = window.replay;
      const long = window.__long;
      return {
        status: r.statusLine,
        longTasks: long.length,
        longest: [...long].sort((a, b) => b.ms - a.ms).slice(0, 6).map(x => `${x.ms.toFixed(0)} ms @ ${(x.at / 1000).toFixed(1)} s`),
        heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
        hulls: r.hulls.size,
        props: r.props?.props?.length ?? 0,
      };
    }));
    await sleep(2000);

    // Every stage of the replay's frame, timed.
    await page.evaluate(() => {
      const r = window.replay;
      const stats = window.__stages = new Map();
      const add = (name, ms) => {
        let s = stats.get(name);
        if (!s) stats.set(name, s = []);
        s.push(ms);
      };
      const run = r.guard.run.bind(r.guard);
      r.guard.run = (what, fn, fallback) => {
        const s = performance.now();
        try { return run(what, fn, fallback); } finally { add(what, performance.now() - s); }
      };
      const item = r.guard.item.bind(r.guard);
      r.guard.item = (what, key, fn, onFault) => {
        const s = performance.now();
        try { return item(what, key, fn, onFault); } finally {
          add(/'s /.test(what) ? `${what.replace(/^player \d+'s /, '')} (each man)` : 'a hull (each)', performance.now() - s);
        }
      };
      const update = r.update.bind(r);
      let last = null;
      r.update = dt => {
        const s = performance.now();
        try { return update(dt); } finally {
          add('replay.update', performance.now() - s);
          if (last !== null) add('frame interval', s - last);
          last = s;
        }
      };
    });
    const summarise = () => page.evaluate(() => {
      const out = {};
      const pct = (l, p) => [...l].sort((a, b) => a - b)[Math.min(l.length - 1, Math.floor(p * l.length))] ?? 0;
      for (const [name, list] of window.__stages) {
        const sum = list.reduce((a, b) => a + b, 0);
        out[name] = { n: list.length, mean: +(sum / list.length).toFixed(3), p95: +pct(list, 0.95).toFixed(2),
                      max: +Math.max(...list).toFixed(1) };
      }
      const f = window.__stages.get('frame interval') ?? [];
      return { stages: out, frames: f.length, over33: f.filter(x => x > 33.4).length, over50: f.filter(x => x > 50).length,
               longTasks: window.__long.map(x => Math.round(x.ms)), t: Math.round(window.replay.time) };
    });

    for (const at of opts.windows.split(',').map(Number)) {
      await page.evaluate(({ at, speed }) => {
        const r = window.replay;
        r.seek(at);
        r.speed = speed;
        r.playing = true;
      }, { at, speed: Number(opts.speed) });
      await sleep(1500);
      await page.evaluate(() => { window.__stages.clear(); window.__long.length = 0; });
      if (opts.profile) await cdp.send('Profiler.start');
      await sleep(Number(opts.secs) * 1000);
      const w = await summarise();
      if (opts.profile) {
        const { profile } = await cdp.send('Profiler.stop');
        fs.writeFileSync(path.join(opts.profile, `play-${at}.cpuprofile`), JSON.stringify(profile));
        w.selfTimes = selfTimes(profile);
      }
      report.windows.push({ at, ...w });
    }

    // One seek: what the GPU deletes and makes again in the second after it.
    await page.evaluate(() => { window.__gl = {}; });
    await sleep(1000);
    const steady = await page.evaluate(() => ({ ...window.__gl }));
    await page.evaluate(() => { window.__gl = {}; window.replay.seek(window.replay.time - 600); });
    await sleep(1000);
    report.seekGl = { steadySecond: steady, secondAfterSeek: await page.evaluate(() => ({ ...window.__gl })) };

    // A drag along the timeline, 20% to 80% in about two seconds.
    await page.mouse.move(640, 600);
    await sleep(300);
    const box = await page.evaluate(() => {
      const r = window.replay.ui.timeline.el.getBoundingClientRect();
      return { x: r.x, y: r.y + r.height / 2, w: r.width };
    });
    await page.evaluate(() => { window.__stages.clear(); window.__long.length = 0; });
    await page.mouse.move(box.x + box.w * 0.2, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 90; i++) {
      await page.mouse.move(box.x + box.w * (0.2 + (0.6 * i) / 90), box.y);
      await sleep(20);
    }
    await page.mouse.up();
    await sleep(1500);
    const drag = await summarise();
    report.scrub = { frames: drag.frames, over33: drag.over33, over50: drag.over50, frame: drag.stages['frame interval'],
                     update: drag.stages['replay.update'], longTasks: drag.longTasks };
  } catch (error) {
    report.error = String(error?.stack || error);
  } finally {
    await browser.close();
  }
  const text = JSON.stringify(report, null, 1);
  if (opts.out) fs.writeFileSync(opts.out, text);
  console.log(text);
})();
